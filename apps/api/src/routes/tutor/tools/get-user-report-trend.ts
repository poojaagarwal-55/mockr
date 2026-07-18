import { prisma } from "../../../lib/prisma.js";
import type { TutorToolRunInput } from "../tool-types.js";

export async function runGetUserReportTrendTool(input: TutorToolRunInput) {
    const { retrievalPlan, userId, maxTrendReports } = input;
    const trendSpec = retrievalPlan.trendSpec;

    const whereClause: any = { userId };
    const sessionFilter: any = {};
    if (trendSpec.typeFilter) {
        sessionFilter.type = trendSpec.typeFilter;
    }
    if (trendSpec.sinceDate || trendSpec.untilDate) {
        const range = {
            ...(trendSpec.sinceDate ? { gte: trendSpec.sinceDate } : {}),
            ...(trendSpec.untilDate ? { lte: trendSpec.untilDate } : {}),
        };

        // Interview date semantics should follow session lifecycle timestamps,
        // not report generation time. Prefer completedAt, fallback to startedAt.
        sessionFilter.OR = [
            { completedAt: range },
            { completedAt: null, startedAt: range },
        ];
    }
    if (Object.keys(sessionFilter).length > 0) {
        whereClause.session = { is: sessionFilter };
    }

    const takeLimit = trendSpec.includeAll ? maxTrendReports : trendSpec.limit;
    const [totalMatchingCount, reports] = await Promise.all([
        prisma.evaluationReport.count({ where: whereClause }),
        prisma.evaluationReport.findMany({
            where: whereClause,
            orderBy: { generatedAt: "desc" },
            take: takeLimit,
            include: { session: { select: { type: true } } },
        }),
    ]);

    let recovery: {
        attempted: boolean;
        reason: string | null;
        totalCount: number;
        countsByType: Record<string, number>;
        sampleSize: number;
    } = {
        attempted: false,
        reason: null,
        totalCount: 0,
        countsByType: {},
        sampleSize: 0,
    };

    if (totalMatchingCount === 0) {
        const [allRowsForCounts, allRowsForTrend] = await Promise.all([
            prisma.evaluationReport.findMany({
                where: { userId },
                select: {
                    session: { select: { type: true } },
                },
            }),
            prisma.evaluationReport.findMany({
                where: { userId },
                orderBy: { generatedAt: "desc" },
                take: Math.min(25, maxTrendReports),
                include: { session: { select: { type: true } } },
            }),
        ]);

        const countsByType: Record<string, number> = {};
        for (const row of allRowsForCounts) {
            const k = String(row.session.type || "unknown");
            countsByType[k] = (countsByType[k] || 0) + 1;
        }

        recovery = {
            attempted: true,
            reason: "initial_filtered_query_returned_zero",
            totalCount: allRowsForCounts.length,
            countsByType,
            sampleSize: allRowsForTrend.length,
        };
    }

    let exactTypeCounts: Record<string, number> | null = null;
    let exactTotalCount: number | null = null;
    if (trendSpec.needExactTypeDistribution) {
        const typeRows = await prisma.evaluationReport.findMany({
            where: whereClause,
            select: {
                session: {
                    select: {
                        type: true,
                    },
                },
            },
        });

        exactTypeCounts = {};
        for (const row of typeRows) {
            const key = String(row.session.type || "unknown");
            exactTypeCounts[key] = (exactTypeCounts[key] || 0) + 1;
        }
        exactTotalCount = typeRows.length;
    }

    const typeCounts: Record<string, number> = {};
    for (const row of reports) {
        const key = String(row.session.type || "unknown");
        typeCounts[key] = (typeCounts[key] || 0) + 1;
    }

    const trend = reports.map((r) => {
        const rubricScores = Array.isArray(r.rubricScores)
            ? (r.rubricScores as any[])
                  .map((x) => ({ category: String(x.category || "general"), score: Number(x.score) || 0 }))
                  .sort((a, b) => a.score - b.score)
                  .slice(0, 2)
                  .map((x) => x.category)
            : [];

        return {
            reportId: r.id,
            generatedAt: r.generatedAt,
            overallScore: Math.round(Number(r.overallScore) || 0),
            type: r.session.type,
            weakestRubrics: rubricScores,
        };
    });

    const newest = trend[0]?.overallScore ?? null;
    const oldest = trend[trend.length - 1]?.overallScore ?? null;
    const delta = newest !== null && oldest !== null ? newest - oldest : 0;

    return {
        trend,
        typeDistribution: {
            totalCount: recovery.totalCount > 0 ? recovery.totalCount : (exactTotalCount ?? totalMatchingCount),
            countsByType: recovery.totalCount > 0 ? recovery.countsByType : (exactTypeCounts ?? typeCounts),
            ratioByType: Object.entries(
                recovery.totalCount > 0 ? recovery.countsByType : (exactTypeCounts ?? typeCounts)
            ).reduce<Record<string, number>>((acc, [type, count]) => {
                const total = recovery.totalCount > 0 ? recovery.totalCount : (exactTotalCount ?? totalMatchingCount);
                acc[type] = total > 0 ? Number(((count / total) * 100).toFixed(2)) : 0;
                return acc;
            }, {}),
            exact: Boolean(trendSpec.needExactTypeDistribution),
        },
        recovery,
        queryMeta: {
            typeFilter: trendSpec.typeFilter,
            requestedTimespanDays: trendSpec.requestedTimespanDays,
            sinceDate: trendSpec.sinceDate?.toISOString() || null,
            untilDate: trendSpec.untilDate?.toISOString() || null,
            exactDateText: trendSpec.exactDateText,
            includeAll: trendSpec.includeAll,
            needExactTypeDistribution: trendSpec.needExactTypeDistribution,
            plannerSource: retrievalPlan.plannerSource,
            dateFilterField: "session.completedAt|session.startedAt",
            limitUsed: takeLimit,
            returnedCount: trend.length,
            totalMatchingCount,
            truncated: totalMatchingCount > trend.length,
            typeCounts,
        },
        deltaSummary: {
            scoreDelta: delta,
            improvingAreas: delta > 0 ? ["overall_consistency"] : [],
            decliningAreas: delta < 0 ? ["overall_consistency"] : [],
        },
    };
}
