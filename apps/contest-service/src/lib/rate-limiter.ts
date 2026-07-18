import { redis } from './redis.js';

/**
 * Rate Limiter
 * Token bucket algorithm using Redis
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

/**
 * Check rate limit for a key
 * Uses token bucket algorithm
 * 
 * @param key - Unique identifier for the rate limit (e.g., "run:userId")
 * @param maxRequests - Maximum number of requests allowed
 * @param windowMs - Time window in milliseconds
 * @returns RateLimitResult
 */
export async function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): Promise<RateLimitResult> {
  const now = Date.now();
  const windowKey = `ratelimit:${key}`;

  try {
    // Get current count and timestamp
    const data = await redis.get<{ count: number; resetAt: number }>(windowKey);

    if (!data) {
      // First request - initialize
      await redis.setex(
        windowKey,
        Math.ceil(windowMs / 1000),
        { count: 1, resetAt: now + windowMs }
      );

      return {
        allowed: true,
        remaining: maxRequests - 1,
        retryAfterMs: 0,
      };
    }

    // Check if window has expired
    if (now >= data.resetAt) {
      // Reset window
      await redis.setex(
        windowKey,
        Math.ceil(windowMs / 1000),
        { count: 1, resetAt: now + windowMs }
      );

      return {
        allowed: true,
        remaining: maxRequests - 1,
        retryAfterMs: 0,
      };
    }

    // Check if limit exceeded
    if (data.count >= maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: data.resetAt - now,
      };
    }

    // Increment count
    await redis.setex(
      windowKey,
      Math.ceil((data.resetAt - now) / 1000),
      { count: data.count + 1, resetAt: data.resetAt }
    );

    return {
      allowed: true,
      remaining: maxRequests - data.count - 1,
      retryAfterMs: 0,
    };
  } catch (error) {
    console.error('Rate limit check error:', error);
    // Fail open - allow request if Redis is down
    return {
      allowed: true,
      remaining: maxRequests,
      retryAfterMs: 0,
    };
  }
}

/**
 * Rate limit middleware factory
 * Creates a middleware function for specific rate limits
 */
export function createRateLimitMiddleware(
  keyPrefix: string,
  maxRequests: number,
  windowMs: number
) {
  return async (userId: string): Promise<RateLimitResult> => {
    const key = `${keyPrefix}:${userId}`;
    return await checkRateLimit(key, maxRequests, windowMs);
  };
}

/**
 * Predefined rate limiters
 */
export const rateLimiters = {
  // 5 requests per minute for code run
  codeRun: (userId: string) => checkRateLimit(`run:${userId}`, 5, 60000),
  
  // 10 requests per second for question retrieval
  questionRetrieval: (userId: string) => checkRateLimit(`questions:${userId}`, 10, 1000),
  
  // 100 requests per minute for general API
  generalApi: (userId: string) => checkRateLimit(`api:${userId}`, 100, 60000),
  
  // 10 messages per second for WebSocket
  websocket: (userId: string) => checkRateLimit(`ws:${userId}`, 10, 1000),
};
