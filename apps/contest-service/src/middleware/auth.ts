import { FastifyRequest, FastifyReply } from 'fastify';
import { getSupabaseAdmin } from '../lib/supabase.js';
import { verifyLoadTestToken } from '../lib/load-test-auth.js';
import { getCachedAuthUser, setCachedAuthUser } from '../lib/auth-token-cache.js';

/**
 * Extend Fastify types to include user on request
 */
declare module 'fastify' {
  interface FastifyRequest {
    user: {
      id: string;
      email: string;
      user_metadata?: Record<string, any>;
    } | null;
  }
}

/**
 * Authentication middleware
 * Verifies Supabase session token and extracts user information
 * NEVER trusts client-provided userId - always derives from verified token
 */
export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.status(401).send({
      error: 'Unauthorized',
      message: 'Missing or invalid Authorization header',
    });
  }

  const token = authHeader.replace('Bearer ', '');

  try {
    const loadTestPayload = verifyLoadTestToken(token);
    if (loadTestPayload) {
      request.user = {
        id: loadTestPayload.sub,
        email: loadTestPayload.email ?? `${loadTestPayload.sub}@load-test.local`,
        user_metadata: { source: 'load-test' },
      };
      return;
    }

    // Fast path: reuse a recently verified token instead of calling Supabase's
    // auth API on every request (that network round-trip is the load bottleneck).
    const cached = getCachedAuthUser(token);
    if (cached) {
      request.user = cached;
      return;
    }

    const supabase = getSupabaseAdmin();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);

    if (error) {
      request.log.error({ error }, 'Supabase auth error');
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Authentication failed',
      });
    }

    if (!user) {
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Authentication failed',
      });
    }

    // Set user on request - this is the ONLY source of truth for userId
    const verifiedUser = {
      id: user.id,
      email: user.email!,
      user_metadata: user.user_metadata,
    };
    setCachedAuthUser(token, verifiedUser);
    request.user = verifiedUser;
  } catch (err) {
    request.log.error({ err }, 'Authentication error');
    return reply.status(401).send({
      error: 'Unauthorized',
      message: 'Authentication failed',
    });
  }
}

/**
 * Helper to get authenticated user ID
 * Throws error if user is not authenticated
 */
export function getAuthenticatedUserId(request: FastifyRequest): string {
  if (!request.user) {
    throw new Error('User not authenticated');
  }
  return request.user.id;
}
