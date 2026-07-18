// ============================================
// Data Science Role — Question Pre-fetch Utility
// ============================================
// Shared between the text orchestrator and the voice pipeline.
// Fetches DS concept questions, one SQL task, and one coding task
// from MongoDB with cross-session deduplication via durable
// user_question_exposures.
//
// Distribution:
//   DS_CONCEPTS:  8 questions across subtopics
//   DS_SQL:       1 SQL problem set
//   DS_CODING:    1 Python/Pandas coding task

import { prisma } from "../../lib/prisma.js";
import { DSConceptQuestion } from "../../models/DSConceptQuestion.js";
import { SQLQuestion } from "../../models/SQLQuestion.js";
import { DSCodingQuestion } from "../../models/DSCodingQuestion.js";
import { findLeastRecentlySeenMongoDoc, findLeastRecentlySeenMongoDocs, findRandomMongoDoc, findRandomMongoDocs, getSeenQuestionIds, toMongoObjectIds } from "../question-exposure.js";

// ── Exported Types ────────────────────────────────────────────

export type DSConceptEntry = {
    questionId: string;
    topic: string;
    category: string;
    difficulty: string;
    question: string;
    referenceAnswer: string;
    followUpChain?: string[];
    redFlags?: string[];
};

export type DSSQLEntry = {
    questionId: string;
    title: string;
    /** Human-readable problem text shown to LLM for introduction */
    description: string;
    /** Plain-text schema string (e.g. "Table: Views\n- article_id (INT)...") */
    schema: string;
    /** example rows — shown in context block */
    examples: { input: any; output: any; explanation?: string }[];
    /** Visible test cases shown to candidate in the editor */
    testCases: { id: number | string; label: string; input: any; expected_output: any }[];
    /** Hidden test cases — LLM-only, drive scoring */
    hiddenTestCases: { id: string; label: string; expected_output: any; wrapper_code: string }[];
    /** LLM-only solution, NEVER reveal */
    solution: string;
    /** Judge0 language ID (89 = PostgreSQL) */
    judge0LanguageId: number;
    /** Wrapper injected around user query for execution */
    wrapperCode: string;
};

export type DSCodingEntry = {
    // ── Identity ─────────────────────────────────────────
    questionId: string;
    title: string;
    difficulty: "Easy" | "Medium" | "Hard";
    category: string;
    tags: string[];

    // ── Problem ──────────────────────────────────────────
    description: string;           // rich HTML/markdown, shown to candidate
    datasetUrl: string;            // reference only (sklearn, kaggle, etc.)

    // ── Code ─────────────────────────────────────────────
    starterCode: string;           // shown to candidate
    hiddenCodeBefore: string;      // injected before — setup, imports, data loading
    hiddenCodeAfter: string;       // injected after — assertions + JSON output

    // ── Ground Truth ─────────────────────────────────────
    solution: string;              // Full solution, retained for report/session persistence
    conciseSolution?: string;      // Live LLM grounding, never shown to candidate

    // ── Test Cases ───────────────────────────────────────
    sampleTestCases: SampleTestCase[];   // shown to candidate
    hiddenTestCases: HiddenTestCase[];   // drives scoring

    // ── Interview Layer (LLM-driven) ──────────────────────
    hints: string[];
    probingQuestions: string[];          // ADD THIS
    interviewNotes?: string;             // ADD THIS — optional qualitative rubric

    // ── Execution Constraints ────────────────────────────
    timeLimit: number;             // seconds
    memoryLimit: number;           // MB

    metadata: QuestionMetadata;
};

type SampleTestCase = {
    id: string;
    description: string;
    input: string;
    output: string;
};

type HiddenTestCase = {
    id: string;
    name: string;
    description: string;
    validationType: "field_check" | "field_equality" | "threshold";
    field?: string;
    field1?: string;
    field2?: string;
    expectedValue?: any;
    operator?: ">=" | "<=" | "==" | ">" | "<";
    threshold?: number;
    points: number;
};

type QuestionMetadata = {
    author: string;
    createdAt: string;             // ISO date
    version: string;
    datasetSource: string;
    datasetSize: number;
    numFeatures: number;
    trainTestSplit: string;
    randomState: number;
    targetColumn: string;
    classDistribution: string;
    concepts: string[];
    // expected outputs — useful for LLM to sanity-check candidate explanations
    expectedAccuracy: number;
    expectedVarianceExplained?: number;
};

export type DSPrefetchResult = {
    /** Concept questions distributed across selected/default subtopics */
    conceptQuestions: DSConceptEntry[];
    /** 1 SQL problem set */
    sqlQuestion: DSSQLEntry | null;
    /** 1 Python/Pandas coding task */
    codingQuestion: DSCodingEntry | null;
};

export type DSPrefetchOptions = {
    includeConcepts?: boolean;
    includeSQL?: boolean;
    includeCoding?: boolean;
    conceptCategories?: string[];
    difficultyBands?: string[];
};

// 2 questions drawn from each category = 8 total. The interviewer asks 4-5,
// and only those asked are persisted through record_question/auto-recording.
const CONCEPT_CATEGORY_DISTRIBUTION: Record<string, number> = {
    statistics:         2,
    ml_fundamentals:    2,
    deep_learning:      2,
    tabular_techniques: 2,
    probabilistic_models: 1,
    reinforcement_learning: 1,
};

function getConceptFetchCount(category: string, selectedCategoryCount: number): number {
    const defaultCount = CONCEPT_CATEGORY_DISTRIBUTION[category] || 2;
    if (selectedCategoryCount <= 0) return defaultCount;

    // If the candidate explicitly selects DS topics, give each selected topic
    // enough priority without changing the phase's ask budget.
    return 2;
}

/**
 * Pre-fetches all Data Science role questions for a session.
 * - Concept questions across selected/default subtopics (deduped)
 * - 1 SQL problem set (deduped)
 * - 1 Python coding task (deduped)
 */
export async function prefetchDSQuestions(
    sessionId: string,
    userId: string,
    label: string = "DSPrefetch",
    options: DSPrefetchOptions = {}
): Promise<DSPrefetchResult> {
    const includeConcepts = options.includeConcepts ?? true;
    const includeSQL = options.includeSQL ?? true;
    const includeCoding = options.includeCoding ?? true;
    const difficultyFilter = Array.isArray(options.difficultyBands) && options.difficultyBands.length > 0
        ? { difficulty: { $in: options.difficultyBands } }
        : {};

    // ── Load all question IDs this user has seen ──────────────────────────
    const seenConceptIds = await getSeenQuestionIds(userId, "ds_concept", {
        category: "ds_concepts",
        idField: "questionFundamentalId",
    });
    const seenSqlIds = await getSeenQuestionIds(userId, "ds_sql", {
        category: "ds_sql",
        idField: "questionSqlId",
    });
    const seenCodingIds = await getSeenQuestionIds(userId, "ds_coding", {
        category: "ds_coding",
        idField: "questionFundamentalId",
    });

    const excludeObjectIds = toMongoObjectIds(seenConceptIds);
    const sqlExcludeObjectIds = toMongoObjectIds(seenSqlIds);
    const codingExcludeObjectIds = toMongoObjectIds(seenCodingIds);

    console.log(`[${label}] Excluding ${excludeObjectIds.length} previously seen questions for user ${userId}`);

    // ── Fetch concept questions per subtopic ──────────────────────────────
    const conceptQuestions: DSConceptEntry[] = [];

    const selectedConceptCategories = Array.isArray(options.conceptCategories) && options.conceptCategories.length > 0
        ? options.conceptCategories.filter((category) => Object.prototype.hasOwnProperty.call(CONCEPT_CATEGORY_DISTRIBUTION, category))
        : Object.keys(CONCEPT_CATEGORY_DISTRIBUTION);

    const categoryResults = includeConcepts ? await Promise.all(
        selectedConceptCategories.map(async (category) => {
            const count = getConceptFetchCount(category, selectedConceptCategories.length);
            const matchStage: any = { category, ...difficultyFilter };
            if (excludeObjectIds.length > 0) {
                matchStage._id = { $nin: excludeObjectIds };
            }

            let rawDocs = await DSConceptQuestion.aggregate([
                { $match: matchStage },
                { $sample: { size: count } },
            ]);

            // Graceful top-up if exposure/difficulty filters underfill the selected topic.
            if (rawDocs.length < count) {
                console.log(`[${label}] Pool underfilled for category=${category}, using least-recently-seen fallback`);
                const selectedIds = rawDocs.map((doc: any) => doc._id);
                const fallbackDocs = await findLeastRecentlySeenMongoDocs(
                    DSConceptQuestion,
                    userId,
                    "ds_concept",
                    {
                        category,
                        ...difficultyFilter,
                        ...(selectedIds.length > 0 ? { _id: { $nin: selectedIds } } : {}),
                    },
                    count - rawDocs.length
                );
                rawDocs = [...rawDocs, ...fallbackDocs];
            }

            if (rawDocs.length < count) {
                const selectedIds = rawDocs.map((doc: any) => doc._id);
                const categoryFallbackDocs = await findRandomMongoDocs(
                    DSConceptQuestion,
                    {
                        category,
                        ...(selectedIds.length > 0 ? { _id: { $nin: selectedIds } } : {}),
                    },
                    count - rawDocs.length
                );
                if (categoryFallbackDocs.length > 0) {
                    console.warn(`[${label}] DS concept category=${category}: difficulty/exposure filters exhausted; used random category fallback.`);
                    rawDocs = [...rawDocs, ...categoryFallbackDocs];
                }
            }

            if (rawDocs.length < count) {
                const selectedIds = rawDocs.map((doc: any) => doc._id);
                const anyFallbackDocs = await findRandomMongoDocs(
                    DSConceptQuestion,
                    selectedIds.length > 0 ? { _id: { $nin: selectedIds } } : {},
                    count - rawDocs.length
                );
                if (anyFallbackDocs.length > 0) {
                    console.warn(`[${label}] DS concept category=${category}: category pool exhausted; used any random DS concept fallback.`);
                    rawDocs = [...rawDocs, ...anyFallbackDocs];
                }
            }

            return { category, rawDocs };
        })
    ) : [];

    for (const { category, rawDocs } of categoryResults) {
        for (const doc of rawDocs) {
            conceptQuestions.push({
                questionId:       doc._id.toString(),
                topic:           doc.topic ?? "",
                category:        doc.category ?? category,
                difficulty:      doc.difficulty,
                question:        doc.question,
                referenceAnswer: doc.referenceAnswer,
                followUpChain:   doc.followUpChain ?? [],
                redFlags:        doc.redFlags ?? [],
            });
        }
        console.log(`[${label}] Pre-fetched ${rawDocs.length} ${category} concept question(s)`);
    }

    // ── Fetch SQL question from shared sql_questions collection (with session persistence) ─
    let sqlQuestion: DSSQLEntry | null = null;

    let existingSessionSQL: { questionSqlId: string | null; questionFundamentalId: string | null; questionTitle: string | null } | null = null;
    let rawSQLDoc: any = null;
    if (includeSQL) {
        existingSessionSQL = await prisma.sessionQuestion.findFirst({
        where: {
            sessionId: sessionId,
            OR: [
                { questionSqlId: { not: null } },
                { questionCategory: "ds_sql", questionFundamentalId: { not: null } },
            ],
        },
        select: {
            questionSqlId: true,
            questionFundamentalId: true,
            questionTitle: true,
        },
    });

    const existingSQLQuestionId = existingSessionSQL?.questionSqlId || existingSessionSQL?.questionFundamentalId;
    if (existingSQLQuestionId) {
        rawSQLDoc = await SQLQuestion.findById(existingSQLQuestionId).lean();
        if (rawSQLDoc) {
            console.log(`[${label}] Reusing existing SQL question for session ${sessionId}: "${rawSQLDoc.title}"`);
        }
    }

    if (!rawSQLDoc) {
        const sqlMatchStage: any = {};
        if (sqlExcludeObjectIds.length > 0) {
            sqlMatchStage._id = { $nin: sqlExcludeObjectIds };
        }

        [rawSQLDoc] = await SQLQuestion.aggregate([
            { $match: sqlMatchStage },
            { $sample: { size: 1 } },
        ]);

        if (!rawSQLDoc) {
            console.log(`[${label}] SQL pool exhausted, using least-recently-seen fallback`);
            rawSQLDoc = await findLeastRecentlySeenMongoDoc(SQLQuestion, userId, "ds_sql");
        }
        if (!rawSQLDoc) {
            rawSQLDoc = await findRandomMongoDoc(SQLQuestion);
            if (rawSQLDoc) {
                console.warn(`[${label}] DS SQL pool exhausted; used any random SQL fallback.`);
            }
        }
    }

    if (rawSQLDoc) {
        sqlQuestion = {
            questionId: rawSQLDoc._id.toString(),
            title: rawSQLDoc.title,
            description: rawSQLDoc.description,
            schema: rawSQLDoc.schema ?? "",
            examples: rawSQLDoc.examples ?? [],
            testCases: rawSQLDoc.testCases ?? [],
            hiddenTestCases: rawSQLDoc.hiddenTestCases ?? [],
            solution: typeof rawSQLDoc.solution === "string"
                ? rawSQLDoc.solution
                : JSON.stringify(rawSQLDoc.solution),
            judge0LanguageId: rawSQLDoc.judge0LanguageId,
            wrapperCode: rawSQLDoc.wrapperCode,
        };
        if (!existingSessionSQL) {
            console.log(`[${label}] Pre-fetched NEW SQL question: "${rawSQLDoc.title}"`);
        }
    } else {
        console.warn(`[${label}] No SQL question found in sql_questions collection`);
    }
    }

    // ── Fetch coding task (with session persistence) ──────────────────────
    let codingQuestion: DSCodingEntry | null = null;

    let existingSessionCoding: { questionFundamentalId: string | null; questionTitle: string | null } | null = null;
    let rawCodingDoc: any = null;
    if (includeCoding) {
        existingSessionCoding = await prisma.sessionQuestion.findFirst({
        where: {
            sessionId: sessionId,
            questionCategory: "ds_coding",
            questionFundamentalId: { not: null },
        },
        select: {
            questionFundamentalId: true,
            questionTitle: true,
        },
    });

    if (existingSessionCoding?.questionFundamentalId) {
        rawCodingDoc = await DSCodingQuestion.findById(existingSessionCoding.questionFundamentalId).lean();
        if (rawCodingDoc) {
            console.log(`[${label}] Reusing existing coding task for session ${sessionId}: "${rawCodingDoc.title}"`);
        }
    }

    if (!rawCodingDoc) {
        const codingMatchStage: any = { ...difficultyFilter };
        if (codingExcludeObjectIds.length > 0) {
            codingMatchStage._id = { $nin: codingExcludeObjectIds };
        }

        [rawCodingDoc] = await DSCodingQuestion.aggregate([
            { $match: codingMatchStage },
            { $sample: { size: 1 } },
        ]);

        if (!rawCodingDoc) {
            console.log(`[${label}] Coding pool exhausted, using least-recently-seen fallback`);
            rawCodingDoc = await findLeastRecentlySeenMongoDoc(DSCodingQuestion, userId, "ds_coding", difficultyFilter);
        }
        if (!rawCodingDoc) {
            rawCodingDoc = await findRandomMongoDoc(DSCodingQuestion);
            if (rawCodingDoc) {
                console.warn(`[${label}] DS coding difficulty/exposure filters exhausted; used any random DS coding fallback.`);
            }
        }
    }

    if (rawCodingDoc) {
        const description = rawCodingDoc.description ?? rawCodingDoc.problemStatement ?? "";
        const solution = rawCodingDoc.solution ?? rawCodingDoc.sampleSolution ?? "";
        const conciseSolution = rawCodingDoc.conciseSolution ?? "";
        const hiddenCodeAfter = rawCodingDoc.hiddenCodeAfter ?? rawCodingDoc.structuralAssertions ?? "";
        const metadata = rawCodingDoc.metadata ?? {
            dataSchema: rawCodingDoc.dataSchema ?? [],
            evaluationCriteria: rawCodingDoc.evaluationCriteria ?? "",
        };

        codingQuestion = {
            questionId:      rawCodingDoc._id.toString(),
            title:           rawCodingDoc.title,
            difficulty:      rawCodingDoc.difficulty,
            category:        rawCodingDoc.category ?? "",
            tags:            rawCodingDoc.tags ?? [],
            description,
            datasetUrl:      rawCodingDoc.datasetUrl ?? "",
            starterCode:     rawCodingDoc.starterCode,
            hiddenCodeBefore: rawCodingDoc.hiddenCodeBefore ?? "",
            hiddenCodeAfter,
            solution,
            conciseSolution,
            sampleTestCases: rawCodingDoc.sampleTestCases ?? [],
            hiddenTestCases: rawCodingDoc.hiddenTestCases ?? [],
            hints:           rawCodingDoc.hints ?? [],
            probingQuestions: rawCodingDoc.probingQuestions ?? [],
            interviewNotes:  rawCodingDoc.interviewNotes,
            timeLimit:       rawCodingDoc.timeLimit ?? 300,
            memoryLimit:     rawCodingDoc.memoryLimit ?? 512,
            metadata,
        };
        console.log(`[${label}] Pre-fetched DS coding task: "${rawCodingDoc.title}"`);
    } else {
        console.warn(`[${label}] No DS coding question found in DB`);
    }
    }

    return { conceptQuestions, sqlQuestion, codingQuestion };
}
