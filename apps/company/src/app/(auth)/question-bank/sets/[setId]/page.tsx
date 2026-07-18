"use client";

import Link from "next/link";
import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
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

type QuestionsResponse = { questions: any[] };
type QuestionSetResponse = { questionSet: QuestionSet };

const CATEGORIES: Array<{ type: QuestionType; route: string; label: string; shortLabel: string; icon: string }> = [
    { type: "dsa", route: "dsa", label: "Data Structures & Algorithms", shortLabel: "DSA", icon: "code" },
    { type: "sql", route: "sql", label: "SQL", shortLabel: "SQL", icon: "database" },
    { type: "system_design", route: "system-design", label: "System Design", shortLabel: "System", icon: "account_tree" },
    { type: "cs_fundamentals", route: "cs-fundamentals", label: "CS Fundamentals", shortLabel: "CS", icon: "menu_book" },
];

const difficultyTextClass: Record<string, string> = {
    easy: "text-emerald-600 dark:text-emerald-400",
    medium: "text-amber-600 dark:text-amber-400",
    hard: "text-red-600 dark:text-red-400",
};

const difficultyPillClass: Record<Difficulty, string> = {
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

function questionIdeHref(setId: string, item: QuestionSetItem) {
    return `/question-bank/sets/${setId}/questions/${categoryForType(item.type).route}/${item.questionId}`;
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

function formatDate(value?: string) {
    if (!value) return "";
    try {
        return new Intl.DateTimeFormat("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
        }).format(new Date(value));
    } catch {
        return "";
    }
}

function formatTime(value?: string) {
    if (!value) return "";
    try {
        return new Intl.DateTimeFormat("en-US", {
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
        }).format(new Date(value));
    } catch {
        return "";
    }
}

export default function QuestionSetDetailPage() {
    const params = useParams<{ setId: string }>();
    const { session } = useCompanyAuth();
    const setId = params.setId;

    const [questionSet, setQuestionSet] = useState<QuestionSet | null>(null);
    const [questions, setQuestions] = useState<BankQuestion[]>([]);
    const [loading, setLoading] = useState(true);
    const [builderOpen, setBuilderOpen] = useState(false);
    const [step, setStep] = useState<"details" | "questions">("questions");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [status, setStatus] = useState<"draft" | "active">("active");
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [activeType, setActiveType] = useState<QuestionType>("dsa");
    const [search, setSearch] = useState("");

    const loadData = useCallback(async () => {
        if (!session?.access_token || !setId) {
            setLoading(false);
            return;
        }

        setLoading(true);
        setError(null);
        try {
            const [setPayload, ...questionPayloads] = await Promise.all([
                api.get<QuestionSetResponse>(`/companies/question-bank/question-sets/${setId}`, session.access_token),
                ...CATEGORIES.map((category) =>
                    api.get<QuestionsResponse>(`/companies/question-bank/${category.route}?limit=100`, session.access_token)
                ),
            ]);

            setQuestionSet(setPayload.questionSet);
            setQuestions(
                questionPayloads.flatMap((payload, index) =>
                    (payload.questions || []).map((question) => normalizeQuestion(CATEGORIES[index].type, question))
                )
            );
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "Failed to load question set.");
        } finally {
            setLoading(false);
        }
    }, [session?.access_token, setId]);

    useEffect(() => {
        void loadData();
    }, [loadData]);

    const grouped = useMemo(() => {
        const groups = new Map<QuestionType, QuestionSetItem[]>();
        for (const item of questionSet?.items || []) {
            const current = groups.get(item.type) || [];
            current.push(item);
            groups.set(item.type, current);
        }
        return CATEGORIES
            .map((category) => ({ category, items: groups.get(category.type) || [] }))
            .filter((group) => group.items.length);
    }, [questionSet?.items]);

    const selectedQuestions = useMemo(() => {
        return questions.filter((question) => selectedIds.has(questionKey(question.type, question.id)));
    }, [questions, selectedIds]);

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

    const stats = useMemo(() => {
        const items = questionSet?.items || [];
        return {
            total: items.length,
            easy: items.filter((item) => item.difficulty === "Easy").length,
            medium: items.filter((item) => item.difficulty === "Medium").length,
            hard: items.filter((item) => item.difficulty === "Hard").length,
        };
    }, [questionSet?.items]);

    function openUpdateModal() {
        if (!questionSet) return;
        setTitle(questionSet.title);
        setDescription(questionSet.description || "");
        setStatus(questionSet.status === "draft" ? "draft" : "active");
        setSelectedIds(new Set(questionSet.items.map((item) => questionKey(item.type, item.questionId))));
        setActiveType(questionSet.items[0]?.type || "dsa");
        setSearch("");
        setStep("questions");
        setError(null);
        setMessage(null);
        setBuilderOpen(true);
    }

    function closeBuilder() {
        if (!saving) setBuilderOpen(false);
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
        if (!session?.access_token || !questionSet || saving) return;
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

            const payload = await api.put<QuestionSetResponse>(
                `/companies/question-bank/question-sets/${questionSet.id}`,
                { title: title.trim(), description: description.trim(), status, items },
                session.access_token
            );

            setQuestionSet(payload.questionSet);
            setBuilderOpen(false);
            setMessage("Question set updated.");
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "Failed to update question set.");
        } finally {
            setSaving(false);
        }
    }

    if (loading) {
        return (
            <main className="min-h-full bg-slate-50/50 px-6 py-10 dark:bg-lc-bg">
                <div className="mx-auto max-w-5xl space-y-6">
                    <div className="h-24 rounded-xl border border-slate-200 bg-white/60 dark:border-white/10 dark:bg-white/[0.04]" />
                    <div className="h-44 rounded-xl border border-slate-200 bg-white/60 dark:border-white/10 dark:bg-white/[0.04]" />
                </div>
            </main>
        );
    }

    if (error && !questionSet) {
        return (
            <main className="grid min-h-full place-items-center bg-slate-50/50 px-6 py-10 dark:bg-lc-bg">
                <div className="text-center">
                    <p className="text-sm font-semibold text-red-600 dark:text-red-400">{error}</p>
                    <Link href="/question-bank/sets" className="mt-4 inline-flex text-sm font-extrabold text-primary">
                        Back to sets
                    </Link>
                </div>
            </main>
        );
    }

    if (!questionSet) return null;

    return (
        <main className="min-h-full bg-slate-50/50 pb-16 dark:bg-lc-bg">
            <header className="mx-auto flex w-full max-w-5xl items-start justify-between gap-4 px-6 pt-10">
                <div className="flex min-w-0 items-start gap-4">
                    <Link
                        href="/question-bank/sets"
                        className="mt-1 grid size-10 place-items-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-lc-hover dark:hover:text-white"
                        aria-label="Back to question sets"
                    >
                        <span className="material-symbols-outlined text-[28px]">arrow_back</span>
                    </Link>
                    <div className="min-w-0">
                        <h1 className="font-nunito text-[32px] font-extrabold tracking-tight text-slate-950 dark:text-white">
                            {questionSet.title}
                        </h1>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] font-semibold text-slate-500 dark:text-slate-400">
                            {formatDate(questionSet.updatedAt) && (
                                <span className="flex items-center gap-1">
                                    <span className="material-symbols-outlined text-[15px]">calendar_today</span>
                                    {formatDate(questionSet.updatedAt)}
                                </span>
                            )}
                            {formatTime(questionSet.updatedAt) && (
                                <>
                                    <span className="text-slate-300 dark:text-slate-700">-</span>
                                    <span className="flex items-center gap-1">
                                        <span className="material-symbols-outlined text-[15px]">schedule</span>
                                        {formatTime(questionSet.updatedAt)}
                                    </span>
                                </>
                            )}
                            <span className="text-slate-300 dark:text-slate-700">-</span>
                            <span className="capitalize">{questionSet.status}</span>
                        </div>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={openUpdateModal}
                    className="inline-flex h-12 shrink-0 items-center gap-2 rounded-full bg-blue-600 px-5 text-sm font-extrabold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700"
                >
                    <span className="material-symbols-outlined text-[20px]">edit</span>
                    Update set
                </button>
            </header>

            {message && (
                <div className="mx-auto mt-6 max-w-5xl px-6">
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-300">
                        {message}
                    </div>
                </div>
            )}

            <section className="mx-auto mt-8 max-w-5xl px-6">
                <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/[0.04]">
                    <div className="flex items-center gap-6">
                        <div className="relative shrink-0">
                            <svg width="72" height="72" viewBox="0 0 72 72">
                                <circle cx="36" cy="36" r="30" fill="none" stroke="currentColor" className="text-slate-100 dark:text-slate-800" strokeWidth="6" />
                                <circle cx="36" cy="36" r="30" fill="none" stroke="currentColor" className="text-primary" strokeWidth="6" strokeLinecap="round" strokeDasharray={`${2 * Math.PI * 30}`} strokeDashoffset="0" transform="rotate(-90 36 36)" />
                            </svg>
                            <div className="absolute inset-0 flex items-center justify-center">
                                <span className="text-sm font-bold text-slate-800 dark:text-white">{stats.total}</span>
                            </div>
                        </div>
                        <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-slate-800 dark:text-white">Question Set</p>
                            <p className="mb-3 mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                                {stats.total} question{stats.total === 1 ? "" : "s"} selected
                            </p>
                            <div className="flex flex-wrap items-center gap-4 text-xs">
                                {stats.easy > 0 && <DifficultyCount label="Easy" value={stats.easy} color="bg-emerald-500" />}
                                {stats.medium > 0 && <DifficultyCount label="Medium" value={stats.medium} color="bg-amber-500" />}
                                {stats.hard > 0 && <DifficultyCount label="Hard" value={stats.hard} color="bg-red-500" />}
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            <section className="mx-auto mt-5 max-w-5xl space-y-3 px-6 pb-10">
                {grouped.map(({ category, items }) => (
                    <QuestionGroup key={category.type} setId={questionSet.id} category={category} items={items} />
                ))}
                {!grouped.length && (
                    <div className="rounded-xl border border-slate-200 bg-white p-10 text-center dark:border-white/10 dark:bg-white/[0.04]">
                        <p className="text-sm font-semibold text-slate-500">No questions in this set yet.</p>
                    </div>
                )}
            </section>

            {builderOpen && (
                <div className="fixed inset-0 z-[120] flex items-center justify-center bg-neutral-950/50 px-4 backdrop-blur-sm dark:bg-black/50" onClick={closeBuilder}>
                    <section className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-[0_18px_50px_-12px_rgba(0,0,0,0.25)] dark:border-white/10 dark:bg-[#161616]" onClick={(event) => event.stopPropagation()}>
                        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5 dark:border-lc-border">
                            <div className="flex min-w-0 items-start gap-4">
                                {step === "questions" && (
                                    <button type="button" onClick={() => setStep("details")} className="mt-1 grid size-10 shrink-0 place-items-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-lc-hover dark:hover:text-white" aria-label="Back to set details">
                                        <span className="material-symbols-outlined">arrow_back</span>
                                    </button>
                                )}
                                <div>
                                    <h2 className="font-nunito text-2xl font-extrabold tracking-tight text-slate-950 dark:text-white">
                                        {step === "details" ? "Edit Question Set" : `Add Questions to "${title || "Question Set"}"`}
                                    </h2>
                                    {step === "questions" && <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">Select questions to keep in this interview set.</p>}
                                </div>
                            </div>
                            <button type="button" onClick={closeBuilder} className="grid size-10 shrink-0 place-items-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-lc-hover dark:hover:text-white" aria-label="Close">
                                <span className="material-symbols-outlined">close</span>
                            </button>
                        </header>

                        {error && (
                            <div className="border-b border-slate-200 px-6 py-3 dark:border-lc-border">
                                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300">
                                    {error}
                                </div>
                            </div>
                        )}

                        {step === "details" ? (
                            <form onSubmit={handleDetailsSubmit} className="flex min-h-0 flex-1 flex-col">
                                <div className="space-y-5 overflow-y-auto p-6">
                                    <label className="block">
                                        <span className="text-xs font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">Set name</span>
                                        <input value={title} onChange={(event) => setTitle(event.target.value)} className="mt-2 h-14 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-white/15 dark:bg-[#0f0f0f] dark:text-white" />
                                    </label>
                                    <label className="block">
                                        <span className="text-xs font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">Description</span>
                                        <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} className="mt-2 w-full resize-none rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-white/15 dark:bg-[#0f0f0f] dark:text-white" />
                                    </label>
                                    <div className="inline-flex rounded-full border border-slate-200 bg-slate-100 p-1 dark:border-white/10 dark:bg-[#1a1a1a]">
                                        {(["active", "draft"] as const).map((option) => (
                                            <button key={option} type="button" onClick={() => setStatus(option)} className={`rounded-full px-5 py-2 text-sm font-bold capitalize transition ${status === option ? "bg-white text-primary shadow-sm ring-1 ring-slate-200/60 dark:bg-[#2a2a2a] dark:text-[#B7B2FF] dark:ring-white/10" : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white"}`}>
                                                {option}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <footer className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4 dark:border-lc-border">
                                    <button type="button" onClick={closeBuilder} className="rounded-lg px-4 py-2 text-sm font-bold text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-lc-hover">Cancel</button>
                                    <button type="submit" disabled={!title.trim()} className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">Next</button>
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
                                                <button key={category.type} type="button" onClick={() => setActiveType(category.type)} className={`inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-bold transition ${active ? "bg-primary text-white shadow-lg shadow-primary/15" : "bg-slate-100 text-slate-600 hover:bg-primary/10 hover:text-primary dark:bg-lc-elevated dark:text-slate-300 dark:hover:bg-lc-hover dark:hover:text-white"}`}>
                                                    {category.shortLabel}
                                                    <span className={`rounded-full px-2 py-0.5 text-xs ${active ? "bg-white/20 text-white" : "bg-white text-slate-500 dark:bg-lc-surface"}`}>{count}</span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                    <label className="relative block w-full lg:w-[300px]">
                                        <span className="material-symbols-outlined pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[21px] text-slate-400">search</span>
                                        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${categoryForType(activeType).label}`} className="h-10 w-full rounded-full border border-slate-200 bg-white pl-12 pr-4 text-sm font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-lc-border dark:bg-lc-input dark:text-white" />
                                    </label>
                                </div>
                                <div className="min-h-[360px] flex-1 overflow-y-auto p-6">
                                    {visibleQuestions.length ? (
                                        <div className="space-y-3">
                                            {visibleQuestions.map((question) => {
                                                const selected = selectedIds.has(questionKey(question.type, question.id));
                                                return (
                                                    <button key={questionKey(question.type, question.id)} type="button" onClick={() => toggleQuestion(question)} className={`grid w-full grid-cols-[28px_1fr_auto] items-start gap-4 rounded-lg border px-4 py-4 text-left transition ${selected ? "border-primary bg-primary/5" : "border-slate-200 hover:border-primary/40 hover:bg-slate-50 dark:border-lc-border dark:hover:bg-lc-elevated"}`}>
                                                        <span className={`mt-1 grid size-5 place-items-center rounded border ${selected ? "border-primary bg-primary text-white" : "border-slate-300 text-transparent dark:border-slate-600"}`}><span className="material-symbols-outlined text-[15px]">check</span></span>
                                                        <span className="min-w-0">
                                                            <span className="block font-nunito text-base font-extrabold text-slate-950 dark:text-white">{question.title}</span>
                                                            {question.meta && <span className="mt-1 block text-xs font-bold text-slate-500 dark:text-slate-400">{question.meta}</span>}
                                                        </span>
                                                        {question.difficulty && <span className={`rounded-full px-3 py-1 text-xs font-extrabold ${difficultyPillClass[question.difficulty]}`}>{question.difficulty}</span>}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    ) : (
                                        <div className="grid min-h-[280px] place-items-center text-center">
                                            <p className="text-sm font-bold text-slate-500 dark:text-slate-400">No questions found in this category.</p>
                                        </div>
                                    )}
                                </div>
                                <footer className="flex flex-col gap-4 border-t border-slate-200 px-6 py-4 dark:border-lc-border sm:flex-row sm:items-center sm:justify-between">
                                    <p className="text-sm font-bold text-slate-500 dark:text-slate-400">{selectedQuestions.length} question{selectedQuestions.length === 1 ? "" : "s"} selected</p>
                                    <div className="flex items-center gap-3">
                                        <button type="button" onClick={() => setStep("details")} className="rounded-lg px-4 py-2 text-sm font-bold text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-lc-hover">Back</button>
                                        <button type="button" onClick={() => void saveQuestionSet()} disabled={saving || selectedIds.size === 0} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
                                            {saving && <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
                                            Update Set
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

function DifficultyCount({ label, value, color }: { label: string; value: number; color: string }) {
    return (
        <span className="flex items-center gap-1.5">
            <span className={`size-2 rounded-full ${color}`} />
            <span className="text-slate-600 dark:text-slate-300">{label}</span>
            <span className="font-semibold text-slate-800 dark:text-white">{value}</span>
        </span>
    );
}

function QuestionGroup({
    setId,
    category,
    items,
}: {
    setId: string;
    category: (typeof CATEGORIES)[number];
    items: QuestionSetItem[];
}) {
    const [collapsed, setCollapsed] = useState(false);

    return (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-white/[0.04]">
            <button type="button" onClick={() => setCollapsed((current) => !current)} className="flex w-full items-center justify-between px-5 py-3.5 transition hover:bg-slate-50 dark:hover:bg-white/5">
                <div className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-[20px] text-slate-400" style={{ transform: collapsed ? "rotate(-90deg)" : "rotate(0)" }}>expand_more</span>
                    <span className="text-sm font-semibold text-slate-800 dark:text-white">{category.label}</span>
                </div>
                <div className="flex items-center gap-3">
                    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                        <div className="h-full rounded-full bg-primary" style={{ width: "100%" }} />
                    </div>
                    <span className="min-w-[40px] text-right text-xs font-semibold text-slate-500 dark:text-slate-400">0 / {items.length}</span>
                </div>
            </button>

            {!collapsed && (
                <div className="border-t border-slate-100 dark:border-white/5">
                    <div className="grid grid-cols-[48px_1fr_100px_90px] bg-slate-50/50 px-5 py-2 text-[11px] font-semibold uppercase tracking-widest text-slate-400 dark:bg-white/[0.02] dark:text-slate-500">
                        <span>Status</span>
                        <span>Problem</span>
                        <span>Topic</span>
                        <span className="text-center">Difficulty</span>
                    </div>
                    {items.map((item) => {
                        const diff = (item.difficulty || "Medium").toLowerCase();
                        return (
                            <div key={questionKey(item.type, item.questionId)} className="grid grid-cols-[48px_1fr_100px_90px] items-center border-t border-slate-50 px-5 py-3 transition hover:bg-slate-50/50 dark:border-white/5 dark:hover:bg-white/5">
                                <div>
                                    <span className="flex size-5 rounded border-2 border-slate-300 dark:border-slate-600" />
                                </div>
                                <div className="min-w-0 pr-4">
                                    <Link href={questionIdeHref(setId, item)} className="block truncate text-sm leading-snug text-slate-800 transition hover:text-primary dark:text-slate-200">
                                        {item.title}
                                    </Link>
                                </div>
                                <div className="min-w-0">
                                    <span className="inline-block max-w-full truncate rounded-full bg-cyan-100 px-2.5 py-0.5 text-[10px] font-semibold text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-400">
                                        {category.shortLabel}
                                    </span>
                                </div>
                                <div className="text-center">
                                    <span className={`text-xs font-semibold capitalize ${difficultyTextClass[diff] || "text-slate-500"}`}>
                                        {diff}
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
