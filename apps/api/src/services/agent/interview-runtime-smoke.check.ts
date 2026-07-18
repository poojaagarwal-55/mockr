import assert from "node:assert/strict";
import mongoose from "mongoose";
import { prisma } from "../../lib/prisma.js";
import { connectMongoDB } from "../../lib/mongoose.js";
import { buildSystemPrompt } from "./agent-prompts.js";
import { getInterviewTypeConfig } from "./interview-types/index.js";
import { getToolsForSession } from "./agent-tools.js";
import { initializeSession, getSessionState, cleanupSession } from "./interview-orchestrator.js";
import { validateStageTransition } from "./interview-state-machine.js";

type EmittedEvent = { event: string; payload: any };

async function shutdownConnections(): Promise<void> {
    try {
        await prisma.$disconnect();
    } catch (error) {
        console.warn("WARN: failed to disconnect Prisma after smoke checks", error);
    }

    try {
        if (mongoose.connection.readyState !== 0) {
            await mongoose.disconnect();
        }
    } catch (error) {
        console.warn("WARN: failed to disconnect MongoDB after smoke checks", error);
    }
}

function assertHasPattern(text: string, pattern: RegExp, message: string): void {
    assert(pattern.test(text), message);
}

async function createSmokeUserAndResume() {
    const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const email = `smoke_${stamp}@example.com`;

    const user = await prisma.user.create({
        data: {
            email,
            fullName: "Smoke Flow Candidate",
        },
    });

    const resume = await prisma.resume.create({
        data: {
            userId: user.id,
            fileName: "smoke-resume.pdf",
            fileUrl: "https://example.com/smoke-resume.pdf",
            analysis: {
                summary: {
                    name: "Smoke Flow Candidate",
                    currentRole: "SDE2",
                    currentCompany: "InterviewForge",
                    totalYearsExperience: 4,
                    projects: [
                        {
                            name: "Realtime Collaboration Platform",
                            description: "Built a websocket-first collaborative editor",
                            techStack: ["TypeScript", "Redis", "Postgres"],
                        },
                    ],
                    experience: [
                        {
                            role: "Software Engineer",
                            company: "InterviewForge",
                            duration: "2022-2026",
                        },
                    ],
                },
            },
        },
    });

    return { user, resume };
}

async function createSession(userId: string, type: "full_interview" | "coding" | "cs_fundamentals" | "system_design" | "behavioural", resumeId?: string) {
    const config = getInterviewTypeConfig(type);
    const firstStage = config.stages[0] || "INTRO";

    return prisma.interviewSession.create({
        data: {
            userId,
            resumeId: resumeId ?? null,
            type,
            role: "Software Engineer",
            level: "SDE2",
            mode: "mock",
            stage: firstStage,
            status: "PENDING",
        },
    });
}

function buildPromptFromState(state: any, stageOverride?: string): string {
    return buildSystemPrompt({
        interviewType: state.interviewType,
        role: state.role,
        level: state.level,
        stage: (stageOverride || state.currentStage) as any,
        resumeSummary: state.resumeSummary,
        currentQuestionTitle: state.currentQuestionTitle,
        codeSnapshot: state.codeSnapshot,
        codeLanguage: state.codeLanguage,
        sqlSnapshot: state.sqlSnapshot,
        sqlQuestionDescription: state.sqlQuestionDescription,
        sqlRoundCompleted: state.sqlRoundCompleted,
        rubricLite: state.rubricLite,
        canvasSnapshot: state.canvasSnapshot,
        prefetchedCSQuestions: state.prefetchedCSQuestions,
        prefetchedSDQuestion: state.prefetchedSDQuestion,
        prefetchedDSAQuestion: state.prefetchedDSAQuestion,
    });
}

async function runCodingInitializationSmoke(userId: string): Promise<void> {
    const session = await createSession(userId, "coding");
    const emitted: EmittedEvent[] = [];
    const emit = (event: string, payload: any) => emitted.push({ event, payload });

    try {
        const state = await initializeSession(session.id, emit, true);
        assert.equal(state.currentStage, "DSA", "Coding interview should start in DSA.");
        assert(state.lastFetchedQuestionId, "Coding interview should preload a DSA question ID.");

        const questionAssign = emitted.find((evt) => evt.event === "question:assign");
        assert(questionAssign, "Coding interview should emit question:assign on init.");
        assert.equal(questionAssign?.payload?.stage, "DSA");

        const prompt = buildPromptFromState(state, "DSA");
        assertHasPattern(prompt, /already loaded/i, "Coding prompt should state IDE is already loaded.");
        assertHasPattern(prompt, /approach BEFORE coding/i, "Coding prompt should enforce approach-first behavior.");
        assertHasPattern(prompt, /Code Submit Result/i, "Coding prompt should include submit-result evaluation behavior.");
        assertHasPattern(prompt, /time and space complexity/i, "Coding prompt should enforce complexity discussion.");
    } finally {
        cleanupSession(session.id);
        await prisma.interviewSession.deleteMany({ where: { id: session.id } });
    }
}

async function runFullInterviewInitializationSmoke(userId: string, resumeId: string): Promise<void> {
    const session = await createSession(userId, "full_interview", resumeId);
    const emit = () => {
        // no-op for this check
    };

    try {
        const state = await initializeSession(session.id, emit, true);
        assert.equal(state.currentStage, "INTRO", "Full interview should start in INTRO.");
        assert(state.prefetchedDSAQuestion, "Full interview should preload DSA question in advance.");
        assert((state.prefetchedCSQuestions?.size || 0) > 0, "Full interview should preload CS fundamentals question bank.");

        const hasSqlCached = [...state.cachedQuestionData.values()].some((q: any) => q.category === "SQL");
        assert(hasSqlCached, "Full interview should preload one SQL question into cache.");
        assert(state.resumeSummary?.name === "Smoke Flow Candidate", "Resume summary should be hydrated for intro questioning.");

        const introPrompt = buildPromptFromState(state, "INTRO");
        assertHasPattern(introPrompt, /Candidate's Resume Summary/i, "Full intro prompt should include resume summary section.");
        assertHasPattern(introPrompt, /Resume deep-dive/i, "Full intro prompt should enforce resume follow-up depth.");

        const dsaPrompt = buildPromptFromState(state, "DSA");
        assertHasPattern(dsaPrompt, /Call open_ide .* immediately/i, "Full DSA prompt should require immediate IDE open.");
        assertHasPattern(dsaPrompt, /approach BEFORE/i, "Full DSA prompt should require approach-first questioning.");
        assertHasPattern(dsaPrompt, /Code Run Result/i, "Full DSA prompt should include run-result handling.");

        const fundamentalsPrompt = buildPromptFromState(state, "FUNDAMENTALS");
        assertHasPattern(fundamentalsPrompt, /DBMS theory/i, "Full fundamentals prompt should include DBMS phase.");
        assertHasPattern(fundamentalsPrompt, /SQL practical round/i, "Full fundamentals prompt should include SQL phase.");
        assertHasPattern(fundamentalsPrompt, /Operating Systems/i, "Full fundamentals prompt should include OS phase.");
        assertHasPattern(fundamentalsPrompt, /Computer Networks/i, "Full fundamentals prompt should include CN phase.");
        assertHasPattern(fundamentalsPrompt, /OOPS/i, "Full fundamentals prompt should include OOPS phase.");
    } finally {
        cleanupSession(session.id);
        await prisma.interviewSession.deleteMany({ where: { id: session.id } });
    }
}

async function runCSFundamentalsInitializationSmoke(userId: string): Promise<void> {
    const session = await createSession(userId, "cs_fundamentals");
    const emit = () => {
        // no-op
    };

    try {
        const state = await initializeSession(session.id, emit, true);
        assert.equal(state.currentStage, "INTRO");

        const keys = [...(state.prefetchedCSQuestions?.keys() || [])];
        for (const key of ["DBMS", "OS", "CN", "OOPS", "SQL_query"]) {
            assert(keys.includes(key), `CS fundamentals prefetch should include ${key}.`);
        }

        const fundamentalsPrompt = buildPromptFromState(state, "FUNDAMENTALS");
        assertHasPattern(fundamentalsPrompt, /PHASE 1: DBMS Theory/i, "CS fundamentals prompt should start from DBMS phase.");
        assertHasPattern(fundamentalsPrompt, /PHASE 2: SQL Query Round/i, "CS fundamentals prompt should include SQL phase next.");
        assertHasPattern(fundamentalsPrompt, /PHASE 3: Operating Systems/i, "CS fundamentals prompt should include OS phase.");
        assertHasPattern(fundamentalsPrompt, /PHASE 4: Computer Networks/i, "CS fundamentals prompt should include CN phase.");
        assertHasPattern(fundamentalsPrompt, /PHASE 5: Object-Oriented Programming/i, "CS fundamentals prompt should include OOPS phase.");
        assertHasPattern(fundamentalsPrompt, /open_sql_editor/i, "CS fundamentals prompt should enforce SQL editor opening.");
        assertHasPattern(fundamentalsPrompt, /close_panel/i, "CS fundamentals prompt should enforce closing SQL panel before OS.");
    } finally {
        cleanupSession(session.id);
        await prisma.interviewSession.deleteMany({ where: { id: session.id } });
    }
}

async function runSystemDesignInitializationSmoke(userId: string, resumeId: string): Promise<void> {
    const session = await createSession(userId, "system_design", resumeId);
    const emit = () => {
        // no-op
    };

    try {
        const state = await initializeSession(session.id, emit, true);
        assert.equal(state.currentStage, "INTRO");
        assert(state.prefetchedSDQuestion, "System design interview should preload one design question.");
        assert(state.currentQuestionTitle, "System design prefetch should set current question title.");

        const sdPrompt = buildPromptFromState(state, "SYSTEM_DESIGN");
        assertHasPattern(sdPrompt, /YOUR DESIGN PROBLEM - USE THIS EXACT PROBLEM/i, "System design prompt should inject the exact preloaded problem.");
        assertHasPattern(sdPrompt, /whiteboard are ALREADY loaded/i, "System design prompt should indicate scratchpad is pre-opened by server flow.");

        const blockedTransition = validateStageTransition({
            interviewType: "system_design" as any,
            currentStage: "SYSTEM_DESIGN" as any,
            nextStage: "CLOSING" as any,
            scratchpadOpened: false,
            systemDesignExchangeCount: 0,
        });
        assert.equal(blockedTransition.allowed, false, "System design should block leaving before scratchpad usage.");

        const allowedTransition = validateStageTransition({
            interviewType: "system_design" as any,
            currentStage: "SYSTEM_DESIGN" as any,
            nextStage: "CLOSING" as any,
            scratchpadOpened: true,
            systemDesignExchangeCount: 3,
        });
        assert.equal(allowedTransition.allowed, true, "System design should allow leaving after minimum discussion depth.");
    } finally {
        cleanupSession(session.id);
        await prisma.interviewSession.deleteMany({ where: { id: session.id } });
    }
}

async function runBehaviouralInitializationSmoke(userId: string): Promise<void> {
    const session = await createSession(userId, "behavioural");
    const emit = () => {
        // no-op
    };

    try {
        const state = await initializeSession(session.id, emit, true);
        assert.equal(state.currentStage, "INTRO");

        const behaviouralTools = getToolsForSession("behavioural" as any, "BEHAVIOURAL" as any)
            .filter((tool) => tool.type === "function")
            .map((tool) => tool.function.name);
        assert(!behaviouralTools.includes("fetch_question"), "Behavioural stage tools must not include fetch_question.");

        const behaviouralPrompt = buildPromptFromState(state, "BEHAVIOURAL");
        assertHasPattern(behaviouralPrompt, /prompt-driven/i, "Behavioural prompt should stay instruction-driven.");
    } finally {
        cleanupSession(session.id);
        await prisma.interviewSession.deleteMany({ where: { id: session.id } });
    }
}

async function run(): Promise<void> {
    await connectMongoDB();
    let userId: string | null = null;

    try {
        const { user, resume } = await createSmokeUserAndResume();
        userId = user.id;

        await runFullInterviewInitializationSmoke(user.id, resume.id);
        console.log("PASS: full interview initialization + flow contract");

        await runCodingInitializationSmoke(user.id);
        console.log("PASS: coding interview initialization + flow contract");

        await runCSFundamentalsInitializationSmoke(user.id);
        console.log("PASS: cs fundamentals initialization + flow contract");

        await runSystemDesignInitializationSmoke(user.id, resume.id);
        console.log("PASS: system design initialization + flow contract");

        await runBehaviouralInitializationSmoke(user.id);
        console.log("PASS: behavioural initialization + flow contract");
    } finally {
        if (userId) {
            await prisma.user.deleteMany({ where: { id: userId } });
        }
        await shutdownConnections();
    }
}

run().catch((error) => {
    console.error("FAIL: interview runtime smoke checks", error);
    process.exit(1);
});
