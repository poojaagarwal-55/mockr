import { prisma } from "../../../lib/prisma.js";
import type { TutorToolRunInput } from "../tool-types.js";

/**
 * Returns where the user's score sits relative to other users for that interview type.
 * Answers: "How good is my 72?", "Am I above average?", "How do I compare to others?"
 */
export async function runGetScorePercentileTool(input: TutorToolRunInput) {
    const { userId, context } = input;
    const interviewType = context.report.session.type;
    const userScore = Math.round(Number(context.report.overallScore) || 0);

    // Fetch all scores for this interview type (anonymised — just scores)
    const allReports = await prisma.evaluationReport.findMany({
        where: {
            session: { is: { type: interviewType } },
        },
        select: {
            overallScore: true,
            userId: true,
        },
        orderBy: { generatedAt: "desc" },
        // Cap at 2000 for performance — enough for a meaningful distribution
        take: 2000,
    });

    if (allReports.length === 0) {
        return {
            interviewType,
            userScore,
            percentile: null,
            totalSampled: 0,
            summary: "Not enough data to compute a percentile yet.",
        };
    }

    const scores = allReports.map((r) => Math.round(Number(r.overallScore) || 0));
    const totalSampled = scores.length;

    // Percentile = % of scores strictly below the user's score
    const below = scores.filter((s) => s < userScore).length;
    const percentile = Math.round((below / totalSampled) * 100);

    // Distribution buckets: 0-20, 21-40, 41-60, 61-80, 81-100
    const buckets = [
        { label: "0–20", min: 0, max: 20, count: 0 },
        { label: "21–40", min: 21, max: 40, count: 0 },
        { label: "41–60", min: 41, max: 60, count: 0 },
        { label: "61–80", min: 61, max: 80, count: 0 },
        { label: "81–100", min: 81, max: 100, count: 0 },
    ];
    for (const s of scores) {
        const bucket = buckets.find((b) => s >= b.min && s <= b.max);
        if (bucket) bucket.count++;
    }
    const distribution = buckets.map((b) => ({
        range: b.label,
        count: b.count,
        percentage: Math.round((b.count / totalSampled) * 100),
    }));

    // Average and median
    const sorted = [...scores].sort((a, b) => a - b);
    const average = Math.round(scores.reduce((a, b) => a + b, 0) / totalSampled);
    const median = sorted[Math.floor(totalSampled / 2)] ?? 0;

    // User's own history for this type
    const userHistory = await prisma.evaluationReport.findMany({
        where: {
            userId,
            session: { is: { type: interviewType } },
        },
        orderBy: { generatedAt: "desc" },
        take: 5,
        select: { overallScore: true, generatedAt: true },
    });
    const userAverage = userHistory.length > 0
        ? Math.round(userHistory.reduce((sum, r) => sum + Math.round(Number(r.overallScore) || 0), 0) / userHistory.length)
        : userScore;

    let performanceLabel: string;
    if (percentile >= 80) performanceLabel = "top performer";
    else if (percentile >= 60) performanceLabel = "above average";
    else if (percentile >= 40) performanceLabel = "average";
    else if (percentile >= 20) performanceLabel = "below average";
    else performanceLabel = "needs significant improvement";

    return {
        interviewType,
        userScore,
        percentile,
        performanceLabel,
        globalStats: {
            average,
            median,
            totalSampled,
        },
        distribution,
        userHistory: userHistory.map((r) => ({
            score: Math.round(Number(r.overallScore) || 0),
            date: r.generatedAt,
        })),
        userAverage,
        summary: `Your score of ${userScore} is in the ${percentile}th percentile for ${interviewType.replace(/_/g, " ")} interviews — ${performanceLabel}. The global average is ${average}.`,
    };
}
