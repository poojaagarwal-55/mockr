// ============================================
// Mongoose Model: Gen AI Concept Questions
// ============================================
// Stores conceptual questions for the GEN_AI_CONCEPTS stage
// of the gen_ai_role interview type.
//
// Topics: transformer internals, RAG pipelines, prompt engineering,
// evaluation approaches, model selection, MLOps.
//
// Collection: genai_concept_questions

import mongoose, { Schema, Document } from "mongoose";

export type GenAIConceptSubtopic =
    | "TransformerInternals"
    | "RAGPipeline"
    | "PromptEngineering"
    | "Evaluation"
    | "ModelSelection"
    | "MLOps";

export interface IGenAIConceptQuestion extends Document {
    subtopic: GenAIConceptSubtopic;
    question: string;
    /** Concise reference answer — used by LLM for silent evaluation during the session */
    answer: string;
    /** Expanded answer — used in post-session reports and sample answer display */
    detailedAnswer?: string;
    difficulty: "Easy" | "Medium" | "Hard";
}

const GenAIConceptQuestionSchema = new Schema<IGenAIConceptQuestion>(
    {
        subtopic: {
            type: String,
            required: true,
            enum: ["TransformerInternals", "RAGPipeline", "PromptEngineering", "Evaluation", "ModelSelection", "MLOps"],
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
        difficulty: {
            type: String,
            required: true,
            enum: ["Easy", "Medium", "Hard"],
        },
    },
    {
        timestamps: true,
        collection: "genai_concept_questions",
    }
);

// Compound index: one unique question per subtopic
GenAIConceptQuestionSchema.index({ subtopic: 1, question: 1 }, { unique: true });

export const GenAIConceptQuestion = mongoose.model<IGenAIConceptQuestion>(
    "GenAIConceptQuestion",
    GenAIConceptQuestionSchema
);
