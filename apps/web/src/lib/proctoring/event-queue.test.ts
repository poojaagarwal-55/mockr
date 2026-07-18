import { EventQueue, MemoryEventQueueStorage } from "./event-queue";
import type { ProctoringEventInput } from "@interviewforge/shared";

describe("EventQueue", () => {
    test("enqueues events with monotonic client_event_ids", async () => {
        const queue = await EventQueue.open("session-a", {
            storage: new MemoryEventQueueStorage("session-a"),
        });

        const first = await queue.enqueue({
            event_type: "session_heartbeat",
            payload: { ts: 1 },
        });
        const second = await queue.enqueue({
            event_type: "copy",
            payload: { char_count: 4 },
        });

        expect(first.client_event_id).toBe("session-a-1");
        expect(second.client_event_id).toBe("session-a-2");
        expect(await queue.peek()).toEqual([first, second]);
    });

    test("dedupes prepared events by client_event_id", async () => {
        const queue = await EventQueue.open("session-b", {
            storage: new MemoryEventQueueStorage("session-b"),
        });
        const event: ProctoringEventInput = {
            client_event_id: "session-b-fixed",
            event_type: "paste",
            payload: { char_count: 20 },
            client_timestamp: new Date().toISOString(),
        };

        await queue.enqueuePrepared(event);
        await queue.enqueuePrepared(event);

        expect(await queue.size()).toBe(1);
        expect(await queue.peek()).toEqual([event]);
    });

    test("enforces cap by dropping the oldest droppable event", async () => {
        const queue = await EventQueue.open("session-c", {
            storage: new MemoryEventQueueStorage("session-c"),
            cap: 3,
        });

        await queue.enqueue({ event_type: "session_heartbeat", payload: { ts: 1 } });
        await queue.enqueue({ event_type: "window_blur", payload: { duration_ms: 10 } });
        await queue.enqueue({ event_type: "contextmenu", payload: {} });
        const retained = await queue.enqueue({ event_type: "copy", payload: { char_count: 2 } });

        const queued = await queue.peek();
        expect(queued).toHaveLength(3);
        expect(queued.map((event) => event.event_type)).toEqual(["window_blur", "contextmenu", "copy"]);
        expect(queued.at(-1)).toEqual(retained);
    });

    test("does not drop critical webcam events to satisfy the cap", async () => {
        const queue = await EventQueue.open("session-d", {
            storage: new MemoryEventQueueStorage("session-d"),
            cap: 1,
        });

        await queue.enqueue({ event_type: "copy", payload: { char_count: 2 } });
        await queue.enqueue({ event_type: "webcam_revoked", payload: {} });

        const queued = await queue.peek();
        expect(queued.map((event) => event.event_type)).toEqual(["copy", "webcam_revoked"]);
    });

    test("markAccepted and markRejected remove acknowledged events", async () => {
        const queue = await EventQueue.open("session-e", {
            storage: new MemoryEventQueueStorage("session-e"),
        });
        const accepted = await queue.enqueue({ event_type: "copy", payload: { char_count: 1 } });
        const rejected = await queue.enqueue({ event_type: "paste", payload: { char_count: 1 } });

        await queue.markAccepted([accepted.client_event_id]);
        await queue.markRejected([rejected.client_event_id]);

        expect(await queue.size()).toBe(0);
    });
});
