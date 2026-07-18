import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { InterviewStage, InterviewType } from "@interviewforge/shared";

export interface PrefetchedTheoryQuestion {
    questionId: string;
    questionText: string;
    referenceAnswer: string;
}

export interface PrefetchedBehaviouralQuestion {
    questionId: string;
    questionText: string;
    referenceAnswer: string;
    category: string;
}

export type ResumeProbeDepth =
    | "overview"
    | "motivation"
    | "ownership"
    | "implementation"
    | "tradeoffs"
    | "failure_depth"
    | "senior_depth";

export type ResumeProbeAnswerQuality = "weak" | "partial" | "strong" | "declined";

export type ResumeAgendaItemType =
    | "project"
    | "experience"
    | "responsibility"
    | "education"
    | "skill"
    | "risk"
    | "fit";

export type ResumeAgendaItemStatus =
    | "unasked"
    | "active"
    | "covered"
    | "declined"
    | "saturated"
    | "unverified";

export type ResumeAgendaQuestionIntent =
    | "overview"
    | "motivation"
    | "ownership"
    | "implementation"
    | "tradeoff"
    | "failure"
    | "impact"
    | "skill_usage"
    | "fit";

export interface ResumeAgendaItem {
    id: string;
    type: ResumeAgendaItemType;
    label: string;
    summary: string;
    evidence?: string[];
    priority: number;
    mode?: "deep" | "rapid";
    status: ResumeAgendaItemStatus;
    askedIntents: ResumeAgendaQuestionIntent[];
    turnCount: number;
    weakCount: number;
    componentCounts?: Record<string, number>;
}

export interface ResumeAgendaState {
    items: ResumeAgendaItem[];
    activeItemId?: string;
    closedItemIds: string[];
    currentIntent?: ResumeAgendaQuestionIntent;
    turnsOnItem: number;
    turnsOnComponent: Record<string, number>;
}

export interface ResumeProbeState {
    activeProjectName?: string;
    currentDepth: ResumeProbeDepth;
    lastAnswerQuality?: ResumeProbeAnswerQuality;
    lastAskedProjectName?: string;
    lastAskedDepth?: ResumeProbeDepth;
    consecutiveWeakAnswers: number;
    completedDepths: ResumeProbeDepth[];
    askedProbeKeys?: string[];
    saturatedProjects?: string[];
}

export interface SharedInterviewTurnState {
    sessionId: string;
    userId: string;
    interviewType: InterviewType;
    currentStage: InterviewStage;
    stageOrder: InterviewStage[];
    moduleConfig?: any;
    askedQuestionIds: string[];
    role: string;
    level: string;
    currentQuestionTitle: string | null;
    lastFetchedQuestionId: string | null;
    lastFetchedLanguage: string | null;
    prefetchedDSAQuestion: any | null;
    cachedQuestionData: Map<string, any>;
    history: ChatCompletionMessageParam[];
    scratchpadOpened?: boolean;
    systemDesignExchangeCount: number;
    codeSnapshot?: string | null;
    codeLanguage?: string | null;
    sqlSnapshot?: string | null;
    sqlQuestionDescription?: string | null;
    sqlRoundCompleted?: boolean;
    canvasSnapshot?: any;
    notepadSnapshot?: string | null;
    prefetchedCSQuestions?: Map<string, PrefetchedTheoryQuestion[]>;
    prefetchedBehavioralQuestions?: PrefetchedBehaviouralQuestion[];
    prefetchedSDQuestion?: { id: string; title: string; problemStatement: string } | null;
    /** Explicit tracking of the current sub-phase within CS Fundamentals.
     *  Order: DBMS → SQL → OS → CN → OOPS */
    currentFundamentalsPhase?: string;
    /** Explicit tracking of resume/project probing depth during INTRO stages. */
    resumeProbeState?: ResumeProbeState;
    /** Server-owned agenda for standalone resume screening. */
    resumeAgendaState?: ResumeAgendaState;
    /** One-time guard for xAI Live Search/Web Search during resume-heavy INTRO. */
    resumeWebSearchUsed?: boolean;
}

export interface TurnOrchestrationAdapter {
    mode: "text" | "voice";
    emitToken: (messageId: string, token: string) => void;
    emitDone: (messageId: string, fullContent: string) => void;
    emitSessionEvent: (event: string, payload: any) => void;
}
