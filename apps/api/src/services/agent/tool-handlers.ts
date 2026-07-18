// ============================================
// AI Interview Agent — Tool Execution Handlers
// ============================================
// Handles the actual execution when the AI agent calls a tool.
// Each handler interacts with the database, emits WebSocket events,
// or delegates to external services.
// Now type-aware: transition_stage validates against the interview
// type's stage order instead of a global constant.

import { prisma } from "../../lib/prisma.js";
import { LANGUAGE_MAP, MAX_HINTS_PER_QUESTION } from "@interviewforge/shared";
import type { InterviewStage } from "@interviewforge/shared";
import type { ToolContext } from "./agent-tools.js";
import type { ResumeAgendaQuestionIntent, ResumeProbeAnswerQuality, ResumeProbeDepth, ResumeProbeState } from "./interview-runtime-types.js";
import {
    createInitialResumeProbeState,
    makeResumeProbeKey,
    nextResumeProbeDepth,
    normalizeProbeProjectName,
    RESUME_PROBE_DEPTH_ORDER,
} from "./resume-probe-state.js";
import {
    getActiveResumeAgendaItem,
    mapResumeDepthToAgendaIntent,
    updateResumeAgendaAfterProbe,
} from "./resume-agenda-state.js";
import { generateReport } from "../report-generator.js";
import { updateStreakForUser } from "../streak-service.js";
import { settleInterviewMinuteReservation } from "../entitlements.js";
import * as fs from "fs";
import * as path from "path";
import { addAskedQuestion } from "../../lib/redis.js";
import { warmSqlCache } from "../sql-execution.js";
import {
    validateEndInterview,
    validateStageTransition,
} from "./interview-state-machine.js";
import {
    validateToolArgs,
    type ToolName,
} from "./tool-args-schema.js";
import {
    recordToolCall,
    validateToolCallSequence,
} from "./tool-call-sequencer.js";
import { recordQuestionExposure, type QuestionSource } from "../question-exposure.js";
import {
    bankQuestionIdForScreeningQuestion,
    collectScreeningBankRefs,
} from "../company-ai-screening/question-prefetch.js";

function exposureSourceForRecordedQuestion(ctx: ToolContext, questionId: string): QuestionSource {
    if (ctx.prefetchedGenAIConceptQuestions?.some((q: any) => q.questionId === questionId)) return "genai_concept";
    if (ctx.prefetchedDSConceptQuestions?.some((q: any) => q.questionId === questionId)) return "ds_concept";
    if (ctx.prefetchedPMConceptQuestions?.some((q: any) => q.questionId === questionId)) return "pm_concept";
    if (ctx.prefetchedPMCaseQuestion?.questionId === questionId) return "pm_case";
    if (ctx.prefetchedPMStrategyQuestion?.questionId === questionId) return "pm_strategy";
    return "cs_fundamental";
}

export async function handleToolCall(
    toolName: ToolName,
    args: any,
    ctx: ToolContext
): Promise<string> {
    const validation = validateToolArgs(toolName, args);
    if (validation.success === false) {
        logToolCall(toolName, args, new Error(validation.message));
        return validation.message;
    }

    const safeArgs = validation.data;

    const screeningBankRefCount = ctx.companyScreeningBlueprint
        ? collectScreeningBankRefs(ctx.companyScreeningBlueprint).length
        : 0;
    const sequenceValidation = validateToolCallSequence(toolName, safeArgs, {
        sessionId: ctx.sessionId,
        interviewType: ctx.interviewType,
        currentStage: ctx.currentStage,
        stageOrder: ctx.stageOrder,
        lastFetchedQuestionId: ctx.lastFetchedQuestionId,
        prefetchedDSAQuestion: ctx.prefetchedDSAQuestion,
        prefetchedGenAICodingQuestion: (ctx as any).prefetchedGenAICodingQuestion ?? null,
        prefetchedDSSQLQuestion: (ctx as any).prefetchedDSSQLQuestion ?? null,
        prefetchedDSCodingQuestion: (ctx as any).prefetchedDSCodingQuestion ?? null,
        cachedQuestionData: ctx.cachedQuestionData,
        companyScreening: Boolean(ctx.companyScreeningBlueprint),
        companyScreeningHasBankQuestions: screeningBankRefCount > 0,
        companyScreeningCurrentQuestionId: ctx.companyScreeningCurrentQuestionId ?? null,
        companyScreeningCurrentPhaseType: ctx.companyScreeningCurrentPhaseType ?? null,
    });

    if (!sequenceValidation.valid) {
        logToolCall(toolName, args, new Error(sequenceValidation.message || "Tool sequence validation failed."));
        return sequenceValidation.message || "Tool sequence validation failed.";
    }

    let result: string;

    switch (toolName) {
        case "fetch_question":
            result = await handleFetchQuestion(safeArgs as { category: string; difficulty?: string }, ctx);
            break;
        case "open_ide":
            result = await handleOpenIDE(safeArgs as { questionId: string; language: string }, ctx);
            break;
        case "open_sql_editor":
            result = await handleOpenSQLEditor(safeArgs as {}, ctx);
            break;
        case "open_scratchpad":
            result = await handleOpenScratchpad(safeArgs as { topic: string; initialContent: string }, ctx);
            break;
        case "open_notepad":
            result = handleOpenNotepad(safeArgs as { topic: string; template: "CIRCLES" | "blank"; scenario?: string }, ctx);
            break;
        case "close_panel":
            result = handleClosePanel(safeArgs as { summary: string }, ctx);
            break;
        case "run_candidate_code":
            result = await handleRunCode(safeArgs as { language: string; code: string; questionId: string }, ctx);
            break;
        case "give_hint":
            result = await handleGiveHint(safeArgs as { questionId: string; hintNumber: number }, ctx);
            break;
        case "transition_stage":
            result = await handleTransitionStage(safeArgs as { nextStage: string; reason: string }, ctx);
            break;
        case "end_interview":
            result = await handleEndInterview(safeArgs as { summary: string }, ctx);
            break;
        case "record_question":
            result = await handleRecordQuestion(safeArgs as { questionFundamentalId: string; questionTitle: string; referenceAnswer?: string }, ctx);
            break;
        case "record_screening_question":
            result = handleRecordScreeningQuestion(safeArgs as { questionId: string }, ctx);
            break;
        case "open_screening_workspace":
            result = await handleOpenScreeningWorkspace(safeArgs as { questionId: string }, ctx);
            break;
        case "record_resume_probe":
            result = handleRecordResumeProbe(safeArgs as {
                projectName?: string;
                agendaItemId?: string;
                depth: ResumeProbeDepth;
                intent?: ResumeAgendaQuestionIntent;
                answerQuality: ResumeProbeAnswerQuality;
                evidence: string;
                shouldCloseItem?: boolean;
                componentKey?: string;
            }, ctx);
            break;
        default:
            result = `Unknown tool: ${toolName}`;
            break;
    }

    recordToolCall(ctx.sessionId, toolName);
    return result;
}

const DEEP_RESUME_PROBE_DEPTHS = new Set<ResumeProbeDepth>([
    "implementation",
    "tradeoffs",
    "failure_depth",
    "senior_depth",
]);

const GENAI_INTRO_EXIT_DEPTHS = new Set<ResumeProbeDepth>([
    "ownership",
    "implementation",
    "tradeoffs",
    "failure_depth",
    "senior_depth",
]);

const FULL_INTERVIEW_INTRO_EXIT_DEPTHS = new Set<ResumeProbeDepth>([
    "tradeoffs",
    "failure_depth",
    "senior_depth",
]);

const DATA_SCIENCE_INTRO_EXIT_DEPTHS = new Set<ResumeProbeDepth>([
    "implementation",
    "tradeoffs",
    "failure_depth",
    "senior_depth",
]);

const SYSTEM_DESIGN_INTRO_MIN_EXCHANGES = 3;

function normalizeEvidenceText(value: string): string {
    return value
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s._:-]+/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function looksLikeRefusalEvidence(evidence: string): boolean {
    return /\b(no|nope|don'?t know|do not know|not sure|can'?t explain|cannot explain|don'?t remember|skip|move on|not my part|not done by me)\b/i.test(evidence);
}

function hasConcreteResumeEvidenceSignal(evidence: string): boolean {
    return /\b(implemented|built|owned|designed|debugged|deployed|tested|verified|integrated|configured|stored|persisted|emitted|streamed|socket|websocket|api|endpoint|database|schema|query|cache|queue|worker|pipeline|model|rag|embedding|bucket|redis|postgres|mongodb|fastify|nextjs|react|monaco|gemini|openai|deepgram|latency|failure|tradeoff|guardrail|state|event|listener|prioritized|prioritised|roadmap|metric|metrics|north\s*star|activation|retention|churn|conversion|adoption|engagement|revenue|experiment|a\/b|ab\s*test|launch|rollout|stakeholder|customer|user\s+segment|persona|backlog|scope|mvp|go[- ]to[- ]market|gtm|pricing|funnel|cohort|hypothesis|success\s+criteria|kpi|okr)\b/i.test(evidence);
}

function clampResumeProbeQuality(
    requested: ResumeProbeAnswerQuality,
    evidence: string,
    options: { duplicateDepth: boolean; depthJumpClamped: boolean; deepCapBlocked: boolean }
): { quality: ResumeProbeAnswerQuality; reasons: string[] } {
    const normalized = normalizeEvidenceText(evidence);
    const reasons: string[] = [];
    let quality = requested;

    if (normalized.length < 25 || looksLikeRefusalEvidence(normalized)) {
        quality = "weak";
        reasons.push("evidence was too thin or looked like a refusal");
    } else if (quality === "strong" && normalized.length < 80) {
        quality = "partial";
        reasons.push("strong answerQuality downgraded because evidence was short");
    } else if (quality === "strong" && !hasConcreteResumeEvidenceSignal(normalized)) {
        quality = "partial";
        reasons.push("strong answerQuality downgraded because evidence lacked concrete implementation, ownership, or product signal");
    }

    if (options.duplicateDepth && quality === "strong") {
        quality = "partial";
        reasons.push("duplicate project-depth pair cannot advance as strong evidence");
    }

    if (options.depthJumpClamped && quality === "strong") {
        quality = "partial";
        reasons.push("depth jump was clamped, so evidence cannot advance strongly this turn");
    }

    if (options.deepCapBlocked) {
        quality = quality === "weak" ? "weak" : "partial";
        reasons.push("deep-project cap blocked this probe from counting as a new deep dive");
    }

    return { quality, reasons };
}

function clampResumeProbeDepth(
    requested: ResumeProbeDepth,
    previous: ResumeProbeState
): { depth: ResumeProbeDepth; clamped: boolean; reason?: string } {
    const allowedDepth = previous.currentDepth || "overview";
    const requestedIdx = RESUME_PROBE_DEPTH_ORDER.indexOf(requested);
    const allowedIdx = RESUME_PROBE_DEPTH_ORDER.indexOf(allowedDepth);

    if (requestedIdx < 0 || allowedIdx < 0) {
        return { depth: allowedDepth, clamped: requested !== allowedDepth, reason: "unknown depth" };
    }

    if (requestedIdx > allowedIdx) {
        return {
            depth: allowedDepth,
            clamped: true,
            reason: `requested depth ${requested} was deeper than allowed depth ${allowedDepth}`,
        };
    }

    return { depth: requested, clamped: false };
}

function getDeepProjectKeys(askedProbeKeys: Set<string>): Set<string> {
    const deepProjects = new Set<string>();
    for (const key of askedProbeKeys) {
        const [projectKey, depth] = key.split("::");
        if (!projectKey || !depth || projectKey === "unknown") continue;
        if (DEEP_RESUME_PROBE_DEPTHS.has(depth as ResumeProbeDepth)) {
            deepProjects.add(projectKey);
        }
    }
    return deepProjects;
}

function getProjectProbeCount(askedProbeKeys: Set<string>, projectKey: string): number {
    if (projectKey === "unknown") return 0;
    let count = 0;
    for (const key of askedProbeKeys) {
        const [rawProject] = key.split("::");
        if (rawProject === projectKey) count += 1;
    }
    return count;
}

function isOptionalThirdDeepProjectAllowed(ctx: ToolContext, requestedQuality: ResumeProbeAnswerQuality): boolean {
    if (ctx.interviewType !== "resume_round" || ctx.currentStage !== "RESUME_PROJECTS") return false;
    const projectCount = Array.isArray(ctx.resumeSummary?.projects) ? ctx.resumeSummary.projects.length : 0;
    if (projectCount < 3 || requestedQuality !== "strong") return false;

    const stageStartedAtMs = typeof ctx.stageStartedAtMs === "number" ? ctx.stageStartedAtMs : Date.now();
    const maxMinutes = ctx.moduleConfig?.stageDurations?.RESUME_PROJECTS?.max;
    const maxSec = (typeof maxMinutes === "number" ? maxMinutes : 18) * 60;
    const elapsedSec = Math.max(0, Math.floor((Date.now() - stageStartedAtMs) / 1000));
    return elapsedSec < Math.floor(maxSec * 0.55);
}

function getRecordedResumeProbeDepths(state?: ResumeProbeState): ResumeProbeDepth[] {
    const depths = new Set<ResumeProbeDepth>();
    for (const depth of state?.completedDepths || []) depths.add(depth);
    if (state?.lastAskedDepth) depths.add(state.lastAskedDepth);
    for (const key of state?.askedProbeKeys || []) {
        const depth = key.split("::")[1] as ResumeProbeDepth | undefined;
        if (depth && RESUME_PROBE_DEPTH_ORDER.includes(depth)) depths.add(depth);
    }
    return [...depths];
}

function getStrongResumeProbeDepths(state?: ResumeProbeState): ResumeProbeDepth[] {
    const depths = new Set<ResumeProbeDepth>();
    for (const depth of state?.completedDepths || []) depths.add(depth);
    return [...depths];
}

function getResumeProbeCount(state?: ResumeProbeState): number {
    return new Set(state?.askedProbeKeys || []).size;
}

function hasAnyDepth(depths: ResumeProbeDepth[], required: Set<ResumeProbeDepth>): boolean {
    return depths.some((depth) => required.has(depth));
}

function validateFullInterviewIntroExit(ctx: ToolContext, nextStage: InterviewStage): string | null {
    if (ctx.interviewType !== "full_interview" || ctx.currentStage !== "INTRO" || nextStage !== "DSA") {
        return null;
    }

    const state = ctx.resumeProbeState;
    const probeCount = getResumeProbeCount(state);
    const askedDepths = getRecordedResumeProbeDepths(state);
    const strongDepths = getStrongResumeProbeDepths(state);
    const repeatedNonEngagement = (state?.consecutiveWeakAnswers || 0) >= 2 && probeCount >= 2;
    const hasImplementation = strongDepths.includes("implementation") || askedDepths.includes("implementation");
    const hasTradeoffOrScale = hasAnyDepth(askedDepths, FULL_INTERVIEW_INTRO_EXIT_DEPTHS);

    if (repeatedNonEngagement) return null;
    if (probeCount >= 4 && hasImplementation && hasTradeoffOrScale) return null;

    return [
        "CANNOT transition out of the Full Interview resume/project introduction yet.",
        `Recorded probes: ${probeCount}; recorded depths: ${askedDepths.join(", ") || "none"}; strong depths: ${strongDepths.join(", ") || "none"}.`,
        "Before moving to live coding, ask one concrete engineering depth probe tied to the candidate's strongest project.",
        "The missing probe should cover tradeoffs, failure/debugging, or scalability/production concerns such as latency, reliability, bottlenecks, cost, queues, caching, WebSocket scaling, or persistence.",
        "Call record_resume_probe silently after the candidate answers. If the candidate repeatedly refuses or gives no usable answer, then transition forward.",
    ].join(" ");
}

function validateGenAIIntroExit(ctx: ToolContext, nextStage: InterviewStage): string | null {
    if (ctx.interviewType !== "gen_ai_role" || ctx.currentStage !== "INTRO" || nextStage !== "GEN_AI_CONCEPTS") {
        return null;
    }

    const state = ctx.resumeProbeState;
    const probeCount = getResumeProbeCount(state);
    const depths = getRecordedResumeProbeDepths(state);
    const hasOwnershipDepth = depths.some((depth) => GENAI_INTRO_EXIT_DEPTHS.has(depth));
    const hasImplementationDepth = depths.some((depth) => DEEP_RESUME_PROBE_DEPTHS.has(depth));
    const repeatedNonEngagement = (state?.consecutiveWeakAnswers || 0) >= 2 && probeCount >= 2;

    if (repeatedNonEngagement) return null;
    if (probeCount >= 4 && hasOwnershipDepth && hasImplementationDepth) return null;

    return [
        "CANNOT transition out of the GenAI resume deep-dive yet.",
        `Recorded probes: ${probeCount}; recorded depths: ${depths.join(", ") || "none"}.`,
        "Before moving on, ask concrete GenAI ownership and implementation probes tied to the candidate's project:",
        "what model/service they used, what they personally built, architecture/data flow, evaluation, and hallucination/cost/latency tradeoffs.",
        "Call record_resume_probe silently after each candidate answer. Only transition after at least 4 recorded probes including ownership and implementation/tradeoff depth, or after repeated non-engagement.",
    ].join(" ");
}

function validateDataScienceIntroExit(ctx: ToolContext, nextStage: InterviewStage): string | null {
    const dataScienceStages = new Set<InterviewStage>(["DS_CONCEPTS", "DS_SQL", "DS_CODING", "DS_BUSINESS_CASE"]);
    if (ctx.interviewType !== "data_science_role" || ctx.currentStage !== "INTRO" || !dataScienceStages.has(nextStage)) {
        return null;
    }

    const state = ctx.resumeProbeState;
    const probeCount = getResumeProbeCount(state);
    const depths = getRecordedResumeProbeDepths(state);
    const repeatedNonEngagement = (state?.consecutiveWeakAnswers || 0) >= 2 && probeCount >= 2;
    const hasOwnershipOrMotivation = depths.includes("ownership") || depths.includes("motivation");
    const hasDataImplementationDepth = hasAnyDepth(depths, DATA_SCIENCE_INTRO_EXIT_DEPTHS);

    if (repeatedNonEngagement) return null;
    if (probeCount >= 4 && hasOwnershipOrMotivation && hasDataImplementationDepth) return null;

    return [
        "CANNOT transition out of the Data Science resume deep-dive yet.",
        `Recorded probes: ${probeCount}; recorded depths: ${depths.join(", ") || "none"}.`,
        "Before leaving the Data Science resume intro, ask a data-science-specific resume probe tied to the candidate's project:",
        "data source/quality, feature engineering, baseline vs model choice, validation metrics, experiment design, business metric, model failure, or production/data drift tradeoffs.",
        "Do not ask generic software-project trivia here. Call record_resume_probe silently after the candidate answers, or transition if the candidate repeatedly refuses.",
    ].join(" ");
}

function validateSystemDesignIntroExit(ctx: ToolContext, nextStage: InterviewStage): string | null {
    if (ctx.interviewType !== "system_design" || ctx.currentStage !== "INTRO" || nextStage !== "SYSTEM_DESIGN") {
        return null;
    }

    const introCount = ctx.introExchangeCount ?? 0;
    if (introCount >= SYSTEM_DESIGN_INTRO_MIN_EXCHANGES) return null;

    return [
        "CANNOT transition out of the System Design background calibration yet.",
        `Recorded intro exchanges: ${introCount}/${SYSTEM_DESIGN_INTRO_MIN_EXCHANGES}.`,
        "Ask another concise architecture/scale/tradeoff calibration question tied to the candidate's background.",
        "Do not introduce the design problem, whiteboard, or scratchpad until the server-owned intro counter reaches the minimum.",
    ].join(" ");
}

function handleRecordResumeProbe(
    args: {
        projectName?: string;
        agendaItemId?: string;
        depth: ResumeProbeDepth;
        intent?: ResumeAgendaQuestionIntent;
        answerQuality: ResumeProbeAnswerQuality;
        evidence: string;
        shouldCloseItem?: boolean;
        componentKey?: string;
    },
    ctx: ToolContext
): string {
    const previous = ctx.resumeProbeState || createInitialResumeProbeState();

    const completedDepths = new Set<ResumeProbeDepth>(previous.completedDepths || []);
    const askedProbeKeys = new Set(previous.askedProbeKeys || []);
    const saturatedProjects = new Set(previous.saturatedProjects || []);
    const projectName = args.projectName || previous.activeProjectName;
    const depthAudit = clampResumeProbeDepth(args.depth, previous);
    const auditedDepth = depthAudit.depth;
    const probeKey = makeResumeProbeKey(projectName, auditedDepth);
    const duplicateDepth = askedProbeKeys.has(probeKey);
    const projectKey = normalizeProbeProjectName(projectName);
    const deepProjectKeysBefore = getDeepProjectKeys(askedProbeKeys);
    const projectProbeCountBefore = getProjectProbeCount(askedProbeKeys, projectKey);
    const isNewDeepProject =
        projectKey !== "unknown" &&
        DEEP_RESUME_PROBE_DEPTHS.has(auditedDepth) &&
        !deepProjectKeysBefore.has(projectKey);
    const deepCapBlocked =
        ctx.interviewType === "resume_round" &&
        ctx.currentStage === "RESUME_PROJECTS" &&
        isNewDeepProject &&
        deepProjectKeysBefore.size >= 2 &&
        !isOptionalThirdDeepProjectAllowed(ctx, args.answerQuality);
    const qualityAudit = clampResumeProbeQuality(args.answerQuality, args.evidence, {
        duplicateDepth,
        depthJumpClamped: depthAudit.clamped,
        deepCapBlocked,
    });
    const auditedQuality = qualityAudit.quality;
    askedProbeKeys.add(probeKey);
    let currentDepth = previous.currentDepth || "overview";
    let consecutiveWeakAnswers = previous.consecutiveWeakAnswers || 0;

    if (auditedQuality === "strong" && !duplicateDepth && !deepCapBlocked) {
        completedDepths.add(auditedDepth);
        currentDepth = nextResumeProbeDepth(auditedDepth);
        consecutiveWeakAnswers = 0;
    } else if (auditedQuality === "partial") {
        currentDepth = auditedDepth;
        consecutiveWeakAnswers = 0;
    } else {
        currentDepth = auditedDepth;
        consecutiveWeakAnswers += 1;
        if (projectName && consecutiveWeakAnswers >= 2) {
            saturatedProjects.add(projectName);
        }
    }

    const shouldSaturateResumeProject =
        ctx.interviewType === "resume_round" &&
        ctx.currentStage === "RESUME_PROJECTS" &&
        !!projectName &&
        (
            (duplicateDepth && DEEP_RESUME_PROBE_DEPTHS.has(auditedDepth)) ||
            projectProbeCountBefore >= 5 ||
            (auditedQuality === "strong" && auditedDepth === "senior_depth")
        );
    if (shouldSaturateResumeProject) {
        saturatedProjects.add(projectName);
    }

    const updated: ResumeProbeState = {
        activeProjectName: projectName,
        currentDepth,
        lastAnswerQuality: auditedQuality,
        lastAskedProjectName: projectName,
        lastAskedDepth: auditedDepth,
        consecutiveWeakAnswers,
        completedDepths: [...completedDepths],
        askedProbeKeys: [...askedProbeKeys],
        saturatedProjects: [...saturatedProjects],
    };

    ctx.onResumeProbeRecorded?.(updated);
    const appliedState = updated;
    ctx.resumeProbeState = appliedState;

    const agendaIntent = args.intent || mapResumeDepthToAgendaIntent(auditedDepth);
    const activeAgendaItem = getActiveResumeAgendaItem(ctx.resumeAgendaState);
    const agendaItemId =
        ctx.interviewType === "resume_round"
            ? activeAgendaItem?.id
            : args.agendaItemId;
    const staleAgendaItemIdIgnored = Boolean(args.agendaItemId && agendaItemId && args.agendaItemId !== agendaItemId);
    const previousAgendaActiveItemId = ctx.resumeAgendaState?.activeItemId;
    const agendaAnswerQuality = args.answerQuality === "declined" ? "declined" : auditedQuality;
    const agendaState = updateResumeAgendaAfterProbe(ctx.resumeAgendaState, {
        agendaItemId,
        intent: agendaIntent,
        answerQuality: agendaAnswerQuality,
        shouldCloseItem: Boolean(args.shouldCloseItem || shouldSaturateResumeProject),
        componentKey: args.componentKey,
    });
    if (agendaState) {
        ctx.resumeAgendaState = agendaState;
        ctx.onResumeAgendaRecorded?.(agendaState);
    }

    const activeAgendaLabel = agendaState?.items.find((item) => item.id === agendaState.activeItemId)?.label;
    const agendaClosedOrAdvanced = Boolean(agendaState && agendaState.activeItemId !== previousAgendaActiveItemId);
    const guidance =
        agendaClosedOrAdvanced
            ? activeAgendaLabel
                ? `The previous resume agenda item is closed. Ask next only about: ${activeAgendaLabel}. Do not return to the closed item.`
                : "The resume agenda is complete. Close the interview now and do not ask another resume question."
        :
        shouldSaturateResumeProject
            ? "This project is saturated for the resume-screening budget. Pivot to another project, rapid risk scan, or the next resume section. Do not ask another follow-up on this same component."
            : auditedQuality === "strong"
            ? `You may increase to ${appliedState.currentDepth}.`
            : auditedQuality === "partial"
                ? `Stay at ${appliedState.currentDepth} and ask one clarifying question.`
                : `Do not increase difficulty. Ask an easier ${appliedState.currentDepth} question or pivot if weak answers continue.`;
    const auditReasons = [
        ...(depthAudit.reason ? [depthAudit.reason] : []),
        ...qualityAudit.reasons,
        ...(duplicateDepth ? ["duplicate project-depth pair was recorded as clarifier-only"] : []),
        ...(shouldSaturateResumeProject ? ["resume project reached saturation; pivot required"] : []),
        ...(staleAgendaItemIdIgnored ? ["stale resume agenda item id was ignored; server active item was used"] : []),
    ];

    return JSON.stringify({
        ok: true,
        resumeProbeState: appliedState,
        resumeAgendaState: agendaState,
        audit: {
            requestedDepth: args.depth,
            appliedDepth: auditedDepth,
            appliedAgendaIntent: agendaIntent,
            requestedAnswerQuality: args.answerQuality,
            appliedAnswerQuality: auditedQuality,
            duplicateDepth,
            deepCapBlocked,
            reasons: auditReasons,
        },
        guidance,
    });
}

function logToolCall(name: string, args: any, result: string | Error) {
    try {
        const logPath = path.join(process.cwd(), "tool-calls.log");
        const logEntry = `[${new Date().toISOString()}] TOOL: ${name}\nARGS: ${JSON.stringify(args)}\nRESULT: ${result instanceof Error ? result.message : "Success"}\n\n`;
        fs.appendFileSync(logPath, logEntry);
    } catch (e) {
        console.error("Failed to write tool log", e);
    }
}

// ── Fetch Question ───────────────────────────────────────────

async function handleFetchQuestion(
    args: { category: string; difficulty?: string },
    ctx: ToolContext
): Promise<string> {
    // Determine difficulty based on level if not specified
    const difficultyMap: Record<string, string[]> = {
        SDE1: ["Easy", "Medium"],
        SDE2: ["Medium", "Hard"],
        "Senior SDE": ["Medium", "Hard"],
        "Staff Engineer": ["Hard"],
    };
    const difficulties = args.difficulty
        ? [args.difficulty.charAt(0).toUpperCase() + args.difficulty.slice(1).toLowerCase()]
        : difficultyMap[ctx.level] || ["Medium"];

    // Normalize category aliases used by different prompts/models.
    const rawCategory = (args.category || "").trim();
    const normalizedCategoryMap: Record<string, string> = {
        dsa: "DSA",
        sql: "SQL",
        sql_query: "SQL",
        "system design": "SystemDesign",
        system_design: "SystemDesign",
        systemdesign: "SystemDesign",
        dbms: "DBMS",
        os: "OS",
        cn: "CN",
        networking: "CN",
        oop: "OOPS",
        oops: "OOPS",
        behavioral: "Behavioral",
        behavioural: "Behavioral",
    };
    const category = normalizedCategoryMap[rawCategory.toLowerCase()] || rawCategory;

    const isSql = category === "SQL";
    const isSystemDesign = category === "SystemDesign";
    const isBehavioral = category === "Behavioral";
    const isFundamental =
        ["OS", "CN", "OOPS", "Behavioral", "DBMS"].includes(category) ||
        (!isSql && category && !["DSA", "SystemDesign"].includes(category));

    // Coding interview is hard-locked to exactly one pre-fetched DSA problem.
    // Never rotate or fetch a second DSA question mid-session.
    if (ctx.interviewType === "coding" && category === "DSA") {
        const lockedQuestionId =
            ctx.prefetchedDSAQuestion?.id ||
            ctx.lastFetchedQuestionId ||
            [...ctx.cachedQuestionData.keys()][0] ||
            null;

        const lockedQuestion = lockedQuestionId
            ? (ctx.cachedQuestionData.get(lockedQuestionId) ||
                (ctx.prefetchedDSAQuestion?.id === lockedQuestionId ? ctx.prefetchedDSAQuestion : null))
            : null;

        if (!lockedQuestion) {
            return JSON.stringify({
                error: "Coding interview is locked to one pre-fetched DSA question, but no locked question is available in session state.",
            });
        }

        return JSON.stringify({
            _directive:
                "IMPORTANT: Coding interview is hard-locked to ONE pre-fetched question. Reuse this exact question only. Do NOT fetch or ask a different DSA problem.",
            questionId: lockedQuestion.id,
            title: lockedQuestion.title,
            category: lockedQuestion.category || "DSA",
            difficulty: lockedQuestion.difficulty,
            problemMd: lockedQuestion.problemMd,
            constraints: lockedQuestion.constraints,
            examples: lockedQuestion.examples,
            hints: lockedQuestion.hints,
        });
    }

    let question: any = null;

    if (isSystemDesign) {
        const existingId = ctx.lastFetchedQuestionId;
        let cachedSD = existingId ? ctx.cachedQuestionData.get(existingId) : null;
        if (!cachedSD || cachedSD.category !== "SystemDesign") {
            cachedSD = [...ctx.cachedQuestionData.values()].find((q) => q.category === "SystemDesign") || null;
        }

        if (!cachedSD && ctx.prefetchedSDQuestion) {
            cachedSD = {
                questionId: ctx.prefetchedSDQuestion.id,
                title: ctx.prefetchedSDQuestion.title,
                category: "SystemDesign",
                difficulty: (ctx.prefetchedSDQuestion as any).difficulty || difficulties[0] || "Medium",
                problemMd: ctx.prefetchedSDQuestion.problemStatement,
            };
            ctx.cachedQuestionData.set(cachedSD.questionId, cachedSD);
            if ((ctx.prefetchedSDQuestion as any).rubricLite) {
                ctx.onRubricLiteLoaded?.((ctx.prefetchedSDQuestion as any).rubricLite);
            }
        }

        if (!cachedSD) {
            return JSON.stringify({
                error: "No pre-fetched system design question available in session cache. Please restart the interview.",
            });
        }

        const resultObj = {
            questionId: cachedSD.questionId || cachedSD.id,
            title: cachedSD.title,
            category: "SystemDesign",
            difficulty: cachedSD.difficulty || difficulties[0] || "Medium",
            problemMd: cachedSD.problemMd,
        };

        if (!ctx.askedQuestionIds.includes(resultObj.questionId)) {
            ctx.askedQuestionIds.push(resultObj.questionId);
            addAskedQuestion(ctx.userId, resultObj.questionId).catch(console.error);
        }

        console.log(`[ToolHandlers] fetch_question ${args.category} (SystemDesign) cache hit`);
        return JSON.stringify(resultObj);
    }

    // Check for pre-fetched DSA question (loaded at session init for zero-latency)
    if (category === "DSA" && !isSql && !isFundamental && ctx.prefetchedDSAQuestion) {
        question = ctx.prefetchedDSAQuestion;
        ctx.prefetchedDSAQuestion = null; // consume it — only used once
    } else if (isSql) {
        // SQL must come from pre-fetched cache only.
        if (ctx.prefetchedCSQuestions?.has("SQL_query") && ctx.prefetchedCSQuestions.get("SQL_query")!.length > 0) {
            const prefetchedSql = ctx.prefetchedCSQuestions.get("SQL_query")!.shift()!;
            question = ctx.cachedQuestionData.get(prefetchedSql.questionId) || null;
        }

        if (!question) {
            const existingSQLQ = [...ctx.cachedQuestionData.values()].find((q) => q.category === "SQL");
            if (existingSQLQ) {
                console.log(`[ToolHandlers] fetch_question SQL — idempotent return of ${existingSQLQ.id}`);
                return JSON.stringify({
                    _directive: "IMPORTANT: This is the SAME SQL question already in the editor. Do NOT change it. Continue the round with this question.",
                    questionId: existingSQLQ.id,
                    title: existingSQLQ.title,
                    category: "SQL",
                    difficulty: existingSQLQ.difficulty || "Medium",
                    problemDescription: existingSQLQ.description,
                    examples: existingSQLQ.examples,
                    hints: existingSQLQ.hints || [],
                });
            }
        }

        if (!question) {
            return "No SQL question available in pre-fetched session cache. Please restart the interview.";
        }
    } else if (isFundamental) {
        if (isBehavioral) {
            if (ctx.prefetchedBehavioralQuestions && ctx.prefetchedBehavioralQuestions.length > 0) {
                const prefetched = ctx.prefetchedBehavioralQuestions.shift()!;
                question = {
                    questionID: prefetched.questionId,
                    questionType: "Behavioral",
                    question: prefetched.questionText,
                    answer: prefetched.referenceAnswer,
                    hint: null,
                };
            }

            if (!question) {
                const cachedBehavioral = [...ctx.cachedQuestionData.values()].find((q: any) => q.category === "Behavioral");
                if (cachedBehavioral) {
                    question = {
                        questionID: cachedBehavioral.questionID || cachedBehavioral.questionId || cachedBehavioral.id,
                        questionType: "Behavioral",
                        question: cachedBehavioral.question || cachedBehavioral.questionText,
                        answer: cachedBehavioral.answer || cachedBehavioral.referenceAnswer,
                        hint: null,
                    };
                }
            }

            if (!question) {
                return JSON.stringify({
                    _directive:
                        "No behavioural DB question is configured for this session. Ask your own behavioural question based on the stage instructions (STAR-focused), evaluate the candidate response naturally, and continue without calling fetch_question again for behavioural unless explicitly needed.",
                    source: "llm_instructions",
                    category: "Behavioral",
                });
            }
        } else {
            const categoryKeyMap: Record<string, string> = {
                DBMS: "DBMS",
                OS: "OS",
                CN: "CN",
                Networking: "CN",
                OOPS: "OOPS",
                OOP: "OOPS",
            };
            const prefetchKey = categoryKeyMap[category] || category;

            if (ctx.prefetchedCSQuestions?.has(prefetchKey) && ctx.prefetchedCSQuestions.get(prefetchKey)!.length > 0) {
                const prefetched = ctx.prefetchedCSQuestions.get(prefetchKey)!.shift()!;
                question = {
                    questionID: prefetched.questionId,
                    questionType: category,
                    question: prefetched.questionText,
                    answer: prefetched.referenceAnswer,
                    hint: null,
                };
            }
        }

        if (!question) {
            return `No ${category || args.category} question available in pre-fetched session cache. Please restart the interview.`;
        }
    } else {
        // DSA must come from pre-fetched cache only.
        const pinnedDSAId = ctx.lastFetchedQuestionId || [...ctx.cachedQuestionData.keys()].find((id) => {
            const q: any = ctx.cachedQuestionData.get(id);
            return q && (q.category === "DSA" || q.problemMd);
        });
        if (pinnedDSAId) {
            question = ctx.cachedQuestionData.get(pinnedDSAId) || null;
        }

        if (!question) {
            return `No DSA question available in pre-fetched session cache (difficulty: ${difficulties.join(", ")}). Please restart the interview.`;
        }
    }

    if (!question) {
        return `No ${args.category} question available in pre-fetched session cache.`;
    }

    const matchedId = isFundamental ? question.questionID : (question.id || question.questionId);
    if (!matchedId) {
        return `Invalid ${args.category} question payload in session cache.`;
    }
    if (!ctx.askedQuestionIds.includes(matchedId)) {
        ctx.askedQuestionIds.push(matchedId);
        addAskedQuestion(ctx.userId, matchedId).catch(console.error);
    }
    recordQuestionExposure({
        userId: ctx.userId,
        questionSource: isSql ? "cs_sql" : isFundamental ? "cs_fundamental" : "dsa",
        questionId: matchedId,
        sessionId: ctx.sessionId,
    }).catch(console.error);

    // Save to session_questions (still in PostgreSQL via Prisma)
    try {
        const qTitle = isFundamental
            ? (question as any).question?.slice(0, 120) ?? undefined
            : (question as any).title ?? undefined;
        const qCategory = isFundamental
            ? ((question as any).questionType ?? undefined)
            : isSql
                ? "SQL"
                : (question as any).category ?? undefined;
        const qDifficulty = isFundamental ? undefined : ((question as any).difficulty ?? undefined);

        await prisma.sessionQuestion.create({
            data: {
                sessionId: ctx.sessionId,
                questionId: !isSql && !isFundamental ? matchedId : undefined,
                questionSqlId: isSql ? matchedId : undefined,
                questionFundamentalId: isFundamental ? matchedId : undefined,
                questionTitle: qTitle,
                questionCategory: qCategory,
                questionDifficulty: qDifficulty,
            },
        });
    } catch (e: any) {
        // Log but don't crash — the question was fetched successfully
        console.error("[ToolHandlers] Failed to save sessionQuestion:", e?.message);
    }

    let resultObj: any;
    if (isFundamental) {
        resultObj = {
            _directive: "IMPORTANT: You MUST ask the candidate EXACTLY the question below. Do NOT make up your own question. Read the 'questionText' field and ask it verbatim or paraphrase it slightly. Use the 'referenceAnswer' to evaluate their response.",
            questionId: question.questionID,
            category: question.questionType || category,
            questionText: question.question || question.questionText,
            referenceAnswer: question.answer || question.referenceAnswer,
            hints: question.hint ? [question.hint] : (question.hints || []),
        };
    } else if (isSql) {
        resultObj = {
            _directive: "IMPORTANT: You MUST present EXACTLY this SQL question to the candidate. The title is in 'title' and the full problem is in 'problemDescription'. Do NOT make up a different question. When you call open_sql_editor, this exact question will be displayed in the IDE.",
            questionId: question.id,
            title: question.title,
            category: "SQL",
            difficulty: question.difficulty || "Medium",
            problemDescription: question.description,
            examples: question.examples,
            hints: question.hints || [],
        };
    } else {
        // DSA — question is already normalized via normalizeDSAQuestion
        resultObj = {
            _directive: "IMPORTANT: You MUST present EXACTLY this DSA question to the candidate. The title is in 'title' and the problem is in 'problemMd'. Do NOT make up a different question. When you call open_ide, this exact question will be displayed in the IDE.",
            questionId: question.id,
            title: question.title,
            category: question.category,
            difficulty: question.difficulty,
            problemMd: question.problemMd,
            constraints: question.constraints,
            examples: question.examples,
            hints: question.hints,
            starterCode: Object.fromEntries(
                (question.starters || []).map((s: any) => [s.language, s.starter])
            ),
            wrapperCode: Object.fromEntries(
                (question.starters || []).map((s: any) => [s.language, s.wrapperCode])
            ),
            visibleTestCases: (question.visibleTestCases || question.testCases || []).map((tc: any) => ({
                input: tc.input,
                expected: tc.expected,
                label: tc.type === "edge" ? "Edge Case" : "Sample Case",
            })),
        };
    }

    const result = JSON.stringify(resultObj);

    // Cache full question data so open_ide / open_sql_editor can use it without a redundant DB query
    if (!isFundamental && question) {
        const questionCacheId = question.id || question.questionId;
        if (questionCacheId) {
            ctx.cachedQuestionData.set(questionCacheId, question);
        }
    }

    logToolCall("fetch_question", args, "Success");
    return result;
}

// ── Open IDE ─────────────────────────────────────────────────

// ── Company AI Screening: question tagging + IDE/SQL workspace ───────────────

/** Tag the configured screening question the interviewer is about to ask (resume/non-IDE). */
function handleRecordScreeningQuestion(args: { questionId: string }, ctx: ToolContext): string {
    if (!ctx.companyScreeningBlueprint) {
        return "record_screening_question is only available in company screening sessions.";
    }
    const screeningQuestionId = String(args.questionId || "").trim();
    if (!screeningQuestionId) return "Provide the configured screening question id from the agenda.";
    ctx.onScreeningQuestionAsked?.(screeningQuestionId, null);
    return `Recorded screening question ${screeningQuestionId}. Ask it now.`;
}

async function persistScreeningSessionQuestion(sessionId: string, question: any, category: "coding" | "SQL" | "system_design") {
    try {
        const where = category === "SQL"
            ? { sessionId, questionSqlId: String(question.id) }
            : category === "system_design"
                ? { sessionId, questionFundamentalId: String(question.id) }
                : { sessionId, questionId: String(question.id) };
        const existing = await prisma.sessionQuestion.findFirst({ where, select: { id: true } });
        if (existing) return;
        await prisma.sessionQuestion.create({
            data: category === "SQL"
                ? {
                    sessionId,
                    questionSqlId: String(question.id),
                    questionTitle: question.title || "SQL Question",
                    questionCategory: "SQL",
                    questionDifficulty: question.difficulty || "Medium",
                }
                : category === "system_design"
                ? {
                    sessionId,
                    // System design lives in MongoDB; store its id in questionFundamentalId
                    // (same slot the GenAI system-design path uses).
                    questionFundamentalId: String(question.id),
                    questionTitle: question.title || "System Design Question",
                    questionCategory: "system_design",
                    questionDifficulty: question.difficulty || "Medium",
                }
                : {
                    sessionId,
                    questionId: String(question.id),
                    questionTitle: question.title || "Coding Question",
                    questionCategory: "coding",
                    questionDifficulty: question.difficulty || "Medium",
                },
        });
    } catch (e: any) {
        console.error("[ToolHandlers] Failed to persist screening sessionQuestion:", e?.message);
    }
}

/**
 * Opens the coding IDE or SQL editor for a configured coding/cs_sql screening
 * question. Resolves the recruiter-attached bank question (prefetched into the
 * session cache at init), emits the same events the practice IDE uses, and tags
 * the current question so run_candidate_code + the report can resolve it.
 */
async function handleOpenScreeningWorkspace(args: { questionId: string }, ctx: ToolContext): Promise<string> {
    const blueprint = ctx.companyScreeningBlueprint;
    if (!blueprint) {
        return "open_screening_workspace is only available in company screening sessions.";
    }
    const screeningQuestionId = String(args.questionId || "").trim();
    const resolved = bankQuestionIdForScreeningQuestion(blueprint, screeningQuestionId);
    if (!resolved) {
        // A coding/SQL phase with no attached bank problem cannot present a real question.
        // NEVER invent one — a screening asks ONLY the recruiter's configured questions.
        return `Question ${screeningQuestionId} has no recruiter-attached coding/SQL problem, so there is nothing to open. Do NOT invent or describe a coding problem of your own. Say you'll move on and wait for the server to advance to the next question.`;
    }
    const bankId = String(resolved.ref.id);
    const question = ctx.cachedQuestionData.get(bankId);
    if (!question) {
        return "The attached bank question could not be loaded. Do NOT invent a problem of your own. Say you'll move on and wait for the server to advance to the next question.";
    }

    // Tag the current screening question (transcript + pacing) and point
    // run_candidate_code at this bank question id via lastFetchedQuestionId.
    ctx.onScreeningQuestionAsked?.(screeningQuestionId, bankId);

    if (resolved.ref.type === "sql") {
        ctx.emit("panel:open", { type: "sql", stage: ctx.currentStage, sqlQuestion: question });
        if (question.hiddenTestCases?.length > 0 && question.solution) {
            warmSqlCache(question.id, question.solution, question.hiddenTestCases).catch(console.error);
        }
        await persistScreeningSessionQuestion(ctx.sessionId, question, "SQL");
        return `Opened the SQL editor for "${question.title}". The candidate can write and run their query.`;
    }

    // Coding (DSA) — mirror the standard open_ide payload from a normalized question.
    const language = ctx.lastFetchedLanguage || "javascript";
    const payload = {
        question: {
            id: question.id,
            questionType: "dsa",
            title: question.title,
            difficulty: question.difficulty,
            problemMd: question.problemMd,
            constraints: question.constraints,
            examples: question.examples,
            starterCode: Object.fromEntries((question.starters || []).map((s: any) => [s.language, s.starter])),
            wrapperCode: Object.fromEntries((question.starters || []).map((s: any) => [s.language, s.wrapperCode])),
            visibleTestCases: (question.visibleTestCases || question.testCases || []).map((tc: any) => ({
                input: tc.input,
                expected: tc.expected,
                label: tc.type === "edge" ? "Edge Case" : "Sample Case",
            })),
            language,
        },
    };
    ctx.emit("question:assign", { ...payload, questionType: "dsa", stage: "DSA" });
    await persistScreeningSessionQuestion(ctx.sessionId, question, "coding");
    return `Opened the coding IDE for "${question.title}". The candidate can read the problem and code in ${language}.`;
}

async function handleOpenIDE(
    args: { questionId: string; language: string },
    ctx: ToolContext
): Promise<string> {

    // ── GenAI Coding path ────────────────────────────────────────────────────
    // For gen_ai_role, the IDE loads the pre-fetched GenAI coding question.
    // Note: open_ide is a passthrough tool — it runs BEFORE transition_stage (controlSuggestion)
    // in the same turn. So ctx.currentStage may still be GEN_AI_CONCEPTS when this fires.
    // We use prefetchedGenAICodingQuestion as the signal instead of stage.
    const genAITask = (ctx as any).prefetchedGenAICodingQuestion ?? null;
    if (ctx.interviewType === "gen_ai_role" && genAITask) {
        // Build IDE payload matching what the frontend expects
        const payload = {
            question: {
                id:               genAITask.questionId,
                questionType:     "genai_coding",
                title:            genAITask.title,
                difficulty:       genAITask.difficulty,
                problemMd:        genAITask.problemStatement,
                constraints:      [],
                examples:         [],
                starterCode:      { python: genAITask.starterCode || "" },
                wrapperCode:      {},
                visibleTestCases: (genAITask.sampleTestCases || []).map((tc: any) => ({
                    input:    tc.input,
                    expected: tc.expectedOutput,
                    label:    tc.description || "Sample Case",
                })),
                language: args.language || "python",
            },
        };

        // Emit WebSocket event to open IDE on client
        ctx.emit("question:assign", { ...payload, questionType: "genai_coding", stage: "GEN_AI_CODING" });

        // Write sessionQuestion — single question for this phase, so write at IDE-open time
        // (no record_question needed — coding question is always shown, never chosen from a bank)
        try {
            const existing = await prisma.sessionQuestion.findFirst({
                where: { sessionId: ctx.sessionId, questionFundamentalId: genAITask.questionId },
                select: { id: true },
            });
            if (!existing) {
                await prisma.sessionQuestion.create({
                    data: {
                        sessionId:             ctx.sessionId,
                        questionFundamentalId: genAITask.questionId,
                        questionTitle:         genAITask.title,
                        questionCategory:      "genai_coding",
                        questionDifficulty:    genAITask.difficulty,
                    },
                });
                console.log(`[ToolHandlers] GenAI coding sessionQuestion recorded: "${genAITask.title}"`);
            }
        } catch (e: any) {
            console.error("[ToolHandlers] Failed to persist GenAI coding sessionQuestion:", e?.message);
        }
        recordQuestionExposure({
            userId: ctx.userId,
            questionSource: "genai_coding",
            questionId: genAITask.questionId,
            sessionId: ctx.sessionId,
        }).catch(console.error);

        return `IDE opened with GenAI coding task "${genAITask.title}" (${genAITask.difficulty}). The candidate can see the problem and start coding in ${args.language || "python"}.`;
    }

    // ── Data Science Coding path ─────────────────────────────────────────────
    // For data_science_role, the IDE loads the pre-fetched DS coding question.
    const dsTask = (ctx as any).prefetchedDSCodingQuestion ?? null;
    if (ctx.interviewType === "data_science_role" && dsTask) {
        const visibleTestCases = (dsTask.sampleTestCases || []).map((tc: any) => ({
            id:       tc.id,
            input:    tc.input,
            expected: tc.output ?? tc.expectedOutput,
            label:    tc.description || "Sample Case",
        }));
        const constraints = [
            dsTask.datasetUrl ? `Dataset: ${dsTask.datasetUrl}` : null,
            dsTask.timeLimit ? `Time limit: ${dsTask.timeLimit} seconds` : null,
            dsTask.memoryLimit ? `Memory limit: ${dsTask.memoryLimit} MB` : null,
            dsTask.metadata?.expectedAccuracy ? `Target accuracy: ${dsTask.metadata.expectedAccuracy}` : null,
            dsTask.metadata?.expectedVarianceExplained ? `Expected variance explained: ${dsTask.metadata.expectedVarianceExplained}` : null,
        ].filter(Boolean);
        const problemMd = String(dsTask.description ?? dsTask.problemStatement ?? "")
            .replace(/<\/p>/gi, "\n\n")
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<li>/gi, "- ")
            .replace(/<\/li>/gi, "\n")
            .replace(/<\/?(ul|ol)>/gi, "\n")
            .replace(/<strong>/gi, "**")
            .replace(/<\/strong>/gi, "**")
            .replace(/<em>/gi, "_")
            .replace(/<\/em>/gi, "_")
            .replace(/<[^>]+>/g, "")
            .trim();
        const payload = {
            question: {
                id:               dsTask.questionId,
                questionType:     "ds_coding",
                title:            dsTask.title,
                difficulty:       dsTask.difficulty,
                problemMd,
                constraints,
                examples:         visibleTestCases.map((tc: any) => ({
                    input: tc.input,
                    output: tc.expected,
                    explanation: tc.label,
                })),
                starterCode:      { python: dsTask.starterCode || "" },
                wrapperCode:      {},
                visibleTestCases,
                language: "python",
            },
        };

        ctx.emit("question:assign", { ...payload, questionType: "ds_coding", stage: "DS_CODING" });

        try {
            const existing = await prisma.sessionQuestion.findFirst({
                where: { sessionId: ctx.sessionId, questionFundamentalId: dsTask.questionId },
                select: { id: true },
            });
            if (!existing) {
                await prisma.sessionQuestion.create({
                    data: {
                        sessionId:             ctx.sessionId,
                        questionFundamentalId: dsTask.questionId,
                        questionTitle:         dsTask.title,
                        questionCategory:      "ds_coding",
                        questionDifficulty:    dsTask.difficulty,
                        sampleAnswer:          dsTask.solution || null,
                    },
                });
                console.log(`[ToolHandlers] DS coding sessionQuestion recorded: "${dsTask.title}"`);
            }
        } catch (e: any) {
            console.error("[ToolHandlers] Failed to persist DS coding sessionQuestion:", e?.message);
        }
        recordQuestionExposure({
            userId: ctx.userId,
            questionSource: "ds_coding",
            questionId: dsTask.questionId,
            sessionId: ctx.sessionId,
        }).catch(console.error);

        return `IDE opened with DS coding task "${dsTask.title}" (${dsTask.difficulty}). The candidate can see the problem and start coding in Python.`;
    }

    // ── Standard DSA path (all other interview types) ────────────────────────
    // Fallback: if LLM didn't pass a valid questionId, use the last fetched one
    // Always prefer the tracked ID — the LLM often hallucinates question IDs.
    const questionId = ctx.lastFetchedQuestionId || args.questionId;
    if (!questionId) {
        return "No question available. Please call fetch_question first to get a coding problem.";
    }

    // Fallback: if LLM didn't pass a language, use the last used one or default to javascript
    const language = args.language || ctx.lastFetchedLanguage || "javascript";

    // Use only session cache (strict no runtime DB fetch policy).
    const question =
        ctx.cachedQuestionData.get(questionId) ||
        (ctx.prefetchedDSAQuestion?.id === questionId ? ctx.prefetchedDSAQuestion : null);

    if (!question) {
        return "Question not available in pre-fetched session cache. Please restart the interview.";
    }

    // Build the payload matching QuestionWithStarters type
    const payload = {
        question: {
            id: question.id,
            questionType: "dsa",
            title: question.title,
            difficulty: question.difficulty,
            problemMd: question.problemMd,
            constraints: question.constraints,
            examples: question.examples,
            starterCode: Object.fromEntries(
                (question.starters || []).map((s: any) => [s.language, s.starter])
            ),
            wrapperCode: Object.fromEntries(
                (question.starters || []).map((s: any) => [s.language, s.wrapperCode])
            ),
            visibleTestCases: (question.visibleTestCases || question.testCases || []).map((tc: any) => ({
                input: tc.input,
                expected: tc.expected,
                label: tc.type === "edge" ? "Edge Case" : "Sample Case",
            })),
            language: language,
        },
    };

    // Emit WebSocket event to open IDE on client
    // Include stage so the frontend can update panel + stage atomically in one render
    ctx.emit("question:assign", { ...payload, questionType: "dsa", stage: "DSA" });
    // Notify caller (orchestrator / voice pipeline) that DSA IDE opened
    // so coding-phase timers can start deterministically.
    ctx.onDSAEditorOpened?.();

    // Ensure coding questions shown in the IDE are persisted for report generation.
    // Idempotent: if a row already exists (e.g. from fetch_question), skip create.
    try {
        const existing = await prisma.sessionQuestion.findFirst({
            where: { sessionId: ctx.sessionId, questionId: question.id },
            select: { id: true },
        });
        if (!existing) {
            const dsaSampleAnswer: string | null =
                question.solution?.optimized?.explanation ||
                question.solution?.bruteForce?.explanation ||
                null;

            await prisma.sessionQuestion.create({
                data: {
                    sessionId: ctx.sessionId,
                    questionId: question.id,
                    questionTitle: question.title,
                    questionCategory: "coding",
                    questionDifficulty: question.difficulty,
                    sampleAnswer: dsaSampleAnswer,
                },
            });
        }
    } catch (e: any) {
        console.error("[ToolHandlers] Failed to persist coding question at IDE open:", e?.message);
    }
    recordQuestionExposure({
        userId: ctx.userId,
        questionSource: "dsa",
        questionId: question.id,
        sessionId: ctx.sessionId,
    }).catch(console.error);

    return `IDE opened with question "${question.title}" (${question.difficulty}). The candidate can now see the problem and start coding in ${language}.`;
}


// ── Open SQL Editor ──────────────────────────────────────────

async function handleOpenSQLEditor(
    args: Record<string, never>,
    ctx: ToolContext
): Promise<string> {
    let sqlQuestionData: any = null;

    // ── Data Science SQL path ────────────────────────────────────────────────
    // For data_science_role, the candidate-facing SQL panel is DB-owned.
    // Do not accept title/description/schema from the LLM or tool args here.
    const dsSQLTask = (ctx as any).prefetchedDSSQLQuestion ?? null;
    if (ctx.interviewType === "data_science_role" && dsSQLTask) {
        // Normalize the prefetched DB row to the shape the frontend SQL editor expects.
        const sqlPayload = {
            id:               dsSQLTask.questionId,
            title:            dsSQLTask.title,
            description:      dsSQLTask.description,
            schema:           dsSQLTask.schema,
            examples:         dsSQLTask.examples ?? [],
            testCases:        dsSQLTask.testCases ?? [],
            hiddenTestCases:  dsSQLTask.hiddenTestCases ?? [],
            solution:         dsSQLTask.solution,
            judge0LanguageId: dsSQLTask.judge0LanguageId,
            wrapperCode:      dsSQLTask.wrapperCode,
            category:         "SQL",
        };

        ctx.emit("panel:open", {
            type: "sql",
            stage: "DS_SQL",
            sqlQuestion: sqlPayload,
        });

        if (sqlPayload.hiddenTestCases?.length > 0 && sqlPayload.solution) {
            warmSqlCache(sqlPayload.id, sqlPayload.solution, sqlPayload.hiddenTestCases).catch(console.error);
        }

        // Persist sessionQuestion for report generation
        try {
            const existing = await prisma.sessionQuestion.findFirst({
                where: {
                    sessionId: ctx.sessionId,
                    OR: [
                        { questionSqlId: dsSQLTask.questionId },
                        { questionFundamentalId: dsSQLTask.questionId },
                    ],
                },
                select: { id: true },
            });
            if (!existing) {
                await prisma.sessionQuestion.create({
                    data: {
                        sessionId:             ctx.sessionId,
                        questionSqlId:         dsSQLTask.questionId,
                        questionTitle:         dsSQLTask.title,
                        questionCategory:      "ds_sql",
                        questionDifficulty:    "Medium",
                        sampleAnswer:          dsSQLTask.solution || null,
                    },
                });
                console.log(`[ToolHandlers] DS SQL sessionQuestion recorded: "${dsSQLTask.title}"`);
            }
        } catch (e: any) {
            console.error("[ToolHandlers] Failed to persist DS SQL sessionQuestion:", e?.message);
        }
        recordQuestionExposure({
            userId: ctx.userId,
            questionSource: "ds_sql",
            questionId: dsSQLTask.questionId,
            sessionId: ctx.sessionId,
        }).catch(console.error);

        ctx.onSQLEditorOpened?.();
        return `SQL editor opened with DS SQL question "${dsSQLTask.title}". The candidate can now see the problem and write queries.`;
    }

    // 1. Check via askedQuestionIds (set after fetch_question runs)
    const lastAskedSQLId = [...ctx.askedQuestionIds].reverse().find(id => {
        const cached = ctx.cachedQuestionData.get(id);
        return cached && cached.category === "SQL";
    });

    if (lastAskedSQLId) {
        sqlQuestionData = ctx.cachedQuestionData.get(lastAskedSQLId);
    }

    // 2. Fall back to any SQL question already in cachedQuestionData (e.g. pre-fetched
    //    for cs_fundamentals before fetch_question was called in this batch)
    if (!sqlQuestionData) {
        sqlQuestionData = [...ctx.cachedQuestionData.values()].find(q => q.category === "SQL") ?? null;
    }

    if (!sqlQuestionData) {
        return "Failed to open SQL editor. No pre-fetched SQL question is available in session cache.";
    }

    const sqlQuestionId = String(sqlQuestionData.id || sqlQuestionData.questionId || "");
    const sqlSampleAnswer = typeof sqlQuestionData.solution === "string"
        ? sqlQuestionData.solution
        : sqlQuestionData.solution
            ? JSON.stringify(sqlQuestionData.solution, null, 2)
            : null;

    // Emit panel:open with full SQL question data for the frontend IDE.
    // The schema and question text are derived from sqlQuestionData automatically —
    // the AI no longer needs to pass them as parameters.
    ctx.emit("panel:open", {
        type: "sql",
        stage: ctx.currentStage,
        sqlQuestion: sqlQuestionData,
    });

    // ── FIRE AND FORGET ASYNC CACHE WARMING ──
    // Don't await it — let it run in the background so it's ready when they click "Run"
    if (sqlQuestionData.hiddenTestCases && sqlQuestionData.hiddenTestCases.length > 0 && sqlQuestionData.solution) {
        warmSqlCache(sqlQuestionData.id, sqlQuestionData.solution, sqlQuestionData.hiddenTestCases).catch(console.error);
    }

    // Persist CS SQL question on editor-open as well. In modular CS flows the
    // server can open the SQL editor directly, without a preceding fetch_question
    // call, so report generation needs this durable session_questions row.
    if (sqlQuestionId) {
        try {
            const existing = await prisma.sessionQuestion.findFirst({
                where: { sessionId: ctx.sessionId, questionSqlId: sqlQuestionId },
                select: { id: true },
            });

            if (!existing) {
                await prisma.sessionQuestion.create({
                    data: {
                        sessionId:          ctx.sessionId,
                        questionSqlId:      sqlQuestionId,
                        questionTitle:      sqlQuestionData.title || "SQL Question",
                        questionCategory:   "SQL",
                        questionDifficulty: sqlQuestionData.difficulty || "Medium",
                        sampleAnswer:       sqlSampleAnswer,
                    },
                });
                console.log(`[ToolHandlers] CS SQL sessionQuestion recorded: "${sqlQuestionData.title}"`);
            }

            if (!ctx.askedQuestionIds.includes(sqlQuestionId)) {
                ctx.askedQuestionIds.push(sqlQuestionId);
                addAskedQuestion(ctx.userId, sqlQuestionId).catch(console.error);
            }
            recordQuestionExposure({
                userId: ctx.userId,
                questionSource: "cs_sql",
                questionId: sqlQuestionId,
                sessionId: ctx.sessionId,
            }).catch(console.error);
        } catch (e: any) {
            console.error("[ToolHandlers] Failed to persist CS SQL sessionQuestion:", e?.message);
        }
    }

    // Notify caller (orchestrator / voice pipeline) that SQL editor just opened
    // so it can start inactivity + total-time timers.
    ctx.onSQLEditorOpened?.();

    const problemDescription = String(sqlQuestionData.description || sqlQuestionData.problemDescription || "").trim();
    const examples = Array.isArray(sqlQuestionData.examples) && sqlQuestionData.examples.length > 0
        ? `Examples: ${JSON.stringify(sqlQuestionData.examples).slice(0, 1200)}`
        : "";

    return [
        `SQL editor opened with question "${sqlQuestionData.title}".`,
        problemDescription ? `Problem: ${problemDescription.slice(0, 2000)}` : "",
        examples,
        "The candidate can now see this same problem and write queries.",
    ].filter(Boolean).join("\n");
}

// ── Open Scratchpad ──────────────────────────────────────────

async function handleOpenScratchpad(
    args: { topic: string; initialContent: string },
    ctx: ToolContext
): Promise<string> {
    // Company screening: the system-design phase seeds its whiteboard from the
    // recruiter-attached bank question, prefetched into the session cache at init.
    let screeningSDQuestion: any | null = null;
    let screeningSDQuestionId: string | null = null;
    const screeningBlueprint = ctx.companyScreeningBlueprint;
    if (screeningBlueprint && ctx.companyScreeningCurrentPhaseType === "system_design") {
        const sdPhase = screeningBlueprint.phases.find((p) => p.type === "system_design");
        const sdQ = sdPhase?.questions.find((q) => q.bankQuestion?.id);
        if (sdQ?.bankQuestion?.id) {
            const cached = ctx.cachedQuestionData.get(String(sdQ.bankQuestion.id));
            if (cached) { screeningSDQuestion = cached; screeningSDQuestionId = sdQ.id; }
        }
    }

    const systemDesignQuestion = screeningSDQuestion
        ?? (ctx.currentStage === "SYSTEM_DESIGN" ? ctx.prefetchedSDQuestion : null);

    if (screeningSDQuestion && screeningSDQuestionId) {
        // Tag the current screening question (transcript + pacing) and record it.
        ctx.onScreeningQuestionAsked?.(screeningSDQuestionId, String(screeningSDQuestion.id));
        await persistScreeningSessionQuestion(ctx.sessionId, screeningSDQuestion, "system_design");
    }

    ctx.emit("panel:open", {
        type:           "scratchpad",
        stage:          ctx.currentStage,
        topic:          systemDesignQuestion?.title || args.topic,
        initialContent: args.initialContent,
        ...(systemDesignQuestion
            ? {
                  candidateBrief: `Design ${systemDesignQuestion.title}. Clarify the requirements, outline the architecture, and explain the trade-offs behind your choices.`,
              }
            : {}),
        ...(systemDesignQuestion
            ? {
                  question: {
                      id: systemDesignQuestion.id,
                      title: systemDesignQuestion.title,
                      problemStatement: systemDesignQuestion.problemStatement,
                  },
              }
            : {}),
    });

    // ── GenAI System Design: write sessionQuestion at scratchpad-open time ───
    // Single question for the phase — no record_question needed.
    // problemStatement is shown to candidate in the left panel.
    if (ctx.interviewType === "gen_ai_role" && ctx.currentStage === "GEN_AI_SYSTEM_DESIGN") {
        const sd = ctx.prefetchedGenAISystemDesignQuestion;
        if (sd) {
            try {
                const existing = await prisma.sessionQuestion.findFirst({
                    where: { sessionId: ctx.sessionId, questionFundamentalId: sd.questionId },
                    select: { id: true },
                });
                if (!existing) {
                    await prisma.sessionQuestion.create({
                        data: {
                            sessionId:             ctx.sessionId,
                            questionFundamentalId: sd.questionId,  // MongoDB _id stored here
                            questionTitle:         sd.title,
                            questionCategory:      "genai_system_design",
                            questionDifficulty:    sd.difficulty,
                            // sampleAnswer populated from rubricFull.sampleAnswer at report-gen time
                        },
                    });
                    console.log(`[ToolHandlers] GenAI system design sessionQuestion recorded: "${sd.title}"`);
                }
            } catch (e: any) {
                console.error("[ToolHandlers] Failed to persist GenAI system design sessionQuestion:", e?.message);
            }
            recordQuestionExposure({
                userId: ctx.userId,
                questionSource: "genai_system_design",
                questionId: sd.questionId,
                sessionId: ctx.sessionId,
            }).catch(console.error);
        }
    }

    return `Scratchpad opened for topic: "${systemDesignQuestion?.title || args.topic}". The candidate can now write or diagram.`;
}

// ── Open Notepad (PM interviews — Tiptap rich text) ──────────

const CIRCLES_TEMPLATE = `
<h2>1) Clarify -</h2><p></p>
<h2>2) Identify users -</h2><p></p>
<h2>3) Report needs -</h2><p></p>
<h2>4) Cut through prioritization -</h2><p></p>
<h2>5) List solutions -</h2><p></p>
<h2>6) Evaluate tradeoffs -</h2><p></p>
<h2>7) Summarize -</h2><p></p>
`;

function handleOpenNotepad(
    args: { topic: string; template: "CIRCLES" | "blank"; scenario?: string },
    ctx: ToolContext
): string {
    const initialContent = args.template === "CIRCLES" ? CIRCLES_TEMPLATE : "";
    const scenario =
        args.scenario ||
        ((ctx as any).currentStage === "PM_CASE" ? (ctx as any).prefetchedPMCaseQuestion?.scenario : undefined) ||
        ((ctx as any).currentStage === "PROBLEM_SOLVING" ? (ctx as any).prefetchedProblemSolvingCaseQuestion?.prompt : undefined);

    ctx.emit("panel:open", {
        type: "notepad",
        stage: ctx.currentStage,
        topic: args.topic,
        template: args.template,
        initialContent,
        scenario,
    });
    if (ctx.currentStage === "PROBLEM_SOLVING") {
        ctx.onProblemSolvingNotepadOpened?.();
    }

    return `Notepad opened for topic: "${args.topic}" with ${args.template === "CIRCLES" ? "CIRCLES framework template" : "blank canvas"}. The candidate can now structure their thinking.`;
}

// ── Close Panel ──────────────────────────────────────────────

function handleClosePanel(
    args: { summary: string },
    ctx: ToolContext
): string {
    ctx.emit("panel:close", { summary: args.summary });
    // Clear SQL timers the moment the panel closes (they may still be running
    // if the candidate finished before any timer fired)
    ctx.onSQLPanelClosed?.();
    // Also clear DSA timers if coding panel was active.
    ctx.onDSAPanelClosed?.();

    return `Panel closed. Returning to conversation view. Summary: ${args.summary}`;
}

// ── Run Candidate Code ───────────────────────────────────────

async function handleRunCode(
    args: { language: string; code: string; questionId: string },
    ctx: ToolContext
): Promise<string> {
    const JUDGE0_URL = process.env.JUDGE0_API_URL;
    const JUDGE0_KEY = process.env.JUDGE0_API_KEY;

    if (!JUDGE0_URL) {
        // Fallback when Judge0 is not configured
        ctx.emit("code:result", {
            status: "AC",
            stdout: "// Code execution not configured — Judge0 URL missing",
            stderr: "",
            compileOutput: null,
            runtimeMs: 0,
            memoryKb: 0,
            testResults: [],
        });
        return JSON.stringify({
            status: "UNAVAILABLE",
            message: "Code execution is not configured (JUDGE0_API_URL missing). Please evaluate the code by reading it.",
        });
    }

    // Resolve Judge0 language ID
    const langConfig = LANGUAGE_MAP[args.language as keyof typeof LANGUAGE_MAP];
    const languageId = langConfig?.judge0Id;
    if (!languageId) {
        return JSON.stringify({
            status: "ERROR",
            message: `Unsupported language: ${args.language}`,
        });
    }

    // Resolve test cases from pre-fetched session cache only
    const questionId = ctx.lastFetchedQuestionId || args.questionId;

    // ── GenAI coding: resolve test cases from prefetchedGenAICodingQuestion ──
    if (ctx.interviewType === "gen_ai_role" && ctx.currentStage === "GEN_AI_CODING") {
        const task = ctx.prefetchedGenAICodingQuestion;
        if (!task) {
            return JSON.stringify({
                status: "ERROR",
                message: "No GenAI coding task available in session cache for code execution.",
            });
        }
        const submissions = (task.sampleTestCases || []).length > 0
            ? task.sampleTestCases.map((tc) => ({
                input:    tc.input,
                expected: tc.expectedOutput,
                label:    tc.description || "Sample Case",
                id:       tc.id,
                isHidden: false,
              }))
            : [{ input: "", expected: "", label: "Run", id: "run", isHidden: false }];

        // --- fall through to Judge0 submission with these test cases ---
        // (re-use the submissions variable below; skip DSA cache lookup)
        return await _runCodeWithSubmissions(submissions, args, ctx, JUDGE0_URL, JUDGE0_KEY);
    }

    // ── Standard DSA path ────────────────────────────────────────────────────
    const cachedQ =
        ctx.cachedQuestionData.get(questionId) ||
        (ctx.prefetchedDSAQuestion?.id === questionId ? ctx.prefetchedDSAQuestion : null) ||
        [...ctx.cachedQuestionData.values()].find((q: any) => q.category === "DSA");

    if (!cachedQ) {
        return JSON.stringify({
            status: "ERROR",
            message: "No pre-fetched coding question is available in session cache for code execution.",
        });
    }

    const testCaseList = cachedQ
        ? (cachedQ.visibleTestCases || cachedQ.testCases || []).filter((tc: any) => tc.type !== "hidden")
        : [];

    const submissions = testCaseList.length > 0
        ? testCaseList.map((tc: any) => ({
            input:    tc.input,
            expected: tc.expected,
            label:    tc.type === "edge" ? "Edge Case" : "Sample Case",
            id:       tc.id,
            isHidden: tc.type === "hidden",
          }))
        : [{ input: "", expected: "", label: "Run", id: "run", isHidden: false }];

    return await _runCodeWithSubmissions(submissions, args, ctx, JUDGE0_URL, JUDGE0_KEY);
}

// ── Shared Judge0 submission runner ──────────────────────────
async function _runCodeWithSubmissions(
    submissions: Array<{ input: string; expected: string; label: string; id: string; isHidden: boolean }>,
    args: { language: string; code: string; questionId: string },
    ctx: ToolContext,
    JUDGE0_URL: string,
    JUDGE0_KEY: string | undefined
): Promise<string> {

    // Resolve Judge0 language ID
    const langConfig = LANGUAGE_MAP[args.language as keyof typeof LANGUAGE_MAP];
    const languageId = langConfig?.judge0Id;
    if (!languageId) {
        return JSON.stringify({
            status: "ERROR",
            message: `Unsupported language: ${args.language}`,
        });
    }

    const testResults: Array<{
        testCaseId: string;
        label: string | null;
        input: string;
        expected: string;
        actual: string;
        passed: boolean;
        runtimeMs: number;
        isHidden: boolean;
    }> = [];

    let overallStatus: string = "AC";
    let totalRuntimeMs = 0;
    let totalMemoryKb = 0;
    let lastStdout = "";
    let lastStderr = "";
    let lastCompileOutput: string | null = null;

    const headers: Record<string, string> = {
        "Content-Type": "application/json",
    };
    if (JUDGE0_KEY) {
        headers["X-Auth-Token"] = JUDGE0_KEY;
    }

    for (const sub of submissions) {
        // Submit to Judge0 (synchronous mode with wait=true)
        const submitRes = await fetch(
            `${JUDGE0_URL}/submissions?base64_encoded=true&wait=true`,
            {
                method: "POST",
                headers,
                body: JSON.stringify({
                    language_id: languageId,
                    source_code: Buffer.from(args.code).toString("base64"),
                    stdin: Buffer.from(sub.input).toString("base64"),
                    expected_output: sub.expected
                        ? Buffer.from(sub.expected).toString("base64")
                        : undefined,
                }),
            }
        );

        if (!submitRes.ok) {
            overallStatus = "RE";
            testResults.push({
                testCaseId: sub.id,
                label: sub.label,
                input: sub.input,
                expected: sub.expected,
                actual: `Judge0 error: ${submitRes.status}`,
                passed: false,
                runtimeMs: 0,
                isHidden: sub.isHidden,
            });
            continue;
        }

        const result = (await submitRes.json()) as any;

        const stdout = result.stdout
            ? Buffer.from(result.stdout, "base64").toString()
            : "";
        const stderr = result.stderr
            ? Buffer.from(result.stderr, "base64").toString()
            : "";
        const compileOutput = result.compile_output
            ? Buffer.from(result.compile_output, "base64").toString()
            : null;
        const runtimeMs = parseFloat(result.time || "0") * 1000;
        const memoryKb = result.memory || 0;

        lastStdout = stdout;
        lastStderr = stderr;
        lastCompileOutput = compileOutput;
        totalRuntimeMs += runtimeMs;
        totalMemoryKb = Math.max(totalMemoryKb, memoryKb);

        // Judge0 status IDs: 3 = Accepted, 4 = WA, 5 = TLE, 6 = CE, etc.
        const statusId = result.status?.id;
        let testPassed = false;

        if (statusId === 3) {
            testPassed = true;
        } else if (statusId === 4) {
            if (overallStatus === "AC") overallStatus = "WA";
        } else if (statusId === 5) {
            if (overallStatus === "AC") overallStatus = "TLE";
        } else if (statusId === 6) {
            if (overallStatus === "AC") overallStatus = "CE";
        } else {
            if (overallStatus === "AC") overallStatus = "RE";
        }

        testResults.push({
            testCaseId: sub.id,
            label: sub.label,
            input: sub.input,
            expected: sub.expected,
            actual: stdout.trim(),
            passed: testPassed,
            runtimeMs,
            isHidden: sub.isHidden,
        });
    }

    // Emit result to client
    ctx.emit("code:result", {
        status: overallStatus,
        stdout: lastStdout,
        stderr: lastStderr,
        compileOutput: lastCompileOutput,
        runtimeMs: totalRuntimeMs,
        memoryKb: totalMemoryKb,
        testResults,
    });

    const passed = testResults.filter((t) => t.passed).length;
    const total = testResults.length;

    return JSON.stringify({
        status: overallStatus,
        passed,
        total,
        runtimeMs: totalRuntimeMs,
        memoryKb: totalMemoryKb,
        summary: `${passed}/${total} test cases passed. Status: ${overallStatus}.`,
        stderr: lastStderr || undefined,
        compileOutput: lastCompileOutput || undefined,
    });
}

// ── Give Hint ────────────────────────────────────────────────

async function handleGiveHint(
    args: { questionId: string; hintNumber: number },
    ctx: ToolContext
): Promise<string> {
    // Always prefer the tracked lastFetchedQuestionId — the LLM often hallucinates IDs.
    // Only fall back to args.questionId if we have no tracked ID.
    const questionId = ctx.lastFetchedQuestionId || args.questionId;
    if (!questionId) {
        return "No question is currently active. Generate a contextual hint yourself based on the problem discussion so far.";
    }

    let questionDb: any = null;
    let isSql = false;
    let isFund = false;

    // Resolve from pre-fetched in-memory cache only.
    const cached =
        ctx.cachedQuestionData.get(questionId) ||
        [...ctx.cachedQuestionData.values()].find((q: any) => (
            q?.id === questionId || q?.questionId === questionId || q?.questionID === questionId
        )) ||
        null;

    if (cached) {
        questionDb = {
            hints: cached.hints || [],
            title: cached.title || cached.question || "Question",
        };
        const category = String(cached.category || cached.questionType || "").toUpperCase();
        isSql = category === "SQL";
        isFund = ["DBMS", "OS", "CN", "OOPS", "BEHAVIORAL", "BEHAVIOURAL"].includes(category);
    }

    if (!questionDb) {
        return "Could not find stored hints for this question in the pre-fetched session cache. Generate a contextual hint based on the discussion so far.";
    }

    const hints = (questionDb.hints as string[]) || [];
    const hintIndex = args.hintNumber - 1;

    if (args.hintNumber > MAX_HINTS_PER_QUESTION) {
        return `Cannot give more than ${MAX_HINTS_PER_QUESTION} hints per question. Hint ${args.hintNumber} exceeds the limit.`;
    }

    if (hintIndex >= hints.length) {
        return hints.length === 0
            ? "This question has no pre-written hints stored. Generate a contextual hint yourself based on the problem and the candidate's current progress. Do NOT re-fetch the question or re-open the IDE."
            : `All ${hints.length} stored hints have been used. If the candidate still needs guidance, generate a contextual hint yourself based on their progress. Do NOT re-fetch the question.`;
    }

    const hint = hints[hintIndex];

    // Track hint usage in database
    try {
        const existing = await prisma.sessionQuestion.findFirst({
            where: {
                sessionId: ctx.sessionId,
                OR: [
                    { questionId },
                    { questionSqlId: questionId },
                    { questionFundamentalId: questionId }
                ]
            },
            select: { id: true },
        });

        if (!existing) {
            await prisma.sessionQuestion.create({
                data: {
                    sessionId: ctx.sessionId,
                    questionId: (!isSql && !isFund) ? questionId : undefined,
                    questionSqlId: isSql ? questionId : undefined,
                    questionFundamentalId: isFund ? questionId : undefined,
                    hintsUsed: args.hintNumber,
                },
            });
        } else {
            await prisma.sessionQuestion.update({
                where: { id: existing.id },
                data: { hintsUsed: { set: Math.max(args.hintNumber /* previous */, args.hintNumber) } } // Simplified for atomic update logic
            });
            // We just set to hintsUsed. (Prisma doesn't easily allow MAX in update, we just force it if higher).
            // Actually it requires complex syntax. I'll just run a specific update query if we needed to, 
            // but the prompt originally had:
            await prisma.sessionQuestion.updateMany({
                where: {
                    id: existing.id,
                    hintsUsed: { lt: args.hintNumber },
                },
                data: { hintsUsed: args.hintNumber },
            });
        }
    } catch (e) {
        console.error("[ToolHandlers] Failed to update hintsUsed:", e);
    }

    ctx.emit("hint:show", {
        hint,
        hintNumber: args.hintNumber,
        totalHints: hints.length,
    });

    return `Hint ${args.hintNumber}/${hints.length} shown to candidate: "${hint}". 

**IMPORTANT CONTEXT:** 
- Each hint used will reduce the candidate's coding score (hint 1: small penalty, hint 2: moderate, hint 3: significant).
- If the candidate asks for ${hints.length} hints consecutively without attempting to code in between, this indicates they need more time to think through the problem. DO NOT rush them or say "we've been on this for a while" — they literally JUST started. Instead, after giving all available hints, say something like: "Those are all the hints I can provide. Why don't you walk me through your approach now based on these hints, and then we can start coding together?"
- Only suggest moving on if they've actually been attempting to code for several minutes without progress, NOT just because they asked for hints.`;
}

// ── Record Question (CS Theory QUESTION BANK) ─────────────────
// Called by the AI silently before presenting each DBMS/OS/CN/OOPS question
// from the QUESTION BANK. Creates a SessionQuestion row so the report tracks
// exactly which DB questions were actually asked.

async function handleRecordQuestion(
    args: { questionFundamentalId: string; questionTitle: string; referenceAnswer?: string },
    ctx: ToolContext
): Promise<string> {
    if (!args.questionFundamentalId) {
        return "record_question failed: questionFundamentalId is required.";
    }

    try {
        // Allow only prefetched QUESTION BANK ids for this session to prevent
        // accidental/hallucinated CS question writes.
        let canonicalQuestionText: string | null = null;
        let canonicalReferenceAnswer: string | null = null;

        // ── CS Fundamentals bank validation ──────────────────────────────────
        const prefetched = ctx.prefetchedCSQuestions;
        if (prefetched && prefetched.size > 0) {
            for (const [cat, questions] of prefetched) {
                if (cat === "SQL_query") continue;
                const match = questions.find((q) => q.questionId === args.questionFundamentalId);
                if (match) {
                    canonicalQuestionText = match.questionText;
                    canonicalReferenceAnswer = match.referenceAnswer || null;
                    break;
                }
            }
        }

        // ── GenAI Concept bank validation (gen_ai_role GEN_AI_CONCEPTS stage) ─
        if (!canonicalQuestionText && ctx.prefetchedGenAIConceptQuestions && ctx.prefetchedGenAIConceptQuestions.length > 0) {
            const match = ctx.prefetchedGenAIConceptQuestions.find(
                (q) => q.questionId === args.questionFundamentalId
            );
            if (match) {
                canonicalQuestionText = match.questionText;
                canonicalReferenceAnswer = match.referenceAnswer || null;
            }
        }

        // ── Reject if the question ID is not in any known prefetch bank ───────
        if (!canonicalQuestionText && ctx.prefetchedDSConceptQuestions && ctx.prefetchedDSConceptQuestions.length > 0) {
            const match = ctx.prefetchedDSConceptQuestions.find(
                (q) => q.questionId === args.questionFundamentalId
            );
            if (match) {
                canonicalQuestionText = match.question;
                canonicalReferenceAnswer = match.referenceAnswer || null;
            }
        }

        // Product Manager DB-backed phases: case, concepts, and strategy.
        // These phases must record only the prefetched DB question ids.
        if (!canonicalQuestionText && ctx.prefetchedPMCaseQuestion?.questionId === args.questionFundamentalId) {
            canonicalQuestionText = ctx.prefetchedPMCaseQuestion.scenario || ctx.prefetchedPMCaseQuestion.title;
            canonicalReferenceAnswer = ctx.prefetchedPMCaseQuestion.evaluationGuide || null;
        }

        if (!canonicalQuestionText && ctx.prefetchedPMConceptQuestions && ctx.prefetchedPMConceptQuestions.length > 0) {
            const match = ctx.prefetchedPMConceptQuestions.find(
                (q) => q.questionId === args.questionFundamentalId
            );
            if (match) {
                canonicalQuestionText = match.question;
                canonicalReferenceAnswer = match.evaluationGuide || null;
            }
        }

        if (!canonicalQuestionText && ctx.prefetchedPMStrategyQuestion?.questionId === args.questionFundamentalId) {
            canonicalQuestionText = ctx.prefetchedPMStrategyQuestion.scenario || ctx.prefetchedPMStrategyQuestion.title;
            canonicalReferenceAnswer = ctx.prefetchedPMStrategyQuestion.evaluationGuide || null;
        }

        if (!canonicalQuestionText && (
            (prefetched && prefetched.size > 0) ||
            (ctx.prefetchedGenAIConceptQuestions && ctx.prefetchedGenAIConceptQuestions.length > 0) ||
            (ctx.prefetchedDSConceptQuestions && ctx.prefetchedDSConceptQuestions.length > 0) ||
            !!ctx.prefetchedPMCaseQuestion ||
            (ctx.prefetchedPMConceptQuestions && ctx.prefetchedPMConceptQuestions.length > 0) ||
            !!ctx.prefetchedPMStrategyQuestion
        )) {
            return "record_question ignored: questionFundamentalId is not in this session's prefetched QUESTION BANK.";
        }

        // Idempotent: skip if already recorded
        const existing = await prisma.sessionQuestion.findFirst({
            where: { sessionId: ctx.sessionId, questionFundamentalId: args.questionFundamentalId },
            select: { id: true },
        });

        const inferredQuestionCategory =
            ctx.interviewType === "gen_ai_role" && !!ctx.prefetchedGenAIConceptQuestions?.some(
                (q) => q.questionId === args.questionFundamentalId
            )
                ? "genai_concepts"
                : ctx.interviewType === "data_science_role" && !!ctx.prefetchedDSConceptQuestions?.some(
                    (q) => q.questionId === args.questionFundamentalId
                )
                    ? "ds_concepts"
                    : ctx.interviewType === "pm_role" && ctx.prefetchedPMCaseQuestion?.questionId === args.questionFundamentalId
                        ? "pm_case"
                        : ctx.interviewType === "pm_role" && !!ctx.prefetchedPMConceptQuestions?.some(
                            (q) => q.questionId === args.questionFundamentalId
                        )
                            ? "pm_concepts"
                            : ctx.interviewType === "pm_role" && ctx.prefetchedPMStrategyQuestion?.questionId === args.questionFundamentalId
                                ? "pm_strategy"
                                : "cs_fundamentals";

        if (!existing) {
            await prisma.sessionQuestion.create({
                data: {
                    sessionId: ctx.sessionId,
                    questionFundamentalId: args.questionFundamentalId,
                    questionTitle: (canonicalQuestionText || args.questionTitle || "").slice(0, 500) || null,
                    questionCategory: inferredQuestionCategory,
                    sampleAnswer: canonicalReferenceAnswer || args.referenceAnswer || null,
                },
            });
            console.log(`[ToolHandlers] SessionQuestion recorded for theory Q: "${canonicalQuestionText || args.questionTitle}"`);
            
            // CRITICAL: Add question ID to askedQuestionIds for phase-aware question injection
            if (!ctx.askedQuestionIds.includes(args.questionFundamentalId)) {
                ctx.askedQuestionIds.push(args.questionFundamentalId);
                console.log(`[ToolHandlers] Added question ${args.questionFundamentalId} to askedQuestionIds. Total asked: ${ctx.askedQuestionIds.length}`);
            }
        } else {
            if (
                ctx.interviewType === "pm_role" &&
                (inferredQuestionCategory === "pm_case" || inferredQuestionCategory === "pm_strategy") &&
                canonicalQuestionText
            ) {
                await prisma.sessionQuestion.update({
                    where: { id: existing.id },
                    data: {
                        questionTitle: canonicalQuestionText.slice(0, 500),
                        questionCategory: inferredQuestionCategory,
                        sampleAnswer: canonicalReferenceAnswer || args.referenceAnswer || null,
                    },
                });
                console.log(`[ToolHandlers] Updated PM sessionQuestion title with scenario text for ${args.questionFundamentalId}`);
            }
            // Question already recorded, but make sure it's in askedQuestionIds
            if (!ctx.askedQuestionIds.includes(args.questionFundamentalId)) {
                ctx.askedQuestionIds.push(args.questionFundamentalId);
                console.log(`[ToolHandlers] Question ${args.questionFundamentalId} already recorded, added to askedQuestionIds`);
            }
        }
        await recordQuestionExposure({
            userId: ctx.userId,
            questionSource: exposureSourceForRecordedQuestion(ctx, args.questionFundamentalId),
            questionId: args.questionFundamentalId,
            sessionId: ctx.sessionId,
        });
    } catch (e: any) {
        console.error("[ToolHandlers] Failed to record theory question:", e?.message);
    }

    // Silent tool — AI continues presenting the question without disruption
    return "Question recorded.";
}

// ── Transition Stage ─────────────────────────────────────────

async function handleTransitionStage(
    args: { nextStage: string; reason: string },
    ctx: ToolContext
): Promise<string> {
    const previousStage = ctx.currentStage;
    const nextStage = args.nextStage as InterviewStage;

    const transitionValidation = validateStageTransition({
        interviewType: ctx.interviewType,
        currentStage: previousStage,
        nextStage,
        stageOrder: ctx.stageOrder,
        scratchpadOpened: ctx.scratchpadOpened,
        systemDesignExchangeCount: ctx.systemDesignExchangeCount,
    });

    if (!transitionValidation.allowed) {
        if (transitionValidation.code === "stage_skip_blocked") {
            console.log(
                `[ToolHandlers] BLOCKED stage skip from ${previousStage} -> ${nextStage} (must go to ${transitionValidation.expectedNextStage}) for session ${ctx.sessionId}`
            );
        }
        if (transitionValidation.code === "scratchpad_required") {
            console.log(
                `[ToolHandlers] BLOCKED transition from SYSTEM_DESIGN -> ${nextStage} (scratchpad not opened) for session ${ctx.sessionId}`
            );
        }
        if (transitionValidation.code === "minimum_exchanges_required") {
            console.log(
                `[ToolHandlers] BLOCKED transition from SYSTEM_DESIGN -> ${nextStage} (only ${ctx.systemDesignExchangeCount ?? 0} exchanges) for session ${ctx.sessionId}`
            );
        }
        return transitionValidation.message;
    }

    const systemDesignIntroExitRejection = ctx.forceIntroExit ? null : validateSystemDesignIntroExit(ctx, nextStage);
    if (systemDesignIntroExitRejection) {
        console.log(
            `[ToolHandlers] BLOCKED transition from SYSTEM_DESIGN INTRO -> ${nextStage} for session ${ctx.sessionId}: minimum intro exchanges not met`
        );
        return systemDesignIntroExitRejection;
    }

    const fullIntroExitRejection = ctx.forceIntroExit ? null : validateFullInterviewIntroExit(ctx, nextStage);
    if (fullIntroExitRejection) {
        console.log(
            `[ToolHandlers] BLOCKED transition from FULL INTRO -> ${nextStage} for session ${ctx.sessionId}: insufficient resume/project tradeoff depth`
        );
        return fullIntroExitRejection;
    }

    const genAIIntroExitRejection = ctx.forceIntroExit ? null : validateGenAIIntroExit(ctx, nextStage);
    if (genAIIntroExitRejection) {
        console.log(
            `[ToolHandlers] BLOCKED transition from GEN_AI INTRO -> ${nextStage} for session ${ctx.sessionId}: insufficient GenAI resume depth`
        );
        return genAIIntroExitRejection;
    }

    const dataScienceIntroExitRejection = ctx.forceIntroExit ? null : validateDataScienceIntroExit(ctx, nextStage);
    if (dataScienceIntroExitRejection) {
        console.log(
            `[ToolHandlers] BLOCKED transition from DS INTRO -> ${nextStage} for session ${ctx.sessionId}: insufficient data-science resume depth`
        );
        return dataScienceIntroExitRejection;
    }

    // Deterministically close stage panels on transition so stale UI never lingers.
    if (previousStage === "DSA") {
        ctx.emit("panel:close", { summary: "Coding round complete." });
        ctx.onDSAPanelClosed?.();
    }
    if (previousStage === "FUNDAMENTALS") {
        ctx.emit("panel:close", { summary: "CS fundamentals panel closed." });
        ctx.onSQLPanelClosed?.();
    }
    if (previousStage === "SYSTEM_DESIGN") {
        ctx.emit("panel:close", { summary: "System design round complete." });
    }
    if (previousStage === "GEN_AI_CODING" || previousStage === "DS_CODING") {
        ctx.emit("panel:close", { summary: "Coding round complete." });
    }
    if (previousStage === "DS_SQL") {
        ctx.emit("panel:close", { summary: "SQL round complete." });
        ctx.onSQLPanelClosed?.();
    }
    if (previousStage === "PM_CASE") {
        ctx.emit("panel:close", { summary: "Product case round complete." });
    }

    // Update session in database
    await prisma.interviewSession.update({
        where: { id: ctx.sessionId },
        data: { stage: args.nextStage },
        select: { id: true },
    });

    // Update the context reference
    (ctx as any).currentStage = args.nextStage;

    // Emit stage change to client
    ctx.emit("stage:change", {
        stage: args.nextStage,
        reason: args.reason,
    });

    // Deterministically open IDE when entering DSA if a pre-fetched question is available.
    // This avoids waiting for an extra user input after stage transition.
    if (nextStage === "DSA" && (ctx as any).prefetchedDSAQuestion?.id) {
        const qId = (ctx as any).prefetchedDSAQuestion.id as string;
        const lang = ctx.lastFetchedLanguage || "cpp";
        const ideResult = await handleOpenIDE({ questionId: qId, language: lang }, ctx);
        return `Interview transitioned from ${previousStage} to ${nextStage}. Reason: ${args.reason}. ${ideResult}`;
    }

    // Deterministically open SQL editor when entering DS_SQL with a pre-fetched question.
    if (nextStage === "DS_SQL" && (ctx as any).prefetchedDSSQLQuestion) {
        const sqlResult = await handleOpenSQLEditor({} as Record<string, never>, ctx);
        return `Interview transitioned from ${previousStage} to ${nextStage}. Reason: ${args.reason}. ${sqlResult}`;
    }

    // Deterministically open IDE when entering DS_CODING with a pre-fetched question.
    if (nextStage === "DS_CODING" && (ctx as any).prefetchedDSCodingQuestion) {
        const ideResult = await handleOpenIDE({ questionId: (ctx as any).prefetchedDSCodingQuestion.questionId, language: "python" }, ctx);
        return `Interview transitioned from ${previousStage} to ${nextStage}. Reason: ${args.reason}. ${ideResult}`;
    }

    // Deterministically open the PM case notepad when entering the product case phase.
    if (nextStage === "PM_CASE" && (ctx as any).prefetchedPMCaseQuestion) {
        const caseQuestion = (ctx as any).prefetchedPMCaseQuestion;
        const notepadResult = handleOpenNotepad(
            { topic: caseQuestion.title || "Product Case", template: "CIRCLES", scenario: caseQuestion.scenario },
            ctx
        );
        await handleRecordQuestion(
            {
                questionFundamentalId: caseQuestion.questionId,
                questionTitle: caseQuestion.title || caseQuestion.scenario,
                referenceAnswer: caseQuestion.evaluationGuide,
            },
            ctx
        );
        return `Interview transitioned from ${previousStage} to ${nextStage}. Reason: ${args.reason}. ${notepadResult}`;
    }

    // PM strategy has exactly one DB-prefetched scenario; record it on entry.
    if (nextStage === "PM_STRATEGY" && (ctx as any).prefetchedPMStrategyQuestion) {
        const strategyQuestion = (ctx as any).prefetchedPMStrategyQuestion;
        await handleRecordQuestion(
            {
                questionFundamentalId: strategyQuestion.questionId,
                questionTitle: strategyQuestion.title || strategyQuestion.scenario,
                referenceAnswer: strategyQuestion.evaluationGuide,
            },
            ctx
        );
        return `Interview transitioned from ${previousStage} to ${nextStage}. Reason: ${args.reason}. Product strategy scenario recorded.`;
    }

    return `Interview transitioned from ${previousStage} to ${nextStage}. Reason: ${args.reason}`;
}

// ── End Interview ────────────────────────────────────────────

async function handleEndInterview(
    args: { summary: string },
    ctx: ToolContext
): Promise<string> {
    // Company screening: the SERVER owns pacing and decides when the round ends
    // (the deterministic pacing pointer advances through every configured phase and
    // forces CLOSING only when the time/coverage budget is reached). The model must
    // NOT end the round itself — e.g. after the candidate skips a couple of
    // behavioural questions — because that drops the remaining server-scheduled
    // phases. Only honor end_interview once the server has moved the round into
    // CLOSING. The mode lookup is authoritative (the main-turn ToolContext does not
    // carry the screening blueprint, so we can't rely on ctx fields here).
    const screeningModeCheck = await prisma.interviewSession.findUnique({
        where: { id: ctx.sessionId },
        select: { mode: true },
    });
    if (screeningModeCheck?.mode === "company_screening" && ctx.currentStage !== "CLOSING") {
        console.log(
            `[ToolHandlers] BLOCKED premature end_interview for screening session ${ctx.sessionId} ` +
            `(stage=${ctx.currentStage}); server has not forced closing yet.`
        );
        return "CANNOT end the screening yet. The server controls pacing and has not moved this round into closing. Continue with the current server-assigned question and do not call end_interview until the server instructs you to close.";
    }

    if (ctx.interviewType === "resume_round" && !ctx.resumeCloseoutAcknowledged) {
        return "CANNOT end resume screening yet. Ask one brief closeout question and wait for the candidate's acknowledgement before calling end_interview.";
    }

    const endValidation = validateEndInterview({
        interviewType: ctx.interviewType,
        currentStage: ctx.currentStage,
        stageOrder: ctx.stageOrder,
        scratchpadOpened: ctx.scratchpadOpened,
    });

    if (!endValidation.allowed) {
        if (endValidation.code === "scratchpad_required") {
            console.log(
                `[ToolHandlers] BLOCKED end_interview (scratchpad never opened) for session ${ctx.sessionId}`
            );
        }
        return endValidation.message;
    }

    const completedAt = new Date();
    const endingSession = await prisma.interviewSession.findUnique({
        where: { id: ctx.sessionId },
        select: { mode: true },
    });
    const isCompanyScreening = endingSession?.mode === "company_screening";

    // Update session status
    await prisma.interviewSession.update({
        where: { id: ctx.sessionId },
        data: {
            status: "COMPLETED",
            completedAt,
        },
        select: { id: true },
    });

    if (!isCompanyScreening) {
        await settleInterviewMinuteReservation(ctx.userId, ctx.sessionId);
    }

    // ── Update streak ─────────────────────────────────────────
    // Fire-and-forget: update the user's streak directly via Prisma.
    if (!isCompanyScreening) {
        updateStreakForUser(ctx.userId).catch(console.error);
    }

    // Emit session ending event
    ctx.emit("session:ending", {
        message: isCompanyScreening ? "Interview complete. Submitting your screening..." : "Interview complete.",
    });

    if (!isCompanyScreening) {
        // Trigger async evaluation report generation without blocking the websocket
        generateReport(ctx.sessionId, ctx.emit)
            .then((result) => {
                if (result.status === "failed") {
                    console.error(`[ToolHandlers] Background report generation failed for ${ctx.sessionId}: ${result.error}`);
                }
            })
            .catch(err => {
                console.error(`[ToolHandlers] Background report generation failed for ${ctx.sessionId}:`, err);
            });
    }

    return isCompanyScreening
        ? `Interview ended. Summary: ${args.summary}. Hiring screening submission is handled by the applicant room.`
        : `Interview ended. Summary: ${args.summary}. Evaluation report generation has been triggered in the background.`;
}
