// ============================================
// Cache-Control Header Plugin
// ============================================
// Provides a `reply.cacheControl(...)` decorator for setting
// HTTP Cache-Control headers on GET responses.
//
// Usage in routes:
//   reply.header("Cache-Control", "public, max-age=300, stale-while-revalidate=60");
//   return reply.send(data);

import fp from "fastify-plugin";
import type { FastifyInstance, FastifyReply } from "fastify";

// ── Helpers ──────────────────────────────────────────────────

/** Build a Cache-Control header value. */
export function buildCacheControl(
    scope: "public" | "private",
    maxAge: number,
    staleWhileRevalidate?: number,
): string {
    let value = `${scope}, max-age=${maxAge}`;
    if (staleWhileRevalidate && staleWhileRevalidate > 0) {
        value += `, stale-while-revalidate=${staleWhileRevalidate}`;
    }
    return value;
}

// ── Pre-built header values (avoid string allocation per request) ──

export const CACHE = {
    /** Static catalogs: 5 min + 1 min SWR */
    CATALOG:      buildCacheControl("public", 300, 60),
    /** Individual questions: 10 min + 2 min SWR */
    QUESTION:     buildCacheControl("public", 600, 120),
    /** Near-static config: 1 hour */
    CONFIG:       buildCacheControl("public", 3600),
    /** User-specific, low churn: 2 min + 1 min SWR */
    USER_MEDIUM:  buildCacheControl("private", 120, 60),
    /** User-specific, frequent: 1 min */
    USER_SHORT:   buildCacheControl("private", 60),
    /** User-specific, very frequent: 30 sec */
    USER_FAST:    buildCacheControl("private", 30),
    /** User-specific, low churn: 5 min */
    USER_LONG:    buildCacheControl("private", 300),
    /** Never cache */
    NONE:         "no-store",
} as const;

export type CachePreset = keyof typeof CACHE;

// ── Plugin ───────────────────────────────────────────────────

async function cacheHeadersPlugin(fastify: FastifyInstance) {
    // Decorate reply with a helper method
    fastify.decorateReply("cacheControl", function (this: FastifyReply, preset: CachePreset) {
        this.header("Cache-Control", CACHE[preset]);
        return this;
    });
}

// Extend Fastify's type system
declare module "fastify" {
    interface FastifyReply {
        cacheControl(preset: CachePreset): FastifyReply;
    }
}

export default fp(cacheHeadersPlugin, {
    name: "cache-headers",
});
