import type { ScreeningBlueprint, ScreeningPhaseType } from "./blueprint.js";
import { sampleConceptQuestions, type ConceptPoolQuestion } from "./question-prefetch.js";
// NOTE: the practice prefetch modules (ds/genai/pm/problem-solving) pull in prisma + mongoose
// models at load time, so they are imported LAZILY inside prefetchScreeningPhaseRuntime. This
// keeps the pure buildScreeningPhaseSupplement importable without dragging in the DB layer
// (which lets it be unit-tested and avoids load-time side effects).

/**
 * Runtime completion for the role-specific screening phases.
 *
 * The original phases (coding/cs_sql/system_design/behavioral) already run end-to-end via
 * the recruiter bank + open_screening_workspace/open_scratchpad. The role phases (ds_*,
 * genai_*, pm_*, problem_solving, concept/theory) need the SAME per-modality editor/panel
 * handling the PRACTICE interviews already have — so instead of reinventing it, we reuse the
 * practice prefetch functions (which load each modality's question in the exact shape its
 * panel handler expects) and stash them in the standard `prefetched*` fields. The panel then
 * opens through the same practice handler (handleOpenSQLEditor/handleOpenIDE/handleOpenNotepad).
 *
 * NOTE: these role phases are auto-picked (swap deferred), so at runtime we take the practice
 * prefetch's pick from the same collection rather than the recruiter's placeholder bank ref.
 * When artifact swap UI lands, this is where we'd load the recruiter's specific question id.
 */

export type ScreeningPhasePrefetch = {
    prefetchedDSSQLQuestion?: any;
    prefetchedDSCodingQuestion?: any;
    prefetchedDSConceptQuestions?: any[];
    prefetchedGenAICodingQuestion?: any;
    prefetchedGenAIConceptQuestions?: any[];
    prefetchedPMCaseQuestion?: any;
    prefetchedPMConceptQuestions?: any[];
    prefetchedPMStrategyQuestion?: any;
    prefetchedProblemSolvingCaseQuestion?: any;
    /** cs_theory pool (CSFundamentalQuestion) — no practice single-stage prefetch, so sampled here. */
    csTheoryQuestions?: ConceptPoolQuestion[];
};

/**
 * Load every role-phase question the blueprint needs, in the practice shape, via the practice
 * prefetch functions. One DB pass per modality present; never throws (a failed modality is
 * skipped and logged so one bad bank cannot strand the session).
 */
export async function prefetchScreeningPhaseRuntime(
    blueprint: ScreeningBlueprint,
    sessionId: string,
    userId: string
): Promise<ScreeningPhasePrefetch> {
    const types = new Set((blueprint.phases || []).map((p) => p.type));
    const out: ScreeningPhasePrefetch = {};
    const has = (t: ScreeningPhaseType) => types.has(t);

    if (has("ds_sql") || has("ds_coding") || has("ds_concepts")) {
        try {
            const { prefetchDSQuestions } = await import("../agent/ds-prefetch.js");
            const ds = await prefetchDSQuestions(sessionId, userId, "ScreeningDS", {
                includeSQL: has("ds_sql"),
                includeCoding: has("ds_coding"),
                includeConcepts: has("ds_concepts"),
            } as any);
            if (has("ds_sql")) out.prefetchedDSSQLQuestion = (ds as any).sqlQuestion ?? undefined;
            if (has("ds_coding")) out.prefetchedDSCodingQuestion = (ds as any).codingQuestion ?? undefined;
            if (has("ds_concepts")) out.prefetchedDSConceptQuestions = (ds as any).conceptQuestions ?? undefined;
        } catch (e: any) { console.warn("[screening-runtime] DS prefetch failed:", e?.message || e); }
    }

    if (has("genai_coding") || has("genai_concepts")) {
        try {
            const { prefetchGenAIQuestions } = await import("../agent/genai-prefetch.js");
            const g = await prefetchGenAIQuestions(sessionId, userId, "ScreeningGenAI", {
                includeCoding: has("genai_coding"),
                includeConcepts: has("genai_concepts"),
                includeSystemDesign: false,
            } as any);
            if (has("genai_coding")) out.prefetchedGenAICodingQuestion = (g as any).codingQuestion ?? undefined;
            if (has("genai_concepts")) out.prefetchedGenAIConceptQuestions = (g as any).conceptQuestions ?? undefined;
        } catch (e: any) { console.warn("[screening-runtime] GenAI prefetch failed:", e?.message || e); }
    }

    if (has("pm_case") || has("pm_concepts") || has("pm_strategy")) {
        try {
            const { prefetchPMQuestions } = await import("../agent/pm-prefetch.js");
            const pm = await prefetchPMQuestions(sessionId, userId, "ScreeningPM", {
                includeCase: has("pm_case"),
                includeConcepts: has("pm_concepts"),
                includeStrategy: has("pm_strategy"),
            } as any);
            if (has("pm_case")) out.prefetchedPMCaseQuestion = (pm as any).caseQuestion ?? undefined;
            if (has("pm_concepts")) out.prefetchedPMConceptQuestions = (pm as any).conceptQuestions ?? undefined;
            if (has("pm_strategy")) out.prefetchedPMStrategyQuestion = (pm as any).strategyQuestion ?? undefined;
        } catch (e: any) { console.warn("[screening-runtime] PM prefetch failed:", e?.message || e); }
    }

    if (has("problem_solving")) {
        try {
            const { prefetchProblemSolvingCaseQuestion } = await import("../agent/problem-solving-prefetch.js");
            out.prefetchedProblemSolvingCaseQuestion = (await prefetchProblemSolvingCaseQuestion(sessionId, userId, "ScreeningPS")) ?? undefined;
        } catch (e: any) { console.warn("[screening-runtime] problem-solving prefetch failed:", e?.message || e); }
    }

    if (has("cs_theory")) {
        // No practice single-stage cs_theory prefetch (FUNDAMENTALS bundles theory+SQL); sample
        // the CS fundamentals pool directly. Grounding = concise answer per question.
        out.csTheoryQuestions = await sampleConceptQuestions("cs_theory", 6);
    }

    return out;
}

function truncate(text: unknown, max: number): string {
    const s = String(text ?? "").replace(/\s+/g, " ").trim();
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function conceptBankLines(list: any[] | undefined): string | null {
    if (!list?.length) return null;
    return list.map((q, i) => {
        const question = q.question || q.questionText || "";
        const ref = q.referenceAnswer || q.evaluationGuide || q.answer || "";
        const refLine = ref ? `\n   Reference (evaluation only — NEVER reveal): ${truncate(ref, 240)}` : "";
        return `${i + 1}. [id=${q.questionId ?? q.id ?? i + 1}] ${truncate(question, 300)}${refLine}`;
    }).join("\n");
}

/**
 * The per-turn GROUNDING supplement for the phase the server is on: the reference
 * solution / evaluation guide for an artifact phase, or the concept bank list for a
 * concept phase. Injected into the runtime directive so the interviewer scores against the
 * bank's own reference and cannot hallucinate. Returns "" when the phase needs no supplement.
 */
export function buildScreeningPhaseSupplement(
    phaseType: ScreeningPhaseType | null | undefined,
    prefetch: ScreeningPhasePrefetch | null | undefined
): string {
    if (!phaseType || !prefetch) return "";
    const block = (title: string, body: string) => `\n\n### Grounding for this phase — ${title} (evaluation only, NEVER reveal to the candidate)\n${body}`;

    switch (phaseType) {
        case "ds_sql": {
            const q = prefetch.prefetchedDSSQLQuestion;
            if (!q) return "";
            return block("Analytics SQL", [
                q.title ? `Problem: ${truncate(q.title, 160)}` : "",
                q.solution ? `Reference query: ${truncate(q.solution, 400)}` : "",
            ].filter(Boolean).join("\n"));
        }
        case "ds_coding": {
            const q = prefetch.prefetchedDSCodingQuestion;
            if (!q) return "";
            return block("Data analysis (Python)", [
                q.title ? `Problem: ${truncate(q.title, 160)}` : "",
                (q.conciseSolution || q.solution) ? `Reference approach: ${truncate(q.conciseSolution || q.solution, 400)}` : "",
                q.probingQuestions?.length ? `Probes: ${q.probingQuestions.slice(0, 3).map((p: string) => truncate(p, 120)).join(" | ")}` : "",
            ].filter(Boolean).join("\n"));
        }
        case "genai_coding": {
            const q = prefetch.prefetchedGenAICodingQuestion;
            if (!q) return "";
            return block("GenAI coding (NO AI assistance)", [
                q.title ? `Task: ${truncate(q.title, 160)}` : "",
                q.conciseSolution ? `Reference approach: ${truncate(q.conciseSolution, 400)}` : "",
                q.evaluationCriteria ? `What good looks like: ${truncate(q.evaluationCriteria, 300)}` : "",
                q.mutationQuestions?.length ? `Mutation/twist to pose: ${q.mutationQuestions.slice(0, 2).map((m: string) => truncate(m, 140)).join(" | ")}` : "",
            ].filter(Boolean).join("\n"));
        }
        case "pm_case": {
            const q = prefetch.prefetchedPMCaseQuestion;
            if (!q) return "";
            return block("Product case", [
                q.constraintInjection ? `Constraint to introduce mid-case: ${truncate(q.constraintInjection, 240)}` : "",
                q.evaluationGuide ? `Evaluation guide: ${truncate(q.evaluationGuide, 320)}` : "",
                q.successSignals?.length ? `Strong signals: ${q.successSignals.slice(0, 4).map((s: string) => truncate(s, 120)).join(" | ")}` : "",
                q.redFlags?.length ? `Red flags: ${q.redFlags.slice(0, 4).map((s: string) => truncate(s, 120)).join(" | ")}` : "",
            ].filter(Boolean).join("\n"));
        }
        case "problem_solving": {
            const q = prefetch.prefetchedProblemSolvingCaseQuestion;
            if (!q) return "";
            return block("Problem-solving case", [
                q.referenceSolution ? `Reference reasoning: ${truncate(q.referenceSolution, 360)}` : "",
                q.evaluationGuide ? `Evaluation guide: ${truncate(q.evaluationGuide, 300)}` : "",
                q.twist?.prompt ? `Twist to introduce: ${truncate(q.twist.prompt, 200)} (expected adaptation: ${truncate(q.twist.expectedAdaptation, 200)})` : "",
            ].filter(Boolean).join("\n"));
        }
        case "pm_strategy": {
            const q = prefetch.prefetchedPMStrategyQuestion;
            if (!q) return "";
            return block("Product strategy", [
                q.scenario ? `Scenario: ${truncate(q.scenario, 300)}` : "",
                q.devilsAdvocateProbes?.length ? `Devil's-advocate probes: ${q.devilsAdvocateProbes.slice(0, 4).map((p: string) => truncate(p, 140)).join(" | ")}` : "",
                q.evaluationGuide ? `Evaluation guide: ${truncate(q.evaluationGuide, 300)}` : "",
            ].filter(Boolean).join("\n"));
        }
        case "ds_concepts": {
            const lines = conceptBankLines(prefetch.prefetchedDSConceptQuestions);
            return lines ? block("Statistics & ML concept bank — ask from THESE only (server bounds how many)", lines) : "";
        }
        case "genai_concepts": {
            const lines = conceptBankLines(prefetch.prefetchedGenAIConceptQuestions);
            return lines ? block("GenAI concept bank — ask from THESE only (server bounds how many)", lines) : "";
        }
        case "pm_concepts": {
            const lines = conceptBankLines(prefetch.prefetchedPMConceptQuestions);
            return lines ? block("Product concept bank — ask from THESE only (server bounds how many)", lines) : "";
        }
        case "cs_theory": {
            const lines = conceptBankLines(prefetch.csTheoryQuestions);
            return lines ? block("CS fundamentals bank — ask from THESE only (server bounds how many)", lines) : "";
        }
        default:
            return "";
    }
}
