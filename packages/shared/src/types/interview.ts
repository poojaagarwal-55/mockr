// ============================================
// Interview Session Types
// ============================================

import type { ScoreCategory } from './evaluation.js';

// ── Interview Types ──────────────────────────────────────────
// Each interview type has its own flow, stages, prompts, and tools.

export type InterviewType =
    | 'full_interview'
    | 'coding'
    | 'cs_fundamentals'
    | 'system_design'
    | 'behavioural'
    | 'gen_ai_role'
    | 'data_science_role'
    | 'pm_role'
    | 'problem_solving_case'
    | 'resume_round';

export type InterviewStage =
    | 'INTRO'
    | 'DSA'
    | 'FUNDAMENTALS'
    | 'SYSTEM_DESIGN'
    | 'BEHAVIOURAL'
    | 'CLOSING'
    | 'GEN_AI_CONCEPTS'
    | 'GEN_AI_CODING'
    | 'GEN_AI_SYSTEM_DESIGN'
    // Data Science Role
    | 'DS_CONCEPTS'
    | 'DS_SQL'
    | 'DS_CODING'
    | 'DS_BUSINESS_CASE'
    | 'PROBLEM_SOLVING'
    // Product Manager Role
    | 'PM_CASE'
    | 'PM_CONCEPTS'
    | 'PM_STRATEGY'
    | 'PM_BEHAVIORAL'
    // Resume Round
    | 'RESUME_STUDIES'
    | 'RESUME_PROJECTS'
    | 'RESUME_EXPERIENCE'
    | 'RESUME_RESPONSIBILITY'
    | 'RESUME_SKILLS';

export interface InterviewModuleConfig {
    version: 1;
    enabledStages: InterviewStage[];
    disabledStages?: InterviewStage[];
    source?: 'default' | 'custom';
    stageOptions?: Partial<Record<InterviewStage, {
        topics?: string[];
        subtopics?: string[];
        difficulty?: 'Easy' | 'Medium' | 'Hard' | string;
        includeSQL?: boolean;
        questionCountPerTopic?: number;
        resumeDeepDiveEnabled?: boolean;
    }>>;
    stageDurations?: Partial<Record<InterviewStage, { min: number; max: number }>>;
}

/** Metadata for an interview type (used by UI and API) */
export interface InterviewTypeMetadata {
    type: InterviewType;
    label: string;
    description: string;
    icon: string;              // material icon name for UI
    durationMinutes: number;
    stages: InterviewStage[];
    scoringCategories: ScoreCategory[];
}

