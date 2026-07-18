// ============================================
// Evaluation & Report Types
// ============================================

export type ScoreCategory =
    | 'problem_solving'
    | 'code_quality'
    | 'communication'
    | 'cs_knowledge'
    | 'speed'
    | 'system_design'
    | 'leadership_and_initiative'
    | 'conflict_resolution'
    | 'adaptability'
    | 'teamwork'
    // Gen AI Role categories
    | 'genai_fundamentals'
    | 'genai_system_design'
    | 'ai_tool_proficiency'
    | 'ai_ethics'
    // Data Science Role categories
    | 'ds_statistics'
    | 'sql_proficiency'
    | 'data_analysis'
    | 'business_metrics'
    // Product Manager Role categories
    | 'product_ownership'
    | 'product_case_structuring'
    | 'product_metrics'
    | 'product_strategy'
    | 'behavioral_competency'
    // Problem Solving Case categories
    | 'logical_reasoning'
    | 'hint_absorption'
    | 'conviction_under_pressure'
    // Resume Round categories
    | 'claim_confidence'
    | 'project_ownership'
    | 'technical_depth'
    | 'impact_evidence'
    | 'ai_contribution_clarity'
    | 'experience_depth'
    | 'education_narrative'
    | 'role_fit'
    | 'follow_up_consistency';

export interface RubricScore {
    category: ScoreCategory;
    score: number;        // 0-10
    maxScore: 10;
    feedback: string;     // detailed per-category feedback
}

export interface EvaluationReport {
    id: string;
    sessionId: string;
    userId: string;
    overallScore: number;      // 0-100 (weighted aggregate)
    rubricScores: RubricScore[];
    sectionFeedback: SectionFeedback[];
    strengths: string[];
    improvements: string[];
    benchmark: BenchmarkResult | null;
    generatedAt: string;
}

export interface SectionFeedback {
    stage: string;              // "Introduction", "DSA", "Fundamentals"
    summary: string;
    score: number;              // 0-10
    details: string;            // detailed markdown feedback
}

export interface BenchmarkResult {
    role: string;
    level: string;
    percentile: number;         // e.g. 34 means "top 34%"
    totalCandidates: number;
    message: string;            // "You scored in the top 34% for SDE1 Backend"
}

export interface SessionQuestionResult {
    id: string;
    sessionId: string;
    questionId: string;
    askedAt: string;
    timeSpentSecs: number | null;
    finalCode: string | null;
    score: number | null;        // 0-10
    aiNotes: string | null;      // AI's evaluation summary for this question
}
