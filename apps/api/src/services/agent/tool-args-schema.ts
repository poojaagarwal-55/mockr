import { z } from "zod";
import { MAX_HINTS_PER_QUESTION } from "@interviewforge/shared";

export const TOOL_NAME_VALUES = [
    "fetch_question",
    "open_ide",
    "open_sql_editor",
    "open_scratchpad",
    "open_notepad",
    "close_panel",
    "run_candidate_code",
    "give_hint",
    "transition_stage",
    "end_interview",
    "record_question",
    "record_resume_probe",
    "open_screening_workspace",
    "record_screening_question",
] as const;

export type ToolName = (typeof TOOL_NAME_VALUES)[number];

const interviewStageSchema = z.enum([
    "INTRO",
    "DSA",
    "FUNDAMENTALS",
    "SYSTEM_DESIGN",
    "BEHAVIOURAL",
    "CLOSING",
    "GEN_AI_CONCEPTS",
    "GEN_AI_CODING",
    "GEN_AI_SYSTEM_DESIGN",
    "DS_CONCEPTS",
    "DS_SQL",
    "DS_CODING",
    "DS_BUSINESS_CASE",
    "PM_CASE",
    "PM_CONCEPTS",
    "PM_STRATEGY",
    "PM_BEHAVIORAL",
    "RESUME_STUDIES",
    "RESUME_PROJECTS",
    "RESUME_EXPERIENCE",
    "RESUME_RESPONSIBILITY",
    "RESUME_SKILLS",
]);

const fetchQuestionArgsSchema = z.object({
    category: z.string().trim().min(1).max(64),
    difficulty: z.string().trim().min(1).max(32).optional(),
});

const openIDEArgsSchema = z.object({
    questionId: z.string().trim().min(1).max(256),
    language: z.string().trim().min(1).max(32),
});

const openSQLEditorArgsSchema = z.object({});

const openScratchpadArgsSchema = z.object({
    topic: z.string().trim().min(1).max(200),
    initialContent: z.string().max(20_000),
});

const openNotepadArgsSchema = z.object({
    topic: z.string().trim().min(1).max(200),
    template: z.enum(["CIRCLES", "blank"]),
    scenario: z.string().max(20_000).optional(),
});

const closePanelArgsSchema = z.object({
    summary: z.string().trim().min(1).max(500),
});

const runCandidateCodeArgsSchema = z.object({
    language: z.string().trim().min(1).max(32),
    code: z.string().min(1).max(200_000),
    questionId: z.string().trim().min(1).max(256),
});

const giveHintArgsSchema = z.object({
    questionId: z.string().trim().min(1).max(256),
    hintNumber: z.number().int().min(1).max(MAX_HINTS_PER_QUESTION),
});

const transitionStageArgsSchema = z.object({
    nextStage: interviewStageSchema,
    reason: z.string().trim().min(1).max(500),
});

const endInterviewArgsSchema = z.object({
    summary: z.string().trim().min(1).max(1_000),
});

const recordQuestionArgsSchema = z.object({
    questionFundamentalId: z.string().trim().min(1).max(256),
    questionTitle: z.string().trim().min(1).max(1_000),
    referenceAnswer: z.string().max(15_000).nullish(),
});

const resumeProbeDepthSchema = z.enum([
    "overview",
    "motivation",
    "ownership",
    "implementation",
    "tradeoffs",
    "failure_depth",
    "senior_depth",
]);

const recordResumeProbeArgsSchema = z.object({
    projectName: z.string().trim().min(1).max(200).optional(),
    agendaItemId: z.string().trim().min(1).max(120).optional(),
    depth: resumeProbeDepthSchema,
    intent: z.enum(["overview", "motivation", "ownership", "implementation", "tradeoff", "failure", "impact", "skill_usage", "fit"]).optional(),
    answerQuality: z.enum(["weak", "partial", "strong", "declined"]),
    evidence: z.string().trim().min(1).max(800),
    shouldCloseItem: z.boolean().optional(),
    componentKey: z.string().trim().min(1).max(120).optional(),
});

// Company-screening tools reference a blueprint (screening) question id.
const screeningQuestionRefArgsSchema = z.object({
    questionId: z.string().trim().min(1).max(256),
});

export const toolArgsSchemas: Record<ToolName, z.ZodTypeAny> = {
    fetch_question: fetchQuestionArgsSchema,
    open_ide: openIDEArgsSchema,
    open_sql_editor: openSQLEditorArgsSchema,
    open_scratchpad: openScratchpadArgsSchema,
    open_notepad: openNotepadArgsSchema,
    close_panel: closePanelArgsSchema,
    run_candidate_code: runCandidateCodeArgsSchema,
    give_hint: giveHintArgsSchema,
    transition_stage: transitionStageArgsSchema,
    end_interview: endInterviewArgsSchema,
    record_question: recordQuestionArgsSchema,
    record_resume_probe: recordResumeProbeArgsSchema,
    open_screening_workspace: screeningQuestionRefArgsSchema,
    record_screening_question: screeningQuestionRefArgsSchema,
};

export type ToolArgsValidationResult =
    | { success: true; data: unknown }
    | { success: false; message: string };

export function validateToolArgs(toolName: ToolName, rawArgs: unknown): ToolArgsValidationResult {
    const schema = toolArgsSchemas[toolName];
    const parsed = schema.safeParse(rawArgs ?? {});

    if (parsed.success) {
        return { success: true, data: parsed.data };
    }

    const issueSummary = parsed.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join(".") || "args"}: ${issue.message}`)
        .join("; ");

    return {
        success: false,
        message: `Invalid arguments for ${toolName}. ${issueSummary || "Malformed payload."}`,
    };
}
