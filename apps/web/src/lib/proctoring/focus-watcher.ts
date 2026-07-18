import type { ProctoringEventDraft } from "./types";

type EmitEvent = (event: ProctoringEventDraft) => void;

const BLUR_VISIBILITY_SUPPRESSION_MS = 200;
const DEVTOOLS_DELTA_THRESHOLD = 160;

export class FocusWatcher {
    private hiddenStartedAt: number | null = null;
    private blurStartedAt: number | null = null;
    private suppressCurrentBlur = false;
    private devtoolsOpen = false;
    private devtoolsTimer: ReturnType<typeof setInterval> | null = null;

    constructor(private readonly emitEvent: EmitEvent) { }

    start(): void {
        document.addEventListener("visibilitychange", this.handleVisibilityChange);
        window.addEventListener("blur", this.handleBlur);
        window.addEventListener("focus", this.handleFocus);
        document.addEventListener("fullscreenchange", this.handleFullscreenChange);
        this.devtoolsTimer = setInterval(this.checkDevtools, 1000);
        void document.documentElement.requestFullscreen?.().catch(() => { });
    }

    stop(): void {
        document.removeEventListener("visibilitychange", this.handleVisibilityChange);
        window.removeEventListener("blur", this.handleBlur);
        window.removeEventListener("focus", this.handleFocus);
        document.removeEventListener("fullscreenchange", this.handleFullscreenChange);
        if (this.devtoolsTimer) clearInterval(this.devtoolsTimer);
        this.devtoolsTimer = null;
        this.hiddenStartedAt = null;
        this.blurStartedAt = null;
        this.suppressCurrentBlur = false;
        this.devtoolsOpen = false;
    }

    private handleVisibilityChange = (): void => {
        const now = Date.now();
        if (document.visibilityState === "hidden") {
            this.hiddenStartedAt = now;
            if (this.blurStartedAt && now - this.blurStartedAt <= BLUR_VISIBILITY_SUPPRESSION_MS) {
                this.suppressCurrentBlur = true;
            }
            return;
        }

        if (this.hiddenStartedAt) {
            this.emitEvent({
                event_type: "tab_hidden",
                payload: { duration_ms: now - this.hiddenStartedAt },
            });
        }
        this.hiddenStartedAt = null;
    };

    private handleBlur = (): void => {
        this.blurStartedAt = Date.now();
        this.suppressCurrentBlur = false;
    };

    private handleFocus = (): void => {
        if (this.blurStartedAt && !this.suppressCurrentBlur) {
            this.emitEvent({
                event_type: "window_blur",
                payload: { duration_ms: Date.now() - this.blurStartedAt },
            });
        }
        this.blurStartedAt = null;
        this.suppressCurrentBlur = false;
    };

    private handleFullscreenChange = (): void => {
        if (!document.fullscreenElement) {
            this.emitEvent({ event_type: "fullscreen_exit", payload: {} });
        }
    };

    private checkDevtools = (): void => {
        const widthDelta = Math.abs(window.outerWidth - window.innerWidth);
        const heightDelta = Math.abs(window.outerHeight - window.innerHeight);
        const isOpen = widthDelta > DEVTOOLS_DELTA_THRESHOLD || heightDelta > DEVTOOLS_DELTA_THRESHOLD;
        if (isOpen && !this.devtoolsOpen) {
            this.emitEvent({
                event_type: "devtools_opened",
                payload: { detection_method: "viewport_delta" },
            });
        }
        this.devtoolsOpen = isOpen;
    };
}
