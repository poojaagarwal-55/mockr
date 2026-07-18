import dns from "node:dns";
import path from "node:path";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import * as dotenv from "dotenv";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { Server, type Socket } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import IORedis from "ioredis";
import {
    AcceptPeerInviteSchema,
    CreatePeerInviteSchema,
    PeerChatMessageSchema,
    PeerEditorSyncSchema,
    PeerIceSchema,
    PeerJoinSessionSchema,
    PeerSessionEndSchema,
    PeerSignalSchema,
    PeerTimerSyncSchema,
    PeerTurnControlSchema,
} from "@interviewforge/shared";
import { z } from "zod";
import { getP2PConfig, validateEnv } from "./lib/env.js";
import { connectMongoDB } from "./lib/mongoose.js";
import { redis } from "./lib/redis.js";
import { authenticateSocket, type AuthenticatedSocket } from "./lib/socket-auth.js";
import { prisma } from "./lib/prisma.js";
import authPlugin from "./plugins/auth.js";
import p2pRoutes from "./routes/p2p.js";
import { MatchmakingService } from "./services/matchmaking.service.js";

dns.setDefaultResultOrder("ipv4first");

const currentDir = typeof __dirname !== "undefined" ? __dirname : process.cwd();

const PeerExecutionSyncSchema = z.object({
    peerSessionId: z.string().uuid(),
    phase: z.enum(["running", "completed"]),
    mode: z.enum(["run", "submit"]),
    language: z.string().optional(),
    results: z.record(z.string(), z.any()).optional(),
    hiddenSummary: z.object({
        passed: z.number().int().min(0),
        total: z.number().int().min(0),
    }).nullable().optional(),
    executionError: z.string().nullable().optional(),
});

const ExpertJoinSessionSchema = z.object({
    expertSessionId: z.string().uuid(),
});

const ExpertChatMessageSchema = z.object({
    expertSessionId: z.string().uuid(),
    text: z.string().trim().min(1).max(2000),
});

const ExpertTimerSyncSchema = z.object({
    expertSessionId: z.string().uuid(),
    elapsedSeconds: z.number().int().min(0).max(24 * 60 * 60),
    totalSeconds: z.number().int().min(60).max(6 * 60 * 60).optional(),
});

const ExpertEditorSyncSchema = z.object({
    expertSessionId: z.string().uuid(),
    code: z.string().max(200_000),
    language: z.string().trim().min(1).max(32),
    revision: z.number().int().min(0).optional(),
});

const ExpertSignalSchema = z.object({
    expertSessionId: z.string().uuid(),
    sdp: z.string().min(1).max(128_000),
});

const ExpertIceSchema = z.object({
    expertSessionId: z.string().uuid(),
    candidate: z.string().min(1).max(64_000),
});

const ExpertSessionEndSchema = z.object({
    expertSessionId: z.string().uuid(),
});

const ExpertAdmitCandidateSchema = z.object({
    expertSessionId: z.string().uuid(),
    candidateUserId: z.string().uuid(),
});

const ExpertExecutionSyncSchema = z.object({
    expertSessionId: z.string().uuid(),
    phase: z.enum(["running", "completed"]),
    mode: z.enum(["run", "submit"]),
    language: z.string().max(32).optional(),
    results: z.record(z.string(), z.any()).optional(),
    hiddenSummary: z.object({
        passed: z.number().int().min(0),
        total: z.number().int().min(0),
    }).nullable().optional(),
    executionError: z.string().nullable().optional(),
});

type ExpertRuntimeState = {
    code: string;
    language: string;
    revision: number;
    updatedByUserId: string | null;
    updatedAt: string;
    elapsedSeconds: number;
    totalSeconds: number;
    messages: Array<{
        id: string;
        userId: string;
        text: string;
        createdAt: string;
    }>;
};

type ExpertSessionAccess = {
    id: string;
    status: string;
    preferred_language: string;
    scheduled_for: Date;
    ends_at: Date | null;
    started_at: Date | null;
    candidate_admitted_at: Date | null;
    candidate_user_id: string;
    expert_user_id: string;
    _count: { questions: number };
};

type ExpertSessionCacheEntry = {
    session: ExpertSessionAccess;
    expiresAt: number;
};

async function checkRateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
    const bucket = Math.floor(Date.now() / windowMs);
    const redisKey = `p2p:rate:${key}:${bucket}`;
    const count = await redis.incr(redisKey);

    if (count === 1) {
        const ttlSeconds = Math.max(1, Math.ceil(windowMs / 1000));
        await redis.expire(redisKey, ttlSeconds);
    }

    return count <= limit;
}

async function bootstrap() {
    const config = getP2PConfig();
    await connectMongoDB();

    const fastify = Fastify({
        logger: {
            level: process.env.NODE_ENV === "production" ? "info" : "debug",
        },
    });

    // Production builds only honor the configured frontend origin. Localhost is enabled
    // exclusively when NODE_ENV !== "production" so a misconfigured prod deploy can't
    // accidentally accept browser traffic from a developer machine.
    const isProduction = process.env.NODE_ENV === "production";
    const allowedOrigins = [
        config.frontendOrigin,
        ...(isProduction ? [] : ["http://localhost:3000", "http://127.0.0.1:3000"]),
    ].filter(Boolean) as string[];

    await fastify.register(cors, {
        origin: allowedOrigins,
        credentials: true,
    });

    await fastify.register(authPlugin);
    await fastify.register(p2pRoutes);

    fastify.get("/health", async () => ({
        status: "ok",
        service: "interviewforge-p2p",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
    }));

    const io = new Server(fastify.server, {
        path: "/p2p/socket.io",
        cors: {
            origin: allowedOrigins,
            methods: ["GET", "POST"],
            credentials: true,
        },
        transports: ["websocket", "polling"],
        // Connection-state recovery lets a brief disconnect resume without re-auth and
        // without re-emitting buffered events, which avoids signaling-storm regressions on
        // flaky mobile networks during interviews.
        connectionStateRecovery: {
            maxDisconnectionDuration: 2 * 60_000,
            skipMiddlewares: false,
        },
        // Keep the per-message payload bounded — even with our schema validation, an
        // unbounded socket payload is a memory amplification risk.
        maxHttpBufferSize: 256 * 1024,
        pingInterval: 25_000,
        pingTimeout: 20_000,
    });

    // Multi-instance scaling (opt-in via P2P_REDIS_ADAPTER=1): attach the socket.io
    // Redis adapter so room emits propagate across instances (matchmaking can pair
    // clients whose sockets live on different instances; the matchmaking cycle is
    // already single-runner via a Redis orchestrator lock).
    //
    // It is OFF by default because the adapter issues a Redis PUBLISH on EVERY room
    // emit — including frequent editor syncs — which can quickly exhaust a small
    // (e.g. free-tier) Redis command quota. Run a single instance with it off; only
    // enable it when scaling to >1 instance on a Redis tier sized for that volume.
    const enableRedisAdapter =
        process.env.P2P_REDIS_ADAPTER === "1" || process.env.P2P_REDIS_ADAPTER === "true";
    if (config.redisUrl && enableRedisAdapter) {
        const pubClient = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
        const subClient = pubClient.duplicate();
        pubClient.on("error", (err) => fastify.log.error({ err }, "[p2p] socket.io redis adapter (pub) error"));
        subClient.on("error", (err) => fastify.log.error({ err }, "[p2p] socket.io redis adapter (sub) error"));
        io.adapter(createAdapter(pubClient, subClient));
        fastify.log.info("[p2p] socket.io Redis adapter enabled — multi-instance scaling active");
    } else {
        fastify.log.info("[p2p] single-instance mode (socket.io Redis adapter off); set P2P_REDIS_ADAPTER=1 and scale instances to enable multi-instance");
    }

    const matchmaking = new MatchmakingService(io);
    matchmaking.startBackgroundWorkers();

    const expertRuntime = new Map<string, ExpertRuntimeState>();
    const expertSessionCache = new Map<string, ExpertSessionCacheEntry>();
    const expertEmptyRoomTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const EXPERT_SESSION_CACHE_MS = 10_000;
    const EXPERT_EMPTY_ROOM_GRACE_MS = 30_000;

    const expertRoomName = (expertSessionId: string) => `expert:${expertSessionId}`;
    const expertLobbyRoomName = (expertSessionId: string) => `expert:lobby:${expertSessionId}`;

    async function loadExpertSessionFromDb(expertSessionId: string): Promise<ExpertSessionAccess | null> {
        const session = await prisma.expert_sessions.findUnique({
            where: { id: expertSessionId },
            select: {
                id: true,
                status: true,
                preferred_language: true,
                scheduled_for: true,
                ends_at: true,
                started_at: true,
                candidate_admitted_at: true,
                candidate_user_id: true,
                expert_user_id: true,
                _count: { select: { questions: true } },
            },
        });

        if (session) {
            expertSessionCache.set(expertSessionId, {
                session,
                expiresAt: Date.now() + EXPERT_SESSION_CACHE_MS,
            });
        }

        return session;
    }

    async function getExpertSessionForUser(
        userId: string,
        expertSessionId: string,
        options: { forceFresh?: boolean } = {}
    ) {
        const cached = expertSessionCache.get(expertSessionId);
        let session: ExpertSessionAccess | null;
        if (!options.forceFresh && cached && cached.expiresAt > Date.now()) {
            session = cached.session;
        } else {
            try {
                session = await loadExpertSessionFromDb(expertSessionId);
            } catch (err) {
                if (cached) {
                    fastify.log.warn({ err, expertSessionId }, "Using stale expert session cache after DB read failed");
                    session = cached.session;
                } else {
                    throw err;
                }
            }
        }

        if (!session) {
            throw new Error("Expert session not found");
        }

        if (session.candidate_user_id !== userId && session.expert_user_id !== userId) {
            throw new Error("Forbidden");
        }

        return session;
    }

    function cacheExpertSessionStatus(expertSessionId: string, status: string) {
        const cached = expertSessionCache.get(expertSessionId);
        if (!cached) return;
        expertSessionCache.set(expertSessionId, {
            session: { ...cached.session, status },
            expiresAt: Date.now() + EXPERT_SESSION_CACHE_MS,
        });
    }

    function cacheExpertSessionPatch(expertSessionId: string, patch: Partial<ExpertSessionAccess>) {
        const cached = expertSessionCache.get(expertSessionId);
        if (!cached) return;
        expertSessionCache.set(expertSessionId, {
            session: { ...cached.session, ...patch },
            expiresAt: Date.now() + EXPERT_SESSION_CACHE_MS,
        });
    }

    function clearExpertEmptyRoomTimer(expertSessionId: string) {
        const timer = expertEmptyRoomTimers.get(expertSessionId);
        if (timer) {
            clearTimeout(timer);
            expertEmptyRoomTimers.delete(expertSessionId);
        }
    }

    function assertExpertRoomAccess(userId: string, session: ExpertSessionAccess) {
        if (session.expert_user_id === userId) return;
        if (session.candidate_user_id === userId && session.candidate_admitted_at) return;
        throw new Error("Waiting for the expert to let you in.");
    }

    async function maybeScheduleExpertAutoEnd(expertSessionId: string) {
        clearExpertEmptyRoomTimer(expertSessionId);
        expertEmptyRoomTimers.set(expertSessionId, setTimeout(async () => {
            expertEmptyRoomTimers.delete(expertSessionId);
            const roomSize = io.sockets.adapter.rooms.get(expertRoomName(expertSessionId))?.size ?? 0;
            if (roomSize > 0) return;

            try {
                const session = await loadExpertSessionFromDb(expertSessionId);
                if (!session) return;
                const hadStartedCall = session.status === "ACTIVE" || Boolean(session.candidate_admitted_at);
                if (!hadStartedCall || ["COMPLETED", "CANCELLED", "ABANDONED"].includes(session.status)) return;

                await prisma.expert_sessions.update({
                    where: { id: expertSessionId },
                    data: {
                        status: "COMPLETED",
                        ended_at: new Date(),
                        updated_at: new Date(),
                    },
                });
                cacheExpertSessionStatus(expertSessionId, "COMPLETED");
                io.to(`user:${session.expert_user_id}`).emit("expert:session-ended", {
                    expertSessionId,
                    reason: "everyone_left",
                    endedAt: new Date().toISOString(),
                });
                io.to(`user:${session.candidate_user_id}`).emit("expert:session-ended", {
                    expertSessionId,
                    reason: "everyone_left",
                    endedAt: new Date().toISOString(),
                });
            } catch (err) {
                fastify.log.error(err, "Unable to auto-end empty expert session");
            }
        }, EXPERT_EMPTY_ROOM_GRACE_MS));
    }

    function getExpertState(expertSessionId: string, language: string, totalSeconds: number): ExpertRuntimeState {
        const existing = expertRuntime.get(expertSessionId);
        if (existing) return existing;

        const state: ExpertRuntimeState = {
            code: "",
            language: language || "python",
            revision: 0,
            updatedByUserId: null,
            updatedAt: new Date().toISOString(),
            elapsedSeconds: 0,
            totalSeconds,
            messages: [],
        };
        expertRuntime.set(expertSessionId, state);
        return state;
    }

    function expertTotalSeconds(session: { scheduled_for: Date; ends_at: Date | null }): number {
        if (!session.ends_at) return 60 * 60;
        return Math.max(60, Math.floor((session.ends_at.getTime() - session.scheduled_for.getTime()) / 1000));
    }

    async function emitExpertSessionState(expertSessionId: string) {
        const cached = expertSessionCache.get(expertSessionId);
        let session: ExpertSessionAccess | null;
        if (cached && cached.expiresAt > Date.now()) {
            session = cached.session;
        } else {
            try {
                session = await loadExpertSessionFromDb(expertSessionId);
            } catch (err) {
                if (cached) {
                    fastify.log.warn({ err, expertSessionId }, "Using stale expert session cache for state emit after DB read failed");
                    session = cached.session;
                } else {
                    throw err;
                }
            }
        }
        if (!session) return;
        const room = expertRoomName(expertSessionId);
        const connectedUserIds = new Set<string>();
        const socketIds = io.sockets.adapter.rooms.get(room) ?? new Set<string>();

        for (const socketId of socketIds) {
            const participantSocket = io.sockets.sockets.get(socketId) as AuthenticatedSocket | undefined;
            const connectedUserId = participantSocket?.data?.user?.id;
            if (connectedUserId) {
                connectedUserIds.add(connectedUserId);
            }
        }

        io.to(room).emit("expert:session-state", {
            expertSessionId,
            status: session.status,
            participants: [
                {
                    userId: session.expert_user_id,
                    participantRole: "expert",
                    isReady: connectedUserIds.has(session.expert_user_id),
                },
                {
                    userId: session.candidate_user_id,
                    participantRole: "candidate",
                    isReady: connectedUserIds.has(session.candidate_user_id),
                },
            ],
            editableUserId: session.candidate_user_id,
        });
    }

    function emitExpertEditorState(expertSessionId: string, state: ExpertRuntimeState, editableUserId: string) {
        io.to(expertRoomName(expertSessionId)).emit("expert:editor-state", {
            expertSessionId,
            code: state.code,
            language: state.language,
            revision: state.revision,
            editableUserId,
            updatedByUserId: state.updatedByUserId,
            updatedAt: state.updatedAt,
        });
    }

    function emitExpertLobbyRequests(expertSessionId: string, session: ExpertSessionAccess) {
        const lobbySocketIds = io.sockets.adapter.rooms.get(expertLobbyRoomName(expertSessionId)) ?? new Set<string>();
        const requests = [...lobbySocketIds]
            .map((socketId) => io.sockets.sockets.get(socketId) as AuthenticatedSocket | undefined)
            .filter((socket): socket is AuthenticatedSocket => Boolean(socket?.data?.user?.id))
            .filter((socket) => socket.data.user.id === session.candidate_user_id)
            .map((socket) => ({
                expertSessionId,
                userId: socket.data.user.id,
                email: socket.data.user.email,
                requestedAt: new Date().toISOString(),
            }));

        io.to(expertRoomName(expertSessionId)).to(`user:${session.expert_user_id}`).emit("expert:lobby-requests", {
            expertSessionId,
            requests,
        });

        if (requests.length > 0) {
            io.to(expertRoomName(expertSessionId)).to(`user:${session.expert_user_id}`).emit("expert:lobby-request", requests[0]);
        }
    }

    function sendExpertRoomBootstrap(client: AuthenticatedSocket, expertSessionId: string, session: ExpertSessionAccess, state: ExpertRuntimeState) {
        client.emit("expert:chat-history", {
            expertSessionId,
            messages: state.messages,
        });
        client.emit("expert:timer-sync", {
            expertSessionId,
            elapsedSeconds: state.elapsedSeconds,
            totalSeconds: state.totalSeconds,
        });
        client.emit("expert:editor-state", {
            expertSessionId,
            code: state.code,
            language: state.language,
            revision: state.revision,
            editableUserId: session.candidate_user_id,
            updatedByUserId: state.updatedByUserId,
            updatedAt: state.updatedAt,
        });
    }

    fastify.addHook("onClose", async () => {
        matchmaking.stopBackgroundWorkers();
    });

    io.use(async (socket: Socket, next) => {
        const user = await authenticateSocket(socket);
        if (!user) {
            next(new Error("Authentication failed"));
            return;
        }

        (socket as AuthenticatedSocket).data.user = user;
        next();
    });

    io.on("connection", async (socket) => {
        const client = socket as AuthenticatedSocket;
        const userId = client.data.user.id;

        client.join(`user:${userId}`);
        await matchmaking.onSocketConnected(userId, client.id);

        const activeSessionId = await matchmaking.getActiveSessionForUser(userId);
        if (activeSessionId) {
            try {
                client.join(matchmaking.roomForSession(activeSessionId));
                await matchmaking.joinSession(userId, activeSessionId);
            } catch (err) {
                fastify.log.warn({ err, userId, activeSessionId }, "Unable to auto-rejoin active peer session");
            }
        }

        // Instant "Find peer now" queue is retired — peer matching only happens
        // live in the waiting room at a booked slot time (see runLobbyMatcher).
        // The leave-queue handler stays for cleanup of any lingering queue state.
        client.on("peer:leave-queue", async () => {
            try {
                await matchmaking.leaveQueue(userId);
            } catch (err) {
                client.emit("peer:error", { code: "LEAVE_QUEUE_ERROR", message: "Unable to leave queue" });
                fastify.log.error(err);
            }
        });

        client.on("peer:create-invite", async (payload) => {
            if (!(await checkRateLimit(`peer:create-invite:${userId}`, 20, 60_000))) {
                client.emit("peer:error", { code: "RATE_LIMITED", message: "Too many invite requests" });
                return;
            }

            const parsed = CreatePeerInviteSchema.safeParse(payload);
            if (!parsed.success) {
                client.emit("peer:error", { code: "INVALID_PAYLOAD", message: "Invalid invite payload" });
                return;
            }

            try {
                await matchmaking.createInvite(userId, parsed.data);
            } catch (err) {
                client.emit("peer:error", { code: "INVITE_ERROR", message: "Unable to create invite" });
                fastify.log.error(err);
            }
        });

        client.on("peer:accept-invite", async (payload) => {
            if (!(await checkRateLimit(`peer:accept-invite:${userId}`, 20, 60_000))) {
                client.emit("peer:error", { code: "RATE_LIMITED", message: "Too many invite acceptance requests" });
                return;
            }

            const parsed = AcceptPeerInviteSchema.safeParse(payload);
            if (!parsed.success) {
                client.emit("peer:error", { code: "INVALID_PAYLOAD", message: "Invalid invite acceptance payload" });
                return;
            }

            try {
                await matchmaking.acceptInvite(userId, parsed.data);
            } catch (err) {
                const message = err instanceof Error ? err.message : "Unable to accept invite";
                client.emit("peer:error", { code: "INVITE_ACCEPT_ERROR", message });
                fastify.log.error(err);
            }
        });

        client.on("peer:session-ready", async (payload: { peerSessionId?: string }) => {
            if (!payload?.peerSessionId) {
                client.emit("peer:error", { code: "INVALID_PAYLOAD", message: "Missing peer session id" });
                return;
            }

            try {
                await matchmaking.markSessionReady(userId, payload.peerSessionId);
            } catch (err) {
                const message = err instanceof Error ? err.message : "Unable to mark session ready";
                client.emit("peer:error", { code: "SESSION_READY_ERROR", message });
                fastify.log.error(err);
            }
        });

        client.on("peer:join-session", async (payload) => {
            const parsed = PeerJoinSessionSchema.safeParse(payload);
            if (!parsed.success) {
                client.emit("peer:error", { code: "INVALID_PAYLOAD", message: "Invalid join session payload" });
                return;
            }

            try {
                client.join(matchmaking.roomForSession(parsed.data.peerSessionId));
                await matchmaking.joinSession(userId, parsed.data.peerSessionId);
            } catch (err) {
                const message = err instanceof Error ? err.message : "Unable to join peer session";
                client.emit("peer:error", { code: "SESSION_JOIN_ERROR", message });
                fastify.log.error(err);
            }
        });

        client.on("peer:reconnect", async (payload) => {
            const parsed = PeerJoinSessionSchema.safeParse(payload);
            if (!parsed.success) {
                client.emit("peer:error", { code: "INVALID_PAYLOAD", message: "Invalid reconnect payload" });
                return;
            }

            try {
                client.join(matchmaking.roomForSession(parsed.data.peerSessionId));
                await matchmaking.joinSession(userId, parsed.data.peerSessionId);
            } catch (err) {
                const message = err instanceof Error ? err.message : "Unable to reconnect to peer session";
                client.emit("peer:error", { code: "SESSION_RECONNECT_ERROR", message });
                fastify.log.error(err);
            }
        });

        client.on("peer:chat-send", async (payload) => {
            if (!(await checkRateLimit(`peer:chat-send:${userId}`, 100, 60_000))) {
                client.emit("peer:error", { code: "RATE_LIMITED", message: "Too many chat messages" });
                return;
            }

            const parsed = PeerChatMessageSchema.safeParse(payload);
            if (!parsed.success) {
                client.emit("peer:error", { code: "INVALID_PAYLOAD", message: "Invalid chat payload" });
                return;
            }

            try {
                await matchmaking.sendChatMessage(userId, parsed.data);
            } catch (err) {
                const message = err instanceof Error ? err.message : "Unable to send chat message";
                client.emit("peer:error", { code: "CHAT_SEND_ERROR", message });
                fastify.log.error(err);
            }
        });

        client.on("peer:timer-sync", async (payload) => {
            if (!(await checkRateLimit(`peer:timer-sync:${userId}`, 180, 60_000))) {
                client.emit("peer:error", { code: "RATE_LIMITED", message: "Too many timer updates" });
                return;
            }

            const parsed = PeerTimerSyncSchema.safeParse(payload);
            if (!parsed.success) {
                client.emit("peer:error", { code: "INVALID_PAYLOAD", message: "Invalid timer payload" });
                return;
            }

            try {
                await matchmaking.relayTimerSync(userId, parsed.data);
            } catch (err) {
                const message = err instanceof Error ? err.message : "Unable to sync timer";
                client.emit("peer:error", { code: "TIMER_SYNC_ERROR", message });
                fastify.log.error(err);
            }
        });

        client.on("peer:turn-advance", async (payload) => {
            if (!(await checkRateLimit(`peer:turn-advance:${userId}`, 40, 60_000))) {
                client.emit("peer:error", { code: "RATE_LIMITED", message: "Too many turn control requests" });
                return;
            }

            const parsed = PeerTurnControlSchema.safeParse(payload);
            if (!parsed.success) {
                client.emit("peer:error", { code: "INVALID_PAYLOAD", message: "Invalid turn control payload" });
                return;
            }

            try {
                await matchmaking.advanceTurn(userId, parsed.data);
            } catch (err) {
                const message = err instanceof Error ? err.message : "Unable to advance turn";
                client.emit("peer:error", { code: "TURN_ADVANCE_ERROR", message });
                fastify.log.error(err);
            }
        });

        client.on("peer:session-end", async (payload) => {
            if (!(await checkRateLimit(`peer:session-end:${userId}`, 20, 60_000))) {
                client.emit("peer:error", { code: "RATE_LIMITED", message: "Too many session end requests" });
                return;
            }

            const parsed = PeerSessionEndSchema.safeParse(payload);
            if (!parsed.success) {
                client.emit("peer:error", { code: "INVALID_PAYLOAD", message: "Invalid session end payload" });
                return;
            }

            try {
                await matchmaking.endSessionEarly(userId, parsed.data);
            } catch (err) {
                const message = err instanceof Error ? err.message : "Unable to end session";
                client.emit("peer:error", { code: "SESSION_END_ERROR", message });
                fastify.log.error(err);
            }
        });

        client.on("peer:editor-sync", async (payload) => {
            if (!(await checkRateLimit(`peer:editor-sync:${userId}`, 300, 60_000))) {
                client.emit("peer:error", { code: "RATE_LIMITED", message: "Too many editor sync updates" });
                return;
            }

            const parsed = PeerEditorSyncSchema.safeParse(payload);
            if (!parsed.success) {
                client.emit("peer:error", { code: "INVALID_PAYLOAD", message: "Invalid editor sync payload" });
                return;
            }

            try {
                await matchmaking.syncEditorState(userId, parsed.data);
            } catch (err) {
                const message = err instanceof Error ? err.message : "Unable to sync editor state";
                client.emit("peer:error", { code: "EDITOR_SYNC_ERROR", message });
                fastify.log.error(err);
            }
        });

        client.on("peer:signal-offer", async (payload) => {
            if (!(await checkRateLimit(`peer:signal-offer:${userId}`, 120, 60_000))) {
                client.emit("peer:error", { code: "RATE_LIMITED", message: "Too many signaling requests" });
                return;
            }

            const parsed = PeerSignalSchema.safeParse(payload);
            if (!parsed.success) {
                client.emit("peer:error", { code: "INVALID_PAYLOAD", message: "Invalid signal offer payload" });
                return;
            }

            try {
                await matchmaking.relaySignalOffer(userId, parsed.data);
            } catch (err) {
                const message = err instanceof Error ? err.message : "Unable to relay offer";
                client.emit("peer:error", { code: "SIGNAL_OFFER_ERROR", message });
                fastify.log.error(err);
            }
        });

        client.on("peer:signal-answer", async (payload) => {
            if (!(await checkRateLimit(`peer:signal-answer:${userId}`, 120, 60_000))) {
                client.emit("peer:error", { code: "RATE_LIMITED", message: "Too many signaling requests" });
                return;
            }

            const parsed = PeerSignalSchema.safeParse(payload);
            if (!parsed.success) {
                client.emit("peer:error", { code: "INVALID_PAYLOAD", message: "Invalid signal answer payload" });
                return;
            }

            try {
                await matchmaking.relaySignalAnswer(userId, parsed.data);
            } catch (err) {
                const message = err instanceof Error ? err.message : "Unable to relay answer";
                client.emit("peer:error", { code: "SIGNAL_ANSWER_ERROR", message });
                fastify.log.error(err);
            }
        });

        client.on("peer:signal-ice", async (payload) => {
            if (!(await checkRateLimit(`peer:signal-ice:${userId}`, 240, 60_000))) {
                client.emit("peer:error", { code: "RATE_LIMITED", message: "Too many ICE candidates" });
                return;
            }

            const parsed = PeerIceSchema.safeParse(payload);
            if (!parsed.success) {
                client.emit("peer:error", { code: "INVALID_PAYLOAD", message: "Invalid ICE payload" });
                return;
            }

            try {
                await matchmaking.relaySignalIce(userId, parsed.data);
            } catch (err) {
                const message = err instanceof Error ? err.message : "Unable to relay ICE candidate";
                client.emit("peer:error", { code: "SIGNAL_ICE_ERROR", message });
                fastify.log.error(err);
            }
        });

        client.on("peer:execution-sync", async (payload) => {
            if (!(await checkRateLimit(`peer:execution-sync:${userId}`, 180, 60_000))) {
                client.emit("peer:error", { code: "RATE_LIMITED", message: "Too many execution sync events" });
                return;
            }

            const parsed = PeerExecutionSyncSchema.safeParse(payload);
            if (!parsed.success) {
                client.emit("peer:error", { code: "INVALID_PAYLOAD", message: "Invalid execution sync payload" });
                return;
            }

            try {
                await matchmaking.relayExecutionSync(userId, parsed.data);
            } catch (err) {
                const message = err instanceof Error ? err.message : "Unable to relay execution sync";
                client.emit("peer:error", { code: "EXECUTION_SYNC_ERROR", message });
                fastify.log.error(err);
            }
        });

        client.on("expert:join-session", async (payload) => {
            if (!(await checkRateLimit(`expert:join-session:${userId}`, 60, 60_000))) {
                client.emit("expert:error", { code: "RATE_LIMITED", message: "Too many room join attempts" });
                return;
            }

            const parsed = ExpertJoinSessionSchema.safeParse(payload);
            if (!parsed.success) {
                client.emit("expert:error", { code: "INVALID_PAYLOAD", message: "Invalid expert session payload" });
                return;
            }

            try {
                const session = await getExpertSessionForUser(userId, parsed.data.expertSessionId, { forceFresh: true });
                if (["COMPLETED", "CANCELLED", "ABANDONED"].includes(session.status)) {
                    throw new Error("This expert interview has ended.");
                }
                if (session.expert_user_id === userId && session._count.questions === 0) {
                    throw new Error("Select at least one question before joining the expert interview.");
                }
                const totalSeconds = expertTotalSeconds(session);
                const state = getExpertState(parsed.data.expertSessionId, session.preferred_language, totalSeconds);

                if (session.expert_user_id === userId && session.status === "SCHEDULED") {
                    await prisma.expert_sessions.update({
                        where: { id: parsed.data.expertSessionId },
                        data: {
                            status: "CONNECTING",
                            started_at: session.started_at ?? new Date(),
                            updated_at: new Date(),
                        },
                    });
                    session.status = "CONNECTING";
                    session.started_at = session.started_at ?? new Date();
                    cacheExpertSessionPatch(parsed.data.expertSessionId, {
                        status: "CONNECTING",
                        started_at: session.started_at,
                    });
                }

                if (session.candidate_user_id === userId && !session.candidate_admitted_at) {
                    client.join(expertLobbyRoomName(parsed.data.expertSessionId));
                    client.emit("expert:lobby-state", {
                        expertSessionId: parsed.data.expertSessionId,
                        admitted: false,
                        waiting: true,
                        message: "Waiting for the expert to let you in.",
                    });
                    emitExpertLobbyRequests(parsed.data.expertSessionId, session);
                    return;
                }

                clearExpertEmptyRoomTimer(parsed.data.expertSessionId);
                client.leave(expertLobbyRoomName(parsed.data.expertSessionId));
                client.join(expertRoomName(parsed.data.expertSessionId));
                client.emit("expert:lobby-state", {
                    expertSessionId: parsed.data.expertSessionId,
                    admitted: true,
                    waiting: false,
                    message: "You are in the interview room.",
                });
                sendExpertRoomBootstrap(client, parsed.data.expertSessionId, session, state);
                await emitExpertSessionState(parsed.data.expertSessionId);
                if (session.expert_user_id === userId) {
                    emitExpertLobbyRequests(parsed.data.expertSessionId, session);
                }
            } catch (err) {
                const message = err instanceof Error ? err.message : "Unable to join expert session";
                client.emit("expert:error", { code: "SESSION_JOIN_ERROR", message });
                fastify.log.error(err);
            }
        });

        client.on("expert:chat-send", async (payload) => {
            if (!(await checkRateLimit(`expert:chat-send:${userId}`, 100, 60_000))) {
                client.emit("expert:error", { code: "RATE_LIMITED", message: "Too many chat messages" });
                return;
            }

            const parsed = ExpertChatMessageSchema.safeParse(payload);
            if (!parsed.success) {
                client.emit("expert:error", { code: "INVALID_PAYLOAD", message: "Invalid chat payload" });
                return;
            }

            try {
                const session = await getExpertSessionForUser(userId, parsed.data.expertSessionId);
                assertExpertRoomAccess(userId, session);
                const state = getExpertState(parsed.data.expertSessionId, session.preferred_language, expertTotalSeconds(session));
                const message = {
                    id: randomUUID(),
                    userId,
                    text: parsed.data.text,
                    createdAt: new Date().toISOString(),
                };
                state.messages.push(message);
                if (state.messages.length > 200) state.messages.splice(0, state.messages.length - 200);

                io.to(expertRoomName(parsed.data.expertSessionId)).emit("expert:chat-message", {
                    ...message,
                    expertSessionId: parsed.data.expertSessionId,
                });
            } catch (err) {
                const message = err instanceof Error ? err.message : "Unable to send chat message";
                client.emit("expert:error", { code: "CHAT_SEND_ERROR", message });
                fastify.log.error(err);
            }
        });

        client.on("expert:timer-sync", async (payload) => {
            if (!(await checkRateLimit(`expert:timer-sync:${userId}`, 180, 60_000))) {
                client.emit("expert:error", { code: "RATE_LIMITED", message: "Too many timer updates" });
                return;
            }

            const parsed = ExpertTimerSyncSchema.safeParse(payload);
            if (!parsed.success) {
                client.emit("expert:error", { code: "INVALID_PAYLOAD", message: "Invalid timer payload" });
                return;
            }

            try {
                const session = await getExpertSessionForUser(userId, parsed.data.expertSessionId);
                assertExpertRoomAccess(userId, session);
                const state = getExpertState(parsed.data.expertSessionId, session.preferred_language, expertTotalSeconds(session));
                state.elapsedSeconds = parsed.data.elapsedSeconds;
                state.totalSeconds = parsed.data.totalSeconds ?? state.totalSeconds;

                io.to(expertRoomName(parsed.data.expertSessionId)).emit("expert:timer-sync", {
                    expertSessionId: parsed.data.expertSessionId,
                    elapsedSeconds: state.elapsedSeconds,
                    totalSeconds: state.totalSeconds,
                });
            } catch (err) {
                const message = err instanceof Error ? err.message : "Unable to sync timer";
                client.emit("expert:error", { code: "TIMER_SYNC_ERROR", message });
                fastify.log.error(err);
            }
        });

        client.on("expert:editor-sync", async (payload) => {
            if (!(await checkRateLimit(`expert:editor-sync:${userId}`, 300, 60_000))) {
                client.emit("expert:error", { code: "RATE_LIMITED", message: "Too many editor sync updates" });
                return;
            }

            const parsed = ExpertEditorSyncSchema.safeParse(payload);
            if (!parsed.success) {
                client.emit("expert:error", { code: "INVALID_PAYLOAD", message: "Invalid editor sync payload" });
                return;
            }

            try {
                const session = await getExpertSessionForUser(userId, parsed.data.expertSessionId);
                assertExpertRoomAccess(userId, session);
                if (session.candidate_user_id !== userId) {
                    throw new Error("Only the candidate can edit the shared workspace");
                }

                const state = getExpertState(parsed.data.expertSessionId, session.preferred_language, expertTotalSeconds(session));
                state.code = parsed.data.code;
                state.language = parsed.data.language;
                state.revision = Math.max(state.revision + 1, parsed.data.revision ?? 0);
                state.updatedByUserId = userId;
                state.updatedAt = new Date().toISOString();
                emitExpertEditorState(parsed.data.expertSessionId, state, session.candidate_user_id);
            } catch (err) {
                const message = err instanceof Error ? err.message : "Unable to sync editor state";
                client.emit("expert:error", { code: "EDITOR_SYNC_ERROR", message });
                fastify.log.error(err);
            }
        });

        client.on("expert:signal-offer", async (payload) => {
            if (!(await checkRateLimit(`expert:signal-offer:${userId}`, 120, 60_000))) {
                client.emit("expert:error", { code: "RATE_LIMITED", message: "Too many signaling requests" });
                return;
            }

            const parsed = ExpertSignalSchema.safeParse(payload);
            if (!parsed.success) {
                client.emit("expert:error", { code: "INVALID_PAYLOAD", message: "Invalid signal offer payload" });
                return;
            }

            try {
                const session = await getExpertSessionForUser(userId, parsed.data.expertSessionId);
                assertExpertRoomAccess(userId, session);
                const peerUserId = session.candidate_user_id === userId ? session.expert_user_id : session.candidate_user_id;
                io.to(`user:${peerUserId}`).emit("expert:signal-offer", parsed.data);
            } catch (err) {
                const message = err instanceof Error ? err.message : "Unable to relay offer";
                client.emit("expert:error", { code: "SIGNAL_OFFER_ERROR", message });
                fastify.log.error(err);
            }
        });

        client.on("expert:signal-answer", async (payload) => {
            if (!(await checkRateLimit(`expert:signal-answer:${userId}`, 120, 60_000))) {
                client.emit("expert:error", { code: "RATE_LIMITED", message: "Too many signaling requests" });
                return;
            }

            const parsed = ExpertSignalSchema.safeParse(payload);
            if (!parsed.success) {
                client.emit("expert:error", { code: "INVALID_PAYLOAD", message: "Invalid signal answer payload" });
                return;
            }

            try {
                const session = await getExpertSessionForUser(userId, parsed.data.expertSessionId);
                assertExpertRoomAccess(userId, session);
                const peerUserId = session.candidate_user_id === userId ? session.expert_user_id : session.candidate_user_id;
                io.to(`user:${peerUserId}`).emit("expert:signal-answer", parsed.data);
            } catch (err) {
                const message = err instanceof Error ? err.message : "Unable to relay answer";
                client.emit("expert:error", { code: "SIGNAL_ANSWER_ERROR", message });
                fastify.log.error(err);
            }
        });

        client.on("expert:signal-ice", async (payload) => {
            if (!(await checkRateLimit(`expert:signal-ice:${userId}`, 240, 60_000))) {
                client.emit("expert:error", { code: "RATE_LIMITED", message: "Too many ICE candidates" });
                return;
            }

            const parsed = ExpertIceSchema.safeParse(payload);
            if (!parsed.success) {
                client.emit("expert:error", { code: "INVALID_PAYLOAD", message: "Invalid ICE payload" });
                return;
            }

            try {
                const session = await getExpertSessionForUser(userId, parsed.data.expertSessionId);
                assertExpertRoomAccess(userId, session);
                const peerUserId = session.candidate_user_id === userId ? session.expert_user_id : session.candidate_user_id;
                io.to(`user:${peerUserId}`).emit("expert:signal-ice", parsed.data);
            } catch (err) {
                const message = err instanceof Error ? err.message : "Unable to relay ICE candidate";
                client.emit("expert:error", { code: "SIGNAL_ICE_ERROR", message });
                fastify.log.error(err);
            }
        });

        client.on("expert:execution-sync", async (payload) => {
            if (!(await checkRateLimit(`expert:execution-sync:${userId}`, 180, 60_000))) {
                client.emit("expert:error", { code: "RATE_LIMITED", message: "Too many execution sync events" });
                return;
            }

            const parsed = ExpertExecutionSyncSchema.safeParse(payload);
            if (!parsed.success) {
                client.emit("expert:error", { code: "INVALID_PAYLOAD", message: "Invalid execution sync payload" });
                return;
            }

            try {
                const session = await getExpertSessionForUser(userId, parsed.data.expertSessionId);
                assertExpertRoomAccess(userId, session);
                io.to(expertRoomName(parsed.data.expertSessionId)).emit("expert:execution-sync", {
                    ...parsed.data,
                    startedByUserId: userId,
                    updatedAt: new Date().toISOString(),
                });
            } catch (err) {
                const message = err instanceof Error ? err.message : "Unable to relay execution sync";
                client.emit("expert:error", { code: "EXECUTION_SYNC_ERROR", message });
                fastify.log.error(err);
            }
        });

        client.on("expert:admit-candidate", async (payload) => {
            if (!(await checkRateLimit(`expert:admit-candidate:${userId}`, 30, 60_000))) {
                client.emit("expert:error", { code: "RATE_LIMITED", message: "Too many lobby actions" });
                return;
            }

            const parsed = ExpertAdmitCandidateSchema.safeParse(payload);
            if (!parsed.success) {
                client.emit("expert:error", { code: "INVALID_PAYLOAD", message: "Invalid lobby admission payload" });
                return;
            }

            try {
                const session = await getExpertSessionForUser(userId, parsed.data.expertSessionId, { forceFresh: true });
                if (session.expert_user_id !== userId) {
                    throw new Error("Only the expert can admit the candidate.");
                }
                if (session.candidate_user_id !== parsed.data.candidateUserId) {
                    throw new Error("Candidate does not belong to this interview.");
                }
                if (["COMPLETED", "CANCELLED", "ABANDONED"].includes(session.status)) {
                    throw new Error("This expert interview has ended.");
                }

                const admittedAt = session.candidate_admitted_at ?? new Date();
                await prisma.expert_sessions.update({
                    where: { id: parsed.data.expertSessionId },
                    data: {
                        status: "ACTIVE",
                        candidate_admitted_at: admittedAt,
                        started_at: session.started_at ?? admittedAt,
                        updated_at: new Date(),
                    },
                });
                session.status = "ACTIVE";
                session.candidate_admitted_at = admittedAt;
                session.started_at = session.started_at ?? admittedAt;
                cacheExpertSessionPatch(parsed.data.expertSessionId, {
                    status: "ACTIVE",
                    candidate_admitted_at: admittedAt,
                    started_at: session.started_at,
                });

                const state = getExpertState(parsed.data.expertSessionId, session.preferred_language, expertTotalSeconds(session));
                const lobbyRoom = expertLobbyRoomName(parsed.data.expertSessionId);
                const room = expertRoomName(parsed.data.expertSessionId);
                const lobbySocketIds = [...(io.sockets.adapter.rooms.get(lobbyRoom) ?? new Set<string>())];

                for (const socketId of lobbySocketIds) {
                    const lobbySocket = io.sockets.sockets.get(socketId) as AuthenticatedSocket | undefined;
                    if (!lobbySocket || lobbySocket.data.user.id !== session.candidate_user_id) continue;
                    lobbySocket.leave(lobbyRoom);
                    lobbySocket.join(room);
                    lobbySocket.emit("expert:lobby-state", {
                        expertSessionId: parsed.data.expertSessionId,
                        admitted: true,
                        waiting: false,
                        message: "The expert let you in.",
                    });
                    sendExpertRoomBootstrap(lobbySocket, parsed.data.expertSessionId, session, state);
                }

                io.to(`user:${session.candidate_user_id}`).emit("expert:lobby-state", {
                    expertSessionId: parsed.data.expertSessionId,
                    admitted: true,
                    waiting: false,
                    message: "The expert let you in.",
                });
                emitExpertLobbyRequests(parsed.data.expertSessionId, session);
                await emitExpertSessionState(parsed.data.expertSessionId);
            } catch (err) {
                const message = err instanceof Error ? err.message : "Unable to admit candidate";
                client.emit("expert:error", { code: "LOBBY_ADMIT_ERROR", message });
                fastify.log.error(err);
            }
        });

        client.on("expert:session-end", async (payload) => {
            if (!(await checkRateLimit(`expert:session-end:${userId}`, 20, 60_000))) {
                client.emit("expert:error", { code: "RATE_LIMITED", message: "Too many session end requests" });
                return;
            }

            const parsed = ExpertSessionEndSchema.safeParse(payload);
            if (!parsed.success) {
                client.emit("expert:error", { code: "INVALID_PAYLOAD", message: "Invalid session end payload" });
                return;
            }

            try {
                const session = await getExpertSessionForUser(userId, parsed.data.expertSessionId, { forceFresh: true });
                assertExpertRoomAccess(userId, session);
                if (session.expert_user_id !== userId && session.candidate_user_id !== userId) {
                    throw new Error("Only a session participant can end the interview");
                }

                await prisma.expert_sessions.update({
                    where: { id: parsed.data.expertSessionId },
                    data: {
                        status: "COMPLETED",
                        ended_at: new Date(),
                        updated_at: new Date(),
                    },
                });
                cacheExpertSessionStatus(parsed.data.expertSessionId, "COMPLETED");

                io.to(expertRoomName(parsed.data.expertSessionId)).emit("expert:session-ended", {
                    expertSessionId: parsed.data.expertSessionId,
                    reason: "completed",
                    endedAt: new Date().toISOString(),
                });
                await emitExpertSessionState(parsed.data.expertSessionId);
            } catch (err) {
                const message = err instanceof Error ? err.message : "Unable to end session";
                client.emit("expert:error", { code: "SESSION_END_ERROR", message });
                fastify.log.error(err);
            }
        });

        client.on("disconnecting", () => {
            const expertSessionIds = [...client.rooms]
                .filter((room) => room.startsWith("expert:") && !room.startsWith("expert:lobby:"))
                .map((room) => room.slice("expert:".length));
            const expertLobbySessionIds = [...client.rooms]
                .filter((room) => room.startsWith("expert:lobby:"))
                .map((room) => room.slice("expert:lobby:".length));

            setTimeout(() => {
                expertSessionIds.forEach((expertSessionId) => {
                    void emitExpertSessionState(expertSessionId);
                    void maybeScheduleExpertAutoEnd(expertSessionId);
                });
                expertLobbySessionIds.forEach(async (expertSessionId) => {
                    const session = await loadExpertSessionFromDb(expertSessionId);
                    if (session) emitExpertLobbyRequests(expertSessionId, session);
                });
            }, 0);
        });

        client.on("disconnect", async () => {
            await matchmaking.onSocketDisconnected(userId, client.id);
        });
    });

    await fastify.listen({ host: config.host, port: config.port });
    fastify.log.info(`P2P service running at ${config.host}:${config.port}`);

    // Graceful shutdown on Cloud Run SIGTERM (deploy/scale-down). Stop the
    // matchmaking timer, close sockets + HTTP, disconnect Postgres.
    let shuttingDown = false;
    const shutdown = async (signal: string) => {
        if (shuttingDown) return;
        shuttingDown = true;
        fastify.log.info(`${signal} received — shutting down p2p`);
        try {
            matchmaking.stopBackgroundWorkers?.();
            io.close();
            await fastify.close();
            await prisma.$disconnect();
        } catch (err) {
            fastify.log.error({ err }, "Error during p2p graceful shutdown");
        } finally {
            process.exit(0);
        }
    };
    process.on("SIGTERM", () => void shutdown("SIGTERM"));
    process.on("SIGINT", () => void shutdown("SIGINT"));
}

bootstrap().catch((err) => {
    console.error("Failed to start p2p service", err);
    process.exit(1);
});
