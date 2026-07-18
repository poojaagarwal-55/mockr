import type { InterviewModuleConfig, InterviewStage, InterviewType } from "@interviewforge/shared";
import type { InterviewTypeConfig, PrefetchRequirements } from "./interview-types/base.js";
import { getInterviewTypeConfig } from "./interview-types/index.js";

const TERMINAL_STAGES = new Set<InterviewStage>(["CLOSING"]);

const STAGE_SCORE_CATEGORIES: Partial<Record<InterviewStage, string[]>> = {
    INTRO: ["communication", "product_ownership"],
    DSA: ["problem_solving", "code_quality", "speed", "communication"],
    FUNDAMENTALS: ["cs_knowledge", "sql_proficiency", "communication", "problem_solving"],
    SYSTEM_DESIGN: ["requirements_gathering", "high_level_design", "deep_dive", "scalability", "tradeoffs", "communication"],
    BEHAVIOURAL: ["communication", "leadership_and_initiative", "conflict_resolution", "adaptability", "teamwork"],
    GEN_AI_CONCEPTS: ["genai_fundamentals", "communication"],
    GEN_AI_CODING: ["ai_tool_proficiency", "problem_solving", "code_quality", "communication"],
    GEN_AI_SYSTEM_DESIGN: ["genai_system_design", "communication", "problem_solving"],
    DS_CONCEPTS: ["ds_statistics", "communication", "problem_solving"],
    DS_SQL: ["sql_proficiency", "communication", "problem_solving"],
    DS_CODING: ["data_analysis", "problem_solving", "communication"],
    DS_BUSINESS_CASE: ["business_metrics", "communication", "problem_solving"],
    PM_CASE: ["product_case_structuring", "product_metrics", "communication"],
    PM_CONCEPTS: ["product_metrics", "communication"],
    PM_STRATEGY: ["product_strategy", "communication"],
    PM_BEHAVIORAL: ["behavioral_competency", "communication", "leadership_and_initiative"],
    PROBLEM_SOLVING: ["problem_solving", "logical_reasoning", "hint_absorption", "conviction_under_pressure", "communication", "adaptability"],
    RESUME_STUDIES: ["communication"],
    RESUME_PROJECTS: ["claim_confidence", "project_ownership", "technical_depth", "impact_evidence", "ai_contribution_clarity", "follow_up_consistency", "communication"],
    RESUME_EXPERIENCE: ["experience_depth", "impact_evidence", "claim_confidence", "communication"],
    RESUME_RESPONSIBILITY: ["leadership_and_initiative", "impact_evidence", "communication"],
    RESUME_SKILLS: ["role_fit", "communication", "follow_up_consistency"],
    CLOSING: ["communication"],
};

function asStageArray(value: unknown): InterviewStage[] {
    if (!Array.isArray(value)) return [];
    return value.filter((stage): stage is InterviewStage => typeof stage === "string") as InterviewStage[];
}

function asStringArray(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const values = value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean);
    return values.length > 0 ? [...new Set(values)] : undefined;
}

function asStringArrayPreservingEmpty(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    return [...new Set(value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean))];
}

function asDifficulty(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const normalized = value.trim();
    return ["Easy", "Medium", "Hard"].includes(normalized) ? normalized : undefined;
}

function asQuestionCount(value: unknown): number | undefined {
    if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
    return Math.min(3, Math.max(1, Math.floor(value)));
}

function asDuration(value: unknown): { min: number; max: number } | undefined {
    const min = (value as any)?.min;
    const max = (value as any)?.max;
    if (typeof min !== "number" || typeof max !== "number") return undefined;
    if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max < min) return undefined;
    return { min: Math.floor(min), max: Math.floor(max) };
}

function normalizeStageOptions(
    allowedStages: Set<InterviewStage>,
    rawOptions: unknown
): InterviewModuleConfig["stageOptions"] | undefined {
    if (!rawOptions || typeof rawOptions !== "object") return undefined;

    const result: NonNullable<InterviewModuleConfig["stageOptions"]> = {};
    for (const [stageKey, rawStageOptions] of Object.entries(rawOptions as Record<string, unknown>)) {
        if (!allowedStages.has(stageKey as InterviewStage) || !rawStageOptions || typeof rawStageOptions !== "object") {
            continue;
        }

        const stage = stageKey as InterviewStage;
        const raw = rawStageOptions as Record<string, unknown>;
        const normalized = {
            topics: stage === "FUNDAMENTALS"
                ? asStringArrayPreservingEmpty(raw.topics)
                : asStringArray(raw.topics),
            subtopics: asStringArray(raw.subtopics),
            difficulty: stage === "DSA" ? asDifficulty(raw.difficulty) : undefined,
            includeSQL: typeof raw.includeSQL === "boolean" ? raw.includeSQL : undefined,
            questionCountPerTopic: asQuestionCount(raw.questionCountPerTopic),
            resumeDeepDiveEnabled: typeof raw.resumeDeepDiveEnabled === "boolean" ? raw.resumeDeepDiveEnabled : undefined,
        };

        if (Object.values(normalized).some((value) => value !== undefined)) {
            result[stage] = normalized;
        }
    }

    return Object.keys(result).length > 0 ? result : undefined;
}

function normalizeStageDurations(
    allowedStages: Set<InterviewStage>,
    rawDurations: unknown
): InterviewModuleConfig["stageDurations"] | undefined {
    if (!rawDurations || typeof rawDurations !== "object") return undefined;

    const result: NonNullable<InterviewModuleConfig["stageDurations"]> = {};
    for (const [stageKey, rawDuration] of Object.entries(rawDurations as Record<string, unknown>)) {
        if (!allowedStages.has(stageKey as InterviewStage)) continue;
        const duration = asDuration(rawDuration);
        if (duration) result[stageKey as InterviewStage] = duration;
    }

    return Object.keys(result).length > 0 ? result : undefined;
}

function getRequiredStages(interviewType: InterviewType): InterviewStage[] {
    if (interviewType === "resume_round") return ["RESUME_STUDIES"];
    if (interviewType === "pm_role") return ["PM_BEHAVIORAL"];
    return [];
}

export function normalizeInterviewModuleConfig(
    interviewType: InterviewType,
    rawConfig: unknown
): InterviewModuleConfig {
    const baseConfig = getInterviewTypeConfig(interviewType);
    if (interviewType === "resume_round") {
        return {
            version: 1,
            enabledStages: [...baseConfig.stages],
            disabledStages: [],
            source: "default",
        };
    }

    const allowedStages = new Set(baseConfig.stages);
    const rawEnabled = asStageArray((rawConfig as any)?.enabledStages);
    const requested = rawEnabled.filter((stage) => allowedStages.has(stage));
    const requiredStages = getRequiredStages(interviewType).filter((stage) => allowedStages.has(stage));
    const requestedWithRequired = requested.length > 0
        ? [...requested, ...requiredStages.filter((stage) => !requested.includes(stage))]
        : requested;

    const enabledStages = requestedWithRequired.length > 0
        ? baseConfig.stages.filter((stage) => requestedWithRequired.includes(stage))
        : [...baseConfig.stages];

    const nonTerminal = enabledStages.filter((stage) => !TERMINAL_STAGES.has(stage));
    const finalStages = baseConfig.stages.filter((stage) => TERMINAL_STAGES.has(stage));

    const normalized = requested.length > 0 && nonTerminal.length === 0
        ? enabledStages
        : nonTerminal.length > 0
        ? [
            ...nonTerminal,
            ...finalStages.filter((stage) => !nonTerminal.includes(stage)),
        ]
        : [...baseConfig.stages];

    const deduped = normalized.filter((stage, index) => normalized.indexOf(stage) === index);

    const stageOptions = normalizeStageOptions(allowedStages, (rawConfig as any)?.stageOptions);
    const stageDurations = normalizeStageDurations(allowedStages, (rawConfig as any)?.stageDurations);

    return {
        version: 1,
        enabledStages: deduped,
        disabledStages: baseConfig.stages.filter((stage) => !deduped.includes(stage)),
        source: requested.length > 0 || stageOptions || stageDurations ? "custom" : "default",
        ...(stageOptions ? { stageOptions } : {}),
        ...(stageDurations ? { stageDurations } : {}),
    };
}

export function getNextEnabledStage(
    stageOrder: InterviewStage[],
    currentStage: InterviewStage
): InterviewStage | undefined {
    const idx = stageOrder.indexOf(currentStage);
    return idx >= 0 ? stageOrder[idx + 1] : undefined;
}

function buildPrefetchRequirements(
    type: InterviewType,
    stages: InterviewStage[],
    moduleConfig: InterviewModuleConfig
): PrefetchRequirements {
    const includes = (stage: InterviewStage) => stages.includes(stage);
    const fundamentalsOptions = moduleConfig.stageOptions?.FUNDAMENTALS || {};
    const includeFundamentalsSQL = fundamentalsOptions.includeSQL !== false;
    const hasFundamentalsTheory = Array.isArray(fundamentalsOptions.topics)
        ? fundamentalsOptions.topics.length > 0
        : true;

    return {
        requiresResume:
            type === "resume_round" ||
            (includes("INTRO") &&
                (type === "full_interview" || type === "system_design" || type === "gen_ai_role" || type === "data_science_role" || type === "pm_role")),
        requiresDSAQuestion: includes("DSA"),
        requiresCSQuestions: includes("FUNDAMENTALS") && hasFundamentalsTheory,
        requiresSQLQuestion: includes("FUNDAMENTALS") && includeFundamentalsSQL,
        requiresSDQuestion: includes("SYSTEM_DESIGN"),
        requiresBehavioralQuestions: false,
        requiresGenAIConceptQuestions: includes("GEN_AI_CONCEPTS"),
        requiresGenAICodingQuestion: includes("GEN_AI_CODING"),
        requiresGenAISystemDesignQuestion: includes("GEN_AI_SYSTEM_DESIGN"),
        requiresGenAIEthicsQuestion: false,
        requiresDSConceptQuestions: includes("DS_CONCEPTS"),
        requiresDSSQLQuestion: includes("DS_SQL"),
        requiresDSCodingQuestion: includes("DS_CODING"),
        requiresPMCaseQuestion: includes("PM_CASE"),
        requiresPMConceptQuestions: includes("PM_CONCEPTS"),
        requiresPMStrategyQuestion: includes("PM_STRATEGY"),
        requiresProblemSolvingCaseQuestion: includes("PROBLEM_SOLVING"),
    };
}

export function resolveEffectiveInterviewTypeConfig(
    interviewType: InterviewType,
    rawModuleConfig: unknown
): InterviewTypeConfig {
    const baseConfig = getInterviewTypeConfig(interviewType);
    const moduleConfig = normalizeInterviewModuleConfig(interviewType, rawModuleConfig);
    const stages = moduleConfig.enabledStages;
    const stageSet = new Set(stages);

    const scoringCategories = baseConfig.scoringCategories.filter((category) => (
        stages.some((stage) => (STAGE_SCORE_CATEGORIES[stage] || []).includes(category))
    ));

    return {
        ...baseConfig,
        stages,
        stageDurations: Object.fromEntries(
            Object.entries(baseConfig.stageDurations)
                .filter(([stage]) => stageSet.has(stage as InterviewStage))
                .map(([stage, duration]) => [
                    stage,
                    moduleConfig.stageDurations?.[stage as InterviewStage] || duration,
                ])
        ) as InterviewTypeConfig["stageDurations"],
        stageTools: Object.fromEntries(
            Object.entries(baseConfig.stageTools).filter(([stage]) => stageSet.has(stage as InterviewStage))
        ) as InterviewTypeConfig["stageTools"],
        stagePrompts: Object.fromEntries(
            Object.entries(baseConfig.stagePrompts).filter(([stage]) => stageSet.has(stage as InterviewStage))
        ) as InterviewTypeConfig["stagePrompts"],
        scoringCategories: scoringCategories.length > 0 ? scoringCategories : baseConfig.scoringCategories,
        compatibilityManifest: {
            prefetchRequirements: buildPrefetchRequirements(interviewType, stages, moduleConfig),
            stageContracts: Object.fromEntries(
                stages.map((stage) => [
                    stage,
                    baseConfig.compatibilityManifest?.stageContracts?.[stage] || { stage },
                ])
            ),
            toolDependencies: Object.fromEntries(
                stages.map((stage) => [
                    stage,
                    (baseConfig.stageTools[stage] || []).map((toolName) => ({ toolName })),
                ])
            ),
            forbiddenSequences: baseConfig.compatibilityManifest?.forbiddenSequences || [],
            modeSupport: baseConfig.compatibilityManifest?.modeSupport || {
                textSupported: true,
                voiceSupported: true,
            },
        },
    };
}
