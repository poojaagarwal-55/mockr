import mongoose, { Schema, Document } from "mongoose";

export interface IProblemSolvingCaseQuestion extends Document {
    title: string;
    caseType: string;
    difficulty: "Easy" | "Medium" | "Hard";
    prompt: string;
    candidateInstructions: string;
    assumptions: string[];
    decompositionPrompts: string[];
    hintLadder: string[];
    followUps: string[];
    twist: {
        prompt: string;
        expectedAdaptation: string;
    };
    convictionProbes: string[];
    referenceSolution: string;
    evaluationGuide: string;
    redFlags: string[];
    successSignals: string[];
}

const ProblemSolvingCaseQuestionSchema = new Schema<IProblemSolvingCaseQuestion>(
    {
        title: { type: String, required: true, trim: true },
        caseType: { type: String, required: true, index: true },
        difficulty: {
            type: String,
            required: true,
            enum: ["Easy", "Medium", "Hard"],
            index: true,
        },
        prompt: { type: String, required: true },
        candidateInstructions: { type: String, required: true },
        assumptions: { type: [String], required: true, default: [] },
        decompositionPrompts: { type: [String], required: true, default: [] },
        hintLadder: { type: [String], required: true, default: [] },
        followUps: { type: [String], required: true, default: [] },
        twist: {
            prompt: { type: String, required: true },
            expectedAdaptation: { type: String, required: true },
        },
        convictionProbes: { type: [String], required: true, default: [] },
        referenceSolution: { type: String, required: true },
        evaluationGuide: { type: String, required: true },
        redFlags: { type: [String], required: true, default: [] },
        successSignals: { type: [String], required: true, default: [] },
    },
    {
        timestamps: true,
        collection: "problem_solving_case_questions",
    }
);

ProblemSolvingCaseQuestionSchema.index({ caseType: 1, difficulty: 1 });

export const ProblemSolvingCaseQuestion = mongoose.model<IProblemSolvingCaseQuestion>(
    "ProblemSolvingCaseQuestion",
    ProblemSolvingCaseQuestionSchema
);
