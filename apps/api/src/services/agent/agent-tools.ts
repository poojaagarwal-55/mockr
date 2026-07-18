// ============================================
// AI Interview Agent — Tool Definitions
// ============================================
// OpenAI-compatible tool declarations for xAI Grok.
// These use the ChatCompletionTool format with
// JSON Schema parameters. The orchestrator calls
// `getToolsForSession()` to get the filtered list.

import type { ChatCompletionTool } from "openai/resources/chat/completions";
import type { InterviewStage, InterviewType } from "@interviewforge/shared";
import { getInterviewTypeConfig } from "./interview-types/index.js";
import type { ResumeAgendaState, ResumeProbeState } from "./interview-runtime-types.js";
import type { ScreeningPhaseType } from "../company-ai-screening/blueprint.js";

export interface ToolContext {
    sessionId: string;
    userId: string;
    interviewType: InterviewType;
    currentStage: InterviewStage;
    askedQuestionIds: string[];
    role: string;
    level: string;
    /** Ordered stages for this interview type (from config) */
    stageOrder: InterviewStage[];
    /** Optional raw module config used for runtime policy checks. */
    moduleConfig?: any;
    /** Optional resume summary used for resume/project coverage checks. */
    resumeSummary?: any | null;
    /** Wall-clock start for current stage, when available. */
    stageStartedAtMs?: number;
    /** Last question fetched via fetch_question (for open_ide fallback) */
    lastFetchedQuestionId: string | null;
    /** Last language used in open_ide (for fallback when LLM omits it) */
    lastFetchedLanguage: string | null;
    /** Pre-fetched DSA question (loaded at session init for instant IDE opening) */
    prefetchedDSAQuestion: any | null;
    /** Cached full question data from fetch_question (avoids redundant DB query in open_ide) */
    cachedQuestionData: Map<string, any>;
    /** Optional: called when rubricLite is loaded from MongoDB (system design) */
    onRubricLiteLoaded?: (rubricLite: any) => void;
    /** Optional: called when the SQL editor panel is opened — used to start inactivity/timeout timers */
    onSQLEditorOpened?: () => void;
    /** Optional: called when the SQL editor panel is closed — used to clear SQL timers immediately */
    onSQLPanelClosed?: () => void;
    /** Optional: called when the DSA IDE panel is opened — used to start coding timers */
    onDSAEditorOpened?: () => void;
    /** Optional: called when the DSA IDE panel is closed — used to clear coding timers */
    onDSAPanelClosed?: () => void;
    onProblemSolvingNotepadOpened?: () => void;
    /** Whether the scratchpad has been opened in this session (system design gate) */
    scratchpadOpened?: boolean;
    /** Number of user exchanges in SYSTEM_DESIGN stage (for minimum stay enforcement) */
    systemDesignExchangeCount?: number;
    /** Number of user exchanges in INTRO stage (for server-owned intro caps) */
    introExchangeCount?: number;
    /** Pre-fetched CS Fundamental questions organized by category (for cs_fundamentals interview type) */
    prefetchedCSQuestions?: Map<string, Array<{questionId: string; questionText: string; referenceAnswer: string}>>;
    /** Pre-fetched behavioural question bank (for behavioural interview type) */
    prefetchedBehavioralQuestions?: Array<{ questionId: string; questionText: string; referenceAnswer: string; category: string }>;
    /** Pre-fetched System Design question (for system_design interview type) */
    prefetchedSDQuestion?: { id: string; title: string; problemStatement: string } | null;
    /** Current resume/project probing ladder state. */
    resumeProbeState?: ResumeProbeState;
    /** Called when the model evaluates a resume/project answer. */
    onResumeProbeRecorded?: (state: ResumeProbeState) => void;
    /** Current server-owned resume screening agenda. */
    resumeAgendaState?: ResumeAgendaState;
    /** Called when the model evaluates a server-owned resume agenda item. */
    onResumeAgendaRecorded?: (state: ResumeAgendaState) => void;
    /** Server-only: true after a resume-screening candidate has answered the closeout prompt. */
    resumeCloseoutAcknowledged?: boolean;
    /** Server-only: allow a deterministic hard-cap transition out of an intro stage. */
    forceIntroExit?: boolean;
    /** Pre-fetched GenAI concept questions (for gen_ai_role interview type) */
    prefetchedGenAIConceptQuestions?: Array<{
        questionId: string;
        subtopic: string;
        questionText: string;
        /** Concise reference answer — LLM evaluation only, never revealed */
        referenceAnswer: string;
        // detailedAnswer intentionally absent — post-session reports only
        difficulty: string;
    }>;
    /** Pre-fetched GenAI coding task (for gen_ai_role interview type) */
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
    /** Pre-fetched GenAI system design problem (for gen_ai_role interview type) */
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
    /** Pre-fetched DS concept questions (for data_science_role interview type) */
    prefetchedDSConceptQuestions?: Array<{
        questionId: string;
        topic: string;
        category: string;
        difficulty: string;
        question: string;
        referenceAnswer: string;
        followUpChain?: string[];
        redFlags?: string[];
    }>;
    /** Pre-fetched DS SQL question — sourced from shared sql_questions collection */
    prefetchedDSSQLQuestion?: {
        questionId: string;
        title: string;
        description: string;
        schema: string;
        examples: { input: any; output: any; explanation?: string }[];
        testCases: { id: number | string; label: string; input: any; expected_output: any }[];
        hiddenTestCases: { id: string; label: string; expected_output: any; wrapper_code: string }[];
        solution: string;
        judge0LanguageId: number;
        wrapperCode: string;
    } | null;
    /** Pre-fetched DS coding task (for data_science_role interview type) */
    prefetchedDSCodingQuestion?: {
        questionId: string;
        title: string;
        difficulty: string;
        category: string;
        tags: string[];
        description: string;
        datasetUrl: string;
        starterCode: string;
        hiddenCodeBefore: string;
        hiddenCodeAfter: string;
        solution: string;
        conciseSolution?: string;
        sampleTestCases: Array<{ id: string; description: string; input: string; output: string }>;
        hiddenTestCases: any[];
        hints: string[];
        probingQuestions: string[];
        interviewNotes?: string;
        timeLimit: number;
        memoryLimit: number;
        metadata: any;
    } | null;
    // ── Product Manager Role prefetch fields ───────────────────
    /** Pre-fetched PM case question (for pm_role interview type) */
    prefetchedPMCaseQuestion?: {
        questionId: string;
        title: string;
        scenario: string;
        constraintInjection: string;
        evaluationGuide: string;
        redFlags: string[];
        successSignals: string[];
        difficulty: string;
    } | null;
    /** Pre-fetched PM concept questions (for pm_role interview type) */
    prefetchedPMConceptQuestions?: Array<{
        questionId: string;
        subtopic: string;
        question: string;
        scenarioContext?: string;
        evaluationGuide: string;
        redFlags: string[];
        successSignals: string[];
        difficulty: string;
    }>;
    /** Pre-fetched PM strategy question (for pm_role interview type) */
    prefetchedPMStrategyQuestion?: {
        questionId: string;
        title: string;
        scenario: string;
        devilsAdvocateProbes: string[];
        evaluationGuide: string;
        redFlags: string[];
        successSignals: string[];
        difficulty: string;
    } | null;
    /** Pre-fetched analytical case (for problem_solving_case interview type) */
    prefetchedProblemSolvingCaseQuestion?: {
        questionId: string;
        title: string;
        caseType: string;
        difficulty: string;
        prompt: string;
        candidateInstructions: string;
        assumptions: string[];
        decompositionPrompts: string[];
        hintLadder: string[];
        followUps: string[];
        twist: { prompt: string; expectedAdaptation: string };
        convictionProbes: string[];
        referenceSolution: string;
        evaluationGuide: string;
        redFlags: string[];
        successSignals: string[];
    } | null;
    /** Company screening blueprint (set only for company_screening sessions). */
    companyScreeningBlueprint?: import("../company-ai-screening/blueprint.js").ScreeningBlueprint | null;
    /** Called when the screening interviewer reaches a configured question (tags transcript + pacing). */
    onScreeningQuestionAsked?: (screeningQuestionId: string, bankQuestionId?: string | null) => void;
    /** Server-assigned current screening question id; tool gating rejects mismatched record/workspace calls. */
    companyScreeningCurrentQuestionId?: string | null;
    /** Server-resolved phase TYPE for the current screening question; drives the phase-scoped tool whitelist. */
    companyScreeningCurrentPhaseType?: ScreeningPhaseType | null;
    emit: (event: string, payload: any) => void;
}

/** Master list of ALL tools the interviewer agent can ever call. */
export const ALL_TOOL_DECLARATIONS: ChatCompletionTool[] = [
    {
        type: "function",
        function: {
            name: "fetch_question",
            description:
                "Fetch a question from the question bank. Categories: DSA, SQL, DBMS, SystemDesign, OS, OOP, Networking, Behavioral. Difficulties: Easy, Medium, Hard.",
            parameters: {
                type: "object",
                properties: {
                    category: {
                        type: "string",
                        description: "The question category",
                    },
                    difficulty: {
                        type: "string",
                        description: "The difficulty level",
                    },
                },
                required: ["category", "difficulty"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "open_ide",
            description: "Open the code editor with a question loaded.",
            parameters: {
                type: "object",
                properties: {
                    questionId: {
                        type: "string",
                        description: "The ID of the question to load",
                    },
                    language: {
                        type: "string",
                        description: "Programming language",
                    },
                },
                required: ["questionId", "language"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "open_sql_editor",
            description: "Open the SQL editor for database questions. No parameters needed; the backend automatically loads the server-prefetched SQL question, schema, examples, and tests.",
            parameters: {
                type: "object",
                properties: {},
                required: [],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "open_scratchpad",
            description:
                "Open the scratchpad for system design or written explanations.",
            parameters: {
                type: "object",
                properties: {
                    topic: {
                        type: "string",
                        description: "The topic for the scratchpad",
                    },
                    initialContent: {
                        type: "string",
                        description: "Initial content to populate",
                    },
                },
                required: ["topic", "initialContent"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "open_notepad",
            description:
                "Open a Tiptap rich text notepad panel for the candidate. Use this for PM interviews — it is NOT the Excalidraw scratchpad. Supports a pre-populated CIRCLES template for product case rounds.",
            parameters: {
                type: "object",
                properties: {
                    topic: {
                        type: "string",
                        description: "The topic or context for the notepad (e.g. 'Product Case')",
                    },
                    template: {
                        type: "string",
                        enum: ["CIRCLES", "blank"],
                        description: "Template to pre-populate: 'CIRCLES' for the CIRCLES framework template, 'blank' for an empty notepad",
                    },
                    scenario: {
                        type: "string",
                        description: "The exact pre-fetched PM case scenario/problem text to show in the notepad left panel.",
                    },
                },
                required: ["topic", "template"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "close_panel",
            description: "Close the current IDE/SQL/scratchpad panel.",
            parameters: {
                type: "object",
                properties: {
                    summary: {
                        type: "string",
                        description: "Summary of what was accomplished",
                    },
                },
                required: ["summary"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "run_candidate_code",
            description: "Execute the candidate's code against test cases.",
            parameters: {
                type: "object",
                properties: {
                    language: {
                        type: "string",
                        description: "Programming language of the code",
                    },
                    code: {
                        type: "string",
                        description: "The code to execute",
                    },
                    questionId: {
                        type: "string",
                        description: "The question ID",
                    },
                },
                required: ["language", "code", "questionId"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "give_hint",
            description: "Give a hint for the current question. Max 3 per question.",
            parameters: {
                type: "object",
                properties: {
                    questionId: {
                        type: "string",
                        description: "The question ID",
                    },
                    hintNumber: {
                        type: "integer",
                        description: "Hint number, 1-3",
                    },
                },
                required: ["questionId", "hintNumber"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "transition_stage",
            description:
                "Move the interview to the next stage. Only valid stages for this interview type are accepted.",
            parameters: {
                type: "object",
                properties: {
                    nextStage: {
                        type: "string",
                        description: "The next stage name",
                    },
                    reason: {
                        type: "string",
                        description: "Why the transition is happening",
                    },
                },
                required: ["nextStage", "reason"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "end_interview",
            description: "End the interview session with a closing message.",
            parameters: {
                type: "object",
                properties: {
                    summary: {
                        type: "string",
                        description: "Brief summary of the interview",
                    },
                },
                required: ["summary"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "record_question",
            description:
                "MANDATORY: Call this silently before presenting any QUESTION BANK theory question (DBMS/OS/CN/OOPS). Pass the questionFundamentalId, questionTitle, and referenceAnswer from the QUESTION BANK entry. This is a silent bookkeeping call — do NOT mention it to the candidate. Call it in the SAME response turn where you ask the question.",
            parameters: {
                type: "object",
                properties: {
                    questionFundamentalId: {
                        type: "string",
                        description: "The MongoDB _id of the question from the QUESTION BANK",
                    },
                    questionTitle: {
                        type: "string",
                        description: "The question text from the QUESTION BANK (first 500 chars)",
                    },
                    referenceAnswer: {
                        type: ["string", "null"],
                        description: "The referenceAnswer from the QUESTION BANK entry",
                    },
                },
                required: ["questionFundamentalId", "questionTitle"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "record_resume_probe",
            description:
                "MANDATORY in resume/project stages: silently record the evaluated depth, agenda item, and answer quality for the candidate's latest resume answer before asking the next question. The server uses this to prevent loops, over-depth, and returning to closed resume items.",
            parameters: {
                type: "object",
                properties: {
                    projectName: {
                        type: "string",
                        description: "The exact project/company/resume item being discussed, if known.",
                    },
                    agendaItemId: {
                        type: "string",
                        description: "The active agenda item id from Server-Owned Resume Agenda, when present.",
                    },
                    depth: {
                        type: "string",
                        enum: ["overview", "motivation", "ownership", "implementation", "tradeoffs", "failure_depth", "senior_depth"],
                        description: "The resume ladder depth just evaluated. In PM intros, map implementation to product execution/discovery/rollout/instrumentation, not code architecture.",
                    },
                    intent: {
                        type: "string",
                        enum: ["overview", "motivation", "ownership", "implementation", "tradeoff", "failure", "impact", "skill_usage", "fit"],
                        description: "The agenda question intent just evaluated.",
                    },
                    answerQuality: {
                        type: "string",
                        enum: ["weak", "partial", "strong", "declined"],
                        description: "Quality of the candidate's latest answer. Use strong only for concrete, specific answers.",
                    },
                    evidence: {
                        type: "string",
                        description: "Brief reason for the quality judgment. For PM answers, include product evidence such as decision scope, metric, tradeoff, stakeholder conflict, launch outcome, or retrospective. Never include sensitive resume content beyond a short paraphrase.",
                    },
                    shouldCloseItem: {
                        type: "boolean",
                        description: "Set true when the active resume agenda item should be closed or the candidate declined it.",
                    },
                    componentKey: {
                        type: "string",
                        description: "Optional tiny component being probed, such as websocket-audio or chunking, so the server can cap repeated follow-ups.",
                    },
                },
                required: ["depth", "answerQuality", "evidence"],
            },
        },
    },
    // ── Company AI screening tools (only exposed for company_screening sessions) ──
    {
        type: "function",
        function: {
            name: "record_screening_question",
            description:
                "Company screening only. Call this right before you ask each configured screening question, passing its agenda id (e.g. q1). It tags the transcript so the recruiter report can map evidence to the question.",
            parameters: {
                type: "object",
                properties: {
                    questionId: {
                        type: "string",
                        description: "The configured screening question id from the agenda (e.g. q1).",
                    },
                },
                required: ["questionId"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "open_screening_workspace",
            description:
                "Company screening only. Open the coding IDE or SQL editor for a configured coding/cs_sql screening question, passing its agenda id (e.g. q2). The backend loads the recruiter-attached question, opens the right editor, and tags the question. Use this instead of record_screening_question for coding/SQL questions.",
            parameters: {
                type: "object",
                properties: {
                    questionId: {
                        type: "string",
                        description: "The configured screening question id from the agenda (e.g. q2).",
                    },
                },
                required: ["questionId"],
            },
        },
    },
];

// Build a lookup map for quick filtering
const TOOL_MAP = new Map<string, ChatCompletionTool>();
for (const t of ALL_TOOL_DECLARATIONS) {
    if (t.type === "function") {
        TOOL_MAP.set(t.function.name, t);
    }
}

/**
 * Get the tool declarations available for the current session state.
 * Filters the master tool list based on the interview type config
 * and the current stage. Also merges any additional type-specific tools.
 */
export type CompanyScreeningToolOptions = {
    /** True for company_screening sessions; exposes the screening tool set. */
    companyScreening?: boolean;
    /** True when the blueprint references coding/SQL bank questions (adds IDE + run tools). */
    companyScreeningHasBankQuestions?: boolean;
    /**
     * Server-resolved phase TYPE for the current screening question. When set, the
     * screening tool set is scoped to THIS phase only (coding -> IDE, system_design
     * -> scratchpad, behavioral -> notepad). null/undefined during intro/pre-agenda
     * exposes only the base set (no workspace/scratchpad/notepad).
     */
    companyScreeningCurrentPhaseType?: ScreeningPhaseType | null;
};

/**
 * The tools a company screening session can use in the CURRENT phase. Scoped to
 * the phase type so each phase exposes only its own workspace tool — this is the
 * server-enforced anti-hallucination guard (no coding IDE during a CS phase, no
 * scratchpad during coding, etc.). Appended ONLY for company_screening sessions
 * so practice behavioural interviews never see them. `validateToolCallSequence`
 * mirrors this allow-list, so the same set both advertises and gates the tools.
 */
export function screeningToolNamesForPhase(
    phaseType: ScreeningPhaseType | null | undefined,
    isClosing: boolean
): string[] {
    if (isClosing) return ["end_interview"];
    // Always available: tag the question, transition stage. Each phase gets its
    // practice-module counterpart's workspace tool, with these deliberate
    // differences from practice:
    //   - open_ide / open_sql_editor      -> open_screening_workspace
    //   - record_question                 -> record_screening_question (always-on)
    //   - run_candidate_code              -> the in-room IDE runs via REST /ide/run|sql/run
    //   - record_resume_probe             -> handled by the server pacing/enforce loop
    //   - give_hint                       -> EXCLUDED: a screening is a pure evaluation,
    //                                        not coaching. No phase exposes hints, so the
    //                                        per-dimension signal stays unaided/comparable.
    //   - end_interview                   -> EXCLUDED from active phases: the SERVER owns
    //                                        when the round ends (pacing pointer). It is
    //                                        only exposed once the server forces CLOSING
    //                                        (the isClosing branch above), so the model
    //                                        can't end early after a few skipped questions.
    const names = ["record_screening_question", "transition_stage"];
    switch (phaseType) {
        // IDE / SQL editor workspace phases.
        case "coding":
        case "cs_sql":
        case "ds_sql":
        case "ds_coding":
        case "genai_coding":
        case "frontend_coding":
            names.push("open_screening_workspace", "close_panel");
            break;
        // Diagramming whiteboard phases.
        case "system_design":
        case "genai_system_design":
            names.push("open_scratchpad", "close_panel");
            break;
        // Notepad-backed case / behavioral phases.
        case "behavioral":
        case "custom":
        case "pm_case":
        case "problem_solving":
            names.push("open_notepad", "close_panel");
            break;
        // Conversational phases (resume, concept/theory/strategy Q&A): base set only.
        // resume_project, cs_theory, ds_concepts, genai_concepts, pm_concepts, pm_strategy,
        // and the null/intro case fall through with no workspace tool.
    }
    return names;
}

export function getToolsForSession(
    interviewType: InterviewType,
    currentStage: InterviewStage,
    stageOrder?: InterviewStage[],
    options?: CompanyScreeningToolOptions
): ChatCompletionTool[] {
    const config = getInterviewTypeConfig(interviewType);

    if (stageOrder && stageOrder.length > 0 && !stageOrder.includes(currentStage)) {
        return [];
    }

    // Get tool names allowed in this stage
    const allowedToolNames = config.stageTools[currentStage];

    const appendScreeningTools = (tools: ChatCompletionTool[]): ChatCompletionTool[] => {
        if (!options?.companyScreening) return tools;
        const isClosing = currentStage === "CLOSING";
        const present = new Set(tools.map((t) => (t.type === "function" ? t.function.name : "")));
        for (const name of screeningToolNamesForPhase(options.companyScreeningCurrentPhaseType, isClosing)) {
            if (present.has(name)) continue;
            const tool = TOOL_MAP.get(name);
            if (tool) tools.push(tool);
        }
        return tools;
    };

    // If no stage-specific restriction, return all tools
    if (!allowedToolNames) {
        return appendScreeningTools([...ALL_TOOL_DECLARATIONS, ...(config.additionalTools || [])]);
    }

    // Filter master tools + merge additional type-specific tools
    const filtered = allowedToolNames
        .map(name => TOOL_MAP.get(name))
        .filter((t): t is ChatCompletionTool => t != null);

    // For company screening the server owns when the round ends, so end_interview
    // is exposed ONLY in CLOSING (via appendScreeningTools' isClosing branch) — never
    // auto-added here just because the active phase is the final configured stage.
    const isFinalEnabledStage = !!stageOrder?.length && currentStage === stageOrder[stageOrder.length - 1];
    if (isFinalEnabledStage && !allowedToolNames.includes("end_interview") && !options?.companyScreening) {
        const endInterviewTool = TOOL_MAP.get("end_interview");
        if (endInterviewTool) filtered.push(endInterviewTool);
    }

    if (config.additionalTools) {
        filtered.push(...config.additionalTools);
    }

    return appendScreeningTools(filtered);
}

