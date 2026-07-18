import mongoose, { Schema, Document } from "mongoose";

export type PMConceptSubtopic =
    | "MetricDefinition"
    | "MetricInterpretation"
    | "Prioritization"
    | "SprintAwareness"
    | "ExperimentDesign"
    | "NorthStarFraming";

export interface IPMConceptQuestion extends Document {
    subtopic?: PMConceptSubtopic;
    topic?: string;
    question: string;
    answer?: string;
    detailedAnswer?: string;
    scenarioContext?: string;
    evaluationGuide?: string;
    redFlags: string[];
    successSignals: string[];
    difficulty: "Easy" | "Medium" | "Hard";
}

const PMConceptQuestionSchema = new Schema<IPMConceptQuestion>(
    {
        subtopic: {
            type: String,
            required: false,
            enum: [
                "MetricDefinition",
                "MetricInterpretation",
                "Prioritization",
                "SprintAwareness",
                "ExperimentDesign",
                "NorthStarFraming",
            ],
            index: true,
        },
        topic: { type: String, required: false, index: true },
        question: { type: String, required: true },
        answer: { type: String, required: false },
        detailedAnswer: { type: String, required: false },
        scenarioContext: { type: String, required: false },
        evaluationGuide: { type: String, required: false },
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
        collection: "pm_concept_questions",
    }
);

PMConceptQuestionSchema.index({ difficulty: 1 });
PMConceptQuestionSchema.index({ subtopic: 1, difficulty: 1 });

export const PMConceptQuestion = mongoose.model<IPMConceptQuestion>(
    "PMConceptQuestion",
    PMConceptQuestionSchema
);
