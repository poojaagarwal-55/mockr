"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { humanizeProctoringEvent, type ProctoringEventRecord, type ProctoringSeverity } from "@interviewforge/shared";
import { useCompanyAuth } from "@/context/company-auth-context";
import { api, ApiError } from "@/lib/api";
import { ScreeningBuilder } from "./screening-builder";

// SDE-only template for now: resume/project, coding (IDE), CS + SQL.
type QuestionCategory = "resume" | "coding" | "cs_sql";

// Reference to an existing question-bank question used for coding/SQL phases.
type BankQuestionRef = {
    id: string;
    type: "dsa" | "sql";
    source: "platform" | "company";
    title?: string | null;
};

type RubricDimension = {
    id: string;
    label: string;
    weight: number | string;
    competencyTags: string[];
};

type ScreeningQuestion = {
    id: string;
    prompt: string;
    category: QuestionCategory;
    competencyTags: string[];
    expectedPoints: Array<{ id: string; text: string; competencyTags: string[] }>;
    bankQuestion?: BankQuestionRef | null;
    followUpPolicy: {
        maxFollowUps: number | string;
        askEdgeCases: boolean;
        askOptimization: boolean;
        askOwnershipVerification: boolean;
        /** Resume-phase focus: probe measurable impact. */
        askImpact?: boolean;
        /** Resume-phase focus: probe concrete technical decisions/tradeoffs. */
        askTechnicalDepth?: boolean;
    };
};

/** The bank question type a category expects, or null for non-IDE phases. */
function bankTypeForCategory(category: QuestionCategory): "dsa" | "sql" | null {
    if (category === "coding") return "dsa";
    if (category === "cs_sql") return "sql";
    return null;
}

type AiInterview = {
    id: string;
    roundId: string;
    jobId: string;
    jobTitle: string;
    companyName: string;
    status: string;
    configured: boolean;
    title: string;
    startAt?: string | null;
    endAt?: string | null;
    durationMinutes?: number | null;
    candidateInstructions?: string;
    candidateMessage?: string;
    identityCheckLevel?: "basic" | "medium" | "high";
    requireFullscreen?: boolean;
    requireCamera?: boolean;
    requireMicrophone?: boolean;
    allowRetake?: boolean;
    rubric: RubricDimension[];
    questions: ScreeningQuestion[];
    /** Saved, normalized blueprint (phases + durations) used to hydrate edit mode. */
    blueprint?: unknown;
    candidateCount: number;
    submittedCount: number;
    submissions: Array<{
        id: string;
        roundCandidateId?: string;
        candidateName: string;
        candidateEmail: string;
        status: string;
        score: number | null;
        integrityScore?: number | null;
        reviewDecision?: ReviewDecision;
        reviewedAt?: string | null;
        submittedAt?: string | null;
        evaluatedAt?: string | null;
    }>;
};

type ReviewDecision = "needs_review" | "advance" | "hold" | "reject";

type RecruiterReportDetail = {
    automatedEvaluation?: string;
    recommendation?: string;
    overallScore?: number;
    summary?: string;
    strengths?: string[];
    risks?: string[];
    recruiterFocus?: string[];
    dimensionScores?: Array<{
        dimensionId: string;
        label: string;
        weight: number;
        score: number;
        signal: string;
        evidence?: string[];
        risks?: string[];
        competencyTags?: string[];
    }>;
    integrity?: {
        score?: number | null;
        summary?: string;
    };
};

type AiSubmissionDetail = {
    submission: {
        id: string;
        roundCandidateId: string;
        candidate: {
            fullName: string;
            email: string;
            avatarUrl?: string | null;
        };
        status: string;
        submittedAt?: string | null;
        startedAt?: string | null;
        automatedEvaluation: "disabled" | string;
        report?: {
            overallScore: number;
            aiSummary?: string;
            rubricBreakdown?: unknown;
            detail?: RecruiterReportDetail | null;
            evaluatedAt?: string | null;
        } | null;
        humanReview: {
            decision: ReviewDecision;
            notes: string;
            rubricReview: Array<{ id: string; label?: string; rating?: number | null; notes?: string | null }>;
            reviewedAt?: string | null;
        };
    };
    interview: {
        title: string;
        jobTitle: string;
        durationMinutes?: number | null;
        rubric: RubricDimension[];
        questions: ScreeningQuestion[];
    };
    transcript: Array<{
        id: string;
        role: string;
        content: string;
        stage?: string | null;
        createdAt?: string | null;
    }>;
    typedAnswers: Array<{
        questionId: string;
        prompt: string;
        answer: string;
        answeredAt: string;
        phaseType?: string;
        followUpIndex?: number;
    }>;
    sessionQuestions: Array<{
        id: string;
        title?: string | null;
        category?: string | null;
        difficulty?: string | null;
        finalCode?: string | null;
        sampleAnswer?: string | null;
        askedAt?: string | null;
    }>;
    proctoring?: {
        sessionId: string;
        status: string;
        integrityScore?: number | null;
        eventCountsBySeverity: Record<string, number>;
        eventCountsByType: Record<string, number>;
        events: Array<{
            id: string;
            eventType: string;
            severity: ProctoringSeverity;
            payload: Record<string, unknown>;
            serverTimestamp?: string | null;
            triggeredTermination?: boolean;
        }>;
        snapshots: Array<{
            id: string;
            url: string;
            takenAt?: string | null;
            trigger: string;
        }>;
    } | null;
};

type SetupForm = {
    title: string;
    startAt: string;
    endAt: string;
    durationMinutes: string;
    candidateInstructions: string;
    candidateMessage: string;
    identityCheckLevel: "basic" | "medium" | "high";
    requireFullscreen: boolean;
    requireCamera: boolean;
    requireMicrophone: boolean;
    allowRetake: boolean;
    rubric: RubricDimension[];
    questions: ScreeningQuestion[];
};

// Start recruiters with a blank rubric and let them build it from suggestions.
const defaultRubric: RubricDimension[] = [];

// Quick-add presets surfaced in the "Suggested dimensions" dropdown. Adding the
// classic SDE set (first four) lands exactly on 100%.
const DIMENSION_PRESETS: Array<{ id: string; label: string; weight: number; competencyTags: string[]; hint: string }> = [
    { id: "technical_correctness", label: "Technical correctness", weight: 40, competencyTags: ["technical_depth", "correctness"], hint: "Are the solutions and explanations technically right?" },
    { id: "problem_solving", label: "Problem solving", weight: 30, competencyTags: ["reasoning", "problem_solving"], hint: "How they break down and approach unfamiliar problems." },
    { id: "communication", label: "Communication", weight: 20, competencyTags: ["communication", "clarity"], hint: "Can they explain their thinking clearly?" },
    { id: "ownership", label: "Ownership verification", weight: 10, competencyTags: ["ownership"], hint: "Did they personally do the work they claim?" },
    { id: "code_quality", label: "Code quality", weight: 0, competencyTags: ["code_quality", "testing"], hint: "Readable, maintainable, well-tested code." },
    { id: "system_design", label: "System design", weight: 0, competencyTags: ["system_design", "scalability"], hint: "Designing components, trade-offs, and scale." },
    { id: "data_structures", label: "DS & algorithms", weight: 0, competencyTags: ["data_structures", "algorithms"], hint: "Choosing the right structures and complexity." },
];

// Common competency-tag suggestions offered while typing tags on a dimension.
const COMPETENCY_SUGGESTIONS = [
    "technical_depth", "correctness", "reasoning", "problem_solving", "communication",
    "clarity", "ownership", "code_quality", "testing", "system_design", "scalability",
    "data_structures", "algorithms", "sql", "database_design", "debugging", "api_design",
    "collaboration", "product_sense",
];

const defaultQuestions: ScreeningQuestion[] = [
    {
        id: "q1",
        // Resume phase is auto-grounded on each candidate's resume — no authored prompt.
        prompt: "",
        category: "resume",
        competencyTags: ["ownership", "communication"],
        expectedPoints: [
            { id: "ownership", text: "Clearly separates personal contribution from team/tooling support.", competencyTags: ["ownership"] },
            { id: "technical_depth", text: "Explains implementation decisions with concrete technical detail.", competencyTags: ["technical_depth"] },
            { id: "impact", text: "Connects work to outcome, user value, metric, or verification method.", competencyTags: ["communication"] },
        ],
        followUpPolicy: {
            maxFollowUps: 2,
            askEdgeCases: false,
            askOptimization: false,
            askOwnershipVerification: true,
            askImpact: true,
            askTechnicalDepth: true,
        },
    },
];

const emptyResponse = { interviews: [] as AiInterview[] };

function toInputDateTime(value?: string | null) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const offset = date.getTimezoneOffset();
    const local = new Date(date.getTime() - offset * 60_000);
    return local.toISOString().slice(0, 16);
}

function toIsoDateTime(value: string) {
    return new Date(value).toISOString();
}

function formatDate(value?: string | null) {
    if (!value) return "Not scheduled";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Not scheduled";
    return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
    }).format(date);
}

function newSetupForm(interview?: AiInterview | null): SetupForm {
    const now = new Date();
    const start = new Date(now.getTime() + 60 * 60_000);
    const end = new Date(now.getTime() + 8 * 24 * 60 * 60_000);

    return {
        title: interview?.configured ? interview.title : "AI screening interview",
        startAt: toInputDateTime(interview?.startAt) || toInputDateTime(start.toISOString()),
        endAt: toInputDateTime(interview?.endAt) || toInputDateTime(end.toISOString()),
        durationMinutes: String(interview?.durationMinutes || 30),
        candidateInstructions: interview?.candidateInstructions || "",
        candidateMessage: interview?.candidateMessage || "",
        identityCheckLevel: interview?.identityCheckLevel || "medium",
        requireFullscreen: interview?.requireFullscreen ?? true,
        requireCamera: interview?.requireCamera ?? true,
        requireMicrophone: interview?.requireMicrophone ?? true,
        allowRetake: interview?.allowRetake ?? false,
        rubric: interview?.rubric?.length ? interview.rubric : defaultRubric,
        questions: interview?.questions?.length ? interview.questions.map(coerceLoadedQuestion) : defaultQuestions,
    };
}

/** Coerce a persisted question (possibly legacy shape) into the current SDE model. */
function coerceLoadedQuestion(raw: any, index: number): ScreeningQuestion {
    const rawCategory = String(raw?.category || "resume");
    const category: QuestionCategory =
        rawCategory === "coding" ? "coding"
            : (rawCategory === "cs_sql" || rawCategory === "cs_fundamentals" || rawCategory === "sql") ? "cs_sql"
                : "resume";
    const bank = raw?.bankQuestion && typeof raw.bankQuestion === "object" ? raw.bankQuestion : null;
    return {
        id: String(raw?.id || `q${index + 1}`),
        prompt: String(raw?.prompt || ""),
        category,
        competencyTags: Array.isArray(raw?.competencyTags) ? raw.competencyTags : ["custom"],
        expectedPoints: Array.isArray(raw?.expectedPoints) && raw.expectedPoints.length
            ? raw.expectedPoints.map((point: any, pointIndex: number) => ({
                id: String(point?.id || `point_${pointIndex + 1}`),
                text: String(point?.text || ""),
                competencyTags: Array.isArray(point?.competencyTags) ? point.competencyTags : ["custom"],
            }))
            : [{ id: "point_1", text: "", competencyTags: ["custom"] }],
        bankQuestion: bank
            ? { id: String(bank.id), type: bank.type === "sql" ? "sql" : "dsa", source: bank.source === "platform" ? "platform" : "company", title: bank.title || null }
            : null,
        followUpPolicy: {
            maxFollowUps: raw?.followUpPolicy?.maxFollowUps ?? 2,
            askEdgeCases: raw?.followUpPolicy?.askEdgeCases ?? true,
            askOptimization: raw?.followUpPolicy?.askOptimization ?? false,
            askOwnershipVerification: raw?.followUpPolicy?.askOwnershipVerification ?? true,
            askImpact: raw?.followUpPolicy?.askImpact ?? true,
            askTechnicalDepth: raw?.followUpPolicy?.askTechnicalDepth ?? true,
        },
    };
}

function questionGuidance(category: QuestionCategory) {
    switch (category) {
        case "resume":
            return {
                title: "Resume/project screening",
                prompt: "Use this as a screening brief. Tell the AI what to probe from the candidate's resume, projects, internships, or GitHub.",
                expected: "Evidence to look for, for example: candidate explains their own contribution, tradeoffs, impact, and verification.",
            };
        case "coding":
            return {
                title: "Coding screening (IDE)",
                prompt: "Select a coding question from the question bank below. The candidate solves it in an in-room IDE with run/submit. Use this field for any extra spoken framing the interviewer should add.",
                expected: "Expected solution approach, complexity, key edge cases, and optimization signals.",
            };
        case "cs_sql":
            return {
                title: "CS fundamentals + SQL",
                prompt: "Select a SQL question from the question bank below. The candidate writes and runs queries in an in-room SQL editor. Use this field for any extra spoken framing.",
                expected: "Canonical answer points, common mistakes, and follow-up concepts to probe.",
            };
        default:
            return {
                title: "Resume/project screening",
                prompt: "Use this as a screening brief for the AI interviewer.",
                expected: "Expected evidence or answer points.",
            };
    }
}

function normalizeForm(form: SetupForm) {
    return {
        ...form,
        startAt: toIsoDateTime(form.startAt),
        endAt: toIsoDateTime(form.endAt),
        durationMinutes: Number(form.durationMinutes),
        identityCheckLevel: "medium",
        requireFullscreen: true,
        requireCamera: true,
        requireMicrophone: true,
        rubric: form.rubric.map((dimension) => ({
            ...dimension,
            weight: Number(dimension.weight),
            competencyTags: dimension.competencyTags.filter(Boolean),
        })),
        questions: form.questions.map((question) => ({
            ...question,
            competencyTags: question.competencyTags.filter(Boolean),
            expectedPoints: question.expectedPoints.map((point) => ({
                ...point,
                competencyTags: point.competencyTags.filter(Boolean),
            })),
            followUpPolicy: {
                ...question.followUpPolicy,
                maxFollowUps: Number(question.followUpPolicy.maxFollowUps),
            },
        })),
    };
}

/** Normalize a free-typed tag into the snake_case token the backend expects. */
function normalizeTag(raw: string) {
    return raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

/** Chip-style multi-tag input with a typeahead suggestion dropdown. */
function TagInput({ tags, onChange, suggestions, placeholder }: {
    tags: string[];
    onChange: (tags: string[]) => void;
    suggestions: string[];
    placeholder?: string;
}) {
    const [input, setInput] = useState("");
    const [focused, setFocused] = useState(false);

    const addTag = (raw: string) => {
        const tag = normalizeTag(raw);
        if (!tag || tags.includes(tag)) {
            setInput("");
            return;
        }
        onChange([...tags, tag]);
        setInput("");
    };

    const removeTag = (tag: string) => onChange(tags.filter((item) => item !== tag));

    const query = normalizeTag(input);
    const available = suggestions
        .filter((suggestion) => !tags.includes(suggestion) && (!query || suggestion.includes(query)))
        .slice(0, 6);

    return (
        <div className="relative">
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2 focus-within:border-primary focus-within:shadow-[0_0_0_3px_rgba(74,124,255,0.16)] dark:border-lc-border dark:bg-lc-bg">
                {tags.map((tag) => (
                    <span key={tag} className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 py-1 pl-3 pr-1.5 text-xs font-extrabold text-primary">
                        {tag}
                        <button
                            type="button"
                            onClick={() => removeTag(tag)}
                            className="grid size-4 place-items-center rounded-full text-primary/70 hover:bg-primary/20 hover:text-primary"
                            aria-label={`Remove ${tag}`}
                        >
                            <span className="material-symbols-outlined text-[14px] leading-none">close</span>
                        </button>
                    </span>
                ))}
                <input
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setTimeout(() => setFocused(false), 120)}
                    onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === ",") {
                            event.preventDefault();
                            addTag(input);
                        } else if (event.key === "Backspace" && !input && tags.length) {
                            removeTag(tags[tags.length - 1]);
                        }
                    }}
                    placeholder={tags.length ? "" : (placeholder || "Type a tag and press Enter")}
                    className="min-w-[120px] flex-1 bg-transparent py-1 text-sm font-bold text-slate-900 outline-none placeholder:font-semibold placeholder:text-slate-400 dark:text-white"
                />
            </div>
            {focused && available.length > 0 && (
                <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg dark:border-lc-border dark:bg-lc-surface">
                    {available.map((suggestion) => (
                        <li key={suggestion}>
                            <button
                                type="button"
                                onMouseDown={(event) => { event.preventDefault(); addTag(suggestion); }}
                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-bold text-slate-700 hover:bg-primary/5 hover:text-primary dark:text-slate-200"
                            >
                                <span className="material-symbols-outlined text-[16px] text-slate-400">add</span>
                                {suggestion}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

/** Dimension-name field with an inline dropdown of suggested rubric dimensions. */
function DimensionNameField({ dimension, usedLabels, onLabelChange, onSelectPreset }: {
    dimension: RubricDimension;
    usedLabels: Set<string>;
    onLabelChange: (label: string) => void;
    onSelectPreset: (preset: typeof DIMENSION_PRESETS[number]) => void;
}) {
    const [open, setOpen] = useState(false);
    const query = dimension.label.trim().toLowerCase();
    const options = DIMENSION_PRESETS.filter((preset) =>
        !usedLabels.has(preset.label.toLowerCase()) &&
        (!query || query === preset.label.toLowerCase() || preset.label.toLowerCase().includes(query))
    );

    return (
        <div className="relative">
            <div className="relative">
                <input
                    value={dimension.label}
                    onChange={(event) => onLabelChange(event.target.value)}
                    onFocus={() => setOpen(true)}
                    onBlur={() => setTimeout(() => setOpen(false), 120)}
                    className="input pr-10"
                    placeholder="Pick a suggestion or type your own"
                />
                <button
                    type="button"
                    tabIndex={-1}
                    onMouseDown={(event) => { event.preventDefault(); setOpen((value) => !value); }}
                    className="absolute inset-y-0 right-0 grid w-10 place-items-center text-slate-400 hover:text-primary"
                    aria-label="Show suggested dimensions"
                >
                    <span className="material-symbols-outlined text-[20px]">{open ? "expand_less" : "expand_more"}</span>
                </button>
            </div>
            {open && options.length > 0 && (
                <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-slate-200 bg-white shadow-xl dark:border-lc-border dark:bg-lc-surface">
                    <li className="border-b border-slate-100 px-4 py-2 text-xs font-semibold leading-5 text-slate-500 dark:border-lc-border dark:text-slate-400">Each dimension is a scoring category, its weight decides how much it counts toward the final score.</li>
                    {options.map((preset) => (
                        <li key={preset.id}>
                            <button
                                type="button"
                                onMouseDown={(event) => { event.preventDefault(); onSelectPreset(preset); setOpen(false); }}
                                className="flex w-full flex-col gap-0.5 px-4 py-2.5 text-left hover:bg-primary/5"
                            >
                                <span className="flex items-center justify-between gap-2 text-sm font-extrabold text-slate-800 dark:text-slate-100">
                                    {preset.label}
                                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-extrabold text-primary">{preset.weight}%</span>
                                </span>
                                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{preset.hint}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

type BankDatasetQuestion = { id: string; title: string; difficulty?: string };

function BankQuestionPicker({ type, token, value, onSelect }: {
    type: "dsa" | "sql";
    token?: string;
    value: BankQuestionRef | null;
    onSelect: (ref: BankQuestionRef | null) => void;
}) {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState("");
    const [results, setResults] = useState<BankDatasetQuestion[]>([]);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    useEffect(() => {
        if (!open || !token) return;
        let active = true;
        setLoading(true);
        setErr(null);
        const handle = setTimeout(() => {
            const q = search.trim() ? `&search=${encodeURIComponent(search.trim())}` : "";
            api.get<{ questions: BankDatasetQuestion[] }>(`/companies/question-bank/${type}/dataset?limit=8${q}`, token)
                .then((res) => { if (active) setResults(res.questions || []); })
                .catch((e) => { if (active) setErr(e instanceof ApiError ? e.message : "Failed to load questions."); })
                .finally(() => { if (active) setLoading(false); });
        }, 300);
        return () => { active = false; clearTimeout(handle); };
    }, [open, search, token, type]);

    const label = type === "dsa" ? "coding" : "SQL";

    return (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-lc-border dark:bg-lc-bg">
            <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-extrabold uppercase tracking-[0.24em] text-primary">{label} question (required)</p>
                <button type="button" onClick={() => setOpen((o) => !o)} className="text-xs font-extrabold text-primary">
                    {open ? "Close" : value ? "Change" : "Choose from question bank"}
                </button>
            </div>
            {value ? (
                <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm dark:border-emerald-400/30 dark:bg-emerald-400/10">
                    <span className="truncate font-bold">{value.title || value.id}</span>
                    <button type="button" onClick={() => onSelect(null)} className="shrink-0 text-xs font-extrabold text-red-500">Remove</button>
                </div>
            ) : (
                <p className="mt-2 text-xs font-semibold text-amber-600">No question attached yet — the candidate needs one to open the {type === "dsa" ? "IDE" : "SQL editor"}.</p>
            )}
            {open && (
                <div className="mt-3">
                    <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${label} questions...`} className="input" />
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
                    <p className="mt-2 text-[11px] text-slate-500">Need a custom question? Create one in your question bank and it will appear here.</p>
                </div>
            )}
        </div>
    );
}

/**
 * Resume-phase config. The resume round is auto-grounded on each candidate's
 * real resume at runtime, so the recruiter sets focus (what to verify) + optional
 * framing instead of authoring a per-candidate question.
 */
function ResumePhaseConfig({ question, onToggle, onFramingChange }: {
    question: ScreeningQuestion;
    onToggle: (patch: Partial<ScreeningQuestion["followUpPolicy"]>) => void;
    onFramingChange: (value: string) => void;
}) {
    const policy = question.followUpPolicy;
    const toggles: Array<{ key: keyof ScreeningQuestion["followUpPolicy"]; label: string; hint: string }> = [
        { key: "askOwnershipVerification", label: "Verify ownership", hint: "What the candidate personally did vs. the team/tooling." },
        { key: "askImpact", label: "Probe impact & metrics", hint: "Measurable outcome, user value, or how they verified it." },
        { key: "askTechnicalDepth", label: "Probe technical depth", hint: "Concrete implementation decisions and tradeoffs." },
    ];
    return (
        <div className="mt-4 space-y-4">
            <div>
                <p className="text-xs font-extrabold text-slate-600 dark:text-slate-300">Evaluation focus</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                    {toggles.map((toggle) => {
                        const active = policy[toggle.key] !== false;
                        return (
                            <button
                                key={String(toggle.key)}
                                type="button"
                                onClick={() => onToggle({ [toggle.key]: !active } as Partial<ScreeningQuestion["followUpPolicy"]>)}
                                className={`flex flex-col gap-1 rounded-lg border p-3 text-left transition ${active ? "border-primary bg-primary/5 dark:bg-primary/10" : "border-slate-200 bg-white dark:border-lc-border dark:bg-lc-bg"}`}
                            >
                                <span className="flex items-center gap-2 text-sm font-extrabold">
                                    <span className={`material-symbols-outlined text-[18px] ${active ? "text-primary" : "text-slate-400"}`}>
                                        {active ? "check_circle" : "radio_button_unchecked"}
                                    </span>
                                    {toggle.label}
                                </span>
                                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{toggle.hint}</span>
                            </button>
                        );
                    })}
                </div>
            </div>
            <Field label="Extra framing for the AI (optional)">
                <textarea
                    value={question.prompt}
                    onChange={(event) => onFramingChange(event.target.value)}
                    className="input min-h-20"
                    placeholder="Optional: role-specific emphasis, e.g. 'favor backend / distributed-systems projects' or 'focus on production ownership'."
                />
            </Field>
        </div>
    );
}

function StatusPill({ status, configured }: { status: string; configured: boolean }) {
    const tone = !configured
        ? "bg-amber-100 text-amber-700 dark:bg-amber-400/10 dark:text-amber-200"
        : status === "live"
            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200"
            : "bg-slate-100 text-slate-600 dark:bg-lc-hover dark:text-slate-200";

    return (
        <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-extrabold capitalize ${tone}`}>
            {configured ? status : "setup needed"}
        </span>
    );
}

function decisionLabel(decision?: ReviewDecision | null) {
    if (decision === "advance") return "Advance";
    if (decision === "hold") return "Hold";
    if (decision === "reject") return "Reject";
    return "Needs review";
}

function decisionClass(decision?: ReviewDecision | null) {
    if (decision === "advance") return "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300";
    if (decision === "reject") return "bg-red-50 text-red-700 dark:bg-red-400/10 dark:text-red-300";
    if (decision === "hold") return "bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-200";
    return "bg-slate-100 text-slate-600 dark:bg-lc-hover dark:text-slate-300";
}

function reviewRowFor(detail: AiSubmissionDetail | null, rubric: RubricDimension) {
    return detail?.submission.humanReview.rubricReview.find((row) => row.id === rubric.id) || {
        id: rubric.id,
        label: rubric.label,
        rating: null,
        notes: "",
    };
}

export function AiInterviewsWorkspace() {
    const { session } = useCompanyAuth();
    const [interviews, setInterviews] = useState<AiInterview[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [activeInterview, setActiveInterview] = useState<AiInterview | null>(null);
    const [reviewTarget, setReviewTarget] = useState<{ interview: AiInterview; submissionId: string } | null>(null);
    const [reviewDetail, setReviewDetail] = useState<AiSubmissionDetail | null>(null);
    const [reviewLoading, setReviewLoading] = useState(false);
    const [reviewSaving, setReviewSaving] = useState(false);
    const [reportRegenerating, setReportRegenerating] = useState(false);
    const [reviewError, setReviewError] = useState<string | null>(null);

    useEffect(() => {
        let mounted = true;
        if (!session?.access_token) {
            setLoading(false);
            return;
        }

        setLoading(true);
        api.get<typeof emptyResponse>("/companies/ai-interviews", session.access_token)
            .then((payload) => {
                if (mounted) setInterviews(payload.interviews || []);
            })
            .catch((err) => {
                if (mounted) setError(err instanceof ApiError ? err.message : "Failed to load AI screening rounds.");
            })
            .finally(() => {
                if (mounted) setLoading(false);
            });

        return () => {
            mounted = false;
        };
    }, [session?.access_token]);

    const totalCandidates = useMemo(
        () => interviews.reduce((sum, interview) => sum + interview.candidateCount, 0),
        [interviews]
    );

    const totalSubmitted = useMemo(
        () => interviews.reduce((sum, interview) => sum + interview.submittedCount, 0),
        [interviews]
    );

    const needsSetup = useMemo(
        () => interviews.filter((interview) => !interview.configured).length,
        [interviews]
    );

    function openSetup(interview: AiInterview) {
        setActiveInterview(interview);
        setError(null);
    }

    async function openReview(interview: AiInterview, submissionId: string) {
        if (!session?.access_token) return;
        setReviewTarget({ interview, submissionId });
        setReviewDetail(null);
        setReviewError(null);
        setReviewLoading(true);

        try {
            const payload = await api.get<{ detail: AiSubmissionDetail }>(
                `/companies/ai-interviews/${interview.roundId}/submissions/${submissionId}`,
                session.access_token
            );
            setReviewDetail(payload.detail);
        } catch (err) {
            setReviewError(err instanceof ApiError ? err.message : "Failed to load screening review.");
        } finally {
            setReviewLoading(false);
        }
    }

    function closeReview() {
        setReviewTarget(null);
        setReviewDetail(null);
        setReviewError(null);
        setReportRegenerating(false);
    }

    function updateHumanDecision(decision: ReviewDecision) {
        setReviewDetail((current) => current ? {
            ...current,
            submission: {
                ...current.submission,
                humanReview: {
                    ...current.submission.humanReview,
                    decision,
                },
            },
        } : current);
    }

    function updateHumanNotes(notes: string) {
        setReviewDetail((current) => current ? {
            ...current,
            submission: {
                ...current.submission,
                humanReview: {
                    ...current.submission.humanReview,
                    notes,
                },
            },
        } : current);
    }

    function updateRubricReview(rubric: RubricDimension, patch: { rating?: number | null; notes?: string }) {
        setReviewDetail((current) => {
            if (!current) return current;
            const existing = current.submission.humanReview.rubricReview;
            const nextRow = {
                ...reviewRowFor(current, rubric),
                ...patch,
                id: rubric.id,
                label: rubric.label,
            };
            const next = existing.some((row) => row.id === rubric.id)
                ? existing.map((row) => row.id === rubric.id ? nextRow : row)
                : [...existing, nextRow];
            return {
                ...current,
                submission: {
                    ...current.submission,
                    humanReview: {
                        ...current.submission.humanReview,
                        rubricReview: next,
                    },
                },
            };
        });
    }

    async function saveHumanReview() {
        if (!session?.access_token || !reviewTarget || !reviewDetail || reviewSaving) return;
        setReviewSaving(true);
        setReviewError(null);

        try {
            const payload = await api.post<{ humanReview: AiSubmissionDetail["submission"]["humanReview"] }>(
                `/companies/ai-interviews/${reviewTarget.interview.roundId}/submissions/${reviewTarget.submissionId}/review`,
                {
                    decision: reviewDetail.submission.humanReview.decision,
                    notes: reviewDetail.submission.humanReview.notes,
                    rubricReview: reviewDetail.submission.humanReview.rubricReview,
                },
                session.access_token
            );
            setReviewDetail({
                ...reviewDetail,
                submission: {
                    ...reviewDetail.submission,
                    humanReview: payload.humanReview,
                },
            });
            setInterviews((current) => current.map((interview) => interview.roundId === reviewTarget.interview.roundId ? {
                ...interview,
                submissions: interview.submissions.map((submission) => submission.id === reviewTarget.submissionId ? {
                    ...submission,
                    reviewDecision: payload.humanReview.decision,
                    reviewedAt: payload.humanReview.reviewedAt,
                } : submission),
            } : interview));
        } catch (err) {
            setReviewError(err instanceof ApiError ? err.message : "Failed to save human review.");
        } finally {
            setReviewSaving(false);
        }
    }

    async function regenerateReport() {
        if (!session?.access_token || !reviewTarget || !reviewDetail || reportRegenerating) return;
        setReportRegenerating(true);
        setReviewError(null);

        try {
            const payload = await api.post<{ report: NonNullable<AiSubmissionDetail["submission"]["report"]> }>(
                `/companies/ai-interviews/${reviewTarget.interview.roundId}/submissions/${reviewTarget.submissionId}/regenerate-report`,
                {},
                session.access_token
            );
            setReviewDetail({
                ...reviewDetail,
                submission: {
                    ...reviewDetail.submission,
                    report: payload.report,
                    automatedEvaluation: payload.report.detail?.automatedEvaluation || reviewDetail.submission.automatedEvaluation,
                },
            });
        } catch (err) {
            setReviewError(err instanceof ApiError ? err.message : "Failed to regenerate screening report.");
        } finally {
            setReportRegenerating(false);
        }
    }

    if (reviewTarget) {
        return (
            <AiScreeningReviewModal
                detail={reviewDetail}
                loading={reviewLoading}
                error={reviewError}
                saving={reviewSaving}
                onClose={closeReview}
                onDecisionChange={updateHumanDecision}
                onNotesChange={updateHumanNotes}
                onRubricReviewChange={updateRubricReview}
                onSave={saveHumanReview}
                onRegenerateReport={regenerateReport}
                reportRegenerating={reportRegenerating}
            />
        );
    }

    if (activeInterview) {
        return (
            <ScreeningBuilder
                activeInterview={{
                    roundId: activeInterview.roundId,
                    jobTitle: activeInterview.jobTitle,
                    configured: activeInterview.configured,
                    blueprint: (activeInterview.blueprint as any) ?? null,
                    startAt: activeInterview.startAt,
                    endAt: activeInterview.endAt,
                    candidateMessage: activeInterview.candidateMessage,
                    allowRetake: activeInterview.allowRetake,
                }}
                onCancel={() => setActiveInterview(null)}
                onSaved={(interview) => {
                    const updated = interview as AiInterview;
                    setInterviews((current) => current.map((i) => (i.roundId === updated.roundId ? updated : i)));
                    setActiveInterview(null);
                }}
            />
        );
    }

    return (
        <main className="min-h-screen bg-[#f4f7fb] px-4 py-6 text-slate-950 dark:bg-lc-bg dark:text-white sm:px-6 lg:px-8">
            <div className="mx-auto flex max-w-6xl flex-col gap-6">
                <header className="flex flex-col gap-5 border-b border-slate-200 pb-6 dark:border-lc-border lg:flex-row lg:items-end lg:justify-between">
                    <div>
                        <p className="text-xs font-extrabold uppercase tracking-[0.32em] text-primary">Initial Screening</p>
                        <h1 className="mt-2 font-nunito text-3xl font-extrabold tracking-normal">AI Interviewer Setup</h1>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500 dark:text-slate-400">
                            Configure screening rounds for each hiring pipeline. Manage questions, rubric weights, and integrity settings.
                        </p>
                    </div>
                    <div className="grid grid-cols-3 gap-3 sm:min-w-[420px]">
                        <Metric label="Total Screenings" value={String(interviews.length)} />
                        <Metric label="Need Setup" value={String(needsSetup)} />
                        <Metric label="Submitted" value={String(totalSubmitted)} />
                    </div>
                </header>

                {error && (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-200">
                        {error}
                    </div>
                )}

                {loading ? (
                    <div className="grid min-h-[360px] place-items-center rounded-lg border border-slate-200 bg-white dark:border-lc-border dark:bg-lc-surface">
                        <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
                    </div>
                ) : interviews.length === 0 ? (
                    <section className="grid min-h-[320px] place-items-center rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center dark:border-lc-border dark:bg-lc-surface">
                        <div>
                            <span className="material-symbols-outlined text-5xl text-slate-400">smart_toy</span>
                            <h2 className="mt-3 font-nunito text-2xl font-extrabold">No AI interviewer screenings yet</h2>
                            <p className="mt-2 max-w-xl text-sm font-semibold text-slate-500 dark:text-slate-400">
                                Move candidates to AI based interview from the Jobs candidate list. Their setup-required round will appear here.
                            </p>
                        </div>
                    </section>
                ) : (
                    <section className="grid gap-5">
                        {interviews.map((interview) => (
                            <article key={interview.roundId} className="overflow-hidden rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-lc-border dark:bg-lc-surface">
                                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <StatusPill status={interview.status} configured={interview.configured} />
                                            <span className="text-[11px] font-extrabold uppercase tracking-[0.28em] text-slate-500 dark:text-slate-400">{interview.companyName}</span>
                                        </div>
                                        <h2 className="mt-7 truncate font-nunito text-xl font-extrabold">{interview.jobTitle}</h2>
                                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{interview.title}</p>
                                        <div className="mt-5 flex flex-wrap gap-3 text-xs font-medium text-slate-600 dark:text-slate-300">
                                            <InfoChip icon="calendar_today" label={formatDate(interview.startAt)} />
                                            <InfoChip icon="timer" label={`${interview.durationMinutes || 0} min`} />
                                            <InfoChip icon="quiz" label={`${interview.questions.length} questions`} />
                                            <InfoChip icon="rule" label={`${interview.rubric.length} rubric dimensions`} />
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        <button
                                            type="button"
                                            onClick={() => openSetup(interview)}
                                            className="inline-flex h-11 items-center gap-2 rounded-full bg-primary px-4 text-sm font-extrabold text-white shadow-sm hover:bg-primary/90"
                                        >
                                            <span className="material-symbols-outlined text-[18px]">{interview.configured ? "edit" : "settings"}</span>
                                            {interview.configured ? "Edit setup" : "Set up"}
                                        </button>
                                    </div>
                                </div>

                                <div className="mt-6 grid border-t border-slate-200 pt-5 dark:border-lc-border sm:grid-cols-3">
                                    <InlineMetric label="Assigned candidates" value={String(interview.candidateCount)} />
                                    <InlineMetric label="Submitted attempts" value={String(interview.submittedCount)} />
                                    <InlineMetric label="Pending" value={String(Math.max(interview.candidateCount - interview.submittedCount, 0))} />
                                </div>

                                {interview.submissions.length > 0 && (
                                    <div className="m-5 mt-0 overflow-hidden rounded-lg border border-slate-200 dark:border-lc-border">
                                        {interview.submissions.slice(0, 5).map((submission) => (
                                            <div key={submission.id} className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0 dark:border-lc-border sm:flex-row sm:items-center sm:justify-between">
                                                <div>
                                                    <p className="text-sm font-extrabold">{submission.candidateName}</p>
                                                    <p className="text-xs font-semibold text-slate-500">{submission.candidateEmail}</p>
                                                </div>
                                                <div className="flex items-center gap-3 sm:justify-end">
                                                    <div className="text-left sm:text-right">
                                                        <span className={`inline-flex rounded-full px-3 py-1 text-xs font-extrabold ${decisionClass(submission.reviewDecision)}`}>
                                                            {decisionLabel(submission.reviewDecision)}
                                                        </span>
                                                        <p className="mt-1 text-xs font-semibold text-slate-500">
                                                            {submission.submittedAt ? `Submitted ${formatDate(submission.submittedAt)}` : submission.status}
                                                        </p>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => openReview(interview, submission.roundCandidateId || submission.id)}
                                                        className="inline-flex h-9 items-center gap-2 rounded-full border border-primary px-3 text-xs font-extrabold text-primary hover:bg-primary/5"
                                                    >
                                                        <span className="material-symbols-outlined text-[16px]">fact_check</span>
                                                        Review
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </article>
                        ))}
                    </section>
                )}
            </div>
        </main>
    );
}

function AiScreeningReviewModal({
    detail,
    loading,
    error,
    saving,
    onClose,
    onDecisionChange,
    onNotesChange,
    onRubricReviewChange,
    onSave,
    onRegenerateReport,
    reportRegenerating,
}: {
    detail: AiSubmissionDetail | null;
    loading: boolean;
    error: string | null;
    saving: boolean;
    onClose: () => void;
    onDecisionChange: (decision: ReviewDecision) => void;
    onNotesChange: (notes: string) => void;
    onRubricReviewChange: (rubric: RubricDimension, patch: { rating?: number | null; notes?: string }) => void;
    onSave: () => void;
    onRegenerateReport: () => void;
    reportRegenerating: boolean;
}) {
    const proctoring = detail?.proctoring;
    const eventCount = proctoring?.events.length || 0;
    const snapshotCount = proctoring?.snapshots.length || 0;
    const [activeEvidenceTab, setActiveEvidenceTab] = useState<"transcript" | "questions" | "integrity" | "snapshots" | "artifacts">("transcript");
    const highAttentionEvents = proctoring?.events.filter((event) => event.severity === "high" || event.severity === "critical").length || 0;
    const transcriptCount = detail?.transcript.length || 0;
    const artifactCount = detail?.sessionQuestions.length || 0;
    const report = detail?.submission.report?.detail || null;
    const reportStatus = report?.automatedEvaluation === "generated"
        ? "LLM generated"
        : report?.automatedEvaluation === "deterministic_fallback"
            ? "Deterministic test report"
            : detail?.submission.report
                ? "Generated report"
                : "Pending report";
    const evidenceTabs: Array<{ id: typeof activeEvidenceTab; label: string; count: number }> = [
        { id: "transcript", label: "Transcript", count: transcriptCount },
        { id: "questions", label: "Configured questions", count: detail?.interview.questions.length || 0 },
        { id: "integrity", label: "Integrity timeline", count: eventCount },
        { id: "snapshots", label: "Snapshots", count: snapshotCount },
        { id: "artifacts", label: "Artifacts", count: artifactCount },
    ];

    return (
        <main className="min-h-screen bg-[#f4f7fb] px-4 py-6 text-slate-950 dark:bg-lc-bg dark:text-white sm:px-6 lg:px-8">
            <div className="mx-auto flex max-w-[1680px] flex-col gap-6">
                <header className="border-b border-slate-200 pb-6 dark:border-lc-border">
                    <div className="flex items-start gap-4">
                        <button type="button" onClick={onClose} className="mt-1 grid size-10 shrink-0 place-items-center rounded-full bg-white text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-lc-surface dark:text-white dark:ring-lc-border dark:hover:bg-lc-hover">
                            <span className="material-symbols-outlined">arrow_back</span>
                        </button>
                        <div className="min-w-0">
                            <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary">Recruiter review</p>
                            <h1 className="mt-2 font-nunito text-4xl font-extrabold leading-tight">
                                {detail?.submission.candidate.fullName || "AI screening submission"}
                            </h1>
                            {detail && (
                                <p className="mt-2 text-sm font-semibold text-slate-500 dark:text-slate-400">
                                    {detail.submission.candidate.email} - {detail.interview.jobTitle}
                                </p>
                            )}
                        </div>
                    </div>
                </header>

                {loading ? (
                    <div className="grid min-h-[420px] place-items-center rounded-lg border border-slate-200 bg-white dark:border-lc-border dark:bg-lc-surface">
                        <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
                    </div>
                ) : !detail ? (
                    <div className="p-6">
                        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-200">
                            {error || "Could not load this screening submission."}
                        </div>
                    </div>
                ) : (
                    <>
                        <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-lc-border dark:bg-lc-surface sm:grid-cols-2 lg:grid-cols-5">
                            <Info label="Decision" value={detail.submission.humanReview.decision.replace(/_/g, " ")} />
                            <Info label="Submitted" value={detail.submission.submittedAt ? formatDate(detail.submission.submittedAt) : "Pending"} />
                            <Info label="Integrity score" value={typeof proctoring?.integrityScore === "number" ? `${proctoring.integrityScore}/100` : "Pending"} />
                            <Info label="High attention" value={`${highAttentionEvents} event${highAttentionEvents === 1 ? "" : "s"}`} />
                            <Info label="Evidence" value={`${transcriptCount} transcript, ${snapshotCount} snapshots`} />
                        </div>
                        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-lc-border dark:bg-lc-surface">
                            {!detail.submission.report ? (
                                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                                    <div>
                                        <p className="text-xs font-extrabold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">Pending report</p>
                                        <h2 className="mt-2 font-nunito text-2xl font-extrabold">Screening report</h2>
                                        <p className="mt-2 max-w-4xl text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">
                                            Generate a recruiter-ready screening report from the transcript, rubric, and integrity evidence.
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={onRegenerateReport}
                                        disabled={reportRegenerating}
                                        className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-primary px-4 text-sm font-extrabold text-primary hover:bg-primary hover:text-white disabled:opacity-60"
                                    >
                                        <span className="material-symbols-outlined text-[18px]">{reportRegenerating ? "sync" : "refresh"}</span>
                                        {reportRegenerating ? "Generating..." : "Generate report"}
                                    </button>
                                </div>
                            ) : (
                                <>
                                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                    <div>
                                        <p className="text-xs font-extrabold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">{reportStatus}</p>
                                        <h2 className="mt-2 font-nunito text-2xl font-extrabold">Screening report</h2>
                                        <p className="mt-2 max-w-4xl text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">
                                            {report?.summary || detail.submission.report.aiSummary || "Report generated for recruiter review."}
                                        </p>
                                    </div>
                                    <div className="grid min-w-[260px] grid-cols-2 gap-3">
                                        <Info label="Score" value={`${report?.overallScore ?? detail.submission.report.overallScore}/100`} />
                                        <Info label="Recommendation" value={(report?.recommendation || "review").replace(/_/g, " ")} />
                                    </div>
                                </div>
                                <div className="mt-4 flex justify-end">
                                    <button
                                        type="button"
                                        onClick={onRegenerateReport}
                                        disabled={reportRegenerating}
                                        className="inline-flex h-10 items-center gap-2 rounded-full border border-primary px-4 text-sm font-extrabold text-primary hover:bg-primary hover:text-white disabled:opacity-60"
                                    >
                                        <span className="material-symbols-outlined text-[18px]">{reportRegenerating ? "sync" : "refresh"}</span>
                                        {reportRegenerating ? "Regenerating..." : "Regenerate report"}
                                    </button>
                                </div>
                                <div className="mt-5 grid gap-4 lg:grid-cols-3">
                                    <ReportList title="Strengths" items={report?.strengths || []} empty="No strong positive signal generated." />
                                    <ReportList title="Risks" items={report?.risks || []} empty="No major risk generated." />
                                    <ReportList title="Recruiter focus" items={report?.recruiterFocus || []} empty="Review transcript and integrity evidence." />
                                </div>
                                {report?.dimensionScores?.length ? (
                                    <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                                        {report.dimensionScores.map((dimension) => (
                                            <div key={dimension.dimensionId} className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-lc-border dark:bg-lc-bg">
                                                <div className="flex items-start justify-between gap-3">
                                                    <div>
                                                        <p className="text-sm font-extrabold">{dimension.label}</p>
                                                        <p className="mt-1 text-xs font-bold uppercase tracking-[0.16em] text-slate-400">{dimension.signal.replace(/_/g, " ")}</p>
                                                    </div>
                                                    <span className="font-nunito text-2xl font-extrabold text-primary">{dimension.score}</span>
                                                </div>
                                                <div className="mt-3 flex flex-wrap gap-2">
                                                    {(dimension.competencyTags || []).slice(0, 4).map((tag) => (
                                                        <span key={tag} className="rounded-full bg-white px-2.5 py-1 text-[11px] font-extrabold text-slate-500 ring-1 ring-slate-200 dark:bg-lc-surface dark:ring-lc-border">{tag}</span>
                                                    ))}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : null}
                                </>
                            )}
                        </section>
                        <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
                            <aside className="space-y-5">
                                <section className="rounded-lg border border-slate-200 p-4 dark:border-lc-border">
                                    <h3 className="font-nunito text-lg font-extrabold">Review decision</h3>
                                    <p className="mt-1 text-sm font-semibold leading-6 text-slate-500 dark:text-slate-400">
                                        Use the generated report, transcript, rubric, and integrity evidence to make the final hiring decision.
                                    </p>
                                    <select
                                        value={detail.submission.humanReview.decision}
                                        onChange={(event) => onDecisionChange(event.target.value as ReviewDecision)}
                                        className="input mt-4"
                                    >
                                        <option value="needs_review">Needs review</option>
                                        <option value="advance">Advance</option>
                                        <option value="hold">Hold</option>
                                        <option value="reject">Reject</option>
                                    </select>
                                    <textarea
                                        value={detail.submission.humanReview.notes || ""}
                                        onChange={(event) => onNotesChange(event.target.value)}
                                        className="input mt-3 min-h-28"
                                        placeholder="Recruiter notes, reasons, or follow-up concerns"
                                    />
                                    {detail.submission.humanReview.reviewedAt && (
                                        <p className="mt-2 text-xs font-semibold text-slate-400">
                                            Last saved {formatDate(detail.submission.humanReview.reviewedAt)}
                                        </p>
                                    )}
                                </section>

                                <section className="rounded-lg border border-slate-200 p-4 dark:border-lc-border">
                                    <h3 className="font-nunito text-lg font-extrabold">Integrity</h3>
                                    <div className="mt-4 grid gap-3">
                                        <Info label="Integrity score" value={typeof proctoring?.integrityScore === "number" ? `${proctoring.integrityScore}/100` : "Pending"} />
                                        <Info label="Events" value={String(eventCount)} />
                                        <Info label="Snapshots" value={String(snapshotCount)} />
                                    </div>
                                    <div className="mt-4 flex flex-wrap gap-2">
                                        {Object.entries(proctoring?.eventCountsBySeverity || {}).map(([severity, count]) => (
                                            <span key={severity} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-extrabold capitalize text-slate-600 dark:bg-lc-hover dark:text-slate-300">
                                                {severity}: {count}
                                            </span>
                                        ))}
                                    </div>
                                </section>

                                <section className="rounded-lg border border-slate-200 p-4 dark:border-lc-border">
                                    <h3 className="font-nunito text-lg font-extrabold">Rubric review</h3>
                                    <div className="mt-4 grid gap-3">
                                        {detail.interview.rubric.map((rubric) => {
                                            const row = reviewRowFor(detail, rubric);
                                            return (
                                                <div key={rubric.id} className="rounded-lg bg-slate-50 p-3 dark:bg-lc-bg">
                                                    <div className="flex items-center justify-between gap-3">
                                                        <div>
                                                            <p className="text-sm font-extrabold">{rubric.label}</p>
                                                            <p className="text-xs font-semibold text-slate-500">{rubric.weight}%</p>
                                                        </div>
                                                        <select
                                                            value={row.rating || ""}
                                                            onChange={(event) => onRubricReviewChange(rubric, { rating: event.target.value ? Number(event.target.value) : null })}
                                                            className="input w-24"
                                                        >
                                                            <option value="">Rate</option>
                                                            <option value="1">1</option>
                                                            <option value="2">2</option>
                                                            <option value="3">3</option>
                                                            <option value="4">4</option>
                                                            <option value="5">5</option>
                                                        </select>
                                                    </div>
                                                    <input
                                                        value={row.notes || ""}
                                                        onChange={(event) => onRubricReviewChange(rubric, { notes: event.target.value })}
                                                        className="input mt-2"
                                                        placeholder="Evidence note for this dimension"
                                                    />
                                                </div>
                                            );
                                        })}
                                    </div>
                                </section>
                            </aside>

                            <div className="space-y-5">
                                {error && (
                                    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-200">
                                        {error}
                                    </div>
                                )}

                                <div className="rounded-lg border border-slate-200 bg-white p-2 dark:border-lc-border dark:bg-lc-surface">
                                    <div className="flex flex-wrap gap-2">
                                        {evidenceTabs.map((tab) => (
                                            <button
                                                key={tab.id}
                                                type="button"
                                                onClick={() => setActiveEvidenceTab(tab.id)}
                                                className={`rounded-md px-3 py-2 text-sm font-extrabold transition-colors ${activeEvidenceTab === tab.id ? "bg-primary text-white" : "bg-slate-50 text-slate-600 hover:bg-slate-100 dark:bg-lc-bg dark:text-slate-300 dark:hover:bg-lc-hover"}`}
                                            >
                                                {tab.label}
                                                <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${activeEvidenceTab === tab.id ? "bg-white/20 text-white" : "bg-white text-slate-500 dark:bg-lc-surface dark:text-slate-300"}`}>
                                                    {tab.count}
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {activeEvidenceTab === "questions" && (
                                <section className="rounded-lg border border-slate-200 p-4 dark:border-lc-border">
                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                        <div>
                                            <h3 className="font-nunito text-lg font-extrabold">Interview evidence</h3>
                                            <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">
                                                Configured questions and expected points are shown beside the captured transcript.
                                            </p>
                                        </div>
                                        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-extrabold text-slate-600 dark:bg-lc-hover dark:text-slate-300">
                                            {detail.interview.durationMinutes || 0} min
                                        </span>
                                    </div>
                                    <div className="mt-4 grid gap-3">
                                        {detail.interview.questions.map((question, index) => (
                                            <details key={`${question.id}-${index}`} className="rounded-lg bg-slate-50 p-3 dark:bg-lc-bg">
                                                <summary className="cursor-pointer text-sm font-extrabold">
                                                    Question {index + 1}: {question.category.replace(/_/g, " ")}
                                                </summary>
                                                <p className="mt-3 whitespace-pre-wrap text-sm font-semibold leading-6 text-slate-700 dark:text-slate-200">{question.prompt}</p>
                                                <ul className="mt-3 space-y-2">
                                                    {question.expectedPoints.map((point) => (
                                                        <li key={point.id} className="text-sm font-semibold text-slate-500 dark:text-slate-400">
                                                            {point.text}
                                                        </li>
                                                    ))}
                                                </ul>
                                            </details>
                                        ))}
                                    </div>
                                </section>
                                )}

                                {activeEvidenceTab === "transcript" && (
                                <section className="rounded-lg border border-slate-200 p-4 dark:border-lc-border">
                                    <h3 className="font-nunito text-lg font-extrabold">Transcript</h3>
                                    <div className="mt-4 max-h-[440px] overflow-y-auto rounded-lg bg-slate-50 p-3 dark:bg-lc-bg">
                                        {detail.transcript.length ? detail.transcript.map((message) => (
                                            <div key={message.id} className={`mb-3 flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                                                <div className={`max-w-[82%] rounded-lg px-3 py-2 text-sm font-semibold leading-6 ${message.role === "user" ? "bg-primary text-white" : "bg-white text-slate-700 shadow-sm dark:bg-lc-surface dark:text-slate-200"}`}>
                                                    <p className="text-[10px] font-extrabold uppercase tracking-[0.12em] opacity-70">{message.role === "user" ? "Candidate" : "AI interviewer"}</p>
                                                    <p className="mt-1 whitespace-pre-wrap">{message.content}</p>
                                                </div>
                                            </div>
                                        )) : (
                                            <p className="p-6 text-center text-sm font-semibold text-slate-500 dark:text-slate-400">
                                                No transcript messages were captured for this attempt.
                                            </p>
                                        )}
                                    </div>
                                </section>
                                )}

                                {activeEvidenceTab === "artifacts" && (
                                    <section className="rounded-lg border border-slate-200 p-4 dark:border-lc-border">
                                        <h3 className="font-nunito text-lg font-extrabold">Coding/system artifacts</h3>
                                        {detail.sessionQuestions.length ? (
                                            <div className="mt-4 grid gap-3">
                                                {detail.sessionQuestions.map((question) => (
                                                    <details key={question.id} className="rounded-lg bg-slate-50 p-3 dark:bg-lc-bg">
                                                        <summary className="cursor-pointer text-sm font-extrabold">{question.title || question.category || "Interview artifact"}</summary>
                                                        {question.finalCode && (
                                                            <pre className="mt-3 max-h-64 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">{question.finalCode}</pre>
                                                        )}
                                                        {question.sampleAnswer && (
                                                            <p className="mt-3 whitespace-pre-wrap text-sm font-semibold text-slate-600 dark:text-slate-300">{question.sampleAnswer}</p>
                                                        )}
                                                    </details>
                                                ))}
                                            </div>
                                        ) : (
                                            <p className="mt-3 rounded-lg border border-dashed border-slate-200 p-6 text-center text-sm font-semibold text-slate-500 dark:border-lc-border dark:text-slate-400">
                                                No coding or system-design artifacts were captured for this attempt.
                                            </p>
                                        )}
                                    </section>
                                )}

                                {activeEvidenceTab === "integrity" && (
                                <section className="rounded-lg border border-slate-200 p-4 dark:border-lc-border">
                                    <h3 className="font-nunito text-lg font-extrabold">Integrity timeline</h3>
                                    <div className="mt-4 grid gap-3">
                                        {proctoring?.events.length ? proctoring.events.map((event) => {
                                            const label = humanizeProctoringEvent({
                                                eventType: event.eventType as any,
                                                payload: event.payload,
                                            } as ProctoringEventRecord);
                                            return (
                                                <article key={event.id} className="rounded-lg border border-slate-200 p-3 dark:border-lc-border">
                                                    <div className="flex flex-wrap items-start justify-between gap-2">
                                                        <div>
                                                            <p className="text-sm font-extrabold">{label.title}</p>
                                                            {label.detail && <p className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">{label.detail}</p>}
                                                        </div>
                                                        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-extrabold capitalize text-slate-600 dark:bg-lc-hover dark:text-slate-300">
                                                            {event.severity}
                                                        </span>
                                                    </div>
                                                    <p className="mt-2 text-xs font-semibold text-slate-400">{formatDate(event.serverTimestamp)}</p>
                                                </article>
                                            );
                                        }) : (
                                            <p className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-sm font-semibold text-slate-500 dark:border-lc-border dark:text-slate-400">
                                                No integrity events were recorded.
                                            </p>
                                        )}
                                    </div>
                                </section>
                                )}

                                {activeEvidenceTab === "snapshots" && (
                                <section className="rounded-lg border border-slate-200 p-4 dark:border-lc-border">
                                    <h3 className="font-nunito text-lg font-extrabold">Camera snapshots</h3>
                                    {proctoring?.snapshots.length ? (
                                        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                            {proctoring.snapshots.map((snapshot) => (
                                                <a key={snapshot.id} href={snapshot.url} target="_blank" rel="noreferrer" className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50 dark:border-lc-border dark:bg-lc-bg">
                                                    <img src={snapshot.url} alt="" className="aspect-[4/3] w-full object-cover" />
                                                    <div className="p-2 text-xs font-semibold text-slate-500">
                                                        <p className="font-extrabold capitalize text-slate-700 dark:text-slate-200">{snapshot.trigger.replace(/_/g, " ")}</p>
                                                        <p>{formatDate(snapshot.takenAt)}</p>
                                                    </div>
                                                </a>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="mt-3 rounded-lg border border-dashed border-slate-200 p-6 text-center text-sm font-semibold text-slate-500 dark:border-lc-border dark:text-slate-400">
                                            No snapshots were uploaded for this screening.
                                        </p>
                                    )}
                                </section>
                                )}
                            </div>
                        </div>

                        <div className="sticky bottom-0 flex justify-end gap-3 border-t border-slate-200 bg-white px-6 py-4 shadow-sm dark:border-lc-border dark:bg-lc-surface">
                            <button type="button" onClick={onClose} className="rounded-full border border-slate-300 px-5 py-2.5 text-sm font-extrabold dark:border-lc-border">
                                Close
                            </button>
                            <button type="button" onClick={onSave} disabled={saving} className="rounded-full bg-primary px-5 py-2.5 text-sm font-extrabold text-white disabled:opacity-60">
                                {saving ? "Saving..." : "Save human review"}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </main>
    );
}

function Metric({ label, value, subtle = false }: { label: string; value: string; subtle?: boolean }) {
    return (
        <div className={`rounded-lg border px-4 py-3 text-slate-950 dark:text-white ${subtle ? "border-slate-200 bg-slate-50 dark:border-lc-border dark:bg-lc-bg" : "border-slate-200 bg-white shadow-sm dark:border-lc-border dark:bg-lc-surface"}`}>
            <p className="text-[10px] font-extrabold uppercase tracking-[0.28em] text-slate-500 dark:text-slate-400">{label}</p>
            <p className="mt-2 font-nunito text-3xl font-extrabold">{value}</p>
        </div>
    );
}

function InlineMetric({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <p className="text-[11px] font-extrabold uppercase tracking-[0.28em] text-slate-500 dark:text-slate-400">{label}</p>
            <p className="mt-2 font-nunito text-3xl font-extrabold">{value}</p>
        </div>
    );
}

function InfoChip({ icon, label }: { icon: string; label: string }) {
    return (
        <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 dark:border-lc-border dark:bg-white/5">
            <span className="material-symbols-outlined text-[16px] text-slate-400">{icon}</span>
            {label}
        </span>
    );
}

function Info({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-lc-border dark:bg-lc-bg">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">{label}</p>
            <p className="mt-1 text-sm font-extrabold text-slate-950 dark:text-white">{value}</p>
        </div>
    );
}

function ReportList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
    return (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-lc-border dark:bg-lc-bg">
            <h3 className="text-sm font-extrabold">{title}</h3>
            {items.length ? (
                <ul className="mt-3 space-y-2">
                    {items.map((item, index) => (
                        <li key={`${title}-${index}`} className="text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">
                            {item}
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="mt-3 text-sm font-semibold leading-6 text-slate-500 dark:text-slate-400">{empty}</p>
            )}
        </div>
    );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <label className="grid gap-2 text-sm font-bold">
            <span className="text-xs text-slate-600 dark:text-slate-300">{label}</span>
            {children}
        </label>
    );
}

function StepIntro({ title, text }: { title: string; text: string }) {
    return (
        <div className="mb-6">
            <h3 className="font-nunito text-2xl font-extrabold text-primary">{title}</h3>
            <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">{text}</p>
        </div>
    );
}
