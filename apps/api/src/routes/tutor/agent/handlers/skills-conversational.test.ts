const { TutorArtifactType } = require("@prisma/client");

const prismaMock = {
    tutorArtifact: {
        findFirst: jest.fn(),
        update: jest.fn(),
    },
    tutorConversation: {
        findFirst: jest.fn(),
    },
    evaluationReport: {
        findFirst: jest.fn(),
    },
    acceptedActionPlan: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
    },
    questionSheet: {
        findUnique: jest.fn(),
        create: jest.fn(),
    },
};

jest.mock("../../../../lib/prisma.js", () => ({
    prisma: prismaMock,
}));

const { handleCommitArtifact } = require("./skills-conversational.js");

describe("handleCommitArtifact", () => {
    beforeEach(() => {
        jest.resetAllMocks();
    });

    test("creates an accepted action plan when committing an action plan draft", async () => {
        prismaMock.tutorArtifact.findFirst.mockResolvedValue({
            id: "draft-1",
            title: "30-Day Prep Plan",
            artifactType: TutorArtifactType.ACTION_PLAN,
            meta: { isDraft: true },
            content: {},
            conversationId: "conv-1",
        });

        prismaMock.tutorArtifact.update.mockResolvedValue({
            id: "draft-1",
            title: "30-Day Prep Plan",
            artifactType: TutorArtifactType.ACTION_PLAN,
            content: {
                totalDays: 14,
                plannedDays: [
                    {
                        day: 1,
                        focus: "Arrays",
                        questionCount: 1,
                        questionTags: [{ category: "coding_questions", count: 1 }],
                        questions: [
                            {
                                id: "dsa-abc123",
                                title: "Two Sum",
                                category: "coding_questions",
                                solveUrl: "/questions/dsa/solve?id=abc123",
                            },
                        ],
                    },
                ],
            },
            updatedAt: new Date("2026-05-01T10:00:00.000Z"),
        });

        prismaMock.tutorConversation.findFirst.mockResolvedValue({
            reportId: "report-1",
        });

        prismaMock.evaluationReport.findFirst.mockResolvedValue({
            id: "report-1",
            sessionId: "session-1",
            generatedAt: new Date("2026-05-01T00:00:00.000Z"),
            session: { type: "coding", level: "mid" },
        });

        prismaMock.acceptedActionPlan.findFirst.mockResolvedValue(null);
        prismaMock.acceptedActionPlan.create.mockResolvedValue({ id: "plan-1" });

        await handleCommitArtifact("user-1", { draftId: "draft-1" });

        expect(prismaMock.acceptedActionPlan.create).toHaveBeenCalledTimes(1);
        const payload = prismaMock.acceptedActionPlan.create.mock.calls[0][0].data;
        expect(payload.reportId).toBe("report-1");
        expect(payload.sessionId).toBe("session-1");
        expect(payload.timespan).toBe("2_weeks");
        expect(payload.actionPlan.plannedDays).toHaveLength(1);
    });

    test("refreshes an expired accepted action plan when committing a new draft", async () => {
        prismaMock.tutorArtifact.findFirst.mockResolvedValue({
            id: "draft-3",
            title: "Fresh 7-Day Prep Plan",
            artifactType: TutorArtifactType.ACTION_PLAN,
            meta: { isDraft: true },
            content: {},
            conversationId: "conv-3",
        });

        prismaMock.tutorArtifact.update.mockResolvedValue({
            id: "draft-3",
            title: "Fresh 7-Day Prep Plan",
            artifactType: TutorArtifactType.ACTION_PLAN,
            content: {
                totalDays: 7,
                plannedDays: [
                    {
                        day: 1,
                        focus: "Graphs",
                        questionCount: 1,
                        questionTags: [{ category: "coding_questions", count: 1 }],
                        questions: [
                            {
                                id: "dsa-xyz789",
                                title: "Number of Islands",
                                category: "coding_questions",
                                solveUrl: "/questions/dsa/solve?id=xyz789",
                            },
                        ],
                    },
                ],
            },
            updatedAt: new Date("2026-05-01T11:00:00.000Z"),
        });

        prismaMock.tutorConversation.findFirst.mockResolvedValue({
            reportId: "report-3",
        });

        prismaMock.evaluationReport.findFirst.mockResolvedValue({
            id: "report-3",
            sessionId: "session-3",
            generatedAt: new Date("2026-05-01T00:00:00.000Z"),
            session: { type: "coding", level: "mid" },
        });

        prismaMock.acceptedActionPlan.findFirst.mockResolvedValue({
            id: "plan-expired",
            startDate: new Date("2026-03-01T00:00:00.000Z"),
            endDate: new Date("2026-03-07T23:59:59.999Z"),
            totalDays: 7,
            currentDay: 4,
            completedDays: [1, 2, 3],
            completedQuestions: ["dsa-old-1"],
            actionPlan: {
                plannedDays: [
                    {
                        day: 1,
                        focus: "Old Topic",
                        questionCount: 1,
                        questionTags: [],
                        questions: [],
                    },
                ],
            },
        });
        prismaMock.acceptedActionPlan.update.mockResolvedValue({ id: "plan-expired" });

        await handleCommitArtifact("user-1", { draftId: "draft-3" });

        expect(prismaMock.acceptedActionPlan.create).not.toHaveBeenCalled();
        expect(prismaMock.acceptedActionPlan.update).toHaveBeenCalledTimes(1);
        const payload = prismaMock.acceptedActionPlan.update.mock.calls[0][0];
        expect(payload.where).toEqual({ id: "plan-expired" });
        expect(payload.data.currentDay).toBe(1);
        expect(payload.data.completedDays).toEqual([]);
        expect(payload.data.completedQuestions).toEqual([]);
        expect(payload.data.totalDays).toBe(7);
        expect(payload.data.actionPlan.plannedDays).toHaveLength(1);
    });

    test("creates a question sheet when committing a question sheet draft", async () => {
        prismaMock.tutorArtifact.findFirst.mockResolvedValue({
            id: "draft-2",
            title: "Arrays Practice",
            artifactType: TutorArtifactType.QUESTION_SHEET,
            meta: { isDraft: true },
            content: {},
            conversationId: "conv-2",
        });

        prismaMock.tutorArtifact.update.mockResolvedValue({
            id: "draft-2",
            title: "Arrays Practice",
            artifactType: TutorArtifactType.QUESTION_SHEET,
            content: {
                questions: [
                    {
                        id: "abc123",
                        title: "Two Sum",
                        difficulty: "easy",
                        topics: ["Array"],
                        rationale: "Targets your array weak spot.",
                    },
                ],
            },
            updatedAt: new Date("2026-05-01T10:00:00.000Z"),
        });

        prismaMock.tutorConversation.findFirst.mockResolvedValue({
            reportId: "report-2",
        });

        prismaMock.evaluationReport.findFirst.mockResolvedValue({
            id: "report-2",
            sessionId: "session-2",
            generatedAt: new Date("2026-05-01T00:00:00.000Z"),
            session: { type: "coding", level: "mid" },
        });

        prismaMock.questionSheet.findUnique.mockResolvedValue(null);
        prismaMock.questionSheet.create.mockResolvedValue({ id: "sheet-1" });

        await handleCommitArtifact("user-1", { draftId: "draft-2" });

        expect(prismaMock.questionSheet.create).toHaveBeenCalledTimes(1);
        const payload = prismaMock.questionSheet.create.mock.calls[0][0].data;
        expect(payload.reportId).toBe("report-2");
        expect(payload.sessionId).toBe("session-2");
        expect(payload.questions[0].id).toBe("dsa-abc123");
        expect(payload.questions[0].category).toBe("array");
        expect(payload.progress["dsa-abc123"].status).toBe("unattempted");
    });
});
