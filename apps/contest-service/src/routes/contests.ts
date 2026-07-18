import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate, getAuthenticatedUserId } from '../middleware/auth.js';
import { verifyContestManager } from '../middleware/admin.js';
import {
  createContestSchema,
  updateContestSchema,
  updateManagedContestSchema,
  addContestQuestionsSchema,
  submitContestSchema,
  contestFeedbackSchema,
  contestIdParamSchema,
  contestTesterParamSchema,
  contestQuerySchema,
  contestTestingTesterBodySchema,
  contestTestingUserSearchQuerySchema,
  unusedQuestionsQuerySchema,
  ContestStatus,
} from '../types/contest.js';
import * as contestService from '../services/contest-service.js';
import { clampParticipantFinalScore } from '../services/scoring-service.js';

async function finalizeParticipantCurrentContestScore(
  fastify: FastifyInstance,
  contestId: string,
  userId: string,
  submissionType: string
) {
  const roundStatus = submissionType === 'auto_time' ? 'auto_submitted' : 'submitted';

  const finalScore = await fastify.prisma.$transaction(async (tx) => {
    const mcqRows = await tx.$queryRawUnsafe<Array<{ questionId: string; phaseOrder: number }>>(
      `SELECT
        question_id AS "questionId",
        COALESCE(phase_order, "order", 0)::int AS "phaseOrder"
       FROM contest_questions
       WHERE contest_id = $1
         AND COALESCE(question_type, 'dsa') = 'mcq'
         AND COALESCE(phase, 'dsa') = 'mcq'
       ORDER BY COALESCE(phase_order, "order", 0), "order"`,
      contestId
    );

    if (mcqRows.length > 0) {
      await tx.$executeRawUnsafe(
        `INSERT INTO contest_mcq_answers
          (contest_id, question_id, user_id, selected_option_id, status, is_correct, points_awarded, submitted_at, evaluated_at)
         SELECT
          cq.contest_id,
          cq.question_id,
          $2,
          NULL,
          'submitted',
          false,
          0,
          NOW(),
          NOW()
         FROM contest_questions cq
         WHERE cq.contest_id = $1
           AND COALESCE(cq.question_type, 'dsa') = 'mcq'
           AND COALESCE(cq.phase, 'dsa') = 'mcq'
         ON CONFLICT (contest_id, question_id, user_id) DO NOTHING`,
        contestId,
        userId
      );

      await tx.$executeRawUnsafe(
        `UPDATE contest_mcq_answers
         SET
          status = 'submitted',
          is_correct = COALESCE(is_correct, false),
          points_awarded = COALESCE(points_awarded, 0),
          submitted_at = COALESCE(submitted_at, NOW()),
          evaluated_at = COALESCE(evaluated_at, NOW()),
          updated_at = NOW()
         WHERE contest_id = $1
           AND user_id = $2
           AND status <> 'submitted'`,
        contestId,
        userId
      );
    }

    const [mcqScoreRows, dsaScoreRows, dsaQuestionRows] = await Promise.all([
      tx.$queryRawUnsafe<Array<{ score: number }>>(
        `SELECT COALESCE(SUM(points_awarded), 0)::int AS score
         FROM contest_mcq_answers
         WHERE contest_id = $1
           AND user_id = $2
           AND status = 'submitted'`,
        contestId,
        userId
      ),
      tx.$queryRawUnsafe<Array<{ score: number }>>(
        `SELECT COALESCE(SUM(cs.points_awarded), 0)::int AS score
         FROM contest_submissions cs
         INNER JOIN contest_questions cq
           ON cq.contest_id = cs.contest_id
          AND cq.question_id = cs.question_id
         WHERE cs.contest_id = $1
           AND cs.user_id = $2
           AND COALESCE(cq.question_type, 'dsa') = 'dsa'
           AND COALESCE(cq.phase, 'dsa') = 'dsa'`,
        contestId,
        userId
      ),
      tx.$queryRawUnsafe<Array<{ count: number }>>(
        `SELECT COUNT(*)::int AS count
         FROM contest_questions
         WHERE contest_id = $1
           AND COALESCE(question_type, 'dsa') = 'dsa'
           AND COALESCE(phase, 'dsa') = 'dsa'`,
        contestId
      ),
    ]);

    const mcqScore = Number(mcqScoreRows[0]?.score || 0);
    const dsaScore = Number(dsaScoreRows[0]?.score || 0);
    const dsaQuestionCount = Number(dsaQuestionRows[0]?.count || 0);

    if (mcqRows.length > 0) {
      await tx.$executeRawUnsafe(
        `INSERT INTO contest_round_attempts
          (contest_id, user_id, round_type, status, score_awarded, last_submitted_order, submission_type, submitted_at, started_at)
         VALUES ($1, $2, 'mcq', $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (contest_id, user_id, round_type)
         DO UPDATE SET
          status = $3,
          score_awarded = $4,
          last_submitted_order = GREATEST(contest_round_attempts.last_submitted_order, $5),
          current_question_id = NULL,
          submission_type = $6,
          submitted_at = COALESCE(contest_round_attempts.submitted_at, NOW()),
          updated_at = NOW()`,
        contestId,
        userId,
        roundStatus,
        mcqScore,
        mcqRows.length - 1,
        submissionType
      );
    }

    if (dsaQuestionCount > 0) {
      await tx.$executeRawUnsafe(
        `INSERT INTO contest_round_attempts
          (contest_id, user_id, round_type, status, score_awarded, submission_type, submitted_at, started_at)
         VALUES ($1, $2, 'dsa', $3, $4, $5, NOW(), NOW())
         ON CONFLICT (contest_id, user_id, round_type)
         DO UPDATE SET
          status = $3,
          score_awarded = $4,
          current_question_id = NULL,
          submission_type = $5,
          submitted_at = COALESCE(contest_round_attempts.submitted_at, NOW()),
          updated_at = NOW()`,
        contestId,
        userId,
        roundStatus,
        dsaScore,
        submissionType
      );
    }

    const nextTotalScore = mcqScore + dsaScore;
    await tx.contestParticipant.update({
      where: { contestId_userId: { contestId, userId } },
      data: { totalScore: nextTotalScore },
    });

    return nextTotalScore;
  });

  return finalScore;
}

/**
 * Contest Routes
 * Handles contest CRUD operations
 */
export async function contestRoutes(fastify: FastifyInstance) {
  /**
   * GET /admin/contest-instructions/template
   * Get the current admin's saved contest instruction template.
   */
  fastify.get(
    '/admin/contest-instructions/template',
    {
      preHandler: [authenticate, verifyContestManager],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const adminId = getAuthenticatedUserId(request);
        const instructions = await contestService.getAdminContestInstructionTemplate(adminId);
        return reply.send({ instructions });
      } catch (error: any) {
        request.log.error({ error }, 'Failed to get contest instruction template');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to get contest instruction template',
        });
      }
    }
  );

  /**
   * GET /admin/contests
   * Get the contest-manager list, including archived/testing contests.
   */
  fastify.get(
    '/admin/contests',
    {
      preHandler: [authenticate, verifyContestManager],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const validation = contestQuerySchema.safeParse(request.query);
        if (!validation.success) {
          return reply.status(400).send({
            error: 'Validation Error',
            details: validation.error.flatten().fieldErrors,
          });
        }

        const { status, limit, offset } = validation.data;
        const result = await contestService.getContests(status, limit, offset, {
          includeHidden: true,
        });

        return reply.send(result);
      } catch (error: any) {
        request.log.error({ error }, 'Failed to get admin contests');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to get contests',
        });
      }
    }
  );

  /**
   * GET /admin/contest-testing/testers
   * List the current contest manager's global testing allowlist.
   */
  fastify.get(
    '/admin/contest-testing/testers',
    {
      preHandler: [authenticate, verifyContestManager],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const ownerId = getAuthenticatedUserId(request);
        const testers = await contestService.getContestTestingTesters(ownerId);
        return reply.send({ success: true, testers });
      } catch (error: any) {
        request.log.error({ error }, 'Failed to get contest testing testers');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to get testing emails',
        });
      }
    }
  );

  /**
   * GET /admin/contest-testing/users
   * Search users to add to the current contest manager's testing allowlist.
   */
  fastify.get(
    '/admin/contest-testing/users',
    {
      preHandler: [authenticate, verifyContestManager],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const validation = contestTestingUserSearchQuerySchema.safeParse(request.query);
        if (!validation.success) {
          return reply.status(400).send({
            error: 'Validation Error',
            details: validation.error.flatten().fieldErrors,
          });
        }

        const ownerId = getAuthenticatedUserId(request);
        const users = await contestService.searchContestTestingUsers(
          ownerId,
          validation.data.query,
          validation.data.limit
        );
        return reply.send({ success: true, users });
      } catch (error: any) {
        request.log.error({ error }, 'Failed to search contest testing users');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to search users',
        });
      }
    }
  );

  /**
   * POST /admin/contest-testing/testers
   * Add one user to the current contest manager's testing allowlist.
   */
  fastify.post(
    '/admin/contest-testing/testers',
    {
      preHandler: [authenticate, verifyContestManager],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const validation = contestTestingTesterBodySchema.safeParse(request.body);
        if (!validation.success) {
          return reply.status(400).send({
            error: 'Validation Error',
            details: validation.error.flatten().fieldErrors,
          });
        }

        const ownerId = getAuthenticatedUserId(request);
        const tester = await contestService.addContestTestingTester(ownerId, validation.data.userId);
        return reply.status(201).send({ success: true, tester });
      } catch (error: any) {
        if (error.message === 'User not found') {
          return reply.status(404).send({
            error: 'Not Found',
            message: 'User not found',
          });
        }

        request.log.error({ error }, 'Failed to add contest testing tester');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to add testing email',
        });
      }
    }
  );

  /**
   * DELETE /admin/contest-testing/testers/:userId
   * Remove one user from the current contest manager's testing allowlist.
   */
  fastify.delete(
    '/admin/contest-testing/testers/:userId',
    {
      preHandler: [authenticate, verifyContestManager],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const validation = contestTesterParamSchema.safeParse(request.params);
        if (!validation.success) {
          return reply.status(400).send({
            error: 'Validation Error',
            details: validation.error.flatten().fieldErrors,
          });
        }

        const ownerId = getAuthenticatedUserId(request);
        await contestService.removeContestTestingTester(ownerId, validation.data.userId);
        return reply.send({ success: true });
      } catch (error: any) {
        request.log.error({ error }, 'Failed to remove contest testing tester');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to remove testing email',
        });
      }
    }
  );

  /**
   * POST /contests
   * Create a new contest (Admin only)
   */
  fastify.post(
    '/contests',
    {
      preHandler: [authenticate, verifyContestManager],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const validation = createContestSchema.safeParse(request.body);
        if (!validation.success) {
          return reply.status(400).send({
            error: 'Validation Error',
            details: validation.error.flatten().fieldErrors,
          });
        }

        const adminId = getAuthenticatedUserId(request);
        const contest = await contestService.createContest(validation.data, adminId);

        return reply.status(201).send({
          success: true,
          contest,
        });
      } catch (error: any) {
        if (String(error.message || '').startsWith('Questions not found')) {
          return reply.status(400).send({
            error: 'Bad Request',
            message: error.message,
          });
        }

        request.log.error({ error }, 'Failed to create contest');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to create contest',
        });
      }
    }
  );

  /**
   * GET /contests
   * Get all contests with optional filtering
   */
  fastify.get(
    '/contests',
    {
      preHandler: [authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const validation = contestQuerySchema.safeParse(request.query);
        if (!validation.success) {
          return reply.status(400).send({
            error: 'Validation Error',
            details: validation.error.flatten().fieldErrors,
          });
        }

        const { status, limit, offset } = validation.data;
        const userId = getAuthenticatedUserId(request);
        const result = await contestService.getContests(status, limit, offset, {
          viewerId: userId,
        });

        return reply.send(result);
      } catch (error: any) {
        request.log.error({ error }, 'Failed to get contests');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to get contests',
        });
      }
    }
  );

  /**
   * GET /contests/:id
   * Get contest by ID
   */
  fastify.get(
    '/contests/:id',
    {
      preHandler: [authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { id } = request.params as { id: string };
        const userId = getAuthenticatedUserId(request);
        const contest = await contestService.getContestById(id, userId);

        return reply.send({ contest });
      } catch (error: any) {
        if (error.message === 'Contest not found') {
          return reply.status(404).send({
            error: 'Not Found',
            message: 'Contest not found',
          });
        }

        request.log.error({ error }, 'Failed to get contest');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to get contest',
        });
      }
    }
  );

  /**
   * PUT /contests/:id
   * Update contest (Admin only)
   */
  fastify.put(
    '/contests/:id',
    {
      preHandler: [authenticate, verifyContestManager],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { id } = request.params as { id: string };
        const validation = updateContestSchema.safeParse(request.body);
        
        if (!validation.success) {
          return reply.status(400).send({
            error: 'Validation Error',
            details: validation.error.flatten().fieldErrors,
          });
        }

        const contest = await contestService.updateContest(id, validation.data);

        return reply.send({
          success: true,
          contest,
        });
      } catch (error: any) {
        if (error.message === 'Contest not found') {
          return reply.status(404).send({
            error: 'Not Found',
            message: 'Contest not found',
          });
        }

        request.log.error({ error }, 'Failed to update contest');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to update contest',
        });
      }
    }
  );

  /**
   * GET /admin/contests/:id/manage
   * Load the full contest management payload with current question settings.
   */
  fastify.get(
    '/admin/contests/:id/manage',
    {
      preHandler: [authenticate, verifyContestManager],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const paramsValidation = contestIdParamSchema.safeParse(request.params);
        if (!paramsValidation.success) {
          return reply.status(400).send({
            error: 'Validation Error',
            details: paramsValidation.error.flatten().fieldErrors,
          });
        }

        const contest = await contestService.getManagedContestById(paramsValidation.data.id);
        return reply.send({ success: true, contest });
      } catch (error: any) {
        if (error.message === 'Contest not found') {
          return reply.status(404).send({
            error: 'Not Found',
            message: 'Contest not found',
          });
        }

        request.log.error({ error }, 'Failed to load managed contest');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to load managed contest',
        });
      }
    }
  );

  /**
   * PUT /admin/contests/:id/manage
   * Update contest details, instructions, scoring, and question selection.
   */
  fastify.put(
    '/admin/contests/:id/manage',
    {
      preHandler: [authenticate, verifyContestManager],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const paramsValidation = contestIdParamSchema.safeParse(request.params);
        if (!paramsValidation.success) {
          return reply.status(400).send({
            error: 'Validation Error',
            details: paramsValidation.error.flatten().fieldErrors,
          });
        }

        const bodyValidation = updateManagedContestSchema.safeParse(request.body);
        if (!bodyValidation.success) {
          return reply.status(400).send({
            error: 'Validation Error',
            details: bodyValidation.error.flatten().fieldErrors,
          });
        }

        const contest = await contestService.updateManagedContest(
          paramsValidation.data.id,
          bodyValidation.data
        );

        return reply.send({
          success: true,
          contest,
        });
      } catch (error: any) {
        if (error.message === 'Contest not found') {
          return reply.status(404).send({
            error: 'Not Found',
            message: 'Contest not found',
          });
        }

        if (
          error.message === 'Select at least one question' ||
          error.message === 'Cannot remove questions that already have submissions' ||
          error.message === 'Cannot change question selection or scoring after submissions exist' ||
          String(error.message || '').startsWith('Questions not found')
        ) {
          return reply.status(400).send({
            error: 'Bad Request',
            message: error.message,
          });
        }

        request.log.error({ error }, 'Failed to update managed contest');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to update managed contest',
        });
      }
    }
  );

  /**
   * POST /admin/contests/:id/questions
   * Add questions to a contest (Admin only)
   */
  fastify.post(
    '/admin/contests/:id/questions',
    {
      preHandler: [authenticate, verifyContestManager],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const paramsValidation = contestIdParamSchema.safeParse(request.params);
        if (!paramsValidation.success) {
          return reply.status(400).send({
            error: 'Validation Error',
            details: paramsValidation.error.flatten().fieldErrors,
          });
        }

        const bodyValidation = addContestQuestionsSchema.safeParse(request.body);
        if (!bodyValidation.success) {
          return reply.status(400).send({
            error: 'Validation Error',
            details: bodyValidation.error.flatten().fieldErrors,
          });
        }

        const result = await contestService.addQuestionsToContest(
          paramsValidation.data.id,
          bodyValidation.data
        );

        return reply.send({
          success: true,
          ...result,
        });
      } catch (error: any) {
        if (error.message === 'Contest not found') {
          return reply.status(404).send({
            error: 'Not Found',
            message: 'Contest not found',
          });
        }

        if (String(error.message || '').startsWith('Questions not found')) {
          return reply.status(400).send({
            error: 'Bad Request',
            message: error.message,
          });
        }

        request.log.error({ error }, 'Failed to add questions to contest');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to add questions to contest',
        });
      }
    }
  );

  /**
   * DELETE /contests/:id
   * Delete contest (Admin only)
   */
  fastify.delete(
    '/contests/:id',
    {
      preHandler: [authenticate, verifyContestManager],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { id } = request.params as { id: string };
        await contestService.deleteContest(id);

        return reply.send({
          success: true,
          message: 'Contest deleted successfully',
        });
      } catch (error: any) {
        if (error.message === 'Contest not found') {
          return reply.status(404).send({
            error: 'Not Found',
            message: 'Contest not found',
          });
        }

        request.log.error({ error }, 'Failed to delete contest');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to delete contest',
        });
      }
    }
  );

  /**
   * GET /admin/questions/unused
   * Get unused questions (Admin only)
   */
  fastify.get(
    '/admin/questions/unused',
    {
      preHandler: [authenticate, verifyContestManager],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const validation = unusedQuestionsQuerySchema.safeParse(request.query);
        if (!validation.success) {
          return reply.status(400).send({
            error: 'Validation Error',
            details: validation.error.flatten().fieldErrors,
          });
        }

        const { difficulty, topic, used, limit, offset } = validation.data;
        const result = await contestService.getUnusedQuestions(difficulty, topic, used, limit, offset);

        return reply.send(result);
      } catch (error: any) {
        request.log.error({ error }, 'Failed to get unused questions');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to get unused questions',
        });
      }
    }
  );

  /**
   * POST /contests/:id/register
   * Register for a contest
   */
  fastify.post(
    '/contests/:id/register',
    {
      preHandler: [authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { id: contestId } = request.params as { id: string };
        const userId = getAuthenticatedUserId(request);

        // Check if contest exists
        const contest = await contestService.getContestById(contestId, userId);

        // Check if contest is upcoming or active. Use endTime as the source of
        // truth so registration is not dependent on the status reconciler tick.
        const contestEndAt = new Date(contest.endTime).getTime();
        if (
          contest.status === ContestStatus.ENDED ||
          (Number.isFinite(contestEndAt) && Date.now() >= contestEndAt)
        ) {
          return reply.status(400).send({
            error: 'Bad Request',
            message: 'Cannot register for ended contest',
          });
        }

        // Check if already registered
        const existing = await fastify.prisma.contestParticipant.findUnique({
          where: {
            contestId_userId: {
              contestId,
              userId,
            },
          },
        });

        if (existing) {
          return reply.status(400).send({
            error: 'Bad Request',
            message: 'Already registered for this contest',
          });
        }

        // Create participant
        const participant = await fastify.prisma.contestParticipant.create({
          data: {
            contestId,
            userId,
            totalScore: 0,
          },
        });

        return reply.status(201).send({
          success: true,
          message: 'Successfully registered for contest',
          participant,
        });
      } catch (error: any) {
        if (error.message === 'Contest not found') {
          return reply.status(404).send({
            error: 'Not Found',
            message: 'Contest not found',
          });
        }

        request.log.error({ error }, 'Failed to register for contest');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to register for contest',
        });
      }
    }
  );

  /**
   * POST /contests/:id/submit
   * Submit contest (marks as completed, prevents further attempts)
   * Can be manual, automatic (time end), or due to tab switching
   */
  fastify.post(
    '/contests/:id/submit',
    {
      preHandler: [authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { id: contestId } = request.params as { id: string };
        const userId = getAuthenticatedUserId(request);
        const validation = submitContestSchema.safeParse(request.body || {});
        if (!validation.success) {
          return reply.status(400).send({
            error: 'Validation Error',
            details: validation.error.flatten().fieldErrors,
          });
        }
        const { submissionType } = validation.data;

        // Check if contest exists
        const contest = await contestService.getContestById(contestId, userId);
        const contestEndAt = new Date(contest.endTime).getTime();
        if (
          submissionType === 'auto_time' &&
          Number.isFinite(contestEndAt) &&
          Date.now() < contestEndAt
        ) {
          return reply.status(409).send({
            error: 'Conflict',
            message: 'Contest is still active',
            endTime: contest.endTime,
          });
        }

        // Check if user is registered
        const participant = await fastify.prisma.contestParticipant.findUnique({
          where: {
            contestId_userId: {
              contestId,
              userId,
            },
          },
        });

        if (!participant) {
          return reply.status(404).send({
            error: 'Not Found',
            message: 'Not registered for this contest',
          });
        }

        // Fast path: already submitted.
        if (participant.isSubmitted) {
          return reply.status(400).send({
            error: 'Bad Request',
            message: 'Contest already submitted',
            submittedAt: participant.submittedAt,
            submissionType: participant.submissionType,
          });
        }

        // Atomically CLAIM the submit before doing any finalize work. Only the
        // first request for this participant flips is_submitted false→true; any
        // concurrent duplicate (e.g. the timer-end auto-submit firing twice, or
        // the mcq-round + contest submit both landing) claims nothing and returns
        // the already-submitted state instead of re-running finalize. This closes
        // the check-then-act race and prevents redundant finalize work under the
        // contest-end burst.
        const claim = await fastify.prisma.contestParticipant.updateMany({
          where: { contestId, userId, isSubmitted: false },
          data: { isSubmitted: true, submittedAt: new Date(), submissionType },
        });

        if (claim.count === 0) {
          const already = await fastify.prisma.contestParticipant.findUnique({
            where: { contestId_userId: { contestId, userId } },
          });
          return reply.status(200).send({
            success: true,
            message: 'Contest already submitted',
            participant: already,
            submissionType: already?.submissionType ?? submissionType,
            alreadySubmitted: true,
          });
        }

        try {
          await finalizeParticipantCurrentContestScore(fastify, contestId, userId, submissionType);
        } catch (finalizeErr) {
          // Finalize failed — release the claim so the user can retry instead of
          // being stuck "submitted" with an unscored contest.
          await fastify.prisma.contestParticipant
            .updateMany({ where: { contestId, userId }, data: { isSubmitted: false, submittedAt: null } })
            .catch(() => {});
          throw finalizeErr;
        }

        const updated = await fastify.prisma.contestParticipant.findUnique({
          where: { contestId_userId: { contestId, userId } },
        });
        const finalTotalScore = await clampParticipantFinalScore(contestId, userId);
        const submittedParticipant =
          finalTotalScore === null ? updated : { ...updated, totalScore: finalTotalScore };

        return reply.send({
          success: true,
          message: 'Contest submitted successfully',
          participant: submittedParticipant,
          submissionType,
        });
      } catch (error: any) {
        if (error.message === 'Contest not found') {
          return reply.status(404).send({
            error: 'Not Found',
            message: 'Contest not found',
          });
        }

        request.log.error({ error }, 'Failed to submit contest');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to submit contest',
        });
      }
    }
  );

  /**
   * GET /contests/:id/feedback/me
   * Get the current user's feedback for a submitted contest.
   */
  fastify.get(
    '/contests/:id/feedback/me',
    {
      preHandler: [authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const paramsValidation = contestIdParamSchema.safeParse(request.params);
        if (!paramsValidation.success) {
          return reply.status(400).send({
            error: 'Validation Error',
            details: paramsValidation.error.flatten().fieldErrors,
          });
        }

        const contestId = paramsValidation.data.id;
        const userId = getAuthenticatedUserId(request);
        await contestService.getContestById(contestId, userId);

        const participant = await fastify.prisma.contestParticipant.findUnique({
          where: {
            contestId_userId: {
              contestId,
              userId,
            },
          },
          select: {
            id: true,
          },
        });

        if (!participant) {
          return reply.status(404).send({
            error: 'Not Found',
            message: 'Not registered for this contest',
          });
        }

        const feedback = await fastify.prisma.contestFeedback.findUnique({
          where: {
            contestId_userId: {
              contestId,
              userId,
            },
          },
          select: {
            rating: true,
            comment: true,
            createdAt: true,
            updatedAt: true,
          },
        });

        return reply.send({
          success: true,
          feedback,
        });
      } catch (error: any) {
        if (error.message === 'Contest not found') {
          return reply.status(404).send({
            error: 'Not Found',
            message: 'Contest not found',
          });
        }

        request.log.error({ error }, 'Failed to get contest feedback');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to get contest feedback',
        });
      }
    }
  );

  /**
   * POST /contests/:id/feedback
   * Save required post-contest feedback for the current user.
   */
  fastify.post(
    '/contests/:id/feedback',
    {
      preHandler: [authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const paramsValidation = contestIdParamSchema.safeParse(request.params);
        if (!paramsValidation.success) {
          return reply.status(400).send({
            error: 'Validation Error',
            details: paramsValidation.error.flatten().fieldErrors,
          });
        }

        const bodyValidation = contestFeedbackSchema.safeParse(request.body || {});
        if (!bodyValidation.success) {
          return reply.status(400).send({
            error: 'Validation Error',
            details: bodyValidation.error.flatten().fieldErrors,
          });
        }

        const contestId = paramsValidation.data.id;
        const userId = getAuthenticatedUserId(request);
        const contest = await contestService.getContestById(contestId, userId);

        const participant = await fastify.prisma.contestParticipant.findUnique({
          where: {
            contestId_userId: {
              contestId,
              userId,
            },
          },
          select: {
            isSubmitted: true,
          },
        });

        if (!participant) {
          return reply.status(404).send({
            error: 'Not Found',
            message: 'Not registered for this contest',
          });
        }

        const contestEnded = contest.status === ContestStatus.ENDED || new Date(contest.endTime).getTime() <= Date.now();
        if (!participant.isSubmitted && !contestEnded) {
          return reply.status(400).send({
            error: 'Bad Request',
            message: 'Feedback opens after contest submission or contest end',
          });
        }

        const feedback = await fastify.prisma.contestFeedback.upsert({
          where: {
            contestId_userId: {
              contestId,
              userId,
            },
          },
          update: {
            rating: bodyValidation.data.rating,
            comment: bodyValidation.data.comment,
          },
          create: {
            contestId,
            userId,
            rating: bodyValidation.data.rating,
            comment: bodyValidation.data.comment,
          },
          select: {
            rating: true,
            comment: true,
            createdAt: true,
            updatedAt: true,
          },
        });

        return reply.send({
          success: true,
          feedback,
        });
      } catch (error: any) {
        if (error.message === 'Contest not found') {
          return reply.status(404).send({
            error: 'Not Found',
            message: 'Contest not found',
          });
        }

        request.log.error({ error }, 'Failed to save contest feedback');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to save contest feedback',
        });
      }
    }
  );

  /**
   * GET /admin/contests/:id/feedback
   * Admin-only contest feedback report.
   */
  fastify.get(
    '/admin/contests/:id/feedback',
    {
      preHandler: [authenticate, verifyContestManager],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const paramsValidation = contestIdParamSchema.safeParse(request.params);
        if (!paramsValidation.success) {
          return reply.status(400).send({
            error: 'Validation Error',
            details: paramsValidation.error.flatten().fieldErrors,
          });
        }

        const contestId = paramsValidation.data.id;
        await contestService.getContestById(contestId);

        const feedbackRows = await fastify.prisma.contestFeedback.findMany({
          where: {
            contestId,
          },
          orderBy: {
            createdAt: 'desc',
          },
          select: {
            id: true,
            userId: true,
            rating: true,
            comment: true,
            createdAt: true,
            updatedAt: true,
          },
        });

        const userIds = Array.from(new Set(feedbackRows.map((row) => row.userId)));
        const users = userIds.length
          ? await fastify.prisma.user.findMany({
              where: {
                id: {
                  in: userIds,
                },
              },
              select: {
                id: true,
                fullName: true,
                email: true,
                username: true,
              },
            })
          : [];
        const usersById = new Map(users.map((user) => [user.id, user]));

        const distribution = {
          1: 0,
          2: 0,
          3: 0,
          4: 0,
          5: 0,
        };
        let ratingSum = 0;
        for (const row of feedbackRows) {
          ratingSum += row.rating;
          distribution[row.rating as 1 | 2 | 3 | 4 | 5] += 1;
        }

        return reply.send({
          success: true,
          total: feedbackRows.length,
          averageRating: feedbackRows.length ? Number((ratingSum / feedbackRows.length).toFixed(2)) : 0,
          distribution,
          feedback: feedbackRows.map((row) => {
            const user = usersById.get(row.userId);
            return {
              id: row.id,
              userId: row.userId,
              studentName: user?.fullName || user?.username || 'Unknown student',
              email: user?.email || null,
              username: user?.username || null,
              rating: row.rating,
              comment: row.comment,
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
            };
          }),
        });
      } catch (error: any) {
        if (error.message === 'Contest not found') {
          return reply.status(404).send({
            error: 'Not Found',
            message: 'Contest not found',
          });
        }

        request.log.error({ error }, 'Failed to load contest feedback report');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to load contest feedback report',
        });
      }
    }
  );

  /**
   * POST /admin/cache/clear/:contestId
   * Clear cache for a contest (Admin only, for debugging)
   */
  fastify.post(
    '/admin/cache/clear/:contestId',
    {
      preHandler: [authenticate, verifyContestManager],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { contestId } = request.params as { contestId: string };
        
        // Import redis and cache keys
        const { redis } = await import('../lib/redis.js');
        const { CacheKeys } = await import('../lib/redis.js');
        
        // Clear all cache keys for this contest
        await redis.del(CacheKeys.contestDetails(contestId));
        const contestQuestionsKey = CacheKeys.contestQuestions(contestId);
        await redis.del(contestQuestionsKey);
        await redis.del(`${contestQuestionsKey}:ide-v4`);
        await redis.del(`${contestQuestionsKey}:ide-v5`);
        await redis.del(`${contestQuestionsKey}:ide-v6`);
        await redis.del(`${contestQuestionsKey}:ide-v7`);
        await redis.del(`${contestQuestionsKey}:ide-v8`);
        await redis.del(CacheKeys.contestLeaderboard(contestId));
        await redis.del(CacheKeys.generatedContestLeaderboard(contestId));
        
        return reply.send({
          success: true,
          message: `Cache cleared for contest ${contestId}`,
        });
      } catch (error: any) {
        request.log.error({ error }, 'Failed to clear cache');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to clear cache',
        });
      }
    }
  );
}
