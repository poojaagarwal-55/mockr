import { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";

export default async function streakRoutes(fastify: FastifyInstance) {
    // All routes require authentication
    fastify.addHook("preHandler", fastify.authenticate);

    // ── GET /api/streaks ─────────────────────────────────────────
    // Get current user's streak information
    fastify.get("/streaks", async (request, reply) => {
        const userId = request.user!.id;

        const emptyStreak = {
            success: true,
            data: {
                currentStreak: 0,
                longestStreak: 0,
                lastActivityDate: null,
            },
        };

        try {
            const user = await prisma.user.findUnique({
                where: { id: userId },
                select: {
                    currentStreak: true,
                    longestStreak: true,
                    lastActivityDate: true,
                },
            });

            if (!user) {
                request.log.warn({ userId }, "[Streaks] User profile not found; returning empty streak");
                return reply.send(emptyStreak);
            }

            // Check if streak needs to be reset
            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            
            let currentStreak = user.currentStreak;
            
            if (user.lastActivityDate) {
                const lastActivity = new Date(user.lastActivityDate);
                const lastActivityDay = new Date(
                    lastActivity.getFullYear(),
                    lastActivity.getMonth(),
                    lastActivity.getDate()
                );
                
                const daysDiff = Math.floor(
                    (today.getTime() - lastActivityDay.getTime()) / (1000 * 60 * 60 * 24)
                );
                
                // If more than 1 day has passed, reset streak
                if (daysDiff > 1) {
                    currentStreak = 0;
                    await prisma.user.update({
                        where: { id: userId },
                        data: { currentStreak: 0 },
                    });
                }
            }

            return reply.send({
                success: true,
                data: {
                    currentStreak,
                    longestStreak: user.longestStreak,
                    lastActivityDate: user.lastActivityDate,
                },
            });
        } catch (error) {
            request.log.warn({ err: error, userId }, "[Streaks] Failed to fetch streak; returning empty streak");
            return reply.send(emptyStreak);
        }
    });

    // ── POST /api/streaks/activity ───────────────────────────────
    // Record an activity (interview or question submission)
    fastify.post("/streaks/activity", async (request, reply) => {
        const userId = request.user!.id;

        try {
            const user = await prisma.user.findUnique({
                where: { id: userId },
                select: {
                    currentStreak: true,
                    longestStreak: true,
                    lastActivityDate: true,
                },
            });

            if (!user) {
                return reply.status(404).send({ error: "User not found" });
            }

            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            
            let newStreak = user.currentStreak;
            let shouldUpdate = false;

            if (!user.lastActivityDate) {
                // First activity ever
                newStreak = 1;
                shouldUpdate = true;
            } else {
                const lastActivity = new Date(user.lastActivityDate);
                const lastActivityDay = new Date(
                    lastActivity.getFullYear(),
                    lastActivity.getMonth(),
                    lastActivity.getDate()
                );
                
                const daysDiff = Math.floor(
                    (today.getTime() - lastActivityDay.getTime()) / (1000 * 60 * 60 * 24)
                );
                
                if (daysDiff === 0) {
                    // Same day - no streak change, but update timestamp
                    shouldUpdate = true;
                } else if (daysDiff === 1) {
                    // Next day - increment streak
                    newStreak = user.currentStreak + 1;
                    shouldUpdate = true;
                } else if (daysDiff > 1) {
                    // Streak broken - reset to 1
                    newStreak = 1;
                    shouldUpdate = true;
                }
            }

            if (shouldUpdate) {
                const newLongestStreak = Math.max(newStreak, user.longestStreak);
                
                await prisma.user.update({
                    where: { id: userId },
                    data: {
                        currentStreak: newStreak,
                        longestStreak: newLongestStreak,
                        lastActivityDate: now,
                    },
                });

                return reply.send({
                    success: true,
                    data: {
                        currentStreak: newStreak,
                        longestStreak: newLongestStreak,
                        lastActivityDate: now,
                    },
                });
            }

            return reply.send({
                success: true,
                data: {
                    currentStreak: newStreak,
                    longestStreak: user.longestStreak,
                    lastActivityDate: user.lastActivityDate,
                },
            });
        } catch (error) {
            console.error("Error updating streak:", error);
            return reply.status(500).send({ error: "Failed to update streak" });
        }
    });
}
