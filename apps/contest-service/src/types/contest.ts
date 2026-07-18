import { z } from 'zod';
import { DEFAULT_CONTEST_INSTRUCTIONS } from '@interviewforge/shared';

/**
 * Contest Types and Validation Schemas
 * Based on SCHEMA_REFERENCE.md
 */

// Enums matching Prisma schema
export enum ContestStatus {
  UPCOMING = 'UPCOMING',
  ACTIVE = 'ACTIVE',
  ENDED = 'ENDED',
}

export enum Difficulty {
  EASY = 'EASY',
  MEDIUM = 'MEDIUM',
  HARD = 'HARD',
}

const questionIdSchema = z.string().trim().min(1, 'Question ID is required').max(128, 'Question ID is too long');
const questionTypeSchema = z.enum(['dsa', 'mcq']).default('dsa');
const questionPhaseSchema = z.enum(['dsa', 'mcq']).default('dsa');
const roundFlowSchema = z.enum(['dsa_only', 'mcq_only', 'mcq_then_dsa']).default('dsa_only');

export const contestQuestionConfigSchema = z.object({
  questionId: questionIdSchema,
  questionType: questionTypeSchema.optional(),
  phase: questionPhaseSchema.optional(),
  points: z.coerce.number().int().min(1, 'Points must be at least 1').max(100000, 'Points are too high').optional(),
  negativePoints: z.coerce.number().int().min(0, 'Negative points cannot be below 0').max(100000, 'Negative points are too high').optional(),
  negativeCap: z.coerce.number().int().min(0, 'Negative cap cannot be below 0').max(100000, 'Negative cap is too high').optional(),
}).superRefine((data, ctx) => {
  const questionType = data.questionType || 'dsa';
  const phase = data.phase || questionType;
  if (phase !== questionType) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['phase'],
      message: 'Question phase must match question type',
    });
  }

  const negativePoints = Number(data.negativePoints ?? 0);
  const negativeCap = Number(data.negativeCap ?? 0);

  if (negativePoints <= 0) {
    if (negativeCap !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['negativeCap'],
        message: 'Negative cap must be 0 when wrong-answer penalty is disabled',
      });
    }
    return;
  }

  if (negativeCap < negativePoints) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['negativeCap'],
      message: 'Negative cap must be at least one wrong-answer penalty',
    });
  }

  if (negativeCap % negativePoints !== 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['negativeCap'],
      message: 'Negative cap must be a multiple of wrong-answer penalty',
    });
  }
});

const contestQuestionSelectionSchema = z.array(contestQuestionConfigSchema)
  .min(1, 'Select at least one question')
  .max(100, 'Cannot add more than 100 questions');

/**
 * Create Contest Request Schema
 */
export const createContestSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters').max(200, 'Title too long'),
  description: z.string().min(10, 'Description must be at least 10 characters').max(5000, 'Description too long'),
  instructions: z.string().trim().min(20, 'Instructions must be at least 20 characters').max(6000, 'Instructions too long').default(DEFAULT_CONTEST_INSTRUCTIONS),
  showDifficultyTags: z.boolean().default(true),
  showParticipants: z.boolean().default(false),
  isUnderTesting: z.boolean().default(false),
  roundFlow: roundFlowSchema,
  showScoreOnHub: z.boolean().default(true),
  mcqSequential: z.boolean().default(false),
  startTime: z.string().datetime('Invalid start time format'),
  endTime: z.string().datetime('Invalid end time format'),
  wrongPenalty: z.coerce.number().int().min(0).max(100000).optional(),
  questionIds: z.array(questionIdSchema).min(1, 'Select at least one question').max(100, 'Cannot add more than 100 questions').optional(),
  questions: contestQuestionSelectionSchema.optional(),
}).refine((data) => new Date(data.endTime) > new Date(data.startTime), {
  message: 'End time must be after start time',
  path: ['endTime'],
}).refine((data) => new Date(data.startTime) > new Date(), {
  message: 'Start time must be in the future',
  path: ['startTime'],
}).refine((data) => Boolean(data.questions?.length || data.questionIds?.length), {
  message: 'Select at least one question',
  path: ['questions'],
});

export type CreateContestRequest = z.infer<typeof createContestSchema>;

/**
 * Update Contest Request Schema
 */
const updateContestBaseSchema = z.object({
  title: z.string().min(3).max(200).optional(),
  description: z.string().min(10).max(5000).optional(),
  instructions: z.string().trim().min(20).max(6000).optional(),
  showDifficultyTags: z.boolean().optional(),
  showParticipants: z.boolean().optional(),
  isUnderTesting: z.boolean().optional(),
  isArchived: z.boolean().optional(),
  roundFlow: roundFlowSchema.optional(),
  showScoreOnHub: z.boolean().optional(),
  mcqSequential: z.boolean().optional(),
  startTime: z.string().datetime().optional(),
  endTime: z.string().datetime().optional(),
  status: z.nativeEnum(ContestStatus).optional(),
});

function hasValidOptionalTimeWindow(data: { startTime?: string; endTime?: string }) {
  if (data.startTime && data.endTime) {
    return new Date(data.endTime) > new Date(data.startTime);
  }
  return true;
}

export const updateContestSchema = updateContestBaseSchema.refine((data) => {
  return hasValidOptionalTimeWindow(data);
}, {
  message: 'End time must be after start time',
  path: ['endTime'],
});

export type UpdateContestRequest = z.infer<typeof updateContestSchema>;

export const updateManagedContestSchema = updateContestBaseSchema.extend({
  wrongPenalty: z.coerce.number().int().min(0).max(100000).optional(),
  questions: contestQuestionSelectionSchema.optional(),
}).refine((data) => {
  return hasValidOptionalTimeWindow(data);
}, {
  message: 'End time must be after start time',
  path: ['endTime'],
}).refine((data) => Boolean(!data.questions || data.questions.length > 0), {
  message: 'Select at least one question',
  path: ['questions'],
});

export type UpdateManagedContestRequest = z.infer<typeof updateManagedContestSchema>;

export const addContestQuestionsSchema = z.object({
  questionIds: z.array(questionIdSchema).min(1, 'Select at least one question').max(100, 'Cannot add more than 100 questions at once').optional(),
  questions: contestQuestionSelectionSchema.optional(),
}).refine((data) => Boolean(data.questions?.length || data.questionIds?.length), {
  message: 'Select at least one question',
  path: ['questions'],
});

export type AddContestQuestionsRequest = z.infer<typeof addContestQuestionsSchema>;

export const submitContestSchema = z.object({
  submissionType: z.enum([
    'manual',
    'auto_time',
    'auto_tab_switch',
    'auto_window_blur',
    'auto_focus_loss',
    'auto_fullscreen_exit',
    'auto_external_paste',
    'auto_context_menu',
    'auto_blocked_shortcut',
    'auto_cheating',
  ]).default('manual'),
});

export type SubmitContestRequest = z.infer<typeof submitContestSchema>;

export const contestFeedbackSchema = z.object({
  rating: z.coerce.number().int().min(1, 'Rating must be at least 1').max(5, 'Rating must be at most 5'),
  comment: z.string().trim().max(1000, 'Feedback is too long').optional().transform((value) => value || null),
});

export type ContestFeedbackRequest = z.infer<typeof contestFeedbackSchema>;

export const contestIdParamSchema = z.object({
  id: z.string().trim().min(1, 'Contest ID is required').max(128, 'Contest ID is too long'),
});

export type ContestIdParams = z.infer<typeof contestIdParamSchema>;

export const leaderboardQuerySchema = z.object({
  page: z.string().regex(/^\d+$/, 'Page must be a positive integer').optional().transform((val) => val ? Number(val) : 1),
  limit: z.string().regex(/^\d+$/, 'Limit must be a positive integer').optional().transform((val) => val ? Math.min(Number(val), 10000) : 10000),
}).refine((data) => data.page >= 1, {
  message: 'Page must be at least 1',
  path: ['page'],
}).refine((data) => data.limit >= 1 && data.limit <= 10000, {
  message: 'Limit must be between 1 and 10000',
  path: ['limit'],
});

export type LeaderboardQuery = z.infer<typeof leaderboardQuerySchema>;

/**
 * Contest Query Parameters Schema
 */
export const contestQuerySchema = z.object({
  status: z.nativeEnum(ContestStatus).optional(),
  limit: z.string().optional().transform((val) => Math.min(parseInt(val || '50'), 100)),
  offset: z.string().optional().transform((val) => parseInt(val || '0')),
});

export type ContestQuery = z.infer<typeof contestQuerySchema>;

export const contestTestingUserSearchQuerySchema = z.object({
  query: z.string().trim().min(1, 'Search query is required').max(80, 'Search query is too long'),
  limit: z.string().optional().transform((val) => Math.min(Math.max(parseInt(val || '10', 10) || 10, 1), 20)),
});

export type ContestTestingUserSearchQuery = z.infer<typeof contestTestingUserSearchQuerySchema>;

export const contestTestingTesterBodySchema = z.object({
  userId: z.string().trim().min(1, 'User ID is required').max(128, 'User ID is too long'),
});

export type ContestTestingTesterBody = z.infer<typeof contestTestingTesterBodySchema>;

export const contestTesterParamSchema = z.object({
  userId: z.string().trim().min(1, 'User ID is required').max(128, 'User ID is too long'),
});

export type ContestTesterParams = z.infer<typeof contestTesterParamSchema>;

/**
 * Unused Questions Query Schema
 */
export const unusedQuestionsQuerySchema = z.object({
  difficulty: z.nativeEnum(Difficulty).optional(),
  topic: z.string().optional(),
  used: z.enum(['all', 'used', 'unused']).optional().default('unused'),
  limit: z.string().optional().transform((val) => Math.min(parseInt(val || '50'), 100)),
  offset: z.string().optional().transform((val) => parseInt(val || '0')),
});

export type UnusedQuestionsQuery = z.infer<typeof unusedQuestionsQuerySchema>;
