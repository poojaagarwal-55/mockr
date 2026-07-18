const { registerSecureOaSocketNamespace } = require("./socket.js");

const getUserMock = jest.fn();
jest.mock("../../lib/supabase.js", () => ({
    getSupabaseAdmin: () => ({
        auth: { getUser: getUserMock },
    }),
}));

function createNamespaceHarness() {
    let middleware = null;
    let connectionHandler = null;
    const room = {
        emit: jest.fn(),
        disconnectSockets: jest.fn(),
    };
    const namespace = {
        use: jest.fn((fn) => { middleware = fn; }),
        on: jest.fn((event, fn) => {
            if (event === "connection") connectionHandler = fn;
        }),
        to: jest.fn(() => room),
    };
    const io = { of: jest.fn(() => namespace) };
    return { io, namespace, room, get middleware() { return middleware; }, get connectionHandler() { return connectionHandler; } };
}

function createSocket() {
    const handlers = {};
    const socket = {
        id: "socket-1",
        handshake: {
            auth: {
                token: "token-1",
                sessionId: "88888888-8888-4888-8888-888888888888",
            },
            address: "203.0.113.10",
        },
        data: {},
        join: jest.fn(),
        emit: jest.fn(),
        on: jest.fn((event, fn) => { handlers[event] = fn; }),
    };
    return { socket, handlers };
}

describe("secure OA socket namespace", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        getUserMock.mockResolvedValue({
            data: { user: { id: "candidate-1", email: "candidate@example.com" } },
            error: null,
        });
    });

    test("rejects server-only event injection via socket ack", async () => {
        const prisma = {
            secureOaSession: {
                findFirst: jest.fn(async () => ({
                    id: "88888888-8888-4888-8888-888888888888",
                    candidateUserId: "candidate-1",
                    companyId: "company-1",
                    status: "active",
                })),
                findUnique: jest.fn(async () => ({
                    id: "88888888-8888-4888-8888-888888888888",
                    status: "active",
                    jobRoundId: "round-1",
                })),
            },
            proctoringEvent: {
                findMany: jest.fn(async () => []),
            },
        };
        const harness = createNamespaceHarness();
        registerSecureOaSocketNamespace(harness.io, prisma, {});

        const { socket, handlers } = createSocket();
        await new Promise((resolve, reject) => {
            harness.middleware(socket, (error) => error ? reject(error) : resolve(null));
        });
        harness.connectionHandler(socket);
        await handlers["proctoring:event"]({
            client_event_id: "evt-server-only",
            event_type: "heartbeat_gap",
            payload: { gap_ms: 16000 },
            client_timestamp: new Date().toISOString(),
        });

        expect(socket.emit).toHaveBeenCalledWith("proctoring:ack", {
            client_event_id: "evt-server-only",
            accepted: false,
        });
    });
});

export {};
