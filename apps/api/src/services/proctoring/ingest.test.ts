const { ProctoringIngestService } = require("./ingest.js");

const rules = {
    thresholds: {
        face_absent_terminate_ms: 30000,
        face_multiple_terminate_count: 2,
        max_tab_hidden_events: 3,
        max_fullscreen_exit_events: 2,
        max_paste_char_count_single: 200,
        max_paste_total_char_count: 500,
        heartbeat_interval_ms: 5000,
        heartbeat_grace_ms: 15000,
        snapshot_interval_ms: 30000,
    },
    auto_terminate_on: ["webcam_revoked", "webcam_stream_ended", "multi_session_attempt"],
    auto_terminate_on_severity: "critical",
    integrity_score_weights: {
        face_absent: 10,
        face_multiple: 25,
        face_looking_away: 3,
        object_detected: 20,
        tab_hidden: 8,
        window_blur: 2,
        fullscreen_exit: 15,
        devtools_opened: 30,
        paste: 5,
        heartbeat_gap: 5,
    },
    integrity_score_base: 100,
    integrity_score_floor: 0,
};

function input(clientEventId, eventType, payload) {
    return {
        client_event_id: clientEventId,
        event_type: eventType,
        payload,
        client_timestamp: new Date().toISOString(),
    };
}

function makePrisma({ status = "active", existing = [], previous = [] } = {}) {
    const state = {
        createdRows: [],
        sessionUpdates: [],
        eventUpdates: [],
        updateManyCalls: [],
    };

    const tx = {
        secureOaSession: {
            update: jest.fn(async (args) => {
                state.sessionUpdates.push(args);
                return { id: args.where.id, ...args.data };
            }),
        },
        proctoringEvent: {
            createMany: jest.fn(async (args) => {
                state.createdRows.push(...args.data);
                return { count: args.data.length };
            }),
            updateMany: jest.fn(async (args) => {
                state.updateManyCalls.push(args);
                return { count: args.where.id.in.length };
            }),
            update: jest.fn(async (args) => {
                state.eventUpdates.push(args);
                return { id: args.where.id, ...args.data };
            }),
        },
    };

    const prisma = {
        secureOaSession: {
            findUnique: jest.fn(async () => ({ id: "session-1", status, jobRoundId: "round-1" })),
        },
        proctoringRule: {
            findFirst: jest.fn(async (args) => {
                if (args.where.jobRoundId === "round-1") return null;
                return { id: "default-rules", rules };
            }),
        },
        proctoringEvent: {
            findMany: jest.fn(async (args) => {
                if (args.select?.clientEventId) {
                    return existing.map((clientEventId) => ({ clientEventId }));
                }
                return previous;
            }),
        },
        $transaction: jest.fn(async (fn) => fn(tx)),
    };

    return { prisma, state, tx };
}

describe("ProctoringIngestService", () => {
    test("rejects server-only event injection", async () => {
        const { prisma, state } = makePrisma();
        const service = new ProctoringIngestService(prisma, {});

        const result = await service.ingestBatch("session-1", [
            input("evt-1", "heartbeat_gap", { gap_ms: 16000 }),
        ], { source: "rest", ip: "203.0.113.1" });

        expect(result.accepted).toEqual([]);
        expect(result.rejected).toEqual([{ client_event_id: "evt-1", reason: "server_only_event_type" }]);
        expect(state.createdRows).toHaveLength(0);
    });

    test("mid-batch termination stops persisting events after the terminator", async () => {
        const { prisma, state } = makePrisma();
        const emitTerminate = jest.fn();
        const service = new ProctoringIngestService(prisma, { emitTerminate });

        const result = await service.ingestBatch("session-1", [
            input("evt-1", "session_heartbeat", { ts: Date.now() }),
            input("evt-2", "window_blur", { duration_ms: 500 }),
            input("evt-3", "webcam_revoked", {}),
            input("evt-4", "paste", { char_count: 20 }),
            input("evt-5", "tab_hidden", { duration_ms: 1000 }),
        ], { source: "rest", ip: "203.0.113.1" });

        expect(result.accepted).toEqual(["evt-1", "evt-2", "evt-3"]);
        expect(result.rejected).toEqual([
            { client_event_id: "evt-4", reason: "session_terminated_mid_batch" },
            { client_event_id: "evt-5", reason: "session_terminated_mid_batch" },
        ]);
        expect(result.terminated).toBe(true);
        expect(result.terminationReason).toBe("webcam_revoked");
        expect(state.createdRows.map((row) => row.clientEventId)).toEqual(["evt-1", "evt-2", "evt-3"]);
        expect(state.sessionUpdates[0].data.status).toBe("terminated");
        expect(state.eventUpdates[0].data.triggeredTermination).toBe(true);
        expect(emitTerminate).toHaveBeenCalledWith("session-1", "webcam_revoked");
    });

    test("rejects every event when the session is not active", async () => {
        const { prisma, state } = makePrisma({ status: "submitted" });
        const service = new ProctoringIngestService(prisma, {});

        const result = await service.ingestBatch("session-1", [
            input("evt-1", "session_heartbeat", { ts: Date.now() }),
        ], { source: "rest", ip: "203.0.113.1" });

        expect(result).toMatchObject({
            accepted: [],
            rejected: [{ client_event_id: "evt-1", reason: "session_not_active" }],
            sessionStatus: "submitted",
        });
        expect(state.createdRows).toHaveLength(0);
    });

    test("dedupes using one batch lookup before insert", async () => {
        const { prisma, state } = makePrisma({ existing: ["evt-2"] });
        const service = new ProctoringIngestService(prisma, {});

        const result = await service.ingestBatch("session-1", [
            input("evt-1", "session_heartbeat", { ts: Date.now() }),
            input("evt-2", "window_blur", { duration_ms: 500 }),
        ], { source: "rest", ip: "203.0.113.1" });

        expect(prisma.proctoringEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                clientEventId: { in: ["evt-1", "evt-2"] },
            }),
            select: { clientEventId: true },
        }));
        expect(result.accepted).toEqual(["evt-1"]);
        expect(result.rejected).toEqual([{ client_event_id: "evt-2", reason: "duplicate_event" }]);
        expect(state.createdRows.map((row) => row.clientEventId)).toEqual(["evt-1"]);
    });
});

export {};
