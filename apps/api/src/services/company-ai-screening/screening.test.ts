import {
    buildScreeningBlueprint,
    validateRubricWeights,
    validateScreeningConfig,
    bankTypeForPhase,
    phaseTypeForCategory,
    POOL_BACKED_PHASE_TYPES,
    type ScreeningBlueprint,
} from "./blueprint.js";
import {
    applyIntegrityPenalty,
    computeWeightedScore,
    recommendationFromScore,
    signalFromScore,
} from "./scoring.js";
import { generateCompanyAiScreeningReport } from "./report.js";
import { buildCompanyScreeningRuntimeDirective, type CompanyScreeningRuntimeContext } from "./prompt.js";
import type { ScreeningAnswerRecord } from "./runtime.js";
import {
    computeScreeningPlan,
    maxFollowUpsForBudget,
    planResumeItems,
    decideScreeningPointer,
    advanceScreeningProgress,
    createScreeningProgress,
} from "./pacing.js";
import { normalizeScreeningDraft, generateScreeningBlueprintDraft } from "./config-agent.js";
import { blueprintToModuleConfig, stageForPhaseType } from "./stage-mapping.js";
import {
    resolveScreeningAuthoritativeTurn,
    isScreeningSkip,
    phaseHandoffPrompt,
    seedScreeningResumeAgenda,
    driveScreeningResumeAgendaTurn,
    buildBehavioralResumeContext,
    extractCandidateProjectFacts,
    mergeCandidateProjectsIntoResume,
} from "./screening-turn.js";
import { buildScreeningPhaseSupplement } from "./phase-runtime.js";
import { collectScreeningSecrets, redactScreeningLeak, detectScreeningLeak, buildSecretShingles } from "./leak-guard.js";
import { screeningToolNamesForPhase } from "../agent/agent-tools.js";
import { validateToolCallSequence, type ToolSequenceContext } from "../agent/tool-call-sequencer.js";

function answer(questionId: string, text: string, followUpIndex = 0): ScreeningAnswerRecord {
    return {
        phaseIndex: 0,
        questionIndex: 0,
        followUpIndex,
        phaseType: "resume_project",
        questionId,
        prompt: "prompt",
        answer: text,
        answeredAt: new Date(0).toISOString(),
    };
}

const RICH_ANSWER =
    "I designed and shipped a caching layer using Redis with a write-through strategy, measured a forty percent latency drop, and personally owned the rollout and on-call for it across two quarters.";

describe("blueprint rubric normalization", () => {
    it("rescales non-100 weights to sum to 100", () => {
        const blueprint = buildScreeningBlueprint({
            rubric: [
                { id: "d1", label: "D1", weight: 30, competencyTags: ["a"] },
                { id: "d2", label: "D2", weight: 30, competencyTags: ["b"] },
            ],
            questions: [],
        });
        const total = blueprint.rubricDimensions.reduce((s, d) => s + d.weight, 0);
        expect(total).toBe(100);
    });

    it("splits evenly when all weights are zero (never all-zero at runtime)", () => {
        const blueprint = buildScreeningBlueprint({
            rubric: [
                { id: "d1", label: "D1", weight: 0, competencyTags: ["a"] },
                { id: "d2", label: "D2", weight: 0, competencyTags: ["b"] },
                { id: "d3", label: "D3", weight: 0, competencyTags: ["c"] },
            ],
            questions: [],
        });
        const total = blueprint.rubricDimensions.reduce((s, d) => s + d.weight, 0);
        expect(total).toBe(100);
        expect(blueprint.rubricDimensions.every((d) => d.weight > 0)).toBe(true);
    });

    it("does NOT cap on the save/precompiled path — an explicit 50% weight is preserved", () => {
        // buildScreeningBlueprint is the save path; recruiter-chosen weights must survive.
        const blueprint = buildScreeningBlueprint({
            rubric: [
                { id: "sd", label: "System design", weight: 50, competencyTags: ["system_design"] },
                { id: "ps", label: "Problem solving", weight: 33, competencyTags: ["reasoning"] },
                { id: "comm", label: "Communication", weight: 17, competencyTags: ["comm"] },
            ],
            questions: [],
        });
        expect(blueprint.rubricDimensions.reduce((s, d) => s + d.weight, 0)).toBe(100);
        expect(blueprint.rubricDimensions.find((d) => d.id === "sd")!.weight).toBe(50);
    });
});

describe("guardrails apply to the agent default but never override the recruiter", () => {
    const bankRef = (id: string, type: "dsa" | "sql" | "system_design") => ({ id, type, source: "platform" as const });
    // resume + coding + system_design; model proposes a dominant 50% dim and short deep phases.
    const modelResponse = (extra: Record<string, unknown> = {}) => ({
        reply: "Proposed.",
        ...extra,
        blueprint: {
            title: "Backend screen",
            durationMinutes: 60,
            rubric: [
                { id: "sd", label: "System design", weight: 50, competencyTags: ["system_design"] },
                { id: "ps", label: "Problem solving", weight: 33, competencyTags: ["reasoning"] },
                { id: "comm", label: "Communication", weight: 17, competencyTags: ["comm"] },
            ],
            phases: [
                { type: "resume", durationMinutes: 20, questions: [{ prompt: "p", expectedPoints: ["ownership"] }] },
                { type: "coding", durationMinutes: 20, questions: [{ prompt: "framing", expectedPoints: ["complexity"], bankQuestion: bankRef("c1", "dsa") }] },
                { type: "system_design", durationMinutes: 20, questions: [{ prompt: "Design X.", expectedPoints: ["sharding"], bankQuestion: bankRef("s1", "system_design") }] },
            ],
        },
    });

    it("caps a dominant dimension to ~40% by default (sums to 100)", () => {
        const { draft } = normalizeScreeningDraft(modelResponse(), { messages: [] });
        expect(draft.rubricDimensions.reduce((s, d) => s + d.weight, 0)).toBe(100);
        expect(Math.max(...draft.rubricDimensions.map((d) => d.weight))).toBeLessThanOrEqual(40);
    });

    it("HONORS an explicit 50% weight when recruiterSetExactValues is set", () => {
        const { draft } = normalizeScreeningDraft(modelResponse({ recruiterSetExactValues: true }), { messages: [] });
        expect(draft.rubricDimensions.reduce((s, d) => s + d.weight, 0)).toBe(100);
        expect(draft.rubricDimensions.find((d) => d.id === "sd")!.weight).toBe(50);
    });

    it("floors coding & system design above the resume phase by default", () => {
        const { draft } = normalizeScreeningDraft(modelResponse(), { messages: [] });
        expect(draft.phases.reduce((s, p) => s + p.durationMinutes, 0)).toBe(60);
        const dur = (t: string) => draft.phases.find((p) => p.type === t)!.durationMinutes;
        expect(dur("coding")).toBeGreaterThan(dur("resume_project"));
        expect(dur("system_design")).toBeGreaterThan(dur("resume_project"));
    });

    it("HONORS explicit per-phase durations when recruiterSetExactValues is set", () => {
        const { draft } = normalizeScreeningDraft(modelResponse({ recruiterSetExactValues: true }), { messages: [] });
        // 20/20/20 requested -> preserved exactly, no floor reshaping.
        expect(draft.phases.every((p) => p.durationMinutes === 20)).toBe(true);
    });
});

describe("validateScreeningConfig: system_design is bank-backed", () => {
    const baseRubric = [{ id: "d1", label: "D1", weight: 100, competencyTags: ["a"] }];

    it("rejects a system_design question with no attached bank question", () => {
        const result = validateScreeningConfig({
            rubric: baseRubric,
            questions: [
                { id: "q1", category: "system_design", prompt: "Design a URL shortener.", expectedPoints: [{ id: "p1", text: "sharding", competencyTags: ["a"] }] },
            ],
        });
        expect(result.valid).toBe(false);
        expect(result.errors.join(" ")).toMatch(/system design/i);
    });

    it("accepts a system_design question that references a bank question", () => {
        const result = validateScreeningConfig({
            rubric: baseRubric,
            questions: [
                { id: "q1", category: "system_design", prompt: "", expectedPoints: [{ id: "p1", text: "sharding", competencyTags: ["a"] }], bankQuestion: { id: "s1", type: "system_design", source: "platform" } },
            ],
        });
        expect(result.valid).toBe(true);
    });
});

describe("pacing: server-authoritative time & depth budgets", () => {
    const rubric = [{ id: "d1", label: "D1", weight: 100, competencyTags: ["a"] }];
    const twoResumeQuestions = [
        { id: "q1", category: "resume", prompt: "p1", expectedPoints: [], followUpPolicy: { maxFollowUps: 2 } },
        { id: "q2", category: "resume", prompt: "p2", expectedPoints: [], followUpPolicy: { maxFollowUps: 2 } },
    ];

    it("(b) overall usable time = total minus a clamped closing buffer", () => {
        const plan = computeScreeningPlan(buildScreeningBlueprint({ rubric, durationMinutes: 30, questions: twoResumeQuestions }));
        expect(plan.totalMs).toBe(30 * 60_000);
        expect(plan.closingBufferMs).toBeLessThanOrEqual(90_000);
        expect(plan.usableMs).toBe(plan.totalMs - plan.closingBufferMs);
    });

    it("per-question time budget scales with total duration (same question mix)", () => {
        const short = computeScreeningPlan(buildScreeningBlueprint({ rubric, durationMinutes: 10, questions: twoResumeQuestions }));
        const long = computeScreeningPlan(buildScreeningBlueprint({ rubric, durationMinutes: 30, questions: twoResumeQuestions }));
        expect(long.phases[0].questions[0].budgetMs).toBeGreaterThan(short.phases[0].questions[0].budgetMs);
    });

    it("depth throttles when many questions compete for little time, opens up when time is ample", () => {
        const manyQuestions = Array.from({ length: 6 }, (_, i) => (
            { id: `q${i + 1}`, category: "resume", prompt: "p", expectedPoints: [], followUpPolicy: { maxFollowUps: 2 } }
        ));
        const starved = computeScreeningPlan(buildScreeningBlueprint({ rubric, durationMinutes: 10, questions: manyQuestions }));
        const ample = computeScreeningPlan(buildScreeningBlueprint({ rubric, durationMinutes: 30, questions: twoResumeQuestions }));
        expect(starved.phases[0].questions[0].maxFollowUps).toBeLessThan(ample.phases[0].questions[0].maxFollowUps);
        expect(ample.phases[0].questions[0].maxFollowUps).toBe(2); // reaches the recruiter ceiling when time is ample
    });

    it("(a) per-phase split weights coding heavier than resume", () => {
        const plan = computeScreeningPlan(buildScreeningBlueprint({
            rubric,
            durationMinutes: 30,
            questions: [
                { id: "r1", category: "resume", prompt: "p", expectedPoints: [], followUpPolicy: { maxFollowUps: 2 } },
                { id: "c1", category: "coding", prompt: "p", expectedPoints: [], bankQuestion: { id: "x", type: "dsa", source: "platform" }, followUpPolicy: { maxFollowUps: 2 } },
            ],
        }));
        const resumePhase = plan.phases.find((p) => p.type === "resume_project")!;
        const codingPhase = plan.phases.find((p) => p.type === "coding")!;
        expect(codingPhase.budgetMs).toBeGreaterThan(resumePhase.budgetMs);
    });

    it("maxFollowUpsForBudget never exceeds the recruiter ceiling", () => {
        expect(maxFollowUpsForBudget(60 * 60_000, 2)).toBe(2);
        expect(maxFollowUpsForBudget(60 * 60_000, 0)).toBe(0);
        expect(maxFollowUpsForBudget(70_000, 2)).toBe(0);
    });

    it("planResumeItems covers more items when given more time", () => {
        expect(planResumeItems(3 * 60_000, 5).itemsToCover).toBeLessThan(planResumeItems(15 * 60_000, 5).itemsToCover);
        expect(planResumeItems(3 * 60_000, 5).itemsToCover).toBeGreaterThanOrEqual(1);
        expect(planResumeItems(60 * 60_000, 2).itemsToCover).toBe(2); // capped by available items
    });

    it("decideScreeningPointer force-closes once usable time is gone", () => {
        const plan = computeScreeningPlan(buildScreeningBlueprint({ rubric, durationMinutes: 10, questions: twoResumeQuestions }));
        const decision = decideScreeningPointer({
            plan,
            elapsedMs: plan.usableMs + 1,
            answeredQuestionIds: new Set(),
            followUpsUsedByQuestion: new Map(),
            currentQuestionElapsedMs: 0,
        });
        expect(decision.forceClose).toBe(true);
        expect(decision.currentQuestionId).toBeNull();
    });

    it("decideScreeningPointer force-advances when a question's time budget is spent (server skip)", () => {
        const plan = computeScreeningPlan(buildScreeningBlueprint({ rubric, durationMinutes: 30, questions: twoResumeQuestions }));
        const q1Budget = plan.phases[0].questions[0].budgetMs;
        const decision = decideScreeningPointer({
            plan,
            elapsedMs: q1Budget + 1,
            answeredQuestionIds: new Set(), // never answered, but time is up
            followUpsUsedByQuestion: new Map(),
            currentQuestionElapsedMs: q1Budget + 1,
        });
        expect(decision.currentQuestionId).toBe("q1");
        expect(decision.forceAdvanceQuestion).toBe(true);
    });

    it("advanceScreeningProgress: server advances to next question once current is answered + exhausted", () => {
        const plan = computeScreeningPlan(buildScreeningBlueprint({ rubric, durationMinutes: 30, questions: twoResumeQuestions }));
        const progress = createScreeningProgress(0);
        // Turn 1 (opening, no answer yet): server assigns q1.
        let res = advanceScreeningProgress({ plan, progress, startedAtMs: 0, nowMs: 1_000, candidateAnswered: false });
        expect(res.decision.currentQuestionId).toBe("q1");
        // Candidate answers q1 main + both follow-ups across turns.
        res = advanceScreeningProgress({ plan, progress, startedAtMs: 0, nowMs: 2_000, candidateAnswered: true }); // main
        res = advanceScreeningProgress({ plan, progress, startedAtMs: 0, nowMs: 3_000, candidateAnswered: true }); // fu1
        res = advanceScreeningProgress({ plan, progress, startedAtMs: 0, nowMs: 4_000, candidateAnswered: true }); // fu2
        expect(res.decision.currentQuestionId).toBe("q2");
    });

    it("advanceScreeningProgress: server force-skips a question whose time budget is blown, without an answer", () => {
        const plan = computeScreeningPlan(buildScreeningBlueprint({ rubric, durationMinutes: 30, questions: twoResumeQuestions }));
        const progress = createScreeningProgress(0);
        advanceScreeningProgress({ plan, progress, startedAtMs: 0, nowMs: 0, candidateAnswered: false }); // assigns q1 at t=0
        const q1Budget = plan.phases[0].questions[0].budgetMs;
        // Jump past q1's budget but stay within overall usable time.
        const res = advanceScreeningProgress({ plan, progress, startedAtMs: 0, nowMs: q1Budget + 5_000, candidateAnswered: false });
        expect(res.decision.currentQuestionId).toBe("q2");
        expect(progress.answered.has("q1")).toBe(true); // q1 marked covered (skipped on time)
    });

    it("advanceScreeningProgress: force-closes when overall usable time is exhausted", () => {
        const plan = computeScreeningPlan(buildScreeningBlueprint({ rubric, durationMinutes: 10, questions: twoResumeQuestions }));
        const progress = createScreeningProgress(0);
        const res = advanceScreeningProgress({ plan, progress, startedAtMs: 0, nowMs: plan.usableMs + 1, candidateAnswered: false });
        expect(res.forceClose).toBe(true);
        expect(res.decision.currentQuestionId).toBeNull();
    });

    it("decideScreeningPointer points at the first unanswered question and bounds follow-ups", () => {
        const plan = computeScreeningPlan(buildScreeningBlueprint({ rubric, durationMinutes: 30, questions: twoResumeQuestions }));
        const decision = decideScreeningPointer({
            plan,
            elapsedMs: 1_000,
            answeredQuestionIds: new Set(["q1"]),
            followUpsUsedByQuestion: new Map([["q1", 2]]), // q1 exhausted
            currentQuestionElapsedMs: 1_000,
        });
        expect(decision.currentQuestionId).toBe("q2");
        expect(decision.forceClose).toBe(false);
    });
});

describe("authoritative runtime directive", () => {
    const rubric = [{ id: "d1", label: "D1", weight: 100, competencyTags: ["a"] }];
    function contextFor(questions: any[]): CompanyScreeningRuntimeContext {
        return {
            version: 1,
            roundCandidateId: "rc1",
            jobRoundId: "jr1",
            applicationId: "app1",
            blueprintSnapshot: buildScreeningBlueprint({ rubric, durationMinutes: 30, questions }),
        };
    }

    it("renders the server-assigned current question as the hard command", () => {
        const ctx = contextFor([{ id: "q1", category: "resume", prompt: "p1", expectedPoints: [], followUpPolicy: { maxFollowUps: 2 } }]);
        const directive = buildCompanyScreeningRuntimeDirective(ctx, "BEHAVIOURAL", null, {
            currentQuestionId: "q1",
            currentPhaseTitle: "Resume",
            currentPrompt: "Probe their most relevant project.",
            followUpsRemaining: 1,
            forceClose: false,
            questionTimeRemainingSec: 240,
            overallTimeRemainingSec: 1500,
            groundingBlock: "Resume grounding — [PROJECT] Redis cache",
        });
        expect(directive).toContain("Current Turn (server-authoritative)");
        expect(directive).toContain("Probe their most relevant project.");
        expect(directive).toContain("Follow-ups remaining on this question: 1");
        expect(directive).toContain("Resume grounding");
        expect(directive).toContain("the server advances"); // explicit no-skip instruction
    });

    it("commands closing when the server force-closes", () => {
        const ctx = contextFor([{ id: "q1", category: "resume", prompt: "p1", expectedPoints: [], followUpPolicy: { maxFollowUps: 2 } }]);
        const directive = buildCompanyScreeningRuntimeDirective(ctx, "BEHAVIOURAL", null, {
            currentQuestionId: null,
            currentPrompt: "",
            followUpsRemaining: 0,
            forceClose: true,
            questionTimeRemainingSec: 0,
            overallTimeRemainingSec: 0,
        });
        expect(directive).toContain("call end_interview");
        expect(directive).not.toContain("Ask now:");
    });

    it("offers the company/role questions turn before ending (closingMode=offer)", () => {
        const ctx = contextFor([{ id: "q1", category: "behavioral", prompt: "p1", expectedPoints: [], followUpPolicy: { maxFollowUps: 1 } }]);
        const directive = buildCompanyScreeningRuntimeDirective(ctx, "BEHAVIOURAL", null, {
            currentQuestionId: null,
            currentPrompt: "",
            followUpsRemaining: 0,
            forceClose: true,
            closingMode: "offer",
            questionTimeRemainingSec: 0,
            overallTimeRemainingSec: 0,
        });
        expect(directive).toMatch(/questions about the company or the role/i);
        expect(directive).toMatch(/do not call end_interview yet/i);
        expect(directive).not.toContain("Ask now:");
    });

    it("ends after the company/role offer (closingMode=final)", () => {
        const ctx = contextFor([{ id: "q1", category: "behavioral", prompt: "p1", expectedPoints: [], followUpPolicy: { maxFollowUps: 1 } }]);
        const directive = buildCompanyScreeningRuntimeDirective(ctx, "CLOSING", null, {
            currentQuestionId: null,
            currentPrompt: "",
            followUpsRemaining: 0,
            forceClose: true,
            closingMode: "final",
            questionTimeRemainingSec: 0,
            overallTimeRemainingSec: 0,
        });
        expect(directive).toMatch(/call end_interview now/i);
    });
});

describe("resume phase: no recruiter prompt required", () => {
    const rubric = [{ id: "d1", label: "D1", weight: 100, competencyTags: ["a"] }];

    it("accepts a resume question with an empty prompt (auto-grounded at runtime)", () => {
        const result = validateScreeningConfig({
            rubric,
            questions: [{ id: "q1", category: "resume", prompt: "", expectedPoints: [] }],
        });
        expect(result.valid).toBe(true);
    });

    it("still rejects a coding question with no bank reference (resume relaxation is scoped)", () => {
        const result = validateScreeningConfig({
            rubric,
            questions: [{ id: "q1", category: "coding", prompt: "", expectedPoints: [] }],
        });
        expect(result.valid).toBe(false);
        expect(result.errors.join(" ")).toMatch(/question bank/i);
    });

    it("carries resume focus flags through normalization", () => {
        const blueprint = buildScreeningBlueprint({
            rubric,
            questions: [{ id: "q1", category: "resume", prompt: "", expectedPoints: [], followUpPolicy: { maxFollowUps: 2, askImpact: false } }],
        });
        const policy = blueprint.phases[0].questions[0].followUpPolicy;
        expect(policy.askImpact).toBe(false);
        expect(policy.askTechnicalDepth).toBe(true);
        expect(policy.askOwnershipVerification).toBe(true);
    });
});

describe("validateRubricWeights", () => {
    it("rejects weights that do not sum to 100", () => {
        expect(validateRubricWeights([{ weight: 40 }, { weight: 40 }]).valid).toBe(false);
    });
    it("rejects an all-zero rubric", () => {
        expect(validateRubricWeights([{ weight: 0 }, { weight: 0 }]).valid).toBe(false);
    });
    it("accepts a valid rubric", () => {
        expect(validateRubricWeights([{ weight: 60 }, { weight: 40 }]).valid).toBe(true);
    });
});

describe("validateScreeningConfig + bank questions", () => {
    const rubric = [{ id: "d1", label: "D1", weight: 100, competencyTags: ["a"] }];

    it("requires a bank question for coding questions", () => {
        const result = validateScreeningConfig({
            rubric,
            questions: [{ id: "q1", category: "coding", prompt: "solve", expectedPoints: [] }],
        });
        expect(result.valid).toBe(false);
        expect(result.errors.join(" ")).toMatch(/question bank/i);
    });

    it("attaches the bank reference and drops difficulty/timeLimit", () => {
        const blueprint = buildScreeningBlueprint({
            rubric,
            questions: [
                {
                    id: "q1",
                    category: "coding",
                    prompt: "solve",
                    difficulty: "hard",
                    timeLimitMinutes: 40,
                    expectedPoints: [{ id: "p1", text: "uses a hashmap", rubricDimensionId: "d1" }],
                    bankQuestion: { id: "mongoid123", type: "dsa" },
                },
            ],
        });
        const question = blueprint.phases.flatMap((p) => p.questions)[0];
        expect(question.bankQuestion).toEqual({ id: "mongoid123", type: "dsa", source: "company", title: null });
        expect((question as any).difficulty).toBeUndefined();
        expect((question as any).timeLimitMinutes).toBeUndefined();
    });
});

describe("scoring engine", () => {
    it("computes a rubric-weighted overall, not a plain average", () => {
        const overall = computeWeightedScore([
            { weight: 70, score: 80 },
            { weight: 30, score: 10 },
        ]);
        expect(overall).toBe(59); // (80*70 + 10*30) / 100
    });

    it("normalizes by total weight when weights do not sum to 100", () => {
        expect(computeWeightedScore([{ weight: 1, score: 80 }, { weight: 1, score: 40 }])).toBe(60);
    });

    it("applies the documented integrity penalty", () => {
        // integrity 60 -> penalty = (100-60)*0.25 = 10
        expect(applyIntegrityPenalty(80, 60)).toBe(70);
        expect(applyIntegrityPenalty(80, null)).toBe(80);
    });

    it("maps scores to recommendations at documented thresholds", () => {
        expect(recommendationFromScore(90, true)).toBe("advance");
        expect(recommendationFromScore(60, true)).toBe("review");
        expect(recommendationFromScore(40, true)).toBe("hold");
        expect(recommendationFromScore(10, true)).toBe("reject");
        expect(recommendationFromScore(90, false)).toBe("insufficient_evidence");
    });

    it("maps scores to coarse signals", () => {
        expect(signalFromScore(85)).toBe("strong");
        expect(signalFromScore(0)).toBe("not_observed");
    });
});

describe("deterministic report (no LLM key)", () => {
    const blueprint: ScreeningBlueprint = buildScreeningBlueprint({
        title: "Test screen",
        durationMinutes: 30,
        rubric: [
            { id: "d1", label: "Technical", weight: 70, competencyTags: ["tech"] },
            { id: "d2", label: "Communication", weight: 30, competencyTags: ["comm"] },
        ],
        questions: [
            {
                id: "q1",
                category: "resume",
                prompt: "Tell me about your strongest project.",
                expectedPoints: [{ id: "p1", text: "ownership", rubricDimensionId: "d1" }],
            },
            {
                id: "q2",
                category: "resume",
                prompt: "How do you communicate tradeoffs?",
                expectedPoints: [{ id: "p2", text: "clarity", rubricDimensionId: "d2" }],
            },
        ],
    });

    const prevKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    const prevGroqKey = process.env.GROQ_API_KEY;
    // Clear BOTH provider keys so no model is configured and the deterministic
    // fallback path is exercised (Groq is a valid Gemini fallback otherwise).
    beforeAll(() => { delete process.env.GOOGLE_GENERATIVE_AI_API_KEY; delete process.env.GROQ_API_KEY; });
    afterAll(() => {
        if (prevKey !== undefined) process.env.GOOGLE_GENERATIVE_AI_API_KEY = prevKey;
        if (prevGroqKey !== undefined) process.env.GROQ_API_KEY = prevGroqKey;
    });

    it("differentiates dimension scores via expected-point routing", async () => {
        const report = await generateCompanyAiScreeningReport({
            blueprint,
            transcript: [],
            typedAnswers: [answer("q1", RICH_ANSWER), answer("q2", "skip")],
            integrity: { score: null, eventCounts: {} },
        });
        const d1 = report.dimensionScores.find((d) => d.dimensionId === "d1")!;
        const d2 = report.dimensionScores.find((d) => d.dimensionId === "d2")!;
        expect(d1.score).toBeGreaterThan(d2.score);
        // Overall is the rubric-weighted combination, not an identical-per-dimension number.
        expect(report.overallScore).toBeGreaterThan(d2.score);
        expect(report.automatedEvaluation).toBe("deterministic_fallback");
    });

    it("builds an LLM-independent coverage map", async () => {
        const report = await generateCompanyAiScreeningReport({
            blueprint,
            transcript: [],
            typedAnswers: [answer("q1", RICH_ANSWER)],
            integrity: { score: null, eventCounts: {} },
        });
        const c1 = report.coverage.find((c) => c.questionId === "q1")!;
        const c2 = report.coverage.find((c) => c.questionId === "q2")!;
        expect(c1.status).toBe("answered");
        expect(c2.status).toBe("not_asked");
    });

    it("marks coverage unknown when no per-question signal exists", async () => {
        const report = await generateCompanyAiScreeningReport({
            blueprint,
            transcript: [
                { role: "assistant", content: "Tell me about your project." },
                { role: "user", content: RICH_ANSWER },
            ],
            typedAnswers: [],
            integrity: { score: null, eventCounts: {} },
        });
        expect(report.coverage.every((c) => c.status === "unknown")).toBe(true);
    });

    it("scores a tagged live transcript (voice path, no typed answers)", async () => {
        // Simulates the live voice path: messages carry questionId tags, attempt.answers is empty.
        const report = await generateCompanyAiScreeningReport({
            blueprint,
            transcript: [
                { role: "assistant", content: "Tell me about your strongest project.", questionId: "q1" },
                { role: "user", content: RICH_ANSWER, questionId: "q1" },
                { role: "assistant", content: "How do you communicate tradeoffs?", questionId: "q2" },
                { role: "user", content: "skip", questionId: "q2" },
            ],
            typedAnswers: [],
            integrity: { score: null, eventCounts: {} },
        });
        const d1 = report.dimensionScores.find((d) => d.dimensionId === "d1")!;
        const d2 = report.dimensionScores.find((d) => d.dimensionId === "d2")!;
        expect(d1.score).toBeGreaterThan(d2.score);
        expect(report.coverage.find((c) => c.questionId === "q1")!.status).toBe("answered");
        expect(report.coverage.find((c) => c.questionId === "q2")!.status).toBe("skipped");
    });

    it("flags blueprint drift: a tagged transcript missing a question marks it not_asked", async () => {
        const report = await generateCompanyAiScreeningReport({
            blueprint,
            transcript: [
                { role: "assistant", content: "Tell me about your strongest project.", questionId: "q1" },
                { role: "user", content: RICH_ANSWER, questionId: "q1" },
                // q2 is never asked -> drift.
            ],
            typedAnswers: [],
            integrity: { score: null, eventCounts: {} },
        });
        expect(report.coverage.find((c) => c.questionId === "q2")!.status).toBe("not_asked");
    });

    it("applies the integrity penalty to the overall score", async () => {
        const clean = await generateCompanyAiScreeningReport({
            blueprint,
            transcript: [],
            typedAnswers: [answer("q1", RICH_ANSWER), answer("q2", RICH_ANSWER)],
            integrity: { score: 100, eventCounts: {} },
        });
        const flagged = await generateCompanyAiScreeningReport({
            blueprint,
            transcript: [],
            typedAnswers: [answer("q1", RICH_ANSWER), answer("q2", RICH_ANSWER)],
            integrity: { score: 0, eventCounts: {} },
        });
        expect(flagged.overallScore).toBeLessThan(clean.overallScore);
    });
});

describe("phase-scoped tool whitelist", () => {
    it("exposes the coding IDE + close (no hints) in a coding/cs_sql phase", () => {
        for (const phase of ["coding", "cs_sql"] as const) {
            const names = screeningToolNamesForPhase(phase, false);
            expect(names).toContain("open_screening_workspace");
            expect(names).toContain("record_screening_question");
            expect(names).toContain("close_panel");
            expect(names).not.toContain("open_scratchpad");
            expect(names).not.toContain("open_notepad");
            // A screening is pure evaluation — no hints/coaching in any phase.
            expect(names).not.toContain("give_hint");
            // Screening replaces these practice tools — they must never leak in.
            expect(names).not.toContain("open_ide");
            expect(names).not.toContain("open_sql_editor");
            expect(names).not.toContain("run_candidate_code");
        }
    });

    it("exposes the scratchpad + close (no hints) in a system_design phase", () => {
        const names = screeningToolNamesForPhase("system_design", false);
        expect(names).toContain("open_scratchpad");
        expect(names).toContain("close_panel");
        expect(names).not.toContain("give_hint");
        expect(names).not.toContain("open_screening_workspace");
        expect(names).not.toContain("open_notepad");
    });

    it("exposes the notepad + close in a behavioral phase", () => {
        const names = screeningToolNamesForPhase("behavioral", false);
        expect(names).toContain("open_notepad");
        expect(names).toContain("close_panel");
        expect(names).not.toContain("open_screening_workspace");
        expect(names).not.toContain("open_scratchpad");
        expect(names).not.toContain("give_hint");
    });

    it("never exposes give_hint in any screening phase (pure evaluation)", () => {
        for (const phase of ["resume_project", "coding", "cs_sql", "system_design", "behavioral", "custom", null] as const) {
            expect(screeningToolNamesForPhase(phase, false)).not.toContain("give_hint");
        }
    });

    it("exposes only the base set in a resume phase or before the agenda starts", () => {
        for (const phase of ["resume_project", null] as const) {
            const names = screeningToolNamesForPhase(phase, false);
            expect(names).toEqual(["record_screening_question", "transition_stage"]);
        }
    });

    it("never exposes end_interview in an active phase (the server owns when the round ends)", () => {
        for (const phase of ["resume_project", "coding", "cs_sql", "system_design", "behavioral", "custom", null] as const) {
            expect(screeningToolNamesForPhase(phase, false)).not.toContain("end_interview");
        }
    });

    it("collapses to end_interview only when closing", () => {
        expect(screeningToolNamesForPhase("coding", true)).toEqual(["end_interview"]);
    });

    const baseCtx = (phaseType: ToolSequenceContext["companyScreeningCurrentPhaseType"]): ToolSequenceContext => ({
        sessionId: `s_${phaseType}`,
        interviewType: "behavioural",
        currentStage: "BEHAVIOURAL",
        stageOrder: ["INTRO", "BEHAVIOURAL", "CLOSING"],
        lastFetchedQuestionId: null,
        cachedQuestionData: new Map(),
        companyScreening: true,
        companyScreeningCurrentPhaseType: phaseType,
    });

    it("sequencer rejects the scratchpad outside a system_design phase", () => {
        expect(validateToolCallSequence("open_scratchpad", { topic: "x", initialContent: "y" }, baseCtx("coding")).valid).toBe(false);
        expect(validateToolCallSequence("open_scratchpad", { topic: "x", initialContent: "y" }, baseCtx("system_design")).valid).toBe(true);
    });

    it("sequencer rejects the coding workspace outside a coding/cs_sql phase", () => {
        expect(validateToolCallSequence("open_screening_workspace", { questionId: "q1" }, baseCtx("system_design")).valid).toBe(false);
        expect(validateToolCallSequence("open_screening_workspace", { questionId: "q1" }, baseCtx("coding")).valid).toBe(true);
    });

    it("sequencer rejects the notepad outside a behavioral phase", () => {
        expect(validateToolCallSequence("open_notepad", { topic: "x", template: "blank" }, baseCtx("coding")).valid).toBe(false);
        expect(validateToolCallSequence("open_notepad", { topic: "x", template: "blank" }, baseCtx("behavioral")).valid).toBe(true);
    });
});

describe("config agent: JD -> blueprint normalization", () => {
    const modelResponse = {
        reply: "Proposed a backend screen.",
        clarifyingQuestions: ["What seniority?"],
        blueprint: {
            title: "Backend Engineer screen",
            durationMinutes: 45,
            rubric: [
                { id: "td", label: "Technical depth", weight: 40, competencyTags: ["depth"] },
                { id: "ps", label: "Problem solving", weight: 40, competencyTags: ["solving"] },
                { id: "comm", label: "Communication", weight: 40, competencyTags: ["comm"] }, // sums to 120 -> rescaled
            ],
            phases: [
                { type: "resume", durationMinutes: 10, questions: [{ prompt: "Walk me through your hardest project.", expectedPoints: ["ownership"], followUpPolicy: { maxFollowUps: 2 } }] },
                { type: "coding", durationMinutes: 20, questions: [{ prompt: "We'll do an array problem.", expectedPoints: ["complexity"], followUpPolicy: { maxFollowUps: 1 } }] },
                { type: "system_design", durationMinutes: 15, questions: [{ prompt: "Design a URL shortener.", expectedPoints: ["sharding"], followUpPolicy: { maxFollowUps: 2 } }] },
                { type: "totally_unsupported", durationMinutes: 5, questions: [{ prompt: "junk" }] }, // dropped
            ],
        },
    };

    it("rescales rubric weights to 100", () => {
        const { draft } = normalizeScreeningDraft(modelResponse, { messages: [] });
        expect(draft.rubricDimensions.reduce((s, d) => s + d.weight, 0)).toBe(100);
    });

    it("keeps supported phases in order and drops unsupported ones", () => {
        const { draft } = normalizeScreeningDraft(modelResponse, { messages: [] });
        expect(draft.phases.map((p) => p.type)).toEqual(["resume_project", "coding", "system_design"]);
    });

    it("keeps concept/pool phases the model returns with NO authored questions (pm_strategy), in order", () => {
        const { draft } = normalizeScreeningDraft({
            blueprint: {
                title: "PM",
                durationMinutes: 70,
                rubric: [{ id: "d", label: "D", weight: 100, competencyTags: ["d"] }],
                phases: [
                    { type: "resume_project", durationMinutes: 15, questions: [{ prompt: "walk me through a project", expectedPoints: ["ownership"] }] },
                    { type: "pm_case", durationMinutes: 20, questions: [{ prompt: "product case", expectedPoints: ["structure"] }] },
                    { type: "pm_strategy", durationMinutes: 15, questions: [] },
                    { type: "pm_concepts", durationMinutes: 10, questions: [] },
                    { type: "behavioral", durationMinutes: 10, questions: [{ prompt: "conflict", expectedPoints: ["resolution"] }] },
                ],
            },
        }, { jobTitle: "PM", messages: [] });
        // pm_strategy + pm_concepts must NOT be silently dropped, and order is preserved.
        expect(draft.phases.map((p) => p.type)).toEqual(["resume_project", "pm_case", "pm_strategy", "pm_concepts", "behavioral"]);
    });

    it("snaps a non-multiple-of-5 total so EVERY phase is a clean multiple of 5 (no stray 22)", () => {
        const { draft } = normalizeScreeningDraft({
            blueprint: {
                title: "PM",
                durationMinutes: 72,
                rubric: [{ id: "d", label: "D", weight: 100, competencyTags: ["d"] }],
                phases: [
                    { type: "resume_project", durationMinutes: 15, questions: [{ prompt: "p", expectedPoints: ["x"] }] },
                    { type: "pm_case", durationMinutes: 22, questions: [{ prompt: "c", expectedPoints: ["y"] }] },
                    { type: "pm_concepts", durationMinutes: 10, questions: [] },
                    { type: "pm_strategy", durationMinutes: 15, questions: [] },
                    { type: "behavioral", durationMinutes: 10, questions: [{ prompt: "b", expectedPoints: ["z"] }] },
                ],
            },
        }, { jobTitle: "PM", messages: [] });
        expect(draft.phases.every((p) => p.durationMinutes % 5 === 0)).toBe(true);
        expect(draft.durationMinutes % 5).toBe(0);
        expect(draft.phases.reduce((s, p) => s + p.durationMinutes, 0)).toBe(draft.durationMinutes);
    });

    it("snaps default per-phase durations to multiples of 5 and protects project-validation time", () => {
        const { draft } = normalizeScreeningDraft(modelResponse, { messages: [] });
        const sum = draft.phases.reduce((s, p) => s + p.durationMinutes, 0);
        expect(sum).toBe(45);
        // Defaults are clean multiples of 5 (no 14/24-minute phases).
        expect(draft.phases.every((p) => p.durationMinutes % 5 === 0)).toBe(true);
        // Project validation keeps real time even when coding + system design compete.
        const resume = draft.phases.find((p) => p.type === "resume_project")!.durationMinutes;
        expect(resume).toBeGreaterThanOrEqual(10);
    });

    it("rescales per-phase durations when the hints overflow the total", () => {
        // Same 10/20/15 hints (=45) but a 30-minute total -> must rescale down to sum 30.
        const { draft } = normalizeScreeningDraft(
            { blueprint: { ...modelResponse.blueprint, durationMinutes: 30 } },
            { messages: [] }
        );
        expect(draft.phases.reduce((s, p) => s + p.durationMinutes, 0)).toBe(30);
    });

    it("flags coding/cs_sql/system_design phases as needing a bank question", () => {
        const { needsBankQuestionPhaseIds } = normalizeScreeningDraft(modelResponse, { messages: [] });
        expect(needsBankQuestionPhaseIds).toContain("coding");
        // System design is now bank-backed (whiteboard prompt comes from the DB).
        expect(needsBankQuestionPhaseIds).toContain("system_design");
    });

    it("keeps the system_design prompt as spoken framing alongside its bank question", () => {
        const { draft } = normalizeScreeningDraft(modelResponse, { messages: [] });
        const sd = draft.phases.find((p) => p.type === "system_design")!;
        expect(sd.questions[0].prompt).toMatch(/URL shortener/i);
    });

    it("prunes a rubric dimension whose only phase was removed and rescales to 100", () => {
        // Blueprint without a system_design phase, but the model left a system-design
        // rubric dimension behind — it should be dropped as an orphan tag.
        const { draft } = normalizeScreeningDraft(
            {
                blueprint: {
                    title: "Frontend screen",
                    durationMinutes: 40,
                    rubric: [
                        { id: "coding", label: "Coding Proficiency", weight: 60 },
                        { id: "sd", label: "Basic System-Design Awareness", weight: 40 },
                    ],
                    phases: [
                        { type: "coding", durationMinutes: 40, questions: [{ prompt: "Reverse a list.", expectedPoints: ["complexity"] }] },
                    ],
                },
            },
            { messages: [] }
        );
        const labels = draft.rubricDimensions.map((d) => d.label);
        expect(labels).toContain("Coding Proficiency");
        expect(labels).not.toContain("Basic System-Design Awareness");
        expect(draft.rubricDimensions.reduce((s, d) => s + d.weight, 0)).toBe(100);
    });

    it("keeps a phase-specific dimension when its phase is still present", () => {
        const { draft } = normalizeScreeningDraft(modelResponse, { messages: [] });
        // modelResponse keeps a system_design phase, so nothing system-design is orphaned.
        expect(draft.phases.some((p) => p.type === "system_design")).toBe(true);
        expect(draft.rubricDimensions.length).toBe(3);
    });

    it("never prunes generic, cross-cutting rubric dimensions", () => {
        const { draft } = normalizeScreeningDraft(
            {
                blueprint: {
                    title: "Screen",
                    durationMinutes: 30,
                    rubric: [
                        { id: "td", label: "Technical depth", weight: 50 },
                        { id: "comm", label: "Communication", weight: 50 },
                    ],
                    phases: [
                        { type: "coding", durationMinutes: 30, questions: [{ prompt: "x", expectedPoints: ["y"] }] },
                    ],
                },
            },
            { messages: [] }
        );
        expect(draft.rubricDimensions.map((d) => d.label).sort()).toEqual(["Communication", "Technical depth"]);
    });

    it("falls back to a valid draft when the model call fails", async () => {
        // Force the failure path deterministically by removing both provider keys.
        const prevKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
        const prevGroqKey = process.env.GROQ_API_KEY;
        delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
        delete process.env.GROQ_API_KEY;
        try {
            const result = await generateScreeningBlueprintDraft({ messages: [], jobTitle: "Backend Engineer" });
            expect(result.fallback).toBe(true);
            expect(result.draft.rubricDimensions.reduce((s, d) => s + d.weight, 0)).toBe(100);
            expect(result.draft.phases.length).toBeGreaterThan(0);
        } finally {
            if (prevKey !== undefined) process.env.GOOGLE_GENERATIVE_AI_API_KEY = prevKey;
            if (prevGroqKey !== undefined) process.env.GROQ_API_KEY = prevGroqKey;
        }
    });
});

describe("role-bank phase wiring: artifact vs pool-backed", () => {
    it("maps every artifact phase to its own bank kind and nothing else", () => {
        expect(bankTypeForPhase("coding")).toBe("dsa");
        expect(bankTypeForPhase("cs_sql")).toBe("sql");
        expect(bankTypeForPhase("system_design")).toBe("system_design");
        expect(bankTypeForPhase("ds_sql")).toBe("ds_sql");
        expect(bankTypeForPhase("ds_coding")).toBe("ds_coding");
        expect(bankTypeForPhase("genai_coding")).toBe("genai_coding");
        expect(bankTypeForPhase("genai_system_design")).toBe("genai_system_design");
        expect(bankTypeForPhase("pm_case")).toBe("pm_case");
        expect(bankTypeForPhase("problem_solving")).toBe("problem_solving");
    });

    it("returns null (not artifact-backed) for concept/resume/behavioral/frontend/custom phases", () => {
        for (const t of ["resume_project", "behavioral", "custom", "frontend_coding",
            "cs_theory", "ds_concepts", "genai_concepts", "pm_concepts", "pm_strategy"] as const) {
            expect(bankTypeForPhase(t)).toBeNull();
        }
    });

    it("routes the new categories to their phase types (cs_fundamentals stays a cs_sql alias)", () => {
        expect(phaseTypeForCategory("ds_sql")).toBe("ds_sql");
        expect(phaseTypeForCategory("genai_coding")).toBe("genai_coding");
        expect(phaseTypeForCategory("pm_case")).toBe("pm_case");
        expect(phaseTypeForCategory("ds_concepts")).toBe("ds_concepts");
        expect(phaseTypeForCategory("cs_fundamentals")).toBe("cs_sql");
    });

    it("requires a bank question for a new artifact phase (genai_coding) and accepts one when attached", () => {
        const base = {
            rubric: [{ id: "d", label: "D", weight: 100, competencyTags: ["d"] }],
        };
        const missing = validateScreeningConfig({
            ...base,
            questions: [{ id: "q1", category: "genai_coding", prompt: "framing", expectedPoints: [{ id: "p1", text: "x", competencyTags: ["d"] }] }],
        });
        expect(missing.valid).toBe(false);
        expect(missing.errors.some((e) => /GenAI coding/i.test(e) && /question bank/i.test(e))).toBe(true);

        const attached = validateScreeningConfig({
            ...base,
            questions: [{ id: "q1", category: "genai_coding", prompt: "", expectedPoints: [{ id: "p1", text: "x", competencyTags: ["d"] }], bankQuestion: { id: "g1", type: "genai_coding", source: "platform" } }],
        });
        expect(attached.valid).toBe(true);
    });

    it("accepts a pool-backed concept phase with NO bank question and NO prompt", () => {
        for (const type of POOL_BACKED_PHASE_TYPES) {
            const result = validateScreeningConfig({
                rubric: [{ id: "d", label: "D", weight: 100, competencyTags: ["d"] }],
                questions: [{ id: "q1", category: type, prompt: "", expectedPoints: [{ id: "p1", text: "concept signal", competencyTags: ["d"] }] }],
            });
            expect(result.valid).toBe(true);
        }
    });
});

describe("blueprintToModuleConfig: recruiter phases -> real composed stages", () => {
    const phase = (id: string, type: any, durationMinutes: number) => ({ id, type, title: id, durationMinutes, questions: [] });
    const bp = (phases: any[]): ScreeningBlueprint => ({
        version: 1, template: "sde_screening", title: "t", durationMinutes: 60,
        rubricDimensions: [{ id: "d", label: "D", weight: 100, competencyTags: ["d"] }], phases,
    });

    it("maps each phase to its stage in order, carries durations, and appends CLOSING", () => {
        const { moduleConfig, stageToPhaseId } = blueprintToModuleConfig(bp([
            phase("p1", "resume_project", 12),
            phase("p2", "genai_coding", 26),
            phase("p3", "genai_concepts", 15),
            phase("p4", "behavioral", 10),
        ]));
        expect(moduleConfig.enabledStages).toEqual(["INTRO", "GEN_AI_CODING", "GEN_AI_CONCEPTS", "BEHAVIOURAL", "CLOSING"]);
        expect(moduleConfig.stageDurations?.GEN_AI_CODING).toEqual({ min: 26, max: 26 });
        expect(stageToPhaseId.GEN_AI_CODING).toBe("p2");
        expect(stageToPhaseId.INTRO).toBe("p1");
    });

    it("de-dupes colliding stages (cs_sql + cs_theory both -> FUNDAMENTALS)", () => {
        const { moduleConfig } = blueprintToModuleConfig(bp([
            phase("p1", "cs_sql", 15),
            phase("p2", "cs_theory", 10),
        ]));
        expect(moduleConfig.enabledStages.filter((s) => s === "FUNDAMENTALS")).toHaveLength(1);
        expect(moduleConfig.enabledStages).toEqual(["FUNDAMENTALS", "CLOSING"]);
    });

    it("skips unmapped phases (frontend_coding has no stage yet) but keeps the rest", () => {
        const { moduleConfig, unmapped } = blueprintToModuleConfig(bp([
            phase("p1", "coding", 25),
            phase("p2", "frontend_coding", 30),
            phase("p3", "system_design", 20),
        ]));
        expect(unmapped).toEqual(["frontend_coding"]);
        expect(moduleConfig.enabledStages).toEqual(["DSA", "SYSTEM_DESIGN", "CLOSING"]);
    });

    it("stageForPhaseType returns null only for frontend_coding among expressible phases", () => {
        expect(stageForPhaseType("frontend_coding")).toBeNull();
        expect(stageForPhaseType("pm_case")).toBe("PM_CASE");
        expect(stageForPhaseType("ds_sql")).toBe("DS_SQL");
    });
});

describe("resolveScreeningAuthoritativeTurn (shared server pointer for text + voice)", () => {
    const bp: ScreeningBlueprint = buildScreeningBlueprint({
        title: "t",
        durationMinutes: 20,
        rubric: [{ id: "d", label: "D", weight: 100, competencyTags: ["d"] }],
        questions: [
            { id: "q1", category: "resume", prompt: "", expectedPoints: [{ id: "p1", text: "ownership" }], followUpPolicy: { maxFollowUps: 1 } },
            { id: "q2", category: "behavioral", prompt: "Tell me about a conflict.", expectedPoints: [{ id: "p2", text: "resolution" }], followUpPolicy: { maxFollowUps: 1 } },
        ],
    });
    const base = {
        blueprint: bp, resumeSummary: null, previousPhaseType: null,
        closingForced: false, closingQuestionOffered: false, currentStageIsClosing: false,
    };

    it("assigns a server-chosen question on the opening turn (no LLM say)", () => {
        const plan = computeScreeningPlan(bp);
        const progress = createScreeningProgress(0);
        const r = resolveScreeningAuthoritativeTurn({ ...base, plan, progress, startedAtMs: 0, nowMs: 1000, candidateAnswered: false, candidateEndRequest: false });
        expect(r.turn.forceClose).toBe(false);
        expect(r.turn.currentQuestionId).toBeTruthy();
        expect(typeof r.turn.followUpsRemaining).toBe("number");
    });

    it("drives a sticky two-step close when the candidate asks to end early", () => {
        const plan = computeScreeningPlan(bp);
        const progress = createScreeningProgress(0);
        const offer = resolveScreeningAuthoritativeTurn({ ...base, plan, progress, startedAtMs: 0, nowMs: 1000, candidateAnswered: true, candidateEndRequest: true });
        expect(offer.turn.forceClose).toBe(true);
        expect(offer.turn.closingMode).toBe("offer");
        expect(offer.enterClosingStage).toBe(false);
        expect(offer.closingQuestionOffered).toBe(true);

        const final = resolveScreeningAuthoritativeTurn({ ...base, plan, progress, startedAtMs: 0, nowMs: 2000, candidateAnswered: true, candidateEndRequest: false, closingForced: true, closingQuestionOffered: true });
        expect(final.turn.closingMode).toBe("final");
        expect(final.enterClosingStage).toBe(true);
    });
});

describe("resume agenda + skip classification + phase-only prompts", () => {
    const resumeSummary = {
        projects: [
            { name: "Realtime Chat", description: "WebSocket chat app", techStack: ["Node", "Redis"] },
            { name: "Billing Service", description: "Stripe billing microservice" },
        ],
        experience: [{ role: "Backend Engineer", company: "Acme" }],
    };

    it("isScreeningSkip flags skips/declines but not real answers", () => {
        for (const s of ["skip", "no", "No. Skip.", "pass", "i'll skip this one", "not sure", "idk", "move on"]) {
            expect(isScreeningSkip(s)).toBe(true);
        }
        for (const a of ["I built the auth service using JWT", "We used Redis for caching", "No, I actually chose Postgres over Mongo for the joins"]) {
            expect(isScreeningSkip(a)).toBe(false);
        }
    });

    it("phaseHandoffPrompt gives phase-only text for workspace phases and never leaks 'frontend'/'full-stack'", () => {
        for (const t of ["coding", "cs_sql", "ds_sql", "ds_coding", "genai_coding", "system_design"] as const) {
            const p = phaseHandoffPrompt(t);
            expect(p && p.length).toBeTruthy();
            expect(p!.toLowerCase()).not.toMatch(/frontend|full[- ]?stack/);
        }
        // Conversational phases keep their own blueprint prompt.
        expect(phaseHandoffPrompt("behavioral")).toBeNull();
        expect(phaseHandoffPrompt("pm_case")).toBeNull();
    });

    it("seedScreeningResumeAgenda only builds an agenda from a substantive resume", () => {
        expect(seedScreeningResumeAgenda(null)).toBeNull();
        expect(seedScreeningResumeAgenda({ projects: [] })).toBeNull();
        const agenda = seedScreeningResumeAgenda(resumeSummary);
        expect(agenda).toBeTruthy();
        expect(agenda!.items.some((i) => i.type === "project")).toBe(true);
    });

    it("driveScreeningResumeAgendaTurn grounds on real items and honestly closes a skip", () => {
        const agenda = seedScreeningResumeAgenda(resumeSummary)!;
        const first = driveScreeningResumeAgendaTurn({ agenda, candidateMessage: null, advance: false });
        expect(first.prompt).toContain("Realtime Chat");
        expect(first.grounding).toContain("Server-Owned Resume Agenda");
        expect(first.exhausted).toBe(false);

        // Skipping the active item closes it and moves to the next.
        const active0 = first.agenda.activeItemId;
        const skipped = driveScreeningResumeAgendaTurn({ agenda: first.agenda, candidateMessage: "skip", advance: true });
        expect(skipped.agenda.activeItemId).not.toBe(active0);
    });

    it("buildBehavioralResumeContext anchors on real work, or null without a resume", () => {
        expect(buildBehavioralResumeContext(null)).toBeNull();
        expect(buildBehavioralResumeContext(resumeSummary)).toContain("Realtime Chat");
    });

    it("extractCandidateProjectFacts copies ONLY candidate facts, never recruiter judgments (leak guard)", () => {
        const application = {
            githubAnalysis: {
                overallScore: 82, score: 80, scoringConfig: { weights: { github: 60 } },
                projects: [
                    {
                        repo: { name: "invoicer", description: "Invoice PDF generator", language: "TypeScript", topics: ["pdf", "billing"], fork: false },
                        score: 91, slotScore: 88, reason: "Strong ownership", risks: ["thin tests"],
                        ai: { verdict: "senior-level", weaknesses: ["no CI"] },
                    },
                    { repo: { name: "forked-lib", description: "x", fork: true }, score: 0, reason: "forked" },
                    { skipped: true, repo: { name: "skipme", description: "y" } },
                ],
            },
        };
        const facts = extractCandidateProjectFacts(application);
        expect(facts.map((f) => f.name)).toEqual(["invoicer"]); // fork + skipped dropped
        const serialized = JSON.stringify(facts).toLowerCase();
        for (const leak of ["score", "slotscore", "reason", "risk", "verdict", "weakness", "scoringconfig", "overallscore", "91", "88", "82"]) {
            expect(serialized).not.toContain(leak);
        }
        expect(facts[0]).toEqual({ name: "invoicer", description: "Invoice PDF generator", tech: ["TypeScript", "pdf", "billing"] });
    });

    it("mergeCandidateProjectsIntoResume folds facts into the summary and dedups by name", () => {
        const facts = extractCandidateProjectFacts({
            githubAnalysis: { projects: [{ repo: { name: "Realtime Chat", description: "dup", language: "Go" } }, { repo: { name: "invoicer", description: "Invoice gen", language: "TS" } }] },
        });
        const merged = mergeCandidateProjectsIntoResume(resumeSummary, facts);
        const names = (merged.projects as any[]).map((p) => String(p.name));
        expect(names.filter((n) => n === "Realtime Chat").length).toBe(1); // deduped
        expect(names).toContain("invoicer");
        // Works with no resume at all: synthesizes a summary from facts alone.
        const fromScratch = mergeCandidateProjectsIntoResume(null, facts);
        expect((fromScratch!.projects as any[]).some((p) => p.name === "invoicer")).toBe(true);
    });

    it("resolver grounds the resume phase on the agenda instead of the generic blueprint prompt", () => {
        const bp2 = buildScreeningBlueprint({
            title: "t", durationMinutes: 30,
            rubric: [{ id: "d", label: "D", weight: 100, competencyTags: ["d"] }],
            questions: [
                { id: "q1", category: "resume", prompt: "generic resume prompt", expectedPoints: [], followUpPolicy: { maxFollowUps: 1 } },
                { id: "q2", category: "coding", prompt: "Build a small full-stack feature with frontend logic", expectedPoints: [], followUpPolicy: { maxFollowUps: 1 } },
            ],
        });
        const plan = computeScreeningPlan(bp2);
        const progress = createScreeningProgress(0);
        const agenda = seedScreeningResumeAgenda(resumeSummary);
        const t1 = resolveScreeningAuthoritativeTurn({
            blueprint: bp2, resumeSummary, resumeAgenda: agenda,
            plan, progress, startedAtMs: 0, nowMs: 1000,
            candidateAnswered: false, candidateEndRequest: false, previousPhaseType: null,
            closingForced: false, closingQuestionOffered: false, currentStageIsClosing: false,
        });
        expect(t1.currentPhaseType).toBe("resume_project");
        expect(t1.turn.groundingBlock).toContain("Server-Owned Resume Agenda");
        expect(t1.turn.currentPrompt).not.toBe("generic resume prompt");
    });

    it("a skip is recorded in progress.skipped, not faked as answered coverage", () => {
        const bp2 = buildScreeningBlueprint({
            title: "t", durationMinutes: 30,
            rubric: [{ id: "d", label: "D", weight: 100, competencyTags: ["d"] }],
            questions: [
                { id: "q1", category: "coding", prompt: "x", expectedPoints: [], followUpPolicy: { maxFollowUps: 1 } },
                { id: "q2", category: "behavioral", prompt: "y", expectedPoints: [], followUpPolicy: { maxFollowUps: 1 } },
            ],
        });
        const plan = computeScreeningPlan(bp2);
        const progress = createScreeningProgress(0);
        const common = { blueprint: bp2, resumeSummary: null, resumeAgenda: null, closingForced: false, closingQuestionOffered: false, currentStageIsClosing: false };
        // Turn 1: assign the coding question.
        const t1 = resolveScreeningAuthoritativeTurn({ ...common, plan, progress, startedAtMs: 0, nowMs: 1000, candidateAnswered: false, candidateEndRequest: false, previousPhaseType: null });
        const codingId = t1.turn.currentQuestionId!;
        // Turn 2: candidate skips it.
        resolveScreeningAuthoritativeTurn({ ...common, plan, progress, startedAtMs: 0, nowMs: 2000, candidateAnswered: false, candidateSkipped: true, candidateEndRequest: false, previousPhaseType: t1.currentPhaseType });
        expect(progress.skipped.has(codingId)).toBe(true);
    });
});

describe("output leak-scan: interviewer never reproduces confidential reference material", () => {
    const secret = "The optimal solution uses a min heap to track the k smallest elements efficiently.";
    const bp = buildScreeningBlueprint({
        title: "t", durationMinutes: 30,
        rubric: [{ id: "d", label: "D", weight: 100, competencyTags: ["d"] }],
        questions: [
            { id: "q1", category: "coding", prompt: "Solve it.", expectedPoints: [{ id: "p1", text: secret }], followUpPolicy: { maxFollowUps: 1 } },
        ],
    });

    it("collectScreeningSecrets gathers expected points (and prefetch references) but ignores trivially short ones", () => {
        const secrets = collectScreeningSecrets(bp);
        expect(secrets).toContain(secret);
        const withShort = buildScreeningBlueprint({
            title: "t", durationMinutes: 30, rubric: [{ id: "d", label: "D", weight: 100, competencyTags: ["d"] }],
            questions: [{ id: "q1", category: "coding", prompt: "x", expectedPoints: [{ id: "p1", text: "uses a heap" }], followUpPolicy: { maxFollowUps: 1 } }],
        });
        expect(collectScreeningSecrets(withShort)).not.toContain("uses a heap"); // too short to scan
        // Prefetch reference material is folded in too (voice path).
        expect(collectScreeningSecrets(bp, { prefetchedDSSQLQuestion: { solution: "SELECT user_id FROM orders GROUP BY user_id HAVING COUNT(*) > 5 ORDER BY user_id" } as any }))
            .toEqual(expect.arrayContaining([expect.stringContaining("GROUP BY user_id HAVING COUNT")]));
    });

    it("redacts a sentence that reproduces a reference span, keeps the rest", () => {
        const secrets = collectScreeningSecrets(bp);
        const message = "Nice start. The optimal solution uses a min heap to track the k smallest elements efficiently. What's the complexity of your approach?";
        const guard = redactScreeningLeak(message, secrets);
        expect(guard.leaked).toBe(true);
        expect(guard.removed).toBe(1);
        expect(guard.text).not.toContain("min heap to track the k smallest");
        expect(guard.text).toContain("What's the complexity of your approach?"); // legit follow-up kept
    });

    it("does NOT false-trigger on coincidental shared domain terms", () => {
        const secrets = collectScreeningSecrets(bp);
        for (const safe of [
            "Have you considered using a heap here?",
            "Walk me through the time and space complexity.",
            "Could binary search help reduce the work?",
            "What happens with duplicate elements in your approach?",
        ]) {
            const guard = redactScreeningLeak(safe, secrets);
            expect(guard.leaked).toBe(false);
            expect(guard.text).toBe(safe);
        }
    });

    it("falls back to a neutral line when the only content was a leak", () => {
        const secrets = collectScreeningSecrets(bp);
        const guard = redactScreeningLeak("The optimal solution uses a min heap to track the k smallest elements efficiently.", secrets);
        expect(guard.leaked).toBe(true);
        expect(guard.text).not.toContain("min heap");
        expect(guard.text.length).toBeGreaterThan(0);
    });

    it("detectScreeningLeak / buildSecretShingles agree on a reproduced span", () => {
        const shingles = buildSecretShingles(collectScreeningSecrets(bp));
        expect(detectScreeningLeak("uses a min heap to track the k smallest elements efficiently", shingles)).toBe(true);
        expect(detectScreeningLeak("let's discuss your approach and its tradeoffs", shingles)).toBe(false);
    });

    it("no secrets or empty message → passthrough", () => {
        expect(redactScreeningLeak("Any message.", [])).toEqual({ text: "Any message.", leaked: false, removed: 0 });
        expect(redactScreeningLeak("", collectScreeningSecrets(bp))).toEqual({ text: "", leaked: false, removed: 0 });
    });
});

describe("buildScreeningPhaseSupplement: per-phase grounding injection", () => {
    it("injects an artifact phase's reference/evaluation grounding (pm_case)", () => {
        const supp = buildScreeningPhaseSupplement("pm_case", {
            prefetchedPMCaseQuestion: { title: "Launch X", scenario: "s", constraintInjection: "budget cut 50%", evaluationGuide: "look for prioritization", successSignals: ["metric-driven"], redFlags: ["feature dump"] },
        });
        expect(supp).toMatch(/Product case/i);
        expect(supp).toMatch(/prioritization/);
        expect(supp).toMatch(/NEVER reveal/i);
    });

    it("injects a concept phase's bank list with reference answers (ds_concepts)", () => {
        const supp = buildScreeningPhaseSupplement("ds_concepts", {
            prefetchedDSConceptQuestions: [
                { questionId: "c1", question: "Explain bias-variance", referenceAnswer: "tradeoff between..." },
                { questionId: "c2", question: "What is p-value", referenceAnswer: "probability under null..." },
            ],
        });
        expect(supp).toMatch(/concept bank/i);
        expect(supp).toMatch(/bias-variance/);
        expect(supp).toMatch(/c1/);
    });

    it("returns empty for a phase with no prefetched question or a conversational phase", () => {
        expect(buildScreeningPhaseSupplement("pm_case", {})).toBe("");
        expect(buildScreeningPhaseSupplement("resume_project", { prefetchedPMCaseQuestion: { title: "x" } })).toBe("");
        expect(buildScreeningPhaseSupplement(null, {})).toBe("");
    });
});
