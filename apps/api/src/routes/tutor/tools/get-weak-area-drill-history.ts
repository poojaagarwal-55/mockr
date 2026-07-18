import { prisma } from "../../../lib/prisma.js";
import type { TutorToolRunInput } from "../tool-types.js";

/**
 * Shows which weak areas the user has already drilled vs not started.
 * Answers: "What have I already practiced?", "What should I focus on next?"
 * Prevents the LLM from suggesting the same focus area repeatedly.
 */
export async function runGetWeakAreaDrillHistoryTool(input: TutorToolRunInput) {
    const { userId, context } = input;
    const reportId = context.report.id;

    // Fetch the accepted action plan for this report (if any)
    const acceptedPlan = await prisma.acceptedActionPlan.findFirst({
        where: { userId, reportId },
        orderBy: { acceptedAt: "desc" },
        select: {
            id: true,
            timespan: true,
            label: true,
            startDate: true,
            endDate: true,
            acceptedAt: true,
            actionPlan: true,
        },
    });

    // Fetch question sheet progress for this report
    const sheet = await prisma.questionSheet.findFirst({
        where: { reportId },
        select: {
            id: true,
            questions: true,
            progress: true,
            generatedAt: true,
        },
    });

    const progressObj = (sheet?.progress as Record<string, any> | null) || {};
    const questions = Array.isArray(sheet?.questions) ? (sheet.questions as any[]) : [];

    // Categorise each question by drill status
    const drilled: string[] = [];
    const notStarted: string[] = [];
    const inProgress: string[] = [];

    for (const q of questions) {
        const qId = String(q.id || "");
        const prog = progressObj[qId];
        const category = String(q.category || q.prompt || "unknown");
        if (!prog || prog.status === "not_started") {
            notStarted.push(category);
        } else if (prog.status === "solved") {
            drilled.push(category);
        } else {
            inProgress.push(category);
        }
    }

    // Aggregate weak areas from the action plan
    const actionPlan = acceptedPlan?.actionPlan as any;
    const weakAreas: Array<{ category: string; score: number; why: string }> =
        Array.isArray(actionPlan?.weakAreas) ? actionPlan.weakAreas : [];

    // Cross-reference: which weak areas have been drilled?
    const drilledSet = new Set(drilled.map((c) => c.toLowerCase()));
    const weakAreaStatus = weakAreas.map((w) => ({
        category: w.category,
        score: w.score,
        why: w.why,
        drilled: drilledSet.has(w.category.toLowerCase()),
    }));

    const undrilledWeakAreas = weakAreaStatus.filter((w) => !w.drilled);
    const drilledWeakAreas = weakAreaStatus.filter((w) => w.drilled);

    return {
        hasAcceptedPlan: Boolean(acceptedPlan),
        planLabel: acceptedPlan?.label || null,
        planTimespan: acceptedPlan?.timespan || null,
        planAcceptedAt: acceptedPlan?.acceptedAt || null,
        weakAreaStatus,
        undrilledWeakAreas,
        drilledWeakAreas,
        sheetProgress: {
            total: questions.length,
            drilled: drilled.length,
            inProgress: inProgress.length,
            notStarted: notStarted.length,
        },
        recommendation: undrilledWeakAreas.length > 0
            ? `Focus next on: ${undrilledWeakAreas.slice(0, 2).map((w) => w.category).join(", ")}.`
            : drilledWeakAreas.length > 0
                ? "You've drilled all identified weak areas. Consider a full mock interview to consolidate."
                : "No action plan found. Generate one to get personalised drill recommendations.",
    };
}
