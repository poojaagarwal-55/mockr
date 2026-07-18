import mongoose, { Schema, Document } from "mongoose";

// ── Sub-schemas ──────────────────────────────────────────────

const ExampleSchema = new Schema(
    {
        example_num: { type: Number },
        example_text: { type: String },
    },
    { _id: false }
);

const TestCaseSchema = new Schema(
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

// ── Solution sub-schema (brute force + optimized — added later) ──

const SolutionApproachSchema = new Schema(
    {
        explanation: { type: String },
        timeComplexity: { type: String },
        spaceComplexity: { type: String },
        code: { type: Map, of: String, default: new Map() }, // language → code
    },
    { _id: false }
);

// ── Main interface ───────────────────────────────────────────

export interface IDSAQuestion extends Document {
    title: string;
    problemId: string;
    frontendId: string;
    difficulty: "Easy" | "Medium" | "Hard";
    problemSlug: string;
    timeLimit?: number;
    memoryLimit?: number;
    topics: string[];
    companyTags: string[];
    description: string;
    examples: { example_num: number; example_text: string }[];
    constraints: string[];
    sampleTestCases: {
        id: string;
        description: string;
        input: any;
        output: any;
    }[];
    hiddenTestCases: {
        id: string;
        description: string;
        input: any;
        output: any;
    }[];
    codeSnippets: Map<
        string,
        { starter_code: string; wrapper_code: string }
    >;
    solution?: {
        bruteForce?: {
            explanation?: string;
            timeComplexity?: string;
            spaceComplexity?: string;
            code?: Map<string, string>;
        };
        optimized?: {
            explanation?: string;
            timeComplexity?: string;
            spaceComplexity?: string;
            code?: Map<string, string>;
        };
    };
    followUp: string[];
    hints: string[];
    usedInContests?: string[];
    isUsedInContest?: boolean;
    currentlyChoosedForContest?: boolean;
    // Special judge / custom checker. "custom" validates output via checkerCode
    // (for problems with multiple valid outputs) instead of exact match.
    judgeType?: "default" | "custom";
    checkerLanguage?: string | null;
    checkerCode?: string | null;
}

// ── Schema ───────────────────────────────────────────────────

const DSAQuestionSchema = new Schema<IDSAQuestion>(
    {
        title: { type: String, required: true },
        problemId: { type: String, required: true, unique: true },
        frontendId: { type: String },
        difficulty: {
            type: String,
            required: true,
            enum: ["Easy", "Medium", "Hard"],
            index: true,
        },
        problemSlug: { type: String, required: true, index: true },
        timeLimit: { type: Number, default: 2, min: 0.1, max: 5 },
        memoryLimit: { type: Number, default: 256, min: 16, max: 256 },
        topics: { type: [String], default: [] },
        companyTags: { type: [String], default: [] },
        description: { type: String, required: true },
        examples: { type: [ExampleSchema], default: [] },
        constraints: { type: [String], default: [] },
        sampleTestCases: { type: [TestCaseSchema], default: [] },
        hiddenTestCases: { type: [TestCaseSchema], default: [] },
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
                },
                { _id: false }
            ),
            required: false,
        },
        followUp: { type: [String], default: [] },
        hints: { type: [String], default: [] },
        usedInContests: { type: [String], default: [], index: true },
        isUsedInContest: { type: Boolean, default: false, index: true },
        currentlyChoosedForContest: { type: Boolean, default: false, index: true },
        judgeType: { type: String, enum: ["default", "custom"], default: "default" },
        checkerLanguage: { type: String, default: null },
        checkerCode: { type: String, default: null },
    },
    {
        timestamps: true,
        collection: "dsa_questions",
    }
);

// Text index for search
DSAQuestionSchema.index({ title: "text", description: "text" });
DSAQuestionSchema.index(
    { frontendId: 1 },
    {
        name: "dsa_questions_frontendId_numeric_idx",
        collation: { locale: "en", numericOrdering: true },
    }
);
DSAQuestionSchema.index(
    { currentlyChoosedForContest: 1, frontendId: 1, _id: 1 },
    { name: "dsa_practice_catalog_sort_idx" }
);
DSAQuestionSchema.index(
    { currentlyChoosedForContest: 1, difficulty: 1, frontendId: 1, _id: 1 },
    { name: "dsa_practice_catalog_difficulty_sort_idx" }
);
DSAQuestionSchema.index(
    { currentlyChoosedForContest: 1, topics: 1, frontendId: 1, _id: 1 },
    { name: "dsa_practice_catalog_topics_sort_idx" }
);

export function buildDSAAvailableForPracticeFilter(): Record<string, any> {
    return {
        $and: [
            {
                $or: [
                    { currentlyChoosedForContest: { $exists: false } },
                    { currentlyChoosedForContest: false },
                ],
            },
        ],
    };
}

export function isDSAQuestionChoosedForContest(doc: Partial<IDSAQuestion> | null | undefined): boolean {
    if (!doc) return false;
    return Boolean((doc as any).currentlyChoosedForContest);
}

export const DSAQuestion = mongoose.model<IDSAQuestion>(
    "DSAQuestion",
    DSAQuestionSchema
);

export const ContestDSAQuestion =
    (mongoose.models.ContestDSAQuestion as mongoose.Model<IDSAQuestion> | undefined) ||
    mongoose.model<IDSAQuestion>(
        "ContestDSAQuestion",
        DSAQuestionSchema,
        "contest_questions"
    );
