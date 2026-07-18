import type { InterviewStage } from "@interviewforge/shared";
import type { ScreeningBlueprint, ScreeningPhaseType } from "./blueprint.js";
import { COMPANY_SCREENING_STAGE_PROMPTS } from "./stage-prompts.js";
import { stageForPhaseType } from "./stage-mapping.js";

export type CompanyScreeningRuntimeContext = {
    version: 1;
    roundCandidateId: string;
    jobRoundId: string;
    applicationId: string;
    blueprintSnapshot: ScreeningBlueprint;
    strictRuntimeEnabled?: boolean;
};

function toRecord(value: unknown): Record<string, any> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function truncate(text: string, max: number) {
    const clean = text.replace(/\s+/g, " ").trim();
    return clean.length > max ? `${clean.slice(0, max - 3)}...` : clean;
}

function numberedList(items: string[]) {
    return items.map((item, index) => `${index + 1}. ${item}`).join("\n");
}

export function normalizeCompanyScreeningRuntimeContext(value: unknown): CompanyScreeningRuntimeContext | null {
    const source = toRecord(value);
    const blueprint = toRecord(source.blueprintSnapshot);
    if (source.version !== 1 || blueprint.version !== 1 || blueprint.template !== "sde_screening") {
        return null;
    }

    return {
        version: 1,
        roundCandidateId: String(source.roundCandidateId || ""),
        jobRoundId: String(source.jobRoundId || ""),
        applicationId: String(source.applicationId || ""),
        blueprintSnapshot: blueprint as ScreeningBlueprint,
        strictRuntimeEnabled: source.strictRuntimeEnabled !== false,
    };
}

export function buildCompanyScreeningOpeningMessage(context: CompanyScreeningRuntimeContext, role?: string | null) {
    const blueprint = context.blueprintSnapshot;
    const title = blueprint.title || "AI screening interview";
    const roleText = role ? ` for the ${role} role` : "";
    return [
        `Welcome. This is ${title}${roleText}.`,
        "I will ask the configured screening questions one at a time and may ask short follow-ups when needed.",
        "Let's begin.",
    ].join(" ");
}

export type CompanyScreeningRuntimeTiming = {
    /** Whole minutes elapsed since the interview started. */
    elapsedMinutes: number;
    /** Total interview budget in minutes (blueprint duration). */
    totalMinutes: number;
    /** Blueprint question ids already covered (asked/answered). */
    answeredQuestionIds?: string[];
};

/**
 * Builds the per-turn timing block. Because the directive is recompiled every
 * turn, this gives the otherwise-stateless interviewer fresh awareness of how
 * much time and how many questions remain, so it can pace follow-up depth by
 * remaining budget instead of a fixed per-question timer.
 */
function buildPacingBlock(
    timing: CompanyScreeningRuntimeTiming,
    totalQuestions: number
): string {
    const total = Math.max(1, Math.round(timing.totalMinutes));
    const elapsed = Math.max(0, Math.min(total, Math.round(timing.elapsedMinutes)));
    const remaining = Math.max(0, total - elapsed);
    const answered = new Set((timing.answeredQuestionIds || []).filter(Boolean));
    const remainingQuestions = Math.max(0, totalQuestions - answered.size);
    const perQuestion = remainingQuestions > 0 ? Math.max(1, Math.round(remaining / remainingQuestions)) : remaining;
    const ahead = remainingQuestions > 0 && remaining / remainingQuestions >= 1.5;
    const behind = remainingQuestions > 0 && remaining / remainingQuestions < 0.75;

    const guidance = remainingQuestions === 0
        ? "All configured questions are covered. Wrap up and move to closing; do not start new threads."
        : behind
            ? `You are behind pace. Spend about ${perQuestion} min per remaining question, keep follow-ups to the single most important gap, and move on quickly.`
            : ahead
                ? `You are ahead of pace. You may use up to the question's max follow-ups to probe depth, ownership, tradeoffs, and edge cases before advancing.`
                : `Aim for about ${perQuestion} min per remaining question. Ask a follow-up only when it adds real evaluation signal; otherwise advance.`;

    return `### Live Pacing (recomputed each turn)
- Time used: ${elapsed} of ${total} min. Remaining: ${remaining} min.
- Questions covered: ${answered.size} of ${totalQuestions}. Remaining: ${remainingQuestions}.
- Pacing: ${guidance}
- Follow-up depth is driven by remaining time and the quality of the candidate's answer, not a fixed per-question timer. Max follow-ups per question is a ceiling, not a target.`;
}

/**
 * The server-authoritative command for THIS turn. Computed entirely on the
 * server (see pacing.ts / the orchestrator) and rendered verbatim as the hard
 * instruction. The LLM does not choose the question, count follow-ups, or decide
 * to advance — it only renders what this block says.
 */
export type CompanyScreeningAuthoritativeTurn = {
    currentQuestionId: string | null;
    currentPhaseTitle?: string | null;
    /** Resume-grounded command text when applicable, else the blueprint prompt. */
    currentPrompt: string;
    /** Hard follow-up ceiling remaining on the current question (server-counted). */
    followUpsRemaining: number;
    /** Server is forcing closing this turn (time up / all covered / candidate asked to end). */
    forceClose: boolean;
    /**
     * Two-step close sub-state (only meaningful when forceClose is true):
     *   "offer" — ask the candidate if they have any questions about the company/role; do NOT end yet.
     *   "final" — the candidate has had that chance; wrap up and call end_interview now.
     */
    closingMode?: "offer" | "final";
    questionTimeRemainingSec: number;
    overallTimeRemainingSec: number;
    /** Optional resume context (candidate's actual projects/experience) to ground on. */
    groundingBlock?: string | null;
};

function buildAuthoritativeTurnBlock(turn: CompanyScreeningAuthoritativeTurn): string {
    if (turn.forceClose || !turn.currentQuestionId) {
        if (turn.closingMode === "offer") {
            return `### Current Turn (server-authoritative)
The screening questions are complete (or the candidate asked to finish early). Do NOT start any new question or follow-up. Warmly acknowledge that the questions are done, then ask the candidate whether they have any questions about the company or the role. Do NOT call end_interview yet — ask the question and wait for the candidate's response.`;
        }
        return `### Current Turn (server-authoritative)
The candidate has had the chance to ask about the company or role. If they just asked something, answer it briefly and factually (1-2 sentences); otherwise simply acknowledge. Then give a short, warm closing line and call end_interview now. Do NOT start any new screening question or follow-up.`;
    }
    const phase = turn.currentPhaseTitle ? `[${turn.currentPhaseTitle}] ` : "";
    const grounding = turn.groundingBlock ? `\n\n${turn.groundingBlock}` : "";
    return `### Current Turn (server-authoritative)
The server assigns the question below for THIS turn. Ask only this; do not pick the next question or revisit an earlier one — the server advances and will cut you off.
- Ask now: ${phase}${truncate(turn.currentPrompt, 700)}
- Follow-ups remaining on this question: ${turn.followUpsRemaining} (HARD cap — the server counts them; do not exceed).
- Approx time left on this question: ${turn.questionTimeRemainingSec}s. Overall time left: ${turn.overallTimeRemainingSec}s.
- After you have asked it and used at most your remaining follow-ups, STOP and wait for the candidate. Do not move on yourself.${grounding}`;
}

/**
 * The reused per-phase BEHAVIOUR block for the phase the server currently has the
 * interview on. This is the "reuse the tested phase behaviour, not a flat directive"
 * asset: a decoupled company snapshot (stage-prompts.ts) telling the interviewer HOW to
 * conduct THIS phase (what to probe, strong vs weak, genai no-AI, SD tradeoffs). It
 * carries no flow-control — the server directive around it still owns pacing/advancement.
 * Skipped during closing (no active phase) — the Current Turn block governs there.
 */
function buildPhaseBehaviourBlock(currentPhaseType?: ScreeningPhaseType | null): string {
    if (!currentPhaseType) return "";
    const stage = stageForPhaseType(currentPhaseType);
    const behaviour = stage ? COMPANY_SCREENING_STAGE_PROMPTS[stage] : null;
    if (!behaviour) return "";
    return `\n\n### How To Conduct This Phase — ${currentPhaseType}\n${behaviour}`;
}

export function buildCompanyScreeningRuntimeDirective(
    context: CompanyScreeningRuntimeContext | null | undefined,
    currentStage?: InterviewStage,
    timing?: CompanyScreeningRuntimeTiming | null,
    authoritative?: CompanyScreeningAuthoritativeTurn | null,
    currentPhaseType?: ScreeningPhaseType | null,
    /** Per-phase grounding/concept-bank block for the current phase (see phase-runtime.ts). */
    phaseSupplement?: string | null
): string | null {
    if (!context) return null;
    const blueprint = context.blueprintSnapshot;
    const dimensions = blueprint.rubricDimensions || [];
    const phases = blueprint.phases || [];
    const questionCount = phases.reduce((sum, phase) => sum + phase.questions.length, 0);
    const pacingBlock = timing ? `\n\n${buildPacingBlock(timing, questionCount)}` : "";

    const rubricLines = dimensions.length
        ? dimensions.map((dimension) => {
            const tags = Array.isArray(dimension.competencyTags) && dimension.competencyTags.length
                ? ` Tags: ${dimension.competencyTags.join(", ")}.`
                : "";
            return `- ${dimension.label} (${dimension.weight}% weight).${tags}`;
        }).join("\n")
        : "- General screening signal.";

    const agendaLines = phases.flatMap((phase) => (
        phase.questions.map((question, index) => {
            const expected = question.expectedPoints
                .map((point) => truncate(point.text, 180))
                .filter(Boolean)
                .slice(0, 6);
            const expectedText = expected.length
                ? ` Evaluation-only expected signals: ${expected.join(" | ")}.`
                : "";
            // System design is bank-backed but diagrammed on the scratchpad (no IDE),
            // so it takes the SCRATCHPAD path even though it has a bank question.
            const isSystemDesignBank = question.bankQuestion?.id && question.bankQuestion.type === "system_design";
            const workspaceNote = isSystemDesignBank
                ? ` [SCRATCHPAD: after record_screening_question, call open_scratchpad to give the candidate the diagramming whiteboard. It is pre-loaded with the attached design problem${question.bankQuestion?.title ? ` ("${truncate(question.bankQuestion.title, 120)}")` : ""}; do not paste it into chat. Have them sketch the architecture and discuss components, data flow, and tradeoffs.]`
                : question.bankQuestion?.id
                    ? ` [WORKSPACE: call open_screening_workspace(questionId="${question.id}") to open the ${question.bankQuestion.type === "sql" ? "SQL editor" : "coding IDE"}; the candidate solves it there.]`
                    : phase.type === "system_design"
                        ? ` [SCRATCHPAD: after record_screening_question, call open_scratchpad to give the candidate the diagramming whiteboard; have them sketch the architecture there.]`
                        : phase.type === "genai_coding"
                            ? ` [GENAI-CODING (NO AI ASSISTANCE): pose the task, then call open_screening_workspace so the candidate codes it themselves. This is a company screening — AI assistants / Copilot are NOT permitted. Do NOT invite AI tool usage and do NOT run an AI-collaboration debrief; evaluate the candidate's OWN implementation, correctness, and understanding.]`
                            : phase.type === "behavioral"
                                ? ` [NOTEPAD: after record_screening_question, you may call open_notepad so the candidate can jot structured notes.]`
                                : "";
            return [
                `[${phase.title}] Q${index + 1} (${question.category}, id=${question.id})`,
                `Ask: ${truncate(question.prompt, 700)}`,
                `Max follow-ups after the main answer: ${Math.max(0, Math.min(2, Number(question.followUpPolicy?.maxFollowUps ?? 0)))}.`,
                expectedText,
                workspaceNote,
            ].filter(Boolean).join(" ");
        })
    ));
    // IDE-backed bank questions only (coding/SQL). System design is bank-backed too
    // but uses the scratchpad, covered by the hasSystemDesign block below.
    const hasBankQuestions = phases.some((phase) => phase.questions.some((question) =>
        question.bankQuestion?.id && question.bankQuestion.type !== "system_design"));
    const hasSystemDesign = phases.some((phase) => phase.type === "system_design");
    const hasBehavioral = phases.some((phase) => phase.type === "behavioral");
    const hasGenAICoding = phases.some((phase) => phase.type === "genai_coding");
    const toolsBlock = `\n\n### Question Tagging and Workspace Tools
- Before asking each configured question, call record_screening_question with its agenda id (e.g. q1). This tags the transcript and is required for fair per-question evaluation.
- Tools are PHASE-SCOPED by the server: only the current phase's workspace tool is available each turn. Do not attempt a tool from another phase — the server will reject it.
- Do NOT give hints, walkthroughs, or solution nudges — this is an evaluation, not coaching. If a candidate is stuck, let them work (or move on per the server's pacing) and let that factor into your read of their problem-solving.${hasBankQuestions ? `
- For questions marked [WORKSPACE] above (coding/SQL), call open_screening_workspace with that question id INSTEAD of record_screening_question. It opens the editor for the candidate and tags the question. Do not paste the problem text into chat; let the editor show it.
- The candidate runs and submits their code in the editor; you will receive their run results and code as messages. Discuss their approach, correctness, and tradeoffs based on those results.` : ""}${hasSystemDesign ? `
- For [SCRATCHPAD] system design questions, call record_screening_question first, then open_scratchpad. The candidate diagrams the architecture on the whiteboard; discuss their components, data flow, and tradeoffs.` : ""}${hasBehavioral ? `
- For [NOTEPAD] behavioral questions, you may call open_notepad after record_screening_question so the candidate can structure their thoughts.` : ""}${hasGenAICoding ? `
- For [GENAI-CODING] phases this is an UNAIDED evaluation: do NOT tell the candidate they may use Copilot/Claude/any AI assistant, and do NOT ask AI-collaboration or prompt-reconstruction questions. Assess the candidate's own code, reasoning, and verification.` : ""}`;

    const stageInstruction = (currentStage === "CLOSING" || authoritative?.forceClose)
        ? "You are wrapping up the screening. Do not ask any new screening questions — follow the Current Turn instruction below exactly."
        : `You are in the active company screening stage. There are ${questionCount} configured main questions.`;

    // Reused per-phase behaviour (decoupled snapshot) for whatever phase the server has
    // the interview on — this is the tested "how to conduct THIS phase" guidance that
    // replaces hand-rolled per-phase directive text. Omitted during closing.
    const phaseBehaviourBlock = (currentStage === "CLOSING" || authoritative?.forceClose)
        ? ""
        : buildPhaseBehaviourBlock(currentPhaseType);

    // Per-phase grounding / concept bank (reference answers, evaluation guides) — omitted
    // during closing. Kept out of the candidate's view; evaluation-only.
    const groundingSupplement = (currentStage === "CLOSING" || authoritative?.forceClose)
        ? ""
        : (phaseSupplement || "");

    // The authoritative current-turn command supersedes the advisory pacing block.
    const currentTurnBlock = authoritative
        ? `\n\n${buildAuthoritativeTurnBlock(authoritative)}`
        : pacingBlock;

    return `## Company-Owned AI Screening Runtime
This session is a company screening interview, not a practice interview. The recruiter-authored blueprint below is the source of truth.

${stageInstruction}

### Hard Runtime Rules
- The SERVER controls flow: it assigns the current question each turn (see "Current Turn" below), counts follow-ups, and decides when to advance or close. You only render the current command.
- Ask only the server-assigned question for this turn. Do NOT skip ahead, pick the next question yourself, or revisit an earlier one.
- Do not invent extra main questions, coding problems, SQL prompts, or question-bank items.
- Ask exactly one question at a time.
- Follow-ups are bounded by the server-stated remaining count below; never exceed it.
- Follow-ups should clarify missing evidence, ownership, tradeoffs, edge cases, reasoning, or correctness.
- Never reveal rubric weights, competency tags, expected answer hints, scoring logic, or internal IDs to the candidate.
- Do not mention candidate setup messages or candidate instructions; those are handled by the UI outside the AI interviewer.
- When the server says to close (Current Turn block), give a brief goodbye and call end_interview.

### Confidential Evaluation Material — NEVER Exposed To The Candidate
Sections below marked as reference solutions/queries/approaches, "what good looks like", evaluation guides, expected signals/points, the rubric, and concept reference answers are a PRIVATE evaluator aid. They exist ONLY so you can ask informed questions and privately judge answers. They must NEVER reach the candidate in any form. Specifically, you MUST NOT:
- state, read out, quote, paraphrase, summarize, or hint at any reference solution, expected point, or evaluation guide;
- tell the candidate whether their answer is right or wrong, matches the reference, or how close they are;
- correct, complete, or steer their approach toward the reference, or volunteer the optimal approach/algorithm/complexity/query;
- give partial solutions, pseudo-code, the next step, the "trick", or a leading hint — this is an evaluation, not coaching;
- if the candidate directly asks for the answer, a hint, or confirmation, briefly and politely decline and let them proceed.
Discuss ONLY what the candidate themselves said or produced. Ground every follow-up in their own answer, never in the hidden reference. A leak of this material invalidates the screen.

### Evaluation Rubric For Internal Use Only
${rubricLines}${phaseBehaviourBlock}${groundingSupplement}

### Frozen Screening Question Agenda (reference only — ask the server-assigned Current Turn question)
${agendaLines.length ? numberedList(agendaLines) : "No configured questions were provided. Move to closing."}${toolsBlock}${currentTurnBlock}`;
}
