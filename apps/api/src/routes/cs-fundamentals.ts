// ============================================
// CS Fundamentals Routes
// ============================================
// GET  /cs-fundamentals/questions       → List all CS fundamental questions
// GET  /cs-fundamentals/question/:id    → Get specific question by ID

import { FastifyInstance } from "fastify";
import { z } from "zod";
import { CSFundamentalQuestion } from "../models/CSFundamentalQuestion.js";
import mongoose from "mongoose";

const TOPIC_DISPLAY_NAMES: Record<string, string> = {
    CN: "Computer Networks",
    DBMS: "Database Management",
    OOPS: "Object-Oriented Programming",
    OS: "Operating Systems",
};

function slugify(value: string): string {
    return value
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

async function findCSQuestionByIdOrSlug(id: string) {
    if (mongoose.Types.ObjectId.isValid(id)) {
        const question = await CSFundamentalQuestion.findById(id).lean();
        if (question) return question;
    }

    const questions = await CSFundamentalQuestion.find({}).lean();
    return questions.find((question: any) => slugify(question.question || "") === id) || null;
}

export default async function csFundamentalsRoutes(fastify: FastifyInstance) {
    // ── AUTHENTICATED ROUTES ─────────────────────────────────────
    fastify.register(async function (authFastify) {
        authFastify.addHook("preHandler", authFastify.authenticate);

        // ── GET /api/cs-fundamentals/questions ────────────────────
        // Returns list of all CS fundamental questions with filters
        authFastify.get("/cs-fundamentals/questions", async (request, reply) => {
            const querySchema = z.object({
                topic: z.enum(["CN", "DBMS", "OOPS", "OS"]).optional(),
                search: z.string().optional(),
                page: z.coerce.number().int().positive().default(1),
                limit: z.coerce.number().int().positive().max(100).default(50),
            });

            const parsed = querySchema.safeParse(request.query);
            if (!parsed.success) {
                return reply.status(400).send({
                    error: "Invalid query parameters",
                    details: parsed.error.flatten(),
                });
            }

            const { topic, search, page, limit } = parsed.data;

            try {
                // Build MongoDB query
                const filter: any = {};
                if (topic) filter.topic = topic;
                if (search && search.trim()) {
                    filter.$or = [
                        { question: { $regex: search.trim(), $options: "i" } },
                        { answer: { $regex: search.trim(), $options: "i" } },
                    ];
                }

                const skip = (page - 1) * limit;

                // Execute query with pagination
                const [questions, total] = await Promise.all([
                    CSFundamentalQuestion.find(filter)
                        .select("_id topic question")
                        .sort({ topic: 1, createdAt: 1 })
                        .skip(skip)
                        .limit(limit)
                        .lean(),
                    CSFundamentalQuestion.countDocuments(filter),
                ]);

                // Get topic counts
                const topicAggregation = await CSFundamentalQuestion.aggregate([
                    { $group: { _id: "$topic", count: { $sum: 1 } } },
                    { $sort: { _id: 1 } },
                ]);

                const topicCounts = Object.fromEntries(
                    topicAggregation.map((t) => [t._id, t.count])
                );

                // Format questions response
                const formattedQuestions = questions.map((q: any, idx: number) => ({
                    id: q._id.toString(),
                    topic: q.topic,
                    topicName: TOPIC_DISPLAY_NAMES[q.topic] || q.topic,
                    question: q.question,
                    // Truncate question for list view
                    preview: q.question.length > 100 
                        ? q.question.substring(0, 100) + "..." 
                        : q.question,
                    number: skip + idx + 1,
                }));

                reply.cacheControl("CATALOG");
                return {
                    success: true,
                    data: {
                        questions: formattedQuestions,
                        pagination: {
                            page,
                            limit,
                            total,
                            totalPages: Math.ceil(total / limit),
                        },
                        filters: {
                            topics: topicCounts,
                        },
                    },
                };
            } catch (err: any) {
                request.log.error(err);
                return reply.status(500).send({
                    success: false,
                    error: "Failed to fetch CS fundamental questions",
                });
            }
        });

        // ── GET /api/cs-fundamentals/question/:id ─────────────────
        // Returns a specific CS fundamental question by MongoDB ID
        authFastify.get("/cs-fundamentals/question/:id", async (request, reply) => {
            const { id } = request.params as { id: string };

            try {
                const question = await findCSQuestionByIdOrSlug(id);

                if (!question) {
                    return reply.status(404).send({ error: "Question not found." });
                }

                reply.cacheControl("QUESTION");
                return {
                    id: question._id.toString(),
                    topic: question.topic,
                    topicName: TOPIC_DISPLAY_NAMES[question.topic] || question.topic,
                    question: question.question,
                    answer: question.answer,
                    detailedAnswer: question.detailedAnswer || null,
                };
            } catch (err: any) {
                request.log.error(err);
                return reply.status(500).send({
                    error: "Failed to load question",
                });
            }
        });
    });
}
