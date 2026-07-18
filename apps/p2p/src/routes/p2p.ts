import { randomBytes, randomUUID } from "node:crypto";
import { FastifyInstance } from "fastify";
import {
    CreatePeerBookingSchema,
    CreatePeerInviteSchema,
    PEER_TIMING_PRESETS,
    PeerLevelSchema,
    SubmitPeerFeedbackSchema,
    clampPeerRating,
    scoreToLevel,
    seedScoreForLevel,
} from "@interviewforge/shared";
import { z } from "zod";
import { Types } from "mongoose";
import { DSAQuestion } from "../models/DSAQuestion.js";
import { prisma } from "../lib/prisma.js";

const bookingJoinSchema = z.object({
    level: PeerLevelSchema,
    preferredLanguage: z.enum(["python", "javascript", "typescript", "java", "cpp", "go"]).default("python"),
});

const createProfileSchema = z.object({
    level: PeerLevelSchema,
});

type PeerLevel = "beginner" | "intermediate" | "advanced";

type DsaQuestionLean = {
    _id: string;
    problemId: string;
    title: string;
    difficulty: "Easy" | "Medium" | "Hard";
    topics: string[];
};

const FIXED_PEER_TIMING_PRESET = "deep_60" as const;

function getRandomRolePair() {
    const firstRole: "interviewer" | "candidate" = Math.random() >= 0.5 ? "interviewer" : "candidate";
    return {
        firstRole,
        secondRole: firstRole === "interviewer" ? "candidate" : "interviewer",
    };
}

// ELO outcome in [0,1] from the 1..5 peer feedback ratings.
function feedbackOutcome(params: {
    overallRating: number;
    problemSolving: number;
    communication: number;
    codeQuality: number;
    interviewing: number;
}): number {
    const weighted =
        params.problemSolving * 0.3 +
        params.codeQuality * 0.25 +
        params.communication * 0.2 +
        params.interviewing * 0.1 +
        params.overallRating * 0.15;
    return Math.max(0, Math.min(1, weighted / 5));
}

// Decaying K-factor: aggressive early, settling toward ~24 with experience.
function ratingKFactor(sessionsRated: number): number {
    return 24 + 200 * Math.exp(-sessionsRated / 5);
}

function levelToDifficulty(level: PeerLevel): Array<"Easy" | "Medium" | "Hard"> {
    if (level === "advanced") return ["Hard", "Medium"];
    if (level === "intermediate") return ["Medium", "Easy"];
    return ["Easy", "Medium"];
}

async function pickQuestionForLevel(level: PeerLevel, excludeQuestionIds: string[]): Promise<DsaQuestionLean> {
    const difficultyOrder = levelToDifficulty(level);
    const excludedObjectIds = excludeQuestionIds
        .filter((id) => Types.ObjectId.isValid(id))
        .map((id) => new Types.ObjectId(id));

    for (const difficulty of difficultyOrder) {
        const filter = {
            difficulty,
            ...(excludedObjectIds.length > 0 ? { _id: { $nin: excludedObjectIds } } : {}),
        };

        const total = await DSAQuestion.countDocuments(filter);
        if (total <= 0) {
            continue;
        }

        const skip = Math.floor(Math.random() * total);
        const doc = await DSAQuestion.findOne(filter)
            .select("_id problemId title difficulty topics")
            .skip(skip)
            .lean();

        if (doc?._id && doc.problemId && doc.title && doc.difficulty) {
            return {
                _id: String(doc._id),
                problemId: String(doc.problemId),
                title: String(doc.title),
                difficulty: doc.difficulty,
                topics: Array.isArray(doc.topics) ? doc.topics.map(String) : [],
            };
        }
    }

    let fallback = await DSAQuestion.findOne(
        excludedObjectIds.length > 0 ? { _id: { $nin: excludedObjectIds } } : {}
    )
        .select("_id problemId title difficulty topics")
        .lean();

    if (!fallback && excludedObjectIds.length > 0) {
        fallback = await DSAQuestion.findOne({})
            .select("_id problemId title difficulty topics")
            .lean();
    }

    if (!fallback?._id || !fallback.problemId || !fallback.title || !fallback.difficulty) {
        throw new Error("No coding questions available in question bank");
    }

    return {
        _id: String(fallback._id),
        problemId: String(fallback.problemId),
        title: String(fallback.title),
        difficulty: fallback.difficulty,
        topics: Array.isArray(fallback.topics) ? fallback.topics.map(String) : [],
    };
}

export default async function p2pRoutes(fastify: FastifyInstance) {
    fastify.addHook("preHandler", fastify.authenticate);

    async function ensureSkillProfile(userId: string, initialLevel: PeerLevel) {
        const existing = await prisma.peer_skill_profiles.findUnique({ where: { user_id: userId } });
        if (existing) {
            return existing;
        }

        return prisma.peer_skill_profiles.create({
            data: {
                id: randomUUID(),
                user_id: userId,
                current_level: initialLevel,
                score: seedScoreForLevel(initialLevel),
                sessions_rated: 0,
                onboarded: false,
                updated_at: new Date(),
            },
        });
    }

    async function assignQuestionForUser(params: {
        sessionId: string;
        userId: string;
        level: PeerLevel;
    }) {
        const existing = await prisma.peer_session_question_assignments.findFirst({
            where: {
                session_id: params.sessionId,
                user_id: params.userId,
            },
        });

        if (existing) {
            return existing;
        }

        const existingSessionAssignments = await prisma.peer_session_question_assignments.findMany({
            where: {
                session_id: params.sessionId,
            },
            select: {
                question_id: true,
            },
        });

        const exclude = existingSessionAssignments.map((assignment) => assignment.question_id);
        const picked = await pickQuestionForLevel(params.level, exclude);

        return prisma.peer_session_question_assignments.create({
            data: {
                id: randomUUID(),
                session_id: params.sessionId,
                user_id: params.userId,
                question_id: String(picked._id),
                question_title: picked.title,
                question_category: picked.topics[0] || "DSA",
                question_difficulty: picked.difficulty,
            },
        });
    }

    async function applyFeedbackToProfile(params: {
        userId: string;
        opponentScore: number;
        overallRating: number;
        problemSolving: number;
        communication: number;
        codeQuality: number;
        interviewing: number;
    }) {
        const profile = await ensureSkillProfile(params.userId, "beginner");

        const previousScore = Number(profile.score);
        const outcome = feedbackOutcome(params);
        const expected = 1 / (1 + Math.pow(10, (params.opponentScore - previousScore) / 400));
        const k = ratingKFactor(profile.sessions_rated);
        const delta = Math.max(-300, Math.min(300, k * (outcome - expected)));
        const newScore = Number(clampPeerRating(previousScore + delta).toFixed(2));
        const newLevel = scoreToLevel(newScore);

        const updated = await prisma.peer_skill_profiles.update({
            where: { user_id: params.userId },
            data: {
                score: newScore,
                current_level: newLevel,
                sessions_rated: { increment: 1 },
            },
        });

        await prisma.peer_skill_history.create({
            data: {
                id: randomUUID(),
                user_id: params.userId,
                previous_level: profile.current_level,
                new_level: newLevel,
                previous_score: previousScore,
                new_score: newScore,
                reason: "Updated after peer session feedback",
            },
        });

        return updated;
    }

    fastify.post("/p2p/profile", async (request, reply) => {
        const parsed = createProfileSchema.safeParse(request.body);

        if (!parsed.success) {
            return reply.status(400).send({
                error: "Validation Error",
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const existing = await ensureSkillProfile(request.user!.id, parsed.data.level);

        const profile = existing.onboarded
            ? existing
            : await prisma.peer_skill_profiles.update({
                where: { user_id: request.user!.id },
                data: {
                    current_level: parsed.data.level,
                    score: seedScoreForLevel(parsed.data.level),
                    onboarded: true,
                    updated_at: new Date(),
                },
            });

        return {
            currentLevel: profile.current_level,
            score: Number(profile.score),
            sessionsRated: profile.sessions_rated,
            onboarded: profile.onboarded,
        };
    });

    fastify.get("/p2p/me/skill-profile", async (request) => {
        const profile = await prisma.peer_skill_profiles.findUnique({
            where: { user_id: request.user!.id },
        });

        if (!profile) {
            return {
                currentLevel: "beginner",
                score: seedScoreForLevel("beginner"),
                sessionsRated: 0,
                onboarded: false,
            };
        }

        return {
            currentLevel: profile.current_level,
            score: Number(profile.score),
            sessionsRated: profile.sessions_rated,
            onboarded: profile.onboarded,
            updatedAt: profile.updated_at,
        };
    });

    fastify.post("/p2p/bookings", async (request, reply) => {
        const parsed = CreatePeerBookingSchema.safeParse(request.body);

        if (!parsed.success) {
            return reply.status(400).send({
                error: "Validation Error",
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const profile = await ensureSkillProfile(request.user!.id, "beginner");

        const peerSession = await prisma.peer_sessions.create({
            data: {
                id: randomUUID(),
                room_id: randomUUID(),
                source: "scheduled",
                interview_type: parsed.data.interviewType,
                timing_preset: FIXED_PEER_TIMING_PRESET,
                status: "PENDING",
                created_by_user_id: request.user!.id,
                scheduled_for: new Date(parsed.data.scheduledFor),
                updated_at: new Date(),
            },
        });

        await prisma.peer_session_participants.create({
            data: {
                id: randomUUID(),
                session_id: peerSession.id,
                user_id: request.user!.id,
                participant_role: "candidate",
                level_at_match: profile.current_level,
                preferred_language: parsed.data.preferredLanguage,
            },
        });

        await prisma.peer_queue_tickets.create({
            data: {
                id: randomUUID(),
                user_id: request.user!.id,
                role: "peer",
                level: profile.current_level,
                interview_type: parsed.data.interviewType,
                preferred_language: parsed.data.preferredLanguage,
                timing_preset: FIXED_PEER_TIMING_PRESET,
                status: "scheduled",
                expires_at: new Date(parsed.data.scheduledFor),
                matched_session_id: peerSession.id,
                updated_at: new Date(),
            },
        });

        // Booking only registers the user for the slot; matching happens live in
        // the waiting room at slot time, so no pre-slot queue is seeded here.

        const assignment = await assignQuestionForUser({
            sessionId: peerSession.id,
            userId: request.user!.id,
            level: profile.current_level as PeerLevel,
        });

        return reply.status(201).send({
            sessionId: peerSession.id,
            roomId: peerSession.room_id,
            status: peerSession.status,
            scheduledFor: peerSession.scheduled_for,
            prepQuestion: {
                assignmentId: assignment.id,
                title: assignment.question_title,
                difficulty: assignment.question_difficulty,
                category: assignment.question_category,
                practiceUrl: `/questions/dsa/solve?id=${assignment.question_id}`,
            },
        });
    });

    fastify.get("/p2p/bookings/open", async (request) => {
        const sessions = await prisma.peer_sessions.findMany({
            where: {
                source: "scheduled",
                status: { in: ["PENDING", "MATCHED"] },
                scheduled_for: { gte: new Date(Date.now() - 15 * 60 * 1000) },
                peer_session_participants: {
                    some: {
                        user_id: { not: request.user!.id },
                    },
                },
            },
            include: {
                peer_session_participants: true,
            },
            orderBy: { scheduled_for: "asc" },
            take: 25,
        });

        const open = sessions
            .filter((session) => session.peer_session_participants.length < 2)
            .map((session) => {
                const host = session.peer_session_participants[0] || null;
                return {
                    sessionId: session.id,
                    interviewType: session.interview_type,
                    timingPreset: session.timing_preset,
                    scheduledFor: session.scheduled_for,
                    hostLevel: host?.level_at_match || "beginner",
                    hostLanguage: host?.preferred_language || "python",
                };
            });

        return { sessions: open };
    });

    fastify.post("/p2p/sessions/:sessionId/join", async (request, reply) => {
        const { sessionId } = request.params as { sessionId: string };

        const parsed = bookingJoinSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({
                error: "Validation Error",
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const session = await prisma.peer_sessions.findUnique({
            where: { id: sessionId },
            include: {
                peer_session_participants: true,
            },
        });

        if (!session) {
            return reply.status(404).send({ error: "Session not found" });
        }

        if (["CANCELLED", "COMPLETED", "ABANDONED"].includes(session.status)) {
            return reply.status(409).send({ error: "Session is no longer joinable" });
        }

        const participants = session.peer_session_participants;

        if (participants.length >= 2 && !participants.some((p) => p.user_id === request.user!.id)) {
            return reply.status(409).send({ error: "Session already has two participants" });
        }

        const participant = participants.find((p) => p.user_id === request.user!.id);
        if (!participant && session.source === "scheduled") {
            return reply.status(409).send({
                error: "Scheduled slots are matched automatically at cutoff. Book this hourly slot instead.",
            });
        }

        const profile = await ensureSkillProfile(request.user!.id, parsed.data.level);

        if (!participant) {
            await prisma.peer_session_participants.create({
                data: {
                    id: randomUUID(),
                    session_id: session.id,
                    user_id: request.user!.id,
                    participant_role: "candidate",
                    level_at_match: profile.current_level,
                    preferred_language: parsed.data.preferredLanguage,
                },
            });
        }

        const assignment = await assignQuestionForUser({
            sessionId: session.id,
            userId: request.user!.id,
            level: profile.current_level as PeerLevel,
        });

        const refreshed = await prisma.peer_sessions.findUnique({
            where: { id: session.id },
            include: { peer_session_participants: true },
        });

        if (refreshed && refreshed.peer_session_participants.length >= 2 && refreshed.status === "PENDING") {
            const sorted = [...refreshed.peer_session_participants].sort(
                (a, b) => a.created_at.getTime() - b.created_at.getTime()
            );
            const first = sorted[0];
            const second = sorted[1];

            if (!first || !second) {
                return reply.status(409).send({ error: "Session participants are incomplete" });
            }

            const { firstRole, secondRole } = getRandomRolePair();

            await prisma.$transaction([
                prisma.peer_session_participants.update({
                    where: { id: first.id },
                    data: { participant_role: firstRole },
                }),
                prisma.peer_session_participants.update({
                    where: { id: second.id },
                    data: { participant_role: secondRole },
                }),
                prisma.peer_sessions.update({
                    where: { id: refreshed.id },
                    data: {
                        status: "MATCHED",
                        timing_preset: FIXED_PEER_TIMING_PRESET,
                    },
                }),
            ]);
        }

        return {
            sessionId: session.id,
            assignment: {
                title: assignment.question_title,
                difficulty: assignment.question_difficulty,
                category: assignment.question_category,
                practiceUrl: `/questions/dsa/solve?id=${assignment.question_id}`,
            },
        };
    });

    fastify.post("/p2p/invites", async (request, reply) => {
        const parsed = CreatePeerInviteSchema.safeParse(request.body);

        if (!parsed.success) {
            return reply.status(400).send({
                error: "Validation Error",
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const token = randomBytes(18).toString("base64url");
        const expiresAt = new Date(Date.now() + parsed.data.expiresInSeconds * 1000);

        const invite = await prisma.peer_invites.create({
            data: {
                id: randomUUID(),
                token,
                inviter_user_id: request.user!.id,
                interview_type: parsed.data.interviewType,
                preferred_language: parsed.data.preferredLanguage,
                timing_preset: FIXED_PEER_TIMING_PRESET,
                max_uses: parsed.data.maxUses,
                expires_at: expiresAt,
            },
        });

        return reply.status(201).send({
            token: invite.token,
            expiresAt: invite.expires_at,
            maxUses: invite.max_uses,
            shareUrl: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/peer/invite/${invite.token}`,
        });
    });

    fastify.post("/p2p/invites/:token/accept", async (request, reply) => {
        const { token } = request.params as { token: string };
        const parsed = bookingJoinSchema.safeParse(request.body);

        if (!parsed.success) {
            return reply.status(400).send({
                error: "Validation Error",
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const invite = await prisma.peer_invites.findUnique({ where: { token } });

        if (
            !invite ||
            invite.revoked_at ||
            invite.expires_at.getTime() < Date.now() ||
            invite.used_count >= invite.max_uses
        ) {
            return reply.status(400).send({ error: "Invite expired or unavailable" });
        }

        if (invite.inviter_user_id === request.user!.id) {
            return reply.status(400).send({ error: "You cannot accept your own invite" });
        }

        const profile = await ensureSkillProfile(request.user!.id, parsed.data.level);
        const inviterProfile = await ensureSkillProfile(invite.inviter_user_id, "beginner");
        const { firstRole: inviterRole, secondRole: receiverRole } = getRandomRolePair();

        const session = await prisma.$transaction(async (tx) => {
            const created = await tx.peer_sessions.create({
                data: {
                    id: randomUUID(),
                    room_id: randomUUID(),
                    source: "invite",
                    interview_type: invite.interview_type,
                    timing_preset: FIXED_PEER_TIMING_PRESET,
                    status: "MATCHED",
                    created_by_user_id: invite.inviter_user_id,
                    updated_at: new Date(),
                },
            });

            await tx.peer_session_participants.createMany({
                data: [
                    {
                        id: randomUUID(),
                        session_id: created.id,
                        user_id: invite.inviter_user_id,
                        participant_role: inviterRole,
                        level_at_match: inviterProfile.current_level,
                        preferred_language: invite.preferred_language,
                    },
                    {
                        id: randomUUID(),
                        session_id: created.id,
                        user_id: request.user!.id,
                        participant_role: receiverRole,
                        level_at_match: profile.current_level,
                        preferred_language: parsed.data.preferredLanguage,
                    },
                ],
            });

            await tx.peer_invites.update({
                where: { id: invite.id },
                data: {
                    used_count: { increment: 1 },
                    accepted_by_user_id: request.user!.id,
                    accepted_at: new Date(),
                    peer_session_id: created.id,
                },
            });

            await tx.peer_match_history.create({
                data: {
                    id: randomUUID(),
                    session_id: created.id,
                    user_a_id: invite.inviter_user_id,
                    user_b_id: request.user!.id,
                },
            });

            return created;
        });

        const inviterAssignment = await assignQuestionForUser({
            sessionId: session.id,
            userId: invite.inviter_user_id,
            level: inviterProfile.current_level as PeerLevel,
        });

        const receiverAssignment = await assignQuestionForUser({
            sessionId: session.id,
            userId: request.user!.id,
            level: profile.current_level as PeerLevel,
        });

        return {
            sessionId: session.id,
            roomId: session.room_id,
            myPrepQuestion: {
                title: receiverAssignment.question_title,
                difficulty: receiverAssignment.question_difficulty,
                category: receiverAssignment.question_category,
                practiceUrl: `/questions/dsa/solve?id=${receiverAssignment.question_id}`,
            },
            peerQuestionReserved: {
                title: inviterAssignment.question_title,
                difficulty: inviterAssignment.question_difficulty,
            },
        };
    });

    fastify.get("/p2p/sessions/:sessionId/prep", async (request, reply) => {
        const { sessionId } = request.params as { sessionId: string };

        const session = await prisma.peer_sessions.findUnique({
            where: { id: sessionId },
            include: {
                peer_session_participants: true,
            },
        });

        if (!session) {
            return reply.status(404).send({ error: "Session not found" });
        }

        const participant = session.peer_session_participants.find((item) => item.user_id === request.user!.id);
        if (!participant) {
            return reply.status(403).send({ error: "Forbidden" });
        }

        const assignment = await assignQuestionForUser({
            sessionId: session.id,
            userId: request.user!.id,
            level: (participant.level_at_match as PeerLevel) || "beginner",
        });

        await prisma.peer_session_question_assignments.update({
            where: { id: assignment.id },
            data: { opened_prep_at: new Date() },
        });

        return {
            sessionId: session.id,
            status: session.status,
            scheduledFor: session.scheduled_for,
            prepQuestion: {
                assignmentId: assignment.id,
                title: assignment.question_title,
                difficulty: assignment.question_difficulty,
                category: assignment.question_category,
                practiceUrl: `/questions/dsa/solve?id=${assignment.question_id}`,
            },
        };
    });

    fastify.get("/p2p/sessions/:sessionId", async (request, reply) => {
        const { sessionId } = request.params as { sessionId: string };

        const session = await prisma.peer_sessions.findUnique({
            where: { id: sessionId },
            include: {
                peer_session_participants: true,
                peer_session_question_assignments: true,
            },
        });

        if (!session) {
            return reply.status(404).send({ error: "Session not found" });
        }

        const participants = session.peer_session_participants;
        const assignments = session.peer_session_question_assignments;
        const me = participants.find((p) => p.user_id === request.user!.id);
        const peer = participants.find((p) => p.user_id !== request.user!.id) || null;

        if (!me) {
            return reply.status(403).send({ error: "Forbidden" });
        }

        const myAssignment = assignments.find((assignment) => assignment.user_id === request.user!.id) || null;
        const peerAssignment = peer
            ? assignments.find((assignment) => assignment.user_id === peer.user_id) || null
            : null;
        const timing =
            PEER_TIMING_PRESETS[session.timing_preset as keyof typeof PEER_TIMING_PRESETS]
            || PEER_TIMING_PRESETS.standard_45;

        return {
            sessionId: session.id,
            roomId: session.room_id,
            status: session.status,
            interviewType: session.interview_type,
            timingPreset: session.timing_preset,
            timing,
            startedAt: session.started_at,
            scheduledFor: session.scheduled_for,
            me: {
                userId: me.user_id,
                participantRole: me.participant_role,
                levelAtMatch: me.level_at_match,
                preferredLanguage: me.preferred_language,
                isReady: me.is_ready,
            },
            peer: peer
                ? {
                    userId: peer.user_id,
                    participantRole: peer.participant_role,
                    levelAtMatch: peer.level_at_match,
                    preferredLanguage: peer.preferred_language,
                    isReady: peer.is_ready,
                }
                : null,
            myQuestion: myAssignment
                ? {
                    questionId: myAssignment.question_id,
                    title: myAssignment.question_title,
                    difficulty: myAssignment.question_difficulty,
                    category: myAssignment.question_category,
                    practiceUrl: `/questions/dsa/solve?id=${myAssignment.question_id}`,
                }
                : null,
            peerQuestion: peerAssignment
                ? {
                    questionId: peerAssignment.question_id,
                    title: peerAssignment.question_title,
                    difficulty: peerAssignment.question_difficulty,
                    category: peerAssignment.question_category,
                    practiceUrl: `/questions/dsa/solve?id=${peerAssignment.question_id}`,
                }
                : null,
        };
    });

    fastify.post("/p2p/sessions/:sessionId/feedback", async (request, reply) => {
        const { sessionId } = request.params as { sessionId: string };
        const parsed = SubmitPeerFeedbackSchema.safeParse(request.body);

        if (!parsed.success) {
            return reply.status(400).send({
                error: "Validation Error",
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const session = await prisma.peer_sessions.findUnique({
            where: { id: sessionId },
            include: {
                peer_session_participants: true,
            },
        });

        if (!session) {
            return reply.status(404).send({ error: "Session not found" });
        }

        const participants = session.peer_session_participants;
        const me = participants.find((p) => p.user_id === request.user!.id);
        const peer = participants.find((p) => p.user_id !== request.user!.id);

        if (!me || !peer) {
            return reply.status(403).send({ error: "You are not part of this session" });
        }

        const normalizedStatus = session.status.toUpperCase();
        if (!["COMPLETED", "ABANDONED", "CANCELLED"].includes(normalizedStatus)) {
            return reply.status(409).send({
                error: "Feedback can only be submitted after the interview ends",
            });
        }

        // This service route only supports full (rated) feedback. The "session
        // didn't happen" no-show path is handled by the API server's feedback
        // endpoint. Ratings are optional on the shared schema, so require them here.
        const { problemSolving, communication, codeQuality, interviewing, overallRating } = parsed.data;
        if (
            problemSolving === undefined ||
            communication === undefined ||
            codeQuality === undefined ||
            interviewing === undefined ||
            overallRating === undefined
        ) {
            return reply.status(400).send({ error: "All ratings are required" });
        }

        await prisma.peer_feedback.upsert({
            where: {
                session_id_rater_user_id: {
                    session_id: sessionId,
                    rater_user_id: request.user!.id,
                },
            },
            update: {
                problem_solving: problemSolving,
                communication: communication,
                code_quality: codeQuality,
                interviewing: interviewing,
                overall_rating: overallRating,
                would_match_again: parsed.data.wouldMatchAgain,
                what_went_well: parsed.data.whatWentWell || null,
                improvement_areas: parsed.data.improvementAreas || null,
            },
            create: {
                id: randomUUID(),
                session_id: sessionId,
                rater_user_id: request.user!.id,
                ratee_user_id: peer.user_id,
                problem_solving: problemSolving,
                communication: communication,
                code_quality: codeQuality,
                interviewing: interviewing,
                overall_rating: overallRating,
                would_match_again: parsed.data.wouldMatchAgain,
                what_went_well: parsed.data.whatWentWell || null,
                improvement_areas: parsed.data.improvementAreas || null,
            },
        });

        // The rater is the "opponent" in the ELO update applied to the ratee.
        const raterProfile = await ensureSkillProfile(request.user!.id, "beginner");

        const updatedProfile = await applyFeedbackToProfile({
            userId: peer.user_id,
            opponentScore: Number(raterProfile.score),
            overallRating: overallRating,
            problemSolving: problemSolving,
            communication: communication,
            codeQuality: codeQuality,
            interviewing: interviewing,
        });

        const feedbackCount = await prisma.peer_feedback.count({
            where: { session_id: sessionId },
        });

        if (feedbackCount >= 2 && session.status !== "COMPLETED") {
            await prisma.peer_sessions.update({
                where: { id: sessionId },
                data: {
                    status: "COMPLETED",
                    ended_at: new Date(),
                },
            });
        }

        return {
            ok: true,
            ratee: {
                userId: peer.user_id,
                newLevel: updatedProfile.current_level,
                score: Number(updatedProfile.score),
            },
        };
    });
}
