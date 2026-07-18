// ============================================
// PM Role — Question Pre-fetch Utility
// ============================================
// Fetches PM case, concept, and strategy questions from MongoDB
// at session initialization with cross-session deduplication via
// the durable user_question_exposures table.
//
// Deduplication strategy:
//   - Exclude questions seen in durable user_question_exposures
//   - If pool runs dry, try least-recently-seen durable exposure
//   - If exposure/filters cannot recover, pick any random valid PM question instead of failing init

import { prisma } from "../../lib/prisma.js";
import { PMCaseQuestion } from "../../models/PMCaseQuestion.js";
import { PMConceptQuestion } from "../../models/PMConceptQuestion.js";
import { PMStrategyQuestion } from "../../models/PMStrategyQuestion.js";
import { findLeastRecentlySeenMongoDocs, getSeenQuestionIds, toMongoObjectIds } from "../question-exposure.js";

export type PMCaseEntry = {
    questionId: string;
    title: string;
    scenario: string;
    constraintInjection: string;
    evaluationGuide: string;
    redFlags: string[];
    successSignals: string[];
    difficulty: string;
};

export type PMConceptEntry = {
    questionId: string;
    subtopic: string;
    question: string;
    scenarioContext?: string;
    evaluationGuide: string;
    redFlags: string[];
    successSignals: string[];
    difficulty: string;
};

export type PMStrategyEntry = {
    questionId: string;
    title: string;
    scenario: string;
    devilsAdvocateProbes: string[];
    evaluationGuide: string;
    redFlags: string[];
    successSignals: string[];
    difficulty: string;
};

export type PMPrefetchResult = {
    /** 1 product case question */
    caseQuestion: PMCaseEntry | null;
    /** 8 concept questions distributed across 6 subtopics */
    conceptQuestions: PMConceptEntry[];
    /** 1 product strategy question */
    strategyQuestion: PMStrategyEntry | null;
};

export type PMPrefetchOptions = {
    includeCase?: boolean;
    includeConcepts?: boolean;
    includeStrategy?: boolean;
    difficultyBands?: string[];
};

// Desired concept question distribution (total = 8)
const CONCEPT_SUBTOPIC_DISTRIBUTION: Record<string, number> = {
    MetricDefinition:     2,
    MetricInterpretation: 2,
    Prioritization:       1,
    SprintAwareness:      1,
    ExperimentDesign:     1,
    NorthStarFraming:     1,
};

function mergeMatchWithExcludedIds(match: Record<string, any>, excludedIds: any[]): Record<string, any> {
    if (excludedIds.length === 0) return { ...match };
    return match._id
        ? { $and: [match, { _id: { $nin: excludedIds } }] }
        : { ...match, _id: { $nin: excludedIds } };
}

async function samplePMDocs(
    model: any,
    match: Record<string, any>,
    count: number,
    excludeIds: any[] = []
): Promise<any[]> {
    return model.aggregate([
        { $match: mergeMatchWithExcludedIds(match, excludeIds) },
        { $sample: { size: Math.max(1, count) } },
    ]);
}

async function safePickPMDocs(params: {
    model: any;
    userId: string;
    source: "pm_case" | "pm_concept" | "pm_strategy";
    match: Record<string, any>;
    count: number;
    alreadyPickedIds?: Set<string>;
    label: string;
    description: string;
}): Promise<any[]> {
    const alreadyPickedIds = params.alreadyPickedIds ?? new Set<string>();
    const withoutAlreadyPicked = (docs: any[]) =>
        docs.filter((doc) => !alreadyPickedIds.has(String(doc?._id || ""))).slice(0, params.count);

    let docs = withoutAlreadyPicked(await findLeastRecentlySeenMongoDocs(
        params.model,
        params.userId,
        params.source,
        params.match,
        params.count + alreadyPickedIds.size
    ));
    if (docs.length >= params.count) return docs.slice(0, params.count);

    docs = withoutAlreadyPicked(await samplePMDocs(
        params.model,
        params.match,
        params.count + alreadyPickedIds.size
    ));
    if (docs.length > 0) {
        console.warn(`[${params.label}] ${params.description}: durable exposure unavailable/exhausted; used any random valid PM question.`);
        return docs.slice(0, params.count);
    }

    if (Object.keys(params.match).length > 0) {
        docs = withoutAlreadyPicked(await samplePMDocs(
            params.model,
            {},
            params.count + alreadyPickedIds.size
        ));
        if (docs.length > 0) {
            console.warn(`[${params.label}] ${params.description}: filters exhausted; used any random PM question from full collection.`);
        }
    }

    return docs.slice(0, params.count);
}

function normalizePMConceptDoc(doc: any, fallbackSubtopic: string): PMConceptEntry {
    const evaluationGuide =
        doc.evaluationGuide ||
        doc.answer ||
        doc.detailedAnswer ||
        "Evaluate for structured product thinking, trade-off awareness, and clear communication.";

    return {
        questionId:      doc._id.toString(),
        subtopic:        doc.subtopic || doc.topic || fallbackSubtopic || "General Product Management",
        question:        doc.question,
        scenarioContext: doc.scenarioContext,
        evaluationGuide,
        redFlags:        doc.redFlags ?? [],
        successSignals:  doc.successSignals ?? [],
        difficulty:      doc.difficulty || "Medium",
    };
}

function normalizePMCaseDoc(doc: any): PMCaseEntry {
    const title = doc.title || doc.topic || "Product Case";
    const scenario =
        doc.scenario ||
        doc.question ||
        doc.description ||
        doc.prompt ||
        title;
    return {
        questionId:          doc._id.toString(),
        title,
        scenario,
        constraintInjection: doc.constraintInjection || doc.constraint || "Assume engineering capacity is limited.",
        evaluationGuide:
            doc.evaluationGuide ||
            doc.answer ||
            doc.detailedAnswer ||
            "Evaluate for structured product thinking, user empathy, prioritization, trade-offs, and metrics.",
        redFlags:            doc.redFlags ?? [],
        successSignals:      doc.successSignals ?? [],
        difficulty:          doc.difficulty || "Medium",
    };
}

function normalizePMStrategyDoc(doc: any): PMStrategyEntry {
    const title = doc.title || doc.topic || "Product Strategy Scenario";
    const scenario =
        doc.scenario ||
        doc.question ||
        doc.description ||
        doc.prompt ||
        title;
    return {
        questionId:           doc._id.toString(),
        title,
        scenario,
        devilsAdvocateProbes: doc.devilsAdvocateProbes ?? doc.followUpQuestions ?? doc.probes ?? [],
        evaluationGuide:
            doc.evaluationGuide ||
            doc.answer ||
            doc.detailedAnswer ||
            "Evaluate for structured strategy thinking, competitive awareness, trade-offs, assumptions, and go-to-market judgment.",
        redFlags:             doc.redFlags ?? [],
        successSignals:       doc.successSignals ?? [],
        difficulty:           doc.difficulty || "Medium",
    };
}

/**
 * Pre-fetches all PM role questions for a session.
 * - Loads 1 case question (deduped)
 * - Loads 8 concept questions distributed across 6 subtopics (deduped)
 * - Loads 1 strategy question (deduped)
 * - Falls back through durable exposure, then any valid random question
 */
export async function prefetchPMQuestions(
    sessionId: string,
    userId: string,
    label: string = "PMPrefetch",
    options: PMPrefetchOptions = {}
): Promise<PMPrefetchResult> {
    const includeCase = options.includeCase ?? true;
    const includeConcepts = options.includeConcepts ?? true;
    const includeStrategy = options.includeStrategy ?? true;
    const difficultyFilter = Array.isArray(options.difficultyBands) && options.difficultyBands.length > 0
        ? { difficulty: { $in: options.difficultyBands } }
        : {};

    // ── Load all fundamental question IDs this user has seen ─────────────
    const seenCaseIds = await getSeenQuestionIds(userId, "pm_case", {
        category: "pm_case",
        idField: "questionFundamentalId",
    });
    const seenConceptIds = await getSeenQuestionIds(userId, "pm_concept", {
        category: "pm_concepts",
        idField: "questionFundamentalId",
    });
    const seenStrategyIds = await getSeenQuestionIds(userId, "pm_strategy", {
        category: "pm_strategy",
        idField: "questionFundamentalId",
    });

    const caseExcludeObjectIds = toMongoObjectIds(seenCaseIds);
    const excludeObjectIds = toMongoObjectIds(seenConceptIds);
    const strategyExcludeObjectIds = toMongoObjectIds(seenStrategyIds);

    console.log(`[${label}] Excluding ${excludeObjectIds.length} previously seen questions for user ${userId}`);

    // ── Fetch case question (with session persistence) ────────────────────
    let caseQuestion: PMCaseEntry | null = null;

    let existingSessionCase: { questionFundamentalId: string | null } | null = null;
    let rawCaseDoc: any = null;
    if (includeCase) {
        existingSessionCase = await prisma.sessionQuestion.findFirst({
        where: {
            sessionId: sessionId,
            questionCategory: "pm_case",
            questionFundamentalId: { not: null },
        },
        select: { questionFundamentalId: true },
    });

    if (existingSessionCase?.questionFundamentalId) {
        rawCaseDoc = await PMCaseQuestion.findById(existingSessionCase.questionFundamentalId).lean();
        if (rawCaseDoc) {
            console.log(`[${label}] Reusing existing PM case question for session ${sessionId}: "${rawCaseDoc.title}"`);
        }
    }

    if (!rawCaseDoc) {
        const caseMatchStage: any = { ...difficultyFilter };
        if (caseExcludeObjectIds.length > 0) {
            caseMatchStage._id = { $nin: caseExcludeObjectIds };
        }

        [rawCaseDoc] = await PMCaseQuestion.aggregate([
            { $match: caseMatchStage },
            { $sample: { size: 1 } },
        ]);

        if (!rawCaseDoc) {
            console.warn(`[${label}] PM case question pool exhausted, using least-recently-seen fallback`);
            [rawCaseDoc] = await safePickPMDocs({
                model: PMCaseQuestion,
                userId,
                source: "pm_case",
                match: difficultyFilter,
                count: 1,
                label,
                description: "PM case fallback",
            });
        }
    }

    if (rawCaseDoc) {
        caseQuestion = normalizePMCaseDoc(rawCaseDoc);
        if (!existingSessionCase) {
            console.log(`[${label}] Pre-fetched NEW PM case question: "${rawCaseDoc.title}"`);
        }
    } else {
        console.warn(`[${label}] No PM case question found in DB`);
    }
    }

    // ── Fetch concept questions per subtopic ──────────────────────────────
    const conceptQuestions: PMConceptEntry[] = [];
    const pickedConceptIds = new Set<string>();

    const subtopicResults: Array<{ subtopic: string; rawDocs: any[] }> = [];
    if (includeConcepts) {
        for (const [subtopic, count] of Object.entries(CONCEPT_SUBTOPIC_DISTRIBUTION)) {
            const matchStage: any = { subtopic, ...difficultyFilter };
            if (excludeObjectIds.length > 0) {
                matchStage._id = { $nin: excludeObjectIds };
            }

            let rawDocs = await PMConceptQuestion.aggregate([
                { $match: matchStage },
                { $sample: { size: count } },
            ]);

            // Graceful fallback: if dedup excluded everything, repeat oldest seen in subtopic.
            if (rawDocs.length === 0) {
                console.warn(`[${label}] PM concept pool exhausted for subtopic ${subtopic}, using least-recently-seen fallback`);
                rawDocs = await safePickPMDocs({
                    model: PMConceptQuestion,
                    userId,
                    source: "pm_concept",
                    match: { subtopic, ...difficultyFilter },
                    count,
                    alreadyPickedIds: pickedConceptIds,
                    label,
                    description: `PM concept fallback for subtopic ${subtopic}`,
                });
            }

            // Backward-compatible fallback for older PM concept seeds that used
            // topic/answer/detailedAnswer instead of subtopic/evaluationGuide.
            if (rawDocs.length === 0) {
                rawDocs = await safePickPMDocs({
                    model: PMConceptQuestion,
                    userId,
                    source: "pm_concept",
                    match: difficultyFilter,
                    count,
                    alreadyPickedIds: pickedConceptIds,
                    label,
                    description: `PM concept broad fallback for subtopic ${subtopic}`,
                });
            }

            for (const doc of rawDocs) {
                pickedConceptIds.add(String(doc?._id || ""));
            }
            subtopicResults.push({ subtopic, rawDocs });
        }
    }

    for (const { subtopic, rawDocs } of subtopicResults) {
        for (const doc of rawDocs) {
            conceptQuestions.push(normalizePMConceptDoc(doc, subtopic));
        }
        console.log(`[${label}] Pre-fetched ${rawDocs.length} ${subtopic} PM concept questions`);
    }

    // ── Fetch strategy question (with session persistence) ────────────────
    let strategyQuestion: PMStrategyEntry | null = null;

    let existingSessionStrategy: { questionFundamentalId: string | null } | null = null;
    let rawStrategyDoc: any = null;
    if (includeStrategy) {
        existingSessionStrategy = await prisma.sessionQuestion.findFirst({
        where: {
            sessionId: sessionId,
            questionCategory: "pm_strategy",
            questionFundamentalId: { not: null },
        },
        select: { questionFundamentalId: true },
    });

    if (existingSessionStrategy?.questionFundamentalId) {
        rawStrategyDoc = await PMStrategyQuestion.findById(existingSessionStrategy.questionFundamentalId).lean();
        if (rawStrategyDoc) {
            console.log(`[${label}] Reusing existing PM strategy question for session ${sessionId}: "${rawStrategyDoc.title}"`);
        }
    }

    if (!rawStrategyDoc) {
        const strategyMatchStage: any = { ...difficultyFilter };
        if (strategyExcludeObjectIds.length > 0) {
            strategyMatchStage._id = { $nin: strategyExcludeObjectIds };
        }

        [rawStrategyDoc] = await PMStrategyQuestion.aggregate([
            { $match: strategyMatchStage },
            { $sample: { size: 1 } },
        ]);

        if (!rawStrategyDoc) {
            console.warn(`[${label}] PM strategy question pool exhausted, using least-recently-seen fallback`);
            [rawStrategyDoc] = await safePickPMDocs({
                model: PMStrategyQuestion,
                userId,
                source: "pm_strategy",
                match: difficultyFilter,
                count: 1,
                label,
                description: "PM strategy fallback",
            });
        }
    }

    if (rawStrategyDoc) {
        strategyQuestion = normalizePMStrategyDoc(rawStrategyDoc);
        if (!existingSessionStrategy) {
            console.log(`[${label}] Pre-fetched NEW PM strategy question: "${rawStrategyDoc.title}"`);
        }
    } else {
        console.warn(`[${label}] No PM strategy question found in DB`);
    }
    }

    return { caseQuestion, conceptQuestions, strategyQuestion };
}
