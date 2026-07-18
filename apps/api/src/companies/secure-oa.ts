import { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { getPresignedDownloadUrl } from "../lib/r2.js";
import { requireCompanyWorkspaceAccess } from "./access.js";
import {
    disconnectProctoringSession,
    emitProctoringTerminate,
} from "../services/proctoring/socket-bus.js";
import { sanitizeForLog } from "../lib/log-utils.js";

const uuidParamSchema = z.object({ id: z.string().uuid() });
const roundSessionsParamsSchema = z.object({ roundId: z.string().uuid() });
const sessionsQuerySchema = z.object({
    status: z.enum(["pending", "active", "submitted", "terminated", "abandoned"]).optional(),
    cursor: z.string().datetime().optional(),
});
const cursorQuerySchema = z.object({
    cursor: z.string().datetime().optional(),
});
const terminateBodySchema = z.object({
    reason: z.string().trim().min(3).max(500),
});

function validationPayload(error: z.ZodError) {
    return {
        error: "Validation Error",
        message: error.issues[0]?.message || "Invalid request.",
        details: error.flatten().fieldErrors,
    };
}

function toRecord(value: unknown): Record<string, any> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function candidateResponse(user: any) {
    return {
        id: user?.id || null,
        fullName: user?.fullName || user?.email?.split("@")[0] || "Candidate",
        email: user?.email || "",
        avatarUrl: user?.avatarUrl || null,
    };
}

async function handleRouteError(error: unknown, reply: FastifyReply, fastify: FastifyInstance) {
    fastify.log.error(sanitizeForLog(error), "Company secure OA route failed");
    return reply.status(500).send({
        error: "Internal Server Error",
        message: "Internal Server Error. Please check your connection and try again.",
    });
}

export async function assertCompanyOwnsSession(companyId: string, sessionId: string) {
    return (prisma as any).secureOaSession.findFirst({
        where: {
            id: sessionId,
            companyId,
            jobRound: {
                companyId,
                roundType: "mock_oa",
            },
        },
        include: {
            candidate: {
                select: {
                    id: true,
                    fullName: true,
                    email: true,
                    avatarUrl: true,
                },
            },
            jobRound: {
                select: {
                    id: true,
                    title: true,
                    jobId: true,
                    companyId: true,
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
            jobRoundCandidate: {
                select: {
                    id: true,
                    status: true,
                    score: true,
                    submittedAt: true,
                    evaluatedAt: true,
                    metadata: true,
                    report: {
                        select: {
                            id: true,
                            overallScore: true,
                            aiSummary: true,
                            report: true,
                            evaluatedAt: true,
                        },
                    },
                },
            },
        },
    });
}

export default async function companySecureOaRoutes(fastify: FastifyInstance) {
    const companyPreHandler = [fastify.authenticate, requireCompanyWorkspaceAccess];

    fastify.get(
        "/companies/online-assessments/:roundId/sessions",
        { preHandler: companyPreHandler },
        async (request, reply) => {
            const params = roundSessionsParamsSchema.safeParse(request.params);
            const query = sessionsQuerySchema.safeParse(request.query);
            if (!params.success || !query.success) {
                return reply.status(400).send(validationPayload(params.success ? query.error! : params.error));
            }

            const companyId = request.company!.id;
            try {
                const round = await (prisma as any).jobRound.findFirst({
                    where: { id: params.data.roundId, companyId, roundType: "mock_oa" },
                    select: { id: true },
                });
                if (!round) {
                    return reply.status(404).send({ error: "Not Found", message: "Online assessment round not found." });
                }

                const sessions = await (prisma as any).secureOaSession.findMany({
                    where: {
                        jobRoundId: params.data.roundId,
                        companyId,
                        ...(query.data.status ? { status: query.data.status } : {}),
                        ...(query.data.cursor ? { createdAt: { lt: new Date(query.data.cursor) } } : {}),
                    },
                    orderBy: { createdAt: "desc" },
                    take: 51,
                    include: {
                        candidate: {
                            select: {
                                id: true,
                                fullName: true,
                                email: true,
                                avatarUrl: true,
                            },
                        },
                    },
                });
                const page = sessions.slice(0, 50);
                return {
                    sessions: page.map((session: any) => ({
                        id: session.id,
                        jobRoundId: session.jobRoundId,
                        jobRoundCandidateId: session.jobRoundCandidateId,
                        candidate: candidateResponse(session.candidate),
                        status: session.status,
                        startedAt: session.startedAt?.toISOString?.() || null,
                        submittedAt: session.submittedAt?.toISOString?.() || null,
                        terminatedAt: session.terminatedAt?.toISOString?.() || null,
                        terminatedReason: session.terminatedReason || null,
                        integrityScore: session.status === "submitted" ? session.integrityScore : null,
                        createdAt: session.createdAt?.toISOString?.() || null,
                    })),
                    nextCursor: sessions.length > 50 ? page[page.length - 1]?.createdAt?.toISOString?.() || null : null,
                };
            } catch (error) {
                return handleRouteError(error, reply, fastify);
            }
        }
    );

    fastify.get(
        "/companies/secure-oa/sessions/:id",
        { preHandler: companyPreHandler },
        async (request, reply) => {
            const params = uuidParamSchema.safeParse(request.params);
            if (!params.success) return reply.status(400).send(validationPayload(params.error));

            const companyId = request.company!.id;
            try {
                const session = await assertCompanyOwnsSession(companyId, params.data.id);
                if (!session) {
                    return reply.status(404).send({ error: "Not Found", message: "Secure OA session not found." });
                }

                const [byType, bySeverity] = await Promise.all([
                    (prisma as any).proctoringEvent.groupBy({
                        by: ["eventType"],
                        where: { sessionId: session.id },
                        _count: { _all: true },
                    }),
                    (prisma as any).proctoringEvent.groupBy({
                        by: ["severity"],
                        where: { sessionId: session.id },
                        _count: { _all: true },
                    }),
                ]);

                return {
                    session: {
                        id: session.id,
                        jobRoundId: session.jobRoundId,
                        status: session.status,
                        startedAt: session.startedAt?.toISOString?.() || null,
                        submittedAt: session.submittedAt?.toISOString?.() || null,
                        terminatedAt: session.terminatedAt?.toISOString?.() || null,
                        terminatedReason: session.terminatedReason || null,
                        integrityScore: session.status === "submitted" ? session.integrityScore : null,
                        candidate: candidateResponse(session.candidate),
                        assessment: (() => {
                            const config = toRecord(toRecord(session.jobRound?.config).onlineAssessment);
                            return {
                                title: config.title || session.jobRound?.title || "Online assessment",
                                jobTitle: session.jobRound?.job?.title || "",
                                companyName: session.jobRound?.job?.companyName || "",
                                durationMinutes: Number(config.durationMinutes || 0) || null,
                                questions: Array.isArray(config.questions) ? config.questions : [],
                            };
                        })(),
                        submission: (() => {
                            const metadata = toRecord(session.jobRoundCandidate?.metadata);
                            const answers = Array.isArray(metadata.oaAnswers) ? metadata.oaAnswers : [];
                            return {
                                roundCandidateId: session.jobRoundCandidate?.id || null,
                                status: session.jobRoundCandidate?.status || null,
                                score: session.jobRoundCandidate?.score ?? null,
                                submittedAt: session.jobRoundCandidate?.submittedAt?.toISOString?.() || null,
                                evaluatedAt: session.jobRoundCandidate?.evaluatedAt?.toISOString?.() || null,
                                answerCount: answers.length,
                                answers,
                                report: session.jobRoundCandidate?.report
                                    ? {
                                        id: session.jobRoundCandidate.report.id,
                                        overallScore: session.jobRoundCandidate.report.overallScore,
                                        aiSummary: session.jobRoundCandidate.report.aiSummary || "",
                                        detail: session.jobRoundCandidate.report.report || null,
                                        evaluatedAt: session.jobRoundCandidate.report.evaluatedAt?.toISOString?.() || null,
                                    }
                                    : null,
                            };
                        })(),
                        eventCountsByType: Object.fromEntries(byType.map((item: any) => [item.eventType, item._count._all])),
                        eventCountsBySeverity: Object.fromEntries(bySeverity.map((item: any) => [item.severity, item._count._all])),
                        rulesSnapshot: session.integrityRulesSnapshot || null,
                    },
                };
            } catch (error) {
                return handleRouteError(error, reply, fastify);
            }
        }
    );

    fastify.get(
        "/companies/secure-oa/sessions/:id/events",
        { preHandler: companyPreHandler },
        async (request, reply) => {
            const params = uuidParamSchema.safeParse(request.params);
            const query = cursorQuerySchema.safeParse(request.query);
            if (!params.success || !query.success) {
                return reply.status(400).send(validationPayload(params.success ? query.error! : params.error));
            }

            const companyId = request.company!.id;
            try {
                const session = await assertCompanyOwnsSession(companyId, params.data.id);
                if (!session) {
                    return reply.status(404).send({ error: "Not Found", message: "Secure OA session not found." });
                }

                const events = await (prisma as any).proctoringEvent.findMany({
                    where: {
                        sessionId: session.id,
                        ...(query.data.cursor ? { serverTimestamp: { gt: new Date(query.data.cursor) } } : {}),
                    },
                    orderBy: { serverTimestamp: "asc" },
                    take: 101,
                });
                const page = events.slice(0, 100);
                return {
                    events: page.map((event: any) => ({
                        id: event.id,
                        clientEventId: event.clientEventId,
                        eventType: event.eventType,
                        severity: event.severity,
                        payload: event.payload,
                        clientTimestamp: event.clientTimestamp?.toISOString?.() || null,
                        serverTimestamp: event.serverTimestamp?.toISOString?.() || null,
                        triggeredTermination: Boolean(event.triggeredTermination),
                    })),
                    nextCursor: events.length > 100 ? page[page.length - 1]?.serverTimestamp?.toISOString?.() || null : null,
                };
            } catch (error) {
                return handleRouteError(error, reply, fastify);
            }
        }
    );

    fastify.get(
        "/companies/secure-oa/sessions/:id/snapshots",
        { preHandler: companyPreHandler },
        async (request, reply) => {
            const params = uuidParamSchema.safeParse(request.params);
            const query = cursorQuerySchema.safeParse(request.query);
            if (!params.success || !query.success) {
                return reply.status(400).send(validationPayload(params.success ? query.error! : params.error));
            }

            const companyId = request.company!.id;
            try {
                const session = await assertCompanyOwnsSession(companyId, params.data.id);
                if (!session) {
                    return reply.status(404).send({ error: "Not Found", message: "Secure OA session not found." });
                }

                const snapshots = await (prisma as any).proctoringSnapshot.findMany({
                    where: {
                        sessionId: session.id,
                        ...(query.data.cursor ? { takenAt: { gt: new Date(query.data.cursor) } } : {}),
                    },
                    orderBy: { takenAt: "asc" },
                    take: 51,
                });
                const page = snapshots.slice(0, 50);
                const withUrls = await Promise.all(page.map(async (snapshot: any) => ({
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

                return {
                    snapshots: withUrls,
                    nextCursor: snapshots.length > 50 ? page[page.length - 1]?.takenAt?.toISOString?.() || null : null,
                };
            } catch (error) {
                return handleRouteError(error, reply, fastify);
            }
        }
    );

    fastify.post(
        "/companies/secure-oa/sessions/:id/terminate",
        { preHandler: companyPreHandler },
        async (request, reply) => {
            const params = uuidParamSchema.safeParse(request.params);
            const body = terminateBodySchema.safeParse(request.body);
            if (!params.success || !body.success) {
                return reply.status(400).send(validationPayload(params.success ? body.error! : params.error));
            }

            const companyId = request.company!.id;
            try {
                const session = await assertCompanyOwnsSession(companyId, params.data.id);
                if (!session) {
                    return reply.status(404).send({ error: "Not Found", message: "Secure OA session not found." });
                }

                await (prisma as any).secureOaSession.update({
                    where: { id: session.id },
                    data: {
                        status: "terminated",
                        terminatedReason: "manual_company",
                        terminatedAt: new Date(),
                    },
                });

                emitProctoringTerminate(session.id, "manual_company");
                disconnectProctoringSession(session.id);
                return reply.send({ status: "terminated", terminatedReason: "manual_company" });
            } catch (error) {
                return handleRouteError(error, reply, fastify);
            }
        }
    );
}
