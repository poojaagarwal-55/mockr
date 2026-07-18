// ============================================
// Mongoose Model: Data Science SQL Questions
// ============================================
// Stores SQL problem sets for the DS_SQL stage of the
// data_science_role interview type. Each question has a
// realistic schema loaded into the SQL editor and 1-2 query tasks.
//
// The schema is rendered visually in the left panel (same component
// as existing SQL IDE). Problem statement is shown below it.
// LLM receives follow-up probing questions to ask after submission.
//
// Collection: ds_sql_questions

import mongoose, { Schema } from "mongoose";

export interface ISchemaColumn {
    name: string;
    type: string;           // SQL type: VARCHAR, INT, TIMESTAMP, etc.
    nullable: boolean;
    description?: string;
}

export interface ISchemaTable {
    tableName: string;
    columns: ISchemaColumn[];
    /** Row count hint shown in UI e.g. "~50M rows" */
    rowCountHint?: string;
    /** CREATE TABLE DDL — loaded into the SQL editor automatically */
    ddl: string;
}

export interface IDSSQLQuestion {
    title: string;
    domain: "ecommerce" | "saas" | "logistics" | "healthcare" | "fintech";
    /** The business-framed task presented to the candidate */
    problemStatement: string;
    /** Tables rendered in the left schema panel + loaded as DDL */
    schema: ISchemaTable[];
    /** Expected correct query (LLM-only) */
    sampleSolution: string;
    /** LLM follow-up probes asked after submission */
    followUpQuestions: string[];
    /** Evaluation criteria for LLM scoring (LLM-only) */
    evaluationCriteria: string;
    difficulty: "Easy" | "Medium" | "Hard";
}

const SchemaColumnSchema = new Schema<ISchemaColumn>(
    {
        name: { type: String, required: true },
        type: { type: String, required: true },
        nullable: { type: Boolean, required: true },
        description: { type: String },
    },
    { _id: false }
);

const SchemaTableSchema = new Schema<ISchemaTable>(
    {
        tableName: { type: String, required: true },
        columns: { type: [SchemaColumnSchema], required: true },
        rowCountHint: { type: String },
        ddl: { type: String, required: true },
    },
    { _id: false }
);

const DSSQLQuestionSchema = new Schema<IDSSQLQuestion>(
    {
        title: { type: String, required: true },
        domain: {
            type: String,
            required: true,
            enum: ["ecommerce", "saas", "logistics", "healthcare", "fintech"],
            index: true,
        },
        problemStatement: { type: String, required: true },
        schema: { type: [SchemaTableSchema], required: true },
        sampleSolution: { type: String, required: true },
        followUpQuestions: { type: [String], default: [] },
        evaluationCriteria: { type: String, required: true },
        difficulty: {
            type: String,
            required: true,
            enum: ["Easy", "Medium", "Hard"],
        },
    },
    {
        timestamps: true,
        collection: "ds_sql_questions",
    }
);

DSSQLQuestionSchema.index({ title: 1 }, { unique: true });

export const DSSQLQuestion = mongoose.model<IDSSQLQuestion>(
    "DSSQLQuestion",
    DSSQLQuestionSchema
);
