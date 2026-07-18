import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { decrypt } from "../lib/encryption.js";
import { checkRateLimit } from "../lib/rate-limiter.js";
import { getGeminiClient, GEMINI_MODEL } from "../lib/gemini.js";
import type { InterviewStage, InterviewType } from "@interviewforge/shared";
import { computeIntegrityScore } from "../services/proctoring/rules.js";
import { loadActiveProctoringRules } from "../services/proctoring/ingest.js";
import { buildScreeningBlueprint, countBlueprintQuestions, type ScreeningBlueprint } from "../services/company-ai-screening/blueprint.js";
import { stageForPhaseType } from "../services/company-ai-screening/stage-mapping.js";
import { AI_SCREENING_PROCTORING_RULES } from "../services/company-ai-screening/proctoring-rules.js";
import { normalizeInterviewModuleConfig, resolveEffectiveInterviewTypeConfig } from "../services/agent/interview-module-selection.js";
import {
    advanceScreeningAttempt,
    createScreeningAttemptState,
    currentScreeningTurn,
    type ScreeningAttemptState,
} from "../services/company-ai-screening/runtime.js";
import { generateCompanyAiScreeningReport } from "../services/company-ai-screening/report.js";
import { isCompanyScreeningTestRestartEnabled } from "../services/company-ai-screening/mock-interviewer.js";
import { disconnectProctoringSession } from "../services/proctoring/socket-bus.js";

const companyJobOpening = (prisma as any).companyJobOpening;
const jobApplyProfile = (prisma as any).jobApplyProfile;
const gitHubIntegration = (prisma as any).gitHubIntegration;
const jobApplication = (prisma as any).jobApplication;
const gitHubProjectAnalysis = (prisma as any).gitHubProjectAnalysis;
const technicalAssignment = (prisma as any).technicalAssignment;
const technicalAssignmentSubmission = (prisma as any).technicalAssignmentSubmission;
const jobRound = (prisma as any).jobRound;
const jobRoundCandidate = (prisma as any).jobRoundCandidate;
const jobRoundEvaluationReport = (prisma as any).jobRoundEvaluationReport;
const secureOaSession = (prisma as any).secureOaSession;
const proctoringRule = (prisma as any).proctoringRule;
const proctoringEvent = (prisma as any).proctoringEvent;
const interviewSession = (prisma as any).interviewSession;
const sessionMessage = (prisma as any).sessionMessage;
const publicJobSelect = {
    id: true,
    companyName: true,
    companyLogoUrl: true,
    title: true,
    location: true,
    workMode: true,
    employmentType: true,
    roleType: true,
    travel: true,
    openings: true,
    experienceLevel: true,
    compensationType: true,
    compensation: true,
    duration: true,
    timeCommitment: true,
    applicationDeadline: true,
    skills: true,
    companyOverview: true,
    aboutRole: true,
    responsibilities: true,
    requirements: true,
    benefits: true,
    applicationNote: true,
    publishedAt: true,
    createdAt: true,
};

const jobsQuerySchema = z.object({
    q: z.string().trim().max(120).optional(),
    page: z.coerce.number().int().min(1).max(1000).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
});

const jobIdParamsSchema = z.object({
    id: z.string().uuid(),
});
const technicalAssignmentParamsSchema = z.object({
    assignmentId: z.string().uuid(),
});
const aiScreeningRoundCandidateParamsSchema = z.object({
    roundCandidateId: z.string().uuid(),
});
const aiScreeningStartSchema = z.object({
    client_fingerprint: z.string().trim().min(8).max(256).optional(),
    user_agent: z.string().trim().min(1).max(600).optional(),
}).default({});
const aiScreeningAnswerSchema = z.object({
    answer: z.string().trim().min(1).max(30000),
});

const optionalUrl = z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z.string().url().max(500).optional().nullable()
);

const codingProfilesSchema = z.object({
    leetcodeUrl: optionalUrl,
    geeksforgeeksUrl: optionalUrl,
    codeforcesUrl: optionalUrl,
    codechefUrl: optionalUrl,
}).partial();

const selectedProjectSchema = z.object({
    id: z.union([z.string(), z.number()]).optional(),
    nodeId: z.string().max(160).optional().nullable(),
    name: z.string().trim().min(1).max(160),
    fullName: z.string().trim().min(1).max(240),
    htmlUrl: z.string().trim().url().max(500).optional().nullable(),
    description: z.string().trim().max(500).optional().nullable(),
    fork: z.boolean().optional(),
    private: z.boolean().optional(),
    language: z.string().trim().max(80).optional().nullable(),
    defaultBranch: z.string().trim().max(120).optional().nullable(),
});

const quickApplySchema = z.object({
    selectedProjects: z.array(selectedProjectSchema).min(1).max(3),
    codingProfiles: codingProfilesSchema.optional(),
});
const technicalAssignmentSubmissionSchema = z.object({
    repoUrl: z.string().trim().url().max(500).refine((value) => {
        try {
            const url = new URL(value);
            return url.hostname === "github.com" || url.hostname.endsWith(".github.com");
        } catch {
            return false;
        }
    }, "Submit a valid GitHub repository URL."),
});

const DEFAULT_ASSIGNMENT_RUBRIC = {
    functionality: 25,
    architecture: 15,
    codeQuality: 15,
    documentation: 15,
    testing: 10,
    productThinking: 10,
    security: 10,
};

class GitHubCredentialsError extends Error {
    constructor(message = "GitHub credentials need to be refreshed.") {
        super(message);
        this.name = "GitHubCredentialsError";
    }
}

function toPublicJob(job: any, applied = false) {
    return {
        id: job.id,
        companyName: job.companyName,
        companyLogoUrl: job.companyLogoUrl,
        title: job.title,
        location: job.location,
        workMode: job.workMode,
        employmentType: job.employmentType,
        roleType: job.roleType,
        travel: job.travel,
        openings: job.openings,
        experienceLevel: job.experienceLevel,
        compensationType: job.compensationType,
        compensation: job.compensation,
        duration: job.duration,
        timeCommitment: job.timeCommitment,
        applicationDeadline: job.applicationDeadline?.toISOString() ?? null,
        skills: job.skills,
        companyOverview: job.companyOverview,
        aboutRole: job.aboutRole,
        responsibilities: job.responsibilities,
        requirements: job.requirements,
        benefits: job.benefits,
        applicationNote: job.applicationNote,
        publishedAt: job.publishedAt?.toISOString() ?? null,
        createdAt: job.createdAt.toISOString(),
        applied,
    };
}

function toCandidateTechnicalAssignment(assignment: any, submission: any | null = null) {
    return {
        id: assignment.id,
        jobId: assignment.jobId,
        jobTitle: assignment.job?.title || "",
        companyName: assignment.job?.companyName || "",
        title: assignment.title,
        timeLimit: assignment.timeLimit,
        estimatedHours: assignment.estimatedHours,
        deadlinePolicy: assignment.deadlinePolicy,
        overview: assignment.overview,
        scenario: assignment.scenario,
        tasks: assignment.tasks || [],
        starterContext: assignment.starterContext,
        constraints: assignment.constraints || [],
        allowedStack: assignment.allowedStack || [],
        deliverables: assignment.deliverables || [],
        submissionInstructions: assignment.submissionInstructions,
        thinkingQuestions: assignment.thinkingQuestions || [],
        candidateMessage: assignment.candidateMessage,
        closesAt: assignment.closesAt?.toISOString?.() || assignment.closesAt,
        submitted: Boolean(submission),
        submission: submission
            ? {
                id: submission.id,
                repoUrl: submission.repoUrl,
                status: submission.status,
                submittedAt: submission.submittedAt.toISOString(),
            }
            : null,
    };
}

function toRecord(value: unknown): Record<string, any> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function textArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => String(item || "").trim())
        .filter(Boolean);
}

function buildAgentProfileSummary(profileAgent: Record<string, any>) {
    const verdict = typeof profileAgent.oneLineVerdict === "string" ? profileAgent.oneLineVerdict.trim() : "";
    const strengths = textArray(profileAgent.relevantStrengths);
    const gaps = textArray(profileAgent.gapsForThisRole);
    const signal = typeof profileAgent.signalNotInResume === "string" ? profileAgent.signalNotInResume.trim() : "";

    return [
        verdict,
        strengths.length ? `Role evidence: ${strengths.join(" ")}` : "",
        gaps.length ? `Gaps to verify: ${gaps.join(" ")}` : "",
        signal ? `Extra signal: ${signal}` : "",
    ].filter(Boolean).join(" ");
}

function toCandidateOnlineAssessment(round: any) {
    const config = toRecord(toRecord(round.config).onlineAssessment);
    const questions = Array.isArray(config.questions) ? config.questions : [];
    if (!questions.length) return null;

    return {
        id: round.id,
        roundId: round.id,
        jobId: round.job?.id,
        title: config.title || round.title || "Online assessment",
        startAt: config.startAt || round.opensAt?.toISOString?.() || null,
        endAt: config.endAt || round.closesAt?.toISOString?.() || null,
        durationMinutes: Number(config.durationMinutes || 0) || null,
        questionCount: Number(config.questionCount || questions.length || 0),
        instructions: config.instructions || "",
        candidateMessage: config.candidateMessage || "",
        requireSecureBrowser: config.requireSecureBrowser ?? true,
        questions: questions.map((question: any, index: number) => ({
            id: String(question.id || question.questionId || `question-${index + 1}`),
            questionId: question.questionId ? String(question.questionId) : String(question.id || ""),
            text: String(question.text || "Online assessment question"),
            type: question.type || null,
            difficulty: question.difficulty || null,
            timeLimitMinutes: Number(question.timeLimitMinutes || 0) || null,
            aiInterviewEnabled: Boolean(question.aiInterviewEnabled),
            orderIndex: Number.isFinite(Number(question.orderIndex)) ? Number(question.orderIndex) : index,
        })),
    };
}

function toCandidateAiInterview(round: any) {
    const config = toRecord(toRecord(round.config).aiInterview);
    const blueprint = buildScreeningBlueprint(config);
    const questions = Array.isArray(config.questions) ? config.questions : [];
    const rubric = Array.isArray(config.rubric) ? config.rubric : [];
    if (!config.configuredAt && !questions.length && !rubric.length && !blueprint.phases.length) return null;

    return {
        id: round.id,
        roundId: round.id,
        jobId: round.job?.id,
        title: config.title || round.title || "AI screening interview",
        startAt: config.startAt || round.opensAt?.toISOString?.() || null,
        endAt: config.endAt || round.closesAt?.toISOString?.() || null,
        durationMinutes: Number(config.durationMinutes || 0) || null,
        questionCount: countBlueprintQuestions(blueprint),
        rubricCount: Number(rubric.length || 0),
        candidateInstructions: config.candidateInstructions || "",
        candidateMessage: config.candidateMessage || "",
        requireFullscreen: true,
        requireCamera: true,
        requireMicrophone: true,
    };
}

const scheduledRoundLabels: Record<string, { label: string; icon: string }> = {
    ai_interview: { label: "AI interview", icon: "mic" },
    mock_oa: { label: "Online assessment", icon: "quiz" },
    technical_assignment: { label: "Technical assignment", icon: "assignment_turned_in" },
    final_interview: { label: "Final interview", icon: "groups" },
};

function toScheduledRoundFromRoundCandidate(candidate: any) {
    const round = candidate.round || {};
    const roundType = round.roundType || "next_round";
    const roundMeta = scheduledRoundLabels[roundType] || { label: "Next round", icon: "event_available" };
    const assignment = round.technicalAssignment || null;
    const submission = assignment?.submissions?.[0] || null;
    const onlineAssessment = roundType === "mock_oa" ? toCandidateOnlineAssessment(round) : null;
    const aiInterview = roundType === "ai_interview" ? toCandidateAiInterview(round) : null;
    const closesAt = assignment?.closesAt || onlineAssessment?.endAt || aiInterview?.endAt || round.closesAt;
    const roundClosed = closesAt ? new Date(closesAt).getTime() <= Date.now() : false;
    const isConfigured = roundType === "technical_assignment"
        ? Boolean(assignment)
        : roundType === "mock_oa"
            ? Boolean(onlineAssessment)
            : roundType === "ai_interview"
                ? Boolean(aiInterview)
                : round.status === "open";
    const roundSubmitted = (roundType === "mock_oa" || roundType === "ai_interview") && Boolean(candidate.submittedAt);

    return {
        id: candidate.id,
        roundCandidateId: candidate.id,
        roundId: round.id,
        applicationId: candidate.applicationId,
        status: candidate.status,
        roundType,
        roundLabel: roundMeta.label,
        roundIcon: roundMeta.icon,
        movedAt: candidate.createdAt?.toISOString?.() ?? null,
        configured: isConfigured,
        state: submission || roundSubmitted ? "submitted" : roundClosed ? "closed" : isConfigured ? "ready" : "pending_setup",
        job: {
            id: round.job?.id,
            title: round.job?.title || "",
            companyName: round.job?.companyName || "",
            companyLogoUrl: round.job?.companyLogoUrl || null,
            location: round.job?.location || null,
            workMode: round.job?.workMode || null,
            employmentType: round.job?.employmentType || null,
        },
        technicalAssignment: assignment ? toCandidateTechnicalAssignment(
            {
                ...assignment,
                job: round.job,
            },
            submission || null
        ) : null,
        onlineAssessment,
        aiInterview,
    };
}

function aiInterviewConfigFromRound(round: any) {
    return toRecord(toRecord(round?.config).aiInterview);
}

function isWithinAiWindow(config: Record<string, any>, round: any) {
    const now = Date.now();
    const startAt = new Date(config.startAt || round.opensAt || 0).getTime();
    const endAt = new Date(config.endAt || round.closesAt || 0).getTime();
    return Number.isFinite(startAt) && Number.isFinite(endAt) && now >= startAt && now <= endAt;
}

function getRequestIp(request: any) {
    return request.ip || request.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() || "";
}

async function ensureAiScreeningProctoringRule(jobRoundId: string) {
    const existing = await proctoringRule.findFirst({
        where: { jobRoundId, isActive: true },
        select: { id: true },
    });
    if (existing) return existing;

    try {
        return await proctoringRule.create({
            data: {
                jobRoundId,
                version: 1,
                isActive: true,
                rules: AI_SCREENING_PROCTORING_RULES,
            },
            select: { id: true },
        });
    } catch (error: any) {
        if (error?.code !== "P2002") throw error;
        return proctoringRule.findFirst({
            where: { jobRoundId, isActive: true },
            select: { id: true },
        });
    }
}

async function activeAiScreeningRulesPublic(jobRoundId: string) {
    const ruleset = await loadActiveProctoringRules(prisma, jobRoundId);
    return {
        heartbeat_interval_ms: ruleset.rules.thresholds.heartbeat_interval_ms,
        snapshot_interval_ms: ruleset.rules.thresholds.snapshot_interval_ms,
    };
}

function getAiScreeningAttempt(metadata: unknown): ScreeningAttemptState | null {
    const attempt = toRecord(metadata).aiScreeningAttempt;
    if (!attempt || typeof attempt !== "object" || Array.isArray(attempt)) return null;
    if ((attempt as any).version !== 1) return null;
    return attempt as ScreeningAttemptState;
}

function publicAiScreeningAttempt(attempt: ScreeningAttemptState | null) {
    if (!attempt) return null;
    return {
        status: attempt.status,
        startedAt: attempt.startedAt,
        submittedAt: attempt.submittedAt || null,
        proctoringSessionId: attempt.proctoringSessionId,
        interviewSessionId: attempt.interviewSessionId || null,
        turn: currentScreeningTurn(attempt),
        answeredTurns: attempt.answers.length,
    };
}

function screeningInterviewModuleSelection(blueprint: ScreeningBlueprint) {
    const type: InterviewType = "behavioural";
    const enabledStages: InterviewStage[] = ["BEHAVIOURAL", "CLOSING"];

    const rawModuleConfig = {
        version: 1,
        source: "custom",
        enabledStages,
        stageDurations: {
            BEHAVIOURAL: { min: 1, max: Math.max(1, Number(blueprint.durationMinutes || 30)) },
            CLOSING: { min: 1, max: 3 },
        },
    };
    const moduleConfig = normalizeInterviewModuleConfig(type, rawModuleConfig);
    const effectiveConfig = resolveEffectiveInterviewTypeConfig(type, moduleConfig);
    // Start the session on the FIRST configured phase's mapped stage (e.g. resume_project -> INTRO)
    // rather than the container's default, so the welcome line and turn 0 are tagged with the real
    // phase. The pacing pointer keeps currentStage tracking the phase from there.
    const firstPhaseType = (blueprint.phases || []).find((phase) => phase.questions.length > 0)?.type;
    const firstStage = (
        (firstPhaseType ? stageForPhaseType(firstPhaseType) : null)
        ?? effectiveConfig.stages[0]
        ?? "INTRO"
    ) as InterviewStage;
    return { type, moduleConfig, firstStage };
}

async function findCandidateResumeId(userId: string, needsResume: boolean) {
    if (!needsResume) return null;
    const profile = await jobApplyProfile.findUnique({
        where: { userId },
        select: { selectedResumeId: true },
    });
    return profile?.selectedResumeId || null;
}

async function ensureAiScreeningInterviewSession(args: {
    userId: string;
    jobTitle: string;
    existingSessionId?: string | null;
    blueprint: ScreeningBlueprint;
    roundCandidateId: string;
    jobRoundId: string;
    applicationId: string;
}) {
    if (args.existingSessionId) {
        const existing = await interviewSession.findFirst({
            where: { id: args.existingSessionId, userId: args.userId },
            select: { id: true, status: true, type: true, moduleConfig: true },
        });
        const enabledStages = Array.isArray(toRecord(existing?.moduleConfig).enabledStages)
            ? toRecord(existing?.moduleConfig).enabledStages
            : [];
        const isCurrentCompanyRuntime =
            existing?.type === "behavioural" &&
            enabledStages.includes("BEHAVIOURAL") &&
            !enabledStages.includes("DSA") &&
            !enabledStages.includes("FUNDAMENTALS");
        if (existing && isCurrentCompanyRuntime) return existing.id;
    }

    const { type, moduleConfig, firstStage } = screeningInterviewModuleSelection(args.blueprint);
    // Load the candidate's actual resume whenever the blueprint has a resume/project phase.
    // (Do NOT gate on the INTRO stage: the screening runtime runs its phases inside a single
    // BEHAVIOURAL container stage, so enabledStages never contains INTRO — gating on it left
    // resumeId null and the resume phase fell back to raw GitHub repo slugs instead of the
    // candidate's real parsed resume.)
    const hasResumePhase = (args.blueprint.phases || []).some((phase) => phase.type === "resume_project");
    const needsResume = hasResumePhase || moduleConfig.enabledStages.includes("INTRO");
    const resumeId = await findCandidateResumeId(args.userId, needsResume);

    const session = await interviewSession.create({
        data: {
            userId: args.userId,
            type,
            role: args.jobTitle || "Software Engineer",
            level: "Mid",
            mode: "company_screening",
            resumeId,
            status: "PENDING",
            stage: firstStage,
            moduleConfig,
        },
        select: { id: true },
    });

    await sessionMessage.create({
        data: {
            sessionId: session.id,
            role: "system",
            content: "Hiring screening interview module configuration",
            stage: "CONFIG",
            metadata: {
                moduleConfig,
                companyScreening: {
                    version: 1,
                    roundCandidateId: args.roundCandidateId,
                    jobRoundId: args.jobRoundId,
                    applicationId: args.applicationId,
                    blueprintSnapshot: args.blueprint,
                    strictRuntimeEnabled: true,
                },
            } as any,
        },
    });

    return session.id;
}

function isJobOpen(job: any) {
    if (!job || job.status !== "open") return false;
    if (!job.applicationDeadline) return true;
    const deadline = new Date(job.applicationDeadline);
    deadline.setHours(23, 59, 59, 999);
    return deadline.getTime() >= Date.now();
}

function codingProfileValues(profile: any, overrides?: z.infer<typeof codingProfilesSchema>) {
    return {
        leetcodeUrl: overrides?.leetcodeUrl ?? profile?.leetcodeUrl ?? null,
        geeksforgeeksUrl: overrides?.geeksforgeeksUrl ?? profile?.geeksforgeeksUrl ?? null,
        codeforcesUrl: overrides?.codeforcesUrl ?? profile?.codeforcesUrl ?? null,
        codechefUrl: overrides?.codechefUrl ?? profile?.codechefUrl ?? null,
    };
}

function hasCodingProfile(profile: any, overrides?: z.infer<typeof codingProfilesSchema>) {
    return Object.values(codingProfileValues(profile, overrides)).some((value) => typeof value === "string" && value.trim().length > 0);
}

function extractHandle(url: string | null | undefined) {
    if (!url) return null;
    try {
        const parsed = new URL(url);
        const parts = parsed.pathname.split("/").filter(Boolean);
        return parts.at(-1) || null;
    } catch {
        return null;
    }
}

async function githubFetch(path: string, accessToken: string) {
    const response = await fetch(`https://api.github.com${path}`, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "Practers-Job-Apply",
        },
    });

    if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        if (response.status === 401 || body?.message === "Bad credentials") {
            throw new GitHubCredentialsError();
        }
        throw new Error(body?.message || `GitHub request failed with ${response.status}`);
    }

    return response.json();
}

async function githubGraphql<T>(query: string, variables: Record<string, unknown>, accessToken: string): Promise<T | null> {
    const response = await fetch("https://api.github.com/graphql", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/vnd.github+json",
            "Content-Type": "application/json",
            "User-Agent": "Practers-Job-Apply",
        },
        body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) return null;
    const payload = await response.json().catch(() => null);
    if (!payload || payload.errors) return null;
    return payload.data || null;
}

async function githubFetchPages(path: string, accessToken: string, maxPages = 5) {
    const items = [];
    for (let page = 1; page <= maxPages; page += 1) {
        const separator = path.includes("?") ? "&" : "?";
        const payload = await githubFetch(`${path}${separator}per_page=100&page=${page}`, accessToken);
        if (!Array.isArray(payload)) break;
        items.push(...payload);
        if (payload.length < 100) break;
    }
    return items;
}

function normalizeRepo(repo: any) {
    return {
        id: String(repo.id),
        nodeId: repo.node_id ?? null,
        name: repo.name,
        fullName: repo.full_name,
        htmlUrl: repo.html_url,
        description: repo.description ?? null,
        fork: Boolean(repo.fork),
        private: Boolean(repo.private),
        language: repo.language ?? null,
        defaultBranch: repo.default_branch ?? null,
        updatedAt: repo.updated_at ?? null,
        pushedAt: repo.pushed_at ?? null,
        stars: repo.stargazers_count ?? 0,
    };
}

async function getGithubContext(userId: string) {
    const integration = await gitHubIntegration.findUnique({
        where: { userId },
        select: {
            githubUsername: true,
            encryptedAccessToken: true,
            revokedAt: true,
        },
    });

    if (!integration || integration.revokedAt) return null;
    return {
        username: integration.githubUsername,
        accessToken: decrypt(integration.encryptedAccessToken),
    };
}

async function revokeGithubIntegration(userId: string) {
    await gitHubIntegration.updateMany({
        where: { userId },
        data: { revokedAt: new Date() },
    });
}

function isGitHubCredentialsError(error: unknown) {
    return error instanceof GitHubCredentialsError || (error instanceof Error && error.name === "GitHubCredentialsError");
}

async function getRepoHeadSha(repoFullName: string, branch: string | null | undefined, accessToken: string) {
    if (!branch) return null;
    try {
        const safeFullName = repoFullName.split("/").map(encodeURIComponent).join("/");
        const safeBranch = encodeURIComponent(branch);
        const branchPayload = await githubFetch(`/repos/${safeFullName}/branches/${safeBranch}`, accessToken);
        return branchPayload?.commit?.sha || null;
    } catch {
        return null;
    }
}

function scoreFromGeminiPayload(payload: any, fallback: number) {
    const score = Number(payload?.score);
    if (!Number.isFinite(score)) return fallback;
    return Math.max(0, Math.min(100, Math.round(score)));
}

function boundedScore(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 0;
}

function ratioScore(actual: unknown, target: unknown) {
    const actualNumber = Number(actual || 0);
    const targetNumber = Number(target || 0);
    if (!targetNumber) return actualNumber > 0 ? 100 : 0;
    const ratio = actualNumber / targetNumber;
    if (ratio <= 1) return boundedScore(ratio * 80);
    return boundedScore(80 + Math.min(20, (ratio - 1) * 20));
}

function weightedScore(parts: Array<{ score: number; weight: number }>) {
    const totalWeight = parts.reduce((sum, part) => sum + Math.max(0, Number(part.weight || 0)), 0);
    if (!totalWeight) return 0;
    return boundedScore(parts.reduce((sum, part) => sum + boundedScore(part.score) * Math.max(0, Number(part.weight || 0)), 0) / totalWeight);
}

const TERM_ALIASES: Record<string, string[]> = {
    nextjs: ["nextjs", "next js", "next", "next.js"],
    nodejs: ["nodejs", "node js", "node", "node.js"],
    express: ["express", "expressjs", "express js", "express.js"],
    typescript: ["typescript", "type script", "ts"],
    javascript: ["javascript", "java script", "js"],
    tailwindcss: ["tailwindcss", "tailwind css", "tailwind"],
    postgresql: ["postgresql", "postgres", "postgres sql", "pg"],
    prisma: ["prisma"],
    redis: ["redis", "upstash"],
    react: ["react", "reactjs", "react js", "react.js"],
    mongodb: ["mongodb", "mongo db", "mongo"],
    mysql: ["mysql", "my sql"],
    docker: ["docker", "dockerfile", "container"],
    websocket: ["websocket", "web socket", "ws", "socket.io", "socketio"],
    api: ["api", "apis", "rest", "restful"],
    backend: ["backend", "back end", "server", "server-side"],
    frontend: ["frontend", "front end", "client", "client-side"],
    payment: ["payment", "payments", "razorpay", "stripe", "subscription", "subscriptions", "billing"],
};

function canonicalTerm(value: unknown) {
    return String(value || "")
        .toLowerCase()
        .replace(/c\+\+/g, "cpp")
        .replace(/c#/g, "csharp")
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
        .replace(/\s+/g, " ");
}

function aliasKey(value: unknown) {
    return canonicalTerm(value).replace(/\s+/g, "");
}

function splitCriterionValue(value: unknown): string[] {
    if (Array.isArray(value)) return value.flatMap(splitCriterionValue);
    if (typeof value !== "string") return [];
    return value
        .split(/[\n,;|/]+|\s+(?:and|&|\+)\s+/gi)
        .map((item) => item.trim())
        .filter(Boolean);
}

function normalizeCriterionList(value: unknown) {
    const seen = new Set<string>();
    return splitCriterionValue(value)
        .map((item) => item.trim())
        .filter((item) => {
            const key = aliasKey(item);
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .slice(0, 30);
}

function parseGithubRepoFullName(repoUrl: string) {
    try {
        const url = new URL(repoUrl);
        if (url.hostname !== "github.com" && !url.hostname.endsWith(".github.com")) return null;
        const [owner, repoRaw] = url.pathname.split("/").filter(Boolean);
        if (!owner || !repoRaw) return null;
        const repo = repoRaw.replace(/\.git$/i, "");
        if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) return null;
        return `${owner}/${repo}`;
    } catch {
        return null;
    }
}

function normalizeAssignmentRubric(value: unknown) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const raw = Object.fromEntries(Object.entries(DEFAULT_ASSIGNMENT_RUBRIC).map(([key, fallback]) => {
        const value = Number(source[key] ?? fallback);
        return [key, Number.isFinite(value) ? Math.max(0, value) : fallback];
    })) as typeof DEFAULT_ASSIGNMENT_RUBRIC;
    const total = Object.values(raw).reduce((sum, value) => sum + value, 0);
    if (total === 100) return raw;
    if (!total) return DEFAULT_ASSIGNMENT_RUBRIC;
    const entries = Object.entries(raw).map(([key, value]) => ({
        key,
        normalized: Math.floor((value / total) * 100),
        remainder: (value / total) * 100 - Math.floor((value / total) * 100),
    }));
    let remaining = 100 - entries.reduce((sum, entry) => sum + entry.normalized, 0);
    for (const entry of entries.sort((a, b) => b.remainder - a.remainder)) {
        if (remaining <= 0) break;
        entry.normalized += 1;
        remaining -= 1;
    }
    return Object.fromEntries(entries.map((entry) => [entry.key, entry.normalized])) as typeof DEFAULT_ASSIGNMENT_RUBRIC;
}

function aliasesForTerm(term: string) {
    const canonical = canonicalTerm(term);
    const compact = aliasKey(term);
    return Array.from(new Set([
        canonical,
        compact,
        ...(TERM_ALIASES[compact] || []),
    ].map(canonicalTerm).filter(Boolean)));
}

function projectEvidenceText(project: any) {
    const repo = project?.repo || {};
    const metrics = project?.githubMetrics || {};
    const ai = project?.ai || {};
    const languages = metrics.languages && typeof metrics.languages === "object" && !Array.isArray(metrics.languages)
        ? Object.keys(metrics.languages)
        : Array.isArray(metrics.languages)
            ? metrics.languages.map((item: any) => item?.name).filter(Boolean)
            : [];
    return [
        repo.name,
        repo.fullName,
        repo.language,
        repo.description,
        ...languages,
        ai.summary,
        ...(Array.isArray(ai.strengths) ? ai.strengths : []),
        ...(Array.isArray(ai.risks) ? ai.risks : []),
    ].filter(Boolean).join(" ");
}

function termMatchesEvidence(term: string, evidenceText: string) {
    const evidence = ` ${canonicalTerm(evidenceText)} `;
    const aliases = aliasesForTerm(term);
    if (aliases.some((alias) => evidence.includes(` ${alias} `) || evidence.includes(alias))) return true;
    const tokens = canonicalTerm(term).split(" ").filter((token) => token.length > 2);
    return tokens.length > 1 && tokens.every((token) => evidence.includes(` ${token} `) || evidence.includes(token));
}

function coverageScore(terms: string[], evidenceText: string) {
    const matches = terms.filter((term) => termMatchesEvidence(term, evidenceText));
    return {
        matches,
        score: terms.length ? boundedScore((matches.length / terms.length) * 100) : 0,
    };
}

function capProjectScore(rawScore: number, parts: { stackScore: number; relevanceScore: number; ownershipScore: number; documentationScore: number; commitsScore: number }) {
    const caps: number[] = [100];
    if (parts.stackScore === 0 && parts.relevanceScore === 0) caps.push(40);
    if (parts.stackScore < 50) caps.push(60);
    if (parts.relevanceScore < 50) caps.push(70);
    if (parts.ownershipScore < 25) caps.push(65);
    if (parts.documentationScore < 15) caps.push(75);
    if (parts.commitsScore < 20) caps.push(70);
    return Math.min(boundedScore(rawScore), ...caps);
}

export function normalizeScoringConfig(value: any) {
    const source = value && typeof value === "object" ? value : {};
    const weights = source.weights || {};
    const githubWeight = Number.isFinite(Number(weights.github)) ? Math.max(0, Math.min(100, Number(weights.github))) : 60;
    const codingWeight = Number.isFinite(Number(weights.coding)) ? Math.max(0, Math.min(100, Number(weights.coding))) : 40;
    const total = githubWeight + codingWeight || 100;
    const normalizedGithubWeight = Math.round((githubWeight / total) * 100);

    return {
        weights: { github: normalizedGithubWeight, coding: 100 - normalizedGithubWeight },
        github: {
            requiredTechStack: normalizeCriterionList(source.github?.requiredTechStack),
            focusAreas: normalizeCriterionList(source.github?.focusAreas),
            minCommitsLastYear: Number(source.github?.minCommitsLastYear ?? 20),
            minCommitsLastMonth: Number(source.github?.minCommitsLastMonth ?? 2),
            minOwnershipPercent: Number(source.github?.minOwnershipPercent ?? 50),
            minProjectAgeDays: Number(source.github?.minProjectAgeDays ?? 30),
            criteriaWeights: {
                stack: Number(source.github?.criteriaWeights?.stack ?? 20),
                commits: Number(source.github?.criteriaWeights?.commits ?? 20),
                ownership: Number(source.github?.criteriaWeights?.ownership ?? 15),
                documentation: Number(source.github?.criteriaWeights?.documentation ?? 15),
                complexity: Number(source.github?.criteriaWeights?.complexity ?? 15),
                relevance: Number(source.github?.criteriaWeights?.relevance ?? 15),
            },
        },
        coding: {
            minLinkedProfiles: Number(source.coding?.minLinkedProfiles ?? 1),
            leetcode: {
                minTotal: Number(source.coding?.leetcode?.minTotal ?? 100),
                minEasy: Number(source.coding?.leetcode?.minEasy ?? 40),
                minMedium: Number(source.coding?.leetcode?.minMedium ?? 40),
                minHard: Number(source.coding?.leetcode?.minHard ?? 5),
            },
            codeforces: {
                minRating: Number(source.coding?.codeforces?.minRating ?? 1200),
                minContests: Number(source.coding?.codeforces?.minContests ?? 5),
                minSolved: Number(source.coding?.codeforces?.minSolved ?? 100),
            },
            criteriaWeights: {
                leetcode: Number(source.coding?.criteriaWeights?.leetcode ?? 45),
                codeforces: Number(source.coding?.criteriaWeights?.codeforces ?? 35),
                profileCoverage: Number(source.coding?.criteriaWeights?.profileCoverage ?? 20),
            },
        },
    };
}

export function projectScoreBreakdownForJob(project: any, config: ReturnType<typeof normalizeScoringConfig>, job: any) {
    const repo = project?.repo || {};
    if (project?.skipped || repo.fork) {
        return {
            title: repo.fullName || repo.name || "Selected project",
            score: 0,
            status: "Skipped",
            summary: "Forked repositories are scored as zero for original project work.",
            breakdown: [
                { label: "Ownership", score: 0, weight: 100, note: "Forked repositories are scored as zero for original project work." },
            ],
        };
    }
    const metrics = project?.githubMetrics || {};
    const ai = project?.ai || {};
    const evidenceText = projectEvidenceText(project);
    const requiredStack = config.github.requiredTechStack.length ? config.github.requiredTechStack : normalizeCriterionList(job.skills);
    const stackCoverage = coverageScore(requiredStack, evidenceText);
    const stackScore = requiredStack.length ? stackCoverage.score : boundedScore(ai.score || project.score);
    const commitsScore = weightedScore([
        { score: ratioScore(metrics.commitsLastYear, config.github.minCommitsLastYear), weight: 70 },
        { score: ratioScore(metrics.commitsLastMonth, config.github.minCommitsLastMonth), weight: 30 },
    ]);
    const ownershipScore = ratioScore(metrics.userContributionPercent, config.github.minOwnershipPercent);
    const documentationScore = boundedScore(ai.documentation);
    const complexityScore = weightedScore([
        { score: boundedScore(ai.difficulty), weight: 50 },
        { score: boundedScore(ai.originality), weight: 50 },
    ]);
    const focus = config.github.focusAreas.length
        ? config.github.focusAreas
        : [...normalizeCriterionList(job.skills), ...normalizeCriterionList(Array.isArray(job.responsibilities) ? job.responsibilities.slice(0, 4) : [])];
    const relevanceCoverage = coverageScore(focus, evidenceText);
    const relevanceScore = focus.length ? relevanceCoverage.score : boundedScore(ai.score || project.score);
    const breakdown = [
        { score: stackScore, weight: config.github.criteriaWeights.stack },
        { score: commitsScore, weight: config.github.criteriaWeights.commits },
        { score: ownershipScore, weight: config.github.criteriaWeights.ownership },
        { score: documentationScore, weight: config.github.criteriaWeights.documentation },
        { score: complexityScore, weight: config.github.criteriaWeights.complexity },
        { score: relevanceScore, weight: config.github.criteriaWeights.relevance },
    ];
    const rawScore = weightedScore(breakdown);
    const finalScore = capProjectScore(rawScore, { stackScore, relevanceScore, ownershipScore, documentationScore, commitsScore });

    return {
        title: repo.fullName || repo.name || "Selected project",
        score: finalScore,
        status: "Scored",
        summary: String(ai.summary || repo.description || "Project evaluated against the company's GitHub scorecard."),
       
        rawScore,
    };
}

export function projectScoreForJob(project: any, config: ReturnType<typeof normalizeScoringConfig>, job: any) {
    return projectScoreBreakdownForJob(project, config, job).score;
}

export function codingScorecardForJob(codingAnalysis: any, codingProfiles: Record<string, string | null>, config: ReturnType<typeof normalizeScoringConfig>) {
    const leetcode = codingAnalysis?.platforms?.leetcode || {};
    const codeforces = codingAnalysis?.platforms?.codeforces || {};
    const linkedCount = Object.values(codingProfiles).filter(Boolean).length;
    const leetcodeScore = weightedScore([
        { score: ratioScore(leetcode.solvedCount, config.coding.leetcode.minTotal), weight: 40 },
        { score: ratioScore(leetcode.easy, config.coding.leetcode.minEasy), weight: 15 },
        { score: ratioScore(leetcode.medium, config.coding.leetcode.minMedium), weight: 30 },
        { score: ratioScore(leetcode.hard, config.coding.leetcode.minHard), weight: 15 },
    ]);
    const codeforcesScore = weightedScore([
        { score: ratioScore(codeforces.rating, config.coding.codeforces.minRating), weight: 45 },
        { score: ratioScore(codeforces.contests, config.coding.codeforces.minContests), weight: 25 },
        { score: ratioScore(codeforces.solvedCount, config.coding.codeforces.minSolved), weight: 30 },
    ]);
    const coverageScore = ratioScore(linkedCount, config.coding.minLinkedProfiles);
    const breakdown = [
        {
            label: "LeetCode",
            score: leetcodeScore,
            weight: config.coding.criteriaWeights.leetcode,
            note: `${leetcode.solvedCount || 0} total (${leetcode.easy || 0} easy, ${leetcode.medium || 0} medium, ${leetcode.hard || 0} hard) against targets ${config.coding.leetcode.minTotal}/${config.coding.leetcode.minEasy}/${config.coding.leetcode.minMedium}/${config.coding.leetcode.minHard}.`,
        },
        {
            label: "Codeforces",
            score: codeforcesScore,
            weight: config.coding.criteriaWeights.codeforces,
            note: `Rating ${codeforces.rating || 0}, ${codeforces.contests || 0} contest(s), ${codeforces.solvedCount || 0} solved against targets ${config.coding.codeforces.minRating}/${config.coding.codeforces.minContests}/${config.coding.codeforces.minSolved}.`,
        },
        {
            label: "Profile coverage",
            score: coverageScore,
            weight: config.coding.criteriaWeights.profileCoverage,
            note: `${linkedCount}/${config.coding.minLinkedProfiles} expected coding profile(s) connected.`,
        },
    ];
    return {
        score: weightedScore(breakdown),
        breakdown,
        linkedCount,
    };
}

export function codingScoreForJob(codingAnalysis: any, codingProfiles: Record<string, string | null>, config: ReturnType<typeof normalizeScoringConfig>) {
    return codingScorecardForJob(codingAnalysis, codingProfiles, config).score;
}

async function fetchRepoPathSignals(repo: z.infer<typeof selectedProjectSchema>, accessToken: string) {
    const headSha = await getRepoHeadSha(repo.fullName, repo.defaultBranch, accessToken);
    if (!headSha) {
        return {
            headSha,
            paths: [] as string[],
            sourceFiles: 0,
            testFiles: 0,
            hasReadme: false,
            hasEnvExample: false,
            schemaFiles: 0,
        };
    }

    const safeFullName = repo.fullName.split("/").map(encodeURIComponent).join("/");
    const tree = await githubFetch(`/repos/${safeFullName}/git/trees/${encodeURIComponent(headSha)}?recursive=1`, accessToken).catch(() => null);
    const paths = Array.isArray(tree?.tree)
        ? tree.tree.map((node: any) => String(node?.path || "").toLowerCase()).filter(Boolean).slice(0, 1200)
        : [];

    return {
        headSha,
        paths,
        sourceFiles: paths.filter((path) => /(^|\/)(src|app|server|api|lib)\//.test(path) && /\.(ts|tsx|js|jsx|py|go|rs|java|sql)$/.test(path)).length,
        testFiles: paths.filter((path) => /(__tests__|\.test\.|\.spec\.|(^|\/)tests?\/)/.test(path)).length,
        hasReadme: paths.some((path) => /(^|\/)readme\.md$/.test(path)),
        hasEnvExample: paths.some((path) => /(^|\/)\.env\.example$/.test(path)),
        schemaFiles: paths.filter((path) => /(schema\.sql|prisma\/schema\.prisma|migrations?\/|drizzle|typeorm)/.test(path)).length,
    };
}

function assignmentProjectEvidenceText(projectAnalysis: any, signals: Awaited<ReturnType<typeof fetchRepoPathSignals>>) {
    const repo = projectAnalysis?.repo || {};
    const metrics = projectAnalysis?.githubMetrics || {};
    const languages = metrics.languages && typeof metrics.languages === "object" && !Array.isArray(metrics.languages)
        ? Object.keys(metrics.languages)
        : Array.isArray(metrics.languages)
            ? metrics.languages.map((item: any) => item?.name || item).filter(Boolean)
            : [];
    return [
        repo.name,
        repo.fullName,
        repo.language,
        repo.description,
        ...languages,
        metrics.readmeExcerpt,
        ...(Array.isArray(metrics.commitMessages) ? metrics.commitMessages.slice(0, 80) : []),
        signals.paths.slice(0, 250).join(" "),
    ].filter(Boolean).join(" ");
}

function pathCount(signals: Awaited<ReturnType<typeof fetchRepoPathSignals>>, pattern: RegExp) {
    return signals.paths.filter((path) => pattern.test(path)).length;
}

function assignmentStructuralSignals(projectAnalysis: any, signals: Awaited<ReturnType<typeof fetchRepoPathSignals>>) {
    const metrics = projectAnalysis?.githubMetrics || {};
    return {
        sourceFiles: signals.sourceFiles,
        testFiles: signals.testFiles,
        schemaFiles: signals.schemaFiles,
        hasReadme: signals.hasReadme,
        hasEnvExample: signals.hasEnvExample,
        readmeLength: Number(metrics.readmeLength || 0),
        commitCount: Number(metrics.commitsLastYear || 0),
        recentCommitCount: Number(metrics.commitsLastMonth || 0),
        ownershipPercent: Number(metrics.userContributionPercent ?? 0),
        apiFiles: pathCount(signals, /(^|\/)(api|routes|controllers|server|webhook|handlers?)\//),
        configFiles: pathCount(signals, /(^|\/)(package\.json|tsconfig|eslint|prettier|dockerfile|docker-compose|\.github\/workflows|vercel\.json|next\.config|vite\.config)/),
        docsFiles: pathCount(signals, /(^|\/)(docs?|readme|thinking|schema|architecture|design|decisions?)[^/]*\.(md|sql|txt)$/),
    };
}

function capAssignmentScore(rawScore: number, parts: { functionalityScore: number; taskScore: number; deliverableScore: number; sourceFiles: number; hasReadme: boolean }) {
    const caps: number[] = [100];
    if (parts.functionalityScore < 25) caps.push(55);
    if (parts.taskScore < 25 && parts.deliverableScore < 40) caps.push(45);
    if (parts.sourceFiles < 3) caps.push(50);
    if (!parts.hasReadme) caps.push(75);
    return Math.min(boundedScore(rawScore), ...caps);
}

function assignmentScorecardForProject({
    assignment,
    projectAnalysis,
    signals,
}: {
    assignment: any;
    projectAnalysis: any;
    signals: Awaited<ReturnType<typeof fetchRepoPathSignals>>;
}) {
    const rubric = normalizeAssignmentRubric(assignment.rubric);
    const repo = projectAnalysis?.repo || {};
    if (projectAnalysis?.skipped || repo.fork) {
        const rubricItems = Object.entries(rubric).map(([label, weight]) => ({
            label,
            score: 0,
            weight,
            evidence: "Forked repositories are not accepted as original technical assignment submissions.",
        }));
        return {
            score: 0,
            rubric: rubricItems,
            summary: "Forked repository submitted; assignment score is zero by policy.",
            strengths: [],
            risks: ["Submitted repository is forked, so original assignment work cannot be verified."],
            metrics: { forked: true },
        };
    }

    const metrics = projectAnalysis?.githubMetrics || {};
    const evidenceText = assignmentProjectEvidenceText(projectAnalysis, signals);
    const structural = assignmentStructuralSignals(projectAnalysis, signals);
    const tasks = normalizeCriterionList(assignment.tasks);
    const deliverables = normalizeCriterionList(assignment.deliverables);
    const constraints = normalizeCriterionList(assignment.constraints);
    const allowedStack = normalizeCriterionList(assignment.allowedStack);
    const thinkingQuestions = normalizeCriterionList(assignment.thinkingQuestions);
    const scenarioTerms = normalizeCriterionList([assignment.overview, assignment.scenario]);
    const taskCoverage = coverageScore(tasks, evidenceText);
    const deliverableCoverage = coverageScore(deliverables, evidenceText);
    const constraintCoverage = coverageScore(constraints, evidenceText);
    const stackCoverage = coverageScore(allowedStack, evidenceText);
    const thinkingCoverage = coverageScore(thinkingQuestions, evidenceText);
    const scenarioCoverage = coverageScore(scenarioTerms, evidenceText);
    const commitsScore = weightedScore([
        { score: ratioScore(metrics.commitsLastYear, 8), weight: 60 },
        { score: ratioScore(metrics.commitsLastMonth, 2), weight: 40 },
    ]);
    const testingScore = weightedScore([
        { score: ratioScore(signals.testFiles, 3), weight: 80 },
        { score: termMatchesEvidence("test", evidenceText) ? 100 : 0, weight: 20 },
    ]);
    const documentationScore = weightedScore([
        { score: signals.hasReadme ? 100 : 0, weight: 35 },
        { score: ratioScore(structural.readmeLength, 1500), weight: 25 },
        { score: ratioScore(structural.docsFiles, 3), weight: 20 },
        { score: signals.hasEnvExample ? 100 : 0, weight: 20 },
    ]);
    const architectureScore = weightedScore([
        { score: allowedStack.length ? stackCoverage.score : ratioScore(signals.sourceFiles, 10), weight: 35 },
        { score: ratioScore(signals.sourceFiles, 12), weight: 25 },
        { score: ratioScore(structural.apiFiles, 2), weight: 15 },
        { score: ratioScore(signals.schemaFiles, 1), weight: 15 },
        { score: ratioScore(structural.configFiles, 3), weight: 10 },
    ]);
    const functionalityScore = weightedScore([
        { score: tasks.length ? taskCoverage.score : ratioScore(signals.sourceFiles, 10), weight: 45 },
        { score: deliverables.length ? deliverableCoverage.score : documentationScore, weight: 30 },
        { score: ratioScore(signals.sourceFiles, 10), weight: 15 },
        { score: commitsScore, weight: 10 },
    ]);
    const codeQualityScore = weightedScore([
        { score: commitsScore, weight: 30 },
        { score: ratioScore(metrics.userContributionPercent, 100), weight: 25 },
        { score: ratioScore(signals.sourceFiles, 12), weight: 20 },
        { score: testingScore, weight: 15 },
        { score: signals.hasEnvExample ? 100 : 0, weight: 10 },
    ]);
    const productThinkingScore = weightedScore([
        { score: thinkingQuestions.length ? thinkingCoverage.score : documentationScore, weight: 45 },
        { score: scenarioTerms.length ? scenarioCoverage.score : ratioScore(structural.docsFiles, 2), weight: 35 },
        { score: documentationScore, weight: 20 },
    ]);
    const securityScore = weightedScore([
        { score: constraints.length ? constraintCoverage.score : 50, weight: 45 },
        { score: signals.hasEnvExample ? 100 : 0, weight: 25 },
        { score: termMatchesEvidence("auth", evidenceText) || termMatchesEvidence("validation", evidenceText) || termMatchesEvidence("security", evidenceText) ? 85 : 35, weight: 30 },
    ]);

    const rubricItems = [
        { label: "Functionality", score: functionalityScore, weight: rubric.functionality, evidence: `${taskCoverage.matches.length}/${tasks.length || 0} task signals and ${deliverableCoverage.matches.length}/${deliverables.length || 0} deliverable signals matched.` },
        { label: "Architecture", score: architectureScore, weight: rubric.architecture, evidence: `${stackCoverage.matches.length}/${allowedStack.length || 0} required stack signals matched; ${signals.sourceFiles} source files detected.` },
        { label: "Code quality", score: codeQualityScore, weight: rubric.codeQuality, evidence: `${metrics.commitsLastYear || 0} yearly commits, ${signals.sourceFiles} source files, ${signals.testFiles} test files, ${Math.round(metrics.userContributionPercent || 0)}% ownership.` },
        { label: "Documentation", score: documentationScore, weight: rubric.documentation, evidence: `README ${signals.hasReadme ? "present" : "missing"} (${structural.readmeLength} chars); .env.example ${signals.hasEnvExample ? "present" : "missing"}; ${structural.docsFiles} docs/schema file(s).` },
        { label: "Testing", score: testingScore, weight: rubric.testing, evidence: `${signals.testFiles} test/spec file(s) detected.` },
        { label: "Product thinking", score: productThinkingScore, weight: rubric.productThinking, evidence: `${thinkingCoverage.matches.length}/${thinkingQuestions.length || 0} thinking question signals and ${scenarioCoverage.matches.length}/${scenarioTerms.length || 0} scenario signals matched.` },
        { label: "Security", score: securityScore, weight: rubric.security, evidence: `${constraintCoverage.matches.length}/${constraints.length || 0} constraint signals matched; environment template ${signals.hasEnvExample ? "present" : "missing"}.` },
    ];
    const score = capAssignmentScore(weightedScore(rubricItems), {
        functionalityScore,
        taskScore: taskCoverage.score,
        deliverableScore: deliverableCoverage.score,
        sourceFiles: signals.sourceFiles,
        hasReadme: signals.hasReadme,
    });

    return {
        score,
        rubric: rubricItems,
        summary: "Technical assignment repository evaluated using the frozen assignment rubric and deterministic repository evidence.",
        strengths: [
            signals.hasReadme ? "README is present." : "",
            signals.testFiles > 0 ? `${signals.testFiles} test/spec file(s) detected.` : "",
            signals.sourceFiles > 0 ? `${signals.sourceFiles} source file(s) detected.` : "",
        ].filter(Boolean),
        risks: [
            taskCoverage.score < 50 ? "Low task-signal coverage against the assignment brief." : "",
            deliverableCoverage.score < 50 ? "Some required deliverables were not detected." : "",
            !signals.hasReadme ? "README is missing." : "",
        ].filter(Boolean),
        metrics: {
            scoringVersion: 2,
            forked: false,
            commitsLastYear: metrics.commitsLastYear || 0,
            commitsLastMonth: metrics.commitsLastMonth || 0,
            ownershipPercent: metrics.userContributionPercent || 0,
            testFiles: signals.testFiles,
            sourceFiles: signals.sourceFiles,
            hasReadme: signals.hasReadme,
            hasEnvExample: signals.hasEnvExample,
            headSha: signals.headSha,
            readmeLength: structural.readmeLength,
            apiFiles: structural.apiFiles,
            configFiles: structural.configFiles,
            docsFiles: structural.docsFiles,
            matchedStack: stackCoverage.matches,
            matchedTasks: taskCoverage.matches,
            matchedDeliverables: deliverableCoverage.matches,
            matchedConstraints: constraintCoverage.matches,
            matchedThinking: thinkingCoverage.matches,
        },
    };
}

async function buildTechnicalAssignmentReport({
    assignment,
    projectAnalysis,
    scorecard,
}: {
    assignment: any;
    projectAnalysis: any;
    scorecard: ReturnType<typeof assignmentScorecardForProject>;
}) {
    const fallback = {
        summary: scorecard.summary,
        strengths: scorecard.strengths,
        risks: scorecard.risks,
    };
    const aiBrief = await runReportAgent(
        "Technical Assignment Evaluation Agent",
        `Create a recruiter-ready technical assignment report for this one submitted repository.

Hard rules:
- The numeric score and rubric scores in the deterministic scorecard are final. Do not change them.
- Explain why the repo earned those scores against the company assignment brief.
- Do not invent code details, files, tests, or behavior not present in the evidence.
- Use only deterministicScorecard.rubric, deterministicScorecard.metrics, and repository metadata as evidence.
- If a detail is not present in those fields, say it was not detected.
- Keep the summary under 80 words.

Output JSON with: summary, strengths[], risks[].`,
        {
            assignment: {
                title: assignment.title,
                overview: assignment.overview,
                tasks: assignment.tasks,
                constraints: assignment.constraints,
                allowedStack: assignment.allowedStack,
                deliverables: assignment.deliverables,
                thinkingQuestions: assignment.thinkingQuestions,
            },
            repository: projectAnalysis?.repo,
            deterministicScorecard: scorecard,
            projectMetrics: projectAnalysis?.githubMetrics || null,
        },
        fallback
    );

    return {
        version: 1,
        generatedAt: new Date().toISOString(),
        model: GEMINI_MODEL,
        summary: typeof aiBrief.summary === "string" && aiBrief.summary.trim() ? aiBrief.summary : fallback.summary,
        strengths: Array.isArray(aiBrief.strengths) ? aiBrief.strengths.map(String).filter(Boolean).slice(0, 6) : fallback.strengths,
        risks: Array.isArray(aiBrief.risks) ? aiBrief.risks.map(String).filter(Boolean).slice(0, 6) : fallback.risks,
        rubric: scorecard.rubric,
        metrics: scorecard.metrics,
        repository: projectAnalysis?.repo || null,
    };
}

function safeJson(text: string | undefined | null) {
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch {
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) return null;
        try {
            return JSON.parse(match[0]);
        } catch {
            return null;
        }
    }
}

async function runReportAgent(agent: string, task: string, evidence: Record<string, unknown>, fallback: Record<string, unknown>) {
    try {
        const result = await getGeminiClient().models.generateContent({
            model: GEMINI_MODEL,
            contents: [{
                role: "user",
                parts: [{
                    text: `You are the ${agent} for a recruiter screening report. Return strict JSON only.

Task:
${task}

Rules:
- Evaluate only against the job opening and company scorecard in the evidence.
- Be concise and point-to-point.
- Do not invent facts not present in the evidence.
- Do not copy the candidate's headline, self-written bio, or skill list verbatim.
- Interpret evidence. Do not concatenate raw profile fields.
- Scores must be 0-100.
- If evidence is missing, lower the score and say exactly what is missing.
- Deterministic scorecard values in the evidence are the numerical authority. Explain them; do not contradict or inflate beyond them.
- Avoid long paragraphs. Prefer short arrays and chart-ready data.

Evidence:
${JSON.stringify(evidence, null, 2)}`,
                }],
            }],
            config: { responseMimeType: "application/json", temperature: 0 },
        });
        return safeJson(result.text) || fallback;
    } catch {
        return fallback;
    }
}

function profileEvidence(profile: any) {
    return {
        headline: profile?.headline || null,
        industry: profile?.industry || null,
        location: [profile?.city, profile?.country].filter(Boolean).join(", ") || null,
        about: profile?.about ? String(profile.about).slice(0, 1200) : null,
        openTo: profile?.openTo || null,
        skills: Array.isArray(profile?.skills) ? profile.skills.slice(0, 40) : [],
        experiences: Array.isArray(profile?.experiences) ? profile.experiences.slice(0, 8) : [],
        education: Array.isArray(profile?.education) ? profile.education.slice(0, 6) : [],
        projects: Array.isArray(profile?.projects) ? profile.projects.slice(0, 8) : [],
    };
}

export function buildEvidencePack({
    job,
    profile,
    selectedProjects,
    githubProfileSnapshot,
    projectAnalyses,
    projectSlotScores,
    codingProfiles,
    codingAnalysis,
    scoringConfig,
    githubScore,
    codingScore,
    overallScore,
}: {
    job: any;
    profile: any;
    selectedProjects: any[];
    githubProfileSnapshot: any;
    projectAnalyses: any[];
    projectSlotScores: number[];
    codingProfiles: Record<string, string | null>;
    codingAnalysis: any;
    scoringConfig: ReturnType<typeof normalizeScoringConfig>;
    githubScore: number;
    codingScore: number;
    overallScore: number;
}) {
    return {
        version: 1,
        builtAt: new Date().toISOString(),
        job: {
            id: job.id,
            title: job.title,
            companyName: job.companyName,
            workMode: job.workMode,
            employmentType: job.employmentType,
            roleType: job.roleType,
            experienceLevel: job.experienceLevel,
            skills: job.skills,
            aboutRole: job.aboutRole,
            responsibilities: job.responsibilities,
            requirements: job.requirements,
            benefits: job.benefits,
        },
        scoringConfig,
        deterministicScores: {
            overallScore,
            githubScore,
            codingScore,
            githubWeight: scoringConfig.weights.github,
            codingWeight: scoringConfig.weights.coding,
        },
        profile: profileEvidence(profile),
        selectedProjects,
        github: {
            snapshot: {
                totalRepos: githubProfileSnapshot?.totalRepos,
                forkedRepos: githubProfileSnapshot?.forkedRepos,
                privateReposInScope: githubProfileSnapshot?.privateReposInScope,
                contributionsLastYear: githubProfileSnapshot?.contributionsLastYear,
                contributionsLastMonth: githubProfileSnapshot?.contributionsLastMonth,
            },
            projects: projectAnalyses.map((project, index) => ({
                repo: project.repo,
                score: project.score,
                slotScore: projectSlotScores[index] ?? project.score,
                skipped: project.skipped,
                reason: project.reason,
                githubMetrics: project.githubMetrics,
                ai: project.ai,
            })),
        },
        codingProfiles,
        codingAnalysis,
    };
}

export async function buildRecruiterAgentAnalysis(evidence: Record<string, unknown>) {
    async function runIsolatedProjectQualityAgents() {
        const github = (evidence as any).github || {};
        const projects = Array.isArray(github.projects) ? github.projects : [];
        const scoringConfig = (evidence as any).scoringConfig || {};
        const job = (evidence as any).job || {};
        const perProjectWeight = Math.round((Number(scoringConfig?.weights?.github || 60) || 60) / 3);

        const makeSlot = (slotIndex: number, project: any, patch: Record<string, unknown>) => {
            const deterministicScore = boundedScore(project?.slotScore ?? project?.score ?? 0);
            const modelScore = Number.isFinite(Number(patch.score)) ? boundedScore(Number(patch.score)) : deterministicScore;
            const score = project ? Math.min(modelScore, Math.min(100, deterministicScore + 5)) : modelScore;
            return {
                slot: slotIndex + 1,
                title: project?.repo?.fullName || project?.repo?.name || `Project slot ${slotIndex + 1}`,
                score,
                deterministicScore,
                status: String(patch.status || (project ? "scored" : "missing")),
                slotVerdict: String(patch.slotVerdict || patch.reason || ""),
                criteria: Array.isArray(patch.criteria) ? patch.criteria : [],
                qualityBars: Array.isArray(patch.qualityBars) ? patch.qualityBars : [],
                evidence: Array.isArray(patch.evidence) ? patch.evidence : [],
                risks: Array.isArray(patch.risks) ? patch.risks : [],
            };
        };

        const slots = await Promise.all([0, 1, 2].map(async (slotIndex) => {
            const project = projects[slotIndex];
            if (!project) {
                return makeSlot(slotIndex, null, {
                    score: 0,
                    status: "missing",
                    slotVerdict: "No project submitted for this slot, so it contributes 0 by rule.",
                    risks: ["Candidate submitted fewer than 3 projects."],
                });
            }

            if (project.skipped || project?.repo?.fork) {
                return makeSlot(slotIndex, project, {
                    score: 0,
                    status: "forked",
                    slotVerdict: "Forked repositories score 0 because original ownership cannot be established.",
                    risks: ["Forked repository excluded by company scoring rule."],
                });
            }

            const isolatedEvidence = {
                slot: slotIndex + 1,
                perProjectWeight,
                job,
                scoringConfig: {
                    githubWeight: scoringConfig?.weights?.github,
                    github: scoringConfig?.github,
                },
                project: {
                    repo: project.repo,
                    deterministicSlotScore: project.slotScore,
                    githubMetrics: project.githubMetrics,
                    ai: project.ai,
                },
            };

            const result = await runReportAgent(
                `Project Slot ${slotIndex + 1} Isolated Quality Agent`,
                `Evaluate ONE project in a sealed context. You do not know whether the candidate submitted other projects.

Judge this project only against the company scoring config and this job's responsibilities.

Hard rules:
- Never mention or compare against other candidate projects.
- The deterministicSlotScore is the scorecard authority. Your score must stay within +5 points of it and should be lower if evidence is weak.
- If this project is backend-only for a full-stack/front-end-heavy role, cap stack/domain fit honestly.
- Score against company criteria, not generic repo polish.
- Do not inflate a project above the scorecard when stack, domain fit, ownership, docs, or commit maturity are weak.
- Cite concrete evidence from this project: stack, README/docs, commits, ownership, age, languages, risks.

Return strict JSON with:
{
  "score": number,
  "status": "scored",
  "slotVerdict": "one sentence describing what this single project proves for this role",
  "criteria": [{"label":"Stack match|Commit health|Ownership|Documentation|Complexity|Domain fit","score":number,"evidence":"short evidence","risks":["short risk"]}],
  "qualityBars": [{"label":"Stack","value":number},{"label":"Commits","value":number},{"label":"Ownership","value":number},{"label":"Docs","value":number},{"label":"Role fit","value":number}],
  "evidence": ["2-4 specific positive evidence points"],
  "risks": ["1-3 role-specific risks or missing evidence"]
}`,
                isolatedEvidence,
                {
                    score: project.slotScore ?? project.score ?? 0,
                    status: "scored",
                    slotVerdict: "Project evaluated using deterministic scoring because isolated AI analysis was unavailable.",
                    criteria: [],
                    qualityBars: [],
                    evidence: [],
                    risks: ["Isolated project agent did not return analysis."],
                }
            );

            return makeSlot(slotIndex, project, result);
        }));

        const projectQualityScore = boundedScore(slots.reduce((sum, slot) => sum + slot.score, 0) / 3);
        return {
            projectQualityScore,
            isolationModel: "one sealed Gemini agent per submitted project slot; missing and forked slots are deterministic 0 without AI calls",
            slots,
            graphData: slots.map((slot) => ({ label: `Slot ${slot.slot}`, value: slot.score })),
        };
    }

    const [profileSummary, projectQuality, techStackMatch, domainRelevance, codingProfile] = await Promise.all([
        runReportAgent(
            "Candidate Summary Agent",
            `You are not summarizing the candidate generally. You are briefing a recruiter for this exact role.

Use the job title, responsibilities, required stack, focus areas, GitHub score, coding score, and candidate profile as the lens. Ignore profile details that do not help this role.

Hard output rules:
- Never repeat the candidate headline, self-written bio, location line, or skill list verbatim.
- Do not write "Headline:", "Top skills:", "Open to:", or field-label summaries.
- Do not truncate copied text. If you cannot synthesize, return a gap.
- Name at least one honest gap for this role.
- Every strength must tie to a job requirement or score signal.

Output strict JSON with:
{
  "profileScore": number,
  "oneLineVerdict": "max 18 words, job-specific recruiter verdict",
  "relevantStrengths": ["2-3 role-specific strengths, not skill lists"],
  "gapsForThisRole": ["1-2 role-specific gaps or missing evidence"],
  "signalNotInResume": "one useful inference from scores/projects/profile, not copied text",
  "chartData": [{"label":"Profile fit","value":number},{"label":"Role evidence","value":number},{"label":"Risk","value":number}]
}`,
            evidence,
            { profileScore: 0, oneLineVerdict: "Profile briefing unavailable.", relevantStrengths: [], gapsForThisRole: ["Profile evidence unavailable."], signalNotInResume: "", chartData: [] }
        ),
        runIsolatedProjectQualityAgents(),
        runReportAgent(
            "Tech Stack Match Agent",
            `Compare the job's required stack and responsibilities against detected project languages, repo metadata, README/AI summaries, and package/stack evidence available in the evidence pack. Output JSON with: stackMatchScore, technologies[{name,required,matched,coverage,projects[]}], missingCriticalStack[], graphData[{label,value}].`,
            evidence,
            { stackMatchScore: 0, technologies: [], missingCriticalStack: [], graphData: [] }
        ),
        runReportAgent(
            "Domain Relevance Agent",
            `Evaluate whether the selected projects genuinely match this job's product/domain and responsibilities. Penalize generic CRUD/tutorial apps when the company needs specialized domain expertise. Output JSON with: domainScore, domainCoverage[{domainOrResponsibility,coverage,projects,evidence}], genericProjectRisks[], graphData[{label,value}].`,
            evidence,
            { domainScore: 0, domainCoverage: [], genericProjectRisks: [], graphData: [] }
        ),
        runReportAgent(
            "Coding Profile Agent",
            `Evaluate coding profiles against the company thresholds. Use LeetCode easy/medium/hard, Codeforces rating/contests/solved, linked platform count, and recency if available.

Hard rules:
- Every score must be normalized 0-100. Never output raw counts as scores like "276/100".
- If a candidate exceeds a target, cap the score at 100 and explain it as "138% of target" in reason/observed text.
- Penalize missing required platforms and below-threshold ratings even when solved counts are high.

Output JSON with: codingScore, platformBreakdown[{platform,score,observed,target,reason}], difficultyMix[{label,value}], thresholdGaps[], graphData[{label,value}].`,
            evidence,
            { codingScore: 0, platformBreakdown: [], difficultyMix: [], thresholdGaps: [], graphData: [] }
        ),
    ]);

    const specialists = {
        profileSummary,
        projectQuality,
        techStackMatch,
        domainRelevance,
        codingProfile,
    };

    const finalSynthesis = await runReportAgent(
        "Final Synthesis Agent",
        `Read the evidence pack and all specialist agent outputs. Produce the final recruiter verdict for this exact job. Output JSON with: overallScore, recommendation, hireReasons[], rejectReasons[], interviewFocus[], onePageSummary[], visualSummary[{label,value}], confidence. Do not repeat specialist text; synthesize.`,
        { evidence, specialists },
        { overallScore: (evidence as any).deterministicScores?.overallScore || 0, recommendation: "Review manually.", hireReasons: [], rejectReasons: [], interviewFocus: [], onePageSummary: [], visualSummary: [], confidence: "low" }
    );

    return {
        version: 2,
        generatedAt: new Date().toISOString(),
        model: GEMINI_MODEL,
        scorecard: (evidence as any).deterministicScores,
        agents: {
            ...specialists,
            finalSynthesis,
        },
    };
}

async function analyzeProject({
    userId,
    githubUsername,
    accessToken,
    project,
}: {
    userId: string;
    githubUsername: string | null | undefined;
    accessToken: string;
    project: z.infer<typeof selectedProjectSchema>;
}) {
    const repoFullName = project.fullName;
    const safeFullName = repoFullName.split("/").map(encodeURIComponent).join("/");
    const repo = await githubFetch(`/repos/${safeFullName}`, accessToken);
    const normalized = normalizeRepo(repo);
    const headSha = await getRepoHeadSha(repoFullName, normalized.defaultBranch, accessToken);

    const cached = headSha
        ? await gitHubProjectAnalysis.findUnique({
            where: {
                userId_repoFullName_headSha: {
                    userId,
                    repoFullName,
                    headSha,
                },
            },
        })
        : null;

    const cachedMetrics = cached?.analysis?.githubMetrics;
    const cachedHasDeterministicAssignmentInputs =
        cachedMetrics &&
        typeof cachedMetrics.readmeLength === "number" &&
        Array.isArray(cachedMetrics.commitMessages);
    if (cached && cachedHasDeterministicAssignmentInputs) return cached.analysis;

    if (normalized.fork) {
        const analysis = {
            repo: normalized,
            score: 0,
            skipped: true,
            reason: "Forked repositories are not scored for original project quality.",
            analyzedAt: new Date().toISOString(),
        };

        const data = {
            userId,
            repoFullName,
            repoNodeId: normalized.nodeId,
            defaultBranch: normalized.defaultBranch,
            headSha,
            isFork: true,
            score: 0,
            analysis,
        };
        if (headSha) {
            await gitHubProjectAnalysis.upsert({
                where: {
                    userId_repoFullName_headSha: {
                        userId,
                        repoFullName,
                        headSha,
                    },
                },
                create: data,
                update: {
                    repoNodeId: normalized.nodeId,
                    defaultBranch: normalized.defaultBranch,
                    isFork: true,
                    score: 0,
                    analysis,
                },
            });
        } else {
            await gitHubProjectAnalysis.create({
                data,
            });
        }

        return analysis;
    }

    const sinceYear = new Date(Date.now() - 365 * 86_400_000).toISOString();
    const sinceMonth = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const [languages, contributors, commitsYear, commitsMonth, readme] = await Promise.all([
        githubFetch(`/repos/${safeFullName}/languages`, accessToken).catch(() => ({})),
        githubFetch(`/repos/${safeFullName}/contributors?per_page=100`, accessToken).catch(() => []),
        githubFetchPages(`/repos/${safeFullName}/commits?since=${encodeURIComponent(sinceYear)}`, accessToken, 5).catch(() => []),
        githubFetchPages(`/repos/${safeFullName}/commits?since=${encodeURIComponent(sinceMonth)}`, accessToken, 2).catch(() => []),
        githubFetch(`/repos/${safeFullName}/readme`, accessToken).catch(() => null),
    ]);

    const userContributor = Array.isArray(contributors)
        ? contributors.find((item: any) => item?.login?.toLowerCase() === githubUsername?.toLowerCase())
        : null;
    const totalContributions = Array.isArray(contributors)
        ? contributors.reduce((sum: number, item: any) => sum + Number(item?.contributions || 0), 0)
        : 0;
    const userContributionPercent = totalContributions > 0
        ? Math.round((Number(userContributor?.contributions || 0) / totalContributions) * 100)
        : 100;

    const readmeText = readme?.content
        ? Buffer.from(readme.content, "base64").toString("utf8").slice(0, 12000)
        : "";
    const commitMessages = Array.isArray(commitsYear)
        ? commitsYear.slice(0, 80).map((commit: any) => commit?.commit?.message).filter(Boolean)
        : [];
    const fallbackScore = Math.max(
        25,
        Math.min(88, 35 + Math.min(commitMessages.length, 40) + Math.min(Object.keys(languages || {}).length * 4, 16) + Math.min(userContributionPercent / 2, 25))
    );

    let aiPayload: any = null;
    try {
        const result = await getGeminiClient().models.generateContent({
            model: GEMINI_MODEL,
            contents: [{
                role: "user",
                parts: [{
                    text: `Return strict JSON only. Score this GitHub project for recruiter screening from 0-100. Consider project difficulty in the AI era, originality, architecture, documentation, commit quality, maintainability, and whether it looks like a trivial tutorial/ecommerce/weather/blog clone.

Project metadata:
${JSON.stringify({
    repo: normalized,
    languages,
    contributors: Array.isArray(contributors) ? contributors.slice(0, 20).map((c: any) => ({ login: c.login, contributions: c.contributions })) : [],
    userContributionPercent,
    commitsLastYear: Array.isArray(commitsYear) ? commitsYear.length : 0,
    commitsLastMonth: Array.isArray(commitsMonth) ? commitsMonth.length : 0,
    commitMessages,
    readme: readmeText,
}, null, 2)}

JSON shape:
{"score":number,"difficulty":number,"originality":number,"documentation":number,"commitQuality":number,"ownership":number,"summary":"string","risks":["string"],"strengths":["string"]}`
                }],
            }],
            config: { responseMimeType: "application/json", temperature: 0 },
        });
        aiPayload = JSON.parse(result.text || "{}");
    } catch {
        aiPayload = null;
    }

    const score = scoreFromGeminiPayload(aiPayload, fallbackScore);
    const analysis = {
        repo: normalized,
        score,
        githubMetrics: {
            totalReposForked: null,
            commitsLastYear: Array.isArray(commitsYear) ? commitsYear.length : 0,
            commitsLastMonth: Array.isArray(commitsMonth) ? commitsMonth.length : 0,
            contributors: Array.isArray(contributors) ? contributors.length : 0,
            userContributionPercent,
            languages,
            readmeLength: readmeText.length,
            readmeExcerpt: readmeText.slice(0, 6000),
            commitMessages: commitMessages.slice(0, 80),
            projectAgeDays: repo.created_at ? Math.max(0, Math.ceil((Date.now() - new Date(repo.created_at).getTime()) / 86_400_000)) : null,
        },
        ai: aiPayload || {
            score,
            summary: "Heuristic score used because AI analysis was unavailable.",
            risks: [],
            strengths: [],
        },
        analyzedAt: new Date().toISOString(),
    };

    const data = {
        userId,
        repoFullName,
        repoNodeId: normalized.nodeId,
        defaultBranch: normalized.defaultBranch,
        headSha,
        isFork: false,
        score,
        analysis,
    };
    if (headSha) {
        await gitHubProjectAnalysis.upsert({
            where: {
                userId_repoFullName_headSha: {
                    userId,
                    repoFullName,
                    headSha,
                },
            },
            create: data,
            update: {
                repoNodeId: normalized.nodeId,
                defaultBranch: normalized.defaultBranch,
                isFork: false,
                score,
                analysis,
            },
        });
    } else {
        await gitHubProjectAnalysis.create({
            data,
        });
    }

    return analysis;
}

async function buildGithubProfileSnapshot(accessToken: string) {
    const repos = await githubFetchPages("/user/repos?sort=updated&affiliation=owner,collaborator", accessToken, 10);
    const now = new Date();
    const oneYearAgo = new Date(now.getTime() - 365 * 86_400_000);
    const oneMonthAgo = new Date(now.getTime() - 30 * 86_400_000);
    const contributions = await githubGraphql<{
        viewer?: {
            login?: string;
            year?: { totalCommitContributions?: number; totalPullRequestContributions?: number; totalIssueContributions?: number; totalRepositoryContributions?: number };
            month?: { totalCommitContributions?: number; totalPullRequestContributions?: number; totalIssueContributions?: number; totalRepositoryContributions?: number };
        };
    }>(`query PractersContributionSnapshot($yearFrom: DateTime!, $monthFrom: DateTime!, $to: DateTime!) {
        viewer {
            login
            year: contributionsCollection(from: $yearFrom, to: $to) {
                totalCommitContributions
                totalPullRequestContributions
                totalIssueContributions
                totalRepositoryContributions
            }
            month: contributionsCollection(from: $monthFrom, to: $to) {
                totalCommitContributions
                totalPullRequestContributions
                totalIssueContributions
                totalRepositoryContributions
            }
        }
    }`, {
        yearFrom: oneYearAgo.toISOString(),
        monthFrom: oneMonthAgo.toISOString(),
        to: now.toISOString(),
    }, accessToken);
    const normalizedRepos = Array.isArray(repos) ? repos.map(normalizeRepo) : [];
    return {
        githubUsername: contributions?.viewer?.login ?? null,
        totalRepos: normalizedRepos.length,
        forkedRepos: normalizedRepos.filter((repo) => repo.fork).length,
        privateReposInScope: normalizedRepos.filter((repo) => repo.private).length,
        contributionsLastYear: contributions?.viewer?.year ?? null,
        contributionsLastMonth: contributions?.viewer?.month ?? null,
        repos: normalizedRepos,
        capturedAt: new Date().toISOString(),
    };
}

async function analyzeCodingProfiles(codingProfiles: Record<string, string | null>) {
    const leetcodeHandle = extractHandle(codingProfiles.leetcodeUrl);
    const codeforcesHandle = extractHandle(codingProfiles.codeforcesUrl);
    let leetcode: any = null;
    let codeforces: any = null;

    if (leetcodeHandle) {
        try {
            const response = await fetch("https://leetcode.com/graphql", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "User-Agent": "Practers-Job-Apply",
                },
                body: JSON.stringify({
                    query: `query matchedUser($username: String!) {
                        matchedUser(username: $username) {
                            username
                            submitStatsGlobal {
                                acSubmissionNum {
                                    difficulty
                                    count
                                }
                            }
                        }
                    }`,
                    variables: { username: leetcodeHandle },
                }),
            });
            const payload = await response.json();
            const stats = payload?.data?.matchedUser?.submitStatsGlobal?.acSubmissionNum || [];
            const statByDifficulty = Object.fromEntries(stats.map((item: any) => [String(item.difficulty).toLowerCase(), Number(item.count || 0)]));
            leetcode = {
                handle: leetcodeHandle,
                solvedCount: Number(statByDifficulty.all || 0),
                easy: Number(statByDifficulty.easy || 0),
                medium: Number(statByDifficulty.medium || 0),
                hard: Number(statByDifficulty.hard || 0),
            };
        } catch {
            leetcode = { handle: leetcodeHandle, unavailable: true };
        }
    }

    if (codeforcesHandle) {
        try {
            const [infoRes, ratingRes, statusRes] = await Promise.all([
                fetch(`https://codeforces.com/api/user.info?handles=${encodeURIComponent(codeforcesHandle)}`),
                fetch(`https://codeforces.com/api/user.rating?handle=${encodeURIComponent(codeforcesHandle)}`),
                fetch(`https://codeforces.com/api/user.status?handle=${encodeURIComponent(codeforcesHandle)}&from=1&count=1000`),
            ]);
            const [info, rating, status] = await Promise.all([infoRes.json(), ratingRes.json(), statusRes.json()]);
            const solved = new Set<string>();
            if (status?.status === "OK" && Array.isArray(status.result)) {
                for (const sub of status.result) {
                    if (sub.verdict === "OK" && sub.problem) {
                        solved.add(`${sub.problem.contestId || ""}-${sub.problem.index || ""}-${sub.problem.name || ""}`);
                    }
                }
            }
            codeforces = {
                handle: codeforcesHandle,
                rating: info?.result?.[0]?.rating ?? null,
                maxRating: info?.result?.[0]?.maxRating ?? null,
                contests: rating?.status === "OK" && Array.isArray(rating.result) ? rating.result.length : null,
                solvedCount: solved.size,
            };
        } catch {
            codeforces = { handle: codeforcesHandle, unavailable: true };
        }
    }

    const linkedCount = Object.values(codingProfiles).filter(Boolean).length;
    const knownSolved = Number(codeforces?.solvedCount || 0) + Number(leetcode?.solvedCount || 0);
    const contestCount = Number(codeforces?.contests || 0);
    const score = Math.max(0, Math.min(100, Math.round(linkedCount * 12 + Math.min(knownSolved / 5, 35) + Math.min(contestCount * 3, 25))));

    return {
        score,
        linkedCount,
        platforms: {
            leetcode: leetcode || { url: codingProfiles.leetcodeUrl, handle: extractHandle(codingProfiles.leetcodeUrl), status: codingProfiles.leetcodeUrl ? "linked" : "missing" },
            geeksforgeeks: { url: codingProfiles.geeksforgeeksUrl, handle: extractHandle(codingProfiles.geeksforgeeksUrl), status: codingProfiles.geeksforgeeksUrl ? "linked" : "missing" },
            codeforces,
            codechef: { url: codingProfiles.codechefUrl, handle: extractHandle(codingProfiles.codechefUrl), status: codingProfiles.codechefUrl ? "linked" : "missing" },
        },
        note: "LeetCode and Codeforces are analyzed through public endpoints. GeeksForGeeks and CodeChef URLs are stored for recruiter review and future platform-specific analysis.",
        analyzedAt: new Date().toISOString(),
    };
}

export default async function jobsRoutes(fastify: FastifyInstance) {
    fastify.addHook("preHandler", fastify.authenticate);

    fastify.get("/jobs", async (request, reply) => {
        const parsed = jobsQuerySchema.safeParse(request.query);
        if (!parsed.success) {
            return reply.status(400).send({
                error: "Validation Error",
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const { q, page, limit } = parsed.data;
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const where: Record<string, unknown> = {
            status: "open",
            AND: [
                {
                    OR: [
                        { applicationDeadline: null },
                        { applicationDeadline: { gte: todayStart } },
                    ],
                },
            ],
        };

        if (q) {
            where.OR = [
                { title: { contains: q, mode: "insensitive" } },
                { companyName: { contains: q, mode: "insensitive" } },
                { location: { contains: q, mode: "insensitive" } },
            ];
        }

        const userId = request.user!.id;
        const [jobs, total] = await Promise.all([
            companyJobOpening.findMany({
                where,
                select: publicJobSelect,
                orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
                skip: (page - 1) * limit,
                take: limit,
            }),
            companyJobOpening.count({ where }),
        ]);
        const jobIds = jobs.map((job: any) => job.id);
        const applications = jobIds.length
            ? await jobApplication.findMany({
                where: {
                    userId,
                    jobId: { in: jobIds },
                },
                select: { jobId: true },
            })
            : [];
        const appliedJobIds = new Set(applications.map((application: any) => application.jobId));

        return {
            jobs: jobs.map((job: any) => toPublicJob(job, appliedJobIds.has(job.id))),
            page,
            limit,
            total,
            hasMore: page * limit < total,
        };
    });

    fastify.get("/jobs/github/repos", async (request, reply) => {
        const userId = request.user!.id;
        const github = await getGithubContext(userId);
        if (!github) {
            return reply.status(409).send({ error: "GitHub Required", message: "Connect GitHub before selecting projects." });
        }

        try {
            const repos = await githubFetchPages("/user/repos?sort=updated&affiliation=owner,collaborator", github.accessToken, 10);
            return { repos: Array.isArray(repos) ? repos.map(normalizeRepo) : [] };
        } catch (error) {
            if (isGitHubCredentialsError(error)) {
                await revokeGithubIntegration(userId);
                return reply.status(409).send({
                    error: "GitHub Required",
                    message: "Your GitHub connection expired. Please reconnect GitHub before selecting projects.",
                });
            }
            throw error;
        }
    });

    fastify.get("/jobs/:id/application-readiness", async (request, reply) => {
        const params = jobIdParamsSchema.safeParse(request.params);
        if (!params.success) {
            return reply.status(400).send({ error: "Validation Error", details: params.error.flatten().fieldErrors });
        }

        const userId = request.user!.id;
        const [job, profile, github] = await Promise.all([
            companyJobOpening.findUnique({ where: { id: params.data.id }, select: { id: true, status: true, applicationDeadline: true } }),
            jobApplyProfile.findUnique({
                where: { userId },
                select: {
                    id: true,
                    isPublished: true,
                    leetcodeUrl: true,
                    geeksforgeeksUrl: true,
                    codeforcesUrl: true,
                    codechefUrl: true,
                },
            }),
            gitHubIntegration.findUnique({ where: { userId }, select: { revokedAt: true, githubUsername: true } }),
        ]);

        if (!job || !isJobOpen(job)) {
            return reply.status(410).send({ error: "Applications Closed", message: "This job is no longer accepting applications." });
        }

        return {
            profileReady: Boolean(profile?.isPublished),
            githubConnected: Boolean(github && !github.revokedAt),
            githubUsername: github?.githubUsername ?? null,
            codingProfiles: codingProfileValues(profile),
            hasCodingProfile: hasCodingProfile(profile),
        };
    });

    fastify.get("/jobs/technical-assignments", async (request) => {
        const userId = request.user!.id;
        const roundCandidates = await jobRoundCandidate.findMany({
            where: {
                userId,
                round: {
                    roundType: "technical_assignment",
                },
            },
            select: {
                id: true,
                applicationId: true,
                status: true,
                createdAt: true,
                round: {
                    select: {
                        id: true,
                        roundType: true,
                        status: true,
                        closesAt: true,
                        technicalAssignment: {
                            select: {
                                id: true,
                                jobId: true,
                                title: true,
                                timeLimit: true,
                                estimatedHours: true,
                                deadlinePolicy: true,
                                overview: true,
                                scenario: true,
                                tasks: true,
                                starterContext: true,
                                constraints: true,
                                allowedStack: true,
                                deliverables: true,
                                submissionInstructions: true,
                                thinkingQuestions: true,
                                candidateMessage: true,
                                closesAt: true,
                                job: {
                                    select: {
                                        title: true,
                                        companyName: true,
                                    },
                                },
                                submissions: {
                                    where: { userId },
                                    select: {
                                        id: true,
                                        repoUrl: true,
                                        status: true,
                                        submittedAt: true,
                                    },
                                },
                            },
                        },
                    },
                },
            },
            orderBy: { createdAt: "desc" },
        });

        return {
            assignments: roundCandidates
                .map((candidate: any) => candidate.round?.technicalAssignment)
                .filter(Boolean)
                .map((assignment: any) => toCandidateTechnicalAssignment(assignment, assignment.submissions?.[0] || null)),
        };
    });

    fastify.get("/jobs/scheduled", async (request) => {
        const userId = request.user!.id;
        const roundCandidates = await jobRoundCandidate.findMany({
            where: {
                userId,
                round: {
                    roundType: { not: "application_review" },
                },
            },
            select: {
                id: true,
                applicationId: true,
                status: true,
                submittedAt: true,
                createdAt: true,
                round: {
                    select: {
                        id: true,
                        roundType: true,
                        status: true,
                        opensAt: true,
                        closesAt: true,
                        config: true,
                        job: {
                            select: {
                                id: true,
                                title: true,
                                companyName: true,
                                companyLogoUrl: true,
                                location: true,
                                workMode: true,
                                employmentType: true,
                            },
                        },
                        technicalAssignment: {
                            select: {
                                id: true,
                                jobId: true,
                                title: true,
                                timeLimit: true,
                                estimatedHours: true,
                                deadlinePolicy: true,
                                overview: true,
                                scenario: true,
                                tasks: true,
                                starterContext: true,
                                constraints: true,
                                allowedStack: true,
                                deliverables: true,
                                submissionInstructions: true,
                                thinkingQuestions: true,
                                candidateMessage: true,
                                closesAt: true,
                                submissions: {
                                    where: { userId },
                                    select: {
                                        id: true,
                                        repoUrl: true,
                                        status: true,
                                        submittedAt: true,
                                    },
                                },
                            },
                        },
                    },
                },
            },
            orderBy: { createdAt: "desc" },
        });

        return {
            scheduled: roundCandidates.map(toScheduledRoundFromRoundCandidate),
        };
    });

    fastify.get("/jobs/ai-interviews/:roundCandidateId/attempt", async (request, reply) => {
        const params = aiScreeningRoundCandidateParamsSchema.safeParse(request.params);
        if (!params.success) {
            return reply.status(400).send({ error: "Validation Error", details: params.error.flatten().fieldErrors });
        }

        const candidate = await jobRoundCandidate.findFirst({
            where: { id: params.data.roundCandidateId, userId: request.user!.id },
            select: {
                id: true,
                status: true,
                submittedAt: true,
                metadata: true,
                round: {
                    select: {
                        id: true,
                        roundType: true,
                        opensAt: true,
                        closesAt: true,
                        config: true,
                        job: {
                            select: {
                                id: true,
                                title: true,
                                companyName: true,
                                location: true,
                            },
                        },
                    },
                },
            },
        });

        if (!candidate || candidate.round?.roundType !== "ai_interview") {
            return reply.status(404).send({ error: "Not Found", message: "AI screening interview not found." });
        }

        const config = aiInterviewConfigFromRound(candidate.round);
        const blueprint = buildScreeningBlueprint(config);
        return {
            roundCandidateId: candidate.id,
            status: candidate.status,
            submittedAt: candidate.submittedAt?.toISOString?.() || null,
            job: candidate.round.job,
            interview: {
                title: config.title || "AI screening interview",
                startAt: config.startAt || candidate.round.opensAt?.toISOString?.() || null,
                endAt: config.endAt || candidate.round.closesAt?.toISOString?.() || null,
                durationMinutes: Number(config.durationMinutes || blueprint.durationMinutes || 0),
                candidateInstructions: config.candidateInstructions || "",
                candidateMessage: config.candidateMessage || "",
                requireCamera: true,
                requireMicrophone: true,
                requireFullscreen: true,
            },
            blueprint: {
                template: blueprint.template,
                title: blueprint.title,
                phaseCount: blueprint.phases.length,
                questionCount: countBlueprintQuestions(blueprint),
                phases: blueprint.phases.map((phase) => ({
                    id: phase.id,
                    type: phase.type,
                    title: phase.title,
                    questionCount: phase.questions.length,
                    durationMinutes: phase.durationMinutes,
                })),
            },
            attempt: publicAiScreeningAttempt(getAiScreeningAttempt(candidate.metadata)),
        };
    });

    fastify.post("/jobs/ai-interviews/:roundCandidateId/start", async (request, reply) => {
        const params = aiScreeningRoundCandidateParamsSchema.safeParse(request.params);
        const body = aiScreeningStartSchema.safeParse(request.body ?? {});
        if (!params.success || !body.success) {
            return reply.status(400).send({
                error: "Validation Error",
                details: params.success ? body.error.flatten().fieldErrors : params.error.flatten().fieldErrors,
            });
        }

        const candidate = await jobRoundCandidate.findFirst({
            where: { id: params.data.roundCandidateId, userId: request.user!.id },
            select: {
                id: true,
                roundId: true,
                applicationId: true,
                userId: true,
                status: true,
                submittedAt: true,
                metadata: true,
                round: {
                    select: {
                        id: true,
                        roundType: true,
                        companyId: true,
                        opensAt: true,
                        closesAt: true,
                        config: true,
                        job: {
                            select: {
                                title: true,
                            },
                        },
                    },
                },
            },
        });

        if (!candidate || candidate.round?.roundType !== "ai_interview") {
            return reply.status(404).send({ error: "Not Found", message: "AI screening interview not found." });
        }
        if (candidate.submittedAt || candidate.status === "submitted") {
            return reply.status(409).send({
                error: "AI Screening Already Submitted",
                code: "ai_screening_already_submitted",
                message: "This AI screening interview has already been submitted.",
            });
        }

        const config = aiInterviewConfigFromRound(candidate.round);
        const blueprint = buildScreeningBlueprint(config);
        if (!config.configuredAt || !countBlueprintQuestions(blueprint)) {
            return reply.status(400).send({
                error: "AI Screening Unavailable",
                code: "ai_screening_not_configured",
                message: "This AI screening interview has not been configured by the company yet.",
            });
        }
        if (!isWithinAiWindow(config, candidate.round)) {
            return reply.status(400).send({
                error: "AI Screening Unavailable",
                code: "ai_screening_window_closed",
                message: "This AI screening interview is not inside its access window.",
            });
        }

        await ensureAiScreeningProctoringRule(candidate.round.id);

        const existing = await secureOaSession.findUnique({
            where: {
                jobRoundId_jobRoundCandidateId: {
                    jobRoundId: candidate.round.id,
                    jobRoundCandidateId: candidate.id,
                },
            },
            select: { id: true, status: true, jobRoundId: true },
        });

        let proctoringSession = existing;
        let restartedClosedMockSession = false;
        if (existing && !["pending", "active"].includes(existing.status)) {
            if (!isCompanyScreeningTestRestartEnabled()) {
                return reply.status(409).send({
                    error: "AI Screening Session Closed",
                    code: "ai_screening_session_closed",
                    sessionStatus: existing.status,
                    message: "This AI screening session is already closed. Please contact your recruiter.",
                });
            }

            restartedClosedMockSession = true;
            proctoringSession = await secureOaSession.update({
                where: { id: existing.id },
                data: {
                    status: "active",
                    startedAt: new Date(),
                    submittedAt: null,
                    terminatedAt: null,
                    terminatedReason: null,
                    integrityScore: null,
                    clientFingerprint: body.data.client_fingerprint || null,
                    userAgent: body.data.user_agent || request.headers["user-agent"]?.toString() || null,
                    ipAddress: getRequestIp(request),
                },
                select: { id: true, status: true, jobRoundId: true },
            });
        }
        if (existing?.status === "pending") {
            proctoringSession = await secureOaSession.update({
                where: { id: existing.id },
                data: {
                    status: "active",
                    startedAt: new Date(),
                    clientFingerprint: body.data.client_fingerprint || null,
                    userAgent: body.data.user_agent || request.headers["user-agent"]?.toString() || null,
                    ipAddress: getRequestIp(request),
                },
                select: { id: true, status: true, jobRoundId: true },
            });
        }

        if (!proctoringSession) {
            const otherActive = await secureOaSession.findFirst({
                where: {
                    candidateUserId: request.user!.id,
                    status: "active",
                },
                select: { id: true },
            });
            if (otherActive) {
                return reply.status(409).send({
                    error: "Conflict",
                    code: "another_proctored_session_active",
                    message: "Another proctored session is already active. Close it before starting this AI screening.",
                });
            }

            proctoringSession = await secureOaSession.create({
                data: {
                    jobRoundId: candidate.round.id,
                    jobRoundCandidateId: candidate.id,
                    candidateUserId: request.user!.id,
                    companyId: candidate.round.companyId,
                    status: "active",
                    startedAt: new Date(),
                    clientFingerprint: body.data.client_fingerprint || null,
                    userAgent: body.data.user_agent || request.headers["user-agent"]?.toString() || null,
                    ipAddress: getRequestIp(request),
                },
                select: { id: true, status: true, jobRoundId: true },
            });
        }

        const metadata = toRecord(candidate.metadata);
        const existingAttempt = getAiScreeningAttempt(metadata);
        const interviewSessionId = await ensureAiScreeningInterviewSession({
            userId: candidate.userId,
            jobTitle: candidate.round.job?.title || "Software Engineer",
            existingSessionId: restartedClosedMockSession ? null : existingAttempt?.interviewSessionId,
            blueprint,
            roundCandidateId: candidate.id,
            jobRoundId: candidate.round.id,
            applicationId: candidate.applicationId,
        });
        const attempt = existingAttempt && existingAttempt.status === "active" && !restartedClosedMockSession
            ? { ...existingAttempt, interviewSessionId }
            : createScreeningAttemptState({
                blueprint,
                proctoringSessionId: proctoringSession.id,
                interviewSessionId,
                startedAt: new Date().toISOString(),
            });

        await jobRoundCandidate.update({
            where: { id: candidate.id },
            data: {
                status: "in_progress",
                metadata: {
                    ...metadata,
                    aiScreeningAttempt: attempt,
                },
            },
        });

        return reply.status(existing ? 200 : 201).send({
            attempt: publicAiScreeningAttempt(attempt),
            rulesPublic: await activeAiScreeningRulesPublic(candidate.round.id),
        });
    });

    fastify.post("/jobs/ai-interviews/:roundCandidateId/answer", async (request, reply) => {
        const params = aiScreeningRoundCandidateParamsSchema.safeParse(request.params);
        const body = aiScreeningAnswerSchema.safeParse(request.body);
        if (!params.success || !body.success) {
            return reply.status(400).send({
                error: "Validation Error",
                details: params.success ? body.error.flatten().fieldErrors : params.error.flatten().fieldErrors,
            });
        }

        const candidate = await jobRoundCandidate.findFirst({
            where: { id: params.data.roundCandidateId, userId: request.user!.id },
            select: {
                id: true,
                status: true,
                submittedAt: true,
                metadata: true,
                round: {
                    select: {
                        id: true,
                        roundType: true,
                        opensAt: true,
                        closesAt: true,
                        config: true,
                    },
                },
            },
        });

        if (!candidate || candidate.round?.roundType !== "ai_interview") {
            return reply.status(404).send({ error: "Not Found", message: "AI screening interview not found." });
        }
        if (candidate.submittedAt || candidate.status === "submitted") {
            return reply.status(409).send({ error: "AI Screening Already Submitted", message: "This AI screening has already been submitted." });
        }
        const config = aiInterviewConfigFromRound(candidate.round);
        if (!isWithinAiWindow(config, candidate.round)) {
            return reply.status(400).send({ error: "AI Screening Unavailable", message: "This AI screening interview is not inside its access window." });
        }

        const metadata = toRecord(candidate.metadata);
        const attempt = getAiScreeningAttempt(metadata);
        if (!attempt || attempt.status !== "active") {
            return reply.status(409).send({
                error: "AI Screening Not Started",
                code: "ai_screening_not_started",
                message: "Start the AI screening interview before submitting answers.",
            });
        }

        const advanced = advanceScreeningAttempt(attempt, body.data.answer);
        await jobRoundCandidate.update({
            where: { id: candidate.id },
            data: {
                metadata: {
                    ...metadata,
                    aiScreeningAttempt: advanced.state,
                },
            },
        });

        return {
            attempt: publicAiScreeningAttempt(advanced.state),
            completed: advanced.completed,
        };
    });

    fastify.post("/jobs/ai-interviews/:roundCandidateId/submit", async (request, reply) => {
        const params = aiScreeningRoundCandidateParamsSchema.safeParse(request.params);
        if (!params.success) {
            return reply.status(400).send({ error: "Validation Error", details: params.error.flatten().fieldErrors });
        }
        // [ScreeningEnd] Definitive end-trigger record: WHY the client submitted this screen.
        const _endBody = toRecord(request.body);
        console.log(`[ScreeningEnd] /submit for roundCandidate ${params.data.roundCandidateId} | reason=${_endBody.endReason ?? "n/a"} | elapsedSec=${_endBody.elapsedSec ?? "n/a"} | interviewLimitSec=${_endBody.interviewLimitSec ?? "n/a"}`);

        const candidate = await jobRoundCandidate.findFirst({
            where: { id: params.data.roundCandidateId, userId: request.user!.id },
            select: {
                id: true,
                roundId: true,
                applicationId: true,
                userId: true,
                status: true,
                submittedAt: true,
                metadata: true,
                user: {
                    select: {
                        fullName: true,
                        email: true,
                    },
                },
                round: {
                    select: {
                        id: true,
                        roundType: true,
                        config: true,
                        job: {
                            select: {
                                title: true,
                                companyName: true,
                            },
                        },
                    },
                },
            },
        });

        if (!candidate || candidate.round?.roundType !== "ai_interview") {
            return reply.status(404).send({ error: "Not Found", message: "AI screening interview not found." });
        }
        if (candidate.submittedAt || candidate.status === "submitted") {
            return reply.send({ status: "submitted" });
        }

        const metadata = toRecord(candidate.metadata);
        const attempt = getAiScreeningAttempt(metadata);
        if (!attempt || attempt.status !== "active") {
            return reply.status(409).send({
                error: "AI Screening Not Started",
                code: "ai_screening_not_started",
                message: "Start the AI screening interview before submitting it.",
            });
        }

        let linkedInterviewSession: {
            id: string;
            status: string;
            completedAt: Date | null;
            messages?: Array<{ role: string; content: string; stage: string | null; createdAt: Date; metadata?: any }>;
        } | null = null;
        if (attempt.interviewSessionId) {
            linkedInterviewSession = await interviewSession.findFirst({
                where: { id: attempt.interviewSessionId, userId: request.user!.id },
                select: {
                    id: true,
                    status: true,
                    completedAt: true,
                    messages: {
                        orderBy: { createdAt: "asc" },
                        select: {
                            role: true,
                            content: true,
                            stage: true,
                            createdAt: true,
                            metadata: true,
                        },
                    },
                },
            });
            if (!linkedInterviewSession) {
                return reply.status(409).send({
                    error: "AI Screening Session Missing",
                    code: "ai_screening_interview_session_missing",
                    message: "The interview room session could not be found. Please restart from Scheduled.",
                });
            }
            if (linkedInterviewSession.status !== "COMPLETED") {
                return reply.status(409).send({
                    error: "AI Screening Incomplete",
                    code: "ai_screening_interview_session_incomplete",
                    message: "End the AI interview room before submitting the screening.",
                });
            }
        }

        if (!attempt.interviewSessionId && currentScreeningTurn(attempt)) {
            return reply.status(409).send({
                error: "AI Screening Incomplete",
                code: "ai_screening_incomplete",
                message: "Answer all configured screening prompts before submitting.",
            });
        }

        const ruleset = await loadActiveProctoringRules(prisma, candidate.round.id);
        const events = await proctoringEvent.findMany({
            where: { sessionId: attempt.proctoringSessionId },
            orderBy: { serverTimestamp: "asc" },
        });
        const integrityScore = Math.round(computeIntegrityScore(events.map((event: any) => ({
            id: event.id,
            clientEventId: event.clientEventId,
            eventType: event.eventType,
            severity: event.severity,
            payload: event.payload,
            clientTimestamp: event.clientTimestamp,
            serverTimestamp: event.serverTimestamp,
            processedAt: event.processedAt,
            triggeredTermination: event.triggeredTermination,
        })), ruleset.rules));
        const eventCounts = events.reduce((counts: Record<string, number>, event: any) => {
            counts[event.eventType] = (counts[event.eventType] || 0) + 1;
            return counts;
        }, {});
        const submittedAt = new Date();
        const submittedAttempt: ScreeningAttemptState = {
            ...attempt,
            status: "submitted",
            submittedAt: submittedAt.toISOString(),
        };
        const reportBlueprint = attempt.blueprintSnapshot || buildScreeningBlueprint(aiInterviewConfigFromRound(candidate.round));
        const recruiterReport = await generateCompanyAiScreeningReport({
            candidateName: candidate.user?.fullName || candidate.user?.email || "Candidate",
            jobTitle: candidate.round.job?.title || "Software Engineer",
            companyName: candidate.round.job?.companyName || "",
            blueprint: reportBlueprint,
            transcript: (linkedInterviewSession?.messages || []).map((message) => ({
                role: message.role,
                content: message.content,
                stage: message.stage,
                createdAt: message.createdAt,
                questionId: toRecord(message.metadata).companyScreeningQuestionId
                    ? String(toRecord(message.metadata).companyScreeningQuestionId)
                    : null,
            })),
            typedAnswers: Array.isArray(attempt.answers) ? attempt.answers : [],
            integrity: {
                score: integrityScore,
                eventCounts,
            },
        });
        const coverage = Array.isArray(recruiterReport.coverage) ? recruiterReport.coverage : [];
        const coverageSummary = {
            total: coverage.length,
            answered: coverage.filter((item) => item.status === "answered").length,
            skipped: coverage.filter((item) => item.status === "skipped").length,
            notAsked: coverage.filter((item) => item.status === "not_asked").length,
            unknown: coverage.filter((item) => item.status === "unknown").length,
        };
        // Blueprint-adherence drift: configured questions the interviewer never asked.
        // Surfaced in the stored evidence snapshot and logged for monitoring/alerting.
        const driftedQuestions = coverage.filter((item) => item.status === "not_asked").map((item) => item.questionId);
        if (driftedQuestions.length > 0) {
            console.warn(
                `[company-screening] blueprint drift for roundCandidate ${candidate.id}: ${driftedQuestions.length}/${coverage.length} configured question(s) not asked: ${driftedQuestions.join(", ")}`
            );
        }
        const evidenceSnapshot = {
            version: 1,
            generatedAt: recruiterReport.generatedAt,
            automatedEvaluation: recruiterReport.automatedEvaluation,
            recommendation: recruiterReport.recommendation,
            modelSuggestedOverall: recruiterReport.modelSuggestedOverall ?? null,
            integrityScore,
            proctoringEventCounts: eventCounts,
            transcriptMessageCount: linkedInterviewSession?.messages?.filter((message) => message.role !== "system").length || 0,
            typedAnswerCount: Array.isArray(attempt.answers) ? attempt.answers.length : 0,
            blueprintQuestionCount: countBlueprintQuestions(reportBlueprint),
            coverageSummary,
            driftedQuestionIds: driftedQuestions,
        };

        await prisma.$transaction(async (tx) => {
            await (tx as any).secureOaSession.update({
                where: { id: attempt.proctoringSessionId },
                data: {
                    status: "submitted",
                    submittedAt,
                    integrityScore,
                    integrityRulesSnapshot: ruleset.rules,
                },
            });
            await (tx as any).jobRoundCandidate.update({
                where: { id: candidate.id },
                data: {
                    status: "submitted",
                    submittedAt,
                    metadata: {
                        ...metadata,
                        aiScreeningAttempt: submittedAttempt,
                        aiScreeningReview: {
                            automatedEvaluation: recruiterReport.automatedEvaluation,
                            decisionOwner: "company_recruiter",
                            recommendation: recruiterReport.recommendation,
                            overallScore: recruiterReport.overallScore,
                            integrityScore,
                            proctoringEventCounts: eventCounts,
                            proctoringSessionId: attempt.proctoringSessionId,
                            interviewSessionId: attempt.interviewSessionId || null,
                            interviewCompletedAt: linkedInterviewSession?.completedAt?.toISOString?.() || null,
                            submittedAt: submittedAt.toISOString(),
                        },
                    },
                },
            });
            await (tx as any).jobRoundEvaluationReport.upsert({
                where: { roundCandidateId: candidate.id },
                create: {
                    roundCandidateId: candidate.id,
                    jobRoundId: candidate.round.id,
                    applicationId: candidate.applicationId,
                    userId: candidate.userId,
                    roundType: "ai_interview",
                    overallScore: recruiterReport.overallScore,
                    evidenceSnapshot,
                    rubricBreakdown: recruiterReport.dimensionScores,
                    aiSummary: recruiterReport.summary,
                    report: recruiterReport,
                },
                update: {
                    overallScore: recruiterReport.overallScore,
                    evidenceSnapshot,
                    rubricBreakdown: recruiterReport.dimensionScores,
                    aiSummary: recruiterReport.summary,
                    report: recruiterReport,
                    evaluatedAt: new Date(),
                },
            });
        });

        disconnectProctoringSession(attempt.proctoringSessionId);
        return reply.send({
            status: "submitted",
            integrityScore,
            eventCounts,
            report: {
                status: recruiterReport.automatedEvaluation,
                recommendation: recruiterReport.recommendation,
                overallScore: recruiterReport.overallScore,
            },
        });
    });

    fastify.post("/jobs/technical-assignments/:assignmentId/submissions", async (request, reply) => {
        const params = technicalAssignmentParamsSchema.safeParse(request.params);
        const parsed = technicalAssignmentSubmissionSchema.safeParse(request.body);
        if (!params.success || !parsed.success) {
            return reply.status(400).send({
                error: "Validation Error",
                details: {
                    ...(params.success ? {} : params.error.flatten().fieldErrors),
                    ...(parsed.success ? {} : parsed.error.flatten().fieldErrors),
                },
            });
        }

        const userId = request.user!.id;
        const rl = checkRateLimit(`jobs:technical-assignment-submit:${userId}`, 10, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Submission limit reached. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        const assignment = await technicalAssignment.findUnique({
            where: { id: params.data.assignmentId },
            select: {
                id: true,
                jobId: true,
                roundId: true,
                title: true,
                overview: true,
                scenario: true,
                tasks: true,
                constraints: true,
                allowedStack: true,
                deliverables: true,
                thinkingQuestions: true,
                rubric: true,
                closesAt: true,
                status: true,
                job: {
                    select: {
                        id: true,
                        title: true,
                        companyName: true,
                        skills: true,
                        responsibilities: true,
                        requirements: true,
                    },
                },
            },
        });
        if (!assignment || assignment.status === "closed" || assignment.closesAt.getTime() <= Date.now()) {
            return reply.status(410).send({ error: "Assignment Closed", message: "This assignment is no longer accepting submissions." });
        }

        const application = await jobApplication.findUnique({
            where: {
                jobId_userId: {
                    jobId: assignment.jobId,
                    userId,
                },
            },
            select: {
                id: true,
                status: true,
                nextRoundType: true,
            },
        });
        if (!application) {
            return reply.status(403).send({ error: "Forbidden", message: "You are not assigned to this technical round." });
        }

        const roundCandidate = assignment.roundId
            ? await jobRoundCandidate.findFirst({
                where: {
                    roundId: assignment.roundId,
                    applicationId: application.id,
                    userId,
                },
                select: { id: true },
            })
            : null;
        if (assignment.roundId && !roundCandidate) {
            return reply.status(403).send({ error: "Forbidden", message: "You are not assigned to this technical round." });
        }
        if (!assignment.roundId && (application.status !== "next_round" || application.nextRoundType !== "technical_assignment")) {
            return reply.status(403).send({ error: "Forbidden", message: "You are not assigned to this technical round." });
        }

        const repoFullName = parseGithubRepoFullName(parsed.data.repoUrl);
        if (!repoFullName) {
            return reply.status(400).send({ error: "Validation Error", message: "Submit a valid GitHub repository URL." });
        }

        const github = await getGithubContext(userId);
        if (!github) {
            return reply.status(409).send({
                error: "GitHub Required",
                message: "Connect GitHub again so we can verify and evaluate your assignment repository.",
            });
        }

        let evaluation: {
            score: number;
            evidence: Record<string, unknown>;
            report: Record<string, unknown>;
        };
        try {
            const safeFullName = repoFullName.split("/").map(encodeURIComponent).join("/");
            const repoPayload = await githubFetch(`/repos/${safeFullName}`, github.accessToken);
            const selectedRepo = selectedProjectSchema.parse(normalizeRepo(repoPayload));
            const [projectAnalysis, signals] = await Promise.all([
                analyzeProject({
                    userId,
                    githubUsername: github.username,
                    accessToken: github.accessToken,
                    project: selectedRepo,
                }),
                fetchRepoPathSignals(selectedRepo, github.accessToken),
            ]);
            const scorecard = assignmentScorecardForProject({ assignment, projectAnalysis, signals });
            const report = await buildTechnicalAssignmentReport({ assignment, projectAnalysis, scorecard });
            evaluation = {
                score: scorecard.score,
                evidence: {
                    assignmentId: assignment.id,
                    repoFullName,
                    repoUrl: selectedRepo.htmlUrl || parsed.data.repoUrl,
                    headSha: signals.headSha,
                    scorecard,
                    projectAnalysis,
                    repoSignals: {
                        sourceFiles: signals.sourceFiles,
                        testFiles: signals.testFiles,
                        hasReadme: signals.hasReadme,
                        hasEnvExample: signals.hasEnvExample,
                        schemaFiles: signals.schemaFiles,
                    },
                },
                report,
            };
        } catch (err) {
            if (isGitHubCredentialsError(err)) {
                await revokeGithubIntegration(userId);
                return reply.status(409).send({
                    error: "GitHub Required",
                    message: "GitHub access expired. Refresh GitHub access and submit the assignment again.",
                });
            }
            throw err;
        }

        const submission = await technicalAssignmentSubmission.upsert({
            where: {
                assignmentId_userId: {
                    assignmentId: assignment.id,
                    userId,
                },
            },
            create: {
                assignmentId: assignment.id,
                userId,
                applicationId: application.id,
                roundCandidateId: roundCandidate?.id || null,
                repoUrl: parsed.data.repoUrl,
                status: "evaluated",
                score: evaluation.score,
                evidence: evaluation.evidence,
                report: evaluation.report,
            },
            update: {
                repoUrl: parsed.data.repoUrl,
                applicationId: application.id,
                roundCandidateId: roundCandidate?.id || null,
                status: "evaluated",
                score: evaluation.score,
                evidence: evaluation.evidence,
                report: evaluation.report,
            },
            select: {
                id: true,
                repoUrl: true,
                status: true,
                submittedAt: true,
            },
        });

        if (roundCandidate && assignment.roundId) {
            await Promise.all([
                jobRoundCandidate.update({
                    where: { id: roundCandidate.id },
                    data: {
                        status: "evaluated",
                        score: evaluation.score,
                        submittedAt: new Date(),
                        evaluatedAt: new Date(),
                    },
                }),
                jobRoundEvaluationReport.upsert({
                    where: { roundCandidateId: roundCandidate.id },
                    create: {
                        roundCandidateId: roundCandidate.id,
                        jobRoundId: assignment.roundId,
                        applicationId: application.id,
                        userId,
                        roundType: "technical_assignment",
                        overallScore: evaluation.score,
                        repoHeadSha: (evaluation.evidence as any)?.headSha || null,
                        evidenceSnapshot: evaluation.evidence,
                        rubricBreakdown: (evaluation.evidence as any)?.scorecard || null,
                        aiSummary: typeof evaluation.report?.summary === "string" ? evaluation.report.summary : null,
                        report: evaluation.report,
                    },
                    update: {
                        overallScore: evaluation.score,
                        repoHeadSha: (evaluation.evidence as any)?.headSha || null,
                        evidenceSnapshot: evaluation.evidence,
                        rubricBreakdown: (evaluation.evidence as any)?.scorecard || null,
                        aiSummary: typeof evaluation.report?.summary === "string" ? evaluation.report.summary : null,
                        report: evaluation.report,
                        evaluatedAt: new Date(),
                    },
                }),
            ]);
        }

        return reply.status(201).send({ submission });
    });

    fastify.post("/jobs/:id/apply", async (request, reply) => {
        const params = jobIdParamsSchema.safeParse(request.params);
        if (!params.success) {
            return reply.status(400).send({ error: "Validation Error", details: params.error.flatten().fieldErrors });
        }

        const parsed = quickApplySchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({ error: "Validation Error", details: parsed.error.flatten().fieldErrors });
        }

        const userId = request.user!.id;
        const rl = checkRateLimit(`jobs:apply:${userId}`, 10, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Application limit reached. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        const [job, profile, github] = await Promise.all([
            companyJobOpening.findUnique({ where: { id: params.data.id } }),
            jobApplyProfile.findUnique({ where: { userId } }),
            getGithubContext(userId),
        ]);

        if (!job || !isJobOpen(job)) {
            return reply.status(410).send({ error: "Applications Closed", message: "This job is no longer accepting applications." });
        }

        const existingApplication = await jobApplication.findUnique({
            where: {
                jobId_userId: {
                    jobId: params.data.id,
                    userId,
                },
            },
            select: {
                id: true,
                status: true,
                submittedAt: true,
            },
        });
        if (existingApplication) {
            return reply.status(200).send({
                application: existingApplication,
                applied: true,
                message: "Application already submitted.",
            });
        }

        if (!profile?.isPublished) {
            return reply.status(409).send({ error: "Profile Required", message: "Create your recruiter profile before applying." });
        }
        if (!github) {
            return reply.status(409).send({ error: "GitHub Required", message: "Connect GitHub before applying." });
        }

        const codingProfiles = codingProfileValues(profile, parsed.data.codingProfiles);
        if (!hasCodingProfile(profile, parsed.data.codingProfiles)) {
            return reply.status(409).send({ error: "Coding Profile Required", message: "Add at least one coding profile before applying." });
        }

        await jobApplyProfile.update({
            where: { userId },
            data: codingProfiles,
        });

        let githubProfileSnapshot: Awaited<ReturnType<typeof buildGithubProfileSnapshot>>;
        const projectAnalyses = [];
        try {
            githubProfileSnapshot = await buildGithubProfileSnapshot(github.accessToken);
            for (const project of parsed.data.selectedProjects) {
                projectAnalyses.push(await analyzeProject({
                    userId,
                    githubUsername: github.username,
                    accessToken: github.accessToken,
                    project,
                }));
            }
        } catch (error) {
            if (isGitHubCredentialsError(error)) {
                await revokeGithubIntegration(userId);
                return reply.status(409).send({
                    error: "GitHub Required",
                    message: "Your GitHub connection expired. Please reconnect GitHub before applying.",
                });
            }
            throw error;
        }

        const codingAnalysis = await analyzeCodingProfiles(codingProfiles);
        const scoringConfig = normalizeScoringConfig(job.scoringConfig);
        const projectScores = [0, 1, 2].map((index) => {
            const project = projectAnalyses[index];
            return project ? projectScoreForJob(project, scoringConfig, job) : 0;
        });
        const githubScore = Math.round(projectScores.reduce((sum, item) => sum + item, 0) / 3);
        const codingScore = codingScoreForJob(codingAnalysis, codingProfiles, scoringConfig);
        const overallScore = Math.round((githubScore * scoringConfig.weights.github + codingScore * scoringConfig.weights.coding) / 100);
        const scoredCodingAnalysis = { ...codingAnalysis, score: codingScore, scoringConfig };
        const evidencePack = buildEvidencePack({
            job,
            profile,
            selectedProjects: parsed.data.selectedProjects,
            githubProfileSnapshot,
            projectAnalyses,
            projectSlotScores: projectScores,
            codingProfiles,
            codingAnalysis: scoredCodingAnalysis,
            scoringConfig,
            githubScore,
            codingScore,
            overallScore,
        });
        const recruiterAnalysis = await buildRecruiterAgentAnalysis(evidencePack);
        const recruiterProfileSummary = buildAgentProfileSummary(
            toRecord(toRecord(recruiterAnalysis.agents).profileSummary)
        );

        const application = await jobApplication.upsert({
            where: {
                jobId_userId: {
                    jobId: params.data.id,
                    userId,
                },
            },
            create: {
                jobId: params.data.id,
                userId,
                selectedProjects: parsed.data.selectedProjects,
                githubProfileSnapshot,
                githubAnalysis: {
                    score: githubScore,
                    projectScores,
                    overallScore,
                    scoringConfig,
                    projects: projectAnalyses,
                    capturedAt: new Date().toISOString(),
                },
                codingProfiles,
                codingAnalysis: scoredCodingAnalysis,
                evidencePack,
                recruiterAnalysis,
                status: "submitted",
            },
            update: {
                selectedProjects: parsed.data.selectedProjects,
                githubProfileSnapshot,
                githubAnalysis: {
                    score: githubScore,
                    projectScores,
                    overallScore,
                    scoringConfig,
                    projects: projectAnalyses,
                    capturedAt: new Date().toISOString(),
                },
                codingProfiles,
                codingAnalysis: scoredCodingAnalysis,
                evidencePack,
                recruiterAnalysis,
                status: "submitted",
            },
            select: {
                id: true,
                status: true,
                submittedAt: true,
            },
        });

        let applicationRound = await jobRound.findFirst({
            where: {
                jobId: job.id,
                roundType: "application_review",
            },
            orderBy: { roundNumber: "asc" },
            select: { id: true },
        });
        if (!applicationRound) {
            const latestRound = await jobRound.findFirst({
                where: { jobId: job.id },
                orderBy: { roundNumber: "desc" },
                select: { roundNumber: true },
            });
            applicationRound = await jobRound.create({
                data: {
                    jobId: job.id,
                    companyId: job.companyId,
                    roundNumber: Number(latestRound?.roundNumber || 0) + 1,
                    roundType: "application_review",
                    title: `${job.title} - application review`,
                    status: "open",
                    opensAt: job.publishedAt || job.createdAt || new Date(),
                    closesAt: job.applicationDeadline || null,
                    config: { source: "quick_apply" },
                },
                select: { id: true },
            });
        }

        const applicationRoundCandidate = await jobRoundCandidate.upsert({
            where: {
                roundId_applicationId: {
                    roundId: applicationRound.id,
                    applicationId: application.id,
                },
            },
            create: {
                roundId: applicationRound.id,
                applicationId: application.id,
                userId,
                status: "evaluated",
                advanced: false,
                score: overallScore,
                submittedAt: application.submittedAt,
                evaluatedAt: new Date(),
                metadata: {
                    githubScore,
                    codingScore,
                    projectScores,
                },
            },
            update: {
                status: "evaluated",
                score: overallScore,
                submittedAt: application.submittedAt,
                evaluatedAt: new Date(),
                metadata: {
                    githubScore,
                    codingScore,
                    projectScores,
                },
            },
            select: { id: true },
        });

        await jobRoundEvaluationReport.upsert({
            where: { roundCandidateId: applicationRoundCandidate.id },
            create: {
                roundCandidateId: applicationRoundCandidate.id,
                jobRoundId: applicationRound.id,
                applicationId: application.id,
                userId,
                roundType: "application_review",
                overallScore,
                evidenceSnapshot: evidencePack,
                rubricBreakdown: {
                    githubScore,
                    codingScore,
                    projectScores,
                    scoringConfig,
                },
                aiSummary: recruiterProfileSummary || null,
                report: recruiterAnalysis,
            },
            update: {
                overallScore,
                evidenceSnapshot: evidencePack,
                rubricBreakdown: {
                    githubScore,
                    codingScore,
                    projectScores,
                    scoringConfig,
                },
                aiSummary: recruiterProfileSummary || null,
                report: recruiterAnalysis,
                evaluatedAt: new Date(),
            },
        });

        return reply.status(201).send({
            application,
            message: "Application submitted.",
        });
    });
}
