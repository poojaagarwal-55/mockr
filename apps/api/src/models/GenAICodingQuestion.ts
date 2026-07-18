// ============================================
// Mongoose Model: Gen AI Coding Questions
// ============================================
// Stores coding tasks for the GEN_AI_CODING stage of the
// gen_ai_role interview type.
//
// Tasks test LLM-wrapper logic: RAG functions, prompt chains,
// retry wrappers, eval scorers, context managers.
// Mock responses are baked into starter code / test setup
// so Judge0 can execute deterministically without live API calls.
//
// Field purpose map (mirrors DSA question pattern):
//
//   CANDIDATE sees (via IDE):
//     - title, problemStatement, starterCode, sampleTestCases
//
//   LLM uses DURING session (silent evaluation):
//     - sampleSolution      → compact textual grounding for correctness checks
//     - conciseSolution     → legacy compact grounding alias
//     - evaluationCriteria  → rubric for what a strong answer looks like
//     - mutationQuestions   → follow-up twists to ask after solution
//     - hints               → progressive hints when candidate is stuck
//
//   POST-SESSION only (reports + sample answers page):
//     - detailedSolution    → canonical full answer shown on reports/answers page
//
// Collection: genai_coding_questions

import mongoose, { Schema, Document } from "mongoose";

export type GenAICodingTaskType =
    | "RAGFunction"
    | "PromptChain"
    | "RetryWrapper"
    | "EvalScorer"
    | "ContextManager";

export interface IGenAICodingQuestion extends Document {
    title: string;
    taskType: GenAICodingTaskType;
    /** Problem statement shown to candidate in IDE left panel */
    problemStatement: string;
    /** Starter code scaffold shown in the IDE. Python by default. */
    starterCode?: string;
    /**
     * Sample test cases shown to the candidate in the IDE.
     * Mock LLM responses baked in — no live API needed.
     * Shape: { id, description, input, expectedOutput }
     */
    sampleTestCases: Array<{
        id: string;
        description: string;
        input: string;
        expectedOutput: string;
    }>;
    /**
     * Hidden test cases used only on submit. Inputs/outputs are not shown
     * to the candidate and are summarized in the interview result.
     */
    hiddenTestCases?: Array<{
        id: string;
        description: string;
        input: string;
        expectedOutput: string;
    }>;
    /**
     * Legacy LLM-only compact textual reference used during live evaluation.
     * Prefer sampleSolution for newly seeded compact grounding.
     */
    conciseSolution?: string;
    /**
     * LLM-only: compact textual reference used during live evaluation.
     * This should be prose/bullets, not the full canonical code.
     */
    sampleSolution?: string;
    /**
     * LLM-only: rubric describing what a strong implementation looks like.
     * Used for silent evaluation during the coding phase.
     */
    evaluationCriteria: string;
    /**
     * Mutation / twist questions asked AFTER candidate runs tests.
     * LLM picks 1–2 most relevant ones.
     */
    mutationQuestions: string[];
    /**
     * Progressive hints the LLM can give when candidate is stuck.
     * Ordered from least to most revealing.
     * LLM never reveals all at once.
     */
    hints: string[];
    /**
     * POST-SESSION ONLY: canonical full answer shown on
     * the reports and sample answers page. NEVER given to LLM during session.
     */
    detailedSolution: string;
    difficulty: "Easy" | "Medium" | "Hard";
}

const SampleTestCaseSchema = new Schema(
    {
        id:             { type: String, required: true },
        description:    { type: String },
        input:          { type: String, required: true },
        expectedOutput: { type: String, required: true },
    },
    { _id: false }
);

const GenAICodingQuestionSchema = new Schema<IGenAICodingQuestion>(
    {
        title: {
            type: String,
            required: true,
            unique: true,
            trim: true,
        },
        taskType: {
            type: String,
            required: true,
            enum: ["RAGFunction", "PromptChain", "RetryWrapper", "EvalScorer", "ContextManager"],
            index: true,
        },
        problemStatement: {
            type: String,
            required: true,
        },
        starterCode: {
            type: String,
            required: false,
        },
        sampleTestCases: {
            type: [SampleTestCaseSchema],
            default: [],
        },
        hiddenTestCases: {
            type: [SampleTestCaseSchema],
            default: [],
            select: false,
        },
        conciseSolution: {
            type: String,
            required: false,
        },
        sampleSolution: {
            type: String,
            required: false,
        },
        evaluationCriteria: {
            type: String,
            required: true,
        },
        mutationQuestions: {
            type: [String],
            default: [],
        },
        hints: {
            type: [String],
            default: [],
        },
        detailedSolution: {
            type: String,
            required: true,
        },
        difficulty: {
            type: String,
            required: true,
            enum: ["Easy", "Medium", "Hard"],
        },
    },
    {
        timestamps: true,
        collection: "genai_coding_questions",
    }
);

export const GenAICodingQuestion = mongoose.model<IGenAICodingQuestion>(
    "GenAICodingQuestion",
    GenAICodingQuestionSchema
);
