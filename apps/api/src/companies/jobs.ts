import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { checkRateLimit } from "../lib/rate-limiter.js";
import { uploadToR2Avatar } from "../lib/r2.js";
import { isCompanyAdminRole, requireCompanyWorkspaceAccess } from "./access.js";
import {
    buildEvidencePack,
    buildRecruiterAgentAnalysis,
    codingScorecardForJob,
    codingScoreForJob,
    normalizeScoringConfig as normalizeApplyScoringConfig,
    projectScoreBreakdownForJob,
    projectScoreForJob,
} from "../routes/jobs.js";

const companyJobOpening = (prisma as any).companyJobOpening;
const jobApplication = (prisma as any).jobApplication;
const jobApplyProfile = (prisma as any).jobApplyProfile;
const technicalAssignment = (prisma as any).technicalAssignment;
const technicalAssignmentSubmission = (prisma as any).technicalAssignmentSubmission;
const jobRound = (prisma as any).jobRound;
const jobRoundCandidate = (prisma as any).jobRoundCandidate;
const jobRoundEvaluationReport = (prisma as any).jobRoundEvaluationReport;
const directInterview = (prisma as any).directInterview;

const nonEmptyText = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
    z.preprocess(
        (value) => (typeof value === "string" && value.trim() === "" ? null : value),
        z.string().trim().max(max).optional().nullable()
    );
const optionalUrl = z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z.string().trim().max(2000).refine((value) => {
        try {
            const parsed = new URL(value);
            return parsed.protocol === "http:" || parsed.protocol === "https:";
        } catch {
            return value.startsWith("/");
        }
    }, "Must be a valid HTTP URL or app-relative path.").optional().nullable()
);
const textList = z.array(z.string().trim().min(1).max(240)).max(40).default([]);
const statusSchema = z.enum(["draft", "open", "closed"]);
const applicationStatusSchema = z.enum(["submitted", "next_round", "rejected", "hired"]);
const nextRoundPipelineSchema = z.enum(["ai_interview", "mock_oa", "technical_assignment", "final_interview"]);
const weightsTotal100 = (value: Record<string, number>) =>
    Object.values(value).reduce((sum, item) => sum + Number(item || 0), 0) === 100;
function parseDateOnly(value: unknown) {
    const invalidDate = new Date(Number.NaN);
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? invalidDate : value;
    if (value === undefined || value === null) return null;
    if (typeof value !== "string") return invalidDate;

    const clean = value.trim();
    if (!clean) return null;

    const iso = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) {
        const [, year, month, day] = iso;
        return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    }

    const indian = clean.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (indian) {
        const [, day, month, year] = indian;
        return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    }

    const parsed = new Date(clean);
    return Number.isNaN(parsed.getTime()) ? invalidDate : parsed;
}
function validationMessages(error: z.ZodError) {
    return error.issues.map((issue) => {
        const path = issue.path.length ? issue.path.map(String).join(".") : "body";
        return `${path}: ${issue.message}`;
    });
}

function validationPayload(error: z.ZodError) {
    const messages = validationMessages(error);
    return {
        error: "Validation Error",
        message: messages[0] || "Fix the highlighted fields and try again.",
        details: error.flatten().fieldErrors,
        issues: messages,
    };
}
const nextRoundSchema = z.object({
    topCount: z.coerce.number().int().min(0).max(500).default(0),
    applicationIds: z.array(z.string().uuid()).max(500).default([]),
    pipelineType: nextRoundPipelineSchema,
    sourceAssignmentId: z.string().uuid().optional().nullable(),
});
const nextRoundPipelineLabels: Record<z.infer<typeof nextRoundPipelineSchema>, string> = {
    ai_interview: "AI based interview",
    mock_oa: "online assessment",
    technical_assignment: "technical assignment",
    final_interview: "direct final interview",
};

async function createNextRoundRows({
    job,
    pipelineType,
    selectedApplications,
    movedAt,
    sourceAssignmentId,
    scoreByApplicationId,
}: {
    job: any;
    pipelineType: z.infer<typeof nextRoundPipelineSchema>;
    selectedApplications: any[];
    movedAt: Date;
    sourceAssignmentId?: string | null;
    scoreByApplicationId?: Map<string, number>;
}) {
    const targetRoundFilters = sourceAssignmentId
        ? [{ config: { path: ["sourceAssignmentId"], equals: sourceAssignmentId } }]
        : [
            { config: { path: ["source"], equals: "application_review_shortlist" } },
            { config: { path: ["source"], equals: "legacy_next_round" } },
        ];
    let round = await jobRound.findFirst({
        where: {
            jobId: job.id,
            companyId: job.companyId,
            OR: targetRoundFilters,
        },
        orderBy: { roundNumber: "desc" },
        select: { id: true, roundNumber: true, roundType: true, status: true, resourceId: true },
    });

    if (round) {
        const needsSetup = pipelineType === "technical_assignment" || pipelineType === "mock_oa" || pipelineType === "ai_interview";
        const desiredStatus = needsSetup && !round.resourceId ? "draft" : "open";
        round = await jobRound.update({
            where: { id: round.id },
            data: {
                roundType: pipelineType,
                title: `${job.title} - ${nextRoundPipelineLabels[pipelineType]}`,
                status: desiredStatus,
                opensAt: movedAt,
                closesAt: needsSetup ? undefined : null,
                resourceId: needsSetup ? round.resourceId || null : null,
                config: {
                    source: sourceAssignmentId ? "technical_assignment_shortlist" : "application_review_shortlist",
                    sourceAssignmentId: sourceAssignmentId || null,
                    updatedAt: movedAt.toISOString(),
                },
            },
            select: { id: true, roundNumber: true, roundType: true, status: true, resourceId: true },
        });
    } else {
        const desiredStatus = pipelineType === "technical_assignment" || pipelineType === "mock_oa" || pipelineType === "ai_interview" ? "draft" : "open";
        const latestRound = await jobRound.findFirst({
            where: { jobId: job.id },
            orderBy: { roundNumber: "desc" },
            select: { roundNumber: true },
        });
        const roundNumber = Number(latestRound?.roundNumber || 0) + 1;
        round = await jobRound.create({
            data: {
                jobId: job.id,
                companyId: job.companyId,
                roundNumber,
                roundType: pipelineType,
                title: `${job.title} - ${nextRoundPipelineLabels[pipelineType]}`,
                status: desiredStatus,
                opensAt: movedAt,
                config: {
                    source: sourceAssignmentId ? "technical_assignment_shortlist" : "application_review_shortlist",
                    sourceAssignmentId: sourceAssignmentId || null,
                    createdAt: movedAt.toISOString(),
                },
            },
            select: { id: true, roundNumber: true, roundType: true, status: true, resourceId: true },
        });
    }

    await jobRoundCandidate.createMany({
        data: selectedApplications.map((application: any) => ({
            roundId: round.id,
            applicationId: application.id,
            userId: application.user.id,
            status: "invited",
            advanced: false,
            score: Math.max(0, Math.min(100, Math.round(scoreByApplicationId?.get(application.id) || 0))),
            metadata: {
                sourceAssignmentId: sourceAssignmentId || null,
                selectedAt: movedAt.toISOString(),
            },
        })),
        skipDuplicates: true,
    });

    const candidates = await jobRoundCandidate.findMany({
        where: { roundId: round.id },
        select: { id: true, applicationId: true, userId: true, score: true },
    });

    if (pipelineType === "final_interview") {
        await directInterview.createMany({
            data: candidates.map((candidate: any) => ({
                jobRoundCandidateId: candidate.id,
                companyId: job.companyId,
                jobId: job.id,
                applicationId: candidate.applicationId,
                roundId: round.id,
                candidateUserId: candidate.userId,
                status: "shortlisted",
                selectedFrom: sourceAssignmentId ? "technical_assignment" : "application_review",
                score: Math.max(0, Math.min(100, Math.round(candidate.score || 0))),
            })),
            skipDuplicates: true,
        });
    }

    return {
        round,
        candidateByApplicationId: new Map<string, any>(candidates.map((candidate: any) => [candidate.applicationId, candidate])),
    };
}
const assignmentRubricSchema = z.object({
    functionality: z.coerce.number().int().min(0).max(100).default(25),
    architecture: z.coerce.number().int().min(0).max(100).default(15),
    codeQuality: z.coerce.number().int().min(0).max(100).default(15),
    documentation: z.coerce.number().int().min(0).max(100).default(15),
    testing: z.coerce.number().int().min(0).max(100).default(10),
    productThinking: z.coerce.number().int().min(0).max(100).default(10),
    security: z.coerce.number().int().min(0).max(100).default(10),
}).refine(weightsTotal100, {
    message: "Assignment rubric weights must add up to 100.",
    path: ["security"],
});
function parseDurationHours(value: string) {
    const clean = value.trim().toLowerCase();
    const days = Number.parseFloat(clean.match(/(\d+(?:\.\d+)?)\s*(?:d|day|days)\b/)?.[1] || "");
    const hours = Number.parseFloat(clean.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/)?.[1] || "");
    const minutes = Number.parseFloat(clean.match(/(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes)\b/)?.[1] || "");

    if (Number.isFinite(days) || Number.isFinite(hours) || Number.isFinite(minutes)) {
        const total =
            (Number.isFinite(days) ? days * 24 : 0) +
            (Number.isFinite(hours) ? hours : 0) +
            (Number.isFinite(minutes) ? minutes / 60 : 0);
        return total > 0 ? total : null;
    }

    const amount = Number.parseFloat(clean.match(/\d+(?:\.\d+)?/)?.[0] || "");
    if (!Number.isFinite(amount) || amount <= 0) return null;

    if (/\b(week|weeks)\b/.test(clean)) return amount * 7 * 24;
    if (/\b(month|months)\b/.test(clean)) return amount * 30 * 24;
    return amount;
}
const technicalAssignmentSchema = z.object({
    sourceAssignmentId: z.string().uuid().optional().nullable(),
    title: nonEmptyText(160),
    timeLimit: nonEmptyText(80),
    estimatedHours: optionalText(80),
    deadlinePolicy: optionalText(2000),
    overview: nonEmptyText(4000),
    scenario: nonEmptyText(6000),
    tasks: textList,
    starterContext: optionalText(6000),
    constraints: textList,
    allowedStack: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
    deliverables: textList,
    submissionInstructions: optionalText(3000),
    thinkingQuestions: textList,
    candidateMessage: optionalText(2000),
    rubric: assignmentRubricSchema,
}).superRefine((data, ctx) => {
    const submissionWindowHours = parseDurationHours(data.timeLimit);
    const expectedEffortHours = data.estimatedHours ? parseDurationHours(data.estimatedHours) : null;

    if (submissionWindowHours === null) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Submission window must include a valid duration, like 48 hours or 2 days.",
            path: ["timeLimit"],
        });
    }

    if (data.estimatedHours && expectedEffortHours === null) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Expected effort must include a valid duration, like 6-8 hours.",
            path: ["estimatedHours"],
        });
    }

    if (submissionWindowHours !== null && expectedEffortHours !== null && expectedEffortHours > submissionWindowHours) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Expected effort cannot be greater than the submission window.",
            path: ["estimatedHours"],
        });
    }
});
const scoringConfigSchema = z.object({
    weights: z.object({
        github: z.coerce.number().int().min(0).max(100).default(60),
        coding: z.coerce.number().int().min(0).max(100).default(40),
    }).refine(weightsTotal100, {
        message: "GitHub and coding profile weights must add up to 100.",
        path: ["coding"],
    }).default({ github: 60, coding: 40 }),
    github: z.object({
        requiredTechStack: z.array(z.string().trim().min(1).max(160)).max(30).default([]),
        focusAreas: z.array(z.string().trim().min(1).max(160)).max(20).default([]),
        minCommitsLastYear: z.coerce.number().int().min(0).max(5000).default(20),
        minCommitsLastMonth: z.coerce.number().int().min(0).max(1000).default(2),
        minOwnershipPercent: z.coerce.number().int().min(0).max(100).default(50),
        minProjectAgeDays: z.coerce.number().int().min(0).max(3650).default(30),
        criteriaWeights: z.object({
            stack: z.coerce.number().int().min(0).max(100).default(20),
            commits: z.coerce.number().int().min(0).max(100).default(20),
            ownership: z.coerce.number().int().min(0).max(100).default(15),
            documentation: z.coerce.number().int().min(0).max(100).default(15),
            complexity: z.coerce.number().int().min(0).max(100).default(15),
            relevance: z.coerce.number().int().min(0).max(100).default(15),
        }).refine(weightsTotal100, {
            message: "GitHub criteria weights must add up to 100.",
            path: ["relevance"],
        }).default({ stack: 20, commits: 20, ownership: 15, documentation: 15, complexity: 15, relevance: 15 }),
    }).default({
        requiredTechStack: [],
        focusAreas: [],
        minCommitsLastYear: 20,
        minCommitsLastMonth: 2,
        minOwnershipPercent: 50,
        minProjectAgeDays: 30,
        criteriaWeights: { stack: 20, commits: 20, ownership: 15, documentation: 15, complexity: 15, relevance: 15 },
    }),
    coding: z.object({
        minLinkedProfiles: z.coerce.number().int().min(1).max(4).default(1),
        leetcode: z.object({
            minTotal: z.coerce.number().int().min(0).max(5000).default(100),
            minEasy: z.coerce.number().int().min(0).max(2000).default(40),
            minMedium: z.coerce.number().int().min(0).max(3000).default(40),
            minHard: z.coerce.number().int().min(0).max(1000).default(5),
        }).default({ minTotal: 100, minEasy: 40, minMedium: 40, minHard: 5 }),
        codeforces: z.object({
            minRating: z.coerce.number().int().min(0).max(4000).default(1200),
            minContests: z.coerce.number().int().min(0).max(500).default(5),
            minSolved: z.coerce.number().int().min(0).max(5000).default(100),
        }).default({ minRating: 1200, minContests: 5, minSolved: 100 }),
        criteriaWeights: z.object({
            leetcode: z.coerce.number().int().min(0).max(100).default(45),
            codeforces: z.coerce.number().int().min(0).max(100).default(35),
            profileCoverage: z.coerce.number().int().min(0).max(100).default(20),
        }).refine(weightsTotal100, {
            message: "Coding criteria weights must add up to 100.",
            path: ["profileCoverage"],
        }).default({ leetcode: 45, codeforces: 35, profileCoverage: 20 }),
    }).default({
        minLinkedProfiles: 1,
        leetcode: { minTotal: 100, minEasy: 40, minMedium: 40, minHard: 5 },
        codeforces: { minRating: 1200, minContests: 5, minSolved: 100 },
        criteriaWeights: { leetcode: 45, codeforces: 35, profileCoverage: 20 },
    }),
}).default({});

const jobOpeningSchema = z.object({
    companyName: nonEmptyText(120),
    companyLogoUrl: optionalUrl,
    title: nonEmptyText(140),
    location: nonEmptyText(140),
    workMode: nonEmptyText(60),
    employmentType: nonEmptyText(60),
    roleType: nonEmptyText(80),
    profession: nonEmptyText(120),
    discipline: nonEmptyText(120),
    travel: nonEmptyText(60),
    openings: z.coerce.number().int().min(1).max(500).default(1),
    experienceLevel: nonEmptyText(80),
    compensationType: nonEmptyText(80),
    compensation: optionalText(120),
    duration: optionalText(120),
    timeCommitment: optionalText(120),
    applicationDeadline: z.preprocess(parseDateOnly, z.date().optional().nullable()),
    skills: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
    companyOverview: optionalText(4000),
    aboutRole: nonEmptyText(4000),
    responsibilities: textList,
    requirements: textList,
    benefits: textList,
    applicationNote: optionalText(2000),
    scoringConfig: scoringConfigSchema,
    status: statusSchema.default("open"),
});

const jobIdParamsSchema = z.object({
    id: z.string().uuid(),
});
const technicalAssignmentParamsSchema = z.object({
    assignmentId: z.string().uuid(),
});
const jobApplicationParamsSchema = z.object({
    id: z.string().uuid(),
    applicationId: z.string().uuid(),
});

async function requireCompanyAdminForWrites(request: FastifyRequest, reply: FastifyReply) {
    if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") return;
    if (request.company && isCompanyAdminRole(request.company.role)) return;

    return reply.status(403).send({
        error: "Forbidden",
        message: "Only company owners and admins can change company hiring resources.",
    });
}

async function requireCompanyHiringPageAccess(request: FastifyRequest, reply: FastifyReply) {
    if (request.company?.role !== "viewer") return;

    return reply.status(403).send({
        error: "Forbidden",
        message: "You don't have access to Jobs or Assessments. Ask a company owner or admin for access.",
    });
}

function toResponse(job: any) {
    const activeRound = Array.isArray(job.rounds)
        ? job.rounds.find((round: any) => {
            if (round.status === "closed") return false;
            if (round.closesAt && new Date(round.closesAt).getTime() <= Date.now()) return false;
            return true;
        })
        : null;
    const pendingSetupRound = activeRound && (
        activeRound.status === "draft" ||
        (activeRound.roundType === "technical_assignment" && !activeRound.resourceId)
    );
    const responseNextRoundType = pendingSetupRound
        ? activeRound.roundType
        : job.rounds ? null : job.nextRoundType ?? null;
    const responseCurrentRoundType = activeRound && !pendingSetupRound
        ? activeRound.roundType
        : job.rounds ? null : job.currentRoundType ?? null;
    const responseCurrentRoundResourceId = activeRound && !pendingSetupRound
        ? activeRound.resourceId ?? activeRound.id
        : job.rounds ? null : job.currentRoundResourceId ?? null;
    const responseCurrentRoundConfiguredAt = activeRound && !pendingSetupRound
        ? activeRound.updatedAt ?? activeRound.createdAt ?? null
        : job.rounds ? null : job.currentRoundConfiguredAt ?? null;

    return {
        id: job.id,
        companyId: job.companyId,
        companyName: job.companyName,
        companyLogoUrl: job.companyLogoUrl,
        title: job.title,
        location: job.location,
        workMode: job.workMode,
        employmentType: job.employmentType,
        roleType: job.roleType,
        profession: job.profession,
        discipline: job.discipline,
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
        scoringConfig: normalizeScoringConfig(job.scoringConfig),
        nextRoundType: responseNextRoundType,
        nextRoundConfiguredAt: job.nextRoundConfiguredAt?.toISOString() ?? null,
        currentRoundType: responseCurrentRoundType,
        currentRoundResourceId: responseCurrentRoundResourceId,
        currentRoundConfiguredAt: responseCurrentRoundConfiguredAt?.toISOString?.() ?? responseCurrentRoundConfiguredAt ?? null,
        status: job.status,
        applicationCount: job._count?.applications ?? 0,
        publishedAt: job.publishedAt?.toISOString() ?? null,
        createdAt: job.createdAt.toISOString(),
        updatedAt: job.updatedAt.toISOString(),
    };
}

function toRecord(value: unknown): Record<string, any> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function score(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 0;
}

function normalizeScoringConfig(value: unknown) {
    return normalizeApplyScoringConfig(value);
}

function scoreProjectAgainstCriteria(project: Record<string, any>, config: ReturnType<typeof normalizeScoringConfig>, job: Record<string, any>) {
    return projectScoreBreakdownForJob(project, config, job);
}

function scoreCodingAgainstCriteria(codingAnalysis: Record<string, any>, codingProfiles: Record<string, any>, config: ReturnType<typeof normalizeScoringConfig>) {
    return codingScorecardForJob(codingAnalysis, codingProfiles, config);
}

function buildProfileSummary(profile: Record<string, any> | null | undefined) {
    if (!profile) return "No public recruiter profile summary was available for this candidate.";
    const skills = Array.isArray(profile.skills) ? profile.skills.map((item: any) => item?.name || item).filter(Boolean).slice(0, 6) : [];
    return [
        profile.headline ? `Headline: ${profile.headline}` : "",
        profile.openTo ? `Open to: ${profile.openTo}` : "",
        profile.city || profile.country ? `Location: ${[profile.city, profile.country].filter(Boolean).join(", ")}` : "",
        skills.length ? `Top skills: ${skills.join(", ")}` : "",
        profile.about ? `Summary: ${String(profile.about).replace(/\s+/g, " ").slice(0, 280)}${String(profile.about).length > 280 ? "..." : ""}` : "",
    ].filter(Boolean).join(" | ") || "Profile exists, but the candidate has not filled enough summary fields yet.";
}

function textArray(value: unknown) {
    return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean).slice(0, 4) : [];
}

function joinLines(value: unknown) {
    return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean).join("\n") : "";
}

function joinComma(value: unknown) {
    return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean).join(", ") : "";
}

function assignmentDurationMs(value: string) {
    const hours = parseDurationHours(value);
    return Math.max(1, hours || 48) * 60 * 60 * 1000;
}

function assignmentStatus(closesAt: Date, status?: string | null) {
    if (status === "closed") return "closed";
    return closesAt.getTime() <= Date.now() ? "closed" : "live";
}

function toSubmissionReport(value: unknown) {
    const report = toRecord(value);
    const rubric = Array.isArray(report.rubric)
        ? report.rubric.map((item: any) => ({
            label: String(item?.label || "Rubric"),
            score: score(item?.score),
            weight: score(item?.weight),
        }))
        : [];

    return {
        summary: typeof report.summary === "string" && report.summary.trim()
            ? report.summary
            : "Evaluation report has not been generated yet.",
        strengths: Array.isArray(report.strengths) ? report.strengths.map(String).filter(Boolean) : [],
        risks: Array.isArray(report.risks) ? report.risks.map(String).filter(Boolean) : [],
        rubric,
    };
}

function toTechnicalAssignmentSubmissionResponse(submission: any) {
    const roundAdvancedAt = submission.roundCandidate?.advancedAt || submission.nextRoundMovedAt || null;
    return {
        id: submission.id,
        applicationId: submission.applicationId || null,
        applicationStatus: submission.application?.status || null,
        nextRoundType: submission.application?.nextRoundType || null,
        roundNextRoundType: submission.nextRoundType || null,
        roundNextRoundMovedAt: roundAdvancedAt?.toISOString?.() ?? null,
        roundAdvanced: Boolean(submission.roundCandidate?.advanced || submission.nextRoundMovedAt),
        candidateName: submission.user?.fullName || "Candidate",
        candidateEmail: submission.user?.email || "",
        profileUrl: submission.user?.username ? `/profile/${submission.user.username}` : null,
        avatarUrl: submission.user?.avatarUrl || null,
        repoUrl: submission.repoUrl,
        submittedAt: submission.submittedAt.toISOString(),
        score: score(submission.score),
        status: submission.status,
        report: toSubmissionReport(submission.report),
    };
}

function toTechnicalAssignmentResponse(assignment: any) {
    const rubric = toRecord(assignment.rubric);
    const targetRound = assignment.nextRound || null;
    const targetRoundClosed = targetRound?.closesAt ? new Date(targetRound.closesAt).getTime() <= Date.now() : false;
    const targetRoundConfigured = Boolean(targetRound) &&
        !targetRoundClosed &&
        targetRound.status !== "draft" &&
        !(targetRound.roundType === "technical_assignment" && !targetRound.resourceId);
    const targetCurrentRoundType = targetRoundConfigured ? targetRound.roundType : null;
    const targetCurrentRoundResourceId = targetRoundConfigured ? targetRound.resourceId || targetRound.id : null;
    const targetCurrentRoundConfiguredAt = targetRoundConfigured
        ? targetRound.updatedAt || targetRound.createdAt || null
        : null;

    return {
        id: assignment.id,
        jobId: assignment.jobId,
        jobTitle: assignment.job?.title || "",
        companyName: assignment.job?.companyName || assignment.company?.name || "",
        jobNextRoundType: targetRound?.roundType ?? assignment.job?.nextRoundType ?? null,
        jobNextRoundConfiguredAt: assignment.job?.nextRoundConfiguredAt?.toISOString?.() ?? null,
        jobCurrentRoundType: targetRound ? targetCurrentRoundType : assignment.job?.currentRoundType ?? null,
        jobCurrentRoundResourceId: targetRound ? targetCurrentRoundResourceId : assignment.job?.currentRoundResourceId ?? null,
        jobCurrentRoundConfiguredAt: targetRound
            ? targetCurrentRoundConfiguredAt?.toISOString?.() ?? targetCurrentRoundConfiguredAt ?? null
            : assignment.job?.currentRoundConfiguredAt?.toISOString?.() ?? null,
        createdAt: assignment.createdAt.toISOString(),
        closesAt: assignment.closesAt.toISOString(),
        status: assignmentStatus(assignment.closesAt, assignment.status),
        config: {
            title: assignment.title,
            timeLimit: assignment.timeLimit,
            estimatedHours: assignment.estimatedHours || "",
            deadlinePolicy: assignment.deadlinePolicy || "",
            overview: assignment.overview,
            scenario: assignment.scenario,
            tasks: joinLines(assignment.tasks),
            starterContext: assignment.starterContext || "",
            constraints: joinLines(assignment.constraints),
            allowedStack: joinComma(assignment.allowedStack),
            deliverables: joinLines(assignment.deliverables),
            submissionInstructions: assignment.submissionInstructions || "",
            thinkingQuestions: joinLines(assignment.thinkingQuestions),
            candidateMessage: assignment.candidateMessage || "",
            functionalityWeight: String(rubric.functionality ?? 25),
            architectureWeight: String(rubric.architecture ?? 15),
            codeQualityWeight: String(rubric.codeQuality ?? 15),
            documentationWeight: String(rubric.documentation ?? 15),
            testingWeight: String(rubric.testing ?? 10),
            productThinkingWeight: String(rubric.productThinking ?? 10),
            securityWeight: String(rubric.security ?? 10),
        },
        submissions: Array.isArray(assignment.submissions)
            ? assignment.submissions.map(toTechnicalAssignmentSubmissionResponse)
            : [],
    };
}

async function attachAssignmentTargetRounds(assignments: any[], companyId: string) {
    const assignmentIds = assignments.map((assignment) => assignment.id).filter(Boolean);
    if (!assignmentIds.length) return assignments;

    const targetRounds = await jobRound.findMany({
        where: {
            companyId,
            OR: assignmentIds.map((assignmentId) => ({
                config: { path: ["sourceAssignmentId"], equals: assignmentId },
            })),
        },
        orderBy: { roundNumber: "desc" },
        select: {
            id: true,
            roundType: true,
            status: true,
            resourceId: true,
            config: true,
            closesAt: true,
            createdAt: true,
            updatedAt: true,
        },
    });
    const targetByAssignmentId = new Map<string, any>();
    for (const round of targetRounds) {
        const sourceAssignmentId = toRecord(round.config).sourceAssignmentId;
        if (typeof sourceAssignmentId === "string" && !targetByAssignmentId.has(sourceAssignmentId)) {
            targetByAssignmentId.set(sourceAssignmentId, round);
        }
    }

    return assignments.map((assignment) => ({
        ...assignment,
        nextRound: targetByAssignmentId.get(assignment.id) || null,
    }));
}

function buildAgentProfileSummary(profileAgent: Record<string, any>) {
    const verdict = typeof profileAgent.oneLineVerdict === "string" ? profileAgent.oneLineVerdict.trim() : "";
    const strengths = textArray(profileAgent.relevantStrengths);
    const gaps = textArray(profileAgent.gapsForThisRole);
    const signal = typeof profileAgent.signalNotInResume === "string" ? profileAgent.signalNotInResume.trim() : "";

    if (!verdict && !strengths.length && !gaps.length && !signal) return "";

    return [
        verdict,
        strengths.length ? `Role evidence: ${strengths.join(" ")}` : "",
        gaps.length ? `Gaps to verify: ${gaps.join(" ")}` : "",
        signal ? `Extra signal: ${signal}` : "",
    ].filter(Boolean).join(" ");
}

export function buildRecruiterReport(job: Record<string, any>, application: Record<string, any>, profile?: Record<string, any> | null) {
    const agentAnalysis = toRecord(application.recruiterAnalysis);
    const agents = toRecord(agentAnalysis.agents);
    const profileAgent = toRecord(agents.profileSummary);
    const scoringConfig = normalizeScoringConfig(job.scoringConfig);
    const githubAnalysis = toRecord(application.githubAnalysis);
    const codingAnalysis = toRecord(application.codingAnalysis);
    const githubSnapshot = toRecord(application.githubProfileSnapshot);
    const codingProfiles = toRecord(application.codingProfiles);
    const projects = Array.isArray(githubAnalysis.projects) ? githubAnalysis.projects.map(toRecord) : [];
    const projectSlots = [0, 1, 2].map((index) => {
        const project = projects[index];
        if (!project) {
            return {
                title: `Project slot ${index + 1}`,
                score: 0,
                status: "Missing",
                summary: "No project selected for this slot. This slot contributes 0 to the GitHub score.",
                breakdown: [],
            };
        }
        return scoreProjectAgainstCriteria(project, scoringConfig, job);
    });
    const githubScore = score(projectSlots.reduce((sum, project) => sum + project.score, 0) / 3);
    const codingScorecard = scoreCodingAgainstCriteria(codingAnalysis, codingProfiles, scoringConfig);
    const codingScore = codingScorecard.score;
    const overallScore = score((githubScore * scoringConfig.weights.github + codingScore * scoringConfig.weights.coding) / 100);
    const snapshotYear = toRecord(githubSnapshot.contributionsLastYear);
    const snapshotMonth = toRecord(githubSnapshot.contributionsLastMonth);

    return {
        headline: `${application.user?.fullName || "Candidate"} scored ${overallScore}/100 using this job's scorecard.`,
        profileSummary: buildAgentProfileSummary(profileAgent) || "Profile agent briefing unavailable. Re-run analysis for a job-specific summary.",
        overallScore,
        githubScore,
        codingScore,
        scoringConfig,
        agentAnalysis,
        agentSummary: {
            profileSummary: profileAgent,
            projectQuality: toRecord(agents.projectQuality),
            techStackMatch: toRecord(agents.techStackMatch),
            domainRelevance: toRecord(agents.domainRelevance),
            codingProfile: toRecord(agents.codingProfile),
            finalSynthesis: toRecord(agents.finalSynthesis),
        },
        summary: [
            projects.length < 3 ? `Only ${projects.length}/3 project slot(s) were filled, so ${3 - projects.length} slot(s) scored 0.` : "All 3 project slots were evaluated equally.",
            `Formula: round((${githubScore} x ${scoringConfig.weights.github}% + ${codingScore} x ${scoringConfig.weights.coding}%) / 100) = ${overallScore}.`,
            `GitHub contributes ${scoringConfig.weights.github}% and coding profiles contribute ${scoringConfig.weights.coding}% to the overall score.`,
            typeof githubSnapshot.totalRepos === "number" ? `${githubSnapshot.totalRepos} repo(s), ${githubSnapshot.forkedRepos || 0} fork(s), ${snapshotYear.totalCommitContributions || 0} GitHub commit contribution(s) last year, ${snapshotMonth.totalCommitContributions || 0} last month.` : "",
        ].filter(Boolean),
        charts: {
            overall: [
                { label: "GitHub", value: githubScore, weight: scoringConfig.weights.github },
                { label: "Coding", value: codingScore, weight: scoringConfig.weights.coding },
            ],
            projects: projectSlots.map((project) => ({ label: project.title, value: project.score, status: project.status })),
            coding: codingScorecard.breakdown.map((item) => ({ label: item.label, value: item.score })),
        },
        projectSlots,
        coding: codingScorecard,
        recommendation: overallScore >= 80
            ? "Strong fit for recruiter review."
            : overallScore >= 60
                ? "Potential fit, review weak criteria before shortlisting."
                : "Weak fit against this opening's configured scorecard.",
    };
}

export function storedOrBuiltRecruiterReport(job: Record<string, any>, application: Record<string, any>, profile?: Record<string, any> | null) {
    const stored = toRecord(application.recruiterReport);
    return Object.keys(stored).length ? stored : buildRecruiterReport(job, application, profile);
}

export default async function companyJobRoutes(fastify: FastifyInstance) {
    fastify.decorateRequest("company", null);
    fastify.addHook("preHandler", fastify.authenticate);
    fastify.addHook("preHandler", requireCompanyWorkspaceAccess);
    fastify.addHook("preHandler", requireCompanyHiringPageAccess);
    fastify.addHook("preHandler", requireCompanyAdminForWrites);

    fastify.post("/companies/jobs/assets", async (request, reply) => {
        const companyId = request.company!.id;
        const rl = checkRateLimit(`companies:jobs:asset:${companyId}`, 12, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Upload limit reached. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        const data = await request.file();
        if (!data) {
            return reply.status(400).send({ error: "No file provided", message: "Choose an image file." });
        }

        const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
        if (!allowedTypes.includes(data.mimetype)) {
            return reply.status(400).send({
                error: "Invalid file type",
                message: "Only JPEG, PNG, or WebP images are allowed.",
            });
        }

        const buffer = await data.toBuffer();
        if (buffer.length > 3 * 1024 * 1024) {
            return reply.status(400).send({
                error: "File too large",
                message: "Image must be under 3MB.",
            });
        }

        const ext = data.mimetype === "image/jpeg" ? "jpg" : data.mimetype.split("/")[1];
        const key = `company-jobs/${companyId}/logos/${randomUUID()}.${ext}`;
        const fileUrl = await uploadToR2Avatar(key, buffer, data.mimetype);

        return reply.status(201).send({ fileUrl });
    });

    fastify.get("/companies/jobs", async (request) => {
        const jobs = await companyJobOpening.findMany({
            where: { companyId: request.company!.id },
            include: {
                _count: {
                    select: { applications: true },
                },
                rounds: {
                    where: {
                        status: { in: ["draft", "open"] },
                        roundType: { not: "application_review" },
                    },
                    orderBy: { roundNumber: "desc" },
                    take: 1,
                    select: {
                        id: true,
                        roundType: true,
                        status: true,
                        resourceId: true,
                        closesAt: true,
                        createdAt: true,
                        updatedAt: true,
                    },
                },
            },
            orderBy: { createdAt: "desc" },
        });

        return { jobs: jobs.map(toResponse) };
    });

    fastify.get("/companies/technical-assignments", async (request) => {
        const assignments = await technicalAssignment.findMany({
            where: { companyId: request.company!.id },
            include: {
                job: {
                    select: {
                        id: true,
                        title: true,
                        companyName: true,
                        nextRoundType: true,
                        nextRoundConfiguredAt: true,
                        currentRoundType: true,
                        currentRoundResourceId: true,
                        currentRoundConfiguredAt: true,
                    },
                },
                submissions: {
                    orderBy: { submittedAt: "desc" },
                    select: {
                        id: true,
                        applicationId: true,
                        repoUrl: true,
                        status: true,
                        score: true,
                        report: true,
                        submittedAt: true,
                        nextRoundType: true,
                        nextRoundMovedAt: true,
                        roundCandidate: {
                            select: {
                                advanced: true,
                                advancedAt: true,
                                status: true,
                            },
                        },
                        application: {
                            select: {
                                status: true,
                                nextRoundType: true,
                            },
                        },
                        user: {
                            select: {
                                fullName: true,
                                email: true,
                                username: true,
                                avatarUrl: true,
                            },
                        },
                    },
                },
            },
            orderBy: { closesAt: "asc" },
        });

        const assignmentsWithTargetRounds = await attachAssignmentTargetRounds(assignments, request.company!.id);
        return { assignments: assignmentsWithTargetRounds.map(toTechnicalAssignmentResponse) };
    });

    fastify.post("/companies/jobs/:id/technical-assignment", async (request, reply) => {
        const params = jobIdParamsSchema.safeParse(request.params);
        const parsed = technicalAssignmentSchema.safeParse(request.body);

        if (!params.success || !parsed.success) {
            return reply.status(400).send({
                error: "Validation Error",
                details: {
                    ...(params.success ? {} : params.error.flatten().fieldErrors),
                    ...(parsed.success ? {} : parsed.error.flatten().fieldErrors),
                },
            });
        }

        const companyId = request.company!.id;
        const rl = checkRateLimit(`companies:technical-assignment:${companyId}`, 30, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Technical assignment setup limit reached. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        const job = await companyJobOpening.findFirst({
            where: { id: params.data.id, companyId },
            select: {
                id: true,
                companyId: true,
                title: true,
                companyName: true,
                nextRoundType: true,
            },
        });
        if (!job) {
            return reply.status(404).send({ error: "Not Found", message: "Job opening not found." });
        }

        const sourceAssignmentId = parsed.data.sourceAssignmentId || null;
        if (sourceAssignmentId) {
            const sourceAssignment = await technicalAssignment.findFirst({
                where: {
                    id: sourceAssignmentId,
                    jobId: job.id,
                    companyId,
                },
                select: { id: true },
            });
            if (!sourceAssignment) {
                return reply.status(404).send({
                    error: "Not Found",
                    message: "Source technical assignment round not found.",
                });
            }
        }

        let pendingRound = await jobRound.findFirst({
            where: sourceAssignmentId
                ? {
                    jobId: job.id,
                    companyId,
                    roundType: "technical_assignment",
                    resourceId: null,
                    config: { path: ["sourceAssignmentId"], equals: sourceAssignmentId },
                }
                : {
                    jobId: job.id,
                    companyId,
                    roundType: "technical_assignment",
                    status: { in: ["draft", "open"] },
                    resourceId: null,
                },
            orderBy: { roundNumber: "desc" },
            select: { id: true, roundNumber: true },
        });
        if (!pendingRound) {
            const latestRound = await jobRound.findFirst({
                where: { jobId: job.id },
                orderBy: { roundNumber: "desc" },
                select: { roundNumber: true },
            });
            pendingRound = await jobRound.create({
                data: {
                    jobId: job.id,
                    companyId,
                    roundNumber: Number(latestRound?.roundNumber || 0) + 1,
                    roundType: "technical_assignment",
                    title: `${job.title} - ${nextRoundPipelineLabels.technical_assignment}`,
                    status: "draft",
                    config: {
                        source: sourceAssignmentId ? "technical_assignment_shortlist" : "manual_setup",
                        sourceAssignmentId,
                    },
                },
                select: { id: true, roundNumber: true },
            });
        }

        const existing = await technicalAssignment.findFirst({
            where: { roundId: pendingRound.id },
            select: { id: true, createdAt: true },
        });
        const createdAt = existing?.createdAt || new Date();
        const closesAt = new Date(createdAt.getTime() + assignmentDurationMs(parsed.data.timeLimit));
        const data = parsed.data;

        const assignment = existing
            ? await technicalAssignment.update({
                where: { id: existing.id },
                data: {
                    title: data.title,
                    timeLimit: data.timeLimit,
                    estimatedHours: data.estimatedHours,
                    deadlinePolicy: data.deadlinePolicy,
                    overview: data.overview,
                    scenario: data.scenario,
                    tasks: data.tasks,
                    starterContext: data.starterContext,
                    constraints: data.constraints,
                    allowedStack: data.allowedStack,
                    deliverables: data.deliverables,
                    submissionInstructions: data.submissionInstructions,
                    thinkingQuestions: data.thinkingQuestions,
                    candidateMessage: data.candidateMessage,
                    rubric: data.rubric,
                    status: assignmentStatus(closesAt, "live"),
                    closesAt,
                    roundId: pendingRound.id,
                },
                include: {
                    job: {
                        select: {
                            id: true,
                            title: true,
                            companyName: true,
                            nextRoundType: true,
                            nextRoundConfiguredAt: true,
                            currentRoundType: true,
                            currentRoundResourceId: true,
                            currentRoundConfiguredAt: true,
                        },
                    },
                    submissions: {
                        orderBy: { submittedAt: "desc" },
                        select: {
                            id: true,
                            applicationId: true,
                            repoUrl: true,
                            status: true,
                            score: true,
                            report: true,
                            submittedAt: true,
                            nextRoundType: true,
                            nextRoundMovedAt: true,
                            roundCandidate: {
                                select: {
                                    advanced: true,
                                    advancedAt: true,
                                    status: true,
                                },
                            },
                            application: { select: { status: true, nextRoundType: true } },
                            user: { select: { fullName: true, email: true, username: true, avatarUrl: true } },
                        },
                    },
                },
            })
            : await technicalAssignment.create({
                data: {
                    companyId,
                    jobId: job.id,
                    title: data.title,
                    timeLimit: data.timeLimit,
                    estimatedHours: data.estimatedHours,
                    deadlinePolicy: data.deadlinePolicy,
                    overview: data.overview,
                    scenario: data.scenario,
                    tasks: data.tasks,
                    starterContext: data.starterContext,
                    constraints: data.constraints,
                    allowedStack: data.allowedStack,
                    deliverables: data.deliverables,
                    submissionInstructions: data.submissionInstructions,
                    thinkingQuestions: data.thinkingQuestions,
                    candidateMessage: data.candidateMessage,
                    rubric: data.rubric,
                    closesAt,
                    roundId: pendingRound.id,
                },
                include: {
                    job: {
                        select: {
                            id: true,
                            title: true,
                            companyName: true,
                            nextRoundType: true,
                            nextRoundConfiguredAt: true,
                            currentRoundType: true,
                            currentRoundResourceId: true,
                            currentRoundConfiguredAt: true,
                        },
                    },
                    submissions: {
                        orderBy: { submittedAt: "desc" },
                        select: {
                            id: true,
                            applicationId: true,
                            repoUrl: true,
                            status: true,
                            score: true,
                            report: true,
                            submittedAt: true,
                            nextRoundType: true,
                            nextRoundMovedAt: true,
                            roundCandidate: {
                                select: {
                                    advanced: true,
                                    advancedAt: true,
                                    status: true,
                                },
                            },
                            application: { select: { status: true, nextRoundType: true } },
                            user: { select: { fullName: true, email: true, username: true, avatarUrl: true } },
                        },
                    },
                },
            });

        await jobRound.update({
            where: { id: pendingRound.id },
            data: {
                status: closesAt.getTime() <= Date.now() ? "closed" : "open",
                opensAt: createdAt,
                closesAt,
                resourceId: assignment.id,
            },
        });

        const updatedJob = await companyJobOpening.update({
            where: { id: job.id },
            data: {
                nextRoundType: "technical_assignment",
                nextRoundConfiguredAt: new Date(),
                currentRoundType: "technical_assignment",
                currentRoundResourceId: assignment.id,
                currentRoundConfiguredAt: new Date(),
            },
            include: { _count: { select: { applications: true } } },
        });

        return {
            assignment: toTechnicalAssignmentResponse(assignment),
            job: toResponse(updatedJob),
        };
    });

    fastify.get("/companies/technical-assignments/:assignmentId/submissions", async (request, reply) => {
        const params = technicalAssignmentParamsSchema.safeParse(request.params);
        if (!params.success) {
            return reply.status(400).send({ error: "Validation Error", details: params.error.flatten().fieldErrors });
        }

        const assignment = await technicalAssignment.findFirst({
            where: { id: params.data.assignmentId, companyId: request.company!.id },
            include: {
                job: {
                    select: {
                        id: true,
                        title: true,
                        companyName: true,
                        nextRoundType: true,
                        nextRoundConfiguredAt: true,
                        currentRoundType: true,
                        currentRoundResourceId: true,
                        currentRoundConfiguredAt: true,
                    },
                },
                submissions: {
                    orderBy: { submittedAt: "desc" },
                    select: {
                        id: true,
                        applicationId: true,
                        repoUrl: true,
                        status: true,
                        score: true,
                        report: true,
                        submittedAt: true,
                        nextRoundType: true,
                        nextRoundMovedAt: true,
                        roundCandidate: {
                            select: {
                                advanced: true,
                                advancedAt: true,
                                status: true,
                            },
                        },
                        application: {
                            select: {
                                status: true,
                                nextRoundType: true,
                            },
                        },
                        user: {
                            select: {
                                fullName: true,
                                email: true,
                                username: true,
                                avatarUrl: true,
                            },
                        },
                    },
                },
            },
        });

        if (!assignment) {
            return reply.status(404).send({ error: "Not Found", message: "Technical assignment not found." });
        }

        const [assignmentWithTargetRound] = await attachAssignmentTargetRounds([assignment], request.company!.id);
        return {
            assignment: toTechnicalAssignmentResponse(assignmentWithTargetRound),
            submissions: assignment.submissions.map(toTechnicalAssignmentSubmissionResponse),
        };
    });

    fastify.post("/companies/jobs", async (request, reply) => {
        const companyId = request.company!.id;
        const rl = checkRateLimit(`companies:jobs:create:${companyId}`, 30, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Job creation limit reached. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        const parsed = jobOpeningSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send(validationPayload(parsed.error));
        }

        const data = parsed.data;
        const job = await companyJobOpening.create({
            data: {
                ...data,
                companyId,
                companyName: data.companyName || request.company!.name,
                companyLogoUrl: data.companyLogoUrl || request.company!.logoUrl || null,
                publishedAt: data.status === "open" ? new Date() : null,
            },
        });

        return reply.status(201).send({ job: toResponse(job) });
    });

    fastify.put("/companies/jobs/:id", async (request, reply) => {
        const params = jobIdParamsSchema.safeParse(request.params);
        if (!params.success) {
            return reply.status(400).send({ error: "Validation Error", details: params.error.flatten().fieldErrors });
        }

        const parsed = jobOpeningSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send(validationPayload(parsed.error));
        }

        const existing = await companyJobOpening.findFirst({
            where: { id: params.data.id, companyId: request.company!.id },
            select: {
                id: true,
                title: true,
                companyName: true,
                skills: true,
                aboutRole: true,
                responsibilities: true,
                requirements: true,
                benefits: true,
                scoringConfig: true,
                employmentType: true,
                roleType: true,
                experienceLevel: true,
            },
        });

        if (!existing) {
            return reply.status(404).send({ error: "Not Found", message: "Job opening not found." });
        }

        const data = parsed.data;
        const job = await companyJobOpening.update({
            where: { id: params.data.id },
            data: {
                ...data,
                publishedAt: data.status === "open" ? new Date() : null,
            },
        });

        return { job: toResponse(job) };
    });

    fastify.patch("/companies/jobs/:id/status", async (request, reply) => {
        const params = jobIdParamsSchema.safeParse(request.params);
        const body = z.object({ status: statusSchema }).safeParse(request.body);

        if (!params.success || !body.success) {
            return reply.status(400).send({
                error: "Validation Error",
                details: {
                    ...(params.success ? {} : params.error.flatten().fieldErrors),
                    ...(body.success ? {} : body.error.flatten().fieldErrors),
                },
            });
        }

        const existing = await companyJobOpening.findFirst({
            where: { id: params.data.id, companyId: request.company!.id },
            select: {
                id: true,
                title: true,
                companyName: true,
                skills: true,
                responsibilities: true,
                requirements: true,
                scoringConfig: true,
            },
        });

        if (!existing) {
            return reply.status(404).send({ error: "Not Found", message: "Job opening not found." });
        }

        const job = await companyJobOpening.update({
            where: { id: params.data.id },
            data: {
                status: body.data.status,
                publishedAt: body.data.status === "open" ? new Date() : null,
            },
        });

        return { job: toResponse(job) };
    });

    fastify.get("/companies/jobs/:id/applications", async (request, reply) => {
        const params = jobIdParamsSchema.safeParse(request.params);
        if (!params.success) {
            return reply.status(400).send({ error: "Validation Error", details: params.error.flatten().fieldErrors });
        }

        const existing = await companyJobOpening.findFirst({
            where: { id: params.data.id, companyId: request.company!.id },
            select: {
                id: true,
                title: true,
                companyName: true,
                skills: true,
                responsibilities: true,
                requirements: true,
                scoringConfig: true,
            },
        });

        if (!existing) {
            return reply.status(404).send({ error: "Not Found", message: "Job opening not found." });
        }

        const applications = await jobApplication.findMany({
            where: { jobId: params.data.id },
            orderBy: { submittedAt: "desc" },
            select: {
                id: true,
                status: true,
                selectedProjects: true,
                githubProfileSnapshot: true,
                githubAnalysis: true,
                codingProfiles: true,
                codingAnalysis: true,
                evidencePack: true,
                recruiterAnalysis: true,
                recruiterReport: true,
                nextRoundType: true,
                nextRoundMovedAt: true,
                submittedAt: true,
                user: {
                    select: {
                        id: true,
                        fullName: true,
                        email: true,
                        username: true,
                        avatarUrl: true,
                    },
                },
            },
        });
        const profiles = await jobApplyProfile.findMany({
            where: { userId: { in: applications.map((application: any) => application.user.id) } },
            select: {
                userId: true,
                headline: true,
                city: true,
                country: true,
                about: true,
                openTo: true,
                skills: true,
                projects: true,
            },
        });
        const profileByUserId = new Map(profiles.map((profile: any) => [profile.userId, profile]));

        return {
            applications: applications.map((application: any) => ({
                ...application,
                recruiterReport: storedOrBuiltRecruiterReport(existing, application, profileByUserId.get(application.user.id)),
            })),
        };
    });

    fastify.post("/companies/jobs/:id/applications/next-round", async (request, reply) => {
        const params = jobIdParamsSchema.safeParse(request.params);
        const body = nextRoundSchema.safeParse(request.body);

        if (!params.success || !body.success) {
            return reply.status(400).send({
                error: "Validation Error",
                details: {
                    ...(params.success ? {} : params.error.flatten().fieldErrors),
                    ...(body.success ? {} : body.error.flatten().fieldErrors),
                },
            });
        }

        const companyId = request.company!.id;
        const rl = checkRateLimit(`companies:jobs:next-round:${companyId}`, 30, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Next-round update limit reached. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        const job = await companyJobOpening.findFirst({
            where: { id: params.data.id, companyId },
        });
        if (!job) {
            return reply.status(404).send({ error: "Not Found", message: "Job opening not found." });
        }

        const applications = await jobApplication.findMany({
            where: { jobId: params.data.id },
            select: {
                id: true,
                status: true,
                selectedProjects: true,
                githubProfileSnapshot: true,
                githubAnalysis: true,
                codingProfiles: true,
                codingAnalysis: true,
                evidencePack: true,
                recruiterAnalysis: true,
                recruiterReport: true,
                nextRoundType: true,
                nextRoundMovedAt: true,
                submittedAt: true,
                user: {
                    select: {
                        id: true,
                        fullName: true,
                        email: true,
                        username: true,
                        avatarUrl: true,
                    },
                },
            },
        });

        const sortedByScore = [...applications].sort((first: any, second: any) => {
            const firstReport = storedOrBuiltRecruiterReport(job, first, null);
            const secondReport = storedOrBuiltRecruiterReport(job, second, null);
            return Number(secondReport?.overallScore || 0) - Number(firstReport?.overallScore || 0);
        });
        const selectedIds = new Set<string>([
            ...sortedByScore.slice(0, body.data.topCount).map((application: any) => application.id),
            ...body.data.applicationIds,
        ]);
        const selectedApplications = applications.filter((application: any) => selectedIds.has(application.id));
        let scoreByApplicationId = new Map<string, number>(
            selectedApplications.map((application: any) => [
                application.id,
                Number(storedOrBuiltRecruiterReport(job, application, null)?.overallScore || 0),
            ])
        );

        if (selectedApplications.length === 0) {
            return reply.status(400).send({
                error: "Validation Error",
                message: "Select at least one candidate to move to the next round.",
            });
        }

        let sourceAssignment: any = null;
        const newlyAdvancedApplicationIds = new Set<string>();
        if (body.data.sourceAssignmentId) {
            sourceAssignment = await technicalAssignment.findFirst({
                where: {
                    id: body.data.sourceAssignmentId,
                    jobId: params.data.id,
                    companyId,
                },
                select: {
                    roundId: true,
                    id: true,
                    submissions: {
                        select: {
                            applicationId: true,
                            score: true,
                            nextRoundMovedAt: true,
                            roundCandidate: {
                                select: {
                                    advanced: true,
                                    advancedAt: true,
                                },
                            },
                        },
                    },
                },
            });

            if (!sourceAssignment) {
                return reply.status(404).send({
                    error: "Not Found",
                    message: "Technical assignment round not found for this job.",
                });
            }

            const submittedByApplicationId = new Map<string, any>(
                sourceAssignment.submissions
                    .filter((submission: any) => submission.applicationId)
                    .map((submission: any) => [submission.applicationId, submission])
            );
            const selectedSubmittedApplications = selectedApplications.filter((application: any) =>
                submittedByApplicationId.has(application.id)
            );

            if (selectedSubmittedApplications.length === 0) {
                return reply.status(400).send({
                    error: "Validation Error",
                    message: "Select at least one submitted assignment candidate to move forward.",
                });
            }

            selectedApplications.splice(0, selectedApplications.length, ...selectedSubmittedApplications);
            scoreByApplicationId = new Map<string, number>(
                selectedSubmittedApplications.map((application: any) => [
                    application.id,
                    Number(submittedByApplicationId.get(application.id)?.score || 0),
                ])
            );
            selectedSubmittedApplications.forEach((application: any) => {
                const submission = submittedByApplicationId.get(application.id);
                if (!submission?.nextRoundMovedAt && !submission?.roundCandidate?.advanced) {
                    newlyAdvancedApplicationIds.add(application.id);
                }
            });
        }

        const movedAt = new Date();
        const nextRound = await createNextRoundRows({
            job,
            pipelineType: body.data.pipelineType,
            selectedApplications,
            movedAt,
            sourceAssignmentId: body.data.sourceAssignmentId || null,
            scoreByApplicationId,
        });

        await jobApplication.updateMany({
            where: { id: { in: selectedApplications.map((application: any) => application.id) }, jobId: params.data.id },
            data: {
                status: "next_round",
                nextRoundType: body.data.pipelineType,
                nextRoundMovedAt: movedAt,
            },
        });

        if (!sourceAssignment) {
            const applicationRound = await jobRound.findFirst({
                where: {
                    jobId: params.data.id,
                    roundType: "application_review",
                },
                orderBy: { roundNumber: "asc" },
                select: { id: true },
            });
            if (applicationRound) {
                await jobRoundCandidate.updateMany({
                    where: {
                        roundId: applicationRound.id,
                        applicationId: { in: selectedApplications.map((application: any) => application.id) },
                    },
                    data: {
                        advanced: true,
                        advancedAt: movedAt,
                        status: "shortlisted",
                    },
                });
            }
        }

        if (sourceAssignment) {
            await Promise.all(selectedApplications.map((application: any) =>
                technicalAssignmentSubmission.updateMany({
                    where: {
                        assignmentId: sourceAssignment.id,
                        applicationId: application.id,
                    },
                    data: {
                        nextRoundType: body.data.pipelineType,
                        nextRoundMovedAt: movedAt,
                    },
                })
            ));
            if (sourceAssignment.roundId) {
                await jobRoundCandidate.updateMany({
                    where: {
                        roundId: sourceAssignment.roundId,
                        applicationId: { in: selectedApplications.map((application: any) => application.id) },
                    },
                    data: {
                        advanced: true,
                        advancedAt: movedAt,
                        status: "shortlisted",
                    },
                });
            }
        }

        const setupRequiredRoundId =
            body.data.pipelineType === "technical_assignment" || body.data.pipelineType === "mock_oa" || body.data.pipelineType === "ai_interview"
                ? nextRound.round.resourceId || null
                : nextRound.round.id;
        const updatedJob = await companyJobOpening.update({
            where: { id: job.id },
            data: {
                nextRoundType: body.data.pipelineType,
                nextRoundConfiguredAt: movedAt,
                currentRoundType: setupRequiredRoundId ? body.data.pipelineType : null,
                currentRoundResourceId: setupRequiredRoundId,
                currentRoundConfiguredAt: setupRequiredRoundId ? movedAt : null,
            },
            include: { _count: { select: { applications: true } } },
        });

        const newlyMovedApplications = sourceAssignment
            ? selectedApplications.filter((application: any) => newlyAdvancedApplicationIds.has(application.id))
            : selectedApplications.filter((application: any) => application.status !== "next_round");
        if (newlyMovedApplications.length > 0) {
            await (prisma as any).userNotification.createMany({
                data: newlyMovedApplications.map((application: any) => ({
                    userId: application.user.id,
                    type: "job_next_round",
                    title: "You moved to the next round",
                    message: `You have been moved to the next round for ${job.title} at ${job.companyName}. Stay tuned for future updates.`,
                    href: "/scheduled",
                    metadata: {
                        jobId: job.id,
                        jobTitle: job.title,
                        companyName: job.companyName,
                        pipelineType: body.data.pipelineType,
                        pipelineLabel: nextRoundPipelineLabels[body.data.pipelineType],
                    },
                })),
            });
        }

        const updatedApplications = await jobApplication.findMany({
            where: { jobId: params.data.id },
            orderBy: { submittedAt: "desc" },
            select: {
                id: true,
                status: true,
                selectedProjects: true,
                githubProfileSnapshot: true,
                githubAnalysis: true,
                codingProfiles: true,
                codingAnalysis: true,
                evidencePack: true,
                recruiterAnalysis: true,
                recruiterReport: true,
                nextRoundType: true,
                nextRoundMovedAt: true,
                submittedAt: true,
                user: {
                    select: {
                        id: true,
                        fullName: true,
                        email: true,
                        username: true,
                        avatarUrl: true,
                    },
                },
            },
        });

        const profiles = await jobApplyProfile.findMany({
            where: { userId: { in: updatedApplications.map((application: any) => application.user.id) } },
            select: {
                userId: true,
                headline: true,
                city: true,
                country: true,
                about: true,
                openTo: true,
                skills: true,
                projects: true,
            },
        });
        const profileByUserId = new Map(profiles.map((profile: any) => [profile.userId, profile]));

        return {
            applications: updatedApplications.map((application: any) => ({
                ...application,
                recruiterReport: storedOrBuiltRecruiterReport(updatedJob, application, profileByUserId.get(application.user.id)),
            })),
            job: toResponse(updatedJob),
            movedCount: newlyMovedApplications.length,
            pipelineType: body.data.pipelineType,
            pipelineLabel: nextRoundPipelineLabels[body.data.pipelineType],
        };
    });

    fastify.patch("/companies/jobs/:id/applications/:applicationId/status", async (request, reply) => {
        const params = jobApplicationParamsSchema.safeParse(request.params);
        const body = z.object({ status: applicationStatusSchema }).safeParse(request.body);

        if (!params.success || !body.success) {
            return reply.status(400).send({
                error: "Validation Error",
                details: {
                    ...(params.success ? {} : params.error.flatten().fieldErrors),
                    ...(body.success ? {} : body.error.flatten().fieldErrors),
                },
            });
        }

        const companyId = request.company!.id;
        const rl = checkRateLimit(`companies:jobs:application-status:${companyId}`, 60, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Application update limit reached. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        const job = await companyJobOpening.findFirst({
            where: { id: params.data.id, companyId },
        });
        if (!job) {
            return reply.status(404).send({ error: "Not Found", message: "Job opening not found." });
        }

        const existingApplication = await jobApplication.findFirst({
            where: { id: params.data.applicationId, jobId: params.data.id },
            select: { id: true, userId: true },
        });
        if (!existingApplication) {
            return reply.status(404).send({ error: "Not Found", message: "Application not found." });
        }

        const updatedApplication = await jobApplication.update({
            where: { id: existingApplication.id },
            data: { status: body.data.status },
            select: {
                id: true,
                status: true,
                selectedProjects: true,
                githubProfileSnapshot: true,
                githubAnalysis: true,
                codingProfiles: true,
                codingAnalysis: true,
                evidencePack: true,
                recruiterAnalysis: true,
                recruiterReport: true,
                nextRoundType: true,
                nextRoundMovedAt: true,
                submittedAt: true,
                user: {
                    select: {
                        id: true,
                        fullName: true,
                        email: true,
                        username: true,
                        avatarUrl: true,
                    },
                },
            },
        });

        const profile = await jobApplyProfile.findUnique({
            where: { userId: updatedApplication.user.id },
            select: {
                headline: true,
                city: true,
                country: true,
                about: true,
                openTo: true,
                skills: true,
                projects: true,
            },
        });

        return {
            application: {
                ...updatedApplication,
                recruiterReport: storedOrBuiltRecruiterReport(job, updatedApplication, profile),
            },
        };
    });

    fastify.post("/companies/jobs/:id/applications/:applicationId/reevaluate", async (request, reply) => {
        const params = jobApplicationParamsSchema.safeParse(request.params);
        if (!params.success) {
            return reply.status(400).send({ error: "Validation Error", details: params.error.flatten().fieldErrors });
        }

        const companyId = request.company!.id;
        const rl = checkRateLimit(`companies:jobs:reevaluate:${companyId}`, 20, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Re-evaluation limit reached. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        const job = await companyJobOpening.findFirst({
            where: { id: params.data.id, companyId },
        });
        if (!job) {
            return reply.status(404).send({ error: "Not Found", message: "Job opening not found." });
        }

        const application = await jobApplication.findFirst({
            where: { id: params.data.applicationId, jobId: params.data.id },
            select: {
                id: true,
                status: true,
                selectedProjects: true,
                githubProfileSnapshot: true,
                githubAnalysis: true,
                codingProfiles: true,
                codingAnalysis: true,
                recruiterReport: true,
                submittedAt: true,
                user: {
                    select: {
                        id: true,
                        fullName: true,
                        email: true,
                        username: true,
                        avatarUrl: true,
                    },
                },
            },
        });
        if (!application) {
            return reply.status(404).send({ error: "Not Found", message: "Application not found." });
        }

        const profile = await jobApplyProfile.findUnique({
            where: { userId: application.user.id },
            select: {
                headline: true,
                industry: true,
                city: true,
                country: true,
                about: true,
                openTo: true,
                skills: true,
                experiences: true,
                education: true,
                projects: true,
            },
        });

        const githubAnalysis = toRecord(application.githubAnalysis);
        const storedProjects = Array.isArray(githubAnalysis.projects) ? githubAnalysis.projects.map(toRecord) : [];
        const selectedProjects = Array.isArray(application.selectedProjects) ? application.selectedProjects : [];
        const projectAnalyses = storedProjects.length
            ? storedProjects
            : selectedProjects.map((project: any) => ({ repo: project, score: 0, reason: "Stored GitHub analysis was unavailable." }));
        const scoringConfig = normalizeApplyScoringConfig(job.scoringConfig);
        const projectScores = [0, 1, 2].map((index) => {
            const project = projectAnalyses[index];
            return project ? projectScoreForJob(project, scoringConfig, job) : 0;
        });
        const githubScore = Math.round(projectScores.reduce((sum, item) => sum + item, 0) / 3);
        const codingProfiles = toRecord(application.codingProfiles);
        const codingAnalysis = toRecord(application.codingAnalysis);
        const codingScore = codingScoreForJob(codingAnalysis, codingProfiles, scoringConfig);
        const overallScore = Math.round((githubScore * scoringConfig.weights.github + codingScore * scoringConfig.weights.coding) / 100);
        const scoredCodingAnalysis = { ...codingAnalysis, score: codingScore, scoringConfig };
        const evidencePack = buildEvidencePack({
            job,
            profile,
            selectedProjects,
            githubProfileSnapshot: application.githubProfileSnapshot,
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
        const latestGithubAnalysis = {
            ...githubAnalysis,
            score: githubScore,
            projectScores,
            overallScore,
            scoringConfig,
            projects: projectAnalyses,
            reEvaluatedAt: new Date().toISOString(),
        };
        const latestReport = buildRecruiterReport(job, {
            ...application,
            githubAnalysis: latestGithubAnalysis,
            codingAnalysis: scoredCodingAnalysis,
            evidencePack,
            recruiterAnalysis,
        }, profile);

        const updatedApplication = await jobApplication.update({
            where: { id: application.id },
            data: {
                githubAnalysis: latestGithubAnalysis,
                codingAnalysis: scoredCodingAnalysis,
                evidencePack,
                recruiterAnalysis,
                recruiterReport: latestReport,
            },
            select: {
                id: true,
                status: true,
                selectedProjects: true,
                githubProfileSnapshot: true,
                githubAnalysis: true,
                codingProfiles: true,
                codingAnalysis: true,
                evidencePack: true,
                recruiterAnalysis: true,
                recruiterReport: true,
                nextRoundType: true,
                nextRoundMovedAt: true,
                submittedAt: true,
                user: {
                    select: {
                        id: true,
                        fullName: true,
                        email: true,
                        username: true,
                        avatarUrl: true,
                    },
                },
            },
        });

        const applicationRound = await jobRound.findFirst({
            where: {
                jobId: job.id,
                roundType: "application_review",
            },
            orderBy: { roundNumber: "asc" },
            select: { id: true },
        });
        if (applicationRound) {
            const roundCandidate = await jobRoundCandidate.upsert({
                where: {
                    roundId_applicationId: {
                        roundId: applicationRound.id,
                        applicationId: application.id,
                    },
                },
                create: {
                    roundId: applicationRound.id,
                    applicationId: application.id,
                    userId: updatedApplication.user.id,
                    status: "evaluated",
                    advanced: false,
                    score: overallScore,
                    submittedAt: updatedApplication.submittedAt,
                    evaluatedAt: new Date(),
                    metadata: {
                        githubScore,
                        codingScore,
                        projectScores,
                        source: "company_re_evaluation",
                    },
                },
                update: {
                    status: "evaluated",
                    score: overallScore,
                    evaluatedAt: new Date(),
                    metadata: {
                        githubScore,
                        codingScore,
                        projectScores,
                        source: "company_re_evaluation",
                    },
                },
                select: { id: true },
            });

            await jobRoundEvaluationReport.upsert({
                where: { roundCandidateId: roundCandidate.id },
                create: {
                    roundCandidateId: roundCandidate.id,
                    jobRoundId: applicationRound.id,
                    applicationId: application.id,
                    userId: updatedApplication.user.id,
                    roundType: "application_review",
                    overallScore,
                    evidenceSnapshot: evidencePack,
                    rubricBreakdown: {
                        githubScore,
                        codingScore,
                        projectScores,
                        scoringConfig,
                    },
                    aiSummary: typeof latestReport?.profileSummary === "string" ? latestReport.profileSummary : null,
                    report: latestReport,
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
                    aiSummary: typeof latestReport?.profileSummary === "string" ? latestReport.profileSummary : null,
                    report: latestReport,
                    evaluatedAt: new Date(),
                },
            });
        }

        return {
            application: {
                ...updatedApplication,
                recruiterReport: latestReport,
            },
        };
    });
}
