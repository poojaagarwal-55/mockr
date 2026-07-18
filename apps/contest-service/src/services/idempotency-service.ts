import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/redis.js';
import crypto from 'crypto';

/**
 * Idempotency Service
 * Prevents duplicate submissions using idempotency keys and content hashing
 */

const DUPLICATE_SUBMISSION_COOLDOWN_SECONDS = 30;

export interface DuplicateSubmissionCheck {
  isDuplicate: boolean;
  retryAfterSeconds: number;
  cooldownSeconds: number;
}

/**
 * Check if idempotency key already exists
 * Returns existing submission if found
 */
export async function checkIdempotencyKey(idempotencyKey: string) {
  const existingSubmission = await prisma.contestSubmission.findUnique({
    where: { idempotencyKey },
  });

  return existingSubmission;
}

/**
 * Generate content hash for duplicate detection
 * Hash of (code + language + questionId)
 */
export function generateContentHash(code: string, language: string, questionId: string): string {
  const content = `${code}|${language}|${questionId}`;
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Check for duplicate submission within time window
 * Uses Redis with a short TTL so accidental double-clicks do not spam Judge0.
 */
export async function checkDuplicateSubmission(
  userId: string,
  contestId: string,
  contentHash: string
): Promise<DuplicateSubmissionCheck> {
  const key = `duplicate:${userId}:${contestId}:${contentHash}`;
  
  try {
    const exists = await redis.get(key);
    
    if (exists) {
      const ttl = await redis.ttl(key);
      return {
        isDuplicate: true,
        retryAfterSeconds: ttl > 0 ? ttl : DUPLICATE_SUBMISSION_COOLDOWN_SECONDS,
        cooldownSeconds: DUPLICATE_SUBMISSION_COOLDOWN_SECONDS,
      };
    }

    await redis.setex(key, DUPLICATE_SUBMISSION_COOLDOWN_SECONDS, '1');
    
    return {
      isDuplicate: false,
      retryAfterSeconds: 0,
      cooldownSeconds: DUPLICATE_SUBMISSION_COOLDOWN_SECONDS,
    };
  } catch (error) {
    console.error('Duplicate check error:', error);
    // Fail open - allow submission if Redis is down
    return {
      isDuplicate: false,
      retryAfterSeconds: 0,
      cooldownSeconds: DUPLICATE_SUBMISSION_COOLDOWN_SECONDS,
    };
  }
}
