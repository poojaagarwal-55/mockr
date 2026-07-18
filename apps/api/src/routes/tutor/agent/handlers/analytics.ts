/**
 * Weak-area management + cross-cutting analytics.
 *
 *   update_weak_area_status — agent declares progress when the user
 *     has demonstrated mastery (correct re-attempt, taught it back, etc.).
 *   identify_patterns       — clusters open weak areas + recent mistakes
 *     into themes (e.g. "DP — repeated failures on subsequence problems").
 *   compare_to_benchmark    — relative-to-self benchmarks: where the
 *     user's recent performance sits vs their own historical baseline.
 */

import { MistakeType, WeakAreaStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../../../lib/prisma.js";

const PATTERN_LOOKBACK_DAYS_DEFAULT = 60;
const COMPARISON_RECENT_WINDOW = 5;
const COMPARISON_BASELINE_WINDOW = 25;

// ── Schemas ─────────────────────────────────────────────────────

export const updateWeakAreaStatusArgs = z
    .object({
        weakAreaId: z.string().trim().min(1).max(64),
        status: z.enum(["open", "improving", "resolved"]),
        reason: z.string().trim().max(300).optional(),
    })
    .strict();

export const identifyPatternsArgs = z
    .object({
        focus: z.enum(["weaknesses", "mistakes", "both"]).optional().default("both"),
        lookbackDays: z.coerce.number().int().min(7).max(365).optional().default(PATTERN_LOOKBACK_DAYS_DEFAULT),
        limit: z.coerce.number().int().min(1).max(15).optional().default(8),
    })
    .strict();

export const compareToBenchmarkArgs = z
    .object({
        type: z.string().trim().min(1).max(50).optional(),
    })
    .strict();

// ── Handlers ────────────────────────────────────────────────────

export async function handleUpdateWeakAreaStatus(
    userId: string,
    args: z.infer<typeof updateWeakAreaStatusArgs>
) {
    const existing = await prisma.userWeakArea.findFirst({
        where: { id: args.weakAreaId, userId },
        select: { id: true, status: true, topic: true },
    });
    if (!existing) {
        throw Object.assign(new Error("weak_area_not_found"), { code: "NOT_FOUND" });
    }

    const newStatus =
        args.status === "open"
            ? WeakAreaStatus.OPEN
            : args.status === "improving"
                ? WeakAreaStatus.IMPROVING
                : WeakAreaStatus.RESOLVED;

    const updated = await prisma.userWeakArea.update({
        where: { id: existing.id },
        data: {
            status: newStatus,
            resolvedAt: newStatus === WeakAreaStatus.RESOLVED ? new Date() : null,
        },
        select: { id: true, topic: true, status: true, resolvedAt: true },
    });

    return {
        ok: true,
        id: updated.id,
        topic: updated.topic,
        previousStatus: existing.status.toLowerCase(),
        status: updated.status.toLowerCase(),
        resolvedAt: updated.resolvedAt?.toISOString() ?? null,
        reason: args.reason ?? null,
    };
}

export async function handleIdentifyPatterns(userId: string, args: z.infer<typeof identifyPatternsArgs>) {
    const since = new Date(Date.now() - args.lookbackDays * 24 * 60 * 60 * 1000);

    const [weakAreas, mistakes] = await Promise.all([
        args.focus === "mistakes"
            ? Promise.resolve([])
            : prisma.userWeakArea.findMany({
                  where: { userId, status: { not: WeakAreaStatus.RESOLVED }, lastSeenAt: { gte: since } },
                  select: {
                      category: true,
                      subcategory: true,
                      topic: true,
                      severity: true,
                      occurrences: true,
                      lastSeenAt: true,
                  },
              }),
        args.focus === "weaknesses"
            ? Promise.resolve([])
            : prisma.userMistake.findMany({
                  where: { userId, createdAt: { gte: since } },
                  select: {
                      mistakeType: true,
                      topicTags: true,
                      createdAt: true,
                  },
              }),
    ]);

    // Cluster weak areas by category, summing occurrences and counting topics.
    const weakClusters = new Map<
        string,
        { category: string; topics: Set<string>; occurrences: number; severities: string[] }
    >();
    for (const wa of weakAreas) {
        const c = wa.category;
        if (!weakClusters.has(c)) {
            weakClusters.set(c, { category: c, topics: new Set(), occurrences: 0, severities: [] });
        }
        const cluster = weakClusters.get(c)!;
        cluster.topics.add(wa.topic);
        cluster.occurrences += wa.occurrences;
        cluster.severities.push(wa.severity.toLowerCase());
    }

    // Cluster mistakes by mistake_type AND by topic tag.
    const mistakeTypeCounts: Record<string, number> = {};
    const tagCounts: Record<string, number> = {};
    for (const m of mistakes) {
        const t = m.mistakeType.toLowerCase();
        mistakeTypeCounts[t] = (mistakeTypeCounts[t] || 0) + 1;
        for (const tag of m.topicTags) {
            tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        }
    }

    const weaknessClusters = Array.from(weakClusters.values())
        .map((c) => ({
            category: c.category,
            topicCount: c.topics.size,
            sampleTopics: Array.from(c.topics).slice(0, 5),
            occurrences: c.occurrences,
            criticalCount: c.severities.filter((s) => s === "critical").length,
            severityMix: tally(c.severities),
        }))
        .sort((a, b) => b.criticalCount - a.criticalCount || b.occurrences - a.occurrences)
        .slice(0, args.limit);

    const recurringTags = Object.entries(tagCounts)
        .filter(([, n]) => n >= 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, args.limit)
        .map(([tag, count]) => ({ tag, count }));

    return {
        lookbackDays: args.lookbackDays,
        weaknessClusters,
        mistakePatterns: {
            countsByType: mistakeTypeCounts,
            recurringTags,
            totalMistakes: mistakes.length,
        },
        summary: buildPatternSummary(weaknessClusters, mistakeTypeCounts, recurringTags),
    };
}

function buildPatternSummary(
    clusters: Array<{ category: string; criticalCount: number; topicCount: number }>,
    typeCounts: Record<string, number>,
    recurringTags: Array<{ tag: string; count: number }>
) {
    const topCluster = clusters[0];
    const topMistakeType = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0];
    const topTag = recurringTags[0];

    const parts: string[] = [];
    if (topCluster) {
        parts.push(
            `Strongest weakness signal in '${topCluster.category}' (${topCluster.topicCount} distinct topics${topCluster.criticalCount > 0 ? `, ${topCluster.criticalCount} critical` : ""})`
        );
    }
    if (topMistakeType) {
        parts.push(`Most common mistake type: '${topMistakeType[0]}' (${topMistakeType[1]} times)`);
    }
    if (topTag) {
        parts.push(`Recurring topic tag: '${topTag.tag}' (${topTag.count} times)`);
    }
    return parts.join("; ") || "No strong patterns yet — more data needed.";
}

function tally(values: string[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const v of values) out[v] = (out[v] || 0) + 1;
    return out;
}

export async function handleCompareToBenchmark(userId: string, args: z.infer<typeof compareToBenchmarkArgs>) {
    const where: any = { userId };
    if (args.type) where.session = { is: { type: args.type } };

    const reports = await prisma.evaluationReport.findMany({
        where,
        orderBy: { generatedAt: "desc" },
        take: COMPARISON_BASELINE_WINDOW,
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
            type: args.type ?? null,
            baselineCount: 0,
            recentCount: 0,
            note: "No reports yet for this filter.",
        };
    }

    const recent = reports.slice(0, COMPARISON_RECENT_WINDOW);
    const baseline = reports.slice(COMPARISON_RECENT_WINDOW);

    const recentAvg = avg(recent.map((r) => Number(r.overallScore) || 0));
    const baselineAvg =
        baseline.length > 0 ? avg(baseline.map((r) => Number(r.overallScore) || 0)) : null;

    const rubricRecent = aggregateRubricAverages(recent);
    const rubricBaseline = aggregateRubricAverages(baseline);

    const rubricDeltas: Array<{ category: string; recent: number; baseline: number | null; delta: number | null }> =
        Object.keys(rubricRecent).map((category) => ({
            category,
            recent: rubricRecent[category],
            baseline: rubricBaseline[category] ?? null,
            delta:
                rubricBaseline[category] !== undefined
                    ? Math.round(rubricRecent[category] - rubricBaseline[category])
                    : null,
        }));

    return {
        type: args.type ?? null,
        baselineCount: baseline.length,
        recentCount: recent.length,
        recentAvgScore: Math.round(recentAvg),
        baselineAvgScore: baselineAvg !== null ? Math.round(baselineAvg) : null,
        deltaScore: baselineAvg !== null ? Math.round(recentAvg - baselineAvg) : null,
        rubricDeltas: rubricDeltas.sort(
            (a, b) => (a.delta ?? 0) - (b.delta ?? 0)
        ),
    };
}

function avg(nums: number[]): number {
    if (nums.length === 0) return 0;
    return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function aggregateRubricAverages(reports: Array<{ rubricScores: any }>): Record<string, number> {
    const sums: Record<string, { total: number; count: number }> = {};
    for (const r of reports) {
        if (!Array.isArray(r.rubricScores)) continue;
        for (const item of r.rubricScores as any[]) {
            const cat = String(item?.category || "").toLowerCase();
            const score = Number(item?.score);
            if (!cat || !Number.isFinite(score)) continue;
            if (!sums[cat]) sums[cat] = { total: 0, count: 0 };
            sums[cat].total += score;
            sums[cat].count += 1;
        }
    }
    const out: Record<string, number> = {};
    for (const [cat, { total, count }] of Object.entries(sums)) {
        out[cat] = count > 0 ? total / count : 0;
    }
    return out;
}

// Re-export so the registry can introspect MistakeType values when needed.
export { MistakeType };
