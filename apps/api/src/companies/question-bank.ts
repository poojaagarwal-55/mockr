import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import mongoose from "mongoose";
import { connectMongoDB } from "../lib/mongodb.js";
import { checkRateLimit } from "../lib/rate-limiter.js";
import { uploadToR2 } from "../lib/r2.js";
import { DSAQuestion } from "../models/DSAQuestion.js";
import { SQLQuestion } from "../models/SQLQuestion.js";
import { CSFundamentalQuestion } from "../models/CSFundamentalQuestion.js";
import { SystemDesignQuestion } from "../models/system-design-question.js";
import {
    COMPANY_QUESTION_BANK_MODELS,
    CompanyQuestionSet,
    CompanyDSAQuestion,
    CompanyCSFundamentalQuestion,
    CompanySQLQuestion,
    CompanySystemDesignQuestion,
    type CompanyQuestionBankType,
    type CompanyQuestionOwner,
} from "../models/CompanyQuestionBank.js";
import { runCodeForCompanyDSAQuestion, runCodeForQuestion } from "../services/code-execution.js";
import { generateExpectedOutput, LOCAL_EXPECTED_OUTPUT_CACHE, runBatchSqlQueries } from "../services/sql-execution.js";
import { isCompanyAdminRole, requireCompanyWorkspaceAccess } from "./access.js";

declare module "fastify" {
    interface FastifyRequest {
        companyQuestionOwner?: CompanyQuestionOwner;
    }
}

const routeTypeSchema = z.enum(["dsa", "sql", "system-design", "cs-fundamentals"]);
const difficultySchema = z.enum(["Easy", "Medium", "Hard"]);
const statusSchema = z.enum(["draft", "published", "archived"]);
const nonEmptyString = (max: number) => z.string().trim().min(1).max(max);
const nonEmptyCodeString = (max: number) => z.string().max(max).refine((value) => value.trim().length > 0, "Required");
const stringList = z.array(z.string().trim().min(1).max(120)).max(80).default([]);
const requiredStringList = z.array(z.string().trim().min(1).max(120)).min(1).max(80);
const mixedObject = z.record(z.any());
const requiredCodeLanguages = ["python3", "cpp", "java", "javascript"] as const;
const allowedDiagramMimeTypes = ["image/jpeg", "image/png", "image/webp"] as const;

function hasCompletedValue(value: unknown) {
    if (value === null || value === undefined) return false;
    if (typeof value === "string") return value.trim().length > 0;
    return true;
}

function diagramExtensionForMimeType(mimeType: typeof allowedDiagramMimeTypes[number]) {
    return mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1];
}

const jsonOutputValue = z.any()
    .refine(hasCompletedValue, "Expected output is required")
    .refine((value) => typeof value !== "string" || value.length <= 100_000, "Expected output is too large")
    .transform((value, ctx) => {
        if (typeof value !== "string") return value;
        try {
            return JSON.parse(value);
        } catch {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Expected output must be valid JSON",
            });
            return z.NEVER;
        }
    });

const dsaTestCaseSchema = z.object({
    id: nonEmptyString(120),
    description: z.string().trim().max(500).optional(),
    input: z.any().refine(hasCompletedValue, "Input is required"),
    output: z.any().refine(hasCompletedValue, "Output is required"),
});

const dsaCodeSnippetSchema = z.object({
    starter_code: nonEmptyCodeString(50_000),
    wrapper_code: nonEmptyCodeString(50_000),
});

const dsaQuestionSchema = z.object({
    title: nonEmptyString(240),
    problemId: nonEmptyString(120),
    frontendId: z.string().trim().max(120).optional(),
    difficulty: difficultySchema,
    problemSlug: nonEmptyString(180),
    topics: requiredStringList,
    companyTags: stringList,
    description: nonEmptyString(20_000),
    examples: z.array(z.object({
        example_num: z.coerce.number().int().min(1).max(50).optional(),
        example_text: nonEmptyString(10_000),
    })).min(1).max(20),
    constraints: requiredStringList,
    sampleTestCases: z.array(dsaTestCaseSchema).min(1).max(50),
    hiddenTestCases: z.array(dsaTestCaseSchema).min(1).max(200),
    codeSnippets: z.object(
        Object.fromEntries(requiredCodeLanguages.map((language) => [language, dsaCodeSnippetSchema])) as Record<typeof requiredCodeLanguages[number], typeof dsaCodeSnippetSchema>
    ).catchall(dsaCodeSnippetSchema),
    solution: mixedObject.optional(),
    followUp: stringList,
    hints: stringList,
    status: statusSchema.default("draft"),
});

const sqlQuestionSchema = z.object({
    title: nonEmptyString(240),
    description: nonEmptyString(20_000),
    schema: z.string().trim().max(50_000).optional(),
    examples: z.array(mixedObject).max(20).default([]),
    testCases: z.array(z.object({
        id: z.union([z.string(), z.number()]),
        label: z.string().trim().max(300).optional(),
        input: z.any().optional(),
        expected_output: jsonOutputValue,
    })).min(1).max(100),
    wrapperCode: nonEmptyCodeString(50_000),
    solution: z.any().refine(hasCompletedValue, "Solution is required"),
    judge0LanguageId: z.coerce.number().int().positive(),
    hiddenTestCases: z.array(z.object({
        id: nonEmptyString(120),
        label: z.string().trim().max(300).optional(),
        expected_output: jsonOutputValue,
        wrapper_code: nonEmptyCodeString(50_000),
    })).min(1).max(200),
    difficulty: difficultySchema.default("Medium"),
    tags: requiredStringList,
    status: statusSchema.default("draft"),
});

const referenceDiagramSchema = z.object({
    url: z.string().trim().url().max(2_000),
    source: z.enum(["url", "upload"]),
    key: z.string().trim().max(600).optional(),
    filename: z.string().trim().max(300).optional(),
    contentType: z.enum(allowedDiagramMimeTypes).optional(),
    size: z.coerce.number().int().positive().max(5 * 1024 * 1024).optional(),
    uploadedAt: z.string().datetime().optional(),
});

const systemDesignQuestionSchema = z.object({
    slug: nonEmptyString(180),
    title: nonEmptyString(240),
    difficulty: difficultySchema,
    problemStatement: nonEmptyString(50_000),
    rubricLite: mixedObject,
    rubricFull: mixedObject,
    hints: stringList,
    followUpQuestions: stringList,
    architectureDiagram: z.any().optional().nullable(),
    sampleDiagramUrl: z.string().trim().url().max(2_000).optional().nullable(),
    referenceDiagram: referenceDiagramSchema.optional().nullable(),
    tags: stringList,
    status: statusSchema.default("draft"),
});

const csFundamentalQuestionSchema = z.object({
    topic: z.enum(["CN", "DBMS", "OOPS", "OS"]),
    question: nonEmptyString(10_000),
    answer: nonEmptyString(50_000),
    detailedAnswer: z.string().trim().max(80_000).optional(),
    difficulty: difficultySchema.default("Medium"),
    tags: stringList,
    status: statusSchema.default("draft"),
});

const querySchema = z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(25),
    search: z.string().trim().max(200).optional(),
    difficulty: difficultySchema.optional(),
    status: statusSchema.optional(),
    topic: z.string().trim().max(120).optional(),
});

const datasetQuerySchema = z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(200).default(150),
    search: z.string().trim().max(200).optional(),
    difficulty: difficultySchema.optional(),
    topic: z.string().trim().max(120).optional(),
});

const importDSAQuestionsSchema = z.object({
    questionIds: z.array(
        z.string().refine((value) => mongoose.Types.ObjectId.isValid(value), "Invalid question id")
    ).min(1).max(200),
});

const importSQLQuestionsSchema = importDSAQuestionsSchema;
const importCSFundamentalsQuestionsSchema = importDSAQuestionsSchema;
const importSystemDesignQuestionsSchema = importDSAQuestionsSchema;

const datasetIdParamsSchema = z.object({
    id: z.string().refine((value) => mongoose.Types.ObjectId.isValid(value), "Invalid question id"),
});

const idParamsSchema = z.object({
    type: routeTypeSchema,
    id: z.string().refine((value) => mongoose.Types.ObjectId.isValid(value), "Invalid question id"),
});
const runPreviewParamsSchema = idParamsSchema;
const runPreviewBodySchema = z.object({
    code: nonEmptyCodeString(100_000),
    language: z.string().trim().min(1).max(40).optional(),
    language_id: z.coerce.number().int().positive().optional(),
    mode: z.enum(["run", "submit"]).default("run"),
});
const questionSetTypeSchema = z.enum(["dsa", "sql", "system_design", "cs_fundamentals"]);
const questionSetStatusSchema = z.enum(["draft", "active", "archived"]);
const questionSetIdParamsSchema = z.object({
    id: z.string().refine((value) => mongoose.Types.ObjectId.isValid(value), "Invalid question set id"),
});
const questionSetItemInputSchema = z.object({
    type: questionSetTypeSchema,
    questionId: z.string().refine((value) => mongoose.Types.ObjectId.isValid(value), "Invalid question id"),
});
const questionSetBodySchema = z.object({
    title: nonEmptyString(180),
    description: z.string().trim().max(1000).default(""),
    status: questionSetStatusSchema.default("active"),
    items: z.array(questionSetItemInputSchema).min(1).max(80),
});

function normalizeRouteType(type: z.infer<typeof routeTypeSchema>): CompanyQuestionBankType {
    if (type === "system-design") return "system_design";
    if (type === "cs-fundamentals") return "cs_fundamentals";
    return type;
}

function schemaForType(type: CompanyQuestionBankType) {
    switch (type) {
        case "dsa":
            return dsaQuestionSchema;
        case "sql":
            return sqlQuestionSchema;
        case "system_design":
            return systemDesignQuestionSchema;
        case "cs_fundamentals":
            return csFundamentalQuestionSchema;
    }
}

function modelForType(type: CompanyQuestionBankType) {
    return COMPANY_QUESTION_BANK_MODELS[type] as any;
}

function publicQuestion(doc: any) {
    if (!doc) return doc;
    const question = typeof doc.toObject === "function" ? doc.toObject() : doc;
    return {
        ...question,
        ...(question.codeSnippets ? { codeSnippets: publicCodeSnippets(question.codeSnippets) } : {}),
        id: String(question._id),
        _id: undefined,
        company: undefined,
    };
}

function normalizePlainDoc(doc: any) {
    if (!doc) return doc;
    if (typeof doc.toObject === "function") {
        return doc.toObject({ flattenMaps: true });
    }
    return JSON.parse(JSON.stringify(doc));
}

function normalizeExpectedOutput(value: any) {
    return value?.expected_output ?? value?.expectedOutput ?? value?.output ?? value?.expected ?? "";
}

function normalizeSQLTestCases(testCases: any[] | undefined) {
    return (Array.isArray(testCases) ? testCases : [])
        .map((testCase, index) => ({
            id: testCase?.id ?? `sample_${index + 1}`,
            label: testCase?.label || `Sample Test ${index + 1}`,
            input: testCase?.input,
            expected_output: normalizeExpectedOutput(testCase),
        }))
        .filter((testCase) => hasCompletedValue(testCase.expected_output));
}

function normalizeSQLHiddenTestCases(hiddenTestCases: any[] | undefined, fallbackWrapperCode: string, fallbackExpectedOutput?: any) {
    const normalized = (Array.isArray(hiddenTestCases) ? hiddenTestCases : [])
        .map((testCase, index) => ({
            id: testCase?.id || `hidden_${index + 1}`,
            label: testCase?.label || `Hidden Test ${index + 1}`,
            expected_output: normalizeExpectedOutput(testCase),
            wrapper_code: testCase?.wrapper_code || testCase?.wrapperCode || fallbackWrapperCode,
        }))
        .filter((testCase) => hasCompletedValue(testCase.expected_output) && hasCompletedValue(testCase.wrapper_code));

    if (normalized.length > 0 || !hasCompletedValue(fallbackExpectedOutput) || !hasCompletedValue(fallbackWrapperCode)) {
        return normalized;
    }

    return [{
        id: "hidden_1",
        label: "Hidden Test 1",
        expected_output: fallbackExpectedOutput,
        wrapper_code: fallbackWrapperCode,
    }];
}

function writeErrorReply(reply: FastifyReply, err: any) {
    if (err?.code === 11000) {
        return reply.status(409).send({
            error: "Duplicate Question",
            message: "This question already exists in your company question bank.",
        });
    }

    if (err?.name === "ValidationError" || err?.name === "MongoBulkWriteError" || err?.writeErrors?.length) {
        return reply.status(400).send({
            error: "Validation Error",
            message: "Question data is incomplete or incompatible with this question bank schema.",
        });
    }

    throw err;
}

function previewDescription(value?: string) {
    if (!value) return "";

    const normalized = value
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/\r\n/g, "\n");

    const cutoffIndex = normalized.search(/\b(?:examples?|custom\s+judge)\b/i);
    const beforeExamples = cutoffIndex >= 0 ? normalized.slice(0, cutoffIndex) : normalized;

    return beforeExamples
        .replace(/```[\s\S]*?```/g, "")
        .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
        .replace(/[*_~`>#]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

function datasetQuestion(doc: any, addedIds: Set<string>) {
    const id = String(doc._id);
    const sampleCount = Array.isArray(doc.sampleTestCases) ? doc.sampleTestCases.length : 0;
    const hiddenCount = Array.isArray(doc.hiddenTestCases) ? doc.hiddenTestCases.length : 0;
    const estimatedTimeMinutes =
        doc.difficulty === "Easy" ? 25 :
            doc.difficulty === "Hard" ? 50 :
                35;

    return {
        id,
        title: doc.title,
        problemId: doc.problemId,
        frontendId: doc.frontendId,
        slug: doc.problemSlug,
        difficulty: doc.difficulty,
        description: previewDescription(doc.description),
        topics: doc.topics || [],
        sampleTestCaseCount: sampleCount,
        hiddenTestCaseCount: hiddenCount,
        testCaseCount: sampleCount + hiddenCount,
        estimatedTimeMinutes,
        alreadyAdded: addedIds.has(id),
    };
}

function snippetEntries(codeSnippets: any): [string, any][] {
    if (!codeSnippets) return [];
    if (codeSnippets instanceof Map) return Array.from(codeSnippets.entries());
    return Object.entries(codeSnippets);
}

function availableLanguages(codeSnippets: any) {
    return snippetEntries(codeSnippets)
        .filter(([, snippet]) => typeof snippet?.starter_code === "string" && snippet.starter_code.trim())
        .map(([language]) => language);
}

function publicCodeSnippets(codeSnippets: any) {
    return Object.fromEntries(
        snippetEntries(codeSnippets)
            .filter(([, snippet]) => snippet && typeof snippet === "object")
            .map(([language, snippet]) => [
                language,
                {
                    starter_code: typeof snippet.starter_code === "string" ? snippet.starter_code : "",
                    wrapper_code: typeof snippet.wrapper_code === "string" ? snippet.wrapper_code : "",
                },
            ])
    );
}

function datasetQuestionDetail(doc: any, alreadyAdded: boolean) {
    const sampleCount = Array.isArray(doc.sampleTestCases) ? doc.sampleTestCases.length : 0;
    const hiddenCount = Array.isArray(doc.hiddenTestCases) ? doc.hiddenTestCases.length : 0;
    const estimatedTimeMinutes =
        doc.difficulty === "Easy" ? 25 :
            doc.difficulty === "Hard" ? 50 :
                35;

    return {
        id: String(doc._id),
        title: doc.title,
        problemId: doc.problemId,
        frontendId: doc.frontendId,
        slug: doc.problemSlug,
        difficulty: doc.difficulty,
        description: previewDescription(doc.description),
        examples: doc.examples || [],
        constraints: doc.constraints || [],
        topics: doc.topics || [],
        sampleTestCases: doc.sampleTestCases || [],
        codeSnippets: publicCodeSnippets(doc.codeSnippets),
        sampleTestCaseCount: sampleCount,
        hiddenTestCaseCount: hiddenCount,
        testCaseCount: sampleCount + hiddenCount,
        estimatedTimeMinutes,
        availableLanguages: availableLanguages(doc.codeSnippets),
        alreadyAdded,
    };
}

function previewSQLDescription(value?: string) {
    if (!value) return "";
    const normalized = value
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/\r\n/g, "\n");
    const cutoffIndex = normalized.search(/\btable\s*:/i);
    const beforeTable = cutoffIndex >= 0 ? normalized.slice(0, cutoffIndex) : normalized;

    return beforeTable
        .replace(/```[\s\S]*?```/g, "")
        .replace(/[*_~`>#]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

function sqlSchemaText(value?: string) {
    if (!value) return "";
    const normalized = value
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/\r\n/g, "\n")
        .trim();
    const startIndex = normalized.search(/\b(?:table\s*:\s*[a-zA-Z_][\w]*|[a-zA-Z_][\w]*\s+table\s*:)/i);
    if (startIndex < 0) return "";
    const schemaText = normalized.slice(startIndex);
    const endIndex = schemaText.search(/(?:^|\n)\s*(?:example|input|output|explanation|constraints?)\s*\d*\s*[:\n]/i);
    return (endIndex >= 0 ? schemaText.slice(0, endIndex) : schemaText).trim();
}

function sqlDatasetQuestion(doc: any, addedIds: Set<string>) {
    const id = String(doc._id);
    const sampleCount = Array.isArray(doc.testCases) ? doc.testCases.length : 0;
    const hiddenCount = Array.isArray(doc.hiddenTestCases) ? doc.hiddenTestCases.length : 0;

    return {
        id,
        title: doc.title,
        difficulty: "Medium",
        description: previewSQLDescription(doc.description),
        schema: doc.schema,
        tags: ["SQL"],
        testCaseCount: sampleCount + hiddenCount,
        sampleTestCaseCount: sampleCount,
        hiddenTestCaseCount: hiddenCount,
        estimatedTimeMinutes: 35,
        alreadyAdded: addedIds.has(id),
    };
}

function sqlDatasetQuestionDetail(doc: any, alreadyAdded: boolean) {
    return {
        ...sqlDatasetQuestion(doc, new Set(alreadyAdded ? [String(doc._id)] : [])),
        schema: doc.schema || sqlSchemaText(doc.description),
        examples: doc.examples || [],
        testCases: doc.testCases || [],
        hiddenTestCases: doc.hiddenTestCases || [],
        wrapperCode: doc.wrapperCode,
        solution: doc.solution,
        judge0LanguageId: doc.judge0LanguageId,
    };
}

function previewTheoryText(value?: string) {
    return cleanTheoryText(value)
        .replace(/\s+/g, " ")
        .trim();
}

function cleanTheoryText(value?: string) {
    if (!value) return "";
    return value
        .replace(/cite[^]*/g, "")
        .replace(/【[^】]*†[^】]*】/g, "")
        .replace(/\[\s*cite\s*:\s*\d+(?:\s*,\s*\d+)*\s*\]/gi, "")
        .replace(/\[(?:\d+|citation needed|source)(?:\s*,\s*\d+)*\]/gi, "")
        .replace(/\s+\((?:\d+|source|citation)(?:\s*,\s*\d+)*\)/gi, "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/\r\n/g, "\n")
        .replace(/[*_~`>#]/g, "")
        .trim();
}

function csDatasetQuestion(doc: any, addedIds: Set<string>) {
    const id = String(doc._id);
    return {
        id,
        topic: doc.topic,
        question: doc.question,
        answerPreview: previewTheoryText(doc.answer).slice(0, 260),
        difficulty: "Medium",
        tags: [doc.topic].filter(Boolean),
        alreadyAdded: addedIds.has(id),
    };
}

function csDatasetQuestionDetail(doc: any, alreadyAdded: boolean) {
    return {
        ...csDatasetQuestion(doc, new Set(alreadyAdded ? [String(doc._id)] : [])),
        answer: doc.answer,
        detailedAnswer: doc.detailedAnswer,
    };
}

function systemDesignDatasetQuestion(doc: any, addedIds: Set<string>) {
    const id = String(doc._id);
    return {
        id,
        slug: doc.slug,
        title: doc.title,
        difficulty: doc.difficulty,
        problemStatement: previewTheoryText(doc.problemStatement).slice(0, 320),
        tags: Array.isArray(doc.tags) && doc.tags.length ? doc.tags : ["System Design"],
        hintCount: Array.isArray(doc.hints) ? doc.hints.length : 0,
        followUpCount: Array.isArray(doc.followUpQuestions) ? doc.followUpQuestions.length : 0,
        hasDiagram: Boolean(doc.referenceDiagram?.url || doc.sampleDiagramUrl || doc.architectureDiagram),
        alreadyAdded: addedIds.has(id),
    };
}

function systemDesignDatasetQuestionDetail(doc: any, alreadyAdded: boolean) {
    return {
        ...systemDesignDatasetQuestion(doc, new Set(alreadyAdded ? [String(doc._id)] : [])),
        problemStatement: doc.problemStatement,
        rubricLite: doc.rubricLite,
        rubricFull: doc.rubricFull,
        hints: doc.hints || [],
        followUpQuestions: doc.followUpQuestions || [],
        architectureDiagram: doc.architectureDiagram,
        sampleDiagramUrl: doc.sampleDiagramUrl,
        referenceDiagram: doc.referenceDiagram || (doc.sampleDiagramUrl ? { url: doc.sampleDiagramUrl, source: "url" } : null),
    };
}

function detailProjection(type: CompanyQuestionBankType) {
    switch (type) {
        case "dsa":
            return "+hiddenTestCases +solution";
        case "sql":
            return "+hiddenTestCases +solution";
        case "system_design":
            return "+rubricFull";
        case "cs_fundamentals":
            return "+answer +detailedAnswer";
    }
}

async function requireCompanyQuestionOwner(request: FastifyRequest, reply: FastifyReply) {
    const company = request.company;
    if (!company) {
        return reply.status(401).send({ error: "Unauthorized", message: "Company workspace authentication required." });
    }

    if (!isCompanyAdminRole(company.role)) {
        return reply.status(403).send({
            error: "Forbidden",
            message: "Only company owners and admins can manage the company question bank.",
        });
    }

    request.companyQuestionOwner = {
        id: company.id,
        email: company.email.toLowerCase(),
        domain: company.domain.toLowerCase(),
        name: company.name,
    };
}

function ownershipFilter(request: FastifyRequest) {
    return { "company.id": request.companyQuestionOwner!.id };
}

function questionTitleForType(type: CompanyQuestionBankType, doc: any) {
    if (type === "cs_fundamentals") return String(doc.question || "CS fundamentals question");
    return String(doc.title || "Untitled question");
}

function publicQuestionSet(doc: any) {
    const questionSet = typeof doc?.toObject === "function" ? doc.toObject() : doc;
    return {
        id: String(questionSet._id),
        title: questionSet.title,
        description: questionSet.description || "",
        status: questionSet.status,
        items: (questionSet.items || []).map((item: any) => ({
            type: item.type,
            questionId: item.questionId,
            title: item.title,
            difficulty: item.difficulty || null,
            orderIndex: item.orderIndex || 0,
        })),
        createdAt: questionSet.createdAt,
        updatedAt: questionSet.updatedAt,
    };
}

async function resolveQuestionSetItems(request: FastifyRequest, items: z.infer<typeof questionSetItemInputSchema>[]) {
    const uniqueItems = Array.from(
        new Map(items.map((item) => [`${item.type}:${item.questionId}`, item])).values()
    );
    const docsByKey = new Map<string, any>();

    for (const type of questionSetTypeSchema.options) {
        const ids = uniqueItems
            .filter((item) => item.type === type)
            .map((item) => item.questionId);
        if (!ids.length) continue;

        const Model = modelForType(type);
        const docs = await Model.find({
            ...ownershipFilter(request),
            _id: { $in: ids },
            status: { $ne: "archived" },
        }).select("title question difficulty").lean();

        for (const doc of docs) {
            docsByKey.set(`${type}:${String(doc._id)}`, doc);
        }
    }

    const missing = uniqueItems.find((item) => !docsByKey.has(`${item.type}:${item.questionId}`));
    if (missing) {
        return {
            error: `Question not found in your company question bank: ${missing.type}:${missing.questionId}`,
        };
    }

    return {
        items: uniqueItems.map((item, index) => {
            const doc = docsByKey.get(`${item.type}:${item.questionId}`);
            return {
                type: item.type,
                questionId: item.questionId,
                title: questionTitleForType(item.type, doc),
                difficulty: doc?.difficulty || null,
                orderIndex: index,
            };
        }),
    };
}

export default async function companyQuestionBankRoutes(fastify: FastifyInstance) {
    fastify.addHook("preHandler", fastify.authenticate);
    fastify.addHook("preHandler", requireCompanyWorkspaceAccess);
    fastify.addHook("preHandler", requireCompanyQuestionOwner);

    fastify.post("/companies/question-bank/system-design/diagram-upload", async (request, reply) => {
        const companyId = request.companyQuestionOwner!.id;
        const rl = checkRateLimit(`companies:question-bank:system-design-diagram:${companyId}`, 20, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Diagram upload limit reached. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        const data = await request.file();
        if (!data) {
            return reply.status(400).send({ error: "No file provided", message: "Choose a reference diagram image." });
        }

        if (!allowedDiagramMimeTypes.includes(data.mimetype as typeof allowedDiagramMimeTypes[number])) {
            return reply.status(400).send({
                error: "Invalid file type",
                message: "Only JPEG, PNG, or WebP images are allowed.",
            });
        }

        const buffer = await data.toBuffer();
        if (buffer.length > 5 * 1024 * 1024) {
            return reply.status(400).send({
                error: "File too large",
                message: "Reference diagram must be under 5MB.",
            });
        }

        const contentType = data.mimetype as typeof allowedDiagramMimeTypes[number];
        const ext = diagramExtensionForMimeType(contentType);
        const key = `company-question-bank/${companyId}/system-design-diagrams/${randomUUID()}.${ext}`;
        const fileUrl = await uploadToR2(key, buffer, contentType);
        const diagram = {
            url: fileUrl,
            source: "upload" as const,
            key,
            filename: data.filename?.slice(0, 300),
            contentType,
            size: buffer.length,
            uploadedAt: new Date().toISOString(),
        };

        return reply.status(201).send({ fileUrl, diagram });
    });

    fastify.get("/companies/question-bank/dsa/dataset", async (request, reply) => {
        const query = datasetQuerySchema.safeParse(request.query);
        if (!query.success) {
            return reply.status(400).send({ error: "Validation Error", details: query.error.flatten().fieldErrors });
        }

        await connectMongoDB();

        const { page, limit, search, difficulty, topic } = query.data;
        const filter: Record<string, any> = {};
        if (difficulty) filter.difficulty = difficulty;
        if (topic) filter.topics = topic;
        if (search) filter.$text = { $search: search };

        const skip = (page - 1) * limit;
        const [questions, total, addedQuestions] = await Promise.all([
            DSAQuestion.find(filter)
                .select("title problemId frontendId difficulty problemSlug topics description sampleTestCases hiddenTestCases")
                .sort({ frontendId: 1 })
                .collation({ locale: "en_US", numericOrdering: true })
                .skip(skip)
                .limit(limit)
                .lean(),
            DSAQuestion.countDocuments(filter),
            CompanyDSAQuestion.find({ "company.id": request.companyQuestionOwner!.id })
                .select("sourceQuestionId")
                .lean(),
        ]);

        const addedIds = new Set(
            addedQuestions
                .map((question: any) => question.sourceQuestionId)
                .filter(Boolean)
                .map(String)
        );

        return {
            questions: questions.map((question: any) => datasetQuestion(question, addedIds)),
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        };
    });

    fastify.get("/companies/question-bank/dsa/dataset/:id", async (request, reply) => {
        const params = datasetIdParamsSchema.safeParse(request.params);
        if (!params.success) {
            return reply.status(400).send({ error: "Validation Error", details: params.error.flatten().fieldErrors });
        }

        await connectMongoDB();

        const [question, existing] = await Promise.all([
            DSAQuestion.findById(params.data.id)
                .select("title problemId frontendId difficulty problemSlug topics description examples constraints sampleTestCases hiddenTestCases codeSnippets")
                .lean(),
            CompanyDSAQuestion.findOne({
                "company.id": request.companyQuestionOwner!.id,
                sourceQuestionId: params.data.id,
            }).select("_id").lean(),
        ]);

        if (!question) {
            return reply.status(404).send({ error: "Not Found", message: "Dataset question not found." });
        }

        return { question: datasetQuestionDetail(question, Boolean(existing)) };
    });

    fastify.get("/companies/question-bank/sql/dataset", async (request, reply) => {
        const query = datasetQuerySchema.safeParse(request.query);
        if (!query.success) {
            return reply.status(400).send({ error: "Validation Error", details: query.error.flatten().fieldErrors });
        }

        await connectMongoDB();

        const { page, limit, search, difficulty } = query.data;
        const filter: Record<string, any> = {};
        if (difficulty && difficulty !== "Medium") {
            return {
                questions: [],
                pagination: { page, limit, total: 0, totalPages: 0 },
            };
        }
        if (search) filter.$text = { $search: search };

        const skip = (page - 1) * limit;
        const [questions, total, addedQuestions] = await Promise.all([
            SQLQuestion.find(filter)
                .select("title description schema examples testCases hiddenTestCases")
                .sort({ title: 1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            SQLQuestion.countDocuments(filter),
            COMPANY_QUESTION_BANK_MODELS.sql.find({ "company.id": request.companyQuestionOwner!.id })
                .select("sourceQuestionId")
                .lean(),
        ]);

        const addedIds = new Set(
            addedQuestions
                .map((question: any) => question.sourceQuestionId)
                .filter(Boolean)
                .map(String)
        );

        return {
            questions: questions.map((question: any) => sqlDatasetQuestion(question, addedIds)),
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        };
    });

    fastify.get("/companies/question-bank/sql/dataset/:id", async (request, reply) => {
        const params = datasetIdParamsSchema.safeParse(request.params);
        if (!params.success) {
            return reply.status(400).send({ error: "Validation Error", details: params.error.flatten().fieldErrors });
        }

        await connectMongoDB();

        const [question, existing] = await Promise.all([
            SQLQuestion.findById(params.data.id)
                .select("title description schema examples testCases wrapperCode solution judge0LanguageId hiddenTestCases")
                .lean(),
            COMPANY_QUESTION_BANK_MODELS.sql.findOne({
                "company.id": request.companyQuestionOwner!.id,
                sourceQuestionId: params.data.id,
            }).select("_id").lean(),
        ]);

        if (!question) {
            return reply.status(404).send({ error: "Not Found", message: "Dataset question not found." });
        }

        return { question: sqlDatasetQuestionDetail(question, Boolean(existing)) };
    });

    fastify.get("/companies/question-bank/cs-fundamentals/dataset", async (request, reply) => {
        const query = datasetQuerySchema.safeParse(request.query);
        if (!query.success) {
            return reply.status(400).send({ error: "Validation Error", details: query.error.flatten().fieldErrors });
        }

        await connectMongoDB();

        const { page, limit, search, topic } = query.data;
        const filter: Record<string, any> = {};
        if (topic) filter.topic = topic;
        if (search) filter.$text = { $search: search };

        const skip = (page - 1) * limit;
        const [questions, total, addedQuestions] = await Promise.all([
            CSFundamentalQuestion.find(filter)
                .select("topic question answer detailedAnswer")
                .sort({ topic: 1, question: 1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            CSFundamentalQuestion.countDocuments(filter),
            CompanyCSFundamentalQuestion.find({ "company.id": request.companyQuestionOwner!.id })
                .select("sourceQuestionId")
                .lean(),
        ]);

        const addedIds = new Set(
            addedQuestions
                .map((question: any) => question.sourceQuestionId)
                .filter(Boolean)
                .map(String)
        );

        return {
            questions: questions.map((question: any) => csDatasetQuestion(question, addedIds)),
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        };
    });

    fastify.get("/companies/question-bank/cs-fundamentals/dataset/:id", async (request, reply) => {
        const params = datasetIdParamsSchema.safeParse(request.params);
        if (!params.success) {
            return reply.status(400).send({ error: "Validation Error", details: params.error.flatten().fieldErrors });
        }

        await connectMongoDB();

        const [question, existing] = await Promise.all([
            CSFundamentalQuestion.findById(params.data.id)
                .select("topic question answer detailedAnswer")
                .lean(),
            CompanyCSFundamentalQuestion.findOne({
                "company.id": request.companyQuestionOwner!.id,
                sourceQuestionId: params.data.id,
            }).select("_id").lean(),
        ]);

        if (!question) {
            return reply.status(404).send({ error: "Not Found", message: "Dataset question not found." });
        }

        return { question: csDatasetQuestionDetail(question, Boolean(existing)) };
    });

    fastify.get("/companies/question-bank/system-design/dataset", async (request, reply) => {
        const query = datasetQuerySchema.safeParse(request.query);
        if (!query.success) {
            return reply.status(400).send({ error: "Validation Error", details: query.error.flatten().fieldErrors });
        }

        await connectMongoDB();

        const { page, limit, search, difficulty } = query.data;
        const filter: Record<string, any> = {};
        if (difficulty) filter.difficulty = difficulty;
        if (search) {
            filter.$or = [
                { title: { $regex: search, $options: "i" } },
                { problemStatement: { $regex: search, $options: "i" } },
            ];
        }

        const skip = (page - 1) * limit;
        const [questions, total, addedQuestions] = await Promise.all([
            SystemDesignQuestion.find(filter)
                .select("slug title difficulty problemStatement rubricLite rubricFull hints followUpQuestions architectureDiagram sampleDiagramUrl")
                .sort({ difficulty: 1, title: 1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            SystemDesignQuestion.countDocuments(filter),
            CompanySystemDesignQuestion.find({ "company.id": request.companyQuestionOwner!.id })
                .select("sourceQuestionId")
                .lean(),
        ]);

        const addedIds = new Set(
            addedQuestions
                .map((question: any) => question.sourceQuestionId)
                .filter(Boolean)
                .map(String)
        );

        return {
            questions: questions.map((question: any) => systemDesignDatasetQuestion(question, addedIds)),
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        };
    });

    fastify.get("/companies/question-bank/system-design/dataset/:id", async (request, reply) => {
        const params = datasetIdParamsSchema.safeParse(request.params);
        if (!params.success) {
            return reply.status(400).send({ error: "Validation Error", details: params.error.flatten().fieldErrors });
        }

        await connectMongoDB();

        const [question, existing] = await Promise.all([
            SystemDesignQuestion.findById(params.data.id)
                .select("slug title difficulty problemStatement rubricLite rubricFull hints followUpQuestions architectureDiagram sampleDiagramUrl")
                .lean(),
            CompanySystemDesignQuestion.findOne({
                "company.id": request.companyQuestionOwner!.id,
                sourceQuestionId: params.data.id,
            }).select("_id").lean(),
        ]);

        if (!question) {
            return reply.status(404).send({ error: "Not Found", message: "Dataset question not found." });
        }

        return { question: systemDesignDatasetQuestionDetail(question, Boolean(existing)) };
    });

    fastify.post("/companies/question-bank/dsa/import", async (request, reply) => {
        const parsed = importDSAQuestionsSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({ error: "Validation Error", details: parsed.error.flatten().fieldErrors });
        }

        const companyId = request.companyQuestionOwner!.id;
        const rl = checkRateLimit(`companies:question-bank:dsa-import:${companyId}`, 20, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Dataset import limit reached. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        await connectMongoDB();

        const uniqueIds = Array.from(new Set(parsed.data.questionIds));
        const sourceQuestions = await DSAQuestion.find({ _id: { $in: uniqueIds } });
        const foundIds = new Set(sourceQuestions.map((question: any) => String(question._id)));
        const missingIds = uniqueIds.filter((id) => !foundIds.has(id));

        const sourceProblemIds = sourceQuestions.map((question: any) => question.problemId).filter(Boolean);
        const sourceProblemSlugs = sourceQuestions.map((question: any) => question.problemSlug).filter(Boolean);
        const existing = await CompanyDSAQuestion.find({
            "company.id": companyId,
            $or: [
                { sourceQuestionId: { $in: uniqueIds } },
                { problemId: { $in: sourceProblemIds } },
                { problemSlug: { $in: sourceProblemSlugs } },
            ],
        }).select("sourceQuestionId problemId problemSlug").lean();
        const existingSourceIds = new Set(existing.map((question: any) => String(question.sourceQuestionId)).filter(Boolean));
        const existingProblemIds = new Set(existing.map((question: any) => String(question.problemId)).filter(Boolean));
        const existingProblemSlugs = new Set(existing.map((question: any) => String(question.problemSlug)).filter(Boolean));

        const docs = sourceQuestions
            .filter((source: any) => (
                !existingSourceIds.has(String(source._id)) &&
                !existingProblemIds.has(String(source.problemId)) &&
                !existingProblemSlugs.has(String(source.problemSlug))
            ))
            .map((source: any) => {
                const doc = normalizePlainDoc(source);
                const sourceId = String(doc._id);
                delete doc._id;
                delete doc.__v;
                return {
                    ...doc,
                    company: request.companyQuestionOwner,
                    sourceQuestionId: sourceId,
                    sourceCollection: "mockr_questions.dsa_questions",
                    status: "published",
                };
            });

        let imported = 0;
        if (docs.length) {
            const result = await CompanyDSAQuestion.insertMany(docs, { ordered: false });
            imported = result.length;
        }

        return {
            imported,
            skipped: existing.length,
            missing: missingIds.length,
        };
    });

    fastify.post("/companies/question-bank/sql/import", async (request, reply) => {
        const parsed = importSQLQuestionsSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({ error: "Validation Error", details: parsed.error.flatten().fieldErrors });
        }

        const companyId = request.companyQuestionOwner!.id;
        const rl = checkRateLimit(`companies:question-bank:sql-import:${companyId}`, 20, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Dataset import limit reached. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        try {
            await connectMongoDB();

            const uniqueIds = Array.from(new Set(parsed.data.questionIds));
            const sourceQuestions = await SQLQuestion.find({ _id: { $in: uniqueIds } });
            const foundIds = new Set(sourceQuestions.map((question: any) => String(question._id)));
            const missingIds = uniqueIds.filter((id) => !foundIds.has(id));
            const sourceTitles = sourceQuestions.map((question: any) => question.title).filter(Boolean);

            const existing = await COMPANY_QUESTION_BANK_MODELS.sql.find({
                "company.id": companyId,
                $or: [
                    { sourceQuestionId: { $in: uniqueIds } },
                    { title: { $in: sourceTitles } },
                ],
            }).select("sourceQuestionId title").lean();
            const existingSourceIds = new Set(existing.map((question: any) => String(question.sourceQuestionId)).filter(Boolean));
            const existingTitles = new Set(existing.map((question: any) => String(question.title)).filter(Boolean));

            let imported = 0;
            let skipped = existing.length;
            for (const source of sourceQuestions) {
                if (existingSourceIds.has(String(source._id)) || existingTitles.has(String(source.title))) continue;

                const doc = normalizePlainDoc(source);
                const sourceId = String(doc._id);
                const schema = doc.schema || sqlSchemaText(doc.description);
                const wrapperCode = doc.wrapperCode || doc.wrapper_code || schema || "-- SQL setup was not provided in the source question.";
                const solution = hasCompletedValue(doc.solution)
                    ? doc.solution
                    : "-- Solution was not provided in the source question.";
                const testCases = normalizeSQLTestCases(doc.testCases);
                const hiddenTestCases = normalizeSQLHiddenTestCases(
                    doc.hiddenTestCases,
                    wrapperCode,
                    testCases[0]?.expected_output
                );
                delete doc._id;
                delete doc.__v;

                try {
                    const now = new Date();
                    await CompanySQLQuestion.collection.insertOne({
                        ...doc,
                        schema,
                        testCases,
                        hiddenTestCases,
                        wrapperCode,
                        solution,
                        judge0LanguageId: Number(doc.judge0LanguageId) || 82,
                        difficulty: "Medium",
                        tags: Array.isArray(doc.tags) && doc.tags.length ? doc.tags : ["SQL"],
                        company: request.companyQuestionOwner,
                        sourceQuestionId: sourceId,
                        sourceCollection: "mockr_questions.sql_questions",
                        status: "published",
                        createdAt: now,
                        updatedAt: now,
                    });
                    imported += 1;
                    existingSourceIds.add(sourceId);
                    existingTitles.add(String(doc.title));
                } catch (err: any) {
                    if (err?.code === 11000) {
                        skipped += 1;
                        existingSourceIds.add(sourceId);
                        existingTitles.add(String(doc.title));
                        continue;
                    }
                    return writeErrorReply(reply, err);
                }
            }

            return {
                imported,
                skipped,
                missing: missingIds.length,
            };
        } catch (err: any) {
            return reply.status(400).send({
                error: "SQL Import Failed",
                message: err?.message || "Could not import this SQL question.",
            });
        }
    });

    fastify.post("/companies/question-bank/cs-fundamentals/import", async (request, reply) => {
        const parsed = importCSFundamentalsQuestionsSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({ error: "Validation Error", details: parsed.error.flatten().fieldErrors });
        }

        const companyId = request.companyQuestionOwner!.id;
        const rl = checkRateLimit(`companies:question-bank:cs-fundamentals-import:${companyId}`, 20, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Dataset import limit reached. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        await connectMongoDB();

        const uniqueIds = Array.from(new Set(parsed.data.questionIds));
        const sourceQuestions = await CSFundamentalQuestion.find({ _id: { $in: uniqueIds } });
        const foundIds = new Set(sourceQuestions.map((question: any) => String(question._id)));
        const missingIds = uniqueIds.filter((id) => !foundIds.has(id));
        const sourceQuestionsText = sourceQuestions.map((question: any) => question.question).filter(Boolean);

        const existing = await CompanyCSFundamentalQuestion.find({
            "company.id": companyId,
            $or: [
                { sourceQuestionId: { $in: uniqueIds } },
                { question: { $in: sourceQuestionsText } },
            ],
        }).select("sourceQuestionId question").lean();
        const existingSourceIds = new Set(existing.map((question: any) => String(question.sourceQuestionId)).filter(Boolean));
        const existingQuestions = new Set(existing.map((question: any) => String(question.question)).filter(Boolean));

        const docs = sourceQuestions
            .filter((source: any) => (
                !existingSourceIds.has(String(source._id)) &&
                !existingQuestions.has(String(source.question))
            ))
            .map((source: any) => {
                const doc = normalizePlainDoc(source);
                const sourceId = String(doc._id);
                delete doc._id;
                delete doc.__v;
                return {
                    ...doc,
                    answer: cleanTheoryText(doc.answer),
                    detailedAnswer: cleanTheoryText(doc.detailedAnswer),
                    difficulty: "Medium",
                    tags: [doc.topic].filter(Boolean),
                    company: request.companyQuestionOwner,
                    sourceQuestionId: sourceId,
                    sourceCollection: "mockr_questions.cs_fundamental_questions",
                    status: "published",
                };
            });

        let imported = 0;
        if (docs.length) {
            const result = await CompanyCSFundamentalQuestion.insertMany(docs, { ordered: false });
            imported = result.length;
        }

        return {
            imported,
            skipped: existing.length,
            missing: missingIds.length,
        };
    });

    fastify.post("/companies/question-bank/system-design/import", async (request, reply) => {
        const parsed = importSystemDesignQuestionsSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({ error: "Validation Error", details: parsed.error.flatten().fieldErrors });
        }

        const companyId = request.companyQuestionOwner!.id;
        const rl = checkRateLimit(`companies:question-bank:system-design-import:${companyId}`, 20, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Dataset import limit reached. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        await connectMongoDB();

        const uniqueIds = Array.from(new Set(parsed.data.questionIds));
        const sourceQuestions = await SystemDesignQuestion.find({ _id: { $in: uniqueIds } });
        const foundIds = new Set(sourceQuestions.map((question: any) => String(question._id)));
        const missingIds = uniqueIds.filter((id) => !foundIds.has(id));
        const sourceSlugs = sourceQuestions.map((question: any) => question.slug).filter(Boolean);

        const existing = await CompanySystemDesignQuestion.find({
            "company.id": companyId,
            $or: [
                { sourceQuestionId: { $in: uniqueIds } },
                { slug: { $in: sourceSlugs } },
            ],
        }).select("sourceQuestionId slug").lean();
        const existingSourceIds = new Set(existing.map((question: any) => String(question.sourceQuestionId)).filter(Boolean));
        const existingSlugs = new Set(existing.map((question: any) => String(question.slug)).filter(Boolean));

        const docs = sourceQuestions
            .filter((source: any) => (
                !existingSourceIds.has(String(source._id)) &&
                !existingSlugs.has(String(source.slug))
            ))
            .map((source: any) => {
                const doc = normalizePlainDoc(source);
                const sourceId = String(doc._id);
                delete doc._id;
                delete doc.__v;
                return {
                    ...doc,
                    tags: Array.isArray(doc.tags) && doc.tags.length ? doc.tags : ["System Design"],
                    referenceDiagram: doc.referenceDiagram || (doc.sampleDiagramUrl ? { url: doc.sampleDiagramUrl, source: "url" } : null),
                    company: request.companyQuestionOwner,
                    sourceQuestionId: sourceId,
                    sourceCollection: "mockr_questions.system_design_questions",
                    status: "published",
                };
            });

        let imported = 0;
        if (docs.length) {
            const result = await CompanySystemDesignQuestion.insertMany(docs, { ordered: false });
            imported = result.length;
        }

        return {
            imported,
            skipped: existing.length,
            missing: missingIds.length,
        };
    });

    fastify.get("/companies/question-bank/question-sets", async (request) => {
        await connectMongoDB();

        const sets = await CompanyQuestionSet.find({
            ...ownershipFilter(request),
            status: { $ne: "archived" },
        }).sort({ updatedAt: -1 }).lean();

        return { questionSets: sets.map(publicQuestionSet) };
    });

    fastify.get("/companies/question-bank/question-sets/:id", async (request, reply) => {
        const params = questionSetIdParamsSchema.safeParse(request.params);
        if (!params.success) {
            return reply.status(400).send({ error: "Validation Error", details: params.error.flatten().fieldErrors });
        }

        await connectMongoDB();

        const questionSet = await CompanyQuestionSet.findOne({
            ...ownershipFilter(request),
            _id: params.data.id,
        }).lean();

        if (!questionSet) {
            return reply.status(404).send({ error: "Not Found", message: "Question set not found." });
        }

        return { questionSet: publicQuestionSet(questionSet) };
    });

    fastify.post("/companies/question-bank/question-sets", async (request, reply) => {
        const parsed = questionSetBodySchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({ error: "Validation Error", details: parsed.error.flatten().fieldErrors });
        }

        const companyId = request.companyQuestionOwner!.id;
        const rl = checkRateLimit(`companies:question-bank:question-set-create:${companyId}`, 60, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Question set creation limit reached. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        await connectMongoDB();

        const resolved = await resolveQuestionSetItems(request, parsed.data.items);
        if ("error" in resolved) {
            return reply.status(400).send({ error: "Validation Error", message: resolved.error });
        }

        try {
            const questionSet = await CompanyQuestionSet.create({
                company: request.companyQuestionOwner,
                title: parsed.data.title,
                description: parsed.data.description,
                status: parsed.data.status,
                items: resolved.items,
            });

            return reply.status(201).send({ questionSet: publicQuestionSet(questionSet) });
        } catch (err) {
            return writeErrorReply(reply, err);
        }
    });

    fastify.put("/companies/question-bank/question-sets/:id", async (request, reply) => {
        const params = questionSetIdParamsSchema.safeParse(request.params);
        const parsed = questionSetBodySchema.partial().safeParse(request.body);
        if (!params.success || !parsed.success) {
            return reply.status(400).send({
                error: "Validation Error",
                details: params.success ? parsed.error.flatten().fieldErrors : params.error.flatten().fieldErrors,
            });
        }

        const companyId = request.companyQuestionOwner!.id;
        const rl = checkRateLimit(`companies:question-bank:question-set-update:${companyId}`, 120, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Question set update limit reached. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        await connectMongoDB();

        const updateData: Record<string, any> = {};
        if (parsed.data.title !== undefined) updateData.title = parsed.data.title;
        if (parsed.data.description !== undefined) updateData.description = parsed.data.description;
        if (parsed.data.status !== undefined) updateData.status = parsed.data.status;
        if (parsed.data.items !== undefined) {
            const resolved = await resolveQuestionSetItems(request, parsed.data.items);
            if ("error" in resolved) {
                return reply.status(400).send({ error: "Validation Error", message: resolved.error });
            }
            updateData.items = resolved.items;
        }

        try {
            const questionSet = await CompanyQuestionSet.findOneAndUpdate(
                { ...ownershipFilter(request), _id: params.data.id },
                { $set: updateData },
                { new: true, runValidators: true }
            ).lean();

            if (!questionSet) {
                return reply.status(404).send({ error: "Not Found", message: "Question set not found." });
            }

            return { questionSet: publicQuestionSet(questionSet) };
        } catch (err) {
            return writeErrorReply(reply, err);
        }
    });

    fastify.delete("/companies/question-bank/question-sets/:id", async (request, reply) => {
        const params = questionSetIdParamsSchema.safeParse(request.params);
        if (!params.success) {
            return reply.status(400).send({ error: "Validation Error", details: params.error.flatten().fieldErrors });
        }

        const companyId = request.companyQuestionOwner!.id;
        const rl = checkRateLimit(`companies:question-bank:question-set-delete:${companyId}`, 60, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Question set delete limit reached. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        await connectMongoDB();

        const deleted = await CompanyQuestionSet.findOneAndUpdate(
            { ...ownershipFilter(request), _id: params.data.id },
            { $set: { status: "archived" } },
            { new: true }
        ).lean();

        if (!deleted) {
            return reply.status(404).send({ error: "Not Found", message: "Question set not found." });
        }

        return reply.status(204).send();
    });

    fastify.post("/companies/question-bank/:type/:id/run-preview", async (request, reply) => {
        const params = runPreviewParamsSchema.safeParse(request.params);
        const body = runPreviewBodySchema.safeParse(request.body);

        if (!params.success || !body.success) {
            return reply.status(400).send({
                error: "Validation Error",
                details: {
                    ...(params.success ? {} : params.error.flatten().fieldErrors),
                    ...(body.success ? {} : body.error.flatten().fieldErrors),
                },
            });
        }

        const companyId = request.companyQuestionOwner!.id;
        const rl = checkRateLimit(`companies:question-bank:run-preview:${companyId}`, 80, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Preview execution limit reached. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        await connectMongoDB();

        const type = normalizeRouteType(params.data.type);
        const { code, language, language_id: languageId, mode } = body.data;

        if (type === "dsa") {
            try {
                return await runCodeForCompanyDSAQuestion({
                    questionId: params.data.id,
                    companyId,
                    sourceCode: code,
                    language,
                    languageId,
                    mode,
                });
            } catch (err: any) {
                if (String(err?.message || "").startsWith("Company question not found:")) {
                    return await runCodeForQuestion({
                        questionId: params.data.id,
                        sourceCode: code,
                        language,
                        languageId,
                        mode,
                    });
                }

                request.log.error({ err: err.message, questionId: params.data.id }, "[CompanyQuestionBank] DSA preview run failed");
                return reply.status(500).send({
                    success: false,
                    error: err.message || "Code execution failed.",
                });
            }
        }

        if (type === "sql") {
            const question = await CompanySQLQuestion.findOne({
                ...ownershipFilter(request),
                _id: params.data.id,
            }).select("+hiddenTestCases +solution").lean();

            if (!question) {
                return reply.status(404).send({ success: false, error: "SQL question not found." });
            }

            const visibleCases = Array.isArray(question.testCases) ? question.testCases : [];
            const hiddenCases = Array.isArray(question.hiddenTestCases) ? question.hiddenTestCases : [];
            const sourceCases = mode === "submit" && hiddenCases.length > 0 ? hiddenCases : visibleCases.length > 0 ? visibleCases : hiddenCases;
            const solutionCode =
                typeof question.solution === "string"
                    ? question.solution
                    : typeof (question.solution as any)?.query === "string"
                        ? (question.solution as any).query
                        : "";

            const asExpectedText = (value: any) =>
                typeof value === "string" ? value : JSON.stringify(value ?? "");

            const batchTestCases = [];
            for (const [index, testCase] of sourceCases.entries()) {
                const wrapperCode = testCase?.wrapper_code || testCase?.wrapperCode || question.wrapperCode;
                if (!wrapperCode) continue;

                const testId = String(testCase?.id ?? `test_${index + 1}`);
                const cacheKey = `company:${companyId}:${params.data.id}:${testId}:${mode}`;
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
                return reply.status(422).send({
                    success: false,
                    error: "No executable SQL test cases found for this question.",
                });
            }

            const results = await runBatchSqlQueries(batchTestCases, code);
            const allPassed = results.every((result) => result.passed);

            return {
                success: true,
                passed: allPassed,
                results,
            };
        }

        return reply.status(400).send({
            success: false,
            error: "Preview execution is available only for DSA and SQL questions.",
        });
    });

    fastify.get("/companies/question-bank/:type", async (request, reply) => {
        const params = z.object({ type: routeTypeSchema }).safeParse(request.params);
        const query = querySchema.safeParse(request.query);

        if (!params.success || !query.success) {
            return reply.status(400).send({
                error: "Validation Error",
                details: {
                    ...(params.success ? {} : params.error.flatten().fieldErrors),
                    ...(query.success ? {} : query.error.flatten().fieldErrors),
                },
            });
        }

        await connectMongoDB();

        const type = normalizeRouteType(params.data.type);
        const Model = modelForType(type);
        const { page, limit, search, difficulty, status, topic } = query.data;
        const filter: Record<string, any> = ownershipFilter(request);

        if (difficulty) filter.difficulty = difficulty;
        if (status) filter.status = status;
        if (topic) {
            if (type === "cs_fundamentals") filter.topic = topic;
            else if (type === "dsa") filter.topics = topic;
            else filter.tags = topic;
        }
        if (search) filter.$text = { $search: search };

        const skip = (page - 1) * limit;
        const questionsQuery = Model.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit);
        if (type === "cs_fundamentals") {
            questionsQuery.select("+answer");
        }
        const [questions, total] = await Promise.all([
            questionsQuery.lean(),
            Model.countDocuments(filter),
        ]);

        return {
            questions: questions.map(publicQuestion),
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        };
    });

    fastify.get("/companies/question-bank/:type/:id", async (request, reply) => {
        const params = idParamsSchema.safeParse(request.params);
        if (!params.success) {
            return reply.status(400).send({ error: "Validation Error", details: params.error.flatten().fieldErrors });
        }

        await connectMongoDB();

        const type = normalizeRouteType(params.data.type);
        const Model = modelForType(type);
        const question = await Model.findOne({
            ...ownershipFilter(request),
            _id: params.data.id,
        }).select(detailProjection(type)).lean();

        if (!question) {
            return reply.status(404).send({ error: "Not Found", message: "Question not found." });
        }

        return { question: publicQuestion(question) };
    });

    fastify.post("/companies/question-bank/:type", async (request, reply) => {
        const params = z.object({ type: routeTypeSchema }).safeParse(request.params);
        if (!params.success) {
            return reply.status(400).send({ error: "Validation Error", details: params.error.flatten().fieldErrors });
        }

        const type = normalizeRouteType(params.data.type);
        const parsed = schemaForType(type).safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({ error: "Validation Error", details: parsed.error.flatten().fieldErrors });
        }

        const companyId = request.companyQuestionOwner!.id;
        const rl = checkRateLimit(`companies:question-bank:create:${companyId}`, 60, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Question creation limit reached. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        await connectMongoDB();

        const Model = modelForType(type);
        let question;
        try {
            if (type === "sql") {
                const now = new Date();
                const doc = {
                    ...parsed.data,
                    company: request.companyQuestionOwner,
                    createdAt: now,
                    updatedAt: now,
                };
                const result = await CompanySQLQuestion.collection.insertOne(doc);
                question = { ...doc, _id: result.insertedId };
            } else {
                question = await Model.create({
                    ...parsed.data,
                    company: request.companyQuestionOwner,
                });
            }
        } catch (err) {
            return writeErrorReply(reply, err);
        }

        return reply.status(201).send({ question: publicQuestion(question) });
    });

    fastify.put("/companies/question-bank/:type/:id", async (request, reply) => {
        const params = idParamsSchema.safeParse(request.params);
        if (!params.success) {
            return reply.status(400).send({ error: "Validation Error", details: params.error.flatten().fieldErrors });
        }

        const type = normalizeRouteType(params.data.type);
        const parsed = schemaForType(type).partial().safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({ error: "Validation Error", details: parsed.error.flatten().fieldErrors });
        }

        const companyId = request.companyQuestionOwner!.id;
        const rl = checkRateLimit(`companies:question-bank:update:${companyId}`, 120, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Question update limit reached. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        await connectMongoDB();

        const Model = modelForType(type);
        let question;
        try {
            question = await Model.findOneAndUpdate(
                {
                    ...ownershipFilter(request),
                    _id: params.data.id,
                },
                { $set: parsed.data },
                { new: true, runValidators: true }
            ).lean();
        } catch (err) {
            return writeErrorReply(reply, err);
        }

        if (!question) {
            return reply.status(404).send({ error: "Not Found", message: "Question not found." });
        }

        return { question: publicQuestion(question) };
    });

    fastify.delete("/companies/question-bank/:type/:id", async (request, reply) => {
        const params = idParamsSchema.safeParse(request.params);
        if (!params.success) {
            return reply.status(400).send({ error: "Validation Error", details: params.error.flatten().fieldErrors });
        }

        const companyId = request.companyQuestionOwner!.id;
        const rl = checkRateLimit(`companies:question-bank:delete:${companyId}`, 60, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Question delete limit reached. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        await connectMongoDB();

        const Model = modelForType(normalizeRouteType(params.data.type));
        const deleted = await Model.findOneAndDelete({
            ...ownershipFilter(request),
            _id: params.data.id,
        }).lean();

        if (!deleted) {
            return reply.status(404).send({ error: "Not Found", message: "Question not found." });
        }

        return reply.status(204).send();
    });
}
