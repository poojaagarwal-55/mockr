// ============================================
// Zod Validation Schemas
// ============================================
// These mirror the TypeScript types but provide
// runtime validation for API boundaries.

import { z } from 'zod';

// ---- Enums ----

export const RoleSchema = z.enum(['backend', 'frontend', 'fullstack', 'mle', 'devops', 'genai', 'datascience']);
export const LevelSchema = z.enum(['SDE1', 'SDE2', 'SDE3', 'Staff']);
export const SupportedLanguageSchema = z.enum(['python', 'javascript', 'typescript', 'java', 'cpp', 'go']);
export const InterviewTypeSchema = z.enum(['full_interview', 'coding', 'cs_fundamentals', 'system_design', 'behavioural', 'gen_ai_role', 'data_science_role', 'pm_role', 'problem_solving_case', 'resume_round']);
export const InterviewStageSchema = z.enum(['INTRO', 'DSA', 'FUNDAMENTALS', 'SYSTEM_DESIGN', 'BEHAVIOURAL', 'CLOSING', 'GEN_AI_CONCEPTS', 'GEN_AI_CODING', 'GEN_AI_SYSTEM_DESIGN', 'DS_CONCEPTS', 'DS_SQL', 'DS_CODING', 'DS_BUSINESS_CASE', 'PROBLEM_SOLVING', 'PM_CASE', 'PM_CONCEPTS', 'PM_STRATEGY', 'PM_BEHAVIORAL', 'RESUME_STUDIES', 'RESUME_PROJECTS', 'RESUME_EXPERIENCE', 'RESUME_RESPONSIBILITY', 'RESUME_SKILLS']);
export const InterviewModeSchema = z.enum(['mock', 'strict']);
export const QuestionCategorySchema = z.enum(['DSA', 'SQL', 'SystemDesign', 'OS', 'OOP', 'Networking', 'Behavioral']);
export const DifficultySchema = z.enum(['Easy', 'Medium', 'Hard']);
export const ScoreCategorySchema = z.enum([
    'problem_solving', 'code_quality', 'communication',
    'cs_knowledge', 'speed', 'system_design',
    'leadership_and_initiative', 'conflict_resolution',
    'adaptability', 'teamwork',
    // System design interview categories
    'requirements_gathering', 'high_level_design', 'deep_dive',
    'scalability', 'tradeoffs',
    // Gen AI Role categories
    'genai_fundamentals', 'genai_system_design', 'ai_tool_proficiency', 'ai_ethics',
    // Data Science Role categories
    'ds_statistics', 'sql_proficiency', 'data_analysis', 'business_metrics',
    // Product Manager Role categories
    'product_ownership', 'product_case_structuring', 'product_metrics', 'product_strategy', 'behavioral_competency',
    // Problem Solving Case categories
    'logical_reasoning', 'hint_absorption', 'conviction_under_pressure',
    // Resume Round categories
    'claim_confidence', 'project_ownership', 'technical_depth', 'impact_evidence', 'ai_contribution_clarity', 'experience_depth', 'education_narrative', 'role_fit', 'follow_up_consistency',
]);

// ---- API Request Schemas ----

export const StartInterviewSchema = z.object({
    type: InterviewTypeSchema.default('full_interview'),
    role: RoleSchema,
    level: LevelSchema,
    mode: InterviewModeSchema.default('mock'),
    resumeId: z.string().uuid().nullable().default(null),
});

export const CodeExecutionRequestSchema = z.object({
    sessionId: z.string().uuid(),
    questionId: z.string().uuid(),
    language: SupportedLanguageSchema,
    code: z.string().min(1).max(50_000),
    runHiddenTests: z.boolean().default(false),
});

export const ResumeUploadSchema = z.object({
    fileName: z.string().min(1),
});

export const QuestionSelectionSchema = z.object({
    category: QuestionCategorySchema,
    difficulty: z.array(DifficultySchema).optional(),
    targetRole: z.string(),
    targetLevel: z.string(),
    excludeIds: z.array(z.string().uuid()).default([]),
    limit: z.number().int().min(1).max(20).default(5),
});

export const CreateQuestionSchema = z.object({
    slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
    title: z.string().min(1).max(200),
    category: QuestionCategorySchema,
    subcategory: z.string().nullable().default(null),
    difficulty: DifficultySchema,
    problemMd: z.string().min(10),
    constraints: z.string().nullable().default(null),
    examples: z.array(z.object({
        input: z.string(),
        output: z.string(),
        explanation: z.string().optional(),
    })).default([]),
    hints: z.array(z.string()).default([]),
    followUpQuestions: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
    companies: z.array(z.string()).default([]),
    targetRoles: z.array(z.string()).default([]),
    targetLevels: z.array(z.string()).default([]),
});

// ---- Socket Payload Schemas ----

export const ChatMessagePayloadSchema = z.object({
    content: z.string().min(1).max(10_000),
});

export const CodeSnapshotPayloadSchema = z.object({
    code: z.string().max(50_000),
    language: SupportedLanguageSchema,
    cursorLine: z.number().int().nullable(),
});

export const CodeRunPayloadSchema = z.object({
    code: z.string().min(1).max(50_000),
    language: SupportedLanguageSchema,
    questionId: z.string().uuid(),
});

// ---- LaTeX Resume Schemas ----

export const CreateLatexResumeSchema = z.object({
    title: z.string().min(1).max(200).default("Untitled Resume"),
    template: z.string().default("classic"),
    formData: z.any().optional(), // Represents the structured resume data (Personal, Education, Experience, Projects, Skills)
});

export const UpdateLatexResumeSchema = z.object({
    title: z.string().min(1).max(200).optional(),
    latexSource: z.string().max(500_000).optional(), // 500KB max
});

export const LatexAiActionSchema = z.enum(['rewrite', 'fix', 'suggest', 'chat']);

export const LatexAiRequestSchema = z.object({
    action: LatexAiActionSchema,
    selectedText: z.string().max(2_000_000).optional(),
    chatMessage: z.string().max(100_000).optional(),
    fullSource: z.string().max(10_000_000),
});

export const LatexAiEnhanceSchema = z.object({
    formData: z.any(),
});

export const LatexAiRephraseSchema = z.object({
    text: z.string().min(1),
});

// ---- Peer Interview Schemas ----

export const PeerLevelSchema = z.enum(['beginner', 'intermediate', 'advanced']);
export const PeerInterviewTypeSchema = z.enum(['coding', 'system_design', 'behavioural']);
export const PeerTimingPresetSchema = z.enum(['standard_45', 'intense_30', 'deep_60']);

export const JoinPeerQueueSchema = z.object({
    role: RoleSchema,
    level: PeerLevelSchema,
    interviewType: PeerInterviewTypeSchema.default('coding'),
    preferredLanguage: SupportedLanguageSchema,
    timingPreset: PeerTimingPresetSchema.default('standard_45'),
});

export const CreatePeerInviteSchema = z.object({
    interviewType: PeerInterviewTypeSchema.default('coding'),
    preferredLanguage: SupportedLanguageSchema,
    timingPreset: PeerTimingPresetSchema.default('standard_45'),
    maxUses: z.number().int().min(1).max(5).default(1),
    expiresInSeconds: z.number().int().min(300).max(86_400).default(3600),
});

export const AcceptPeerInviteSchema = z.object({
    token: z.string().min(12).max(128),
    role: RoleSchema,
    level: PeerLevelSchema,
});

export const CreatePeerBookingSchema = z.object({
    interviewType: PeerInterviewTypeSchema.default('coding'),
    preferredLanguage: SupportedLanguageSchema,
    timingPreset: PeerTimingPresetSchema.default('standard_45'),
    scheduledFor: z.string().datetime(),
    timeZone: z.string().min(1).max(100).optional(),
});

export const SubmitPeerFeedbackSchema = z.object({
    sessionHappened: z.boolean().optional(),
    problemSolving: z.number().int().min(1).max(5).optional(),
    communication: z.number().int().min(1).max(5).optional(),
    codeQuality: z.number().int().min(1).max(5).optional(),
    interviewing: z.number().int().min(1).max(5).optional(),
    overallRating: z.number().int().min(1).max(5).optional(),
    solvedQuestion: z.boolean().optional(),
    wouldMatchAgain: z.boolean().default(true),
    whatWentWell: z.string().max(2000).optional(),
    improvementAreas: z.string().max(2000).optional(),
}).superRefine((data, ctx) => {
    if (data.sessionHappened !== false) {
        (["problemSolving", "communication", "codeQuality", "interviewing", "overallRating"] as const).forEach((field) => {
            if (data[field] === undefined || data[field] === null) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Required", path: [field] });
            }
        });
    }
});

export const PeerJoinSessionSchema = z.object({
    peerSessionId: z.string().uuid(),
});

export const PeerChatMessageSchema = z.object({
    peerSessionId: z.string().uuid(),
    text: z.string().min(1).max(10_000),
});

export const PeerTimerSyncSchema = z.object({
    peerSessionId: z.string().uuid(),
    roundKey: z.string().min(1).max(64),
    elapsedSeconds: z.number().int().min(0),
});

export const PeerTurnControlSchema = z.object({
    peerSessionId: z.string().uuid(),
});

export const PeerSessionEndSchema = z.object({
    peerSessionId: z.string().uuid(),
});

export const PeerEditorSyncSchema = z.object({
    peerSessionId: z.string().uuid(),
    code: z.string().max(50_000),
    language: SupportedLanguageSchema,
    revision: z.number().int().min(0).optional(),
});

export const PeerSignalSchema = z.object({
    peerSessionId: z.string().uuid(),
    sdp: z.string().min(1).max(200_000),
});

export const PeerIceSchema = z.object({
    peerSessionId: z.string().uuid(),
    candidate: z.string().min(1).max(4000),
});

// ---- Expert Interview Schemas ----
// The expert ("with a seasoned interviewer") feature is not yet user-facing
// (the booking card is "Coming Soon"), so enum-ish fields stay permissive to
// avoid rejecting valid inputs while the flow is still being finalized.

export const CreateExpertBookingRequestSchema = z.object({
    interviewType: z.string().min(1).max(50).default('coding'),
    preferredLanguage: z.string().min(1).max(50).default('python'),
    level: z.string().min(1).max(50),
    topicsFocus: z.array(z.string().max(100)).max(30).default([]),
    notes: z.string().max(2000).optional(),
    expiresInHours: z.number().int().min(1).max(336).default(48),
    slots: z.array(z.object({
        startAt: z.string().datetime(),
        endAt: z.string().datetime(),
        timezone: z.string().min(1).max(100),
    })).min(1).max(10),
});

export const UpsertExpertProfileSchema = z.object({
    bio: z.string().max(2000).optional(),
    expertiseTags: z.array(z.string().max(60)).max(30).default([]),
    yearsExperience: z.number().int().min(0).max(60).optional(),
    acceptingBookings: z.boolean().default(true),
});

export const ClaimExpertSlotSchema = z.object({
    slotId: z.string().uuid(),
    exactStartAt: z.string().datetime(),
    durationMinutes: z.number().int().min(15).max(180).default(60),
});

export const AddExpertSessionQuestionSchema = z.object({
    sessionId: z.string().uuid(),
    isCustom: z.boolean().default(false),
    questionId: z.string().optional(),
    questionTitle: z.string().min(1).max(300),
    questionDifficulty: z.string().max(50).optional(),
    questionTopic: z.string().max(100).optional(),
    customPrompt: z.string().max(5000).optional(),
});

export const SubmitExpertFeedbackSchema = z.object({
    sessionId: z.string().uuid(),
    problemSolving: z.number().int().min(1).max(5),
    communication: z.number().int().min(1).max(5),
    codeQuality: z.number().int().min(1).max(5),
    technicalDepth: z.number().int().min(1).max(5),
    overallRating: z.number().int().min(1).max(5),
    hireDecision: z.string().max(50).optional(),
    strengths: z.string().max(4000).optional(),
    improvementAreas: z.string().max(4000).optional(),
    privateNotes: z.string().max(4000).optional(),
    sharedWithCandidate: z.boolean().default(true),
});

export const PEER_TIMING_PRESETS = {
    standard_45: {
        label: 'Standard 45 min',
        totalMinutes: 45,
        rounds: [
            { key: 'intro', label: 'Kickoff', minutes: 5 },
            { key: 'round_a', label: 'Round A', minutes: 18 },
            { key: 'round_b', label: 'Round B', minutes: 18 },
            { key: 'debrief', label: 'Debrief', minutes: 4 },
        ],
    },
    intense_30: {
        label: 'Intense 30 min',
        totalMinutes: 30,
        rounds: [
            { key: 'intro', label: 'Kickoff', minutes: 3 },
            { key: 'round_a', label: 'Round A', minutes: 12 },
            { key: 'round_b', label: 'Round B', minutes: 12 },
            { key: 'debrief', label: 'Debrief', minutes: 3 },
        ],
    },
    deep_60: {
        label: 'Peer 60 min (2 x 30)',
        totalMinutes: 60,
        rounds: [
            { key: 'turn_1', label: 'Turn 1', minutes: 30 },
            { key: 'turn_2', label: 'Turn 2', minutes: 30 },
        ],
    },
} as const;

// ---- Peer skill rating (ELO-style, 0..2000) ----
// Single source of truth for the rating scale so the API route and the p2p
// matchmaking service can never drift apart.

export const PEER_RATING_MIN = 0;
export const PEER_RATING_MAX = 2000;

// Band boundaries: beginner [0,500), intermediate [500,1000), advanced [1000,2000].
export const PEER_BAND_INTERMEDIATE_MIN = 500;
export const PEER_BAND_ADVANCED_MIN = 1000;

// First-time seed: middle of each band so a freshly chosen level converges quickly.
export const PEER_LEVEL_SEED: Record<PeerLevel, number> = {
    beginner: 250,
    intermediate: 750,
    advanced: 1250,
};

export function clampPeerRating(score: number): number {
    if (Number.isNaN(score)) return PEER_LEVEL_SEED.beginner;
    return Math.max(PEER_RATING_MIN, Math.min(PEER_RATING_MAX, score));
}

export function seedScoreForLevel(level: PeerLevel): number {
    return PEER_LEVEL_SEED[level] ?? PEER_LEVEL_SEED.beginner;
}

export function scoreToLevel(score: number): PeerLevel {
    if (score >= PEER_BAND_ADVANCED_MIN) return 'advanced';
    if (score >= PEER_BAND_INTERMEDIATE_MIN) return 'intermediate';
    return 'beginner';
}

// ---- Inferred Types ----

export type StartInterviewInput = z.infer<typeof StartInterviewSchema>;
export type CodeExecutionRequestInput = z.infer<typeof CodeExecutionRequestSchema>;
export type CreateQuestionInput = z.infer<typeof CreateQuestionSchema>;
export type QuestionSelectionInput = z.infer<typeof QuestionSelectionSchema>;
export type CreateLatexResumeInput = z.infer<typeof CreateLatexResumeSchema>;
export type UpdateLatexResumeInput = z.infer<typeof UpdateLatexResumeSchema>;
export type LatexAiRequestInput = z.infer<typeof LatexAiRequestSchema>;
export type PeerLevel = z.infer<typeof PeerLevelSchema>;
export type PeerInterviewType = z.infer<typeof PeerInterviewTypeSchema>;
export type PeerTimingPreset = z.infer<typeof PeerTimingPresetSchema>;
export type JoinPeerQueueInput = z.infer<typeof JoinPeerQueueSchema>;
export type CreatePeerInviteInput = z.infer<typeof CreatePeerInviteSchema>;
export type AcceptPeerInviteInput = z.infer<typeof AcceptPeerInviteSchema>;
export type CreatePeerBookingInput = z.infer<typeof CreatePeerBookingSchema>;
export type SubmitPeerFeedbackInput = z.infer<typeof SubmitPeerFeedbackSchema>;
export type PeerJoinSessionInput = z.infer<typeof PeerJoinSessionSchema>;
export type PeerChatMessageInput = z.infer<typeof PeerChatMessageSchema>;
export type PeerTimerSyncInput = z.infer<typeof PeerTimerSyncSchema>;
export type PeerTurnControlInput = z.infer<typeof PeerTurnControlSchema>;
export type PeerSessionEndInput = z.infer<typeof PeerSessionEndSchema>;
export type PeerEditorSyncInput = z.infer<typeof PeerEditorSyncSchema>;
export type PeerSignalInput = z.infer<typeof PeerSignalSchema>;
export type PeerIceInput = z.infer<typeof PeerIceSchema>;
