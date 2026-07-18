import type { InterviewStage } from "@interviewforge/shared";
import { getInterviewTypeConfig, getModuleCompatibilityManifest } from "./interview-types/index.js";
import { screeningToolNamesForPhase } from "./agent-tools.js";
import type { ScreeningPhaseType } from "../company-ai-screening/blueprint.js";

export interface ToolSequenceContext {
    sessionId: string;
    interviewType: any;
    currentStage: InterviewStage;
    stageOrder: InterviewStage[];
    lastFetchedQuestionId: string | null;
    prefetchedDSAQuestion?: any | null;
    prefetchedGenAICodingQuestion?: { questionId: string; title: string } | null;
    prefetchedDSSQLQuestion?: { questionId: string; title: string } | null;
    prefetchedDSCodingQuestion?: { questionId: string; title: string } | null;
    cachedQuestionData: Map<string, any>;
    /** Company screening: when set, the screening tool set is also allowed. */
    companyScreening?: boolean;
    companyScreeningHasBankQuestions?: boolean;
    /** Server-assigned current screening question id; record/workspace must match it. */
    companyScreeningCurrentQuestionId?: string | null;
    /** Server-resolved phase TYPE for the current question; scopes the allowed tool set to this phase. */
    companyScreeningCurrentPhaseType?: ScreeningPhaseType | null;
}

export interface ToolSequenceValidationResult {
    valid: boolean;
    message?: string;
}

const toolHistoryBySession = new Map<string, string[]>();
const MAX_TOOL_HISTORY = 12;

function getHistory(sessionId: string): string[] {
    return toolHistoryBySession.get(sessionId) || [];
}

export function resetToolCallSequence(sessionId: string): void {
    toolHistoryBySession.delete(sessionId);
}

export function validateToolCallSequence(
    toolName: string,
    args: any,
    ctx: ToolSequenceContext
): ToolSequenceValidationResult {
    const config = getInterviewTypeConfig(ctx.interviewType);
    const manifest = getModuleCompatibilityManifest(ctx.interviewType);
    const allowedTools = new Set(config.stageTools[ctx.currentStage] || []);

    // Company screening adds its own PHASE-SCOPED tool set on top of the behavioural
    // stage tools. Because the allow-list is scoped to the current phase type, the
    // `!allowedTools.has(toolName)` check below is itself the phase gate: e.g.
    // open_scratchpad is absent (and therefore rejected) outside a system_design
    // phase, open_screening_workspace outside coding/cs_sql, open_notepad outside
    // behavioral/custom. The server resolves the phase type from its pointer.
    if (ctx.companyScreening) {
        for (const name of screeningToolNamesForPhase(ctx.companyScreeningCurrentPhaseType, ctx.currentStage === "CLOSING")) {
            allowedTools.add(name);
        }
    }

    if (!allowedTools.has(toolName)) {
        return {
            valid: false,
            message: `Tool ${toolName} is not allowed in stage ${ctx.currentStage}.`,
        };
    }

    const history = getHistory(ctx.sessionId);
    for (const rule of manifest.forbiddenSequences || []) {
        const sequence = rule.forbiddenSequence;
        if (sequence.length === 0) continue;

        const suffix = [...history.slice(-(sequence.length - 1)), toolName];
        if (suffix.length === sequence.length && suffix.every((value, index) => value === sequence[index])) {
            return {
                valid: false,
                message: `Forbidden tool sequence: ${sequence.join(" -> ")}. ${rule.reason}`,
            };
        }
    }

    if (toolName === "open_ide") {
        const requestedQuestionId = args?.questionId;
        // Accept: explicit questionId, last fetched DSA, prefetched DSA, prefetched GenAI coding,
        // OR prefetched DS coding question.
        const genAICodingId = ctx.prefetchedGenAICodingQuestion?.questionId ?? null;
        const dsCodingId = ctx.prefetchedDSCodingQuestion?.questionId ?? null;
        const fallbackQuestionId = requestedQuestionId || ctx.lastFetchedQuestionId || ctx.prefetchedDSAQuestion?.id || genAICodingId || dsCodingId;
        if (!fallbackQuestionId) {
            return {
                valid: false,
                message: "open_ide blocked: missing questionId and no prefetched/fetched fallback in session state.",
            };
        }
    }

    if (toolName === "open_sql_editor") {
        const hasSqlInCache = [...ctx.cachedQuestionData.values()].some((q) => q?.category === "SQL");
        const hasPrefetchedDSSql = !!ctx.prefetchedDSSQLQuestion?.questionId;
        if (!hasSqlInCache && !hasPrefetchedDSSql) {
            return {
                valid: false,
                message: "No pre-fetched SQL question is available in session cache.",
            };
        }
    }

    if (toolName === "transition_stage") {
        const nextStage = args?.nextStage;
        if (!nextStage || !ctx.stageOrder.includes(nextStage)) {
            return {
                valid: false,
                message: `transition_stage blocked: invalid nextStage ${String(nextStage)}.`,
            };
        }
    }

    // Server-authoritative screening pointer: the AI may only tag / open the
    // workspace for the question the SERVER has assigned this turn. This prevents
    // the model from skipping ahead, revisiting, or mis-tagging the transcript.
    if (
        ctx.companyScreening &&
        (toolName === "record_screening_question" || toolName === "open_screening_workspace") &&
        ctx.companyScreeningCurrentQuestionId &&
        args?.questionId &&
        args.questionId !== ctx.companyScreeningCurrentQuestionId
    ) {
        return {
            valid: false,
            message: `${toolName} blocked: the server-assigned current question is ${ctx.companyScreeningCurrentQuestionId}, not ${String(args.questionId)}. Ask only the assigned question; the server advances the agenda.`,
        };
    }

    // NOTE: record_question stage gating is handled by stageTools config per interview type.
    // Do NOT add a hard-coded stage check here — gen_ai_role needs record_question in GEN_AI_CONCEPTS,
    // cs_fundamentals needs it in FUNDAMENTALS, and future types may need it elsewhere.

    return { valid: true };
}

export function recordToolCall(sessionId: string, toolName: string): void {
    const history = getHistory(sessionId);
    const updated = [...history, toolName];
    if (updated.length > MAX_TOOL_HISTORY) {
        updated.splice(0, updated.length - MAX_TOOL_HISTORY);
    }
    toolHistoryBySession.set(sessionId, updated);
}
