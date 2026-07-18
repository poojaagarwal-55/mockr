import { prisma } from "../../../lib/prisma.js";
import type { TutorToolRunInput } from "../tool-types.js";

/**
 * Fetches the user's currently active accepted action plan for this report.
 * Answers: "Do I have an action plan?", "What's my current study plan?",
 * "Show me my plan", "What am I supposed to be working on?"
 * Prevents the LLM from regenerating a plan when one already exists.
 */
export async function runGetAcceptedActionPlanTool(input: TutorToolRunInput) {
    const { userId, context } = input;
    const reportId = context.report.id;

    const plan = await prisma.acceptedActionPlan.findFirst({
        where: { userId, reportId },
        orderBy: { acceptedAt: "desc" },
        select: {
            id: true,
            reportId: true,
            sessionId: true,
            timespan: true,
            label: true,
            startDate: true,
            endDate: true,
            acceptedAt: true,
            actionPlan: true,
        },
    });

    if (!plan) {
        // Also check if there's any accepted plan across all reports for this user
        const anyPlan = await prisma.acceptedActionPlan.findFirst({
            where: { userId },
            orderBy: { acceptedAt: "desc" },
            select: {
                id: true,
                reportId: true,
                label: true,
                timespan: true,
                acceptedAt: true,
            },
        });

        return {
            hasActivePlan: false,
            plan: null,
            mostRecentPlanAcrossReports: anyPlan
                ? {
                      planId: anyPlan.id,
                      reportId: anyPlan.reportId,
                      label: anyPlan.label,
                      timespan: anyPlan.timespan,
                      acceptedAt: anyPlan.acceptedAt,
                  }
                : null,
            message: anyPlan
                ? `No plan for this specific report, but you have a recent plan from ${anyPlan.label}.`
                : "No accepted action plan found. You can generate one from the coaching panel.",
        };
    }

    const actionPlan = plan.actionPlan as any;
    const now = new Date();
    const endDate = new Date(plan.endDate);
    const daysRemaining = Math.max(0, Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
    const isExpired = endDate < now;

    const weakAreas: Array<{ category: string; score: number; why: string; actionItems: string[] }> =
        Array.isArray(actionPlan?.weakAreas) ? actionPlan.weakAreas : [];
    const strengths: string[] = Array.isArray(actionPlan?.strengths) ? actionPlan.strengths : [];

    return {
        hasActivePlan: true,
        plan: {
            planId: plan.id,
            label: plan.label,
            timespan: plan.timespan,
            startDate: plan.startDate,
            endDate: plan.endDate,
            acceptedAt: plan.acceptedAt,
            daysRemaining,
            isExpired,
            overallSummary: actionPlan?.overallSummary || null,
            priorityFocus: actionPlan?.priorityFocus || null,
            strengths,
            weakAreas,
            dailyPlan: actionPlan?.dailyPlan || [],
            plannedDays: actionPlan?.plannedDays || [],
        },
        message: isExpired
            ? `Your ${plan.timespan.replace(/_/g, " ")} plan has expired. Consider generating a fresh one.`
            : `Active plan: ${plan.label}. ${daysRemaining} day(s) remaining. Priority focus: ${actionPlan?.priorityFocus || "not set"}.`,
    };
}
