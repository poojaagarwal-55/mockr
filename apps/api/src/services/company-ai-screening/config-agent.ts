import { getGeminiClient, GEMINI_MODEL } from "../../lib/gemini.js";
import { createXAIGeminiShim } from "../../lib/groq.js";

/**
 * Model client for the JD → screening-plan builder ONLY (this config agent). Production
 * has its own Gemini key, so whenever a Gemini key is configured we use Gemini. The
 * xAI/Grok shim is a fallback used ONLY when no Gemini key is present (e.g. local dev),
 * so recruiters can still generate plans on existing xAI credits. Set
 * SCREENING_CONFIG_AGENT_BACKEND=xai to force the xAI shim for local testing.
 */
function getConfigAgentClient() {
    const geminiKeyPresent = Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY);
    const forceXai = process.env.SCREENING_CONFIG_AGENT_BACKEND === "xai";
    // Only reach for xAI when Gemini is genuinely unavailable (or explicitly forced for
    // testing). With a Gemini key present, always use Gemini — never spend xAI credits.
    if ((!geminiKeyPresent || forceXai) && process.env.XAI_API_KEY) {
        try {
            return createXAIGeminiShim();
        } catch {
            // xAI unavailable — fall through to the standard Gemini client.
        }
    }
    return getGeminiClient();
}

const CONFIG_AGENT_RETRIES = 2;
const CONFIG_AGENT_RETRIABLE = /\b(408|409|425|429|500|502|503|504|overloaded|unavailable|rate.?limit|timeout|deadline|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|fetch failed|socket hang up|network|internal error)\b/i;

/**
 * Calls the config-agent model with a couple of retries on transient errors (a 5xx /
 * rate-limit / network blip from the provider). Without this a single hiccup surfaces as
 * an "Internal Server Error" in the builder; the call almost always succeeds on retry.
 */
async function generateConfigAgentContent(params: any): Promise<any> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= CONFIG_AGENT_RETRIES; attempt++) {
        try {
            return await getConfigAgentClient().models.generateContent(params);
        } catch (err: any) {
            lastErr = err;
            const status = err?.status ?? err?.code ?? err?.response?.status;
            const retriable =
                (typeof status === "number" && [408, 409, 425, 429, 500, 502, 503, 504].includes(status)) ||
                CONFIG_AGENT_RETRIABLE.test(err?.message ?? String(err ?? ""));
            if (attempt < CONFIG_AGENT_RETRIES && retriable) {
                await new Promise((r) => setTimeout(r, 500 * 2 ** attempt + Math.floor(Math.random() * 300)));
                continue;
            }
            throw err;
        }
    }
    throw lastErr;
}
import {
    buildScreeningBlueprint,
    enforcePhaseDurationFloors,
    snapPhaseDurationsToStep,
    capRubricWeights,
    validateScreeningConfig,
    normalizeRubricWeights,
    bankTypeForPhase,
    SUPPORTED_SCREENING_CATEGORIES,
    type ScreeningBlueprint,
    type ScreeningPhase,
    type ScreeningPhaseType,
} from "./blueprint.js";
import { pickRandomBankQuestionRef } from "./question-prefetch.js";
import { archetypeById, selectArchetype, renderArchetypeDefaults, ARCHETYPE_IDS, type ScreeningArchetypeId } from "./role-archetypes.js";

/**
 * Auto-seed every ARTIFACT phase (coding/SQL/system_design and the role banks:
 * ds_sql/ds_coding/genai_coding/genai_system_design/pm_case/problem_solving) with a
 * random platform question at setup, so the recruiter starts from a ready screen.
 * Concept/theory phases are pool-backed (resolved at runtime) so bankTypeForPhase
 * returns null for them and they are skipped here. Only fills phases the recruiter
 * hasn't already set.
 */
async function autoAttachBankQuestions(draft: ScreeningBlueprint): Promise<ScreeningBlueprint> {
    const phases = await Promise.all(draft.phases.map(async (phase) => {
        const bankType = bankTypeForPhase(phase.type);
        if (!bankType) return phase;
        const questions = await Promise.all(phase.questions.map(async (q) => {
            if (q.bankQuestion?.id) return q; // keep the recruiter's / existing pick
            const ref = await pickRandomBankQuestionRef(bankType);
            return ref ? { ...q, bankQuestion: ref } : q;
        }));
        return { ...phase, questions };
    }));
    return { ...draft, phases };
}

/**
 * The recruiter-facing "config agent": turns a pasted job description + a chat
 * conversation into a ScreeningBlueprint (the same shape the interview runtime
 * consumes), and refines it as the recruiter edits in natural language.
 *
 * The LLM proposes structure; the SERVER owns correctness. Every field the model
 * returns is re-normalized through blueprint.ts (rubric rescaled to 100, phases
 * grouped by type, durations clamped & rescaled, unsupported categories dropped)
 * so a sloppy or adversarial model response can never produce an invalid draft.
 * It cannot pick bank questions (those live in the DB) — coding/cs_sql phases come
 * back with bankQuestion=null and are surfaced via needsBankQuestionPhaseIds so the
 * recruiter attaches one in the UI.
 */

export type ConfigAgentMessage = { role: "user" | "assistant"; content: string };

export type ConfigAgentInput = {
    jobDescription?: string | null;
    jobTitle?: string | null;
    messages: ConfigAgentMessage[];
    /** The blueprint built last turn, so edits are incremental rather than from scratch. */
    currentDraft?: ScreeningBlueprint | null;
    /** Optional recruiter-fixed overall budget; the agent fills phase durations within it. */
    totalDurationMinutes?: number | null;
};

export type ConfigAgentResult = {
    /** Assistant chat message to render to the recruiter. */
    reply: string;
    /** The normalized, runtime-ready blueprint draft. */
    draft: ScreeningBlueprint;
    /** Questions the agent wants the recruiter to answer (experience level, must-haves, etc.). */
    clarifyingQuestions: string[];
    /** Phase ids (coding/cs_sql) that still need a bank question attached before finalize. */
    needsBankQuestionPhaseIds: string[];
    /** validateScreeningConfig result for the draft (missing bank questions are expected here). */
    validation: { valid: boolean; errors: string[] };
    /** True when the model call failed and a deterministic fallback draft was returned. */
    fallback: boolean;
    /**
     * False when the recruiter was only asking a question and the blueprint is
     * unchanged from currentDraft. The UI uses this to leave the timeline panel
     * untouched (no flash / re-render) on conversational turns.
     */
    planChanged: boolean;
};

const DEFAULT_TOTAL_MINUTES = 30;
const PHASE_TYPE_TO_CATEGORY: Record<ScreeningPhaseType, string> = {
    resume_project: "resume",
    coding: "coding",
    cs_sql: "cs_sql",
    cs_theory: "cs_theory",
    system_design: "system_design",
    frontend_coding: "frontend_coding",
    ds_sql: "ds_sql",
    ds_coding: "ds_coding",
    ds_concepts: "ds_concepts",
    ds_business_case: "ds_business_case",
    genai_coding: "genai_coding",
    genai_concepts: "genai_concepts",
    genai_system_design: "genai_system_design",
    pm_case: "pm_case",
    pm_concepts: "pm_concepts",
    pm_strategy: "pm_strategy",
    problem_solving: "problem_solving",
    behavioral: "behavioral",
    custom: "custom",
};

function clampInt(value: unknown, min: number, max: number, fallback: number) {
    const parsed = Math.round(Number(value));
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
}

function str(value: unknown, fallback = "") {
    const out = String(value ?? "").trim();
    return out || fallback;
}

/** Mirror of report.ts: pull the first JSON object out of a model response. */
function extractJsonObject(raw: string) {
    const clean = raw.replace(/^﻿/, "").trim();
    const first = clean.indexOf("{");
    const last = clean.lastIndexOf("}");
    if (first < 0 || last <= first) throw new Error("Model response did not contain JSON.");
    return clean.slice(first, last + 1);
}

function normalizePhaseType(value: unknown): ScreeningPhaseType | null {
    const normalized = str(value).toLowerCase().replace(/\s+/g, "_");
    if (normalized === "resume" || normalized === "resume_project") return "resume_project";
    if (normalized === "coding" || normalized === "dsa") return "coding";
    if (normalized === "cs_sql" || normalized === "cs_fundamentals" || normalized === "sql") return "cs_sql";
    if (normalized === "cs_theory") return "cs_theory";
    if (normalized === "system_design") return "system_design";
    if (normalized === "frontend_coding" || normalized === "frontend") return "frontend_coding";
    if (normalized === "ds_sql") return "ds_sql";
    if (normalized === "ds_coding") return "ds_coding";
    if (normalized === "ds_concepts") return "ds_concepts";
    if (normalized === "ds_business_case" || normalized === "ds_business_metrics") return "ds_business_case";
    if (normalized === "genai_coding") return "genai_coding";
    if (normalized === "genai_concepts") return "genai_concepts";
    if (normalized === "genai_system_design") return "genai_system_design";
    if (normalized === "pm_case") return "pm_case";
    if (normalized === "pm_concepts") return "pm_concepts";
    if (normalized === "pm_strategy") return "pm_strategy";
    if (normalized === "problem_solving") return "problem_solving";
    if (normalized === "behavioral" || normalized === "behavioural") return "behavioral";
    return null;
}

const SYSTEM_PROMPT = `You are the configuration assistant for a company's AI technical screening product. A recruiter pastes a job description (and chats with you) and you design the screening: which phases to run, how long each should take, what to ask, and how to score it.

Return ONLY a single JSON object (no markdown, no prose outside it) with this exact shape:
{
  "reply": "a short, friendly, recruiter-facing message explaining what you proposed or changed — describe phases by what they assess, NEVER by backend mechanics (no question bank / DB / runtime fetching / archetype / server internals)",
  "planChanged": <true ONLY if you actually modified the blueprint this turn; false when the recruiter is just asking a question / chatting and you are NOT changing phases, durations, rubric, or questions>,
  "recruiterSetExactValues": <true if the recruiter EXPLICITLY asked for specific rubric weights or specific phase durations (e.g. "make system design 50%", "coding should be 20 minutes"); false when you chose the numbers yourself>,
  "clarifyingQuestions": ["Up to 2 JD-SPECIFIC clarifying questions, generated ONLY when first designing from a fresh job description. If a current draft is provided below (i.e. this is an EDIT), return an EMPTY array []. Do NOT include generic questions like seniority/YOE, must-have skills, or duration — those are always shown to the recruiter separately, so only surface questions unique to THIS role/JD"],
  "blueprint": {
    "title": "screening title",
    "durationMinutes": <total interview minutes, 10-120>,
    "rubric": [
      { "id": "kebab_case_id", "label": "Dimension name", "weight": <int>, "competencyTags": ["tag"] }
    ],
    "phases": [
      {
        "type": "one of: resume_project | coding | cs_sql | cs_theory | system_design | ds_sql | ds_coding | ds_concepts | ds_business_case | genai_coding | genai_concepts | pm_case | pm_concepts | pm_strategy | problem_solving | behavioral",
        "durationMinutes": <minutes for this phase>,
        "questions": [
          {
            "prompt": "what the interviewer asks (REQUIRED for behavioral; for resume it is auto-grounded; for artifact phases it is just spoken framing — the real problem comes from the question bank; OMIT it for concept/theory phases — those draw from the bank pool at runtime)",
            "expectedPoints": ["evaluation signal the candidate should hit"],
            "followUpPolicy": { "maxFollowUps": <0-2> }
          }
        ]
      }
    ]
  }
}

Rules:
- CONFIDENTIALITY (critical): your "reply" is shown to the RECRUITER, who must NOT see any backend/implementation detail. NEVER mention: a "question bank", "our DB"/database, questions being "fetched"/"pulled"/"drawn"/"selected" "at runtime" or "from the bank", prefetching, the server, internal IDs, the word "archetype", or how the system works internally. Describe each phase in plain, recruiter-facing product terms — what it ASSESSES and what the CANDIDATE does — as if you personally designed the screen. If the recruiter asks where questions come from, say only that questions are professionally curated for the role and difficulty; never describe the mechanism.
- If a DETECTED ROLE ARCHETYPE block is provided below, KEEP its phases/order/rubric BY DEFAULT — it is the source of truth for what a screen for this role should cover. The recruiter does NOT know which phases exist, so you must proactively include the role's core phases; never rely on the recruiter to ask for a phase they don't know about. Only DROP an archetype phase if it clearly CONTRADICTS this JD (e.g. no coding/system-design for a non-technical role), NOT merely to make the screen shorter. You MAY add a phase the JD emphasizes that the archetype lacks. Lean into what the JD stresses by adjusting durations/rubric weights, not by deleting role-core phases. Use only phase types from the list above. For non-technical leadership roles, do NOT add a technical coding or system-design whiteboard phase.
- Rubric weights should sum to 100 (they will be rescaled if not). 3-6 dimensions is ideal. As YOUR default, keep the screen balanced — avoid giving any single dimension more than ~40%. ALWAYS include a project/ownership-validation dimension with meaningful weight (verifying the candidate really did their claimed work matters for every role). BUT if the recruiter explicitly asks for a specific weight (e.g. "system design 50%"), honor it EXACTLY and set recruiterSetExactValues=true.
- Choose phases that fit the role. Phase durationMinutes should sum to roughly durationMinutes and, as YOUR default, be multiples of 5 (e.g. 10, 15, 20, 25 — not 14 or 24). Give deep phases realistic thinking time (coding and system_design ~25-40 min each; don't default them to 15-20 min). Always include a resume/project-validation phase with substantial time (~10-15 min, never a token 3-5 min) — probing real project ownership is a first-class screening signal for every role. BUT if the recruiter explicitly asks for specific durations, honor them EXACTLY and set recruiterSetExactValues=true.
- ARTIFACT phases pull a specific problem from a question bank (auto-selected at setup) — do NOT invent the problem, just provide spoken framing + expected evaluation signals. These are: coding, cs_sql, ds_sql, ds_coding, genai_coding (open an in-room editor/IDE), system_design (open a diagramming whiteboard), pm_case, problem_solving (open a notepad case).
- CONCEPT/theory phases (cs_theory, ds_concepts, genai_concepts, pm_concepts, pm_strategy) draw their questions from a bank pool at runtime — do NOT author the questions or a prompt; just set the phase, its duration, and the rubric it feeds. How many are asked is decided at runtime (by time budget / the recruiter), not here.
- "behavioral" uses a notepad and needs a real prompt (that prompt IS the question asked).
- "ds_business_case" is a conversational data-science business/metrics discussion grounded on the candidate's own projects at runtime — do NOT author its questions or a prompt; just set the phase, its duration, and the rubric it feeds.
- Keep it tight: 1-3 questions per phase. Prefer fewer, deeper questions for short screens.
- clarifyingQuestions: generate up to 2 JD-SPECIFIC pointers ONLY on the first design of a fresh JD; on ANY edit (a current draft is provided) return []. Never include generic seniority/skills/duration questions (those are shown automatically), and never loop — the list is captured once and not regenerated.
- If the recruiter is editing an existing draft (provided below), apply their requested change and keep everything else stable.
- If the recruiter only asks a question (e.g. "why did you add system design?") WITHOUT asking to change the plan, answer in "reply", return the current draft UNCHANGED, and set "planChanged": false. Only set "planChanged": true when you genuinely altered the blueprint.
- When you remove a phase, also remove the rubric dimensions that only that phase evaluated, so no orphan scoring tags remain.`;

function buildUserPrompt(input: ConfigAgentInput, analysis?: JobAnalysis | null): string {
    const parts: string[] = [];
    if (input.jobTitle) parts.push(`Role title: ${input.jobTitle}`);
    if (input.totalDurationMinutes) parts.push(`Recruiter's target total duration: ${input.totalDurationMinutes} minutes.`);
    if (analysis) {
        parts.push(`Role analysis (use this to shape the phases + rubric):\n${JSON.stringify(analysis, null, 2)}`);
        // The archetype gives a strong, role-correct DEFAULT structure. It is a
        // starting point the agent adapts to the JD and the recruiter can override.
        parts.push(renderArchetypeDefaults(archetypeById(analysis.archetype)));
    }
    if (input.jobDescription) parts.push(`Job description:\n${str(input.jobDescription).slice(0, 8000)}`);
    if (input.currentDraft) {
        parts.push(`Current draft blueprint (apply edits relative to this):\n${JSON.stringify(input.currentDraft, null, 2).slice(0, 8000)}`);
    }
    if (input.messages.length) {
        const convo = input.messages
            .slice(-12)
            .map((m) => `${m.role === "assistant" ? "ASSISTANT" : "RECRUITER"}: ${str(m.content).slice(0, 2000)}`)
            .join("\n");
        parts.push(`Conversation so far:\n${convo}`);
    }
    if (!input.currentDraft && !input.messages.length) {
        parts.push("This is the first turn. Propose a complete screening from the job description.");
    }
    return parts.join("\n\n");
}

/**
 * Turn the model's loose blueprint into the recruiter config shape, then run it
 * through buildScreeningBlueprint (which groups questions into phases, normalizes
 * rubric weights to 100, routes expected points to rubric dimensions, and
 * distributes durations). Finally override per-phase durations with the agent's
 * explicit plan, rescaled to the total, so the recruiter's "approx time per phase"
 * survives.
 */
export function normalizeScreeningDraft(raw: any, input: ConfigAgentInput): { draft: ScreeningBlueprint; needsBankQuestionPhaseIds: string[] } {
    const bp = (raw && typeof raw === "object" ? raw.blueprint : null) || {};
    const totalDuration = clampInt(
        bp.durationMinutes ?? input.totalDurationMinutes,
        10,
        120,
        input.totalDurationMinutes ? clampInt(input.totalDurationMinutes, 10, 120, DEFAULT_TOTAL_MINUTES) : DEFAULT_TOTAL_MINUTES
    );

    const rubric = (Array.isArray(bp.rubric) ? bp.rubric : []).map((dim: any, i: number) => ({
        id: str(dim?.id, str(dim?.label, `dimension_${i + 1}`).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || `dimension_${i + 1}`),
        label: str(dim?.label, `Dimension ${i + 1}`),
        weight: clampInt(dim?.weight, 0, 100, 0),
        competencyTags: Array.isArray(dim?.competencyTags) ? dim.competencyTags.map((t: any) => str(t)).filter(Boolean) : [],
    }));

    const phasesRaw = Array.isArray(bp.phases) ? bp.phases : [];
    const questions: any[] = [];
    const durationByType = new Map<ScreeningPhaseType, number>();
    let qIndex = 0;

    for (const phaseRaw of phasesRaw) {
        const type = normalizePhaseType(phaseRaw?.type);
        if (!type || !SUPPORTED_SCREENING_CATEGORIES.includes(type)) continue;
        const category = PHASE_TYPE_TO_CATEGORY[type];
        durationByType.set(type, (durationByType.get(type) || 0) + clampInt(phaseRaw?.durationMinutes, 0, 120, 0));

        const phaseQuestions = Array.isArray(phaseRaw?.questions) ? phaseRaw.questions : [];
        const questionsBefore = questions.length;
        for (const qRaw of phaseQuestions) {
            const expectedPoints = (Array.isArray(qRaw?.expectedPoints) ? qRaw.expectedPoints : [])
                .map((point: any, pi: number) => ({
                    id: `point_${pi + 1}`,
                    text: typeof point === "string" ? str(point) : str(point?.text),
                }))
                .filter((p: any) => p.text);
            questions.push({
                id: `q${++qIndex}`,
                category,
                prompt: str(qRaw?.prompt),
                expectedPoints,
                followUpPolicy: { maxFollowUps: clampInt(qRaw?.followUpPolicy?.maxFollowUps, 0, 2, 2) },
            });
        }
        // A phase the model DECLARED but authored no questions for must still survive.
        // Concept/pool phases (cs_theory, ds_concepts, genai_concepts, pm_concepts,
        // pm_strategy) are deliberately told NOT to author questions — their questions come
        // from the bank at runtime — so they arrive with questions:[]. buildScreeningBlueprint
        // rebuilds phases FROM questions[], so without a placeholder these phases would be
        // silently dropped (this is why "add pm_strategy" appeared to do nothing). Keep one
        // placeholder so the phase exists, holds its duration, and the runtime pool fills it.
        if (questions.length === questionsBefore) {
            questions.push({
                id: `q${++qIndex}`,
                category,
                prompt: "",
                expectedPoints: [],
                followUpPolicy: { maxFollowUps: 2 },
            });
        }
    }

    const config = { title: str(bp.title, str(input.jobTitle, "AI screening interview")), durationMinutes: totalDuration, rubric, questions };
    const built = buildScreeningBlueprint(config);
    let draft = pruneOrphanRubricDimensions(applyPhaseDurations(built, durationByType, totalDuration));
    // Guardrails (weight cap + duration floors) shape the agent's AUTONOMOUS default
    // only. When the recruiter explicitly asked for specific weights/durations, the
    // model flags recruiterSetExactValues and we honor those numbers verbatim.
    const respectExactValues = Boolean(raw?.recruiterSetExactValues);
    if (!respectExactValues) {
        draft = snapPhaseDurationsToStep(
            enforcePhaseDurationFloors({ ...draft, rubricDimensions: capRubricWeights(draft.rubricDimensions) })
        );
    }
    return { draft, needsBankQuestionPhaseIds: neededBankIds(draft) };
}

/**
 * Phase-type-specific keywords for rubric dimensions. A dimension whose
 * label/id/tags clearly belong to one of these phase types (e.g. "Basic
 * System-Design Awareness" -> system_design) is only meaningful while that phase
 * exists. Generic dimensions (Communication, Problem solving, Technical depth)
 * match nothing here and are always cross-cutting, so they are never pruned.
 * Routing-based pruning is deliberately NOT used: the model rarely tags expected
 * points per dimension, so every point collapses onto the first dimension and a
 * routing prune would wrongly strip every dimension but one.
 */
const DIMENSION_PHASE_KEYWORDS: Array<{ type: ScreeningPhaseType; patterns: RegExp[] }> = [
    { type: "system_design", patterns: [/system[\s-]?design/i, /architect/i, /scalab/i, /distributed system/i] },
    { type: "cs_sql", patterns: [/\bsql\b/i, /database/i, /\bquery\b/i, /cs fundamentals/i] },
    { type: "behavioral", patterns: [/behaviou?ral/i] },
];

/**
 * Drop rubric dimensions that are specific to a phase the agent has since
 * removed, then rescale the survivors back to 100. When a phase (e.g. system
 * design) is dropped, the dimension named for it ("Basic System-Design
 * Awareness") would otherwise linger as an orphan scoring tag. A dimension is
 * pruned only when it matches one or more phase types AND none of those types
 * remain in the blueprint.
 */
function pruneOrphanRubricDimensions(blueprint: ScreeningBlueprint): ScreeningBlueprint {
    const presentTypes = new Set(blueprint.phases.map((p) => p.type));
    const isOrphan = (dim: { label: string; id: string; competencyTags: string[] }) => {
        const hay = `${dim.label} ${dim.id} ${dim.competencyTags.join(" ")}`;
        let matchedAbsent = false;
        for (const { type, patterns } of DIMENSION_PHASE_KEYWORDS) {
            if (patterns.some((re) => re.test(hay))) {
                if (presentTypes.has(type)) return false; // tied to a phase that still exists — keep
                matchedAbsent = true; // tied only to absent phase(s) so far
            }
        }
        return matchedAbsent;
    };
    const kept = blueprint.rubricDimensions.filter((d) => !isOrphan(d));
    // Never prune to empty, and skip the rescale when nothing was orphaned.
    if (!kept.length || kept.length === blueprint.rubricDimensions.length) return blueprint;
    return { ...blueprint, rubricDimensions: normalizeRubricWeights(kept) };
}

/** Override phase durations with the agent's per-type plan, rescaled to sum to total. */
function applyPhaseDurations(
    blueprint: ScreeningBlueprint,
    durationByType: Map<ScreeningPhaseType, number>,
    totalDuration: number
): ScreeningBlueprint {
    const phases = blueprint.phases;
    if (!phases.length) return blueprint;
    const hinted = phases.map((p) => durationByType.get(p.type) || 0);
    const hintedTotal = hinted.reduce((a, b) => a + b, 0);
    // If the model gave no usable per-phase hints, keep buildScreeningBlueprint's split.
    if (hintedTotal <= 0) return blueprint;

    let allocated = 0;
    const scaled: ScreeningPhase[] = phases.map((phase, i) => {
        const minutes = Math.max(1, Math.round((hinted[i] / hintedTotal) * totalDuration));
        allocated += minutes;
        return { ...phase, durationMinutes: minutes };
    });
    const drift = totalDuration - allocated;
    if (drift !== 0) scaled[0] = { ...scaled[0], durationMinutes: Math.max(1, scaled[0].durationMinutes + drift) };
    return { ...blueprint, durationMinutes: totalDuration, phases: scaled };
}

function fallbackDraft(input: ConfigAgentInput): ScreeningBlueprint {
    if (input.currentDraft) return input.currentDraft;
    return buildScreeningBlueprint({
        title: str(input.jobTitle, "AI screening interview"),
        durationMinutes: input.totalDurationMinutes ? clampInt(input.totalDurationMinutes, 10, 120, DEFAULT_TOTAL_MINUTES) : DEFAULT_TOTAL_MINUTES,
        rubric: [
            { id: "technical_depth", label: "Technical depth", weight: 50, competencyTags: ["technical_depth"] },
            { id: "communication", label: "Communication", weight: 50, competencyTags: ["communication"] },
        ],
        questions: [
            { id: "q1", category: "resume", prompt: "", expectedPoints: [{ id: "point_1", text: "Concrete ownership and impact on a recent project." }], followUpPolicy: { maxFollowUps: 2 } },
        ],
    });
}

/** Artifact phase ids that still need a bank question attached (auto-pick or recruiter). */
function neededBankIds(draft: ScreeningBlueprint): string[] {
    return draft.phases
        .filter((p) => bankTypeForPhase(p.type) !== null && p.questions.some((q) => !q.bankQuestion?.id))
        .map((p) => p.id);
}

/** A single design LLM call (JD [+ analysis] -> blueprint). Throws on model error. */
async function runDesignCallRaw(input: ConfigAgentInput, analysis: JobAnalysis | null): Promise<ConfigAgentResult> {
    const userPrompt = buildUserPrompt(input, analysis);
    const result = await generateConfigAgentContent({
        model: GEMINI_MODEL,
        contents: [{ role: "user", parts: [{ text: `${SYSTEM_PROMPT}\n\n${userPrompt}` }] }],
        config: { responseMimeType: "application/json", temperature: 0.2 },
    });
    const parsed = JSON.parse(extractJsonObject(result.text || "{}"));
    // A fresh build always counts as a change; on an edit we trust the model's
    // explicit planChanged flag (defaulting to "changed" if it omitted it). When
    // the recruiter was only asking a question, keep the current draft verbatim so
    // the timeline panel doesn't drift on a conversational turn.
    const planChanged = input.currentDraft ? parsed.planChanged !== false : true;
    if (input.currentDraft && !planChanged) {
        const draft = input.currentDraft;
        return {
            reply: str(parsed.reply, "Happy to explain — your current plan is unchanged."),
            draft,
            clarifyingQuestions: Array.isArray(parsed.clarifyingQuestions)
                ? parsed.clarifyingQuestions.map((q: any) => str(q)).filter(Boolean).slice(0, 3)
                : [],
            needsBankQuestionPhaseIds: neededBankIds(draft),
            validation: validateScreeningConfig(toValidationConfig(draft)),
            fallback: false,
            planChanged: false,
        };
    }
    const normalized = normalizeScreeningDraft(parsed, input);
    // Auto-seed bank-backed phases with a random question so the recruiter starts
    // from a ready-to-run screen; they can swap any question in the UI.
    const draft = await autoAttachBankQuestions(normalized.draft);
    return {
        reply: str(parsed.reply, "Here's a screening plan based on the role. I've pre-selected questions for the coding, SQL, and system-design phases — swap any of them from the timeline, then continue."),
        draft,
        clarifyingQuestions: Array.isArray(parsed.clarifyingQuestions)
            ? parsed.clarifyingQuestions.map((q: any) => str(q)).filter(Boolean).slice(0, 3)
            : [],
        needsBankQuestionPhaseIds: neededBankIds(draft),
        validation: validateScreeningConfig(toValidationConfig(draft)),
        fallback: false,
        planChanged,
    };
}

/** Deterministic fallback result when the model is unreachable. */
function fallbackResult(input: ConfigAgentInput, errorMessage: string): ConfigAgentResult {
    const draft = fallbackDraft(input);
    return {
        reply: errorMessage,
        draft,
        clarifyingQuestions: [],
        needsBankQuestionPhaseIds: neededBankIds(draft),
        validation: validateScreeningConfig(toValidationConfig(draft)),
        fallback: true,
        // A fresh build (no prior draft) still needs to render the fallback plan;
        // an edit fell back to the unchanged current draft, so the panel can hold.
        planChanged: !input.currentDraft,
    };
}

export async function generateScreeningBlueprintDraft(input: ConfigAgentInput): Promise<ConfigAgentResult> {
    try {
        return await runDesignCallRaw(input, null);
    } catch (error: any) {
        return fallbackResult(input, `I couldn't generate a draft just now (${str(error?.message, "model error")}). I kept your current draft — try again or edit it directly.`);
    }
}

// ── Agentic streaming: parse the JD, then design the plan, narrating each step ──

export type JobAnalysis = {
    role: string;
    seniority: string;
    coreSkills: string[];
    focusAreas: string[];
    summary: string;
    /** Best-fit role archetype id (drives the DEFAULT phase/rubric structure). */
    archetype: ScreeningArchetypeId;
};

const ANALYSIS_PROMPT = `You are analyzing a job description to prepare a technical screening interview. Return ONLY a JSON object:
{
  "role": "concise role name",
  "seniority": "junior | mid | senior | staff | unknown",
  "coreSkills": ["4-8 most important skills to screen for"],
  "focusAreas": ["what the screen should emphasize, e.g. system design, SQL, ownership"],
  "archetype": "the single best-fit role family, one of: ${ARCHETYPE_IDS.join(" | ")}",
  "summary": "1-2 sentence summary of the role"
}
Pick the archetype that best matches the role. Use "engineering_leadership" for non-technical people/management roles, "product_manager" for PM roles, and "generalist_swe" only when no more specific engineering archetype fits.`;

async function analyzeJob(input: ConfigAgentInput): Promise<JobAnalysis | null> {
    if (!str(input.jobDescription) && !str(input.jobTitle)) return null;
    try {
        const prompt = `${ANALYSIS_PROMPT}\n\nRole title: ${str(input.jobTitle, "unknown")}\nJob description:\n${str(input.jobDescription).slice(0, 8000)}`;
        const result = await generateConfigAgentContent({
            model: GEMINI_MODEL,
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            config: { responseMimeType: "application/json", temperature: 0 },
        });
        const parsed = JSON.parse(extractJsonObject(result.text || "{}"));
        const role = str(parsed.role, str(input.jobTitle, "the role"));
        const coreSkills = Array.isArray(parsed.coreSkills) ? parsed.coreSkills.map((s: any) => str(s)).filter(Boolean).slice(0, 8) : [];
        const focusAreas = Array.isArray(parsed.focusAreas) ? parsed.focusAreas.map((s: any) => str(s)).filter(Boolean).slice(0, 6) : [];
        // Trust the model's archetype if valid; otherwise fall back to deterministic keyword matching.
        const rawArchetype = str(parsed.archetype).toLowerCase();
        const archetype: ScreeningArchetypeId = (ARCHETYPE_IDS as string[]).includes(rawArchetype)
            ? (rawArchetype as ScreeningArchetypeId)
            : selectArchetype({ role, coreSkills, focusAreas, jobTitle: input.jobTitle }).id;
        return { role, seniority: str(parsed.seniority, "unknown"), coreSkills, focusAreas, summary: str(parsed.summary), archetype };
    } catch {
        return null;
    }
}

/** Live progress event for the recruiter's "agent working" panel. */
export type ScreeningAgentEvent =
    | { type: "status"; text: string; emphasis?: string }
    | { type: "skills"; skills: string[] }
    | {
        type: "done";
        reply: string;
        draft: ScreeningBlueprint;
        needsBankQuestionPhaseIds: string[];
        suggestedQuestions: string[];
        validation: { valid: boolean; errors: string[] };
        fallback: boolean;
        planChanged: boolean;
    }
    | { type: "error"; message: string };

function doneEvent(result: ConfigAgentResult): ScreeningAgentEvent {
    return {
        type: "done",
        reply: result.reply,
        draft: result.draft,
        needsBankQuestionPhaseIds: result.needsBankQuestionPhaseIds,
        suggestedQuestions: result.clarifyingQuestions,
        validation: result.validation,
        fallback: result.fallback,
        planChanged: result.planChanged,
    };
}

/**
 * Streams the JD -> blueprint generation as discrete narrated steps. A fresh
 * build is genuinely two-step (analyze the JD, then design from that analysis);
 * an edit (currentDraft present) is a single design pass. Either way the caller
 * forwards each event to the recruiter UI over SSE.
 */
export async function* streamScreeningBlueprintDraft(input: ConfigAgentInput): AsyncGenerator<ScreeningAgentEvent> {
    const isEdit = Boolean(input.currentDraft);
    try {
        if (isEdit) {
            yield { type: "status", text: "Reading your request", emphasis: "request" };
            yield { type: "status", text: "Updating the interview plan", emphasis: "interview plan" };
            yield doneEvent(await runDesignCallRaw(input, null));
            return;
        }

        yield { type: "status", text: "Parses the JD", emphasis: "JD" };
        const analysis = await analyzeJob(input);
        yield { type: "status", text: "Identifies core skills", emphasis: "core skills" };
        if (analysis?.coreSkills?.length) yield { type: "skills", skills: analysis.coreSkills };
        yield { type: "status", text: "Understands hiring requirements", emphasis: "hiring requirements" };
        yield { type: "status", text: "Maps the interview phases", emphasis: "interview phases" };
        const result = await runDesignCallRaw(input, analysis);
        yield { type: "status", text: "Builds the scoring rubric", emphasis: "scoring rubric" };
        yield { type: "status", text: "Interview plan created successfully!" };
        yield doneEvent(result);
    } catch (error: any) {
        yield doneEvent(fallbackResult(input, `I couldn't reach the model (${str(error?.message, "model error")}). I kept a basic plan — set GOOGLE_GENERATIVE_AI_API_KEY (or GROQ_API_KEY for the fallback) and try again.`));
    }
}

/** Flatten a blueprint back into the validateScreeningConfig input shape. */
function toValidationConfig(blueprint: ScreeningBlueprint) {
    return {
        rubric: blueprint.rubricDimensions,
        questions: blueprint.phases.flatMap((phase) =>
            phase.questions.map((question) => ({
                id: question.id,
                category: question.category,
                prompt: question.prompt,
                bankQuestion: question.bankQuestion ?? null,
            }))
        ),
    };
}
