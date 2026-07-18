/**
 * Post-session pipeline.
 *
 * Runs once after an EvaluationReport is created. Extracts structured
 * weak areas + concrete mistakes from the report and persists them so the
 * agentic tutor has a real knowledge base to draw on instead of re-deriving
 * everything from raw markdown each conversation.
 *
 * Designed to fail soft: any individual extraction error is logged and
 * swallowed so report delivery is never blocked.
 */

import {
    MistakeType,
    Prisma,
    WeakAreaSeverity,
    WeakAreaStatus,
} from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { GEMINI_MODEL, getGeminiClient } from "../../lib/gemini.js";
import { cacheDelPattern } from "../../lib/redis.js";
import { buildEffectiveInterviewConfig, inferQuestionModule } from "../../routes/tutor/module-context.js";

// ─────────── Constants ───────────

const MAX_QUESTIONS_FOR_LLM = 8;
const MAX_CODE_LINES = 30; // privacy / token budget — never feed long code to LLM or store it
const MAX_SNIPPET_LINES = 20;
const MAX_WEAK_AREAS_PER_REPORT = 12;
const MAX_MISTAKES_PER_REPORT = 16;
const TUTOR_STATS_CACHE_PREFIX = "tutor_stats:";

// ─────────── Types ───────────

type RawWeakArea = {
    category?: unknown;
    subcategory?: unknown;
    topic?: unknown;
    severity?: unknown;
    evidence?: unknown;
};

type RawMistake = {
    question_ref?: unknown;
    question_title?: unknown;
    mistake_type?: unknown;
    description?: unknown;
    user_snippet?: unknown;
    correct_approach?: unknown;
    topic_tags?: unknown;
};

type ReportQuestionLite = {
    id?: string | null;
    questionId?: string | null;
    title?: string | null;
    category?: string | null;
    difficulty?: string | null;
    score?: number | null;
    aiNotes?: string | null;
    finalCode?: string | null;
    codeLanguage?: string | null;
};

type PipelineResult = {
    reportId: string;
    weakAreasUpserted: number;
    mistakesInserted: number;
    cacheCleared: boolean;
    errors: string[];
};

// ─────────── Public entrypoint ───────────

export async function runPostSessionPipeline(reportId: string): Promise<PipelineResult> {
    const result: PipelineResult = {
        reportId,
        weakAreasUpserted: 0,
        mistakesInserted: 0,
        cacheCleared: false,
        errors: [],
    };

    const report = await prisma.evaluationReport.findUnique({
        where: { id: reportId },
        select: {
            id: true,
            userId: true,
            sessionId: true,
            overallScore: true,
            rubricScores: true,
            sectionFeedback: true,
            improvements: true,
            questions: true,
            session: { select: { type: true, role: true, level: true, moduleConfig: true } },
        },
    });

    if (!report) {
        result.errors.push("report_not_found");
        return result;
    }

    const userId = report.userId;
    const reportContext = buildReportContext(report);

    // Run all three side-effects in parallel; isolate failures.
    const [weakRes, mistakeRes, cacheRes] = await Promise.allSettled([
        extractAndUpsertWeakAreas(userId, report.id, reportContext),
        extractAndInsertMistakes(userId, report.id, reportContext),
        invalidateTutorCaches(userId),
    ]);

    if (weakRes.status === "fulfilled") result.weakAreasUpserted = weakRes.value;
    else result.errors.push(`weak_areas:${weakRes.reason?.message ?? "unknown"}`);

    if (mistakeRes.status === "fulfilled") result.mistakesInserted = mistakeRes.value;
    else result.errors.push(`mistakes:${mistakeRes.reason?.message ?? "unknown"}`);

    if (cacheRes.status === "fulfilled") result.cacheCleared = cacheRes.value;
    else result.errors.push(`cache:${cacheRes.reason?.message ?? "unknown"}`);

    return result;
}

// ─────────── Report → LLM context ───────────

function buildReportContext(report: {
    overallScore: Prisma.Decimal;
    rubricScores: Prisma.JsonValue;
    sectionFeedback: Prisma.JsonValue;
    improvements: Prisma.JsonValue;
    questions: Prisma.JsonValue;
    session: { type: string; role: string; level: string; moduleConfig: Prisma.JsonValue | null } | null;
}) {
    const rawQuestions = Array.isArray(report.questions) ? (report.questions as ReportQuestionLite[]) : [];
    const representativeQuestions = selectRepresentativeQuestions(rawQuestions);

    // Trim each question down to what the extractor needs. Strip large code blocks.
    const trimmedQuestions = representativeQuestions.map((q) => ({
        ref: q.id || q.questionId || null,
        title: typeof q.title === "string" ? q.title.slice(0, 200) : "Unknown Question",
        category: typeof q.category === "string" ? q.category : "unknown",
        module: inferQuestionModule(q.category),
        difficulty: typeof q.difficulty === "string" ? q.difficulty : null,
        score: typeof q.score === "number" ? q.score : null,
        aiNotes: typeof q.aiNotes === "string" ? truncateText(q.aiNotes, 1200) : null,
        codeExcerpt: stripCodeForLLM(q.finalCode),
        codeLanguage: q.codeLanguage ?? null,
    }));

    return {
        sessionType: report.session?.type ?? "unknown",
        role: report.session?.role ?? "unknown",
        level: report.session?.level ?? "unknown",
        effectiveInterviewConfig: buildEffectiveInterviewConfig(
            report.session?.type ?? "unknown",
            report.session?.moduleConfig ?? null
        ),
        overallScore: Number(report.overallScore),
        rubricScores: report.rubricScores,
        sectionFeedback: report.sectionFeedback,
        improvements: report.improvements,
        questions: trimmedQuestions,
    };
}

function selectRepresentativeQuestions(questions: ReportQuestionLite[]): ReportQuestionLite[] {
    if (questions.length <= MAX_QUESTIONS_FOR_LLM) return questions;
    const byModule = new Map<string, ReportQuestionLite[]>();
    for (const question of questions) {
        const module = inferQuestionModule(question.category);
        const bucket = byModule.get(module) || [];
        bucket.push(question);
        byModule.set(module, bucket);
    }

    const selected: ReportQuestionLite[] = [];
    for (const bucket of byModule.values()) {
        selected.push(...bucket.slice(0, 2));
        if (selected.length >= MAX_QUESTIONS_FOR_LLM) return selected.slice(0, MAX_QUESTIONS_FOR_LLM);
    }

    for (const question of questions) {
        if (selected.includes(question)) continue;
        selected.push(question);
        if (selected.length >= MAX_QUESTIONS_FOR_LLM) break;
    }
    return selected;
}

function stripCodeForLLM(code: string | null | undefined): string | null {
    if (!code || typeof code !== "string") return null;
    const lines = code.split("\n");
    if (lines.length <= MAX_CODE_LINES) return code;
    const head = lines.slice(0, Math.floor(MAX_CODE_LINES / 2));
    const tail = lines.slice(-Math.floor(MAX_CODE_LINES / 2));
    return [...head, `// … ${lines.length - MAX_CODE_LINES} lines elided …`, ...tail].join("\n");
}

function truncateText(value: string, max: number): string {
    if (value.length <= max) return value;
    return value.slice(0, max).replace(/\s+\S*$/, "") + "…";
}

// ─────────── Weak-area extraction ───────────

async function extractAndUpsertWeakAreas(
    userId: string,
    reportId: string,
    ctx: ReturnType<typeof buildReportContext>
): Promise<number> {
    const systemInstruction = `You extract structured weak areas from an interview report.
Return a JSON object with a single field "weakAreas" — an array.
Each item: { category, subcategory, topic, severity, evidence }.

Rules:
- "category" must be the most specific applicable taxonomy key:
  cs_os, cs_cn, cs_dbms, cs_oops, sql,
  dsa_arrays, dsa_strings, dsa_graphs, dsa_dp, dsa_binary_search, dsa_trees, dsa_hashing, dsa_general,
  system_design, behavioral, communication,
  genai_rag, genai_prompting, genai_evaluation, genai_model_selection, genai_mlops, genai_coding, genai_system_design,
  ds_statistics, ds_machine_learning, ds_deep_learning, ds_sql, ds_coding, ds_business_metrics,
  pm_product_case, pm_metrics, pm_strategy, pm_behavioral,
  problem_solving_case, complexity_analysis, debugging, language_specific, other
- "topic" is a short canonical key, lowercase snake_case. Prefix ambiguous topics with the domain when useful, e.g. cs_os_processes, genai_rag_chunking, ds_statistics_hypothesis_testing, pm_metrics_north_star.
- "severity" is exactly one of: critical, moderate, minor
- "evidence" is a single specific sentence quoting or summarizing the report's signal — never generic
- Return at most ${MAX_WEAK_AREAS_PER_REPORT} items, ordered by severity (critical first)
- Do NOT invent weaknesses for sections the report didn't critique
- Only flag genuine gaps, not nitpicks`;

    const userPrompt = JSON.stringify({
        sessionType: ctx.sessionType,
        role: ctx.role,
        level: ctx.level,
        effectiveInterviewConfig: ctx.effectiveInterviewConfig,
        overallScore: ctx.overallScore,
        rubricScores: ctx.rubricScores,
        sectionFeedback: ctx.sectionFeedback,
        improvements: ctx.improvements,
        questions: ctx.questions.map((q) => ({
            title: q.title,
            category: q.category,
            module: q.module,
            score: q.score,
            aiNotes: q.aiNotes,
        })),
    });

    let parsed: { weakAreas?: RawWeakArea[] };
    try {
        const result = await getGeminiClient().models.generateContent({
            model: GEMINI_MODEL,
            contents: userPrompt,
            config: {
                systemInstruction,
                responseMimeType: "application/json",
            },
        });
        parsed = safeParseJsonObject<{ weakAreas?: RawWeakArea[] }>(result.text ?? "");
    } catch (err: any) {
        throw new Error(`extraction_failed:${err?.message ?? "unknown"}`);
    }

    const items = Array.isArray(parsed.weakAreas) ? parsed.weakAreas : [];
    if (items.length === 0) return 0;

    let upserted = 0;
    const now = new Date();

    for (const raw of items.slice(0, MAX_WEAK_AREAS_PER_REPORT)) {
        const normalized = normalizeWeakArea(raw);
        if (!normalized) continue;

        try {
            const existing = await prisma.userWeakArea.findUnique({
                where: { userId_topic: { userId, topic: normalized.topic } },
                select: { id: true, occurrences: true, status: true },
            });

            if (existing) {
                // Already known: bump occurrences, refresh evidence + lastSeenAt.
                // Reopen if it was previously resolved.
                await prisma.userWeakArea.update({
                    where: { id: existing.id },
                    data: {
                        occurrences: existing.occurrences + 1,
                        lastSeenAt: now,
                        evidence: normalized.evidence,
                        severity: normalized.severity,
                        category: normalized.category,
                        subcategory: normalized.subcategory,
                        reportId,
                        status: existing.status === WeakAreaStatus.RESOLVED ? WeakAreaStatus.OPEN : existing.status,
                        resolvedAt: existing.status === WeakAreaStatus.RESOLVED ? null : undefined,
                    },
                });
            } else {
                await prisma.userWeakArea.create({
                    data: {
                        userId,
                        reportId,
                        category: normalized.category,
                        subcategory: normalized.subcategory,
                        topic: normalized.topic,
                        severity: normalized.severity,
                        evidence: normalized.evidence,
                    },
                });
            }
            upserted++;
        } catch (err: any) {
            console.error(`[PostSessionPipeline] weak-area upsert failed`, {
                userId: maskUserId(userId),
                reportId,
                topic: normalized.topic,
                error: err?.message,
            });
        }
    }

    return upserted;
}

function normalizeWeakArea(raw: RawWeakArea): {
    category: string;
    subcategory: string | null;
    topic: string;
    severity: WeakAreaSeverity;
    evidence: string;
} | null {
    const topic = canonicalizeKey(raw.topic);
    if (!topic) return null;

    const evidence = typeof raw.evidence === "string" ? raw.evidence.trim().slice(0, 600) : "";
    if (!evidence) return null;

    const category = typeof raw.category === "string" && raw.category.trim() ? raw.category.trim().toLowerCase() : "other";
    const subcategory = typeof raw.subcategory === "string" && raw.subcategory.trim() ? raw.subcategory.trim().toLowerCase() : null;

    const severityRaw = typeof raw.severity === "string" ? raw.severity.trim().toUpperCase() : "MODERATE";
    const severity: WeakAreaSeverity =
        severityRaw === "CRITICAL" ? WeakAreaSeverity.CRITICAL :
        severityRaw === "MINOR" ? WeakAreaSeverity.MINOR :
        WeakAreaSeverity.MODERATE;

    return { category, subcategory, topic, severity, evidence };
}

function canonicalizeKey(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const cleaned = value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 80);
    return cleaned || null;
}

// ─────────── Mistake extraction ───────────

const MISTAKE_TYPES_LOWER: Record<string, MistakeType> = {
    wrong_approach: MistakeType.WRONG_APPROACH,
    edge_case_missed: MistakeType.EDGE_CASE_MISSED,
    complexity_error: MistakeType.COMPLEXITY_ERROR,
    syntax_error: MistakeType.SYNTAX_ERROR,
    conceptual_gap: MistakeType.CONCEPTUAL_GAP,
    communication: MistakeType.COMMUNICATION,
};

async function extractAndInsertMistakes(
    userId: string,
    reportId: string,
    ctx: ReturnType<typeof buildReportContext>
): Promise<number> {
    if (ctx.questions.length === 0) return 0;

    const systemInstruction = `You extract specific, actionable mistakes a candidate made during this interview.
Return a JSON object with a single field "mistakes" — an array.
Each item: { question_ref, question_title, mistake_type, description, user_snippet, correct_approach, topic_tags }.

Rules:
- "mistake_type" is one of: wrong_approach, edge_case_missed, complexity_error, syntax_error, conceptual_gap, communication
- "question_ref" must be the "ref" value from the input questions (or null if cross-question)
- "description" is one specific sentence — what went wrong, not a generic critique
- "user_snippet" is OPTIONAL: a short (<=10 lines) excerpt from the candidate's code that illustrates the mistake. Omit if not applicable.
- "correct_approach" is one sentence on what they should have done
- "topic_tags" are 1-4 short snake_case tags (e.g. ["dynamic_programming","memoization"])
- Return at most ${MAX_MISTAKES_PER_REPORT} items
- Skip strengths and neutral observations — only real mistakes`;

    const userPrompt = JSON.stringify({
        sessionType: ctx.sessionType,
        role: ctx.role,
        level: ctx.level,
        effectiveInterviewConfig: ctx.effectiveInterviewConfig,
        questions: ctx.questions,
    });

    let parsed: { mistakes?: RawMistake[] };
    try {
        const result = await getGeminiClient().models.generateContent({
            model: GEMINI_MODEL,
            contents: userPrompt,
            config: {
                systemInstruction,
                responseMimeType: "application/json",
            },
        });
        parsed = safeParseJsonObject<{ mistakes?: RawMistake[] }>(result.text ?? "");
    } catch (err: any) {
        throw new Error(`extraction_failed:${err?.message ?? "unknown"}`);
    }

    const items = Array.isArray(parsed.mistakes) ? parsed.mistakes : [];
    if (items.length === 0) return 0;

    const validRefs = new Set(ctx.questions.map((q) => q.ref).filter((r): r is string => !!r));

    const rows = items
        .slice(0, MAX_MISTAKES_PER_REPORT)
        .map((raw) => normalizeMistake(raw, validRefs))
        .filter((row): row is NonNullable<ReturnType<typeof normalizeMistake>> => row !== null)
        .map((row) => ({ ...row, userId, reportId }));

    if (rows.length === 0) return 0;

    // Replace any prior mistakes for this report (idempotency for retries / backfill).
    await prisma.$transaction([
        prisma.userMistake.deleteMany({ where: { userId, reportId } }),
        prisma.userMistake.createMany({ data: rows }),
    ]);

    return rows.length;
}

function normalizeMistake(raw: RawMistake, validRefs: Set<string>) {
    const description = typeof raw.description === "string" ? raw.description.trim().slice(0, 500) : "";
    if (!description) return null;

    const typeKey = typeof raw.mistake_type === "string" ? raw.mistake_type.trim().toLowerCase() : "";
    const mistakeType = MISTAKE_TYPES_LOWER[typeKey] ?? MistakeType.OTHER;

    const refRaw = typeof raw.question_ref === "string" ? raw.question_ref.trim() : null;
    const questionRef = refRaw && validRefs.has(refRaw) ? refRaw : null;

    const questionTitle = typeof raw.question_title === "string" ? raw.question_title.trim().slice(0, 200) : null;

    const correctApproach = typeof raw.correct_approach === "string" ? raw.correct_approach.trim().slice(0, 500) : null;

    const userSnippet = clipSnippet(raw.user_snippet);

    const topicTags = Array.isArray(raw.topic_tags)
        ? (raw.topic_tags as unknown[])
            .map((t) => canonicalizeKey(t))
            .filter((t): t is string => !!t)
            .slice(0, 6)
        : [];

    return {
        questionRef,
        questionTitle,
        mistakeType,
        description,
        userSnippet,
        correctApproach,
        topicTags,
    };
}

function clipSnippet(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    const lines = trimmed.split("\n");
    if (lines.length <= MAX_SNIPPET_LINES) return trimmed.slice(0, 1200);
    return lines.slice(0, MAX_SNIPPET_LINES).join("\n").slice(0, 1200);
}

// ─────────── Cache invalidation ───────────

async function invalidateTutorCaches(userId: string): Promise<boolean> {
    try {
        await cacheDelPattern(`${TUTOR_STATS_CACHE_PREFIX}${userId}:*`);
        return true;
    } catch (err: any) {
        console.error("[PostSessionPipeline] cache invalidation failed", {
            userId: maskUserId(userId),
            error: err?.message,
        });
        return false;
    }
}

// ─────────── Helpers ───────────

function safeParseJsonObject<T>(raw: string): T {
    const cleaned = raw.replace(/^﻿/, "").trim();
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");
    if (first < 0 || last < 0 || last <= first) {
        throw new Error("model_returned_no_json");
    }
    return JSON.parse(cleaned.slice(first, last + 1)) as T;
}

function maskUserId(userId: string): string {
    return `user-${userId.slice(0, 8)}…`;
}
