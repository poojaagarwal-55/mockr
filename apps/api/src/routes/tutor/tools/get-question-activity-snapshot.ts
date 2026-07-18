import { prisma } from "../../../lib/prisma.js";
import { ensureMongoDBConnected } from "../../../lib/mongoose.js";
import mongoose from "mongoose";
import { DSAQuestion } from "../../../models/DSAQuestion.js";
import { SQLQuestion } from "../../../models/SQLQuestion.js";
import { GenAICodingQuestion } from "../../../models/GenAICodingQuestion.js";
import type { TutorToolRunInput } from "../tool-types.js";

type QuestionLabel = {
    title: string;
    category: string;
};

function addDocLabel(
    labels: Map<string, QuestionLabel>,
    doc: any,
    category: string,
    titleFields: string[]
) {
    const title = titleFields.map((field) => doc?.[field]).find((value) => typeof value === "string" && value.trim());
    if (!title) return;
    const label = { title: title.trim(), category };
    if (doc?._id) labels.set(String(doc._id), label);
    if (doc?.questionId) labels.set(String(doc.questionId), label);
    if (doc?.problemId) labels.set(String(doc.problemId), label);
}

export async function resolveQuestionLabels(questionIds: string[]): Promise<Map<string, QuestionLabel>> {
    const uniqueIds = [...new Set(questionIds.filter(Boolean))];
    const labels = new Map<string, QuestionLabel>();
    if (uniqueIds.length === 0) return labels;

    try {
        await ensureMongoDBConnected();
    } catch {
        return labels;
    }

    const objectIds = uniqueIds
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));
    const idOr: any[] = [
        { questionId: { $in: uniqueIds } },
        { problemId: { $in: uniqueIds } },
    ];
    if (objectIds.length > 0) idOr.unshift({ _id: { $in: objectIds } });

    const dsCodingCollection = mongoose.connection.collection("ds_coding_questions");

    const [dsaDocs, sqlDocs, genAIDocs, dsCodingDocs] = await Promise.all([
        DSAQuestion.find({ $or: idOr }).select("_id problemId title problemTitle questionTitle name").lean(),
        SQLQuestion.find({ $or: idOr }).select("_id questionId title").lean(),
        GenAICodingQuestion.find({ $or: idOr }).select("_id questionId title taskType").lean(),
        dsCodingCollection.find(
            { $or: idOr },
            { projection: { _id: 1, questionId: 1, title: 1, category: 1 } }
        ).toArray(),
    ]);

    dsaDocs.forEach((doc) => addDocLabel(labels, doc, "DSA", ["title", "problemTitle", "questionTitle", "name"]));
    sqlDocs.forEach((doc) => addDocLabel(labels, doc, "SQL", ["title"]));
    genAIDocs.forEach((doc: any) => addDocLabel(labels, doc, "GenAI Coding", ["title"]));
    dsCodingDocs.forEach((doc) => addDocLabel(labels, doc, "Data Science Coding", ["title"]));

    return labels;
}

export async function runGetQuestionActivitySnapshotTool(input: TutorToolRunInput) {
    const { userId } = input;

    const [progressRows, recentSubmissions] = await Promise.all([
        prisma.userQuestionProgress.findMany({
            where: { userId },
            orderBy: { updatedAt: "desc" },
            take: 300,
        }),
        prisma.userQuestionSubmission.findMany({
            where: { userId },
            orderBy: { createdAt: "desc" },
            take: 20,
            select: {
                questionId: true,
                status: true,
                language: true,
                createdAt: true,
            },
        }),
    ]);

    const solved = progressRows.filter((x) => x.status === "solved");
    const attempted = progressRows.filter((x) => x.status === "attempted" || x.status === "solved");
    const solveRate = attempted.length > 0 ? Math.round((solved.length / attempted.length) * 100) : 0;
    const labels = await resolveQuestionLabels([
        ...progressRows.map((x) => x.questionId),
        ...recentSubmissions.map((x) => x.questionId),
    ]);

    return {
        stats: {
            totalAttempted: attempted.length,
            totalSolved: solved.length,
            solveRate,
        },
        recentSolvedQuestions: solved.slice(0, 20).map((x) => {
            const label = labels.get(x.questionId);
            return {
                title: label?.title || "Question title unavailable",
                category: label?.category || "Question",
                status: x.status,
                language: x.language,
                solvedAt: x.solvedAt?.toISOString() || x.lastAttemptedAt.toISOString(),
            };
        }),
        recentSubmissions: recentSubmissions.map((x) => {
            const label = labels.get(x.questionId);
            return {
                title: label?.title || "Question title unavailable",
                category: label?.category || "Question",
                status: x.status,
                language: x.language,
                createdAt: x.createdAt.toISOString(),
            };
        }),
    };
}
