import { FastifyInstance } from "fastify";
import { z } from "zod";
import { checkRateLimit } from "../lib/rate-limiter.js";
import { DSAQuestion, buildDSAAvailableForPracticeFilter } from "../models/DSAQuestion.js";
import { SQLQuestion } from "../models/SQLQuestion.js";
import { CSFundamentalQuestion } from "../models/CSFundamentalQuestion.js";
import { SystemDesignQuestion } from "../models/system-design-question.js";

const SEARCH_RATE_LIMIT = { requests: 60, windowMs: 60_000 } as const;

const searchQuerySchema = z.object({
    q: z.string().trim().min(2).max(200),
    limit: z.coerce.number().int().min(1).max(20).default(12),
    mode: z.enum(["hybrid", "keyword", "semantic"]).default("hybrid"),
    types: z.string().optional(),
});

type SearchMode = "hybrid" | "keyword" | "semantic";

type SearchResult = {
    id: string;
    type: string;
    group: string;
    title: string;
    subtitle?: string;
    url: string;
    score: number;
};

const STOP_WORDS = new Set([
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "but",
    "by",
    "for",
    "from",
    "if",
    "in",
    "into",
    "is",
    "it",
    "no",
    "not",
    "of",
    "on",
    "or",
    "s",
    "such",
    "t",
    "that",
    "the",
    "their",
    "then",
    "there",
    "these",
    "they",
    "this",
    "to",
    "was",
    "will",
    "with",
    "you",
    "your",
]);

const SYNONYMS: Record<string, string[]> = {
    report: ["evaluation", "summary", "feedback", "analysis", "score"],
    reports: ["evaluation", "summary", "feedback", "analysis", "score"],
    resume: ["cv"],
    resumes: ["cv"],
    billing: ["payment", "subscription", "plan"],
    payment: ["billing", "invoice"],
    payments: ["billing", "invoice"],
    subscription: ["plan", "billing"],
    subscriptions: ["plan", "billing"],
    interview: ["session", "mock"],
    interviews: ["session", "mock"],
    question: ["problem", "prompt"],
    questions: ["problem", "prompt"],
    behavioural: ["behavioral", "communication", "leadership"],
    behavioral: ["behavioural", "communication", "leadership"],
    coding: ["dsa", "algorithms", "data"],
    system: ["architecture", "scalable"],
    design: ["architecture", "scalable"],
    sql: ["database", "query"],
    dbms: ["database", "sql"],
};

const VALID_TYPES = new Set([
    "dsa",
    "sql",
    "system_design",
    "cs_fundamentals",
    "reports",
    "sheets",
    "resumes",
]);

const DEFAULT_TYPES = [
    "dsa",
    "sql",
    "system_design",
    "cs_fundamentals",
    "reports",
    "sheets",
    "resumes",
];

function normalizeText(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function tokenize(value: string): string[] {
    const normalized = normalizeText(value);
    if (!normalized) return [];
    return normalized
        .split(" ")
        .map((token) => token.trim())
        .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

function expandTerms(query: string, mode: SearchMode): string[] {
    const baseTokens = tokenize(query);
    const terms = new Set(baseTokens);
    const normalizedQuery = normalizeText(query);

    if (mode !== "keyword") {
        if (normalizedQuery.includes("system design")) {
            terms.add("architecture");
            terms.add("scalable");
        }
        if (normalizedQuery.includes("full interview")) {
            terms.add("full_interview");
            terms.add("mock");
        }

        for (const token of baseTokens) {
            const synonyms = SYNONYMS[token];
            if (synonyms) {
                for (const synonym of synonyms) {
                    terms.add(synonym);
                }
            }
        }
    }

    return Array.from(terms).slice(0, 12);
}

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildRegex(terms: string[]): RegExp | null {
    if (terms.length === 0) return null;
    const pattern = terms.map(escapeRegex).join("|");
    if (!pattern) return null;
    return new RegExp(pattern, "i");
}

function flattenValue(value: unknown): string {
    if (!value) return "";
    if (Array.isArray(value)) {
        return value.map(flattenValue).join(" ");
    }
    if (typeof value === "object") {
        return Object.values(value as Record<string, unknown>)
            .map(flattenValue)
            .join(" ");
    }
    return String(value);
}

function formatTitle(value: string | null | undefined): string {
    if (!value) return "";
    return value
        .replace(/_/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

function computeScore(text: string, query: string, terms: string[]): number {
    const hay = normalizeText(text);
    const normalizedQuery = normalizeText(query);
    if (!hay) return 0;

    let score = 0;
    if (normalizedQuery && hay.includes(normalizedQuery)) score += 4;
    if (normalizedQuery && hay.startsWith(normalizedQuery)) score += 2;

    for (const term of terms) {
        if (term && hay.includes(term)) score += 1;
    }

    return score;
}

function parseTypes(rawTypes: string | undefined): Set<string> {
    if (!rawTypes) return new Set(DEFAULT_TYPES);
    const selected = rawTypes
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
        .filter((value) => VALID_TYPES.has(value));
    return selected.length > 0 ? new Set(selected) : new Set(DEFAULT_TYPES);
}

function clampResults(results: SearchResult[], limit: number): SearchResult[] {
    return results
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
}

export default async function searchRoutes(fastify: FastifyInstance) {
    fastify.addHook("preHandler", fastify.authenticate);

    fastify.get("/search/universal", async (request, reply) => {
        const parsed = searchQuerySchema.safeParse(request.query);
        if (!parsed.success) {
            return reply.status(400).send({
                error: "Invalid query parameters",
                details: parsed.error.flatten(),
            });
        }

        const userId = request.user!.id;
        const rateKey = `search:universal:${userId}`;
        const rl = checkRateLimit(rateKey, SEARCH_RATE_LIMIT.requests, SEARCH_RATE_LIMIT.windowMs);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Search rate limit exceeded. Try again in ${Math.ceil(rl.retryAfterMs / 1000)} seconds.`,
            });
        }

        const { q, limit, mode, types } = parsed.data;
        const selectedTypes = parseTypes(types);
        const terms = expandTerms(q, mode);
        const regex = buildRegex(terms);
        const textQuery = terms.join(" ").trim();
        const perTypeLimit = Math.max(4, Math.ceil(limit / 2));

        const tasks: Array<Promise<SearchResult[]>> = [];

        if (selectedTypes.has("dsa")) {
            tasks.push(
                (async () => {
                    if (!regex && !textQuery) return [];

                    let docs: any[] = [];
                    if (textQuery) {
                        docs = await DSAQuestion.find(
                            { $and: [buildDSAAvailableForPracticeFilter(), { $text: { $search: textQuery } }] },
                            { title: 1, difficulty: 1, problemSlug: 1, topics: 1 }
                        )
                            .limit(perTypeLimit)
                            .lean();
                    }

                    if (docs.length === 0 && regex) {
                        docs = await DSAQuestion.find(
                            { $and: [buildDSAAvailableForPracticeFilter(), { $or: [{ title: regex }, { description: regex }] }] },
                            { title: 1, difficulty: 1, problemSlug: 1, topics: 1 }
                        )
                            .limit(perTypeLimit)
                            .lean();
                    }

                    return docs.map((doc) => {
                        const title = String(doc.title || "DSA Question");
                        const subtitleParts = [doc.difficulty, Array.isArray(doc.topics) ? doc.topics.slice(0, 2).join(", ") : ""]
                            .filter(Boolean)
                            .join(" · ");
                        const text = `${title} ${subtitleParts}`;
                        const score = computeScore(text, q, terms) + 0.5;
                        return {
                            id: String(doc._id),
                            type: "dsa_question",
                            group: "Questions",
                            title,
                            subtitle: subtitleParts || undefined,
                            url: `/questions/dsa/solve?id=${encodeURIComponent(String(doc._id))}`,
                            score,
                        } satisfies SearchResult;
                    });
                })()
            );
        }

        if (selectedTypes.has("sql")) {
            tasks.push(
                (async () => {
                    if (!regex && !textQuery) return [];

                    let docs: any[] = [];
                    if (textQuery) {
                        docs = await SQLQuestion.find(
                            { $text: { $search: textQuery } },
                            { title: 1, description: 1 }
                        )
                            .limit(perTypeLimit)
                            .lean();
                    }

                    if (docs.length === 0 && regex) {
                        docs = await SQLQuestion.find(
                            { $or: [{ title: regex }, { description: regex }] },
                            { title: 1, description: 1 }
                        )
                            .limit(perTypeLimit)
                            .lean();
                    }

                    return docs.map((doc) => {
                        const title = String(doc.title || "SQL Question");
                        const text = `${title} ${doc.description || ""}`;
                        const score = computeScore(text, q, terms) + 0.5;
                        return {
                            id: String(doc._id),
                            type: "sql_question",
                            group: "Questions",
                            title,
                            subtitle: "SQL",
                            url: `/questions/sql/solve?id=${encodeURIComponent(String(doc._id))}`,
                            score,
                        } satisfies SearchResult;
                    });
                })()
            );
        }

        if (selectedTypes.has("system_design")) {
            tasks.push(
                (async () => {
                    if (!regex) return [];
                    const docs = await SystemDesignQuestion.find(
                        { $or: [{ title: regex }, { problemStatement: regex }] },
                        { title: 1, difficulty: 1, problemStatement: 1 }
                    )
                        .limit(perTypeLimit)
                        .lean();

                    return docs.map((doc) => {
                        const title = String(doc.title || "System Design Question");
                        const subtitle = doc.difficulty ? String(doc.difficulty) : "System Design";
                        const text = `${title} ${doc.problemStatement || ""}`;
                        const score = computeScore(text, q, terms) + 0.6;
                        return {
                            id: String(doc._id),
                            type: "system_design_question",
                            group: "Questions",
                            title,
                            subtitle,
                            url: `/questions/system-design/solve?id=${encodeURIComponent(String(doc._id))}`,
                            score,
                        } satisfies SearchResult;
                    });
                })()
            );
        }

        if (selectedTypes.has("cs_fundamentals")) {
            tasks.push(
                (async () => {
                    if (!regex) return [];
                    const docs = await CSFundamentalQuestion.find(
                        { $or: [{ question: regex }, { answer: regex }, { detailedAnswer: regex }] },
                        { question: 1, topic: 1 }
                    )
                        .limit(perTypeLimit)
                        .lean();

                    return docs.map((doc) => {
                        const title = String(doc.question || "CS Fundamentals Question");
                        const subtitle = doc.topic ? String(doc.topic) : "CS Fundamentals";
                        const text = `${title} ${subtitle}`;
                        const score = computeScore(text, q, terms) + 0.5;
                        return {
                            id: String(doc._id),
                            type: "cs_fundamentals_question",
                            group: "Questions",
                            title,
                            subtitle,
                            url: `/questions/cs-fundamentals/solve?id=${encodeURIComponent(String(doc._id))}`,
                            score,
                        } satisfies SearchResult;
                    });
                })()
            );
        }

        if (selectedTypes.has("reports")) {
            tasks.push(
                (async () => {
                    const reports = await request.prisma.evaluationReport.findMany({
                        where: { userId },
                        orderBy: { generatedAt: "desc" },
                        take: 50,
                        select: {
                            id: true,
                            sessionId: true,
                            overallScore: true,
                            generatedAt: true,
                            strengths: true,
                            improvements: true,
                            session: {
                                select: {
                                    type: true,
                                    role: true,
                                    level: true,
                                },
                            },
                        },
                    });

                    return reports
                        .map((report) => {
                            const typeLabel = formatTitle(report.session?.type || "report");
                            const roleLabel = formatTitle(report.session?.role || "");
                            const levelLabel = formatTitle(report.session?.level || "");
                            const title = `${typeLabel} Report`;
                            const subtitleParts = [roleLabel, levelLabel, report.overallScore ? `Score ${Number(report.overallScore).toFixed(0)}` : ""]
                                .filter(Boolean)
                                .join(" · ");
                            const blob = [
                                typeLabel,
                                roleLabel,
                                levelLabel,
                                flattenValue(report.strengths),
                                flattenValue(report.improvements),
                            ].join(" ");
                            const score = computeScore(blob, q, terms) + 0.8;
                            return {
                                id: report.id,
                                type: "report",
                                group: "Reports",
                                title,
                                subtitle: subtitleParts || undefined,
                                url: `/reports/${report.id}`,
                                score,
                            } satisfies SearchResult;
                        })
                        .filter((result) => result.score > 0.5);
                })()
            );
        }

        if (selectedTypes.has("sheets")) {
            tasks.push(
                (async () => {
                    const [sheets, customSheets] = await Promise.all([
                        request.prisma.questionSheet.findMany({
                            where: { userId },
                            orderBy: { generatedAt: "desc" },
                            take: 50,
                            select: {
                                id: true,
                                label: true,
                                generatedAt: true,
                            },
                        }),
                        request.prisma.customQuestionSheet.findMany({
                            where: { userId },
                            orderBy: { createdAt: "desc" },
                            take: 50,
                            select: {
                                id: true,
                                name: true,
                                description: true,
                            },
                        }),
                    ]);

                    const sheetResults = sheets.map((sheet) => {
                        const title = sheet.label || "Question Sheet";
                        const text = `${title}`;
                        const score = computeScore(text, q, terms) + 0.4;
                        return {
                            id: sheet.id,
                            type: "sheet",
                            group: "Sheets",
                            title,
                            subtitle: "Question sheet",
                            url: `/sheets/${sheet.id}`,
                            score,
                        } satisfies SearchResult;
                    });

                    const customResults = customSheets.map((sheet) => {
                        const title = sheet.name || "Custom Sheet";
                        const text = `${title} ${sheet.description || ""}`;
                        const score = computeScore(text, q, terms) + 0.4;
                        return {
                            id: sheet.id,
                            type: "custom_sheet",
                            group: "Sheets",
                            title,
                            subtitle: "Custom sheet",
                            url: `/sheets/${sheet.id}`,
                            score,
                        } satisfies SearchResult;
                    });

                    return [...sheetResults, ...customResults].filter((result) => result.score > 0.4);
                })()
            );
        }

        if (selectedTypes.has("resumes")) {
            tasks.push(
                (async () => {
                    const resumes = await request.prisma.resume.findMany({
                        where: { userId },
                        orderBy: { uploadedAt: "desc" },
                        take: 50,
                        select: {
                            id: true,
                            fileName: true,
                            uploadedAt: true,
                        },
                    });

                    return resumes
                        .map((resume) => {
                            const title = resume.fileName || "Resume";
                            const score = computeScore(title, q, terms) + 0.3;
                            return {
                                id: resume.id,
                                type: "resume",
                                group: "Resumes",
                                title,
                                subtitle: "Resume",
                                url: `/resumes`,
                                score,
                            } satisfies SearchResult;
                        })
                        .filter((result) => result.score > 0.3);
                })()
            );
        }

        const settled = await Promise.allSettled(tasks);
        const merged = settled.flatMap((result) =>
            result.status === "fulfilled" ? result.value : []
        );

        const results = clampResults(merged, limit);

        return reply.send({
            success: true,
            data: {
                query: q,
                terms,
                results,
            },
        });
    });
}
