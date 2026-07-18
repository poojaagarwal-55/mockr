// ============================================
// Gen AI Role — Question Pre-fetch Utility
// ============================================
// Shared between the text orchestrator and the voice pipeline.
// Fetches GenAI concept questions and one coding task from MongoDB
// with cross-session deduplication via durable user_question_exposures.
//
// Deduplication strategy:
//   - Load durable user_question_exposures for this user/source
//   - Use MongoDB $nin to exclude them
//   - If pool runs dry → repeat the user's least-recently-seen question
//
// Concept question fetching is DB-adaptive:
//   - Discovers which subtopics exist in the DB at runtime
//   - Treats requested subtopics as priority, not as a hard filter
//   - Tries to get 1 question per priority/available subtopic, tops up to 7 total
//   - Works correctly even with just 1-2 questions in the DB

import { prisma } from "../../lib/prisma.js";
import { GenAIConceptQuestion } from "../../models/GenAIConceptQuestion.js";
import { GenAICodingQuestion } from "../../models/GenAICodingQuestion.js";
import { GenAISystemDesignQuestion } from "../../models/GenAISystemDesignQuestion.js";
import { findLeastRecentlySeenMongoDoc, findLeastRecentlySeenMongoDocs, findRandomMongoDoc, findRandomMongoDocs, getSeenQuestionIds, toMongoObjectIds } from "../question-exposure.js";

export type GenAIConceptEntry = {
    questionId: string;
    subtopic: string;
    questionText: string;
    /** Concise reference answer — LLM uses for silent evaluation only */
    referenceAnswer: string;
    // detailedAnswer intentionally excluded — post-session reports only
    difficulty: string;
};

export type GenAICodingEntry = {
    questionId: string;
    title: string;
    taskType: string;
    problemStatement: string;
    /** Shown in IDE to candidate */
    starterCode?: string;
    /** Shown in IDE to candidate */
    sampleTestCases: Array<{ id: string; description: string; input: string; expectedOutput: string }>;
    /** LLM-only: compact textual grounding for candidate-code evaluation */
    conciseSolution: string;
    /** LLM-only: rubric for silent evaluation */
    evaluationCriteria: string;
    /** LLM asks 1–2 after candidate runs tests */
    mutationQuestions: string[];
    /** LLM gives progressively when candidate is stuck */
    hints: string[];
    // detailedSolution intentionally excluded — post-session reports only
    difficulty: string;
};

export type GenAISystemDesignEntry = {
    questionId: string;
    category: string;
    title: string;
    problemStatement: string;
    difficulty: string;
    /** Lightweight rubric — given to LLM silently during the interview */
    rubricLite: {
        requiredComponents: string[];
        keyTradeoffs: string[];
        antiPatterns: string[];
        probeQuestions: string[];
    };
    // rubricFull is intentionally excluded — used only post-session in reports
};

export type GenAIPrefetchResult = {
    /** Up to 7 concept questions, 1 per available subtopic + top-up */
    conceptQuestions: GenAIConceptEntry[];
    /** 1 coding task */
    codingQuestion: GenAICodingEntry | null;
    /** 1 system design architecture problem */
    systemDesignQuestion: GenAISystemDesignEntry | null;
};

export type GenAIPrefetchOptions = {
    includeConcepts?: boolean;
    includeCoding?: boolean;
    includeSystemDesign?: boolean;
    conceptSubtopics?: string[];
    difficultyBands?: string[];
};

// Target: up to this many concept questions per session
const TARGET_CONCEPT_QUESTIONS = 7;

/**
 * Pre-fetches all GenAI role questions for a session.
 *
 * Concept questions:
 *   - Discovers subtopics present in DB via distinct() — no hardcoded list
 *   - Fetches 1 question per subtopic (deduped across sessions)
 *   - Tops up to TARGET_CONCEPT_QUESTIONS with any remaining unseen questions
 *   - Falls back to the user's least-recently-seen question if dedup exhausts a subtopic
 *
 * Coding question:
 *   - Random sample from GenAICodingQuestion collection (deduped)
 */
export async function prefetchGenAIQuestions(
    sessionId: string,
    userId: string,
    label: string = "GenAIPrefetch",
    options: GenAIPrefetchOptions = {}
): Promise<GenAIPrefetchResult> {
    const includeConcepts = options.includeConcepts ?? true;
    const includeCoding = options.includeCoding ?? true;
    const includeSystemDesign = options.includeSystemDesign ?? true;
    const difficultyFilter = Array.isArray(options.difficultyBands) && options.difficultyBands.length > 0
        ? { difficulty: { $in: options.difficultyBands } }
        : {};

    // ── Load all fundamental question IDs this user has seen ─────────────
    const seenConceptIds = await getSeenQuestionIds(userId, "genai_concept", {
        category: "genai_concepts",
        idField: "questionFundamentalId",
    });
    const seenCodingIds = await getSeenQuestionIds(userId, "genai_coding", {
        category: "genai_coding",
        idField: "questionFundamentalId",
    });
    const seenSystemDesignIds = await getSeenQuestionIds(userId, "genai_system_design", {
        category: "genai_system_design",
        idField: "questionFundamentalId",
    });

    const excludeObjectIds = toMongoObjectIds(seenConceptIds);
    const codingExcludeObjectIds = toMongoObjectIds(seenCodingIds);
    const sdExcludeObjectIds = toMongoObjectIds(seenSystemDesignIds);

    console.log(`[${label}] Excluding ${excludeObjectIds.length} previously seen questions for user ${userId}`);

    // ── Concept questions — DB-adaptive, no hardcoded subtopic list ───────
    const conceptQuestions: GenAIConceptEntry[] = [];

    // Step 1: Discover what subtopics actually exist in the collection
    const requestedSubtopics = Array.isArray(options.conceptSubtopics)
        ? options.conceptSubtopics.filter(Boolean)
        : [];
    const availableSubtopics: string[] = includeConcepts
        ? await GenAIConceptQuestion.distinct("subtopic")
        : [];
    const preferredSubtopics = requestedSubtopics.length
        ? availableSubtopics.filter((subtopic) => requestedSubtopics.includes(subtopic))
        : availableSubtopics;
    const primarySubtopics = preferredSubtopics.length > 0 ? preferredSubtopics : availableSubtopics;
    if (includeConcepts) {
        console.log(
            `[${label}] Subtopics found in DB: [${availableSubtopics.join(", ") || "none"}], ` +
            `priority: [${preferredSubtopics.join(", ") || "auto"}]`
        );
    }

    if (primarySubtopics.length > 0) {
        // Fetch 1 question per priority subtopic. If no priority was selected,
        // this naturally becomes 1 per available subtopic.
        const subtopicResults = await Promise.all(
            primarySubtopics.map(async (subtopic) => {
                const matchStage: any = { subtopic, ...difficultyFilter };
                if (excludeObjectIds.length > 0) {
                    matchStage._id = { $nin: excludeObjectIds };
                }

                let rawDocs = await GenAIConceptQuestion.aggregate([
                    { $match: matchStage },
                    { $sample: { size: 1 } },
                ]);

                // Fallback: if dedup cleared this subtopic, repeat the oldest seen item for it.
                if (rawDocs.length === 0 && excludeObjectIds.length > 0) {
                    console.log(`[${label}] Dedup exhausted "${subtopic}", using least-recently-seen fallback`);
                    rawDocs = await findLeastRecentlySeenMongoDocs(
                        GenAIConceptQuestion,
                        userId,
                        "genai_concept",
                        { subtopic, ...difficultyFilter },
                        1
                    );
                }

                if (rawDocs.length === 0) {
                    rawDocs = await findRandomMongoDocs(GenAIConceptQuestion, { subtopic }, 1);
                    if (rawDocs.length > 0) {
                        console.warn(`[${label}] GenAI concept "${subtopic}": difficulty/exposure filters exhausted; used random subtopic fallback.`);
                    }
                }

                if (rawDocs.length === 0) {
                    rawDocs = await findRandomMongoDocs(GenAIConceptQuestion, {}, 1);
                    if (rawDocs.length > 0) {
                        console.warn(`[${label}] GenAI concept "${subtopic}": subtopic pool exhausted; used any random concept fallback.`);
                    }
                }

                return { subtopic, rawDocs };
            })
        );

        for (const { subtopic, rawDocs } of subtopicResults) {
            for (const doc of rawDocs) {
                conceptQuestions.push({
                    questionId:      doc._id.toString(),
                    subtopic,
                    questionText:    doc.question,
                    referenceAnswer: doc.answer,
                    // detailedAnswer intentionally excluded — post-session reports only
                    difficulty:      doc.difficulty,
                });
            }
            if (rawDocs.length > 0) {
                console.log(`[${label}] Fetched 1 "${subtopic}" question`);
            } else {
                console.warn(`[${label}] No questions found for subtopic "${subtopic}"`);
            }
        }
    }

    // Step 2: Top up to TARGET if we have fewer questions than the target
    if (includeConcepts && conceptQuestions.length < TARGET_CONCEPT_QUESTIONS) {
        const alreadyFetchedIds = toMongoObjectIds(conceptQuestions.map(q => q.questionId));

        let topUpExclude = [...excludeObjectIds, ...alreadyFetchedIds];
        const needed = TARGET_CONCEPT_QUESTIONS - conceptQuestions.length;

        const priorityTopUpMatch: any = { ...difficultyFilter, ...(topUpExclude.length > 0 ? { _id: { $nin: topUpExclude } } : {}) };
        if (preferredSubtopics.length > 0) {
            priorityTopUpMatch.subtopic = { $in: preferredSubtopics };
        }

        const priorityTopUpDocs = preferredSubtopics.length > 0
            ? await GenAIConceptQuestion.aggregate([
                { $match: priorityTopUpMatch },
                { $sample: { size: needed } },
            ])
            : [];

        const priorityTopUpIds = toMongoObjectIds(priorityTopUpDocs.map(doc => String(doc._id)));

        topUpExclude = [...topUpExclude, ...priorityTopUpIds];
        const broadNeeded = needed - priorityTopUpDocs.length;
        const broadTopUpMatch: any = { ...difficultyFilter, ...(topUpExclude.length > 0 ? { _id: { $nin: topUpExclude } } : {}) };
        const broadTopUpDocs = broadNeeded > 0
            ? await GenAIConceptQuestion.aggregate([
                { $match: broadTopUpMatch },
                { $sample: { size: broadNeeded } },
            ])
            : [];

        const topUpDocs = [...priorityTopUpDocs, ...broadTopUpDocs];
        const remainingAfterUnseenTopUp = needed - topUpDocs.length;
        if (remainingAfterUnseenTopUp > 0) {
            const alreadySelectedIds = toMongoObjectIds([
                ...conceptQuestions.map(q => q.questionId),
                ...topUpDocs.map(doc => String(doc._id)),
            ]);
            topUpDocs.push(...await findLeastRecentlySeenMongoDocs(
                GenAIConceptQuestion,
                userId,
                "genai_concept",
                { ...difficultyFilter, ...(alreadySelectedIds.length > 0 ? { _id: { $nin: alreadySelectedIds } } : {}) },
                remainingAfterUnseenTopUp
            ));
        }
        const remainingAfterSeenTopUp = needed - topUpDocs.length;
        if (remainingAfterSeenTopUp > 0) {
            const alreadySelectedIds = toMongoObjectIds([
                ...conceptQuestions.map(q => q.questionId),
                ...topUpDocs.map(doc => String(doc._id)),
            ]);
            const anyTopUpDocs = await findRandomMongoDocs(
                GenAIConceptQuestion,
                alreadySelectedIds.length > 0 ? { _id: { $nin: alreadySelectedIds } } : {},
                remainingAfterSeenTopUp
            );
            if (anyTopUpDocs.length > 0) {
                console.warn(`[${label}] GenAI concept top-up filters exhausted; used any random concept fallback.`);
                topUpDocs.push(...anyTopUpDocs);
            }
        }

        for (const doc of topUpDocs) {
            conceptQuestions.push({
                questionId:      doc._id.toString(),
                subtopic:        doc.subtopic,
                questionText:    doc.question,
                referenceAnswer: doc.answer,
                // detailedAnswer intentionally excluded — post-session reports only
                difficulty:      doc.difficulty,
            });
        }

        if (topUpDocs.length > 0) {
            console.log(
                `[${label}] Topped up with ${topUpDocs.length} additional questions` +
                (broadTopUpDocs.length > 0 ? ` (${broadTopUpDocs.length} outside priority subtopics)` : "")
            );
        }
    }

    if (includeConcepts) {
        console.log(`[${label}] Total concept questions fetched: ${conceptQuestions.length}`);
    }

    // ── Coding task (with session persistence) ────────────────────────────
    let codingQuestion: GenAICodingEntry | null = null;

    let existingSessionCoding: { questionFundamentalId: string | null } | null = null;
    let rawCodingDoc: any = null;
    const codingPromptProjection = {
        title: 1,
        taskType: 1,
        problemStatement: 1,
        starterCode: 1,
        sampleTestCases: 1,
        sampleSolution: 1,
        conciseSolution: 1,
        evaluationCriteria: 1,
        mutationQuestions: 1,
        hints: 1,
        difficulty: 1,
    };
    if (includeCoding) {
        existingSessionCoding = await prisma.sessionQuestion.findFirst({
        where: {
            sessionId: sessionId,
            questionCategory: "genai_coding",
            questionFundamentalId: { not: null },
        },
        select: { questionFundamentalId: true },
    });

    if (existingSessionCoding?.questionFundamentalId) {
        rawCodingDoc = await GenAICodingQuestion.findById(existingSessionCoding.questionFundamentalId)
            .select(codingPromptProjection)
            .lean();
        if (rawCodingDoc) {
            console.log(`[${label}] Reusing existing coding task for session ${sessionId}: "${rawCodingDoc.title}"`);
        }
    }

    if (!rawCodingDoc) {
        const codingMatchStage: any = { ...difficultyFilter };
        if (codingExcludeObjectIds.length > 0) {
            codingMatchStage._id = { $nin: codingExcludeObjectIds };
        }

        [rawCodingDoc] = await GenAICodingQuestion.aggregate([
            { $match: codingMatchStage },
            { $sample: { size: 1 } },
            { $project: codingPromptProjection },
        ]);

        if (!rawCodingDoc) {
            // Pool exhausted: repeat the oldest seen item for this user/source.
            rawCodingDoc = await findLeastRecentlySeenMongoDoc(
                GenAICodingQuestion,
                userId,
                "genai_coding",
                difficultyFilter,
                codingPromptProjection
            );
        }
        if (!rawCodingDoc) {
            rawCodingDoc = await findRandomMongoDoc(GenAICodingQuestion, {}, codingPromptProjection);
            if (rawCodingDoc) {
                console.warn(`[${label}] GenAI coding difficulty/exposure filters exhausted; used any random coding fallback.`);
            }
        }
    }

    if (rawCodingDoc) {
        codingQuestion = {
            questionId:         rawCodingDoc._id.toString(),
            title:              rawCodingDoc.title,
            taskType:           rawCodingDoc.taskType,
            problemStatement:   rawCodingDoc.problemStatement,
            starterCode:        rawCodingDoc.starterCode,
            sampleTestCases:    rawCodingDoc.sampleTestCases ?? [],
            conciseSolution:    rawCodingDoc.sampleSolution || rawCodingDoc.conciseSolution || rawCodingDoc.evaluationCriteria,
            evaluationCriteria: rawCodingDoc.evaluationCriteria,
            mutationQuestions:  rawCodingDoc.mutationQuestions ?? [],
            hints:              rawCodingDoc.hints ?? [],
            // detailedSolution intentionally excluded — post-session reports only
            difficulty:         rawCodingDoc.difficulty,
        };
        if (!existingSessionCoding) {
            console.log(`[${label}] Pre-fetched NEW coding task: "${rawCodingDoc.title}"`);
        }
    } else {
        console.warn(`[${label}] No GenAI coding question found in DB`);
    }
    }

    // ── System Design question (with session persistence) ─────────────────
    let systemDesignQuestion: GenAISystemDesignEntry | null = null;

    let existingSessionSD: { questionId: string | null } | null = null;
    let rawSDDoc: any = null;
    if (includeSystemDesign) {
        existingSessionSD = await prisma.sessionQuestion.findFirst({
        where: {
            sessionId: sessionId,
            questionCategory: "system_design",
            questionId: { not: null },
        },
        select: { questionId: true },
    });

    if (existingSessionSD?.questionId) {
        rawSDDoc = await GenAISystemDesignQuestion.findById(existingSessionSD.questionId).lean();
        if (rawSDDoc) {
            console.log(`[${label}] Reusing existing system design question for session ${sessionId}: "${rawSDDoc.title}"`);
        }
    }

    if (!rawSDDoc) {
        const sdMatchStage: any = { ...difficultyFilter };
        if (sdExcludeObjectIds.length > 0) {
            sdMatchStage._id = { $nin: sdExcludeObjectIds };
        }

        [rawSDDoc] = await GenAISystemDesignQuestion.aggregate([
            { $match: sdMatchStage },
            { $sample: { size: 1 } },
        ]);

        if (!rawSDDoc) {
            // Pool exhausted: repeat the oldest seen item for this user/source.
            rawSDDoc = await findLeastRecentlySeenMongoDoc(
                GenAISystemDesignQuestion,
                userId,
                "genai_system_design",
                difficultyFilter
            );
        }
        if (!rawSDDoc) {
            rawSDDoc = await findRandomMongoDoc(GenAISystemDesignQuestion);
            if (rawSDDoc) {
                console.warn(`[${label}] GenAI system design difficulty/exposure filters exhausted; used any random system design fallback.`);
            }
        }
    }

    if (rawSDDoc) {
        systemDesignQuestion = {
            questionId:       rawSDDoc._id.toString(),
            category:         rawSDDoc.category,
            title:            rawSDDoc.title,
            problemStatement: rawSDDoc.problemStatement,
            difficulty:       rawSDDoc.difficulty,
            // rubricLite only — rubricFull is intentionally excluded (post-session reports only)
            rubricLite: {
                requiredComponents: rawSDDoc.rubricLite?.requiredComponents ?? [],
                keyTradeoffs:       rawSDDoc.rubricLite?.keyTradeoffs ?? [],
                antiPatterns:       rawSDDoc.rubricLite?.antiPatterns ?? [],
                probeQuestions:     rawSDDoc.rubricLite?.probeQuestions ?? [],
            },
        };
        if (!existingSessionSD) {
            console.log(`[${label}] Pre-fetched NEW system design problem: "${rawSDDoc.title}"`);
        }
    } else {
        console.warn(`[${label}] No GenAI system design question found in DB — LLM will generate dynamically`);
    }

    }

    return { conceptQuestions, codingQuestion, systemDesignQuestion };
}
