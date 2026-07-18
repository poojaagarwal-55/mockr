import { io, type Socket } from "socket.io-client";
import type { ProctoringEventInput } from "@interviewforge/shared";
import { apiFetch, getApiBaseUrl } from "@/lib/api";
import type { EventQueue } from "./event-queue";
import { normalizeJwt } from "./token";
import type { ProctoringDebugEvent, ProctoringIngestResponse } from "./types";

type TransportOptions = {
    fetchEvents?: (
        path: string,
        options: Parameters<typeof apiFetch>[1]
    ) => Promise<ProctoringIngestResponse>;
    socketFactory?: typeof io;
    onDebugEvent?: (event: ProctoringDebugEvent) => void;
    onQueueSizeChange?: (size: number) => void;
};

type Listener = () => void;
type TerminateListener = (reason: string) => void;

const REST_BATCH_SIZE = 50;
const REST_FALLBACK_INTERVAL_MS = 1000;
const DEBUG_PROCTORING_TRANSPORT = process.env.NODE_ENV !== "production";

function debugTransport(message: string, details?: unknown): void {
    if (!DEBUG_PROCTORING_TRANSPORT) return;
    if (details === undefined) {
        console.debug(`[SecureOA Transport] ${message}`);
        return;
    }
    console.debug(`[SecureOA Transport] ${message}`, details);
}

function warnTransport(message: string, details?: unknown): void {
    if (!DEBUG_PROCTORING_TRANSPORT) return;
    if (details === undefined) {
        console.warn(`[SecureOA Transport] ${message}`);
        return;
    }
    console.warn(`[SecureOA Transport] ${message}`, details);
}

export class Transport {
    private sessionId: string | null = null;
    private jwt: string | null = null;
    private socket: Socket | null = null;
    private socketReady = false;
    private stopped = false;
    private flushInFlight: Promise<void> | null = null;
    private restTimer: ReturnType<typeof setInterval> | null = null;
    private terminateListeners = new Set<TerminateListener>();
    private heartbeatListeners = new Set<Listener>();

    constructor(
        private readonly queue: EventQueue,
        private readonly options: TransportOptions = {}
    ) { }

    async connect(sessionId: string, jwt: string): Promise<void> {
        this.sessionId = sessionId;
        this.jwt = normalizeJwt(jwt);
        this.stopped = false;

        const socketFactory = this.options.socketFactory ?? io;
        const socket = socketFactory(`${getApiBaseUrl()}/secure-oa`, {
            auth: { token: this.jwt, sessionId },
            transports: ["websocket", "polling"],
        });
        this.socket = socket;

        socket.on("connect", () => {
            debugTransport("socket connected", { sessionId });
            this.socketReady = false;
            this.stopRestFallback();
            void this.flush().then(() => {
                if (!this.stopped && this.socket === socket && socket.connected) {
                    this.socketReady = true;
                }
            });
        });

        socket.on("disconnect", () => {
            debugTransport("socket disconnected", { sessionId });
            this.socketReady = false;
            if (!this.stopped) this.startRestFallback();
        });

        socket.on("connect_error", (error: Error) => {
            warnTransport("socket connect_error; starting REST fallback", error.message);
            this.socketReady = false;
            if (!this.stopped) this.startRestFallback();
        });

        socket.on("proctoring:ack", (ack: { client_event_id?: string; accepted?: boolean }) => {
            debugTransport("ack received", ack);
            if (!ack.client_event_id) return;
            void this.handleAck(ack.client_event_id, Boolean(ack.accepted));
        });

        socket.on("proctoring:terminate", (payload: { reason?: string } | string) => {
            const reason = typeof payload === "string" ? payload : payload?.reason || "auto_rule_violation";
            this.handleTerminate(reason);
        });

        socket.on("proctoring:heartbeat_required", () => {
            for (const listener of this.heartbeatListeners) listener();
        });
    }

    async sendEvent(event: ProctoringEventInput): Promise<void> {
        if (this.stopped) return;
        if (this.socketReady && this.socket?.connected) {
            this.socket.emit("proctoring:event", event);
            return;
        }
        this.startRestFallback();
    }

    async flush(): Promise<void> {
        if (this.flushInFlight) return this.flushInFlight;
        this.flushInFlight = this.flushInternal().finally(() => {
            this.flushInFlight = null;
        });
        return this.flushInFlight;
    }

    onTerminate(listener: TerminateListener): () => void {
        this.terminateListeners.add(listener);
        return () => this.terminateListeners.delete(listener);
    }

    onHeartbeatRequired(listener: Listener): () => void {
        this.heartbeatListeners.add(listener);
        return () => this.heartbeatListeners.delete(listener);
    }

    disconnect(): void {
        this.stopped = true;
        this.socketReady = false;
        this.stopRestFallback();
        this.socket?.removeAllListeners();
        this.socket?.disconnect();
        this.socket = null;
    }

    private async flushInternal(): Promise<void> {
        if (!this.sessionId || !this.jwt || this.stopped) return;

        while (!this.stopped) {
            const events = await this.queue.peek(REST_BATCH_SIZE);
            if (!events.length) {
                await this.publishQueueSize();
                return;
            }

            const fetchEvents = this.options.fetchEvents ?? apiFetch<ProctoringIngestResponse>;
            const result = await fetchEvents(`/secure-oa/sessions/${this.sessionId}/events`, {
                method: "POST",
                body: JSON.stringify({ events }),
                token: this.jwt,
            });

            debugTransport("REST flush result", {
                accepted: result.accepted?.length ?? 0,
                rejected: result.rejected?.length ?? 0,
                rejectedDetails: result.rejected?.slice(0, 8),
                sessionStatus: result.sessionStatus ?? result.session_status,
                terminated: result.terminated,
            });
            await this.applyIngestResult(events, result);
            if (result.terminated) {
                this.handleTerminate(result.terminationReason || result.termination_reason || "auto_rule_violation");
                return;
            }
            const sessionStatus = result.sessionStatus ?? result.session_status;
            const sessionBecameInactive =
                sessionStatus &&
                !["active", "pending"].includes(sessionStatus) &&
                result.rejected?.some((item) => item.reason === "session_not_active");
            if (sessionBecameInactive) {
                this.handleTerminate(sessionStatus === "submitted" ? "submitted" : "session_not_active");
                return;
            }
        }
    }

    private async applyIngestResult(
        events: ProctoringEventInput[],
        result: ProctoringIngestResponse
    ): Promise<void> {
        const accepted = result.accepted ?? [];
        const rejected = result.rejected ?? [];
        await this.queue.markAccepted(accepted);
        await this.queue.markRejected(rejected.map((item) => item.client_event_id));

        for (const event of events) {
            if (accepted.includes(event.client_event_id)) {
                this.options.onDebugEvent?.({ event, status: "accepted" });
                continue;
            }
            const rejection = rejected.find((item) => item.client_event_id === event.client_event_id);
            if (rejection) {
                this.options.onDebugEvent?.({ event, status: "rejected", reason: rejection.reason });
            }
        }
        await this.publishQueueSize();
    }

    private async handleAck(clientEventId: string, accepted: boolean): Promise<void> {
        const event = (await this.queue.peek(5000)).find((candidate) => candidate.client_event_id === clientEventId);
        if (accepted) {
            await this.queue.markAccepted([clientEventId]);
            if (event) this.options.onDebugEvent?.({ event, status: "accepted" });
        } else {
            await this.queue.markRejected([clientEventId]);
            if (event) this.options.onDebugEvent?.({ event, status: "rejected", reason: "socket_ack_rejected" });
        }
        await this.publishQueueSize();
    }

    private startRestFallback(): void {
        if (this.restTimer || this.stopped) return;
        this.restTimer = setInterval(() => {
            void this.flush().catch(() => {
                warnTransport("REST fallback flush failed; queued events will retry");
            });
        }, REST_FALLBACK_INTERVAL_MS);
        void this.flush().catch((error) => {
            warnTransport("initial REST fallback flush failed", error instanceof Error ? error.message : error);
        });
    }

    private stopRestFallback(): void {
        if (!this.restTimer) return;
        clearInterval(this.restTimer);
        this.restTimer = null;
    }

    private handleTerminate(reason: string): void {
        if (this.stopped) return;
        this.stopped = true;
        this.stopRestFallback();
        for (const listener of this.terminateListeners) listener(reason);
    }

    private async publishQueueSize(): Promise<void> {
        if (!this.options.onQueueSizeChange) return;
        this.options.onQueueSizeChange(await this.queue.size());
    }
}
