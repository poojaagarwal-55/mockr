// ============================================
// Interview Flow Constants
// ============================================

import type { InterviewStage, InterviewType, InterviewTypeMetadata } from '../types/interview.js';
import type { ScoreCategory } from '../types/evaluation.js';

// ── Interview Types ──────────────────────────────────────────
// Master list of all interview types with their metadata.
// Each type defines its own stage flow, duration, and scoring.

export const INTERVIEW_TYPES: InterviewTypeMetadata[] = [
    {
        type: 'full_interview',
        label: 'SDE Interview',
        description: 'Complete mock interview covering resume discussion, coding, fundamentals, and wrap-up.',
        icon: 'assignment',
        durationMinutes: 85,
        stages: ['INTRO', 'DSA', 'FUNDAMENTALS', 'CLOSING'],
        scoringCategories: ['problem_solving', 'code_quality', 'communication', 'cs_knowledge', 'speed'],
    },
    {
        type: 'coding',
        label: 'Coding Interview',
        description: 'Focused coding interview with DSA problems. Practice data structures, algorithms, and problem-solving.',
        icon: 'code',
        durationMinutes: 40,
        stages: ['DSA', 'CLOSING'],
        scoringCategories: ['problem_solving', 'code_quality', 'communication', 'speed'],
    },
    {
        type: 'cs_fundamentals',
        label: 'CS Fundamentals',
        description: 'Deep dive into OS, networking, databases, and core CS concepts relevant to your role.',
        icon: 'school',
        durationMinutes: 25,
        stages: ['INTRO', 'FUNDAMENTALS', 'CLOSING'],
        scoringCategories: ['cs_knowledge', 'communication', 'problem_solving'],
    },
    {
        type: 'system_design',
        label: 'System Design Interview',
        description: 'Design scalable systems from scratch. Practice requirements gathering, architecture, and trade-off analysis.',
        icon: 'hub',
        durationMinutes: 30,
        stages: ['INTRO', 'SYSTEM_DESIGN', 'CLOSING'],
        scoringCategories: ['system_design', 'communication', 'problem_solving'],
    },
    {
        type: 'behavioural',
        label: 'Behavioural Interview',
        description: 'Practice STAR-method answers for leadership, conflict resolution, and teamwork questions.',
        icon: 'psychology',
        durationMinutes: 20,
        stages: ['INTRO', 'BEHAVIOURAL', 'CLOSING'],
        scoringCategories: ['communication', 'leadership_and_initiative', 'conflict_resolution', 'adaptability', 'teamwork', 'problem_solving'],
    },
    {
        type: 'gen_ai_role',
        label: 'Gen AI Interview',
        description: 'Comprehensive interview for Generative AI engineers: resume deep-dive, GenAI fundamentals, live coding, and an AI responsibility wrap-up.',
        icon: 'auto_awesome',
        durationMinutes: 55,
        stages: ['INTRO', 'GEN_AI_CONCEPTS', 'GEN_AI_CODING', 'CLOSING'],
        scoringCategories: ['genai_fundamentals', 'ai_tool_proficiency', 'ai_ethics', 'communication', 'problem_solving'],
    },
    {
        type: 'data_science_role',
        label: 'Data Science Interview',
        description: '5-phase DS interview: resume deep-dive on data projects, statistics & ML concepts, SQL problem set, live Python/Pandas coding task, and business metrics case.',
        icon: 'analytics',
        durationMinutes: 70,
        stages: ['INTRO', 'DS_CONCEPTS', 'DS_SQL', 'DS_CODING', 'DS_BUSINESS_CASE'],
        scoringCategories: ['ds_statistics', 'sql_proficiency', 'data_analysis', 'business_metrics', 'communication', 'problem_solving'],
    },
    {
        type: 'pm_role',
        label: 'Product Manager Interview',
        description: '5-phase PM interview: resume ownership deep-dive, live CIRCLES product case with notepad, PM concepts verbal round, product strategy with devil\'s advocate, and STAR behavioral + Q&A.',
        icon: 'inventory_2',
        durationMinutes: 90,
        stages: ['INTRO', 'PM_CASE', 'PM_CONCEPTS', 'PM_STRATEGY', 'PM_BEHAVIORAL'],
        scoringCategories: ['product_ownership', 'product_case_structuring', 'product_metrics', 'product_strategy', 'behavioral_competency', 'communication'],
    },
    {
        type: 'problem_solving_case',
        label: 'Problem Solving Interview',
        description: 'Structured analytical puzzle/case interview focused on assumptions, hints, twists, and reasoning under pressure.',
        icon: 'extension',
        durationMinutes: 25,
        stages: ['PROBLEM_SOLVING', 'CLOSING'],
        scoringCategories: ['problem_solving', 'logical_reasoning', 'hint_absorption', 'conviction_under_pressure', 'communication', 'adaptability'],
    },
    {
        type: 'resume_round',
        label: 'Resume Screening Interview',
        description: 'Standalone resume screening interview covering project proof, experience, leadership, role fit, ownership, impact, and AI contribution clarity.',
        icon: 'badge',
        durationMinutes: 33,
        stages: ['RESUME_STUDIES', 'RESUME_PROJECTS', 'RESUME_EXPERIENCE', 'RESUME_RESPONSIBILITY', 'RESUME_SKILLS', 'CLOSING'],
        scoringCategories: ['claim_confidence', 'project_ownership', 'technical_depth', 'impact_evidence', 'ai_contribution_clarity', 'experience_depth', 'role_fit', 'follow_up_consistency', 'communication'],
    },
];

/** Map of interview type → metadata for quick lookup */
export const INTERVIEW_TYPE_MAP: Record<InterviewType, InterviewTypeMetadata> = Object.fromEntries(
    INTERVIEW_TYPES.map(t => [t.type, t])
) as Record<InterviewType, InterviewTypeMetadata>;

/** Get the ordered stage flow for a given interview type */
export function getStagesForType(type: InterviewType): InterviewStage[] {
    return INTERVIEW_TYPE_MAP[type].stages;
}

/** Get the duration in minutes for a given interview type */
export function getDurationForType(type: InterviewType): number {
    return INTERVIEW_TYPE_MAP[type].durationMinutes;
}

// ── Per-Type Stage Durations ─────────────────────────────────
// Each interview type allocates time differently across its stages.

export const STAGE_DURATIONS_BY_TYPE: Record<InterviewType, Partial<Record<InterviewStage, { min: number; max: number }>>> = {
    full_interview: {
        INTRO: { min: 5, max: 7 },
        DSA: { min: 20, max: 30 },
        FUNDAMENTALS: { min: 10, max: 15 },
        CLOSING: { min: 3, max: 5 },
    },
    coding: {
        DSA: { min: 35, max: 38 },
        CLOSING: { min: 2, max: 3 },
    },
    cs_fundamentals: {
        INTRO: { min: 2, max: 3 },
        FUNDAMENTALS: { min: 18, max: 22 },
        CLOSING: { min: 2, max: 3 },
    },
    system_design: {
        INTRO: { min: 2, max: 3 },
        SYSTEM_DESIGN: { min: 23, max: 27 },
        CLOSING: { min: 2, max: 3 },
    },
    behavioural: {
        INTRO: { min: 2, max: 3 },
        BEHAVIOURAL: { min: 14, max: 17 },
        CLOSING: { min: 2, max: 3 },
    },
    gen_ai_role: {
        INTRO:                { min: 8,  max: 10 },
        GEN_AI_CONCEPTS:      { min: 8,  max: 10 },
        GEN_AI_CODING:        { min: 20, max: 25 },
        CLOSING:              { min: 5,  max: 5  },
    },
    data_science_role: {
        INTRO:           { min: 10, max: 10 },
        DS_CONCEPTS:     { min: 15, max: 15 },
        DS_SQL:          { min: 15, max: 15 },
        DS_CODING:       { min: 20, max: 20 },
        DS_BUSINESS_CASE:{ min: 10, max: 10 },
    },
    pm_role: {
        INTRO:        { min: 12, max: 18 },
        PM_CASE:      { min: 18, max: 22 },
        PM_CONCEPTS:  { min: 12, max: 18 },
        PM_STRATEGY:  { min: 12, max: 18 },
        PM_BEHAVIORAL:{ min: 10, max: 14 },
    },
    problem_solving_case: {
        PROBLEM_SOLVING: { min: 20, max: 25 },
        CLOSING: { min: 2, max: 3 },
    },
    resume_round: {
        RESUME_STUDIES: { min: 1, max: 1 },
        RESUME_PROJECTS: { min: 16, max: 18 },
        RESUME_EXPERIENCE: { min: 4, max: 5 },
        RESUME_RESPONSIBILITY: { min: 2, max: 3 },
        RESUME_SKILLS: { min: 4, max: 4 },
        CLOSING: { min: 2, max: 2 },
    },
};

/** Max hints per question */
export const MAX_HINTS_PER_QUESTION = 3;

/** Max messages to keep in AI context window */
export const MAX_CONTEXT_MESSAGES = 30;

/** Stage labels for UI display */
export const STAGE_LABELS: Record<InterviewStage, string> = {
    INTRO: 'Introduction',
    DSA: 'Data Structures & Algorithms',
    FUNDAMENTALS: 'CS Fundamentals',
    SYSTEM_DESIGN: 'System Design',
    BEHAVIOURAL: 'Behavioural',
    CLOSING: 'Wrap Up',
    GEN_AI_CONCEPTS: 'GenAI Fundamentals',
    GEN_AI_CODING: 'Coding',
    GEN_AI_SYSTEM_DESIGN: 'Gen AI System Design',
    DS_CONCEPTS: 'Stats & ML Concepts',
    DS_SQL: 'SQL Problem Set',
    DS_CODING: 'Data Analysis Coding',
    DS_BUSINESS_CASE: 'Business Metrics Case',
    PROBLEM_SOLVING: 'Problem Solving',
    // Product Manager Role
    PM_CASE: 'Product Case',
    PM_CONCEPTS: 'PM Concepts',
    PM_STRATEGY: 'Product Strategy',
    PM_BEHAVIORAL: 'Behavioural',
    RESUME_STUDIES: 'Opening Calibration',
    RESUME_PROJECTS: 'Projects Verification',
    RESUME_EXPERIENCE: 'Work Experience',
    RESUME_RESPONSIBILITY: 'Positions of Responsibility',
    RESUME_SKILLS: 'Fit & Communication',
};
