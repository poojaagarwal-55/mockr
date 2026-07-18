/**
 * Question catalog handlers.
 *
 *   search_questions — filter the DSA bank by topics / companies /
 *     difficulty. Returns lightweight rows the agent can show or pass
 *     into create_question_sheet.
 *   get_question    — fetch one question's full detail (description,
 *     examples, hints, sample tests). Used when the user asks "explain
 *     question X" or wants a walkthrough.
 *   get_topic_guide — short canonical primers for common interview
 *     topics. Returns null when the topic isn't curated so the agent
 *     can answer from its own knowledge.
 */

import { z } from "zod";
import { ensureMongoDBConnected } from "../../../../lib/mongoose.js";
import { DSAQuestion } from "../../../../models/DSAQuestion.js";

const MAX_SEARCH_RESULTS = 25;

// ── Schemas ─────────────────────────────────────────────────────

export const searchQuestionsArgs = z
    .object({
        topics: z.array(z.string().trim().max(60)).max(10).optional(),
        companies: z.array(z.string().trim().max(60)).max(10).optional(),
        difficulty: z.enum(["easy", "medium", "hard"]).optional(),
        keyword: z.string().trim().max(120).optional(),
        excludeSlugs: z.array(z.string().trim().max(120)).max(50).optional(),
        limit: z.coerce.number().int().min(1).max(MAX_SEARCH_RESULTS).optional().default(10),
    })
    .strict();

export const getQuestionArgs = z
    .object({
        questionId: z.string().trim().min(1).max(120),
    })
    .strict();

export const getTopicGuideArgs = z
    .object({
        topic: z.string().trim().min(1).max(60),
    })
    .strict();

// ── Handlers ────────────────────────────────────────────────────

export async function handleSearchQuestions(_userId: string, args: z.infer<typeof searchQuestionsArgs>) {
    await ensureMongoDBConnected();

    const filter: any = {};
    if (args.topics?.length) {
        filter.topics = { $in: args.topics.map((t) => new RegExp(escapeRegex(t), "i")) };
    }
    if (args.companies?.length) {
        filter.companyTags = { $in: args.companies.map((c) => new RegExp(`^${escapeRegex(c)}$`, "i")) };
    }
    if (args.difficulty) {
        filter.difficulty = args.difficulty.charAt(0).toUpperCase() + args.difficulty.slice(1);
    }
    if (args.excludeSlugs?.length) {
        filter.problemSlug = { $nin: args.excludeSlugs };
    }
    if (args.keyword) {
        const re = new RegExp(escapeRegex(args.keyword), "i");
        filter.$or = [{ title: re }, { description: re }];
    }

    const docs = await DSAQuestion.find(filter)
        .select("title problemSlug difficulty topics companyTags frontendId")
        .limit(args.limit)
        .lean();

    return {
        count: docs.length,
        filter: {
            topics: args.topics ?? [],
            companies: args.companies ?? [],
            difficulty: args.difficulty ?? null,
            keyword: args.keyword ?? null,
        },
        questions: docs.map((d: any) => ({
            id: String(d._id),
            slug: d.problemSlug,
            frontendId: d.frontendId ?? null,
            title: d.title,
            difficulty: String(d.difficulty || "Medium").toLowerCase(),
            topics: d.topics ?? [],
            companies: d.companyTags ?? [],
        })),
    };
}

export async function handleGetQuestion(_userId: string, args: z.infer<typeof getQuestionArgs>) {
    await ensureMongoDBConnected();

    const id = args.questionId;
    const isObjectIdLike = /^[a-f0-9]{24}$/i.test(id);
    const doc = await DSAQuestion.findOne(
        isObjectIdLike ? { _id: id } : { $or: [{ problemSlug: id }, { problemId: id }, { frontendId: id }] }
    )
        .select("title description difficulty topics companyTags examples constraints hints followUp problemSlug frontendId")
        .lean();

    if (!doc) {
        throw Object.assign(new Error("question_not_found"), { code: "NOT_FOUND" });
    }

    return {
        id: String((doc as any)._id),
        slug: (doc as any).problemSlug,
        frontendId: (doc as any).frontendId ?? null,
        title: (doc as any).title,
        difficulty: String((doc as any).difficulty || "Medium").toLowerCase(),
        topics: (doc as any).topics ?? [],
        companies: (doc as any).companyTags ?? [],
        description: clip((doc as any).description ?? "", 4000),
        examples: ((doc as any).examples ?? []).slice(0, 3).map((e: any) => ({
            num: e.example_num,
            text: clip(String(e.example_text ?? ""), 800),
        })),
        constraints: ((doc as any).constraints ?? []).slice(0, 8).map((c: any) => clip(String(c), 200)),
        hints: ((doc as any).hints ?? []).slice(0, 5).map((h: any) => clip(String(h), 400)),
        followUp: ((doc as any).followUp ?? []).slice(0, 3).map((f: any) => clip(String(f), 400)),
    };
}

export function handleGetTopicGuide(_userId: string, args: z.infer<typeof getTopicGuideArgs>) {
    const key = args.topic.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    const guide = TOPIC_GUIDES[key];
    if (!guide) {
        return {
            topic: key,
            curated: false,
            note: "No curated guide. Answer from general knowledge but stay brief.",
        };
    }
    return {
        topic: key,
        curated: true,
        ...guide,
    };
}

// ── Helpers ─────────────────────────────────────────────────────

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clip(s: string, max: number): string {
    if (s.length <= max) return s;
    return s.slice(0, max).replace(/\s+\S*$/, "") + "…";
}

// ── Curated topic primers ───────────────────────────────────────
// Short, opinionated guides. Keep each under ~600 chars so they don't
// dominate the model's context.

type TopicGuide = {
    summary: string;
    whenToUse: string;
    pitfalls: string[];
    practicePattern: string;
    relatedTopics: string[];
};

const TOPIC_GUIDES: Record<string, TopicGuide> = {
    two_pointers: {
        summary:
            "Maintain two indices that move toward, away from, or with each other across a sorted/sliding window to reduce O(n²) brute force to O(n).",
        whenToUse:
            "Sorted array with pair/triplet conditions, palindrome checks, removing duplicates in place, sliding-window over contiguous ranges.",
        pitfalls: [
            "Forgetting to advance both pointers when condition matches.",
            "Off-by-one on while-loop bounds when array length is small.",
            "Using two-pointer on unsorted data without first sorting.",
        ],
        practicePattern: "3Sum → Container With Most Water → Trapping Rain Water (hard variant).",
        relatedTopics: ["sliding_window", "binary_search"],
    },
    sliding_window: {
        summary:
            "Keep a window [l, r] over a sequence and grow / shrink it to maintain a constraint, computing the answer in O(n).",
        whenToUse: "Longest/shortest substring with constraint, max sum of fixed-size window, frequency-bounded ranges.",
        pitfalls: [
            "Recomputing the window state from scratch instead of incrementally updating on shrink/grow.",
            "Using fixed-size logic when the window should be dynamic.",
        ],
        practicePattern:
            "Longest Substring Without Repeating Characters → Minimum Window Substring → Longest Repeating Char Replacement.",
        relatedTopics: ["two_pointers", "hashmap"],
    },
    dynamic_programming: {
        summary:
            "Define an optimal substructure + overlapping subproblems. Choose top-down (memoization) or bottom-up (tabulation). Identify state, transition, base case.",
        whenToUse: "Counting paths, optimal cost, yes/no reachability with reuse — when greedy fails on a counterexample.",
        pitfalls: [
            "Wrong state — too coarse (loses information) or too fine (wastes memory).",
            "Forgetting base cases or boundary indices.",
            "Not space-optimizing when only the previous row matters.",
        ],
        practicePattern:
            "House Robber → Coin Change → Longest Increasing Subsequence → Edit Distance → Regex Match.",
        relatedTopics: ["recursion", "memoization", "greedy"],
    },
    bfs: {
        summary:
            "Layered traversal of a graph using a FIFO queue; finds shortest path in unweighted graphs and processes nodes by distance.",
        whenToUse: "Shortest path in unweighted graph, level-order tree traversal, multi-source flood fill.",
        pitfalls: [
            "Forgetting the visited set, leading to infinite loops.",
            "Using BFS on weighted graphs (need Dijkstra).",
        ],
        practicePattern: "Number of Islands → Word Ladder → Rotting Oranges.",
        relatedTopics: ["dfs", "graph", "shortest_path"],
    },
    dfs: {
        summary:
            "Depth-first traversal; natural for backtracking, connected components, topological sort, and recursive tree problems.",
        whenToUse: "Permutations / combinations, connectivity, tree path sums, cycle detection.",
        pitfalls: [
            "Stack overflow on very deep recursion — convert to iterative.",
            "Mutating shared state across branches without rollback in backtracking.",
        ],
        practicePattern: "Number of Islands (DFS) → Word Search → Combinations → Sudoku Solver.",
        relatedTopics: ["bfs", "backtracking", "recursion"],
    },
    binary_search: {
        summary:
            "Search a sorted space (or a *monotonic predicate* over an unsorted space) by halving each step. O(log n).",
        whenToUse:
            "Sorted array find / lower-bound / upper-bound, search in a rotated array, or any 'minimum X such that f(X) is true' problem.",
        pitfalls: [
            "Mid-overflow when using (l + r) / 2 in non-JS languages — prefer l + (r - l) / 2.",
            "Inclusive vs exclusive boundaries — pick one convention and stick with it.",
            "Infinite loop when the shrink step is wrong.",
        ],
        practicePattern: "Search in Rotated Sorted Array → Find Min in Rotated → Median of Two Sorted Arrays.",
        relatedTopics: ["divide_and_conquer", "sorted_array"],
    },
    hashmap: {
        summary:
            "Trade space for O(1) average lookup. Use to count, deduplicate, group, or memoize seen states.",
        whenToUse: "Frequency counting, complement-pair lookups (Two Sum style), grouping anagrams, prefix-sum cache.",
        pitfalls: [
            "Using an unhashable type (mutable object) as a key in some languages.",
            "Iteration order not guaranteed in older language versions.",
        ],
        practicePattern: "Two Sum → Group Anagrams → Subarray Sum Equals K → LRU Cache.",
        relatedTopics: ["prefix_sum", "two_pointers"],
    },
    system_design_caching: {
        summary:
            "Add a fast lookup layer between consumers and an authoritative store. Decisions: where (client / CDN / app / DB), eviction (LRU/LFU/TTL), invalidation (write-through / write-behind / TTL), consistency (strong / eventual).",
        whenToUse:
            "Read-heavy workload, expensive computation, repeated queries with locality, ratelimit / throttle counters.",
        pitfalls: [
            "Stampede on cold cache miss — use single-flight or stale-while-revalidate.",
            "Cache invalidation: stale data on write or partial writes that violate invariants.",
            "Hot keys — distribute via consistent hashing or local caches with short TTL.",
        ],
        practicePattern:
            "Design URL Shortener (read-heavy) → Design Twitter Feed (fanout + cache) → Design Rate Limiter (counter cache).",
        relatedTopics: ["sharding", "consistency", "load_balancing"],
    },
    behavioral_star: {
        summary:
            "Structure behavioral answers as Situation → Task → Action → Result. Action is the meat: be specific about *what you did personally*, not the team.",
        whenToUse: "Any 'tell me about a time…' question. Conflict, ambiguity, leadership, failure, trade-offs.",
        pitfalls: [
            "Spending 80% on Situation/Task instead of Action.",
            "Using 'we' constantly — interviewers want to know what *you* did.",
            "No measurable Result — quantify or describe the concrete outcome.",
        ],
        practicePattern:
            "Pick 4-6 stories that cover: conflict, failure, ambiguity, leadership, trade-off, deep technical work. Rehearse 90-second versions.",
        relatedTopics: ["communication", "self_reflection"],
    },
};
