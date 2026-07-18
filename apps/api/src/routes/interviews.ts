import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { INTERVIEW_TYPES, getStagesForType, type InterviewType } from "@interviewforge/shared";
import { InterviewModulesValidator } from "../services/agent/interview-modules-validator.js";
import {
    normalizeInterviewModuleConfig,
    resolveEffectiveInterviewTypeConfig,
} from "../services/agent/interview-module-selection.js";
import {
    requireInterviewCredit,
    reserveInterviewMinutesInTransaction,
    EntitlementError,
    settleInterviewMinuteReservation,
} from "../services/entitlements.js";
import { interviewMinuteCost } from "@interviewforge/shared";
import { broadcastPlanUpdate } from "../services/plan-websocket.js";
import { getCachedPlanData, invalidateUserPlanCache } from "../services/cache.js";
import {
    INTERNAL_SERVER_ERROR_MESSAGE,
    INTERNAL_SERVER_ERROR_NAME,
} from "../lib/user-facing-errors.js";

// Derive valid types directly from the shared registry so new types are picked up automatically
const VALID_INTERVIEW_TYPES = INTERVIEW_TYPES.map(t => t.type) as [string, ...string[]];

const interviewSessionParamsSchema = z.object({
    id: z.string().uuid(),
});

const createSessionSchema = z.object({
    type: z.enum(VALID_INTERVIEW_TYPES as [string, ...string[]]).default("full_interview"),
    mode: z.enum(["mock", "strict"]).default("mock"),
    resumeId: z.string().uuid().optional(),
    selectedType: z.string().optional(),
    difficulty: z.string().optional(),
    level: z.enum(["Junior", "Mid", "Senior"]).optional(),
    language: z.string().optional(),
    moduleConfig: z.object({
        version: z.literal(1).optional(),
        enabledStages: z.array(z.string()).min(1),
        disabledStages: z.array(z.string()).optional(),
        source: z.enum(["default", "custom"]).optional(),
        stageOptions: z.record(z.object({
            topics: z.array(z.string()).optional(),
            subtopics: z.array(z.string()).optional(),
            difficulty: z.string().optional(),
            includeSQL: z.boolean().optional(),
            questionCountPerTopic: z.number().optional(),
            resumeDeepDiveEnabled: z.boolean().optional(),
        })).optional(),
        stageDurations: z.record(z.object({
            min: z.number(),
            max: z.number(),
        })).optional(),
    }).optional(),
    // Module-derived interview length shown on the review screen. Persisted so the
    // interview room timer matches the estimate the user saw, for every type.
    estimatedMinutes: z.number().int().positive().max(180).optional(),
});

function isRetryableInfrastructureError(err: unknown): boolean {
    const message = err instanceof Error ? err.message : String(err ?? "");
    return /transaction already closed|expired transaction|timeout|timed out|connection|econnrefused|enotfound|can't reach database server/i.test(message);
}

function normalizeQuestionLevel(level?: string, difficulty?: string): string {
    const raw = (level || difficulty || "").trim().toLowerCase();
    if (["junior", "sde1", "easy"].includes(raw)) return "Junior";
    if (["senior", "senior sde", "staff engineer", "hard"].includes(raw)) return "Senior";
    return "Mid";
}

export default async function interviewRoutes(fastify: FastifyInstance) {
    // All routes require authentication
    fastify.addHook("preHandler", fastify.authenticate);

    const modulesValidator = new InterviewModulesValidator();

    // ─── List Available Interview Types ────────────────────────
    fastify.get("/interviews/types", async (_request, reply) => {
        reply.cacheControl("CONFIG");
        return { types: INTERVIEW_TYPES };
    });

    // ─── Create Interview Session ─────────────────────────────
    fastify.post("/interviews", async (request, reply) => {
        const parsed = createSessionSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({
                error: "Validation Error",
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const { mode } = parsed.data;
        const type = parsed.data.type as InterviewType;
        const questionLevel = normalizeQuestionLevel(parsed.data.level, parsed.data.difficulty);
        const moduleConfig = normalizeInterviewModuleConfig(type, parsed.data.moduleConfig);
        // Carry the review-screen estimate through on the persisted config so the
        // room timer can reflect the exact module-derived length (all interview types).
        if (typeof parsed.data.estimatedMinutes === "number") {
            (moduleConfig as any).estimatedMinutes = parsed.data.estimatedMinutes;
        }
        const resumeModuleEnabled = moduleConfig.enabledStages.includes("INTRO" as any) || type === "resume_round";
        const resumeId = resumeModuleEnabled ? parsed.data.resumeId : undefined;

        const preflight = modulesValidator.validate({
            interviewType: type,
            role: "Software Engineer",
            level: questionLevel,
            hasResume: Boolean(resumeId),
            isVoiceMode: false,
            moduleConfig,
        });

        if (!preflight.valid) {
            return reply.status(400).send({
                error: "Incompatible interview configuration",
                details: preflight.errors,
                warnings: preflight.warnings,
            });
        }

        // Entitlement pre-check: ensure the user has enough minutes for the full planned interview.
        try {
            await requireInterviewCredit(request.user!.id, type);
        } catch (err) {
            if (err instanceof EntitlementError) {
                return reply.status(err.statusCode).send({
                    error: err.code,
                    message: err.message,
                    plan: err.plan,
                    detail: err.detail,
                });
            }
            throw err;
        }

        // Get the starting stage for this interview type
        const effectiveConfig = resolveEffectiveInterviewTypeConfig(type, moduleConfig);
        const stages = effectiveConfig.stages.length
            ? effectiveConfig.stages
            : getStagesForType(type);
        const firstStage = stages[0] || "INTRO";

        const session = await (prisma.interviewSession as any).create({
            data: {
                userId: request.user!.id,
                type,
                role: "Software Engineer",
                level: questionLevel,
                mode,
                resumeId: resumeId ?? null,
                status: "PENDING",
                stage: firstStage,
                moduleConfig,
            },
            select: {
                id: true,
                type: true,
                role: true,
                level: true,
                mode: true,
                stage: true,
                status: true,
                createdAt: true,
                moduleConfig: true,
            },
        });

        await prisma.sessionMessage.create({
            data: {
                sessionId: session.id,
                role: "system",
                content: "Interview module configuration",
                stage: "CONFIG",
                metadata: { moduleConfig } as any,
            },
        });

        return reply.status(201).send({
            id: session.id,
            type: session.type,
            role: session.role,
            level: session.level,
            mode: session.mode,
            stage: session.stage,
            status: session.status,
            createdAt: session.createdAt,
            moduleConfig,
            minutesRequired: interviewMinuteCost(type),
            warnings: preflight.warnings,
        });
    });

    // ─── Start Interview (idempotent charge on room mount) ────
    // Reserves interview minutes when the user actually enters the room. The ledger
    // entry with refType="interview"+refId=sessionId makes this idempotent,
    // so a client retry never double-charges.
    fastify.post("/interviews/:id/start", async (request, reply) => {
        const parsedParams = interviewSessionParamsSchema.safeParse(request.params);
        if (!parsedParams.success) {
            return reply.status(400).send({
                error: "Validation Error",
                details: parsedParams.error.flatten().fieldErrors,
            });
        }

        const { id } = parsedParams.data;
        const userId = request.user!.id;

        console.log(`[Interviews] POST /interviews/${id}/start called by user ${userId.slice(0, 8)}`);

        try {
            const result = await prisma.$transaction(async (tx) => {
                const lockedRows = await tx.$queryRaw<Array<{ id: string }>>`
                    SELECT id
                    FROM "interview_sessions"
                    WHERE id = ${id} AND "user_id" = ${userId}
                    FOR UPDATE
                `;

                if (lockedRows.length === 0) {
                    console.log(`[Interviews] Session ${id} not found for user ${userId.slice(0, 8)}`);
                    return { notFound: true as const };
                }

                const session = await tx.interviewSession.findFirst({
                    where: { id, userId },
                    select: { id: true, type: true, startedAt: true },
                });
                if (!session) {
                    return { notFound: true as const };
                }

                // Dedupe via ledger after locking the session row. This prevents
                // two concurrent room loads from both passing the "not charged yet" check.
                const existing = await tx.creditLedger.findFirst({
                    where: { userId, refType: "interview", refId: session.id, delta: { lt: 0 } },
                });
                if (existing) {
                    console.log(`[Interviews] Session ${id} already started (minutes already reserved)`);
                    return {
                        id: session.id,
                        alreadyStarted: true,
                        minutesReserved: { free: 0, monthly: 0, purchased: 0 },
                        remainingTotal: null,
                    };
                }

                console.log(`[Interviews] Reserving minutes for session ${id}, type: ${session.type}`);
                const res = await reserveInterviewMinutesInTransaction(
                    tx,
                    userId,
                    interviewMinuteCost(session.type),
                    `interview_${session.type}`,
                    { type: "interview", id: session.id }
                );

                console.log(`[Interviews] Minutes reserved successfully:`, {
                    spent: res.spent,
                    remainingTotal: res.remainingTotal,
                    sessionId: session.id,
                    userId: userId.slice(0, 8),
                    interviewType: session.type,
                    minuteCost: interviewMinuteCost(session.type)
                });

                await tx.interviewSession.update({
                    where: { id: session.id },
                    data: { startedAt: new Date(), status: "IN_PROGRESS" },
                    select: { id: true },
                });

                return {
                    id: session.id,
                    alreadyStarted: false,
                    minutesReserved: res.spent,
                    remainingTotal: res.remainingTotal,
                };
            }, {
                maxWait: 5000,
                timeout: 15000,
            });

            if ("notFound" in result) {
                return reply.status(404).send({ error: "Not Found", message: "Session not found" });
            }

            // CRITICAL: Invalidate cache and broadcast update immediately after transaction
            try {
                console.log(`[Interviews] Invalidating cache for user ${userId.slice(0, 8)}...`);
                // Step 1: Invalidate the cache first
                await invalidateUserPlanCache(userId);
                console.log(`[Interviews] Cache invalidated successfully`);
                
                // Step 2: Fetch fresh data from database (this will also re-cache it)
                console.log(`[Interviews] Fetching fresh plan data...`);
                const planData = await getCachedPlanData(userId);
                console.log(`[Interviews] Fresh plan data fetched:`, {
                    plan: planData.plan,
                    wallet: planData.wallet
                });
                
                // Step 3: Broadcast the fresh data to all connected clients
                if (planData) {
                    console.log(`[Interviews] Broadcasting plan update...`);
                    broadcastPlanUpdate(userId, {
                        plan: planData.plan,
                        expiresAt: planData.expiresAt,
                        entitlements: planData.entitlements,
                        wallet: planData.wallet, // Include wallet data for logging
                    });
                }
                
                console.log(`[Interviews] Cache invalidated and plan update broadcasted for user ${userId.slice(0, 8)}`, {
                    wallet: planData?.wallet
                });
            } catch (err) {
                console.error('[Interviews] Failed to invalidate cache or broadcast plan update:', err);
                // Don't fail the request if broadcast fails
            }

            console.log(`[Interviews] Returning result:`, result);
            return reply.send(result);
        } catch (err) {
            if (err instanceof EntitlementError) {
                console.error(`[Interviews] Entitlement error:`, err.message);
                return reply.status(err.statusCode).send({
                    error: err.code,
                    message: err.message,
                    plan: err.plan,
                    detail: err.detail,
                });
            }

            if (isRetryableInfrastructureError(err)) {
                console.error(`[Interviews] Start failed due to temporary infra issue for user ${userId.slice(0, 8)}`, err);
                return reply.status(503).send({
                    error: INTERNAL_SERVER_ERROR_NAME,
                    message: INTERNAL_SERVER_ERROR_MESSAGE,
                });
            }

            throw err;
        }
    });

    // ─── List User's Interview Sessions ───────────────────────
    // Page-exit settlement endpoint. The normal End button still uses the
    // websocket session:end flow so report generation is unchanged.
    fastify.post("/interviews/:id/end", async (request, reply) => {
        const parsedParams = interviewSessionParamsSchema.safeParse(request.params);
        if (!parsedParams.success) {
            return reply.status(400).send({
                error: "Validation Error",
                details: parsedParams.error.flatten().fieldErrors,
            });
        }

        const { id } = parsedParams.data;
        const userId = request.user!.id;

        const session = await prisma.interviewSession.findFirst({
            where: { id, userId },
            select: { id: true, startedAt: true, completedAt: true },
        });

        if (!session) {
            return reply.status(404).send({ error: "Not Found", message: "Session not found" });
        }

        if (!session.startedAt) {
            return reply.send({ ok: true, settlement: null });
        }

        if (!session.completedAt) {
            await prisma.interviewSession.update({
                where: { id },
                data: { status: "COMPLETED", completedAt: new Date() },
                select: { id: true },
            });
        }

        const settlement = await settleInterviewMinuteReservation(userId, id, { broadcast: true });
        return reply.send({ ok: true, settlement });
    });

    // List User's Interview Sessions
    fastify.get("/interviews", async (request, reply) => {
        const userId = request.user!.id;
        const query = request.query as { limit?: string; offset?: string };
        const limit = Math.min(parseInt(query.limit || "20"), 50);
        const offset = parseInt(query.offset || "0");

        const [sessions, total] = await Promise.all([
            prisma.interviewSession.findMany({
                where: { userId },
                orderBy: { createdAt: "desc" },
                take: limit,
                skip: offset,
                select: {
                    id: true,
                    type: true,
                    role: true,
                    level: true,
                    mode: true,
                    stage: true,
                    status: true,
                    startedAt: true,
                    completedAt: true,
                    createdAt: true,
                    report: {
                        select: {
                            id: true,
                            overallScore: true,
                        },
                    },
                    messages: {
                        where: { role: "system", stage: "CONFIG" },
                        orderBy: { createdAt: "desc" },
                        take: 1,
                        select: { metadata: true },
                    },
                },
            }),
            prisma.interviewSession.count({ where: { userId } }),
        ]);

        reply.cacheControl("USER_SHORT");
        return {
            sessions: sessions.map((s) => ({
                id: s.id,
                type: s.type,
                role: s.role,
                level: s.level,
                mode: s.mode,
                stage: s.stage,
                status: s.status,
                moduleConfig: ((s as any).messages?.[0]?.metadata as any)?.moduleConfig ?? null,
                startedAt: s.startedAt,
                completedAt: s.completedAt,
                createdAt: s.createdAt,
                report: s.report
                    ? { id: s.report.id, score: Number(s.report.overallScore) }
                    : null,
            })),
            total,
            limit,
            offset,
        };
    });

    // ─── Get Interview Session Details ────────────────────────
    fastify.get("/interviews/:id", async (request, reply) => {
        const { id } = request.params as { id: string };

        const session = await prisma.interviewSession.findFirst({
            where: { id, userId: request.user!.id },
            select: {
                id: true,
                type: true,
                role: true,
                level: true,
                mode: true,
                stage: true,
                status: true,
                startedAt: true,
                completedAt: true,
                resume: {
                    select: { fileName: true, analysis: true },
                },
                sessionQuestions: true,
                report: true,
                messages: {
                    where: { role: "system", stage: "CONFIG" },
                    orderBy: { createdAt: "desc" },
                    take: 1,
                    select: { metadata: true },
                },
            },
        });

        if (!session) {
            return reply.status(404).send({
                error: "Not Found",
                message: "Interview session not found",
            });
        }

        reply.cacheControl("USER_SHORT");

        return {
            id: session.id,
            type: session.type,
            role: session.role,
            level: session.level,
            mode: session.mode,
            stage: session.stage,
            status: session.status,
            moduleConfig: ((session as any).messages?.[0]?.metadata as any)?.moduleConfig ?? null,
            startedAt: session.startedAt,
            completedAt: session.completedAt,
            resume: session.resume,
            questions: session.sessionQuestions.map((sq, idx) => {
                const inferredCategory = sq.questionCategory
                    || (sq.questionSqlId ? "sql"
                        : sq.questionFundamentalId
                            ? (session.type === "gen_ai_role" ? "genai_concepts" : "cs_fundamentals")
                            : session.type === "system_design" ? "system_design"
                                : "general");

                return {
                    id: sq.id,
                    title: sq.questionTitle || `Question ${idx + 1}`,
                    category: inferredCategory,
                    difficulty: sq.questionDifficulty || "unspecified",
                    timeSpent: sq.timeSpent,
                    score: sq.score ? Number(sq.score) : null,
                };
            }),
            report: session.report
                ? {
                    id: session.report.id,
                    overallScore: Number(session.report.overallScore),
                    rubricScores: session.report.rubricScores,
                    strengths: session.report.strengths,
                    improvements: session.report.improvements,
                }
                : null,
        };
    });

    // ═══════════════════════════════════════════════════════════
    // Interview Recording Endpoints
    // ═══════════════════════════════════════════════════════════

    const {
        createMultipartUpload,
        getPresignedPartUrl,
        completeMultipartUpload: completeMultipartR2,
        abortMultipartUpload: abortMultipartR2,
        getRecordingPresignedDownloadUrl,
    } = await import("../lib/r2.js");
    const { getActivePlan } = await import("../services/entitlements.js");
    const { PLAN_ENTITLEMENTS } = await import("@interviewforge/shared");

    /** Gate: throw 403 if user's plan doesn't include recording access */
    async function requireRecordingAccess(userId: string) {
        const plan = await getActivePlan(userId);
        const ent = PLAN_ENTITLEMENTS[plan];
        if (!ent.interviewRecordingAccess) {
            throw new EntitlementError(
                "RECORDING_LOCKED",
                "Interview recording is available on Pro and Max plans.",
                plan,
                403,
                { feature: "interview_recording" }
            );
        }
        return { plan, retentionDays: ent.recordingRetentionDays };
    }

    // ─── Start Recording (create multipart upload) ────────────
    const startRecordingSchema = z.object({
        mimeType: z.string().default("video/webm"),
    });

    fastify.post("/interviews/:sessionId/recording/start", async (request, reply) => {
        const { sessionId } = request.params as { sessionId: string };
        const userId = request.user!.id;
        const parsed = startRecordingSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({ error: "Validation Error", details: parsed.error.flatten().fieldErrors });
        }
        const { mimeType } = parsed.data;

        // Verify session ownership and status
        const session = await prisma.interviewSession.findFirst({
            where: { id: sessionId, userId },
            select: { id: true, status: true },
        });
        if (!session) {
            return reply.status(404).send({ error: "Not Found", message: "Session not found" });
        }
        if (session.status !== "IN_PROGRESS") {
            return reply.status(400).send({ error: "Bad Request", message: "Session must be in progress to start recording" });
        }

        // Premium gate
        try {
            await requireRecordingAccess(userId);
        } catch (err) {
            if (err instanceof EntitlementError) {
                return reply.status(err.statusCode).send({
                    error: err.code, message: err.message, plan: err.plan, detail: err.detail,
                });
            }
            throw err;
        }

        // Existing rows are reset below. Do not reuse an old multipart uploadId:
        // R2 may already have aborted it while the DB row still says RECORDING.
        const existing = await prisma.interviewRecording.findUnique({
            where: { sessionId },
            select: { id: true, r2UploadId: true, r2Key: true, status: true },
        });
        if (existing && existing.status === "RECORDING" && existing.r2UploadId) {
            await abortMultipartR2(existing.r2Key, existing.r2UploadId).catch((err) => {
                console.warn("[Recording] Existing multipart upload could not be aborted before restart:", err);
            });
        }

        const ext = mimeType.includes("mp4") ? "mp4" : "webm";
        const r2Key = `recordings/${userId}/${sessionId}.${ext}`;

        // R2 call — any failure bubbles to Fastify's global error handler → generic 500
        const uploadId = await createMultipartUpload(r2Key, mimeType).catch((err) => {
            console.error("[Recording] R2 createMultipartUpload failed:", err);
            throw err;
        });

        // DB write — on failure, best-effort abort the R2 multipart then rethrow → generic 500
        const recording = await (existing
            ? prisma.interviewRecording.update({
                where: { id: existing.id },
                data: {
                    r2Key,
                    r2UploadId: uploadId,
                    mimeType,
                    status: "RECORDING",
                    durationSec: null,
                    fileSizeBytes: null,
                    expiresAt: null,
                    completedAt: null,
                },
            })
            : prisma.interviewRecording.create({
                data: {
                    sessionId,
                    userId,
                    r2Key,
                    r2UploadId: uploadId,
                    mimeType,
                    status: "RECORDING",
                },
            })
        ).catch(async (err) => {
            console.error("[Recording] DB create failed:", err);
            await abortMultipartR2(r2Key, uploadId).catch(() => { });
            throw err;
        });

        return reply.status(201).send({
            recordingId: recording.id,
            uploadId,
            r2Key,
        });
    });

    // ─── Presign Part (get presigned PUT URL for one chunk) ───
    const presignPartSchema = z.object({
        uploadId: z.string().min(1),
        partNumber: z.number().int().min(1).max(10000),
    });

    fastify.post("/interviews/:sessionId/recording/presign-part", async (request, reply) => {
        const { sessionId } = request.params as { sessionId: string };
        const userId = request.user!.id;
        const parsed = presignPartSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({ error: "Validation Error", details: parsed.error.flatten().fieldErrors });
        }
        const { uploadId, partNumber } = parsed.data;

        const rec = await prisma.interviewRecording.findFirst({
            where: { sessionId, userId },
            select: { r2Key: true, r2UploadId: true, status: true },
        });
        if (!rec) {
            return reply.status(404).send({ error: "Not Found", message: "Recording not found" });
        }
        if (rec.status !== "RECORDING") {
            return reply.status(409).send({ error: "Conflict", message: "Recording is not in RECORDING state" });
        }
        if (rec.r2UploadId !== uploadId) {
            return reply.status(400).send({ error: "Bad Request", message: "Upload ID mismatch" });
        }

        const presignedUrl = await getPresignedPartUrl(rec.r2Key, uploadId, partNumber);
        return reply.send({ presignedUrl });
    });

    // ─── Complete Recording (assemble multipart upload) ───────
    const completeRecordingSchema = z.object({
        uploadId: z.string().min(1),
        parts: z.array(z.object({
            partNumber: z.number().int().min(1),
            ETag: z.string().min(1),
        })).min(1),
        durationSec: z.number().int().min(0),
        fileSizeBytes: z.number().int().min(0),
    });

    fastify.post("/interviews/:sessionId/recording/complete", async (request, reply) => {
        const { sessionId } = request.params as { sessionId: string };
        const userId = request.user!.id;
        const parsed = completeRecordingSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({ error: "Validation Error", details: parsed.error.flatten().fieldErrors });
        }
        const { uploadId, parts, durationSec, fileSizeBytes } = parsed.data;

        const rec = await prisma.interviewRecording.findFirst({
            where: { sessionId, userId },
            select: { id: true, r2Key: true, r2UploadId: true, status: true },
        });
        if (!rec) {
            return reply.status(404).send({ error: "Not Found", message: "Recording not found" });
        }
        if (rec.status !== "RECORDING" && rec.status !== "UPLOADING") {
            return reply.status(409).send({ error: "Conflict", message: `Cannot complete recording in ${rec.status} state` });
        }
        if (rec.r2UploadId !== uploadId) {
            return reply.status(400).send({ error: "Bad Request", message: "Upload ID mismatch" });
        }

        // Get retention days for expiry calculation
        let retentionDays = 30;
        try {
            const access = await requireRecordingAccess(userId);
            retentionDays = access.retentionDays;
        } catch {
            // If plan downgraded mid-interview, still complete the upload with default 30 days
        }

        try {
            await completeMultipartR2(
                rec.r2Key,
                uploadId,
                parts.map(p => ({ PartNumber: p.partNumber, ETag: p.ETag }))
            );
        } catch (err) {
            await prisma.interviewRecording.update({
                where: { id: rec.id },
                data: { status: "FAILED", r2UploadId: null },
            });
            console.error("[Recording] CompleteMultipartUpload failed:", err);
            return reply.status(500).send({ error: "Upload Failed", message: "Failed to assemble recording in storage" });
        }

        const expiresAt = new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000);
        const updated = await prisma.interviewRecording.update({
            where: { id: rec.id },
            data: {
                status: "READY",
                r2UploadId: null,
                durationSec,
                fileSizeBytes: BigInt(fileSizeBytes),
                expiresAt,
                completedAt: new Date(),
            },
        });

        return reply.send({
            recordingId: updated.id,
            expiresAt,
            durationSec,
        });
    });

    // ─── Abort Recording (clean up multipart upload) ──────────
    const abortRecordingSchema = z.object({
        uploadId: z.string().min(1),
    });

    fastify.post("/interviews/:sessionId/recording/abort", async (request, reply) => {
        const { sessionId } = request.params as { sessionId: string };
        const userId = request.user!.id;
        const parsed = abortRecordingSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({ error: "Validation Error", details: parsed.error.flatten().fieldErrors });
        }
        const { uploadId } = parsed.data;

        const rec = await prisma.interviewRecording.findFirst({
            where: { sessionId, userId },
            select: { id: true, r2Key: true, r2UploadId: true, status: true },
        });
        if (!rec) {
            return reply.status(404).send({ error: "Not Found", message: "Recording not found" });
        }
        if (rec.status !== "RECORDING") {
            return reply.status(409).send({ error: "Conflict", message: "Recording is not in RECORDING state" });
        }
        if (rec.r2UploadId !== uploadId) {
            return reply.status(400).send({ error: "Bad Request", message: "Upload ID mismatch" });
        }

        try {
            await abortMultipartR2(rec.r2Key, uploadId);
        } catch (err) {
            console.error("[Recording] AbortMultipartUpload failed (may already be cleaned up):", err);
        }

        await prisma.interviewRecording.update({
            where: { id: rec.id },
            data: { status: "FAILED", r2UploadId: null },
        });

        return reply.send({ aborted: true });
    });

    // ─── Get Recording (presigned playback/download URL) ──────
    fastify.get("/interviews/:sessionId/recording", async (request, reply) => {
        const { sessionId } = request.params as { sessionId: string };
        const userId = request.user!.id;

        const rec = await prisma.interviewRecording.findFirst({
            where: { sessionId, userId },
            select: {
                id: true, r2Key: true, status: true, mimeType: true,
                durationSec: true, fileSizeBytes: true, expiresAt: true,
            },
        });
        if (!rec) {
            return reply.status(404).send({ error: "Not Found", message: "No recording found for this session" });
        }

        if (rec.status === "EXPIRED") {
            return reply.status(410).send({
                error: "Gone",
                message: "This recording has expired",
                expired: true,
                expiresAt: rec.expiresAt,
            });
        }
        if (rec.status !== "READY") {
            return reply.status(409).send({
                error: "Conflict",
                message: `Recording is in ${rec.status} state`,
                status: rec.status,
            });
        }
        if (rec.expiresAt && rec.expiresAt < new Date()) {
            return reply.status(410).send({
                error: "Gone",
                message: "This recording has expired",
                expired: true,
                expiresAt: rec.expiresAt,
            });
        }

        // Re-validate premium access at fetch time
        try {
            await requireRecordingAccess(userId);
        } catch (err) {
            if (err instanceof EntitlementError) {
                return reply.status(err.statusCode).send({
                    error: err.code, message: err.message, plan: err.plan, detail: err.detail,
                });
            }
            throw err;
        }

        const playbackUrl = await getRecordingPresignedDownloadUrl(rec.r2Key, 3600);

        return reply.send({
            playbackUrl,
            durationSec: rec.durationSec,
            fileSizeBytes: rec.fileSizeBytes ? Number(rec.fileSizeBytes) : null,
            mimeType: rec.mimeType,
            expiresAt: rec.expiresAt,
        });
    });
}

