// ============================================
// WebSocket Server — Socket.io
// ============================================
// Handles real-time communication between the
// interview room frontend and the AI agent.
// Designed so voice bot can replace or augment
// the text channel later.

import { Server as SocketIOServer, Socket } from "socket.io";
import { Server as HTTPServer } from "http";
import { z } from "zod";
import { getSupabaseAdmin } from "../lib/supabase.js";
import { checkRateLimit } from "../lib/rate-limiter.js";
import { prisma } from "../lib/prisma.js";
import {
    initializeSession,
    processAgentTurn,
    updateCodeSnapshot,
    updateCanvasSnapshot,
    updateNotepadSnapshot,
    cleanupSession,
    getSessionState,
    forceDSATimeoutTransition,
} from "./agent/interview-orchestrator.js";
import {
    startVoiceSession,
    sendAudioToVoice,
    sendAudioBufferToVoice,
    sendTextToVoice,
    stopVoiceSession,
    updateVoiceCodeSnapshot,
    updateVoiceCanvasSnapshot,
    updateVoiceNotepadSnapshot,
    isVoiceSessionActive,
    setVoiceMuteState,
    setVoicePTTMode,
    setVoicePTTHolding,
    releaseVoicePTT,
    forceVoiceDSATimeoutTransition,
} from "./voice-pipeline.js";
import { generateReport } from "./report-generator.js";
import { resolveEffectiveInterviewTypeConfig } from "./agent/interview-module-selection.js";
import { settleInterviewMinuteReservation } from "./entitlements.js";
import { getInterviewTypeConfig } from "./agent/interview-types/index.js";
import { updateStreakForUser } from "./streak-service.js";
import { InterviewModulesValidator } from "./agent/interview-modules-validator.js";
import { validatePrefetchState } from "./agent/prefetch-state-validator.js";
import {
    AUTHENTICATION_FAILED_MESSAGE,
    INTERNAL_SERVER_ERROR_MESSAGE,
    isConnectivityIssue,
    sanitizeErrorMessage,
} from "../lib/user-facing-errors.js";
import {
    canvasSnapshotPayloadSchema,
    chatMessagePayloadSchema,
    codeRunPayloadSchema,
    codeSnapshotPayloadSchema,
    notepadSnapshotPayloadSchema,
    parseVoiceTextPayload,
    sessionJoinPayloadSchema,
    summarizeValidationError,
    voiceBinaryAudioPayloadSchema,
    voiceAudioPayloadSchema,
    voiceMutePayloadSchema,
    voicePTTModePayloadSchema,
} from "./interview-websocket-validation.js";
import {
    appendDirectInterviewMessage,
    authorizeDirectInterviewParticipant,
    directInterviewRoom,
    markDirectInterviewMessagesRead,
} from "./direct-interview-chat.js";

const directInterviewJoinPayloadSchema = z.object({
    roundCandidateId: z.string().uuid(),
});
const directInterviewMessagePayloadSchema = directInterviewJoinPayloadSchema.extend({
    content: z.string().trim().min(1).max(4000),
    clientMessageId: z.string().trim().min(1).max(120).optional(),
});

function normalizeBinaryAudio(value: unknown): Buffer | null {
    if (Buffer.isBuffer(value)) return value;
    if (value instanceof ArrayBuffer) return Buffer.from(value);
    if (ArrayBuffer.isView(value)) {
        return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    }
    return null;
}

function classifyVoiceErrorReason(error: unknown): string {
    const rawMessage = typeof error === "string"
        ? error
        : (error as any)?.message || (error as any)?.toString?.() || "";

    if (/429|rate limit|spending limit|credits|quota|resource.*exhausted/i.test(rawMessage)) {
        return "provider_quota_or_rate_limit";
    }

    if (/401|403|unauthorized|forbidden|authentication|api key/i.test(rawMessage)) {
        return "provider_auth";
    }

    if (/text-to-speech|tts|audio generation|xai tts|no response body from tts/i.test(rawMessage)) {
        return "tts_provider";
    }

    if (/speech recognition|stt|deepgram|transcription/i.test(rawMessage)) {
        return "stt_provider";
    }

    if (/voice mode|compatib|stage|module/i.test(rawMessage)) {
        return "voice_configuration";
    }

    if (/econnrefused|enotfound|etimedout|network|connection|timeout/i.test(rawMessage)) {
        return "network";
    }

    if (/database|prisma|mongodb|query failed/i.test(rawMessage)) {
        return "data_dependency";
    }

    return "unknown";
}

export function createWebSocketServer(httpServer: HTTPServer): SocketIOServer {
    const devOrigins = process.env.NODE_ENV !== "production"
        ? [
            "http://localhost:3000",
            "http://127.0.0.1:3000",
            "http://localhost:3003",
            "http://127.0.0.1:3003",
        ]
        : [];
    const io = new SocketIOServer(httpServer, {
        cors: {
            origin: [
                "https://practers.com",
                "https://www.practers.com",
                process.env.FRONTEND_URL || "",
                process.env.CLIENT_URL || "",
                ...devOrigins,
            ].filter(Boolean),
            methods: ["GET", "POST"],
            credentials: true,
        },
        transports: ["websocket", "polling"],
    });

    // ── Auth Middleware ───────────────────────────────────────
    io.use(async (socket, next) => {
        const token = socket.handshake.auth?.token;

        if (!token) {
            return next(new Error("Authentication required"));
        }

        try {
            const supabase = getSupabaseAdmin();
            const { data, error } = await supabase.auth.getUser(token);

            if (error) {
                if (isConnectivityIssue(error)) {
                    return next(new Error(INTERNAL_SERVER_ERROR_MESSAGE));
                }
                return next(new Error(AUTHENTICATION_FAILED_MESSAGE));
            }

            if (!data.user) {
                return next(new Error(AUTHENTICATION_FAILED_MESSAGE));
            }

            // Attach user info to socket
            (socket as any).userId = data.user.id;
            (socket as any).userEmail = data.user.email;
            (socket as any).userMetadata = data.user.user_metadata || {};
            next();
        } catch (err) {
            if (isConnectivityIssue(err)) {
                return next(new Error(INTERNAL_SERVER_ERROR_MESSAGE));
            }
            next(new Error(AUTHENTICATION_FAILED_MESSAGE));
        }
    });

    // ── Connection Handler ───────────────────────────────────
    io.on("connection", (socket: Socket) => {
        const userId = (socket as any).userId;
        const userEmail = (socket as any).userEmail;
        const userMetadata = (socket as any).userMetadata || {};
        const modulesValidator = new InterviewModulesValidator();

        let currentSessionId: string | null = null;
        let lastValidatedAt = 0;

        // Re-verify session ownership if stale (>60s since last check)
        const revalidateSession = async (): Promise<boolean> => {
            if (!currentSessionId) return false;
            const now = Date.now();
            if (now - lastValidatedAt < 60_000) return true;

            const session = await prisma.interviewSession.findUnique({
                where: { id: currentSessionId },
                select: { userId: true, status: true },
            });

            if (!session || session.userId !== userId) {
                socket.emit("error", {
                    code: "UNAUTHORIZED",
                    message: "Session ownership validation failed",
                });
                socket.disconnect(true);
                return false;
            }

            if (session.status === "COMPLETED") {
                socket.emit("session:ended", {
                    message: "This interview has already ended.",
                });
                return false;
            }

            lastValidatedAt = now;
            return true;
        };

        // Helper to emit events for the current session room
        const emitToSession = (event: string, payload: any) => {
            if (currentSessionId) {
                io.to(currentSessionId).emit(event, payload);
            }
        };

        const emitValidationError = (eventName: string, details: string) => {
            socket.emit("error", {
                code: "VALIDATION_ERROR",
                message: `Invalid payload for ${eventName}. ${details}`,
            });
        };

        // ── Join Interview Session ───────────────────────────
        const emitDirectInterviewError = (message: string, code = "DIRECT_INTERVIEW_ERROR") => {
            socket.emit("direct_interview:error", { code, message });
        };

        const authorizeDirectInterviewEvent = async (roundCandidateId: string) => {
            const result = await authorizeDirectInterviewParticipant({
                roundCandidateId,
                userId,
                userEmail,
                userMetadata,
            });

            if (!result) {
                emitDirectInterviewError("You are not authorized to open this direct interview chat.", "UNAUTHORIZED");
                return null;
            }

            return result;
        };

        socket.on("direct_interview:join", async (data: unknown) => {
            const parsed = directInterviewJoinPayloadSchema.safeParse(data);
            if (!parsed.success) {
                emitDirectInterviewError(summarizeValidationError(parsed.error), "VALIDATION_ERROR");
                return;
            }

            const authorized = await authorizeDirectInterviewEvent(parsed.data.roundCandidateId);
            if (!authorized) return;

            const room = directInterviewRoom(parsed.data.roundCandidateId);
            await socket.join(room);
            const messages = await markDirectInterviewMessagesRead({
                interview: authorized.interview,
                actor: authorized.actor,
            });

            socket.emit("direct_interview:joined", {
                roundCandidateId: parsed.data.roundCandidateId,
                actorType: authorized.actor.type,
                messages,
            });
        });

        socket.on("direct_interview:message", async (data: unknown) => {
            const parsed = directInterviewMessagePayloadSchema.safeParse(data);
            if (!parsed.success) {
                emitDirectInterviewError(summarizeValidationError(parsed.error), "VALIDATION_ERROR");
                return;
            }

            const rl = checkRateLimit(`direct_interview_ws:${userId}`, 30, 60_000);
            if (!rl.allowed) {
                emitDirectInterviewError(`Too many messages. Please wait ${Math.ceil(rl.retryAfterMs / 1000)}s.`, "RATE_LIMITED");
                return;
            }

            const authorized = await authorizeDirectInterviewEvent(parsed.data.roundCandidateId);
            if (!authorized) return;

            const message = await appendDirectInterviewMessage({
                interview: authorized.interview,
                actor: authorized.actor,
                content: parsed.data.content,
            });

            io.to(directInterviewRoom(parsed.data.roundCandidateId)).emit("direct_interview:message", {
                roundCandidateId: parsed.data.roundCandidateId,
                message: {
                    ...message,
                    clientMessageId: parsed.data.clientMessageId || null,
                },
            });
        });

        socket.on("direct_interview:read", async (data: unknown) => {
            const parsed = directInterviewJoinPayloadSchema.safeParse(data);
            if (!parsed.success) {
                emitDirectInterviewError(summarizeValidationError(parsed.error), "VALIDATION_ERROR");
                return;
            }

            const authorized = await authorizeDirectInterviewEvent(parsed.data.roundCandidateId);
            if (!authorized) return;

            const messages = await markDirectInterviewMessagesRead({
                interview: authorized.interview,
                actor: authorized.actor,
            });

            io.to(directInterviewRoom(parsed.data.roundCandidateId)).emit("direct_interview:read", {
                roundCandidateId: parsed.data.roundCandidateId,
                actorType: authorized.actor.type,
                messages,
            });
        });

        socket.on("session:join", async (data: unknown) => {
            try {
                const parsedJoin = sessionJoinPayloadSchema.safeParse(data);
                if (!parsedJoin.success) {
                    emitValidationError("session:join", summarizeValidationError(parsedJoin.error));
                    return;
                }
                const joinData = parsedJoin.data;

                // Verify the user owns this session before joining
                const session = await prisma.interviewSession.findUnique({
                    where: { id: joinData.sessionId },
                    select: { userId: true, status: true, stage: true, type: true, role: true, level: true },
                });
                if (!session || session.userId !== userId) {
                    return socket.emit("error", {
                        code: "UNAUTHORIZED",
                        message: "You are not authorized to join this session",
                    });
                }

                const manifestValidation = modulesValidator.validateManifest((session.type || "full_interview") as any);
                if (!manifestValidation.valid) {
                    return socket.emit("error", {
                        code: "MANIFEST_ERROR",
                        message: "Interview type configuration is invalid.",
                        details: manifestValidation.errors,
                    });
                }

                currentSessionId = joinData.sessionId;
                lastValidatedAt = Date.now();
                await socket.join(joinData.sessionId);

                // Never re-initialize completed sessions (prevents restart on reconnect)
                if (session.status === "COMPLETED") {
                    const interviewType = (session.type || "full_interview") as any;
                    const typeConfig = getInterviewTypeConfig(interviewType);
                    socket.emit("session:joined", {
                        sessionId: joinData.sessionId,
                        stage: session.stage,
                        interviewType,
                        stageOrder: typeConfig.stages,
                        role: session.role,
                        level: session.level,
                        isCompleted: true,
                    });
                    socket.emit("session:ended", {
                        message: "This interview has already ended.",
                    });
                    return;
                }

                // Initialize the agent and send greeting.
                // initializeSession is idempotent: if the session is already in
                // memory it returns the existing state without re-initializing,
                // re-fetching questions, or sending another greeting (rejoin path).
                const wasAlreadyActive = !!getSessionState(joinData.sessionId);
                const state = await initializeSession(joinData.sessionId, emitToSession, !!joinData.isVoiceMode);
                const effectiveTypeConfig = resolveEffectiveInterviewTypeConfig(
                    state.interviewType,
                    state.moduleConfig
                );

                const prefetchValidation = validatePrefetchState({
                    interviewType: state.interviewType,
                    prefetchedDSAQuestion: state.prefetchedDSAQuestion,
                    prefetchedCSQuestions: state.prefetchedCSQuestions,
                    prefetchedSQLQuestion: state.prefetchedSQLQuestion,
                    prefetchedSDQuestion: state.prefetchedSDQuestion,
                    prefetchedBehavioralQuestions: state.prefetchedBehavioralQuestions,
                    prefetchedGenAIConceptQuestions: state.prefetchedGenAIConceptQuestions,
                    prefetchedGenAICodingQuestion: state.prefetchedGenAICodingQuestion,
                    prefetchedGenAISystemDesignQuestion: state.prefetchedGenAISystemDesignQuestion,
                    prefetchedDSConceptQuestions: state.prefetchedDSConceptQuestions,
                    prefetchedDSSQLQuestion: state.prefetchedDSSQLQuestion,
                    prefetchedDSCodingQuestion: state.prefetchedDSCodingQuestion,
                    prefetchedPMCaseQuestion: state.prefetchedPMCaseQuestion,
                    prefetchedPMConceptQuestions: state.prefetchedPMConceptQuestions,
                    prefetchedPMStrategyQuestion: state.prefetchedPMStrategyQuestion,
                    prefetchedProblemSolvingCaseQuestion: state.prefetchedProblemSolvingCaseQuestion,
                    resumeSummary: state.resumeSummary,
                    cachedQuestionData: state.cachedQuestionData,
                    prefetchRequirements: effectiveTypeConfig.compatibilityManifest?.prefetchRequirements,
                });

                if (!prefetchValidation.complete) {
                    cleanupSession(joinData.sessionId);
                    return socket.emit("session:join_failed", {
                        code: "PREFETCH_INCOMPLETE",
                        message: "Interview initialization failed to load required session data.",
                        missing: prefetchValidation.missing,
                        unpopulated: prefetchValidation.unpopulated,
                    });
                }

                if (prefetchValidation.warnings.length > 0) {
                    socket.emit("session:compatibility_warning", {
                        warnings: prefetchValidation.warnings,
                    });
                }

                socket.emit("session:joined", {
                    sessionId: joinData.sessionId,
                    stage: state.currentStage,
                    interviewType: state.interviewType,
                    // Company screening's real duration lives in moduleConfig.stageDurations
                    // (BEHAVIOURAL.max = blueprint.durationMinutes). Emit it so the screening
                    // room timer reflects the configured length instead of falling back to the
                    // per-type default (behavioural = 15 min). Gated to screening so practice
                    // room timers are untouched.
                    stageDurations: state.companyScreening
                        ? (state.moduleConfig as any)?.stageDurations ?? null
                        : undefined,
                    stageOrder: state.stageOrder,
                    role: state.role,
                    level: state.level,
                    // Module-derived interview length (minutes) so the room timer
                    // matches the estimate shown at setup. Null for legacy sessions.
                    estimatedMinutes: (state.moduleConfig as any)?.estimatedMinutes ?? null,
                    // Tell the client this is a reconnect so it can skip the
                    // loading screen and show a brief "reconnected" indicator instead.
                    isRejoin: wasAlreadyActive,
                });
            } catch (err: any) {
                console.error(`[WS] Session join error:`, err);
                socket.emit("session:join_failed", {
                    message: err.message || "Failed to join session",
                });
                socket.emit("error", {
                    message: err.message || "Failed to join session",
                });
            }
        });

        // ── Chat Message from User ───────────────────────────
        socket.on("chat:message", async (data: unknown) => {
            if (!currentSessionId) {
                return socket.emit("error", { message: "Not in a session" });
            }

            const parsedMessage = chatMessagePayloadSchema.safeParse(data);
            if (!parsedMessage.success) {
                emitValidationError("chat:message", summarizeValidationError(parsedMessage.error));
                return;
            }
            const messageData = parsedMessage.data;

            const statusCheck = await prisma.interviewSession.findUnique({
                where: { id: currentSessionId },
                select: { status: true },
            });
            if (!statusCheck || statusCheck.status === "COMPLETED") {
                socket.emit("session:ended", {
                    message: "This interview has already ended.",
                });
                return;
            }

            if (!(await revalidateSession())) return;

            // Rate limit: 10 messages per 60s per user
            const rl = checkRateLimit(`chat:${userId}`, 10, 60_000);
            if (!rl.allowed) {
                return socket.emit("error", {
                    message: `Too many messages. Please wait ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
                });
            }

            // If canvas snapshot is piggybacked, update session state
            if (messageData.canvasSnapshot) {
                updateCanvasSnapshot(currentSessionId, messageData.canvasSnapshot);
                // Also forward to voice session if active
                updateVoiceCanvasSnapshot(currentSessionId, messageData.canvasSnapshot);
            }

            try {
                await processAgentTurn(
                    currentSessionId,
                    messageData.content,
                    emitToSession
                );
            } catch (err: any) {
                console.error(`[WS] Agent error:`, err);
                socket.emit("error", {
                    message: "The AI interviewer encountered an error. Please try again.",
                });
            }
        });

        // ── Code Snapshot (sent every 30s during DSA) ────────
        socket.on("code:snapshot", (data: unknown) => {
            if (currentSessionId) {
                const parsedSnapshot = codeSnapshotPayloadSchema.safeParse(data);
                if (!parsedSnapshot.success) {
                    emitValidationError("code:snapshot", summarizeValidationError(parsedSnapshot.error));
                    return;
                }

                updateCodeSnapshot(currentSessionId, parsedSnapshot.data.code, parsedSnapshot.data.language);
                // Also forward to voice session if active
                updateVoiceCodeSnapshot(currentSessionId, parsedSnapshot.data.code, parsedSnapshot.data.language);
            }
        });

        socket.on("dsa:timeout", async () => {
            if (!currentSessionId) {
                return socket.emit("error", { message: "Not in a session" });
            }

            const statusCheck = await prisma.interviewSession.findUnique({
                where: { id: currentSessionId },
                select: { status: true },
            });
            if (!statusCheck || statusCheck.status === "COMPLETED") {
                socket.emit("session:ended", {
                    message: "This interview has already ended.",
                });
                return;
            }

            if (!(await revalidateSession())) return;

            try {
                const handled = isVoiceSessionActive(currentSessionId)
                    ? await forceVoiceDSATimeoutTransition(currentSessionId)
                    : await forceDSATimeoutTransition(currentSessionId, emitToSession);
                if (!handled) {
                    socket.emit("error", {
                        message: "Coding timer expired, but the coding round is no longer active.",
                    });
                }
            } catch (err) {
                console.error(`[WS] DSA timeout transition error:`, err);
                socket.emit("error", {
                    message: "Could not move forward after the coding timer expired. Please try again.",
                });
            }
        });

        // ── Canvas Snapshot (Excalidraw JSON, piggybacked or explicit) ──
        socket.on("canvas:snapshot", (data: unknown) => {
            if (currentSessionId) {
                const parsedCanvas = canvasSnapshotPayloadSchema.safeParse(data);
                if (!parsedCanvas.success) {
                    emitValidationError("canvas:snapshot", summarizeValidationError(parsedCanvas.error));
                    return;
                }

                updateCanvasSnapshot(currentSessionId, parsedCanvas.data.elements);
                // Also forward to voice session if active
                updateVoiceCanvasSnapshot(currentSessionId, parsedCanvas.data.elements);
            }
        });

        // ── Code Run Request ─────────────────────────────────
        // PM Notepad Snapshot (Tiptap HTML)
        socket.on("notepad:snapshot", (data: unknown) => {
            if (currentSessionId) {
                const parsedNotepad = notepadSnapshotPayloadSchema.safeParse(data);
                if (!parsedNotepad.success) {
                    emitValidationError("notepad:snapshot", summarizeValidationError(parsedNotepad.error));
                    return;
                }

                updateNotepadSnapshot(currentSessionId, parsedNotepad.data.html);
                updateVoiceNotepadSnapshot(currentSessionId, parsedNotepad.data.html);
            }
        });

        socket.on("code:run", async (data: unknown) => {
            if (!currentSessionId) return;

            const parsedCodeRun = codeRunPayloadSchema.safeParse(data);
            if (!parsedCodeRun.success) {
                emitValidationError("code:run", summarizeValidationError(parsedCodeRun.error));
                return;
            }
            const codeRunData = parsedCodeRun.data;

            const statusCheck = await prisma.interviewSession.findUnique({
                where: { id: currentSessionId },
                select: { status: true },
            });
            if (!statusCheck || statusCheck.status === "COMPLETED") {
                socket.emit("session:ended", {
                    message: "This interview has already ended.",
                });
                return;
            }

            if (!(await revalidateSession())) return;

            // Rate limit: 5 code runs per 60s per user
            const rl = checkRateLimit(`coderun:${userId}`, 5, 60_000);
            if (!rl.allowed) {
                return socket.emit("error", {
                    message: `Too many code runs. Please wait ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
                });
            }

            try {
                // Update snapshot with the latest code so the agent sees what the user clicked "Run" on
                updateCodeSnapshot(currentSessionId, codeRunData.code, codeRunData.language);
                updateVoiceCodeSnapshot(currentSessionId, codeRunData.code, codeRunData.language);

                await processAgentTurn(
                    currentSessionId,
                    `[CODE SUBMITTED] I'd like to run my ${codeRunData.language} code.`,
                    emitToSession
                );
            } catch (err: any) {
                socket.emit("error", { message: "Code execution failed" });
            }
        });

        // ── Disconnect ───────────────────────────────────────
        socket.on("disconnect", () => {
            if (currentSessionId) {
                stopVoiceSession(currentSessionId);
            }
        });

        // ── Leave Session (explicit) ─────────────────────────
        socket.on("session:leave", () => {
            if (currentSessionId) {
                stopVoiceSession(currentSessionId);
                cleanupSession(currentSessionId);
                socket.leave(currentSessionId);
                currentSessionId = null;
            }
        });

        // ── End Session (explicit user action) ───────────────
        socket.on("session:end", async (ack?: (payload: { ok: boolean; error?: string }) => void) => {
            if (!currentSessionId) {
                ack?.({ ok: false, error: "Not in a session" });
                return socket.emit("error", { message: "Not in a session" });
            }
            // [ScreeningEnd] The client called endInterview() (End button OR client timer=0).
            console.log(`[ScreeningEnd] socket "session:end" received (client-initiated endInterview) for ${currentSessionId}`);

            try {
                const session = await prisma.interviewSession.findUnique({
                    where: { id: currentSessionId },
                    select: { id: true, userId: true, status: true, mode: true },
                });

                if (!session || session.userId !== userId) {
                    ack?.({ ok: false, error: "You are not authorized to end this session" });
                    return socket.emit("error", {
                        code: "UNAUTHORIZED",
                        message: "You are not authorized to end this session",
                    });
                }

                if (session.status !== "COMPLETED") {
                    await prisma.interviewSession.update({
                        where: { id: currentSessionId },
                        data: {
                            status: "COMPLETED",
                            completedAt: new Date(),
                        },
                    });
                    if (session.mode !== "company_screening") {
                        await settleInterviewMinuteReservation(userId, currentSessionId);
                        updateStreakForUser(userId).catch(console.error);
                    }
                }

                emitToSession("session:ending", {
                    message: session.mode === "company_screening"
                        ? "Interview complete. Submitting your screening..."
                        : "Interview complete! Generating your evaluation report...",
                });

                if (session.mode !== "company_screening") {
                    generateReport(currentSessionId, emitToSession)
                        .then((result) => {
                            if (result.status === "failed") {
                                console.error(`[WS] Background report generation failed for ${currentSessionId}: ${result.error}`);
                            }
                        })
                        .catch((err) => {
                            console.error(`[WS] Background report generation failed for ${currentSessionId}:`, err);
                        });
                }

                // Prevent any further processing in this socket after manual end
                stopVoiceSession(currentSessionId);
                cleanupSession(currentSessionId);

                ack?.({ ok: true });
            } catch (err: any) {
                console.error("[WS] session:end error:", err);
                ack?.({ ok: false, error: err?.message || "Failed to end session" });
                socket.emit("error", {
                    message: err?.message || "Failed to end session",
                });
            }
        });

        // ── Voice Mode: Start Gemini Live ────────────────────
        socket.on("voice:start", async () => {
            if (!currentSessionId) {
                return socket.emit("error", { message: "Not in a session" });
            }

            const statusCheck = await prisma.interviewSession.findUnique({
                where: { id: currentSessionId },
                select: { status: true },
            });
            if (!statusCheck || statusCheck.status === "COMPLETED") {
                socket.emit("session:ended", {
                    message: "This interview has already ended.",
                });
                return;
            }

            try {
                await startVoiceSession(currentSessionId, {
                    onAudio: (data) => {
                        emitToSession("voice:audio", { data });
                    },
                    onAiTranscript: (text) => {
                        emitToSession("voice:ai-transcript", { text });
                    },
                    onUserTranscript: (text) => {
                        emitToSession("voice:user-transcript", { text });
                    },
                    onTurnComplete: () => {
                        emitToSession("voice:turn-complete", {});
                    },
                    onReady: () => {
                        emitToSession("voice:ready", {});
                    },
                    onEnded: (reason) => {
                        emitToSession("voice:ended", { reason });
                    },
                    onError: (message) => {
                        const sanitized = sanitizeErrorMessage(message);
                        const debugReason = classifyVoiceErrorReason(message);
                        console.error("[WS] Voice error (sanitized for client):", sanitized, "| Reason:", debugReason, "| Original:", message);
                        // Only emit voice:error — do NOT also emit the generic 'error' event.
                        // The client handles voice:error via its dedicated handleVoiceError path.
                        // Emitting both causes double-handling: the generic 'error' listener
                        // re-routes back to handleVoiceError via the regex check, triggering
                        // redundant reconnect attempts and false-positive error UI.
                        emitToSession("voice:error", { message: sanitized, debugReason });
                    },
                    emit: emitToSession,
                });
            } catch (err: any) {
                console.error(`[WS] Voice start error:`, err);
                socket.emit("error", {
                    message: err.message || "Failed to start voice session",
                });
            }
        });

        // ── Voice Mode: Audio from Client ────────────────────
        socket.on("voice:audio", (data: unknown) => {
            if (currentSessionId) {
                const parsedAudio = voiceAudioPayloadSchema.safeParse(data);
                if (parsedAudio.success) {
                    sendAudioToVoice(
                        currentSessionId,
                        parsedAudio.data.data,
                        parsedAudio.data.mimeType || "audio/pcm;rate=16000"
                    );
                    return;
                }

                const parsedBinaryAudio = voiceBinaryAudioPayloadSchema.safeParse(data);
                if (!parsedBinaryAudio.success) {
                    emitValidationError("voice:audio", summarizeValidationError(parsedAudio.error));
                    return;
                }

                const audioBuffer = normalizeBinaryAudio(parsedBinaryAudio.data.audio);
                if (!audioBuffer) {
                    socket.emit("error", {
                        code: "VALIDATION_ERROR",
                        message: "Invalid payload for voice:audio. audio must be binary data.",
                    });
                    return;
                }

                sendAudioBufferToVoice(
                    currentSessionId,
                    audioBuffer,
                    parsedBinaryAudio.data.mimeType || "audio/pcm;rate=16000"
                );
            }
        });

        // ── Voice Mode: Text through voice session ───────────
        socket.on("voice:text", (data: unknown) => {
            if (currentSessionId) {
                const parsedVoiceText = parseVoiceTextPayload(data);
                if (parsedVoiceText.success === false) {
                    emitValidationError("voice:text", summarizeValidationError(parsedVoiceText.error));
                    return;
                }

                if (parsedVoiceText.ignoredInvalidCanvasSnapshot) {
                    console.warn(`[WS] Ignoring invalid canvasSnapshot in voice:text for session ${currentSessionId}`);
                }

                if (parsedVoiceText.data.canvasSnapshot !== undefined) {
                    updateCanvasSnapshot(currentSessionId, parsedVoiceText.data.canvasSnapshot);
                    updateVoiceCanvasSnapshot(currentSessionId, parsedVoiceText.data.canvasSnapshot);
                }

                const sent = sendTextToVoice(currentSessionId, parsedVoiceText.data.text);
                if (!sent) {
                    socket.emit("error", {
                        message: "Voice session is not active. Please wait for reconnection and try again.",
                    });
                }
            }
        });

        // ── Voice Mode: Stop ─────────────────────────────────
        socket.on("voice:stop", () => {
            if (currentSessionId) {
                stopVoiceSession(currentSessionId);
            }
        });

        // ── Voice Mode: Mute State ──────────────────────────
        socket.on("voice:mute", (data: unknown) => {
            if (!currentSessionId) return;

            const parsedMute = voiceMutePayloadSchema.safeParse(data);
            if (!parsedMute.success) {
                emitValidationError("voice:mute", summarizeValidationError(parsedMute.error));
                return;
            }

            setVoiceMuteState(currentSessionId, parsedMute.data.muted);
        });

        // ── Voice Mode: Push-to-Talk ─────────────────────────
        socket.on("voice:ptt-mode", (data: unknown) => {
            if (!currentSessionId) {
                console.log(`[PTT][WebSocket] voice:ptt-mode event received but no session - ignoring`);
                return;
            }
            console.log(`[PTT][WebSocket] ========================================`);
            console.log(`[PTT][WebSocket] Received voice:ptt-mode event for session ${currentSessionId}`);
            console.log(`[PTT][WebSocket] Payload:`, data);
            
            const parsed = voicePTTModePayloadSchema.safeParse(data);
            if (!parsed.success) {
                console.error(`[PTT][WebSocket] Validation failed:`, parsed.error);
                emitValidationError("voice:ptt-mode", summarizeValidationError(parsed.error));
                return;
            }
            
            console.log(`[PTT][WebSocket] Setting PTT mode to: ${parsed.data.enabled}`);
            setVoicePTTMode(currentSessionId, parsed.data.enabled);
            console.log(`[PTT][WebSocket] ========================================`);
        });

        socket.on("voice:ptt-hold", () => {
            if (!currentSessionId) {
                console.log(`[PTT][WebSocket] voice:ptt-hold event received but no session - ignoring`);
                return;
            }
            console.log(`[PTT][WebSocket] ========================================`);
            console.log(`[PTT][WebSocket] Received voice:ptt-hold event for session ${currentSessionId}`);
            console.log(`[PTT][WebSocket] User pressed spacebar - starting to buffer transcripts`);
            setVoicePTTHolding(currentSessionId);
            console.log(`[PTT][WebSocket] ========================================`);
        });

        socket.on("voice:ptt-release", () => {
            if (!currentSessionId) {
                console.log(`[PTT][WebSocket] voice:ptt-release event received but no session - ignoring`);
                return;
            }
            console.log(`[PTT][WebSocket] ========================================`);
            console.log(`[PTT][WebSocket] Received voice:ptt-release event for session ${currentSessionId}`);
            console.log(`[PTT][WebSocket] User released spacebar - will flush buffer immediately`);
            releaseVoicePTT(currentSessionId);
            console.log(`[PTT][WebSocket] ========================================`);
        });
    });

    return io;
}
