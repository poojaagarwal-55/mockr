import { randomBytes, randomUUID } from "node:crypto";
import type {
    AcceptPeerInviteInput,
    CreatePeerInviteInput,
    JoinPeerQueueInput,
    PeerEditorSyncInput,
    PeerSessionEndInput,
    PeerTurnControlInput,
} from "@interviewforge/shared";
import type { Server } from "socket.io";
import { prisma } from "../lib/prisma.js";
import { redis } from "../lib/redis.js";
import { LevelingService } from "./leveling.service.js";

type QueueEntry = {
    userId: string;
    role: string;
    level: "beginner" | "intermediate" | "advanced";
    interviewType: "coding" | "system_design" | "behavioural";
    preferredLanguage: string;
    timingPreset: "standard_45" | "intense_30" | "deep_60";
    queueTicketId: string;
    createdAt: number;
};

type SessionParticipantRecord = {
    userId: string;
    participantRole: string;
    preferredLanguage: string;
    isReady: boolean;
};

type ScheduledSessionCandidate = {
    id: string;
    room_id: string;
    interview_type: string;
    scheduled_for: Date | null;
    peer_session_participants: Array<{
        id: string;
        user_id: string;
        level_at_match: string;
        preferred_language: string;
        is_ready: boolean;
        created_at: Date;
    }>;
};

type RuntimeSessionState = {
    peerSessionId: string;
    turnNumber: 1 | 2;
    firstInterviewerUserId: string;
    activeInterviewerUserId: string;
    activeCandidateUserId: string;
    turnStartedAtMs: number;
    turnEndsAtMs: number;
    editorRevision: number;
    editorCode: string;
    editorLanguage: string;
    updatedByUserId: string | null;
    updatedAtMs: number;
};

const ROOM_PREFIX = "peer_session:";
const QUEUE_FALLBACK_DELAY_MS = 60_000;
const SCHEDULED_FALLBACK_OFFSET_MS = 10 * 60_000;
const SCHEDULED_PRIMARY_CUTOFF_MS = 2 * 60 * 60_000;
const SCHEDULED_FALLBACK_CUTOFF_MS = 90 * 60_000;
const SCHEDULED_EXTENSION_INTERVAL_MS = 30 * 60_000;
const MAX_SCHEDULED_EXTENSION_ATTEMPTS = 2;
// How often the matchmaking orchestrator runs (lobby pairing, countdown/turn
// transitions). Each tick does at least one Redis lock command even at idle, so
// on a small/free Redis quota this can be raised (e.g. 5000) to cut command
// volume, at the cost of slightly slower matching + start-countdown. Min 1s.
const SCHEDULED_ORCHESTRATOR_INTERVAL_MS = (() => {
    const parsed = Number.parseInt(process.env.P2P_ORCHESTRATOR_INTERVAL_MS || "2000", 10);
    return Number.isFinite(parsed) && parsed >= 1_000 ? parsed : 2_000;
})();
const FIXED_TIMING_PRESET = "deep_60" as const;
const PRE_START_COUNTDOWN_SECONDS = 60;
// Short "starting in 5…1" countdown shown once two lobby peers are matched.
const LOBBY_AUTOSTART_COUNTDOWN_SECONDS = 5;
// Lobby matching is same-level-only for the first 2 minutes, then opens to other
// levels. If still unmatched 5 minutes after joining the lobby, we give up.
const LOBBY_SAME_LEVEL_GRACE_MS = 2 * 60_000;
const LOBBY_GIVE_UP_MS = 5 * 60_000;
// A booked user who never shows up to the lobby is cancelled this long after the
// slot time so the slot frees up and drops off their upcoming list.
const NO_SHOW_GRACE_MS = 5 * 60_000;
const NO_SHOW_REMATCH_GRACE_MS = 5 * 60_000;
const TURN_DURATION_SECONDS = 30 * 60;
const SESSION_TTL_SECONDS = 2 * 60 * 60;
const RUNTIME_TTL_SECONDS = SESSION_TTL_SECONDS;
const ORCHESTRATOR_LOCK_TTL_SECONDS = 4;

type RuntimeSessionStateRedis = Omit<RuntimeSessionState, "peerSessionId">;

type ScheduledExtensionState = {
    attempt: number;
    nextRetryAtMs: number;
};

export class MatchmakingService {
    private readonly leveling = new LevelingService();
    private readonly disconnectTimers = new Map<string, NodeJS.Timeout>();
    private readonly queueFallbackTimers = new Map<string, NodeJS.Timeout>();
    // Per-session timers that promote CONNECTING -> ACTIVE exactly at the
    // countdown deadline, so the room opens the instant the on-screen "5…1"
    // countdown ends rather than on the next orchestrator poll.
    private readonly countdownActivationTimers = new Map<string, NodeJS.Timeout>();
    private readonly sessionParticipantsCache = new Map<string, Set<string>>();
    private scheduledOrchestratorTimer: NodeJS.Timeout | null = null;
    private scheduledOrchestratorRunning = false;

    constructor(private readonly io: Server) {}

    private roomName(peerSessionId: string): string {
        return `${ROOM_PREFIX}${peerSessionId}`;
    }

    roomForSession(peerSessionId: string): string {
        return this.roomName(peerSessionId);
    }

    startBackgroundWorkers(): void {
        if (this.scheduledOrchestratorTimer) {
            return;
        }

        this.scheduledOrchestratorTimer = setInterval(() => {
            void this.runScheduledOrchestratorCycle().catch((error) => {
                console.error("[p2p][scheduled-orchestrator]", error);
            });
        }, SCHEDULED_ORCHESTRATOR_INTERVAL_MS);
    }

    stopBackgroundWorkers(): void {
        if (!this.scheduledOrchestratorTimer) {
            return;
        }

        clearInterval(this.scheduledOrchestratorTimer);
        this.scheduledOrchestratorTimer = null;

        for (const timer of this.countdownActivationTimers.values()) {
            clearTimeout(timer);
        }
        this.countdownActivationTimers.clear();
    }

    async getActiveSessionForUser(userId: string): Promise<string | null> {
        return redis.get(`peer_user_room:${userId}`);
    }

    private updateParticipantCache(peerSessionId: string, userIds: string[]): void {
        const cleaned = userIds.filter((userId) => Boolean(userId));
        if (cleaned.length === 0) {
            return;
        }

        this.sessionParticipantsCache.set(peerSessionId, new Set(cleaned));
    }

    private async getParticipantUserIds(peerSessionId: string): Promise<Set<string>> {
        const cached = this.sessionParticipantsCache.get(peerSessionId);
        if (cached && cached.size > 0) {
            return cached;
        }

        const participants = await prisma.peer_session_participants.findMany({
            where: { session_id: peerSessionId },
            select: { user_id: true },
        });

        const userIds = participants.map((participant) => participant.user_id);
        const next = new Set(userIds);

        if (next.size > 0) {
            this.sessionParticipantsCache.set(peerSessionId, next);
        }

        return next;
    }

    private async getSessionParticipants(peerSessionId: string): Promise<SessionParticipantRecord[]> {
        const participants = await prisma.peer_session_participants.findMany({
            where: { session_id: peerSessionId },
            select: {
                user_id: true,
                participant_role: true,
                preferred_language: true,
                is_ready: true,
            },
        });

        this.updateParticipantCache(peerSessionId, participants.map((participant) => participant.user_id));

        return participants.map((participant) => ({
            userId: participant.user_id,
            participantRole: participant.participant_role,
            preferredLanguage: participant.preferred_language,
            isReady: participant.is_ready,
        }));
    }

    private async emitToSessionUsers(peerSessionId: string, event: string, payload: unknown): Promise<void> {
        const participants = await this.getSessionParticipants(peerSessionId);

        this.io.to(this.roomName(peerSessionId)).emit(event, payload);
        participants.forEach((participant) => {
            this.io.to(`user:${participant.userId}`).emit(event, payload);
        });
    }

    private async clearRuntimeSession(peerSessionId: string): Promise<void> {
        await redis.del(this.sessionCountdownDeadlineKey(peerSessionId), this.runtimeStateKey(peerSessionId));
        this.sessionParticipantsCache.delete(peerSessionId);
    }

    private scheduledExtensionKey(peerSessionId: string): string {
        return `peer_scheduled_extension_attempt:${peerSessionId}`;
    }

    private parseScheduledExtensionState(raw: string | null): ScheduledExtensionState {
        if (!raw) {
            return { attempt: 0, nextRetryAtMs: 0 };
        }

        const legacyAttempt = Number.parseInt(raw, 10);
        if (!Number.isNaN(legacyAttempt)) {
            return { attempt: legacyAttempt, nextRetryAtMs: 0 };
        }

        try {
            const parsed = JSON.parse(raw) as Partial<ScheduledExtensionState>;
            return {
                attempt: Number.isFinite(parsed.attempt) ? Number(parsed.attempt) : 0,
                nextRetryAtMs: Number.isFinite(parsed.nextRetryAtMs) ? Number(parsed.nextRetryAtMs) : 0,
            };
        } catch {
            return { attempt: 0, nextRetryAtMs: 0 };
        }
    }

    private runtimeStateKey(peerSessionId: string): string {
        return `peer_runtime:${peerSessionId}`;
    }

    private sessionCountdownDeadlineKey(peerSessionId: string): string {
        return `peer_countdown_deadline:${peerSessionId}`;
    }

    private lobbyRematchDeadlineKey(peerSessionId: string): string {
        return `peer_lobby_rematch_deadline:${peerSessionId}`;
    }

    private orchestratorLockKey(): string {
        return "peer_scheduled_orchestrator_lock";
    }

    private async acquireOrchestratorLock(): Promise<string | null> {
        const token = randomUUID();
        const acquired = await redis.setnxex(this.orchestratorLockKey(), ORCHESTRATOR_LOCK_TTL_SECONDS, token);
        return acquired ? token : null;
    }

    private async releaseOrchestratorLock(token: string): Promise<void> {
        const key = this.orchestratorLockKey();
        const current = await redis.get(key);
        if (current === token) {
            await redis.del(key);
        }
    }

    private async getRuntimeState(peerSessionId: string): Promise<RuntimeSessionState | null> {
        const raw = await redis.get(this.runtimeStateKey(peerSessionId));
        if (!raw) {
            return null;
        }

        const parsed = JSON.parse(raw) as RuntimeSessionStateRedis;
        return {
            peerSessionId,
            ...parsed,
        };
    }

    private async setRuntimeState(peerSessionId: string, state: RuntimeSessionState): Promise<void> {
        const { peerSessionId: _ignored, ...rest } = state;
        await redis.setex(this.runtimeStateKey(peerSessionId), RUNTIME_TTL_SECONDS, JSON.stringify(rest));
    }

    private async getCountdownDeadlineMs(peerSessionId: string): Promise<number | null> {
        const raw = await redis.get(this.sessionCountdownDeadlineKey(peerSessionId));
        if (!raw) {
            return null;
        }

        const parsed = Number.parseInt(raw, 10);
        return Number.isNaN(parsed) ? null : parsed;
    }

    private levelRank(level: string): number {
        if (level === "advanced") return 3;
        if (level === "intermediate") return 2;
        return 1;
    }

    private getScheduledParticipant(session: ScheduledSessionCandidate) {
        return session.peer_session_participants[0] || null;
    }

    private getScheduledSlotKey(session: ScheduledSessionCandidate): number {
        return session.scheduled_for?.getTime() ?? 0;
    }

    private getScheduledBatchKey(session: ScheduledSessionCandidate): string {
        return `${this.getScheduledSlotKey(session)}:${session.interview_type}`;
    }

    private getScheduledScore(session: ScheduledSessionCandidate, profileScores: Map<string, number>): number {
        const participant = this.getScheduledParticipant(session);
        if (!participant) {
            return 50;
        }

        return profileScores.get(participant.user_id) ?? 50;
    }

    private isPrimaryCutoffDue(session: ScheduledSessionCandidate, nowMs: number): boolean {
        const slotMs = this.getScheduledSlotKey(session);
        return slotMs > 0 && slotMs - nowMs <= SCHEDULED_PRIMARY_CUTOFF_MS;
    }

    private isFallbackCutoffDue(session: ScheduledSessionCandidate, nowMs: number): boolean {
        const slotMs = this.getScheduledSlotKey(session);
        return slotMs > 0 && slotMs - nowMs <= SCHEDULED_FALLBACK_CUTOFF_MS;
    }

    private async isDeferredScheduledSessionDue(session: ScheduledSessionCandidate, nowMs: number): Promise<boolean> {
        const rawAttempt = await redis.get(this.scheduledExtensionKey(session.id));
        const extension = this.parseScheduledExtensionState(rawAttempt);
        const slotMs = this.getScheduledSlotKey(session);

        if (slotMs <= 0) {
            return true;
        }

        if (slotMs <= nowMs) {
            return true;
        }

        if (extension.nextRetryAtMs > 0) {
            return nowMs >= extension.nextRetryAtMs;
        }

        return true;
    }

    private scoreScheduledMatch(
        a: ScheduledSessionCandidate,
        b: ScheduledSessionCandidate,
        profileScores: Map<string, number>
    ): number {
        if (a.interview_type !== b.interview_type) {
            return Number.POSITIVE_INFINITY;
        }

        const aParticipant = this.getScheduledParticipant(a);
        const bParticipant = this.getScheduledParticipant(b);

        if (!aParticipant || !bParticipant) {
            return Number.POSITIVE_INFINITY;
        }

        if (aParticipant.user_id === bParticipant.user_id) {
            return Number.POSITIVE_INFINITY;
        }

        const languagePenalty = aParticipant.preferred_language === bParticipant.preferred_language ? 0 : 10_000;
        const scoreGap = Math.abs(
            (profileScores.get(aParticipant.user_id) ?? 50) - (profileScores.get(bParticipant.user_id) ?? 50)
        );
        const levelGap = Math.abs(
            this.levelRank(aParticipant.level_at_match) - this.levelRank(bParticipant.level_at_match)
        );
        const readinessBonus = aParticipant.is_ready && bParticipant.is_ready ? -100 : 0;

        return languagePenalty + scoreGap * 10 + levelGap * 25 + readinessBonus;
    }

    private sortScheduledByScore(
        sessions: ScheduledSessionCandidate[],
        profileScores: Map<string, number>
    ): ScheduledSessionCandidate[] {
        return [...sessions].sort((a, b) => {
            const scoreDiff = this.getScheduledScore(a, profileScores) - this.getScheduledScore(b, profileScores);
            if (scoreDiff !== 0) {
                return scoreDiff;
            }

            return a.id.localeCompare(b.id);
        });
    }

    private buildAdjacentScheduledPairs(
        sessions: ScheduledSessionCandidate[],
        profileScores: Map<string, number>
    ): Array<[ScheduledSessionCandidate, ScheduledSessionCandidate]> {
        const sorted = this.sortScheduledByScore(sessions, profileScores);
        const pairs: Array<[ScheduledSessionCandidate, ScheduledSessionCandidate]> = [];

        for (let i = 0; i + 1 < sorted.length; i += 2) {
            const first = sorted[i];
            const second = sorted[i + 1];
            if (first && second) {
                pairs.push([first, second]);
            }
        }

        return pairs;
    }

    private pickBestFallbackPartner(
        current: ScheduledSessionCandidate,
        candidates: ScheduledSessionCandidate[],
        consumedSessionIds: Set<string>,
        profileScores: Map<string, number>,
        requireDifferentLanguage: boolean
    ): ScheduledSessionCandidate | null {
        const currentParticipant = this.getScheduledParticipant(current);
        if (!currentParticipant) {
            return null;
        }

        let best: ScheduledSessionCandidate | null = null;
        let bestScore = Number.POSITIVE_INFINITY;

        for (const candidate of candidates) {
            if (candidate.id === current.id || consumedSessionIds.has(candidate.id)) {
                continue;
            }

            const candidateParticipant = this.getScheduledParticipant(candidate);
            if (!candidateParticipant) {
                continue;
            }

            if (requireDifferentLanguage && candidateParticipant.preferred_language === currentParticipant.preferred_language) {
                continue;
            }

            const score = this.scoreScheduledMatch(current, candidate, profileScores);
            if (score < bestScore) {
                bestScore = score;
                best = candidate;
            }
        }

        return best;
    }

    private async matchScheduledSessions(
        a: ScheduledSessionCandidate,
        b: ScheduledSessionCandidate
    ): Promise<void> {
        const aTime = a.scheduled_for?.getTime() ?? 0;
        const bTime = b.scheduled_for?.getTime() ?? 0;
        const primary = aTime <= bTime ? a : b;
        const secondary = primary.id === a.id ? b : a;

        const primaryParticipant = this.getScheduledParticipant(primary);
        const secondaryParticipant = this.getScheduledParticipant(secondary);

        if (!primaryParticipant || !secondaryParticipant) {
            return;
        }

        const firstRole = Math.random() >= 0.5 ? "interviewer" : "candidate";
        const secondRole = firstRole === "interviewer" ? "candidate" : "interviewer";
        const bothAlreadyInLobby = primaryParticipant.is_ready && secondaryParticipant.is_ready;

        await prisma.$transaction(async (tx) => {
            await tx.peer_session_participants.update({
                where: { id: primaryParticipant.id },
                data: {
                    participant_role: firstRole,
                    is_ready: primaryParticipant.is_ready,
                },
            });

            await tx.peer_session_participants.create({
                data: {
                    id: randomUUID(),
                    session_id: primary.id,
                    user_id: secondaryParticipant.user_id,
                    participant_role: secondRole,
                    level_at_match: secondaryParticipant.level_at_match,
                    preferred_language: secondaryParticipant.preferred_language,
                    is_ready: secondaryParticipant.is_ready,
                },
            });

            // Carry the secondary participant's prepped question assignment onto the
            // merged (primary) session. Without this it stays on the now-cancelled
            // secondary session, so the session loader assigns them a fresh random
            // question — and they'd see a different question than the one they
            // prepped / will ask. Clear any primary-side row for this user first so
            // the move can't trip the (session_id, user_id) unique constraint.
            await tx.peer_session_question_assignments.deleteMany({
                where: { session_id: primary.id, user_id: secondaryParticipant.user_id },
            });
            await tx.peer_session_question_assignments.updateMany({
                where: { session_id: secondary.id, user_id: secondaryParticipant.user_id },
                data: { session_id: primary.id },
            });

            await tx.peer_sessions.update({
                where: { id: primary.id },
                data: {
                    status: "MATCHED",
                    timing_preset: FIXED_TIMING_PRESET,
                },
            });

            await tx.peer_sessions.update({
                where: { id: secondary.id },
                data: {
                    status: "CANCELLED",
                    ended_at: new Date(),
                },
            });

            await tx.peer_queue_tickets.updateMany({
                where: {
                    matched_session_id: { in: [primary.id, secondary.id] },
                    status: { in: ["queued", "scheduled"] },
                },
                data: {
                    status: "matched",
                    matched_session_id: primary.id,
                },
            });

            await tx.peer_match_history.create({
                data: {
                    id: randomUUID(),
                    session_id: primary.id,
                    user_a_id: primaryParticipant.user_id,
                    user_b_id: secondaryParticipant.user_id,
                },
            });
        });

        await redis.del(
            this.scheduledExtensionKey(primary.id),
            this.scheduledExtensionKey(secondary.id),
            this.lobbyRematchDeadlineKey(primary.id),
            this.lobbyRematchDeadlineKey(secondary.id)
        );
        await redis.setex(`peer_user_room:${primaryParticipant.user_id}`, SESSION_TTL_SECONDS, primary.id);
        await redis.setex(`peer_user_room:${secondaryParticipant.user_id}`, SESSION_TTL_SECONDS, primary.id);
        await redis.del(
            this.lobbySinceKey(primaryParticipant.user_id),
            this.lobbySinceKey(secondaryParticipant.user_id)
        );
        this.updateParticipantCache(primary.id, [primaryParticipant.user_id, secondaryParticipant.user_id]);

        // Tell both peers they matched so the secondary user's room redirects to
        // the merged session and both see the "You got matched!" confirmation.
        this.io.to(`user:${primaryParticipant.user_id}`).emit("peer:matched", {
            peerSessionId: primary.id,
            roomId: primary.room_id,
            peerUserId: secondaryParticipant.user_id,
            role: firstRole,
            timingPreset: FIXED_TIMING_PRESET,
        });
        this.io.to(`user:${secondaryParticipant.user_id}`).emit("peer:matched", {
            peerSessionId: primary.id,
            roomId: primary.room_id,
            peerUserId: primaryParticipant.user_id,
            role: secondRole,
            timingPreset: FIXED_TIMING_PRESET,
        });

        if (bothAlreadyInLobby) {
            // Both peers are already waiting → run the short auto-start countdown.
            await this.startLobbyAutostartCountdown(primary.id);
            return;
        }

        await this.emitSessionState(primary.id);
    }

    private lobbySinceKey(userId: string): string {
        return `peer_lobby_since:${userId}`;
    }

    // Two lobby peers were merged into one session: flip to CONNECTING, arm a
    // short countdown deadline, and broadcast it. processCountdownTransitions
    // promotes the session to ACTIVE once the deadline passes.
    private async startLobbyAutostartCountdown(peerSessionId: string): Promise<void> {
        const startsAtMs = Date.now() + LOBBY_AUTOSTART_COUNTDOWN_SECONDS * 1000;

        await prisma.peer_sessions.updateMany({
            where: { id: peerSessionId, status: { in: ["MATCHED", "PENDING"] } },
            data: { status: "CONNECTING" },
        });
        await redis.setex(
            this.sessionCountdownDeadlineKey(peerSessionId),
            LOBBY_AUTOSTART_COUNTDOWN_SECONDS + 120,
            String(startsAtMs)
        );

        await this.emitToSessionUsers(peerSessionId, "peer:session-countdown", {
            peerSessionId,
            startsInSeconds: LOBBY_AUTOSTART_COUNTDOWN_SECONDS,
            startsAt: new Date(startsAtMs).toISOString(),
        });

        this.scheduleCountdownActivation(peerSessionId, startsAtMs);

        await this.emitSessionState(peerSessionId);
    }

    // Promote CONNECTING -> ACTIVE exactly when the pre-start countdown ends,
    // instead of waiting for the next orchestrator poll. startActiveSession is
    // idempotent (its activation lock), and processCountdownTransitions stays as
    // a backstop if this instance restarts before the timer fires — so this only
    // improves punctuality and never changes what both peers receive (a single
    // room emit of the runtime state).
    private scheduleCountdownActivation(peerSessionId: string, startsAtMs: number): void {
        const existing = this.countdownActivationTimers.get(peerSessionId);
        if (existing) {
            clearTimeout(existing);
        }

        const delayMs = Math.max(0, startsAtMs - Date.now());
        const timer = setTimeout(() => {
            this.countdownActivationTimers.delete(peerSessionId);
            void this.startActiveSession(peerSessionId).catch((error) => {
                console.error("[p2p][countdown-activation]", error);
            });
        }, delayMs);

        if (typeof timer.unref === "function") {
            timer.unref();
        }

        this.countdownActivationTimers.set(peerSessionId, timer);
    }

    // Live lobby matcher. Pairs users who are physically waiting in the room at
    // slot time: same level first (longest-waiting first), opening to other
    // levels once a waiter has been in the lobby past LOBBY_SAME_LEVEL_GRACE_MS.
    private async runLobbyMatcher(): Promise<void> {
        const now = Date.now();

        const waitingSessions = await prisma.peer_sessions.findMany({
            where: {
                source: "scheduled",
                status: "PENDING",
                scheduled_for: { lte: new Date() },
                started_at: null,
            },
            include: {
                peer_session_participants: {
                    select: {
                        id: true,
                        user_id: true,
                        level_at_match: true,
                        preferred_language: true,
                        is_ready: true,
                        created_at: true,
                    },
                },
            },
            take: 500,
        });

        const ready = waitingSessions.filter(
            (session) =>
                session.peer_session_participants.length === 1 &&
                session.peer_session_participants[0]?.is_ready
        );

        if (ready.length < 2) {
            return;
        }

        const userIds = ready.map((session) => session.peer_session_participants[0]!.user_id);
        const profiles = await prisma.peer_skill_profiles.findMany({
            where: { user_id: { in: userIds } },
            select: { user_id: true, score: true, current_level: true },
        });
        const scoreByUser = new Map(profiles.map((profile) => [profile.user_id, Number(profile.score)]));
        const levelByUser = new Map(profiles.map((profile) => [profile.user_id, profile.current_level]));

        type Waiter = {
            session: ScheduledSessionCandidate;
            userId: string;
            level: string;
            score: number;
            lobbySince: number;
        };

        const waiters: Waiter[] = [];
        for (const session of ready) {
            const participant = session.peer_session_participants[0]!;
            const raw = await redis.get(this.lobbySinceKey(participant.user_id));
            const lobbySince = raw ? Number(raw) : (session.scheduled_for?.getTime() ?? now);
            waiters.push({
                session: session as ScheduledSessionCandidate,
                userId: participant.user_id,
                level: levelByUser.get(participant.user_id) ?? participant.level_at_match,
                score: scoreByUser.get(participant.user_id) ?? 250,
                lobbySince: Number.isNaN(lobbySince) ? now : lobbySince,
            });
        }

        // Match within an interview type only.
        const groups = new Map<string, Waiter[]>();
        for (const waiter of waiters) {
            const key = waiter.session.interview_type;
            groups.set(key, [...(groups.get(key) || []), waiter]);
        }

        const consumed = new Set<string>();

        // Prefer the candidate that has waited longest; break ties by nearest score.
        const pickBest = (current: Waiter, candidates: Waiter[]): Waiter | null => {
            let best: Waiter | null = null;
            for (const candidate of candidates) {
                if (!best) {
                    best = candidate;
                    continue;
                }
                if (candidate.lobbySince < best.lobbySince) {
                    best = candidate;
                } else if (
                    candidate.lobbySince === best.lobbySince &&
                    Math.abs(candidate.score - current.score) < Math.abs(best.score - current.score)
                ) {
                    best = candidate;
                }
            }
            return best;
        };

        for (const group of groups.values()) {
            const sorted = [...group].sort((a, b) => a.lobbySince - b.lobbySince);

            for (const current of sorted) {
                if (consumed.has(current.userId)) {
                    continue;
                }

                const available = sorted.filter(
                    (candidate) => candidate.userId !== current.userId && !consumed.has(candidate.userId)
                );
                if (available.length === 0) {
                    continue;
                }

                const sameLevel = available.filter((candidate) => candidate.level === current.level);
                let partner: Waiter | null = null;

                if (sameLevel.length > 0) {
                    partner = pickBest(current, sameLevel);
                } else if (now - current.lobbySince >= LOBBY_SAME_LEVEL_GRACE_MS) {
                    partner = pickBest(current, available);
                }

                if (!partner) {
                    continue;
                }

                consumed.add(current.userId);
                consumed.add(partner.userId);
                await this.matchScheduledSessions(current.session, partner.session);
            }
        }
    }

    private async extendOrCancelScheduledSession(session: {
        id: string;
        peer_session_participants: Array<{ user_id: string }>;
    }): Promise<void> {
        const participant = session.peer_session_participants[0];
        if (!participant) {
            return;
        }

        const key = this.scheduledExtensionKey(session.id);
        const currentAttemptRaw = await redis.get(key);
        const currentAttempt = this.parseScheduledExtensionState(currentAttemptRaw).attempt;

        if (currentAttempt >= MAX_SCHEDULED_EXTENSION_ATTEMPTS) {
            await prisma.peer_sessions.update({
                where: { id: session.id },
                data: {
                    status: "CANCELLED",
                    ended_at: new Date(),
                },
            });

            await prisma.peer_queue_tickets.updateMany({
                where: {
                    matched_session_id: session.id,
                    status: { in: ["queued", "scheduled"] },
                },
                data: {
                    status: "cancelled",
                    updated_at: new Date(),
                },
            });

            await redis.del(key, `peer_user_room:${participant.user_id}`);

            await this.emitToSessionUsers(session.id, "peer:session-ended", {
                peerSessionId: session.id,
                reason: "scheduled_match_timeout",
                endedAt: new Date().toISOString(),
            });

            this.io.to(`user:${participant.user_id}`).emit("peer:match-cancelled", {
                reason: "scheduled_match_timeout",
                canRequeue: true,
            });

            await this.emitSessionState(session.id);
            return;
        }

        const nextAttempt = currentAttempt + 1;
        const nextRetryAtMs = Date.now() + SCHEDULED_EXTENSION_INTERVAL_MS;

        await redis.setex(
            key,
            SESSION_TTL_SECONDS,
            JSON.stringify({ attempt: nextAttempt, nextRetryAtMs } satisfies ScheduledExtensionState)
        );

        await this.emitToSessionUsers(session.id, "peer:scheduled-extension", {
            peerSessionId: session.id,
            extensionAttempt: nextAttempt,
            maxAttempts: MAX_SCHEDULED_EXTENSION_ATTEMPTS,
            scheduledFor: new Date(nextRetryAtMs).toISOString(),
        });
    }

    private async processLobbyNoShows(): Promise<void> {
        const matchedSessions = await prisma.peer_sessions.findMany({
            where: {
                source: "scheduled",
                status: "MATCHED",
                scheduled_for: {
                    lte: new Date(),
                },
                started_at: null,
            },
            include: {
                peer_session_participants: {
                    select: {
                        id: true,
                        user_id: true,
                        participant_role: true,
                        level_at_match: true,
                        preferred_language: true,
                        is_ready: true,
                        created_at: true,
                    },
                },
            },
            take: 200,
        });

        for (const session of matchedSessions) {
            const readyParticipants = session.peer_session_participants.filter((participant) => participant.is_ready);
            const waitingParticipants = session.peer_session_participants.filter((participant) => !participant.is_ready);

            if (readyParticipants.length !== 1 || waitingParticipants.length === 0) {
                continue;
            }

            const key = this.lobbyRematchDeadlineKey(session.id);
            const rawDeadline = await redis.get(key);
            const deadlineMs = Number.parseInt(rawDeadline || "", 10);

            if (!rawDeadline || Number.isNaN(deadlineMs)) {
                await redis.setex(key, SESSION_TTL_SECONDS, String(Date.now() + NO_SHOW_REMATCH_GRACE_MS));
                continue;
            }

            if (deadlineMs > Date.now()) {
                continue;
            }

            const readyParticipant = readyParticipants[0];
            if (!readyParticipant) {
                continue;
            }

            await prisma.$transaction(async (tx) => {
                await tx.peer_session_participants.deleteMany({
                    where: {
                        session_id: session.id,
                        is_ready: false,
                    },
                });

                await tx.peer_session_participants.update({
                    where: { id: readyParticipant.id },
                    data: {
                        participant_role: "candidate",
                        is_ready: true,
                    },
                });

                await tx.peer_sessions.update({
                    where: { id: session.id },
                    data: {
                        status: "PENDING",
                        updated_at: new Date(),
                    },
                });
            });

            await redis.del(key);
            await Promise.all(
                waitingParticipants.map((participant) => redis.del(`peer_user_room:${participant.user_id}`))
            );
            await redis.setex(`peer_user_room:${readyParticipant.user_id}`, SESSION_TTL_SECONDS, session.id);
            this.updateParticipantCache(session.id, [readyParticipant.user_id]);
            await this.emitSessionState(session.id);
        }
    }

    private async processPendingLobbyTimeouts(): Promise<void> {
        const pendingSessions = await prisma.peer_sessions.findMany({
            where: {
                source: "scheduled",
                status: "PENDING",
                scheduled_for: {
                    lte: new Date(),
                },
                started_at: null,
            },
            include: {
                peer_session_participants: {
                    select: {
                        id: true,
                        user_id: true,
                        participant_role: true,
                        level_at_match: true,
                        preferred_language: true,
                        is_ready: true,
                        created_at: true,
                    },
                },
            },
            take: 200,
        });

        const now = Date.now();

        for (const session of pendingSessions) {
            // Only lone (single-participant) sessions time out here; matched pairs
            // are handled by the countdown / no-show paths.
            if (session.peer_session_participants.length !== 1) {
                continue;
            }

            const participant = session.peer_session_participants[0];
            if (!participant) {
                continue;
            }

            if (participant.is_ready) {
                // In the waiting room but still unmatched. Give up 5 minutes after
                // they joined (2 min same-level + 3 min cross-level).
                const key = this.lobbyRematchDeadlineKey(session.id);
                const rawDeadline = await redis.get(key);
                let deadlineMs = Number.parseInt(rawDeadline || "", 10);

                if (!rawDeadline || Number.isNaN(deadlineMs)) {
                    const rawSince = await redis.get(this.lobbySinceKey(participant.user_id));
                    const since = rawSince ? Number(rawSince) : now;
                    deadlineMs = (Number.isNaN(since) ? now : since) + LOBBY_GIVE_UP_MS;
                    await redis.setex(key, SESSION_TTL_SECONDS, String(deadlineMs));
                    continue;
                }

                if (deadlineMs > now) {
                    continue;
                }

                await this.cancelLoneLobbySession(session.id, participant.user_id, "no_match_found");
            } else {
                // Booked but never entered the lobby. Drop the slot once the
                // no-show grace passes so it leaves their upcoming list.
                const slotMs = session.scheduled_for?.getTime() ?? 0;
                if (slotMs <= 0 || now < slotMs + NO_SHOW_GRACE_MS) {
                    continue;
                }

                await this.cancelLoneLobbySession(session.id, participant.user_id, "no_show");
            }
        }
    }

    // Cancel a single-participant scheduled session that timed out in the lobby.
    // `no_match_found` notifies the waiting user (they get the "book another slot"
    // prompt); `no_show` just frees the slot silently.
    private async cancelLoneLobbySession(
        sessionId: string,
        userId: string,
        reason: "no_match_found" | "no_show"
    ): Promise<void> {
        await prisma.$transaction(async (tx) => {
            await tx.peer_sessions.update({
                where: { id: sessionId },
                data: {
                    status: "CANCELLED",
                    ended_at: new Date(),
                    updated_at: new Date(),
                },
            });

            await tx.peer_queue_tickets.updateMany({
                where: {
                    matched_session_id: sessionId,
                    status: { in: ["queued", "scheduled"] },
                },
                data: {
                    status: "cancelled",
                    updated_at: new Date(),
                },
            });
        });

        await redis.del(
            this.lobbyRematchDeadlineKey(sessionId),
            this.scheduledExtensionKey(sessionId),
            this.lobbySinceKey(userId),
            `peer_user_room:${userId}`
        );

        await this.emitToSessionUsers(sessionId, "peer:session-ended", {
            peerSessionId: sessionId,
            reason,
            endedAt: new Date().toISOString(),
        });

        if (reason === "no_match_found") {
            this.io.to(`user:${userId}`).emit("peer:match-cancelled", {
                reason: "no_match_found",
                canRequeue: true,
            });
        }

        await this.emitSessionState(sessionId);
    }

    async runScheduledOrchestratorCycle(): Promise<void> {
        if (this.scheduledOrchestratorRunning) {
            return;
        }

        const lockToken = await this.acquireOrchestratorLock();
        if (!lockToken) {
            return;
        }

        this.scheduledOrchestratorRunning = true;

        try {
            await this.processLobbyNoShows();

            // Matching is driven by live lobby presence at slot time, not by a
            // pre-slot cutoff. See runLobbyMatcher.
            await this.runLobbyMatcher();

            await this.processPendingLobbyTimeouts();
            await this.processCountdownTransitions();
            await this.processActiveTurnTransitions();
        } finally {
            this.scheduledOrchestratorRunning = false;
            await this.releaseOrchestratorLock(lockToken);
        }
    }

    private async processCountdownTransitions(): Promise<void> {
        const sessions = await prisma.peer_sessions.findMany({
            where: {
                status: "CONNECTING",
            },
            select: {
                id: true,
            },
            take: 200,
        });

        const now = Date.now();

        for (const session of sessions) {
            const deadlineMs = await this.getCountdownDeadlineMs(session.id);
            if (!deadlineMs || deadlineMs > now) {
                continue;
            }

            await this.startActiveSession(session.id);
        }
    }

    private async processActiveTurnTransitions(): Promise<void> {
        const activeSessions = await prisma.peer_sessions.findMany({
            where: {
                status: "ACTIVE",
            },
            select: {
                id: true,
            },
            take: 200,
        });

        const now = Date.now();

        for (const session of activeSessions) {
            try {
                const runtime = await this.ensureActiveRuntimeState(session.id);
                if (runtime.turnEndsAtMs <= now) {
                    await this.handleTurnTimeout(session.id);
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : "unknown";
                if (message !== "Session already ended") {
                    console.warn("[p2p][orchestrator][active-turn]", { sessionId: session.id, message });
                }
            }
        }
    }

    private emitTurnState(peerSessionId: string, state: RuntimeSessionState): void {
        const turnStatePayload = {
            peerSessionId,
            turnNumber: state.turnNumber,
            activeInterviewerUserId: state.activeInterviewerUserId,
            activeCandidateUserId: state.activeCandidateUserId,
            startedAt: new Date(state.turnStartedAtMs).toISOString(),
            endsAt: new Date(state.turnEndsAtMs).toISOString(),
            canCurrentInterviewerAdvance: state.turnNumber === 1,
            canCurrentInterviewerEndSession: state.turnNumber === 2,
        };
        const timerSyncPayload = {
            roundKey: `turn_${state.turnNumber}`,
            elapsedSeconds: 0,
            totalSeconds: TURN_DURATION_SECONDS,
        };

        this.io.to(this.roomName(peerSessionId)).emit("peer:turn-state", turnStatePayload);
        this.io.to(this.roomName(peerSessionId)).emit("peer:timer-sync", timerSyncPayload);

        // Also emit directly to each participant's user room so users who haven't
        // joined the session room yet (e.g. secondary user still redirecting) still
        // receive the event.
        for (const userId of [state.activeInterviewerUserId, state.activeCandidateUserId]) {
            this.io.to(`user:${userId}`).emit("peer:turn-state", turnStatePayload);
            this.io.to(`user:${userId}`).emit("peer:timer-sync", timerSyncPayload);
        }
    }

    private emitEditorState(peerSessionId: string, state: RuntimeSessionState): void {
        const editorStatePayload = {
            peerSessionId,
            code: state.editorCode,
            language: state.editorLanguage,
            revision: state.editorRevision,
            editableUserId: state.activeCandidateUserId,
            updatedByUserId: state.updatedByUserId,
            updatedAt: new Date(state.updatedAtMs).toISOString(),
        };

        this.io.to(this.roomName(peerSessionId)).emit("peer:editor-state", editorStatePayload);

        for (const userId of [state.activeInterviewerUserId, state.activeCandidateUserId]) {
            this.io.to(`user:${userId}`).emit("peer:editor-state", editorStatePayload);
        }
    }

    // Persist the candidate's final code for a turn so the post-session report
    // can show it under "Your Code". The candidate solves the question the
    // INTERVIEWER prepared, so the code belongs on the interviewer's assignment
    // (which the candidate's report reads back). Best-effort: never let a write
    // failure interrupt the session flow.
    private async persistCandidateCode(state: RuntimeSessionState): Promise<void> {
        try {
            if (!state.editorCode.trim()) {
                return;
            }
            await prisma.peer_session_question_assignments.updateMany({
                where: {
                    session_id: state.peerSessionId,
                    user_id: state.activeInterviewerUserId,
                },
                data: {
                    final_code: state.editorCode,
                    final_language: state.editorLanguage,
                },
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : "unknown";
            console.warn("[p2p][persist-candidate-code]", { peerSessionId: state.peerSessionId, message });
        }
    }

    private buildInitialRuntimeState(
        peerSessionId: string,
        participants: SessionParticipantRecord[],
        startedAtMs: number
    ): RuntimeSessionState {
        const fallbackParticipant = participants[0];
        if (!fallbackParticipant || participants.length < 2) {
            throw new Error("Cannot build runtime state without two participants");
        }

        const firstInterviewer =
            participants.find((participant) => participant.participantRole === "interviewer") || fallbackParticipant;
        const firstCandidate =
            participants.find((participant) => participant.userId !== firstInterviewer.userId) || fallbackParticipant;

        if (!firstInterviewer || !firstCandidate) {
            throw new Error("Unable to resolve initial participants for runtime state");
        }

        const now = startedAtMs;

        return {
            peerSessionId,
            turnNumber: 1,
            firstInterviewerUserId: firstInterviewer.userId,
            activeInterviewerUserId: firstInterviewer.userId,
            activeCandidateUserId: firstCandidate.userId,
            turnStartedAtMs: now,
            turnEndsAtMs: now + TURN_DURATION_SECONDS * 1000,
            editorRevision: 0,
            editorCode: "",
            editorLanguage: firstCandidate.preferredLanguage || "python",
            updatedByUserId: null,
            updatedAtMs: now,
        };
    }

    private async startPreSessionCountdown(peerSessionId: string): Promise<void> {
        const existingDeadline = await this.getCountdownDeadlineMs(peerSessionId);
        if (existingDeadline && existingDeadline > Date.now()) {
            return;
        }

        const startsAtMs = Date.now() + PRE_START_COUNTDOWN_SECONDS * 1000;
        await redis.setex(
            this.sessionCountdownDeadlineKey(peerSessionId),
            PRE_START_COUNTDOWN_SECONDS + 120,
            String(startsAtMs)
        );

        await this.emitToSessionUsers(peerSessionId, "peer:session-countdown", {
            peerSessionId,
            startsInSeconds: PRE_START_COUNTDOWN_SECONDS,
            startsAt: new Date(startsAtMs).toISOString(),
        });
    }

    private async startActiveSession(peerSessionId: string): Promise<void> {
        // Whoever activates first wins; cancel any pending countdown timer so it
        // doesn't fire a redundant (idempotent) activation later.
        const pendingTimer = this.countdownActivationTimers.get(peerSessionId);
        if (pendingTimer) {
            clearTimeout(pendingTimer);
            this.countdownActivationTimers.delete(peerSessionId);
        }

        const activationLockKey = `peer_start_active_lock:${peerSessionId}`;
        const lockToken = randomUUID();
        const acquired = await redis.setnxex(activationLockKey, 10, lockToken);

        if (!acquired) {
            return;
        }

        try {
            const session = await prisma.peer_sessions.findUnique({
                where: { id: peerSessionId },
                include: {
                    peer_session_participants: true,
                },
            });

            if (!session || session.peer_session_participants.length < 2) {
                return;
            }

            let startedAt = session.started_at || new Date();

            if (session.status !== "ACTIVE" || !session.started_at) {
                const now = new Date();
                const updated = await prisma.peer_sessions.updateMany({
                    where: {
                        id: peerSessionId,
                        status: {
                            in: ["MATCHED", "CONNECTING", "PENDING", "ACTIVE"],
                        },
                    },
                    data: {
                        status: "ACTIVE",
                        started_at: now,
                    },
                });

                if (updated.count > 0) {
                    startedAt = now;
                } else {
                    const fresh = await prisma.peer_sessions.findUnique({
                        where: { id: peerSessionId },
                        select: {
                            status: true,
                            started_at: true,
                        },
                    });

                    if (!fresh || fresh.status !== "ACTIVE" || !fresh.started_at) {
                        return;
                    }

                    startedAt = fresh.started_at;
                }
            }

            const existingRuntime = await this.getRuntimeState(peerSessionId);
            if (existingRuntime) {
                await redis.del(this.sessionCountdownDeadlineKey(peerSessionId), this.lobbyRematchDeadlineKey(peerSessionId));
                this.emitTurnState(peerSessionId, existingRuntime);
                this.emitEditorState(peerSessionId, existingRuntime);
                await this.emitSessionState(peerSessionId);
                return;
            }

            const runtimeState = this.buildInitialRuntimeState(
                peerSessionId,
                session.peer_session_participants.map((participant) => ({
                    userId: participant.user_id,
                    participantRole: participant.participant_role,
                    preferredLanguage: participant.preferred_language,
                    isReady: participant.is_ready,
                })),
                startedAt.getTime()
            );

            await this.setRuntimeState(peerSessionId, runtimeState);
            await redis.del(this.sessionCountdownDeadlineKey(peerSessionId), this.lobbyRematchDeadlineKey(peerSessionId));
            this.emitTurnState(peerSessionId, runtimeState);
            this.emitEditorState(peerSessionId, runtimeState);
            await this.emitSessionState(peerSessionId);
        } finally {
            const currentLockToken = await redis.get(activationLockKey);
            if (currentLockToken === lockToken) {
                await redis.del(activationLockKey);
            }
        }
    }

    private async ensureActiveRuntimeState(peerSessionId: string): Promise<RuntimeSessionState> {
        const existing = await this.getRuntimeState(peerSessionId);
        if (existing) {
            return existing;
        }

        const session = await prisma.peer_sessions.findUnique({
            where: { id: peerSessionId },
            include: { peer_session_participants: true },
        });

        if (
            !session
            || session.status !== "ACTIVE"
            || !session.started_at
            || session.peer_session_participants.length < 2
        ) {
            throw new Error("Session is not active");
        }

        const participants = session.peer_session_participants.map((participant) => ({
            userId: participant.user_id,
            participantRole: participant.participant_role,
            preferredLanguage: participant.preferred_language,
            isReady: participant.is_ready,
        }));

        const fallbackParticipant = participants[0];
        if (!fallbackParticipant || participants.length < 2) {
            throw new Error("Session does not have enough participants");
        }

        const firstInterviewer =
            participants.find((participant) => participant.participantRole === "interviewer") || fallbackParticipant;
        const firstCandidate =
            participants.find((participant) => participant.userId !== firstInterviewer.userId) || fallbackParticipant;

        if (!firstInterviewer || !firstCandidate) {
            throw new Error("Unable to resolve participants for active runtime state");
        }
        const startedAtMs = session.started_at.getTime();
        const now = Date.now();
        const elapsedMs = now - startedAtMs;

        if (elapsedMs >= TURN_DURATION_SECONDS * 2 * 1000) {
            await this.completeSession(peerSessionId, "session_time_elapsed");
            throw new Error("Session already ended");
        }

        const isTurnTwo = elapsedMs >= TURN_DURATION_SECONDS * 1000;
        const turnNumber: 1 | 2 = isTurnTwo ? 2 : 1;
        const turnStartedAtMs = startedAtMs + (isTurnTwo ? TURN_DURATION_SECONDS * 1000 : 0);
        const turnEndsAtMs = turnStartedAtMs + TURN_DURATION_SECONDS * 1000;
        const activeInterviewerUserId = isTurnTwo ? firstCandidate.userId : firstInterviewer.userId;
        const activeCandidateUserId = isTurnTwo ? firstInterviewer.userId : firstCandidate.userId;
        const activeCandidate =
            participants.find((participant) => participant.userId === activeCandidateUserId) || firstCandidate;

        if (!activeCandidate) {
            throw new Error("Unable to resolve active candidate for runtime state");
        }

        const runtimeState: RuntimeSessionState = {
            peerSessionId,
            turnNumber,
            firstInterviewerUserId: firstInterviewer.userId,
            activeInterviewerUserId,
            activeCandidateUserId,
            turnStartedAtMs,
            turnEndsAtMs,
            editorRevision: 0,
            editorCode: "",
            editorLanguage: activeCandidate.preferredLanguage || "python",
            updatedByUserId: null,
            updatedAtMs: now,
        };

        await this.setRuntimeState(peerSessionId, runtimeState);
        return runtimeState;
    }

    private async handleTurnTimeout(peerSessionId: string): Promise<void> {
        const state = await this.ensureActiveRuntimeState(peerSessionId);

        if (state.turnNumber === 1) {
            await this.advanceTurnInternal(peerSessionId, "timer");
            return;
        }

        await this.completeSession(peerSessionId, "session_time_elapsed");
    }

    private async advanceTurnInternal(peerSessionId: string, updatedByUserId: string | null): Promise<void> {
        const state = await this.ensureActiveRuntimeState(peerSessionId);

        if (state.turnNumber === 2) {
            throw new Error("Session is already in final turn");
        }

        // Save the turn-1 candidate's code before the editor resets for turn 2.
        await this.persistCandidateCode(state);

        const now = Date.now();
        const next: RuntimeSessionState = {
            ...state,
            turnNumber: 2,
            activeInterviewerUserId: state.activeCandidateUserId,
            activeCandidateUserId: state.activeInterviewerUserId,
            turnStartedAtMs: now,
            turnEndsAtMs: now + TURN_DURATION_SECONDS * 1000,
            editorRevision: state.editorRevision + 1,
            editorCode: "",
            updatedByUserId,
            updatedAtMs: now,
        };

        const participants = await this.getSessionParticipants(peerSessionId);
        const activeCandidate =
            participants.find((participant) => participant.userId === next.activeCandidateUserId) ||
            participants[0];

        next.editorLanguage = activeCandidate?.preferredLanguage || next.editorLanguage || "python";

        await this.setRuntimeState(peerSessionId, next);
        this.emitTurnState(peerSessionId, next);
        this.emitEditorState(peerSessionId, next);
        await this.emitSessionState(peerSessionId);
    }

    private async completeSession(peerSessionId: string, reason: string): Promise<void> {
        // Capture the final (turn-2) candidate's code before clearing runtime so
        // the post-session report can show it under "Your Code".
        const finalRuntime = await this.getRuntimeState(peerSessionId);
        if (finalRuntime) {
            await this.persistCandidateCode(finalRuntime);
        }

        await this.clearRuntimeSession(peerSessionId);
        await redis.del(this.scheduledExtensionKey(peerSessionId));

        await prisma.peer_sessions.updateMany({
            where: {
                id: peerSessionId,
                status: {
                    in: ["PENDING", "MATCHED", "CONNECTING", "ACTIVE"],
                },
            },
            data: {
                status:
                    reason === "session_time_elapsed" ||
                    reason === "ended_early_by_interviewer" ||
                    reason === "ended_by_participant"
                        ? "COMPLETED"
                        : "ABANDONED",
                ended_at: new Date(),
            },
        });

        await this.emitToSessionUsers(peerSessionId, "peer:session-ended", {
            peerSessionId,
            reason,
            endedAt: new Date().toISOString(),
        });

        await this.emitSessionState(peerSessionId);
    }

    async onSocketConnected(userId: string, socketId: string): Promise<void> {
        await redis.setex(`peer_socket:${userId}`, SESSION_TTL_SECONDS, socketId);

        const timer = this.disconnectTimers.get(userId);
        if (timer) {
            clearTimeout(timer);
            this.disconnectTimers.delete(userId);
        }

        const peerSessionId = await redis.get(`peer_user_room:${userId}`);
        if (peerSessionId) {
            this.io.to(this.roomName(peerSessionId)).emit("peer:reconnected");
        }
    }

    async onSocketDisconnected(userId: string, socketId: string): Promise<void> {
        const currentSocketId = await redis.get(`peer_socket:${userId}`);
        if (currentSocketId === socketId) {
            await redis.del(`peer_socket:${userId}`);
        }

        const peerSessionId = await redis.get(`peer_user_room:${userId}`);
        if (!peerSessionId) {
            return;
        }

        const session = await prisma.peer_sessions.findUnique({
            where: { id: peerSessionId },
            select: { status: true },
        });

        this.io.to(this.roomName(peerSessionId)).emit("peer:reconnecting", {
            reconnectWindowSeconds: 8,
        });

        // An in-progress interview is never auto-ended on disconnect. The session
        // and its runtime state (roles, turn, editor) are preserved so the dropped
        // participant can rejoin and resume exactly where they left off, and so a
        // simple page refresh never restarts or reshuffles the session. The
        // remaining participant decides if and when to end it via the UI.
        if (session?.status === "ACTIVE") {
            return;
        }

        // Sessions that haven't started yet (lobby / countdown) are still cleaned
        // up after a short grace window — dropping out there releases the pairing.
        const existing = this.disconnectTimers.get(userId);
        if (existing) {
            clearTimeout(existing);
        }

        const timer = setTimeout(async () => {
            this.disconnectTimers.delete(userId);
            await this.finalizeDisconnect(userId, peerSessionId);
        }, 8_000);

        this.disconnectTimers.set(userId, timer);
    }

    private async finalizeDisconnect(userId: string, peerSessionId: string): Promise<void> {
        this.clearQueueFallbackTimer(userId);

        const stillConnected = await redis.get(`peer_socket:${userId}`);
        if (stillConnected) {
            return;
        }

        const session = await prisma.peer_sessions.findUnique({
            where: { id: peerSessionId },
            include: { peer_session_participants: true },
        });

        if (!session) {
            return;
        }

        if (session.status === "ACTIVE") {
            await prisma.peer_sessions.update({
                where: { id: peerSessionId },
                data: {
                    status: "ABANDONED",
                    ended_at: new Date(),
                },
            });

            await this.clearRuntimeSession(peerSessionId);
        }

        const peer = session.peer_session_participants.find((participant) => participant.user_id !== userId);
        if (peer) {
            this.io.to(`user:${peer.user_id}`).emit("peer:match-cancelled", {
                reason: "peer_disconnected",
                canRequeue: true,
            });
        }

        await redis.del(`peer_user_room:${userId}`);
    }

    private queueKey(entry: {
        interviewType: string;
        level: string;
        preferredLanguage: string;
    }): string {
        return `peer_queue:${entry.interviewType}:${entry.level}:${entry.preferredLanguage}`;
    }

    private clearQueueFallbackTimer(userId: string): void {
        const timer = this.queueFallbackTimers.get(userId);
        if (timer) {
            clearTimeout(timer);
            this.queueFallbackTimers.delete(userId);
        }
    }

    private scheduleQueueFallback(entry: QueueEntry): void {
        this.clearQueueFallbackTimer(entry.userId);

        const timer = setTimeout(async () => {
            this.queueFallbackTimers.delete(entry.userId);

            const queueKey = await redis.get(`peer_user_queue:${entry.userId}`);
            const rawEntry = await redis.get(`peer_queue_entry:${entry.userId}`);

            if (!queueKey || !rawEntry) {
                return;
            }

            const liveEntry = JSON.parse(rawEntry) as QueueEntry;
            if (liveEntry.queueTicketId !== entry.queueTicketId) {
                return;
            }

            const removed = await redis.zrem(queueKey, entry.userId);
            if (removed !== 1) {
                return;
            }

            await redis.del(`peer_queue_entry:${entry.userId}`);
            await redis.del(`peer_user_queue:${entry.userId}`);

            const scheduledFor = new Date(Date.now() + SCHEDULED_FALLBACK_OFFSET_MS);

            const session = await prisma.$transaction(async (tx) => {
                const created = await tx.peer_sessions.create({
                    data: {
                        id: randomUUID(),
                        room_id: randomUUID(),
                        source: "scheduled",
                        interview_type: liveEntry.interviewType,
                        timing_preset: FIXED_TIMING_PRESET,
                        status: "PENDING",
                        created_by_user_id: liveEntry.userId,
                        scheduled_for: scheduledFor,
                        updated_at: new Date(),
                    },
                });

                await tx.peer_session_participants.create({
                    data: {
                        id: randomUUID(),
                        session_id: created.id,
                        user_id: liveEntry.userId,
                        participant_role: "candidate",
                        level_at_match: liveEntry.level,
                        preferred_language: liveEntry.preferredLanguage,
                    },
                });

                await tx.peer_queue_tickets.updateMany({
                    where: {
                        id: liveEntry.queueTicketId,
                        status: "queued",
                    },
                    data: {
                        status: "scheduled",
                        matched_session_id: created.id,
                    },
                });

                return created;
            });

            await redis.setex(`peer_user_room:${entry.userId}`, SESSION_TTL_SECONDS, session.id);

            this.io.to(`user:${entry.userId}`).emit("peer:scheduled", {
                peerSessionId: session.id,
                scheduledFor: scheduledFor.toISOString(),
            });
        }, QUEUE_FALLBACK_DELAY_MS);

        this.queueFallbackTimers.set(entry.userId, timer);
    }

    async joinQueue(userId: string, payload: JoinPeerQueueInput): Promise<void> {
        await this.leveling.ensureProfile(userId, payload.level);
        await this.leaveQueue(userId);
        this.clearQueueFallbackTimer(userId);

        const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

        const ticket = await prisma.peer_queue_tickets.create({
            data: {
                id: randomUUID(),
                user_id: userId,
                role: payload.role,
                level: payload.level,
                interview_type: payload.interviewType,
                preferred_language: payload.preferredLanguage,
                timing_preset: FIXED_TIMING_PRESET,
                status: "queued",
                expires_at: expiresAt,
                updated_at: new Date(),
            },
        });

        const entry: QueueEntry = {
            userId,
            role: payload.role,
            level: payload.level,
            interviewType: payload.interviewType,
            preferredLanguage: payload.preferredLanguage,
            timingPreset: FIXED_TIMING_PRESET,
            queueTicketId: ticket.id,
            createdAt: Date.now(),
        };

        const queueKey = this.queueKey(payload);

        await redis.setex(`peer_queue_entry:${userId}`, 5 * 60 + 10, JSON.stringify(entry));
        await redis.setex(`peer_user_queue:${userId}`, 5 * 60 + 10, queueKey);
        await redis.zadd(queueKey, Date.now(), userId);

        const match = await this.tryMatch(entry);

        if (!match) {
            const position = await redis.zrank(queueKey, userId);
            this.io.to(`user:${userId}`).emit("peer:queued", {
                queueId: ticket.id,
                position: position === null ? 1 : position + 1,
                fallbackAt: new Date(Date.now() + 60_000).toISOString(),
            });

            this.scheduleQueueFallback(entry);
        }
    }

    async leaveQueue(userId: string): Promise<void> {
        this.clearQueueFallbackTimer(userId);

        const queueKey = await redis.get(`peer_user_queue:${userId}`);
        if (queueKey) {
            await redis.zrem(queueKey, userId);
        }

        await redis.del(`peer_queue_entry:${userId}`);
        await redis.del(`peer_user_queue:${userId}`);

        await prisma.peer_queue_tickets.updateMany({
            where: {
                user_id: userId,
                status: "queued",
            },
            data: {
                status: "cancelled",
            },
        });
    }

    private async tryMatch(requester: QueueEntry): Promise<boolean> {
        const queueKey = this.queueKey(requester);
        const candidates = await redis.zrange(queueKey, 0, 15);

        for (const candidateId of candidates) {
            if (candidateId === requester.userId) {
                continue;
            }

            const candidateRaw = await redis.get(`peer_queue_entry:${candidateId}`);
            if (!candidateRaw) {
                await redis.zrem(queueKey, candidateId);
                continue;
            }

            const candidate = JSON.parse(candidateRaw) as QueueEntry;

            const pipeline = redis.pipeline();
            pipeline.zrem(queueKey, requester.userId);
            pipeline.zrem(queueKey, candidate.userId);
            const results = await pipeline.exec();

            const requesterRemoved = Number(results?.[0]?.[1] || 0);
            const candidateRemoved = Number(results?.[1]?.[1] || 0);

            if (requesterRemoved !== 1 || candidateRemoved !== 1) {
                continue;
            }

            await this.createMatchedSession(requester, candidate);
            return true;
        }

        return false;
    }

    private async createMatchedSession(requester: QueueEntry, candidate: QueueEntry): Promise<void> {
        this.clearQueueFallbackTimer(requester.userId);
        this.clearQueueFallbackTimer(candidate.userId);

        const roomId = randomUUID();
        const requesterRole = Math.random() >= 0.5 ? "interviewer" : "candidate";
        const candidateRole = requesterRole === "interviewer" ? "candidate" : "interviewer";

        const session = await prisma.$transaction(async (tx) => {
            const created = await tx.peer_sessions.create({
                data: {
                    id: randomUUID(),
                    room_id: roomId,
                    source: "queue",
                    interview_type: requester.interviewType,
                    timing_preset: FIXED_TIMING_PRESET,
                    status: "MATCHED",
                    created_by_user_id: requester.userId,
                    updated_at: new Date(),
                },
            });

            await tx.peer_session_participants.createMany({
                data: [
                    {
                        id: randomUUID(),
                        session_id: created.id,
                        user_id: requester.userId,
                        participant_role: requesterRole,
                        level_at_match: requester.level,
                        preferred_language: requester.preferredLanguage,
                    },
                    {
                        id: randomUUID(),
                        session_id: created.id,
                        user_id: candidate.userId,
                        participant_role: candidateRole,
                        level_at_match: candidate.level,
                        preferred_language: candidate.preferredLanguage,
                    },
                ],
            });

            await tx.peer_queue_tickets.updateMany({
                where: {
                    id: { in: [requester.queueTicketId, candidate.queueTicketId] },
                },
                data: {
                    status: "matched",
                    matched_session_id: created.id,
                },
            });

            await tx.peer_match_history.create({
                data: {
                    id: randomUUID(),
                    session_id: created.id,
                    user_a_id: requester.userId,
                    user_b_id: candidate.userId,
                },
            });

            return created;
        });

        await redis.del(`peer_queue_entry:${requester.userId}`);
        await redis.del(`peer_queue_entry:${candidate.userId}`);
        await redis.del(`peer_user_queue:${requester.userId}`);
        await redis.del(`peer_user_queue:${candidate.userId}`);
        await redis.setex(`peer_user_room:${requester.userId}`, SESSION_TTL_SECONDS, session.id);
        await redis.setex(`peer_user_room:${candidate.userId}`, SESSION_TTL_SECONDS, session.id);
        this.updateParticipantCache(session.id, [requester.userId, candidate.userId]);

        this.io.to(`user:${requester.userId}`).emit("peer:matched", {
            peerSessionId: session.id,
            roomId,
            peerUserId: candidate.userId,
            role: requesterRole,
            timingPreset: session.timing_preset,
        });

        this.io.to(`user:${candidate.userId}`).emit("peer:matched", {
            peerSessionId: session.id,
            roomId,
            peerUserId: requester.userId,
            role: candidateRole,
            timingPreset: session.timing_preset,
        });
    }

    async createInvite(userId: string, payload: CreatePeerInviteInput) {
        const token = randomBytes(18).toString("base64url");
        const expiresAt = new Date(Date.now() + payload.expiresInSeconds * 1000);

        const invite = await prisma.peer_invites.create({
            data: {
                id: randomUUID(),
                token,
                inviter_user_id: userId,
                interview_type: payload.interviewType,
                preferred_language: payload.preferredLanguage,
                timing_preset: FIXED_TIMING_PRESET,
                max_uses: payload.maxUses,
                expires_at: expiresAt,
            },
        });

        this.io.to(`user:${userId}`).emit("peer:invite-created", {
            token: invite.token,
            expiresAt: invite.expires_at.toISOString(),
            maxUses: invite.max_uses,
            usedCount: invite.used_count,
        });

        return invite;
    }

    async acceptInvite(userId: string, payload: AcceptPeerInviteInput) {
        this.clearQueueFallbackTimer(userId);
        await this.leveling.ensureProfile(userId, payload.level);

        const invite = await prisma.peer_invites.findUnique({ where: { token: payload.token } });

        if (!invite) {
            throw new Error("Invite not found");
        }

        if (invite.inviter_user_id === userId) {
            throw new Error("You cannot accept your own invite");
        }

        if (
            invite.revoked_at
            || invite.used_count >= invite.max_uses
            || invite.expires_at.getTime() < Date.now()
        ) {
            throw new Error("Invite is expired or no longer available");
        }

        const inviterProfile = await this.leveling.ensureProfile(invite.inviter_user_id, "beginner");
        const roomId = randomUUID();
        const inviterRole = Math.random() >= 0.5 ? "interviewer" : "candidate";
        const receiverRole = inviterRole === "interviewer" ? "candidate" : "interviewer";

        const session = await prisma.$transaction(async (tx) => {
            const created = await tx.peer_sessions.create({
                data: {
                    id: randomUUID(),
                    room_id: roomId,
                    source: "invite",
                    interview_type: invite.interview_type,
                    timing_preset: FIXED_TIMING_PRESET,
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
                        user_id: userId,
                        participant_role: receiverRole,
                        level_at_match: payload.level,
                        preferred_language: invite.preferred_language,
                    },
                ],
            });

            await tx.peer_invites.update({
                where: { id: invite.id },
                data: {
                    used_count: { increment: 1 },
                    accepted_by_user_id: userId,
                    accepted_at: new Date(),
                    peer_session_id: created.id,
                },
            });

            await tx.peer_match_history.create({
                data: {
                    id: randomUUID(),
                    session_id: created.id,
                    user_a_id: invite.inviter_user_id,
                    user_b_id: userId,
                },
            });

            return created;
        });

        await redis.setex(`peer_user_room:${invite.inviter_user_id}`, SESSION_TTL_SECONDS, session.id);
        await redis.setex(`peer_user_room:${userId}`, SESSION_TTL_SECONDS, session.id);
        this.updateParticipantCache(session.id, [invite.inviter_user_id, userId]);

        this.io.to(`user:${invite.inviter_user_id}`).emit("peer:invite-accepted", {
            peerSessionId: session.id,
            roomId: session.room_id,
            inviterUserId: invite.inviter_user_id,
        });

        this.io.to(`user:${invite.inviter_user_id}`).emit("peer:matched", {
            peerSessionId: session.id,
            roomId: session.room_id,
            peerUserId: userId,
            role: inviterRole,
            timingPreset: session.timing_preset,
        });

        this.io.to(`user:${userId}`).emit("peer:matched", {
            peerSessionId: session.id,
            roomId: session.room_id,
            peerUserId: invite.inviter_user_id,
            role: receiverRole,
            timingPreset: session.timing_preset,
        });

        return session;
    }

    async joinSession(userId: string, peerSessionId: string): Promise<void> {
        const participant = await prisma.peer_session_participants.findFirst({
            where: {
                session_id: peerSessionId,
                user_id: userId,
            },
            include: {
                peer_sessions: true,
            },
        });

        if (!participant) {
            throw new Error("User is not part of this peer session");
        }

        await this.getParticipantUserIds(peerSessionId);

        await redis.setex(`peer_user_room:${userId}`, SESSION_TTL_SECONDS, peerSessionId);

        const messages = await prisma.peer_session_messages.findMany({
            where: { session_id: peerSessionId },
            orderBy: { created_at: "asc" },
            take: 100,
        });

        this.io.to(`user:${userId}`).emit("peer:chat-history", {
            peerSessionId,
            messages: messages.map((message) => ({
                id: message.id,
                userId: message.user_id,
                text: message.content,
                createdAt: message.created_at.toISOString(),
            })),
        });

        const countdownDeadline = await this.getCountdownDeadlineMs(peerSessionId);
        if (countdownDeadline && countdownDeadline > Date.now()) {
            this.io.to(`user:${userId}`).emit("peer:session-countdown", {
                peerSessionId,
                startsInSeconds: Math.max(1, Math.ceil((countdownDeadline - Date.now()) / 1000)),
                startsAt: new Date(countdownDeadline).toISOString(),
            });
        }

        if (participant.peer_sessions.status === "ACTIVE") {
            const runtime = await this.ensureActiveRuntimeState(peerSessionId);
            this.emitTurnState(peerSessionId, runtime);
            this.emitEditorState(peerSessionId, runtime);
        }

        await this.emitSessionState(peerSessionId);
    }

    async markSessionReady(userId: string, peerSessionId: string): Promise<void> {
        const participant = await prisma.peer_session_participants.findFirst({
            where: {
                session_id: peerSessionId,
                user_id: userId,
            },
            include: {
                peer_sessions: true,
            },
        });

        if (!participant) {
            throw new Error("User is not part of this peer session");
        }

        await prisma.peer_session_participants.update({
            where: { id: participant.id },
            data: {
                is_ready: true,
                joined_at: participant.joined_at || new Date(),
            },
        });

        const readyCount = await prisma.peer_session_participants.count({
            where: {
                session_id: peerSessionId,
                is_ready: true,
            },
        });

        if (readyCount >= 2 && ["MATCHED", "CONNECTING"].includes(participant.peer_sessions.status)) {
            await prisma.peer_sessions.update({
                where: { id: peerSessionId },
                data: {
                    status: "CONNECTING",
                },
            });

            await redis.del(this.lobbyRematchDeadlineKey(peerSessionId));
            await this.startActiveSession(peerSessionId);
        } else if (
            readyCount === 1 &&
            ["PENDING", "MATCHED"].includes(participant.peer_sessions.status) &&
            participant.peer_sessions.scheduled_for &&
            participant.peer_sessions.scheduled_for.getTime() <= Date.now()
        ) {
            // User has entered the waiting room. Stamp when they arrived so the
            // lobby matcher can order by wait time and gate cross-level matching.
            const lobbyKey = this.lobbySinceKey(userId);
            if (!(await redis.get(lobbyKey))) {
                await redis.setex(lobbyKey, SESSION_TTL_SECONDS, String(Date.now()));
            }

            const key = this.lobbyRematchDeadlineKey(peerSessionId);
            const existing = await redis.get(key);
            if (!existing) {
                await redis.setex(key, SESSION_TTL_SECONDS, String(Date.now() + LOBBY_GIVE_UP_MS));
            }

            // Give the lobby matcher an immediate chance to pair this user instead
            // of waiting for the next orchestrator tick. Reuse the orchestrator
            // lock so the matcher stays single-runner (no double-matching); if
            // another runner holds it, the poll pairs this user on its next pass.
            const matcherLock = await this.acquireOrchestratorLock();
            if (matcherLock) {
                try {
                    await this.runLobbyMatcher();
                } catch (error) {
                    console.error("[p2p][on-demand-matcher]", error);
                } finally {
                    await this.releaseOrchestratorLock(matcherLock);
                }
            }
        }

        await this.emitSessionState(peerSessionId);
    }

    async advanceTurn(userId: string, payload: PeerTurnControlInput): Promise<void> {
        await this.assertParticipant(payload.peerSessionId, userId);
        const state = await this.ensureActiveRuntimeState(payload.peerSessionId);

        if (state.turnNumber !== 1) {
            throw new Error("Turn can only be advanced during first turn");
        }

        if (state.activeInterviewerUserId !== userId) {
            throw new Error("Only active interviewer can advance turn");
        }

        await this.advanceTurnInternal(payload.peerSessionId, userId);
    }

    async endSessionEarly(userId: string, payload: PeerSessionEndInput): Promise<void> {
        await this.assertParticipant(payload.peerSessionId, userId);
        await this.ensureActiveRuntimeState(payload.peerSessionId);
        await this.completeSession(payload.peerSessionId, "ended_by_participant");
    }

    async syncEditorState(userId: string, payload: PeerEditorSyncInput): Promise<void> {
        await this.assertParticipant(payload.peerSessionId, userId);
        const state = await this.ensureActiveRuntimeState(payload.peerSessionId);

        if (state.activeCandidateUserId !== userId) {
            throw new Error("Only active candidate can edit the shared editor");
        }

        const now = Date.now();
        const nextRevision = Math.max(state.editorRevision + 1, payload.revision ?? 0);

        const nextState: RuntimeSessionState = {
            ...state,
            editorRevision: nextRevision,
            editorCode: payload.code,
            editorLanguage: payload.language,
            updatedByUserId: userId,
            updatedAtMs: now,
        };

        await this.setRuntimeState(payload.peerSessionId, nextState);
        this.emitEditorState(payload.peerSessionId, nextState);
    }

    async relayTimerSync(userId: string, payload: {
        peerSessionId: string;
        roundKey: string;
        elapsedSeconds: number;
    }): Promise<void> {
        await this.assertParticipant(payload.peerSessionId, userId);

        let runtime = await this.getRuntimeState(payload.peerSessionId);
        if (!runtime) {
            try {
                runtime = await this.ensureActiveRuntimeState(payload.peerSessionId);
            } catch {
                runtime = null;
            }
        }

        if (runtime) {
            const elapsedSeconds = Math.max(0, Math.floor((Date.now() - runtime.turnStartedAtMs) / 1000));
            this.io.to(this.roomName(payload.peerSessionId)).emit("peer:timer-sync", {
                roundKey: `turn_${runtime.turnNumber}`,
                elapsedSeconds,
                totalSeconds: TURN_DURATION_SECONDS,
            });
            return;
        }

        this.io.to(this.roomName(payload.peerSessionId)).emit("peer:timer-sync", {
            roundKey: payload.roundKey,
            elapsedSeconds: payload.elapsedSeconds,
            totalSeconds: TURN_DURATION_SECONDS,
        });
    }

    async sendChatMessage(userId: string, payload: {
        peerSessionId: string;
        text: string;
    }): Promise<void> {
        await this.assertParticipant(payload.peerSessionId, userId);

        const message = await prisma.peer_session_messages.create({
            data: {
                id: randomUUID(),
                session_id: payload.peerSessionId,
                user_id: userId,
                type: "chat",
                content: payload.text,
            },
        });

        this.io.to(this.roomName(payload.peerSessionId)).emit("peer:chat-message", {
            id: message.id,
            peerSessionId: payload.peerSessionId,
            userId,
            text: payload.text,
            createdAt: message.created_at.toISOString(),
        });
    }

    async relaySignalOffer(userId: string, payload: {
        peerSessionId: string;
        sdp: string;
    }): Promise<void> {
        const peerUserId = await this.getPeerUserId(payload.peerSessionId, userId);
        if (!peerUserId) {
            return;
        }

        this.io.to(`user:${peerUserId}`).emit("peer:signal-offer", {
            peerSessionId: payload.peerSessionId,
            sdp: payload.sdp,
        });
    }

    async relaySignalAnswer(userId: string, payload: {
        peerSessionId: string;
        sdp: string;
    }): Promise<void> {
        const peerUserId = await this.getPeerUserId(payload.peerSessionId, userId);
        if (!peerUserId) {
            return;
        }

        this.io.to(`user:${peerUserId}`).emit("peer:signal-answer", {
            peerSessionId: payload.peerSessionId,
            sdp: payload.sdp,
        });
    }

    async relaySignalIce(userId: string, payload: {
        peerSessionId: string;
        candidate: string;
    }): Promise<void> {
        const peerUserId = await this.getPeerUserId(payload.peerSessionId, userId);
        if (!peerUserId) {
            return;
        }

        this.io.to(`user:${peerUserId}`).emit("peer:signal-ice", {
            peerSessionId: payload.peerSessionId,
            candidate: payload.candidate,
        });
    }

    async relayExecutionSync(userId: string, payload: {
        peerSessionId: string;
        phase: "running" | "completed";
        mode: "run" | "submit";
        language?: string;
        results?: Record<string, unknown>;
        hiddenSummary?: { passed: number; total: number } | null;
        executionError?: string | null;
    }): Promise<void> {
        await this.assertParticipant(payload.peerSessionId, userId);

        this.io.to(this.roomName(payload.peerSessionId)).emit("peer:execution-sync", {
            ...payload,
            startedByUserId: userId,
            updatedAt: new Date().toISOString(),
        });
    }

    private async assertParticipant(peerSessionId: string, userId: string): Promise<void> {
        const participants = await this.getParticipantUserIds(peerSessionId);

        if (!participants.has(userId)) {
            throw new Error("User is not part of this peer session");
        }
    }

    private async getPeerUserId(peerSessionId: string, userId: string): Promise<string | null> {
        const participants = await this.getParticipantUserIds(peerSessionId);

        if (!participants.has(userId)) {
            throw new Error("User is not part of this peer session");
        }

        for (const peerUserId of participants) {
            if (peerUserId !== userId) {
                return peerUserId;
            }
        }

        return null;
    }

    async emitSessionState(peerSessionId: string): Promise<void> {
        const session = await prisma.peer_sessions.findUnique({
            where: { id: peerSessionId },
            include: {
                peer_session_participants: true,
            },
        });

        if (!session) {
            return;
        }

        const participantUserIds = session.peer_session_participants.map((p) => p.user_id);
        this.updateParticipantCache(peerSessionId, participantUserIds);

        const runtime = await this.getRuntimeState(peerSessionId);

        const sessionStatePayload = {
            peerSessionId,
            status: session.status,
            participants: session.peer_session_participants.map((participant) => ({
                userId: participant.user_id,
                participantRole: participant.participant_role as "interviewer" | "candidate",
                isReady: participant.is_ready,
            })),
            turn: runtime
                ? {
                    turnNumber: runtime.turnNumber,
                    activeInterviewerUserId: runtime.activeInterviewerUserId,
                    activeCandidateUserId: runtime.activeCandidateUserId,
                    endsAt: new Date(runtime.turnEndsAtMs).toISOString(),
                    editableUserId: runtime.activeCandidateUserId,
                }
                : null,
        };

        this.io.to(this.roomName(peerSessionId)).emit("peer:session-state", sessionStatePayload);

        // Also emit to each participant's user room so users who haven't yet
        // joined the session room (e.g. secondary user still navigating after a
        // match-redirect) receive the updated session status.
        for (const userId of participantUserIds) {
            this.io.to(`user:${userId}`).emit("peer:session-state", sessionStatePayload);
        }
    }
}
