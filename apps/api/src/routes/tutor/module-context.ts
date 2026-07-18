import type { InterviewType } from "@interviewforge/shared";
import { normalizeInterviewModuleConfig } from "../../services/agent/interview-module-selection.js";

const STAGE_TO_MODULE: Record<string, string> = {
    INTRO: "resume",
    DSA: "coding",
    FUNDAMENTALS: "cs_fundamentals",
    SYSTEM_DESIGN: "system_design",
    BEHAVIOURAL: "behavioural",
    GEN_AI_CONCEPTS: "genai",
    GEN_AI_CODING: "genai_coding",
    GEN_AI_SYSTEM_DESIGN: "genai_system_design",
    DS_CONCEPTS: "data_science",
    DS_SQL: "ds_sql",
    DS_CODING: "ds_coding",
    DS_BUSINESS_CASE: "ds_business_case",
    PM_CASE: "pm_case",
    PM_CONCEPTS: "pm_concepts",
    PM_STRATEGY: "pm_strategy",
    PM_BEHAVIORAL: "pm_behavioural",
    PROBLEM_SOLVING: "problem_solving_case",
    RESUME_STUDIES: "resume_studies",
    RESUME_PROJECTS: "resume_projects",
    RESUME_EXPERIENCE: "resume_experience",
    RESUME_RESPONSIBILITY: "resume_responsibility",
    RESUME_SKILLS: "resume_skills",
    CLOSING: "closing",
};

const KNOWN_INTERVIEW_TYPES = new Set([
    "coding",
    "full_interview",
    "system_design",
    "sql",
    "cs_fundamentals",
    "behavioural",
    "gen_ai_role",
    "data_science_role",
    "pm_role",
    "problem_solving_case",
    "resume_round",
]);

const STRUCTURAL_STAGES = new Set(["INTRO", "CLOSING"]);

const RESUME_MODULE_TYPES = new Set([
    "full_interview",
    "gen_ai_role",
    "data_science_role",
    "pm_role",
]);

function asInterviewType(type: string): InterviewType {
    return (KNOWN_INTERVIEW_TYPES.has(type) ? type : "full_interview") as InterviewType;
}

function stringArray(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        : [];
}

function unique(values: string[]): string[] {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function userFacingModules(interviewType: string, enabledStages: string[]): string[] {
    const modules = enabledStages
        .filter((stage) => {
            if (stage === "INTRO") return RESUME_MODULE_TYPES.has(interviewType);
            return !STRUCTURAL_STAGES.has(stage);
        })
        .map((stage) => STAGE_TO_MODULE[stage] || stage.toLowerCase());

    return unique(modules);
}

function selectedGenAITopics(stageOptions: Record<string, any>): string[] {
    return unique([
        ...stringArray(stageOptions.GEN_AI_CONCEPTS?.topics),
        ...stringArray(stageOptions.GEN_AI_CONCEPTS?.subtopics),
    ]);
}

export function buildEffectiveInterviewConfig(interviewType: string, rawModuleConfig: unknown) {
    const normalized = normalizeInterviewModuleConfig(asInterviewType(interviewType), rawModuleConfig);
    const stageOptions = normalized.stageOptions || {};
    const enabledStages = normalized.enabledStages || [];
    const enabledModules = userFacingModules(interviewType, enabledStages);
    const fundamentalsOptions = (stageOptions as any).FUNDAMENTALS || {};
    const includeSql = enabledStages.includes("FUNDAMENTALS")
        ? fundamentalsOptions.includeSQL !== false
        : (enabledStages.includes("DS_SQL") || interviewType === "sql");

    return {
        interviewType,
        source: normalized.source,
        enabledStages,
        disabledStages: normalized.disabledStages || [],
        enabledModules,
        candidateFacingModules: enabledModules,
        stageOptions,
        stageDurations: normalized.stageDurations || {},
        selectedDsaTopics: stringArray((stageOptions as any).DSA?.topics),
        selectedCsTopics: stringArray((stageOptions as any).FUNDAMENTALS?.topics),
        selectedGenAITopics: selectedGenAITopics(stageOptions as Record<string, any>),
        selectedDSTopics: stringArray((stageOptions as any).DS_CONCEPTS?.topics),
        includeSql,
        questionsPerTopic: fundamentalsOptions.questionCountPerTopic ?? null,
        dsaDifficulty: (stageOptions as any).DSA?.difficulty ?? null,
        hasResumeDeepDive: enabledStages.includes("INTRO") && RESUME_MODULE_TYPES.has(interviewType),
        hasStructuralClosing: enabledStages.includes("CLOSING"),
    };
}

export function buildModuleConfigSummary(interviewType: string, rawModuleConfig: unknown): string {
    const config = buildEffectiveInterviewConfig(interviewType, rawModuleConfig);
    const parts = [interviewType.replace(/_/g, " ")];
    if (config.enabledModules.length) parts.push(`focus: ${config.enabledModules.join(", ")}`);
    if (config.selectedDsaTopics.length) parts.push(`dsa: ${config.selectedDsaTopics.join(", ")}`);
    if (config.selectedCsTopics.length) parts.push(`cs: ${config.selectedCsTopics.join(", ")}`);
    if (config.selectedGenAITopics.length) parts.push(`genai: ${config.selectedGenAITopics.join(", ")}`);
    if (config.selectedDSTopics.length) parts.push(`ds: ${config.selectedDSTopics.join(", ")}`);
    if (config.includeSql) parts.push("sql enabled");
    if (config.questionsPerTopic) parts.push(`${config.questionsPerTopic} questions/topic`);
    return parts.join(" | ");
}

export function inferQuestionModule(category: unknown): string {
    const value = String(category || "").toLowerCase();
    if (value === "coding" || value === "dsa") return "coding";
    if (value.includes("sql")) return "sql";
    if (["os", "cn", "dbms", "oops", "cs_fundamentals", "fundamentals"].some((token) => value.includes(token))) {
        return "cs_fundamentals";
    }
    if (value.includes("system_design")) return "system_design";
    if (value.includes("genai") || value.includes("gen_ai")) return "genai";
    if (value.startsWith("ds_") || value.includes("data_science")) return "data_science";
    if (value.startsWith("pm_") || value.includes("product")) return "product_management";
    if (value.includes("behav")) return "behavioural";
    if (value.includes("problem_solving")) return "problem_solving_case";
    return value || "unknown";
}
