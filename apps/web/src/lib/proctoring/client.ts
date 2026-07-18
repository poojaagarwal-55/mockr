import type { ProctoringEventInput, ProctoringEventType } from "@interviewforge/shared";
import { CameraWorkerController } from "./camera-worker-controller";
import { EventQueue } from "./event-queue";
import { FocusWatcher } from "./focus-watcher";
import { InputWatcher } from "./input-watcher";
import { SnapshotUploader } from "./snapshot-uploader";
import { normalizeJwt } from "./token";
import { Transport } from "./transport";
import type {
    ProctoringClient,
    ProctoringClientStatus,
    ProctoringDebugEvent,
    ProctoringEventDraft,
    RulesPublic,
} from "./types";

type StatusListener = (status: ProctoringClientStatus) => void;
type TerminateListener = (reason: string) => void;
type EventListener = (event: ProctoringEventInput) => void;

type BrowserProctoringClientOptions = {
    createQueue?: typeof EventQueue.open;
    createTransport?: (queue: EventQueue, debug: DebugCallbacks) => Transport;
    createSnapshotUploader?: () => SnapshotUploader;
    createCameraWorker?: (emit: (event: ProctoringEventDraft) => void) => CameraWorkerController;
    getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
    onDebugEvent?: (event: ProctoringDebugEvent) => void;
    onQueueSizeChange?: (size: number) => void;
};

type DebugCallbacks = {
    onDebugEvent?: (event: ProctoringDebugEvent) => void;
    onQueueSizeChange?: (size: number) => void;
};

const SNAPSHOT_EVENT_TYPES = new Set<ProctoringEventType>([
    "face_multiple",
    "object_detected",
    "fullscreen_exit",
    "devtools_opened",
]);

export class BrowserProctoringClient implements ProctoringClient {
    private status: ProctoringClientStatus = "idle";
    private sessionId: string | null = null;
    private jwt: string | null = null;
    private stream: MediaStream | null = null;
    private queue: EventQueue | null = null;
    private transport: Transport | null = null;
    private cameraWorker: CameraWorkerController | null = null;
    private focusWatcher: FocusWatcher | null = null;
    private inputWatcher: InputWatcher | null = null;
    private snapshotUploader: SnapshotUploader | null = null;
    private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    private statusListeners = new Set<StatusListener>();
    private terminateListeners = new Set<TerminateListener>();
    private eventListeners = new Set<EventListener>();

    constructor(private readonly options: BrowserProctoringClientOptions = {}) { }

    async start(args: {
        sessionId: string;
        jwt: string;
        rulesPublic: RulesPublic;
        editorRoot: HTMLElement;
    }): Promise<void> {
        if (this.status === "starting" || this.status === "running") return;
        this.setStatus("starting");
        const jwt = normalizeJwt(args.jwt);
        this.sessionId = args.sessionId;
        this.jwt = jwt;

        const createQueue = this.options.createQueue ?? EventQueue.open;
        this.queue = await createQueue(args.sessionId);
        this.transport = this.createTransport(this.queue);
        this.transport.onTerminate((reason) => {
            void this.handleTerminate(reason);
        });
        this.transport.onHeartbeatRequired(() => {
            void this.emitEvent({ event_type: "session_heartbeat", payload: { ts: Date.now() } });
        });
        await this.transport.connect(args.sessionId, jwt);

        try {
            this.stream = await this.requestWebcam();
        } catch {
            await this.emitEvent({ event_type: "webcam_revoked", payload: {} });
            await this.transport.flush().catch(() => { });
            await this.stopInternal();
            this.setStatus("terminated");
            this.fireTerminate("webcam_revoked");
            return;
        }

        this.cameraWorker = this.options.createCameraWorker?.((event) => void this.emitEvent(event))
            ?? new CameraWorkerController((event) => void this.emitEvent(event));
        await this.cameraWorker.start(this.stream);

        this.focusWatcher = new FocusWatcher((event) => void this.emitEvent(event));
        this.focusWatcher.start();
        this.inputWatcher = new InputWatcher(args.editorRoot, (event) => void this.emitEvent(event));
        this.inputWatcher.start();

        this.snapshotUploader = this.options.createSnapshotUploader?.() ?? new SnapshotUploader();
        await this.snapshotUploader.start(
            args.sessionId,
            jwt,
            this.stream,
            args.rulesPublic.snapshot_interval_ms
        );

        await this.emitEvent({ event_type: "session_start", payload: {} });
        this.heartbeatTimer = setInterval(() => {
            void this.emitEvent({ event_type: "session_heartbeat", payload: { ts: Date.now() } });
        }, args.rulesPublic.heartbeat_interval_ms);
        this.setStatus("running");
    }

    async stop(): Promise<void> {
        if (this.status === "idle" || this.status === "stopped") return;
        await this.stopInternal();
        this.setStatus("stopped");
    }

    onTerminate(listener: TerminateListener): () => void {
        this.terminateListeners.add(listener);
        return () => this.terminateListeners.delete(listener);
    }

    onStatusChange(listener: StatusListener): () => void {
        this.statusListeners.add(listener);
        return () => this.statusListeners.delete(listener);
    }

    onEvent(listener: EventListener): () => void {
        this.eventListeners.add(listener);
        return () => this.eventListeners.delete(listener);
    }

    private async emitEvent(draft: ProctoringEventDraft): Promise<ProctoringEventInput | null> {
        if (!this.queue || !this.transport || this.status === "terminated" || this.status === "stopped") return null;
        const queue = this.queue;
        const transport = this.transport;
        const event = await queue.enqueue(draft);
        for (const listener of this.eventListeners) listener(event);
        this.options.onDebugEvent?.({ event, status: "queued" });
        this.options.onQueueSizeChange?.(await queue.size());

        if (SNAPSHOT_EVENT_TYPES.has(event.event_type)) {
            void this.snapshotUploader?.uploadNow("event_triggered", event.client_event_id);
        }

        if (this.transport !== transport || !this.queue) {
            return event;
        }
        await transport.sendEvent(event);
        return event;
    }

    private createTransport(queue: EventQueue): Transport {
        if (this.options.createTransport) {
            return this.options.createTransport(queue, {
                onDebugEvent: this.options.onDebugEvent,
                onQueueSizeChange: this.options.onQueueSizeChange,
            });
        }
        return new Transport(queue, {
            onDebugEvent: this.options.onDebugEvent,
            onQueueSizeChange: this.options.onQueueSizeChange,
        });
    }

    private async requestWebcam(): Promise<MediaStream> {
        const getUserMedia = this.options.getUserMedia
            ?? navigator.mediaDevices?.getUserMedia.bind(navigator.mediaDevices);
        if (!getUserMedia) throw new Error("getUserMedia unavailable");
        return getUserMedia({
            video: { facingMode: "user" },
            audio: false,
        });
    }

    private async handleTerminate(reason: string): Promise<void> {
        await this.stopInternal();
        this.setStatus("terminated");
        this.fireTerminate(reason);
    }

    private async stopInternal(): Promise<void> {
        this.focusWatcher?.stop();
        this.inputWatcher?.stop();
        this.cameraWorker?.stop();
        this.snapshotUploader?.stop();
        this.transport?.disconnect();
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        this.stream?.getTracks().forEach((track) => track.stop());
        this.queue?.close();

        this.focusWatcher = null;
        this.inputWatcher = null;
        this.cameraWorker = null;
        this.snapshotUploader = null;
        this.transport = null;
        this.heartbeatTimer = null;
        this.stream = null;
        this.queue = null;
        this.sessionId = null;
        this.jwt = null;
    }

    private setStatus(status: ProctoringClientStatus): void {
        this.status = status;
        for (const listener of this.statusListeners) listener(status);
    }

    private fireTerminate(reason: string): void {
        for (const listener of this.terminateListeners) listener(reason);
    }
}

export function createProctoringClient(
    options?: BrowserProctoringClientOptions
): ProctoringClient {
    return new BrowserProctoringClient(options);
}

export type { ProctoringClient, ProctoringClientStatus, RulesPublic };
