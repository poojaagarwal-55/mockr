import type { Server as SocketIOServer, Socket } from "socket.io";
import { z } from "zod";
import { getSupabaseAdmin } from "../../lib/supabase.js";
import { checkRateLimit } from "../../lib/rate-limiter.js";
import { ProctoringIngestService } from "./ingest.js";
import {
    PROCTORING_SOCKET_NAMESPACE,
    proctoringSessionRoom,
} from "./constants.js";
import { proctoringEventInputSchema } from "./schemas.js";
import {
    disconnectProctoringSession,
    emitProctoringTerminate,
    setProctoringSocketServer,
} from "./socket-bus.js";
import {
    AUTHENTICATION_FAILED_MESSAGE,
    INTERNAL_SERVER_ERROR_MESSAGE,
    isConnectivityIssue,
} from "../../lib/user-facing-errors.js";

const socketAuthSchema = z.object({
    token: z.string().trim().min(1),
    sessionId: z.string().uuid(),
});

type AuthenticatedProctoringSocket = Socket & {
    data: {
        sessionId: string;
        candidateUserId: string;
        companyId: string;
    };
};

export function registerSecureOaSocketNamespace(
    io: SocketIOServer,
    prisma: any,
    logger?: { warn?: (...args: any[]) => void; error?: (...args: any[]) => void; info?: (...args: any[]) => void }
) {
    setProctoringSocketServer(io);
    const namespace = io.of(PROCTORING_SOCKET_NAMESPACE);
    const ingestService = new ProctoringIngestService(prisma, {});

    namespace.use(async (socket, next) => {
        const parsed = socketAuthSchema.safeParse(socket.handshake.auth || {});
        if (!parsed.success) return next(new Error("unauthorized"));

        try {
            const supabase = getSupabaseAdmin();
            const { data, error } = await supabase.auth.getUser(parsed.data.token);
            if (error) {
                if (isConnectivityIssue(error)) return next(new Error(INTERNAL_SERVER_ERROR_MESSAGE));
                return next(new Error(AUTHENTICATION_FAILED_MESSAGE));
            }
            if (!data.user) return next(new Error(AUTHENTICATION_FAILED_MESSAGE));

            const session = await prisma.secureOaSession.findFirst({
                where: {
                    id: parsed.data.sessionId,
                    candidateUserId: data.user.id,
                    status: { in: ["pending", "active"] },
                },
                select: {
                    id: true,
                    candidateUserId: true,
                    companyId: true,
                    status: true,
                },
            });
            if (!session) return next(new Error("unauthorized"));

            socket.data = {
                sessionId: session.id,
                candidateUserId: session.candidateUserId,
                companyId: session.companyId,
            };
            return next();
        } catch (error) {
            if (isConnectivityIssue(error)) return next(new Error(INTERNAL_SERVER_ERROR_MESSAGE));
            logger?.error?.({ error }, "Secure OA socket auth failed");
            return next(new Error("unauthorized"));
        }
    });

    namespace.on("connection", (socket: Socket) => {
        const authed = socket as AuthenticatedProctoringSocket;
        const { sessionId } = authed.data;
        socket.join(proctoringSessionRoom(sessionId));

        socket.on("proctoring:event", async (payload: unknown) => {
            const parsed = proctoringEventInputSchema.safeParse(payload);
            const clientEventId = typeof (payload as any)?.client_event_id === "string"
                ? (payload as any).client_event_id
                : "unknown";

            if (!parsed.success) {
                socket.emit("proctoring:ack", { client_event_id: clientEventId, accepted: false });
                return;
            }

            const rl = checkRateLimit(`secure-oa:socket:event:${sessionId}:${socket.id}`, 240, 60_000);
            if (!rl.allowed) {
                socket.emit("proctoring:ack", { client_event_id: parsed.data.client_event_id, accepted: false });
                return;
            }

            try {
                const result = await ingestService.ingestBatch(sessionId, [parsed.data], {
                    source: "socket",
                    ip: socket.handshake.address || "",
                });
                socket.emit("proctoring:ack", {
                    client_event_id: parsed.data.client_event_id,
                    accepted: result.accepted.includes(parsed.data.client_event_id),
                });

                if (result.terminated) {
                    emitProctoringTerminate(sessionId, result.terminationReason || "auto_rule_violation");
                    disconnectProctoringSession(sessionId);
                }
            } catch (error) {
                logger?.error?.({ error }, "Secure OA socket event ingest failed");
                socket.emit("proctoring:ack", {
                    client_event_id: parsed.data.client_event_id,
                    accepted: false,
                });
            }
        });

        socket.on("disconnect", () => {
            logger?.info?.({ sessionId }, "Secure OA socket disconnected");
        });
    });

    logger?.info?.("Secure OA Socket.IO namespace registered");
}
