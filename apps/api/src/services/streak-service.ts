// ============================================
// Streak Service
// ============================================
// Updates user streak when an activity (e.g. interview completion) occurs.
// Called fire-and-forget from handleEndInterview and any bypass paths.

import { prisma } from "../lib/prisma.js";

/**
 * Updates the streak for a user on activity completion.
 * - If first ever activity: streak = 1
 * - If activity is same day as last: no change (idempotent)
 * - If consecutive day: streak + 1
 * - If gap > 1 day: streak resets to 1
 */
export async function updateStreakForUser(userId: string): Promise<void> {
    try {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { currentStreak: true, longestStreak: true, lastActivityDate: true },
        });
        if (!user) return;

        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        let newStreak = user.currentStreak;

        if (!user.lastActivityDate) {
            // First activity ever
            newStreak = 1;
        } else {
            const lastDay = new Date(user.lastActivityDate);
            const lastActivityDay = new Date(lastDay.getFullYear(), lastDay.getMonth(), lastDay.getDate());
            const daysDiff = Math.floor(
                (today.getTime() - lastActivityDay.getTime()) / (1000 * 60 * 60 * 24)
            );

            if (daysDiff === 0) {
                // Already active today — streak count stays the same, just update timestamp
            } else if (daysDiff === 1) {
                // Consecutive day
                newStreak = user.currentStreak + 1;
            } else {
                // Streak broken
                newStreak = 1;
            }
        }

        const newLongest = Math.max(newStreak, user.longestStreak);

        await prisma.user.update({
            where: { id: userId },
            data: {
                currentStreak: newStreak,
                longestStreak: newLongest,
                lastActivityDate: now,
            },
        });

        console.log(`[StreakService] Streak updated for user ${userId.slice(0, 8)}: ${newStreak} day(s) (longest: ${newLongest})`);
    } catch (err) {
        console.error("[StreakService] Failed to update streak:", err);
    }
}
