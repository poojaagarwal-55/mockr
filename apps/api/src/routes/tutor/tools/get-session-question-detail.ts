import { prisma } from "../../../lib/prisma.js";
import type { TutorToolRunInput } from "../tool-types.js";
import { inferQuestionModule } from "../module-context.js";

/**
 * Returns the actual questions asked + candidate answers from a session.
 * Answers: "What did I say about caching?", "What question did I get wrong?",
 * "Show me the DSA problem I solved", "What was the SQL question?"
 */
export async function runGetSessionQuestionDetailTool(input: TutorToolRunInput) {
    const { context } = input;
    const sessionId = context.report.sessionId;
    const reportQuestions = Array.isArray(context.report.questions) ? context.report.questions : [];

    if (reportQuestions.length > 0) {
        const questions = reportQuestions.map((q: any, index: number) => {
            const category = String(q?.category || "unknown");
            const finalCode = typeof q?.finalCode === "string" && q.finalCode.trim() ? q.finalCode : null;
            return {
                questionId: q?.questionId || q?.id || `report-question-${index + 1}`,
                title: String(q?.title || "Untitled Question"),
                category,
                module: inferQuestionModule(category),
                difficulty: q?.difficulty || null,
                askedAt: q?.askedAt || null,
                timeSpentSeconds: q?.timeSpent || null,
                hintsUsed: Number(q?.hintsUsed || 0),
                score: q?.score !== null && q?.score !== undefined ? Math.round(Number(q.score)) : null,
                hasFinalCode: Boolean(finalCode),
                finalCode,
                aiNotes: q?.aiNotes || null,
                sampleAnswer: !finalCode && q?.sampleAnswer ? String(q.sampleAnswer).slice(0, 500) : null,
                conversationExchange: Array.isArray(q?.conversationExchange) ? q.conversationExchange.slice(0, 12) : null,
            };
        });

        const scoredQuestions = questions.filter((q) => q.score !== null);
        const weakest = scoredQuestions.length > 0
            ? scoredQuestions.reduce((a, b) => (a.score! < b.score! ? a : b))
            : null;

        return {
            sessionId,
            interviewType: context.report.session.type,
            source: "report.questions",
            questionCount: questions.length,
            questions,
            weakestQuestion: weakest
                ? { title: weakest.title, category: weakest.category, module: weakest.module, score: weakest.score }
                : null,
            mostHintedQuestion: null,
            totalHintsUsed: questions.reduce((sum, q) => sum + q.hintsUsed, 0),
            sessionMetrics: {
                totalTimeSpentSeconds: questions.reduce((sum, q) => sum + Number(q.timeSpentSeconds || 0), 0),
                averageTimeSpentSeconds: null,
                timedQuestionCount: questions.filter((q) => Number(q.timeSpentSeconds || 0) > 0).length,
            },
        };
    }

    const sessionQuestions = await prisma.sessionQuestion.findMany({
        where: { sessionId },
        orderBy: { askedAt: "asc" },
        select: {
            id: true,
            questionId: true,
            questionSqlId: true,
            questionFundamentalId: true,
            questionTitle: true,
            questionCategory: true,
            questionDifficulty: true,
            finalCode: true,
            score: true,
            hintsUsed: true,
            timeSpent: true,
            aiNotes: true,
            sampleAnswer: true,
            askedAt: true,
        },
    });

    // Extract relevant transcript segments per question using timestamps
    // We slice the transcript around each question's askedAt time
    const transcript = input.context.transcriptFull || input.context.transcript || "";

    const questions = sessionQuestions.map((sq) => {
        const category = sq.questionCategory || "unknown";
        const isCode = Boolean(sq.finalCode);
        const hintsUsed = sq.hintsUsed ?? 0;

        return {
            questionId: sq.questionId || sq.questionSqlId || sq.questionFundamentalId || sq.id,
            title: sq.questionTitle || "Untitled Question",
            category,
            module: inferQuestionModule(category),
            difficulty: sq.questionDifficulty || null,
            askedAt: sq.askedAt,
            timeSpentSeconds: sq.timeSpent || null,
            hintsUsed,
            score: sq.score !== null ? Math.round(Number(sq.score)) : null,
            hasFinalCode: isCode,
            finalCode: isCode ? sq.finalCode : null,
            aiNotes: sq.aiNotes || null,
            // Only include sample answer if it's a theory question (not code)
            sampleAnswer: !isCode && sq.sampleAnswer ? sq.sampleAnswer.slice(0, 500) : null,
        };
    });

    // Find the weakest question by score or hint usage
    const scoredQuestions = questions.filter((q) => q.score !== null);
    const weakest = scoredQuestions.length > 0
        ? scoredQuestions.reduce((a, b) => (a.score! < b.score! ? a : b))
        : null;

    const mostHinted = questions.reduce(
        (max, q) => (q.hintsUsed > (max?.hintsUsed ?? -1) ? q : max),
        null as typeof questions[0] | null
    );

    const timedQuestions = questions.filter((q) => Number.isFinite(q.timeSpentSeconds) && Number(q.timeSpentSeconds) > 0);
    const totalTimeSpentSeconds = timedQuestions.reduce((sum, q) => sum + Number(q.timeSpentSeconds || 0), 0);
    const averageTimeSpentSeconds = timedQuestions.length > 0
        ? Math.round(totalTimeSpentSeconds / timedQuestions.length)
        : null;

    return {
        sessionId,
        interviewType: context.report.session.type,
        source: "session_questions",
        questionCount: questions.length,
        questions,
        weakestQuestion: weakest
            ? { title: weakest.title, category: weakest.category, score: weakest.score }
            : null,
        mostHintedQuestion: mostHinted && mostHinted.hintsUsed > 0
            ? { title: mostHinted.title, category: mostHinted.category, hintsUsed: mostHinted.hintsUsed }
            : null,
        totalHintsUsed: questions.reduce((sum, q) => sum + q.hintsUsed, 0),
        sessionMetrics: {
            totalTimeSpentSeconds,
            averageTimeSpentSeconds,
            timedQuestionCount: timedQuestions.length,
        },
    };
}
