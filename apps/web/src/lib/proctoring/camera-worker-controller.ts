import type { ProctoringEventDraft } from "./types";

type EmitEvent = (event: ProctoringEventDraft) => void;

type CameraWorkerMessage =
    | { type: "event"; event: ProctoringEventDraft }
    | { type: "model_error"; message: string };

const FRAME_INTERVAL_MS = 1000;

export class CameraWorkerController {
    private worker: Worker | null = null;
    private video: HTMLVideoElement | null = null;
    private canvas: OffscreenCanvas | HTMLCanvasElement | null = null;
    private timer: ReturnType<typeof setInterval> | null = null;
    private trackEndHandler: (() => void) | null = null;

    constructor(private readonly emitEvent: EmitEvent) { }

    async start(stream: MediaStream): Promise<void> {
        this.worker = new Worker(new URL("../../workers/camera-worker.ts", import.meta.url), {
            type: "module",
        });
        this.worker.onmessage = (message: MessageEvent<CameraWorkerMessage>) => {
            if (message.data.type === "event") {
                this.emitEvent(message.data.event);
                return;
            }
            if (message.data.type === "model_error") {
                console.warn("[SecureOA] Camera worker model load failed:", message.data.message);
            }
        };

        this.video = document.createElement("video");
        this.video.muted = true;
        this.video.playsInline = true;
        this.video.srcObject = stream;
        await this.video.play().catch(() => { });

        const [track] = stream.getVideoTracks();
        if (track) {
            this.trackEndHandler = () => {
                this.emitEvent({ event_type: "webcam_stream_ended", payload: {} });
            };
            track.addEventListener("ended", this.trackEndHandler);
        }

        this.worker.postMessage({ type: "init" });
        this.timer = setInterval(() => {
            void this.captureFrame();
        }, FRAME_INTERVAL_MS);
    }

    stop(): void {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        const stream = this.video?.srcObject as MediaStream | null;
        const [track] = stream?.getVideoTracks() ?? [];
        if (track && this.trackEndHandler) {
            track.removeEventListener("ended", this.trackEndHandler);
        }
        this.trackEndHandler = null;
        if (this.video) {
            this.video.pause();
            this.video.srcObject = null;
        }
        this.video = null;
        this.canvas = null;
        this.stopWorkerOnly();
    }

    private stopWorkerOnly(): void {
        this.worker?.terminate();
        this.worker = null;
    }

    private async captureFrame(): Promise<void> {
        if (!this.worker || !this.video) return;
        const width = this.video.videoWidth || 640;
        const height = this.video.videoHeight || 480;
        const canvas = this.ensureCanvas(width, height);
        const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true }) as
            | CanvasRenderingContext2D
            | OffscreenCanvasRenderingContext2D
            | null;
        if (!context) return;
        context.drawImage(this.video, 0, 0, width, height);

        if (typeof OffscreenCanvas !== "undefined" && canvas instanceof OffscreenCanvas) {
            const bitmap = canvas.transferToImageBitmap();
            this.worker.postMessage({ type: "frame", bitmap, capturedAt: performance.now() }, [bitmap]);
            return;
        }

        const bitmap = await createImageBitmap(canvas);
        this.worker.postMessage({ type: "frame", bitmap, capturedAt: performance.now() }, [bitmap]);
    }

    private ensureCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
        if (this.canvas && this.canvas.width === width && this.canvas.height === height) {
            return this.canvas;
        }
        if (typeof OffscreenCanvas !== "undefined") {
            this.canvas = new OffscreenCanvas(width, height);
            return this.canvas;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        this.canvas = canvas;
        return canvas;
    }
}
