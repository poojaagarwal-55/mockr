import assert from "node:assert/strict";
import type { ToolContext } from "./agent-tools.js";
import { getToolsForSession } from "./agent-tools.js";
import { handleToolCall } from "./tool-handlers.js";
import { buildSystemPrompt } from "./agent-prompts.js";
import { behaviouralConfig } from "./interview-types/behavioural.js";

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
    return {
        sessionId: "session_test_behavioural",
        userId: "user_test_behavioural",
        interviewType: "behavioural" as any,
        currentStage: "BEHAVIOURAL" as any,
        askedQuestionIds: [],
        role: "Software Engineer",
        level: "SDE2",
        stageOrder: ["INTRO", "BEHAVIOURAL", "CLOSING"] as any,
        lastFetchedQuestionId: null,
        lastFetchedLanguage: null,
        prefetchedDSAQuestion: null,
        cachedQuestionData: new Map<string, any>(),
        emit: () => {
            // No-op for test validation.
        },
        ...overrides,
    };
}

function testBehaviouralToolsDoNotExposeFetchQuestion(): void {
    const tools = getToolsForSession("behavioural" as any, "BEHAVIOURAL" as any);
    const toolNames = tools
        .filter((tool) => tool.type === "function")
        .map((tool) => tool.function.name);

    assert(!toolNames.includes("fetch_question"), "BEHAVIOURAL stage should not expose fetch_question tool.");
    assert(toolNames.includes("transition_stage"), "BEHAVIOURAL stage should expose transition_stage tool.");
}

function testBehaviouralConfigIsPromptDriven(): void {
    const behaviouralTools = behaviouralConfig.stageTools.BEHAVIOURAL || [];
    assert(!behaviouralTools.includes("fetch_question"), "Behavioural config must not include fetch_question in BEHAVIOURAL stage tools.");

    const stagePrompt = behaviouralConfig.stagePrompts.BEHAVIOURAL || "";
    assert.match(stagePrompt, /prompt-driven/i, "Behavioural stage prompt should explicitly indicate prompt-driven flow.");
    assert.doesNotMatch(stagePrompt, /fetch_question function with category\s*"Behavioral"/i);
}

function testBehaviouralSystemPromptHasNoBehaviouralQuestionBankSection(): void {
    const prompt = buildSystemPrompt({
        interviewType: "behavioural" as any,
        role: "Software Engineer",
        level: "SDE2",
        stage: "BEHAVIOURAL" as any,
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
    });

    assert.doesNotMatch(prompt, /QUESTION BANK — Behavioural/i);
}

async function testBehaviouralFetchIsBlockedWhenUnavailable(): Promise<void> {
    const ctx = makeContext();
    const result = await handleToolCall("fetch_question", { category: "Behavioral" }, ctx);
    assert.match(result, /Tool fetch_question is not allowed in stage BEHAVIOURAL/i);
}

async function testSQLFetchRequiresPrefetchedCache(): Promise<void> {
    const ctx = makeContext({
        interviewType: "cs_fundamentals" as any,
        currentStage: "FUNDAMENTALS" as any,
    });

    const result = await handleToolCall("fetch_question", { category: "SQL" }, ctx);
    assert.match(result, /No SQL question available in pre-fetched session cache/i);
}

async function testDSAFetchIsBlockedWhenUnavailable(): Promise<void> {
    const ctx = makeContext({
        interviewType: "full_interview" as any,
        currentStage: "DSA" as any,
        stageOrder: ["INTRO", "DSA", "FUNDAMENTALS", "CLOSING"] as any,
    });

    const result = await handleToolCall("fetch_question", { category: "DSA" }, ctx);
    assert.match(result, /Tool fetch_question is not allowed in stage DSA/i);
}

async function testOpenIDEIsBlockedWhenUnavailable(): Promise<void> {
    const ctx = makeContext({
        interviewType: "coding" as any,
        currentStage: "DSA" as any,
        stageOrder: ["DSA"] as any,
    });

    const result = await handleToolCall("open_ide", { questionId: "missing_q", language: "cpp" }, ctx);
    assert.match(result, /Tool open_ide is not allowed in stage DSA/i);
}

async function testOpenSQLEditorRequiresCachedQuestion(): Promise<void> {
    const ctx = makeContext({
        interviewType: "cs_fundamentals" as any,
        currentStage: "FUNDAMENTALS" as any,
        stageOrder: ["INTRO", "FUNDAMENTALS", "CLOSING"] as any,
    });

    const result = await handleToolCall("open_sql_editor", {}, ctx);
    assert.match(result, /No pre-fetched SQL question is available in session cache/i);
}

async function run(): Promise<void> {
    const tests: Array<{ name: string; run: () => void | Promise<void> }> = [
        {
            name: "behavioural stage tools exclude fetch_question",
            run: testBehaviouralToolsDoNotExposeFetchQuestion,
        },
        {
            name: "behavioural interview config remains prompt-driven",
            run: testBehaviouralConfigIsPromptDriven,
        },
        {
            name: "behavioural system prompt does not inject behavioural question bank",
            run: testBehaviouralSystemPromptHasNoBehaviouralQuestionBankSection,
        },
        {
            name: "behavioural disallowed fetch_question is blocked",
            run: testBehaviouralFetchIsBlockedWhenUnavailable,
        },
        {
            name: "SQL fetch requires pre-fetched cache",
            run: testSQLFetchRequiresPrefetchedCache,
        },
        {
            name: "DSA fetch is blocked when unavailable",
            run: testDSAFetchIsBlockedWhenUnavailable,
        },
        {
            name: "open_ide is blocked when unavailable",
            run: testOpenIDEIsBlockedWhenUnavailable,
        },
        {
            name: "open_sql_editor requires cached SQL question",
            run: testOpenSQLEditorRequiresCachedQuestion,
        },
    ];

    for (const test of tests) {
        await test.run();
        console.log(`PASS: ${test.name}`);
    }
}

run().catch((error) => {
    console.error("FAIL: behavioural flow regression checks", error);
    process.exit(1);
});
