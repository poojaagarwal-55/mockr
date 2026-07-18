"use client";

import { useEffect, useRef, useState } from "react";
import { useCompanyAuth } from "@/context/company-auth-context";
import { api, apiStream, ApiError } from "@/lib/api";

// ── Types mirroring the /config-agent response (a normalized ScreeningBlueprint) ──

type PhaseType =
    | "resume_project" | "coding" | "cs_sql" | "cs_theory" | "system_design"
    | "frontend_coding" | "ds_sql" | "ds_coding" | "ds_concepts" | "ds_business_case"
    | "genai_coding" | "genai_concepts" | "genai_system_design"
    | "pm_case" | "pm_concepts" | "pm_strategy" | "problem_solving"
    | "behavioral" | "custom";

// Artifact bank kinds (mirror ScreeningBankKind on the server). Concept phases never
// carry a ref (pool-backed at runtime), so their kinds don't appear here.
type BankQuestionRef = {
    id: string;
    type: "dsa" | "sql" | "system_design" | "ds_sql" | "ds_coding" | "genai_coding" | "genai_system_design" | "pm_case" | "problem_solving";
    source: "platform" | "company";
    title?: string | null;
};

type DraftQuestion = {
    id: string;
    category: string;
    prompt: string;
    expectedPoints: Array<{ id: string; text: string; rubricDimensionId?: string | null }>;
    bankQuestion?: BankQuestionRef | null;
    followUpPolicy: { maxFollowUps: number };
};

type DraftPhase = {
    id: string;
    type: PhaseType;
    title: string;
    durationMinutes: number;
    questions: DraftQuestion[];
};

type DraftRubricDimension = { id: string; label: string; weight: number; competencyTags: string[] };

type DraftBlueprint = {
    version: 1;
    template: string;
    title: string;
    durationMinutes: number;
    rubricDimensions: DraftRubricDimension[];
    phases: DraftPhase[];
};

type ConfigAgentResponse = {
    reply: string;
    draft: DraftBlueprint;
    clarifyingQuestions: string[];
    needsBankQuestionPhaseIds: string[];
    validation: { valid: boolean; errors: string[] };
    fallback: boolean;
};

type ChatMessage = { role: "user" | "assistant"; content: string };

type ActiveInterview = {
    roundId: string;
    jobTitle?: string;
    /** True once the recruiter has saved a setup — drives edit-mode hydration. */
    configured?: boolean;
    /** The saved, normalized blueprint (phases + durations + rubric) to continue from. */
    blueprint?: DraftBlueprint | null;
    startAt?: string | null;
    endAt?: string | null;
    candidateMessage?: string | null;
    allowRetake?: boolean;
};

/** ISO timestamp -> the local value a <input type="datetime-local"> expects. */
function toInputDateTime(value?: string | null) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 16);
}

/** Recover per-phase bank refs from a saved blueprint so the picker shows them pre-attached. */
function bankRefsFromBlueprint(blueprint?: DraftBlueprint | null): Record<string, BankQuestionRef | null> {
    const map: Record<string, BankQuestionRef | null> = {};
    if (!blueprint) return map;
    for (const phase of blueprint.phases) {
        if (!phaseNeedsBank(phase.type)) continue;
        const withBank = phase.questions.find((q) => q.bankQuestion);
        map[phase.id] = withBank?.bankQuestion ?? null;
    }
    return map;
}

/** Merge the recruiter's per-phase bank picks into a draft (for sending as currentDraft). */
function draftWithBankRefs(draft: DraftBlueprint, bankByPhase: Record<string, BankQuestionRef | null>): DraftBlueprint {
    return {
        ...draft,
        phases: draft.phases.map((phase) => phaseNeedsBank(phase.type) ? {
            ...phase,
            questions: phase.questions.map((q) => ({
                ...q,
                bankQuestion: bankByPhase[phase.id] ?? q.bankQuestion ?? null,
            })),
        } : phase),
    };
}

/** A deterministic recap of the saved setup, shown as the first assistant turn on edit. */
function summarizeBlueprint(blueprint: DraftBlueprint): string {
    const phaseList = blueprint.phases
        .map((phase, i) => `${i + 1}. ${phase.title} — ~${phase.durationMinutes} min`)
        .join("\n");
    const count = blueprint.phases.length;
    return `Here's your current screening setup for "${blueprint.title}" — ${count} phase${count === 1 ? "" : "s"}, ~${blueprint.durationMinutes} min total:\n\n${phaseList}\n\nAsk me to change anything — durations, phases, rubric weights, or the coding/SQL questions — and I'll update the timeline on the right.`;
}

// ── Auto-growing chat textarea (multi-line input that expands with content) ──

function GrowTextarea({ value, onChange, onSubmit, placeholder, className, autoFocus }: {
    value: string;
    onChange: (next: string) => void;
    onSubmit: () => void;
    placeholder: string;
    className: string;
    autoFocus?: boolean;
}) {
    const ref = useRef<HTMLTextAreaElement>(null);
    // Reset to auto first so the box can shrink when text is deleted, then grow to
    // fit the content (capped by the max-height in the className, which scrolls).
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        el.style.height = "auto";
        el.style.height = `${el.scrollHeight}px`;
    }, [value]);
    return (
        <textarea
            ref={ref}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    onSubmit();
                }
            }}
            placeholder={placeholder}
            className={className}
            rows={1}
            autoFocus={autoFocus}
        />
    );
}

// ── Phase presentation ──

// Static per-phase presentation: a recruiter-friendly NAME + a fixed 2–3 line
// description of what the phase is and what it assesses. This is the single source of
// truth for phase copy (like the archetype map) — it is NOT LLM-generated, so every
// screen shows the same clear, correct blurb and the recruiter never has to ask "what
// is a product case?". Descriptions are candidate/skill-facing only — no backend detail.
const PHASE_META: Record<PhaseType, { icon: string; name: string; subtitle: string; blurb: string; accent: string }> = {
    resume_project: { icon: "description", name: "Resume & Project Deep-Dive", subtitle: "Guided conversation", accent: "text-sky-500",
        blurb: "The interviewer walks through the candidate's real projects to verify genuine ownership — what they personally built, the decisions and tradeoffs they made, and the measurable impact they drove." },
    coding: { icon: "code", name: "Coding Round", subtitle: "In-browser IDE", accent: "text-violet-500",
        blurb: "The candidate solves a coding problem live in an editor. Assesses correctness, edge-case handling, complexity/optimization reasoning, and how clearly they explain their approach." },
    cs_sql: { icon: "database", name: "SQL", subtitle: "In-browser editor", accent: "text-amber-500",
        blurb: "A hands-on SQL task in an editor. Assesses practical query skill — joins, aggregation, and translating a question into correct SQL." },
    cs_theory: { icon: "menu_book", name: "CS Fundamentals", subtitle: "Guided conversation", accent: "text-amber-500",
        blurb: "Conceptual questions across operating systems, databases, networking, and OOP. Assesses real understanding of core fundamentals rather than memorization." },
    system_design: { icon: "schema", name: "System Design", subtitle: "Diagramming whiteboard", accent: "text-emerald-500",
        blurb: "The candidate architects a system on a whiteboard. Assesses requirement scoping, high-level design, and reasoning about scale, reliability, and tradeoffs." },
    frontend_coding: { icon: "web", name: "Frontend Coding", subtitle: "In-browser IDE", accent: "text-violet-500",
        blurb: "A UI-focused coding task. Assesses component design, state handling, and front-end problem solving." },
    ds_sql: { icon: "database", name: "Analytics SQL", subtitle: "SQL editor", accent: "text-amber-500",
        blurb: "A business-framed analytics query against a realistic schema. Assesses SQL proficiency (joins, aggregation, windowing) and whether the candidate ties the result back to the business question." },
    ds_coding: { icon: "analytics", name: "Data Analysis (Python)", subtitle: "Python IDE", accent: "text-violet-500",
        blurb: "A hands-on pandas/Python analysis task. Assesses correct, idiomatic analysis and sound reasoning about the data (types, missing values, grain)." },
    ds_concepts: { icon: "functions", name: "Statistics & ML Concepts", subtitle: "Guided conversation", accent: "text-teal-500",
        blurb: "Applied statistics and machine-learning reasoning questions. Assesses depth and the ability to apply concepts (inference, evaluation, bias/variance) to real situations." },
    ds_business_case: { icon: "trending_up", name: "Business & Metrics Case", subtitle: "Guided conversation", accent: "text-indigo-500",
        blurb: "A business scenario grounded on the candidate's own work: defining success metrics, diagnosing a metric change, and turning analysis into a decision. Assesses whether they connect data to business impact." },
    genai_coding: { icon: "smart_toy", name: "GenAI Coding", subtitle: "In-browser IDE (no AI assist)", accent: "text-violet-500",
        blurb: "The candidate implements an applied GenAI task (e.g. a retrieval function or eval scorer) in the editor, without any AI assistant. Assesses their own implementation, robustness, and understanding." },
    genai_concepts: { icon: "psychology", name: "GenAI Fundamentals", subtitle: "Guided conversation", accent: "text-teal-500",
        blurb: "Concept questions on transformers, RAG, prompting, evaluation, and model selection. Assesses genuine depth and practical tradeoff thinking about LLM systems." },
    genai_system_design: { icon: "hub", name: "AI System Design", subtitle: "Diagramming whiteboard", accent: "text-emerald-500",
        blurb: "The candidate designs an AI system such as a RAG pipeline or evaluation framework. Assesses architecture and reasoning about evaluation, cost, and reliability." },
    pm_case: { icon: "cases", name: "Product Case", subtitle: "Interactive discussion", accent: "text-indigo-500",
        blurb: "An interactive product scenario the candidate works through with the interviewer. Assesses structured problem-solving, user and metric thinking, prioritization, and tradeoff decisions." },
    pm_concepts: { icon: "insights", name: "Product Concepts", subtitle: "Guided conversation", accent: "text-teal-500",
        blurb: "Focused questions on core PM frameworks — metric definition, prioritization, and experiment design. Assesses product judgement and applying frameworks to real situations." },
    pm_strategy: { icon: "strategy", name: "Product Strategy", subtitle: "Guided conversation", accent: "text-indigo-500",
        blurb: "A strategy discussion with challenging follow-ups: roadmap tradeoffs, north-star framing, and defending a position under pressure. Assesses strategic thinking and conviction backed by reasoning." },
    problem_solving: { icon: "extension", name: "Problem-Solving Case", subtitle: "Notepad", accent: "text-indigo-500",
        blurb: "An open-ended case the candidate reasons through on a notepad. Assesses how they decompose ambiguity, state assumptions, and adapt when a twist is introduced." },
    behavioral: { icon: "forum", name: "Behavioral", subtitle: "Guided conversation", accent: "text-rose-500",
        blurb: "Structured questions about real past situations. Assesses ownership, collaboration, and how the candidate handles conflict and ambiguity — with specifics, not rehearsed stories." },
    custom: { icon: "tune", name: "Custom Round", subtitle: "Custom", accent: "text-slate-500",
        blurb: "A custom screening segment configured for this role." },
};

// Universal clarification pointers — the same for EVERY screen, so they need no LLM. Shown
// as fixed guidance the recruiter can answer in the chat to sharpen the screen. The (up to 2)
// JD-specific pointers are captured ONCE from the first generation and appended; nothing here
// is regenerated on later turns (no per-edit LLM cost, no endless question loop).
const UNIVERSAL_CLARIFICATIONS = [
    "Target seniority / years of experience (e.g. mid-level, senior, 5+ years)",
    "Any must-have skills, tools, or domain experience to emphasize",
    "Preferred total screening duration",
];

const CATEGORY_FOR_PHASE: Record<PhaseType, string> = {
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

/**
 * Phases that show the in-builder bank PICKER (recruiter can browse/swap). Only the
 * three original picker-backed types this pass — the new artifact phases (ds and genai
 * editors, pm_case, problem_solving) are auto-picked server-side and their swap UI ships
 * with the runtime flow, so they get no picker here (their auto-attached ref still flows
 * to /setup via q.bankQuestion). Concept phases are pool-backed and never pinned.
 */
function phaseNeedsBank(type: PhaseType) {
    return type === "coding" || type === "cs_sql" || type === "system_design";
}

function bankTypeForPhase(type: PhaseType): "dsa" | "sql" | "system_design" | null {
    if (type === "coding") return "dsa";
    if (type === "cs_sql") return "sql";
    if (type === "system_design") return "system_design";
    return null;
}

// ── Inline bank-question picker (modeled on the workspace BankQuestionPicker) ──

type BankDatasetQuestion = { id: string; title: string; difficulty?: string | null };

// Route segment + display strings per bank type. system_design lives at the
// hyphenated "system-design" route and opens a whiteboard, not an IDE.
const BANK_TYPE_META: Record<"dsa" | "sql" | "system_design", { segment: string; label: string; workspace: string }> = {
    dsa: { segment: "dsa", label: "coding", workspace: "IDE" },
    sql: { segment: "sql", label: "SQL", workspace: "SQL editor" },
    system_design: { segment: "system-design", label: "system design", workspace: "whiteboard" },
};

function MiniBankPicker({ type, token, value, onSelect }: {
    type: "dsa" | "sql" | "system_design";
    token?: string;
    value: BankQuestionRef | null;
    onSelect: (ref: BankQuestionRef | null) => void;
}) {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState("");
    const [results, setResults] = useState<BankDatasetQuestion[]>([]);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

    const meta = BANK_TYPE_META[type];

    function load(next: string) {
        if (!token) return;
        if (debounce.current) clearTimeout(debounce.current);
        setLoading(true);
        setErr(null);
        debounce.current = setTimeout(() => {
            const q = next.trim() ? `&search=${encodeURIComponent(next.trim())}` : "";
            api.get<{ questions: BankDatasetQuestion[] }>(`/companies/question-bank/${meta.segment}/dataset?limit=8${q}`, token)
                .then((res) => setResults(res.questions || []))
                .catch((e) => setErr(e instanceof ApiError ? e.message : "Failed to load questions."))
                .finally(() => setLoading(false));
        }, 300);
    }

    const label = meta.label;

    return (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-lc-border dark:bg-lc-bg">
            <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-primary">{label} question (required)</p>
                <button
                    type="button"
                    onClick={() => { const next = !open; setOpen(next); if (next) load(search); }}
                    className="text-xs font-extrabold text-primary"
                >
                    {open ? "Close" : value ? "Change" : "Choose from bank"}
                </button>
            </div>
            {value ? (
                <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm dark:border-emerald-400/30 dark:bg-emerald-400/10">
                    <span className="truncate font-bold">{value.title || value.id}</span>
                    <button type="button" onClick={() => onSelect(null)} className="shrink-0 text-xs font-extrabold text-red-500">Remove</button>
                </div>
            ) : (
                <p className="mt-2 text-xs font-semibold text-amber-600">No question attached — the candidate needs one to open the {meta.workspace}.</p>
            )}
            {open && (
                <div className="mt-3">
                    <input
                        value={search}
                        onChange={(e) => { setSearch(e.target.value); load(e.target.value); }}
                        placeholder={`Search ${label} questions...`}
                        className="input"
                    />
                    {err && <p className="mt-2 text-xs font-bold text-red-500">{err}</p>}
                    {loading ? (
                        <p className="mt-2 text-xs text-slate-500">Loading...</p>
                    ) : (
                        <ul className="mt-2 max-h-52 overflow-auto rounded-md border border-slate-200 bg-white dark:border-lc-border dark:bg-lc-surface">
                            {results.length === 0 ? (
                                <li className="px-3 py-2 text-xs text-slate-500">No questions found.</li>
                            ) : results.map((item) => (
                                <li key={item.id}>
                                    <button
                                        type="button"
                                        onClick={() => { onSelect({ id: item.id, type, source: "platform", title: item.title }); setOpen(false); }}
                                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-lc-hover"
                                    >
                                        <span className="truncate font-semibold">{item.title}</span>
                                        {item.difficulty && <span className="shrink-0 text-[11px] font-bold uppercase text-slate-400">{item.difficulty}</span>}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
}

// ── Phase card on the live timeline ──

function PhaseCard({ phase, index, bank, token, onBank }: {
    phase: DraftPhase;
    index: number;
    dimensions: DraftRubricDimension[];
    bank: BankQuestionRef | null;
    token?: string;
    onBank: (ref: BankQuestionRef | null) => void;
}) {
    const meta = PHASE_META[phase.type] ?? PHASE_META.custom;
    const bankType = bankTypeForPhase(phase.type);
    const [showDetails, setShowDetails] = useState(false);
    const signals = phase.questions.flatMap((q) => q.expectedPoints.map((p) => p.text)).filter(Boolean);

    return (
        <li className="group rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,0.05)] transition hover:border-slate-300 hover:shadow-[0_6px_20px_rgba(16,24,40,0.08)] dark:border-lc-border dark:bg-lc-surface">
            <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-2.5">
                    <span className={`material-symbols-outlined mt-0.5 text-[20px] ${meta.accent}`}>{meta.icon}</span>
                    <div className="min-w-0">
                        <h4 className="font-nunito text-[17px] font-extrabold leading-tight text-slate-900 dark:text-white">
                            <span className="text-slate-300 dark:text-slate-500">{index + 1}.</span> {meta.name}
                        </h4>
                        {meta.subtitle && <p className="mt-0.5 text-xs font-semibold text-slate-400">{meta.subtitle}</p>}
                    </div>
                </div>
                <span className="shrink-0 whitespace-nowrap text-sm font-bold text-slate-400">~{phase.durationMinutes} min</span>
            </div>

            <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">{meta.blurb}</p>

            {signals.length > 0 && (
                <div className="mt-3">
                    <button type="button" onClick={() => setShowDetails((s) => !s)} className="inline-flex items-center gap-0.5 text-xs font-extrabold text-primary hover:underline">
                        What we look for
                        <span className={`material-symbols-outlined text-[16px] transition-transform ${showDetails ? "rotate-90" : ""}`}>chevron_right</span>
                    </button>
                    {showDetails && (
                        <ul className="mt-2 space-y-1 rounded-xl bg-slate-50 p-3 dark:bg-lc-bg">
                            {signals.map((t, i) => (
                                <li key={i} className="flex gap-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
                                    <span className="text-slate-300">–</span>{t}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}

            {bankType && (
                <MiniBankPicker type={bankType} token={token} value={bank} onSelect={onBank} />
            )}
        </li>
    );
}

// ── Flatten a draft into the /setup payload ──

function flattenToSetupPayload(
    draft: DraftBlueprint,
    bankByPhase: Record<string, BankQuestionRef | null>,
    schedule: { startAt: string; endAt: string; candidateMessage: string; allowRetake: boolean }
) {
    const rubric = draft.rubricDimensions.map((d) => ({
        id: d.id,
        label: d.label,
        weight: Number(d.weight) || 0,
        competencyTags: d.competencyTags.length ? d.competencyTags : [d.id],
    }));

    const questions = draft.phases.flatMap((phase) =>
        phase.questions.map((q) => {
            const tagFor = (p: { rubricDimensionId?: string | null }) => p.rubricDimensionId || rubric[0]?.id || "custom";
            const expectedPoints = (q.expectedPoints.length
                ? q.expectedPoints
                : [{ id: "point_1", text: "Concrete, relevant evidence in the candidate response." }]
            ).map((p, i) => ({
                id: p.id || `point_${i + 1}`,
                text: p.text || "Concrete, relevant evidence in the candidate response.",
                competencyTags: [tagFor(p)],
            }));
            const tags = Array.from(new Set(expectedPoints.flatMap((p) => p.competencyTags)));
            const bank = phaseNeedsBank(phase.type) ? bankByPhase[phase.id] ?? null : q.bankQuestion ?? null;
            return {
                id: q.id,
                prompt: q.prompt || "",
                category: CATEGORY_FOR_PHASE[phase.type],
                competencyTags: tags.length ? tags : ["custom"],
                expectedPoints,
                bankQuestion: bank,
                followUpPolicy: {
                    maxFollowUps: Math.max(0, Math.min(2, Number(q.followUpPolicy?.maxFollowUps ?? 2))),
                    askEdgeCases: true,
                    askOptimization: false,
                    askOwnershipVerification: true,
                    askImpact: true,
                    askTechnicalDepth: true,
                },
            };
        })
    );

    // Merge the recruiter-attached bank refs back into the blueprint so per-phase
    // durations + phase order survive the save (the server passes this through).
    const blueprint: DraftBlueprint = {
        ...draft,
        phases: draft.phases.map((phase) => ({
            ...phase,
            questions: phase.questions.map((q) => ({
                ...q,
                bankQuestion: phaseNeedsBank(phase.type) ? bankByPhase[phase.id] ?? q.bankQuestion ?? null : q.bankQuestion ?? null,
            })),
        })),
    };

    return {
        title: draft.title || "AI screening interview",
        startAt: new Date(schedule.startAt).toISOString(),
        endAt: new Date(schedule.endAt).toISOString(),
        durationMinutes: draft.durationMinutes,
        candidateInstructions: "",
        candidateMessage: schedule.candidateMessage,
        identityCheckLevel: "medium" as const,
        requireFullscreen: true,
        requireCamera: true,
        requireMicrophone: true,
        allowRetake: schedule.allowRetake,
        rubric,
        questions,
        blueprint,
    };
}

// ── Agent "working" panel (streamed status steps) ──

type StatusStep = { text: string; emphasis?: string };

function GridDots({ className = "" }: { className?: string }) {
    return <span className={`material-symbols-outlined text-[18px] ${className}`}>apps</span>;
}

/** Renders a status line with the emphasized phrase marker-highlighted (Chakra-style). */
function HighlightedStatus({ text, emphasis }: { text: string; emphasis?: string }) {
    if (!emphasis || !text.includes(emphasis)) return <>{text}</>;
    const idx = text.indexOf(emphasis);
    return (
        <>
            {text.slice(0, idx)}
            <mark className="rounded-md bg-[#c6f24e] px-1.5 italic text-slate-900">{emphasis}</mark>
            {text.slice(idx + emphasis.length)}
        </>
    );
}

/** The right-panel agent animation: past steps as big headlines, current step as a live line. */
function WorkingPanel({ statuses, skills }: { statuses: StatusStep[]; skills: string[] }) {
    const headlines = statuses.slice(0, -1);
    const current = statuses[statuses.length - 1];
    return (
        <div className="flex min-h-full flex-col">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Building your interviewer</p>
            <div className="mt-6 space-y-4">
                {headlines.map((s, i) => (
                    <h2 key={i} className="font-nunito text-3xl font-extrabold leading-tight text-slate-900 dark:text-white sm:text-4xl">
                        <HighlightedStatus text={s.text} emphasis={s.emphasis} />
                    </h2>
                ))}
            </div>
            {skills.length > 0 && (
                <div className="mt-5 flex flex-wrap gap-2">
                    {skills.map((s, i) => (
                        <span key={i} className="rounded-full bg-[#c6f24e]/25 px-3 py-1 text-xs font-bold text-slate-700 ring-1 ring-[#c6f24e]/60 dark:text-slate-200">{s}</span>
                    ))}
                </div>
            )}
            <div className="mt-8 flex items-center gap-2 text-sm font-semibold text-slate-400">
                <GridDots className="animate-pulse" />
                {current ? `${current.text}…` : "Starting…"}
            </div>
        </div>
    );
}

// ── The builder ──

export function ScreeningBuilder({ activeInterview, onCancel, onSaved }: {
    activeInterview: ActiveInterview;
    onCancel: () => void;
    onSaved: (interview: unknown) => void;
}) {
    const { session } = useCompanyAuth();
    const token = session?.access_token;

    // Edit mode: if the recruiter already saved a setup, continue from that saved
    // blueprint instead of the blank "compose a new interviewer" state.
    const savedBlueprint = activeInterview.configured && activeInterview.blueprint?.phases?.length
        ? activeInterview.blueprint
        : null;

    const [jobDescription, setJobDescription] = useState("");
    const [messages, setMessages] = useState<ChatMessage[]>(
        () => savedBlueprint ? [{ role: "assistant", content: summarizeBlueprint(savedBlueprint) }] : []
    );
    const [draft, setDraft] = useState<DraftBlueprint | null>(savedBlueprint);
    // JD-specific clarification pointers — captured ONCE from the first generation and never
    // regenerated (no per-edit LLM cost). Combined with UNIVERSAL_CLARIFICATIONS for display.
    const [jdClarifications, setJdClarifications] = useState<string[]>([]);
    const [input, setInput] = useState("");
    const [bankByPhase, setBankByPhase] = useState<Record<string, BankQuestionRef | null>>(
        () => bankRefsFromBlueprint(savedBlueprint)
    );
    const [error, setError] = useState<string | null>(null);

    // Agentic streaming: the agent narrates each step ("Parses the JD" …) into
    // `statuses`, surfaces detected `skills`, then sends the final plan.
    // Editing a saved setup skips straight to the two-panel view (started=true).
    const [started, setStarted] = useState(Boolean(savedBlueprint));
    const [generating, setGenerating] = useState(false);
    const [statuses, setStatuses] = useState<StatusStep[]>([]);
    const [skills, setSkills] = useState<string[]>([]);

    const [startAt, setStartAt] = useState(() => toInputDateTime(activeInterview.startAt));
    const [endAt, setEndAt] = useState(() => toInputDateTime(activeInterview.endAt));
    const [candidateMessage, setCandidateMessage] = useState(activeInterview.candidateMessage || "");
    const [allowRetake, setAllowRetake] = useState(Boolean(activeInterview.allowRetake));
    const [saving, setSaving] = useState(false);
    // Once the design is approved the builder advances from "design" to "schedule".
    const [step, setStep] = useState<"design" | "schedule">("design");

    async function runAgentStream(nextMessages: ChatMessage[], jd: string) {
        if (!token) return;
        setGenerating(true);
        setError(null);
        setStatuses([]);
        setSkills([]);
        setMessages(nextMessages);
        try {
            await apiStream(
                `/companies/ai-interviews/${activeInterview.roundId}/config-agent/stream`,
                // Send the recruiter's attached bank questions with the draft so the
                // server keeps their picks (and doesn't re-randomize) on edits.
                { jobDescription: jd || null, messages: nextMessages, currentDraft: draft ? draftWithBankRefs(draft, bankByPhase) : null },
                (ev: any) => {
                    if (ev?.type === "status") {
                        setStatuses((prev) => [...prev, { text: String(ev.text || ""), emphasis: ev.emphasis ? String(ev.emphasis) : undefined }]);
                    } else if (ev?.type === "skills") {
                        setSkills(Array.isArray(ev.skills) ? ev.skills.map(String) : []);
                    } else if (ev?.type === "done") {
                        // Only refresh the timeline panel when the agent actually changed
                        // the plan (or there's no plan yet). A purely conversational turn
                        // ("why did you add X?") leaves the right panel untouched.
                        if (ev.planChanged !== false || !draft) {
                            setDraft(ev.draft);
                            // Capture the JD-specific pointers ONCE (first generation only); keep them
                            // fixed thereafter so later edits never trigger a regenerated question list.
                            setJdClarifications((prev) => prev.length ? prev : (Array.isArray(ev.suggestedQuestions) ? ev.suggestedQuestions.slice(0, 2) : prev));
                            // Reflect the server's auto-picked questions into the picker,
                            // without overwriting any the recruiter already chose/removed.
                            setBankByPhase((prev) => {
                                const merged = { ...prev };
                                for (const [phaseId, ref] of Object.entries(bankRefsFromBlueprint(ev.draft))) {
                                    if (!(phaseId in merged)) merged[phaseId] = ref;
                                }
                                return merged;
                            });
                        }
                        setMessages((cur) => [...cur, { role: "assistant", content: String(ev.reply || "") }]);
                    } else if (ev?.type === "error") {
                        setError(String(ev.message || "The assistant failed."));
                    }
                },
                token
            );
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "The assistant failed. Try again.");
        } finally {
            setGenerating(false);
        }
    }

    function generate() {
        const jd = jobDescription.trim();
        if (!jd || generating) return;
        setStarted(true);
        runAgentStream([{ role: "user", content: jd }], jd);
    }

    function send() {
        const text = input.trim();
        if (!text || generating) return;
        setInput("");
        runAgentStream([...messages, { role: "user", content: text }], jobDescription);
    }

    // Outstanding bank questions (server-flagged phases that still have no attached ref).
    const outstandingBank = draft
        ? draft.phases.filter((p) => phaseNeedsBank(p.type) && !bankByPhase[p.id]).map((p) => p.id)
        : [];
    // Design step is complete (can advance to scheduling) once every coding/SQL
    // phase has a bank question. Publishing additionally needs a schedule window.
    const canContinue = Boolean(draft && outstandingBank.length === 0);
    const canPublish = Boolean(draft && startAt && endAt && !saving);

    async function finalize() {
        if (!token || !draft || !canPublish) return;
        setSaving(true);
        setError(null);
        try {
            const payload = flattenToSetupPayload(draft, bankByPhase, { startAt, endAt, candidateMessage, allowRetake });
            const result = await api.post<{ interview: unknown }>(
                `/companies/ai-interviews/${activeInterview.roundId}/setup`,
                payload,
                token
            );
            onSaved(result.interview);
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "Failed to save the screening.");
        } finally {
            setSaving(false);
        }
    }

    return (
        <main className="flex h-screen flex-col bg-white text-slate-950 dark:bg-lc-bg dark:text-white">
            {/* Top bar */}
            <div className="flex shrink-0 items-center gap-3 border-b border-slate-100 px-4 py-3 dark:border-lc-border sm:px-6">
                <button type="button" onClick={onCancel} className="grid size-9 shrink-0 place-items-center rounded-full text-slate-500 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-lc-hover">
                    <span className="material-symbols-outlined text-[20px]">arrow_back</span>
                </button>
                <span className="text-sm font-bold text-slate-500 dark:text-slate-300">AI Interviews</span>
            </div>

            {error && (
                <div className="shrink-0 border-b border-red-100 bg-red-50 px-6 py-2.5 text-sm font-bold text-red-600 dark:border-red-400/20 dark:bg-red-400/10">
                    {error}
                </div>
            )}

            {!started ? (
                // ── Compose: a centered, Claude-style empty state ──
                <div className="flex flex-1 flex-col items-center justify-center px-4">
                    <div className="w-full max-w-2xl">
                        <h1 className="text-center font-serif text-4xl font-semibold tracking-tight text-slate-900 dark:text-white sm:text-5xl">Create your interviewer</h1>
                        <p className="mt-3 text-center text-sm leading-6 text-slate-500 dark:text-slate-400">
                            Describe the role or paste your job description to get started with building your own screening interviewer
                        </p>
                        <div className="mt-8 flex items-end gap-2 rounded-[28px] border border-slate-200 bg-white px-5 py-4 shadow-[0_2px_14px_rgba(16,24,40,0.06)] transition focus-within:border-slate-300 focus-within:shadow-[0_6px_24px_rgba(16,24,40,0.10)] dark:border-lc-border dark:bg-lc-surface">
                            <GrowTextarea
                                value={jobDescription}
                                onChange={setJobDescription}
                                onSubmit={generate}
                                placeholder="Describe the role or paste your job description here…"
                                className="max-h-56 min-h-7 flex-1 resize-none overflow-y-auto bg-transparent text-base leading-7 text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-100"
                                autoFocus
                            />
                            <button type="button" onClick={generate} disabled={!jobDescription.trim()} className="grid size-9 shrink-0 place-items-center rounded-full text-slate-400 transition hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-lc-hover">
                                <span className="material-symbols-outlined">send</span>
                            </button>
                        </div>
                    </div>
                </div>
            ) : (
                // ── Two-panel: conversation (left) + working/timeline/schedule (right) ──
                <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2">
                    {/* LEFT: conversation */}
                    <section className="flex min-h-0 flex-col border-r border-slate-100 dark:border-lc-border">
                        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-6 sm:px-8">
                            {messages.map((m, i) => (
                                m.role === "user" ? (
                                    <div key={i} className="flex justify-end">
                                        <div className="max-h-[40vh] max-w-[88%] overflow-y-auto whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-slate-100 px-4 py-2.5 text-sm leading-6 text-slate-800 dark:bg-lc-surface dark:text-slate-100">
                                            {m.content}
                                        </div>
                                    </div>
                                ) : (
                                    <div key={i} className="flex gap-2.5">
                                        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                                            <span className="material-symbols-outlined text-[16px]">auto_awesome</span>
                                        </span>
                                        <div className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm leading-7 text-slate-700 dark:text-slate-200">
                                            {m.content}
                                        </div>
                                    </div>
                                )
                            ))}
                            {generating && (
                                <div className="flex items-center gap-2 text-sm font-semibold text-slate-400">
                                    <GridDots className="animate-pulse" /> Thinking…
                                </div>
                            )}
                            {!generating && draft && (
                                <div className="space-y-4 border-t border-slate-100 pt-4 dark:border-lc-border">
                                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-500 dark:text-slate-300">
                                        <GridDots /> Interview plan created successfully!
                                    </div>
                                    <div>
                                        <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">To tailor this screen, tell me</p>
                                        <ul className="mt-2 space-y-1.5">
                                            {[...UNIVERSAL_CLARIFICATIONS, ...jdClarifications].map((q, i) => (
                                                <li key={i} className="flex items-start gap-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                                                    <span className="material-symbols-outlined mt-0.5 text-[16px] text-slate-300">help</span>{q}
                                                </li>
                                            ))}
                                        </ul>
                                        <p className="mt-2 text-xs italic text-slate-400">Answer any of these in the chat below and I&apos;ll refine the screen for you.</p>
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="shrink-0 border-t border-slate-100 p-3 dark:border-lc-border">
                            <div className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 transition focus-within:border-primary focus-within:shadow-[0_0_0_3px_rgba(74,124,255,0.12)] dark:border-lc-border dark:bg-lc-surface">
                                <GrowTextarea
                                    value={input}
                                    onChange={setInput}
                                    onSubmit={send}
                                    placeholder="Make any edits to the interviewer here…"
                                    className="max-h-32 min-h-7 flex-1 resize-none overflow-y-auto bg-transparent text-sm leading-6 text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-100"
                                />
                                <button type="button" onClick={send} disabled={!input.trim() || generating} className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-white transition disabled:opacity-40">
                                    <span className="material-symbols-outlined text-[18px]">arrow_upward</span>
                                </button>
                            </div>
                        </div>
                    </section>

                    {/* RIGHT: agent working animation, then the timeline / schedule */}
                    <section className="min-h-0 overflow-y-auto bg-gradient-to-b from-[#eef4ff] via-[#f6f9ff] to-white px-6 py-8 dark:from-lc-surface dark:via-lc-surface dark:to-lc-bg sm:px-10">
                        {generating && !draft ? (
                            // First build: narrate the agent's work. On later edits we keep the
                            // existing timeline on screen (no flash) and just show "Thinking…" in chat.
                            <WorkingPanel statuses={statuses} skills={skills} />
                        ) : draft && step === "design" ? (
                            <div>
                                <p className="text-xs font-semibold text-slate-400">Ask for any modifications in the chat</p>
                                <div className="mt-1 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
                                    <h2 className="font-nunito text-2xl font-extrabold leading-tight text-slate-900 dark:text-white sm:text-3xl">Here&apos;s a timeline of your interviewer</h2>
                                    <span className="text-xs font-semibold text-slate-400">~{draft.durationMinutes} min · {draft.phases.length} phase{draft.phases.length === 1 ? "" : "s"}</span>
                                </div>
                                <div className="mt-2.5 flex flex-wrap gap-1.5">
                                    {draft.rubricDimensions.map((d) => (
                                        <span key={d.id} className="rounded-full bg-white/70 px-2.5 py-1 text-[11px] font-bold text-slate-500 ring-1 ring-slate-200/70 dark:bg-white/5 dark:text-slate-300 dark:ring-lc-border">
                                            {d.label} {d.weight}%
                                        </span>
                                    ))}
                                </div>

                                <ol className="mt-5 space-y-3.5">
                                    {draft.phases.map((phase, i) => (
                                        <PhaseCard
                                            key={phase.id}
                                            phase={phase}
                                            index={i}
                                            dimensions={draft.rubricDimensions}
                                            token={token}
                                            bank={bankByPhase[phase.id] ?? null}
                                            onBank={(ref) => setBankByPhase((prev) => ({ ...prev, [phase.id]: ref }))}
                                        />
                                    ))}
                                </ol>

                                <div className="mt-6 pb-2">
                                    {outstandingBank.length > 0 && (
                                        <p className="mb-3 text-right text-xs font-bold text-amber-600">
                                            Attach a question-bank item to every coding / SQL phase to continue.
                                        </p>
                                    )}
                                    <div className="flex items-center justify-end gap-3">
                                        <button type="button" onClick={onCancel} className="rounded-full bg-white px-5 py-2.5 text-sm font-extrabold text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50 dark:bg-lc-surface dark:text-slate-200 dark:ring-lc-border">
                                            Cancel
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setStep("schedule")}
                                            disabled={!canContinue}
                                            className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-6 py-2.5 text-sm font-extrabold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-40 dark:bg-primary dark:hover:bg-primary/90"
                                        >
                                            Looks good — continue
                                            <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ) : draft ? (
                            // ── Schedule & access ──
                            <div className="mx-auto w-full max-w-xl space-y-5">
                                <button type="button" onClick={() => setStep("design")} className="inline-flex items-center gap-1.5 text-sm font-extrabold text-primary">
                                    <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                                    Back to edit the screening
                                </button>

                                <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-lc-border dark:bg-lc-surface">
                                    <h2 className="font-nunito text-xl font-extrabold">{draft.title}</h2>
                                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                                        {draft.phases.length} phase{draft.phases.length === 1 ? "" : "s"} · ~{draft.durationMinutes} min total
                                    </p>
                                    <ol className="mt-3 space-y-1.5">
                                        {draft.phases.map((phase, i) => (
                                            <li key={phase.id} className="flex items-center gap-2 text-sm">
                                                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-slate-100 text-[11px] font-extrabold text-slate-600 dark:bg-white/5 dark:text-slate-200">{i + 1}</span>
                                                <span className="font-bold">{phase.title}</span>
                                                <span className="text-xs font-semibold text-slate-400">~{phase.durationMinutes} min</span>
                                            </li>
                                        ))}
                                    </ol>
                                </div>

                                <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-lc-border dark:bg-lc-surface">
                                    <h3 className="text-sm font-extrabold">Schedule &amp; access</h3>
                                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                        <label className="block">
                                            <span className="text-xs font-extrabold text-slate-600 dark:text-slate-300">Opens at</span>
                                            <input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} className="input mt-1" />
                                        </label>
                                        <label className="block">
                                            <span className="text-xs font-extrabold text-slate-600 dark:text-slate-300">Closes at</span>
                                            <input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} className="input mt-1" />
                                        </label>
                                    </div>
                                    <label className="mt-3 block">
                                        <span className="text-xs font-extrabold text-slate-600 dark:text-slate-300">Message to candidates (optional)</span>
                                        <textarea value={candidateMessage} onChange={(e) => setCandidateMessage(e.target.value)} className="input mt-1 min-h-20" placeholder="Shown before they start the screening." />
                                    </label>
                                    <label className="mt-3 flex items-center gap-2 text-sm font-semibold">
                                        <input type="checkbox" checked={allowRetake} onChange={(e) => setAllowRetake(e.target.checked)} />
                                        Allow one retake
                                    </label>
                                    <div className="mt-5 flex items-center justify-end gap-3">
                                        <button type="button" onClick={() => setStep("design")} className="rounded-full border border-slate-300 bg-white px-5 py-2.5 text-sm font-extrabold dark:border-lc-border dark:bg-lc-surface">
                                            Back
                                        </button>
                                        <button
                                            type="button"
                                            onClick={finalize}
                                            disabled={!canPublish}
                                            className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 text-sm font-extrabold text-white disabled:opacity-50"
                                        >
                                            <span className="material-symbols-outlined text-[18px]">{saving ? "hourglass_top" : "rocket_launch"}</span>
                                            {saving ? "Publishing…" : "Publish screening"}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="flex min-h-full items-center justify-center text-center text-sm font-semibold text-slate-400">
                                Couldn&apos;t build the plan. Edit your request on the left and try again.
                            </div>
                        )}
                    </section>
                </div>
            )}
        </main>
    );
}
