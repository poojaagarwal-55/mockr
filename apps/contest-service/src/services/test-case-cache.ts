import { redis, CacheKeys, CacheTTL } from '../lib/redis.js';
import crypto from 'crypto';

/**
 * Test Case Caching Service
 * Caches Judge0 execution results to reduce API calls by 60-70%
 * Cache key: testcase:{questionId}:{testCaseHash}:result
 */

export interface TestCaseResult {
  status: string;
  stdout: string | null;
  stderr: string | null;
  compile_output: string | null;
  time: string;
  memory: number;
  passed: boolean;
}

/**
 * Generate SHA-256 hash of test case
 * Hash includes: input + expectedOutput
 */
export function hashTestCase(input: string, expectedOutput: string): string {
  const content = `${input}|||${expectedOutput}`;
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Get cached test case result
 * Returns null if cache miss
 */
export async function getCachedTestResult(
  questionId: string,
  testCaseHash: string
): Promise<TestCaseResult | null> {
  try {
    const key = `testcase:${questionId}:${testCaseHash}:result`;
    const cached = await redis.get(key);

    if (!cached) {
      return null;
    }

    return JSON.parse(cached as string) as TestCaseResult;
  } catch (error) {
    console.error('[TestCaseCache] Error getting cached result:', error);
    return null; // Fail gracefully, proceed without cache
  }
}

/**
 * Cache test case result
 * TTL: Contest duration + 1 hour (default 4 hours)
 */
export async function cacheTestResult(
  questionId: string,
  testCaseHash: string,
  result: TestCaseResult,
  ttlSeconds: number = CacheTTL.contestQuestions
): Promise<void> {
  try {
    const key = `testcase:${questionId}:${testCaseHash}:result`;
    await redis.setex(key, ttlSeconds, JSON.stringify(result));
  } catch (error) {
    console.error('[TestCaseCache] Error caching result:', error);
    // Fail gracefully, don't throw error
  }
}

/**
 * Invalidate all cached test results for a question
 * Called when question test cases are updated
 */
export async function invalidateQuestionTestCache(questionId: string): Promise<void> {
  try {
    const pattern = `testcase:${questionId}:*:result`;
    const keys = await redis.keys(pattern);

    if (keys.length > 0) {
      await redis.del(...keys);
      console.log(`[TestCaseCache] Invalidated ${keys.length} cached test results for question ${questionId}`);
    }
  } catch (error) {
    console.error('[TestCaseCache] Error invalidating cache:', error);
  }
}

/**
 * Get cache statistics for a question
 */
export async function getTestCacheStats(questionId: string): Promise<{
  cachedCount: number;
  keys: string[];
}> {
  try {
    const pattern = `testcase:${questionId}:*:result`;
    const keys = await redis.keys(pattern);

    return {
      cachedCount: keys.length,
      keys,
    };
  } catch (error) {
    console.error('[TestCacheCache] Error getting stats:', error);
    return {
      cachedCount: 0,
      keys: [],
    };
  }
}
