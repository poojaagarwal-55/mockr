// ============================================
// Mongoose Model: Gen AI System Design Questions
// ============================================
// Stores architecture design problems for the GEN_AI_SYSTEM_DESIGN
// stage of the gen_ai_role interview type.
//
// Schema mirrors system-design-question.ts pattern:
//   - problemStatement: shown to candidate in scratchpad left panel
//   - rubricLite: LLM uses silently during interview for evaluation + probing
//   - rubricFull: used POST-SESSION in reports and sample answer display only
//   - sampleDiagramUrl: future — CDN URL for reference architecture diagram
//
// The LLM receives rubricLite (lightweight) during the session.
// The LLM never receives rubricFull during the interview.
//
// Collection: genai_system_design_questions

import mongoose, { Schema, Document } from "mongoose";

export type GenAISystemDesignCategory =
    | "RAGPipeline"
    | "LLMServing"
    | "RLHFSystem"
    | "EvalFramework"
    | "MultiModal"
    | "AISafety"
    | "AgentSystem";

export interface IGenAISystemDesignQuestion extends Document {
    category: GenAISystemDesignCategory;
    /** Short display title shown in the scratchpad left panel header */
    title: string;
    /** Full problem statement displayed to candidate in the left panel */
    problemStatement: string;
    /**
     * Lightweight rubric used by LLM silently during the interview.
     * Shape:
     *   requiredComponents: string[]        — must-have architectural pieces
     *   keyTradeoffs: string[]              — tradeoffs to probe for
     *   antiPatterns: string[]              — red flags to detect silently
     *   probeQuestions: string[]            — GenAI-specific follow-up questions
     */
    rubricLite: {
        requiredComponents: string[];
        keyTradeoffs: string[];
        antiPatterns: string[];
        probeQuestions: string[];
    };
    /**
     * Full rubric used POST-SESSION for reports and sample answer display.
     * NEVER given to LLM during the interview.
     * Shape:
     *   sampleAnswer: string                — concise reference architecture (reports page)
     *   detailedAnswer: string              — expanded walkthrough (sample answers page)
     *   scoringDimensions: [{ name, weight, criteria }]
     */
    rubricFull: {
        sampleAnswer: string;
        detailedAnswer: string;
        scoringDimensions: Array<{
            name: string;
            weight: number;
            criteria: string;
        }>;
    };
    difficulty: "Medium" | "Hard";
    /** Future: CDN URL for reference architecture diagram (e.g. R2/S3) */
    sampleDiagramUrl?: string | null;
}

const GenAISystemDesignQuestionSchema = new Schema<IGenAISystemDesignQuestion>(
    {
        category: {
            type: String,
            required: true,
            enum: ["RAGPipeline", "LLMServing", "RLHFSystem", "EvalFramework", "MultiModal", "AISafety", "AgentSystem"],
            index: true,
        },
        title: {
            type: String,
            required: true,
            unique: true,
            trim: true,
        },
        problemStatement: {
            type: String,
            required: true,
        },
        rubricLite: {
            type: Schema.Types.Mixed,
            required: true,
            // Shape: { requiredComponents, keyTradeoffs, antiPatterns, probeQuestions }
        },
        rubricFull: {
            type: Schema.Types.Mixed,
            required: true,
            // Shape: { sampleAnswer, detailedAnswer, scoringDimensions }
        },
        difficulty: {
            type: String,
            required: true,
            enum: ["Medium", "Hard"],
        },
        sampleDiagramUrl: {
            type: String,
            default: null,
            // Public CDN URL for reference architecture diagram image
            // e.g. https://pub-xxx.r2.dev/genai-system-design/diagrams/rag-enterprise.webp
        },
    },
    {
        timestamps: true,
        collection: "genai_system_design_questions",
    }
);

export const GenAISystemDesignQuestion = mongoose.model<IGenAISystemDesignQuestion>(
    "GenAISystemDesignQuestion",
    GenAISystemDesignQuestionSchema
);
