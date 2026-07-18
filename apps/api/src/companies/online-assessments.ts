import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import mongoose from "mongoose";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { connectMongoDB } from "../lib/mongodb.js";
import { checkRateLimit } from "../lib/rate-limiter.js";
import { sanitizeForLog } from "../lib/log-utils.js";
import { isCompanyAdminRole, requireCompanyWorkspaceAccess } from "./access.js";
import {
    COMPANY_QUESTION_BANK_MODELS,
    COMPANY_QUESTION_BANK_TYPES,
    CompanyQuestionSet,
    type CompanyQuestionBankType,
} from "../models/CompanyQuestionBank.js";

const jobRound = (prisma as any).jobRound;
const jobRoundCandidate = (prisma as any).jobRoundCandidate;
const companyJobOpening = (prisma as any).companyJobOpening;

const onlineAssessmentParamsSchema = z.object({
    roundId: z.string().uuid(),
});

const optionalText = (max: number) =>
    z.preprocess(
        (value) => (typeof value === "string" && value.trim() === "" ? null : value),
        z.string().trim().max(max).optional().nullable()
    );

const assessmentQuestionSchema = z.object({
    id: z.string().trim().min(1).max(260),
    timeLimitMinutes: z.coerce.number().int().min(1).max(240),
    aiInterviewEnabled: z.boolean().default(false),
});

const assessmentSetupSchema = z.object({
    title: z.string().trim().min(1).max(180),
    startAt: z.string().datetime(),
    endAt: z.string().datetime(),
    durationMinutes: z.coerce.number().int().min(15).max(600),
    questionCount: z.coerce.number().int().min(1).max(50),
    instructions: optionalText(4000),
    candidateMessage: optionalText(2000),
    requireSecureBrowser: z.boolean().default(true),
    shuffleQuestions: z.boolean().default(true),
    allowLateStart: z.boolean().default(false),
    questions: z.array(assessmentQuestionSchema).min(1).max(50),
}).superRefine((data, ctx) => {
    const start = new Date(data.startAt);
    const end = new Date(data.endAt);
    if (Number.isNaN(start.getTime())) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Start date is invalid.", path: ["startAt"] });
    }
    if (Number.isNaN(end.getTime())) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "End date is invalid.", path: ["endAt"] });
    }
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end <= start) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "End date must be after start date.", path: ["endAt"] });
    }
    if (data.questions.length !== data.questionCount) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Selected questions must match the requested question count.",
            path: ["questionCount"],
        });
    }

    const totalQuestionMinutes = data.questions.reduce((sum, question) => sum + question.timeLimitMinutes, 0);
    if (totalQuestionMinutes !== data.durationMinutes) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Per-question time must add up exactly to the total OA duration.",
            path: ["questions"],
        });
    }

    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
        const windowMinutes = Math.floor((end.getTime() - start.getTime()) / 60_000);
        if (data.durationMinutes > windowMinutes) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "OA duration must fit inside the candidate availability window.",
                path: ["durationMinutes"],
            });
        }
    }
});

const questionBankTypeLabels: Record<CompanyQuestionBankType, string> = {
    dsa: "DSA",
    sql: "SQL",
    system_design: "System Design",
    cs_fundamentals: "CS Fundamentals",
};

function validationPayload(error: z.ZodError) {
    const first = error.issues[0];
    return {
        error: "Validation Error",
        message: first ? `${first.path.join(".") || "body"}: ${first.message}` : "Fix the highlighted fields.",
        details: error.flatten().fieldErrors,
    };
}

function toRecord(value: unknown): Record<string, any> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function isCompanyQuestionBankType(value?: string): value is CompanyQuestionBankType {
    return Boolean(value && (COMPANY_QUESTION_BANK_TYPES as readonly string[]).includes(value));
}

function companyQuestionId(setId: string, type: CompanyQuestionBankType, questionId: string) {
    return `${setId}:${type}:${questionId}`;
}

function bankQuestionId(type: CompanyQuestionBankType, questionId: string) {
    return `bank:${type}:${questionId}`;
}

function legacyCompanyQuestionId(type: CompanyQuestionBankType, questionId: string) {
    return `${type}:${questionId}`;
}

function parseQuestionInputId(id: string) {
    const parts = id.split(":");
    if (parts.length >= 3 && parts[0] === "bank" && isCompanyQuestionBankType(parts[1])) {
        return { source: "bank" as const, type: parts[1], questionId: parts.slice(2).join(":") };
    }
    if (parts.length >= 3 && isCompanyQuestionBankType(parts[1])) {
        return { source: "set" as const, setId: parts[0], type: parts[1], questionId: parts.slice(2).join(":") };
    }
    if (parts.length >= 2 && isCompanyQuestionBankType(parts[0])) {
        return { source: "bank" as const, type: parts[0], questionId: parts.slice(1).join(":") };
    }
    return null;
}

function questionBankTitle(type: CompanyQuestionBankType, question: any) {
    if (type === "cs_fundamentals") return String(question.question || "CS fundamentals question");
    return String(question.title || "Untitled question");
}

function formatQuestionBankQuestion(type: CompanyQuestionBankType, question: any) {
    const questionId = String(question._id);
    return {
        id: bankQuestionId(type, questionId),
        text: questionBankTitle(type, question),
        setId: null,
        setTitle: "Question bank",
        type,
        questionId,
        difficulty: question.difficulty || null,
    };
}

function formatCompanyQuestionSet(set: any) {
    return {
        id: String(set._id),
        title: set.title,
        focus: set.description || "",
        status: set.status,
        questions: (set.items || [])
            .slice()
            .sort((a: any, b: any) => (a.orderIndex || 0) - (b.orderIndex || 0))
            .map((item: any) => ({
                id: companyQuestionId(String(set._id), item.type, item.questionId),
                text: item.title,
                setId: String(set._id),
                setTitle: set.title,
                type: item.type,
                questionId: item.questionId,
                difficulty: item.difficulty || null,
            })),
    };
}

async function questionSetsResponse(companyId: string) {
    await connectMongoDB();
    const sets = await CompanyQuestionSet.find({
        "company.id": companyId,
        status: { $ne: "archived" },
        items: { $ne: [] },
    }).sort({ updatedAt: -1 }).lean();

    return sets.map(formatCompanyQuestionSet);
}

async function ungroupedQuestionBankGroupsResponse(companyId: string) {
    await connectMongoDB();

    const sets = await CompanyQuestionSet.find({
        "company.id": companyId,
        status: { $ne: "archived" },
    }).select("items").lean();
    const groupedQuestionKeys = new Set<string>();
    for (const set of sets) {
        for (const item of set.items || []) {
            groupedQuestionKeys.add(`${item.type}:${item.questionId}`);
        }
    }

    const groups = await Promise.all(COMPANY_QUESTION_BANK_TYPES.map(async (type) => {
        const Model = COMPANY_QUESTION_BANK_MODELS[type] as any;
        const questions = await Model.find({
            "company.id": companyId,
            status: { $ne: "archived" },
        }).sort({ updatedAt: -1 }).lean();

        const ungroupedQuestions = questions
            .filter((question: any) => !groupedQuestionKeys.has(`${type}:${String(question._id)}`))
            .map((question: any) => formatQuestionBankQuestion(type, question));

        return {
            id: `bank-${type}`,
            title: `${questionBankTypeLabels[type]} questions not in sets`,
            focus: "Added to your company question bank but not attached to any set.",
            isQuestionBank: true,
            questions: ungroupedQuestions,
        };
    }));

    return groups.filter((group) => group.questions.length);
}

async function resolveAssessmentQuestions(input: z.infer<typeof assessmentQuestionSchema>[], companyId: string) {
    await connectMongoDB();

    const parsed = input.map((question, index) => ({
        ...question,
        parsed: parseQuestionInputId(question.id),
        index,
    }));

    const invalid = parsed.find((question) => !question.parsed);
    if (invalid) return { error: `Unknown question id: ${invalid.id}` };

    const setIds = Array.from(new Set(parsed
        .filter((question) => question.parsed?.source === "set")
        .map((question) => question.parsed!.setId!)
    ));
    if (setIds.some((id) => !mongoose.Types.ObjectId.isValid(id))) {
        return { error: "Unknown question set id." };
    }

    const sets = setIds.length
        ? await CompanyQuestionSet.find({
            "company.id": companyId,
            status: { $ne: "archived" },
            _id: { $in: setIds },
        }).lean()
        : [];

    const setQuestionByKey = new Map<string, any>();
    for (const set of sets) {
        const setId = String(set._id);
        for (const item of set.items || []) {
            const question = {
                id: companyQuestionId(setId, item.type, item.questionId),
                text: item.title,
                setId,
                setTitle: set.title,
                type: item.type,
                questionId: item.questionId,
                difficulty: item.difficulty || null,
            };
            setQuestionByKey.set(question.id, question);
            setQuestionByKey.set(legacyCompanyQuestionId(item.type, item.questionId), question);
        }
    }

    const bankIdsByType = new Map<CompanyQuestionBankType, string[]>();
    for (const question of parsed) {
        const item = question.parsed!;
        if (item.source !== "bank") continue;
        if (!mongoose.Types.ObjectId.isValid(item.questionId)) {
            return { error: `Unknown question id: ${question.id}` };
        }
        bankIdsByType.set(item.type, [
            ...(bankIdsByType.get(item.type) || []),
            item.questionId,
        ]);
    }

    const bankQuestionByKey = new Map<string, any>();
    for (const [type, ids] of bankIdsByType.entries()) {
        const Model = COMPANY_QUESTION_BANK_MODELS[type] as any;
        const docs = await Model.find({
            "company.id": companyId,
            status: { $ne: "archived" },
            _id: { $in: Array.from(new Set(ids)) },
        }).lean();

        for (const doc of docs) {
            const question = formatQuestionBankQuestion(type, doc);
            bankQuestionByKey.set(question.id, question);
            bankQuestionByKey.set(legacyCompanyQuestionId(type, question.questionId), question);
        }
    }

    const seenQuestionKeys = new Set<string>();
    const resolved: any[] = [];
    for (const question of parsed) {
        const item = question.parsed!;
        const base = item.source === "set"
            ? setQuestionByKey.get(companyQuestionId(item.setId!, item.type, item.questionId))
            : bankQuestionByKey.get(bankQuestionId(item.type, item.questionId)) || bankQuestionByKey.get(legacyCompanyQuestionId(item.type, item.questionId));

        if (!base) return { error: `Unknown question id: ${question.id}` };

        const questionKey = `${base.type}:${base.questionId}`;
        if (seenQuestionKeys.has(questionKey)) {
            return { error: `Duplicate question selected: ${base.text}` };
        }
        seenQuestionKeys.add(questionKey);
        resolved.push({
            ...base,
            timeLimitMinutes: question.timeLimitMinutes,
            aiInterviewEnabled: question.aiInterviewEnabled,
            orderIndex: resolved.length,
        });
    }

    return { questions: resolved };
}

function assessmentConfig(round: any) {
    return toRecord(toRecord(round.config).onlineAssessment);
}

function assessmentStatus(round: any) {
    const config = assessmentConfig(round);
    if (!Object.keys(config).length || !Array.isArray(config.questions) || !config.questions.length) return "draft";
    const now = Date.now();
    const startAt = new Date(config.startAt || round.opensAt || 0).getTime();
    const endAt = new Date(config.endAt || round.closesAt || 0).getTime();
    if (Number.isFinite(endAt) && endAt <= now) return "closed";
    if (Number.isFinite(startAt) && startAt > now) return "scheduled";
    return "live";
}

function candidateName(user: any) {
    return user?.fullName || user?.email?.split("@")[0] || "Candidate";
}

function score(value: unknown) {
    return typeof value === "number" && Number.isFinite(value)
        ? Math.max(0, Math.min(100, Math.round(value)))
        : 0;
}

function hasSubmittedOa(candidate: any) {
    const metadata = toRecord(candidate.metadata);
    return Boolean(
        candidate.submittedAt ||
        metadata.oaSubmittedAt ||
        candidate.status === "submitted" ||
        candidate.status === "evaluated"
    );
}

function serializeAssessment(round: any) {
    const config = assessmentConfig(round);
    const questions = Array.isArray(config.questions) ? config.questions : [];
    const candidates = Array.isArray(round.candidates) ? round.candidates : [];
    const submittedCandidates = candidates.filter(hasSubmittedOa);
    const submittedCount = submittedCandidates.length;
    const totalQuestionMinutes = questions.reduce((sum: number, question: any) => sum + Number(question.timeLimitMinutes || 0), 0);

    return {
        id: round.id,
        roundId: round.id,
        jobId: round.jobId,
        jobTitle: round.job?.title || "",
        companyName: round.job?.companyName || "",
        status: assessmentStatus(round),
        configured: Boolean(questions.length),
        title: config.title || round.title || "Online assessment",
        startAt: config.startAt || round.opensAt?.toISOString?.() || null,
        endAt: config.endAt || round.closesAt?.toISOString?.() || null,
        durationMinutes: Number(config.durationMinutes || 0) || null,
        instructions: config.instructions || "",
        candidateMessage: config.candidateMessage || "",
        requireSecureBrowser: config.requireSecureBrowser ?? true,
        shuffleQuestions: config.shuffleQuestions ?? true,
        allowLateStart: config.allowLateStart ?? false,
        questionCount: Number(config.questionCount || questions.length || 0),
        totalQuestionMinutes,
        aiInterviewQuestionCount: questions.filter((question: any) => question.aiInterviewEnabled).length,
        questions,
        candidateCount: candidates.length,
        submittedCount,
        createdAt: round.createdAt?.toISOString?.() || null,
        updatedAt: round.updatedAt?.toISOString?.() || null,
        submissions: submittedCandidates.map((candidate: any) => {
            const metadata = toRecord(candidate.metadata);
            const reportScore = candidate.report ? score(candidate.report.overallScore) : null;
            return {
                id: candidate.id,
                roundCandidateId: candidate.id,
                applicationId: candidate.applicationId,
                candidateName: candidateName(candidate.user),
                candidateEmail: candidate.user?.email || "",
                avatarUrl: candidate.user?.avatarUrl || null,
                status: candidate.report ? "evaluated" : "submitted",
                score: reportScore,
                startedAt: metadata.oaStartedAt || null,
                submittedAt: candidate.submittedAt?.toISOString?.() || metadata.oaSubmittedAt || null,
                evaluatedAt: candidate.evaluatedAt?.toISOString?.() || candidate.report?.evaluatedAt?.toISOString?.() || null,
                report: candidate.report
                    ? {
                        id: candidate.report.id,
                        overallScore: score(candidate.report.overallScore),
                        aiSummary: candidate.report.aiSummary || "",
                        evaluatedAt: candidate.report.evaluatedAt?.toISOString?.() || null,
                    }
                    : null,
            };
        }),
    };
}

async function requireCompanyOaAccess(request: FastifyRequest, reply: FastifyReply) {
    if (request.company?.role !== "viewer") return;

    return reply.status(403).send({
        error: "Forbidden",
        message: "You don't have access to Online Assessments. Ask a company owner or admin for access.",
    });
}

async function requireCompanyAdminForWrites(request: FastifyRequest, reply: FastifyReply) {
    if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") return;
    if (request.company && isCompanyAdminRole(request.company.role)) return;

    return reply.status(403).send({
        error: "Forbidden",
        message: "Only company owners and admins can set up online assessments.",
    });
}

async function handleRouteError(err: unknown, reply: FastifyReply, fastify: FastifyInstance) {
    fastify.log.error(sanitizeForLog(err), "Company online assessment route failed");
    return reply.status(500).send({
        error: "Internal Server Error",
        message: "Internal Server Error. Please check your connection and try again.",
    });
}

export default async function companyOnlineAssessmentRoutes(fastify: FastifyInstance) {
    fastify.decorateRequest("company", null);
    fastify.addHook("preHandler", fastify.authenticate);
    fastify.addHook("preHandler", requireCompanyWorkspaceAccess);
    fastify.addHook("preHandler", requireCompanyOaAccess);
    fastify.addHook("preHandler", requireCompanyAdminForWrites);

    fastify.get("/companies/online-assessments", async (request, reply) => {
        const companyId = request.company!.id;
        const rl = checkRateLimit(`companies:online-assessments:list:${companyId}`, 120, 60_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Too many requests. Please wait ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        try {
            const [rounds, questionSets, questionBankGroups] = await Promise.all([
                jobRound.findMany({
                    where: { companyId, roundType: "mock_oa" },
                    include: {
                        job: {
                            select: {
                                id: true,
                                title: true,
                                companyName: true,
                                companyLogoUrl: true,
                            },
                        },
                        candidates: {
                            orderBy: { createdAt: "desc" },
                            include: {
                                user: {
                                    select: {
                                        id: true,
                                        fullName: true,
                                        email: true,
                                        avatarUrl: true,
                                    },
                                },
                                report: {
                                    select: {
                                        id: true,
                                        overallScore: true,
                                        aiSummary: true,
                                        evaluatedAt: true,
                                    },
                                },
                            },
                        },
                    },
                    orderBy: { createdAt: "desc" },
                }),
                questionSetsResponse(companyId),
                ungroupedQuestionBankGroupsResponse(companyId),
            ]);

            return {
                assessments: rounds.map(serializeAssessment),
                questionSets,
                questionBankGroups,
            };
        } catch (err) {
            return handleRouteError(err, reply, fastify);
        }
    });

    fastify.post("/companies/online-assessments/:roundId/setup", async (request, reply) => {
        const params = onlineAssessmentParamsSchema.safeParse(request.params);
        const parsed = assessmentSetupSchema.safeParse(request.body);
        if (!params.success || !parsed.success) {
            return reply.status(400).send(validationPayload(params.success ? parsed.error! : params.error));
        }

        const companyId = request.company!.id;
        const rl = checkRateLimit(`companies:online-assessments:setup:${companyId}`, 30, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Online assessment setup limit reached. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        const round = await jobRound.findFirst({
            where: { id: params.data.roundId, companyId, roundType: "mock_oa" },
            include: {
                job: { select: { id: true, title: true, companyName: true } },
                candidates: {
                    select: {
                        id: true,
                        userId: true,
                    },
                },
            },
        });
        if (!round) {
            return reply.status(404).send({ error: "Not Found", message: "Online assessment round not found." });
        }

        const resolved = await resolveAssessmentQuestions(parsed.data.questions, companyId);
        if ("error" in resolved) {
            return reply.status(400).send({ error: "Validation Error", message: resolved.error });
        }

        const startAt = new Date(parsed.data.startAt);
        const endAt = new Date(parsed.data.endAt);
        const now = new Date();
        const existingOnlineAssessment = assessmentConfig(round);
        const existingQuestions = Array.isArray(existingOnlineAssessment.questions) ? existingOnlineAssessment.questions : [];
        const existingStartValue = existingOnlineAssessment.startAt || round.opensAt?.toISOString?.() || null;
        const existingStartTime = existingStartValue ? new Date(existingStartValue).getTime() : Number.NaN;
        const startTimeLocked = existingQuestions.length > 0 && Number.isFinite(existingStartTime) && existingStartTime <= now.getTime();
        if (startTimeLocked && Math.abs(startAt.getTime() - existingStartTime) > 60_000) {
            return reply.status(400).send({
                error: "Validation Error",
                message: "Start date is locked after the online assessment has opened.",
            });
        }
        if (!startTimeLocked && startAt.getTime() < now.getTime() - 60_000) {
            return reply.status(400).send({
                error: "Validation Error",
                message: "Start date cannot be in the past.",
            });
        }

        const status = endAt.getTime() <= now.getTime() ? "closed" : "open";
        const existingConfig = toRecord(round.config);
        const onlineAssessment = {
            title: parsed.data.title,
            startAt: startAt.toISOString(),
            endAt: endAt.toISOString(),
            durationMinutes: parsed.data.durationMinutes,
            questionCount: parsed.data.questionCount,
            instructions: parsed.data.instructions || null,
            candidateMessage: parsed.data.candidateMessage || null,
            requireSecureBrowser: parsed.data.requireSecureBrowser,
            shuffleQuestions: parsed.data.shuffleQuestions,
            allowLateStart: parsed.data.allowLateStart,
            questions: resolved.questions,
            updatedAt: now.toISOString(),
            updatedByUserId: request.user!.id,
        };

        await jobRound.update({
            where: { id: round.id },
            data: {
                title: `${round.job?.title || "Job"} - ${parsed.data.title}`,
                status,
                opensAt: startAt,
                closesAt: endAt,
                resourceId: round.id,
                config: {
                    ...existingConfig,
                    onlineAssessment,
                },
            },
        });

        await companyJobOpening.update({
            where: { id: round.jobId },
            data: {
                nextRoundType: "mock_oa",
                nextRoundConfiguredAt: now,
                currentRoundType: "mock_oa",
                currentRoundResourceId: round.id,
                currentRoundConfiguredAt: now,
            },
        });

        if (round.candidates.length) {
            await (prisma as any).userNotification.createMany({
                data: round.candidates.map((candidate: any) => ({
                    userId: candidate.userId,
                    type: "online_assessment_scheduled",
                    title: "Online assessment scheduled",
                    message: `Your online assessment for ${round.job?.title || "the role"} is scheduled.`,
                    href: "/scheduled",
                    metadata: {
                        jobId: round.jobId,
                        roundId: round.id,
                        assessmentId: round.id,
                        startAt: startAt.toISOString(),
                        endAt: endAt.toISOString(),
                    },
                })),
                skipDuplicates: true,
            }).catch(() => null);
        }

        const updated = await jobRound.findUnique({
            where: { id: round.id },
            include: {
                job: { select: { id: true, title: true, companyName: true, companyLogoUrl: true } },
                candidates: {
                    orderBy: { createdAt: "desc" },
                    include: {
                        user: {
                            select: {
                                id: true,
                                fullName: true,
                                email: true,
                                avatarUrl: true,
                            },
                        },
                        report: {
                            select: {
                                id: true,
                                overallScore: true,
                                aiSummary: true,
                                evaluatedAt: true,
                            },
                        },
                    },
                },
            },
        });

        return reply.status(200).send({ assessment: serializeAssessment(updated) });
    });

    fastify.get("/companies/online-assessments/:roundId/submissions", async (request, reply) => {
        const params = onlineAssessmentParamsSchema.safeParse(request.params);
        if (!params.success) {
            return reply.status(400).send(validationPayload(params.error));
        }

        const round = await jobRound.findFirst({
            where: { id: params.data.roundId, companyId: request.company!.id, roundType: "mock_oa" },
            include: {
                job: { select: { id: true, title: true, companyName: true, companyLogoUrl: true } },
                candidates: {
                    orderBy: { createdAt: "desc" },
                    include: {
                        user: {
                            select: {
                                id: true,
                                fullName: true,
                                email: true,
                                avatarUrl: true,
                            },
                        },
                        report: {
                            select: {
                                id: true,
                                overallScore: true,
                                aiSummary: true,
                                evaluatedAt: true,
                            },
                        },
                    },
                },
            },
        });

        if (!round) {
            return reply.status(404).send({ error: "Not Found", message: "Online assessment round not found." });
        }

        const assessment = serializeAssessment(round);
        return { assessment, submissions: assessment.submissions };
    });
}
