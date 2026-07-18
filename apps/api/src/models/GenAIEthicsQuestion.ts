// ============================================
// Mongoose Model: Gen AI Ethics Questions
// ============================================
// Stores ethics/responsibility scenarios for the CLOSING stage
// of the gen_ai_role interview type.
//
// The `evaluationGuide`, `companyBrief`, and `redFlags` fields
// are injected ONLY into the LLM system prompt — never emitted
// to the candidate in the chat (same pattern as rubricLite in
// system design questions).
//
// Collection: genai_ethics_questions

import mongoose, { Schema, Document } from "mongoose";

export interface IGenAIEthicsQuestion extends Document {
    /** The ethics dilemma presented verbally to the candidate */
    scenario: string;
    /**
     * LLM-only: what a strong vs. weak answer looks like.
     * Never shown to candidate.
     */
    evaluationGuide: string;
    /**
     * LLM-only: company/team context for answering candidate questions
     * during the Q&A portion of closing. Never shown to candidate.
     */
    companyBrief: string;
    /**
     * LLM-only: answer patterns that should lower the ethics score.
     * Never shown to candidate.
     */
    redFlags: string[];
    difficulty: "Easy" | "Medium" | "Hard";
}

const GenAIEthicsQuestionSchema = new Schema<IGenAIEthicsQuestion>(
    {
        scenario: {
            type: String,
            required: true,
            unique: true,
        },
        evaluationGuide: {
            type: String,
            required: true,
        },
        companyBrief: {
            type: String,
            required: true,
        },
        redFlags: {
            type: [String],
            default: [],
        },
        difficulty: {
            type: String,
            required: true,
            enum: ["Easy", "Medium", "Hard"],
        },
    },
    {
        timestamps: true,
        collection: "genai_ethics_questions",
    }
);

export const GenAIEthicsQuestion = mongoose.model<IGenAIEthicsQuestion>(
    "GenAIEthicsQuestion",
    GenAIEthicsQuestionSchema
);
