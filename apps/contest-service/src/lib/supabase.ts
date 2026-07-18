import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { env } from './env.js';
import { verifyLoadTestToken } from './load-test-auth.js';
import { getCachedAuthUser, setCachedAuthUser } from './auth-token-cache.js';

/**
 * Supabase Admin Client
 * Uses service role key to bypass RLS for server-side operations
 */
let adminClient: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (!adminClient) {
    adminClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  return adminClient;
}

/**
 * Per-request Supabase Client
 * Uses the user's JWT to make requests as that user
 */
export function getSupabaseClient(accessToken: string): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/**
 * Verify Supabase JWT token
 * Returns userId if valid, null otherwise
 */
export async function verifySupabaseToken(token: string): Promise<string | null> {
  try {
    const loadTestPayload = verifyLoadTestToken(token);
    if (loadTestPayload) {
      return loadTestPayload.sub;
    }

    // Reuse the same 60s token cache the HTTP middleware uses. The submission
    // WebSocket opens a new connection per submission, so without this every
    // submit was a fresh network call to Supabase auth (a load spike + quota risk).
    const cached = getCachedAuthUser(token);
    if (cached) {
      return cached.id;
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) {
      return null;
    }

    setCachedAuthUser(token, {
      id: data.user.id,
      email: data.user.email ?? '',
      user_metadata: data.user.user_metadata,
    });
    return data.user.id;
  } catch (error) {
    console.error('Token verification failed:', error);
    return null;
  }
}
