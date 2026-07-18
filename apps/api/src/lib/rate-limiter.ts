// ============================================
// Simple In-Memory Rate Limiter
// ============================================
// Sliding-window counter per key. No external dependencies.
// For horizontal scaling, swap with Redis-backed limiter.

interface RateLimitEntry {
    timestamps: number[];
    windowMs: number;
}

const buckets = new Map<string, RateLimitEntry>();

// Clean up stale entries every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of buckets) {
        entry.timestamps = entry.timestamps.filter((t) => now - t < entry.windowMs);
        if (entry.timestamps.length === 0) buckets.delete(key);
    }
}, 300_000).unref();

/**
 * Check whether a request should be allowed.
 * @param key   Unique identifier (e.g. `chat:${userId}`)
 * @param limit Max requests allowed in the window
 * @param windowMs Window size in milliseconds
 * @returns `{ allowed, remaining, retryAfterMs }` — if not allowed, `retryAfterMs` is > 0
 */
export function checkRateLimit(
    key: string,
    limit: number,
    windowMs: number
): { allowed: boolean; remaining: number; retryAfterMs: number } {
    const now = Date.now();

    let entry = buckets.get(key);
    if (!entry) {
        entry = { timestamps: [], windowMs };
        buckets.set(key, entry);
    }
    entry.windowMs = windowMs;

    // Discard timestamps outside the window
    entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs);

    if (entry.timestamps.length >= limit) {
        const oldest = entry.timestamps[0]!;
        const retryAfterMs = windowMs - (now - oldest);
        return { allowed: false, remaining: 0, retryAfterMs };
    }

    entry.timestamps.push(now);
    return {
        allowed: true,
        remaining: limit - entry.timestamps.length,
        retryAfterMs: 0,
    };
}
