import { getApiBaseUrl } from "@/lib/api";
import { normalizeJwt } from "./token";
import type { SnapshotUploadTrigger } from "./types";

const MAX_SNAPSHOT_BYTES = 200 * 1024;
const MAX_SNAPSHOT_WIDTH = 480;
const DEFAULT_QUALITY = 0.6;
const RETRY_QUALITIES = [0.45, 0.32, 0.22];

export class SnapshotUploader {
    private sessionId: string | null = null;
    private jwt: string | null = null;
    private stream: MediaStream | null = null;
    private video: HTMLVideoElement | null = null;
    private timer: ReturnType<typeof setInterval> | null = null;
    private uploadInFlight = false;

    async start(sessionId: string, jwt: string, stream: MediaStream, intervalMs = 30000): Promise<void> {
        this.sessionId = sessionId;
        this.jwt = normalizeJwt(jwt);
        this.stream = stream;
        this.video = document.createElement("video");
        this.video.muted = true;
        this.video.playsInline = true;
        this.video.srcObject = stream;
        await this.video.play().catch(() => { });
        this.timer = setInterval(() => {
            void this.uploadNow("scheduled");
        }, intervalMs);
    }

    async uploadNow(
        trigger: SnapshotUploadTrigger,
        triggeringClientEventId?: string
    ): Promise<void> {
        if (!this.sessionId || !this.jwt || !this.video || this.uploadInFlight) return;
        this.uploadInFlight = true;
        try {
            const blob = await this.captureBlob();
            if (!blob || blob.size > MAX_SNAPSHOT_BYTES) return;

            const form = new FormData();
            form.append("taken_at", new Date().toISOString());
            form.append("trigger", trigger);
            if (triggeringClientEventId) {
                form.append("triggering_client_event_id", triggeringClientEventId);
            }
            form.append("image", blob, "snapshot.jpg");

            const response = await fetch(`${getApiBaseUrl()}/secure-oa/sessions/${this.sessionId}/snapshots`, {
                method: "POST",
                headers: { Authorization: `Bearer ${this.jwt}` },
                credentials: "include",
                body: form,
            });
            if (!response.ok) {
                const errorBody = await response.json().catch(() => null);
                console.warn("[SecureOA] Snapshot upload rejected", {
                    status: response.status,
                    error: errorBody,
                    size: blob.size,
                    trigger,
                });
            }
        } catch {
            // Snapshot capture is best-effort; event delivery remains the authoritative signal.
        } finally {
            this.uploadInFlight = false;
        }
    }

    stop(): void {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        if (this.video) {
            this.video.pause();
            this.video.srcObject = null;
        }
        this.video = null;
        this.stream = null;
        this.sessionId = null;
        this.jwt = null;
        this.uploadInFlight = false;
    }

    private async captureBlob(): Promise<Blob | null> {
        const video = this.video;
        if (!video) return null;
        const naturalWidth = video.videoWidth || 640;
        const naturalHeight = video.videoHeight || 480;
        const scale = Math.min(1, MAX_SNAPSHOT_WIDTH / Math.max(naturalWidth, naturalHeight));
        const width = Math.max(1, Math.round(naturalWidth * scale));
        const height = Math.max(1, Math.round(naturalHeight * scale));

        let blob = await drawJpeg(video, width, height, DEFAULT_QUALITY);
        for (const quality of RETRY_QUALITIES) {
            if (!blob || blob.size <= MAX_SNAPSHOT_BYTES) break;
            blob = await drawJpeg(video, width, height, quality);
        }
        return blob && blob.size <= MAX_SNAPSHOT_BYTES ? blob : null;
    }
}

async function drawJpeg(
    source: CanvasImageSource,
    width: number,
    height: number,
    quality: number
): Promise<Blob | null> {
    if (typeof OffscreenCanvas !== "undefined") {
        const canvas = new OffscreenCanvas(width, height);
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) return null;
        context.drawImage(source, 0, 0, width, height);
        return canvas.convertToBlob({ type: "image/jpeg", quality });
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return null;
    context.drawImage(source, 0, 0, width, height);
    return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}
