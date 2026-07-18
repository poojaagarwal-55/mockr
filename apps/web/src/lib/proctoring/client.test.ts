import { BrowserProctoringClient } from "./client";
import { EventQueue, MemoryEventQueueStorage } from "./event-queue";
import type { ProctoringEventDraft } from "./types";

jest.mock("./camera-worker-controller", () => ({
    CameraWorkerController: jest.fn(),
}));

function fakeStream(): MediaStream {
    return {
        getTracks: () => [{ stop: jest.fn() }],
        getVideoTracks: () => [{ addEventListener: jest.fn(), removeEventListener: jest.fn() }],
    } as unknown as MediaStream;
}

describe("BrowserProctoringClient", () => {
    function createStartedClient(overrides: ConstructorParameters<typeof BrowserProctoringClient>[0] = {}) {
        const sendEvent = jest.fn(async () => { });
        const client = new BrowserProctoringClient({
            createQueue: (sessionId) => EventQueue.open(sessionId, {
                storage: new MemoryEventQueueStorage(sessionId),
            }),
            getUserMedia: jest.fn(async () => fakeStream()),
            createTransport: () => ({
                connect: jest.fn(async () => { }),
                sendEvent,
                onTerminate: jest.fn(() => jest.fn()),
                onHeartbeatRequired: jest.fn(() => jest.fn()),
                disconnect: jest.fn(),
            } as any),
            createCameraWorker: () => ({
                start: jest.fn(async () => { }),
                stop: jest.fn(),
            } as any),
            createSnapshotUploader: () => ({
                start: jest.fn(async () => { }),
                uploadNow: jest.fn(async () => { }),
                stop: jest.fn(),
            } as any),
            ...overrides,
        });

        return { client, sendEvent };
    }

    test("notifies onEvent listeners with the outgoing event before transport send", async () => {
        const seen: string[] = [];
        const { client, sendEvent } = createStartedClient();
        client.onEvent((event) => seen.push(`${event.client_event_id}:${event.event_type}`));

        await client.start({
            sessionId: "session-events",
            jwt: "jwt",
            rulesPublic: {
                heartbeat_interval_ms: 5000,
                snapshot_interval_ms: 30000,
            },
            editorRoot: document.createElement("textarea"),
        });

        try {
            expect(seen).toContain("session-events-1:session_start");
            expect(sendEvent).toHaveBeenCalledWith(expect.objectContaining({
                client_event_id: "session-events-1",
                event_type: "session_start",
            }));
        } finally {
            await client.stop();
        }
    });

    test("routes configured high-signal events to event-triggered snapshots", async () => {
        let emitFromCamera: (event: ProctoringEventDraft) => void = () => {
            throw new Error("Camera emitter was not initialized.");
        };
        const uploadNow = jest.fn(async () => { });
        const client = new BrowserProctoringClient({
            createQueue: (sessionId) => EventQueue.open(sessionId, {
                storage: new MemoryEventQueueStorage(sessionId),
            }),
            getUserMedia: jest.fn(async () => fakeStream()),
            createTransport: () => ({
                connect: jest.fn(async () => { }),
                sendEvent: jest.fn(async () => { }),
                onTerminate: jest.fn(() => jest.fn()),
                onHeartbeatRequired: jest.fn(() => jest.fn()),
                disconnect: jest.fn(),
            } as any),
            createCameraWorker: (emit) => {
                emitFromCamera = emit;
                return {
                    start: jest.fn(async () => { }),
                    stop: jest.fn(),
                } as any;
            },
            createSnapshotUploader: () => ({
                start: jest.fn(async () => { }),
                uploadNow,
                stop: jest.fn(),
            } as any),
        });

        const editorRoot = document.createElement("textarea");
        await client.start({
            sessionId: "session-orchestrator",
            jwt: "jwt",
            rulesPublic: {
                heartbeat_interval_ms: 5000,
                snapshot_interval_ms: 30000,
            },
            editorRoot,
        });

        try {
            emitFromCamera({
                event_type: "face_multiple",
                payload: { count: 2, duration_ms: 1000 },
            });
            await new Promise((resolve) => setTimeout(resolve, 0));
            await Promise.resolve();

            expect(uploadNow).toHaveBeenCalledWith("event_triggered", "session-orchestrator-2");
        } finally {
            await client.stop();
        }
    });

    test("captures an event-triggered snapshot when a phone is detected", async () => {
        let emitFromCamera: (event: ProctoringEventDraft) => void = () => {
            throw new Error("Camera emitter was not initialized.");
        };
        const uploadNow = jest.fn(async () => { });
        const client = new BrowserProctoringClient({
            createQueue: (sessionId) => EventQueue.open(sessionId, {
                storage: new MemoryEventQueueStorage(sessionId),
            }),
            getUserMedia: jest.fn(async () => fakeStream()),
            createTransport: () => ({
                connect: jest.fn(async () => { }),
                sendEvent: jest.fn(async () => { }),
                onTerminate: jest.fn(() => jest.fn()),
                onHeartbeatRequired: jest.fn(() => jest.fn()),
                disconnect: jest.fn(),
            } as any),
            createCameraWorker: (emit) => {
                emitFromCamera = emit;
                return {
                    start: jest.fn(async () => { }),
                    stop: jest.fn(),
                } as any;
            },
            createSnapshotUploader: () => ({
                start: jest.fn(async () => { }),
                uploadNow,
                stop: jest.fn(),
            } as any),
        });

        await client.start({
            sessionId: "session-phone",
            jwt: "jwt",
            rulesPublic: {
                heartbeat_interval_ms: 5000,
                snapshot_interval_ms: 30000,
            },
            editorRoot: document.createElement("textarea"),
        });

        try {
            emitFromCamera({
                event_type: "object_detected",
                payload: { label: "cell phone", confidence: 0.91 },
            });
            await new Promise((resolve) => setTimeout(resolve, 0));
            await Promise.resolve();

            expect(uploadNow).toHaveBeenCalledWith("event_triggered", "session-phone-2");
        } finally {
            await client.stop();
        }
    });

    test("captures an event-triggered snapshot when a generic object is detected", async () => {
        let emitFromCamera: (event: ProctoringEventDraft) => void = () => {
            throw new Error("Camera emitter was not initialized.");
        };
        const uploadNow = jest.fn(async () => { });
        const client = new BrowserProctoringClient({
            createQueue: (sessionId) => EventQueue.open(sessionId, {
                storage: new MemoryEventQueueStorage(sessionId),
            }),
            getUserMedia: jest.fn(async () => fakeStream()),
            createTransport: () => ({
                connect: jest.fn(async () => { }),
                sendEvent: jest.fn(async () => { }),
                onTerminate: jest.fn(() => jest.fn()),
                onHeartbeatRequired: jest.fn(() => jest.fn()),
                disconnect: jest.fn(),
            } as any),
            createCameraWorker: (emit) => {
                emitFromCamera = emit;
                return {
                    start: jest.fn(async () => { }),
                    stop: jest.fn(),
                } as any;
            },
            createSnapshotUploader: () => ({
                start: jest.fn(async () => { }),
                uploadNow,
                stop: jest.fn(),
            } as any),
        });

        await client.start({
            sessionId: "session-object",
            jwt: "jwt",
            rulesPublic: {
                heartbeat_interval_ms: 5000,
                snapshot_interval_ms: 30000,
            },
            editorRoot: document.createElement("textarea"),
        });

        try {
            emitFromCamera({
                event_type: "object_detected",
                payload: { label: "object", confidence: 0.42 },
            });
            await new Promise((resolve) => setTimeout(resolve, 0));
            await Promise.resolve();

            expect(uploadNow).toHaveBeenCalledWith("event_triggered", "session-object-2");
        } finally {
            await client.stop();
        }
    });
});
