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
import { DSAQuestion } from "../models/DSAQuestion.js";
import { prisma } from "../lib/prisma.js";
import { getRedis } from "../lib/redis.js";
import { getGeminiClient, GEMINI_MODEL } from "../lib/gemini.js";
import { sendEmail } from "../lib/email.js";

// Every new peer-interview booking pings the platform owner here.
const PEER_BOOKING_NOTIFY_EMAIL = "fahadkorba@gmail.com";
const escapeHtml = (value: string): string =>
    value.replace(/[<>&]/g, (c) => (c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;"));

const STAR_FIELD_LABELS = {
    problemSolving: "Problem solving",
    codeQuality: "Coding / code quality",
    communication: "Communication",
    interviewing: "Interviewing skills (as the interviewer)",
} as const;

type PeerSummary = {
    overview: string;
    strength: string;
    improvement: string;
};

// Generate a concise, insightful 3-point summary of the candidate's performance
// from their partner's feedback. Returns null on failure so the report can fall
// back gracefully.
//   - overview: whether they solved the question + the picture painted by stars
//   - strength: grounded in the partner's "what went well" text
//   - improvement: grounded in the partner's "what to improve" text
async function generatePeerPerformanceSummary(input: {
    questionTitle: string;
    difficulty: string;
    solvedQuestion: boolean | null;
    ratings: { problemSolving: number; codeQuality: number; communication: number; interviewing: number };
    overallScore: number;
    whatWentWell: string | null;
    improvementAreas: string | null;
}): Promise<PeerSummary | null> {
    try {
        const starsText = (Object.keys(STAR_FIELD_LABELS) as Array<keyof typeof STAR_FIELD_LABELS>)
            .map((key) => `- ${STAR_FIELD_LABELS[key]}: ${input.ratings[key]}/5`)
            .join("\n");

        const solvedText =
            input.solvedQuestion === null
                ? "Not specified"
                : input.solvedQuestion
                    ? "Yes, the candidate solved the question"
                    : "No, the candidate did not fully solve the question";

        const result = await getGeminiClient().models.generateContent({
            model: GEMINI_MODEL,
            contents: [{
                role: "user",
                parts: [{
                    text: `You are an interview coach summarizing how a candidate performed in a peer-to-peer coding interview. Their interview partner rated them and left written feedback. Return STRICT JSON only with exactly these keys: "overview", "strength", "improvement".

Coding question: "${input.questionTitle}" (${input.difficulty})
Solved the question: ${solvedText}
Overall score: ${input.overallScore}/100

Partner's star ratings (1-5):
${starsText}

What the partner said went well:
${input.whatWentWell?.trim() || "(none provided)"}

What the partner said could be improved:
${input.improvementAreas?.trim() || "(none provided)"}

Write each field in second person ("You ..."), 1-2 sentences, specific and insightful (not generic), plain text (no markdown):
- "overview": Lead with whether they solved the question, then summarize the overall picture from the star ratings (call out the strongest and weakest rated areas). Do not just restate numbers.
- "strength": Base this on what the partner said went well. If the partner gave no text, infer the key strength from the highest star ratings.
- "improvement": Base this on what the partner said could be improved. If the partner gave no text, infer the main area to improve from the lowest star ratings.`,
                }],
            }],
            config: { responseMimeType: "application/json", temperature: 0.5 },
        });

        const parsed = JSON.parse(result.text || "{}") as Partial<PeerSummary>;
        const overview = String(parsed.overview || "").trim();
        const strength = String(parsed.strength || "").trim();
        const improvement = String(parsed.improvement || "").trim();
        if (!overview && !strength && !improvement) {
            return null;
        }
        return { overview, strength, improvement };
    } catch (error) {
        const message = error instanceof Error ? error.message : "unknown";
        console.warn("[p2p][ai-summary]", { message });
        return null;
    }
}

function solutionCodeForLanguage(
    solutionCode: Map<string, string> | Record<string, string> | undefined | null,
    preferredLanguage: string
): { language: string; code: string } | null {
    if (!solutionCode) return null;
    const entries =
        solutionCode instanceof Map
            ? Array.from(solutionCode.entries())
            : Object.entries(solutionCode);
    if (entries.length === 0) return null;

    const normalized = preferredLanguage.toLowerCase();
    const aliases: Record<string, string[]> = {
        cpp: ["cpp", "c++", "cplusplus"],
        python: ["python", "python3", "py"],
        javascript: ["javascript", "js", "node"],
        typescript: ["typescript", "ts"],
        java: ["java"],
        go: ["go", "golang"],
    };
    const wanted = aliases[normalized] || [normalized];

    const match = entries.find(([lang]) => wanted.includes(lang.toLowerCase()));
    const [language, code] = match || entries[0];
    return { language, code };
}

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
const PEER_SLOT_START_HOUR = 9;
const PEER_SLOT_END_HOUR = 23;
const PEER_SLOT_LOOKAHEAD_DAYS = 14;
const FEEDBACK_READY_STATUSES = new Set(["COMPLETED", "ABANDONED", "CANCELLED"]);
const DEV_PEER_TEST_SLOT_WINDOW_MS = 5 * 60_000;

function scheduledQueueKey(slotMs: number, language: string): string {
    return `slot:${slotMs}:lang:${language}`;
}

function isDevPeerTestSlot(scheduledFor: Date, now: Date): boolean {
    if (process.env.NODE_ENV === "production") {
        return false;
    }

    const msUntilSlot = scheduledFor.getTime() - now.getTime();
    return msUntilSlot >= 30_000 && msUntilSlot <= DEV_PEER_TEST_SLOT_WINDOW_MS;
}

function getTimeZoneParts(date: Date, timeZone: string) {
    const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour12: false,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
    const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
    return {
        year: Number(parts.year),
        month: Number(parts.month),
        day: Number(parts.day),
        // Intl with hour12:false renders midnight as "24" in some environments;
        // normalize it to 0 so midnight slots compare correctly (e.g. 12:00 AM).
        hour: Number(parts.hour) % 24,
        minute: Number(parts.minute),
    };
}

function validateScheduledSlot(scheduledFor: Date, timeZone: string): string | null {
    if (Number.isNaN(scheduledFor.getTime())) {
        return "Invalid scheduled time";
    }

    const now = new Date();
    const isDevTestSlot = isDevPeerTestSlot(scheduledFor, now);

    if (scheduledFor.getTime() < now.getTime() + 30_000) {
        return "Pick a future interview slot";
    }

    if (scheduledFor.getTime() > now.getTime() + PEER_SLOT_LOOKAHEAD_DAYS * 24 * 60 * 60_000) {
        return `Slots can be booked up to ${PEER_SLOT_LOOKAHEAD_DAYS} days ahead`;
    }

    let parts: ReturnType<typeof getTimeZoneParts>;
    try {
        parts = getTimeZoneParts(scheduledFor, timeZone);
    } catch {
        return "Invalid time zone";
    }

    if (!isDevTestSlot && parts.minute !== 0) {
        return "Peer interviews can only be booked on hourly slots";
    }

    if (!isDevTestSlot && (parts.hour < PEER_SLOT_START_HOUR || parts.hour > PEER_SLOT_END_HOUR)) {
        return "Pick a slot between 9 AM and 11 PM in your time zone";
    }

    return null;
}

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

// Decaying K-factor: aggressive early (~224 on the first rating), settling
// toward ~24 as the user accumulates rated sessions.
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

    for (const difficulty of difficultyOrder) {
        const filter = {
            difficulty,
            ...(excludeQuestionIds.length > 0 ? { _id: { $nin: excludeQuestionIds } } : {}),
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

    const fallback = await DSAQuestion.findOne({})
        .select("_id problemId title difficulty topics")
        .lean();

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
                question_id: picked._id,
                question_title: picked.title,
                question_category: picked.topics[0] || "DSA",
                question_difficulty: picked.difficulty,
            },
        });
    }

    // Chess-style rating update: treat the partner who rated this user as the
    // "opponent", derive a performance outcome from the feedback, compare it to
    // the expected outcome given the rating gap, and apply a decaying K-factor.
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

    // Mint short-lived WebRTC ICE servers for the interview room. Uses Cloudflare
    // Realtime TURN (credentials generated server-side per request so nothing
    // sensitive lives in the client bundle, and they auto-expire). Falls back to
    // STUN-only when the Cloudflare token isn't configured, so the room still
    // works on permissive networks during setup.
    fastify.get("/p2p/ice-servers", async (request) => {
        const fallback = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
        const keyId = process.env.CLOUDFLARE_TURN_KEY_ID;
        const apiToken = process.env.CLOUDFLARE_TURN_API_TOKEN;
        if (!keyId || !apiToken) {
            return fallback;
        }

        try {
            const response = await fetch(
                `https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`,
                {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${apiToken}`,
                        "Content-Type": "application/json",
                    },
                    // TTL comfortably covers a 60-minute session plus reconnects.
                    body: JSON.stringify({ ttl: 86400 }),
                }
            );

            if (!response.ok) {
                request.log.warn({ status: response.status }, "[p2p][turn] Cloudflare ICE generation failed");
                return fallback;
            }

            const data = (await response.json()) as { iceServers?: unknown };
            const raw = data.iceServers;
            const cfServers = Array.isArray(raw) ? raw : raw ? [raw] : [];
            if (cfServers.length === 0) {
                return fallback;
            }

            return { iceServers: [{ urls: "stun:stun.l.google.com:19302" }, ...cfServers] };
        } catch (error) {
            const message = error instanceof Error ? error.message : "unknown";
            request.log.warn({ message }, "[p2p][turn] Cloudflare ICE request errored");
            return fallback;
        }
    });

    fastify.post("/p2p/profile", async (request, reply) => {
        const parsed = createProfileSchema.safeParse(request.body);

        if (!parsed.success) {
            return reply.status(400).send({
                error: "Validation Error",
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const existing = await ensureSkillProfile(request.user!.id, parsed.data.level);

        // Only the first explicit level choice seeds the rating. Re-posting later
        // never resets an established rating; it just confirms onboarding.
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

        const scheduledFor = new Date(parsed.data.scheduledFor);
        const timeZone = parsed.data.timeZone || "UTC";
        const slotError = validateScheduledSlot(scheduledFor, timeZone);
        if (slotError) {
            return reply.status(400).send({ error: slotError });
        }

        const existingActiveBooking = await prisma.peer_sessions.findFirst({
            where: {
                status: { in: ["PENDING", "MATCHED", "CONNECTING", "ACTIVE"] },
                scheduled_for: scheduledFor,
                peer_session_participants: {
                    some: { user_id: request.user!.id },
                },
            },
            select: { id: true },
        });

        if (existingActiveBooking) {
            return reply.status(409).send({ error: "You already have a peer interview in this slot" });
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
                scheduled_for: scheduledFor,
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
                expires_at: scheduledFor,
                matched_session_id: peerSession.id,
                updated_at: new Date(),
            },
        });

        // Booking only registers the user for the slot. Matching happens live in
        // the waiting room at slot time (see the lobby matcher in the p2p service),
        // so there is no pre-slot queue to seed here.

        // Question assignment is best-effort here; the GET handler lazily assigns
        // if MongoDB is temporarily unavailable at booking time.
        let assignment: Awaited<ReturnType<typeof assignQuestionForUser>> | null = null;
        try {
            assignment = await assignQuestionForUser({
                sessionId: peerSession.id,
                userId: request.user!.id,
                level: profile.current_level as PeerLevel,
            });
        } catch {
            // MongoDB transient error — booking still succeeds; question assigned on first GET
        }

        // Notify the platform owner of every new peer-interview booking.
        // Best-effort: a mail failure must never fail the booking. Awaited (not
        // fire-and-forget) so it completes before Cloud Run may throttle CPU.
        try {
            const booker = await prisma.user.findUnique({
                where: { id: request.user!.id },
                select: { fullName: true, email: true },
            });
            const bookerName = booker?.fullName?.trim() || "A user";
            const bookerEmail = booker?.email || request.user!.email || "unknown";
            const slotLocal = scheduledFor.toLocaleString("en-US", { timeZone, dateStyle: "full", timeStyle: "short" });
            const slotIST = scheduledFor.toLocaleString("en-US", { timeZone: "Asia/Kolkata", dateStyle: "full", timeStyle: "short" });
            await sendEmail({
                to: PEER_BOOKING_NOTIFY_EMAIL,
                isAuthEmail: true,
                subject: `New peer interview booking — ${bookerName}`,
                html: `
                    <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;color:#334155">
                      <h2 style="color:#0f172a;margin:0 0 14px">New peer interview booking</h2>
                      <table style="border-collapse:collapse;font-size:14px">
                        <tr><td style="padding:6px 16px 6px 0;color:#64748b">Booked by</td><td style="padding:6px 0;font-weight:600">${escapeHtml(bookerName)} &lt;${escapeHtml(bookerEmail)}&gt;</td></tr>
                        <tr><td style="padding:6px 16px 6px 0;color:#64748b">Interview type</td><td style="padding:6px 0;font-weight:600">${escapeHtml(String(parsed.data.interviewType))}</td></tr>
                        <tr><td style="padding:6px 16px 6px 0;color:#64748b">Language</td><td style="padding:6px 0;font-weight:600">${escapeHtml(String(parsed.data.preferredLanguage))}</td></tr>
                        <tr><td style="padding:6px 16px 6px 0;color:#64748b">Slot (${escapeHtml(timeZone)})</td><td style="padding:6px 0;font-weight:600">${escapeHtml(slotLocal)}</td></tr>
                        <tr><td style="padding:6px 16px 6px 0;color:#64748b">Slot (IST)</td><td style="padding:6px 0;font-weight:600">${escapeHtml(slotIST)}</td></tr>
                        <tr><td style="padding:6px 16px 6px 0;color:#64748b">Session ID</td><td style="padding:6px 0;font-family:monospace;font-size:12px">${peerSession.id}</td></tr>
                      </table>
                    </div>`,
            });
        } catch (err) {
            request.log.warn({ err }, "[p2p] Failed to send peer booking notification email");
        }

        return reply.status(201).send({
            sessionId: peerSession.id,
            roomId: peerSession.room_id,
            status: peerSession.status,
            scheduledFor: peerSession.scheduled_for,
            prepQuestion: assignment ? {
                assignmentId: assignment.id,
                title: assignment.question_title,
                difficulty: assignment.question_difficulty,
                category: assignment.question_category,
                practiceUrl: `/questions/dsa/solve?id=${assignment.question_id}`,
            } : null,
        });
    });

    fastify.get("/p2p/me/sessions", async (request) => {
        const sessions = await prisma.peer_sessions.findMany({
            where: {
                peer_session_participants: {
                    some: { user_id: request.user!.id },
                },
                status: { notIn: ["CANCELLED"] },
                OR: [
                    // Live / upcoming sessions always surface, regardless of age, so a
                    // freshly booked future slot can never be crowded out of the list.
                    { status: { in: ["PENDING", "MATCHED", "CONNECTING", "ACTIVE"] } },
                    // Recently ended sessions feed the "pending feedback" list. Bounding
                    // this to the last week keeps the result small instead of returning
                    // the user's entire interview history.
                    {
                        AND: [
                            { status: { in: ["COMPLETED", "ABANDONED"] } },
                            { ended_at: { gte: new Date(Date.now() - 7 * 24 * 60 * 60_000) } },
                        ],
                    },
                ],
            },
            include: {
                peer_session_participants: true,
                peer_session_question_assignments: true,
                peer_feedback: true,
            },
            orderBy: [
                { scheduled_for: "asc" },
                { created_at: "desc" },
            ],
            take: 50,
        });

        return {
            sessions: sessions.map((session) => {
                const me = session.peer_session_participants.find((participant) => participant.user_id === request.user!.id);
                const myQuestion = session.peer_session_question_assignments.find((assignment) => assignment.user_id === request.user!.id);
                const receivedFeedback = session.peer_feedback.find((feedback) => feedback.ratee_user_id === request.user!.id) || null;
                const submittedFeedback = session.peer_feedback.some((feedback) => feedback.rater_user_id === request.user!.id);

                return {
                    sessionId: session.id,
                    status: session.status,
                    source: session.source,
                    scheduledFor: session.scheduled_for,
                    startedAt: session.started_at,
                    endedAt: session.ended_at,
                    timingPreset: session.timing_preset,
                    participantRole: me?.participant_role || "candidate",
                    preferredLanguage: me?.preferred_language || "python",
                    isReady: Boolean(me?.is_ready),
                    hasPeer: session.peer_session_participants.length >= 2,
                    canSubmitFeedback: Boolean(session.started_at && FEEDBACK_READY_STATUSES.has(session.status)),
                    submittedFeedback,
                    prepQuestion: myQuestion
                        ? {
                            assignmentId: myQuestion.id,
                            title: myQuestion.question_title,
                            difficulty: myQuestion.question_difficulty,
                            category: myQuestion.question_category,
                            practiceUrl: `/questions/dsa/solve?id=${myQuestion.question_id}`,
                        }
                        : null,
                    receivedFeedback: receivedFeedback
                        ? {
                            overallRating: receivedFeedback.overall_rating,
                            problemSolving: receivedFeedback.problem_solving,
                            communication: receivedFeedback.communication,
                            codeQuality: receivedFeedback.code_quality,
                            interviewing: receivedFeedback.interviewing,
                            wouldMatchAgain: receivedFeedback.would_match_again,
                            whatWentWell: receivedFeedback.what_went_well,
                            improvementAreas: receivedFeedback.improvement_areas,
                        }
                        : null,
                };
            }),
        };
    });

    fastify.get("/p2p/me/reports", async (request) => {
        const userId = request.user!.id;

        // Completed: partner submitted real feedback about me (session_happened = true)
        const completedSessions = await prisma.peer_sessions.findMany({
            where: {
                peer_session_participants: { some: { user_id: userId } },
                peer_feedback: { some: { ratee_user_id: userId, session_happened: true } as any },
            },
            include: {
                peer_session_participants: { where: { user_id: userId } },
                peer_feedback: { where: { ratee_user_id: userId, session_happened: true } as any },
            },
            orderBy: { ended_at: "desc" },
        });

        const reports = completedSessions.map((s) => {
            const feedback = s.peer_feedback[0]!;
            const participant = s.peer_session_participants[0];
            const avgRating =
                (feedback.overall_rating + feedback.problem_solving + feedback.communication + feedback.code_quality) / 4;
            const overallScore = Math.round((avgRating / 5) * 100);
            return {
                id: `peer:${s.id}`,
                sessionId: s.id,
                overallScore,
                generatedAt: (s.ended_at ?? s.updated_at).toISOString(),
                session: {
                    id: s.id,
                    role: participant?.participant_role ?? "candidate",
                    level: participant?.level_at_match ?? "beginner",
                    type: "coding",
                },
            };
        });

        // Pending: I submitted real feedback (session_happened = true) but haven't received any yet
        const sessionsWithMyRealSubmission = await prisma.peer_sessions.findMany({
            where: {
                peer_session_participants: { some: { user_id: userId } },
                peer_feedback: { some: { rater_user_id: userId, session_happened: true } as any },
                started_at: { not: null },
            },
            include: {
                peer_session_participants: { where: { user_id: userId } },
                peer_feedback: {
                    where: {
                        OR: [{ rater_user_id: userId }, { ratee_user_id: userId }],
                    },
                },
            },
            orderBy: { ended_at: "desc" },
        });

        const pendingReports = sessionsWithMyRealSubmission
            .filter((s) => !s.peer_feedback.some((f) => f.ratee_user_id === userId))
            .map((s) => {
                const participant = s.peer_session_participants[0];
                return {
                    id: `peer-pending:${s.id}`,
                    sessionId: s.id,
                    generatedAt: (s.ended_at ?? s.updated_at).toISOString(),
                };
            });

        return { reports, pendingReports, total: reports.length };
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
            !invite
            || invite.revoked_at
            || invite.expires_at.getTime() < Date.now()
            || invite.used_count >= invite.max_uses
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
        let assignments = session.peer_session_question_assignments;
        const me = participants.find((p) => p.user_id === request.user!.id);
        const peer = participants.find((p) => p.user_id !== request.user!.id) || null;

        if (!me) {
            return reply.status(403).send({ error: "Forbidden" });
        }

        // Lobby-merged sessions can leave a participant without a question
        // assignment (theirs was created on a now-cancelled original session).
        // Ensure every participant has one so role switches always have a
        // question to display instead of "still syncing".
        const participantsMissingQuestion = participants.filter(
            (participant) => !assignments.some((assignment) => assignment.user_id === participant.user_id)
        );
        if (participantsMissingQuestion.length > 0) {
            for (const participant of participantsMissingQuestion) {
                await assignQuestionForUser({
                    sessionId: session.id,
                    userId: participant.user_id,
                    level: (participant.level_at_match as PeerLevel) || "beginner",
                });
            }
            assignments = await prisma.peer_session_question_assignments.findMany({
                where: { session_id: session.id },
            });
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

    fastify.post("/p2p/sessions/:sessionId/cancel", async (request, reply) => {
        const { sessionId } = request.params as { sessionId: string };

        const session = await prisma.peer_sessions.findUnique({
            where: { id: sessionId },
            include: { peer_session_participants: true },
        });

        if (!session) {
            return reply.status(404).send({ error: "Session not found" });
        }

        const me = session.peer_session_participants.find((participant) => participant.user_id === request.user!.id);
        if (!me) {
            return reply.status(403).send({ error: "Forbidden" });
        }

        if (session.started_at || ["ACTIVE", "COMPLETED", "ABANDONED", "CANCELLED"].includes(session.status)) {
            return reply.status(409).send({ error: "This session can no longer be cancelled here" });
        }

        const others = session.peer_session_participants.filter((participant) => participant.user_id !== request.user!.id);

        if (others.length === 0) {
            await prisma.peer_sessions.update({
                where: { id: session.id },
                data: {
                    status: "CANCELLED",
                    ended_at: new Date(),
                    updated_at: new Date(),
                },
            });
        } else {
            await prisma.$transaction(async (tx) => {
                await tx.peer_session_participants.delete({ where: { id: me.id } });
                await tx.peer_sessions.update({
                    where: { id: session.id },
                    data: {
                        status: "PENDING",
                        updated_at: new Date(),
                    },
                });
                await tx.peer_session_participants.updateMany({
                    where: { session_id: session.id },
                    data: {
                        participant_role: "candidate",
                        is_ready: false,
                    },
                });
            });
        }

        await prisma.peer_queue_tickets.updateMany({
            where: {
                matched_session_id: session.id,
                user_id: request.user!.id,
                status: { in: ["queued", "scheduled"] },
            },
            data: {
                status: "cancelled",
                updated_at: new Date(),
            },
        });

        if (session.scheduled_for) {
            const redis = getRedis();
            if (redis) {
                await (redis as any).zrem(
                    scheduledQueueKey(session.scheduled_for.getTime(), me.preferred_language),
                    request.user!.id
                );
            }
        }

        return { ok: true };
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
        if (!session.started_at || !["COMPLETED", "ABANDONED", "CANCELLED"].includes(normalizedStatus)) {
            return reply.status(409).send({
                error: "Feedback can only be submitted after the interview ends",
            });
        }

        const fbData = parsed.data;

        if (fbData.sessionHappened === false) {
            // Rater says the session never happened — record it so this session leaves
            // the pending-feedback list, but skip all rating/ELO logic.
            await prisma.peer_feedback.upsert({
                where: { session_id_rater_user_id: { session_id: sessionId, rater_user_id: request.user!.id } },
                update: { session_happened: false },
                create: {
                    id: randomUUID(),
                    session_id: sessionId,
                    rater_user_id: request.user!.id,
                    ratee_user_id: peer.user_id,
                    problem_solving: 0,
                    communication: 0,
                    code_quality: 0,
                    interviewing: 0,
                    overall_rating: 0,
                    would_match_again: false,
                    session_happened: false,
                } as any,
            });
            return { ok: true };
        }

        // Guaranteed non-null by superRefine when sessionHappened !== false.
        const ps = fbData.problemSolving!;
        const comm = fbData.communication!;
        const cq = fbData.codeQuality!;
        const iv = fbData.interviewing!;
        const or = fbData.overallRating!;

        await prisma.peer_feedback.upsert({
            where: {
                session_id_rater_user_id: {
                    session_id: sessionId,
                    rater_user_id: request.user!.id,
                },
            },
            update: {
                problem_solving: ps,
                communication: comm,
                code_quality: cq,
                interviewing: iv,
                overall_rating: or,
                solved_question: fbData.solvedQuestion ?? null,
                would_match_again: fbData.wouldMatchAgain,
                what_went_well: fbData.whatWentWell || null,
                improvement_areas: fbData.improvementAreas || null,
                session_happened: true,
                // Ratings changed → invalidate any cached AI summary so the report
                // regenerates it from the updated feedback.
                ai_summary: null,
            },
            create: {
                id: randomUUID(),
                session_id: sessionId,
                rater_user_id: request.user!.id,
                ratee_user_id: peer.user_id,
                problem_solving: ps,
                communication: comm,
                code_quality: cq,
                interviewing: iv,
                overall_rating: or,
                solved_question: fbData.solvedQuestion ?? null,
                would_match_again: fbData.wouldMatchAgain,
                what_went_well: fbData.whatWentWell || null,
                improvement_areas: fbData.improvementAreas || null,
                session_happened: true,
            } as any,
        });

        // The rater is the "opponent" in the ELO update applied to the ratee.
        const raterProfile = await ensureSkillProfile(request.user!.id, "beginner");

        const updatedProfile = await applyFeedbackToProfile({
            userId: peer.user_id,
            opponentScore: Number(raterProfile.score),
            overallRating: or,
            problemSolving: ps,
            communication: comm,
            codeQuality: cq,
            interviewing: iv,
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

    // Full post-session report for the requesting user: overall score, the
    // feedback their partner gave, an AI-generated performance summary, the
    // coding question, their submitted code, and the sample answer.
    fastify.get("/p2p/sessions/:sessionId/report", async (request, reply) => {
        const { sessionId } = request.params as { sessionId: string };
        const userId = request.user!.id;

        const session = await prisma.peer_sessions.findUnique({
            where: { id: sessionId },
            include: {
                peer_session_participants: true,
                peer_session_question_assignments: true,
                peer_feedback: true,
            },
        });

        if (!session) {
            return reply.status(404).send({ error: "Session not found" });
        }

        const me = session.peer_session_participants.find((p) => p.user_id === userId);
        if (!me) {
            return reply.status(403).send({ error: "Forbidden" });
        }

        // Feedback ABOUT me (the partner is the rater, I'm the ratee).
        // Exclude records where partner indicated the session never happened.
        const feedback = session.peer_feedback.find(
            (f) => f.ratee_user_id === userId && (f as any).session_happened !== false
        ) || null;
        if (!feedback) {
            return reply.status(404).send({ error: "No feedback available for this session yet" });
        }

        // As the candidate I solved the question my partner (the interviewer)
        // prepared, and my code was saved onto their assignment. So the report's
        // question + code come from the partner's assignment, not my own (which my
        // partner solved and which feeds THEIR report).
        const peerParticipant = session.peer_session_participants.find((p) => p.user_id !== userId) || null;
        const myAssignment =
            (peerParticipant
                ? session.peer_session_question_assignments.find((a) => a.user_id === peerParticipant.user_id)
                : null)
            || session.peer_session_question_assignments.find((a) => a.user_id === userId)
            || null;

        const ratings = {
            problemSolving: feedback.problem_solving,
            codeQuality: feedback.code_quality,
            communication: feedback.communication,
            interviewing: feedback.interviewing,
        };

        const avgRating =
            (feedback.overall_rating + ratings.problemSolving + ratings.communication + ratings.codeQuality) / 4;
        const overallScore = Math.round((avgRating / 5) * 100);

        const language = myAssignment?.final_language || me.preferred_language || "python";

        // Pull the question detail (description + topics + sample solution) from Mongo.
        let questionDescription: string | null = null;
        let questionTopics: string[] = [];
        let sampleAnswer: { language: string; code: string; explanation: string | null } | null = null;
        if (myAssignment?.question_id) {
            try {
                let doc = null;
                try {
                    doc = await DSAQuestion.findById(myAssignment.question_id).lean();
                } catch {
                    // not a valid ObjectId — fall through to problemId lookup
                }
                if (!doc) {
                    doc = await DSAQuestion.findOne({ problemId: myAssignment.question_id }).lean();
                }
                if (doc) {
                    questionDescription = typeof doc.description === "string" ? doc.description : null;
                    questionTopics = Array.isArray(doc.topics) ? doc.topics.map(String) : [];
                    const optimized = doc.solution?.optimized;
                    const picked = solutionCodeForLanguage(optimized?.code as never, language);
                    if (picked) {
                        sampleAnswer = {
                            language: picked.language,
                            code: picked.code,
                            explanation: optimized?.explanation || null,
                        };
                    }
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : "unknown";
                console.warn("[p2p][report][question]", { sessionId, message });
            }
        }

        // AI summary — cached on the feedback row as JSON, regenerated when
        // feedback changes (the feedback POST nulls ai_summary on update).
        let summary: PeerSummary | null = null;
        if (feedback.ai_summary) {
            try {
                summary = JSON.parse(feedback.ai_summary) as PeerSummary;
            } catch {
                summary = null;
            }
        }
        if (!summary) {
            summary = await generatePeerPerformanceSummary({
                questionTitle: myAssignment?.question_title || "the coding question",
                difficulty: myAssignment?.question_difficulty || "",
                solvedQuestion: feedback.solved_question,
                ratings,
                overallScore,
                whatWentWell: feedback.what_went_well,
                improvementAreas: feedback.improvement_areas,
            });
            if (summary) {
                await prisma.peer_feedback.update({
                    where: { id: feedback.id },
                    data: { ai_summary: JSON.stringify(summary) },
                }).catch(() => undefined);
            }
        }

        return {
            sessionId: session.id,
            interviewType: session.interview_type,
            generatedAt: session.ended_at ?? session.updated_at,
            overallScore,
            language,
            solvedQuestion: feedback.solved_question,
            ratings,
            whatWentWell: feedback.what_went_well,
            improvementAreas: feedback.improvement_areas,
            aiSummary: summary,
            question: myAssignment
                ? {
                    questionId: myAssignment.question_id,
                    title: myAssignment.question_title,
                    difficulty: myAssignment.question_difficulty,
                    category: myAssignment.question_category,
                    topics: questionTopics,
                    description: questionDescription,
                    practiceUrl: `/questions/dsa/solve?id=${myAssignment.question_id}`,
                }
                : null,
            myCode: myAssignment?.final_code
                ? { code: myAssignment.final_code, language }
                : null,
            sampleAnswer,
        };
    });
}
