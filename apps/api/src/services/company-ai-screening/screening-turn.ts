import type { InterviewStage } from "@interviewforge/shared";
import type { ScreeningBlueprint, ScreeningPhase, ScreeningPhaseType, ScreeningQuestion } from "./blueprint.js";
import type { CompanyScreeningAuthoritativeTurn } from "./prompt.js";
import { advanceScreeningProgress, type ScreeningPlan, type ScreeningProgress } from "./pacing.js";
import { stageForPhaseType } from "./stage-mapping.js";
import type { ResumeAgendaState } from "../agent/interview-runtime-types.js";
import {
    createInitialResumeAgendaState,
    getActiveResumeAgendaItem,
    updateResumeAgendaAfterProbe,
    nextUnaskedResumeAgendaIntent,
    buildResumeAgendaPromptBlock,
} from "../agent/resume-agenda-state.js";

/**
 * Detects a skip / decline / non-answer, so the server can advance the pointer WITHOUT
 * counting it as real coverage (recorded in progress.skipped instead). Mirrors the
 * practice resume non-answer set; conservative so a genuine short answer is not misread.
 */
export function isScreeningSkip(text: string | null | undefined): boolean {
    const n = String(text ?? "").trim().toLowerCase().replace(/[.!]+$/g, "").trim();
    if (!n || n.startsWith("[")) return false;
    if (/^(?:skip|pass|next|next question|next one|move on|no|nope|nah|none|nothing|no idea|idk|i don'?t know|dont know|do not know|not sure|not really|can'?t answer|cant answer|not comfortable|n\/a|na)$/i.test(n)) {
        return true;
    }
    // Short compound skips ("no. skip.", "i'll skip this one", "let's move on").
    const words = n.split(/\s+/);
    if (words.length <= 6 && /\b(skip|pass)\b/.test(n)) return true;
    if (/\b(i'?ll skip|let'?s skip|please skip|no comment|i pass)\b/.test(n)) return true;
    return false;
}

/**
 * Neutral, PHASE-ONLY hand-off text for a phase whose real problem lives in a
 * workspace/scratchpad or a concept bank — so the interviewer never reads out the
 * config-agent's freeform blueprint prompt (which can be off-topic, e.g. describing a
 * plain DSA problem as a "full-stack feature"). Returns null for conversational phases
 * (pm_case/pm_strategy/problem_solving/custom/behavioral) whose blueprint prompt IS the
 * question. The actual problem text comes from the editor/scratchpad, not chat.
 */
export function phaseHandoffPrompt(phaseType: ScreeningPhaseType): string | null {
    switch (phaseType) {
        case "coding":
        case "ds_coding":
        case "genai_coding":
            return "Your coding problem is now open in the editor. Take a moment to read it, then talk me through your approach and its complexity as you implement it.";
        case "cs_sql":
        case "ds_sql":
            return "Your SQL problem is now open in the editor with its schema. Read it over, then walk me through your query approach as you write it.";
        case "system_design":
            return "Your system design problem is on the scratchpad. Start by clarifying the requirements and constraints, then sketch the high-level architecture before we go deep on the key components.";
        case "ds_concepts":
        case "genai_concepts":
        case "pm_concepts":
        case "cs_theory":
            return "I'll ask you a few short concept questions for this round — answer each in your own words and I'll follow up on your reasoning.";
        default:
            return null;
    }
}

/**
 * Forceful transition notice pushed into the LLM history the moment the server pacing pointer
 * moves to a NEW phase — the company-side mirror of how practice interviews anchor stage
 * transitions (a high-salience [SYSTEM NOTIFICATION] that states the move and forbids goodbye /
 * greeting language). GENERIC across every phase type — the next phase is whatever the recruiter
 * configured, never hardcoded. This is what stops the model from reading "the candidate declined
 * the whole resume" (or any weak phase) as "the interview is over" and saying goodbye mid-screen.
 */
export function buildScreeningPhaseTransitionNotice(nextPhaseType: ScreeningPhaseType): string {
    const doNext = phaseHandoffPrompt(nextPhaseType)
        ?? "Continue directly with the next configured question the server provides for this phase.";
    return `[SYSTEM NOTIFICATION] The previous part of the screening is complete and the interview CONTINUES — more configured phases remain after this one. Do NOT say goodbye, do NOT thank the candidate for their time, and do NOT imply the interview is ending or that only one round was configured. You have moved into the ${nextPhaseType} phase. ${doNext}`;
}

export type CandidateProjectFact = { name: string; description: string; tech: string[] };

/**
 * Whitelist-only extraction of the candidate's OWN project facts from their application
 * evidence (`jobApplication.githubAnalysis.projects`). This is the STRUCTURAL leak guard
 * for the recruiter→candidate boundary: it copies ONLY factual, candidate-owned fields
 * (repo name, description, language/topics) and deliberately drops every recruiter-side
 * judgment — score/slotScore/reason/slotVerdict/criteria/qualityBars/risks/scoringConfig
 * and the per-project `ai` analysis. Nothing recruiter-facing can physically reach the
 * candidate session because it is never read here, not merely "instructed to be hidden".
 * Skips forked/skipped repos (not the candidate's original work).
 */
export function extractCandidateProjectFacts(application: any): CandidateProjectFact[] {
    const projects = Array.isArray(application?.githubAnalysis?.projects) ? application.githubAnalysis.projects : [];
    const out: CandidateProjectFact[] = [];
    for (const p of projects) {
        const repo = p?.repo;
        if (!repo || p?.skipped || repo?.fork) continue;
        const name = String(repo.name || repo.fullName || "").trim();
        if (!name) continue;
        const tech = [repo.language, ...(Array.isArray(repo.topics) ? repo.topics : [])]
            .map((t: any) => String(t ?? "").trim())
            .filter(Boolean)
            .slice(0, 8);
        out.push({ name, description: String(repo.description ?? "").trim().slice(0, 240), tech });
    }
    return out.slice(0, 6);
}

function clip(value: unknown, max: number): string {
    const s = String(value ?? "").replace(/\s+/g, " ").trim();
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export type CandidateProjectVerification = { name: string; whatItIs: string; ownership?: string; signals: string[] };

/**
 * EVALUATION-ONLY verification extraction of the candidate's OWN repos — the per-project `ai`
 * analysis that extractCandidateProjectFacts deliberately DROPS (summary of what the code
 * actually is, verified ownership/contribution, and risk signals like shared ownership or low
 * commit volume). This is NEVER surfaced to the candidate: it is injected as hidden grounding
 * into the RESUME phase ONLY, so the interviewer can cross-check the candidate's claims against
 * what the code actually shows and catch overclaiming. The leak-guard redacts any of it from the
 * interviewer's spoken output. Skips forks/skipped repos and repos with no ai analysis.
 */
export function extractCandidateProjectVerification(application: any): CandidateProjectVerification[] {
    const projects = Array.isArray(application?.githubAnalysis?.projects) ? application.githubAnalysis.projects : [];
    const out: CandidateProjectVerification[] = [];
    for (const p of projects) {
        const repo = p?.repo;
        const ai = p?.ai;
        if (!repo || p?.skipped || repo?.fork || !ai) continue;
        const name = String(repo.name || repo.fullName || "").trim();
        const whatItIs = clip(ai.summary, 220);
        if (!name || !whatItIs) continue;
        const ownership = ai.ownership ? clip(ai.ownership, 140) : undefined;
        const signals = (Array.isArray(ai.risks) ? ai.risks : [])
            .map((r: any) => clip(r, 160))
            .filter(Boolean)
            .slice(0, 2);
        out.push({ name, whatItIs, ownership, signals });
    }
    return out.slice(0, 4);
}

/**
 * Concise, EVALUATION-ONLY resume verification grounding — injected ONLY into the resume phase
 * (never elsewhere: it would be token waste and off-topic). Kept tight so it costs little.
 */
export function buildResumeVerificationGrounding(verifications: CandidateProjectVerification[] | null | undefined): string | null {
    if (!verifications?.length) return null;
    const body = verifications.map((v) => {
        const parts = [`- ${v.name}: ${v.whatItIs}`];
        if (v.ownership) parts.push(`  Verified ownership: ${v.ownership}`);
        if (v.signals.length) parts.push(`  Probe these signals: ${v.signals.join(" | ")}`);
        return parts.join("\n");
    }).join("\n");
    return `GitHub verification (EVALUATION ONLY — the candidate's ACTUAL repo analysis; NEVER reveal or read it out). Cross-check their claims against this; if they overclaim ownership or describe something the code does not support, probe it directly (e.g. "the commit history shows shared ownership here — which parts did YOU personally write and test?"):\n${body}`;
}

/**
 * The confidential FACTUAL strings from the verification (repo summary, verified ownership, risk
 * signals) — for the leak-guard to redact if the interviewer reproduces them to the candidate.
 * Returns ONLY the analysis facts, NEVER the probing guidance (which the interviewer is meant to
 * rephrase and speak). Mirrors how coding reference solutions are collected as leak-guard secrets.
 */
export function resumeVerificationSecrets(verifications: CandidateProjectVerification[] | null | undefined): string[] {
    const out: string[] = [];
    for (const v of verifications ?? []) {
        if (v.whatItIs) out.push(v.whatItIs);
        if (v.ownership) out.push(v.ownership);
        for (const s of v.signals) if (s) out.push(s);
    }
    return out;
}

/**
 * Merge whitelisted GitHub project facts into a resume summary's project list (dedup by
 * name) so the candidate's VERIFIED work becomes first-class resume-agenda + behavioral
 * grounding — the same shape `createInitialResumeAgendaState` already reads (name /
 * description / techStack). Produces a minimal summary from the facts alone when there is
 * no resume summary, so even a candidate with no parsed resume gets a grounded screening.
 */
export function mergeCandidateProjectsIntoResume(resumeSummary: any | null | undefined, facts: CandidateProjectFact[]): any | null {
    if (!facts.length) return resumeSummary ?? null;
    const base = resumeSummary && typeof resumeSummary === "object" ? { ...resumeSummary } : {};
    const existing = Array.isArray(base.projects) ? base.projects.slice() : [];
    const seen = new Set(
        existing.map((p: any) => String(p?.name || p?.title || "").trim().toLowerCase()).filter(Boolean)
    );
    for (const f of facts) {
        if (seen.has(f.name.toLowerCase())) continue;
        existing.push({ name: f.name, description: f.description, techStack: f.tech, source: "github" });
        seen.add(f.name.toLowerCase());
    }
    base.projects = existing;
    return base;
}

/**
 * Build the resume agenda for a screening session, but ONLY when the parsed resume has
 * real substance (a project / experience / responsibility). Returns null otherwise so the
 * resume phase falls back to generic behaviour instead of running a lone "role fit" item.
 */
export function seedScreeningResumeAgenda(resumeSummary: any | null | undefined): ResumeAgendaState | null {
    const s = resumeSummary;
    const len = (v: any) => (Array.isArray(v) ? v.length : 0);
    const hasRealItems = !!s && (
        len(s.projects) > 0 ||
        len(s.experience) > 0 ||
        len(s.positionsOfResponsibility) > 0 ||
        len(s.leadership) > 0 ||
        len(s.responsibilities) > 0
    );
    return hasRealItems ? createInitialResumeAgendaState(s) : null;
}

export type ScreeningResumeAgendaTurn = {
    agenda: ResumeAgendaState;
    /** Instruction for the interviewer to render one grounded question on the active item. */
    prompt: string;
    /** The full server-owned resume agenda block (active item, evidence, allowed intents, caps). */
    grounding: string;
    /** True when every agenda item is closed — the caller lets the phase advance. */
    exhausted: boolean;
};

/**
 * Drive ONE turn of the server-owned resume agenda for the screening resume phase —
 * the same mechanism the practice resume round uses, so screening resume coverage is
 * grounded on the candidate's ACTUAL resume items with an intent escalation ladder and
 * honest skip handling (a skip closes the item as declined and moves to the next one,
 * never faked as covered). `advance` is false on the first turn we enter the phase
 * (there is no prior answer to grade yet).
 */
export function driveScreeningResumeAgendaTurn(args: {
    agenda: ResumeAgendaState;
    candidateMessage: string | null;
    advance: boolean;
}): ScreeningResumeAgendaTurn {
    let agenda = args.agenda;
    if (args.advance) {
        const active = getActiveResumeAgendaItem(agenda);
        if (active) {
            const skip = isScreeningSkip(args.candidateMessage);
            agenda = updateResumeAgendaAfterProbe(agenda, {
                agendaItemId: active.id,
                intent: nextUnaskedResumeAgendaIntent(active),
                answerQuality: skip ? "declined" : "partial",
                shouldCloseItem: skip,
            }) ?? agenda;
        }
    }
    const active = getActiveResumeAgendaItem(agenda);
    const grounding = buildResumeAgendaPromptBlock(agenda) ?? "";
    const prompt = active
        ? `Ask one natural, specific interviewer question about the candidate's "${active.label}" (${active.type}${active.mode ? `/${active.mode}` : ""}) from their resume, at the depth indicated below. Ground it in their actual resume evidence — never a generic resume question.`
        : "";
    return { agenda, prompt, grounding, exhausted: !active };
}

/**
 * Evaluation-only resume context for the BEHAVIORAL phase, so the STAR example is
 * anchored on the candidate's real projects/experience instead of a generic story.
 * Resume context is injected ONLY into the resume + behavioral phases (never the
 * technical phases, where it adds no signal and only inflates the token count).
 */
export function buildBehavioralResumeContext(resumeSummary: any | null | undefined): string | null {
    if (!resumeSummary) return null;
    let items: string[] = [];
    try {
        const agenda = createInitialResumeAgendaState(resumeSummary);
        items = (agenda?.items || [])
            .filter((i: any) => i.type === "project" || i.type === "experience")
            .sort((a: any, b: any) => a.priority - b.priority)
            .slice(0, 5)
            .map((i: any) => `- ${i.label}${i.summary ? `: ${String(i.summary).slice(0, 140)}` : ""}`);
    } catch {
        return null;
    }
    if (!items.length) return null;
    return `Resume context for grounding the behavioral question (evaluation only — the candidate's real work). Anchor the STAR example on their ACTUAL projects/experience below; if they answer generically, steer them to a concrete situation from one of these:\n${items.join("\n")}`;
}

/**
 * PURE, session-agnostic server-authoritative screening turn resolver.
 *
 * This is the shared core of the screening pacing pointer so BOTH turn pipelines can be
 * server-driven identically: the text `processAgentTurn` path (via the orchestrator's
 * enforceCompanyScreeningTurn) and — the point of this module — the VOICE `generateAndSpeak`
 * path, which previously had no server enforcement. It contains NO side effects (no socket
 * emit, no DB, no tool calls); it takes the plan/progress/flags and returns the authoritative
 * turn plus the side-effect INTENTS (close a panel, enter closing stage) for the caller to
 * apply in its own way. The pure pacing math is reused from pacing.ts.
 *
 * SEPARATION: company-owned. It reuses the practice resume parser read-only (same as the
 * orchestrator already does) and never mutates any practice state.
 */

/** Phase types that open a workspace panel — the caller closes the old one when the phase changes. */
export const SCREENING_PHASE_TYPES_WITH_TOOL: ReadonlySet<ScreeningPhaseType> = new Set<ScreeningPhaseType>([
    "coding", "cs_sql", "ds_sql", "ds_coding", "genai_coding", "system_design", "pm_case", "problem_solving", "behavioral",
]);

/** Locate the phase+question owning a blueprint question id. Pure. */
export function findScreeningQuestionInBlueprint(
    blueprint: ScreeningBlueprint | null | undefined,
    questionId: string | null
): { phase: ScreeningPhase; question: ScreeningQuestion } | null {
    if (!blueprint || !questionId) return null;
    for (const phase of blueprint.phases) {
        const question = phase.questions.find((q) => q.id === questionId);
        if (question) return { phase, question };
    }
    return null;
}

/**
 * Build a resume-grounded command + context for the resume phase, reusing the practice
 * resume parser. Returns null when there is no parsed resume, so the caller falls back to
 * the recruiter's generic prompt. Read-only reuse — does not mutate practice resume state.
 * (Mirror of the orchestrator's private helper; kept here so the voice path can reuse it.)
 */
export function buildScreeningResumeGrounding(
    resumeSummary: any | null | undefined,
    question: { followUpPolicy?: { askOwnershipVerification?: boolean; askImpact?: boolean; askTechnicalDepth?: boolean } }
): { prompt: string; grounding: string } | null {
    if (!resumeSummary) return null;
    let items: Array<{ type: string; label: string; summary: string; priority: number }> = [];
    try {
        const agenda = createInitialResumeAgendaState(resumeSummary);
        items = (agenda?.items || [])
            .slice()
            .sort((a: any, b: any) => a.priority - b.priority)
            .map((item: any) => ({ type: String(item.type || "item"), label: String(item.label || ""), summary: String(item.summary || ""), priority: Number(item.priority || 0) }))
            .filter((item) => item.label);
    } catch (err) {
        console.warn("[ScreeningTurn] resume grounding parse failed; falling back to recruiter prompt", err);
        return null;
    }
    if (!items.length) return null;

    const focusBits: string[] = [];
    const policy = question.followUpPolicy || {};
    if (policy.askOwnershipVerification !== false) focusBits.push("verify what they personally owned vs. team/tooling");
    if (policy.askImpact !== false) focusBits.push("probe measurable impact (metric, user value, or verification)");
    if (policy.askTechnicalDepth !== false) focusBits.push("probe concrete technical decisions and tradeoffs");
    const focus = focusBits.length ? ` Focus on: ${focusBits.join("; ")}.` : "";

    const list = items.slice(0, 6).map((item, index) => `${index + 1}. [${item.type}] ${item.label}${item.summary ? `: ${item.summary.slice(0, 160)}` : ""}`).join("\n");

    return {
        prompt: `Probe the candidate on their most role-relevant project or experience from their actual resume (listed below), highest priority first.${focus}`,
        grounding: `Resume grounding — the candidate's ACTUAL resume items. Ground every resume question on these; never ask a generic resume question:\n${list}\nCover the highest-priority items first; the server bounds your total time and follow-ups for this phase.`,
    };
}

export type ScreeningTurnInput = {
    blueprint: ScreeningBlueprint;
    /** Static budget plan (caller lazy-inits via computeScreeningPlan and persists on the session). */
    plan: ScreeningPlan;
    /** Live progress (caller lazy-inits via createScreeningProgress); MUTATED in place by advance. */
    progress: ScreeningProgress;
    startedAtMs: number;
    nowMs: number;
    /** The candidate answered the current question this turn (drives pointer advance). */
    candidateAnswered: boolean;
    /** The candidate skipped/declined the current question this turn (advances but not counted as coverage). */
    candidateSkipped?: boolean;
    /** The candidate explicitly asked to end early this turn. */
    candidateEndRequest: boolean;
    /** Raw candidate message this turn (for resume-agenda answer grading). */
    candidateMessage?: string | null;
    resumeSummary: any;
    /**
     * Pre-built EVALUATION-ONLY GitHub verification grounding (from buildResumeVerificationGrounding).
     * Injected ONLY into the resume phase so the interviewer can verify the candidate's project
     * claims against their real repo analysis. null when there is no GitHub analysis.
     */
    githubVerification?: string | null;
    /**
     * Live server-owned resume agenda (caller lazy-inits via createInitialResumeAgendaState
     * when a parsed resume exists). Drives the resume phase; null → generic single-question
     * resume behaviour. MUTATED-then-returned as `resumeAgenda` for the caller to persist.
     */
    resumeAgenda?: ResumeAgendaState | null;
    /** The phase type the interview was on before this turn (for panel-close-on-change). */
    previousPhaseType: ScreeningPhaseType | null;
    /** Sticky: closing already started on a prior turn. */
    closingForced: boolean;
    /** Sticky: the "any questions about the company/role?" offer turn already happened. */
    closingQuestionOffered: boolean;
    /** Whether the session is already in the terminal CLOSING stage. */
    currentStageIsClosing: boolean;
};

export type ScreeningTurnResolution = {
    /** The per-turn command for the interviewer (fed to buildCompanyScreeningRuntimeDirective). */
    turn: CompanyScreeningAuthoritativeTurn;
    /** The phase type now active (null while closing). Persist on the session. */
    currentPhaseType: ScreeningPhaseType | null;
    /** Caller should emit panel:close for the previous phase's workspace. */
    closePreviousPanel: boolean;
    /** Caller should move the session into the terminal CLOSING stage this turn. */
    enterClosingStage: boolean;
    /**
     * The InterviewStage the ACTIVE phase runs as (via stage-mapping), set only on the turn the
     * phase changed — so the caller drives `currentStage` to FOLLOW the pacing pointer instead of
     * leaving it pinned on the BEHAVIOURAL container. null when the phase did not change, has no
     * mapped stage, or while closing (closing is signalled via enterClosingStage). Safe now that
     * screening tools come from buildScreeningTools (phase-based) and no longer depend on stage.
     */
    enterStage: InterviewStage | null;
    /** Updated sticky closing flags to persist on the session. */
    closingForced: boolean;
    closingQuestionOffered: boolean;
    overallTimeRemainingSec: number;
    /** Updated resume agenda (when the resume phase drove it this turn); persist on the session. */
    resumeAgenda?: ResumeAgendaState | null;
};

/**
 * Resolve the server-authoritative turn. Mutates `progress` in place (via
 * advanceScreeningProgress) — the caller owns persisting plan/progress on its session.
 */
export function resolveScreeningAuthoritativeTurn(input: ScreeningTurnInput): ScreeningTurnResolution {
    const { blueprint, plan, progress, startedAtMs, nowMs } = input;

    // Resume phase: while parked on the resume blueprint question, drive the server-owned
    // resume agenda each turn (grounded, escalating, honest skips). Park the pacing pointer
    // on the question (candidateAnswered=false) until the agenda is exhausted OR the phase
    // time budget force-advances it — then let the pointer move to the next phase.
    const wasResume = input.previousPhaseType === "resume_project";
    let updatedAgenda: ResumeAgendaState | null = input.resumeAgenda ?? null;
    let resumeTurnPrompt: string | null = null;
    let resumeTurnGrounding: string | null = null;
    let effectiveAnswered = input.candidateAnswered;
    let effectiveSkipped = input.candidateSkipped ?? false;
    // True only on the turn the resume ladder finishes, so the pacing pointer force-advances
    // OFF the resume phase to the next configured phase (or closing) instead of parking on a
    // still-has-follow-ups resume question. Depth inside the resume phase is owned by the
    // ladder's own per-item turn caps, not the question's follow-up counter.
    let resumeLadderExhausted = false;
    if (wasResume && updatedAgenda) {
        const t = driveScreeningResumeAgendaTurn({ agenda: updatedAgenda, candidateMessage: input.candidateMessage ?? null, advance: true });
        updatedAgenda = t.agenda;
        resumeTurnPrompt = t.prompt;
        resumeTurnGrounding = t.grounding;
        effectiveAnswered = t.exhausted;
        effectiveSkipped = false;
        resumeLadderExhausted = t.exhausted;
    }

    const result = advanceScreeningProgress({ plan, progress, startedAtMs, nowMs, candidateAnswered: effectiveAnswered, candidateSkipped: effectiveSkipped, forceCompleteCurrent: resumeLadderExhausted });
    const overallTimeRemainingSec = Math.max(0, Math.round((plan.usableMs - (nowMs - startedAtMs)) / 1000));

    // The round closes when the server budget/coverage is reached OR the candidate asks to
    // finish early — but never abruptly. A sticky two-step close: first OFFER a company/role
    // question turn, then (next turn) wrap up and end.
    const shouldClose = result.forceClose || input.candidateEndRequest || input.closingForced;
    if (shouldClose) {
        const closingMode: "offer" | "final" = input.closingQuestionOffered ? "final" : "offer";
        const closePreviousPanel = Boolean(input.previousPhaseType && SCREENING_PHASE_TYPES_WITH_TOOL.has(input.previousPhaseType));
        return {
            turn: {
                currentQuestionId: null,
                currentPrompt: "",
                followUpsRemaining: 0,
                forceClose: true,
                closingMode,
                questionTimeRemainingSec: 0,
                overallTimeRemainingSec,
            },
            currentPhaseType: null,
            closePreviousPanel,
            // Only sanction entering CLOSING (where end_interview is allowed) on the FINAL step.
            enterClosingStage: closingMode === "final" && !input.currentStageIsClosing,
            enterStage: null,
            closingForced: true,
            closingQuestionOffered: input.closingQuestionOffered || closingMode === "offer",
            overallTimeRemainingSec,
            resumeAgenda: updatedAgenda,
        };
    }

    const currentId = result.decision.currentQuestionId;
    const found = findScreeningQuestionInBlueprint(blueprint, currentId);
    const nextPhaseType = found?.phase.type ?? null;
    let currentPrompt = found?.question.prompt ?? "";
    let groundingBlock: string | null = null;

    if (nextPhaseType === "resume_project" && updatedAgenda && !getActiveResumeAgendaItem(updatedAgenda)) {
        // Ladder finished but the pacing pointer is still on a resume question (a multi-question
        // resume phase). Do NOT emit the practice resume "close the interview now" grounding —
        // in a screening, resume is one phase among many. Give a neutral hand-off; the pointer
        // force-advances off the remaining resume questions on the following turns.
        currentPrompt = "Thanks — that covers the resume and project discussion. Let's continue with the next part of the interview.";
        groundingBlock = null;
    } else if (nextPhaseType === "resume_project" && updatedAgenda) {
        // Agenda-driven resume phase (grounded, escalating). First turn on the phase:
        // present the top item without grading a (non-existent) prior answer.
        if (!wasResume) {
            const t = driveScreeningResumeAgendaTurn({ agenda: updatedAgenda, candidateMessage: null, advance: false });
            updatedAgenda = t.agenda;
            currentPrompt = t.prompt || currentPrompt;
            groundingBlock = t.grounding || null;
        } else {
            if (resumeTurnPrompt) currentPrompt = resumeTurnPrompt;
            groundingBlock = resumeTurnGrounding;
        }
    } else if (nextPhaseType === "resume_project") {
        // No parsed resume: fall back to grounded generic probing if any, else blueprint prompt.
        const grounded = buildScreeningResumeGrounding(input.resumeSummary, found!.question);
        if (grounded) {
            currentPrompt = grounded.prompt;
            groundingBlock = grounded.grounding;
        }
    } else if (nextPhaseType === "behavioral") {
        // Behavioral is resume-grounded: anchor the STAR question on the candidate's real
        // work rather than a generic (often off-topic) blueprint prompt. Falls back to the
        // blueprint prompt only when there is no parsed resume to anchor on.
        const ctx = buildBehavioralResumeContext(input.resumeSummary);
        if (ctx) {
            groundingBlock = ctx;
            currentPrompt = "Ask one behavioral (STAR) question grounded in the candidate's real work listed below — probe ownership, a hard decision or tradeoff, a conflict, or a failure on one of their actual projects/experiences. Follow up to separate genuine ownership from a rehearsed narrative.";
        }
    } else if (nextPhaseType) {
        // Workspace/scratchpad/concept phases: speak a neutral, phase-only hand-off — never
        // the config-agent's freeform blueprint prompt (which can misdescribe the problem).
        const handoff = phaseHandoffPrompt(nextPhaseType);
        if (handoff) currentPrompt = handoff;
    }

    // GitHub verification grounding — appended ONLY in the resume phase, so the interviewer can
    // cross-check the candidate's project claims against their real repo analysis. Deliberately
    // NOT injected in any other phase (token waste + off-topic). Evaluation-only; leak-guarded.
    if (nextPhaseType === "resume_project" && input.githubVerification) {
        groundingBlock = groundingBlock
            ? `${groundingBlock}\n\n${input.githubVerification}`
            : input.githubVerification;
    }

    const questionBudgetMs = found
        ? (plan.phases.flatMap((p) => p.questions).find((q) => q.questionId === currentId)?.budgetMs ?? 0)
        : 0;
    const questionElapsedMs = currentId ? nowMs - progress.currentStartedAtMs : 0;
    const questionTimeRemainingSec = Math.max(0, Math.round((questionBudgetMs - questionElapsedMs) / 1000));

    const changedPhase = input.previousPhaseType !== nextPhaseType;
    const closePreviousPanel = changedPhase && Boolean(input.previousPhaseType && SCREENING_PHASE_TYPES_WITH_TOOL.has(input.previousPhaseType));
    // Drive currentStage to follow the pacing pointer: on a phase change, the new phase's mapped
    // stage (resume->INTRO, coding->DSA, cs_sql->FUNDAMENTALS, system_design->SYSTEM_DESIGN,
    // behavioral->BEHAVIOURAL). Replaces the pinned BEHAVIOURAL container so message stage tags,
    // stage labels, and per-phase client UI reflect the real phase.
    const enterStage = changedPhase && nextPhaseType ? stageForPhaseType(nextPhaseType) : null;

    return {
        turn: {
            currentQuestionId: currentId,
            currentPhaseTitle: found?.phase.title ?? null,
            currentPrompt,
            followUpsRemaining: result.decision.followUpsRemaining,
            forceClose: false,
            questionTimeRemainingSec,
            overallTimeRemainingSec,
            groundingBlock,
        },
        currentPhaseType: nextPhaseType,
        closePreviousPanel,
        enterClosingStage: false,
        enterStage,
        closingForced: false,
        closingQuestionOffered: input.closingQuestionOffered,
        overallTimeRemainingSec,
        resumeAgenda: updatedAgenda,
    };
}
