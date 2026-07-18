import type { ScreeningBlueprint, ScreeningPhaseType } from "./blueprint.js";

/**
 * Deterministic, server-authoritative time & depth budgeting for the company
 * AI screening round. NONE of this is decided by the LLM — the server computes a
 * static plan from the recruiter's duration + question mix, then each turn
 * decides the authoritative pointer (current question, allowed follow-ups,
 * force-advance / force-close) purely from elapsed wall-clock and coverage.
 *
 * The LLM only renders whatever the server's current pointer says to ask.
 *
 * Budgets nest: overall (whole interview) -> per-phase -> per-question -> depth.
 */

const MS_PER_MIN = 60_000;

/** Fraction of the total interview reserved for a clean wrap-up, clamped. */
const CLOSING_BUFFER_RATIO = 0.08;
const CLOSING_BUFFER_MIN_MS = 45_000;
const CLOSING_BUFFER_MAX_MS = 90_000;

/** Rough cost of one main Q&A exchange (ask + answer) and one follow-up loop. */
const MAIN_ANSWER_RESERVE_MS = 60_000;
const AVG_FOLLOWUP_EXCHANGE_MS = 75_000;

/** Every phase that has at least one question gets at least this much time. */
const MIN_PHASE_MS = 60_000;

/** A resume item (project/experience) needs at least this much to be worth probing. */
const RESUME_MIN_PER_ITEM_MS = 120_000;

/**
 * Relative cost of one question by category. Coding (in-IDE) is the heaviest;
 * resume/behavioural are conversational and lighter. Used to split phase time so
 * a coding phase isn't starved by an equal-count split with a resume phase.
 */
const CATEGORY_COST: Partial<Record<ScreeningPhaseType, number>> = {
    resume_project: 1.4,
    coding: 2.4,
    cs_sql: 1.4,
    cs_theory: 1.1,
    system_design: 1.8,
    frontend_coding: 2.4,
    ds_sql: 1.8,
    ds_coding: 2.2,
    ds_concepts: 1.1,
    genai_coding: 2.2,
    genai_concepts: 1.1,
    genai_system_design: 1.8,
    pm_case: 1.8,
    pm_concepts: 1.1,
    pm_strategy: 1.2,
    problem_solving: 1.6,
    behavioral: 1.0,
    custom: 1.0,
};

function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}

function categoryCost(type: ScreeningPhaseType) {
    return CATEGORY_COST[type] ?? 1.0;
}

export type QuestionBudget = {
    questionId: string;
    category: string;
    /** Wall-clock allocation for this question (main answer + allowed follow-ups). */
    budgetMs: number;
    /** Recruiter-configured ceiling on follow-ups (already clamped 0..2 in blueprint). */
    recruiterMaxFollowUps: number;
    /** Depth the time budget alone permits, never exceeding the recruiter ceiling. */
    maxFollowUps: number;
};

export type PhaseBudget = {
    phaseId: string;
    type: ScreeningPhaseType;
    title: string;
    budgetMs: number;
    questions: QuestionBudget[];
};

export type ScreeningPlan = {
    totalMs: number;
    closingBufferMs: number;
    /** Total minus closing buffer — the time questions are allowed to consume. */
    usableMs: number;
    phases: PhaseBudget[];
};

/**
 * Follow-up depth permitted by a time budget alone, capped by the recruiter's
 * ceiling. This is why "10 min / 2 questions" probes shallowly while
 * "30 min / 2 questions" probes to full depth — same questions, more time.
 */
export function maxFollowUpsForBudget(budgetMs: number, recruiterCeiling: number): number {
    const ceiling = clamp(Math.round(recruiterCeiling), 0, 2);
    const room = Math.floor((budgetMs - MAIN_ANSWER_RESERVE_MS) / AVG_FOLLOWUP_EXCHANGE_MS);
    return clamp(room, 0, ceiling);
}

/** Build the static budget plan from the blueprint. Deterministic, no clock. */
export function computeScreeningPlan(blueprint: ScreeningBlueprint): ScreeningPlan {
    const totalMs = Math.max(MS_PER_MIN, Math.round(Number(blueprint.durationMinutes) || 30) * MS_PER_MIN);
    const closingBufferMs = clamp(totalMs * CLOSING_BUFFER_RATIO, CLOSING_BUFFER_MIN_MS, CLOSING_BUFFER_MAX_MS);
    const usableMs = Math.max(MS_PER_MIN, totalMs - closingBufferMs);

    const livePhases = blueprint.phases.filter((phase) => phase.questions.length > 0);
    const phaseWeights = livePhases.map((phase) =>
        phase.questions.reduce((sum, question) => sum + categoryCost(phase.type), 0)
    );
    const totalWeight = phaseWeights.reduce((sum, weight) => sum + weight, 0) || 1;

    // First pass: proportional split with a per-phase floor.
    const rawPhaseMs = livePhases.map((_, index) =>
        Math.max(MIN_PHASE_MS, Math.round((phaseWeights[index] / totalWeight) * usableMs))
    );
    // Floors can push the sum over budget; rescale back down to fit usableMs.
    const rawTotal = rawPhaseMs.reduce((sum, ms) => sum + ms, 0) || 1;
    const scale = rawTotal > usableMs ? usableMs / rawTotal : 1;

    const phases: PhaseBudget[] = livePhases.map((phase, index) => {
        const phaseBudgetMs = Math.max(MIN_PHASE_MS, Math.round(rawPhaseMs[index] * scale));
        const phaseWeight = phaseWeights[index] || 1;
        const questions: QuestionBudget[] = phase.questions.map((question) => {
            const questionBudgetMs = Math.max(
                MS_PER_MIN / 2,
                Math.round((categoryCost(phase.type) / phaseWeight) * phaseBudgetMs)
            );
            const recruiterMaxFollowUps = clamp(Math.round(Number(question.followUpPolicy?.maxFollowUps ?? 2)), 0, 2);
            return {
                questionId: question.id,
                category: question.category,
                budgetMs: questionBudgetMs,
                recruiterMaxFollowUps,
                maxFollowUps: maxFollowUpsForBudget(questionBudgetMs, recruiterMaxFollowUps),
            };
        });
        return {
            phaseId: phase.id,
            type: phase.type,
            title: phase.title,
            budgetMs: phaseBudgetMs,
            questions,
        };
    });

    return { totalMs, closingBufferMs, usableMs, phases };
}

export type ResumeItemPlan = {
    itemsToCover: number;
    perItemMs: number;
};

/**
 * How many resume items (projects/experiences) the resume phase can cover and
 * how long each gets — derived from the resume phase budget and how many items
 * the candidate's resume actually has. Server advances item-by-item on the
 * clock; the LLM never decides when to move on.
 */
export function planResumeItems(resumePhaseBudgetMs: number, availableItems: number): ResumeItemPlan {
    const items = Math.max(0, Math.round(availableItems));
    if (items === 0) return { itemsToCover: 0, perItemMs: resumePhaseBudgetMs };
    const itemsToCover = clamp(Math.floor(resumePhaseBudgetMs / RESUME_MIN_PER_ITEM_MS), 1, items);
    return { itemsToCover, perItemMs: Math.round(resumePhaseBudgetMs / itemsToCover) };
}

export type PointerInput = {
    plan: ScreeningPlan;
    /** Wall-clock ms since the attempt started (server clock). */
    elapsedMs: number;
    /** Per question: whether its main answer is covered (server-derived from tagged transcript). */
    answeredQuestionIds: Set<string>;
    /** Per question: follow-ups already asked (server-derived count of tagged assistant turns). */
    followUpsUsedByQuestion: Map<string, number>;
    /** Wall-clock ms spent on the currently-active question (now - its first asked-at). */
    currentQuestionElapsedMs: number;
};

export type PointerDecision = {
    /** The question the server commands the LLM to be on, or null when closing. */
    currentQuestionId: string | null;
    currentPhaseId: string | null;
    /** Follow-ups still permitted on the current question right now (server-enforced). */
    followUpsRemaining: number;
    /** Server is forcing a move off the current question this turn. */
    forceAdvanceQuestion: boolean;
    /** Server is forcing the whole interview into closing this turn. */
    forceClose: boolean;
    reason: string;
};

function flattenQuestions(plan: ScreeningPlan): Array<{ phaseId: string; q: QuestionBudget; phaseStartMs: number }> {
    const out: Array<{ phaseId: string; q: QuestionBudget; phaseStartMs: number }> = [];
    let cursorMs = 0;
    for (const phase of plan.phases) {
        for (const q of phase.questions) {
            out.push({ phaseId: phase.phaseId, q, phaseStartMs: cursorMs });
        }
        cursorMs += phase.budgetMs;
    }
    return out;
}

/**
 * The authoritative per-turn decision. Pure function of the static plan, the
 * server clock, and server-derived coverage. The pointer advances when EITHER
 * the question is answered with no follow-ups left, OR its time budget is spent
 * (hard skip), OR the overall usable time is gone (force close). The LLM has no
 * say in advancement — it only receives the resulting command.
 */
export function decideScreeningPointer(input: PointerInput): PointerDecision {
    const { plan, elapsedMs, answeredQuestionIds, followUpsUsedByQuestion, currentQuestionElapsedMs } = input;

    if (elapsedMs >= plan.usableMs) {
        return {
            currentQuestionId: null,
            currentPhaseId: null,
            followUpsRemaining: 0,
            forceAdvanceQuestion: false,
            forceClose: true,
            reason: `Overall usable time (${Math.round(plan.usableMs / 1000)}s) reached; forcing closing.`,
        };
    }

    const flat = flattenQuestions(plan);
    if (flat.length === 0) {
        return { currentQuestionId: null, currentPhaseId: null, followUpsRemaining: 0, forceAdvanceQuestion: false, forceClose: true, reason: "No configured questions." };
    }

    // The pointer is the earliest question that is neither answered-and-exhausted
    // nor pushed past by its own time budget. Time can skip an unanswered question.
    for (const { phaseId, q } of flat) {
        const answered = answeredQuestionIds.has(q.questionId);
        const followUpsUsed = followUpsUsedByQuestion.get(q.questionId) || 0;
        const followUpsRemaining = Math.max(0, q.maxFollowUps - followUpsUsed);

        // Already fully done (answered + no depth left): move to next question.
        if (answered && followUpsRemaining === 0) continue;

        // Time budget for THIS question is spent — hard force-advance (skip/cut short).
        if (currentQuestionElapsedMs >= q.budgetMs) {
            return {
                currentQuestionId: q.questionId,
                currentPhaseId: phaseId,
                followUpsRemaining: 0,
                forceAdvanceQuestion: true,
                forceClose: false,
                reason: `Question ${q.questionId} time budget (${Math.round(q.budgetMs / 1000)}s) spent; forcing advance.`,
            };
        }

        return {
            currentQuestionId: q.questionId,
            currentPhaseId: phaseId,
            followUpsRemaining,
            forceAdvanceQuestion: false,
            forceClose: false,
            reason: answered
                ? `On ${q.questionId}: answered, ${followUpsRemaining} follow-up(s) permitted by time budget.`
                : `On ${q.questionId}: awaiting main answer, up to ${q.maxFollowUps} follow-up(s) permitted.`,
        };
    }

    // Every question is answered and exhausted — close.
    return {
        currentQuestionId: null,
        currentPhaseId: null,
        followUpsRemaining: 0,
        forceAdvanceQuestion: false,
        forceClose: true,
        reason: "All configured questions covered; forcing closing.",
    };
}

/**
 * Authoritative live progress for one screening attempt. Held in session memory
 * (rebuilt deterministically; no DB schema). The server owns every field — the
 * LLM never advances the pointer.
 */
export type ScreeningProgress = {
    /** Questions whose main answer the candidate has given. */
    answered: Set<string>;
    /**
     * Questions the candidate declined / skipped / non-answered. A skip still advances
     * the pointer (so the round never stalls) but is recorded HERE, not as real coverage,
     * so the report can mark it unverified instead of falsely "answered".
     */
    skipped: Set<string>;
    /** Follow-ups already asked, per question. */
    followUps: Map<string, number>;
    /** Server-assigned current question (what the LLM is commanded to ask). */
    currentQuestionId: string | null;
    /** Wall-clock ms when the current question became active (for its time budget). */
    currentStartedAtMs: number;
};

export function createScreeningProgress(nowMs: number): ScreeningProgress {
    return { answered: new Set(), skipped: new Set(), followUps: new Map(), currentQuestionId: null, currentStartedAtMs: nowMs };
}

function maxFollowUpsForQuestion(plan: ScreeningPlan, questionId: string): number {
    for (const phase of plan.phases) {
        for (const q of phase.questions) {
            if (q.questionId === questionId) return q.maxFollowUps;
        }
    }
    return 0;
}

export type AdvanceResult = {
    decision: PointerDecision;
    forceClose: boolean;
    /** True when the server moved the pointer to a different question this turn. */
    changedQuestion: boolean;
};

/**
 * The server-authoritative per-turn update. Accounts for the candidate's
 * incoming answer, then resolves the pointer — skipping any questions whose time
 * budget is spent and closing when the overall budget is gone. Mutates
 * `progress` in place. Pure aside from that mutation; fully unit-testable.
 */
export function advanceScreeningProgress(args: {
    plan: ScreeningPlan;
    progress: ScreeningProgress;
    startedAtMs: number;
    nowMs: number;
    /** A candidate message arrived this turn (i.e. they just answered the current question). */
    candidateAnswered: boolean;
    /**
     * The candidate skipped / declined / gave a non-answer this turn. A skip advances
     * the pointer immediately (marks the question done + exhausts its follow-ups so the
     * round never stalls) but is recorded in `progress.skipped`, not counted as real
     * coverage. Takes precedence over candidateAnswered when both are set.
     */
    candidateSkipped?: boolean;
    /**
     * The current phase runs its OWN sub-agenda that owns depth (the resume ladder), and
     * that sub-agenda is exhausted this turn. The pointer must therefore LEAVE the current
     * question even though its follow-up budget may be unspent (the ladder, not the
     * follow-up counter, governed depth this phase). We mark it covered + drain follow-ups
     * so the pointer advances to the NEXT configured phase — whatever it is — or closes if
     * this was the last phase. Without this the pointer parks on an "answered but has
     * follow-ups left" question and the interview stalls / dead-ends in the resume phase.
     */
    forceCompleteCurrent?: boolean;
}): AdvanceResult {
    const { plan, progress, startedAtMs, nowMs, candidateAnswered, candidateSkipped, forceCompleteCurrent } = args;

    // 1. Attribute the candidate's answer to the current question.
    if (candidateSkipped && progress.currentQuestionId) {
        // A skip is done immediately: no follow-up probing on a declined question.
        const id = progress.currentQuestionId;
        progress.answered.add(id);
        progress.skipped.add(id);
        progress.followUps.set(id, maxFollowUpsForQuestion(plan, id));
    } else if (candidateAnswered && progress.currentQuestionId) {
        const id = progress.currentQuestionId;
        if (!progress.answered.has(id)) {
            progress.answered.add(id);
        } else {
            progress.followUps.set(id, (progress.followUps.get(id) || 0) + 1);
        }
    }

    // A phase-owned sub-agenda (resume ladder) reported completion: drain the current
    // question so the pointer resolves to the next phase instead of parking here.
    if (forceCompleteCurrent && progress.currentQuestionId) {
        const id = progress.currentQuestionId;
        progress.answered.add(id);
        progress.followUps.set(id, maxFollowUpsForQuestion(plan, id));
    }

    // 2. Resolve the pointer, skipping time-expired questions (bounded loop).
    const previousQuestionId = progress.currentQuestionId;
    for (let guard = 0; guard < plan.phases.flatMap((p) => p.questions).length + 2; guard++) {
        const elapsedMs = nowMs - startedAtMs;
        const currentQuestionElapsedMs = progress.currentQuestionId ? nowMs - progress.currentStartedAtMs : 0;
        const decision = decideScreeningPointer({
            plan,
            elapsedMs,
            answeredQuestionIds: progress.answered,
            followUpsUsedByQuestion: progress.followUps,
            currentQuestionElapsedMs,
        });

        if (decision.forceClose) {
            progress.currentQuestionId = null;
            return { decision, forceClose: true, changedQuestion: previousQuestionId !== null };
        }

        if (decision.forceAdvanceQuestion && decision.currentQuestionId) {
            // Time on this question is spent: mark it exhausted and reset so the next
            // question starts with a fresh budget on the next loop iteration.
            const id = decision.currentQuestionId;
            progress.answered.add(id);
            progress.followUps.set(id, maxFollowUpsForQuestion(plan, id));
            progress.currentQuestionId = null;
            continue;
        }

        // Stable pointer.
        const changedQuestion = decision.currentQuestionId !== progress.currentQuestionId;
        if (changedQuestion) {
            progress.currentQuestionId = decision.currentQuestionId;
            progress.currentStartedAtMs = nowMs;
        }
        return { decision, forceClose: false, changedQuestion: decision.currentQuestionId !== previousQuestionId };
    }

    // Defensive: loop guard tripped — close rather than spin.
    progress.currentQuestionId = null;
    return {
        decision: { currentQuestionId: null, currentPhaseId: null, followUpsRemaining: 0, forceAdvanceQuestion: false, forceClose: true, reason: "Pointer resolution guard tripped; closing." },
        forceClose: true,
        changedQuestion: previousQuestionId !== null,
    };
}
