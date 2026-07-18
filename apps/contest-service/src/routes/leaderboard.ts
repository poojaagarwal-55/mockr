import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate, getAuthenticatedUserId } from '../middleware/auth.js';
import { verifyContestManager, requesterIsContestManager } from '../middleware/admin.js';
import { prisma } from '../lib/prisma.js';
import { redis, CacheKeys, CacheTTL } from '../lib/redis.js';
import { contestIdParamSchema, leaderboardQuerySchema } from '../types/contest.js';
import { clampParticipantFinalScore } from '../services/scoring-service.js';
import { isContestVisibleToUser } from '../services/contest-service.js';

// In-process single-flight guard for the leaderboard aggregation. When the
// cache is cold and many requests arrive together (the post-contest results
// rush), only the first runs the full DB aggregation; the rest await its
// result. Identical output — this only collapses duplicate concurrent work.
const leaderboardInflight = new Map<string, Promise<unknown>>();

type LeaderboardParticipant = {
  userId: string;
  totalScore: number;
  registeredAt: Date;
};

type ContestScoreBreakdown = {
  showBreakdown: boolean;
  hasMcq: boolean;
  hasDsa: boolean;
  isMixed: boolean;
  isMcqOnly: boolean;
  mcqPossibleScore: number;
  codingPossibleScore: number;
  totalPossibleScore: number;
};

type ParticipantRoundScore = {
  mcqScore: number;
  codingScore: number;
};

type SolvedSubmission = {
  userId: string;
  questionId: string;
  submittedAt: Date;
};

type UserDisplay = {
  fullName: string;
  username: string | null;
};

function normalizeScore(score: number | null | undefined) {
  return Math.max(0, Number(score ?? 0));
}

function compareLastSolvedAt(a: Date | null, b: Date | null) {
  if (a && b) return a.getTime() - b.getTime();
  if (a && !b) return -1;
  if (!a && b) return 1;
  return 0;
}

function latestDate(a: Date | null | undefined, b: Date | null | undefined) {
  if (a && b) return a > b ? a : b;
  return a ?? b ?? null;
}

function buildSolvedStats(submissions: SolvedSubmission[]) {
  const earliestSolveByUserQuestion = new Map<string, Map<string, Date>>();

  for (const submission of submissions) {
    const userSolves = earliestSolveByUserQuestion.get(submission.userId) ?? new Map<string, Date>();
    const previous = userSolves.get(submission.questionId);
    if (!previous || submission.submittedAt < previous) {
      userSolves.set(submission.questionId, submission.submittedAt);
    }
    earliestSolveByUserQuestion.set(submission.userId, userSolves);
  }

  const stats = new Map<string, { solvedCount: number; lastSolvedAt: Date | null }>();
  for (const [userId, solvedQuestions] of earliestSolveByUserQuestion.entries()) {
    const solvedTimes = Array.from(solvedQuestions.values());
    const lastSolvedAt = solvedTimes.reduce<Date | null>((latest, solvedAt) => {
      if (!latest || solvedAt > latest) return solvedAt;
      return latest;
    }, null);

    stats.set(userId, {
      solvedCount: solvedQuestions.size,
      lastSolvedAt,
    });
  }

  return stats;
}

function rankParticipants(
  participants: LeaderboardParticipant[],
  solvedSubmissions: SolvedSubmission[],
  mcqSubmittedAtByUserId: Map<string, Date> = new Map()
) {
  const solvedStats = buildSolvedStats(solvedSubmissions);

  return participants
    .map((participant) => {
      const stats = solvedStats.get(participant.userId);
      const lastSolvedAt = stats?.lastSolvedAt ?? null;
      const lastScoreActivityAt = latestDate(lastSolvedAt, mcqSubmittedAtByUserId.get(participant.userId) ?? null);
      return {
        ...participant,
        normalizedScore: normalizeScore(participant.totalScore),
        solvedCount: stats?.solvedCount ?? 0,
        lastSolvedAt,
        lastScoreActivityAt,
      };
    })
    .sort((a, b) => {
      if (b.normalizedScore !== a.normalizedScore) return b.normalizedScore - a.normalizedScore;
      if (b.solvedCount !== a.solvedCount) return b.solvedCount - a.solvedCount;

      const solvedTimeDiff = compareLastSolvedAt(a.lastScoreActivityAt, b.lastScoreActivityAt);
      if (solvedTimeDiff !== 0) return solvedTimeDiff;

      const registrationDiff = a.registeredAt.getTime() - b.registeredAt.getTime();
      if (registrationDiff !== 0) return registrationDiff;

      return a.userId.localeCompare(b.userId);
    })
    .map((participant, index) => ({
      ...participant,
      rank: index + 1,
    }));
}

function parseRedisValue<T>(value: unknown): T | null {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }
  return value as T;
}

async function safeRedisGet<T = unknown>(key: string): Promise<T | null> {
  try {
    return await redis.get<T>(key);
  } catch {
    return null;
  }
}

async function safeRedisSetex(key: string, ttlSeconds: number, value: string) {
  try {
    await redis.setex(key, ttlSeconds, value);
  } catch {
    // Leaderboard cache is derived data; DB-backed response should still work.
  }
}

async function getContestScoreVisibility(contestId: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{
    roundFlow: string | null;
    showScoreOnHub: boolean | null;
  }>>(
    `SELECT
      round_flow AS "roundFlow",
      show_score_on_hub AS "showScoreOnHub"
     FROM contests
     WHERE id = $1
     LIMIT 1`,
    contestId
  );

  const row = rows[0];
  const roundFlow = row?.roundFlow === 'mcq_only'
    ? 'mcq_only'
    : row?.roundFlow === 'mcq_then_dsa'
      ? 'mcq_then_dsa'
      : 'dsa_only';
  return {
    roundFlow,
    showScoreOnHub: row?.showScoreOnHub !== false,
  };
}

async function getContestScoreBreakdown(contestId: string): Promise<ContestScoreBreakdown> {
  const rows = await prisma.$queryRawUnsafe<Array<{
    mcqCount: number;
    dsaCount: number;
    mcqPossibleScore: number;
    codingPossibleScore: number;
  }>>(
    `SELECT
      COUNT(*) FILTER (
        WHERE COALESCE(question_type, 'dsa') = 'mcq'
           OR COALESCE(phase, 'dsa') = 'mcq'
      )::int AS "mcqCount",
      COUNT(*) FILTER (
        WHERE NOT (
          COALESCE(question_type, 'dsa') = 'mcq'
          OR COALESCE(phase, 'dsa') = 'mcq'
        )
      )::int AS "dsaCount",
      COALESCE(SUM(
        CASE
          WHEN COALESCE(question_type, 'dsa') = 'mcq'
            OR COALESCE(phase, 'dsa') = 'mcq'
          THEN points
          ELSE 0
        END
      ), 0)::int AS "mcqPossibleScore",
      COALESCE(SUM(
        CASE
          WHEN NOT (
            COALESCE(question_type, 'dsa') = 'mcq'
            OR COALESCE(phase, 'dsa') = 'mcq'
          )
          THEN points
          ELSE 0
        END
      ), 0)::int AS "codingPossibleScore"
     FROM contest_questions
     WHERE contest_id = $1`,
    contestId
  );

  const row = rows[0];
  const mcqCount = Number(row?.mcqCount || 0);
  const dsaCount = Number(row?.dsaCount || 0);
  const mcqPossibleScore = Number(row?.mcqPossibleScore || 0);
  const codingPossibleScore = Number(row?.codingPossibleScore || 0);

  return {
    showBreakdown: mcqCount > 0,
    hasMcq: mcqCount > 0,
    hasDsa: dsaCount > 0,
    isMixed: mcqCount > 0 && dsaCount > 0,
    isMcqOnly: mcqCount > 0 && dsaCount === 0,
    mcqPossibleScore,
    codingPossibleScore,
    totalPossibleScore: mcqPossibleScore + codingPossibleScore,
  };
}

async function getParticipantRoundScoreMap(contestId: string, userIds: string[]) {
  const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));
  const scoresByUserId = new Map<string, ParticipantRoundScore>();

  for (const userId of uniqueUserIds) {
    scoresByUserId.set(userId, { mcqScore: 0, codingScore: 0 });
  }

  if (uniqueUserIds.length === 0) return scoresByUserId;

  const [roundRows, mcqFallbackRows, codingFallbackRows] = await Promise.all([
    prisma.$queryRawUnsafe<Array<{ userId: string; roundType: string; scoreAwarded: number }>>(
      `SELECT
        user_id AS "userId",
        round_type AS "roundType",
        COALESCE(score_awarded, 0)::int AS "scoreAwarded"
       FROM contest_round_attempts
       WHERE contest_id = $1
         AND user_id = ANY($2::text[])
         AND round_type IN ('mcq', 'dsa')`,
      contestId,
      uniqueUserIds
    ),
    prisma.$queryRawUnsafe<Array<{ userId: string; score: number }>>(
      `SELECT
        user_id AS "userId",
        COALESCE(SUM(points_awarded), 0)::int AS score
       FROM contest_mcq_answers
       WHERE contest_id = $1
         AND user_id = ANY($2::text[])
         AND status = 'submitted'
       GROUP BY user_id`,
      contestId,
      uniqueUserIds
    ),
    prisma.$queryRawUnsafe<Array<{ userId: string; score: number }>>(
      `SELECT
        cs.user_id AS "userId",
        COALESCE(SUM(cs.points_awarded), 0)::int AS score
       FROM contest_submissions cs
       INNER JOIN contest_questions cq
         ON cq.contest_id = cs.contest_id
        AND cq.question_id = cs.question_id
       WHERE cs.contest_id = $1
         AND cs.user_id = ANY($2::text[])
         AND NOT (
           COALESCE(cq.question_type, 'dsa') = 'mcq'
           OR COALESCE(cq.phase, 'dsa') = 'mcq'
         )
       GROUP BY cs.user_id`,
      contestId,
      uniqueUserIds
    ),
  ]);

  for (const row of mcqFallbackRows) {
    const current = scoresByUserId.get(row.userId) ?? { mcqScore: 0, codingScore: 0 };
    scoresByUserId.set(row.userId, { ...current, mcqScore: Number(row.score || 0) });
  }

  for (const row of codingFallbackRows) {
    const current = scoresByUserId.get(row.userId) ?? { mcqScore: 0, codingScore: 0 };
    scoresByUserId.set(row.userId, { ...current, codingScore: Number(row.score || 0) });
  }

  for (const row of roundRows) {
    const current = scoresByUserId.get(row.userId) ?? { mcqScore: 0, codingScore: 0 };
    if (row.roundType === 'mcq') {
      scoresByUserId.set(row.userId, { ...current, mcqScore: Number(row.scoreAwarded || 0) });
    } else if (row.roundType === 'dsa') {
      scoresByUserId.set(row.userId, { ...current, codingScore: Number(row.scoreAwarded || 0) });
    }
  }

  return scoresByUserId;
}

async function getMcqSubmittedAtMap(contestId: string, userIds: string[]) {
  const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));
  const submittedAtByUserId = new Map<string, Date>();

  if (uniqueUserIds.length === 0) return submittedAtByUserId;

  const rows = await prisma.$queryRawUnsafe<Array<{ userId: string; submittedAt: Date | null }>>(
    `SELECT
      user_id AS "userId",
      MAX(submitted_at) AS "submittedAt"
     FROM contest_round_attempts
     WHERE contest_id = $1
       AND user_id = ANY($2::text[])
       AND round_type = 'mcq'
       AND status IN ('submitted', 'auto_submitted')
       AND submitted_at IS NOT NULL
     GROUP BY user_id`,
    contestId,
    uniqueUserIds
  );

  for (const row of rows) {
    if (row.submittedAt) {
      submittedAtByUserId.set(row.userId, row.submittedAt);
    }
  }

  return submittedAtByUserId;
}

function buildParticipantScoreBreakdown(
  contestBreakdown: ContestScoreBreakdown,
  roundScore: ParticipantRoundScore | undefined,
  totalScore: number
) {
  const mcqScore = Number(roundScore?.mcqScore || 0);
  const codingScore = Number(roundScore?.codingScore || 0);

  return {
    ...contestBreakdown,
    totalScore,
    mcqScore,
    codingScore,
  };
}

function formatLeaderboardTimeSeconds(contestStart: Date, lastSolvedAt: Date | null) {
  if (!lastSolvedAt) return 0;
  return Math.max(0, Math.floor((lastSolvedAt.getTime() - contestStart.getTime()) / 1000));
}

async function getUserDisplayMap(userIds: string[]) {
  const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));
  if (uniqueUserIds.length === 0) return new Map<string, UserDisplay>();

  const users = await prisma.user.findMany({
    where: {
      id: { in: uniqueUserIds },
    },
    select: {
      id: true,
      fullName: true,
      username: true,
    },
  });

  return new Map(users.map((user) => [
    user.id,
    {
      fullName: user.fullName,
      username: user.username,
    },
  ]));
}

function displayNameForUser(userId: string, usersById: Map<string, UserDisplay>) {
  const user = usersById.get(userId);
  return user?.fullName?.trim() || user?.username?.trim() || userId;
}

async function buildGeneratedLeaderboard(contestId: string, published = false) {
  const contest = await prisma.contest.findUnique({
    where: { id: contestId },
  });

  if (!contest) {
    throw new Error('Contest not found');
  }

  const [participants, acceptedSubmissions] = await Promise.all([
    prisma.contestParticipant.findMany({
      where: { contestId },
      select: {
        userId: true,
        totalScore: true,
        registeredAt: true,
      },
    }),
    prisma.contestSubmission.findMany({
      where: {
        contestId,
        OR: [
          { status: 'ACCEPTED' },
          { pointsAwarded: { gt: 0 } },
        ],
      },
      select: {
        userId: true,
        questionId: true,
        submittedAt: true,
      },
    }),
  ]);

  const participantUserIds = participants.map((participant) => participant.userId);
  const [usersById, contestBreakdown, roundScoresByUserId, mcqSubmittedAtByUserId] = await Promise.all([
    getUserDisplayMap(participantUserIds),
    getContestScoreBreakdown(contestId),
    getParticipantRoundScoreMap(contestId, participantUserIds),
    getMcqSubmittedAtMap(contestId, participantUserIds),
  ]);

  const leaderboard = rankParticipants(participants, acceptedSubmissions, mcqSubmittedAtByUserId).map((participant) => {
    const displayName = displayNameForUser(participant.userId, usersById);
    const username = usersById.get(participant.userId)?.username?.trim() || displayName;
    const scoreBreakdown = buildParticipantScoreBreakdown(
      contestBreakdown,
      roundScoresByUserId.get(participant.userId),
      participant.normalizedScore
    );

    return {
      rank: participant.rank,
      userId: participant.userId,
      participant: displayName,
      hacker: displayName,
      username,
      displayName,
      score: participant.normalizedScore,
      totalScore: participant.normalizedScore,
      mcqScore: scoreBreakdown.mcqScore,
      codingScore: scoreBreakdown.codingScore,
      scoreBreakdown,
      solvedCount: participant.solvedCount,
      timeSeconds: formatLeaderboardTimeSeconds(contest.startTime, participant.lastScoreActivityAt),
      submittedAt: participant.lastScoreActivityAt?.toISOString() ?? null,
      registeredAt: participant.registeredAt.toISOString(),
    };
  });

  return {
    success: true,
    available: true,
    published,
    status: 'READY' as const,
    message: 'Leaderboard generated successfully.',
    generatedAt: new Date().toISOString(),
    timeModel: 'round_activity_v1' as const,
    totalParticipants: participants.length,
    scoreBreakdown: contestBreakdown,
    leaderboard,
  };
}

type GeneratedLeaderboard = Awaited<ReturnType<typeof buildGeneratedLeaderboard>>;

async function enrichGeneratedLeaderboard(snapshot: GeneratedLeaderboard) {
  const usersById = await getUserDisplayMap(snapshot.leaderboard.map((entry) => entry.userId));
  return {
    ...snapshot,
    leaderboard: snapshot.leaderboard.map((entry) => {
      const displayName = displayNameForUser(entry.userId, usersById);
      const username = usersById.get(entry.userId)?.username?.trim() || displayName;
      return {
        ...entry,
        participant: displayName,
        hacker: displayName,
        username,
        displayName,
      };
    }),
  };
}

function paginateGeneratedLeaderboard(
  snapshot: GeneratedLeaderboard,
  page: number,
  limit: number,
  currentUserId?: string
) {
  const skip = (page - 1) * limit;
  const totalCount = snapshot.totalParticipants ?? snapshot.leaderboard.length;
  return {
    ...snapshot,
    leaderboard: snapshot.leaderboard.slice(skip, skip + limit).map((entry) => ({
      ...entry,
      isCurrentUser: currentUserId ? entry.userId === currentUserId : false,
    })),
    pagination: {
      page,
      limit,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    },
  };
}

/**
 * Leaderboard Routes
 * Handles leaderboard queries and user rankings
 */
export async function leaderboardRoutes(fastify: FastifyInstance) {
  /**
   * GET /contests/:id/leaderboard/generated
   * Get the admin-generated leaderboard snapshot.
   */
  fastify.get(
    '/contests/:id/leaderboard/generated',
    {
      preHandler: [authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const paramsValidation = contestIdParamSchema.safeParse(request.params);
        if (!paramsValidation.success) {
          return reply.status(400).send({
            error: 'Validation Error',
            details: paramsValidation.error.flatten().fieldErrors,
          });
        }

        const queryValidation = leaderboardQuerySchema.safeParse(request.query);
        if (!queryValidation.success) {
          return reply.status(400).send({
            error: 'Validation Error',
            details: queryValidation.error.flatten().fieldErrors,
          });
        }

        const { id: contestId } = paramsValidation.data;
        const { page, limit } = queryValidation.data;

        const contest = await prisma.contest.findUnique({
          where: { id: contestId },
          select: { id: true },
        });
        if (!contest) {
          return reply.status(404).send({
            error: 'Not Found',
            message: 'Contest not found',
          });
        }

        const userId = getAuthenticatedUserId(request);
        if (!(await isContestVisibleToUser(contestId, userId))) {
          return reply.status(404).send({
            error: 'Not Found',
            message: 'Contest not found',
          });
        }

        const isManager = await requesterIsContestManager(request);

        const cached = await safeRedisGet(CacheKeys.generatedContestLeaderboard(contestId));
        let snapshot = parseRedisValue<GeneratedLeaderboard>(cached);

        // A private (unpublished) snapshot is only visible to contest managers.
        // Everyone else sees the standard "not available yet" response.
        if (!snapshot?.available || (!snapshot.published && !isManager)) {
          return reply.send({
            success: true,
            available: false,
            published: false,
            status: 'PENDING',
            leaderboard: [],
            message: 'Leaderboard will be available soon.',
          });
        }

        if (!snapshot.scoreBreakdown || snapshot.timeModel !== 'round_activity_v1') {
          snapshot = await buildGeneratedLeaderboard(contestId, snapshot.published ?? false);
          await redis.set(CacheKeys.generatedContestLeaderboard(contestId), snapshot);
        }

        const enrichedSnapshot = await enrichGeneratedLeaderboard(snapshot);
        return reply.send(paginateGeneratedLeaderboard(enrichedSnapshot, page, limit, userId));
      } catch (error: any) {
        request.log.error({ error }, 'Failed to get generated leaderboard');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to get generated leaderboard',
        });
      }
    }
  );

  /**
   * POST /admin/contests/:id/leaderboard/generated
   * Generate or refresh the published leaderboard snapshot (Admin only).
   */
  fastify.post(
    '/admin/contests/:id/leaderboard/generated',
    {
      preHandler: [authenticate, verifyContestManager],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const paramsValidation = contestIdParamSchema.safeParse(request.params);
        if (!paramsValidation.success) {
          return reply.status(400).send({
            error: 'Validation Error',
            details: paramsValidation.error.flatten().fieldErrors,
          });
        }

        const { id: contestId } = paramsValidation.data;
        const contest = await prisma.contest.findUnique({
          where: { id: contestId },
          select: { id: true },
        });

        if (!contest) {
          return reply.status(404).send({
            error: 'Not Found',
            message: 'Contest not found',
          });
        }

        // Admins may generate/refresh the standings at any time (during or after
        // the contest). The snapshot stays private until explicitly published, so
        // regenerating mid-contest never leaks scores to participants. Preserve
        // the current published state across refreshes so refreshing a public
        // board does not silently hide it.
        const existing = parseRedisValue<GeneratedLeaderboard>(
          await safeRedisGet(CacheKeys.generatedContestLeaderboard(contestId))
        );
        const snapshot = await buildGeneratedLeaderboard(contestId, existing?.published ?? false);
        await redis.set(CacheKeys.generatedContestLeaderboard(contestId), snapshot);

        return reply.send(paginateGeneratedLeaderboard(snapshot, 1, 10000));
      } catch (error: any) {
        request.log.error({ error }, 'Failed to generate leaderboard');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to generate leaderboard',
        });
      }
    }
  );

  /**
   * POST /admin/contests/:id/leaderboard/publish
   * Toggle whether the generated leaderboard is visible to participants (Admin only).
   * Body: { published: boolean }
   */
  fastify.post(
    '/admin/contests/:id/leaderboard/publish',
    {
      preHandler: [authenticate, verifyContestManager],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const paramsValidation = contestIdParamSchema.safeParse(request.params);
        if (!paramsValidation.success) {
          return reply.status(400).send({
            error: 'Validation Error',
            details: paramsValidation.error.flatten().fieldErrors,
          });
        }

        const body = request.body as { published?: unknown } | undefined;
        if (typeof body?.published !== 'boolean') {
          return reply.status(400).send({
            error: 'Validation Error',
            message: '`published` must be a boolean',
          });
        }

        const { id: contestId } = paramsValidation.data;
        const existing = parseRedisValue<GeneratedLeaderboard>(
          await safeRedisGet(CacheKeys.generatedContestLeaderboard(contestId))
        );

        if (!existing?.available) {
          return reply.status(400).send({
            error: 'Bad Request',
            message: 'Generate the leaderboard before changing its visibility.',
          });
        }

        const updated: GeneratedLeaderboard = { ...existing, published: body.published };
        await redis.set(CacheKeys.generatedContestLeaderboard(contestId), updated);

        return reply.send(paginateGeneratedLeaderboard(updated, 1, 10000));
      } catch (error: any) {
        request.log.error({ error }, 'Failed to update leaderboard visibility');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to update leaderboard visibility',
        });
      }
    }
  );

  /**
   * GET /contests/:id/leaderboard
   * Get contest leaderboard (only available after contest ends)
   */
  fastify.get(
    '/contests/:id/leaderboard',
    {
      preHandler: [authenticate],
    },
    async (request: FastifyRequest<{ Params: { id: string }; Querystring: { page?: string; limit?: string } }>, reply: FastifyReply) => {
      try {
        const { id: contestId } = request.params;
        const page = parseInt(request.query.page || '1', 10);
        const limit = Math.min(parseInt(request.query.limit || '10000', 10), 10000);

        // Fetch contest
        const contest = await prisma.contest.findUnique({
          where: { id: contestId },
        });

        if (!contest) {
          return reply.status(404).send({
            error: 'Not Found',
            message: 'Contest not found',
          });
        }

        const userId = getAuthenticatedUserId(request);
        if (!(await isContestVisibleToUser(contestId, userId))) {
          return reply.status(404).send({
            error: 'Not Found',
            message: 'Contest not found',
          });
        }

        // Only show leaderboard after contest ends
        if (contest.status !== 'ENDED') {
          return reply.status(400).send({
            error: 'Bad Request',
            message: 'Leaderboard is only available after the contest ends',
          });
        }

        // Check cache first
        const cacheKey = `contest:${contestId}:leaderboard:v4:page:${page}:limit:${limit}`;
        const cached = await safeRedisGet(cacheKey);

        if (cached) {
          return reply.send(JSON.parse(cached as string));
        }

        let inflight = leaderboardInflight.get(cacheKey);
        if (!inflight) {
          inflight = (async () => {
        const skip = (page - 1) * limit;
        const [participants, acceptedSubmissions, totalCount] = await Promise.all([
          prisma.contestParticipant.findMany({
            where: { contestId },
            select: {
              userId: true,
              totalScore: true,
              registeredAt: true,
            },
          }),
          prisma.contestSubmission.findMany({
            where: {
              contestId,
              OR: [
                { status: 'ACCEPTED' },
                { pointsAwarded: { gt: 0 } },
              ],
            },
            select: {
              userId: true,
              questionId: true,
              submittedAt: true,
            },
          }),
          prisma.contestParticipant.count({
            where: { contestId },
          }),
        ]);

        const participantUserIds = participants.map((participant) => participant.userId);
        const mcqSubmittedAtByUserId = await getMcqSubmittedAtMap(contestId, participantUserIds);
        const rankedParticipants = rankParticipants(participants, acceptedSubmissions, mcqSubmittedAtByUserId);
        const rankedUserIds = rankedParticipants.map((participant) => participant.userId);
        const [usersById, contestBreakdown, roundScoresByUserId] = await Promise.all([
          getUserDisplayMap(rankedUserIds),
          getContestScoreBreakdown(contestId),
          getParticipantRoundScoreMap(contestId, rankedUserIds),
        ]);
        const leaderboard = rankedParticipants.slice(skip, skip + limit).map((p) => {
          const displayName = displayNameForUser(p.userId, usersById);
          const scoreBreakdown = buildParticipantScoreBreakdown(
            contestBreakdown,
            roundScoresByUserId.get(p.userId),
            p.normalizedScore
          );

          return {
            rank: p.rank,
            userId: p.userId,
            participant: displayName,
            username: usersById.get(p.userId)?.username?.trim() || displayName,
            displayName,
            score: p.normalizedScore,
            totalScore: p.normalizedScore,
            mcqScore: scoreBreakdown.mcqScore,
            codingScore: scoreBreakdown.codingScore,
            scoreBreakdown,
            solvedCount: p.solvedCount,
            lastSolvedAt: p.lastSolvedAt,
            timeSeconds: formatLeaderboardTimeSeconds(contest.startTime, p.lastScoreActivityAt),
            submittedAt: p.lastScoreActivityAt?.toISOString() ?? null,
            registeredAt: p.registeredAt,
          };
        });

        const response = {
          success: true,
          leaderboard,
          scoreBreakdown: contestBreakdown,
          pagination: {
            page,
            limit,
            totalCount,
            totalPages: Math.ceil(totalCount / limit),
          },
        };

        // Cache for 1 hour
        await safeRedisSetex(cacheKey, CacheTTL.contestLeaderboard, JSON.stringify(response));

        return response;
          })().finally(() => { leaderboardInflight.delete(cacheKey); });
          leaderboardInflight.set(cacheKey, inflight);
        }

        return reply.send(await inflight);
      } catch (error: any) {
        request.log.error({ error }, 'Failed to get leaderboard');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to get leaderboard',
        });
      }
    }
  );

  /**
   * GET /contests/:id/my-rank
   * Get current user's rank and score
   */
  fastify.get(
    '/contests/:id/my-rank',
    {
      preHandler: [authenticate],
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const userId = getAuthenticatedUserId(request);
        const { id: contestId } = request.params;

        // Fetch contest
        const contest = await prisma.contest.findUnique({
          where: { id: contestId },
        });

        if (!contest) {
          return reply.status(404).send({
            error: 'Not Found',
            message: 'Contest not found',
          });
        }

        if (!(await isContestVisibleToUser(contestId, userId))) {
          return reply.status(404).send({
            error: 'Not Found',
            message: 'Contest not found',
          });
        }

        // Fetch participant
        const participant = await prisma.contestParticipant.findUnique({
          where: {
            contestId_userId: {
              contestId,
              userId,
            },
          },
        });

        if (!participant) {
          return reply.status(404).send({
            error: 'Not Found',
            message: 'You are not registered for this contest',
          });
        }
        let participantTotalScore = participant.totalScore;
        if (participant.isSubmitted && participantTotalScore < 0) {
          const clampedScore = await clampParticipantFinalScore(contestId, userId);
          participantTotalScore = clampedScore ?? 0;
        }

        // During contest: only show score, not rank
        if (contest.status === 'ACTIVE') {
          const scoreVisibility = await getContestScoreVisibility(contestId);
          if (scoreVisibility.roundFlow !== 'dsa_only' && !scoreVisibility.showScoreOnHub && !participant.isSubmitted) {
            const contestBreakdown = await getContestScoreBreakdown(contestId);
            return reply.send({
              success: true,
              totalScore: null,
              scoreHidden: true,
              scoreBreakdown: {
                ...contestBreakdown,
                scoreHidden: true,
              },
              participant: {
                isSubmitted: participant.isSubmitted,
                submittedAt: participant.submittedAt,
                submissionType: participant.submissionType,
              },
              message: 'Score is hidden until the contest ends',
            });
          }

          const displayScore = participant.isSubmitted ? normalizeScore(participantTotalScore) : participantTotalScore;
          const [contestBreakdown, roundScoresByUserId] = await Promise.all([
            getContestScoreBreakdown(contestId),
            getParticipantRoundScoreMap(contestId, [userId]),
          ]);
          const scoreBreakdown = buildParticipantScoreBreakdown(
            contestBreakdown,
            roundScoresByUserId.get(userId),
            displayScore
          );

          return reply.send({
            success: true,
            totalScore: displayScore,
            mcqScore: scoreBreakdown.mcqScore,
            codingScore: scoreBreakdown.codingScore,
            scoreBreakdown,
            participant: {
              isSubmitted: participant.isSubmitted,
              submittedAt: participant.submittedAt,
              submissionType: participant.submissionType,
            },
            message: 'Leaderboard will be available after the contest ends',
          });
        }

        // After contest: rank comes ONLY from the admin-generated leaderboard
        // snapshot (built once when the admin publishes it). NEVER recompute the
        // whole leaderboard per request here — at the post-contest rush every
        // participant hits this endpoint simultaneously, and the old per-request
        // full scan (findMany over ALL participants + ALL submissions + in-JS
        // ranking) turned that into a platform-wide DB meltdown.
        if (contest.status === 'ENDED') {
          const displayScore = participant.isSubmitted ? normalizeScore(participantTotalScore) : participantTotalScore;
          const snapshot = parseRedisValue<GeneratedLeaderboard>(
            await safeRedisGet(CacheKeys.generatedContestLeaderboard(contestId))
          );
          const entry = snapshot?.available
            ? snapshot.leaderboard.find((row) => row.userId === userId)
            : undefined;

          if (entry) {
            // Zero extra DB work — rank + breakdown come straight from the cached snapshot.
            return reply.send({
              success: true,
              rank: entry.rank,
              rankAvailable: true,
              totalScore: entry.totalScore,
              mcqScore: entry.mcqScore,
              codingScore: entry.codingScore,
              scoreBreakdown: entry.scoreBreakdown,
              solvedCount: entry.solvedCount,
              timeSeconds: entry.timeSeconds,
              submittedAt: entry.submittedAt,
              participant: {
                isSubmitted: participant.isSubmitted,
                submittedAt: participant.submittedAt,
                submissionType: participant.submissionType,
              },
            });
          }

          // Leaderboard not published yet (or user not in the snapshot): show the
          // participant's own score, NO rank, and NO full scan — same light cost as
          // the in-contest "score only" path.
          const [contestBreakdown, roundScoresByUserId] = await Promise.all([
            getContestScoreBreakdown(contestId),
            getParticipantRoundScoreMap(contestId, [userId]),
          ]);
          const scoreBreakdown = buildParticipantScoreBreakdown(
            contestBreakdown,
            roundScoresByUserId.get(userId),
            displayScore
          );
          return reply.send({
            success: true,
            rank: null,
            rankAvailable: false,
            totalScore: displayScore,
            mcqScore: scoreBreakdown.mcqScore,
            codingScore: scoreBreakdown.codingScore,
            scoreBreakdown,
            participant: {
              isSubmitted: participant.isSubmitted,
              submittedAt: participant.submittedAt,
              submissionType: participant.submissionType,
            },
            message: 'Rank will be available once the leaderboard is published',
          });
        }

        // Before contest
        const contestBreakdown = await getContestScoreBreakdown(contestId);
        return reply.send({
          success: true,
          totalScore: 0,
          mcqScore: 0,
          codingScore: 0,
          scoreBreakdown: buildParticipantScoreBreakdown(contestBreakdown, undefined, 0),
          participant: {
            isSubmitted: participant.isSubmitted,
            submittedAt: participant.submittedAt,
            submissionType: participant.submissionType,
          },
          message: 'Contest has not started yet',
        });
      } catch (error: any) {
        request.log.error({ error }, 'Failed to get user rank');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to get user rank',
        });
      }
    }
  );
}
