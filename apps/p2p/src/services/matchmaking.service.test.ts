import type { Server } from "socket.io";

const ensureProfileMock = jest.fn();

const queueTicketCreateMock = jest.fn();
const queueTicketUpdateManyMock = jest.fn();
const sessionFindUniqueMock = jest.fn();
const sessionFindManyMock = jest.fn();
const sessionUpdateMock = jest.fn();
const sessionUpdateManyMock = jest.fn();
const sessionMessageFindManyMock = jest.fn();
const sessionMessageCreateMock = jest.fn();
const sessionParticipantFindFirstMock = jest.fn();
const sessionParticipantFindManyMock = jest.fn();
const sessionParticipantUpdateMock = jest.fn();
const sessionParticipantCountMock = jest.fn();
const inviteCreateMock = jest.fn();
const inviteFindUniqueMock = jest.fn();
const profileFindManyMock = jest.fn();

const txSessionCreateMock = jest.fn();
const txSessionUpdateMock = jest.fn();
const txSessionParticipantCreateMock = jest.fn();
const txSessionParticipantCreateManyMock = jest.fn();
const txSessionParticipantDeleteManyMock = jest.fn();
const txSessionParticipantUpdateMock = jest.fn();
const txQueueTicketUpdateManyMock = jest.fn();
const txMatchHistoryCreateMock = jest.fn();
const txInviteUpdateMock = jest.fn();

const prismaMock = {
    peer_queue_tickets: {
        create: queueTicketCreateMock,
        updateMany: queueTicketUpdateManyMock,
    },
    peer_sessions: {
        findUnique: sessionFindUniqueMock,
        findMany: sessionFindManyMock,
        update: sessionUpdateMock,
        updateMany: sessionUpdateManyMock,
    },
    peer_session_messages: {
        findMany: sessionMessageFindManyMock,
        create: sessionMessageCreateMock,
    },
    peer_session_participants: {
        findFirst: sessionParticipantFindFirstMock,
        findMany: sessionParticipantFindManyMock,
        update: sessionParticipantUpdateMock,
        count: sessionParticipantCountMock,
    },
    peer_invites: {
        create: inviteCreateMock,
        findUnique: inviteFindUniqueMock,
    },
    peer_skill_profiles: {
        findMany: profileFindManyMock,
    },
    $transaction: jest.fn(async (fn: (tx: any) => Promise<any>) =>
        fn({
            peer_sessions: {
                create: txSessionCreateMock,
                update: txSessionUpdateMock,
            },
            peer_session_participants: {
                create: txSessionParticipantCreateMock,
                createMany: txSessionParticipantCreateManyMock,
                deleteMany: txSessionParticipantDeleteManyMock,
                update: txSessionParticipantUpdateMock,
            },
            peer_queue_tickets: {
                updateMany: txQueueTicketUpdateManyMock,
            },
            peer_match_history: {
                create: txMatchHistoryCreateMock,
            },
            peer_invites: {
                update: txInviteUpdateMock,
            },
        })
    ),
};

const kv = new Map<string, string>();
const zsets = new Map<string, Map<string, number>>();

function sortedMembers(key: string): Array<{ member: string; score: number }> {
    const zset = zsets.get(key) || new Map<string, number>();
    return Array.from(zset.entries())
        .map(([member, score]) => ({ member, score }))
        .sort((a, b) => a.score - b.score);
}

function zremSync(key: string, member: string): number {
    const zset = zsets.get(key) || new Map<string, number>();
    const existed = zset.delete(member);
    zsets.set(key, zset);
    return existed ? 1 : 0;
}

const redisMock = {
    get: jest.fn(async (key: string) => kv.get(key) ?? null),
    setex: jest.fn(async (key: string, _seconds: number, value: string) => {
        kv.set(key, value);
        return "OK";
    }),
    setnxex: jest.fn(async (key: string, _seconds: number, value: string) => {
        if (kv.has(key)) {
            return false;
        }

        kv.set(key, value);
        return true;
    }),
    incr: jest.fn(async (key: string) => {
        const current = Number.parseInt(kv.get(key) || "0", 10) || 0;
        const next = current + 1;
        kv.set(key, String(next));
        return next;
    }),
    expire: jest.fn(async (_key: string, _seconds: number) => 1),
    del: jest.fn(async (...keys: string[]) => {
        let deleted = 0;
        keys.forEach((key) => {
            if (kv.delete(key)) {
                deleted += 1;
            }
        });
        return deleted;
    }),
    zadd: jest.fn(async (key: string, score: number, member: string) => {
        const zset = zsets.get(key) || new Map<string, number>();
        zset.set(member, score);
        zsets.set(key, zset);
        return 1;
    }),
    zrem: jest.fn(async (key: string, member: string) => zremSync(key, member)),
    zrank: jest.fn(async (key: string, member: string) => {
        const members = sortedMembers(key);
        const idx = members.findIndex((item) => item.member === member);
        return idx >= 0 ? idx : null;
    }),
    zrange: jest.fn(async (key: string, start: number, stop: number) => {
        const members = sortedMembers(key).map((item) => item.member);
        if (members.length === 0) {
            return [];
        }

        const end = stop >= 0 ? stop + 1 : members.length;
        return members.slice(start, end);
    }),
    pipeline: jest.fn(() => {
        const ops: Array<{ key: string; member: string }> = [];

        const chain = {
            zrem(key: string, member: string) {
                ops.push({ key, member });
                return chain;
            },
            async exec() {
                return ops.map((op) => [null, zremSync(op.key, op.member)]);
            },
        };

        return chain;
    }),
};

jest.mock("../lib/prisma.js", () => ({
    prisma: prismaMock,
}));

jest.mock("../lib/redis.js", () => ({
    redis: redisMock,
}));

jest.mock("./leveling.service.js", () => ({
    LevelingService: jest.fn().mockImplementation(() => ({
        ensureProfile: ensureProfileMock,
    })),
}));

import { MatchmakingService } from "./matchmaking.service.js";
import type { JoinPeerQueueInput } from "@interviewforge/shared";

describe("MatchmakingService integration", () => {
    const emits: Array<{ room: string; event: string; payload: any }> = [];

    const ioMock = {
        to: jest.fn((room: string) => ({
            emit: (event: string, payload: any) => {
                emits.push({ room, event, payload });
            },
        })),
    } as unknown as Server;

    const queuePayload: JoinPeerQueueInput = {
        role: "backend",
        level: "beginner",
        interviewType: "coding",
        preferredLanguage: "typescript",
        timingPreset: "standard_45",
    };

    function eventsByName(event: string) {
        return emits.filter((item) => item.event === event);
    }

    function mockScheduledPendingSessions(sessions: any[]) {
        sessionFindManyMock.mockImplementation(async ({ where }: any) => {
            if (where?.source === "scheduled" && where?.status === "MATCHED") {
                return [];
            }

            if (where?.source === "scheduled" && where?.status === "PENDING") {
                return sessions;
            }

            return [];
        });
    }

    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

        kv.clear();
        zsets.clear();
        emits.length = 0;
        jest.clearAllMocks();

        let sessionSeq = 0;
        let inviteSeq = 0;

        ensureProfileMock.mockImplementation(async (userId: string, initialLevel: string) => ({
            user_id: userId,
            current_level: initialLevel,
            score: 50,
        }));

        queueTicketCreateMock.mockImplementation(async ({ data }: any) => ({
            id: `ticket-${data.user_id}`,
            ...data,
        }));

        queueTicketUpdateManyMock.mockResolvedValue({ count: 1 });
        sessionUpdateManyMock.mockResolvedValue({ count: 1 });
        sessionFindManyMock.mockResolvedValue([]);
        profileFindManyMock.mockImplementation(async ({ where }: any) => {
            const ids = where?.user_id?.in || [];
            return ids.map((user_id: string, index: number) => ({
                user_id,
                score: 50 + index * 10,
            }));
        });

        txSessionCreateMock.mockImplementation(async ({ data }: any) => {
            sessionSeq += 1;
            return {
                id: `session-${sessionSeq}`,
                room_id: data.room_id,
                timing_preset: data.timing_preset,
                status: data.status,
            };
        });

        txSessionParticipantCreateMock.mockResolvedValue({ id: "participant-1" });
        txSessionParticipantCreateManyMock.mockResolvedValue({ count: 2 });
        txSessionParticipantDeleteManyMock.mockResolvedValue({ count: 1 });
        txSessionParticipantUpdateMock.mockResolvedValue({ id: "participant-updated" });
        txSessionUpdateMock.mockResolvedValue({ id: "session-updated" });
        txQueueTicketUpdateManyMock.mockResolvedValue({ count: 1 });
        txMatchHistoryCreateMock.mockResolvedValue({ id: "history-1" });
        txInviteUpdateMock.mockResolvedValue({ id: "invite-1" });

        sessionParticipantFindFirstMock.mockImplementation(async ({ where }: any) => {
            if (where?.user_id?.not) {
                return { user_id: where.user_id.not === "user-1" ? "user-2" : "user-1" };
            }

            return {
                id: `participant-${where.user_id || "x"}`,
                joined_at: null,
                peer_sessions: { id: where.session_id || "session-1", status: "MATCHED" },
            };
        });

        sessionParticipantUpdateMock.mockResolvedValue({ id: "participant-1", is_ready: true });
        sessionParticipantCountMock.mockResolvedValue(2);
        sessionParticipantFindManyMock.mockResolvedValue([
            {
                user_id: "user-1",
                participant_role: "candidate",
                preferred_language: "typescript",
                is_ready: true,
            },
            {
                user_id: "user-2",
                participant_role: "interviewer",
                preferred_language: "typescript",
                is_ready: true,
            },
        ]);

        sessionFindUniqueMock.mockResolvedValue({
            id: "session-1",
            status: "MATCHED",
            started_at: new Date(),
            peer_session_participants: [
                { user_id: "user-1", participant_role: "candidate", preferred_language: "typescript", is_ready: true },
                { user_id: "user-2", participant_role: "interviewer", preferred_language: "typescript", is_ready: true },
            ],
        });

        sessionUpdateMock.mockResolvedValue({ id: "session-1", status: "ACTIVE" });

        sessionMessageFindManyMock.mockResolvedValue([]);
        sessionMessageCreateMock.mockImplementation(async ({ data }: any) => ({
            id: "message-1",
            ...data,
            created_at: new Date(),
        }));

        inviteCreateMock.mockImplementation(async ({ data }: any) => {
            inviteSeq += 1;
            return {
                id: `invite-${inviteSeq}`,
                token: data.token,
                inviter_user_id: data.inviter_user_id,
                interview_type: data.interview_type,
                preferred_language: data.preferred_language,
                timing_preset: data.timing_preset,
                max_uses: data.max_uses,
                used_count: 0,
                expires_at: data.expires_at,
            };
        });

        inviteFindUniqueMock.mockResolvedValue({
            id: "invite-1",
            token: "token-1",
            inviter_user_id: "user-1",
            interview_type: "coding",
            preferred_language: "typescript",
            timing_preset: "standard_45",
            max_uses: 1,
            used_count: 0,
            revoked_at: null,
            expires_at: new Date(Date.now() + 30 * 60 * 1000),
        });
    });

    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    test("matches two queued users and emits matched events", async () => {
        const service = new MatchmakingService(ioMock);

        await service.joinQueue("user-1", queuePayload);
        await service.joinQueue("user-2", queuePayload);

        const matchedEvents = eventsByName("peer:matched");
        expect(matchedEvents).toHaveLength(2);
        expect(matchedEvents.map((item) => item.room).sort()).toEqual(["user:user-1", "user:user-2"]);
    });

    test("creates fallback scheduled session when user remains unmatched", async () => {
        const service = new MatchmakingService(ioMock);

        await service.joinQueue("user-1", queuePayload);
        await jest.advanceTimersByTimeAsync(QUEUE_FALLBACK_MS);

        expect(txSessionCreateMock).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    source: "scheduled",
                    status: "PENDING",
                    created_by_user_id: "user-1",
                }),
            })
        );

        const scheduled = eventsByName("peer:scheduled");
        expect(scheduled).toHaveLength(1);
        expect(scheduled[0]!.room).toBe("user:user-1");
    });

    test("does not schedule fallback when queue is left", async () => {
        const service = new MatchmakingService(ioMock);

        await service.joinQueue("user-1", queuePayload);
        await service.leaveQueue("user-1");
        await jest.advanceTimersByTimeAsync(QUEUE_FALLBACK_MS);

        expect(txSessionCreateMock).not.toHaveBeenCalled();
        expect(eventsByName("peer:scheduled")).toHaveLength(0);
    });

    test("extends due scheduled booking when no partner is available", async () => {
        const service = new MatchmakingService(ioMock);

        mockScheduledPendingSessions([
            {
                id: "scheduled-1",
                room_id: "room-1",
                interview_type: "coding",
                scheduled_for: new Date("2026-01-01T00:00:00.000Z"),
                peer_session_participants: [
                    {
                        id: "participant-a",
                        user_id: "user-1",
                        level_at_match: "beginner",
                        preferred_language: "typescript",
                    },
                ],
            },
        ]);

        await service.runScheduledOrchestratorCycle();

        expect(sessionUpdateMock).not.toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: "scheduled-1" } })
        );

        const extensionEvents = eventsByName("peer:scheduled-extension");
        expect(extensionEvents.length).toBeGreaterThan(0);
        expect(extensionEvents.some((event) => event.payload.extensionAttempt === 1)).toBe(true);
        expect(extensionEvents.some((event) => event.payload.maxAttempts === 2)).toBe(true);
    });

    test("cancels scheduled booking after max extension attempts", async () => {
        const service = new MatchmakingService(ioMock);

        kv.set("peer_scheduled_extension_attempt:scheduled-1", "2");
        mockScheduledPendingSessions([
            {
                id: "scheduled-1",
                room_id: "room-1",
                interview_type: "coding",
                scheduled_for: new Date("2026-01-01T00:00:00.000Z"),
                peer_session_participants: [
                    {
                        id: "participant-a",
                        user_id: "user-1",
                        level_at_match: "beginner",
                        preferred_language: "typescript",
                    },
                ],
            },
        ]);

        await service.runScheduledOrchestratorCycle();

        expect(sessionUpdateMock).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: "scheduled-1" },
                data: expect.objectContaining({
                    status: "CANCELLED",
                }),
            })
        );

        expect(eventsByName("peer:session-ended").length).toBeGreaterThan(0);
        expect(eventsByName("peer:match-cancelled")).toHaveLength(1);
    });

    test("times out one-person ready scheduled lobby after rematch grace", async () => {
        const service = new MatchmakingService(ioMock);

        mockScheduledPendingSessions([
            {
                id: "scheduled-1",
                room_id: "room-1",
                interview_type: "coding",
                scheduled_for: new Date("2026-01-01T00:00:00.000Z"),
                peer_session_participants: [
                    {
                        id: "participant-a",
                        user_id: "user-1",
                        level_at_match: "beginner",
                        preferred_language: "typescript",
                        is_ready: true,
                    },
                ],
            },
        ]);

        await service.runScheduledOrchestratorCycle();

        expect(kv.get("peer_lobby_rematch_deadline:scheduled-1")).toBeDefined();
        expect(txSessionUpdateMock).not.toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: "scheduled-1" },
                data: expect.objectContaining({ status: "CANCELLED" }),
            })
        );

        await jest.advanceTimersByTimeAsync(5 * 60_000 + 1);
        await service.runScheduledOrchestratorCycle();

        expect(txSessionUpdateMock).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: "scheduled-1" },
                data: expect.objectContaining({ status: "CANCELLED" }),
            })
        );
        expect(txQueueTicketUpdateManyMock).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ matched_session_id: "scheduled-1" }),
                data: expect.objectContaining({ status: "cancelled" }),
            })
        );
        expect(eventsByName("peer:session-ended").length).toBeGreaterThan(0);
        expect(eventsByName("peer:match-cancelled")).toHaveLength(1);
    });

    test("marks pending scheduled lobby ready and starts rematch grace", async () => {
        const service = new MatchmakingService(ioMock);

        sessionParticipantFindFirstMock.mockResolvedValue({
            id: "participant-1",
            joined_at: null,
            peer_sessions: {
                id: "session-1",
                status: "PENDING",
                scheduled_for: new Date("2026-01-01T00:00:00.000Z"),
            },
        });
        sessionParticipantCountMock.mockResolvedValue(1);

        await service.markSessionReady("user-1", "session-1");

        expect(kv.get("peer_lobby_rematch_deadline:session-1")).toBeDefined();
        expect(sessionUpdateMock).not.toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: "session-1" },
                data: expect.objectContaining({ status: "CONNECTING" }),
            })
        );
    });

    test("auto-matches compatible due scheduled sessions", async () => {
        const service = new MatchmakingService(ioMock);

        mockScheduledPendingSessions([
            {
                id: "scheduled-a",
                room_id: "room-a",
                interview_type: "coding",
                scheduled_for: new Date("2026-01-01T00:00:00.000Z"),
                peer_session_participants: [
                    {
                        id: "participant-a",
                        user_id: "user-1",
                        level_at_match: "beginner",
                        preferred_language: "typescript",
                    },
                ],
            },
            {
                id: "scheduled-b",
                room_id: "room-b",
                interview_type: "coding",
                scheduled_for: new Date("2026-01-01T00:00:00.000Z"),
                peer_session_participants: [
                    {
                        id: "participant-b",
                        user_id: "user-2",
                        level_at_match: "intermediate",
                        preferred_language: "typescript",
                    },
                ],
            },
        ]);

        await service.runScheduledOrchestratorCycle();

        expect(txSessionParticipantUpdateMock).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: "participant-a" },
            })
        );
        expect(txSessionParticipantCreateMock).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    session_id: "scheduled-a",
                    user_id: "user-2",
                }),
            })
        );
        expect(eventsByName("peer:matched")).toHaveLength(0);
        expect(eventsByName("peer:session-state").length).toBeGreaterThan(0);
    });

    test("batch matches same slot and language by adjacent rating", async () => {
        const service = new MatchmakingService(ioMock);

        profileFindManyMock.mockResolvedValue([
            { user_id: "user-1", score: 40 },
            { user_id: "user-2", score: 90 },
            { user_id: "user-3", score: 42 },
            { user_id: "user-4", score: 88 },
        ]);

        mockScheduledPendingSessions([
            {
                id: "scheduled-a",
                room_id: "room-a",
                interview_type: "coding",
                scheduled_for: new Date("2026-01-01T00:00:00.000Z"),
                peer_session_participants: [{
                    id: "participant-a",
                    user_id: "user-1",
                    level_at_match: "beginner",
                    preferred_language: "typescript",
                }],
            },
            {
                id: "scheduled-b",
                room_id: "room-b",
                interview_type: "coding",
                scheduled_for: new Date("2026-01-01T00:00:00.000Z"),
                peer_session_participants: [{
                    id: "participant-b",
                    user_id: "user-2",
                    level_at_match: "advanced",
                    preferred_language: "typescript",
                }],
            },
            {
                id: "scheduled-c",
                room_id: "room-c",
                interview_type: "coding",
                scheduled_for: new Date("2026-01-01T00:00:00.000Z"),
                peer_session_participants: [{
                    id: "participant-c",
                    user_id: "user-3",
                    level_at_match: "beginner",
                    preferred_language: "typescript",
                }],
            },
            {
                id: "scheduled-d",
                room_id: "room-d",
                interview_type: "coding",
                scheduled_for: new Date("2026-01-01T00:00:00.000Z"),
                peer_session_participants: [{
                    id: "participant-d",
                    user_id: "user-4",
                    level_at_match: "advanced",
                    preferred_language: "typescript",
                }],
            },
        ]);

        await service.runScheduledOrchestratorCycle();

        expect(txSessionParticipantCreateMock).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    session_id: "scheduled-a",
                    user_id: "user-3",
                }),
            })
        );
        expect(txSessionParticipantCreateMock).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    session_id: "scheduled-d",
                    user_id: "user-2",
                }),
            })
        );
    });

    test("fallback window matches cross-language leftovers in the same slot", async () => {
        const service = new MatchmakingService(ioMock);

        profileFindManyMock.mockResolvedValue([
            { user_id: "user-1", score: 60 },
            { user_id: "user-2", score: 62 },
        ]);

        mockScheduledPendingSessions([
            {
                id: "scheduled-a",
                room_id: "room-a",
                interview_type: "coding",
                scheduled_for: new Date("2026-01-01T01:30:00.000Z"),
                peer_session_participants: [{
                    id: "participant-a",
                    user_id: "user-1",
                    level_at_match: "intermediate",
                    preferred_language: "typescript",
                }],
            },
            {
                id: "scheduled-b",
                room_id: "room-b",
                interview_type: "coding",
                scheduled_for: new Date("2026-01-01T01:30:00.000Z"),
                peer_session_participants: [{
                    id: "participant-b",
                    user_id: "user-2",
                    level_at_match: "intermediate",
                    preferred_language: "python",
                }],
            },
        ]);

        await service.runScheduledOrchestratorCycle();

        expect(txSessionParticipantCreateMock).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    session_id: "scheduled-a",
                    user_id: "user-2",
                    preferred_language: "python",
                }),
            })
        );
    });

    test("supports fallback session join flow for two users", async () => {
        const service = new MatchmakingService(ioMock);

        await service.joinQueue("user-1", queuePayload);
        await jest.advanceTimersByTimeAsync(QUEUE_FALLBACK_MS);

        sessionParticipantFindFirstMock.mockImplementation(async ({ where }: any) => {
            if (where?.user_id?.not) {
                return { user_id: "user-2" };
            }
            if (where.user_id === "user-1" || where.user_id === "user-2") {
                return {
                    id: `participant-${where.user_id}`,
                    user_id: where.user_id,
                    peer_sessions: { id: "session-1", status: "PENDING" },
                };
            }
            return null;
        });

        sessionFindUniqueMock.mockResolvedValue({
            id: "session-1",
            status: "PENDING",
            peer_session_participants: [
                { user_id: "user-1", participant_role: "candidate", is_ready: false },
                { user_id: "user-2", participant_role: "interviewer", is_ready: false },
            ],
        });

        await service.joinSession("user-1", "session-1");
        await service.joinSession("user-2", "session-1");

        expect(eventsByName("peer:chat-history").length).toBeGreaterThanOrEqual(2);
        expect(eventsByName("peer:session-state").length).toBeGreaterThanOrEqual(2);
    });

    test("creates invite and emits invite-created", async () => {
        const service = new MatchmakingService(ioMock);

        const invite = await service.createInvite("user-1", {
            interviewType: "coding",
            preferredLanguage: "typescript",
            timingPreset: "standard_45",
            maxUses: 1,
            expiresInSeconds: 900,
        });

        expect(invite.token).toBeDefined();
        const created = eventsByName("peer:invite-created");
        expect(created).toHaveLength(1);
        expect(created[0]!.room).toBe("user:user-1");
    });

    test("accepts invite and emits invite + matched events", async () => {
        const service = new MatchmakingService(ioMock);

        await service.acceptInvite("user-2", {
            token: "token-1",
            role: "backend",
            level: "beginner",
        });

        expect(eventsByName("peer:invite-accepted")).toHaveLength(1);
        expect(eventsByName("peer:matched")).toHaveLength(2);
    });

    test("rejects accepting own invite", async () => {
        const service = new MatchmakingService(ioMock);

        inviteFindUniqueMock.mockResolvedValueOnce({
            id: "invite-1",
            token: "token-1",
            inviter_user_id: "user-2",
            interview_type: "coding",
            preferred_language: "typescript",
            timing_preset: "standard_45",
            max_uses: 1,
            used_count: 0,
            revoked_at: null,
            expires_at: new Date(Date.now() + 30 * 60 * 1000),
        });

        await expect(
            service.acceptInvite("user-2", {
                token: "token-1",
                role: "backend",
                level: "beginner",
            })
        ).rejects.toThrow("You cannot accept your own invite");
    });

    test("marks session ready and activates session with turn state", async () => {
        const service = new MatchmakingService(ioMock);

        sessionParticipantFindFirstMock.mockResolvedValue({
            id: "participant-1",
            joined_at: null,
            peer_sessions: { id: "session-1", status: "MATCHED" },
        });

        sessionFindUniqueMock.mockResolvedValue({
            id: "session-1",
            status: "CONNECTING",
            started_at: new Date(),
            peer_session_participants: [
                { user_id: "user-1", participant_role: "candidate", preferred_language: "typescript", is_ready: true },
                { user_id: "user-2", participant_role: "interviewer", preferred_language: "typescript", is_ready: true },
            ],
        });

        await service.markSessionReady("user-1", "session-1");

        expect(sessionUpdateMock).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: "session-1" },
                data: expect.objectContaining({ status: "CONNECTING" }),
            })
        );

        expect(sessionUpdateManyMock).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ id: "session-1" }),
                data: expect.objectContaining({ status: "ACTIVE" }),
            })
        );

        expect(eventsByName("peer:timer-sync").length).toBeGreaterThan(0);
        expect(eventsByName("peer:turn-state").length).toBeGreaterThan(0);
        expect(eventsByName("peer:editor-state").length).toBeGreaterThan(0);
    });

    test("enforces active interviewer for turn advance", async () => {
        const service = new MatchmakingService(ioMock);

        sessionParticipantFindFirstMock.mockResolvedValue({
            id: "participant-1",
            joined_at: null,
            peer_sessions: { id: "session-1", status: "MATCHED" },
        });

        sessionFindUniqueMock.mockResolvedValue({
            id: "session-1",
            status: "CONNECTING",
            started_at: new Date(),
            peer_session_participants: [
                { user_id: "user-1", participant_role: "candidate", preferred_language: "typescript", is_ready: true },
                { user_id: "user-2", participant_role: "interviewer", preferred_language: "typescript", is_ready: true },
            ],
        });

        await service.markSessionReady("user-1", "session-1");
        sessionFindManyMock.mockImplementation(async ({ where }: any) => {
            if (where?.status === "CONNECTING") {
                return [{ id: "session-1" }];
            }
            return [];
        });
        await jest.advanceTimersByTimeAsync(PRE_START_COUNTDOWN_MS);
        await service.runScheduledOrchestratorCycle();

        await expect(
            service.advanceTurn("user-1", { peerSessionId: "session-1" })
        ).rejects.toThrow("Only active interviewer can advance turn");

        await service.advanceTurn("user-2", { peerSessionId: "session-1" });
        expect(eventsByName("peer:turn-state").length).toBeGreaterThan(1);
    });

    test("enforces active candidate for editor sync", async () => {
        const service = new MatchmakingService(ioMock);

        sessionParticipantFindFirstMock.mockResolvedValue({
            id: "participant-1",
            joined_at: null,
            peer_sessions: { id: "session-1", status: "MATCHED" },
        });

        sessionFindUniqueMock.mockResolvedValue({
            id: "session-1",
            status: "CONNECTING",
            started_at: new Date(),
            peer_session_participants: [
                { user_id: "user-1", participant_role: "candidate", preferred_language: "typescript", is_ready: true },
                { user_id: "user-2", participant_role: "interviewer", preferred_language: "typescript", is_ready: true },
            ],
        });

        await service.markSessionReady("user-1", "session-1");
        sessionFindManyMock.mockImplementation(async ({ where }: any) => {
            if (where?.status === "CONNECTING") {
                return [{ id: "session-1" }];
            }
            return [];
        });
        await jest.advanceTimersByTimeAsync(PRE_START_COUNTDOWN_MS);
        await service.runScheduledOrchestratorCycle();

        await expect(
            service.syncEditorState("user-2", {
                peerSessionId: "session-1",
                code: "console.log('x')",
                language: "typescript",
            })
        ).rejects.toThrow("Only active candidate can edit the shared editor");

        await service.syncEditorState("user-1", {
            peerSessionId: "session-1",
            code: "console.log('ok')",
            language: "typescript",
        });

        expect(eventsByName("peer:editor-state").length).toBeGreaterThan(1);
    });

    test("relays timer, chat, and signaling events to the right channels", async () => {
        const service = new MatchmakingService(ioMock);

        await service.relayTimerSync("user-1", {
            peerSessionId: "session-1",
            roundKey: "round_a",
            elapsedSeconds: 30,
        });

        await service.sendChatMessage("user-1", {
            peerSessionId: "session-1",
            text: "hello",
        });

        await service.relaySignalOffer("user-1", {
            peerSessionId: "session-1",
            sdp: "offer",
        });

        await service.relaySignalAnswer("user-1", {
            peerSessionId: "session-1",
            sdp: "answer",
        });

        await service.relaySignalIce("user-1", {
            peerSessionId: "session-1",
            candidate: "ice",
        });

        expect(eventsByName("peer:timer-sync")).toHaveLength(1);
        expect(eventsByName("peer:chat-message")).toHaveLength(1);
        expect(eventsByName("peer:signal-offer")).toHaveLength(1);
        expect(eventsByName("peer:signal-answer")).toHaveLength(1);
        expect(eventsByName("peer:signal-ice")).toHaveLength(1);
    });

    test("never auto-ends an active session on disconnect; preserves it for rejoin", async () => {
        const service = new MatchmakingService(ioMock);

        kv.set("peer_socket:user-1", "socket-1");
        kv.set("peer_user_room:user-1", "session-1");

        sessionFindUniqueMock.mockResolvedValue({
            id: "session-1",
            status: "ACTIVE",
            peer_session_participants: [
                { user_id: "user-1", participant_role: "candidate", is_ready: true },
                { user_id: "user-2", participant_role: "interviewer", is_ready: true },
            ],
        });

        await service.onSocketDisconnected("user-1", "socket-1");
        await jest.advanceTimersByTimeAsync(DISCONNECT_GRACE_MS);

        // The remaining participant is told the peer is reconnecting...
        expect(eventsByName("peer:reconnecting")).toHaveLength(1);
        // ...but the session is never abandoned and the pairing is kept so the
        // dropped user can rejoin and resume.
        expect(sessionUpdateMock).not.toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ status: "ABANDONED" }),
            })
        );
        expect(eventsByName("peer:match-cancelled")).toHaveLength(0);
        expect(kv.get("peer_user_room:user-1")).toBe("session-1");
    });
});

const QUEUE_FALLBACK_MS = 60_000;
const DISCONNECT_GRACE_MS = 8_000;
const PRE_START_COUNTDOWN_MS = 60_000;
