import type {
    ProctoringEventInput,
    ProctoringEventPayloadMap,
    ProctoringEventType,
    ProctoringSnapshotTrigger,
} from "@interviewforge/shared";

export type RulesPublic = {
    heartbeat_interval_ms: number;
    snapshot_interval_ms: number;
};

export type ProctoringClientStatus =
    | "idle"
    | "starting"
    | "running"
    | "terminated"
    | "stopped";

export type ProctoringClient = {
    start(args: {
        sessionId: string;
        jwt: string;
        rulesPublic: RulesPublic;
        editorRoot: HTMLElement;
    }): Promise<void>;
    stop(): Promise<void>;
    onTerminate(listener: (reason: string) => void): () => void;
    onStatusChange(listener: (status: ProctoringClientStatus) => void): () => void;
    onEvent(listener: (event: ProctoringEventInput) => void): () => void;
};

export type ProctoringEventDraft<T extends ProctoringEventType = ProctoringEventType> = {
    event_type: T;
    payload: ProctoringEventPayloadMap[T];
};

export type QueuedProctoringEvent = ProctoringEventInput & {
    session_id: string;
    queued_at: number;
    sequence: number;
};

export type ProctoringIngestResponse = {
    accepted: string[];
    rejected: { client_event_id: string; reason: string }[];
    sessionStatus?: string;
    session_status?: string;
    terminated: boolean;
    terminationReason?: string;
    termination_reason?: string;
};

export type ProctoringDebugEvent = {
    event: ProctoringEventInput;
    status: "queued" | "accepted" | "rejected";
    reason?: string;
};

export type SnapshotUploadTrigger = ProctoringSnapshotTrigger;
