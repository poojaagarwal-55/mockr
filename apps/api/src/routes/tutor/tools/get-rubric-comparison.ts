import { prisma } from "../../../lib/prisma.js";
import type { TutorToolRunInput } from "../tool-types.js";

/**
 * Compares rubric scores across the last N sessions of the same interview type.
 * Answers: "Am I improving in system design?", "How has my scalability score changed?"
 */
export async function runGetRubricComparisonTool(input: TutorToolRunInput) {
    const { userId, context, retrievalPlan } = input;
    const interviewType = context.report.session.type;
    const typeFilter = retrievalPlan.trendSpec.typeFilter || interviewType;
    const limit = Math.min(10, Math.max(2, retrievalPlan.trendSpec.limit || 5));

    const reports = await prisma.evaluationReport.findMany({
        where: {
            userId,
            session: { is: { type: typeFilter } },
        },
        orderBy: { generatedAt: "desc" },
        take: limit,
        select: {
            id: true,
            overallScore: true,
            rubricScores: true,
            generatedAt: true,
            session: { select: { type: true } },
        },
    });

    if (reports.length === 0) {
        return {
            interviewType: typeFilter,
            reportCount: 0,
            rubricTrend: [],
            overallTrend: [],
            summary: `No ${typeFilter.replace(/_/g, " ")} reports found to compare.`,
        };
    }

    // Build per-category trend across reports (oldest → newest)
    const ordered = [...reports].reverse();
    const categoryMap = new Map<string, number[]>();

    for (const report of ordered) {
        const rubric = Array.isArray(report.rubricScores)
            ? (report.rubricScores as any[])
            : [];
        for (const item of rubric) {
            const cat = String(item.category || "").toLowerCase();
            if (!cat) continue;
            if (!categoryMap.has(cat)) categoryMap.set(cat, []);
            categoryMap.get(cat)!.push(Math.round(Number(item.score) || 0));
        }
    }

    const rubricTrend = Array.from(categoryMap.entries()).map(([category, scores]) => {
        const first = scores[0] ?? 0;
        const last = scores[scores.length - 1] ?? 0;
        const delta = last - first;
        return {
            category,
            scores,
            delta,
            trend: delta > 3 ? "improving" : delta < -3 ? "declining" : "stable",
            latestScore: last,
            averageScore: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
        };
    }).sort((a, b) => b.latestScore - a.latestScore);

    const overallTrend = ordered.map((r) => ({
        reportId: r.id,
        generatedAt: r.generatedAt,
        overallScore: Math.round(Number(r.overallScore) || 0),
    }));

    const improving = rubricTrend.filter((r) => r.trend === "improving").map((r) => r.category);
    const declining = rubricTrend.filter((r) => r.trend === "declining").map((r) => r.category);

    return {
        interviewType: typeFilter,
        reportCount: reports.length,
        rubricTrend,
        overallTrend,
        improving,
        declining,
        summary: `Compared ${reports.length} ${typeFilter.replace(/_/g, " ")} sessions. ${
            improving.length ? `Improving: ${improving.join(", ")}.` : ""
        } ${declining.length ? `Needs work: ${declining.join(", ")}.` : ""}`.trim(),
    };
}
