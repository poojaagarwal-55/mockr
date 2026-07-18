/**
 * Track 2 — context-pack + smarter tools.
 *
 * The agent used to call profile + weak_areas + mistakes + activity in
 * sequence at every turn (4 round-trips, ~600ms wasted). These handlers
 * collapse that into one pack, plus add domain-aware tools so the model
 * can reason about *quality* (mastery, ladder, blueprint, calendar)
 * instead of re-deriving everything from raw rows.
 */

import { TutorMemoryKind, WeakAreaStatus, TutorArtifactStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../../../lib/prisma.js";
import { buildEffectiveInterviewConfig, buildModuleConfigSummary } from "../../module-context.js";
import { resolveQuestionLabels } from "../../tools/get-question-activity-snapshot.js";

// ─────────────────────────────────────────────────────────────────
// Tunables
// ─────────────────────────────────────────────────────────────────

const ACTIVITY_WINDOW_DAYS = 30;
const RECENT_MISTAKE_LIMIT = 8;
const RECENT_HISTORY_DEFAULT_DAYS = 14;

// ─────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────

export const getUserContextPackArgs = z
    .object({
        scope: z.enum(["full", "minimal"]).optional().default("full"),
    })
    .strict();

export const getTopicMasteryArgs = z
    .object({
        topic: z.string().trim().min(1).max(80),
    })
    .strict();

export const getTopicProgressionArgs = z
    .object({
        topic: z.string().trim().min(1).max(80),
    })
    .strict();

export const getCompanyBlueprintArgs = z
    .object({
        company: z.string().trim().min(1).max(80),
        role: z.string().trim().min(1).max(80).optional(),
        level: z.string().trim().min(1).max(40).optional(),
    })
    .strict();

export const getRecentQuestionHistoryArgs = z
    .object({
        days: z.coerce.number().int().min(1).max(60).optional().default(RECENT_HISTORY_DEFAULT_DAYS),
        limit: z.coerce.number().int().min(1).max(50).optional().default(20),
    })
    .strict();

export const getCalendarContextArgs = z.object({}).strict();

export const validateArtifactQualityArgs = z
    .object({
        artifactType: z.enum(["question_sheet", "action_plan", "quiz"]),
        spec: z.record(z.string(), z.unknown()),
    })
    .strict();

// ─────────────────────────────────────────────────────────────────
// get_user_context_pack — single round-trip "everything the model
// usually wants for any non-trivial answer".
// ─────────────────────────────────────────────────────────────────

export async function handleGetUserContextPack(
    userId: string,
    args: z.infer<typeof getUserContextPackArgs>
) {
    const since = new Date(Date.now() - ACTIVITY_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const [profile, openWeakAreas, recentMistakes, progress, recentReports, memories, activePlans, committedSheets, activeArtifacts] =
        await Promise.all([
            prisma.userTutorProfile.findUnique({ where: { userId } }),
            prisma.userWeakArea.findMany({
                where: { userId, status: { not: WeakAreaStatus.RESOLVED } },
                orderBy: [{ severity: "asc" }, { lastSeenAt: "desc" }],
                take: 12,
                select: {
                    id: true,
                    category: true,
                    topic: true,
                    severity: true,
                    occurrences: true,
                    lastSeenAt: true,
                    status: true,
                },
            }),
            args.scope === "minimal"
                ? Promise.resolve([])
                : prisma.userMistake.findMany({
                      where: { userId, createdAt: { gte: since } },
                      orderBy: { createdAt: "desc" },
                      take: RECENT_MISTAKE_LIMIT,
                      select: {
                          mistakeType: true,
                          description: true,
                          topicTags: true,
                          createdAt: true,
                      },
                  }),
            prisma.userQuestionProgress.findMany({
                where: { userId, lastAttemptedAt: { gte: since } },
                select: { status: true, lastAttemptedAt: true, language: true, bestScore: true },
                take: 200,
            }),
            args.scope === "minimal"
                ? Promise.resolve([])
                : prisma.evaluationReport.findMany({
                      where: { userId },
                      orderBy: { generatedAt: "desc" },
                      take: 5,
                      select: {
                          id: true,
                          overallScore: true,
                          competencyScores: true,
                          generatedAt: true,
                          session: { select: { type: true, moduleConfig: true } },
                      },
                  }),
            prisma.tutorMemory.findMany({
                where: {
                    userId,
                    OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
                },
                orderBy: { updatedAt: "desc" },
                take: 12,
                select: { kind: true, key: true, value: true },
            }),
            args.scope === "minimal"
                ? Promise.resolve([])
                : prisma.acceptedActionPlan.findMany({
                      where: { userId, endDate: { gte: new Date() } },
                      orderBy: { startDate: "asc" },
                      take: 3,
                      select: {
                          id: true,
                          label: true,
                          timespan: true,
                          startDate: true,
                          endDate: true,
                      },
                  }),
            prisma.questionSheet.findMany({
                where: { userId },
                orderBy: { generatedAt: "desc" },
                take: 5,
                select: {
                    id: true,
                    label: true,
                    reportId: true,
                    generatedAt: true,
                },
            }),
            prisma.tutorArtifact.findMany({
                where: { userId, status: TutorArtifactStatus.ACTIVE },
                orderBy: { createdAt: "desc" },
                take: 10,
                select: {
                    id: true,
                    artifactType: true,
                    title: true,
                    meta: true,
                    createdAt: true,
                },
            }),
        ]);

    // Tally activity stats from progress rows.
    const statusCounts: Record<string, number> = {};
    for (const p of progress) statusCounts[p.status] = (statusCounts[p.status] || 0) + 1;

    return {
        scope: args.scope,
        profile: profile
            ? {
                  targetCompany: profile.targetCompany,
                  targetRole: profile.targetRole,
                  targetLevel: profile.targetLevel,
                  targetDate: profile.targetDate?.toISOString() ?? null,
                  hoursPerWeek: profile.hoursPerWeek,
                  preferredLanguage: profile.preferredLanguage,
                  preferredTopics: profile.preferredTopics,
                  notes: profile.notes,
              }
            : null,
        openWeakAreas: openWeakAreas.map((w) => ({
            id: w.id,
            category: w.category,
            topic: w.topic,
            severity: w.severity.toLowerCase(),
            occurrences: w.occurrences,
            lastSeenAt: w.lastSeenAt.toISOString(),
            status: w.status.toLowerCase(),
        })),
        recentMistakes: recentMistakes.map((m) => ({
            mistakeType: m.mistakeType.toLowerCase(),
            description: m.description,
            topicTags: m.topicTags,
            createdAt: m.createdAt.toISOString(),
        })),
        activitySnapshot: {
            windowDays: ACTIVITY_WINDOW_DAYS,
            attempted: progress.length,
            solved: statusCounts["solved"] || 0,
            statusCounts,
        },
        recentReports: recentReports.map((r) => ({
            reportId: r.id,
            type: r.session.type,
            effectiveInterviewConfig: buildEffectiveInterviewConfig(r.session.type, r.session.moduleConfig),
            moduleConfigSummary: buildModuleConfigSummary(r.session.type, r.session.moduleConfig),
            overallScore: Math.round(Number(r.overallScore) || 0),
            competencyScores: normalizeCompetencyScores(r.competencyScores),
            generatedAt: r.generatedAt.toISOString(),
        })),
        memories: memories.map((m) => ({
            kind: m.kind.toLowerCase(),
            key: m.key,
            value: m.value,
        })),
        activePlans: activePlans.map((p) => ({
            id: p.id,
            label: p.label,
            timespan: p.timespan,
            startDate: p.startDate.toISOString(),
            endDate: p.endDate.toISOString(),
        })),
        committedSheets: committedSheets.map((s) => ({
            sheetId: s.id,
            label: s.label,
            reportId: s.reportId,
            generatedAt: s.generatedAt.toISOString(),
        })),
        activeArtifacts: activeArtifacts.map((a) => {
            const meta = (a.meta as any) ?? {};
            return {
                artifactId: a.id,
                type: a.artifactType.toLowerCase(),
                title: a.title,
                isDraft: !!meta.isDraft,
                createdAt: a.createdAt.toISOString(),
            };
        }),
    };
}

// ─────────────────────────────────────────────────────────────────
// get_topic_mastery — derived 0-100 score driving "skip vs drill".
// ─────────────────────────────────────────────────────────────────

const SEVERITY_PENALTY = { CRITICAL: 25, MODERATE: 12, MINOR: 5 } as const;

export async function handleGetTopicMastery(userId: string, args: z.infer<typeof getTopicMasteryArgs>) {
    const topicKey = args.topic.toLowerCase();

    const [weakAreas, mistakes, recentSolves] = await Promise.all([
        prisma.userWeakArea.findMany({
            where: { userId, topic: { equals: topicKey } },
            select: { severity: true, status: true, occurrences: true },
        }),
        prisma.userMistake.findMany({
            where: {
                userId,
                createdAt: { gte: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) },
                topicTags: { has: topicKey },
            },
            select: { id: true },
        }),
        prisma.userQuestionProgress.count({
            where: {
                userId,
                status: "solved",
                lastAttemptedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
            },
        }),
    ]);

    let score = 50;
    const reasons: string[] = [];

    for (const wa of weakAreas) {
        if (wa.status === WeakAreaStatus.RESOLVED) {
            score += 15;
            reasons.push(`+15 resolved weakness (${wa.severity.toLowerCase()})`);
        } else if (wa.status === WeakAreaStatus.IMPROVING) {
            score -= Math.round(SEVERITY_PENALTY[wa.severity] * 0.5);
            reasons.push(`-${Math.round(SEVERITY_PENALTY[wa.severity] * 0.5)} improving weakness`);
        } else {
            score -= SEVERITY_PENALTY[wa.severity];
            reasons.push(`-${SEVERITY_PENALTY[wa.severity]} open ${wa.severity.toLowerCase()} weakness`);
        }
    }

    if (mistakes.length > 0) {
        const penalty = Math.min(20, mistakes.length * 5);
        score -= penalty;
        reasons.push(`-${penalty} ${mistakes.length} recent mistake${mistakes.length === 1 ? "" : "s"}`);
    }

    // Coarse positive signal — recent solving activity bumps mastery slightly.
    // We don't have per-question topic mapping reliably; treat as a small bias.
    if (recentSolves > 0) {
        const bump = Math.min(10, Math.round(recentSolves / 4));
        score += bump;
        if (bump > 0) reasons.push(`+${bump} active solving`);
    }

    score = Math.max(0, Math.min(100, score));
    const band =
        score >= 75 ? "strong" : score >= 55 ? "developing" : score >= 35 ? "weak" : "critical";

    return {
        topic: topicKey,
        masteryScore: score,
        band,
        signals: {
            openWeakAreaCount: weakAreas.filter((w) => w.status !== WeakAreaStatus.RESOLVED).length,
            resolvedWeakAreaCount: weakAreas.filter((w) => w.status === WeakAreaStatus.RESOLVED).length,
            recentMistakeCount: mistakes.length,
            recentSolves,
        },
        reasons,
    };
}

// ─────────────────────────────────────────────────────────────────
// get_topic_progression — curated easy → med → hard ladder.
// ─────────────────────────────────────────────────────────────────

export function handleGetTopicProgression(_userId: string, args: z.infer<typeof getTopicProgressionArgs>) {
    const topicKey = args.topic.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    const ladder = TOPIC_LADDERS[topicKey];
    if (!ladder) {
        return {
            topic: topicKey,
            curated: false,
            note: "No curated ladder. Pick by difficulty + topic match instead.",
        };
    }
    return { topic: topicKey, curated: true, ...ladder };
}

type TopicLadder = {
    easy: string[];
    medium: string[];
    hard: string[];
    progressionNote: string;
};

const TOPIC_LADDERS: Record<string, TopicLadder> = {
    two_pointers: {
        easy: ["Valid Palindrome", "Remove Duplicates from Sorted Array", "Reverse String"],
        medium: ["3Sum", "Container With Most Water", "Sort Colors"],
        hard: ["Trapping Rain Water"],
        progressionNote:
            "Start easy to internalize the index movement; medium adds a sorted-array constraint; hard adds an auxiliary data structure (stack-like reasoning).",
    },
    sliding_window: {
        easy: ["Maximum Subarray", "Best Time to Buy and Sell Stock"],
        medium: ["Longest Substring Without Repeating Characters", "Permutation in String", "Longest Repeating Character Replacement"],
        hard: ["Minimum Window Substring", "Sliding Window Maximum"],
        progressionNote:
            "Easy = fixed window. Medium = variable window with hashmap. Hard = window + auxiliary structure (monotonic deque).",
    },
    dynamic_programming: {
        easy: ["Climbing Stairs", "House Robber", "Min Cost Climbing Stairs"],
        medium: ["Coin Change", "Longest Increasing Subsequence", "Word Break", "Unique Paths"],
        hard: ["Edit Distance", "Regular Expression Matching", "Burst Balloons"],
        progressionNote:
            "Easy = 1D DP, single transition. Medium = 1D with non-trivial choice or 2D grid. Hard = 2D with careful state design and interval/sub-problem split.",
    },
    bfs: {
        easy: ["Binary Tree Level Order Traversal"],
        medium: ["Number of Islands", "Rotting Oranges", "Word Ladder"],
        hard: ["Word Ladder II", "Bus Routes"],
        progressionNote:
            "Easy = single-source layer traversal. Medium = multi-source / state in queue. Hard = path reconstruction or transformed-state graph.",
    },
    dfs: {
        easy: ["Maximum Depth of Binary Tree", "Path Sum"],
        medium: ["Number of Islands", "Course Schedule", "Pacific Atlantic Water Flow"],
        hard: ["Word Search II", "Longest Increasing Path in a Matrix"],
        progressionNote:
            "Easy = tree recursion. Medium = grid + visited tracking. Hard = trie-augmented backtracking or memoized DFS.",
    },
    binary_search: {
        easy: ["Binary Search", "First Bad Version"],
        medium: ["Search in Rotated Sorted Array", "Find Peak Element", "Find Minimum in Rotated Sorted Array"],
        hard: ["Median of Two Sorted Arrays", "Split Array Largest Sum"],
        progressionNote:
            "Easy = literal binary search. Medium = binary search on transformed/rotated sorted space. Hard = binary search on the *answer* via monotonic predicate.",
    },
    hashmap: {
        easy: ["Two Sum", "Valid Anagram", "Contains Duplicate"],
        medium: ["Group Anagrams", "Subarray Sum Equals K", "Top K Frequent Elements"],
        hard: ["LRU Cache", "All O`one Data Structure"],
        progressionNote:
            "Easy = direct lookup. Medium = hashmap + prefix/grouping. Hard = hashmap + linked list (cache structures).",
    },
    graphs: {
        easy: ["Number of Connected Components"],
        medium: ["Course Schedule", "Clone Graph", "Pacific Atlantic Water Flow"],
        hard: ["Word Ladder II", "Alien Dictionary", "Reconstruct Itinerary"],
        progressionNote:
            "Easy = traversal + connectivity. Medium = topological sort / multi-source BFS. Hard = Eulerian path or layered BFS with state.",
    },
    system_design_caching: {
        easy: ["Design a key-value cache with LRU eviction"],
        medium: ["Design a CDN cache layer with TTL + invalidation", "Design a feed cache with fanout-on-write"],
        hard: ["Design a globally consistent cache with write-through replication"],
        progressionNote:
            "Easy = single-node eviction policy. Medium = distributed with invalidation strategy. Hard = consistency model + replication.",
    },
};

// ─────────────────────────────────────────────────────────────────
// get_company_blueprint — curated profile of what a company asks.
// ─────────────────────────────────────────────────────────────────

export function handleGetCompanyBlueprint(_userId: string, args: z.infer<typeof getCompanyBlueprintArgs>) {
    const key = args.company.trim().toLowerCase();
    const blueprint = COMPANY_BLUEPRINTS[key];
    if (!blueprint) {
        return {
            company: key,
            curated: false,
            note: "No curated blueprint. Use general SWE interview structure.",
        };
    }
    return {
        company: key,
        role: args.role ?? null,
        level: args.level ?? null,
        curated: true,
        ...blueprint,
    };
}

type CompanyBlueprint = {
    rounds: Array<{ name: string; durationMin: number; focus: string }>;
    dsaTopicMix: Record<string, number>;
    systemDesignDepth: "skip" | "light" | "core" | "deep";
    behavioralWeight: "low" | "medium" | "high";
    notes: string[];
};

const COMPANY_BLUEPRINTS: Record<string, CompanyBlueprint> = {
    google: {
        rounds: [
            { name: "Phone screen (DSA)", durationMin: 45, focus: "1 medium DSA, code+complexity" },
            { name: "Onsite DSA × 2", durationMin: 45, focus: "2 problems each, often medium → hard" },
            { name: "System design", durationMin: 45, focus: "scalable design, deep on consistency" },
            { name: "Behavioral / Googleyness", durationMin: 45, focus: "leadership, ambiguity, collaboration" },
        ],
        dsaTopicMix: { graphs: 0.25, dp: 0.2, arrays_strings: 0.2, trees: 0.15, design: 0.1, other: 0.1 },
        systemDesignDepth: "deep",
        behavioralWeight: "medium",
        notes: [
            "Heavy on graphs and DP — practice both ladders end-to-end.",
            "System design at L5+ goes deep on consistency, sharding, and back-of-envelope math.",
            "Googleyness questions are scored — prep STAR stories around ambiguity and disagreement.",
        ],
    },
    meta: {
        rounds: [
            { name: "Phone screen", durationMin: 45, focus: "1-2 DSA mediums, fast pace" },
            { name: "Coding × 2", durationMin: 45, focus: "Pair of mediums, optimize talk" },
            { name: "System design", durationMin: 45, focus: "product-style design (feeds, search, chat)" },
            { name: "Behavioral", durationMin: 45, focus: "conflict, impact, ownership" },
        ],
        dsaTopicMix: { arrays_strings: 0.3, trees: 0.2, graphs: 0.15, dp: 0.15, design: 0.1, other: 0.1 },
        systemDesignDepth: "core",
        behavioralWeight: "high",
        notes: [
            "Speed matters — mediums in <25 min each.",
            "System design is product-flavored: feeds, ranking, fanout. Less infra-deep than Google.",
            "Behavioral expects measurable impact — quantify everything.",
        ],
    },
    amazon: {
        rounds: [
            { name: "OA / phone", durationMin: 60, focus: "DSA + LP behavioral" },
            { name: "Coding × 2", durationMin: 60, focus: "DSA + design discussion" },
            { name: "System design", durationMin: 60, focus: "scalable services, AWS-ish primitives" },
            { name: "Bar Raiser (LP-heavy)", durationMin: 60, focus: "Leadership Principles deep dive" },
        ],
        dsaTopicMix: { arrays_strings: 0.3, trees: 0.15, graphs: 0.15, dp: 0.1, design: 0.2, other: 0.1 },
        systemDesignDepth: "core",
        behavioralWeight: "high",
        notes: [
            "Leadership Principles (LPs) drive ~50% of scoring — prep 2 stories per LP.",
            "Bar Raiser is the gatekeeper round — practice multi-turn LP follow-ups.",
        ],
    },
    stripe: {
        rounds: [
            { name: "Phone screen (debugging or DSA)", durationMin: 60, focus: "real-world bug fix or medium DSA" },
            { name: "Integration / API design", durationMin: 60, focus: "build a small system live" },
            { name: "System design", durationMin: 60, focus: "payments-flavored: idempotency, consistency" },
            { name: "Behavioral", durationMin: 45, focus: "ownership, customer focus" },
        ],
        dsaTopicMix: {
            arrays_strings: 0.2,
            integration: 0.3,
            api_design: 0.2,
            design: 0.2,
            other: 0.1,
        },
        systemDesignDepth: "deep",
        behavioralWeight: "medium",
        notes: [
            "Integration round is unique — build something against a real API in 60 min.",
            "Heavy on idempotency, exactly-once processing, distributed transactions.",
            "Behavioral focuses on customer impact and on-call ownership.",
        ],
    },
};

// ─────────────────────────────────────────────────────────────────
// get_recent_question_history — exclude-list for sheet builder + UI.
// ─────────────────────────────────────────────────────────────────

export async function handleGetRecentQuestionHistory(
    userId: string,
    args: z.infer<typeof getRecentQuestionHistoryArgs>
) {
    const since = new Date(Date.now() - args.days * 24 * 60 * 60 * 1000);

    const [progress, submissions] = await Promise.all([
        prisma.userQuestionProgress.findMany({
            where: { userId, lastAttemptedAt: { gte: since } },
            orderBy: { lastAttemptedAt: "desc" },
            take: args.limit,
            select: {
                questionId: true,
                status: true,
                lastAttemptedAt: true,
                bestScore: true,
                language: true,
            },
        }),
        prisma.userQuestionSubmission.findMany({
            where: { userId, createdAt: { gte: since } },
            orderBy: { createdAt: "desc" },
            take: Math.min(args.limit, 25),
            select: {
                questionId: true,
                status: true,
                score: true,
                language: true,
                createdAt: true,
            },
        }),
    ]);
    const labels = await resolveQuestionLabels([
        ...progress.map((p) => p.questionId),
        ...submissions.map((s) => s.questionId),
    ]);

    return {
        windowDays: args.days,
        attemptedQuestionIds: progress.map((p) => p.questionId),
        progress: progress.map((p) => ({
            title: labels.get(p.questionId)?.title || "Question title unavailable",
            category: labels.get(p.questionId)?.category || "Question",
            internalQuestionId: p.questionId,
            status: p.status,
            language: p.language,
            bestScore: p.bestScore ? Number(p.bestScore) : null,
            lastAttemptedAt: p.lastAttemptedAt.toISOString(),
        })),
        recentSubmissions: submissions.map((s) => ({
            title: labels.get(s.questionId)?.title || "Question title unavailable",
            category: labels.get(s.questionId)?.category || "Question",
            internalQuestionId: s.questionId,
            status: s.status,
            language: s.language,
            score: s.score ? Number(s.score) : null,
            createdAt: s.createdAt.toISOString(),
        })),
    };
}

// ─────────────────────────────────────────────────────────────────
// get_calendar_context — active accepted plans + soonest deadline.
// ─────────────────────────────────────────────────────────────────

export async function handleGetCalendarContext(userId: string, _args: z.infer<typeof getCalendarContextArgs>) {
    const now = new Date();
    const [plans, profile] = await Promise.all([
        prisma.acceptedActionPlan.findMany({
            where: { userId, endDate: { gte: now } },
            orderBy: { startDate: "asc" },
            take: 5,
            select: {
                id: true,
                label: true,
                timespan: true,
                startDate: true,
                endDate: true,
            },
        }),
        prisma.userTutorProfile.findUnique({
            where: { userId },
            select: { targetDate: true, targetCompany: true, hoursPerWeek: true },
        }),
    ]);

    const targetDate = profile?.targetDate ?? null;
    const daysUntilTarget = targetDate
        ? Math.max(0, Math.ceil((targetDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)))
        : null;

    return {
        now: now.toISOString(),
        targetDate: targetDate?.toISOString() ?? null,
        daysUntilTarget,
        targetCompany: profile?.targetCompany ?? null,
        hoursPerWeek: profile?.hoursPerWeek ?? null,
        activePlans: plans.map((p) => ({
            id: p.id,
            label: p.label,
            timespan: p.timespan,
            startDate: p.startDate.toISOString(),
            endDate: p.endDate.toISOString(),
            daysRemaining: Math.max(
                0,
                Math.ceil((p.endDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
            ),
        })),
    };
}

// ─────────────────────────────────────────────────────────────────
// validate_artifact_quality — internal QA before commit.
// Returns issues[] (empty = ok). Model uses to decide retry vs ship.
// ─────────────────────────────────────────────────────────────────

export function handleValidateArtifactQuality(
    _userId: string,
    args: z.infer<typeof validateArtifactQualityArgs>
) {
    const issues: Array<{ severity: "error" | "warn"; code: string; message: string }> = [];
    const { artifactType, spec } = args;

    if (artifactType === "question_sheet") {
        const questions = Array.isArray((spec as any).questions) ? ((spec as any).questions as any[]) : [];
        if (questions.length === 0) {
            issues.push({ severity: "error", code: "EMPTY", message: "Sheet has no questions." });
        }
        const ids = new Set<string>();
        for (const q of questions) {
            const id = String(q?.id ?? "");
            if (id && ids.has(id)) {
                issues.push({ severity: "error", code: "DUP", message: `Duplicate question id ${id}` });
            }
            if (id) ids.add(id);
        }
        const diffs = new Set(questions.map((q: any) => String(q?.difficulty ?? "").toLowerCase()));
        if (questions.length >= 5 && diffs.size < 2) {
            issues.push({
                severity: "warn",
                code: "FLAT_DIFFICULTY",
                message: "Sheet has 5+ questions but no difficulty progression.",
            });
        }
        if (questions.length > 25) {
            issues.push({
                severity: "warn",
                code: "TOO_LARGE",
                message: "Sheet exceeds 25 questions — split into focused sub-sheets.",
            });
        }
    }

    if (artifactType === "action_plan") {
        const weeks = Array.isArray((spec as any).weeks) ? ((spec as any).weeks as any[]) : [];
        if (weeks.length === 0) {
            issues.push({ severity: "error", code: "EMPTY", message: "Plan has no weeks." });
        }
        const totalHours = weeks.reduce((s, w) => s + (Number(w?.estimatedHours) || 0), 0);
        const expected = Number((spec as any).totalHours);
        if (Number.isFinite(expected) && totalHours > 0 && Math.abs(totalHours - expected) > 5) {
            issues.push({
                severity: "warn",
                code: "HOUR_MISMATCH",
                message: `Sum of week hours (${totalHours}) differs from expected total (${expected}).`,
            });
        }
        if (weeks.length > 0 && weeks.some((w: any) => !w?.milestone)) {
            issues.push({
                severity: "warn",
                code: "MISSING_MILESTONES",
                message: "Some weeks have no measurable milestone.",
            });
        }
    }

    if (artifactType === "quiz") {
        const items = Array.isArray((spec as any).items) ? ((spec as any).items as any[]) : [];
        if (items.length === 0) {
            issues.push({ severity: "error", code: "EMPTY", message: "Quiz has no items." });
        }
        const noExplanation = items.filter((it) => !it?.explanation || String(it.explanation).trim().length < 10);
        if (noExplanation.length > 0) {
            issues.push({
                severity: "warn",
                code: "MISSING_EXPLANATIONS",
                message: `${noExplanation.length} item(s) have no explanation.`,
            });
        }
        const formats = new Set(items.map((it: any) => String(it?.format ?? "")));
        if (items.length >= 6 && formats.size < 2) {
            issues.push({
                severity: "warn",
                code: "FLAT_FORMAT",
                message: "Quiz has 6+ items but only one format — mix mcq + short_answer.",
            });
        }
    }

    return {
        artifactType,
        ok: issues.filter((i) => i.severity === "error").length === 0,
        issues,
    };
}

// Re-export for cases the registry might want.
export { TutorMemoryKind };

function normalizeCompetencyScores(raw: unknown) {
    if (!Array.isArray(raw)) return [];
    return raw
        .map((x: any) => ({
            id: String(x?.id || "").trim(),
            label: String(x?.label || "").trim(),
            score: Math.max(0, Math.min(10, Math.round(Number(x?.score) || 0))),
            strength: String(x?.strength || "").trim(),
        }))
        .filter((x) => x.id && x.label);
}
