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
    },
    {
        timestamps: true,
        collection: "dsa_questions",
    }
);

// Text index for search
DSAQuestionSchema.index({ title: "text", description: "text" });

export const DSAQuestion = mongoose.model<IDSAQuestion>(
    "DSAQuestion",
    DSAQuestionSchema
);
