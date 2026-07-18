import Fastify from "fastify";

const skillProfileFindUniqueMock = jest.fn();
const skillProfileCreateMock = jest.fn();
const sessionFindFirstMock = jest.fn();
const sessionFindUniqueMock = jest.fn();
const sessionCreateMock = jest.fn();
const sessionParticipantCreateMock = jest.fn();
const queueTicketCreateMock = jest.fn();
const questionAssignmentFindFirstMock = jest.fn();
const questionAssignmentFindManyMock = jest.fn();
const questionAssignmentCreateMock = jest.fn();
const redisZaddMock = jest.fn();
const dsaCountDocumentsMock = jest.fn();
const dsaFindOneMock = jest.fn();

jest.mock("@interviewforge/shared", () => {
    const { z } = require("zod");
    const SupportedLanguageSchema = z.enum(["python", "javascript", "typescript", "java", "cpp", "go"]);
    const PeerLevelSchema = z.enum(["beginner", "intermediate", "advanced"]);
    const PeerInterviewTypeSchema = z.enum(["coding", "system_design", "behavioural"]);
    const PeerTimingPresetSchema = z.enum(["standard_45", "intense_30", "deep_60"]);

    return {
        CreatePeerBookingSchema: z.object({
            interviewType: PeerInterviewTypeSchema.default("coding"),
            preferredLanguage: SupportedLanguageSchema,
            timingPreset: PeerTimingPresetSchema.default("standard_45"),
            scheduledFor: z.string().datetime(),
            timeZone: z.string().min(1).max(100).optional(),
        }),
        CreatePeerInviteSchema: z.object({
            interviewType: PeerInterviewTypeSchema.default("coding"),
            preferredLanguage: SupportedLanguageSchema,
            timingPreset: PeerTimingPresetSchema.default("standard_45"),
            maxUses: z.number().int().min(1).max(5).default(1),
            expiresInSeconds: z.number().int().min(300).max(86_400).default(3600),
        }),
        PEER_TIMING_PRESETS: {
            standard_45: { totalSeconds: 45 * 60 },
            intense_30: { totalSeconds: 30 * 60 },
            deep_60: { totalSeconds: 60 * 60 },
        },
        PeerLevelSchema,
        SubmitPeerFeedbackSchema: z.object({
            problemSolving: z.number().int().min(1).max(5),
            communication: z.number().int().min(1).max(5),
            codeQuality: z.number().int().min(1).max(5),
            interviewing: z.number().int().min(1).max(5),
            overallRating: z.number().int().min(1).max(5),
            wouldMatchAgain: z.boolean(),
            whatWentWell: z.string().max(1200).optional(),
            improvementAreas: z.string().max(1200).optional(),
        }),
    };
});

jest.mock("../lib/prisma.js", () => ({
    prisma: {
        peer_skill_profiles: {
            findUnique: skillProfileFindUniqueMock,
            create: skillProfileCreateMock,
        },
        peer_sessions: {
            findFirst: sessionFindFirstMock,
            findUnique: sessionFindUniqueMock,
            create: sessionCreateMock,
        },
        peer_session_participants: {
            create: sessionParticipantCreateMock,
        },
        peer_queue_tickets: {
            create: queueTicketCreateMock,
        },
        peer_session_question_assignments: {
            findFirst: questionAssignmentFindFirstMock,
            findMany: questionAssignmentFindManyMock,
            create: questionAssignmentCreateMock,
        },
    },
}));

jest.mock("../lib/redis.js", () => ({
    getRedis: () => ({
        zadd: redisZaddMock,
    }),
}));

jest.mock("../models/DSAQuestion.js", () => ({
    DSAQuestion: {
        countDocuments: dsaCountDocumentsMock,
        findOne: dsaFindOneMock,
    },
}));

import p2pRoutes from "./p2p.js";

describe("P2P booking flow", () => {
    function nextUtcSlot(): Date {
        const slot = new Date(Date.now() + 24 * 60 * 60_000);
        slot.setUTCHours(9, 0, 0, 0);
        if (slot.getTime() <= Date.now() + 30_000) {
            slot.setUTCDate(slot.getUTCDate() + 1);
        }
        return slot;
    }

    async function buildApp(userId = "user-1") {
        const fastify = Fastify();
        fastify.decorate("authenticate", async (request: any) => {
            request.user = { id: userId };
        });
        await fastify.register(p2pRoutes);
        return fastify;
    }

    beforeEach(() => {
        jest.clearAllMocks();

        skillProfileFindUniqueMock.mockResolvedValue({
            id: "profile-1",
            user_id: "user-1",
            current_level: "intermediate",
            score: 62,
            sessions_rated: 3,
            updated_at: new Date(),
        });
        skillProfileCreateMock.mockResolvedValue({
            id: "profile-created",
            user_id: "user-1",
            current_level: "beginner",
            score: 40,
            sessions_rated: 0,
            updated_at: new Date(),
        });
        sessionFindFirstMock.mockResolvedValue(null);
        sessionFindUniqueMock.mockResolvedValue(null);
        sessionCreateMock.mockImplementation(async ({ data }: any) => ({
            ...data,
            id: data.id || "session-1",
            room_id: data.room_id || "room-1",
        }));
        sessionParticipantCreateMock.mockResolvedValue({ id: "participant-1" });
        queueTicketCreateMock.mockResolvedValue({ id: "queue-ticket-1" });
        questionAssignmentFindFirstMock.mockResolvedValue(null);
        questionAssignmentFindManyMock.mockResolvedValue([]);
        questionAssignmentCreateMock.mockResolvedValue({
            id: "assignment-1",
            question_id: "question-1",
            question_title: "Two Sum",
            question_category: "arrays",
            question_difficulty: "Easy",
        });
        redisZaddMock.mockResolvedValue(1);
        dsaCountDocumentsMock.mockResolvedValue(1);
        dsaFindOneMock.mockReturnValue({
            select: () => ({
                skip: () => ({
                    lean: async () => ({
                        _id: "question-1",
                        problemId: "two-sum",
                        title: "Two Sum",
                        difficulty: "Easy",
                        topics: ["arrays"],
                    }),
                }),
            }),
        });
    });

    test("accumulates a booked slot without matching immediately", async () => {
        const fastify = await buildApp();
        const scheduledFor = nextUtcSlot();

        const response = await fastify.inject({
            method: "POST",
            url: "/p2p/bookings",
            payload: {
                interviewType: "coding",
                preferredLanguage: "typescript",
                timingPreset: "deep_60",
                scheduledFor: scheduledFor.toISOString(),
                timeZone: "UTC",
            },
        });

        expect(response.statusCode).toBe(201);
        expect(sessionCreateMock).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    source: "scheduled",
                    status: "PENDING",
                    scheduled_for: scheduledFor,
                    created_by_user_id: "user-1",
                }),
            })
        );
        expect(sessionParticipantCreateMock).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    user_id: "user-1",
                    participant_role: "candidate",
                    level_at_match: "intermediate",
                    preferred_language: "typescript",
                }),
            })
        );
        expect(queueTicketCreateMock).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    user_id: "user-1",
                    status: "scheduled",
                    matched_session_id: expect.any(String),
                    preferred_language: "typescript",
                }),
            })
        );
        expect(redisZaddMock).toHaveBeenCalledWith(
            `slot:${scheduledFor.getTime()}:lang:typescript`,
            62,
            "user-1"
        );
        expect(response.json()).toEqual(
            expect.objectContaining({
                status: "PENDING",
                prepQuestion: expect.objectContaining({
                    title: "Two Sum",
                    practiceUrl: "/questions/dsa/solve?id=question-1",
                }),
            })
        );

        await fastify.close();
    });

    test("accepts near-future non-hourly dev test slot", async () => {
        const fastify = await buildApp();
        const scheduledFor = new Date(Date.now() + 2 * 60_000);

        const response = await fastify.inject({
            method: "POST",
            url: "/p2p/bookings",
            payload: {
                interviewType: "coding",
                preferredLanguage: "typescript",
                timingPreset: "deep_60",
                scheduledFor: scheduledFor.toISOString(),
                timeZone: "UTC",
            },
        });

        expect(response.statusCode).toBe(201);
        expect(sessionCreateMock).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    source: "scheduled",
                    status: "PENDING",
                    scheduled_for: scheduledFor,
                }),
            })
        );
        expect(redisZaddMock).toHaveBeenCalledWith(
            `slot:${scheduledFor.getTime()}:lang:typescript`,
            62,
            "user-1"
        );

        await fastify.close();
    });

    test("rejects duplicate active bookings for the same slot", async () => {
        const fastify = await buildApp();
        const scheduledFor = nextUtcSlot();
        sessionFindFirstMock.mockResolvedValueOnce({ id: "existing-session" });

        const response = await fastify.inject({
            method: "POST",
            url: "/p2p/bookings",
            payload: {
                interviewType: "coding",
                preferredLanguage: "python",
                timingPreset: "deep_60",
                scheduledFor: scheduledFor.toISOString(),
                timeZone: "UTC",
            },
        });

        expect(response.statusCode).toBe(409);
        expect(sessionCreateMock).not.toHaveBeenCalled();
        expect(queueTicketCreateMock).not.toHaveBeenCalled();
        expect(redisZaddMock).not.toHaveBeenCalled();

        await fastify.close();
    });

    test("blocks manual joining of scheduled slots before the batch matcher runs", async () => {
        const fastify = await buildApp("user-2");
        sessionFindUniqueMock.mockResolvedValueOnce({
            id: "session-1",
            source: "scheduled",
            status: "PENDING",
            peer_session_participants: [
                {
                    id: "participant-1",
                    user_id: "user-1",
                    created_at: new Date(),
                },
            ],
        });

        const response = await fastify.inject({
            method: "POST",
            url: "/p2p/sessions/session-1/join",
            payload: {
                level: "intermediate",
                preferredLanguage: "typescript",
            },
        });

        expect(response.statusCode).toBe(409);
        expect(sessionParticipantCreateMock).not.toHaveBeenCalled();

        await fastify.close();
    });
});
