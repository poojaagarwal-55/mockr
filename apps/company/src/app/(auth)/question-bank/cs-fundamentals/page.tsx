"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useCompanyAuth } from "@/context/company-auth-context";

type Topic = "CN" | "DBMS" | "OOPS" | "OS";
type Difficulty = "Easy" | "Medium" | "Hard";

type CSQuestion = {
    id: string;
    sourceQuestionId?: string;
    topic: Topic;
    question: string;
    answer?: string;
    answerPreview?: string;
    difficulty?: Difficulty;
    tags?: string[];
    alreadyAdded?: boolean;
};

type QuestionsResponse = {
    questions: CSQuestion[];
    pagination?: { total: number };
};

const topicLabels: Record<Topic, string> = {
    CN: "Computer Networks",
    DBMS: "DBMS",
    OOPS: "OOP",
    OS: "Operating Systems",
};

const topics: Topic[] = ["DBMS", "OS", "CN", "OOPS"];

function previewText(value?: string) {
    return (value || "No answer preview available yet.")
        .replace(/cite[^]*/g, "")
        .replace(/【[^】]*†[^】]*】/g, "")
        .replace(/\[\s*cite\s*:\s*\d+(?:\s*,\s*\d+)*\s*\]/gi, "")
        .replace(/\[(?:\d+|citation needed|source)(?:\s*,\s*\d+)*\]/gi, "")
        .replace(/\s+\((?:\d+|source|citation)(?:\s*,\s*\d+)*\)/gi, "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

export default function CSFundamentalsQuestionBankPage() {
    const searchParams = useSearchParams();
    const { session } = useCompanyAuth();
    const shouldOpenDataset = searchParams.get("add") === "1" || searchParams.get("dataset") === "1";
    const [questions, setQuestions] = useState<CSQuestion[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState("");
    const [selectedTopic, setSelectedTopic] = useState<Topic | null>(null);
    const [datasetOpen, setDatasetOpen] = useState(false);
    const [datasetQuestions, setDatasetQuestions] = useState<CSQuestion[]>([]);
    const [datasetTotal, setDatasetTotal] = useState(0);
    const [datasetSearch, setDatasetSearch] = useState("");
    const [datasetTopic, setDatasetTopic] = useState<Topic | null>(null);
    const [datasetLoading, setDatasetLoading] = useState(false);
    const [datasetError, setDatasetError] = useState<string | null>(null);
    const [importingIds, setImportingIds] = useState<Set<string>>(new Set());
    const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());

    const loadQuestions = useCallback(async () => {
        if (!session?.access_token) {
            setLoading(false);
            return;
        }

        setLoading(true);
        setError(null);
        try {
            const payload = await api.get<QuestionsResponse>("/companies/question-bank/cs-fundamentals?limit=100", session.access_token);
            setQuestions(payload.questions || []);
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "Failed to load CS fundamentals questions.");
        } finally {
            setLoading(false);
        }
    }, [session?.access_token]);

    useEffect(() => {
        void loadQuestions();
    }, [loadQuestions]);

    const loadDatasetQuestions = useCallback(async () => {
        if (!session?.access_token) return;

        setDatasetLoading(true);
        setDatasetError(null);
        try {
            const params = new URLSearchParams({ limit: "150" });
            if (datasetSearch.trim()) params.set("search", datasetSearch.trim());
            if (datasetTopic) params.set("topic", datasetTopic);
            const payload = await api.get<QuestionsResponse>(`/companies/question-bank/cs-fundamentals/dataset?${params.toString()}`, session.access_token);
            setDatasetQuestions(payload.questions || []);
            setDatasetTotal(payload.pagination?.total || 0);
        } catch (err) {
            setDatasetError(err instanceof ApiError ? err.message : "Failed to load CS fundamentals dataset.");
        } finally {
            setDatasetLoading(false);
        }
    }, [datasetSearch, datasetTopic, session?.access_token]);

    useEffect(() => {
        if (datasetOpen) void loadDatasetQuestions();
    }, [datasetOpen, loadDatasetQuestions]);

    useEffect(() => {
        if (shouldOpenDataset) setDatasetOpen(true);
    }, [shouldOpenDataset]);

    async function importDatasetQuestion(questionId: string) {
        if (!session?.access_token) return;

        setImportingIds(new Set([questionId]));
        setDatasetError(null);
        try {
            const result = await api.post<{ imported?: number; skipped?: number; missing?: number }>(
                "/companies/question-bank/cs-fundamentals/import",
                { questionIds: [questionId] },
                session.access_token
            );
            await Promise.all([loadQuestions(), loadDatasetQuestions()]);
            if (!result.imported && result.skipped) setDatasetError("This question is already available in your CS fundamentals bank.");
            else if (!result.imported && result.missing) setDatasetError("This CS fundamentals question could not be found in the dataset.");
        } catch (err) {
            setDatasetError(err instanceof ApiError ? err.message : "Failed to import CS fundamentals question.");
        } finally {
            setImportingIds(new Set());
        }
    }

    async function removeQuestion(questionId: string) {
        if (!session?.access_token || removingIds.size > 0) return;

        const question = questions.find((item) => item.id === questionId);
        if (question && !question.sourceQuestionId) {
            const confirmed = window.confirm("Are you sure you want to remove a question you created?");
            if (!confirmed) return;
        }

        setRemovingIds(new Set([questionId]));
        setError(null);
        try {
            await api.delete(`/companies/question-bank/cs-fundamentals/${questionId}`, session.access_token);
            await Promise.all([loadQuestions(), datasetOpen ? loadDatasetQuestions() : Promise.resolve()]);
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "Failed to remove CS fundamentals question.");
        } finally {
            setRemovingIds(new Set());
        }
    }

    const normalizedSearch = search.trim().toLowerCase();
    const visibleQuestions = useMemo(() => questions.filter((question) => {
        const matchesSearch =
            !normalizedSearch ||
            question.question.toLowerCase().includes(normalizedSearch) ||
            previewText(question.answer || question.answerPreview).toLowerCase().includes(normalizedSearch) ||
            question.tags?.some((tag) => tag.toLowerCase().includes(normalizedSearch));
        const matchesTopic = !selectedTopic || question.topic === selectedTopic;
        return matchesSearch && matchesTopic;
    }), [normalizedSearch, questions, selectedTopic]);

    return (
        <main className="min-h-full bg-[#FAFBFC] pb-16 dark:bg-lc-bg">
            <div className="flex items-center gap-4 px-4 py-8 sm:px-6 lg:px-10">
                <Link href="/question-bank" className="grid size-10 place-items-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-lc-hover dark:hover:text-white" aria-label="Back to question bank">
                    <span className="material-symbols-outlined">arrow_back</span>
                </Link>
                <h1 className="font-nunito text-3xl font-extrabold tracking-tight text-slate-950 dark:text-white sm:text-4xl">
                    CS Fundamentals
                </h1>
            </div>

            <section className="px-4 sm:px-6 lg:px-10">
                <div className="flex flex-col gap-5">
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                        <label className="relative block w-full sm:w-[360px]">
                            <span className="material-symbols-outlined pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[24px] text-slate-400">search</span>
                            <input
                                value={search}
                                onChange={(event) => setSearch(event.target.value)}
                                placeholder="Search questions"
                                className="h-14 w-full rounded-full border border-slate-200 bg-white pl-14 pr-4 text-sm font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-surface dark:text-white"
                            />
                        </label>

                        {!loading && questions.length > 0 && (
                            <div className="flex flex-wrap items-center gap-3">
                                <button type="button" onClick={() => setDatasetOpen(true)} className="inline-flex h-12 items-center gap-2 rounded-full bg-primary px-5 text-sm font-extrabold text-white shadow-lg shadow-primary/20 transition hover:bg-primary/90">
                                    <span className="material-symbols-outlined text-[20px]">library_add</span>
                                    Add existing
                                </button>
                                <Link href="/question-bank/cs-fundamentals/create-question" className="inline-flex h-12 items-center gap-2 rounded-full bg-slate-100 px-5 text-sm font-extrabold text-slate-700 transition hover:bg-slate-200 dark:bg-lc-elevated dark:text-slate-200 dark:hover:bg-lc-hover dark:hover:text-white">
                                    <span className="material-symbols-outlined text-[20px]">add</span>
                                    Create new
                                </Link>
                            </div>
                        )}
                    </div>

                    <div className="flex flex-wrap gap-3">
                        {topics.map((topic) => {
                            const active = selectedTopic === topic;
                            return (
                                <button key={topic} type="button" onClick={() => setSelectedTopic(active ? null : topic)} className={`inline-flex h-11 items-center rounded-full px-5 text-sm font-extrabold transition ${active ? "bg-primary text-white" : "bg-slate-100 text-slate-700 hover:bg-primary/10 hover:text-primary dark:bg-lc-surface dark:text-slate-200 dark:hover:bg-lc-hover dark:hover:text-white"}`}>
                                    {topicLabels[topic]}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {error && <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</div>}

                {loading ? (
                    <div className="mt-12 grid min-h-[280px] place-items-center">
                        <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
                    </div>
                ) : questions.length === 0 ? (
                    <div className="mt-12 rounded-2xl bg-white p-8 text-center shadow-sm dark:bg-lc-surface">
                        <h2 className="font-nunito text-2xl font-extrabold text-slate-950 dark:text-white">No CS fundamentals questions yet</h2>
                        <p className="mx-auto mt-2 max-w-2xl text-sm font-semibold leading-6 text-slate-500 dark:text-slate-400">
                            Add theory questions from the dataset or create a company-owned question with your own answer.
                        </p>
                        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
                            <button type="button" onClick={() => setDatasetOpen(true)} className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-extrabold text-white shadow-lg shadow-primary/20 transition hover:bg-primary/90">
                                <span className="material-symbols-outlined text-[20px]">library_add</span>
                                Add questions from our dataset
                            </button>
                            <Link href="/question-bank/cs-fundamentals/create-question" className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-slate-100 px-5 text-sm font-extrabold text-slate-700 transition hover:bg-slate-200 dark:bg-lc-elevated dark:text-slate-200 dark:hover:bg-lc-hover dark:hover:text-white">
                                <span className="material-symbols-outlined text-[20px]">add</span>
                                Create custom question
                            </Link>
                        </div>
                    </div>
                ) : (
                    <div className="mt-8 overflow-hidden rounded-xl bg-white shadow-sm dark:bg-lc-surface">
                        {visibleQuestions.map((question) => (
                            <div key={question.id} className="flex flex-col gap-4 border-b border-slate-100 px-6 py-5 last:border-b-0 dark:border-lc-border lg:flex-row lg:items-center lg:justify-between">
                                <Link href={`/question-bank/cs-fundamentals/${question.id}`} className="min-w-0 flex-1 transition hover:text-primary">
                                    <div className="flex flex-wrap items-center gap-3">
                                        <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-extrabold text-primary">{topicLabels[question.topic]}</span>
                                        <h2 className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">{question.question}</h2>
                                    </div>
                                    <p className="mt-2 line-clamp-2 text-sm font-semibold leading-6 text-slate-500 dark:text-slate-400">{previewText(question.answer || question.answerPreview)}</p>
                                </Link>
                                <button type="button" onClick={() => removeQuestion(question.id)} disabled={removingIds.has(question.id)} className="inline-flex h-10 w-fit items-center rounded-full bg-slate-100 px-4 text-sm font-extrabold text-slate-600 transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-lc-elevated dark:text-slate-300 dark:hover:bg-red-400/10 dark:hover:text-red-300">
                                    {removingIds.has(question.id) ? "Removing..." : "Remove"}
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            {!loading && questions.length > 0 && (
                <div className="fixed bottom-6 right-6 rounded-full bg-slate-100/95 px-4 py-2 text-sm font-extrabold text-slate-600 shadow-sm ring-1 ring-slate-200 backdrop-blur dark:bg-lc-surface dark:text-slate-300 dark:ring-lc-border">
                    Number of questions = {questions.length}
                </div>
            )}

            {datasetOpen && (
                <div className="fixed inset-0 z-[120] overflow-y-auto bg-white dark:bg-lc-bg">
                    <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-4 py-5 backdrop-blur dark:border-lc-border dark:bg-lc-bg/95 sm:px-6 lg:px-10">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-primary">Practers Dataset</p>
                                <h2 className="font-nunito text-3xl font-extrabold text-slate-950 dark:text-white">Add CS Fundamentals Questions</h2>
                                <p className="mt-2 text-sm font-bold text-slate-500 dark:text-slate-400">{datasetTotal} questions available from our dataset.</p>
                            </div>
                            <button type="button" onClick={() => setDatasetOpen(false)} className="grid size-10 place-items-center rounded-full text-slate-500 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-lc-hover" aria-label="Close dataset">
                                <span className="material-symbols-outlined">close</span>
                            </button>
                        </div>
                        <div className="mt-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                            <label className="relative block w-full lg:w-[420px]">
                                <span className="material-symbols-outlined pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[24px] text-slate-400">search</span>
                                <input
                                    value={datasetSearch}
                                    onChange={(event) => setDatasetSearch(event.target.value)}
                                    placeholder="Search dataset questions"
                                    className="h-14 w-full rounded-full border border-slate-200 bg-white pl-14 pr-4 text-sm font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-surface dark:text-white"
                                />
                            </label>
                            <div className="flex flex-wrap gap-2">
                                <button type="button" onClick={() => setDatasetTopic(null)} className={`h-11 rounded-full px-4 text-sm font-extrabold transition ${!datasetTopic ? "bg-primary text-white" : "bg-slate-100 text-slate-600 dark:bg-lc-surface dark:text-slate-300 dark:hover:bg-lc-hover dark:hover:text-white"}`}>All</button>
                                {topics.map((topic) => (
                                    <button key={topic} type="button" onClick={() => setDatasetTopic(topic)} className={`h-11 rounded-full px-4 text-sm font-extrabold transition ${datasetTopic === topic ? "bg-primary text-white" : "bg-slate-100 text-slate-600 dark:bg-lc-surface dark:text-slate-300 dark:hover:bg-lc-hover dark:hover:text-white"}`}>{topic}</button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {datasetError && <div className="mx-4 mt-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700 sm:mx-6 lg:mx-10">{datasetError}</div>}

                    <div className="px-4 py-5 sm:px-6 lg:px-10">
                        {datasetLoading ? (
                            <div className="grid min-h-[280px] place-items-center">
                                <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
                            </div>
                        ) : (
                            <div className="divide-y divide-slate-100 overflow-hidden rounded-xl bg-white shadow-sm dark:divide-lc-border dark:bg-lc-surface">
                                {datasetQuestions.map((question) => (
                                    <div key={question.id} className="grid gap-4 px-6 py-5 lg:grid-cols-[1fr_auto] lg:items-center">
                                        <Link href={`/question-bank/cs-fundamentals/${question.id}?source=dataset`} className="min-w-0 pr-2 transition hover:text-primary">
                                            <div className="flex flex-wrap items-center gap-3">
                                                <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-extrabold text-primary">{topicLabels[question.topic]}</span>
                                                <h3 className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">{question.question}</h3>
                                            </div>
                                            <p className="mt-2 line-clamp-2 text-sm font-semibold leading-6 text-slate-500 dark:text-slate-400">{previewText(question.answerPreview)}</p>
                                        </Link>
                                        <button type="button" onClick={() => importDatasetQuestion(question.id)} disabled={question.alreadyAdded || importingIds.has(question.id)} className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-extrabold text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-primary/15 disabled:text-primary">
                                            <span className="material-symbols-outlined text-[19px]">{question.alreadyAdded ? "check" : "add"}</span>
                                            {question.alreadyAdded ? "Added" : importingIds.has(question.id) ? "Adding..." : "Add"}
                                        </button>
                                    </div>
                                ))}
                                {!datasetQuestions.length && (
                                    <div className="p-8 text-center text-sm font-semibold text-slate-500 dark:text-slate-400">No dataset questions found.</div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </main>
    );
}
