import type { ProctoringEventDraft } from "./types";

type EmitEvent = (event: ProctoringEventDraft) => void;

export class InputWatcher {
    constructor(
        private readonly root: HTMLElement,
        private readonly emitEvent: EmitEvent
    ) { }

    start(): void {
        this.root.addEventListener("copy", this.handleCopy);
        this.root.addEventListener("cut", this.handleCut);
        this.root.addEventListener("paste", this.handlePaste);
        this.root.addEventListener("contextmenu", this.handleContextMenu);
    }

    stop(): void {
        this.root.removeEventListener("copy", this.handleCopy);
        this.root.removeEventListener("cut", this.handleCut);
        this.root.removeEventListener("paste", this.handlePaste);
        this.root.removeEventListener("contextmenu", this.handleContextMenu);
    }

    private handleCopy = (event: ClipboardEvent): void => {
        this.emitEvent({ event_type: "copy", payload: { char_count: clipboardTextLength(event) } });
    };

    private handleCut = (event: ClipboardEvent): void => {
        this.emitEvent({ event_type: "cut", payload: { char_count: clipboardTextLength(event) } });
    };

    private handlePaste = (event: ClipboardEvent): void => {
        this.emitEvent({ event_type: "paste", payload: { char_count: clipboardTextLength(event) } });
    };

    private handleContextMenu = (event: MouseEvent): void => {
        event.preventDefault();
        this.emitEvent({ event_type: "contextmenu", payload: {} });
    };
}

function clipboardTextLength(event: ClipboardEvent): number {
    return event.clipboardData?.getData("text")?.length ?? 0;
}
