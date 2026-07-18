const { runProctoringHeartbeatPass } = require("./watchdog.js");

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
    integrity_score_weights: { heartbeat_gap: 5 },
    integrity_score_base: 100,
    integrity_score_floor: 0,
};

function makePrisma() {
    const startedAt = new Date("2026-05-29T08:00:00.000Z");
    const state = { events: [], sessionUpdates: [] };
    const tx = {
        secureOaSession: {
            update: jest.fn(async (args) => {
                state.sessionUpdates.push(args);
                return args.data;
            }),
        },
        proctoringEvent: {
            createMany: jest.fn(async (args) => {
                state.events.push(...args.data);
                return { count: args.data.length };
            }),
            updateMany: jest.fn(async () => ({ count: 1 })),
            update: jest.fn(async (args) => args.data),
        },
    };

    const prisma = {
        secureOaSession: {
            findMany: jest.fn(async () => [{ id: "session-1", startedAt }]),
            findUnique: jest.fn(async () => ({ id: "session-1", status: "active", jobRoundId: "round-1" })),
            update: jest.fn(async (args) => {
                state.sessionUpdates.push(args);
                return args.data;
            }),
        },
        proctoringRule: {
            findFirst: jest.fn(async () => ({ id: "default", rules })),
        },
        proctoringEvent: {
            groupBy: jest.fn(async (args) => {
                if (args._max) {
                    if (!state.events.length) return [];
                    const latest = state.events.reduce((max, event) =>
                        event.serverTimestamp > max ? event.serverTimestamp : max,
                        state.events[0].serverTimestamp
                    );
                    return [{ sessionId: "session-1", _max: { serverTimestamp: latest } }];
                }
                if (args.where.eventType === "heartbeat_gap") {
                    return state.events.some((event) => event.eventType === "heartbeat_gap")
                        ? [{ sessionId: "session-1", _count: { _all: 1 } }]
                        : [];
                }
                return [];
            }),
            findMany: jest.fn(async (args) => {
                if (args.select?.clientEventId) return [];
                return state.events;
            }),
        },
        $transaction: jest.fn(async (fn) => fn(tx)),
    };
    return { prisma, state };
}

describe("proctoring watchdog", () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date("2026-05-29T08:00:20.000Z"));
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test("inserts heartbeat_gap only once for the same gap", async () => {
        const { prisma, state } = makePrisma();

        const first = await runProctoringHeartbeatPass(prisma, {});
        const second = await runProctoringHeartbeatPass(prisma, {});

        expect(first.heartbeatGaps).toBe(1);
        expect(second.heartbeatGaps).toBe(0);
        expect(state.events.filter((event) => event.eventType === "heartbeat_gap")).toHaveLength(1);
    });
});

export {};
