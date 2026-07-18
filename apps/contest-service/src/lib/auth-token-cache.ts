/**
 * In-process cache of verified Supabase access tokens.
 *
 * Every authenticated request previously called `supabase.auth.getUser(token)`,
 * a network round-trip to Supabase's auth API. Under load (e.g. 150 users each
 * firing several requests/sec plus polling) that produces hundreds of auth calls
 * per second — enough to hit Supabase's auth rate limit ("quota exceeded") and to
 * hold each request (and its DB connection) open for the 50–200ms round-trip.
 *
 * Access tokens are stable for ~1 hour, so re-verifying the same token on every
 * request is wasted work. We cache the resolved user per token for a short window,
 * collapsing thousands of auth calls into ~one per user per TTL window. The cache
 * is per-instance (fine on Cloud Run) and bounded to avoid unbounded growth.
 */

export interface CachedAuthUser {
  id: string;
  email: string;
  user_metadata?: Record<string, unknown>;
}

interface Entry {
  user: CachedAuthUser;
  expiresAt: number;
}

// 60s is well under the ~1h access-token lifetime, so a revoked/rotated token is
// honoured again within a minute while cutting auth calls by orders of magnitude.
const TTL_MS = 60_000;
const MAX_ENTRIES = 50_000;

const cache = new Map<string, Entry>();

export function getCachedAuthUser(token: string): CachedAuthUser | null {
  const entry = cache.get(token);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(token);
    return null;
  }
  return entry.user;
}

export function setCachedAuthUser(token: string, user: CachedAuthUser): void {
  // Cheap bound: if we hit the cap, drop the oldest insertion (Map preserves order).
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(token, { user, expiresAt: Date.now() + TTL_MS });
}
