import assert from "node:assert/strict";
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { getAllInterviewTypeConfigs, getInterviewTypeConfig } from "./interview-types/index.js";
import { getToolsForSession } from "./agent-tools.js";
import { buildSystemPrompt, buildVoiceContextUpdate, buildVoiceDirectives } from "./agent-prompts.js";
import { validateEndInterview, validateStageTransition } from "./interview-state-machine.js";
import { handleToolCall } from "./tool-handlers.js";
import type { ToolContext } from "./agent-tools.js";
import { isClosingAcknowledgement, isCloseoutQuestion, isEndInterviewIntent } from "../interview-end-intent.js";
import { isDsaAdvanceIntent } from "../interview-progress-intent.js";
import {
    isFundamentalsToSqlIntent,
    hasRecentRepeatedAssistantQuestion,
    isIntroToDsaAdvanceIntent,
    isLikelyFundamentalsHandoffPrompt,
    isLikelyCodingRoundPrompt,
    isLikelySqlRoundPrompt,
    hasRecentSqlRoundSignals,
    isGenericMoveOnIntent,
    isSqlAdvanceIntent,
    isUnknownResponseIntent,
} from "../interview-turn-guard.js";
import { splitToolCallsByAvailability } from "./tool-call-sanitizer.js";
import { InterviewModulesValidator } from "./interview-modules-validator.js";
import { validatePrefetchState } from "./prefetch-state-validator.js";
import { getNextEnabledStage, resolveEffectiveInterviewTypeConfig } from "./interview-module-selection.js";
import { inferResumeProbeDepthFromQuestion } from "./resume-probe-state.js";
import {
    createInitialResumeAgendaState,
    declineActiveResumeAgendaItem,
    getActiveResumeAgendaItem,
    getResumeAgendaItemTurnLimit,
    updateResumeAgendaAfterProbe,
} from "./resume-agenda-state.js";

function getToolNames(tools: ChatCompletionTool[]): string[] {
    return tools
        .filter((tool) => tool.type === "function")
        .map((tool) => tool.function.name);
}

function assertContainsAll(source: string[], required: string[], message: string): void {
    for (const item of required) {
        assert(source.includes(item), `${message}. Missing: ${item}`);
    }
}

function makePromptContext(overrides: Record<string, any> = {}): any {
    return {
        interviewType: "full_interview",
        role: "Software Engineer",
        level: "SDE2",
        stage: "INTRO",
        resumeSummary: null,
        currentQuestionTitle: null,
        codeSnapshot: null,
        codeLanguage: null,
        sqlSnapshot: null,
        sqlQuestionDescription: null,
        sqlRoundCompleted: false,
        rubricLite: null,
        canvasSnapshot: null,
        prefetchedCSQuestions: new Map(),
        prefetchedSDQuestion: null,
        prefetchedDSAQuestion: null,
        ...overrides,
    };
}

function makeToolContext(overrides: Partial<ToolContext> = {}): ToolContext {
    return {
        sessionId: "session_test_flow",
        userId: "user_test_flow",
        interviewType: "full_interview" as any,
        currentStage: "INTRO" as any,
        askedQuestionIds: [],
        role: "Software Engineer",
        level: "SDE2",
        stageOrder: ["INTRO", "DSA", "FUNDAMENTALS", "CLOSING"] as any,
        lastFetchedQuestionId: null,
        lastFetchedLanguage: null,
        prefetchedDSAQuestion: null,
        cachedQuestionData: new Map<string, any>(),
        emit: () => {
            // no-op
        },
        ...overrides,
    };
}

function testInterviewStageOrders(): void {
    assert.deepEqual(getInterviewTypeConfig("full_interview" as any).stages, ["INTRO", "DSA", "FUNDAMENTALS", "CLOSING"]);
    assert.deepEqual(getInterviewTypeConfig("coding" as any).stages, ["DSA"]);
    assert.deepEqual(getInterviewTypeConfig("cs_fundamentals" as any).stages, ["INTRO", "FUNDAMENTALS", "CLOSING"]);
    assert.deepEqual(getInterviewTypeConfig("system_design" as any).stages, ["INTRO", "SYSTEM_DESIGN", "CLOSING"]);
    assert.deepEqual(getInterviewTypeConfig("behavioural" as any).stages, ["INTRO", "BEHAVIOURAL", "CLOSING"]);
}

function testToolContractsByInterviewType(): void {
    const fullIntroTools = getToolNames(getToolsForSession("full_interview" as any, "INTRO" as any));
    const fullDSATools = getToolNames(getToolsForSession("full_interview" as any, "DSA" as any));
    const fullFundamentalsTools = getToolNames(getToolsForSession("full_interview" as any, "FUNDAMENTALS" as any));
    const fullClosingTools = getToolNames(getToolsForSession("full_interview" as any, "CLOSING" as any));

    assert.deepEqual(fullIntroTools, ["record_resume_probe", "transition_stage"]);
    assertContainsAll(
        fullDSATools,
        ["open_ide", "run_candidate_code", "give_hint", "transition_stage"],
        "Full interview DSA tools are incomplete"
    );
    assert(!fullDSATools.includes("fetch_question"), "Full interview DSA should not include fetch_question.");
    assertContainsAll(
        fullFundamentalsTools,
        ["record_question", "open_sql_editor", "close_panel", "transition_stage"],
        "Full interview fundamentals tools are incomplete"
    );
    assert(!fullFundamentalsTools.includes("fetch_question"), "Full interview fundamentals should not fetch SQL/display questions at runtime.");
    assert.deepEqual(fullClosingTools, ["end_interview"]);

    const codingTools = getToolNames(getToolsForSession("coding" as any, "DSA" as any));
    assertContainsAll(codingTools, ["give_hint", "end_interview"], "Coding tools are incomplete");
    assert(!codingTools.includes("fetch_question"), "Coding interview must not include fetch_question.");
    assert(!codingTools.includes("open_ide"), "Coding interview should rely on preloaded IDE, not open_ide tool.");

    const csTools = getToolNames(getToolsForSession("cs_fundamentals" as any, "FUNDAMENTALS" as any));
    assertContainsAll(
        csTools,
        ["record_question", "open_sql_editor", "close_panel", "transition_stage"],
        "CS fundamentals tools are incomplete"
    );
    assert(!csTools.includes("fetch_question"), "CS fundamentals should not fetch SQL/display questions at runtime.");

    const sdTools = getToolNames(getToolsForSession("system_design" as any, "SYSTEM_DESIGN" as any));
    assertContainsAll(sdTools, ["open_scratchpad", "transition_stage"], "System design tools are incomplete");
    assert(!sdTools.includes("fetch_question"), "System design stage should not include fetch_question.");
}

function testPromptContractsForFullInterview(): void {
    const introPrompt = buildSystemPrompt(makePromptContext({
        interviewType: "full_interview",
        stage: "INTRO",
        resumeSummary: {
            name: "Jane Candidate",
            currentRole: "SDE-2",
            projects: [{ name: "Realtime Chat", description: "Messaging system", techStack: ["Node.js", "Redis"] }],
        },
    }));
    assert.match(introPrompt, /Candidate's Resume Summary/i);
    assert.match(introPrompt, /Resume deep-dive/i);
    assert.match(introPrompt, /Resume Project Probe Ladder/i);
    assert.match(introPrompt, /record_resume_probe/i);
    assert.match(introPrompt, /Increase depth ONLY after a strong answer/i);
    assert.match(introPrompt, /tradeoff, failure\/debugging, or scalability\/production follow-up/i);
    assert.match(introPrompt, /DIRECTLY reference REAL details/i);

    const dsaPrompt = buildSystemPrompt(makePromptContext({
        interviewType: "full_interview",
        stage: "DSA",
        prefetchedDSAQuestion: { id: "dsa-1", title: "Two Sum", difficulty: "Easy" },
    }));
    assert.match(dsaPrompt, /Tool Access \(Current Stage\)/i);
    assert.match(dsaPrompt, /You can call ONLY these tools right now in stage DSA/i);
    assert.match(dsaPrompt, /open_ide/i);
    assert.match(dsaPrompt, /QUESTION BANK [-—] DSA Problem/i);
    assert.match(dsaPrompt, /Call open_ide immediately/i);
    assert.match(dsaPrompt, /Ask about their approach BEFORE/i);
    assert.match(dsaPrompt, /Code Run Result/i);
    assert.match(dsaPrompt, /Code Submit Result/i);
    assert.match(dsaPrompt, /time and space complexity/i);
    assert.match(dsaPrompt, /asks to move on/i);
    assert.match(dsaPrompt, /Do NOT call end_interview from DSA/i);

    const fundamentalsPrompt = buildSystemPrompt(makePromptContext({
        interviewType: "full_interview",
        stage: "FUNDAMENTALS",
        prefetchedCSQuestions: new Map<string, Array<{ questionId: string; questionText: string; referenceAnswer: string }>>([
            ["DBMS", [{ questionId: "dbms-1", questionText: "Explain normalization.", referenceAnswer: "Reduce redundancy" }]],
            ["OS", [{ questionId: "os-1", questionText: "What is a process?", referenceAnswer: "Program in execution" }]],
            ["CN", [{ questionId: "cn-1", questionText: "What is TCP?", referenceAnswer: "Reliable transport" }]],
            ["OOPS", [{ questionId: "oops-1", questionText: "What is polymorphism?", referenceAnswer: "Many forms" }]],
            ["SQL_query", [{ questionId: "sql-1", questionText: "Write a query", referenceAnswer: "SELECT ..." }]],
        ]),
    }));
    assert.match(fundamentalsPrompt, /MANDATORY (PHASE|INTERNAL) ORDER.*DO NOT SKIP OR REORDER/i);
    assert.match(fundamentalsPrompt, /DBMS theory/i);
    assert.match(fundamentalsPrompt, /SQL round/i);
    assert.match(fundamentalsPrompt, /\b(OS|Operating Systems)\b/i);
    assert.match(fundamentalsPrompt, /\b(CN|Computer Networks)\b/i);
    assert.match(fundamentalsPrompt, /OOPS/i);
    assert.match(fundamentalsPrompt, /close_panel/i);
    assert.match(fundamentalsPrompt, /QUESTION BANK — CS Fundamentals/i);
    assert.match(fundamentalsPrompt, /lightly rephrase/i);
}

function testRoleSpecificResumeProjectFiltering(): void {
    const roleResume = {
        name: "Aahan Sharma",
        projects: [
            {
                name: "PrepPortal",
                description: "Full-stack AI mock interview platform with Next.js, Fastify, WebSockets, voice interviews, and report generation.",
                techStack: ["Next.js", "Fastify", "WebSockets", "Deepgram", "Grok API"],
            },
            {
                name: "Copy-Move Forgery Detection",
                description: "Computer vision research project using ResNet34, ViT, cross-attention, image preprocessing, and forgery classification metrics.",
                techStack: ["TensorFlow", "Keras", "ResNet34", "ViT"],
            },
            {
                name: "Smart Farm Management System",
                description: "Unsupervised autoencoder anomaly detection over farm sensor data.",
                techStack: ["Python", "TensorFlow", "Autoencoder"],
            },
            {
                name: "Legucid AI",
                description: "RAG document analysis system for legal and financial contracts using chunking, retrieval, and LLM summaries.",
                techStack: ["FastAPI", "RAG", "GCP"],
            },
        ],
    };

    const dsPrompt = buildSystemPrompt(makePromptContext({
        interviewType: "data_science_role",
        stage: "INTRO",
        resumeSummary: roleResume,
    }));
    assert.match(dsPrompt, /Role filter active: showing only Data Science\/ML\/RAG\/data-relevant projects/i);
    assert.match(dsPrompt, /Allowed Data Science\/ML projects: Copy-Move Forgery Detection, Smart Farm Management System, Legucid AI/i);
    assert.doesNotMatch(dsPrompt, /Allowed Data Science\/ML projects: .*PrepPortal/i);
    assert.doesNotMatch(dsPrompt, /- \*\*PrepPortal\*\*/i);

    const genAIPrompt = buildSystemPrompt(makePromptContext({
        interviewType: "gen_ai_role",
        stage: "INTRO",
        resumeSummary: roleResume,
    }));
    assert.match(genAIPrompt, /Role filter active: showing only GenAI\/LLM\/RAG\/agentic projects/i);
    assert.match(genAIPrompt, /Allowed GenAI projects: PrepPortal, Legucid AI/i);
    assert.doesNotMatch(genAIPrompt, /Allowed GenAI projects: .*Copy-Move Forgery Detection/i);
    assert.doesNotMatch(genAIPrompt, /- \*\*Copy-Move Forgery Detection\*\*/i);

    const fullPrompt = buildSystemPrompt(makePromptContext({
        interviewType: "full_interview",
        stage: "INTRO",
        resumeSummary: roleResume,
    }));
    assert.match(fullPrompt, /- \*\*PrepPortal\*\*/i);
    assert.match(fullPrompt, /- \*\*Copy-Move Forgery Detection\*\*/i);
    assert.match(fullPrompt, /- \*\*Smart Farm Management System\*\*/i);
    assert.match(fullPrompt, /- \*\*Legucid AI\*\*/i);
    assert.match(fullPrompt, /Listed projects: PrepPortal, Copy-Move Forgery Detection, Smart Farm Management System, Legucid AI/i);
}

function testPromptContractsForCodingCSAndSystemDesign(): void {
    const codingPrompt = buildSystemPrompt(makePromptContext({
        interviewType: "coding",
        stage: "DSA",
        prefetchedDSAQuestion: { id: "dsa-locked", title: "Binary Tree Depth", difficulty: "Medium" },
    }));
    assert.match(codingPrompt, /IDE and coding question are ALREADY loaded/i);
    assert.match(codingPrompt, /NEVER call .*fetch_question/i);
    assert.match(codingPrompt, /Ask about their approach BEFORE coding/i);
    assert.match(codingPrompt, /time and space complexity/i);
    assert.match(codingPrompt, /Code Submit Result/i);

    const csPrompt = buildSystemPrompt(makePromptContext({
        interviewType: "cs_fundamentals",
        stage: "FUNDAMENTALS",
        prefetchedCSQuestions: new Map<string, Array<{ questionId: string; questionText: string; referenceAnswer: string }>>([
            ["DBMS", [{ questionId: "dbms-1", questionText: "Explain ACID", referenceAnswer: "Atomicity..." }]],
            ["OS", [{ questionId: "os-1", questionText: "Threads vs processes", referenceAnswer: "..." }]],
            ["CN", [{ questionId: "cn-1", questionText: "TCP vs UDP", referenceAnswer: "..." }]],
            ["OOPS", [{ questionId: "oops-1", questionText: "Encapsulation", referenceAnswer: "..." }]],
            ["SQL_query", [{ questionId: "sql-1", questionText: "Join query", referenceAnswer: "..." }]],
        ]),
    }));
    assert.match(csPrompt, /CURRENT TOPIC: DBMS/i);
    assert.match(csPrompt, /NEXT INTERNAL ITEM: SQL/i);
    assert.match(csPrompt, /\bOS\b/i);
    assert.match(csPrompt, /\bCN\b/i);
    assert.match(csPrompt, /OOPS/i);
    assert.match(csPrompt, /open_sql_editor/i);
    assert.match(csPrompt, /lightly rephrase/i);

    const sdPrompt = buildSystemPrompt(makePromptContext({
        interviewType: "system_design",
        stage: "SYSTEM_DESIGN",
        prefetchedSDQuestion: {
            id: "sd-1",
            title: "Design URL Shortener",
            problemStatement: "Design a scalable URL shortener.",
        },
        canvasSnapshot: {
            elements: [
                { id: "shape_api", type: "rectangle", x: 10, y: 10, width: 220, height: 120 },
                { id: "shape_cache", type: "rectangle", x: 360, y: 10, width: 220, height: 120 },
                { id: "label_api", type: "text", text: "API Gateway", x: 50, y: 45, width: 120, height: 24, containerId: "shape_api" },
                { id: "label_cache", type: "text", text: "Cache", x: 430, y: 45, width: 70, height: 24, containerId: "shape_cache" },
                {
                    id: "arrow_flow",
                    type: "arrow",
                    x: 0,
                    y: 0,
                    points: [[230, 70], [360, 70]],
                    startBinding: { elementId: "shape_api" },
                    endBinding: { elementId: "shape_cache" },
                },
            ],
        },
    }));
    assert.match(sdPrompt, /YOUR DESIGN PROBLEM - USE THIS EXACT PROBLEM/i);
    assert.match(sdPrompt, /Do NOT call fetch_question or open_scratchpad/i);
    assert.match(sdPrompt, /whiteboard are ALREADY loaded/i);
    assert.match(sdPrompt, /Detected flows/i);
    assert.match(sdPrompt, /API Gateway -> Cache/i);
}

function testPromptCacheFriendlyOrderingAndCompactVoiceContext(): void {
    const fundamentalsPrompt = buildSystemPrompt(makePromptContext({
        interviewType: "full_interview",
        stage: "FUNDAMENTALS",
        sqlQuestionDescription: "Find monthly active users.",
        sqlSnapshot: "SELECT user_id FROM events;",
        prefetchedCSQuestions: new Map<string, Array<{ questionId: string; questionText: string; referenceAnswer: string }>>([
            ["DBMS", [{ questionId: "dbms-1", questionText: "Explain ACID.", referenceAnswer: "..." }]],
            ["OS", [{ questionId: "os-1", questionText: "What is a deadlock?", referenceAnswer: "..." }]],
            ["CN", [{ questionId: "cn-1", questionText: "TCP vs UDP", referenceAnswer: "..." }]],
            ["OOPS", [{ questionId: "oops-1", questionText: "What is abstraction?", referenceAnswer: "..." }]],
            ["SQL_query", [{ questionId: "sql-1", questionText: "Write a join query", referenceAnswer: "..." }]],
        ]),
    }));

    const qbMatch = /QUESTION BANK.*CS Fundamentals/i.exec(fundamentalsPrompt);
    const qbIndex = qbMatch?.index ?? -1;
    const sqlCtxIndex = fundamentalsPrompt.indexOf("Candidate's Current SQL Query");
    assert(qbIndex >= 0, "Expected CS QUESTION BANK section in fundamentals prompt.");
    assert(sqlCtxIndex >= 0, "Expected SQL context section in fundamentals prompt.");
    assert(qbIndex !== sqlCtxIndex, "QUESTION BANK and SQL context should remain distinct prompt sections.");

    const dsaPrompt = buildSystemPrompt(makePromptContext({
        interviewType: "full_interview",
        stage: "DSA",
        codeSnapshot: "function solve() { return 42; }",
        codeLanguage: "javascript",
        prefetchedDSAQuestion: { id: "dsa-1", title: "Two Sum", difficulty: "Easy" },
    }));

    const dsaQbMatch = /QUESTION BANK.*DSA Problem/i.exec(dsaPrompt);
    const dsaQbIndex = dsaQbMatch?.index ?? -1;
    const codeCtxIndex = dsaPrompt.indexOf("Candidate's Current Code");
    assert(dsaQbIndex >= 0, "Expected DSA QUESTION BANK section.");
    assert(codeCtxIndex >= 0, "Expected DSA code context section.");
    assert(dsaQbIndex !== codeCtxIndex, "QUESTION BANK and code context should remain distinct prompt sections.");

    const compactVoiceUpdate = buildVoiceContextUpdate({
        interviewType: "cs_fundamentals" as any,
        stage: "FUNDAMENTALS" as any,
        role: "Software Engineer",
        level: "SDE2",
        currentQuestionTitle: "Monthly Transactions",
        codeSnapshot: null,
        codeLanguage: null,
        sqlQuestionDescription: "Find users with monthly transactions grouped by month.",
        sqlSnapshot: "SELECT * FROM transactions WHERE amount > 100;",
    });

    assert.match(compactVoiceUpdate, /Follow the stage instructions already in your system prompt/i);
    assert.doesNotMatch(compactVoiceUpdate, /PHASE 1: DBMS Theory/i);
    assert.match(compactVoiceUpdate, /SQL problem context/i);
    assert.match(compactVoiceUpdate, /SQL query context/i);

    const codeVoiceUpdate = buildVoiceContextUpdate({
        interviewType: "coding" as any,
        stage: "DSA" as any,
        role: "Software Engineer",
        level: "SDE2",
        currentQuestionTitle: "Two Sum",
        codeSnapshot: "function solve(){ return 1; }",
        codeLanguage: "javascript",
        sqlSnapshot: null,
    });
    assert.match(codeVoiceUpdate, /Code context/i);

    const diagramVoiceUpdate = buildVoiceContextUpdate({
        interviewType: "system_design" as any,
        stage: "SYSTEM_DESIGN" as any,
        role: "Software Engineer",
        level: "SDE2",
        currentQuestionTitle: "Design URL Shortener",
        codeSnapshot: null,
        codeLanguage: null,
        sqlSnapshot: null,
        canvasSnapshot: {
            elements: [
                { type: "rectangle" },
                { type: "arrow" },
                { type: "text", text: "API Gateway" },
                { type: "text", text: "Cache" },
            ],
        },
    });
    assert.match(diagramVoiceUpdate, /Diagram context/i);
    assert.match(diagramVoiceUpdate, /API Gateway/i);

    const diagramVoiceUpdateWithFlow = buildVoiceContextUpdate({
        interviewType: "system_design" as any,
        stage: "SYSTEM_DESIGN" as any,
        role: "Software Engineer",
        level: "SDE2",
        currentQuestionTitle: "Design URL Shortener",
        codeSnapshot: null,
        codeLanguage: null,
        sqlSnapshot: null,
        canvasSnapshot: {
            elements: [
                { id: "shape_api", type: "rectangle", x: 10, y: 10, width: 220, height: 120 },
                { id: "shape_cache", type: "rectangle", x: 360, y: 10, width: 220, height: 120 },
                { id: "label_api", type: "text", text: "API Gateway", x: 50, y: 45, width: 120, height: 24, containerId: "shape_api" },
                { id: "label_cache", type: "text", text: "Cache", x: 430, y: 45, width: 70, height: 24, containerId: "shape_cache" },
                {
                    id: "arrow_flow",
                    type: "arrow",
                    x: 0,
                    y: 0,
                    points: [[230, 70], [360, 70]],
                    startBinding: { elementId: "shape_api" },
                    endBinding: { elementId: "shape_cache" },
                },
            ],
        },
    });
    assert.match(diagramVoiceUpdateWithFlow, /Detected flows/i);
    assert.match(diagramVoiceUpdateWithFlow, /API Gateway -> Cache/i);
}

function testTransitionAndEndGuards(): void {
    const fullSkip = validateStageTransition({
        interviewType: "full_interview" as any,
        currentStage: "INTRO" as any,
        nextStage: "FUNDAMENTALS" as any,
    });
    assert.equal(fullSkip.allowed, false);
    if (!fullSkip.allowed) {
        assert.equal(fullSkip.code, "stage_skip_blocked");
    }

    const sdNoScratchpad = validateStageTransition({
        interviewType: "system_design" as any,
        currentStage: "SYSTEM_DESIGN" as any,
        nextStage: "CLOSING" as any,
        scratchpadOpened: false,
        systemDesignExchangeCount: 0,
    });
    assert.equal(sdNoScratchpad.allowed, false);
    if (!sdNoScratchpad.allowed) {
        assert.equal(sdNoScratchpad.code, "scratchpad_required");
    }

    const sdInsufficientDiscussion = validateStageTransition({
        interviewType: "system_design" as any,
        currentStage: "SYSTEM_DESIGN" as any,
        nextStage: "CLOSING" as any,
        scratchpadOpened: true,
        systemDesignExchangeCount: 2,
    });
    assert.equal(sdInsufficientDiscussion.allowed, false);
    if (!sdInsufficientDiscussion.allowed) {
        assert.equal(sdInsufficientDiscussion.code, "minimum_exchanges_required");
    }

    const sdAllowed = validateStageTransition({
        interviewType: "system_design" as any,
        currentStage: "SYSTEM_DESIGN" as any,
        nextStage: "CLOSING" as any,
        scratchpadOpened: true,
        systemDesignExchangeCount: 3,
    });
    assert.equal(sdAllowed.allowed, true);

    const endTooEarly = validateEndInterview({
        interviewType: "full_interview" as any,
        currentStage: "DSA" as any,
    });
    assert.equal(endTooEarly.allowed, false);

    const endCodingFinal = validateEndInterview({
        interviewType: "coding" as any,
        currentStage: "DSA" as any,
    });
    assert.equal(endCodingFinal.allowed, true);
}

function testEndInterviewIntentDetection(): void {
    const shouldEnd = [
        "no questions",
        "that's all for me",
        "let's end the interview",
        "bye",
        "goodbye",
        "thank you, that's all",
        "thanks, bye",
    ];

    for (const utterance of shouldEnd) {
        assert.equal(
            isEndInterviewIntent(utterance),
            true,
            `Expected end intent for: \"${utterance}\"`
        );
    }

    const shouldNotEnd = [
        "thank you",
        "thanks for the hint",
        "thank you this helped",
        "thanks let's continue",
        "thanks lets move on",
        "can we continue",
    ];

    for (const utterance of shouldNotEnd) {
        assert.equal(
            isEndInterviewIntent(utterance),
            false,
            `Did not expect end intent for: \"${utterance}\"`
        );
    }

    const closingAcknowledgements = ["ok", "okay", "no", "no questions", "nothing else", "bye"];
    for (const utterance of closingAcknowledgements) {
        assert.equal(
            isClosingAcknowledgement(utterance),
            true,
            `Expected closing acknowledgement for: \"${utterance}\"`
        );
    }

    const continuationAcknowledgements = ["yes", "yeah", "yep", "sure", "fine", "cool", "alright"];
    for (const utterance of continuationAcknowledgements) {
        assert.equal(
            isClosingAcknowledgement(utterance),
            false,
            `Did not expect continuation acknowledgement to close interview: \"${utterance}\"`
        );
    }

    for (const utterance of ["ok", "okay", "no"]) {
        assert.equal(
            isEndInterviewIntent(utterance),
            false,
            `Expected acknowledgement without explicit end intent for: \"${utterance}\"`
        );
    }

    const closeoutQuestions = [
        "Can you tell me what I should improve?",
        "What did you think about my PrepPortal answers?",
        "Could I ask one question before we end?",
    ];
    for (const utterance of closeoutQuestions) {
        assert.equal(
            isCloseoutQuestion(utterance),
            true,
            `Expected closeout question to stay open: \"${utterance}\"`
        );
        assert.equal(
            isClosingAcknowledgement(utterance),
            false,
            `Did not expect question to count as closing acknowledgement: \"${utterance}\"`
        );
    }

    assert.equal(isCloseoutQuestion("no questions"), false);
}

function testDsaAdvanceIntentDetection(): void {
    const shouldAdvance = [
        "i dont know how to solve this lets move on",
        "I am stuck, can we move to fundamentals",
        "skip this problem and move to dbms",
        "let's move on",
        "next section please",
    ];

    for (const utterance of shouldAdvance) {
        assert.equal(
            isDsaAdvanceIntent(utterance),
            true,
            `Expected DSA advance intent for: \"${utterance}\"`
        );
    }

    const shouldNotAdvance = [
        "let us move on to the next line in code",
        "next i will use a hashmap",
        "continue debugging this",
        "i think this might work",
        "i had to skip lunch and go straight to dinner",
        "skip has always been a good part",
    ];

    for (const utterance of shouldNotAdvance) {
        assert.equal(
            isDsaAdvanceIntent(utterance),
            false,
            `Did not expect DSA advance intent for: \"${utterance}\"`
        );
    }
}

function testTurnGuardSignals(): void {
    assert.equal(isSqlAdvanceIntent("Let's move on."), false, "Generic move-on should not be treated as SQL handoff by itself.");
    assert.equal(isGenericMoveOnIntent("Let's move on."), true, "Generic move-on intent should be detected.");
    assert.equal(isGenericMoveOnIntent("skip"), true, "Bare skip should be detected as a direct command.");
    assert.equal(isGenericMoveOnIntent("skip this question"), true, "Direct skip-this-question command should be detected.");
    assert.equal(isGenericMoveOnIntent("can we skip this problem"), true, "Polite skip command should be detected.");
    assert.equal(isGenericMoveOnIntent("i had to skip lunch and go straight to dinner"), false, "Skip inside answer content must not be treated as move-on intent.");
    assert.equal(isGenericMoveOnIntent("there was a time when i had to skip lunch to go to my classes for fraud detection system"), false, "Narrative skip usage must not advance the interview.");
    assert.equal(isGenericMoveOnIntent("also i had to skip many things"), false, "Ambiguous answer content with skip must not advance the interview.");
    assert.equal(isGenericMoveOnIntent("skip has always been a good part"), false, "A sentence starting with skip but not shaped as a command must not advance.");
    assert.equal(isUnknownResponseIntent("I don't know."), true, "Unknown-response intent should be detected.");
    assert.equal(isUnknownResponseIntent("I think the answer is indexing."), false, "Confident answer should not be flagged as unknown-response intent.");

    const repeatedQuestionHistory = [
        { role: "assistant", content: "What is query processing?" },
        { role: "user", content: "I don't know." },
        { role: "assistant", content: "What is query processing?" },
    ] as any;
    assert.equal(
        hasRecentRepeatedAssistantQuestion(repeatedQuestionHistory),
        true,
        "Repeated assistant main question should be detected."
    );

    const variedQuestionHistory = [
        { role: "assistant", content: "What is query processing?" },
        { role: "user", content: "I don't know." },
        { role: "assistant", content: "Can you explain normalization?" },
    ] as any;
    assert.equal(
        hasRecentRepeatedAssistantQuestion(variedQuestionHistory),
        false,
        "Different assistant questions should not trigger repeated-question detection."
    );

    const sqlSignalHistory = [
        { role: "assistant", content: "The SQL editor is open. Please write your SQL query." },
        { role: "user", content: "SELECT * FROM users;" },
        { role: "user", content: "[SQL Run Result] status=FAILED" },
    ] as any;
    assert.equal(
        hasRecentSqlRoundSignals(sqlSignalHistory),
        true,
        "Recent SQL round traces should be detected."
    );

    assert.equal(
        isIntroToDsaAdvanceIntent("Thank you for the introduction. Let's move on to a coding problem now."),
        true,
        "Intro-to-DSA explicit request should be detected."
    );
    assert.equal(
        isIntroToDsaAdvanceIntent("Can we continue discussing my background first?"),
        false,
        "Non-coding intro messages should not trigger intro-to-DSA intent."
    );

    assert.equal(
        isLikelyCodingRoundPrompt(
            "Let's move on to a coding problem now. Please solve the following: Given an array of positive integers... How would you approach this?"
        ),
        true,
        "Coding-round prompts should be detected for drift correction."
    );
    assert.equal(
        isLikelyCodingRoundPrompt("Thanks for the introduction. Tell me about your last project."),
        false,
        "Non-coding prompts should not trigger coding-round detection."
    );
    assert.equal(
        isLikelyCodingRoundPrompt(
            "I understand. Since you don't have prior experience to discuss, let's move on to a coding problem now."
        ),
        true,
        "Immediate INTRO-to-coding handoff language should trigger coding-round drift detection."
    );
    assert.equal(
        isLikelyCodingRoundPrompt(
            "Hello, thank you for joining me today. We'll start with some discussion about your background and experience, then move on to a coding problem, followed by computer science fundamentals, and wrap up at the end. To begin, could you please tell me about yourself?"
        ),
        false,
        "Agenda-style intro scripts must not trigger coding-round detection."
    );
    assert.equal(
        isLikelyFundamentalsHandoffPrompt("Understood. Let's transition to the fundamentals portion of the interview."),
        true,
        "Assistant fundamentals-handoff prompts should be detected for DSA drift correction."
    );
    assert.equal(
        isLikelyFundamentalsHandoffPrompt("Let's review the fundamentals of this algorithm before coding."),
        false,
        "Algorithm-fundamentals phrasing must not be misclassified as stage handoff."
    );

    assert.equal(
        isFundamentalsToSqlIntent("Let's move to SQL round now."),
        true,
        "Fundamentals-to-SQL explicit request should be detected."
    );
    assert.equal(
        isFundamentalsToSqlIntent("Let's continue with DBMS."),
        false,
        "Non-SQL fundamentals messages should not trigger SQL handoff intent."
    );

    assert.equal(
        isLikelySqlRoundPrompt("Now let's start the SQL round. Please write an SQL query and walk through your approach."),
        true,
        "SQL-round prompts should be detected for drift correction."
    );
    assert.equal(
        isLikelySqlRoundPrompt(
            "Great! So today we'll be covering several core CS topics - databases, operating systems, computer networks, and object-oriented programming. We'll also have a practical SQL round where you'll write a query. Let's start with databases. Decompose R(A,B,C) with FD A->B. Check lossless."
        ),
        false,
        "Agenda-style fundamentals intro that mentions SQL as a future phase must not auto-trigger SQL-round detection."
    );
    assert.equal(
        isLikelySqlRoundPrompt("What is query processing in DBMS?"),
        false,
        "DBMS query-processing prompts should not be misclassified as SQL-round prompts."
    );

    // Regression: reported bug where AI said "Let's shift to the coding portion.
    // I'll describe a problem for you to solve..." but the IDE never opened.
    assert.equal(
        isLikelyCodingRoundPrompt(
            "Understood. Let's shift to the coding portion. I'll describe a problem for you to solve: You are given two non-empty linked lists representing two non-negative integers. The digits are stored in reverse order, and each of their nodes contains a single digit. Add the two numbers and return the sum as a linked list. You may assume the two numbers do not contain any leading zero, except the number 0 itself. Can you walk me through how you would approach solving this?"
        ),
        true,
        "Shift-to-coding-portion with problem description must trigger coding-round drift detection."
    );
    assert.equal(
        isLikelyCodingRoundPrompt("Let's jump into the coding exercise. Given a sorted array, find two numbers. Walk me through your approach."),
        true,
        "Jump-into-coding-exercise language must trigger coding-round drift detection."
    );
    assert.equal(
        isLikelyFundamentalsHandoffPrompt("Good job on that coding problem. Let's shift to CS fundamentals now."),
        true,
        "Shift-to-fundamentals language must trigger fundamentals handoff detection."
    );
    assert.equal(
        isLikelySqlRoundPrompt("Let's shift to the SQL portion now. I have a query for you."),
        true,
        "Shift-to-SQL-portion language must trigger SQL-round drift detection."
    );
    assert.equal(
        isLikelySqlRoundPrompt("Now let's test your SQL skills practically. I'll give you a query problem to solve in the editor."),
        true,
        "Immediate SQL practical handoff language must trigger SQL-round drift detection."
    );
}

function testUnavailableToolCallsAreSanitizedPerStage(): void {
    const result = splitToolCallsByAvailability(
        [
            { id: "call_1", name: "open_scratchpad", arguments: "{}" },
            { id: "call_2", name: "end_interview", arguments: "{}" },
            { id: "call_3", name: "transition_stage", arguments: JSON.stringify({ nextStage: "CLOSING", reason: "done" }) },
        ],
        ["open_scratchpad", "transition_stage"]
    );

    assert.deepEqual(
        result.allowedToolCalls.map((tc) => tc.name),
        ["open_scratchpad", "transition_stage"]
    );
    assert.deepEqual(result.rejectedToolNames, ["end_interview"]);
}

async function testPrefetchOnlyRuntimeGuards(): Promise<void> {
    const sqlFetchResult = await handleToolCall(
        "fetch_question",
        { category: "SQL" },
        makeToolContext({
            interviewType: "cs_fundamentals" as any,
            currentStage: "FUNDAMENTALS" as any,
            stageOrder: ["INTRO", "FUNDAMENTALS", "CLOSING"] as any,
        })
    );
    assert.match(sqlFetchResult, /Tool fetch_question is not allowed in stage FUNDAMENTALS/i);

    const dsaFetchResult = await handleToolCall(
        "fetch_question",
        { category: "DSA" },
        makeToolContext({
            interviewType: "full_interview" as any,
            currentStage: "DSA" as any,
        })
    );
    assert.match(dsaFetchResult, /Tool fetch_question is not allowed in stage DSA/i);

    const systemDesignFetchResult = await handleToolCall(
        "fetch_question",
        { category: "SystemDesign" },
        makeToolContext({
            interviewType: "system_design" as any,
            currentStage: "SYSTEM_DESIGN" as any,
            stageOrder: ["INTRO", "SYSTEM_DESIGN", "CLOSING"] as any,
        })
    );
    assert.match(systemDesignFetchResult, /Tool fetch_question is not allowed in stage SYSTEM_DESIGN/i);

    const openSqlNoCache = await handleToolCall(
        "open_sql_editor",
        {},
        makeToolContext({
            interviewType: "cs_fundamentals" as any,
            currentStage: "FUNDAMENTALS" as any,
        })
    );
    assert.match(openSqlNoCache, /No pre-fetched SQL question is available in session cache/i);
}

async function testResumeIntroExitDepthGuards(): Promise<void> {
    assert.equal(
        inferResumeProbeDepthFromQuestion("How would this voice interview architecture scale to 10k concurrent users?"),
        "senior_depth",
        "Scalability probes should count as senior resume depth."
    );

    const fullIntroWithoutTradeoff = await handleToolCall(
        "transition_stage",
        { nextStage: "DSA", reason: "intro done" },
        makeToolContext({
            interviewType: "full_interview" as any,
            currentStage: "INTRO" as any,
            stageOrder: ["INTRO", "DSA", "FUNDAMENTALS", "CLOSING"] as any,
            resumeProbeState: {
                activeProjectName: "PrepPortal",
                currentDepth: "tradeoffs",
                lastAnswerQuality: "strong",
                lastAskedProjectName: "PrepPortal",
                lastAskedDepth: "implementation",
                consecutiveWeakAnswers: 0,
                completedDepths: ["overview", "motivation", "ownership", "implementation"] as any,
                askedProbeKeys: [
                    "prepportal::overview",
                    "prepportal::motivation",
                    "prepportal::ownership",
                    "prepportal::implementation",
                ],
                saturatedProjects: [],
            },
        })
    );
    assert.match(fullIntroWithoutTradeoff, /CANNOT transition out of the Full Interview resume\/project introduction yet/i);
    assert.match(fullIntroWithoutTradeoff, /tradeoffs, failure\/debugging, or scalability\/production/i);

    const dataScienceIntroWithoutDSDepth = await handleToolCall(
        "transition_stage",
        { nextStage: "DS_CONCEPTS", reason: "resume intro done" },
        makeToolContext({
            interviewType: "data_science_role" as any,
            currentStage: "INTRO" as any,
            stageOrder: ["INTRO", "DS_CONCEPTS", "DS_SQL", "DS_CODING", "DS_BUSINESS_CASE"] as any,
            resumeProbeState: {
                activeProjectName: "Forecasting Model",
                currentDepth: "implementation",
                lastAnswerQuality: "strong",
                lastAskedProjectName: "Forecasting Model",
                lastAskedDepth: "motivation",
                consecutiveWeakAnswers: 0,
                completedDepths: ["overview", "motivation"] as any,
                askedProbeKeys: [
                    "forecasting model::overview",
                    "forecasting model::motivation",
                ],
                saturatedProjects: [],
            },
        })
    );
    assert.match(dataScienceIntroWithoutDSDepth, /CANNOT transition out of the Data Science resume deep-dive yet/i);
    assert.match(dataScienceIntroWithoutDSDepth, /data source\/quality, feature engineering, baseline vs model choice/i);

    const dataScienceIntroToBusinessWithoutDSDepth = await handleToolCall(
        "transition_stage",
        { nextStage: "DS_BUSINESS_CASE", reason: "resume intro done" },
        makeToolContext({
            interviewType: "data_science_role" as any,
            currentStage: "INTRO" as any,
            stageOrder: ["INTRO", "DS_BUSINESS_CASE"] as any,
            resumeProbeState: {
                activeProjectName: "PrepPortal",
                currentDepth: "implementation",
                lastAnswerQuality: "strong",
                lastAskedProjectName: "PrepPortal",
                lastAskedDepth: "motivation",
                consecutiveWeakAnswers: 0,
                completedDepths: ["overview", "motivation"] as any,
                askedProbeKeys: [
                    "prepportal::overview",
                    "prepportal::motivation",
                ],
                saturatedProjects: [],
            },
        })
    );
    assert.match(dataScienceIntroToBusinessWithoutDSDepth, /CANNOT transition out of the Data Science resume deep-dive yet/i);
    assert.match(dataScienceIntroToBusinessWithoutDSDepth, /Before leaving the Data Science resume intro/i);

    const saturatedProjectResult = await handleToolCall(
        "record_resume_probe",
        {
            projectName: "PrepPortal",
            depth: "failure_depth",
            answerQuality: "strong",
            evidence: "The candidate explained a concrete parser edge case, regex boundary checks, test coverage, and latency impact for the same voice sentence-splitting component.",
        },
        makeToolContext({
            interviewType: "resume_round" as any,
            currentStage: "RESUME_PROJECTS" as any,
            stageOrder: ["RESUME_STUDIES", "RESUME_PROJECTS", "RESUME_EXPERIENCE", "RESUME_RESPONSIBILITY", "RESUME_SKILLS", "CLOSING"] as any,
            resumeProbeState: {
                activeProjectName: "PrepPortal",
                currentDepth: "failure_depth",
                lastAnswerQuality: "strong",
                lastAskedProjectName: "PrepPortal",
                lastAskedDepth: "tradeoffs",
                consecutiveWeakAnswers: 0,
                completedDepths: ["overview", "motivation", "ownership", "implementation", "tradeoffs"] as any,
                askedProbeKeys: [
                    "prepportal::overview",
                    "prepportal::motivation",
                    "prepportal::ownership",
                    "prepportal::implementation",
                    "prepportal::tradeoffs",
                ],
                saturatedProjects: [],
            },
        })
    );
    const saturatedProjectPayload = JSON.parse(saturatedProjectResult);
    assert.match(saturatedProjectPayload.guidance, /project is saturated/i);
    assert(saturatedProjectPayload.resumeProbeState.saturatedProjects.includes("PrepPortal"));

    let staleAgenda = createInitialResumeAgendaState({
        projects: [
            { name: "PrepPortal", description: "AI interview platform" },
            { name: "Legucid AI", description: "Legal RAG helper" },
            { name: "Smart Farm", description: "Autoencoder anomaly detection" },
        ],
        positionsOfResponsibility: [
            { role: "Sponsorship Lead", organization: "Desportivos", description: "Raised sponsorships" },
        ],
    });
    for (const intent of ["overview", "motivation", "ownership", "implementation", "tradeoff", "failure", "impact"] as const) {
        staleAgenda = updateResumeAgendaAfterProbe(staleAgenda, {
            agendaItemId: "project:prepportal",
            intent,
            answerQuality: "strong",
        })!;
    }
    staleAgenda = updateResumeAgendaAfterProbe(staleAgenda, {
        agendaItemId: "project:legucid-ai",
        intent: "ownership",
        answerQuality: "declined",
        shouldCloseItem: true,
    })!;
    for (const intent of ["ownership", "impact", "fit", "ownership", "impact"] as const) {
        staleAgenda = updateResumeAgendaAfterProbe(staleAgenda, {
            agendaItemId: "project:smart-farm",
            intent,
            answerQuality: "partial",
        })!;
    }
    assert.equal(getActiveResumeAgendaItem(staleAgenda)?.id, "responsibility:sponsorship-lead");

    const staleAgendaToolResult = await handleToolCall(
        "record_resume_probe",
        {
            agendaItemId: "project:smart-farm",
            projectName: "Smart Farm",
            depth: "implementation",
            intent: "implementation",
            answerQuality: "strong",
            evidence: "The model attempted to keep probing a closed Smart Farm item after the agenda moved to responsibility.",
        },
        makeToolContext({
            interviewType: "resume_round" as any,
            currentStage: "RESUME_RESPONSIBILITY" as any,
            stageOrder: ["RESUME_STUDIES", "RESUME_PROJECTS", "RESUME_EXPERIENCE", "RESUME_RESPONSIBILITY", "RESUME_SKILLS", "CLOSING"] as any,
            resumeAgendaState: staleAgenda,
        })
    );
    const staleAgendaPayload = JSON.parse(staleAgendaToolResult);
    assert.match(staleAgendaPayload.audit.reasons.join(" "), /stale resume agenda item id was ignored/i);
    assert.equal(staleAgendaPayload.resumeAgendaState.items.find((item: any) => item.id === "responsibility:sponsorship-lead")?.status, "active");
    assert.equal(staleAgendaPayload.resumeAgendaState.activeItemId, "responsibility:sponsorship-lead");

    const prematureResumeEnd = await handleToolCall(
        "end_interview",
        { summary: "Model tried to end resume screening in the same closeout response." },
        makeToolContext({
            interviewType: "resume_round" as any,
            currentStage: "CLOSING" as any,
            stageOrder: ["RESUME_STUDIES", "RESUME_PROJECTS", "RESUME_EXPERIENCE", "RESUME_RESPONSIBILITY", "RESUME_SKILLS", "CLOSING"] as any,
        })
    );
    assert.match(prematureResumeEnd, /CANNOT end resume screening yet/i);
}

function testResumeAgendaContracts(): void {
    let agenda = createInitialResumeAgendaState({
        projects: [
            { name: "PrepPortal", description: "AI interview platform", techStack: ["Next.js", "WebSockets"] },
            { name: "Legucid AI", description: "Legal RAG helper", techStack: ["FastAPI", "GCP"] },
            { name: "Smart Farm", description: "Autoencoder anomaly detection", techStack: ["TensorFlow"] },
        ],
        positionsOfResponsibility: [
            { role: "Sponsorship Lead", organization: "Desportivos", description: "Raised sponsorship funds" },
            { role: "Acting Coordinator - Boxing", organization: "LNMIIT", description: "Built first-day training group" },
        ],
        education: [{ degree: "B.Tech CSE", institute: "LNMIIT", cgpa: "8.1" }],
        skills: [{ category: "AI", skills: ["RAG", "WebSockets", "TensorFlow"] }],
    });

    assert.equal(getActiveResumeAgendaItem(agenda)?.id, "project:prepportal");
    assert.equal(getResumeAgendaItemTurnLimit(getActiveResumeAgendaItem(agenda)!), 7);
    assert(!agenda.items.some((item) => item.type === "education"), "Resume screening agenda must not ask standalone coursework questions.");
    assert(!agenda.items.some((item) => item.id === "skill:technical-stack"), "Resume screening agenda must not ask standalone skill-checklist questions.");

    for (const intent of ["overview", "ownership", "implementation"] as const) {
        agenda = updateResumeAgendaAfterProbe(agenda, {
            agendaItemId: "project:prepportal",
            intent,
            answerQuality: "strong",
        })!;
        assert.equal(getActiveResumeAgendaItem(agenda)?.id, "project:prepportal");
    }

    agenda = updateResumeAgendaAfterProbe(agenda, {
        agendaItemId: "project:prepportal",
        intent: "tradeoff",
        answerQuality: "strong",
    })!;
    assert.equal(agenda.items.find((item) => item.id === "project:prepportal")?.status, "active");
    assert.equal(getActiveResumeAgendaItem(agenda)?.id, "project:prepportal");

    for (const intent of ["failure", "impact", "skill_usage"] as const) {
        agenda = updateResumeAgendaAfterProbe(agenda, {
            agendaItemId: "project:prepportal",
            intent,
            answerQuality: "strong",
        })!;
    }
    assert.equal(agenda.items.find((item) => item.id === "project:prepportal")?.status, "saturated");
    assert.equal(getActiveResumeAgendaItem(agenda)?.id, "project:legucid-ai");

    agenda = updateResumeAgendaAfterProbe(agenda, {
        agendaItemId: "project:legucid-ai",
        intent: "ownership",
        answerQuality: "declined",
        shouldCloseItem: true,
    })!;
    assert.equal(getActiveResumeAgendaItem(agenda)?.id, "project:smart-farm");
    assert.equal(getResumeAgendaItemTurnLimit(getActiveResumeAgendaItem(agenda)!), 5);

    for (const intent of ["ownership", "impact", "fit", "ownership"] as const) {
        agenda = updateResumeAgendaAfterProbe(agenda, {
            agendaItemId: "project:smart-farm",
            intent,
            answerQuality: "partial",
        })!;
        assert.equal(agenda.items.find((item) => item.id === "project:smart-farm")?.status, "active");
        assert.equal(getActiveResumeAgendaItem(agenda)?.id, "project:smart-farm");
    }
    agenda = updateResumeAgendaAfterProbe(agenda, {
        agendaItemId: "project:smart-farm",
        intent: "impact",
        answerQuality: "partial",
    })!;
    assert.equal(agenda.items.find((item) => item.id === "project:smart-farm")?.status, "saturated");
    assert.equal(getActiveResumeAgendaItem(agenda)?.id, "responsibility:sponsorship-lead");
    assert.equal(getResumeAgendaItemTurnLimit(getActiveResumeAgendaItem(agenda)!), 5);

    agenda = declineActiveResumeAgendaItem(agenda)!;
    assert.equal(agenda.items.find((item) => item.id === "responsibility:sponsorship-lead")?.status, "declined");
    assert.equal(getActiveResumeAgendaItem(agenda)?.id, "responsibility:acting-coordinator-boxing");

    for (const intent of ["impact", "fit", "ownership", "failure"] as const) {
        agenda = updateResumeAgendaAfterProbe(agenda, {
            agendaItemId: "responsibility:acting-coordinator-boxing",
            intent,
            answerQuality: "strong",
        })!;
        assert.equal(agenda.items.find((item) => item.id === "responsibility:acting-coordinator-boxing")?.status, "active");
        assert.equal(getActiveResumeAgendaItem(agenda)?.id, "responsibility:acting-coordinator-boxing");
    }
    agenda = updateResumeAgendaAfterProbe(agenda, {
        agendaItemId: "responsibility:acting-coordinator-boxing",
        intent: "fit",
        answerQuality: "strong",
    })!;
    assert.equal(agenda.items.find((item) => item.id === "responsibility:acting-coordinator-boxing")?.status, "saturated");
    assert.equal(getActiveResumeAgendaItem(agenda)?.id, "risk:ai-contribution-clarity");

    agenda = declineActiveResumeAgendaItem(agenda)!;
    assert.equal(getActiveResumeAgendaItem(agenda)?.id, "fit:role-synthesis");
}

function testCompatibilityManifestContracts(): void {
    const validator = new InterviewModulesValidator();

    for (const config of getAllInterviewTypeConfigs()) {
        const result = validator.validateManifest(config.type as any);
        assert.equal(result.valid, true, `Expected manifest to validate for ${config.type}. Errors: ${result.errors.join("; ")}`);
    }

    const fullPreflightNoResume = validator.validate({
        interviewType: "full_interview" as any,
        role: "Software Engineer",
        level: "SDE2",
        hasResume: false,
        isVoiceMode: false,
    });
    assert.equal(fullPreflightNoResume.valid, true, "Missing resume should warn, not fail preflight.");
    assert(
        fullPreflightNoResume.warnings.some((warning) => warning.code === "RESUME_MISSING_OPTIONAL"),
        "Expected resume warning for full interview preflight when resume is missing."
    );
}

function testPrefetchStateValidatorContracts(): void {
    const codingState = validatePrefetchState({
        interviewType: "coding" as any,
        prefetchedDSAQuestion: { id: "dsa-1", title: "Two Sum" },
        cachedQuestionData: new Map(),
    });
    assert.equal(codingState.complete, true, "Coding prefetch should pass with prefetched DSA question.");

    const fullStateMissingFundamentals = validatePrefetchState({
        interviewType: "full_interview" as any,
        prefetchedDSAQuestion: { id: "dsa-1", title: "Two Sum" },
        prefetchedCSQuestions: new Map(),
        cachedQuestionData: new Map(),
    });
    assert.equal(fullStateMissingFundamentals.complete, false, "Full interview should fail when CS/SQL prefetch is incomplete.");
    assert(
        fullStateMissingFundamentals.unpopulated.includes("prefetchedCSQuestions") ||
        fullStateMissingFundamentals.missing.includes("prefetchedSQLQuestion"),
        "Expected missing or unpopulated CS fundamentals requirements for incomplete full interview prefetch."
    );
}

function testFullInterviewModuleSelectionContracts(): void {
    const introAndCsOnly = resolveEffectiveInterviewTypeConfig("full_interview" as any, {
        enabledStages: ["INTRO", "FUNDAMENTALS", "CLOSING"],
    });
    assert.deepEqual(introAndCsOnly.stages, ["INTRO", "FUNDAMENTALS", "CLOSING"]);
    assert.equal(introAndCsOnly.compatibilityManifest.prefetchRequirements.requiresDSAQuestion, false);
    assert.equal(introAndCsOnly.compatibilityManifest.prefetchRequirements.requiresCSQuestions, true);
    assert.equal(getNextEnabledStage(introAndCsOnly.stages as any, "INTRO" as any), "FUNDAMENTALS");

    const introAndCodingOnly = resolveEffectiveInterviewTypeConfig("full_interview" as any, {
        enabledStages: ["INTRO", "DSA", "CLOSING"],
    });
    assert.deepEqual(introAndCodingOnly.stages, ["INTRO", "DSA", "CLOSING"]);
    assert.equal(introAndCodingOnly.compatibilityManifest.prefetchRequirements.requiresDSAQuestion, true);
    assert.equal(introAndCodingOnly.compatibilityManifest.prefetchRequirements.requiresCSQuestions, false);
    assert.equal(getNextEnabledStage(introAndCodingOnly.stages as any, "DSA" as any), "CLOSING");

    const codingAndClosingOnly = resolveEffectiveInterviewTypeConfig("full_interview" as any, {
        enabledStages: ["DSA", "CLOSING"],
    });
    assert.deepEqual(codingAndClosingOnly.stages, ["DSA", "CLOSING"]);
    assert.equal(getNextEnabledStage(codingAndClosingOnly.stages as any, "DSA" as any), "CLOSING");

    const csRemoved = resolveEffectiveInterviewTypeConfig("full_interview" as any, {
        enabledStages: ["INTRO", "DSA", "CLOSING"],
    });
    assert.equal(csRemoved.stages.includes("FUNDAMENTALS" as any), false);

    const codingRemovedPrompt = buildSystemPrompt(makePromptContext({
        stage: "INTRO",
        stageOrder: introAndCsOnly.stages,
    }));
    assert.match(codingRemovedPrompt, /Stage Flow/i);
    assert.doesNotMatch(
        codingRemovedPrompt,
        /then move to a coding problem, followed by CS fundamentals/i,
        "Modular intro prompt must not contain the old fixed full-interview flow."
    );

    const disabledStageTools = getToolsForSession("full_interview" as any, "DSA" as any, introAndCsOnly.stages as any);
    assert.deepEqual(disabledStageTools, [], "Disabled DSA stage should expose no voice/text tools.");
}

function testRoleInterviewModuleSelectionContracts(): void {
    const resumeWithStalePartialConfig = resolveEffectiveInterviewTypeConfig("resume_round" as any, {
        enabledStages: ["RESUME_RESPONSIBILITY", "RESUME_SKILLS"],
    });
    assert.deepEqual(
        resumeWithStalePartialConfig.stages,
        ["RESUME_STUDIES", "RESUME_PROJECTS", "RESUME_EXPERIENCE", "RESUME_RESPONSIBILITY", "RESUME_SKILLS", "CLOSING"],
        "Resume screening must ignore stale partial module configs and always use the full fixed flow."
    );
    assert.deepEqual(resumeWithStalePartialConfig.compatibilityManifest.prefetchRequirements.requiresResume, true);

    const resumeAgenda = createInitialResumeAgendaState({
        education: [{ degree: "B.Tech CSE", institute: "LNMIIT", cgpa: "8.1" }],
        projects: [
            { name: "PrepPortal", description: "AI interview platform", techStack: ["Next.js", "WebSockets"] },
            { name: "Legucid AI", description: "RAG tool", techStack: ["FastAPI", "GCP"] },
        ],
        positionsOfResponsibility: [{ role: "Sponsorship Lead", organization: "Desportivos", description: "Raised sponsorships" }],
        skills: [{ category: "AI", skills: ["RAG", "WebSockets"] }],
    });
    assert.equal(getActiveResumeAgendaItem(resumeAgenda)?.label, "PrepPortal");

    const resumeOpeningPrompt = buildSystemPrompt(makePromptContext({
        interviewType: "resume_round",
        stage: "RESUME_STUDIES",
        stageOrder: resumeWithStalePartialConfig.stages,
        resumeSummary: {
            education: [{ degree: "B.Tech CSE", institute: "LNMIIT", cgpa: "8.1" }],
            projects: [
                { name: "PrepPortal", description: "AI interview platform", techStack: ["Next.js", "WebSockets"] },
            ],
        },
        resumeAgendaState: resumeAgenda,
    }));
    assert.match(resumeOpeningPrompt, /Server-Owned Resume Agenda/i);
    assert.match(resumeOpeningPrompt, /Active item: PrepPortal/i);
    assert.match(resumeOpeningPrompt, /Do not ask the candidate what to evaluate/i);
    assert.doesNotMatch(resumeOpeningPrompt, /current degree\/year\/institute only as quick confirmation/i);
    assert.doesNotMatch(resumeOpeningPrompt, /what are you hoping to demonstrate/i);
    assert.doesNotMatch(resumeOpeningPrompt, /strongest engineering area/i);

    const resumeSkillsPrompt = buildSystemPrompt(makePromptContext({
        interviewType: "resume_round",
        stage: "RESUME_SKILLS",
        stageOrder: resumeWithStalePartialConfig.stages,
        resumeSummary: {
            name: "Resume Candidate",
            projects: [
                { name: "PrepPortal", description: "AI interview platform", techStack: ["Next.js", "WebSockets"] },
                { name: "Legucid AI", description: "RAG tool", techStack: ["FastAPI", "GCP"] },
            ],
            skills: [{ category: "AI", skills: ["RAG", "WebSockets"] }],
        },
        resumeAgendaState: resumeAgenda,
    }));
    assert.match(resumeSkillsPrompt, /Use the active item from Server-Owned Resume Agenda/i);
    assert.match(resumeSkillsPrompt, /Do not ask generic fallback questions like "one other project"/i);

    const resumeResponsibilityPrompt = buildSystemPrompt(makePromptContext({
        interviewType: "resume_round",
        stage: "RESUME_RESPONSIBILITY",
        stageOrder: resumeWithStalePartialConfig.stages,
        resumeSummary: {
            projects: [{ name: "PrepPortal", description: "AI interview platform", techStack: ["Next.js"] }],
            positionsOfResponsibility: [{ role: "Sponsorship Lead", organization: "Desportivos", description: "Raised sponsorships" }],
        },
        resumeAgendaState: {
            ...resumeAgenda,
            activeItemId: "responsibility:sponsorship-lead",
            items: resumeAgenda.items.map((item) =>
                item.id === "responsibility:sponsorship-lead"
                    ? { ...item, status: "active" as const }
                    : item.id === "project:prepportal"
                        ? { ...item, status: "covered" as const }
                        : item
            ),
            closedItemIds: ["project:prepportal"],
        },
    }));
    assert.match(resumeResponsibilityPrompt, /Sponsorship Lead/i);
    assert.match(resumeResponsibilityPrompt, /Closed items: PrepPortal/i);
    assert.match(resumeResponsibilityPrompt, /do not return to it/i);

    const pmBehavioralOnly = resolveEffectiveInterviewTypeConfig("pm_role" as any, {
        enabledStages: ["PM_BEHAVIORAL"],
    });
    assert.deepEqual(pmBehavioralOnly.stages, ["PM_BEHAVIORAL"]);
    assert.equal(pmBehavioralOnly.compatibilityManifest.prefetchRequirements.requiresResume, false);
    assert.equal(pmBehavioralOnly.compatibilityManifest.prefetchRequirements.requiresPMCaseQuestion, false);
    assert.equal(pmBehavioralOnly.compatibilityManifest.prefetchRequirements.requiresPMConceptQuestions, false);
    assert.equal(pmBehavioralOnly.compatibilityManifest.prefetchRequirements.requiresPMStrategyQuestion, false);

    const pmPrompt = buildSystemPrompt(makePromptContext({
        interviewType: "pm_role",
        stage: "PM_BEHAVIORAL",
        stageOrder: pmBehavioralOnly.stages,
    }));
    assert.match(pmPrompt, /PM_BEHAVIORAL is the final enabled stage/i);
    assert.doesNotMatch(pmPrompt, /The active Stage Flow is the only interview plan.*INTRO -> PM_CASE -> PM_CONCEPTS -> PM_STRATEGY -> PM_BEHAVIORAL/i);

    const pmCaseOnly = resolveEffectiveInterviewTypeConfig("pm_role" as any, {
        enabledStages: ["PM_CASE"],
    });
    assert.deepEqual(pmCaseOnly.stages, ["PM_CASE", "PM_BEHAVIORAL"]);
    const pmCaseTools = getToolNames(getToolsForSession("pm_role" as any, "PM_CASE" as any, pmCaseOnly.stages as any));
    assert(!pmCaseTools.includes("end_interview"), "PM case should transition to required PM behavioral before ending.");

    const genClosingOnly = resolveEffectiveInterviewTypeConfig("gen_ai_role" as any, {
        enabledStages: ["CLOSING"],
    });
    assert.deepEqual(genClosingOnly.stages, ["CLOSING"]);
    assert.equal(genClosingOnly.compatibilityManifest.prefetchRequirements.requiresResume, false);
    assert.equal(genClosingOnly.compatibilityManifest.prefetchRequirements.requiresGenAIConceptQuestions, false);
    assert.equal(genClosingOnly.compatibilityManifest.prefetchRequirements.requiresGenAICodingQuestion, false);

    const dsBusinessOnly = resolveEffectiveInterviewTypeConfig("data_science_role" as any, {
        enabledStages: ["DS_BUSINESS_CASE"],
    });
    assert.deepEqual(dsBusinessOnly.stages, ["DS_BUSINESS_CASE"]);
    assert.equal(dsBusinessOnly.compatibilityManifest.prefetchRequirements.requiresDSConceptQuestions, false);
    assert.equal(dsBusinessOnly.compatibilityManifest.prefetchRequirements.requiresDSSQLQuestion, false);
    assert.equal(dsBusinessOnly.compatibilityManifest.prefetchRequirements.requiresDSCodingQuestion, false);
    const dsBusinessTools = getToolNames(getToolsForSession("data_science_role" as any, "DS_BUSINESS_CASE" as any, dsBusinessOnly.stages as any));
    assert(dsBusinessTools.includes("end_interview"), "Final enabled DS business case stage should be able to end.");

    const dsBusinessPrompt = buildSystemPrompt(makePromptContext({
        interviewType: "data_science_role",
        stage: "DS_BUSINESS_CASE",
        stageOrder: dsBusinessOnly.stages,
    }));
    assert.match(dsBusinessPrompt, /Single-Module Session/i);
    assert.match(dsBusinessPrompt, /do NOT say "we'll finish with"/i);
    assert.doesNotMatch(dsBusinessPrompt, /Phase 5/i, "Single-stage DS business case prompt must not expose old fixed phase numbering.");
}

function testVoicePromptUsesModularStageOrder(): void {
    const voiceDirectives = buildVoiceDirectives("full_interview" as any, ["INTRO", "FUNDAMENTALS", "CLOSING"] as any);
    assert.match(voiceDirectives, /INTRO/);
    assert.match(voiceDirectives, /FUNDAMENTALS/);
    assert.doesNotMatch(voiceDirectives, /DSA/);
}

async function run(): Promise<void> {
    const tests: Array<{ name: string; run: () => void | Promise<void> }> = [
        { name: "interview stage orders are correct", run: testInterviewStageOrders },
        { name: "tool contracts per interview type are correct", run: testToolContractsByInterviewType },
        { name: "full interview prompt contracts are enforced", run: testPromptContractsForFullInterview },
        { name: "role-specific resume project filtering is enforced", run: testRoleSpecificResumeProjectFiltering },
        { name: "coding/cs/system design prompt contracts are enforced", run: testPromptContractsForCodingCSAndSystemDesign },
        { name: "prompt assembly is cache-friendly and voice context updates stay compact", run: testPromptCacheFriendlyOrderingAndCompactVoiceContext },
        { name: "transition and end guards enforce flow quality", run: testTransitionAndEndGuards },
        { name: "end intent detection avoids thank-you false positives", run: testEndInterviewIntentDetection },
        { name: "dsa advance intent detection is conservative and explicit", run: testDsaAdvanceIntentDetection },
        { name: "turn guard signals detect move-on/unknown/repeat/sql context", run: testTurnGuardSignals },
        { name: "stage tool sanitizer rejects unavailable calls", run: testUnavailableToolCallsAreSanitizedPerStage },
        { name: "runtime prefetch-only guards reject missing caches", run: testPrefetchOnlyRuntimeGuards },
        { name: "resume intro exit depth guards block premature transitions", run: testResumeIntroExitDepthGuards },
        { name: "resume agenda state advances without loops", run: testResumeAgendaContracts },
        { name: "compatibility manifests and preflight contracts validate", run: testCompatibilityManifestContracts },
        { name: "prefetch state validator enforces manifest requirements", run: testPrefetchStateValidatorContracts },
        { name: "full interview module selection contracts are modular", run: testFullInterviewModuleSelectionContracts },
        { name: "role interview module selection contracts are modular", run: testRoleInterviewModuleSelectionContracts },
        { name: "voice/text prompt contracts use modular stage order", run: testVoicePromptUsesModularStageOrder },
    ];

    for (const test of tests) {
        await test.run();
        console.log(`PASS: ${test.name}`);
    }
}

run().catch((error) => {
    console.error("FAIL: interview flow regression checks", error);
    process.exit(1);
});
