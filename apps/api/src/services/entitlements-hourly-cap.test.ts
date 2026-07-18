jest.mock("../lib/prisma.js", () => ({
    prisma: {
        hourlySubmissionCounter: {
            updateMany: jest.fn(),
            findUnique: jest.fn(),
            create: jest.fn(),
        },
    },
}));

jest.mock("@interviewforge/shared", () => ({
    PLAN_ENTITLEMENTS: {
        FREE: { dsaSubmitSuccessPerHourPerQuestion: 0 },
        PLUS: { dsaSubmitSuccessPerHourPerQuestion: 10 },
        PRO: { dsaSubmitSuccessPerHourPerQuestion: 10 },
        MAX: { dsaSubmitSuccessPerHourPerQuestion: 10 },
    },
    getEntitlements: jest.fn(),
    interviewMinuteCost: jest.fn(),
}));

import { prisma } from "../lib/prisma.js";
import {
    EntitlementError,
    requireHourlySubmitCapAndIncrement,
} from "./entitlements.js";

const counter = prisma.hourlySubmissionCounter as unknown as {
    updateMany: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
};

describe("requireHourlySubmitCapAndIncrement", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("increments an existing counter with a guarded atomic update", async () => {
        counter.updateMany.mockResolvedValueOnce({ count: 1 });

        await expect(
            requireHourlySubmitCapAndIncrement("user-1", "question-1", "PLUS")
        ).resolves.toBeUndefined();

        expect(counter.updateMany).toHaveBeenCalledWith({
            where: {
                userId: "user-1",
                questionId: "question-1",
                hourBucket: expect.any(Date),
                successCount: { lt: 10 },
            },
            data: { successCount: { increment: 1 } },
        });
        expect(counter.findUnique).not.toHaveBeenCalled();
        expect(counter.create).not.toHaveBeenCalled();
    });

    it("creates the hourly counter for the first accepted submission", async () => {
        counter.updateMany.mockResolvedValueOnce({ count: 0 });
        counter.findUnique.mockResolvedValueOnce(null);
        counter.create.mockResolvedValueOnce({});

        await expect(
            requireHourlySubmitCapAndIncrement("user-1", "question-1", "PLUS")
        ).resolves.toBeUndefined();

        expect(counter.create).toHaveBeenCalledWith({
            data: {
                userId: "user-1",
                questionId: "question-1",
                hourBucket: expect.any(Date),
                successCount: 1,
            },
        });
    });

    it("retries the guarded increment when another request creates the row first", async () => {
        counter.updateMany
            .mockResolvedValueOnce({ count: 0 })
            .mockResolvedValueOnce({ count: 1 });
        counter.findUnique.mockResolvedValueOnce(null);
        counter.create.mockRejectedValueOnce({ code: "P2002" });

        await expect(
            requireHourlySubmitCapAndIncrement("user-1", "question-1", "PLUS")
        ).resolves.toBeUndefined();

        expect(counter.updateMany).toHaveBeenCalledTimes(2);
    });

    it("throws an entitlement error when the hourly limit is already reached", async () => {
        counter.updateMany.mockResolvedValueOnce({ count: 0 });
        counter.findUnique.mockResolvedValueOnce({ successCount: 10 });

        await expect(
            requireHourlySubmitCapAndIncrement("user-1", "question-1", "PLUS")
        ).rejects.toMatchObject<Partial<EntitlementError>>({
            code: "HOURLY_SUBMIT_LIMIT",
            statusCode: 429,
        });
    });
});
