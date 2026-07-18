/**
 * Action Plan API endpoints
 * 
 * Provides access to active action plans, day details, and progress tracking.
 */

import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";

const actionPlanRoutes: FastifyPluginAsync = async (fastify) => {
    // Helper to get authenticated user
    const getAuthUser = async (request: any) => {
        return request.user;
    };

    // ─────────────────────────────────────────────────────────────────
    // GET /users/me/action-plan/active
    // Returns the user's currently active action plan
    // ─────────────────────────────────────────────────────────────────

    fastify.get("/users/me/action-plan/active", {
        onRequest: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const user = await getAuthUser(request);
            
            const activePlan = await prisma.acceptedActionPlan.findFirst({
                where: {
                    userId: user.id,
                    endDate: { gte: new Date() },
                },
                orderBy: { acceptedAt: "desc" },
                include: {
                    artifact: {
                        select: {
                            id: true,
                            title: true,
                            content: true,
                            createdAt: true,
                        },
                    },
                },
            });
            
            if (!activePlan) {
                return reply.send({ plan: null });
            }
            
            const content = activePlan.actionPlan as any;
            const totalQuestions = content?.planSummary?.totalQuestions || 0;
            
            return reply.send({
                plan: {
                    id: activePlan.id,
                    artifactId: activePlan.artifactId,
                    reportId: activePlan.reportId,
                    sessionId: activePlan.sessionId,
                    title: activePlan.label,
                    startDate: activePlan.startDate,
                    endDate: activePlan.endDate,
                    totalDays: activePlan.totalDays,
                    currentDay: activePlan.currentDay,
                    content: activePlan.actionPlan,
                },
                progress: {
                    completedDays: activePlan.completedDays.length,
                    totalDays: activePlan.totalDays || 0,
                    completedQuestions: activePlan.completedQuestions.length,
                    totalQuestions,
                    percentComplete: activePlan.totalDays
                        ? Math.round((activePlan.completedDays.length / activePlan.totalDays) * 100)
                        : 0,
                },
            });
        } catch (error: any) {
            fastify.log.error({ err: error }, "[action-plan] Error fetching active plan");
            return reply.status(500).send({ error: "Failed to fetch action plan" });
        }
    });

    // ─────────────────────────────────────────────────────────────────
    // GET /users/me/action-plan/active/day/:dayNumber
    // Returns details for a specific day
    // ─────────────────────────────────────────────────────────────────

    fastify.get<{ Params: { dayNumber: string } }>(
        "/users/me/action-plan/active/day/:dayNumber",
        {
            onRequest: [fastify.authenticate],
        },
        async (request, reply) => {
            try {
                const user = await getAuthUser(request);
                const dayNumber = parseInt(request.params.dayNumber, 10);
                
                if (isNaN(dayNumber) || dayNumber < 1) {
                    return reply.status(400).send({ error: "Invalid day number" });
                }
                
                const activePlan = await prisma.acceptedActionPlan.findFirst({
                    where: {
                        userId: user.id,
                        endDate: { gte: new Date() },
                    },
                    orderBy: { acceptedAt: "desc" },
                });
                
                if (!activePlan) {
                    return reply.status(404).send({ error: "No active action plan found" });
                }
                
                const content = activePlan.actionPlan as any;
                const days = Array.isArray(content?.days) ? content.days : [];
                const day = days.find((d: any) => d.dayNumber === dayNumber);
                
                if (!day) {
                    return reply.status(404).send({ error: "Day not found in plan" });
                }
                
                // Calculate total questions for this day
                const allQuestions = [
                    ...(day.questions?.dsa || []),
                    ...(day.questions?.csFundamentals || []),
                    ...(day.questions?.sql || []),
                    ...(day.questions?.systemDesign || []),
                ];
                
                const completedForDay = allQuestions.filter((q: any) =>
                    activePlan.completedQuestions.includes(q.id)
                );
                
                return reply.send({
                    day,
                    progress: {
                        completedQuestions: completedForDay.map((q: any) => q.id),
                        totalQuestions: allQuestions.length,
                        isCompleted: activePlan.completedDays.includes(dayNumber),
                    },
                });
            } catch (error: any) {
                fastify.log.error({ err: error }, "[action-plan] Error fetching day");
                return reply.status(500).send({ error: "Failed to fetch day details" });
            }
        }
    );

    // ─────────────────────────────────────────────────────────────────
    // POST /users/me/action-plan/active/day/:dayNumber/question/:questionId/complete
    // Mark a question as complete
    // ─────────────────────────────────────────────────────────────────

    const markQuestionSchema = z.object({
        completed: z.boolean(),
    });

    fastify.post<{
        Params: { dayNumber: string; questionId: string };
        Body: { completed: boolean };
    }>(
        "/users/me/action-plan/active/day/:dayNumber/question/:questionId/complete",
        {
            onRequest: [fastify.authenticate],
        },
        async (request, reply) => {
            try {
                const user = await getAuthUser(request);
                const dayNumber = parseInt(request.params.dayNumber, 10);
                const questionId = request.params.questionId;
                const { completed } = markQuestionSchema.parse(request.body);
                
                const activePlan = await prisma.acceptedActionPlan.findFirst({
                    where: {
                        userId: user.id,
                        endDate: { gte: new Date() },
                    },
                    orderBy: { acceptedAt: "desc" },
                });
                
                if (!activePlan) {
                    return reply.status(404).send({ error: "No active action plan found" });
                }
                
                const currentCompleted = new Set(activePlan.completedQuestions);
                
                if (completed) {
                    currentCompleted.add(questionId);
                } else {
                    currentCompleted.delete(questionId);
                }
                
                const updated = await prisma.acceptedActionPlan.update({
                    where: { id: activePlan.id },
                    data: {
                        completedQuestions: Array.from(currentCompleted),
                        lastAccessedAt: new Date(),
                    },
                });
                
                const content = updated.actionPlan as any;
                const totalQuestions = content?.planSummary?.totalQuestions || 0;
                
                return reply.send({
                    success: true,
                    progress: {
                        completedQuestions: updated.completedQuestions.length,
                        totalQuestions,
                    },
                });
            } catch (error: any) {
                fastify.log.error({ err: error }, "[action-plan] Error marking question");
                return reply.status(500).send({ error: "Failed to update question status" });
            }
        }
    );

    // ─────────────────────────────────────────────────────────────────
    // POST /users/me/action-plan/active/day/:dayNumber/complete
    // Mark an entire day as complete
    // ─────────────────────────────────────────────────────────────────

    fastify.post<{ Params: { dayNumber: string } }>(
        "/users/me/action-plan/active/day/:dayNumber/complete",
        {
            onRequest: [fastify.authenticate],
        },
        async (request, reply) => {
            try {
                const user = await getAuthUser(request);
                const dayNumber = parseInt(request.params.dayNumber, 10);
                
                const activePlan = await prisma.acceptedActionPlan.findFirst({
                    where: {
                        userId: user.id,
                        endDate: { gte: new Date() },
                    },
                    orderBy: { acceptedAt: "desc" },
                });
                
                if (!activePlan) {
                    return reply.status(404).send({ error: "No active action plan found" });
                }
                
                const currentCompleted = new Set(activePlan.completedDays);
                currentCompleted.add(dayNumber);
                
                const nextDay = dayNumber < (activePlan.totalDays || 0) ? dayNumber + 1 : null;
                
                const updated = await prisma.acceptedActionPlan.update({
                    where: { id: activePlan.id },
                    data: {
                        completedDays: Array.from(currentCompleted),
                        currentDay: nextDay || activePlan.currentDay,
                        lastAccessedAt: new Date(),
                    },
                });
                
                return reply.send({
                    success: true,
                    nextDay,
                    progress: {
                        completedDays: updated.completedDays.length,
                        totalDays: updated.totalDays || 0,
                    },
                });
            } catch (error: any) {
                fastify.log.error({ err: error }, "[action-plan] Error marking day complete");
                return reply.status(500).send({ error: "Failed to mark day complete" });
            }
        }
    );
};

export default actionPlanRoutes;
