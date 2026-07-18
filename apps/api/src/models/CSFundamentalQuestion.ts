import mongoose, { Schema, Document } from "mongoose";

export interface ICSFundamentalQuestion extends Document {
    topic: "CN" | "DBMS" | "OOPS" | "OS";
    question: string;
    answer: string;
    detailedAnswer?: string;
}

const CSFundamentalQuestionSchema = new Schema<ICSFundamentalQuestion>(
    {
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
        },
        detailedAnswer: {
            type: String,
            required: false,
        },
    },
    {
        timestamps: true,
        collection: "cs_fundamental_questions",
    }
);

// Compound index for efficient topic-based queries
CSFundamentalQuestionSchema.index({ topic: 1, question: 1 }, { unique: true });

export const CSFundamentalQuestion = mongoose.model<ICSFundamentalQuestion>(
    "CSFundamentalQuestion",
    CSFundamentalQuestionSchema
);
