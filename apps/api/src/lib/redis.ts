import { Redis } from "@upstash/redis";

// ============================================
// Redis Client Wrapper (Upstash)
// ============================================
// Provides safe fallbacks if UPSTASH_REDIS_REST_URL is missing.
// This allows the platform to run gracefully without caching in
// local dev environments while leveraging blazing fast speed in prod.

let redisClient: Redis | null = null;

export function getRedis(): Redis | null {
    if (redisClient !== null) return redisClient;

    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!url || !token) {
        console.warn("[Redis] UPSTASH_REDIS_REST_URL not configured. Running without remote cache.");
        return null;
    }

    try {
        redisClient = new Redis({
            url,
            token,
        });
        return redisClient;
    } catch (err) {
        console.error("[Redis] Initialization failed:", err);
        return null;
    }
}

/**
 * Cache-aside Read Pattern.
 * Attempts to pull from Redis. On Miss, invokes fetcherFn() exactly once,
 * safely caches it for `ttlSeconds` via UPSTASH, and returns it.
 * 
 * If Upstash isn't configured, bypasses and guarantees `fetcherFn` is invoked raw.
 */
export async function cacheGet<T>(
    key: string,
    ttlSeconds: number,
    fetcherFn: () => Promise<T>
): Promise<T> {
    const redis = getRedis();
    if (!redis) return fetcherFn();

    try {
        const cachedStr = await redis.get<string>(key);
        if (cachedStr) {
            // @upstash returns JSON as straight objects for sets/gets under the hood using native parse,
            // but strongly stringified inputs need manual revivals sometimes.
            // Safe checking:
            return typeof cachedStr === "string" ? JSON.parse(cachedStr) : (cachedStr as T);
        }
    } catch (err) {
        console.error(`[Redis] GET Error on ${key}:`, err);
    }

    // Cache Miss or Error -> Run heavy operation
    const freshData = await fetcherFn();

    // Fire and Forget Cache Set
    try {
        // Safe stringify dates and nested objects
        const stringified = JSON.stringify(freshData);
        await redis.set(key, stringified, { ex: ttlSeconds });
    } catch (err) {
        console.error(`[Redis] SET Error on ${key}:`, err);
    }

    return freshData;
}

/**
 * Instantly wipes multiple cache blocks synchronously with mutations.
 */
export async function cacheDel(keys: string[]): Promise<void> {
    const redis = getRedis();
    if (!redis || keys.length === 0) return;

    try {
        await redis.del(...keys);
    } catch (err) {
        console.error(`[Redis] DEL Error on keys:`, err);
    }
}

/**
 * Sweeps cache keys matching a specific pattern.
 */
export async function cacheDelPattern(pattern: string): Promise<void> {
    const redis = getRedis();
    if (!redis) return;

    try {
        const keys = await redis.keys(pattern);
        if (keys.length > 0) {
            await redis.del(...keys);
        }
    } catch (err) {
        console.error(`[Redis] DEL Pattern Error on ${pattern}:`, err);
    }
}

// ============================================
// Redis Sets (De-duplication)
// ============================================

export async function addAskedQuestion(userId: string, questionId: string): Promise<void> {
    const redis = getRedis();
    if (!redis) return;
    try {
        // Automatically deduplicated by the Redis SET structure
        await redis.sadd(`api:users:${userId}:asked`, questionId);
    } catch (err) {
        console.error(`[Redis] SADD Error on ${userId} asked questions:`, err);
    }
}

export async function getAskedQuestions(userId: string): Promise<string[]> {
    const redis = getRedis();
    if (!redis) return [];
    try {
        return await redis.smembers(`api:users:${userId}:asked`);
    } catch (err) {
        console.error(`[Redis] SMEMBERS Error on ${userId} asked questions:`, err);
        return [];
    }
}
