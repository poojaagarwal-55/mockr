/**
 * Skill handlers — the agent's high-leverage actions.
 *
 *   create_question_sheet — build a personalized practice sheet by:
 *     1. Reading the user's open weak areas + profile preferences.
 *     2. Searching the question bank with weak-area topics as hints.
 *     3. Applying the requested difficulty mix and excluding seen problems.
 *     4. Writing a TutorArtifact (QUESTION_SHEET) and returning the id.
 *
 *   create_action_plan — generate a week-by-week prep plan:
 *     1. Pull weak areas, profile (target / deadline / hours), recent stats.
 *     2. Compute total available hours.
 *     3. Ask Gemini Pro for a structured weekly plan (JSON mode).
 *     4. Persist as TutorArtifact (ACTION_PLAN).
 *
 *   create_quiz — generate a 5-15 question quiz on a topic:
 *     1. Use Gemini Flash with a strict JSON schema.
 *     2. Persist as TutorArtifact (QUIZ).
 *
 * All three return {artifactId, summary, content} — the agent then
 * decides how to surface them in chat (UI consumes the id).
 */

import { TutorArtifactType, WeakAreaStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../../../lib/prisma.js";
import { getGeminiClient, GEMINI_MODEL, GEMINI_PRO_MODEL, GEMINI_THINKING_HIGH } from "../../../../lib/gemini.js";
import { ensureMongoDBConnected } from "../../../../lib/mongoose.js";
import { DSAQuestion } from "../../../../models/DSAQuestion.js";

const MAX_SHEET_QUESTIONS = 25;
const MIN_SHEET_QUESTIONS = 1;
const MAX_PLAN_WEEKS = 16;
const MAX_QUIZ_ITEMS = 15;

// ── Schemas ─────────────────────────────────────────────────────

export const createQuestionSheetArgs = z
    .object({
        title: z.string().trim().min(3).max(120).optional(),
        focusTopics: z.array(z.string().trim().min(1).max(60)).max(10).optional(),
        companies: z.array(z.string().trim().min(1).max(60)).max(5).optional(),
        difficultyMix: z
            .object({
                easy: z.coerce.number().int().min(0).max(MAX_SHEET_QUESTIONS).optional().default(0),
                medium: z.coerce.number().int().min(0).max(MAX_SHEET_QUESTIONS).optional().default(0),
                hard: z.coerce.number().int().min(0).max(MAX_SHEET_QUESTIONS).optional().default(0),
            })
            .optional(),
        totalQuestions: z.coerce
            .number()
            .int()
            .min(MIN_SHEET_QUESTIONS)
            .max(MAX_SHEET_QUESTIONS)
            .optional()
            .default(10),
        excludeSeen: z.boolean().optional().default(true),
        conversationId: z.string().trim().min(1).max(64).optional(),
    })
    .strict();

export const createActionPlanArgs = z
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
        conversationId: z.string().trim().min(1).max(64).optional(),
    })
    .strict();

export const createQuizArgs = z
    .object({
        topic: z.string().trim().min(1).max(80),
        questionCount: z.coerce.number().int().min(3).max(MAX_QUIZ_ITEMS).optional().default(8),
        difficulty: z.enum(["easy", "medium", "hard", "mixed"]).optional().default("mixed"),
        title: z.string().trim().min(3).max(120).optional(),
        conversationId: z.string().trim().min(1).max(64).optional(),
    })
    .strict();

// ─────────────────────────────────────────────────────────────────
// create_question_sheet
// ─────────────────────────────────────────────────────────────────

export async function handleCreateQuestionSheet(
    userId: string,
    args: z.infer<typeof createQuestionSheetArgs>
) {
    // 1. Pull user context.
    const [openWeakAreas, profile, seenProgress] = await Promise.all([
        prisma.userWeakArea.findMany({
            where: { userId, status: { not: WeakAreaStatus.RESOLVED } },
            orderBy: [{ severity: "asc" }, { lastSeenAt: "desc" }],
            take: 15,
            select: { topic: true, category: true, severity: true },
        }),
        prisma.userTutorProfile.findUnique({ where: { userId } }),
        args.excludeSeen
            ? prisma.userQuestionProgress.findMany({
                  where: { userId },
                  select: { questionId: true },
                  take: 500,
              })
            : Promise.resolve([]),
    ]);

    // 2. Resolve effective focus topics — explicit args win, weak areas next.
    const focusTopics =
        args.focusTopics && args.focusTopics.length > 0
            ? args.focusTopics
            : openWeakAreas.map((w) => w.topic).slice(0, 6);

    const preferredCompanies =
        args.companies && args.companies.length > 0 ? args.companies : (profile?.preferredTopics ?? []).filter((t) => /^[A-Za-z0-9_\-]+$/.test(t)).slice(0, 3);

    // 3. Resolve difficulty mix — fall back to balanced default.
    const requestedTotal = args.totalQuestions;
    const mix = normalizeDifficultyMix(args.difficultyMix, requestedTotal);

    // 4. Search the catalog. We over-fetch then filter to satisfy the mix.
    await ensureMongoDBConnected();
    const seenSlugs = new Set(seenProgress.map((p) => p.questionId).filter(Boolean));

    const sheet = await pickQuestionsForSheet({
        focusTopics,
        companies: preferredCompanies,
        excludeSlugs: seenSlugs,
        mix,
        totalQuestions: requestedTotal,
    });

    if (sheet.length < MIN_SHEET_QUESTIONS) {
        throw Object.assign(new Error("not_enough_matching_questions"), { code: "INSUFFICIENT_CATALOG_MATCH" });
    }

    // 5. Persist as a TutorArtifact.
    const title =
        args.title ??
        buildSheetTitle(focusTopics, preferredCompanies);

    const content = {
        questions: sheet,
        focusTopics,
        companies: preferredCompanies,
        difficultyMix: mix,
        excludeSeen: args.excludeSeen,
        estimatedHours: Math.round(sheet.length * 0.75 * 10) / 10,
    };

    const artifact = await prisma.tutorArtifact.create({
        data: {
            userId,
            conversationId: args.conversationId ?? null,
            artifactType: TutorArtifactType.QUESTION_SHEET,
            title,
            content,
            meta: {
                derivedFromOpenWeakAreaCount: openWeakAreas.length,
                generatorVersion: 1,
            },
        },
        select: { id: true, title: true, createdAt: true },
    });

    return {
        artifactId: artifact.id,
        type: "question_sheet",
        title: artifact.title,
        questionCount: sheet.length,
        focusTopics,
        difficultyMix: mix,
        estimatedHours: content.estimatedHours,
        createdAt: artifact.createdAt.toISOString(),
        // Return the questions inline so the agent can summarize them in its reply.
        questions: sheet,
    };
}

function normalizeDifficultyMix(
    raw: z.infer<typeof createQuestionSheetArgs>["difficultyMix"],
    total: number
): { easy: number; medium: number; hard: number } {
    const e = raw?.easy ?? 0;
    const m = raw?.medium ?? 0;
    const h = raw?.hard ?? 0;
    const sum = e + m + h;
    if (sum === total && total > 0) return { easy: e, medium: m, hard: h };
    if (total === 1) return { easy: 0, medium: 1, hard: 0 };
    if (total === 2) return { easy: 1, medium: 1, hard: 0 };

    // Fallback balanced mix favoring medium.
    const easy = Math.max(1, Math.round(total * 0.3));
    const hard = Math.max(1, Math.round(total * 0.2));
    const medium = Math.max(1, total - easy - hard);
    return { easy, medium, hard };
}

async function pickQuestionsForSheet(input: {
    focusTopics: string[];
    companies: string[];
    excludeSlugs: Set<string>;
    mix: { easy: number; medium: number; hard: number };
    totalQuestions: number;
}): Promise<
    Array<{
        id: string;
        slug: string | null;
        title: string;
        difficulty: string;
        topics: string[];
        focusMatch: string[];
    }>
> {
    const buildFilter = (difficulty: "Easy" | "Medium" | "Hard") => {
        const filter: any = { difficulty };
        if (input.focusTopics.length) {
            filter.topics = { $in: input.focusTopics.map((t) => new RegExp(escapeRegex(t), "i")) };
        }
        if (input.companies.length) {
            filter.companyTags = {
                $in: input.companies.map((c) => new RegExp(`^${escapeRegex(c)}$`, "i")),
            };
        }
        return filter;
    };

    const fetchBucket = async (difficulty: "Easy" | "Medium" | "Hard", target: number) => {
        if (target === 0) return [];
        // Over-fetch 3x to allow for excludes + variety.
        const docs = await DSAQuestion.aggregate([
            { $match: buildFilter(difficulty) },
            { $sample: { size: target * 3 } },
        ]);
        // Backstop: if topic+company filter starves us, relax to difficulty only.
        const enough =
            docs.length >= target ? docs : await DSAQuestion.aggregate([
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

    const pickFromBucket = (docs: any[], target: number, used: Set<string>) => {
        const out: any[] = [];
        for (const d of docs) {
            if (out.length >= target) break;
            const slug = d?.problemSlug as string | undefined;
            const id = String(d?._id ?? "");
            if (!id) continue;
            if (used.has(id)) continue;
            if (slug && input.excludeSlugs.has(slug)) continue;
            used.add(id);
            out.push(d);
        }
        return out;
    };

    const used = new Set<string>();
    const picks = [
        ...pickFromBucket(easyDocs, input.mix.easy, used),
        ...pickFromBucket(mediumDocs, input.mix.medium, used),
        ...pickFromBucket(hardDocs, input.mix.hard, used),
    ];

    return picks.slice(0, input.totalQuestions).map((d: any) => {
        const topics: string[] = Array.isArray(d.topics) ? d.topics : [];
        const focusMatch = topics.filter((t) =>
            input.focusTopics.some((ft) => t.toLowerCase().includes(ft.toLowerCase()))
        );
        return {
            id: String(d._id),
            slug: d.problemSlug ?? null,
            title: String(d.title ?? "Untitled"),
            difficulty: String(d.difficulty ?? "Medium").toLowerCase(),
            topics,
            focusMatch,
        };
    });
}

function buildSheetTitle(focusTopics: string[], companies: string[]): string {
    const focus = focusTopics.slice(0, 2).map(prettyTopic).join(" + ");
    const company = companies[0] ? ` for ${prettyTopic(companies[0])}` : "";
    if (!focus) return `Personalized Practice Sheet${company}`;
    return `${focus} Practice${company}`;
}

function prettyTopic(t: string): string {
    return t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─────────────────────────────────────────────────────────────────
// create_action_plan
// ─────────────────────────────────────────────────────────────────

export async function handleCreateActionPlan(userId: string, args: z.infer<typeof createActionPlanArgs>) {
    const [profile, weakAreas, recentReports] = await Promise.all([
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
            select: { overallScore: true, rubricScores: true, generatedAt: true, session: { select: { type: true } } },
        }),
    ]);

    // Resolve target/deadline/hours: arg > profile > defaults.
    const targetCompany = args.targetCompany ?? profile?.targetCompany ?? null;
    const targetLevel = args.targetLevel ?? profile?.targetLevel ?? null;
    const hoursPerWeek = args.hoursPerWeek ?? profile?.hoursPerWeek ?? 8;

    const deadlineDate = args.deadline
        ? new Date(args.deadline)
        : profile?.targetDate ?? defaultDeadline(8);

    const today = new Date();
    const weeksUntilDeadline = Math.max(
        1,
        Math.min(
            MAX_PLAN_WEEKS,
            Math.ceil((deadlineDate.getTime() - today.getTime()) / (7 * 24 * 60 * 60 * 1000))
        )
    );
    const totalHours = weeksUntilDeadline * hoursPerWeek;

    const priorityTopics =
        args.priorityWeakAreaTopics && args.priorityWeakAreaTopics.length > 0
            ? args.priorityWeakAreaTopics
            : weakAreas.slice(0, 6).map((w) => w.topic);

    // ── Ask Gemini Pro for the structured plan ──
    const systemInstruction = `You produce realistic, week-by-week interview-prep action plans.
Return JSON ONLY with shape:
{
  "summary": "...",                          // 2-sentence overview
  "priorityFocus": "...",                    // single sentence top focus
  "weeks": [
    {
      "weekNumber": 1,
      "title": "...",
      "goals": ["..."],                      // 2-4 concrete goals
      "topics": ["..."],                     // 2-5 topics studied
      "estimatedHours": <int>,
      "milestone": "..."                     // measurable check at end of week
    }
  ]
}

Rules:
- Output exactly ${weeksUntilDeadline} weeks.
- Total estimatedHours across weeks must equal ${totalHours}.
- Order weeks by priority — weakest areas first, then synthesis / mocks last.
- Topics use lowercase snake_case keys.
- Be specific; avoid filler like "review concepts".`;

    const userPrompt = JSON.stringify({
        targetCompany,
        targetLevel,
        weeksUntilDeadline,
        hoursPerWeek,
        totalHours,
        priorityTopics,
        weakAreas: weakAreas.map((w) => ({
            topic: w.topic,
            category: w.category,
            severity: w.severity.toLowerCase(),
            occurrences: w.occurrences,
        })),
        recentReports: recentReports.map((r) => ({
            type: r.session.type,
            overallScore: Math.round(Number(r.overallScore) || 0),
            generatedAt: r.generatedAt.toISOString(),
        })),
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
        throw Object.assign(new Error(`plan_generation_failed:${err?.message ?? "unknown"}`), {
            code: "GENERATION_FAILED",
        });
    }

    const weeks = sanitizeWeeks(parsed.weeks, weeksUntilDeadline, hoursPerWeek);
    if (weeks.length === 0) {
        throw Object.assign(new Error("plan_generation_returned_empty"), { code: "GENERATION_EMPTY" });
    }

    const title =
        args.title ??
        `${targetCompany ? `${targetCompany} ` : ""}Prep Plan — ${weeksUntilDeadline} week${weeksUntilDeadline > 1 ? "s" : ""}`;

    const content = {
        summary: typeof parsed.summary === "string" ? parsed.summary.slice(0, 600) : null,
        priorityFocus: typeof parsed.priorityFocus === "string" ? parsed.priorityFocus.slice(0, 240) : null,
        targetCompany,
        targetLevel,
        deadline: deadlineDate.toISOString(),
        hoursPerWeek,
        totalHours,
        weeksUntilDeadline,
        weeks,
    };

    const artifact = await prisma.tutorArtifact.create({
        data: {
            userId,
            conversationId: args.conversationId ?? null,
            artifactType: TutorArtifactType.ACTION_PLAN,
            title,
            content,
            meta: {
                weakAreaCount: weakAreas.length,
                generatorVersion: 1,
            },
        },
        select: { id: true, title: true, createdAt: true },
    });

    return {
        artifactId: artifact.id,
        type: "action_plan",
        title: artifact.title,
        weeksUntilDeadline,
        totalHours,
        priorityTopics,
        weeks,
        summary: content.summary,
        createdAt: artifact.createdAt.toISOString(),
    };
}

function defaultDeadline(weeksFromNow: number): Date {
    return new Date(Date.now() + weeksFromNow * 7 * 24 * 60 * 60 * 1000);
}

function sanitizeWeeks(
    raw: unknown,
    expectedCount: number,
    hoursPerWeek: number
): Array<{
    weekNumber: number;
    title: string;
    goals: string[];
    topics: string[];
    estimatedHours: number;
    milestone: string | null;
}> {
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
        }))
        .filter((w) => w.title.length > 0);
}

// ─────────────────────────────────────────────────────────────────
// create_quiz
// ─────────────────────────────────────────────────────────────────

export async function handleCreateQuiz(userId: string, args: z.infer<typeof createQuizArgs>) {
    const systemInstruction = `You produce a focused interview-prep quiz.
Return JSON ONLY with shape:
{
  "summary": "1-sentence what this quiz tests",
  "items": [
    {
      "id": "<short-stable-id>",
      "format": "mcq" | "short_answer",
      "prompt": "...",
      "choices": ["..."],          // only for mcq, 4 options exactly
      "correctIndex": <int>,       // only for mcq
      "expectedAnswer": "...",     // only for short_answer (1-2 sentences)
      "explanation": "...",        // why the correct answer is correct, 1-2 sentences
      "difficulty": "easy" | "medium" | "hard"
    }
  ]
}

Rules:
- Output exactly ${args.questionCount} items.
- Mix formats: roughly 70% mcq, 30% short_answer (unless count is small).
- Each item must test understanding, not trivia.
- Keep prompts under 280 chars; explanations under 300 chars.
- Difficulty target: ${args.difficulty}.`;

    const userPrompt = JSON.stringify({ topic: args.topic, count: args.questionCount });

    let parsed: any;
    try {
        const result = await getGeminiClient().models.generateContent({
            model: GEMINI_MODEL,
            contents: userPrompt,
            config: {
                systemInstruction,
                responseMimeType: "application/json",
            },
        });
        parsed = parseJsonObject(result.text ?? "");
    } catch (err: any) {
        throw Object.assign(new Error(`quiz_generation_failed:${err?.message ?? "unknown"}`), {
            code: "GENERATION_FAILED",
        });
    }

    const items = sanitizeQuizItems(parsed.items, args.questionCount);
    if (items.length === 0) {
        throw Object.assign(new Error("quiz_generation_returned_empty"), { code: "GENERATION_EMPTY" });
    }

    const title = args.title ?? `${prettyTopic(args.topic)} Quiz`;

    const content = {
        summary: typeof parsed.summary === "string" ? parsed.summary.slice(0, 300) : null,
        topic: args.topic,
        difficulty: args.difficulty,
        items,
    };

    const artifact = await prisma.tutorArtifact.create({
        data: {
            userId,
            conversationId: args.conversationId ?? null,
            artifactType: TutorArtifactType.QUIZ,
            title,
            content,
            meta: { generatorVersion: 1 },
        },
        select: { id: true, title: true, createdAt: true },
    });

    return {
        artifactId: artifact.id,
        type: "quiz",
        title: artifact.title,
        topic: args.topic,
        difficulty: args.difficulty,
        itemCount: items.length,
        items,
        summary: content.summary,
        createdAt: artifact.createdAt.toISOString(),
    };
}

function sanitizeQuizItems(raw: unknown, expected: number) {
    if (!Array.isArray(raw)) return [];
    return raw
        .slice(0, expected)
        .map((item: any, idx) => {
            const format = item?.format === "short_answer" ? "short_answer" : "mcq";
            const base = {
                id: typeof item?.id === "string" ? item.id.slice(0, 32) : `q_${idx + 1}`,
                format,
                prompt: typeof item?.prompt === "string" ? item.prompt.slice(0, 400) : "",
                explanation: typeof item?.explanation === "string" ? item.explanation.slice(0, 400) : "",
                difficulty: ["easy", "medium", "hard"].includes(item?.difficulty) ? item.difficulty : "medium",
            };
            if (!base.prompt) return null;

            if (format === "mcq") {
                const choices = Array.isArray(item?.choices)
                    ? (item.choices as unknown[])
                          .map((c) => String(c).slice(0, 240))
                          .slice(0, 4)
                    : [];
                if (choices.length < 2) return null;
                const correctIndex =
                    typeof item?.correctIndex === "number" && item.correctIndex >= 0 && item.correctIndex < choices.length
                        ? item.correctIndex
                        : 0;
                return { ...base, choices, correctIndex };
            }

            return {
                ...base,
                expectedAnswer: typeof item?.expectedAnswer === "string" ? item.expectedAnswer.slice(0, 400) : "",
            };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
}

// ─────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────

function parseJsonObject(raw: string): any {
    const cleaned = raw.replace(/^﻿/, "").trim();
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");
    if (first < 0 || last < 0 || last <= first) {
        throw new Error("model_returned_no_json");
    }
    return JSON.parse(cleaned.slice(first, last + 1));
}
