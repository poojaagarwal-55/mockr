import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate, getAuthenticatedUserId } from '../middleware/auth.js';
import * as questionService from '../services/question-service.js';
import { isContestVisibleToUser } from '../services/contest-service.js';
import { prisma } from '../lib/prisma.js';
import { z } from 'zod';

const contestQuestionsParamsSchema = z.object({
  contestId: z.string().trim().min(1).max(140),
});

const contestQuestionsQuerySchema = z.object({
  phase: z.enum(['dsa', 'mcq']).default('dsa'),
});

async function isDsaPhaseUnlocked(contestId: string, userId: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{
    roundFlow: string | null;
    mcqCount: string | number;
    mcqStatus: string | null;
  }>>(
    `SELECT
      c.round_flow AS "roundFlow",
      (
        SELECT COUNT(*)::text
        FROM contest_questions cq
        WHERE cq.contest_id = c.id
          AND COALESCE(cq.question_type, 'dsa') = 'mcq'
          AND COALESCE(cq.phase, 'dsa') = 'mcq'
      ) AS "mcqCount",
      (
        SELECT cra.status
        FROM contest_round_attempts cra
        WHERE cra.contest_id = c.id
          AND cra.user_id = $2
          AND cra.round_type = 'mcq'
        LIMIT 1
      ) AS "mcqStatus"
     FROM contests c
     WHERE c.id = $1
     LIMIT 1`,
    contestId,
    userId
  );

  const row = rows[0];
  if (row?.roundFlow === 'mcq_only') return false;
  if (!row || row.roundFlow !== 'mcq_then_dsa') return true;
  if (Number(row.mcqCount || 0) === 0) return true;
  return row.mcqStatus === 'submitted' || row.mcqStatus === 'auto_submitted';
}

/**
 * Question Routes
 * Handles question retrieval for contests
 */
export async function questionRoutes(fastify: FastifyInstance) {
  /**
   * GET /contests/:contestId/questions
   * Get all questions for a contest
   * Requires user to be registered for the contest
   */
  fastify.get(
    '/contests/:contestId/questions',
    {
      preHandler: [authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const params = contestQuestionsParamsSchema.safeParse(request.params);
        if (!params.success) {
          return reply.status(400).send({
            error: 'Validation Error',
            details: params.error.flatten().fieldErrors,
          });
        }

        const { contestId } = params.data;
        const query = contestQuestionsQuerySchema.safeParse(request.query || {});
        if (!query.success) {
          return reply.status(400).send({
            error: 'Validation Error',
            details: query.error.flatten().fieldErrors,
          });
        }
        const userId = request.user!.id;

        const contest = await prisma.contest.findUnique({
          where: { id: contestId },
          select: {
            status: true,
            startTime: true,
            endTime: true,
          },
        });

        if (!contest) {
          return reply.status(404).send({
            error: 'Not Found',
            message: 'Contest not found',
          });
        }

        if (!(await isContestVisibleToUser(contestId, userId))) {
          return reply.status(404).send({
            error: 'Not Found',
            message: 'Contest not found',
          });
        }

        const now = new Date();
        const hasEnded = contest.status === 'ENDED' || contest.endTime <= now;
        const hasStarted = contest.status === 'ACTIVE' || contest.status === 'ENDED' || contest.startTime <= now;

        if (!hasStarted && !hasEnded) {
          return reply.status(403).send({
            error: 'Forbidden',
            message: 'Questions are available only after the contest starts',
          });
        }

        if (!hasEnded) {
          const participant = await prisma.contestParticipant.findUnique({
            where: {
              contestId_userId: {
                contestId,
                userId,
              },
            },
            select: { userId: true },
          });

          if (!participant) {
            return reply.status(403).send({
              error: 'Forbidden',
              message: 'You are not registered for this contest',
            });
          }
        }

        if (!hasEnded && query.data.phase === 'dsa' && !(await isDsaPhaseUnlocked(contestId, userId))) {
          return reply.status(403).send({
            error: 'Forbidden',
            message: 'Submit the MCQ round before opening coding questions',
          });
        }

        const questions = await questionService.getContestQuestions(contestId, userId, query.data.phase);

        return reply.send({
          success: true,
          questions,
        });
      } catch (error: any) {
        if (String(error.message || '').startsWith('Contest questions are still loading')) {
          request.log.warn({
            contestId: (request.params as { contestId?: string }).contestId,
            missingQuestionIds: Array.isArray(error.missingQuestionIds) ? error.missingQuestionIds : undefined,
          }, 'Contest questions still loading');

          return reply.status(503).send({
            error: 'Service Unavailable',
            message: error.message,
          });
        }

        request.log.error({ error }, 'Failed to get contest questions');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to get contest questions',
        });
      }
    }
  );

  /**
   * GET /contests/:contestId/question-solvers
   * Distinct count of participants who fully solved (ACCEPTED) each coding
   * question in the contest. Used to show "N solvers" next to each question.
   */
  fastify.get(
    '/contests/:contestId/question-solvers',
    {
      preHandler: [authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const paramsValidation = contestQuestionsParamsSchema.safeParse(request.params);
        if (!paramsValidation.success) {
          return reply.status(400).send({
            error: 'Validation Error',
            details: paramsValidation.error.flatten().fieldErrors,
          });
        }

        const { contestId } = paramsValidation.data;
        const userId = getAuthenticatedUserId(request);

        const contest = await prisma.contest.findUnique({
          where: { id: contestId },
          select: { id: true },
        });
        if (!contest) {
          return reply.status(404).send({ error: 'Not Found', message: 'Contest not found' });
        }
        if (!(await isContestVisibleToUser(contestId, userId))) {
          return reply.status(404).send({ error: 'Not Found', message: 'Contest not found' });
        }

        const rows = await prisma.$queryRawUnsafe<Array<{ questionId: string; solverCount: number }>>(
          `SELECT cs.question_id AS "questionId", COUNT(DISTINCT cs.user_id)::int AS "solverCount"
           FROM contest_submissions cs
           WHERE cs.contest_id = $1
             AND cs.status = 'ACCEPTED'
           GROUP BY cs.question_id`,
          contestId
        );

        const counts: Record<string, number> = {};
        for (const row of rows) {
          counts[row.questionId] = Number(row.solverCount || 0);
        }

        return reply.send({ success: true, counts });
      } catch (error: any) {
        request.log.error({ error }, 'Failed to get question solver counts');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to get question solver counts',
        });
      }
    }
  );

  /**
   * GET /questions/:questionId
   * Get a single question by ID
   * Requires authentication
   */
  fastify.get(
    '/questions/:questionId',
    {
      preHandler: [authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { questionId } = request.params as { questionId: string };
        const question = await questionService.getQuestionById(questionId);

        return reply.send({
          success: true,
          question,
        });
      } catch (error: any) {
        if (error.message === 'Question not found') {
          return reply.status(404).send({
            error: 'Not Found',
            message: 'Question not found',
          });
        }

        request.log.error({ error }, 'Failed to get question');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to get question',
        });
      }
    }
  );
}
