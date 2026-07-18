// ============================================
// Interview Type Registry
// ============================================
// Central registry that maps InterviewType → config.
// To add a new interview type, simply:
// 1. Create a config file in this directory
// 2. Import and register it here
//
// The rest of the system (orchestrator, prompts, tools,
// voice service) all look up configs from this registry.

import type { InterviewType } from "@interviewforge/shared";
import type {
    InterviewTypeConfig,
    ModuleCompatibilityManifest,
    PrefetchRequirements,
} from "./base.js";

import { fullInterviewConfig } from "./full-interview.js";
import { codingConfig } from "./coding.js";
import { csFundamentalsConfig } from "./cs-fundamentals.js";
import { systemDesignConfig } from "./system-design.js";
import { behaviouralConfig } from "./behavioural.js";
import { genAIRoleConfig } from "./gen-ai-role.js";
import { dataScienceRoleConfig } from "./data-science-role.js";
import { pmRoleConfig } from "./pm-role.js";
import { problemSolvingCaseConfig } from "./problem-solving-case.js";
import { resumeRoundConfig } from "./resume-round.js";

// ── Registry ─────────────────────────────────────────────────

const INTERVIEW_TYPE_CONFIGS: Record<InterviewType, InterviewTypeConfig> = {
    full_interview: fullInterviewConfig,
    coding: codingConfig,
    cs_fundamentals: csFundamentalsConfig,
    system_design: systemDesignConfig,
    behavioural: behaviouralConfig,
    gen_ai_role: genAIRoleConfig,
    data_science_role: dataScienceRoleConfig,
    pm_role: pmRoleConfig,
    problem_solving_case: problemSolvingCaseConfig,
    resume_round: resumeRoundConfig,
};

/**
 * Get the config for a given interview type.
 * Throws if the type is not registered (dev error).
 */
export function getInterviewTypeConfig(type: InterviewType): InterviewTypeConfig {
    const config = INTERVIEW_TYPE_CONFIGS[type];
    if (!config) {
        throw new Error(
            `Unknown interview type: "${type}". ` +
            `Available types: ${Object.keys(INTERVIEW_TYPE_CONFIGS).join(", ")}`
        );
    }
    return config;
}

/**
 * Get all registered interview type configs.
 */
export function getAllInterviewTypeConfigs(): InterviewTypeConfig[] {
    return Object.values(INTERVIEW_TYPE_CONFIGS);
}

/**
 * Check if a string is a valid registered interview type.
 */
export function isValidInterviewType(type: string): type is InterviewType {
    return type in INTERVIEW_TYPE_CONFIGS;
}

function buildDefaultPrefetchRequirements(type: InterviewType, config: InterviewTypeConfig): PrefetchRequirements {
    const includesDSA = config.stages.includes("DSA");
    const includesSystemDesign = config.stages.includes("SYSTEM_DESIGN");
    const includesFundamentals = config.stages.includes("FUNDAMENTALS");

    return {
        requiresResume: type === "full_interview" || type === "system_design" || type === "gen_ai_role" || type === "data_science_role" || type === "pm_role" || type === "resume_round",
        requiresDSAQuestion: includesDSA,
        requiresCSQuestions: includesFundamentals,
        requiresSQLQuestion: includesFundamentals,
        requiresSDQuestion: includesSystemDesign,
        requiresBehavioralQuestions: false,
        requiresGenAIConceptQuestions: type === "gen_ai_role",
        requiresGenAICodingQuestion: type === "gen_ai_role",
        requiresGenAISystemDesignQuestion: false,
        requiresDSConceptQuestions: type === "data_science_role",
        requiresDSSQLQuestion: type === "data_science_role",
        requiresDSCodingQuestion: type === "data_science_role",
        requiresProblemSolvingCaseQuestion: type === "problem_solving_case",
    };
}

function buildDefaultCompatibilityManifest(type: InterviewType, config: InterviewTypeConfig): ModuleCompatibilityManifest {
    return {
        prefetchRequirements: buildDefaultPrefetchRequirements(type, config),
        stageContracts: Object.fromEntries(
            config.stages.map((stage) => [
                stage,
                {
                    stage,
                },
            ])
        ),
        toolDependencies: Object.fromEntries(
            config.stages.map((stage) => [
                stage,
                (config.stageTools[stage] || []).map((toolName) => ({ toolName })),
            ])
        ),
        forbiddenSequences: [],
        modeSupport: {
            textSupported: true,
            voiceSupported: true,
        },
    };
}

export function getModuleCompatibilityManifest(type: InterviewType): ModuleCompatibilityManifest {
    const config = getInterviewTypeConfig(type);
    return config.compatibilityManifest || buildDefaultCompatibilityManifest(type, config);
}

// Re-export base interface for external use
export type {
    InterviewTypeConfig,
    ModuleCompatibilityManifest,
    PersonaConfig,
    StagePromptModule,
} from "./base.js";
