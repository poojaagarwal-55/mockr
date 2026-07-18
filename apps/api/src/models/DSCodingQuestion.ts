// ============================================
// Mongoose Model: Data Science Coding Questions
// ============================================
// Stores Python/Pandas analysis tasks for the DS_CODING stage.
//
// Architecture:
// - dataSchema: rendered in the left panel (same SQL schema panel, dtype instead of SQL type)
// - starterCode: prepended INVISIBLY before candidate code on Judge0 execution
//   (contains inline DATA string + df = pd.read_csv(io.StringIO(DATA)))
// - Candidate starts their editor at line 1, always assigns output to `result`
// - structuralAssertions: appended invisibly — checks shape/type only, not exact values
//   (avoids false-failing correct solutions with different valid approaches)
// - sampleSolution + evaluationCriteria: LLM-only, never sent to frontend
//
// Collection: ds_coding_questions

import mongoose, { Schema } from "mongoose";

export interface IDataColumn {
    name: string;
    dtype: string;          // pandas dtype: int64, object, float64, datetime64, bool
    description?: string;   // e.g. "1 if converted, 0 otherwise"
    nullable: boolean;
}

export interface IDataTable {
    tableName: string;      // logical name e.g. "sessions", "orders"
    columns: IDataColumn[];
    rowCount: string;       // e.g. "~10,000 rows"
    /** 3–4 preview rows shown in the left panel */
    sampleRows?: Record<string, any>[];
}

export interface IDSCodingQuestion {
    questionId?: string;
    title: string;
    category?: string;
    tags?: string[];
    /** The task description shown in the left panel below the schema */
    description?: string;
    problemStatement?: string;
    /** Schema rendered in the left panel — matches the embedded dataset */
    dataSchema?: IDataTable[];
    datasetUrl?: string;
    /**
     * Full invisible preamble prepended before candidate code.
     * Must contain:
     *   import pandas as pd, numpy as np, io
     *   DATA = """...(csv string)..."""
     *   df = pd.read_csv(io.StringIO(DATA))
     *   result = None  # candidate replaces this
     */
    starterCode: string;
    hiddenCodeBefore?: string;
    hiddenCodeAfter?: string;
    /**
     * Structural assertions appended after candidate code.
     * Should only check shape/type, NOT exact values.
     * E.g.:
     *   assert isinstance(result, pd.DataFrame), "result must be a DataFrame"
     *   assert "country" in result.columns
     *   assert len(result) <= 10
     */
    structuralAssertions?: string;
    /** Expected output description for LLM to evaluate against — never sent to frontend */
    solution?: string;
    conciseSolution?: string;
    sampleSolution?: string;
    sampleTestCases?: Array<{ id: string; description: string; input: string; output: string }>;
    hiddenTestCases?: Array<Record<string, any>>;
    /** What the LLM should probe and score (LLM-only) */
    evaluationCriteria: string;
    /** Probing questions LLM asks as candidate codes */
    probingQuestions: string[];
    hints?: string[];
    interviewNotes?: string;
    timeLimit?: number;
    memoryLimit?: number;
    metadata?: Record<string, any>;
    difficulty: "Easy" | "Medium" | "Hard";
}

const DataColumnSchema = new Schema<IDataColumn>(
    {
        name: { type: String, required: true },
        dtype: { type: String, required: true },
        description: { type: String },
        nullable: { type: Boolean, required: true, default: false },
    },
    { _id: false }
);

const DataTableSchema = new Schema<IDataTable>(
    {
        tableName: { type: String, required: true },
        columns: { type: [DataColumnSchema], required: true },
        rowCount: { type: String, required: true },
        sampleRows: { type: [Schema.Types.Mixed], default: [] } as any,
    },
    { _id: false }
);

const DSCodingQuestionSchema = new Schema<IDSCodingQuestion>(
    {
        questionId: { type: String, unique: true, sparse: true },
        title: { type: String, required: true },
        category: { type: String },
        tags: { type: [String], default: [] },
        description: { type: String },
        problemStatement: { type: String },
        dataSchema: { type: [DataTableSchema], default: [] },
        datasetUrl: { type: String },
        starterCode: { type: String, required: true },
        hiddenCodeBefore: { type: String },
        hiddenCodeAfter: { type: String },
        structuralAssertions: { type: String },
        solution: { type: String },
        conciseSolution: { type: String },
        sampleSolution: { type: String },
        sampleTestCases: { type: [Schema.Types.Mixed], default: [] } as any,
        hiddenTestCases: { type: [Schema.Types.Mixed], default: [] } as any,
        evaluationCriteria: { type: String, required: true },
        probingQuestions: { type: [String], default: [] },
        hints: { type: [String], default: [] },
        interviewNotes: { type: String },
        timeLimit: { type: Number },
        memoryLimit: { type: Number },
        metadata: { type: Schema.Types.Mixed },
        difficulty: {
            type: String,
            required: true,
            enum: ["Easy", "Medium", "Hard"],
        },
    },
    {
        timestamps: true,
        collection: "ds_coding_questions",
    }
);

DSCodingQuestionSchema.index({ title: 1 }, { unique: true });
DSCodingQuestionSchema.index({ questionId: 1 }, { unique: true, sparse: true });

export const DSCodingQuestion = mongoose.model<IDSCodingQuestion>(
    "DSCodingQuestion",
    DSCodingQuestionSchema
);
