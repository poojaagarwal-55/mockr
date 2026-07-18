/**
 * Track 1 — conversational skills (propose / revise / commit).
 *
 * The original create_* tools commit immediately — mediocre output,
 * no user input. These tools split each skill into three phases:
 *
 *   propose_*  — build a DRAFT artifact (meta.isDraft = true) with
 *                rationale per item. Surface to the user, await edits.
 *   revise_*   — apply user edits to a draft (swap, focus, scope).
 *   commit_*   — finalize: meta.isDraft = false. The artifact is now
 *                "the user's", surfaced in their library.
 *
 * Plus request_clarification — when the model needs structured info
 * before proposing (topic, depth, format, etc.). Returns a "pending"
 * shape that the agent loop converts into an SSE event for the UI.
 */

import { TutorArtifactStatus, TutorArtifactType, WeakAreaStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../../../lib/prisma.js";
import { getGeminiClient, GEMINI_MODEL, GEMINI_PRO_MODEL, GEMINI_THINKING_HIGH } from "../../../../lib/gemini.js";
import { ensureMongoDBConnected } from "../../../../lib/mongoose.js";
import { DSAQuestion } from "../../../../models/DSAQuestion.js";
import { SQLQuestion } from "../../../../models/SQLQuestion.js";
import { CSFundamentalQuestion } from "../../../../models/CSFundamentalQuestion.js";
import { SystemDesignQuestion } from "../../../../models/system-design-question.js";
import { GenAIConceptQuestion } from "../../../../models/GenAIConceptQuestion.js";
import { GenAICodingQuestion } from "../../../../models/GenAICodingQuestion.js";
import { GenAISystemDesignQuestion } from "../../../../models/GenAISystemDesignQuestion.js";
import { DSConceptQuestion } from "../../../../models/DSConceptQuestion.js";
import { DSCodingQuestion } from "../../../../models/DSCodingQuestion.js";
import { PMCaseQuestion } from "../../../../models/PMCaseQuestion.js";
import { PMConceptQuestion } from "../../../../models/PMConceptQuestion.js";
import { PMStrategyQuestion } from "../../../../models/PMStrategyQuestion.js";
import { ProblemSolvingCaseQuestion } from "../../../../models/ProblemSolvingCaseQuestion.js";
import { generateDayWisePlan, generatePlanSummary } from "./day-wise-planner.js";

// ─────────────────────────────────────────────────────────────────
// Tunables
// ─────────────────────────────────────────────────────────────────

const MAX_SHEET_QUESTIONS = 25;
const MAX_PLAN_WEEKS = 16;
const MAX_QUIZ_ITEMS = 15;
const MAX_RATIONALE_CHARS = 240;

const CS_TOPIC_ALIASES: Record<string, string> = {
    "oops": "OOPS",
    "oop": "OOPS",
    "object oriented": "OOPS",
    "object-oriented": "OOPS",
    "object oriented programming": "OOPS",
    "object-oriented programming": "OOPS",
    "os": "OS",
    "operating system": "OS",
    "operating systems": "OS",
    "cn": "CN",
    "computer network": "CN",
    "computer networks": "CN",
    "network": "CN",
    "networking": "CN",
    "dbms": "DBMS",
    "database management": "DBMS",
    "database management system": "DBMS",
    "database management systems": "DBMS",
};

// ─────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────

const difficultyMixSchema = z
    .object({
        easy: z.coerce.number().int().min(0).max(MAX_SHEET_QUESTIONS).optional().default(0),
        medium: z.coerce.number().int().min(0).max(MAX_SHEET_QUESTIONS).optional().default(0),
        hard: z.coerce.number().int().min(0).max(MAX_SHEET_QUESTIONS).optional().default(0),
    })
    .optional();

export const proposeQuestionSheetArgs = z
    .object({
        title: z.string().trim().min(3).max(120).optional(),
        focusTopics: z.array(z.string().trim().min(1).max(60)).max(10).optional(),
        companies: z.array(z.string().trim().min(1).max(60)).max(5).optional(),
        difficultyMix: difficultyMixSchema,
        totalQuestions: z.coerce
            .number()
            .int()
            .min(1)
            .max(MAX_SHEET_QUESTIONS)
            .optional()
            .default(8),
        excludeSeen: z.boolean().optional().default(true),
        rationale: z
            .string()
            .trim()
            .max(400)
            .optional()
            .describe("One-line note on why this composition — the agent should articulate its choice"),
        conversationId: z.string().trim().min(1).max(64).optional(),
    })
    .strict();

export const reviseQuestionSheetArgs = z
    .object({
        draftId: z.string().trim().min(1).max(64),
        addTopics: z.array(z.string().trim().min(1).max(60)).max(8).optional(),
        removeTopics: z.array(z.string().trim().min(1).max(60)).max(8).optional(),
        swapQuestionIds: z.array(z.string().trim().min(1).max(64)).max(15).optional(),
        difficultyMix: difficultyMixSchema,
        totalQuestions: z.coerce.number().int().min(1).max(MAX_SHEET_QUESTIONS).optional(),
        title: z.string().trim().min(3).max(120).optional(),
        rationale: z.string().trim().max(400).optional(),
    })
    .strict();

export const commitArtifactArgs = z
    .object({
        draftId: z.string().trim().min(1).max(64),
    })
    .strict();

export const proposeActionPlanArgs = z
    .object({
        title: z.string().trim().min(3).max(160).optional(),
        targetCompany: z.string().trim().min(1).max(80).optional(),
        targetLevel: z.string().trim().min(1).max(40).optional(),
        deadline: z
            .string()
            .trim()
            .refine((s) => !Number.isNaN(Date.parse(s)), { message: "invalid_deadline" })
            .optional(),
        hoursPerWeek: z.coerce.number().int().min(1).max(80).optional(),
        priorityWeakAreaTopics: z.array(z.string().trim().min(1).max(60)).max(15).optional(),
        rationale: z.string().trim().max(400).optional(),
        conversationId: z.string().trim().min(1).max(64).optional(),
    })
    .strict();

export const reviseActionPlanArgs = z
    .object({
        draftId: z.string().trim().min(1).max(64),
        deadline: z
            .string()
            .trim()
            .refine((s) => !Number.isNaN(Date.parse(s)), { message: "invalid_deadline" })
            .optional(),
        hoursPerWeek: z.coerce.number().int().min(1).max(80).optional(),
        priorityWeakAreaTopics: z.array(z.string().trim().min(1).max(60)).max(15).optional(),
        title: z.string().trim().min(3).max(160).optional(),
        rationale: z.string().trim().max(400).optional(),
    })
    .strict();

export const proposeQuizArgs = z
    .object({
        topic: z.string().trim().min(1).max(80),
        questionCount: z.coerce.number().int().min(3).max(MAX_QUIZ_ITEMS).optional().default(8),
        difficulty: z.enum(["easy", "medium", "hard", "mixed"]).optional().default("mixed"),
        title: z.string().trim().min(3).max(120).optional(),
        rationale: z.string().trim().max(400).optional(),
        conversationId: z.string().trim().min(1).max(64).optional(),
    })
    .strict();

export const reviseQuizArgs = z
    .object({
        draftId: z.string().trim().min(1).max(64),
        questionCount: z.coerce.number().int().min(3).max(MAX_QUIZ_ITEMS).optional(),
        difficulty: z.enum(["easy", "medium", "hard", "mixed"]).optional(),
        topic: z.string().trim().min(1).max(80).optional(),
        title: z.string().trim().min(3).max(120).optional(),
        rationale: z.string().trim().max(400).optional(),
    })
    .strict();

export const requestClarificationArgs = z
    .object({
        context: z.string().trim().min(3).max(400),
        slots: z
            .array(
                z
                    .object({
                        id: z.string().trim().min(1).max(40),
                        label: z.string().trim().min(1).max(120),
                        type: z.enum(["chip", "text", "number", "date"]),
                        options: z.array(z.string().trim().min(1).max(80)).max(8).optional(),
                        placeholder: z.string().trim().max(60).optional(),
                        required: z.boolean().optional().default(false),
                    })
                    .strict()
            )
            .min(1)
            .max(5),
    })
    .strict();

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

const DRAFT_META_KEY = "isDraft";

async function getDraftArtifact(userId: string, draftId: string, expectedType: TutorArtifactType) {
    const artifact = await prisma.tutorArtifact.findFirst({
        where: { id: draftId, userId, artifactType: expectedType },
    });
    if (!artifact) throw withCode("draft_not_found", "NOT_FOUND");
    const meta = (artifact.meta as any) ?? {};
    if (!meta[DRAFT_META_KEY]) {
        throw withCode("artifact_already_committed", "INVALID_STATE");
    }
    return artifact;
}

function withCode(message: string, code: string) {
    return Object.assign(new Error(message), { code });
}

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function prettyTopic(t: string): string {
    return t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function clip(s: string, max: number): string {
    if (s.length <= max) return s;
    return s.slice(0, max).replace(/\s+\S*$/, "") + "…";
}

function sanitizeCommittedPlannedDays(raw: unknown) {
    if (!Array.isArray(raw)) return [];
    return raw
        .map((day: any, idx: number) => ({
            day: Number.isFinite(Number(day?.day)) ? Math.max(1, Math.trunc(Number(day.day))) : idx + 1,
            focus: String(day?.focus || `Practice day ${idx + 1}`),
            questionCount: Math.max(0, Math.min(2, Math.trunc(Number(day?.questionCount || 0)))),
            questionTags: Array.isArray(day?.questionTags)
                ? day.questionTags
                    .map((tag: any) => ({
                        category: String(tag?.category || "coding_questions"),
                        count: Math.max(0, Math.trunc(Number(tag?.count || 0))),
                    }))
                    .filter((tag: { category: string; count: number }) => tag.category)
                : [],
            questions: Array.isArray(day?.questions)
                ? day.questions
                    .map((question: any) => ({
                        id: String(question?.id || ""),
                        title: String(question?.title || "Untitled"),
                        category: String(question?.category || "coding_questions"),
                        solveUrl: question?.solveUrl ? String(question.solveUrl) : null,
                        problemSlug: question?.problemSlug ? String(question.problemSlug) : undefined,
                    }))
                    .filter((question: { id: string }) => question.id)
                : [],
        }))
        .filter((day) => day.day > 0);
}

function normalizeCommittedActionPlan(content: any) {
    const plannedDays = sanitizeCommittedPlannedDays(content?.plannedDays);
    const fallbackPlannedDays = plannedDays.length > 0
        ? plannedDays
        : Array.isArray(content?.days)
            ? content.days.map((day: any, idx: number) => {
                const dsaQuestions = Array.isArray(day?.questions?.dsa) ? day.questions.dsa : [];
                const csQuestions = Array.isArray(day?.questions?.csFundamentals) ? day.questions.csFundamentals : [];
                const sqlQuestions = Array.isArray(day?.questions?.sql) ? day.questions.sql : [];
                const systemDesignQuestions = Array.isArray(day?.questions?.systemDesign) ? day.questions.systemDesign : [];

                const allQuestions = [
                    ...dsaQuestions.map((q: any) => ({
                        id: String(q.id),
                        title: String(q.title || "Untitled"),
                        category: "coding_questions",
                        solveUrl: q.solveUrl || null,
                        problemSlug: q.slug || null,
                    })),
                    ...csQuestions.map((q: any) => ({
                        id: String(q.id),
                        title: String(q.title || "Untitled"),
                        category: "cs_fundamentals",
                        solveUrl: q.solveUrl || null,
                    })),
                    ...sqlQuestions.map((q: any) => ({
                        id: String(q.id),
                        title: String(q.title || "Untitled"),
                        category: "sql",
                        solveUrl: q.solveUrl || null,
                    })),
                    ...systemDesignQuestions.map((q: any) => ({
                        id: String(q.id),
                        title: String(q.title || "Untitled"),
                        category: "system_design",
                        solveUrl: q.solveUrl || null,
                    })),
                ];

                const questionTags = [] as Array<{ category: string; count: number }>;
                if (dsaQuestions.length) questionTags.push({ category: "coding_questions", count: dsaQuestions.length });
                if (csQuestions.length) questionTags.push({ category: "cs_fundamentals", count: csQuestions.length });
                if (sqlQuestions.length) questionTags.push({ category: "sql", count: sqlQuestions.length });
                if (systemDesignQuestions.length) questionTags.push({ category: "system_design", count: systemDesignQuestions.length });

                return {
                    day: typeof day?.dayNumber === "number" ? day.dayNumber : idx + 1,
                    focus: day?.focus || day?.title || (Array.isArray(day?.focusAreas) && day.focusAreas[0]) || "Practice",
                    questionCount: allQuestions.length,
                    questionTags,
                    questions: allQuestions,
                };
            })
            : [];

    const totalDays = Math.max(
        1,
        Number(content?.totalDays)
            || fallbackPlannedDays.reduce((max, day) => Math.max(max, day.day), 0)
            || (Array.isArray(content?.days) ? content.days.length : 0)
            || 1
    );

    return {
        totalDays,
        actionPlan: {
            ...content,
            plannedDays: fallbackPlannedDays,
            // Keep the original days array for backward compatibility
            days: content?.days || undefined,
        },
    };
}

function buildCommittedPlanWindow(totalDays: number) {
    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + Math.max(totalDays - 1, 0));
    endDate.setHours(23, 59, 59, 999);

    return { startDate, endDate };
}

function parseJsonObject(raw: string): any {
    const cleaned = raw.replace(/^﻿/, "").trim();
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");
    if (first < 0 || last < 0 || last <= first) throw new Error("model_returned_no_json");
    return JSON.parse(cleaned.slice(first, last + 1));
}

function normalizeDifficultyMix(
    raw: { easy?: number; medium?: number; hard?: number } | undefined,
    total: number
): { easy: number; medium: number; hard: number } {
    const e = raw?.easy ?? 0;
    const m = raw?.medium ?? 0;
    const h = raw?.hard ?? 0;
    const sum = e + m + h;
    if (sum === total && total > 0) return { easy: e, medium: m, hard: h };
    if (total === 1) return { easy: 0, medium: 1, hard: 0 };
    if (total === 2) return { easy: 1, medium: 1, hard: 0 };
    const easy = Math.max(1, Math.round(total * 0.3));
    const hard = Math.max(1, Math.round(total * 0.2));
    const medium = Math.max(1, total - easy - hard);
    return { easy, medium, hard };
}

function sheetQuestionPrefix(category: string): "cs" | "dsa" | "sql" | "sd" {
    const normalized = category.toLowerCase();
    if (normalized === "cs_fundamentals" || ["os", "cn", "dbms", "oops"].includes(normalized)) return "cs";
    if (normalized === "system_design") return "sd";
    if (normalized === "sql") return "sql";
    return "dsa";
}

// ─────────────────────────────────────────────────────────────────
// Question-sheet picking with PER-QUESTION RATIONALE
// Supports DSA, SQL, CS Fundamentals, and System Design questions
// ─────────────────────────────────────────────────────────────────

type SheetEntry = {
    id: string;
    slug: string | null;
    title: string;
    difficulty: string;
    topics: string[];
    focusMatch: string[];
    rationale: string; // why we chose this question
    category:
        | "dsa"
        | "sql"
        | "cs_fundamentals"
        | "system_design"
        | "genai_concepts"
        | "genai_coding"
        | "genai_system_design"
        | "ds_concepts"
        | "ds_coding"
        | "pm_case"
        | "pm_concepts"
        | "pm_strategy"
        | "problem_solving_case";
};

type SheetQuestionBucket = {
    category: SheetEntry["category"] | "dsa";
    focusTopics: string[];
};

function normalizeFocusText(value: string): string {
    return value.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeCsTopic(value: string): string | null {
    const normalized = normalizeFocusText(value);
    return CS_TOPIC_ALIASES[normalized] ?? null;
}

function canonicalFocusTopic(value: string): string {
    const trimmed = value.trim();
    const normalized = normalizeFocusText(trimmed);
    const csTopic = normalizeCsTopic(trimmed);
    if (csTopic) return csTopic;
    if (isSqlFocusTopic(trimmed)) return "SQL";
    if (/\bsystem design\b/.test(normalized)) return "System Design";
    if (normalized === "dsa" || normalized === "coding") return "DSA";
    return trimmed;
}

function canonicalFocusTopics(values: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const value of values) {
        const canonical = canonicalFocusTopic(value);
        const key = normalizeFocusText(canonical);
        if (!canonical || seen.has(key)) continue;
        seen.add(key);
        out.push(canonical);
    }
    return out;
}

function sanitizeQuestionSheetContent(rawContent: unknown): unknown {
    if (!rawContent || typeof rawContent !== "object" || Array.isArray(rawContent)) return rawContent;
    const content = rawContent as Record<string, unknown>;
    if (!Array.isArray(content.focusTopics)) return rawContent;

    return {
        ...content,
        focusTopics: canonicalFocusTopics(content.focusTopics.filter((topic): topic is string => typeof topic === "string")),
    };
}

function isCsFocusTopic(value: string): boolean {
    const normalized = normalizeFocusText(value);
    return Boolean(
        normalizeCsTopic(value) ||
            normalized === "cs" ||
            normalized === "cs fundamentals" ||
            normalized === "computer science fundamentals" ||
            normalized === "fundamentals"
    );
}

function isSqlFocusTopic(value: string): boolean {
    const normalized = normalizeFocusText(value);
    return /\bsql\b/.test(normalized) ||
        /\b(query|queries|join|joins|cte|window function|window functions)\b/.test(normalized);
}

function categoryForFocusTopic(value: string): SheetQuestionBucket["category"] | null {
    const normalized = normalizeFocusText(value);
    if (isCsFocusTopic(value)) return "cs_fundamentals";
    if (isSqlFocusTopic(value)) return "sql";

    if (/\b(genai|gen ai|generative ai|rag|prompt|llm|transformer|model evaluation|mlops)\b/.test(normalized)) {
        if (/\bcoding|retry|wrapper|api|code\b/.test(normalized)) return "genai_coding";
        if (/\bsystem|architecture|design\b/.test(normalized)) return "genai_system_design";
        return "genai_concepts";
    }

    if (/\b(data science|statistics|hypothesis|regression|classification|experiment|bias variance|feature engineering|machine learning|deep learning)\b/.test(normalized)) {
        if (/\bcoding|python|numpy|pandas|sklearn\b/.test(normalized)) return "ds_coding";
        return "ds_concepts";
    }

    if (/\b(pm|product|metrics|prioritization|north star|strategy|product case)\b/.test(normalized)) {
        if (/\bstrategy|market|competition|gtm\b/.test(normalized)) return "pm_strategy";
        if (/\bconcept|metrics|prioritization|north star|experiment\b/.test(normalized)) return "pm_concepts";
        return "pm_case";
    }

    if (/\b(case interview|problem solving case|logical reasoning|analytical case)\b/.test(normalized)) {
        return "problem_solving_case";
    }

    if (/\b(system design|architecture|scalability|distributed systems)\b/.test(normalized)) {
        return "system_design";
    }

    if (/\b(dsa|coding|algorithm|algorithms|data structure|data structures|dp|dynamic programming|graph|graphs|tree|trees|binary search|array|arrays|string|strings|recursion|linked list|heap|stack|queue)\b/.test(normalized)) {
        return "dsa";
    }

    return null;
}

function detectQuestionCategory(focusTopics: string[]): SheetEntry["category"] | "mixed" {
    const allTopics = focusTopics.map(t => t.toLowerCase()).join(" ");

    if (/\b(genai|gen ai|generative ai|rag|prompt|llm|transformer|model evaluation|mlops)\b/.test(allTopics)) {
        if (/\bcoding|retry|wrapper|api|code\b/.test(allTopics)) return "genai_coding";
        if (/\bsystem|architecture|design\b/.test(allTopics)) return "genai_system_design";
        return "genai_concepts";
    }

    if (/\b(data science|statistics|hypothesis|regression|classification|experiment|bias variance|feature engineering|model evaluation|machine learning|deep learning)\b/.test(allTopics)) {
        if (/\bcoding|python|numpy|pandas|sklearn\b/.test(allTopics)) return "ds_coding";
        return "ds_concepts";
    }

    if (/\b(pm|product|metrics|prioritization|north star|strategy|product case)\b/.test(allTopics)) {
        if (/\bstrategy|market|competition|gtm\b/.test(allTopics)) return "pm_strategy";
        if (/\bconcept|metrics|prioritization|north star|experiment\b/.test(allTopics)) return "pm_concepts";
        return "pm_case";
    }

    if (/\bcase interview|problem solving case|logical reasoning|analytical case\b/.test(allTopics)) {
        return "problem_solving_case";
    }
    
    if (focusTopics.some(isSqlFocusTopic) && !focusTopics.some(isCsFocusTopic)) {
        return "sql";
    }
    if (allTopics.includes("system") || allTopics.includes("design") || allTopics.includes("architecture")) {
        return "system_design";
    }
    if (allTopics.includes("network") || allTopics.includes("os") || allTopics.includes("oops") || 
        allTopics.includes("dbms") || allTopics.includes("cn") || allTopics.includes("fundamental")) {
        return "cs_fundamentals";
    }
    if (allTopics.includes("dsa") || allTopics.includes("algorithm") || allTopics.includes("data structure")) {
        return "dsa";
    }
    
    // Default to DSA for backward compatibility
    return "dsa";
}

function detectQuestionBuckets(focusTopics: string[]): SheetQuestionBucket[] {
    const bucketMap = new Map<SheetQuestionBucket["category"], string[]>();
    const unmatchedTopics: string[] = [];

    for (const topic of focusTopics) {
        const category = categoryForFocusTopic(topic);
        if (!category) {
            unmatchedTopics.push(topic);
            continue;
        }
        const bucketTopics = bucketMap.get(category) ?? [];
        bucketTopics.push(topic);
        bucketMap.set(category, bucketTopics);
    }

    const buckets: SheetQuestionBucket[] = Array.from(bucketMap.entries()).map(([category, topics]) => ({
        category,
        focusTopics: category === "sql" ? ["sql"] : topics,
    }));

    if (buckets.length > 0) return buckets;

    const fallbackCategory = detectQuestionCategory(unmatchedTopics.length > 0 ? unmatchedTopics : focusTopics);
    return [{
        category: fallbackCategory === "mixed" ? "dsa" : fallbackCategory,
        focusTopics,
    }];
}

function allocateBucketCounts(total: number, bucketCount: number): number[] {
    if (bucketCount <= 0) return [];
    const base = Math.floor(total / bucketCount);
    let remainder = total % bucketCount;
    return Array.from({ length: bucketCount }, () => base + (remainder-- > 0 ? 1 : 0));
}

async function pickSheetQuestionsWithRationale(input: {
    focusTopics: string[];
    companies: string[];
    excludeSlugs: Set<string>;
    excludeIds: Set<string>;
    mix: { easy: number; medium: number; hard: number };
    totalQuestions: number;
    weakAreaIndex: Map<string, { severity: string; occurrences: number }>;
}): Promise<SheetEntry[]> {
    const buildFilter = (difficulty: "Easy" | "Medium" | "Hard") => {
        const filter: any = { difficulty };
        if (input.focusTopics.length) {
            filter.topics = { $in: input.focusTopics.map((t) => new RegExp(escapeRegex(t), "i")) };
        }
        // REMOVED: Company tag filtering - questions don't have company tags yet
        // Will be added back when company tags are populated in the database
        return filter;
    };

    const fetchBucket = async (difficulty: "Easy" | "Medium" | "Hard", target: number) => {
        if (target === 0) return [] as any[];
        const docs = await DSAQuestion.aggregate([
            { $match: buildFilter(difficulty) },
            { $sample: { size: target * 3 } },
        ]);
        const enough =
            docs.length >= target
                ? docs
                : await DSAQuestion.aggregate([
                      { $match: { difficulty } },
                      { $sample: { size: target * 3 } },
                  ]);
        return enough as any[];
    };

    const [easyDocs, mediumDocs, hardDocs] = await Promise.all([
        fetchBucket("Easy", input.mix.easy),
        fetchBucket("Medium", input.mix.medium),
        fetchBucket("Hard", input.mix.hard),
    ]);

    const used = new Set<string>();
    const pickFromBucket = (docs: any[], target: number) => {
        const out: any[] = [];
        for (const d of docs) {
            if (out.length >= target) break;
            const id = String(d?._id ?? "");
            const slug = d?.problemSlug as string | undefined;
            if (!id) continue;
            if (used.has(id) || input.excludeIds.has(id)) continue;
            if (slug && input.excludeSlugs.has(slug)) continue;
            used.add(id);
            out.push(d);
        }
        return out;
    };

    const picks = [
        ...pickFromBucket(easyDocs, input.mix.easy),
        ...pickFromBucket(mediumDocs, input.mix.medium),
        ...pickFromBucket(hardDocs, input.mix.hard),
    ];

    return picks.slice(0, input.totalQuestions).map((d: any): SheetEntry => {
        const topics: string[] = Array.isArray(d.topics) ? d.topics : [];
        const focusMatch = topics.filter((t) =>
            input.focusTopics.some((ft) => t.toLowerCase().includes(ft.toLowerCase()))
        );
        const lcTopics = topics.map((t) => t.toLowerCase());
        const matchedWeak = lcTopics.find((t) => input.weakAreaIndex.has(t));
        const weakInfo = matchedWeak ? input.weakAreaIndex.get(matchedWeak)! : null;

        const reasons: string[] = [];
        if (weakInfo) {
            reasons.push(
                `targets your ${weakInfo.severity} weak area in ${prettyTopic(matchedWeak!)}` +
                    (weakInfo.occurrences > 1 ? ` (recurring ${weakInfo.occurrences}×)` : "")
            );
        }
        if (focusMatch.length > 0 && !weakInfo) {
            reasons.push(`covers ${focusMatch.slice(0, 2).map(prettyTopic).join(" + ")}`);
        }
        const diff = String(d.difficulty || "Medium").toLowerCase();
        reasons.push(`${diff} ramp`);

        return {
            id: String(d._id),
            slug: d.problemSlug ?? null,
            title: String(d.title ?? "Untitled"),
            difficulty: diff,
            topics,
            focusMatch,
            rationale: clip(reasons.join("; "), MAX_RATIONALE_CHARS),
            category: "dsa",
        };
    });
}

async function pickSQLQuestionsWithRationale(input: {
    totalQuestions: number;
    excludeIds: Set<string>;
}): Promise<SheetEntry[]> {
    await ensureMongoDBConnected();
    
    const docs = await SQLQuestion.aggregate([
        {
            $match: {
                ...(input.excludeIds.size > 0 ? { _id: { $nin: Array.from(input.excludeIds) } } : {}),
            }
        },
        { $sample: { size: input.totalQuestions * 2 } }
    ]);
    
    return docs.slice(0, input.totalQuestions).map((d: any): SheetEntry => ({
        id: String(d._id),
        slug: null,
        title: String(d.title || "Untitled SQL Problem"),
        difficulty: "medium",
        topics: ["sql"],
        focusMatch: ["sql"],
        rationale: "Practice SQL query writing and database concepts",
        category: "sql",
    }));
}

async function pickCSFundamentalsQuestionsWithRationale(input: {
    totalQuestions: number;
    excludeIds: Set<string>;
    focusTopics: string[];
}): Promise<SheetEntry[]> {
    await ensureMongoDBConnected();

    // Detect which specific CS topic(s) the user wants
    const requestedTopics: string[] = [];
    for (const focusTopic of input.focusTopics) {
        const mappedTopic = normalizeCsTopic(focusTopic);
        if (mappedTopic && !requestedTopics.includes(mappedTopic)) {
            requestedTopics.push(mappedTopic);
        }
    }
    
    // If no specific topic detected, use all CS fundamental topics
    const topics = requestedTopics.length > 0 ? requestedTopics : ["CN", "DBMS", "OOPS", "OS"];
    const perTopic = Math.ceil(input.totalQuestions / topics.length);
    const allQuestions: SheetEntry[] = [];
    
    for (const topic of topics) {
        const docs = await CSFundamentalQuestion.aggregate([
            {
                $match: {
                    topic,
                    ...(input.excludeIds.size > 0 ? { _id: { $nin: Array.from(input.excludeIds) } } : {}),
                }
            },
            { $sample: { size: perTopic } }
        ]);
        
        for (const d of docs) {
            if (allQuestions.length >= input.totalQuestions) break;
            
            const topicNames: Record<string, string> = {
                CN: "Computer Networks",
                DBMS: "Database Management",
                OOPS: "Object-Oriented Programming",
                OS: "Operating Systems",
            };
            
            allQuestions.push({
                id: String(d._id),
                slug: null,
                title: String(d.question || "Untitled CS Question").slice(0, 100),
                difficulty: "medium",
                topics: [topic.toLowerCase()],
                focusMatch: [topic.toLowerCase()],
                rationale: `Build ${topicNames[topic]} fundamentals`,
                category: "cs_fundamentals",
            });
        }
    }
    
    return allQuestions.slice(0, input.totalQuestions);
}

async function pickSystemDesignQuestionsWithRationale(input: {
    totalQuestions: number;
    excludeIds: Set<string>;
}): Promise<SheetEntry[]> {
    await ensureMongoDBConnected();
    
    const docs = await SystemDesignQuestion.aggregate([
        {
            $match: {
                ...(input.excludeIds.size > 0 ? { _id: { $nin: Array.from(input.excludeIds) } } : {}),
            }
        },
        { $sample: { size: input.totalQuestions * 2 } }
    ]);
    
    return docs.slice(0, input.totalQuestions).map((d: any): SheetEntry => ({
        id: String(d._id),
        slug: d.slug || null,
        title: String(d.title || "Untitled System Design"),
        difficulty: (d.difficulty || "Medium").toLowerCase(),
        topics: ["system design"],
        focusMatch: ["system design"],
        rationale: "Practice system design and architecture skills",
        category: "system_design",
    }));
}

async function pickSimpleMongoQuestionsWithRationale(input: {
    totalQuestions: number;
    excludeIds: Set<string>;
    category: SheetEntry["category"];
    model: any;
    titleFields: string[];
    topicFields?: string[];
    rationale: string;
}): Promise<SheetEntry[]> {
    await ensureMongoDBConnected();

    const docs = await input.model.aggregate([
        {
            $match: {
                ...(input.excludeIds.size > 0 ? { _id: { $nin: Array.from(input.excludeIds) } } : {}),
            },
        },
        { $sample: { size: input.totalQuestions * 2 } },
    ]);

    return docs.slice(0, input.totalQuestions).map((d: any): SheetEntry => {
        const title = input.titleFields
            .map((field) => d?.[field])
            .find((value) => typeof value === "string" && value.trim().length > 0);
        const topics = (input.topicFields || ["subtopic", "topic", "taskType", "category"])
            .map((field) => d?.[field])
            .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
            .map((value) => value.toLowerCase().replace(/\s+/g, "_"));

        return {
            id: String(d._id),
            slug: d.slug || d.problemSlug || null,
            title: String(title || "Untitled Practice Item").slice(0, 140),
            difficulty: String(d.difficulty || "Medium").toLowerCase(),
            topics: topics.length > 0 ? topics : [input.category],
            focusMatch: topics.slice(0, 2),
            rationale: input.rationale,
            category: input.category,
        };
    });
}

async function pickQuestionsForBucket(input: {
    bucket: SheetQuestionBucket;
    totalQuestions: number;
    companies: string[];
    excludeIds: Set<string>;
    mix: { easy: number; medium: number; hard: number };
    weakAreaIndex: Map<string, { severity: string; occurrences: number }>;
}): Promise<SheetEntry[]> {
    switch (input.bucket.category) {
        case "sql":
            return pickSQLQuestionsWithRationale({
                totalQuestions: input.totalQuestions,
                excludeIds: input.excludeIds,
            });
        case "cs_fundamentals":
            return pickCSFundamentalsQuestionsWithRationale({
                totalQuestions: input.totalQuestions,
                excludeIds: input.excludeIds,
                focusTopics: input.bucket.focusTopics,
            });
        case "system_design":
            return pickSystemDesignQuestionsWithRationale({
                totalQuestions: input.totalQuestions,
                excludeIds: input.excludeIds,
            });
        case "genai_concepts":
            return pickSimpleMongoQuestionsWithRationale({
                totalQuestions: input.totalQuestions,
                excludeIds: input.excludeIds,
                category: "genai_concepts",
                model: GenAIConceptQuestion,
                titleFields: ["question"],
                rationale: "Targets GenAI concept depth from the interview question bank",
            });
        case "genai_coding":
            return pickSimpleMongoQuestionsWithRationale({
                totalQuestions: input.totalQuestions,
                excludeIds: input.excludeIds,
                category: "genai_coding",
                model: GenAICodingQuestion,
                titleFields: ["title", "taskType"],
                rationale: "Practices production-style LLM coding tasks",
            });
        case "genai_system_design":
            return pickSimpleMongoQuestionsWithRationale({
                totalQuestions: input.totalQuestions,
                excludeIds: input.excludeIds,
                category: "genai_system_design",
                model: GenAISystemDesignQuestion,
                titleFields: ["title"],
                rationale: "Practices GenAI architecture and tradeoff reasoning",
            });
        case "ds_concepts":
            return pickSimpleMongoQuestionsWithRationale({
                totalQuestions: input.totalQuestions,
                excludeIds: input.excludeIds,
                category: "ds_concepts",
                model: DSConceptQuestion,
                titleFields: ["question"],
                rationale: "Targets data-science reasoning and statistics concepts",
            });
        case "ds_coding":
            return pickSimpleMongoQuestionsWithRationale({
                totalQuestions: input.totalQuestions,
                excludeIds: input.excludeIds,
                category: "ds_coding",
                model: DSCodingQuestion,
                titleFields: ["title", "question"],
                rationale: "Practices DS coding and data-processing tasks",
            });
        case "pm_case":
            return pickSimpleMongoQuestionsWithRationale({
                totalQuestions: input.totalQuestions,
                excludeIds: input.excludeIds,
                category: "pm_case",
                model: PMCaseQuestion,
                titleFields: ["title", "scenario"],
                rationale: "Practices product case structuring and tradeoffs",
            });
        case "pm_concepts":
            return pickSimpleMongoQuestionsWithRationale({
                totalQuestions: input.totalQuestions,
                excludeIds: input.excludeIds,
                category: "pm_concepts",
                model: PMConceptQuestion,
                titleFields: ["question", "topic"],
                rationale: "Practices product metrics and PM concept judgment",
            });
        case "pm_strategy":
            return pickSimpleMongoQuestionsWithRationale({
                totalQuestions: input.totalQuestions,
                excludeIds: input.excludeIds,
                category: "pm_strategy",
                model: PMStrategyQuestion,
                titleFields: ["title", "scenario"],
                rationale: "Practices product strategy and market reasoning",
            });
        case "problem_solving_case":
            return pickSimpleMongoQuestionsWithRationale({
                totalQuestions: input.totalQuestions,
                excludeIds: input.excludeIds,
                category: "problem_solving_case",
                model: ProblemSolvingCaseQuestion,
                titleFields: ["title", "prompt"],
                rationale: "Practices structured analytical case solving",
            });
        default:
            return pickSheetQuestionsWithRationale({
                focusTopics: input.bucket.focusTopics,
                companies: input.companies,
                excludeSlugs: new Set(),
                excludeIds: input.excludeIds,
                mix: normalizeDifficultyMix(input.mix, input.totalQuestions),
                totalQuestions: input.totalQuestions,
                weakAreaIndex: input.weakAreaIndex,
            });
    }
}

async function pickQuestionSheetWithRationale(input: {
    focusTopics: string[];
    companies: string[];
    excludeIds: Set<string>;
    mix: { easy: number; medium: number; hard: number };
    totalQuestions: number;
    weakAreaIndex: Map<string, { severity: string; occurrences: number }>;
}): Promise<SheetEntry[]> {
    const buckets = detectQuestionBuckets(input.focusTopics);
    const counts = allocateBucketCounts(input.totalQuestions, buckets.length);
    const usedIds = new Set(input.excludeIds);
    const sheet: SheetEntry[] = [];

    for (let i = 0; i < buckets.length; i += 1) {
        const target = counts[i] ?? 0;
        if (target <= 0) continue;
        const picks = await pickQuestionsForBucket({
            bucket: buckets[i],
            totalQuestions: target,
            companies: input.companies,
            excludeIds: usedIds,
            mix: normalizeDifficultyMix(undefined, target),
            weakAreaIndex: input.weakAreaIndex,
        });
        for (const question of picks) {
            if (sheet.length >= input.totalQuestions) break;
            if (usedIds.has(question.id)) continue;
            usedIds.add(question.id);
            sheet.push(question);
        }
    }

    for (const bucket of buckets) {
        if (sheet.length >= input.totalQuestions) break;
        const topUp = await pickQuestionsForBucket({
            bucket,
            totalQuestions: input.totalQuestions - sheet.length,
            companies: input.companies,
            excludeIds: usedIds,
            mix: normalizeDifficultyMix(undefined, input.totalQuestions - sheet.length),
            weakAreaIndex: input.weakAreaIndex,
        });
        for (const question of topUp) {
            if (sheet.length >= input.totalQuestions) break;
            if (usedIds.has(question.id)) continue;
            usedIds.add(question.id);
            sheet.push(question);
        }
    }

    return sheet.slice(0, input.totalQuestions);
}

function buildSheetTitle(focusTopics: string[], companies: string[]): string {
    const focus = focusTopics.slice(0, 2).map(prettyTopic).join(" + ");
    const company = companies[0] ? ` for ${prettyTopic(companies[0])}` : "";
    if (!focus) return `Personalized Practice Sheet${company}`;
    return `${focus} Practice${company}`;
}

// ─────────────────────────────────────────────────────────────────
// propose_question_sheet
// ─────────────────────────────────────────────────────────────────

export async function handleProposeQuestionSheet(
    userId: string,
    args: z.infer<typeof proposeQuestionSheetArgs>
) {
    const [openWeakAreas, profile, recentProgress] = await Promise.all([
        prisma.userWeakArea.findMany({
            where: { userId, status: { not: WeakAreaStatus.RESOLVED } },
            orderBy: [{ severity: "asc" }, { lastSeenAt: "desc" }],
            take: 15,
            select: { topic: true, severity: true, occurrences: true },
        }),
        prisma.userTutorProfile.findUnique({ where: { userId } }),
        args.excludeSeen
            ? prisma.userQuestionProgress.findMany({
                  where: {
                      userId,
                      lastAttemptedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
                  },
                  select: { questionId: true },
                  take: 200,
              })
            : Promise.resolve([]),
    ]);

    const focusTopics = canonicalFocusTopics(
        args.focusTopics && args.focusTopics.length > 0
            ? args.focusTopics
            : openWeakAreas.map((w) => w.topic).slice(0, 6)
    );

    const companies =
        args.companies && args.companies.length > 0
            ? args.companies
            : profile?.targetCompany
                ? [profile.targetCompany]
                : [];

    const requestedTotal = args.totalQuestions;
    const mix = normalizeDifficultyMix(args.difficultyMix, requestedTotal);

    const weakAreaIndex = new Map<string, { severity: string; occurrences: number }>();
    for (const w of openWeakAreas) {
        weakAreaIndex.set(w.topic.toLowerCase(), {
            severity: w.severity.toLowerCase(),
            occurrences: w.occurrences,
        });
    }

    await ensureMongoDBConnected();
    const seenIds = new Set(recentProgress.map((p) => p.questionId).filter(Boolean));

    const sheet = await pickQuestionSheetWithRationale({
        focusTopics,
        companies,
        excludeIds: seenIds,
        mix,
        totalQuestions: requestedTotal,
        weakAreaIndex,
    });

    if (sheet.length < 1) {
        throw withCode("not_enough_matching_questions", "INSUFFICIENT_CATALOG_MATCH");
    }

    // Topic coverage summary so the user can see what's in the sheet at a glance.
    const coverage: Record<string, number> = {};
    for (const q of sheet) {
        for (const t of q.topics.slice(0, 3)) {
            const key = t.toLowerCase();
            coverage[key] = (coverage[key] || 0) + 1;
        }
    }
    const topCoverage = Object.entries(coverage)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([t, n]) => ({ topic: t, count: n }));

    const title = args.title ?? buildSheetTitle(focusTopics, companies);
    const draftRationale =
        args.rationale ??
        buildSheetDraftRationale({
            focusTopics,
            weakAreaCount: openWeakAreas.length,
            mix,
            companies,
        });

    const content = {
        questions: sheet,
        focusTopics,
        companies,
        difficultyMix: mix,
        excludeSeen: args.excludeSeen,
        estimatedHours: Math.round(sheet.length * 0.75 * 10) / 10,
        coverage: topCoverage,
        rationale: draftRationale,
    };

    // Verify conversation exists if conversationId is provided
    let validConversationId: string | null = null;
    if (args.conversationId) {
        const conversation = await prisma.tutorConversation.findFirst({
            where: { id: args.conversationId, userId },
            select: { id: true },
        });
        validConversationId = conversation?.id ?? null;
    }

    const artifact = await prisma.tutorArtifact.create({
        data: {
            userId,
            conversationId: validConversationId,
            artifactType: TutorArtifactType.QUESTION_SHEET,
            status: TutorArtifactStatus.ACTIVE,
            title,
            content,
            meta: {
                [DRAFT_META_KEY]: true,
                derivedFromOpenWeakAreaCount: openWeakAreas.length,
                generatorVersion: 2,
                revisionCount: 0,
            },
        },
        select: { id: true, title: true, createdAt: true },
    });

    return {
        draftId: artifact.id,
        type: "question_sheet",
        isDraft: true,
        title: artifact.title,
        rationale: draftRationale,
        focusTopics,
        difficultyMix: mix,
        questionCount: sheet.length,
        estimatedHours: content.estimatedHours,
        coverage: topCoverage,
        questions: sheet,
        nextStep: "Show this draft to the user. Wait for them to revise or commit before treating it as final.",
        createdAt: artifact.createdAt.toISOString(),
    };
}

function buildSheetDraftRationale(input: {
    focusTopics: string[];
    weakAreaCount: number;
    mix: { easy: number; medium: number; hard: number };
    companies: string[];
}): string {
    const parts: string[] = [];
    if (input.focusTopics.length > 0) {
        parts.push(
            `focused on ${input.focusTopics.slice(0, 3).map(prettyTopic).join(", ")}`
        );
    }
    if (input.weakAreaCount > 0) {
        parts.push(`drawn from your ${input.weakAreaCount} open weak area${input.weakAreaCount === 1 ? "" : "s"}`);
    }
    parts.push(`${input.mix.easy}E / ${input.mix.medium}M / ${input.mix.hard}H mix`);
    if (input.companies.length > 0) {
        parts.push(`weighted toward ${input.companies[0]}`);
    }
    return clip(parts.join("; "), 360);
}

// ─────────────────────────────────────────────────────────────────
// revise_question_sheet
// ─────────────────────────────────────────────────────────────────

export async function handleReviseQuestionSheet(
    userId: string,
    args: z.infer<typeof reviseQuestionSheetArgs>
) {
    const draft = await getDraftArtifact(userId, args.draftId, TutorArtifactType.QUESTION_SHEET);
    const content = (draft.content as any) ?? {};
    const meta = (draft.meta as any) ?? {};

    const currentTopics: string[] = Array.isArray(content.focusTopics) ? content.focusTopics : [];
    const removeSet = new Set((args.removeTopics ?? []).map((t) => t.toLowerCase()));
    const nextTopics = canonicalFocusTopics([
        ...currentTopics.filter((t) => !removeSet.has(t.toLowerCase())),
        ...(args.addTopics ?? []),
    ]);
    const nextTotal = args.totalQuestions ?? Number(content?.questions?.length ?? 8);
    const nextMix = args.difficultyMix
        ? normalizeDifficultyMix(args.difficultyMix, nextTotal)
        : (content.difficultyMix ?? normalizeDifficultyMix(undefined, nextTotal));

    // Topic edits change the requested sources, so rebuild the sheet instead of
    // keeping an old single-source draft and only appending leftovers.
    const topicsChanged = Boolean((args.addTopics?.length ?? 0) > 0 || (args.removeTopics?.length ?? 0) > 0);
    const swappedSet = new Set(args.swapQuestionIds ?? []);
    const keptQuestions: SheetEntry[] = topicsChanged
        ? []
        : (Array.isArray(content.questions) ? content.questions : []).filter(
            (q: any) => !swappedSet.has(String(q?.id ?? ""))
        );

    const remainingSlots = Math.max(0, nextTotal - keptQuestions.length);
    let topUp: SheetEntry[] = [];
    if (remainingSlots > 0 || args.addTopics?.length) {
        const [openWeakAreas] = await Promise.all([
            prisma.userWeakArea.findMany({
                where: { userId, status: { not: WeakAreaStatus.RESOLVED } },
                select: { topic: true, severity: true, occurrences: true },
            }),
        ]);
        const weakAreaIndex = new Map<string, { severity: string; occurrences: number }>();
        for (const w of openWeakAreas) {
            weakAreaIndex.set(w.topic.toLowerCase(), {
                severity: w.severity.toLowerCase(),
                occurrences: w.occurrences,
            });
        }

        await ensureMongoDBConnected();
        const excludeIds = new Set(keptQuestions.map((q) => q.id));
        topUp = await pickQuestionSheetWithRationale({
            focusTopics: nextTopics,
            companies: Array.isArray(content.companies) ? content.companies : [],
            excludeIds,
            mix: nextMix,
            totalQuestions: remainingSlots,
            weakAreaIndex,
        });
    }

    const nextQuestions = [...keptQuestions, ...topUp].slice(0, nextTotal);

    const updated = await prisma.tutorArtifact.update({
        where: { id: draft.id },
        data: {
            title: args.title ?? draft.title,
            content: {
                ...content,
                questions: nextQuestions,
                focusTopics: nextTopics,
                difficultyMix: nextMix,
                rationale: args.rationale ?? content.rationale ?? null,
            },
            meta: { ...meta, revisionCount: (meta.revisionCount ?? 0) + 1 },
        },
        select: { id: true, title: true, content: true, updatedAt: true },
    });

    const nextContent = updated.content as any;
    return {
        draftId: updated.id,
        type: "question_sheet",
        isDraft: true,
        title: updated.title,
        focusTopics: nextContent.focusTopics,
        difficultyMix: nextContent.difficultyMix,
        questionCount: nextContent.questions.length,
        questions: nextContent.questions,
        rationale: nextContent.rationale,
        revisionCount: ((meta.revisionCount ?? 0) + 1),
        updatedAt: updated.updatedAt.toISOString(),
    };
}

// ─────────────────────────────────────────────────────────────────
// propose_action_plan
// ─────────────────────────────────────────────────────────────────

export async function handleProposeActionPlan(
    userId: string,
    args: z.infer<typeof proposeActionPlanArgs>
) {
    const [profile, weakAreas, recentReports, recentProgress] = await Promise.all([
        prisma.userTutorProfile.findUnique({ where: { userId } }),
        prisma.userWeakArea.findMany({
            where: { userId, status: { not: WeakAreaStatus.RESOLVED } },
            orderBy: [{ severity: "asc" }, { lastSeenAt: "desc" }],
            take: 15,
            select: { topic: true, category: true, severity: true, occurrences: true },
        }),
        prisma.evaluationReport.findMany({
            where: { userId },
            orderBy: { generatedAt: "desc" },
            take: 5,
            select: {
                overallScore: true,
                rubricScores: true,
                generatedAt: true,
                session: { select: { type: true } },
            },
        }),
        prisma.userQuestionProgress.findMany({
            where: {
                userId,
                lastAttemptedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
            },
            select: { questionId: true },
            take: 200,
        }),
    ]);

    const targetCompany = args.targetCompany ?? profile?.targetCompany ?? null;
    const targetLevel = args.targetLevel ?? profile?.targetLevel ?? null;
    const rawHoursPerWeek = args.hoursPerWeek ?? profile?.hoursPerWeek ?? 8;
    const hoursPerWeek = Math.max(1, Number(rawHoursPerWeek) || 0);
    const deadlineDate = args.deadline
        ? new Date(args.deadline)
        : profile?.targetDate ?? new Date(Date.now() + 8 * 7 * 24 * 60 * 60 * 1000);

    const today = new Date();
    const totalDays = Math.max(
        1,
        Math.min(
            MAX_PLAN_WEEKS * 7,
            Math.ceil((deadlineDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000))
        )
    );
    const hoursPerDay = hoursPerWeek / 7;
    const totalHours = totalDays * hoursPerDay;
    
    const priorityTopics =
        args.priorityWeakAreaTopics && args.priorityWeakAreaTopics.length > 0
            ? args.priorityWeakAreaTopics
            : weakAreas.slice(0, 6).map((w) => w.topic);

    // Generate day-wise plan with questions
    const excludeQuestionIds = new Set(recentProgress.map(p => p.questionId).filter(Boolean));
    const days = await generateDayWisePlan({
        userId,
        totalDays,
        hoursPerDay,
        weakAreas: weakAreas.map(w => ({
            topic: w.topic,
            category: w.category,
            severity: w.severity,
            occurrences: w.occurrences,
        })),
        priorityTopics,
        excludeQuestionIds,
    });

    // Generate summary using Gemini Pro
    const planSummary = generatePlanSummary(days);
    const systemInstruction = `You produce concise, actionable summaries for interview prep action plans.
Return JSON ONLY with shape:
{
  "summary": "2-3 sentence overview of the plan's approach and timeline",
  "priorityFocus": "single sentence describing the top priority focus area"
}

Rules:
- Be specific about what the user will accomplish
- Mention the timeline (${totalDays} days)
- Reference their weak areas if relevant
- Keep it motivating but realistic`;

    const userPrompt = JSON.stringify({
        totalDays,
        hoursPerDay: Math.round(hoursPerDay * 10) / 10,
        targetCompany,
        targetLevel,
        priorityTopics,
        weakAreas: weakAreas.slice(0, 5).map((w) => ({
            topic: w.topic,
            severity: w.severity.toLowerCase(),
        })),
        planSummary,
    });

    let parsed: any;
    try {
        const result = await getGeminiClient().models.generateContent({
            model: GEMINI_PRO_MODEL,
            contents: userPrompt,
            config: {
                systemInstruction,
                responseMimeType: "application/json",
                thinkingConfig: GEMINI_THINKING_HIGH,
            },
        });
        parsed = parseJsonObject(result.text ?? "");
    } catch (err: any) {
        // Fallback summary if generation fails
        parsed = {
            summary: `${totalDays}-day intensive prep plan covering ${priorityTopics.slice(0, 3).join(", ")} with ${planSummary.totalQuestions} curated questions.`,
            priorityFocus: `Master ${priorityTopics[0]?.replace(/_/g, " ") || "core concepts"} through daily practice`,
        };
    }

    const title =
        args.title ??
        `${targetCompany ? `${targetCompany} ` : ""}${totalDays}-Day Prep Plan`;

    // Transform days to plannedDays format for calendar compatibility
    const plannedDays = days.map(day => {
        const allQuestions = [
            ...(day.questions?.dsa || []).map(q => ({
                id: q.id,
                title: q.title,
                category: 'coding_questions',
                solveUrl: q.solveUrl || null,
                problemSlug: q.slug || null,
            })),
            ...(day.questions?.csFundamentals || []).map(q => ({
                id: q.id,
                title: q.title,
                category: 'cs_fundamentals',
                solveUrl: q.solveUrl || null,
            })),
            ...(day.questions?.sql || []).map(q => ({
                id: q.id,
                title: q.title,
                category: 'sql',
                solveUrl: q.solveUrl || null,
            })),
            ...(day.questions?.systemDesign || []).map(q => ({
                id: q.id,
                title: q.title,
                category: 'system_design',
                solveUrl: q.solveUrl || null,
            })),
        ];

        const questionTags = [];
        if (day.questions?.dsa?.length) {
            questionTags.push({ category: 'coding_questions', count: day.questions.dsa.length });
        }
        if (day.questions?.csFundamentals?.length) {
            questionTags.push({ category: 'cs_fundamentals', count: day.questions.csFundamentals.length });
        }
        if (day.questions?.sql?.length) {
            questionTags.push({ category: 'sql', count: day.questions.sql.length });
        }
        if (day.questions?.systemDesign?.length) {
            questionTags.push({ category: 'system_design', count: day.questions.systemDesign.length });
        }

        return {
            day: day.dayNumber,
            focus: day.title || (Array.isArray(day.focusAreas) && day.focusAreas[0]) || "Practice",
            questionCount: allQuestions.length,
            questionTags,
            questions: allQuestions,
        };
    });

    const content = {
        summary: typeof parsed.summary === "string" ? clip(parsed.summary, 600) : null,
        priorityFocus:
            typeof parsed.priorityFocus === "string" ? clip(parsed.priorityFocus, 240) : null,
        targetCompany,
        targetLevel,
        deadline: deadlineDate.toISOString(),
        hoursPerWeek,
        hoursPerDay,
        totalHours,
        totalDays,
        priorityTopics,
        days, // Keep new format for future use
        plannedDays, // Add old format for calendar compatibility
        planSummary,
        rationale: args.rationale ?? null,
    };

    // Verify conversation exists if conversationId is provided
    let validConversationId: string | null = null;
    if (args.conversationId) {
        const conversation = await prisma.tutorConversation.findFirst({
            where: { id: args.conversationId, userId },
            select: { id: true },
        });
        validConversationId = conversation?.id ?? null;
    }

    const artifact = await prisma.tutorArtifact.create({
        data: {
            userId,
            conversationId: validConversationId,
            artifactType: TutorArtifactType.ACTION_PLAN,
            status: TutorArtifactStatus.ACTIVE,
            title,
            content,
            meta: {
                [DRAFT_META_KEY]: true,
                weakAreaCount: weakAreas.length,
                generatorVersion: 3, // V3 = day-wise with questions
                revisionCount: 0,
            },
        },
        select: { id: true, title: true, createdAt: true },
    });

    return {
        draftId: artifact.id,
        type: "action_plan",
        isDraft: true,
        title: artifact.title,
        totalDays,
        totalHours,
        hoursPerDay,
        targetCompany,
        priorityTopics,
        summary: content.summary,
        priorityFocus: content.priorityFocus,
        dayCount: days.length,
        totalQuestions: planSummary.totalQuestions,
        questionsByDifficulty: planSummary.questionsByDifficulty,
        topicCoverage: planSummary.topicCoverage,
        rationale: args.rationale ?? null,
        nextStep: "Show the draft to the user; wait for revisions or commit before treating it final.",
        createdAt: artifact.createdAt.toISOString(),
    };
}

function sanitizePlanWeeks(raw: unknown, expectedCount: number, hoursPerWeek: number) {
    if (!Array.isArray(raw)) return [];
    return raw
        .slice(0, expectedCount)
        .map((w: any, idx) => ({
            weekNumber: typeof w?.weekNumber === "number" ? w.weekNumber : idx + 1,
            title: typeof w?.title === "string" ? w.title.slice(0, 120) : `Week ${idx + 1}`,
            goals: Array.isArray(w?.goals)
                ? (w.goals as unknown[]).map((g) => String(g).slice(0, 200)).slice(0, 6)
                : [],
            topics: Array.isArray(w?.topics)
                ? (w.topics as unknown[]).map((t) => String(t).slice(0, 60).toLowerCase()).slice(0, 8)
                : [],
            estimatedHours:
                typeof w?.estimatedHours === "number" && Number.isFinite(w.estimatedHours)
                    ? Math.max(1, Math.min(40, Math.round(w.estimatedHours)))
                    : hoursPerWeek,
            milestone: typeof w?.milestone === "string" ? w.milestone.slice(0, 240) : null,
            rationale: typeof w?.rationale === "string" ? clip(w.rationale, 240) : null,
        }))
        .filter((w) => w.title.length > 0);
}

// ─────────────────────────────────────────────────────────────────
// revise_action_plan
// ─────────────────────────────────────────────────────────────────

export async function handleReviseActionPlan(userId: string, args: z.infer<typeof reviseActionPlanArgs>) {
    const draft = await getDraftArtifact(userId, args.draftId, TutorArtifactType.ACTION_PLAN);
    const content = (draft.content as any) ?? {};
    const meta = (draft.meta as any) ?? {};

    // If deadline / hoursPerWeek / priorityTopics changed, regenerate the plan.
    const needsRegen =
        Boolean(args.deadline) ||
        Boolean(args.hoursPerWeek) ||
        Boolean(args.priorityWeakAreaTopics?.length);

    if (!needsRegen) {
        const updated = await prisma.tutorArtifact.update({
            where: { id: draft.id },
            data: {
                title: args.title ?? draft.title,
                content: { ...content, rationale: args.rationale ?? content.rationale ?? null },
                meta: { ...meta, revisionCount: (meta.revisionCount ?? 0) + 1 },
            },
            select: { id: true, title: true, content: true, updatedAt: true },
        });
        return {
            draftId: updated.id,
            type: "action_plan",
            isDraft: true,
            title: updated.title,
            ...(updated.content as object),
            updatedAt: updated.updatedAt.toISOString(),
        };
    }

    // Regenerate with the same flow as propose_action_plan, but using merged args.
    const regen = await handleProposeActionPlan(userId, {
        title: args.title ?? draft.title,
        targetCompany: content.targetCompany ?? undefined,
        targetLevel: content.targetLevel ?? undefined,
        deadline: args.deadline ?? content.deadline ?? undefined,
        hoursPerWeek: args.hoursPerWeek ?? content.hoursPerWeek ?? undefined,
        priorityWeakAreaTopics: args.priorityWeakAreaTopics ?? content.priorityTopics ?? undefined,
        rationale: args.rationale ?? content.rationale ?? undefined,
        conversationId: draft.conversationId ?? undefined,
    });

    // Fetch the full content from the newly generated artifact before deleting it
    const newArtifact = await prisma.tutorArtifact.findUnique({
        where: { id: regen.draftId },
        select: { content: true }
    });
    const newContent = (newArtifact?.content as any) ?? {};

    // Replace old draft with new one — keep id stable by patching.
    await prisma.tutorArtifact.update({
        where: { id: draft.id },
        data: {
            title: regen.title,
            content: {
                summary: regen.summary,
                priorityFocus: regen.priorityFocus,
                targetCompany: regen.targetCompany,
                targetLevel: content.targetLevel ?? null,
                deadline: newContent.deadline ?? content.deadline ?? null,
                hoursPerWeek: newContent.hoursPerWeek ?? content.hoursPerWeek ?? null,
                hoursPerDay: newContent.hoursPerDay,
                totalHours: regen.totalHours,
                totalDays: newContent.totalDays,
                priorityTopics: regen.priorityTopics,
                days: newContent.days,
                plannedDays: newContent.plannedDays,
                planSummary: newContent.planSummary,
                rationale: regen.rationale,
            },
            meta: { ...meta, revisionCount: (meta.revisionCount ?? 0) + 1 },
        },
    });
    // Also clean up the new artifact created by the inner propose call.
    await prisma.tutorArtifact.delete({ where: { id: regen.draftId } });

    return {
        draftId: draft.id,
        type: "action_plan",
        isDraft: true,
        title: regen.title,
        ...(newContent as object),
        summary: regen.summary,
        priorityFocus: regen.priorityFocus,
        rationale: regen.rationale,
        revisionCount: (meta.revisionCount ?? 0) + 1,
    };
}

// ─────────────────────────────────────────────────────────────────
// propose_quiz / revise_quiz
// ─────────────────────────────────────────────────────────────────

export async function handleProposeQuiz(userId: string, args: z.infer<typeof proposeQuizArgs>) {
    const systemInstruction = `You produce a focused interview-prep quiz with strong explanations.
Return JSON ONLY with shape:
{
  "summary": "1-sentence what this quiz tests",
  "items": [
    {
      "id": "<short-stable-id>",
      "format": "mcq",
      "prompt": "...",
      "choices": ["...", "...", "...", "..."],
      "correctIndex": <int>,
      "explanation": "...",
      "difficulty": "easy" | "medium" | "hard",
      "weakAreaTag": "<canonical topic this tests>"
    }
  ]
}

Rules:
- Output exactly ${args.questionCount} items.
- ALL questions MUST be multiple choice (MCQ) format only.
- Each MCQ must have exactly 4 choices.
- Each item must test understanding, not trivia.
- Explanations must be 1-2 sentences and explain the WHY.
- Include weakAreaTag so the user can map to specific topics.
- Difficulty target: ${args.difficulty}.`;

    const userPrompt = JSON.stringify({ topic: args.topic, count: args.questionCount });

    let parsed: any;
    try {
        const result = await getGeminiClient().models.generateContent({
            model: GEMINI_MODEL,
            contents: userPrompt,
            config: { systemInstruction, responseMimeType: "application/json" },
        });
        parsed = parseJsonObject(result.text ?? "");
    } catch (err: any) {
        throw withCode(`quiz_generation_failed:${err?.message ?? "unknown"}`, "GENERATION_FAILED");
    }

    const items = sanitizeQuizItems(parsed.items, args.questionCount);
    if (items.length === 0) throw withCode("quiz_generation_returned_empty", "GENERATION_EMPTY");

    const title = args.title ?? `${prettyTopic(args.topic)} Quiz`;
    const content = {
        summary: typeof parsed.summary === "string" ? clip(parsed.summary, 300) : null,
        topic: args.topic,
        difficulty: args.difficulty,
        items,
        rationale: args.rationale ?? null,
    };

    // Verify conversation exists if conversationId is provided
    let validConversationId: string | null = null;
    if (args.conversationId) {
        const conversation = await prisma.tutorConversation.findFirst({
            where: { id: args.conversationId, userId },
            select: { id: true },
        });
        validConversationId = conversation?.id ?? null;
    }

    const artifact = await prisma.tutorArtifact.create({
        data: {
            userId,
            conversationId: validConversationId,
            artifactType: TutorArtifactType.QUIZ,
            status: TutorArtifactStatus.ACTIVE,
            title,
            content,
            meta: {
                [DRAFT_META_KEY]: true,
                generatorVersion: 2,
                revisionCount: 0,
            },
        },
        select: { id: true, title: true, createdAt: true },
    });

    return {
        draftId: artifact.id,
        type: "quiz",
        isDraft: true,
        title: artifact.title,
        topic: args.topic,
        difficulty: args.difficulty,
        itemCount: items.length,
        items,
        summary: content.summary,
        rationale: args.rationale ?? null,
        nextStep: "Show this quiz draft to the user; commit only after they approve.",
        createdAt: artifact.createdAt.toISOString(),
    };
}

function sanitizeQuizItems(raw: unknown, expected: number) {
    if (!Array.isArray(raw)) return [];
    return raw
        .slice(0, expected)
        .map((item: any, idx) => {
            // Only accept MCQ format
            const base = {
                id: typeof item?.id === "string" ? item.id.slice(0, 32) : `q_${idx + 1}`,
                format: "mcq" as const,
                prompt: typeof item?.prompt === "string" ? item.prompt.slice(0, 400) : "",
                explanation: typeof item?.explanation === "string" ? item.explanation.slice(0, 400) : "",
                difficulty: ["easy", "medium", "hard"].includes(item?.difficulty) ? item.difficulty : "medium",
                weakAreaTag:
                    typeof item?.weakAreaTag === "string" ? item.weakAreaTag.slice(0, 60).toLowerCase() : null,
            };
            if (!base.prompt) return null;
            
            // Validate MCQ has choices
            const choices = Array.isArray(item?.choices)
                ? (item.choices as unknown[]).map((c) => String(c).slice(0, 240)).slice(0, 4)
                : [];
            
            // Must have at least 2 choices, ideally 4
            if (choices.length < 2) return null;
            
            const correctIndex =
                typeof item?.correctIndex === "number" &&
                item.correctIndex >= 0 &&
                item.correctIndex < choices.length
                    ? item.correctIndex
                    : 0;
            
            return { ...base, choices, correctIndex };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
}

export async function handleReviseQuiz(userId: string, args: z.infer<typeof reviseQuizArgs>) {
    const draft = await getDraftArtifact(userId, args.draftId, TutorArtifactType.QUIZ);
    const content = (draft.content as any) ?? {};
    const meta = (draft.meta as any) ?? {};

    const needsRegen =
        Boolean(args.questionCount) || Boolean(args.difficulty) || Boolean(args.topic);

    if (!needsRegen) {
        const updated = await prisma.tutorArtifact.update({
            where: { id: draft.id },
            data: {
                title: args.title ?? draft.title,
                content: { ...content, rationale: args.rationale ?? content.rationale ?? null },
                meta: { ...meta, revisionCount: (meta.revisionCount ?? 0) + 1 },
            },
            select: { id: true, title: true, content: true, updatedAt: true },
        });
        return {
            draftId: updated.id,
            type: "quiz",
            isDraft: true,
            title: updated.title,
            ...(updated.content as object),
            updatedAt: updated.updatedAt.toISOString(),
        };
    }

    const regen = await handleProposeQuiz(userId, {
        topic: args.topic ?? content.topic,
        questionCount: args.questionCount ?? Number(content.items?.length ?? 8),
        difficulty: (args.difficulty ?? content.difficulty ?? "mixed") as any,
        title: args.title ?? draft.title,
        rationale: args.rationale ?? content.rationale ?? undefined,
        conversationId: draft.conversationId ?? undefined,
    });

    await prisma.tutorArtifact.update({
        where: { id: draft.id },
        data: {
            title: regen.title,
            content: {
                summary: regen.summary,
                topic: regen.topic,
                difficulty: regen.difficulty,
                items: regen.items,
                rationale: regen.rationale,
            },
            meta: { ...meta, revisionCount: (meta.revisionCount ?? 0) + 1 },
        },
    });
    await prisma.tutorArtifact.delete({ where: { id: regen.draftId } });

    return {
        draftId: draft.id,
        type: "quiz",
        isDraft: true,
        title: regen.title,
        topic: regen.topic,
        difficulty: regen.difficulty,
        itemCount: regen.itemCount,
        items: regen.items,
        summary: regen.summary,
        rationale: regen.rationale,
        revisionCount: (meta.revisionCount ?? 0) + 1,
    };
}

// ─────────────────────────────────────────────────────────────────
// commit (shared) — flips meta.isDraft = false
// ─────────────────────────────────────────────────────────────────

export async function handleCommitArtifact(userId: string, args: z.infer<typeof commitArtifactArgs>) {
    console.log("[handleCommitArtifact] START - userId:", userId, "draftId:", args.draftId);
    
    const artifact = await prisma.tutorArtifact.findFirst({
        where: { id: args.draftId, userId },
        select: { id: true, title: true, artifactType: true, meta: true, content: true, conversationId: true },
    });
    
    console.log("[handleCommitArtifact] Found artifact:", {
        found: !!artifact,
        id: artifact?.id,
        title: artifact?.title,
        type: artifact?.artifactType,
        conversationId: artifact?.conversationId,
    });
    
    if (!artifact) throw withCode("draft_not_found", "NOT_FOUND");
    const meta = (artifact.meta as any) ?? {};
    
    console.log("[handleCommitArtifact] Artifact meta:", {
        isDraft: meta[DRAFT_META_KEY],
        metaKeys: Object.keys(meta),
    });
    
    if (!meta[DRAFT_META_KEY]) {
        console.log("[handleCommitArtifact] Already committed - returning early");
        return {
            artifactId: artifact.id,
            resourceId: meta.resourceId || null,
            type: artifact.artifactType.toLowerCase(),
            title: artifact.title,
            committed: true,
            note: "Already committed.",
        };
    }

    console.log("[handleCommitArtifact] Updating artifact to mark as committed");
    const committedContent =
        artifact.artifactType === TutorArtifactType.QUESTION_SHEET
            ? sanitizeQuestionSheetContent(artifact.content)
            : artifact.content;
    const updated = await prisma.tutorArtifact.update({
        where: { id: artifact.id },
        data: {
            meta: { ...meta, [DRAFT_META_KEY]: false, committedAt: new Date().toISOString() },
            content: committedContent as any,
        },
        select: { id: true, title: true, artifactType: true, content: true, updatedAt: true },
    });

    const content = updated.content as any;
    let resourceId: string | null = null;
    console.log("[handleCommitArtifact] Content structure:", {
        hasQuestions: Array.isArray(content?.questions),
        questionCount: Array.isArray(content?.questions) ? content.questions.length : 0,
        contentKeys: content ? Object.keys(content) : [],
    });

    const resolveReport = async () => {
        console.log("[handleCommitArtifact] Resolving report - conversationId:", artifact.conversationId);
        
        if (artifact.conversationId) {
            const conversation = await prisma.tutorConversation.findFirst({
                where: { id: artifact.conversationId, userId },
                select: { reportId: true },
            });
            console.log("[handleCommitArtifact] Found conversation:", {
                found: !!conversation,
                reportId: conversation?.reportId,
            });
            
            if (conversation?.reportId) {
                const report = await prisma.evaluationReport.findFirst({
                    where: { id: conversation.reportId, userId },
                    select: {
                        id: true,
                        sessionId: true,
                        generatedAt: true,
                        session: { select: { type: true, level: true } },
                    },
                });
                console.log("[handleCommitArtifact] Found report from conversation:", {
                    found: !!report,
                    reportId: report?.id,
                });
                if (report) return report;
            }
        }

        console.log("[handleCommitArtifact] Falling back to latest report for user");
        const latestReport = await prisma.evaluationReport.findFirst({
            where: { userId },
            orderBy: { generatedAt: "desc" },
            select: {
                id: true,
                sessionId: true,
                generatedAt: true,
                session: { select: { type: true, level: true } },
            },
        });
        console.log("[handleCommitArtifact] Latest report:", {
            found: !!latestReport,
            reportId: latestReport?.id,
        });
        return latestReport;
    };

    const resolvedReport = await resolveReport();
    console.log("[handleCommitArtifact] Final resolved report:", {
        hasReport: !!resolvedReport,
        reportId: resolvedReport?.id,
    });
    
    // For action plans, also create an AcceptedActionPlan entry
    // Note: Action plans can exist without a report (e.g., general prep plans)
    if (artifact.artifactType === TutorArtifactType.ACTION_PLAN) {
        const normalizedPlan = normalizeCommittedActionPlan(content);
        const deadlineDate = content?.deadline ? new Date(content.deadline) : null;
        const { startDate, endDate: defaultEndDate } = buildCommittedPlanWindow(normalizedPlan.totalDays);
        const endDate = deadlineDate && !Number.isNaN(deadlineDate.getTime()) && deadlineDate.getTime() >= startDate.getTime()
            ? deadlineDate
            : defaultEndDate;
        const timespan =
            normalizedPlan.totalDays <= 7 ? "1_week" : normalizedPlan.totalDays <= 14 ? "2_weeks" : "monthly";

        // First, expire all other active plans for this user to ensure only one active plan exists
        await prisma.acceptedActionPlan.updateMany({
            where: {
                userId,
                endDate: { gte: new Date() },  // Currently active plans
                artifactId: { not: artifact.id },  // Except this one
            },
            data: {
                endDate: new Date(Date.now() - 1000),  // Set to past (expired)
            },
        });
        
        const existingPlan = await prisma.acceptedActionPlan.findFirst({
            where: { userId, artifactId: artifact.id },
            orderBy: { acceptedAt: "desc" },
            select: {
                id: true,
                startDate: true,
                endDate: true,
                totalDays: true,
                currentDay: true,
                completedDays: true,
                completedQuestions: true,
                actionPlan: true,
            },
        });

        if (!existingPlan) {
            const created = await prisma.acceptedActionPlan.create({
                data: {
                    userId,
                    artifactId: artifact.id,
                    reportId: resolvedReport?.id || null,
                    sessionId: resolvedReport?.sessionId || null,
                    timespan,
                    label: updated.title,
                    startDate,
                    endDate,
                    totalDays: normalizedPlan.totalDays,
                    actionPlan: normalizedPlan.actionPlan,
                    currentDay: 1,
                    completedDays: [],
                    completedQuestions: [],
                },
            });
            resourceId = created.id;
        } else {
            resourceId = existingPlan.id;
            const existingIsActive = existingPlan.endDate.getTime() >= Date.now();
            const existingNeedsRepair =
                typeof existingPlan.totalDays !== "number" ||
                existingPlan.totalDays <= 0 ||
                sanitizeCommittedPlannedDays((existingPlan.actionPlan as any)?.plannedDays).length === 0;

            if (existingNeedsRepair || !existingIsActive) {
                await prisma.acceptedActionPlan.update({
                    where: { id: existingPlan.id },
                    data: existingIsActive
                        ? {
                            totalDays: existingPlan.totalDays || normalizedPlan.totalDays,
                            actionPlan: {
                                ...(typeof existingPlan.actionPlan === "object" && existingPlan.actionPlan ? existingPlan.actionPlan as object : {}),
                                plannedDays: normalizedPlan.actionPlan.plannedDays,
                            },
                        }
                        : {
                            artifactId: artifact.id,
                            reportId: resolvedReport?.id || null,
                            sessionId: resolvedReport?.sessionId || null,
                            timespan,
                            label: updated.title,
                            startDate,
                            endDate,
                            totalDays: normalizedPlan.totalDays,
                            actionPlan: normalizedPlan.actionPlan,
                            acceptedAt: new Date(),
                            currentDay: 1,
                            completedDays: [],
                            completedQuestions: [],
                            lastAccessedAt: null,
                        },
                });
            }
        }
    }

    // For question sheets, create a QuestionSheet row so it shows up in My Sheets.
    if (artifact.artifactType === TutorArtifactType.QUESTION_SHEET) {
        console.log("[handleCommitArtifact] Processing QUESTION_SHEET artifact:", {
            artifactId: artifact.id,
            title: updated.title,
            hasResolvedReport: !!resolvedReport,
            reportId: resolvedReport?.id,
        });

        // Check if a sheet already exists for this specific artifact (by title + recent timestamp)
        const existingSheetByArtifact = await prisma.questionSheet.findFirst({
            where: { 
                userId,
                label: updated.title,
                generatedAt: { gte: new Date(Date.now() - 60000) } // Within last minute
            },
            select: { id: true },
        });

        console.log("[handleCommitArtifact] Existing sheet check:", {
            existingSheetByArtifact: !!existingSheetByArtifact,
        });

        if (existingSheetByArtifact) {
            resourceId = existingSheetByArtifact.id;
        }

        if (!existingSheetByArtifact) {
            const rawQuestions = Array.isArray(content?.questions) ? content.questions : [];
            console.log("[handleCommitArtifact] Creating QuestionSheet with", rawQuestions.length, "questions");

            const normalizedQuestions = rawQuestions.map((q: any, idx: number) => {
                const title = String(q?.title || q?.question || q?.prompt || "Question");
                const difficultyRaw = String(q?.difficulty || "medium").toLowerCase();
                const difficulty = ["easy", "medium", "hard"].includes(difficultyRaw) ? difficultyRaw : "medium";
                const topic = Array.isArray(q?.topics) && q.topics.length > 0 ? q.topics[0] : "coding";
                const category = String(q?.category || topic).toLowerCase().replace(/\s+/g, "_");
                const rawId = String(q?.id || q?.slug || `q-${idx + 1}`);
                const id = /^(cs|dsa|sql|sd|beh)-/i.test(rawId)
                    ? rawId
                    : `${sheetQuestionPrefix(category)}-${rawId}`;
                const whatWeAreLookingFor = String(q?.rationale || "Explain your approach, complexity, and edge cases.");

                return {
                    id,
                    question: title,
                    whatWeAreLookingFor,
                    category,
                    difficulty,
                };
            });

            const progress: Record<string, any> = {};
            normalizedQuestions.forEach((q: any) => {
                progress[q.id] = {
                    status: "unattempted",
                    attempts: 0,
                    lastAnswer: null,
                    feedback: null,
                };
            });

            let fallbackLabel = updated.title;
            if (resolvedReport) {
                const dateStr = resolvedReport.generatedAt.toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    timeZone: "UTC",
                });
                fallbackLabel = `${resolvedReport.session.type.replace(/_/g, " ")} · ${dateStr} · ${resolvedReport.session.level}`;
            }

            try {
                const createdSheet = await prisma.questionSheet.create({
                    data: {
                        userId,
                        reportId: resolvedReport?.id || null,
                        sessionId: resolvedReport?.sessionId || null,
                        label: updated.title || fallbackLabel,
                        questions: normalizedQuestions,
                        progress,
                    },
                });
                resourceId = createdSheet.id;
                console.log("[handleCommitArtifact] Successfully created QuestionSheet:", createdSheet.id);
            } catch (error) {
                console.error("[handleCommitArtifact] Failed to create QuestionSheet:", error);
                throw error;
            }
        } else {
            console.log("[handleCommitArtifact] Skipping QuestionSheet creation - already exists");
        }
    }
    
    const summary =
        artifact.artifactType === TutorArtifactType.QUESTION_SHEET
            ? { questionCount: Array.isArray(content?.questions) ? content.questions.length : 0 }
            : artifact.artifactType === TutorArtifactType.ACTION_PLAN
                ? {
                      dayCount: Array.isArray(content?.days) ? content.days.length : 0,
                      totalQuestions: content?.planSummary?.totalQuestions || 0,
                      totalHours: typeof content?.totalHours === "number" ? content.totalHours : null,
                  }
                : { itemCount: Array.isArray(content?.items) ? content.items.length : 0 };

    console.log("[handleCommitArtifact] COMPLETE - Returning result:", {
        artifactId: updated.id,
        type: updated.artifactType,
        title: updated.title,
        summary,
    });

    // Finalize the artifact meta to include the resourceId for future reference/reloads
    await prisma.tutorArtifact.update({
        where: { id: artifact.id },
        data: {
            meta: { 
                ...meta, 
                [DRAFT_META_KEY]: false, 
                committedAt: new Date().toISOString(),
                resourceId 
            },
        },
    });

    return {
        artifactId: updated.id,
        resourceId,
        type: updated.artifactType.toLowerCase(),
        title: updated.title,
        committed: true,
        committedAt: updated.updatedAt.toISOString(),
        summary,
    };
}

// ─────────────────────────────────────────────────────────────────
// request_clarification
// Returns a "pending" shape that loop.ts converts into an SSE event.
// ─────────────────────────────────────────────────────────────────

export function handleRequestClarification(
    _userId: string,
    args: z.infer<typeof requestClarificationArgs>
) {
    return {
        pending: true,
        // Sentinel field the loop checks for to emit `clarification_requested`.
        __clarification: {
            context: args.context,
            slots: args.slots,
        },
        slotIds: args.slots.map((s) => s.id),
        instruction:
            "After this tool returns, briefly acknowledge to the user that you need their input, then end the turn. The user will reply via the clarification UI.",
    };
}
