// ============================================
// Interview Type Config — Base Interface
// ============================================
// Every interview type (Full, Coding, CS Fundamentals,
// System Design, Behavioural) implements this interface.
// This is the core abstraction that allows different
// developers to work on different interview types
// independently without touching shared code.

import type { ChatCompletionTool } from "openai/resources/chat/completions";
import type { InterviewType, InterviewStage } from "@interviewforge/shared";
import type { ScoreCategory } from "@interviewforge/shared";

export type PersonaKind = "strict_interviewer" | "warm_behavioural" | "custom";

export interface PersonaConfig {
    kind: PersonaKind;
    customPrompt?: string;
}

export interface StagePromptModule {
    opening?: string;
    mandatorySteps?: string;
    evaluationCriteria?: string;
    toolGuidance?: string;
    transitions?: string;
    closeout?: string;
}

export interface ToolDependencySpec {
    toolName: string;
    prerequisites?: string[];
}

export interface StageContractSpec {
    stage: InterviewStage;
    entryPreconditions?: string[];
    exitPreconditions?: string[];
    requiredToolCalls?: string[];
}

export interface ToolSequenceRule {
    forbiddenSequence: string[];
    reason: string;
}

export interface PrefetchRequirements {
    requiresResume: boolean;
    requiresDSAQuestion: boolean;
    requiresCSQuestions: boolean;
    requiresSQLQuestion: boolean;
    requiresSDQuestion: boolean;
    requiresBehavioralQuestions: boolean;
    // Gen AI Role specific
    requiresGenAIConceptQuestions?: boolean;
    requiresGenAICodingQuestion?: boolean;
    requiresGenAISystemDesignQuestion?: boolean;
    requiresGenAIEthicsQuestion?: boolean;
    // Data Science Role specific
    requiresDSConceptQuestions?: boolean;
    requiresDSSQLQuestion?: boolean;
    requiresDSCodingQuestion?: boolean;
    // Product Manager Role specific
    requiresPMCaseQuestion?: boolean;
    requiresPMConceptQuestions?: boolean;
    requiresPMStrategyQuestion?: boolean;
    // Problem Solving Case specific
    requiresProblemSolvingCaseQuestion?: boolean;
}

export interface VoiceTextSupportSpec {
    textSupported: boolean;
    voiceSupported: boolean;
}

export interface ModuleCompatibilityManifest {
    prefetchRequirements: PrefetchRequirements;
    stageContracts: Partial<Record<InterviewStage, StageContractSpec>>;
    toolDependencies?: Partial<Record<InterviewStage, ToolDependencySpec[]>>;
    forbiddenSequences?: ToolSequenceRule[];
    modeSupport?: VoiceTextSupportSpec;
}

/**
 * Configuration for a single interview type.
 *
 * To add a new interview type:
 * 1. Create a new file in this directory (e.g. `my-type.ts`)
 * 2. Export a const satisfying `InterviewTypeConfig`
 * 3. Register it in `./index.ts`
 *
 * Each config is self-contained: it defines its own stages,
 * prompts, tools, and scoring. This means multiple developers
 * can work on different types simultaneously without conflicts.
 */
export interface InterviewTypeConfig {
    /** Unique identifier — must match InterviewType */
    type: InterviewType;

    /** Human-readable label */
    label: string;

    /** Ordered stages for this interview type */
    stages: InterviewStage[];

    /** Duration per stage in minutes */
    stageDurations: Partial<Record<InterviewStage, { min: number; max: number }>>;

    /**
     * Which tool names are available in each stage.
     * Tool names must match those in `agent-tools.ts`.
     * The orchestrator will filter the master tool list
     * to only include these for each stage.
     */
    stageTools: Partial<Record<InterviewStage, string[]>>;

    /** Scoring rubric categories for this interview type */
    scoringCategories: ScoreCategory[];

    /**
     * Stage-specific system prompt instructions.
     * These tell the AI how to conduct each stage.
     */
    stagePrompts: Partial<Record<InterviewStage, string>>;

    /**
     * Optional structured stage prompt modules.
     * If present, these are composed in deterministic order.
     * If absent, the legacy stagePrompts fallback is used.
     */
    stagePromptModules?: Partial<Record<InterviewStage, StagePromptModule>>;

    /**
     * Optional persona override.
     * If not provided, the default strict interviewer persona is used.
     */
    personaPrompt?: string;

    /**
     * Optional structured persona selection for modular prompt composition.
     */
    personaConfig?: PersonaConfig;

    /**
     * Optional tool usage instructions override.
     * If not provided, auto-generated from stageTools.
     */
    toolUsagePrompt?: string;

    /**
     * Optional voice-specific directives override.
     * If not provided, the default voice directives are used.
     */
    voiceDirectives?: string;

    /**
     * Optional compatibility manifest used by preflight and runtime validators.
     */
    compatibilityManifest?: ModuleCompatibilityManifest;

    /**
     * Additional tool declarations specific to this interview type.
     * These are merged with the base tool declarations.
     * Use this for type-specific tools (e.g. whiteboard for system design).
     */
    additionalTools?: ChatCompletionTool[];
}
