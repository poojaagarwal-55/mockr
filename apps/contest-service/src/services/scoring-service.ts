import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/redis.js';

/**
 * Scoring Service
 * Calculates scores based on contest question scoring configuration
 * Updates participant total score atomically
 */

export interface ScoreResult {
  pointsAwarded: number;
  newTotalScore: number;
  previousTotalScore: number;
}

/**
 * Finalize a judged submission and update participant score atomically.
 * DSA penalties follow Codeforces-style scoring: failed attempts are counted
 * for the question, but they only reduce the award when that same question is
 * eventually accepted. Unsolved questions never subtract from the live score.
 */
export async function finalizeSubmissionScore(
  submissionId: string,
  userId: string,
  contestId: string,
  questionId: string,
  points: number,
  negativePoints: number,
  negativeCap: number,
  testCasesPassed: number,
  testCasesTotal: number,
  finalStatus: string,
  executionTime: number | null,
  memoryUsed: number | null,
): Promise<ScoreResult> {
  const scoreResult = await prisma.$transaction(async (tx) => {
    const lockedSubmissions = await tx.$queryRaw<Array<{
      id: string;
      status: string;
      pointsAwarded: number;
    }>>`
      SELECT
        id,
        status::text AS status,
        points_awarded AS "pointsAwarded"
      FROM contest_submissions
      WHERE contest_id = ${contestId}
        AND question_id = ${questionId}
        AND user_id = ${userId}
      ORDER BY submitted_at ASC
      FOR UPDATE
    `;

    const participantRows = await tx.$queryRaw<Array<{ totalScore: number }>>`
      SELECT total_score AS "totalScore"
      FROM contest_participants
      WHERE contest_id = ${contestId}
        AND user_id = ${userId}
      FOR UPDATE
    `;

    const participant = participantRows[0];
    if (!participant) {
      throw new Error(`Contest participant not found for scoring: contest=${contestId}, user=${userId}`);
    }

    // Idempotency guard: if this submission was already finalized (e.g. a job
    // got re-delivered after a false stall, or ran twice), its points are
    // already reflected in the participant total. The FOR UPDATE lock above
    // serializes concurrent runs, so the second one sees a terminal status here
    // and must NOT add the points again.
    const PRE_SCORE_STATUSES = new Set(['PENDING', 'QUEUED', 'PROCESSING', 'JUDGING_DEFERRED']);
    const currentRow = lockedSubmissions.find((submission) => submission.id === submissionId);
    if (currentRow && !PRE_SCORE_STATUSES.has((currentRow.status || '').toUpperCase())) {
      console.log(
        `[Scoring] Submission ${submissionId} already finalized (${currentRow.status}); ` +
        `skipping re-score to stay idempotent.`
      );
      return {
        pointsAwarded: currentRow.pointsAwarded,
        previousTotalScore: participant.totalScore,
        newTotalScore: participant.totalScore,
      };
    }

    const priorSubmissions = lockedSubmissions.filter((submission) => submission.id !== submissionId);
    const alreadySolved = priorSubmissions.some((submission) => submission.status === 'ACCEPTED');

    const normalizedPoints = Math.max(0, Math.floor(Number(points) || 0));
    const normalizedPenalty = Math.max(0, Math.floor(Number(negativePoints) || 0));
    const normalizedCap = normalizedPenalty > 0 ? Math.max(0, Math.floor(Number(negativeCap) || 0)) : 0;
    const priorFailedSubmissions = alreadySolved
      ? []
      : priorSubmissions.filter((submission) => {
        const status = (submission.status || '').toUpperCase();
        return status !== 'ACCEPTED' && !PRE_SCORE_STATUSES.has(status);
      });
    const accruedPenalty = normalizedPenalty > 0 && normalizedCap > 0
      ? Math.min(priorFailedSubmissions.length * normalizedPenalty, normalizedCap)
      : 0;

    // Older scoring deducted failed DSA submissions immediately. If a question
    // is still unsolved, refund those legacy rows before applying the new
    // per-question accepted-score delta so active contests do not double-pay.
    const legacyPenaltySubmissionIds = alreadySolved
      ? []
      : priorSubmissions
        .filter((submission) => submission.pointsAwarded < 0)
        .map((submission) => submission.id);
    const legacyPenaltyRefund = alreadySolved
      ? 0
      : priorSubmissions.reduce((sum, submission) => {
        return sum + (submission.pointsAwarded < 0 ? Math.abs(submission.pointsAwarded) : 0);
      }, 0);

    let actualPointsAwarded = 0;
    if (finalStatus === 'ACCEPTED') {
      actualPointsAwarded = alreadySolved ? 0 : Math.max(0, normalizedPoints - accruedPenalty);
    }

    const previousTotalScore = participant.totalScore;
    const newTotalScore = previousTotalScore + legacyPenaltyRefund + actualPointsAwarded;

    if (legacyPenaltySubmissionIds.length > 0) {
      await tx.contestSubmission.updateMany({
        where: { id: { in: legacyPenaltySubmissionIds } },
        data: { pointsAwarded: 0 },
      });
    }

    await tx.contestSubmission.update({
      where: { id: submissionId },
      data: {
        status: finalStatus as any,
        testCasesPassed,
        testCasesTotal,
        pointsAwarded: actualPointsAwarded,
        executionTime,
        memoryUsed,
      },
    });

    await tx.contestParticipant.update({
      where: {
        contestId_userId: {
          contestId,
          userId,
        },
      },
      data: {
        totalScore: newTotalScore,
      },
    });

    console.log(
      `[Scoring] User ${userId} scored ${actualPointsAwarded} on ${questionId} ` +
      `(${testCasesPassed}/${testCasesTotal} passed, cap ${normalizedCap}, accrued penalty ${accruedPenalty}, ` +
      `legacy refund ${legacyPenaltyRefund}). ` +
      `Total: ${previousTotalScore} -> ${newTotalScore}`
    );

    return {
      pointsAwarded: actualPointsAwarded,
      previousTotalScore,
      newTotalScore,
    };
  });

  await updateLeaderboardCache(contestId, userId, scoreResult.newTotalScore);

  return scoreResult;
}

/**
 * Update Redis sorted set for leaderboard
 * Key: contest:{contestId}:leaderboard:live
 * Score: totalScore (higher is better)
 * Member: userId
 */
async function updateLeaderboardCache(
  contestId: string,
  userId: string,
  totalScore: number
): Promise<void> {
  try {
    const key = `contest:${contestId}:leaderboard:live`;
    await redis.zadd(key, { score: totalScore, member: userId });

    // Set TTL to 24 hours
    await redis.expire(key, 86400);

    console.log(`[Scoring] Updated leaderboard cache for contest ${contestId}: ${userId} = ${totalScore}`);
  } catch (error) {
    console.error('[Scoring] Error updating leaderboard cache:', error);
    // Don't throw - cache update failure shouldn't fail scoring
  }
}

/**
 * Get user's current rank in contest (from cache)
 * Returns null if cache miss
 */
export async function getUserRank(contestId: string, userId: string): Promise<number | null> {
  try {
    const key = `contest:${contestId}:leaderboard:live`;
    const rank = await redis.zrevrank(key, userId);

    if (rank === null) {
      return null;
    }

    return rank + 1; // Redis ranks are 0-indexed, convert to 1-indexed
  } catch (error) {
    console.error('[Scoring] Error getting user rank:', error);
    return null;
  }
}

/**
 * Get top N participants from cache
 */
export async function getTopParticipants(
  contestId: string,
  limit: number = 50
): Promise<Array<{ userId: string; score: number; rank: number }>> {
  try {
    const key = `contest:${contestId}:leaderboard:live`;
    const results = await redis.zrange(key, 0, limit - 1, { rev: true, withScores: true });

    const participants: Array<{ userId: string; score: number; rank: number }> = [];
    for (let i = 0; i < results.length; i += 2) {
      participants.push({
        userId: results[i] as string,
        score: results[i + 1] as number,
        rank: i / 2 + 1,
      });
    }

    return participants;
  } catch (error) {
    console.error('[Scoring] Error getting top participants:', error);
    return [];
  }
}

/**
 * Invalidate leaderboard cache
 * Called when contest ends or manual refresh needed
 */
export async function invalidateLeaderboardCache(contestId: string): Promise<void> {
  try {
    const key = `contest:${contestId}:leaderboard:live`;
    await redis.del(key);
    console.log(`[Scoring] Invalidated leaderboard cache for contest ${contestId}`);
  } catch (error) {
    console.error('[Scoring] Error invalidating leaderboard cache:', error);
  }
}

export async function clampNegativeContestScores(contestId: string): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ userId: string; totalScore: number }>>`
    UPDATE contest_participants
    SET total_score = GREATEST(total_score, 0)
    WHERE contest_id = ${contestId} AND total_score < 0
    RETURNING user_id AS "userId", total_score AS "totalScore"
  `;

  if (rows.length > 0) {
    await rebuildLeaderboardCache(contestId);
  }

  console.log(`[Scoring] Clamped ${rows.length} negative final scores for contest ${contestId}`);
  return rows.length;
}

/**
 * Final submitted totals should never be negative. Failed attempts may reduce a
 * live score during the contest, but the submitted participant score bottoms
 * out at zero for the final result and leaderboard.
 */
export async function clampParticipantFinalScore(
  contestId: string,
  userId: string
): Promise<number | null> {
  const rows = await prisma.$queryRaw<Array<{ totalScore: number }>>`
    UPDATE contest_participants
    SET total_score = GREATEST(total_score, 0)
    WHERE contest_id = ${contestId} AND user_id = ${userId}
    RETURNING total_score AS "totalScore"
  `;

  const totalScore = rows[0]?.totalScore ?? null;
  if (totalScore !== null) {
    await updateLeaderboardCache(contestId, userId, totalScore);
  }

  return totalScore;
}

/**
 * Rebuild leaderboard cache from database
 * Called when cache is invalidated or contest ends
 */
export async function rebuildLeaderboardCache(contestId: string): Promise<void> {
  try {
    const participants = await prisma.contestParticipant.findMany({
      where: { contestId },
      select: {
        userId: true,
        totalScore: true,
      },
    });

    const key = `contest:${contestId}:leaderboard:live`;

    // Use pipeline for efficiency
    const pipeline = redis.pipeline();
    for (const participant of participants) {
      pipeline.zadd(key, { score: participant.totalScore, member: participant.userId });
    }
    pipeline.expire(key, 86400); // 24 hours TTL

    await pipeline.exec();

    console.log(`[Scoring] Rebuilt leaderboard cache for contest ${contestId} with ${participants.length} participants`);
  } catch (error) {
    console.error('[Scoring] Error rebuilding leaderboard cache:', error);
  }
}
