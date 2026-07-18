// ============================================
// IDE Routes — Code Execution Endpoints
// ============================================
// GET  /ide/question       → Fetch a random DSA question
// GET  /ide/question/:id   → Fetch a specific question by ID
// POST /ide/run            → Run code against sample test cases
// POST /ide/submit         → Run code against ALL test cases (sample + hidden)

import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import mongoose from "mongoose";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
    ContestDSAQuestion,
    DSAQuestion,
    buildDSAAvailableForPracticeFilter,
    isDSAQuestionChoosedForContest,
} from "../models/DSAQuestion.js";
import { SQLQuestion } from "../models/SQLQuestion.js";
import { GenAICodingQuestion } from "../models/GenAICodingQuestion.js";
import { CompanyDSAQuestion, CompanySQLQuestion } from "../models/CompanyQuestionBank.js";
import { normalizeDSAQuestion, buildIDEResponse } from "../lib/question-helpers.js";
import { ensureMongoDBConnected } from "../lib/mongoose.js";
import { runCodeForQuestion, runCodeForGenAIQuestion, runCodeForDSCodingQuestion, runCodeForCompanyDSAQuestion } from "../services/code-execution.js";
import { generateExpectedOutput, LOCAL_EXPECTED_OUTPUT_CACHE, runBatchSqlQueries } from "../services/sql-execution.js";
import { cacheGet, cacheDel } from "../lib/redis.js";
import { checkRateLimit } from "../lib/rate-limiter.js";
import { prisma } from "../lib/prisma.js";
import {
    requireDsaSubmit,
    requireHourlySubmitCapAndIncrement,
    EntitlementError,
} from "../services/entitlements.js";
import { isAdminEmail } from "../lib/admin.js";
import { USER_ROLE } from "../lib/user-roles.js";
import { updateStreakForUser } from "../services/streak-service.js";
import { dsaCatalogQuerySchema } from "./ide-catalog-query.js";
import {
    enqueueCodeExecutionJob,
    getCodeExecutionJobSnapshot,
    getCodeExecutionQueueCounts,
    type CodeExecutionJobMode,
} from "../queues/code-execution-queue.js";

const DSA_PUBLIC_START_ID = 1;

export default async function ideRoutes(fastify: FastifyInstance) {
    const secureOaContextSchema = z.object({
        mode: z.literal("secure_oa").optional(),
        oaSessionId: z.string().uuid().optional(),
        oaQuestionKey: z.string().trim().min(1).max(300).optional(),
    });

    type SecureOaQuestionType = "dsa" | "sql";
    type SecureOaQuestionContext = {
        companyId: string;
        questionId: string;
        questionIds: string[];
        questionType: SecureOaQuestionType;
    };

    function toRecord(value: unknown): Record<string, any> {
        return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
    }

    function maskId(value?: string) {
        if (!value) return undefined;
        return `${value.slice(0, 8)}...`;
    }

    function rejectSecureOaQuestion(
        request: FastifyRequest,
        reply: FastifyReply,
        statusCode: number,
        reason: string,
        body: Record<string, unknown>,
        meta: Record<string, unknown> = {}
    ) {
        request.log.warn({
            reason,
            statusCode,
            sessionId: maskId(typeof meta.sessionId === "string" ? meta.sessionId : undefined),
            questionId: meta.questionId,
            oaQuestionKey: meta.oaQuestionKey,
            sessionStatus: meta.sessionStatus,
            matchedType: meta.matchedType,
            candidateUserId: maskId(typeof meta.candidateUserId === "string" ? meta.candidateUserId : undefined),
        }, "Secure OA IDE question rejected");
        reply.status(statusCode).send(body);
    }

    function uniqueNonEmptyStrings(values: Array<unknown>): string[] {
        return Array.from(new Set(values
            .map((value) => typeof value === "string" ? value.trim() : "")
            .filter(Boolean)));
    }

    function parseOaQuestionKey(value?: string): { type?: string; questionId?: string } {
        if (!value) return {};
        const parts = value.split(":").map((part) => part.trim()).filter(Boolean);
        if (parts.length < 2) return { questionId: parts[0] };
        if (parts.length === 2 && toSecureOaQuestionType(parts[0])) {
            return {
                type: parts[0].toLowerCase(),
                questionId: parts[1],
            };
        }
        return {
            type: parts.length >= 3 ? parts[1]?.toLowerCase() : undefined,
            questionId: parts[parts.length - 1],
        };
    }

    function toSecureOaQuestionType(value?: string): SecureOaQuestionType | null {
        const normalized = String(value || "").trim().toLowerCase();
        if (!normalized) return "dsa";
        if (["sql", "database", "dbms"].includes(normalized)) return "sql";
        if (["dsa", "coding", "backend", "frontend", "genai"].includes(normalized)) return "dsa";
        return null;
    }

    async function loadSecureOaCompanyQuestionContext(
        request: FastifyRequest,
        reply: FastifyReply,
        questionId: string,
        rawContext: unknown
    ): Promise<SecureOaQuestionContext | null | undefined> {
        const parsed = secureOaContextSchema.safeParse(rawContext ?? {});
        if (!parsed.success || parsed.data.mode !== "secure_oa") return undefined;
        if (!parsed.data.oaSessionId) {
            rejectSecureOaQuestion(request, reply, 400, "missing_session_context", {
                error: "Validation Error",
                message: "Secure OA session context is required to load company question-bank questions.",
            }, {
                questionId,
                oaQuestionKey: parsed.data.oaQuestionKey,
            });
            return null;
        }

        const session = await (prisma as any).secureOaSession.findUnique({
            where: { id: parsed.data.oaSessionId },
            select: {
                id: true,
                status: true,
                candidateUserId: true,
                companyId: true,
                jobRound: {
                    select: {
                        config: true,
                    },
                },
            },
        });
        if (!session) {
            rejectSecureOaQuestion(request, reply, 404, "session_not_found", {
                error: "Not Found",
                message: "Secure OA session not found.",
            }, {
                sessionId: parsed.data.oaSessionId,
                questionId,
                oaQuestionKey: parsed.data.oaQuestionKey,
            });
            return null;
        }
        if (session.candidateUserId !== request.user?.id) {
            rejectSecureOaQuestion(request, reply, 403, "candidate_mismatch", {
                error: "Forbidden",
                message: "You are not authorized for this secure OA session.",
            }, {
                sessionId: session.id,
                questionId,
                oaQuestionKey: parsed.data.oaQuestionKey,
                candidateUserId: session.candidateUserId,
            });
            return null;
        }
        if (!["pending", "active"].includes(session.status)) {
            rejectSecureOaQuestion(request, reply, 400, "session_not_active", {
                error: "Validation Error",
                code: "session_not_active",
                message: "Secure OA session is not active.",
            }, {
                sessionId: session.id,
                questionId,
                oaQuestionKey: parsed.data.oaQuestionKey,
                sessionStatus: session.status,
            });
            return null;
        }

        const parsedQuestionKey = parseOaQuestionKey(parsed.data.oaQuestionKey);
        const config = toRecord(toRecord(session.jobRound?.config).onlineAssessment);
        const questions = Array.isArray(config.questions) ? config.questions : [];
        const matched = questions.find((item: any) => {
            const itemId = String(item?.id || "");
            const itemQuestionId = String(item?.questionId || "");
            const itemSourceQuestionId = String(item?.sourceQuestionId || "");
            const nestedQuestionId = String(item?.question?.id || item?.question?._id || "");
            const ids = uniqueNonEmptyStrings([
                itemId,
                itemQuestionId,
                itemSourceQuestionId,
                nestedQuestionId,
                itemId.split(":").pop(),
            ]);
            return (
                ids.includes(questionId) ||
                (parsedQuestionKey.questionId ? ids.includes(parsedQuestionKey.questionId) : false) ||
                (parsed.data.oaQuestionKey ? ids.includes(parsed.data.oaQuestionKey) : false)
            );
        });
        if (!matched) {
            rejectSecureOaQuestion(request, reply, 403, "question_not_in_session", {
                error: "Forbidden",
                message: "This question is not part of your secure OA session.",
            }, {
                sessionId: session.id,
                questionId,
                oaQuestionKey: parsed.data.oaQuestionKey,
                sessionStatus: session.status,
            });
            return null;
        }
        const matchedType = String(
            parsedQuestionKey.type ||
            matched.questionType ||
            matched.bankType ||
            matched.type ||
            ""
        ).toLowerCase();
        const questionType = toSecureOaQuestionType(matchedType);
        if (!questionType) {
            rejectSecureOaQuestion(request, reply, 400, "unsupported_question_type", {
                error: "Validation Error",
                message: "The secure OA IDE is available only for DSA and SQL questions.",
            }, {
                sessionId: session.id,
                questionId,
                oaQuestionKey: parsed.data.oaQuestionKey,
                matchedType,
            });
            return null;
        }

        const questionIds = uniqueNonEmptyStrings([
            questionId,
            parsedQuestionKey.questionId,
            matched.questionId,
            matched.sourceQuestionId,
            matched._id,
            matched.id,
            matched.question?.id,
            matched.question?._id,
            String(matched.id || "").split(":").pop(),
        ]);

        return {
            companyId: session.companyId,
            questionId: questionIds[0] || questionId,
            questionIds,
            questionType,
        };
    }

    type CatalogQuestion = {
        frontendId?: string | number;
        authPath?: string;
        slug?: string;
        title?: string;
        category?: string;
        difficulty?: "Easy" | "Medium" | "Hard";
        tags?: string[];
        acceptanceRate?: number;
        prompt?: string;
        tests?: string[];
        approachHint?: string;
        starterCode?: string;
        language?: string;
    };

    let fallbackCatalogCache: CatalogQuestion[] | null = null;

    function getFallbackCatalogPath(): string | null {
        const candidates = [
            path.resolve(process.cwd(), "apps/web/src/generated/public-question-catalog.json"),
            path.resolve(process.cwd(), "../../apps/web/src/generated/public-question-catalog.json"),
        ];
        return candidates.find((candidate) => existsSync(candidate)) || null;
    }

    function getFallbackCodingCatalog(): CatalogQuestion[] {
        if (fallbackCatalogCache) return fallbackCatalogCache;
        const catalogPath = getFallbackCatalogPath();
        if (!catalogPath) {
            fallbackCatalogCache = [];
            return fallbackCatalogCache;
        }

        try {
            const parsed = JSON.parse(readFileSync(catalogPath, "utf8")) as CatalogQuestion[];
            fallbackCatalogCache = Array.isArray(parsed)
                ? parsed.filter((item) => item.category === "coding" && item.title)
                : [];
        } catch {
            fallbackCatalogCache = [];
        }

        return fallbackCatalogCache;
    }

    function numericFrontendId(value: unknown): number {
        const parsed = Number.parseInt(String(value || ""), 10);
        return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
    }

    function withDisplayFrontendIds<T extends { frontendId?: unknown }>(questions: T[]) {
        return questions.map((question, index) => ({
            ...question,
            frontendId: String(index + 1),
        }));
    }

    function getAuthPathQuestionId(authPath?: string): string {
        if (!authPath) return "";
        try {
            return new URL(authPath, "https://www.practers.com").searchParams.get("id") || "";
        } catch {
            return "";
        }
    }

    function findFallbackCatalogQuestion(id: string): CatalogQuestion | null {
        const decodedId = decodeURIComponent(id);
        return getFallbackCodingCatalog().find((item) => {
            const frontendId = String(item.frontendId || "");
            const authId = getAuthPathQuestionId(item.authPath);
            return item.slug === decodedId || frontendId === decodedId || item.title === decodedId || authId === decodedId;
        }) || null;
    }

    function formatFallbackQuestions(
        catalog: CatalogQuestion[],
        filters: {
            difficulty?: "Easy" | "Medium" | "Hard";
            topics?: string | string[];
            page: number;
            limit: number;
        }
    ) {
        const topicArray = filters.topics
            ? (Array.isArray(filters.topics) ? filters.topics : [filters.topics])
            : [];

        const filtered = catalog
            .filter((item) => numericFrontendId(item.frontendId) >= DSA_PUBLIC_START_ID)
            .filter((item) => !filters.difficulty || item.difficulty === filters.difficulty)
            .filter((item) => {
                if (topicArray.length === 0) return true;
                const tags = item.tags || [];
                return topicArray.some((topic) => tags.includes(topic));
            })
            .sort((a, b) => numericFrontendId(a.frontendId) - numericFrontendId(b.frontendId));

        const skip = (filters.page - 1) * filters.limit;
        const numbered = withDisplayFrontendIds(filtered);
        const paginated = numbered.slice(skip, skip + filters.limit);

        const topicCounts: Record<string, number> = {};
        const difficultyCounts: Record<string, number> = {};

        for (const item of catalog) {
            for (const tag of item.tags || []) {
                topicCounts[tag] = (topicCounts[tag] || 0) + 1;
            }
            if (item.difficulty) {
                difficultyCounts[item.difficulty] = (difficultyCounts[item.difficulty] || 0) + 1;
            }
        }

        return {
            questions: paginated.map((item) => ({
                id: item.slug || String(item.frontendId || item.title),
                problemId: String(item.frontendId || item.slug || ""),
                frontendId: String(item.frontendId || ""),
                title: item.title || "Coding Interview Question",
                slug: item.slug || "",
                difficulty: item.difficulty || "Medium",
                topics: item.tags || [],
                acceptanceRate: item.acceptanceRate || 65,
            })),
            pagination: {
                page: filters.page,
                limit: filters.limit,
                total: filtered.length,
                totalPages: Math.ceil(filtered.length / filters.limit),
            },
            filters: {
                topics: topicCounts,
                difficulties: difficultyCounts,
            },
        };
    }

    function buildFallbackIDEResponse(question: CatalogQuestion) {
        const language = question.language === "cpp" || !question.language ? "cpp" : question.language;
        const starterCode = question.starterCode || "class Solution {\npublic:\n    // Write your solution here\n};";
        const tests = (question.tests || []).slice(0, 3);

        return {
            id: question.slug || String(question.frontendId || question.title),
            title: question.title || "Coding Interview Question",
            statement: question.prompt || question.title || "",
            category: "DSA",
            difficulty: question.difficulty || "Medium",
            constraints: "",
            examples: tests.map((test, index) => ({
                input: test,
                output: "",
                explanation: `Example ${index + 1}`,
            })),
            hints: question.approachHint ? [question.approachHint] : [],
            topics: question.tags || [],
            companyTags: [],
            language,
            starter_code: { [language]: starterCode },
            wrapper_code: {},
            sample_tests: tests.map((test, index) => ({
                id: `sample_${index + 1}`,
                stdin: test,
                expected_output: "",
            })),
            solution: undefined,
            fallback: true,
        };
    }

    function canUseObjectId(id: string): boolean {
        return mongoose.Types.ObjectId.isValid(id);
    }

    function sqlLookupClauses(ids: string[]) {
        return ids.flatMap((candidateId) => {
            const clauses: any[] = [
                { sourceQuestionId: candidateId },
                { questionId: candidateId },
                { title: candidateId },
            ];
            if (canUseObjectId(candidateId)) {
                clauses.unshift({ _id: new mongoose.Types.ObjectId(candidateId) });
            }
            return clauses;
        });
    }

    function dsaLookupClauses(ids: string[]) {
        return ids.flatMap((candidateId) => {
            const clauses: any[] = [
                { problemId: candidateId },
                { frontendId: candidateId },
                { sourceQuestionId: candidateId },
            ];
            if (canUseObjectId(candidateId)) {
                clauses.unshift({ _id: new mongoose.Types.ObjectId(candidateId) });
            }
            return clauses;
        });
    }

    function buildSecureOaSQLIDEResponse(doc: any) {
        const id = String(doc?._id || doc?.id || "");
        const testCases = Array.isArray(doc?.testCases) ? doc.testCases : [];
        const examples = Array.isArray(doc?.examples) ? doc.examples : [];

        return {
            id,
            title: doc?.title || "SQL question",
            category: "SQL",
            difficulty: doc?.difficulty || "Medium",
            description: doc?.description || "",
            statement: doc?.description || "",
            problemMd: doc?.description || "",
            schema: doc?.schema || "",
            examples,
            language: "sql",
            starter_code: {
                sql: "-- Write your SQL query here\n",
            },
            starterCode: {
                sql: "-- Write your SQL query here\n",
            },
            visibleTestCases: testCases.map((testCase: any, index: number) => ({
                id: String(testCase?.id ?? `sample_${index + 1}`),
                label: testCase?.label || `Test Case ${index + 1}`,
                input: testCase?.input,
                expected: testCase?.expected_output ?? testCase?.expectedOutput ?? testCase?.output,
            })),
        };
    }

    async function findSecureOaSqlQuestion(context: SecureOaQuestionContext) {
        const lookupClauses = sqlLookupClauses(context.questionIds);
        const companyDoc = lookupClauses.length
            ? await CompanySQLQuestion.findOne({
                "company.id": context.companyId,
                status: { $ne: "archived" },
                $or: lookupClauses,
            }).select("+hiddenTestCases +solution").lean()
            : null;
        if (companyDoc) return companyDoc;

        const sourceLookupClauses = sqlLookupClauses(context.questionIds).filter((clause) => !("sourceQuestionId" in clause));
        return sourceLookupClauses.length
            ? await SQLQuestion.findOne({ $or: sourceLookupClauses }).lean()
            : null;
    }

    async function findSecureOaDsaQuestion(context: SecureOaQuestionContext) {
        const lookupClauses = dsaLookupClauses(context.questionIds);
        return lookupClauses.length
            ? await CompanyDSAQuestion.findOne({
                "company.id": context.companyId,
                status: { $ne: "archived" },
                $or: lookupClauses,
            }).select("+solution")
            : null;
    }

    function sqlSolutionCode(solution: any) {
        if (typeof solution === "string") return solution;
        if (typeof solution?.query === "string") return solution.query;
        if (solution && typeof solution === "object") {
            const first = Object.values(solution).find((value) => typeof value === "string" && value.trim());
            return typeof first === "string" ? first : "";
        }
        return "";
    }

    function asExpectedText(value: any) {
        return typeof value === "string" ? value : JSON.stringify(value ?? "");
    }

    async function runSecureOaSqlQuestion(question: any, sourceCode: string, mode: "run" | "submit") {
        const visibleCases = Array.isArray(question?.testCases) ? question.testCases : [];
        const hiddenCases = Array.isArray(question?.hiddenTestCases) ? question.hiddenTestCases : [];
        const sourceCases = mode === "submit" && hiddenCases.length > 0 ? hiddenCases : visibleCases.length > 0 ? visibleCases : hiddenCases;
        const solutionCode = sqlSolutionCode(question?.solution);

        const batchTestCases = [];
        for (const [index, testCase] of sourceCases.entries()) {
            const wrapperCode = testCase?.wrapper_code || testCase?.wrapperCode || question?.wrapperCode;
            if (!wrapperCode) continue;

            const testId = String(testCase?.id ?? `test_${index + 1}`);
            const questionId = String(question?._id || question?.id || "sql");
            const cacheKey = `secure-oa-sql:${questionId}:${testId}:${mode}`;
            let expectedOutput = asExpectedText(testCase?.expected_output ?? testCase?.expectedOutput ?? testCase?.output ?? "");

            if (solutionCode.trim()) {
                if (LOCAL_EXPECTED_OUTPUT_CACHE.has(cacheKey)) {
                    expectedOutput = LOCAL_EXPECTED_OUTPUT_CACHE.get(cacheKey)!;
                } else {
                    expectedOutput = await generateExpectedOutput(wrapperCode, solutionCode);
                    LOCAL_EXPECTED_OUTPUT_CACHE.set(cacheKey, expectedOutput);
                }
            }

            batchTestCases.push({
                id: testId,
                label: testCase?.label || `Test Case ${index + 1}`,
                wrapperCode,
                expectedOutput,
            });
        }

        if (batchTestCases.length === 0) {
            return {
                success: false,
                passed: false,
                error: "No executable SQL test cases found for this question.",
            };
        }

        const results = await runBatchSqlQueries(batchTestCases, sourceCode);
        return {
            success: true,
            passed: results.every((result) => result.passed),
            results,
        };
    }

    async function findDSCodingQuestion(id: string): Promise<any | null> {
        const collection = mongoose.connection.collection("ds_coding_questions");
        const queries: any[] = [{ questionId: id }];
        if (canUseObjectId(id)) {
            queries.unshift({ _id: new mongoose.Types.ObjectId(id) });
        }

        for (const query of queries) {
            const doc = await collection.findOne(query);
            if (doc) return doc;
        }
        return null;
    }

    async function findGenAICodingQuestion(id: string): Promise<any | null> {
        const queries: any[] = [{ questionId: id }];
        if (canUseObjectId(id)) {
            queries.unshift({ _id: new mongoose.Types.ObjectId(id) });
        }

        for (const query of queries) {
            const doc = await GenAICodingQuestion.findOne(query).lean();
            if (doc) return doc;
        }
        return null;
    }

    function hasContestEnded(contest: { status: string; endTime: Date } | null): boolean {
        if (!contest) return false;
        return contest.status === "ENDED" || contest.endTime <= new Date();
    }

    async function findQuestionInModel(model: typeof DSAQuestion, id: string) {
        let doc = null;
        try {
            doc = await model.findById(id);
        } catch {
            // id was not a valid ObjectId.
        }

        if (!doc) {
            doc = await model.findOne({
                $or: [
                    { problemId: id },
                    { problemSlug: id },
                    { frontendId: id },
                ],
            });
        }

        return doc;
    }

    async function findContestPracticeDsaQuestion(id: string, contestId?: string) {
        if (!contestId) return null;

        const [contest, contestQuestion] = await Promise.all([
            prisma.contest.findUnique({
                where: { id: contestId },
                select: { status: true, endTime: true },
            }),
            prisma.contestQuestion.findUnique({
                where: {
                    contestId_questionId: {
                        contestId,
                        questionId: id,
                    },
                },
                select: { questionId: true },
            }),
        ]);

        if (!contestQuestion || !hasContestEnded(contest)) {
            return null;
        }

        return findQuestionInModel(ContestDSAQuestion, contestQuestion.questionId);
    }

    async function canViewContestQuestionBank(request: FastifyRequest) {
        if (isAdminEmail(request.user?.email)) return true;

        const userId = request.user?.id;
        if (!userId) return false;

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { role: true },
        });

        return user?.role === USER_ROLE.CONTEST_CREATOR;
    }

    async function rejectUnauthorizedContestBankPreview(
        request: FastifyRequest,
        reply: FastifyReply,
        source?: "contest-bank"
    ) {
        if (source !== "contest-bank") return false;
        if (await canViewContestQuestionBank(request)) return false;

        reply.status(403).send({
            error: "Forbidden",
            message: "You do not have access to contest question previews.",
        });
        return true;
    }

    function buildDSCodingIDEResponse(doc: any) {
        const visibleTestCases = (doc.sampleTestCases || []).map((tc: any, idx: number) => ({
            id: tc.id || `sample_${idx + 1}`,
            input: tc.input || "",
            expected: tc.output ?? tc.expectedOutput ?? "",
            label: tc.description || `Sample Case ${idx + 1}`,
        }));

        const constraints = [
            doc.datasetUrl ? `Dataset: ${doc.datasetUrl}` : null,
            doc.timeLimit ? `Time limit: ${doc.timeLimit} seconds` : null,
            doc.memoryLimit ? `Memory limit: ${doc.memoryLimit} MB` : null,
            doc.metadata?.expectedAccuracy ? `Target accuracy: ${doc.metadata.expectedAccuracy}` : null,
            doc.metadata?.expectedVarianceExplained ? `Expected variance explained: ${doc.metadata.expectedVarianceExplained}` : null,
        ].filter(Boolean);

        return {
            id: doc.questionId || String(doc._id),
            title: doc.title,
            statement: doc.description || doc.problemStatement || "",
            problemMd: doc.description || doc.problemStatement || "",
            category: "Data Science",
            difficulty: doc.difficulty || "Medium",
            constraints,
            examples: visibleTestCases.map((tc: any) => ({
                input: tc.input,
                output: tc.expected,
                explanation: tc.label,
            })),
            language: "python",
            starter_code: { python: doc.starterCode || "" },
            starterCode: { python: doc.starterCode || "" },
            sample_tests: visibleTestCases.map((tc: any) => ({
                id: tc.id,
                stdin: tc.input,
                expected_output: tc.expected,
            })),
            visibleTestCases,
        };
    }

    // ── AUTHENTICATED ROUTES ───────────────────────────────────────────
    fastify.register(async function (authFastify) {
        authFastify.addHook("preHandler", authFastify.authenticate);

        // ── GET /api/ide/question ──────────────────────────────────────
        // Fetches a random active DSA question with starter code and sample test cases.
        authFastify.get("/ide/question", async (request, reply) => {
            const availableFilter = buildDSAAvailableForPracticeFilter();
            const total = await DSAQuestion.countDocuments(availableFilter);

            if (total === 0) {
                return reply.status(404).send({ error: "No DSA questions found." });
            }

            // Pick a random document using $sample aggregation
            const [rawDoc] = await DSAQuestion.aggregate([
                { $match: availableFilter },
                { $sample: { size: 1 } },
            ]);

            if (!rawDoc) return reply.status(404).send({ error: "Question not found." });

            // Re-hydrate as a Mongoose document to get Map accessors
            const doc = await DSAQuestion.findById(rawDoc._id);
            if (!doc) return reply.status(404).send({ error: "Question not found." });
            if (isDSAQuestionChoosedForContest(doc)) {
                return reply.status(404).send({ error: "Question is unavailable while it is selected for a contest." });
            }

            const normalized = normalizeDSAQuestion(doc);
            reply.cacheControl("QUESTION");
            // Preserve raw markdown so the IDE renders GFM tables + LaTeX via
            // RichQuestionContent (matches the contest solve page). formatDescription
            // flattens multi-line tables into raw pipes and strips sections.
            return buildIDEResponse(normalized, { preserveMarkdown: true });
        });

        // ── GET /api/ide/question/:id ──────────────────────────────────
        // Fetches a specific question by ID with starter code and sample test cases.
        authFastify.get("/ide/question/:id", async (request, reply) => {
            const paramsValidation = z.object({
                id: z.string().trim().min(1).max(300),
            }).safeParse(request.params);
            if (!paramsValidation.success) {
                return reply.status(400).send({
                    error: "Validation Error",
                    details: paramsValidation.error.flatten().fieldErrors,
                });
            }

            const queryValidation = z.object({
                contestId: z.string().trim().min(1).max(128).optional(),
                source: z.enum(["contest-bank"]).optional(),
            }).passthrough().safeParse(request.query || {});
            if (!queryValidation.success) {
                return reply.status(400).send({
                    error: "Validation Error",
                    details: queryValidation.error.flatten().fieldErrors,
                });
            }

            const { id } = paramsValidation.data;
            const { contestId, source } = queryValidation.data;
            const secureOaContext = await loadSecureOaCompanyQuestionContext(request, reply, id, request.query);
            if (secureOaContext === null) return reply;

            if (!secureOaContext && mongoose.connection.readyState !== 1) {
                const fallbackQuestion = findFallbackCatalogQuestion(id);
                if (fallbackQuestion) {
                    reply.cacheControl("NONE");
                    return buildFallbackIDEResponse(fallbackQuestion);
                }
            }

            if (secureOaContext?.questionType === "sql") {
                const sqlDoc = await findSecureOaSqlQuestion(secureOaContext);
                if (!sqlDoc) {
                    request.log.warn({
                        sessionId: maskId((request.query as any)?.oaSessionId),
                        questionId: id,
                        resolvedQuestionIds: secureOaContext.questionIds,
                    }, "Secure OA company SQL question lookup returned no document");
                    return reply.status(404).send({ error: "Question not found." });
                }
                reply.cacheControl("QUESTION");
                return buildSecureOaSQLIDEResponse(sqlDoc);
            }

            if (secureOaContext?.questionType === "dsa") {
                const companyDoc = await findSecureOaDsaQuestion(secureOaContext);
                if (companyDoc) {
                    const normalized = normalizeDSAQuestion(companyDoc as any);
                    reply.cacheControl("QUESTION");
                    return buildIDEResponse(normalized, { preserveMarkdown: true });
                }
            }

            if (source === "contest-bank") {
                if (!(await canViewContestQuestionBank(request))) {
                    return reply.status(403).send({
                        error: "Forbidden",
                        message: "You do not have access to contest question previews.",
                    });
                }

                const contestBankDoc = await findQuestionInModel(ContestDSAQuestion, id);
                if (!contestBankDoc) {
                    return reply.status(404).send({ error: "Question not found." });
                }

                const normalized = normalizeDSAQuestion(contestBankDoc as any);
                reply.cacheControl("NONE");
                return buildIDEResponse(normalized, { preserveMarkdown: true });
            }

            // Try finding by MongoDB ObjectId first, then by problemId
            let doc = null;
            try {
                doc = await DSAQuestion.findById(id);
            } catch {
                // id wasn't a valid ObjectId — try problemId
            }
            if (!doc) {
                doc = await DSAQuestion.findOne({ problemId: id });
            }

            if (!doc) {
                const contestDoc = await findContestPracticeDsaQuestion(id, contestId);
                if (contestDoc) {
                    const normalized = normalizeDSAQuestion(contestDoc as any);
                    reply.cacheControl("NONE");
                    return buildIDEResponse(normalized, { preserveMarkdown: true });
                }

                if (secureOaContext) {
                    request.log.warn({
                        sessionId: maskId((request.query as any)?.oaSessionId),
                        questionId: id,
                        resolvedQuestionIds: secureOaContext.questionIds,
                    }, "Secure OA company DSA question lookup returned no document");
                }

                const dsDoc = await findDSCodingQuestion(id);
                if (dsDoc) return buildDSCodingIDEResponse(dsDoc);

                const genAIDoc = await findGenAICodingQuestion(id);
                if (genAIDoc) {
                    return {
                        id: genAIDoc.questionId || String(genAIDoc._id),
                        title: genAIDoc.title,
                        statement: genAIDoc.problemStatement,
                        problemMd: genAIDoc.problemStatement,
                        category: "GenAI",
                        difficulty: genAIDoc.difficulty,
                        constraints: [],
                        examples: (genAIDoc.sampleTestCases || []).map((tc: any) => ({
                            input: tc.input,
                            output: tc.expectedOutput ?? tc.output ?? "",
                            explanation: tc.description,
                        })),
                        language: "python",
                        starter_code: { python: genAIDoc.starterCode || "" },
                        starterCode: { python: genAIDoc.starterCode || "" },
                        sample_tests: (genAIDoc.sampleTestCases || []).map((tc: any) => ({
                            id: tc.id,
                            stdin: tc.input,
                            expected_output: tc.expectedOutput ?? tc.output ?? "",
                        })),
                        visibleTestCases: (genAIDoc.sampleTestCases || []).map((tc: any) => ({
                            id: tc.id,
                            input: tc.input,
                            expected: tc.expectedOutput ?? tc.output ?? "",
                            label: tc.description || "Sample Case",
                        })),
                    };
                }

                const fallbackQuestion = findFallbackCatalogQuestion(id);
                if (fallbackQuestion) {
                    reply.cacheControl("NONE");
                    return buildFallbackIDEResponse(fallbackQuestion);
                }

                return reply.status(404).send({ error: "Question not found." });
            }

            if (!secureOaContext && isDSAQuestionChoosedForContest(doc)) {
                return reply.status(404).send({ error: "Question is unavailable while it is selected for a contest." });
            }

            const normalized = normalizeDSAQuestion(doc);
            reply.cacheControl("QUESTION");
            // Preserve raw markdown so the practice IDE renders GFM tables + LaTeX
            // through RichQuestionContent, identical to the contest solve page.
            return buildIDEResponse(normalized, { preserveMarkdown: true });
        });

        // ── Request Validation Schema ──────────────────────────────────
        const runSchema = z.object({
            question_id: z.string().optional(),
            questionId: z.string().optional(),
            code: z.string(),
            language_id: z.number().optional(),
            language: z.string().optional(),
            contestId: z.string().trim().min(1).max(140).optional(),
            source: z.enum(["contest-bank"]).optional(),
            mode: z.enum(["secure_oa"]).optional(),
            oaSessionId: z.string().uuid().optional(),
            oaQuestionKey: z.string().trim().min(1).max(300).optional(),
            // User-added custom test cases (run only; output-only, never scored).
            customTests: z.array(z.object({ stdin: z.string().max(20000) })).max(15).optional(),
        }).refine(data => data.question_id || data.questionId, {
            message: "Either question_id or questionId is required",
        });

        async function enqueueExecution(
            mode: CodeExecutionJobMode,
            request: FastifyRequest,
            reply: FastifyReply
        ) {
            const parsed = runSchema.safeParse(request.body);
            if (!parsed.success) {
                return reply.status(400).send({
                    error: "Invalid Request",
                    details: parsed.error.flatten(),
                });
            }

            const { question_id, questionId, code, language, language_id, contestId, source } = parsed.data;
            const finalQuestionId = question_id || questionId;

            if (!code.trim()) {
                return reply.status(400).send({ error: "Source code is empty." });
            }
            if (await rejectUnauthorizedContestBankPreview(request, reply, source)) return reply;

            try {
                const job = await enqueueCodeExecutionJob({
                    userId: request.user!.id,
                    questionId: finalQuestionId!,
                    sourceCode: code,
                    languageId: language_id,
                    language,
                    mode,
                    contestId,
                    questionSource: source,
                });

                return reply.status(202).send({
                    success: true,
                    jobId: job.id,
                    status: "queued",
                    statusUrl: `/ide/executions/${job.id}`,
                });
            } catch (err: any) {
                request.log.error(err, "Failed to enqueue code execution job");
                return reply.status(503).send({
                    success: false,
                    error: "Code execution queue is unavailable.",
                    message:
                        err.message ||
                        "Set REDIS_URL, QUEUE_REDIS_URL, or BULLMQ_REDIS_URL and make sure the worker is running.",
                });
            }
        }

        authFastify.post("/ide/run/queued", async (request, reply) => {
            return enqueueExecution("run", request, reply);
        });

        authFastify.post("/ide/submit/queued", async (request, reply) => {
            return enqueueExecution("submit", request, reply);
        });

        authFastify.get("/ide/executions/:jobId", async (request, reply) => {
            const { jobId } = request.params as { jobId: string };

            try {
                const snapshot = await getCodeExecutionJobSnapshot(
                    jobId,
                    request.user!.id
                );
                if (!snapshot) {
                    return reply.status(404).send({
                        success: false,
                        error: "Execution job not found.",
                    });
                }

                return {
                    success: true,
                    data: snapshot,
                };
            } catch (err: any) {
                request.log.error(err, "Failed to fetch code execution job");
                return reply.status(503).send({
                    success: false,
                    error: "Code execution queue is unavailable.",
                    message:
                        err.message ||
                        "Set REDIS_URL, QUEUE_REDIS_URL, or BULLMQ_REDIS_URL and make sure Redis is reachable.",
                });
            }
        });

        authFastify.get("/ide/executions", async (_request, reply) => {
            try {
                return {
                    success: true,
                    data: await getCodeExecutionQueueCounts(),
                };
            } catch (err: any) {
                return reply.status(503).send({
                    success: false,
                    error: "Code execution queue is unavailable.",
                    message:
                        err.message ||
                        "Set REDIS_URL, QUEUE_REDIS_URL, or BULLMQ_REDIS_URL and make sure Redis is reachable.",
                });
            }
        });

        // ── POST /api/ide/run ──────────────────────────────────────────
        // Runs code against SAMPLE test cases only.
        // Returns structured results with pass/fail for each test case.
        //
        // This is a synchronous endpoint — it submits to Judge0,
        // polls for results, compares outputs, and returns everything
        // in a single response. No SSE or callbacks needed.
        authFastify.post("/ide/run", async (request, reply) => {
            const parsed = runSchema.safeParse(request.body);
            if (!parsed.success) {
                return reply.status(400).send({
                    error: "Invalid Request",
                    details: parsed.error.flatten()
                });
            }

            const { question_id, questionId, code, language, language_id, contestId, source, customTests } = parsed.data;
            const finalQuestionId = question_id || questionId;
            const secureOaContext = await loadSecureOaCompanyQuestionContext(request, reply, finalQuestionId!, parsed.data);
            if (secureOaContext === null) return reply;

            if (!code.trim()) {
                return reply.status(400).send({ error: "Source code is empty." });
            }
            if (await rejectUnauthorizedContestBankPreview(request, reply, source)) return reply;

            try {
                if (secureOaContext?.questionType === "sql") {
                    const sqlDoc = await findSecureOaSqlQuestion(secureOaContext);
                    if (!sqlDoc) {
                        return reply.status(404).send({
                            success: false,
                            error: `Question not found: ${finalQuestionId}`,
                        });
                    }
                    return await runSecureOaSqlQuestion(sqlDoc, code, "run");
                }

                if (secureOaContext?.questionType === "dsa") {
                    const companyDoc = await findSecureOaDsaQuestion(secureOaContext);
                    if (!companyDoc) {
                        return reply.status(404).send({
                            success: false,
                            error: `Question not found: ${finalQuestionId}`,
                        });
                    }
                    return await runCodeForCompanyDSAQuestion({
                        questionId: String((companyDoc as any)._id),
                        companyId: secureOaContext.companyId,
                        sourceCode: code,
                        languageId: language_id,
                        language,
                        mode: "run",
                    });
                }

                // Fast path: try DSA question lookup
                let result;
                try {
                    result = await runCodeForQuestion({
                        questionId: finalQuestionId!,
                        sourceCode: code,
                        languageId: language_id,
                        language,
                        mode: "run",
                        contestId,
                        questionSource: source,
                        customTests,
                    });
                } catch (dsaErr: any) {
                    // If DSA lookup failed (question not found), try GenAI coding question
                    if (dsaErr?.message?.includes("Question not found")) {
                        const dsDoc = await findDSCodingQuestion(finalQuestionId!);
                        if (dsDoc) {
                            result = await runCodeForDSCodingQuestion({
                                sourceCode: code,
                                question: dsDoc,
                                mode: "run",
                            });
                        } else {
                            const genAIDoc = await findGenAICodingQuestion(finalQuestionId!);
                            if (!genAIDoc) {
                                return reply.status(404).send({
                                    success: false,
                                    error: `Question not found: ${finalQuestionId}`,
                                });
                            }
                            result = await runCodeForGenAIQuestion({
                                sourceCode: code,
                                language: language || "python",
                                sampleTestCases: (genAIDoc as any).sampleTestCases ?? [],
                            });
                        }
                    } else {
                        throw dsaErr;
                    }
                }

                return result;
            } catch (err: any) {
                request.log.error(err);
                return reply.status(500).send({
                    success: false,
                    error: err.message || "Code execution failed.",
                });
            }
        });


        // ── POST /api/ide/submit ───────────────────────────────────────
        // Runs code against ALL test cases (sample + hidden).
        // Returns sample test details, hidden test summary,
        // and only the first failed hidden test details when hidden failures exist.
        authFastify.post("/ide/submit", async (request, reply) => {
            const parsed = runSchema.safeParse(request.body);
            if (!parsed.success) {
                return reply.status(400).send({
                    error: "Invalid Request",
                    details: parsed.error.flatten()
                });
            }

            const { question_id, questionId, code, language, language_id, contestId, source } = parsed.data;
            const finalQuestionId = question_id || questionId;

            if (!code.trim()) {
                return reply.status(400).send({ error: "Source code is empty." });
            }

            // Entitlement gate — FREE blocked, PLUS capped to 10 hidden, PRO/MAX unlimited.
            if (await rejectUnauthorizedContestBankPreview(request, reply, source)) return reply;

            // Paywall removed globally: every user (including FREE) may submit
            // against hidden tests from the IDE. Previously requireDsaSubmit blocked
            // FREE and capped PLUS to 10 hidden tests, throwing an EntitlementError
            // ("Submitting to hidden test cases requires a paid plan."). The cast
            // keeps the original union type so the downstream plan checks still narrow.
            const decision = { plan: "ADMIN_PREVIEW", allowedHiddenCount: null } as
                Awaited<ReturnType<typeof requireDsaSubmit>> | { plan: "ADMIN_PREVIEW"; allowedHiddenCount: null };

            // For paid plans (PLUS, PRO, MAX), skip sample tests on submit to save API calls
            // Sample tests have already been run during the "Run" phase
            const skipSampleTests = source === "contest-bank" ? false : decision.plan !== "FREE";

            try {
                let result;
                try {
                    result = await runCodeForQuestion({
                        questionId: finalQuestionId!,
                        sourceCode: code,
                        languageId: language_id,
                        language,
                        mode: "submit",  // Sample + hidden test cases
                        maxHiddenTests: decision.allowedHiddenCount,
                        skipSampleTests,
                        contestId,
                        questionSource: source,
                    });
                } catch (dsaErr: any) {
                    if (!dsaErr?.message?.includes("Question not found")) {
                        throw dsaErr;
                    }

                    const dsDoc = await findDSCodingQuestion(finalQuestionId!);
                    if (dsDoc) {
                        result = await runCodeForDSCodingQuestion({
                            sourceCode: code,
                            question: dsDoc,
                            mode: "submit",
                        });
                    } else {
                        const genAIDoc = await findGenAICodingQuestion(finalQuestionId!);
                        if (!genAIDoc) {
                            return reply.status(404).send({
                                success: false,
                                error: `Question not found: ${finalQuestionId}`,
                            });
                        }
                        result = await runCodeForGenAIQuestion({
                            sourceCode: code,
                            language: language || "python",
                            sampleTestCases: (genAIDoc as any).sampleTestCases ?? [],
                        });
                    }
                }

                // Track submission and progress if authenticated
                const userId = request.user?.id;
                if (!source && userId && request.prisma) {
                    try {
                        let status = "pending";
                        if (!result.success && result.compileOutput) {
                            status = "compile_error";
                        } else if (result.success) {
                            const samplePassed = result.sample?.summary?.passed || 0;
                            const sampleTotal = result.sample?.summary?.total || 0;
                            const hiddenPassed = result.hidden?.summary?.passed || 0;
                            const hiddenTotal = result.hidden?.summary?.total || 0;
                            
                            const allPassed = (sampleTotal > 0 && samplePassed === sampleTotal) && 
                                              (!result.hidden?.summary || hiddenPassed === hiddenTotal);
                            
                            status = allPassed ? "accepted" : "wrong_answer";
                        } else {
                            status = "error";
                        }

                        // Determine cumulative runtime and memory
                        let maxRuntime = 0;
                        let maxMemory = 0;
                        if (result.sample?.tests) {
                            for (const t of result.sample.tests) {
                                if (t.time && parseFloat(t.time) > maxRuntime) maxRuntime = parseFloat(t.time);
                                if (t.memory && parseInt(t.memory) > maxMemory) maxMemory = parseInt(t.memory);
                            }
                        }
                        if (result.hidden?.firstFailed) {
                            const { time, memory } = result.hidden.firstFailed;
                            if (time && parseFloat(time) > maxRuntime) maxRuntime = parseFloat(time);
                            if (memory && parseInt(memory) > maxMemory) maxMemory = parseInt(memory);
                        }

                        await request.prisma.userQuestionSubmission.create({
                            data: {
                                userId,
                                questionId: finalQuestionId!,
                                code,
                                language: language || language_id?.toString() || "unknown",
                                status,
                                runtimeMs: maxRuntime > 0 ? Math.round(maxRuntime * 1000) : null,
                                memoryKb: maxMemory > 0 ? maxMemory : null,
                            }
                        });

                        // Make sure to query first to see if it exists to properly determine status update
                        const existingProgress = await request.prisma.userQuestionProgress.findUnique({
                            where: { userId_questionId: { userId, questionId: finalQuestionId! } }
                        });
                        
                        // Only change to attempted if it wasn't already solved. If solved, stay solved.
                        const newStatus = status === "accepted" ? "solved" : (existingProgress?.status === "solved" ? "solved" : "attempted");
                        
                        await request.prisma.userQuestionProgress.upsert({
                            where: {
                                userId_questionId: { userId, questionId: finalQuestionId! }
                            },
                            update: {
                                status: newStatus,
                                lastAttemptedAt: new Date(),
                                ...(status === "accepted" && !existingProgress?.solvedAt && { solvedAt: new Date() }),
                                language: language || language_id?.toString(),
                                attemptCount: { increment: 1 }
                            },
                            create: {
                                userId,
                                questionId: finalQuestionId!,
                                status: status === "accepted" ? "solved" : "attempted",
                                ...(status === "accepted" && { solvedAt: new Date() }),
                                language: language || language_id?.toString() || "unknown",
                                attemptCount: 1
                            }
                        });
                        
                        // Cache invalidation for progress and specific question submissions
                        await cacheDel([`ide:progress:${userId}`, `ide:submissions:${userId}:${finalQuestionId!}`]);

                        // Enforce successful-submission hourly cap (10 per hour per question).
                        // We increment AFTER a successful submission — a failure doesn't count.
                        if (status === "accepted" && decision.plan !== "ADMIN_PREVIEW") {
                            // Update streak — accepted submission counts as daily activity
                            updateStreakForUser(userId).catch((err) =>
                                request.log.error(err, "[IDE] Failed to update streak")
                            );
                            try {
                                await requireHourlySubmitCapAndIncrement(
                                    userId,
                                    finalQuestionId!,
                                    decision.plan
                                );
                            } catch (capErr) {
                                if (capErr instanceof EntitlementError) {
                                    return reply.status(capErr.statusCode).send({
                                        error: capErr.code,
                                        message: capErr.message,
                                        plan: capErr.plan,
                                        detail: capErr.detail,
                                        // Still include the result so the user sees the run outcome.
                                        result,
                                    });
                                }
                                throw capErr;
                            }
                        }
                    } catch (trackingErr) {
                        request.log.error(trackingErr, "Failed to track submission in DB or update Redis");
                    }
                }

                return result;
            } catch (err: any) {
                request.log.error(err);
                return reply.status(500).send({
                    success: false,
                    error: err.message || "Code execution failed.",
                });
            }
        });

        // ── POST /api/ide/submit-interview ─────────────────────
        // Interview IDE submit: run only the first 20 hidden tests and skip samples
        // to avoid duplicate Judge0 calls (samples are run via "Run").
        authFastify.post("/ide/submit-interview", async (request, reply) => {
            const rl = checkRateLimit(`ide:submit-interview:${request.user!.id}`, 15, 300_000);
            if (!rl.allowed) {
                return reply.status(429).send({
                    error: "Too Many Requests",
                    message: `Submission limit reached. Please wait ${Math.ceil(rl.retryAfterMs / 1000)}s before trying again.`,
                });
            }

            const parsed = runSchema.safeParse(request.body);
            if (!parsed.success) {
                return reply.status(400).send({
                    error: "Invalid Request",
                    details: parsed.error.flatten(),
                });
            }

            const { question_id, questionId, code, language, language_id } = parsed.data;
            const finalQuestionId = question_id || questionId;

            if (!code.trim()) {
                return reply.status(400).send({ error: "Source code is empty." });
            }

            try {
                const result = await runCodeForQuestion({
                    questionId: finalQuestionId!,
                    sourceCode: code,
                    languageId: language_id,
                    language,
                    mode: "submit",
                    maxHiddenTests: 20,
                    skipSampleTests: true,
                });

                return result;
            } catch (err: any) {
                request.log.error(err);
                return reply.status(500).send({
                    success: false,
                    error: err.message || "Code execution failed.",
                });
            }
        });

        // ── GET /api/ide/questions ─────────────────────────────────
        // Fetches all DSA questions with filters and pagination
        // Query params: difficulty, topics[], search, companies[], page, limit
        authFastify.get("/ide/questions", async (request, reply) => {
            // Log the raw query for debugging
            request.log.info({ query: request.query }, "Received query parameters");

            const parsed = dsaCatalogQuerySchema.safeParse(request.query);
            if (!parsed.success) {
                return reply.status(400).send({
                    error: "Invalid query parameters",
                    details: parsed.error.flatten(),
                });
            }

            const { difficulty, topics, companies, search, page, limit } = parsed.data;
            
            // Log parsed topics for debugging
            request.log.info({ topics, difficulty, search }, "Parsed filter parameters");

            // Build MongoDB query
            const filter: any = buildDSAAvailableForPracticeFilter();

            if (difficulty) {
                filter.difficulty = difficulty;
            }

            // Topics filter (match any of the provided topics)
            if (topics) {
                const topicArray = Array.isArray(topics) ? topics : [topics];
                filter.topics = { $in: topicArray };
            }

            // Companies filter (match any of the provided companies)
            // Note: companies field doesn't exist in current schema, but we'll add support for future
            // if (companies) {
            //     const companyArray = Array.isArray(companies) ? companies : [companies];
            //     filter.companies = { $in: companyArray };
            // }

            // Search filter (text search on title and description)
            if (search && search.trim()) {
                filter.$text = { $search: search.trim() };
            }

            try {
                await ensureMongoDBConnected();

                const skip = (page - 1) * limit;

                // Execute query with pagination
                const [questions, total] = await Promise.all([
                    DSAQuestion.find(filter)
                        .select("title problemId frontendId difficulty problemSlug topics")
                        .sort({ frontendId: 1, _id: 1 })
                        .collation({ locale: "en", numericOrdering: true })
                        .allowDiskUse(true)
                        .skip(skip)
                        .limit(limit)
                        .maxTimeMS(10000)
                        .lean(),
                    DSAQuestion.countDocuments(filter).maxTimeMS(10000),
                ]);

                const [topicsAggregationResult, difficultyAggregationResult] = await Promise.allSettled([
                    // Get all unique topics and their counts
                    DSAQuestion.aggregate([
                        { $match: buildDSAAvailableForPracticeFilter() },
                        { $unwind: "$topics" },
                        { $group: { _id: "$topics", count: { $sum: 1 } } },
                        { $sort: { count: -1 } },
                        { $limit: 50 },
                    ]).allowDiskUse(true),

                    // Get difficulty distribution
                    DSAQuestion.aggregate([
                        { $match: buildDSAAvailableForPracticeFilter() },
                        { $group: { _id: "$difficulty", count: { $sum: 1 } } },
                    ]).allowDiskUse(true),
                ]);

                if (topicsAggregationResult.status === "rejected") {
                    request.log.warn({ err: topicsAggregationResult.reason }, "Failed to fetch DSA topic counts");
                }
                if (difficultyAggregationResult.status === "rejected") {
                    request.log.warn({ err: difficultyAggregationResult.reason }, "Failed to fetch DSA difficulty counts");
                }

                const topicsAggregation =
                    topicsAggregationResult.status === "fulfilled" ? topicsAggregationResult.value : [];
                const difficultyAggregation =
                    difficultyAggregationResult.status === "fulfilled" ? difficultyAggregationResult.value : [];

                const topicCounts = Object.fromEntries(
                    topicsAggregation.map((t) => [t._id, t.count])
                );

                const difficultyCounts = Object.fromEntries(
                    difficultyAggregation.map((d) => [d._id, d.count])
                );

                // Format questions response
                const formattedQuestions = questions.map((q: any) => ({
                    id: q._id.toString(),
                    problemId: q.problemId,
                    frontendId: q.frontendId,
                    title: q.title,
                    slug: q.problemSlug,
                    difficulty: q.difficulty,
                    topics: q.topics || [],
                    // Mock acceptance rate for now (will be real once we have analytics)
                    acceptanceRate: Math.floor(Math.random() * 50 + 30), // 30-80%
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
                            difficulties: difficultyCounts,
                        },
                    },
                };
            } catch (err: any) {
                request.log.error(err);
                const fallbackCatalog = getFallbackCodingCatalog();
                if (fallbackCatalog.length > 0) {
                    const fallbackData = formatFallbackQuestions(fallbackCatalog, {
                        difficulty,
                        topics,
                        page,
                        limit,
                    });

                    reply.cacheControl("NONE");
                    return {
                        success: true,
                        data: fallbackData,
                    };
                }

                return reply.status(503).send({
                    success: false,
                    error: "Question bank is temporarily unavailable",
                });
            }
        });

        // ── GET /api/ide/progress ──────────────────────────────────
        // Get user's progress for all questions
        authFastify.get("/ide/progress", async (request, reply) => {
            const userId = request.user?.id;

            if (!userId) {
                return reply.status(401).send({
                    success: false,
                    error: "User not authenticated",
                });
            }

            try {
                // Check if Prisma is available and table exists
                if (!request.prisma) {
                    return reply.send({ 
                        success: true,
                        data: {
                            progress: {},
                            stats: {
                                totalAttempted: 0,
                                totalSolved: 0,
                            },
                        },
                    });
                }

                try {
                    const cacheKey = `ide:progress:${userId}`;
                    const fetchProgressData = async () => {
                        const progress = await request.prisma.userQuestionProgress.findMany({
                            where: { userId },
                            select: {
                                questionId: true,
                                status: true,
                                solvedAt: true,
                                timeTaken: true,
                                language: true,
                                bestScore: true,
                                attemptCount: true,
                            },
                        });

                        // Convert to map for easier lookup
                        const progressMap = Object.fromEntries(
                            progress.map((p) => [
                                p.questionId,
                                {
                                    status: p.status,
                                    solvedAt: p.solvedAt,
                                    timeTaken: p.timeTaken,
                                    language: p.language,
                                    bestScore: p.bestScore,
                                    attemptCount: p.attemptCount,
                                },
                            ])
                        );

                        return {
                            progress: progressMap,
                            stats: {
                                totalAttempted: progress.length,
                                totalSolved: progress.filter((p) => p.status === "solved").length,
                            },
                        };
                    };

                    const cachedData = await cacheGet(cacheKey, 3600 * 24, fetchProgressData); // 24-hour TTL

                    reply.cacheControl("USER_FAST");
                    return {
                        success: true,
                        data: cachedData,
                    };
                } catch (prismaError: any) {
                    // Table doesn't exist yet or other Prisma error - return empty progress
                    request.log.warn({ error: prismaError }, "Prisma error in progress fetch");
                    return reply.send({ 
                        success: true,
                        data: {
                            progress: {},
                            stats: {
                                totalAttempted: 0,
                                totalSolved: 0,
                            },
                        },
                    });
                }
            } catch (err: any) {
                request.log.error(err);
                // Return empty progress instead of error to not break the UI
                return reply.send({
                    success: true,
                    data: {
                        progress: {},
                        stats: {
                            totalAttempted: 0,
                            totalSolved: 0,
                        },
                    },
                });
            }
        });

        // ── POST /api/ide/progress/:questionId ────────────────────
        // Update user progress for a specific question
        authFastify.post("/ide/progress/:questionId", async (request, reply) => {
            const userId = request.user?.id;
            if (!userId) {
                return reply.status(401).send({ error: "User not authenticated" });
            }
            
            const { questionId } = request.params as { questionId: string };

            const bodySchema = z.object({
                status: z.enum(["attempted", "solved"]),
                timeTaken: z.number().int().positive().optional(),
                language: z.string().optional(),
                score: z.number().min(0).max(100).optional(),
            });

            const parsed = bodySchema.safeParse(request.body);
            if (!parsed.success) {
                return reply.status(400).send({
                    error: "Invalid request body",
                    details: parsed.error.flatten(),
                });
            }

            const { status, timeTaken, language, score } = parsed.data;

            try {
                // Verify question exists in MongoDB
                const question = await DSAQuestion.findById(questionId);
                if (!question) {
                    return reply.status(404).send({ error: "Question not found" });
                }

                // Upsert progress
                const progress = await request.prisma.userQuestionProgress.upsert({
                    where: {
                        userId_questionId: {
                            userId,
                            questionId,
                        },
                    },
                    update: {
                        status,
                        lastAttemptedAt: new Date(),
                        ...(status === "solved" && { solvedAt: new Date() }),
                        ...(timeTaken && { timeTaken }),
                        ...(language && { language }),
                        ...(score && { bestScore: score }),
                        attemptCount: { increment: 1 },
                    },
                    create: {
                        userId,
                        questionId,
                        status,
                        ...(status === "solved" && { solvedAt: new Date() }),
                        ...(timeTaken && { timeTaken }),
                        ...(language && { language }),
                        ...(score && { bestScore: score }),
                        attemptCount: 1,
                    },
                });

                // Invalidate the global progress cache
                await cacheDel([`ide:progress:${userId}`]);

                return {
                    success: true,
                    data: {
                        questionId: progress.questionId,
                        status: progress.status,
                        solvedAt: progress.solvedAt,
                    },
                };
            } catch (err: any) {
                request.log.error(err);
                return reply.status(500).send({
                    success: false,
                    error: "Failed to update progress",
                });
            }
        });

        // ── GET /api/ide/submissions/:questionId ────────────────────
        // Fetch all previous submissions for a specific question for the current user
        authFastify.get("/ide/submissions/:questionId", async (request, reply) => {
            const userId = request.user?.id;
            if (!userId) {
                return reply.status(401).send({ error: "User not authenticated" });
            }
            
            const { questionId } = request.params as { questionId: string };

            if (!request.prisma) {
                return reply.send({ success: true, data: [] });
            }

            try {
                const cacheKey = `ide:submissions:${userId}:${questionId}`;
                const fetchSubmissionsData = async () => {
                    return await request.prisma.userQuestionSubmission.findMany({
                        where: { userId, questionId },
                        orderBy: { createdAt: "desc" },
                    });
                };

                const submissions = await cacheGet(cacheKey, 3600, fetchSubmissionsData); // 1-hour TTL

                return {
                    success: true,
                    data: submissions,
                };
            } catch (err: any) {
                request.log.error(err, "Failed to fetch question submissions");
                return reply.status(500).send({
                    success: false,
                    error: "Failed to fetch submissions",
                });
            }
        });

    });
}
