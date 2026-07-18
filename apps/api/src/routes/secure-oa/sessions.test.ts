const Fastify = require("fastify");

const rules = {
    thresholds: {
        heartbeat_interval_ms: 5000,
        snapshot_interval_ms: 30000,
        heartbeat_grace_ms: 15000,
        face_absent_terminate_ms: 30000,
        face_multiple_terminate_count: 2,
        max_tab_hidden_events: 3,
        max_fullscreen_exit_events: 2,
        max_paste_char_count_single: 200,
        max_paste_total_char_count: 500,
    },
    auto_terminate_on: ["webcam_revoked", "webcam_stream_ended", "multi_session_attempt"],
    auto_terminate_on_severity: "critical",
    integrity_score_weights: {},
    integrity_score_base: 100,
    integrity_score_floor: 0,
};

const prismaMock = {
    jobRound: { findUnique: jest.fn() },
    jobRoundCandidate: { findFirst: jest.fn() },
    secureOaSession: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
    },
    proctoringEvent: { findMany: jest.fn() },
    $transaction: jest.fn(),
};

const ingestServerEventMock = jest.fn(async () => ({ terminated: true }));
const ingestBatchMock = jest.fn();
const loadActiveProctoringRulesMock = jest.fn(async () => ({ id: "rules-1", rules }));
const disconnectProctoringSessionMock = jest.fn();

jest.mock("../../lib/prisma.js", () => ({ prisma: prismaMock }));
jest.mock("../../lib/r2.js", () => ({
    uploadPrivateObjectToR2: jest.fn(),
}));
jest.mock("../../services/proctoring/ingest.js", () => ({
    ProctoringIngestService: jest.fn().mockImplementation(() => ({
        ingestServerEvent: ingestServerEventMock,
        ingestBatch: ingestBatchMock,
    })),
    loadActiveProctoringRules: loadActiveProctoringRulesMock,
}));
jest.mock("../../services/proctoring/socket-bus.js", () => ({
    disconnectProctoringSession: disconnectProctoringSessionMock,
}));

const secureOaSessionRoutes = require("./sessions.js").default;

function createApp(userId = "candidate-1") {
    const app = Fastify();
    app.decorate("authenticate", async (request) => {
        request.user = { id: userId, email: `${userId}@example.com` };
    });
    return app.register(secureOaSessionRoutes);
}

function openRound() {
    return {
        id: "11111111-1111-4111-8111-111111111111",
        roundType: "mock_oa",
        companyId: "company-1",
        opensAt: new Date(Date.now() - 60_000),
        closesAt: new Date(Date.now() + 60_000),
        config: {
            onlineAssessment: {
                startAt: new Date(Date.now() - 60_000).toISOString(),
                endAt: new Date(Date.now() + 60_000).toISOString(),
            },
        },
    };
}

describe("secure OA candidate routes", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        prismaMock.jobRound.findUnique.mockResolvedValue(openRound());
        prismaMock.jobRoundCandidate.findFirst.mockResolvedValue({
            id: "22222222-2222-4222-8222-222222222222",
        });
        prismaMock.$transaction.mockImplementation(async (fn) => fn({
            secureOaSession: {
                create: jest.fn(async () => ({ id: "session-created", jobRoundId: openRound().id })),
                update: jest.fn(async () => ({ id: "session-created", jobRoundId: openRound().id })),
            },
            proctoringEvent: { findMany: jest.fn(async () => []) },
        }));
    });

    test("idempotent start returns an existing active session", async () => {
        prismaMock.secureOaSession.findUnique.mockResolvedValue({
            id: "33333333-3333-4333-8333-333333333333",
            status: "active",
            jobRoundId: openRound().id,
        });

        const app = await createApp();
        const response = await app.inject({
            method: "POST",
            url: `/secure-oa/sessions/${openRound().id}/start`,
            payload: {},
        });

        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.body).sessionId).toBe("33333333-3333-4333-8333-333333333333");
        expect(prismaMock.$transaction).not.toHaveBeenCalled();
        await app.close();
    });

    test("start rejects an existing abandoned session instead of reopening it", async () => {
        prismaMock.secureOaSession.findUnique.mockResolvedValue({
            id: "33333333-3333-4333-8333-333333333333",
            status: "abandoned",
            jobRoundId: openRound().id,
        });

        const app = await createApp();
        const response = await app.inject({
            method: "POST",
            url: `/secure-oa/sessions/${openRound().id}/start`,
            payload: {},
        });

        expect(response.statusCode).toBe(409);
        expect(JSON.parse(response.body)).toEqual(expect.objectContaining({
            code: "secure_oa_session_closed",
            sessionStatus: "abandoned",
        }));
        expect(prismaMock.$transaction).not.toHaveBeenCalled();
        await app.close();
    });

    test("start rejects a closed session found after a unique race", async () => {
        prismaMock.secureOaSession.findUnique
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({
                id: "33333333-3333-4333-8333-333333333333",
                status: "terminated",
                jobRoundId: openRound().id,
            });
        prismaMock.secureOaSession.findFirst.mockResolvedValue(null);
        prismaMock.$transaction.mockRejectedValue({ code: "P2002" });

        const app = await createApp();
        const response = await app.inject({
            method: "POST",
            url: `/secure-oa/sessions/${openRound().id}/start`,
            payload: {},
        });

        expect(response.statusCode).toBe(409);
        expect(JSON.parse(response.body)).toEqual(expect.objectContaining({
            code: "secure_oa_session_closed",
            sessionStatus: "terminated",
        }));
        await app.close();
    });

    test("multi-session conflict terminates the other active session and returns 409", async () => {
        prismaMock.secureOaSession.findUnique.mockResolvedValue(null);
        prismaMock.secureOaSession.findFirst.mockResolvedValue({
            id: "44444444-4444-4444-8444-444444444444",
        });

        const app = await createApp();
        const response = await app.inject({
            method: "POST",
            url: `/secure-oa/sessions/${openRound().id}/start`,
            payload: {},
        });

        expect(response.statusCode).toBe(409);
        expect(JSON.parse(response.body).code).toBe("multi_session_attempt");
        expect(ingestServerEventMock).toHaveBeenCalledWith(
            "44444444-4444-4444-8444-444444444444",
            expect.objectContaining({ event_type: "multi_session_attempt" })
        );
        expect(disconnectProctoringSessionMock).toHaveBeenCalledWith("44444444-4444-4444-8444-444444444444");
        await app.close();
    });

    test("submit computes score once and rejects a second submit", async () => {
        let sessionStatus = "active";
        prismaMock.secureOaSession.findUnique.mockImplementation(async (args) => {
            if (args.where.id) {
                return {
                    id: args.where.id,
                    status: sessionStatus,
                    jobRoundId: openRound().id,
                    candidateUserId: "candidate-1",
                    companyId: "company-1",
                    jobRoundCandidateId: "round-candidate-1",
                };
            }
            return null;
        });
        prismaMock.$transaction.mockImplementation(async (fn) => fn({
            proctoringEvent: {
                findMany: jest.fn(async () => []),
            },
            secureOaSession: {
                update: jest.fn(async (args) => {
                    sessionStatus = args.data.status;
                    return args.data;
                }),
            },
            proctoringRule: {
                findFirst: jest.fn(async () => ({ id: "rules-1", rules })),
            },
            jobRoundCandidate: {
                findUnique: jest.fn(async () => ({ metadata: {} })),
                update: jest.fn(async () => ({})),
            },
        }));

        const app = await createApp();
        const first = await app.inject({
            method: "POST",
            url: "/secure-oa/sessions/55555555-5555-4555-8555-555555555555/submit",
        });
        const second = await app.inject({
            method: "POST",
            url: "/secure-oa/sessions/55555555-5555-4555-8555-555555555555/submit",
        });

        expect(first.statusCode).toBe(200);
        expect(JSON.parse(first.body).status).toBe("submitted");
        expect(second.statusCode).toBe(400);
        expect(JSON.parse(second.body).code).toBe("session_not_active");
        await app.close();
    });

    test("candidate cannot send events to another candidate's session", async () => {
        prismaMock.secureOaSession.findUnique.mockResolvedValue({
            id: "66666666-6666-4666-8666-666666666666",
            status: "active",
            jobRoundId: openRound().id,
            candidateUserId: "candidate-1",
            companyId: "company-1",
            jobRoundCandidateId: "round-candidate-1",
        });

        const app = await createApp("candidate-2");
        const response = await app.inject({
            method: "POST",
            url: "/secure-oa/sessions/66666666-6666-4666-8666-666666666666/events",
            payload: {
                events: [{
                    client_event_id: "evt-1",
                    event_type: "session_heartbeat",
                    payload: { ts: Date.now() },
                    client_timestamp: new Date().toISOString(),
                }],
            },
        });

        expect(response.statusCode).toBe(403);
        expect(ingestBatchMock).not.toHaveBeenCalled();
        await app.close();
    });
});

export {};
