"use client";

import Link from "next/link";
import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useCompanyAuth } from "@/context/company-auth-context";

type QuestionType = "dsa" | "sql" | "system_design" | "cs_fundamentals";
type Difficulty = "Easy" | "Medium" | "Hard";

type BankQuestion = {
    id: string;
    type: QuestionType;
    title: string;
    difficulty?: Difficulty | null;
    meta?: string;
};

type QuestionSetItem = {
    type: QuestionType;
    questionId: string;
    title: string;
    difficulty?: Difficulty | null;
    orderIndex: number;
};

type QuestionSet = {
    id: string;
    title: string;
    description?: string;
    status: "draft" | "active" | "archived";
    items: QuestionSetItem[];
    updatedAt?: string;
};

type QuestionsResponse = {
    questions: any[];
};

type QuestionSetsResponse = {
    questionSets: QuestionSet[];
};

const CATEGORIES: Array<{ type: QuestionType; route: string; label: string; shortLabel: string; icon: string }> = [
    { type: "dsa", route: "dsa", label: "DSA", shortLabel: "DSA", icon: "code" },
    { type: "sql", route: "sql", label: "SQL", shortLabel: "SQL", icon: "database" },
    { type: "system_design", route: "system-design", label: "System Design", shortLabel: "System", icon: "account_tree" },
    { type: "cs_fundamentals", route: "cs-fundamentals", label: "CS Fundamentals", shortLabel: "CS", icon: "menu_book" },
];

const difficultyClass: Record<Difficulty, string> = {
    Easy: "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300",
    Medium: "bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300",
    Hard: "bg-red-50 text-red-700 dark:bg-red-400/10 dark:text-red-300",
};

function questionKey(type: QuestionType, questionId: string) {
    return `${type}:${questionId}`;
}

function categoryForType(type: QuestionType) {
    return CATEGORIES.find((category) => category.type === type) || CATEGORIES[0];
}

function formatDateTag(value?: string) {
    if (!value) return "";
    try {
        return new Intl.DateTimeFormat("en-US", {
            month: "short",
            day: "numeric",
        }).format(new Date(value));
    } catch {
        return "";
    }
}

function normalizeQuestion(type: QuestionType, question: any): BankQuestion {
    const title = type === "cs_fundamentals" ? question.question : question.title;
    const meta = type === "dsa"
        ? (question.topics || []).slice(0, 2).join(", ")
        : type === "cs_fundamentals"
            ? question.topic
            : (question.tags || []).slice(0, 2).join(", ");

    return {
        id: question.id,
        type,
        title: title || "Untitled question",
        difficulty: question.difficulty || null,
        meta,
    };
}

function questionSetTypes(questionSet: QuestionSet) {
    return Array.from(new Set(questionSet.items.map((item) => item.type)));
}

function CustomSortDropdown({
    value,
    onChange,
}: {
    value: "newest" | "oldest";
    onChange: (value: "newest" | "oldest") => void;
}) {
    const [open, setOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function closeOnOutsideClick(event: MouseEvent) {
            if (open && containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setOpen(false);
            }
        }

        document.addEventListener("mousedown", closeOnOutsideClick);
        return () => document.removeEventListener("mousedown", closeOnOutsideClick);
    }, [open]);

    const options = [
        { value: "newest" as const, label: "Newest First", icon: "schedule" },
        { value: "oldest" as const, label: "Oldest First", icon: "history" },
    ];
    const selected = options.find((option) => option.value === value) || options[0];

    return (
        <div ref={containerRef} className="relative z-30 min-w-[150px]">
            <button
                type="button"
                onClick={() => setOpen((current) => !current)}
                className="flex h-10 w-full items-center justify-between rounded-full border border-slate-200 bg-white px-4 text-[13px] font-bold text-slate-700 shadow-[0_2px_10px_-4px_rgba(0,0,0,0.08)] transition hover:bg-slate-50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 dark:border-white/10 dark:bg-lc-surface dark:text-slate-200 dark:hover:bg-lc-hover"
            >
                <span className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[17px] text-primary">{selected.icon}</span>
                    {selected.label}
                </span>
                <span className={`material-symbols-outlined text-[17px] text-slate-400 transition ${open ? "rotate-180 text-primary" : ""}`}>expand_more</span>
            </button>
            {open && (
                <div className="absolute right-0 top-[calc(100%+8px)] w-[190px] rounded-2xl border border-slate-200/80 bg-white p-1.5 shadow-[0_18px_45px_-18px_rgba(15,23,42,0.35)] dark:border-white/10 dark:bg-lc-surface">
                    {options.map((option) => (
                        <button
                            key={option.value}
                            type="button"
                            onClick={() => {
                                onChange(option.value);
                                setOpen(false);
                            }}
                            className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] font-bold transition ${
                                value === option.value
                                    ? "bg-primary/10 text-primary"
                                    : "text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-lc-hover"
                            }`}
                        >
                            <span className="material-symbols-outlined text-[18px]">{option.icon}</span>
                            {option.label}
                            {value === option.value && <span className="material-symbols-outlined ml-auto text-[16px]">check</span>}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

function QuestionSetCard({
    questionSet,
    deletingId,
    deleteConfirmId,
    onArchive,
    onDeleteConfirm,
}: {
    questionSet: QuestionSet;
    deletingId: string | null;
    deleteConfirmId: string | null;
    onArchive: (questionSetId: string) => void;
    onDeleteConfirm: (questionSetId: string | null) => void;
}) {
    const showConfirm = deleteConfirmId === questionSet.id;
    const deleting = deletingId === questionSet.id;
    const types = questionSetTypes(questionSet);
    const questionCount = questionSet.items.length;
    const fillPercent = Math.min(100, Math.max(8, questionCount * 10));
    const updatedAt = formatDateTag(questionSet.updatedAt);

    return (
        <div className="group flex flex-col gap-2">
            <Link
                href={`/question-bank/sets/${questionSet.id}`}
                className="group/card relative z-10 flex min-h-[254px] cursor-pointer flex-col overflow-hidden rounded-3xl border border-slate-200/80 bg-gradient-to-br from-white/65 via-blue-100/45 to-blue-200/35 p-6 text-left backdrop-blur-xl transition-all duration-300 ease-out before:absolute before:inset-0 before:h-full before:w-[200%] before:-translate-x-full before:bg-gradient-to-r before:from-transparent before:via-black/[0.03] before:to-transparent before:transition-transform before:duration-700 hover:-translate-y-[6px] hover:shadow-[0_16px_48px_-12px_rgba(0,0,0,0.12)] hover:before:translate-x-1/2 focus:outline-none focus:ring-2 focus:ring-blue-400/40 dark:border-white/10 dark:from-[#2a2a2a] dark:via-[#222222] dark:to-[#1a1a1a] dark:before:via-white/[0.04]"
            >
                <div className="relative z-10 mb-5 flex items-start justify-between gap-4">
                    <h3 className="line-clamp-2 text-[18px] font-bold leading-tight tracking-tight text-slate-800 dark:text-white">
                        {questionSet.title}
                    </h3>
                    <span className="material-symbols-outlined text-[22px] text-blue-600/80 transition-transform duration-200 group-hover/card:translate-x-0.5 dark:text-blue-300/80">
                        chevron_right
                    </span>
                </div>

                <div className="relative z-10 mb-5 mt-4 flex flex-col gap-2">
                    <div className="flex items-center justify-between text-[13px] font-semibold">
                        <span className="text-slate-600 dark:text-slate-300">Questions</span>
                        <span className="text-primary dark:text-[#a0a5e8]">{questionCount}</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full border border-slate-300/85 bg-slate-100 dark:border-white/20 dark:bg-white/5">
                        <div
                            className="h-full rounded-full bg-gradient-to-r from-primary to-blue-500 transition-all duration-700 ease-out dark:from-[#6C63FF] dark:to-[#8B84FF]"
                            style={{ width: `${fillPercent}%` }}
                        />
                    </div>
                </div>

                <div
                    className="relative z-10 mb-5 mt-2 flex min-h-[28px] items-center gap-2 overflow-x-auto whitespace-nowrap [&::-webkit-scrollbar]:hidden"
                    style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
                >
                    {updatedAt && (
                        <span className="inline-flex shrink-0 items-center justify-center gap-1 rounded-lg bg-blue-50/50 px-3 py-1 text-[11px] font-bold tracking-tight text-blue-600 ring-1 ring-inset ring-blue-500/10 dark:bg-[#6C63FF]/10 dark:text-[#B7B2FF] dark:ring-[#6C63FF]/20">
                            <span className="material-symbols-outlined text-[12px]">calendar_today</span>
                            {updatedAt}
                        </span>
                    )}
                    <span className="inline-flex shrink-0 items-center justify-center rounded-lg bg-blue-50/50 px-3 py-1 text-[11px] font-bold tracking-tight text-blue-600 ring-1 ring-inset ring-blue-500/10 dark:bg-[#6C63FF]/10 dark:text-[#B7B2FF] dark:ring-[#6C63FF]/20">
                        {questionSet.status === "draft" ? "Draft" : "Active"}
                    </span>
                    {(types.length ? types : ["dsa" as QuestionType]).map((type) => (
                        <span
                            key={`${questionSet.id}-${type}`}
                            className="inline-flex shrink-0 items-center justify-center rounded-lg bg-blue-50/50 px-3 py-1 text-[11px] font-bold tracking-tight text-blue-600 ring-1 ring-inset ring-blue-500/10 dark:bg-[#6C63FF]/10 dark:text-[#B7B2FF] dark:ring-[#6C63FF]/20"
                        >
                            {categoryForType(type).shortLabel}
                        </span>
                    ))}
                </div>
            </Link>

            <div className="relative z-10 px-1">
                {!showConfirm ? (
                    <div className="flex items-center justify-between gap-1.5 opacity-100 transition-all duration-200 lg:translate-y-1 lg:opacity-0 lg:group-hover:translate-y-0 lg:group-hover:opacity-100 lg:group-focus-within:translate-y-0 lg:group-focus-within:opacity-100">
                        <span />
                        <button
                            type="button"
                            onClick={() => onDeleteConfirm(questionSet.id)}
                            className="inline-flex items-center justify-center rounded-md p-1 text-slate-500 transition-colors hover:bg-red-50 hover:text-red-500 dark:text-slate-400 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                            title="Archive set"
                        >
                            <span className="material-symbols-outlined text-[14px]">delete</span>
                        </button>
                    </div>
                ) : (
                    <div className="ml-auto flex w-full max-w-[220px] flex-col gap-2 rounded-xl bg-red-50/50 p-3 ring-1 ring-inset ring-red-100 dark:bg-red-950/10 dark:ring-red-900/20">
                        <p className="text-center text-[12px] font-bold text-red-600 dark:text-red-400">
                            Archive this question set?
                        </p>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => onDeleteConfirm(null)}
                                disabled={deleting}
                                className="flex-1 rounded-lg bg-white px-2.5 py-1.5 text-[12px] font-bold text-slate-600 shadow-sm ring-1 ring-inset ring-slate-200 transition hover:bg-slate-50 disabled:opacity-50 dark:bg-[#1a1a1a] dark:text-slate-300 dark:ring-white/10"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={() => onArchive(questionSet.id)}
                                disabled={deleting}
                                className="flex-1 rounded-lg bg-red-500 px-2.5 py-1.5 text-[12px] font-bold text-white shadow-sm transition hover:bg-red-600 disabled:opacity-50"
                            >
                                {deleting ? "..." : "Archive"}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default function InterviewQuestionSetsPage() {
    const { session } = useCompanyAuth();
    const [builderOpen, setBuilderOpen] = useState(false);
    const [step, setStep] = useState<"details" | "questions">("details");
    const [questionSets, setQuestionSets] = useState<QuestionSet[]>([]);
    const [questions, setQuestions] = useState<BankQuestion[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [editingSetId, setEditingSetId] = useState<string | null>(null);
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [status, setStatus] = useState<"draft" | "active">("active");
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [activeType, setActiveType] = useState<QuestionType>("dsa");
    const [search, setSearch] = useState("");
    const [activeFilter, setActiveFilter] = useState("all");
    const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");

    const loadData = useCallback(async () => {
        if (!session?.access_token) {
            setLoading(false);
            return;
        }

        setLoading(true);
        setError(null);
        try {
            const [setsPayload, ...questionPayloads] = await Promise.all([
                api.get<QuestionSetsResponse>("/companies/question-bank/question-sets", session.access_token),
                ...CATEGORIES.map((category) =>
                    api.get<QuestionsResponse>(`/companies/question-bank/${category.route}?limit=100`, session.access_token)
                ),
            ]);

            setQuestionSets(setsPayload.questionSets || []);
            setQuestions(
                questionPayloads.flatMap((payload, index) =>
                    (payload.questions || []).map((question) => normalizeQuestion(CATEGORIES[index].type, question))
                )
            );
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "Failed to load question sets.");
        } finally {
            setLoading(false);
        }
    }, [session?.access_token]);

    useEffect(() => {
        void loadData();
    }, [loadData]);

    const visibleQuestions = useMemo(() => {
        const normalizedSearch = search.trim().toLowerCase();
        return questions.filter((question) => {
            if (question.type !== activeType) return false;
            if (!normalizedSearch) return true;
            return (
                question.title.toLowerCase().includes(normalizedSearch) ||
                question.meta?.toLowerCase().includes(normalizedSearch)
            );
        });
    }, [activeType, questions, search]);

    const selectedQuestions = useMemo(() => {
        return questions.filter((question) => selectedIds.has(questionKey(question.type, question.id)));
    }, [questions, selectedIds]);

    const filteredQuestionSets = useMemo(() => {
        const filtered = questionSets.filter((questionSet) => {
            if (activeFilter === "all") return true;
            return questionSetTypes(questionSet).some((type) => type === activeFilter);
        });

        return [...filtered].sort((a, b) => {
            const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
            const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
            return sortOrder === "newest" ? bTime - aTime : aTime - bTime;
        });
    }, [activeFilter, questionSets, sortOrder]);

    const activeCategory = CATEGORIES.find((category) => category.type === activeType) || CATEGORIES[0];

    function clearBuilder() {
        setEditingSetId(null);
        setTitle("");
        setDescription("");
        setStatus("active");
        setSelectedIds(new Set());
        setSearch("");
        setActiveType("dsa");
        setStep("details");
    }

    function startNewSet() {
        clearBuilder();
        setMessage(null);
        setError(null);
        setBuilderOpen(true);
    }

    function editQuestionSet(questionSet: QuestionSet) {
        setEditingSetId(questionSet.id);
        setTitle(questionSet.title);
        setDescription(questionSet.description || "");
        setStatus(questionSet.status === "draft" ? "draft" : "active");
        setSelectedIds(new Set(questionSet.items.map((item) => questionKey(item.type, item.questionId))));
        setSearch("");
        setActiveType(questionSet.items[0]?.type || "dsa");
        setMessage(null);
        setError(null);
        setStep("questions");
        setBuilderOpen(true);
    }

    function closeBuilder() {
        if (saving) return;
        setBuilderOpen(false);
        clearBuilder();
    }

    function handleDetailsSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!title.trim()) {
            setError("Add a set name first.");
            return;
        }

        setError(null);
        setStep("questions");
    }

    function toggleQuestion(question: BankQuestion) {
        const key = questionKey(question.type, question.id);
        setSelectedIds((current) => {
            const next = new Set(current);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    }

    async function saveQuestionSet() {
        if (!session?.access_token || saving) return;

        if (!title.trim()) {
            setError("Add a set name first.");
            setStep("details");
            return;
        }

        if (selectedIds.size === 0) {
            setError("Select at least one question for this set.");
            return;
        }

        setSaving(true);
        setError(null);
        setMessage(null);
        try {
            const items = Array.from(selectedIds).map((key) => {
                const [type, questionId] = key.split(":") as [QuestionType, string];
                return { type, questionId };
            });
            const body = {
                title: title.trim(),
                description: description.trim(),
                status,
                items,
            };

            if (editingSetId) {
                await api.put(`/companies/question-bank/question-sets/${editingSetId}`, body, session.access_token);
                setMessage("Question set updated.");
            } else {
                await api.post("/companies/question-bank/question-sets", body, session.access_token);
                setMessage("Question set created.");
            }

            setBuilderOpen(false);
            clearBuilder();
            await loadData();
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "Failed to save question set.");
        } finally {
            setSaving(false);
        }
    }

    async function archiveQuestionSet(questionSetId: string) {
        if (!session?.access_token || deletingId) return;

        setDeletingId(questionSetId);
        setError(null);
        try {
            await api.delete(`/companies/question-bank/question-sets/${questionSetId}`, session.access_token);
            if (editingSetId === questionSetId) clearBuilder();
            setQuestionSets((current) => current.filter((questionSet) => questionSet.id !== questionSetId));
            setDeleteConfirmId(null);
            setMessage("Question set archived.");
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "Failed to archive question set.");
        } finally {
            setDeletingId(null);
        }
    }

    return (
        <main className="min-h-full bg-slate-50/50 px-4 pb-16 pt-8 dark:bg-lc-bg sm:px-6 lg:px-10">
            <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-8">
                <header className="flex items-center gap-4">
                    <Link
                        href="/question-bank"
                        className="grid size-10 place-items-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-lc-hover dark:hover:text-white"
                        aria-label="Back to question bank"
                    >
                        <span className="material-symbols-outlined text-[28px]">arrow_back</span>
                    </Link>
                    <h1 className="font-nunito text-[32px] font-extrabold tracking-tight text-slate-950 dark:text-white">
                        Interview Question Sets
                    </h1>
                </header>

                <section className="flex flex-col gap-6">
                    <div className="inline-flex w-max max-w-full items-center gap-1.5 overflow-x-auto rounded-full border border-slate-200/50 bg-slate-100/80 p-1 dark:border-white/10 dark:bg-lc-surface">
                        <button
                            type="button"
                            onClick={() => setActiveFilter("all")}
                            className={`whitespace-nowrap rounded-full px-4 py-1.5 text-[13px] font-bold transition-all duration-300 ${
                                activeFilter === "all"
                                    ? "bg-white text-primary shadow-[0_2px_8px_-2px_rgba(0,0,0,0.08)] ring-1 ring-slate-200/60 dark:bg-lc-elevated dark:text-[#B7B2FF] dark:ring-white/10"
                                    : "text-slate-500 hover:bg-slate-200/50 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-slate-200"
                            }`}
                        >
                            All
                        </button>
                        {CATEGORIES.map((category) => (
                            <button
                                key={category.type}
                                type="button"
                                onClick={() => setActiveFilter(category.type)}
                                className={`whitespace-nowrap rounded-full px-4 py-1.5 text-[13px] font-bold transition-all duration-300 ${
                                    activeFilter === category.type
                                        ? "bg-white text-primary shadow-[0_2px_8px_-2px_rgba(0,0,0,0.08)] ring-1 ring-slate-200/60 dark:bg-lc-elevated dark:text-[#B7B2FF] dark:ring-white/10"
                                        : "text-slate-500 hover:bg-slate-200/50 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-slate-200"
                                }`}
                            >
                                {category.shortLabel}
                            </button>
                        ))}
                    </div>

                    <div className="flex w-full items-center justify-between gap-4">
                        <button
                            type="button"
                            onClick={startNewSet}
                            className="flex items-center gap-2 rounded-full bg-blue-600 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-blue-700"
                        >
                            <span className="material-symbols-outlined text-[21px]">add</span>
                            Create New Set
                        </button>
                        <CustomSortDropdown value={sortOrder} onChange={setSortOrder} />
                    </div>

                    {error && !builderOpen && (
                        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300">
                            {error}
                        </div>
                    )}
                    {message && !builderOpen && (
                        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-300">
                            {message}
                        </div>
                    )}

                    {loading ? (
                        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                            {Array.from({ length: 4 }).map((_, index) => (
                                <div
                                    key={index}
                                    className="relative min-h-[254px] overflow-hidden rounded-3xl border border-slate-200/80 bg-gradient-to-br from-white/65 via-blue-100/45 to-blue-200/35 p-6"
                                >
                                    <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-slate-200/50 to-transparent animate-[shimmer_1.5s_infinite]" />
                                    <div className="h-5 w-3/4 rounded-md bg-slate-200" />
                                    <div className="mt-16 h-3 w-20 rounded-md bg-slate-200" />
                                    <div className="mt-3 h-2 w-full rounded-full bg-slate-200" />
                                    <div className="mt-8 flex gap-2">
                                        <div className="h-7 w-20 rounded-lg bg-slate-200" />
                                        <div className="h-7 w-16 rounded-lg bg-slate-200" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : filteredQuestionSets.length ? (
                        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                            {filteredQuestionSets.map((questionSet) => (
                                <QuestionSetCard
                                    key={questionSet.id}
                                    questionSet={questionSet}
                                    deletingId={deletingId}
                                    deleteConfirmId={deleteConfirmId}
                                    onArchive={(questionSetId) => void archiveQuestionSet(questionSetId)}
                                    onDeleteConfirm={setDeleteConfirmId}
                                />
                            ))}
                        </div>
                    ) : (
                        <div className="mt-4 rounded-3xl border border-slate-200/80 bg-white/50 py-28 text-center shadow-sm dark:border-white/10 dark:bg-lc-surface/60">
                            <div className="mx-auto mb-5 flex size-20 items-center justify-center rounded-full bg-slate-100 dark:bg-white/5">
                                <span className="material-symbols-outlined text-[40px] text-slate-400">dynamic_feed</span>
                            </div>
                            <h2 className="font-nunito text-xl font-extrabold text-slate-900 dark:text-white">No question sets found</h2>
                            <p className="mx-auto mt-2 max-w-md text-sm font-semibold text-slate-500 dark:text-slate-400">
                                Create a set from your company question bank so it can be assigned during direct interviews.
                            </p>
                        </div>
                    )}
                </section>
            </div>

            {builderOpen && (
                <div
                    className="fixed inset-0 z-[120] flex items-center justify-center bg-neutral-950/50 px-4 backdrop-blur-sm dark:bg-black/50"
                    onClick={closeBuilder}
                >
                    <section
                        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-[0_18px_50px_-12px_rgba(0,0,0,0.25)] dark:border-white/10 dark:bg-[#161616]"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5 dark:border-lc-border">
                            <div className="flex min-w-0 items-start gap-4">
                                {step === "questions" && (
                                    <button
                                        type="button"
                                        onClick={() => setStep("details")}
                                        className="mt-1 grid size-10 shrink-0 place-items-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-lc-hover dark:hover:text-white"
                                        aria-label="Back to set details"
                                    >
                                        <span className="material-symbols-outlined">arrow_back</span>
                                    </button>
                                )}
                                <div className="min-w-0">
                                    <h2 className="font-nunito text-2xl font-extrabold tracking-tight text-slate-950 dark:text-white">
                                        {step === "details" ? (editingSetId ? "Edit Question Set" : "Create New Set") : `Add Questions to "${title || "Question Set"}"`}
                                    </h2>
                                    {step === "questions" && (
                                        <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">
                                            Select questions to add to this interview set.
                                        </p>
                                    )}
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={closeBuilder}
                                className="grid size-10 shrink-0 place-items-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-lc-hover dark:hover:text-white"
                                aria-label="Close question set builder"
                            >
                                <span className="material-symbols-outlined">close</span>
                            </button>
                        </header>

                        {(error || message) && (
                            <div className="border-b border-slate-200 px-6 py-3 dark:border-lc-border">
                                {error && (
                                    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300">
                                        {error}
                                    </div>
                                )}
                                {message && !error && (
                                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-300">
                                        {message}
                                    </div>
                                )}
                            </div>
                        )}

                        {step === "details" ? (
                            <form onSubmit={handleDetailsSubmit} className="flex min-h-0 flex-1 flex-col">
                                <div className="space-y-5 overflow-y-auto p-6">
                                    <label className="block">
                                        <span className="text-xs font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                            Set name
                                        </span>
                                        <input
                                            value={title}
                                            onChange={(event) => setTitle(event.target.value)}
                                            placeholder="Set A - Backend intern"
                                            className="mt-2 h-14 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-white/15 dark:bg-[#0f0f0f] dark:text-white"
                                            autoFocus
                                        />
                                    </label>
                                    <label className="block">
                                        <span className="text-xs font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                            Description
                                        </span>
                                        <textarea
                                            value={description}
                                            onChange={(event) => setDescription(event.target.value)}
                                            placeholder="What this set is useful for"
                                            rows={4}
                                            className="mt-2 w-full resize-none rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-white/15 dark:bg-[#0f0f0f] dark:text-white"
                                        />
                                    </label>
                                    <div className="inline-flex rounded-full border border-slate-200 bg-slate-100 p-1 dark:border-white/10 dark:bg-[#1a1a1a]">
                                        {(["active", "draft"] as const).map((option) => (
                                            <button
                                                key={option}
                                                type="button"
                                                onClick={() => setStatus(option)}
                                                className={`rounded-full px-5 py-2 text-sm font-bold capitalize transition ${
                                                    status === option
                                                        ? "bg-white text-primary shadow-sm ring-1 ring-slate-200/60 dark:bg-[#2a2a2a] dark:text-[#B7B2FF] dark:ring-white/10"
                                                        : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white"
                                                }`}
                                            >
                                                {option}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <footer className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4 dark:border-lc-border">
                                    <button
                                        type="button"
                                        onClick={closeBuilder}
                                        className="rounded-lg px-4 py-2 text-sm font-bold text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-lc-hover"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={!title.trim()}
                                        className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        Next
                                    </button>
                                </footer>
                            </form>
                        ) : (
                            <div className="flex min-h-0 flex-1 flex-col">
                                <div className="flex flex-col gap-4 border-b border-slate-200 px-6 py-4 dark:border-lc-border lg:flex-row lg:items-center lg:justify-between">
                                    <div className="flex flex-wrap gap-2">
                                        {CATEGORIES.map((category) => {
                                            const active = activeType === category.type;
                                            const count = questions.filter((question) => question.type === category.type).length;
                                            return (
                                                <button
                                                    key={category.type}
                                                    type="button"
                                                    onClick={() => setActiveType(category.type)}
                                                    className={`inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-bold transition ${
                                                        active
                                                            ? "bg-primary text-white shadow-lg shadow-primary/15"
                                                            : "bg-slate-100 text-slate-600 hover:bg-primary/10 hover:text-primary dark:bg-lc-elevated dark:text-slate-300 dark:hover:bg-lc-hover dark:hover:text-white"
                                                    }`}
                                                >
                                                    {category.shortLabel}
                                                    <span className={`rounded-full px-2 py-0.5 text-xs ${active ? "bg-white/20 text-white" : "bg-white text-slate-500 dark:bg-lc-surface"}`}>
                                                        {count}
                                                    </span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                    <label className="relative block w-full lg:w-[300px]">
                                        <span className="material-symbols-outlined pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[21px] text-slate-400">
                                            search
                                        </span>
                                        <input
                                            value={search}
                                            onChange={(event) => setSearch(event.target.value)}
                                            placeholder={`Search ${activeCategory.label}`}
                                            className="h-10 w-full rounded-full border border-slate-200 bg-white pl-12 pr-4 text-sm font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-lc-border dark:bg-lc-input dark:text-white"
                                        />
                                    </label>
                                </div>

                                <div className="min-h-[360px] flex-1 overflow-y-auto p-6">
                                    {visibleQuestions.length ? (
                                        <div className="space-y-3">
                                            {visibleQuestions.map((question) => {
                                                const selected = selectedIds.has(questionKey(question.type, question.id));
                                                return (
                                                    <button
                                                        key={questionKey(question.type, question.id)}
                                                        type="button"
                                                        onClick={() => toggleQuestion(question)}
                                                        className={`grid w-full grid-cols-[28px_1fr_auto] items-start gap-4 rounded-lg border px-4 py-4 text-left transition ${
                                                            selected
                                                                ? "border-primary bg-primary/5"
                                                                : "border-slate-200 hover:border-primary/40 hover:bg-slate-50 dark:border-lc-border dark:hover:bg-lc-elevated"
                                                        }`}
                                                    >
                                                        <span className={`mt-1 grid size-5 place-items-center rounded border ${selected ? "border-primary bg-primary text-white" : "border-slate-300 text-transparent dark:border-slate-600"}`}>
                                                            <span className="material-symbols-outlined text-[15px]">check</span>
                                                        </span>
                                                        <span className="min-w-0">
                                                            <span className="block font-nunito text-base font-extrabold text-slate-950 dark:text-white">
                                                                {question.title}
                                                            </span>
                                                            {question.meta && (
                                                                <span className="mt-1 block text-xs font-bold text-slate-500 dark:text-slate-400">
                                                                    {question.meta}
                                                                </span>
                                                            )}
                                                        </span>
                                                        {question.difficulty && (
                                                            <span className={`rounded-full px-3 py-1 text-xs font-extrabold ${difficultyClass[question.difficulty]}`}>
                                                                {question.difficulty}
                                                            </span>
                                                        )}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    ) : (
                                        <div className="grid min-h-[280px] place-items-center text-center">
                                            <div>
                                                <span className="material-symbols-outlined text-5xl text-slate-300 dark:text-slate-600">search_off</span>
                                                <p className="mt-2 text-sm font-bold text-slate-500 dark:text-slate-400">
                                                    No questions found in this category.
                                                </p>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <footer className="flex flex-col gap-4 border-t border-slate-200 px-6 py-4 dark:border-lc-border sm:flex-row sm:items-center sm:justify-between">
                                    <p className="text-sm font-bold text-slate-500 dark:text-slate-400">
                                        {selectedQuestions.length} question{selectedQuestions.length === 1 ? "" : "s"} selected
                                    </p>
                                    <div className="flex items-center gap-3">
                                        <button
                                            type="button"
                                            onClick={() => setStep("details")}
                                            className="rounded-lg px-4 py-2 text-sm font-bold text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-lc-hover"
                                        >
                                            Back
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => void saveQuestionSet()}
                                            disabled={saving || selectedIds.size === 0}
                                            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            {saving && <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
                                            {editingSetId ? "Update Set" : "Create Set"}
                                        </button>
                                    </div>
                                </footer>
                            </div>
                        )}
                    </section>
                </div>
            )}
        </main>
    );
}
