// ============================================
// Mongoose Model: Data Science Concept Questions
// ============================================
// Stores applied statistics & ML reasoning questions for the DS_CONCEPTS
// stage of the data_science_role interview type.
//
// Topics: Probability, Hypothesis Testing, Regression, Classification,
// Experiment Design, Bias-Variance, Feature Engineering, Model Evaluation.
//
// Collection: ds_concept_questions

import mongoose, { Schema, Document } from "mongoose";

export type DSConceptSubtopic =
    | "Probability"
    | "HypothesisTesting"
    | "Regression"
    | "Classification"
    | "ExperimentDesign"
    | "BiasVariance"
    | "FeatureEngineering"
    | "ModelEvaluation";

export interface IDSConceptQuestion extends Document {
    subtopic: DSConceptSubtopic;
    /** The applied reasoning question — "How would you…" not "Define…" */
    question: string;
    /** Concise reference answer used by LLM for silent evaluation */
    referenceAnswer: string;
    /** Expanded answer for post-session report display */
    detailedAnswer?: string;
    /** Common wrong/weak answers to watch for (LLM-only) */
    redFlags?: string[];
    difficulty: "Easy" | "Medium" | "Hard";
}

const DSConceptQuestionSchema = new Schema<IDSConceptQuestion>(
    {
        subtopic: {
            type: String,
            required: true,
            enum: [
                "Probability",
                "HypothesisTesting",
                "Regression",
                "Classification",
                "ExperimentDesign",
                "BiasVariance",
                "FeatureEngineering",
                "ModelEvaluation",
            ],
            index: true,
        },
        question: { type: String, required: true },
        referenceAnswer: { type: String, required: true },
        detailedAnswer: { type: String, required: false },
        redFlags: { type: [String], default: [] },
        difficulty: {
            type: String,
            required: true,
            enum: ["Easy", "Medium", "Hard"],
        },
    },
    {
        timestamps: true,
        collection: "ds_concept_questions",
    }
);

DSConceptQuestionSchema.index({ subtopic: 1, question: 1 }, { unique: true });

export const DSConceptQuestion = mongoose.model<IDSConceptQuestion>(
    "DSConceptQuestion",
    DSConceptQuestionSchema
);
