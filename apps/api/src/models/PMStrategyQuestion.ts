import mongoose, { Schema, Document } from "mongoose";

export interface IPMStrategyQuestion extends Document {
    title: string;
    scenario: string;
    devilsAdvocateProbes: string[];
    evaluationGuide: string;
    redFlags: string[];
    successSignals: string[];
    difficulty: "Easy" | "Medium" | "Hard";
}

const PMStrategyQuestionSchema = new Schema<IPMStrategyQuestion>(
    {
        title: { type: String, required: true, trim: true },
        scenario: { type: String, required: true },
        devilsAdvocateProbes: { type: [String], required: true, default: [] },
        evaluationGuide: { type: String, required: true },
        redFlags: { type: [String], required: true, default: [] },
        successSignals: { type: [String], required: true, default: [] },
        difficulty: {
            type: String,
            required: true,
            enum: ["Easy", "Medium", "Hard"],
        },
    },
    {
        timestamps: true,
        collection: "pm_strategy_questions",
    }
);

PMStrategyQuestionSchema.index({ difficulty: 1 });

export const PMStrategyQuestion = mongoose.model<IPMStrategyQuestion>(
    "PMStrategyQuestion",
    PMStrategyQuestionSchema
);
