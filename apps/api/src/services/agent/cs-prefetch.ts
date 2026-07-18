// ============================================
// CS Fundamentals â€” Question Pre-fetch Utility
// ============================================
// Shared between the text orchestrator and the voice pipeline.
// Fetches random CS theory + SQL questions from MongoDB with
// cross-session deduplication via durable user_question_exposures.

import { prisma } from "../../lib/prisma.js";
import { CSFundamentalQuestion } from "../../models/CSFundamentalQuestion.js";
import { SQLQuestion } from "../../models/SQLQuestion.js";
import { normalizeSQLQuestion } from "../../lib/question-helpers.js";
import { findLeastRecentlySeenMongoDoc, findLeastRecentlySeenMongoDocs, findRandomMongoDoc, findRandomMongoDocs, getSeenQuestionIds, toMongoObjectIds } from "../question-exposure.js";

export type CSQuestionEntry = {
    questionId: string;
    questionText: string;
    referenceAnswer: string;
};

export type CSPrefetchResult = {
    /** Theory questions keyed by topic (DBMS, OS, CN, OOPS, SQL_query) */
    questionsMap: Map<string, CSQuestionEntry[]>;
    /** Normalized SQL question object (for caching in cachedQuestionData) */
    prefetchedSQLQuestion: any | null;
    /** Map of sqlQuestionId â†’ normalized question (to merge into cachedQuestionData) */
    sqlCacheEntry: Map<string, any>;
};

export type CSPrefetchOptions = {
    topics?: string[];
    includeSQL?: boolean;
    questionCountPerTopic?: number;
};

const CS_TOPIC_ALIASES: Record<string, string> = {
    DBMS: "DBMS",
    OS: "OS",
    CN: "CN",
    NETWORKING: "CN",
    OOP: "OOPS",
    OOPS: "OOPS",
};

function normalizeCSTopics(topics?: string[]): string[] {
    const normalized = Array.isArray(topics)
        ? topics
            .map((topic) => CS_TOPIC_ALIASES[String(topic || "").trim().toUpperCase()])
            .filter((topic): topic is string => Boolean(topic))
        : [];

    return normalized.filter((topic, index) => normalized.indexOf(topic) === index);
}

/**
 * Pre-fetches CS fundamentals questions for a session.
 * - Loads random questions for explicitly selected theory topics.
 * - Excludes questions this user has seen in any previous session
 * - Loads 1 random SQL question
 * @param persistSessionQuestions - if true, writes SessionQuestion rows immediately.
 *   Default is false so theory/SQL rows are recorded only when actually asked.
 */
export async function prefetchCSFundamentalsQuestions(
    sessionId: string,
    userId: string,
    label: string = "Orchestrator",
    persistSessionQuestions: boolean = false,
    options: CSPrefetchOptions = {}
): Promise<CSPrefetchResult> {
    const questionsMap = new Map<string, CSQuestionEntry[]>();

    // â”€â”€ Load all CS fundamental question IDs this user has seen in any past session â”€
    const prevIds = await getSeenQuestionIds(userId, "cs_fundamental", {
        category: "cs_fundamentals",
        idField: "questionFundamentalId",
    });
    const excludeObjectIds = toMongoObjectIds(prevIds);

    console.log(`[${label}] Excluding ${excludeObjectIds.length} previously seen CS fundamental questions for user ${userId}`);

    // Fetch exactly the selected topics from user config. If dedupe excludes too
    // many previous questions, top up from the same topic only; never pull an
    // unrelated CS topic into a modular session.
    const requestedTopics = normalizeCSTopics(options.topics);
    const topics = Array.isArray(options.topics)
        ? requestedTopics
        : ["DBMS", "OS", "CN", "OOPS"];
    const newFundamentalIds: string[] = [];
    const configuredCount = typeof options.questionCountPerTopic === "number"
        ? Math.min(3, Math.max(1, Math.floor(options.questionCountPerTopic)))
        : undefined;
    const sampleSizePerTopic = configuredCount ?? (persistSessionQuestions ? 3 : 2);

    const topicResults = await Promise.all(
        topics.map(async (topic) => {
            const matchStage: any = { topic };
            if (excludeObjectIds.length > 0) {
                matchStage._id = { $nin: excludeObjectIds };
            }
            let rawDocs = await CSFundamentalQuestion.aggregate([
                { $match: matchStage },
                { $sample: { size: sampleSizePerTopic } },
            ]);

            if (rawDocs.length < sampleSizePerTopic && excludeObjectIds.length > 0) {
                const selectedIds = rawDocs.map((doc: any) => doc._id);
                const topUpDocs = await findLeastRecentlySeenMongoDocs(
                    CSFundamentalQuestion,
                    userId,
                    "cs_fundamental",
                    {
                        topic,
                        ...(selectedIds.length > 0 ? { _id: { $nin: selectedIds } } : {}),
                    },
                    sampleSizePerTopic - rawDocs.length
                );
                rawDocs = [...rawDocs, ...topUpDocs];
            }
            if (rawDocs.length < sampleSizePerTopic) {
                const selectedIds = rawDocs.map((doc: any) => doc._id);
                const topicFallbackDocs = await findRandomMongoDocs(
                    CSFundamentalQuestion,
                    {
                        topic,
                        ...(selectedIds.length > 0 ? { _id: { $nin: selectedIds } } : {}),
                    },
                    sampleSizePerTopic - rawDocs.length
                );
                if (topicFallbackDocs.length > 0) {
                    console.warn(`[${label}] CS topic ${topic}: exposure fallback exhausted; used random topic fallback.`);
                    rawDocs = [...rawDocs, ...topicFallbackDocs];
                }
            }
            if (rawDocs.length < sampleSizePerTopic) {
                const selectedIds = rawDocs.map((doc: any) => doc._id);
                const anyDocs = await findRandomMongoDocs(
                    CSFundamentalQuestion,
                    selectedIds.length > 0 ? { _id: { $nin: selectedIds } } : {},
                    sampleSizePerTopic - rawDocs.length
                );
                if (anyDocs.length > 0) {
                    console.warn(`[${label}] CS topic ${topic}: topic pool exhausted; used any random CS fundamental fallback.`);
                    rawDocs = [...rawDocs, ...anyDocs];
                }
            }
            return { topic, rawDocs };
        })
    );

    for (const { topic, rawDocs } of topicResults) {
        const questions: CSQuestionEntry[] = rawDocs.map((doc: any) => ({
            questionId: doc._id.toString(),
            questionText: doc.question,
            referenceAnswer: doc.answer,
        }));
        questionsMap.set(topic, questions);
        questions.forEach(q => newFundamentalIds.push(q.questionId));
        console.log(`[${label}] Pre-fetched ${questions.length}/${sampleSizePerTopic} ${topic} questions (${excludeObjectIds.length} excluded)`);
        if (questions.length < sampleSizePerTopic) {
            console.warn(`[${label}] CS topic ${topic} has only ${questions.length} available questions; requested ${sampleSizePerTopic}.`);
        }
    }

    // ── Fetch SQL question (with session persistence) ─────────────────────
    let prefetchedSQLQuestion: any | null = null;
    const sqlCacheEntry = new Map<string, any>();

    let existingSessionSQL: { questionSqlId: string | null } | null = null;
    let rawSqlDoc: any = null;
    if (options.includeSQL !== false) {
        existingSessionSQL = await prisma.sessionQuestion.findFirst({
            where: {
                sessionId,
                questionSqlId: { not: null },
            },
            select: { questionSqlId: true },
        });

        if (existingSessionSQL?.questionSqlId) {
            rawSqlDoc = await SQLQuestion.findById(existingSessionSQL.questionSqlId).lean();
            if (rawSqlDoc) {
                console.log(`[${label}] Reusing existing SQL question for session ${sessionId}: "${rawSqlDoc.title}"`);
            }
        }

        if (!rawSqlDoc) {
            const seenSqlIds = await getSeenQuestionIds(userId, "cs_sql", {
                category: ["SQL", "sql"],
                idField: "questionSqlId",
            });
            const sqlExcludeObjectIds = toMongoObjectIds(seenSqlIds);
            const sqlMatchStage = sqlExcludeObjectIds.length > 0
                ? { _id: { $nin: sqlExcludeObjectIds } }
                : {};

            [rawSqlDoc] = await SQLQuestion.aggregate([
                { $match: sqlMatchStage },
                { $sample: { size: 1 } },
            ]);

            if (!rawSqlDoc && sqlExcludeObjectIds.length > 0) {
                rawSqlDoc = await findLeastRecentlySeenMongoDoc(SQLQuestion, userId, "cs_sql");
            }
            if (!rawSqlDoc) {
                rawSqlDoc = await findRandomMongoDoc(SQLQuestion);
                if (rawSqlDoc) {
                    console.warn(`[${label}] CS SQL pool exhausted; used any random SQL fallback.`);
                }
            }
        }
    }
    if (rawSqlDoc) {
        const sqlDoc = await SQLQuestion.findById(rawSqlDoc._id);
        if (sqlDoc) {
            const normalizedSql = normalizeSQLQuestion(sqlDoc);
            prefetchedSQLQuestion = normalizedSql;
            sqlCacheEntry.set(normalizedSql.id, normalizedSql);

            questionsMap.set("SQL_query", [{
                questionId: normalizedSql.id,
                questionText: normalizedSql.title + ": " + normalizedSql.description,
                referenceAnswer: typeof normalizedSql.solution === "string"
                    ? normalizedSql.solution
                    : JSON.stringify(normalizedSql.solution),
            }]);

            if (!existingSessionSQL) {
                console.log(`[${label}] Pre-fetched NEW SQL question: "${normalizedSql.title}"`);
            }
        }
    }

    // ── Record selected theory questions in session_questions immediately ──
    // Optional legacy mode: create rows up front.
    // Default mode (persistSessionQuestions=false) keeps rows write-on-ask only.
    if (persistSessionQuestions && newFundamentalIds.length > 0) {
        // Build a lookup: questionId â†’ referenceAnswer (across all non-SQL topics)
        const answerByQuestionId = new Map<string, string>();
        for (const [cat, questions] of questionsMap) {
            if (cat === "SQL_query") continue;
            for (const q of questions) {
                answerByQuestionId.set(q.questionId, q.referenceAnswer);
            }
        }

        await prisma.sessionQuestion.createMany({
            data: newFundamentalIds.map(id => ({
                sessionId,
                questionFundamentalId: id,
                sampleAnswer: answerByQuestionId.get(id) ?? null,
            })),
            skipDuplicates: true,
        });
        console.log(`[${label}] Saved ${newFundamentalIds.length} fundamental question IDs to session_questions (with sampleAnswer)`);
    } else if (newFundamentalIds.length > 0) {
        console.log(`[${label}] Skipping upfront session_questions persistence for ${newFundamentalIds.length} fundamental questions (write-on-ask mode)`);
    }

    // â”€â”€ Also record the SQL question with its sampleAnswer â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Same guard applies to SQL in write-on-ask mode.
    if (persistSessionQuestions && prefetchedSQLQuestion) {
        const sqlAnswer = typeof prefetchedSQLQuestion.solution === "string"
            ? prefetchedSQLQuestion.solution
            : JSON.stringify(prefetchedSQLQuestion.solution, null, 2);
        await prisma.sessionQuestion.create({
            data: {
                sessionId,
                questionSqlId: prefetchedSQLQuestion.id,
                sampleAnswer: sqlAnswer ?? null,
            },
        });
        console.log(`[${label}] Saved SQL question "${prefetchedSQLQuestion.title}" to session_questions (with sampleAnswer)`);
    }

    return { questionsMap, prefetchedSQLQuestion, sqlCacheEntry };
}
