import { DSAQuestion } from "../../models/DSAQuestion.js";
import { SQLQuestion } from "../../models/SQLQuestion.js";
import { SystemDesignQuestion } from "../../models/system-design-question.js";
import { CompanyDSAQuestion, CompanySQLQuestion, CompanySystemDesignQuestion } from "../../models/CompanyQuestionBank.js";
import { DSSQLQuestion } from "../../models/DSSQLQuestion.js";
import { DSCodingQuestion } from "../../models/DSCodingQuestion.js";
import { GenAICodingQuestion } from "../../models/GenAICodingQuestion.js";
import { GenAISystemDesignQuestion } from "../../models/GenAISystemDesignQuestion.js";
import { PMCaseQuestion } from "../../models/PMCaseQuestion.js";
import { ProblemSolvingCaseQuestion } from "../../models/ProblemSolvingCaseQuestion.js";
import { CSFundamentalQuestion } from "../../models/CSFundamentalQuestion.js";
import { DSConceptQuestion } from "../../models/DSConceptQuestion.js";
import { GenAIConceptQuestion } from "../../models/GenAIConceptQuestion.js";
import { PMConceptQuestion } from "../../models/PMConceptQuestion.js";
import { PMStrategyQuestion } from "../../models/PMStrategyQuestion.js";
import { normalizeDSAQuestion, normalizeSQLQuestion } from "../../lib/question-helpers.js";
import type { ScreeningBankKind, ScreeningBankQuestionRef, ScreeningBlueprint } from "./blueprint.js";

/** Platform model per ARTIFACT bank kind (the collection auto-pick + prefetch read from). */
const ARTIFACT_MODEL_BY_KIND: Record<ScreeningBankKind, any> = {
    dsa: DSAQuestion,
    sql: SQLQuestion,
    system_design: SystemDesignQuestion,
    ds_sql: DSSQLQuestion,
    ds_coding: DSCodingQuestion,
    genai_coding: GenAICodingQuestion,
    genai_system_design: GenAISystemDesignQuestion,
    pm_case: PMCaseQuestion,
    problem_solving: ProblemSolvingCaseQuestion,
};

export type ScreeningBankQuestionRefWithOwner = ScreeningBankQuestionRef & {
    /** Blueprint (screening) question id that owns this bank reference. */
    screeningQuestionId: string;
};

/** Collect every coding/SQL/system_design bank reference in the blueprint, with its owning screening question id. */
export function collectScreeningBankRefs(blueprint: ScreeningBlueprint): ScreeningBankQuestionRefWithOwner[] {
    const refs: ScreeningBankQuestionRefWithOwner[] = [];
    for (const phase of blueprint.phases || []) {
        for (const question of phase.questions || []) {
            if (question.bankQuestion?.id) {
                refs.push({ ...question.bankQuestion, screeningQuestionId: question.id });
            }
        }
    }
    return refs;
}

/** Resolve a screening question id to its referenced bank question id. */
export function bankQuestionIdForScreeningQuestion(
    blueprint: ScreeningBlueprint,
    screeningQuestionId: string
): { ref: ScreeningBankQuestionRef; category: string } | null {
    for (const phase of blueprint.phases || []) {
        for (const question of phase.questions || []) {
            if (question.id === screeningQuestionId && question.bankQuestion?.id) {
                return { ref: question.bankQuestion, category: question.category };
            }
        }
    }
    return null;
}

/**
 * Pick a random platform question of the given type, for auto-seeding a bank-backed
 * screening phase at setup. The recruiter can swap it later. Never throws (returns
 * null on DB error / empty collection) so setup generation degrades gracefully.
 */
export async function pickRandomBankQuestionRef(
    kind: ScreeningBankKind
): Promise<ScreeningBankQuestionRef | null> {
    try {
        const model = ARTIFACT_MODEL_BY_KIND[kind];
        if (!model) return null;
        // Role banks title their docs differently (title / question / scenario / prompt);
        // project the likely fields and pick the first present for the display label.
        const sampled = await (model as any).aggregate([
            { $sample: { size: 1 } },
            { $project: { title: 1, question: 1, scenario: 1, prompt: 1 } },
        ]);
        const doc = Array.isArray(sampled) ? sampled[0] : null;
        if (!doc?._id) return null;
        const label = doc.title || doc.question || doc.scenario || doc.prompt || null;
        return { id: String(doc._id), type: kind, source: "platform", title: label ? String(label).slice(0, 240) : null };
    } catch (error: any) {
        console.warn(`[company-screening] random ${kind} bank pick failed:`, error?.message || error);
        return null;
    }
}

async function loadBankQuestion(ref: ScreeningBankQuestionRef): Promise<any | null> {
    if (ref.type === "dsa") {
        const model = ref.source === "company" ? CompanyDSAQuestion : DSAQuestion;
        const doc = await (model as any).findById(ref.id);
        if (!doc) return null;
        const normalized = normalizeDSAQuestion(doc as any);
        // Carry the denormalized title through for report/display when present.
        return { ...normalized, title: normalized.title || ref.title || "Coding question" };
    }
    if (ref.type === "sql") {
        const model = ref.source === "company" ? CompanySQLQuestion : SQLQuestion;
        const doc = await (model as any).findById(ref.id);
        if (!doc) return null;
        const normalized = normalizeSQLQuestion(doc as any);
        return { ...normalized, title: normalized.title || ref.title || "SQL question" };
    }
    if (ref.type === "system_design") {
        // System design has no Judge0/IDE shape — the candidate diagrams on the
        // scratchpad, so we only need the prompt text + rubricLite for scoring hints.
        const model = ref.source === "company" ? CompanySystemDesignQuestion : SystemDesignQuestion;
        const doc = await (model as any).findById(ref.id);
        if (!doc) return null;
        const obj = typeof (doc as any).toObject === "function" ? (doc as any).toObject() : doc;
        return {
            id: String(obj._id || ref.id),
            title: obj.title || ref.title || "System design question",
            problemStatement: obj.problemStatement || "",
            difficulty: obj.difficulty || "Medium",
            rubricLite: obj.rubricLite ?? null,
            category: "SYSTEM_DESIGN",
        };
    }
    // ── Role banks (platform-only). Each carries GROUNDING fields (sampleSolution /
    // evaluationCriteria / referenceAnswer / rubricLite …) so the runtime interviewer
    // scores against the bank's own reference and cannot hallucinate. Post-session
    // fields (detailedSolution / rubricFull) are intentionally NOT loaded here — they
    // never go to the live LLM. Hints/hintLadder are also excluded (screening gives no
    // hints — it is pure evaluation). ──
    if (ref.type === "ds_sql") {
        const doc = await (DSSQLQuestion as any).findById(ref.id);
        if (!doc) return null;
        const o = toObj(doc);
        return {
            id: String(o._id || ref.id),
            title: o.title || ref.title || "Analytics SQL question",
            problemStatement: o.problemStatement || "",
            schema: o.schema || [],
            difficulty: o.difficulty || "Medium",
            sampleSolution: o.sampleSolution || "",
            evaluationCriteria: o.evaluationCriteria || "",
            followUpQuestions: o.followUpQuestions || [],
            category: "DS_SQL",
        };
    }
    if (ref.type === "ds_coding") {
        const doc = await (DSCodingQuestion as any).findById(ref.id);
        if (!doc) return null;
        const o = toObj(doc);
        return {
            id: String(o._id || ref.id),
            title: o.title || ref.title || "Data analysis question",
            problemStatement: o.problemStatement || o.description || "",
            starterCode: o.starterCode || "",
            dataSchema: o.dataSchema || [],
            structuralAssertions: o.structuralAssertions || "",
            difficulty: o.difficulty || "Medium",
            sampleSolution: o.sampleSolution || o.conciseSolution || o.solution || "",
            evaluationCriteria: o.evaluationCriteria || "",
            probingQuestions: o.probingQuestions || [],
            category: "DS_CODING",
        };
    }
    if (ref.type === "genai_coding") {
        const doc = await (GenAICodingQuestion as any).findById(ref.id);
        if (!doc) return null;
        const o = toObj(doc);
        return {
            id: String(o._id || ref.id),
            title: o.title || ref.title || "GenAI coding question",
            problemStatement: o.problemStatement || "",
            starterCode: o.starterCode || "",
            sampleTestCases: o.sampleTestCases || [],
            difficulty: o.difficulty || "Medium",
            sampleSolution: o.sampleSolution || o.conciseSolution || "",
            evaluationCriteria: o.evaluationCriteria || "",
            mutationQuestions: o.mutationQuestions || [],
            category: "GENAI_CODING",
        };
    }
    if (ref.type === "genai_system_design") {
        const doc = await (GenAISystemDesignQuestion as any).findById(ref.id);
        if (!doc) return null;
        const o = toObj(doc);
        return {
            id: String(o._id || ref.id),
            title: o.title || ref.title || "AI system design question",
            problemStatement: o.problemStatement || "",
            difficulty: o.difficulty || "Medium",
            rubricLite: o.rubricLite ?? null,
            category: "GENAI_SYSTEM_DESIGN",
        };
    }
    if (ref.type === "pm_case") {
        const doc = await (PMCaseQuestion as any).findById(ref.id);
        if (!doc) return null;
        const o = toObj(doc);
        return {
            id: String(o._id || ref.id),
            title: o.title || ref.title || "Product case",
            problemStatement: o.scenario || "",
            constraintInjection: o.constraintInjection || "",
            difficulty: o.difficulty || "Medium",
            evaluationGuide: o.evaluationGuide || "",
            successSignals: o.successSignals || [],
            redFlags: o.redFlags || [],
            category: "PM_CASE",
        };
    }
    if (ref.type === "problem_solving") {
        const doc = await (ProblemSolvingCaseQuestion as any).findById(ref.id);
        if (!doc) return null;
        const o = toObj(doc);
        return {
            id: String(o._id || ref.id),
            title: o.title || ref.title || "Problem-solving case",
            problemStatement: o.prompt || "",
            candidateInstructions: o.candidateInstructions || "",
            difficulty: o.difficulty || "Medium",
            referenceSolution: o.referenceSolution || "",
            evaluationGuide: o.evaluationGuide || "",
            successSignals: o.successSignals || [],
            redFlags: o.redFlags || [],
            decompositionPrompts: o.decompositionPrompts || [],
            followUps: o.followUps || [],
            convictionProbes: o.convictionProbes || [],
            twist: o.twist ?? null,
            category: "PROBLEM_SOLVING",
        };
    }
    return null;
}

function toObj(doc: any): any {
    return doc && typeof doc.toObject === "function" ? doc.toObject() : doc;
}

/**
 * Loads every recruiter-referenced bank question for a screening blueprint and
 * returns them keyed by the bank question id. Stuffed into the live session's
 * `cachedQuestionData` at init so the existing IDE/Judge0 handlers
 * (handleOpenIDE-style emits + handleRunCode) work unchanged — exactly like the
 * practice interview, which also reads from session cache only.
 *
 * Never throws: a missing or broken question is skipped and logged so one bad
 * reference cannot strand the whole screening session.
 */
export async function prefetchCompanyScreeningBankQuestions(
    blueprint: ScreeningBlueprint
): Promise<Map<string, any>> {
    const cache = new Map<string, any>();
    const refs = collectScreeningBankRefs(blueprint);
    for (const ref of refs) {
        try {
            const normalized = await loadBankQuestion(ref);
            if (normalized) {
                cache.set(String(ref.id), normalized);
            } else {
                console.warn(`[company-screening] bank question not found: ${ref.type}:${ref.id} (source=${ref.source})`);
            }
        } catch (error: any) {
            console.error(`[company-screening] failed to prefetch bank question ${ref.type}:${ref.id}:`, error?.message || error);
        }
    }
    return cache;
}

// ─────────────────────────────────────────────────────────────────────────────
// Concept / theory POOL sampling (pool-backed phases: cs_theory, ds_concepts,
// genai_concepts, pm_concepts, pm_strategy).
//
// Unlike artifact phases, these pin NO question at setup. The screening FLOW draws
// `count` questions from the pool at runtime — count decided by the LLM (per JD) or
// the recruiter, NOT the bank. Each returned question carries its concise reference
// answer (GROUNDING) so the interviewer scores against the bank and never
// hallucinates. This loader is the data layer for that; the flow wires it in later.
// ─────────────────────────────────────────────────────────────────────────────

export type ScreeningConceptPoolKind = "cs_theory" | "ds_concepts" | "genai_concepts" | "pm_concepts" | "pm_strategy";

const CONCEPT_MODEL_BY_KIND: Record<ScreeningConceptPoolKind, any> = {
    cs_theory: CSFundamentalQuestion,
    ds_concepts: DSConceptQuestion,
    genai_concepts: GenAIConceptQuestion,
    pm_concepts: PMConceptQuestion,
    pm_strategy: PMStrategyQuestion,
};

export type ConceptPoolQuestion = {
    id: string;
    kind: ScreeningConceptPoolKind;
    topic?: string | null;
    /** The prompt/question posed to the candidate. */
    question: string;
    /** GROUNDING: concise reference answer for silent LLM evaluation. */
    referenceAnswer: string;
    redFlags?: string[];
    successSignals?: string[];
    evaluationGuide?: string;
    difficulty?: string | null;
};

function normalizeConceptDoc(kind: ScreeningConceptPoolKind, raw: any): ConceptPoolQuestion | null {
    const o = toObj(raw);
    if (!o?._id) return null;
    const base = { id: String(o._id), kind, difficulty: o.difficulty || null };
    switch (kind) {
        case "cs_theory":
            return { ...base, topic: o.topic || null, question: o.question || "", referenceAnswer: o.answer || "" };
        case "ds_concepts":
            return { ...base, topic: o.subtopic || null, question: o.question || "", referenceAnswer: o.referenceAnswer || "", redFlags: o.redFlags || [] };
        case "genai_concepts":
            return { ...base, topic: o.subtopic || null, question: o.question || "", referenceAnswer: o.answer || "" };
        case "pm_concepts":
            return {
                ...base, topic: o.topic || o.subtopic || null, question: o.question || "",
                referenceAnswer: o.answer || o.evaluationGuide || "", redFlags: o.redFlags || [],
                successSignals: o.successSignals || [], evaluationGuide: o.evaluationGuide || "",
            };
        case "pm_strategy":
            return {
                ...base, topic: o.title || null, question: o.scenario || "",
                referenceAnswer: o.evaluationGuide || "", redFlags: o.redFlags || [], successSignals: o.successSignals || [],
            };
    }
}

/**
 * Sample up to `count` concept questions from a pool, optionally filtered by
 * topic/subtopic (archetype question filters) and difficulty. Never throws. If the
 * filtered pool is empty, retries unfiltered so a sparse filter can't strand a phase.
 */
export async function sampleConceptQuestions(
    kind: ScreeningConceptPoolKind,
    count: number,
    filter?: { topics?: string[]; difficulty?: "Easy" | "Medium" | "Hard" }
): Promise<ConceptPoolQuestion[]> {
    const model = CONCEPT_MODEL_BY_KIND[kind];
    if (!model) return [];
    const size = Math.max(1, Math.min(20, Math.round(count) || 1));
    const wanted = (filter?.topics || []).filter(Boolean);
    const runSample = async (useFilter: boolean): Promise<ConceptPoolQuestion[]> => {
        const match: Record<string, any> = {};
        if (useFilter && wanted.length) match.$or = [{ subtopic: { $in: wanted } }, { topic: { $in: wanted } }];
        if (useFilter && filter?.difficulty) match.difficulty = filter.difficulty;
        const pipeline: any[] = [];
        if (Object.keys(match).length) pipeline.push({ $match: match });
        pipeline.push({ $sample: { size } });
        const docs = await (model as any).aggregate(pipeline);
        return (Array.isArray(docs) ? docs : [])
            .map((d) => normalizeConceptDoc(kind, d))
            .filter((q): q is ConceptPoolQuestion => Boolean(q && q.question));
    };
    try {
        const filtered = await runSample(true);
        if (filtered.length) return filtered;
        return (wanted.length || filter?.difficulty) ? await runSample(false) : filtered;
    } catch (error: any) {
        console.warn(`[company-screening] concept sample ${kind} failed:`, error?.message || error);
        return [];
    }
}
