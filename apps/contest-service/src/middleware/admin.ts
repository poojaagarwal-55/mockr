import { FastifyRequest, FastifyReply } from 'fastify';
import { isAdminEmail } from '../lib/admin.js';
import { prisma } from '../lib/prisma.js';
import { getAuthenticatedUserId } from './auth.js';

const CONTEST_CREATOR_ROLE = 'contest_creator';

async function hasContestManagerRole(userId: string, email?: string | null): Promise<boolean> {
  if (isAdminEmail(email)) return true;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });

  return user?.role === CONTEST_CREATOR_ROLE;
}

/**
 * Admin middleware
 * Verifies that the authenticated user has admin role
 * Must be used AFTER authenticate middleware
 */
export async function verifyAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    // Get authenticated user (throws if not authenticated)
    const userId = getAuthenticatedUserId(request);

    // Verify admin role
    const email = request.user?.email;
    if (!isAdminEmail(email)) {
      request.log.warn({ userId, email }, 'Non-admin attempted admin route');

      // Return 404 instead of 403 to not reveal admin routes exist
      return reply.status(404).send({
        error: 'Not Found',
      });
    }

    // User is admin - continue to route handler
  } catch (err) {
    request.log.error({ err }, 'Admin verification error');
    return reply.status(401).send({
      error: 'Unauthorized',
      message: 'Admin authentication failed',
    });
  }
}

/**
 * Non-throwing check for whether the authenticated requester may manage this
 * contest (platform admin or contest_creator). Safe to call on routes that are
 * shared between admins and regular participants — returns false when the
 * request is unauthenticated instead of throwing.
 */
export async function requesterIsContestManager(request: FastifyRequest): Promise<boolean> {
  try {
    const userId = getAuthenticatedUserId(request);
    return await hasContestManagerRole(userId, request.user?.email);
  } catch {
    return false;
  }
}

/**
 * Contest manager middleware.
 * Allows platform admins and users with the contest_creator role to manage contests.
 * Must be used AFTER authenticate middleware.
 */
export async function verifyContestManager(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const userId = getAuthenticatedUserId(request);
    const email = request.user?.email;

    if (!(await hasContestManagerRole(userId, email))) {
      request.log.warn({ userId, email }, 'Non-contest-manager attempted contest admin route');
      return reply.status(404).send({
        error: 'Not Found',
      });
    }
  } catch (err) {
    request.log.error({ err }, 'Contest manager verification error');
    return reply.status(401).send({
      error: 'Unauthorized',
      message: 'Contest manager authentication failed',
    });
  }
}
