"use client";

import { ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/context/auth-context";
import { useBilling } from "@/hooks/use-billing";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { LockedFeature } from "@/components/locked-feature";
import {
    UpgradeModal,
    copyFromUpgradeError,
    shouldShowUpgradeForError,
} from "@/components/upgrade-modal";
import { ArtifactDetailModal, ProfileSetupModal } from "./agent-modals";
import { ActionPlanPreviewModal } from "./action-plan-preview-modal";
import { QuizModal } from "./quiz-modal";

/* ═══════════════ Types ═══════════════ */

type RubricScore = { category: string; score: number };

type WeakArea = {
    category: string;
    score: number;
    why: string;
    actionItems: string[];
};

type ActionPlan = {
    strengths: string[];
    weakAreas: WeakArea[];
    overallSummary: string;
    priorityFocus: string;
    practiceQuestionCount?: number;
    dailyPlan?: Array<{
        day: number;
        focus: string;
        questionCount: number;
    }>;
    plannedDays?: Array<{
        day: number;
        focus: string;
        questionCount: number;
        questionTags: Array<{ category: string; count: number }>;
        questions: Array<{
            id: string;
            title: string;
            category: string;
            solveUrl: string | null;
        }>;
    }>;
};

type ActionPlanTimespan = "1_week" | "2_weeks" | "monthly";

type AcceptedActionPlanMeta = {
    id: string;
    reportId: string;
    sessionId: string;
    timespan: ActionPlanTimespan;
    label: string;
    startDate: string;
    endDate: string;
    acceptedAt: string;
    actionPlan?: ActionPlan | null;
};

type TutorQuestion = {
    id: string;
    category: string;
    difficulty: "easy" | "medium" | "hard";
    prompt: string;
    whatWeAreLookingFor: string;
    linkedToReportMoment?: string;
};

type TutorReportSummary = {
    reportId: string;
    sessionId: string;
    type: string;
    role: string;
    level: string;
    overallScore: number;
    generatedAt: string;
    rubricScores: RubricScore[];
};

type MessageKind = "text" | "question" | "feedback" | "nudge" | "tool-action-plan" | "tool-sheet" | "tool-report" | "artifact";
type AvatarState = "welcome" | "idle" | "ai-typing";

type ChatMessage = {
    id: string;
    role: "assistant" | "user";
    content: string;
    kind?: MessageKind;
    createdAt?: string;
};

type PersistedChatMessage = {
    id: string;
    role: "assistant" | "user";
    content: string;
    createdAt: string;
};

type TutorConversation = {
    id: string;
    reportId: string;
    title: string;
    status: "active" | "archived";
    createdAt: string;
    lastMessageAt: string;
    messageCount: number;
    isLegacy?: boolean;
};

type ReportMeta = {
    id: string;
    overallScore: number;
    generatedAt: string;
    session: { type: string; role: string; level: string };
};

type SheetMeta = {
    sheetId: string;
    reportId: string;
    label: string;
    generatedAt: string;
    totalQuestions: number;
    completedQuestions: number;
};

type PreviewTab = "action-plan" | "questions" | "report" | null;

type UiDirective = {
    panel: "action-plan" | "questions" | "report";
    reason?: string;
    payload?: Record<string, unknown>;
};

type ToolLabel = {
    toolName: string;
    label: string;
    status: "ok" | "error";
};

type LastActiveTutorChat = {
    reportId: string | null;
    conversationId: string;
    ts: number;
};

type PendingTutorResponse = {
    conversationId: string;
    reportId: string | null;
    userMessage: string;
    startedAt: string;
};

type CachedTutorHistoryPayload = {
    ts: number;
    messages: ChatMessage[];
};

type CachedTutorHistorySnapshot = {
    ts: number;
    isFresh: boolean;
    messages: ChatMessage[];
};

type AgentToolCall = {
    callId: string;
    tool: string;
    label: string;
    startedAt: number;
    completedAt: number | null;
    ok: boolean | null;
    latencyMs: number | null;
};

type AgentArtifact = {
    artifactId: string;
    artifactType: string;
    title: string;
    summary: string | null;
    createdAt: number;
    isDraft: boolean;
    committed: boolean;
    resourceId?: string | null;
};

type ClarificationSlot = {
    id: string;
    label: string;
    type: "chip" | "text" | "number" | "date";
    options?: string[];
    placeholder?: string;
    required?: boolean;
};

type AgentClarification = {
    id: string;            // local — for keying / dismissing
    context: string;
    slots: ClarificationSlot[];
    answers: Record<string, string>;
    submitted: boolean;
};

type BackgroundTutorTaskSnapshot = {
    conversationId: string;
    reportId: string | null;
    history: ChatMessage[];
    status: string | null;
    previewPanel: PreviewTab;
    resolvedReportId: string | null;
    complete: boolean;
    errorMessage: string | null;
    upgradeNeeded: boolean;
    agentIteration: number | null;
    agentToolCalls: AgentToolCall[];
    agentArtifacts: AgentArtifact[];
    agentClarifications: AgentClarification[];
    thinkingWords: string[];
};

type BackgroundTutorTask = BackgroundTutorTaskSnapshot & {
    listeners: Set<(snapshot: BackgroundTutorTaskSnapshot) => void>;
    promise: Promise<void>;
};

/* ═══════════════ Helpers ═══════════════ */

const INITIAL_HISTORY_PREVIEW_LIMIT = 12;
const FULL_HISTORY_LIMIT = 40;
const CHAT_HISTORY_CACHE_TTL_MS = 1000 * 60 * 5;
const BOOTSTRAP_CACHE_TTL_MS = 1000 * 60 * 30;
const LAST_ACTIVE_TUTOR_CHAT_KEY = "tutor_last_active_chat:v1";
const PENDING_TUTOR_RESPONSE_KEY = "tutor_pending_response:v1";
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;
const backgroundTutorTasks = new Map<string, BackgroundTutorTask>();

function toLabel(v: string) {
    return v.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function classifyAssistantMessage(text: string): MessageKind {
    const n = text.trim().toLowerCase();
    if (n.startsWith("[artifact_card:")) return "artifact";
    if (n.startsWith("[question_card|")) return "question";
    if (n.startsWith("[feedback_card]")) return "feedback";
    if (n.startsWith("[progress_nudge]")) return "nudge";
    if (n.includes("you've now practiced") || n.includes("ready for one more")) return "nudge";
    return "text";
}

function stripDisplayPrefix(text: string) {
    return text
    .replace(/\[TOOL_CALL:[^\]]+\]\s*/gi, "")
        .replace(/^\[question_card\|[^\]]+\]\s*/i, "")
        .replace(/^\[feedback_card\]\s*/i, "")
        .replace(/^\[progress_nudge\]\s*/i, "")
        // Strip marker prefixes used for UI actions
        .replace(/^\[clarify:[^\]]+\]\s*/gi, "")
        .replace(/^\[revise_draft:[^\]]+\]\s*/gi, "")
        .replace(/^\[approve_draft:[^\]]+\]\s*/gi, "")
        // Strip sources block appended by LLM at end of message
        .replace(/\n{1,2}[-*]?\s*Sources?:[\s\S]*$/i, "")
        .trimEnd();
}

function parseQuestionCardMeta(text: string) {
    const match = text.match(/^\[question_card\|([^|\]]+)\|([^\]]+)\]/i);
    if (!match) return null;
    return { id: match[1], category: match[2] };
}

function parseArtifactCardId(text: string) {
    const match = text.match(/^\[artifact_card:([^\]]+)\]/i);
    return match?.[1] ?? null;
}

function upsertArtifactMessage(history: ChatMessage[], assistantId: string, artifactId: string) {
    const content = `[artifact_card:${artifactId}]`;
    if (history.some((message) => parseArtifactCardId(message.content) === artifactId)) {
        return history.map((message) =>
            parseArtifactCardId(message.content) === artifactId
                ? { ...message, content, kind: "artifact" as const }
                : message
        );
    }

    const artifactMessage: ChatMessage = {
        id: `artifact-${artifactId}`,
        role: "assistant",
        content,
        kind: "artifact",
    };
    const assistantIndex = history.findIndex((message) => message.id === assistantId);
    if (assistantIndex === -1) return [...history, artifactMessage];
    return [
        ...history.slice(0, assistantIndex + 1),
        artifactMessage,
        ...history.slice(assistantIndex + 1),
    ];
}

function mapToolCallPanel(toolName: string): PreviewTab {
    if (toolName === "action_plan") return "action-plan";
    if (toolName === "question_sheet") return "questions";
    if (toolName === "report") return "report";
    return null;
}

function actionPlanTimespanLabel(timespan: ActionPlanTimespan): string {
    if (timespan === "1_week") return "1 Week";
    if (timespan === "monthly") return "Monthly";
    return "2 Weeks";
}

function plannerCategoryLabel(category: string): string {
    const c = String(category || "").toLowerCase();
    if (c === "cs_fundamentals" || c === "cs fundamentals" || c === "os" || c === "cn" || c === "dbms" || c === "oops") return "CS Fundamentals";
    if (c === "coding" || c === "dsa") return "Coding";
    if (c === "system_design" || c === "system design") return "System Design";
    return toLabel(c);
}

function tutorChatCacheKey(reportId: string | null, conversationId: string | null) {
    if (!conversationId) return null;
    return reportId ? `tutor_chat_cache:${conversationId}:${reportId}` : `tutor_chat_cache:${conversationId}`;
}

function tutorChatCacheKeys(reportId: string | null, conversationId: string | null) {
    const scoped = reportId ? tutorChatCacheKey(reportId, conversationId) : null;
    const generic = tutorChatCacheKey(null, conversationId);
    return [scoped, generic].filter((key): key is string => Boolean(key));
}

function buildTutorOpeningMessage(_hasReportContext: boolean) {
    return "";
}

/* ═══════════════ Sub-components ═══════════════ */

function removeSyntheticOpeningMessages(messages: ChatMessage[]) {
    return messages.filter((message) => {
        if (message.role !== "assistant") return true;
        const text = stripDisplayPrefix(message.content).trim();
        return !(
            text.includes("latest tutor context ready") ||
            text.startsWith("What would you like to work on today?")
        );
    });
}

function normalizeCachedChatMessages(raw: string | null, limit = INITIAL_HISTORY_PREVIEW_LIMIT) {
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw) as ChatMessage[] | CachedTutorHistoryPayload;
        const messages = Array.isArray(parsed)
            ? parsed
            : Array.isArray(parsed?.messages)
                ? parsed.messages
                : null;
        if (!messages) return null;
        const sanitized = messages
            .filter((message): message is ChatMessage =>
                Boolean(message)
                && (message.role === "assistant" || message.role === "user")
                && typeof message.content === "string"
            )
            .slice(-limit);
        const ts = Array.isArray(parsed) ? 0 : Number(parsed?.ts) || 0;
        return {
            ts,
            isFresh: ts > 0 && Date.now() - ts < CHAT_HISTORY_CACHE_TTL_MS,
            messages: removeSyntheticOpeningMessages(sanitized),
        } satisfies CachedTutorHistorySnapshot;
    } catch {
        return null;
    }
}

function readCachedTutorHistory(reportId: string | null, conversationId: string | null, limit = INITIAL_HISTORY_PREVIEW_LIMIT) {
    if (typeof window === "undefined" || !conversationId) return null;
    for (const key of tutorChatCacheKeys(reportId, conversationId)) {
        const cached = normalizeCachedChatMessages(localStorage.getItem(key), limit);
        if (cached && cached.messages.length > 0) return cached;
    }
    return null;
}

function persistTutorHistorySnapshot(reportId: string | null, conversationId: string | null, history: ChatMessage[]) {
    if (typeof window === "undefined" || !conversationId || history.length === 0) return;
    try {
        const historyToCache = JSON.stringify({
            ts: Date.now(),
            messages: history.slice(-FULL_HISTORY_LIMIT),
        } satisfies CachedTutorHistoryPayload);
        for (const key of tutorChatCacheKeys(reportId, conversationId)) {
            localStorage.setItem(key, historyToCache);
        }
    } catch {}
}

function persistLastActiveTutorChat(reportId: string | null, conversationId: string | null) {
    if (typeof window === "undefined" || !conversationId) return;
    try {
        const payload: LastActiveTutorChat = {
            reportId,
            conversationId,
            ts: Date.now(),
        };
        localStorage.setItem(LAST_ACTIVE_TUTOR_CHAT_KEY, JSON.stringify(payload));
    } catch {}
}

function readPendingTutorResponse() {
    if (typeof window === "undefined") return null;
    try {
        const raw = localStorage.getItem(PENDING_TUTOR_RESPONSE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as PendingTutorResponse;
        if (!parsed?.conversationId || !parsed?.userMessage || !parsed?.startedAt) return null;
        return parsed;
    } catch {
        return null;
    }
}

function persistPendingTutorResponse(pending: PendingTutorResponse) {
    if (typeof window === "undefined") return;
    try {
        localStorage.setItem(PENDING_TUTOR_RESPONSE_KEY, JSON.stringify(pending));
    } catch {}
}

function clearPendingTutorResponse(conversationId?: string | null) {
    if (typeof window === "undefined") return;
    try {
        const existing = readPendingTutorResponse();
        if (conversationId && existing?.conversationId && existing.conversationId !== conversationId) return;
        localStorage.removeItem(PENDING_TUTOR_RESPONSE_KEY);
    } catch {}
}

function isSameChatMessage(a: ChatMessage | null | undefined, b: ChatMessage | null | undefined) {
    if (!a || !b) return false;
    return a.role === b.role && stripDisplayPrefix(a.content).trim() === stripDisplayPrefix(b.content).trim();
}

function reconcileHistoryWithCached(serverHistory: ChatMessage[], cachedHistory: ChatMessage[] | null) {
    const server = removeSyntheticOpeningMessages(serverHistory);
    if (!cachedHistory || cachedHistory.length === 0) return server;

    const cached = removeSyntheticOpeningMessages(cachedHistory);
    if (server.length === 0) return cached;

    const serverLast = server[server.length - 1] || null;
    const cachedLast = cached[cached.length - 1] || null;
    const cachedPrev = cached[cached.length - 2] || null;

    // If the cached chat already has the assistant reply after the latest user message,
    // don't replace it with an older server snapshot that still ends on that user message.
    if (cachedLast?.role === "assistant" && serverLast?.role === "user") {
        if (cachedPrev && isSameChatMessage(cachedPrev, serverLast)) {
            return [...server, cachedLast];
        }
        return cached.length >= server.length ? cached : [...server, cachedLast];
    }

    if (cachedLast?.role === "assistant" && serverLast?.role === "assistant") {
        const cachedText = stripDisplayPrefix(cachedLast.content).trim();
        const serverText = stripDisplayPrefix(serverLast.content).trim();
        if (cachedText.length > serverText.length && cached.length >= server.length) {
            return cached;
        }
    }

    if (cached.length > server.length) {
        return cached;
    }

    return server;
}

function hasAssistantReplyForPending(history: ChatMessage[], pending: PendingTutorResponse | null) {
    if (!pending || history.length === 0) return false;
    const normalizedPendingUser = stripDisplayPrefix(pending.userMessage).trim();
    let pendingUserIndex = -1;
    for (let index = history.length - 1; index >= 0; index -= 1) {
        const message = history[index];
        if (message.role !== "user") continue;
        if (stripDisplayPrefix(message.content).trim() === normalizedPendingUser) {
            pendingUserIndex = index;
            break;
        }
    }
    if (pendingUserIndex === -1) return false;
    return history.slice(pendingUserIndex + 1).some((message) =>
        message.role === "assistant" && stripDisplayPrefix(message.content).trim().length > 0
    );
}

function snapshotBackgroundTutorTask(task: BackgroundTutorTask): BackgroundTutorTaskSnapshot {
    return {
        conversationId: task.conversationId,
        reportId: task.reportId,
        history: [...task.history],
        status: task.status,
        previewPanel: task.previewPanel,
        resolvedReportId: task.resolvedReportId,
        complete: task.complete,
        errorMessage: task.errorMessage,
        upgradeNeeded: task.upgradeNeeded,
        agentIteration: task.agentIteration,
        agentToolCalls: [...task.agentToolCalls],
        agentArtifacts: [...task.agentArtifacts],
        agentClarifications: [...task.agentClarifications],
        thinkingWords: [...task.thinkingWords],
    };
}

const AGENT_TOOL_LABELS: Record<string, string> = {
    list_recent_reports: "Pulling up your recent interviews",
    get_report_summary: "Reading that interview report",
    get_user_report_trend: "Tracking how your scores have moved",
    get_score_percentile: "Sizing up that score against your average",
    get_question_activity_snapshot: "Peeking at your practice rhythm",
    get_weak_areas: "Mapping the spots that keep tripping you up",
    get_recent_mistakes: "Replaying your most recent slip-ups",
    get_user_profile: "Refreshing on what you're aiming for",
    update_user_profile: "Locking in those new goals",
    get_tutor_memories: "Bringing back what we've talked about before",
    save_memory: "Filing that away for next time",
    recall_relevant_memories: "Skimming our chat history for what's relevant",
    update_weak_area_status: "Marking that one as on the mend",
    identify_patterns: "Hunting for patterns across your prep",
    compare_to_benchmark: "Stacking your recent runs against your baseline",
    search_questions: "Sweeping the question bank",
    get_question: "Loading that problem",
    get_topic_guide: "Cracking open the topic primer",
    list_artifacts: "Checking what's already in your library",
    get_artifact: "Pulling that one back up",
    archive_artifact: "Tucking that into the archive",
    create_question_sheet: "Putting together your practice sheet",
    create_action_plan: "Sketching out your action plan",
    create_quiz: "Cooking up your quiz",
    get_user_context_pack: "Pulling your prep dashboard so I can ground this in real data",
    get_topic_mastery: "Gauging how solid you are on that topic",
    get_topic_progression: "Lining up the easy → hard ladder",
    get_company_blueprint: "Looking at how that company actually interviews",
    get_recent_question_history: "Checking what you've already tackled lately",
    get_calendar_context: "Glancing at your prep calendar",
    validate_artifact_quality: "Doing a quick sanity check before saving",
    propose_question_sheet: "Drafting a sheet you can react to",
    revise_question_sheet: "Reworking the sheet with your edits",
    propose_action_plan: "Sketching a plan for your review",
    revise_action_plan: "Reshaping the plan around your input",
    propose_quiz: "Putting a quiz together for you to try",
    revise_quiz: "Reworking the quiz",
    commit_artifact: "Saving your draft",
    request_clarification: "One quick thing first",
};

function labelForAgentTool(name: string): string {
    return AGENT_TOOL_LABELS[name] || `Running ${name.replace(/_/g, " ")}…`;
}

function emitBackgroundTutorTask(task: BackgroundTutorTask) {
    const snapshot = snapshotBackgroundTutorTask(task);
    task.listeners.forEach((listener) => listener(snapshot));
}

function getBackgroundTutorTask(conversationId: string | null) {
    if (!conversationId) return null;
    return backgroundTutorTasks.get(conversationId) || null;
}

function subscribeBackgroundTutorTask(
    conversationId: string,
    listener: (snapshot: BackgroundTutorTaskSnapshot) => void
) {
    const task = backgroundTutorTasks.get(conversationId);
    if (!task) return () => {};
    task.listeners.add(listener);
    listener(snapshotBackgroundTutorTask(task));
    return () => {
        task.listeners.delete(listener);
    };
}

function upsertAssistantMessage(history: ChatMessage[], assistantId: string, content: string) {
    const kind = classifyAssistantMessage(content);
    const existingIndex = history.findIndex((message) => message.id === assistantId);
    if (existingIndex === -1) {
        return [
            ...history,
            {
                id: assistantId,
                role: "assistant" as const,
                content,
                kind,
            },
        ];
    }
    return history.map((message) =>
        message.id === assistantId
            ? { ...message, content, kind }
            : message
    );
}

function buildArtifactReadyMessage(artifactType: string) {
    if (artifactType === "action_plan") {
        return "Your draft action plan is ready. Open it to review, and click Approve & Save when it looks right.";
    }
    if (artifactType === "question_sheet") {
        return "Your draft practice sheet is ready. Open it to review, and save it when you're happy with it.";
    }
    if (artifactType === "quiz") {
        return "Your draft quiz is ready. Open it to review, and save it when you're ready.";
    }
    return "Your draft is ready. Open it to review and save it when you're ready.";
}

function startBackgroundTutorTask({
    apiBase,
    token,
    conversationId,
    activeReportId,
    message,
    historyForApi,
    coveredQuestions,
    currentPanel,
    initialHistory,
    initialArtifacts,
    initialClarifications,
}: {
    apiBase: string;
    token: string;
    conversationId: string;
    activeReportId: string | null;
    message: string;
    historyForApi: Array<{ role: "assistant" | "user"; content: string }>;
    coveredQuestions: string[];
    currentPanel?: PreviewTab;
    initialHistory: ChatMessage[];
    initialArtifacts?: AgentArtifact[];
    initialClarifications?: AgentClarification[];
}) {
    const existingTask = backgroundTutorTasks.get(conversationId);
    if (existingTask && !existingTask.complete) {
        return existingTask;
    }

    const assistantId = crypto.randomUUID();
    const task: BackgroundTutorTask = {
        conversationId,
        reportId: activeReportId,
        history: [...initialHistory],
        status: null,
        previewPanel: null,
        resolvedReportId: activeReportId,
        complete: false,
        errorMessage: null,
        upgradeNeeded: false,
        agentIteration: null,
        agentToolCalls: [],
        agentArtifacts: existingTask ? [...existingTask.agentArtifacts] : [...(initialArtifacts || [])],
        agentClarifications: existingTask ? [...existingTask.agentClarifications] : [...(initialClarifications || [])],
        thinkingWords: [],
        listeners: new Set(),
        promise: Promise.resolve(),
    };

    const persistTaskHistory = () => {
        persistTutorHistorySnapshot(task.reportId, task.conversationId, task.history);
        persistLastActiveTutorChat(task.reportId, task.conversationId);
    };

    task.promise = (async () => {
        let fullAssistantText = "";
        let toolCallHandled = false;

        try {
            const response = await fetch(`${apiBase}/users/me/tutor/chat/v2/stream`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                    conversationId,
                    activeReportId: activeReportId || undefined,
                    message,
                    chatHistory: historyForApi,
                    coveredQuestions,
                    clientContext: {
                        currentPanel: currentPanel || undefined,
                    },
                }),
            });

            if (!response.ok || !response.body) {
                const errText = await response.text().catch(() => "");
                if (shouldShowUpgradeForError(errText)) {
                    task.upgradeNeeded = true;
                }
                throw new Error(
                    shouldShowUpgradeForError(errText)
                        ? "This tutor action needs an upgraded plan."
                        : `Stream failed (${response.status}): ${errText || response.statusText || "Unknown error"}`
                );
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buf = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buf += decoder.decode(value, { stream: true });
                const events = buf.split("\n\n");
                buf = events.pop() || "";

                for (const event of events) {
                    const line = event.split("\n").find((entry) => entry.startsWith("data: "));
                    if (!line) continue;

                    const payload = JSON.parse(line.slice(6));
                    if (payload.type === "meta") {
                        const resolvedReportId = payload?.resolvedContext?.reportId;
                        if (typeof resolvedReportId === "string" && resolvedReportId) {
                            task.reportId = resolvedReportId;
                            task.resolvedReportId = resolvedReportId;
                            persistTaskHistory();
                        }
                        const labels: ToolLabel[] = Array.isArray(payload.toolLabels) ? payload.toolLabels : [];
                        task.status = labels.length > 0 ? labels[0].label : task.status;
                        emitBackgroundTutorTask(task);
                        continue;
                    }

                    if (payload.type === "thinking_phase") {
                        const words = Array.isArray(payload.words) ? payload.words : [];
                        task.thinkingWords = words;
                        emitBackgroundTutorTask(task);
                        continue;
                    }

                    if (payload.type === "ui_directives") {
                        const directives = Array.isArray(payload.directives) ? (payload.directives as UiDirective[]) : [];
                        const first = directives.find((directive) =>
                            directive.panel === "action-plan" || directive.panel === "questions" || directive.panel === "report"
                        );
                        if (first?.panel) {
                            task.previewPanel = first.panel;
                            emitBackgroundTutorTask(task);
                        }
                        continue;
                    }

                    if (payload.type === "token") {
                        fullAssistantText += payload.text;
                        task.status = null;

                        if (!toolCallHandled) {
                            const toolCallMatch = fullAssistantText.match(/\[TOOL_CALL:(action_plan|question_sheet|report)\]/);
                            if (toolCallMatch) {
                                toolCallHandled = true;
                                task.previewPanel = mapToolCallPanel(toolCallMatch[1]);
                            }
                        }

                        const displayText = fullAssistantText
                            .replace(/\[TOOL_CALL:[^\]]+\]\n?/g, "")
                            .trimStart();

                        task.history = upsertAssistantMessage(task.history, assistantId, displayText);
                        persistTaskHistory();
                        emitBackgroundTutorTask(task);
                        continue;
                    }

                    if (payload.type === "agent_turn") {
                        task.agentIteration = typeof payload.iteration === "number" ? payload.iteration : null;
                        task.status = task.agentToolCalls.find((c) => c.completedAt === null)?.label
                            ?? (task.agentIteration ? (task.thinkingWords.length > 0 ? null : `Thinking…`) : task.status);
                        emitBackgroundTutorTask(task);
                        continue;
                    }

                    if (payload.type === "agent_thought") {
                        const thought = typeof payload.text === "string" ? payload.text.trim() : "";
                        if (thought) {
                            // Surface as the live status so the user sees the agent's actual
                            // narration ("Pulling your dashboard…"), not just static labels.
                            task.status = thought;
                            emitBackgroundTutorTask(task);
                        }
                        continue;
                    }

                    if (payload.type === "tool_call_started") {
                        const callId = String(payload.callId ?? crypto.randomUUID());
                        const tool = String(payload.tool ?? "");
                        const label =
                            (typeof payload.label === "string" && payload.label) ||
                            labelForAgentTool(tool);
                        task.agentToolCalls = [
                            ...task.agentToolCalls.filter((c) => c.callId !== callId),
                            {
                                callId,
                                tool,
                                label,
                                startedAt: Date.now(),
                                completedAt: null,
                                ok: null,
                                latencyMs: null,
                            },
                        ];
                        // Surface the most recent in-flight tool as the typing-strip status, overriding thinking words.
                        task.status = label;
                        emitBackgroundTutorTask(task);
                        continue;
                    }

                    if (payload.type === "tool_call_completed") {
                        const callId = String(payload.callId ?? "");
                        task.agentToolCalls = task.agentToolCalls.map((c) =>
                            c.callId === callId
                                ? {
                                      ...c,
                                      completedAt: Date.now(),
                                      ok: payload.ok === true,
                                      latencyMs:
                                          typeof payload.latencyMs === "number" ? payload.latencyMs : null,
                                  }
                                : c
                        );
                        // If others are still in-flight, surface the next one; else clear.
                        const stillRunning = task.agentToolCalls.find((c) => c.completedAt === null);
                        task.status = stillRunning ? stillRunning.label : null;
                        emitBackgroundTutorTask(task);
                        continue;
                    }

                    if (payload.type === "artifact_created") {
                        const artifactId = String(payload.artifactId ?? "");
                        if (!artifactId) continue;
                        const artifactType = String(payload.artifactType ?? "artifact");
                        const isDraft = payload.isDraft === true;
                        const existing = task.agentArtifacts.find((a) => a.artifactId === artifactId);
                        if (existing) {
                            // Refresh on revise — keep committed state, update title/summary/isDraft.
                            task.agentArtifacts = task.agentArtifacts.map((a) =>
                                a.artifactId === artifactId
                                    ? {
                                          ...a,
                                          title: String(payload.title ?? a.title),
                                          summary:
                                              typeof payload.summary === "string"
                                                  ? payload.summary
                                                  : a.summary,
                                          isDraft,
                                      }
                                    : a
                            );
                        } else {
                            task.agentArtifacts = [
                                ...task.agentArtifacts,
                                {
                                    artifactId,
                                    artifactType,
                                    title: String(payload.title ?? "Untitled"),
                                    summary:
                                        typeof payload.summary === "string" && payload.summary
                                            ? payload.summary
                                            : null,
                                    createdAt: Date.now(),
                                    isDraft,
                                    committed: false,
                                },
                            ];
                        }

                        if (isDraft && ["question_sheet", "action_plan", "quiz"].includes(artifactType)) {
                            task.agentClarifications = [];
                        }

                        if (!fullAssistantText.trim()) {
                            const readyMessage = buildArtifactReadyMessage(artifactType);
                            fullAssistantText = readyMessage;
                            task.history = upsertAssistantMessage(task.history, assistantId, readyMessage);
                        }
                        task.history = upsertArtifactMessage(task.history, assistantId, artifactId);
                        persistTaskHistory();
                        emitBackgroundTutorTask(task);
                        continue;
                    }

                    if (payload.type === "artifact_committed") {
                        const artifactId = String(payload.artifactId ?? "");
                        if (!artifactId) continue;
                        const resourceId = typeof payload.resourceId === "string" ? payload.resourceId : null;
                        task.agentArtifacts = task.agentArtifacts.map((a) =>
                            a.artifactId === artifactId
                                ? { ...a, isDraft: false, committed: true, resourceId, title: String(payload.title ?? a.title) }
                                : a
                        );
                        emitBackgroundTutorTask(task);
                        continue;
                    }

                    if (payload.type === "clarification_requested") {
                        const slots = Array.isArray(payload.slots) ? (payload.slots as ClarificationSlot[]) : [];
                        if (slots.length === 0) continue;
                        task.agentClarifications = [
                            ...task.agentClarifications,
                            {
                                id: crypto.randomUUID(),
                                context: String(payload.context ?? ""),
                                slots,
                                answers: {},
                                submitted: false,
                            },
                        ];
                        emitBackgroundTutorTask(task);
                        continue;
                    }

                    if (payload.type === "warning") {
                        // Lightweight surfacing — log only; future: toast.
                        console.warn("[tutor-agent]", payload.code, payload.message);
                        continue;
                    }

                    if (payload.type === "done") {
                        // Clean up any tool calls still flagged in-flight (defensive).
                        task.agentToolCalls = task.agentToolCalls.map((c) =>
                            c.completedAt === null
                                ? { ...c, completedAt: Date.now(), ok: false }
                                : c
                        );
                        task.status = null;
                        task.thinkingWords = [];
                        emitBackgroundTutorTask(task);
                        continue;
                    }

                    if (payload.type === "error") {
                        if (shouldShowUpgradeForError(payload)) {
                            task.upgradeNeeded = true;
                        }
                        throw new Error(payload.message || "Tutor stream error");
                    }
                }
            }
        } catch (err: any) {
            const upgradeNeeded = task.upgradeNeeded || shouldShowUpgradeForError(err?.message);
            const fallbackMessage = upgradeNeeded
                ? "Upgrade your plan to keep using AI Tutor."
                : "I hit an issue while generating the response. Please try again.";
            task.upgradeNeeded = upgradeNeeded;
            task.errorMessage = err?.message || "Failed to send message";
            task.history = upsertAssistantMessage(task.history, assistantId, fallbackMessage);
            persistTaskHistory();
            emitBackgroundTutorTask(task);
        } finally {
            clearPendingTutorResponse(conversationId);
            task.complete = true;
            task.status = null;
            task.thinkingWords = [];
            emitBackgroundTutorTask(task);
        }
    })();

    backgroundTutorTasks.set(conversationId, task);
    emitBackgroundTutorTask(task);
    return task;
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
    const [copied, setCopied] = useState(false);
    const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains("dark"));

    useEffect(() => {
        const observer = new MutationObserver(() =>
            setIsDark(document.documentElement.classList.contains("dark"))
        );
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
        return () => observer.disconnect();
    }, []);

    const handleCopy = () => {
        navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const bg = isDark ? "#161616" : "#eff6ff";
    const labelColor = isDark ? "#94a3b8" : "#64748b";

    return (
        <div className="code-block-wrapper relative my-2 rounded-lg overflow-hidden">
            {/* Top bar: language label + copy button */}
            <div className="flex items-center justify-between px-3 pt-2.5 pb-2" style={{ background: bg }}>
                <span className="text-[12px] font-semibold tracking-wide" style={{ color: labelColor, fontFamily: "'JetBrains Mono', monospace" }}>
                    {(lang === "text" ? "plaintext" : lang).charAt(0).toUpperCase() + (lang === "text" ? "plaintext" : lang).slice(1)}
                </span>
                <button
                    onClick={handleCopy}
                    className="flex items-center justify-center h-7 w-7 rounded transition-colors"
                    style={{ background: bg, color: labelColor }}
                    title="Copy code"
                >
                    <span className="material-symbols-outlined text-[16px]">
                        {copied ? "check" : "content_copy"}
                    </span>
                </button>
            </div>
            <SyntaxHighlighter
                language={lang}
                style={isDark ? vscDarkPlus : oneLight}
                customStyle={{
                    margin: 0,
                    borderRadius: "0 0 0.5rem 0.5rem",
                    background: bg,
                    padding: "12px",
                    paddingTop: "8px",
                    fontSize: "13px",
                    color: isDark ? "#e2e8f0" : "#0a0a0a",
                }}
                codeTagProps={{ style: { background: "transparent", fontFamily: "'JetBrains Mono', monospace", filter: "saturate(1.4)" } }}
            >
                {code}
            </SyntaxHighlighter>
        </div>
    );
}

function MarkdownContent({ text }: { text: string }) {
    return (
        <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeKatex]}
            components={{
                h1: ({ children }) => <h1 className="text-[34px] font-extrabold text-slate-900 dark:text-white mt-4 mb-2 first:mt-0 leading-tight">{children}</h1>,
                h2: ({ children }) => <h2 className="text-[28px] font-extrabold text-slate-900 dark:text-white mt-4 mb-2 first:mt-0 leading-tight">{children}</h2>,
                h3: ({ children }) => <h3 className="text-[22px] font-bold text-slate-800 dark:text-slate-100 mt-3 mb-1.5 first:mt-0 leading-snug">{children}</h3>,
                p: ({ children }) => <p className="mb-2 leading-relaxed last:mb-0 text-[16px] font-medium">{children}</p>,
                ul: ({ children }) => <ul className="mb-2 list-disc pl-5 space-y-1.5 text-[16px]">{children}</ul>,
                ol: ({ children }) => <ol className="mb-3 space-y-3 pl-1 text-[16px]">{children}</ol>,
                li: ({ children, ...props }) => {
                    const ordered = (props as any).ordered;
                    return ordered
                        ? <li className="text-[16px] font-medium leading-relaxed">{children}</li>
                        : <li className="text-[16px] font-medium leading-relaxed list-item">{children}</li>;
                },
                strong: ({ children }) => <strong className="font-bold text-blue-900 dark:text-blue-300">{children}</strong>,
                em: ({ children }) => <em className="italic text-slate-600 dark:text-slate-300">{children}</em>,
                blockquote: ({ children }) => (
                    <blockquote className="border-l-2 border-primary/40 pl-3 my-2 text-sm text-slate-500 dark:text-slate-400 italic">
                        {children}
                    </blockquote>
                ),
                hr: () => <hr className="my-3 border-slate-200 dark:border-lc-border" />,
                code: ({ children, className }) => {
                    const isBlock = className?.includes("language-");
                    if (isBlock) {
                        const lang = (className ?? "").replace("language-", "") || "text";
                        return <CodeBlock lang={lang} code={String(children).replace(/\n$/, "")} />;
                    }
                    return <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[12px] font-mono text-slate-700 dark:bg-lc-hover dark:text-slate-300">{children}</code>;
                },
            }}
        >
            {text}
        </ReactMarkdown>
    );
}


function TutorInputAvatar({ state = "idle" }: { state?: "idle" | "typing" }) {
    return (
        <div className={`tutor-input-avatar tutor-input-avatar-${state}`} aria-hidden="true">
            <img
                src={state === "typing" ? "/tutor_typing.svg" : "/tutor_idle.svg"}
                alt=""
                className="h-full w-full"
            />
        </div>
    );
}

function TypingIndicator({ status, words: initialWords }: { status?: string | null, words?: string[] }) {
    // Shuffle words once when the component receives them so they appear in a random order
    const [words] = useState(() => {
        if (!initialWords || initialWords.length === 0) return [];
        const shuffled = [...initialWords];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    });

    const [wordIndex, setWordIndex] = useState(0);

    useEffect(() => {
        if (!words || words.length === 0) return;
        const interval = setInterval(() => {
            setWordIndex(i => (i + 1) % words.length);
        }, 3000); // Increased from 2000ms to 3000ms (3 seconds)
        return () => clearInterval(interval);
    }, [words]);

    const displayStatus = status ? status : (words && words.length > 0 ? words[wordIndex] : null);

    return (
        <div className="flex items-start chat-msg-enter">
            <div className="rounded-2xl rounded-bl-md bg-slate-50 px-4 py-3 dark:bg-lc-hover">
                {displayStatus ? (
                    <p className="text-xs font-semibold text-slate-900 dark:text-white status-fade-enter flex items-center gap-2" key={displayStatus}>
                        {displayStatus}
                    </p>
                ) : (
                    <div className="flex items-center gap-1.5 h-5 text-slate-400 dark:text-slate-500">
                        <span className="typing-dot" />
                        <span className="typing-dot" />
                        <span className="typing-dot" />
                    </div>
                )}
            </div>
        </div>
    );
}

/* ── Agent tool-call strip ──────────────────────────────────────
 * Shows the running list of tools the agent has called this turn.
 * Completed calls collapse to a checkmark + name; in-flight ones
 * keep their full label and a spinner. Renders only when there is
 * at least one call to show. */
function AgentToolCallStrip({ calls }: { calls: AgentToolCall[] }) {
    if (calls.length === 0) return null;
    return (
        <div className="flex items-start chat-msg-enter">
            <div className="rounded-2xl rounded-bl-md bg-slate-50 px-3 py-2 dark:bg-lc-hover w-full max-w-[480px]">
                <ul className="flex flex-col gap-1">
                    {calls.map((c) => {
                        const inFlight = c.completedAt === null;
                        const failed = !inFlight && c.ok === false;
                        const ok = !inFlight && c.ok === true;
                        return (
                            <li
                                key={c.callId}
                                className="flex items-center gap-2 text-[11.5px]"
                            >
                                {inFlight ? (
                                    <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-slate-300 border-t-primary shrink-0" />
                                ) : ok ? (
                                    <span className="material-symbols-outlined text-emerald-500 text-[14px] shrink-0">
                                        check_circle
                                    </span>
                                ) : failed ? (
                                    <span className="material-symbols-outlined text-amber-500 text-[14px] shrink-0">
                                        error
                                    </span>
                                ) : null}
                                <span
                                    className={`font-medium ${
                                        inFlight
                                            ? "text-slate-900 dark:text-white"
                                            : "text-slate-500 dark:text-slate-400"
                                    }`}
                                >
                                    {c.label}
                                </span>
                                {!inFlight && c.latencyMs !== null && (
                                    <span className="ml-auto text-[10px] text-slate-400 tabular-nums">
                                        {formatLatency(c.latencyMs)}
                                    </span>
                                )}
                            </li>
                        );
                    })}
                </ul>
            </div>
        </div>
    );
}

function formatLatency(ms: number) {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}

/* ── Artifact card ──────────────────────────────────────────────
 * Compact, persistent card rendered when the agent has produced
 * a question sheet, action plan, quiz, or study note via a skill
 * tool. Surfaces the title + type so the user can act on it; full
 * detail is fetched on-demand by clicking through. */
const ARTIFACT_ICONS: Record<string, string> = {
    question_sheet: "list_alt",
    action_plan: "calendar_month",
    quiz: "quiz",
    study_note: "menu_book",
    artifact: "description",
};

const ARTIFACT_LABELS: Record<string, string> = {
    question_sheet: "Practice sheet",
    action_plan: "Action plan",
    quiz: "Quiz",
    study_note: "Study note",
    artifact: "Artifact",
};

function ArtifactCard({
    artifact,
    onOpen,
    onApprove,
    onRevise,
    onAttemptQuiz,
    quizAttempted,
    quizScore,
    isApproving,
}: {
    artifact: AgentArtifact;
    onOpen: (artifactId: string) => void | Promise<void>;
    onApprove: (artifact: AgentArtifact) => void;
    onRevise: (artifact: AgentArtifact, note: string) => void;
    onAttemptQuiz?: (artifact: AgentArtifact) => void;
    quizAttempted?: boolean;
    quizScore?: { correct: number; total: number; percentage: number };
    isApproving?: boolean;
}) {
    const icon = ARTIFACT_ICONS[artifact.artifactType] ?? ARTIFACT_ICONS.artifact;
    const label = ARTIFACT_LABELS[artifact.artifactType] ?? ARTIFACT_LABELS.artifact;
    const [reviseOpen, setReviseOpen] = useState(false);
    const [reviseText, setReviseText] = useState("");

    const submitRevise = () => {
        const note = reviseText.trim();
        if (!note) return;
        onRevise(artifact, note);
        setReviseText("");
        setReviseOpen(false);
    };

    const stateLabel = artifact.committed
        ? artifact.artifactType === "quiz"
            ? "Saved in this chat"
            : "Saved to your library"
        : artifact.isDraft
            ? "Draft"
            : "Just created";

    const isQuiz = artifact.artifactType === "quiz";

    return (
        <div className="flex flex-col items-start gap-2 chat-msg-enter">
            {/* For quizzes, make the card non-clickable */}
            {isQuiz ? (
                <div className="flex w-full max-w-[480px] items-start gap-3 rounded-3xl rounded-bl-md bg-white px-4 py-3.5 text-left shadow-[0_8px_24px_-12px_rgba(74,124,255,0.4)] dark:bg-lc-hover dark:shadow-black/30">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-primary text-white shadow-[0_5px_14px_-4px_rgba(74,124,255,0.65)]">
                        <span className="material-symbols-outlined text-[18px]">{icon}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="mb-0.5 flex items-center gap-2">
                            <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-primary">
                                {label}
                            </span>
                            <span className="text-[10px] text-slate-400">·</span>
                            <span
                                className={`text-[10px] ${
                                    artifact.committed
                                        ? "text-emerald-600 dark:text-emerald-400 font-bold"
                                        : artifact.isDraft
                                            ? "text-amber-600 dark:text-amber-400 font-bold"
                                            : "text-slate-500 dark:text-slate-400"
                                }`}
                            >
                                {stateLabel}
                            </span>
                        </div>
                        <p className="truncate text-sm font-extrabold text-slate-900 dark:text-white">
                            {artifact.title}
                        </p>
                        {artifact.summary && (
                            <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
                                {artifact.summary}
                            </p>
                        )}
                        {quizScore && (
                            <p className="mt-1 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                                Last score: {quizScore.percentage}% ({quizScore.correct}/{quizScore.total})
                            </p>
                        )}
                    </div>
                </div>
            ) : (
                <button
                    type="button"
                    onClick={() => onOpen(artifact.artifactId)}
                    className="group flex w-full max-w-[480px] items-start gap-3 rounded-3xl rounded-bl-md bg-white px-4 py-3.5 text-left shadow-[0_8px_24px_-12px_rgba(74,124,255,0.4)] transition-all hover:-translate-y-px hover:shadow-[0_12px_28px_-10px_rgba(74,124,255,0.55)] dark:bg-lc-hover dark:shadow-black/30 dark:hover:bg-lc-elevated"
                >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-primary text-white shadow-[0_5px_14px_-4px_rgba(74,124,255,0.65)]">
                        <span className="material-symbols-outlined text-[18px]">{icon}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="mb-0.5 flex items-center gap-2">
                            <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-primary">
                                {label}
                            </span>
                            <span className="text-[10px] text-slate-400">·</span>
                            <span
                                className={`text-[10px] ${
                                    artifact.committed
                                        ? "text-emerald-600 dark:text-emerald-400 font-bold"
                                        : artifact.isDraft
                                            ? "text-amber-600 dark:text-amber-400 font-bold"
                                            : "text-slate-500 dark:text-slate-400"
                                }`}
                            >
                                {stateLabel}
                            </span>
                        </div>
                        <p className="truncate text-sm font-extrabold text-slate-900 dark:text-white">
                            {artifact.title}
                        </p>
                        {artifact.summary && (
                            <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
                                {artifact.summary}
                            </p>
                        )}
                    </div>
                    <span className="material-symbols-outlined mt-0.5 shrink-0 text-[18px] text-slate-300 transition-colors group-hover:text-primary dark:text-slate-500 dark:group-hover:text-primary">
                        arrow_forward
                    </span>
                </button>
            )}

            {artifact.isDraft && !artifact.committed && (
                <div className="flex w-full max-w-[480px] flex-col gap-2 pl-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                        {isQuiz && (
                            <button
                                type="button"
                                onClick={() => onAttemptQuiz?.(artifact)}
                                className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-[11.5px] font-bold text-white shadow-[0_5px_14px_-4px_rgba(74,124,255,0.6)] transition-all hover:-translate-y-px hover:shadow-[0_8px_18px_-4px_rgba(74,124,255,0.7)]"
                            >
                                <span className="material-symbols-outlined text-[14px]">play_arrow</span>
                                {quizAttempted ? "Reattempt Quiz" : "Attempt Quiz"}
                            </button>
                        )}
                        {isQuiz ? (
                            <>
                                {quizAttempted && (
                                    <button
                                        type="button"
                                        onClick={() => onApprove(artifact)}
                                        disabled={isApproving}
                                        className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-[11.5px] font-bold text-white shadow-[0_5px_14px_-4px_rgba(74,124,255,0.6)] transition-all hover:-translate-y-px hover:shadow-[0_8px_18px_-4px_rgba(74,124,255,0.7)] disabled:cursor-wait disabled:opacity-60 disabled:hover:translate-y-0"
                                    >
                                        <span className={`material-symbols-outlined text-[14px] ${isApproving ? "animate-spin" : ""}`}>
                                            {isApproving ? "progress_activity" : "check_circle"}
                                        </span>
                                        {isApproving ? "Saving..." : "Approve & save"}
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={() => setReviseOpen((v) => !v)}
                                    className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3.5 py-1.5 text-[11.5px] font-bold text-slate-700 transition-colors hover:bg-slate-200 dark:bg-lc-hover dark:text-slate-300 dark:hover:bg-lc-elevated"
                                >
                                    <span className="material-symbols-outlined text-[14px]">edit</span>
                                    {reviseOpen ? "Hide revisions" : "Review / revise"}
                                </button>
                            </>
                        ) : (
                            <>
                                <button
                                    type="button"
                                    onClick={() => onApprove(artifact)}
                                    disabled={isApproving}
                                    className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-[11.5px] font-bold text-white shadow-[0_5px_14px_-4px_rgba(74,124,255,0.6)] transition-all hover:-translate-y-px hover:shadow-[0_8px_18px_-4px_rgba(74,124,255,0.7)] disabled:cursor-wait disabled:opacity-60 disabled:hover:translate-y-0"
                                >
                                    <span className={`material-symbols-outlined text-[14px] ${isApproving ? "animate-spin" : ""}`}>
                                        {isApproving ? "progress_activity" : "check_circle"}
                                    </span>
                                    {isApproving ? "Saving..." : "Approve & save"}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setReviseOpen((v) => !v)}
                                    className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3.5 py-1.5 text-[11.5px] font-bold text-slate-700 transition-colors hover:bg-slate-200 dark:bg-lc-hover dark:text-slate-300 dark:hover:bg-lc-elevated"
                                >
                                    <span className="material-symbols-outlined text-[14px]">edit</span>
                                    {reviseOpen ? "Hide revisions" : "Suggest changes"}
                                </button>
                            </>
                        )}
                    </div>

                    {reviseOpen && (
                        <div className="rounded-2xl bg-slate-50 p-2.5 dark:bg-lc-hover">
                            <textarea
                                value={reviseText}
                                onChange={(e) => setReviseText(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                                        e.preventDefault();
                                        submitRevise();
                                    }
                                }}
                                rows={2}
                                placeholder="e.g. swap question 3 for a harder one, or focus more on graphs"
                                className="w-full resize-none rounded-xl bg-white px-3 py-2 text-xs font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none dark:bg-lc-bg dark:text-white"
                            />
                            <div className="mt-1.5 flex items-center justify-end gap-1.5">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setReviseOpen(false);
                                        setReviseText("");
                                    }}
                                    className="rounded-full px-3 py-1 text-[11px] font-bold text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-lc-elevated"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={submitRevise}
                                    disabled={!reviseText.trim()}
                                    className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1 text-[11px] font-bold text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    Send revisions
                                    <span className="material-symbols-outlined text-[13px]">arrow_forward</span>
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {artifact.committed && (
                <div className="flex w-full max-w-[480px] flex-col gap-2 pl-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                        <button
                            type="button"
                            onClick={() => {
                                if (artifact.artifactType === "quiz") {
                                    onAttemptQuiz?.(artifact);
                                } else {
                                    void onOpen(artifact.artifactId);
                                }
                            }}
                            className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-3.5 py-1.5 text-[11.5px] font-bold text-white shadow-[0_5px_14px_-4px_rgba(16,185,129,0.6)] transition-all hover:-translate-y-px hover:shadow-[0_8px_18px_-4px_rgba(16,185,129,0.7)]"
                        >
                            <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                            {artifact.artifactType === "question_sheet" 
                                ? "Go to sheet" 
                                : artifact.artifactType === "action_plan" 
                                    ? "Go to action plan" 
                                    : artifact.artifactType === "quiz"
                                        ? "Attempt Quiz"
                                        : "View artifact"}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

/* ── Clarification card ──────────────────────────────────────────
 * Renders structured slots (chips, text, number, date) inline in the
 * chat. Submitting builds a clean message that the agent picks up and
 * uses to call propose_*. Once submitted, the card is read-only. */
function ClarificationCard({
    clarification,
    disabled,
    onSubmit,
}: {
    clarification: AgentClarification;
    disabled: boolean;
    onSubmit: (id: string, answers: Record<string, string>) => void;
}) {
    const [local, setLocal] = useState<Record<string, string>>(clarification.answers);
    const [customInputs, setCustomInputs] = useState<Record<string, string>>({});

    const update = (slotId: string, value: string) => {
        setLocal((prev) => ({ ...prev, [slotId]: value }));
    };

    const requiredMissing = clarification.slots.some(
        (s) => s.required && !(local[s.id] && String(local[s.id]).trim().length > 0)
    );

    const submit = () => {
        if (clarification.submitted || disabled || requiredMissing) return;
        onSubmit(clarification.id, local);
    };

    return (
        <div className="flex items-start chat-msg-enter">
            <div className="w-full max-w-[520px] rounded-3xl rounded-bl-md bg-white px-5 py-4 shadow-[0_8px_24px_-12px_rgba(74,124,255,0.4)] dark:bg-lc-hover dark:shadow-black/30">
                <div className="mb-3 flex items-start gap-2.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl bg-primary text-white shadow-[0_5px_14px_-4px_rgba(74,124,255,0.65)]">
                        <span className="material-symbols-outlined text-[16px]">help</span>
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-primary">
                            Quick question
                        </p>
                        <p className="mt-0.5 text-sm font-semibold leading-5 text-slate-900 dark:text-white">
                            {clarification.context || "Tell me a bit more…"}
                        </p>
                    </div>
                </div>

                <div className="space-y-3">
                    {clarification.slots.map((slot) => (
                        <div key={slot.id} className="flex flex-col gap-1.5">
                            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                {slot.label}
                                {slot.required && <span className="ml-1 text-primary">*</span>}
                            </span>
                            {slot.type === "chip" && Array.isArray(slot.options) ? (
                                <div className="flex flex-wrap gap-1.5">
                                    {slot.options.map((opt) => {
                                        const selected = local[slot.id] === opt;
                                        return (
                                            <button
                                                key={opt}
                                                type="button"
                                                onClick={() => {
                                                    update(slot.id, opt);
                                                    setCustomInputs((p) => ({ ...p, [slot.id]: "" }));
                                                }}
                                                disabled={clarification.submitted || disabled}
                                                className={`rounded-full px-3.5 py-1.5 text-[11.5px] font-bold transition-colors ${
                                                    selected
                                                        ? "bg-primary text-white shadow-[0_4px_12px_-4px_rgba(74,124,255,0.6)]"
                                                        : "bg-slate-100 text-slate-700 hover:bg-primary/10 hover:text-primary dark:bg-lc-bg dark:text-slate-300 dark:hover:bg-primary/15"
                                                } disabled:cursor-not-allowed disabled:opacity-60`}
                                            >
                                                {opt}
                                            </button>
                                        );
                                    })}
                                    {/* Something else? free-text option */}
                                    <div className="w-full mt-1">
                                        <input
                                            type="text"
                                            value={customInputs[slot.id] ?? ""}
                                            onChange={(e) => {
                                                const val = e.target.value;
                                                setCustomInputs((p) => ({ ...p, [slot.id]: val }));
                                                if (val.trim()) update(slot.id, val);
                                            }}
                                            onFocus={() => {
                                                if (!customInputs[slot.id]) update(slot.id, "");
                                            }}
                                            placeholder="Something else?"
                                            disabled={clarification.submitted || disabled}
                                            className="w-full rounded-xl bg-slate-100 px-3.5 py-2 text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:bg-primary/8 focus:outline-none disabled:opacity-60 dark:bg-lc-bg dark:text-white dark:placeholder:text-slate-500 dark:focus:bg-lc-elevated"
                                        />
                                    </div>
                                </div>
                            ) : (
                                <input
                                    type={slot.type === "number" ? "number" : slot.type === "date" ? "date" : "text"}
                                    value={local[slot.id] ?? ""}
                                    onChange={(e) => update(slot.id, e.target.value)}
                                    placeholder={slot.placeholder ?? ""}
                                    disabled={clarification.submitted || disabled}
                                    className="rounded-xl bg-slate-100 px-3.5 py-2 text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:bg-primary/8 focus:outline-none disabled:opacity-60 dark:bg-lc-bg dark:text-white dark:placeholder:text-slate-500 dark:focus:bg-lc-elevated"
                                />
                            )}
                        </div>
                    ))}
                </div>

                <div className="mt-4 flex items-center justify-end">
                    {clarification.submitted ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-[11px] font-bold text-emerald-700 dark:bg-emerald-500/12 dark:text-emerald-300">
                            <span className="material-symbols-outlined text-[14px]">check_circle</span>
                            Sent
                        </span>
                    ) : (
                        <button
                            type="button"
                            onClick={submit}
                            disabled={requiredMissing || disabled}
                            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-[11.5px] font-bold text-white shadow-[0_5px_14px_-4px_rgba(74,124,255,0.6)] transition-all hover:-translate-y-px hover:shadow-[0_8px_18px_-4px_rgba(74,124,255,0.75)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-[0_5px_14px_-4px_rgba(74,124,255,0.6)]"
                        >
                            Send
                            <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

function WelcomeTutorPrompt({
    prompts,
    onSelect,
    firstName,
}: {
    prompts: string[];
    onSelect: (prompt: string) => void;
    firstName: string;
}) {
    const [active, setActive] = useState(false);

    useEffect(() => {
        const id = window.setTimeout(() => setActive(true), 100);
        return () => window.clearTimeout(id);
    }, []);

    return (
        <div className={`tutor-welcome-stage ${active ? "active" : ""} relative flex min-h-full w-full flex-col justify-start overflow-visible pt-4 sm:pt-6 pb-8`}>
            <div className="w-full text-left relative z-20 sm:ml-40">
                <p className="text-[34px] sm:text-[42px] font-bold text-slate-900 dark:text-white font-nunito tracking-tight leading-tight">
                    Welcome <span className="bg-gradient-to-r from-blue-800 to-blue-500 bg-clip-text text-transparent dark:from-blue-300 dark:to-blue-500">{firstName}!</span>
                </p>
                <p className="mt-4 text-[20px] sm:text-[26px] font-semibold text-slate-900 dark:text-white max-w-xl leading-snug tracking-tight">
                    Let’s turn those weaknesses into your biggest strengths.
                </p>
            </div>

            <div className="tutor-welcome-chips pointer-events-auto relative z-20 mt-10 flex w-full flex-col gap-4 pr-0 sm:mt-10 sm:ml-[10.5rem] sm:max-w-[680px] sm:pr-[260px]">
                <div className="tutor-welcome-grid grid grid-cols-2 gap-3 sm:gap-4 mx-auto w-full">
                    {prompts.slice(0, 4).map((chip, idx) => (
                        <button
                            key={chip}
                            style={{ animationDelay: `${idx * 70}ms` }}
                            className="preset-pill min-h-[90px] sm:min-h-[100px] rounded-[16px] sm:rounded-[24px] px-4 py-4 sm:px-6 sm:py-5 text-left text-[13px] sm:text-[16px] font-semibold leading-snug sm:leading-relaxed shadow-[inset_0_0_0_1px_rgba(218,231,255,0.95),0_8px_20px_rgba(28,83,154,0.05)] transition-all duration-300 hover:-translate-y-1.5 hover:scale-[1.02] hover:shadow-[inset_0_0_0_1px_rgba(226,238,255,1),0_14px_28px_rgba(28,83,154,0.08)] bg-blue-50/80 text-slate-900 hover:bg-blue-100 hover:text-slate-900 dark:bg-blue-500/10 dark:text-white dark:shadow-[inset_0_0_0_1px_rgba(96,165,250,0.14),0_10px_24px_rgba(0,0,0,0.18)] dark:hover:bg-blue-500/20 dark:hover:text-white"
                            onClick={() => onSelect(chip)}
                        >
                            {chip}
                        </button>
                    ))}
                </div>
            </div>

        </div>
    );
}

function SkeletonBlock({ className = "" }: { className?: string }) {
    return <div className={`rounded-lg bg-slate-200/80 dark:bg-lc-hover shimmer ${className}`} />;
}

function TutorLoadingSkeleton({ status }: { status: string }) {
    return (
        <div className="flex-1 flex flex-col h-full overflow-y-auto">
            <div className="shrink-0 border-b border-slate-100 dark:border-lc-border bg-white/80 dark:bg-lc-surface/80 backdrop-blur-sm px-5 py-3">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <SkeletonBlock className="h-8 w-8 rounded-full" />
                        <div className="space-y-2">
                            <SkeletonBlock className="h-3 w-28" />
                            <SkeletonBlock className="h-2.5 w-36" />
                        </div>
                    </div>
                    <SkeletonBlock className="h-7 w-40 rounded-lg" />
                </div>
            </div>

            <div className="flex-1 overflow-hidden">
                <div className="max-w-[768px] mx-auto px-4 sm:px-6 py-6 space-y-4">
                    <div className="flex items-start gap-3">
                        <SkeletonBlock className="h-7 w-7 rounded-full mt-1" />
                        <div className="w-full max-w-[70%] rounded-2xl rounded-tl-md border border-slate-100 dark:border-lc-border bg-white dark:bg-lc-surface px-4 py-3 space-y-2.5">
                            <SkeletonBlock className="h-2.5 w-32" />
                            <SkeletonBlock className="h-2.5 w-full" />
                            <SkeletonBlock className="h-2.5 w-5/6" />
                        </div>
                    </div>

                    <div className="flex justify-end">
                        <div className="w-full max-w-[58%] rounded-2xl rounded-br-md bg-slate-100 dark:bg-lc-hover px-4 py-3 space-y-2.5">
                            <SkeletonBlock className="h-2.5 w-full" />
                            <SkeletonBlock className="h-2.5 w-3/4" />
                        </div>
                    </div>

                    <div className="flex items-start gap-3">
                        <SkeletonBlock className="h-7 w-7 rounded-full mt-1" />
                        <div className="w-full max-w-[72%] rounded-2xl rounded-tl-md border border-slate-100 dark:border-lc-border bg-white dark:bg-lc-surface px-4 py-3 space-y-2.5">
                            <SkeletonBlock className="h-2.5 w-24" />
                            <SkeletonBlock className="h-2.5 w-full" />
                            <SkeletonBlock className="h-2.5 w-11/12" />
                            <SkeletonBlock className="h-2.5 w-2/3" />
                        </div>
                    </div>
                </div>
            </div>

            <div className="shrink-0 border-t border-slate-100 dark:border-lc-border bg-white dark:bg-lc-surface px-4 pb-4 pt-3">
                <div className="max-w-[768px] mx-auto">
                    <div className="flex items-end gap-2 rounded-2xl border border-slate-200 dark:border-lc-border bg-white dark:bg-lc-hover px-3 py-2">
                        <SkeletonBlock className="h-8 w-8 rounded-lg shrink-0" />
                        <SkeletonBlock className="h-9 flex-1 rounded-xl" />
                        <SkeletonBlock className="h-8 w-8 rounded-lg shrink-0" />
                    </div>
                    <p className="mt-2 text-center text-[11px] text-slate-500 dark:text-slate-400">{status}</p>
                </div>
            </div>
        </div>
    );
}

function HistoryModal({
    groups,
    selectedConversationId,
    reportMetaById,
    renamingId,
    renameValue,
    setRenamingId,
    setRenameValue,
    handleRenameConversation,
    setDeleteConfirmId,
    onClose,
    onSelect,
}: {
    groups: { label: string; items: TutorConversation[] }[];
    selectedConversationId: string | null;
    reportMetaById: Map<string, ReportMeta>;
    renamingId: string | null;
    renameValue: string;
    setRenamingId: (id: string | null) => void;
    setRenameValue: (v: string) => void;
    handleRenameConversation: (id: string, title: string) => void;
    setDeleteConfirmId: (id: string) => void;
    onClose: () => void;
    onSelect: (conv: TutorConversation) => void;
}) {
    const [search, setSearch] = useState("");
    const [focusedIndex, setFocusedIndex] = useState(0);
    const searchRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    // Flatten all items across groups for keyboard nav
    const allItems = groups.flatMap((g) => g.items);

    // Filter by search
    const filteredGroups = search.trim()
        ? [{ label: "Results", items: allItems.filter((c) => c.title.toLowerCase().includes(search.toLowerCase())) }]
        : groups;
    const filteredFlat = filteredGroups.flatMap((g) => g.items);

    // Reset focus when search changes
    useEffect(() => { setFocusedIndex(0); }, [search]);

    // Focus search on mount
    useEffect(() => { searchRef.current?.focus(); }, []);

    // Keyboard navigation
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === "ArrowDown") {
                e.preventDefault();
                setFocusedIndex((i) => Math.min(i + 1, filteredFlat.length - 1));
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setFocusedIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
                e.preventDefault();
                const conv = filteredFlat[focusedIndex];
                if (conv) onSelect(conv);
            } else if (e.key === "Escape") {
                onClose();
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [filteredFlat, focusedIndex, onSelect, onClose]);

    // Scroll focused item into view
    useEffect(() => {
        const el = listRef.current?.querySelector(`[data-idx="${focusedIndex}"]`) as HTMLElement | null;
        el?.scrollIntoView({ block: "nearest" });
    }, [focusedIndex]);

    function relativeTime(dateStr: string) {
        const d = new Date(dateStr);
        const diffMs = Date.now() - d.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHrs = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHrs / 24);
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHrs < 24) return `${diffHrs} hrs ago`;
        if (diffDays < 7) return `${diffDays}d ago`;
        return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    }

    let globalIdx = 0;

    return (
        <div
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 px-4 dark:bg-black/70"
            onClick={onClose}
        >
            <div
                className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-lc-border dark:bg-lc-surface overflow-hidden status-fade-enter"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Search header */}
                <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 dark:border-lc-border">
                    <span className="material-symbols-outlined text-slate-400 text-[20px] shrink-0">search</span>
                    <input
                        ref={searchRef}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search sessions..."
                        className="flex-1 bg-transparent text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 outline-none"
                    />
                    <button
                        onClick={onClose}
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-lc-hover dark:hover:text-slate-200 transition-colors shrink-0"
                    >
                        <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                </div>

                {/* Session list */}
                <div ref={listRef} className="max-h-[60vh] overflow-y-auto px-3 py-3">
                    {filteredFlat.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-center">
                            <span className="material-symbols-outlined text-slate-300 dark:text-slate-600 text-[40px] mb-3">history</span>
                            <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">{search ? "No matching sessions" : "No sessions yet"}</p>
                        </div>
                    ) : filteredGroups.filter((g) => g.items.length > 0).map((group) => (
                        <div key={group.label} className="mb-4">
                            <p className="px-2 pb-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">{group.label}</p>
                            <div className="space-y-0.5">
                                {group.items.map((conv) => {
                                    const idx = globalIdx++;
                                    const linkedReport = conv.reportId ? reportMetaById.get(conv.reportId) : null;
                                    const isActive = conv.id === selectedConversationId;
                                    const isFocused = idx === focusedIndex;
                                    const isRenaming = renamingId === conv.id;

                                    return (
                                        <div key={conv.id} data-idx={idx}>
                                            {isRenaming ? (
                                                <div className="flex items-center gap-1.5 rounded-xl border border-primary/40 bg-primary/5 px-3 py-2.5">
                                                    <input
                                                        autoFocus
                                                        value={renameValue}
                                                        onChange={(e) => setRenameValue(e.target.value)}
                                                        onKeyDown={(e) => {
                                                            if (e.key === "Enter") { e.stopPropagation(); handleRenameConversation(conv.id, renameValue); }
                                                            if (e.key === "Escape") { e.stopPropagation(); setRenamingId(null); }
                                                        }}
                                                        className="flex-1 bg-transparent text-sm font-medium text-slate-800 dark:text-slate-100 outline-none"
                                                        maxLength={80}
                                                    />
                                                    <button onClick={() => handleRenameConversation(conv.id, renameValue)} className="text-primary hover:text-primary-dark shrink-0">
                                                        <span className="material-symbols-outlined text-[14px]">check</span>
                                                    </button>
                                                    <button onClick={() => setRenamingId(null)} className="text-slate-400 hover:text-slate-600 shrink-0">
                                                        <span className="material-symbols-outlined text-[14px]">close</span>
                                                    </button>
                                                </div>
                                            ) : (
                                                <div
                                                    className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 cursor-pointer transition-colors ${
                                                        isFocused
                                                            ? "bg-slate-100 dark:bg-lc-hover"
                                                            : isActive
                                                                ? "bg-primary/8 border border-primary/20"
                                                                : "hover:bg-slate-50 dark:hover:bg-lc-hover"
                                                    }`}
                                                    onMouseEnter={() => setFocusedIndex(idx)}
                                                    onClick={() => onSelect(conv)}
                                                >
                                                    {/* Main content */}
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center justify-between gap-2">
                                                            <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{conv.title}</p>
                                                            <span className="shrink-0 text-[11px] text-slate-400 dark:text-slate-500">{relativeTime(conv.lastMessageAt)}</span>
                                                        </div>
                                                        {linkedReport && (
                                                            <div className="mt-1 flex items-center gap-1.5">
                                                                <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                                                                    linkedReport.session.type === "system_design"
                                                                        ? "bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300"
                                                                        : linkedReport.session.type === "coding"
                                                                            ? "bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300"
                                                                            : linkedReport.session.type === "cs_fundamentals"
                                                                                ? "bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300"
                                                                                : linkedReport.session.type === "behavioural"
                                                                                    ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300"
                                                                                    : linkedReport.session.type === "sql"
                                                                                        ? "bg-cyan-100 text-cyan-600 dark:bg-cyan-500/15 dark:text-cyan-300"
                                                                                        : "bg-primary/10 text-primary"
                                                                }`}>
                                                                    {toLabel(linkedReport.session.type)}
                                                                </span>
                                                                <span className="text-[10px] text-slate-400">{Math.round(linkedReport.overallScore)}%</span>
                                                            </div>
                                                        )}
                                                    </div>

                                                    {/* Action buttons — always in flow, visible on hover/focus */}
                                                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setRenamingId(conv.id);
                                                                setRenameValue(conv.title);
                                                            }}
                                                            className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-lc-border dark:hover:text-slate-200 transition-colors"
                                                            title="Rename"
                                                        >
                                                            <span className="material-symbols-outlined text-[13px]">edit</span>
                                                        </button>
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setDeleteConfirmId(conv.id);
                                                            }}
                                                            className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10 transition-colors"
                                                            title="Delete"
                                                        >
                                                            <span className="material-symbols-outlined text-[13px]">delete</span>
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>

                {/* Footer */}
                <div className="border-t border-slate-100 dark:border-lc-border px-5 py-2.5 flex items-center justify-between">
                    <span className="text-[11px] text-slate-400 dark:text-slate-500">↑↓ to navigate</span>
                    <span className="text-[11px] text-slate-400 dark:text-slate-500">↵ to select</span>
                </div>
            </div>
        </div>
    );
}

function ActionPlanModal({
    open,
    onClose,
    actionPlan,
    actionPlanTimespan,
    acceptedActionPlan,
    acceptingActionPlan,
    onAcceptActionPlan,
    onCustomizeWithAI,
    onPrefillChat,
}: {
    open: boolean;
    onClose: () => void;
    actionPlan: ActionPlan | null;
    actionPlanTimespan: ActionPlanTimespan;
    acceptedActionPlan: AcceptedActionPlanMeta | null;
    acceptingActionPlan: boolean;
    onAcceptActionPlan: () => void;
    onCustomizeWithAI: () => void;
    onPrefillChat: (text: string) => void;
}) {
    const [expandedAreas, setExpandedAreas] = useState<Record<string, boolean>>({});
    if (!open || !actionPlan) return null;

    const plannedDays = (actionPlan.plannedDays || []).slice().sort((a, b) => a.day - b.day);

    return (
        <div className="fixed inset-0 z-[110] bg-slate-900/45 p-4 sm:p-6" onClick={onClose}>
            <div
                className="mx-auto flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-lc-border dark:bg-lc-surface"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5 dark:border-lc-border">
                    <h3 className="font-nunito text-lg font-bold text-slate-900 dark:text-white">Action Plan</h3>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={onCustomizeWithAI}
                            disabled={!!acceptedActionPlan}
                            className="rounded-lg border border-primary/30 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            Customize with AI
                        </button>
                        <button
                            onClick={onClose}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-lc-hover dark:hover:text-slate-200"
                        >
                            <span className="material-symbols-outlined text-[18px]">close</span>
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6">
                    <div>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500">Priority Focus</p>
                        <div className="rounded-xl bg-gradient-to-br from-primary/5 to-indigo-50 dark:from-primary/10 dark:to-indigo-500/5 border border-primary/10 dark:border-primary/20 p-4">
                            <p className="text-[15px] font-normal text-slate-900 dark:text-white leading-snug mb-3">{toLabel(actionPlan.priorityFocus)}</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed border-t border-primary/10 pt-3">{actionPlan.overallSummary}</p>
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                                <span className="rounded-full bg-white/70 px-2.5 py-1 text-[11px] font-semibold text-slate-500 dark:bg-lc-hover dark:text-slate-400">Duration: {actionPlanTimespanLabel(actionPlanTimespan)}</span>
                                <span className="rounded-full bg-white/70 px-2.5 py-1 text-[11px] font-semibold text-slate-500 dark:bg-lc-hover dark:text-slate-400">Total questions: {actionPlan.practiceQuestionCount || (plannedDays.reduce((sum, d) => sum + d.questionCount, 0))}</span>
                            </div>
                        </div>
                    </div>


                    {plannedDays.length > 0 && (
                        <div>
                            <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-500">Day-by-Day Planner</p>
                            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                {plannedDays.map((day) => (
                                    <div key={day.day} className="rounded-xl border border-slate-200 p-3.5 dark:border-lc-border">
                                        <div className="flex items-center">
                                            <p className="text-sm font-bold text-slate-800 dark:text-white">Day {day.day}</p>
                                        </div>
                                        <div className="mt-2 flex flex-wrap gap-1.5">
                                            {day.questionTags.map((tag) => (
                                                <span key={`${day.day}-${tag.category}`} className="rounded-md bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                                                    {plannerCategoryLabel(tag.category)}: {tag.count}
                                                </span>
                                            ))}
                                        </div>
                                        <div className="mt-2.5 space-y-1.5">
                                            {day.questions.map((q) => (
                                                <div key={q.id} className="flex items-center justify-between gap-2">
                                                    <p className="truncate text-[11px] text-slate-600 dark:text-slate-300">{(() => {
                                                        const t = q.title;
                                                        const byColon = t.split(':')[0].trim();
                                                        const byDot = byColon.split('.')[0].trim();
                                                        return byDot.length > 4 && byDot.length < t.length ? byDot : t.slice(0, 40);
                                                    })()}</p>
                                                    {q.solveUrl ? (
                                                        <a href={q.solveUrl} className="shrink-0 text-[11px] font-semibold text-primary hover:text-primary-dark">Solve</a>
                                                    ) : null}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {actionPlan.strengths.length > 0 && (
                        <div>
                            <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500">Strengths</p>
                            <div className="space-y-2.5">
                                {actionPlan.strengths.map((s, i) => {
                                    const key = `strength-${i}`;
                                    const expanded = !!expandedAreas[key];
                                    return (
                                        <div key={key} className="rounded-xl border border-slate-100 overflow-hidden dark:border-lc-border">
                                            <button
                                                className="flex w-full items-center justify-between p-3 text-left bg-primary/[0.03] hover:bg-primary/[0.06] dark:bg-primary/5 dark:hover:bg-primary/10 transition-colors"
                                                onClick={() => setExpandedAreas((p) => ({ ...p, [key]: !p[key] }))}
                                            >
                                                <span className="text-sm font-semibold text-slate-800 dark:text-white pr-3">{s}</span>
                                                <span className="material-symbols-outlined text-[18px] text-slate-400 shrink-0">{expanded ? "expand_less" : "expand_more"}</span>
                                            </button>
                                            {expanded && (
                                                <div className="space-y-2 px-3 pb-3 pt-2">
                                                    <button
                                                        className="text-xs font-semibold text-primary hover:text-primary-dark"
                                                        onClick={() => onPrefillChat(`Let's talk about this strength: "${s}" — how can I keep building on it?`)}
                                                    >
                                                        Discuss in chat →
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}


                    <div>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500">Areas to Improve</p>
                        <div className="space-y-2.5">
                            {actionPlan.weakAreas.map((area, idx) => {
                                const key = `${area.category}-${area.score}-${idx}`;
                                const expanded = !!expandedAreas[key];
                                return (
                                    <div key={key} className="rounded-xl border border-slate-100 overflow-hidden dark:border-lc-border">
                                        <button
                                            className="flex w-full items-center justify-between p-3 text-left bg-primary/[0.03] hover:bg-primary/[0.06] dark:bg-primary/5 dark:hover:bg-primary/10 transition-colors"
                                            onClick={() => setExpandedAreas((p) => ({ ...p, [key]: !p[key] }))}>
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm font-semibold text-slate-800 dark:text-white">{toLabel(area.category)}</span>
                                                <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-500 dark:bg-red-500/10">{area.score}/10</span>
                                            </div>
                                            <span className="material-symbols-outlined text-[18px] text-slate-400">{expanded ? "expand_less" : "expand_more"}</span>
                                        </button>
                                        {expanded && (
                                            <div className="space-y-2 px-3 pb-3">
                                                <p className="text-xs text-slate-500 dark:text-slate-400">{area.why}</p>
                                                {area.actionItems.slice(0, 4).map((item, idx) => (
                                                    <p key={idx} className="text-xs text-slate-700 dark:text-slate-300">• {item}</p>
                                                ))}
                                                <button
                                                    className="text-xs font-semibold text-primary hover:text-primary-dark"
                                                    onClick={() => onPrefillChat(`Help me improve my ${toLabel(area.category)} — what should I do today?`)}
                                                >
                                                    Discuss in chat →
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>

                <div className="shrink-0 border-t border-slate-100 bg-white p-4 dark:border-lc-border dark:bg-lc-surface">
                    {acceptedActionPlan ? (
                        <div className="space-y-1">
                            <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">✓ Action plan saved on {new Date(acceptedActionPlan.acceptedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</p>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">Duration: {actionPlanTimespanLabel(acceptedActionPlan.timespan)}</p>
                        </div>
                    ) : (
                        <button
                            onClick={onAcceptActionPlan}
                            disabled={acceptingActionPlan}
                            className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
                        >
                            {acceptingActionPlan ? "Saving..." : "Accept & Save Action Plan →"}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

/* ═══════════════ Preview Panel ═══════════════ */

function PreviewPanel({
    tab,
    onClose,
    report,
    actionPlan,
    questions,
    existingSheet,
    checkingSheet,
    acceptingSheet,
    acceptedActionPlan,
    acceptingActionPlan,
    refreshingQuestions,
    onAcceptSheet,
    onAcceptActionPlan,
    onRegenerateQuestions,
    onOpenSheet,
    onPrefillChat,
    sortedRubric,
    actionPlanTimespan,
}: {
    tab: PreviewTab;
    onClose: () => void;
    report: TutorReportSummary | null;
    actionPlan: ActionPlan | null;
    questions: TutorQuestion[];
    existingSheet: SheetMeta | null;
    checkingSheet: boolean;
    acceptingSheet: boolean;
    acceptedActionPlan: AcceptedActionPlanMeta | null;
    acceptingActionPlan: boolean;
    refreshingQuestions?: boolean;
    onAcceptSheet: () => void;
    onAcceptActionPlan: () => void;
    onRegenerateQuestions?: () => void;
    onOpenSheet: (id: string) => void;
    onPrefillChat: (text: string) => void;
    sortedRubric: RubricScore[];
    actionPlanTimespan: ActionPlanTimespan;
}) {
    const [expandedAreas, setExpandedAreas] = useState<Record<string, boolean>>({});

    if (!tab) return null;

    const toggleArea = (key: string) => setExpandedAreas((p) => ({ ...p, [key]: !p[key] }));

    return (
        <div className="w-[560px] shrink-0 border-l border-slate-200 dark:border-lc-border bg-white dark:bg-lc-surface flex flex-col preview-panel-enter h-full overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4">
                <h3 className="font-nunito text-[20px] font-bold text-slate-800 dark:text-white">
                    {tab === "action-plan" && "Action Plan"}
                    {tab === "questions" && "Question Sheet"}
                    {tab === "report" && "Report Summary"}
                </h3>
                <button
                    onClick={onClose}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-lc-hover dark:hover:text-slate-200 transition-colors"
                >
                    <span className="material-symbols-outlined text-[18px]">close</span>
                </button>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4 scrollbar-hide">
                {/* ── Action Plan ── */}
                {tab === "action-plan" && actionPlan && (
                    <>
                        {/* Overall summary */}
                        <div className="rounded-xl bg-gradient-to-br from-primary/5 to-indigo-50 dark:from-primary/10 dark:to-indigo-500/5 p-4">
                            {/* Header row: label left, duration right */}
                            <div className="flex items-center justify-between gap-3 flex-wrap">
                                <p className="text-[11px] font-bold uppercase tracking-widest text-slate-900 dark:text-white">Priority Focus</p>
                                <span className="rounded-full bg-white/70 px-2.5 py-1 text-[11px] font-semibold text-slate-500 dark:bg-lc-hover dark:text-slate-400">{actionPlanTimespanLabel(actionPlanTimespan)}</span>
                            </div>
                            {/* Bold title */}
                            <p className="mt-2 text-sm font-normal text-slate-900 dark:text-white leading-snug">{toLabel(actionPlan.priorityFocus)}</p>
                        </div>

                        {/* Strengths */}
                        {actionPlan.strengths.length > 0 && (
                            <div>
                                <p className="text-[11px] font-semibold uppercase tracking-widest text-emerald-600 dark:text-emerald-400 mb-2">Strengths</p>
                                <div className="space-y-1.5">
                                    {actionPlan.strengths.map((s, i) => (
                                        <div key={i} className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-300">
                                            <span className="text-emerald-500 mt-0.5">✓</span>
                                            <span>{s}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Weak areas */}
                        <div>
                            <p className="text-[11px] font-semibold uppercase tracking-widest text-red-500/70 mb-2">Areas to Improve</p>
                            <div className="space-y-2.5">
                                {actionPlan.weakAreas.map((area, idx) => {
                                    const key = `${area.category}-${area.score}-${idx}`;
                                    const expanded = !!expandedAreas[key];
                                    return (
                                        <div key={key} className="rounded-xl border border-slate-100 dark:border-lc-border overflow-hidden">
                                            <button
                                                className="flex w-full items-center justify-between p-3 text-left hover:bg-slate-50 dark:hover:bg-lc-hover transition-colors"
                                                onClick={() => toggleArea(key)}
                                            >
                                                <div className="flex items-center gap-2">
                                                    <span className="text-sm font-semibold text-slate-800 dark:text-white">{toLabel(area.category)}</span>
                                                    <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-500 dark:bg-red-500/10">{area.score}/10</span>
                                                </div>
                                                <span className="material-symbols-outlined text-slate-400 text-[18px]">{expanded ? "expand_less" : "expand_more"}</span>
                                            </button>
                                            {expanded && (
                                                <div className="px-3 pb-3 space-y-2">
                                                    <p className="text-xs text-slate-500 dark:text-slate-400">{area.why}</p>
                                                    <ul className="space-y-1">
                                                        {area.actionItems.slice(0, 4).map((item, idx) => (
                                                            <li key={idx} className="text-xs text-slate-600 dark:text-slate-300 flex items-start gap-1.5">
                                                                <span className="text-primary mt-0.5">•</span>
                                                                <span>{item}</span>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                    <button
                                                        className="mt-1 text-xs font-semibold text-primary hover:text-primary-dark transition-colors"
                                                        onClick={() => onPrefillChat(`Help me improve my ${toLabel(area.category)} — what specific steps should I take?`)}
                                                    >
                                                        Discuss in chat →
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </>
                )}

                {/* ── Question Sheet ── */}
                {tab === "questions" && (
                    <>
                        {/* Status / intro banner */}
                        {existingSheet ? (
                            <div className="rounded-xl border border-emerald-200 bg-emerald-50 dark:border-emerald-500/20 dark:bg-emerald-500/10 p-4">
                                <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                                    ✓ Sheet saved · {existingSheet.totalQuestions} questions
                                </p>
                                <div className="mt-2 h-1.5 rounded-full bg-emerald-100 dark:bg-emerald-500/20">
                                    <div
                                        className="h-1.5 rounded-full bg-emerald-500 transition-all"
                                        style={{ width: `${existingSheet.totalQuestions > 0 ? Math.round((existingSheet.completedQuestions / existingSheet.totalQuestions) * 100) : 0}%` }}
                                    />
                                </div>
                                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                    {existingSheet.completedQuestions}/{existingSheet.totalQuestions} completed
                                </p>
                            </div>
                        ) : (
                            <div className="rounded-xl bg-gradient-to-br from-primary/5 to-indigo-50 dark:from-primary/10 dark:to-indigo-500/5 p-4">
                                {/* Header row with title and refresh button */}
                                <div className="flex items-center justify-between gap-3 mb-3">
                                    <h4 className="text-base font-bold text-slate-900 dark:text-white">Practice Sheet Preview</h4>
                                    <button
                                        onClick={onRegenerateQuestions}
                                        disabled={refreshingQuestions}
                                        className="shrink-0 p-1.5 rounded-md hover:bg-black/5 dark:hover:bg-white/10 text-slate-500 transition-colors"
                                        title="Get different questions"
                                    >
                                        <span className={`material-symbols-outlined text-[18px] ${refreshingQuestions ? 'animate-spin' : ''}`}>change_circle</span>
                                    </button>
                                </div>
                                {/* Description text */}
                                <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                                    Review the {questions.length} question{questions.length !== 1 ? "s" : ""} below, then accept to save this sheet to My Sheets.
                                </p>
                            </div>
                        )}

                        {/* Full question list */}
                        {questions.length > 0 && (
                            <div>
                                <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-3">
                                    Questions ({questions.length})
                                </p>
                                <div className="space-y-3">
                                    {questions.map((q) => {
                                        const hintKey = `hint-${q.id}`;
                                        const hintOpen = !!expandedAreas[hintKey];
                                        return (
                                            <div key={q.id} className="rounded-xl border border-slate-100 dark:border-lc-border bg-white dark:bg-lc-surface overflow-hidden">
                                                <div className="p-3.5">
                                                    <div className="flex items-center gap-2 mb-2">
                                                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                                            q.difficulty === "hard"
                                                                ? "bg-red-50 text-red-500 dark:bg-red-500/10"
                                                                : q.difficulty === "medium"
                                                                    ? "bg-amber-50 text-amber-600 dark:bg-amber-500/10"
                                                                    : "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10"
                                                        }`}>{q.difficulty}</span>
                                                        <span className="rounded-md bg-slate-100 dark:bg-lc-hover px-2 py-0.5 text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                                                            {toLabel(q.category)}
                                                        </span>
                                                    </div>
                                                    <p className="text-[13px] font-medium text-slate-800 dark:text-slate-100 leading-relaxed">
                                                        {q.prompt.split(':')[0] || q.prompt.split('.')[0] || q.prompt}
                                                    </p>
                                                    <div className="mt-2.5 flex items-center gap-2">
                                                        <button
                                                            className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-primary dark:hover:text-primary transition-colors"
                                                            onClick={() => toggleArea(hintKey)}
                                                        >
                                                            <span className="material-symbols-outlined text-[13px]">info</span>
                                                            What we look for
                                                            <span className="material-symbols-outlined text-[13px]">{hintOpen ? "expand_less" : "expand_more"}</span>
                                                        </button>
                                                        <button
                                                            className="ml-auto rounded-lg bg-primary px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-primary-dark transition-colors"
                                                            onClick={() => onPrefillChat(`Let's practice this question: "${q.prompt}"`)}
                                                        >
                                                            Practice in chat
                                                        </button>
                                                    </div>
                                                    {hintOpen && (
                                                        <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed border-l-2 border-primary/30 pl-2.5">
                                                            {q.whatWeAreLookingFor}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </>
                )}

                {/* ── Report Summary ── */}
                {tab === "report" && report && (
                    <>
                        <div className="rounded-xl bg-gradient-to-br from-slate-50 to-slate-100 dark:from-lc-hover dark:to-lc-surface p-4 text-center">
                            <p className="text-[11px] uppercase tracking-widest text-slate-400 mb-1">Overall Score</p>
                            <p className="font-nunito text-4xl font-bold text-slate-900 dark:text-white">{report.overallScore}<span className="text-lg text-slate-400">/100</span></p>
                            <p className="mt-1 text-xs text-slate-500">
                                {toLabel(report.type)} · {report.role} · {new Date(report.generatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                            </p>
                        </div>

                        <div>
                            <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-3">Rubric Breakdown</p>
                            <div className="space-y-3">
                                {sortedRubric.map((item) => (
                                    <div key={item.category}>
                                        <div className="flex items-center justify-between text-xs mb-1">
                                            <span className="font-semibold text-slate-600 dark:text-slate-300">{toLabel(item.category)}</span>
                                            <span className="text-slate-500 dark:text-slate-400">{Math.round(item.score)}</span>
                                        </div>
                                        <div className="h-2 rounded-full bg-slate-100 dark:bg-[#2b2d31]">
                                            <div
                                                className={`h-2 rounded-full transition-all duration-700 ${item.score >= 70 ? "bg-emerald-500" : item.score >= 45 ? "bg-amber-500" : "bg-red-500"}`}
                                                style={{ width: `${Math.max(0, Math.min(100, item.score))}%` }}
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <button
                            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-primary hover:bg-primary/5 dark:border-lc-border dark:bg-lc-hover dark:hover:bg-lc-border transition-colors"
                            onClick={() => onPrefillChat("Explain my rubric scores in detail — what do they mean and how can I improve?")}
                        >
                            Discuss My Scores →
                        </button>
                    </>
                )}
            </div>

            {/* ── Questions Accept / Open footer (outside scroll) ── */}
            {tab === "questions" && !existingSheet && (
                <div className="shrink-0 border-t border-slate-100 dark:border-lc-border p-4 bg-white dark:bg-lc-surface">
                    <button
                        onClick={onAcceptSheet}
                        disabled={acceptingSheet || checkingSheet}
                        className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-50 transition-colors"
                    >
                        {acceptingSheet ? (
                            <span className="flex items-center justify-center gap-2">
                                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                                Saving…
                            </span>
                        ) : (
                            "Accept & Save to My Sheets →"
                        )}
                    </button>
                </div>
            )}
            {tab === "questions" && existingSheet && (
                <div className="shrink-0 border-t border-slate-100 dark:border-lc-border p-4 bg-white dark:bg-lc-surface">
                    <button
                        onClick={() => onOpenSheet(existingSheet.sheetId)}
                        className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-lc-border dark:bg-lc-hover dark:text-slate-200 dark:hover:bg-lc-border transition-colors"
                    >
                        Open in My Sheets →
                    </button>
                </div>
            )}
            {tab === "action-plan" && (
                <div className="shrink-0 border-t border-slate-100 dark:border-lc-border p-4 bg-white dark:bg-lc-surface">
                    {acceptedActionPlan ? (
                        <div className="space-y-2">
                            <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                                ✓ Action plan saved on {new Date(acceptedActionPlan.acceptedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                            </p>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                Duration: {actionPlanTimespanLabel(acceptedActionPlan.timespan)}
                            </p>
                        </div>
                    ) : (
                        <button
                            onClick={onAcceptActionPlan}
                            disabled={acceptingActionPlan}
                            className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-50 transition-colors"
                        >
                            {acceptingActionPlan ? (
                                <span className="flex items-center justify-center gap-2">
                                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                                    Saving…
                                </span>
                            ) : (
                                "Accept & Save Action Plan →"
                            )}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

/* ═══════════════ Main Page ═══════════════ */

export default function AITutorPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const queryClient = useQueryClient();
    const { session: authSession, loading: authLoading, user } = useAuth();
    const { snapshot: billingSnapshot } = useBilling();
    const token = authSession?.access_token;
    const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

    /* ── Core state ── */
    const [loading, setLoading] = useState(true);
    const [chatBootstrapping, setChatBootstrapping] = useState(true);
    const [bootstrapStatus, setBootstrapStatus] = useState("Preparing your tutor session...");
    // Scoped to a conversation ID so the TypingIndicator only shows in the right chat
    const [sendingConversationId, setSendingConversationId] = useState<string | null>(null);
    const isSendingRef = useRef(false); // ref mirror — readable in async callbacks
    const [error, setError] = useState<string | null>(null);
    const [upgradeOpen, setUpgradeOpen] = useState(false);
    const [upgradeCopy, setUpgradeCopy] = useState<string | undefined>();

    /* ── Reports ── */
    const [availableReports, setAvailableReports] = useState<ReportMeta[]>([]);
    const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
    const [conversations, setConversations] = useState<TutorConversation[]>([]);
    const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
    const [openingMessage, setOpeningMessage] = useState("");
    const [creatingConversation, setCreatingConversation] = useState(false);

    /* ── Data ── */
    const [report, setReport] = useState<TutorReportSummary | null>(null);
    const [actionPlan, setActionPlan] = useState<ActionPlan | null>(null);
    const [existingSheet, setExistingSheet] = useState<SheetMeta | null>(null);
    const [acceptedActionPlan, setAcceptedActionPlan] = useState<AcceptedActionPlanMeta | null>(null);
    const [checkingSheet, setCheckingSheet] = useState(false);
    const [generatingSheet, setGeneratingSheet] = useState(false);
    const [generatingActionPlan, setGeneratingActionPlan] = useState(false);
    const [acceptingActionPlan, setAcceptingActionPlan] = useState(false);
    const [refreshingQuestions, setRefreshingQuestions] = useState(false);
    const [actionPlanPickerOpen, setActionPlanPickerOpen] = useState(false);
    const [actionPlanTimespan, setActionPlanTimespan] = useState<ActionPlanTimespan>("2_weeks");
    const [customizePlanOpen, setCustomizePlanOpen] = useState(false);
    const [customizePlanInput, setCustomizePlanInput] = useState("");
    const [customizeTimespan, setCustomizeTimespan] = useState<ActionPlanTimespan>("2_weeks");
    const [questions, setQuestions] = useState<TutorQuestion[]>([]);
    const [coveredQuestions, setCoveredQuestions] = useState<string[]>([]);

    /* ── Chat ── */
    const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
    const [historyLoading, setHistoryLoading] = useState(true);
    const [input, setInput] = useState("");
    const listRef = useRef<HTMLDivElement | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const quickMenuRef = useRef<HTMLDivElement | null>(null);

    /* ── Streaming status ── */
    const [streamingStatus, setStreamingStatus] = useState<string | null>(null);
    const [agentToolCalls, setAgentToolCalls] = useState<AgentToolCall[]>([]);
    const [thinkingWords, setThinkingWords] = useState<string[]>([]);
    const [agentArtifacts, setAgentArtifacts] = useState<AgentArtifact[]>([]);
    const [agentClarifications, setAgentClarifications] = useState<AgentClarification[]>([]);
    const [openArtifactId, setOpenArtifactId] = useState<string | null>(null);
    const [approvingArtifactIds, setApprovingArtifactIds] = useState<Set<string>>(new Set());
    
    // Ref to track artifact card elements for auto-scrolling
    const artifactCardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const lastArtifactCountRef = useRef(0);
    
    // Auto-scroll to newly created artifact cards
    useEffect(() => {
        if (agentArtifacts.length > lastArtifactCountRef.current) {
            const latestArtifact = agentArtifacts[agentArtifacts.length - 1];
            if (latestArtifact && latestArtifact.isDraft) {
                // Wait a bit for the DOM to update
                setTimeout(() => {
                    const element = artifactCardRefs.current.get(latestArtifact.artifactId);
                    const list = listRef.current;
                    if (element && list) {
                        const elementRect = element.getBoundingClientRect();
                        const listRect = list.getBoundingClientRect();
                        const top =
                            list.scrollTop +
                            elementRect.top -
                            listRect.top -
                            Math.max((list.clientHeight - elementRect.height) / 2, 0);

                        list.scrollTo({
                            top: Math.max(top, 0),
                            behavior: "smooth",
                        });
                    }
                }, 100);
            }
        }
        lastArtifactCountRef.current = agentArtifacts.length;
    }, [agentArtifacts.length]);
    const [openActionPlanPreviewId, setOpenActionPlanPreviewId] = useState<string | null>(null);
    const [profileModalOpen, setProfileModalOpen] = useState(false);
    const [profileBootstrapped, setProfileBootstrapped] = useState(false);
    const [currentProfile, setCurrentProfile] = useState<Record<string, string> | null>(null);
    const [profileExists, setProfileExists] = useState<boolean | null>(null);

    /* ── Quiz modal state ── */
    const [activeQuizId, setActiveQuizId] = useState<string | null>(null);
    const [quizAnswers, setQuizAnswers] = useState<Record<string, string | number>>({});
    const [showQuizResults, setShowQuizResults] = useState(false);
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const [attemptedQuizzes, setAttemptedQuizzes] = useState<Set<string>>(new Set());
    const [quizScores, setQuizScores] = useState<Record<string, { correct: number; total: number; percentage: number }>>({});

    /* ── Rename state ── */
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState("");

    /* ── Delete confirmation state ── */
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

    /* ── Locally-deleted conversation IDs (prevents server refetch from restoring them) ── */
    const deletedConversationIdsRef = useRef<Set<string>>(new Set());
    /* ── Track which conversations have had their title generated ── */
    const titledConversationIdsRef = useRef<Set<string>>(new Set());
    /* ── Track the currently selected conversation for stream guards ── */
    const selectedConversationIdRef = useRef<string | null>(null);
    useEffect(() => { selectedConversationIdRef.current = selectedConversationId; }, [selectedConversationId]);
    const chatHistoryRef = useRef<ChatMessage[]>([]);
    useEffect(() => { chatHistoryRef.current = chatHistory; }, [chatHistory]);
    const resumePollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const backgroundTaskUnsubscribeRef = useRef<(() => void) | null>(null);
    /* ── Track whether the user explicitly selected a conversation (vs bootstrap auto-select) ── */
    const userSelectedConversationRef = useRef<string | null>(null);
    const historyRequestSeqRef = useRef(0);
    /* ── Mirror actionPlan in a ref so async stream handlers can read it without stale closure ── */
    const actionPlanRef = useRef<ActionPlan | null>(null);
    useEffect(() => { actionPlanRef.current = actionPlan; }, [actionPlan]);
    const acceptedActionPlanRef = useRef<AcceptedActionPlanMeta | null>(null);
    useEffect(() => { acceptedActionPlanRef.current = acceptedActionPlan; }, [acceptedActionPlan]);

    /* ── Preview panel ── */
    const [previewTab, setPreviewTab] = useState<PreviewTab>(null);
    const [quickMenuOpen, setQuickMenuOpen] = useState(false);
    const [historyModalOpen, setHistoryModalOpen] = useState(false);
    const deepLinkAppliedRef = useRef(false);
    // True on the very first mount of a new tab session (sessionStorage cleared on tab close).
    // When true, bootstrap skips auto-selecting/loading the last conversation so the
    // welcome screen shows immediately instead.
    const isFreshTabSessionRef = useRef(false);

    const deepLinkReportId = useMemo(() => {
        const v = (searchParams.get("reportId") || "").trim();
        return v || null;
    }, [searchParams]);

    const deepLinkPlanId = useMemo(() => {
        const v = (searchParams.get("planId") || "").trim();
        return v || null;
    }, [searchParams]);

    const deepLinkPanel = useMemo(() => {
        const v = (searchParams.get("panel") || "").trim().toLowerCase();
        return v === "action-plan" ? "action-plan" : null;
    }, [searchParams]);

    useIsomorphicLayoutEffect(() => {
        if (typeof window === "undefined") return;
        if (deepLinkReportId || deepLinkPlanId || deepLinkPanel) return;

        // Restore last chat only within the same tab session.
        // sessionStorage is wiped when the tab is closed, so a fresh tab or
        // new login after sign-out always starts a new chat.
        const TAB_SESSION_KEY = "tutor_tab_session_active";
        const isActiveTabSession = sessionStorage.getItem(TAB_SESSION_KEY) === "1";
        sessionStorage.setItem(TAB_SESSION_KEY, "1");
        if (!isActiveTabSession) {
            isFreshTabSessionRef.current = true;
            return;
        }

        try {
            const raw = localStorage.getItem(LAST_ACTIVE_TUTOR_CHAT_KEY);
            if (!raw) return;

            const cached = JSON.parse(raw) as LastActiveTutorChat;
            const conversationId = typeof cached?.conversationId === "string" ? cached.conversationId.trim() : "";
            const reportId = typeof cached?.reportId === "string" && cached.reportId.trim()
                ? cached.reportId.trim()
                : null;

            if (!conversationId) return;

            selectedConversationIdRef.current = conversationId;
            userSelectedConversationRef.current = conversationId;
            setSelectedConversationId((prev) => prev || conversationId);
            if (reportId) {
                setSelectedReportId((prev) => prev || reportId);
                const convCacheKey = `tutor_conversations:${reportId}`;
                const cachedConversations = localStorage.getItem(convCacheKey);
                if (cachedConversations) {
                    try {
                        const parsed = JSON.parse(cachedConversations) as TutorConversation[];
                        if (Array.isArray(parsed) && parsed.length > 0) {
                            setConversations((prev) => prev.length > 0 ? prev : parsed);
                        }
                    } catch {}
                }
            }

            const cachedHistory = readCachedTutorHistory(reportId, conversationId, INITIAL_HISTORY_PREVIEW_LIMIT);
            if (cachedHistory && cachedHistory.messages.length > 0) {
                setChatHistory(cachedHistory.messages);
                setChatBootstrapping(false);
                setHistoryLoading(true);
            }
        } catch {}
    }, [deepLinkPanel, deepLinkPlanId, deepLinkReportId]);

    /* ── Computed ── */
    const sortedRubric = useMemo(() => {
        if (!report) return [] as RubricScore[];
        return [...report.rubricScores].sort((a, b) => a.score - b.score);
    }, [report]);

    const weakestCategories = useMemo(() => sortedRubric.slice(0, 2).map((x) => x.category), [sortedRubric]);

    const selectedReportMeta = useMemo(() => availableReports.find((r) => r.id === selectedReportId) || null, [availableReports, selectedReportId]);
    const selectedConversation = useMemo(
        () => conversations.find((conversation) => conversation.id === selectedConversationId) || null,
        [conversations, selectedConversationId]
    );
    const reportMetaById = useMemo(
        () => new Map(availableReports.map((item) => [item.id, item])),
        [availableReports]
    );

    const selectedReportLabel = useMemo(() => {
        if (!selectedReportMeta) return "Select report";
        const score = Math.round(Number(selectedReportMeta.overallScore) || 0);
        const date = new Date(selectedReportMeta.generatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
        return `${toLabel(selectedReportMeta.session.type)} · ${date} · ${score}%`;
    }, [selectedReportMeta]);

    /* ── Preset prompts (contextual) ── */
    const tutorFirstName = useMemo(() => {
        const metadata = authSession?.user?.user_metadata || {};
        const displayName = metadata.full_name || metadata.name || user?.fullName || "there";
        return String(displayName).trim().split(/\s+/)[0] || "there";
    }, [authSession?.user?.user_metadata, user?.fullName]);

    const welcomeSessionLabel = useMemo(() => {
        const match = selectedConversation?.title?.match(/session\s+(\d+)/i);
        if (match?.[1]) return `session ${match[1]}`;
        return conversations.length > 0 ? `session ${conversations.length}` : "your next session";
    }, [conversations.length, selectedConversation?.title]);

    const welcomeStatsLabel = useMemo(() => {
        const sessionCount = conversations.length || 1;
        const topicCount = weakestCategories.length || sortedRubric.length || 3;
        return `${sessionCount} sessions completed · ${topicCount} topics in progress · Next review: tomorrow`;
    }, [conversations.length, sortedRubric.length, weakestCategories.length]);

    const welcomeHeadline = useMemo(() => {
        const score = Math.round(Number(selectedReportMeta?.overallScore ?? report?.overallScore) || 0);
        const sessionType = selectedReportMeta?.session.type || report?.type || null;
        const role = selectedReportMeta?.session.role || report?.role || "";
        const typeLabel = sessionType ? toLabel(sessionType) : null;
        const roleLabel = role.trim();
        const primaryFocus = weakestCategories[0] ? toLabel(weakestCategories[0]) : null;

        if (typeLabel && score > 0 && primaryFocus) {
            return `Your latest ${typeLabel}${roleLabel ? ` interview for ${roleLabel}` : " interview"} scored ${score}%. ${primaryFocus} is your biggest opportunity right now.`;
        }

        if (typeLabel && score > 0) {
            return `Your latest ${typeLabel}${roleLabel ? ` interview for ${roleLabel}` : " interview"} scored ${score}%.`;
        }

        if (conversations.length > 0) {
            return `You have completed ${conversations.length} tutor session${conversations.length === 1 ? "" : "s"} so far.`;
        }

        return "Your interview data is ready. Let's turn it into your next edge.";
    }, [conversations.length, report?.overallScore, report?.role, report?.type, selectedReportMeta?.overallScore, selectedReportMeta?.session.role, selectedReportMeta?.session.type, weakestCategories]);

    const welcomeInsightLabel = useMemo(() => {
        const parts: string[] = [];
        const sessionCount = conversations.length;
        const score = Math.round(Number(selectedReportMeta?.overallScore ?? report?.overallScore) || 0);
        const focusAreas = weakestCategories.slice(0, 2).map((category) => toLabel(category));
        const latestDate = selectedReportMeta?.generatedAt || report?.generatedAt || null;

        if (sessionCount > 0) {
            parts.push(`${sessionCount} session${sessionCount === 1 ? "" : "s"} completed`);
        }
        if (score > 0) {
            parts.push(`Latest score: ${score}%`);
        }
        if (focusAreas.length > 0) {
            parts.push(`Focus next: ${focusAreas.join(" and ")}`);
        }
        if (latestDate) {
            parts.push(`Last report: ${new Date(latestDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`);
        }

        return parts.join(" | ") || "Pick a prompt to explore your latest interview data.";
    }, [conversations.length, report?.generatedAt, report?.overallScore, selectedReportMeta?.generatedAt, selectedReportMeta?.overallScore, weakestCategories]);

    const presetPrompts = useMemo(() => {
        const type = report?.type ? toLabel(report.type) : null;
        const base = [
            type ? `How did I do in my ${type} interview?` : "How did I do in my last interview?",
            "What should I focus on first?",
            "Build me a study plan",
            "Create me a practice sheet",
        ];
        if (weakestCategories.length > 0) {
            base.push(`Drill me on ${toLabel(weakestCategories[0])}`);
        }
        return base.slice(0, 5);
    }, [weakestCategories, report?.type]);

    const hasFirstUserMessage = useMemo(
        () => chatHistory.some((message) => message.role === "user"),
        [chatHistory]
    );

    const avatarState: AvatarState = sendingConversationId === selectedConversationId && sendingConversationId !== null
        ? "ai-typing"
        : hasFirstUserMessage
            ? "idle"
            : "welcome";

    const shouldShowWelcomeForCurrentConversation = chatHistory.length === 0
        && (!selectedConversationId || !selectedConversation || selectedConversation.messageCount === 0);

    const showWelcomePrompts = avatarState === "welcome"
        && shouldShowWelcomeForCurrentConversation
        && !historyLoading
        && sendingConversationId === null;

    const hydrateArtifactsForHistory = useCallback(async (history: ChatMessage[]) => {
        if (!token) return;
        const artifactIds = Array.from(new Set(
            history
                .map((message) => parseArtifactCardId(message.content))
                .filter((id): id is string => Boolean(id))
        ));
        if (artifactIds.length === 0) return;

        const loaded = await Promise.all(artifactIds.map(async (artifactId): Promise<AgentArtifact | null> => {
            try {
                const detail = await api.get<{
                    artifact?: {
                        id: string;
                        type: string;
                        title: string;
                        content?: { summary?: string | null } | null;
                        meta?: { isDraft?: boolean; resourceId?: string | null } | null;
                        status?: string;
                        createdAt?: string;
                    };
                }>(`/users/me/tutor/artifacts/${artifactId}`, token);
                const artifact = detail.artifact;
                if (!artifact?.id) return null;
                const isDraft = artifact.meta?.isDraft === true;
                return {
                    artifactId: artifact.id,
                    artifactType: artifact.type || "artifact",
                    title: artifact.title || "Untitled",
                    summary: typeof artifact.content?.summary === "string" ? artifact.content.summary : null,
                    createdAt: artifact.createdAt ? new Date(artifact.createdAt).getTime() : Date.now(),
                    isDraft,
                    committed: !isDraft,
                    resourceId: artifact.meta?.resourceId ?? null,
                };
            } catch {
                return null;
            }
        }));

        const hydrated = loaded.filter((artifact): artifact is AgentArtifact => Boolean(artifact));
        if (hydrated.length === 0) return;
        setAgentArtifacts((prev) => {
            const existing = new Set(prev.map((artifact) => artifact.artifactId));
            return [
                ...prev,
                ...hydrated.filter((artifact) => !existing.has(artifact.artifactId)),
            ];
        });
    }, [token]);

    const loadConversationHistory = useCallback(async (conversationId: string | null, fallbackMessage?: string) => {
        if (!token) return;

        // Switching conversations — drop the previous conversation's agent
        // tool-call strip / artifacts / clarifications so we don't show stale
        // info while the new conversation's task subscription warms up.
        setAgentToolCalls([]);
        setAgentArtifacts([]);
        setAgentClarifications([]);

        const requestSeq = ++historyRequestSeqRef.current;
        const applyHistory = (nextHistory: ChatMessage[]) => {
            if (requestSeq !== historyRequestSeqRef.current) return;
            if (conversationId && selectedConversationIdRef.current && selectedConversationIdRef.current !== conversationId) return;
            const cleanedHistory = removeSyntheticOpeningMessages(nextHistory);
            setChatHistory(cleanedHistory);
            void hydrateArtifactsForHistory(cleanedHistory);
        };

        setHistoryLoading(true);

        const fullCachedSnapshot = readCachedTutorHistory(report?.reportId || null, conversationId, FULL_HISTORY_LIMIT);
        const fullCachedHistory = fullCachedSnapshot?.messages || null;
        const pendingResponse = readPendingTutorResponse();
        const activeBackgroundTask = getBackgroundTutorTask(conversationId);
        const shouldSkipNetworkHistoryLoad = Boolean(
            activeBackgroundTask && !activeBackgroundTask.complete && fullCachedHistory && fullCachedHistory.length > 0
        ) || Boolean(
            fullCachedSnapshot?.isFresh
            && pendingResponse?.conversationId !== conversationId
            && (!activeBackgroundTask || activeBackgroundTask.complete)
        );

        if (fullCachedHistory && fullCachedHistory.length > 0) {
            applyHistory(fullCachedHistory);
            setHistoryLoading(false);
            if (shouldSkipNetworkHistoryLoad) {
                return;
            }
        }

        try {
            if (!conversationId) {
                const initial = fallbackMessage
                    ? [{
                        id: crypto.randomUUID(),
                        role: "assistant" as const,
                        content: fallbackMessage,
                        kind: "text" as const,
                    }]
                    : [];
                applyHistory(initial);
                setHistoryLoading(false);
                return;
            }

            const historyData = await api.get<{ reportId: string; conversationId?: string | null; messages: PersistedChatMessage[] }>(
                `/users/me/tutor/history?conversationId=${encodeURIComponent(conversationId)}&limit=${INITIAL_HISTORY_PREVIEW_LIMIT}`,
                token
            );

            if (Array.isArray(historyData.messages) && historyData.messages.length > 0) {
                const msgs: ChatMessage[] = historyData.messages.map((m) => ({
                    id: m.id,
                    role: m.role,
                    content: m.content,
                    kind: m.role === "assistant" ? classifyAssistantMessage(m.content) : "text",
                    createdAt: m.createdAt,
                }));
                persistTutorHistorySnapshot(historyData.reportId || report?.reportId || null, conversationId, msgs);
                applyHistory(reconcileHistoryWithCached(msgs, fullCachedHistory));

                if (historyData.messages.length >= INITIAL_HISTORY_PREVIEW_LIMIT) {
                    void api.get<{ reportId: string; conversationId?: string | null; messages: PersistedChatMessage[] }>(
                        `/users/me/tutor/history?conversationId=${encodeURIComponent(conversationId)}&limit=${FULL_HISTORY_LIMIT}`,
                        token
                    ).then((fullHistoryData) => {
                        if (!Array.isArray(fullHistoryData.messages)) return;
                        const fullMsgs: ChatMessage[] = fullHistoryData.messages.map((m) => ({
                            id: m.id,
                            role: m.role,
                            content: m.content,
                            kind: m.role === "assistant" ? classifyAssistantMessage(m.content) : "text",
                            createdAt: m.createdAt,
                        }));
                        persistTutorHistorySnapshot(fullHistoryData.reportId || historyData.reportId || report?.reportId || null, conversationId, fullMsgs);
                        applyHistory(reconcileHistoryWithCached(fullMsgs, fullCachedHistory));
                    }).catch(() => {});
                }
                return;
            }

            if (fullCachedHistory && fullCachedHistory.length > 0) {
                applyHistory(fullCachedHistory);
                return;
            }

            const initial = fallbackMessage
                ? [{
                    id: crypto.randomUUID(),
                    role: "assistant" as const,
                        content: fallbackMessage,
                        kind: "text" as const,
                    }]
                    : [];
            applyHistory(initial);
        } finally {
            if (requestSeq === historyRequestSeqRef.current) {
                setHistoryLoading(false);
            }
        }
    }, [hydrateArtifactsForHistory, report?.reportId, token]);

    const createConversation = useCallback(async (options?: { reportId?: string | null }) => {
        if (!token || creatingConversation) return null;

        const nextReportId = options?.reportId?.trim() || null;
        setCreatingConversation(true);
        try {
            const created = await api.post<TutorConversation>(
                "/users/me/tutor/conversations",
                nextReportId ? { reportId: nextReportId } : {},
                token
            );
            setConversations((prev) => [created, ...prev.filter((item) => item.id !== created.id)]);
            // Track this new conversation as the user's explicit choice
            userSelectedConversationRef.current = created.id;
            selectedConversationIdRef.current = created.id;
            setSelectedConversationId(created.id);
            if (nextReportId) {
                setSelectedReportId(nextReportId);
            } else {
                setSelectedReportId(null);
                setReport(null);
                setActionPlan(null);
                setAcceptedActionPlan(null);
                setExistingSheet(null);
            }
            setCoveredQuestions([]);

            const initialMessage = openingMessage || buildTutorOpeningMessage(false);
            const initial = initialMessage
                ? [{
                    id: crypto.randomUUID(),
                    role: "assistant" as const,
                    content: initialMessage,
                    kind: "text" as const,
                }]
                : [];
            setChatHistory(initial);
            return created;
        } finally {
            setCreatingConversation(false);
        }
    }, [creatingConversation, openingMessage, token]);

    /* ── Auto-resize textarea ── */
    const resizeTextarea = useCallback(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.style.height = "auto";
        const maxH = 200;
        if (el.scrollHeight > maxH) {
            el.style.height = `${maxH}px`;
            el.classList.add("scrolling");
        } else {
            el.style.height = `${el.scrollHeight}px`;
            el.classList.remove("scrolling");
        }
    }, []);

    useEffect(() => {
        resizeTextarea();
    }, [input, resizeTextarea]);

    /* ── Fetch reports ── */
    useEffect(() => {
        if (authLoading) return;
        if (!token) { setLoading(false); return; }

        // Cache-first: populate reports instantly from localStorage, then revalidate silently
        try {
            const cached = localStorage.getItem("tutor_reports");
            if (cached) {
                const reports = JSON.parse(cached) as ReportMeta[];
                setAvailableReports(reports);
                setSelectedReportId((prev) => prev || deepLinkReportId || reports[0]?.id || null);
            }
        } catch {}

        setLoading(true);
        setBootstrapStatus("Loading your reports...");
        setError(null);

        api.get<{ reports: ReportMeta[] }>("/users/me/reports", token)
            .then((data) => {
                const topReports = [...(data.reports || [])]
                    .sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime())
                    .slice(0, 10);
                setAvailableReports(topReports);
                if (topReports.length === 0) {
                    // No interviews yet — explicitly clear any stale cached reportId and
                    // unblock the UI so the welcome screen renders immediately.
                    setSelectedReportId(null);
                    setChatBootstrapping(false);
                    setHistoryLoading(false);
                    try { localStorage.removeItem("tutor_reports"); } catch {}
                } else {
                    setSelectedReportId((prev) => prev || deepLinkReportId || topReports[0]?.id || null);
                    try { localStorage.setItem("tutor_reports", JSON.stringify(topReports)); } catch {}
                }
            })
            .catch((err: any) => {
                setError(err?.message || "Failed to load reports");
                setChatBootstrapping(false);
            })
            .finally(() => setLoading(false));
    }, [token, authLoading, deepLinkReportId]);

    /* ── Bootstrap report ── */
    const triggerBootstrap = async (reportId: string) => {
        if (!token) return;

        // ── Fix 3: localStorage bootstrap cache ──
        // Check if we have fresh bootstrap data cached locally (30-min TTL).
        // This makes repeat visits feel instant — no network call needed for the skeleton.
        const bootstrapCacheKey = `tutor_bootstrap:${reportId}`;
        let usedCache = false;
        let cachedBootstrapData: { reportSummary: TutorReportSummary; actionPlan: ActionPlan | null; actionPlanTimespan?: ActionPlanTimespan } | null = null;
        if (typeof window !== "undefined") {
            try {
                const raw = localStorage.getItem(bootstrapCacheKey);
                if (raw) {
                    const cached: { ts: number; data: { reportSummary: TutorReportSummary; actionPlan: ActionPlan | null; actionPlanTimespan?: ActionPlanTimespan } } = JSON.parse(raw);
                    if (Date.now() - cached.ts < BOOTSTRAP_CACHE_TTL_MS && cached.data?.reportSummary) {
                        setReport(cached.data.reportSummary);
                        if (cached.data.actionPlan) setActionPlan(cached.data.actionPlan);
                        setActionPlanTimespan(cached.data.actionPlanTimespan || "2_weeks");
                        setOpeningMessage(buildTutorOpeningMessage(true));
                        cachedBootstrapData = cached.data;
                        usedCache = true;
                    }
                }
            } catch { /* corrupt cache — ignore */ }
        }

        // Don't block the full screen — show chat skeleton instead
        setChatBootstrapping(true);
        setError(null);
        setExistingSheet(null);

        try {
            // Pre-fill conversation ref from localStorage so history fires in parallel
            // with the conversations list fetch (eliminates the serial waterfall).
            const lastConvKey = `tutor_last_conv:${reportId}`;
            const persistedConvId = typeof window !== "undefined" ? localStorage.getItem(lastConvKey) : null;
            if (persistedConvId && !selectedConversationIdRef.current) {
                selectedConversationIdRef.current = persistedConvId;
            }
            const immediateConvId = selectedConversationIdRef.current;

            // Only mark history as loading if we actually have a conversation to restore.
            // Fresh tab sessions have no immediateConvId — setting historyLoading=true there
            // would hide the welcome screen until the full bootstrap completes.
            if (immediateConvId) setHistoryLoading(true);
            const historyPromise = immediateConvId && !isSendingRef.current
                ? loadConversationHistory(immediateConvId, buildTutorOpeningMessage(true))
                : Promise.resolve();

            let data: { reportSummary: TutorReportSummary; actionPlan: ActionPlan | null; actionPlanTimespan?: ActionPlanTimespan };
            if (usedCache) {
                setChatBootstrapping(false);
                data = cachedBootstrapData!;
            } else {
                data = await api.get<{ reportSummary: TutorReportSummary; actionPlan: ActionPlan | null; openingMessage: string; actionPlanTimespan?: ActionPlanTimespan; planReady?: boolean }>(
                    `/users/me/tutor/bootstrap?reportId=${encodeURIComponent(reportId)}`,
                    token
                );
                setReport(data.reportSummary);
                if (data.actionPlan && !acceptedActionPlan) setActionPlan(data.actionPlan);
                setActionPlanTimespan(data.actionPlanTimespan || "2_weeks");
                setOpeningMessage(buildTutorOpeningMessage(true));
                if (typeof window !== "undefined") {
                    try {
                        localStorage.setItem(bootstrapCacheKey, JSON.stringify({
                            ts: Date.now(),
                            data: {
                                reportSummary: data.reportSummary,
                                actionPlan: data.actionPlan,
                                actionPlanTimespan: data.actionPlanTimespan || "2_weeks",
                            },
                        }));
                    } catch { /* storage full — ignore */ }
                }
                setChatBootstrapping(false);
            }

            // Show cached conversations immediately so the sidebar is populated instantly
            const convCacheKey = `tutor_conversations:${reportId}`;
            if (typeof window !== "undefined") {
                try {
                    const raw = localStorage.getItem(convCacheKey);
                    if (raw) setConversations(JSON.parse(raw) as TutorConversation[]);
                } catch {}
            }

            const conversationsPromise = api.get<{ conversations: TutorConversation[] }>(
                `/users/me/tutor/conversations`,
                token
            ).then(async (conversationData) => {
                // Filter out deleted, then merge server titles with any locally-updated titles
                const serverConversations = (conversationData.conversations || []).filter(
                    (c) => !deletedConversationIdsRef.current.has(c.id)
                );
                setConversations((prev) => {
                    const localTitleMap = new Map(prev.map((c) => [c.id, c.title]));
                    const merged = serverConversations.map((c) => {
                        if (titledConversationIdsRef.current.has(c.id)) {
                            const localTitle = localTitleMap.get(c.id);
                            if (localTitle) return { ...c, title: localTitle };
                        }
                        return c;
                    });
                    // Persist for instant display on next visit
                    if (typeof window !== "undefined") {
                        try { localStorage.setItem(convCacheKey, JSON.stringify(merged)); } catch {}
                    }
                    return merged;
                });
                // Fresh tab session: don't auto-select any conversation — show the welcome screen.
                // The user will start a new chat from the prompts or input box.
                if (isFreshTabSessionRef.current) {
                    isFreshTabSessionRef.current = false;
                    setCoveredQuestions([]);
                    return;
                }

                // Only auto-select the latest conversation if the user has NOT explicitly
                // picked a conversation themselves. This prevents bootstrap from stomping
                // on the conversation the user clicked in the sidebar.
                const userPicked = userSelectedConversationRef.current;
                const nextConversationId = userPicked && serverConversations.some(c => c.id === userPicked)
                    ? userPicked
                    : immediateConvId || serverConversations[0]?.id || null;
                setSelectedConversationId(nextConversationId);
                setCoveredQuestions([]);
                // Persist for next visit so history can load in parallel with conversations list
                if (nextConversationId && typeof window !== "undefined") {
                    localStorage.setItem(lastConvKey, nextConversationId);
                }
                // Only load history if we didn't already fire it above for the current conversationId.
                // Also skip if a message is in-flight — don't overwrite the sending conversation.
                if (nextConversationId !== immediateConvId && !isSendingRef.current) {
                    await loadConversationHistory(nextConversationId, buildTutorOpeningMessage(true));
                }
            }).catch(() => {
                // Keep the optimistic/cached chat instead of wiping the UI on a background fetch failure.
                if (!immediateConvId) {
                    setSelectedConversationId((prev) => prev);
                }
                setHistoryLoading(false);
            });

            const questionsPromise = api.get<{ reportId: string; questions: TutorQuestion[] }>(
                `/users/me/tutor/questions?reportId=${encodeURIComponent(data.reportSummary.reportId)}`,
                token
            ).then((qData) => {
                setQuestions(qData.questions || []);
            }).catch(() => {});

            const sheetPromise = api.get<{ sheet: SheetMeta | null }>(
                `/users/me/sheets/by-report/${encodeURIComponent(data.reportSummary.reportId)}`,
                token
            ).then((sheetData) => {
                setExistingSheet(sheetData.sheet || null);
            }).catch(() => {
                setExistingSheet(null);
            });

            const actionPlanPromise = api.get<{ plans: AcceptedActionPlanMeta[] }>("/users/me/tutor/action-plans", token)
                .then((actionPlanData) => {
                    const matchedPlan = (actionPlanData.plans || []).find((p) => {
                        if (deepLinkPlanId && p.id !== deepLinkPlanId) return false;
                        return p.reportId === data.reportSummary.reportId;
                    }) || null;
                    setAcceptedActionPlan(matchedPlan);

                    if (matchedPlan?.actionPlan) {
                        setActionPlan(matchedPlan.actionPlan);
                        setActionPlanTimespan(matchedPlan.timespan);
                    }

                    if (!deepLinkAppliedRef.current && deepLinkPanel === "action-plan" && (!deepLinkReportId || deepLinkReportId === data.reportSummary.reportId)) {
                        setPreviewTab("action-plan");
                        deepLinkAppliedRef.current = true;
                    }
                }).catch(() => {
                    setAcceptedActionPlan(null);
                });

            // Wait for all background fetches (UI is already unblocked)
            await Promise.all([conversationsPromise, historyPromise, questionsPromise, sheetPromise, actionPlanPromise]);
        } catch (err: any) {
            setError(err?.message || "Failed to initialize AI Tutor");
        } finally {
            setChatBootstrapping(false);
            setCheckingSheet(false);
            setHistoryLoading(false);
        }
    };

    useEffect(() => {
        if (!selectedReportId || !token) return;
        triggerBootstrap(selectedReportId);
    }, [selectedReportId, token]);

    /* ── Close dropdowns on outside click ── */
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            const target = e.target as Node;
            if (quickMenuRef.current && !quickMenuRef.current.contains(target)) setQuickMenuOpen(false);
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, []);

    const generateActionPlanForTimespan = async (timespan: ActionPlanTimespan, customPrompt?: string) => {
        if (!token || !report?.reportId) return;
        if (generatingActionPlan) return;

        // If this specific report already has an accepted plan, show it instead of regenerating.
        // Each interview report gets its own plan — but once accepted for a report, it's locked.
        if (acceptedActionPlan && acceptedActionPlan.reportId === report.reportId) {
            setActionPlanPickerOpen(false);
            setCustomizePlanOpen(false);
            setPreviewTab("action-plan");
            return;
        }

        setError(null);
        setActionPlanPickerOpen(false);
        setActionPlanTimespan(timespan);
        setGeneratingActionPlan(true);

        try {
            const data = await api.get<{ reportId: string; timespan: ActionPlanTimespan; actionPlan: ActionPlan }>(
                `/users/me/tutor/action-plan?reportId=${encodeURIComponent(report.reportId)}&timespan=${timespan}&refresh=true${customPrompt ? `&customPrompt=${encodeURIComponent(customPrompt)}` : ""}`,
                token
            );
            setActionPlan(data.actionPlan);
            setActionPlanTimespan(data.timespan || timespan);
            setPreviewTab("action-plan");
            setCustomizePlanOpen(false);
            setCustomizePlanInput("");
        } catch (err: any) {
            setError(err?.message || "Failed to generate action plan");
        } finally {
            setGeneratingActionPlan(false);
        }
    };

    const handleAcceptActionPlan = async () => {
        if (!token || !report?.reportId || !actionPlan || acceptingActionPlan) return;

        setAcceptingActionPlan(true);
        setError(null);

        try {
            const saved = await api.post<AcceptedActionPlanMeta>(
                "/users/me/tutor/action-plan/accept",
                { reportId: report.reportId, timespan: actionPlanTimespan, actionPlan },
                token
            );

            setAcceptedActionPlan(saved);
            
            // Invalidate the action plan cache so dashboard refreshes
            queryClient.invalidateQueries({ queryKey: ["action-plan", "active"] });
            
            setChatHistory((prev) => [
                ...prev,
                {
                    id: crypto.randomUUID(),
                    role: "assistant",
                    kind: "nudge",
                    content: `✓ Action plan saved for ${actionPlanTimespanLabel(actionPlanTimespan)}. You can now track it from your dashboard calendar.`,
                },
            ]);
        } catch (err: any) {
            setError(err?.message || "Failed to save action plan");
        } finally {
            setAcceptingActionPlan(false);
        }
    };

    /* ── Generate sheet ── */
    const handleGenerateSheet = async () => {
        if (!token || !report?.reportId || generatingSheet) return;

        setGeneratingSheet(true);
        setError(null);

        try {
            const created = await api.post<{
                sheetId: string;
                reportId: string;
                label: string;
                generatedAt: string;
                questions: TutorQuestion[];
                alreadyExisted: boolean;
            }>("/users/me/sheets/generate", { reportId: report.reportId, questions }, token);

            const totalQuestions = Array.isArray(created.questions) ? created.questions.length : 0;
            setExistingSheet({
                sheetId: created.sheetId,
                reportId: created.reportId,
                label: created.label,
                generatedAt: created.generatedAt,
                totalQuestions,
                completedQuestions: 0,
            });

            setChatHistory((prev) => [
                ...prev,
                {
                    id: crypto.randomUUID(),
                    role: "assistant",
                    kind: "nudge",
                    content: `✓ Personalized sheet ready with ${totalQuestions} questions. You can view it in the Questions panel or open it in My Sheets.`,
                },
            ]);
        } catch (err: any) {
            setError(err?.message || "Failed to generate personalized sheet");
        } finally {
            setGeneratingSheet(false);
        }
    };

    /* ── Regenerate questions ── */
    const handleRegenerateQuestions = async () => {
        if (!token || !report?.reportId || refreshingQuestions || checkingSheet) return;

        setRefreshingQuestions(true);
        setError(null);

        try {
            const qData = await api.get<{ reportId: string; questions: TutorQuestion[] }>(
                `/users/me/tutor/questions?reportId=${encodeURIComponent(report.reportId)}&refresh=true`,
                token
            );
            setQuestions(qData.questions || []);
        } catch (err: any) {
            setError(err?.message || "Failed to regenerate questions");
        } finally {
            setRefreshingQuestions(false);
        }
    };

    /* ── Profile bootstrap (Agent V2) ──
     * One-shot fetch of the user's tutor profile. If it doesn't exist
     * yet, surface the setup wizard the first time they open the page —
     * the agent's recommendations are dramatically better with goals set. */
    useEffect(() => {
        if (!token || profileBootstrapped) return;
        let cancelled = false;
        api
            .get<{ exists: boolean; profile: any }>(`/users/me/tutor/profile`, token)
            .then((res) => {
                if (cancelled) return;
                setProfileExists(res.exists);
                if (res.profile) setCurrentProfile(res.profile);
                setProfileBootstrapped(true);
                // Auto-prompt on first run only — the user can dismiss / skip.
                const dismissedKey = "tutor_profile_setup_dismissed:v1";
                const dismissed =
                    typeof window !== "undefined" && window.localStorage.getItem(dismissedKey) === "1";
                if (!res.exists && !dismissed) {
                    // Mark as seen so we don't re-prompt on every page load.
                    if (typeof window !== "undefined") {
                        window.localStorage.setItem(dismissedKey, "1");
                    }
                    setProfileModalOpen(true);
                }
            })
            .catch(() => {
                if (cancelled) return;
                setProfileBootstrapped(true);
            });
        return () => {
            cancelled = true;
        };
    }, [token, profileBootstrapped]);

    /* ── Scroll to bottom ── */
    useEffect(() => {
        if (!listRef.current) return;
        listRef.current.scrollTop = listRef.current.scrollHeight;
    }, [chatHistory, sendingConversationId]);

    useEffect(() => {
        if (typeof window === "undefined" || !selectedConversationId || chatHistory.length === 0) return;
        persistTutorHistorySnapshot(report?.reportId || null, selectedConversationId, chatHistory);
    }, [chatHistory, report?.reportId, selectedConversationId]);

    useEffect(() => {
        if (typeof window === "undefined" || !selectedConversationId) return;
        const activeReportId = selectedConversation?.reportId || report?.reportId || selectedReportId || null;
        persistLastActiveTutorChat(activeReportId, selectedConversationId);
    }, [report?.reportId, selectedConversation?.reportId, selectedConversationId, selectedReportId]);

    const refreshAcceptedActionPlanForReport = useCallback(async (reportIdToMatch?: string | null) => {
        if (!token) return null;

        try {
            const actionPlanData = await api.get<{ plans: AcceptedActionPlanMeta[] }>("/users/me/tutor/action-plans", token);
            const resolvedReportId =
                reportIdToMatch
                || selectedConversation?.reportId
                || report?.reportId
                || selectedReportId
                || null;
            const matchedPlan = resolvedReportId
                ? (actionPlanData.plans || []).find((plan) => plan.reportId === resolvedReportId) || null
                : (actionPlanData.plans || [])[0] || null;

            setAcceptedActionPlan(matchedPlan);

            if (matchedPlan?.actionPlan) {
                setActionPlan(matchedPlan.actionPlan);
                setActionPlanTimespan(matchedPlan.timespan);
            }

            return matchedPlan;
        } catch {
            return null;
        }
    }, [token, selectedConversation?.reportId, report?.reportId, selectedReportId]);

    const attachBackgroundTutorTask = useCallback((conversationId: string | null) => {
        if (backgroundTaskUnsubscribeRef.current) {
            backgroundTaskUnsubscribeRef.current();
            backgroundTaskUnsubscribeRef.current = null;
        }
        if (!conversationId) return;

        const task = getBackgroundTutorTask(conversationId);
        if (!task) return;

        backgroundTaskUnsubscribeRef.current = subscribeBackgroundTutorTask(conversationId, (snapshot) => {
            if (selectedConversationIdRef.current !== snapshot.conversationId) return;

            setChatHistory(snapshot.history);
            setStreamingStatus(snapshot.status);
            setAgentToolCalls(snapshot.agentToolCalls);
            setThinkingWords(snapshot.thinkingWords);
            setAgentArtifacts(snapshot.agentArtifacts);
            setAgentClarifications(snapshot.agentClarifications);

            const latestDraftArtifact = [...snapshot.agentArtifacts]
                .reverse()
                .find((artifact) => artifact.isDraft && !artifact.committed);
            if (latestDraftArtifact && ["action_plan", "question_sheet", "quiz"].includes(latestDraftArtifact.artifactType)) {
                setOpenArtifactId((current) => current && current !== latestDraftArtifact.artifactId ? null : current);
                if (latestDraftArtifact.artifactType !== "action_plan") {
                    setOpenActionPlanPreviewId((current) => current && current !== latestDraftArtifact.artifactId ? null : current);
                }
            }

            if (snapshot.resolvedReportId && snapshot.resolvedReportId !== selectedReportId && chatHistoryRef.current.length === 0) {
                setSelectedReportId(snapshot.resolvedReportId);
            }

            if (snapshot.previewPanel) {
                if (snapshot.previewPanel === "action-plan") {
                    const hasPlan = Boolean(actionPlanRef.current || acceptedActionPlanRef.current);
                    if (hasPlan) setPreviewTab("action-plan");
                    else setActionPlanPickerOpen(true);
                } else {
                    setPreviewTab(snapshot.previewPanel);
                }
            }

            if (snapshot.complete) {
                isSendingRef.current = false;
                setSendingConversationId(null);
                if (snapshot.upgradeNeeded) {
                    setUpgradeCopy(copyFromUpgradeError(snapshot.errorMessage));
                    setUpgradeOpen(true);
                } else if (snapshot.errorMessage) {
                    setError(snapshot.errorMessage);
                }
                return;
            }

            isSendingRef.current = true;
            setSendingConversationId(snapshot.conversationId);
        });
    }, [selectedReportId]);

    useEffect(() => {
        attachBackgroundTutorTask(selectedConversationId);
        return () => {
            if (backgroundTaskUnsubscribeRef.current) {
                backgroundTaskUnsubscribeRef.current();
                backgroundTaskUnsubscribeRef.current = null;
            }
        };
    }, [attachBackgroundTutorTask, selectedConversationId]);

    useEffect(() => {
        if (!token || !selectedConversationId) return;

        const activeBackgroundTask = getBackgroundTutorTask(selectedConversationId);
        if (activeBackgroundTask && !activeBackgroundTask.complete) return;

        const pending = readPendingTutorResponse();
        if (!pending || pending.conversationId !== selectedConversationId) return;
        if (isSendingRef.current) return;

        const stopPolling = () => {
            if (resumePollingIntervalRef.current) {
                clearInterval(resumePollingIntervalRef.current);
                resumePollingIntervalRef.current = null;
            }
        };

        const finishPending = () => {
            clearPendingTutorResponse(selectedConversationId);
            isSendingRef.current = false;
            setSendingConversationId(null);
            setStreamingStatus(null);
            setAgentToolCalls([]);
            stopPolling();
        };

        const syncPendingResponse = async () => {
            const latestPending = readPendingTutorResponse();
            if (!latestPending || latestPending.conversationId !== selectedConversationId) {
                finishPending();
                return;
            }

            const cachedHistorySnapshot = readCachedTutorHistory(
                latestPending.reportId || report?.reportId || selectedConversation?.reportId || null,
                selectedConversationId,
                FULL_HISTORY_LIMIT
            );
            const cachedHistory = cachedHistorySnapshot?.messages || null;

            if (cachedHistory && cachedHistory.length > 0) {
                const mergedCached = reconcileHistoryWithCached(chatHistoryRef.current, cachedHistory);
                const mergedCachedLast = mergedCached.length > 0 ? mergedCached[mergedCached.length - 1] : null;
                const currentHistoryLast = chatHistoryRef.current.length > 0 ? chatHistoryRef.current[chatHistoryRef.current.length - 1] : null;
                if (mergedCached.length !== chatHistoryRef.current.length || !isSameChatMessage(mergedCachedLast, currentHistoryLast)) {
                    setChatHistory(mergedCached);
                }
                if (hasAssistantReplyForPending(mergedCached, latestPending)) {
                    finishPending();
                    return;
                }
            }

            try {
                const historyData = await api.get<{ reportId: string; conversationId?: string | null; messages: PersistedChatMessage[] }>(
                    `/users/me/tutor/history?conversationId=${encodeURIComponent(selectedConversationId)}&limit=${FULL_HISTORY_LIMIT}`,
                    token
                );
                if (!Array.isArray(historyData.messages)) return;
                const serverHistory: ChatMessage[] = historyData.messages.map((message) => ({
                    id: message.id,
                    role: message.role,
                    content: message.content,
                    kind: message.role === "assistant" ? classifyAssistantMessage(message.content) : "text",
                    createdAt: message.createdAt,
                }));
                const mergedHistory = reconcileHistoryWithCached(serverHistory, cachedHistory);
                setChatHistory(mergedHistory);
                if (hasAssistantReplyForPending(mergedHistory, latestPending)) {
                    finishPending();
                }
            } catch {
                // Keep polling quietly while the background response is still pending.
            }
        };

        isSendingRef.current = true;
        setSendingConversationId(selectedConversationId);
        setStreamingStatus("Finishing response...");
        void syncPendingResponse();

        stopPolling();
        resumePollingIntervalRef.current = setInterval(() => {
            void syncPendingResponse();
        }, 1500);

        return () => {
            stopPolling();
        };
    }, [token, selectedConversation?.reportId, selectedConversationId, report?.reportId]);

    /* ── Prefill chat input (from preview panel) ── */
    const handlePrefillChat = useCallback((text: string) => {
        setInput(text);
        setTimeout(() => textareaRef.current?.focus(), 50);
    }, []);

    /* ── Rename conversation ── */
    const handleRenameConversation = async (id: string, newTitle: string) => {
        if (!token || !newTitle.trim()) return;
        try {
            await api.patch(`/users/me/tutor/conversations/${id}`, { title: newTitle.trim() }, token);
            setConversations((prev) =>
                prev.map((c) => (c.id === id ? { ...c, title: newTitle.trim() } : c))
            );
        } catch {}
        setRenamingId(null);
    };

    /* ── Delete conversation ── */
    const handleDeleteConversation = async (id: string) => {
        if (!token) return;
        // Mark as deleted immediately so any concurrent bootstrap fetch filters it out
        deletedConversationIdsRef.current.add(id);
        // Optimistic UI update
        setConversations((prev) => prev.filter((c) => c.id !== id));
        if (selectedConversationId === id) {
            const next = conversations.find((c) => c.id !== id);
            if (next) {
                setSelectedConversationId(next.id);
                loadConversationHistory(next.id, openingMessage);
            } else {
                setSelectedConversationId(null);
                setChatHistory([]);
            }
        }
        try {
            await api.delete(`/users/me/tutor/conversations/${id}`, token);
        } catch {
            // If the API call fails, remove from deleted set and restore
            deletedConversationIdsRef.current.delete(id);
            // Re-fetch to restore accurate state
            api.get<{ conversations: TutorConversation[] }>(`/users/me/tutor/conversations`, token)
                .then((data) => setConversations(
                    (data.conversations || []).filter((c) => !deletedConversationIdsRef.current.has(c.id))
                ))
                .catch(() => {});
        }
    };

    /* ── Generate title after first message ── */
    const generateConversationTitle = useCallback(async (conversationId: string, firstMessage: string) => {
        if (!token) return;
        try {
            const result = await api.post<{ id: string; title: string }>(
                `/users/me/tutor/conversations/${conversationId}/generate-title`,
                { firstMessage },
                token
            );
            if (result.title && result.title.length >= 2) {
                // Mark as titled AFTER we have the smart title, then update state
                titledConversationIdsRef.current.add(conversationId);
                setConversations((prev) =>
                    prev.map((c) => (c.id === conversationId ? { ...c, title: result.title } : c))
                );
            }
        } catch {}
    }, [token]);

    /* ── Agent draft + clarification handlers ──
     * These wrap sendMessage with marker prefixes the agent system prompt
     * recognizes ([approve_draft:id], [revise_draft:id], [clarify:id]) so
     * the model knows exactly which artifact / clarification to act on.
     * Optimistically mutate the BackgroundTutorTask so the UI flips before
     * the SSE round-trip completes. */
    const rememberArtifactResourceId = useCallback((artifactId: string, resourceId: string) => {
        setAgentArtifacts((prev) => prev.map((art) =>
            art.artifactId === artifactId ? { ...art, resourceId } : art
        ));
        const activeTask = selectedConversationId ? getBackgroundTutorTask(selectedConversationId) : null;
        if (activeTask) {
            activeTask.agentArtifacts = activeTask.agentArtifacts.map((art) =>
                art.artifactId === artifactId ? { ...art, resourceId } : art
            );
            emitBackgroundTutorTask(activeTask);
        }
    }, [selectedConversationId]);

    const resolveQuestionSheetResourceId = useCallback(async (artifact: AgentArtifact): Promise<string | null> => {
        if (!token) return artifact.resourceId || null;

        const sheetExists = async (sheetId: string) => {
            try {
                await api.get(`/users/me/sheets/${encodeURIComponent(sheetId)}`, token);
                return true;
            } catch {
                return false;
            }
        };

        if (artifact.resourceId && await sheetExists(artifact.resourceId)) {
            return artifact.resourceId;
        }

        try {
            const detail = await api.get<{
                meta?: { resourceId?: string | null } | null;
                artifact?: {
                    resourceId?: string | null;
                    meta?: { resourceId?: string | null } | null;
                } | null;
            }>(`/users/me/tutor/artifacts/${artifact.artifactId}`, token);
            const resourceId = detail.meta?.resourceId
                || detail.artifact?.resourceId
                || detail.artifact?.meta?.resourceId
                || null;
            if (resourceId && await sheetExists(resourceId)) {
                rememberArtifactResourceId(artifact.artifactId, resourceId);
                return resourceId;
            }
        } catch {}

        try {
            const title = artifact.title.trim().toLowerCase();
            const data = await api.get<{
                sheets?: Array<{ sheetId: string; label?: string | null; generatedAt?: string | null }>;
            }>("/users/me/sheets", token);
            const match = (data.sheets || []).find((sheet) =>
                (sheet.label || "").trim().toLowerCase() === title
            );
            if (match?.sheetId) {
                rememberArtifactResourceId(artifact.artifactId, match.sheetId);
                return match.sheetId;
            }
        } catch {}

        return null;
    }, [rememberArtifactResourceId, token]);

    const openAgentArtifact = useCallback(async (artifactId: string) => {
        const artifact = agentArtifacts.find((item) => item.artifactId === artifactId);
        if (!artifact) return;

        if (artifact.committed) {
            if (artifact.artifactType === "action_plan") {
                router.push("/dashboard");
                return;
            }
            if (artifact.artifactType === "question_sheet") {
                const sheetId = await resolveQuestionSheetResourceId(artifact);
                if (sheetId) {
                    router.push(`/sheets/${encodeURIComponent(sheetId)}`);
                } else {
                    setChatHistory((prev) => [
                        ...prev,
                        {
                            id: `sheet-open-error-${Date.now()}`,
                            role: "assistant",
                            content: "I could not find that saved sheet yet. Please try again in a moment.",
                            createdAt: new Date().toISOString(),
                        },
                    ]);
                }
                return;
            }
            setOpenArtifactId(artifactId);
            return;
        }

        if (artifact.artifactType === "action_plan") {
            setOpenActionPlanPreviewId(artifactId);
        } else {
            setOpenArtifactId(artifactId);
        }
    }, [agentArtifacts, resolveQuestionSheetResourceId, router]);

    const handleApproveDraft = async (artifact: AgentArtifact) => {
        if (isSendingRef.current) return;
        if (approvingArtifactIds.has(artifact.artifactId)) return;
        setApprovingArtifactIds((prev) => new Set(prev).add(artifact.artifactId));
        const canCommitDirect = Boolean(
            token && ["action_plan", "question_sheet", "quiz", "study_note"].includes(artifact.artifactType)
        );
        try {
            if (canCommitDirect) {
                const res = await api.post<{ success: boolean; artifact: { resourceId: string | null } }>(
                    `/users/me/tutor/artifacts/${artifact.artifactId}/commit`, 
                    {}, 
                    token
                );
                const resourceId = res.artifact?.resourceId || artifact.resourceId || null;
                setAgentArtifacts((prev) => prev.map((art) =>
                    art.artifactId === artifact.artifactId
                        ? { ...art, isDraft: false, committed: true, resourceId }
                        : art
                ));
                const activeTask = selectedConversationId ? getBackgroundTutorTask(selectedConversationId) : null;
                if (activeTask) {
                    activeTask.agentArtifacts = activeTask.agentArtifacts.map((art) =>
                        art.artifactId === artifact.artifactId
                            ? { ...art, isDraft: false, committed: true, resourceId }
                            : art
                    );
                    emitBackgroundTutorTask(activeTask);
                }
                if (artifact.artifactType === "action_plan") {
                    await refreshAcceptedActionPlanForReport(
                        selectedConversation?.reportId || report?.reportId || selectedReportId || null
                    );
                }
                const savedLocation = artifact.artifactType === "quiz"
                    ? "saved in this chat"
                    : "now in your library";
                setChatHistory((prev) => [
                    ...prev,
                    {
                        id: `system-${Date.now()}`,
                        role: "assistant",
                        content: `✓ Saved! **${artifact.title || "Your " + artifact.artifactType.replace(/_/g, " ")}** is ${savedLocation}.`,
                        createdAt: new Date().toISOString(),
                    },
                ]);
                return;
            }

            const text = `[approve_draft:${artifact.artifactId}] Looks good — please save this ${artifact.artifactType.replace(/_/g, " ")} as my final version.`;
            sendMessage(text);
        } catch (err) {
            if (canCommitDirect) {
                console.error("Failed to commit artifact:", err);
                setChatHistory((prev) => [
                    ...prev,
                    {
                        id: `error-${Date.now()}`,
                        role: "assistant",
                        content: `Failed to save the ${artifact.artifactType.replace(/_/g, " ")}. Please try again or contact support if the issue persists.`,
                        createdAt: new Date().toISOString(),
                    },
                ]);
            }
        } finally {
            setApprovingArtifactIds((prev) => {
                const next = new Set(prev);
                next.delete(artifact.artifactId);
                return next;
            });
        }
    };

    const handleReviseDraft = (artifact: AgentArtifact, note: string) => {
        if (isSendingRef.current) return;
        const trimmed = note.trim();
        if (!trimmed) return;
        const text = `[revise_draft:${artifact.artifactId}] ${trimmed}`;
        sendMessage(text);
    };

    const handleSubmitClarification = (clarificationId: string, answers: Record<string, string>) => {
        if (isSendingRef.current) return;
        const target = agentClarifications.find((c) => c.id === clarificationId);
        if (!target || target.submitted) return;

        // Optimistic — flip the card to "Sent" state immediately, both in local
        // state and in the BackgroundTutorTask snapshot so re-renders stay coherent.
        setAgentClarifications((prev) => prev.filter((c) => c.id !== clarificationId));
        const taskRef =
            selectedConversationId
                ? backgroundTutorTasks.get(selectedConversationId)
                : null;
        if (taskRef) {
            taskRef.agentClarifications = taskRef.agentClarifications.filter((c) => c.id !== clarificationId);
        }

        // Build a structured user message — readable to the human, parseable by the model.
        const lines = target.slots.map((slot) => {
            const v = answers[slot.id];
            return `- ${slot.label}: ${v && v.trim() ? v.trim() : "(skipped)"}`;
        });
        const text = `[clarify:${target.id}]\n${target.context}\n${lines.join("\n")}`;
        sendMessage(text);
    };

    /* ── Send message ── */
    const sendMessage = async (text: string, markQuestionId?: string) => {
        if (!token) return;
        const trimmed = text.trim();
        if (!trimmed || isSendingRef.current) return;
        const isActionPlanRequest = /\baction\s*plan\b/i.test(trimmed);

        setError(null);
        if (isActionPlanRequest) {
            setGeneratingActionPlan(true);
        }

        if (markQuestionId) {
            setCoveredQuestions((prev) => (prev.includes(markQuestionId) ? prev : [...prev, markQuestionId]));
        }

        const userMsg: ChatMessage = { id: crypto.randomUUID(), role: "user", content: trimmed, kind: "text", createdAt: new Date().toISOString() };
        let activeConversationId = selectedConversationId;
        let baseHistory = chatHistory;
        let activeReportId = selectedConversation?.reportId || report?.reportId || selectedReportId || null;

        if (!activeConversationId) {
            const createdConversation = await createConversation({ reportId: activeReportId });
            activeConversationId = createdConversation?.id || null;
            activeReportId = createdConversation?.reportId || activeReportId;
            const initialOpening = openingMessage || buildTutorOpeningMessage(false);
            baseHistory = initialOpening
                ? [{
                    id: crypto.randomUUID(),
                    role: "assistant" as const,
                    content: initialOpening,
                    kind: "text" as const,
                }]
                : [];
        }

        setChatHistory((prev) => {
            // Guard inside the setter: if the user has switched away from the conversation
            // that sent this message, return prev unchanged — don't bleed into the other chat.
            if (selectedConversationIdRef.current !== activeConversationId) return prev;
            return activeConversationId === selectedConversationId ? [...prev, userMsg] : [...baseHistory, userMsg];
        });
        let streamHistory = activeConversationId === selectedConversationId ? [...chatHistoryRef.current, userMsg] : [...baseHistory, userMsg];
        if (activeConversationId) {
            persistTutorHistorySnapshot(activeReportId, activeConversationId, streamHistory);
            persistLastActiveTutorChat(activeReportId, activeConversationId);
            persistPendingTutorResponse({
                conversationId: activeConversationId,
                reportId: activeReportId,
                userMessage: trimmed,
                startedAt: new Date().toISOString(),
            });
        }
        setInput("");
        // Bug 2 fix: scope the "sending" state to the active conversation so the
        // TypingIndicator only appears in the chat that's actually streaming.
        isSendingRef.current = true;
        setSendingConversationId(activeConversationId);

        const historyForApi = [...baseHistory, userMsg]
            .slice(-12)
            .map((m) => ({ role: m.role, content: stripDisplayPrefix(m.content) }));

        try {
            if (!activeConversationId) throw new Error("Conversation not available");

            const task = startBackgroundTutorTask({
                apiBase,
                token,
                conversationId: activeConversationId,
                activeReportId,
                message: trimmed,
                historyForApi,
                coveredQuestions,
                currentPanel: previewTab || null,
                initialHistory: streamHistory,
                initialArtifacts: agentArtifacts,
                initialClarifications: agentClarifications,
            });

            attachBackgroundTutorTask(activeConversationId);
            await task.promise;

            if (task.errorMessage) return;

            setConversations((prev) =>
                prev
                    .map((conversation) =>
                        conversation.id === activeConversationId
                            ? {
                                ...conversation,
                                title: conversation.messageCount === 0 ? trimmed.slice(0, 48) : conversation.title,
                                reportId: selectedConversation?.reportId || report?.reportId || conversation.reportId,
                                messageCount: conversation.messageCount + 2,
                                lastMessageAt: new Date().toISOString(),
                            }
                            : conversation
                    )
                    .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime())
            );
            const alreadyRequested = titledConversationIdsRef.current.has(`req:${activeConversationId}`);
            if (!alreadyRequested) {
                titledConversationIdsRef.current.add(`req:${activeConversationId}`);
                generateConversationTitle(activeConversationId, trimmed);
            }
        } finally {
            // Always clear the sending state — it is scoped to the conversation ID so
            // clearing it here won't affect the indicator in any other chat.
            if (isActionPlanRequest) {
                setGeneratingActionPlan(false);
            }
        }
    };

    /* ── Keyboard submit ── */
    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendMessage(input);
        }
    };

    /* ═══════════════ Render ═══════════════ */

    /* Loading state - show skeleton during initial load or when bootstrapping with no history */
    const showTutorSkeleton = loading && chatHistory.length === 0;
    if (showTutorSkeleton) {
        return <TutorLoadingSkeleton status={bootstrapStatus} />;
    }

    /* Error state (no report loaded) */
    if (error && !report) {
        return (
            <div className="flex-1 flex flex-col h-full">
                <div className="flex-1 flex items-center justify-center px-4">
                    <div className="max-w-md w-full rounded-2xl border border-red-200 bg-red-50 p-6 text-center dark:border-red-500/20 dark:bg-red-500/10">
                        <span className="material-symbols-outlined text-red-400 text-3xl mb-2">error</span>
                        <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
                        <button
                            onClick={() => selectedReportId && triggerBootstrap(selectedReportId)}
                            className="mt-4 rounded-lg bg-red-500 px-4 py-2 text-xs font-semibold text-white hover:bg-red-600 transition-colors"
                        >
                            Try Again
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    /* Removed: No longer require reports to use AI Tutor - users can start chatting immediately */

    return (
        <div className="flex-1 flex h-full min-h-0 overflow-hidden">

            {/* ── History Modal ── */}
            {historyModalOpen && (() => {
                // ── Flatten all conversations for keyboard nav ──
                const now = new Date();
                const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                const weekStart = new Date(todayStart);
                weekStart.setDate(weekStart.getDate() - 6);

                const groups: { label: string; items: TutorConversation[] }[] = [
                    { label: "Current", items: [] },
                    { label: "Today", items: [] },
                    { label: "This Week", items: [] },
                    { label: "Earlier", items: [] },
                ];

                for (const conv of conversations) {
                    if (conv.id === selectedConversationId) { groups[0].items.push(conv); continue; }
                    const d = new Date(conv.lastMessageAt);
                    if (d >= todayStart) groups[1].items.push(conv);
                    else if (d >= weekStart) groups[2].items.push(conv);
                    else groups[3].items.push(conv);
                }

                return (
                    <HistoryModal
                        groups={groups}
                        selectedConversationId={selectedConversationId}
                        reportMetaById={reportMetaById}
                        renamingId={renamingId}
                        renameValue={renameValue}
                        setRenamingId={setRenamingId}
                        setRenameValue={setRenameValue}
                        handleRenameConversation={handleRenameConversation}
                        setDeleteConfirmId={setDeleteConfirmId}
                        onClose={() => setHistoryModalOpen(false)}
                        onSelect={(conv) => {
                            userSelectedConversationRef.current = conv.id;
                            selectedConversationIdRef.current = conv.id;
                            setSelectedConversationId(conv.id);
                            if (conv.reportId && conv.reportId !== report?.reportId) {
                                setSelectedReportId(conv.reportId);
                            } else if (!conv.reportId) {
                                setSelectedReportId(null);
                                setReport(null);
                                setActionPlan(null);
                                setAcceptedActionPlan(null);
                                setExistingSheet(null);
                            }
                            loadConversationHistory(conv.id, openingMessage);
                            setHistoryModalOpen(false);
                        }}
                    />
                );
            })()}
            {/* ── Delete confirmation popup ── */}
            {deleteConfirmId && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/40 px-4" onClick={() => setDeleteConfirmId(null)}>
                    <div
                        className="w-full max-w-xs rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-lc-border dark:bg-lc-surface status-fade-enter"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center gap-3 mb-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-50 dark:bg-red-500/10">
                                <span className="material-symbols-outlined text-red-500 text-[18px]">delete</span>
                            </div>
                            <div>
                                <p className="text-sm font-semibold text-slate-800 dark:text-white">Delete session?</p>
                                <p className="text-xs text-slate-500 dark:text-slate-400">This will permanently remove the chat history.</p>
                            </div>
                        </div>
                        <div className="flex gap-2 mt-4">
                            <button
                                onClick={() => setDeleteConfirmId(null)}
                                className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-lc-border dark:text-slate-200 dark:hover:bg-lc-hover transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => {
                                    handleDeleteConversation(deleteConfirmId);
                                    setDeleteConfirmId(null);
                                }}
                                className="flex-1 rounded-xl bg-red-500 px-3 py-2 text-xs font-semibold text-white hover:bg-red-600 transition-colors"
                            >
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <UpgradeModal
                open={upgradeOpen}
                onClose={() => setUpgradeOpen(false)}
                feature="ai_tutor"
                reason={billingSnapshot?.plan === "FREE" ? "locked" : "tokens"}
                title={billingSnapshot?.plan === "FREE" ? "AI Tutor is a Premium feature" : "Upgrade AI Tutor"}
                description={
                    billingSnapshot?.plan === "FREE"
                        ? undefined
                        : (upgradeCopy && upgradeCopy !== "This tutor action needs an upgraded plan." 
                            ? upgradeCopy 
                            : "Your current plan has reached its tutor limit. Upgrade for a larger monthly AI budget.")
                }
                currentPlan={billingSnapshot?.plan}
                currentSubscriptionId={billingSnapshot?.subscriptionId ?? undefined}
            />

            {/* ── Agent V2 modals ────────────────────────────────────────── */}
            {openArtifactId && token && (
                <ArtifactDetailModal
                    artifactId={openArtifactId}
                    token={token}
                    onClose={() => setOpenArtifactId(null)}
                />
            )}
            {openActionPlanPreviewId && token && (
                <ActionPlanPreviewModal
                    artifactId={openActionPlanPreviewId}
                    token={token}
                    onClose={() => setOpenActionPlanPreviewId(null)}
                    onApprove={(direct?: boolean, resourceId?: string | null) => {
                        const artifact = agentArtifacts.find(a => a.artifactId === openActionPlanPreviewId);
                        if (direct) {
                            // Update local state to show it's committed so the artifact card flips
                            setAgentArtifacts(prev => prev.map(a => 
                                a.artifactId === openActionPlanPreviewId 
                                    ? { ...a, isDraft: false, committed: true, resourceId: resourceId || a.resourceId } 
                                    : a
                            ));
                            const activeTask = selectedConversationId ? getBackgroundTutorTask(selectedConversationId) : null;
                            if (activeTask) {
                                activeTask.agentArtifacts = activeTask.agentArtifacts.map(a => 
                                    a.artifactId === openActionPlanPreviewId 
                                        ? { ...a, isDraft: false, committed: true, resourceId: resourceId || a.resourceId } 
                                        : a
                                );
                                emitBackgroundTutorTask(activeTask);
                            }
                            void refreshAcceptedActionPlanForReport(
                                selectedConversation?.reportId || report?.reportId || selectedReportId || null
                            );
                            // Do not close the modal automatically so they can see the success state
                        } else {
                            if (artifact) handleApproveDraft(artifact);
                            setOpenActionPlanPreviewId(null);
                        }
                    }}
                    onRevise={(note) => {
                        const artifact = agentArtifacts.find(a => a.artifactId === openActionPlanPreviewId);
                        if (artifact) handleReviseDraft(artifact, note);
                        setOpenActionPlanPreviewId(null);
                    }}
                />
            )}
            {profileModalOpen && token && (
                <ProfileSetupModal
                    token={token}
                    initialProfile={currentProfile}
                    onClose={() => setProfileModalOpen(false)}
                    onSaved={(profile) => {
                        setProfileExists(true);
                        if (profile) setCurrentProfile(profile);
                    }}
                />
            )}
            {/* ════════ Chat Column ════════ */}
            <div className="relative flex-1 flex min-h-0 flex-col min-w-0 h-full bg-[#f8fbff] dark:bg-lc-surface">
                {/* ── Chat Header ── */}
                <div className="relative z-40 shrink-0 bg-[#f8fbff]/80 dark:bg-lc-surface/80 backdrop-blur-[12px] px-8 py-5">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <button
                                onClick={() => router.back()}
                                className="h-8 w-8 flex items-center justify-center rounded-lg text-slate-500 dark:text-slate-400 hover:bg-white dark:hover:bg-lc-hover transition-colors"
                            >
                                <span className="material-symbols-outlined text-[20px]">arrow_back</span>
                            </button>
                            <img src="/girl_profile.png" alt="AI Tutor" className="h-8 w-8 md:h-11 md:w-11 rounded-full object-cover shrink-0 shadow-sm -mt-1" />
                            <div>
                                <h1 className="text-[20px] md:text-[28px] font-bold text-slate-900 dark:text-white font-nunito tracking-[-0.02em] leading-none mb-0.5">AI Tutor</h1>
                            </div>
                        </div>

                        <div className="flex items-center gap-1">
                            {/* Goals (Agent V2) */}
                            <button
                                onClick={() => setProfileModalOpen(true)}
                                className={`flex h-7 md:h-8 items-center gap-1 md:gap-1.5 rounded-full md:px-3 text-[10px] md:text-[12px] font-bold transition-colors ${
                                    profileExists
                                        ? "md:bg-primary/10 md:text-primary md:hover:bg-primary/15 text-slate-900 dark:text-white"
                                        : "md:bg-primary md:text-white md:shadow-[0_4px_14px_-4px_rgba(74,124,255,0.65)] md:hover:bg-primary-dark text-slate-900 dark:text-white"
                                }`}
                                title={profileExists ? "Update prep goals" : "Set your prep goals"}
                            >
                                <span className="material-symbols-outlined text-[20px] md:text-[15px]">target</span>
                                <span className="hidden md:inline">{profileExists ? "Goals" : "Set goals"}</span>
                            </button>

                            {/* New session */}
                            <button
                                onClick={() => createConversation()}
                                disabled={creatingConversation}
                                className="h-8 w-8 flex items-center justify-center rounded-lg text-slate-900 dark:text-white hover:bg-slate-100 dark:hover:bg-lc-hover transition-colors disabled:opacity-50"
                                title="New session"
                            >
                                <span className="material-symbols-outlined text-[20px]">add</span>
                            </button>

                            {/* Session history */}
                            <button
                                onClick={() => setHistoryModalOpen(true)}
                                className="h-8 w-8 flex items-center justify-center rounded-lg text-slate-900 dark:text-white hover:bg-slate-100 dark:hover:bg-lc-hover transition-colors"
                                title="Session history"
                            >
                                <span className="material-symbols-outlined text-[20px]">history</span>
                            </button>
                        </div>
                    </div>
                    {/* Gradient fade into message feed */}
                    <div className="absolute left-0 right-0 bottom-0 translate-y-full h-8 pointer-events-none bg-gradient-to-b from-[#f8fbff] dark:from-lc-surface to-transparent z-10" />
                </div>

                {/* ── Message Feed ── */}
                <div
                    ref={listRef}
                    className="relative z-0 min-h-0 flex-1 bg-[#f8fbff] dark:bg-lc-surface overflow-y-auto scrollbar-hide [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
                >
                    {/* Bottom fade */}
                    {!showWelcomePrompts && (
                        <div className="sticky bottom-0 left-0 right-0 h-8 pointer-events-none bg-gradient-to-t from-[#f8fbff] dark:from-lc-surface to-transparent z-10" />
                    )}
                    <div className={`${showWelcomePrompts ? "min-h-full max-w-[1120px]" : "max-w-[768px]"} mx-auto px-4 sm:px-6 ${showWelcomePrompts ? "pt-6 pb-6" : "pt-6 pb-24"} space-y-5`}>
                        {/* Removed inline bootstrap shimmer - using full page skeleton instead */}
                        {chatHistory.map((msg) => {
                            const isUser = msg.role === "user";
                            const timeLabel = msg.createdAt
                                ? new Date(msg.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
                                : null;
                            const artifactId = parseArtifactCardId(msg.content);
                            const artifact = artifactId
                                ? agentArtifacts.find((item) => item.artifactId === artifactId)
                                : null;

                            if (artifactId) {
                                if (!artifact) return null;
                                return (
                                    <div
                                        key={msg.id}
                                        className="chat-msg-enter"
                                        ref={(el) => {
                                            if (el) {
                                                artifactCardRefs.current.set(artifact.artifactId, el);
                                            } else {
                                                artifactCardRefs.current.delete(artifact.artifactId);
                                            }
                                        }}
                                    >
                                        <ArtifactCard
                                            artifact={artifact}
                                            onOpen={(id) => {
                                                void openAgentArtifact(id);
                                            }}
                                            onApprove={(a) => {
                                                void handleApproveDraft(a);
                                            }}
                                            onRevise={(a, note) => handleReviseDraft(a, note)}
                                            onAttemptQuiz={(a) => {
                                                setActiveQuizId(a.artifactId);
                                                setQuizAnswers({});
                                                setShowQuizResults(false);
                                                setCurrentQuestionIndex(0);
                                            }}
                                            quizAttempted={attemptedQuizzes.has(artifact.artifactId)}
                                            quizScore={quizScores[artifact.artifactId]}
                                            isApproving={approvingArtifactIds.has(artifact.artifactId)}
                                        />
                                    </div>
                                );
                            }

                            return (
                                <div key={msg.id} className={`group flex ${isUser ? "justify-end" : ""} chat-msg-enter`}>
                                    <div className={`flex flex-col ${isUser ? "items-end max-w-[85%] sm:max-w-[75%]" : "items-start w-full"}`}>
                                        <div
                                            className={`rounded-2xl px-4 py-3 text-[16px] font-medium leading-relaxed ${
                                                isUser
                                                    ? "bg-[#1c539a] text-white rounded-br-md"
                                                    : msg.kind === "question"
                                                        ? "border border-blue-200 bg-blue-50/50 text-slate-800 rounded-bl-md dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-slate-100"
                                                        : msg.kind === "feedback"
                                                            ? "border border-emerald-200 bg-emerald-50/50 text-slate-800 rounded-bl-md dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-slate-100"
                                                            : msg.kind === "nudge"
                                                                ? "border border-violet-200 bg-violet-50/50 text-slate-800 rounded-bl-md dark:border-violet-500/20 dark:bg-violet-500/10 dark:text-slate-100"
                                                                : "bg-slate-50 text-slate-700 rounded-bl-md dark:bg-lc-surface dark:text-slate-200"
                                            }`}
                                        >
                                            {!isUser && (
                                                <>
                                                    {msg.kind === "question" && (
                                                        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-blue-600 dark:text-blue-300">Practice Question</p>
                                                    )}
                                                    {msg.kind === "feedback" && (
                                                        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-600 dark:text-emerald-300">Feedback</p>
                                                    )}
                                                    {msg.kind === "nudge" && (
                                                        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-violet-600 dark:text-violet-300">Progress</p>
                                                    )}
                                                    {msg.kind === "question" && parseQuestionCardMeta(msg.content) && (
                                                        <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
                                                            Category: {toLabel(parseQuestionCardMeta(msg.content)!.category)}
                                                        </p>
                                                    )}
                                                    <MarkdownContent text={stripDisplayPrefix(msg.content)} />
                                                </>
                                            )}
                                            {isUser && stripDisplayPrefix(msg.content)}
                                        </div>
                                        {/* Timestamp — visible on hover */}
                                        {timeLabel && (
                                            <p className="mt-0.5 text-[10px] text-slate-400 dark:text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity duration-150 px-1">
                                                {timeLabel}
                                            </p>
                                        )}
                                    </div>
                                </div>
                            );
                        })}

                        {showWelcomePrompts && (
                            <WelcomeTutorPrompt
                                prompts={presetPrompts}
                                onSelect={sendMessage}
                                firstName={tutorFirstName}
                            />
                        )}

                        {/* Agent clarification cards — chips/inputs the user fills out inline */}
                        {agentClarifications.map((clarification) => (
                            <ClarificationCard
                                key={clarification.id}
                                clarification={clarification}
                                disabled={isSendingRef.current}
                                onSubmit={(id, answers) => handleSubmitClarification(id, answers)}
                            />
                        ))}

                        {/* Status indicator — displays dictionary words or the active tool label seamlessly */}
                        {avatarState === "ai-typing" && (streamingStatus || thinkingWords.length > 0) && (
                            <TypingIndicator status={streamingStatus} words={thinkingWords} />
                        )}
                    </div>
                </div>

                {/* ── Input Area ── */}
                <div className="shrink-0 bg-transparent px-4 pb-6 pt-2">
                    <div className="relative max-w-[760px] mx-auto">
                        {/* Error banner */}
                        {error && (
                            <div className="mb-3 flex items-center gap-2 rounded-xl bg-red-50 dark:bg-red-500/10 px-3 py-2.5 shadow-sm border border-red-100 dark:border-red-500/20">
                                <span className="material-symbols-outlined text-red-500 text-[18px]">warning</span>
                                <p className="text-xs font-semibold text-red-700 dark:text-red-300 flex-1">{error}</p>
                                <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 transition-colors">
                                    <span className="material-symbols-outlined text-[16px]">close</span>
                                </button>
                            </div>
                        )}

                        {/* Legacy action plan loading - completely disabled for Agent V2 */}

                        {/* BIG Avatar for new chat */}
                        <div className={`hidden sm:block absolute sm:-bottom-16 sm:-right-64 pointer-events-none transition-all duration-700 ease-[cubic-bezier(0.2,0.8,0.2,1)] origin-bottom z-10 ${(hasFirstUserMessage || historyLoading) ? 'opacity-0 scale-[0.98] translate-y-4' : 'opacity-100 scale-100 translate-y-0'}`}>
                            <img src="/girl.svg" alt="" className="h-[800px] w-auto object-contain drop-shadow-2xl" />
                        </div>

                        {/* Animated Input Container */}
                        <div className={`relative flex flex-col transition-all duration-700 ease-[cubic-bezier(0.2,0.8,0.2,1)] origin-left z-20 w-full ${hasFirstUserMessage ? '' : 'sm:w-[68%]'}`}>
                            <div className={!hasFirstUserMessage ? "sm:hidden" : ""}>
                                <TutorInputAvatar state={avatarState === "ai-typing" ? "typing" : "idle"} />
                            </div>
                            {/* Main input row */}
                            <div className="relative z-10 rounded-[32px] border border-transparent shadow-[0_8px_30px_rgb(0,0,0,0.06)] bg-white dark:border-lc-border dark:shadow-none dark:bg-lc-hover pl-2.5 pr-2.5 py-2.5 flex items-center w-full">
                                {/* + menu */}
                                <div className="relative shrink-0" ref={quickMenuRef}>
                                    <button
                                    onClick={() => setQuickMenuOpen((v) => !v)}
                                    className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-50/80 text-blue-600 hover:bg-blue-100 dark:bg-blue-500/10 dark:text-blue-400 transition-colors shadow-sm"
                                    title="Quick actions"
                                >
                                    <span className="material-symbols-outlined text-[24px]">add</span>
                                </button>

                                {quickMenuOpen && (
                                    <div className="absolute bottom-16 left-0 z-50 w-60 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl dark:border-lc-border dark:bg-lc-surface status-fade-enter">
                                        <p className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">Create New</p>

                                        <button
                                            className="w-full rounded-xl px-3 py-2.5 text-left text-[13px] font-semibold text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-lc-hover transition-colors flex items-center gap-3"
                                            onClick={() => {
                                                sendMessage("Create an action plan for me");
                                                setQuickMenuOpen(false);
                                            }}
                                        >
                                            <span className="material-symbols-outlined text-[18px] text-primary">flag</span>
                                            Action Plan
                                        </button>

                                        <button
                                            className="w-full rounded-xl px-3 py-2.5 text-left text-[13px] font-semibold text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-lc-hover transition-colors flex items-center gap-3"
                                            onClick={() => {
                                                sendMessage("Create a practice sheet for me");
                                                setQuickMenuOpen(false);
                                            }}
                                        >
                                            <span className="material-symbols-outlined text-[18px] text-primary">assignment</span>
                                            Practice Sheet
                                        </button>

                                        <button
                                            className="w-full rounded-xl px-3 py-2.5 text-left text-[13px] font-semibold text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-lc-hover transition-colors flex items-center gap-3"
                                            onClick={() => {
                                                sendMessage("Create a quiz for me");
                                                setQuickMenuOpen(false);
                                            }}
                                        >
                                            <span className="material-symbols-outlined text-[18px] text-primary">quiz</span>
                                            Quiz
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* Textarea */}
                            <textarea
                                ref={textareaRef}
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder="Ask me anything..."
                                rows={1}
                                className="textarea-auto-expand flex-1 bg-transparent text-[16px] font-medium text-slate-800 dark:text-slate-200 placeholder:text-slate-400 outline-none min-h-[24px] max-h-[120px] resize-none px-4 py-2 self-center border-none focus:ring-0"
                            />

                            {/* Stop / Send button */}
                            {sendingConversationId !== null ? (
                                <button
                                    onClick={() => {
                                        isSendingRef.current = false;
                                        setSendingConversationId(null);
                                    }}
                                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-red-200 text-red-400 hover:bg-red-300 dark:bg-red-400/40 dark:text-red-400 dark:hover:bg-red-400/60 transition-all duration-300 active:scale-95"
                                    title="Stop"
                                >
                                    <span className="material-symbols-outlined text-[24px]" style={{ fontVariationSettings: "'FILL' 1" }}>stop</span>
                                </button>
                            ) : (
                                <button
                                    disabled={!input.trim()}
                                    onClick={() => sendMessage(input)}
                                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-all duration-300 ${
                                        input.trim()
                                            ? "bg-[#1c539a] text-white hover:bg-[#184b8a] shadow-md shadow-[#1c539a]/30 active:scale-95"
                                            : "bg-slate-50 border border-slate-100 text-slate-300 dark:bg-lc-hover dark:border-lc-border dark:text-slate-500"
                                    } disabled:opacity-50`}
                                >
                                    <span className="material-symbols-outlined text-[20px] ml-0.5 mt-0.5" style={{ fontVariationSettings: input.trim() ? "'FILL' 1" : "'FILL' 0" }}>send</span>
                                </button>
                            )}
                        </div>

                        <p className="mt-1.5 text-center text-[10px] text-slate-400 dark:text-slate-500">
                            AI Tutor can make mistakes.
                        </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* ════════ Preview Panel ════════ */}
            {/* Legacy system only - disabled when Agent V2 is active */}
            {process.env.NEXT_PUBLIC_TUTOR_AGENT_V2 !== "true" && previewTab && previewTab !== "action-plan" && (
                <PreviewPanel
                    key={previewTab}
                    tab={previewTab}
                    onClose={() => setPreviewTab(null)}
                    report={report}
                    actionPlan={actionPlan}
                    questions={questions}
                    existingSheet={existingSheet}
                    acceptedActionPlan={acceptedActionPlan}
                    checkingSheet={checkingSheet}
                    acceptingSheet={generatingSheet}
                    acceptingActionPlan={acceptingActionPlan}
                    refreshingQuestions={refreshingQuestions}
                    onAcceptSheet={handleGenerateSheet}
                    onAcceptActionPlan={handleAcceptActionPlan}
                    onRegenerateQuestions={handleRegenerateQuestions}
                    onOpenSheet={(id) => router.push(`/sheets/${id}`)}
                    onPrefillChat={handlePrefillChat}
                    sortedRubric={sortedRubric}
                    actionPlanTimespan={actionPlanTimespan}
                />
            )}

            <ActionPlanModal
                open={process.env.NEXT_PUBLIC_TUTOR_AGENT_V2 !== "true" && previewTab === "action-plan"}
                onClose={() => setPreviewTab(null)}
                actionPlan={actionPlan}
                actionPlanTimespan={actionPlanTimespan}
                acceptedActionPlan={acceptedActionPlan}
                acceptingActionPlan={acceptingActionPlan}
                onAcceptActionPlan={handleAcceptActionPlan}
                onCustomizeWithAI={() => {
                    setCustomizeTimespan(actionPlanTimespan);
                    setCustomizePlanOpen(true);
                }}
                onPrefillChat={handlePrefillChat}
            />

            {customizePlanOpen && (
                <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-900/45 px-4" onClick={() => setCustomizePlanOpen(false)}>
                    <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-lc-border dark:bg-lc-surface" onClick={(e) => e.stopPropagation()}>
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white font-nunito">Customize Action Plan with AI</h3>
                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Tell AI exactly how you want this plan adjusted. Your note will be applied during regeneration.</p>

                        <div className="mt-4">
                            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">Timeline</p>
                            <div className="grid grid-cols-3 gap-2">
                                {(["1_week", "2_weeks", "monthly"] as ActionPlanTimespan[]).map((key) => (
                                    <button
                                        key={key}
                                        onClick={() => setCustomizeTimespan(key)}
                                        className={`rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${customizeTimespan === key ? "border-primary bg-primary/10 text-primary" : "border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-lc-border dark:text-slate-300"}`}
                                    >
                                        {actionPlanTimespanLabel(key)}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="mt-4">
                            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">Customization Note</p>
                            <textarea
                                value={customizePlanInput}
                                onChange={(e) => setCustomizePlanInput(e.target.value)}
                                placeholder="Example: Focus 70% on OS and CN, keep coding light, and prioritize medium-level questions for this week."
                                rows={5}
                                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-hover dark:text-slate-200"
                            />
                        </div>

                        <div className="mt-4 flex items-center gap-2">
                            <button
                                onClick={() => setCustomizePlanOpen(false)}
                                className="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-lc-border dark:text-slate-200 dark:hover:bg-lc-hover"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => generateActionPlanForTimespan(customizeTimespan, customizePlanInput.trim())}
                                disabled={!customizePlanInput.trim() || generatingActionPlan}
                                className="flex-1 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
                            >
                                {generatingActionPlan ? "Loading your action plan..." : "Apply Customization"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {actionPlanPickerOpen && (
                <div className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-900/40 px-4" onClick={() => setActionPlanPickerOpen(false)}>
                    <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-lc-border dark:bg-lc-surface" onClick={(e) => e.stopPropagation()}>
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white font-nunito">Choose Action Plan Duration</h3>
                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Pick a timeline so the action plan is generated with that pacing.</p>
                        <div className="mt-4 space-y-2">
                            {generatingActionPlan && (
                                <div className="mb-1 flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
                                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
                                    <p className="text-xs font-medium text-primary">Generating your action plan...</p>
                                </div>
                            )}
                            {([
                                { key: "1_week", title: "1 Week", subtitle: "Fast and focused" },
                                { key: "2_weeks", title: "2 Weeks", subtitle: "Balanced progression" },
                                { key: "monthly", title: "Monthly", subtitle: "4-week structured roadmap" },
                            ] as Array<{ key: ActionPlanTimespan; title: string; subtitle: string }>).map((opt) => (
                                <button
                                    key={opt.key}
                                    onClick={() => generateActionPlanForTimespan(opt.key)}
                                    disabled={generatingActionPlan}
                                    className="w-full rounded-xl border border-slate-200 px-4 py-3 text-left hover:border-primary/40 hover:bg-primary/5 transition-colors dark:border-lc-border dark:hover:border-primary/40 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <p className="text-sm font-semibold text-slate-800 dark:text-white">{opt.title}</p>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">{opt.subtitle}</p>
                                </button>
                            ))}
                        </div>
                        <button
                            onClick={() => setActionPlanPickerOpen(false)}
                            className="mt-4 w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-lc-border dark:text-slate-200 dark:hover:bg-lc-hover"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {/* Quiz Modal */}
            {activeQuizId && (
                <QuizModal
                    quizId={activeQuizId}
                    token={token ?? null}
                    agentArtifacts={agentArtifacts}
                    quizAnswers={quizAnswers}
                    setQuizAnswers={setQuizAnswers}
                    showQuizResults={showQuizResults}
                    setShowQuizResults={setShowQuizResults}
                    currentQuestionIndex={currentQuestionIndex}
                    setCurrentQuestionIndex={setCurrentQuestionIndex}
                    onComplete={(score) => {
                        setAttemptedQuizzes((prev) => new Set(prev).add(activeQuizId));
                        setQuizScores((prev) => ({ ...prev, [activeQuizId]: score }));
                    }}
                    onSave={() => {
                        const artifact = agentArtifacts.find((item) => item.artifactId === activeQuizId);
                        if (artifact) {
                            void handleApproveDraft(artifact);
                        }
                        setActiveQuizId(null);
                        setQuizAnswers({});
                        setShowQuizResults(false);
                        setCurrentQuestionIndex(0);
                    }}
                    onClose={() => {
                        // Mark quiz as attempted if results were shown
                        if (showQuizResults) {
                            setAttemptedQuizzes(prev => new Set(prev).add(activeQuizId));
                        }
                        setActiveQuizId(null);
                        setQuizAnswers({});
                        setShowQuizResults(false);
                        setCurrentQuestionIndex(0);
                    }}
                />
            )}
        </div>
    );
}
