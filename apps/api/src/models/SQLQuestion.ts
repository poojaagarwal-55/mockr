import mongoose, { Schema } from "mongoose";

// ── Sub-schemas ──────────────────────────────────────────────

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

// ── Main interface ───────────────────────────────────────────

export interface ISQLQuestion {
    title: string;
    description: string;
    schema?: string;
    examples: {
        input: any;
        output: any;
        explanation: string;
    }[];
    testCases: {
        id: number | string;
        label: string;
        input: any;
        expected_output: any;
    }[];
    wrapperCode: string;
    solution: any; // Can be a string or an object with multiple solution methods
    judge0LanguageId: number;
    hiddenTestCases: {
        id: string;
        label: string;
        expected_output: any;
        wrapper_code: string;
    }[];
}

// ── Schema ───────────────────────────────────────────────────

const SQLQuestionSchema = new Schema<ISQLQuestion>(
    {
        title: { type: String, required: true, unique: true },
        description: { type: String, required: true },
        schema: { type: String },
        examples: { type: [SQLExampleSchema], default: [] },
        testCases: { type: [SQLTestCaseSchema], default: [] },
        wrapperCode: { type: String, required: true },
        solution: { type: Schema.Types.Mixed, required: true },
        judge0LanguageId: { type: Number, required: true },
        hiddenTestCases: { type: [SQLHiddenTestCaseSchema], default: [] },
    },
    {
        timestamps: true,
        collection: "sql_questions",
    }
);

// Text index for search
SQLQuestionSchema.index({ title: "text", description: "text" });

export const SQLQuestion = mongoose.model<ISQLQuestion>(
    "SQLQuestion",
    SQLQuestionSchema
);
