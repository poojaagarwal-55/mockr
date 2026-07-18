// ============================================
// Voice Pipeline — Deepgram STT → xAI Grok → xAI TTS
// ============================================
// Modular pipeline: Deepgram Flux for speech recognition,
// xAI Grok 4.20 for the LLM with tool calling,
// xAI TTS (rex voice) for text-to-speech.

import WebSocket from "ws";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { getXAIClient, XAI_MODEL } from "../lib/xai.js";
import { getToolsForSession, type ToolContext } from "./agent/agent-tools.js";
import { handleToolCall } from "./agent/tool-handlers.js";
import { buildServerActionPlan } from "./agent/server-action-planner.js";
import { buildUnavailableToolNotice, splitToolCallsByAvailability } from "./agent/tool-call-sanitizer.js";
import { buildSystemPrompt, buildVoiceContextUpdate, buildVoiceDirectives } from "./agent/agent-prompts.js";
import { getNextEnabledStage, resolveEffectiveInterviewTypeConfig } from "./agent/interview-module-selection.js";
import { buildInterviewOpeningMessage } from "./agent/interview-opening.js";
import {
    buildCompanyScreeningOpeningMessage,
    buildCompanyScreeningRuntimeDirective,
    normalizeCompanyScreeningRuntimeContext,
    type CompanyScreeningRuntimeContext,
    type CompanyScreeningAuthoritativeTurn,
} from "./company-ai-screening/prompt.js";
import { resolveScreeningAuthoritativeTurn, isScreeningSkip, seedScreeningResumeAgenda, extractCandidateProjectFacts, mergeCandidateProjectsIntoResume, extractCandidateProjectVerification, buildResumeVerificationGrounding, buildScreeningPhaseTransitionNotice } from "./company-ai-screening/screening-turn.js";
import type { ResumeAgendaState } from "./agent/interview-runtime-types.js";
import { computeScreeningPlan, createScreeningProgress, type ScreeningPlan, type ScreeningProgress } from "./company-ai-screening/pacing.js";
import { prefetchScreeningPhaseRuntime, buildScreeningPhaseSupplement, type ScreeningPhasePrefetch } from "./company-ai-screening/phase-runtime.js";
import type { ScreeningPhaseType } from "./company-ai-screening/blueprint.js";
import {
    advanceCompanyScreeningMockCursor,
    buildCompanyScreeningMockPrompt,
    deriveCompanyScreeningMockPosition,
    isCompanyScreeningMockInterviewerEnabled,
    type CompanyScreeningMockCursor,
} from "./company-ai-screening/mock-interviewer.js";
import { prefetchCompanyScreeningBankQuestions, bankQuestionIdForScreeningQuestion } from "./company-ai-screening/question-prefetch.js";
import { phaseTypeForQuestionId } from "./company-ai-screening/blueprint.js";
import { buildScreeningTools } from "./company-ai-screening/screening-tools.js";
import { validateVoiceTextCompatibility } from "./agent/voice-text-compat-validator.js";
import { prefetchCSFundamentalsQuestions } from "./agent/cs-prefetch.js";
import { prefetchGenAIQuestions, type GenAIConceptEntry, type GenAICodingEntry, type GenAISystemDesignEntry } from "./agent/genai-prefetch.js";
import { prefetchDSQuestions, type DSConceptEntry, type DSSQLEntry, type DSCodingEntry } from "./agent/ds-prefetch.js";
import { prefetchPMQuestions, type PMCaseEntry, type PMConceptEntry, type PMStrategyEntry } from "./agent/pm-prefetch.js";
import { prefetchProblemSolvingCaseQuestion, type ProblemSolvingCaseEntry } from "./agent/problem-solving-prefetch.js";
import type { SharedInterviewTurnState } from "./agent/interview-runtime-types.js";
import {
    createInitialResumeProbeState,
    inferResumeProbeDepthFromQuestion,
    inferResumeProjectNameFromText,
    markResumeProbeAsked,
} from "./agent/resume-probe-state.js";
import {
    buildResumeAgendaNotice,
    createInitialResumeAgendaState,
    declineActiveResumeAgendaItem,
    getActiveResumeAgendaItem,
    getResumeAgendaItemTurnLimit,
    updateResumeAgendaAfterProbe,
} from "./agent/resume-agenda-state.js";
import {
    buildResumeWebContextNotification,
    prefetchResumeWebContext,
} from "./agent/resume-web-context.js";
import { isClosingAcknowledgement, isCloseoutQuestion, isEndInterviewIntent, isQuestionOfferAffirmation } from "./interview-end-intent.js";
import { isDsaAdvanceIntent } from "./interview-progress-intent.js";
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
} from "./interview-turn-guard.js";
import { prisma } from "../lib/prisma.js";
import { settleInterviewMinuteReservation } from "./entitlements.js";
import { ensureMongoDBConnected } from "../lib/mongoose.js";
import { DSAQuestion } from "../models/DSAQuestion.js";
import { normalizeDSAQuestion } from "../lib/question-helpers.js";
import { sanitizeErrorMessage, STANDARD_ERROR_MESSAGES } from "../lib/user-facing-errors.js";
import type { InterviewStage, InterviewType } from "@interviewforge/shared";
import { MAX_CONTEXT_MESSAGES } from "@interviewforge/shared";
import { findLeastRecentlySeenMongoDoc, findRandomMongoDoc, getSeenQuestionIds, recordQuestionExposure, toMongoObjectIds } from "./question-exposure.js";

// ── Configuration ──────────────────────────────────────────

const DEEPGRAM_STT_URL = "wss://api.deepgram.com/v2/listen";
const STT_MODEL = process.env.DEEPGRAM_STT_MODEL || "flux-general-en";
const STT_HEARTBEAT_MS = 15_000;

// Deepgram Flux v2 Configuration:
// - URL params: Only model, encoding, sample_rate (basic connection params)
// - Configure message: Only thresholds, keyterms, language_hints, profanity_filter
// - language_hints is only sent for Flux models that support it
// - eot_threshold=0.65: Slightly lower for better sensitivity
// - eot_timeout_ms=5500: 5.5s allows thinking pauses without cutting off
// Note: Flux doesn't support punctuate/smart_format in Configure (API limitation)

const XAI_TTS_URL = "https://api.x.ai/v1/tts";
const XAI_TTS_VOICE = "rex"; // Confident, professional voice

function supportsDeepgramLanguageHints(model: string): boolean {
    return model === "flux-general-multi";
}

function getDeepgramApiKey(): string {
    const key = process.env.DEEPGRAM_API_KEY;
    if (!key) throw new Error("DEEPGRAM_API_KEY not configured");
    return key;
}

function getXAIApiKey(): string {
    const key = process.env.XAI_API_KEY;
    if (!key) throw new Error("XAI_API_KEY not configured");
    return key;
}

// ── Interfaces ─────────────────────────────────────────────

export interface VoiceSessionCallbacks {
    onAudio: (base64Audio: string) => void;
    onAiTranscript: (text: string) => void;
    onUserTranscript: (text: string) => void;
    onTurnComplete: () => void;
    onReady: () => void;
    onEnded: (reason: string) => void;
    onError: (message: string) => void;
    emit: (event: string, payload: any) => void;
}

/** Max user exchanges in SYSTEM_DESIGN before we force-open the scratchpad */
const SD_SCRATCHPAD_FORCE_THRESHOLD = 3;

/** Exact user exchanges in INTRO before we force-transition to SYSTEM_DESIGN. */
const SYSTEM_DESIGN_INTRO_FORCE_TRANSITION_THRESHOLD = 3;
const FULL_INTERVIEW_INTRO_FORCE_TRANSITION_THRESHOLD = 7;
const DATA_SCIENCE_INTRO_FORCE_TRANSITION_THRESHOLD = 4;
const GENAI_INTRO_FORCE_TRANSITION_THRESHOLD = 4;
const PM_INTRO_FORCE_TRANSITION_THRESHOLD = 6;

const RESUME_WEB_SEARCH_TYPES = new Set<InterviewType>([
    "full_interview",
    "gen_ai_role",
    "data_science_role",
    "pm_role",
]);

function buildVoiceSystemDesignPanelPayload(session: VoiceSession) {
    const sdQuestion = session.prefetchedSDQuestion;
    const title = sdQuestion?.title || session.currentQuestionTitle || "System Design";
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
                id: `sd_${session.sessionId}`,
                title,
                problemStatement: buildSDProblemStatementFallback(title),
            },
    };
}

function hasDeliveredVoiceSystemDesignIntro(
    history: VoiceSession["history"],
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

async function speakAndPersistSystemDesignIntro(
    session: VoiceSession,
    callbacks: VoiceSessionCallbacks,
    signal: AbortSignal = new AbortController().signal
): Promise<void> {
    if (!session.prefetchedSDQuestion) return;

    const sdTitle = session.prefetchedSDQuestion.title;
    if (!session.scratchpadOpened) {
        callbacks.emit("panel:open", buildVoiceSystemDesignPanelPayload(session));
        session.scratchpadOpened = true;
    }

    const sdIntroContent =
        `Let's design ${sdTitle}. The whiteboard is already open. ` +
        `Go ahead and start sketching your design and walk me through your thinking. ` +
        `Let's begin by discussing the functional and non-functional requirements.`;

    callbacks.onAiTranscript(sdIntroContent);
    try {
        await textToSpeech(sdIntroContent, callbacks, signal);
    } catch (err: any) {
        if (!signal.aborted) console.error("[Voice] SD intro TTS error:", err.message);
    }
    callbacks.onTurnComplete();

    session.history.push({ role: "assistant", content: sdIntroContent });
    await prisma.sessionMessage.create({
        data: {
            sessionId: session.sessionId,
            role: "assistant",
            content: sdIntroContent,
            stage: "SYSTEM_DESIGN",
        },
    });
}

function buildSDProblemStatementFallback(title: string): string {
    const safeTitle = (title || "this system").trim();
    return (
        `Design ${safeTitle}. Define key functional and non-functional requirements, ` +
        "propose a scalable high-level architecture, explain data/storage choices, " +
        "and discuss trade-offs for reliability, consistency, and performance."
    );
}

function buildSDCandidateBrief(title: string): string {
    const safeTitle = (title || "this system").trim();
    return (
        `Design ${safeTitle}. Focus on clear architecture communication and decision-making.`
    );
}

function isHostileOrRepeatedRefusal(text: string): boolean {
    return /\b(fuck|stupid|idiot|dumb|i\s+just\s+told\s+you|already\s+told\s+you|stop\s+asking|move\s+on)\b/i.test(text);
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

const RESUME_ROUND_GOVERNED_STAGES = new Set<InterviewStage>([
    "RESUME_STUDIES",
    "RESUME_PROJECTS",
    "RESUME_EXPERIENCE",
    "RESUME_RESPONSIBILITY",
    "RESUME_SKILLS",
]);

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

function resumeAgendaWeakLimit(session: VoiceSession): number {
    const active = getActiveResumeAgendaItem(session.resumeAgendaState);
    if (!active) return 1;
    if (active.mode === "rapid") return 2;
    if (active.type === "project") return 3;
    return 2;
}

function resumeAgendaIntentForCurrentVoiceItem(session: VoiceSession) {
    const active = getActiveResumeAgendaItem(session.resumeAgendaState);
    if (!active) return "overview";
    return active.askedIntents[active.askedIntents.length - 1] || "overview";
}

function rememberVoiceResumeAgendaAssistantQuestion(
    session: VoiceSession,
    assistantText: string,
    agendaItemIdAtTurnStart?: string
): void {
    if (session.interviewType !== "resume_round" || session.currentStage === "CLOSING") return;
    if (!assistantText.trim()) return;
    const itemId = agendaItemIdAtTurnStart || getActiveResumeAgendaItem(session.resumeAgendaState)?.id;
    if (!itemId) return;
    session.resumeAgendaQuestionCounts[itemId] = (session.resumeAgendaQuestionCounts[itemId] || 0) + 1;
    const active = session.resumeAgendaState?.items.find((item) => item.id === itemId);
    console.log(
        `[Voice][ResumeAgenda] Counted assistant turn session=${session.sessionId.slice(0, 8)}... ` +
        `itemType=${active?.type || "unknown"} mode=${active?.mode || "none"} ` +
        `count=${session.resumeAgendaQuestionCounts[itemId]} limit=${active ? getResumeAgendaItemTurnLimit(active) : "unknown"}`
    );
}

async function forceVoiceResumeAgendaAdvanceAfterAnsweredQuestionBudget(
    session: VoiceSession,
    callbacks: VoiceSessionCallbacks
): Promise<void> {
    if (session.interviewType !== "resume_round" || !RESUME_ROUND_GOVERNED_STAGES.has(session.currentStage)) {
        return;
    }

    const active = getActiveResumeAgendaItem(session.resumeAgendaState);
    if (!active) return;

    const askedCount = session.resumeAgendaQuestionCounts[active.id] || 0;
    if (askedCount < getResumeAgendaItemTurnLimit(active)) return;

    console.log(
        `[Voice][ResumeAgenda] Closing budgeted item session=${session.sessionId.slice(0, 8)}... ` +
        `itemType=${active.type} mode=${active.mode || "none"} count=${askedCount} limit=${getResumeAgendaItemTurnLimit(active)}`
    );

    session.resumeAgendaState = updateResumeAgendaAfterProbe(session.resumeAgendaState, {
        agendaItemId: active.id,
        intent: resumeAgendaIntentForCurrentVoiceItem(session),
        answerQuality: "partial",
        shouldCloseItem: true,
    });

    const nextActive = getActiveResumeAgendaItem(session.resumeAgendaState);
    if (nextActive) {
        session.resumeAgendaWeakAnswerCounts[nextActive.id] = 0;
        session.resumeAgendaQuestionCounts[nextActive.id] ||= 0;
        session.history.push({
            role: "user",
            content:
                buildResumeAgendaNotice(session.resumeAgendaState) +
                " [SYSTEM NOTIFICATION] The previous item reached its server-enforced voice question budget after the candidate answered. Do not ask any follow-up about the previous item.",
        });
        return;
    }

    const toolCtx = buildVoiceToolContext(session, callbacks);
    const transitionResult = await handleToolCall(
        "transition_stage",
        { nextStage: "CLOSING", reason: "Server-owned resume agenda exhausted after hard voice question budgets." },
        toolCtx
    );
    if (transitionResult.startsWith("Interview transitioned")) {
        session.currentStage = "CLOSING";
        toolCtx.currentStage = "CLOSING";
        session.history.push({
            role: "user",
            content:
                "[SYSTEM NOTIFICATION] Resume agenda is exhausted. Ask one brief closeout question now and wait for the candidate's response. If the candidate asks a question, answer it briefly and wait again. Do not call end_interview until the candidate gives a clear closing acknowledgement.",
        });
    }
}

function resumeNonAnswerLimit(stage: InterviewStage): number {
    if (stage === "RESUME_STUDIES") return 1;
    if (stage === "RESUME_RESPONSIBILITY") return 2;
    if (stage === "RESUME_SKILLS") return 2;
    if (stage === "RESUME_EXPERIENCE") return 1;
    if (stage === "RESUME_PROJECTS") return 2;
    return 2;
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

function rememberResumeProbeQuestionFromAssistant(session: VoiceSession, assistantText: string): void {
    if (session.currentStage !== "INTRO" || !RESUME_WEB_SEARCH_TYPES.has(session.interviewType) || !assistantText.trim()) {
        return;
    }
    const depth = inferResumeProbeDepthFromQuestion(assistantText);
    if (!depth) return;

    const projectName =
        inferResumeProjectNameFromText(assistantText, session.resumeSummary) ||
        session.resumeProbeState?.activeProjectName;
    session.resumeProbeState = markResumeProbeAsked(session.resumeProbeState, projectName, depth);
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

function hasFinalClosingLanguage(text: string): boolean {
    if (!text.trim()) return false;
    return /\b(that'?s\s+(it|all)\s+for\s+today|that\s+is\s+(it|all)\s+for\s+today|this\s+concludes\s+(our\s+)?interview|that\s+concludes\s+(our\s+)?interview|the\s+interview\s+is\s+now\s+complete|interview\s+complete|we'?re\s+done|we\s+are\s+done|we\s+have\s+reached\s+the\s+end|end\s+of\s+the\s+interview|thanks\s+for\s+your\s+time|thank\s+you\s+for\s+your\s+time|thanks\s+for\s+joining|thank\s+you\s+for\s+joining|goodbye|we\s+can\s+conclude)\b/i.test(text);
}

function hasGenAICodingHandoffLanguage(text: string): boolean {
    if (!text.trim()) return false;
    return /\b(move|moving|shift|switch|go|let'?s|we'?ll|we\s+will|next)\b[\s\S]{0,100}\b(coding|code|programming|implementation|editor|ide|task|problem)\b/i.test(text);
}

function hasPMConceptHandoffLanguage(text: string): boolean {
    if (!text.trim()) return false;
    return /\b(move|moving|shift|switch|go|let'?s|we'?ll|we\s+will|next|now)\b[\s\S]{0,140}\b(product\s+concepts?|pm\s+concepts?|conceptual\s+questions?|concept\s+questions?|metrics\s+questions?|prioritization\s+questions?|experiment\s+questions?)\b/i.test(text);
}

function buildVoiceToolContext(session: VoiceSession, callbacks: VoiceSessionCallbacks): ToolContext {
    return {
        sessionId: session.sessionId,
        userId: session.userId,
        interviewType: session.interviewType,
        currentStage: session.currentStage,
        askedQuestionIds: session.askedQuestionIds,
        role: session.role,
        level: session.level,
        stageOrder: session.stageOrder,
        lastFetchedQuestionId: session.lastFetchedQuestionId,
        lastFetchedLanguage: session.lastFetchedLanguage,
        prefetchedDSAQuestion: session.prefetchedDSAQuestion ?? null,
        prefetchedBehavioralQuestions: session.prefetchedBehavioralQuestions,
        prefetchedCSQuestions: session.prefetchedCSQuestions,
        prefetchedSDQuestion: session.prefetchedSDQuestion ?? null,
        prefetchedGenAIConceptQuestions: session.prefetchedGenAIConceptQuestions,
        prefetchedGenAICodingQuestion: session.prefetchedGenAICodingQuestion ?? null,
        prefetchedGenAISystemDesignQuestion: session.prefetchedGenAISystemDesignQuestion ?? null,
        // ── Data Science Role prefetch fields ──────────────────────────────
        prefetchedDSConceptQuestions: session.prefetchedDSConceptQuestions,
        prefetchedDSSQLQuestion: session.prefetchedDSSQLQuestion ?? null,
        prefetchedDSCodingQuestion: session.prefetchedDSCodingQuestion ?? null,
        prefetchedPMCaseQuestion: session.prefetchedPMCaseQuestion ?? null,
        prefetchedPMConceptQuestions: session.prefetchedPMConceptQuestions,
        prefetchedPMStrategyQuestion: session.prefetchedPMStrategyQuestion ?? null,
        prefetchedProblemSolvingCaseQuestion: session.prefetchedProblemSolvingCaseQuestion ?? null,
        resumeProbeState: session.resumeProbeState,
        resumeAgendaState: session.resumeAgendaState,
        onResumeProbeRecorded: (resumeProbeState) => {
            session.resumeProbeState = resumeProbeState;
        },
        onResumeAgendaRecorded: (resumeAgendaState) => {
            session.resumeAgendaState = resumeAgendaState;
        },
        resumeCloseoutAcknowledged: session.resumeCloseoutAcknowledged,
        cachedQuestionData: session.cachedQuestionData ?? new Map(),
        onRubricLiteLoaded: (rubricLite: any) => {
            session.rubricLite = rubricLite;
        },
        onSQLEditorOpened: () => startVoiceSQLPhaseTimers(session),
        onSQLPanelClosed: () => {
            clearVoiceSQLTimers(session);
            session.sqlSnapshot = null;
            session.sqlQuestionDescription = null;
        },
        onDSAEditorOpened: () => startVoiceDSAPhaseTimers(session),
        onDSAPanelClosed: () => clearVoiceDSATimers(session),
        onProblemSolvingNotepadOpened: () => {
            session.problemSolvingNotepadOpened = true;
        },
        scratchpadOpened: session.scratchpadOpened,
        systemDesignExchangeCount: session.systemDesignExchangeCount,
        introExchangeCount: session.introExchangeCount,
        companyScreeningBlueprint: session.companyScreening?.blueprintSnapshot ?? null,
        companyScreeningCurrentQuestionId: session.companyScreeningCurrentQuestionId ?? null,
        // Voice path has no server enforcement loop yet; derive the phase type from
        // the current question id so the phase-scoped tool whitelist still applies.
        companyScreeningCurrentPhaseType: phaseTypeForQuestionId(
            session.companyScreening?.blueprintSnapshot,
            session.companyScreeningCurrentQuestionId
        ),
        onScreeningQuestionAsked: (screeningQuestionId: string, bankQuestionId?: string | null) => {
            session.companyScreeningCurrentQuestionId = screeningQuestionId;
            if (!session.companyScreeningAskedQuestionIds) session.companyScreeningAskedQuestionIds = new Set();
            session.companyScreeningAskedQuestionIds.add(screeningQuestionId);
            if (bankQuestionId) session.lastFetchedQuestionId = bankQuestionId;
        },
        emit: callbacks.emit,
    };
}

async function forceVoiceResumeStageTransitionAfterNonAnswers(
    session: VoiceSession,
    userText: string,
    callbacks: VoiceSessionCallbacks
): Promise<void> {
    if (session.interviewType !== "resume_round" || !RESUME_ROUND_GOVERNED_STAGES.has(session.currentStage)) {
        return;
    }
    if (!isWeakResumeAgendaAnswer(userText)) {
        session.resumeStageNonAnswerCounts[session.currentStage] = 0;
        return;
    }

    const active = getActiveResumeAgendaItem(session.resumeAgendaState);
    if (active) {
        const shouldCloseImmediately =
            isExplicitResumeItemDecline(userText) ||
            (active.mode === "rapid" && /^(?:no|nope|nah|skip|pass|move on|next)$/i.test(userText.trim())) ||
            (active.type !== "project" && /^(?:no|nope|nah|skip|pass|move on|next|no idea|not sure|not really)$/i.test(userText.trim()));
        const nextWeakCount = shouldCloseImmediately
            ? resumeAgendaWeakLimit(session)
            : (session.resumeAgendaWeakAnswerCounts[active.id] || 0) + 1;
        session.resumeAgendaWeakAnswerCounts[active.id] = nextWeakCount;

        if (nextWeakCount < resumeAgendaWeakLimit(session)) {
            return;
        }

        session.resumeAgendaState = updateResumeAgendaAfterProbe(session.resumeAgendaState, {
            agendaItemId: active.id,
            intent: active.askedIntents[active.askedIntents.length - 1] || "overview",
            answerQuality: shouldCloseImmediately ? "declined" : "weak",
            shouldCloseItem: true,
        });
        const nextActive = getActiveResumeAgendaItem(session.resumeAgendaState);
        if (nextActive) {
            session.resumeAgendaWeakAnswerCounts[nextActive.id] = 0;
            session.history.push({
                role: "user",
                content: buildResumeAgendaNotice(session.resumeAgendaState),
            });
            return;
        }
        const toolCtx = buildVoiceToolContext(session, callbacks);
        const transitionResult = await handleToolCall(
            "transition_stage",
            { nextStage: "CLOSING", reason: "Server-owned resume agenda exhausted after weak or declined answers." },
            toolCtx
        );
        if (transitionResult.startsWith("Interview transitioned")) {
            session.currentStage = "CLOSING";
            toolCtx.currentStage = "CLOSING";
            session.history.push({
                role: "user",
                content: buildResumeAgendaNotice(session.resumeAgendaState),
            });
        }
        return;
    }

    const currentStage = session.currentStage;
    const nextCount = (session.resumeStageNonAnswerCounts[currentStage] || 0) + 1;
    session.resumeStageNonAnswerCounts[currentStage] = nextCount;
    if (nextCount < resumeNonAnswerLimit(currentStage)) return;

    if (!session.resumeDeclinedStages.includes(currentStage)) {
        session.resumeDeclinedStages.push(currentStage);
    }
    session.resumeAgendaState = declineActiveResumeAgendaItem(session.resumeAgendaState);

    const nextStage = getNextEnabledStage(session.stageOrder, currentStage);
    if (!nextStage) return;

    const toolCtx = buildVoiceToolContext(session, callbacks);
    const transitionResult = await handleToolCall(
        "transition_stage",
        { nextStage, reason: `Candidate declined ${currentStage}; server advanced resume screening flow.` },
        toolCtx
    );
    if (!transitionResult.startsWith("Interview transitioned")) return;

    session.currentStage = nextStage;
    toolCtx.currentStage = nextStage;
    session.resumeStageNonAnswerCounts[nextStage] = 0;
    session.history.push({
        role: "user",
        content: buildResumeAgendaNotice(session.resumeAgendaState),
    });
}

async function forceVoiceResumeOpeningCalibrationTransition(
    session: VoiceSession,
    userText: string,
    callbacks: VoiceSessionCallbacks
): Promise<boolean> {
    if (
        session.interviewType !== "resume_round" ||
        session.currentStage !== "RESUME_STUDIES" ||
        !userText.trim() ||
        userText.trim().toLowerCase().startsWith("[system notification]")
    ) {
        return false;
    }

    const nextStage = getNextEnabledStage(session.stageOrder, "RESUME_STUDIES");
    if (!nextStage) return false;

    const toolCtx = buildVoiceToolContext(session, callbacks);
    const transitionResult = await handleToolCall(
        "transition_stage",
        { nextStage, reason: "Resume opening calibration received one candidate answer; server advanced to the next resume section." },
        toolCtx
    );
    if (!transitionResult.startsWith("Interview transitioned")) return false;

    session.currentStage = nextStage;
    toolCtx.currentStage = nextStage;
    session.resumeStageNonAnswerCounts[nextStage] = 0;
    session.history.push({
        role: "user",
        content: buildResumeAgendaNotice(session.resumeAgendaState),
    });
    return true;
}

interface VoiceSession extends SharedInterviewTurnState {
    sttSocket: WebSocket | null;
    sessionId: string;
    userId: string;
    interviewType: InterviewType;
    currentStage: InterviewStage;
    stageOrder: InterviewStage[];
    askedQuestionIds: string[];
    role: string;
    level: string;
    currentQuestionTitle: string | null;
    lastFetchedQuestionId: string | null;
    lastFetchedLanguage: string | null;
    prefetchedDSAQuestion: any | null;
    cachedQuestionData: Map<string, any>;
    codeSnapshot: string | null;
    codeLanguage: string | null;
    sqlSnapshot: string | null;
    /** Full problem description of the active SQL question (keeps AI grounded after context rollover) */
    sqlQuestionDescription: string | null;
    /** True when the SQL round has been intentionally completed or skipped */
    sqlRoundCompleted?: boolean;
    /** System design: rubricLite from MongoDB question */
    rubricLite: any | null;
    /** System design: latest Excalidraw canvas JSON */
    canvasSnapshot: any | null;
    /** PM case: latest Tiptap notepad HTML snapshot */
    notepadSnapshot: string | null;
    resumeSummary: any | null;
    /** Pre-fetched trusted web context for resume projects, technologies, domains, and companies. */
    resumeWebSearchContext: string | null;
    /** True once resumeWebSearchContext has been injected into history */
    resumeWebSearchInjected: boolean;
    resumeStageNonAnswerCounts: Partial<Record<InterviewStage, number>>;
    resumeDeclinedStages: InterviewStage[];
    resumeAgendaWeakAnswerCounts: Record<string, number>;
    resumeAgendaQuestionCounts: Record<string, number>;
    resumeCloseoutAcknowledged: boolean;
    history: ChatCompletionMessageParam[];
    isGenerating: boolean;
    abortController: AbortController | null;
    userTranscriptBuffer: string;
    isMuted: boolean;
    muteTimer: ReturnType<typeof setTimeout> | null;
    callbacks: VoiceSessionCallbacks;
    /** Counts user exchanges in the SYSTEM_DESIGN stage (reset on stage change) */
    systemDesignExchangeCount: number;
    /** Whether the scratchpad has been opened in this session */
    scratchpadOpened: boolean;
    /** Counts user exchanges in the INTRO stage */
    introExchangeCount: number;
    /** Counts skipped/refused answers only after BEHAVIOURAL stage has actually started */
    behaviouralStageNonAnswerCount: number;
    /** Timer: fires at 5 min — approach reminder if candidate hasn't articulated an approach */
    sqlApproachTimer: ReturnType<typeof setTimeout> | null;
    /** Timer: fires at 10 min — query reminder if candidate hasn't written any SQL yet */
    sqlQueryTimer: ReturnType<typeof setTimeout> | null;
    /** Timer: fires after 15 min total in SQL round — forces stage move */
    sqlTotalTimer: ReturnType<typeof setTimeout> | null;
    /** Timer: fires at 20 min in DSA round — pacing reminder */
    dsa20Timer: ReturnType<typeof setTimeout> | null;
    /** Timer: fires at 25 min in DSA round — final warning */
    dsa25Timer: ReturnType<typeof setTimeout> | null;
    /** Timer: fires at 30 min in DSA round — hard timeout */
    dsa30Timer: ReturnType<typeof setTimeout> | null;
    /** Whether the SQL editor is currently open (used for auto-close detection) */
    sqlEditorOpened?: boolean;
    /** Whether the DSA IDE is currently open (used for auto-close detection on stage transition) */
    ideOpened?: boolean;
    /** Pre-fetched CS Fundamentals questions (DBMS, OS, CN, OOPS, SQL_query) */
    prefetchedCSQuestions?: Map<string, Array<{ questionId: string; questionText: string; referenceAnswer: string }>>;
    /** Pre-fetched SQL question object */
    prefetchedSQLQuestion?: any;
    /** Pre-fetched behavioural question bank */
    prefetchedBehavioralQuestions?: Array<{ questionId: string; questionText: string; referenceAnswer: string; category: string }>;
    /** Pre-fetched System Design question (title + problemStatement for prompt injection) */
    prefetchedSDQuestion?: { id: string; title: string; problemStatement: string } | null;
    /** Pre-fetched GenAI concept questions (for gen_ai_role GEN_AI_CONCEPTS stage) */
    prefetchedGenAIConceptQuestions?: GenAIConceptEntry[];
    /** Pre-fetched GenAI coding task (for gen_ai_role GEN_AI_CODING stage) */
    prefetchedGenAICodingQuestion?: GenAICodingEntry | null;
    /** Pre-fetched GenAI system design problem (for gen_ai_role GEN_AI_SYSTEM_DESIGN stage) */
    prefetchedGenAISystemDesignQuestion?: GenAISystemDesignEntry | null;
    /** Pre-fetched DS concept questions (for data_science_role DS_CONCEPTS stage) */
    prefetchedDSConceptQuestions?: DSConceptEntry[];
    /** Pre-fetched DS SQL question (for data_science_role DS_SQL stage) */
    prefetchedDSSQLQuestion?: DSSQLEntry | null;
    /** Pre-fetched DS coding task (for data_science_role DS_CODING stage) */
    prefetchedDSCodingQuestion?: DSCodingEntry | null;
    /** Pre-fetched PM case scenario (for pm_role PM_CASE stage) */
    prefetchedPMCaseQuestion?: PMCaseEntry | null;
    /** Pre-fetched PM concept questions (for pm_role PM_CONCEPTS stage) */
    prefetchedPMConceptQuestions?: PMConceptEntry[];
    /** Pre-fetched PM strategy scenario (for pm_role PM_STRATEGY stage) */
    prefetchedPMStrategyQuestion?: PMStrategyEntry | null;
    /** Pre-fetched analytical case (for problem_solving_case) */
    prefetchedProblemSolvingCaseQuestion?: ProblemSolvingCaseEntry | null;
    /** Whether the problem-solving notepad has been opened in this session */
    problemSolvingNotepadOpened: boolean;
    currentDSConceptQuestionId?: string | null;
    dsConceptFollowupCount?: number;
    currentPMConceptQuestionId?: string | null;
    pmConceptFollowupCount?: number;
    /** Audio packets captured while STT socket is not yet open (startup/reconnect smoothing). */
    pendingAudioPackets: Buffer[];
    /** Push-to-talk: whether PTT mode is enabled for this session */
    isPTTActive: boolean;
    /** Push-to-talk: whether the user is currently holding the spacebar */
    isPTTHolding: boolean;
    /** Push-to-talk: buffered transcript segments while spacebar is held */
    pttTranscriptBuffer: string[];
    /** Push-to-talk: true after spacebar released, waiting for final EndOfTurn before flushing */
    pttPendingFlush: boolean;
    /** Push-to-talk: safety timer — flushes buffer if no EndOfTurn arrives after release */
    pttFlushTimer: ReturnType<typeof setTimeout> | null;
    /** Wall-clock start of the interview session; used for live screening pacing. */
    startedAt?: Date | string;
    companyScreening?: CompanyScreeningRuntimeContext | null;
    companyScreeningMockCursor?: CompanyScreeningMockCursor | null;
    companyScreeningMockWaitingForAnswer?: boolean;
    companyScreeningMockCompleted?: boolean;
    /** Blueprint question ids the screening interviewer has reached (Section 0 tagging + pacing). */
    companyScreeningAskedQuestionIds?: Set<string>;
    /** Blueprint question currently being asked; tags persisted turn messages. */
    companyScreeningCurrentQuestionId?: string | null;
    // ── Server-authoritative pacing pointer (voice parity with the text path). ──
    /** Static budget plan (lazy-inited once from the blueprint). */
    companyScreeningPlan?: ScreeningPlan | null;
    /** Live pacing progress (answered set, follow-ups, current pointer). */
    companyScreeningProgress?: ScreeningProgress | null;
    /** Server-owned resume agenda driving the resume phase (null when no parsed resume). */
    companyScreeningResumeAgenda?: ResumeAgendaState | null;
    /** Evaluation-only GitHub verification grounding, injected ONLY into the resume phase. */
    companyScreeningGithubVerification?: string | null;
    /** The phase type the server currently has the interview on (drives per-phase behaviour + panel close). */
    companyScreeningCurrentPhaseType?: ScreeningPhaseType | null;
    /** The server-resolved command for this turn (fed to the runtime directive). */
    companyScreeningAuthoritativeTurn?: CompanyScreeningAuthoritativeTurn | null;
    /** Sticky: server-forced closing has started. */
    companyScreeningClosingForced?: boolean;
    /** Sticky: the "any questions about the company/role?" offer turn already happened. */
    companyScreeningClosingQuestionOffered?: boolean;
    /** Role-phase questions loaded in the practice shape (ds/genai/pm/problem-solving/concepts). */
    companyScreeningPhasePrefetch?: ScreeningPhasePrefetch | null;
    /** Phase types whose panel has already been server-opened this session (open-once guard). */
    companyScreeningOpenedPhasePanels?: Set<string>;
}

const activeSessions = new Map<string, VoiceSession>();
const pendingPTTModes = new Map<string, boolean>(); // Store PTT mode for sessions not yet created
const MAX_PENDING_STT_AUDIO_PACKETS = 160;

function hasInterviewDialogue(history: VoiceSession["history"]): boolean {
    return history.some((msg) => msg.role === "user" || msg.role === "assistant");
}

function buildVoiceOpeningMessage(session: VoiceSession): string {
    return session.companyScreening
        ? buildCompanyScreeningOpeningMessage(session.companyScreening, session.role)
        : buildInterviewOpeningMessage({
            interviewType: session.interviewType,
            role: session.role,
            level: session.level,
            stageOrder: session.stageOrder,
            moduleConfig: session.moduleConfig,
        });
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

function isThinkingTimeRequest(text: string): boolean {
    return /\b(give me|need|can i have|let me take|wait|hold on)\b.{0,30}\b(minute|minutes|second|seconds|think|time)\b/i.test(text);
}

async function speakAndPersist(
    session: VoiceSession,
    content: string,
    stage: InterviewStage,
    callbacks: VoiceSessionCallbacks
): Promise<void> {
    const spokenContent = sanitizeSpokenInterviewText(content);
    const ownsGenerationState = !session.isGenerating;
    let ownedAbortController: AbortController | null = null;
    if (ownsGenerationState) {
        session.isGenerating = true;
        ownedAbortController = new AbortController();
        session.abortController = ownedAbortController;
    }
    const signal = session.abortController?.signal ?? new AbortController().signal;
    callbacks.onAiTranscript(spokenContent);
    try {
        await textToSpeech(spokenContent, callbacks, signal);
    } catch (err: any) {
        if (!signal.aborted) {
            console.error(`[Voice] TTS error for ${stage}:`, err?.message || err);
        }
    }
    if (!signal.aborted) {
        callbacks.onTurnComplete();
    }
    if (ownsGenerationState && session.abortController === ownedAbortController) {
        session.isGenerating = false;
        session.abortController = null;
    }
    session.history.push({ role: "assistant", content: spokenContent });
    await prisma.sessionMessage.create({
        data: { sessionId: session.sessionId, role: "assistant", content: spokenContent, stage, ...companyScreeningMsgMeta(session) },
    });
}

/** Tags a persisted turn message with the current screening question id (Section 0). */
function companyScreeningMsgMeta(session: VoiceSession): { metadata?: any } {
    return session.companyScreening && session.companyScreeningCurrentQuestionId
        ? { metadata: { companyScreeningQuestionId: session.companyScreeningCurrentQuestionId } }
        : {};
}

async function speakAndPersistMockTextOnly(
    session: VoiceSession,
    content: string,
    stage: InterviewStage,
    callbacks: VoiceSessionCallbacks,
    metadata?: Record<string, any>
): Promise<void> {
    const spokenContent = sanitizeSpokenInterviewText(content);
    callbacks.onAiTranscript(spokenContent);
    callbacks.onTurnComplete();
    session.history.push({ role: "assistant", content: spokenContent });
    await prisma.sessionMessage.create({
        data: {
            sessionId: session.sessionId,
            role: "assistant",
            content: spokenContent,
            stage,
            ...(metadata ? { metadata } : {}),
        },
    });
}

async function completeCompanyScreeningMockVoiceSession(
    session: VoiceSession,
    callbacks: VoiceSessionCallbacks
): Promise<void> {
    if (session.companyScreeningMockCompleted) return;
    session.companyScreeningMockCompleted = true;
    session.currentStage = "CLOSING";
    callbacks.emit("stage:change", {
        stage: "CLOSING",
        reason: "Company screening mock interviewer completed the configured blueprint.",
    });
    await prisma.interviewSession.update({
        where: { id: session.sessionId },
        data: { status: "COMPLETED", completedAt: new Date(), stage: "CLOSING" },
        select: { id: true },
    });
    await speakAndPersistMockTextOnly(
        session,
        "Thank you. That covers the configured screening questions. We will submit your screening now.",
        "CLOSING",
        callbacks,
        { companyScreeningMockComplete: { version: 1 } }
    );
    callbacks.emit("session:ending", {
        message: "Interview complete. Submitting your screening...",
    });
}

async function processCompanyScreeningMockVoiceTurn(
    session: VoiceSession,
    callbacks: VoiceSessionCallbacks,
    userText: string | null
): Promise<boolean> {
    if (!session.companyScreening || !isCompanyScreeningMockInterviewerEnabled()) {
        return false;
    }

    const latestMockAnswer = userText?.trim() || null;
    if (latestMockAnswer && session.companyScreeningMockWaitingForAnswer && session.companyScreeningMockCursor) {
        session.companyScreeningMockCursor = advanceCompanyScreeningMockCursor(
            session.companyScreening.blueprintSnapshot,
            session.companyScreeningMockCursor,
            latestMockAnswer
        );
        session.companyScreeningMockWaitingForAnswer = false;
    }

    if (!session.companyScreeningMockCursor) {
        await completeCompanyScreeningMockVoiceSession(session, callbacks);
        return true;
    }

    if (session.companyScreeningMockWaitingForAnswer) {
        return true;
    }

    const prompt = buildCompanyScreeningMockPrompt(
        session.companyScreening.blueprintSnapshot,
        session.companyScreeningMockCursor,
        latestMockAnswer
    );
    if (!prompt) {
        session.companyScreeningMockCursor = null;
        await completeCompanyScreeningMockVoiceSession(session, callbacks);
        return true;
    }

    await speakAndPersistMockTextOnly(
        session,
        prompt.content,
        session.currentStage,
        callbacks,
        { companyScreeningMockPrompt: prompt.metadata }
    );
    session.companyScreeningMockWaitingForAnswer = true;
    return true;
}

function buildVoicePinnedDsaIntro(question: { title?: string } | null | undefined): string {
    const title = question?.title || "the coding problem";
    return `The coding problem is "${title}". Before you start coding, walk me through your initial approach and the data structures you would consider.`;
}

function describeVoiceSqlQuestion(sqlQuestion: any): string {
    const title = String(sqlQuestion?.title || "the SQL problem").trim();
    const description = String(sqlQuestion?.description || sqlQuestion?.problemDescription || "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const shortDescription = description.length > 220 ? `${description.slice(0, 220)}...` : description;
    return shortDescription
        ? `I've loaded "${title}" in the SQL editor. The task is: ${shortDescription} Walk me through your approach.`
        : `I've loaded "${title}" in the SQL editor. Walk me through your approach.`;
}

async function transitionVoiceSessionToNextStage(
    session: VoiceSession,
    callbacks: VoiceSessionCallbacks,
    reason: string,
    options?: { forceIntroExit?: boolean }
): Promise<InterviewStage | null> {
    const nextStage = getNextEnabledStage(session.stageOrder, session.currentStage);
    if (!nextStage) return null;

    const toolCtx = buildVoiceToolContext(session, callbacks);
    if (options?.forceIntroExit) {
        toolCtx.forceIntroExit = true;
    }
    const transitionResult = await handleToolCall(
        "transition_stage",
        { nextStage, reason },
        toolCtx
    );

    if (!transitionResult.startsWith("Interview transitioned")) return null;

    session.currentStage = nextStage;
    toolCtx.currentStage = nextStage;
    return nextStage;
}

async function recordVoiceQuestion(
    session: VoiceSession,
    questionFundamentalId: string,
    questionTitle: string,
    questionCategory: string,
    questionDifficulty?: string | null,
    sampleAnswer?: string | null
): Promise<void> {
    const existing = await prisma.sessionQuestion.findFirst({
        where: { sessionId: session.sessionId, questionFundamentalId },
        select: { id: true },
    });
    if (!existing) {
        await prisma.sessionQuestion.create({
            data: {
                sessionId: session.sessionId,
                questionFundamentalId,
                questionTitle: questionTitle.slice(0, 500),
                questionCategory,
                questionDifficulty: questionDifficulty || null,
                sampleAnswer: sampleAnswer || null,
            },
        });
    } else if (questionCategory === "pm_case" || questionCategory === "pm_strategy") {
        await prisma.sessionQuestion.update({
            where: { id: existing.id },
            data: {
                questionTitle: questionTitle.slice(0, 500),
                questionCategory,
                questionDifficulty: questionDifficulty || null,
                sampleAnswer: sampleAnswer || null,
            },
        });
    }
    if (!session.askedQuestionIds.includes(questionFundamentalId)) {
        session.askedQuestionIds.push(questionFundamentalId);
    }
}

async function speakPMCase(session: VoiceSession, callbacks: VoiceSessionCallbacks, openPanel = true): Promise<boolean> {
    const q = session.prefetchedPMCaseQuestion;
    if (!q) return false;
    if (openPanel) {
        const toolCtx = buildVoiceToolContext(session, callbacks);
        toolCtx.currentStage = "PM_CASE";
        await handleToolCall("open_notepad", { topic: q.title || "Product Case", template: "CIRCLES", scenario: q.scenario }, toolCtx);
        session.scratchpadOpened = true;
    }
    await recordVoiceQuestion(session, q.questionId, q.scenario || q.title, "pm_case", q.difficulty, q.evaluationGuide);
    const content =
        `We'll now move to a case study. ${q.scenario} ` +
        `Use the notepad to jot down your thoughts and frame your answer using the CIRCLES framework. ` +
        `Start by clarifying the problem, then walk me through your structure.`;
    await speakAndPersist(session, content, "PM_CASE", callbacks);
    session.history.push({
        role: "user",
        content:
            `[SYSTEM NOTIFICATION] PM case DB scenario is active: ID=${q.questionId}, title="${q.title}". ` +
            "Use ONLY this case scenario. Do NOT invent a different product case.",
    });
    return true;
}

async function speakProblemSolvingCase(session: VoiceSession, callbacks: VoiceSessionCallbacks): Promise<boolean> {
    const q = session.prefetchedProblemSolvingCaseQuestion;
    if (!q) return false;

    if (!session.problemSolvingNotepadOpened) {
        const toolCtx = buildVoiceToolContext(session, callbacks);
        toolCtx.currentStage = "PROBLEM_SOLVING";
        await handleToolCall(
            "open_notepad",
            { topic: q.title || "Problem-Solving Case", template: "blank", scenario: q.prompt },
            toolCtx
        );
        session.problemSolvingNotepadOpened = true;
    }

    await recordVoiceQuestion(
        session,
        q.questionId,
        q.title || q.prompt,
        "problem_solving_case",
        q.difficulty,
        q.referenceSolution
    );

    const content =
        `${q.prompt} I've opened the notepad in case you want to structure your thoughts there. ` +
        "You can also simply talk through your reasoning. Please restate the goal in your own words, list your assumptions about the setup, and then share your initial approach.";

    await speakAndPersist(session, content, "PROBLEM_SOLVING", callbacks);
    session.history.push({
        role: "user",
        content:
            `[SYSTEM NOTIFICATION] Problem-solving case is active: ID=${q.questionId}, title="${q.title}". ` +
            "The notepad is already open. Use ONLY this assigned case and its provided prompts, hints, twist, and conviction probes.",
    });
    return true;
}

async function askNextPMConcept(session: VoiceSession, callbacks: VoiceSessionCallbacks): Promise<boolean> {
    const questions = session.prefetchedPMConceptQuestions || [];
    const next = questions.find((q) => !session.askedQuestionIds.includes(q.questionId));
    if (!next) return false;
    await recordVoiceQuestion(session, next.questionId, next.question, "pm_concepts", next.difficulty, next.evaluationGuide);
    session.currentPMConceptQuestionId = next.questionId;
    session.pmConceptFollowupCount = 0;
    await speakAndPersist(session, next.question, "PM_CONCEPTS", callbacks);
    session.history.push({
        role: "user",
        content:
            `[SYSTEM NOTIFICATION] You asked PM concept DB question ID=${next.questionId}. ` +
            `Question text: "${next.question}". Continue with ONLY remaining PM concept bank questions.`,
    });
    return true;
}

async function speakPMStrategy(session: VoiceSession, callbacks: VoiceSessionCallbacks): Promise<boolean> {
    const q = session.prefetchedPMStrategyQuestion;
    if (!q) return false;
    await recordVoiceQuestion(session, q.questionId, q.scenario || q.title, "pm_strategy", q.difficulty, q.evaluationGuide);
    const content = `Let's shift to product strategy. ${q.scenario} Walk me through how you'd think about this.`;
    await speakAndPersist(session, content, "PM_STRATEGY", callbacks);
    session.history.push({
        role: "user",
        content:
            `[SYSTEM NOTIFICATION] PM strategy DB scenario is active: ID=${q.questionId}, title="${q.title}". ` +
            "Use ONLY this strategy scenario and its devil's-advocate probes. Do NOT invent any product strategy scenario.",
    });
    return true;
}

async function askNextDSConcept(session: VoiceSession, callbacks: VoiceSessionCallbacks): Promise<boolean> {
    const questions = session.prefetchedDSConceptQuestions || [];
    const next = questions.find((q) => !session.askedQuestionIds.includes(q.questionId));
    if (!next) return false;
    await recordVoiceQuestion(session, next.questionId, next.question, "ds_concepts", next.difficulty, next.referenceAnswer);
    session.currentDSConceptQuestionId = next.questionId;
    session.dsConceptFollowupCount = 0;
    await speakAndPersist(session, next.question, "DS_CONCEPTS", callbacks);
    session.history.push({
        role: "user",
        content:
            `[SYSTEM NOTIFICATION] You asked DS concept DB question ID=${next.questionId}. ` +
            `Question text: "${next.question}". Continue with ONLY remaining DS concept bank questions.`,
    });
    return true;
}

async function askNextGenAIConcept(session: VoiceSession, callbacks: VoiceSessionCallbacks): Promise<boolean> {
    const questions = session.prefetchedGenAIConceptQuestions || [];
    const next = questions.find((q) => !session.askedQuestionIds.includes(q.questionId));
    if (!next) return false;
    await recordVoiceQuestion(session, next.questionId, next.questionText, "genai_concepts", next.difficulty, next.referenceAnswer);
    const alreadyAskedConcepts = questions.some((q) => q.questionId !== next.questionId && session.askedQuestionIds.includes(q.questionId));
    const content = alreadyAskedConcepts
        ? next.questionText
        : `Let's shift to some core GenAI concepts. ${next.questionText}`;
    await speakAndPersist(session, content, "GEN_AI_CONCEPTS", callbacks);
    session.history.push({
        role: "user",
        content:
            `[SYSTEM NOTIFICATION] You asked GenAI concept DB question ID=${next.questionId}. ` +
            `Question text: "${next.questionText}". ` +
            "Evaluate the candidate's next answer silently. Ask at most one concise follow-up when useful, then continue with ONLY the remaining DB questions from the concept bank.",
    });
    return true;
}

async function speakDSSQLIntro(session: VoiceSession, callbacks: VoiceSessionCallbacks): Promise<boolean> {
    const sqlTask = session.prefetchedDSSQLQuestion;
    if (!sqlTask) return false;
    const toolCtx = buildVoiceToolContext(session, callbacks);
    toolCtx.currentStage = "DS_SQL";
    await handleToolCall("open_sql_editor", {} as any, toolCtx);
    session.sqlEditorOpened = true;
    session.currentQuestionTitle = sqlTask.title;
    session.sqlQuestionDescription = `${sqlTask.title || ""}\n\n${sqlTask.description || ""}`;
    const content = `Let's move to the SQL problem. ${describeVoiceSqlQuestion(sqlTask)}`;
    await speakAndPersist(session, content, "DS_SQL", callbacks);
    session.history.push({
        role: "user",
        content:
            `[SYSTEM NOTIFICATION] DS SQL task is active. Use ONLY this DB question: ID=${sqlTask.questionId}, title="${sqlTask.title}". ` +
            "The SQL editor is already open; do NOT invent a different SQL problem.",
    });
    return true;
}

async function speakDSCodingIntro(session: VoiceSession, callbacks: VoiceSessionCallbacks): Promise<boolean> {
    const task = session.prefetchedDSCodingQuestion;
    if (!task) return false;
    const toolCtx = buildVoiceToolContext(session, callbacks);
    toolCtx.currentStage = "DS_CODING";
    await handleToolCall("open_ide", { questionId: task.questionId, language: "python" }, toolCtx);
    session.ideOpened = true;
    session.currentQuestionTitle = task.title;
    session.lastFetchedQuestionId = task.questionId;
    session.lastFetchedLanguage = "python";
    const content =
        `Let's move to the data analysis coding task. I've opened "${task.title}" in the editor. ` +
        "Use Python and pandas. Start by walking me through your approach.";
    await speakAndPersist(session, content, "DS_CODING", callbacks);
    session.history.push({
        role: "user",
        content:
            `[SYSTEM NOTIFICATION] DS coding task is active. Use ONLY this DB task: ID=${task.questionId}, title="${task.title}". ` +
            "The IDE is already open; do NOT invent or describe any other coding task.",
    });
    return true;
}

// Server-owned role-stage intros keep editor/panel startup off the LLM path.
async function speakGenAICodingIntro(session: VoiceSession, callbacks: VoiceSessionCallbacks): Promise<boolean> {
    const task = session.prefetchedGenAICodingQuestion;
    if (!task) return false;
    const toolCtx = buildVoiceToolContext(session, callbacks);
    toolCtx.currentStage = "GEN_AI_CODING";
    await handleToolCall("open_ide", { questionId: task.questionId, language: "python" }, toolCtx);
    session.ideOpened = true;
    session.currentQuestionTitle = task.title;
    session.lastFetchedQuestionId = task.questionId;
    session.lastFetchedLanguage = "python";
    const content =
        `Let's move to the GenAI coding task. I've opened "${task.title}" in the editor. ` +
        "Feel free to use Copilot, Claude, or another AI assistant; what matters is how you understand, verify, and iterate. " +
        "Start by walking me through your approach.";
    await speakAndPersist(session, content, "GEN_AI_CODING", callbacks);
    session.history.push({
        role: "user",
        content:
            `[SYSTEM NOTIFICATION] GenAI coding task is active. Use ONLY this DB task: ID=${task.questionId}, title="${task.title}". ` +
            "The IDE is already open; do NOT invent or describe any other coding task.",
    });
    return true;
}

async function speakCurrentRoleStageIntro(session: VoiceSession, callbacks: VoiceSessionCallbacks): Promise<boolean> {
    if (session.currentStage === "PM_CASE") return speakPMCase(session, callbacks);
    if (session.currentStage === "PM_CONCEPTS") return askNextPMConcept(session, callbacks);
    if (session.currentStage === "PM_STRATEGY") return speakPMStrategy(session, callbacks);
    if (session.currentStage === "PM_BEHAVIORAL") {
        await handleInternalNudge(
            session,
            "[SYSTEM NOTIFICATION] PM_BEHAVIORAL is active. Ask resume-grounded behavioral PM questions. Do not use PM case, concept, or strategy DB banks."
        );
        return true;
    }
    if (session.currentStage === "DS_CONCEPTS") return askNextDSConcept(session, callbacks);
    if (session.currentStage === "GEN_AI_CONCEPTS") return askNextGenAIConcept(session, callbacks);
    if (session.currentStage === "DS_SQL") return speakDSSQLIntro(session, callbacks);
    if (session.currentStage === "DS_CODING") return speakDSCodingIntro(session, callbacks);
    if (session.currentStage === "GEN_AI_CODING") return speakGenAICodingIntro(session, callbacks);
    if (session.currentStage === "PROBLEM_SOLVING") return speakProblemSolvingCase(session, callbacks);
    if (session.currentStage === "DS_BUSINESS_CASE") {
        await speakAndPersist(session, "We'll finish with a business metrics case.", "DS_BUSINESS_CASE", callbacks);
        await handleInternalNudge(
            session,
            "[SYSTEM NOTIFICATION] DS_BUSINESS_CASE is active. The server already delivered the business-case bridge. Do not say \"let's move\", \"we'll finish\", \"thanks\", or any other transition/greeting. Start directly with the verbal metrics/experimentation scenario question. Do not use SQL or coding tools."
        );
        return true;
    }
    return false;
}

async function prefetchDSAQuestionForVoice(session: VoiceSession): Promise<void> {
    try {
        const codingRows = await prisma.sessionQuestion.findMany({
            where: {
                sessionId: session.sessionId,
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
                const { connectMongoDB } = await import("../lib/mongodb.js");
                const { DSAQuestion } = await import("../models/DSAQuestion.js");
                await connectMongoDB();

                const doc: any = await DSAQuestion.findById(canonicalQuestionId).lean();
                if (!doc) return;

                const normalized = normalizeDSAQuestion(doc);
                session.prefetchedDSAQuestion = normalized;
                session.currentQuestionTitle = canonicalRow.questionTitle || normalized.title;
                session.cachedQuestionData.set(canonicalQuestionId, normalized);
                session.lastFetchedQuestionId = canonicalQuestionId;

                console.log(`[VoicePipeline] Reused existing coding question for session ${session.sessionId}: "${normalized.title}"`);
                return;
            }
        }

        // Reuse an existing persisted coding question if this session was rejoined.
        // This mirrors the system_design flow and keeps one canonical row per session.
        const existingSessionCoding = await prisma.sessionQuestion.findFirst({
            where: {
                sessionId: session.sessionId,
                questionCategory: "coding",
                questionId: { not: null },
            },
            orderBy: { askedAt: "asc" },
            select: {
                questionId: true,
                questionTitle: true,
                questionDifficulty: true,
            },
        });

        if (existingSessionCoding?.questionId) {
            const { connectMongoDB } = await import("../lib/mongodb.js");
            const { DSAQuestion } = await import("../models/DSAQuestion.js");
            await connectMongoDB();

            const doc: any = await DSAQuestion.findById(existingSessionCoding.questionId).lean();
            if (!doc) return;

            const normalized = normalizeDSAQuestion(doc);
            session.prefetchedDSAQuestion = normalized;
            session.currentQuestionTitle = existingSessionCoding.questionTitle || normalized.title;
            session.cachedQuestionData.set(existingSessionCoding.questionId, normalized);
            session.lastFetchedQuestionId = existingSessionCoding.questionId;

            console.log(`[VoicePipeline] Reused existing coding question for session ${session.sessionId}: "${normalized.title}"`);
            return;
        }

        // Select a fresh coding question when no persisted one exists yet.
        const { connectMongoDB } = await import("../lib/mongodb.js");
        const { DSAQuestion } = await import("../models/DSAQuestion.js");
        await connectMongoDB();

        const difficultyMap: Record<string, string[]> = {
            SDE1: ["Easy", "Medium"],
            SDE2: ["Easy", "Medium", "Hard"],
            "Senior SDE": ["Medium", "Hard"],
            "Staff Engineer": ["Medium", "Hard"],
        };
        const configuredDifficulty = session.moduleConfig?.stageOptions?.DSA?.difficulty;
        const difficulties = ["Easy", "Medium", "Hard"].includes(configuredDifficulty)
            ? [configuredDifficulty]
            : difficultyMap[session.level] || ["Easy", "Medium", "Hard"];
        const selectedTopics = session.moduleConfig?.stageOptions?.DSA?.topics;
        const topicFilter = Array.isArray(selectedTopics) && selectedTopics.length > 0
            ? { topics: { $in: selectedTopics } }
            : {};

        const seenIds = await getSeenQuestionIds(session.userId, "dsa", {
            category: "coding",
            idField: "questionId",
        });
        console.log(`[VoicePipeline] Coding exclusion list: ${seenIds.length} previously seen questions for user ${session.userId}`);

        const excludeObjectIds = toMongoObjectIds(seenIds);
        const excludeFilter = excludeObjectIds.length > 0
            ? { _id: { $nin: excludeObjectIds } }
            : {};

        // Pass 1: preferred difficulty, exclude seen
        let [rawDoc] = await DSAQuestion.aggregate([
            { $match: { difficulty: { $in: difficulties }, ...topicFilter, ...excludeFilter } },
            { $sample: { size: 1 } },
        ]);

        if (!rawDoc && Object.keys(topicFilter).length > 0) {
            [rawDoc] = await DSAQuestion.aggregate([
                { $match: { difficulty: { $in: difficulties }, ...excludeFilter } },
                { $sample: { size: 1 } },
            ]);
        }

        // Pass 2: any difficulty, exclude seen
        if (!rawDoc && seenIds.length > 0) {
            [rawDoc] = await DSAQuestion.aggregate([
                { $match: excludeFilter },
                { $sample: { size: 1 } },
            ]);
        }

        // Pass 3: repeat this user's least-recently-seen question, keeping
        // preferred difficulty if possible.
        if (!rawDoc) {
            rawDoc = await findLeastRecentlySeenMongoDoc(
                DSAQuestion,
                session.userId,
                "dsa",
                { difficulty: { $in: difficulties } }
            );
        }

        // Pass 4: absolute repeat fallback within the same source.
        if (!rawDoc) {
            rawDoc = await findLeastRecentlySeenMongoDoc(DSAQuestion, session.userId, "dsa");
        }

        if (!rawDoc) {
            rawDoc = await findRandomMongoDoc(DSAQuestion);
            if (rawDoc) {
                console.warn(`[VoicePipeline] DSA filters/exposure exhausted; used any random coding question fallback.`);
            }
        }

        if (!rawDoc) {
            console.error(`[VoicePipeline] dsa_questions collection is empty.`);
            return;
        }

        const doc: any = await DSAQuestion.findById(rawDoc._id).lean();
        if (doc) {
            const normalized = normalizeDSAQuestion(doc);
            session.prefetchedDSAQuestion = normalized;
            session.currentQuestionTitle = normalized.title;
            session.cachedQuestionData.set(normalized.id, normalized);
            session.lastFetchedQuestionId = normalized.id;

            const existing = await prisma.sessionQuestion.findFirst({
                where: { sessionId: session.sessionId, questionId: normalized.id },
                select: { id: true },
            });

            if (!existing) {
                const dsaSampleAnswer: string | null =
                    normalized.solution?.optimized?.explanation ||
                    normalized.solution?.bruteForce?.explanation ||
                    null;

                await prisma.sessionQuestion.create({
                    data: {
                        sessionId: session.sessionId,
                        questionId: normalized.id,
                        questionTitle: normalized.title,
                        questionCategory: "coding",
                        questionDifficulty: normalized.difficulty,
                        sampleAnswer: dsaSampleAnswer,
                    },
                });
            }
            await recordQuestionExposure({
                userId: session.userId,
                questionSource: "dsa",
                questionId: normalized.id,
                sessionId: session.sessionId,
            });

            console.log(`[VoicePipeline] Pre-fetched coding question: "${normalized.title}" (${normalized.difficulty})`);
        }
    } catch (err) {
        console.error(`[VoicePipeline] Pre-fetch coding question failed:`, err);
    }
}

async function prefetchSDQuestionForVoice(session: VoiceSession): Promise<void> {
    const { connectMongoDB } = await import("../lib/mongodb.js");
    const { SystemDesignQuestion } = await import("../models/system-design-question.js");

    await connectMongoDB();

    // Reuse already-selected question for this session to avoid duplicates on reconnect.
    const existingSessionSD = await prisma.sessionQuestion.findFirst({
        where: {
            sessionId: session.sessionId,
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

        session.prefetchedSDQuestion = {
            id: existingSessionSD.questionId,
            title,
            problemStatement,
        };
        session.currentQuestionTitle = title;
        session.rubricLite = existingDoc?.rubricLite || null;
        session.cachedQuestionData.set(existingSessionSD.questionId, {
            questionId: existingSessionSD.questionId,
            title,
            category: "SystemDesign",
            difficulty,
            problemMd: problemStatement,
        });
        session.lastFetchedQuestionId = existingSessionSD.questionId;

        console.log(`[VoicePipeline] Reused existing SD question for session ${session.sessionId}: "${title}"`);
        return;
    }

    const difficultyMap: Record<string, string[]> = {
        SDE1: ["Easy", "Medium"],
        SDE2: ["Easy", "Medium", "Hard"],
        "Senior SDE": ["Medium", "Hard"],
        "Staff Engineer": ["Medium", "Hard"],
    };
    const difficulties = difficultyMap[session.level] || ["Easy", "Medium", "Hard"];
    const recentSessionSD = await prisma.sessionQuestion.findFirst({
        where: {
            session: { userId: session.userId },
            questionCategory: "system_design",
            questionId: { not: null },
        },
        orderBy: { askedAt: "desc" },
        select: { questionId: true },
    });
    const recentSdObjectId = recentSessionSD?.questionId
        ? toMongoObjectIds([recentSessionSD.questionId])[0]
        : null;

    const seenIds = await getSeenQuestionIds(session.userId, "system_design", {
        category: "system_design",
        idField: "questionId",
    });
    const excludeObjectIds = toMongoObjectIds(seenIds);
    const excludeFilter = excludeObjectIds.length > 0 ? { _id: { $nin: excludeObjectIds } } : {};

    let [rawDoc] = await SystemDesignQuestion.aggregate([
        { $match: { difficulty: { $in: difficulties }, ...excludeFilter } },
        { $sample: { size: 1 } },
    ]);

    if (!rawDoc && seenIds.length > 0) {
        [rawDoc] = await SystemDesignQuestion.aggregate([
            { $match: excludeFilter },
            { $sample: { size: 1 } },
        ]);
    }

    if (!rawDoc) {
        rawDoc = await findLeastRecentlySeenMongoDoc(
            SystemDesignQuestion,
            session.userId,
            "system_design",
            { difficulty: { $in: difficulties } }
        );
    }

    if (!rawDoc) {
        rawDoc = await findLeastRecentlySeenMongoDoc(SystemDesignQuestion, session.userId, "system_design");
    }

    if (!rawDoc) {
        console.warn(`[VoicePipeline] SD dedupe exhausted the bank for ${session.userId}; recycling a previously seen question.`);
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
            console.warn(`[VoicePipeline] System Design filters/exposure exhausted; used any random system design fallback.`);
        }
    }

    if (!rawDoc) {
        throw new Error("No system design questions available in question bank.");
    }

    const doc: any = await SystemDesignQuestion.findById(rawDoc._id).lean();
    if (!doc) {
        throw new Error("Failed to load selected system design question.");
    }

    const questionId = doc._id.toString();
    const title = doc.title;
    const problemStatement = doc.problemStatement;
    const difficulty = doc.difficulty || "Medium";
    const sampleAnswer: string | null = (doc.rubricFull as any)?.sampleAnswer ?? null;

    session.prefetchedSDQuestion = {
        id: questionId,
        title,
        problemStatement,
    };
    session.currentQuestionTitle = title;
    session.rubricLite = doc.rubricLite || null;
    session.cachedQuestionData.set(questionId, {
        questionId,
        title,
        category: "SystemDesign",
        difficulty,
        problemMd: problemStatement,
    });
    session.lastFetchedQuestionId = questionId;

    const existing = await prisma.sessionQuestion.findFirst({
        where: {
            sessionId: session.sessionId,
            questionCategory: "system_design",
            questionId,
        },
        select: { id: true },
    });

    if (!existing) {
        await prisma.sessionQuestion.create({
            data: {
                sessionId: session.sessionId,
                questionId,
                questionTitle: title,
                questionCategory: "system_design",
                questionDifficulty: difficulty,
                sampleAnswer,
            },
        });
    }
    await recordQuestionExposure({
        userId: session.userId,
        questionSource: "system_design",
        questionId,
        sessionId: session.sessionId,
    });

    console.log(`[VoicePipeline] Pre-fetched SD question: "${title}" (${difficulty}) for session ${session.sessionId}`);
}

// ── Sentence Splitter (for streaming TTS) ──────────────────
// Split on sentence boundaries only (.!?) so each TTS call gets a full
// sentence — enough context for natural prosody and consistent voice.
// Clause-level splitting causes choppy audio and voice inconsistencies
// because each short fragment is synthesized independently.

function extractSpeechChunks(buffer: string): { chunks: string[]; remaining: string } {
    const chunks: string[] = [];
    let lastIndex = 0;

    // A sentence boundary is .!? followed by whitespace or end of string.
    // `[\s\S]*?` consumes everything up to that boundary as ordinary text,
    // including dots inside domains (practers.com) and decimals (3.5) — those
    // dots are not followed by whitespace, so they never split a sentence.
    // It also guarantees the text before such a dot is never dropped: it stays
    // part of the chunk that ends at the next real boundary.
    const regex = /[\s\S]*?[.!?]+(?:\s|$)/g;
    let match;

    while ((match = regex.exec(buffer)) !== null) {
        const sentence = match[0].trim();
        if (sentence) chunks.push(sentence);
        lastIndex = regex.lastIndex;
    }

    return { chunks, remaining: buffer.slice(lastIndex) };
}

// ── xAI TTS (streaming) ─────────────────────────────────────

const AUDIO_CHUNK_SIZE = 8192; // ~170ms at 24kHz 16-bit mono

async function textToSpeech(
    text: string,
    callbacks: VoiceSessionCallbacks,
    signal: AbortSignal
): Promise<void> {
    const apiKey = getXAIApiKey();
    console.log(`[Voice][TTS] Requesting xAI TTS voice=${XAI_TTS_VOICE}, chars=${text.length}`);

    const response = await fetch(XAI_TTS_URL, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            text,
            voice_id: XAI_TTS_VOICE,
            language: "en",
            output_format: {
                codec: "pcm",
                sample_rate: 24000,
            },
        }),
        signal,
    });

    if (!response.ok) {
        const errText = await response.text().catch(() => "");
        throw new Error(`xAI TTS failed (${response.status}): ${errText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body from TTS");

    let leftover = new Uint8Array(0);
    let emittedChunks = 0;
    let emittedBytes = 0;

    while (true) {
        if (signal.aborted) break;
        const { done, value } = await reader.read();
        if (done) break;

        // Combine with leftover from previous read
        const combined = new Uint8Array(leftover.length + value.length);
        combined.set(leftover);
        combined.set(value, leftover.length);

        // Send complete chunks for smooth playback
        let offset = 0;
        while (offset + AUDIO_CHUNK_SIZE <= combined.length) {
            if (signal.aborted) break;
            const chunk = combined.slice(offset, offset + AUDIO_CHUNK_SIZE);
            callbacks.onAudio(Buffer.from(chunk).toString("base64"));
            emittedChunks++;
            emittedBytes += chunk.byteLength;
            offset += AUDIO_CHUNK_SIZE;
        }

        leftover = combined.slice(offset);
    }

    // Send any remaining audio
    if (leftover.length > 0 && !signal.aborted) {
        callbacks.onAudio(Buffer.from(leftover).toString("base64"));
        emittedChunks++;
        emittedBytes += leftover.byteLength;
    }

    console.log(`[Voice][TTS] xAI TTS streamed ${emittedChunks} chunks, ${emittedBytes} bytes`);
}

// ── Deepgram STT ───────────────────────────────────────────

function createSTTSocket(session: VoiceSession): WebSocket {
    const dgKey = getDeepgramApiKey();
    // Flux v2: Only basic params in URL, advanced config via Configure message
    const params = new URLSearchParams({
        model: STT_MODEL,
        encoding: "linear16",
        sample_rate: "16000",
    });

    let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

    const url = `${DEEPGRAM_STT_URL}?${params}`;
    console.log(`[Voice] Connecting to Deepgram Flux: ${url}`);

    const ws = new WebSocket(url, {
        headers: { Authorization: `Token ${dgKey}` },
    });

    ws.on("open", () => {
        console.log(`[Voice] Deepgram Flux connected for ${session.sessionId}`);
        // Configure Flux v2 with supported options only
        try {
            const config: {
                type: "Configure";
                language_hints?: string[];
                thresholds: {
                    eot_threshold: number;
                    eot_timeout_ms: number;
                };
            } = {
                type: "Configure",
                // Turn detection thresholds
                thresholds: {
                    eot_threshold: 0.65,  // Slightly lower threshold for better sensitivity
                    eot_timeout_ms: 5500,  // 5.5 seconds to allow thinking pauses
                },
            };

            if (supportsDeepgramLanguageHints(STT_MODEL)) {
                config.language_hints = ["en-IN"];
            }

            ws.send(JSON.stringify(config));
            console.log(`[Voice] Sent Flux configuration: model=${STT_MODEL}, language_hints=${config.language_hints ? "[en-IN]" : "disabled"}, eot_timeout=5500ms`);
            
            // Flux v2 only accepts Configure / CloseStream as JSON control messages.
            // Use WS ping frames for heartbeat to avoid UNPARSABLE_CLIENT_MESSAGE errors.
            heartbeatInterval = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    try {
                        ws.ping();
                    } catch (err) {
                        console.warn(`[Voice] STT heartbeat ping failed for ${session.sessionId}:`, err);
                    }
                }
            }, STT_HEARTBEAT_MS);

            if (session.pendingAudioPackets.length > 0) {
                const buffered = session.pendingAudioPackets.splice(0, session.pendingAudioPackets.length);
                for (const packet of buffered) {
                    ws.send(packet);
                }
                console.log(`[Voice] Flushed ${buffered.length} buffered audio packets to STT for ${session.sessionId}`);
            }
        } catch (err) {
            console.error("[Voice] Failed to send Configure message:", err);
        }
    });

    ws.on("message", (raw: Buffer) => {
        try {
            const msg = JSON.parse(raw.toString());

            // DEBUG: Log all incoming messages to see what Deepgram is sending
            if (msg.type !== "KeepAlive") {
                console.log(`[Voice][STT] Received message type: ${msg.type}`, JSON.stringify(msg).substring(0, 200));
            }

            // Handle Deepgram error messages
            if (msg.type === "Error") {
                console.error(`[Voice][STT] Deepgram error: code=${msg.code}, desc="${msg.description}"`);
                return;
            }

            // Flux v2 uses TurnInfo events
            if (msg.type === "TurnInfo") {
                const transcript = msg.transcript || "";
                const event = msg.event;
                const confidence = msg.confidence || 0;

                console.log(`[Voice][STT] TurnInfo event="${event}", transcript="${transcript.substring(0, 100)}", confidence=${confidence.toFixed(2)}`);

                // Log low confidence warnings
                if (confidence > 0 && confidence < 0.6) {
                    console.warn(`[Voice][STT] Low confidence (${confidence.toFixed(2)}) for: "${transcript.substring(0, 50)}..."`);
                }

                // Update / EagerEndOfTurn: show interim results for live feedback
                if (event === "Update" || event === "EagerEndOfTurn") {
                    session.userTranscriptBuffer = transcript;
                    
                    // ── Push-to-Talk: track interim transcript while holding ──
                    if (session.isPTTActive && session.isPTTHolding && transcript.trim()) {
                        // Store the latest interim transcript - we'll use this if spacebar is released before EndOfTurn
                        console.log(`[PTT][Pipeline] Tracking interim transcript: "${transcript.substring(0, 80)}${transcript.length > 80 ? '...' : ''}"`);
                        // Emit interim transcript for live preview (doesn't add to chat history)
                        session.callbacks.emit("voice:interim-user-transcript", { text: transcript });
                    }
                    
                    // Send interim results to client for live feedback (non-PTT mode)
                    if (transcript.trim() && !session.isPTTActive) {
                        session.callbacks.emit("voice:interim-transcript", { text: transcript, confidence });
                    }
                }

                // EndOfTurn: definitive end of user's turn with refined transcript.
                // This is the ONLY place we trigger LLM processing.
                if (event === "EndOfTurn") {
                    const fullText = (transcript || session.userTranscriptBuffer).trim();
                    session.userTranscriptBuffer = "";

                    if (fullText) {
                        // Log final transcript with confidence
                        console.log(`[Voice][STT] Final transcript (confidence: ${confidence.toFixed(2)}): "${fullText}"`);
                        // ── Push-to-Talk: buffer transcripts while holding spacebar ──
                        if (session.isPTTActive) {
                            if (session.isPTTHolding) {
                                session.pttTranscriptBuffer.push(fullText);
                                console.log(`[PTT][Pipeline] Buffering transcript segment #${session.pttTranscriptBuffer.length}: "${fullText.substring(0, 80)}${fullText.length > 80 ? '...' : ''}"`);
                                return;
                            } else if (session.pttPendingFlush) {
                                // User just released spacebar and this is the final EndOfTurn!
                                console.log(`[PTT][Pipeline] Final EndOfTurn received during grace period - flushing immediately`);
                                session.pttTranscriptBuffer.push(fullText);
                                performPTTFlush(session, true);
                                return;
                            }
                            // If PTT is active but not holding/pending, ignore delayed STT results from previous turns
                            return;
                        }

                        // Non-PTT mode: show transcript and process immediately
                        session.callbacks.onUserTranscript(fullText);
                        console.log(`[Voice][Pipeline] User transcript received: "${fullText.substring(0, 100)}${fullText.length > 100 ? '...' : ''}"`);
                        console.log(`[PTT][Pipeline] PTT not active or not holding - processing transcript normally`);

                        // Normal flow: barge-in if AI is speaking, then process
                        if (session.isGenerating) {
                            session.abortController?.abort();
                            session.isGenerating = false;
                            session.callbacks.emit("voice:interrupted", {});
                        }

                        handleUserUtterance(session, fullText).catch(err => {
                            console.error("[Voice] Utterance handling error:", err);
                        });
                    }
                }
            }
        } catch (err) {
            console.error("[Voice] STT message parse error:", err);
        }
    });

    ws.on("error", (err: any) => {
        const errMsg = err?.message || err?.toString?.() || "Unknown STT error";
        console.error(`[Voice] Deepgram STT error for ${session.sessionId}:`, errMsg);
    });

    ws.on("unexpected-response", (_req: any, res: any) => {
        let body = "";
        res.on("data", (chunk: Buffer) => { body += chunk.toString(); });
        res.on("end", () => {
            console.error(`[Voice] Deepgram rejected connection (${res.statusCode}): ${body}`);
        });
    });

    ws.on("close", (code: number, reason: Buffer) => {
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
        }
        const reasonStr = reason?.toString() || "";
        console.log(`[Voice] Deepgram STT closed for ${session.sessionId} (code=${code}${reasonStr ? `, reason=${reasonStr}` : ""})`);
        
        // Deepgram sometimes sends code 1000 for server-side limits or timeouts.
        // Reconnect as long as we haven't actively nulled the socket ourselves.
        if (activeSessions.has(session.sessionId) && session.sttSocket === ws) {
            console.log(`[Voice] Reconnecting STT for ${session.sessionId}...`);
            try {
                session.sttSocket = createSTTSocket(session);
            } catch (err) {
                session.callbacks.onError(STANDARD_ERROR_MESSAGES.VOICE_UNAVAILABLE);
            }
        }
    });

    return ws;
}

// ── LLM → TTS Pipeline ────────────────────────────────────

/**
 * Runs the server-authoritative screening pacing pointer for ONE voice candidate turn
 * (voice parity with the text path's enforceCompanyScreeningTurn). Advances the pointer,
 * persists it on the session, closes a stale panel on phase change, and enters CLOSING on
 * the final close step. The resolved turn is read by generateAndSpeak when it builds the
 * runtime directive. Company-screening only — never called for practice sessions.
 */
/**
 * Server-opens the workspace panel for a role phase on entry, reusing the PRACTICE panel
 * handler so the payload is exactly what that modality's editor expects. We present a
 * throwaway tool context as the practice role interview (interviewType + stage) with the
 * screening context nulled, so the practice handler's interviewType guard passes and the
 * tool sequencer treats it as a normal practice open. Open-once per phase. The original
 * phases (coding/cs_sql/system_design) are NOT handled here — they open via the LLM's
 * open_screening_workspace/open_scratchpad per the directive, unchanged.
 */
async function openScreeningPhasePanelVoice(
    session: VoiceSession,
    phaseType: ScreeningPhaseType,
    callbacks: VoiceSessionCallbacks
): Promise<void> {
    const opened = (session.companyScreeningOpenedPhasePanels ??= new Set<string>());
    if (opened.has(phaseType)) return;

    const openWith = async (interviewType: string, stage: string, tool: string, args: any, prefetched: any) => {
        if (!prefetched) return;
        const ctx = buildVoiceToolContext(session, callbacks);
        (ctx as any).interviewType = interviewType;
        (ctx as any).currentStage = stage;
        // Null the screening context on THIS throwaway ctx so the sequencer + handler treat it
        // as a plain practice open (screening's own gating exposes open_screening_workspace).
        (ctx as any).companyScreeningBlueprint = null;
        (ctx as any).companyScreeningCurrentPhaseType = null;
        await handleToolCall(tool as any, args, ctx);
        opened.add(phaseType);
    };

    switch (phaseType) {
        // ── Core coding / SQL: server-open the recruiter's attached bank question. Unlike the
        // role phases below (which use a nulled practice ctx), open_screening_workspace REQUIRES
        // the real screening ctx (blueprint + bank cache), so we call it with a full ctx. Without
        // this the coding/SQL phases had NO workspace and the interview felt purely conversational.
        case "coding":
        case "cs_sql": {
            const qid = session.companyScreeningCurrentQuestionId;
            if (qid) {
                await handleToolCall("open_screening_workspace", { questionId: qid }, buildVoiceToolContext(session, callbacks));
                opened.add(phaseType);
            }
            break;
        }
        // ── System design: open_screening_workspace only covers coding/SQL, so resolve the
        // recruiter's SD bank question and open the whiteboard directly (tagging the question so
        // run/report can resolve it, and seeding prefetchedSDQuestion for the SD intro flow).
        case "system_design": {
            const qid = session.companyScreeningCurrentQuestionId;
            const resolved = qid && session.companyScreening
                ? bankQuestionIdForScreeningQuestion(session.companyScreening.blueprintSnapshot, qid)
                : null;
            const sd = resolved ? session.cachedQuestionData.get(String(resolved.ref.id)) : null;
            if (qid && sd) {
                const ctx = buildVoiceToolContext(session, callbacks);
                ctx.onScreeningQuestionAsked?.(qid, String(resolved!.ref.id));
                session.prefetchedSDQuestion = {
                    id: String(sd.id),
                    title: sd.title || "System design",
                    problemStatement: sd.problemStatement || "",
                };
                await handleToolCall("open_scratchpad", { topic: sd.title || "System Design", initialContent: "" }, ctx);
                opened.add(phaseType);
            }
            break;
        }
        case "ds_sql":
            await openWith("data_science_role", "DS_SQL", "open_sql_editor", {}, session.prefetchedDSSQLQuestion);
            break;
        case "ds_coding":
            await openWith("data_science_role", "DS_CODING", "open_ide",
                { questionId: session.prefetchedDSCodingQuestion?.questionId, language: "python" }, session.prefetchedDSCodingQuestion);
            break;
        case "genai_coding":
            await openWith("gen_ai_role", "GEN_AI_CODING", "open_ide",
                { questionId: session.prefetchedGenAICodingQuestion?.questionId, language: "python" }, session.prefetchedGenAICodingQuestion);
            break;
        case "pm_case": {
            const q = session.prefetchedPMCaseQuestion;
            await openWith("pm_role", "PM_CASE", "open_notepad", { topic: q?.title || "Product Case", template: "CIRCLES", scenario: q?.scenario }, q);
            break;
        }
        case "problem_solving": {
            const q = session.prefetchedProblemSolvingCaseQuestion;
            await openWith("problem_solving_case", "PROBLEM_SOLVING", "open_notepad", { topic: q?.title || "Case", template: "blank", scenario: q?.prompt }, q);
            break;
        }
    }
}

async function applyCompanyScreeningVoicePointer(
    session: VoiceSession,
    userText: string,
    callbacks: VoiceSessionCallbacks
): Promise<void> {
    const context = session.companyScreening;
    if (!context) return;
    const blueprint = context.blueprintSnapshot;
    const nowMs = Date.now();
    const startedAtMs = new Date(session.startedAt || nowMs).getTime();

    if (!session.companyScreeningPlan) session.companyScreeningPlan = computeScreeningPlan(blueprint);
    if (!session.companyScreeningProgress) session.companyScreeningProgress = createScreeningProgress(nowMs);
    if (session.companyScreeningResumeAgenda === undefined) {
        session.companyScreeningResumeAgenda = seedScreeningResumeAgenda(session.resumeSummary);
    }

    // Classify the candidate's turn: a skip/decline advances the pointer but is recorded as
    // skipped (not real coverage), matching the text path exactly.
    const hasMessage = Boolean(userText && userText.trim());
    const candidateEndRequest = hasMessage && isEndInterviewIntent(userText);
    const isSkip = hasMessage && !candidateEndRequest && isScreeningSkip(userText);
    const resolution = resolveScreeningAuthoritativeTurn({
        blueprint,
        plan: session.companyScreeningPlan,
        progress: session.companyScreeningProgress,
        startedAtMs,
        nowMs,
        candidateAnswered: hasMessage && !isSkip && !candidateEndRequest,
        candidateSkipped: isSkip,
        candidateEndRequest,
        candidateMessage: userText ?? null,
        resumeSummary: session.resumeSummary,
        githubVerification: session.companyScreeningGithubVerification ?? null,
        resumeAgenda: session.companyScreeningResumeAgenda,
        previousPhaseType: session.companyScreeningCurrentPhaseType ?? null,
        closingForced: Boolean(session.companyScreeningClosingForced),
        closingQuestionOffered: Boolean(session.companyScreeningClosingQuestionOffered),
        currentStageIsClosing: session.currentStage === "CLOSING",
    });

    const previousPhaseTypeForNotice = session.companyScreeningCurrentPhaseType ?? null;
    session.companyScreeningAuthoritativeTurn = resolution.turn;
    session.companyScreeningResumeAgenda = resolution.resumeAgenda ?? session.companyScreeningResumeAgenda;
    session.companyScreeningCurrentPhaseType = resolution.currentPhaseType;
    session.companyScreeningClosingForced = resolution.closingForced;
    session.companyScreeningClosingQuestionOffered = resolution.closingQuestionOffered;
    session.companyScreeningCurrentQuestionId = resolution.turn.currentQuestionId;
    if (!session.companyScreeningAskedQuestionIds) session.companyScreeningAskedQuestionIds = new Set();
    for (const id of session.companyScreeningProgress.answered) session.companyScreeningAskedQuestionIds.add(id);

    // Anchor the model on the new phase the moment the pointer moves (mirrors how practice
    // transitions never let the model say goodbye). Generic — driven by whatever phase is next.
    if (
        resolution.currentPhaseType &&
        !resolution.turn.forceClose &&
        resolution.currentPhaseType !== previousPhaseTypeForNotice &&
        previousPhaseTypeForNotice !== null
    ) {
        session.history.push({ role: "user", content: buildScreeningPhaseTransitionNotice(resolution.currentPhaseType) });
    }

    const answered = hasMessage && !isSkip && !candidateEndRequest;

    if (resolution.closePreviousPanel) {
        callbacks.emit("panel:close", { summary: "Phase complete." });
    }

    // Server-open the workspace panel for the current role phase (open-once), reusing the
    // practice handler so the editor/notepad payload is exactly right for that modality.
    if (resolution.currentPhaseType && !resolution.turn.forceClose) {
        await openScreeningPhasePanelVoice(session, resolution.currentPhaseType, callbacks);
    }

    // Pointer drives stage: mirror currentStage to the active phase's mapped stage so message
    // stage tags + client UI track the real phase instead of the pinned BEHAVIOURAL container.
    // Safe: screening tools come from buildScreeningTools (phase-based), not the stage machine.
    if (resolution.enterStage && session.currentStage !== resolution.enterStage) {
        session.currentStage = resolution.enterStage;
        callbacks.emit("stage:change", { stage: resolution.enterStage, reason: `Screening advanced to the ${resolution.currentPhaseType ?? "next"} phase.` });
    }

    if (resolution.enterClosingStage && session.currentStage !== "CLOSING") {
        session.currentStage = "CLOSING";
        callbacks.emit("stage:change", { stage: "CLOSING", reason: "Server-enforced screening time/coverage budget reached." });
    }
}

async function handleUserUtterance(
    session: VoiceSession,
    userText: string
): Promise<void> {
    const callbacks = session.callbacks;

    // Do not accept any more turns after interview completion.
    const dbSession = await prisma.interviewSession.findUnique({
        where: { id: session.sessionId },
        select: { status: true },
    });
    if (!dbSession || dbSession.status === "COMPLETED") {
        callbacks.emit("session:ended", {
            message: "This interview has already ended.",
        });
        callbacks.onEnded("Interview completed");
        stopVoiceSession(session.sessionId);
        return;
    }

    // Persist user message
    await prisma.sessionMessage.create({
        data: {
            sessionId: session.sessionId,
            role: "user",
            content: userText,
            stage: session.currentStage,
            ...companyScreeningMsgMeta(session),
        },
    });

    // Add to LLM history
    session.history.push({ role: "user", content: userText });
    let justTransitionedBehaviouralIntro = false;

    if (await processCompanyScreeningMockVoiceTurn(session, callbacks, userText)) {
        return;
    }

    // Server-authoritative screening pacing pointer — voice parity with the text path.
    // For a REAL (non-mock) company screening, the SERVER decides the question, follow-up
    // budget, and when to advance/close each candidate turn. Guarded → practice untouched.
    if (session.companyScreening && !isCompanyScreeningMockInterviewerEnabled()) {
        await applyCompanyScreeningVoicePointer(session, userText, callbacks);
    }

    if (session.interviewType === "resume_round") {
        await forceVoiceResumeOpeningCalibrationTransition(session, userText, callbacks);
        await forceVoiceResumeStageTransitionAfterNonAnswers(session, userText, callbacks);
        await forceVoiceResumeAgendaAdvanceAfterAnsweredQuestionBudget(session, callbacks);
    }

    if (
        session.interviewType === "behavioural" &&
        session.currentStage === "INTRO" &&
        !session.companyScreening
    ) {
        const toolCtx = buildVoiceToolContext(session, callbacks);
        const transitionResult = await handleToolCall(
            "transition_stage",
            { nextStage: "BEHAVIOURAL", reason: "Standalone behavioural intro completed after first candidate response." },
            toolCtx
        );
        if (transitionResult.startsWith("Interview transitioned")) {
            session.currentStage = "BEHAVIOURAL";
            toolCtx.currentStage = "BEHAVIOURAL";
            justTransitionedBehaviouralIntro = true;
            session.behaviouralStageNonAnswerCount = 0;
            session.history.push({
                role: "user",
                content:
                    "[SYSTEM NOTIFICATION] Behavioural intro is complete. Continue in the BEHAVIOURAL stage now. " +
                    "Do not ask more background or intro questions. Ask the first STAR-style behavioral example question.",
            });
        }
    }

    if (
        session.interviewType === "behavioural" &&
        session.currentStage === "BEHAVIOURAL" &&
        !session.companyScreening
    ) {
        if (!justTransitionedBehaviouralIntro && isBehaviouralNonAnswer(userText)) {
            session.behaviouralStageNonAnswerCount += 1;
        }
        if (session.behaviouralStageNonAnswerCount >= 3) {
            const toolCtx = buildVoiceToolContext(session, callbacks);
            const transitionResult = await handleToolCall(
                "transition_stage",
                { nextStage: "CLOSING", reason: "Candidate skipped or refused multiple behavioural prompts." },
                toolCtx
            );
            if (transitionResult.startsWith("Interview transitioned")) {
                session.currentStage = "CLOSING";
                toolCtx.currentStage = "CLOSING";
            }
            session.history.push({
                role: "user",
                content:
                    "[SYSTEM NOTIFICATION] Candidate has skipped, refused, or given no usable story for multiple behavioural prompts. " +
                    "Close the interview factually now. Do NOT praise willingness to engage, coachability, ownership, communication, or effort. " +
                    "Say there is not enough behavioral evidence because most examples were skipped or not developed.",
            });
        }
    }

    if (
        session.currentStage === "SYSTEM_DESIGN" &&
        session.prefetchedSDQuestion &&
        !hasDeliveredVoiceSystemDesignIntro(session.history, session.prefetchedSDQuestion.title)
    ) {
        console.warn(`[Voice] Missing SD title intro before SYSTEM_DESIGN turn; delivering server intro for ${session.sessionId}`);
        await speakAndPersistSystemDesignIntro(session, callbacks);
        return;
    }

    // If the candidate explicitly wants to move on from SQL, close the panel now
    // and clear the SQL context before the assistant generates its next turn.
    const hasActiveSqlContext = !!(
        session.sqlEditorOpened ||
        session.sqlSnapshot ||
        session.sqlQuestionDescription
    );
    const likelySqlRoundInProgress = hasActiveSqlContext || hasRecentSqlRoundSignals(session.history);
    const sqlHandoffRequested =
        isSqlAdvanceIntent(userText) ||
        (likelySqlRoundInProgress && isGenericMoveOnIntent(userText));
    const nextAfterSql = getNextCSPhase(session, "SQL");
    const sqlMoveOnInstruction =
        "[SYSTEM NOTIFICATION] SQL round is now closed because the candidate asked to move on. " +
        (nextAfterSql
            ? `Continue immediately with the next configured CS topic (${nextAfterSql}) using its QUESTION BANK entry. `
            : "Transition to CLOSING now. ") +
        "Do NOT reopen SQL and do NOT repeat earlier theory questions.";

    if (
        session.currentStage === "FUNDAMENTALS" &&
        !session.sqlRoundCompleted &&
        (likelySqlRoundInProgress || [...session.cachedQuestionData.values()].some(q => q.category === "SQL")) &&
        sqlHandoffRequested
    ) {
        callbacks.emit("panel:close", { summary: "SQL round complete." });
        session.sqlEditorOpened = false;
        session.sqlSnapshot = null;
        session.sqlQuestionDescription = null;
        session.sqlRoundCompleted = true;
        session.currentFundamentalsPhase = nextAfterSql || "CLOSING";
        clearVoiceSQLTimers(session);

        const ack = nextAfterSql ? "Okay, let's continue." : "Okay, let's wrap up.";
        callbacks.onAiTranscript(ack);
        try {
            await textToSpeech(ack, callbacks, new AbortController().signal);
        } catch (err: any) {
            console.error("[Voice] SQL handoff ack TTS error:", err.message);
        }
        callbacks.onTurnComplete();

        session.history.push({ role: "assistant", content: ack });
        await prisma.sessionMessage.create({
            data: {
                sessionId: session.sessionId,
                role: "assistant",
                content: ack,
                stage: session.currentStage,
            },
        });

        console.log(`[Voice] Candidate requested SQL handoff; closed SQL panel for ${session.sessionId}`);

        await handleInternalNudge(session, sqlMoveOnInstruction);
        return;
    }

    // Second-chance SQL panel close: if panel is still open, check whether the
    // last AI message already transitioned to OS/CN/OOP (catches cases where
    // end-of-turn detection missed it or the AI response was split across turns).
    {
        const voiceSqlQCachedCheck = session.cachedQuestionData && [...session.cachedQuestionData.values()].some(q => q.category === "SQL");
        if (session.sqlEditorOpened || (session.currentStage === "FUNDAMENTALS" && voiceSqlQCachedCheck)) {
            const lastAIMsg = [...session.history].reverse().find(m => m.role === "assistant");
            const lastAIContent = typeof lastAIMsg?.content === "string" ? lastAIMsg.content : "";
            if (lastAIContent) {
                    // Only close if AI is clearly transitioning to next topic (not casual mentions)
                    // Must include explicit transition words like "let's", "move", "next", "now"
                    const transitionPattern = /\b(let'?s\s+move|let'?s\s+discuss|let'?s\s+talk|now\s+let'?s|moving on|next|now\s+let'?s).*?(operating systems?|computer networks?|os|cn|oops|object[- ]oriented|fundamentals)\b/i;
                    if (transitionPattern.test(lastAIContent)) {
                    callbacks.emit("panel:close", { summary: "SQL round complete." });
                    session.sqlEditorOpened = false;
                    session.sqlSnapshot = null;
                    session.sqlQuestionDescription = null;
                    session.sqlRoundCompleted = true;
                    session.currentFundamentalsPhase = getNextCSPhase(session, "SQL") || "CLOSING";
                    clearVoiceSQLTimers(session);
                    console.log(`[Voice] Second-chance auto-closed SQL panel on user turn for ${session.sessionId}`);
                }
            }
        }
    }

    // Deterministic anti-loop guard: when the candidate says they don't know,
    // do not let the model keep repeating the same fundamentals main question.
    // Fires on EITHER: (a) same question repeated in recent window, OR
    // (b) candidate said "I don't know" 2+ times consecutively.
    if (
        session.currentStage === "FUNDAMENTALS" &&
        isUnknownResponseIntent(userText)
    ) {
        const repeatedQuestion = hasRecentRepeatedAssistantQuestion(session.history);
        const consecutiveUnknown = hasConsecutiveUnknownResponses(session.history);

        if (repeatedQuestion || consecutiveUnknown) {
            const notification = consecutiveUnknown
                ? "[SYSTEM NOTIFICATION] Candidate has said they do not know multiple times in a row. " +
                  "Do NOT ask the same question or a follow-up on the same topic again. " +
                  "Move to the NEXT main question or NEXT phase from the QUESTION BANK immediately."
                : "[SYSTEM NOTIFICATION] Candidate already said they do not know and the same main question was repeated. " +
                  "Do NOT repeat that exact question again. Ask one concise scaffold follow-up OR move to the next main question/phase now.";
            session.history.push({ role: "user", content: notification });
        }
    }

    // Deterministic FUNDAMENTALS -> SQL handoff: if candidate explicitly asks
    // to move to SQL and editor is still closed, open it immediately.
    if (
        session.currentStage === "FUNDAMENTALS" &&
        !session.sqlEditorOpened &&
        !session.sqlRoundCompleted &&
        isFundamentalsToSqlIntent(userText)
    ) {
        const sqlOpenCtx: ToolContext = {
            sessionId: session.sessionId,
            userId: session.userId,
            interviewType: session.interviewType,
            currentStage: session.currentStage,
            askedQuestionIds: session.askedQuestionIds,
            role: session.role,
            level: session.level,
            stageOrder: session.stageOrder,
            lastFetchedQuestionId: session.lastFetchedQuestionId,
            lastFetchedLanguage: session.lastFetchedLanguage,
            prefetchedDSAQuestion: session.prefetchedDSAQuestion ?? null,
            prefetchedBehavioralQuestions: session.prefetchedBehavioralQuestions,
            prefetchedSDQuestion: session.prefetchedSDQuestion ?? null,
            cachedQuestionData: session.cachedQuestionData ?? new Map(),
            scratchpadOpened: session.scratchpadOpened,
            systemDesignExchangeCount: session.systemDesignExchangeCount,
            onSQLEditorOpened: () => startVoiceSQLPhaseTimers(session),
            onSQLPanelClosed: () => {
                clearVoiceSQLTimers(session);
                session.sqlSnapshot = null;
                session.sqlQuestionDescription = null;
            },
            onDSAEditorOpened: () => startVoiceDSAPhaseTimers(session),
            onDSAPanelClosed: () => clearVoiceDSATimers(session),
            emit: callbacks.emit,
        };

        const sqlOpenResult = await handleToolCall("open_sql_editor", {}, sqlOpenCtx);
        if (sqlOpenResult.startsWith("SQL editor opened")) {
            session.sqlEditorOpened = true;
            session.currentFundamentalsPhase = 'SQL';
            const sqlQuestion = [...session.cachedQuestionData.values()].find((q: any) => q?.category === "SQL") as any;
            if (sqlQuestion?.problemDescription) {
                session.sqlQuestionDescription = `${sqlQuestion.title || ""}\n\n${sqlQuestion.problemDescription}`;
            }
            session.history.push({
                role: "user",
                content:
                    "[SYSTEM NOTIFICATION] Candidate explicitly requested to move to SQL and SQL editor is now open. " +
                    "Proceed with SQL round immediately and do not continue DBMS questions.",
            });
            console.log(`[Voice] Deterministically opened SQL editor from candidate handoff intent for ${session.sessionId}`);
        }
    }

    // PM voice must not rely on the LLM to remember the next DB-backed phase.
    // After enough resume/product-ownership probing, force the live case and open the notepad.
    if (session.interviewType === "pm_role" && session.currentStage === "INTRO") {
        session.introExchangeCount++;
        const nextPMStage = getNextEnabledStage(session.stageOrder, "INTRO");
        const nextPMStageReady =
            nextPMStage === "PM_CASE" ? !!session.prefetchedPMCaseQuestion :
            nextPMStage === "PM_CONCEPTS" ? (session.prefetchedPMConceptQuestions || []).length > 0 :
            nextPMStage === "PM_STRATEGY" ? !!session.prefetchedPMStrategyQuestion :
            !!nextPMStage;
        if (
            nextPMStageReady &&
            (session.introExchangeCount >= PM_INTRO_FORCE_TRANSITION_THRESHOLD || isUnknownResponseIntent(userText) || isGenericMoveOnIntent(userText))
        ) {
            const q = session.prefetchedPMCaseQuestion;
            const nextStage = await transitionVoiceSessionToNextStage(
                session,
                callbacks,
                "Automatic transition from PM intro to the next enabled PM stage."
            );
            if (nextStage !== "PM_CASE") {
                if (nextStage && await speakCurrentRoleStageIntro(session, callbacks)) return;
                return;
            }

            // 1. Open the notepad panel — emit directly like system design does for scratchpad
            callbacks.emit("panel:open", {
                type: "notepad",
                stage: "PM_CASE",
                topic: q.title || "Product Case",
                template: "CIRCLES",
                initialContent: `<h2>1) Clarify -</h2><p></p><h2>2) Identify users -</h2><p></p><h2>3) Report needs -</h2><p></p><h2>4) Cut through prioritization -</h2><p></p><h2>5) List solutions -</h2><p></p><h2>6) Evaluate tradeoffs -</h2><p></p><h2>7) Summarize -</h2><p></p>`,
                scenario: q.scenario,
            });
            session.scratchpadOpened = true;

            // 2. Record the question
            await recordVoiceQuestion(session, q.questionId, q.scenario || q.title, "pm_case", q.difficulty, q.evaluationGuide);

            // 3. Speak the intro — same as system design speaks its intro
            const caseIntro =
                `We'll now move to a case study. ${q.scenario} ` +
                `Use the notepad to jot down your thoughts and frame your answer using the CIRCLES framework. ` +
                `Start by clarifying the problem, then walk me through your structure.`;

            callbacks.onAiTranscript(caseIntro);
            try {
                await textToSpeech(caseIntro, callbacks, new AbortController().signal);
            } catch (err: any) {
                console.error("[Voice] PM case intro TTS error:", err?.message);
            }
            callbacks.onTurnComplete();

            session.history.push({ role: "assistant", content: caseIntro });
            await prisma.sessionMessage.create({
                data: { sessionId: session.sessionId, role: "assistant", content: caseIntro, stage: "PM_CASE" },
            });

            // 4. Inject SYSTEM NOTIFICATION so next turn knows notepad is already open
            session.history.push({
                role: "user",
                content:
                    `[SYSTEM NOTIFICATION] PM case DB scenario is active: ID=${q.questionId}, title="${q.title}". ` +
                    "The CIRCLES notepad is already open — do NOT call open_notepad again. " +
                    "Use ONLY this case scenario. Do NOT invent a different product case.",
            });

            console.log(`[Voice] SERVER-GENERATED PM case intro for "${q.title}" (${session.sessionId})`);
            return; // exit — next user utterance triggers normal generateAndSpeak flow
        }
    }

    // DS voice needs the same server-owned bridge as PM. If the model remains
    // in INTRO, it can ask generic resume/ML questions forever and never reach
    // the prefetched DS bank, SQL editor, or coding IDE.
    if (session.interviewType === "data_science_role" && session.currentStage === "INTRO") {
        session.introExchangeCount++;
        const nextDSStage = getNextEnabledStage(session.stageOrder, "INTRO");
        const nextDSStageReady =
            nextDSStage === "DS_CONCEPTS" ? (session.prefetchedDSConceptQuestions || []).length > 0 :
            nextDSStage === "DS_SQL" ? !!session.prefetchedDSSQLQuestion :
            nextDSStage === "DS_CODING" ? !!session.prefetchedDSCodingQuestion :
            !!nextDSStage;
        if (session.introExchangeCount >= DATA_SCIENCE_INTRO_FORCE_TRANSITION_THRESHOLD && nextDSStageReady) {
            const nextStage = await transitionVoiceSessionToNextStage(
                session,
                callbacks,
                "Server-owned hard cap reached for Data Science INTRO.",
                { forceIntroExit: true }
            );
            if (nextStage && await speakCurrentRoleStageIntro(session, callbacks)) return;
        }
    }

    if (session.interviewType === "gen_ai_role" && session.currentStage === "INTRO") {
        session.introExchangeCount++;
        const weakAnswerCount = countWeakGenAIIntroAnswers(session.history);
        const nextGenAIStage = getNextEnabledStage(session.stageOrder, "INTRO");
        const nextGenAIStageReady =
            nextGenAIStage === "GEN_AI_CONCEPTS" ? (session.prefetchedGenAIConceptQuestions || []).length > 0 :
            nextGenAIStage === "GEN_AI_CODING" ? !!session.prefetchedGenAICodingQuestion :
            !!nextGenAIStage;

        if (
            nextGenAIStageReady &&
            (session.introExchangeCount >= GENAI_INTRO_FORCE_TRANSITION_THRESHOLD || weakAnswerCount >= 2 || isGenericMoveOnIntent(userText))
        ) {
            const nextStage = await transitionVoiceSessionToNextStage(
                session,
                callbacks,
                weakAnswerCount >= 2
                    ? "Candidate gave repeated weak/non-owner GenAI intro answers."
                    : "GenAI intro budget reached; moving to the next enabled GenAI stage.",
                { forceIntroExit: true }
            );
            if (nextStage && await speakCurrentRoleStageIntro(session, callbacks)) return;
        }

        if (weakAnswerCount > 0) {
            session.history.push({
                role: "user",
                content:
                    "[SYSTEM NOTIFICATION] This is a GenAI role interview, not a generic resume screen. " +
                    "Do not revisit projects that got weak/non-owner answers. Ask the next question about GenAI ownership, model/RAG/prompting choices, evaluation, hallucination, latency, or cost; or transition to GenAI fundamentals.",
            });
        }
    }

    // Server-owned DS concept progression. This prevents the voice model from
    // asking generic ML questions after the first DB question.
    if (session.interviewType === "data_science_role" && session.currentStage === "DS_CONCEPTS") {
        const askedConceptCount = (session.prefetchedDSConceptQuestions || [])
            .filter((q) => session.askedQuestionIds.includes(q.questionId)).length;

        if (isThinkingTimeRequest(userText)) {
            await speakAndPersist(session, "Sure, take your time. Let me know when you're ready.", "DS_CONCEPTS", callbacks);
            return;
        }

        if (askedConceptCount >= 4 || (askedConceptCount >= 1 && isGenericMoveOnIntent(userText))) {
            const nextStage = await transitionVoiceSessionToNextStage(
                session,
                callbacks,
                "DS concepts complete; moving to the next enabled DS stage."
            );
            if (nextStage && await speakCurrentRoleStageIntro(session, callbacks)) return;
        }

        if (
            session.currentDSConceptQuestionId &&
            (session.dsConceptFollowupCount || 0) < 1 &&
            !isUnknownResponseIntent(userText)
        ) {
            session.dsConceptFollowupCount = (session.dsConceptFollowupCount || 0) + 1;
            await handleInternalNudge(
                session,
                "[SYSTEM NOTIFICATION] Ask exactly one concise follow-up on the candidate's last answer to the current DS concept question. " +
                "Do not ask a new DB question yet. After the candidate answers this follow-up, continue to the next DB question."
            );
            return;
        }

        if (await askNextDSConcept(session, callbacks)) return;
    }

    if (session.interviewType === "gen_ai_role" && session.currentStage === "GEN_AI_CONCEPTS") {
        const askedConceptCount = (session.prefetchedGenAIConceptQuestions || [])
            .filter((q) => session.askedQuestionIds.includes(q.questionId)).length;

        if (isThinkingTimeRequest(userText)) {
            await speakAndPersist(session, "Sure, take your time. Let me know when you're ready.", "GEN_AI_CONCEPTS", callbacks);
            return;
        }

        if (askedConceptCount >= 4 || (askedConceptCount >= 1 && isGenericMoveOnIntent(userText))) {
            const nextStage = await transitionVoiceSessionToNextStage(
                session,
                callbacks,
                "GenAI concepts complete; moving to the next enabled GenAI stage."
            );
            if (nextStage && await speakCurrentRoleStageIntro(session, callbacks)) return;
        }

        if (isGenericMoveOnIntent(userText)) {
            if (await askNextGenAIConcept(session, callbacks)) return;
            const nextStage = await transitionVoiceSessionToNextStage(
                session,
                callbacks,
                "Candidate skipped the current GenAI concept; moving to the next enabled GenAI stage."
            );
            if (nextStage && await speakCurrentRoleStageIntro(session, callbacks)) return;
            return;
        }
    }

    if (session.interviewType === "data_science_role" && session.currentStage === "DS_SQL" && isGenericMoveOnIntent(userText)) {
        const nextStage = await transitionVoiceSessionToNextStage(
            session,
            callbacks,
            "Candidate moved on from SQL; moving to the next enabled DS stage."
        );
        if (!nextStage) return;
        session.sqlEditorOpened = false;
        if (await speakCurrentRoleStageIntro(session, callbacks)) return;
    }

    if (session.interviewType === "data_science_role" && session.currentStage === "DS_CODING" && isGenericMoveOnIntent(userText)) {
        callbacks.emit("panel:close", { summary: "DS coding round complete." });
        session.ideOpened = false;
        const nextStage = await transitionVoiceSessionToNextStage(
            session,
            callbacks,
            "Candidate moved on from DS coding."
        );
        if (nextStage && await speakCurrentRoleStageIntro(session, callbacks)) return;
    }

    if (
        session.interviewType === "data_science_role" &&
        session.currentStage === "DS_BUSINESS_CASE" &&
        (isGenericMoveOnIntent(userText) || /^\s*no\s*[.!?]?\s*$/i.test(userText))
    ) {
        const toolCtx = buildVoiceToolContext(session, callbacks);
        await handleToolCall(
            "end_interview",
            { summary: "Candidate skipped the final DSC business metrics case." },
            toolCtx
        );

        const finalLine = "Understood. We'll close the interview here. Thank you for your time today.";
        session.history.push({ role: "assistant", content: finalLine });
        await prisma.sessionMessage.create({
            data: {
                sessionId: session.sessionId,
                role: "assistant",
                content: finalLine,
                stage: "DS_BUSINESS_CASE",
            },
        });

        callbacks.onAiTranscript(finalLine);
        await textToSpeech(finalLine, callbacks, new AbortController().signal);
        callbacks.onTurnComplete();
        clearVoiceSQLTimers(session);
        clearVoiceDSATimers(session);
        return;
    }

    if (session.interviewType === "gen_ai_role" && session.currentStage === "GEN_AI_CODING" && isGenericMoveOnIntent(userText)) {
        callbacks.emit("panel:close", { summary: "GenAI coding round complete." });
        session.ideOpened = false;
        const nextStage = await transitionVoiceSessionToNextStage(
            session,
            callbacks,
            "Candidate moved on from GenAI coding."
        );
        if (!nextStage) return;
        if (await speakCurrentRoleStageIntro(session, callbacks)) return;
        if (nextStage === "CLOSING") {
            await speakAndPersist(
                session,
                "Understood. Let's move to one final AI responsibility scenario. Imagine a generative AI feature is creating user-impacting recommendations, and your team finds a serious quality or safety risk after launch. What steps would you take?",
                "CLOSING",
                callbacks
            );
            return;
        }
    }

    // Server-owned PM concept/strategy progression.
    if (session.interviewType === "pm_role" && session.currentStage === "PM_CASE" && isGenericMoveOnIntent(userText)) {
        callbacks.emit("panel:close", { summary: "Product case round complete." });
        session.scratchpadOpened = false;
        const nextStage = await transitionVoiceSessionToNextStage(
            session,
            callbacks,
            "Candidate moved on from PM case; moving to the next enabled PM stage."
        );
        if (nextStage && await speakCurrentRoleStageIntro(session, callbacks)) return;
    }

    if (session.interviewType === "pm_role" && session.currentStage === "PM_CONCEPTS") {
        const askedPMConceptCount = (session.prefetchedPMConceptQuestions || [])
            .filter((q) => session.askedQuestionIds.includes(q.questionId)).length;

        if (isThinkingTimeRequest(userText)) {
            await speakAndPersist(session, "Sure, take your time. Let me know when you're ready.", "PM_CONCEPTS", callbacks);
            return;
        }

        if (askedPMConceptCount >= 4 || (askedPMConceptCount >= 3 && isGenericMoveOnIntent(userText))) {
            const nextStage = await transitionVoiceSessionToNextStage(
                session,
                callbacks,
                "PM concepts complete; moving to the next enabled PM stage."
            );
            if (nextStage && await speakCurrentRoleStageIntro(session, callbacks)) return;
        }

        if (isGenericMoveOnIntent(userText)) {
            if (await askNextPMConcept(session, callbacks)) return;
            const nextStage = await transitionVoiceSessionToNextStage(
                session,
                callbacks,
                "Candidate skipped the current PM concept; moving to the next enabled PM stage."
            );
            if (nextStage && await speakCurrentRoleStageIntro(session, callbacks)) return;
            return;
        }

        if (
            session.currentPMConceptQuestionId &&
            (session.pmConceptFollowupCount || 0) < 1 &&
            !isUnknownResponseIntent(userText)
        ) {
            session.pmConceptFollowupCount = (session.pmConceptFollowupCount || 0) + 1;
            await handleInternalNudge(
                session,
                "[SYSTEM NOTIFICATION] Ask exactly one concise follow-up on the candidate's last answer to the current PM concept question. " +
                "Do not ask a new DB question yet. Do not invent any new PM question. After the candidate answers this follow-up, stop and wait; the server will provide the next DB concept question."
            );
            return;
        }

        if (await askNextPMConcept(session, callbacks)) return;
    }

    // Deterministic INTRO -> DSA handoff: if candidate explicitly asks
    // to start the coding round, transition immediately and open IDE.
    const nextAfterIntro = getNextEnabledStage(session.stageOrder, "INTRO");
    if (
        session.interviewType === "full_interview" &&
        session.currentStage === "INTRO" &&
        nextAfterIntro &&
        isIntroToDsaAdvanceIntent(userText)
    ) {
        const transitionCtx: ToolContext = {
            sessionId: session.sessionId,
            userId: session.userId,
            interviewType: session.interviewType,
            currentStage: session.currentStage,
            askedQuestionIds: session.askedQuestionIds,
            role: session.role,
            level: session.level,
            stageOrder: session.stageOrder,
            lastFetchedQuestionId: session.lastFetchedQuestionId,
            lastFetchedLanguage: session.lastFetchedLanguage,
            prefetchedDSAQuestion: session.prefetchedDSAQuestion ?? null,
            prefetchedBehavioralQuestions: session.prefetchedBehavioralQuestions,
            prefetchedSDQuestion: session.prefetchedSDQuestion ?? null,
            cachedQuestionData: session.cachedQuestionData ?? new Map(),
            scratchpadOpened: session.scratchpadOpened,
            systemDesignExchangeCount: session.systemDesignExchangeCount,
            resumeCloseoutAcknowledged: session.resumeCloseoutAcknowledged,
            emit: callbacks.emit,
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
            session.currentStage = nextAfterIntro;

            const ack = "Great, let's move forward now.";
            callbacks.onAiTranscript(ack);
            try {
                await textToSpeech(ack, callbacks, new AbortController().signal);
            } catch (err: any) {
                console.error("[Voice] INTRO->DSA ack TTS error:", err.message);
            }
            callbacks.onTurnComplete();

            session.history.push({ role: "assistant", content: ack });
            await prisma.sessionMessage.create({
                data: {
                    sessionId: session.sessionId,
                    role: "assistant",
                    content: ack,
                    stage: nextAfterIntro,
                },
            });

            await handleInternalNudge(
                session,
                "[SYSTEM NOTIFICATION] Candidate requested to move forward from INTRO. " +
                `${nextAfterIntro} stage is now active. Continue immediately with the current stage instructions.`
            );
            return;
        }
    }

    // Deterministic DSA handoff: if candidate explicitly asks to move on,
    // transition immediately to FUNDAMENTALS in full interview mode.
    const nextAfterDSA = getNextEnabledStage(session.stageOrder, "DSA");
    if (
        session.interviewType === "full_interview" &&
        session.currentStage === "DSA" &&
        nextAfterDSA &&
        isDsaAdvanceIntent(userText)
    ) {
        const transitionCtx: ToolContext = {
            sessionId: session.sessionId,
            userId: session.userId,
            interviewType: session.interviewType,
            currentStage: session.currentStage,
            askedQuestionIds: session.askedQuestionIds,
            role: session.role,
            level: session.level,
            stageOrder: session.stageOrder,
            lastFetchedQuestionId: session.lastFetchedQuestionId,
            lastFetchedLanguage: session.lastFetchedLanguage,
            prefetchedDSAQuestion: session.prefetchedDSAQuestion ?? null,
            prefetchedBehavioralQuestions: session.prefetchedBehavioralQuestions,
            prefetchedSDQuestion: session.prefetchedSDQuestion ?? null,
            cachedQuestionData: session.cachedQuestionData ?? new Map(),
            scratchpadOpened: session.scratchpadOpened,
            systemDesignExchangeCount: session.systemDesignExchangeCount,
            emit: callbacks.emit,
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
            session.currentStage = nextAfterDSA;
            clearVoiceDSATimers(session);

            const ack = "Understood. We'll move forward now.";
            callbacks.onAiTranscript(ack);
            try {
                await textToSpeech(ack, callbacks, new AbortController().signal);
            } catch (err: any) {
                console.error("[Voice] DSA skip ack TTS error:", err.message);
            }
            callbacks.onTurnComplete();

            session.history.push({ role: "assistant", content: ack });
            await prisma.sessionMessage.create({
                data: {
                    sessionId: session.sessionId,
                    role: "assistant",
                    content: ack,
                    stage: nextAfterDSA,
                },
            });

            await handleInternalNudge(
                session,
                "[SYSTEM NOTIFICATION] Candidate requested to skip the DSA problem and move forward. " +
                "Continue immediately with the current stage instructions. " +
                "Do NOT end interview and do NOT return to DSA."
            );
            return;
        }
    }

    // Deterministic safety net: auto-end during closing/final stage when
    // candidate indicates they are done. This avoids relying on LLM tool choice.
    const finalStage = session.stageOrder[session.stageOrder.length - 1];
    if (!finalStage) return;
    const wrapUpPrompted = didAssistantAskWrapUpQuestion(session.history);
    if (
        (session.currentStage === "CLOSING" || wrapUpPrompted) &&
        isQuestionOfferAffirmation(userText)
    ) {
        await speakAndPersist(session, "Sure, what would you like to ask?", session.currentStage, callbacks);
        return;
    }
    const resumeCloseoutQuestion =
        session.interviewType === "resume_round" &&
        (session.currentStage === "CLOSING" || wrapUpPrompted) &&
        isCloseoutQuestion(userText);
    const explicitEndIntent = !resumeCloseoutQuestion && isEndInterviewIntent(userText);
    const closingAckIntent = !resumeCloseoutQuestion && isClosingAcknowledgement(userText);
    const shouldForceClose =
        explicitEndIntent
            ? (
                session.currentStage === "CLOSING" ||
                session.currentStage === finalStage ||
                wrapUpPrompted ||
                (
                    session.currentStage === "SYSTEM_DESIGN" &&
                    session.scratchpadOpened &&
                    (wrapUpPrompted || (session.systemDesignExchangeCount ?? 0) >= 3)
                )
            )
            : closingAckIntent && (session.currentStage === "CLOSING" || wrapUpPrompted);

    // [ScreeningEnd] Instrument the practice-era heuristic closeout for company screening so we can
    // see if it (wrongly) fires mid-screen. This whole block still runs for screening today.
    if (session.companyScreening) {
        console.log(
            `[ScreeningEnd] closeout-eval ${session.sessionId} | stage=${session.currentStage} | userText="${(userText || "").slice(0, 40)}" | ` +
            `explicitEnd=${explicitEndIntent} closingAck=${closingAckIntent} wrapUp=${wrapUpPrompted} => shouldForceClose=${shouldForceClose}`
        );
    }

    if (shouldForceClose) {
        session.resumeCloseoutAcknowledged = session.interviewType === "resume_round" || session.resumeCloseoutAcknowledged;
        const toolCtx: ToolContext = {
            sessionId: session.sessionId,
            userId: session.userId,
            interviewType: session.interviewType,
            currentStage: session.currentStage,
            askedQuestionIds: session.askedQuestionIds,
            role: session.role,
            level: session.level,
            stageOrder: session.stageOrder,
            lastFetchedQuestionId: session.lastFetchedQuestionId,
            lastFetchedLanguage: session.lastFetchedLanguage,
            prefetchedDSAQuestion: session.prefetchedDSAQuestion ?? null,
            prefetchedBehavioralQuestions: session.prefetchedBehavioralQuestions,
            prefetchedSDQuestion: session.prefetchedSDQuestion ?? null,
            // ── GenAI fields ──────────────────────────────────────────────
            prefetchedGenAIConceptQuestions: session.prefetchedGenAIConceptQuestions,
            prefetchedGenAICodingQuestion: session.prefetchedGenAICodingQuestion ?? null,
            prefetchedGenAISystemDesignQuestion: session.prefetchedGenAISystemDesignQuestion ?? null,
            // ── Data Science Role fields ──────────────────────────────────
            prefetchedDSConceptQuestions: session.prefetchedDSConceptQuestions,
            prefetchedDSSQLQuestion: session.prefetchedDSSQLQuestion ?? null,
            prefetchedDSCodingQuestion: session.prefetchedDSCodingQuestion ?? null,
            cachedQuestionData: session.cachedQuestionData ?? new Map(),
            onRubricLiteLoaded: (rubricLite: any) => {
                session.rubricLite = rubricLite;
            },
            scratchpadOpened: session.scratchpadOpened,
            systemDesignExchangeCount: session.systemDesignExchangeCount,
            resumeCloseoutAcknowledged: session.resumeCloseoutAcknowledged,
            emit: callbacks.emit,
        };

        if (session.interviewType === "resume_round" && session.currentStage !== "CLOSING") {
            let nextStage = getNextEnabledStage(session.stageOrder, session.currentStage);
            while (nextStage && nextStage !== session.currentStage) {
                const transitionResult = await handleToolCall(
                    "transition_stage",
                    { nextStage, reason: "Candidate acknowledged resume closeout; server is closing the screening round." },
                    toolCtx
                );
                if (!transitionResult.startsWith("Interview transitioned")) {
                    console.warn(
                        `[Voice][ResumeAgenda] Closeout transition blocked for ${session.sessionId.slice(0, 8)}... ` +
                        `from=${session.currentStage} to=${nextStage}: ${transitionResult}`
                    );
                    break;
                }
                session.currentStage = nextStage;
                toolCtx.currentStage = nextStage;
                if (nextStage === "CLOSING") break;
                nextStage = getNextEnabledStage(session.stageOrder, session.currentStage);
            }
            if (session.currentStage !== "CLOSING") {
                session.currentStage = "CLOSING";
                toolCtx.currentStage = "CLOSING";
                await prisma.interviewSession.update({
                    where: { id: session.sessionId },
                    data: { stage: "CLOSING" },
                    select: { id: true },
                });
            }
        } else if (session.currentStage !== finalStage) {
            const transitionResult = await handleToolCall(
                "transition_stage",
                { nextStage: finalStage, reason: "Candidate indicated no further questions." },
                toolCtx
            );
            if (transitionResult.startsWith("Interview transitioned")) {
                session.currentStage = finalStage;
                toolCtx.currentStage = finalStage;
            } else {
                const endingSession = await prisma.interviewSession.findUnique({
                    where: { id: session.sessionId },
                    select: { mode: true },
                });
                const isCompanyScreening = endingSession?.mode === "company_screening";
                await prisma.interviewSession.update({
                    where: { id: session.sessionId },
                    data: { status: "COMPLETED", completedAt: new Date() },
                    select: { id: true },
                });
                if (!isCompanyScreening) {
                    await settleInterviewMinuteReservation(session.userId, session.sessionId);
                }
                callbacks.emit("session:ending", {
                    message: isCompanyScreening
                        ? "Interview complete. Submitting your screening..."
                        : "Interview complete! Generating your evaluation report...",
                });
            }
        }

        const endResult = await handleToolCall(
            "end_interview",
            { summary: "Candidate indicated no further questions and requested to conclude." },
            toolCtx
        );
        if (!endResult.startsWith("Interview ended.")) {
            console.warn(
                `[Voice] end_interview did not complete for ${session.sessionId.slice(0, 8)}... ` +
                `stage=${toolCtx.currentStage}: ${endResult}`
            );
            session.history.push({
                role: "user",
                content:
                    "[SYSTEM NOTIFICATION] The candidate has acknowledged closeout, but end_interview was blocked. " +
                    "Do not ask another interview question. End the interview now.",
            });
            await generateAndSpeak(session, callbacks);
            return;
        }

        const finalLine = "Thank you for your time today. Goodbye.";
        session.history.push({ role: "assistant", content: finalLine });
        await prisma.sessionMessage.create({
            data: {
                sessionId: session.sessionId,
                role: "assistant",
                content: finalLine,
                stage: session.currentStage,
            },
        });

        callbacks.onAiTranscript(finalLine);
        await textToSpeech(finalLine, callbacks, new AbortController().signal);
        callbacks.onTurnComplete();
        return;
    }


    // ── FORCE TRANSITION: INTRO → SYSTEM_DESIGN after N exchanges ──
    // The LLM does NOT reliably call transition_stage. It stays in INTRO
    // forever, asks design questions verbally, and ends without tools.
    // We force the transition from code — the LLM has no say in this.
    if (
        session.currentStage === "INTRO" &&
        session.interviewType === "system_design"
    ) {
        session.introExchangeCount++;
        console.log(
            `[Voice] INTRO exchange #${session.introExchangeCount}/${SYSTEM_DESIGN_INTRO_FORCE_TRANSITION_THRESHOLD} for ${session.sessionId}`
        );

        if (session.introExchangeCount >= SYSTEM_DESIGN_INTRO_FORCE_TRANSITION_THRESHOLD) {
            console.log(
                `[Voice] ★★★ FORCE-TRANSITIONING INTRO → SYSTEM_DESIGN for ${session.sessionId}`
            );

            // 1. Update database
            await prisma.interviewSession.update({
                where: { id: session.sessionId },
                data: { stage: "SYSTEM_DESIGN" },
                select: { id: true },
            });

            // 2. Update session state
            session.currentStage = "SYSTEM_DESIGN";
            session.systemDesignExchangeCount = 0;

            // 3. Emit stage change to frontend
            callbacks.emit("stage:change", {
                stage: "SYSTEM_DESIGN",
                reason: "Automatic transition from INTRO after background discussion",
            });

            // 4. SERVER-GENERATED SD INTRO — no LLM involvement
            if (session.prefetchedSDQuestion) {
                const sdTitle = session.prefetchedSDQuestion.title;

                // Auto-open scratchpad
                if (!session.scratchpadOpened) {
                    callbacks.emit("panel:open", buildVoiceSystemDesignPanelPayload(session));
                    session.scratchpadOpened = true;
                }

                // Speak the hardcoded intro directly
                const sdIntroContent =
                    `Thanks. Let's move to the design problem. ` +
                    `Let's design ${sdTitle}. The whiteboard is already open. ` +
                    `Go ahead and start sketching your design and walk me through your thinking. ` +
                    `Let's begin by discussing the functional and non-functional requirements.`;

                const abortCtrl = new AbortController();
                session.callbacks.onAiTranscript(sdIntroContent);
                try {
                    await textToSpeech(sdIntroContent, callbacks, abortCtrl.signal);
                } catch (err: any) {
                    console.error("[Voice] Force-transition SD intro TTS error:", err.message);
                }
                callbacks.onTurnComplete();

                // Save to history and DB
                session.history.push({ role: "assistant", content: sdIntroContent });
                await prisma.sessionMessage.create({
                    data: {
                        sessionId: session.sessionId,
                        role: "assistant",
                        content: sdIntroContent,
                        stage: "SYSTEM_DESIGN",
                    },
                });

                console.log(`[Voice] SERVER-GENERATED SD intro (force-transition): "${sdTitle}" (${session.sessionId})`);
                return; // Done — next user utterance triggers normal SYSTEM_DESIGN flow
            }

            // Fallback path: prefetch failed, but still open scratchpad so candidate can proceed.
            if (!session.scratchpadOpened) {
                callbacks.emit("panel:open", buildVoiceSystemDesignPanelPayload(session));
                session.scratchpadOpened = true;
                console.warn(
                    `[Voice] SD prefetch missing during force-transition; opened generic scratchpad for ${session.sessionId}`
                );
            }

            const fallbackIntro =
                "Thanks. Let's move into the system design round. " +
                "The whiteboard is now open on your screen. " +
                "Start by listing the top functional and non-functional requirements.";

            const fallbackAbort = new AbortController();
            session.callbacks.onAiTranscript(fallbackIntro);
            try {
                await textToSpeech(fallbackIntro, callbacks, fallbackAbort.signal);
            } catch (err: any) {
                console.error("[Voice] Force-transition fallback SD intro TTS error:", err.message);
            }
            callbacks.onTurnComplete();

            session.history.push({ role: "assistant", content: fallbackIntro });
            await prisma.sessionMessage.create({
                data: {
                    sessionId: session.sessionId,
                    role: "assistant",
                    content: fallbackIntro,
                    stage: "SYSTEM_DESIGN",
                },
            });

            return;
        }
    }

    // ── FORCE TRANSITION: FULL INTRO -> DSA after enough background probing ──
    // Server-owned bridge prevents repeated resume loops and mixed INTRO/DSA speech.
    if (session.currentStage === "INTRO" && session.interviewType === "full_interview") {
        session.introExchangeCount++;
        const shouldForceDsa =
            session.introExchangeCount >= FULL_INTERVIEW_INTRO_FORCE_TRANSITION_THRESHOLD ||
            isHostileOrRepeatedRefusal(userText) ||
            isIntroToDsaAdvanceIntent(userText);

        const nextAfterIntroForForce = getNextEnabledStage(session.stageOrder, "INTRO");
        if (shouldForceDsa && nextAfterIntroForForce === "DSA" && session.prefetchedDSAQuestion) {
            const toolCtx = buildVoiceToolContext(session, callbacks);
            if (session.introExchangeCount >= FULL_INTERVIEW_INTRO_FORCE_TRANSITION_THRESHOLD) {
                toolCtx.forceIntroExit = true;
            }
            const transitionResult = await handleToolCall(
                "transition_stage",
                {
                    nextStage: "DSA",
                    reason: toolCtx.forceIntroExit
                        ? "Server-owned hard cap reached for Full Interview INTRO."
                        : "Server-owned handoff after resume/background discussion.",
                },
                toolCtx
            );

            if (transitionResult.startsWith("Interview transitioned")) {
                session.currentStage = "DSA";
                toolCtx.currentStage = "DSA";
                session.currentQuestionTitle = session.prefetchedDSAQuestion.title;
                session.lastFetchedQuestionId = session.prefetchedDSAQuestion.id;
                session.ideOpened = true;

                const dsaIntro =
                    `Let's move on to the coding problem. The problem is "${session.prefetchedDSAQuestion.title}". ` +
                    "Before you start coding, walk me through your initial approach and the data structures you would consider.";

                callbacks.onAiTranscript(dsaIntro);
                try {
                    await textToSpeech(dsaIntro, callbacks, new AbortController().signal);
                } catch (err: any) {
                    console.error("[Voice] Full interview DSA intro TTS error:", err?.message);
                }
                callbacks.onTurnComplete();

                session.history.push({ role: "assistant", content: dsaIntro });
                await prisma.sessionMessage.create({
                    data: { sessionId: session.sessionId, role: "assistant", content: dsaIntro, stage: "DSA" },
                });
                session.history.push({
                    role: "user",
                    content:
                        "[SYSTEM NOTIFICATION] Server transitioned INTRO to DSA and already introduced the pinned coding problem. " +
                        "Do not ask any more resume/background questions. Continue only with the DSA problem.",
                });
                return;
            }
        }
    }

    // The LLM cannot reliably count exchanges or call tools on command,
    // so we DIRECTLY open the scratchpad from code (bypassing the LLM).
    if (
        session.currentStage === "SYSTEM_DESIGN" &&
        userText
    ) {
        session.systemDesignExchangeCount++;
        console.log(
            `[Voice] SYSTEM_DESIGN exchange #${session.systemDesignExchangeCount}/${SD_SCRATCHPAD_FORCE_THRESHOLD} for ${session.sessionId}`
        );

        // Also detect if the user explicitly asks for the scratchpad
        const userWantsScratchpad = /scratchpad|whiteboard|diagram|draw/i.test(userText);

        if (
            !session.scratchpadOpened &&
            (session.systemDesignExchangeCount >= SD_SCRATCHPAD_FORCE_THRESHOLD || userWantsScratchpad)
        ) {
            const reason = userWantsScratchpad
                ? "user requested"
                : `hit ${SD_SCRATCHPAD_FORCE_THRESHOLD} exchanges`;
            console.log(
                `[Voice] FORCE-OPENING scratchpad for ${session.sessionId} (${reason})`
            );

            callbacks.emit("panel:open", buildVoiceSystemDesignPanelPayload(session));

            session.scratchpadOpened = true;

            session.history.push({
                role: "user",
                content:
                    "[SYSTEM NOTIFICATION] The scratchpad/whiteboard has been opened automatically. " +
                    "It is now visible to the candidate. Do NOT call open_scratchpad — it is already open. " +
                    "Your next response should be brief: ask the candidate to diagram their high-level " +
                    "architecture on the whiteboard.",
            });
        }
    }

    await generateAndSpeak(session, callbacks);
}

async function handleInternalNudge(
    session: VoiceSession,
    instructionText: string
): Promise<void> {
    // Internal instructions should guide model behavior without polluting DB transcript.
    session.history.push({ role: "user", content: instructionText });
    await generateAndSpeak(session, session.callbacks);
}

function getCSTheoryTopics(session: VoiceSession): string[] {
    const options = session.moduleConfig?.stageOptions?.FUNDAMENTALS || {};
    return (Array.isArray(options.topics)
        ? options.topics
        : [...(session.prefetchedCSQuestions?.keys() || [])].filter((topic) => topic !== "SQL_query")
    ).filter((topic: string) => session.prefetchedCSQuestions?.has(topic));
}

function getCSPhaseOrder(session: VoiceSession): string[] {
    const options = session.moduleConfig?.stageOptions?.FUNDAMENTALS || {};
    const selectedTopics = getCSTheoryTopics(session);
    return [
        ...selectedTopics.slice(0, 1),
        ...(options.includeSQL === false ? [] : ["SQL"]),
        ...selectedTopics.slice(1),
    ];
}

function getCurrentCSPhase(session: VoiceSession): string {
    const phaseOrder = getCSPhaseOrder(session);
    if (session.currentFundamentalsPhase === "CLOSING") {
        return "CLOSING";
    }
    return session.currentFundamentalsPhase && phaseOrder.includes(session.currentFundamentalsPhase)
        ? session.currentFundamentalsPhase
        : phaseOrder[0] || "DBMS";
}

function getNextCSPhase(session: VoiceSession, currentPhase: string = getCurrentCSPhase(session)): string | null {
    const phaseOrder = getCSPhaseOrder(session);
    const next = phaseOrder[phaseOrder.indexOf(currentPhase) + 1];
    return next || null;
}

/**
 * Auto-advances the fundamentals sub-phase for theory categories (OS→CN, CN→OOPS)
 * when all questions in the current phase have been asked (tracked via record_question).
 * DBMS→SQL and SQL→OS transitions are handled elsewhere (SQL editor open/close events).
 */
function advanceFundamentalsPhase(session: VoiceSession): void {
    if (session.currentStage !== "FUNDAMENTALS") return;
    if (!session.prefetchedCSQuestions || session.prefetchedCSQuestions.size === 0) return;

    const currentDynamicPhase = getCurrentCSPhase(session);
    const nextDynamicPhase = getNextCSPhase(session, currentDynamicPhase);
    if (!nextDynamicPhase) return;

    const currentQuestions = session.prefetchedCSQuestions.get(currentDynamicPhase) || [];
    const dynamicAskedIds = new Set(session.askedQuestionIds);
    const allCurrentAsked = currentQuestions.length > 0 && currentQuestions.every(q => dynamicAskedIds.has(q.questionId));
    if (allCurrentAsked) {
        session.currentFundamentalsPhase = nextDynamicPhase;
        console.log(`[Voice] Auto-advanced fundamentals phase: ${currentDynamicPhase} -> ${nextDynamicPhase}`);
    }
    return;

    const THEORY_ADVANCE_ORDER: Record<string, string> = {
        DBMS: "SQL",  // After DBMS, go to SQL (handled by SQL editor open, but provide fallback)
        OS: "CN",
        CN: "OOPS",
    };

    const currentPhase = session.currentFundamentalsPhase || "DBMS";
    const nextPhase = THEORY_ADVANCE_ORDER[currentPhase];
    if (!nextPhase) return; // Already at OOPS or SQL (non-theory)

    // For DBMS→SQL: don't auto-advance here if SQL editor hasn't opened yet
    // That transition is driven by the SQL editor open event
    if (currentPhase === "DBMS") {
        // Only auto-advance DBMS→SQL if ALL DBMS questions are asked
        const dbmsQuestions = session.prefetchedCSQuestions.get("DBMS") || [];
        const askedIds = new Set(session.askedQuestionIds);
        const allDbmsAsked = dbmsQuestions.length > 0 && dbmsQuestions.every(q => askedIds.has(q.questionId));
        if (allDbmsAsked && !session.currentFundamentalsPhase) {
            // DBMS done but no explicit phase set yet → move to SQL
            session.currentFundamentalsPhase = "SQL";
            console.log(`[Voice] Auto-advanced fundamentals phase: DBMS → SQL`);
        }
        return;
    }

    // For OS→CN and CN→OOPS: check if all questions in current phase are asked
    const questions = session.prefetchedCSQuestions.get(currentPhase) || [];
    const askedIds = new Set(session.askedQuestionIds);
    const allAsked = questions.length > 0 && questions.every(q => askedIds.has(q.questionId));

    if (allAsked) {
        session.currentFundamentalsPhase = nextPhase;
        console.log(`[Voice] Auto-advanced fundamentals phase: ${currentPhase} → ${nextPhase}`);
    }
}

async function generateAndSpeak(
    session: VoiceSession,
    callbacks: VoiceSessionCallbacks
): Promise<void> {
    session.isGenerating = true;
    session.abortController = new AbortController();
    const signal = session.abortController.signal;
    let handedOff = false; // true when we hand off to a new generateAndSpeak (transition_stage)

    try {
        // Build system prompt
        // Auto-advance fundamentals theory phases before building prompt
        advanceFundamentalsPhase(session);
        if (
            session.currentStage === "FUNDAMENTALS" &&
            getCurrentCSPhase(session) === "SQL" &&
            !session.sqlEditorOpened &&
            !session.sqlRoundCompleted
        ) {
            const sqlOpenResult = await handleToolCall("open_sql_editor", {}, buildVoiceToolContext(session, callbacks));
            if (sqlOpenResult.startsWith("SQL editor opened")) {
                session.sqlEditorOpened = true;
                session.currentFundamentalsPhase = "SQL";
                const sqlQuestion = [...session.cachedQuestionData.values()].find((q: any) => q?.category === "SQL") as any;
                if (sqlQuestion) {
                    session.currentQuestionTitle = sqlQuestion.title || session.currentQuestionTitle;
                    session.sqlQuestionDescription = `${sqlQuestion.title || ""}\n\n${sqlQuestion.description || sqlQuestion.problemDescription || ""}`;
                }
                session.history.push({
                    role: "user",
                    content:
                        "[SYSTEM NOTIFICATION] The SQL editor is already open with the preloaded SQL problem. " +
                        `${describeVoiceSqlQuestion(sqlQuestion)} ` +
                        "Do not mention CS Fundamentals, phases, configuration, QUESTION BANK, or internal ordering.",
                });
            }
        }

        const basePrompt = buildSystemPrompt({
            interviewType: session.interviewType,
            moduleConfig: session.moduleConfig,
            role: session.role,
            level: session.level,
            stage: session.currentStage,
            // Screening supplies per-phase behaviour via runtimeDirective; do not layer in the
            // behavioural stage prompt (it would force behavioural questions every turn).
            suppressStagePrompt: Boolean(session.companyScreening),
            stageOrder: session.stageOrder,
            resumeSummary: session.resumeSummary,
            currentQuestionTitle: session.currentQuestionTitle,
            codeSnapshot: session.codeSnapshot,
            codeLanguage: session.codeLanguage,
            sqlSnapshot: session.sqlSnapshot,
            sqlQuestionDescription: session.sqlQuestionDescription,
            sqlRoundCompleted: session.sqlRoundCompleted,
            rubricLite: session.rubricLite,
            canvasSnapshot: session.canvasSnapshot,
            notepadSnapshot: session.notepadSnapshot,
            prefetchedCSQuestions: session.prefetchedCSQuestions,
            prefetchedSDQuestion: session.prefetchedSDQuestion ?? null,
            prefetchedDSAQuestion: session.prefetchedDSAQuestion
                ? {
                    id: session.prefetchedDSAQuestion.id, title: session.prefetchedDSAQuestion.title,
                    difficulty: session.prefetchedDSAQuestion.difficulty
                }
                : null,
            askedQuestionIds: new Set(session.askedQuestionIds),
            currentFundamentalsPhase: session.currentFundamentalsPhase,
            resumeProbeState: session.resumeProbeState,
            resumeAgendaState: session.resumeAgendaState,
            // ── GenAI fields ──────────────────────────────────────────────────
            prefetchedGenAIConceptQuestions: session.prefetchedGenAIConceptQuestions,
            prefetchedGenAICodingQuestion: session.prefetchedGenAICodingQuestion ?? null,
            prefetchedGenAISystemDesignQuestion: session.prefetchedGenAISystemDesignQuestion ?? null,
            // ── Data Science Role fields ──────────────────────────────────────
            prefetchedDSConceptQuestions: session.prefetchedDSConceptQuestions,
            prefetchedDSSQLQuestion: session.prefetchedDSSQLQuestion ?? null,
            prefetchedDSCodingQuestion: session.prefetchedDSCodingQuestion ?? null,
            prefetchedPMCaseQuestion: session.prefetchedPMCaseQuestion ?? null,
            prefetchedPMConceptQuestions: session.prefetchedPMConceptQuestions,
            prefetchedPMStrategyQuestion: session.prefetchedPMStrategyQuestion ?? null,
            prefetchedProblemSolvingCaseQuestion: session.prefetchedProblemSolvingCaseQuestion ?? null,
            runtimeDirective: buildCompanyScreeningRuntimeDirective(
                session.companyScreening,
                session.currentStage,
                session.companyScreening
                    ? {
                        elapsedMinutes: Math.max(0, (Date.now() - new Date(session.startedAt).getTime()) / 60000),
                        totalMinutes: Number(session.companyScreening.blueprintSnapshot.durationMinutes) || 30,
                        answeredQuestionIds: session.companyScreeningAskedQuestionIds
                            ? Array.from(session.companyScreeningAskedQuestionIds)
                            : [],
                    }
                    : null,
                // The server-authoritative turn resolved by the pacing pointer this turn
                // (assigns the exact question, follow-up cap, and closing step).
                session.companyScreeningAuthoritativeTurn ?? null,
                // The reused per-phase behaviour for the phase the server is on.
                session.companyScreeningCurrentPhaseType ?? null,
                // Per-phase grounding / concept bank (reference answers) for the current phase.
                buildScreeningPhaseSupplement(session.companyScreeningCurrentPhaseType ?? null, session.companyScreeningPhasePrefetch ?? null)
            ),
        });
        const voiceDirectives = buildVoiceDirectives(session.interviewType, session.stageOrder, {
            // Screening drives phases via the runtime directive, not the behavioural type notes.
            suppressTypeNotes: Boolean(session.companyScreening),
        });
        // Put static voice directives before volatile turn context so prompt-prefix
        // caching can reuse more tokens across turns.
        const systemPrompt = `${voiceDirectives}\n${basePrompt}`;

        // Get tools for current state. Company screening builds its tool list PHASE-based via its
        // own module (decoupled from the practice stage machine); practice is untouched.
        const tools = session.companyScreening
            ? buildScreeningTools(
                phaseTypeForQuestionId(
                    session.companyScreening.blueprintSnapshot,
                    session.companyScreeningCurrentQuestionId
                ),
                session.currentStage === "CLOSING"
            )
            : getToolsForSession(
                session.interviewType,
                session.currentStage,
                session.stageOrder
            );
        const allowedToolNameSet = new Set<string>();
        for (const tool of tools) {
            if (tool.type === "function") {
                allowedToolNameSet.add(tool.function.name);
            }
        }

        // Build messages array: system + trimmed history
        const recentHistory = session.history.slice(-MAX_CONTEXT_MESSAGES * 2);
        const messages: ChatCompletionMessageParam[] = [
            { role: "system", content: systemPrompt },
            ...recentHistory,
        ];

        let fullAiText = "";
        let stepsRemaining = 5;
        let ttsChain = Promise.resolve();
        let resumeAgendaItemIdForAssistantQuestion: string | undefined;
        const suppressLiveIntroStreaming =
            (session.interviewType === "system_design" || session.interviewType === "behavioural") &&
            session.currentStage === "INTRO";

        // ── Resume web context injection from pre-cached init-time fetch ────────
        // The web search was fired at session init (during loading screen).
        // Here we just consume the cached result — zero additional latency.
        if (
            session.currentStage === "INTRO" &&
            RESUME_WEB_SEARCH_TYPES.has(session.interviewType) &&
            session.resumeWebSearchContext &&
            !session.resumeWebSearchInjected
        ) {
            session.resumeWebSearchInjected = true;
            const notification = buildResumeWebContextNotification(session.resumeWebSearchContext);
            session.history.push({ role: "user", content: notification });
            messages.push({ role: "user", content: notification });
        }

        while (stepsRemaining-- > 0) {
            if (signal.aborted) break;

            // Wait for any pending TTS from previous iteration before next LLM call
            await ttsChain;
            const resumeAgendaItemIdBeforeModelStep =
                session.interviewType === "resume_round"
                    ? getActiveResumeAgendaItem(session.resumeAgendaState)?.id
                    : undefined;

            const stream = await (getXAIClient().chat.completions.create({
                model: XAI_MODEL,
                messages,
                tools,
                stream: true,
            } as any) as any);

            // Accumulate tool calls by index (streamed incrementally)
            const toolCalls: Array<{ id: string; name: string; arguments: string }> = [];
            let textBuffer = "";
            let sentenceBuffer = "";

            // Stream LLM text → extract sentences → TTS each as soon as
            // a sentence boundary is detected (runs in parallel with LLM)
            for await (const chunk of stream) {
                if (signal.aborted) break;

                const delta = chunk.choices[0]?.delta;
                if (!delta) continue;

                if (delta.content) {
                    textBuffer += delta.content;
                    fullAiText += delta.content;
                    const spokenDelta = sanitizeSpokenInterviewText(delta.content, { trim: false });

                    // Stream transcript to frontend immediately, except System Design INTRO
                    // where we must inspect the full turn before allowing speech through.
                    if (spokenDelta && !suppressLiveIntroStreaming) {
                        callbacks.onAiTranscript(spokenDelta);
                    }

                    // Extract speech chunks at clause boundaries and fire TTS immediately
                    if (!suppressLiveIntroStreaming) {
                        sentenceBuffer += spokenDelta;
                        const { chunks, remaining } = extractSpeechChunks(sentenceBuffer);
                        sentenceBuffer = remaining;

                        for (const chunk of chunks) {
                            ttsChain = ttsChain.then(async () => {
                                if (signal.aborted) return;
                                try {
                                    await textToSpeech(chunk, callbacks, signal);
                                } catch (err: any) {
                                    if (!signal.aborted) console.error("[Voice] TTS chunk error:", err.message);
                                }
                            });
                        }
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
            if (textBuffer.trim()) {
                resumeAgendaItemIdForAssistantQuestion = resumeAgendaItemIdBeforeModelStep;
            }
            const sanitizedToolCalls = splitToolCallsByAvailability(completedToolCalls, allowedToolNameSet);

            if (sanitizedToolCalls.rejectedToolCalls.length > 0) {
                console.warn(
                    `[Voice] Ignoring unavailable tool calls for ${session.sessionId} in ${session.currentStage}: ` +
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

            // Flush any remaining text in the sentence buffer to TTS
            if (sentenceBuffer.trim()) {
                const remaining = sentenceBuffer.trim();
                ttsChain = ttsChain.then(async () => {
                    if (signal.aborted) return;
                    try {
                        await textToSpeech(remaining, callbacks, signal);
                    } catch (err: any) {
                        if (!signal.aborted) console.error("[Voice] TTS remaining error:", err.message);
                    }
                });
            }

            if (sanitizedToolCalls.allowedToolCalls.length === 0) {
                if (sanitizedToolCalls.rejectedToolCalls.length > 0) {
                    continue;
                }
                // Final turn — wait for all TTS to finish
                await ttsChain;
                break;
            }

            // Tool call turn — wait for any in-flight TTS before executing tools
            await ttsChain;

            // ── Execute tool calls ─────────────────────────────
            // Add assistant message with tool calls to messages
            messages.push({
                role: "assistant",
                content: textBuffer || null,
                tool_calls: sanitizedToolCalls.allowedToolCalls.map(tc => ({
                    id: tc.id,
                    type: "function" as const,
                    function: { name: tc.name, arguments: tc.arguments },
                })),
            });

            const toolCtx: ToolContext = {
                sessionId: session.sessionId,
                userId: session.userId,
                interviewType: session.interviewType,
                currentStage: session.currentStage,
                askedQuestionIds: session.askedQuestionIds,
                role: session.role,
                level: session.level,
                stageOrder: session.stageOrder,
                lastFetchedQuestionId: session.lastFetchedQuestionId,
                lastFetchedLanguage: session.lastFetchedLanguage,
                prefetchedDSAQuestion: session.prefetchedDSAQuestion ?? null,
                prefetchedBehavioralQuestions: session.prefetchedBehavioralQuestions,
                prefetchedCSQuestions: session.prefetchedCSQuestions,
                prefetchedSDQuestion: session.prefetchedSDQuestion ?? null,
                // ── GenAI fields ──────────────────────────────────────────────
                prefetchedGenAIConceptQuestions: session.prefetchedGenAIConceptQuestions,
                prefetchedGenAICodingQuestion: session.prefetchedGenAICodingQuestion ?? null,
                prefetchedGenAISystemDesignQuestion: session.prefetchedGenAISystemDesignQuestion ?? null,
                // ── Data Science Role fields ──────────────────────────────────
                prefetchedDSConceptQuestions: session.prefetchedDSConceptQuestions,
                prefetchedDSSQLQuestion: session.prefetchedDSSQLQuestion ?? null,
                prefetchedDSCodingQuestion: session.prefetchedDSCodingQuestion ?? null,
                prefetchedPMCaseQuestion: session.prefetchedPMCaseQuestion ?? null,
                prefetchedPMConceptQuestions: session.prefetchedPMConceptQuestions,
                prefetchedPMStrategyQuestion: session.prefetchedPMStrategyQuestion ?? null,
                prefetchedProblemSolvingCaseQuestion: session.prefetchedProblemSolvingCaseQuestion ?? null,
                resumeProbeState: session.resumeProbeState,
                onResumeProbeRecorded: (resumeProbeState) => {
                    session.resumeProbeState = resumeProbeState;
                    toolCtx.resumeProbeState = resumeProbeState;
                },
                resumeAgendaState: session.resumeAgendaState,
                onResumeAgendaRecorded: (resumeAgendaState) => {
                    session.resumeAgendaState = resumeAgendaState;
                    toolCtx.resumeAgendaState = resumeAgendaState;
                },
                resumeCloseoutAcknowledged: session.resumeCloseoutAcknowledged,
                cachedQuestionData: session.cachedQuestionData ?? new Map(),
                onRubricLiteLoaded: (rubricLite: any) => {
                    session.rubricLite = rubricLite;
                },
                onSQLEditorOpened: () => startVoiceSQLPhaseTimers(session),
                onSQLPanelClosed: () => {
                    clearVoiceSQLTimers(session);
                    session.sqlSnapshot = null;
                    session.sqlQuestionDescription = null;
                },
                onDSAEditorOpened: () => startVoiceDSAPhaseTimers(session),
                onDSAPanelClosed: () => clearVoiceDSATimers(session),
                scratchpadOpened: session.scratchpadOpened,
                systemDesignExchangeCount: session.systemDesignExchangeCount,
                introExchangeCount: session.introExchangeCount,
                emit: callbacks.emit,
            };

            const actionPlan = buildServerActionPlan(sanitizedToolCalls.allowedToolCalls);

            for (const deferredResponse of actionPlan.deferredToolResponses) {
                messages.push({
                    role: "tool",
                    tool_call_id: deferredResponse.toolCallId,
                    content: deferredResponse.content,
                });
            }

            let contextChanged = false;
            let endInterviewCalled = false;
            let stageTransitionApplied = false;
            let transitionedIntroToDsa = false;
            const hasExplicitScratchpadOpen = actionPlan.passthroughToolCalls.some(
                (toolCall) => toolCall.name === "open_scratchpad"
            );

            for (const tc of actionPlan.passthroughToolCalls) {
                let toolArgs: Record<string, any> = {};
                try {
                    toolArgs = JSON.parse(tc.arguments || "{}");
                } catch {
                    messages.push({
                        role: "tool",
                        tool_call_id: tc.id,
                        content: `Invalid JSON arguments for tool ${tc.name}.`,
                    });
                    continue;
                }

                const resultStr = await handleToolCall(
                    tc.name as any,
                    toolArgs,
                    toolCtx
                );

                messages.push({
                    role: "tool",
                    tool_call_id: tc.id,
                    content: resultStr,
                });

                // Sync stage
                if (session.currentStage !== toolCtx.currentStage) {
                    session.currentStage = toolCtx.currentStage;
                    contextChanged = true;
                }

                // Track question title and ID
                if (tc.name === "fetch_question") {
                    try {
                        const parsed = JSON.parse(resultStr);
                        if (parsed.questionId) {
                            session.lastFetchedQuestionId = parsed.questionId;
                            toolCtx.lastFetchedQuestionId = parsed.questionId;
                        }
                        if (parsed.title && session.currentQuestionTitle !== parsed.title) {
                            session.currentQuestionTitle = parsed.title;
                            contextChanged = true;
                        }
                        // Track SQL question description so system prompt always includes it
                        if (parsed.category === "SQL" && parsed.problemDescription) {
                            session.sqlQuestionDescription = `${parsed.title || ""}\n\n${parsed.problemDescription}`;
                        }

                        // System Design fallback: if the model fetched a question but forgot
                        // to call open_scratchpad in this same tool batch, open it deterministically.
                        if (
                            session.currentStage === "SYSTEM_DESIGN" &&
                            !session.scratchpadOpened &&
                            !hasExplicitScratchpadOpen &&
                            !!parsed.questionId
                        ) {
                            callbacks.emit("panel:open", buildVoiceSystemDesignPanelPayload(session));
                            session.scratchpadOpened = true;
                            toolCtx.scratchpadOpened = true;
                            console.log(
                                `[Voice] Auto-opened scratchpad after SystemDesign fetch_question for ${session.sessionId}`
                            );
                        }

                        // CS Fundamentals SQL fallback: if the model fetched the SQL question
                        // but forgot to call open_sql_editor in this same tool batch, open it deterministically.
                        const hasExplicitSQLOpen = actionPlan.passthroughToolCalls.some(t => t.name === "open_sql_editor");
                        if (
                            session.currentStage === "FUNDAMENTALS" &&
                            parsed.category === "SQL" &&
                            !session.sqlEditorOpened &&
                            !hasExplicitSQLOpen &&
                            !!parsed.questionId
                        ) {
                            const sqlQ = session.cachedQuestionData.get(parsed.questionId);
                            if (sqlQ) {
                                callbacks.emit("panel:open", {
                                    type: "sql",
                                    sqlQuestion: sqlQ,
                                    stage: session.currentStage,
                                });
                                session.sqlEditorOpened = true;
                                session.currentFundamentalsPhase = 'SQL';
                                startVoiceSQLPhaseTimers(session);
                                console.log(
                                    `[Voice] Auto-opened SQL editor after fetch_question(SQL) for ${session.sessionId}`
                                );
                            }
                        }
                    } catch { /* ignore */ }
                }

                // Track language when open_ide is called
                if (tc.name === "open_ide") {
                    const lang = toolArgs.language;
                    if (lang) {
                        session.lastFetchedLanguage = lang;
                        toolCtx.lastFetchedLanguage = lang;
                    }
                    // Mark IDE as open so we can auto-close it on stage transition
                    session.ideOpened = true;
                }

                // Track SQL editor open/close state for auto-close detection
                if (tc.name === "open_sql_editor") {
                    session.sqlEditorOpened = true;
                    session.currentFundamentalsPhase = 'SQL';
                }
                if (tc.name === "close_panel" && session.sqlEditorOpened) {
                    session.sqlEditorOpened = false;
                    console.log(`[Voice] SQL editor closed via tool for ${session.sessionId}`);
                }
                if (tc.name === "close_panel" && session.ideOpened && session.currentStage === "DSA") {
                    session.ideOpened = false;
                    clearVoiceDSATimers(session);
                }
                if (tc.name === "close_panel" && session.currentStage === "DSA") {
                    clearVoiceDSATimers(session);
                }
                if (
                    tc.name === "open_notepad" &&
                    session.interviewType === "pm_role" &&
                    session.currentStage === "PM_CASE" &&
                    !fullAiText.trim()
                ) {
                    session.scratchpadOpened = true;
                    if (await speakPMCase(session, callbacks, false)) {
                        handedOff = true;
                        return;
                    }
                }
            }

            // Execute transition/end actions in the application layer.
            for (const suggestion of actionPlan.controlSuggestions) {
                let controlResult = "";

                if (suggestion.kind === "invalid") {
                    controlResult = suggestion.message;
                } else if (suggestion.kind === "transition_stage") {
                    controlResult = await handleToolCall(
                        "transition_stage",
                        suggestion.args,
                        toolCtx
                    );

                    const transitionSucceeded = controlResult.startsWith("Interview transitioned");
                    if (transitionSucceeded) {
                        stageTransitionApplied = true;
                        contextChanged = true;
                        const previousStage = session.currentStage;
                        if (session.currentStage !== toolCtx.currentStage) {
                            session.currentStage = toolCtx.currentStage;
                        }

                        if (previousStage === "DSA" && session.ideOpened) {
                            session.ideOpened = false;
                        }
                        if (previousStage === "INTRO" && session.currentStage === "DSA") {
                            transitionedIntroToDsa = true;
                            session.ideOpened = true;
                        }
                        if (previousStage === "FUNDAMENTALS") {
                            session.sqlEditorOpened = false;
                            session.sqlSnapshot = null;
                            session.sqlQuestionDescription = null;
                            session.sqlRoundCompleted = true;
                            session.currentFundamentalsPhase = getNextCSPhase(session, "SQL") || "CLOSING";
                        }

                        clearVoiceSQLTimers(session);
                        clearVoiceDSATimers(session);
                        if (toolCtx.currentStage === "DSA") {
                            startVoiceDSAPhaseTimers(session);
                        }
                    }
                } else {
                    controlResult = await handleToolCall(
                        "end_interview",
                        suggestion.args,
                        toolCtx
                    );
                    if (controlResult.startsWith("Interview ended.")) {
                        clearVoiceSQLTimers(session);
                        clearVoiceDSATimers(session);
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

            // Inject context update into history if state changed
            if (contextChanged) {
                const contextUpdate = buildVoiceContextUpdate({
                    interviewType: session.interviewType,
                    stage: session.currentStage,
                    role: session.role,
                    level: session.level,
                    currentQuestionTitle: session.currentQuestionTitle,
                    codeSnapshot: session.codeSnapshot,
                    codeLanguage: session.codeLanguage,
                    sqlSnapshot: session.sqlSnapshot,
                    sqlQuestionDescription: session.sqlQuestionDescription,
                    canvasSnapshot: session.canvasSnapshot,
                });
                session.history.push({ role: "user", content: contextUpdate });
            }

            // If stage changed (transition_stage was called), the current messages
            // only have the OLD stage's tools. Break out and re-enter generateAndSpeak
            // so the AI gets the NEW stage's tools (e.g. fetch_question, open_ide).
            if (stageTransitionApplied) {
                const transitionedToSystemDesign = session.currentStage === "SYSTEM_DESIGN" && !!session.prefetchedSDQuestion;
                // Save AI text so far
                if (fullAiText.trim() && !transitionedToSystemDesign) {
                    session.history.push({ role: "assistant", content: fullAiText });
                    await prisma.sessionMessage.create({
                        data: {
                            sessionId: session.sessionId,
                            role: "assistant",
                            content: fullAiText.trim(),
                            stage: session.currentStage,
                        },
                    });
                }

                // ── SERVER-GENERATED SD INTRO (voice path) ──────────────────
                // If we just transitioned to SYSTEM_DESIGN, do NOT hand off to
                // a new generateAndSpeak — the LLM will hallucinate a question.
                // Instead, the server speaks a hardcoded message with the exact
                // DB question title. Zero LLM involvement.
                if (session.currentStage === "SYSTEM_DESIGN" && session.prefetchedSDQuestion) {
                    const sdTitle = session.prefetchedSDQuestion.title;

                    // 1. Auto-open scratchpad with the correct question
                    if (!session.scratchpadOpened) {
                        callbacks.emit("panel:open", buildVoiceSystemDesignPanelPayload(session));
                        session.scratchpadOpened = true;
                        console.log(`[Voice] Auto-opened scratchpad: "${sdTitle}"`);
                    }

                    // 2. Server-generated intro message — no LLM
                    const sdIntroContent =
                        `Let's design ${sdTitle}. The whiteboard is already open. ` +
                        `Go ahead and start sketching your design and walk me through your thinking. ` +
                        `Let's begin by discussing the functional and non-functional requirements.`;

                    // Send as transcript to frontend
                    callbacks.onAiTranscript(sdIntroContent);

                    // Speak it via TTS
                    try {
                        await textToSpeech(sdIntroContent, callbacks, signal);
                    } catch (err: any) {
                        if (!signal.aborted) console.error("[Voice] SD intro TTS error:", err.message);
                    }
                    callbacks.onTurnComplete();

                    // Save to history and DB
                    session.history.push({ role: "assistant", content: sdIntroContent });
                    await prisma.sessionMessage.create({
                        data: {
                            sessionId: session.sessionId,
                            role: "assistant",
                            content: sdIntroContent,
                            stage: "SYSTEM_DESIGN",
                        },
                    });

                    console.log(`[Voice] SERVER-GENERATED SD intro: "${sdTitle}" — no LLM involved (${session.sessionId})`);
                    handedOff = true;
                    return; // exit current generateAndSpeak — next user utterance triggers normal flow
                }

                if (transitionedIntroToDsa && session.prefetchedDSAQuestion) {
                    session.currentQuestionTitle = session.prefetchedDSAQuestion.title;
                    session.lastFetchedQuestionId = session.prefetchedDSAQuestion.id;
                    const dsaIntro =
                        `The coding problem is "${session.prefetchedDSAQuestion.title}". ` +
                        "Before you start coding, walk me through your initial approach and the data structures you would consider.";

                    callbacks.onAiTranscript(dsaIntro);
                    try {
                        await textToSpeech(dsaIntro, callbacks, signal);
                    } catch (err: any) {
                        if (!signal.aborted) console.error("[Voice] DSA intro TTS error:", err.message);
                    }
                    callbacks.onTurnComplete();

                    session.history.push({ role: "assistant", content: dsaIntro });
                    await prisma.sessionMessage.create({
                        data: {
                            sessionId: session.sessionId,
                            role: "assistant",
                            content: dsaIntro,
                            stage: "DSA",
                        },
                    });
                    session.history.push({
                        role: "user",
                        content:
                            "[SYSTEM NOTIFICATION] DSA is active. Resume/background questioning is over. " +
                            "Continue only with the pinned coding problem.",
                    });
                    handedOff = true;
                    return;
                }

                // ── SERVER-GENERATED GENAI CONCEPTS FIRST QUESTION (voice path) ──
                // Start the concept phase with an exact DB question so the model
                // cannot substitute a generic concept prompt at the handoff.
                if (session.currentStage === "PM_CASE" && session.prefetchedPMCaseQuestion) {
                    const q = session.prefetchedPMCaseQuestion;

                    // Open notepad directly — same pattern as system design scratchpad
                    if (!session.scratchpadOpened) {
                        callbacks.emit("panel:open", {
                            type: "notepad",
                            stage: "PM_CASE",
                            topic: q.title || "Product Case",
                            template: "CIRCLES",
                            initialContent: `<h2>1) Clarify -</h2><p></p><h2>2) Identify users -</h2><p></p><h2>3) Report needs -</h2><p></p><h2>4) Cut through prioritization -</h2><p></p><h2>5) List solutions -</h2><p></p><h2>6) Evaluate tradeoffs -</h2><p></p><h2>7) Summarize -</h2><p></p>`,
                            scenario: q.scenario,
                        });
                        session.scratchpadOpened = true;
                    }

                    await recordVoiceQuestion(session, q.questionId, q.scenario || q.title, "pm_case", q.difficulty, q.evaluationGuide);

                    const caseIntro =
                        `We'll now move to a case study. ${q.scenario} ` +
                        `Use the notepad to jot down your thoughts and frame your answer using the CIRCLES framework. ` +
                        `Start by clarifying the problem, then walk me through your structure.`;

                    callbacks.onAiTranscript(caseIntro);
                    try {
                        await textToSpeech(caseIntro, callbacks, signal);
                    } catch (err: any) {
                        if (!signal.aborted) console.error("[Voice] PM case intro TTS error:", err.message);
                    }
                    callbacks.onTurnComplete();

                    session.history.push({ role: "assistant", content: caseIntro });
                    await prisma.sessionMessage.create({
                        data: { sessionId: session.sessionId, role: "assistant", content: caseIntro, stage: "PM_CASE" },
                    });

                    session.history.push({
                        role: "user",
                        content:
                            `[SYSTEM NOTIFICATION] PM case DB scenario is active: ID=${q.questionId}, title="${q.title}". ` +
                            "The CIRCLES notepad is already open — do NOT call open_notepad again. " +
                            "Use ONLY this case scenario. Do NOT invent a different product case.",
                    });

                    console.log(`[Voice] SERVER-GENERATED PM case intro: "${q.title}" (${session.sessionId})`);
                    handedOff = true;
                    return;
                }

                if (session.currentStage === "PM_CONCEPTS" && session.prefetchedPMConceptQuestions?.length) {
                    if (await askNextPMConcept(session, callbacks)) {
                        handedOff = true;
                        return;
                    }
                }

                if (session.currentStage === "PM_STRATEGY" && session.prefetchedPMStrategyQuestion) {
                    if (await speakPMStrategy(session, callbacks)) {
                        handedOff = true;
                        return;
                    }
                }

                if (
                    session.currentStage === "GEN_AI_CONCEPTS" &&
                    session.prefetchedGenAIConceptQuestions &&
                    session.prefetchedGenAIConceptQuestions.length > 0
                ) {
                    const firstQuestion = session.prefetchedGenAIConceptQuestions[0];

                    try {
                        const existing = await prisma.sessionQuestion.findFirst({
                            where: {
                                sessionId: session.sessionId,
                                questionFundamentalId: firstQuestion.questionId,
                            },
                            select: { id: true },
                        });
                        if (!existing) {
                            await prisma.sessionQuestion.create({
                                data: {
                                    sessionId: session.sessionId,
                                    questionFundamentalId: firstQuestion.questionId,
                                    questionTitle: firstQuestion.questionText.slice(0, 500),
                                    questionCategory: "genai_concepts",
                                    questionDifficulty: firstQuestion.difficulty,
                                    sampleAnswer: firstQuestion.referenceAnswer,
                                },
                            });
                        }
                    } catch (err: any) {
                        console.error("[Voice] Failed to persist first GenAI concept question:", err?.message);
                    }

                    if (!session.askedQuestionIds.includes(firstQuestion.questionId)) {
                        session.askedQuestionIds.push(firstQuestion.questionId);
                    }

                    const conceptIntroContent =
                        `Let's shift to some core GenAI concepts. ${firstQuestion.questionText}`;

                    callbacks.onAiTranscript(conceptIntroContent);
                    try {
                        await textToSpeech(conceptIntroContent, callbacks, signal);
                    } catch (err: any) {
                        if (!signal.aborted) console.error("[Voice] GenAI concept intro TTS error:", err.message);
                    }
                    callbacks.onTurnComplete();

                    session.history.push({
                        role: "user",
                        content:
                            `[SYSTEM NOTIFICATION] You asked GenAI concept DB question ID=${firstQuestion.questionId}. ` +
                            `Question text: "${firstQuestion.questionText}". ` +
                            "Evaluate the candidate's next answer silently, ask at most one follow-up, then continue with ONLY the remaining DB questions from the concept bank.",
                    });
                    session.history.push({ role: "assistant", content: conceptIntroContent });
                    await prisma.sessionMessage.create({
                        data: {
                            sessionId: session.sessionId,
                            role: "assistant",
                            content: conceptIntroContent,
                            stage: "GEN_AI_CONCEPTS",
                        },
                    });

                    console.log(`[Voice] SERVER-GENERATED first GenAI concept question: "${firstQuestion.questionText.slice(0, 80)}" (${session.sessionId})`);
                    handedOff = true;
                    return;
                }

                // ── SERVER-GENERATED GENAI CODING INTRO (voice path) ─────────────
                // The model sometimes transitions to GEN_AI_CODING and then invents
                // a coding task in speech before the fresh stage prompt/tool loop
                // gets a chance to force open_ide. Own this handoff server-side:
                // open the IDE with the prefetched DB task, then speak only its title.
                if (session.currentStage === "GEN_AI_CODING" && session.prefetchedGenAICodingQuestion) {
                    const task = session.prefetchedGenAICodingQuestion;
                    const openResult = await handleToolCall(
                        "open_ide",
                        { questionId: task.questionId, language: "python" },
                        toolCtx
                    );

                    session.ideOpened = openResult.startsWith("IDE opened");
                    session.currentQuestionTitle = task.title;
                    session.lastFetchedQuestionId = task.questionId;
                    session.lastFetchedLanguage = "python";
                    toolCtx.lastFetchedQuestionId = task.questionId;
                    toolCtx.lastFetchedLanguage = "python";

                    const codingIntroContent =
                        `Let's move to the coding task. I've opened ${task.title} in the editor. ` +
                        "Use Python, and feel free to use an AI assistant if you want. " +
                        "Start by walking me through how you would approach it.";

                    callbacks.onAiTranscript(codingIntroContent);
                    try {
                        await textToSpeech(codingIntroContent, callbacks, signal);
                    } catch (err: any) {
                        if (!signal.aborted) console.error("[Voice] GenAI coding intro TTS error:", err.message);
                    }
                    callbacks.onTurnComplete();

                    session.history.push({
                        role: "user",
                        content:
                            `[SYSTEM NOTIFICATION] GenAI coding task is active. ` +
                            `Use ONLY this DB task: ID=${task.questionId}, title="${task.title}". ` +
                            "The IDE is already open; do NOT invent or describe any other coding task.",
                    });
                    session.history.push({ role: "assistant", content: codingIntroContent });
                    await prisma.sessionMessage.create({
                        data: {
                            sessionId: session.sessionId,
                            role: "assistant",
                            content: codingIntroContent,
                            stage: "GEN_AI_CODING",
                        },
                    });

                    console.log(`[Voice] SERVER-GENERATED GenAI coding intro: "${task.title}" (${session.sessionId})`);
                    handedOff = true;
                    return;
                }

                // ── SERVER-GENERATED DS_CONCEPTS FIRST QUESTION (voice path) ─────
                // Mirrors the GenAI concepts pattern: ask the first DB question directly
                // so the LLM cannot substitute a generic concept prompt at the handoff.
                if (
                    session.currentStage === "DS_CONCEPTS" &&
                    session.prefetchedDSConceptQuestions &&
                    session.prefetchedDSConceptQuestions.length > 0
                ) {
                    const firstQ = session.prefetchedDSConceptQuestions[0];

                    try {
                        const existing = await prisma.sessionQuestion.findFirst({
                            where: {
                                sessionId: session.sessionId,
                                questionFundamentalId: (firstQ as any).questionId ?? null,
                            },
                            select: { id: true },
                        });
                        if (!existing && (firstQ as any).questionId) {
                            await prisma.sessionQuestion.create({
                                data: {
                                    sessionId:             session.sessionId,
                                    questionFundamentalId: (firstQ as any).questionId,
                                    questionTitle:         firstQ.question.slice(0, 500),
                                    questionCategory:      "ds_concepts",
                                    questionDifficulty:    firstQ.difficulty,
                                    sampleAnswer:          firstQ.referenceAnswer,
                                },
                            });
                        }
                    } catch (err: any) {
                        console.error("[Voice] Failed to persist first DS concept question:", err?.message);
                    }

                    if (!session.askedQuestionIds.includes(firstQ.questionId)) {
                        session.askedQuestionIds.push(firstQ.questionId);
                    }

                    const conceptIntroContent =
                        `Let's move to some statistics and ML fundamentals. ${firstQ.question}`;

                    callbacks.onAiTranscript(conceptIntroContent);
                    try {
                        await textToSpeech(conceptIntroContent, callbacks, signal);
                    } catch (err: any) {
                        if (!signal.aborted) console.error("[Voice] DS concept intro TTS error:", err.message);
                    }
                    callbacks.onTurnComplete();

                    session.history.push({
                        role: "user",
                        content:
                            `[SYSTEM NOTIFICATION] You asked DS concept DB question: "${firstQ.question}". ` +
                            "Evaluate the candidate's next answer silently, ask at most one follow-up, then continue with ONLY the remaining DB questions from the concept bank.",
                    });
                    session.history.push({ role: "assistant", content: conceptIntroContent });
                    await prisma.sessionMessage.create({
                        data: {
                            sessionId: session.sessionId,
                            role: "assistant",
                            content: conceptIntroContent,
                            stage: "DS_CONCEPTS",
                        },
                    });

                    console.log(`[Voice] SERVER-GENERATED first DS concept question (${session.sessionId})`);
                    handedOff = true;
                    return;
                }

                // ── SERVER-GENERATED DS_SQL INTRO (voice path) ───────────────────
                // Open the SQL editor with the prefetched DS SQL question and speak its title.
                if (session.currentStage === "DS_SQL" && session.prefetchedDSSQLQuestion) {
                    const sqlTask = session.prefetchedDSSQLQuestion;
                    const openResult = await handleToolCall(
                        "open_sql_editor",
                        {} as any,
                        toolCtx
                    );

                    const sqlIntroContent = `Let's move to the SQL problem. ${describeVoiceSqlQuestion(sqlTask)}`;

                    callbacks.onAiTranscript(sqlIntroContent);
                    try {
                        await textToSpeech(sqlIntroContent, callbacks, signal);
                    } catch (err: any) {
                        if (!signal.aborted) console.error("[Voice] DS SQL intro TTS error:", err.message);
                    }
                    callbacks.onTurnComplete();

                    session.history.push({
                        role: "user",
                        content:
                            `[SYSTEM NOTIFICATION] DS SQL task is active. ` +
                            `Use ONLY this DB question: ID=${sqlTask.questionId}, title="${sqlTask.title}". ` +
                            "The SQL editor is already open; do NOT invent a different SQL problem.",
                    });
                    session.history.push({ role: "assistant", content: sqlIntroContent });
                    await prisma.sessionMessage.create({
                        data: {
                            sessionId: session.sessionId,
                            role: "assistant",
                            content: sqlIntroContent,
                            stage: "DS_SQL",
                        },
                    });

                    console.log(`[Voice] SERVER-GENERATED DS SQL intro: "${sqlTask.title}" (${session.sessionId})`);
                    handedOff = true;
                    return;
                }

                // ── SERVER-GENERATED DS_CODING INTRO (voice path) ────────────────
                // Open the IDE with the prefetched DS coding task and speak only its title.
                if (session.currentStage === "DS_CODING" && session.prefetchedDSCodingQuestion) {
                    const dsTask = session.prefetchedDSCodingQuestion;
                    const openResult = await handleToolCall(
                        "open_ide",
                        { questionId: dsTask.questionId, language: "python" },
                        toolCtx
                    );

                    session.ideOpened = openResult.startsWith("IDE opened");
                    session.currentQuestionTitle = dsTask.title;
                    session.lastFetchedQuestionId = dsTask.questionId;
                    session.lastFetchedLanguage = "python";
                    toolCtx.lastFetchedQuestionId = dsTask.questionId;
                    toolCtx.lastFetchedLanguage = "python";

                    const codingIntroContent =
                        `Let's move to the data analysis coding task. I've opened "${dsTask.title}" in the editor. ` +
                        "Use Python and pandas. Assign your final answer to a variable called `result`. " +
                        "Start by walking me through your approach.";

                    callbacks.onAiTranscript(codingIntroContent);
                    try {
                        await textToSpeech(codingIntroContent, callbacks, signal);
                    } catch (err: any) {
                        if (!signal.aborted) console.error("[Voice] DS coding intro TTS error:", err.message);
                    }
                    callbacks.onTurnComplete();

                    session.history.push({
                        role: "user",
                        content:
                            `[SYSTEM NOTIFICATION] DS coding task is active. ` +
                            `Use ONLY this DB task: ID=${dsTask.questionId}, title="${dsTask.title}". ` +
                            "The IDE is already open; do NOT invent or describe any other coding task.",
                    });
                    session.history.push({ role: "assistant", content: codingIntroContent });
                    await prisma.sessionMessage.create({
                        data: {
                            sessionId: session.sessionId,
                            role: "assistant",
                            content: codingIntroContent,
                            stage: "DS_CODING",
                        },
                    });

                    console.log(`[Voice] SERVER-GENERATED DS coding intro: "${dsTask.title}" (${session.sessionId})`);
                    handedOff = true;
                    return;
                }

                // ── SERVER-GENERATED GENAI SYSTEM DESIGN INTRO (voice path) ──────
                // Same failure mode as coding: once the transition response has
                // streamed, instruction fixes are too late. Open the DB design
                // problem directly and speak from that exact title.
                // Non-SD transitions: re-enter with new stage's tools (original behavior)
                handedOff = true;

                // ── GEN_AI_CONCEPTS: Re-inject question bank into attention window ──────────
                // The system prompt has the question bank at position 0 — buried under
                // 8-12 minutes of INTRO history. The LLM ignores it and hallucinate questions.
                // Fix: inject the full bank fresh as a high-attention SYSTEM NOTIFICATION
                // right at the transition point, so the LLM sees it at the top of its
                // working memory when it generates its first GEN_AI_CONCEPTS response.
                if (
                    session.currentStage === "GEN_AI_CONCEPTS" &&
                    session.prefetchedGenAIConceptQuestions &&
                    session.prefetchedGenAIConceptQuestions.length > 0
                ) {
                    const qs = session.prefetchedGenAIConceptQuestions;
                    const bankLines: string[] = [
                        "[SYSTEM NOTIFICATION] You have entered the GEN_AI_CONCEPTS stage.",
                        "⚠️ MANDATORY: Ask ONLY the questions listed below. Do NOT invent questions from your own knowledge.",
                        "⚠️ Choose 3–4 most relevant to this candidate. Call record_question silently when asking each one.",
                        "⚠️ Reference answers are for your silent evaluation ONLY — NEVER reveal them.",
                        "",
                        "=== QUESTION BANK — GenAI Concepts (USE THESE EXACT QUESTIONS) ===",
                    ];

                    // Group by subtopic for readability
                    const bySubtopic = new Map<string, typeof qs>();
                    for (const q of qs) {
                        if (!bySubtopic.has(q.subtopic)) bySubtopic.set(q.subtopic, []);
                        bySubtopic.get(q.subtopic)!.push(q);
                    }
                    for (const [subtopic, subtopicQs] of bySubtopic) {
                        bankLines.push(`\n[${subtopic}]`);
                        for (const q of subtopicQs) {
                            bankLines.push(`  ID: ${q.questionId}`);
                            bankLines.push(`  Q: ${q.questionText}`);
                            const shortRef = q.referenceAnswer.length > 150
                                ? `${q.referenceAnswer.slice(0, 150)}...`
                                : q.referenceAnswer;
                            bankLines.push(`  Ref (evaluation only): ${shortRef}`);
                        }
                    }
                    bankLines.push("\n=== END QUESTION BANK ===");
                    bankLines.push("Start by asking the FIRST question from the bank above. Call record_question silently in the same turn.");

                    handleInternalNudge(session, bankLines.join("\n")).catch(err => {
                        console.error(`[Voice] GEN_AI_CONCEPTS bank injection error:`, err?.message || err);
                    });
                } else if (
                    session.currentStage === "DS_CONCEPTS" &&
                    session.prefetchedDSConceptQuestions &&
                    session.prefetchedDSConceptQuestions.length > 0
                ) {
                    // ── DS_CONCEPTS: Re-inject question bank into attention window ──
                    const qs = session.prefetchedDSConceptQuestions;
                    const bankLines: string[] = [
                        "[SYSTEM NOTIFICATION] You have entered the DS_CONCEPTS stage.",
                        "⚠️ MANDATORY: Ask ONLY the questions listed below. Do NOT invent DS questions from your own knowledge.",
                        "⚠️ Ask 4–5 of the provided questions. Call record_question silently when asking each one.",
                        "⚠️ Reference answers are for your silent evaluation ONLY — NEVER reveal them.",
                        "",
                        "=== QUESTION BANK — DS Statistics & ML Fundamentals (USE THESE EXACT QUESTIONS) ===",
                    ];
                    for (const q of qs) {
                        bankLines.push(`\n[${q.topic || q.category}] (${q.difficulty})`);
                        bankLines.push(`  ID: ${q.questionId}`);
                        bankLines.push(`  Q: ${q.question}`);
                        const shortRef = q.referenceAnswer.length > 150
                            ? `${q.referenceAnswer.slice(0, 150)}...`
                            : q.referenceAnswer;
                        bankLines.push(`  Ref (evaluation only): ${shortRef}`);
                    }
                    bankLines.push("\n=== END QUESTION BANK ===");
                    bankLines.push("Start by asking the FIRST question from the bank above.");

                    handleInternalNudge(session, bankLines.join("\n")).catch(err => {
                        console.error(`[Voice] DS_CONCEPTS bank injection error:`, err?.message || err);
                    });
                } else {
                    handleInternalNudge(
                        session,
                        `You just transitioned to the ${session.currentStage} stage. Proceed with the stage instructions immediately — do not wait for the candidate to speak.`
                    ).catch(err => {
                        console.error(`[Voice] Post-transition nudge error:`, err?.message || err);
                    });
                }
                return; // exit current generateAndSpeak
            }

            // Hard stop after end_interview so the model cannot continue with new questions.
            if (endInterviewCalled) {
                break;
            }

            // Continue agentic loop with tool responses already in messages
        }

        rememberResumeProbeQuestionFromAssistant(session, fullAiText);

        // Drift correction: if assistant starts coding content while still in INTRO,
        // force transition to DSA and open IDE deterministically. Matches on two
        // independent signals: (a) coding-round language (regex) and (b) the
        // pre-fetched DSA question text appearing in the assistant's response.
        const fullAiTextLowerForDsa = fullAiText.toLowerCase();
        const voiceDsaQuestion = session.prefetchedDSAQuestion as { title?: string; problemMd?: string } | null;
        const voiceDsaTitleSnippet = (voiceDsaQuestion?.title || "").slice(0, 70).toLowerCase().trim();
        const voiceDsaProblemSnippet = (voiceDsaQuestion?.problemMd || "").slice(0, 120).toLowerCase().trim();
        const voiceDsaSnippetMatch =
            (voiceDsaTitleSnippet.length > 12 && fullAiTextLowerForDsa.includes(voiceDsaTitleSnippet)) ||
            (voiceDsaProblemSnippet.length > 20 && fullAiTextLowerForDsa.includes(voiceDsaProblemSnippet));

        if (
            session.interviewType === "full_interview" &&
            session.currentStage === "INTRO" &&
            getNextEnabledStage(session.stageOrder, "INTRO") === "DSA" &&
            (isLikelyCodingRoundPrompt(fullAiText) || voiceDsaSnippetMatch)
        ) {
            console.warn(`[Voice] Detected coding-round prompt while still in INTRO for ${session.sessionId} (regex=${isLikelyCodingRoundPrompt(fullAiText)}, snippet=${voiceDsaSnippetMatch}); forcing INTRO -> DSA transition.`);
            const driftTransitionCtx: ToolContext = {
                sessionId: session.sessionId,
                userId: session.userId,
                interviewType: session.interviewType,
                currentStage: session.currentStage,
                askedQuestionIds: session.askedQuestionIds,
                role: session.role,
                level: session.level,
                stageOrder: session.stageOrder,
                lastFetchedQuestionId: session.lastFetchedQuestionId,
                lastFetchedLanguage: session.lastFetchedLanguage,
                prefetchedDSAQuestion: session.prefetchedDSAQuestion ?? null,
                prefetchedBehavioralQuestions: session.prefetchedBehavioralQuestions,
                prefetchedCSQuestions: session.prefetchedCSQuestions,
                prefetchedSDQuestion: session.prefetchedSDQuestion ?? null,
                cachedQuestionData: session.cachedQuestionData ?? new Map(),
                scratchpadOpened: session.scratchpadOpened,
                systemDesignExchangeCount: session.systemDesignExchangeCount,
                emit: callbacks.emit,
            };

            const driftTransitionResult = await handleToolCall(
                "transition_stage",
                {
                    nextStage: "DSA",
                    reason: "Assistant content indicates coding round started while still in INTRO.",
                },
                driftTransitionCtx
            );

            if (driftTransitionResult.startsWith("Interview transitioned")) {
                session.currentStage = "DSA";
                session.history.push({
                    role: "user",
                    content:
                        "[SYSTEM NOTIFICATION] Stage corrected to DSA because coding-round language was detected. " +
                        "IDE has been opened automatically. Continue with the pre-assigned coding problem only.",
                });
            }
        }

        // Drift correction: if assistant says it is moving to fundamentals
        // while still in DSA, force transition and continue immediately.
        if (
            session.interviewType === "full_interview" &&
            session.currentStage === "DSA" &&
            isLikelyFundamentalsHandoffPrompt(fullAiText)
        ) {
            const nextAfterDSAForDrift = getNextEnabledStage(session.stageOrder, "DSA");
            if (nextAfterDSAForDrift) {
                console.warn(`[Voice] Detected fundamentals handoff language while still in DSA for ${session.sessionId}; forcing DSA -> ${nextAfterDSAForDrift} transition.`);
                const driftTransitionCtx: ToolContext = {
                sessionId: session.sessionId,
                userId: session.userId,
                interviewType: session.interviewType,
                currentStage: session.currentStage,
                askedQuestionIds: session.askedQuestionIds,
                role: session.role,
                level: session.level,
                stageOrder: session.stageOrder,
                lastFetchedQuestionId: session.lastFetchedQuestionId,
                lastFetchedLanguage: session.lastFetchedLanguage,
                prefetchedDSAQuestion: session.prefetchedDSAQuestion ?? null,
                prefetchedBehavioralQuestions: session.prefetchedBehavioralQuestions,
                prefetchedCSQuestions: session.prefetchedCSQuestions,
                prefetchedSDQuestion: session.prefetchedSDQuestion ?? null,
                cachedQuestionData: session.cachedQuestionData ?? new Map(),
                scratchpadOpened: session.scratchpadOpened,
                systemDesignExchangeCount: session.systemDesignExchangeCount,
                emit: callbacks.emit,
            };

                const driftTransitionResult = await handleToolCall(
                    "transition_stage",
                    {
                        nextStage: nextAfterDSAForDrift,
                        reason: "Assistant content indicates fundamentals handoff while still in DSA.",
                    },
                    driftTransitionCtx
                );

                if (driftTransitionResult.startsWith("Interview transitioned")) {
                    session.currentStage = nextAfterDSAForDrift;
                    clearVoiceDSATimers(session);

                    session.history.push({
                        role: "user",
                        content:
                            `[SYSTEM NOTIFICATION] Stage corrected to ${nextAfterDSAForDrift} because handoff language was detected. ` +
                            "DSA panel has been closed automatically. Continue immediately with the current stage instructions. " +
                            "Do NOT return to DSA.",
                    });

                    handedOff = true;
                    handleInternalNudge(
                        session,
                        `You just transitioned to ${nextAfterDSAForDrift}. Proceed immediately with the current stage instructions without waiting for the candidate to speak.`
                    ).catch(err => {
                        console.error(`[Voice] Post-DSA-to-next-stage drift nudge error:`, err?.message || err);
                    });
                    return;
                }
            }
        }

        // Drift correction: if assistant starts SQL-round content in FUNDAMENTALS
        // while SQL editor is still closed, force-open SQL editor deterministically.
        if (
            session.currentStage === "FUNDAMENTALS" &&
            !session.sqlEditorOpened &&
            !session.sqlRoundCompleted
        ) {
            const fullAiTextLower = fullAiText.toLowerCase();
            const sqlQuestion = [...session.cachedQuestionData.values()].find((q: any) => q?.category === "SQL") as any;
            const sqlTitleSnippet = (sqlQuestion?.title || "").slice(0, 70).toLowerCase().trim();
            const sqlProblemSnippet = (sqlQuestion?.problemDescription || "").slice(0, 120).toLowerCase().trim();
            const sqlSnippetMatch =
                (sqlTitleSnippet.length > 12 && fullAiTextLower.includes(sqlTitleSnippet)) ||
                (sqlProblemSnippet.length > 20 && fullAiTextLower.includes(sqlProblemSnippet));

            if (isLikelySqlRoundPrompt(fullAiText) || sqlSnippetMatch) {
                console.warn(`[Voice] Detected SQL-round prompt with closed SQL editor for ${session.sessionId}; forcing SQL editor open.`);
                const driftSqlOpenCtx: ToolContext = {
                    sessionId: session.sessionId,
                    userId: session.userId,
                    interviewType: session.interviewType,
                    currentStage: session.currentStage,
                    askedQuestionIds: session.askedQuestionIds,
                    role: session.role,
                    level: session.level,
                    stageOrder: session.stageOrder,
                    lastFetchedQuestionId: session.lastFetchedQuestionId,
                    lastFetchedLanguage: session.lastFetchedLanguage,
                    prefetchedDSAQuestion: session.prefetchedDSAQuestion ?? null,
                    prefetchedBehavioralQuestions: session.prefetchedBehavioralQuestions,
                    prefetchedCSQuestions: session.prefetchedCSQuestions,
                    prefetchedSDQuestion: session.prefetchedSDQuestion ?? null,
                    cachedQuestionData: session.cachedQuestionData ?? new Map(),
                    scratchpadOpened: session.scratchpadOpened,
                    systemDesignExchangeCount: session.systemDesignExchangeCount,
                    onSQLEditorOpened: () => startVoiceSQLPhaseTimers(session),
                    onSQLPanelClosed: () => {
                        clearVoiceSQLTimers(session);
                        session.sqlSnapshot = null;
                        session.sqlQuestionDescription = null;
                    },
                    onDSAEditorOpened: () => startVoiceDSAPhaseTimers(session),
                    onDSAPanelClosed: () => clearVoiceDSATimers(session),
                    emit: callbacks.emit,
                };

                const driftSqlOpenResult = await handleToolCall("open_sql_editor", {}, driftSqlOpenCtx);
                if (driftSqlOpenResult.startsWith("SQL editor opened")) {
                    session.sqlEditorOpened = true;
                    session.currentFundamentalsPhase = 'SQL';
                    if (sqlQuestion?.problemDescription) {
                        session.sqlQuestionDescription = `${sqlQuestion.title || ""}\n\n${sqlQuestion.problemDescription}`;
                    }
                    session.history.push({
                        role: "user",
                        content:
                            "[SYSTEM NOTIFICATION] SQL round was detected while SQL editor was closed. " +
                            `SQL editor has now been opened automatically. ${describeVoiceSqlQuestion(sqlQuestion)} Continue SQL round with this panel.`,
                    });
                }
            }
        }

        // Drift correction: if assistant starts system-design content while the
        // scratchpad is still closed in SYSTEM_DESIGN stage, force-open the
        // scratchpad deterministically. Matches on regex OR pre-fetched SD
        // question title/statement snippet appearing in the assistant's output.
        if (
            session.currentStage === "SYSTEM_DESIGN" &&
            !session.scratchpadOpened
        ) {
            const fullAiTextLowerForSd = fullAiText.toLowerCase();
            const sdQuestion = session.prefetchedSDQuestion as { id?: string; title?: string; problemStatement?: string } | null;
            const sdTitleSnippet = (sdQuestion?.title || "").slice(0, 70).toLowerCase().trim();
            const sdProblemSnippet = (sdQuestion?.problemStatement || "").slice(0, 120).toLowerCase().trim();
            const sdSnippetMatch =
                (sdTitleSnippet.length > 12 && fullAiTextLowerForSd.includes(sdTitleSnippet)) ||
                (sdProblemSnippet.length > 20 && fullAiTextLowerForSd.includes(sdProblemSnippet));

            if (isLikelySystemDesignPrompt(fullAiText) || sdSnippetMatch) {
                console.warn(`[Voice] Detected system-design prompt with closed scratchpad for ${session.sessionId} (regex=${isLikelySystemDesignPrompt(fullAiText)}, snippet=${sdSnippetMatch}); forcing scratchpad open.`);
                callbacks.emit("panel:open", buildVoiceSystemDesignPanelPayload(session));
                session.scratchpadOpened = true;
                session.history.push({
                    role: "user",
                    content:
                        "[SYSTEM NOTIFICATION] Scratchpad/whiteboard was auto-opened because system-design content was detected with the panel closed. " +
                        "Do NOT call open_scratchpad — it is already open. Continue probing the candidate on their design.",
                });
            }
        }

        // Drift correction: if system_design interview is still in INTRO but
        // assistant started talking about the design problem, force-transition
        // to SYSTEM_DESIGN and auto-open the scratchpad. The regular
        // SYSTEM_DESIGN_INTRO_FORCE_TRANSITION_THRESHOLD handles the slow path; this handles
        // the immediate-drift case so we don't have to wait for another turn.
        if (
            session.interviewType === "system_design" &&
            session.currentStage === "INTRO" &&
            session.introExchangeCount >= SYSTEM_DESIGN_INTRO_FORCE_TRANSITION_THRESHOLD
        ) {
            const fullAiTextLowerForSdIntro = fullAiText.toLowerCase();
            const sdIntroQ = session.prefetchedSDQuestion as { id?: string; title?: string; problemStatement?: string } | null;
            const sdIntroTitleSnippet = (sdIntroQ?.title || "").slice(0, 70).toLowerCase().trim();
            const sdIntroProblemSnippet = (sdIntroQ?.problemStatement || "").slice(0, 120).toLowerCase().trim();
            const sdIntroSnippetMatch =
                (sdIntroTitleSnippet.length > 12 && fullAiTextLowerForSdIntro.includes(sdIntroTitleSnippet)) ||
                (sdIntroProblemSnippet.length > 20 && fullAiTextLowerForSdIntro.includes(sdIntroProblemSnippet));

            if (isLikelySystemDesignPrompt(fullAiText) || sdIntroSnippetMatch) {
                console.warn(`[Voice] Detected system-design content while still in INTRO for ${session.sessionId} (regex=${isLikelySystemDesignPrompt(fullAiText)}, snippet=${sdIntroSnippetMatch}); forcing INTRO -> SYSTEM_DESIGN transition.`);
                try {
                    await prisma.interviewSession.update({
                        where: { id: session.sessionId },
                        data: { stage: "SYSTEM_DESIGN" },
                        select: { id: true },
                    });
                    session.currentStage = "SYSTEM_DESIGN";
                    session.systemDesignExchangeCount = 0;
                    callbacks.emit("stage:change", {
                        stage: "SYSTEM_DESIGN",
                        reason: "Drift detected: assistant started describing design problem in INTRO stage.",
                    });
                    if (!session.scratchpadOpened && sdIntroQ) {
                        callbacks.emit("panel:open", buildVoiceSystemDesignPanelPayload(session));
                        session.scratchpadOpened = true;
                    }
                    session.history.push({
                        role: "user",
                        content:
                            "[SYSTEM NOTIFICATION] Stage corrected to SYSTEM_DESIGN because system-design language was detected. " +
                            "Scratchpad has been opened automatically. Continue with the pre-assigned design problem only.",
                    });
                } catch (err: any) {
                    console.error(`[Voice] SD drift transition failed for ${session.sessionId}:`, err?.message || err);
                }
            }
        }

        // Auto-close SQL panel if AI moved to OS/CN/OOPS without calling close_panel.
        // Mirrors the same logic in processAgentTurn (text path) but applied to voice.
        const voiceSqlQCached = session.cachedQuestionData && [...session.cachedQuestionData.values()].some(q => q.category === "SQL");
        if (session.sqlEditorOpened || (session.interviewType === "cs_fundamentals" && session.currentStage === "FUNDAMENTALS" && voiceSqlQCached)) {
                // Only close if AI is clearly transitioning to next topic (not casual mentions)
                // Must include explicit transition words like "let's", "move", "next", "now"
                const transitionPattern = /\b(let'?s\s+move|let'?s\s+discuss|let'?s\s+talk|now\s+let'?s|moving on|next|now\s+let'?s).*?(operating systems?|computer networks?|os|cn|oops|object[- ]oriented|fundamentals)\b/i;
            console.log(`[Voice] End-of-turn SQL check — sqlEditorOpened=${session.sqlEditorOpened}, sqlQCached=${voiceSqlQCached}, snippet="${fullAiText.slice(0, 100)}"`);
                if (transitionPattern.test(fullAiText)) {
                callbacks.emit("panel:close", { summary: "SQL round complete." });
                session.sqlEditorOpened = false;
                session.sqlSnapshot = null;
                session.sqlQuestionDescription = null;
                session.sqlRoundCompleted = true;
                session.currentFundamentalsPhase = getNextCSPhase(session, "SQL") || "CLOSING";
                clearVoiceSQLTimers(session);
                console.log(`[Voice] Auto-closed SQL panel — AI moved to next CS phase for ${session.sessionId}`);
            }
        }

        // Auto-record CS theory questions if the model asks from QUESTION BANK
        // but forgets to call record_question.
        if (session.currentStage === "FUNDAMENTALS" && session.prefetchedCSQuestions && fullAiText.trim()) {
            const aiTextLower = fullAiText.toLowerCase();
            for (const [cat, questions] of session.prefetchedCSQuestions) {
                if (cat === "SQL_query") continue;
                for (const q of questions) {
                    const snippet = (q.questionText || "").slice(0, 80).toLowerCase().trim();
                    if (snippet.length < 20) continue;
                    if (!aiTextLower.includes(snippet)) continue;

                    const existing = await prisma.sessionQuestion.findFirst({
                        where: { sessionId: session.sessionId, questionFundamentalId: q.questionId },
                        select: { id: true },
                    });
                    if (!existing) {
                        await prisma.sessionQuestion.create({
                            data: {
                                sessionId: session.sessionId,
                                questionFundamentalId: q.questionId,
                                questionTitle: q.questionText.slice(0, 500),
                                questionCategory: "cs_fundamentals",
                                sampleAnswer: q.referenceAnswer || null,
                            },
                        });
                        console.log(`[Voice] Auto-recorded CS question from assistant text: ${q.questionId}`);
                    }
                    if (!session.askedQuestionIds.includes(q.questionId)) {
                        session.askedQuestionIds.push(q.questionId);
                    }
                }
            }
        }

        const persistAssistantMessage = async (
            content: string,
            stage: InterviewStage = session.currentStage
        ) => {
            const cleanContent = sanitizeSpokenInterviewText(content);
            if (!cleanContent.trim()) return;
            session.history.push({ role: "assistant", content: cleanContent });
            await prisma.sessionMessage.create({
                data: {
                    sessionId: session.sessionId,
                    role: "assistant",
                    content: cleanContent,
                    stage,
                },
            });
        };

        // PM case drift correction: if the assistant verbally moves to concepts
        // but forgets transition_stage, apply the stage change server-side.
        // The transition handler closes the PM notepad deterministically.
        if (
            session.interviewType === "pm_role" &&
            session.currentStage === "PM_CASE" &&
            session.prefetchedPMConceptQuestions?.length &&
            hasPMConceptHandoffLanguage(fullAiText)
        ) {
            await persistAssistantMessage(fullAiText, session.currentStage);
            const toolCtx = buildVoiceToolContext(session, callbacks);
            const nextAfterPMCase = getNextEnabledStage(session.stageOrder, "PM_CASE");
            if (!nextAfterPMCase) return;
            const transitionResult = await handleToolCall(
                "transition_stage",
                { nextStage: nextAfterPMCase, reason: "Assistant verbally moved on from PM case without calling transition_stage." },
                toolCtx
            );
            if (transitionResult.startsWith("Interview transitioned")) {
                session.currentStage = nextAfterPMCase;
                toolCtx.currentStage = nextAfterPMCase;
                session.scratchpadOpened = false;
                if (await speakCurrentRoleStageIntro(session, callbacks)) return;
                return;
            }
        }

        // GenAI drift correction: if the model verbally moves to coding/system design
        // but forgets transition/open tools, make the tool effects happen now.
        if (
            session.interviewType === "gen_ai_role" &&
            session.currentStage === "GEN_AI_CONCEPTS" &&
            session.prefetchedGenAICodingQuestion &&
            hasGenAICodingHandoffLanguage(fullAiText)
        ) {
            await persistAssistantMessage(fullAiText, session.currentStage);
            const toolCtx = buildVoiceToolContext(session, callbacks);
            const nextAfterGenAIConcepts = getNextEnabledStage(session.stageOrder, "GEN_AI_CONCEPTS");
            if (nextAfterGenAIConcepts !== "GEN_AI_CODING") return;
            const transitionResult = await handleToolCall(
                "transition_stage",
                { nextStage: nextAfterGenAIConcepts, reason: "Assistant verbally moved to GenAI coding without calling transition_stage." },
                toolCtx
            );
            if (transitionResult.startsWith("Interview transitioned")) {
                session.currentStage = nextAfterGenAIConcepts;
                toolCtx.currentStage = nextAfterGenAIConcepts;
            }

            const task = session.prefetchedGenAICodingQuestion;
            const openResult = await handleToolCall(
                "open_ide",
                { questionId: task.questionId, language: "python" },
                toolCtx
            );
            session.ideOpened = openResult.startsWith("IDE opened");
            session.currentQuestionTitle = task.title;
            session.lastFetchedQuestionId = task.questionId;
            session.lastFetchedLanguage = "python";

            const serverIntro =
                `I've opened ${task.title} in the coding editor. ` +
                "Use Python and start by walking me through your approach.";
            callbacks.onAiTranscript(serverIntro);
            try {
                await textToSpeech(serverIntro, callbacks, signal);
            } catch (err: any) {
                if (!signal.aborted) console.error("[Voice] GenAI coding drift TTS error:", err.message);
            }
            session.history.push({
                role: "user",
                content:
                    `[SYSTEM NOTIFICATION] Stage corrected to GEN_AI_CODING. ` +
                    `Use ONLY this DB task: ID=${task.questionId}, title="${task.title}". ` +
                    "The IDE is already open; do not invent another coding task.",
            });
            await persistAssistantMessage(serverIntro, "GEN_AI_CODING");
            return;
        }

        // Closing drift correction: if the interviewer says the interview is over
        // in natural language, move/wait in closing. The user acknowledgement ends it.
        if (
            session.interviewType === "resume_round" &&
            hasFinalClosingLanguage(fullAiText)
        ) {
            const toolCtx = buildVoiceToolContext(session, callbacks);
            let nextStage = getNextEnabledStage(session.stageOrder, session.currentStage);
            while (nextStage && nextStage !== session.currentStage) {
                const transitionResult = await handleToolCall(
                    "transition_stage",
                    { nextStage, reason: "Resume Round delivered final closing; advancing to closeout." },
                    toolCtx
                );
                if (transitionResult.startsWith("Interview transitioned")) {
                    session.currentStage = nextStage;
                    toolCtx.currentStage = nextStage;
                    if (nextStage === "CLOSING") break;
                    nextStage = getNextEnabledStage(session.stageOrder, session.currentStage);
                    continue;
                }
                break;
            }

            await persistAssistantMessage(fullAiText, session.currentStage);
            clearVoiceSQLTimers(session);
            clearVoiceDSATimers(session);
            return;
        }

        if (
            session.interviewType === "behavioural" &&
            hasFinalClosingLanguage(fullAiText)
        ) {
            await persistAssistantMessage(fullAiText, session.currentStage);
            const toolCtx = buildVoiceToolContext(session, callbacks);

            if (session.currentStage !== "CLOSING") {
                const transitionResult = await handleToolCall(
                    "transition_stage",
                    { nextStage: "CLOSING", reason: "Behavioural interviewer delivered final closing." },
                    toolCtx
                );
                if (transitionResult.startsWith("Interview transitioned")) {
                    session.currentStage = "CLOSING";
                    toolCtx.currentStage = "CLOSING";
                }
            }
            if (session.currentStage === "CLOSING") {
                await handleToolCall(
                    "end_interview",
                    { summary: "Interviewer delivered final closing language." },
                    toolCtx
                );
            }

            clearVoiceSQLTimers(session);
            clearVoiceDSATimers(session);
            return;
        }

        if (
            (
                (session.interviewType === "gen_ai_role" && session.currentStage === "CLOSING") ||
                (session.interviewType === "pm_role" && session.currentStage === "PM_BEHAVIORAL")
            ) &&
            hasFinalClosingLanguage(fullAiText)
        ) {
            await persistAssistantMessage(fullAiText, session.currentStage);
            const toolCtx = buildVoiceToolContext(session, callbacks);
            await handleToolCall(
                "end_interview",
                { summary: "Interviewer delivered final closing language." },
                toolCtx
            );
            clearVoiceSQLTimers(session);
            clearVoiceDSATimers(session);
            return;
        }

        if (
            session.interviewType !== "resume_round" &&
            session.currentStage === "CLOSING" &&
            hasFinalClosingLanguage(fullAiText)
        ) {
            await persistAssistantMessage(fullAiText, session.currentStage);
            const toolCtx = buildVoiceToolContext(session, callbacks);
            await handleToolCall(
                "end_interview",
                { summary: "Interviewer delivered final closing language in the closing stage." },
                toolCtx
            );
            clearVoiceSQLTimers(session);
            clearVoiceDSATimers(session);
            return;
        }

        if (suppressLiveIntroStreaming && fullAiText.trim()) {
            const cleanIntro = stripDuplicateIntroWelcome(sanitizeSpokenInterviewText(fullAiText));
            callbacks.onAiTranscript(cleanIntro);
            try {
                await textToSpeech(cleanIntro, callbacks, signal);
            } catch (err: any) {
                if (!signal.aborted) console.error("[Voice] Buffered System Design INTRO TTS error:", err.message);
            }
            callbacks.onTurnComplete();
        }

        rememberVoiceResumeAgendaAssistantQuestion(
            session,
            fullAiText,
            resumeAgendaItemIdForAssistantQuestion
        );

        // Persist AI response
        await persistAssistantMessage(fullAiText, session.currentStage);
    } catch (err: any) {
        if (!signal.aborted) {
            const errMsg = err?.message || err?.toString?.() || "AI response generation failed";
            console.error("[Voice] Pipeline error:", errMsg);
            callbacks.onError(sanitizeErrorMessage(errMsg));
        }
    } finally {
        // Skip cleanup if we handed off to a new generateAndSpeak (transition_stage).
        // The new call already set isGenerating=true and its own abortController —
        // resetting them here would clobber the new call's state.
        if (!handedOff) {
            session.isGenerating = false;
            session.abortController = null;

            // If the user stayed muted while AI was speaking, start reminder countdown now.
            if (session.isMuted) {
                scheduleMuteReminder(session);
            }

            // Signal turn complete so the client knows it can accept new input
            callbacks.onTurnComplete();
        }
    }
}

// ── Public API ─────────────────────────────────────────────

export async function startVoiceSession(
    sessionId: string,
    callbacks: VoiceSessionCallbacks
): Promise<void> {
    const existingSession = activeSessions.get(sessionId);
    if (existingSession) {
        // Reattach callbacks so reconnecting clients keep receiving voice events.
        existingSession.callbacks = callbacks;
        callbacks.onReady();
        if (
            !hasInterviewDialogue(existingSession.history) &&
            !existingSession.isGenerating
        ) {
            (async () => {
                if (existingSession.companyScreening && isCompanyScreeningMockInterviewerEnabled()) {
                    await speakAndPersistMockTextOnly(existingSession, buildVoiceOpeningMessage(existingSession), existingSession.currentStage, callbacks);
                    await processCompanyScreeningMockVoiceTurn(existingSession, callbacks, null);
                    return;
                }
                await speakAndPersist(existingSession, buildVoiceOpeningMessage(existingSession), existingSession.currentStage, callbacks);
                if (existingSession.currentStage === "DSA" && existingSession.prefetchedDSAQuestion) {
                    await speakAndPersist(existingSession, buildVoicePinnedDsaIntro(existingSession.prefetchedDSAQuestion), "DSA", callbacks);
                } else {
                    await speakCurrentRoleStageIntro(existingSession, callbacks);
                }
            })().catch(err => {
                console.error(`[Voice] Reattached opening error for ${sessionId}:`, err?.message || err);
            });
        }
        console.log(`[Voice] Reattached callbacks to active voice session ${sessionId}`);
        return;
    }

    // 1. Initial metadata load and MongoDB connection (parallel)
    const [dbSession, _mongo] = await Promise.all([
        prisma.interviewSession.findUnique({
            where: { id: sessionId },
            select: {
                id: true,
                userId: true,
                role: true,
                level: true,
                mode: true,
                stage: true,
                status: true,
                startedAt: true,
                type: true,
                moduleConfig: true,
                resume: { select: { id: true, analysis: true, rawText: true } },
                sessionQuestions: {
                    select: { questionId: true, questionSqlId: true, questionFundamentalId: true },
                },
                messages: {
                    orderBy: { createdAt: "asc" },
                    select: { role: true, content: true, stage: true, createdAt: true, metadata: true },
                },
            },
        }),
        ensureMongoDBConnected()
    ]);

    if (!dbSession) {
        callbacks.onError(STANDARD_ERROR_MESSAGES.SESSION_EXPIRED);
        return;
    }

    if (dbSession.status === "COMPLETED") {
        callbacks.onEnded("Interview already completed");
        callbacks.emit("session:ended", {
            message: "This interview has already ended.",
        });
        return;
    }

    const compatibility = validateVoiceTextCompatibility((dbSession.type || "full_interview") as InterviewType);
    if (!compatibility.compatible) {
        callbacks.onError(STANDARD_ERROR_MESSAGES.VOICE_UNAVAILABLE);
        return;
    }

    // Resume analysis is stored encrypted in the DB — decrypt it
    let resumeAnalysis: any = null;
    const rawAnalysis = dbSession.resume?.analysis;
    if (rawAnalysis) {
        try {
            const { isEncrypted, decrypt } = await import("../lib/encryption.js");
            if (typeof rawAnalysis === "string" && isEncrypted(rawAnalysis)) {
                resumeAnalysis = JSON.parse(decrypt(rawAnalysis));
            } else if (typeof rawAnalysis === "object") {
                resumeAnalysis = rawAnalysis;
            } else if (typeof rawAnalysis === "string") {
                resumeAnalysis = JSON.parse(rawAnalysis);
            }
        } catch (err) {
            console.error(`[VoicePipeline] Failed to decrypt/parse resume analysis for ${sessionId}:`, err);
        }
    }
    console.log(`[VoicePipeline] Resume analysis for ${sessionId}: ${resumeAnalysis ? 'loaded (name=' + resumeAnalysis?.summary?.name + ')' : 'none'}`);

    // Company screening: generate the structured resume analysis on the fly when the
    // applicant never ran the (paid) analysis, so the resume phase is always grounded.
    // Not charged to the candidate's quota; cached back for re-entry. (Mirrors the text path.)
    if (!resumeAnalysis && dbSession.mode === "company_screening" && (dbSession.resume as any)?.rawText) {
        try {
            const { isEncrypted, decrypt } = await import("../lib/encryption.js");
            const raw = (dbSession.resume as any).rawText as string;
            const rawText = typeof raw === "string" && isEncrypted(raw) ? decrypt(raw) : String(raw);
            if (rawText && rawText.trim().length >= 50) {
                const { analyzeResume, updateResumeAnalysis } = await import("./resume-service.js");
                resumeAnalysis = await analyzeResume(rawText);
                const resumeId = (dbSession.resume as any).id as string | undefined;
                if (resumeAnalysis && resumeId) {
                    await updateResumeAnalysis(resumeId, dbSession.userId, resumeAnalysis).catch((e) =>
                        console.warn(`[VoicePipeline] failed to persist on-the-fly screening resume analysis for ${sessionId}:`, e));
                }
                console.log(`[VoicePipeline] Screening resume analysis generated on-the-fly for ${sessionId} (name=${resumeAnalysis?.summary?.name})`);
            }
        } catch (err) {
            console.warn(`[VoicePipeline] on-the-fly screening resume analysis failed for ${sessionId}:`, err);
        }
    }
    const interviewType = (dbSession.type || "full_interview") as InterviewType;
    const configMessage = dbSession.messages
        ?.filter((msg: any) => msg.role === "system" && msg.stage === "CONFIG" && (msg.metadata as any)?.moduleConfig)
        .at(-1);
    const moduleConfig = (dbSession as any).moduleConfig || (configMessage?.metadata as any)?.moduleConfig || null;
    const companyScreening = dbSession.mode === "company_screening"
        ? normalizeCompanyScreeningRuntimeContext((configMessage?.metadata as any)?.companyScreening)
        : null;

    // Ground the screening on the candidate's OWN verified GitHub project facts (name +
    // description + tech only). Per-candidate from THEIR application; a hard field whitelist
    // drops every recruiter-side score/verdict/risk so nothing recruiter-facing crosses.
    // (Mirrors the text path.)
    let screeningGithubVerification: string | null = null;
    if (companyScreening?.applicationId) {
        try {
            const application = await (prisma as any).jobApplication.findUnique({
                where: { id: companyScreening.applicationId },
                select: { githubAnalysis: true },
            });
            const facts = extractCandidateProjectFacts(application);
            if (facts.length) {
                resumeAnalysis = { ...(resumeAnalysis || {}), summary: mergeCandidateProjectsIntoResume(resumeAnalysis?.summary || null, facts) };
                console.log(`[VoicePipeline] Screening grounded on ${facts.length} candidate GitHub project fact(s) for ${sessionId}`);
            }
            // Evaluation-only verification grounding (repo `ai` analysis) — resume phase only.
            screeningGithubVerification = buildResumeVerificationGrounding(extractCandidateProjectVerification(application));
        } catch (err) {
            console.warn(`[VoicePipeline] candidate project facts load failed for ${sessionId}:`, err);
        }
    }
    const companyScreeningMockPosition = companyScreening && isCompanyScreeningMockInterviewerEnabled()
        ? deriveCompanyScreeningMockPosition(companyScreening.blueprintSnapshot, dbSession.messages)
        : null;
    const typeConfig = resolveEffectiveInterviewTypeConfig(interviewType, moduleConfig);

    // Voice mode fallback: if SD question prefetch later fails, recover the already
    // persisted SD question title from SessionQuestion so UI still shows the real prompt.
    let persistedSD: { questionId: string | null; questionTitle: string | null } | null = null;
    let persistedSDProblemStatement: string | null = null;
    if (interviewType === "system_design") {
        persistedSD = await prisma.sessionQuestion.findFirst({
            where: {
                sessionId,
                questionCategory: "system_design",
            },
            orderBy: { askedAt: "desc" },
            select: {
                questionId: true,
                questionTitle: true,
            },
        });

        if (persistedSD?.questionId) {
            try {
                const { SystemDesignQuestion } = await import("../models/system-design-question.js");
                const doc: any = await SystemDesignQuestion.findById(persistedSD.questionId)
                    .select("title problemStatement")
                    .lean();
                if (doc?.problemStatement) {
                    persistedSDProblemStatement = String(doc.problemStatement);
                }
                if (!persistedSD.questionTitle && doc?.title) {
                    persistedSD.questionTitle = String(doc.title);
                }
            } catch (err) {
                console.warn(`[VoicePipeline] Failed to hydrate persisted SD problemStatement for ${sessionId}:`, err);
            }
        }
    }

    const session: VoiceSession = {
        sttSocket: null,
        sessionId,
        userId: dbSession.userId,
        interviewType,
        currentStage: dbSession.stage as InterviewStage,
        stageOrder: typeConfig.stages,
        moduleConfig,
        askedQuestionIds: dbSession.sessionQuestions.map((sq: any) => sq.questionId || sq.questionSqlId || sq.questionFundamentalId).filter((id: any): id is string => Boolean(id)),
        role: dbSession.role,
        level: dbSession.level,
        currentQuestionTitle: null,
        lastFetchedQuestionId: null,
        lastFetchedLanguage: null,
        prefetchedDSAQuestion: null,
        prefetchedBehavioralQuestions: [],
        prefetchedPMCaseQuestion: null,
        prefetchedPMConceptQuestions: [],
        prefetchedPMStrategyQuestion: null,
        prefetchedProblemSolvingCaseQuestion: null,
        problemSolvingNotepadOpened: false,
        currentDSConceptQuestionId: null,
        dsConceptFollowupCount: 0,
        currentPMConceptQuestionId: null,
        pmConceptFollowupCount: 0,
        cachedQuestionData: new Map(),
        codeSnapshot: null,
        codeLanguage: null,
        sqlSnapshot: null,
        sqlQuestionDescription: null,
        rubricLite: null,
        canvasSnapshot: null,
        notepadSnapshot: null,
        resumeSummary: resumeAnalysis?.summary || null,
        companyScreeningGithubVerification: screeningGithubVerification,
        resumeStageNonAnswerCounts: {},
        resumeDeclinedStages: [],
        resumeAgendaWeakAnswerCounts: {},
        resumeAgendaQuestionCounts: {},
        resumeCloseoutAcknowledged: false,
        history: dbSession.messages ? dbSession.messages.map((m: any) => ({ role: m.role as "user" | "assistant" | "system", content: m.content })) : [],
        isGenerating: false,
        abortController: null,
        userTranscriptBuffer: "",
        isMuted: false,
        muteTimer: null,
        callbacks,
        systemDesignExchangeCount: 0,
        scratchpadOpened: false,
        introExchangeCount: 0,
        behaviouralStageNonAnswerCount: 0,
        resumeProbeState: createInitialResumeProbeState(),
        resumeAgendaState: interviewType === "resume_round"
            ? createInitialResumeAgendaState(resumeAnalysis?.summary || null)
            : undefined,
        resumeWebSearchUsed: false,
        resumeWebSearchContext: null,
        resumeWebSearchInjected: false,
        sqlApproachTimer: null,
        sqlQueryTimer: null,
        sqlTotalTimer: null,
        dsa20Timer: null,
        dsa25Timer: null,
        dsa30Timer: null,
        pendingAudioPackets: [],
        isPTTActive: false,
        isPTTHolding: false,
        pttTranscriptBuffer: [],
        pttPendingFlush: false,
        pttFlushTimer: null,
        companyScreening,
        companyScreeningMockCursor: companyScreeningMockPosition?.cursor || null,
        companyScreeningMockWaitingForAnswer: companyScreeningMockPosition?.waitingForAnswer || false,
        companyScreeningMockCompleted: false,
    };

    // Seed title from persisted DB row immediately so any early panel:open emits
    // can render a concrete question title in the scratchpad brief.
    if (interviewType === "system_design" && persistedSD?.questionTitle) {
        const fallbackProblemStatement =
            persistedSDProblemStatement || buildSDProblemStatementFallback(persistedSD.questionTitle);
        session.currentQuestionTitle = persistedSD.questionTitle;
        session.prefetchedSDQuestion = {
            id: persistedSD.questionId || `sd_${sessionId}`,
            title: persistedSD.questionTitle,
            problemStatement: fallbackProblemStatement,
        };
    }

    // Mark session as IN_PROGRESS
    await prisma.interviewSession.update({
        where: { id: sessionId },
        data: {
            status: "IN_PROGRESS",
            startedAt: dbSession.startedAt || new Date(),
        },
        select: { id: true },
    });

    activeSessions.set(sessionId, session);

    // Apply pending PTT mode if it was set before session was created
    const pendingPTTMode = pendingPTTModes.get(sessionId);
    if (pendingPTTMode !== undefined) {
        console.log(`[PTT][Pipeline] Applying pending PTT mode: ${pendingPTTMode} to newly created session ${sessionId}`);
        session.isPTTActive = pendingPTTMode;
        pendingPTTModes.delete(sessionId);
    }

    try {
        // Prefetch recruiter-attached coding/SQL bank questions into the session
        // cache so open_screening_workspace + run_candidate_code work like practice.
        if (companyScreening) {
            session.companyScreeningAskedQuestionIds = new Set();
            const bankCache = await prefetchCompanyScreeningBankQuestions(companyScreening.blueprintSnapshot);
            for (const [bankId, question] of bankCache) session.cachedQuestionData.set(bankId, question);

            // Load the role-phase questions (ds/genai/pm/problem-solving/concepts) in the
            // practice shape, reusing the practice prefetch, and stash them in the standard
            // prefetched* fields so the SAME practice panel handlers open them. One DB pass.
            const phasePrefetch = await prefetchScreeningPhaseRuntime(companyScreening.blueprintSnapshot, session.sessionId, dbSession.userId);
            session.companyScreeningPhasePrefetch = phasePrefetch;
            session.companyScreeningOpenedPhasePanels = new Set();
            if (phasePrefetch.prefetchedDSSQLQuestion) session.prefetchedDSSQLQuestion = phasePrefetch.prefetchedDSSQLQuestion;
            if (phasePrefetch.prefetchedDSCodingQuestion) session.prefetchedDSCodingQuestion = phasePrefetch.prefetchedDSCodingQuestion;
            if (phasePrefetch.prefetchedDSConceptQuestions) session.prefetchedDSConceptQuestions = phasePrefetch.prefetchedDSConceptQuestions;
            if (phasePrefetch.prefetchedGenAICodingQuestion) session.prefetchedGenAICodingQuestion = phasePrefetch.prefetchedGenAICodingQuestion;
            if (phasePrefetch.prefetchedGenAIConceptQuestions) session.prefetchedGenAIConceptQuestions = phasePrefetch.prefetchedGenAIConceptQuestions;
            if (phasePrefetch.prefetchedPMCaseQuestion) session.prefetchedPMCaseQuestion = phasePrefetch.prefetchedPMCaseQuestion;
            if (phasePrefetch.prefetchedPMConceptQuestions) session.prefetchedPMConceptQuestions = phasePrefetch.prefetchedPMConceptQuestions;
            if (phasePrefetch.prefetchedPMStrategyQuestion) session.prefetchedPMStrategyQuestion = phasePrefetch.prefetchedPMStrategyQuestion;
            if (phasePrefetch.prefetchedProblemSolvingCaseQuestion) session.prefetchedProblemSolvingCaseQuestion = phasePrefetch.prefetchedProblemSolvingCaseQuestion;
        }
        // Pre-fetch DSA question for all DSA-containing interview types.
        if (typeConfig.stages.includes("DSA")) {
            await prefetchDSAQuestionForVoice(session);
            if (!session.prefetchedDSAQuestion) {
                throw new Error("DSA prefetch returned no question.");
            }

            if (session.currentStage === "DSA") {
                const q = session.prefetchedDSAQuestion;
                session.currentQuestionTitle = q.title;
                session.lastFetchedQuestionId = q.id;
                session.cachedQuestionData.set(q.id, q);
                if (!session.askedQuestionIds.includes(q.id)) {
                    session.askedQuestionIds.push(q.id);
                }
                callbacks.emit("question:assign", {
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
                startVoiceDSAPhaseTimers(session);
                // Keep the pinned question available for validation and DSA-stage prompts.
            }
        }

        // Pre-fetch CS Fundamentals questions (theory + SQL) — in-memory only.
        if (typeConfig.stages.includes("FUNDAMENTALS")) {
            const fundamentalsOptions = session.moduleConfig?.stageOptions?.FUNDAMENTALS || {};
            const { questionsMap, prefetchedSQLQuestion, sqlCacheEntry } =
                await prefetchCSFundamentalsQuestions(sessionId, dbSession.userId, "VoicePipeline", false, {
                    topics: fundamentalsOptions.topics,
                    includeSQL: fundamentalsOptions.includeSQL,
                    questionCountPerTopic: fundamentalsOptions.questionCountPerTopic,
                });
            session.prefetchedCSQuestions = questionsMap;
            session.prefetchedSQLQuestion = prefetchedSQLQuestion;
            for (const [id, q] of sqlCacheEntry) {
                session.cachedQuestionData.set(id, q);
            }
            session.currentFundamentalsPhase = getCurrentCSPhase(session);

            const hasTheory = (session.prefetchedCSQuestions?.size || 0) > 0;
            const hasSQL = fundamentalsOptions.includeSQL === false || [...session.cachedQuestionData.values()].some((q) => q.category === "SQL");
            if (!hasTheory || !hasSQL) {
                throw new Error("CS fundamentals prefetch is incomplete (missing theory bank or SQL question).");
            }
        }

        // Pre-fetch System Design question for system_design interviews.
        if (typeConfig.stages.includes("SYSTEM_DESIGN")) {
            await prefetchSDQuestionForVoice(session);
            console.log(`[VoicePipeline] SD question pre-fetch complete: "${session.prefetchedSDQuestion?.title || "FAILED"}"`);

            // If prefetch failed, keep using persisted fallback title loaded earlier.
            if (!session.prefetchedSDQuestion && persistedSD?.questionTitle) {
                const fallbackProblemStatement =
                    persistedSDProblemStatement || buildSDProblemStatementFallback(persistedSD.questionTitle);
                session.currentQuestionTitle = persistedSD.questionTitle;
                session.prefetchedSDQuestion = {
                    id: persistedSD.questionId || `sd_${sessionId}`,
                    title: persistedSD.questionTitle,
                    problemStatement: fallbackProblemStatement,
                };
                console.warn(
                    `[VoicePipeline] Using persisted SD fallback title for ${sessionId}: "${persistedSD.questionTitle}"`
                );
            }

            if (!session.prefetchedSDQuestion) {
                throw new Error("System design prefetch returned no question.");
            }
        }

        // Pre-fetch GenAI questions for gen_ai_role interviews.
        if (
            typeConfig.stages.includes("GEN_AI_CONCEPTS") ||
            typeConfig.stages.includes("GEN_AI_CODING") ||
            typeConfig.stages.includes("GEN_AI_SYSTEM_DESIGN")
        ) {
            try {
                const genAIConceptOptions = session.moduleConfig?.stageOptions?.GEN_AI_CONCEPTS || {};
                const { conceptQuestions, codingQuestion, systemDesignQuestion } =
                    await prefetchGenAIQuestions(sessionId, dbSession.userId, "VoicePipeline", {
                        includeConcepts: typeConfig.stages.includes("GEN_AI_CONCEPTS"),
                        includeCoding: typeConfig.stages.includes("GEN_AI_CODING"),
                        includeSystemDesign: typeConfig.stages.includes("GEN_AI_SYSTEM_DESIGN"),
                        conceptSubtopics: genAIConceptOptions.subtopics,
                    });
                session.prefetchedGenAIConceptQuestions = conceptQuestions;
                session.prefetchedGenAICodingQuestion = codingQuestion;
                session.prefetchedGenAISystemDesignQuestion = systemDesignQuestion;
                console.log(`[VoicePipeline] GenAI prefetch complete: ${conceptQuestions.length} concept Qs, coding=${!!codingQuestion}`);
                if (typeConfig.stages.includes("GEN_AI_CONCEPTS") && conceptQuestions.length === 0) {
                    console.warn(`[VoicePipeline] GenAI concept question bank is empty — check DB seed.`);
                }
                if (typeConfig.stages.includes("GEN_AI_CODING") && !codingQuestion) {
                    console.warn(`[VoicePipeline] No GenAI coding task found — check DB seed.`);
                }
                if (
                    (typeConfig.stages.includes("GEN_AI_CONCEPTS") && conceptQuestions.length === 0) ||
                    (typeConfig.stages.includes("GEN_AI_CODING") && !codingQuestion)
                ) {
                    throw new Error(
                        "GenAI prefetch is incomplete " +
                        `(conceptQuestions=${conceptQuestions.length}, coding=${!!codingQuestion}).`
                    );
                }
            } catch (genAIPrefetchErr: any) {
                console.error(`[VoicePipeline] GenAI prefetch error:`, genAIPrefetchErr?.message);
                throw genAIPrefetchErr;
            }
        }

        // Pre-fetch DS questions for data_science_role interviews.
        if (
            typeConfig.stages.includes("DS_CONCEPTS") ||
            typeConfig.stages.includes("DS_SQL") ||
            typeConfig.stages.includes("DS_CODING")
        ) {
            try {
                const dsConceptOptions = session.moduleConfig?.stageOptions?.DS_CONCEPTS || {};
                const { conceptQuestions, sqlQuestion, codingQuestion } =
                    await prefetchDSQuestions(sessionId, dbSession.userId, "VoicePipeline", {
                        includeConcepts: typeConfig.stages.includes("DS_CONCEPTS"),
                        includeSQL: typeConfig.stages.includes("DS_SQL"),
                        includeCoding: typeConfig.stages.includes("DS_CODING"),
                        conceptCategories: dsConceptOptions.topics,
                    });
                session.prefetchedDSConceptQuestions = conceptQuestions;
                session.prefetchedDSSQLQuestion = sqlQuestion;
                session.prefetchedDSCodingQuestion = codingQuestion;
                console.log(`[VoicePipeline] DS prefetch complete: ${conceptQuestions.length} concept Qs, sql=${!!sqlQuestion}, coding=${!!codingQuestion}`);
                if (typeConfig.stages.includes("DS_CONCEPTS") && conceptQuestions.length === 0) {
                    console.warn(`[VoicePipeline] DS concept question bank is empty — check DB seed.`);
                }
                if (typeConfig.stages.includes("DS_SQL") && !sqlQuestion) {
                    console.warn(`[VoicePipeline] No DS SQL question found — check DB seed.`);
                }
                if (typeConfig.stages.includes("DS_CODING") && !codingQuestion) {
                    console.warn(`[VoicePipeline] No DS coding task found — check DB seed.`);
                }
                if (
                    (typeConfig.stages.includes("DS_CONCEPTS") && conceptQuestions.length === 0) ||
                    (typeConfig.stages.includes("DS_SQL") && !sqlQuestion) ||
                    (typeConfig.stages.includes("DS_CODING") && !codingQuestion)
                ) {
                    throw new Error(
                        "DS prefetch is incomplete " +
                        `(conceptQuestions=${conceptQuestions.length}, sql=${!!sqlQuestion}, coding=${!!codingQuestion}).`
                    );
                }
            } catch (dsPrefetchErr: any) {
                console.error(`[VoicePipeline] DS prefetch error:`, dsPrefetchErr?.message);
                throw dsPrefetchErr;
            }
        }

        // Pre-fetch PM questions for pm_role interviews. Voice must use the
        // same DB-backed banks as text/GenAI; otherwise it drifts into generic PM prompts.
        if (
            typeConfig.stages.includes("PM_CASE") ||
            typeConfig.stages.includes("PM_CONCEPTS") ||
            typeConfig.stages.includes("PM_STRATEGY")
        ) {
            try {
                const { caseQuestion, conceptQuestions, strategyQuestion } =
                    await prefetchPMQuestions(sessionId, dbSession.userId, "VoicePipeline", {
                        includeCase: typeConfig.stages.includes("PM_CASE"),
                        includeConcepts: typeConfig.stages.includes("PM_CONCEPTS"),
                        includeStrategy: typeConfig.stages.includes("PM_STRATEGY"),
                    });
                session.prefetchedPMCaseQuestion = caseQuestion;
                session.prefetchedPMConceptQuestions = conceptQuestions;
                session.prefetchedPMStrategyQuestion = strategyQuestion;
                console.log(`[VoicePipeline] PM prefetch complete: concept=${conceptQuestions.length}, case=${!!caseQuestion}, strategy=${!!strategyQuestion}`);
                if (
                    (typeConfig.stages.includes("PM_CASE") && !caseQuestion) ||
                    (typeConfig.stages.includes("PM_CONCEPTS") && conceptQuestions.length === 0) ||
                    (typeConfig.stages.includes("PM_STRATEGY") && !strategyQuestion)
                ) {
                    throw new Error(
                        "PM prefetch is incomplete " +
                        `(conceptQuestions=${conceptQuestions.length}, case=${!!caseQuestion}, strategy=${!!strategyQuestion}).`
                    );
                }
            } catch (pmPrefetchErr: any) {
                console.error(`[VoicePipeline] PM prefetch error:`, pmPrefetchErr?.message);
            }
        }

        if (interviewType === "problem_solving_case") {
            try {
                try {
                    await ensureMongoDBConnected();
                } catch (mongoErr) {
                    console.warn(`[VoicePipeline] MongoDB unavailable for problem-solving session ${sessionId}; continuing with fallback case.`, mongoErr);
                }
                session.prefetchedProblemSolvingCaseQuestion =
                    await prefetchProblemSolvingCaseQuestion(sessionId, dbSession.userId, "VoicePipeline");
                if (!session.prefetchedProblemSolvingCaseQuestion) {
                    throw new Error("Problem-solving case prefetch returned no question.");
                }
                console.log(`[VoicePipeline] Problem-solving case prefetch complete: "${session.prefetchedProblemSolvingCaseQuestion.title}"`);
            } catch (problemPrefetchErr: any) {
                console.error(`[VoicePipeline] Problem-solving prefetch error:`, problemPrefetchErr?.message);
                throw problemPrefetchErr;
            }
        }
    } catch (prefetchErr: any) {
        const errMsg = prefetchErr?.message || "Failed to prefetch required question banks before interview start.";
        console.error(`[VoicePipeline] Prefetch failed for ${sessionId}:`, prefetchErr);
        activeSessions.delete(sessionId);
        callbacks.onError(sanitizeErrorMessage(errMsg));
        return;
    }
    // -- Resume web context prefetch (non-fatal, runs at init time) -----------
    // Run AFTER fatal prefetches so a web search failure never blocks the interview.
    // Result stored on session so generateAndSpeak injects it without any first-turn delay.
    if (RESUME_WEB_SEARCH_TYPES.has(interviewType) && session.resumeSummary) {
        session.resumeWebSearchUsed = true;
        prefetchResumeWebContext({
            sessionId: session.sessionId,
            resumeSummary: session.resumeSummary,
            interviewType: session.interviewType,
            role: session.role,
            level: session.level,
            logPrefix: "VoicePipeline",
        }).then((webCtx) => {
            if (webCtx) {
                session.resumeWebSearchContext = webCtx;
                console.log(`[VoicePipeline] Resume web context cached at init for ${sessionId}`);
            }
        }).catch(() => { /* non-fatal -- already logged inside prefetchResumeWebContext */ });
    }

    try {
        // Connect Deepgram STT
        session.sttSocket = createSTTSocket(session);

        await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("STT connection timeout")), 10000);
            session.sttSocket!.on("open", () => {
                clearTimeout(timeout);
                resolve();
            });
            session.sttSocket!.on("error", (err) => {
                clearTimeout(timeout);
                reject(err);
            });
        });

        callbacks.onReady();

        // Send initial greeting through LLM → TTS (non-blocking) if fresh session
        const hasPriorInterviewDialogue = hasInterviewDialogue(session.history);

        if (!hasPriorInterviewDialogue) {
            (async () => {
                if (session.companyScreening && isCompanyScreeningMockInterviewerEnabled()) {
                    await speakAndPersistMockTextOnly(session, buildVoiceOpeningMessage(session), session.currentStage, callbacks);
                    await processCompanyScreeningMockVoiceTurn(session, callbacks, null);
                    return;
                }
                // Company screening: deliver the SCREENING welcome (not the generic behavioural
                // one) and hand off to the server pacing pointer. Critically, do NOT fall through
                // to the behavioural branch below — that injects a "ask the first behavioral
                // question" instruction which makes the whole interview behavioural regardless of
                // the recruiter's configured phases. The pointer assigns the first real phase
                // question (resume) on the candidate's first reply via the Current Turn block.
                if (session.companyScreening) {
                    await speakAndPersist(
                        session,
                        buildCompanyScreeningOpeningMessage(session.companyScreening, session.role),
                        session.currentStage,
                        callbacks
                    );
                    session.history.push({
                        role: "user",
                        content:
                            "[SYSTEM NOTIFICATION] The screening welcome has been delivered. Wait for the candidate's first reply, " +
                            "then ask ONLY the server-assigned question shown in the Current Turn block. Do NOT ask a generic " +
                            "behavioural question or run this as a behavioural interview — follow the recruiter's configured phases.",
                    });
                    return;
                }
                await speakAndPersist(session, buildInterviewOpeningMessage({
                    interviewType: session.interviewType,
                    role: session.role,
                    level: session.level,
                    stageOrder: session.stageOrder,
                    moduleConfig: session.moduleConfig,
                }), session.currentStage, callbacks);
                if (session.interviewType === "behavioural") {
                    session.history.push({
                        role: "user",
                        content:
                            "[SYSTEM NOTIFICATION] Behavioural welcome has been delivered. " +
                            "Wait for the candidate's first response before asking the first behavioral question. " +
                            "Do not combine the welcome with a question.",
                    });
                    return;
                }
                if (session.currentStage === "DSA" && session.prefetchedDSAQuestion) {
                    await speakAndPersist(session, buildVoicePinnedDsaIntro(session.prefetchedDSAQuestion), "DSA", callbacks);
                    return;
                }
                if (await speakCurrentRoleStageIntro(session, callbacks)) return;
                session.history.push({
                    role: "user",
                    content: session.interviewType === "full_interview"
                        ? "[SYSTEM NOTIFICATION] The server already delivered the welcome and format overview. Do not greet, acknowledge readiness, or repeat the format. Ask only: Can you tell me about yourself?"
                        : session.interviewType === "data_science_role"
                            ? "[SYSTEM NOTIFICATION] The server already delivered the welcome and format overview. Do not greet, thank the candidate for joining, acknowledge readiness, or repeat the format. Start directly with the first data-science resume/project question."
                            : "Hello! I am ready for the interview.",
                });
                await generateAndSpeak(session, callbacks);
            })().catch(err => {
                console.error(`[Voice] Initial greeting error for ${sessionId}:`, err?.message || err);
            });
        } else {
            console.log(`[Voice] Session ${sessionId} resumed with ${session.history.length} prior messages.`);
            const lastMsg = session.history[session.history.length - 1];
            if (lastMsg && (lastMsg.role === "user" as any || lastMsg.role === "user")) {
                console.log(`[Voice] Resuming: Last message was from user. Scheduling auto-response for ${sessionId}.`);
                // Short delay to ensure UI stability
                setTimeout(() => {
                    if (activeSessions.has(sessionId)) {
                        generateAndSpeak(session, callbacks).catch(err => {
                            console.error(`[Voice] Resume auto-response error for ${sessionId}:`, err?.message || err);
                        });
                    }
                }, 300);
            }
        }

    } catch (err: any) {
        const errMsg = err?.message || err?.toString?.() || "Failed to start voice session";
        console.error(`[Voice] Failed to start voice session for ${sessionId}:`, errMsg);
        if (session.sttSocket) {
            try { session.sttSocket.close(); } catch { /* ignore */ }
            session.sttSocket = null;
        }
        activeSessions.delete(sessionId);
        callbacks.onError(sanitizeErrorMessage(errMsg));
    }
}

/**
 * Forward raw audio from the client to Deepgram STT.
 */
let audioPacketCount = 0;

function describePcmLevel(audioBuffer: Buffer): string {
    if (audioBuffer.length < 2) return "empty";
    const sampleCount = Math.floor(audioBuffer.length / 2);
    let sumSquares = 0;
    let peak = 0;
    for (let offset = 0; offset + 1 < audioBuffer.length; offset += 2) {
        const sample = audioBuffer.readInt16LE(offset) / 32768;
        const abs = Math.abs(sample);
        sumSquares += sample * sample;
        if (abs > peak) peak = abs;
    }
    const rms = Math.sqrt(sumSquares / sampleCount);
    return `rms=${rms.toFixed(4)}, peak=${peak.toFixed(4)}`;
}

export function sendAudioToVoice(
    sessionId: string,
    base64Audio: string,
    _mimeType: string
): void {
    const session = activeSessions.get(sessionId);
    if (!session) return;

    let audioBuffer: Buffer;
    try {
        audioBuffer = Buffer.from(base64Audio, "base64");
    } catch (err) {
        console.error(`[Voice] Failed to decode base64 audio for ${sessionId}:`, err);
        return;
    }

    sendAudioBufferToVoice(sessionId, audioBuffer, _mimeType);
}

export function sendAudioBufferToVoice(
    sessionId: string,
    audioBuffer: Buffer,
    _mimeType: string
): void {
    const session = activeSessions.get(sessionId);
    if (!session) return;

    if (!session.sttSocket || session.sttSocket.readyState !== WebSocket.OPEN) {
        if (session.pendingAudioPackets.length >= MAX_PENDING_STT_AUDIO_PACKETS) {
            session.pendingAudioPackets.shift();
        }
        session.pendingAudioPackets.push(audioBuffer);
        if (audioPacketCount++ % 150 === 0) {
            const state = session.sttSocket ? session.sttSocket.readyState : "none";
            console.warn(`[Voice] STT not ready (state=${state}) for ${sessionId}, buffering audio (${session.pendingAudioPackets.length}/${MAX_PENDING_STT_AUDIO_PACKETS})`);
        }
        return;
    }

    try {
        // Send raw PCM to Deepgram
        session.sttSocket.send(audioBuffer);
        // Log every 200th packet to confirm audio is flowing
        if (audioPacketCount++ % 200 === 0) {
            console.log(`[Voice] Audio flowing to STT (packet #${audioPacketCount}, ${audioBuffer.length} bytes, ${describePcmLevel(audioBuffer)})`);
        }
    } catch (err) {
        console.error(`[Voice] Send audio error for ${sessionId}:`, err);
    }
}

/**
 * Send typed text directly through the LLM pipeline (bypass STT).
 */
export function sendTextToVoice(sessionId: string, text: string): boolean {
    const session = activeSessions.get(sessionId);
    if (!session) return false;

    // Barge-in if generating
    if (session.isGenerating) {
        session.abortController?.abort();
        session.isGenerating = false;
        session.callbacks.emit("voice:interrupted", {});
    }

    handleUserUtterance(session, text).catch(err => {
        console.error(`[Voice] Text input error for ${sessionId}:`, err);
    });

    return true;
}

/**
 * Stop the voice session and clean up resources.
 */
export function stopVoiceSession(sessionId: string): void {
    const session = activeSessions.get(sessionId);
    if (!session) {
        // Clean up pending PTT mode if session was never created
        pendingPTTModes.delete(sessionId);
        return;
    }

    // Abort any ongoing generation
    session.abortController?.abort();

    // Clear mute reminder timer
    if (session.muteTimer) {
        clearTimeout(session.muteTimer);
        session.muteTimer = null;
    }

    // Clear SQL phase timers
    clearVoiceSQLTimers(session);
    clearVoiceDSATimers(session);
    clearPTTFlushTimer(session);

    // Close Deepgram STT
    if (session.sttSocket) {
        try {
            session.sttSocket.send(JSON.stringify({ type: "CloseStream" }));
            session.sttSocket.close();
        } catch { /* ignore */ }
        session.sttSocket = null;
    }
    session.pendingAudioPackets = [];

    activeSessions.delete(sessionId);
    pendingPTTModes.delete(sessionId); // Clean up pending PTT mode
}

/**
 * Check if a voice session is active.
 */
export function isVoiceSessionActive(sessionId: string): boolean {
    const session = activeSessions.get(sessionId);
    return !!session && !!session.sttSocket;
}

/**
 * Update the code snapshot for context injection.
 */
export function updateVoiceCodeSnapshot(
    sessionId: string,
    code: string,
    language: string
): void {
    const session = activeSessions.get(sessionId);
    if (!session) return;
    if (language === "sql") {
        session.sqlSnapshot = code;
    } else {
        session.codeSnapshot = code;
        session.codeLanguage = language;
    }
}


/**
 * Update the canvas snapshot (Excalidraw elements) for context injection.
 */
export function updateVoiceCanvasSnapshot(
    sessionId: string,
    elements: any
): void {
    const session = activeSessions.get(sessionId);
    if (!session) return;
    session.canvasSnapshot = elements;
    const count = Array.isArray(elements)
        ? elements.filter((el: any) => el && !el.isDeleted && el.type !== "selection").length
        : 0;
    if (count > 0) {
        const types = Array.isArray(elements)
            ? Array.from(new Set(elements.map((el: any) => String(el?.type || "unknown")))).join(", ")
            : "unknown";
        console.log(`[Voice] Canvas snapshot updated for ${sessionId}: ${count} elements (${types})`);
    }
}

export function updateVoiceNotepadSnapshot(
    sessionId: string,
    html: string
): void {
    const session = activeSessions.get(sessionId);
    if (!session) return;
    session.notepadSnapshot = html;
}

/**
 * Update the rubricLite for context injection (from MongoDB question fetch).
 */
export function updateVoiceRubricLite(
    sessionId: string,
    rubricLite: any
): void {
    const session = activeSessions.get(sessionId);
    if (!session) return;
    session.rubricLite = rubricLite;
}

// ── Voice SQL Phase Timer Management ─────────────────────────
// Mirrors the text-mode orchestrator's logic but uses handleInternalNudge
// (which fires the LLM+TTS pipeline) instead of processAgentTurn.

const VOICE_SQL_APPROACH_MS = 5 * 60 * 1000;  // 5 minutes — approach reminder
const VOICE_SQL_QUERY_MS = 10 * 60 * 1000;  // 10 minutes — query-written reminder
const VOICE_SQL_TOTAL_MS = 15 * 60 * 1000;  // 15 minutes — hard timeout

function clearVoiceSQLTimers(session: VoiceSession): void {
    if (session.sqlApproachTimer) { clearTimeout(session.sqlApproachTimer); session.sqlApproachTimer = null; }
    if (session.sqlQueryTimer) { clearTimeout(session.sqlQueryTimer); session.sqlQueryTimer = null; }
    if (session.sqlTotalTimer) { clearTimeout(session.sqlTotalTimer); session.sqlTotalTimer = null; }
}

function startVoiceSQLPhaseTimers(session: VoiceSession): void {
    clearVoiceSQLTimers(session);
    console.log(`[Voice] SQL timers started for ${session.sessionId} (approach:5m, query:10m, total:15m)`);

    // 5-min approach reminder (conditional — AI only speaks if approach not yet given)
    session.sqlApproachTimer = setTimeout(function fireApproach() {
        if (!activeSessions.has(session.sessionId)) return;
        if (session.isGenerating) {
            console.log(`[Voice] SQL approach nudge deferred — turn in flight for ${session.sessionId}`);
            session.sqlApproachTimer = setTimeout(fireApproach, 5_000);
            return;
        }
        session.sqlApproachTimer = null;
        console.log(`[Voice] SQL approach timer fired for ${session.sessionId}`);
        handleInternalNudge(
            session,
            "[SYSTEM NOTIFICATION] 5 minutes have passed on the SQL question. " +
            "Check the conversation: has the candidate clearly articulated their approach (i.e. explained " +
            "how they plan to write the query, which tables/joins/conditions they'll use)? " +
            "If NOT yet, gently remind them: \"We're about 5 minutes in — do you have an approach in mind? " +
            "Walk me through how you're thinking about this.\" " +
            "If they HAVE already explained their approach, say nothing about the time and continue naturally."
        ).catch(err => console.error("[Voice] SQL approach nudge error:", err));
    }, VOICE_SQL_APPROACH_MS);

    // 10-min query-written reminder (conditional — AI only speaks if no query written yet)
    session.sqlQueryTimer = setTimeout(function fireQuery() {
        if (!activeSessions.has(session.sessionId)) return;
        if (session.isGenerating) {
            console.log(`[Voice] SQL query nudge deferred — turn in flight for ${session.sessionId}`);
            session.sqlQueryTimer = setTimeout(fireQuery, 5_000);
            return;
        }
        session.sqlQueryTimer = null;
        console.log(`[Voice] SQL query timer fired for ${session.sessionId}`);
        handleInternalNudge(
            session,
            "[SYSTEM NOTIFICATION] 10 minutes have passed on the SQL question. " +
            "Check the conversation: has the candidate written any SQL in the editor (attempted a query, " +
            "even a partial or incorrect one)? " +
            "If they have NOT written anything yet, gently prompt them: \"We're 10 minutes in — let's try " +
            "to get something down in the editor, even a rough attempt is fine.\" " +
            "If they HAVE already written something (correct or not), say nothing about the time and continue naturally."
        ).catch(err => console.error("[Voice] SQL query nudge error:", err));
    }, VOICE_SQL_QUERY_MS);

    // 15-min hard timeout — close panel, continue to OS
    session.sqlTotalTimer = setTimeout(function fireTotal() {
        if (!activeSessions.has(session.sessionId)) return;
        if (session.isGenerating) {
            console.log(`[Voice] SQL total nudge deferred — turn in flight for ${session.sessionId}`);
            session.sqlTotalTimer = setTimeout(fireTotal, 5_000);
            return;
        }
        session.sqlTotalTimer = null;
        session.sqlApproachTimer && clearTimeout(session.sqlApproachTimer); session.sqlApproachTimer = null;
        session.sqlQueryTimer && clearTimeout(session.sqlQueryTimer); session.sqlQueryTimer = null;
        const nextAfterSql = getNextCSPhase(session, "SQL");
        console.log(`[Voice] SQL total timer fired for ${session.sessionId} — closing SQL panel, continuing to ${nextAfterSql || "CLOSING"}`);
        handleInternalNudge(
            session,
            "[SYSTEM NOTIFICATION] The 15-minute SQL round time limit has been reached. " +
            "Wrap up the SQL round immediately: give brief, neutral feedback on the candidate's attempt " +
            "(e.g. \"Thanks for the effort — let's move on\"), then call close_panel to close the SQL editor. " +
            (nextAfterSql
                ? `After closing, continue with ${nextAfterSql}. Ignore any older instruction that mentions OS as a fixed next topic. `
                : "After closing, transition to CLOSING. Ignore any older instruction that mentions OS as a fixed next topic. ") +
            "Do not follow any fixed Phase 3 or OS instruction unless OS is actually the next configured topic. " +
            "Legacy ignored: " +
            "After closing, immediately continue with the next configured item by following the dynamic " +
            "interview flow — use the OS question from the question bank already provided in your system prompt. " +
            "You are still in the FUNDAMENTALS stage — do NOT call transition_stage and do NOT end the interview."
        ).catch(err => console.error("[Voice] SQL timeout nudge error:", err));
    }, VOICE_SQL_TOTAL_MS);
}

// ── Voice DSA Phase Timer Management ─────────────────────────

/**
 * Total minutes for the DSA/coding phase in THIS voice interview, read from its own
 * config (moduleConfig override → effective type config → 30 fallback). Mirrors the
 * text path's getDSAPhaseTotalMinutes so voice and text stay in sync: coding → 40m,
 * SDE full_interview → 30m. Reading per-interview config keeps them independent —
 * bumping coding to 40m never affects SDE.
 */
function getVoiceDSAPhaseTotalMinutes(session: VoiceSession): number {
    const fromModule = session.moduleConfig?.stageDurations?.DSA;
    if (fromModule && typeof fromModule.max === "number" && fromModule.max > 0) {
        return fromModule.max;
    }
    const effectiveConfig = resolveEffectiveInterviewTypeConfig(session.interviewType, session.moduleConfig);
    const fromType = effectiveConfig.stageDurations?.DSA;
    if (fromType && typeof fromType.max === "number" && fromType.max > 0) {
        return fromType.max;
    }
    return 30;
}

function clearVoiceDSATimers(session: VoiceSession): void {
    if (session.dsa20Timer) { clearTimeout(session.dsa20Timer); session.dsa20Timer = null; }
    if (session.dsa25Timer) { clearTimeout(session.dsa25Timer); session.dsa25Timer = null; }
    if (session.dsa30Timer) { clearTimeout(session.dsa30Timer); session.dsa30Timer = null; }
}

function startVoiceDSAPhaseTimers(session: VoiceSession): void {
    clearVoiceDSATimers(session);

    // Checkpoints derived from this interview's configured DSA duration so the nudges
    // and hard-stop match the candidate's countdown clock (coding 40m → 30m/35m/40m;
    // SDE 30m → 20m/25m/30m, unchanged).
    const totalMin = getVoiceDSAPhaseTotalMinutes(session);
    const firstNudgeMin = Math.max(1, totalMin - 10);   // "10 minutes left"
    const secondNudgeMin = Math.max(1, totalMin - 5);    // "5 minutes left"
    const firstNudgeMs = firstNudgeMin * 60 * 1000;
    const secondNudgeMs = secondNudgeMin * 60 * 1000;
    const totalMs = totalMin * 60 * 1000;
    console.log(`[Voice] DSA timers started for ${session.sessionId} (${firstNudgeMin}m, ${secondNudgeMin}m, ${totalMin}m hard timeout)`);

    session.dsa20Timer = setTimeout(function fire20() {
        if (!activeSessions.has(session.sessionId) || session.currentStage !== "DSA") return;
        if (session.isGenerating) {
            session.dsa20Timer = setTimeout(fire20, 5_000);
            return;
        }
        session.dsa20Timer = null;
        handleInternalNudge(
            session,
            `[SYSTEM NOTIFICATION] ${firstNudgeMin} minutes have elapsed in the coding round. There are 10 minutes left. Briefly remind the candidate to focus on completion, testing, and complexity explanation. Do not mention internal stage names.`
        ).catch(err => console.error("[Voice] DSA first nudge error:", err));
    }, firstNudgeMs);

    session.dsa25Timer = setTimeout(function fire25() {
        if (!activeSessions.has(session.sessionId) || session.currentStage !== "DSA") return;
        if (session.isGenerating) {
            session.dsa25Timer = setTimeout(fire25, 5_000);
            return;
        }
        session.dsa25Timer = null;
        handleInternalNudge(
            session,
            `[SYSTEM NOTIFICATION] ${secondNudgeMin} minutes have elapsed in the coding round. There are 5 minutes left. Ask for a final run/submit and a concise time-space complexity summary. Do not mention internal stage names.`
        ).catch(err => console.error("[Voice] DSA second nudge error:", err));
    }, secondNudgeMs);

    session.dsa30Timer = setTimeout(function fire30() {
        if (!activeSessions.has(session.sessionId) || session.currentStage !== "DSA") return;
        if (session.isGenerating) {
            session.dsa30Timer = setTimeout(fire30, 5_000);
            return;
        }

        forceVoiceDSATimeoutTransition(session.sessionId).catch(err => {
            console.error("[Voice] DSA hard-timeout transition error:", err);
        });
    }, totalMs);
}

export async function forceVoiceDSATimeoutTransition(sessionId: string): Promise<boolean> {
    const session = activeSessions.get(sessionId);
    if (!session || session.currentStage !== "DSA") return false;

    clearVoiceDSATimers(session);
    session.callbacks.emit("panel:close", { summary: "Coding round time limit reached." });

    const nextStage = getNextEnabledStage(session.stageOrder, "DSA");

    const toolCtx: ToolContext = {
        sessionId: session.sessionId,
        userId: session.userId,
        interviewType: session.interviewType,
        currentStage: session.currentStage,
        askedQuestionIds: session.askedQuestionIds,
        role: session.role,
        level: session.level,
        stageOrder: session.stageOrder,
        lastFetchedQuestionId: session.lastFetchedQuestionId,
        lastFetchedLanguage: session.lastFetchedLanguage,
        prefetchedDSAQuestion: session.prefetchedDSAQuestion ?? null,
        prefetchedBehavioralQuestions: session.prefetchedBehavioralQuestions,
        prefetchedCSQuestions: session.prefetchedCSQuestions,
        prefetchedSDQuestion: session.prefetchedSDQuestion ?? null,
        cachedQuestionData: session.cachedQuestionData ?? new Map(),
        scratchpadOpened: session.scratchpadOpened,
        systemDesignExchangeCount: session.systemDesignExchangeCount,
        emit: session.callbacks.emit,
    };

    if (nextStage) {
        const result = await handleToolCall(
            "transition_stage",
            { nextStage, reason: "DSA 30-minute time limit reached" },
            toolCtx
        );

        if (!result.startsWith("Interview transitioned")) {
            console.warn(`[Voice] DSA hard-timeout transition was not applied for ${sessionId}: ${result}`);
            return false;
        }

        session.currentStage = toolCtx.currentStage;

        await handleInternalNudge(
            session,
            "[SYSTEM NOTIFICATION] The coding round has ended due to the 30-minute limit. The coding panel has already been closed and the session has already moved forward to the current non-coding stage. Do not continue the coding problem, do not ask DSA follow-ups, and do not refer to DSA as the active phase. Give one brief wrap-up sentence, then continue naturally with the current stage instructions. Do not mention internal stage names."
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

// Mute reminder interval (30 seconds of being muted after AI finishes speaking)
const MUTE_REMINDER_MS = 30_000;

function scheduleMuteReminder(session: VoiceSession): void {
    if (!session.isMuted || session.isGenerating) return;

    if (session.muteTimer) {
        clearTimeout(session.muteTimer);
        session.muteTimer = null;
    }

    const { sessionId } = session;
    session.muteTimer = setTimeout(() => {
        if (!session.isMuted || session.isGenerating) return;
        console.log(`[Voice] User muted for ${MUTE_REMINDER_MS / 1000}s in ${sessionId}, sending reminder`);

        // Direct reminder (no LLM turn): avoids accidental question repetition loops
        // caused by internal-nudge-generated assistant responses.
        const reminder = "Could you please unmute your microphone so I can hear you clearly?";
        session.callbacks.onAiTranscript(reminder);
        textToSpeech(reminder, session.callbacks, new AbortController().signal).catch(err => {
            console.error("[Voice] Mute reminder error:", err);
        });
    }, MUTE_REMINDER_MS);
}

/**
 * Update mute state for a voice session.
 * If muted for too long after the AI has finished speaking, send a reminder.
 */
export function setVoiceMuteState(sessionId: string, muted: boolean): void {
    const session = activeSessions.get(sessionId);
    if (!session) return;

    session.isMuted = muted;

    // Clear any existing mute timer
    if (session.muteTimer) {
        clearTimeout(session.muteTimer);
        session.muteTimer = null;
    }

    if (muted) scheduleMuteReminder(session);
}

// ── Push-to-Talk Public API ──────────────────────────────────

/** Delay after spacebar release before safety-flushing (3 seconds). */
const PTT_FLUSH_SAFETY_MS = 3_000;

function clearPTTFlushTimer(session: VoiceSession): void {
    if (session.pttFlushTimer) {
        clearTimeout(session.pttFlushTimer);
        session.pttFlushTimer = null;
    }
}

/**
 * Enable or disable push-to-talk mode for a voice session.
 * When enabled, EndOfTurn events are buffered while the user holds spacebar.
 */
export function setVoicePTTMode(sessionId: string, enabled: boolean): void {
    const session = activeSessions.get(sessionId);
    
    if (!session) {
        console.log(`[PTT][Pipeline] Session ${sessionId} not found yet - storing PTT preference for when it's created`);
        pendingPTTModes.set(sessionId, enabled);
        console.log(`[PTT][Pipeline] Stored pending PTT mode: ${enabled} for session ${sessionId}`);
        return;
    }

    console.log(`[PTT][Pipeline] ========================================`);
    console.log(`[PTT][Pipeline] Setting PTT mode for session ${sessionId}`);
    console.log(`[PTT][Pipeline] Previous state: ${session.isPTTActive}`);
    console.log(`[PTT][Pipeline] New state: ${enabled}`);

    session.isPTTActive = enabled;

    if (!enabled) {
        // Turning off PTT — reset all PTT state and flush any remaining buffer
        console.log(`[PTT][Pipeline] Disabling PTT - cleaning up state`);
        clearPTTFlushTimer(session);
        session.pttPendingFlush = false;
        if (session.pttTranscriptBuffer.length > 0) {
            console.log(`[PTT][Pipeline] Flushing ${session.pttTranscriptBuffer.length} remaining buffered segments`);
            flushPTTBuffer(session);
        }
        session.isPTTHolding = false;
        session.pttTranscriptBuffer = [];
        console.log(`[PTT][Pipeline] PTT state reset complete`);
    } else {
        console.log(`[PTT][Pipeline] PTT mode enabled - ready for spacebar control`);
    }

    console.log(`[PTT][Pipeline] ========================================`);
}

/**
 * Signal that the user is holding the spacebar (start buffering).
 * While holding, all EndOfTurn transcripts are accumulated instead of
 * triggering the LLM pipeline.
 */
export function setVoicePTTHolding(sessionId: string): void {
    const session = activeSessions.get(sessionId);
    if (!session || !session.isPTTActive) {
        console.log(`[PTT][Pipeline] setVoicePTTHolding called but session ${sessionId} not found or PTT not active`);
        return;
    }

    console.log(`[PTT][Pipeline] ========================================`);
    console.log(`[PTT][Pipeline] SPACEBAR HOLD started for session ${sessionId}`);
    console.log(`[PTT][Pipeline] Timestamp: ${new Date().toISOString()}`);
    console.log(`[PTT][Pipeline] Previous buffer size: ${session.pttTranscriptBuffer.length} segments`);

    session.isPTTHolding = true;
    session.pttPendingFlush = false;
    clearPTTFlushTimer(session);
    // Clear the buffer for a fresh answer
    session.pttTranscriptBuffer = [];
    session.userTranscriptBuffer = "";
    console.log(`[PTT][Pipeline] Buffer cleared - ready to capture new transcripts`);

    // If AI is currently speaking, stop it — the user has taken control
    if (session.isGenerating) {
        console.log(`[PTT][Pipeline] AI was speaking - interrupting to let user speak`);
        session.abortController?.abort();
        session.isGenerating = false;
        session.callbacks.emit("voice:interrupted", {});
    }

    console.log(`[PTT][Pipeline] Now buffering all transcripts until spacebar release`);
    console.log(`[PTT][Pipeline] ========================================`);
}

/**
 * Signal that the user released the spacebar.
 * 
 * Waits for a short grace period (450ms) to allow trailing audio (the "last word")
 * to reach the STT and process, then flushes the buffer to trigger AI response.
 */
export function releaseVoicePTT(sessionId: string): void {
    const session = activeSessions.get(sessionId);
    if (!session || !session.isPTTActive) {
        console.log(`[PTT][Pipeline] releaseVoicePTT called but session ${sessionId} not found or PTT not active`);
        return;
    }

    console.log(`[PTT][Pipeline] ========================================`);
    console.log(`[PTT][Pipeline] SPACEBAR RELEASED for session ${sessionId}`);
    console.log(`[PTT][Pipeline] Starting 800ms grace period for trailing audio...`);

    session.isPTTHolding = false;
    session.pttPendingFlush = true;
    
    // Clear any existing timer just in case
    clearPTTFlushTimer(session);

    // Set a timer to flush after the grace period ends
    session.pttFlushTimer = setTimeout(() => {
        // Double check we are still in pending flush state
        if (activeSessions.has(sessionId) && session.pttPendingFlush) {
            console.log(`[PTT][Pipeline] Grace period ended for ${sessionId} - performing final flush`);
            performPTTFlush(session);
        }
    }, 800); 
    
    console.log(`[PTT][Pipeline] ========================================`);
}

/**
 * Internal: perform the actual buffer flush and STT socket reset.
 * Called either when the grace period timer expires or when a final EndOfTurn arrives.
 * 
 * @param wasEndOfTurn If true, we received a natural EndOfTurn event from STT.
 *                     In this case, we don't need to force-reset the socket because
 *                     the STT has already cleared its internal accumulator.
 */
function performPTTFlush(session: VoiceSession, wasEndOfTurn: boolean = false): void {
    if (!session.pttPendingFlush) return;

    console.log(`[PTT][Pipeline] ── PERFORMING PTT FLUSH ──`);
    session.pttPendingFlush = false;
    clearPTTFlushTimer(session);

    // Push any remaining interim transcript from userTranscriptBuffer
    if (session.userTranscriptBuffer.trim()) {
        console.log(`[PTT][Pipeline] Capturing final interim transcript: "${session.userTranscriptBuffer.trim()}"`);
        session.pttTranscriptBuffer.push(session.userTranscriptBuffer.trim());
        session.userTranscriptBuffer = "";
    }

    // Flush to LLM
    if (session.pttTranscriptBuffer.length > 0) {
        console.log(`[PTT][Pipeline] Flushing ${session.pttTranscriptBuffer.length} segments to AI...`);
        flushPTTBuffer(session);
    } else {
        console.log(`[PTT][Pipeline] No speech captured during this hold - nothing to flush`);
    }

    // Reset STT context to ensure no previous speech is carried over.
    // Optimization: Only force-reset if we DIDN'T get a natural EndOfTurn.
    if (!wasEndOfTurn && session.sttSocket) {
        console.log(`[PTT][Pipeline] No EndOfTurn received within grace period - resetting STT socket to clear context`);
        session.sttSocket.close();
    } else if (wasEndOfTurn) {
        console.log(`[PTT][Pipeline] EndOfTurn received - socket context is already clean`);
    }
    
    console.log(`[PTT][Pipeline] ───────────────────────────`);
}

/**
 * Internal: combine buffered PTT transcript segments and send them
 * through the normal user-utterance → LLM pipeline.
 */
function flushPTTBuffer(session: VoiceSession): void {
    console.log(`[PTT][Pipeline] ========================================`);
    console.log(`[PTT][Pipeline] FLUSHING BUFFER for session ${session.sessionId}`);
    console.log(`[PTT][Pipeline] Timestamp: ${new Date().toISOString()}`);
    console.log(`[PTT][Pipeline] Buffer segments before flush: ${session.pttTranscriptBuffer.length}`);
    
    const combinedText = session.pttTranscriptBuffer.join(" ").trim();
    session.pttTranscriptBuffer = [];

    if (!combinedText) {
        console.log(`[PTT][Pipeline] Combined text is empty after trim - aborting flush`);
        console.log(`[PTT][Pipeline] ========================================`);
        return;
    }

    console.log(`[PTT][Pipeline] Combined text length: ${combinedText.length} characters`);
    console.log(`[PTT][Pipeline] Combined text preview: "${combinedText.substring(0, 200)}${combinedText.length > 200 ? '...' : ''}"`);

    // IMPORTANT: Show the user's transcript in the chat
    console.log(`[PTT][Pipeline] Emitting user transcript to client for display`);
    console.log(`[PTT][Pipeline] User transcript text: "${combinedText}"`);
    session.callbacks.onUserTranscript(combinedText);
    console.log(`[PTT][Pipeline] onUserTranscript callback completed`);

    // Barge-in if AI is somehow still generating
    if (session.isGenerating) {
        console.log(`[PTT][Pipeline] AI was still generating - aborting to process user input`);
        session.abortController?.abort();
        session.isGenerating = false;
        session.callbacks.emit("voice:interrupted", {});
    }

    console.log(`[PTT][Pipeline] Sending combined text to LLM pipeline...`);
    handleUserUtterance(session, combinedText).catch(err => {
        console.error(`[PTT][Pipeline] ERROR in handleUserUtterance:`, err);
    });
    console.log(`[PTT][Pipeline] Buffer flush complete - AI should respond now`);
    console.log(`[PTT][Pipeline] ========================================`);
}


