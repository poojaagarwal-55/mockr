// ============================================
// Plan entitlements — single source of truth
// Used by both API (enforcement) and Web (UI).
// ============================================

export const PLANS = ["FREE", "PLUS", "PRO", "MAX"] as const;
export type PlanKey = (typeof PLANS)[number];

export const BILLING_CYCLES = ["MONTHLY", "QUARTERLY"] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

export type InterviewCostKey =
    | "full_interview"
    | "coding"
    | "cs_fundamentals"
    | "system_design"
    | "behavioural"
    | "gen_ai_role"
    | "data_science_role"
    | "pm_role"
    | "problem_solving_case"
    | "resume_round";

// Planned interview minutes required to start an interview of a given type.
// These match the fixed durations in constants/interview.ts.
export const INTERVIEW_MINUTE_COST: Record<InterviewCostKey, number> = {
    full_interview: 60,
    coding: 40,
    cs_fundamentals: 25,
    system_design: 30,
    behavioural: 20,
    gen_ai_role: 55,
    data_science_role: 70,
    pm_role: 90,
    problem_solving_case: 25,
    resume_round: 33,
};

export type FeatureKey =
    | "interview"
    | "resume_analysis"
    | "resume_improve_ai"
    | "latex_ai"
    | "ai_tutor"
    | "dsa_submit";

export type PlanEntitlements = {
    // Interview minutes
    monthlyInterviewMinutes: number; // granted each period (0 for FREE — one-time only)
    lifetimeFreeInterviewMinutes: number; // one-time grant (only FREE uses this)

    // Resume
    resumeAnalysisPerMonth: number; // 0 = none
    resumeImproveAiPerMonth: number; // 0 = none
    resumeBuilderAccess: boolean;

    // LaTeX editor
    latexAiAccess: boolean;
    latexAiMonthlyTokens: number; // cap per month, 0 = none

    // AI tutor
    aiTutorAccess: boolean;
    aiTutorMonthlyTokens: number;

    // DSA submit
    dsaSubmitAccess: "none" | "limited" | "full"; // none=samples only, limited=first N hidden, full=all
    dsaSubmitHiddenTestCaseCap: number | null; // null=all, 10 for PLUS
    dsaSubmitSuccessPerHourPerQuestion: number; // 10 for PRO/MAX, N/A for others but kept consistent

    // Interview recording
    interviewRecordingAccess: boolean; // can record sessions (PRO + MAX only)
    recordingRetentionDays: number;    // 0 = no access. PRO = 30, MAX = 90

    // Display / marketing
    displayName: string;
    priceInrMonthly: number; // 0 for FREE
    priceInrQuarterlyPerMonth: number; // effective /mo when paying quarterly
};

export const PLAN_ENTITLEMENTS: Record<PlanKey, PlanEntitlements> = {
    FREE: {
        monthlyInterviewMinutes: 0,
        lifetimeFreeInterviewMinutes: 0, // Minutes granted only after phone verification
        resumeAnalysisPerMonth: 1,
        resumeImproveAiPerMonth: 0,
        resumeBuilderAccess: true,
        latexAiAccess: false,
        latexAiMonthlyTokens: 0,
        aiTutorAccess: false,
        aiTutorMonthlyTokens: 0,
        dsaSubmitAccess: "none",
        dsaSubmitHiddenTestCaseCap: 0,
        dsaSubmitSuccessPerHourPerQuestion: 0,
        interviewRecordingAccess: false,
        recordingRetentionDays: 0,
        displayName: "Free",
        priceInrMonthly: 0,
        priceInrQuarterlyPerMonth: 0,
    },
    PLUS: {
        monthlyInterviewMinutes: 150,
        lifetimeFreeInterviewMinutes: 0,
        resumeAnalysisPerMonth: 5,
        resumeImproveAiPerMonth: 3,
        resumeBuilderAccess: true,
        latexAiAccess: true,
        latexAiMonthlyTokens: 200_000,
        aiTutorAccess: true,
        aiTutorMonthlyTokens: 150_000,
        dsaSubmitAccess: "limited",
        dsaSubmitHiddenTestCaseCap: 10,
        dsaSubmitSuccessPerHourPerQuestion: 10,
        interviewRecordingAccess: false,
        recordingRetentionDays: 0,
        displayName: "Plus",
        priceInrMonthly: 499,
        priceInrQuarterlyPerMonth: 399,
    },
    PRO: {
        monthlyInterviewMinutes: 300,
        lifetimeFreeInterviewMinutes: 0,
        resumeAnalysisPerMonth: 10,
        resumeImproveAiPerMonth: 5,
        resumeBuilderAccess: true,
        latexAiAccess: true,
        latexAiMonthlyTokens: 600_000,
        aiTutorAccess: true,
        aiTutorMonthlyTokens: 500_000,
        dsaSubmitAccess: "full",
        dsaSubmitHiddenTestCaseCap: 20, // Limited to 20 hidden tests to save on Judge0 API costs
        dsaSubmitSuccessPerHourPerQuestion: 10,
        interviewRecordingAccess: true,
        recordingRetentionDays: 30,
        displayName: "Pro",
        priceInrMonthly: 999,
        priceInrQuarterlyPerMonth: 899,
    },
    MAX: {
        monthlyInterviewMinutes: 900,
        lifetimeFreeInterviewMinutes: 0,
        resumeAnalysisPerMonth: 50,
        resumeImproveAiPerMonth: 50,
        resumeBuilderAccess: true,
        latexAiAccess: true,
        latexAiMonthlyTokens: 2_000_000,
        aiTutorAccess: true,
        aiTutorMonthlyTokens: 2_000_000,
        dsaSubmitAccess: "full",
        dsaSubmitHiddenTestCaseCap: 20, // Limited to 20 hidden tests to save on Judge0 API costs
        dsaSubmitSuccessPerHourPerQuestion: 10,
        interviewRecordingAccess: true,
        recordingRetentionDays: 90,
        displayName: "Max",
        priceInrMonthly: 1999,
        priceInrQuarterlyPerMonth: 1899,
    },
};

// Interview minute pack catalog
export type InterviewMinutePack = {
    id: string;
    minutes: number;
    priceInr: number;
};

export const INTERVIEW_MINUTE_PACKS: InterviewMinutePack[] = [
    { id: "mins_30", minutes: 30, priceInr: 120 },
    { id: "mins_60", minutes: 60, priceInr: 240 },
    { id: "mins_120", minutes: 120, priceInr: 450 },
    { id: "mins_200", minutes: 200, priceInr: 750 },
];

export function getInterviewMinutePack(id: string): InterviewMinutePack | undefined {
    return INTERVIEW_MINUTE_PACKS.find((p) => p.id === id);
}

export function getEntitlements(plan: PlanKey): PlanEntitlements {
    return PLAN_ENTITLEMENTS[plan];
}

export function interviewMinuteCost(type: string): number {
    return INTERVIEW_MINUTE_COST[type as InterviewCostKey] ?? 30;
}

export function interviewCreditCost(type: string): number {
    return interviewMinuteCost(type);
}

// Quarterly charge is 3 × the /mo rate
export function cyclePriceInr(plan: PlanKey, cycle: BillingCycle): number {
    const e = PLAN_ENTITLEMENTS[plan];
    if (cycle === "MONTHLY") return e.priceInrMonthly;
    return e.priceInrQuarterlyPerMonth * 3;
}
