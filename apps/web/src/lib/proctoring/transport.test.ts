import { EventQueue, MemoryEventQueueStorage } from "./event-queue";
import { Transport } from "./transport";
import type { ProctoringIngestResponse } from "./types";

class FakeSocket {
    connected = false;
    handlers = new Map<string, Array<(payload?: any) => void>>();
    emitted: Array<{ event: string; payload: any }> = [];

    on(event: string, handler: (payload?: any) => void) {
        const handlers = this.handlers.get(event) ?? [];
        handlers.push(handler);
        this.handlers.set(event, handlers);
        return this;
    }

    emit(event: string, payload: any) {
        this.emitted.push({ event, payload });
        return this;
    }

    removeAllListeners() {
        this.handlers.clear();
        return this;
    }

    disconnect() {
        this.connected = false;
        this.trigger("disconnect");
        return this;
    }

    trigger(event: string, payload?: any) {
        if (event === "connect") this.connected = true;
        if (event === "disconnect") this.connected = false;
        for (const handler of this.handlers.get(event) ?? []) {
            handler(payload);
        }
    }
}

async function createQueue(sessionId = "session-transport") {
    return EventQueue.open(sessionId, {
        storage: new MemoryEventQueueStorage(sessionId),
    });
}

function okResponse(accepted: string[] = []): ProctoringIngestResponse {
    return { accepted, rejected: [], sessionStatus: "active", terminated: false };
}

async function flushMicrotasks() {
    await Promise.resolve();
    await Promise.resolve();
}

describe("Transport", () => {
    test("sends events over the socket happy path", async () => {
        const queue = await createQueue();
        const socket = new FakeSocket();
        const socketFactory = jest.fn(() => socket as any) as any;
        const transport = new Transport(queue, {
            socketFactory,
            fetchEvents: jest.fn(async () => okResponse()),
        });

        await transport.connect("session-transport", "Bearer jwt");
        socket.trigger("connect");
        await flushMicrotasks();

        const event = await queue.enqueue({ event_type: "copy", payload: { char_count: 3 } });
        await transport.sendEvent(event);

        expect(socket.emitted).toEqual([{ event: "proctoring:event", payload: event }]);
        expect(socketFactory).toHaveBeenCalledWith(expect.stringContaining("/secure-oa"), expect.objectContaining({
            auth: { token: "jwt", sessionId: "session-transport" },
        }));
        transport.disconnect();
    });

    test("uses REST fallback when the socket is disconnected", async () => {
        const queue = await createQueue();
        const event = await queue.enqueue({ event_type: "paste", payload: { char_count: 7 } });
        const fetchEvents = jest.fn(async () => okResponse([event.client_event_id]));
        const transport = new Transport(queue, {
            socketFactory: jest.fn(() => new FakeSocket() as any) as any,
            fetchEvents,
        });

        await transport.connect("session-transport", "Bearer jwt");
        await transport.sendEvent(event);
        await flushMicrotasks();

        expect(fetchEvents).toHaveBeenCalledWith("/secure-oa/sessions/session-transport/events", expect.objectContaining({
            token: "jwt",
        }));
        expect(await queue.size()).toBe(0);
        transport.disconnect();
    });

    test("drains queued events with REST on reconnect before socket mode resumes", async () => {
        const queue = await createQueue();
        const event = await queue.enqueue({ event_type: "copy", payload: { char_count: 5 } });
        const socket = new FakeSocket();
        const fetchEvents = jest.fn(async () => okResponse([event.client_event_id]));
        const transport = new Transport(queue, {
            socketFactory: jest.fn(() => socket as any) as any,
            fetchEvents,
        });

        await transport.connect("session-transport", "jwt");
        socket.trigger("connect");
        await flushMicrotasks();

        expect(fetchEvents).toHaveBeenCalledTimes(1);
        expect(await queue.size()).toBe(0);
        transport.disconnect();
    });

    test("socket ack removes accepted events", async () => {
        const queue = await createQueue();
        const socket = new FakeSocket();
        const transport = new Transport(queue, {
            socketFactory: jest.fn(() => socket as any) as any,
            fetchEvents: jest.fn(async () => okResponse()),
        });

        await transport.connect("session-transport", "jwt");
        socket.trigger("connect");
        await flushMicrotasks();
        const event = await queue.enqueue({ event_type: "cut", payload: { char_count: 1 } });
        await transport.sendEvent(event);
        socket.trigger("proctoring:ack", { client_event_id: event.client_event_id, accepted: true });
        await flushMicrotasks();

        expect(await queue.size()).toBe(0);
        transport.disconnect();
    });

    test("terminate event notifies listeners and stops sending", async () => {
        const queue = await createQueue();
        const socket = new FakeSocket();
        const listener = jest.fn();
        const transport = new Transport(queue, {
            socketFactory: jest.fn(() => socket as any) as any,
            fetchEvents: jest.fn(async () => okResponse()),
        });

        transport.onTerminate(listener);
        await transport.connect("session-transport", "jwt");
        socket.trigger("proctoring:terminate", { reason: "webcam_revoked" });
        const event = await queue.enqueue({ event_type: "copy", payload: { char_count: 1 } });
        await transport.sendEvent(event);

        expect(listener).toHaveBeenCalledWith("webcam_revoked");
        expect(socket.emitted).toEqual([]);
    });
});
