export type TechnicalAssignmentConfig = {
    title: string;
    timeLimit: string;
    estimatedHours: string;
    deadlinePolicy: string;
    overview: string;
    scenario: string;
    tasks: string;
    starterContext: string;
    constraints: string;
    allowedStack: string;
    deliverables: string;
    submissionInstructions: string;
    thinkingQuestions: string;
    candidateMessage: string;
    functionalityWeight: string;
    architectureWeight: string;
    codeQualityWeight: string;
    documentationWeight: string;
    testingWeight: string;
    productThinkingWeight: string;
    securityWeight: string;
};

export type TechnicalAssignmentSubmission = {
    id: string;
    applicationId?: string | null;
    applicationStatus?: string | null;
    nextRoundType?: string | null;
    roundNextRoundType?: string | null;
    roundNextRoundMovedAt?: string | null;
    roundAdvanced?: boolean;
    candidateName: string;
    candidateEmail: string;
    profileUrl?: string | null;
    avatarUrl?: string | null;
    repoUrl: string;
    submittedAt: string;
    score: number;
    status: "submitted" | "evaluated" | string;
    report: {
        summary: string;
        strengths: string[];
        risks: string[];
        rubric: Array<{ label: string; score: number; weight: number }>;
    };
};

export type TechnicalAssignmentRecord = {
    id: string;
    jobId: string;
    jobTitle: string;
    companyName: string;
    jobNextRoundType?: string | null;
    jobNextRoundConfiguredAt?: string | null;
    jobCurrentRoundType?: string | null;
    jobCurrentRoundResourceId?: string | null;
    jobCurrentRoundConfiguredAt?: string | null;
    createdAt: string;
    closesAt: string;
    status?: "live" | "closed" | string;
    config: TechnicalAssignmentConfig;
    submissions: TechnicalAssignmentSubmission[];
};

export function durationToMs(value: string) {
    const clean = value.toLowerCase();
    const amount = Number.parseInt(clean.match(/\d+/)?.[0] || "48", 10);
    if (clean.includes("day")) return amount * 24 * 60 * 60 * 1000;
    if (clean.includes("week")) return amount * 7 * 24 * 60 * 60 * 1000;
    return amount * 60 * 60 * 1000;
}
