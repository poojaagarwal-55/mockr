import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { connectMongoDB } from "../lib/mongodb.js";
import mongoose from "mongoose";

const DSA_COUNTER_ID = "dsa_questions_frontend_id";
const MAX_ID_ALLOCATION_ATTEMPTS = 5;

// Validation schemas
const TestCaseSchema = z.object({
    id: z.string(),
    description: z.string(),
    input: z.string(),
    output: z.string(),
});

const ExampleSchema = z.object({
    example_num: z.number(),
    example_text: z.string(),
});

const CodeSnippetSchema = z.object({
    starter_code: z.string(),
    wrapper_code: z.string(),
});

const SolutionCodeSchema = z.object({
    time_complexity: z.string().optional(),
    space_complexity: z.string().optional(),
    python3: z.string().optional(),
    cpp: z.string().optional(),
    java: z.string().optional(),
    javascript: z.string().optional(),
});

const SolutionApproachSchema = z.object({
    explaination: z.string().optional(),
    explanation: z.string().optional(),
    timeComplexity: z.string(),
    spaceComplexity: z.string(),
    code: SolutionCodeSchema,
});

const CreateDSAQuestionSchema = z.object({
    title: z.string().min(1, "Title is required"),
    problemId: z.string().optional(),
    frontendId: z.string().optional(),
    difficulty: z.enum(["Easy", "Medium", "Hard"]),
    problemSlug: z.string().min(1, "Problem slug is required"),
    timeLimit: z.coerce.number().min(0.1).max(5).default(2),
    memoryLimit: z.coerce.number().int().min(16).max(256).default(256),
    topics: z.array(z.string()).min(1, "At least one topic is required"),
    companyTags: z.array(z.string()).default([]),
    description: z.string().min(1, "Description is required"),
    examples: z.array(ExampleSchema).min(1, "At least one example is required"),
    constraints: z.array(z.string()).min(1, "At least one constraint is required"),
    sampleTestCases: z.array(TestCaseSchema).min(1, "At least one sample test case is required"),
    hiddenTestCases: z.array(TestCaseSchema).min(1, "At least one hidden test case is required"),
    codeSnippets: z.object({
        python3: CodeSnippetSchema,
        cpp: CodeSnippetSchema,
        java: CodeSnippetSchema,
        javascript: CodeSnippetSchema,
    }),
    followUp: z.array(z.string()).default([]),
    hints: z.array(z.string()).default([]),
    solution: z.object({
        bruteForce: SolutionApproachSchema.optional(),
        optimized: SolutionApproachSchema.optional(),
    }).optional(),
});

const PublicPreviewQuerySchema = z.object({
    publicPreview: z.string().optional(),
    minFrontendId: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(1000).default(1000),
});

function notFound(reply: any) {
    return reply.status(404).send({ error: "Not Found" });
}

function isDuplicateKeyError(error: unknown): boolean {
    return typeof error === "object" && error !== null && (error as any).code === 11000;
}

async function getMaxNumericFrontendId(collection: any): Promise<number> {
    const [maxQuestion] = await collection
        .aggregate([
            {
                $project: {
                    numericFrontendId: {
                        $convert: {
                            input: "$frontendId",
                            to: "int",
                            onError: 0,
                            onNull: 0,
                        },
                    },
                },
            },
            { $sort: { numericFrontendId: -1 } },
            { $limit: 1 },
        ])
        .toArray();

    return Number(maxQuestion?.numericFrontendId || 0);
}

async function syncCounterToCollectionMax(db: any, collection: any): Promise<number> {
    const counters = db.collection("counters");
    const maxExistingId = await getMaxNumericFrontendId(collection);

    await counters.updateOne(
        { _id: DSA_COUNTER_ID },
        {
            $max: { seq: maxExistingId },
            $set: { updatedAt: new Date() },
            $setOnInsert: { createdAt: new Date() },
        },
        { upsert: true }
    );

    const counter = await counters.findOne({ _id: DSA_COUNTER_ID });
    return Number(counter?.seq || maxExistingId);
}

async function getNextDSAQuestionIdPreview(db: any, collection: any): Promise<string> {
    const current = await syncCounterToCollectionMax(db, collection);
    return String(current + 1);
}

async function allocateNextDSAQuestionId(db: any, collection: any): Promise<string> {
    await syncCounterToCollectionMax(db, collection);

    const counter = await db.collection("counters").findOneAndUpdate(
        { _id: DSA_COUNTER_ID },
        {
            $inc: { seq: 1 },
            $set: { updatedAt: new Date() },
        },
        { returnDocument: "after" }
    );

    const updatedCounter = "value" in (counter || {}) ? (counter as any).value : counter;
    const nextId = Number(updatedCounter?.seq);
    if (!Number.isFinite(nextId) || nextId < 1) {
        throw new Error("Failed to allocate DSA question ID");
    }

    return String(nextId);
}

function firstStarterCode(codeSnippets: any): string {
    if (!codeSnippets) return "";
    if (codeSnippets.cpp?.starter_code) return codeSnippets.cpp.starter_code;
    if (codeSnippets["c++"]?.starter_code) return codeSnippets["c++"].starter_code;
    const first = Object.values(codeSnippets)[0] as { starter_code?: string } | undefined;
    return first?.starter_code || "";
}

const QUESTION_CREATE_BODY_LIMIT_BYTES = 10 * 1024 * 1024;

export const problemSetterRoutes: FastifyPluginAsync = async (fastify) => {
    // Create DSA Question
    fastify.post("/problem-setter/dsa", { bodyLimit: QUESTION_CREATE_BODY_LIMIT_BYTES }, async (request, reply) => {
        try {
            const body = CreateDSAQuestionSchema.parse(request.body);

            await connectMongoDB();
            const db = mongoose.connection.db;
            if (!db) throw new Error("MongoDB connection is not ready");

            const collection = db.collection("dsa_questions");

            const existing = await collection.findOne({ problemSlug: body.problemSlug });

            if (existing) {
                return reply.status(400).send({
                    error: "Question already exists with this problemSlug",
                });
            }

            for (let attempt = 0; attempt < MAX_ID_ALLOCATION_ATTEMPTS; attempt += 1) {
                const assignedId = await allocateNextDSAQuestionId(db, collection);

                // Prepare the document with server-assigned IDs and predefined fields.
                const questionDocument = {
                    ...body,
                    problemId: assignedId,
                    frontendId: assignedId,
                    isUsedInContest: false,
                    usedInContests: [],
                    createdAt: new Date(),
                    updatedAt: new Date(),
                };

                try {
                    const result = await collection.insertOne(questionDocument);

                    return reply.status(201).send({
                        success: true,
                        message: "DSA question created successfully",
                        questionId: result.insertedId.toString(),
                        problemId: assignedId,
                        frontendId: assignedId,
                    });
                } catch (insertError) {
                    if (isDuplicateKeyError(insertError)) {
                        const duplicateSlug = await collection.findOne({ problemSlug: body.problemSlug });
                        if (duplicateSlug) {
                            return reply.status(400).send({
                                error: "Question already exists with this problemSlug",
                            });
                        }

                        continue;
                    }

                    throw insertError;
                }
            }

            return reply.status(409).send({
                error: "Could not assign a unique problem ID. Please submit again.",
            });
        } catch (error) {
            if (error instanceof z.ZodError) {
                return reply.status(400).send({
                    error: "Validation failed",
                    details: error.issues,
                });
            }

            fastify.log.error(error);
            return reply.status(500).send({
                error: "Failed to create DSA question",
            });
        }
    });

    // Get all DSA questions (for problem setter to view)
    fastify.get("/problem-setter/dsa", async (request, reply) => {
        try {
            const parsedQuery = PublicPreviewQuerySchema.safeParse(request.query);
            if (!parsedQuery.success) {
                return reply.status(400).send({
                    error: "Invalid query parameters",
                    details: parsedQuery.error.flatten(),
                });
            }

            await connectMongoDB();
            const db = mongoose.connection.db;
            if (!db) throw new Error("MongoDB connection is not ready");

            const collection = db.collection("dsa_questions");
            const { publicPreview, minFrontendId, limit } = parsedQuery.data;

            if (publicPreview === "1") {
                const questions = await collection
                    .aggregate([
                        {
                            $project: {
                                title: 1,
                                problemId: 1,
                                frontendId: 1,
                                problemSlug: 1,
                                difficulty: 1,
                                topics: 1,
                                description: 1,
                                examples: 1,
                                hints: 1,
                                codeSnippets: 1,
                                createdAt: 1,
                                numericFrontendId: {
                                    $convert: {
                                        input: "$frontendId",
                                        to: "int",
                                        onError: null,
                                        onNull: null,
                                    },
                                },
                            },
                        },
                        { $match: { numericFrontendId: { $gte: minFrontendId } } },
                        { $sort: { numericFrontendId: 1, createdAt: 1, title: 1 } },
                        { $limit: limit },
                    ])
                    .toArray();

                reply.cacheControl("NONE");
                return reply.send({
                    success: true,
                    count: questions.length,
                    questions: questions.map((q) => ({
                        _id: q._id?.toString(),
                        title: q.title,
                        problemId: q.problemId,
                        frontendId: q.frontendId,
                        problemSlug: q.problemSlug,
                        difficulty: q.difficulty,
                        topics: q.topics || [],
                        description: q.description,
                        examples: q.examples || [],
                        hints: q.hints || [],
                        starterCode: firstStarterCode(q.codeSnippets),
                    })),
                });
            }

            const questions = await collection
                .find({})
                .sort({ createdAt: -1 })
                .limit(100)
                .toArray();

            return reply.send({
                success: true,
                count: questions.length,
                questions: questions.map((q) => ({
                    _id: q._id,
                    title: q.title,
                    problemId: q.problemId,
                    frontendId: q.frontendId,
                    difficulty: q.difficulty,
                    topics: q.topics,
                    createdAt: q.createdAt,
                })),
            });
        } catch (error) {
            fastify.log.error(error);
            return reply.status(500).send({
                error: "Failed to fetch DSA questions",
            });
        }
    });

    // Get next available DSA question ID
    fastify.get("/problem-setter/dsa/next-id", async (request, reply) => {
        try {
            await connectMongoDB();
            const db = mongoose.connection.db;
            if (!db) throw new Error("MongoDB connection is not ready");

            const collection = db.collection("dsa_questions");
            const nextId = await getNextDSAQuestionIdPreview(db, collection);

            return reply.send({
                success: true,
                nextId,
            });
        } catch (error) {
            fastify.log.error(error);
            return reply.status(500).send({
                error: "Failed to fetch next ID",
            });
        }
    });

    // Get single DSA question by ID
    fastify.get("/problem-setter/dsa/:id", async (request, reply) => {
        try {
            const { id } = request.params as { id: string };
            await connectMongoDB();
            const db = mongoose.connection.db;
            if (!db) throw new Error("MongoDB connection is not ready");

            const collection = db.collection("dsa_questions");

            const { ObjectId } = await import("mongodb");
            const question = await collection.findOne({ _id: new ObjectId(id) });

            if (!question) {
                return reply.status(404).send({
                    error: "Question not found",
                });
            }

            return reply.send({
                success: true,
                question,
            });
        } catch (error) {
            fastify.log.error(error);
            return reply.status(500).send({
                error: "Failed to fetch DSA question",
            });
        }
    });
};
