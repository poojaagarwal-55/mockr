import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { getPresignedDownloadUrl } from "../lib/r2.js";
import { checkRateLimit } from "../lib/rate-limiter.js";
import { sanitizeForLog } from "../lib/log-utils.js";
import { isCompanyAdminRole, requireCompanyWorkspaceAccess } from "./access.js";
import { buildScreeningBlueprint, countBlueprintQuestions, bankTypeForPhase, bankKindLabel, phaseTypeForCategory, type ScreeningBankKind } from "../services/company-ai-screening/blueprint.js";
import { AI_SCREENING_PROCTORING_RULES } from "../services/company-ai-screening/proctoring-rules.js";
import { generateCompanyAiScreeningReport } from "../services/company-ai-screening/report.js";
import { generateScreeningBlueprintDraft, streamScreeningBlueprintDraft } from "../services/company-ai-screening/config-agent.js";

const jobRound = (prisma as any).jobRound;
const companyJobOpening = (prisma as any).companyJobOpening;
const jobRoundEvaluationReport = (prisma as any).jobRoundEvaluationReport;

const paramsSchema = z.object({
    roundId: z.string().uuid(),
});

const submissionParamsSchema = z.object({
    roundId: z.string().uuid(),
    roundCandidateId: z.string().uuid(),
});

const optionalText = (max: number) =>
    z.preprocess(
        (value) => (typeof value === "string" && value.trim() === "" ? null : value),
        z.string().trim().max(max).optional().nullable()
    );

const rubricDimensionSchema = z.object({
    id: z.string().trim().min(1).max(80),
    label: z.string().trim().min(1).max(120),
    weight: z.coerce.number().int().min(0).max(100),
    competencyTags: z.array(z.string().trim().min(1).max(80)).min(1).max(12),
});

// Reference to an existing question-bank question pinned by an ARTIFACT phase. The
// kind is 1:1 with a Mongo collection (dsa/sql/system_design + the role banks). Concept
// phases never carry a ref (they draw from a pool at runtime), so they aren't listed.
const bankQuestionRefSchema = z.object({
    id: z.string().trim().min(1).max(120),
    type: z.enum([
        "dsa", "sql", "system_design",
        "ds_sql", "ds_coding", "genai_coding", "genai_system_design", "pm_case", "problem_solving",
    ]),
    source: z.enum(["platform", "company"]).default("company"),
    title: z.string().trim().max(240).optional().nullable(),
});

const questionSchema = z.object({
    id: z.string().trim().min(1).max(120),
    // Optional: resume questions are auto-grounded on the candidate's resume at
    // runtime, and coding/SQL questions get their text from the referenced bank
    // question. The prompt is only optional spoken framing.
    prompt: z.string().trim().max(4000).default(""),
    // Supported categories. Three buckets:
    //  • Artifact (pin a bank question): coding, cs_sql, system_design, ds_sql, ds_coding,
    //    genai_coding, genai_system_design, pm_case, problem_solving.
    //  • Pool-backed concept/theory (drawn from the bank at runtime, no pin, no prompt):
    //    cs_theory, ds_concepts, genai_concepts, pm_concepts, pm_strategy.
    //  • Prompt/other: resume (auto-grounded), behavioral (notepad), frontend_coding
    //    (deferred — runs as framed conversation), custom. "cs_fundamentals" is a legacy
    //    alias for cs_sql.
    category: z.enum([
        "resume", "coding", "cs_sql", "cs_fundamentals", "cs_theory", "system_design",
        "frontend_coding", "ds_sql", "ds_coding", "ds_concepts", "ds_business_case",
        "genai_coding", "genai_concepts", "genai_system_design",
        "pm_case", "pm_concepts", "pm_strategy", "problem_solving",
        "behavioral", "custom",
    ]),
    competencyTags: z.array(z.string().trim().min(1).max(80)).min(1).max(12),
    expectedPoints: z.array(z.object({
        id: z.string().trim().min(1).max(80),
        text: z.string().trim().max(500),
        competencyTags: z.array(z.string().trim().min(1).max(80)).min(1).max(8),
    })).min(1).max(20),
    // Required for coding/cs_sql (enforced in superRefine); the in-room IDE opens this question.
    bankQuestion: bankQuestionRefSchema.optional().nullable(),
    followUpPolicy: z.object({
        maxFollowUps: z.coerce.number().int().min(0).max(2).default(2),
        askEdgeCases: z.boolean().default(true),
        askOptimization: z.boolean().default(false),
        askOwnershipVerification: z.boolean().default(true),
        askImpact: z.boolean().default(true),
        askTechnicalDepth: z.boolean().default(true),
    }).default({}),
});

// Maps a question category to the ARTIFACT bank kind it pins, or null for phases that
// aren't artifact-backed (resume/behavioral/frontend_coding/custom and the pool-backed
// concept phases). Delegates to the blueprint's single source of truth so the route and
// the runtime can never disagree about what is bank-backed.
function bankTypeForQuestionCategory(category: string): ScreeningBankKind | null {
    return bankTypeForPhase(phaseTypeForCategory(category));
}

const setupSchema = z.object({
    title: z.string().trim().min(1).max(180),
    startAt: z.string().datetime(),
    endAt: z.string().datetime(),
    durationMinutes: z.coerce.number().int().min(10).max(240),
    candidateInstructions: optionalText(4000),
    candidateMessage: optionalText(2000),
    identityCheckLevel: z.enum(["basic", "medium", "high"]).default("medium"),
    requireFullscreen: z.boolean().default(true),
    requireCamera: z.boolean().default(true),
    requireMicrophone: z.boolean().default(true),
    allowRetake: z.boolean().default(false),
    rubric: z.array(rubricDimensionSchema).min(1).max(20),
    questions: z.array(questionSchema).min(1).max(25),
    // Optional precompiled blueprint from the agentic builder. When present it is
    // passed through buildScreeningBlueprint untouched (re-normalizing only rubric
    // weights), so the agent's explicit per-phase durations and phase order survive
    // instead of being re-derived from question counts. questions[] above is still
    // validated (so coding/SQL bank questions are enforced) and stored for the
    // recruiter detail views.
    blueprint: z.any().optional().nullable(),
}).superRefine((data, ctx) => {
    const start = new Date(data.startAt);
    const end = new Date(data.endAt);
    if (Number.isNaN(start.getTime())) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["startAt"], message: "Start date is invalid." });
    }
    if (Number.isNaN(end.getTime())) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endAt"], message: "End date is invalid." });
    }
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end <= start) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endAt"], message: "End date must be after start date." });
    }

    const totalWeight = data.rubric.reduce((sum, dimension) => sum + Number(dimension.weight || 0), 0);
    if (totalWeight !== 100) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rubric"], message: "Rubric weights must add up to 100." });
    }
    if (!data.rubric.some((dimension) => Number(dimension.weight || 0) > 0)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rubric"], message: "At least one rubric dimension must have a non-zero weight." });
    }

    // Coding/SQL/system_design questions must reference a question-bank question whose type
    // matches the category (IDE problem for coding/sql, whiteboard prompt for system_design).
    // behavioral is prompt-based (no bank question) and needs a prompt that carries the
    // problem, since there is no bank text to show the candidate.
    data.questions.forEach((question, index) => {
        const expectedType = bankTypeForQuestionCategory(question.category);
        if (!expectedType) {
            // Non-artifact phases. Only behavioral/custom carry the question in a prompt;
            // resume is auto-grounded, concept phases draw from the pool at runtime, and
            // frontend_coding is deferred — none of those require a prompt here.
            if ((question.category === "behavioral" || question.category === "custom") && !question.prompt.trim()) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ["questions", index, "prompt"],
                    message: `${question.category === "behavioral" ? "Behavioral" : "Custom"} questions need a prompt describing what to ask.`,
                });
            }
            return;
        }
        const label = bankKindLabel(expectedType);
        if (!question.bankQuestion) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["questions", index, "bankQuestion"],
                message: `${label} questions must reference a question from the question bank.`,
            });
        } else if (question.bankQuestion.type !== expectedType) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["questions", index, "bankQuestion"],
                message: `This question expects a ${label.toLowerCase()} bank question.`,
            });
        }
    });
});

// One turn of the recruiter's chat with the JD config agent. The agent returns a
// normalized blueprint draft; this endpoint never persists (the recruiter finalizes
// via /setup). currentDraft is passed back each turn so edits are incremental.
const configAgentSchema = z.object({
    jobDescription: z.string().trim().max(20000).optional().nullable(),
    totalDurationMinutes: z.coerce.number().int().min(10).max(120).optional().nullable(),
    messages: z.array(z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().max(8000),
    })).max(40).default([]),
    // The blueprint from the previous turn. Loosely typed: it is re-normalized by
    // the agent through buildScreeningBlueprint, so a malformed draft can't corrupt state.
    currentDraft: z.any().optional().nullable(),
});

const humanReviewSchema = z.object({
    decision: z.enum(["needs_review", "advance", "hold", "reject"]),
    notes: optionalText(4000),
    rubricReview: z.array(z.object({
        id: z.string().trim().min(1).max(120),
        label: z.string().trim().min(1).max(160).optional(),
        rating: z.coerce.number().int().min(1).max(5).optional().nullable(),
        notes: optionalText(1000),
    })).max(30).default([]),
});

function toRecord(value: unknown): Record<string, any> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function aiInterviewConfig(round: any) {
    return toRecord(toRecord(round.config).aiInterview);
}

function statusForRound(round: any) {
    const config = aiInterviewConfig(round);
    if (!config.configuredAt) return "draft";
    const now = Date.now();
    const startAt = new Date(config.startAt || round.opensAt || 0).getTime();
    const endAt = new Date(config.endAt || round.closesAt || 0).getTime();
    if (Number.isFinite(endAt) && endAt > 0 && now > endAt) return "closed";
    if (Number.isFinite(startAt) && startAt > 0 && now >= startAt) return "live";
    return "scheduled";
}

function candidateName(user: any) {
    return user?.fullName || user?.email?.split("@")[0] || "Candidate";
}

function serializeHumanReview(metadata: Record<string, any>) {
    const review = toRecord(metadata.aiScreeningHumanReview);
    return {
        decision: review.decision || "needs_review",
        notes: review.notes || "",
        rubricReview: Array.isArray(review.rubricReview) ? review.rubricReview : [],
        reviewedAt: review.reviewedAt || null,
        reviewedById: review.reviewedById || null,
    };
}

function serializeRound(round: any) {
    const config = aiInterviewConfig(round);
    const blueprint = buildScreeningBlueprint(config);
    const candidates = Array.isArray(round.candidates) ? round.candidates : [];
    const submissions = candidates
        .filter((candidate: any) => candidate.submittedAt || candidate.evaluatedAt || candidate.report)
        .map((candidate: any) => {
            const metadata = toRecord(candidate.metadata);
            const review = toRecord(metadata.aiScreeningReview);
            const humanReview = serializeHumanReview(metadata);
            return {
                id: candidate.id,
                roundCandidateId: candidate.id,
                applicationId: candidate.applicationId,
                candidateName: candidateName(candidate.user),
                candidateEmail: candidate.user?.email || "",
                avatarUrl: candidate.user?.avatarUrl || null,
                status: candidate.report ? "evaluated" : (candidate.submittedAt ? "submitted" : candidate.status),
                score: candidate.report ? Number(candidate.report.overallScore || 0) : null,
                reviewDecision: humanReview.decision,
                reviewedAt: humanReview.reviewedAt,
                integrityScore: toRecord(candidate.report?.report).integrityScore ?? review.integrityScore ?? null,
                submittedAt: candidate.submittedAt?.toISOString?.() || null,
                evaluatedAt: candidate.evaluatedAt?.toISOString?.() || candidate.report?.evaluatedAt?.toISOString?.() || null,
                report: candidate.report
                    ? {
                        id: candidate.report.id,
                        overallScore: Number(candidate.report.overallScore || 0),
                        aiSummary: candidate.report.aiSummary || "",
                        rubricBreakdown: candidate.report.rubricBreakdown || null,
                        evaluatedAt: candidate.report.evaluatedAt?.toISOString?.() || null,
                    }
                    : null,
            };
        });

    return {
        id: round.id,
        roundId: round.id,
        jobId: round.jobId,
        jobTitle: round.job?.title || "",
        companyName: round.job?.companyName || "",
        status: statusForRound(round),
        configured: Boolean(config.configuredAt),
        title: config.title || round.title || "AI screening interview",
        startAt: config.startAt || round.opensAt?.toISOString?.() || null,
        endAt: config.endAt || round.closesAt?.toISOString?.() || null,
        durationMinutes: config.durationMinutes || null,
        candidateInstructions: config.candidateInstructions || "",
        candidateMessage: config.candidateMessage || "",
        identityCheckLevel: config.identityCheckLevel || "medium",
        requireFullscreen: true,
        requireCamera: true,
        requireMicrophone: true,
        allowRetake: config.allowRetake ?? false,
        rubric: Array.isArray(config.rubric) ? config.rubric : [],
        questions: Array.isArray(config.questions) ? config.questions : [],
        blueprint,
        questionCount: countBlueprintQuestions(blueprint),
        candidateCount: candidates.length,
        submittedCount: submissions.length,
        createdAt: round.createdAt?.toISOString?.() || null,
        updatedAt: round.updatedAt?.toISOString?.() || null,
        submissions,
    };
}

function validationPayload(error: z.ZodError) {
    const first = error.issues[0];
    return {
        error: "Validation Error",
        message: first ? `${first.path.join(".") || "body"}: ${first.message}` : "Fix the highlighted fields.",
        details: error.flatten().fieldErrors,
    };
}

async function requireCompanyAiInterviewAccess(request: FastifyRequest, reply: FastifyReply) {
    if (request.company?.role !== "viewer") return;

    return reply.status(403).send({
        error: "Forbidden",
        message: "You don't have access to AI screening interviews. Ask a company owner or admin for access.",
    });
}

async function requireCompanyAdminForWrites(request: FastifyRequest, reply: FastifyReply) {
    if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") return;
    if (request.company && isCompanyAdminRole(request.company.role)) return;

    return reply.status(403).send({
        error: "Forbidden",
        message: "Only company owners and admins can set up AI screening interviews.",
    });
}

async function handleRouteError(err: unknown, reply: FastifyReply, fastify: FastifyInstance) {
    fastify.log.error(sanitizeForLog(err), "Company AI interview route failed");
    return reply.status(500).send({
        error: "Internal Server Error",
        message: "Internal Server Error. Please check your connection and try again.",
    });
}

function countBy<T extends string>(items: Array<Record<T, string>>, key: T) {
    return items.reduce((counts: Record<string, number>, item) => {
        const value = item[key] || "unknown";
        counts[value] = (counts[value] || 0) + 1;
        return counts;
    }, {});
}

async function loadAiScreeningSubmissionDetail(companyId: string, roundId: string, roundCandidateId: string) {
    const candidate = await (prisma as any).jobRoundCandidate.findFirst({
        where: {
            id: roundCandidateId,
            roundId,
            round: {
                companyId,
                roundType: "ai_interview",
            },
        },
        include: {
            user: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
            report: {
                select: {
                    id: true,
                    overallScore: true,
                    aiSummary: true,
                    rubricBreakdown: true,
                    report: true,
                    evaluatedAt: true,
                },
            },
            round: {
                include: {
                    job: { select: { id: true, title: true, companyName: true, companyLogoUrl: true } },
                },
            },
        },
    });

    if (!candidate) return null;

    const metadata = toRecord(candidate.metadata);
    const attempt = toRecord(metadata.aiScreeningAttempt);
    const automatedReview = toRecord(metadata.aiScreeningReview);
    const humanReview = serializeHumanReview(metadata);
    const config = aiInterviewConfig(candidate.round);
    const interviewSessionId = attempt.interviewSessionId || automatedReview.interviewSessionId || null;
    const proctoringSessionId = attempt.proctoringSessionId || automatedReview.proctoringSessionId || null;

    const [interviewSession, secureSession] = await Promise.all([
        interviewSessionId
            ? (prisma as any).interviewSession.findFirst({
                where: { id: interviewSessionId, userId: candidate.userId },
                include: {
                    messages: { orderBy: { createdAt: "asc" } },
                    sessionQuestions: { orderBy: { askedAt: "asc" } },
                },
            })
            : null,
        proctoringSessionId
            ? (prisma as any).secureOaSession.findFirst({
                where: {
                    id: proctoringSessionId,
                    companyId,
                    jobRoundId: candidate.roundId,
                    jobRoundCandidateId: candidate.id,
                },
            })
            : null,
    ]);

    const [events, snapshots] = secureSession
        ? await Promise.all([
            (prisma as any).proctoringEvent.findMany({
                where: { sessionId: secureSession.id },
                orderBy: { serverTimestamp: "asc" },
                take: 100,
            }),
            (prisma as any).proctoringSnapshot.findMany({
                where: { sessionId: secureSession.id },
                orderBy: { takenAt: "asc" },
                take: 40,
            }),
        ])
        : [[], []];

    const snapshotsWithUrls = await Promise.all(snapshots.map(async (snapshot: any) => ({
        id: snapshot.id,
        url: await getPresignedDownloadUrl(snapshot.s3Key, 300),
        takenAt: snapshot.takenAt?.toISOString?.() || null,
        uploadedAt: snapshot.uploadedAt?.toISOString?.() || null,
        trigger: snapshot.trigger,
        triggeringEventId: snapshot.triggeringEventId || null,
        mimeType: snapshot.mimeType,
        width: snapshot.width,
        height: snapshot.height,
        byteSize: snapshot.byteSize,
    })));

    const transcript = Array.isArray(interviewSession?.messages)
        ? interviewSession.messages
            .filter((message: any) => message.role !== "system")
            .map((message: any) => ({
                id: message.id,
                role: message.role === "assistant" ? "ai" : message.role,
                content: message.content,
                stage: message.stage || null,
                createdAt: message.createdAt?.toISOString?.() || null,
                metadata: message.metadata || null,
            }))
        : [];

    return {
        submission: {
            id: candidate.id,
            roundCandidateId: candidate.id,
            applicationId: candidate.applicationId,
            candidate: {
                id: candidate.user?.id || candidate.userId,
                fullName: candidateName(candidate.user),
                email: candidate.user?.email || "",
                avatarUrl: candidate.user?.avatarUrl || null,
            },
            status: candidate.status,
            submittedAt: candidate.submittedAt?.toISOString?.() || attempt.submittedAt || null,
            startedAt: attempt.startedAt || secureSession?.startedAt?.toISOString?.() || null,
            evaluatedAt: candidate.evaluatedAt?.toISOString?.() || candidate.report?.evaluatedAt?.toISOString?.() || null,
            automatedEvaluation: automatedReview.automatedEvaluation || "manual_review",
            scoringPolicy: toRecord(config.scoringPolicy),
            report: candidate.report
                ? {
                    id: candidate.report.id,
                    overallScore: Number(candidate.report.overallScore || 0),
                    aiSummary: candidate.report.aiSummary || "",
                    rubricBreakdown: candidate.report.rubricBreakdown || null,
                    detail: candidate.report.report || null,
                    evaluatedAt: candidate.report.evaluatedAt?.toISOString?.() || null,
                }
                : null,
            humanReview,
        },
        interview: {
            roundId: candidate.roundId,
            jobId: candidate.round?.jobId || null,
            jobTitle: candidate.round?.job?.title || "",
            companyName: candidate.round?.job?.companyName || "",
            title: config.title || candidate.round?.title || "AI screening interview",
            durationMinutes: config.durationMinutes || null,
            rubric: Array.isArray(config.rubric) ? config.rubric : [],
            questions: Array.isArray(config.questions) ? config.questions : [],
            blueprint: buildScreeningBlueprint(config),
        },
        transcript,
        typedAnswers: Array.isArray(attempt.answers) ? attempt.answers : [],
        sessionQuestions: Array.isArray(interviewSession?.sessionQuestions) ? interviewSession.sessionQuestions.map((question: any) => ({
            id: question.id,
            questionId: question.questionId || question.questionFundamentalId || question.questionSqlId || null,
            title: question.questionTitle || null,
            category: question.questionCategory || null,
            difficulty: question.questionDifficulty || null,
            finalCode: question.finalCode || null,
            sampleAnswer: question.sampleAnswer || null,
            askedAt: question.askedAt?.toISOString?.() || null,
        })) : [],
        proctoring: secureSession
            ? {
                sessionId: secureSession.id,
                status: secureSession.status,
                startedAt: secureSession.startedAt?.toISOString?.() || null,
                submittedAt: secureSession.submittedAt?.toISOString?.() || null,
                terminatedAt: secureSession.terminatedAt?.toISOString?.() || null,
                terminatedReason: secureSession.terminatedReason || null,
                integrityScore: secureSession.integrityScore ?? automatedReview.integrityScore ?? null,
                eventCountsByType: countBy(events, "eventType" as any),
                eventCountsBySeverity: countBy(events, "severity" as any),
                events: events.map((event: any) => ({
                    id: event.id,
                    clientEventId: event.clientEventId,
                    eventType: event.eventType,
                    severity: event.severity,
                    payload: event.payload,
                    clientTimestamp: event.clientTimestamp?.toISOString?.() || null,
                    serverTimestamp: event.serverTimestamp?.toISOString?.() || null,
                    triggeredTermination: Boolean(event.triggeredTermination),
                })),
                snapshots: snapshotsWithUrls,
                rulesSnapshot: secureSession.integrityRulesSnapshot || null,
            }
            : null,
    };
}

export default async function companyAiInterviewRoutes(fastify: FastifyInstance) {
    fastify.decorateRequest("company", null);
    fastify.addHook("preHandler", fastify.authenticate);
    fastify.addHook("preHandler", requireCompanyWorkspaceAccess);
    fastify.addHook("preHandler", requireCompanyAiInterviewAccess);
    fastify.addHook("preHandler", requireCompanyAdminForWrites);

    fastify.get("/companies/ai-interviews", async (request, reply) => {
        const companyId = request.company!.id;
        const rl = checkRateLimit(`companies:ai-interviews:list:${companyId}`, 120, 60_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `AI interview listing limit reached. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        try {
            const rounds = await jobRound.findMany({
                where: { companyId, roundType: "ai_interview" },
                orderBy: { createdAt: "desc" },
                include: {
                    job: { select: { id: true, title: true, companyName: true, companyLogoUrl: true } },
                    candidates: {
                        orderBy: { createdAt: "desc" },
                        include: {
                            user: { select: { fullName: true, email: true, avatarUrl: true } },
                            report: {
                                select: {
                                    id: true,
                                    overallScore: true,
                                    aiSummary: true,
                                    rubricBreakdown: true,
                                    report: true,
                                    evaluatedAt: true,
                                },
                            },
                        },
                    },
                },
            });

            return { interviews: rounds.map(serializeRound) };
        } catch (err) {
            return handleRouteError(err, reply, fastify);
        }
    });

    fastify.post("/companies/ai-interviews/:roundId/setup", async (request, reply) => {
        const params = paramsSchema.safeParse(request.params);
        const parsed = setupSchema.safeParse(request.body);
        if (!params.success || !parsed.success) {
            return reply.status(400).send(params.success ? validationPayload(parsed.error) : validationPayload(params.error));
        }

        const companyId = request.company!.id;
        const rl = checkRateLimit(`companies:ai-interviews:setup:${companyId}`, 30, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `AI interview setup limit reached. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        try {
            const round = await jobRound.findFirst({
                where: { id: params.data.roundId, companyId, roundType: "ai_interview" },
                include: { job: { select: { id: true, title: true, companyName: true } } },
            });

            if (!round) {
                return reply.status(404).send({ error: "Not Found", message: "AI screening round not found." });
            }

            const now = new Date();
            const existingConfig = toRecord(round.config);
            // Prefer the agent's precompiled blueprint (preserves per-phase durations
            // + phase order); fall back to deriving from the flat questions[].
            const blueprint = parsed.data.blueprint
                ? buildScreeningBlueprint({ blueprint: parsed.data.blueprint })
                : buildScreeningBlueprint({
                    title: parsed.data.title,
                    durationMinutes: parsed.data.durationMinutes,
                    rubric: parsed.data.rubric,
                    questions: parsed.data.questions,
                });
            const aiInterview = {
                version: 1,
                configuredAt: now.toISOString(),
                template: "sde_screening",
                title: parsed.data.title,
                startAt: parsed.data.startAt,
                endAt: parsed.data.endAt,
                durationMinutes: parsed.data.durationMinutes,
                candidateInstructions: parsed.data.candidateInstructions || null,
                candidateMessage: parsed.data.candidateMessage || null,
                identityCheckLevel: parsed.data.identityCheckLevel,
                requireFullscreen: true,
                requireCamera: true,
                requireMicrophone: true,
                allowRetake: parsed.data.allowRetake,
                rubric: parsed.data.rubric,
                questions: parsed.data.questions,
                blueprint,
                scoringPolicy: {
                    scorer: "human_review_required",
                    llmRole: "interviewer_and_evidence_extractor_only",
                    overallScoreFormula: null,
                    decisionOwner: "company_recruiter",
                },
                proctoringRules: AI_SCREENING_PROCTORING_RULES,
            };

            await jobRound.update({
                where: { id: round.id },
                data: {
                    title: `${round.job?.title || "Job"} - ${parsed.data.title}`,
                    status: "open",
                    opensAt: new Date(parsed.data.startAt),
                    closesAt: new Date(parsed.data.endAt),
                    resourceId: round.id,
                    config: {
                        ...existingConfig,
                        aiInterview,
                    },
                },
            });

            const updatedJob = await companyJobOpening.update({
                where: { id: round.jobId },
                data: {
                    nextRoundType: "ai_interview",
                    nextRoundConfiguredAt: now,
                    currentRoundType: "ai_interview",
                    currentRoundResourceId: round.id,
                    currentRoundConfiguredAt: now,
                },
                include: { _count: { select: { applications: true } } },
            });

            const updated = await jobRound.findUnique({
                where: { id: round.id },
                include: {
                    job: { select: { id: true, title: true, companyName: true, companyLogoUrl: true } },
                    candidates: {
                        orderBy: { createdAt: "desc" },
                        include: {
                            user: { select: { fullName: true, email: true, avatarUrl: true } },
                            report: {
                                select: {
                                    id: true,
                                    overallScore: true,
                                    aiSummary: true,
                                    rubricBreakdown: true,
                                    report: true,
                                    evaluatedAt: true,
                                },
                            },
                        },
                    },
                },
            });

            return reply.status(200).send({
                interview: serializeRound(updated),
                job: {
                    id: updatedJob.id,
                    currentRoundType: updatedJob.currentRoundType,
                    currentRoundResourceId: updatedJob.currentRoundResourceId,
                    nextRoundType: updatedJob.nextRoundType,
                },
            });
        } catch (err) {
            return handleRouteError(err, reply, fastify);
        }
    });

    // Agentic JD -> screening builder: one chat turn. Returns a normalized blueprint
    // draft (phases, durations, rubric) the recruiter then edits or finalizes via /setup.
    fastify.post("/companies/ai-interviews/:roundId/config-agent", async (request, reply) => {
        const params = paramsSchema.safeParse(request.params);
        const parsed = configAgentSchema.safeParse(request.body);
        if (!params.success || !parsed.success) {
            return reply.status(400).send(params.success ? validationPayload(parsed.error) : validationPayload(params.error));
        }

        const companyId = request.company!.id;
        const rl = checkRateLimit(`companies:ai-interviews:config-agent:${companyId}`, 60, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Config assistant limit reached. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        try {
            const round = await jobRound.findFirst({
                where: { id: params.data.roundId, companyId, roundType: "ai_interview" },
                include: { job: { select: { id: true, title: true, companyName: true } } },
            });
            if (!round) {
                return reply.status(404).send({ error: "Not Found", message: "AI screening round not found." });
            }

            const result = await generateScreeningBlueprintDraft({
                jobDescription: parsed.data.jobDescription ?? null,
                jobTitle: round.job?.title ?? null,
                messages: parsed.data.messages.map((m) => ({ role: m.role ?? "user", content: m.content ?? "" })),
                currentDraft: parsed.data.currentDraft ?? null,
                totalDurationMinutes: parsed.data.totalDurationMinutes ?? null,
            });

            return reply.status(200).send(result);
        } catch (err) {
            return handleRouteError(err, reply, fastify);
        }
    });

    // Streaming (SSE) variant of the config agent — narrates the JD->plan steps
    // ("Parses the JD", "Identifies core skills", …) then sends the final plan.
    // Mirrors the AI-tutor SSE transport; the company UI reads it via fetch stream.
    fastify.post("/companies/ai-interviews/:roundId/config-agent/stream", async (request, reply) => {
        const params = paramsSchema.safeParse(request.params);
        const parsed = configAgentSchema.safeParse(request.body);
        if (!params.success || !parsed.success) {
            return reply.status(400).send(params.success ? validationPayload(parsed.error) : validationPayload(params.error));
        }

        const companyId = request.company!.id;
        const rl = checkRateLimit(`companies:ai-interviews:config-agent:${companyId}`, 60, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Config assistant limit reached. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        const round = await jobRound.findFirst({
            where: { id: params.data.roundId, companyId, roundType: "ai_interview" },
            include: { job: { select: { id: true, title: true, companyName: true } } },
        });
        if (!round) {
            return reply.status(404).send({ error: "Not Found", message: "AI screening round not found." });
        }

        reply.raw.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "Access-Control-Allow-Origin": request.headers.origin || "http://localhost:3000",
            "Access-Control-Allow-Credentials": "true",
        });
        const send = (payload: any) => reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
        // Keep the SSE connection alive while the model is generating (the design call can
        // take several seconds with no data flowing); an idle connection can otherwise be
        // dropped by a proxy, surfacing as "Internal Server Error" in the builder.
        const heartbeat = setInterval(() => {
            try { reply.raw.write(`: keepalive\n\n`); } catch { /* connection already closed */ }
        }, 10_000);

        try {
            for await (const event of streamScreeningBlueprintDraft({
                jobDescription: parsed.data.jobDescription ?? null,
                jobTitle: round.job?.title ?? null,
                messages: parsed.data.messages.map((m) => ({ role: m.role ?? "user", content: m.content ?? "" })),
                currentDraft: parsed.data.currentDraft ?? null,
                totalDurationMinutes: parsed.data.totalDurationMinutes ?? null,
            })) {
                send(event);
            }
        } catch (err: any) {
            send({ type: "error", message: err?.message || "Config assistant failed." });
        } finally {
            clearInterval(heartbeat);
            reply.raw.end();
        }
    });

    fastify.get("/companies/ai-interviews/:roundId/submissions", async (request, reply) => {
        const params = paramsSchema.safeParse(request.params);
        if (!params.success) {
            return reply.status(400).send(validationPayload(params.error));
        }

        try {
            const round = await jobRound.findFirst({
                where: { id: params.data.roundId, companyId: request.company!.id, roundType: "ai_interview" },
                include: {
                    job: { select: { id: true, title: true, companyName: true, companyLogoUrl: true } },
                    candidates: {
                        orderBy: { createdAt: "desc" },
                        include: {
                            user: { select: { fullName: true, email: true, avatarUrl: true } },
                            report: {
                                select: {
                                    id: true,
                                    overallScore: true,
                                    aiSummary: true,
                                    rubricBreakdown: true,
                                    report: true,
                                    evaluatedAt: true,
                                },
                            },
                        },
                    },
                },
            });

            if (!round) {
                return reply.status(404).send({ error: "Not Found", message: "AI screening round not found." });
            }

            const interview = serializeRound(round);
            return { interview, submissions: interview.submissions };
        } catch (err) {
            return handleRouteError(err, reply, fastify);
        }
    });

    fastify.get("/companies/ai-interviews/:roundId/submissions/:roundCandidateId", async (request, reply) => {
        const params = submissionParamsSchema.safeParse(request.params);
        if (!params.success) {
            return reply.status(400).send(validationPayload(params.error));
        }

        try {
            const detail = await loadAiScreeningSubmissionDetail(
                request.company!.id,
                params.data.roundId,
                params.data.roundCandidateId
            );
            if (!detail) {
                return reply.status(404).send({ error: "Not Found", message: "AI screening submission not found." });
            }

            return { detail };
        } catch (err) {
            return handleRouteError(err, reply, fastify);
        }
    });

    fastify.post("/companies/ai-interviews/:roundId/submissions/:roundCandidateId/regenerate-report", async (request, reply) => {
        const params = submissionParamsSchema.safeParse(request.params);
        if (!params.success) {
            return reply.status(400).send(validationPayload(params.error));
        }

        try {
            const detail = await loadAiScreeningSubmissionDetail(
                request.company!.id,
                params.data.roundId,
                params.data.roundCandidateId
            );
            if (!detail) {
                return reply.status(404).send({ error: "Not Found", message: "AI screening submission not found." });
            }
            if (!detail.submission.submittedAt) {
                return reply.status(409).send({ error: "Screening Not Submitted", message: "Submit the screening before generating a report." });
            }

            const blueprint = (detail.interview as any).blueprint || buildScreeningBlueprint({
                title: detail.interview.title,
                durationMinutes: detail.interview.durationMinutes,
                rubric: detail.interview.rubric,
                questions: detail.interview.questions,
            });
            const eventCounts = detail.proctoring?.eventCountsByType || {};
            const recruiterReport = await generateCompanyAiScreeningReport({
                candidateName: detail.submission.candidate.fullName || detail.submission.candidate.email || "Candidate",
                jobTitle: detail.interview.jobTitle || "Role",
                companyName: detail.interview.companyName || "",
                blueprint,
                transcript: detail.transcript.map((message: any) => ({
                    role: message.role === "ai" ? "assistant" : message.role,
                    content: message.content,
                    stage: message.stage,
                    createdAt: message.createdAt,
                })),
                typedAnswers: detail.typedAnswers as any,
                integrity: {
                    score: typeof detail.proctoring?.integrityScore === "number" ? detail.proctoring.integrityScore : null,
                    eventCounts,
                },
            });
            const evaluatedAt = new Date();
            const evidenceSnapshot = {
                version: 1,
                generatedAt: recruiterReport.generatedAt,
                automatedEvaluation: recruiterReport.automatedEvaluation,
                recommendation: recruiterReport.recommendation,
                integrityScore: detail.proctoring?.integrityScore ?? null,
                proctoringEventCounts: eventCounts,
                transcriptMessageCount: detail.transcript.length,
                typedAnswerCount: detail.typedAnswers.length,
                blueprintQuestionCount: countBlueprintQuestions(blueprint),
            };

            await jobRoundEvaluationReport.upsert({
                where: { roundCandidateId: detail.submission.roundCandidateId },
                create: {
                    roundCandidateId: detail.submission.roundCandidateId,
                    jobRoundId: params.data.roundId,
                    applicationId: detail.submission.applicationId,
                    userId: detail.submission.candidate.id,
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
                    evaluatedAt,
                },
            });

            return {
                report: {
                    overallScore: recruiterReport.overallScore,
                    aiSummary: recruiterReport.summary,
                    rubricBreakdown: recruiterReport.dimensionScores,
                    detail: recruiterReport,
                    evaluatedAt: evaluatedAt.toISOString(),
                },
            };
        } catch (err) {
            return handleRouteError(err, reply, fastify);
        }
    });

    fastify.post("/companies/ai-interviews/:roundId/submissions/:roundCandidateId/review", async (request, reply) => {
        const params = submissionParamsSchema.safeParse(request.params);
        const parsed = humanReviewSchema.safeParse(request.body);
        if (!params.success || !parsed.success) {
            return reply.status(400).send(params.success ? validationPayload(parsed.error) : validationPayload(params.error));
        }

        try {
            const existing = await (prisma as any).jobRoundCandidate.findFirst({
                where: {
                    id: params.data.roundCandidateId,
                    roundId: params.data.roundId,
                    round: {
                        companyId: request.company!.id,
                        roundType: "ai_interview",
                    },
                },
                select: { id: true, metadata: true },
            });
            if (!existing) {
                return reply.status(404).send({ error: "Not Found", message: "AI screening submission not found." });
            }

            const metadata = toRecord(existing.metadata);
            const humanReview = {
                ...parsed.data,
                reviewedAt: new Date().toISOString(),
                reviewedById: request.user!.id,
            };

            await (prisma as any).jobRoundCandidate.update({
                where: { id: existing.id },
                data: {
                    metadata: {
                        ...metadata,
                        aiScreeningHumanReview: humanReview,
                    },
                },
            });

            return { humanReview };
        } catch (err) {
            return handleRouteError(err, reply, fastify);
        }
    });
}
