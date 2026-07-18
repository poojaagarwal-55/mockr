// ============================================
// SQL IDE Routes — SQL Query Execution
// ============================================
// POST /ide/sql/run  → Run user SQL against hardcoded question via Judge0 SQLite

import { FastifyInstance } from "fastify";
import { z } from "zod";
import { generateExpectedOutput, runBatchSqlQueries, LOCAL_EXPECTED_OUTPUT_CACHE } from "../services/sql-execution.js";
import { SQLQuestion } from "../models/SQLQuestion.js";
import mongoose from "mongoose";
import { updateStreakForUser } from "../services/streak-service.js";
import { cacheDel } from "../lib/redis.js";

// ── Hardcoded SQL Question: Primary Department for Each Employee ────────

const HARDCODED_SQL_QUESTION = {
    id: "sql-primary-department",
    title: "Primary Department for Each Employee",
    description: `A company tracks which departments each employee belongs to. Some employees work in multiple departments — for those, one department is marked as their primary department (primary_flag = 'Y'). Employees who belong to only one department don't need a primary flag.

Write a SQL query to report the primary department for each employee. If an employee belongs to only one department, report that department.`,
    schema: `Table: employee

| Column        | Type       | Description                          |
|---------------|------------|--------------------------------------|
| employee_id   | INT        | Employee identifier                  |
| department_id | INT        | Department identifier                |
| primary_flag  | VARCHAR(1) | 'Y' if primary dept, 'N' otherwise   |

(employee_id, department_id) is the primary key.`,
    examples: [
        {
            input: {
                employee: [
                    { employee_id: 1, department_id: 1, primary_flag: "N" },
                    { employee_id: 1, department_id: 2, primary_flag: "Y" },
                    { employee_id: 2, department_id: 1, primary_flag: "Y" },
                    { employee_id: 2, department_id: 2, primary_flag: "N" },
                    { employee_id: 3, department_id: 3, primary_flag: "N" },
                    { employee_id: 4, department_id: 2, primary_flag: "N" },
                    { employee_id: 4, department_id: 3, primary_flag: "Y" },
                    { employee_id: 4, department_id: 6, primary_flag: "N" },
                ],
            },
            output: [
                { employee_id: 1, department_id: 2 },
                { employee_id: 2, department_id: 1 },
                { employee_id: 3, department_id: 3 },
                { employee_id: 4, department_id: 3 },
            ],
            explanation:
                "Employee 1 → dept 2 (primary). Employee 2 → dept 1 (primary). Employee 3 → dept 3 (only one dept). Employee 4 → dept 3 (primary).",
        },
    ],
    wrapperCode: `CREATE TABLE IF NOT EXISTS employee (
    employee_id   INT,
    department_id INT,
    primary_flag  VARCHAR(1),
    PRIMARY KEY (employee_id, department_id)
);

INSERT INTO employee VALUES
(1, 1, 'N'),
(1, 2, 'Y'),
(2, 1, 'Y'),
(2, 2, 'N'),
(3, 3, 'N'),
(4, 2, 'N'),
(4, 3, 'Y'),
(4, 6, 'N');`,
    solutionCode: `WITH firstRow AS (
    SELECT
        ROW_NUMBER() OVER(PARTITION BY employee_id ORDER BY primary_flag DESC) AS row_num,
        COUNT(employee_id) OVER(PARTITION BY employee_id) AS cnt,
        *
    FROM
        employee
)
SELECT
    employee_id,
    department_id
FROM
    firstRow
WHERE
    row_num = 1
    AND (primary_flag = 'Y' OR cnt = 1);`,
};

// Cache the expected output so we don't re-run the solution on every request
let cachedExpectedOutput: string | null = null;

function slugify(value: string): string {
    return value
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

async function findSQLQuestionByIdOrSlug(id: string) {
    if (mongoose.Types.ObjectId.isValid(id)) {
        const question = await SQLQuestion.findById(id).lean();
        if (question) return question;
    }

    const questions = await SQLQuestion.find({}).lean();
    return questions.find((question: any) => slugify(question.title || "") === id) || null;
}

async function getExpectedOutput(): Promise<string> {
    if (cachedExpectedOutput) return cachedExpectedOutput;

    console.log("[SqlRoute] Generating expected output from solution...");
    cachedExpectedOutput = await generateExpectedOutput(
        HARDCODED_SQL_QUESTION.wrapperCode,
        HARDCODED_SQL_QUESTION.solutionCode,
    );
    console.log("[SqlRoute] Expected output cached:", cachedExpectedOutput);
    return cachedExpectedOutput;
}

export default async function sqlRoutes(fastify: FastifyInstance) {
    // ── AUTHENTICATED ROUTES ─────────────────────────────────────
    fastify.register(async function (authFastify) {
        authFastify.addHook("preHandler", authFastify.authenticate);

        // ── GET /api/ide/sql/questions ────────────────────────────
        // Returns list of all SQL questions from MongoDB with pagination
        authFastify.get("/ide/sql/questions", async (request, reply) => {
            const querySchema = z.object({
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

            const { search, page, limit } = parsed.data;

            try {
                // Build MongoDB query
                const filter: any = {};
                if (search && search.trim()) {
                    filter.$or = [
                        { title: { $regex: search.trim(), $options: "i" } },
                        { description: { $regex: search.trim(), $options: "i" } },
                    ];
                }

                const skip = (page - 1) * limit;

                // Execute query with pagination
                const [questions, total] = await Promise.all([
                    SQLQuestion.find(filter)
                        .select('_id title description')
                        .sort({ createdAt: 1 })
                        .skip(skip)
                        .limit(limit)
                        .lean(),
                    SQLQuestion.countDocuments(filter),
                ]);
                
                reply.cacheControl("CATALOG");
                return {
                    success: true,
                    data: {
                        questions: questions.map(q => ({
                            id: q._id.toString(),
                            title: q.title,
                            description: q.description?.split('\n')[0] || '', // First line only
                            difficulty: "Medium", // Default for now
                            topics: ["SQL", "Database"],
                        })),
                        pagination: {
                            page,
                            limit,
                            total,
                            totalPages: Math.ceil(total / limit),
                        },
                    },
                };
            } catch (err: any) {
                request.log.error(err);
                return reply.status(500).send({
                    success: false,
                    error: "Failed to fetch SQL questions",
                });
            }
        });

        // ── GET /api/ide/sql/question/:id ─────────────────────────
        // Returns a specific SQL question by MongoDB ID
        authFastify.get("/ide/sql/question/:id", async (request, reply) => {
            const { id } = request.params as { id: string };
            
            try {
                const question = await findSQLQuestionByIdOrSlug(id);
                
                if (!question) {
                    return reply.status(404).send({ error: "Question not found." });
                }
                
                // Authenticated question payload can change during authoring; avoid stale browser/CDN cache.
                reply.cacheControl("NONE");
                return {
                    id: question._id.toString(),
                    title: question.title,
                    description: question.description,
                    schema: question.schema,
                    examples: question.examples,
                };
            } catch (err: any) {
                request.log.error(err);
                return reply.status(500).send({
                    error: "Failed to load question",
                });
            }
        });

        // ── GET /api/ide/sql/question ─────────────────────────────
        // Returns the hardcoded SQL question data (legacy endpoint)
        authFastify.get("/ide/sql/question", async (_request, reply) => {
            reply.cacheControl("CONFIG");
            return {
                id: HARDCODED_SQL_QUESTION.id,
                title: HARDCODED_SQL_QUESTION.title,
                description: HARDCODED_SQL_QUESTION.description,
                schema: HARDCODED_SQL_QUESTION.schema,
                examples: HARDCODED_SQL_QUESTION.examples,
            };
        });

        // ── POST /api/ide/sql/run ─────────────────────────────────
        // Runs the user's SQL query against the hidden test cases
        const runSchema = z.object({
            questionId: z.string().optional(), // optional — falls back to hardcoded question
            code: z.string(),
        });

        authFastify.post("/ide/sql/run", async (request, reply) => {
            const parsed = runSchema.safeParse(request.body);
            if (!parsed.success) {
                return reply.status(400).send({
                    error: "Invalid request",
                    details: parsed.error.flatten(),
                });
            }

            const { questionId, code } = parsed.data;
            if (!code.trim()) {
                return reply.status(400).send({ error: "SQL query is empty." });
            }

            try {
                // ── Resolve question data ──────────────────────────────────────
                // If a questionId is supplied, look it up in MongoDB.
                // Otherwise fall back to the hardcoded question so old callers still work.
                let wrapperCode: string;
                let solution: string;
                let hiddenTestCases: Array<{ id: string; label: string; wrapper_code: string; expected_output?: string }>;

                if (questionId) {
                    const { normalizeSQLQuestion } = await import("../lib/question-helpers.js");

                    const doc = await findSQLQuestionByIdOrSlug(questionId);
                    if (!doc) {
                        return reply.status(404).send({ error: "SQL question not found." });
                    }

                    const q = normalizeSQLQuestion(doc as any);
                    wrapperCode = q.wrapperCode || "";
                    solution    = q.solution    || "";

                    // Use embedded hiddenTestCases; fall back to a single default case
                    hiddenTestCases = (q.hiddenTestCases || []).length > 0
                        ? q.hiddenTestCases.map((tc: any) => ({
                              id:               tc.id || "hidden",
                              label:            tc.label || "Hidden Test Case",
                              wrapper_code:     tc.wrapper_code || wrapperCode,
                              expected_output:  tc.expected_output,
                          }))
                        : [{ id: "default", label: "Test Case", wrapper_code: wrapperCode }];
                } else {
                    // Hardcoded fallback
                    wrapperCode     = HARDCODED_SQL_QUESTION.wrapperCode;
                    solution        = HARDCODED_SQL_QUESTION.solutionCode;
                    hiddenTestCases = [{
                        id:           "default",
                        label:        "Test Case",
                        wrapper_code: HARDCODED_SQL_QUESTION.wrapperCode,
                    }];
                }

                // ── Run all test cases in a single batch call ─────────────────
                
                // Ensure all test cases have expectedOutput populated before batching
                const batchTestCases = [];
                for (const tc of hiddenTestCases) {
                    const cacheKey = `${questionId || "default"}_${tc.id || "test"}`;
                    let expectedOutput: string;
                    
                    const trustStoredExpected = process.env.SQL_TRUST_STORED_EXPECTED_OUTPUT === "true";

                    if (LOCAL_EXPECTED_OUTPUT_CACHE.has(cacheKey)) {
                        expectedOutput = LOCAL_EXPECTED_OUTPUT_CACHE.get(cacheKey)!;
                    } else if (trustStoredExpected && typeof tc.expected_output === "string" && tc.expected_output.trim().length > 0) {
                        expectedOutput = tc.expected_output.trim();
                        LOCAL_EXPECTED_OUTPUT_CACHE.set(cacheKey, expectedOutput);
                    } else {
                        // Generate it dynamically and cache it for future identical runs.
                        try {
                            expectedOutput = await generateExpectedOutput(tc.wrapper_code, solution);
                            LOCAL_EXPECTED_OUTPUT_CACHE.set(cacheKey, expectedOutput);
                        } catch (genErr: any) {
                            request.log.error(
                                { questionId, tcId: tc.id, err: genErr.message },
                                "[SQL] generateExpectedOutput failed — question solution could not be executed."
                            );
                            return reply.status(422).send({
                                success: false,
                                passed: false,
                                error: "This question's solution could not be executed. Please contact support.",
                                questionId,
                            });
                        }
                    }
                        
                    batchTestCases.push({
                        id: tc.id || "test",
                        label: tc.label || "Test Case",
                        wrapperCode: tc.wrapper_code,
                        expectedOutput
                    });
                }

                const batchResults = await runBatchSqlQueries(batchTestCases, code);
                
                const results = batchResults.map(r => ({
                    id: r.id,
                    label: r.label,
                    passed: r.passed,
                    actualOutput: r.actualOutput,
                    expectedOutput: r.expectedOutput,
                    error: r.error,
                    time: r.time,
                    memory: r.memory,
                }));
                
                const allPassed = results.every(r => r.passed);

                // Save progress when all test cases pass
                if (allPassed && questionId) {
                    const userId = request.user?.id;
                    if (userId && request.prisma) {
                        try {
                            const existingProgress = await request.prisma.userQuestionProgress.findUnique({
                                where: { userId_questionId: { userId, questionId } }
                            });
                            await request.prisma.userQuestionProgress.upsert({
                                where: { userId_questionId: { userId, questionId } },
                                update: {
                                    status: "solved",
                                    lastAttemptedAt: new Date(),
                                    ...(!existingProgress?.solvedAt && { solvedAt: new Date() }),
                                    attemptCount: { increment: 1 },
                                },
                                create: {
                                    userId,
                                    questionId,
                                    status: "solved",
                                    solvedAt: new Date(),
                                    lastAttemptedAt: new Date(),
                                    attemptCount: 1,
                                    language: "sql",
                                },
                            });
                            // Bust the progress cache so the list page sees the update immediately
                            await cacheDel([`ide:progress:${userId}`]);
                        } catch (progressErr) {
                            request.log.error(progressErr, "[SQL] Failed to save progress");
                        }
                    }
                }

                // Update streak when all test cases pass
                if (allPassed) {
                    const userId = request.user?.id;
                    if (userId) {
                        updateStreakForUser(userId).catch((err) =>
                            request.log.error(err, "[SQL] Failed to update streak")
                        );
                    }
                }

                return { success: true, passed: allPassed, results };
            } catch (err: any) {
                request.log.error(err);
                return reply.status(500).send({
                    success: false,
                    passed: false,
                    error: err.message || "SQL execution failed.",
                });
            }
        });

        // ── GET /api/ide/sql/submissions/:questionId ──────────────
        // Returns past submissions for a SQL question for the current user
        authFastify.get("/ide/sql/submissions/:questionId", async (request, reply) => {
            const { questionId } = request.params as { questionId: string };
            const userId = request.user?.id;
            if (!userId || !request.prisma) {
                return reply.send({ success: true, data: [] });
            }

            try {
                // SQL run saves to userQuestionProgress (not userQuestionSubmission)
                // Return progress record so frontend can derive isSolved
                const progress = await request.prisma.userQuestionProgress.findUnique({
                    where: { userId_questionId: { userId, questionId } },
                    select: { status: true, solvedAt: true, attemptCount: true, lastAttemptedAt: true },
                });

                if (!progress) {
                    return reply.send({ success: true, data: [] });
                }

                return {
                    success: true,
                    data: [{
                        id: `${userId}-${questionId}`,
                        status: progress.status === "solved" ? "accepted" : progress.status,
                        createdAt: progress.solvedAt || progress.lastAttemptedAt,
                        attemptCount: progress.attemptCount,
                    }],
                };
            } catch (err: any) {
                request.log.error(err);
                return reply.send({ success: true, data: [] });
            }
        });
    });
}
