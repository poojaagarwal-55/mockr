// ============================================
// AI Interview Agent — Orchestrator
// ============================================
// The core agent loop. Uses the OpenAI-compatible SDK
// pointed at xAI Grok for full control over tool calling
// and streaming. Type-aware: loads per-type stage flow,
// tools, and prompts.

import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import mongoose from "mongoose";
import { prisma } from "../../lib/prisma.js";
import { ensureMongoDBConnected } from "../../lib/mongoose.js";
import { DSAQuestion } from "../../models/DSAQuestion.js";
import { SystemDesignQuestion } from "../../models/system-design-question.js";
import { normalizeDSAQuestion } from "../../lib/question-helpers.js";
import { prefetchCSFundamentalsQuestions as prefetchCSFundamentals } from "./cs-prefetch.js";
import { prefetchGenAIQuestions } from "./genai-prefetch.js";
import { prefetchDSQuestions } from "./ds-prefetch.js";
import { prefetchPMQuestions } from "./pm-prefetch.js";
import type { PMCaseEntry, PMConceptEntry, PMStrategyEntry } from "./pm-prefetch.js";
import {
    prefetchProblemSolvingCaseQuestion,
    type ProblemSolvingCaseEntry,
} from "./problem-solving-prefetch.js";
import { getXAIClient, XAI_MODEL } from "../../lib/xai.js";
import { buildSystemPrompt } from "./agent-prompts.js";
import { addAskedQuestion, getAskedQuestions } from "../../lib/redis.js";
import { getToolsForSession, type ToolContext } from "./agent-tools.js";
import { getNextEnabledStage, resolveEffectiveInterviewTypeConfig } from "./interview-module-selection.js";
import { handleToolCall } from "./tool-handlers.js";
import { buildServerActionPlan } from "./server-action-planner.js";
import {
    createInitialResumeProbeState,
    inferResumeProbeDepthFromQuestion,
    inferResumeProjectNameFromText,
    markResumeProbeAsked,
} from "./resume-probe-state.js";
import {
    buildResumeAgendaNotice,
    createInitialResumeAgendaState,
    declineActiveResumeAgendaItem,
    getActiveResumeAgendaItem,
    getResumeAgendaItemTurnLimit,
    nextUnaskedResumeAgendaIntent,
    updateResumeAgendaAfterProbe,
} from "./resume-agenda-state.js";
import {
    buildResumeWebContextNotification,
    prefetchResumeWebContext,
} from "./resume-web-context.js";
import { buildUnavailableToolNotice, splitToolCallsByAvailability } from "./tool-call-sanitizer.js";
import { validatePrefetchState } from "./prefetch-state-validator.js";
import { buildInterviewOpeningMessage } from "./interview-opening.js";
import {
    buildCompanyScreeningOpeningMessage,
    buildCompanyScreeningRuntimeDirective,
    normalizeCompanyScreeningRuntimeContext,
    type CompanyScreeningRuntimeContext,
    type CompanyScreeningAuthoritativeTurn,
} from "../company-ai-screening/prompt.js";
import {
    computeScreeningPlan,
    createScreeningProgress,
    type ScreeningPlan,
    type ScreeningProgress,
} from "../company-ai-screening/pacing.js";
import {
    resolveScreeningAuthoritativeTurn,
    isScreeningSkip,
    seedScreeningResumeAgenda,
    extractCandidateProjectFacts,
    mergeCandidateProjectsIntoResume,
    extractCandidateProjectVerification,
    buildResumeVerificationGrounding,
    resumeVerificationSecrets,
    buildScreeningPhaseTransitionNotice,
} from "../company-ai-screening/screening-turn.js";
import { collectScreeningSecrets, redactScreeningLeak } from "../company-ai-screening/leak-guard.js";
import type { ScreeningPhaseType } from "../company-ai-screening/blueprint.js";
import {
    advanceCompanyScreeningMockCursor,
    buildCompanyScreeningMockPrompt,
    deriveCompanyScreeningMockPosition,
    isCompanyScreeningMockInterviewerEnabled,
    type CompanyScreeningMockCursor,
} from "../company-ai-screening/mock-interviewer.js";
import { prefetchCompanyScreeningBankQuestions } from "../company-ai-screening/question-prefetch.js";
import { buildScreeningTools } from "../company-ai-screening/screening-tools.js";
import { isClosingAcknowledgement, isCloseoutQuestion, isEndInterviewIntent, isQuestionOfferAffirmation } from "../interview-end-intent.js";
import { findLeastRecentlySeenMongoDoc, findRandomMongoDoc, getSeenQuestionIds, recordQuestionExposure, toMongoObjectIds } from "../question-exposure.js";
import { isDsaAdvanceIntent } from "../interview-progress-intent.js";
import { updateStreakForUser } from "../streak-service.js";
import { settleInterviewMinuteReservation } from "../entitlements.js";
import {
    isFundamentalsToSqlIntent,
    hasRecentRepeatedAssistantQuestion,
    hasConsecutiveUnknownResponses,
    isIntroToDsaAdvanceIntent,
    isLikelyFundamentalsHandoffPrompt,
    isLikelyCodingRoundPrompt,
    isLikelySqlRoundPrompt,
    isLikelySystemDesignPrompt,
    hasRecentSqlRoundSignals,
    isGenericMoveOnIntent,
    isSqlAdvanceIntent,
    isUnknownResponseIntent,
} from "../interview-turn-guard.js";
import type { InterviewStage, InterviewType } from "@interviewforge/shared";
import { MAX_CONTEXT_MESSAGES } from "@interviewforge/shared";
import { isVoiceSessionActive } from "../voice-pipeline.js";
import type { SharedInterviewTurnState, ResumeAgendaState } from "./interview-runtime-types.js";

let messageCounter = 0;

/** Max user exchanges in SYSTEM_DESIGN before we force-open the scratchpad */
const SD_SCRATCHPAD_FORCE_THRESHOLD = 3;
/** Exact user exchanges in System Design INTRO before server hands off to the design problem. */
const SYSTEM_DESIGN_INTRO_FORCE_TRANSITION_THRESHOLD = 3;
/** Max user exchanges in Full Interview INTRO before the server hard-hands off to DSA. */
const FULL_INTERVIEW_INTRO_FORCE_TRANSITION_THRESHOLD = 7;
/** Max user exchanges in role-specific resume/project intros before server hands off. */
const DATA_SCIENCE_INTRO_FORCE_TRANSITION_THRESHOLD = 4;
const GENAI_INTRO_FORCE_TRANSITION_THRESHOLD = 4;
const PM_INTRO_FORCE_TRANSITION_THRESHOLD = 8;
const RESUME_WEB_SEARCH_TYPES = new Set<InterviewType>([
    "full_interview",
    "gen_ai_role",
    "data_science_role",
    "pm_role",
]);

function isBareSkipIntent(text: string): boolean {
    return /^(?:ok(?:ay)?[,\s]*)?(?:skip|next|next question|next one|move on)$/i.test(text.trim());
}

function isBehaviouralNonAnswer(text: string): boolean {
    const normalized = text.trim().toLowerCase();
    if (!normalized || normalized.startsWith("[system notification]")) return false;
    return /^(?:skip|pass|next|next question|next one|move on|no|nope|nah|don't know|dont know|do not know|can't answer|cant answer|nothing)$/i.test(normalized) ||
        /\b(fuck|stupid|idiot|bitch|stop\s+asking|already\s+(said|told)\s+you|not\s+going\s+to\s+repeat|i\s+won'?t\s+answer)\b/i.test(text);
}

function countBehaviouralNonAnswers(history: ChatCompletionMessageParam[]): number {
    return history.filter((message) =>
        message.role === "user" &&
        typeof message.content === "string" &&
        isBehaviouralNonAnswer(message.content)
    ).length;
}

function isWeakGenAIIntroAnswer(text: string): boolean {
    const normalized = text.trim().toLowerCase();
    if (!normalized || normalized.startsWith("[system notification]")) return false;
    return /^(?:no|nope|nah|skip|pass|next|next question|move on|no idea|dont know|don't know|do not know|nothing)$/i.test(normalized) ||
        /\b(made by llm|llm made|ai made|not made by me|no idea|don'?t know|skip)\b/i.test(text);
}

function countWeakGenAIIntroAnswers(history: ChatCompletionMessageParam[]): number {
    return history.filter((message) =>
        message.role === "user" &&
        typeof message.content === "string" &&
        isWeakGenAIIntroAnswer(message.content)
    ).length;
}

function didAssistantAskWrapUpQuestion(history: ChatCompletionMessageParam[]): boolean {
    const lastAssistant = [...history].reverse().find((m) => m.role === "assistant");
    const content = typeof lastAssistant?.content === "string" ? lastAssistant.content.toLowerCase() : "";
    return (
        content.includes("do you have any questions") ||
        content.includes("let's wrap this up") ||
        content.includes("let us wrap this up")
    );
}

function hasPrematureClosingLanguage(text: string): boolean {
    if (!text.trim()) return false;
    return /\b(we'?re\s+done|we\s+have\s+reached\s+the\s+end|end\s+of\s+the\s+interview|thanks\s+for\s+your\s+time|we\s+can\s+conclude|let'?s\s+wrap\s+up)\b/i.test(text);
}

function didAssistantOfferDSConcepts(history: ChatCompletionMessageParam[]): boolean {
    const lastAssistant = [...history].reverse().find((m) => m.role === "assistant");
    const content = typeof lastAssistant?.content === "string" ? lastAssistant.content.toLowerCase() : "";
    return /\b(conceptual questions|concept questions|data science conceptual|statistics and ml fundamentals|ds fundamentals)\b/i.test(content);
}

function isShortAffirmative(text: string): boolean {
    return /^(yes|yeah|yep|yup|yea|yez|sure|okay|ok|go ahead|let'?s do it|continue)\b/i.test(text.trim());
}

function hasFinalClosingLanguage(text: string): boolean {
    if (!text.trim()) return false;
    return /\b(that'?s\s+(it|all)\s+for\s+today|that\s+is\s+(it|all)\s+for\s+today|this\s+concludes\s+(our\s+)?interview|that\s+concludes\s+(our\s+)?interview|the\s+interview\s+is\s+now\s+complete|interview\s+complete|we'?re\s+done|we\s+are\s+done|we\s+have\s+reached\s+the\s+end|end\s+of\s+the\s+interview|thanks\s+for\s+your\s+time|thank\s+you\s+for\s+your\s+time|thanks\s+for\s+joining|thank\s+you\s+for\s+joining|goodbye|we\s+can\s+conclude)\b/i.test(text);
}

function hasGenAICodingHandoffLanguage(text: string): boolean {
    if (!text.trim()) return false;
    return /\b(move|moving|shift|switch|go|let'?s|we'?ll|we\s+will|next)\b[\s\S]{0,100}\b(coding|code|programming|implementation|editor|ide|task|problem)\b/i.test(text);
}

function hasDSConceptHandoffLanguage(text: string): boolean {
    if (!text.trim()) return false;
    return /\b(move|moving|shift|switch|go|let'?s|we'?ll|we\s+will|continue|proceed)\b[\s\S]{0,120}\b(conceptual|concepts?|statistics|machine learning|ml fundamentals|fundamentals)\b/i.test(text);
}

function isLikelyDSConceptQuestion(text: string): boolean {
    if (!text.trim()) return false;
    return /\b(bias[- ]variance|overfitting|underfitting|supervised|unsupervised|random forest|decision tree|precision|recall|f1|roc|auc|pr[- ]auc|pca|regularization|lasso|ridge|classification|regression|clustering|hypothesis|p[- ]value|confidence interval|gradient descent)\b/i.test(text);
}

function hasDSSQLHandoffLanguage(text: string): boolean {
    if (!text.trim()) return false;
    return /\b(move|moving|shift|switch|go|let'?s|we'?ll|we\s+will|next|continue|proceed)\b[\s\S]{0,120}\b(sql|query|database|table)\b/i.test(text) ||
        /\b(i'?ve|i have|we'?ve|we have)\s+loaded\b[\s\S]{0,100}\b(sql|query|editor)\b/i.test(text) ||
        /\bsql\s+problem\b[\s\S]{0,80}\b(editor|loaded|read)\b/i.test(text) ||
        /\b(write|compose|build)\b[\s\S]{0,80}\b(sql|query)\b/i.test(text);
}

function hasDSCodingHandoffLanguage(text: string): boolean {
    if (!text.trim()) return false;
    return /\b(move|moving|shift|switch|go|let'?s|we'?ll|we\s+will|next|continue|proceed)\b[\s\S]{0,120}\b(coding|code|python|pandas|data analysis|notebook|ide|programming)\b/i.test(text);
}

// ── In-memory session state ──────────────────────────────────
// Stores the conversation history and live state per session.
// In production, back this with Redis for horizontal scaling.


function shouldEnableResumeWebSearch(state: SessionState): boolean {
    return (
        state.currentStage === "INTRO" &&
        RESUME_WEB_SEARCH_TYPES.has(state.interviewType) &&
        !!state.resumeSummary &&
        !state.resumeWebSearchUsed
    );
}

/**
 * Calls xAI Responses API (NOT chat.completions) with web_search enabled
 * to get live, grounded context about the candidate's companies/projects.
 * Result is injected as a [SYSTEM NOTIFICATION] into history — same pattern
 * used by PM_CASE, SD, DS_SQL etc. Non-fatal: if it fails, interview continues
 * without the extra context.
 */
function rememberResumeProbeQuestionFromAssistant(state: SessionState, assistantText: string): void {
    if (state.currentStage !== "INTRO" || !RESUME_WEB_SEARCH_TYPES.has(state.interviewType) || !assistantText.trim()) {
        return;
    }
    const depth = inferResumeProbeDepthFromQuestion(assistantText);
    if (!depth) return;

    const projectName =
        inferResumeProjectNameFromText(assistantText, state.resumeSummary) ||
        state.resumeProbeState?.activeProjectName;
    state.resumeProbeState = markResumeProbeAsked(state.resumeProbeState, projectName, depth);
}

interface SessionState extends SharedInterviewTurnState {
    sessionId: string;
    userId: string;
    interviewType: InterviewType;
    role: string;
    level: string;
    currentStage: InterviewStage;
    /** Ordered stages for this interview type */
    stageOrder: InterviewStage[];
    /** Wall-clock start for the current stage; used for server-owned pacing. */
    stageStartedAtMs: number;
    resumeSummary: any | null;
    resumeStageNonAnswerCounts: Partial<Record<InterviewStage, number>>;
    resumeDeclinedStages: InterviewStage[];
    resumeAgendaWeakAnswerCounts: Record<string, number>;
    resumeAgendaQuestionCounts: Record<string, number>;
    askedQuestionIds: string[];
    codeSnapshot: string | null;
    codeLanguage: string | null;
    sqlSnapshot: string | null;
    /** Full problem description of the current SQL question (for system prompt context) */
    sqlQuestionDescription: string | null;
    /** True when the SQL round has been intentionally completed or skipped */
    sqlRoundCompleted?: boolean;
    currentQuestionTitle: string | null;
    lastFetchedQuestionId: string | null;
    lastFetchedLanguage: string | null;
    /** Pre-fetched DSA question (loaded at session init for instant IDE opening) */
    prefetchedDSAQuestion: any | null;
    /** Pre-fetched System Design question (loaded at session init — replaces runtime fetch_question) */
    prefetchedSDQuestion: any | null;
    /** Cached full question data from fetch_question (avoids redundant DB query in open_ide) */
    cachedQuestionData: Map<string, any>;
    history: ChatCompletionMessageParam[];
    /** Whether the scratchpad has been opened in this session */
    scratchpadOpened?: boolean;
    /** Counts user exchanges in the SYSTEM_DESIGN stage */
    systemDesignExchangeCount: number;
    /** Counts user exchanges in INTRO for role-specific server cutoffs */
    introExchangeCount: number;
    /** System design: rubricLite from MongoDB question */
    rubricLite?: any;
    /** System design: latest Excalidraw canvas JSON */
    canvasSnapshot?: any;
    /** PM case: latest Tiptap notepad HTML snapshot */
    notepadSnapshot?: string | null;
    /** Pre-fetched CS Fundamental questions organized by category */
    prefetchedCSQuestions?: Map<string, Array<{ questionId: string; questionText: string; referenceAnswer: string }>>;
    /** Pre-fetched SQL question for CS Fundamentals SQL IDE round */
    prefetchedSQLQuestion?: any;
    /** Pre-fetched GenAI concept questions (gen_ai_role) */
    prefetchedGenAIConceptQuestions?: Array<{
        questionId: string;
        subtopic: string;
        questionText: string;
        /** Concise reference answer — LLM evaluation only, never revealed */
        referenceAnswer: string;
        // detailedAnswer intentionally absent — post-session reports only
        difficulty: string;
    }>;
    /** Pre-fetched GenAI coding task (gen_ai_role) */
    prefetchedGenAICodingQuestion?: {
        questionId: string;
        title: string;
        taskType: string;
        problemStatement: string;
        starterCode?: string;
        sampleTestCases: Array<{ id: string; description: string; input: string; expectedOutput: string }>;
        conciseSolution?: string;
        sampleSolution?: string;
        evaluationCriteria: string;
        mutationQuestions: string[];
        hints: string[];
        // detailedSolution intentionally absent — post-session reports only
        difficulty: string;
    } | null;
    /** Pre-fetched GenAI system design architecture problem (gen_ai_role) */
    prefetchedGenAISystemDesignQuestion?: {
        questionId: string;
        category: string;
        title: string;
        problemStatement: string;
        difficulty: string;
        rubricLite: {
            requiredComponents: string[];
            keyTradeoffs: string[];
            antiPatterns: string[];
            probeQuestions: string[];
        };
    } | null;
    // ── Data Science Role prefetch fields ─────────────────────
    /** Pre-fetched DS concept questions (data_science_role) */
    prefetchedDSConceptQuestions?: any[];
    /** Pre-fetched DS SQL question (data_science_role) */
    prefetchedDSSQLQuestion?: any | null;
    /** Pre-fetched DS coding question (data_science_role) */
    prefetchedDSCodingQuestion?: any | null;
    // ── Product Manager Role prefetch fields ───────────────────
    /** Pre-fetched PM case question (pm_role) */
    prefetchedPMCaseQuestion: PMCaseEntry | null;
    /** Pre-fetched PM concept questions (pm_role) */
    prefetchedPMConceptQuestions: PMConceptEntry[];
    /** Pre-fetched PM strategy question (pm_role) */
    prefetchedPMStrategyQuestion: PMStrategyEntry | null;
    /** Pre-fetched analytical case (problem_solving_case) */
    prefetchedProblemSolvingCaseQuestion: ProblemSolvingCaseEntry | null;
    /** Whether the problem-solving notepad has already been opened */
    problemSolvingNotepadOpened?: boolean;
    /** Timer: fires at 5 min — approach reminder if candidate hasn't articulated an approach */
    sqlApproachTimer: NodeJS.Timeout | null;
    /** Timer: fires at 10 min — query reminder if candidate hasn't written any SQL yet */
    sqlQueryTimer: NodeJS.Timeout | null;
    /** Timer: fires after 15 min total in SQL round — AI moves to next stage */
    sqlTotalTimer: NodeJS.Timeout | null;
    /** Timer: fires at 20 min in DSA round — pacing reminder */
    dsa20Timer: NodeJS.Timeout | null;
    /** Timer: fires at 25 min in DSA round — final warning */
    dsa25Timer: NodeJS.Timeout | null;
    /** Timer: fires at 30 min in DSA round — hard timeout */
    dsa30Timer: NodeJS.Timeout | null;
    /** True while processAgentTurn is running — prevents reentrant concurrent LLM calls from timer nudges */
    turnInFlight: boolean;
    pendingUserMessages: string[];
    /** Whether the SQL editor has been opened in this session (prevents double-open) */
    sqlEditorOpened?: boolean;
    /** Explicit fundamentals sub-phase tracking: DBMS → SQL → OS → CN → OOPS */
    currentFundamentalsPhase?: string;
    /** Push-to-Talk: whether PTT mode is enabled for this session */
    pttEnabled: boolean;
    /** Push-to-Talk: whether spacebar is currently held down */
    pttHolding: boolean;
    /** Push-to-Talk: buffered transcript segments while holding spacebar */
    transcriptBuffer: string[];
    /** Push-to-Talk: timestamp of last transcript received (for timeout detection) */
    lastTranscriptAt: number;
    /** Wall-clock start of the interview session; used for live screening pacing. */
    startedAt?: Date | string;
    /** Company-owned AI screening blueprint context. Practice interviews leave this empty. */
    companyScreening?: CompanyScreeningRuntimeContext | null;
    companyScreeningMockCursor?: CompanyScreeningMockCursor | null;
    companyScreeningMockWaitingForAnswer?: boolean;
    companyScreeningMockCompleted?: boolean;
    /** Blueprint question ids the screening interviewer has reached (Section 0 tagging + pacing). */
    companyScreeningAskedQuestionIds?: Set<string>;
    /** Blueprint question currently being asked; tags persisted turn messages. */
    companyScreeningCurrentQuestionId?: string | null;
    /** Phase TYPE owning the current question; drives the phase-scoped tool whitelist. */
    companyScreeningCurrentPhaseType?: ScreeningPhaseType | null;
    /** Server-computed static time/depth budget plan (built once at session init). */
    companyScreeningPlan?: ScreeningPlan | null;
    /** Server-authoritative live progress (pointer, answered set, follow-up counts). */
    companyScreeningProgress?: ScreeningProgress | null;
    /** Server-owned resume agenda driving the screening resume phase (null when no parsed resume). */
    companyScreeningResumeAgenda?: ResumeAgendaState | null;
    /** Evaluation-only GitHub verification grounding, injected ONLY into the resume phase. */
    companyScreeningGithubVerification?: string | null;
    /** Factual GitHub verification strings for the leak-guard to redact (never revealed). */
    companyScreeningGithubVerificationSecrets?: string[];
    /** True once the server has forced CLOSING (so we only inject the notice once). */
    companyScreeningClosingForced?: boolean;
    /**
     * True once the interviewer has offered the closing "any questions about the
     * company or role?" turn. Gates the two-step screening close: first turn offers
     * the question, the next turn (after the candidate responds) actually ends.
     */
    companyScreeningClosingQuestionOffered?: boolean;
    /** Max-duration watchdog timer handle; ends the interview even on candidate silence. */
    companyScreeningWatchdog?: ReturnType<typeof setTimeout> | null;
    /** True once the screening has been hard-ended (watchdog or graceful close); idempotency guard. */
    companyScreeningEnded?: boolean;
}

const activeSessions = new Map<string, SessionState>();

function buildSystemDesignPanelPayload(
    state: Pick<SessionState, "currentStage" | "currentQuestionTitle" | "prefetchedSDQuestion">
) {
    const sdQuestion = state.prefetchedSDQuestion;
    const title = sdQuestion?.title || state.currentQuestionTitle || "System Design";
    return {
        type: "scratchpad",
        stage: "SYSTEM_DESIGN",
        topic: title,
        initialContent: "",
        candidateBrief: `Design ${title}. Clarify the requirements, outline the architecture, and explain the trade-offs behind your choices.`,
        question: sdQuestion
            ? {
                id: sdQuestion.id,
                title: sdQuestion.title,
                problemStatement: sdQuestion.problemStatement,
            }
            : {
                id: `sd_${title.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
                title,
                problemStatement: `Design ${title}.`,
            },
    };
}

function hasDeliveredSystemDesignIntro(
    history: ChatCompletionMessageParam[],
    title: string | null | undefined
): boolean {
    const normalizedTitle = String(title || "").trim().toLowerCase();
    return history.some((msg) => {
        if (msg.role !== "assistant" || typeof msg.content !== "string") return false;
        const content = msg.content.toLowerCase();
        return (
            content.includes("let's design") &&
            (!normalizedTitle || content.includes(normalizedTitle))
        );
    });
}

async function sendServerSystemDesignIntro(
    state: SessionState,
    emit: (event: string, payload: any) => void,
    bridgeMessageId?: string
): Promise<void> {
    if (!state.prefetchedSDQuestion) return;

    const sdTitle = state.prefetchedSDQuestion.title;
    if (!state.scratchpadOpened) {
        emit("panel:open", buildSystemDesignPanelPayload(state));
        state.scratchpadOpened = true;
    }

    const sdIntroContent =
        `Let's design ${sdTitle}. The whiteboard is already open. ` +
        `Go ahead and start sketching your design and walk me through your thinking. ` +
        `Let's begin by discussing the functional and non-functional requirements.`;

    const messageId = bridgeMessageId || `msg_${Date.now()}_${++messageCounter}`;
    emit("ai:token", { token: "", messageId });
    emit("ai:token", { token: sdIntroContent, messageId });
    emit("ai:done", { messageId, fullContent: sdIntroContent });

    state.history.push({ role: "assistant", content: sdIntroContent });
    await prisma.sessionMessage.create({
        data: { sessionId: state.sessionId, role: "assistant", content: sdIntroContent, stage: "SYSTEM_DESIGN" },
    });
}

const RESUME_ROUND_TIMED_STAGES = new Set<InterviewStage>([
    "RESUME_STUDIES",
    "RESUME_PROJECTS",
    "RESUME_EXPERIENCE",
    "RESUME_RESPONSIBILITY",
    "RESUME_SKILLS",
]);

function getConfiguredStageDurationMinutes(state: SessionState): { min: number; max: number } | null {
    const configured = state.moduleConfig?.stageDurations?.[state.currentStage];
    if (
        configured &&
        typeof configured.min === "number" &&
        typeof configured.max === "number" &&
        configured.max >= configured.min
    ) {
        return configured;
    }

    const effectiveConfig = resolveEffectiveInterviewTypeConfig(state.interviewType, state.moduleConfig);
    return effectiveConfig.stageDurations[state.currentStage] || null;
}

function buildResumeStageRuntimeDirective(state: SessionState): string | null {
    if (state.interviewType !== "resume_round" || !RESUME_ROUND_TIMED_STAGES.has(state.currentStage)) {
        return null;
    }

    const duration = getConfiguredStageDurationMinutes(state);
    if (!duration) return null;

    const elapsedSec = Math.max(0, Math.floor((Date.now() - state.stageStartedAtMs) / 1000));
    const maxSec = duration.max * 60;
    const softLimitSec = Math.max(30, Math.floor(maxSec * 0.85));
    const remainingSec = Math.max(0, maxSec - elapsedSec);

    const projectDirective = state.currentStage === "RESUME_PROJECTS"
        ? buildResumeProjectCoverageDirective(state)
        : "";

    if (elapsedSec >= maxSec) {
        return `## Server Runtime Directive
The current resume-screening stage has reached its hard time budget. Do not ask another question in this stage. In this response, briefly acknowledge the last answer and silently call transition_stage to the next enabled stage.${projectDirective}`;
    }

    if (elapsedSec >= softLimitSec) {
        return `## Server Runtime Directive
The current resume-screening stage is inside its wrap-up window with about ${remainingSec} seconds left. Ask at most one concise closing evidence question for this stage, or call transition_stage now if enough evidence is already collected. Do not open a new technical branch.${projectDirective}`;
    }

    return `## Server Runtime Directive
Current stage elapsed time: ${elapsedSec}s. Stage hard budget: ${maxSec}s. Keep depth proportional to this budget and ask exactly one question at a time.${projectDirective}`;
}

function buildResumeProjectCoverageDirective(state: SessionState): string {
    const projects = Array.isArray(state.resumeSummary?.projects)
        ? state.resumeSummary.projects
            .map((project: any) => project?.name)
            .filter((name: any): name is string => typeof name === "string" && name.trim().length > 0)
        : [];
    const projectCount = projects.length;
    const askedKeys = state.resumeProbeState?.askedProbeKeys || [];
    const projectDepths = new Map<string, Set<string>>();

    for (const key of askedKeys) {
        const [rawProject, rawDepth] = key.split("::");
        if (!rawProject || !rawDepth || rawProject === "unknown") continue;
        const depths = projectDepths.get(rawProject) || new Set<string>();
        depths.add(rawDepth);
        projectDepths.set(rawProject, depths);
    }

    const deepProjects = [...projectDepths.entries()]
        .filter(([, depths]) => depths.has("implementation") || depths.has("tradeoffs") || depths.has("failure_depth") || depths.has("senior_depth"))
        .map(([project]) => project);
    const scannedProjects = [...projectDepths.keys()].filter((project) => !deepProjects.includes(project));
    const maxDeepProjects = projectCount >= 3 ? 2 : Math.max(1, projectCount || 2);
    const maxRapidScans = projectCount >= 6 ? 3 : projectCount >= 3 ? 2 : 0;
    const duration = getConfiguredStageDurationMinutes(state);
    const elapsedSec = Math.max(0, Math.floor((Date.now() - state.stageStartedAtMs) / 1000));
    const maxSec = (duration?.max || 18) * 60;
    const optionalThirdDeepAllowed =
        projectCount >= 3 &&
        deepProjects.length === 2 &&
        elapsedSec < Math.floor(maxSec * 0.55) &&
        (state.resumeProbeState?.lastAnswerQuality === "strong" || !state.resumeProbeState?.lastAnswerQuality);

    const lines = [
        "",
        "",
        "### Project Coverage Budget",
        `Resume project count: ${projectCount || "unknown"}.`,
        `Normal deep-project cap: ${maxDeepProjects}. Optional third deep project is allowed only when the first two are concise, answers are strong, and this stage is still far from the wrap-up window.`,
        `Max rapid-scan projects after deep dives: ${maxRapidScans}.`,
        `Deep projects already detected: ${deepProjects.length ? deepProjects.join(", ") : "none"}.`,
        `Rapid/light scans already detected: ${scannedProjects.length ? scannedProjects.join(", ") : "none"}.`,
    ];

    if (deepProjects.length >= maxDeepProjects && projectCount >= 3 && !optionalThirdDeepAllowed) {
        lines.push("You have reached the normal deep-project cap. Do not start another deep dive. Either ask one rapid ownership/risk-scan question on a remaining project, or transition if enough evidence is collected.");
    } else if (optionalThirdDeepAllowed) {
        lines.push("A third deep project is still allowed by budget, but only if it is clearly stronger or more role-relevant than the remaining rapid-scan candidates. Keep it shorter than the first two.");
    }
    if (scannedProjects.length >= maxRapidScans && maxRapidScans > 0) {
        lines.push("You have reached the rapid-scan cap. Do not start another project. Wrap up this stage or transition.");
    }

    lines.push("Never attempt to fully verify every project. Uncovered projects should remain marked as unverified due to time.");
    return lines.join("\n");
}

function isResumeRoundNonAnswer(text: string): boolean {
    const normalized = text.trim().toLowerCase();
    if (!normalized || normalized.startsWith("[system notification]")) return false;
    return /^(?:hello\??|ok|okay|skip|pass|next|next question|next one|move on|no|nope|nah|nothing|no idea|don'?t know|dont know|do not know|not sure|not so sure|not really|can'?t answer|cant answer|not comfortable)$/i.test(normalized);
}

function isExplicitResumeItemDecline(text: string): boolean {
    const normalized = text.trim().toLowerCase();
    return /^(?:skip|pass|next|next question|next one|move on|not my part|not done by me|not made by me|i did not do this|i don't want to discuss this|i do not want to discuss this)$/i.test(normalized);
}

function isWeakResumeAgendaAnswer(text: string): boolean {
    const normalized = text.trim().toLowerCase();
    if (!normalized || normalized.startsWith("[system notification]")) return false;
    return isResumeRoundNonAnswer(text) ||
        /\b(gave orders to llm|just gave orders|llm did it|llm made it|ai did it|ai made it|not sure|not so sure|not really|no idea|don'?t remember|nothing much|random|all by ai tools|no part|nothing really)\b/i.test(normalized);
}

function resumeAgendaWeakLimit(state: SessionState): number {
    const active = getActiveResumeAgendaItem(state.resumeAgendaState);
    if (!active) return 1;
    if (active.mode === "rapid") return 2;
    if (active.type === "project") return 3;
    return 2;
}

function resumeNonAnswerLimit(stage: InterviewStage): number {
    if (stage === "RESUME_STUDIES") return 1;
    if (stage === "RESUME_RESPONSIBILITY") return 2;
    if (stage === "RESUME_SKILLS") return 2;
    if (stage === "RESUME_EXPERIENCE") return 1;
    if (stage === "RESUME_PROJECTS") return 2;
    return 2;
}

function resumeAgendaIntentForCurrentItem(state: SessionState) {
    const active = getActiveResumeAgendaItem(state.resumeAgendaState);
    if (!active) return "overview";
    return active.askedIntents[active.askedIntents.length - 1] || "overview";
}

function rememberResumeAgendaAssistantQuestion(
    state: SessionState,
    assistantText: string,
    agendaItemIdAtTurnStart?: string
): void {
    if (state.interviewType !== "resume_round" || state.currentStage === "CLOSING") return;
    if (!assistantText.trim()) return;
    const itemId = agendaItemIdAtTurnStart || getActiveResumeAgendaItem(state.resumeAgendaState)?.id;
    if (!itemId) return;
    state.resumeAgendaQuestionCounts[itemId] = (state.resumeAgendaQuestionCounts[itemId] || 0) + 1;
}

/**
 * Interview types whose INTRO stage is a resume/project probe phase driven by the
 * record_resume_probe ladder. These all render a probe-ladder prompt block and expect
 * the silent record_resume_probe call after each answer. Kept in one place so the
 * server-side advance fallback (ensureResumeProbeRecordedAfterTurn) covers every one of
 * them — not just full_interview. (system_design INTRO is a 2–3 min intro with only
 * transition_stage, NOT a probe phase, so it is intentionally excluded.)
 */
const RESUME_PROBE_INTRO_TYPES = new Set([
    "full_interview",
    "pm_role",
    "gen_ai_role",
    "data_science_role",
]);

/** Stages/types where record_resume_probe is the expected per-turn bookkeeping call. */
function isResumeProbingTurn(state: SessionState): boolean {
    return (
        (state.interviewType === "resume_round" && RESUME_ROUND_TIMED_STAGES.has(state.currentStage)) ||
        (RESUME_PROBE_INTRO_TYPES.has(state.interviewType) && state.currentStage === "INTRO")
    );
}

/**
 * Server-driven safety net for the resume phase. The resume agenda + probe-ladder
 * state (turnCount, askedIntents, probe depth, askedProbeKeys) advance ONLY when
 * the model calls record_resume_probe. The model frequently asks the next question
 * but skips that "silent" tool call, which FREEZES the state — so the prompt is
 * rebuilt identically next turn and the interviewer re-asks the same question until
 * a distant hard cap trips. When a resume turn produced a question but recorded no
 * probe, synthesize one here (using the candidate's actual answer as evidence) so
 * the anti-repeat state always moves forward. Mirrors a real probe exactly by going
 * through handleToolCall, so BOTH resume_round (agenda block) and full_interview
 * (probe-ladder block) advance consistently.
 */
async function ensureResumeProbeRecordedAfterTurn(
    state: SessionState,
    toolCtx: ToolContext,
    userMessage: string | null,
    assistantText: string,
    probeRecordedThisTurn: boolean,
    agendaItemIdAtTurnStart: string | undefined
): Promise<void> {
    if (probeRecordedThisTurn) return;
    if (!isResumeProbingTurn(state)) return;
    // Only on a genuine candidate answer that drew a follow-up question — never on
    // synthetic greetings, acknowledgements, or pure transition lines.
    if (!userMessage || !userMessage.trim() || userMessage.trim().startsWith("[")) return;
    if (!assistantText.trim() || !assistantText.includes("?")) return;

    const activeItem = getActiveResumeAgendaItem(state.resumeAgendaState);
    const depth = state.resumeProbeState?.currentDepth || "overview";
    const intent = activeItem ? nextUnaskedResumeAgendaIntent(activeItem) : undefined;
    const answerQuality = isWeakResumeAgendaAnswer(userMessage) ? "weak" : "partial";

    try {
        await handleToolCall(
            "record_resume_probe",
            {
                agendaItemId: agendaItemIdAtTurnStart || activeItem?.id,
                depth,
                ...(intent ? { intent } : {}),
                answerQuality,
                evidence: userMessage.trim().slice(0, 800),
            },
            toolCtx
        );
        console.log(
            `[Orchestrator] Synthesized record_resume_probe for ${state.sessionId} ` +
            `(item=${activeItem?.id || "n/a"}, depth=${depth}, quality=${answerQuality}) — model skipped the probe call.`
        );
    } catch (err) {
        console.error(`[Orchestrator] Failed to synthesize resume probe for ${state.sessionId}:`, err);
    }
}

async function forceResumeAgendaAdvanceAfterAnsweredQuestionBudget(
    state: SessionState,
    emit: (event: string, payload: any) => void
): Promise<void> {
    if (state.interviewType !== "resume_round" || !RESUME_ROUND_TIMED_STAGES.has(state.currentStage)) {
        return;
    }

    const active = getActiveResumeAgendaItem(state.resumeAgendaState);
    if (!active) return;

    const askedCount = state.resumeAgendaQuestionCounts[active.id] || 0;
    if (askedCount < getResumeAgendaItemTurnLimit(active)) return;

    state.resumeAgendaState = updateResumeAgendaAfterProbe(state.resumeAgendaState, {
        agendaItemId: active.id,
        intent: resumeAgendaIntentForCurrentItem(state),
        answerQuality: "partial",
        shouldCloseItem: true,
    });

    const nextActive = getActiveResumeAgendaItem(state.resumeAgendaState);
    if (nextActive) {
        state.resumeAgendaWeakAnswerCounts[nextActive.id] = 0;
        state.resumeAgendaQuestionCounts[nextActive.id] ||= 0;
        state.history.push({
            role: "user",
            content:
                buildResumeAgendaNotice(state.resumeAgendaState) +
                " [SYSTEM NOTIFICATION] The previous item reached its server-enforced question budget after the candidate answered. Do not ask any follow-up about the previous item.",
        });
        return;
    }

    const toolCtx = buildToolContextForState(state, emit);
    const transitionResult = await handleToolCall(
        "transition_stage",
        { nextStage: "CLOSING", reason: "Server-owned resume agenda exhausted after hard question budgets." },
        toolCtx
    );
    if (transitionResult.startsWith("Interview transitioned")) {
        state.currentStage = "CLOSING";
        state.stageStartedAtMs = Date.now();
        state.history.push({
            role: "user",
            content:
                "[SYSTEM NOTIFICATION] Resume agenda is exhausted. Ask one brief closeout question now and wait for the candidate's response. Do not call end_interview until the candidate answers the closeout.",
        });
    }
}

function buildResumeStageAdvancedNotice(nextStage: InterviewStage): string {
    if (nextStage === "CLOSING") {
        return "[SYSTEM NOTIFICATION] The previous resume-screening stage is closed after repeated skips/refusals. Close the interview now. Do not ask another resume, project, academic, responsibility, or skills question.";
    }
    if (nextStage === "RESUME_PROJECTS") {
        return "[SYSTEM NOTIFICATION] Opening calibration is complete. Continue only with project verification now. Do not ask a follow-up about the candidate's target area, CS fundamentals, OS, academics, or role preference. Ask one concrete question about the strongest listed project.";
    }
    if (nextStage === "RESUME_SKILLS") {
        return "[SYSTEM NOTIFICATION] The previous resume-screening stage is closed after repeated skips/refusals. Continue only with fit and communication. Ask at most one concise role-fit or defensible-skill question. Do not return to projects, studies, experience, or responsibility.";
    }
    if (nextStage === "RESUME_RESPONSIBILITY") {
        return "[SYSTEM NOTIFICATION] The previous resume-screening stage is closed. Continue only with leadership/responsibility evidence. If the candidate mentions a project, use it only for ownership/responsibility context, not technical depth.";
    }
    return `[SYSTEM NOTIFICATION] The previous resume-screening stage is closed. Continue only with ${nextStage}. Do not return to earlier stages.`;
}

async function forceResumeStageTransitionAfterNonAnswers(
    state: SessionState,
    userMessage: string,
    emit: (event: string, payload: any) => void
): Promise<boolean> {
    if (state.interviewType !== "resume_round" || !RESUME_ROUND_TIMED_STAGES.has(state.currentStage)) {
        return false;
    }
    if (!isWeakResumeAgendaAnswer(userMessage)) {
        state.resumeStageNonAnswerCounts[state.currentStage] = 0;
        return false;
    }

    const active = getActiveResumeAgendaItem(state.resumeAgendaState);
    if (active) {
        const shouldCloseImmediately =
            isExplicitResumeItemDecline(userMessage) ||
            (active.mode === "rapid" && /^(?:no|nope|nah|skip|pass|move on|next)$/i.test(userMessage.trim())) ||
            (active.type !== "project" && /^(?:no|nope|nah|skip|pass|move on|next|no idea|not sure|not really)$/i.test(userMessage.trim()));
        const nextWeakCount = shouldCloseImmediately
            ? resumeAgendaWeakLimit(state)
            : (state.resumeAgendaWeakAnswerCounts[active.id] || 0) + 1;
        state.resumeAgendaWeakAnswerCounts[active.id] = nextWeakCount;

        if (nextWeakCount < resumeAgendaWeakLimit(state)) {
            return false;
        }

        state.resumeAgendaState = updateResumeAgendaAfterProbe(state.resumeAgendaState, {
            agendaItemId: active.id,
            intent: active.askedIntents[active.askedIntents.length - 1] || "overview",
            answerQuality: shouldCloseImmediately ? "declined" : "weak",
            shouldCloseItem: true,
        });
        const nextActive = getActiveResumeAgendaItem(state.resumeAgendaState);
        if (nextActive) {
            state.resumeAgendaWeakAnswerCounts[nextActive.id] = 0;
            state.history.push({
                role: "user",
                content: buildResumeAgendaNotice(state.resumeAgendaState),
            });
            return false;
        }
        const toolCtx = buildToolContextForState(state, emit);
        const transitionResult = await handleToolCall(
            "transition_stage",
            { nextStage: "CLOSING", reason: "Server-owned resume agenda exhausted after weak or declined answers." },
            toolCtx
        );
        if (transitionResult.startsWith("Interview transitioned")) {
            state.currentStage = "CLOSING";
            state.stageStartedAtMs = Date.now();
            state.history.push({
                role: "user",
                content: buildResumeAgendaNotice(state.resumeAgendaState),
            });
        }
        return false;
    }

    const currentStage = state.currentStage;
    const nextCount = (state.resumeStageNonAnswerCounts[currentStage] || 0) + 1;
    state.resumeStageNonAnswerCounts[currentStage] = nextCount;
    if (nextCount < resumeNonAnswerLimit(currentStage)) return false;

    if (!state.resumeDeclinedStages.includes(currentStage)) {
        state.resumeDeclinedStages.push(currentStage);
    }
    state.resumeAgendaState = declineActiveResumeAgendaItem(state.resumeAgendaState);

    const nextStage = getNextEnabledStage(state.stageOrder, currentStage);
    if (!nextStage) return false;

    const toolCtx = buildToolContextForState(state, emit);
    const transitionResult = await handleToolCall(
        "transition_stage",
        { nextStage, reason: `Candidate declined ${currentStage}; server advanced resume screening flow.` },
        toolCtx
    );
    if (!transitionResult.startsWith("Interview transitioned")) return false;

    state.currentStage = nextStage;
    state.stageStartedAtMs = Date.now();
    state.resumeStageNonAnswerCounts[nextStage] = 0;
    state.history.push({
        role: "user",
        content: buildResumeAgendaNotice(state.resumeAgendaState),
    });
    return false;
}

async function forceResumeOpeningCalibrationTransition(
    state: SessionState,
    userMessage: string,
    emit: (event: string, payload: any) => void
): Promise<boolean> {
    if (
        state.interviewType !== "resume_round" ||
        state.currentStage !== "RESUME_STUDIES" ||
        !userMessage.trim() ||
        userMessage.trim().toLowerCase().startsWith("[system notification]")
    ) {
        return false;
    }

    const nextStage = getNextEnabledStage(state.stageOrder, "RESUME_STUDIES");
    if (!nextStage) return false;

    const toolCtx = buildToolContextForState(state, emit);
    const transitionResult = await handleToolCall(
        "transition_stage",
        { nextStage, reason: "Resume opening calibration received one candidate answer; server advanced to the next resume section." },
        toolCtx
    );
    if (!transitionResult.startsWith("Interview transitioned")) return false;

    state.currentStage = nextStage;
    state.stageStartedAtMs = Date.now();
    state.resumeStageNonAnswerCounts[nextStage] = 0;
    state.history.push({
        role: "user",
        content: buildResumeAgendaNotice(state.resumeAgendaState),
    });
    return true;
}

async function forceResumeStageTransitionIfOverBudget(
    state: SessionState,
    emit: (event: string, payload: any) => void
): Promise<boolean> {
    if (state.interviewType !== "resume_round" || !RESUME_ROUND_TIMED_STAGES.has(state.currentStage)) {
        return false;
    }

    const duration = getConfiguredStageDurationMinutes(state);
    const nextStage = getNextEnabledStage(state.stageOrder, state.currentStage);
    if (!duration || !nextStage) return false;

    const elapsedMs = Date.now() - state.stageStartedAtMs;
    if (elapsedMs < duration.max * 60 * 1000) return false;

    const toolCtx = buildToolContextForState(state, emit);
    const result = await handleToolCall(
        "transition_stage",
        { nextStage, reason: "Server-enforced resume module time budget reached." },
        toolCtx
    );

    if (!result.startsWith("Interview transitioned")) return false;

    const previousStage = state.currentStage;
    state.currentStage = toolCtx.currentStage;
    state.stageStartedAtMs = Date.now();
    const content = nextStage === "CLOSING"
        ? "Thanks, I have enough evidence from this section. I am going to wrap up the screening now."
        : "Thanks, I have enough evidence from this section. I am going to move to the next part now.";
    const messageId = `msg_${Date.now()}_${++messageCounter}`;
    emit("ai:token", { token: "", messageId });
    emit("ai:token", { token: content, messageId });
    emit("ai:done", { messageId, fullContent: content });
    state.history.push({ role: "assistant", content });
    await prisma.sessionMessage.create({
        data: { sessionId: state.sessionId, role: "assistant", content, stage: previousStage },
    });

    setTimeout(() => {
        processAgentTurn(state.sessionId, null, emit).catch((err) => {
            console.error(`[Orchestrator] Resume budget transition kickoff error for ${state.sessionId}:`, err);
        });
    }, 0);

    return true;
}

/** Tags a persisted turn message with the current screening question id (Section 0). */
function companyScreeningStateMeta(state: SessionState): { metadata?: any } {
    return state.companyScreening && state.companyScreeningCurrentQuestionId
        ? { metadata: { companyScreeningQuestionId: state.companyScreeningCurrentQuestionId } }
        : {};
}

// NOTE: the blueprint-question lookup and resume-grounding now live in the shared
// company-ai-screening/screening-turn.ts module (findScreeningQuestionInBlueprint /
// buildScreeningResumeGrounding), driven through resolveScreeningAuthoritativeTurn so
// the text and voice paths pace identically.

/**
 * Hard-ends a company screening (watchdog backstop for candidate silence at the
 * time limit). Idempotent and company-only. Mirrors the mock-completion path:
 * marks the DB session COMPLETED, sends a final closing line, emits session:ending.
 */
async function forceEndCompanyScreening(
    state: SessionState,
    emit: (event: string, payload: any) => void,
    reason: string
): Promise<void> {
    if (!state.companyScreening || state.companyScreeningEnded) return;
    state.companyScreeningEnded = true;
    if (state.companyScreeningWatchdog) {
        clearTimeout(state.companyScreeningWatchdog);
        state.companyScreeningWatchdog = null;
    }
    state.currentStage = "CLOSING";
    try {
        await prisma.interviewSession.update({
            where: { id: state.sessionId },
            data: { status: "COMPLETED", completedAt: new Date(), stage: "CLOSING" },
            select: { id: true },
        });
    } catch (err) {
        console.error(`[Orchestrator] screening force-end DB update failed (${reason}) for ${state.sessionId}:`, err);
    }
    try {
        await sendServerAssistantMessage(
            state,
            emit,
            "We've reached the time limit for this screening. Thank you — we'll submit your screening now.",
            "CLOSING",
            { companyScreeningWatchdogClose: { version: 1 } }
        );
    } catch (err) {
        console.error(`[Orchestrator] screening force-end closing message failed for ${state.sessionId}:`, err);
    }
    emit("session:ending", { message: "Screening time limit reached. Submitting your screening..." });
}

/**
 * Arms a one-shot max-duration timer so the screening still ends if the candidate
 * goes silent at the limit (per-turn enforcement can't fire without a turn). The
 * timer fires at total duration + a short grace, after the AI's closing buffer.
 */
function armCompanyScreeningWatchdog(
    state: SessionState,
    emit: (event: string, payload: any) => void
): void {
    if (state.companyScreeningWatchdog || state.companyScreeningEnded || !state.companyScreening) return;
    const plan = state.companyScreeningPlan;
    if (!plan) return;
    const startedAtMs = new Date(state.startedAt || Date.now()).getTime();
    const fireAtMs = startedAtMs + plan.totalMs + 15_000;
    const delay = Math.max(1_000, fireAtMs - Date.now());
    state.companyScreeningWatchdog = setTimeout(() => {
        const live = activeSessions.get(state.sessionId);
        if (!live) return;
        forceEndCompanyScreening(live, emit, "watchdog").catch((err) => {
            console.error(`[Orchestrator] screening watchdog end error for ${state.sessionId}:`, err);
        });
    }, delay);
}

/**
 * Server-authoritative per-turn enforcement for company screening. Advances the
 * pointer on the server clock, force-closes when budgets are spent, and returns
 * the command the directive must render. NO-OP for practice interviews.
 */
async function enforceCompanyScreeningTurn(
    state: SessionState,
    userMessage: string | null,
    emit: (event: string, payload: any) => void
): Promise<CompanyScreeningAuthoritativeTurn | null> {
    if (!state.companyScreening) return null;
    const blueprint = state.companyScreening.blueprintSnapshot;
    const nowMs = Date.now();
    const startedAtMs = new Date(state.startedAt || nowMs).getTime();

    if (!state.companyScreeningPlan) state.companyScreeningPlan = computeScreeningPlan(blueprint);
    if (!state.companyScreeningProgress) state.companyScreeningProgress = createScreeningProgress(nowMs);
    // Seed the server-owned resume agenda once (grounds the resume phase; null when no
    // parsed resume, in which case the resume phase falls back to generic behaviour).
    if (state.companyScreeningResumeAgenda === undefined) {
        state.companyScreeningResumeAgenda = seedScreeningResumeAgenda(state.resumeSummary);
    }
    const plan = state.companyScreeningPlan;
    const progress = state.companyScreeningProgress;
    armCompanyScreeningWatchdog(state, emit);

    // Classify the candidate's turn: a skip/decline still advances the pointer (the round
    // never stalls) but is recorded as skipped, not faked as real coverage.
    const hasMessage = Boolean(userMessage && userMessage.trim());
    const candidateEndRequest = hasMessage && isEndInterviewIntent(userMessage!);
    const isSkip = hasMessage && !candidateEndRequest && isScreeningSkip(userMessage);

    // Single shared resolver so the text path and the VOICE path pace identically. It
    // advances the pacing pointer, drives the resume agenda, applies phase-only prompts,
    // and returns the side-effect intents (close a panel, enter CLOSING) to apply here.
    const resolution = resolveScreeningAuthoritativeTurn({
        blueprint,
        plan,
        progress,
        startedAtMs,
        nowMs,
        candidateAnswered: hasMessage && !isSkip && !candidateEndRequest,
        candidateSkipped: isSkip,
        candidateEndRequest,
        candidateMessage: userMessage ?? null,
        resumeSummary: state.resumeSummary,
        githubVerification: state.companyScreeningGithubVerification ?? null,
        resumeAgenda: state.companyScreeningResumeAgenda,
        previousPhaseType: state.companyScreeningCurrentPhaseType ?? null,
        closingForced: Boolean(state.companyScreeningClosingForced),
        closingQuestionOffered: Boolean(state.companyScreeningClosingQuestionOffered),
        currentStageIsClosing: state.currentStage === "CLOSING",
    });

    // Persist server-owned state from the resolution.
    const previousPhaseTypeForNotice = state.companyScreeningCurrentPhaseType ?? null;
    state.companyScreeningResumeAgenda = resolution.resumeAgenda ?? state.companyScreeningResumeAgenda;
    state.companyScreeningClosingForced = resolution.closingForced;
    state.companyScreeningClosingQuestionOffered = resolution.closingQuestionOffered;
    state.companyScreeningCurrentPhaseType = resolution.currentPhaseType;
    state.companyScreeningCurrentQuestionId = resolution.turn.currentQuestionId;
    if (!state.companyScreeningAskedQuestionIds) state.companyScreeningAskedQuestionIds = new Set();
    for (const id of progress.answered) state.companyScreeningAskedQuestionIds.add(id);

    // Anchor the model on the new phase the moment the pointer moves (text-path parity with voice
    // + practice). Generic — driven by whatever phase is next, never hardcoded. Stops the model
    // from saying goodbye mid-screen when a phase ends weakly.
    if (
        resolution.currentPhaseType &&
        !resolution.turn.forceClose &&
        resolution.currentPhaseType !== previousPhaseTypeForNotice &&
        previousPhaseTypeForNotice !== null
    ) {
        state.history.push({ role: "user", content: buildScreeningPhaseTransitionNotice(resolution.currentPhaseType) });
    }

    // Close the prior phase's workspace/scratchpad panel when the server changes phase / closes.
    if (resolution.closePreviousPanel) {
        emit("panel:close", { summary: resolution.turn.forceClose ? "Screening complete." : "Phase complete." });
    }

    // Pointer drives stage: mirror currentStage to the active phase's mapped stage (parity with
    // voice) so message stage tags + client UI follow the real phase, not the BEHAVIOURAL container.
    // Safe now that screening tools are phase-based (buildScreeningTools), not stage-based.
    if (resolution.enterStage && state.currentStage !== resolution.enterStage) {
        state.currentStage = resolution.enterStage;
        state.stageStartedAtMs = Date.now();
        emit("stage:change", { stage: resolution.enterStage, reason: `Screening advanced to the ${resolution.currentPhaseType ?? "next"} phase.` });
    }

    // Final close step only: sanction the end by entering CLOSING (where end_interview is
    // exposed + allowed). The "offer" step deliberately stays in the active stage so the
    // model cannot end before the candidate has had the company/role question.
    if (resolution.enterClosingStage && state.currentStage !== "CLOSING") {
        const closingCtx = buildToolContextForState(state, emit);
        const transitionResult = await handleToolCall(
            "transition_stage",
            { nextStage: "CLOSING", reason: candidateEndRequest ? "Candidate asked to end the screening early." : "Server-enforced screening time/coverage budget reached." },
            closingCtx
        );
        if (transitionResult.startsWith("Interview transitioned")) {
            state.currentStage = "CLOSING";
            state.stageStartedAtMs = Date.now();
        }
    }

    return resolution.turn;
}

function buildToolContextForState(
    state: SessionState,
    emit: (event: string, payload: any) => void
): ToolContext {
    const toolCtx: ToolContext = {
        sessionId: state.sessionId,
        userId: state.userId,
        interviewType: state.interviewType,
        currentStage: state.currentStage,
        askedQuestionIds: state.askedQuestionIds,
        role: state.role,
        level: state.level,
        stageOrder: state.stageOrder,
        moduleConfig: state.moduleConfig,
        resumeSummary: state.resumeSummary,
        stageStartedAtMs: state.stageStartedAtMs,
        lastFetchedQuestionId: state.lastFetchedQuestionId,
        lastFetchedLanguage: state.lastFetchedLanguage,
        prefetchedDSAQuestion: state.prefetchedDSAQuestion,
        prefetchedBehavioralQuestions: state.prefetchedBehavioralQuestions,
        cachedQuestionData: state.cachedQuestionData,
        scratchpadOpened: state.scratchpadOpened,
        systemDesignExchangeCount: state.systemDesignExchangeCount,
        introExchangeCount: state.introExchangeCount,
        prefetchedCSQuestions: state.prefetchedCSQuestions,
        prefetchedSDQuestion: state.prefetchedSDQuestion,
        resumeProbeState: state.resumeProbeState,
        resumeAgendaState: state.resumeAgendaState,
        onResumeProbeRecorded: (resumeProbeState) => {
            state.resumeProbeState = resumeProbeState;
            toolCtx.resumeProbeState = resumeProbeState;
        },
        onResumeAgendaRecorded: (resumeAgendaState) => {
            state.resumeAgendaState = resumeAgendaState;
            toolCtx.resumeAgendaState = resumeAgendaState;
        },
        prefetchedGenAIConceptQuestions: state.prefetchedGenAIConceptQuestions,
        prefetchedGenAICodingQuestion: state.prefetchedGenAICodingQuestion,
        prefetchedGenAISystemDesignQuestion: state.prefetchedGenAISystemDesignQuestion,
        prefetchedDSConceptQuestions: state.prefetchedDSConceptQuestions,
        prefetchedDSSQLQuestion: state.prefetchedDSSQLQuestion,
        prefetchedDSCodingQuestion: state.prefetchedDSCodingQuestion,
        prefetchedPMCaseQuestion: state.prefetchedPMCaseQuestion,
        prefetchedPMConceptQuestions: state.prefetchedPMConceptQuestions,
        prefetchedPMStrategyQuestion: state.prefetchedPMStrategyQuestion,
        prefetchedProblemSolvingCaseQuestion: state.prefetchedProblemSolvingCaseQuestion,
        onSQLEditorOpened: () => startSQLPhaseTimers(state.sessionId, emit),
        onSQLPanelClosed: () => {
            clearSQLTimers(state.sessionId);
            state.sqlSnapshot = null;
            state.sqlQuestionDescription = null;
        },
        onDSAEditorOpened: () => startDSAPhaseTimers(state.sessionId, emit),
        onDSAPanelClosed: () => clearDSATimers(state.sessionId),
        onProblemSolvingNotepadOpened: () => {
            state.problemSolvingNotepadOpened = true;
        },
        companyScreeningBlueprint: state.companyScreening?.blueprintSnapshot ?? null,
        companyScreeningCurrentQuestionId: state.companyScreeningCurrentQuestionId ?? null,
        companyScreeningCurrentPhaseType: state.companyScreeningCurrentPhaseType ?? null,
        onScreeningQuestionAsked: (screeningQuestionId: string, bankQuestionId?: string | null) => {
            state.companyScreeningCurrentQuestionId = screeningQuestionId;
            if (!state.companyScreeningAskedQuestionIds) state.companyScreeningAskedQuestionIds = new Set();
            state.companyScreeningAskedQuestionIds.add(screeningQuestionId);
            if (bankQuestionId) state.lastFetchedQuestionId = bankQuestionId;
        },
        emit,
    };

    return toolCtx;
}

async function sendServerGenAIConceptIntro(
    state: SessionState,
    emit: (event: string, payload: any) => void,
    reason: string
): Promise<boolean> {
    const nextStage = getNextEnabledStage(state.stageOrder, "INTRO");
    if (state.interviewType !== "gen_ai_role" || state.currentStage !== "INTRO" || nextStage !== "GEN_AI_CONCEPTS") {
        return false;
    }
    const firstQuestion = (state.prefetchedGenAIConceptQuestions || [])
        .find((q) => !state.askedQuestionIds.includes(q.questionId));
    if (!firstQuestion) return false;

    const toolCtx = buildToolContextForState(state, emit);
    toolCtx.forceIntroExit = true;
    const transitionResult = await handleToolCall(
        "transition_stage",
        { nextStage: "GEN_AI_CONCEPTS", reason },
        toolCtx
    );
    if (!transitionResult.startsWith("Interview transitioned")) return false;

    state.currentStage = "GEN_AI_CONCEPTS";
    state.stageStartedAtMs = Date.now();
    toolCtx.currentStage = "GEN_AI_CONCEPTS";

    await handleToolCall(
        "record_question",
        {
            questionFundamentalId: firstQuestion.questionId,
            questionTitle: firstQuestion.questionText,
            referenceAnswer: firstQuestion.referenceAnswer,
        },
        toolCtx
    );

    const content = `Let's move to GenAI fundamentals. ${firstQuestion.questionText}`;
    const messageId = `msg_${Date.now()}_${++messageCounter}`;
    emit("ai:token", { token: "", messageId });
    emit("ai:token", { token: content, messageId });
    emit("ai:done", { messageId, fullContent: content });

    state.history.push({ role: "assistant", content });
    await prisma.sessionMessage.create({
        data: { sessionId: state.sessionId, role: "assistant", content, stage: "GEN_AI_CONCEPTS" },
    });
    return true;
}

function getQuestionDifficultyBands(level: string): string[] {
    const map: Record<string, string[]> = {
        Junior: ["Medium"],
        Mid: ["Medium", "Hard"],
        Senior: ["Hard"],
        SDE1: ["Easy", "Medium"],
        SDE2: ["Medium", "Hard"],
        "Senior SDE": ["Medium", "Hard"],
        "Staff Engineer": ["Hard"],
    };
    return map[level] || ["Medium", "Hard"];
}

function sanitizeSpokenInterviewText(text: string, options: { trim?: boolean } = {}): string {
    const cleaned = text
        .replace(/```[\s\S]*?```/g, "")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/__([^_]+)__/g, "$1")
        .replace(/[*_~#>`]/g, "")
        .replace(/^\s*[-+]\s+/gm, "")
        .replace(/^\s*\d+\.\s+/gm, "")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n");
    return options.trim === false ? cleaned : cleaned.trim();
}

function stripDuplicateIntroWelcome(text: string): string {
    return text
        .replace(/^\s*hi(?:!|\.|,)?\s*/i, "")
        .replace(/^\s*thanks\s+for\s+joining(?:!|\.|,)?\s*/i, "")
        .replace(/^\s*welcome(?:!|\.|,)?\s*/i, "")
        .replace(/^\s*before we dive in,\s*/i, "")
        .trim();
}

function buildPinnedDsaIntro(question: { title?: string } | null | undefined): string {
    const title = question?.title || "the coding problem";
    return `The coding problem is "${title}". Before you start coding, walk me through your initial approach and the data structures you would consider.`;
}

async function sendServerDsaIntro(
    state: SessionState,
    emit: (event: string, payload: any) => void
): Promise<void> {
    if (!state.prefetchedDSAQuestion) return;
    const messageId = `msg_${Date.now()}_${++messageCounter}`;
    const content = buildPinnedDsaIntro(state.prefetchedDSAQuestion);
    emit("ai:token", { token: "", messageId });
    emit("ai:token", { token: content, messageId });
    emit("ai:done", { messageId, fullContent: content });
    state.history.push({ role: "assistant", content });
    await prisma.sessionMessage.create({
        data: { sessionId: state.sessionId, role: "assistant", content, stage: "DSA" },
    });
}

async function sendServerProblemSolvingIntro(
    state: SessionState,
    emit: (event: string, payload: any) => void
): Promise<void> {
    const caseQuestion = state.prefetchedProblemSolvingCaseQuestion;
    if (!caseQuestion) return;

    emit("panel:open", {
        type: "notepad",
        stage: "PROBLEM_SOLVING",
        topic: caseQuestion.title,
        template: "blank",
        initialContent: "",
        scenario: caseQuestion.prompt,
    });
    state.problemSolvingNotepadOpened = true;

    const content = [
        `${caseQuestion.prompt} I've opened the notepad in case you want to structure your thoughts there.`,
        "You can also simply talk through your reasoning. Start by restating the problem in your own words and listing the assumptions you want to make.",
    ].join(" ");

    await sendServerAssistantMessage(state, emit, content, "PROBLEM_SOLVING" as InterviewStage);
}

async function sendServerAssistantMessage(
    state: SessionState,
    emit: (event: string, payload: any) => void,
    content: string,
    stage: InterviewStage = state.currentStage,
    metadata?: Record<string, any>
): Promise<void> {
    const messageId = `msg_${Date.now()}_${++messageCounter}`;
    emit("ai:token", { token: "", messageId });
    emit("ai:token", { token: content, messageId });
    emit("ai:done", { messageId, fullContent: content });
    state.history.push({ role: "assistant", content });
    await prisma.sessionMessage.create({
        data: { sessionId: state.sessionId, role: "assistant", content, stage, ...(metadata ? { metadata } : {}) },
    });
}

function describeSqlQuestionForSpeech(sqlQuestion: any): string {
    const title = String(sqlQuestion?.title || "the SQL problem").trim();
    const description = String(sqlQuestion?.description || sqlQuestion?.problemDescription || "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const shortDescription = description.length > 260 ? `${description.slice(0, 260)}...` : description;
    return shortDescription
        ? `I've loaded "${title}" in the SQL editor. The task is: ${shortDescription} Walk me through your approach.`
        : `I've loaded "${title}" in the SQL editor. Walk me through your approach.`;
}

// ── Initialize Session ───────────────────────────────────────

export async function initializeSession(
    sessionId: string,
    emit: (event: string, payload: any) => void,
    isVoiceMode: boolean = false
): Promise<SessionState> {
    // Idempotent: if session state already exists in memory (e.g. client
    // reconnected mid-interview), return it as-is without re-initializing,
    // re-fetching questions, or sending another greeting.
    const existingState = activeSessions.get(sessionId);
    if (existingState) {
        console.log(`[Orchestrator] Rejoin detected for ${sessionId} — returning existing state`);
        return existingState;
    }

    const session = await prisma.interviewSession.findUnique({
        where: { id: sessionId },
        select: {
            id: true,
            userId: true,
            resumeId: true,
            role: true,
            level: true,
            mode: true,
            stage: true,
            status: true,
            startedAt: true,
            completedAt: true,
            createdAt: true,
            type: true,
            moduleConfig: true,
            resume: {
                select: { id: true, analysis: true, rawText: true },
            },
            sessionQuestions: {
                select: { 
                    questionId: true, 
                    questionSqlId: true, 
                    questionFundamentalId: true,
                    finalCode: true,
                    score: true
                },
            },
            messages: {
                orderBy: { createdAt: 'asc' },
                select: { role: true, content: true, stage: true, createdAt: true, metadata: true },
            },
        },
    });

    if (!session) {
        throw new Error(`Session ${sessionId} not found`);
    }

    const isCompleted = session.status === "COMPLETED";

    // Resume analysis is stored encrypted in the DB — decrypt it
    let resumeAnalysis: any = null;
    const rawAnalysis = session.resume?.analysis;
    if (rawAnalysis) {
        try {
            const { isEncrypted, decrypt } = await import("../../lib/encryption.js");
            if (typeof rawAnalysis === "string" && isEncrypted(rawAnalysis)) {
                resumeAnalysis = JSON.parse(decrypt(rawAnalysis));
            } else if (typeof rawAnalysis === "object") {
                resumeAnalysis = rawAnalysis;
            } else if (typeof rawAnalysis === "string") {
                resumeAnalysis = JSON.parse(rawAnalysis);
            }
        } catch (err) {
            console.error(`[Orchestrator] Failed to decrypt/parse resume analysis for ${sessionId}:`, err);
        }
    }
    console.log(`[Orchestrator] Resume analysis for ${sessionId}: ${resumeAnalysis ? 'loaded (name=' + resumeAnalysis?.summary?.name + ')' : 'none'}`);

    // Company screening: applicants often never ran the (paid, entitlement-gated) resume
    // analysis, so session.resume.analysis is null and the resume phase would fall back to
    // generic questions. Generate the structured analysis on the fly from the resume's raw
    // text so the resume agenda is always grounded. This is NOT charged to the candidate's
    // personal quota (direct service call, screening-only) and is cached back for re-entry.
    if (!resumeAnalysis && session.mode === "company_screening" && (session.resume as any)?.rawText) {
        try {
            const { isEncrypted, decrypt } = await import("../../lib/encryption.js");
            const raw = (session.resume as any).rawText as string;
            const rawText = typeof raw === "string" && isEncrypted(raw) ? decrypt(raw) : String(raw);
            if (rawText && rawText.trim().length >= 50) {
                const { analyzeResume, updateResumeAnalysis } = await import("../resume-service.js");
                resumeAnalysis = await analyzeResume(rawText);
                const resumeId = (session.resume as any).id as string | undefined;
                if (resumeAnalysis && resumeId) {
                    await updateResumeAnalysis(resumeId, session.userId, resumeAnalysis).catch((e) =>
                        console.warn(`[Orchestrator] failed to persist on-the-fly screening resume analysis for ${sessionId}:`, e));
                }
                console.log(`[Orchestrator] Screening resume analysis generated on-the-fly for ${sessionId} (name=${resumeAnalysis?.summary?.name})`);
            }
        } catch (err) {
            console.warn(`[Orchestrator] on-the-fly screening resume analysis failed for ${sessionId}:`, err);
        }
    }

    // Load conversation history from database
    const conversationHistory = session.messages.map(msg => ({
        role: msg.role as "user" | "assistant",
        content: msg.content,
    }));
    console.log(`[Orchestrator] Loaded ${conversationHistory.length} messages from database for session ${sessionId}`);
    
    const interviewType = (session.type || "full_interview") as InterviewType;
    const configMessage = session.messages
        ?.filter((msg: any) => msg.role === "system" && msg.stage === "CONFIG" && (msg.metadata as any)?.moduleConfig)
        .at(-1);
    const moduleConfig = (session as any).moduleConfig || (configMessage?.metadata as any)?.moduleConfig || null;
    const companyScreening = session.mode === "company_screening"
        ? normalizeCompanyScreeningRuntimeContext((configMessage?.metadata as any)?.companyScreening)
        : null;
    const companyScreeningMockPosition = companyScreening && isCompanyScreeningMockInterviewerEnabled()
        ? deriveCompanyScreeningMockPosition(companyScreening.blueprintSnapshot, session.messages)
        : null;

    // Ground the screening on the candidate's OWN verified GitHub project facts (name +
    // description + tech only). Loaded per-candidate from THEIR application; a hard field
    // whitelist (extractCandidateProjectFacts) drops every recruiter-side score/verdict/
    // risk so NOTHING recruiter-facing crosses into this candidate-facing session.
    let screeningGithubVerification: string | null = null;
    let screeningGithubVerificationSecrets: string[] = [];
    if (companyScreening?.applicationId) {
        try {
            const application = await (prisma as any).jobApplication.findUnique({
                where: { id: companyScreening.applicationId },
                select: { githubAnalysis: true },
            });
            const facts = extractCandidateProjectFacts(application);
            if (facts.length) {
                resumeAnalysis = { ...(resumeAnalysis || {}), summary: mergeCandidateProjectsIntoResume(resumeAnalysis?.summary || null, facts) };
                console.log(`[Orchestrator] Screening grounded on ${facts.length} candidate GitHub project fact(s) for ${sessionId}`);
            }
            // Evaluation-only verification grounding (the repo `ai` analysis) — injected ONLY into
            // the resume phase so the interviewer can verify claims against reality. Leak-guarded.
            const verifications = extractCandidateProjectVerification(application);
            screeningGithubVerification = buildResumeVerificationGrounding(verifications);
            screeningGithubVerificationSecrets = resumeVerificationSecrets(verifications);
        } catch (err) {
            console.warn(`[Orchestrator] candidate project facts load failed for ${sessionId}:`, err);
        }
    }

    const typeConfig = resolveEffectiveInterviewTypeConfig(interviewType, moduleConfig);
    const requirements = typeConfig.compatibilityManifest?.prefetchRequirements;

    const needsQuestionBank =
        typeConfig.stages.includes("DSA") ||
        typeConfig.stages.includes("FUNDAMENTALS") ||
        typeConfig.stages.includes("SYSTEM_DESIGN") ||
        typeConfig.stages.includes("GEN_AI_CONCEPTS") ||
        typeConfig.stages.includes("GEN_AI_CODING") ||
        typeConfig.stages.includes("GEN_AI_SYSTEM_DESIGN") ||
        typeConfig.stages.includes("DS_CONCEPTS") ||
        typeConfig.stages.includes("DS_SQL") ||
        typeConfig.stages.includes("DS_CODING") ||
        typeConfig.stages.includes("PM_CASE") ||
        typeConfig.stages.includes("PM_CONCEPTS") ||
        typeConfig.stages.includes("PM_STRATEGY");

    if (needsQuestionBank) {
        await ensureMongoDBConnected();
    } else if (typeConfig.stages.includes("PROBLEM_SOLVING")) {
        try {
            await ensureMongoDBConnected();
        } catch (err) {
            console.warn(`[Orchestrator] MongoDB unavailable for problem-solving session ${sessionId}; continuing with fallback case.`, err);
        }
    }

    // Hydrate globally asked questions from Redis
    const globalAskedIds = await getAskedQuestions(session.userId);
    const sessionAskedIds = session.sessionQuestions.map((sq) => sq.questionId || sq.questionSqlId || sq.questionFundamentalId).filter((id): id is string => Boolean(id));
    const mergedAskedIds = [...new Set([...globalAskedIds, ...sessionAskedIds])];

    const state: SessionState = {
        sessionId,
        userId: session.userId,
        interviewType,
        role: session.role,
        level: session.level,
        currentStage: session.stage as InterviewStage,
        stageOrder: typeConfig.stages,
        stageStartedAtMs: Date.now(),
        moduleConfig,
        resumeSummary: resumeAnalysis?.summary || null,
        companyScreeningGithubVerification: screeningGithubVerification,
        companyScreeningGithubVerificationSecrets: screeningGithubVerificationSecrets,
        resumeStageNonAnswerCounts: {},
        resumeDeclinedStages: [],
        resumeAgendaWeakAnswerCounts: {},
        resumeAgendaQuestionCounts: {},
        askedQuestionIds: mergedAskedIds,
        codeSnapshot: null,
        codeLanguage: null,
        sqlSnapshot: null,
        sqlQuestionDescription: null,
        currentQuestionTitle: null,
        lastFetchedQuestionId: null,
        lastFetchedLanguage: null,
        prefetchedDSAQuestion: null,
        prefetchedSDQuestion: null,
        prefetchedGenAIConceptQuestions: [],
        prefetchedGenAICodingQuestion: null,
        prefetchedGenAISystemDesignQuestion: null,
        prefetchedPMCaseQuestion: null,
        prefetchedPMConceptQuestions: [],
        prefetchedPMStrategyQuestion: null,
        prefetchedProblemSolvingCaseQuestion: null,
        problemSolvingNotepadOpened: false,
        resumeProbeState: createInitialResumeProbeState(),
        resumeAgendaState: interviewType === "resume_round"
            ? createInitialResumeAgendaState(resumeAnalysis?.summary || null)
            : undefined,
        resumeWebSearchUsed: false,
        cachedQuestionData: new Map(),
        history: conversationHistory, // Load from database instead of empty array
        scratchpadOpened: false,
        systemDesignExchangeCount: 0,
        introExchangeCount: 0,
        prefetchedCSQuestions: new Map(),
        prefetchedBehavioralQuestions: [],
        sqlApproachTimer: null,
        sqlQueryTimer: null,
        sqlTotalTimer: null,
        dsa20Timer: null,
        dsa25Timer: null,
        dsa30Timer: null,
        turnInFlight: false,
        pendingUserMessages: [],
        pttEnabled: false,
        pttHolding: false,
        transcriptBuffer: [],
        lastTranscriptAt: 0,
        companyScreening,
        companyScreeningMockCursor: companyScreeningMockPosition?.cursor || null,
        companyScreeningMockWaitingForAnswer: companyScreeningMockPosition?.waitingForAnswer || false,
        companyScreeningMockCompleted: false,
    };

    activeSessions.set(sessionId, state);

    if (!isVoiceMode && state.currentStage === "DSA") {
        startDSAPhaseTimers(sessionId, emit);
    }

    // Run all needed question prefetches in parallel — each mutates a distinct
    // slice of state so there are no write conflicts.
    const prefetchTasks: Promise<void>[] = [];
    const needsDSA = Boolean(requirements?.requiresDSAQuestion);
    const needsCS = Boolean(requirements?.requiresCSQuestions || requirements?.requiresSQLQuestion);
    const needsSD = Boolean(requirements?.requiresSDQuestion);
    const needsGenAI = Boolean(
        requirements?.requiresGenAIConceptQuestions ||
        requirements?.requiresGenAICodingQuestion ||
        requirements?.requiresGenAISystemDesignQuestion
    );
    const needsDS = Boolean(
        requirements?.requiresDSConceptQuestions ||
        requirements?.requiresDSSQLQuestion ||
        requirements?.requiresDSCodingQuestion
    );
    const needsPM = Boolean(
        requirements?.requiresPMCaseQuestion ||
        requirements?.requiresPMConceptQuestions ||
        requirements?.requiresPMStrategyQuestion
    );
    const needsProblemSolving = Boolean(requirements?.requiresProblemSolvingCaseQuestion);

    if (needsDSA) prefetchTasks.push(prefetchDSAQuestion(state));
    if (needsCS) prefetchTasks.push(prefetchCSFundamentalsQuestions(state, false));
    if (needsSD) prefetchTasks.push(prefetchSystemDesignQuestion(state));
    if (needsGenAI) prefetchTasks.push(prefetchGenAIRoleQuestions(state));
    if (needsDS) prefetchTasks.push(prefetchDSRoleQuestions(state));
    if (needsPM) prefetchTasks.push(prefetchPMRoleQuestions(state));
    if (needsProblemSolving) prefetchTasks.push(prefetchProblemSolvingCase(state));
    if (companyScreening) {
        state.companyScreeningAskedQuestionIds = new Set();
        prefetchTasks.push((async () => {
            const bankCache = await prefetchCompanyScreeningBankQuestions(companyScreening.blueprintSnapshot);
            for (const [bankId, question] of bankCache) state.cachedQuestionData.set(bankId, question);
        })());
    }

    try {
        await Promise.all(prefetchTasks);
    } catch (err) {
        console.error(`[Orchestrator] Question prefetch failed for ${sessionId}:`, err);
        throw err;
    }

    // ── RECONSTRUCTION: Restore sub-stage state (e.g. currentFundamentalsPhase) ──
    reconstructSubStageState(state, session);

    // Post-process DSA result: validate and, for coding interviews (DSA is first
    // stage), push the question to the frontend immediately so the IDE appears.
    if (needsDSA) {
        if (!state.prefetchedDSAQuestion) {
            throw new Error("DSA prefetch returned no question.");
        }
        const firstStageIsDSA = typeConfig.stages[0] === "DSA";
        if (firstStageIsDSA) {
            const q = state.prefetchedDSAQuestion;
            state.currentQuestionTitle = q.title;
            state.lastFetchedQuestionId = q.id;
            state.cachedQuestionData.set(q.id, q);
            if (!state.askedQuestionIds.includes(q.id)) {
                state.askedQuestionIds.push(q.id);
                addAskedQuestion(state.userId, q.id).catch(console.error);
            }
            emit("question:assign", {
                question: {
                    id: q.id,
                    title: q.title,
                    difficulty: q.difficulty,
                    problemMd: q.problemMd,
                    constraints: q.constraints,
                    examples: q.examples,
                    starterCode: Object.fromEntries(
                        (q.starters || []).map((s: any) => [s.language, s.starter])
                    ),
                    wrapperCode: Object.fromEntries(
                        (q.starters || []).map((s: any) => [s.language, s.wrapperCode])
                    ),
                    visibleTestCases: (q.visibleTestCases || []).map((tc: any) => ({
                        input: tc.input,
                        expected: tc.expected,
                        label: tc.type === "edge" ? "Edge Case" : "Sample Case",
                    })),
                    language: "cpp",
                },
                stage: "DSA",
            });
        }
    }

    // Validate CS Fundamentals result
    if (needsCS) {
        const hasTheory = (state.prefetchedCSQuestions?.size || 0) > 0;
        const includeSQL = state.moduleConfig?.stageOptions?.FUNDAMENTALS?.includeSQL !== false;
        const hasSQL = !includeSQL || [...state.cachedQuestionData.values()].some((q) => q.category === "SQL");
        if (!hasTheory || !hasSQL) {
            throw new Error("CS fundamentals prefetch is incomplete (missing theory bank or SQL question).");
        }
        console.log(`[Orchestrator] Pre-fetched CS Fundamentals questions (in-memory only) for ${sessionId}`);
    }

    // Validate System Design result
    if (needsSD) {
        if (!state.prefetchedSDQuestion) {
            throw new Error("System design prefetch returned no question.");
        }
        console.log(`[Orchestrator] Pre-fetched System Design question for ${sessionId}`);
    }

    // Validate GenAI Role result
    if (needsGenAI) {
        const hasConceptQs = (state.prefetchedGenAIConceptQuestions?.length ?? 0) > 0;
        if (requirements?.requiresGenAIConceptQuestions && !hasConceptQs) {
            console.warn(`[Orchestrator] GenAI concept question bank is empty for ${sessionId} — check DB seed.`);
        }
        if (requirements?.requiresGenAICodingQuestion && !state.prefetchedGenAICodingQuestion) {
            console.warn(`[Orchestrator] No GenAI coding task found for ${sessionId} — check DB seed.`);
        }
        console.log(`[Orchestrator] GenAI prefetch complete for ${sessionId}: ${state.prefetchedGenAIConceptQuestions?.length ?? 0} concept Qs, coding=${!!state.prefetchedGenAICodingQuestion}`);
    }

    const prefetchValidation = validatePrefetchState({
        interviewType: state.interviewType,
        prefetchedDSAQuestion: state.prefetchedDSAQuestion,
        prefetchedCSQuestions: state.prefetchedCSQuestions,
        prefetchedSQLQuestion: state.prefetchedSQLQuestion,
        prefetchedSDQuestion: state.prefetchedSDQuestion,
        prefetchedBehavioralQuestions: state.prefetchedBehavioralQuestions,
        prefetchedGenAIConceptQuestions: state.prefetchedGenAIConceptQuestions,
        prefetchedGenAICodingQuestion: state.prefetchedGenAICodingQuestion,
        prefetchedGenAISystemDesignQuestion: state.prefetchedGenAISystemDesignQuestion,
        prefetchedDSConceptQuestions: state.prefetchedDSConceptQuestions,
        prefetchedDSSQLQuestion: state.prefetchedDSSQLQuestion,
        prefetchedDSCodingQuestion: state.prefetchedDSCodingQuestion,
        prefetchedPMCaseQuestion: state.prefetchedPMCaseQuestion,
        prefetchedPMConceptQuestions: state.prefetchedPMConceptQuestions,
        prefetchedPMStrategyQuestion: state.prefetchedPMStrategyQuestion,
        prefetchedProblemSolvingCaseQuestion: state.prefetchedProblemSolvingCaseQuestion,
        resumeSummary: state.resumeSummary,
        cachedQuestionData: state.cachedQuestionData,
        prefetchRequirements: requirements,
    });

    if (!prefetchValidation.complete) {
        throw new Error(
            `Prefetch validation failed for ${sessionId}. Missing: ${prefetchValidation.missing.join(", ") || "none"}. ` +
            `Unpopulated: ${prefetchValidation.unpopulated.join(", ") || "none"}.`
        );
    }

    // Mark session as IN_PROGRESS only for active sessions.
    // Never regress a completed session back to IN_PROGRESS.
    if (!isCompleted) {
        await prisma.interviewSession.update({
            where: { id: sessionId },
            data: {
                status: "IN_PROGRESS",
                startedAt: session.startedAt || new Date(),
            },
            select: { id: true },
        });
    }

    // Trigger the initial greeting ONLY for fresh sessions with no history.
    // For all other cases (reload, reconnect, resume), do nothing - the frontend
    // already has the chat history and will display it. The conversation will
    // resume naturally when the user sends their next message.
    // NOTE: a fresh session still carries a system "CONFIG" message (module config
    // + companyScreening metadata) written at /start, so we must count only real
    // user/assistant turns here — otherwise the greeting is wrongly skipped and a
    // text-mode (no-voice) screening room hangs on "Connecting...".
    const hasExistingHistory = conversationHistory.some(
        (msg) => msg.role === "user" || msg.role === "assistant"
    );
    
    if (!isVoiceMode && !isCompleted && !hasExistingHistory) {
        const opening = buildInterviewOpeningMessage({
            interviewType: state.interviewType,
            role: state.role,
            level: state.level,
            stageOrder: state.stageOrder,
            moduleConfig: state.moduleConfig,
        });
        const effectiveOpening = state.companyScreening
            ? buildCompanyScreeningOpeningMessage(state.companyScreening, state.role)
            : opening;
        sendServerAssistantMessage(state, emit, effectiveOpening, state.currentStage)
            .then(() => {
                if (state.currentStage === "DSA" && state.prefetchedDSAQuestion) {
                    return sendServerDsaIntro(state, emit);
                }
                if (
                    state.currentStage === "PROBLEM_SOLVING" &&
                    state.prefetchedProblemSolvingCaseQuestion
                ) {
                    return sendServerProblemSolvingIntro(state, emit);
                }
                return processAgentTurn(sessionId, null, emit);
            })
            .catch((err) => {
                console.error(`[Orchestrator] Failed to send initial opening for ${sessionId}`, err);
            });
    } else if (hasExistingHistory) {
        // Session has history - don't send anything, frontend will show existing messages
        console.log(`[Orchestrator] Session ${sessionId} has ${conversationHistory.length} messages. Not sending any messages - frontend will display existing chat history.`);
    }

    return state;
}

// ── Pre-fetch DSA Question ───────────────────────────────────
// Fetches a random DSA question at session start so it's instantly
// available when the AI calls fetch_question. The AI doesn't know
// the question is pre-fetched — it still calls tools normally.

async function prefetchDSAQuestion(state: SessionState): Promise<void> {
    const codingRows = await prisma.sessionQuestion.findMany({
        where: {
            sessionId: state.sessionId,
            questionCategory: "coding",
            questionId: { not: null },
        },
        orderBy: { askedAt: "asc" },
    });

    if (codingRows.length > 0) {
        const chooseScore = (row: any) =>
            Number(Boolean(row.questionTitle)) +
            Number(Boolean(row.finalCode)) +
            Number(Boolean(row.aiNotes)) +
            Number(Boolean(row.sampleAnswer));

        const canonicalRow = codingRows.reduce((best, row) => (
            chooseScore(row) >= chooseScore(best) ? row : best
        ));

        if (codingRows.length > 1) {
            const idsToDelete = codingRows.filter((row) => row.id !== canonicalRow.id).map((row) => row.id);
            await prisma.sessionQuestion.deleteMany({
                where: { id: { in: idsToDelete } },
            });
        }

        const canonicalQuestionId = canonicalRow.questionId;
        if (canonicalQuestionId) {
            const existingDoc = await DSAQuestion.findById(canonicalQuestionId).lean();
            if (!existingDoc) return;

            const normalized = normalizeDSAQuestion(existingDoc);
            state.prefetchedDSAQuestion = normalized;
            state.currentQuestionTitle = canonicalRow.questionTitle || normalized.title;
            state.cachedQuestionData.set(canonicalQuestionId, normalized);
            state.lastFetchedQuestionId = canonicalQuestionId;

            console.log(`[Orchestrator] Reused existing coding question for session ${state.sessionId}: "${normalized.title}"`);
            return;
        }
    }

    // Reuse the already-persisted coding question for this session if present.
    // This mirrors the system_design flow and keeps one canonical row per session.
    const existingSessionCoding = await prisma.sessionQuestion.findFirst({
        where: {
            sessionId: state.sessionId,
            questionCategory: "coding",
            questionId: { not: null },
        },
        orderBy: { askedAt: "asc" },
        select: {
            questionId: true,
            questionTitle: true,
            questionDifficulty: true,
            sampleAnswer: true,
        },
    });

    if (existingSessionCoding?.questionId) {
        const existingDoc = await DSAQuestion.findById(existingSessionCoding.questionId).lean();
        if (!existingDoc) return;

        const normalized = normalizeDSAQuestion(existingDoc);
        state.prefetchedDSAQuestion = normalized;
        state.currentQuestionTitle = existingSessionCoding.questionTitle || normalized.title;
        state.cachedQuestionData.set(existingSessionCoding.questionId, normalized);
        state.lastFetchedQuestionId = existingSessionCoding.questionId;

        console.log(`[Orchestrator] Reused existing coding question for session ${state.sessionId}: "${normalized.title}"`);
        return;
    }

    const difficulties = (() => {
        const configured = state.moduleConfig?.stageOptions?.DSA?.difficulty;
        if (["Easy", "Medium", "Hard"].includes(configured)) return [configured];
        return getQuestionDifficultyBands(state.level);
    })();

    // Build MongoDB match stage
    const matchStage: any = {
        difficulty: { $in: difficulties },
    };
    const selectedTopics = state.moduleConfig?.stageOptions?.DSA?.topics;
    if (Array.isArray(selectedTopics) && selectedTopics.length > 0) {
        matchStage.topics = { $in: selectedTopics };
    }

    const ledgerSeenIds = await getSeenQuestionIds(state.userId, "dsa", {
        category: "coding",
        idField: "questionId",
    });
    const excludeIds = toMongoObjectIds(Array.from(new Set([...state.askedQuestionIds, ...ledgerSeenIds])));
    if (excludeIds.length > 0) matchStage._id = { $nin: excludeIds };

    let [rawDoc] = await DSAQuestion.aggregate([
        { $match: matchStage },
        { $sample: { size: 1 } },
    ]);

    if (!rawDoc && matchStage.topics) {
        const fallbackMatch = { ...matchStage };
        delete fallbackMatch.topics;
        [rawDoc] = await DSAQuestion.aggregate([
            { $match: fallbackMatch },
            { $sample: { size: 1 } },
        ]);
    }

    if (!rawDoc && ledgerSeenIds.length > 0) {
        rawDoc = await findLeastRecentlySeenMongoDoc(
            DSAQuestion,
            state.userId,
            "dsa",
            { difficulty: { $in: difficulties } }
        );
    }

    if (!rawDoc && ledgerSeenIds.length > 0) {
        rawDoc = await findLeastRecentlySeenMongoDoc(DSAQuestion, state.userId, "dsa");
    }

    if (!rawDoc) {
        rawDoc = await findRandomMongoDoc(DSAQuestion);
        if (rawDoc) {
            console.warn(`[Orchestrator] DSA filters/exposure exhausted; used any random coding question fallback.`);
        }
    }

    if (!rawDoc) return;

    const doc = await DSAQuestion.findById(rawDoc._id);
    if (doc) {
        const normalized = normalizeDSAQuestion(doc);
        state.prefetchedDSAQuestion = normalized;
        state.currentQuestionTitle = normalized.title;
        state.cachedQuestionData.set(normalized.id, normalized);
        state.lastFetchedQuestionId = normalized.id;

        const dsaSampleAnswer: string | null =
            normalized.solution?.optimized?.explanation ||
            normalized.solution?.bruteForce?.explanation ||
            null;

        const existing = await prisma.sessionQuestion.findFirst({
            where: { sessionId: state.sessionId, questionId: normalized.id },
            select: { id: true },
        });

        if (!existing) {
            await prisma.sessionQuestion.create({
                data: {
                    sessionId: state.sessionId,
                    questionId: normalized.id,
                    questionTitle: normalized.title,
                    questionCategory: "coding",
                    questionDifficulty: normalized.difficulty,
                    sampleAnswer: dsaSampleAnswer,
                },
            });
        }
        await recordQuestionExposure({
            userId: state.userId,
            questionSource: "dsa",
            questionId: normalized.id,
            sessionId: state.sessionId,
        });

        console.log(`[Orchestrator] Pre-fetched coding question for session ${state.sessionId}: "${normalized.title}"`);
    }
}

// ── Pre-fetch System Design Question ────────────────────────
// Fetches a random SystemDesign question at session start so it is instantly
// available when the system prompt is built. The AI uses it directly from the
// QUESTION BANK injection — no fetch_question tool call needed mid-interview.

async function prefetchSystemDesignQuestion(state: SessionState): Promise<void> {
    // Reuse the already-selected SD question for this session (if present)
    // to avoid creating duplicate session_questions rows on re-initialization.
    const existingSessionSD = await prisma.sessionQuestion.findFirst({
        where: {
            sessionId: state.sessionId,
            questionCategory: "system_design",
            questionId: { not: null },
        },
        orderBy: { askedAt: "asc" },
        select: {
            questionId: true,
            questionTitle: true,
            questionDifficulty: true,
        },
    });

    if (existingSessionSD?.questionId) {
        const existingDoc: any = await SystemDesignQuestion.findById(existingSessionSD.questionId).lean();
        const title = existingDoc?.title || existingSessionSD.questionTitle || "System Design Question";
        const problemStatement = existingDoc?.problemStatement || `Design ${title}.`;
        const difficulty = existingDoc?.difficulty || existingSessionSD.questionDifficulty || "Medium";

        state.prefetchedSDQuestion = {
            id: existingSessionSD.questionId,
            title,
            problemStatement,
            difficulty,
            rubricLite: existingDoc?.rubricLite || null,
            hints: existingDoc?.hints || [],
        };
        state.currentQuestionTitle = title;
        state.rubricLite = existingDoc?.rubricLite || null;
        state.cachedQuestionData.set(existingSessionSD.questionId, {
            questionId: existingSessionSD.questionId,
            title,
            category: "SystemDesign",
            difficulty,
            problemMd: problemStatement,
        });
        state.lastFetchedQuestionId = existingSessionSD.questionId;

        console.log(`[Orchestrator] Reused existing SD question for session ${state.sessionId}: "${title}"`);
        return;
    }

    const difficulties = getQuestionDifficultyBands(state.level);
    const recentSessionSD = await prisma.sessionQuestion.findFirst({
        where: {
            session: { userId: state.userId },
            questionCategory: "system_design",
            questionId: { not: null },
        },
        orderBy: { askedAt: "desc" },
        select: { questionId: true },
    });
    const recentSdObjectId = recentSessionSD?.questionId
        ? toMongoObjectIds([recentSessionSD.questionId])[0]
        : null;

    const seenIds = await getSeenQuestionIds(state.userId, "system_design", {
        category: "system_design",
        idField: "questionId",
    });

    console.log(`[Orchestrator] SD exclusion list: ${seenIds.length} previously seen questions for user ${state.userId}`);

    // Build exclusion filter using ObjectIds
    const excludeObjectIds = toMongoObjectIds(seenIds);
    const excludeFilter = excludeObjectIds.length > 0
        ? { _id: { $nin: excludeObjectIds } }
        : {};

    // Pass 1: preferred difficulty, exclude seen
    let [rawDoc] = await SystemDesignQuestion.aggregate([
        { $match: { difficulty: { $in: difficulties }, ...excludeFilter } },
        { $sample: { size: 1 } },
    ]);

    // Pass 2: any difficulty, exclude seen
    if (!rawDoc && seenIds.length > 0) {
        console.warn(`[Orchestrator] No unseen SD question for difficulties ${JSON.stringify(difficulties)}, trying any difficulty (still excluding seen).`);
        [rawDoc] = await SystemDesignQuestion.aggregate([
            { $match: excludeFilter },
            { $sample: { size: 1 } },
        ]);
    }

    // Pass 3: user has seen everything — reset and pick any question with preferred difficulty
    if (!rawDoc) {
        console.warn(`[Orchestrator] User has seen all SD questions. Using least-recently-seen fallback.`);
        rawDoc = await findLeastRecentlySeenMongoDoc(
            SystemDesignQuestion,
            state.userId,
            "system_design",
            { difficulty: { $in: difficulties } }
        );
    }

    // Pass 4: absolute fallback — pick literally any question
    if (!rawDoc) {
        rawDoc = await findLeastRecentlySeenMongoDoc(SystemDesignQuestion, state.userId, "system_design");
    }

    if (!rawDoc) {
        console.warn(`[Orchestrator] SD dedupe exhausted the bank for ${state.userId}; recycling a previously seen question.`);
        const recycledPreferredMatch =
            recentSdObjectId
                ? { difficulty: { $in: difficulties }, _id: { $in: excludeObjectIds, $ne: recentSdObjectId } }
                : { difficulty: { $in: difficulties }, _id: { $in: excludeObjectIds } };
        const recycledAnyMatch =
            recentSdObjectId
                ? { _id: { $in: excludeObjectIds, $ne: recentSdObjectId } }
                : { _id: { $in: excludeObjectIds } };
        [rawDoc] = await SystemDesignQuestion.aggregate([
            { $match: recycledPreferredMatch },
            { $sample: { size: 1 } },
        ]);
        if (!rawDoc) {
            [rawDoc] = await SystemDesignQuestion.aggregate([
                { $match: recycledAnyMatch },
                { $sample: { size: 1 } },
            ]);
        }
        if (!rawDoc && recentSdObjectId) {
            [rawDoc] = await SystemDesignQuestion.aggregate([
                { $match: { _id: { $in: excludeObjectIds } } },
                { $sample: { size: 1 } },
            ]);
        }
    }

    if (!rawDoc) {
        rawDoc = await findRandomMongoDoc(SystemDesignQuestion);
        if (rawDoc) {
            console.warn(`[Orchestrator] System Design filters/exposure exhausted; used any random system design fallback.`);
        }
    }

    if (!rawDoc) {
        console.error(`[Orchestrator] system_design_questions collection appears empty — cannot pre-fetch.`);
        return;
    }

    const doc = await SystemDesignQuestion.findById(rawDoc._id);
    if (!doc) {
        console.error(`[Orchestrator] Selected system design question could not be loaded: ${rawDoc._id}`);
        return;
    }

    const sdQuestion = {
        id: doc._id.toString(),
        title: doc.title,
        problemStatement: doc.problemStatement,
        difficulty: doc.difficulty,
        rubricLite: doc.rubricLite,
        hints: doc.hints || [],
    };

    state.prefetchedSDQuestion = sdQuestion;
    state.currentQuestionTitle = sdQuestion.title;
    state.rubricLite = sdQuestion.rubricLite;
    if (!state.askedQuestionIds.includes(sdQuestion.id)) {
        state.askedQuestionIds.push(sdQuestion.id);
        addAskedQuestion(state.userId, sdQuestion.id).catch(console.error);
    }
    recordQuestionExposure({
        userId: state.userId,
        questionSource: "system_design",
        questionId: sdQuestion.id,
        sessionId: state.sessionId,
    }).catch(console.error);

    // Wire into cachedQuestionData so fetch_question(SystemDesign) hits the idempotency
    // gate and returns THIS pre-fetched question — bypassing the hardcoded fallback.
    const cacheEntry = {
        questionId: sdQuestion.id,
        title: sdQuestion.title,
        category: "SystemDesign",
        difficulty: sdQuestion.difficulty,
        problemMd: sdQuestion.problemStatement,
    };
    state.cachedQuestionData.set(sdQuestion.id, cacheEntry);
    state.lastFetchedQuestionId = sdQuestion.id;

    const sampleAnswer: string | null = (doc.rubricFull as any)?.sampleAnswer ?? null;

    const existingSessionQuestion = await prisma.sessionQuestion.findFirst({
        where: {
            sessionId: state.sessionId,
            questionCategory: "system_design",
            questionId: sdQuestion.id,
        },
        select: { id: true },
    });

    if (!existingSessionQuestion) {
        try {
            await prisma.sessionQuestion.create({
                data: {
                    sessionId: state.sessionId,
                    questionId: sdQuestion.id,
                    questionTitle: sdQuestion.title,
                    questionCategory: "system_design",
                    questionDifficulty: sdQuestion.difficulty,
                    sampleAnswer,
                },
            });
        } catch (err: any) {
            // Session teardown can race with persistence in exceptional flows.
            // Skip noisy logging for known FK races while keeping other errors visible.
            if (err?.code === "P2003") {
                console.warn(`[Orchestrator] Skipping SD sessionQuestion persistence for ${state.sessionId}: session no longer exists.`);
            } else {
                console.error(`[Orchestrator] Failed to save SD sessionQuestion:`, err);
            }
        }
    }

    console.log(`[Orchestrator] Pre-fetched SD question: "${sdQuestion.title}" (${sdQuestion.difficulty}) for session ${state.sessionId}`);
}

// ── Pre-fetch CS Fundamentals Questions ──────────────────────
// Loads questions from MongoDB at session start for CS Fundamentals interview.
// Questions are organized into category-specific arrays that the LLM draws from
// during the interview. This ensures ALL questions come from the database.

async function prefetchCSFundamentalsQuestions(state: SessionState, persistSessionQuestions: boolean = false): Promise<void> {
    const fundamentalsOptions = state.moduleConfig?.stageOptions?.FUNDAMENTALS || {};
    const { questionsMap, prefetchedSQLQuestion, sqlCacheEntry } = await prefetchCSFundamentals(
        state.sessionId,
        state.userId,
        "Orchestrator",
        persistSessionQuestions,
        {
            topics: fundamentalsOptions.topics,
            includeSQL: fundamentalsOptions.includeSQL,
            questionCountPerTopic: fundamentalsOptions.questionCountPerTopic,
        }
    );
    state.prefetchedCSQuestions = questionsMap;
    state.prefetchedSQLQuestion = prefetchedSQLQuestion;
    for (const [id, q] of sqlCacheEntry) {
        state.cachedQuestionData.set(id, q);
    }
    state.currentFundamentalsPhase = getCurrentCSPhase(state);
}

// ── Pre-fetch Gen AI Role Questions ─────────────────────────
// Fetches all three GenAI question types at session init:
//   - 7 concept questions (distributed across subtopics, with dedup)
//   - 1 coding task (with dedup)
//   - 1 ethics scenario (with embedded companyBrief, with dedup)
// All results are stored in session state. The system prompt builder
// reads them from state to inject into the LLM context.

async function prefetchGenAIRoleQuestions(state: SessionState): Promise<void> {
    const conceptOptions = state.moduleConfig?.stageOptions?.GEN_AI_CONCEPTS || {};
    const { conceptQuestions, codingQuestion, systemDesignQuestion } = await prefetchGenAIQuestions(
        state.sessionId,
        state.userId,
        "Orchestrator",
        {
            includeConcepts: state.stageOrder.includes("GEN_AI_CONCEPTS"),
            includeCoding: state.stageOrder.includes("GEN_AI_CODING"),
            includeSystemDesign: state.stageOrder.includes("GEN_AI_SYSTEM_DESIGN"),
            conceptSubtopics: conceptOptions.subtopics,
            difficultyBands: getQuestionDifficultyBands(state.level),
        }
    );
    state.prefetchedGenAIConceptQuestions = conceptQuestions;
    state.prefetchedGenAICodingQuestion = codingQuestion;
    state.prefetchedGenAISystemDesignQuestion = systemDesignQuestion;
}

async function prefetchDSRoleQuestions(state: SessionState): Promise<void> {
    const conceptOptions = state.moduleConfig?.stageOptions?.DS_CONCEPTS || {};
    const { conceptQuestions, sqlQuestion, codingQuestion } = await prefetchDSQuestions(
        state.sessionId,
        state.userId,
        "DSOrchestrator",
        {
            includeConcepts: state.stageOrder.includes("DS_CONCEPTS"),
            includeSQL: state.stageOrder.includes("DS_SQL"),
            includeCoding: state.stageOrder.includes("DS_CODING"),
            conceptCategories: conceptOptions.topics,
            difficultyBands: getQuestionDifficultyBands(state.level),
        }
    );
    state.prefetchedDSConceptQuestions = conceptQuestions;
    state.prefetchedDSSQLQuestion = sqlQuestion;
    state.prefetchedDSCodingQuestion = codingQuestion;
}

// ── Pre-fetch PM Role Questions ──────────────────────────────
// Fetches all three PM question types at session init:
//   - 1 case question (with dedup)
//   - 8 concept questions (distributed across 6 subtopics, with dedup)
//   - 1 strategy question (with dedup)
// All results are stored in session state. The system prompt builder
// reads them from state to inject into the LLM context.

async function prefetchPMRoleQuestions(state: SessionState): Promise<void> {
    const { caseQuestion, conceptQuestions, strategyQuestion } = await prefetchPMQuestions(
        state.sessionId,
        state.userId,
        "PMOrchestrator",
        {
            includeCase: state.stageOrder.includes("PM_CASE"),
            includeConcepts: state.stageOrder.includes("PM_CONCEPTS"),
            includeStrategy: state.stageOrder.includes("PM_STRATEGY"),
            difficultyBands: getQuestionDifficultyBands(state.level),
        }
    );
    state.prefetchedPMCaseQuestion = caseQuestion;
    state.prefetchedPMConceptQuestions = conceptQuestions;
    state.prefetchedPMStrategyQuestion = strategyQuestion;

    console.log(`[Orchestrator] PM prefetch complete for ${state.sessionId}: ${conceptQuestions.length} concept Qs, case=${!!caseQuestion}, strategy=${!!strategyQuestion}`);
    if (!caseQuestion) console.warn(`[Orchestrator] No PM case question found for ${state.sessionId} — check DB seed.`);
    if (!strategyQuestion) console.warn(`[Orchestrator] No PM strategy question found for ${state.sessionId} — check DB seed.`);
}


// ── Process Agent Turn ───────────────────────────────────────
// Called when the user sends a message, or for the initial greeting.

async function prefetchProblemSolvingCase(state: SessionState): Promise<void> {
    state.prefetchedProblemSolvingCaseQuestion = await prefetchProblemSolvingCaseQuestion(
        state.sessionId,
        state.userId,
        "ProblemSolvingOrchestrator",
        { difficultyBands: getQuestionDifficultyBands(state.level) }
    );

    if (!state.prefetchedProblemSolvingCaseQuestion) {
        console.warn(`[Orchestrator] No problem-solving case found for ${state.sessionId} - check DB seed.`);
    } else {
        console.log(`[Orchestrator] Problem-solving prefetch complete for ${state.sessionId}: "${state.prefetchedProblemSolvingCaseQuestion.title}"`);
    }
}

async function completeCompanyScreeningMockSession(
    state: SessionState,
    emit: (event: string, payload: any) => void
): Promise<void> {
    if (state.companyScreeningMockCompleted) return;
    state.companyScreeningMockCompleted = true;
    state.currentStage = "CLOSING";
    emit("stage:change", {
        stage: "CLOSING",
        reason: "Company screening mock interviewer completed the configured blueprint.",
    });
    await prisma.interviewSession.update({
        where: { id: state.sessionId },
        data: { status: "COMPLETED", completedAt: new Date(), stage: "CLOSING" },
        select: { id: true },
    });
    await sendServerAssistantMessage(
        state,
        emit,
        "Thank you. That covers the configured screening questions. We will submit your screening now.",
        "CLOSING",
        { companyScreeningMockComplete: { version: 1 } }
    );
    emit("session:ending", {
        message: "Interview complete. Submitting your screening...",
    });
}

async function processCompanyScreeningMockTurn(
    state: SessionState,
    userMessage: string | null,
    emit: (event: string, payload: any) => void
): Promise<boolean> {
    if (!state.companyScreening || !isCompanyScreeningMockInterviewerEnabled()) {
        return false;
    }

    const trimmedUserMessage = userMessage?.trim() || "";
    let latestMockAnswer: string | null = null;
    if (trimmedUserMessage) {
        await prisma.sessionMessage.create({
            data: {
                sessionId: state.sessionId,
                role: "user",
                content: trimmedUserMessage,
                stage: state.currentStage,
                ...companyScreeningStateMeta(state),
            },
        });
        state.history.push({ role: "user", content: trimmedUserMessage });
        latestMockAnswer = trimmedUserMessage;

        if (state.companyScreeningMockWaitingForAnswer && state.companyScreeningMockCursor) {
            state.companyScreeningMockCursor = advanceCompanyScreeningMockCursor(
                state.companyScreening.blueprintSnapshot,
                state.companyScreeningMockCursor,
                trimmedUserMessage
            );
            state.companyScreeningMockWaitingForAnswer = false;
        }
    }

    if (!state.companyScreeningMockCursor) {
        await completeCompanyScreeningMockSession(state, emit);
        return true;
    }

    if (state.companyScreeningMockWaitingForAnswer) {
        return true;
    }

    const prompt = buildCompanyScreeningMockPrompt(
        state.companyScreening.blueprintSnapshot,
        state.companyScreeningMockCursor,
        latestMockAnswer
    );
    if (!prompt) {
        state.companyScreeningMockCursor = null;
        await completeCompanyScreeningMockSession(state, emit);
        return true;
    }

    await sendServerAssistantMessage(
        state,
        emit,
        prompt.content,
        state.currentStage,
        { companyScreeningMockPrompt: prompt.metadata }
    );
    state.companyScreeningMockWaitingForAnswer = true;
    return true;
}

export async function processAgentTurn(
    sessionId: string,
    userMessage: string | null,
    emit: (event: string, payload: any) => void
): Promise<void> {
    const dbSession = await prisma.interviewSession.findUnique({
        where: { id: sessionId },
        select: { status: true },
    });
    if (!dbSession || dbSession.status === "COMPLETED") {
        emit("session:ended", {
            message: "This interview has already ended.",
        });
        return;
    }

    const state = activeSessions.get(sessionId);
    if (!state) {
        throw new Error(`No active session: ${sessionId}`);
    }

    // Prevent concurrent LLM calls: if a turn is already in flight (e.g. triggered
    // by a timer nudge firing while the user turn is streaming), skip this call.
    if (state.turnInFlight) {
        if (userMessage?.trim()) {
            state.pendingUserMessages ||= [];
            state.pendingUserMessages.push(userMessage);
            console.warn(`[Orchestrator] Queued user turn while in flight for ${sessionId}; pending=${state.pendingUserMessages.length}`);
        } else {
            console.warn(`[Orchestrator] Skipping reentrant internal turn for ${sessionId}`);
        }
        return;
    }
    state.turnInFlight = true;
    try {
        if (await processCompanyScreeningMockTurn(state, userMessage, emit)) {
            return;
        }

        if (await forceResumeStageTransitionIfOverBudget(state, emit)) {
            return;
        }

        // ── Second-chance SQL panel close ────────────────────────────────────────────
        // If the SQL editor is still open (or cs_fundamentals FUNDAMENTALS stage with SQL cached)
        // when the user sends a new message, check whether the last AI response already asked
        // an OS/CN/OOP question (meaning the end-of-turn detection missed it — e.g. server
        // restart between deploy and test). Close the panel now before building the next prompt.
        if (userMessage) {
            const hasActiveSqlContext = !!(
                state.sqlEditorOpened ||
                state.sqlSnapshot ||
                state.sqlQuestionDescription
            );
            const sqlQCachedCheck = state.cachedQuestionData && [...state.cachedQuestionData.values()].some(q => q.category === "SQL");
            const likelySqlRoundInProgress = hasActiveSqlContext || hasRecentSqlRoundSignals(state.history);
            const sqlHandoffRequested =
                isSqlAdvanceIntent(userMessage) ||
                (likelySqlRoundInProgress && isGenericMoveOnIntent(userMessage));
            const nextAfterSql = getNextCSPhase(state, "SQL");
            const sqlMoveOnInstruction =
                "[SYSTEM NOTIFICATION] SQL round is now closed because the candidate asked to move on. " +
                (nextAfterSql
                    ? `Continue immediately with the next configured CS topic (${nextAfterSql}) using its QUESTION BANK entry. `
                    : "Transition to CLOSING now. ") +
                "Do NOT reopen SQL and do NOT repeat earlier theory questions.";

            if (
                state.currentStage === "FUNDAMENTALS" &&
                !state.sqlRoundCompleted &&
                (likelySqlRoundInProgress || sqlQCachedCheck) &&
                sqlHandoffRequested
            ) {
                emit("panel:close", { summary: "SQL round complete." });
                state.sqlEditorOpened = false;
                state.sqlSnapshot = null;
                state.sqlQuestionDescription = null;
                state.sqlRoundCompleted = true;
                state.currentFundamentalsPhase = nextAfterSql || "CLOSING";
                clearSQLTimers(sessionId);

                await prisma.sessionMessage.create({
                    data: {
                        sessionId,
                        role: "user",
                        content: userMessage,
                        stage: state.currentStage,
                    },
                });
                state.history.push({ role: "user", content: userMessage });

                const ack = nextAfterSql ? "Okay, let's continue." : "Okay, let's wrap up.";
                const handoffMessageId = `msg_${Date.now()}_${++messageCounter}`;
                emit("ai:token", { token: "", messageId: handoffMessageId });
                emit("ai:token", { token: ack, messageId: handoffMessageId });
                emit("ai:done", { messageId: handoffMessageId, fullContent: ack });

                state.history.push({ role: "assistant", content: ack });
                await prisma.sessionMessage.create({
                    data: {
                        sessionId,
                        role: "assistant",
                        content: ack,
                        stage: state.currentStage,
                    },
                });

                state.history.push({
                    role: "user",
                    content: sqlMoveOnInstruction,
                });

                console.log(`[Orchestrator] Candidate requested SQL handoff; closed SQL panel for ${sessionId}`);

                setTimeout(() => {
                    processAgentTurn(sessionId, null, emit).catch((err) => {
                        console.error(`[Orchestrator] Post-SQL-handoff kickoff error for ${sessionId}:`, err);
                    });
                }, 0);

                return;
            }
            if (state.sqlEditorOpened || (state.currentStage === "FUNDAMENTALS" && sqlQCachedCheck)) {
                const lastAIMsg = [...state.history].reverse().find(m => m.role === "assistant");
                const lastAIContent = typeof lastAIMsg?.content === "string" ? lastAIMsg.content : "";
                if (lastAIContent) {
                    const topicPattern = /\b(operating systems?|computer networks?|object[- ]oriented|object oriented programming|oops)\b|\bos\b|\bcn\b/i;
                    let snippetMatch = false;
                    if (state.prefetchedCSQuestions) {
                        outer2: for (const [cat, qs] of state.prefetchedCSQuestions) {
                            if (cat === "SQL_query") continue;
                            for (const q of qs) {
                                const snippet = q.questionText.slice(0, 60).toLowerCase().trim();
                                if (snippet.length > 15 && lastAIContent.toLowerCase().includes(snippet)) {
                                    snippetMatch = true;
                                    break outer2;
                                }
                            }
                        }
                    }
                    if (topicPattern.test(lastAIContent) || snippetMatch) {
                        emit("panel:close", { summary: "SQL round complete." });
                        state.sqlEditorOpened = false;
                        state.sqlSnapshot = null;
                        state.sqlQuestionDescription = null;
                        state.sqlRoundCompleted = true;
                        state.currentFundamentalsPhase = getNextCSPhase(state, "SQL") || "CLOSING";
                        clearSQLTimers(sessionId);
                        console.log(`[Orchestrator] Second-chance auto-closed SQL panel on user turn for ${sessionId}`);
                    }
                }
            }
        }
        // ────────────────────────────────────────────────────────────────────────────

        // Data Science guardrail: own the phase handoff when the candidate accepts
        // the concepts offer, instead of letting the model verbally continue in INTRO.
        if (
            userMessage &&
            state.interviewType === "data_science_role" &&
            state.currentStage === "INTRO" &&
            state.prefetchedDSConceptQuestions?.length &&
            didAssistantOfferDSConcepts(state.history) &&
            isShortAffirmative(userMessage)
        ) {
            const transitionCtx: ToolContext = {
                sessionId: state.sessionId,
                userId: state.userId,
                interviewType: state.interviewType,
                currentStage: state.currentStage,
                askedQuestionIds: state.askedQuestionIds,
                role: state.role,
                level: state.level,
                stageOrder: state.stageOrder,
                lastFetchedQuestionId: state.lastFetchedQuestionId,
                lastFetchedLanguage: state.lastFetchedLanguage,
                prefetchedDSAQuestion: state.prefetchedDSAQuestion,
                prefetchedBehavioralQuestions: state.prefetchedBehavioralQuestions,
                cachedQuestionData: state.cachedQuestionData,
                scratchpadOpened: state.scratchpadOpened,
                systemDesignExchangeCount: state.systemDesignExchangeCount,
                prefetchedDSConceptQuestions: state.prefetchedDSConceptQuestions,
                prefetchedDSSQLQuestion: state.prefetchedDSSQLQuestion,
                prefetchedDSCodingQuestion: state.prefetchedDSCodingQuestion,
                emit,
            };

            const transitionResult = await handleToolCall(
                "transition_stage",
                { nextStage: "DS_CONCEPTS", reason: "Candidate accepted the DS concepts handoff." },
                transitionCtx
            );

            if (transitionResult.startsWith("Interview transitioned")) {
                await prisma.sessionMessage.create({
                    data: { sessionId, role: "user", content: userMessage, stage: "INTRO" },
                });
                state.history.push({ role: "user", content: userMessage });
                state.currentStage = "DS_CONCEPTS";

                const firstQ = state.prefetchedDSConceptQuestions[0];
                if (firstQ && !state.askedQuestionIds.includes(firstQ.questionId)) {
                    await handleToolCall(
                        "record_question",
                        {
                            questionFundamentalId: firstQ.questionId,
                            questionTitle: firstQ.question,
                            referenceAnswer: firstQ.referenceAnswer,
                        },
                        { ...transitionCtx, currentStage: "DS_CONCEPTS" as any }
                    );
                }

                const conceptMessage = firstQ
                    ? `Let's move to some statistics and ML fundamentals. ${firstQ.question}`
                    : "Let's move to some statistics and ML fundamentals.";
                const conceptMessageId = `msg_${Date.now()}_${++messageCounter}`;
                emit("ai:token", { token: "", messageId: conceptMessageId });
                emit("ai:token", { token: conceptMessage, messageId: conceptMessageId });
                emit("ai:done", { messageId: conceptMessageId, fullContent: conceptMessage });

                state.history.push({ role: "assistant", content: conceptMessage });
                await prisma.sessionMessage.create({
                    data: { sessionId, role: "assistant", content: conceptMessage, stage: "DS_CONCEPTS" },
                });
                return;
            }
        }

        // Data Science guardrail: candidate asked to move on from concepts, so
        // enter DS_SQL and open the DB-backed SQL editor before any LLM response.
        if (
            userMessage &&
            state.interviewType === "data_science_role" &&
            state.currentStage === "DS_CONCEPTS" &&
            state.prefetchedDSSQLQuestion &&
            isGenericMoveOnIntent(userMessage)
        ) {
            const transitionCtx: ToolContext = {
                sessionId: state.sessionId,
                userId: state.userId,
                interviewType: state.interviewType,
                currentStage: state.currentStage,
                askedQuestionIds: state.askedQuestionIds,
                role: state.role,
                level: state.level,
                stageOrder: state.stageOrder,
                lastFetchedQuestionId: state.lastFetchedQuestionId,
                lastFetchedLanguage: state.lastFetchedLanguage,
                prefetchedDSAQuestion: state.prefetchedDSAQuestion,
                prefetchedBehavioralQuestions: state.prefetchedBehavioralQuestions,
                cachedQuestionData: state.cachedQuestionData,
                scratchpadOpened: state.scratchpadOpened,
                systemDesignExchangeCount: state.systemDesignExchangeCount,
                prefetchedDSConceptQuestions: state.prefetchedDSConceptQuestions,
                prefetchedDSSQLQuestion: state.prefetchedDSSQLQuestion,
                prefetchedDSCodingQuestion: state.prefetchedDSCodingQuestion,
                onSQLEditorOpened: () => startSQLPhaseTimers(state.sessionId, emit),
                emit,
            };

            const askedDSConceptCount = state.prefetchedDSConceptQuestions.filter((q) =>
                state.askedQuestionIds.includes(q.questionId)
            ).length;
            if (askedDSConceptCount < 1 && isBareSkipIntent(userMessage)) {
                const nextQ = state.prefetchedDSConceptQuestions.find((q) =>
                    !state.askedQuestionIds.includes(q.questionId)
                );
                if (nextQ) {
                    await handleToolCall(
                        "record_question",
                        {
                            questionFundamentalId: nextQ.questionId,
                            questionTitle: nextQ.question,
                            referenceAnswer: nextQ.referenceAnswer,
                        },
                        transitionCtx
                    );
                    await prisma.sessionMessage.create({
                        data: { sessionId, role: "user", content: userMessage, stage: "DS_CONCEPTS" },
                    });
                    state.history.push({ role: "user", content: userMessage });

                    const conceptMessage = `No problem, let's try another one. ${nextQ.question}`;
                    const conceptMessageId = `msg_${Date.now()}_${++messageCounter}`;
                    emit("ai:token", { token: "", messageId: conceptMessageId });
                    emit("ai:token", { token: conceptMessage, messageId: conceptMessageId });
                    emit("ai:done", { messageId: conceptMessageId, fullContent: conceptMessage });
                    state.history.push({ role: "assistant", content: conceptMessage });
                    await prisma.sessionMessage.create({
                        data: { sessionId, role: "assistant", content: conceptMessage, stage: "DS_CONCEPTS" },
                    });
                    return;
                }
            }

            const transitionResult = await handleToolCall(
                "transition_stage",
                { nextStage: "DS_SQL", reason: "Candidate requested to move on from DS concepts." },
                transitionCtx
            );

            if (transitionResult.startsWith("Interview transitioned")) {
                await prisma.sessionMessage.create({
                    data: { sessionId, role: "user", content: userMessage, stage: "DS_CONCEPTS" },
                });
                state.history.push({ role: "user", content: userMessage });
                state.currentStage = "DS_SQL";
                state.sqlEditorOpened = true;
                state.currentQuestionTitle = state.prefetchedDSSQLQuestion.title;
                state.sqlQuestionDescription = `${state.prefetchedDSSQLQuestion.title || ""}\n\n${state.prefetchedDSSQLQuestion.description || ""}`;

                const sqlMessage = describeSqlQuestionForSpeech(state.prefetchedDSSQLQuestion);
                const sqlMessageId = `msg_${Date.now()}_${++messageCounter}`;
                emit("ai:token", { token: "", messageId: sqlMessageId });
                emit("ai:token", { token: sqlMessage, messageId: sqlMessageId });
                emit("ai:done", { messageId: sqlMessageId, fullContent: sqlMessage });

                state.history.push({ role: "assistant", content: sqlMessage });
                await prisma.sessionMessage.create({
                    data: { sessionId, role: "assistant", content: sqlMessage, stage: "DS_SQL" },
                });
                return;
            }
        }

        if (
            userMessage &&
            state.interviewType === "data_science_role" &&
            state.currentStage === "DS_CONCEPTS" &&
            !state.stageOrder.includes("DS_SQL") &&
            state.currentStage === state.stageOrder[state.stageOrder.length - 1] &&
            (/\bsql\b/i.test(userMessage) || isGenericMoveOnIntent(userMessage))
        ) {
            const toolCtx: ToolContext = {
                sessionId: state.sessionId,
                userId: state.userId,
                interviewType: state.interviewType,
                currentStage: state.currentStage,
                askedQuestionIds: state.askedQuestionIds,
                role: state.role,
                level: state.level,
                stageOrder: state.stageOrder,
                lastFetchedQuestionId: state.lastFetchedQuestionId,
                lastFetchedLanguage: state.lastFetchedLanguage,
                prefetchedDSAQuestion: state.prefetchedDSAQuestion,
                prefetchedBehavioralQuestions: state.prefetchedBehavioralQuestions,
                cachedQuestionData: state.cachedQuestionData,
                scratchpadOpened: state.scratchpadOpened,
                systemDesignExchangeCount: state.systemDesignExchangeCount,
                prefetchedDSConceptQuestions: state.prefetchedDSConceptQuestions,
                emit,
            };

            await prisma.sessionMessage.create({
                data: { sessionId, role: "user", content: userMessage, stage: "DS_CONCEPTS" },
            });
            state.history.push({ role: "user", content: userMessage });

            await handleToolCall(
                "end_interview",
                { summary: "Candidate requested a non-enabled SQL section after the selected DS concepts module." },
                toolCtx
            );

            const finalLine = "This session only had the selected data science concepts module enabled, so we'll end here. Thank you for your time.";
            const messageId = `msg_${Date.now()}_${++messageCounter}`;
            emit("ai:token", { token: "", messageId });
            emit("ai:token", { token: finalLine, messageId });
            emit("ai:done", { messageId, fullContent: finalLine });
            state.history.push({ role: "assistant", content: finalLine });
            await prisma.sessionMessage.create({
                data: { sessionId, role: "assistant", content: finalLine, stage: "DS_CONCEPTS" },
            });
            return;
        }

        if (
            userMessage &&
            state.interviewType === "data_science_role" &&
            state.currentStage === "DS_SQL" &&
            state.prefetchedDSCodingQuestion &&
            isGenericMoveOnIntent(userMessage)
        ) {
            const transitionCtx: ToolContext = {
                sessionId: state.sessionId,
                userId: state.userId,
                interviewType: state.interviewType,
                currentStage: state.currentStage,
                askedQuestionIds: state.askedQuestionIds,
                role: state.role,
                level: state.level,
                stageOrder: state.stageOrder,
                lastFetchedQuestionId: state.lastFetchedQuestionId,
                lastFetchedLanguage: state.lastFetchedLanguage,
                prefetchedDSAQuestion: state.prefetchedDSAQuestion,
                prefetchedBehavioralQuestions: state.prefetchedBehavioralQuestions,
                cachedQuestionData: state.cachedQuestionData,
                scratchpadOpened: state.scratchpadOpened,
                systemDesignExchangeCount: state.systemDesignExchangeCount,
                prefetchedDSConceptQuestions: state.prefetchedDSConceptQuestions,
                prefetchedDSSQLQuestion: state.prefetchedDSSQLQuestion,
                prefetchedDSCodingQuestion: state.prefetchedDSCodingQuestion,
                emit,
            };
            const transitionResult = await handleToolCall(
                "transition_stage",
                { nextStage: "DS_CODING", reason: "Candidate requested to move on from SQL." },
                transitionCtx
            );
            if (transitionResult.startsWith("Interview transitioned")) {
                await prisma.sessionMessage.create({
                    data: { sessionId, role: "user", content: userMessage, stage: "DS_SQL" },
                });
                state.history.push({ role: "user", content: userMessage });
                state.currentStage = "DS_CODING";
                state.sqlEditorOpened = false;
                state.currentQuestionTitle = state.prefetchedDSCodingQuestion.title;
                state.lastFetchedQuestionId = state.prefetchedDSCodingQuestion.questionId;
                state.lastFetchedLanguage = "python";

                const msg = `Understood. We'll move on to a Python data analysis task now. I've opened ${state.prefetchedDSCodingQuestion.title} in the coding editor; take a moment to read it, then walk me through your approach.`;
                const msgId = `msg_${Date.now()}_${++messageCounter}`;
                emit("ai:token", { token: "", messageId: msgId });
                emit("ai:token", { token: msg, messageId: msgId });
                emit("ai:done", { messageId: msgId, fullContent: msg });
                state.history.push({ role: "assistant", content: msg });
                await prisma.sessionMessage.create({
                    data: { sessionId, role: "assistant", content: msg, stage: "DS_CODING" },
                });
                return;
            }
        }

        // PM case handoff must be server-owned. If the candidate is unsure in
        // INTRO, do not let the LLM invent a product case while it calls
        // transition_stage; open the notepad and speak the DB case directly.
        if (
            userMessage &&
            state.interviewType === "pm_role" &&
            state.currentStage === "INTRO" &&
            state.prefetchedPMCaseQuestion &&
            (isUnknownResponseIntent(userMessage) || isGenericMoveOnIntent(userMessage))
        ) {
            const transitionCtx: ToolContext = {
                sessionId: state.sessionId,
                userId: state.userId,
                interviewType: state.interviewType,
                currentStage: state.currentStage,
                askedQuestionIds: state.askedQuestionIds,
                role: state.role,
                level: state.level,
                stageOrder: state.stageOrder,
                lastFetchedQuestionId: state.lastFetchedQuestionId,
                lastFetchedLanguage: state.lastFetchedLanguage,
                prefetchedDSAQuestion: state.prefetchedDSAQuestion,
                prefetchedBehavioralQuestions: state.prefetchedBehavioralQuestions,
                cachedQuestionData: state.cachedQuestionData,
                scratchpadOpened: state.scratchpadOpened,
                systemDesignExchangeCount: state.systemDesignExchangeCount,
                prefetchedPMCaseQuestion: state.prefetchedPMCaseQuestion,
                prefetchedPMConceptQuestions: state.prefetchedPMConceptQuestions,
                prefetchedPMStrategyQuestion: state.prefetchedPMStrategyQuestion,
                emit,
            };

            const transitionResult = await handleToolCall(
                "transition_stage",
                { nextStage: "PM_CASE", reason: "Candidate was unsure in PM intro; moving to DB-backed product case." },
                transitionCtx
            );

            if (transitionResult.startsWith("Interview transitioned")) {
                const caseQ = state.prefetchedPMCaseQuestion;
                await prisma.sessionMessage.create({
                    data: { sessionId, role: "user", content: userMessage, stage: "INTRO" },
                });
                state.history.push({ role: "user", content: userMessage });

                state.currentStage = "PM_CASE";
                state.scratchpadOpened = true;
                state.currentQuestionTitle = caseQ.title;

                const caseIntro =
                    `We'll now move to a case study. ${caseQ.scenario} ` +
                    `Use the notepad to jot down your thoughts and frame your answer using the CIRCLES framework. ` +
                    `Start by clarifying the problem, then walk me through your structure.`;
                const caseMessageId = `msg_${Date.now()}_${++messageCounter}`;
                emit("ai:token", { token: "", messageId: caseMessageId });
                emit("ai:token", { token: caseIntro, messageId: caseMessageId });
                emit("ai:done", { messageId: caseMessageId, fullContent: caseIntro });

                state.history.push({ role: "assistant", content: caseIntro });
                await prisma.sessionMessage.create({
                    data: { sessionId, role: "assistant", content: caseIntro, stage: "PM_CASE" },
                });

                state.history.push({
                    role: "user",
                    content:
                        `[SYSTEM NOTIFICATION] PM case DB scenario is active: ID=${caseQ.questionId}, title="${caseQ.title}". ` +
                        "The CIRCLES notepad is already open. Use ONLY this case scenario. Do NOT invent a different product case.",
                });

                return;
            }
        }

        if (
            userMessage &&
            ((state.interviewType === "data_science_role" && state.currentStage === "DS_CODING") ||
             (state.interviewType === "gen_ai_role" && state.currentStage === "GEN_AI_CODING")) &&
            isGenericMoveOnIntent(userMessage)
        ) {
            const nextStage = getNextEnabledStage(state.stageOrder, state.currentStage);
            if (!nextStage) return;
            const transitionCtx: ToolContext = {
                sessionId: state.sessionId,
                userId: state.userId,
                interviewType: state.interviewType,
                currentStage: state.currentStage,
                askedQuestionIds: state.askedQuestionIds,
                role: state.role,
                level: state.level,
                stageOrder: state.stageOrder,
                lastFetchedQuestionId: state.lastFetchedQuestionId,
                lastFetchedLanguage: state.lastFetchedLanguage,
                prefetchedDSAQuestion: state.prefetchedDSAQuestion,
                prefetchedBehavioralQuestions: state.prefetchedBehavioralQuestions,
                cachedQuestionData: state.cachedQuestionData,
                scratchpadOpened: state.scratchpadOpened,
                systemDesignExchangeCount: state.systemDesignExchangeCount,
                prefetchedGenAICodingQuestion: state.prefetchedGenAICodingQuestion,
                prefetchedDSCodingQuestion: state.prefetchedDSCodingQuestion,
                emit,
            };
            const transitionResult = await handleToolCall(
                "transition_stage",
                { nextStage, reason: "Candidate requested to move on from coding." },
                transitionCtx
            );
            if (transitionResult.startsWith("Interview transitioned")) {
                await prisma.sessionMessage.create({
                    data: { sessionId, role: "user", content: userMessage, stage: state.currentStage },
                });
                state.history.push({ role: "user", content: userMessage });
                state.currentStage = nextStage;
                emit("panel:close", { summary: "Coding round complete." });

                const msg = state.interviewType === "data_science_role"
                    ? "Understood. Let's move to a business metrics case."
                    : "Understood. Let's move to one final AI responsibility scenario. Imagine a generative AI feature is creating user-impacting recommendations, and your team finds a serious quality or safety risk after launch. What steps would you take?";
                const msgId = `msg_${Date.now()}_${++messageCounter}`;
                emit("ai:token", { token: "", messageId: msgId });
                emit("ai:token", { token: msg, messageId: msgId });
                emit("ai:done", { messageId: msgId, fullContent: msg });
                state.history.push({ role: "assistant", content: msg });
                await prisma.sessionMessage.create({
                    data: { sessionId, role: "assistant", content: msg, stage: nextStage },
                });

                if (state.interviewType === "gen_ai_role") {
                    return;
                }

                setTimeout(() => {
                    processAgentTurn(sessionId, null, emit).catch((err) => {
                        console.error(`[Orchestrator] Post-coding handoff kickoff error for ${sessionId}:`, err);
                    });
                }, 0);
                return;
            }
        }

        // Deterministic DSA handoff: if the candidate explicitly asks to move on,
        // transition to FUNDAMENTALS immediately instead of relying on model compliance.
        const nextAfterDSA = getNextEnabledStage(state.stageOrder, "DSA");
        if (
            userMessage &&
            state.interviewType === "full_interview" &&
            state.currentStage === "DSA" &&
            nextAfterDSA &&
            isDsaAdvanceIntent(userMessage)
        ) {
            const transitionCtx: ToolContext = {
                sessionId: state.sessionId,
                userId: state.userId,
                interviewType: state.interviewType,
                currentStage: state.currentStage,
                askedQuestionIds: state.askedQuestionIds,
                role: state.role,
                level: state.level,
                stageOrder: state.stageOrder,
                lastFetchedQuestionId: state.lastFetchedQuestionId,
                lastFetchedLanguage: state.lastFetchedLanguage,
                prefetchedDSAQuestion: state.prefetchedDSAQuestion,
                prefetchedBehavioralQuestions: state.prefetchedBehavioralQuestions,
                cachedQuestionData: state.cachedQuestionData,
                scratchpadOpened: state.scratchpadOpened,
                systemDesignExchangeCount: state.systemDesignExchangeCount,
                emit,
            };

            const transitionResult = await handleToolCall(
                "transition_stage",
                {
                    nextStage: nextAfterDSA,
                    reason: "Candidate requested to move on from DSA after attempting the problem.",
                },
                transitionCtx
            );

            if (transitionResult.startsWith("Interview transitioned")) {
                await prisma.sessionMessage.create({
                    data: {
                        sessionId,
                        role: "user",
                        content: userMessage,
                        stage: "DSA",
                    },
                });
                state.history.push({ role: "user", content: userMessage });

                state.currentStage = nextAfterDSA;
                clearDSATimers(sessionId);

                const ack = "Understood. We'll move forward now.";
                const transitionMessageId = `msg_${Date.now()}_${++messageCounter}`;
                emit("ai:token", { token: "", messageId: transitionMessageId });
                emit("ai:token", { token: ack, messageId: transitionMessageId });
                emit("ai:done", { messageId: transitionMessageId, fullContent: ack });

                state.history.push({ role: "assistant", content: ack });
                await prisma.sessionMessage.create({
                    data: {
                        sessionId,
                        role: "assistant",
                        content: ack,
                        stage: nextAfterDSA,
                    },
                });

                state.history.push({
                    role: "user",
                    content:
                        "[SYSTEM NOTIFICATION] Candidate requested to skip the DSA problem and move forward. " +
                        "Continue immediately with the current stage instructions. " +
                        "Do NOT end interview and do NOT return to DSA.",
                });

                setTimeout(() => {
                    processAgentTurn(sessionId, null, emit).catch((err) => {
                        console.error(`[Orchestrator] Post-DSA-skip kickoff error for ${sessionId}:`, err);
                    });
                }, 0);

                return;
            }
        }

        // Deterministic INTRO -> DSA handoff: if the candidate explicitly asks
        // to start the coding round, transition immediately and open IDE.
        const nextAfterIntro = getNextEnabledStage(state.stageOrder, "INTRO");
        if (
            userMessage &&
            state.interviewType === "full_interview" &&
            state.currentStage === "INTRO" &&
            nextAfterIntro &&
            isIntroToDsaAdvanceIntent(userMessage)
        ) {
            const transitionCtx: ToolContext = {
                sessionId: state.sessionId,
                userId: state.userId,
                interviewType: state.interviewType,
                currentStage: state.currentStage,
                askedQuestionIds: state.askedQuestionIds,
                role: state.role,
                level: state.level,
                stageOrder: state.stageOrder,
                lastFetchedQuestionId: state.lastFetchedQuestionId,
                lastFetchedLanguage: state.lastFetchedLanguage,
                prefetchedDSAQuestion: state.prefetchedDSAQuestion,
                prefetchedBehavioralQuestions: state.prefetchedBehavioralQuestions,
                cachedQuestionData: state.cachedQuestionData,
                scratchpadOpened: state.scratchpadOpened,
                systemDesignExchangeCount: state.systemDesignExchangeCount,
                emit,
            };

            const transitionResult = await handleToolCall(
                "transition_stage",
                {
                    nextStage: nextAfterIntro,
                    reason: "Candidate requested to advance from the introduction.",
                },
                transitionCtx
            );

            if (transitionResult.startsWith("Interview transitioned")) {
                await prisma.sessionMessage.create({
                    data: {
                        sessionId,
                        role: "user",
                        content: userMessage,
                        stage: "INTRO",
                    },
                });
                state.history.push({ role: "user", content: userMessage });

                state.currentStage = nextAfterIntro;

                const ack = "Great, let's move forward now.";
                const transitionMessageId = `msg_${Date.now()}_${++messageCounter}`;
                emit("ai:token", { token: "", messageId: transitionMessageId });
                emit("ai:token", { token: ack, messageId: transitionMessageId });
                emit("ai:done", { messageId: transitionMessageId, fullContent: ack });

                state.history.push({ role: "assistant", content: ack });
                await prisma.sessionMessage.create({
                    data: {
                        sessionId,
                        role: "assistant",
                        content: ack,
                        stage: nextAfterIntro,
                    },
                });

                state.history.push({
                    role: "user",
                    content:
                        "[SYSTEM NOTIFICATION] Candidate requested to move forward from INTRO. " +
                        `${nextAfterIntro} stage is now active. Continue immediately with the current stage instructions.`,
                });

                setTimeout(() => {
                    processAgentTurn(sessionId, null, emit).catch((err) => {
                        console.error(`[Orchestrator] Post-INTRO-to-DSA kickoff error for ${sessionId}:`, err);
                    });
                }, 0);

                return;
            }
        }

        // Deterministic FUNDAMENTALS -> SQL handoff: if the candidate explicitly asks
        // to move to the SQL round and the SQL editor is not open yet, open it now.
        if (
            userMessage &&
            state.currentStage === "FUNDAMENTALS" &&
            !state.sqlEditorOpened &&
            !state.sqlRoundCompleted &&
            isFundamentalsToSqlIntent(userMessage)
        ) {
            const sqlOpenCtx: ToolContext = {
                sessionId: state.sessionId,
                userId: state.userId,
                interviewType: state.interviewType,
                currentStage: state.currentStage,
                askedQuestionIds: state.askedQuestionIds,
                role: state.role,
                level: state.level,
                stageOrder: state.stageOrder,
                lastFetchedQuestionId: state.lastFetchedQuestionId,
                lastFetchedLanguage: state.lastFetchedLanguage,
                prefetchedDSAQuestion: state.prefetchedDSAQuestion,
                prefetchedBehavioralQuestions: state.prefetchedBehavioralQuestions,
                cachedQuestionData: state.cachedQuestionData,
                scratchpadOpened: state.scratchpadOpened,
                systemDesignExchangeCount: state.systemDesignExchangeCount,
                onSQLEditorOpened: () => startSQLPhaseTimers(state.sessionId, emit),
                onSQLPanelClosed: () => {
                    clearSQLTimers(state.sessionId);
                    state.sqlSnapshot = null;
                    state.sqlQuestionDescription = null;
                },
                onDSAEditorOpened: () => startDSAPhaseTimers(state.sessionId, emit),
                onDSAPanelClosed: () => clearDSATimers(state.sessionId),
                emit,
            };

            const sqlOpenResult = await handleToolCall("open_sql_editor", {}, sqlOpenCtx);
            if (sqlOpenResult.startsWith("SQL editor opened")) {
                state.sqlEditorOpened = true;
                state.currentFundamentalsPhase = 'SQL';
                const sqlQuestion = [...state.cachedQuestionData.values()].find((q) => q?.category === "SQL");
                if (sqlQuestion?.problemDescription) {
                    state.sqlQuestionDescription = `${sqlQuestion.title || ""}\n\n${sqlQuestion.problemDescription}`;
                }
                state.history.push({
                    role: "user",
                    content:
                        "[SYSTEM NOTIFICATION] Candidate explicitly requested to move to SQL and SQL editor is now open. " +
                        `${describeSqlQuestionForSpeech(sqlQuestion)} Do not continue DBMS questions.`,
                });
                console.log(`[Orchestrator] Deterministically opened SQL editor from candidate handoff intent for ${sessionId}`);
            }
        }

        // Deterministic safety net: if we're in final/closing stage and the candidate
        // indicates they are done, end interview immediately without relying on LLM tool use.
        const resumeCloseoutQuestion = Boolean(
            userMessage &&
            state.interviewType === "resume_round" &&
            (state.currentStage === "CLOSING" || didAssistantAskWrapUpQuestion(state.history)) &&
            isCloseoutQuestion(userMessage)
        );
        if (
            userMessage &&
            !state.companyScreening &&
            (state.currentStage === "CLOSING" || didAssistantAskWrapUpQuestion(state.history)) &&
            isQuestionOfferAffirmation(userMessage)
        ) {
            const content = "Sure, what would you like to ask?";
            const messageId = `msg_${Date.now()}_${++messageCounter}`;
            emit("ai:token", { token: "", messageId });
            emit("ai:token", { token: content, messageId });
            emit("ai:done", { messageId, fullContent: content });
            state.history.push({ role: "assistant", content });
            await prisma.sessionMessage.create({
                data: { sessionId, role: "assistant", content, stage: state.currentStage },
            });
            return;
        }
        const explicitEndIntent = userMessage && !resumeCloseoutQuestion ? isEndInterviewIntent(userMessage) : false;
        const closingAckIntent = userMessage && !resumeCloseoutQuestion ? isClosingAcknowledgement(userMessage) : false;
        // Company screening drives its own server-owned two-step close (see
        // enforceCompanyScreeningTurn); never let this generic path end it abruptly.
        if (userMessage && !state.companyScreening && (explicitEndIntent || closingAckIntent)) {
            const finalStage = state.stageOrder[state.stageOrder.length - 1];
            if (!finalStage) return;
            const resolvedFinalStage: InterviewStage = finalStage;
            const wrapUpPrompted = didAssistantAskWrapUpQuestion(state.history);
            const shouldForceClose =
                explicitEndIntent
                    ? (
                        state.currentStage === "CLOSING" ||
                        state.currentStage === resolvedFinalStage ||
                        wrapUpPrompted ||
                        (
                            state.currentStage === "SYSTEM_DESIGN" &&
                            state.scratchpadOpened &&
                            (wrapUpPrompted || (state.systemDesignExchangeCount ?? 0) >= 3)
                        )
                    )
                    : (state.currentStage === "CLOSING" || wrapUpPrompted);

            if (shouldForceClose) {
                const toolCtx: ToolContext = {
                    sessionId: state.sessionId,
                    userId: state.userId,
                    interviewType: state.interviewType,
                    currentStage: state.currentStage,
                    askedQuestionIds: state.askedQuestionIds,
                    role: state.role,
                    level: state.level,
                    stageOrder: state.stageOrder,
                    lastFetchedQuestionId: state.lastFetchedQuestionId,
                    lastFetchedLanguage: state.lastFetchedLanguage,
                    prefetchedDSAQuestion: state.prefetchedDSAQuestion,
                    prefetchedBehavioralQuestions: state.prefetchedBehavioralQuestions,
                    cachedQuestionData: state.cachedQuestionData,
                    scratchpadOpened: state.scratchpadOpened,
                    systemDesignExchangeCount: state.systemDesignExchangeCount,
                    resumeCloseoutAcknowledged: state.interviewType === "resume_round" && (state.currentStage === "CLOSING" || wrapUpPrompted),
                    emit,
                };

                await prisma.sessionMessage.create({
                    data: {
                        sessionId,
                        role: "user",
                        content: userMessage,
                        stage: state.currentStage,
                    },
                });

                // If we're still in SYSTEM_DESIGN after a wrap-up cue, force move to final stage first.
                if (state.currentStage !== resolvedFinalStage) {
                    const transitionResult = await handleToolCall(
                        "transition_stage",
                        { nextStage: resolvedFinalStage, reason: "Candidate indicated no further questions." },
                        toolCtx
                    );

                    if (!transitionResult.startsWith("Interview transitioned")) {
                        // Last-resort deterministic close to avoid re-opening interview loop.
                        const endingSession = await prisma.interviewSession.findUnique({
                            where: { id: sessionId },
                            select: { mode: true },
                        });
                        const isCompanyScreening = endingSession?.mode === "company_screening";
                        await prisma.interviewSession.update({
                            where: { id: sessionId },
                            data: { status: "COMPLETED", completedAt: new Date() },
                            select: { id: true },
                        });
                        if (!isCompanyScreening) {
                            await settleInterviewMinuteReservation(state.userId, sessionId);
                            updateStreakForUser(state.userId).catch(console.error);
                        }
                        emit("session:ending", {
                            message: isCompanyScreening
                                ? "Interview complete. Submitting your screening..."
                                : "Interview complete! Generating your evaluation report...",
                        });
                    } else {
                        state.currentStage = resolvedFinalStage;
                    }
                }

                await handleToolCall(
                    "end_interview",
                    { summary: "Candidate indicated no further questions and requested to conclude." },
                    toolCtx
                );

                const finalLine = "Thank you for your time today. Goodbye.";
                const messageId = `msg_${Date.now()}_${++messageCounter}`;
                emit("ai:token", { token: "", messageId });
                emit("ai:token", { token: finalLine, messageId });
                emit("ai:done", { messageId, fullContent: finalLine });

                state.history.push({ role: "user", content: userMessage });
                state.history.push({ role: "assistant", content: finalLine });

                await prisma.sessionMessage.create({
                    data: {
                        sessionId,
                        role: "assistant",
                        content: finalLine,
                        stage: state.currentStage,
                    },
                });
                return;
            }
        }

        // Determine the user text to send
        const userText =
            userMessage ?? (state.history.length === 0
                ? "Hello, I'm ready to begin the interview."
                : null);

        // Append user turn to history
        if (userText) {
            state.history.push({ role: "user", content: userText });

            // Persist user message to DB (skip the synthetic greeting)
            if (userMessage) {
                await prisma.sessionMessage.create({
                    data: {
                        sessionId,
                        role: "user",
                        content: userMessage,
                        stage: state.currentStage,
                    },
                });
            }

            // ── System Design: force scratchpad open after N exchanges ──
            // The LLM cannot reliably count exchanges or call tools on command,
            // so we DIRECTLY open the scratchpad from code (bypassing the LLM).
            if (userMessage && state.interviewType === "resume_round") {
                await forceResumeOpeningCalibrationTransition(state, userMessage, emit);
                await forceResumeStageTransitionAfterNonAnswers(state, userMessage, emit);
                await forceResumeAgendaAdvanceAfterAnsweredQuestionBudget(state, emit);
            }

            if (
                userMessage &&
                state.interviewType === "behavioural" &&
                state.currentStage === "INTRO"
            ) {
                const behaviouralIntroCtx = buildToolContextForState(state, emit);
                const transitionResult = await handleToolCall(
                    "transition_stage",
                    { nextStage: "BEHAVIOURAL", reason: "Standalone behavioural intro completed after first candidate response." },
                    behaviouralIntroCtx
                );
                if (transitionResult.startsWith("Interview transitioned")) {
                    state.currentStage = "BEHAVIOURAL";
                    state.stageStartedAtMs = Date.now();
                    state.history.push({
                        role: "user",
                        content:
                            "[SYSTEM NOTIFICATION] Behavioural intro is complete. Continue in the BEHAVIOURAL stage now. " +
                            "Do not ask more background or intro questions. Ask the first STAR-style behavioral example question.",
                    });
                }
            }

            if (
                userMessage &&
                state.interviewType === "system_design" &&
                state.currentStage === "INTRO"
            ) {
                state.introExchangeCount++;
                if (state.introExchangeCount >= SYSTEM_DESIGN_INTRO_FORCE_TRANSITION_THRESHOLD) {
                    const sdIntroCtx = buildToolContextForState(state, emit);
                    const transitionResult = await handleToolCall(
                        "transition_stage",
                        { nextStage: "SYSTEM_DESIGN", reason: "Server-owned hard cap reached for System Design INTRO." },
                        sdIntroCtx
                    );
                    if (transitionResult.startsWith("Interview transitioned")) {
                        await prisma.sessionMessage.create({
                            data: { sessionId, role: "user", content: userMessage, stage: "INTRO" },
                        });
                        state.history.push({ role: "user", content: userMessage });
                        state.currentStage = "SYSTEM_DESIGN";
                        state.stageStartedAtMs = Date.now();
                        state.systemDesignExchangeCount = 0;
                        sdIntroCtx.currentStage = "SYSTEM_DESIGN";
                        await sendServerSystemDesignIntro(state, emit);
                        return;
                    }
                }
            }

            if (
                userMessage &&
                state.interviewType === "pm_role" &&
                state.currentStage === "INTRO"
            ) {
                state.introExchangeCount++;
                const nextAfterPmIntro = getNextEnabledStage(state.stageOrder, "INTRO");
                const nextPmStageReady =
                    nextAfterPmIntro === "PM_CASE" ? !!state.prefetchedPMCaseQuestion :
                    nextAfterPmIntro === "PM_CONCEPTS" ? (state.prefetchedPMConceptQuestions || []).length > 0 :
                    nextAfterPmIntro === "PM_STRATEGY" ? !!state.prefetchedPMStrategyQuestion :
                    !!nextAfterPmIntro;
                if (state.introExchangeCount >= PM_INTRO_FORCE_TRANSITION_THRESHOLD && nextAfterPmIntro && nextPmStageReady) {
                    const pmIntroCtx = buildToolContextForState(state, emit);
                    const transitionResult = await handleToolCall(
                        "transition_stage",
                        { nextStage: nextAfterPmIntro, reason: "Server-owned hard cap reached for PM INTRO." },
                        pmIntroCtx
                    );
                    if (transitionResult.startsWith("Interview transitioned")) {
                        await prisma.sessionMessage.create({
                            data: { sessionId, role: "user", content: userMessage, stage: "INTRO" },
                        });
                        state.history.push({ role: "user", content: userMessage });
                        state.currentStage = nextAfterPmIntro;
                        state.stageStartedAtMs = Date.now();
                        pmIntroCtx.currentStage = nextAfterPmIntro;
                        if (nextAfterPmIntro === "PM_CASE" && state.prefetchedPMCaseQuestion) {
                            state.scratchpadOpened = true;
                            state.currentQuestionTitle = state.prefetchedPMCaseQuestion.title;
                            const caseQ = state.prefetchedPMCaseQuestion;
                            const caseIntro =
                                `We'll now move to a case study. ${caseQ.scenario} ` +
                                `Use the notepad to jot down your thoughts and frame your answer using the CIRCLES framework. ` +
                                `Start by clarifying the problem, then walk me through your structure.`;
                            const caseMessageId = `msg_${Date.now()}_${++messageCounter}`;
                            emit("ai:token", { token: "", messageId: caseMessageId });
                            emit("ai:token", { token: caseIntro, messageId: caseMessageId });
                            emit("ai:done", { messageId: caseMessageId, fullContent: caseIntro });
                            state.history.push({ role: "assistant", content: caseIntro });
                            await prisma.sessionMessage.create({
                                data: { sessionId, role: "assistant", content: caseIntro, stage: "PM_CASE" },
                            });
                            state.history.push({
                                role: "user",
                                content:
                                    `[SYSTEM NOTIFICATION] PM case DB scenario is active: ID=${caseQ.questionId}, title="${caseQ.title}". ` +
                                    "The CIRCLES notepad is already open. Use ONLY this case scenario. Do NOT invent a different product case.",
                            });
                            return;
                        }
                        state.history.push({
                            role: "user",
                            content:
                                "[SYSTEM NOTIFICATION] PM INTRO hard cap reached. " +
                                "Do not ask any more resume/product-background questions. Continue only with the next configured PM stage.",
                        });
                    }
                }
            }

            if (
                userMessage &&
                state.interviewType === "data_science_role" &&
                state.currentStage === "INTRO"
            ) {
                state.introExchangeCount++;
                const nextAfterDsIntro = getNextEnabledStage(state.stageOrder, "INTRO");
                const nextDsStageReady =
                    nextAfterDsIntro === "DS_CONCEPTS" ? (state.prefetchedDSConceptQuestions || []).length > 0 :
                    nextAfterDsIntro === "DS_SQL" ? !!state.prefetchedDSSQLQuestion :
                    nextAfterDsIntro === "DS_CODING" ? !!state.prefetchedDSCodingQuestion :
                    !!nextAfterDsIntro;
                if (state.introExchangeCount >= DATA_SCIENCE_INTRO_FORCE_TRANSITION_THRESHOLD && nextAfterDsIntro && nextDsStageReady) {
                    const dsIntroCtx = buildToolContextForState(state, emit);
                    dsIntroCtx.forceIntroExit = true;
                    const transitionResult = await handleToolCall(
                        "transition_stage",
                        { nextStage: nextAfterDsIntro, reason: "Server-owned hard cap reached for Data Science INTRO." },
                        dsIntroCtx
                    );
                    if (transitionResult.startsWith("Interview transitioned")) {
                        state.currentStage = nextAfterDsIntro;
                        state.stageStartedAtMs = Date.now();
                        state.history.push({
                            role: "user",
                            content:
                                "[SYSTEM NOTIFICATION] Data Science INTRO hard cap reached. " +
                                "Do not ask any more resume/project/background questions. Continue only with the next configured Data Science stage.",
                        });
                    }
                }
            }

            if (
                userMessage &&
                state.interviewType === "gen_ai_role" &&
                state.currentStage === "INTRO"
            ) {
                state.introExchangeCount++;
                const weakAnswerCount = countWeakGenAIIntroAnswers(state.history);
                if (
                    state.introExchangeCount >= GENAI_INTRO_FORCE_TRANSITION_THRESHOLD ||
                    weakAnswerCount >= 2 ||
                    isGenericMoveOnIntent(userMessage)
                ) {
                    if (await sendServerGenAIConceptIntro(
                        state,
                        emit,
                        weakAnswerCount >= 2
                            ? "Candidate gave repeated weak/non-owner GenAI intro answers."
                            : "GenAI intro budget reached; moving to DB-backed GenAI fundamentals."
                    )) {
                        return;
                    }
                }

                if (weakAnswerCount > 0) {
                    state.history.push({
                        role: "user",
                        content:
                            "[SYSTEM NOTIFICATION] This is a GenAI role interview, not a generic resume screen. " +
                            "Do not revisit projects that got weak/non-owner answers. Ask the next question about GenAI ownership, model/RAG/prompting choices, evaluation, hallucination, latency, or cost; or transition to GenAI fundamentals.",
                    });
                }
            }

            if (
                userMessage &&
                state.interviewType === "full_interview" &&
                state.currentStage === "INTRO"
            ) {
                state.introExchangeCount++;
                const nextAfterFullIntro = getNextEnabledStage(state.stageOrder, "INTRO");
                if (
                    state.introExchangeCount >= FULL_INTERVIEW_INTRO_FORCE_TRANSITION_THRESHOLD &&
                    nextAfterFullIntro === "DSA" &&
                    state.prefetchedDSAQuestion
                ) {
                    const fullIntroCtx = buildToolContextForState(state, emit);
                    fullIntroCtx.forceIntroExit = true;
                    const transitionResult = await handleToolCall(
                        "transition_stage",
                        { nextStage: "DSA", reason: "Server-owned hard cap reached for Full Interview INTRO." },
                        fullIntroCtx
                    );
                    if (transitionResult.startsWith("Interview transitioned")) {
                        state.currentStage = "DSA";
                        state.stageStartedAtMs = Date.now();
                        state.currentQuestionTitle = state.prefetchedDSAQuestion.title;
                        state.lastFetchedQuestionId = state.prefetchedDSAQuestion.id;
                        state.history.push({
                            role: "user",
                            content:
                                "[SYSTEM NOTIFICATION] Full Interview INTRO hard cap reached. " +
                                "Do not ask any more resume/background questions. Continue only with the pinned DSA problem.",
                        });
                        await sendServerDsaIntro(state, emit);
                        return;
                    }
                }
            }

            if (
                userMessage &&
                state.interviewType === "behavioural" &&
                state.currentStage === "BEHAVIOURAL"
            ) {
                const nonAnswerCount = countBehaviouralNonAnswers(state.history);
                if (nonAnswerCount >= 3) {
                    const behaviouralClosingCtx = buildToolContextForState(state, emit);
                    const transitionResult = await handleToolCall(
                        "transition_stage",
                        { nextStage: "CLOSING", reason: "Candidate skipped or refused multiple behavioural prompts." },
                        behaviouralClosingCtx
                    );
                    if (transitionResult.startsWith("Interview transitioned")) {
                        state.currentStage = "CLOSING";
                        state.stageStartedAtMs = Date.now();
                    }
                    state.history.push({
                        role: "user",
                        content:
                            "[SYSTEM NOTIFICATION] Candidate has skipped, refused, or given no usable story for multiple behavioural prompts. " +
                            "Close the interview factually now. Do NOT praise willingness to engage, coachability, ownership, communication, or effort. " +
                            "Say there is not enough behavioral evidence because most examples were skipped or not developed.",
                    });
                }
            }

            if (
                userMessage &&
                state.currentStage === "SYSTEM_DESIGN" &&
                state.prefetchedSDQuestion &&
                !hasDeliveredSystemDesignIntro(state.history, state.prefetchedSDQuestion.title)
            ) {
                console.warn(`[Orchestrator] Missing SD title intro before SYSTEM_DESIGN turn; delivering server intro for ${sessionId}`);
                await sendServerSystemDesignIntro(state, emit);
                return;
            }

            if (
                state.currentStage === "SYSTEM_DESIGN" &&
                userMessage // only count real user messages, not synthetic greeting
            ) {
                state.systemDesignExchangeCount++;
                console.log(
                    `[Orchestrator] SYSTEM_DESIGN exchange #${state.systemDesignExchangeCount}/${SD_SCRATCHPAD_FORCE_THRESHOLD} for ${sessionId}`
                );

                // Also detect if the user explicitly asks for the scratchpad
                const userWantsScratchpad = /scratchpad|whiteboard|diagram|draw/i.test(userMessage);

                if (
                    !state.scratchpadOpened &&
                    (state.systemDesignExchangeCount >= SD_SCRATCHPAD_FORCE_THRESHOLD || userWantsScratchpad)
                ) {
                    const reason = userWantsScratchpad
                        ? "user requested"
                        : `hit ${SD_SCRATCHPAD_FORCE_THRESHOLD} exchanges`;
                    console.log(
                        `[Orchestrator] FORCE-OPENING scratchpad for ${sessionId} (${reason})`
                    );

                    // ── DIRECTLY open the scratchpad via WebSocket ──
                    emit("panel:open", buildSystemDesignPanelPayload(state));

                    state.scratchpadOpened = true;

                    // Tell the LLM that the scratchpad is ALREADY open
                    state.history.push({
                        role: "user",
                        content:
                            "[SYSTEM NOTIFICATION] The scratchpad/whiteboard has been opened automatically. " +
                            "It is now visible to the candidate. Do NOT call open_scratchpad — it is already open. " +
                            "Your next response should be brief: ask the candidate to diagram their high-level " +
                            "architecture on the whiteboard. For example: 'Great discussion so far. The whiteboard " +
                            "is now open — go ahead and diagram your high-level architecture, and walk me through " +
                            "the components as you draw them.' Then let the candidate draw and probe their diagram.",
                    });
                }
            }
        }

        // Deterministic anti-loop guard: when the candidate says they don't know,
        // do not let the model keep repeating the same fundamentals main question.
        // Fires on EITHER: (a) same question repeated in recent window, OR
        // (b) candidate said "I don't know" 2+ times consecutively.
        if (
            userMessage &&
            state.currentStage === "FUNDAMENTALS" &&
            isUnknownResponseIntent(userMessage)
        ) {
            const repeatedQuestion = hasRecentRepeatedAssistantQuestion(state.history);
            const consecutiveUnknown = hasConsecutiveUnknownResponses(state.history);

            if (repeatedQuestion || consecutiveUnknown) {
                const notification = consecutiveUnknown
                    ? "[SYSTEM NOTIFICATION] Candidate has said they do not know multiple times in a row. " +
                      "Do NOT ask the same question or a follow-up on the same topic again. " +
                      "Move to the NEXT main question or NEXT phase from the QUESTION BANK immediately."
                    : "[SYSTEM NOTIFICATION] Candidate already said they do not know and the same main question was repeated. " +
                      "Do NOT repeat that exact question again. Ask one concise scaffold follow-up OR move to the next main question/phase now.";
                state.history.push({ role: "user", content: notification });
            }
        }

        // Build system prompt with current context
        // Auto-advance fundamentals theory phases before building prompt
        advanceFundamentalsPhaseText(state);
        if (
            state.currentStage === "FUNDAMENTALS" &&
            getCurrentCSPhase(state) === "SQL" &&
            !state.sqlEditorOpened &&
            !state.sqlRoundCompleted
        ) {
            const sqlOpenCtx: ToolContext = {
                sessionId: state.sessionId,
                userId: state.userId,
                interviewType: state.interviewType,
                currentStage: state.currentStage,
                askedQuestionIds: state.askedQuestionIds,
                role: state.role,
                level: state.level,
                stageOrder: state.stageOrder,
                lastFetchedQuestionId: state.lastFetchedQuestionId,
                lastFetchedLanguage: state.lastFetchedLanguage,
                prefetchedDSAQuestion: state.prefetchedDSAQuestion,
                prefetchedBehavioralQuestions: state.prefetchedBehavioralQuestions,
                prefetchedCSQuestions: state.prefetchedCSQuestions,
                prefetchedSDQuestion: state.prefetchedSDQuestion,
                cachedQuestionData: state.cachedQuestionData,
                scratchpadOpened: state.scratchpadOpened,
                systemDesignExchangeCount: state.systemDesignExchangeCount,
                onSQLEditorOpened: () => startSQLPhaseTimers(state.sessionId, emit),
                onSQLPanelClosed: () => {
                    clearSQLTimers(state.sessionId);
                    state.sqlSnapshot = null;
                    state.sqlQuestionDescription = null;
                },
                onDSAEditorOpened: () => startDSAPhaseTimers(state.sessionId, emit),
                onDSAPanelClosed: () => clearDSATimers(state.sessionId),
                emit,
            };
            const sqlOpenResult = await handleToolCall("open_sql_editor", {}, sqlOpenCtx);
            if (sqlOpenResult.startsWith("SQL editor opened")) {
                state.sqlEditorOpened = true;
                state.currentFundamentalsPhase = "SQL";
                const sqlQuestion = [...state.cachedQuestionData.values()].find((q: any) => q?.category === "SQL") as any;
                if (sqlQuestion) {
                    state.currentQuestionTitle = sqlQuestion.title || state.currentQuestionTitle;
                    state.sqlQuestionDescription = `${sqlQuestion.title || ""}\n\n${sqlQuestion.description || sqlQuestion.problemDescription || ""}`;
                }
                state.history.push({
                    role: "user",
                    content:
                        "[SYSTEM NOTIFICATION] The SQL editor is already open with the preloaded SQL problem. " +
                        `${describeSqlQuestionForSpeech(sqlQuestion)} ` +
                        "Do not mention CS Fundamentals, phases, configuration, QUESTION BANK, or internal ordering.",
                });
            }
        }

        // Server-authoritative screening enforcement (no-op for practice interviews):
        // advances the pointer on the server clock, force-closes on budget, and
        // returns the command the directive must render this turn.
        const companyScreeningAuthoritative = await enforceCompanyScreeningTurn(state, userMessage, emit);

        const systemPrompt = buildSystemPrompt({
            interviewType: state.interviewType,
            moduleConfig: state.moduleConfig,
            role: state.role,
            level: state.level,
            stage: state.currentStage,
            stageOrder: state.stageOrder,
            resumeSummary: state.resumeSummary,
            currentQuestionTitle: state.currentQuestionTitle,
            codeSnapshot: state.codeSnapshot,
            codeLanguage: state.codeLanguage,
            sqlSnapshot: state.sqlSnapshot,
            sqlQuestionDescription: state.sqlQuestionDescription,
            sqlRoundCompleted: state.sqlRoundCompleted,
            rubricLite: state.rubricLite,
            canvasSnapshot: state.canvasSnapshot,
            notepadSnapshot: state.notepadSnapshot,
            prefetchedCSQuestions: state.prefetchedCSQuestions,
            prefetchedSDQuestion: state.prefetchedSDQuestion,
            prefetchedDSAQuestion: state.prefetchedDSAQuestion,
            askedQuestionIds: new Set(state.askedQuestionIds),
            currentFundamentalsPhase: state.currentFundamentalsPhase,
            resumeProbeState: state.resumeProbeState,
            resumeAgendaState: state.resumeAgendaState,
            prefetchedGenAIConceptQuestions: state.prefetchedGenAIConceptQuestions,
            prefetchedGenAICodingQuestion: state.prefetchedGenAICodingQuestion,
            prefetchedGenAISystemDesignQuestion: state.prefetchedGenAISystemDesignQuestion,
            prefetchedDSConceptQuestions: state.prefetchedDSConceptQuestions,
            prefetchedDSSQLQuestion: state.prefetchedDSSQLQuestion,
            prefetchedDSCodingQuestion: state.prefetchedDSCodingQuestion,
            prefetchedPMCaseQuestion: state.prefetchedPMCaseQuestion,
            prefetchedPMConceptQuestions: state.prefetchedPMConceptQuestions,
            prefetchedPMStrategyQuestion: state.prefetchedPMStrategyQuestion,
            prefetchedProblemSolvingCaseQuestion: state.prefetchedProblemSolvingCaseQuestion,
            runtimeDirective:
                buildCompanyScreeningRuntimeDirective(
                    state.companyScreening,
                    state.currentStage,
                    state.companyScreening
                        ? {
                            elapsedMinutes: Math.max(0, (Date.now() - new Date(state.startedAt || Date.now()).getTime()) / 60000),
                            totalMinutes: Number(state.companyScreening.blueprintSnapshot.durationMinutes) || 30,
                            answeredQuestionIds: state.companyScreeningAskedQuestionIds
                                ? Array.from(state.companyScreeningAskedQuestionIds)
                                : [],
                        }
                        : null,
                    companyScreeningAuthoritative,
                    state.companyScreeningCurrentPhaseType ?? null
                ) ||
                buildResumeStageRuntimeDirective(state),
        });

        // Build tool context
        const toolCtx: ToolContext = {
            sessionId: state.sessionId,
            userId: state.userId,
            interviewType: state.interviewType,
            currentStage: state.currentStage,
            askedQuestionIds: state.askedQuestionIds,
            role: state.role,
            level: state.level,
            stageOrder: state.stageOrder,
            moduleConfig: state.moduleConfig,
            resumeSummary: state.resumeSummary,
            stageStartedAtMs: state.stageStartedAtMs,
            lastFetchedQuestionId: state.lastFetchedQuestionId,
            lastFetchedLanguage: state.lastFetchedLanguage,
            prefetchedDSAQuestion: state.prefetchedDSAQuestion,
            prefetchedBehavioralQuestions: state.prefetchedBehavioralQuestions,
            cachedQuestionData: state.cachedQuestionData,
            scratchpadOpened: state.scratchpadOpened,
            systemDesignExchangeCount: state.systemDesignExchangeCount,
            introExchangeCount: state.introExchangeCount,
            prefetchedCSQuestions: state.prefetchedCSQuestions,
            prefetchedSDQuestion: state.prefetchedSDQuestion,
            resumeProbeState: state.resumeProbeState,
            resumeAgendaState: state.resumeAgendaState,
            onResumeProbeRecorded: (resumeProbeState) => {
                state.resumeProbeState = resumeProbeState;
                toolCtx.resumeProbeState = resumeProbeState;
            },
            onResumeAgendaRecorded: (resumeAgendaState) => {
                state.resumeAgendaState = resumeAgendaState;
                toolCtx.resumeAgendaState = resumeAgendaState;
            },
            prefetchedGenAIConceptQuestions: state.prefetchedGenAIConceptQuestions,
            prefetchedGenAICodingQuestion: state.prefetchedGenAICodingQuestion,
            prefetchedGenAISystemDesignQuestion: state.prefetchedGenAISystemDesignQuestion,
            // ↑ All three GenAI prefetch fields wired through to tool handlers
            // ── Data Science Role prefetch fields ──────────────────────────
            prefetchedDSConceptQuestions: state.prefetchedDSConceptQuestions,
            prefetchedDSSQLQuestion: state.prefetchedDSSQLQuestion,
            prefetchedDSCodingQuestion: state.prefetchedDSCodingQuestion,
            // ↑ All three DS prefetch fields wired through to tool handlers
            prefetchedPMCaseQuestion: state.prefetchedPMCaseQuestion,
            prefetchedPMConceptQuestions: state.prefetchedPMConceptQuestions,
            prefetchedPMStrategyQuestion: state.prefetchedPMStrategyQuestion,
            prefetchedProblemSolvingCaseQuestion: state.prefetchedProblemSolvingCaseQuestion,
            onSQLEditorOpened: () => startSQLPhaseTimers(state.sessionId, emit),
            onSQLPanelClosed: () => {
                clearSQLTimers(state.sessionId);
                // Clear the snapshot so it doesn't bleed into OS/CN/OOP turns that
                // also run inside the FUNDAMENTALS stage.
                state.sqlSnapshot = null;
                state.sqlQuestionDescription = null;
            },
            onDSAEditorOpened: () => startDSAPhaseTimers(state.sessionId, emit),
            onDSAPanelClosed: () => clearDSATimers(state.sessionId),
            onProblemSolvingNotepadOpened: () => {
                state.problemSolvingNotepadOpened = true;
            },
            companyScreeningCurrentPhaseType: state.companyScreeningCurrentPhaseType ?? null,
            emit,
        };

        // Get tools filtered for current interview type + stage. Company screening builds its tool
        // list PHASE-based via its own module (each phase exposes only its own workspace tool),
        // decoupled from the practice stage machine; the practice path is untouched.
        const tools = state.companyScreening
            ? buildScreeningTools(
                state.companyScreeningCurrentPhaseType ?? null,
                state.currentStage === "CLOSING"
            )
            : getToolsForSession(
                state.interviewType,
                state.currentStage,
                state.stageOrder
            );
        const allowedToolNameSet = new Set<string>();
        for (const tool of tools) {
            if (tool.type === "function") {
                allowedToolNameSet.add(tool.function.name);
            }
        }

        // Build messages array: system + trimmed history
        const recentHistory = state.history.slice(-MAX_CONTEXT_MESSAGES * 2);
        const messages: ChatCompletionMessageParam[] = [
            { role: "system", content: systemPrompt },
            ...recentHistory,
        ];

        const messageId = `msg_${Date.now()}_${++messageCounter}`;
        let fullContent = "";
        let closePanelCalledThisTurn = false;
        const suppressSystemDesignIntroStreaming =
            (state.interviewType === "system_design" || state.interviewType === "behavioural") &&
            state.currentStage === "INTRO";
        // Company screening BUFFERS the turn instead of streaming it token-by-token, so the
        // output leak-scan can redact confidential reference material from the FULL text
        // before anything reaches the candidate (a post-hoc redaction can't un-stream a
        // token the candidate already saw). See the redaction block after the model loop.
        const suppressScreeningStreaming = !!state.companyScreening;
        const sqlContextExistedAtTurnStart = !!(
            state.sqlEditorOpened ||
            state.sqlSnapshot ||
            state.sqlQuestionDescription
        );

        emit("ai:token", { token: "", messageId }); // signal start

        let stepsRemaining = 5;
        let needsFreshSDTurn = false;        // triggers a new processAgentTurn for SYSTEM_DESIGN opening
        let endCurrentLoopAfterTools = false; // breaks the while-loop cleanly after the tool batch
        let needsGenAIResponsibilityIntro = false;
        let needsServerDsaIntro = false;
        // PM_CONCEPTS / PM_STRATEGY: unlike every other DB-backed transition (which
        // presents the next stage's first question server-side), these two previously
        // injected their bank into the CURRENT turn and let the loop continue — so the
        // model spoke its transition under the STALE PM_CASE/PM_CONCEPTS prompt (no
        // concept bank, no anti-fabrication rule), bundling several questions into one
        // message and inventing off-bank questions. Instead we now break the loop and
        // fire ONE fresh turn: the new-stage prompt (bank + anti-fabrication) is rebuilt
        // cleanly and the model asks exactly one on-bank question, recorded by the
        // existing post-turn drift corrector.
        let needsFreshTransitionTurn = false;
        let freshTransitionBridge = "";
        let freshTransitionBridgeStage: string | null = null;
        let resumeAgendaItemIdForAssistantQuestion: string | undefined;
        // Whether the model recorded a resume probe this turn; drives the server-side
        // fallback that advances the resume agenda when the model skips the call.
        let resumeProbeRecordedThisTurn = false;

        // ── One-time resume web context injection (Responses API pre-flight) ──────────
        // Mirrors the same [SYSTEM NOTIFICATION] pattern used by PM_CASE, SD, DS_SQL.
        // Fires only on the very first turn of INTRO for resume-heavy interview types.
        if (shouldEnableResumeWebSearch(state)) {
            state.resumeWebSearchUsed = true; // mark immediately — prevent double-fire
            const webCtx = await prefetchResumeWebContext({
                sessionId: state.sessionId,
                resumeSummary: state.resumeSummary,
                interviewType: state.interviewType,
                role: state.role,
                level: state.level,
                logPrefix: "Orchestrator",
            });
            if (webCtx) {
                const notification = buildResumeWebContextNotification(webCtx);
                state.history.push({ role: "user", content: notification });
                messages.push({ role: "user", content: notification });
            }
        }

        while (stepsRemaining-- > 0) {
            const resumeAgendaItemIdBeforeModelStep =
                state.interviewType === "resume_round"
                    ? getActiveResumeAgendaItem(state.resumeAgendaState)?.id
                    : undefined;
            const stream = await (getXAIClient().chat.completions.create({
                model: XAI_MODEL,
                messages,
                tools,
                stream: true,
            } as any) as any);

            // Accumulate tool calls by index (streamed incrementally)
            const toolCalls: Array<{ id: string; name: string; arguments: string }> = [];
            let textAccumulated = "";

            for await (const chunk of stream) {
                const delta = chunk.choices[0]?.delta;
                if (!delta) continue;

                if (delta.content) {
                    textAccumulated += delta.content;
                    fullContent += delta.content;
                    const token = sanitizeSpokenInterviewText(delta.content, { trim: false });
                    if (token && !suppressSystemDesignIntroStreaming && !suppressScreeningStreaming) {
                        emit("ai:token", { token, messageId });
                    }
                }

                if (delta.tool_calls) {
                    for (const tc of delta.tool_calls) {
                        const idx = tc.index;
                        if (!toolCalls[idx]) {
                            toolCalls[idx] = { id: "", name: "", arguments: "" };
                        }
                        if (tc.id) toolCalls[idx].id = tc.id;
                        if (tc.function?.name) toolCalls[idx].name = tc.function.name;
                        if (tc.function?.arguments) toolCalls[idx].arguments += tc.function.arguments;
                    }
                }
            }

            // Filter out any empty slots
            const completedToolCalls = toolCalls.filter(tc => tc.id && tc.name);
            if (textAccumulated.trim()) {
                resumeAgendaItemIdForAssistantQuestion = resumeAgendaItemIdBeforeModelStep;
            }
            const sanitizedToolCalls = splitToolCallsByAvailability(completedToolCalls, allowedToolNameSet);

            if (sanitizedToolCalls.rejectedToolCalls.length > 0) {
                console.warn(
                    `[Orchestrator] Ignoring unavailable tool calls for ${sessionId} in ${state.currentStage}: ` +
                    `${sanitizedToolCalls.rejectedToolNames.join(", ")}`
                );

                messages.push({
                    role: "user",
                    content: buildUnavailableToolNotice(
                        sanitizedToolCalls.rejectedToolNames,
                        sanitizedToolCalls.allowedToolNames
                    ),
                });
            }

            // If no tool calls, we're done
            if (sanitizedToolCalls.allowedToolCalls.length === 0) {
                if (sanitizedToolCalls.rejectedToolCalls.length > 0) {
                    continue;
                }
                break;
            }

            // Add assistant message with tool calls to messages
            messages.push({
                role: "assistant",
                content: textAccumulated || null,
                tool_calls: sanitizedToolCalls.allowedToolCalls.map(tc => ({
                    id: tc.id,
                    type: "function" as const,
                    function: { name: tc.name, arguments: tc.arguments },
                })),
            });

            const actionPlan = buildServerActionPlan(sanitizedToolCalls.allowedToolCalls);

            for (const deferredResponse of actionPlan.deferredToolResponses) {
                messages.push({
                    role: "tool",
                    tool_call_id: deferredResponse.toolCallId,
                    content: deferredResponse.content,
                });
            }

            // Execute passthrough tool calls and add tool response messages
            let endInterviewCalled = false;
            const hasExplicitScratchpadOpen = actionPlan.passthroughToolCalls.some(
                (toolCall) => toolCall.name === "open_scratchpad"
            );
            const hasExplicitSQLOpen = actionPlan.passthroughToolCalls.some(
                (toolCall) => toolCall.name === "open_sql_editor"
            );
            for (const tc of actionPlan.passthroughToolCalls) {
                let toolArgs: Record<string, any> = {};
                try {
                    toolArgs = JSON.parse(tc.arguments || "{}");
                } catch {
                    const parseError = `Invalid JSON arguments for tool ${tc.name}.`;
                    messages.push({
                        role: "tool",
                        tool_call_id: tc.id,
                        content: parseError,
                    });
                    continue;
                }

                const resultStr = await handleToolCall(
                    tc.name as any,
                    toolArgs,
                    toolCtx
                );

                // The model recorded a resume probe itself this turn — suppress the
                // server-side fallback so the agenda isn't advanced twice.
                if (tc.name === "record_resume_probe") {
                    resumeProbeRecordedThisTurn = true;
                }

                if (tc.name === "fetch_question") {
                    try {
                        const parsed = JSON.parse(resultStr);
                        if (parsed.questionId) {
                            state.lastFetchedQuestionId = parsed.questionId;
                            toolCtx.lastFetchedQuestionId = parsed.questionId;
                        }
                        // Track SQL question description so the system prompt always shows it
                        if (parsed.category === "SQL" && parsed.problemDescription) {
                            state.sqlQuestionDescription = `${parsed.title || ""}\n\n${parsed.problemDescription}`;
                        }

                        // System Design fallback: if the model fetched a question but did not
                        // call open_scratchpad in this same tool batch, open it immediately.
                        if (
                            state.currentStage === "SYSTEM_DESIGN" &&
                            !state.scratchpadOpened &&
                            !hasExplicitScratchpadOpen &&
                            !!parsed.questionId
                        ) {
                            emit("panel:open", buildSystemDesignPanelPayload(state));
                            state.scratchpadOpened = true;
                            toolCtx.scratchpadOpened = true;
                            console.log(
                                `[Orchestrator] Auto-opened scratchpad after SystemDesign fetch_question for ${sessionId}`
                            );
                        }

                        // CS Fundamentals SQL fallback: if the model fetched a SQL question but did not
                        // call open_sql_editor in this same tool batch, open it immediately.
                        if (
                            state.currentStage === "FUNDAMENTALS" &&
                            parsed.category === "SQL" &&
                            !state.sqlEditorOpened &&
                            !hasExplicitSQLOpen &&
                            !!parsed.questionId
                        ) {
                            const sqlQuestion = state.cachedQuestionData.get(parsed.questionId);
                            if (sqlQuestion) {
                                emit("panel:open", {
                                    type: "sql",
                                    stage: state.currentStage,
                                    sqlQuestion,
                                });
                                state.sqlEditorOpened = true;
                                state.currentFundamentalsPhase = 'SQL';
                                toolCtx.onSQLEditorOpened?.();
                                console.log(
                                    `[Orchestrator] Auto-opened SQL editor after fetch_question(SQL) for ${sessionId}`
                                );
                            }
                        }
                    } catch {
                        // ignore malformed tool payload
                    }
                }

                if (tc.name === "open_ide") {
                    const lang = toolArgs?.language || toolCtx.lastFetchedLanguage;
                    if (lang) {
                        state.lastFetchedLanguage = lang;
                        toolCtx.lastFetchedLanguage = lang;
                    }
                    if (toolArgs?.questionId) {
                        state.lastFetchedQuestionId = toolArgs.questionId;
                        toolCtx.lastFetchedQuestionId = toolArgs.questionId;
                    }
                }

                // Track scratchpad open
                if (tc.name === "open_scratchpad") {
                    state.scratchpadOpened = true;
                    toolCtx.scratchpadOpened = true;
                    console.log(`[Orchestrator] Scratchpad opened for ${sessionId}`);
                }

                // Track SQL editor open
                if (tc.name === "open_sql_editor") {
                    state.sqlEditorOpened = true;
                    state.currentFundamentalsPhase = 'SQL';
                    console.log(`[Orchestrator] SQL editor opened for ${sessionId}`);
                }

                // Track SQL panel close — reset flag so auto-open guard won't re-trigger
                if (tc.name === "close_panel") {
                    closePanelCalledThisTurn = true;
                }
                if (tc.name === "close_panel" && state.sqlEditorOpened) {
                    state.sqlEditorOpened = false;
                    console.log(`[Orchestrator] SQL editor closed for ${sessionId}`);
                }

                messages.push({
                    role: "tool",
                    tool_call_id: tc.id,
                    content: resultStr,
                });
            }

            // Execute control suggestions in the application layer.
            // The model can request transition/end actions, but the server owns execution.
            for (const suggestion of actionPlan.controlSuggestions) {
                let controlResult = "";

                if (suggestion.kind === "invalid") {
                    controlResult = suggestion.message;
                } else if (suggestion.kind === "transition_stage") {
                    const previousStageBeforeTransition = state.currentStage;
                    controlResult = await handleToolCall(
                        "transition_stage",
                        suggestion.args,
                        toolCtx
                    );

                    const transitionSucceeded = controlResult.startsWith("Interview transitioned");
                    if (transitionSucceeded) {
                        // ── CRITICAL: sync state.currentStage from toolCtx ──────────────
                        // handleTransitionStage updates toolCtx.currentStage but NOT state.
                        // Without this sync, buildSystemPrompt on the NEXT turn still reads
                        // the old stage — which means the GEN_AI_CONCEPTS question bank
                        // (and any other stage-gated context) never reaches the LLM.
                        state.currentStage = toolCtx.currentStage as any;
                        // ────────────────────────────────────────────────────────────────

                        state.systemDesignExchangeCount = 0;
                        clearSQLTimers(state.sessionId);
                        clearDSATimers(state.sessionId);
                        if (previousStageBeforeTransition === "FUNDAMENTALS") {
                            state.sqlEditorOpened = false;
                            state.sqlSnapshot = null;
                            state.sqlQuestionDescription = null;
                            state.sqlRoundCompleted = true;
                            state.currentFundamentalsPhase = getNextCSPhase(state, "SQL") || "CLOSING";
                        }
                        if (toolCtx.currentStage === "DSA") {
                            startDSAPhaseTimers(state.sessionId, emit);
                        }
                        if (
                            state.interviewType === "full_interview" &&
                            previousStageBeforeTransition === "INTRO" &&
                            suggestion.args.nextStage === "DSA" &&
                            state.prefetchedDSAQuestion
                        ) {
                            state.currentQuestionTitle = state.prefetchedDSAQuestion.title;
                            state.lastFetchedQuestionId = state.prefetchedDSAQuestion.id;
                            state.history.push({
                                role: "user",
                                content:
                                    "[SYSTEM NOTIFICATION] DSA is active. Resume/background questioning is over. " +
                                    "Continue only with the pinned coding problem.",
                            });
                            needsServerDsaIntro = true;
                            endCurrentLoopAfterTools = true;
                        }

                        // ── ARCHITECTURAL FIX: System Design two-turn pattern ──────────
                        // Core insight: The AI generates its INTRO closing speech and
                        // the transition_stage tool call in ONE streaming response.
                        // That speech is already streamed before we can intercept it,
                        // so instruction tweaks, system-prompt rebuilds, and tool-result
                        // injections all fail — too late.
                        //
                        // FIX: When transition_stage → SYSTEM_DESIGN fires:
                        //   1. Auto-open the scratchpad with the DB question (server-side)
                        //   2. BREAK the while-loop — no further AI text this turn
                        //   3. Schedule a FRESH processAgentTurn in the finally block
                        // The fresh turn builds a clean SYSTEM_DESIGN system prompt from
                        // scratch with the DB question injected. The AI generates its
                        // design-stage opening against ONLY the correct context.
                        if (suggestion.args.nextStage === "SYSTEM_DESIGN" && state.prefetchedSDQuestion) {
                            if (!state.scratchpadOpened) {
                                emit("panel:open", buildSystemDesignPanelPayload(state));
                                state.scratchpadOpened = true;
                                toolCtx.scratchpadOpened = true;
                                console.log(`[Orchestrator] Auto-opened scratchpad: "${state.prefetchedSDQuestion.title}"`);
                            }
                            needsFreshSDTurn = true;
                            endCurrentLoopAfterTools = true;
                        }

                        // ── DS_SQL: server-owned SQL editor open + fresh turn ────────────
                        // Same pattern as SYSTEM_DESIGN: the LLM's transition speech is
                        // already streamed. Break the loop and fire a fresh turn so the
                        // LLM opens the SQL editor with the DB question, not a verbal one.
                        if (suggestion.args.nextStage === "DS_SQL" && state.prefetchedDSSQLQuestion) {
                            // SQL editor is already opened by transition_stage handler above.
                            // Inject a SYSTEM NOTIFICATION so the LLM knows to present the DB question.
                            const sqlTask = state.prefetchedDSSQLQuestion;
                            state.sqlEditorOpened = true;
                            state.currentQuestionTitle = sqlTask.title;
                            state.sqlQuestionDescription = `${sqlTask.title || ""}\n\n${sqlTask.description || ""}`;
                            state.history.push({
                                role: "user",
                                content:
                                    `[SYSTEM NOTIFICATION] Stage is now DS_SQL. ` +
                                    `The SQL editor has been opened with the DB question: "${sqlTask.title}". ` +
                                    "Present this problem conversationally. Do NOT invent a different SQL question. " +
                                    "The schema is already loaded in the editor.",
                            });
                            console.log(`[Orchestrator] DS_SQL transition: SQL editor opened with "${sqlTask.title}" for ${sessionId}`);
                        }

                        // ── DS_CODING: server-owned IDE open + notification ───────────────
                        if (suggestion.args.nextStage === "DS_CODING" && state.prefetchedDSCodingQuestion) {
                            const dsTask = state.prefetchedDSCodingQuestion;
                            state.lastFetchedQuestionId = dsTask.questionId;
                            state.lastFetchedLanguage = "python";
                            state.currentQuestionTitle = dsTask.title;
                            state.history.push({
                                role: "user",
                                content:
                                    `[SYSTEM NOTIFICATION] Stage is now DS_CODING. ` +
                                    `The coding IDE has been opened with the DB task: "${dsTask.title}". ` +
                                    "Present this task conversationally. Do NOT invent a different coding task. " +
                                    "Tell the candidate to assign their final answer to a variable called `result`.",
                            });
                            console.log(`[Orchestrator] DS_CODING transition: IDE opened with "${dsTask.title}" for ${sessionId}`);
                        }

                        // GenAI coding -> responsibility: close IDE and stop this streamed turn.
                        // The model may have already started saying internal transition text,
                        // so the finalization block replaces it with a candidate-facing bridge
                        // and emits the first responsibility prompt server-side.
                        if (
                            state.interviewType === "gen_ai_role" &&
                            previousStageBeforeTransition === "GEN_AI_CODING" &&
                            suggestion.args.nextStage === "CLOSING"
                        ) {
                            emit("panel:close", { summary: "Coding round complete." });
                            state.lastFetchedQuestionId = null;
                            state.currentQuestionTitle = null;
                            state.history.push({
                                role: "user",
                                content:
                                    "[SYSTEM NOTIFICATION] The coding IDE has been closed. " +
                                    "The interview is now in the AI responsibility discussion. " +
                                    "Do not mention stage names, tools, panel closing, or transition mechanics. " +
                                    "Ask the candidate a natural AI responsibility scenario question now.",
                            });
                            needsGenAIResponsibilityIntro = true;
                            endCurrentLoopAfterTools = true;
                            console.log(`[Orchestrator] GenAI coding transition: IDE closed, responsibility intro scheduled for ${sessionId}`);
                        }

                        // ── PM_CASE: server-owned notepad open + fresh turn ──────────────
                        // Same pattern as SYSTEM_DESIGN: the LLM's INTRO closing speech is
                        // already streamed when transition fires. Break the loop and fire a
                        // fresh turn so the LLM presents the DB case scenario — not silence.
                        if (suggestion.args.nextStage === "PM_CASE" && state.prefetchedPMCaseQuestion) {
                            const caseQ = state.prefetchedPMCaseQuestion;
                            // Notepad is already opened by transition_stage handler.
                            state.scratchpadOpened = true;
                            toolCtx.scratchpadOpened = true;
                            state.currentQuestionTitle = caseQ.title;
                            state.history.push({
                                role: "user",
                                content:
                                    `[SYSTEM NOTIFICATION] Stage is now PM_CASE. ` +
                                    `The CIRCLES notepad has been opened. ` +
                                    `You MUST now present the following case scenario verbatim: "${caseQ.scenario}" ` +
                                    `Then ask the candidate to use the notepad to jot down their thoughts and frame the answer using CIRCLES. ` +
                                    "Do NOT invent a different product case. Do NOT go silent.",
                            });
                            needsFreshSDTurn = true;
                            endCurrentLoopAfterTools = true;
                            console.log(`[Orchestrator] PM_CASE transition: notepad opened, fresh turn scheduled for "${caseQ.title}" (${sessionId})`);
                        }

                        // ── PM_CONCEPTS: break loop, fire a fresh clean turn ─────────────
                        // Do NOT continue this turn to ask the first question: the model
                        // is still holding the stale PM_CASE prompt (case scenario +
                        // "engineering capacity" constraint, no concept bank, no
                        // anti-fabrication rule). Continuing here is exactly what bundled
                        // the case wrap-up + constraint + concepts intro + an invented
                        // ("notification system") question into one message. Break and let
                        // a fresh PM_CONCEPTS turn ask ONE on-bank question cleanly.
                        if (suggestion.args.nextStage === "PM_CONCEPTS" && state.prefetchedPMConceptQuestions?.length) {
                            state.history.push({
                                role: "user",
                                content:
                                    "[SYSTEM NOTIFICATION] Stage is now PM_CONCEPTS. Ask ONLY questions from the " +
                                    "PM concept bank in your instructions — one at a time. Do NOT invent PM concept " +
                                    "questions. Do NOT restate the previous case or its constraint. Ask the FIRST " +
                                    "bank question now and call record_question silently.",
                            });
                            needsFreshTransitionTurn = true;
                            freshTransitionBridge = "Great — let's move on to some product concept questions.";
                            freshTransitionBridgeStage = previousStageBeforeTransition;
                            endCurrentLoopAfterTools = true;
                            console.log(`[Orchestrator] PM_CONCEPTS transition: fresh clean turn scheduled for ${sessionId}`);
                        }

                        // ── PM_STRATEGY: break loop, fire a fresh clean turn ─────────────
                        // Same rationale as PM_CONCEPTS — present the pre-loaded strategy
                        // scenario under the clean PM_STRATEGY prompt, not bundled onto the
                        // tail of the concepts stage.
                        if (suggestion.args.nextStage === "PM_STRATEGY" && state.prefetchedPMStrategyQuestion) {
                            state.history.push({
                                role: "user",
                                content:
                                    "[SYSTEM NOTIFICATION] Stage is now PM_STRATEGY. Present ONLY the pre-loaded " +
                                    "strategy scenario from your instructions. Do NOT invent a strategy scenario and " +
                                    "do NOT restate previous concept questions. Present the scenario now.",
                            });
                            needsFreshTransitionTurn = true;
                            freshTransitionBridge = "Let's shift to product strategy.";
                            freshTransitionBridgeStage = previousStageBeforeTransition;
                            endCurrentLoopAfterTools = true;
                            console.log(`[Orchestrator] PM_STRATEGY transition: fresh clean turn scheduled for ${sessionId}`);
                        }
                    }
                } else {
                    controlResult = await handleToolCall(
                        "end_interview",
                        suggestion.args,
                        toolCtx
                    );
                    if (controlResult.startsWith("Interview ended.")) {
                        clearDSATimers(state.sessionId);
                        clearSQLTimers(state.sessionId);
                        endInterviewCalled = true;
                    }
                }

                messages.push({
                    role: "tool",
                    tool_call_id: suggestion.toolCallId,
                    content: controlResult,
                });

                if (endInterviewCalled) {
                    break;
                }
            }

            // Hard stop the agent loop after end_interview so it cannot ask more questions.
            if (endInterviewCalled) {
                break;
            }

            // Break after a SYSTEM_DESIGN transition — fresh turn fires from finally block.
            if (endCurrentLoopAfterTools) {
                break;
            }
        }

        // Drift correction: if assistant starts coding content while still in INTRO,
        // force transition to DSA and open IDE deterministically. We match on two
        // independent signals: (a) coding-round language (regex) and (b) the
        // pre-fetched DSA question text appearing in the assistant's response.
        // Mirrors the SQL snippet-match pattern further down.
        if (
            state.interviewType === "full_interview" &&
            state.currentStage === "INTRO"
        ) {
            const nextAfterIntroForDrift = getNextEnabledStage(state.stageOrder, "INTRO");
            const fullContentLowerForDsa = fullContent.toLowerCase();
            const dsaQuestion = state.prefetchedDSAQuestion as { title?: string; problemMd?: string } | null;
            const dsaTitleSnippet = (dsaQuestion?.title || "").slice(0, 70).toLowerCase().trim();
            const dsaProblemSnippet = (dsaQuestion?.problemMd || "").slice(0, 120).toLowerCase().trim();
            const dsaSnippetMatch =
                (dsaTitleSnippet.length > 12 && fullContentLowerForDsa.includes(dsaTitleSnippet)) ||
                (dsaProblemSnippet.length > 20 && fullContentLowerForDsa.includes(dsaProblemSnippet));

            if (nextAfterIntroForDrift === "DSA" && (isLikelyCodingRoundPrompt(fullContent) || dsaSnippetMatch)) {
                console.warn(`[Orchestrator] Detected coding-round prompt while still in INTRO for ${sessionId} (regex=${isLikelyCodingRoundPrompt(fullContent)}, snippet=${dsaSnippetMatch}); forcing INTRO -> DSA transition.`);
                const driftTransitionResult = await handleToolCall(
                    "transition_stage",
                    {
                        nextStage: "DSA",
                        reason: "Assistant content indicates coding round started while still in INTRO.",
                    },
                    toolCtx
                );

                if (driftTransitionResult.startsWith("Interview transitioned")) {
                    state.history.push({
                        role: "user",
                        content:
                            "[SYSTEM NOTIFICATION] Stage corrected to DSA because coding-round language was detected. " +
                            "IDE has been opened automatically. Continue with the pre-assigned coding problem only.",
                    });
                }
            }
        }

        // Drift correction: if assistant says it is moving to fundamentals
        // while still in DSA, force transition and continue immediately.
        if (
            state.interviewType === "full_interview" &&
            state.currentStage === "DSA" &&
            isLikelyFundamentalsHandoffPrompt(fullContent)
        ) {
            const nextAfterDSAForDrift = getNextEnabledStage(state.stageOrder, "DSA");
            if (nextAfterDSAForDrift) {
                console.warn(`[Orchestrator] Detected fundamentals handoff language while still in DSA for ${sessionId}; forcing DSA -> ${nextAfterDSAForDrift} transition.`);
                const driftTransitionResult = await handleToolCall(
                    "transition_stage",
                    {
                        nextStage: nextAfterDSAForDrift,
                        reason: "Assistant content indicates fundamentals handoff while still in DSA.",
                    },
                    toolCtx
                );

                if (driftTransitionResult.startsWith("Interview transitioned")) {
                    state.currentStage = nextAfterDSAForDrift;
                    clearDSATimers(sessionId);

                    state.history.push({
                        role: "user",
                        content:
                            `[SYSTEM NOTIFICATION] Stage corrected to ${nextAfterDSAForDrift} because handoff language was detected. ` +
                            "DSA panel has been closed automatically. Continue immediately with the current stage instructions. " +
                            "Do NOT return to DSA.",
                    });

                    setTimeout(() => {
                        processAgentTurn(sessionId, null, emit).catch((err) => {
                            console.error(`[Orchestrator] Post-DSA-to-next-stage drift kickoff error for ${sessionId}:`, err);
                        });
                    }, 0);
                }
            }
        }

        // Drift correction: if assistant starts SQL-round content in FUNDAMENTALS
        // while SQL editor is still closed, force-open SQL editor deterministically.
        if (
            state.currentStage === "FUNDAMENTALS" &&
            !state.sqlEditorOpened &&
            !state.sqlRoundCompleted
        ) {
            const fullContentLower = fullContent.toLowerCase();
            const sqlQuestion = [...state.cachedQuestionData.values()].find((q) => q?.category === "SQL") as any;
            const sqlTitleSnippet = (sqlQuestion?.title || "").slice(0, 70).toLowerCase().trim();
            const sqlProblemSnippet = (sqlQuestion?.problemDescription || "").slice(0, 120).toLowerCase().trim();
            const sqlSnippetMatch =
                (sqlTitleSnippet.length > 12 && fullContentLower.includes(sqlTitleSnippet)) ||
                (sqlProblemSnippet.length > 20 && fullContentLower.includes(sqlProblemSnippet));

            if (isLikelySqlRoundPrompt(fullContent) || sqlSnippetMatch) {
                console.warn(`[Orchestrator] Detected SQL-round prompt with closed SQL editor for ${sessionId}; forcing SQL editor open.`);
                const sqlOpenResult = await handleToolCall("open_sql_editor", {}, toolCtx);
                if (sqlOpenResult.startsWith("SQL editor opened")) {
                    state.sqlEditorOpened = true;
                    state.currentFundamentalsPhase = 'SQL';
                    if (sqlQuestion?.problemDescription) {
                        state.sqlQuestionDescription = `${sqlQuestion.title || ""}\n\n${sqlQuestion.problemDescription}`;
                    }
                    state.history.push({
                        role: "user",
                        content:
                            "[SYSTEM NOTIFICATION] SQL round was detected while SQL editor was closed. " +
                            "SQL editor has now been opened automatically. Continue SQL round with this panel.",
                    });
                }
            }
        }

        // Drift correction: if assistant starts system-design content while the
        // scratchpad is still closed in SYSTEM_DESIGN stage, force-open the
        // scratchpad deterministically. Mirrors the SQL snippet-match pattern.
        if (
            state.currentStage === "SYSTEM_DESIGN" &&
            !state.scratchpadOpened
        ) {
            const fullContentLowerForSd = fullContent.toLowerCase();
            const sdQuestion = state.prefetchedSDQuestion as { id?: string; title?: string; problemStatement?: string } | null;
            const sdTitleSnippet = (sdQuestion?.title || "").slice(0, 70).toLowerCase().trim();
            const sdProblemSnippet = (sdQuestion?.problemStatement || "").slice(0, 120).toLowerCase().trim();
            const sdSnippetMatch =
                (sdTitleSnippet.length > 12 && fullContentLowerForSd.includes(sdTitleSnippet)) ||
                (sdProblemSnippet.length > 20 && fullContentLowerForSd.includes(sdProblemSnippet));

            if (isLikelySystemDesignPrompt(fullContent) || sdSnippetMatch) {
                console.warn(`[Orchestrator] Detected system-design prompt with closed scratchpad for ${sessionId} (regex=${isLikelySystemDesignPrompt(fullContent)}, snippet=${sdSnippetMatch}); forcing scratchpad open.`);
                emit("panel:open", buildSystemDesignPanelPayload(state));
                state.scratchpadOpened = true;
                toolCtx.scratchpadOpened = true;
                state.history.push({
                    role: "user",
                    content:
                        "[SYSTEM NOTIFICATION] Scratchpad/whiteboard was auto-opened because system-design content was detected with the panel closed. " +
                        "Do NOT call open_scratchpad — it is already open. Continue probing the candidate on their design.",
                });
            }
        }

        // Drift correction: if system_design interview is still in INTRO but
        // assistant started talking about the design problem, force-transition
        // to SYSTEM_DESIGN. The transition flow already auto-opens the scratchpad.
        if (
            state.interviewType === "system_design" &&
            state.currentStage === "INTRO" &&
            state.introExchangeCount >= SYSTEM_DESIGN_INTRO_FORCE_TRANSITION_THRESHOLD
        ) {
            const fullContentLowerForSdIntro = fullContent.toLowerCase();
            const sdQuestion = state.prefetchedSDQuestion as { title?: string; problemStatement?: string } | null;
            const sdIntroTitleSnippet = (sdQuestion?.title || "").slice(0, 70).toLowerCase().trim();
            const sdIntroProblemSnippet = (sdQuestion?.problemStatement || "").slice(0, 120).toLowerCase().trim();
            const sdIntroSnippetMatch =
                (sdIntroTitleSnippet.length > 12 && fullContentLowerForSdIntro.includes(sdIntroTitleSnippet)) ||
                (sdIntroProblemSnippet.length > 20 && fullContentLowerForSdIntro.includes(sdIntroProblemSnippet));

            if (isLikelySystemDesignPrompt(fullContent) || sdIntroSnippetMatch) {
                console.warn(`[Orchestrator] Detected system-design content while still in INTRO for ${sessionId} (regex=${isLikelySystemDesignPrompt(fullContent)}, snippet=${sdIntroSnippetMatch}); forcing INTRO -> SYSTEM_DESIGN transition.`);
                const sdDriftResult = await handleToolCall(
                    "transition_stage",
                    {
                        nextStage: "SYSTEM_DESIGN",
                        reason: "Assistant content indicates system-design round started while still in INTRO.",
                    },
                    toolCtx
                );

                if (sdDriftResult.startsWith("Interview transitioned")) {
                    state.currentStage = "SYSTEM_DESIGN";
                    // Auto-open scratchpad if the transition did not already do so.
                    if (!state.scratchpadOpened && state.prefetchedSDQuestion) {
                        emit("panel:open", buildSystemDesignPanelPayload(state));
                        state.scratchpadOpened = true;
                        toolCtx.scratchpadOpened = true;
                    }
                    state.history.push({
                        role: "user",
                        content:
                            "[SYSTEM NOTIFICATION] Stage corrected to SYSTEM_DESIGN because system-design language was detected. " +
                            "Scratchpad has been opened automatically. Continue with the pre-assigned design problem only.",
                    });
                }
            }
        }

        // Data Science role: server-owned DB question and editor handoffs.
        // If the model verbally moves phases without calling tools, replace that
        // turn with the DB-backed server action before the generated text is
        // committed to history. This keeps DS aligned with the GenAI reliability path.
        if (
            state.interviewType === "data_science_role" &&
            state.prefetchedDSConceptQuestions?.length &&
            fullContent.trim()
        ) {
            const askNextDSConceptQuestion = async (stageBeforeMessage: InterviewStage) => {
                const nextQuestion =
                    state.prefetchedDSConceptQuestions?.find((q) => !state.askedQuestionIds.includes(q.questionId)) ??
                    state.prefetchedDSConceptQuestions?.[0];
                if (!nextQuestion) return false;

                toolCtx.currentStage = "DS_CONCEPTS";
                state.currentStage = "DS_CONCEPTS";

                if (!state.askedQuestionIds.includes(nextQuestion.questionId)) {
                    await handleToolCall(
                        "record_question",
                        {
                            questionFundamentalId: nextQuestion.questionId,
                            questionTitle: nextQuestion.question,
                            referenceAnswer: nextQuestion.referenceAnswer,
                        },
                        toolCtx
                    );
                }

                const serverContent =
                    stageBeforeMessage === "INTRO"
                        ? `Let's move to some statistics and machine learning fundamentals. ${nextQuestion.question}`
                        : nextQuestion.question;

                emit("ai:done", { messageId, fullContent: serverContent });
                state.history.push({ role: "assistant", content: serverContent });
                await prisma.sessionMessage.create({
                    data: { sessionId, role: "assistant", content: serverContent, stage: "DS_CONCEPTS" },
                });
                return true;
            };

            const assistantUsedDBConceptQuestion = state.prefetchedDSConceptQuestions.some((q) => {
                const snippet = (q.question || "").slice(0, 50).toLowerCase().trim();
                return snippet.length > 20 && fullContent.toLowerCase().includes(snippet);
            });

            if (
                state.currentStage === "INTRO" &&
                (hasDSConceptHandoffLanguage(fullContent) || isLikelyDSConceptQuestion(fullContent))
            ) {
                const transitionResult = await handleToolCall(
                    "transition_stage",
                    { nextStage: "DS_CONCEPTS", reason: "Assistant moved to DS fundamentals without calling transition_stage." },
                    toolCtx
                );
                if (transitionResult.startsWith("Interview transitioned")) {
                    state.currentStage = "DS_CONCEPTS";
                    toolCtx.currentStage = "DS_CONCEPTS";
                    if (await askNextDSConceptQuestion("INTRO")) return;
                }
            }

            if (
                state.currentStage === "DS_CONCEPTS" &&
                state.prefetchedDSSQLQuestion &&
                hasDSSQLHandoffLanguage(fullContent) &&
                state.prefetchedDSConceptQuestions.filter((q) => state.askedQuestionIds.includes(q.questionId)).length >= 4
            ) {
                const transitionResult = await handleToolCall(
                    "transition_stage",
                    { nextStage: "DS_SQL", reason: "Assistant moved to SQL without calling transition_stage." },
                    toolCtx
                );
                if (transitionResult.startsWith("Interview transitioned")) {
                    state.currentStage = "DS_SQL";
                    toolCtx.currentStage = "DS_SQL";
                    state.sqlEditorOpened = true;
                    const sqlTask = state.prefetchedDSSQLQuestion;
                    state.currentQuestionTitle = sqlTask.title;
                    state.sqlQuestionDescription = `${sqlTask.title || ""}\n\n${sqlTask.description || ""}`;
                    const serverContent = `Good, let's move to SQL. ${describeSqlQuestionForSpeech(sqlTask)}`;
                    emit("ai:done", { messageId, fullContent: serverContent });
                    state.history.push({ role: "assistant", content: serverContent });
                    await prisma.sessionMessage.create({
                        data: { sessionId, role: "assistant", content: serverContent, stage: "DS_SQL" },
                    });
                    return;
                }
            }

            if (
                state.currentStage === "DS_CONCEPTS" &&
                !state.stageOrder.includes("DS_SQL") &&
                hasDSSQLHandoffLanguage(fullContent)
            ) {
                const serverContent = "That covers the selected data science concept module. Do you have any questions for me before we end?";
                emit("ai:done", { messageId, fullContent: serverContent });
                state.history.push({ role: "assistant", content: serverContent });
                await prisma.sessionMessage.create({
                    data: { sessionId, role: "assistant", content: serverContent, stage: "DS_CONCEPTS" },
                });
                return;
            }

            // Do not replace ordinary DS_CONCEPTS question/follow-up turns after
            // streaming has started. Auto-record below will still persist DB-bank
            // questions that the model asks, but post-stream replacement can
            // concatenate two different questions in the UI.
        }

        if (
            state.interviewType === "data_science_role" &&
            state.currentStage === "DS_SQL" &&
            state.prefetchedDSSQLQuestion &&
            !state.sqlSnapshot &&
            hasDSSQLHandoffLanguage(fullContent)
        ) {
            const sqlTask = state.prefetchedDSSQLQuestion;
            const serverContent = describeSqlQuestionForSpeech(sqlTask);
            emit("ai:done", { messageId, fullContent: serverContent });
            state.history.push({ role: "assistant", content: serverContent });
            await prisma.sessionMessage.create({
                data: { sessionId, role: "assistant", content: serverContent, stage: "DS_SQL" },
            });
            return;
        }

        if (
            state.interviewType === "data_science_role" &&
            state.currentStage === "DS_SQL" &&
            state.prefetchedDSCodingQuestion &&
            fullContent.trim() &&
            hasDSCodingHandoffLanguage(fullContent)
        ) {
            const transitionResult = await handleToolCall(
                "transition_stage",
                { nextStage: "DS_CODING", reason: "Assistant moved to DS coding without calling transition_stage." },
                toolCtx
            );
            if (transitionResult.startsWith("Interview transitioned")) {
                state.currentStage = "DS_CODING";
                toolCtx.currentStage = "DS_CODING";
                state.sqlEditorOpened = false;
                const task = state.prefetchedDSCodingQuestion;
                state.lastFetchedQuestionId = task.questionId;
                state.lastFetchedLanguage = "python";
                state.currentQuestionTitle = task.title;
                const serverContent = `Nice, we'll move on to a Python data analysis task now. I've opened ${task.title} in the coding editor; take a moment to read it, then walk me through your approach.`;
                emit("ai:done", { messageId, fullContent: serverContent });
                state.history.push({ role: "assistant", content: serverContent });
                await prisma.sessionMessage.create({
                    data: { sessionId, role: "assistant", content: serverContent, stage: "DS_CODING" },
                });
                return;
            }
        }

        // Auto-record DS concept questions if the model asked from the DB bank
        // but forgot to call record_question.
        if (
            state.interviewType === "data_science_role" &&
            state.currentStage === "DS_CONCEPTS" &&
            state.prefetchedDSConceptQuestions?.length &&
            fullContent.trim()
        ) {
            const aiTextLower = fullContent.toLowerCase();
            for (const q of state.prefetchedDSConceptQuestions) {
                const snippet = (q.question || "").slice(0, 80).toLowerCase().trim();
                if (snippet.length < 20) continue;
                if (!aiTextLower.includes(snippet)) continue;
                if (state.askedQuestionIds.includes(q.questionId)) continue;

                const existing = await prisma.sessionQuestion.findFirst({
                    where: { sessionId, questionFundamentalId: q.questionId },
                    select: { id: true },
                });
                if (!existing) {
                    await prisma.sessionQuestion.create({
                        data: {
                            sessionId,
                            questionFundamentalId: q.questionId,
                            questionTitle: q.question.slice(0, 500),
                            questionCategory: "ds_concepts",
                            questionDifficulty: q.difficulty || null,
                            sampleAnswer: q.referenceAnswer || null,
                        },
                    });
                    console.log(`[Orchestrator] Auto-recorded DS concept question from assistant text: ${q.questionId}`);
                }
                state.askedQuestionIds.push(q.questionId);
            }
        }

        // ── PM_CONCEPTS drift: auto-record PM concept questions asked from DB bank ──
        // Also re-inject the bank if the LLM invented a question.
        // Skip entirely when we're discarding this turn's text for a fresh PM_CONCEPTS
        // turn — the bundled transition message never reaches the candidate, so we must
        // not record any bank question it happened to mention (that would mark a question
        // "asked" that was never actually delivered). The fresh turn's own text is what
        // gets recorded on its pass through here.
        if (
            state.interviewType === "pm_role" &&
            state.currentStage === "PM_CONCEPTS" &&
            !needsFreshTransitionTurn &&
            state.prefetchedPMConceptQuestions?.length &&
            fullContent.trim()
        ) {
            const aiTextLower = fullContent.toLowerCase();
            let anyBankQuestionMentioned = false;
            for (const q of state.prefetchedPMConceptQuestions) {
                const snippet = (q.question || "").slice(0, 60).toLowerCase().trim();
                if (snippet.length < 15) continue;
                if (!aiTextLower.includes(snippet)) continue;
                anyBankQuestionMentioned = true;
                if (state.askedQuestionIds.includes(q.questionId)) continue;
                const existing = await prisma.sessionQuestion.findFirst({
                    where: { sessionId, questionFundamentalId: q.questionId },
                    select: { id: true },
                });
                if (!existing) {
                    await prisma.sessionQuestion.create({
                        data: {
                            sessionId,
                            questionFundamentalId: q.questionId,
                            questionTitle: q.question.slice(0, 500),
                            questionCategory: "pm_concepts",
                            questionDifficulty: q.difficulty || null,
                            sampleAnswer: q.evaluationGuide || null,
                        },
                    });
                    console.log(`[Orchestrator] Auto-recorded PM concept question from assistant text: ${q.questionId}`);
                }
                state.askedQuestionIds.push(q.questionId);
            }
            // If LLM asked an invented question, re-inject the bank
            if (!anyBankQuestionMentioned) {
                const qs = state.prefetchedPMConceptQuestions;
                const bankLines: string[] = [
                    "[SYSTEM NOTIFICATION] ⚠️ You asked a question NOT from the PM concept bank. This is NOT allowed.",
                    "You MUST ask ONLY the questions listed below. Do NOT invent PM concept questions.",
                    "",
                    "=== PM CONCEPT BANK (USE THESE EXACT QUESTIONS) ===",
                ];
                for (const q of qs) {
                    bankLines.push(`\n[${q.subtopic}] (${q.difficulty})`);
                    bankLines.push(`  ID: ${q.questionId}`);
                    bankLines.push(`  Q: ${q.question}`);
                }
                bankLines.push("\n=== END PM CONCEPT BANK ===");
                bankLines.push("Ask the NEXT question from the bank above. Call record_question silently.");
                state.history.push({ role: "user", content: bankLines.join("\n") });
                console.warn(`[Orchestrator] PM_CONCEPTS drift: LLM invented question, re-injecting bank for ${sessionId}`);
            }
        }

        // ── PM_STRATEGY drift: ensure LLM uses DB scenario, not invented one ──────
        if (
            state.interviewType === "pm_role" &&
            state.currentStage === "PM_STRATEGY" &&
            state.prefetchedPMStrategyQuestion &&
            fullContent.trim()
        ) {
            const q = state.prefetchedPMStrategyQuestion;
            const aiTextLower = fullContent.toLowerCase();
            const scenarioSnippet = (q.scenario || "").slice(0, 60).toLowerCase().trim();
            const titleSnippet = (q.title || "").slice(0, 40).toLowerCase().trim();
            const dbScenarioMentioned =
                (scenarioSnippet.length > 15 && aiTextLower.includes(scenarioSnippet)) ||
                (titleSnippet.length > 10 && aiTextLower.includes(titleSnippet));
            if (!dbScenarioMentioned) {
                // LLM invented a strategy scenario — re-inject the DB one
                const stratLines: string[] = [
                    "[SYSTEM NOTIFICATION] ⚠️ You presented a strategy scenario NOT from the DB. This is NOT allowed.",
                    `You MUST present ONLY the following pre-loaded strategy scenario:`,
                    "",
                    `Title: ${q.title}`,
                    `Scenario: ${q.scenario}`,
                    "",
                    "Devil's Advocate Probes:",
                    ...q.devilsAdvocateProbes.map((p, i) => `  ${i + 1}. ${p}`),
                    "",
                    `Present this now: "Let's shift to product strategy. ${q.scenario} Walk me through how you'd think about this."`,
                ];
                state.history.push({ role: "user", content: stratLines.join("\n") });
                console.warn(`[Orchestrator] PM_STRATEGY drift: LLM invented scenario, re-injecting DB scenario for ${sessionId}`);
            }
        }

        // Auto-close SQL panel if AI moved to OS/CN/OOPS without calling close_panel.
        // false-positive mid-SQL-round (e.g. "let's move on and run your query").
        // Two signals: (1) topic-name regex, (2) pre-fetched question text appears in response.
        // Also check cachedQuestionData for any SQL question — handles sessions where
        // sqlEditorOpened was not yet set (e.g. old in-flight sessions after a deploy).
        const sqlQCached = state.cachedQuestionData && [...state.cachedQuestionData.values()].some(q => q.category === "SQL");
        const hasAnySqlContext = !!(
            state.sqlEditorOpened ||
            state.sqlSnapshot ||
            state.sqlQuestionDescription ||
            sqlQCached
        );
        console.log(`[Orchestrator] End-of-turn SQL check — sqlEditorOpened=${state.sqlEditorOpened}, hasAnySqlContext=${hasAnySqlContext}, closePanelCalledThisTurn=${closePanelCalledThisTurn}, type=${state.interviewType}, stage=${state.currentStage}`);
        if (state.currentStage === "FUNDAMENTALS" && hasAnySqlContext && sqlContextExistedAtTurnStart) {
            // Word-boundary regex: matches "OS", "CN", "operating system(s)", etc. as standalone words
            const topicPattern = /\b(operating systems?|computer networks?|object[- ]oriented|object oriented programming|oops)\b|\bos\b|\bcn\b/i;
            console.log(`[Orchestrator] Testing fullContent against topicPattern. fullContent length=${fullContent.length}, snippet="${fullContent.slice(0, 120)}"`);


            // Check if any pre-fetched OS/CN/OOPS question text snippet appears in the AI's response
            let questionSnippetMatch = false;
            if (state.prefetchedCSQuestions) {
                outer: for (const [cat, qs] of state.prefetchedCSQuestions) {
                    if (cat === "SQL_query") continue;
                    for (const q of qs) {
                        const snippet = q.questionText.slice(0, 60).toLowerCase().trim();
                        if (snippet.length > 15 && fullContent.toLowerCase().includes(snippet)) {
                            questionSnippetMatch = true;
                            break outer;
                        }
                    }
                }
            }

            if (topicPattern.test(fullContent) || questionSnippetMatch) {
                // Hard rule: never allow SQL -> OS/CN/OOP progression with an open/stale SQL context.
                // If the model forgot close_panel, close it deterministically from orchestrator.
                if (!closePanelCalledThisTurn) {
                    emit("panel:close", { summary: "SQL round complete." });
                }
                state.sqlEditorOpened = false;
                state.sqlSnapshot = null;
                state.sqlQuestionDescription = null;
                state.sqlRoundCompleted = true;
                state.currentFundamentalsPhase = getNextCSPhase(state, "SQL") || "CLOSING";
                clearSQLTimers(sessionId);
                console.log(`[Orchestrator] Auto-closed SQL panel — AI moved to next CS phase for ${sessionId}`);
            }
        }

        // Drift correction: AI moved to OS/CN/OOPS WITHOUT ever opening SQL editor.
        // Mandatory phase order is DBMS → SQL → OS → CN → OOPS, and SQL must not be skipped.
        // If we detect OS/CN/OOPS content while SQL editor was never opened and SQL round not
        // completed, force-open SQL editor and re-trigger the agent turn so it runs the SQL round.
        if (
            state.currentStage === "FUNDAMENTALS" &&
            !state.sqlEditorOpened &&
            !state.sqlRoundCompleted &&
            !sqlContextExistedAtTurnStart &&
            fullContent.trim()
        ) {
            const cachedSqlQ = [...state.cachedQuestionData.values()].find((q) => q?.category === "SQL");
            if (cachedSqlQ) {
                const nextAfterSql = getNextCSPhase(state, "SQL");
                const topicPatternByPhase: Record<string, RegExp> = {
                    DBMS: /\b(databases?|dbms|sql theory|normalization|transactions?)\b/i,
                    OS: /\b(operating systems?|os|process|threads?|deadlock|scheduling)\b/i,
                    CN: /\b(computer networks?|networking|cn|tcp|udp|http|osi)\b/i,
                    OOPS: /\b(object[- ]oriented|object oriented programming|oops|oop|polymorphism|inheritance|encapsulation)\b/i,
                };
                const skipPattern = nextAfterSql ? topicPatternByPhase[nextAfterSql] : null;
                let nonSqlSnippetMatch = false;
                if (state.prefetchedCSQuestions && nextAfterSql) {
                    const qs = state.prefetchedCSQuestions.get(nextAfterSql) || [];
                    for (const q of qs) {
                        const snippet = q.questionText.slice(0, 60).toLowerCase().trim();
                        if (snippet.length > 15 && fullContent.toLowerCase().includes(snippet)) {
                            nonSqlSnippetMatch = true;
                            break;
                        }
                    }
                }

                if ((skipPattern?.test(fullContent) || nonSqlSnippetMatch) && nextAfterSql) {
                    console.warn(`[Orchestrator] Detected ${nextAfterSql} content in FUNDAMENTALS without SQL for ${sessionId}; forcing SQL.`);
                    const sqlOpenResult = await handleToolCall("open_sql_editor", {}, toolCtx);
                    if (sqlOpenResult.startsWith("SQL editor opened")) {
                        state.sqlEditorOpened = true;
                        state.currentFundamentalsPhase = 'SQL';
                        if ((cachedSqlQ as any).problemDescription) {
                            state.sqlQuestionDescription = `${(cachedSqlQ as any).title || ""}\n\n${(cachedSqlQ as any).problemDescription}`;
                        }
                        state.history.push({
                            role: "user",
                            content:
                                "[SYSTEM NOTIFICATION] The configured SQL activity was reached before the next CS topic. The SQL editor has been opened automatically. " +
                                `${describeSqlQuestionForSpeech(cachedSqlQ)} Do not ask the next CS topic until this SQL problem is complete. ` +
                                "Speak naturally and do not mention phases, configuration, QUESTION BANK, or internal ordering.",
                        });
                        setTimeout(() => {
                            processAgentTurn(sessionId, null, emit).catch((err) => {
                                console.error(`[Orchestrator] SQL drift kickoff error for ${sessionId}:`, err);
                            });
                        }, 0);
                    }
                }
            }
        }

        // ── Output leak-scan (company screening) ───────────────────────────
        // Structural backstop to the prompt guard: redact any confidential reference
        // material (expected points / reference solutions / evaluation guides) the
        // interviewer may have reproduced, BEFORE the full turn is emitted or persisted
        // (both channels are candidate-visible). Streaming was suppressed above for
        // screening, so nothing has reached the candidate yet — this is the last gate.
        if (state.companyScreening) {
            const secrets = collectScreeningSecrets(
                state.companyScreening.blueprintSnapshot,
                (state as any).companyScreeningPhasePrefetch ?? null
            );
            // Also redact the evaluation-only GitHub verification facts (resume phase grounding).
            if (state.companyScreeningGithubVerificationSecrets?.length) {
                secrets.push(...state.companyScreeningGithubVerificationSecrets);
            }
            const guard = redactScreeningLeak(fullContent, secrets);
            if (guard.leaked) {
                console.warn(`[ScreeningLeak] ${sessionId}: redacted ${guard.removed} sentence(s) reproducing confidential reference material from the interviewer turn.`);
                fullContent = guard.text;
            }
        }

        rememberResumeProbeQuestionFromAssistant(state, fullContent);
        rememberResumeAgendaAssistantQuestion(state, fullContent, resumeAgendaItemIdForAssistantQuestion);

        // Server-side anti-repeat safety net: if this resume turn asked a question
        // but the model never recorded a probe, advance the agenda/probe state for it
        // so the next prompt isn't an identical re-ask of the same question.
        await ensureResumeProbeRecordedAfterTurn(
            state,
            toolCtx,
            userMessage,
            fullContent,
            resumeProbeRecordedThisTurn,
            resumeAgendaItemIdForAssistantQuestion
        );

        // Auto-record CS theory questions if the model asked from QUESTION BANK
        // but forgot to call record_question.
        if (state.currentStage === "FUNDAMENTALS" && state.prefetchedCSQuestions && fullContent.trim()) {
            const aiTextLower = fullContent.toLowerCase();
            for (const [cat, questions] of state.prefetchedCSQuestions) {
                if (cat === "SQL_query") continue;
                for (const q of questions) {
                    const snippet = (q.questionText || "").slice(0, 80).toLowerCase().trim();
                    if (snippet.length < 20) continue;
                    if (!aiTextLower.includes(snippet)) continue;

                    const existing = await prisma.sessionQuestion.findFirst({
                        where: { sessionId, questionFundamentalId: q.questionId },
                        select: { id: true },
                    });
                    if (!existing) {
                        await prisma.sessionQuestion.create({
                            data: {
                                sessionId,
                                questionFundamentalId: q.questionId,
                                questionTitle: q.questionText.slice(0, 500),
                                questionCategory: "cs_fundamentals",
                                sampleAnswer: q.referenceAnswer || null,
                            },
                        });
                        console.log(`[Orchestrator] Auto-recorded CS question from assistant text: ${q.questionId}`);
                    }
                }
            }
        }
        // ── SD transition: server-generated intro (NO LLM) ─────────────────
        // When the AI just transitioned to SYSTEM_DESIGN, its streamed text
        // may contain a hallucinated system name. We replace it with a clean
        // closing message. Then instead of calling processAgentTurn (which would
        // let the LLM hallucinate again), the SERVER directly emits a hardcoded
        // AI message with the exact DB question title. Zero LLM involvement.
        if (
            state.interviewType === "gen_ai_role" &&
            state.currentStage === "GEN_AI_CONCEPTS" &&
            state.prefetchedGenAICodingQuestion &&
            hasGenAICodingHandoffLanguage(fullContent)
        ) {
            const nextAfterGenAIConcepts = getNextEnabledStage(state.stageOrder, "GEN_AI_CONCEPTS");
            if (nextAfterGenAIConcepts !== "GEN_AI_CODING") {
                return;
            }
            let cleanFullContent = sanitizeSpokenInterviewText(fullContent);
            if (suppressSystemDesignIntroStreaming) {
                cleanFullContent = stripDuplicateIntroWelcome(cleanFullContent);
            }
            emit("ai:done", { messageId, fullContent: cleanFullContent });
            if (cleanFullContent.trim()) {
                state.history.push({ role: "assistant", content: cleanFullContent });
                await prisma.sessionMessage.create({
                    data: { sessionId, role: "assistant", content: cleanFullContent, stage: state.currentStage },
                });
            }

            const transitionResult = await handleToolCall(
                "transition_stage",
                { nextStage: nextAfterGenAIConcepts, reason: "Assistant verbally moved to GenAI coding without calling transition_stage." },
                toolCtx
            );
            if (transitionResult.startsWith("Interview transitioned")) {
                state.currentStage = nextAfterGenAIConcepts;
                toolCtx.currentStage = nextAfterGenAIConcepts;
            }

            const task = state.prefetchedGenAICodingQuestion;
            const openResult = await handleToolCall(
                "open_ide",
                { questionId: task.questionId, language: "python" },
                toolCtx
            );
            if (openResult.startsWith("IDE opened")) {
                state.lastFetchedQuestionId = task.questionId;
                state.lastFetchedLanguage = "python";
                state.currentQuestionTitle = task.title;
            }

            state.history.push({
                role: "user",
                content:
                    `[SYSTEM NOTIFICATION] Stage corrected to GEN_AI_CODING. ` +
                    `Use ONLY this DB task: ID=${task.questionId}, title="${task.title}". ` +
                    "The IDE is already open; do not invent another coding task.",
            });

            const serverMessageId = `msg_${Date.now()}_${++messageCounter}`;
            const serverIntro =
                `I've opened ${task.title} in the coding editor. ` +
                "Use Python and start by walking me through your approach.";
            emit("ai:token", { token: "", messageId: serverMessageId });
            emit("ai:token", { token: serverIntro, messageId: serverMessageId });
            emit("ai:done", { messageId: serverMessageId, fullContent: serverIntro });
            state.history.push({ role: "assistant", content: serverIntro });
            await prisma.sessionMessage.create({
                data: { sessionId, role: "assistant", content: serverIntro, stage: "GEN_AI_CODING" },
            });
            return;
        }

        if (
            state.currentStage === "GEN_AI_CODING" &&
            state.interviewType === "gen_ai_role" &&
            /\b(before we wrap up|responsibility|responsible ai|ai safety|final part|wrap-up)\b/i.test(fullContent)
        ) {
            const nextAfterGenAICoding = getNextEnabledStage(state.stageOrder, "GEN_AI_CODING");
            if (!nextAfterGenAICoding) return;
            const transitionResult = await handleToolCall(
                "transition_stage",
                { nextStage: nextAfterGenAICoding, reason: "Assistant moved to final responsibility discussion without calling transition_stage." },
                toolCtx
            );
            if (transitionResult.startsWith("Interview transitioned")) {
                state.currentStage = nextAfterGenAICoding;
                toolCtx.currentStage = nextAfterGenAICoding;
            }
        }

        if (
            state.currentStage === "DS_CODING" &&
            state.interviewType === "data_science_role" &&
            /\b(business metrics|metrics case|business case|experiment|a\/b test|wrap up|wrap-up)\b/i.test(fullContent)
        ) {
            const nextAfterDSCoding = getNextEnabledStage(state.stageOrder, "DS_CODING");
            if (!nextAfterDSCoding) return;
            const transitionResult = await handleToolCall(
                "transition_stage",
                { nextStage: nextAfterDSCoding, reason: "Assistant moved to business metrics discussion without calling transition_stage." },
                toolCtx
            );
            if (transitionResult.startsWith("Interview transitioned")) {
                state.currentStage = nextAfterDSCoding;
                toolCtx.currentStage = nextAfterDSCoding;
            }
        }

        if (
            state.interviewType === "behavioural" &&
            hasFinalClosingLanguage(fullContent)
        ) {
            const cleanFullContent = sanitizeSpokenInterviewText(fullContent);
            emit("ai:done", { messageId, fullContent: cleanFullContent });
            if (cleanFullContent.trim()) {
                state.history.push({ role: "assistant", content: cleanFullContent });
                await prisma.sessionMessage.create({
                    data: { sessionId, role: "assistant", content: cleanFullContent, stage: state.currentStage },
                });
            }

            if (state.currentStage !== "CLOSING") {
                const transitionResult = await handleToolCall(
                    "transition_stage",
                    { nextStage: "CLOSING", reason: "Behavioural interviewer delivered final closing." },
                    toolCtx
                );
                if (transitionResult.startsWith("Interview transitioned")) {
                    state.currentStage = "CLOSING";
                    toolCtx.currentStage = "CLOSING";
                    state.stageStartedAtMs = Date.now();
                }
            }
            if (state.currentStage === "CLOSING") {
                await handleToolCall(
                    "end_interview",
                    { summary: "Interviewer delivered final closing language." },
                    toolCtx
                );
            }

            clearDSATimers(state.sessionId);
            clearSQLTimers(state.sessionId);
            return;
        }

        if (
            state.interviewType === "gen_ai_role" &&
            state.currentStage === "CLOSING" &&
            hasFinalClosingLanguage(fullContent)
        ) {
            const cleanFullContent = sanitizeSpokenInterviewText(fullContent);
            emit("ai:done", { messageId, fullContent: cleanFullContent });
            if (cleanFullContent.trim()) {
                state.history.push({ role: "assistant", content: cleanFullContent });
                await prisma.sessionMessage.create({
                    data: { sessionId, role: "assistant", content: cleanFullContent, stage: state.currentStage },
                });
            }
            if (state.currentStage === "CLOSING") {
                await handleToolCall(
                    "end_interview",
                    { summary: "Resume screening delivered final closing language." },
                    toolCtx
                );
            }
            clearDSATimers(state.sessionId);
            clearSQLTimers(state.sessionId);
            return;
        }

        if (
            state.interviewType !== "resume_round" &&
            state.currentStage === "CLOSING" &&
            hasFinalClosingLanguage(fullContent)
        ) {
            const cleanFullContent = sanitizeSpokenInterviewText(fullContent);
            emit("ai:done", { messageId, fullContent: cleanFullContent });
            if (cleanFullContent.trim()) {
                state.history.push({ role: "assistant", content: cleanFullContent });
                await prisma.sessionMessage.create({
                    data: { sessionId, role: "assistant", content: cleanFullContent, stage: state.currentStage },
                });
            }
            await handleToolCall(
                "end_interview",
                { summary: "Interviewer delivered final closing language in the closing stage." },
                toolCtx
            );
            clearDSATimers(state.sessionId);
            clearSQLTimers(state.sessionId);
            return;
        }

        if (
            state.interviewType === "resume_round" &&
            hasFinalClosingLanguage(fullContent)
        ) {
            const cleanFullContent = sanitizeSpokenInterviewText(fullContent);
            let nextStage = getNextEnabledStage(state.stageOrder, state.currentStage);
            while (nextStage && nextStage !== state.currentStage) {
                const transitionResult = await handleToolCall(
                    "transition_stage",
                    { nextStage, reason: "Resume Round delivered final closing; advancing to closeout." },
                    toolCtx
                );
                if (transitionResult.startsWith("Interview transitioned")) {
                    state.currentStage = nextStage;
                    toolCtx.currentStage = nextStage;
                    state.stageStartedAtMs = Date.now();
                    if (nextStage === "CLOSING") break;
                    nextStage = getNextEnabledStage(state.stageOrder, state.currentStage);
                    continue;
                }
                break;
            }

            emit("ai:done", { messageId, fullContent: cleanFullContent });
            if (cleanFullContent.trim()) {
                state.history.push({ role: "assistant", content: cleanFullContent });
                await prisma.sessionMessage.create({
                    data: { sessionId, role: "assistant", content: cleanFullContent, stage: state.currentStage },
                });
            }
            clearDSATimers(state.sessionId);
            clearSQLTimers(state.sessionId);
            return;
        }

        if (needsFreshTransitionTurn) {
            // The model already streamed a (bundled, possibly fabricated) transition
            // message under the stale previous-stage prompt. Replace it with a short
            // clean bridge, persist that, sync the stage, and fire ONE fresh turn so the
            // new stage's first question is generated under the correct prompt. Scheduled
            // via setTimeout(…, 0) so it runs after `finally` clears state.turnInFlight.
            const bridge = freshTransitionBridge || "Thanks. Let's move on.";
            emit("ai:done", { messageId, fullContent: bridge });
            state.history.push({ role: "assistant", content: bridge });
            await prisma.sessionMessage.create({
                data: {
                    sessionId,
                    role: "assistant",
                    content: bridge,
                    stage: (freshTransitionBridgeStage || state.currentStage) as any,
                },
            });
            if (state.currentStage !== toolCtx.currentStage) {
                state.currentStage = toolCtx.currentStage;
                state.stageStartedAtMs = Date.now();
            }
            setTimeout(() => {
                processAgentTurn(sessionId, null, emit).catch((err) => {
                    console.error(`[Orchestrator] Fresh transition turn error for ${sessionId}:`, err);
                });
            }, 0);
            console.log(`[Orchestrator] SERVER fresh-transition turn scheduled for stage ${state.currentStage} (${sessionId})`);
        } else if (needsGenAIResponsibilityIntro && state.currentStage === "CLOSING") {
            fullContent = "Thanks, let's move to one final AI responsibility scenario.";
            emit("ai:done", { messageId, fullContent });
            state.history.push({ role: "assistant", content: fullContent });
            await prisma.sessionMessage.create({
                data: { sessionId, role: "assistant", content: fullContent, stage: "CLOSING" },
            });

            state.currentStage = toolCtx.currentStage;

            const responsibilityMessageId = `msg_${Date.now()}_${++messageCounter}`;
            const responsibilityIntroContent =
                "Imagine a generative AI feature is creating user-impacting recommendations, and your team finds a serious quality or safety risk after launch. " +
                "What steps would you take?";

            emit("ai:token", { token: "", messageId: responsibilityMessageId });
            emit("ai:token", { token: responsibilityIntroContent, messageId: responsibilityMessageId });
            emit("ai:done", { messageId: responsibilityMessageId, fullContent: responsibilityIntroContent });

            state.history.push({ role: "assistant", content: responsibilityIntroContent });
            await prisma.sessionMessage.create({
                data: { sessionId, role: "assistant", content: responsibilityIntroContent, stage: "CLOSING" },
            });

            console.log(`[Orchestrator] SERVER-GENERATED GenAI responsibility intro for ${sessionId}`);
        } else if (needsServerDsaIntro && state.currentStage === "DSA" && state.prefetchedDSAQuestion) {
            fullContent = "Great, thanks for sharing your background. Let's move on to the coding problem now.";
            emit("ai:done", { messageId, fullContent });
            state.history.push({ role: "assistant", content: fullContent });
            await prisma.sessionMessage.create({
                data: { sessionId, role: "assistant", content: fullContent, stage: "INTRO" },
            });

            const dsaIntroMessageId = `msg_${Date.now()}_${++messageCounter}`;
            const dsaIntroContent = buildPinnedDsaIntro(state.prefetchedDSAQuestion);

            emit("ai:token", { token: "", messageId: dsaIntroMessageId });
            emit("ai:token", { token: dsaIntroContent, messageId: dsaIntroMessageId });
            emit("ai:done", { messageId: dsaIntroMessageId, fullContent: dsaIntroContent });
            state.history.push({ role: "assistant", content: dsaIntroContent });
            await prisma.sessionMessage.create({
                data: { sessionId, role: "assistant", content: dsaIntroContent, stage: "DSA" },
            });

            console.log(`[Orchestrator] SERVER-GENERATED DSA intro for "${state.prefetchedDSAQuestion.title}" (${sessionId})`);
        } else if (endCurrentLoopAfterTools && state.prefetchedSDQuestion) {
            const sdTitle = state.prefetchedSDQuestion.title;

            // 1. Replace the hallucinated INTRO closing with a clean version
            fullContent = "Thanks. Let's move to the design problem now.";

            // 2. Signal text completion for the INTRO closing (frontend replaces streamed tokens)
            emit("ai:done", { messageId, fullContent });

            // 3. Save clean INTRO closing to history and DB
            state.history.push({ role: "assistant", content: fullContent });
            await prisma.sessionMessage.create({
                data: { sessionId, role: "assistant", content: fullContent, stage: "INTRO" },
            });

            // 4. Sync stage
            state.currentStage = toolCtx.currentStage;

            // 5. SERVER-GENERATED DESIGN INTRO — no LLM call, no hallucination
            const sdIntroMessageId = `msg_${Date.now()}_${++messageCounter}`;
            const sdIntroContent =
                `Let's design ${sdTitle}. The whiteboard is already open — go ahead and ` +
                `start sketching your design and walk me through your thinking. ` +
                `Let's begin by discussing the functional and non-functional requirements.`;

            emit("ai:token", { token: "", messageId: sdIntroMessageId });
            emit("ai:token", { token: sdIntroContent, messageId: sdIntroMessageId });
            emit("ai:done", { messageId: sdIntroMessageId, fullContent: sdIntroContent });

            // Save the server-generated intro to history and DB
            state.history.push({ role: "assistant", content: sdIntroContent });
            await prisma.sessionMessage.create({
                data: { sessionId, role: "assistant", content: sdIntroContent, stage: "SYSTEM_DESIGN" },
            });

            console.log(`[Orchestrator] SERVER-GENERATED SD intro for "${sdTitle}" — no LLM involved (session ${sessionId})`);
        } else if (endCurrentLoopAfterTools && state.currentStage === "PM_CASE" && state.prefetchedPMCaseQuestion) {
            // ── PM_CASE: server-generated case intro (NO LLM) ──────────────────
            // Same pattern as SYSTEM_DESIGN: the INTRO closing is already streamed.
            // Replace it with a clean bridge, then emit the DB case scenario directly.
            const caseQ = state.prefetchedPMCaseQuestion;

            fullContent = "Great — let's move to the product case now.";
            emit("ai:done", { messageId, fullContent });
            state.history.push({ role: "assistant", content: fullContent });
            await prisma.sessionMessage.create({
                data: { sessionId, role: "assistant", content: fullContent, stage: "INTRO" },
            });

            state.currentStage = toolCtx.currentStage;

            // SERVER-GENERATED case intro — speaks the DB scenario, no LLM hallucination
            const pmCaseMessageId = `msg_${Date.now()}_${++messageCounter}`;
            const pmCaseIntroContent =
                `We'll now move to a case study. ${caseQ.scenario} ` +
                `Use the notepad to jot down your thoughts and frame your answer using the CIRCLES framework. ` +
                `Start by clarifying the problem, then walk me through your structure.`;

            emit("ai:token", { token: "", messageId: pmCaseMessageId });
            emit("ai:token", { token: pmCaseIntroContent, messageId: pmCaseMessageId });
            emit("ai:done", { messageId: pmCaseMessageId, fullContent: pmCaseIntroContent });

            state.history.push({ role: "assistant", content: pmCaseIntroContent });
            await prisma.sessionMessage.create({
                data: { sessionId, role: "assistant", content: pmCaseIntroContent, stage: "PM_CASE" },
            });

            console.log(`[Orchestrator] SERVER-GENERATED PM case intro for "${caseQ.title}" — no LLM involved (session ${sessionId})`);
        } else {
            // Normal path: no SD transition detected
            if (
                state.interviewType === "full_interview" &&
                toolCtx.currentStage === "DSA" &&
                hasPrematureClosingLanguage(fullContent)
            ) {
                console.warn(`[Orchestrator] Rewriting premature DSA closing language for ${sessionId}`);
                fullContent =
                    "Let's continue with this coding problem. " +
                    "Please outline your approach first, then implement and run the visible tests.";
            }

            const cleanFullContent = sanitizeSpokenInterviewText(fullContent);
            emit("ai:done", { messageId, fullContent: cleanFullContent });

            if (cleanFullContent.trim()) {
                state.history.push({ role: "assistant", content: cleanFullContent });
                await prisma.sessionMessage.create({
                    data: { sessionId, role: "assistant", content: cleanFullContent, stage: state.currentStage },
                });
            }

            if (
                state.interviewType === "problem_solving_case" &&
                state.currentStage === "PROBLEM_SOLVING" &&
                state.prefetchedProblemSolvingCaseQuestion &&
                !state.problemSolvingNotepadOpened &&
                fullContent.trim()
            ) {
                emit("panel:open", {
                    type: "notepad",
                    stage: "PROBLEM_SOLVING",
                    topic: state.prefetchedProblemSolvingCaseQuestion.title,
                    template: "blank",
                    initialContent: "",
                    scenario: state.prefetchedProblemSolvingCaseQuestion.prompt,
                });
                state.problemSolvingNotepadOpened = true;
                console.log(`[Orchestrator] Server-forced problem-solving notepad for ${sessionId}`);
            }

            // Sync stage from tool context (may have been updated by transition_stage)
            if (state.currentStage !== toolCtx.currentStage) {
                state.currentStage = toolCtx.currentStage;
                state.stageStartedAtMs = Date.now();
            }
        }
    } finally {
        state.turnInFlight = false;
        state.pendingUserMessages ||= [];
        const queued = state.pendingUserMessages.splice(0);
        if (queued.length > 0) {
            const queuedMessage = queued.join("\n");
            setTimeout(() => {
                processAgentTurn(sessionId, queuedMessage, emit).catch((err) => {
                    console.error(`[Orchestrator] Queued turn drain error for ${sessionId}:`, err);
                });
            }, 0);
        }
        // No more processAgentTurn calls here — the server-generated message
        // handles the SD introduction. The next user reply triggers a normal
        // processAgentTurn in the SYSTEM_DESIGN stage context.
    }
}

// ── Update Code Snapshot ─────────────────────────────────────

export function updateCodeSnapshot(
    sessionId: string,
    code: string,
    language: string
): void {
    const state = activeSessions.get(sessionId);
    if (state) {
        if (language === "sql") {
            state.sqlSnapshot = code;
        } else {
            state.codeSnapshot = code;
            state.codeLanguage = language;
        }
    }
}


// ── SQL Phase Timer Management ────────────────────────────────
// Manages three fixed timers started once when the SQL phase opens.
// They do NOT reset on user/editor activity.
//   - SQL_APPROACH_MS:  approach reminder after initial thinking time
//   - SQL_QUERY_MS:     query-written reminder after more elapsed time
//   - SQL_TOTAL_MS:     hard timeout forcing wrap-up and phase transition

const SQL_APPROACH_MS = 5 * 60 * 1000;  // 5 minutes — approach reminder
const SQL_QUERY_MS = 10 * 60 * 1000;  // 10 minutes — query-written reminder
const SQL_TOTAL_MS = 15 * 60 * 1000;  // 15 minutes — hard timeout

/** Fire-and-forget: push an internal nudge into the LLM without persisting to DB. */
async function sendSQLInternalNudge(
    sessionId: string,
    text: string,
    emit: (event: string, payload: any) => void
): Promise<void> {
    const state = activeSessions.get(sessionId);
    if (!state) return;
    // Push as a system notification into history (not saved to DB)
    state.history.push({ role: "user", content: text });
    // Re-use processAgentTurn with null userMessage so it calls the LLM without
    // DB writes for the nudge itself (the AI response will still be persisted).
    await processAgentTurn(sessionId, null, emit).catch(err => {
        console.error(`[Orchestrator] SQL nudge error for ${sessionId}:`, err);
    });
}

/** Start all SQL timers when the SQL editor opens. */
export function startSQLPhaseTimers(
    sessionId: string,
    emit: (event: string, payload: any) => void
): void {
    const state = activeSessions.get(sessionId);
    if (!state) return;

    // Clear any stale timers from a previous SQL round
    clearSQLTimers(sessionId);

    console.log(`[Orchestrator] SQL timers started for ${sessionId} (approach:5m, query:10m, total:15m)`);

    // 5-min approach reminder (conditional — AI only speaks if approach not yet given)
    state.sqlApproachTimer = setTimeout(function fireApproach() {
        const s = activeSessions.get(sessionId);
        if (!s) return;
        if (s.turnInFlight) {
            console.log(`[Orchestrator] SQL approach nudge deferred — turn in flight for ${sessionId}`);
            s.sqlApproachTimer = setTimeout(fireApproach, 5_000);
            return;
        }
        s.sqlApproachTimer = null;
        console.log(`[Orchestrator] SQL approach timer fired for ${sessionId}`);
        const nextAfterSql = getNextCSPhase(s, "SQL");

        sendSQLInternalNudge(
            sessionId,
            "[SYSTEM NOTIFICATION] 5 minutes have passed on the SQL question. " +
            "Check the conversation: has the candidate clearly articulated their approach (i.e. explained " +
            "how they plan to write the query, which tables/joins/conditions they'll use)? " +
            "If NOT yet, gently remind them: \"We're about 5 minutes in — do you have an approach in mind? " +
            "Walk me through how you're thinking about this.\" " +
            "If they HAVE already explained their approach, say nothing about the time and continue naturally.",
            emit
        );
    }, SQL_APPROACH_MS);

    // 10-min query-written reminder (conditional — AI only speaks if no query written yet)
    state.sqlQueryTimer = setTimeout(function fireQuery() {
        const s = activeSessions.get(sessionId);
        if (!s) return;
        if (s.turnInFlight) {
            console.log(`[Orchestrator] SQL query nudge deferred — turn in flight for ${sessionId}`);
            s.sqlQueryTimer = setTimeout(fireQuery, 5_000);
            return;
        }
        s.sqlQueryTimer = null;
        console.log(`[Orchestrator] SQL query timer fired for ${sessionId}`);
        sendSQLInternalNudge(
            sessionId,
            "[SYSTEM NOTIFICATION] 10 minutes have passed on the SQL question. " +
            "Check the conversation: has the candidate written any SQL in the editor (attempted a query, " +
            "even a partial or incorrect one)? " +
            "If they have NOT written anything yet, gently prompt them: \"We're 10 minutes in — let's try " +
            "to get something down in the editor, even a rough attempt is fine.\" " +
            "If they HAVE already written something (correct or not), say nothing about the time and continue naturally.",
            emit
        );
    }, SQL_QUERY_MS);

    // 15-min hard timeout — force wrap-up regardless of state
    state.sqlTotalTimer = setTimeout(function fireTotal() {
        const s = activeSessions.get(sessionId);
        if (!s) return;
        if (s.turnInFlight) {
            console.log(`[Orchestrator] SQL total nudge deferred — turn in flight for ${sessionId}`);
            s.sqlTotalTimer = setTimeout(fireTotal, 5_000);
            return;
        }
        s.sqlTotalTimer = null;
        s.sqlApproachTimer && clearTimeout(s.sqlApproachTimer); s.sqlApproachTimer = null;
        s.sqlQueryTimer && clearTimeout(s.sqlQueryTimer); s.sqlQueryTimer = null;
        console.log(`[Orchestrator] SQL total timer fired for ${sessionId} — force-closing SQL panel`);

        // Force-close the panel immediately from the orchestrator — do NOT wait for
        // the AI to call close_panel. This guarantees the panel is gone even if the
        // AI ignores the nudge or forgets the tool call.
        if (s.sqlEditorOpened) {
            emit("panel:close", { summary: "SQL round time limit reached." });
            s.sqlEditorOpened = false;
            s.sqlSnapshot = null;
            s.sqlQuestionDescription = null;
        }
        const nextAfterSql = getNextCSPhase(s, "SQL");

        sendSQLInternalNudge(
            sessionId,
            "[SYSTEM NOTIFICATION] The 15-minute SQL round time limit has been reached. " +
            "The SQL editor has been closed automatically. " +
            "Give brief, neutral feedback on the candidate's attempt " +
            (nextAfterSql
                ? `then continue with the next configured CS topic (${nextAfterSql}) from the current question bank. You are still in FUNDAMENTALS; do NOT call transition_stage yet. `
                : "then transition to CLOSING now. ") +
            "Ignore any older fixed OS/Phase 3 instruction. " +
            "(e.g. \"Thanks for the effort — let's move on\"), then immediately continue with " +
            "the next configured item by following the dynamic interview flow. Legacy text ignored: " +
            "from the question bank already provided in your system prompt. " +
            "You are still in the FUNDAMENTALS stage — do NOT call transition_stage, do NOT call " +
            "close_panel (it is already closed), and do NOT end the interview.",
            emit
        );
    }, SQL_TOTAL_MS);
}

/** Clear all SQL timers (e.g. on stage transition or session end). */
export function clearSQLTimers(sessionId: string): void {
    const state = activeSessions.get(sessionId);
    if (!state) return;
    if (state.sqlApproachTimer) { clearTimeout(state.sqlApproachTimer); state.sqlApproachTimer = null; }
    if (state.sqlQueryTimer) { clearTimeout(state.sqlQueryTimer); state.sqlQueryTimer = null; }
    if (state.sqlTotalTimer) { clearTimeout(state.sqlTotalTimer); state.sqlTotalTimer = null; }
}

// ── Update Canvas Snapshot (from Excalidraw) ─────────────────────

export function updateCanvasSnapshot(
    sessionId: string,
    elements: any
): void {
    const state = activeSessions.get(sessionId);
    if (state) {
        state.canvasSnapshot = elements;
        const count = Array.isArray(elements)
            ? elements.filter((el: any) => el && !el.isDeleted && el.type !== "selection").length
            : 0;
        if (count > 0) {
            const types = Array.isArray(elements)
                ? Array.from(new Set(elements.map((el: any) => String(el?.type || "unknown")))).join(", ")
                : "unknown";
            console.log(`[Orchestrator] Canvas snapshot updated for ${sessionId}: ${count} elements (${types})`);
        }
    }
}

export function updateNotepadSnapshot(
    sessionId: string,
    html: string
): void {
    const state = activeSessions.get(sessionId);
    if (state) {
        state.notepadSnapshot = html;
    }
}

// ── Update Rubric Lite (from MongoDB question fetch) ───────────

export function updateRubricLite(
    sessionId: string,
    rubricLite: any
): void {
    const state = activeSessions.get(sessionId);
    if (state) {
        state.rubricLite = rubricLite;
    }
}

// ── Cleanup Session ──────────────────────────────────────────

export function cleanupSession(sessionId: string): void {
    clearSQLTimers(sessionId);
    clearDSATimers(sessionId);
    const state = activeSessions.get(sessionId);
    if (state?.companyScreeningWatchdog) {
        clearTimeout(state.companyScreeningWatchdog);
        state.companyScreeningWatchdog = null;
    }
    activeSessions.delete(sessionId);
}

// ── DSA Phase Timer Management ───────────────────────────────

/**
 * Total minutes allotted to the DSA/coding phase for THIS interview, read from its
 * own config (moduleConfig override → effective type config → 30 fallback). This is
 * why the timers do NOT use a shared 30-min constant: the standalone `coding`
 * interview configures DSA at 40 min (its sole phase), while SDE `full_interview`
 * configures DSA at 30 min (one of four phases). Honoring the per-interview value
 * keeps the two independent — changing coding's duration never affects SDE.
 */
function getDSAPhaseTotalMinutes(state: SessionState): number {
    const fromModule = state.moduleConfig?.stageDurations?.DSA;
    if (fromModule && typeof fromModule.max === "number" && fromModule.max > 0) {
        return fromModule.max;
    }
    const effectiveConfig = resolveEffectiveInterviewTypeConfig(state.interviewType, state.moduleConfig);
    const fromType = effectiveConfig.stageDurations?.DSA;
    if (fromType && typeof fromType.max === "number" && fromType.max > 0) {
        return fromType.max;
    }
    return 30;
}

async function sendDSAInternalNudge(
    sessionId: string,
    text: string,
    emit: (event: string, payload: any) => void
): Promise<void> {
    const state = activeSessions.get(sessionId);
    if (!state) return;
    state.history.push({ role: "user", content: text });
    await processAgentTurn(sessionId, null, emit).catch(err => {
        console.error(`[Orchestrator] DSA nudge error for ${sessionId}:`, err);
    });
}

export function startDSAPhaseTimers(
    sessionId: string,
    emit: (event: string, payload: any) => void
): void {
    const state = activeSessions.get(sessionId);
    if (!state) return;

    clearDSATimers(sessionId);

    // Derive the three checkpoints from THIS interview's configured DSA duration so
    // the nudges/hard-stop line up with the candidate's countdown clock. coding → 40m
    // (nudges at 30m/35m, end at 40m); SDE full_interview → 30m (20m/25m/30m, unchanged).
    const totalMin = getDSAPhaseTotalMinutes(state);
    const firstNudgeMin = Math.max(1, totalMin - 10);   // "10 minutes left"
    const secondNudgeMin = Math.max(1, totalMin - 5);    // "5 minutes left"
    const firstNudgeMs = firstNudgeMin * 60 * 1000;
    const secondNudgeMs = secondNudgeMin * 60 * 1000;
    const totalMs = totalMin * 60 * 1000;
    console.log(`[Orchestrator] DSA timers started for ${sessionId} (${firstNudgeMin}m, ${secondNudgeMin}m, ${totalMin}m hard timeout)`);

    state.dsa20Timer = setTimeout(function fire20() {
        const s = activeSessions.get(sessionId);
        if (!s || s.currentStage !== "DSA") return;
        if (s.turnInFlight) {
            s.dsa20Timer = setTimeout(fire20, 5_000);
            return;
        }
        s.dsa20Timer = null;
        sendDSAInternalNudge(
            sessionId,
            `[SYSTEM NOTIFICATION] ${firstNudgeMin} minutes have elapsed in the coding round. There are 10 minutes left. Briefly remind the candidate to focus on completing, testing, and explaining complexity. Do not mention internal stage names.`,
            emit
        );
    }, firstNudgeMs);

    state.dsa25Timer = setTimeout(function fire25() {
        const s = activeSessions.get(sessionId);
        if (!s || s.currentStage !== "DSA") return;
        if (s.turnInFlight) {
            s.dsa25Timer = setTimeout(fire25, 5_000);
            return;
        }
        s.dsa25Timer = null;
        sendDSAInternalNudge(
            sessionId,
            `[SYSTEM NOTIFICATION] ${secondNudgeMin} minutes have elapsed in the coding round. There are 5 minutes left. Ask for final test run/submit and a concise time-space complexity summary. Do not mention internal stage names.`,
            emit
        );
    }, secondNudgeMs);

    state.dsa30Timer = setTimeout(function fire30() {
        const s = activeSessions.get(sessionId);
        if (!s || s.currentStage !== "DSA") return;
        if (s.turnInFlight) {
            s.dsa30Timer = setTimeout(fire30, 5_000);
            return;
        }

        forceDSATimeoutTransition(sessionId, emit).catch(err => {
            console.error(`[Orchestrator] DSA hard-timeout transition failed for ${sessionId}:`, err);
        });
    }, totalMs);
}

export function clearDSATimers(sessionId: string): void {
    const state = activeSessions.get(sessionId);
    if (!state) return;
    if (state.dsa20Timer) { clearTimeout(state.dsa20Timer); state.dsa20Timer = null; }
    if (state.dsa25Timer) { clearTimeout(state.dsa25Timer); state.dsa25Timer = null; }
    if (state.dsa30Timer) { clearTimeout(state.dsa30Timer); state.dsa30Timer = null; }
}

export async function forceDSATimeoutTransition(
    sessionId: string,
    emit: (event: string, payload: any) => void
): Promise<boolean> {
    const s = activeSessions.get(sessionId);
    if (!s || s.currentStage !== "DSA") return false;

    clearDSATimers(sessionId);
    emit("panel:close", { summary: "Coding round time limit reached." });

    const nextStage = getNextEnabledStage(s.stageOrder, "DSA");

    const toolCtx: ToolContext = {
        sessionId: s.sessionId,
        userId: s.userId,
        interviewType: s.interviewType,
        currentStage: s.currentStage,
        askedQuestionIds: s.askedQuestionIds,
        role: s.role,
        level: s.level,
        stageOrder: s.stageOrder,
        lastFetchedQuestionId: s.lastFetchedQuestionId,
        lastFetchedLanguage: s.lastFetchedLanguage,
        prefetchedDSAQuestion: s.prefetchedDSAQuestion,
        prefetchedBehavioralQuestions: s.prefetchedBehavioralQuestions,
        cachedQuestionData: s.cachedQuestionData,
        scratchpadOpened: s.scratchpadOpened,
        systemDesignExchangeCount: s.systemDesignExchangeCount,
        prefetchedCSQuestions: s.prefetchedCSQuestions,
        prefetchedSDQuestion: s.prefetchedSDQuestion,
        emit,
    };

    if (nextStage) {
        const result = await handleToolCall(
            "transition_stage",
            { nextStage, reason: "DSA 30-minute time limit reached" },
            toolCtx
        );

        if (!result.startsWith("Interview transitioned")) {
            console.warn(`[Orchestrator] DSA hard-timeout transition was not applied for ${sessionId}: ${result}`);
            return false;
        }

        s.currentStage = toolCtx.currentStage;
        s.stageStartedAtMs = Date.now();

        await sendDSAInternalNudge(
            sessionId,
            "[SYSTEM NOTIFICATION] The coding round has ended due to the 30-minute limit. The coding panel has already been closed and the session has already moved forward to the current non-coding stage. Do not continue the coding problem, do not ask DSA follow-ups, and do not refer to DSA as the active phase. Give one brief wrap-up sentence, then continue naturally with the current stage instructions. Do not mention internal stage names.",
            emit
        );
        return true;
    }

    await handleToolCall(
        "end_interview",
        { summary: "DSA 30-minute time limit reached." },
        toolCtx
    );
    return true;
}

// ── Get Session State (for debugging) ────────────────────────

/**
 * Reconstructs sub-stage flags (currentFundamentalsPhase, sqlRoundCompleted, etc.)
 * when a session is resumed from the database.
 */
function reconstructSubStageState(state: SessionState, session: any): void {
    const sessionQuestions = session.sessionQuestions || [];

    // 1. Reconstruct sqlRoundCompleted (affects CS Fundamentals and Data Science Role)
    const sqlQuestionRow = sessionQuestions.find((sq: any) => sq.questionSqlId);
    if (sqlQuestionRow && (sqlQuestionRow.finalCode || (sqlQuestionRow.score && Number(sqlQuestionRow.score) > 0))) {
        state.sqlRoundCompleted = true;
        console.log(`[Orchestrator] Reconstructed sqlRoundCompleted=true for ${state.sessionId}`);
    }

    // 2. Reconstruct CS Fundamentals Phase (DBMS → SQL → OS → CN → OOPS)
    if (state.interviewType === "cs_fundamentals" || state.interviewType === "full_interview") {
        if (state.currentStage === "FUNDAMENTALS") {
            const askedIds = new Set(state.askedQuestionIds);
            const dbmsQs = state.prefetchedCSQuestions?.get("DBMS") || [];
            const allDbmsAsked = dbmsQs.length > 0 && dbmsQs.every(q => askedIds.has(q.questionId));

            if (!allDbmsAsked) {
                state.currentFundamentalsPhase = "DBMS";
            } else if (!state.sqlRoundCompleted) {
                state.currentFundamentalsPhase = "SQL";
            } else {
                // Determine OS vs CN vs OOPS
                const OS_ORDER = ["OS", "CN", "OOPS"];
                let bestPhase = "OS";
                for (const topic of OS_ORDER) {
                    const topicQs = state.prefetchedCSQuestions?.get(topic) || [];
                    const allAsked = topicQs.length > 0 && topicQs.every(q => askedIds.has(q.questionId));
                    if (allAsked) {
                        // If this topic is done, next one is likely active
                        const nextTopic = OS_ORDER[OS_ORDER.indexOf(topic) + 1];
                        if (nextTopic) {
                            bestPhase = nextTopic;
                        } else {
                            bestPhase = topic; // Last topic reached
                        }
                    } else {
                        bestPhase = topic;
                        break;
                    }
                }
                state.currentFundamentalsPhase = bestPhase;
            }
            console.log(`[Orchestrator] Reconstructed CS phase: ${state.currentFundamentalsPhase} for ${state.sessionId}`);
        }
    }

    // 3. Reconstruct PM Role sub-states (if needed)
    // PM roles use separate stages (PM_CASE, PM_STRATEGY, etc.) which are already
    // persisted in the 'stage' column, so no sub-phase reconstruction is typically needed.

    // 4. Reconstruct scratchpad state for System Design
    if (state.currentStage === "SYSTEM_DESIGN") {
        if (state.canvasSnapshot && Object.keys(state.canvasSnapshot).length > 0) {
            state.scratchpadOpened = true;
        }
    }
}

export function getSessionState(sessionId: string): SessionState | undefined {
    return activeSessions.get(sessionId);
}

function getCSTheoryTopics(state: SessionState): string[] {
    const options = state.moduleConfig?.stageOptions?.FUNDAMENTALS || {};
    return (Array.isArray(options.topics)
        ? options.topics
        : [...(state.prefetchedCSQuestions?.keys() || [])].filter((topic) => topic !== "SQL_query")
    ).filter((topic: string) => state.prefetchedCSQuestions?.has(topic));
}

function getCSPhaseOrder(state: SessionState): string[] {
    const options = state.moduleConfig?.stageOptions?.FUNDAMENTALS || {};
    const selectedTopics = getCSTheoryTopics(state);
    return [
        ...selectedTopics.slice(0, 1),
        ...(options.includeSQL === false ? [] : ["SQL"]),
        ...selectedTopics.slice(1),
    ];
}

function getCurrentCSPhase(state: SessionState): string {
    const phaseOrder = getCSPhaseOrder(state);
    if (state.currentFundamentalsPhase === "CLOSING") {
        return "CLOSING";
    }
    return state.currentFundamentalsPhase && phaseOrder.includes(state.currentFundamentalsPhase)
        ? state.currentFundamentalsPhase
        : phaseOrder[0] || "CLOSING";
}

function getNextCSPhase(state: SessionState, currentPhase: string = getCurrentCSPhase(state)): string | null {
    const phaseOrder = getCSPhaseOrder(state);
    const next = phaseOrder[phaseOrder.indexOf(currentPhase) + 1];
    return next || null;
}

// ── Fundamentals Phase Advancement (Text Mode) ──────────────

/**
 * Auto-advances the fundamentals sub-phase for theory categories (OS→CN, CN→OOPS)
 * when all questions in the current phase have been asked (tracked via record_question).
 * DBMS→SQL and SQL→OS transitions are handled elsewhere (SQL editor open/close events).
 */
function advanceFundamentalsPhaseText(state: SessionState): void {
    if (state.currentStage !== "FUNDAMENTALS") return;
    if (!state.prefetchedCSQuestions || state.prefetchedCSQuestions.size === 0) return;

    const currentDynamicPhase = getCurrentCSPhase(state);
    const nextDynamicPhase = getNextCSPhase(state, currentDynamicPhase);
    if (!nextDynamicPhase) return;

    const currentQuestions = state.prefetchedCSQuestions.get(currentDynamicPhase) || [];
    const dynamicAskedIds = new Set(state.askedQuestionIds);
    const allCurrentAsked = currentQuestions.length > 0 && currentQuestions.every(q => dynamicAskedIds.has(q.questionId));
    if (allCurrentAsked) {
        state.currentFundamentalsPhase = nextDynamicPhase;
        console.log(`[Orchestrator] Auto-advanced fundamentals phase: ${currentDynamicPhase} -> ${nextDynamicPhase}`);
    }
    return;

    const THEORY_ADVANCE_ORDER: Record<string, string> = {
        DBMS: "SQL",
        OS: "CN",
        CN: "OOPS",
    };

    const currentPhase = state.currentFundamentalsPhase || "DBMS";
    const nextPhase = THEORY_ADVANCE_ORDER[currentPhase];
    if (!nextPhase) return;

    if (currentPhase === "DBMS") {
        const dbmsQuestions = state.prefetchedCSQuestions.get("DBMS") || [];
        const askedIds = new Set(state.askedQuestionIds);
        const allDbmsAsked = dbmsQuestions.length > 0 && dbmsQuestions.every(q => askedIds.has(q.questionId));
        if (allDbmsAsked && !state.currentFundamentalsPhase) {
            state.currentFundamentalsPhase = "SQL";
            console.log(`[Orchestrator] Auto-advanced fundamentals phase: DBMS → SQL`);
        }
        return;
    }

    const questions = state.prefetchedCSQuestions.get(currentPhase) || [];
    const askedIds = new Set(state.askedQuestionIds);
    const allAsked = questions.length > 0 && questions.every(q => askedIds.has(q.questionId));

    if (allAsked) {
        state.currentFundamentalsPhase = nextPhase;
        console.log(`[Orchestrator] Auto-advanced fundamentals phase: ${currentPhase} → ${nextPhase}`);
    }
}
