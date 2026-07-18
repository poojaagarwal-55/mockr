const Fastify = require("fastify");

const prismaMock = {
    secureOaSession: {
        findFirst: jest.fn(),
        update: jest.fn(),
    },
    proctoringEvent: {
        groupBy: jest.fn(),
        findMany: jest.fn(),
    },
    proctoringSnapshot: {
        findMany: jest.fn(),
    },
    jobRound: {
        findFirst: jest.fn(),
    },
};

const emitProctoringTerminateMock = jest.fn();
const disconnectProctoringSessionMock = jest.fn();

jest.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));
jest.mock("./access.js", () => ({
    requireCompanyWorkspaceAccess: jest.fn(async (request) => {
        request.company = { id: "company-1", role: "admin" };
    }),
}));
jest.mock("../services/proctoring/socket-bus.js", () => ({
    emitProctoringTerminate: emitProctoringTerminateMock,
    disconnectProctoringSession: disconnectProctoringSessionMock,
}));
jest.mock("../lib/r2.js", () => ({
    getPresignedDownloadUrl: jest.fn(async (key) => `https://signed.example/${key}`),
}));

const companySecureOaRoutes = require("./secure-oa.js").default;

async function createApp() {
    const app = Fastify();
    app.decorate("authenticate", async (request) => {
        request.user = { id: "company-user-1", email: "owner@example.com" };
    });
    await app.register(companySecureOaRoutes);
    return app;
}

function session() {
    return {
        id: "77777777-7777-4777-8777-777777777777",
        jobRoundId: "round-1",
        status: "active",
        candidate: {
            id: "candidate-1",
            fullName: "Candidate One",
            email: "candidate@example.com",
            avatarUrl: null,
        },
        jobRound: {
            id: "round-1",
            companyId: "company-1",
            roundType: "mock_oa",
        },
    };
}

describe("company secure OA routes", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test("company cannot read another company's session", async () => {
        prismaMock.secureOaSession.findFirst.mockResolvedValue(null);
        const app = await createApp();

        const response = await app.inject({
            method: "GET",
            url: "/companies/secure-oa/sessions/77777777-7777-4777-8777-777777777777",
        });

        expect(response.statusCode).toBe(404);
        await app.close();
    });

    test("manual termination broadcasts and disconnects the session room", async () => {
        prismaMock.secureOaSession.findFirst.mockResolvedValue(session());
        prismaMock.secureOaSession.update.mockResolvedValue({ id: session().id, status: "terminated" });
        const app = await createApp();

        const response = await app.inject({
            method: "POST",
            url: "/companies/secure-oa/sessions/77777777-7777-4777-8777-777777777777/terminate",
            payload: { reason: "Confirmed policy violation" },
        });

        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.body)).toEqual({ status: "terminated", terminatedReason: "manual_company" });
        expect(emitProctoringTerminateMock).toHaveBeenCalledWith(session().id, "manual_company");
        expect(disconnectProctoringSessionMock).toHaveBeenCalledWith(session().id);
        expect(prismaMock.secureOaSession.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                status: "terminated",
                terminatedReason: "manual_company",
            }),
        }));
        await app.close();
    });
});

export {};
