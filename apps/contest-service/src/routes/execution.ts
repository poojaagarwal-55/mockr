import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate, getAuthenticatedUserId } from '../middleware/auth.js';
import { runCodeSchema, submitCodeSchema, RunCodeRequest, SubmitCodeRequest } from '../types/execution.js';
import * as executionService from '../services/execution-service.js';
import * as submissionValidator from '../services/submission-validator.js';
import * as idempotencyService from '../services/idempotency-service.js';
import { rateLimiters } from '../lib/rate-limiter.js';
import { SupportedLanguage } from '../lib/judge0-client.js';
import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/redis.js';
import { env } from '../lib/env.js';
import { isContestVisibleToUser } from '../services/contest-service.js';

async function validateDsaRoundUnlockedForSubmission(contestId: string, userId: string, questionId: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{
    questionType: string | null;
    roundFlow: string | null;
    mcqCount: string | number;
    mcqStatus: string | null;
  }>>(
    `SELECT
      COALESCE(cq.question_type, 'dsa') AS "questionType",
      c.round_flow AS "roundFlow",
      (
        SELECT COUNT(*)::text
        FROM contest_questions mcq
        WHERE mcq.contest_id = c.id
          AND COALESCE(mcq.question_type, 'dsa') = 'mcq'
          AND COALESCE(mcq.phase, 'dsa') = 'mcq'
      ) AS "mcqCount",
      (
        SELECT cra.status
        FROM contest_round_attempts cra
        WHERE cra.contest_id = c.id
          AND cra.user_id = $2
          AND cra.round_type = 'mcq'
        LIMIT 1
      ) AS "mcqStatus"
     FROM contest_questions cq
     INNER JOIN contests c ON c.id = cq.contest_id
     WHERE cq.contest_id = $1
       AND cq.question_id = $3
     LIMIT 1`,
    contestId,
    userId,
    questionId
  );

  const row = rows[0];
  if (!row) return { allowed: true };
  if (row.questionType === 'mcq') {
    return { allowed: false, message: 'MCQ answers cannot be submitted through the coding executor' };
  }
  if (row.roundFlow === 'mcq_only') {
    return { allowed: false, message: 'Coding submissions are not available in an MCQ only contest' };
  }
  if (row.roundFlow !== 'mcq_then_dsa' || Number(row.mcqCount || 0) === 0) {
    return { allowed: true };
  }
  if (row.mcqStatus === 'submitted' || row.mcqStatus === 'auto_submitted') {
    return { allowed: true };
  }
  return { allowed: false, message: 'Submit the MCQ round before submitting coding questions' };
}

/**
 * Execution Routes
 * Handles code execution (run and submit)
 */
export async function executionRoutes(fastify: FastifyInstance) {
  /**
   * GET /contests/:contestId/submissions
   * Get user's submissions for a contest, optionally filtered by questionId
   * Powers the Submissions tab in the contest solve page
   */
  fastify.get(
    '/contests/:contestId/submissions',
    {
      preHandler: [authenticate],
    },
    async (
      request: FastifyRequest<{
        Params: { contestId: string };
        Querystring: { questionId?: string };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const userId = getAuthenticatedUserId(request);
        const { contestId } = request.params;
        const { questionId } = request.query;

        if (!(await isContestVisibleToUser(contestId, userId))) {
          return reply.status(404).send({
            error: 'Not Found',
            message: 'Contest not found',
          });
        }

        const submissions = await prisma.contestSubmission.findMany({
          where: {
            contestId,
            userId,
            ...(questionId ? { questionId } : {}),
          },
          orderBy: { submittedAt: 'desc' },
          select: {
            id: true,
            questionId: true,
            language: true,
            status: true,
            attemptNumber: true,
            pointsAwarded: true,
            testCasesPassed: true,
            testCasesTotal: true,
            executionTime: true,
            memoryUsed: true,
            submittedAt: true,
            code: true,
          },
        });

        return reply.send({ success: true, submissions });
      } catch (error: any) {
        request.log.error({ error }, 'Failed to get contest submissions');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to get contest submissions',
        });
      }
    }
  );

  /**
   * GET /execute/submission/:id
   * Get submission status (for polling when WebSocket disconnected)
   */
  fastify.get(
    '/execute/submission/:id',
    {
      preHandler: [authenticate],
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const userId = getAuthenticatedUserId(request);
        const { id } = request.params;

        // Fetch submission
        const submission = await prisma.contestSubmission.findUnique({
          where: { id },
        });

        if (!submission) {
          return reply.status(404).send({
            error: 'Not Found',
            message: 'Submission not found',
          });
        }

        // Verify user owns this submission
        if (submission.userId !== userId) {
          return reply.status(403).send({
            error: 'Forbidden',
            message: 'You do not have access to this submission',
          });
        }

        if (!(await isContestVisibleToUser(submission.contestId, userId))) {
          return reply.status(404).send({
            error: 'Not Found',
            message: 'Contest not found',
          });
        }

        const parseCachedResult = (value: unknown) => {
          if (!value) return null;
          if (typeof value === 'string') {
            try {
              return JSON.parse(value);
            } catch {
              return null;
            }
          }
          return value;
        };

        const getCachedSubmissionResult = async () => {
          try {
            return await redis.get<{
              submissionId: string;
              failedTest?: {
                source: 'hidden';
                status?: string;
                input: string;
                expected: string;
                actual: string;
                stderr?: string;
                compileOutput?: string;
              };
              errorDetails?: string;
            }>(`submission:result:${id}`);
          } catch {
            return null;
          }
        };

        let cachedResultRaw = await getCachedSubmissionResult();
        let cachedResult = parseCachedResult(cachedResultRaw);
        if (
          !cachedResult &&
          !['QUEUED', 'PROCESSING', 'JUDGING_DEFERRED'].includes(submission.status)
        ) {
          await new Promise((resolve) => setTimeout(resolve, 150));
          cachedResultRaw = await getCachedSubmissionResult();
          cachedResult = parseCachedResult(cachedResultRaw);
        }
        const cachedResultMatches = cachedResult?.submissionId === id;
        const cachedFailedTest = cachedResultMatches ? cachedResult.failedTest : undefined;
        const cachedErrorDetails = cachedResultMatches ? cachedResult.errorDetails : undefined;
        const isTerminal = !['QUEUED', 'PROCESSING', 'JUDGING_DEFERRED'].includes(submission.status);
        const fallbackErrorDetails =
          isTerminal && submission.status !== 'ACCEPTED' && !cachedFailedTest && !cachedErrorDetails
            ? 'Detailed judge output is no longer available for this submission.'
            : undefined;

        return reply.send({
          success: true,
          submission: {
            id: submission.id,
            status: submission.status,
            testCasesPassed: submission.testCasesPassed,
            testCasesTotal: submission.testCasesTotal,
            pointsAwarded: submission.pointsAwarded,
            executionTime: submission.executionTime,
            memoryUsed: submission.memoryUsed,
            attemptNumber: submission.attemptNumber,
            submittedAt: submission.submittedAt,
            failedTest: cachedFailedTest,
            errorDetails: cachedErrorDetails ?? fallbackErrorDetails,
          },
        });
      } catch (error: any) {
        request.log.error({ error }, 'Failed to get submission');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to get submission',
        });
      }
    }
  );

  /**
   * POST /execute/run
   * Run code against sample test cases
   * Returns results immediately
   */
  fastify.post(
    '/execute/run',
    {
      preHandler: [authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const userId = getAuthenticatedUserId(request);

        // Rate limiting - 5 requests per minute
        const rateLimit = await rateLimiters.codeRun(userId);
        if (!rateLimit.allowed) {
          return reply.status(429).send({
            error: 'Too Many Requests',
            message: 'Rate limit exceeded for code execution',
            retryAfter: Math.ceil(rateLimit.retryAfterMs / 1000),
          });
        }

        // Validate request
        const validation = runCodeSchema.safeParse(request.body);
        if (!validation.success) {
          return reply.status(400).send({
            error: 'Validation Error',
            details: validation.error.flatten().fieldErrors,
          });
        }

        const { code, language, questionId, customTests } = validation.data;

        // Execute code
        const result = await executionService.runCode(
          code,
          language as SupportedLanguage,
          questionId,
          customTests
        );

        return reply.send({
          success: true,
          ...result,
        });
      } catch (error: any) {
        if (error.message === 'Question not found') {
          return reply.status(404).send({
            error: 'Not Found',
            message: 'Question not found',
          });
        }

        if (error.message === 'No sample test cases available') {
          return reply.status(400).send({
            error: 'Bad Request',
            message: 'No sample test cases available for this question',
          });
        }

        request.log.error({ error }, 'Failed to run code');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to execute code',
        });
      }
    }
  );

  /**
   * POST /execute/submit
   * Submit code for contest
   * Queues submission for async processing
   */
  fastify.post(
    '/execute/submit',
    {
      preHandler: [authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const userId = getAuthenticatedUserId(request);

        // Validate request
        const validation = submitCodeSchema.safeParse(request.body);
        if (!validation.success) {
          return reply.status(400).send({
            error: 'Validation Error',
            details: validation.error.flatten().fieldErrors,
          });
        }

        const { code, language, questionId, contestId, idempotencyKey } = validation.data;

        if (!(await isContestVisibleToUser(contestId, userId))) {
          return reply.status(404).send({
            error: 'Not Found',
            message: 'Contest not found',
          });
        }

        // Check idempotency key
        const existingSubmission = await idempotencyService.checkIdempotencyKey(idempotencyKey);
        if (existingSubmission) {
          return reply.send({
            success: true,
            submissionId: existingSubmission.id,
            status: existingSubmission.status,
            message: 'Submission already exists (idempotency key matched)',
            attemptNumber: existingSubmission.attemptNumber,
          });
        }

        // Validate contest is active
        const isActive = await submissionValidator.validateContestActive(contestId);
        if (!isActive) {
          return reply.status(400).send({
            error: 'Bad Request',
            message: 'Contest is not active',
          });
        }

        // Validate user is registered
        const isRegistered = await submissionValidator.validateContestParticipant(userId, contestId);
        if (!isRegistered) {
          return reply.status(403).send({
            error: 'Forbidden',
            message: 'You are not registered for this contest',
          });
        }

        const roundAccess = await validateDsaRoundUnlockedForSubmission(contestId, userId, questionId);
        if (!roundAccess.allowed) {
          return reply.status(403).send({
            error: 'Forbidden',
            message: roundAccess.message,
          });
        }

        // Validate submission attempts
        const attemptValidation = await submissionValidator.validateSubmissionAttempt(
          userId,
          contestId,
          questionId
        );

        if (!attemptValidation.allowed) {
          return reply.status(400).send({
            error: 'Bad Request',
            message: attemptValidation.message,
            attemptNumber: attemptValidation.attemptNumber,
            remainingAttempts: attemptValidation.remainingAttempts,
          });
        }

        // Check for duplicate submission (same code in a short cooldown window)
        const contentHash = idempotencyService.generateContentHash(code, language, questionId);
        const duplicateCheck = await idempotencyService.checkDuplicateSubmission(
          userId,
          contestId,
          contentHash
        );

        if (duplicateCheck.isDuplicate) {
          const retryAfterSeconds = Math.max(1, duplicateCheck.retryAfterSeconds);
          return reply.status(400).send({
            error: 'Bad Request',
            code: 'DUPLICATE_SUBMISSION',
            message: `Duplicate submission detected. Please wait ${retryAfterSeconds} seconds before submitting the same code again.`,
            retryAfterSeconds,
            cooldownSeconds: duplicateCheck.cooldownSeconds,
          });
        }

        // Get question to determine test case count
        const contestQuestion = await prisma.contestQuestion.findUnique({
          where: {
            contestId_questionId: {
              contestId,
              questionId,
            },
          },
        });

        if (!contestQuestion) {
          return reply.status(404).send({
            error: 'Not Found',
            message: 'Question not found in this contest',
          });
        }

        // Backpressure: if the queue is deeply backed up (e.g. Judge0 outage
        // during a contest), shed load instead of unboundedly growing Redis and
        // the submissions table. FAIL OPEN — a stats error never blocks a submit.
        if (env.QUEUE_MAX_WAITING > 0) {
          try {
            const { getQueueStats } = await import('../lib/queue.js');
            const stats = await getQueueStats();
            if (stats.waiting >= env.QUEUE_MAX_WAITING) {
              return reply.status(503).send({
                error: 'Service Unavailable',
                message: 'The judge is very busy right now. Your code was NOT submitted — please try again in a few seconds.',
                retryable: true,
              });
            }
          } catch {
            // Never block a submission because the queue-depth probe failed.
          }
        }

        // Create submission record with QUEUED status
        const submission = await prisma.contestSubmission.create({
          data: {
            contestId,
            questionId,
            userId,
            code,
            language,
            status: 'QUEUED',
            attemptNumber: attemptValidation.attemptNumber,
            pointsAwarded: 0,
            testCasesTotal: 0, // Will be updated by worker
            idempotencyKey,
          },
        });

        await prisma.$executeRawUnsafe(
          `UPDATE contest_round_attempts
           SET current_question_id = NULL, updated_at = NOW()
           WHERE contest_id = $1
             AND user_id = $2
             AND round_type = 'dsa'
             AND current_question_id = $3
             AND status NOT IN ('submitted', 'auto_submitted')`,
          contestId,
          userId,
          questionId
        );

        // Enqueue submission to Bull queue
        const { enqueueSubmission } = await import('../lib/queue.js');
        await enqueueSubmission({
          submissionId: submission.id,
          userId,
          contestId,
          questionId,
          code,
          language,
          attemptNumber: attemptValidation.attemptNumber,
        });
        
        return reply.status(201).send({
          success: true,
          submissionId: submission.id,
          status: 'QUEUED',
          message: 'Submission queued for processing',
          attemptNumber: attemptValidation.attemptNumber,
          remainingAttempts: attemptValidation.remainingAttempts,
        });
      } catch (error: any) {
        request.log.error({ error }, 'Failed to submit code');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to submit code',
        });
      }
    }
  );
}
