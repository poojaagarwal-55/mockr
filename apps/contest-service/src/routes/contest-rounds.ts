import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import mongoose from 'mongoose';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, getAuthenticatedUserId } from '../middleware/auth.js';
import { isContestVisibleToUser } from '../services/contest-service.js';
import { submitContestSchema } from '../types/contest.js';
import { getCachedOrFetch } from '../lib/redis.js';

// MCQ questions and their per-contest config are static once a contest is live, so
// we cache them in Redis to keep per-question loads fast under concurrent load.
const MCQ_ROWS_CACHE_TTL = 600; // 10 min — contest_questions rows rarely change mid-contest
const MCQ_DOC_CACHE_TTL = 10800; // 3 h — the question document content is immutable

const contestIdParamSchema = z.object({
  id: z.string().trim().min(1).max(140),
});

const mcqQuestionParamSchema = contestIdParamSchema.extend({
  questionId: z.string().trim().min(1).max(140),
});

const roundTypeParamSchema = contestIdParamSchema.extend({
  roundType: z.enum(['mcq', 'dsa']),
});

const mcqAnswerBodySchema = z.object({
  selectedOptionId: z.string().trim().min(1).max(32),
});

const integrityEventBodySchema = z.object({
  roundType: z.enum(['hub', 'mcq', 'dsa']).default('hub'),
  eventType: z.string().trim().min(1).max(80),
  severity: z.enum(['info', 'low', 'medium', 'high', 'critical']).default('info'),
  submissionType: z.string().trim().max(80).optional(),
  clientEventId: z.string().trim().max(140).optional(),
  warningCount: z.coerce.number().int().min(0).max(100000).optional(),
  payload: z.record(z.unknown()).default({}),
  clientTimestamp: z.string().datetime().optional(),
});

type ContestRuntime = {
  id: string;
  status: string;
  startTime: Date;
  endTime: Date;
  roundFlow: 'dsa_only' | 'mcq_only' | 'mcq_then_dsa';
  showScoreOnHub: boolean;
  mcqSequential: boolean;
};

type ParticipantRuntime = {
  totalScore: number;
  isSubmitted: boolean;
};

type McqContestQuestionRow = {
  questionId: string;
  points: number;
  negativePoints: number;
  negativeCap: number;
  order: number;
  phaseOrder: number;
};

type RoundAttemptRow = {
  roundType: 'mcq' | 'dsa';
  status: 'not_started' | 'in_progress' | 'submitted' | 'auto_submitted';
  scoreAwarded: number;
  currentQuestionId: string | null;
  lastSubmittedOrder: number;
  warningCount: number;
  submittedAt: Date | null;
};

type McqAnswerRow = {
  questionId: string;
  selectedOptionId: string | null;
  status: 'draft' | 'submitted';
  pointsAwarded: number | null;
};

function getRuntimeStatus(contest: Pick<ContestRuntime, 'startTime' | 'endTime' | 'status'>) {
  const now = Date.now();
  const start = new Date(contest.startTime).getTime();
  const end = new Date(contest.endTime).getTime();
  if (Number.isFinite(end) && now >= end) return 'ENDED';
  if (Number.isFinite(start) && now >= start) return 'ACTIVE';
  return contest.status;
}

function normalizeRoundFlow(value: unknown): ContestRuntime['roundFlow'] {
  if (value === 'mcq_only') return 'mcq_only';
  if (value === 'mcq_then_dsa') return 'mcq_then_dsa';
  return 'dsa_only';
}

function normalizeOptionId(value: unknown) {
  return String(value ?? '').trim();
}

function optionIdsFromQuestion(question: any) {
  return new Set((Array.isArray(question?.options) ? question.options : []).map((option: any) => normalizeOptionId(option?.id)));
}

async function getContestRuntime(contestId: string): Promise<ContestRuntime | null> {
  const rows = await prisma.$queryRawUnsafe<Array<{
    id: string;
    status: string;
    startTime: Date;
    endTime: Date;
    roundFlow: string | null;
    showScoreOnHub: boolean | null;
    mcqSequential: boolean | null;
  }>>(
    `SELECT
      id,
      status::text AS status,
      start_time AS "startTime",
      end_time AS "endTime",
      COALESCE(round_flow, 'dsa_only') AS "roundFlow",
      COALESCE(show_score_on_hub, true) AS "showScoreOnHub",
      COALESCE(mcq_sequential, false) AS "mcqSequential"
     FROM contests
     WHERE id = $1
     LIMIT 1`,
    contestId
  );

  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    status: getRuntimeStatus(row),
    startTime: row.startTime,
    endTime: row.endTime,
    roundFlow: normalizeRoundFlow(row.roundFlow),
    showScoreOnHub: row.showScoreOnHub !== false,
    mcqSequential: row.mcqSequential === true,
  };
}

async function getParticipantRuntime(contestId: string, userId: string): Promise<ParticipantRuntime | null> {
  const participant = await prisma.contestParticipant.findUnique({
    where: { contestId_userId: { contestId, userId } },
    select: {
      totalScore: true,
      isSubmitted: true,
    },
  });
  return participant || null;
}

async function requireContestParticipant(contestId: string, userId: string) {
  const [contest, participant] = await Promise.all([
    getContestRuntime(contestId),
    getParticipantRuntime(contestId, userId),
  ]);

  if (!contest) {
    const error = new Error('Contest not found');
    (error as any).statusCode = 404;
    throw error;
  }

  if (!(await isContestVisibleToUser(contestId, userId))) {
    const error = new Error('Contest not found');
    (error as any).statusCode = 404;
    throw error;
  }

  if (!participant) {
    const error = new Error('You are not registered for this contest');
    (error as any).statusCode = 403;
    throw error;
  }

  return { contest, participant };
}

async function getMcqQuestionRows(contestId: string): Promise<McqContestQuestionRow[]> {
  return getCachedOrFetch(
    `contest:${contestId}:mcq:rows`,
    MCQ_ROWS_CACHE_TTL,
    () => prisma.$queryRawUnsafe<McqContestQuestionRow[]>(
      `SELECT
        question_id AS "questionId",
        points,
        negative_points AS "negativePoints",
        negative_cap AS "negativeCap",
        "order",
        COALESCE(phase_order, "order", 0) AS "phaseOrder"
       FROM contest_questions
       WHERE contest_id = $1
         AND COALESCE(question_type, 'dsa') = 'mcq'
         AND COALESCE(phase, 'dsa') = 'mcq'
       ORDER BY COALESCE(phase_order, "order", 0), "order"`,
      contestId
    )
  );
}

async function getRoundAttempts(contestId: string, userId: string): Promise<RoundAttemptRow[]> {
  return prisma.$queryRawUnsafe<RoundAttemptRow[]>(
    `SELECT
      round_type AS "roundType",
      status,
      score_awarded AS "scoreAwarded",
      current_question_id AS "currentQuestionId",
      last_submitted_order AS "lastSubmittedOrder",
      warning_count AS "warningCount",
      submitted_at AS "submittedAt"
     FROM contest_round_attempts
     WHERE contest_id = $1 AND user_id = $2`,
    contestId,
    userId
  );
}

async function getRoundAttempt(contestId: string, userId: string, roundType: 'mcq' | 'dsa') {
  const rows = await getRoundAttempts(contestId, userId);
  return rows.find((row) => row.roundType === roundType) || null;
}

async function ensureRoundAttempt(contestId: string, userId: string, roundType: 'mcq' | 'dsa', currentQuestionId?: string | null) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO contest_round_attempts
      (contest_id, user_id, round_type, status, started_at, current_question_id)
     VALUES ($1, $2, $3, 'in_progress', NOW(), $4)
     ON CONFLICT (contest_id, user_id, round_type)
     DO UPDATE SET
       status = CASE
         WHEN contest_round_attempts.status IN ('submitted', 'auto_submitted') THEN contest_round_attempts.status
         ELSE 'in_progress'
       END,
       started_at = COALESCE(contest_round_attempts.started_at, NOW()),
       current_question_id = COALESCE($4, contest_round_attempts.current_question_id),
       updated_at = NOW()`,
    contestId,
    userId,
    roundType,
    currentQuestionId ?? null
  );

  return getRoundAttempt(contestId, userId, roundType);
}

async function getMcqAnswers(contestId: string, userId: string): Promise<McqAnswerRow[]> {
  return prisma.$queryRawUnsafe<McqAnswerRow[]>(
    `SELECT
      question_id AS "questionId",
      selected_option_id AS "selectedOptionId",
      status,
      points_awarded AS "pointsAwarded"
     FROM contest_mcq_answers
     WHERE contest_id = $1 AND user_id = $2`,
    contestId,
    userId
  );
}

async function getDsaRoundScore(contestId: string, userId: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ scoreAwarded: number }>>(
    `SELECT COALESCE(SUM(cs.points_awarded), 0)::int AS "scoreAwarded"
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
  );
  return Number(rows[0]?.scoreAwarded || 0);
}

async function hasRoundWorkStarted(contestId: string, userId: string, roundType: 'mcq' | 'dsa') {
  if (roundType === 'mcq') {
    const rows = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
      `SELECT COUNT(*)::int AS count
       FROM contest_mcq_answers
       WHERE contest_id = $1
         AND user_id = $2
         AND status = 'submitted'`,
      contestId,
      userId
    );
    return Number(rows[0]?.count || 0) > 0;
  }

  const rows = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
    `SELECT COUNT(*)::int AS count
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
  );
  return Number(rows[0]?.count || 0) > 0;
}

async function getMcqQuestionDocument(questionId: string, includeSolution = false) {
  // Cache key is scoped by includeSolution so the stripped (candidate) variant and
  // the full (grading/review) variant never collide.
  return getCachedOrFetch<any>(
    `contest:mcq:qdoc:${questionId}:${includeSolution ? 'sol' : 'nosol'}`,
    MCQ_DOC_CACHE_TTL,
    async () => {
      const Model = mongoose.model('ContestMCQQuestion');
      const objectIds = mongoose.Types.ObjectId.isValid(questionId)
        ? [new mongoose.Types.ObjectId(questionId)]
        : [];
      const numericQuestionId = Number(questionId);
      const query = {
        $or: [
          ...(objectIds.length > 0 ? [{ _id: { $in: objectIds } }] : []),
          { problemId: questionId },
          { frontendId: questionId },
          ...(Number.isFinite(numericQuestionId) ? [{ frontendId: numericQuestionId }] : []),
        ],
      };

      const selectClause = includeSolution ? '' : '-correctOptionId -explanation';
      const question = await Model.findOne(query).select(selectClause).lean<any>();
      if (!question) return null;

      return {
        ...question,
        id: questionId,
        statement: question.questionText || question.statement || '',
        options: (Array.isArray(question.options) ? question.options : [])
          .map((option: any, index: number) => ({
            id: normalizeOptionId(option?.id || index + 1),
            text: String(option?.text || ''),
            order: Number.isFinite(Number(option?.order)) ? Number(option.order) : index,
          }))
          .filter((option: any) => option.id && option.text)
          .sort((a: any, b: any) => a.order - b.order),
      };
    }
  );
}

async function requireMcqQuestionAccess(
  contestId: string,
  userId: string,
  questionId: string,
  options?: { allowSubmitted?: boolean }
) {
  const { contest, participant } = await requireContestParticipant(contestId, userId);
  if (participant.isSubmitted) {
    const error = new Error('Contest already submitted');
    (error as any).statusCode = 409;
    throw error;
  }

  if (contest.status !== 'ACTIVE') {
    const error = new Error('Contest is not active');
    (error as any).statusCode = 403;
    throw error;
  }

  const mcqRows = await getMcqQuestionRows(contestId);
  const questionRow = mcqRows.find((row) => row.questionId === questionId);
  if (!questionRow) {
    const error = new Error('MCQ question not found in this contest');
    (error as any).statusCode = 404;
    throw error;
  }

  const question = await getMcqQuestionDocument(questionId, false);
  if (!question) {
    const error = new Error('MCQ question not found');
    (error as any).statusCode = 404;
    throw error;
  }

  const allowSubmitted = options?.allowSubmitted === true;
  const answers = await getMcqAnswers(contestId, userId);
  const answer = answers.find((row) => row.questionId === questionId) || null;
  const isAlreadySubmitted = answer?.status === 'submitted';
  // Non-sequential contests keep answers editable until the round is finished, so
  // re-opening (or re-answering) a submitted MCQ is allowed. Sequential contests
  // still lock each MCQ once submitted (read-only views aside).
  const editableSubmitted = allowSubmitted || !contest.mcqSequential;

  if (isAlreadySubmitted && !editableSubmitted) {
    const error = new Error('This MCQ has already been submitted');
    (error as any).statusCode = 423;
    throw error;
  }

  // Only mark this question as the active one when it is being worked on. Merely
  // re-opening an already-submitted question (read-only review) must not change
  // the current question, otherwise the leave-status check would block leaving.
  const attempt = await ensureRoundAttempt(
    contestId,
    userId,
    'mcq',
    isAlreadySubmitted ? null : questionId
  );

  if (contest.mcqSequential) {
    const nextAllowedOrder = (attempt?.lastSubmittedOrder ?? -1) + 1;
    if (questionRow.phaseOrder !== nextAllowedOrder) {
      const alreadyLocked = questionRow.phaseOrder < nextAllowedOrder;
      // In read-only mode allow re-opening past questions; still block jumping ahead.
      if (!(allowSubmitted && alreadyLocked)) {
        const error = new Error(alreadyLocked
          ? 'This MCQ has already been locked'
          : 'Submit the current MCQ before opening the next one');
        (error as any).statusCode = alreadyLocked ? 423 : 409;
        throw error;
      }
    }
  }

  return { contest, questionRow, question, answer };
}

function serializeMcqQuestionForCandidate(
  question: any,
  questionRow: McqContestQuestionRow,
  answer?: McqAnswerRow | null
) {
  const status = answer?.status === 'submitted'
    ? 'submitted'
    : answer?.selectedOptionId
      ? 'attempted'
      : 'not_attempted';
  return {
    id: questionRow.questionId,
    title: question.title || '',
    statement: question.statement || question.questionText || '',
    questionText: question.questionText || question.statement || '',
    difficulty: question.difficulty || 'Medium',
    topics: Array.isArray(question.topics) ? question.topics : [],
    options: question.options,
    points: questionRow.points,
    negativePoints: Math.max(0, Math.floor(Number(questionRow.negativePoints) || 0)),
    order: questionRow.order,
    phaseOrder: questionRow.phaseOrder,
    questionType: 'mcq',
    status,
    selectedOptionId: answer?.selectedOptionId ?? null,
  };
}

function serializeMcqQuestionForReview(question: any, questionRow: McqContestQuestionRow, answer: McqAnswerRow | null) {
  const correctOptionId = normalizeOptionId(question.correctOptionId);
  const options = Array.isArray(question.options) ? question.options : [];
  const selectedOption = options.find((option: any) => option.id === answer?.selectedOptionId) || null;
  const correctOption = options.find((option: any) => option.id === correctOptionId) || null;

  return {
    id: questionRow.questionId,
    title: question.title || '',
    questionText: question.questionText || question.statement || '',
    difficulty: question.difficulty || 'Medium',
    points: questionRow.points,
    negativePoints: Math.max(0, Math.floor(Number(questionRow.negativePoints) || 0)),
    options,
    selectedOptionId: answer?.selectedOptionId ?? null,
    selectedOptionText: selectedOption?.text ?? null,
    correctOptionId,
    correctOptionText: correctOption?.text ?? null,
    isCorrect: answer?.status === 'submitted' ? answer.pointsAwarded > 0 : false,
    pointsAwarded: answer?.pointsAwarded ?? 0,
    explanation: question.explanation || '',
  };
}

async function evaluateAndStoreMcqAnswer(
  contestId: string,
  userId: string,
  questionRow: McqContestQuestionRow,
  selectedOptionId: string,
  status: 'draft' | 'submitted',
  allowOverwrite = false
) {
  const solutionQuestion = await getMcqQuestionDocument(questionRow.questionId, true);
  if (!solutionQuestion) {
    const error = new Error('MCQ question not found');
    (error as any).statusCode = 404;
    throw error;
  }

  const validOptions = optionIdsFromQuestion(solutionQuestion);
  if (!validOptions.has(selectedOptionId)) {
    const error = new Error('Selected option does not exist for this question');
    (error as any).statusCode = 400;
    throw error;
  }

  const isCorrect = status === 'submitted'
    ? selectedOptionId === normalizeOptionId(solutionQuestion.correctOptionId)
    : null;
  const normalizedPoints = Math.max(0, Math.floor(Number(questionRow.points) || 0));
  const normalizedPenalty = Math.max(0, Math.floor(Number(questionRow.negativePoints) || 0));
  const normalizedCap = normalizedPenalty > 0 ? Math.max(0, Math.floor(Number(questionRow.negativeCap) || 0)) : 0;
  const wrongPoints = normalizedPenalty > 0 && normalizedCap > 0
    ? -Math.min(normalizedPenalty, normalizedCap)
    : 0;
  const pointsAwarded = isCorrect ? normalizedPoints : status === 'submitted' ? wrongPoints : null;

  // When overwrite is allowed (non-sequential contests), a previously submitted
  // answer can be replaced with the candidate's latest choice. Otherwise a
  // submitted answer is frozen and only drafts may be updated.
  const conflictClause = allowOverwrite
    ? `DO UPDATE SET
      selected_option_id = EXCLUDED.selected_option_id,
      status = EXCLUDED.status,
      is_correct = EXCLUDED.is_correct,
      points_awarded = EXCLUDED.points_awarded,
      answered_at = NOW(),
      submitted_at = CASE WHEN EXCLUDED.status = 'submitted' THEN NOW() ELSE contest_mcq_answers.submitted_at END,
      evaluated_at = CASE WHEN EXCLUDED.status = 'submitted' THEN NOW() ELSE contest_mcq_answers.evaluated_at END,
      updated_at = NOW()`
    : `DO UPDATE SET
      selected_option_id = CASE
        WHEN contest_mcq_answers.status = 'submitted' THEN contest_mcq_answers.selected_option_id
        ELSE EXCLUDED.selected_option_id
      END,
      status = CASE
        WHEN contest_mcq_answers.status = 'submitted' THEN contest_mcq_answers.status
        ELSE EXCLUDED.status
      END,
      is_correct = CASE
        WHEN contest_mcq_answers.status = 'submitted' THEN contest_mcq_answers.is_correct
        ELSE EXCLUDED.is_correct
      END,
      points_awarded = CASE
        WHEN contest_mcq_answers.status = 'submitted' THEN contest_mcq_answers.points_awarded
        ELSE EXCLUDED.points_awarded
      END,
      answered_at = NOW(),
      submitted_at = CASE
        WHEN contest_mcq_answers.status = 'submitted' THEN contest_mcq_answers.submitted_at
        WHEN EXCLUDED.status = 'submitted' THEN NOW()
        ELSE contest_mcq_answers.submitted_at
      END,
      evaluated_at = CASE
        WHEN contest_mcq_answers.status = 'submitted' THEN contest_mcq_answers.evaluated_at
        WHEN EXCLUDED.status = 'submitted' THEN NOW()
        ELSE contest_mcq_answers.evaluated_at
      END,
      updated_at = NOW()`;

  await prisma.$executeRawUnsafe(
    `INSERT INTO contest_mcq_answers
      (contest_id, question_id, user_id, selected_option_id, status, is_correct, points_awarded, answered_at, submitted_at, evaluated_at)
     VALUES
      ($1, $2, $3, $4, $5, $6, $7, NOW(), CASE WHEN $5 = 'submitted' THEN NOW() ELSE NULL END, CASE WHEN $5 = 'submitted' THEN NOW() ELSE NULL END)
     ON CONFLICT (contest_id, question_id, user_id)
     ${conflictClause}`,
    contestId,
    questionRow.questionId,
    userId,
    selectedOptionId,
    status,
    isCorrect,
    pointsAwarded
  );

  return { isCorrect, pointsAwarded };
}

async function submitMcqRound(contestId: string, userId: string, submissionType: string) {
  const questionRows = await getMcqQuestionRows(contestId);
  const answerRows = await getMcqAnswers(contestId, userId);
  const answerByQuestion = new Map(answerRows.map((answer) => [answer.questionId, answer]));

  let roundScore = 0;
  for (const questionRow of questionRows) {
    const answer = answerByQuestion.get(questionRow.questionId);
    if (answer?.selectedOptionId && answer.status !== 'submitted') {
      const result = await evaluateAndStoreMcqAnswer(contestId, userId, questionRow, answer.selectedOptionId, 'submitted');
      roundScore += Number(result.pointsAwarded || 0);
      continue;
    }

    if (answer?.status === 'submitted') {
      roundScore += Number(answer.pointsAwarded || 0);
      continue;
    }

    await prisma.$executeRawUnsafe(
      `INSERT INTO contest_mcq_answers
        (contest_id, question_id, user_id, selected_option_id, status, is_correct, points_awarded, submitted_at, evaluated_at)
       VALUES ($1, $2, $3, NULL, 'submitted', false, 0, NOW(), NOW())
       ON CONFLICT (contest_id, question_id, user_id) DO NOTHING`,
      contestId,
      questionRow.questionId,
      userId
    );
  }

  await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRawUnsafe<Array<{ scoreAwarded: number }>>(
      `SELECT score_awarded AS "scoreAwarded"
       FROM contest_round_attempts
       WHERE contest_id = $1 AND user_id = $2 AND round_type = 'mcq'
       FOR UPDATE`,
      contestId,
      userId
    );
    const previousScore = Number(rows[0]?.scoreAwarded || 0);
    const delta = roundScore - previousScore;

    await tx.$executeRawUnsafe(
      `INSERT INTO contest_round_attempts
        (contest_id, user_id, round_type, status, score_awarded, last_submitted_order, submission_type, submitted_at, started_at)
       VALUES ($1, $2, 'mcq', CASE WHEN $4 = 'auto_time' THEN 'auto_submitted' ELSE 'submitted' END, $3, $5, $4, NOW(), NOW())
       ON CONFLICT (contest_id, user_id, round_type)
       DO UPDATE SET
        status = CASE WHEN $4 = 'auto_time' THEN 'auto_submitted' ELSE 'submitted' END,
        score_awarded = $3,
        last_submitted_order = GREATEST(contest_round_attempts.last_submitted_order, $5),
        submission_type = $4,
        submitted_at = COALESCE(contest_round_attempts.submitted_at, NOW()),
        updated_at = NOW()`,
      contestId,
      userId,
      roundScore,
      submissionType,
      questionRows.length - 1
    );

    if (delta !== 0) {
      await tx.contestParticipant.update({
        where: { contestId_userId: { contestId, userId } },
        data: {
          totalScore: { increment: delta },
        },
      });
    }
  });
}

async function submitDsaRound(contestId: string, userId: string, submissionType: string) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO contest_round_attempts
      (contest_id, user_id, round_type, status, submission_type, submitted_at, started_at)
     VALUES ($1, $2, 'dsa', CASE WHEN $3 = 'auto_time' THEN 'auto_submitted' ELSE 'submitted' END, $3, NOW(), NOW())
     ON CONFLICT (contest_id, user_id, round_type)
     DO UPDATE SET
      status = CASE WHEN $3 = 'auto_time' THEN 'auto_submitted' ELSE 'submitted' END,
      current_question_id = NULL,
      submission_type = $3,
      submitted_at = COALESCE(contest_round_attempts.submitted_at, NOW()),
      updated_at = NOW()`,
    contestId,
    userId,
    submissionType
  );
}

function handleRouteError(error: any, reply: FastifyReply, fallback: string) {
  const statusCode = Number(error?.statusCode || 500);
  if (statusCode >= 400 && statusCode < 500) {
    return reply.status(statusCode).send({
      error: statusCode === 404 ? 'Not Found' : statusCode === 403 ? 'Forbidden' : 'Bad Request',
      message: error.message || fallback,
    });
  }

  return reply.status(500).send({
    error: 'Internal Server Error',
    message: fallback,
  });
}

export async function contestRoundRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/contests/:id/rounds',
    { preHandler: [authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const params = contestIdParamSchema.safeParse(request.params);
        if (!params.success) {
          return reply.status(400).send({ error: 'Validation Error', details: params.error.flatten().fieldErrors });
        }

        const userId = getAuthenticatedUserId(request);
        const { contest, participant } = await requireContestParticipant(params.data.id, userId);
        const [attemptRows, mcqRows, answerRows, dsaRoundScore] = await Promise.all([
          getRoundAttempts(contest.id, userId),
          getMcqQuestionRows(contest.id),
          getMcqAnswers(contest.id, userId),
          getDsaRoundScore(contest.id, userId),
        ]);
        const attemptsByType = new Map(attemptRows.map((attempt) => [attempt.roundType, attempt]));
        const submittedAnswers = new Set(answerRows.filter((answer) => answer.status === 'submitted').map((answer) => answer.questionId));
        const mcqAttempt = attemptsByType.get('mcq');
        const mcqSubmitted = mcqAttempt?.status === 'submitted' || mcqAttempt?.status === 'auto_submitted';
        const mcqUnlocked = (contest.roundFlow === 'mcq_only' || contest.roundFlow === 'mcq_then_dsa') && mcqRows.length > 0;
        const dsaUnlocked = contest.roundFlow === 'dsa_only' || (contest.roundFlow === 'mcq_then_dsa' && (mcqRows.length === 0 || mcqSubmitted));

        return reply.send({
          success: true,
          settings: {
            roundFlow: contest.roundFlow,
            showScoreOnHub: contest.showScoreOnHub,
            mcqSequential: contest.mcqSequential,
          },
          participant: {
            isSubmitted: participant.isSubmitted,
            totalScore: contest.showScoreOnHub || participant.isSubmitted || contest.status === 'ENDED'
              ? participant.isSubmitted || contest.status === 'ENDED'
                ? Math.max(0, participant.totalScore)
                : participant.totalScore
              : null,
          },
          rounds: {
            mcq: {
              status: mcqAttempt?.status || 'not_started',
              questionCount: mcqRows.length,
              submittedCount: submittedAnswers.size,
              warningCount: mcqAttempt?.warningCount ?? 0,
              unlocked: mcqUnlocked,
              nextAllowedOrder: contest.mcqSequential ? (mcqAttempt?.lastSubmittedOrder ?? -1) + 1 : null,
            },
            dsa: {
              status: attemptsByType.get('dsa')?.status || 'not_started',
              scoreAwarded: dsaRoundScore,
              warningCount: attemptsByType.get('dsa')?.warningCount ?? 0,
              unlocked: dsaUnlocked,
            },
          },
        });
      } catch (error: any) {
        request.log.error({ error }, 'Failed to load contest rounds');
        return handleRouteError(error, reply, 'Failed to load contest rounds');
      }
    }
  );

  fastify.get(
    '/contests/:id/rounds/:roundType/leave-status',
    { preHandler: [authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const params = roundTypeParamSchema.safeParse(request.params);
        if (!params.success) {
          return reply.status(400).send({ error: 'Validation Error', details: params.error.flatten().fieldErrors });
        }

        const userId = getAuthenticatedUserId(request);
        const { participant } = await requireContestParticipant(params.data.id, userId);
        const attempt = await getRoundAttempt(params.data.id, userId, params.data.roundType);
        const status = attempt?.status || 'not_started';
        const submitted = participant.isSubmitted || status === 'submitted' || status === 'auto_submitted';
        const currentQuestionId = attempt?.currentQuestionId ?? null;
        const roundWorkStarted = currentQuestionId !== null || await hasRoundWorkStarted(params.data.id, userId, params.data.roundType);
        const canLeave = submitted || !roundWorkStarted;

        return reply.send({
          success: true,
          canLeave,
          roundType: params.data.roundType,
          status,
          currentQuestionId,
          roundWorkStarted,
          message: canLeave
            ? null
            : params.data.roundType === 'mcq'
              ? 'Finish your MCQ attempt before returning to the contest hub.'
              : 'Finish your coding attempt before returning to the contest hub.',
        });
      } catch (error: any) {
        request.log.error({ error }, 'Failed to check round leave status');
        return handleRouteError(error, reply, 'Failed to check round leave status');
      }
    }
  );

  fastify.post(
    '/contests/:id/rounds/mcq/start',
    { preHandler: [authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const params = contestIdParamSchema.safeParse(request.params);
        if (!params.success) {
          return reply.status(400).send({ error: 'Validation Error', details: params.error.flatten().fieldErrors });
        }
        const userId = getAuthenticatedUserId(request);
        const { contest, participant } = await requireContestParticipant(params.data.id, userId);
        if (participant.isSubmitted || contest.status !== 'ACTIVE') {
          return reply.status(403).send({ error: 'Forbidden', message: 'Contest is not active' });
        }
        await ensureRoundAttempt(contest.id, userId, 'mcq');
        return reply.send({ success: true });
      } catch (error: any) {
        request.log.error({ error }, 'Failed to start MCQ round');
        return handleRouteError(error, reply, 'Failed to start MCQ round');
      }
    }
  );

  fastify.get(
    '/contests/:id/mcq/questions/:questionId',
    { preHandler: [authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const params = mcqQuestionParamSchema.safeParse(request.params);
        if (!params.success) {
          return reply.status(400).send({ error: 'Validation Error', details: params.error.flatten().fieldErrors });
        }

        const userId = getAuthenticatedUserId(request);
        const { question, questionRow, answer } = await requireMcqQuestionAccess(
          params.data.id,
          userId,
          params.data.questionId,
          { allowSubmitted: true }
        );
        return reply.send({
          success: true,
          question: serializeMcqQuestionForCandidate(question, questionRow, answer),
        });
      } catch (error: any) {
        request.log.error({ error }, 'Failed to load MCQ question');
        return handleRouteError(error, reply, 'Failed to load MCQ question');
      }
    }
  );

  fastify.get(
    '/contests/:id/mcq/review',
    { preHandler: [authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const params = contestIdParamSchema.safeParse(request.params);
        if (!params.success) {
          return reply.status(400).send({ error: 'Validation Error', details: params.error.flatten().fieldErrors });
        }

        const userId = getAuthenticatedUserId(request);
        const { contest } = await requireContestParticipant(params.data.id, userId);
        const contestEnded = contest.status === 'ENDED' || contest.endTime.getTime() <= Date.now();
        if (!contestEnded) {
          return reply.send({
            success: true,
            available: false,
            questions: [],
            message: 'MCQ solutions are available after the contest ends',
          });
        }

        const [mcqRows, answerRows] = await Promise.all([
          getMcqQuestionRows(params.data.id),
          getMcqAnswers(params.data.id, userId),
        ]);
        const answersByQuestion = new Map(answerRows.map((answer) => [answer.questionId, answer]));
        const questions = await Promise.all(
          mcqRows.map(async (row) => {
            const question = await getMcqQuestionDocument(row.questionId, true);
            if (!question) return null;
            return serializeMcqQuestionForReview(question, row, answersByQuestion.get(row.questionId) || null);
          })
        );

        return reply.send({
          success: true,
          available: true,
          questions: questions.filter(Boolean),
        });
      } catch (error: any) {
        request.log.error({ error }, 'Failed to load MCQ review');
        return handleRouteError(error, reply, 'Failed to load MCQ review');
      }
    }
  );

  fastify.put(
    '/contests/:id/mcq/questions/:questionId/answer',
    { preHandler: [authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const params = mcqQuestionParamSchema.safeParse(request.params);
        const body = mcqAnswerBodySchema.safeParse(request.body || {});
        if (!params.success || !body.success) {
          return reply.status(400).send({
            error: 'Validation Error',
            details: {
              ...(params.success ? {} : params.error.flatten().fieldErrors),
              ...(body.success ? {} : body.error.flatten().fieldErrors),
            },
          });
        }

        const userId = getAuthenticatedUserId(request);
        const { questionRow } = await requireMcqQuestionAccess(params.data.id, userId, params.data.questionId);
        await evaluateAndStoreMcqAnswer(params.data.id, userId, questionRow, body.data.selectedOptionId, 'draft');
        return reply.send({ success: true, status: 'draft' });
      } catch (error: any) {
        request.log.error({ error }, 'Failed to save MCQ answer');
        return handleRouteError(error, reply, 'Failed to save MCQ answer');
      }
    }
  );

  fastify.post(
    '/contests/:id/mcq/questions/:questionId/submit',
    { preHandler: [authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const params = mcqQuestionParamSchema.safeParse(request.params);
        const body = mcqAnswerBodySchema.safeParse(request.body || {});
        if (!params.success || !body.success) {
          return reply.status(400).send({
            error: 'Validation Error',
            details: {
              ...(params.success ? {} : params.error.flatten().fieldErrors),
              ...(body.success ? {} : body.error.flatten().fieldErrors),
            },
          });
        }

        const userId = getAuthenticatedUserId(request);
        const { contest, questionRow } = await requireMcqQuestionAccess(params.data.id, userId, params.data.questionId);
        // Non-sequential contests let candidates change a previously submitted answer.
        await evaluateAndStoreMcqAnswer(params.data.id, userId, questionRow, body.data.selectedOptionId, 'submitted', !contest.mcqSequential);

        const mcqRows = await getMcqQuestionRows(params.data.id);
        await prisma.$executeRawUnsafe(
          `UPDATE contest_round_attempts
           SET
            last_submitted_order = GREATEST(last_submitted_order, $3),
            current_question_id = NULL,
            updated_at = NOW()
           WHERE contest_id = $1 AND user_id = $2 AND round_type = 'mcq'`,
          params.data.id,
          userId,
          questionRow.phaseOrder
        );

        const isRoundComplete = (await getMcqAnswers(params.data.id, userId))
          .filter((answer) => answer.status === 'submitted')
          .length >= mcqRows.length;

        if (contest.mcqSequential && isRoundComplete) {
          await submitMcqRound(params.data.id, userId, 'manual');
        }

        return reply.send({
          success: true,
          status: 'submitted',
          roundComplete: isRoundComplete,
        });
      } catch (error: any) {
        request.log.error({ error }, 'Failed to submit MCQ answer');
        return handleRouteError(error, reply, 'Failed to submit MCQ answer');
      }
    }
  );

  fastify.delete(
    '/contests/:id/mcq/questions/:questionId/answer',
    { preHandler: [authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const params = mcqQuestionParamSchema.safeParse(request.params);
        if (!params.success) {
          return reply.status(400).send({ error: 'Validation Error', details: params.error.flatten().fieldErrors });
        }

        const userId = getAuthenticatedUserId(request);
        const { contest } = await requireMcqQuestionAccess(params.data.id, userId, params.data.questionId);
        // Clearing an answer is only allowed while answers are still editable, i.e.
        // non-sequential contests. Sequential answers are final once submitted.
        if (contest.mcqSequential) {
          return reply.status(423).send({ error: 'Locked', message: 'This MCQ cannot be cleared once submitted.' });
        }

        await prisma.$executeRawUnsafe(
          `DELETE FROM contest_mcq_answers
           WHERE contest_id = $1 AND user_id = $2 AND question_id = $3`,
          params.data.id,
          userId,
          params.data.questionId
        );

        return reply.send({ success: true, status: 'cleared' });
      } catch (error: any) {
        request.log.error({ error }, 'Failed to clear MCQ answer');
        return handleRouteError(error, reply, 'Failed to clear MCQ answer');
      }
    }
  );

  fastify.post(
    '/contests/:id/rounds/mcq/submit',
    { preHandler: [authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const params = contestIdParamSchema.safeParse(request.params);
        const body = submitContestSchema.safeParse(request.body || {});
        if (!params.success || !body.success) {
          return reply.status(400).send({ error: 'Validation Error' });
        }
        const userId = getAuthenticatedUserId(request);
        const { contest, participant } = await requireContestParticipant(params.data.id, userId);
        if (participant.isSubmitted || (contest.status !== 'ACTIVE' && body.data.submissionType !== 'auto_time')) {
          return reply.status(403).send({ error: 'Forbidden', message: 'Contest is not active' });
        }
        await submitMcqRound(params.data.id, userId, body.data.submissionType);
        return reply.send({ success: true, status: body.data.submissionType === 'auto_time' ? 'auto_submitted' : 'submitted' });
      } catch (error: any) {
        request.log.error({ error }, 'Failed to submit MCQ round');
        return handleRouteError(error, reply, 'Failed to submit MCQ round');
      }
    }
  );

  fastify.post(
    '/contests/:id/rounds/dsa/start',
    { preHandler: [authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const params = contestIdParamSchema.safeParse(request.params);
        if (!params.success) {
          return reply.status(400).send({ error: 'Validation Error', details: params.error.flatten().fieldErrors });
        }
        const userId = getAuthenticatedUserId(request);
        const { contest, participant } = await requireContestParticipant(params.data.id, userId);
        const mcqAttempt = await getRoundAttempt(params.data.id, userId, 'mcq');
        const mcqRows = await getMcqQuestionRows(params.data.id);
        const dsaUnlocked = contest.roundFlow === 'dsa_only' || (
          contest.roundFlow === 'mcq_then_dsa' &&
          (mcqRows.length === 0 || mcqAttempt?.status === 'submitted' || mcqAttempt?.status === 'auto_submitted')
        );
        if (participant.isSubmitted || contest.status !== 'ACTIVE' || !dsaUnlocked) {
          return reply.status(403).send({ error: 'Forbidden', message: 'DSA round is locked' });
        }
        await ensureRoundAttempt(contest.id, userId, 'dsa');
        return reply.send({ success: true });
      } catch (error: any) {
        request.log.error({ error }, 'Failed to start DSA round');
        return handleRouteError(error, reply, 'Failed to start DSA round');
      }
    }
  );

  fastify.post(
    '/contests/:id/rounds/dsa/questions/:questionId/open',
    { preHandler: [authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const params = mcqQuestionParamSchema.safeParse(request.params);
        if (!params.success) {
          return reply.status(400).send({ error: 'Validation Error', details: params.error.flatten().fieldErrors });
        }

        const userId = getAuthenticatedUserId(request);
        const { contest, participant } = await requireContestParticipant(params.data.id, userId);
        const [mcqAttempt, mcqRows, questionRows] = await Promise.all([
          getRoundAttempt(params.data.id, userId, 'mcq'),
          getMcqQuestionRows(params.data.id),
          prisma.$queryRawUnsafe<Array<{ questionId: string }>>(
            `SELECT question_id AS "questionId"
             FROM contest_questions
             WHERE contest_id = $1
               AND question_id = $2
               AND COALESCE(question_type, 'dsa') = 'dsa'
               AND COALESCE(phase, 'dsa') = 'dsa'
             LIMIT 1`,
            params.data.id,
            params.data.questionId
          ),
        ]);
        const dsaUnlocked = contest.roundFlow === 'dsa_only' || (
          contest.roundFlow === 'mcq_then_dsa' &&
          (mcqRows.length === 0 || mcqAttempt?.status === 'submitted' || mcqAttempt?.status === 'auto_submitted')
        );
        if (participant.isSubmitted || contest.status !== 'ACTIVE' || !dsaUnlocked) {
          return reply.status(403).send({ error: 'Forbidden', message: 'DSA round is locked' });
        }
        if (!questionRows[0]) {
          return reply.status(404).send({ error: 'Not Found', message: 'Coding question not found in this contest' });
        }

        await ensureRoundAttempt(contest.id, userId, 'dsa', params.data.questionId);
        await prisma.$executeRawUnsafe(
          `UPDATE contest_round_attempts
           SET current_question_id = $3, updated_at = NOW()
           WHERE contest_id = $1
             AND user_id = $2
             AND round_type = 'dsa'
             AND status NOT IN ('submitted', 'auto_submitted')`,
          params.data.id,
          userId,
          params.data.questionId
        );

        return reply.send({ success: true });
      } catch (error: any) {
        request.log.error({ error }, 'Failed to mark DSA question opened');
        return handleRouteError(error, reply, 'Failed to mark DSA question opened');
      }
    }
  );

  fastify.post(
    '/contests/:id/rounds/dsa/submit',
    { preHandler: [authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const params = contestIdParamSchema.safeParse(request.params);
        const body = submitContestSchema.safeParse(request.body || {});
        if (!params.success || !body.success) {
          return reply.status(400).send({ error: 'Validation Error' });
        }
        const userId = getAuthenticatedUserId(request);
        await requireContestParticipant(params.data.id, userId);
        await submitDsaRound(params.data.id, userId, body.data.submissionType);
        return reply.send({ success: true, status: body.data.submissionType === 'auto_time' ? 'auto_submitted' : 'submitted' });
      } catch (error: any) {
        request.log.error({ error }, 'Failed to submit DSA round');
        return handleRouteError(error, reply, 'Failed to submit DSA round');
      }
    }
  );

  fastify.post(
    '/contests/:id/integrity-events',
    // Integrity events are small metadata. Cap the body at 16KB so a client can't
    // POST a huge jsonb payload (× many events × many users) and bloat Postgres.
    { preHandler: [authenticate], bodyLimit: 16 * 1024 },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const params = contestIdParamSchema.safeParse(request.params);
        const body = integrityEventBodySchema.safeParse(request.body || {});
        if (!params.success || !body.success) {
          return reply.status(400).send({ error: 'Validation Error' });
        }
        const userId = getAuthenticatedUserId(request);
        await requireContestParticipant(params.data.id, userId);
        await prisma.$executeRawUnsafe(
          `INSERT INTO contest_integrity_events
            (contest_id, user_id, round_type, event_type, severity, submission_type, client_event_id, warning_count, payload, client_timestamp)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
           ON CONFLICT (contest_id, user_id, client_event_id) WHERE (client_event_id IS NOT NULL) DO NOTHING`,
          params.data.id,
          userId,
          body.data.roundType,
          body.data.eventType,
          body.data.severity,
          body.data.submissionType ?? null,
          body.data.clientEventId ?? null,
          body.data.warningCount ?? null,
          JSON.stringify(body.data.payload || {}),
          body.data.clientTimestamp ? new Date(body.data.clientTimestamp) : null
        );
        if (body.data.roundType === 'mcq' || body.data.roundType === 'dsa') {
          await prisma.$executeRawUnsafe(
            `INSERT INTO contest_round_attempts
              (contest_id, user_id, round_type, status, started_at, warning_count)
             VALUES ($1, $2, $3, 'in_progress', NOW(), $4)
             ON CONFLICT (contest_id, user_id, round_type)
             DO UPDATE SET
               warning_count = GREATEST(COALESCE(contest_round_attempts.warning_count, 0), EXCLUDED.warning_count),
               updated_at = NOW()`,
            params.data.id,
            userId,
            body.data.roundType,
            Math.max(0, body.data.warningCount ?? 1)
          );
        }
        return reply.send({ success: true });
      } catch (error: any) {
        request.log.error({ error }, 'Failed to record contest integrity event');
        return handleRouteError(error, reply, 'Failed to record contest integrity event');
      }
    }
  );
}
