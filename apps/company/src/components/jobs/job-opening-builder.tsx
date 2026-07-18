"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useCompanyAuth } from "@/context/company-auth-context";
import { api, ApiError, getApiBaseUrl } from "@/lib/api";
import { companyRoundMonitorPath } from "@/lib/company-round-navigation";
import { type TechnicalAssignmentConfig } from "@/lib/technical-assignments";

type JobOpening = {
    id: string;
    companyName: string;
    companyLogoUrl?: string | null;
    title: string;
    location: string;
    workMode: string;
    employmentType: string;
    roleType: string;
    travel: string;
    openings: number;
    experienceLevel: string;
    compensationType: string;
    compensation?: string | null;
    duration?: string | null;
    timeCommitment?: string | null;
    applicationDeadline?: string | null;
    skills: string[];
    companyOverview?: string | null;
    aboutRole: string;
    responsibilities: string[];
    requirements: string[];
    benefits: string[];
    applicationNote?: string | null;
    scoringConfig?: ScoreConfig;
    nextRoundType?: NextRoundPipeline | null;
    nextRoundConfiguredAt?: string | null;
    currentRoundType?: NextRoundPipeline | null;
    currentRoundResourceId?: string | null;
    currentRoundConfiguredAt?: string | null;
    status: "draft" | "open" | "closed";
    applicationCount?: number;
    createdAt: string;
};

type JobApplicationSummary = {
    id: string;
    status: string;
    nextRoundType?: NextRoundPipeline | null;
    nextRoundMovedAt?: string | null;
    selectedProjects: Array<{ fullName?: string; name?: string; fork?: boolean }>;
    githubAnalysis?: { score?: number; projects?: Array<{ score?: number; repo?: { fullName?: string; fork?: boolean }; reason?: string; skipped?: boolean }> } | null;
    codingAnalysis?: { score?: number; linkedCount?: number } | null;
    submittedAt: string;
    recruiterReport?: RecruiterReport;
    user: {
        fullName: string;
        email: string;
        username?: string | null;
        avatarUrl?: string | null;
    };
};

type NextRoundPipeline = "ai_interview" | "mock_oa" | "technical_assignment" | "final_interview";

const nextRoundPipelineOptions: Array<{ value: NextRoundPipeline; title: string; description: string; icon: string }> = [
    { value: "ai_interview", title: "AI based interview", description: "Generate an adaptive interview flow for shortlisted candidates.", icon: "smart_toy" },
    { value: "mock_oa", title: "Online assessment", description: "Move candidates into a secure question-bank OA round.", icon: "quiz" },
    { value: "technical_assignment", title: "Technical assignment", description: "Ask for a focused take-home project or task.", icon: "assignment" },
    { value: "final_interview", title: "Direct final interview", description: "Skip intermediate filters and schedule the final conversation.", icon: "groups" },
];

type RecruiterReport = {
    headline: string;
    profileSummary?: string;
    overallScore?: number;
    githubScore?: number;
    codingScore?: number;
    scoringConfig?: ScoreConfig;
    summary?: string[];
    charts?: {
        overall: Array<{ label: string; value: number; weight: number }>;
        projects: Array<{ label: string; value: number; status?: string }>;
        coding: Array<{ label: string; value: number }>;
    };
    projectSlots?: Array<{
        title: string;
        score: number;
        status?: string;
        summary: string;
        breakdown: Array<{ label: string; score: number; weight: number; note: string }>;
    }>;
    coding?: {
        score: number;
        linkedCount: number;
        breakdown: Array<{ label: string; score: number; weight: number; note: string }>;
    };
    agentSummary?: {
        profileSummary?: Record<string, any>;
        projectQuality?: Record<string, any>;
        techStackMatch?: Record<string, any>;
        domainRelevance?: Record<string, any>;
        codingProfile?: Record<string, any>;
        finalSynthesis?: Record<string, any>;
    };
    recommendation?: string;
};

type ScoreConfig = {
    weights: { github: number; coding: number };
    github: {
        requiredTechStack: string[];
        focusAreas: string[];
        minCommitsLastYear: number;
        minCommitsLastMonth: number;
        minOwnershipPercent: number;
        minProjectAgeDays: number;
        criteriaWeights: {
            stack: number;
            commits: number;
            ownership: number;
            documentation: number;
            complexity: number;
            relevance: number;
        };
    };
    coding: {
        minLinkedProfiles: number;
        leetcode: { minTotal: number; minEasy: number; minMedium: number; minHard: number };
        codeforces: { minRating: number; minContests: number; minSolved: number };
        criteriaWeights: { leetcode: number; codeforces: number; profileCoverage: number };
    };
};

type JobFormState = Omit<JobOpening, "id" | "skills" | "status" | "createdAt" | "openings" | "responsibilities" | "requirements" | "benefits" | "compensation" | "duration" | "timeCommitment" | "applicationDeadline" | "companyOverview" | "applicationNote"> & {
    skillsText: string;
    companyLogoName: string;
    openings: string;
    compensation: string;
    duration: string;
    timeCommitment: string;
    applicationDeadline: string;
    companyOverview: string;
    responsibilities: string;
    requirements: string;
    benefits: string;
    applicationNote: string;
    githubWeight: string;
    codingWeight: string;
    requiredTechStackText: string;
    projectFocusText: string;
    minCommitsLastYear: string;
    minCommitsLastMonth: string;
    minOwnershipPercent: string;
    minProjectAgeDays: string;
    minLeetcodeTotal: string;
    minLeetcodeEasy: string;
    minLeetcodeMedium: string;
    minLeetcodeHard: string;
    minCodeforcesRating: string;
    minCodeforcesContests: string;
    minCodeforcesSolved: string;
    minLinkedProfiles: string;
};

type TechnicalAssignmentFormState = TechnicalAssignmentConfig;

const defaultScoringConfig: ScoreConfig = {
    weights: { github: 60, coding: 40 },
    github: {
        requiredTechStack: [],
        focusAreas: [],
        minCommitsLastYear: 20,
        minCommitsLastMonth: 2,
        minOwnershipPercent: 50,
        minProjectAgeDays: 30,
        criteriaWeights: { stack: 20, commits: 20, ownership: 15, documentation: 15, complexity: 15, relevance: 15 },
    },
    coding: {
        minLinkedProfiles: 1,
        leetcode: { minTotal: 100, minEasy: 40, minMedium: 40, minHard: 5 },
        codeforces: { minRating: 1200, minContests: 5, minSolved: 100 },
        criteriaWeights: { leetcode: 45, codeforces: 35, profileCoverage: 20 },
    },
};

const defaultForm: JobFormState = {
    companyName: "",
    companyLogoName: "",
    title: "",
    location: "",
    workMode: "Remote",
    employmentType: "Internship",
    roleType: "Individual Contributor",
    travel: "No travel",
    openings: "1",
    experienceLevel: "Intern",
    compensationType: "Unpaid",
    compensation: "",
    duration: "",
    timeCommitment: "",
    applicationDeadline: "",
    skillsText: "",
    companyOverview: "",
    aboutRole: "",
    responsibilities: "",
    requirements: "",
    benefits: "",
    applicationNote: "",
    githubWeight: "60",
    codingWeight: "40",
    requiredTechStackText: "",
    projectFocusText: "",
    minCommitsLastYear: "20",
    minCommitsLastMonth: "2",
    minOwnershipPercent: "50",
    minProjectAgeDays: "30",
    minLeetcodeTotal: "100",
    minLeetcodeEasy: "40",
    minLeetcodeMedium: "40",
    minLeetcodeHard: "5",
    minCodeforcesRating: "1200",
    minCodeforcesContests: "5",
    minCodeforcesSolved: "100",
    minLinkedProfiles: "1",
};

function defaultFormForCompany(company?: {
    name?: string | null;
    logoUrl?: string | null;
    defaultWorkMode?: string | null;
    defaultEmploymentType?: string | null;
} | null) {
    return {
        ...defaultForm,
        companyName: company?.name || "",
        companyLogoUrl: company?.logoUrl || null,
        companyLogoName: company?.logoUrl ? "Workspace logo" : "",
        workMode: company?.defaultWorkMode || defaultForm.workMode,
        employmentType: company?.defaultEmploymentType || defaultForm.employmentType,
    };
}

function technicalAssignmentDefaults(opening: JobOpening): TechnicalAssignmentFormState {
    const stack = opening.skills?.length ? opening.skills.join(", ") : "Use the stack required for this role";
    return {
        title: `${opening.title} technical assignment`,
        timeLimit: "48 hours",
        estimatedHours: "8 hours",
        deadlinePolicy: "Submission closes automatically after the assignment deadline. Late submissions need company approval.",
        overview: `Build a focused project that proves the candidate can solve a real ${opening.title} problem, explain tradeoffs, and submit readable code.`,
        scenario: "Describe the real product or engineering scenario the candidate should solve. Include users, inputs, outputs, and important business rules.",
        tasks: [
            "Build the core feature or service described in the scenario.",
            "Persist the important data with a clear schema or data model.",
            "Add meaningful error handling and validation.",
            "Document setup, assumptions, and key decisions in the README.",
        ].join("\n"),
        starterContext: "Add mock data, sample payloads, API contracts, entities, or domain context candidates must use.",
        constraints: [
            "Do not hardcode secrets. Provide .env.example only.",
            "Handle invalid inputs gracefully.",
            "Keep the repository public or grant reviewer access before the deadline.",
            "Do not submit copied or forked work.",
        ].join("\n"),
        allowedStack: stack,
        deliverables: [
            "GitHub repository link",
            "README.md with setup, architecture, assumptions, and evaluation notes",
            "Source code in /src or /app",
            "Tests or a short test plan",
            "Optional demo video or deployed URL",
        ].join("\n"),
        submissionInstructions: "Submit the GitHub repository link from the candidate dashboard. The repo must include all deliverables before the deadline.",
        thinkingQuestions: [
            "What was the hardest design decision and why?",
            "What would you improve with one more day?",
            "How would you monitor or scale this in production?",
        ].join("\n"),
        candidateMessage: `You have been moved to the technical assignment round for ${opening.title}. Please read the brief carefully and submit your project before the deadline.`,
        functionalityWeight: "25",
        architectureWeight: "15",
        codeQualityWeight: "15",
        documentationWeight: "15",
        testingWeight: "10",
        productThinkingWeight: "10",
        securityWeight: "10",
    };
}

function technicalAssignmentRubricTotal(form: TechnicalAssignmentFormState) {
    return [
        form.functionalityWeight,
        form.architectureWeight,
        form.codeQualityWeight,
        form.documentationWeight,
        form.testingWeight,
        form.productThinkingWeight,
        form.securityWeight,
    ].reduce((sum, value) => sum + (Number.parseInt(value, 10) || 0), 0);
}

type DurationParts = {
    days: number;
    hours: number;
    minutes: number;
};

const emptyDurationParts: DurationParts = { days: 0, hours: 0, minutes: 0 };

function clampDurationPart(value: string, max: number) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.min(max, parsed));
}

function parseDurationParts(value: string): DurationParts {
    const clean = value.trim().toLowerCase();
    if (!clean) return emptyDurationParts;

    const days = Number.parseInt(clean.match(/(\d+)\s*(?:d|day|days)\b/)?.[1] || "", 10);
    const hours = Number.parseInt(clean.match(/(\d+)\s*(?:h|hr|hrs|hour|hours)\b/)?.[1] || "", 10);
    const minutes = Number.parseInt(clean.match(/(\d+)\s*(?:m|min|mins|minute|minutes)\b/)?.[1] || "", 10);
    const numbers = clean.match(/\d+(?:\.\d+)?/g)?.map((item) => Number.parseFloat(item)).filter(Number.isFinite) || [];

    if (Number.isFinite(days) || Number.isFinite(hours) || Number.isFinite(minutes)) {
        return {
            days: Number.isFinite(days) ? Math.max(0, days) : 0,
            hours: Number.isFinite(hours) ? Math.max(0, hours) : 0,
            minutes: Number.isFinite(minutes) ? Math.max(0, minutes) : 0,
        };
    }

    const amount = Math.max(...numbers, 0);
    if (!amount) return emptyDurationParts;
    if (/\b(month|months)\b/.test(clean)) return totalMinutesToParts(amount * 30 * 24 * 60);
    if (/\b(week|weeks)\b/.test(clean)) return totalMinutesToParts(amount * 7 * 24 * 60);
    if (/\b(min|mins|minute|minutes)\b/.test(clean)) return totalMinutesToParts(amount);
    if (/\b(day|days)\b/.test(clean)) return totalMinutesToParts(amount * 24 * 60);
    return totalMinutesToParts(amount * 60);
}

function totalMinutesToParts(totalMinutes: number): DurationParts {
    const normalized = Math.max(0, Math.round(totalMinutes));
    const days = Math.floor(normalized / 1440);
    const remainingAfterDays = normalized % 1440;
    const hours = Math.floor(remainingAfterDays / 60);
    const minutes = remainingAfterDays % 60;
    return { days, hours, minutes };
}

function durationPartsToHours(parts: DurationParts) {
    return parts.days * 24 + parts.hours + parts.minutes / 60;
}

function durationPartsToText(parts: DurationParts) {
    const chunks: string[] = [];
    if (parts.days) chunks.push(`${parts.days} ${parts.days === 1 ? "day" : "days"}`);
    if (parts.hours) chunks.push(`${parts.hours} ${parts.hours === 1 ? "hour" : "hours"}`);
    if (parts.minutes) chunks.push(`${parts.minutes} ${parts.minutes === 1 ? "minute" : "minutes"}`);
    return chunks.join(" ") || "0 minutes";
}

function durationHours(value: string) {
    const parts = parseDurationParts(value);
    const hours = durationPartsToHours(parts);
    return hours > 0 ? hours : null;
}

function technicalAssignmentValidationErrors(form: TechnicalAssignmentFormState) {
    const errors: string[] = [];
    const submissionWindowHours = durationHours(form.timeLimit);
    const expectedEffortHours = form.estimatedHours.trim() ? durationHours(form.estimatedHours) : null;

    if (!form.title.trim()) errors.push("Assignment title is required.");
    if (!form.timeLimit.trim()) errors.push("Submission window is required.");
    if (form.timeLimit.trim() && submissionWindowHours === null) errors.push("Submission window must be greater than 0 minutes.");
    if (form.estimatedHours.trim() && expectedEffortHours === null) errors.push("Expected effort must be greater than 0 minutes.");
    if (submissionWindowHours !== null && expectedEffortHours !== null && expectedEffortHours > submissionWindowHours) {
        errors.push("Expected effort cannot be greater than the submission window.");
    }
    if (!form.overview.trim()) errors.push("Assessment overview is required.");
    if (!form.scenario.trim()) errors.push("Scenario is required.");
    if (!form.tasks.trim()) errors.push("At least one task is required.");
    if (!form.deliverables.trim()) errors.push("Submission deliverables are required.");
    if (technicalAssignmentRubricTotal(form) !== 100) errors.push("Evaluation rubric weights must add up to 100.");
    return errors;
}

function technicalAssignmentPayload(form: TechnicalAssignmentFormState) {
    return {
        title: form.title,
        timeLimit: form.timeLimit,
        estimatedHours: form.estimatedHours,
        deadlinePolicy: form.deadlinePolicy,
        overview: form.overview,
        scenario: form.scenario,
        tasks: splitLines(form.tasks),
        starterContext: form.starterContext,
        constraints: splitLines(form.constraints),
        allowedStack: splitSkills(form.allowedStack),
        deliverables: splitLines(form.deliverables),
        submissionInstructions: form.submissionInstructions,
        thinkingQuestions: splitLines(form.thinkingQuestions),
        candidateMessage: form.candidateMessage,
        rubric: {
            functionality: numberFrom(form.functionalityWeight, 25),
            architecture: numberFrom(form.architectureWeight, 15),
            codeQuality: numberFrom(form.codeQualityWeight, 15),
            documentation: numberFrom(form.documentationWeight, 15),
            testing: numberFrom(form.testingWeight, 10),
            productThinking: numberFrom(form.productThinkingWeight, 10),
            security: numberFrom(form.securityWeight, 10),
        },
    };
}

function splitSkills(value: string) {
    return value
        .split(/[\n,;|/]+|\s+(?:and|&|\+)\s+/gi)
        .map((skill) => skill.trim())
        .filter(Boolean)
        .slice(0, 24);
}

function splitLines(value: string) {
    return value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 40);
}

function apiErrorMessage(err: unknown, fallback: string) {
    if (!(err instanceof ApiError)) return fallback;

    const body = err.body as { details?: Record<string, string[] | undefined>; message?: string } | undefined;
    const detailMessages = Object.entries(body?.details || {})
        .flatMap(([field, messages]) => (messages || []).filter(Boolean).map((message) => `${field}: ${message}`));

    return body?.message || detailMessages[0] || err.message || fallback;
}

function normalizeScoreConfig(config?: ScoreConfig | null): ScoreConfig {
    return {
        ...defaultScoringConfig,
        ...(config || {}),
        weights: { ...defaultScoringConfig.weights, ...(config?.weights || {}) },
        github: {
            ...defaultScoringConfig.github,
            ...(config?.github || {}),
            criteriaWeights: { ...defaultScoringConfig.github.criteriaWeights, ...(config?.github?.criteriaWeights || {}) },
        },
        coding: {
            ...defaultScoringConfig.coding,
            ...(config?.coding || {}),
            leetcode: { ...defaultScoringConfig.coding.leetcode, ...(config?.coding?.leetcode || {}) },
            codeforces: { ...defaultScoringConfig.coding.codeforces, ...(config?.coding?.codeforces || {}) },
            criteriaWeights: { ...defaultScoringConfig.coding.criteriaWeights, ...(config?.coding?.criteriaWeights || {}) },
        },
    };
}

function numberFrom(value: string, fallback: number) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function percentageFrom(value: string) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
}

function sumValues(values: Record<string, number>) {
    return Object.values(values).reduce((sum, item) => sum + Number(item || 0), 0);
}

function scorecardValidationErrors(form: JobFormState) {
    const errors: string[] = [];
    const topLevelTotal = percentageFrom(form.githubWeight) + percentageFrom(form.codingWeight);
    if (topLevelTotal !== 100) {
        errors.push(`GitHub weight and coding profile weight must add up to 100. Current total is ${topLevelTotal}.`);
    }

    const githubCriteriaTotal = sumValues(defaultScoringConfig.github.criteriaWeights);
    if (githubCriteriaTotal !== 100) {
        errors.push(`GitHub criteria weights must add up to 100. Current total is ${githubCriteriaTotal}.`);
    }

    const codingCriteriaTotal = sumValues(defaultScoringConfig.coding.criteriaWeights);
    if (codingCriteriaTotal !== 100) {
        errors.push(`Coding criteria weights must add up to 100. Current total is ${codingCriteriaTotal}.`);
    }

    return errors;
}

function scoringConfigFromForm(form: JobFormState): ScoreConfig {
    const githubWeight = Math.max(0, Math.min(100, numberFrom(form.githubWeight, 60)));
    const codingWeight = Math.max(0, Math.min(100, numberFrom(form.codingWeight, 40)));
    return {
        ...defaultScoringConfig,
        weights: { github: githubWeight, coding: codingWeight },
        github: {
            ...defaultScoringConfig.github,
            requiredTechStack: splitSkills(form.requiredTechStackText),
            focusAreas: splitSkills(form.projectFocusText),
            minCommitsLastYear: numberFrom(form.minCommitsLastYear, 20),
            minCommitsLastMonth: numberFrom(form.minCommitsLastMonth, 2),
            minOwnershipPercent: numberFrom(form.minOwnershipPercent, 50),
            minProjectAgeDays: numberFrom(form.minProjectAgeDays, 30),
        },
        coding: {
            ...defaultScoringConfig.coding,
            minLinkedProfiles: numberFrom(form.minLinkedProfiles, 1),
            leetcode: {
                minTotal: numberFrom(form.minLeetcodeTotal, 100),
                minEasy: numberFrom(form.minLeetcodeEasy, 40),
                minMedium: numberFrom(form.minLeetcodeMedium, 40),
                minHard: numberFrom(form.minLeetcodeHard, 5),
            },
            codeforces: {
                minRating: numberFrom(form.minCodeforcesRating, 1200),
                minContests: numberFrom(form.minCodeforcesContests, 5),
                minSolved: numberFrom(form.minCodeforcesSolved, 100),
            },
        },
    };
}

function toInputDate(value?: string | null) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toISOString().slice(0, 10);
}

function isDeadlinePassed(value?: string | null) {
    if (!value) return false;
    const deadline = new Date(value);
    if (Number.isNaN(deadline.getTime())) return false;
    deadline.setHours(23, 59, 59, 999);
    return deadline.getTime() < Date.now();
}

function formFromOpening(opening: JobOpening): JobFormState {
    const scoringConfig = normalizeScoreConfig(opening.scoringConfig);
    return {
        ...defaultForm,
        ...opening,
        companyLogoName: opening.companyLogoUrl ? "Uploaded logo" : "",
        openings: String(opening.openings || 1),
        compensation: opening.compensation || "",
        duration: opening.duration || "",
        timeCommitment: opening.timeCommitment || "",
        applicationDeadline: toInputDate(opening.applicationDeadline),
        skillsText: (opening.skills || []).join(", "),
        companyOverview: opening.companyOverview || "",
        responsibilities: (opening.responsibilities || []).join("\n"),
        requirements: (opening.requirements || []).join("\n"),
        benefits: (opening.benefits || []).join("\n"),
        applicationNote: opening.applicationNote || "",
        githubWeight: String(scoringConfig.weights.github),
        codingWeight: String(scoringConfig.weights.coding),
        requiredTechStackText: scoringConfig.github.requiredTechStack.join(", "),
        projectFocusText: scoringConfig.github.focusAreas.join(", "),
        minCommitsLastYear: String(scoringConfig.github.minCommitsLastYear),
        minCommitsLastMonth: String(scoringConfig.github.minCommitsLastMonth),
        minOwnershipPercent: String(scoringConfig.github.minOwnershipPercent),
        minProjectAgeDays: String(scoringConfig.github.minProjectAgeDays),
        minLeetcodeTotal: String(scoringConfig.coding.leetcode.minTotal),
        minLeetcodeEasy: String(scoringConfig.coding.leetcode.minEasy),
        minLeetcodeMedium: String(scoringConfig.coding.leetcode.minMedium),
        minLeetcodeHard: String(scoringConfig.coding.leetcode.minHard),
        minCodeforcesRating: String(scoringConfig.coding.codeforces.minRating),
        minCodeforcesContests: String(scoringConfig.coding.codeforces.minContests),
        minCodeforcesSolved: String(scoringConfig.coding.codeforces.minSolved),
        minLinkedProfiles: String(scoringConfig.coding.minLinkedProfiles),
    };
}

function Field({
    label,
    value,
    onChange,
    placeholder,
    type = "text",
    required = false,
    maxLength,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    type?: string;
    required?: boolean;
    maxLength?: number;
}) {
    return (
        <label className="block">
            <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{label}{required ? "*" : ""}</span>
            <input
                type={type}
                value={value}
                maxLength={maxLength}
                onChange={(event) => onChange(event.target.value)}
                placeholder={placeholder}
                className="mt-2 h-12 w-full rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-950 outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-input dark:text-white"
            />
        </label>
    );
}

function DurationField({
    label,
    value,
    onChange,
    required = false,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    required?: boolean;
}) {
    const parts = parseDurationParts(value);

    function updatePart(key: keyof DurationParts, nextValue: string, max: number) {
        const next = {
            ...parts,
            [key]: clampDurationPart(nextValue, max),
        };
        onChange(durationPartsToText(next));
    }

    return (
        <div>
            <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{label}{required ? "*" : ""}</span>
            <div className="mt-2 grid grid-cols-3 gap-2">
                {([
                    ["days", "Day", 365],
                    ["hours", "Hr", 23],
                    ["minutes", "Min", 59],
                ] as const).map(([key, suffix, max]) => (
                    <label key={key} className="relative block">
                        <input
                            type="number"
                            min={0}
                            max={max}
                            value={parts[key] || ""}
                            onChange={(event) => updatePart(key, event.target.value, max)}
                            placeholder="0"
                            className="h-12 w-full rounded-lg border border-slate-200 bg-white px-3 pr-10 text-sm font-bold text-slate-950 outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-input dark:text-white"
                        />
                        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-extrabold uppercase text-slate-400">{suffix}</span>
                    </label>
                ))}
            </div>
        </div>
    );
}

function SelectField({
    label,
    value,
    onChange,
    options,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    options: string[];
}) {
    return (
        <label className="block">
            <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{label}</span>
            <select
                value={value}
                onChange={(event) => onChange(event.target.value)}
                className="mt-2 h-12 w-full rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-950 outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-input dark:text-white"
            >
                {options.map((option) => (
                    <option key={option} value={option}>{option}</option>
                ))}
            </select>
        </label>
    );
}

function TextAreaField({
    label,
    value,
    onChange,
    placeholder,
    rows = 5,
    required = false,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    rows?: number;
    required?: boolean;
}) {
    return (
        <label className="block">
            <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{label}{required ? "*" : ""}</span>
            <textarea
                value={value}
                rows={rows}
                onChange={(event) => onChange(event.target.value)}
                placeholder={placeholder}
                className="mt-2 w-full resize-y rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-medium leading-6 text-slate-950 outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-input dark:text-white"
            />
        </label>
    );
}

function SectionTitle({ icon, title }: { icon: string; title: string }) {
    return (
        <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
                <span className="material-symbols-outlined text-[20px]">{icon}</span>
            </span>
            <h2 className="font-nunito text-xl font-extrabold text-slate-950 dark:text-white">{title}</h2>
        </div>
    );
}

function formatDate(value?: string | null) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function applicationScore(application: JobApplicationSummary) {
    return Number(application.recruiterReport?.overallScore ?? application.githubAnalysis?.score ?? 0) || 0;
}

function applicationStatusLabel(status: string) {
    return status.replace(/_/g, " ");
}

function nextRoundCtaLabel(type?: NextRoundPipeline | null) {
    switch (type) {
        case "ai_interview":
            return "Set up AI interview";
        case "mock_oa":
            return "Set up OA";
        case "technical_assignment":
            return "Set up technical assignment";
        case "final_interview":
            return "Set up final interview";
        default:
            return "Move next round";
    }
}

function currentRoundCtaLabel(opening: JobOpening) {
    if (opening.currentRoundType) return "Monitor current round";
    return nextRoundCtaLabel(opening.nextRoundType);
}

function currentRoundCtaIcon(opening: JobOpening) {
    if (opening.currentRoundType) return "monitoring";
    return opening.nextRoundType ? "construction" : "trending_flat";
}

function monitorCompanyRound(router: ReturnType<typeof useRouter>, type?: NextRoundPipeline | null) {
    const path = companyRoundMonitorPath(type);
    if (!path) return false;
    router.push(path);
    return true;
}

function DetailList({ title, items }: { title: string; items?: string[] }) {
    const clean = (items || []).filter(Boolean);
    if (!clean.length) return null;
    return (
        <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-lc-border dark:bg-lc-surface">
            <h3 className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">{title}</h3>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-600 dark:text-slate-300">
                {clean.map((item, index) => <li key={`${title}-${index}-${item}`}>{item}</li>)}
            </ul>
        </section>
    );
}

function DetailText({ title, text }: { title: string; text?: string | null }) {
    if (!text?.trim()) return null;
    return (
        <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-lc-border dark:bg-lc-surface">
            <h3 className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">{title}</h3>
            <p className="mt-3 whitespace-pre-line text-sm leading-6 text-slate-600 dark:text-slate-300">{text}</p>
        </section>
    );
}

function OpeningDetailModal({
    opening,
    onClose,
    onEdit,
}: {
    opening: JobOpening;
    onClose: () => void;
    onEdit: () => void;
}) {
    const closedByDeadline = isDeadlinePassed(opening.applicationDeadline) && opening.status === "open";
    return (
        <div className="fixed inset-0 z-[110] bg-slate-950/50 px-4 py-6 backdrop-blur-sm">
            <div className="mx-auto flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-[#FAFBFC] shadow-2xl dark:border-lc-border dark:bg-lc-bg">
                <div className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-5 dark:border-lc-border dark:bg-lc-surface">
                    <div className="min-w-0">
                        <p className={`text-xs font-bold uppercase tracking-[0.16em] ${closedByDeadline || opening.status === "closed" ? "text-slate-400" : "text-primary"}`}>
                            {closedByDeadline ? "Closed by deadline" : opening.status}
                        </p>
                        <h2 className="truncate font-nunito text-2xl font-extrabold text-slate-950 dark:text-white">{opening.title}</h2>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={onEdit}
                            className="grid size-10 place-items-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-primary dark:text-slate-300 dark:hover:bg-lc-hover"
                            aria-label="Edit opening"
                        >
                            <span className="material-symbols-outlined">edit</span>
                        </button>
                        <button
                            type="button"
                            onClick={onClose}
                            className="grid size-10 place-items-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-lc-hover"
                            aria-label="Close details"
                        >
                            <span className="material-symbols-outlined">close</span>
                        </button>
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto p-6">
                    <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-lc-border dark:bg-lc-surface">
                        <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
                            <div>
                                <h1 className="font-nunito text-3xl font-extrabold text-slate-950 dark:text-white">{opening.title}</h1>
                                <p className="mt-2 text-lg font-semibold text-slate-700 dark:text-slate-200">{opening.companyName}</p>
                                <p className="mt-3 text-sm font-medium text-slate-500 dark:text-slate-400">{[opening.workMode, opening.location].filter(Boolean).join(" | ")}</p>
                            </div>
                            {opening.companyLogoUrl && (
                                <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-lc-border dark:bg-lc-elevated">
                                    <img src={opening.companyLogoUrl} alt="" className="h-full w-full object-contain p-2" />
                                </div>
                            )}
                        </div>
                        <div className="mt-5 flex flex-wrap gap-2">
                            {[opening.employmentType, opening.experienceLevel, opening.roleType, opening.compensationType, opening.duration].filter(Boolean).map((item, index) => (
                                <span key={`${item}-${index}`} className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600 dark:bg-lc-hover dark:text-slate-300">{item}</span>
                            ))}
                        </div>
                    </section>

                    <div className="mt-5 grid gap-5">
                        <DetailText title="About the company" text={opening.companyOverview} />
                        <DetailText title="About the role" text={opening.aboutRole} />
                        <DetailList title="Responsibilities" items={opening.responsibilities} />
                        <DetailList title="Requirements" items={opening.requirements} />
                        <DetailList title="Benefits" items={opening.benefits} />
                        <DetailText title="Application note" text={opening.applicationNote} />
                    </div>

                    <section className="mt-5 rounded-lg border border-slate-200 bg-white p-5 dark:border-lc-border dark:bg-lc-surface">
                        <h3 className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">Additional information</h3>
                        <div className="mt-4 grid gap-3 text-sm font-medium text-slate-600 dark:text-slate-300 md:grid-cols-2">
                            {formatDate(opening.applicationDeadline) && <p>Deadline: {formatDate(opening.applicationDeadline)}</p>}
                            {opening.timeCommitment && <p>Time commitment: {opening.timeCommitment}</p>}
                            {opening.travel && <p>Travel: {opening.travel}</p>}
                            {opening.openings && <p>Open positions: {opening.openings}</p>}
                            {opening.compensation && <p>Compensation: {opening.compensation}</p>}
                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
}

function ScoreRing({ value, label }: { value: number; label: string }) {
    const pct = Math.max(0, Math.min(100, value || 0));
    return (
        <div className="grid place-items-center gap-2">
            <div
                className="grid size-28 place-items-center rounded-full"
                style={{ background: `conic-gradient(#4f7cff ${pct * 3.6}deg, rgba(148,163,184,.22) 0deg)` }}
            >
                <div className="grid size-20 place-items-center rounded-full bg-white font-nunito text-2xl font-extrabold text-slate-950 dark:bg-lc-surface dark:text-white">
                    {pct}
                </div>
            </div>
            <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">{label}</p>
        </div>
    );
}

function BarChart({ items }: { items?: Array<{ label: string; value: number; weight?: number; status?: string }> }) {
    const clean = items || [];
    return (
        <div className="grid gap-3">
            {clean.map((item) => {
                const value = Math.max(0, Math.min(100, Math.round(Number(item.value || 0))));
                return (
                <div key={item.label}>
                    <div className="mb-1 flex items-center justify-between gap-3 text-xs font-bold text-slate-500 dark:text-slate-400">
                        <span className="truncate">{item.label}</span>
                        <span>{value}/100{item.weight ? ` · ${item.weight}%` : item.status ? ` · ${item.status}` : ""}</span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-slate-200 dark:bg-lc-hover">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${value}%` }} />
                    </div>
                </div>
                );
            })}
        </div>
    );
}

function CriteriaTable({ rows }: { rows?: Array<{ label: string; score: number; weight: number; note: string }> }) {
    if (!rows?.length) return <p className="text-sm text-slate-500 dark:text-slate-400"></p>;
    return (
        <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-lc-border">
            {rows.map((row) => (
                <div key={row.label} className="grid gap-2 border-b border-slate-200 px-4 py-3 last:border-b-0 dark:border-lc-border md:grid-cols-[160px_1fr_90px] md:items-center">
                    <div className="font-bold text-slate-950 dark:text-white">{row.label}</div>
                    <div>
                        <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-lc-hover">
                            <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, row.score || 0))}%` }} />
                        </div>
                        <p className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">{row.note}</p>
                    </div>
                    <div className="text-sm font-extrabold text-slate-700 dark:text-slate-200">{row.score}/100</div>
                </div>
            ))}
        </div>
    );
}

function textFromUnknown(value: unknown) {
    if (value == null) return "";
    if (typeof value === "string") return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (typeof value === "object") {
        const record = value as Record<string, unknown>;
        const label = record.label || record.name || record.platform || record.title || record.domainOrResponsibility;
        const score = record.score ?? record.value ?? record.coverage;
        const reason = record.reason || record.evidence || record.note || record.summary;
        return [label, score != null ? `${score}/100` : "", reason].filter(Boolean).join(" - ");
    }
    return String(value).trim();
}

function toTextArray(value: unknown) {
    return Array.isArray(value) ? value.map(textFromUnknown).filter(Boolean).slice(0, 5) : [];
}

function toOptionalScore(value: unknown) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(0, Math.min(100, Math.round(numeric))) : undefined;
}

function escapeHtml(value: unknown) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function fileSafeName(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "candidate-report";
}

function listHtml(items?: unknown) {
    const values = toTextArray(items);
    if (!values.length) return `<p class="muted">No data returned.</p>`;
    return `<ul>${values.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function barHtml(label: string, value: unknown, subLabel = "") {
    const score = Math.max(0, Math.min(100, Number(value || 0)));
    return `
        <div class="bar-row">
            <div class="bar-meta"><span>${escapeHtml(label)}</span><strong>${Math.round(score)}/100${subLabel ? ` · ${escapeHtml(subLabel)}` : ""}</strong></div>
            <div class="bar-track"><div class="bar-fill" style="width:${score}%"></div></div>
        </div>
    `;
}

function buildReportPdfHtml(application: JobApplicationSummary) {
    const report = application.recruiterReport;
    const agents = report?.agentSummary || {};
    const candidateName = application.user.fullName || "Candidate";
    const profileUrl = application.user.username ? `/profile/${application.user.username}` : "Not available";
    const overall = report?.overallScore ?? 0;
    const github = report?.githubScore ?? application.githubAnalysis?.score ?? 0;
    const coding = report?.codingScore ?? application.codingAnalysis?.score ?? 0;
    const projectSlots = report?.projectSlots || [];
    const isolatedSlots = Array.isArray(agents.projectQuality?.slots) ? agents.projectQuality.slots : [];
    const overallBars = report?.charts?.overall || [
        { label: "GitHub", value: github, weight: report?.scoringConfig?.weights.github || 60 },
        { label: "Coding", value: coding, weight: report?.scoringConfig?.weights.coding || 40 },
    ];
    const projectCards = projectSlots.map((project, index) => {
        const isolatedSlot = isolatedSlots[index] || {};
        const bars = Array.isArray(isolatedSlot.qualityBars) ? isolatedSlot.qualityBars : [];
        return `
            <section class="card">
                <div class="row">
                    <div>
                        <p class="eyebrow">Project slot ${index + 1} · ${escapeHtml(isolatedSlot.status || project.status || "scored")}</p>
                        <h3>${escapeHtml(project.title)}</h3>
                    </div>
                    <span class="pill">${escapeHtml(isolatedSlot.score ?? project.score)}/100</span>
                </div>
                <p>${escapeHtml(isolatedSlot.slotVerdict || project.summary || "No project summary available.")}</p>
                ${bars.slice(0, 5).map((item: any) => barHtml(item.label, item.value)).join("")}
                <div class="two-col small">
                    <div><h4>Evidence</h4>${listHtml(isolatedSlot.evidence)}</div>
                    <div><h4>Watch</h4>${listHtml(isolatedSlot.risks)}</div>
                </div>
            </section>
        `;
    }).join("");

    return `
        <div class="pdf-report">
            <style>
                .pdf-report{width:900px;background:#f8fafc;color:#0f172a;font-family:Arial,Helvetica,sans-serif;padding:32px;line-height:1.45}
                .header{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;background:#fff;border:1px solid #dbe3ef;border-radius:18px;padding:28px;margin-bottom:20px}
                .eyebrow{margin:0 0 8px;color:#4f7cff;text-transform:uppercase;letter-spacing:3px;font-size:12px;font-weight:800}
                h1{font-size:34px;line-height:1.1;margin:0 0 10px} h2{font-size:22px;margin:0 0 14px} h3{font-size:18px;margin:0 0 8px} h4{font-size:13px;margin:0 0 8px;color:#334155}
                p{margin:0 0 12px;color:#334155;font-size:14px}.muted{color:#64748b}.grid{display:grid;gap:16px}.two-col{display:grid;grid-template-columns:1fr 1fr;gap:16px}.three-col{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
                .card{background:#fff;border:1px solid #dbe3ef;border-radius:16px;padding:20px;margin-bottom:16px;break-inside:avoid}
                .row{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}.pill{display:inline-flex;border-radius:999px;background:#eaf0ff;color:#3867ff;padding:7px 12px;font-size:13px;font-weight:800;white-space:nowrap}
                .score{width:128px;height:128px;border-radius:50%;display:grid;place-items:center;background:conic-gradient(#4f7cff calc(var(--score)*1%),#e2e8f0 0);font-size:32px;font-weight:900;color:#0f172a}
                .score span{display:grid;place-items:center;width:88px;height:88px;border-radius:50%;background:#fff}.bar-row{margin:12px 0}.bar-meta{display:flex;justify-content:space-between;gap:10px;font-size:12px;font-weight:800;color:#475569}.bar-track{height:9px;border-radius:999px;background:#e2e8f0;overflow:hidden;margin-top:6px}.bar-fill{height:100%;border-radius:999px;background:#4f7cff}
                ul{margin:0;padding-left:18px}li{margin:0 0 7px;color:#475569;font-size:13px}.small p,.small li{font-size:12px}.section-title{margin:24px 0 12px}
            </style>
            <div class="header">
                <div>
                    <p class="eyebrow">Candidate report</p>
                    <h1>${escapeHtml(candidateName)}</h1>
                    <p>${escapeHtml(application.user.email)}</p>
                    <p><strong>${escapeHtml(profileUrl)}</strong></p>
                </div>
                <div class="score" style="--score:${Math.max(0, Math.min(100, Number(overall || 0)))}"><span>${Math.round(Number(overall || 0))}</span></div>
            </div>
            <section class="card">
                <h2>Score split</h2>
                ${overallBars.map((item) => barHtml(item.label, item.value, item.weight ? `${item.weight}% weight` : "")).join("")}
                ${(report?.summary || []).slice(0, 3).map((item) => `<p><strong>${escapeHtml(item)}</strong></p>`).join("")}
            </section>
            <section class="card">
                <h2>Profile summary</h2>
                <p><strong>${escapeHtml(report?.profileSummary || "No recruiter profile summary available.")}</strong></p>
            </section>
            <h2 class="section-title">Agent findings</h2>
            <div class="two-col">
                <section class="card small"><h3>Candidate summary</h3><p>${escapeHtml(agents.profileSummary?.oneLineVerdict || "")}</p><h4>Strengths</h4>${listHtml(agents.profileSummary?.relevantStrengths || agents.profileSummary?.roleRelevantStrengths)}<h4>Gaps</h4>${listHtml(agents.profileSummary?.gapsForThisRole || agents.profileSummary?.profileGaps)}</section>
                <section class="card small"><h3>Final synthesis</h3><p>${escapeHtml(agents.finalSynthesis?.recommendation || report?.recommendation || "")}</p><h4>Hire reasons</h4>${listHtml(agents.finalSynthesis?.hireReasons || agents.finalSynthesis?.onePageSummary)}<h4>Watch</h4>${listHtml(agents.finalSynthesis?.rejectReasons || agents.finalSynthesis?.interviewFocus)}</section>
            </div>
            <h2 class="section-title">GitHub project slots</h2>
            <div class="grid">${projectCards || `<section class="card"><p>No project slots available.</p></section>`}</div>
            <h2 class="section-title">Coding scorecard</h2>
            <section class="card">
                ${(report?.charts?.coding || []).map((item) => barHtml(item.label, item.value)).join("") || `<p class="muted">No coding breakdown available.</p>`}
            </section>
            <section class="card small">
                <h2>Company criteria</h2>
                <p>GitHub/Coding weight: ${escapeHtml(report?.scoringConfig?.weights.github || 60)}% / ${escapeHtml(report?.scoringConfig?.weights.coding || 40)}%</p>
                <p>Required stack: ${escapeHtml((report?.scoringConfig?.github.requiredTechStack || []).join(", ") || "Falls back to job skills")}</p>
                <p>Project focus: ${escapeHtml((report?.scoringConfig?.github.focusAreas || []).join(", ") || "Falls back to role skills and responsibilities")}</p>
            </section>
        </div>
    `;
}

async function downloadCandidateReportPdf(application: JobApplicationSummary) {
    if (typeof window === "undefined") return;
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import("html2canvas"),
        import("jspdf"),
    ]);
    const wrapper = document.createElement("div");
    wrapper.style.position = "fixed";
    wrapper.style.left = "-10000px";
    wrapper.style.top = "0";
    wrapper.innerHTML = buildReportPdfHtml(application);
    document.body.appendChild(wrapper);

    try {
        const target = wrapper.firstElementChild as HTMLElement;
        const canvas = await html2canvas(target, {
            backgroundColor: "#f8fafc",
            scale: 2,
            useCORS: true,
        });
        const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        const imgWidth = pageWidth;
        const imgHeight = (canvas.height * imgWidth) / canvas.width;
        const image = canvas.toDataURL("image/png");
        let position = 0;
        pdf.addImage(image, "PNG", 0, position, imgWidth, imgHeight);
        let remaining = imgHeight - pageHeight;
        while (remaining > 0) {
            position -= pageHeight;
            pdf.addPage();
            pdf.addImage(image, "PNG", 0, position, imgWidth, imgHeight);
            remaining -= pageHeight;
        }
        pdf.save(`${fileSafeName(application.user.fullName || "candidate")}-report.pdf`);
    } finally {
        wrapper.remove();
    }
}

function AgentCard({
    title,
    score,
    summary,
    positives,
    gaps,
    chartItems,
}: {
    title: string;
    score?: number;
    summary?: string;
    positives?: unknown;
    gaps?: unknown;
    chartItems?: Array<{ label: string; value: number }>;
}) {
    const good = toTextArray(positives);
    const watch = toTextArray(gaps);
    return (
        <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-lc-border dark:bg-lc-surface">
            <div className="flex items-start justify-between gap-3">
                <h3 className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">{title}</h3>
                {typeof score === "number" && Number.isFinite(score) && <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-extrabold text-primary">{Math.round(score)}/100</span>}
            </div>
            {summary && <p className="mt-3 text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">{summary}</p>}
            {!!chartItems?.length && (
                <div className="mt-4 rounded-lg bg-slate-50 p-3 dark:bg-lc-hover">
                    <BarChart items={chartItems.slice(0, 5)} />
                </div>
            )}
            <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div>
                    <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-emerald-600 dark:text-emerald-300">Evidence</p>
                    <ul className="mt-2 space-y-2 text-sm text-slate-600 dark:text-slate-300">
                        {(good.length ? good : ["No positive evidence returned by this agent."]).map((item, index) => <li key={`evidence-${index}-${item}`}>{item}</li>)}
                    </ul>
                </div>
                <div>
                    <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-amber-600 dark:text-amber-300">Watch</p>
                    <ul className="mt-2 space-y-2 text-sm text-slate-600 dark:text-slate-300">
                        {(watch.length ? watch : ["No major gap returned by this agent."]).map((item, index) => <li key={`watch-${index}-${item}`}>{item}</li>)}
                    </ul>
                </div>
            </div>
        </section>
    );
}

function CandidateReportModal({
    application,
    onClose,
    onReevaluate,
    reevaluating,
}: {
    application: JobApplicationSummary;
    onClose: () => void;
    onReevaluate?: () => Promise<JobApplicationSummary | null>;
    reevaluating?: boolean;
}) {
    const report = application.recruiterReport;
    const [exportingPdf, setExportingPdf] = useState(false);
    const profileHref = application.user.username ? `/profile/${application.user.username}` : null;
    const candidateName = application.user.fullName || "Candidate";
    const overall = report?.overallScore ?? 0;
    const github = report?.githubScore ?? application.githubAnalysis?.score ?? 0;
    const coding = report?.codingScore ?? application.codingAnalysis?.score ?? 0;
    const slots = report?.projectSlots || [];
    const agents = report?.agentSummary || {};
    const isolatedProjectSlots = Array.isArray(agents.projectQuality?.slots) ? agents.projectQuality.slots : [];
    async function handleDownloadPdf() {
        if (exportingPdf) return;
        setExportingPdf(true);
        try {
            await downloadCandidateReportPdf(application);
        } finally {
            setExportingPdf(false);
        }
    }

    return (
        <div className="fixed inset-0 z-[150] bg-slate-950/60 px-4 py-6 backdrop-blur-sm">
            <div className="mx-auto flex max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-[#FAFBFC] shadow-2xl dark:border-lc-border dark:bg-lc-bg">
                <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-6 py-5 dark:border-lc-border dark:bg-lc-surface">
                    <div className="min-w-0">
                        <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Candidate report</p>
                        <h2 className="mt-1 truncate font-nunito text-2xl font-extrabold text-slate-950 dark:text-white">{candidateName}</h2>
                        <p className="mt-1 text-sm font-medium text-slate-500 dark:text-slate-400">{application.user.email}</p>
                        {profileHref && (
                            <a href={profileHref} target="_blank" rel="noreferrer" className="mt-1 inline-flex text-sm font-bold text-primary hover:underline">
                                {profileHref}
                            </a>
                        )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                        <button
                            type="button"
                            onClick={handleDownloadPdf}
                            disabled={exportingPdf}
                            className="inline-flex items-center gap-2 rounded-full border border-primary/30 px-4 py-2 text-xs font-extrabold text-primary transition hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {exportingPdf ? <span className="size-3 animate-spin rounded-full border-2 border-primary/30 border-t-primary" /> : <span className="material-symbols-outlined text-[16px]">download</span>}
                            Download PDF
                        </button>
                        {onReevaluate && (
                            <button
                                type="button"
                                onClick={onReevaluate}
                                disabled={reevaluating}
                                className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-xs font-extrabold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {reevaluating ? <span className="size-3 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : <span className="material-symbols-outlined text-[16px]">refresh</span>}
                                Re-evaluate
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={onClose}
                            className="grid size-10 place-items-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-lc-hover"
                            aria-label="Close candidate report"
                        >
                            <span className="material-symbols-outlined">close</span>
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-6">
                    <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
                        <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-lc-border dark:bg-lc-surface">
                            <ScoreRing value={overall} label="Overall fit" />
                            <p className="mt-4 text-center text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">{report?.recommendation || "Scorecard recommendation unavailable."}</p>
                        </section>
                        <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-lc-border dark:bg-lc-surface">
                            <h3 className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">Score split</h3>
                            <div className="mt-4">
                                <BarChart items={report?.charts?.overall || [
                                    { label: "GitHub", value: github, weight: report?.scoringConfig?.weights.github || 60 },
                                    { label: "Coding", value: coding, weight: report?.scoringConfig?.weights.coding || 40 },
                                ]} />
                            </div>
                            <div className="mt-5 grid gap-2 text-sm font-semibold text-slate-600 dark:text-slate-300">
                                {(report?.summary || []).slice(0, 3).map((item, index) => <p key={`summary-${index}-${item}`}>{item}</p>)}
                            </div>
                        </section>
                    </div>

                    <section className="mt-5 rounded-lg border border-slate-200 bg-white p-5 dark:border-lc-border dark:bg-lc-surface">
                        <h3 className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">Profile summary</h3>
                        <p className="mt-3 text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">{report?.profileSummary || "No recruiter profile summary available."}</p>
                    </section>

                    <div className="mt-5 grid gap-5 lg:grid-cols-2">
                        <AgentCard
                            title="Candidate summary agent"
                            score={toOptionalScore(agents.profileSummary?.profileScore)}
                            summary={agents.profileSummary?.oneLineVerdict || toTextArray(agents.profileSummary?.bioLines).join(" ")}
                            positives={agents.profileSummary?.relevantStrengths || agents.profileSummary?.roleRelevantStrengths}
                            gaps={agents.profileSummary?.gapsForThisRole || agents.profileSummary?.profileGaps}
                            chartItems={agents.profileSummary?.chartData}
                        />
                        <AgentCard
                            title="Project quality agent"
                            score={toOptionalScore(agents.projectQuality?.projectQualityScore)}
                            summary="Evaluates repo structure, README, commit discipline, ownership, tests, forks, and maintainability."
                            positives={agents.projectQuality?.slots?.flatMap?.((slot: any) => slot.evidence || [])}
                            gaps={agents.projectQuality?.slots?.flatMap?.((slot: any) => slot.risks || [])}
                            chartItems={agents.projectQuality?.graphData}
                        />
                        <AgentCard
                            title="Tech stack match agent"
                            score={toOptionalScore(agents.techStackMatch?.stackMatchScore)}
                            summary="Checks required stack coverage across the selected projects."
                            positives={agents.techStackMatch?.technologies?.filter?.((item: any) => item.matched).map?.((item: any) => `${item.name}: ${item.coverage}% coverage`)}
                            gaps={agents.techStackMatch?.missingCriticalStack}
                            chartItems={agents.techStackMatch?.graphData}
                        />
                        <AgentCard
                            title="Domain relevance agent"
                            score={toOptionalScore(agents.domainRelevance?.domainScore)}
                            summary="Checks whether projects match the product domain and role responsibilities."
                            positives={agents.domainRelevance?.domainCoverage?.map?.((item: any) => `${item.domainOrResponsibility}: ${item.coverage}%`)}
                            gaps={agents.domainRelevance?.genericProjectRisks}
                            chartItems={agents.domainRelevance?.graphData}
                        />
                        <AgentCard
                            title="Coding signal agent"
                            score={toOptionalScore(agents.codingProfile?.codingScore)}
                            summary="Coding profile is compared against the company's threshold for this opening."
                            positives={agents.codingProfile?.platformBreakdown?.map?.((item: any) => `${item.platform}: ${item.score}/100 - ${item.reason}`)}
                            gaps={agents.codingProfile?.thresholdGaps}
                            chartItems={agents.codingProfile?.graphData}
                        />
                        <AgentCard
                            title="Final synthesis agent"
                            score={toOptionalScore(agents.finalSynthesis?.overallScore)}
                            summary={agents.finalSynthesis?.recommendation}
                            positives={agents.finalSynthesis?.hireReasons || agents.finalSynthesis?.onePageSummary}
                            gaps={agents.finalSynthesis?.rejectReasons || agents.finalSynthesis?.interviewFocus}
                            chartItems={agents.finalSynthesis?.visualSummary}
                        />
                    </div>

                    <section className="mt-5 rounded-lg border border-slate-200 bg-white p-5 dark:border-lc-border dark:bg-lc-surface">
                        <h3 className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">3 equal GitHub project slots</h3>
                        <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">Each slot contributes one-third of the GitHub score. Missing projects score zero.</p>
                        <div className="mt-5 grid gap-4 lg:grid-cols-3">
                            {slots.map((project, index) => {
                                const isolatedSlot = isolatedProjectSlots[index];
                                const isolatedBars = Array.isArray(isolatedSlot?.qualityBars) ? isolatedSlot.qualityBars : [];
                                const isolatedEvidence = toTextArray(isolatedSlot?.evidence);
                                const isolatedRisks = toTextArray(isolatedSlot?.risks);

                                return (
                                    <div key={`${project.title}-${index}`} className="rounded-lg border border-slate-200 p-4 dark:border-lc-border">
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-slate-400">Slot {index + 1} - {isolatedSlot?.status || project.status}</p>
                                                <h4 className="mt-1 font-bold text-slate-950 dark:text-white">{project.title}</h4>
                                            </div>
                                            <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-extrabold text-primary">{isolatedSlot?.score ?? project.score}/100</span>
                                        </div>
                                        <p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-600 dark:text-slate-300">{isolatedSlot?.slotVerdict || project.summary}</p>
                                        {!!isolatedBars.length && (
                                            <div className="mt-4 rounded-lg bg-slate-50 p-3 dark:bg-lc-hover">
                                                <BarChart items={isolatedBars.slice(0, 5)} />
                                            </div>
                                        )}
                                        {!!(isolatedEvidence.length || isolatedRisks.length) && (
                                            <div className="mt-4 grid gap-3 text-xs font-semibold text-slate-500 dark:text-slate-400">
                                                {isolatedEvidence.length > 0 && <p>Evidence: {isolatedEvidence.join(" ")}</p>}
                                                {isolatedRisks.length > 0 && <p>Watch: {isolatedRisks.join(" ")}</p>}
                                            </div>
                                        )}
                                        <div className="mt-4">
                                            <CriteriaTable rows={project.breakdown?.slice(0, 6)} />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </section>

                    <div className="mt-5 grid gap-5 lg:grid-cols-2">
                        <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-lc-border dark:bg-lc-surface">
                            <h3 className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">Coding scorecard</h3>
                            <div className="mt-4">
                                <BarChart items={report?.charts?.coding || []} />
                            </div>
                            <div className="mt-5">
                                <CriteriaTable rows={report?.coding?.breakdown} />
                            </div>
                        </section>
                        <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-lc-border dark:bg-lc-surface">
                            <h3 className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">Company criteria</h3>
                            <div className="mt-4 grid gap-3 text-sm font-semibold text-slate-600 dark:text-slate-300">
                                <p>GitHub/Coding weight: {report?.scoringConfig?.weights.github || 60}% / {report?.scoringConfig?.weights.coding || 40}%</p>
                                <p>Required stack: {(report?.scoringConfig?.github.requiredTechStack || []).join(", ") || "Falls back to job skills"}</p>
                                <p>Project focus: {(report?.scoringConfig?.github.focusAreas || []).join(", ") || "Falls back to role skills and responsibilities"}</p>
                                <p>LeetCode target: {report?.scoringConfig?.coding.leetcode.minTotal || 100} total, {report?.scoringConfig?.coding.leetcode.minMedium || 40} medium, {report?.scoringConfig?.coding.leetcode.minHard || 5} hard</p>
                                <p>Codeforces target: {report?.scoringConfig?.coding.codeforces.minRating || 1200} rating, {report?.scoringConfig?.coding.codeforces.minContests || 5} contests</p>
                            </div>
                        </section>
                    </div>
                </div>
            </div>
        </div>
    );
}

function TechnicalAssignmentSetupModal({
    opening,
    initialConfig,
    onClose,
    onSave,
    saving,
}: {
    opening: JobOpening;
    initialConfig: TechnicalAssignmentFormState;
    onClose: () => void;
    onSave: (config: TechnicalAssignmentFormState) => void | Promise<void>;
    saving: boolean;
}) {
    const [form, setForm] = useState<TechnicalAssignmentFormState>(initialConfig);
    const rubricTotal = technicalAssignmentRubricTotal(form);
    const errors = useMemo(() => technicalAssignmentValidationErrors(form), [form]);
    const canSave = errors.length === 0;

    function update(key: keyof TechnicalAssignmentFormState, value: string) {
        setForm((current) => ({ ...current, [key]: value }));
    }

    async function save() {
        if (!canSave || saving) return;
        await onSave(form);
    }

    return (
        <div className="fixed inset-0 z-[150] bg-slate-950/60 px-4 py-6 backdrop-blur-sm">
            <div className="mx-auto flex max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-[#FAFBFC] shadow-2xl dark:border-lc-border dark:bg-lc-bg">
                <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-6 py-5 dark:border-lc-border dark:bg-lc-surface">
                    <div className="min-w-0">
                        <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Technical assignment setup</p>
                        <h2 className="font-nunito text-2xl font-extrabold text-slate-950 dark:text-white">{opening.title}</h2>
                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Create the assignment brief candidates will receive and the rubric used to evaluate their submitted project.</p>
                    </div>
                    <button type="button" onClick={onClose} className="grid size-10 place-items-center rounded-full text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-lc-hover" aria-label="Close technical assignment setup">
                        <span className="material-symbols-outlined">close</span>
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6">
                        <div className="space-y-5">
                            <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-lc-border dark:bg-lc-surface">
                                <SectionTitle icon="assignment" title="Assignment basics" />
                                <div className="mt-5 grid gap-4 md:grid-cols-3">
                                    <Field label="Assignment title" required value={form.title} onChange={(value) => update("title", value)} maxLength={160} />
                                    <DurationField label="Submission window" required value={form.timeLimit} onChange={(value) => update("timeLimit", value)} />
                                    <DurationField label="Expected effort" value={form.estimatedHours} onChange={(value) => update("estimatedHours", value)} />
                                </div>
                                <div className="mt-4">
                                    <TextAreaField label="Candidate message" value={form.candidateMessage} onChange={(value) => update("candidateMessage", value)} rows={3} placeholder="Short message shown when candidates receive the assignment." />
                                </div>
                            </section>

                            <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-lc-border dark:bg-lc-surface">
                                <SectionTitle icon="psychology" title="Problem brief" />
                                <div className="mt-5 grid gap-4">
                                    <TextAreaField label="What are you assessing?" required value={form.overview} onChange={(value) => update("overview", value)} rows={4} placeholder="Explain the engineering signals this assignment should reveal." />
                                    <TextAreaField label="Scenario" required value={form.scenario} onChange={(value) => update("scenario", value)} rows={5} placeholder="Describe the product situation, users, sample inputs, outputs, and business rules." />
                                    <TextAreaField label="Tasks" required value={form.tasks} onChange={(value) => update("tasks", value)} rows={6} placeholder="One task per line. Example: build webhook, normalize payload, persist event, create response." />
                                    <TextAreaField label="Starter context and mock data" value={form.starterContext} onChange={(value) => update("starterContext", value)} rows={5} placeholder="Payloads, mock records, API contracts, domain data, edge cases." />
                                </div>
                            </section>

                            <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-lc-border dark:bg-lc-surface">
                                <SectionTitle icon="rule" title="Constraints and submission" />
                                <div className="mt-5 grid gap-4 md:grid-cols-2">
                                    <TextAreaField label="Allowed stack" value={form.allowedStack} onChange={(value) => update("allowedStack", value)} rows={4} placeholder="Next.js, Node.js, Prisma, PostgreSQL, etc." />
                                    <TextAreaField label="Constraints" value={form.constraints} onChange={(value) => update("constraints", value)} rows={4} placeholder="Security, environment, test, repo, deadline, and anti-copying constraints." />
                                    <TextAreaField label="Required deliverables" required value={form.deliverables} onChange={(value) => update("deliverables", value)} rows={5} placeholder="GitHub repo, README, source code, tests, schema.sql, thinking.md." />
                                    <TextAreaField label="Submission instructions" value={form.submissionInstructions} onChange={(value) => update("submissionInstructions", value)} rows={5} placeholder="Tell candidates exactly how to submit and what access is required." />
                                </div>
                                <div className="mt-4">
                                    <TextAreaField label="Thinking questions" value={form.thinkingQuestions} onChange={(value) => update("thinkingQuestions", value)} rows={5} placeholder="Decision-making questions that reveal engineering judgment." />
                                </div>
                                <div className="mt-4">
                                    <TextAreaField label="Deadline and late policy" value={form.deadlinePolicy} onChange={(value) => update("deadlinePolicy", value)} rows={3} />
                                </div>
                            </section>

                            <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-lc-border dark:bg-lc-surface">
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                    <SectionTitle icon="analytics" title="Evaluation rubric" />
                                    <span className={`rounded-full px-3 py-1 text-xs font-extrabold ${rubricTotal === 100 ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300" : "bg-red-50 text-red-700 dark:bg-red-400/10 dark:text-red-300"}`}>
                                        Total {rubricTotal}/100
                                    </span>
                                </div>
                                <p className="mt-3 text-sm leading-6 text-slate-500 dark:text-slate-400">These weights will drive the later single-project assignment analysis. The candidate should not see raw scoring internals, only the assignment expectations.</p>
                                <div className="mt-5 grid gap-4 md:grid-cols-4">
                                    <Field label="Functionality %" type="number" value={form.functionalityWeight} onChange={(value) => update("functionalityWeight", value)} />
                                    <Field label="Architecture %" type="number" value={form.architectureWeight} onChange={(value) => update("architectureWeight", value)} />
                                    <Field label="Code quality %" type="number" value={form.codeQualityWeight} onChange={(value) => update("codeQualityWeight", value)} />
                                    <Field label="Documentation %" type="number" value={form.documentationWeight} onChange={(value) => update("documentationWeight", value)} />
                                    <Field label="Testing %" type="number" value={form.testingWeight} onChange={(value) => update("testingWeight", value)} />
                                    <Field label="Product thinking %" type="number" value={form.productThinkingWeight} onChange={(value) => update("productThinkingWeight", value)} />
                                    <Field label="Security %" type="number" value={form.securityWeight} onChange={(value) => update("securityWeight", value)} />
                                </div>
                                {errors.length > 0 && (
                                    <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300">
                                        {errors[0]}
                                    </div>
                                )}
                            </section>
                        </div>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-200 bg-white px-6 py-4 dark:border-lc-border dark:bg-lc-surface">
                    <button type="button" onClick={onClose} className="rounded-full px-5 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-lc-hover">
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={save}
                        disabled={!canSave || saving}
                        className="inline-flex h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-extrabold text-white shadow-lg shadow-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {saving ? <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : <span className="material-symbols-outlined text-[18px]">save</span>}
                        {saving ? "Saving..." : "Save assignment setup"}
                    </button>
                </div>
            </div>
        </div>
    );
}

function NextRoundModal({
    applications,
    initialPipelineType,
    error,
    onViewReport,
    onClose,
    onSubmit,
    saving,
}: {
    applications: JobApplicationSummary[];
    initialPipelineType?: NextRoundPipeline | null;
    error?: string | null;
    onViewReport?: (application: JobApplicationSummary) => void;
    onClose: () => void;
    onSubmit: (payload: { topCount: number; applicationIds: string[]; pipelineType: NextRoundPipeline }) => Promise<JobApplicationSummary[] | null>;
    saving: boolean;
}) {
    const isUpdate = Boolean(initialPipelineType);
    const defaultTopCount = isUpdate ? 0 : Math.min(3, applications.length);
    const [topCount, setTopCount] = useState(defaultTopCount);
    const [manualIds, setManualIds] = useState<string[]>(() =>
        isUpdate ? applications.filter((application) => application.status === "next_round").map((application) => application.id) : []
    );
    const [pipelineType, setPipelineType] = useState<NextRoundPipeline>(initialPipelineType || "ai_interview");
    const rankedApplications = useMemo(
        () => [...applications].sort((first, second) => applicationScore(second) - applicationScore(first)),
        [applications]
    );
    const topIds = useMemo(
        () => new Set(rankedApplications.slice(0, topCount).map((application) => application.id)),
        [rankedApplications, topCount]
    );
    const finalIds = useMemo(() => {
        const ids = new Set<string>(manualIds);
        topIds.forEach((id) => ids.add(id));
        return Array.from(ids);
    }, [manualIds, topIds]);

    function toggleManual(id: string) {
        if (isUpdate && applications.some((application) => application.id === id && application.status === "next_round")) {
            return;
        }
        setManualIds((current) =>
            current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
        );
    }

    async function submit() {
        const updated = await onSubmit({ topCount, applicationIds: manualIds, pipelineType });
        if (updated) onClose();
    }

    return (
        <div className="fixed inset-0 z-[150] bg-slate-950/60 px-4 py-6 backdrop-blur-sm">
            <div className="mx-auto flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-lc-border dark:bg-lc-surface">
                <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5 dark:border-lc-border">
                    <div>
                        <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Next round</p>
                        <h2 className="font-nunito text-2xl font-extrabold text-slate-950 dark:text-white">{isUpdate ? "Update round" : "Shortlist candidates"}</h2>
                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{isUpdate ? "Keep existing candidates selected, add more candidates, or switch the next hiring pipeline." : "Pick the highest scored candidates, add manual overrides, then choose the next hiring pipeline."}</p>
                    </div>
                    <button type="button" onClick={onClose} className="grid size-10 place-items-center rounded-full text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-lc-hover" aria-label="Close next round">
                        <span className="material-symbols-outlined">close</span>
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6">
                    {error && (
                        <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300">
                            {error}
                        </div>
                    )}
                    <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
                        <section className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-lc-border dark:bg-lc-elevated">
                            <label className="block">
                                <span className="text-sm font-extrabold text-slate-800 dark:text-white">Move top candidates</span>
                                <input
                                    type="number"
                                    min={0}
                                    max={applications.length}
                                    value={topCount}
                                    onChange={(event) => setTopCount(Math.max(0, Math.min(applications.length, Number.parseInt(event.target.value, 10) || 0)))}
                                    className="mt-2 h-12 w-full rounded-lg border border-slate-200 bg-white px-4 text-sm font-bold text-slate-950 outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-input dark:text-white"
                                />
                            </label>
                            <p className="mt-2 text-xs font-semibold leading-5 text-slate-500 dark:text-slate-400">
                                {isUpdate ? "Existing next-round candidates are selected below. Increase this only if you also want to auto-add top ranked candidates." : `The top ${topCount} candidate(s) by overall score are included automatically. Use manual selection for exceptions.`}
                            </p>
                            <div className="mt-5 space-y-3">
                                <p className="text-sm font-extrabold text-slate-800 dark:text-white">Pipeline</p>
                                {nextRoundPipelineOptions.map((option) => (
                                    <button
                                        key={option.value}
                                        type="button"
                                        onClick={() => setPipelineType(option.value)}
                                        className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition ${pipelineType === option.value ? "border-primary bg-primary/10" : "border-slate-200 bg-white hover:border-primary/30 dark:border-lc-border dark:bg-lc-surface"}`}
                                    >
                                        <span className="material-symbols-outlined text-[22px] text-primary">{option.icon}</span>
                                        <span>
                                            <span className="block text-sm font-extrabold text-slate-950 dark:text-white">{option.title}</span>
                                            <span className="mt-1 block text-xs leading-5 text-slate-500 dark:text-slate-400">{option.description}</span>
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </section>

                        <section className="rounded-lg border border-slate-200 bg-white p-4 dark:border-lc-border dark:bg-lc-surface">
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <h3 className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">Candidate selection</h3>
                                    <p className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">{finalIds.length} candidate(s) will be moved.</p>
                                </div>
                            </div>
                            <div className="mt-4 grid gap-2">
                                {rankedApplications.map((application, index) => {
                                    const candidateName = application.user.fullName || "Candidate";
                                    const isTop = topIds.has(application.id);
                                    const isManual = manualIds.includes(application.id);
                                    const isSelected = isTop || isManual;
                                    const isLocked = isUpdate && application.status === "next_round";
                                    return (
                                        <div
                                            key={application.id}
                                            className={`flex items-center gap-3 rounded-lg border px-3 py-2 transition ${isSelected ? "border-primary/50 bg-primary/5" : "border-slate-200 hover:border-primary/30 dark:border-lc-border"}`}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={isSelected}
                                                disabled={isTop || isLocked}
                                                onChange={() => toggleManual(application.id)}
                                                className="size-4 accent-primary disabled:opacity-60"
                                            />
                                            <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-full bg-primary/10 text-xs font-extrabold text-primary">
                                                {application.user.avatarUrl ? <img src={application.user.avatarUrl} alt="" className="h-full w-full object-cover" /> : candidateName.slice(0, 2).toUpperCase()}
                                            </span>
                                            <span className="min-w-0 flex-1">
                                                <span className="block truncate text-sm font-extrabold text-slate-950 dark:text-white">{candidateName}</span>
                                                <span className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Rank #{index + 1} · Overall {applicationScore(application)}/100</span>
                                            </span>
                                            {isTop && <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-extrabold text-primary">Top pick</span>}
                                            {isLocked && <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-extrabold text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300">Already Moved</span>}
                                            {!isLocked && application.status === "next_round" && <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-extrabold text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300">Already moved</span>}
                                            {onViewReport && (
                                                <button
                                                    type="button"
                                                    onClick={() => onViewReport(application)}
                                                    className="ml-auto inline-flex h-8 items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-3 text-[11px] font-extrabold text-primary transition hover:bg-primary hover:text-white"
                                                >
                                                    <span className="material-symbols-outlined text-[15px]">account_circle</span>
                                                    View profile
                                                </button>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </section>
                    </div>
                </div>

                <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-6 py-4 dark:border-lc-border">
                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Selected candidates receive a notification for this job.</p>
                    <button
                        type="button"
                        onClick={submit}
                        disabled={saving || finalIds.length === 0}
                        className="inline-flex h-12 min-w-[220px] items-center justify-center gap-2 rounded-full bg-emerald-500 px-5 text-sm font-extrabold text-white shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {saving ? <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : <span className="material-symbols-outlined text-[20px]">trending_flat</span>}
                        {isUpdate ? "Update round" : "Move to next round"}
                    </button>
                </div>
            </div>
        </div>
    );
}

function ApplicationsModal({
    opening,
    applications,
    loading,
    error,
    startNextRound,
    onClose,
    onReevaluate,
    onMoveToNextRound,
    reevaluatingApplicationId,
    movingToNextRound,
}: {
    opening: JobOpening;
    applications: JobApplicationSummary[];
    loading: boolean;
    error: string | null;
    startNextRound: boolean;
    onClose: () => void;
    onReevaluate: (applicationId: string) => Promise<JobApplicationSummary | null>;
    onMoveToNextRound: (payload: { topCount: number; applicationIds: string[]; pipelineType: NextRoundPipeline }) => Promise<JobApplicationSummary[] | null>;
    reevaluatingApplicationId: string | null;
    movingToNextRound: boolean;
}) {
    const [selectedApplication, setSelectedApplication] = useState<JobApplicationSummary | null>(null);
    const [highScoreFirst, setHighScoreFirst] = useState(false);
    const [nextRoundOpen, setNextRoundOpen] = useState(false);
    const [autoOpenedNextRound, setAutoOpenedNextRound] = useState(false);
    const sortedApplications = useMemo(() => {
        const list = [...applications];
        if (highScoreFirst) {
            list.sort((first, second) => applicationScore(second) - applicationScore(first));
        }
        return list;
    }, [applications, highScoreFirst]);

    useEffect(() => {
        if (startNextRound && !autoOpenedNextRound && !loading && applications.length > 0) {
            setNextRoundOpen(true);
            setAutoOpenedNextRound(true);
        }
    }, [applications.length, autoOpenedNextRound, loading, startNextRound]);

    async function handleReevaluate(applicationId: string) {
        const updated = await onReevaluate(applicationId);
        if (updated && selectedApplication?.id === updated.id) {
            setSelectedApplication(updated);
        }
        return updated;
    }

    return (
        <div className="fixed inset-0 z-[130] bg-slate-950/55 px-4 py-6 backdrop-blur-sm">
            <div className="mx-auto flex max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-[#FAFBFC] shadow-2xl dark:border-lc-border dark:bg-lc-bg">
                <div className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-5 dark:border-lc-border dark:bg-lc-surface">
                    <div className="min-w-0">
                        <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Applications</p>
                        <h2 className="truncate font-nunito text-2xl font-extrabold text-slate-950 dark:text-white">{opening.title}</h2>
                        <p className="mt-1 text-sm font-medium text-slate-500 dark:text-slate-400">{applications.length || opening.applicationCount || 0} candidate(s) applied</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                        <button
                            type="button"
                            onClick={() => setHighScoreFirst((current) => !current)}
                            className={`inline-flex h-10 items-center gap-2 rounded-full border px-4 text-xs font-extrabold transition ${highScoreFirst ? "border-primary bg-primary text-white shadow-lg shadow-primary/20" : "border-slate-200 bg-white text-slate-600 hover:border-primary/30 hover:text-primary dark:border-lc-border dark:bg-lc-elevated dark:text-slate-300"}`}
                        >
                            <span className="material-symbols-outlined text-[18px]">leaderboard</span>
                            High score first
                        </button>

                        <button
                            type="button"
                            onClick={onClose}
                            className="grid size-10 place-items-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-lc-hover"
                            aria-label="Close applications"
                        >
                            <span className="material-symbols-outlined">close</span>
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-6">
                    {loading ? (
                        <div className="flex min-h-[420px] items-center justify-center">
                            <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
                        </div>
                    ) : error ? (
                        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300">
                            {error}
                        </div>
                    ) : applications.length === 0 ? (
                        <div className="flex min-h-[360px] flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 bg-white text-center dark:border-lc-border dark:bg-lc-surface">
                            <span className="material-symbols-outlined text-5xl text-slate-300">person_search</span>
                            <h3 className="mt-4 font-nunito text-2xl font-extrabold text-slate-950 dark:text-white">No applications yet</h3>
                            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Candidates will appear here with their structured project and coding report.</p>
                        </div>
                    ) : (
                        <div className="grid gap-3">
                            {sortedApplications.map((application) => {
                                const report = application.recruiterReport;
                                const profileHref = application.user.username ? `/profile/${application.user.username}` : null;
                                const candidateName = application.user.fullName || "Candidate";
                                const movedToNextRound = application.status === "next_round";

                                return (
                                    <article
                                        key={application.id}
                                        onClick={() => setSelectedApplication(application)}
                                        className="cursor-pointer rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm transition hover:border-primary/40 hover:shadow-md dark:border-lc-border dark:bg-lc-surface"
                                    >
                                        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                            <div className="flex min-w-0 gap-3">
                                                <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-full bg-primary/10 font-nunito text-base font-extrabold text-primary">
                                                    {application.user.avatarUrl ? (
                                                        <img src={application.user.avatarUrl} alt="" className="h-full w-full object-cover" />
                                                    ) : (
                                                        candidateName.slice(0, 2).toUpperCase()
                                                    )}
                                                </div>
                                                <div className="min-w-0">
                                                    <h3 className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">{candidateName}</h3>
                                                    <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{application.user.email}</p>
                                                    {profileHref && <p className="mt-1 text-sm font-bold text-primary">{profileHref}</p>}
                                                    <p className="mt-1 text-xs font-semibold text-slate-400">Applied {formatDate(application.submittedAt) || "recently"}</p>
                                                </div>
                                            </div>
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-extrabold text-slate-700 dark:bg-lc-hover dark:text-slate-200">Overall {report?.overallScore ?? 0}/100</span>
                                                <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-extrabold text-primary">GitHub {report?.githubScore ?? application.githubAnalysis?.score ?? 0}/100</span>
                                                <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-extrabold text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300">Coding {report?.codingScore ?? application.codingAnalysis?.score ?? 0}/100</span>
                                                <span className={`rounded-full px-3 py-1 text-xs font-extrabold ${movedToNextRound ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300" : "bg-slate-100 text-slate-600 dark:bg-lc-hover dark:text-slate-300"}`}>{applicationStatusLabel(application.status)}</span>
                                            </div>
                                        </div>

                                        <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-200 pt-3 dark:border-lc-border">
                                            <p className="line-clamp-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                                                {report?.recommendation || "Open the full report to review project quality, coding score, and role fit."}
                                            </p>
                                            <div className="flex shrink-0 flex-wrap items-center gap-2">
                                                <button
                                                    type="button"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        handleReevaluate(application.id);
                                                    }}
                                                    disabled={reevaluatingApplicationId === application.id}
                                                    className="inline-flex items-center gap-1 rounded-full border border-primary/30 px-3 py-1.5 text-xs font-extrabold text-primary transition hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-60"
                                                >
                                                    {reevaluatingApplicationId === application.id ? <span className="size-3 animate-spin rounded-full border-2 border-primary/30 border-t-primary" /> : <span className="material-symbols-outlined text-[16px]">refresh</span>}
                                                    Re-evaluate
                                                </button>
                                                <span className="inline-flex h-10 items-center gap-1 rounded-full bg-primary px-4 text-xs font-extrabold text-white">
                                                    Open report
                                                </span>
                                            </div>
                                        </div>
                                    </article>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
            {selectedApplication && (
                <CandidateReportModal
                    application={selectedApplication}
                    onReevaluate={() => handleReevaluate(selectedApplication.id)}
                    reevaluating={reevaluatingApplicationId === selectedApplication.id}
                    onClose={() => setSelectedApplication(null)}
                />
            )}
            {nextRoundOpen && (
                <NextRoundModal
                    applications={applications}
                    initialPipelineType={opening.nextRoundType}
                    error={error}
                    onViewReport={setSelectedApplication}
                    saving={movingToNextRound}
                    onClose={() => setNextRoundOpen(false)}
                    onSubmit={async (payload) => {
                        const updated = await onMoveToNextRound(payload);
                        if (updated && selectedApplication) {
                            const matched = updated.find((application) => application.id === selectedApplication.id);
                            if (matched) setSelectedApplication(matched);
                        }
                        return updated;
                    }}
                />
            )}
        </div>
    );
}

function JobFormModal({
    form,
    setForm,
    onClose,
    onSave,
    onLogoChange,
    canSave,
    validationErrors,
    error,
    saving,
    uploadingLogo,
    mode,
}: {
    form: JobFormState;
    setForm: (next: JobFormState) => void;
    onClose: () => void;
    onSave: () => void;
    onLogoChange: (file: File | null) => void;
    canSave: boolean;
    validationErrors: string[];
    error?: string | null;
    saving: boolean;
    uploadingLogo: boolean;
    mode: "create" | "edit";
}) {
    const update = <Key extends keyof JobFormState>(key: Key, value: JobFormState[Key]) => {
        setForm({ ...form, [key]: value });
    };

    return (
        <div className="fixed inset-0 z-[120] bg-slate-950/50 px-4 py-6 backdrop-blur-sm">
            <div className="mx-auto flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-lc-border dark:bg-lc-surface">
                <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5 dark:border-lc-border">
                    <div>
                        <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Job opening</p>
                        <h1 className="font-nunito text-2xl font-extrabold text-slate-950 dark:text-white">{mode === "edit" ? "Edit opening" : "Create opening"}</h1>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="grid size-10 place-items-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-lc-hover dark:hover:text-white"
                        aria-label="Close"
                    >
                        <span className="material-symbols-outlined">close</span>
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto px-6 py-6">
                    <div className="space-y-8">
                        {error && (
                            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300">
                                {error}
                            </div>
                        )}
                        <section className="space-y-4">
                            <SectionTitle icon="domain" title="Company and role" />
                            <div className="grid gap-4 md:grid-cols-2">
                                <Field label="Company name" required value={form.companyName} onChange={(value) => update("companyName", value)} placeholder="Flexzistay" maxLength={120} />
                                <label className="block">
                                    <span className="text-sm font-bold text-slate-700 dark:text-slate-200">Company logo</span>
                                    <div className="mt-2 flex min-h-12 items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-lc-border dark:bg-lc-input">
                                        {form.companyLogoUrl && (
                                            <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-lc-border">
                                                <img src={form.companyLogoUrl} alt="" className="h-full w-full object-contain p-1" />
                                            </span>
                                        )}
                                        <label className="cursor-pointer rounded-full bg-primary px-4 py-2 text-xs font-bold text-white">
                                            {uploadingLogo ? "Uploading..." : "Choose File"}
                                            <input
                                                type="file"
                                                accept="image/png,image/jpeg,image/webp"
                                                className="hidden"
                                                disabled={uploadingLogo}
                                                onChange={(event) => onLogoChange(event.target.files?.[0] || null)}
                                            />
                                        </label>
                                        <span className="truncate text-sm font-medium text-slate-600 dark:text-slate-300">
                                            {form.companyLogoName || (form.companyLogoUrl ? "Logo uploaded" : "No file chosen")}
                                        </span>
                                    </div>
                                </label>
                                <Field label="Job title" required value={form.title} onChange={(value) => update("title", value)} placeholder="Full Stack Engineer Intern" maxLength={140} />
                                <Field label="Location" required value={form.location} onChange={(value) => update("location", value)} placeholder="Remote, Jaipur, Bengaluru" maxLength={140} />
                                <SelectField label="Work site" value={form.workMode} onChange={(value) => update("workMode", value)} options={["Remote", "Hybrid", "On-site", "Fully on-site"]} />
                                <SelectField label="Employment type" value={form.employmentType} onChange={(value) => update("employmentType", value)} options={["Internship", "Full-time", "Part-time", "Contract", "Temporary", "Freelance"]} />
                                <SelectField label="Role type" value={form.roleType} onChange={(value) => update("roleType", value)} options={["Individual Contributor", "People Manager", "Founder Office", "Consultant"]} />
                                <Field label="Open positions" type="number" value={form.openings} onChange={(value) => update("openings", value)} placeholder="1" />
                            </div>
                        </section>

                        <section className="space-y-4">
                            <SectionTitle icon="tune" title="Role details" />
                            <div className="grid gap-4 md:grid-cols-2">
                                <SelectField label="Experience level" value={form.experienceLevel} onChange={(value) => update("experienceLevel", value)} options={["Intern", "Entry level", "Associate", "Mid level", "Senior", "Lead"]} />
                                <SelectField label="Travel" value={form.travel} onChange={(value) => update("travel", value)} options={["No travel", "Less than 25%", "25% to 50%", "More than 50%"]} />
                                <Field label="Application deadline" type="date" value={form.applicationDeadline} onChange={(value) => update("applicationDeadline", value)} />
                                <Field label="Skills" value={form.skillsText} onChange={(value) => update("skillsText", value)} placeholder="Next.js, Node.js, PostgreSQL, Redis" />
                            </div>
                        </section>

                        <section className="space-y-4">
                            <SectionTitle icon="payments" title="Internship or compensation" />
                            <div className="grid gap-4 md:grid-cols-2">
                                <SelectField label="Compensation type" value={form.compensationType} onChange={(value) => update("compensationType", value)} options={["Paid", "Unpaid", "Stipend", "Market rate", "Not disclosed"]} />
                                <Field label="Compensation detail" value={form.compensation} onChange={(value) => update("compensation", value)} placeholder="Rs 15,000/month, unpaid, or not disclosed" maxLength={120} />
                                <Field label="Duration" value={form.duration} onChange={(value) => update("duration", value)} placeholder="Minimum 3 months" maxLength={120} />
                                <Field label="Time commitment" value={form.timeCommitment} onChange={(value) => update("timeCommitment", value)} placeholder="Around 4 hours per day" maxLength={120} />
                            </div>
                        </section>

                        <section className="space-y-4">
                            <SectionTitle icon="description" title="Job description" />
                            <TextAreaField label="About the company" value={form.companyOverview} onChange={(value) => update("companyOverview", value)} placeholder="What the company does, where it operates, and what problem it solves." />
                            <TextAreaField label="About the role" required value={form.aboutRole} onChange={(value) => update("aboutRole", value)} placeholder="What the person will build, own, or learn." />
                            <TextAreaField label="Responsibilities" value={form.responsibilities} onChange={(value) => update("responsibilities", value)} placeholder="Add one responsibility per line." />
                            <TextAreaField label="Requirements" required value={form.requirements} onChange={(value) => update("requirements", value)} placeholder="Add must-have skills, project expectations, degree requirements, and availability." />
                            <TextAreaField label="Benefits" value={form.benefits} onChange={(value) => update("benefits", value)} placeholder="Certificate, LOR, mentorship, startup exposure, PPO path, etc." />
                            <TextAreaField label="Application note" value={form.applicationNote} onChange={(value) => update("applicationNote", value)} placeholder="Any honesty note, portfolio ask, or special application instruction." rows={4} />
                        </section>

                        <section className="space-y-4">
                            <SectionTitle icon="analytics" title="Candidate scorecard" />
                            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-lc-border dark:bg-lc-elevated">
                                <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
                                    These criteria decide how Quick Apply scores candidates. GitHub is split into 3 equal project slots; any missing selected project scores 0 for its slot.
                                </p>
                            </div>
                            <div className="grid gap-4 md:grid-cols-2">
                                <Field label="GitHub weight %" type="number" value={form.githubWeight} onChange={(value) => update("githubWeight", value)} />
                                <Field label="Coding profile weight %" type="number" value={form.codingWeight} onChange={(value) => update("codingWeight", value)} />
                                {validationErrors.length > 0 && (
                                    <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200 md:col-span-2">
                                        {validationErrors.map((message, index) => (
                                            <p key={`scorecard-error-${index}`}>{message}</p>
                                        ))}
                                    </div>
                                )}
                                <Field label="Required project tech stack" value={form.requiredTechStackText} onChange={(value) => update("requiredTechStackText", value)} placeholder="Next.js, Node.js, PostgreSQL" />
                                <Field label="Project focus areas" value={form.projectFocusText} onChange={(value) => update("projectFocusText", value)} placeholder="booking flow, backend APIs, auth, payments" />
                                <Field label="Minimum yearly commits per project" type="number" value={form.minCommitsLastYear} onChange={(value) => update("minCommitsLastYear", value)} />
                                <Field label="Minimum monthly commits per project" type="number" value={form.minCommitsLastMonth} onChange={(value) => update("minCommitsLastMonth", value)} />
                                <Field label="Minimum ownership %" type="number" value={form.minOwnershipPercent} onChange={(value) => update("minOwnershipPercent", value)} />
                                <Field label="Minimum project age days" type="number" value={form.minProjectAgeDays} onChange={(value) => update("minProjectAgeDays", value)} />
                            </div>
                            <div className="grid gap-4 md:grid-cols-4">
                                <Field label="LeetCode total" type="number" value={form.minLeetcodeTotal} onChange={(value) => update("minLeetcodeTotal", value)} />
                                <Field label="LeetCode easy" type="number" value={form.minLeetcodeEasy} onChange={(value) => update("minLeetcodeEasy", value)} />
                                <Field label="LeetCode medium" type="number" value={form.minLeetcodeMedium} onChange={(value) => update("minLeetcodeMedium", value)} />
                                <Field label="LeetCode hard" type="number" value={form.minLeetcodeHard} onChange={(value) => update("minLeetcodeHard", value)} />
                                <Field label="Codeforces rating" type="number" value={form.minCodeforcesRating} onChange={(value) => update("minCodeforcesRating", value)} />
                                <Field label="Codeforces contests" type="number" value={form.minCodeforcesContests} onChange={(value) => update("minCodeforcesContests", value)} />
                                <Field label="Codeforces solved" type="number" value={form.minCodeforcesSolved} onChange={(value) => update("minCodeforcesSolved", value)} />
                                <Field label="Min linked profiles" type="number" value={form.minLinkedProfiles} onChange={(value) => update("minLinkedProfiles", value)} />
                            </div>
                        </section>
                    </div>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-200 px-6 py-4 dark:border-lc-border">
                    <button type="button" onClick={onClose} className="rounded-full px-5 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-lc-hover">
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={onSave}
                        disabled={!canSave}
                        className="rounded-full bg-primary px-6 py-2.5 text-sm font-bold text-white shadow-lg shadow-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {saving ? "Saving..." : mode === "edit" ? "Save changes" : "Save opening"}
                    </button>
                </div>
            </div>
        </div>
    );
}

export function JobOpeningBuilder() {
    const router = useRouter();
    const { company, session } = useCompanyAuth();
    const canManageHiring = company?.role === "owner" || company?.role === "admin";
    const [openings, setOpenings] = useState<JobOpening[]>([]);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [loadingJobs, setLoadingJobs] = useState(true);
    const [saving, setSaving] = useState(false);
    const [uploadingLogo, setUploadingLogo] = useState(false);
    const [editingJobId, setEditingJobId] = useState<string | null>(null);
    const [selectedOpening, setSelectedOpening] = useState<JobOpening | null>(null);
    const [applicationsOpening, setApplicationsOpening] = useState<JobOpening | null>(null);
    const [selectedApplications, setSelectedApplications] = useState<JobApplicationSummary[]>([]);
    const [openNextRoundOnLoad, setOpenNextRoundOnLoad] = useState(false);
    const [nextRoundOpening, setNextRoundOpening] = useState<JobOpening | null>(null);
    const [nextRoundApplications, setNextRoundApplications] = useState<JobApplicationSummary[]>([]);
    const [nextRoundLoading, setNextRoundLoading] = useState(false);
    const [nextRoundError, setNextRoundError] = useState<string | null>(null);
    const [nextRoundReportApplication, setNextRoundReportApplication] = useState<JobApplicationSummary | null>(null);
    const [technicalAssignmentOpening, setTechnicalAssignmentOpening] = useState<JobOpening | null>(null);
    const [technicalAssignmentSourceId, setTechnicalAssignmentSourceId] = useState<string | null>(null);
    const [technicalAssignmentConfigs, setTechnicalAssignmentConfigs] = useState<Record<string, TechnicalAssignmentFormState>>({});
    const [savingTechnicalAssignment, setSavingTechnicalAssignment] = useState(false);
    const [applicationsLoading, setApplicationsLoading] = useState(false);
    const [applicationsError, setApplicationsError] = useState<string | null>(null);
    const [reevaluatingApplicationId, setReevaluatingApplicationId] = useState<string | null>(null);
    const [movingToNextRound, setMovingToNextRound] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [form, setForm] = useState<JobFormState>(() => defaultFormForCompany(company));

    useEffect(() => {
        if (editingJobId) return;
        setForm((current) => ({
            ...current,
            companyName: current.companyName || company?.name || "",
            companyLogoUrl: current.companyLogoUrl || company?.logoUrl || null,
            companyLogoName: current.companyLogoName || (company?.logoUrl ? "Workspace logo" : ""),
        }));
    }, [company?.logoUrl, company?.name, editingJobId]);

    useEffect(() => {
        if (!session?.access_token) {
            setLoadingJobs(false);
            return;
        }

        let mounted = true;
        setLoadingJobs(true);
        setError(null);

        api.get<{ jobs: JobOpening[] }>("/companies/jobs", session.access_token)
            .then((data) => {
                if (mounted) setOpenings(data.jobs);
            })
            .catch((err) => {
                if (mounted) {
                    setError(err instanceof ApiError ? err.message : "Failed to load job openings.");
                }
            })
            .finally(() => {
                if (mounted) setLoadingJobs(false);
            });

        return () => {
            mounted = false;
        };
    }, [session?.access_token]);

    useEffect(() => {
        if (loadingJobs || technicalAssignmentOpening || openings.length === 0) return;
        const params = new URLSearchParams(window.location.search);
        const setupTechnicalJob = params.get("setupTechnicalJob");
        if (!setupTechnicalJob) return;

        const opening = openings.find((item) => item.id === setupTechnicalJob);
        if (!opening) return;

        openTechnicalAssignmentSetup(opening, params.get("sourceAssignmentId"));
        window.history.replaceState(null, "", window.location.pathname);
    }, [loadingJobs, openings, technicalAssignmentOpening]);

    const readiness = useMemo<Array<[string, boolean]>>(
        () => [
            ["Company", Boolean(form.companyName.trim())],
            ["Title", Boolean(form.title.trim())],
            ["Location", Boolean(form.location.trim())],
            ["Role", Boolean(form.aboutRole.trim())],
            ["Requirements", Boolean(form.requirements.trim())],
            ["Skills", splitSkills(form.skillsText).length > 0],
        ],
        [form]
    );
    const validationErrors = useMemo(() => scorecardValidationErrors(form), [form]);
    const canSave = readiness.every(([, complete]) => complete) && validationErrors.length === 0;

    function hiringAccessMessage(action: string) {
        return `You don't have access to ${action}. Ask a company owner or admin to do this.`;
    }

    function requireHiringAccess(action: string) {
        if (canManageHiring) return true;
        setError(hiringAccessMessage(action));
        window.scrollTo({ top: 0, behavior: "smooth" });
        return false;
    }

    function openForm() {
        if (!requireHiringAccess("create or edit job openings")) return;
        setError(null);
        setEditingJobId(null);
        setForm(defaultFormForCompany(company));
        setIsFormOpen(true);
    }

    function openEditForm(opening: JobOpening) {
        if (!requireHiringAccess("edit job openings")) {
            setSelectedOpening(null);
            return;
        }
        setError(null);
        setEditingJobId(opening.id);
        setForm(formFromOpening(opening));
        setSelectedOpening(null);
        setApplicationsOpening(null);
        setIsFormOpen(true);
    }

    function openOpeningDetails(opening: JobOpening) {
        setSelectedOpening(opening);
    }

    function openApplications(opening: JobOpening, startNextRound = false) {
        setApplicationsOpening(opening);
        setSelectedApplications([]);
        setApplicationsError(null);
        setOpenNextRoundOnLoad(startNextRound);
        if (!session?.access_token) return;

        setApplicationsLoading(true);
        api.get<{ applications: JobApplicationSummary[] }>(`/companies/jobs/${opening.id}/applications`, session.access_token)
            .then((payload) => {
                const applications = payload.applications || [];
                setSelectedApplications(applications);
                setOpenings((current) =>
                    current.map((item) =>
                        item.id === opening.id ? { ...item, applicationCount: applications.length } : item
                    )
                );
            })
            .catch((err) => {
                setSelectedApplications([]);
                setApplicationsError(err instanceof ApiError ? err.message : "Failed to load applications.");
            })
            .finally(() => setApplicationsLoading(false));
    }

    function openNextRoundOnly(opening: JobOpening) {
        if (!requireHiringAccess("move candidates to the next round")) return;
        setNextRoundOpening(opening);
        setNextRoundApplications([]);
        setNextRoundError(null);
        if (!session?.access_token) return;

        setNextRoundLoading(true);
        api.get<{ applications: JobApplicationSummary[] }>(`/companies/jobs/${opening.id}/applications`, session.access_token)
            .then((payload) => {
                const applications = payload.applications || [];
                setNextRoundApplications(applications);
                setOpenings((current) =>
                    current.map((item) =>
                        item.id === opening.id ? { ...item, applicationCount: applications.length } : item
                    )
                );
            })
            .catch((err) => {
                setNextRoundApplications([]);
                setNextRoundError(err instanceof ApiError ? err.message : "Failed to load applications.");
            })
            .finally(() => setNextRoundLoading(false));
    }

    function openTechnicalAssignmentSetup(opening: JobOpening, sourceAssignmentId: string | null = null) {
        if (!requireHiringAccess("set up technical assignments")) return;
        setTechnicalAssignmentConfigs((current) => ({
            ...current,
            [opening.id]: current[opening.id] || technicalAssignmentDefaults(opening),
        }));
        setTechnicalAssignmentSourceId(sourceAssignmentId);
        setTechnicalAssignmentOpening(opening);
    }

    function closeTechnicalAssignmentSetup() {
        setTechnicalAssignmentOpening(null);
        setTechnicalAssignmentSourceId(null);
    }

    async function saveTechnicalAssignmentSetup(config: TechnicalAssignmentFormState) {
        if (!technicalAssignmentOpening || !session?.access_token || savingTechnicalAssignment) return;
        if (!requireHiringAccess("set up technical assignments")) return;

        setSavingTechnicalAssignment(true);
        setError(null);
        try {
            const payload = await api.post<{ assignment: unknown; job: JobOpening }>(
                `/companies/jobs/${technicalAssignmentOpening.id}/technical-assignment`,
                {
                    ...technicalAssignmentPayload(config),
                    sourceAssignmentId: technicalAssignmentSourceId,
                },
                session.access_token
            );
            setTechnicalAssignmentConfigs((current) => ({
                ...current,
                [technicalAssignmentOpening.id]: config,
            }));
            if (payload.job) {
                setOpenings((current) => current.map((item) => item.id === payload.job.id ? payload.job : item));
            }
            closeTechnicalAssignmentSetup();
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "Failed to save technical assignment.");
        } finally {
            setSavingTechnicalAssignment(false);
        }
    }

    async function reevaluateApplication(applicationId: string) {
        const targetOpening = applicationsOpening || nextRoundOpening;
        if (!session?.access_token || !targetOpening || reevaluatingApplicationId) return null;
        if (!canManageHiring) {
            const message = hiringAccessMessage("re-evaluate applications");
            setApplicationsError(message);
            setNextRoundError(message);
            return null;
        }

        setReevaluatingApplicationId(applicationId);
        setApplicationsError(null);
        try {
            const payload = await api.post<{ application: JobApplicationSummary }>(
                `/companies/jobs/${targetOpening.id}/applications/${applicationId}/reevaluate`,
                {},
                session.access_token
            );
            const updated = payload.application;
            setSelectedApplications((current) =>
                current.map((application) => application.id === updated.id ? updated : application)
            );
            setNextRoundApplications((current) =>
                current.map((application) => application.id === updated.id ? updated : application)
            );
            setNextRoundReportApplication((current) => current?.id === updated.id ? updated : current);
            return updated;
        } catch (err) {
            setApplicationsError(err instanceof ApiError ? err.message : "Failed to re-evaluate application.");
            return null;
        } finally {
            setReevaluatingApplicationId(null);
        }
    }

    async function moveApplicationsToNextRound(payload: { topCount: number; applicationIds: string[]; pipelineType: NextRoundPipeline }) {
        const targetOpening = applicationsOpening || nextRoundOpening;
        if (!session?.access_token || !targetOpening || movingToNextRound) return null;
        if (!canManageHiring) {
            const message = hiringAccessMessage("move candidates to the next round");
            setApplicationsError(message);
            setNextRoundError(message);
            setError(message);
            return null;
        }

        setMovingToNextRound(true);
        setApplicationsError(null);
        setNextRoundError(null);
        try {
            const response = await api.post<{ applications: JobApplicationSummary[]; job?: JobOpening; movedCount: number; pipelineType: NextRoundPipeline }>(
                `/companies/jobs/${targetOpening.id}/applications/next-round`,
                payload,
                session.access_token
            );
            const updated = response.applications || [];
            const updatedOpening = response.job || {
                ...targetOpening,
                nextRoundType: payload.pipelineType,
                nextRoundConfiguredAt: new Date().toISOString(),
            };
            setSelectedApplications(updated);
            setNextRoundApplications(updated);
            if (applicationsOpening) {
                setApplicationsOpening(updatedOpening);
            }
            setNextRoundOpening(updatedOpening);
            setOpenings((current) =>
                current.map((opening) => opening.id === updatedOpening.id ? updatedOpening : opening)
            );
            const monitorPath = companyRoundMonitorPath(updatedOpening.currentRoundType || payload.pipelineType);
            if (monitorPath && payload.pipelineType !== "technical_assignment") {
                router.push(monitorPath);
            }
            return updated;
        } catch (err) {
            const message = err instanceof ApiError ? err.message : "Failed to move candidates to the next round.";
            setApplicationsError(message);
            setNextRoundError(message);
            return null;
        } finally {
            setMovingToNextRound(false);
        }
    }

    function closeForm() {
        setIsFormOpen(false);
        setEditingJobId(null);
        setUploadingLogo(false);
        setForm(defaultFormForCompany(company));
    }

    async function uploadLogo(file: File | null) {
        if (!file || !session?.access_token || uploadingLogo) return;
        if (!requireHiringAccess("upload job assets")) return;

        setUploadingLogo(true);
        setError(null);

        try {
            const body = new FormData();
            body.append("file", file);
            const res = await fetch(`${getApiBaseUrl()}/companies/jobs/assets`, {
                method: "POST",
                headers: { Authorization: `Bearer ${session.access_token}` },
                credentials: "include",
                body,
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new ApiError(res.status, data.error || data.message || "Failed to upload logo.", data);
            }

            setForm((current) => ({
                ...current,
                companyLogoUrl: data.fileUrl,
                companyLogoName: file.name,
            }));
        } catch (err) {
            setError(apiErrorMessage(err, "Failed to upload logo."));
        } finally {
            setUploadingLogo(false);
        }
    }

    async function saveOpening() {
        if (!canSave || !session?.access_token || saving) return;
        if (!requireHiringAccess("create or edit job openings")) return;
        const currentValidationErrors = scorecardValidationErrors(form);
        if (currentValidationErrors.length) {
            setError(currentValidationErrors[0]);
            return;
        }

        setSaving(true);
        setError(null);

        const payload = {
            companyName: form.companyName,
            companyLogoUrl: form.companyLogoUrl || null,
            title: form.title,
            location: form.location,
            workMode: form.workMode,
            employmentType: form.employmentType,
            roleType: form.roleType,
            profession: "Software Engineering",
            discipline: "Software Engineering",
            travel: form.travel,
            openings: Number.parseInt(form.openings, 10) || 1,
            experienceLevel: form.experienceLevel,
            compensationType: form.compensationType,
            compensation: form.compensation,
            duration: form.duration,
            timeCommitment: form.timeCommitment,
            applicationDeadline: form.applicationDeadline,
            skills: splitSkills(form.skillsText),
            companyOverview: form.companyOverview,
            aboutRole: form.aboutRole,
            responsibilities: splitLines(form.responsibilities),
            requirements: splitLines(form.requirements),
            benefits: splitLines(form.benefits),
            applicationNote: form.applicationNote,
            scoringConfig: scoringConfigFromForm(form),
            status: "open",
        };

        try {
            const { job } = editingJobId
                ? await api.put<{ job: JobOpening }>(`/companies/jobs/${editingJobId}`, payload, session.access_token)
                : await api.post<{ job: JobOpening }>("/companies/jobs", payload, session.access_token);

            setOpenings((current) =>
                editingJobId
                    ? current.map((item) => (item.id === job.id ? job : item))
                    : [job, ...current]
            );
            closeForm();
        } catch (err) {
            setError(apiErrorMessage(err, "Failed to save job opening."));
        } finally {
            setSaving(false);
        }
    }

    return (
        <main className="min-h-full bg-[#FAFBFC] px-4 py-8 dark:bg-lc-bg sm:px-6 lg:px-10">
            <div className="mx-auto flex max-w-7xl flex-col gap-8">
                <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div className="flex items-center gap-3">
                        <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                            <span className="material-symbols-outlined">work</span>
                        </span>
                        <div>
                            <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">Company Workspace</p>
                            <h1 className="font-nunito text-3xl font-extrabold tracking-tight text-slate-950 dark:text-white sm:text-4xl">Jobs</h1>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={openForm}
                        className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-bold text-white shadow-lg shadow-primary/20"
                    >
                        <span className="material-symbols-outlined text-[20px]">add</span>
                        Create job opening
                    </button>
                </section>

                <section>
                    <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-lc-border dark:bg-lc-surface">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <h2 className="font-nunito text-2xl font-extrabold text-slate-950 dark:text-white">Openings</h2>
                                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Create structured postings that can later appear on the candidate side.</p>
                            </div>
                        </div>

                        {error && (
                            <div className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300">
                                {error}
                            </div>
                        )}

                        {loadingJobs ? (
                            <div className="mt-8 flex min-h-[340px] items-center justify-center rounded-lg border border-slate-200 bg-slate-50 dark:border-lc-border dark:bg-lc-elevated">
                                <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
                            </div>
                        ) : openings.length === 0 ? (
                            <div className="mt-8 flex min-h-[340px] flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-center dark:border-lc-border dark:bg-lc-elevated">
                                <div className="mb-5 grid size-16 place-items-center rounded-2xl bg-white text-slate-500 shadow-sm dark:bg-lc-hover dark:text-slate-300">
                                    <span className="material-symbols-outlined text-4xl">post_add</span>
                                </div>
                                <h3 className="font-nunito text-2xl font-extrabold text-slate-950 dark:text-white">No job openings yet</h3>
                                <button type="button" onClick={openForm} className="mt-5 rounded-full border border-primary px-5 py-2.5 text-sm font-bold text-primary hover:bg-primary/5">
                                    Create first opening
                                </button>
                            </div>
                        ) : (
                            <div className="mt-6 grid gap-4">
                                {openings.map((opening) => {
                                    const hasNextRoundPipeline = Boolean(opening.nextRoundType);
                                    const hasMonitorableCurrentRound = Boolean(opening.currentRoundType);
                                    return (
                                    <article
                                        key={opening.id}
                                        onClick={() => openOpeningDetails(opening)}
                                        className="cursor-pointer rounded-lg border border-slate-200 p-5 transition hover:border-primary/30 hover:shadow-sm dark:border-lc-border"
                                    >
                                        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                                            <div className="flex min-w-0 gap-4">
                                                {opening.companyLogoUrl && (
                                                    <div className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-lc-border dark:bg-lc-elevated">
                                                        <img src={opening.companyLogoUrl} alt="" className="h-full w-full object-contain p-2" />
                                                    </div>
                                                )}
                                                <div className="min-w-0">
                                                    <p className={`text-xs font-bold uppercase tracking-[0.14em] ${isDeadlinePassed(opening.applicationDeadline) || opening.status === "closed" ? "text-slate-400" : "text-primary"}`}>
                                                        {isDeadlinePassed(opening.applicationDeadline) && opening.status === "open" ? "closed by deadline" : opening.status}
                                                    </p>
                                                    <h3 className="mt-1 font-nunito text-xl font-extrabold text-slate-950 dark:text-white">{opening.title}</h3>
                                                    <p className="mt-1 text-sm font-medium text-slate-500 dark:text-slate-400">{opening.companyName} - {opening.location}</p>
                                                </div>
                                            </div>
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300">
                                                    <span className="material-symbols-outlined text-[16px]">group</span>
                                                    {opening.applicationCount || 0} applied
                                                </span>
                                                <button
                                                    type="button"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        openApplications(opening);
                                                    }}
                                                    className="inline-flex h-9 items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 text-xs font-extrabold text-primary hover:bg-primary hover:text-white"
                                                >
                                                    <span className="material-symbols-outlined text-[17px]">fact_check</span>
                                                    View applications
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        if (opening.currentRoundType && monitorCompanyRound(router, opening.currentRoundType)) {
                                                            return;
                                                        }
                                                        if (hasNextRoundPipeline) {
                                                            if (opening.nextRoundType === "technical_assignment") {
                                                                openTechnicalAssignmentSetup(opening);
                                                            } else if (opening.nextRoundType === "mock_oa") {
                                                                monitorCompanyRound(router, opening.nextRoundType);
                                                            } else {
                                                                openNextRoundOnly(opening);
                                                            }
                                                        } else {
                                                            openNextRoundOnly(opening);
                                                        }
                                                    }}
                                                    disabled={(opening.applicationCount || 0) === 0 && !hasMonitorableCurrentRound}
                                                    className={`inline-flex h-9 items-center gap-2 rounded-full px-3 text-xs font-extrabold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50 ${hasMonitorableCurrentRound ? "bg-emerald-500 shadow-emerald-500/20 hover:bg-emerald-600" : hasNextRoundPipeline ? "bg-primary shadow-primary/20 hover:bg-primary/90" : "bg-emerald-500 shadow-emerald-500/20 hover:bg-emerald-600"}`}
                                                >
                                                    <span className="material-symbols-outlined text-[17px]">{currentRoundCtaIcon(opening)}</span>
                                                    {currentRoundCtaLabel(opening)}
                                                </button>
                                                {hasNextRoundPipeline && !hasMonitorableCurrentRound && opening.nextRoundType !== "ai_interview" && (
                                                    <button
                                                        type="button"
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            openNextRoundOnly(opening);
                                                        }}
                                                        disabled={(opening.applicationCount || 0) === 0}
                                                        className="inline-flex h-9 items-center gap-2 rounded-full border border-amber-300/60 bg-amber-400/10 px-3 text-xs font-extrabold text-amber-700 transition hover:bg-amber-400 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-300/30 dark:text-amber-200"
                                                    >
                                                        <span className="material-symbols-outlined text-[17px]">edit_note</span>
                                                        Update round
                                                    </button>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        openEditForm(opening);
                                                    }}
                                                    className="grid size-9 place-items-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-primary dark:text-slate-300 dark:hover:bg-lc-hover"
                                                    aria-label={`Edit ${opening.title}`}
                                                >
                                                    <span className="material-symbols-outlined text-[20px]">edit</span>
                                                </button>
                                            </div>
                                        </div>
                                        <p className="mt-4 max-h-12 overflow-hidden text-sm leading-6 text-slate-600 dark:text-slate-300">{opening.aboutRole}</p>
                                    </article>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </section>
            </div>

            {isFormOpen && (
                <JobFormModal
                    form={form}
                    setForm={setForm}
                    onClose={closeForm}
                    onSave={saveOpening}
                    onLogoChange={uploadLogo}
                    canSave={canSave && !saving && !uploadingLogo}
                    validationErrors={validationErrors}
                    error={error}
                    saving={saving}
                    uploadingLogo={uploadingLogo}
                    mode={editingJobId ? "edit" : "create"}
                />
            )}
            {selectedOpening && (
                <OpeningDetailModal
                    opening={selectedOpening}
                    onClose={() => setSelectedOpening(null)}
                    onEdit={() => openEditForm(selectedOpening)}
                />
            )}
            {applicationsOpening && (
                <ApplicationsModal
                    opening={applicationsOpening}
                    applications={selectedApplications}
                    loading={applicationsLoading}
                    error={applicationsError}
                    startNextRound={openNextRoundOnLoad}
                    onReevaluate={reevaluateApplication}
                    onMoveToNextRound={moveApplicationsToNextRound}
                    reevaluatingApplicationId={reevaluatingApplicationId}
                    movingToNextRound={movingToNextRound}
                    onClose={() => {
                        setApplicationsOpening(null);
                        setOpenNextRoundOnLoad(false);
                    }}
                />
            )}
            {nextRoundOpening && (
                <div>
                    {nextRoundLoading ? (
                        <div className="fixed inset-0 z-[150] grid place-items-center bg-slate-950/60 px-4 backdrop-blur-sm">
                            <div className="rounded-xl border border-slate-200 bg-white px-6 py-5 text-center shadow-2xl dark:border-lc-border dark:bg-lc-surface">
                                <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
                                <p className="mt-3 text-sm font-bold text-slate-600 dark:text-slate-300">Loading candidates...</p>
                            </div>
                        </div>
                    ) : nextRoundError ? (
                        <div className="fixed inset-0 z-[150] grid place-items-center bg-slate-950/60 px-4 backdrop-blur-sm">
                            <div className="w-full max-w-md rounded-xl border border-red-200 bg-white p-6 shadow-2xl dark:border-red-400/30 dark:bg-lc-surface">
                                <p className="font-nunito text-xl font-extrabold text-slate-950 dark:text-white">Could not open next round</p>
                                <p className="mt-2 text-sm font-semibold text-red-600 dark:text-red-300">{nextRoundError}</p>
                                <button
                                    type="button"
                                    onClick={() => setNextRoundOpening(null)}
                                    className="mt-5 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-white"
                                >
                                    Close
                                </button>
                            </div>
                        </div>
                    ) : (
                        <NextRoundModal
                            applications={nextRoundApplications}
                            initialPipelineType={nextRoundOpening.nextRoundType}
                            error={nextRoundError}
                            onViewReport={setNextRoundReportApplication}
                            saving={movingToNextRound}
                            onClose={() => {
                                setNextRoundOpening(null);
                                setNextRoundReportApplication(null);
                            }}
                            onSubmit={moveApplicationsToNextRound}
                        />
                    )}
                </div>
            )}
            {nextRoundReportApplication && (
                <CandidateReportModal
                    application={nextRoundReportApplication}
                    onClose={() => setNextRoundReportApplication(null)}
                    onReevaluate={() => reevaluateApplication(nextRoundReportApplication.id)}
                    reevaluating={reevaluatingApplicationId === nextRoundReportApplication.id}
                />
            )}
            {technicalAssignmentOpening && (
                <TechnicalAssignmentSetupModal
                    opening={technicalAssignmentOpening}
                    initialConfig={technicalAssignmentConfigs[technicalAssignmentOpening.id] || technicalAssignmentDefaults(technicalAssignmentOpening)}
                    onClose={closeTechnicalAssignmentSetup}
                    onSave={saveTechnicalAssignmentSetup}
                    saving={savingTechnicalAssignment}
                />
            )}
        </main>
    );
}
