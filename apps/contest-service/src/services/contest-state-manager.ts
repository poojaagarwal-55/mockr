import { prisma } from '../lib/prisma.js';
import { redis, CacheKeys } from '../lib/redis.js';
import { ContestStatus } from '../types/contest.js';
import { unmarkQuestionsAsUsed } from './contest-service.js';
import { clampNegativeContestScores } from './scoring-service.js';

const STALE_LOCK_RECONCILE_INTERVAL_MS = 10 * 60 * 1000;
let lastStaleLockReconcileAt = 0;

async function reconcileEndedContestQuestionLocks(now: Date): Promise<void> {
  const shouldRun = Date.now() - lastStaleLockReconcileAt >= STALE_LOCK_RECONCILE_INTERVAL_MS;
  if (!shouldRun) return;

  lastStaleLockReconcileAt = Date.now();

  const endedContests = await prisma.contest.findMany({
    where: {
      status: ContestStatus.ENDED,
      endTime: { lte: now },
    },
    include: {
      questions: {
        select: { questionId: true },
      },
    },
  });

  for (const contest of endedContests) {
    const questionIds = contest.questions.map((question) => question.questionId);
    await unmarkQuestionsAsUsed(questionIds, contest.id);
  }
}

/**
 * Contest State Manager
 * Handles automatic state transitions for contests
 * UPCOMING → ACTIVE at startTime
 * ACTIVE → ENDED at endTime
 */

/**
 * Check and update contest states
 * Should be called periodically (e.g., every minute)
 */
export async function updateContestStates(): Promise<void> {
  const now = new Date();

  try {
    // Transition UPCOMING → ACTIVE
    const upcomingToActive = await prisma.contest.updateMany({
      where: {
        status: ContestStatus.UPCOMING,
        startTime: {
          lte: now,
        },
      },
      data: {
        status: ContestStatus.ACTIVE,
      },
    });

    if (upcomingToActive.count > 0) {
      console.log(`✅ Transitioned ${upcomingToActive.count} contests to ACTIVE`);
    }

    // Transition ACTIVE → ENDED
    const contestsToEnd = await prisma.contest.findMany({
      where: {
        status: ContestStatus.ACTIVE,
        endTime: {
          lte: now,
        },
      },
      include: {
        questions: {
          select: {
            questionId: true,
          },
        },
      },
    });

    const activeToEnded = contestsToEnd.length > 0
      ? await prisma.contest.updateMany({
          where: {
            id: { in: contestsToEnd.map((contest) => contest.id) },
            status: ContestStatus.ACTIVE,
          },
          data: {
            status: ContestStatus.ENDED,
          },
        })
      : { count: 0 };

    if (activeToEnded.count > 0) {
      console.log(`✅ Transitioned ${activeToEnded.count} contests to ENDED`);
      
      for (const contest of contestsToEnd) {
        const questionIds = contest.questions.map((question) => question.questionId);
        await clampNegativeContestScores(contest.id);
        await unmarkQuestionsAsUsed(questionIds, contest.id);
        await redis.del(CacheKeys.contestDetails(contest.id));
        const contestQuestionsKey = CacheKeys.contestQuestions(contest.id);
        await redis.del(contestQuestionsKey);
        await redis.del(`${contestQuestionsKey}:ide-v4`);
        await redis.del(`${contestQuestionsKey}:ide-v5`);
        await redis.del(`${contestQuestionsKey}:ide-v6`);
        await redis.del(`${contestQuestionsKey}:ide-v7`);
        await redis.del(`${contestQuestionsKey}:ide-v8`);
      }
    }

    await reconcileEndedContestQuestionLocks(now);
  } catch (error) {
    console.error('❌ Failed to update contest states:', error);
  }
}

/**
 * Start the contest state manager
 * Runs every minute to check for state transitions
 */
export function startContestStateManager(): NodeJS.Timeout {
  console.log('🚀 Contest state manager started');

  // Run immediately on startup
  updateContestStates();

  // Then run every minute
  const interval = setInterval(() => {
    updateContestStates();
  }, 60000); // 60 seconds

  return interval;
}

/**
 * Stop the contest state manager
 */
export function stopContestStateManager(interval: NodeJS.Timeout): void {
  clearInterval(interval);
  console.log('🛑 Contest state manager stopped');
}
