import crypto from "node:crypto";
import { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { uploadPrivateObjectToR2 } from "../../lib/r2.js";
import { computeIntegrityScore } from "../../services/proctoring/rules.js";
import {
    ProctoringIngestService,
    loadActiveProctoringRules,
} from "../../services/proctoring/ingest.js";
import {
    PROCTORING_SNAPSHOT_MAX_BYTES,
} from "../../services/proctoring/constants.js";
import {
    disconnectProctoringSession,
} from "../../services/proctoring/socket-bus.js";
import { proctoringEventsBodySchema } from "../../services/proctoring/schemas.js";

const uuidParamSchema = z.object({
    id: z.string().uuid(),
});

const startParamsSchema = z.object({
    jobRoundId: z.string().uuid(),
});

const startBodySchema = z.object({
    client_fingerprint: z.string().trim().min(8).max(256).optional(),
    user_agent: z.string().trim().min(1).max(600).optional(),
}).default({});

const snapshotFieldsSchema = z.object({
    taken_at: z.string().datetime(),
    trigger: z.enum(["scheduled", "event_triggered"]),
    triggering_client_event_id: z.string().trim().min(1).max(220).optional(),
});

const submitAnswerSchema = z.object({
    questionId: z.string().trim().min(1).max(300),
    answer: z.string().max(30000).default(""),
    language: z.string().trim().max(50).optional().nullable(),
    timeSpentSeconds: z.coerce.number().int().min(0).max(24 * 60 * 60).optional(),
});

const submitBodySchema = z.object({
    answers: z.array(submitAnswerSchema).max(50).optional().default([]),
}).default({ answers: [] });

function validationPayload(error: z.ZodError) {
    return {
        error: "Validation Error",
        message: error.issues[0]?.message || "Invalid request.",
        details: error.flatten().fieldErrors,
    };
}

function maskId(value?: string) {
    if (!value) return undefined;
    return `${value.slice(0, 8)}...`;
}

function rejectSnapshot(
    request: any,
    reply: FastifyReply,
    statusCode: number,
    reason: string,
    body: Record<string, unknown>,
    meta: Record<string, unknown> = {}
) {
    request.log.warn({
        reason,
        statusCode,
        sessionId: maskId(typeof meta.sessionId === "string" ? meta.sessionId : undefined),
        sessionStatus: meta.sessionStatus,
        byteSize: meta.byteSize,
        mimeType: meta.mimeType,
        fields: meta.fields,
    }, "Secure OA snapshot rejected");
    return reply.status(statusCode).send(body);
}

function toRecord(value: unknown): Record<string, any> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function onlineAssessmentConfig(round: any) {
    return toRecord(toRecord(round.config).onlineAssessment);
}

function assessmentWindow(round: any) {
    const config = onlineAssessmentConfig(round);
    const startValue = config.startAt || round.opensAt;
    const endValue = config.closesAt || config.endAt || round.closesAt;
    const startAt = startValue ? new Date(startValue) : null;
    const closesAt = endValue ? new Date(endValue) : null;
    return { startAt, closesAt };
}

function getRequestIp(request: any) {
    return request.ip || request.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() || "";
}

async function assertCandidateOwnsSession(sessionId: string, candidateUserId: string, reply: FastifyReply) {
    const session = await (prisma as any).secureOaSession.findUnique({
        where: { id: sessionId },
        select: {
            id: true,
            status: true,
            startedAt: true,
            jobRoundId: true,
            jobRoundCandidateId: true,
            candidateUserId: true,
            companyId: true,
        },
    });
    if (!session) {
        reply.status(404).send({ error: "Not Found", message: "Secure OA session not found." });
        return null;
    }
    if (session.candidateUserId !== candidateUserId) {
        reply.status(403).send({ error: "Forbidden", message: "You are not authorized for this secure OA session." });
        return null;
    }
    return session;
}

async function activeRulesPublic(jobRoundId: string) {
    const ruleset = await loadActiveProctoringRules(prisma, jobRoundId);
    return {
        ruleset,
        rulesPublic: {
            heartbeat_interval_ms: ruleset.rules.thresholds.heartbeat_interval_ms,
            snapshot_interval_ms: ruleset.rules.thresholds.snapshot_interval_ms,
        },
    };
}

function rejectClosedSession(reply: FastifyReply, status: string) {
    const alreadySubmitted = status === "submitted";
    return reply.status(409).send({
        error: alreadySubmitted ? "Online Assessment Already Submitted" : "Secure OA Session Closed",
        code: alreadySubmitted ? "secure_oa_already_submitted" : "secure_oa_session_closed",
        sessionStatus: status,
        message: alreadySubmitted
            ? "This assessment has already been submitted."
            : "Your previous assessment session ended and cannot be reopened. Please contact your recruiter.",
    });
}

export default async function secureOaSessionRoutes(fastify: FastifyInstance) {
    const ingestService = new ProctoringIngestService(prisma);

    fastify.post(
        "/secure-oa/sessions/:jobRoundId/start",
        { preHandler: [fastify.authenticate] },
        async (request, reply) => {
            const params = startParamsSchema.safeParse(request.params);
            const body = startBodySchema.safeParse(request.body ?? {});
            if (!params.success || !body.success) {
                return reply.status(400).send(validationPayload(params.success ? body.error! : params.error));
            }

            const candidateUserId = request.user!.id;
            const round = await (prisma as any).jobRound.findUnique({
                where: { id: params.data.jobRoundId },
                select: {
                    id: true,
                    roundType: true,
                    companyId: true,
                    opensAt: true,
                    closesAt: true,
                    config: true,
                },
            });
            if (!round) {
                return reply.status(404).send({ error: "Not Found", message: "Online assessment round not found." });
            }
            if (round.roundType !== "mock_oa") {
                return reply.status(400).send({
                    error: "Validation Error",
                    code: "not_mock_oa",
                    message: "This job round is not an online assessment.",
                });
            }

            const { startAt, closesAt } = assessmentWindow(round);
            const now = new Date();
            if (!startAt || !closesAt || Number.isNaN(startAt.getTime()) || Number.isNaN(closesAt.getTime())) {
                return reply.status(400).send({
                    error: "Validation Error",
                    code: "invalid_oa_window",
                    message: "This online assessment schedule is invalid.",
                });
            }
            if (now < startAt) {
                return reply.status(400).send({
                    error: "Online Assessment Unavailable",
                    code: "oa_not_open",
                    message: "This online assessment has not opened yet.",
                });
            }
            if (now >= closesAt) {
                return reply.status(400).send({
                    error: "Online Assessment Unavailable",
                    code: "oa_closed",
                    message: "This online assessment window has closed.",
                });
            }

            const roundCandidate = await (prisma as any).jobRoundCandidate.findFirst({
                where: {
                    roundId: round.id,
                    userId: candidateUserId,
                },
                select: { id: true, roundId: true, userId: true },
            });
            if (!roundCandidate) {
                return reply.status(403).send({
                    error: "Forbidden",
                    message: "You are not part of this online assessment round.",
                });
            }

            const existing = await (prisma as any).secureOaSession.findUnique({
                where: {
                    jobRoundId_jobRoundCandidateId: {
                        jobRoundId: round.id,
                        jobRoundCandidateId: roundCandidate.id,
                    },
                },
                select: { id: true, status: true, jobRoundId: true },
            });
            if (existing && (existing.status === "pending" || existing.status === "active")) {
                const { rulesPublic } = await activeRulesPublic(existing.jobRoundId);
                return reply.send({ sessionId: existing.id, rulesPublic });
            }
            if (existing) {
                return rejectClosedSession(reply, existing.status);
            }

            const otherActiveSession = await (prisma as any).secureOaSession.findFirst({
                where: {
                    candidateUserId,
                    status: "active",
                    ...(existing?.id ? { id: { not: existing.id } } : {}),
                },
                select: { id: true },
            });
            if (otherActiveSession) {
                await ingestService.ingestServerEvent(otherActiveSession.id, {
                    client_event_id: `server:${crypto.randomUUID()}:multi_session_attempt`,
                    event_type: "multi_session_attempt",
                    payload: { attempted_from_ip: getRequestIp(request) },
                    client_timestamp: new Date().toISOString(),
                } as any);
                disconnectProctoringSession(otherActiveSession.id);
                return reply.status(409).send({
                    error: "Conflict",
                    code: "multi_session_attempt",
                    message: "Another secure OA session is already active.",
                });
            }

            const ipAddress = getRequestIp(request);
            const userAgent = body.data.user_agent || request.headers["user-agent"]?.toString() || null;
            let session: any;
            try {
                session = await (prisma as any).$transaction(async (tx: any) => {
                    const created = await tx.secureOaSession.create({
                        data: {
                            jobRoundId: round.id,
                            jobRoundCandidateId: roundCandidate.id,
                            candidateUserId,
                            companyId: round.companyId,
                            status: "pending",
                            clientFingerprint: body.data.client_fingerprint || null,
                            userAgent,
                            ipAddress,
                        },
                        select: { id: true, jobRoundId: true },
                    });

                    return tx.secureOaSession.update({
                        where: { id: created.id },
                        data: {
                            status: "active",
                            startedAt: now,
                        },
                        select: { id: true, jobRoundId: true },
                    });
                });
            } catch (error: any) {
                // The unique constraint is the race guard for simultaneous starts.
                // If another request created the row first, retry by lookup and return it idempotently.
                if (error?.code === "P2002") {
                    session = await (prisma as any).secureOaSession.findUnique({
                        where: {
                            jobRoundId_jobRoundCandidateId: {
                                jobRoundId: round.id,
                                jobRoundCandidateId: roundCandidate.id,
                            },
                        },
                        select: { id: true, status: true, jobRoundId: true },
                    });
                    if (session && session.status !== "pending" && session.status !== "active") {
                        return rejectClosedSession(reply, session.status);
                    }
                } else {
                    throw error;
                }
            }

            if (!session) {
                return reply.status(500).send({ error: "Internal Server Error", message: "Could not start secure OA session." });
            }

            await ingestService.ingestServerEvent(session.id, {
                client_event_id: `server:${session.id}:session_start`,
                event_type: "session_start",
                payload: {},
                client_timestamp: new Date().toISOString(),
            } as any);
            const { rulesPublic } = await activeRulesPublic(session.jobRoundId);

            return reply.status(201).send({ sessionId: session.id, rulesPublic });
        }
    );

    fastify.post(
        "/secure-oa/sessions/:id/events",
        { preHandler: [fastify.authenticate] },
        async (request, reply) => {
            const params = uuidParamSchema.safeParse(request.params);
            const parsed = proctoringEventsBodySchema.safeParse(request.body);
            if (!params.success || !parsed.success) {
                return reply.status(400).send(validationPayload(params.success ? parsed.error! : params.error));
            }

            const session = await assertCandidateOwnsSession(params.data.id, request.user!.id, reply);
            if (!session) return reply;

            const result = await ingestService.ingestBatch(params.data.id, parsed.data.events, {
                source: "rest",
                ip: getRequestIp(request),
            });
            if (result.terminated) {
                disconnectProctoringSession(params.data.id);
            }
            return reply.send(result);
        }
    );

    fastify.post(
        "/secure-oa/sessions/:id/snapshots",
        { preHandler: [fastify.authenticate] },
        async (request, reply) => {
            const params = uuidParamSchema.safeParse(request.params);
            if (!params.success) {
                return reply.status(400).send(validationPayload(params.error));
            }
            const session = await assertCandidateOwnsSession(params.data.id, request.user!.id, reply);
            if (!session) return reply;
            if (session.status !== "active") {
                return rejectSnapshot(request, reply, 400, "session_not_active", {
                    error: "Validation Error",
                    code: "session_not_active",
                    message: "Secure OA session is not active.",
                }, {
                    sessionId: session.id,
                    sessionStatus: session.status,
                });
            }

            const fields: Record<string, unknown> = {};
            let imageBuffer: Buffer | null = null;
            let imageMimeType = "";

            for await (const part of (request as any).parts()) {
                if (part.type === "file") {
                    if (part.fieldname !== "image" || imageBuffer) {
                        part.file?.resume?.();
                        continue;
                    }
                    imageMimeType = String(part.mimetype || "");
                    imageBuffer = await part.toBuffer();
                    continue;
                }
                fields[part.fieldname] = part.value;
            }

            if (!imageBuffer) {
                return rejectSnapshot(request, reply, 400, "missing_image", {
                    error: "Validation Error",
                    message: "JPEG image field is required.",
                }, {
                    sessionId: session.id,
                    fields: Object.keys(fields),
                });
            }
            if (imageMimeType !== "image/jpeg") {
                return rejectSnapshot(request, reply, 400, "invalid_mime_type", {
                    error: "Validation Error",
                    message: "Only image/jpeg snapshots are accepted.",
                }, {
                    sessionId: session.id,
                    mimeType: imageMimeType,
                });
            }
            if (imageBuffer.length > PROCTORING_SNAPSHOT_MAX_BYTES) {
                return rejectSnapshot(request, reply, 400, "snapshot_too_large", {
                    error: "Validation Error",
                    message: "Snapshot is too large. Maximum size is 200KB.",
                }, {
                    sessionId: session.id,
                    byteSize: imageBuffer.length,
                });
            }

            const parsedFields = snapshotFieldsSchema.safeParse({
                taken_at: fields.taken_at,
                trigger: fields.trigger,
                triggering_client_event_id: fields.triggering_client_event_id,
            });
            if (!parsedFields.success) {
                return rejectSnapshot(request, reply, 400, "invalid_fields", validationPayload(parsedFields.error), {
                    sessionId: session.id,
                    fields,
                });
            }

            const snapshotId = crypto.randomUUID();
            const s3Key = `proctoring/${session.id}/${snapshotId}.jpg`;
            const uploaded = await uploadPrivateObjectToR2(s3Key, imageBuffer, "image/jpeg");
            const triggeringEvent = parsedFields.data.triggering_client_event_id
                ? await (prisma as any).proctoringEvent.findFirst({
                    where: {
                        sessionId: session.id,
                        clientEventId: parsedFields.data.triggering_client_event_id,
                    },
                    select: { id: true },
                })
                : null;

            await (prisma as any).proctoringSnapshot.create({
                data: {
                    id: snapshotId,
                    sessionId: session.id,
                    s3Key: uploaded.key,
                    s3Bucket: uploaded.bucket,
                    mimeType: "image/jpeg",
                    width: 0,
                    height: 0,
                    byteSize: imageBuffer.length,
                    takenAt: new Date(parsedFields.data.taken_at),
                    trigger: parsedFields.data.trigger,
                    triggeringEventId: triggeringEvent?.id || null,
                },
            });

            return reply.status(201).send({ snapshotId });
        }
    );

    fastify.post(
        "/secure-oa/sessions/:id/submit",
        { preHandler: [fastify.authenticate] },
        async (request, reply) => {
            const params = uuidParamSchema.safeParse(request.params);
            if (!params.success) {
                return reply.status(400).send(validationPayload(params.error));
            }
            const body = submitBodySchema.safeParse(request.body ?? {});
            if (!body.success) {
                return reply.status(400).send(validationPayload(body.error));
            }
            const session = await assertCandidateOwnsSession(params.data.id, request.user!.id, reply);
            if (!session) return reply;
            if (session.status !== "active") {
                return reply.status(400).send({
                    error: "Validation Error",
                    code: "session_not_active",
                    sessionStatus: session.status,
                    message: "Only active secure OA sessions can be submitted.",
                });
            }

            await (prisma as any).$transaction(async (tx: any) => {
                const ruleset = await loadActiveProctoringRules(tx, session.jobRoundId);
                const events = await tx.proctoringEvent.findMany({
                    where: { sessionId: session.id },
                    orderBy: { serverTimestamp: "asc" },
                });
                const score = Math.round(computeIntegrityScore(events.map((event: any) => ({
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
                const submittedAt = new Date();

                await tx.secureOaSession.update({
                    where: { id: session.id },
                    data: {
                        status: "submitted",
                        submittedAt,
                        integrityScore: score,
                        integrityRulesSnapshot: ruleset.rules,
                    },
                });

                const roundCandidate = await tx.jobRoundCandidate.findUnique({
                    where: { id: session.jobRoundCandidateId },
                    select: { metadata: true },
                });
                const metadata = toRecord(roundCandidate?.metadata);
                await tx.jobRoundCandidate.update({
                    where: { id: session.jobRoundCandidateId },
                    data: {
                        status: "submitted",
                        submittedAt,
                        score,
                        metadata: {
                            ...metadata,
                            oaStartedAt: session.startedAt?.toISOString?.() || metadata.oaStartedAt || null,
                            oaSubmittedAt: submittedAt.toISOString(),
                            secureOaSessionId: session.id,
                            integrityScore: score,
                            oaAnswers: body.data.answers.map((answer) => ({
                                questionId: answer.questionId,
                                answer: answer.answer,
                                language: answer.language || null,
                                timeSpentSeconds: answer.timeSpentSeconds ?? null,
                            })),
                        },
                    },
                });
            });

            disconnectProctoringSession(session.id);
            return reply.send({ status: "submitted" });
        }
    );
}
