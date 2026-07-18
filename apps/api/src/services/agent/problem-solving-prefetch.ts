import mongoose from "mongoose";
import { prisma } from "../../lib/prisma.js";
import { ProblemSolvingCaseQuestion } from "../../models/ProblemSolvingCaseQuestion.js";
import { findLeastRecentlySeenMongoDoc, findRandomMongoDoc, getSeenQuestionIds, recordQuestionExposure, toMongoObjectIds } from "../question-exposure.js";

export type ProblemSolvingCaseEntry = {
    questionId: string;
    title: string;
    caseType: string;
    difficulty: string;
    prompt: string;
    candidateInstructions: string;
    assumptions: string[];
    decompositionPrompts: string[];
    hintLadder: string[];
    followUps: string[];
    twist: {
        prompt: string;
        expectedAdaptation: string;
    };
    convictionProbes: string[];
    referenceSolution: string;
    evaluationGuide: string;
    redFlags: string[];
    successSignals: string[];
};

const FALLBACK_PROBLEM_SOLVING_CASE: ProblemSolvingCaseEntry = {
    questionId: "fallback-problem-solving-case",
    title: "Two Doors and Two Guards",
    caseType: "logical_reasoning",
    difficulty: "Medium",
    prompt: "You are in a room with two doors. One door leads to safety and the other leads to danger. Two guards are present: one always tells the truth, and one always lies. You do not know which guard is which. You may ask exactly one yes/no question to one guard. How do you identify the safe door?",
    candidateInstructions: "Restate the goal, list assumptions, and reason aloud before committing to a question.",
    assumptions: [
        "Exactly one guard always lies and exactly one guard always tells the truth.",
        "Both guards know which door is safe.",
        "The candidate may ask one yes/no question to one guard.",
    ],
    decompositionPrompts: [
        "What makes a direct question unreliable here?",
        "How can you make both guards point you toward the same actionable conclusion?",
        "What would the truthful guard say about the liar's answer, and what would the liar say about the truthful guard's answer?",
    ],
    hintLadder: [
        "Try asking about what the other guard would say.",
        "You want a question where both possible guard types produce the same door as the answer.",
        "Ask: 'If I asked the other guard which door is safe, what would they say?' Then choose the opposite door.",
    ],
    followUps: [
        "Why does the same strategy work no matter which guard you ask?",
        "What assumption breaks the solution if it changes?",
    ],
    twist: {
        prompt: "Now suppose one guard may answer randomly once, but you do not know when. How does that change your confidence in a one-question strategy?",
        expectedAdaptation: "The candidate should recognize that the guarantee breaks and should ask for either more questions or a probabilistic framing.",
    },
    convictionProbes: [
        "Walk me through both cases: asking the truthful guard and asking the lying guard.",
        "What counterexample would disprove your strategy?",
    ],
    referenceSolution: "Ask either guard: 'If I asked the other guard which door is safe, what would they say?' Both guard types indicate the unsafe door, so choose the opposite door.",
    evaluationGuide: "Strong candidates model both guard identities, explain why the indirect question collapses both cases to the same result, and revisit assumptions under the twist.",
    redFlags: [
        "Asks a direct question and trusts the answer.",
        "Cannot test the strategy against both guard identities.",
        "Ignores the one-question constraint.",
    ],
    successSignals: [
        "Builds a truth table or equivalent case split.",
        "States the opposite-door conclusion clearly.",
        "Recognizes the random-answer twist invalidates the guarantee.",
    ],
};

function normalizeProblemSolvingDoc(doc: any): ProblemSolvingCaseEntry {
    return {
        questionId: doc._id.toString(),
        title: doc.title,
        caseType: doc.caseType || "analytical_reasoning",
        difficulty: doc.difficulty || "Medium",
        prompt: doc.prompt,
        candidateInstructions: doc.candidateInstructions || "Restate the problem, list assumptions, and reason aloud.",
        assumptions: doc.assumptions ?? [],
        decompositionPrompts: doc.decompositionPrompts ?? [],
        hintLadder: doc.hintLadder ?? [],
        followUps: doc.followUps ?? [],
        twist: {
            prompt: doc.twist?.prompt || "Now change one constraint. How would your approach adapt?",
            expectedAdaptation: doc.twist?.expectedAdaptation || "Candidate should revisit assumptions and update the reasoning without restarting from scratch.",
        },
        convictionProbes: doc.convictionProbes ?? [],
        referenceSolution: doc.referenceSolution,
        evaluationGuide: doc.evaluationGuide,
        redFlags: doc.redFlags ?? [],
        successSignals: doc.successSignals ?? [],
    };
}

export async function prefetchProblemSolvingCaseQuestion(
    sessionId: string,
    userId: string,
    label: string = "ProblemSolvingPrefetch",
    options: { difficultyBands?: string[] } = {}
): Promise<ProblemSolvingCaseEntry | null> {
    const persistFallback = async () => {
        await prisma.sessionQuestion.create({
            data: {
                sessionId,
                questionCategory: "problem_solving_case",
                questionDifficulty: FALLBACK_PROBLEM_SOLVING_CASE.difficulty,
                questionTitle: FALLBACK_PROBLEM_SOLVING_CASE.title,
                sampleAnswer: FALLBACK_PROBLEM_SOLVING_CASE.referenceSolution,
            },
        }).catch((err) => {
            console.warn(`[${label}] Failed to persist fallback problem-solving case for ${sessionId}:`, err);
        });
        return FALLBACK_PROBLEM_SOLVING_CASE;
    };

    const existing = await prisma.sessionQuestion.findFirst({
        where: {
            sessionId,
            questionCategory: "problem_solving_case",
            questionFundamentalId: { not: null },
        },
        orderBy: { askedAt: "asc" },
        select: { questionFundamentalId: true },
    });

    if (existing?.questionFundamentalId) {
        try {
            const existingDoc = await ProblemSolvingCaseQuestion.findById(existing.questionFundamentalId).lean();
            if (existingDoc) {
                const reused = normalizeProblemSolvingDoc(existingDoc);
                console.log(`[${label}] Reused problem-solving case for session ${sessionId}: "${reused.title}"`);
                return reused;
            }
        } catch (err) {
            console.warn(`[${label}] Could not reuse stored problem-solving case; using fallback for ${sessionId}:`, err);
            return FALLBACK_PROBLEM_SOLVING_CASE;
        }
    }

    if (mongoose.connection.readyState !== 1) {
        console.warn(`[${label}] MongoDB is not connected; using fallback problem-solving case for ${sessionId}`);
        return persistFallback();
    }

    const seenIds = await getSeenQuestionIds(userId, "problem_solving_case", {
        category: "problem_solving_case",
        idField: "questionFundamentalId",
    });
    const excludeObjectIds = toMongoObjectIds(seenIds);
    const difficultyFilter = Array.isArray(options.difficultyBands) && options.difficultyBands.length > 0
        ? { difficulty: { $in: options.difficultyBands } }
        : {};

    const matchStage: any = { ...difficultyFilter };
    if (excludeObjectIds.length > 0) {
        matchStage._id = { $nin: excludeObjectIds };
    }

    let rawDoc: any | undefined;
    try {
        [rawDoc] = await ProblemSolvingCaseQuestion.aggregate([
            { $match: matchStage },
            { $sample: { size: 1 } },
        ]);

        if (!rawDoc) {
            console.warn(`[${label}] Problem-solving case pool exhausted, using least-recently-seen fallback`);
            rawDoc = await findLeastRecentlySeenMongoDoc(
                ProblemSolvingCaseQuestion,
                userId,
                "problem_solving_case",
                difficultyFilter
            );
        }
        if (!rawDoc) {
            rawDoc = await findRandomMongoDoc(ProblemSolvingCaseQuestion);
            if (rawDoc) {
                console.warn(`[${label}] Problem-solving difficulty/exposure filters exhausted; used any random case fallback.`);
            }
        }
    } catch (err) {
        console.warn(`[${label}] Problem-solving case query failed; using fallback for ${sessionId}:`, err);
        return persistFallback();
    }

    if (!rawDoc) {
        console.warn(`[${label}] No problem-solving case questions found in DB`);
        return persistFallback();
    }

    const question = normalizeProblemSolvingDoc(rawDoc);
    await recordQuestionExposure({
        userId,
        questionSource: "problem_solving_case",
        questionId: question.questionId,
        sessionId,
    });
    await prisma.sessionQuestion.create({
        data: {
            sessionId,
            questionFundamentalId: question.questionId,
            questionCategory: "problem_solving_case",
            questionDifficulty: question.difficulty,
            questionTitle: question.title,
            sampleAnswer: question.referenceSolution,
        },
    });

    console.log(`[${label}] Pre-fetched problem-solving case: "${question.title}"`);
    return question;
}
