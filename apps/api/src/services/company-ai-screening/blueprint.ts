export type ScreeningPhaseType =
    | "resume_project"
    | "coding"
    | "cs_sql"
    | "cs_theory"
    | "system_design"
    | "frontend_coding"
    | "ds_sql"
    | "ds_coding"
    | "ds_concepts"
    | "ds_business_case"
    | "genai_coding"
    | "genai_concepts"
    | "genai_system_design"
    | "pm_case"
    | "pm_concepts"
    | "pm_strategy"
    | "problem_solving"
    | "behavioral"
    | "custom";

export type ScreeningRubricDimension = {
    id: string;
    label: string;
    weight: number;
    competencyTags: string[];
};

export type ScreeningExpectedPoint = {
    id: string;
    text: string;
    rubricDimensionId?: string | null;
};

/**
 * Reference to an existing question-bank question (coding/SQL). The screening
 * runtime prefetches this exact question by id and opens the in-room IDE with
 * it, reusing the practice-interview IDE/Judge0 mechanism. `prompt` for these
 * questions is only the spoken framing; the real problem comes from the IDE.
 */
/**
 * Bank "kind" for an ARTIFACT phase — a phase that pins ONE concrete question at
 * setup and opens an editor/whiteboard/case for it. Each kind maps 1:1 to a Mongo
 * collection (see question-prefetch.ts). Concept/theory phases are NOT artifact
 * phases: they are pool-backed (the flow draws N questions at runtime, count decided
 * by the LLM/recruiter — never pinned here), so they never carry a ScreeningBankKind.
 */
export type ScreeningBankKind =
    | "dsa"                    // DSAQuestion — coding IDE (Judge0)
    | "sql"                    // SQLQuestion — SQL editor (Judge0)
    | "system_design"          // SystemDesignQuestion — whiteboard/scratchpad
    | "ds_sql"                 // DSSQLQuestion — analytics SQL editor + schema
    | "ds_coding"              // DSCodingQuestion — Python/pandas IDE
    | "genai_coding"           // GenAICodingQuestion — GenAI coding IDE (no AI assist)
    | "genai_system_design"    // GenAISystemDesignQuestion — AI system-design whiteboard
    | "pm_case"                // PMCaseQuestion — product case (notepad)
    | "problem_solving";       // ProblemSolvingCaseQuestion — problem-solving case (notepad)

export type ScreeningBankQuestionRef = {
    /** Mongo question id in the collection implied by `type`. */
    id: string;
    /**
     * Which bank the reference points at (1:1 with a Mongo collection). dsa/sql
     * drive which Judge0 path runs; system_design and genai_system_design seed the
     * scratchpad; pm_case and problem_solving seed the notepad case; the ds and genai
     * editor kinds open the matching editor. Only ARTIFACT phases carry a ref (concept
     * phases are pool-backed and pinned at runtime, not here).
     */
    type: ScreeningBankKind;
    /**
     * Which collection the question lives in. dsa/sql/system_design have platform
     * and company variants; the role banks (ds_sql, ds_coding, genai_coding,
     * genai_system_design, pm_case, problem_solving) are platform-only, so their refs
     * are always "platform".
     */
    source: "platform" | "company";
    /** Denormalized title for recruiter display and the report (optional). */
    title?: string | null;
};

export type ScreeningQuestion = {
    id: string;
    category: string;
    prompt: string;
    expectedPoints: ScreeningExpectedPoint[];
    /** Set for coding/cs_sql/system_design questions that reference a bank question. */
    bankQuestion?: ScreeningBankQuestionRef | null;
    followUpPolicy: {
        /** Soft ceiling on follow-ups. Live pacing also factors remaining time. */
        maxFollowUps: number;
        askEdgeCases?: boolean;
        askOptimization?: boolean;
        askOwnershipVerification?: boolean;
        /** Resume-phase focus: probe measurable impact (metric/user value/verification). */
        askImpact?: boolean;
        /** Resume-phase focus: probe concrete technical decisions and tradeoffs. */
        askTechnicalDepth?: boolean;
    };
};

export type ScreeningPhase = {
    id: string;
    type: ScreeningPhaseType;
    title: string;
    durationMinutes: number;
    questions: ScreeningQuestion[];
};

export type ScreeningBlueprint = {
    version: 1;
    template: "sde_screening";
    title: string;
    durationMinutes: number;
    rubricDimensions: ScreeningRubricDimension[];
    phases: ScreeningPhase[];
};

const phaseTitles: Record<ScreeningPhaseType, string> = {
    resume_project: "Resume and project verification",
    coding: "Coding",
    cs_sql: "SQL",
    cs_theory: "CS fundamentals",
    system_design: "System design",
    frontend_coding: "Frontend coding",
    ds_sql: "Analytics SQL",
    ds_coding: "Data analysis (Python)",
    ds_concepts: "Statistics & ML concepts",
    ds_business_case: "Business & metrics case",
    genai_coding: "GenAI coding",
    genai_concepts: "GenAI fundamentals",
    genai_system_design: "AI system design",
    pm_case: "Product case",
    pm_concepts: "Product concepts",
    pm_strategy: "Product strategy",
    problem_solving: "Problem-solving case",
    behavioral: "Behavioral",
    custom: "Custom screening",
};

/**
 * Categories supported by the screening template. Coding/cs_sql/system_design are
 * bank-backed (require a bank question — IDE for coding/sql, whiteboard prompt for
 * system_design); resume_project is auto-grounded; behavioral is prompt-based
 * (no bank question, notepad-backed).
 */
export const SUPPORTED_SCREENING_CATEGORIES: ScreeningPhaseType[] = [
    "resume_project",
    "coding",
    "cs_sql",
    "cs_theory",
    "system_design",
    "frontend_coding",
    "ds_sql",
    "ds_coding",
    "ds_concepts",
    "ds_business_case",
    "genai_coding",
    "genai_concepts",
    "genai_system_design",
    "pm_case",
    "pm_concepts",
    "pm_strategy",
    "problem_solving",
    "behavioral",
];

/** Rubric weights must sum to this (percent). */
export const RUBRIC_WEIGHT_TARGET = 100;

/**
 * Guardrail: no single rubric dimension may dominate the score. The model
 * sometimes over-weights one dimension (e.g. 50% system design for a broad
 * backend role); capping keeps the screen balanced. The cap is lifted to the
 * even split (100/n) when there are too few dimensions for it to be feasible
 * (e.g. 2 dimensions can never both be <=40).
 */
export const MAX_RUBRIC_DIMENSION_WEIGHT = 40;

/**
 * Guardrail: minimum sensible minutes per phase type when the screen has room.
 * Deep phases (coding, system design) need thinking time; project validation is a
 * first-class signal for EVERY role, so resume_project gets a substantial floor
 * (not a token few minutes). When the total budget can't cover every floor, floors
 * are scaled down proportionally so allocation still fits.
 */
const PHASE_MIN_MINUTES: Record<ScreeningPhaseType, number> = {
    resume_project: 10,
    coding: 25,
    cs_sql: 15,
    cs_theory: 8,
    system_design: 25,
    frontend_coding: 25,
    ds_sql: 15,
    ds_coding: 18,
    ds_concepts: 8,
    ds_business_case: 10,
    genai_coding: 20,
    genai_concepts: 8,
    genai_system_design: 20,
    pm_case: 15,
    pm_concepts: 8,
    pm_strategy: 10,
    problem_solving: 12,
    behavioral: 8,
    custom: 5,
};

/** Deep/expensive phases whose floors yield first when the budget is tight (see enforcePhaseDurationFloors). */
const DEEP_PHASE_TYPES: ReadonlySet<ScreeningPhaseType> = new Set<ScreeningPhaseType>([
    "coding", "cs_sql", "system_design", "frontend_coding", "ds_sql", "ds_coding", "genai_coding", "genai_system_design",
]);

/** Default step (minutes) that autonomous phase durations snap to for clean, round budgets. */
export const PHASE_DURATION_STEP = 5;

/**
 * Snap each phase duration to the nearest `step` minutes for clean defaults
 * (15/20/25 rather than 14/19/24), preserving the overall total. Whole-step drift
 * is corrected on the larger phases (kept as multiples of `step`); any sub-step
 * remainder (when the total isn't a multiple of `step`) lands on the largest phase.
 * Applied to the agent's autonomous default only — explicit recruiter durations are
 * never snapped.
 */
export function snapPhaseDurationsToStep(blueprint: ScreeningBlueprint, step = PHASE_DURATION_STEP): ScreeningBlueprint {
    const phases = blueprint.phases;
    if (!phases.length) return blueprint;
    // Snap the TOTAL to a multiple of `step` as well. Otherwise a total that isn't a clean
    // multiple (e.g. the model returns 72) forces the leftover minutes onto one phase
    // (→ a stray "22 min"). Rounding the total lets every phase be a clean multiple of 5.
    const total = Math.max(step, Math.round(blueprint.durationMinutes / step) * step);

    const snapped = phases.map((p) => Math.max(step, Math.round(p.durationMinutes / step) * step));

    // Whole-step corrections keep everything a clean multiple of `step`.
    let drift = total - snapped.reduce((a, b) => a + b, 0);
    for (let guard = 0; Math.abs(drift) >= step && guard < phases.length * 500; guard++) {
        if (drift > 0) {
            // Give extra time to the phase with the largest original share.
            let best = 0;
            for (let i = 1; i < phases.length; i++) if (phases[i].durationMinutes > phases[best].durationMinutes) best = i;
            snapped[best] += step; drift -= step;
        } else {
            // Take from the largest phase that can spare a step.
            let best = -1;
            for (let i = 0; i < phases.length; i++) if (snapped[i] > step && (best < 0 || snapped[i] > snapped[best])) best = i;
            if (best < 0) break;
            snapped[best] -= step; drift += step;
        }
    }
    // Safety net: any residual drift lands on the largest phase. With the total rounded to
    // a multiple of `step` above, this is normally already 0, so every phase stays clean.
    if (drift !== 0) {
        let best = 0;
        for (let i = 1; i < phases.length; i++) if (snapped[i] > snapped[best]) best = i;
        snapped[best] = Math.max(1, snapped[best] + drift);
    }
    return { ...blueprint, durationMinutes: total, phases: phases.map((p, i) => ({ ...p, durationMinutes: snapped[i] })) };
}

/** Round float allocations to ints summing exactly to `total`, keeping each >= `min`. */
function roundAllocationToTotal(floats: number[], total: number, min = 0): number[] {
    if (!floats.length) return [];
    const rounded = floats.map((f) => Math.max(min, Math.round(f)));
    let drift = total - rounded.reduce((a, b) => a + b, 0);
    // Nudge one unit at a time, cycling, never dropping an entry below `min`.
    for (let guard = 0; drift !== 0 && guard < rounded.length * 500; guard++) {
        const i = guard % rounded.length;
        const next = rounded[i] + (drift > 0 ? 1 : -1);
        if (next < min) continue;
        rounded[i] = next;
        drift += drift > 0 ? -1 : 1;
    }
    return rounded;
}

/**
 * Water-fill cap: clamp any weight above `cap` and redistribute the excess to the
 * dimensions still under the cap (proportional to their current weight), until no
 * weight exceeds the cap or every dimension has reached it.
 */
function capWeightsFloat(weights: number[], cap: number): number[] {
    const w = weights.slice();
    for (let iter = 0; iter < 30; iter++) {
        let excess = 0;
        for (let i = 0; i < w.length; i++) {
            if (w[i] > cap + 1e-9) { excess += w[i] - cap; w[i] = cap; }
        }
        if (excess <= 1e-9) break;
        const under: number[] = [];
        let underSum = 0;
        for (let i = 0; i < w.length; i++) {
            if (w[i] < cap - 1e-9) { under.push(i); underSum += w[i]; }
        }
        if (!under.length) break; // everything is at the cap; nowhere to put the excess
        for (const i of under) {
            w[i] += excess * (underSum > 0 ? w[i] / underSum : 1 / under.length);
        }
    }
    return w;
}

function toRecord(value: unknown): Record<string, any> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function text(value: unknown, fallback = "") {
    const out = String(value ?? "").trim();
    return out || fallback;
}

function number(value: unknown, fallback: number, min = 0, max = 240) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, Math.round(parsed)));
}

function stringList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 12);
}

export function phaseTypeForCategory(category: string): ScreeningPhaseType {
    const normalized = category.trim().toLowerCase();
    if (normalized === "resume" || normalized === "resume_project") return "resume_project";
    if (normalized === "coding") return "coding";
    if (normalized === "cs_fundamentals" || normalized === "sql" || normalized === "cs_sql") return "cs_sql";
    if (normalized === "cs_theory") return "cs_theory";
    if (normalized === "system_design") return "system_design";
    if (normalized === "frontend_coding" || normalized === "frontend") return "frontend_coding";
    if (normalized === "ds_sql") return "ds_sql";
    if (normalized === "ds_coding") return "ds_coding";
    if (normalized === "ds_concepts") return "ds_concepts";
    if (normalized === "ds_business_case") return "ds_business_case";
    if (normalized === "genai_coding") return "genai_coding";
    if (normalized === "genai_concepts") return "genai_concepts";
    if (normalized === "genai_system_design") return "genai_system_design";
    if (normalized === "pm_case") return "pm_case";
    if (normalized === "pm_concepts") return "pm_concepts";
    if (normalized === "pm_strategy") return "pm_strategy";
    if (normalized === "problem_solving") return "problem_solving";
    if (normalized === "behavioral" || normalized === "behavioural") return "behavioral";
    return "custom";
}

/**
 * The ARTIFACT bank kind a phase pins at setup, or null. Only artifact phases
 * (which open an editor/whiteboard/case for one concrete question) return a kind.
 * Concept/theory phases are pool-backed (resolved at runtime) and return null here,
 * as do resume/behavioral/frontend_coding/custom. Exported so config-agent and the
 * setup route share ONE source of truth for what is bank-backed.
 */
export function bankTypeForPhase(type: ScreeningPhaseType): ScreeningBankKind | null {
    switch (type) {
        case "coding": return "dsa";
        case "cs_sql": return "sql";
        case "system_design": return "system_design";
        case "ds_sql": return "ds_sql";
        case "ds_coding": return "ds_coding";
        case "genai_coding": return "genai_coding";
        case "genai_system_design": return "genai_system_design";
        case "pm_case": return "pm_case";
        case "problem_solving": return "problem_solving";
        default: return null;
    }
}

/**
 * Concept/theory phases: bank-SOURCED but pool-backed. They pin no question at
 * setup — the flow draws questions from the pool at runtime, with the count decided
 * by the LLM (per JD) or the recruiter, never by the bank. So they require neither a
 * bank ref nor a recruiter prompt at save time.
 */
export const POOL_BACKED_PHASE_TYPES: ReadonlySet<ScreeningPhaseType> = new Set<ScreeningPhaseType>([
    "cs_theory", "ds_concepts", "genai_concepts", "pm_concepts", "pm_strategy",
]);

/**
 * Phases whose question lives in a recruiter-authored prompt (the prompt IS what the
 * interviewer asks). Everything else is grounded elsewhere: resume is auto-grounded on
 * the candidate's resume; artifact phases pull from a pinned bank question; concept
 * phases pull from the bank pool at runtime; frontend_coding is deferred (runs as a
 * framed conversation until the component sandbox lands).
 */
const PROMPT_REQUIRED_PHASE_TYPES: ReadonlySet<ScreeningPhaseType> = new Set<ScreeningPhaseType>([
    "behavioral", "custom",
]);

/** Artifact bank kinds that have a company-authored variant (the rest are platform-only). */
const COMPANY_CAPABLE_BANK_KINDS: ReadonlySet<ScreeningBankKind> = new Set<ScreeningBankKind>([
    "dsa", "sql", "system_design",
]);

/** Recruiter-facing label for a bank kind (used in validation messages). */
export function bankKindLabel(kind: ScreeningBankKind): string {
    switch (kind) {
        case "dsa": return "Coding";
        case "sql": return "SQL";
        case "system_design": return "System design";
        case "ds_sql": return "Analytics SQL";
        case "ds_coding": return "Data analysis (Python)";
        case "genai_coding": return "GenAI coding";
        case "genai_system_design": return "AI system design";
        case "pm_case": return "Product case";
        case "problem_solving": return "Problem-solving case";
    }
}

/**
 * Re-distribute rubric weights so they sum to RUBRIC_WEIGHT_TARGET. If all
 * weights are zero (or there are no usable weights), distribute evenly. This
 * guarantees the runtime never sees an all-zero rubric that collapses the
 * overall score to 0 regardless of candidate performance.
 */
export function normalizeRubricWeights(dimensions: ScreeningRubricDimension[]): ScreeningRubricDimension[] {
    if (!dimensions.length) return dimensions;
    const total = dimensions.reduce((sum, d) => sum + Math.max(0, Number(d.weight) || 0), 0);
    // Rescale to the target (or split evenly when none are usable). This is a pure
    // safety net — it never reshapes a recruiter's chosen split beyond summing it
    // to 100. The dominance cap is applied separately (capRubricWeights) ONLY to
    // the agent's autonomous proposal, never to explicit recruiter choices.
    const base = total <= 0
        ? dimensions.map(() => RUBRIC_WEIGHT_TARGET / dimensions.length)
        : dimensions.map((d) => (Math.max(0, Number(d.weight) || 0) / total) * RUBRIC_WEIGHT_TARGET);
    const rounded = roundAllocationToTotal(base, RUBRIC_WEIGHT_TARGET, 0);
    return dimensions.map((d, i) => ({ ...d, weight: rounded[i] }));
}

/**
 * Guardrail (opt-in): cap any dominant dimension at MAX_RUBRIC_DIMENSION_WEIGHT and
 * redistribute the excess, then rescale to 100. Applied to the agent's autonomous
 * default only — a recruiter who explicitly asks for e.g. 50% on one dimension is
 * always honored, so this is NOT wired into normalizeRubricWeights / save.
 */
export function capRubricWeights(dimensions: ScreeningRubricDimension[]): ScreeningRubricDimension[] {
    if (!dimensions.length) return dimensions;
    const n = dimensions.length;
    const total = dimensions.reduce((sum, d) => sum + Math.max(0, Number(d.weight) || 0), 0) || 1;
    const scaled = dimensions.map((d) => (Math.max(0, Number(d.weight) || 0) / total) * RUBRIC_WEIGHT_TARGET);
    // The cap is infeasible below the even split (n dims can't all be under 100/n).
    const cap = Math.max(MAX_RUBRIC_DIMENSION_WEIGHT, Math.ceil(RUBRIC_WEIGHT_TARGET / n));
    const rounded = roundAllocationToTotal(capWeightsFloat(scaled, cap), RUBRIC_WEIGHT_TARGET, 0);
    return dimensions.map((d, i) => ({ ...d, weight: rounded[i] }));
}

/**
 * Guardrail: raise any phase below its type's minimum duration, taking the time
 * from phases that have surplus above their floor. Applied after the model's
 * per-phase split so a too-short coding or system-design phase gets realistic
 * thinking time. Never changes the overall total, and keeps every phase >= 1 min.
 */
export function enforcePhaseDurationFloors(blueprint: ScreeningBlueprint): ScreeningBlueprint {
    const phases = blueprint.phases;
    if (phases.length <= 1) return blueprint;
    const total = blueprint.durationMinutes;

    // Floors. When the budget can't cover them all, the overflow is taken from the
    // deep/expensive phases (coding/SQL/system design) FIRST, protecting the lighter
    // ones (resume/project validation, behavioral) so project validation keeps real
    // time. Only if the protected floors alone still overflow do we scale uniformly.
    let floors = phases.map((p) => PHASE_MIN_MINUTES[p.type] ?? PHASE_MIN_MINUTES.custom);
    const floorSum = floors.reduce((a, b) => a + b, 0);
    if (floorSum > total) {
        const deep = (t: ScreeningPhaseType) => DEEP_PHASE_TYPES.has(t);
        const protectedSum = phases.reduce((s, p, i) => deep(p.type) ? s : s + floors[i], 0);
        const deepIdx = phases.map((_, i) => i).filter((i) => deep(phases[i].type));
        if (deepIdx.length && protectedSum < total) {
            // Deep phases share whatever remains after the protected floors, keeping
            // their relative proportions.
            const deepBudget = total - protectedSum;
            const deepFloorSum = deepIdx.reduce((s, i) => s + floors[i], 0) || 1;
            for (const i of deepIdx) floors[i] = deepBudget * (floors[i] / deepFloorSum);
        } else {
            // Even the light phases overflow the budget — fall back to uniform scaling.
            floors = floors.map((f) => (f / floorSum) * total);
        }
    }

    // If nothing is below its floor already, leave the model's split untouched.
    if (phases.every((p, i) => p.durationMinutes >= floors[i] - 1e-9)) return blueprint;

    const flSum = floors.reduce((a, b) => a + b, 0);
    const remainder = Math.max(0, total - flSum);
    const surplus = phases.map((p, i) => Math.max(0, p.durationMinutes - floors[i]));
    const surplusSum = surplus.reduce((a, b) => a + b, 0);
    const target = floors.map((f, i) =>
        f + (surplusSum > 0 ? remainder * (surplus[i] / surplusSum) : remainder / phases.length)
    );

    const minutes = roundAllocationToTotal(target, total, 1);
    return { ...blueprint, phases: phases.map((p, i) => ({ ...p, durationMinutes: minutes[i] })) };
}

function normalizeRubric(rawRubric: unknown): ScreeningRubricDimension[] {
    const items = Array.isArray(rawRubric) ? rawRubric : [];
    const dimensions = items.map((item, index) => {
        const source = toRecord(item);
        const label = text(source.label, `Dimension ${index + 1}`);
        const id = text(source.id, label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || `dimension_${index + 1}`);
        return {
            id,
            label,
            weight: number(source.weight, 0, 0, 100),
            competencyTags: stringList(source.competencyTags).length ? stringList(source.competencyTags) : [id],
        };
    }).filter((item) => item.label && item.id).slice(0, 20);
    return normalizeRubricWeights(dimensions);
}

function firstRubricId(rubric: ScreeningRubricDimension[]) {
    return rubric[0]?.id || "general";
}

/** Extract the bank-question reference from either a nested object or flat fields. */
function pickBankQuestionRaw(source: Record<string, any>): Record<string, any> | null {
    if (source.bankQuestion && typeof source.bankQuestion === "object") return source.bankQuestion;
    if (source.bankQuestionId) {
        return { id: source.bankQuestionId, source: source.bankQuestionSource, title: source.bankQuestionTitle };
    }
    return null;
}

function normalizeBankQuestion(raw: unknown, phaseType: ScreeningPhaseType): ScreeningBankQuestionRef | null {
    const expectedType = bankTypeForPhase(phaseType);
    if (!expectedType || !raw || typeof raw !== "object") return null;
    const source = toRecord(raw);
    const id = text(source.id ?? source.questionId ?? source.bankQuestionId);
    if (!id) return null;
    const source$ = text(source.source).toLowerCase();
    // Role banks (ds_*/genai_*/pm_case/problem_solving) are platform-only; only the
    // dsa/sql/system_design kinds have a company-authored variant.
    const resolvedSource: "platform" | "company" = COMPANY_CAPABLE_BANK_KINDS.has(expectedType)
        ? (source$ === "platform" ? "platform" : "company")
        : "platform";
    return {
        id,
        type: expectedType,
        source: resolvedSource,
        title: source.title ? text(source.title) : null,
    };
}

function normalizeQuestion(rawQuestion: unknown, index: number, rubric: ScreeningRubricDimension[]): ScreeningQuestion {
    const source = toRecord(rawQuestion);
    const category = text(source.category, "custom");
    const phaseType = phaseTypeForCategory(category);
    const defaultRubricId = firstRubricId(rubric);
    const rubricIds = new Set(rubric.map((dimension) => dimension.id));
    const expected = Array.isArray(source.expectedPoints) ? source.expectedPoints : [];
    const expectedPoints = expected
        .map((point, pointIndex) => {
            const rawPoint = toRecord(point);
            const value = text(rawPoint.text);
            if (!value) return null;
            const tag = stringList(rawPoint.competencyTags)[0];
            const candidateDimension = text(rawPoint.rubricDimensionId || tag);
            return {
                id: text(rawPoint.id, `point_${pointIndex + 1}`),
                text: value,
                // Only keep a routing id that actually resolves to a rubric dimension.
                rubricDimensionId: rubricIds.has(candidateDimension) ? candidateDimension : defaultRubricId,
            };
        })
        .filter(Boolean) as ScreeningExpectedPoint[];
    const followUpPolicy = toRecord(source.followUpPolicy);
    const bankQuestion = normalizeBankQuestion(pickBankQuestionRaw(source), phaseType);

    return {
        id: text(source.id, `q${index + 1}`),
        category,
        prompt: text(source.prompt, "Ask the candidate a structured screening question."),
        expectedPoints: expectedPoints.length
            ? expectedPoints.slice(0, 20)
            : [{ id: "point_1", text: "Look for concrete, relevant evidence in the candidate response.", rubricDimensionId: defaultRubricId }],
        bankQuestion,
        followUpPolicy: {
            maxFollowUps: number(followUpPolicy.maxFollowUps, 2, 0, 2),
            askEdgeCases: Boolean(followUpPolicy.askEdgeCases),
            askOptimization: Boolean(followUpPolicy.askOptimization),
            askOwnershipVerification: followUpPolicy.askOwnershipVerification !== false,
            askImpact: followUpPolicy.askImpact !== false,
            askTechnicalDepth: followUpPolicy.askTechnicalDepth !== false,
        },
    };
}

function distributePhaseDurations(phases: ScreeningPhase[], totalDurationMinutes: number): ScreeningPhase[] {
    const totalQuestions = phases.reduce((sum, phase) => sum + phase.questions.length, 0);
    if (!phases.length) return phases;
    if (totalQuestions <= 0) {
        const even = Math.round(totalDurationMinutes / phases.length);
        return phases.map((phase) => ({ ...phase, durationMinutes: even }));
    }
    let allocated = 0;
    const withDuration = phases.map((phase) => {
        const minutes = Math.round((phase.questions.length / totalQuestions) * totalDurationMinutes);
        allocated += minutes;
        return { ...phase, durationMinutes: minutes };
    });
    const drift = totalDurationMinutes - allocated;
    if (drift !== 0 && withDuration.length) {
        withDuration[0] = { ...withDuration[0], durationMinutes: Math.max(1, withDuration[0].durationMinutes + drift) };
    }
    return withDuration;
}

function normalizePhasesFromQuestions(questions: ScreeningQuestion[]): ScreeningPhase[] {
    // Preserve the order phases first appear in the question list, so the archetype's
    // (and the recruiter's) intended phase sequence is honored rather than forced
    // into a fixed global order. Questions of the same type are grouped together.
    const order: ScreeningPhaseType[] = [];
    const byType = new Map<ScreeningPhaseType, ScreeningQuestion[]>();
    for (const question of questions) {
        const type = phaseTypeForCategory(question.category);
        if (!byType.has(type)) order.push(type);
        byType.set(type, [...(byType.get(type) || []), question]);
    }

    return order.map((type) => ({
        id: type,
        type,
        title: phaseTitles[type],
        durationMinutes: 0,
        questions: byType.get(type) || [],
    }));
}

/**
 * Phase types that have NO runnable modality yet, so they must never reach a live screen:
 * - frontend_coding: needs the Sandpack modality (not built). Without it the interviewer is
 *   handed a "frontend round" with no workspace and invents a problem — exactly what we forbid.
 * - genai_system_design: no GEN_AI_SYSTEM_DESIGN stage exists; intentionally never composed.
 * Dropping them here (the single runtime source of truth) guarantees the pacing plan/pointer
 * never presents one, regardless of what a recruiter config or the config-agent produced.
 */
const UNBUILT_SCREENING_PHASE_TYPES: ReadonlySet<ScreeningPhaseType> = new Set<ScreeningPhaseType>([
    "frontend_coding",
    "genai_system_design",
]);

function stripUnbuiltScreeningPhases(phases: ScreeningPhase[]): ScreeningPhase[] {
    return phases.filter((phase) => !UNBUILT_SCREENING_PHASE_TYPES.has(phase.type));
}

export function buildScreeningBlueprint(config: Record<string, any>): ScreeningBlueprint {
    const existing = toRecord(config.blueprint);
    if (existing.version === 1 && existing.template === "sde_screening" && Array.isArray(existing.phases)) {
        // Already-compiled blueprint. Re-normalize rubric weights so older saves
        // with bad/zero weights can't collapse the overall score at runtime, and strip any
        // unbuilt phase type an older save may still carry.
        return {
            ...(existing as ScreeningBlueprint),
            rubricDimensions: normalizeRubricWeights((existing.rubricDimensions as ScreeningRubricDimension[]) || []),
            phases: stripUnbuiltScreeningPhases((existing.phases as ScreeningPhase[]) || []),
        };
    }

    const rubricDimensions = normalizeRubric(config.rubric);
    const questions = (Array.isArray(config.questions) ? config.questions : [])
        .map((question, index) => normalizeQuestion(question, index, rubricDimensions));
    const phases = stripUnbuiltScreeningPhases(normalizePhasesFromQuestions(questions));
    const durationMinutes = number(config.durationMinutes, 30, 10, 240);

    // NOTE: duration floors are NOT applied here — buildScreeningBlueprint is also
    // the save/precompiled path, where the recruiter's explicit durations must be
    // preserved verbatim. Floors are applied only to the agent's autonomous draft
    // (config-agent), so an explicit recruiter request is always honored.
    return {
        version: 1,
        template: "sde_screening",
        title: text(config.title, "AI screening interview"),
        durationMinutes,
        rubricDimensions,
        phases: distributePhaseDurations(phases, durationMinutes),
    };
}

export function countBlueprintQuestions(blueprint: ScreeningBlueprint) {
    return blueprint.phases.reduce((sum, phase) => sum + phase.questions.length, 0);
}

/**
 * The phase TYPE that owns a given question id, or null. Used to derive the
 * server-authoritative phase-scoped tool whitelist each turn (coding -> IDE,
 * system_design -> scratchpad, etc.) from the current pointer.
 */
export function phaseTypeForQuestionId(
    blueprint: ScreeningBlueprint | null | undefined,
    questionId: string | null | undefined
): ScreeningPhaseType | null {
    if (!blueprint || !questionId) return null;
    for (const phase of blueprint.phases || []) {
        if (phase.questions.some((question) => question.id === questionId)) return phase.type;
    }
    return null;
}

export type RubricValidationResult = {
    valid: boolean;
    total: number;
    error?: string;
};

/**
 * Strict, recruiter-facing validation used on save (the setup route). Unlike
 * normalizeRubric (which silently rescales for runtime safety), this rejects
 * input so the recruiter fixes weights in the wizard rather than shipping a
 * silently-rescaled rubric.
 */
export function validateRubricWeights(rawRubric: unknown): RubricValidationResult {
    const items = Array.isArray(rawRubric) ? rawRubric : [];
    if (!items.length) {
        return { valid: false, total: 0, error: "Add at least one rubric dimension." };
    }
    const weights = items.map((item) => Math.max(0, Number(toRecord(item).weight) || 0));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    const nonZero = weights.filter((weight) => weight > 0).length;
    if (nonZero === 0) {
        return { valid: false, total, error: "At least one rubric dimension must have a non-zero weight." };
    }
    if (total !== RUBRIC_WEIGHT_TARGET) {
        return { valid: false, total, error: `Rubric weights must sum to ${RUBRIC_WEIGHT_TARGET}%. Current total: ${total}%.` };
    }
    return { valid: true, total };
}

/** Validate a recruiter config before it is saved/published. */
export function validateScreeningConfig(config: Record<string, any>): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const rubric = validateRubricWeights(config.rubric);
    if (!rubric.valid && rubric.error) errors.push(rubric.error);

    const questions = Array.isArray(config.questions) ? config.questions : [];
    if (!questions.length) {
        errors.push("Add at least one screening question.");
    }
    questions.forEach((rawQuestion, index) => {
        const question = toRecord(rawQuestion);
        const category = text(question.category, "custom");
        const phaseType = phaseTypeForCategory(category);
        if (!SUPPORTED_SCREENING_CATEGORIES.includes(phaseType)) {
            errors.push(`Question ${index + 1}: category "${category}" is not supported yet (use resume, coding, cs_sql, system_design, or behavioral).`);
        }
        const bankType = bankTypeForPhase(phaseType);
        if (bankType) {
            const ref = normalizeBankQuestion(pickBankQuestionRaw(question), phaseType);
            if (!ref) {
                errors.push(`Question ${index + 1}: ${bankKindLabel(bankType)} questions must reference a question from the question bank.`);
            }
        } else if (PROMPT_REQUIRED_PHASE_TYPES.has(phaseType) && !text(question.prompt)) {
            // Only behavioral/custom carry the question in a recruiter prompt. Resume is
            // auto-grounded on the candidate's resume; concept/theory phases draw from the
            // bank pool at runtime; artifact phases get their text from the bank question —
            // none of those need a recruiter-authored prompt.
            errors.push(`Question ${index + 1}: add a prompt.`);
        }
    });

    return { valid: errors.length === 0, errors };
}
