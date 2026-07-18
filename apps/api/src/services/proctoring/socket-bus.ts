import type { Server as SocketIOServer } from "socket.io";
import { PROCTORING_SOCKET_NAMESPACE, proctoringSessionRoom } from "./constants.js";

let socketServer: SocketIOServer | null = null;

export function setProctoringSocketServer(io: SocketIOServer) {
    socketServer = io;
}

function namespace() {
    return socketServer?.of(PROCTORING_SOCKET_NAMESPACE) || null;
}

export function emitProctoringTerminate(sessionId: string, reason: string) {
    namespace()?.to(proctoringSessionRoom(sessionId)).emit("proctoring:terminate", { reason });
}

export function disconnectProctoringSession(sessionId: string) {
    namespace()?.to(proctoringSessionRoom(sessionId)).disconnectSockets(true);
}

export function emitProctoringHeartbeatRequired(sessionId: string) {
    namespace()?.to(proctoringSessionRoom(sessionId)).emit("proctoring:heartbeat_required", {
        ts: Date.now(),
    });
}
