import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { getGeminiClient, GEMINI_PRO_MODEL, GEMINI_MODEL, GEMINI_THINKING_HIGH, GEMINI_THINKING_MEDIUM } from "../lib/gemini.js";
import { checkRateLimit } from "../lib/rate-limiter.js";
import { buildDbBackedSheetQuestions } from "./users.js";
import { getRedis } from "../lib/redis.js";
import { runTutorTool } from "./tutor/tools/index.js";
import type { ReportTrendQuerySpec, TutorRetrievalPlan, TutorToolEvent, TutorToolName } from "./tutor/tool-types.js";
import { buildEffectiveInterviewConfig, buildModuleConfigSummary } from "./tutor/module-context.js";
import { runTutorAgent, buildAgentSystemPrompt, type AgentInputMessage } from "./tutor/agent/index.js";
import { handleCommitArtifact } from "./tutor/agent/handlers/skills-conversational.js";
import { executeAgentTool } from "./tutor/agent/tool-registry.js";
import {
    getActivePlan,
    requireTokenBudget,
    recordTokenUsage,
    EntitlementError,
} from "../services/entitlements.js";
import { getEntitlements } from "@interviewforge/shared";

function normalizeTutorTopicText(value: string): string {
    return value.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function canonicalTutorFocusTopic(value: string): string {
    const trimmed = value.trim();
    const normalized = normalizeTutorTopicText(trimmed);
    if (["oops", "oop", "object oriented", "object oriented programming"].includes(normalized)) return "OOPS";
    if (["os", "operating system", "operating systems"].includes(normalized)) return "OS";
    if (["cn", "network", "networking", "computer network", "computer networks"].includes(normalized)) return "CN";
    if (["dbms", "database management", "database management system", "database management systems"].includes(normalized)) return "DBMS";
    if (normalized === "sql") return "SQL";
    if (normalized === "dsa" || normalized === "coding") return "DSA";
    if (normalized === "system design") return "System Design";
    return trimmed;
}

function canonicalTutorFocusTopics(values: unknown[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const value of values) {
        if (typeof value !== "string") continue;
        const canonical = canonicalTutorFocusTopic(value);
        const key = normalizeTutorTopicText(canonical);
        if (!canonical || seen.has(key)) continue;
        seen.add(key);
        out.push(canonical);
    }
    return out;
}

function sanitizeTutorArtifactContent(type: string, rawContent: unknown): unknown {
    if (type !== "question_sheet" || !rawContent || typeof rawContent !== "object" || Array.isArray(rawContent)) {
        return rawContent;
    }
    const content = rawContent as Record<string, unknown>;
    if (!Array.isArray(content.focusTopics)) return rawContent;
    return {
        ...content,
        focusTopics: canonicalTutorFocusTopics(content.focusTopics),
    };
}

function tutorEstimateTokens(...parts: unknown[]): number {
    let total = 0;
    for (const p of parts) {
        if (!p) continue;
        const s = typeof p === "string" ? p : JSON.stringify(p);
        total += Math.ceil(s.length / 4);
    }
    return total;
}

// Reusable gate for tutor chat — throws EntitlementError if blocked.
async function gateTutor(userId: string) {
    const plan = await getActivePlan(userId);
    const ent = getEntitlements(plan);
    if (!ent.aiTutorAccess) {
        throw new EntitlementError(
            "FEATURE_LOCKED",
            "Upgrade to Plus or higher to use the AI tutor.",
            plan,
            403,
            { feature: "ai_tutor" }
        );
    }
    await requireTokenBudget(userId, "tutor_tokens", ent.aiTutorMonthlyTokens, plan);
    return plan;
}


type WeakArea = {
    category: string;
    score: number;
    why: string;
    actionItems: string[];
};

type ActionPlan = {
    strengths: string[];
    weakAreas: WeakArea[];
    overallSummary: string;
    priorityFocus: string;
    practiceQuestionCount?: number;
    dailyPlan?: Array<{
        day: number;
        focus: string;
        questionCount: number;
    }>;
    plannedDays?: Array<{
        day: number;
        focus: string;
        questionCount: number;
        questionTags: Array<{ category: string; count: number }>;
        questions: Array<{
            id: string;
            title: string;
            category: string;
            solveUrl: string | null;
            problemSlug?: string;
        }>;
    }>;
};

type ActionPlanTimespan = "1_week" | "2_weeks" | "monthly";

type AcceptedActionPlanResponse = {
    id: string;
    reportId: string;
    sessionId: string;
    timespan: ActionPlanTimespan;
    label: string;
    startDate: string;
    endDate: string;
    acceptedAt: string;
    actionPlan: ActionPlan | null;
};

type TutorQuestion = {
    id: string;
    category: string;
    difficulty: "easy" | "medium" | "hard";
    prompt: string;
    whatWeAreLookingFor: string;
    linkedToReportMoment?: string;
    problemSlug?: string;
};

type CachedTutorBundle = {
    reportId: string;
    actionPlan: ActionPlan;
    actionPlanTimespan: ActionPlanTimespan;
    openingMessage: string;
    questionSheet?: TutorQuestion[];
    updatedAt: number;
};

type TutorConversation = {
    id: string;
    reportId: string;
    title: string;
    status: "active" | "archived";
    createdAt: string;
    lastMessageAt: string;
    messageCount: number;
    isLegacy?: boolean;
};

type TutorUiPanel = "action-plan" | "questions" | "report";

type TutorUiDirective = {
    panel: TutorUiPanel;
    reason: string;
    payload?: Record<string, unknown>;
};

const TUTOR_MESSAGE_RETENTION_LIMIT = parseEnvInt("TUTOR_MESSAGE_RETENTION_LIMIT", 500, 200, 2000);
const CACHE_TTL_S = 60 * 60 * 6; // 6 hours
const TUTOR_RETRIEVAL_PLAN_TTL_S = parseEnvInt("TUTOR_RETRIEVAL_PLAN_TTL_S", 60 * 20, 300, 7200);
const LEGACY_TUTOR_CONVERSATION_PREFIX = "legacy:";

function parseEnvInt(name: string, fallback: number, min: number, max: number): number {
    const raw = process.env[name];
    const value = Number(raw);
    if (!Number.isFinite(value)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(value)));
}

const MAX_TREND_REPORTS = parseEnvInt("TUTOR_MAX_TREND_REPORTS", 120, 20, 500);

function trimTextAtNaturalBoundary(text: string, limit: number) {
    if (text.length <= limit) return text;
    const slice = text.slice(0, limit);
    const boundary = Math.max(
        slice.lastIndexOf("\n"),
        slice.lastIndexOf(". "),
        slice.lastIndexOf("? "),
        slice.lastIndexOf("! "),
    );
    return (boundary >= Math.floor(limit * 0.7) ? slice.slice(0, boundary + 1) : slice).trimEnd();
}

function buildPromptTranscriptPreview(full: string, sessionType: string) {
    const normalizedType = String(sessionType || "").toLowerCase();
    if (!full) return "";
    if (full.length <= 6000) return full;

    if (normalizedType === "coding") {
        const head = trimTextAtNaturalBoundary(full.slice(0, 1200), 1200);
        const middleStart = Math.max(1200, Math.floor(full.length / 2) - 1800);
        const middle = trimTextAtNaturalBoundary(full.slice(middleStart, middleStart + 3600), 3600);
        const tail = trimTextAtNaturalBoundary(full.slice(-1200), 1200);
        return `${head}\n...[solving discussion omitted]...\n${middle}\n...[closing discussion omitted]...\n${tail}`;
    }

    const head = trimTextAtNaturalBoundary(full.slice(0, 1800), 1800);
    const tail = trimTextAtNaturalBoundary(full.slice(-3200), 3200);
    return `${head}\n...[middle omitted]...\n${tail}`;
}

function isLightweightTutorTurn(message: string) {
    const text = String(message || "").trim().toLowerCase();
    if (!text) return true;
    if (text.length <= 12 && /^(hi|hello|hey|yo|thanks|thank you|ok|okay|cool|nice|great|sure|yep|yes|no)$/.test(text)) {
        return true;
    }
    return /^(tell me more|go on|continue|why\??|how so\??|explain that|explain more|elaborate|give me an example|shorter|simpler)$/i.test(text);
}

function messageNeedsVerifiedReportData(message: string) {
    const text = String(message || "").toLowerCase();
    return /(report|score|rubric|performance|how\s+did\s+i\s+do|how\s+was\s+my|how\s+did\s+i\s+perform|what\s+did\s+i\s+get|interview\s+result|transcript|what\s+was\s+said|question\s+sheet|practice\s+sheet|drill\s+history|percentile|compare\s+my\s+score|action\s*plan|study\s*plan|what\s+should\s+i\s+focus|weak\s+areas?|improvement\s+plan|recent\s+interview|last\s+interview)/.test(text);
}

function toolRequiresResolvedReport(toolName: TutorToolName) {
    return toolName !== "get_user_report_trend" && toolName !== "get_question_activity_snapshot";
}

function toolNeedsTranscript(toolName: TutorToolName) {
    return toolName === "get_session_question_detail";
}

async function getTutorBundle(reportId: string): Promise<CachedTutorBundle | null> {
    const redis = getRedis();
    if (!redis) return null; // Fallback to re-gen if no redis
    try {
        const val = await redis.get<CachedTutorBundle | string>(`api:tutor:${reportId}:plan`);
        return typeof val === 'string' ? JSON.parse(val) as CachedTutorBundle : val as CachedTutorBundle;
    } catch (err) { return null; }
}

async function setTutorBundle(reportId: string, bundle: CachedTutorBundle): Promise<void> {
    const redis = getRedis();
    if (!redis) return;
    try {
        await redis.set(`api:tutor:${reportId}:plan`, JSON.stringify(bundle), { ex: CACHE_TTL_S });
    } catch (err) {}
}


async function enforceTutorChatRetention(reportId: string) {
    // Keep only the most recent TUTOR_MESSAGE_RETENTION_LIMIT messages per report
    // This prevents unbounded growth of chat history using a single query
    await prisma.$executeRawUnsafe(`
        DELETE FROM "tutor_chat_messages"
        WHERE id IN (
            SELECT id FROM "tutor_chat_messages"
            WHERE "report_id" = $1
            ORDER BY "created_at" ASC
            LIMIT GREATEST((SELECT COUNT(*) FROM "tutor_chat_messages" WHERE "report_id" = $1) - $2, 0)::int
        )
    `, reportId, TUTOR_MESSAGE_RETENTION_LIMIT);
}

function safeParseTutorJson(content: string): Record<string, any> | null {
    try {
        const parsed = JSON.parse(content);
        return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
        return null;
    }
}

function extractTutorMessageText(content: string): string {
    const parsed = safeParseTutorJson(content);
    return typeof parsed?.text === "string" ? parsed.text : content;
}

function extractTutorConversationIdFromContent(content: string): string | null {
    const parsed = safeParseTutorJson(content);
    return typeof parsed?.conversationId === "string" && parsed.conversationId.trim()
        ? parsed.conversationId.trim()
        : null;
}

function serializeTutorMessageContent(text: string, conversationId?: string | null): string {
    if (!conversationId) return text;
    return JSON.stringify({
        text,
        conversationId,
    });
}

function isLegacyTutorConversationId(conversationId?: string | null): boolean {
    return Boolean(conversationId && conversationId.startsWith(LEGACY_TUTOR_CONVERSATION_PREFIX));
}

function buildLegacyTutorConversationId(reportId: string): string {
    return `${LEGACY_TUTOR_CONVERSATION_PREFIX}${reportId}`;
}

function buildTutorConversationTitle(baseLabel: string, existingCount: number): string {
    return existingCount <= 0 ? `${baseLabel} Session` : `${baseLabel} Session ${existingCount + 1}`;
}

function deriveTutorConversationTitleFromMessage(message: string, fallbackTitle: string): string {
    const cleaned = String(message || "").replace(/\s+/g, " ").trim();
    if (!cleaned) return fallbackTitle;
    return cleaned.length <= 48 ? cleaned : `${cleaned.slice(0, 45).trimEnd()}...`;
}

function parseLegacyAcceptedActionPlan(row: {
    id: string;
    reportId: string | null;
    content: string;
    createdAt: Date;
}): {
    id: string;
    reportId: string;
    sessionId: string;
    timespan: ActionPlanTimespan;
    label: string;
    startDate: string;
    endDate: string;
    acceptedAt: string;
    actionPlan: ActionPlan | null;
} | null {
    try {
        const parsed = JSON.parse(row.content || "{}") as {
            sessionId?: string;
            timespan?: ActionPlanTimespan;
            label?: string;
            startDate?: string;
            endDate?: string;
            acceptedAt?: string;
            actionPlan?: ActionPlan;
        };

        return {
            id: row.id,
            reportId: row.reportId || "",
            sessionId: parsed.sessionId || "",
            timespan: normalizeActionPlanTimespan(parsed.timespan),
            label: parsed.label || "Action Plan",
            startDate: parsed.startDate || row.createdAt.toISOString(),
            endDate: parsed.endDate || row.createdAt.toISOString(),
            acceptedAt: parsed.acceptedAt || row.createdAt.toISOString(),
            actionPlan: parsed.actionPlan || null,
        };
    } catch {
        return null;
    }
}

async function listTutorConversations(userId: string): Promise<TutorConversation[]> {
    const [dbConversations, legacyRows] = await Promise.all([
        prisma.tutorConversation.findMany({
            where: { userId },
            orderBy: { lastMessageAt: "desc" },
            include: {
                _count: {
                    select: {
                        messages: true,
                    },
                },
            },
        }),
        prisma.tutorChatMessage.findMany({
            where: {
                userId,
                conversationId: null,
                role: { in: ["user", "assistant"] },
            },
            orderBy: { createdAt: "asc" }, // asc so first message is first
            select: {
                id: true,
                reportId: true,
                role: true,
                content: true,
                createdAt: true,
            },
        }),
    ]);

    const conversations: TutorConversation[] = dbConversations.map((conversation) => ({
        id: conversation.id,
        reportId: conversation.reportId || "",
        title: conversation.title,
        status: conversation.status === "archived" ? "archived" : "active",
        createdAt: conversation.createdAt.toISOString(),
        lastMessageAt: conversation.lastMessageAt.toISOString(),
        messageCount: conversation._count.messages,
    }));

    if (legacyRows.length === 0) {
        return conversations.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
    }

    // Group legacy messages by reportId
    const legacyByReport = new Map<string, {
        firstUserMessage: string | null;
        lastMessageAt: string;
        messageCount: number;
        messageIds: string[];
    }>();

    for (const row of legacyRows) {
        const reportId = row.reportId || "unscoped";
        const existing = legacyByReport.get(reportId);
        if (existing) {
            existing.messageCount += 1;
            existing.lastMessageAt = row.createdAt.toISOString(); // asc order so last = most recent
            existing.messageIds.push(row.id);
        } else {
            legacyByReport.set(reportId, {
                firstUserMessage: row.role === "user" ? row.content.slice(0, 300) : null,
                lastMessageAt: row.createdAt.toISOString(),
                messageCount: 1,
                messageIds: [row.id],
            });
        }
        // Capture first user message for title generation
        const entry = legacyByReport.get(reportId)!;
        if (!entry.firstUserMessage && row.role === "user") {
            entry.firstUserMessage = row.content.slice(0, 300);
        }
    }

    // Migrate each legacy group into a real TutorConversation row (fire-and-forget)
    // This runs async so it doesn't block the response
    const migrationPromises = Array.from(legacyByReport.entries()).map(async ([reportId, meta]) => {
        try {
            // Generate a smart title from the first user message
            let title = meta.firstUserMessage
                ? meta.firstUserMessage.slice(0, 48)
                : "Earlier Session";

            if (meta.firstUserMessage) {
                try {
                    const result = await getGeminiClient().models.generateContent({
                        model: GEMINI_MODEL,
                        contents: `Generate a concise 3-5 word title for an AI interview tutor chat session based on this first message from the user. Return ONLY the title, no quotes, no punctuation at the end.\n\nUser message: "${meta.firstUserMessage}"`,
                        config: {
                            systemInstruction: "Return only a short 3-5 word title. No quotes. No punctuation at end. Capitalize each word.",
                        },
                    });
                    const raw = (result.text ?? "").trim().replace(/^["']|["']$/g, "").trim();
                    if (raw.length >= 2 && raw.length <= 80) title = raw;
                } catch {
                    // Fall back to truncated message
                }
            }

            // Create the real conversation row
            const created = await prisma.tutorConversation.create({
                data: {
                    userId,
                    reportId: reportId !== "unscoped" ? reportId : null,
                    title,
                    status: "active",
                    lastMessageAt: new Date(meta.lastMessageAt),
                },
            });

            // Link all orphaned messages to this new conversation
            await prisma.tutorChatMessage.updateMany({
                where: {
                    id: { in: meta.messageIds },
                    userId,
                    conversationId: null,
                },
                data: { conversationId: created.id },
            });

            console.log(`[Tutor] Migrated legacy session for report ${reportId} → conversation ${created.id} ("${title}")`);
            return created;
        } catch (err: any) {
            // Ignore unique constraint errors (already migrated by concurrent request)
            if (err?.code !== "P2002") {
                console.error(`[Tutor] Failed to migrate legacy session for report ${reportId}:`, err?.message);
            }
            return null;
        }
    });

    // Run migrations in background — don't await, return current state immediately
    // On next page load the migrated conversations will appear with proper titles
    Promise.all(migrationPromises).catch(() => {});

    // For this response, still show legacy entries (they'll be replaced on next load)
    for (const [reportId, meta] of legacyByReport.entries()) {
        conversations.push({
            id: buildLegacyTutorConversationId(reportId),
            reportId,
            title: meta.firstUserMessage
                ? meta.firstUserMessage.slice(0, 48)
                : "Earlier Session",
            status: "active",
            createdAt: meta.lastMessageAt,
            lastMessageAt: meta.lastMessageAt,
            messageCount: meta.messageCount,
            isLegacy: true,
        });
    }

    return conversations.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
}

async function updateTutorConversationAfterMessage(input: {
    userId: string;
    conversationId?: string | null;
    reportId?: string | null;
    titleHint?: string;
}) {
    const { conversationId, reportId, titleHint } = input;
    if (!conversationId || isLegacyTutorConversationId(conversationId)) return;

    const existing = await prisma.tutorConversation.findFirst({
        where: {
            id: conversationId,
            userId: input.userId,
        },
        select: {
            id: true,
            title: true,
        },
    });

    if (!existing) return;

    const nextTitle =
        existing.title === "New Session" && titleHint
            ? deriveTutorConversationTitleFromMessage(titleHint, existing.title)
            : existing.title;

    await prisma.tutorConversation.update({
        where: { id: existing.id },
        data: {
            title: nextTitle,
            reportId: reportId || undefined,
            lastMessageAt: new Date(),
        },
    });
}

async function ensureTutorConversation(input: {
    userId: string;
    conversationId?: string | null;
    preferredReportId?: string | null;
    titleHint?: string;
}) {
    if (input.conversationId && !isLegacyTutorConversationId(input.conversationId)) {
        const existing = await prisma.tutorConversation.findFirst({
            where: {
                id: input.conversationId,
                userId: input.userId,
            },
        });
        if (existing) return existing;
    }

    const existingCount = await prisma.tutorConversation.count({
        where: { userId: input.userId },
    });

    return prisma.tutorConversation.create({
        data: {
            userId: input.userId,
            reportId: input.preferredReportId || null,
            title: input.titleHint
                ? deriveTutorConversationTitleFromMessage(input.titleHint, "New Session")
                : buildTutorConversationTitle("Tutor", existingCount),
            status: "active",
            lastMessageAt: new Date(),
        },
    });
}

function formatCategoryLabel(category: string): string {
    return category
        .replace(/_/g, " ")
        .replace(/\b\w/g, (m) => m.toUpperCase());
}

function normalizeActionPlanTimespan(value?: string): ActionPlanTimespan {
    const v = String(value || "").trim().toLowerCase();
    if (v === "1_week" || v === "1week" || v === "week") return "1_week";
    if (v === "monthly" || v === "month" || v === "1_month") return "monthly";
    return "2_weeks";
}

function normalizePracticeQuestionCount(value: unknown): number {
    const n = Number(value);
    if (!Number.isFinite(n)) return 6;
    return Math.max(1, Math.min(9, Math.floor(n)));
}

function normalizeQuestionCategory(category: string): string {
    const c = String(category || "").trim().toLowerCase();
    if (c === "os" || c === "cn" || c === "dbms" || c === "oops" || c === "cs fundamentals" || c === "cs_fundamentals") {
        return "cs_fundamentals";
    }
    if (c === "dsa" || c === "coding") return "coding";
    if (c === "system design" || c === "system_design") return "system_design";
    return c || "general";
}

function categoryFromFocusText(focus: string): string | null {
    const v = String(focus || "").toLowerCase();
    if (/(\bos\b|\bcn\b|dbms|oops|cs fundamentals|cs_fundamentals)/.test(v)) return "cs_fundamentals";
    if (/(coding|dsa|algorithm|leetcode|data structure)/.test(v)) return "coding";
    if (/(sql|database query|joins?)/.test(v)) return "sql";
    if (/(system design|scalab|architecture|load balanc|caching|reliability)/.test(v)) return "system_design";
    return null;
}

function buildSolveUrlFromQuestion(question: { id: string; category: string }): string | null {
    const category = question.category.toLowerCase();
    const mongoIdMatch = question.id.match(/^(?:cs|dsa|sql|sd)-(.+)$/);
    const mongoId = mongoIdMatch ? mongoIdMatch[1] : null;
    if (!mongoId) return null;

    if (question.id.startsWith("cs-") || category === "os" || category === "cn" || category === "dbms" || category === "oops" || category === "cs_fundamentals") {
        return `/questions/cs-fundamentals/solve?id=${mongoId}`;
    }
    if (question.id.startsWith("dsa-") || category === "coding") {
        return `/questions/dsa/solve?id=${mongoId}`;
    }
    if (question.id.startsWith("sql-") || category === "sql") {
        return `/questions/sql/solve?id=${mongoId}`;
    }
    if (question.id.startsWith("sd-") || category === "system_design") {
        return `/questions/system-design/solve?id=${mongoId}`;
    }
    return null;
}

type PlannedDay = {
    day: number;
    focus: string;
    questionCount: number;
    questionTags: { category: string; count: number }[];
    questions: {
        id: string;
        title: string;
        category: string;
        solveUrl: string | null;
        problemSlug?: string;
    }[];
};

function buildPlannedDays(
    questionSheet: TutorQuestion[],
    dailyPlan: NonNullable<ActionPlan["dailyPlan"]>,
    practiceQuestionCount: number
) {
    const orderedQuestions = [...questionSheet].slice(0, practiceQuestionCount);
    const remaining = [...orderedQuestions];
    const built: PlannedDay[] = dailyPlan
        .slice()
        .sort((a, b) => a.day - b.day)
        .map((dayPlan) => {
            const takeCount = Math.max(0, Math.min(2, dayPlan.questionCount));
            const preferredCategory = categoryFromFocusText(dayPlan.focus);
            const picked: TutorQuestion[] = [];

            while (picked.length < takeCount && remaining.length > 0) {
                let pickIdx = 0;
                if (preferredCategory) {
                    const matchIdx = remaining.findIndex((q) => normalizeQuestionCategory(q.category) === preferredCategory);
                    if (matchIdx >= 0) pickIdx = matchIdx;
                }
                const [next] = remaining.splice(pickIdx, 1);
                if (!next) break;
                picked.push(next);
            }

            const tagCounts = new Map<string, number>();
            for (const q of picked) {
                const key = normalizeQuestionCategory(q.category);
                tagCounts.set(key, (tagCounts.get(key) || 0) + 1);
            }

            return {
                day: dayPlan.day,
                focus: dayPlan.focus,
                questionCount: picked.length,
                questionTags: Array.from(tagCounts.entries()).map(([category, count]) => ({ category, count })),
                questions: picked.map((q) => ({
                    id: q.id,
                    title: q.prompt,
                    category: normalizeQuestionCategory(q.category),
                    solveUrl: buildSolveUrlFromQuestion(q),
                    problemSlug: q.problemSlug,
                })),
            };
        });

    if (remaining.length > 0 && built.length > 0) {
        let cursor = 0;
        for (const q of remaining) {
            let attempts = 0;
            while (attempts < built.length) {
                const currentDay = built[cursor];
                if (!currentDay || currentDay.questionCount < 2) break;
                cursor = (cursor + 1) % built.length;
                attempts++;
            }
            const targetDay = built[cursor];
            if (!targetDay) continue;
            targetDay.questions.push({
                id: q.id,
                title: q.prompt,
                category: normalizeQuestionCategory(q.category),
                solveUrl: buildSolveUrlFromQuestion(q),
                problemSlug: q.problemSlug,
            });
            targetDay.questionCount += 1;
            const countMap = new Map(targetDay.questionTags.map((t) => [t.category, t.count]));
            const normalizedCategory = normalizeQuestionCategory(q.category);
            const nextCount = (countMap.get(normalizedCategory) || 0) + 1;
            countMap.set(normalizedCategory, nextCount);
            targetDay.questionTags = Array.from(countMap.entries()).map(([category, count]) => ({ category, count }));
            cursor = (cursor + 1) % built.length;
        }
    }

    return built;
}

function getTimespanPromptHint(timespan: ActionPlanTimespan): string {
    if (timespan === "1_week") {
        return "Build a focused 7-day plan with concise, high-impact tasks. Keep the scope tight and realistic for one week.";
    }
    if (timespan === "monthly") {
        return "Build a structured 4-week plan with clear week-by-week progression, milestones, and gradual difficulty increase.";
    }
    return "Build a practical 2-week plan with balanced intensity and clear checkpoints.";
}

function getTimespanDays(timespan: ActionPlanTimespan): number {
    if (timespan === "1_week") return 7;
    if (timespan === "monthly") return 30;
    return 14;
}

function getTimespanLabel(timespan: ActionPlanTimespan): string {
    if (timespan === "1_week") return "1 Week";
    if (timespan === "monthly") return "Monthly";
    return "2 Weeks";
}

function sanitizePlannedDays(raw: unknown): NonNullable<ActionPlan["plannedDays"]> {
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
                ? day.questions.map((question: any) => ({
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

function normalizeActionPlanForPersistence(
    actionPlan: ActionPlan,
    timespan: ActionPlanTimespan
): { actionPlan: ActionPlan; totalDays: number } {
    const plannedDays = sanitizePlannedDays(actionPlan.plannedDays);
    const fallbackPlannedDays = plannedDays.length > 0
        ? plannedDays
        : Array.isArray(actionPlan.dailyPlan)
            ? actionPlan.dailyPlan
                .slice()
                .sort((a, b) => a.day - b.day)
                .map((dayPlan, idx) => ({
                    day: dayPlan.day,
                    focus: dayPlan.focus,
                    questionCount: Math.max(0, Math.min(2, dayPlan.questionCount)),
                    questionTags: [],
                    questions: [],
                }))
            : [];

    const derivedTotalDays = fallbackPlannedDays.reduce((max, day) => Math.max(max, day.day), 0);
    const totalDays = Math.max(1, derivedTotalDays || getTimespanDays(timespan));

    return {
        actionPlan: {
            ...actionPlan,
            plannedDays: fallbackPlannedDays,
        },
        totalDays,
    };
}

function buildAcceptedPlanWindow(totalDays: number): { startDate: Date; endDate: Date } {
    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + Math.max(totalDays - 1, 0));
    endDate.setHours(23, 59, 59, 999);

    return { startDate, endDate };
}

function toAcceptedActionPlanResponse(row: {
    id: string;
    reportId: string;
    sessionId: string | null;
    timespan: string;
    label: string | null;
    startDate: Date;
    endDate: Date;
    acceptedAt: Date;
    actionPlan: unknown;
}, fallbackSessionId = ""): AcceptedActionPlanResponse {
    return {
        id: row.id,
        reportId: row.reportId,
        sessionId: row.sessionId || fallbackSessionId,
        timespan: normalizeActionPlanTimespan(row.timespan),
        label: row.label || "Action Plan",
        startDate: row.startDate.toISOString(),
        endDate: row.endDate.toISOString(),
        acceptedAt: row.acceptedAt.toISOString(),
        actionPlan: (row.actionPlan as ActionPlan) || null,
    };
}

function parseLooseMonthDay(raw: string, now: Date): string | null {
    const cleaned = raw.trim().replace(/\.$/, "");
    if (!cleaned) return null;

    if (/\d{4}/.test(cleaned)) {
        const direct = new Date(cleaned);
        return Number.isNaN(direct.getTime()) ? null : direct.toISOString();
    }

    const withYear = new Date(`${cleaned}, ${now.getFullYear()}`);
    if (Number.isNaN(withYear.getTime())) return null;

    if (withYear.getTime() < now.getTime() - 24 * 60 * 60 * 1000) {
        withYear.setFullYear(withYear.getFullYear() + 1);
    }

    return withYear.toISOString();
}

function parseActionPlanClarificationReply(message: string, now = new Date()): Record<string, unknown> | null {
    const trimmed = message.trim();
    if (!trimmed.startsWith("[clarify:")) return null;
    if (!/\b(sprint|action plan|study hours per week|hours per week|main focus|target)\b/i.test(trimmed)) {
        return null;
    }

    const args: Record<string, unknown> = {};

    const scopeMatch = trimmed.match(/for your\s+(.+?)\s+target\b/i);
    if (scopeMatch?.[1]) {
        const scope = scopeMatch[1].trim();
        const levelMatch = scope.match(/\b([A-Z]{0,3}\d(?:\+)?|L\d+|E\d+|IC\d+)\b/i);
        if (levelMatch?.[1]) {
            args.targetLevel = levelMatch[1].toUpperCase();
            const company = scope.replace(levelMatch[0], "").replace(/\s+/g, " ").trim();
            if (company) args.targetCompany = company;
        } else if (scope) {
            args.targetCompany = scope;
        }
    }

    const dateMatch = trimmed.match(/\bon\s+([A-Za-z]+\s+\d{1,2}(?:,\s*\d{4})?)\b/i);
    if (dateMatch?.[1]) {
        const deadline = parseLooseMonthDay(dateMatch[1], now);
        if (deadline) args.deadline = deadline;
    }

    const hoursMatch = trimmed.match(/study hours per week:\s*([0-9]+(?:\.[0-9]+)?)/i);
    if (hoursMatch?.[1]) {
        const parsed = Math.round(Number(hoursMatch[1]));
        if (Number.isFinite(parsed) && parsed > 0) {
            args.hoursPerWeek = parsed;
        }
    }

    const focusMatch = trimmed.match(/main focus\??:\s*(.+)/i);
    if (focusMatch?.[1]) {
        const focus = focusMatch[1].trim();
        if (focus && !/^\(skipped\)$/i.test(focus)) {
            args.priorityWeakAreaTopics = focus
                .split(/\s*(?:,|\/|\||&)\s*/)
                .map((part) => part.trim())
                .filter(Boolean)
                .slice(0, 6);
        }
    }

    return Object.keys(args).length > 0 ? args : {};
}

function safeExtractJson(text: string): any {
    const trimmed = text.trim();
    const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
        return JSON.parse(fenced[1]);
    }
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first !== -1 && last !== -1 && last > first) {
        return JSON.parse(trimmed.slice(first, last + 1));
    }
    throw new Error("JSON payload not found in model response");
}

function parseActionPlan(raw: any, rubricScores: Array<{ category: string; score: number }>): ActionPlan {
    const weakAreas: WeakArea[] = Array.isArray(raw?.weakAreas)
        ? raw.weakAreas
            .filter((item: any) => item && typeof item === "object")
            .slice(0, 4)
            .map((item: any, idx: number) => ({
                category: String(item.category || `area_${idx + 1}`).toLowerCase(),
                score: Number.isFinite(Number(item.score)) ? Number(item.score) : 5,
                why: String(item.why || "Needs clearer examples and measurable outcomes."),
                actionItems: Array.isArray(item.actionItems)
                    ? item.actionItems.map((x: any) => String(x)).filter(Boolean).slice(0, 4)
                    : ["Use STAR format", "Add measurable results"],
            }))
        : [];

    const fallbackWeakAreas = rubricScores
        .slice()
        .sort((a, b) => a.score - b.score)
        .slice(0, 2)
        .map((x) => ({
            category: x.category,
            score: Math.round(x.score),
            why: "This area scored lower than others in your latest interview.",
            actionItems: [
                `Practice 2 STAR stories focused on ${formatCategoryLabel(x.category)}.`,
                "Use explicit ownership language: I did, I decided, I delivered.",
            ],
        }));

    return {
        strengths: Array.isArray(raw?.strengths) ? raw.strengths.map((x: any) => String(x)).filter(Boolean).slice(0, 5) : [],
        weakAreas: weakAreas.length > 0 ? weakAreas : fallbackWeakAreas,
        overallSummary: String(raw?.overallSummary || "You show potential, but your examples need stronger ownership and measurable outcomes."),
        priorityFocus:
            typeof raw?.priorityFocus === "string" && raw.priorityFocus.trim()
                ? raw.priorityFocus.trim().toLowerCase()
                : (weakAreas[0]?.category || fallbackWeakAreas[0]?.category || "communication"),
        practiceQuestionCount: normalizePracticeQuestionCount(raw?.practiceQuestionCount),
        dailyPlan: Array.isArray(raw?.dailyPlan)
            ? raw.dailyPlan
                .filter((item: any) => item && typeof item === "object")
                .slice(0, 30)
                .map((item: any) => ({
                    day: Math.max(1, Math.floor(Number(item.day) || 1)),
                    focus: String(item.focus || "Practice session"),
                    questionCount: Math.max(1, Math.min(2, Math.floor(Number(item.questionCount) || 1))),
                }))
            : [],
    };
}

function parseQuestionSheet(raw: any): TutorQuestion[] {
    const questions = Array.isArray(raw?.questions) ? raw.questions : [];
    return questions
        .filter((q: any) => q && typeof q === "object")
        .slice(0, 8)
        .map((q: any, idx: number) => ({
            id: String(q.id || `q${idx + 1}`),
            category: String(q.category || "general").toLowerCase(),
            difficulty: ["easy", "medium", "hard"].includes(String(q.difficulty || "").toLowerCase())
                ? (String(q.difficulty).toLowerCase() as "easy" | "medium" | "hard")
                : "medium",
            prompt: String(q.prompt || "Tell me about a challenging situation and how you handled it."),
            whatWeAreLookingFor: String(
                q.whatWeAreLookingFor || "Clear STAR structure, specific actions, and measurable outcome."
            ),
            linkedToReportMoment: q.linkedToReportMoment ? String(q.linkedToReportMoment) : undefined,
            problemSlug: q.problemSlug ? String(q.problemSlug) : undefined,
        }));
}

async function fetchReportContext(
    userId: string,
    reportId?: string,
    options?: {
        includeTranscript?: boolean;
        includeRecentReports?: boolean;
    }
) {
    const report = await prisma.evaluationReport.findFirst({
        where: {
            userId,
            ...(reportId
                ? {
                      OR: [{ id: reportId }, { sessionId: reportId }],
                  }
                : {}),
        },
        orderBy: reportId ? undefined : { generatedAt: "desc" },
        include: {
            session: {
                select: {
                    id: true,
                    type: true,
                    role: true,
                    level: true,
                    moduleConfig: true,
                    createdAt: true,
                    completedAt: true,
                },
            },
        },
    });

    if (!report) return null;

    const includeTranscript = options?.includeTranscript ?? false;
    const includeRecentReports = options?.includeRecentReports ?? true;

    const [messages, recentReports] = await Promise.all([
        includeTranscript
            ? prisma.sessionMessage.findMany({
                where: { sessionId: report.sessionId },
                orderBy: { createdAt: "asc" },
                select: { role: true, content: true, createdAt: true },
            })
            : Promise.resolve([]),
        includeRecentReports
            ? prisma.evaluationReport.findMany({
                where: { userId },
                orderBy: { generatedAt: "desc" },
                take: 4,
                select: {
                    id: true,
                    overallScore: true,
                    generatedAt: true,
                    rubricScores: true,
                    session: {
                        select: {
                            type: true,
                            moduleConfig: true,
                        },
                    },
                },
            })
            : Promise.resolve([]),
    ]);

    const transcriptFull = includeTranscript
        ? messages
            .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
            .join("\n")
        : "";
    const transcript = includeTranscript
        ? buildPromptTranscriptPreview(transcriptFull, report.session.type)
        : "";

    const rubricScores = Array.isArray(report.rubricScores)
        ? (report.rubricScores as any[])
              .map((x) => ({ category: String(x.category || "general").toLowerCase(), score: Number(x.score) || 0 }))
              .filter((x) => x.category)
        : [];
    const competencyScores = Array.isArray(report.competencyScores)
        ? (report.competencyScores as any[])
              .map((x) => ({
                  id: String(x?.id || "").trim(),
                  label: String(x?.label || "").trim(),
                  score: Math.max(0, Math.min(10, Math.round(Number(x?.score) || 0))),
                  strength: String(x?.strength || "").trim(),
                  evidence: typeof x?.evidence === "string" ? x.evidence : "",
                  tip: typeof x?.tip === "string" ? x.tip : "",
              }))
              .filter((x) => x.id && x.label)
        : [];

    return {
        report,
        effectiveInterviewConfig: buildEffectiveInterviewConfig(report.session.type, report.session.moduleConfig),
        moduleConfigSummary: buildModuleConfigSummary(report.session.type, report.session.moduleConfig),
        rubricScores,
        competencyScores,
        transcript,
        transcriptFull,
        recentReports,
    };
}

function scoreFromMessage(text: string): number | null {
    // Only match numbers that are clearly scores — require explicit score context or /100 or %
    // Do NOT match bare numbers like "2 weeks" or "3 sessions"
    const match = text.match(/(?:score|overall|got|rated|scored)\s*(\d{1,3})(?:\s*\/\s*100|\s*percent|%)?(?:\b|$)/i)
        || text.match(/(\d{1,3})\s*(?:\/\s*100|percent|%)/i);
    if (!match?.[1]) return null;
    const value = Number(match[1]);
    if (!Number.isFinite(value)) return null;
    if (value < 0 || value > 100) return null;
    return Math.round(value);
}

function parseTypeHint(text: string): string | null {
    const v = text.toLowerCase();

    if (/gen[\s_-]*ai|generative\s+ai|\brag\b|prompt\s+engineering|llm\s+(interview|round|coding|evaluation)|model\s+evaluation/.test(v)) return "gen_ai_role";

    if (/data\s+science|ds\s+(interview|round)|machine\s+learning|ml\s+(interview|round)|statistics\s+(interview|round)|experiment\s+design/.test(v)) return "data_science_role";

    if (/\bpm\s+(interview|round|case)|product\s+management|product\s+(case|sense|strategy|metrics)|prioriti[sz]ation/.test(v)) return "pm_role";

    if (/problem[\s_-]*solving\s+case|case\s+interview|analytical\s+case|logic\s+case/.test(v)) return "problem_solving_case";

    // system_design — covers abbreviations, round names, design-specific terms
    if (/system[\s_-]*design|sys[\s_-]*design|\bsd\s+round\b|\bsd\s+interview\b|\barchitecture\s+(round|interview)\b|\bdesign\s+(round|interview)\b|\bhld\b|\blld\b|\bhigh[\s-]*level\s+design\b|\blow[\s-]*level\s+design\b|\bscalability\s+(round|interview)\b/.test(v)) return "system_design";

    // cs_fundamentals — covers theory, OS, CN, DBMS, OOPS, networking, fundamentals
    if (/cs[\s_-]*fundamentals|computer\s+science\s+fundamentals|\bfundamentals?\b|\btheory\s+(round|interview)\b|\boops?\b|\bobject[\s-]*oriented\b|\boperating\s+systems?\b|\bos\s+(round|interview)\b|\bcomputer\s+networks?\b|\bcn\s+(round|interview)\b|\bnetworking\s+(round|interview)\b|\bdbms\b|\bdatabase\s+management\b|\bdata\s+structures?\s+theory\b/.test(v)) return "cs_fundamentals";

    // sql — covers SQL round, database queries, joins, query writing
    if (/\bsql\b|\bsql\s+(round|interview|query|test)\b|database\s+quer(y|ies)|query\s+(round|interview)|\bjoins?\s+(round|interview)\b|\brelational\s+database\b/.test(v)) return "sql";

    // behavioural — covers HR, situational, STAR, soft skills, behaviour variants
    if (/behavi[ou]+ral|behaviour|behavioral|\bhr\s+(round|interview)\b|\bsituational\b|\bstar\s+(method|format|round)\b|\bsoft\s+skills?\s+(round|interview)\b|\bculture\s+(fit|round|interview)\b|\bmanagerial\s+(round|interview)\b/.test(v)) return "behavioural";

    // coding — covers DSA, LeetCode, problem solving, coding round
    if (/\bcoding\s*(round|interview|test|challenge)?\b|\bdsa\b|\bleetcode\b|\balgorithm(s|ic)?\b|\bdata\s+structures?\b|\bcompetitive\s+programming\b/.test(v)) return "coding";

    // full_interview — covers comprehensive, complete, mock, all-round interviews
    if (/full[\s_-]*interview|full[\s_-]*mock|comprehensive\s+interview|complete\s+interview|mock\s+interview|all[\s-]*round\s+interview|end[\s-]*to[\s-]*end\s+interview/.test(v)) return "full_interview";

    return null;
}

function parseTimespanFromMessage(text: string): ActionPlanTimespan {
    const v = text.toLowerCase();
    if (/monthly|month|4\s*week|30\s*day/.test(v)) return "monthly";
    if (/1\s*week|one\s*week|7\s*day|week plan/.test(v)) return "1_week";
    return "2_weeks";
}

function normalizeTrendTypeFilter(value: unknown): string | null {
    const v = String(value || "").trim().toLowerCase();
    const allowed = new Set([
        "coding",
        "full_interview",
        "system_design",
        "sql",
        "cs_fundamentals",
        "behavioural",
        "gen_ai_role",
        "data_science_role",
        "pm_role",
        "problem_solving_case",
    ]);
    if (allowed.has(v)) return v;
    return parseTypeHint(v);
}

/**
 * Scans the last N chat messages to infer a "conversational type context" —
 * i.e. if the user has been talking about "full interview" for the last few turns,
 * subsequent messages like "what question did I fail" should inherit that context
 * rather than defaulting to the globally most recent report.
 *
 * Returns the inferred interview type string, or null if no clear context.
 */
function inferTypeHintFromHistory(
    chatHistory: Array<{ role: string; content: string }>
): string | null {
    // Only look at the last 6 messages (3 turns), and ONLY user messages.
    // Assistant responses often mention other interview types in context/citations
    // (e.g. "based on your system design interview") which would falsely poison
    // the type hint for the very next turn and resolve to the wrong report.
    const recent = chatHistory.slice(-6).filter((m) => m.role === "user");
    const typeCounts = new Map<string, number>();

    for (const msg of recent) {
        const hint = parseTypeHint(String(msg.content || ""));
        if (hint) {
            typeCounts.set(hint, (typeCounts.get(hint) || 0) + 1);
        }
    }

    if (typeCounts.size === 0) return null;

    // Return the most frequently mentioned type in recent user messages
    let best: string | null = null;
    let bestCount = 0;
    for (const [type, count] of typeCounts.entries()) {
        if (count > bestCount) {
            best = type;
            bestCount = count;
        }
    }

    return best;
}

function buildUtcDayRange(year: number, month1: number, day: number): { start: Date; end: Date; label: string } | null {
    if (!Number.isInteger(year) || !Number.isInteger(month1) || !Number.isInteger(day)) return null;
    if (month1 < 1 || month1 > 12 || day < 1 || day > 31) return null;
    const start = new Date(Date.UTC(year, month1 - 1, day, 0, 0, 0, 0));
    const end = new Date(Date.UTC(year, month1 - 1, day, 23, 59, 59, 999));
    // Reject invalid dates such as 31 Feb after Date normalization.
    if (
        start.getUTCFullYear() !== year ||
        start.getUTCMonth() !== month1 - 1 ||
        start.getUTCDate() !== day
    ) {
        return null;
    }
    const label = `${year}-${String(month1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return { start, end, label };
}

function parseExactDateHintFromMessage(message: string): { start: Date; end: Date; label: string } | null {
    const text = String(message || "").toLowerCase();
    const currentYear = new Date().getUTCFullYear();
    const monthMap: Record<string, number> = {
        jan: 1,
        january: 1,
        feb: 2,
        february: 2,
        mar: 3,
        march: 3,
        apr: 4,
        april: 4,
        may: 5,
        jun: 6,
        june: 6,
        jul: 7,
        july: 7,
        aug: 8,
        august: 8,
        sep: 9,
        sept: 9,
        september: 9,
        oct: 10,
        october: 10,
        nov: 11,
        november: 11,
        dec: 12,
        december: 12,
    };

    // yyyy-mm-dd
    const iso = text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
    if (iso) {
        return buildUtcDayRange(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    }

    // dd/mm/yyyy or dd-mm-yyyy
    const dmyYear = text.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](20\d{2})\b/);
    if (dmyYear) {
        return buildUtcDayRange(Number(dmyYear[3]), Number(dmyYear[2]), Number(dmyYear[1]));
    }

    // dd/mm or dd-mm (assume current year)
    const dmyNoYear = text.match(/\b(\d{1,2})[\/\-](\d{1,2})\b/);
    if (dmyNoYear) {
        const maybe = buildUtcDayRange(currentYear, Number(dmyNoYear[2]), Number(dmyNoYear[1]));
        if (maybe) return maybe;
    }

    // 17th april [2026]
    const dayMonth = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})(?:\s+(20\d{2}))?\b/);
    if (dayMonth && monthMap[dayMonth[2]]) {
        const year = dayMonth[3] ? Number(dayMonth[3]) : currentYear;
        return buildUtcDayRange(year, monthMap[dayMonth[2]], Number(dayMonth[1]));
    }

    // april 17 [2026]
    const monthDay = text.match(/\b([a-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s+(20\d{2}))?\b/);
    if (monthDay && monthMap[monthDay[1]]) {
        const year = monthDay[3] ? Number(monthDay[3]) : currentYear;
        return buildUtcDayRange(year, monthMap[monthDay[1]], Number(monthDay[2]));
    }

    return null;
}

function normalizeToolNames(raw: unknown): TutorToolName[] {
    const allowed: TutorToolName[] = [
        "get_report_summary",
        "get_report_stage_transcript_context",
        "get_user_report_trend",
        "get_question_activity_snapshot",
        "get_sheet_status_for_report",
        "get_action_plan_for_report",
        "get_rubric_comparison",
        "get_weak_area_drill_history",
        "get_session_question_detail",
        "get_score_percentile",
        "get_accepted_action_plan",
    ];
    // Fuzzy alias map — handles LLM output variants like spaces, mixed case, partial names
    const aliasMap: Record<string, TutorToolName> = {
        "get report summary": "get_report_summary",
        "report summary": "get_report_summary",
        "summary": "get_report_summary",
        "get report stage transcript context": "get_report_stage_transcript_context",
        "stage transcript": "get_report_stage_transcript_context",
        "report transcript": "get_report_stage_transcript_context",
        "transcript context": "get_report_stage_transcript_context",
        "transcript": "get_report_stage_transcript_context",
        "get user report trend": "get_user_report_trend",
        "user report trend": "get_user_report_trend",
        "report trend": "get_user_report_trend",
        "trend": "get_user_report_trend",
        "get question activity snapshot": "get_question_activity_snapshot",
        "question activity snapshot": "get_question_activity_snapshot",
        "activity snapshot": "get_question_activity_snapshot",
        "get sheet status for report": "get_sheet_status_for_report",
        "sheet status": "get_sheet_status_for_report",
        "get action plan for report": "get_action_plan_for_report",
        "action plan for report": "get_action_plan_for_report",
        "action plan": "get_action_plan_for_report",
        "get rubric comparison": "get_rubric_comparison",
        "rubric comparison": "get_rubric_comparison",
        "rubric trend": "get_rubric_comparison",
        "category trend": "get_rubric_comparison",
        "get weak area drill history": "get_weak_area_drill_history",
        "weak area drill history": "get_weak_area_drill_history",
        "drill history": "get_weak_area_drill_history",
        "get session question detail": "get_session_question_detail",
        "session question detail": "get_session_question_detail",
        "question detail": "get_session_question_detail",
        "get score percentile": "get_score_percentile",
        "score percentile": "get_score_percentile",
        "percentile": "get_score_percentile",
        "get accepted action plan": "get_accepted_action_plan",
        "accepted action plan": "get_accepted_action_plan",
        "current plan": "get_accepted_action_plan",
        "my plan": "get_accepted_action_plan",
    };
    if (!Array.isArray(raw)) return [];
    const picked = raw
        .map((item) => {
            const normalized = String(item || "").trim().toLowerCase().replace(/[-]/g, "_");
            if (allowed.includes(normalized as TutorToolName)) return normalized as TutorToolName;
            const spaced = normalized.replace(/_/g, " ");
            return aliasMap[spaced] ?? aliasMap[normalized] ?? null;
        })
        .filter((name): name is TutorToolName => name !== null);
    return Array.from(new Set(picked)).slice(0, 3);
}

function buildFallbackRetrievalPlan(message: string): TutorRetrievalPlan {
    const typeFilter = parseTypeHint(message);
    const exactDate = parseExactDateHintFromMessage(message);
    const v = message.toLowerCase();

    let tools: TutorToolName[] = [];

    if (/action[\s_-]*plan|road\s*map|focus[\s_-]*areas?|improvement|what\s+should\s+i|weak(er)?\s+areas?|coaching|study\s+plan|next\s+steps?/.test(v)) {
        // If no specific type mentioned, fetch cross-type trend data so LLM can answer holistically
        const hasTypeHint = typeFilter !== null;
        tools = hasTypeHint
            ? ["get_action_plan_for_report", "get_report_summary"]
            : ["get_user_report_trend", "get_action_plan_for_report", "get_report_summary"];
    } else if (/how\s+(did\s+i\s+do|was\s+my\s+performance|did\s+i\s+perform)|performance\s+in|tell\s+me\s+about\s+my|what\s+about\s+my\s+performance|analysis\s+of\s+my|understanding\s+of\s+my|review\s+(the\s+)?(whole\s+)?interview/.test(v)) {
        // Broad performance/review questions should stay report-first.
        tools = ["get_report_summary"];
    } else if (/transcript|what\s+(did\s+i\s+say|was\s+said)|conversation|chat\s+log|rewrite\s+my\s+answer|contradict|exactly\s+wrong|where\s+i\s+got\s+stuck/.test(v)) {
        tools = ["get_report_stage_transcript_context", "get_report_summary"];
    } else if (/how\s+many|count|ratio|distribution|breakdown|trend|history|all\s+(my\s+)?interviews|types?\s+of\s+interviews?/.test(v)) {
        tools = ["get_user_report_trend"];
    } else if (/am\s+i\s+improving|getting\s+better|progress\s+(in|on|over)|rubric\s+(trend|over\s+time)|category\s+(trend|progress)|compare\s+(my\s+)?(scores?|rubric)/.test(v)) {
        tools = ["get_rubric_comparison", "get_report_summary"];
    } else if (/what\s+(have\s+i|did\s+i)\s+(practiced?|drilled?|worked\s+on)|already\s+practiced?|drill\s+history|what\s+to\s+(focus|work)\s+on\s+next/.test(v)) {
        tools = ["get_weak_area_drill_history", "get_accepted_action_plan"];
    } else if (/(questions?|problems?|tasks?)\s+(from|in|during)\s+(that|this|my|the)\s+interview|all\s+.*(questions?|problems?|tasks?).*(interview|session)|what\s+(question|problem|task)|which\s+question|show\s+me\s+(the\s+)?(question|problem|code)|what\s+did\s+i\s+(code|write|answer)|my\s+(code|solution|answer)/.test(v)) {
        tools = ["get_session_question_detail", "get_report_summary"];
    } else if (/question[\s_-]*sheet|practice|drill|quiz/.test(v)) {
        tools = ["get_sheet_status_for_report", "get_report_summary"];
    } else if (/percentile|how\s+(good|well)\s+(is|was)\s+my\s+score|compare\s+(to\s+)?(others?|everyone|average)|above\s+average|below\s+average|rank(ing)?/.test(v)) {
        tools = ["get_score_percentile", "get_report_summary"];
    } else if (/do\s+i\s+have\s+(a\s+)?plan|my\s+(current\s+)?plan|show\s+me\s+my\s+plan|what('?s|\s+is)\s+my\s+plan|active\s+plan|study\s+plan/.test(v)) {
        tools = ["get_accepted_action_plan", "get_report_summary"];
    } else {
        tools = isLightweightTutorTurn(message) ? [] : ["get_question_activity_snapshot"];
    }

    // includeAll = true for any broad/historical question without a specific date filter
    const isBroadHistoryQuestion = typeFilter === null && !exactDate && /action[\s_-]*plan|focus[\s_-]*areas?|improvement|what\s+should\s+i|weak(er)?\s+areas?|coaching|study\s+plan|next\s+steps?|how\s+many|count|ratio|distribution|breakdown|trend|history|all\s+(my\s+)?interviews|types?\s+of\s+interviews?|overall|across\s+all|total/.test(v);

    return {
        tools,
        trendSpec: {
            typeFilter,
            sinceDate: exactDate?.start || null,
            untilDate: exactDate?.end || null,
            limit: isBroadHistoryQuestion ? 120 : 12,
            includeAll: isBroadHistoryQuestion,
            requestedTimespanDays: null,
            needExactTypeDistribution: /how\s+many|count|ratio|distribution|breakdown/.test(v),
            exactDateText: exactDate?.label || null,
        },
        plannerSource: "fallback",
    };
}

async function planTutorRetrievalWithLLM(input: {
    message: string;
    chatHistory: Array<{ role: "user" | "assistant"; content: string }>;
    conversationalTypeHint?: string | null;
    userId?: string;
    reportId?: string;
}): Promise<TutorRetrievalPlan> {
    // ── Redis cache: skip the Gemini Flash planning call for repeated/similar messages ──
    // Cache key: userId + reportId + normalized message text (lowercased, whitespace collapsed)
    // TTL: 20 minutes — avoids repeated planner calls within a study session while still
    // staying short enough to reflect updated conversation context reasonably well.
    const redis = getRedis();
    const normalizedMsg = input.message.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 200);
    const planCacheKey = input.userId && input.reportId
        ? `tutor:plan:${input.userId}:${input.reportId}:${Buffer.from(normalizedMsg).toString("base64url").slice(0, 48)}`
        : null;

    if (planCacheKey && redis) {
        try {
            const cached = await redis.get<TutorRetrievalPlan>(planCacheKey);
            if (cached && cached.tools && Array.isArray(cached.tools)) {
                return { ...cached, plannerSource: "cache" as any };
            }
        } catch { /* Redis miss — fall through to Gemini */ }
    }

    const historyTail = input.chatHistory.slice(-4);
    const contextNote = input.conversationalTypeHint
        ? `\nCONVERSATIONAL CONTEXT: The user has been discussing "${input.conversationalTypeHint.replace(/_/g, " ")}" interviews in recent turns. If the current message doesn't specify a different type, assume they are still referring to "${input.conversationalTypeHint.replace(/_/g, " ")}" and set typeFilter accordingly.`
        : "";
    const planningPrompt = `You are a retrieval planner for an interview tutor backend.
Return strict JSON only.

Choose up to 3 tools from:
- get_report_summary          — current report scores, rubric, strengths, improvements
  - get_report_stage_transcript_context — what was said in one specific interview stage only; use only when exact wording or stage-specific answer quality is needed
- get_user_report_trend       — historical counts, type distribution, score trend over time
- get_question_activity_snapshot — recent practice/interview question solve/attempt stats with human-readable titles
- get_sheet_status_for_report — practice question sheet completion status
- get_action_plan_for_report  — generate/fetch a coaching action plan
- get_rubric_comparison       — compare rubric scores across multiple sessions of same type (improving/declining per category)
- get_weak_area_drill_history — which weak areas have been drilled vs not started yet
- get_session_question_detail — actual questions asked + candidate code/answers in this session
- get_score_percentile        — how the user's score compares to all other users (percentile, distribution)
- get_accepted_action_plan    — fetch the user's currently active accepted study plan

Also produce trendQuery for get_user_report_trend, even if that tool is not selected.

Schema:
{
  "tools": ["tool_name"],
  "trendQuery": {
    "typeFilter": "coding|full_interview|system_design|sql|cs_fundamentals|behavioural|gen_ai_role|data_science_role|pm_role|problem_solving_case|null",
    "moduleFilter": "coding|cs_fundamentals|sql|system_design|behavioural|genai|data_science|product_management|problem_solving_case|null",
    "topicFilter": "optional selected topic like graphs, dp, os, cn, dbms, oops, rag, statistics, product_metrics, or null",
    "requestedTimespanDays": number|null,
    "includeAll": boolean,
    "limit": number,
    "needExactTypeDistribution": boolean
  }
}

Planning rules:
- Favor precision. Only include tools needed to answer the latest user ask.
- Use an empty tools array when the latest turn is a lightweight conversational follow-up that can be answered from chat history alone.
- If the user asks for questions/problems/tasks from an interview/session, what was asked, or "all the CS/DSA/SQL questions from that interview", choose get_session_question_detail + get_report_summary. Do not treat this as practice sheet creation even if they say "so we can practice".
- For count/ratio/breakdown/distribution questions, set needExactTypeDistribution=true.
- If user asks for all-time history OR asks broadly about their interviews without a specific date, set includeAll=true and do NOT set requestedTimespanDays.
- Only set requestedTimespanDays when the user EXPLICITLY mentions a time window (e.g. "last 2 weeks", "past month"). Never infer a time window from context.
- IMPORTANT: Never set sinceDate or requestedTimespanDays unless the user explicitly asked for a specific time range. Broad questions like "how many interviews have I done" or "tell me about my history" should always use includeAll=true with no date filter.
- If user asks about a specific interview type, set typeFilter accordingly. If they ask about a module/topic inside a modular full interview, keep typeFilter if known and use moduleFilter/topicFilter for intent.
- Always include get_report_summary unless the user ask is purely historical aggregate or comparison.
- Use get_rubric_comparison when user asks about improvement over time, category trends, or "am I getting better".
- Use get_weak_area_drill_history when user asks what they've practiced or what to focus on next.
- Use get_session_question_detail when user asks about specific questions, their code, or what was asked.
- Use get_score_percentile when user asks how good their score is, ranking, or comparison to others.
- Use get_accepted_action_plan when user asks about their current/active plan or study schedule.
- IMPORTANT: If the user asks about focus areas, improvement, weak areas, total interviews, or history WITHOUT specifying a particular interview type (e.g. "what should I focus on", "what are my weak areas overall", "how can I improve"), set typeFilter to null and includeAll to true in trendQuery, and include get_user_report_trend in tools. This gives the LLM cross-type data to answer holistically.
- If the user explicitly mentions a specific interview type (e.g. "system design", "coding", "cs fundamentals"), set typeFilter accordingly and do NOT use includeAll.
  - For broad performance/review questions about a specific interview (e.g. "how did I do", "review the whole interview", "what was my performance"), use get_report_summary only.
  - Use get_report_stage_transcript_context only when the user asks for exact wording, answer rewrite, contradiction, where they got stuck, or feedback about a named stage/module such as SQL, DSA, resume projects, or behavioural.
  - There is no full-transcript retrieval tool. If a stage is unclear, answer from the report summary or ask which stage they want inspected.

Conversation tail:
${JSON.stringify(historyTail)}
${contextNote}
Latest user message:
${input.message}`;

    try {
        const geminiResponse = await getGeminiClient().models.generateContent({
            model: GEMINI_MODEL, // Flash — just picks tool names from a fixed list, no reasoning needed
            contents: planningPrompt,
            config: {
                systemInstruction: "Return only valid JSON. No markdown.",
                responseMimeType: "application/json" as const,
            },
        });

        const parsed = safeExtractJson(geminiResponse.text ?? "{}");
        const tools = normalizeToolNames(parsed?.tools);
        const exactDate = parseExactDateHintFromMessage(input.message);
        const requestedTimespanDaysRaw = Number(parsed?.trendQuery?.requestedTimespanDays);
        const requestedTimespanDays = Number.isFinite(requestedTimespanDaysRaw)
            ? Math.max(1, Math.min(3650, Math.floor(requestedTimespanDaysRaw)))
            : null;

        const includeAll = Boolean(parsed?.trendQuery?.includeAll);
        const limitRaw = Number(parsed?.trendQuery?.limit);
        const limit = includeAll
            ? MAX_TREND_REPORTS
            : Number.isFinite(limitRaw)
                ? Math.max(1, Math.min(MAX_TREND_REPORTS, Math.floor(limitRaw)))
                : 10;

        const trendSpec: ReportTrendQuerySpec = {
            typeFilter: normalizeTrendTypeFilter(parsed?.trendQuery?.typeFilter),
            sinceDate: exactDate
                ? exactDate.start
                : requestedTimespanDays
                    ? new Date(Date.now() - requestedTimespanDays * 24 * 60 * 60 * 1000)
                    : null,
            untilDate: exactDate ? exactDate.end : null,
            limit,
            includeAll,
            requestedTimespanDays,
            needExactTypeDistribution: Boolean(parsed?.trendQuery?.needExactTypeDistribution),
            exactDateText: exactDate?.label || null,
        };

        const normalizedTools: TutorToolName[] = tools;
        // Only force-inject get_report_summary when the user explicitly needs verified report data
        const isPurelyAggregate = /^(how\s+many|count|ratio|distribution|breakdown|trend|list\s+(all|my|different)|what\s+types?|types?\s+of\s+interviews?|all\s+(my\s+)?interviews|interview\s+history|give\s+me\s+a\s+breakdown)/i.test(input.message.trim());
        if (messageNeedsVerifiedReportData(input.message) && !normalizedTools.includes("get_report_summary") && !isPurelyAggregate) {
            normalizedTools.unshift("get_report_summary");
        }

        const result: TutorRetrievalPlan = {
            tools: normalizedTools.slice(0, 3) as TutorToolName[],
            trendSpec,
            plannerSource: "llm",
        };

        // Write to Redis cache (fire-and-forget — don't delay the response)
        if (planCacheKey && redis) {
            redis.set(planCacheKey, JSON.stringify(result), { ex: TUTOR_RETRIEVAL_PLAN_TTL_S }).catch(() => {});
        }

        return result;
    } catch {
        return buildFallbackRetrievalPlan(input.message);
    }
}

async function resolveReportFromUserReference(input: {
    userId: string;
    activeReportId?: string;
    userReference: string;
    conversationalTypeHint?: string | null;
}) {
    const { userId, activeReportId, userReference, conversationalTypeHint } = input;

    const reports = await prisma.evaluationReport.findMany({
        where: { userId },
        orderBy: { generatedAt: "desc" },
        take: 12,
        include: {
            session: {
                select: { id: true, type: true, role: true, level: true },
            },
        },
    });

    if (!reports.length) {
        return {
            selectedReport: null,
            candidates: [],
            disambiguationRequired: false,
            confidence: "low" as const,
        };
    }

    const text = String(userReference || "").toLowerCase();
    // Use explicit type hint from current message first, fall back to conversational context
    const explicitTypeHint = parseTypeHint(text);
    const typeHint = explicitTypeHint || conversationalTypeHint || null;
    const scoreHint = scoreFromMessage(text);
    const hasRecentHint = /latest|recent|last|newest|current|today|just\s+(did|took|had|completed|finished)|the\s+one\s+i\s+(just|recently)|most\s+recent/.test(text);

    // "recent" in context of an established type means most recent of THAT type
    // e.g. after talking about full interviews, "recent one" = most recent full interview
    const hasExplicitReferenceHint =
        /\b(this|that|selected|current)\s+(report|interview|session)\b/.test(text) ||
        /\bmy\s+report\b/.test(text);

    let candidates = reports;

    if (typeHint) {
        const filtered = candidates.filter((r) => r.session.type === typeHint);
        if (filtered.length > 0) candidates = filtered;
    }

    if (scoreHint !== null) {
        const filtered = candidates.filter((r) => Math.abs(Math.round(Number(r.overallScore) || 0) - scoreHint) <= 5);
        if (filtered.length > 0) candidates = filtered;
    }

    if (hasRecentHint) {
        const selectedReport = candidates[0] || reports[0] || null;
        return {
            selectedReport,
            candidates: candidates.slice(0, 5),
            disambiguationRequired: false,
            confidence: "high" as const,
        };
    }

    if (activeReportId && scoreHint === null && !hasExplicitReferenceHint) {
        // The activeReportId is the authoritative anchor — it represents the conversation
        // the user is physically looking at in the UI. Prefer it UNLESS:
        //   (a) the user explicitly named a different type (explicitTypeHint), OR
        //   (b) the user named a specific score/date that narrows to a different session.
        // A conversationalTypeHint (inferred from history) is NOT strong enough to
        // override activeReportId — that's how "system design" bled in when talking
        // about a CS Fundamentals conversation.
        const blockedByExplicitType = explicitTypeHint !== null && explicitTypeHint !== undefined;
        if (!blockedByExplicitType) {
            const active = await prisma.evaluationReport.findFirst({
                where: {
                    userId,
                    OR: [{ id: activeReportId }, { sessionId: activeReportId }],
                },
                include: {
                    session: {
                        select: { id: true, type: true, role: true, level: true },
                    },
                },
                orderBy: { generatedAt: "desc" },
            });

            if (active) {
                return {
                    selectedReport: active,
                    candidates: [active],
                    disambiguationRequired: false,
                    confidence: "high" as const,
                };
            }
        }
    }

    const selectedReport = candidates[0] || reports[0] || null;

    // Only ask for disambiguation when the user gave a specific hint (score or date)
    // that still leaves multiple candidates. A type-only hint ("system design") should
    // silently resolve to the most recent matching report — the user is not asking for
    // a specific session, they just want to talk about that interview type.
    const disambiguationRequired =
        !hasRecentHint &&
        candidates.length > 1 &&
        scoreHint !== null; // type-only narrowing is not enough reason to disambiguate

    return {
        selectedReport,
        candidates: candidates.slice(0, 5),
        disambiguationRequired,
        confidence: disambiguationRequired ? ("medium" as const) : ("high" as const),
    };
}

function buildFallbackActionPlan(rubricScores: Array<{ category: string; score: number }>): ActionPlan {
    const weakest = rubricScores
        .slice()
        .sort((a, b) => a.score - b.score)
        .slice(0, 2);

    return {
        strengths: ["Consistency", "Interview structure awareness"],
        weakAreas: weakest.map((item) => ({
            category: item.category || "communication",
            score: Math.round(item.score || 0),
            why: "This category scored lower compared to your other rubric areas.",
            actionItems: [
                "Practice one targeted answer daily with STAR framing.",
                "Track measurable outcomes in each response.",
            ],
        })),
        overallSummary: "Use focused, repeated drills on low-scoring categories to improve consistency.",
        priorityFocus: weakest[0]?.category || "communication",
        practiceQuestionCount: 4,
        dailyPlan: [
            { day: 1, focus: "Primary weak area drill", questionCount: 2 },
            { day: 2, focus: "Secondary weak area drill", questionCount: 2 },
        ],
    };
}

function buildUiDirectives(message: string, reportId: string): TutorUiDirective[] {
    const text = message.toLowerCase();
    const directives: TutorUiDirective[] = [];

    // action-plan panel
    if (/action[\s_-]*plan|road[\s_-]*map|focus[\s_-]*areas?|improvement[\s_-]*plan|what\s+should\s+i\s+(work|focus|improve|practice|do)|where\s+(do\s+i|should\s+i)\s+(improve|focus|work|start)|weak(er)?\s+areas?|coaching[\s_-]*plan|study[\s_-]*plan|prep[\s_-]*plan|build\s+(me\s+)?(a\s+)?(study|action|prep|coaching|improvement)\s+plan|how\s+(can|do|should)\s+i\s+(improve|get\s+better|prepare)|what\s+(to|should\s+i)\s+(work\s+on|focus\s+on|improve|practice)|next\s+steps?|improvement\s+areas?|help\s+me\s+improve|where\s+to\s+(start|focus|improve)|what\s+are\s+my\s+weak|priorit(y|ize)\s+(focus|areas?)|get\s+better\s+at|make\s+(me\s+)?(a\s+)?(plan|roadmap|schedule)/.test(text)) {
        directives.push({ panel: "action-plan", reason: "User asked for coaching plan", payload: { reportId } });
    }

    // questions panel
    if (/question[\s_-]*sheet|practice[\s_-]*sheet|\bquiz\b|\bdrill(s)?\b|practice\s+questions?|give\s+me\s+(a\s+)?(set\s+of\s+)?(question|problem)s?|set\s+of\s+questions?|questions?\s+(that\s+(can|will)|to\s+help|for\s+me|on\s+these|on\s+this|for\s+these|related\s+to|about|covering)|can\s+you\s+(give|provide|suggest)\s+(me\s+)?(some\s+|a\s+set\s+of\s+|a\s+few\s+)?questions?|let('?s)?\s+practice|start\s+(a\s+)?(drill|quiz|practice)|more\s+questions?|next\s+question|practice\s+problem|questions?\s+(to\s+)?(improve|work\s+on|focus\s+on|help\s+me)|help\s+me\s+(with\s+)?(practice|questions?|preparing)|suggest\s+(some\s+)?questions?|questions?\s+for\s+(practice|improvement|these\s+topics?|this\s+topic)|i\s+want\s+to\s+practice|want\s+(some\s+)?questions?/.test(text)) {
        directives.push({ panel: "questions", reason: "User asked for practice questions", payload: { reportId } });
    }

    // report panel
    if (/\breport\b|\brubric\b|overall[\s_-]*score|my\s+score|how\s+(did\s+i\s+do|was\s+my|did\s+i\s+perform)|performance\s+(review|summary|breakdown|report)|score\s+breakdown|what\s+(was|were)\s+my\s+(score|result|mark|grade|rating)|show\s+me\s+my\s+(score|result|report|performance)|interview\s+result|my\s+result|my\s+performance|how\s+i\s+did|what\s+did\s+i\s+get|my\s+marks?|my\s+grades?/.test(text)) {
        directives.push({ panel: "report", reason: "User asked for report details", payload: { reportId } });
    }

    return directives.slice(0, 2);
}

function formatToolContextForPrompt(toolData: Record<string, unknown>): string {
    try {
        const serialized = JSON.stringify(toolData);
        return serialized.length > 12000 ? `${serialized.slice(0, 12000)}...` : serialized;
    } catch {
        return "{}";
    }
}

function buildTutorSystemPromptV2(input: {
    reportSummary: {
        type: string;
        date: string;
        overallScore: number;
        role: string;
        level: string;
        moduleConfigSummary?: string;
        rubricScores: Array<{ category: string; score: number }>;
        competencyScores?: Array<{
            id: string;
            label: string;
            score: number;
            strength: string;
            evidence: string;
            tip: string;
        }>;
    };
    transcript: string;
    actionPlan: ActionPlan;
    questionSheet: TutorQuestion[];
    coveredQuestions: string[];
    toolData: Record<string, unknown>;
}) {
    return `You are a personalized interview tutor with retrieval context.

ACTIVE REPORT CONTEXT (this is the interview the user is currently asking about)
- Type: ${input.reportSummary.type}
- Date: ${input.reportSummary.date}
- Overall score: ${input.reportSummary.overallScore}/100
- Role: ${input.reportSummary.role}
- Level: ${input.reportSummary.level}
- Modular configuration: ${input.reportSummary.moduleConfigSummary || "default"}
- Rubric scores: ${JSON.stringify(input.reportSummary.rubricScores)}
- Behavioural competency scores: ${JSON.stringify(input.reportSummary.competencyScores || [])}

  TRANSCRIPT CONTEXT
  ${input.transcript || "No stage transcript loaded for this turn. Use report data unless TOOL RETRIEVAL CONTEXT includes get_report_stage_transcript_context."}

ACTION PLAN
${JSON.stringify(input.actionPlan)}

QUESTION SHEET
${JSON.stringify(input.questionSheet)}

ALREADY COVERED QUESTION IDS
${JSON.stringify(input.coveredQuestions)}

TOOL RETRIEVAL CONTEXT (authoritative)
${formatToolContextForPrompt(input.toolData)}

OPERATING RULES
  - Ground answers in the retrieval context above. If data is missing, say so clearly.
  - Always answer from report data first. Do not request or imply full transcript access.
  - Use stage transcript data only when TOOL RETRIEVAL CONTEXT includes get_report_stage_transcript_context.
  - For "review the whole interview" or broad "how did I do" questions, use report summary/rubrics and do not claim you read the full transcript.
  - Never expose internal question IDs. Use question titles and categories only.
- Keep responses concise and actionable.
- Use markdown with short sections when useful.
- For coaching responses, prefer: Summary, Key Gaps, Next 3 Actions.
- This is text chat only. Ask user to type responses.
- Never emit [TOOL_CALL:*] tags.
- Never invent numbers. Any count, percentage, ratio, or trend delta MUST come from TOOL RETRIEVAL CONTEXT values.
- If numeric data is missing or uncertain, explicitly say "I don't have verified numbers in retrieval data".
- Never repeat a question whose ID appears in ALREADY COVERED QUESTION IDS unless the user explicitly asks to revisit it.
- When QUESTION SHEET entries are relevant, use each question's whatWeAreLookingFor field as the scoring/evaluation criteria.
  - For interview count/ratio questions, prefer get_user_report_trend.typeDistribution and get_user_report_trend.queryMeta.
- CROSS-TYPE QUESTIONS: When the user asks about focus areas, weak areas, or improvement WITHOUT specifying a particular interview type, and get_user_report_trend data is present in TOOL RETRIEVAL CONTEXT, use that trend data as the PRIMARY source. Do NOT limit your answer to just the single resolved report type. Synthesize across all interview types shown in the trend data.
- SINGLE-TYPE QUESTIONS: When the user explicitly asks about a specific interview type (e.g. "my system design interview", "my coding round"), focus on that type's data only.
- REPORT DATA IS ALWAYS AVAILABLE: When get_report_summary is present in TOOL RETRIEVAL CONTEXT, that IS the data for the resolved report. Never say "I don't have data" when get_report_summary is present — use it. The report type and date are in get_report_summary.report.type and get_report_summary.report.generatedAt.
- If get_session_question_detail.sessionMetrics is present, use those timing and pace signals when giving interview feedback.
- If get_accepted_action_plan.hasActivePlan is true AND the user is NOT explicitly asking to build/generate/create a new plan, reference the existing plan instead of generating a new one. If the user explicitly asks to build a new plan, generate it and tell them it's open in the action plan panel.
- When you generate or reference an action plan, always tell the user: "Your action plan is open in the panel — review it and click Accept & Save to activate it on your dashboard."
- When the user asks for practice questions or a question set, do NOT list questions inline. Tell them their question sheet is open in the panel on the right.
- When you create a quiz via create_quiz, do NOT say "panel" — just mention the quiz briefly (e.g., "I've created a quiz on X"). The UI will automatically show a clickable card below your message.
- When the user asks for their action plan, do NOT reproduce the full plan inline. Summarise the top 2-3 focus areas briefly.
- End with a short "Sources" line referencing the report date/type or retrieved datasets you used.
`;
}

function buildTutorLightweightSystemPrompt(input: {
    coveredQuestions: string[];
    toolData: Record<string, unknown>;
}) {
    return `You are a personalized interview tutor.

TOOL RETRIEVAL CONTEXT (authoritative)
${formatToolContextForPrompt(input.toolData)}

ALREADY COVERED QUESTION IDS
${JSON.stringify(input.coveredQuestions)}

OPERATING RULES
- Answer from the chat conversation first, and use TOOL RETRIEVAL CONTEXT only when it contains relevant verified data.
- No verified per-report context was loaded for this turn unless TOOL RETRIEVAL CONTEXT explicitly includes it.
- If the user asks for exact report, score, transcript, or interview-specific numbers that are not present in TOOL RETRIEVAL CONTEXT, say that you need that interview context instead of guessing.
- Keep responses concise, practical, and actionable.
- This is text chat only. Ask the user to type responses.
- Never invent numbers. Any count, percentage, ratio, or trend delta must come from TOOL RETRIEVAL CONTEXT.
- Never repeat a question whose ID appears in ALREADY COVERED QUESTION IDS unless the user explicitly asks to revisit it.
- If get_session_question_detail.sessionMetrics is present, use those timing and pace signals in your coaching.
- End with a short Sources line only when you actually used TOOL RETRIEVAL CONTEXT.
`;
}

function buildSourceLine(
    toolData: Record<string, unknown>,
    reportContext?: { type: string; date: string } | null
): string {
    const keys = Object.keys(toolData || {});
    const sourceBits: string[] = [];
    if (reportContext?.type && reportContext?.date) {
        sourceBits.push(`${reportContext.type} report (${reportContext.date})`);
    }
    if (keys.includes("get_user_report_trend")) {
        const trendMeta = (toolData.get_user_report_trend as any)?.queryMeta;
        if (trendMeta) {
            const metaBits: string[] = [];
            if (trendMeta.typeFilter) metaBits.push(`type=${trendMeta.typeFilter}`);
            if (trendMeta.requestedTimespanDays) metaBits.push(`window=${trendMeta.requestedTimespanDays}d`);
            if (trendMeta.includeAll) metaBits.push("window=all_time");
            metaBits.push(`count=${Number(trendMeta.returnedCount) || 0}`);
            sourceBits.push(`report trend (${metaBits.join(", ")})`);
        } else {
            sourceBits.push("report trend");
        }
    }
    if (keys.includes("get_question_activity_snapshot")) sourceBits.push("question activity snapshot");
    if (keys.includes("get_sheet_status_for_report")) sourceBits.push("question sheet status");
    if (keys.includes("get_report_stage_transcript_context")) sourceBits.push("stage transcript excerpt");
    if (keys.includes("get_session_question_detail")) sourceBits.push("session question detail");
    if (sourceBits.length === 0) return "";
    return `Sources: ${sourceBits.join(", ")}.`;
}

function buildCoachingFocusHint(interviewType: string): string {
    const t = interviewType.toLowerCase();
    if (t === "system_design")
        return "Focus on system design skills: scalability, architecture decisions, trade-offs, CAP theorem, database choices, API design, and observability.";
    if (t === "cs_fundamentals")
        return "Focus on CS fundamentals: OS, networking, OOP, database concepts, and core theoretical knowledge.";
    if (t === "sql")
        return "Focus on SQL skills: query writing, joins, indexing, query optimisation, and database schema design.";
    if (t === "behavioural" || t === "behavioral")
        return "Focus on behavioural coaching: STAR storytelling quality, ownership language, measurable outcomes, and leadership signals.";
    if (t === "full_interview")
        return "This was a full interview covering both technical coding and behavioural questions. Address both dimensions.";
    // coding / DSA / default
    return "Focus on coding skills: problem-solving approach, algorithm choice, time/space complexity, code quality, and handling edge cases.";
}

/**
 * Returns a strict enumerated list of allowed category values for weakAreas[].category
 * per interview type, matching the exact MongoDB field values used in our collections.
 * This prevents free-form LLM output from breaking buildDbBackedSheetQuestions queries.
 */
function getWeakAreaEnum(interviewType: string): string {
    const t = interviewType.toLowerCase();

    if (t === "coding" || t === "dsa") {
        return `The ONLY allowed category values are exact MongoDB topic names:
"Array", "Sorting", "Math", "Dynamic Programming", "Hash Table", "Tree", "Depth-First Search",
"Binary Tree", "Backtracking", "Heap (Priority Queue)", "Quickselect", "Design", "Bit Manipulation",
"Matrix", "Breadth-First Search", "Binary Search", "Greedy", "Divide and Conquer", "Linked List",
"Doubly-Linked List", "Segment Tree", "Number Theory", "Sliding Window", "Prefix Sum",
"Stack", "Monotonic Stack", "Ordered Set".
Use the EXACT strings from this list — casing matters.`;
    }

    if (t === "cs_fundamentals") {
        return `The ONLY allowed category values are the exact MongoDB topic codes:
"OS", "CN", "DBMS", "OOPS".
Use the EXACT strings — casing matters. Do NOT use "Operating Systems", "Networking", "OOP", or any other variant.`;
    }

    if (t === "system_design") {
        return `Use descriptive skill labels such as: "scalability", "database_design", "caching", "load_balancing", "api_design", "reliability", "observability". These are free-form but keep them concise and lowercase_with_underscores.`;
    }

    if (t === "full_interview") {
        return `Mix DSA topics and CS fundamentals topics as relevant. For DSA topics use exact MongoDB topic names (see coding type). For CS theory topics use exact codes: "OS", "CN", "DBMS", "OOPS".`;
    }

    // behavioural or unknown — free-form is fine, no DB lookup
    return `Use concise skill labels relevant to behavioural interviews (e.g. "STAR storytelling", "ownership", "communication", "leadership"). These are free-form.`;
}

function enforceActionPlanScope(actionPlan: ActionPlan, interviewType: string): ActionPlan {
    const t = interviewType.toLowerCase();

    if (t === "system_design") {
        const allowed = new Set([
            "scalability",
            "database_design",
            "caching",
            "load_balancing",
            "api_design",
            "reliability",
            "observability",
        ]);

        actionPlan.weakAreas = (actionPlan.weakAreas || []).map((w) => {
            const normalized = String(w.category || "").trim().toLowerCase().replace(/\s+/g, "_");
            return {
                ...w,
                category: allowed.has(normalized) ? normalized : "scalability",
            };
        });

        const priority = String(actionPlan.priorityFocus || "").trim().toLowerCase().replace(/\s+/g, "_");
        actionPlan.priorityFocus = allowed.has(priority)
            ? priority
            : (actionPlan.weakAreas[0]?.category || "scalability");

        return actionPlan;
    }

    if (t === "cs_fundamentals") {
        const mapToCs = (value: string): string => {
            const v = String(value || "").toLowerCase();
            if (/\bdb(ms)?\b|database|sql|rdbms|relational/.test(v)) return "DBMS";
            if (/\bos\b|operating\s+system|process(es)?|thread|memory\s+management|kernel|scheduling|deadlock/.test(v)) return "OS";
            if (/\bcn\b|network(ing)?|tcp|http|dns|socket|protocol|osi|bandwidth|latency/.test(v)) return "CN";
            return "OOPS";
        };

        actionPlan.weakAreas = (actionPlan.weakAreas || []).map((w) => ({
            ...w,
            category: mapToCs(w.category),
        }));
        actionPlan.priorityFocus = mapToCs(actionPlan.priorityFocus);
        return actionPlan;
    }

    if (t === "sql") {
        actionPlan.weakAreas = (actionPlan.weakAreas || []).map((w) => ({ ...w, category: "sql" }));
        actionPlan.priorityFocus = "sql";
        return actionPlan;
    }

    return actionPlan;
}

async function generateActionPlanBundle(
    context: Awaited<ReturnType<typeof fetchReportContext>>,
    timespan: ActionPlanTimespan,
    customizationPrompt?: string
): Promise<{ actionPlan: ActionPlan; openingMessage: string }> {
    if (!context) throw new Error("Missing report context");

    const { report, rubricScores, transcript } = context;
    const coachingFocus = buildCoachingFocusHint(report.session.type);
    const timespanHint = getTimespanPromptHint(timespan);
    const customizationNote = String(customizationPrompt || "").trim().slice(0, 1200);

    const prompt = `You are an expert interview coach. Analyze this interview report and transcript.
Return strict JSON only.

Schema:
{
  "strengths": ["string"],
  "weakAreas": [
    {
      "category": "string",
      "score": 0-10,
      "why": "string",
      "actionItems": ["string", "string"]
    }
  ],
  "overallSummary": "string",
  "priorityFocus": "string",
    "practiceQuestionCount": 1,
    "dailyPlan": [
        {
            "day": 1,
            "focus": "string",
            "questionCount": 1
        }
    ],
  "openingMessage": "string"
}

Coaching focus for this interview type:
${coachingFocus}

Constraints:
- weakAreas must reflect skills relevant to the interview type above, NOT generic soft skills unless this is a behavioural interview.
- category values in weakAreas MUST follow this strict rule for this interview type:
${getWeakAreaEnum(report.session.type)}
- If user customization asks for topics outside this interview type (example: OS questions in a system design interview), ignore those out-of-scope requests and keep the plan strictly in-domain.
- Timespan requirement: ${timespanHint}
- practiceQuestionCount must be an integer from 1 to 9 inclusive.
- dailyPlan must spread the practiceQuestionCount across the requested timespan with no more than 2 questions per day.
- dailyPlan should use the interview categories relevant to the report type and weak areas.
- Prefer spacing the work across multiple days instead of clustering too many questions on one day.
- Keep action items practical, domain-specific, and immediately actionable.
- openingMessage must be 2-4 sentences, direct and encouraging, mentioning the interview type.
- This is a text chat. Never use voice-style wording such as "I'm listening" or ask the user to speak aloud.
- If you ask for practice, ask the user to type their response in chat.

DATA
Interview type: ${report.session.type}
Role: ${report.session.role}
Level: ${report.session.level}
Overall score: ${Number(report.overallScore)}
Requested timespan: ${getTimespanLabel(timespan)}
Rubric scores: ${JSON.stringify(rubricScores)}
Transcript:
${transcript || "No transcript available."}

${customizationNote ? `USER CUSTOMIZATION REQUEST (must be incorporated into the action plan while preserving schema/constraints):\n${customizationNote}` : ""}
`;

    const result = await getGeminiClient().models.generateContent({
        model: GEMINI_PRO_MODEL,
        contents: prompt,
        config: {
            systemInstruction: "Return only valid JSON.",
            responseMimeType: "application/json" as const,
            thinkingConfig: GEMINI_THINKING_HIGH,
        },
    });

    const content = result.text ?? "{}";
    const parsed = safeExtractJson(content);
    const actionPlan = enforceActionPlanScope(parseActionPlan(parsed, rubricScores), report.session.type);

    const practiceQuestionCount = Math.max(1, Math.min(9, actionPlan.practiceQuestionCount || 6));
    const questionSheet = await generateQuestionSheet(context, actionPlan, practiceQuestionCount);
    const dailyPlanSource = actionPlan.dailyPlan && actionPlan.dailyPlan.length > 0
        ? actionPlan.dailyPlan
        : Array.from({ length: getTimespanDays(timespan) })
            .slice(0, Math.min(getTimespanDays(timespan), Math.max(1, Math.ceil(practiceQuestionCount / 2))))
            .map((_, idx) => ({
                day: idx + 1,
                focus: idx === 0 ? formatCategoryLabel(actionPlan.priorityFocus) : `Practice day ${idx + 1}`,
                questionCount: idx === practiceQuestionCount - 1 && practiceQuestionCount % 2 === 1 ? 1 : 2,
            }));

    const normalizedDailyPlan: NonNullable<ActionPlan["dailyPlan"]> = [];
    let remaining = questionSheet.length;
    for (const item of dailyPlanSource) {
        if (remaining <= 0) break;
        const count = Math.max(1, Math.min(2, item.questionCount));
        normalizedDailyPlan.push({
            day: item.day,
            focus: item.focus,
            questionCount: Math.min(count, remaining),
        });
        remaining -= Math.min(count, remaining);
    }
    if (remaining > 0 && normalizedDailyPlan.length > 0) {
        for (let i = 0; i < remaining; i++) {
            const idx = i % normalizedDailyPlan.length;
            if (normalizedDailyPlan[idx]) {
                normalizedDailyPlan[idx].questionCount = Math.min(2, normalizedDailyPlan[idx].questionCount + 1);
            }
        }
    }

    actionPlan.practiceQuestionCount = questionSheet.length;
    actionPlan.dailyPlan = normalizedDailyPlan;
    actionPlan.plannedDays = buildPlannedDays(questionSheet, normalizedDailyPlan, questionSheet.length);

    const openingMessage =
        typeof parsed?.openingMessage === "string" && parsed.openingMessage.trim()
            ? parsed.openingMessage.trim()
            : `I reviewed your latest ${report.session.type.replace(/_/g, " ")} interview. You showed strength in ${actionPlan.strengths[0] || "several areas"}, and your priority focus should be ${formatCategoryLabel(actionPlan.priorityFocus)}. Type your response in chat and I’ll guide you from there.`;

    return { actionPlan, openingMessage };
}

async function generateQuestionSheet(
    context: Awaited<ReturnType<typeof fetchReportContext>>,
    actionPlan: ActionPlan,
    limitOverride?: number
): Promise<TutorQuestion[]> {
    if (!context) return [];

    const weakAreaLabels = Array.from(
        new Set(actionPlan.weakAreas.map((w) => w.category))
    ).filter(Boolean);

    const desiredLimit = Math.max(1, Math.min(9, Math.floor(limitOverride || actionPlan.practiceQuestionCount || 6)));

    let dbQuestions = await buildDbBackedSheetQuestions({
        sessionType: context.report.session.type,
        weakAreas: weakAreaLabels,
        level: context.report.session.level,
        limit: desiredLimit,
    });
    
    // DB-only fallback attempt using broad matching.
    if (!dbQuestions.length) {
        dbQuestions = await buildDbBackedSheetQuestions({
            sessionType: context.report.session.type,
            weakAreas: [],
            level: context.report.session.level,
            limit: desiredLimit,
        });
    }

    return dbQuestions.map(q => ({
        id: q.id,
        prompt: q.question, // map DB schema 'question' to Tutor schema 'prompt'
        whatWeAreLookingFor: q.whatWeAreLookingFor,
        category: normalizeQuestionCategory(q.category),
        difficulty: (q.difficulty.toLowerCase() === "hard" ? "hard" : q.difficulty.toLowerCase() === "easy" ? "easy" : "medium") as any,
        problemSlug: q.problemSlug,
    }));
}

function buildTutorSystemPrompt(input: {
    reportSummary: {
        type: string;
        date: string;
        overallScore: number;
        role: string;
        level: string;
        moduleConfigSummary?: string;
        rubricScores: Array<{ category: string; score: number }>;
        competencyScores?: Array<{
            id: string;
            label: string;
            score: number;
            strength: string;
            evidence: string;
            tip: string;
        }>;
    };
    transcript: string;
    actionPlan: ActionPlan;
    questionSheet: TutorQuestion[];
    recentReports: any[];
    coveredQuestions: string[];
    hasSavedSheet: boolean;
}) {
    const historyText = input.recentReports
        .slice(0, 4)
        .map((r, idx) => {
            const weakest = Array.isArray(r.rubricScores)
                ? (r.rubricScores as any[])
                      .map((x) => ({ category: String(x.category || "general"), score: Number(x.score) || 0 }))
                      .sort((a, b) => a.score - b.score)
                      .slice(0, 2)
                      .map((x) => x.category)
                      .join(", ")
                : "n/a";
            return `- Interview ${idx + 1}: ${r.session?.type || "unknown"} | Score: ${Math.round(Number(r.overallScore) || 0)} | Weakest: ${weakest}`;
        })
        .join("\n");

    const sheetInstruction = input.hasSavedSheet
        ? "- The user already has a saved sheet for this report. Do NOT tell them to click \"Regenerate Questions\". Instead, guide them to continue drills from the current question sheet or open it from My Sheets."
        : "- When the user asks for different or new practice questions, do NOT generate custom problems in the chat. Instead, tell them to click the \"Regenerate Questions\" button in the panel on the right to get a fresh set. Respond with [TOOL_CALL:question_sheet] so the panel stays visible.";

    return `You are a personalized interview tutor. Be direct, practical, and encouraging.

STUDENT CONTEXT
- Type: ${input.reportSummary.type}
- Date: ${input.reportSummary.date}
- Overall score: ${input.reportSummary.overallScore}/100
- Role: ${input.reportSummary.role}
- Level: ${input.reportSummary.level}
- Modular configuration: ${input.reportSummary.moduleConfigSummary || "default"}
- Rubric scores: ${JSON.stringify(input.reportSummary.rubricScores)}
- Behavioural competency scores: ${JSON.stringify(input.reportSummary.competencyScores || [])}

INTERVIEW HISTORY
${historyText || "- No prior history available"}

  LATEST TRANSCRIPT
  ${input.transcript || "No transcript loaded. Use report data for broad reviews."}

ACTION PLAN
${JSON.stringify(input.actionPlan)}

QUESTION SHEET
${JSON.stringify(input.questionSheet)}

QUESTION SHEET STATUS
- Saved to My Sheets for this report: ${input.hasSavedSheet ? "yes" : "no"}

ALREADY COVERED QUESTION IDS
${JSON.stringify(input.coveredQuestions)}

OPERATING RULES
- If user says quiz/drill/practice, ask one question from question sheet not in covered list.
- Mark question with prefix: [QUESTION_CARD|<id>|<category>]
- If giving structured answer review, prefix: [FEEDBACK_CARD]
- This is a text-only chat. Do not say "I'm listening" or imply voice conversation; ask the user to type their answer in chat.
- Keep responses concise and actionable.
- Use clean markdown structure when helpful: short headings, numbered steps, and bullet points.
- Avoid long dense paragraphs; keep each paragraph to 1-3 lines.
- For analysis answers, prefer this structure: Summary, Key Issues, Improved Version, Next Practice Task.
  - Reference concrete transcript moments only when stage transcript context was explicitly loaded.
  - For broad interview reviews, use report/rubric data instead of transcript.
  - Never expose internal question IDs. Use question titles and categories only.
- ${sheetInstruction}
- Never fabricate achievements for the user.

TOOL CALLS
When the user's intent matches one of the following panel actions, prepend the exact tag on its own line BEFORE your response text:
- User asks to see their action plan, coaching plan, improvement areas, or what to focus on → prepend: [TOOL_CALL:action_plan]
- User asks to generate, view, or create a practice sheet, question sheet, or quiz bank → prepend: [TOOL_CALL:question_sheet]
- User asks to see their report summary, overall score, rubric breakdown, or full performance review → prepend: [TOOL_CALL:report]
Emit at most ONE tool call per response. The tag is automatically hidden from the user — it opens a side panel alongside your chat response.
`;
}

/**
 * Generates a fast, template-based opening message from report data.
 * No LLM call — returns in microseconds.
 * Used as the instant first message while the full plan generates in background.
 */
function generateInstantOpeningMessage(context: NonNullable<Awaited<ReturnType<typeof fetchReportContext>>>): string {
    const { report, rubricScores } = context;
    const typeLabel = report.session.type.replace(/_/g, " ");
    const score = Math.round(Number(report.overallScore) || 0);
    const role = report.session.role || "Software Engineer";
    
    // Find weakest area
    const weakest = [...rubricScores].sort((a, b) => a.score - b.score)[0];
    const weakestLabel = weakest ? formatCategoryLabel(weakest.category) : null;
    
    // Find strongest area  
    const strongest = [...rubricScores].sort((a, b) => b.score - a.score)[0];
    const strongestLabel = strongest ? formatCategoryLabel(strongest.category) : null;

    if (score >= 80) {
        return `Great performance on your ${typeLabel} interview for ${role}! You scored ${score}/100${strongestLabel ? `, with particular strength in ${strongestLabel}` : ""}. I'm analyzing your results to build a personalized coaching plan — it'll be ready shortly. Type a message to get started or ask me anything about your interview.`;
    } else if (score >= 60) {
        return `I've reviewed your ${typeLabel} interview for ${role}. You scored ${score}/100${weakestLabel ? ` — we'll focus on improving ${weakestLabel}` : ""}. I'm preparing your personalized action plan now. Feel free to start chatting while it loads!`;
    } else {
        return `I've reviewed your ${typeLabel} interview for ${role}. You scored ${score}/100 — there's clear room for improvement and I'm here to help. I'm building your personalized coaching plan now. Start by telling me what felt hardest during the interview!`;
    }
}

// ─────────────────────────────────────────────────────────────────
// Agent V2 branch — runs the agentic Gemini-function-calling loop.
// Flag-gated by TUTOR_AGENT_V2=true; legacy path is the default.
// ─────────────────────────────────────────────────────────────────

async function runAgentV2Branch(input: {
    request: any;
    reply: any;
    userId: string;
    conversation: { id: string; reportId: string | null } | null;
    message: string;
    chatHistory?: Array<{ role?: "user" | "assistant"; content?: string } | undefined>;
    activeReportId: string | null;
}): Promise<void> {
    const { request, reply, userId, conversation, message, chatHistory, activeReportId } = input;

    // Rough token accounting — output is harder to estimate, so flat-budget +1500.
    recordTokenUsage(userId, "tutor_tokens", tutorEstimateTokens(message, chatHistory) + 1500)
        .catch((e) => request.log.error(e, "tutor token recording failed"));

    const history: AgentInputMessage[] = (chatHistory || [])
        .filter(
            (m): m is { role: "user" | "assistant"; content: string } =>
                Boolean(m) && (m.role === "user" || m.role === "assistant") && typeof m.content === "string"
        )
        .slice(-20); // recent context only

    const systemPrompt = buildAgentSystemPrompt({
        activeReportHint: activeReportId,
        nowIso: new Date().toISOString(),
    });

    reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": request.headers.origin || "http://localhost:3000",
        "Access-Control-Allow-Credentials": "true",
    });

    const send = (payload: any) => {
        reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    send({ type: "meta", agent: "v2", conversationId: conversation?.id ?? null });

    let fullAssistantText = "";
    let toolCallCount = 0;
    let iterations = 0;
    let sawArtifactCreated = false;
    let sawClarificationRequested = false;

    const isSimpleGreeting = /^(hi|hello|hey|thanks|thank you|sup|morning|evening|afternoon)\b/i.test(message.trim());
    const isShort = message.trim().length < 30;

    try {
        const forcedActionPlanArgs = parseActionPlanClarificationReply(message);
        if (message.trim().startsWith("[clarify:") && forcedActionPlanArgs) {
            iterations = 1;
            send({ type: "agent_turn", iteration: iterations });
            send({
                type: "agent_thought",
                text: "Using your answers to draft the plan now.",
                iteration: iterations,
            });

            const callId = `clarify_plan_${Date.now().toString(36)}`;
            send({
                type: "tool_call_started",
                callId,
                tool: "propose_action_plan",
                label: AGENT_TOOL_LABELS.propose_action_plan,
            });

            const result = await executeAgentTool(userId, "propose_action_plan", forcedActionPlanArgs);
            toolCallCount = 1;

            send({
                type: "tool_call_completed",
                callId,
                tool: "propose_action_plan",
                ok: result.ok,
                latencyMs: result.latencyMs,
                ...(result.errorCode ? { errorCode: result.errorCode } : {}),
            });

            if (!result.ok) {
                send({ type: "error", message: result.errorMessage || "Failed to draft action plan" });
            } else {
                const data = (result.data ?? {}) as Record<string, unknown>;
                const artifactId =
                    typeof data.draftId === "string"
                        ? data.draftId
                        : typeof data.artifactId === "string"
                            ? data.artifactId
                            : null;
                const title = typeof data.title === "string" ? data.title : "Action Plan";

                if (artifactId) {
                    send({
                        type: "artifact_created",
                        artifactId,
                        artifactType: typeof data.type === "string" ? data.type : "action_plan",
                        title,
                        summary: typeof data.summary === "string" ? data.summary : null,
                        isDraft: data.isDraft === true,
                    });
                }

                fullAssistantText =
                    "Your draft action plan is ready. Open it to review, and click Approve & Save when it looks right.";
                send({ type: "token", text: fullAssistantText });
                send({ type: "done", toolCallCount, iterations });
            }

            if (conversation) {
                const persistedReportId = activeReportId || conversation.reportId || null;
                const rows = [
                    { userId, conversationId: conversation.id, reportId: persistedReportId, role: "user", content: message },
                    ...(fullAssistantText.trim()
                        ? [{ userId, conversationId: conversation.id, reportId: persistedReportId, role: "assistant", content: fullAssistantText }]
                        : []),
                ];
                Promise.all([
                    prisma.tutorChatMessage.createMany({ data: rows }),
                    updateTutorConversationAfterMessage({
                        userId,
                        conversationId: conversation.id,
                        reportId: persistedReportId,
                        titleHint: message,
                    })
                ]).then(() => {
                    if (persistedReportId) {
                        enforceTutorChatRetention(persistedReportId).catch(() => {});
                    }
                }).catch(e => request.log.error(e, "tutor forced action-plan persist failed"));
            }

            return;
        }

        if (isSimpleGreeting && isShort) {
            const stream = await getGeminiClient().models.generateContentStream({
                model: GEMINI_MODEL,
                contents: [
                    ...history.map((m) => ({ role: m.role === "assistant" ? "model" as const : "user" as const, parts: [{ text: m.content }] })),
                    { role: "user", parts: [{ text: message }] },
                ],
                config: {
                    systemInstruction: "You are Mockr's AI Tutor. The user is just saying hi or thanks. Reply very briefly (1-2 sentences max) and conversationally, asking how you can help them prepare for interviews today.",
                },
            });

            for await (const chunk of stream) {
                const delta = chunk.text;
                if (delta) {
                    fullAssistantText += delta;
                    send({ type: "token", text: delta });
                }
            }
            send({ type: "done", toolCallCount: 0, iterations: 1 });
        } else {
            const THINKING_WORDS = [
                "Analyzing…",
                "Connecting dots…",
                "Reflecting…",
                "Formulating…",
                "Synthesizing…",
                "Evaluating…",
                "Strategizing…",
                "Contemplating…",
                "Processing…",
                "Deliberating…",
                "Examining…",
                "Investigating…",
                "Brainstorming…",
                "Orchestrating…",
                "Calibrating…",
                "Optimizing…",
                "Architecting…",
                "Decoding…",
                "Mapping…",
                "Crafting response…"
            ];
            send({ type: "thinking_phase", words: THINKING_WORDS });

            for await (const event of runTutorAgent({
                userId,
                conversationId: conversation?.id ?? null,
                message,
                history,
                systemPrompt,
            })) {
            switch (event.type) {
                case "agent_turn":
                    iterations = event.iteration;
                    send({ type: "agent_turn", iteration: event.iteration });
                    break;
                case "tool_call_started":
                    send({
                        type: "tool_call_started",
                        callId: event.callId,
                        tool: event.tool,
                        label: AGENT_TOOL_LABELS[event.tool] || `Running ${event.tool}…`,
                    });
                    break;
                case "agent_thought":
                    send({
                        type: "agent_thought",
                        text: event.text,
                        iteration: event.iteration,
                    });
                    break;
                case "tool_call_completed":
                    send({
                        type: "tool_call_completed",
                        callId: event.callId,
                        tool: event.tool,
                        ok: event.ok,
                        latencyMs: event.latencyMs,
                        ...(event.errorCode ? { errorCode: event.errorCode } : {}),
                    });
                    break;
                case "artifact_created":
                    sawArtifactCreated = true;
                    send({
                        type: "artifact_created",
                        artifactId: event.artifactId,
                        artifactType: event.artifactType,
                        title: event.title,
                        summary: event.summary,
                        isDraft: event.isDraft,
                    });
                    break;
                case "artifact_committed":
                    send({
                        type: "artifact_committed",
                        artifactId: event.artifactId,
                        artifactType: event.artifactType,
                        title: event.title,
                    });
                    break;
                case "clarification_requested":
                    sawClarificationRequested = true;
                    send({
                        type: "clarification_requested",
                        context: event.context,
                        slots: event.slots,
                    });
                    break;
                case "token":
                    fullAssistantText += event.text;
                    send({ type: "token", text: event.text });
                    break;
                case "warning":
                    send({ type: "warning", code: event.code, message: event.message });
                    break;
                case "done":
                    toolCallCount = event.toolCallCount;
                    if (!fullAssistantText && event.finalText) {
                        fullAssistantText = event.finalText;
                        send({ type: "token", text: event.finalText });
                    } else if (!fullAssistantText) {
                        if (sawClarificationRequested) {
                            fullAssistantText =
                                "I need one quick detail before I draft this. Fill in the prompt below and I'll build it right away.";
                        } else if (sawArtifactCreated) {
                            fullAssistantText =
                                "Your draft is ready. Open it to review, and save it when it looks right.";
                        } else if (event.toolCallCount > 0) {
                            fullAssistantText =
                                "Got the data I need. Feel free to ask a follow-up or let me know what you'd like to do next.";
                        }

                        if (fullAssistantText) {
                            send({ type: "token", text: fullAssistantText });
                        }
                    }
                    send({ type: "done", toolCallCount, iterations });
                    break;
                case "error":
                    send({ type: "error", message: event.message });
                    break;
            }
        }
        }

        // Persist the user message + final assistant text (matches V1 behavior).
        if (conversation) {
            const persistedReportId = activeReportId || conversation.reportId || null;
            const rows = [
                { userId, conversationId: conversation.id, reportId: persistedReportId, role: "user", content: message },
                ...(fullAssistantText.trim()
                    ? [{ userId, conversationId: conversation.id, reportId: persistedReportId, role: "assistant", content: fullAssistantText }]
                    : []),
            ];
            // Fire-and-forget persistence to avoid blocking stream close
            Promise.all([
                prisma.tutorChatMessage.createMany({ data: rows }),
                updateTutorConversationAfterMessage({
                    userId,
                    conversationId: conversation.id,
                    reportId: persistedReportId,
                    titleHint: message,
                })
            ]).then(() => {
                if (persistedReportId) {
                    enforceTutorChatRetention(persistedReportId).catch(() => {});
                }
            }).catch(e => request.log.error(e, "tutor v2 persist failed"));
        }
    } catch (err: any) {
        send({ type: "error", message: err?.message || "Tutor agent failed" });
    } finally {
        reply.raw.end();
    }
}

const AGENT_TOOL_LABELS: Record<string, string> = {
    // Phase 2 — friendlier voice
    list_recent_reports: "Pulling up your recent interviews",
    get_report_summary: "Reading that interview report",
    get_report_stage_transcript_context: "Reading that stage transcript",
    get_session_question_detail: "Loading the questions from that interview",
    get_user_report_trend: "Tracking how your scores have moved",
    get_score_percentile: "Sizing up that score against your average",
    get_question_activity_snapshot: "Peeking at your practice rhythm",
    get_weak_areas: "Mapping the spots that keep tripping you up",
    get_recent_mistakes: "Replaying your most recent slip-ups",
    // Phase 3 — profile + memory
    get_user_profile: "Refreshing on what you're aiming for",
    update_user_profile: "Locking in those new goals",
    get_tutor_memories: "Bringing back what we've talked about before",
    save_memory: "Filing that away for next time",
    recall_relevant_memories: "Skimming our chat history for what's relevant",
    // Phase 3 — analytics
    update_weak_area_status: "Marking that one as on the mend",
    identify_patterns: "Hunting for patterns across your prep",
    compare_to_benchmark: "Stacking your recent runs against your baseline",
    // Phase 3 — catalog
    search_questions: "Sweeping the question bank",
    get_question: "Loading that problem",
    get_topic_guide: "Cracking open the topic primer",
    // Phase 3 — artifacts
    list_artifacts: "Checking what's already in your library",
    get_artifact: "Pulling that one back up",
    archive_artifact: "Tucking that into the archive",
    // Phase 3 — skills (legacy)
    create_question_sheet: "Putting together your practice sheet",
    create_action_plan: "Sketching out your action plan",
    create_quiz: "Cooking up your quiz",
    // Track 2 — combined context + domain knowledge
    get_user_context_pack: "Pulling your prep dashboard so I can ground this in real data",
    get_topic_mastery: "Gauging how solid you are on that topic",
    get_topic_progression: "Lining up the easy → hard ladder",
    get_company_blueprint: "Looking at how that company actually interviews",
    get_recent_question_history: "Checking what you've already tackled lately",
    get_calendar_context: "Glancing at your prep calendar",
    validate_artifact_quality: "Doing a quick sanity check before saving",
    // Track 1 — conversational propose / revise / commit
    propose_question_sheet: "Drafting a sheet you can react to",
    revise_question_sheet: "Reworking the sheet with your edits",
    propose_action_plan: "Sketching a plan for your review",
    revise_action_plan: "Reshaping the plan around your input",
    propose_quiz: "Putting a quiz together for you to try",
    revise_quiz: "Reworking the quiz",
    commit_artifact: "Saving this to your library",
    request_clarification: "One quick thing first",
};

export default async function tutorRoutes(fastify: FastifyInstance) {
    fastify.addHook("preHandler", fastify.authenticate);

    fastify.get("/users/me/tutor/history", async (request, reply) => {
        const userId = request.user!.id;

        // Rate limit: 30 history fetches per 10 min
        const rl = checkRateLimit(`tutor-history:${userId}`, 30, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({ message: `Rate limit reached. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.` });
        }

        const query = request.query as { reportId?: string; limit?: string | number; conversationId?: string };
        const reportId = typeof query.reportId === "string" ? query.reportId.trim() : "";
        const conversationId = typeof query.conversationId === "string" ? query.conversationId.trim() : "";

        const parsedLimit = Number(query.limit);
        const limit = Number.isFinite(parsedLimit)
            ? Math.max(1, Math.min(TUTOR_MESSAGE_RETENTION_LIMIT, Math.floor(parsedLimit)))
            : 80;

        if (!conversationId && !reportId) {
            return reply.status(400).send({ message: "conversationId or reportId is required" });
        }

        const rows = await prisma.tutorChatMessage.findMany({
            where: {
                userId,
                role: { in: ["user", "assistant"] },
                ...(conversationId && !isLegacyTutorConversationId(conversationId)
                    ? { conversationId }
                    : reportId
                        ? { reportId }
                        : {}),
            },
            orderBy: { createdAt: "desc" },
            take: limit,
            select: {
                id: true,
                conversationId: true,
                role: true,
                content: true,
                createdAt: true,
            },
        });

        const filteredRows = (conversationId
            ? rows.filter((row) => {
                const storedConversationId = extractTutorConversationIdFromContent(row.content);
                if (isLegacyTutorConversationId(conversationId)) {
                    return !storedConversationId;
                }
                return row.conversationId === conversationId || storedConversationId === conversationId;
            })
            : rows).slice().reverse();

        const messages = filteredRows.map((row) => ({
            id: row.id,
            role: row.role,
            content: extractTutorMessageText(row.content),
            createdAt: row.createdAt,
        }));

        reply.cacheControl("USER_SHORT");
        return { reportId: reportId || null, conversationId: conversationId || null, messages };
    });

    fastify.get("/users/me/tutor/conversations", async (request, reply) => {
        const userId = request.user!.id;
        const conversations = await listTutorConversations(userId);
        reply.cacheControl("USER_SHORT");
        return { conversations };
    });

    fastify.post("/users/me/tutor/conversations", async (request, reply) => {
        const parsed = z
            .object({
                reportId: z.string().min(1).optional(),
                title: z.string().min(1).max(120).optional(),
            })
            .safeParse(request.body);

        if (!parsed.success) {
            return reply.status(400).send({ message: "Invalid payload", details: parsed.error.flatten() });
        }

        const userId = request.user!.id;
        let reportId: string | null = null;
        if (parsed.data.reportId) {
            const report = await prisma.evaluationReport.findFirst({
                where: { id: parsed.data.reportId, userId },
                select: { id: true },
            });
            if (!report) {
                return reply.status(404).send({ message: "Report not found" });
            }
            reportId = report.id;
        }

        const existingCount = await prisma.tutorConversation.count({
            where: { userId },
        });
        const title = parsed.data.title?.trim() || buildTutorConversationTitle("Tutor", existingCount);

        const created = await prisma.tutorConversation.create({
            data: {
                userId,
                reportId,
                title,
                status: "active",
                lastMessageAt: new Date(),
            },
        });

        return {
            id: created.id,
            reportId: created.reportId,
            title: created.title,
            status: created.status,
            createdAt: created.createdAt.toISOString(),
            lastMessageAt: created.lastMessageAt.toISOString(),
            messageCount: 0,
        };
    });

    // ── PATCH: rename conversation ──────────────────────────────
    fastify.patch<{ Params: { id: string } }>("/users/me/tutor/conversations/:id", async (request, reply) => {
        const userId = request.user!.id;
        const { id } = request.params;

        const parsed = z.object({ title: z.string().min(1).max(120) }).safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({ message: "Invalid payload" });
        }

        const existing = await prisma.tutorConversation.findFirst({
            where: { id, userId },
            select: { id: true },
        });
        if (!existing) return reply.status(404).send({ message: "Conversation not found" });

        const updated = await prisma.tutorConversation.update({
            where: { id },
            data: { title: parsed.data.title.trim() },
            select: { id: true, title: true },
        });

        return { id: updated.id, title: updated.title };
    });

    // ── DELETE: delete conversation ─────────────────────────────
    fastify.delete<{ Params: { id: string } }>("/users/me/tutor/conversations/:id", async (request, reply) => {
        const userId = request.user!.id;
        const { id } = request.params;

        // Handle legacy synthetic IDs (format: "legacy:reportId")
        if (id.startsWith("legacy:")) {
            const reportId = id.slice("legacy:".length);
            // Delete all orphaned messages for this report (no conversationId)
            await prisma.tutorChatMessage.deleteMany({
                where: { userId, reportId, conversationId: null },
            });
            return { success: true };
        }

        const existing = await prisma.tutorConversation.findFirst({
            where: { id, userId },
            select: { id: true, reportId: true },
        });
        if (!existing) return reply.status(404).send({ message: "Conversation not found" });

        // Cascade delete handles messages via FK, but also clean up any orphaned
        // legacy messages tied to the same reportId just in case
        if (existing.reportId) {
            await prisma.tutorChatMessage.deleteMany({
                where: { userId, reportId: existing.reportId, conversationId: null },
            });
        }

        // Delete the conversation — cascade removes linked messages automatically
        await prisma.tutorConversation.delete({ where: { id } });

        return { success: true };
    });

    // ── POST: generate title for a conversation ─────────────────
    fastify.post<{ Params: { id: string } }>("/users/me/tutor/conversations/:id/generate-title", async (request, reply) => {
        const userId = request.user!.id;
        const { id } = request.params;

        const parsed = z.object({ firstMessage: z.string().min(1).max(500) }).safeParse(request.body);
        if (!parsed.success) return reply.status(400).send({ message: "Invalid payload" });

        const existing = await prisma.tutorConversation.findFirst({
            where: { id, userId },
            select: { id: true, title: true },
        });
        if (!existing) return reply.status(404).send({ message: "Conversation not found" });

        try {
            // Use Flash model — faster, cheaper, no thinking needed for a 5-word title
            const result = await getGeminiClient().models.generateContent({
                model: GEMINI_MODEL,
                contents: `Generate a concise 3-5 word title for an AI interview tutor chat session based on this first message from the user. Return ONLY the title, no quotes, no punctuation at the end.\n\nUser message: "${parsed.data.firstMessage.slice(0, 300)}"`,
                config: {
                    systemInstruction: "Return only a short 3-5 word title. No quotes. No punctuation at end. Capitalize each word.",
                },
            });

            const rawTitle = (result.text ?? "").trim().replace(/^["']|["']$/g, "").trim();
            console.log(`[TutorTitle] Generated title for ${id}: "${rawTitle}" (from: "${parsed.data.firstMessage.slice(0, 60)}")`);

            const title = rawTitle.length >= 2 && rawTitle.length <= 80 ? rawTitle : existing.title;

            await prisma.tutorConversation.update({
                where: { id },
                data: { title },
            });

            return { id, title };
        } catch (err: any) {
            console.error(`[TutorTitle] Failed to generate title for ${id}:`, err?.message);
            return { id, title: existing.title };
        }
    });

    fastify.get("/users/me/tutor/bootstrap", async (request, reply) => {
        const userId = request.user!.id;

        // Rate limit: 10 bootstrap calls per 10 min
        const rl = checkRateLimit(`tutor-bootstrap:${userId}`, 10, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({ message: `Rate limit reached. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.` });
        }

        const query = request.query as { reportId?: string; actionPlanTimespan?: string };
        const requestedTimespan = normalizeActionPlanTimespan(query.actionPlanTimespan);

        const context = await fetchReportContext(userId, query.reportId);
        if (!context) {
            return reply.status(404).send({ message: "No interview report found for tutoring yet." });
        }

        const cacheKey = context.report.id;
        const cached = await getTutorBundle(cacheKey);

        const reportSummary = {
            reportId: context.report.id,
            sessionId: context.report.sessionId,
            type: context.report.session.type,
            role: context.report.session.role,
            level: context.report.session.level,
            effectiveInterviewConfig: context.effectiveInterviewConfig,
            moduleConfigSummary: context.moduleConfigSummary,
            overallScore: Math.round(Number(context.report.overallScore) || 0),
            generatedAt: context.report.generatedAt,
            rubricScores: context.rubricScores,
            competencyScores: context.competencyScores,
        };

        if (cached && cached.actionPlanTimespan === requestedTimespan) {
            // Cache hit — return everything immediately (fast path)
            return {
                reportSummary,
                actionPlan: cached.actionPlan,
                actionPlanTimespan: cached.actionPlanTimespan,
                openingMessage: cached.openingMessage,
                planReady: true,
            };
        }

        // Cache miss or timespan mismatch — return INSTANTLY with template message.
        // Fire full Gemini plan generation in background (fire-and-forget).
        const instantMessage = generateInstantOpeningMessage(context);

        // Background generation — does NOT block the response
        generateActionPlanBundle(context, requestedTimespan)
            .then(async (generated) => {
                const bundle: CachedTutorBundle = {
                    reportId: context.report.id,
                    actionPlan: generated.actionPlan,
                    actionPlanTimespan: requestedTimespan,
                    openingMessage: generated.openingMessage,
                    updatedAt: Date.now(),
                };
                await setTutorBundle(cacheKey, bundle);
            })
            .catch((err) => {
                console.error(`[Tutor] Background plan generation failed for ${context.report.id}:`, err);
            });

        return {
            reportSummary,
            actionPlan: cached?.actionPlan ?? null,
            actionPlanTimespan: requestedTimespan,
            openingMessage: instantMessage,
            planReady: false, // signals frontend that plan is still generating
        };
    });

    fastify.get("/users/me/tutor/questions", async (request, reply) => {
        // pruneTutorCache();

        const userId = request.user!.id;

        // Rate limit: 15 question-sheet fetches per 10 min (slightly higher to allow regeneration)
        const rl = checkRateLimit(`tutor-questions:${userId}`, 15, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({ message: `Rate limit reached. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.` });
        }

        const query = request.query as { reportId?: string; refresh?: string };
        const forceRefresh = query.refresh === "true";
        const context = await fetchReportContext(userId, query.reportId);

        if (!context) {
            return reply.status(404).send({ message: "No interview report found for tutoring yet." });
        }

        const cacheKey = context.report.id;
        let cached = await getTutorBundle(cacheKey);
        if (!cached) {
            const generated = await generateActionPlanBundle(context, "2_weeks");
            cached = {
                reportId: context.report.id,
                actionPlan: generated.actionPlan,
                actionPlanTimespan: "2_weeks",
                openingMessage: generated.openingMessage,
                updatedAt: Date.now(),
            };
        }

        // Clear cached questions when user explicitly requests a fresh set
        if (forceRefresh && cached.questionSheet && cached.questionSheet.length > 0) {
            cached.questionSheet = [];
        }

        if (!cached.questionSheet || cached.questionSheet.length === 0) {
            cached.questionSheet = await generateQuestionSheet(context, cached.actionPlan);
            cached.updatedAt = Date.now();
            await setTutorBundle(cacheKey, cached);
        }

        return {
            reportId: context.report.id,
            questions: cached.questionSheet,
        };
    });

    fastify.get("/users/me/tutor/action-plan", async (request, reply) => {
        // pruneTutorCache();

        const userId = request.user!.id;
        const query = request.query as { reportId?: string; timespan?: string; refresh?: string; customPrompt?: string };
        const requestedTimespan = normalizeActionPlanTimespan(query.timespan);
        const forceRefresh = query.refresh === "true";
        const customPrompt = String(query.customPrompt || "").trim().slice(0, 1200);

        if (!query.reportId) {
            return reply.status(400).send({ message: "reportId is required" });
        }

        const context = await fetchReportContext(userId, query.reportId);
        if (!context) {
            return reply.status(404).send({ message: "No interview report found for tutoring yet." });
        }

        const cacheKey = context.report.id;
        let cached = await getTutorBundle(cacheKey);
        if (!cached) {
            const generated = await generateActionPlanBundle(context, requestedTimespan, customPrompt);
            cached = {
                reportId: context.report.id,
                actionPlan: generated.actionPlan,
                actionPlanTimespan: requestedTimespan,
                openingMessage: generated.openingMessage,
                updatedAt: Date.now(),
            };
            await setTutorBundle(cacheKey, cached);
        }

        if (forceRefresh || cached.actionPlanTimespan !== requestedTimespan || !!customPrompt) {
            const regenerated = await generateActionPlanBundle(context, requestedTimespan, customPrompt);
            cached.actionPlan = regenerated.actionPlan;
            cached.actionPlanTimespan = requestedTimespan;
            cached.openingMessage = regenerated.openingMessage;
            cached.updatedAt = Date.now();
            await setTutorBundle(cacheKey, cached);
        }

        return {
            reportId: context.report.id,
            timespan: cached.actionPlanTimespan,
            actionPlan: cached.actionPlan,
            openingMessage: cached.openingMessage,
        };
    });

    const acceptActionPlanSchema = z.object({
        reportId: z.string().min(1),
        timespan: z.enum(["1_week", "2_weeks", "monthly"]),
        actionPlan: z.object({
            strengths: z.array(z.string()),
            weakAreas: z.array(
                z.object({
                    category: z.string(),
                    score: z.number(),
                    why: z.string(),
                    actionItems: z.array(z.string()),
                })
            ),
            overallSummary: z.string(),
            priorityFocus: z.string(),
            practiceQuestionCount: z.number().int().min(1).max(9).optional(),
            dailyPlan: z.array(
                z.object({
                    day: z.number().int().min(1),
                    focus: z.string(),
                    questionCount: z.number().int().min(1).max(2),
                })
            ).optional(),
            plannedDays: z.array(
                z.object({
                    day: z.number().int().min(1),
                    focus: z.string(),
                    questionCount: z.number().int().min(0).max(2),
                    questionTags: z.array(z.object({ category: z.string(), count: z.number().int().min(0) })),
                    questions: z.array(
                        z.object({
                            id: z.string(),
                            title: z.string(),
                            category: z.string(),
                            solveUrl: z.string().nullable(),
                            problemSlug: z.string().optional(),
                        })
                    ),
                })
            ).optional(),
        }),
    });

    fastify.post("/users/me/tutor/action-plan/accept", async (request, reply) => {
        const parsed = acceptActionPlanSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({ message: "Invalid payload", details: parsed.error.flatten() });
        }

        const userId = request.user!.id;
        const { reportId, timespan, actionPlan } = parsed.data;

        const report = await prisma.evaluationReport.findFirst({
            where: { id: reportId, userId },
            include: { session: { select: { id: true, type: true } } },
        });

        if (!report) {
            return reply.status(404).send({ message: "Report not found" });
        }

        const { actionPlan: normalizedActionPlan, totalDays } = normalizeActionPlanForPersistence(
            actionPlan as ActionPlan,
            timespan
        );
        const { startDate, endDate } = buildAcceptedPlanWindow(totalDays);
        const now = new Date();
        const userTimezone = (request.headers["x-user-timezone"] as string) || "UTC";
        const labelDate = report.generatedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: userTimezone });
        const label = `${report.session.type.replace(/_/g, " ")} · ${getTimespanLabel(timespan)} · ${labelDate}`;

        const existing = await prisma.acceptedActionPlan.findFirst({
            where: {
                userId,
                reportId: report.id,
            },
            orderBy: { acceptedAt: "desc" },
            select: {
                id: true,
                reportId: true,
                sessionId: true,
                timespan: true,
                label: true,
                startDate: true,
                endDate: true,
                acceptedAt: true,
                totalDays: true,
                currentDay: true,
                completedDays: true,
                completedQuestions: true,
                actionPlan: true,
            },
        });

        if (existing) {
            const existingStoredPlan = (existing.actionPlan as ActionPlan) || null;
            const storedPlanHasCalendarDays =
                sanitizePlannedDays(existingStoredPlan?.plannedDays).length > 0 ||
                (Array.isArray(existingStoredPlan?.dailyPlan) && existingStoredPlan.dailyPlan.length > 0);
            const existingPlan = normalizeActionPlanForPersistence(
                storedPlanHasCalendarDays ? (existingStoredPlan as ActionPlan) : normalizedActionPlan,
                normalizeActionPlanTimespan(existing.timespan)
            );
            const existingIsActive = existing.endDate.getTime() >= now.getTime();
            const existingHasCompleteMetadata =
                typeof existing.totalDays === "number" &&
                existing.totalDays > 0 &&
                Array.isArray(existingPlan.actionPlan.plannedDays) &&
                existingPlan.actionPlan.plannedDays.length > 0;

            if (existingIsActive && existingHasCompleteMetadata) {
                return toAcceptedActionPlanResponse(existing, report.sessionId);
            }

            const refreshed = await prisma.acceptedActionPlan.update({
                where: { id: existing.id },
                data: existingIsActive
                    ? {
                        totalDays: existing.totalDays || existingPlan.totalDays,
                        actionPlan: existingPlan.actionPlan,
                    }
                    : {
                        sessionId: report.sessionId,
                        timespan,
                        label,
                        startDate,
                        endDate,
                        actionPlan: normalizedActionPlan,
                        acceptedAt: now,
                        totalDays,
                        currentDay: 1,
                        completedDays: [],
                        completedQuestions: [],
                        lastAccessedAt: null,
                    },
                select: {
                    id: true,
                    reportId: true,
                    sessionId: true,
                    timespan: true,
                    label: true,
                    startDate: true,
                    endDate: true,
                    acceptedAt: true,
                    actionPlan: true,
                },
            });

            return toAcceptedActionPlanResponse(refreshed, report.sessionId);
        }

        const legacyExisting = await prisma.tutorChatMessage.findFirst({
            where: {
                userId,
                reportId: report.id,
                role: "action_plan",
            },
            orderBy: { createdAt: "desc" },
            select: {
                id: true,
                reportId: true,
                content: true,
                createdAt: true,
            },
        });

        if (legacyExisting) {
            const parsedLegacy = parseLegacyAcceptedActionPlan(legacyExisting);
            if (parsedLegacy) {
                return parsedLegacy;
            }
        }

        const saved = await prisma.acceptedActionPlan.create({
            data: {
                userId,
                reportId: report.id,
                sessionId: report.sessionId,
                timespan,
                label,
                startDate,
                endDate,
                totalDays,
                actionPlan: normalizedActionPlan,
            },
        });

        return toAcceptedActionPlanResponse(saved, report.sessionId);
    });

    fastify.get("/users/me/tutor/action-plans", async (request, reply) => {
        const userId = request.user!.id;
        const [rows, legacyRows] = await Promise.all([
            prisma.acceptedActionPlan.findMany({
                where: { userId },
                orderBy: { acceptedAt: "desc" },
                take: 120,
                select: {
                    id: true,
                    reportId: true,
                    sessionId: true,
                    timespan: true,
                    label: true,
                    startDate: true,
                    endDate: true,
                    acceptedAt: true,
                    actionPlan: true,
                },
            }),
            prisma.tutorChatMessage.findMany({
                where: {
                    userId,
                    role: "action_plan",
                },
                orderBy: { createdAt: "desc" },
                take: 120,
                select: {
                    id: true,
                    reportId: true,
                    content: true,
                    createdAt: true,
                },
            }),
        ]);

        const plans = rows.map((row) => ({
            id: row.id,
            reportId: row.reportId,
            sessionId: row.sessionId,
            timespan: normalizeActionPlanTimespan(row.timespan),
            label: row.label || "Action Plan",
            startDate: row.startDate.toISOString(),
            endDate: row.endDate.toISOString(),
            acceptedAt: row.acceptedAt.toISOString(),
            actionPlan: (row.actionPlan as ActionPlan) || null,
        }));

        const seenIds = new Set(plans.map((plan) => plan.id));
        for (const row of legacyRows) {
            const parsedLegacy = parseLegacyAcceptedActionPlan(row);
            if (!parsedLegacy || seenIds.has(parsedLegacy.id)) continue;
            plans.push(parsedLegacy);
        }

        plans.sort((a, b) => new Date(b.acceptedAt).getTime() - new Date(a.acceptedAt).getTime());

        reply.cacheControl("USER_MEDIUM");
        return { plans };
    });

    const chatSchema = z.object({
        reportId: z.string().min(1),
        message: z.string().min(1),
        chatHistory: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).max(100).optional(),
        coveredQuestions: z.array(z.string()).optional(),
    });

    const chatV2Schema = z.object({
        conversationId: z.string().min(1).optional(),
        activeReportId: z.string().min(1).optional(),
        message: z.string().min(1),
        chatHistory: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).max(100).optional(),
        coveredQuestions: z.array(z.string()).optional(),
        clientContext: z
            .object({
                currentPanel: z.enum(["action-plan", "questions", "report"]).optional(),
                selectedReportId: z.string().min(1).optional(),
            })
            .optional(),
    });

    // ── Tutor profile (read + update) ──
    // The agent calls update_user_profile under the hood; this endpoint
    // exists so the frontend can prefill / submit the setup wizard.
    fastify.get("/users/me/tutor/profile", async (request, reply) => {
        const userId = request.user!.id;
        const profile = await prisma.userTutorProfile.findUnique({ where: { userId } });
        reply.cacheControl("USER_SHORT");
        if (!profile) {
            return { exists: false, profile: null };
        }
        return {
            exists: true,
            profile: {
                targetCompany: profile.targetCompany,
                targetRole: profile.targetRole,
                targetLevel: profile.targetLevel,
                targetDate: profile.targetDate?.toISOString() ?? null,
                hoursPerWeek: profile.hoursPerWeek,
                preferredLanguage: profile.preferredLanguage,
                preferredTopics: profile.preferredTopics,
                notes: profile.notes,
                updatedAt: profile.updatedAt.toISOString(),
            },
        };
    });

    const profileUpdateSchema = z
        .object({
            targetCompany: z.string().trim().max(80).nullable().optional(),
            targetRole: z.string().trim().max(80).nullable().optional(),
            targetLevel: z.string().trim().max(40).nullable().optional(),
            targetDate: z
                .string()
                .trim()
                .refine((s) => !s || !Number.isNaN(Date.parse(s)), { message: "invalid_date" })
                .nullable()
                .optional(),
            hoursPerWeek: z.number().int().min(0).max(80).nullable().optional(),
            preferredLanguage: z.string().trim().max(40).nullable().optional(),
            preferredTopics: z.array(z.string().trim().max(60)).max(20).optional(),
            notes: z.string().trim().max(800).nullable().optional(),
        })
        .strict();

    fastify.put("/users/me/tutor/profile", async (request, reply) => {
        const userId = request.user!.id;
        const parsed = profileUpdateSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({ message: "Invalid payload", details: parsed.error.flatten() });
        }
        const args = parsed.data;
        const data: Record<string, unknown> = {};
        if (args.targetCompany !== undefined) data.targetCompany = args.targetCompany;
        if (args.targetRole !== undefined) data.targetRole = args.targetRole;
        if (args.targetLevel !== undefined) data.targetLevel = args.targetLevel;
        if (args.targetDate !== undefined) data.targetDate = args.targetDate ? new Date(args.targetDate) : null;
        if (args.hoursPerWeek !== undefined) data.hoursPerWeek = args.hoursPerWeek;
        if (args.preferredLanguage !== undefined) data.preferredLanguage = args.preferredLanguage;
        if (args.preferredTopics !== undefined) data.preferredTopics = args.preferredTopics;
        if (args.notes !== undefined) data.notes = args.notes;

        const profile = await prisma.userTutorProfile.upsert({
            where: { userId },
            create: { userId, ...data },
            update: data,
        });

        return {
            ok: true,
            profile: {
                targetCompany: profile.targetCompany,
                targetRole: profile.targetRole,
                targetLevel: profile.targetLevel,
                targetDate: profile.targetDate?.toISOString() ?? null,
                hoursPerWeek: profile.hoursPerWeek,
                preferredLanguage: profile.preferredLanguage,
                preferredTopics: profile.preferredTopics,
                notes: profile.notes,
                updatedAt: profile.updatedAt.toISOString(),
            },
        };
    });

    // ── Single-artifact fetch ──
    // Used by the artifact-card click-through to render full content
    // (sheet questions, plan weeks, quiz items). Always scoped to user.
    fastify.get<{ Params: { id: string } }>("/users/me/tutor/artifacts/:id", async (request, reply) => {
        const userId = request.user!.id;
        const id = String(request.params.id || "").trim();
        if (!id || id.length > 64) {
            return reply.status(400).send({ message: "Invalid artifact id" });
        }
        const artifact = await prisma.tutorArtifact.findFirst({
            where: { id, userId },
        });
        if (!artifact) {
            return reply.status(404).send({ message: "Artifact not found" });
        }
        return {
            artifact: {
                id: artifact.id,
                type: artifact.artifactType.toString().toLowerCase(),
                title: artifact.title,
                content: sanitizeTutorArtifactContent(
                    artifact.artifactType.toString().toLowerCase(),
                    artifact.content
                ),
                meta: artifact.meta ?? null,
                status: artifact.status.toString().toLowerCase(),
                createdAt: artifact.createdAt.toISOString(),
                updatedAt: artifact.updatedAt.toISOString(),
            },
        };
    });

    // ── Direct Artifact Commit ──
    fastify.post<{ Params: { id: string } }>("/users/me/tutor/artifacts/:id/commit", async (request, reply) => {
        const userId = request.user!.id;
        const id = String(request.params.id || "").trim();
        
        console.log("[POST /artifacts/:id/commit] Request received:", {
            userId,
            artifactId: id,
        });
        
        if (!id || id.length > 64) {
            console.log("[POST /artifacts/:id/commit] Invalid artifact id");
            return reply.status(400).send({ message: "Invalid artifact id" });
        }
        
        try {
            console.log("[POST /artifacts/:id/commit] Calling handleCommitArtifact");
            const result = await handleCommitArtifact(userId, { draftId: id });
            console.log("[POST /artifacts/:id/commit] Success:", {
                artifactId: result.artifactId,
                type: result.type,
                committed: result.committed,
            });
            return reply.send({ success: true, artifact: result });
        } catch (error: any) {
            console.error("[POST /artifacts/:id/commit] Error:", {
                code: error?.code,
                message: error?.message,
                stack: error?.stack,
            });
            if (error?.code === "NOT_FOUND") {
                return reply.status(404).send({ message: "Draft not found" });
            }
            throw error;
        }
    });

    fastify.post("/users/me/tutor/chat/v2/stream", async (request, reply) => {
        const userId = request.user!.id;

        const rl = checkRateLimit(`tutor-chat-v2:${userId}`, 30, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({ message: `Rate limit reached. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.` });
        }

        // Entitlement gate — locked for FREE, token-budgeted for paid plans.
        try {
            await gateTutor(userId);
        } catch (err) {
            if (err instanceof EntitlementError) {
                return reply.status(err.statusCode).send({
                    error: err.code,
                    message: err.message,
                    plan: err.plan,
                    detail: err.detail,
                });
            }
            throw err;
        }

        const parsed = chatV2Schema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({ message: "Invalid payload", details: parsed.error.flatten() });
        }

        const { message, chatHistory = [], coveredQuestions = [], activeReportId, clientContext, conversationId } = parsed.data;

        const conversation = await ensureTutorConversation({
            userId,
            conversationId,
            preferredReportId: activeReportId || null,
            titleHint: message,
        });

        // ── Agent V2 branch (flag-gated) ────────────────────────────────
        // When TUTOR_AGENT_V2=true the request runs through the agentic loop
        // (Gemini function calling, persistent weak-area / mistake DB).
        // Otherwise we fall through to the legacy planner+synth path below.
        if (process.env.TUTOR_AGENT_V2 === "true") {
            await runAgentV2Branch({
                request,
                reply,
                userId,
                conversation,
                message,
                chatHistory,
                activeReportId: activeReportId || conversation?.reportId || null,
            });
            return;
        }

        const plannerHistory = (chatHistory || []).filter(
            (m): m is { role: "user" | "assistant"; content: string } =>
                Boolean(m) && (m.role === "user" || m.role === "assistant") && typeof m.content === "string"
        );

        // Infer conversational type context from recent history
        // e.g. if user has been asking about "full interview" for 2 turns,
        // "what question did I fail" should resolve to full_interview, not global recent
        const conversationalTypeHint = inferTypeHintFromHistory(plannerHistory);

        // Record an input-side token estimate synchronously. The actual stream may vary;
        // a flat +1500 output estimate keeps the budget honest until we wire exact counts.
        recordTokenUsage(userId, "tutor_tokens", tutorEstimateTokens(message, chatHistory) + 1500)
            .catch((e) => request.log.error(e, "tutor token recording failed"));

        const retrievalPlan = await planTutorRetrievalWithLLM({
            message,
            chatHistory: plannerHistory,
            conversationalTypeHint,
            userId,
            reportId: activeReportId || conversation?.reportId || undefined,
        });

        const plannedTools = retrievalPlan.tools;
        const needsResolvedReport = plannedTools.some(toolRequiresResolvedReport) || messageNeedsVerifiedReportData(message);
        const needsTranscript = plannedTools.some(toolNeedsTranscript);
        let resolved: Awaited<ReturnType<typeof resolveReportFromUserReference>> | null = null;
        let context: Awaited<ReturnType<typeof fetchReportContext>> | null = null;
        const toolEvents: TutorToolEvent[] = [];
        const toolData: Record<string, unknown> = {
            retrieval_planner: {
                source: retrievalPlan.plannerSource,
                selectedTools: plannedTools,
                conversationalTypeHint,
                trendQuery: {
                    typeFilter: retrievalPlan.trendSpec.typeFilter,
                    requestedTimespanDays: retrievalPlan.trendSpec.requestedTimespanDays,
                    includeAll: retrievalPlan.trendSpec.includeAll,
                    limit: retrievalPlan.trendSpec.limit,
                    needExactTypeDistribution: retrievalPlan.trendSpec.needExactTypeDistribution,
                    sinceDate: retrievalPlan.trendSpec.sinceDate?.toISOString() || null,
                    untilDate: retrievalPlan.trendSpec.untilDate?.toISOString() || null,
                    exactDateText: retrievalPlan.trendSpec.exactDateText,
                },
            },
        };

        if (needsResolvedReport) {
            resolved = await resolveReportFromUserReference({
                userId,
                activeReportId: activeReportId || conversation?.reportId || undefined,
                userReference: message,
                conversationalTypeHint,
            });

            if (!resolved.selectedReport) {
                return reply.status(404).send({ message: "No interview report found for tutoring yet." });
            }

            toolData.resolve_report_from_user_reference = {
                selectedReport: {
                    reportId: resolved.selectedReport.id,
                    sessionId: resolved.selectedReport.sessionId,
                    type: resolved.selectedReport.session.type,
                    role: resolved.selectedReport.session.role,
                    level: resolved.selectedReport.session.level,
                    generatedAt: resolved.selectedReport.generatedAt,
                    overallScore: Math.round(Number(resolved.selectedReport.overallScore) || 0),
                },
                candidates: resolved.candidates.map((c) => ({
                    reportId: c.id,
                    sessionId: c.sessionId,
                    type: c.session.type,
                    generatedAt: c.generatedAt,
                    overallScore: Math.round(Number(c.overallScore) || 0),
                })),
                disambiguationRequired: resolved.disambiguationRequired,
                confidence: resolved.confidence,
            };

            if (resolved.disambiguationRequired && resolved.candidates.length > 1) {
                const suggestionText = resolved.candidates
                    .map((candidate, index) => {
                        const score = Math.round(Number(candidate.overallScore) || 0);
                        return `${index + 1}. ${candidate.session.type.replace(/_/g, " ")} (${candidate.generatedAt.toISOString().slice(0, 10)}) score ${score}`;
                    })
                    .join("\n");

                const disambiguationMessage = `I found multiple matching reports. Reply with one of these options:\n${suggestionText}`;

                reply.raw.writeHead(200, {
                    "Content-Type": "text/event-stream",
                    "Cache-Control": "no-cache, no-transform",
                    Connection: "keep-alive",
                    "Access-Control-Allow-Origin": request.headers.origin || "http://localhost:3000",
                    "Access-Control-Allow-Credentials": "true",
                });

                const send = (payload: any) => {
                    reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
                };

                send({
                    type: "meta",
                    toolEvents,
                    resolvedContext: {
                        reportId: resolved?.selectedReport?.id || null,
                        confidence: resolved?.confidence || "medium",
                    },
                });
                send({ type: "token", text: disambiguationMessage });
                send({ type: "done" });
                reply.raw.end();
                return;
            }

            context = await fetchReportContext(userId, resolved.selectedReport.id, {
                includeTranscript: needsTranscript,
                includeRecentReports: false,
            });
            if (!context) {
                return reply.status(404).send({ message: "Report not found" });
            }
        }

        const toolResults = await Promise.all(
            plannedTools.map((toolName) =>
                runTutorTool(toolName, {
                    userId,
                    message,
                    context,
                    retrievalPlan,
                    maxTrendReports: MAX_TREND_REPORTS,
                    getTutorBundle,
                    setTutorBundle,
                    parseTimespanFromMessage,
                    generateActionPlanBundle,
                })
            )
        );
        for (const result of toolResults) {
            if (result.error) {
                toolEvents.push({
                    toolName: result.toolName,
                    status: "error",
                    latencyMs: result.latencyMs,
                    error: result.error,
                });
            } else {
                toolEvents.push({
                    toolName: result.toolName,
                    status: "ok",
                    latencyMs: result.latencyMs,
                    data: result.data,
                });
                toolData[result.toolName] = result.data;
            }
        }

        const uiDirectives = context?.report ? buildUiDirectives(message, context.report.id) : [];

        let systemPrompt: string;
        let promptQuestionSheet: TutorQuestion[] = [];
        if (context) {
            let cached = await getTutorBundle(context.report.id);
            let actionPlanForPrompt = (toolData.get_action_plan_for_report as any)?.actionPlan
                || cached?.actionPlan
                || buildFallbackActionPlan(context.rubricScores);
            const shouldLoadQuestionSheetForPrompt = Boolean(
                plannedTools.includes("get_sheet_status_for_report")
                || /question[\s_-]*sheet|practice|drill|quiz|mock\s+question/.test(message.toLowerCase())
            );

            if (shouldLoadQuestionSheetForPrompt) {
                if (!cached) {
                    cached = {
                        reportId: context.report.id,
                        actionPlan: actionPlanForPrompt,
                        actionPlanTimespan: "2_weeks",
                        openingMessage: generateInstantOpeningMessage(context),
                        updatedAt: Date.now(),
                    };
                }

                if (!cached.questionSheet || cached.questionSheet.length === 0) {
                    cached.questionSheet = await generateQuestionSheet(
                        context,
                        actionPlanForPrompt,
                        actionPlanForPrompt.practiceQuestionCount || 6
                    );
                    cached.updatedAt = Date.now();
                    await setTutorBundle(context.report.id, cached);
                }
                promptQuestionSheet = cached.questionSheet || [];
            }

            systemPrompt = buildTutorSystemPromptV2({
                reportSummary: {
                    type: context.report.session.type,
                    date: context.report.generatedAt.toISOString(),
                    overallScore: Math.round(Number(context.report.overallScore) || 0),
                    role: context.report.session.role,
                    level: context.report.session.level,
                    moduleConfigSummary: context.moduleConfigSummary,
                    rubricScores: context.rubricScores,
                    competencyScores: context.competencyScores,
                },
                transcript: context.transcript,
                actionPlan: actionPlanForPrompt,
                questionSheet: promptQuestionSheet,
                coveredQuestions,
                toolData,
            });
        } else {
            systemPrompt = buildTutorLightweightSystemPrompt({
                coveredQuestions,
                toolData,
            });
        }

        reply.raw.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "Access-Control-Allow-Origin": request.headers.origin || "http://localhost:3000",
            "Access-Control-Allow-Credentials": "true",
        });

        const send = (payload: any) => {
            reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
        };

        let fullAssistantText = "";

        try {
            // Human-readable labels for each tool so the frontend can show
            // "Tutor is fetching your reports..." etc. during the thinking phase
            const TOOL_STATUS_LABELS: Record<string, string> = {
                get_report_summary: "Fetching your report...",
                get_user_report_trend: "Fetching your interview history...",
                get_report_stage_transcript_context: "Reading that stage transcript...",
                get_action_plan_for_report: "Loading your action plan...",
                get_sheet_status_for_report: "Checking your question sheet...",
                get_question_activity_snapshot: "Fetching your practice activity...",
                get_rubric_comparison: "Comparing your rubric scores...",
                get_weak_area_drill_history: "Checking your drill history...",
                get_session_question_detail: "Loading session questions...",
                get_score_percentile: "Calculating your percentile...",
                get_accepted_action_plan: "Loading your study plan...",
            };
            send({
                type: "meta",
                toolEvents,
                toolLabels: plannedTools.map((t) => ({
                    toolName: t,
                    label: TOOL_STATUS_LABELS[t] || "Fetching context...",
                    status: toolEvents.find((e) => e.toolName === t)?.status ?? "ok",
                })),
                resolvedContext: {
                    reportId: context?.report?.id || null,
                    confidence: resolved?.confidence || "medium",
                },
            });

            const geminiHistory = chatHistory.map((m) => ({
                role: m.role === "assistant" ? "model" : "user",
                parts: [{ text: m.content }],
            }));

            const stream = await getGeminiClient().models.generateContentStream({
                model: GEMINI_MODEL,
                contents: [...geminiHistory, { role: "user", parts: [{ text: message }] }],
                config: {
                    systemInstruction: systemPrompt,
                    thinkingConfig: GEMINI_THINKING_MEDIUM,
                },
            });

            for await (const chunk of stream) {
                const delta = chunk.text;
                if (delta) {
                    fullAssistantText += delta;
                    send({ type: "token", text: delta });
                }
            }

            const sourceLine = buildSourceLine(
                toolData,
                context
                    ? {
                        type: context.report.session.type.replace(/_/g, " "),
                        date: context.report.generatedAt.toISOString().slice(0, 10),
                    }
                    : null
            );
            if (sourceLine && !/\bsources\s*:/i.test(fullAssistantText)) {
                fullAssistantText = `${fullAssistantText.trim()}\n\n${sourceLine}`;
                send({ type: "token", text: `\n\n${sourceLine}` });
            }

            const persistedReportId = context?.report?.id || conversation.reportId || activeReportId || null;
            const rowsToPersist = [
                {
                    userId,
                    conversationId: conversation.id,
                    reportId: persistedReportId,
                    role: "user",
                    content: message,
                },
                ...(fullAssistantText.trim()
                    ? [
                          {
                              userId,
                              conversationId: conversation.id,
                              reportId: persistedReportId,
                              role: "assistant",
                              content: fullAssistantText,
                          },
                      ]
                    : []),
            ];

            send({ type: "ui_directives", directives: uiDirectives });
            send({ type: "done" });

            Promise.all([
                prisma.tutorChatMessage.createMany({ data: rowsToPersist }),
                updateTutorConversationAfterMessage({
                    userId,
                    conversationId: conversation.id,
                    reportId: persistedReportId,
                    titleHint: message,
                })
            ]).then(() => {
                if (persistedReportId) {
                    enforceTutorChatRetention(persistedReportId).catch(() => {});
                }
            }).catch(e => request.log.error(e, "tutor legacy persist failed"));
        } catch (err: any) {
            send({ type: "error", message: err?.message || "Tutor stream failed" });
        } finally {
            reply.raw.end();
        }
    });

    fastify.post("/users/me/tutor/chat/stream", async (request, reply) => {
        // pruneTutorCache();

        // Rate limit: 30 chat messages per 10 min
        const rl = checkRateLimit(`tutor-chat:${request.user!.id}`, 30, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({ message: `Rate limit reached. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.` });
        }

        // Entitlement gate.
        try {
            await gateTutor(request.user!.id);
        } catch (err) {
            if (err instanceof EntitlementError) {
                return reply.status(err.statusCode).send({
                    error: err.code,
                    message: err.message,
                    plan: err.plan,
                    detail: err.detail,
                });
            }
            throw err;
        }

        const parsed = chatSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({ message: "Invalid payload", details: parsed.error.flatten() });
        }

        const userId = request.user!.id;
        const { reportId, message, chatHistory = [], coveredQuestions = [] } = parsed.data;

        const context = await fetchReportContext(userId, reportId);
        if (!context) {
            return reply.status(404).send({ message: "Report not found" });
        }

        const cacheKey = context.report.id;
        let cached = await getTutorBundle(cacheKey);
        if (!cached) {
            const generated = await generateActionPlanBundle(context, "2_weeks");
            cached = {
                reportId: context.report.id,
                actionPlan: generated.actionPlan,
                actionPlanTimespan: "2_weeks",
                openingMessage: generated.openingMessage,
                updatedAt: Date.now(),
            };
            await setTutorBundle(cacheKey, cached);
        }

        if (!cached.questionSheet || cached.questionSheet.length === 0) {
            cached.questionSheet = await generateQuestionSheet(context, cached.actionPlan);
            cached.updatedAt = Date.now();
            await setTutorBundle(cacheKey, cached);
        }

        const existingSheet = await prisma.questionSheet.findFirst({
            where: { reportId: context.report.id },
            select: { id: true },
        });

        const systemPrompt = buildTutorSystemPrompt({
            reportSummary: {
                type: context.report.session.type,
                date: context.report.generatedAt.toISOString(),
                overallScore: Math.round(Number(context.report.overallScore) || 0),
                role: context.report.session.role,
                level: context.report.session.level,
                moduleConfigSummary: context.moduleConfigSummary,
                rubricScores: context.rubricScores,
                competencyScores: context.competencyScores,
            },
            transcript: context.transcript,
            actionPlan: cached.actionPlan,
            questionSheet: cached.questionSheet || [],
            recentReports: context.recentReports,
            coveredQuestions,
            hasSavedSheet: !!existingSheet,
        });

        reply.raw.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "Access-Control-Allow-Origin": request.headers.origin || "http://localhost:3000",
            "Access-Control-Allow-Credentials": "true",
        });

        const send = (payload: any) => {
            reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
        };

        let fullAssistantText = "";

        try {
            const geminiHistory = chatHistory.map((m) => ({
                role: m.role === "assistant" ? "model" : "user",
                parts: [{ text: m.content }],
            }));

            const stream = await getGeminiClient().models.generateContentStream({
                model: GEMINI_MODEL,
                contents: [
                    ...geminiHistory,
                    { role: "user", parts: [{ text: message }] },
                ],
                config: {
                    systemInstruction: systemPrompt,
                    thinkingConfig: GEMINI_THINKING_MEDIUM,
                },
            });

            for await (const chunk of stream) {
                const delta = chunk.text;
                if (delta) {
                    fullAssistantText += delta;
                    send({ type: "token", text: delta });
                }
            }

            const rowsToPersist = [
                {
                    userId,
                    reportId: context.report.id,
                    role: "user",
                    content: message,
                },
                ...(fullAssistantText.trim()
                    ? [
                          {
                              userId,
                              reportId: context.report.id,
                              role: "assistant",
                              content: fullAssistantText,
                          },
                      ]
                    : []),
            ];

            send({ type: "done" });

            prisma.tutorChatMessage.createMany({ data: rowsToPersist }).then(() => {
                enforceTutorChatRetention(context.report.id).catch(() => {});
            }).catch(e => request.log.error(e, "tutor stream persist failed"));
        } catch (err: any) {
            send({ type: "error", message: err?.message || "Tutor stream failed" });
        } finally {
            reply.raw.end();
        }
    });
}
