import { prisma } from '../lib/prisma.js';
import { redis, CacheKeys } from '../lib/redis.js';
import { ContestStatus, CreateContestRequest, UpdateContestRequest, UpdateManagedContestRequest, Difficulty } from '../types/contest.js';
import { DEFAULT_CONTEST_INSTRUCTIONS } from '@interviewforge/shared';
import mongoose from 'mongoose';
import { clampNegativeContestScores } from './scoring-service.js';
import { randomUUID } from 'node:crypto';

/**
 * Contest Service
 * Handles all contest-related business logic
 */

function getRuntimeContestStatus(startTime: Date | string, endTime: Date | string): ContestStatus {
  const now = Date.now();
  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();

  if (Number.isFinite(end) && now >= end) return ContestStatus.ENDED;
  if (Number.isFinite(start) && now >= start) return ContestStatus.ACTIVE;
  return ContestStatus.UPCOMING;
}

async function refreshContestStatuses() {
  const now = new Date();

  const contestsToEnd = await prisma.contest.findMany({
    where: {
      endTime: { lte: now },
      status: { in: [ContestStatus.UPCOMING, ContestStatus.ACTIVE] },
    },
    include: {
      questions: {
        select: { questionId: true },
      },
    },
  });

  if (contestsToEnd.length > 0) {
    await prisma.contest.updateMany({
      where: {
        id: { in: contestsToEnd.map((contest) => contest.id) },
        status: { in: [ContestStatus.UPCOMING, ContestStatus.ACTIVE] },
      },
      data: { status: ContestStatus.ENDED },
    });

    for (const contest of contestsToEnd) {
      const questionIds = contest.questions.map((question) => question.questionId);
      await clampNegativeContestScores(contest.id);
      await releaseQuestionsFromActiveContest(questionIds);
      await safeRedisDel(CacheKeys.contestDetails(contest.id));
      await invalidateContestQuestionCaches(contest.id);
      await safeRedisDel(
        CacheKeys.contestLeaderboard(contest.id),
        CacheKeys.generatedContestLeaderboard(contest.id)
      );
    }
  }

  await prisma.$transaction([
    prisma.contest.updateMany({
      where: {
        startTime: { lte: now },
        endTime: { gt: now },
        status: ContestStatus.UPCOMING,
      },
      data: { status: ContestStatus.ACTIVE },
    }),
    prisma.contest.updateMany({
      where: {
        startTime: { gt: now },
        status: ContestStatus.ACTIVE,
      },
      data: { status: ContestStatus.UPCOMING },
    }),
  ]);
}

function withRuntimeStatus<T extends { startTime: Date | string; endTime: Date | string; status: string }>(
  contest: T
): Omit<T, 'status'> & { status: ContestStatus } {
  return {
    ...contest,
    status: getRuntimeContestStatus(contest.startTime, contest.endTime),
  };
}

function normalizeDifficulty(difficultyRaw?: string): Difficulty {
  const difficulty = String(difficultyRaw || 'MEDIUM').toUpperCase();
  if (difficulty === Difficulty.EASY) return Difficulty.EASY;
  if (difficulty === Difficulty.HARD) return Difficulty.HARD;
  return Difficulty.MEDIUM;
}

function pointsForDifficulty(difficulty: Difficulty) {
  if (difficulty === Difficulty.EASY) return 150;
  if (difficulty === Difficulty.HARD) return 500;
  return 300;
}

type ContestQuestionInput = {
  questionId: string;
  questionType: 'dsa' | 'mcq';
  phase: 'dsa' | 'mcq';
  points?: number;
  negativePoints?: number;
  negativeCap?: number;
};

type ContestQuestionInputPayload = {
  questionId?: string;
  questionType?: string;
  phase?: string;
  points?: number;
  negativePoints?: number;
  negativeCap?: number;
};

const QUESTION_MODEL_NAMES = [
  'ContestDSAQuestion',
  'DSAQuestion',
  'DSSQLQuestion',
  'DSCodingQuestion',
  'DSConceptQuestion',
  'SQLQuestion',
  'CSFundamentalQuestion',
  'GenAICodingQuestion',
  'GenAIConceptQuestion',
  'GenAIEthicsQuestion',
  'GenAISystemDesignQuestion',
  'PMCaseQuestion',
  'PMConceptQuestion',
  'PMStrategyQuestion',
];
const MCQ_QUESTION_MODEL_NAME = 'ContestMCQQuestion';

type ContestRoundSettings = {
  roundFlow: 'dsa_only' | 'mcq_only' | 'mcq_then_dsa';
  showScoreOnHub: boolean;
  mcqSequential: boolean;
};

type ContestQuestionSelectionRow = {
  id: string;
  contestId: string;
  questionId: string;
  questionType: 'dsa' | 'mcq';
  phase: 'dsa' | 'mcq';
  difficulty: string;
  points: number;
  negativePoints: number;
  negativeCap: number;
  order: number;
  phaseOrder: number;
};

function normalizeQuestionType(value: unknown): 'dsa' | 'mcq' {
  return String(value || '').toLowerCase() === 'mcq' ? 'mcq' : 'dsa';
}

function validateContestRoundFlow(
  roundFlow: ContestRoundSettings['roundFlow'],
  questions: Array<{ questionType: 'dsa' | 'mcq' }>
) {
  const hasMcq = questions.some((question) => question.questionType === 'mcq');
  const hasDsa = questions.some((question) => question.questionType === 'dsa');

  if (roundFlow === 'dsa_only' && hasMcq) {
    throw new Error('DSA only contests cannot include MCQ questions');
  }

  if (roundFlow === 'mcq_only') {
    if (!hasMcq) {
      throw new Error('MCQ only round flow requires at least one MCQ question');
    }
    if (hasDsa) {
      throw new Error('MCQ only contests cannot include DSA questions');
    }
  }

  if (roundFlow === 'mcq_then_dsa' && (!hasMcq || !hasDsa)) {
    throw new Error('MCQ then DSA round flow requires at least one MCQ question and one DSA question');
  }
}

function normalizePhase(value: unknown, questionType: 'dsa' | 'mcq'): 'dsa' | 'mcq' {
  const phase = String(value || '').toLowerCase();
  if (phase === 'mcq' || phase === 'dsa') return phase === questionType ? phase : questionType;
  return questionType;
}

function normalizeNonNegativeInt(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.floor(numeric));
}

function resolvePenaltyConfig(input: { negativePoints?: unknown; negativeCap?: unknown }, fallbackWrongPenalty?: unknown) {
  const fallbackPenalty = normalizeNonNegativeInt(fallbackWrongPenalty);
  const negativePoints = normalizeNonNegativeInt(input.negativePoints ?? fallbackPenalty);
  const defaultCap = negativePoints > 0 ? negativePoints : 0;
  const negativeCap = normalizeNonNegativeInt(input.negativeCap ?? defaultCap);

  return {
    negativePoints,
    negativeCap: negativePoints > 0 ? negativeCap : 0,
  };
}

function normalizeQuestionInputs(
  data: Pick<CreateContestRequest, 'questionIds' | 'questions' | 'wrongPenalty'> | { questionIds?: string[]; questions?: ContestQuestionInputPayload[]; wrongPenalty?: number },
  fallbackWrongPenalty?: number
): ContestQuestionInput[] {
  const rawQuestions: ContestQuestionInputPayload[] = data.questions?.length
    ? data.questions
    : (data.questionIds || []).map((questionId) => ({ questionId }));

  const seen = new Set<string>();
  const normalized: ContestQuestionInput[] = [];
  for (const question of rawQuestions) {
    const questionId = String(question.questionId || '').trim();
    const questionType = normalizeQuestionType(question.questionType);
    const phase = normalizePhase(question.phase, questionType);
    const uniqueKey = `${questionType}:${questionId}`;
    if (!questionId || seen.has(uniqueKey)) continue;
    seen.add(uniqueKey);
    const penaltyConfig = resolvePenaltyConfig(question, data.wrongPenalty ?? fallbackWrongPenalty);
    normalized.push({
      questionId,
      questionType,
      phase,
      points: question.points,
      negativePoints: penaltyConfig.negativePoints,
      negativeCap: penaltyConfig.negativeCap,
    });
  }
  return normalized;
}

function buildQuestionLookupQuery(questionIds: string[]) {
  const objectIds = questionIds
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));
  const numericQuestionIds = questionIds
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id));

  return {
    $or: [
      ...(objectIds.length > 0 ? [{ _id: { $in: objectIds } }] : []),
      { problemId: { $in: questionIds } },
      { frontendId: { $in: questionIds } },
      ...(numericQuestionIds.length > 0 ? [{ frontendId: { $in: numericQuestionIds } }] : []),
    ],
  };
}

function matchesQuestionIdentifier(questionIds: string[], question: { _id?: unknown; problemId?: unknown; frontendId?: unknown }) {
  const mongoId = question._id?.toString();
  const problemId = question.problemId === undefined || question.problemId === null ? '' : String(question.problemId);
  const frontendId = question.frontendId === undefined || question.frontendId === null ? '' : String(question.frontendId);

  return questionIds.find((id) => (
    id === mongoId ||
    id === problemId ||
    id === frontendId
  ));
}

function normalizeContestInstructions(value?: string | null) {
  const instructions = String(value || '').trim();
  return instructions.length >= 20 ? instructions : DEFAULT_CONTEST_INSTRUCTIONS;
}

async function invalidateContestQuestionCaches(contestId: string) {
  const baseKey = CacheKeys.contestQuestions(contestId);
  await safeRedisDel(
    baseKey,
    `${baseKey}:ide-v4`,
    `${baseKey}:ide-v5`,
    `${baseKey}:ide-v6`,
    `${baseKey}:ide-v7`,
    `${baseKey}:ide-v8`,
    `${baseKey}:dsa:v1`,
    `${baseKey}:mcq:v1`
  );
}

async function safeRedisDel(...keys: string[]) {
  try {
    await redis.del(...keys);
  } catch {
    // Redis only backs derived cache here. DB/Mongo writes and reads should not
    // fail because an invalidation attempt had a transient cache error.
  }
}

type ContestQuestionUsageEntry = {
  contestIds: Set<string>;
  currentlyChoosedForContest: boolean;
};

/**
 * Repairs question usage metadata from persisted contest records without erasing history.
 * Safe to run repeatedly before admin bank reads.
 */
export async function reconcileContestQuestionUsage(questionIds?: string[]) {
  const normalizedQuestionIds = Array.from(
    new Set((questionIds || []).map((questionId) => String(questionId || '').trim()).filter(Boolean))
  );

  const contestQuestions = await prisma.contestQuestion.findMany({
    where: normalizedQuestionIds.length > 0
      ? { questionId: { in: normalizedQuestionIds } }
      : undefined,
    select: {
      questionId: true,
      contestId: true,
      contest: {
        select: {
          startTime: true,
          endTime: true,
          status: true,
        },
      },
    },
  });

  const usageByQuestion = new Map<string, ContestQuestionUsageEntry>();
  for (const question of contestQuestions) {
    const entry = usageByQuestion.get(question.questionId) || {
      contestIds: new Set<string>(),
      currentlyChoosedForContest: false,
    };

    entry.contestIds.add(question.contestId);

    if (getRuntimeContestStatus(question.contest.startTime, question.contest.endTime) !== ContestStatus.ENDED) {
      entry.currentlyChoosedForContest = true;
    }

    usageByQuestion.set(question.questionId, entry);
  }

  const targetQuestionIds = normalizedQuestionIds.length > 0
    ? normalizedQuestionIds
    : Array.from(new Set(contestQuestions.map((question) => question.questionId)));

  if (targetQuestionIds.length === 0) {
    return;
  }

  for (const modelName of QUESTION_MODEL_NAMES) {
    const Model = mongoose.model(modelName);

    await Model.updateMany(
      buildQuestionLookupQuery(targetQuestionIds),
      {
        $set: {
          currentlyChoosedForContest: false,
        },
      }
    );

    const bulkOperations = targetQuestionIds
      .map((questionId) => {
        const usage = usageByQuestion.get(questionId);
        if (!usage || usage.contestIds.size === 0) {
          return null;
        }

        return {
          updateOne: {
            filter: buildQuestionLookupQuery([questionId]),
            update: {
              $addToSet: {
                usedInContests: { $each: Array.from(usage.contestIds) },
              },
              $set: {
                isUsedInContest: true,
                currentlyChoosedForContest: usage.currentlyChoosedForContest,
              },
            },
          },
        };
      })
      .filter(Boolean);

    if (bulkOperations.length > 0) {
      await Model.bulkWrite(bulkOperations as any[], { ordered: false });
    }
  }

  const McqModel = mongoose.model(MCQ_QUESTION_MODEL_NAME);
  await McqModel.updateMany(
    buildQuestionLookupQuery(targetQuestionIds),
    {
      $set: {
        currentlyChoosedForContest: false,
      },
    }
  );

  const mcqBulkOperations = targetQuestionIds
    .map((questionId) => {
      const usage = usageByQuestion.get(questionId);
      if (!usage || usage.contestIds.size === 0) {
        return null;
      }

      return {
        updateOne: {
          filter: buildQuestionLookupQuery([questionId]),
          update: {
            $addToSet: {
              usedInContests: { $each: Array.from(usage.contestIds) },
            },
            $set: {
              isUsedInContest: true,
              currentlyChoosedForContest: usage.currentlyChoosedForContest,
            },
          },
        },
      };
    })
    .filter(Boolean);

  if (mcqBulkOperations.length > 0) {
    await McqModel.bulkWrite(mcqBulkOperations as any[], { ordered: false });
  }
}

async function getContestInstructions(contestId: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ instructions: string | null }>>(
    'SELECT instructions FROM contests WHERE id = $1 LIMIT 1',
    contestId
  );
  return normalizeContestInstructions(rows[0]?.instructions);
}

async function setContestInstructions(contestId: string, instructions: string) {
  await prisma.$executeRawUnsafe(
    'UPDATE contests SET instructions = $1, updated_at = NOW() WHERE id = $2',
    normalizeContestInstructions(instructions),
    contestId
  );
}

async function getContestShowDifficultyTags(contestId: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ show_difficulty_tags: boolean | null }>>(
    'SELECT show_difficulty_tags FROM contests WHERE id = $1 LIMIT 1',
    contestId
  );
  return rows[0]?.show_difficulty_tags !== false;
}

async function setContestShowDifficultyTags(contestId: string, showDifficultyTags: boolean) {
  await prisma.$executeRawUnsafe(
    'UPDATE contests SET show_difficulty_tags = $1, updated_at = NOW() WHERE id = $2',
    showDifficultyTags,
    contestId
  );
}

async function getContestShowParticipants(contestId: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ show_participants: boolean | null }>>(
    'SELECT show_participants FROM contests WHERE id = $1 LIMIT 1',
    contestId
  );
  return rows[0]?.show_participants === true;
}

async function setContestShowParticipants(contestId: string, showParticipants: boolean) {
  await prisma.$executeRawUnsafe(
    'UPDATE contests SET show_participants = $1, updated_at = NOW() WHERE id = $2',
    showParticipants,
    contestId
  );
}

function normalizeRoundFlow(value: unknown): ContestRoundSettings['roundFlow'] {
  if (value === 'mcq_only') return 'mcq_only';
  if (value === 'mcq_then_dsa') return 'mcq_then_dsa';
  return 'dsa_only';
}

async function getContestRoundSettings(contestId: string): Promise<ContestRoundSettings> {
  const rows = await prisma.$queryRawUnsafe<Array<{
    roundFlow: string | null;
    showScoreOnHub: boolean | null;
    mcqSequential: boolean | null;
  }>>(
    `SELECT
      round_flow AS "roundFlow",
      show_score_on_hub AS "showScoreOnHub",
      mcq_sequential AS "mcqSequential"
     FROM contests
     WHERE id = $1
     LIMIT 1`,
    contestId
  );

  const row = rows[0];
  return {
    roundFlow: normalizeRoundFlow(row?.roundFlow),
    showScoreOnHub: row?.showScoreOnHub !== false,
    mcqSequential: row?.mcqSequential === true,
  };
}

async function setContestRoundSettings(contestId: string, settings: Partial<ContestRoundSettings>) {
  await prisma.$executeRawUnsafe(
    `UPDATE contests
     SET
       round_flow = COALESCE($1, round_flow),
       show_score_on_hub = COALESCE($2, show_score_on_hub),
       mcq_sequential = COALESCE($3, mcq_sequential),
       updated_at = NOW()
     WHERE id = $4`,
    settings.roundFlow ?? null,
    settings.showScoreOnHub ?? null,
    settings.mcqSequential ?? null,
    contestId
  );
}

type ContestVisibilitySettings = {
  createdById: string | null;
  isArchived: boolean;
  isUnderTesting: boolean;
};

async function getContestVisibilitySettings(contestId: string): Promise<ContestVisibilitySettings | null> {
  const rows = await prisma.$queryRawUnsafe<Array<{
    createdById: string | null;
    isArchived: boolean | null;
    isUnderTesting: boolean | null;
  }>>(
    'SELECT created_by_id AS "createdById", is_archived AS "isArchived", is_under_testing AS "isUnderTesting" FROM contests WHERE id = $1 LIMIT 1',
    contestId
  );

  const row = rows[0];
  if (!row) return null;
  return {
    createdById: row.createdById,
    isArchived: row.isArchived === true,
    isUnderTesting: row.isUnderTesting === true,
  };
}

async function setContestCreatedBy(contestId: string, adminId: string) {
  await prisma.$executeRawUnsafe(
    'UPDATE contests SET created_by_id = $1, updated_at = NOW() WHERE id = $2',
    adminId,
    contestId
  );
}

async function setContestArchived(contestId: string, isArchived: boolean) {
  await prisma.$executeRawUnsafe(
    'UPDATE contests SET is_archived = $1, updated_at = NOW() WHERE id = $2',
    isArchived,
    contestId
  );
}

async function setContestUnderTesting(contestId: string, isUnderTesting: boolean) {
  await prisma.$executeRawUnsafe(
    'UPDATE contests SET is_under_testing = $1, updated_at = NOW() WHERE id = $2',
    isUnderTesting,
    contestId
  );
}

async function isUserInTestingAllowList(ownerId: string, userId: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    'SELECT id FROM contest_testing_testers WHERE owner_id = $1 AND tester_user_id = $2 LIMIT 1',
    ownerId,
    userId
  );
  return rows.length > 0;
}

async function isContestVisibleBySettings(settings: ContestVisibilitySettings, viewerId: string) {
  if (settings.isArchived) return false;
  if (!settings.isUnderTesting) return true;
  if (!settings.createdById) return false;
  return isUserInTestingAllowList(settings.createdById, viewerId);
}

export async function isContestVisibleToUser(contestId: string, viewerId: string) {
  const settings = await getContestVisibilitySettings(contestId);
  if (!settings) return false;
  return isContestVisibleBySettings(settings, viewerId);
}

async function getContestAdminSettings(contestId: string) {
  const [visibility, showParticipants, showDifficultyTags, instructions, roundSettings] = await Promise.all([
    getContestVisibilitySettings(contestId),
    getContestShowParticipants(contestId),
    getContestShowDifficultyTags(contestId),
    getContestInstructions(contestId),
    getContestRoundSettings(contestId),
  ]);

  return {
    instructions,
    showDifficultyTags,
    showParticipants,
    ...roundSettings,
    isArchived: visibility?.isArchived === true,
    isUnderTesting: visibility?.isUnderTesting === true,
    createdById: visibility?.createdById ?? null,
  };
}

export async function getAdminContestInstructionTemplate(adminId: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ contest_instruction_template: string | null }>>(
    'SELECT contest_instruction_template FROM users WHERE id = $1 LIMIT 1',
    adminId
  );
  return normalizeContestInstructions(rows[0]?.contest_instruction_template);
}

async function setAdminContestInstructionTemplate(adminId: string, instructions: string) {
  await prisma.$executeRawUnsafe(
    'UPDATE users SET contest_instruction_template = $1, updated_at = NOW() WHERE id = $2',
    normalizeContestInstructions(instructions),
    adminId
  );
}

type ContestTestingTesterUser = {
  id: string;
  fullName: string | null;
  email: string;
  username: string | null;
  createdAt?: Date;
};

export async function getContestTestingTesters(ownerId: string): Promise<ContestTestingTesterUser[]> {
  return prisma.$queryRawUnsafe<ContestTestingTesterUser[]>(
    `SELECT
      u.id,
      u.full_name AS "fullName",
      u.email,
      u.username,
      ctt.created_at AS "createdAt"
    FROM contest_testing_testers ctt
    INNER JOIN users u ON u.id = ctt.tester_user_id
    WHERE ctt.owner_id = $1
    ORDER BY ctt.created_at DESC`,
    ownerId
  );
}

export async function searchContestTestingUsers(ownerId: string, query: string, limit = 10) {
  const testers = await getContestTestingTesters(ownerId);
  const alreadyTesterIds = new Set(testers.map((tester) => tester.id));
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { email: { contains: query, mode: 'insensitive' } },
        { fullName: { contains: query, mode: 'insensitive' } },
        { username: { contains: query, mode: 'insensitive' } },
      ],
    },
    select: {
      id: true,
      fullName: true,
      email: true,
      username: true,
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return users.map((user) => ({
    ...user,
    isTester: alreadyTesterIds.has(user.id),
  }));
}

export async function addContestTestingTester(ownerId: string, testerUserId: string) {
  const user = await prisma.user.findUnique({
    where: { id: testerUserId },
    select: {
      id: true,
      fullName: true,
      email: true,
      username: true,
    },
  });

  if (!user) {
    throw new Error('User not found');
  }

  await prisma.$executeRawUnsafe(
    `INSERT INTO contest_testing_testers (id, owner_id, tester_user_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (owner_id, tester_user_id) DO NOTHING`,
    randomUUID(),
    ownerId,
    testerUserId
  );

  return user;
}

export async function removeContestTestingTester(ownerId: string, testerUserId: string) {
  await prisma.$executeRawUnsafe(
    'DELETE FROM contest_testing_testers WHERE owner_id = $1 AND tester_user_id = $2',
    ownerId,
    testerUserId
  );
  return { success: true };
}

/**
 * Fetch questions from MongoDB
 * Searches across all question model types
 */
async function fetchQuestionsFromMongoDB(questionIds: string[]): Promise<any[]> {
  const allQuestions: any[] = [];
  const seenQuestionIds = new Set<string>();
  const query = buildQuestionLookupQuery(questionIds);

  for (const modelName of QUESTION_MODEL_NAMES) {
    const Model = mongoose.model(modelName);
    
    const questions = await Model.find(query)
      .select('_id problemId frontendId problemSlug title difficulty description examples constraints sampleTestCases codeSnippets topics hints usedInContests isUsedInContest currentlyChoosedForContest')
      .lean<any[]>();

    for (const q of questions) {
      const linkedQuestionId = matchesQuestionIdentifier(questionIds, q) ?? q._id.toString();
      if (seenQuestionIds.has(linkedQuestionId)) continue;
      seenQuestionIds.add(linkedQuestionId);

      allQuestions.push({
        id: linkedQuestionId,
        title: q.title,
        difficulty: q.difficulty,
        description: q.description,
        examples: q.examples,
        constraints: q.constraints,
        sampleTestCases: q.sampleTestCases,
        codeSnippets: q.codeSnippets,
        topics: q.topics,
        hints: q.hints,
        type: modelName,
      });
    }
  }

  return allQuestions;
}

async function fetchMcqQuestionsFromMongoDB(questionIds: string[]): Promise<any[]> {
  const allQuestions: any[] = [];
  const seenQuestionIds = new Set<string>();
  const query = buildQuestionLookupQuery(questionIds);
  const Model = mongoose.model(MCQ_QUESTION_MODEL_NAME);

  const questions = await Model.find(query)
    .select('_id problemId frontendId problemSlug title difficulty questionText statement topics companyTags options points usedInContests isUsedInContest currentlyChoosedForContest')
    .lean<any[]>();

  for (const q of questions) {
    const linkedQuestionId = matchesQuestionIdentifier(questionIds, q) ?? q._id.toString();
    if (seenQuestionIds.has(linkedQuestionId)) continue;
    seenQuestionIds.add(linkedQuestionId);

    allQuestions.push({
      id: linkedQuestionId,
      title: q.title,
      difficulty: q.difficulty,
      questionText: q.questionText || q.statement || '',
      topics: q.topics || [],
      companyTags: q.companyTags || [],
      options: Array.isArray(q.options) ? q.options : [],
      points: q.points,
      problemId: q.problemId,
      frontendId: q.frontendId,
      problemSlug: q.problemSlug,
      usedInContests: q.usedInContests || [],
      isUsedInContest: Boolean(q.isUsedInContest),
      currentlyChoosedForContest: Boolean(q.currentlyChoosedForContest),
      type: MCQ_QUESTION_MODEL_NAME,
      questionType: 'mcq',
    });
  }

  return allQuestions;
}

async function fetchQuestionsByInputs(questionInputs: ContestQuestionInput[]): Promise<any[]> {
  const dsaQuestionIds = questionInputs
    .filter((question) => question.questionType === 'dsa')
    .map((question) => question.questionId);
  const mcqQuestionIds = questionInputs
    .filter((question) => question.questionType === 'mcq')
    .map((question) => question.questionId);

  const [dsaQuestions, mcqQuestions] = await Promise.all([
    dsaQuestionIds.length ? fetchQuestionsFromMongoDB(dsaQuestionIds) : Promise.resolve([]),
    mcqQuestionIds.length ? fetchMcqQuestionsFromMongoDB(mcqQuestionIds) : Promise.resolve([]),
  ]);

  return [
    ...dsaQuestions.map((question) => ({ ...question, questionType: 'dsa', phase: 'dsa' })),
    ...mcqQuestions.map((question) => ({ ...question, questionType: 'mcq', phase: 'mcq' })),
  ];
}

function questionLookupKey(questionType: 'dsa' | 'mcq', questionId: string) {
  return `${questionType}:${questionId}`;
}

async function insertContestQuestionRows(
  rows: Array<Omit<ContestQuestionSelectionRow, 'id'>>,
  db: { $executeRawUnsafe: (...args: any[]) => Promise<any> } = prisma
) {
  for (const row of rows) {
    await db.$executeRawUnsafe(
      `INSERT INTO contest_questions
        (id, contest_id, question_id, question_type, phase, difficulty, points, negative_points, negative_cap, "order", phase_order)
       VALUES
        ($1, $2, $3, $4, $5, $6::"Difficulty", $7, $8, $9, $10, $11)
       ON CONFLICT (contest_id, question_id)
       DO UPDATE SET
        question_type = EXCLUDED.question_type,
        phase = EXCLUDED.phase,
        difficulty = EXCLUDED.difficulty,
        points = EXCLUDED.points,
        negative_points = EXCLUDED.negative_points,
        negative_cap = EXCLUDED.negative_cap,
        "order" = EXCLUDED."order",
        phase_order = EXCLUDED.phase_order`,
      randomUUID(),
      row.contestId,
      row.questionId,
      row.questionType,
      row.phase,
      row.difficulty,
      row.points,
      row.negativePoints,
      row.negativeCap,
      row.order,
      row.phaseOrder
    );
  }
}

async function getContestQuestionSelectionRows(contestId: string): Promise<ContestQuestionSelectionRow[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{
    id: string;
    contestId: string;
    questionId: string;
    questionType: string | null;
    phase: string | null;
    difficulty: string;
    points: number;
    negativePoints: number;
    negativeCap: number;
    order: number;
    phaseOrder: number | null;
  }>>(
    `SELECT
      id,
      contest_id AS "contestId",
      question_id AS "questionId",
      COALESCE(question_type, 'dsa') AS "questionType",
      COALESCE(phase, 'dsa') AS "phase",
      difficulty::text AS difficulty,
      points,
      negative_points AS "negativePoints",
      negative_cap AS "negativeCap",
      "order",
      COALESCE(phase_order, "order", 0) AS "phaseOrder"
     FROM contest_questions
     WHERE contest_id = $1
     ORDER BY "order" ASC`,
    contestId
  );

  return rows.map((row) => {
    const questionType = normalizeQuestionType(row.questionType);
    return {
      ...row,
      questionType,
      phase: normalizePhase(row.phase, questionType),
      phaseOrder: row.phaseOrder ?? row.order ?? 0,
    };
  });
}

async function countContestMcqAnswers(contestId: string, questionIds?: string[]) {
  if (questionIds && questionIds.length > 0) {
    const rows = await prisma.$queryRawUnsafe<Array<{ count: string | number }>>(
      `SELECT COUNT(*)::text AS count
       FROM contest_mcq_answers
       WHERE contest_id = $1
         AND question_id = ANY($2::text[])`,
      contestId,
      questionIds
    );
    return Number(rows[0]?.count || 0);
  }

  const rows = await prisma.$queryRawUnsafe<Array<{ count: string | number }>>(
    `SELECT COUNT(*)::text AS count
     FROM contest_mcq_answers
     WHERE contest_id = $1`,
    contestId
  );
  return Number(rows[0]?.count || 0);
}

/**
 * Create a new contest
 * Admin only operation
 */
export async function createContest(data: CreateContestRequest, adminId?: string) {
  const {
    title,
    description,
    startTime,
    endTime,
    instructions,
    showDifficultyTags,
    showParticipants,
    isUnderTesting,
    roundFlow,
    showScoreOnHub,
    mcqSequential,
  } = data;
  const questionInputs = normalizeQuestionInputs(data);
  const normalizedRoundFlow = normalizeRoundFlow(roundFlow);
  validateContestRoundFlow(normalizedRoundFlow, questionInputs);
  const contestInstructions = normalizeContestInstructions(instructions);

  // Fetch questions from MongoDB first so invalid IDs do not create orphan contests.
  const questions = await fetchQuestionsByInputs(questionInputs);
  const foundQuestionIds = new Set(questions.map((question) => questionLookupKey(question.questionType, question.id)));
  const missingQuestionIds = questionInputs
    .filter((question) => !foundQuestionIds.has(questionLookupKey(question.questionType, question.questionId)))
    .map((question) => question.questionId);
  if (missingQuestionIds.length > 0) {
    throw new Error(`Questions not found: ${missingQuestionIds.join(', ')}`);
  }

  // Determine initial status based on start time
  const now = new Date();
  const start = new Date(startTime);
  const status = start > now ? ContestStatus.UPCOMING : ContestStatus.ACTIVE;

  // Create contest in PostgreSQL
  const contest = await prisma.contest.create({
    data: {
      title,
      description,
      startTime: start,
      endTime: new Date(endTime),
      status,
    },
  });

  await setContestInstructions(contest.id, contestInstructions);
  await setContestShowDifficultyTags(contest.id, showDifficultyTags !== false);
  await setContestShowParticipants(contest.id, showParticipants === true);
  await setContestUnderTesting(contest.id, isUnderTesting === true);
  await setContestRoundSettings(contest.id, {
    roundFlow: normalizedRoundFlow,
    showScoreOnHub: showScoreOnHub !== false,
    mcqSequential: mcqSequential === true,
  });
  if (adminId) {
    await setContestCreatedBy(contest.id, adminId);
    await setAdminContestInstructionTemplate(adminId, contestInstructions);
  }

  // Create contest questions with difficulty and points
  const phaseOrders: Record<'dsa' | 'mcq', number> = { dsa: 0, mcq: 0 };
  const contestQuestions = questionInputs.map((questionInput, index) => {
    const question = questions.find((q) => (
      q.id === questionInput.questionId &&
      q.questionType === questionInput.questionType
    ));
    const difficulty = normalizeDifficulty(question?.difficulty);
    const phaseOrder = phaseOrders[questionInput.phase]++;

    return {
      contestId: contest.id,
      questionId: questionInput.questionId,
      questionType: questionInput.questionType,
      phase: questionInput.phase,
      difficulty,
      points: questionInput.points ?? (questionInput.questionType === 'mcq' ? normalizeNonNegativeInt(question?.points || 1) || 1 : pointsForDifficulty(difficulty)),
      negativePoints: questionInput.negativePoints ?? 0,
      negativeCap: questionInput.negativeCap ?? questionInput.negativePoints ?? 0,
      order: index,
      phaseOrder,
    };
  });

  await insertContestQuestionRows(contestQuestions);

  // Mark questions as used in MongoDB
  await markQuestionInputsAsUsed(questionInputs, contest.id);

  return {
    ...contest,
    instructions: contestInstructions,
    showDifficultyTags: showDifficultyTags !== false,
    showParticipants: showParticipants === true,
    roundFlow: normalizedRoundFlow,
    showScoreOnHub: showScoreOnHub !== false,
    mcqSequential: mcqSequential === true,
    isArchived: false,
    isUnderTesting: isUnderTesting === true,
    createdById: adminId ?? null,
  };
}

/**
 * Get all contests with optional filtering
 */
type GetContestsOptions = {
  viewerId?: string;
  includeHidden?: boolean;
};

export async function getContests(
  status?: ContestStatus,
  limit = 50,
  offset = 0,
  options: GetContestsOptions = {}
) {
  await refreshContestStatuses();

  const where: Record<string, unknown> = status ? { status } : {};
  if (!options.includeHidden) {
    where.isArchived = false;
  }
  const take = options.includeHidden ? limit : Math.max(limit + offset, limit);
  const skip = options.includeHidden ? offset : 0;

  const [contests, unfilteredTotal] = await Promise.all([
    prisma.contest.findMany({
      where,
      include: {
        _count: {
          select: {
            questions: true,
            participants: true,
          },
        },
      },
      orderBy: { startTime: 'desc' },
      take,
      skip,
    }),
    prisma.contest.count({ where }),
  ]);

  const contestsWithSettings = await Promise.all(
    contests.map(async (contest) => {
      const settings = await getContestAdminSettings(contest.id);
      return {
        ...contest,
        ...settings,
      };
    })
  );

  const visibleContests = options.includeHidden || !options.viewerId
    ? contestsWithSettings
    : (await Promise.all(
        contestsWithSettings.map(async (contest) => ({
          contest,
          visible: await isContestVisibleBySettings(
            {
              createdById: contest.createdById,
              isArchived: contest.isArchived,
              isUnderTesting: contest.isUnderTesting,
            },
            options.viewerId!
          ),
        }))
      ))
        .filter((entry) => entry.visible)
        .map((entry) => entry.contest);

  const pagedContests = options.includeHidden ? visibleContests : visibleContests.slice(offset, offset + limit);

  return {
    contests: pagedContests.map(withRuntimeStatus),
    total: options.includeHidden ? unfilteredTotal : visibleContests.length,
    limit,
    offset,
  };
}

/**
 * Get contest by ID
 */
export async function getContestById(
  contestId: string,
  viewerId?: string,
  options: { includeHidden?: boolean } = {}
) {
  await refreshContestStatuses();

  const contest = await prisma.contest.findUnique({
    where: { id: contestId },
    include: {
      _count: {
        select: {
          questions: true,
          participants: true,
        },
      },
    },
  });

  if (!contest) {
    throw new Error('Contest not found');
  }

  const settings = await getContestAdminSettings(contestId);
  if (!options.includeHidden && viewerId) {
    const visible = await isContestVisibleBySettings(
      {
        createdById: settings.createdById,
        isArchived: settings.isArchived,
        isUnderTesting: settings.isUnderTesting,
      },
      viewerId
    );
    if (!visible) {
      throw new Error('Contest not found');
    }
  }

  return withRuntimeStatus({ ...contest, ...settings });
}

export async function getManagedContestById(contestId: string) {
  await refreshContestStatuses();

  const contest = await prisma.contest.findUnique({
    where: { id: contestId },
    include: {
      _count: {
        select: {
          questions: true,
          participants: true,
        },
      },
    },
  });

  if (!contest) {
    throw new Error('Contest not found');
  }

  const contestQuestions = await getContestQuestionSelectionRows(contestId);
  const mongoQuestions = contestQuestions.length ? await fetchQuestionsByInputs(contestQuestions) : [];
  const mongoById = new Map(mongoQuestions.map((question) => [questionLookupKey(question.questionType, question.id), question]));
  const settings = await getContestAdminSettings(contestId);
  const wrongPenalty = contestQuestions.find((question) => question.negativePoints > 0)?.negativePoints ?? 0;

  const questions = contestQuestions.map((contestQuestion) => {
    const mongoQuestion = mongoById.get(questionLookupKey(contestQuestion.questionType, contestQuestion.questionId));
    const difficulty = normalizeDifficulty(contestQuestion.difficulty || mongoQuestion?.difficulty);

    return {
      id: contestQuestion.id,
      questionId: contestQuestion.questionId,
      questionType: contestQuestion.questionType,
      phase: contestQuestion.phase,
      title: mongoQuestion?.title || 'Question unavailable',
      problemId: mongoQuestion?.problemId,
      frontendId: mongoQuestion?.frontendId,
      problemSlug: mongoQuestion?.problemSlug,
      questionText: mongoQuestion?.questionText,
      optionCount: Array.isArray(mongoQuestion?.options) ? mongoQuestion.options.length : undefined,
      topics: mongoQuestion?.topics || [],
      usedInContests: mongoQuestion?.usedInContests || [],
      isUsedInContest: Boolean(mongoQuestion?.isUsedInContest),
      currentlyChoosedForContest: Boolean(mongoQuestion?.currentlyChoosedForContest),
      type: mongoQuestion?.type,
      difficulty,
      points: contestQuestion.points,
      negativePoints: contestQuestion.negativePoints,
      negativeCap: contestQuestion.negativeCap,
      order: contestQuestion.order,
      phaseOrder: contestQuestion.phaseOrder,
    };
  });

  return withRuntimeStatus({
    ...contest,
    ...settings,
    wrongPenalty,
    questions,
  });
}

export async function updateManagedContest(contestId: string, data: UpdateManagedContestRequest) {
  const contest = await prisma.contest.findUnique({
    where: { id: contestId },
  });

  if (!contest) {
    throw new Error('Contest not found');
  }

  const currentQuestions = await getContestQuestionSelectionRows(contestId);
  const nextStatus = data.status ?? contest.status;
  const questionInputs = data.questions
    ? normalizeQuestionInputs({ questions: data.questions, wrongPenalty: data.wrongPenalty })
    : [];
  const nextQuestionIds = questionInputs.map((question) => question.questionId);
  const nextQuestionKeys = questionInputs.map((question) => questionLookupKey(question.questionType, question.questionId));
  const removedQuestions = data.questions
    ? currentQuestions.filter((question) => !nextQuestionKeys.includes(questionLookupKey(question.questionType, question.questionId)))
    : [];
  const removedQuestionIds = removedQuestions.map((question) => question.questionId);
  if (data.questions || data.roundFlow !== undefined) {
    const currentRoundSettings = await getContestRoundSettings(contestId);
    const effectiveQuestions = data.questions ? questionInputs : currentQuestions;
    validateContestRoundFlow(normalizeRoundFlow(data.roundFlow ?? currentRoundSettings.roundFlow), effectiveQuestions);
  }

  if (data.questions && nextQuestionIds.length === 0) {
    throw new Error('Select at least one question');
  }

  if (data.questions) {
    const currentByQuestionKey = new Map(currentQuestions.map((question) => [
      questionLookupKey(question.questionType, question.questionId),
      question,
    ]));
    const phaseOrders: Record<'dsa' | 'mcq', number> = { dsa: 0, mcq: 0 };
    const questionConfigChanged =
      questionInputs.length !== currentQuestions.length ||
      questionInputs.some((questionInput, index) => {
        const currentQuestion = currentByQuestionKey.get(questionLookupKey(questionInput.questionType, questionInput.questionId));
        const phaseOrder = phaseOrders[questionInput.phase]++;
        return (
          !currentQuestion ||
          currentQuestion.order !== index ||
          currentQuestion.phaseOrder !== phaseOrder ||
          currentQuestion.questionType !== questionInput.questionType ||
          currentQuestion.phase !== questionInput.phase ||
          currentQuestion.points !== Number(questionInput.points || 0) ||
          currentQuestion.negativePoints !== Number(questionInput.negativePoints || 0) ||
          currentQuestion.negativeCap !== Number(questionInput.negativeCap || 0)
        );
      });

    if (questionConfigChanged) {
      const [submissionCount, mcqAnswerCount] = await Promise.all([
        prisma.contestSubmission.count({
          where: { contestId },
        }),
        countContestMcqAnswers(contestId),
      ]);

      if (submissionCount > 0 || mcqAnswerCount > 0) {
        throw new Error('Cannot change question selection or scoring after submissions exist');
      }
    }
  }

  if (removedQuestionIds.length > 0) {
    const [submissionCount, mcqAnswerCount] = await Promise.all([
      prisma.contestSubmission.count({
        where: {
          contestId,
          questionId: {
            in: removedQuestionIds,
          },
        },
      }),
      countContestMcqAnswers(contestId, removedQuestionIds),
    ]);

    if (submissionCount > 0 || mcqAnswerCount > 0) {
      throw new Error('Cannot remove questions that already have submissions');
    }
  }

  let questionsById = new Map<string, any>();
  if (data.questions) {
    const questions = await fetchQuestionsByInputs(questionInputs);
    questionsById = new Map(questions.map((question) => [questionLookupKey(question.questionType, question.id), question]));
    const missingQuestionIds = questionInputs
      .filter((question) => !questionsById.has(questionLookupKey(question.questionType, question.questionId)))
      .map((question) => question.questionId);

    if (missingQuestionIds.length > 0) {
      throw new Error(`Questions not found: ${missingQuestionIds.join(', ')}`);
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.contest.update({
      where: { id: contestId },
      data: {
        ...(data.title !== undefined && { title: data.title }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.startTime !== undefined && { startTime: new Date(data.startTime) }),
        ...(data.endTime !== undefined && { endTime: new Date(data.endTime) }),
        ...(data.status !== undefined && { status: data.status }),
      },
    });

    if (removedQuestionIds.length > 0) {
      await tx.contestQuestion.deleteMany({
        where: {
          contestId,
          questionId: {
            in: removedQuestionIds,
          },
        },
      });
    }

    if (data.questions) {
      const phaseOrders: Record<'dsa' | 'mcq', number> = { dsa: 0, mcq: 0 };
      const rows: Array<Omit<ContestQuestionSelectionRow, 'id'>> = [];
      for (const [index, questionInput] of questionInputs.entries()) {
        const mongoQuestion = questionsById.get(questionLookupKey(questionInput.questionType, questionInput.questionId));
        const difficulty = normalizeDifficulty(mongoQuestion?.difficulty);
        const phaseOrder = phaseOrders[questionInput.phase]++;

        rows.push({
          contestId,
          questionId: questionInput.questionId,
          questionType: questionInput.questionType,
          phase: questionInput.phase,
          difficulty,
          points: questionInput.points ?? (questionInput.questionType === 'mcq' ? normalizeNonNegativeInt(mongoQuestion?.points || 1) || 1 : pointsForDifficulty(difficulty)),
          negativePoints: questionInput.negativePoints ?? 0,
          negativeCap: questionInput.negativeCap ?? questionInput.negativePoints ?? 0,
          order: index,
          phaseOrder,
        });
      }
      await insertContestQuestionRows(rows, tx);
    } else if (data.wrongPenalty !== undefined) {
      const normalizedPenalty = normalizeNonNegativeInt(data.wrongPenalty);
      await tx.contestQuestion.updateMany({
        where: { contestId },
        data: {
          negativePoints: normalizedPenalty,
          negativeCap: normalizedPenalty > 0 ? normalizedPenalty : 0,
        },
      });
    }
  });

  if (data.instructions !== undefined) {
    await setContestInstructions(contestId, data.instructions);
  }

  if (data.showDifficultyTags !== undefined) {
    await setContestShowDifficultyTags(contestId, data.showDifficultyTags);
  }

  if (data.showParticipants !== undefined) {
    await setContestShowParticipants(contestId, data.showParticipants);
  }

  if (
    data.roundFlow !== undefined ||
    data.showScoreOnHub !== undefined ||
    data.mcqSequential !== undefined
  ) {
    await setContestRoundSettings(contestId, {
      roundFlow: data.roundFlow,
      showScoreOnHub: data.showScoreOnHub,
      mcqSequential: data.mcqSequential,
    });
  }

  if (data.isUnderTesting !== undefined) {
    await setContestUnderTesting(contestId, data.isUnderTesting);
  }

  if (data.isArchived !== undefined) {
    await setContestArchived(contestId, data.isArchived);
  }

  if (data.isUnderTesting !== undefined) {
    await setContestUnderTesting(contestId, data.isUnderTesting);
  }

  if (data.isArchived !== undefined) {
    await setContestArchived(contestId, data.isArchived);
  }

  if (removedQuestionIds.length > 0) {
    await unmarkQuestionsAsUsed(removedQuestionIds, contestId);
  }

  if (data.questions) {
    if (nextStatus === ContestStatus.ENDED) {
      await releaseQuestionInputsFromActiveContest(questionInputs);
    } else {
      await markQuestionInputsAsUsed(questionInputs, contestId);
    }
  }

  if (nextStatus === ContestStatus.ENDED && contest.status !== ContestStatus.ENDED) {
    await clampNegativeContestScores(contestId);
  }

  await safeRedisDel(CacheKeys.contestDetails(contestId));
  await invalidateContestQuestionCaches(contestId);
  await safeRedisDel(
    CacheKeys.contestLeaderboard(contestId),
    CacheKeys.generatedContestLeaderboard(contestId)
  );

  return getManagedContestById(contestId);
}

/**
 * Update contest
 * Admin only operation
 */
export async function updateContest(contestId: string, data: UpdateContestRequest) {
  const contest = await prisma.contest.findUnique({
    where: { id: contestId },
    include: {
      questions: true,
    },
  });

  if (!contest) {
    throw new Error('Contest not found');
  }

  if (data.roundFlow !== undefined) {
    const currentQuestions = await getContestQuestionSelectionRows(contestId);
    validateContestRoundFlow(normalizeRoundFlow(data.roundFlow), currentQuestions);
  }

  const contestUpdateData = {
    ...(data.title && { title: data.title }),
    ...(data.description && { description: data.description }),
    ...(data.startTime && { startTime: new Date(data.startTime) }),
    ...(data.endTime && { endTime: new Date(data.endTime) }),
    ...(data.status && { status: data.status }),
  };
  const updated = Object.keys(contestUpdateData).length > 0
    ? await prisma.contest.update({
        where: { id: contestId },
        data: contestUpdateData,
      })
    : contest;

  if (data.instructions !== undefined) {
    await setContestInstructions(contestId, data.instructions);
  }

  if (data.showDifficultyTags !== undefined) {
    await setContestShowDifficultyTags(contestId, data.showDifficultyTags);
  }

  if (data.showParticipants !== undefined) {
    await setContestShowParticipants(contestId, data.showParticipants);
  }

  if (
    data.roundFlow !== undefined ||
    data.showScoreOnHub !== undefined ||
    data.mcqSequential !== undefined
  ) {
    await setContestRoundSettings(contestId, {
      roundFlow: data.roundFlow,
      showScoreOnHub: data.showScoreOnHub,
      mcqSequential: data.mcqSequential,
    });
  }

  if (data.isUnderTesting !== undefined) {
    await setContestUnderTesting(contestId, data.isUnderTesting);
  }

  if (data.isArchived !== undefined) {
    await setContestArchived(contestId, data.isArchived);
  }

  const questionIds = contest.questions.map((q) => q.questionId);
  if (data.status === ContestStatus.ENDED && contest.status !== ContestStatus.ENDED) {
    await clampNegativeContestScores(contestId);
    await releaseQuestionsFromActiveContest(questionIds);
  } else if (
    data.status &&
    data.status !== ContestStatus.ENDED &&
    contest.status === ContestStatus.ENDED
  ) {
    await markQuestionsAsUsed(questionIds, contestId);
  }

  // Invalidate cache
  await safeRedisDel(CacheKeys.contestDetails(contestId));
  await invalidateContestQuestionCaches(contestId);

  const [instructions, showDifficultyTags, showParticipants, visibility, roundSettings] = await Promise.all([
    data.instructions !== undefined
      ? Promise.resolve(normalizeContestInstructions(data.instructions))
      : getContestInstructions(contestId),
    data.showDifficultyTags !== undefined
      ? Promise.resolve(data.showDifficultyTags)
      : getContestShowDifficultyTags(contestId),
    data.showParticipants !== undefined
      ? Promise.resolve(data.showParticipants)
      : getContestShowParticipants(contestId),
    getContestVisibilitySettings(contestId),
    getContestRoundSettings(contestId),
  ]);

  return {
    ...updated,
    instructions,
    showDifficultyTags,
    showParticipants,
    ...roundSettings,
    isArchived: visibility?.isArchived === true,
    isUnderTesting: visibility?.isUnderTesting === true,
    createdById: visibility?.createdById ?? null,
  };
}

/**
 * Add questions to an existing contest.
 * Admin only operation.
 */
export async function addQuestionsToContest(
  contestId: string,
  input: string[] | { questionIds?: string[]; questions?: ContestQuestionInputPayload[] }
) {
  const contest = await prisma.contest.findUnique({
    where: { id: contestId },
  });

  if (!contest) {
    throw new Error('Contest not found');
  }

  const currentQuestions = await getContestQuestionSelectionRows(contestId);
  const contestWrongPenalty = currentQuestions.find((question) => question.negativePoints > 0)?.negativePoints ?? 0;
  const questionInputs = Array.isArray(input)
    ? normalizeQuestionInputs({ questionIds: input }, contestWrongPenalty)
    : normalizeQuestionInputs(input, contestWrongPenalty);
  const questionIds = questionInputs.map((question) => question.questionId);

  const existingQuestionKeys = new Set(currentQuestions.map((question) => questionLookupKey(question.questionType, question.questionId)));
  const uniqueQuestionInputs = questionInputs.filter((question) => !existingQuestionKeys.has(questionLookupKey(question.questionType, question.questionId)));
  const uniqueQuestionIds = uniqueQuestionInputs.map((question) => question.questionId);

  if (uniqueQuestionIds.length === 0) {
    return {
      contest: await getContestById(contestId),
      addedCount: 0,
      skippedCount: questionIds.length,
    };
  }

  const questions = await fetchQuestionsByInputs(uniqueQuestionInputs);
  const foundQuestionIds = new Set(questions.map((question) => questionLookupKey(question.questionType, question.id)));
  const missingQuestionIds = uniqueQuestionInputs
    .filter((question) => !foundQuestionIds.has(questionLookupKey(question.questionType, question.questionId)))
    .map((question) => question.questionId);
  if (missingQuestionIds.length > 0) {
    throw new Error(`Questions not found: ${missingQuestionIds.join(', ')}`);
  }

  const maxOrder = currentQuestions.reduce((max, question) => Math.max(max, question.order), -1);
  const maxPhaseOrder: Record<'dsa' | 'mcq', number> = {
    dsa: currentQuestions
      .filter((question) => question.phase === 'dsa')
      .reduce((max, question) => Math.max(max, question.phaseOrder), -1),
    mcq: currentQuestions
      .filter((question) => question.phase === 'mcq')
      .reduce((max, question) => Math.max(max, question.phaseOrder), -1),
  };
  const contestQuestions = uniqueQuestionInputs.map((questionInput, index) => {
    const question = questions.find((item) => item.id === questionInput.questionId && item.questionType === questionInput.questionType);
    const difficulty = normalizeDifficulty(question?.difficulty);
    const phaseOrder = maxPhaseOrder[questionInput.phase] + 1;
    maxPhaseOrder[questionInput.phase] = phaseOrder;
    return {
      contestId,
      questionId: questionInput.questionId,
      questionType: questionInput.questionType,
      phase: questionInput.phase,
      difficulty,
      points: questionInput.points ?? (questionInput.questionType === 'mcq' ? normalizeNonNegativeInt(question?.points || 1) || 1 : pointsForDifficulty(difficulty)),
      negativePoints: questionInput.negativePoints ?? 0,
      negativeCap: questionInput.negativeCap ?? questionInput.negativePoints ?? 0,
      order: maxOrder + index + 1,
      phaseOrder,
    };
  });

  await insertContestQuestionRows(contestQuestions);

  await markQuestionInputsAsUsed(uniqueQuestionInputs, contestId);

  await safeRedisDel(CacheKeys.contestDetails(contestId));
  await invalidateContestQuestionCaches(contestId);
  await safeRedisDel(
    CacheKeys.contestLeaderboard(contestId),
    CacheKeys.generatedContestLeaderboard(contestId)
  );

  return {
    contest: await getContestById(contestId),
    addedCount: uniqueQuestionIds.length,
    skippedCount: questionIds.length - uniqueQuestionIds.length,
  };
}

/**
 * Delete contest
 * Admin only operation
 */
export async function deleteContest(contestId: string) {
  const contest = await prisma.contest.findUnique({
    where: { id: contestId },
    include: {
      questions: true,
    },
  });

  if (!contest) {
    throw new Error('Contest not found');
  }

  // Get question IDs before deletion
  const questionIds = contest.questions.map((q) => q.questionId);

  // Delete contest (cascade will delete questions, participants, submissions)
  await prisma.contest.delete({
    where: { id: contestId },
  });

  // Unmark questions as used in MongoDB
  await unmarkQuestionsAsUsed(questionIds, contestId);

  // Invalidate cache
  await safeRedisDel(CacheKeys.contestDetails(contestId));
  await invalidateContestQuestionCaches(contestId);
  await safeRedisDel(CacheKeys.contestLeaderboard(contestId));

  return { success: true };
}

/**
 * Mark questions as used in MongoDB
 * Updates all question models (DSAQuestion, DSSQLQuestion, etc.)
 */
export async function markQuestionsAsUsed(questionIds: string[], contestId: string) {
  // Update each model
  for (const modelName of QUESTION_MODEL_NAMES) {
    const Model = mongoose.model(modelName);
    await Model.updateMany(
      buildQuestionLookupQuery(questionIds),
      {
        $addToSet: { usedInContests: contestId },
        $set: {
          isUsedInContest: true,
          currentlyChoosedForContest: true,
        },
      }
    );
  }

  const McqModel = mongoose.model(MCQ_QUESTION_MODEL_NAME);
  await McqModel.updateMany(
    buildQuestionLookupQuery(questionIds),
    {
      $addToSet: { usedInContests: contestId },
      $set: {
        isUsedInContest: true,
        currentlyChoosedForContest: true,
      },
    }
  );
}

async function markQuestionInputsAsUsed(questionInputs: ContestQuestionInput[], contestId: string) {
  const dsaQuestionIds = questionInputs
    .filter((question) => question.questionType === 'dsa')
    .map((question) => question.questionId);
  const mcqQuestionIds = questionInputs
    .filter((question) => question.questionType === 'mcq')
    .map((question) => question.questionId);

  if (dsaQuestionIds.length > 0) {
    for (const modelName of QUESTION_MODEL_NAMES) {
      const Model = mongoose.model(modelName);
      await Model.updateMany(
        buildQuestionLookupQuery(dsaQuestionIds),
        {
          $addToSet: { usedInContests: contestId },
          $set: {
            isUsedInContest: true,
            currentlyChoosedForContest: true,
          },
        }
      );
    }
  }

  if (mcqQuestionIds.length > 0) {
    const Model = mongoose.model(MCQ_QUESTION_MODEL_NAME);
    await Model.updateMany(
      buildQuestionLookupQuery(mcqQuestionIds),
      {
        $addToSet: { usedInContests: contestId },
        $set: {
          isUsedInContest: true,
          currentlyChoosedForContest: true,
        },
      }
    );
  }
}

/**
 * Clears only the active-contest flag after a contest ends.
 * Historical usage remains in usedInContests/isUsedInContest so future banks can show Used.
 */
export async function releaseQuestionsFromActiveContest(questionIds: string[]) {
  for (const modelName of QUESTION_MODEL_NAMES) {
    const Model = mongoose.model(modelName);
    await Model.updateMany(
      buildQuestionLookupQuery(questionIds),
      {
        $set: {
          currentlyChoosedForContest: false,
        },
      }
    );
  }

  const McqModel = mongoose.model(MCQ_QUESTION_MODEL_NAME);
  await McqModel.updateMany(
    buildQuestionLookupQuery(questionIds),
    {
      $set: {
        currentlyChoosedForContest: false,
      },
    }
  );
}

async function releaseQuestionInputsFromActiveContest(questionInputs: ContestQuestionInput[]) {
  const dsaQuestionIds = questionInputs
    .filter((question) => question.questionType === 'dsa')
    .map((question) => question.questionId);
  const mcqQuestionIds = questionInputs
    .filter((question) => question.questionType === 'mcq')
    .map((question) => question.questionId);

  if (dsaQuestionIds.length > 0) {
    for (const modelName of QUESTION_MODEL_NAMES) {
      const Model = mongoose.model(modelName);
      await Model.updateMany(
        buildQuestionLookupQuery(dsaQuestionIds),
        {
          $set: {
            currentlyChoosedForContest: false,
          },
        }
      );
    }
  }

  if (mcqQuestionIds.length > 0) {
    const Model = mongoose.model(MCQ_QUESTION_MODEL_NAME);
    await Model.updateMany(
      buildQuestionLookupQuery(mcqQuestionIds),
      {
        $set: {
          currentlyChoosedForContest: false,
        },
      }
    );
  }
}

/**
 * Clears the active-contest lock without erasing historical usage.
 * Historical usage stays sticky intentionally so the question bank can continue
 * showing that a question has already been used in a contest.
 */
export async function unmarkQuestionsAsUsed(questionIds: string[], contestId: string) {
  void contestId;
  await releaseQuestionsFromActiveContest(questionIds);
}

/**
 * Get unused questions from MongoDB
 * Admin only operation
 */
export async function getUnusedQuestions(
  difficulty?: string,
  topic?: string,
  used: 'all' | 'used' | 'unused' = 'unused',
  limit = 50,
  offset = 0
) {
  await reconcileContestQuestionUsage();
  const allQuestions: any[] = [];

  for (const modelName of QUESTION_MODEL_NAMES) {
    const Model = mongoose.model(modelName);
    
    const query: any = {};

    if (used === 'unused') {
      query.$and = [
        {
          $or: [
            { currentlyChoosedForContest: { $exists: false } },
            { currentlyChoosedForContest: false },
          ],
        },
        {
          $or: [
            { isUsedInContest: { $exists: false } },
            { isUsedInContest: false },
          ],
        },
        { 'usedInContests.0': { $exists: false } },
      ];
    } else if (used === 'used') {
      query.$and = [
        {
          $or: [
            { currentlyChoosedForContest: true },
            { isUsedInContest: true },
            { 'usedInContests.0': { $exists: true } },
          ],
        },
      ];
    }

    // Add difficulty filter if provided
    if (difficulty) {
      query.difficulty = difficulty;
    }

    // Add topic filter if provided (check if topics array contains the topic)
    if (topic) {
      query.topics = { $in: [topic] };
    }

    const questions = await Model.find(query)
      .select('_id problemId title difficulty topics usedInContests isUsedInContest currentlyChoosedForContest createdAt')
      .limit(limit)
      .skip(offset)
      .lean<any[]>();

    allQuestions.push(
      ...questions.map((q) => ({
        ...q,
        id: q._id.toString(),
        problemId: q.problemId,
        isUsedInContest: Boolean(q.isUsedInContest),
        currentlyChoosedForContest: Boolean(q.currentlyChoosedForContest),
        type: modelName,
      }))
    );
  }

  return {
    questions: allQuestions.slice(0, limit),
    total: allQuestions.length,
    limit,
    offset,
  };
}
