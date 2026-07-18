// ============================================
// Mongoose Models: Company Question Bank
// ============================================
// Mirrors the platform question collections in the separate company_questions
// database, with an ownership block on every document.

import mongoose, { Schema } from "mongoose";

export const COMPANY_QUESTIONS_DB_NAME =
    process.env.COMPANY_QUESTIONS_MONGODB_DB || "company_questions";

export interface CompanyQuestionOwner {
    id: string;
    email: string;
    domain: string;
    name: string;
}

export const COMPANY_QUESTION_BANK_TYPES = ["dsa", "sql", "system_design", "cs_fundamentals"] as const;
export type CompanyQuestionBankType = typeof COMPANY_QUESTION_BANK_TYPES[number];

export interface CompanyQuestionSetItem {
    type: CompanyQuestionBankType;
    questionId: string;
    title: string;
    difficulty?: string | null;
    orderIndex: number;
}

const CompanyOwnerSchema = new Schema<CompanyQuestionOwner>(
    {
        id: { type: String, required: true, index: true },
        email: { type: String, required: true },
        domain: { type: String, required: true, index: true },
        name: { type: String, required: true },
    },
    { _id: false }
);

const CompanyQuestionSetItemSchema = new Schema<CompanyQuestionSetItem>(
    {
        type: {
            type: String,
            required: true,
            enum: COMPANY_QUESTION_BANK_TYPES,
            index: true,
        },
        questionId: { type: String, required: true },
        title: { type: String, required: true },
        difficulty: { type: String, default: null },
        orderIndex: { type: Number, required: true, default: 0 },
    },
    { _id: false }
);

const CompanyQuestionSetSchema = new Schema(
    {
        company: { type: CompanyOwnerSchema, required: true },
        title: { type: String, required: true, trim: true },
        description: { type: String, default: "", trim: true },
        status: {
            type: String,
            enum: ["draft", "active", "archived"],
            default: "active",
            index: true,
        },
        items: { type: [CompanyQuestionSetItemSchema], default: [] },
    },
    {
        timestamps: true,
        collection: "question_sets",
    }
);

const ExampleSchema = new Schema(
    {
        example_num: { type: Number },
        example_text: { type: String },
    },
    { _id: false }
);

const DSATestCaseSchema = new Schema(
    {
        id: { type: String, required: true },
        description: { type: String },
        input: { type: Schema.Types.Mixed, required: true },
        output: { type: Schema.Types.Mixed, required: true },
    },
    { _id: false }
);

const CodeSnippetSchema = new Schema(
    {
        starter_code: { type: String, required: true },
        wrapper_code: { type: String, required: true },
    },
    { _id: false }
);

const SolutionApproachSchema = new Schema(
    {
        title: { type: String },
        explanation: { type: String },
        timeComplexity: { type: String },
        spaceComplexity: { type: String },
        code: { type: Map, of: String, default: new Map() },
    },
    { _id: false }
);

const CompanyDSAQuestionSchema = new Schema(
    {
        company: { type: CompanyOwnerSchema, required: true },
        title: { type: String, required: true },
        problemId: { type: String, required: true },
        frontendId: { type: String },
        difficulty: {
            type: String,
            required: true,
            enum: ["Easy", "Medium", "Hard"],
            index: true,
        },
        problemSlug: { type: String, required: true, index: true },
        topics: { type: [String], default: [] },
        companyTags: { type: [String], default: [] },
        description: { type: String, required: true },
        examples: { type: [ExampleSchema], default: [] },
        constraints: { type: [String], default: [] },
        sampleTestCases: { type: [DSATestCaseSchema], default: [] },
        hiddenTestCases: { type: [DSATestCaseSchema], default: [], select: false },
        codeSnippets: {
            type: Map,
            of: CodeSnippetSchema,
            default: new Map(),
        },
        solution: {
            type: new Schema(
                {
                    bruteForce: { type: SolutionApproachSchema },
                    optimized: { type: SolutionApproachSchema },
                    approaches: { type: [SolutionApproachSchema], default: [] },
                },
                { _id: false }
            ),
            required: false,
            select: false,
        },
        followUp: { type: [String], default: [] },
        hints: { type: [String], default: [] },
        sourceQuestionId: { type: String, index: true },
        sourceCollection: { type: String },
        status: {
            type: String,
            enum: ["draft", "published", "archived"],
            default: "draft",
            index: true,
        },
    },
    {
        timestamps: true,
        collection: "dsa_questions",
    }
);

const SQLExampleSchema = new Schema(
    {
        input: { type: Schema.Types.Mixed },
        output: { type: Schema.Types.Mixed },
        explanation: { type: String },
    },
    { _id: false }
);

const SQLTestCaseSchema = new Schema(
    {
        id: { type: Schema.Types.Mixed, required: true },
        label: { type: String },
        input: { type: Schema.Types.Mixed },
        expected_output: { type: Schema.Types.Mixed, required: true },
    },
    { _id: false }
);

const SQLHiddenTestCaseSchema = new Schema(
    {
        id: { type: String, required: true },
        label: { type: String },
        expected_output: { type: Schema.Types.Mixed, required: true },
        wrapper_code: { type: String, required: true },
    },
    { _id: false }
);

const CompanySQLQuestionSchema = new Schema(
    {
        company: { type: CompanyOwnerSchema, required: true },
        title: { type: String, required: true },
        description: { type: String, required: true },
        schema: { type: String },
        examples: { type: [SQLExampleSchema], default: [] },
        testCases: { type: [SQLTestCaseSchema], default: [] },
        wrapperCode: { type: String, required: true },
        solution: { type: Schema.Types.Mixed, required: true, select: false },
        judge0LanguageId: { type: Number, required: true },
        hiddenTestCases: { type: [SQLHiddenTestCaseSchema], default: [], select: false },
        sourceQuestionId: { type: String, index: true },
        sourceCollection: { type: String },
        difficulty: {
            type: String,
            enum: ["Easy", "Medium", "Hard"],
            default: "Medium",
            index: true,
        },
        tags: { type: [String], default: [] },
        status: {
            type: String,
            enum: ["draft", "published", "archived"],
            default: "draft",
            index: true,
        },
    },
    {
        timestamps: true,
        collection: "sql_questions",
    }
);

const CompanySystemDesignQuestionSchema = new Schema(
    {
        company: { type: CompanyOwnerSchema, required: true },
        slug: {
            type: String,
            required: true,
            lowercase: true,
            trim: true,
        },
        title: {
            type: String,
            required: true,
            trim: true,
        },
        difficulty: {
            type: String,
            required: true,
            enum: ["Easy", "Medium", "Hard"],
            index: true,
        },
        problemStatement: {
            type: String,
            required: true,
        },
        rubricLite: {
            type: Schema.Types.Mixed,
            required: true,
        },
        rubricFull: {
            type: Schema.Types.Mixed,
            required: true,
            select: false,
        },
        hints: {
            type: [String],
            default: [],
        },
        followUpQuestions: {
            type: [String],
            default: [],
        },
        architectureDiagram: {
            type: Schema.Types.Mixed,
            default: null,
        },
        sampleDiagramUrl: {
            type: String,
            default: null,
        },
        referenceDiagram: {
            url: {
                type: String,
                default: null,
            },
            source: {
                type: String,
                enum: ["url", "upload"],
            },
            key: String,
            filename: String,
            contentType: String,
            size: Number,
            uploadedAt: Date,
        },
        sourceQuestionId: {
            type: String,
            index: true,
        },
        sourceCollection: {
            type: String,
        },
        tags: { type: [String], default: [] },
        status: {
            type: String,
            enum: ["draft", "published", "archived"],
            default: "draft",
            index: true,
        },
    },
    {
        timestamps: true,
        collection: "system_design_questions",
    }
);

const CompanyCSFundamentalQuestionSchema = new Schema(
    {
        company: { type: CompanyOwnerSchema, required: true },
        topic: {
            type: String,
            required: true,
            enum: ["CN", "DBMS", "OOPS", "OS"],
            index: true,
        },
        question: {
            type: String,
            required: true,
        },
        answer: {
            type: String,
            required: true,
            select: false,
        },
        detailedAnswer: {
            type: String,
            required: false,
            select: false,
        },
        sourceQuestionId: {
            type: String,
            index: true,
        },
        sourceCollection: {
            type: String,
        },
        difficulty: {
            type: String,
            enum: ["Easy", "Medium", "Hard"],
            default: "Medium",
            index: true,
        },
        tags: { type: [String], default: [] },
        status: {
            type: String,
            enum: ["draft", "published", "archived"],
            default: "draft",
            index: true,
        },
    },
    {
        timestamps: true,
        collection: "cs_fundamental_questions",
    }
);

CompanyDSAQuestionSchema.index({ "company.id": 1, status: 1, updatedAt: -1 });
CompanyDSAQuestionSchema.index({ "company.id": 1, difficulty: 1, topics: 1 });
CompanyDSAQuestionSchema.index({ "company.id": 1, problemSlug: 1 }, { unique: true });
CompanyDSAQuestionSchema.index({ "company.id": 1, problemId: 1 }, { unique: true });
CompanyDSAQuestionSchema.index({ "company.id": 1, sourceQuestionId: 1 }, { unique: true, sparse: true });
CompanyDSAQuestionSchema.index({ title: "text", description: "text", topics: "text", companyTags: "text" });

CompanySQLQuestionSchema.index({ "company.id": 1, status: 1, updatedAt: -1 });
CompanySQLQuestionSchema.index({ "company.id": 1, difficulty: 1, tags: 1 });
CompanySQLQuestionSchema.index({ "company.id": 1, title: 1 }, { unique: true });
CompanySQLQuestionSchema.index({ "company.id": 1, sourceQuestionId: 1 }, { unique: true, sparse: true });
CompanySQLQuestionSchema.index({ title: "text", description: "text", schema: "text", tags: "text" });

CompanySystemDesignQuestionSchema.index({ "company.id": 1, status: 1, updatedAt: -1 });
CompanySystemDesignQuestionSchema.index({ "company.id": 1, difficulty: 1, tags: 1 });
CompanySystemDesignQuestionSchema.index({ "company.id": 1, slug: 1 }, { unique: true });
CompanySystemDesignQuestionSchema.index({ "company.id": 1, sourceQuestionId: 1 }, { unique: true, sparse: true });
CompanySystemDesignQuestionSchema.index({ title: "text", problemStatement: "text", tags: "text" });

CompanyCSFundamentalQuestionSchema.index({ "company.id": 1, status: 1, updatedAt: -1 });
CompanyCSFundamentalQuestionSchema.index({ "company.id": 1, topic: 1 });
CompanyCSFundamentalQuestionSchema.index({ "company.id": 1, difficulty: 1, topic: 1 });
CompanyCSFundamentalQuestionSchema.index({ "company.id": 1, topic: 1, question: 1 }, { unique: true });
CompanyCSFundamentalQuestionSchema.index({ "company.id": 1, sourceQuestionId: 1 }, { unique: true, sparse: true });
CompanyCSFundamentalQuestionSchema.index({ question: "text", answer: "text", detailedAnswer: "text", topic: "text", tags: "text" });

CompanyQuestionSetSchema.index({ "company.id": 1, status: 1, updatedAt: -1 });
CompanyQuestionSetSchema.index({ "company.id": 1, title: 1 }, { unique: true });
CompanyQuestionSetSchema.index({ "company.id": 1, "items.type": 1, "items.questionId": 1 });

function getCompanyQuestionsConnection() {
    return mongoose.connection.useDb(COMPANY_QUESTIONS_DB_NAME, { useCache: true });
}

function modelFromCompanyDb<T>(name: string, schema: Schema<T>) {
    const connection = getCompanyQuestionsConnection();
    return connection.models[name] || connection.model<T>(name, schema);
}

export const CompanyDSAQuestion = modelFromCompanyDb("CompanyDSAQuestion", CompanyDSAQuestionSchema);
export const CompanySQLQuestion = modelFromCompanyDb("CompanySQLQuestion", CompanySQLQuestionSchema);
export const CompanySystemDesignQuestion = modelFromCompanyDb("CompanySystemDesignQuestion", CompanySystemDesignQuestionSchema);
export const CompanyCSFundamentalQuestion = modelFromCompanyDb("CompanyCSFundamentalQuestion", CompanyCSFundamentalQuestionSchema);
export const CompanyQuestionSet = modelFromCompanyDb("CompanyQuestionSet", CompanyQuestionSetSchema);

export const COMPANY_QUESTION_BANK_MODELS = {
    dsa: CompanyDSAQuestion,
    sql: CompanySQLQuestion,
    system_design: CompanySystemDesignQuestion,
    cs_fundamentals: CompanyCSFundamentalQuestion,
} as const;
