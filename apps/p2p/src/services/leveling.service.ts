import { randomUUID } from "node:crypto";
import {
    type PeerLevel,
    clampPeerRating,
    scoreToLevel,
    seedScoreForLevel,
} from "@interviewforge/shared";
import { prisma } from "../lib/prisma.js";

// ELO-style peer rating helpers. The 0..2000 scale, band cutoffs and seed
// values live in @interviewforge/shared so the p2p service and the API route
// stay in lockstep. See applyFeedbackToProfile in apps/api for the canonical
// feedback-driven update path; this service owns profile creation for the
// realtime (queue/invite) flows.
export class LevelingService {
    async ensureProfile(userId: string, initialLevel: PeerLevel) {
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

    // Performance outcome in [0,1] derived from the 1..5 peer feedback ratings.
    private feedbackOutcome(params: {
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
    private kFactor(sessionsRated: number): number {
        return 24 + 200 * Math.exp(-sessionsRated / 5);
    }

    async applyFeedbackUpdate(params: {
        userId: string;
        opponentScore: number;
        overallRating: number;
        problemSolving: number;
        communication: number;
        codeQuality: number;
        interviewing: number;
    }) {
        const profile = await this.ensureProfile(params.userId, "beginner");

        const currentScore = Number(profile.score);
        const outcome = this.feedbackOutcome(params);
        const expected = 1 / (1 + Math.pow(10, (params.opponentScore - currentScore) / 400));
        const k = this.kFactor(profile.sessions_rated);
        const rawDelta = k * (outcome - expected);
        const delta = Math.max(-300, Math.min(300, rawDelta));
        const nextScore = Number(clampPeerRating(currentScore + delta).toFixed(2));
        const nextLevel = scoreToLevel(nextScore);

        const updated = await prisma.peer_skill_profiles.update({
            where: { user_id: params.userId },
            data: {
                score: nextScore,
                current_level: nextLevel,
                sessions_rated: { increment: 1 },
            },
        });

        if (updated.current_level !== profile.current_level || Number(updated.score) !== currentScore) {
            await prisma.peer_skill_history.create({
                data: {
                    id: randomUUID(),
                    user_id: params.userId,
                    previous_level: profile.current_level,
                    new_level: updated.current_level,
                    previous_score: currentScore,
                    new_score: Number(updated.score),
                    reason: "Peer feedback recalculation",
                },
            });
        }

        return updated;
    }
}
