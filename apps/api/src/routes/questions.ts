import { FastifyInstance } from "fastify";
import { connectMongoDB } from "../lib/mongodb.js";
import { DSAQuestion } from "../models/DSAQuestion.js";
import { normalizeDSAQuestion } from "../lib/question-helpers.js";

function difficultyRank(difficulty?: string): number {
    switch ((difficulty || "").toLowerCase()) {
        case "easy":
            return 1;
        case "medium":
            return 2;
        case "hard":
            return 3;
        default:
            return 99;
    }
}

export default async function questionRoutes(fastify: FastifyInstance) {
    // ─── List Active DSA Questions ────────────────────────────
    fastify.get("/questions", async (_request, reply) => {
        await connectMongoDB();

        const docs = await DSAQuestion.find({})
            .select("problemSlug title difficulty topics")
            .lean();

        const questions = docs
            .map((doc: any) => ({
                id: String(doc._id),
                slug: doc.problemSlug,
                title: doc.title,
                category: "DSA",
                subcategory: doc.topics?.[0] || null,
                difficulty: doc.difficulty,
                tags: doc.topics || [],
            }))
            .sort((a, b) => {
                const byDifficulty = difficultyRank(a.difficulty) - difficultyRank(b.difficulty);
                if (byDifficulty !== 0) return byDifficulty;
                return a.title.localeCompare(b.title);
            });

        reply.cacheControl("CATALOG");
        return reply.send({ questions });
    });

    // ─── Get Single Question (by slug) with Starters & Visible Test Cases ──
    fastify.get("/questions/:slug", async (request, reply) => {
        const { slug } = request.params as { slug: string };

        await connectMongoDB();

        let question = await DSAQuestion.findOne({ problemSlug: slug });
        if (!question) {
            question = await DSAQuestion.findOne({ problemId: slug });
        }
        if (!question) {
            try {
                question = await DSAQuestion.findById(slug);
            } catch {
                question = null;
            }
        }

        if (!question) {
            return reply.status(404).send({
                error: "Not Found",
                message: `Question with slug "${slug}" not found`,
            });
        }

        const normalized = normalizeDSAQuestion(question as any);

        // Build starterCode map { java: "...", cpp: "..." }
        const starterCode: Record<string, string> = {};
        for (const s of normalized.starters || []) {
            if (s.language === "java" || s.language === "cpp") {
                starterCode[s.language] = s.starter;
            }
        }

        const testCases = (normalized.testCases || [])
            .filter((tc) => tc.type === "sample")
            .sort((a, b) => a.orderIdx - b.orderIdx);

        reply.cacheControl("QUESTION");
        return reply.send({
            id: normalized.id,
            slug: normalized.problemSlug,
            title: normalized.title,
            category: normalized.category,
            subcategory: normalized.topics?.[0] || null,
            difficulty: normalized.difficulty,
            problemMd: normalized.problemMd,
            constraints: normalized.constraints,
            examples: normalized.examples,
            hints: normalized.hints,
            tags: normalized.topics || [],
            starterCode,
            testCases,
        });
    });
}
