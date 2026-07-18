import { prisma } from '../lib/prisma.js';

/**
 * Submission Validator
 * Tracks contest submission attempts.
 */

export interface ValidationResult {
  allowed: boolean;
  attemptNumber: number;
  remainingAttempts: number | null;
  message?: string;
}

/**
 * Validate if user can submit for a question
 * Attempts are unlimited per question per contest.
 */
export async function validateSubmissionAttempt(
  userId: string,
  contestId: string,
  questionId: string
): Promise<ValidationResult> {
  // Count existing submissions for this user, contest, and question
  const existingSubmissions = await prisma.contestSubmission.count({
    where: {
      userId,
      contestId,
      questionId,
    },
  });

  const attemptNumber = existingSubmissions + 1;

  return {
    allowed: true,
    attemptNumber,
    remainingAttempts: null,
  };
}

/**
 * Check if user is registered for contest
 */
export async function validateContestParticipant(
  userId: string,
  contestId: string
): Promise<boolean> {
  const participant = await prisma.contestParticipant.findUnique({
    where: {
      contestId_userId: {
        contestId,
        userId,
      },
    },
  });

  return participant !== null;
}

/**
 * Check if contest is active
 */
export async function validateContestActive(contestId: string): Promise<boolean> {
  const contest = await prisma.contest.findUnique({
    where: { id: contestId },
    select: { status: true },
  });

  return contest?.status === 'ACTIVE';
}
