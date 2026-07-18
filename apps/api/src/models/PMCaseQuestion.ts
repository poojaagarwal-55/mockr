import mongoose, { Schema, Document } from "mongoose";

export interface IPMCaseQuestion extends Document {
    title: string;
    scenario: string;
    constraintInjection: string;
    evaluationGuide: string;
    redFlags: string[];
    successSignals: string[];
    difficulty: "Easy" | "Medium" | "Hard";
}

const PMCaseQuestionSchema = new Schema<IPMCaseQuestion>(
    {
        title: { type: String, required: true, trim: true },
        scenario: { type: String, required: true },
        constraintInjection: { type: String, required: true },
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
        collection: "pm_case_questions",
    }
);

PMCaseQuestionSchema.index({ difficulty: 1 });

export const PMCaseQuestion = mongoose.model<IPMCaseQuestion>(
    "PMCaseQuestion",
    PMCaseQuestionSchema
);
