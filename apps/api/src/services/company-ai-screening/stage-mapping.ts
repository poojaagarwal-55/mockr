import type { InterviewModuleConfig, InterviewStage } from "@interviewforge/shared";
import type { ScreeningBlueprint, ScreeningPhaseType } from "./blueprint.js";

/**
 * Maps each recruiter-composed screening phase to the practice InterviewStage that
 * runs its behaviour. This is the bridge that lets company screening reuse the tested
 * per-phase stage prompts/tools through the existing composition engine, instead of
 * flattening every phase into one BEHAVIOURAL directive.
 *
 * `null` = no stage yet (frontend_coding needs the Sandpack modality — deferred).
 * resume_project maps to INTRO but is driven by the company server resume agenda, not
 * the practice intro handoff.
 *
 * NOTE on collisions: cs_sql and cs_theory both map to FUNDAMENTALS, and behavioral +
 * custom both map to BEHAVIOURAL. A single screen almost never contains both members of
 * a colliding pair, but blueprintToModuleConfig de-dupes stages defensively so the
 * composed stage order is always valid. (A dedicated cs_theory stage is a later split.)
 */
export const PHASE_TO_STAGE: Record<ScreeningPhaseType, InterviewStage | null> = {
    resume_project: "INTRO",
    coding: "DSA",
    cs_sql: "FUNDAMENTALS",
    cs_theory: "FUNDAMENTALS",
    system_design: "SYSTEM_DESIGN",
    frontend_coding: null,
    ds_sql: "DS_SQL",
    ds_coding: "DS_CODING",
    ds_concepts: "DS_CONCEPTS",
    ds_business_case: "DS_BUSINESS_CASE",
    genai_coding: "GEN_AI_CODING",
    genai_concepts: "GEN_AI_CONCEPTS",
    // genai_system_design has NO real modality (no practice GEN_AI_SYSTEM_DESIGN stage
    // exists) — it is intentionally unmapped and never composed into the flow.
    genai_system_design: null,
    pm_case: "PM_CASE",
    pm_concepts: "PM_CONCEPTS",
    pm_strategy: "PM_STRATEGY",
    problem_solving: "PROBLEM_SOLVING",
    behavioral: "BEHAVIOURAL",
    custom: "BEHAVIOURAL",
};

/** The stage a phase runs as, or null if that phase type has no stage yet. */
export function stageForPhaseType(type: ScreeningPhaseType): InterviewStage | null {
    return PHASE_TO_STAGE[type] ?? null;
}

export type BlueprintModuleConfig = {
    /** The InterviewModuleConfig the composition engine consumes (recruiter's phases as stages). */
    moduleConfig: InterviewModuleConfig;
    /** stage -> the blueprint phase id that owns it (for prefetch routing + pacing pointer). */
    stageToPhaseId: Partial<Record<InterviewStage, string>>;
    /** Phase types that had no stage mapping and were skipped (e.g. frontend_coding). */
    unmapped: ScreeningPhaseType[];
};

/**
 * Turns a recruiter blueprint into a real InterviewModuleConfig: the recruiter's phases
 * become `enabledStages` in order, with per-stage durations from the phase minutes, and
 * CLOSING appended as the terminal stage. Replaces the flatten-to-single-BEHAVIOURAL hack
 * (routes/jobs.ts) so the interview runs the recruiter's exact permutation as real stages.
 *
 * Pure and side-effect free — safe to unit test and to call at session init.
 */
export function blueprintToModuleConfig(blueprint: ScreeningBlueprint): BlueprintModuleConfig {
    const enabledStages: InterviewStage[] = [];
    const stageDurations: NonNullable<InterviewModuleConfig["stageDurations"]> = {};
    const stageToPhaseId: Partial<Record<InterviewStage, string>> = {};
    const unmapped: ScreeningPhaseType[] = [];
    const seen = new Set<InterviewStage>();

    for (const phase of blueprint.phases || []) {
        const stage = stageForPhaseType(phase.type);
        if (!stage) {
            unmapped.push(phase.type);
            continue;
        }
        if (seen.has(stage)) continue; // dedupe stage collisions (cs_sql+cs_theory, behavioral+custom)
        seen.add(stage);
        enabledStages.push(stage);
        const mins = Math.max(1, Math.round(Number(phase.durationMinutes) || 1));
        stageDurations[stage] = { min: mins, max: mins };
        stageToPhaseId[stage] = phase.id;
    }

    // CLOSING is always terminal — the server-driven pacing pointer advances into it
    // when the overall time/coverage budget is spent.
    if (!enabledStages.includes("CLOSING")) enabledStages.push("CLOSING");

    return {
        moduleConfig: { version: 1, enabledStages, source: "custom", stageDurations },
        stageToPhaseId,
        unmapped,
    };
}
