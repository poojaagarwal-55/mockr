// ============================================
// Mongoose Model: System Design Submissions
// ============================================
// Stores a user's submitted system-design attempt:
// FR/NFR text, scratchpad scene, and the AI verdict.

import { mongoose } from "../lib/mongodb.js";

const SystemDesignSubmissionSchema = new mongoose.Schema({
    userId: {
        type: String,
        required: true,
        index: true,
    },
    questionId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: "SystemDesignQuestion",
        index: true,
    },
    functionalRequirements: { type: String, default: "" },
    nonFunctionalRequirements: { type: String, default: "" },
    scratchpadElements: {
        type: mongoose.Schema.Types.Mixed,
        default: null,
    },
    verdict: {
        type: mongoose.Schema.Types.Mixed,
        required: true,
        // Shape:
        //   summary: string
        //   overallScore: number (0–100)
        //   strengths: string[]
        //   improvements: string[]
        //   missingComponents: string[]
        //   tradeoffsCovered: string[]
        //   dimensionScores: [{ name, weight, score, feedback }]
    },
}, {
    timestamps: true,
    collection: "system_design_submissions",
});

SystemDesignSubmissionSchema.index({ userId: 1, questionId: 1, createdAt: -1 });

export const SystemDesignSubmission = mongoose.model(
    "SystemDesignSubmission",
    SystemDesignSubmissionSchema
);
