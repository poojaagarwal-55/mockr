import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { getAuthenticatedUserId } from './auth.js';

/**
 * Contest participant middleware
 * Verifies that the authenticated user is registered for the specified contest
 * Must be used AFTER authenticate middleware
 */
export async function verifyContestParticipant(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    // Get authenticated user ID (throws if not authenticated)
    const userId = getAuthenticatedUserId(request);

    // Extract contest ID from route params
    const params = request.params as { contestId?: string };
    const contestId = params.contestId;

    if (!contestId) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Contest ID is required',
      });
    }

    // Check if user is registered for this contest
    const participant = await prisma.contestParticipant.findUnique({
      where: {
        contestId_userId: {
          contestId,
          userId,
        },
      },
    });

    if (!participant) {
      return reply.status(403).send({
        error: 'Forbidden',
        message: 'You are not registered for this contest',
      });
    }

    // User is a valid participant - continue to route handler
  } catch (err) {
    request.log.error({ err }, 'Contest participant verification error');
    return reply.status(500).send({
      error: 'Internal Server Error',
      message: 'Failed to verify contest participation',
    });
  }
}
