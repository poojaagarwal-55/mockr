import { Redis as UpstashRedis } from '@upstash/redis';
import IORedis from 'ioredis';
import { env } from './env.js';

type RedisValue = string | number | boolean | object | null;
const JSON_PREFIX = '__json__:';

interface RedisPipelineCompat {
  zadd(key: string, entry: { score: number; member: string }): RedisPipelineCompat;
  expire(key: string, seconds: number): RedisPipelineCompat;
  exec(): Promise<unknown>;
}

function isTcpRedisUrl(url: string): boolean {
  return url.startsWith('redis://') || url.startsWith('rediss://');
}

class IORedisCompat {
  private readonly client: IORedis;

  constructor(url: string) {
    this.client = new IORedis(url, {
      maxRetriesPerRequest: null,
    });
  }

  async ping(): Promise<string> {
    return this.client.ping();
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    const value = await this.client.get(key);
    if (value === null) return null;

    if (value.startsWith(JSON_PREFIX)) {
      try {
        return JSON.parse(value.slice(JSON_PREFIX.length)) as T;
      } catch {
        return null;
      }
    }

    return value as T;
  }

  async keys(pattern: string): Promise<string[]> {
    return this.client.keys(pattern);
  }

  async set(key: string, value: RedisValue, options?: { ex?: number }): Promise<'OK' | null> {
    const serialized = typeof value === 'string' ? value : `${JSON_PREFIX}${JSON.stringify(value)}`;
    if (options?.ex) {
      return this.client.set(key, serialized, 'EX', options.ex);
    }
    return this.client.set(key, serialized);
  }

  async setex(key: string, ttlSeconds: number, value: RedisValue): Promise<'OK'> {
    const serialized = typeof value === 'string' ? value : `${JSON_PREFIX}${JSON.stringify(value)}`;
    return this.client.setex(key, ttlSeconds, serialized);
  }

  async del(...keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    return this.client.del(...keys);
  }

  async zadd(key: string, entry: { score: number; member: string }): Promise<number> {
    return this.client.zadd(key, entry.score, entry.member);
  }

  async expire(key: string, seconds: number): Promise<number> {
    return this.client.expire(key, seconds);
  }

  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  async zrevrank(key: string, member: string): Promise<number | null> {
    return this.client.zrevrank(key, member);
  }

  async zrange(key: string, start: number, stop: number, options?: { rev?: boolean; withScores?: boolean }) {
    if (options?.rev && options?.withScores) {
      return this.client.zrevrange(key, start, stop, 'WITHSCORES');
    }
    if (options?.rev) {
      return this.client.zrevrange(key, start, stop);
    }
    if (options?.withScores) {
      return this.client.zrange(key, start, stop, 'WITHSCORES');
    }
    return this.client.zrange(key, start, stop);
  }

  pipeline(): RedisPipelineCompat {
    const pipeline = this.client.pipeline();
    const compat: RedisPipelineCompat = {
      zadd: (key: string, entry: { score: number; member: string }) => {
        pipeline.zadd(key, entry.score, entry.member);
        return compat;
      },
      expire: (key: string, seconds: number) => {
        pipeline.expire(key, seconds);
        return compat;
      },
      exec: () => pipeline.exec(),
    };
    return compat;
  }
}

function createRedisClient() {
  if (isTcpRedisUrl(env.REDIS_URL)) {
    console.log('[Redis] Using TCP Redis client');
    return new IORedisCompat(env.REDIS_URL);
  }

  console.log('[Redis] Using Upstash REST Redis client');
  return new UpstashRedis({
    url: env.REDIS_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
    automaticDeserialization: true,
  });
}

/**
 * Redis client for caching, duplicate checks, and leaderboard data.
 * Supports Upstash REST in hosted deployments and TCP Redis for BullMQ/local load tests.
 */
export const redis = createRedisClient();

/**
 * Cache key patterns for contest data
 */
export const CacheKeys = {
  contestQuestions: (contestId: string) => `contest:${contestId}:questions`,
  contestDetails: (contestId: string) => `contest:${contestId}:details`,
  contestLeaderboard: (contestId: string) => `contest:${contestId}:leaderboard`,
  generatedContestLeaderboard: (contestId: string) => `contest:${contestId}:leaderboard:generated`,
  userSubmissions: (userId: string, contestId: string) => `user:${userId}:contest:${contestId}:submissions`,
  testCaseCache: (questionId: string) => `question:${questionId}:testcases`,
} as const;

/**
 * Cache TTL values (in seconds)
 */
export const CacheTTL = {
  contestQuestions: 10800, // 3 hours
  contestDetails: 300,
  contestLeaderboard: 60,
  userSubmissions: 1800,
  testCaseCache: 86400,
} as const;

export async function getCachedOrFetch<T>(
  key: string,
  ttl: number,
  fetchFn: () => Promise<T>
): Promise<T> {
  // Cache is a best-effort accelerator, never a hard dependency. Redis/Upstash
  // errors (including quota / "max requests" errors under load) must NOT fail the
  // request — otherwise a cache blip 500s every endpoint that reads through here,
  // including the mandatory contest-entry route. Always fall back to the source.
  try {
    const cached = await redis.get<T>(key);
    if (cached !== null) {
      return cached;
    }
  } catch {
    // Cache read failed — degrade to the source of truth.
  }

  const data = await fetchFn();

  try {
    await redis.setex(key, ttl, data as RedisValue);
  } catch {
    // Cache write failed — the response is already computed; skip caching.
  }

  return data;
}

export async function invalidateCache(pattern: string): Promise<void> {
  try {
    await redis.del(pattern);
  } catch {
    // Best-effort invalidation; a failed delete just means a slightly stale cache.
  }
}
