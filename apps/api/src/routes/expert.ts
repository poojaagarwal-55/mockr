import { randomUUID } from "node:crypto";
import { FastifyInstance } from "fastify";
import { z } from "zod";
import {
    AddExpertSessionQuestionSchema,
    ClaimExpertSlotSchema,
    CreateExpertBookingRequestSchema,
    SubmitExpertFeedbackSchema,
    UpsertExpertProfileSchema,
} from "@interviewforge/shared";
import { prisma } from "../lib/prisma.js";
import { DSAQuestion } from "../models/DSAQuestion.js";
import { checkRateLimit } from "../lib/rate-limiter.js";

// Status constants — keep in lockstep with the prisma defaults so a misspelt literal
// in a query doesn't silently match nothing.
const REQUEST_STATUS = {
    OPEN: "open",
    CLAIMED: "claimed",
    EXPIRED: "expired",
    CANCELLED: "cancelled",
} as const;

const SESSION_STATUS = {
    SCHEDULED: "SCHEDULED",
    CONNECTING: "CONNECTING",
    ACTIVE: "ACTIVE",
    COMPLETED: "COMPLETED",
    CANCELLED: "CANCELLED",
    ABANDONED: "ABANDONED",
} as const;

// Temporary short lead window for active testing. Increase this before production
// if experts need more prep time before claiming a slot.
const SLOT_MIN_LEAD_MINUTES = 1;

const questionSearchSchema = z.object({
    q: z.string().trim().max(120).optional(),
    topic: z.string().trim().max(60).optional(),
    difficulty: z.enum(["Easy", "Medium", "Hard"]).optional(),
    recommended: z.coerce.boolean().optional().default(false),
    limit: z.coerce.number().int().min(1).max(30).optional().default(12),
});

// Lazy-create the expert_profiles row on first read so admin grant is just an isExpert flip.
async function ensureExpertProfile(userId: string) {
    const existing = await prisma.expert_profiles.findUnique({ where: { user_id: userId } });
    if (existing) return existing;
    return prisma.expert_profiles.create({
        data: {
            id: randomUUID(),
            user_id: userId,
            updated_at: new Date(),
        },
    });
}

function normalizeExpertBookingBody(body: unknown): unknown {
    if (!body || typeof body !== "object" || Array.isArray(body)) return body;
    const candidate = { ...(body as Record<string, unknown>) };
    if (candidate.interviewType === "system-design") {
        candidate.interviewType = "system_design";
    }
    if (candidate.interviewType === "behavioral") {
        candidate.interviewType = "behavioural";
    }
    return candidate;
}

export default async function expertRoutes(fastify: FastifyInstance) {
    fastify.addHook("preHandler", fastify.authenticate);
    fastify.addHook("preHandler", async (request, reply) => {
        const routeKey = (request as any).routerPath || request.url;
        const key = `expert:${request.method}:${routeKey}:${request.user!.id}`;
        const rl = checkRateLimit(key, 120, 60_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Expert interview limit reached. Please wait ${Math.ceil(rl.retryAfterMs / 1000)}s before trying again.`,
            });
        }
    });

    // Internal: check the user's expert flag fresh from DB. The auth snapshot has it
    // but is cached client-side; route guards always re-verify so a revoked expert
    // can't keep using a stale snapshot to claim slots.
    async function assertIsExpert(userId: string): Promise<boolean> {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { isExpert: true },
        });
        return Boolean(user?.isExpert);
    }

    // ============================================================================
    // Candidate flow
    // ============================================================================

    fastify.post("/experts/booking-requests", async (request, reply) => {
        const parsed = CreateExpertBookingRequestSchema.safeParse(normalizeExpertBookingBody(request.body));
        if (!parsed.success) {
            fastify.log.warn(
                {
                    userId: request.user!.id.slice(0, 8),
                    details: parsed.error.flatten().fieldErrors,
                },
                "Invalid expert booking request"
            );
            return reply.status(400).send({
                error: "Validation Error",
                message: "Invalid expert booking request",
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const userId = request.user!.id;
        const now = Date.now();

        const minimumStartMs = now + SLOT_MIN_LEAD_MINUTES * 60_000;
        const invalidSlots = parsed.data.slots
            .map((slot, index) => {
                const startMs = new Date(slot.startAt).getTime();
                const endMs = new Date(slot.endAt).getTime();
                const earliestPossibleStartMs = Math.max(startMs, minimumStartMs);
                return {
                    index,
                    isValid: earliestPossibleStartMs + 60 * 60_000 <= endMs,
                };
            })
            .filter((slot) => !slot.isValid);

        if (invalidSlots.length > 0) {
            return reply.status(400).send({
                error: "Validation Error",
                message: `Every availability window must fit a 60-minute interview starting at least ${SLOT_MIN_LEAD_MINUTES} minute from now.`,
                details: {
                    slots: invalidSlots.map((slot) => `Window ${slot.index + 1} cannot fit a valid 60-minute interview.`),
                },
            });
        }

        const expiresAt = new Date(now + parsed.data.expiresInHours * 60 * 60_000);

        const created = await prisma.$transaction(async (tx) => {
            const reqRow = await tx.expert_booking_requests.create({
                data: {
                    id: randomUUID(),
                    candidate_user_id: userId,
                    interview_type: parsed.data.interviewType,
                    preferred_language: parsed.data.preferredLanguage,
                    level: parsed.data.level,
                    topics_focus: parsed.data.topicsFocus,
                    notes: parsed.data.notes,
                    status: REQUEST_STATUS.OPEN,
                    expires_at: expiresAt,
                    updated_at: new Date(),
                },
            });

            await tx.expert_booking_slots.createMany({
                data: parsed.data.slots.map((slot) => ({
                    id: randomUUID(),
                    request_id: reqRow.id,
                    start_at: new Date(slot.startAt),
                    end_at: new Date(slot.endAt),
                    candidate_timezone: slot.timezone,
                })),
            });

            return reqRow;
        });

        return reply.status(201).send({
            requestId: created.id,
            status: created.status,
            expiresAt: created.expires_at,
            slotCount: parsed.data.slots.length,
        });
    });

    fastify.get("/experts/me/booking-requests", async (request) => {
        const rows = await prisma.expert_booking_requests.findMany({
            where: { candidate_user_id: request.user!.id },
            include: { slots: { orderBy: { start_at: "asc" } } },
            orderBy: { created_at: "desc" },
            take: 50,
        });

        return {
            requests: rows.map((row) => ({
                id: row.id,
                interviewType: row.interview_type,
                preferredLanguage: row.preferred_language,
                level: row.level,
                topicsFocus: row.topics_focus,
                notes: row.notes,
                status: row.status,
                expiresAt: row.expires_at,
                createdAt: row.created_at,
                slots: row.slots.map((slot) => ({
                    id: slot.id,
                    startAt: slot.start_at,
                    endAt: slot.end_at,
                    timezone: slot.candidate_timezone,
                    claimedByExpertId: slot.claimed_by_expert_id,
                    resultingSessionId: slot.resulting_session_id,
                })),
            })),
        };
    });

    fastify.post("/experts/booking-requests/:requestId/cancel", async (request, reply) => {
        const { requestId } = request.params as { requestId: string };

        // Only the candidate who owns the request can cancel it, and only while open.
        const updated = await prisma.expert_booking_requests.updateMany({
            where: {
                id: requestId,
                candidate_user_id: request.user!.id,
                status: REQUEST_STATUS.OPEN,
            },
            data: { status: REQUEST_STATUS.CANCELLED, updated_at: new Date() },
        });

        if (updated.count === 0) {
            return reply.status(409).send({
                error: "Request already claimed, expired, or not yours to cancel.",
            });
        }

        return { ok: true };
    });

    fastify.get("/experts/me/sessions", async (request) => {
        // Returns both upcoming AND past sessions where this user is the candidate.
        // The expert UI uses a different endpoint (/experts/me/expert-sessions).
        const rows = await prisma.expert_sessions.findMany({
            where: { candidate_user_id: request.user!.id },
            include: {
                expert: { select: { id: true, fullName: true, avatarUrl: true } },
                feedback: true,
            },
            orderBy: { scheduled_for: "desc" },
            take: 50,
        });

        return {
            sessions: rows.map((row) => ({
                id: row.id,
                status: row.status,
                interviewType: row.interview_type,
                preferredLanguage: row.preferred_language,
                scheduledFor: row.scheduled_for,
                endsAt: row.ends_at,
                startedAt: row.started_at,
                endedAt: row.ended_at,
                roomId: row.room_id,
                expert: row.expert,
                feedbackAvailable: row.feedback.some((fb) => fb.shared_with_candidate),
            })),
        };
    });

    // ============================================================================
    // Expert flow (gated)
    // ============================================================================

    fastify.get("/experts/profile", async (request, reply) => {
        if (!(await assertIsExpert(request.user!.id))) {
            return reply.status(403).send({ error: "Forbidden" });
        }
        const profile = await ensureExpertProfile(request.user!.id);
        return {
            bio: profile.bio,
            expertiseTags: profile.expertise_tags,
            yearsExperience: profile.years_experience,
            acceptingBookings: profile.accepting_bookings,
            ratingAvg: profile.rating_avg ? Number(profile.rating_avg) : null,
            sessionsCompleted: profile.sessions_completed,
        };
    });

    fastify.patch("/experts/profile", async (request, reply) => {
        if (!(await assertIsExpert(request.user!.id))) {
            return reply.status(403).send({ error: "Forbidden" });
        }
        const parsed = UpsertExpertProfileSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({
                error: "Validation Error",
                details: parsed.error.flatten().fieldErrors,
            });
        }
        await ensureExpertProfile(request.user!.id);
        const updated = await prisma.expert_profiles.update({
            where: { user_id: request.user!.id },
            data: {
                bio: parsed.data.bio,
                expertise_tags: parsed.data.expertiseTags,
                years_experience: parsed.data.yearsExperience,
                accepting_bookings: parsed.data.acceptingBookings,
            },
        });
        return {
            bio: updated.bio,
            expertiseTags: updated.expertise_tags,
            yearsExperience: updated.years_experience,
            acceptingBookings: updated.accepting_bookings,
            ratingAvg: updated.rating_avg ? Number(updated.rating_avg) : null,
            sessionsCompleted: updated.sessions_completed,
        };
    });

    fastify.get("/experts/inbox", async (request, reply) => {
        if (!(await assertIsExpert(request.user!.id))) {
            return reply.status(403).send({ error: "Forbidden" });
        }

        // Show open requests that still have at least one unclaimed window where a
        // 60-minute interview can start either at the candidate's start or the
        // current lead-time cutoff, whichever is later.
        const cutoff = new Date(Date.now() + SLOT_MIN_LEAD_MINUTES * 60_000);
        const rows = await prisma.expert_booking_requests.findMany({
            where: {
                status: REQUEST_STATUS.OPEN,
                expires_at: { gt: new Date() },
            },
            include: {
                slots: {
                    where: {
                        claimed_by_expert_id: null,
                        end_at: { gt: cutoff },
                    },
                    orderBy: { start_at: "asc" },
                },
                users: { select: { id: true, fullName: true, avatarUrl: true } },
            },
            orderBy: { created_at: "desc" },
            take: 100,
        });

        const minimumEndMs = cutoff.getTime() + 60 * 60_000;
        const usable = rows
            .map((row) => ({
                ...row,
                slots: row.slots.filter((slot) => {
                    const earliestStartMs = Math.max(slot.start_at.getTime(), cutoff.getTime());
                    return earliestStartMs + 60 * 60_000 <= slot.end_at.getTime()
                        && slot.end_at.getTime() >= minimumEndMs;
                }),
            }))
            .filter((row) => row.slots.length > 0);

        return {
            requests: usable.map((row) => ({
                id: row.id,
                interviewType: row.interview_type,
                preferredLanguage: row.preferred_language,
                level: row.level,
                topicsFocus: row.topics_focus,
                notes: row.notes,
                createdAt: row.created_at,
                expiresAt: row.expires_at,
                candidate: row.users,
                slots: row.slots.map((slot) => ({
                    id: slot.id,
                    startAt: slot.start_at,
                    endAt: slot.end_at,
                    timezone: slot.candidate_timezone,
                })),
            })),
        };
    });

    fastify.post("/experts/slots/:slotId/claim", async (request, reply) => {
        const parsed = ClaimExpertSlotSchema.safeParse({
            ...((request.body as Record<string, unknown>) || {}),
            slotId: (request.params as { slotId: string }).slotId,
        });
        if (!parsed.success) {
            return reply.status(400).send({
                error: "Validation Error",
                message: "Choose an exact start time inside the candidate's free window.",
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const { slotId } = parsed.data;
        const expertId = request.user!.id;

        if (!(await assertIsExpert(expertId))) {
            return reply.status(403).send({ error: "Forbidden" });
        }

        const slot = await prisma.expert_booking_slots.findUnique({
            where: { id: slotId },
            include: { request: true },
        });
        if (!slot || !slot.request) {
            return reply.status(404).send({ error: "Slot or request not found." });
        }

        if (slot.request.status !== REQUEST_STATUS.OPEN || slot.request.expires_at <= new Date()) {
            return reply.status(409).send({ error: "This request is no longer open." });
        }

        const exactStartAt = new Date(parsed.data.exactStartAt);
        const exactEndAt = new Date(exactStartAt.getTime() + parsed.data.durationMinutes * 60_000);
        const cutoff = new Date(Date.now() + SLOT_MIN_LEAD_MINUTES * 60_000);

        if (exactStartAt < slot.start_at || exactEndAt > slot.end_at) {
            return reply.status(400).send({
                error: "Validation Error",
                message: "Exact interview time must fit inside the candidate's availability window.",
            });
        }

        if (exactStartAt <= cutoff) {
            return reply.status(400).send({
                error: "Validation Error",
                message: `Choose a time at least ${SLOT_MIN_LEAD_MINUTES} minutes from now.`,
            });
        }

        // Race-safe claim: first writer wins. We can't put the whole flow inside the
        // updateMany because we also need to mark the request CLAIMED and create the
        // session, but if THIS write returns count=1 we own the slot.
        const claimAt = new Date();
        const won = await prisma.expert_booking_slots.updateMany({
            where: { id: slotId, claimed_by_expert_id: null },
            data: { claimed_by_expert_id: expertId, claimed_at: claimAt },
        });

        if (won.count === 0) {
            return reply.status(409).send({ error: "Slot already claimed by another expert." });
        }

        // We own the slot. Now create the exact scheduled session, mark the request
        // CLAIMED, and back-link the resulting session id onto the availability slot.
        const sessionId = randomUUID();
        const roomId = randomUUID();

        await prisma.$transaction([
            prisma.expert_sessions.create({
                data: {
                    id: sessionId,
                    room_id: roomId,
                    request_id: slot.request_id,
                    slot_id: slot.id,
                    candidate_user_id: slot.request.candidate_user_id,
                    expert_user_id: expertId,
                    interview_type: slot.request.interview_type,
                    preferred_language: slot.request.preferred_language,
                    status: SESSION_STATUS.SCHEDULED,
                    scheduled_for: exactStartAt,
                    ends_at: exactEndAt,
                    updated_at: new Date(),
                },
            }),
            prisma.expert_booking_slots.update({
                where: { id: slot.id },
                data: { resulting_session_id: sessionId },
            }),
            prisma.expert_booking_requests.update({
                where: { id: slot.request_id },
                data: { status: REQUEST_STATUS.CLAIMED, updated_at: new Date() },
            }),
        ]);

        return reply.status(201).send({
            sessionId,
            roomId,
            scheduledFor: exactStartAt,
            endsAt: exactEndAt,
        });
    });

    fastify.get("/experts/me/expert-sessions", async (request, reply) => {
        if (!(await assertIsExpert(request.user!.id))) {
            return reply.status(403).send({ error: "Forbidden" });
        }
        const rows = await prisma.expert_sessions.findMany({
            where: { expert_user_id: request.user!.id },
            include: {
                candidate: { select: { id: true, fullName: true, avatarUrl: true } },
                feedback: true,
                questions: { orderBy: { order_index: "asc" } },
            },
            orderBy: { scheduled_for: "desc" },
            take: 100,
        });
        return {
            sessions: rows.map((row) => ({
                id: row.id,
                status: row.status,
                interviewType: row.interview_type,
                preferredLanguage: row.preferred_language,
                scheduledFor: row.scheduled_for,
                endsAt: row.ends_at,
                startedAt: row.started_at,
                endedAt: row.ended_at,
                roomId: row.room_id,
                candidate: row.candidate,
                feedbackSubmitted: row.feedback.length > 0,
                questionCount: row.questions.length,
            })),
        };
    });

    fastify.get("/experts/questions/search", async (request, reply) => {
        if (!(await assertIsExpert(request.user!.id))) {
            return reply.status(403).send({ error: "Forbidden" });
        }
        const parsed = questionSearchSchema.safeParse(request.query);
        if (!parsed.success) {
            return reply.status(400).send({
                error: "Validation Error",
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const filter: Record<string, unknown> = {};
        if (parsed.data.difficulty) filter.difficulty = parsed.data.difficulty;
        if (parsed.data.topic) filter.topics = parsed.data.topic;

        if (parsed.data.recommended && !parsed.data.topic) {
            const profile = await prisma.expert_profiles.findUnique({
                where: { user_id: request.user!.id },
                select: { expertise_tags: true },
            });
            const tags = profile?.expertise_tags?.filter(Boolean).slice(0, 10) ?? [];
            if (tags.length > 0) filter.topics = { $in: tags };
        }

        if (parsed.data.q) {
            const escaped = parsed.data.q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            filter.title = { $regex: escaped, $options: "i" };
        }

        const docs = await DSAQuestion.find(filter)
            .select("_id problemId title difficulty topics")
            .limit(parsed.data.limit)
            .lean();

        return {
            questions: docs.map((doc: any) => ({
                id: String(doc._id),
                problemId: String(doc.problemId || doc._id),
                title: String(doc.title),
                difficulty: String(doc.difficulty),
                topics: Array.isArray(doc.topics) ? doc.topics.map(String) : [],
            })),
        };
    });

    // ============================================================================
    // Shared session reads + question / feedback writes
    // ============================================================================

    fastify.get("/experts/sessions/:sessionId", async (request, reply) => {
        const { sessionId } = request.params as { sessionId: string };
        const userId = request.user!.id;
        const session = await prisma.expert_sessions.findUnique({
            where: { id: sessionId },
            include: {
                candidate: { select: { id: true, fullName: true, avatarUrl: true } },
                expert: { select: { id: true, fullName: true, avatarUrl: true } },
                questions: { orderBy: { order_index: "asc" } },
                feedback: true,
            },
        });
        if (!session) return reply.status(404).send({ error: "Session not found" });

        const isCandidate = session.candidate_user_id === userId;
        const isExpert = session.expert_user_id === userId;
        if (!isCandidate && !isExpert) {
            return reply.status(403).send({ error: "Forbidden" });
        }

        const sharedFeedback = session.feedback.find((fb) => fb.shared_with_candidate);
        const ownFeedback = session.feedback[0]; // at most one per session
        return {
            id: session.id,
            roomId: session.room_id,
            status: session.status,
            interviewType: session.interview_type,
            preferredLanguage: session.preferred_language,
            scheduledFor: session.scheduled_for,
            endsAt: session.ends_at,
            startedAt: session.started_at,
            endedAt: session.ended_at,
            myRole: isExpert ? "expert" : "candidate",
            candidate: session.candidate,
            expert: session.expert,
            questions: session.questions.map((q) => ({
                id: q.id,
                questionId: q.question_id,
                title: q.question_title,
                difficulty: q.question_difficulty,
                topic: q.question_topic,
                isCustom: q.is_custom,
                customPrompt: q.custom_prompt,
                orderIndex: q.order_index,
            })),
            feedback: isExpert
                ? (ownFeedback
                    ? {
                        problemSolving: ownFeedback.problem_solving,
                        communication: ownFeedback.communication,
                        codeQuality: ownFeedback.code_quality,
                        technicalDepth: ownFeedback.technical_depth,
                        overallRating: ownFeedback.overall_rating,
                        hireDecision: ownFeedback.hire_decision,
                        strengths: ownFeedback.strengths,
                        improvementAreas: ownFeedback.improvement_areas,
                        privateNotes: ownFeedback.private_notes,
                        sharedWithCandidate: ownFeedback.shared_with_candidate,
                    }
                    : null)
                : (sharedFeedback
                    ? {
                        problemSolving: sharedFeedback.problem_solving,
                        communication: sharedFeedback.communication,
                        codeQuality: sharedFeedback.code_quality,
                        technicalDepth: sharedFeedback.technical_depth,
                        overallRating: sharedFeedback.overall_rating,
                        hireDecision: sharedFeedback.hire_decision,
                        strengths: sharedFeedback.strengths,
                        improvementAreas: sharedFeedback.improvement_areas,
                        // privateNotes never returned to candidate.
                    }
                    : null),
        };
    });

    fastify.post("/experts/sessions/:sessionId/questions", async (request, reply) => {
        const parsed = AddExpertSessionQuestionSchema.safeParse({
            ...((request.body as Record<string, unknown>) || {}),
            sessionId: (request.params as { sessionId: string }).sessionId,
        });
        if (!parsed.success) {
            return reply.status(400).send({
                error: "Validation Error",
                details: parsed.error.flatten().fieldErrors,
            });
        }
        const session = await prisma.expert_sessions.findUnique({
            where: { id: parsed.data.sessionId },
            select: { id: true, expert_user_id: true, status: true },
        });
        if (!session) return reply.status(404).send({ error: "Session not found" });
        if (session.expert_user_id !== request.user!.id) {
            return reply.status(403).send({ error: "Only the assigned expert can add questions." });
        }
        if (![SESSION_STATUS.SCHEDULED, SESSION_STATUS.CONNECTING, SESSION_STATUS.ACTIVE].includes(session.status as any)) {
            return reply.status(409).send({ error: "Questions can only be added before the session ends." });
        }

        const nextIndex = await prisma.expert_session_questions.count({
            where: { session_id: session.id },
        });

        const created = await prisma.expert_session_questions.create({
            data: {
                id: randomUUID(),
                session_id: session.id,
                question_id: parsed.data.isCustom ? null : (parsed.data.questionId ?? null),
                question_title: parsed.data.questionTitle,
                question_difficulty: parsed.data.questionDifficulty,
                question_topic: parsed.data.questionTopic,
                is_custom: parsed.data.isCustom,
                custom_prompt: parsed.data.customPrompt,
                order_index: nextIndex,
                added_by_user_id: request.user!.id,
            },
        });
        return reply.status(201).send({
            id: created.id,
            orderIndex: created.order_index,
        });
    });

    fastify.delete("/experts/sessions/:sessionId/questions/:questionAssignmentId", async (request, reply) => {
        const { sessionId, questionAssignmentId } = request.params as {
            sessionId: string;
            questionAssignmentId: string;
        };
        const session = await prisma.expert_sessions.findUnique({
            where: { id: sessionId },
            select: { expert_user_id: true, status: true },
        });
        if (!session) return reply.status(404).send({ error: "Session not found" });
        if (session.expert_user_id !== request.user!.id) {
            return reply.status(403).send({ error: "Only the assigned expert can remove questions." });
        }
        if (![SESSION_STATUS.SCHEDULED, SESSION_STATUS.CONNECTING, SESSION_STATUS.ACTIVE].includes(session.status as any)) {
            return reply.status(409).send({ error: "Questions can only be removed before the session ends." });
        }
        await prisma.expert_session_questions.deleteMany({
            where: { id: questionAssignmentId, session_id: sessionId },
        });
        return { ok: true };
    });

    fastify.post("/experts/sessions/:sessionId/join", async (request, reply) => {
        const { sessionId } = request.params as { sessionId: string };
        const userId = request.user!.id;
        const session = await prisma.expert_sessions.findUnique({
            where: { id: sessionId },
            select: {
                id: true,
                room_id: true,
                candidate_user_id: true,
                expert_user_id: true,
                status: true,
                scheduled_for: true,
                ends_at: true,
                started_at: true,
                candidate_admitted_at: true,
                _count: { select: { questions: true } },
            },
        });

        if (!session) return reply.status(404).send({ error: "Session not found" });
        const isParticipant = session.candidate_user_id === userId || session.expert_user_id === userId;
        if (!isParticipant) return reply.status(403).send({ error: "Forbidden" });

        if ([SESSION_STATUS.CANCELLED, SESSION_STATUS.ABANDONED, SESSION_STATUS.COMPLETED].includes(session.status as any)) {
            return reply.status(409).send({ error: "Session is already finished." });
        }

        if (session.expert_user_id === userId && session._count.questions === 0) {
            return reply.status(409).send({
                error: "Question required",
                message: "Select at least one question before joining the expert interview.",
            });
        }

        const now = new Date();
        const joinOpensAt = new Date(session.scheduled_for.getTime() - 10 * 60_000);
        const joinClosesAt = new Date((session.ends_at ?? new Date(session.scheduled_for.getTime() + 60 * 60_000)).getTime() + 15 * 60_000);

        if (now < joinOpensAt) {
            return reply.status(409).send({ error: "Join window has not opened yet." });
        }
        if (now > joinClosesAt) {
            return reply.status(409).send({ error: "Join window has closed." });
        }

        const isExpert = session.expert_user_id === userId;
        const shouldMarkStarted = isExpert && [SESSION_STATUS.SCHEDULED, SESSION_STATUS.CONNECTING].includes(session.status as any);
        const updated = shouldMarkStarted
            ? await prisma.expert_sessions.update({
                where: { id: session.id },
                data: {
                    status: SESSION_STATUS.CONNECTING,
                    started_at: session.started_at ?? now,
                    updated_at: now,
                },
                select: {
                    id: true,
                    status: true,
                    started_at: true,
                    room_id: true,
                    candidate_admitted_at: true,
                },
            })
            : {
                id: session.id,
                status: session.status,
                started_at: session.started_at,
                room_id: session.room_id,
                candidate_admitted_at: session.candidate_admitted_at,
            };

        return {
            id: updated.id,
            status: updated.status,
            startedAt: updated.started_at,
            roomId: updated.room_id,
            admitted: Boolean(updated.candidate_admitted_at),
            waitingForExpert: !isExpert && !updated.candidate_admitted_at,
        };
    });

    fastify.post("/experts/sessions/:sessionId/feedback", async (request, reply) => {
        const parsed = SubmitExpertFeedbackSchema.safeParse({
            ...((request.body as Record<string, unknown>) || {}),
            sessionId: (request.params as { sessionId: string }).sessionId,
        });
        if (!parsed.success) {
            return reply.status(400).send({
                error: "Validation Error",
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const session = await prisma.expert_sessions.findUnique({
            where: { id: parsed.data.sessionId },
            select: { id: true, expert_user_id: true, candidate_user_id: true, status: true },
        });
        if (!session) return reply.status(404).send({ error: "Session not found" });
        if (session.expert_user_id !== request.user!.id) {
            return reply.status(403).send({ error: "Only the assigned expert can submit feedback." });
        }
        // Feedback can be submitted any time after the interview reaches a terminal state.
        const terminal: string[] = [SESSION_STATUS.COMPLETED, SESSION_STATUS.ABANDONED, SESSION_STATUS.CANCELLED];
        if (!terminal.includes(session.status)) {
            return reply.status(409).send({ error: "Feedback can only be submitted after the session ends." });
        }

        const existingFeedback = await prisma.expert_feedback.findUnique({
            where: { session_id: session.id },
            select: { id: true },
        });

        const feedback = await prisma.expert_feedback.upsert({
            where: { session_id: session.id },
            update: {
                problem_solving: parsed.data.problemSolving,
                communication: parsed.data.communication,
                code_quality: parsed.data.codeQuality,
                technical_depth: parsed.data.technicalDepth,
                overall_rating: parsed.data.overallRating,
                hire_decision: parsed.data.hireDecision,
                strengths: parsed.data.strengths,
                improvement_areas: parsed.data.improvementAreas,
                private_notes: parsed.data.privateNotes,
                shared_with_candidate: parsed.data.sharedWithCandidate,
            },
            create: {
                id: randomUUID(),
                session_id: session.id,
                expert_user_id: session.expert_user_id,
                candidate_user_id: session.candidate_user_id,
                problem_solving: parsed.data.problemSolving,
                communication: parsed.data.communication,
                code_quality: parsed.data.codeQuality,
                technical_depth: parsed.data.technicalDepth,
                overall_rating: parsed.data.overallRating,
                hire_decision: parsed.data.hireDecision,
                strengths: parsed.data.strengths,
                improvement_areas: parsed.data.improvementAreas,
                private_notes: parsed.data.privateNotes,
                shared_with_candidate: parsed.data.sharedWithCandidate,
            },
        });

        if (!existingFeedback) {
            await prisma.expert_profiles.upsert({
                where: { user_id: session.expert_user_id },
                update: {
                    sessions_completed: { increment: 1 },
                },
                create: {
                    id: randomUUID(),
                    user_id: session.expert_user_id,
                    sessions_completed: 1,
                    updated_at: new Date(),
                },
            });
        }

        return { feedbackId: feedback.id };
    });

    fastify.post("/experts/sessions/:sessionId/complete", async (request, reply) => {
        const { sessionId } = request.params as { sessionId: string };
        const userId = request.user!.id;
        const session = await prisma.expert_sessions.findUnique({
            where: { id: sessionId },
            select: { candidate_user_id: true, expert_user_id: true, status: true },
        });
        if (!session) return reply.status(404).send({ error: "Session not found" });
        if (session.expert_user_id !== userId && session.candidate_user_id !== userId) {
            return reply.status(403).send({ error: "Only a session participant can complete this session." });
        }
        if ([SESSION_STATUS.CANCELLED, SESSION_STATUS.ABANDONED, SESSION_STATUS.COMPLETED].includes(session.status as any)) {
            return reply.status(409).send({ error: "Session is already finished." });
        }
        await prisma.expert_sessions.update({
            where: { id: sessionId },
            data: {
                status: SESSION_STATUS.COMPLETED,
                ended_at: new Date(),
                updated_at: new Date(),
            },
        });
        return { ok: true };
    });

    fastify.post("/experts/sessions/:sessionId/cancel", async (request, reply) => {
        const { sessionId } = request.params as { sessionId: string };
        const userId = request.user!.id;
        const session = await prisma.expert_sessions.findUnique({
            where: { id: sessionId },
            select: { candidate_user_id: true, expert_user_id: true, status: true, started_at: true },
        });
        if (!session) return reply.status(404).send({ error: "Session not found" });
        if (session.candidate_user_id !== userId && session.expert_user_id !== userId) {
            return reply.status(403).send({ error: "Forbidden" });
        }
        if (session.started_at) {
            return reply.status(409).send({ error: "Session already started — use end-session inside the room." });
        }
        if (session.status !== SESSION_STATUS.SCHEDULED) {
            return reply.status(409).send({ error: "Session is no longer cancellable." });
        }
        await prisma.expert_sessions.update({
            where: { id: sessionId },
            data: { status: SESSION_STATUS.CANCELLED, ended_at: new Date(), updated_at: new Date() },
        });
        return { ok: true };
    });
}
