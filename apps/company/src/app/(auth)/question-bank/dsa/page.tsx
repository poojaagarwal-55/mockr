"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useCompanyAuth } from "@/context/company-auth-context";

type DSAQuestion = {
    id: string;
    sourceQuestionId?: string;
    sourceCollection?: string;
    title: string;
    problemId?: string;
    frontendId?: string;
    difficulty: "Easy" | "Medium" | "Hard";
    topics?: string[];
    status?: "draft" | "published" | "archived";
    updatedAt?: string;
};

type DSAQuestionsResponse = {
    questions: DSAQuestion[];
    pagination: {
        total: number;
    };
};

type DatasetQuestion = DSAQuestion & {
    slug?: string;
    description?: string;
    sampleTestCaseCount?: number;
    hiddenTestCaseCount?: number;
    testCaseCount?: number;
    estimatedTimeMinutes?: number;
    alreadyAdded?: boolean;
};

type DatasetQuestionsResponse = {
    questions: DatasetQuestion[];
    pagination: {
        total: number;
    };
};

type DatasetDifficultyFilter = "All" | DSAQuestion["difficulty"];

const difficultyClass: Record<DSAQuestion["difficulty"], string> = {
    Easy: "text-emerald-500",
    Medium: "text-amber-500",
    Hard: "text-red-500",
};

const difficultyLabel: Record<DSAQuestion["difficulty"], string> = {
    Easy: "Easy",
    Medium: "Med",
    Hard: "Hard",
};

const difficultyPillClass: Record<DSAQuestion["difficulty"], string> = {
    Easy: "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300",
    Medium: "bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300",
    Hard: "bg-red-50 text-red-700 dark:bg-red-400/10 dark:text-red-300",
};

const datasetDifficultyOptions: DatasetDifficultyFilter[] = ["All", "Easy", "Medium", "Hard"];

function previewProblemDescription(value: string | undefined) {
    if (!value) return "No description available yet.";
    const normalized = value
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/\r\n/g, "\n");
    const cutoffIndex = normalized.search(/\b(?:examples?|custom\s+judge)\b/i);
    const beforeExamples = cutoffIndex >= 0 ? normalized.slice(0, cutoffIndex) : normalized;
    return beforeExamples
        .replace(/```[\s\S]*?```/g, "")
        .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
        .replace(/[*_~`>#]/g, "")
        .replace(/\s+/g, " ")
        .trim() || "No description available yet.";
}

function topicCounts(questions: DSAQuestion[], limit = 8) {
    const counts = new Map<string, number>();
    for (const question of questions) {
        for (const topic of question.topics || []) {
            counts.set(topic, (counts.get(topic) || 0) + 1);
        }
    }
    return Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, limit);
}

export default function DSAQuestionBankPage() {
    const searchParams = useSearchParams();
    const { session } = useCompanyAuth();
    const shouldOpenDataset = searchParams.get("add") === "1" || searchParams.get("dataset") === "1";
    const [questions, setQuestions] = useState<DSAQuestion[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState("");
    const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
    const [datasetOpen, setDatasetOpen] = useState(false);
    const [datasetQuestions, setDatasetQuestions] = useState<DatasetQuestion[]>([]);
    const [datasetTotal, setDatasetTotal] = useState(0);
    const [datasetSearch, setDatasetSearch] = useState("");
    const [datasetDifficulty, setDatasetDifficulty] = useState<DatasetDifficultyFilter>("All");
    const [datasetTopic, setDatasetTopic] = useState("All");
    const [datasetTopics, setDatasetTopics] = useState<[string, number][]>([]);
    const [datasetLoading, setDatasetLoading] = useState(false);
    const [datasetError, setDatasetError] = useState<string | null>(null);
    const [selectedDatasetIds, setSelectedDatasetIds] = useState<Set<string>>(new Set());
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
            const payload = await api.get<DSAQuestionsResponse>(
                "/companies/question-bank/dsa?limit=100",
                session.access_token
            );
            setQuestions(payload.questions || []);
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "Failed to load DSA questions.");
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
            if (datasetDifficulty !== "All") params.set("difficulty", datasetDifficulty);
            if (datasetTopic !== "All") params.set("topic", datasetTopic);

            const payload = await api.get<DatasetQuestionsResponse>(
                `/companies/question-bank/dsa/dataset?${params.toString()}`,
                session.access_token
            );
            const nextQuestions = payload.questions || [];
            setDatasetQuestions(nextQuestions);
            setDatasetTotal(payload.pagination?.total || 0);
            if (datasetDifficulty === "All" && datasetTopic === "All" && !datasetSearch.trim()) {
                setDatasetTopics(topicCounts(nextQuestions, 100));
            }
            setSelectedDatasetIds(new Set());
        } catch (err) {
            setDatasetError(err instanceof ApiError ? err.message : "Failed to load dataset questions.");
        } finally {
            setDatasetLoading(false);
        }
    }, [datasetDifficulty, datasetSearch, datasetTopic, session?.access_token]);

    useEffect(() => {
        if (datasetOpen) void loadDatasetQuestions();
    }, [datasetOpen, loadDatasetQuestions]);

    useEffect(() => {
        if (shouldOpenDataset) setDatasetOpen(true);
    }, [shouldOpenDataset]);

    async function importDatasetQuestions(questionIds: string[]) {
        if (!session?.access_token || questionIds.length === 0) return;

        setImportingIds(new Set(questionIds));
        setDatasetError(null);
        try {
            await api.post(
                "/companies/question-bank/dsa/import",
                { questionIds },
                session.access_token
            );
            await Promise.all([loadQuestions(), loadDatasetQuestions()]);
        } catch (err) {
            setDatasetError(err instanceof ApiError ? err.message : "Failed to import questions.");
        } finally {
            setImportingIds(new Set());
        }
    }

    async function removeQuestion(questionId: string) {
        if (!session?.access_token || removingIds.size > 0) return;

        const question = questions.find((item) => item.id === questionId);
        const isCustomQuestion = question && !question.sourceQuestionId;
        if (isCustomQuestion) {
            const confirmed = window.confirm("Are you sure you want to remove a question you created?");
            if (!confirmed) return;
        }

        setRemovingIds(new Set([questionId]));
        setError(null);
        try {
            await api.delete(`/companies/question-bank/dsa/${questionId}`, session.access_token);
            await Promise.all([
                loadQuestions(),
                datasetOpen ? loadDatasetQuestions() : Promise.resolve(),
            ]);
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "Failed to remove question.");
        } finally {
            setRemovingIds(new Set());
        }
    }

    function toggleDatasetSelection(questionId: string) {
        setSelectedDatasetIds((current) => {
            const next = new Set(current);
            if (next.has(questionId)) next.delete(questionId);
            else next.add(questionId);
            return next;
        });
    }

    const topics = useMemo(() => topicCounts(questions), [questions]);
    const normalizedSearch = search.trim().toLowerCase();
    const visibleQuestions = useMemo(() => {
        return questions.filter((question) => {
            const matchesSearch =
                !normalizedSearch ||
                question.title.toLowerCase().includes(normalizedSearch) ||
                question.problemId?.toLowerCase().includes(normalizedSearch) ||
                question.frontendId?.toLowerCase().includes(normalizedSearch) ||
                question.topics?.some((topic) => topic.toLowerCase().includes(normalizedSearch));

            const matchesTopic = !selectedTopic || question.topics?.includes(selectedTopic);
            return matchesSearch && matchesTopic;
        });
    }, [normalizedSearch, questions, selectedTopic]);

    return (
        <main className="min-h-full bg-[#FAFBFC] pb-16 dark:bg-lc-bg">
            <div className="flex items-center gap-4 px-4 py-8 sm:px-6 lg:px-10">
                <Link
                    href="/question-bank"
                    className="grid size-10 place-items-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-lc-hover dark:hover:text-white"
                    aria-label="Back to question bank"
                >
                    <span className="material-symbols-outlined">arrow_back</span>
                </Link>
                <h1 className="font-nunito text-3xl font-extrabold tracking-tight text-slate-950 dark:text-white sm:text-4xl">
                    DSA Questions
                </h1>
            </div>

            <section className="px-4 sm:px-6 lg:px-10">
                <div className="flex flex-col gap-5">
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                        <div className="flex flex-wrap items-center gap-3">
                            <label className="relative block w-full sm:w-[360px]">
                                <span className="material-symbols-outlined pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[24px] text-slate-400">
                                    search
                                </span>
                                <input
                                    value={search}
                                    onChange={(event) => setSearch(event.target.value)}
                                    placeholder="Search questions"
                                    className="h-14 w-full rounded-full border border-slate-200 bg-white pl-14 pr-4 text-sm font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-surface dark:text-white"
                                />
                            </label>
                            <button
                                type="button"
                                className="grid size-14 place-items-center rounded-full bg-primary/10 text-primary transition hover:bg-primary hover:text-white"
                                aria-label="Filter questions"
                            >
                                <span className="material-symbols-outlined">filter_alt</span>
                            </button>
                            <button
                                type="button"
                                className="grid size-14 place-items-center rounded-full bg-primary/10 text-primary transition hover:bg-primary hover:text-white"
                                aria-label="Sort questions"
                            >
                                <span className="material-symbols-outlined">sort</span>
                            </button>
                        </div>

                        {!loading && questions.length > 0 && (
                            <div className="flex flex-wrap items-center gap-3">
                                <button
                                    type="button"
                                    onClick={() => setDatasetOpen(true)}
                                    className="inline-flex h-12 items-center gap-2 rounded-full bg-primary px-5 text-sm font-extrabold text-white shadow-lg shadow-primary/20 transition hover:bg-primary/90"
                                >
                                    <span className="material-symbols-outlined text-[20px]">library_add</span>
                                    Add existing
                                </button>
                                <Link
                                    href="/question-bank/dsa/create-question"
                                    className="inline-flex h-12 items-center gap-2 rounded-full bg-slate-100 px-5 text-sm font-extrabold text-slate-700 transition hover:bg-slate-200 dark:bg-lc-elevated dark:text-slate-200 dark:hover:bg-lc-hover dark:hover:text-white"
                                >
                                    <span className="material-symbols-outlined text-[20px]">add</span>
                                    Create new
                                </Link>
                            </div>
                        )}
                    </div>

                    {topics.length > 0 && (
                        <div className="flex flex-wrap gap-3">
                            {topics.map(([topic, count]) => {
                                const active = selectedTopic === topic;
                                return (
                                    <button
                                        key={topic}
                                        type="button"
                                        onClick={() => setSelectedTopic(active ? null : topic)}
                                        className={`inline-flex h-11 items-center gap-2 rounded-full px-5 text-sm font-extrabold transition ${
                                            active
                                                ? "bg-primary text-white"
                                                : "bg-slate-100 text-slate-700 hover:bg-primary/10 hover:text-primary dark:bg-lc-surface dark:text-slate-200 dark:hover:bg-lc-hover dark:hover:text-white"
                                        }`}
                                    >
                                        {topic}
                                        <span className={`rounded-full px-2 py-0.5 text-xs ${active ? "bg-white/20 text-white" : "bg-slate-200 text-slate-500 dark:bg-lc-elevated dark:text-slate-300"}`}>
                                            {count}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            </section>

            <section className="mt-10">
                {loading ? (
                    <div className="px-4 sm:px-6 lg:px-10">
                        <div className="grid min-h-[360px] place-items-center rounded-lg bg-white dark:bg-lc-surface">
                            <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
                        </div>
                    </div>
                ) : error ? (
                    <div className="px-4 sm:px-6 lg:px-10">
                        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300">
                            {error}
                        </div>
                    </div>
                ) : questions.length === 0 ? (
                    <div className="px-4 sm:px-6 lg:px-10">
                        <div className="grid min-h-[420px] place-items-center rounded-lg bg-white p-8 text-center shadow-sm dark:bg-lc-surface">
                            <div className="max-w-xl">
                                <span className="mx-auto flex size-16 items-center justify-center rounded-xl bg-primary/10 text-primary">
                                    <span className="material-symbols-outlined text-4xl">code</span>
                                </span>
                                <h2 className="mt-5 font-nunito text-2xl font-extrabold text-slate-950 dark:text-white">
                                    No DSA questions added yet
                                </h2>
                                <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                                    Start by importing from the Practers dataset or create a company-owned custom coding question.
                                </p>
                                <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
                                    <button
                                        type="button"
                                        onClick={() => setDatasetOpen(true)}
                                        className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-extrabold text-white shadow-lg shadow-primary/20 transition hover:bg-primary/90"
                                    >
                                        <span className="material-symbols-outlined text-[20px]">library_add</span>
                                        Add questions from our dataset
                                    </button>
                                    <Link
                                        href="/question-bank/dsa/create-question"
                                        className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-slate-100 px-5 text-sm font-extrabold text-slate-700 transition hover:bg-slate-200 dark:bg-lc-elevated dark:text-slate-200 dark:hover:bg-lc-hover dark:hover:text-white"
                                    >
                                        <span className="material-symbols-outlined text-[20px]">add</span>
                                        Create custom question
                                    </Link>
                                </div>
                            </div>
                        </div>
                    </div>
                ) : visibleQuestions.length === 0 ? (
                    <div className="px-4 sm:px-6 lg:px-10">
                        <div className="grid min-h-[260px] place-items-center rounded-lg bg-white p-8 text-center shadow-sm dark:bg-lc-surface">
                            <div>
                                <span className="material-symbols-outlined text-5xl text-slate-300 dark:text-slate-600">search_off</span>
                                <h2 className="mt-3 font-nunito text-xl font-extrabold text-slate-950 dark:text-white">No matching questions</h2>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setSearch("");
                                        setSelectedTopic(null);
                                    }}
                                    className="mt-4 rounded-full bg-primary/10 px-5 py-2.5 text-sm font-extrabold text-primary hover:bg-primary hover:text-white"
                                >
                                    Clear filters
                                </button>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="divide-y divide-white dark:divide-lc-bg">
                        {visibleQuestions.map((question, index) => {
                            const removing = removingIds.has(question.id);
                            return (
                                <div
                                    key={question.id}
                                    className={`grid min-h-[82px] grid-cols-[28px_1fr_auto_48px] items-center gap-3 px-4 text-left transition sm:px-6 lg:px-10 ${
                                        index % 2 === 0 ? "bg-slate-50 dark:bg-lc-elevated" : "bg-white dark:bg-lc-surface"
                                    }`}
                                >
                                    <span className="size-2 rounded-full bg-slate-300 dark:bg-slate-600" />
                                    <Link
                                        href={`/question-bank/dsa/${question.id}`}
                                        className="min-w-0 py-5 transition hover:text-primary"
                                    >
                                        <span className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">
                                            {question.title}
                                        </span>
                                    </Link>
                                    <span className={`text-sm font-extrabold ${difficultyClass[question.difficulty]}`}>
                                        {difficultyLabel[question.difficulty]}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => void removeQuestion(question.id)}
                                        disabled={removingIds.size > 0}
                                        className="grid size-10 place-items-center rounded-full text-slate-400 transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-red-400/10 dark:hover:text-red-300"
                                        aria-label={`Remove ${question.title}`}
                                    >
                                        {removing ? (
                                            <span className="size-4 animate-spin rounded-full border-2 border-red-300/40 border-t-red-500" />
                                        ) : (
                                            <span className="material-symbols-outlined text-[21px]">remove</span>
                                        )}
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )}
            </section>

            {datasetOpen && (
                <div className="fixed inset-0 z-[160] overflow-y-auto bg-white dark:bg-lc-bg">
                    <div className="min-h-full bg-white dark:bg-lc-bg">
                        <div className="sticky top-0 z-10 flex flex-col gap-4 border-b border-slate-200 bg-white/95 px-4 py-5 backdrop-blur dark:border-lc-border dark:bg-lc-bg/95 sm:px-6 lg:flex-row lg:items-start lg:justify-between lg:px-10">
                            <div>
                                <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Practers Dataset</p>
                                <h2 className="font-nunito text-2xl font-extrabold text-slate-950 dark:text-white">Add DSA Questions</h2>
                                <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">
                                    {datasetLoading ? "Loading questions..." : `${datasetTotal} questions available from our dataset.`}
                                </p>
                            </div>
                            <div className="flex flex-wrap items-center gap-3">
                                {selectedDatasetIds.size > 0 && (
                                    <button
                                        type="button"
                                        onClick={() => void importDatasetQuestions(Array.from(selectedDatasetIds))}
                                        disabled={importingIds.size > 0}
                                        className="inline-flex h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-extrabold text-white shadow-lg shadow-primary/20 transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        {importingIds.size > 0 ? <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : <span className="material-symbols-outlined text-[19px]">library_add</span>}
                                        Add selected ({selectedDatasetIds.size})
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={() => setDatasetOpen(false)}
                                    className="grid size-10 place-items-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-lc-hover dark:hover:text-white"
                                    aria-label="Close dataset picker"
                                >
                                    <span className="material-symbols-outlined">close</span>
                                </button>
                            </div>
                        </div>

                        <div className="border-b border-slate-200 px-4 py-4 dark:border-lc-border sm:px-6 lg:px-10">
                            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                                <label className="relative block w-full xl:max-w-md">
                                    <span className="material-symbols-outlined pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[22px] text-slate-400">search</span>
                                    <input
                                        value={datasetSearch}
                                        onChange={(event) => setDatasetSearch(event.target.value)}
                                        placeholder="Search dataset questions"
                                        className="h-12 w-full rounded-full border border-slate-200 bg-white pl-12 pr-4 text-sm font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-input dark:text-white"
                                    />
                                </label>

                                <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                                    <label className="relative block min-w-[210px]">
                                        <span className="material-symbols-outlined pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[20px] text-slate-400">sell</span>
                                        <select
                                            value={datasetTopic}
                                            onChange={(event) => setDatasetTopic(event.target.value)}
                                            className="h-11 w-full appearance-none rounded-full border border-slate-200 bg-white pl-11 pr-10 text-sm font-extrabold text-slate-700 outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-input dark:text-white"
                                            aria-label="Filter dataset by topic"
                                        >
                                            <option value="All">All topics</option>
                                            {datasetTopics.map(([topic, count]) => (
                                                <option key={topic} value={topic}>
                                                    {topic} ({count})
                                                </option>
                                            ))}
                                        </select>
                                        <span className="material-symbols-outlined pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[20px] text-slate-400">expand_more</span>
                                    </label>

                                    <div className="flex flex-wrap gap-2">
                                        {datasetDifficultyOptions.map((difficulty) => {
                                            const active = datasetDifficulty === difficulty;
                                            return (
                                                <button
                                                    key={difficulty}
                                                    type="button"
                                                    onClick={() => setDatasetDifficulty(difficulty)}
                                                    className={`h-11 rounded-full px-4 text-sm font-extrabold transition ${
                                                        active
                                                            ? "bg-primary text-white shadow-lg shadow-primary/15"
                                                            : "bg-slate-100 text-slate-600 hover:bg-primary/10 hover:text-primary dark:bg-lc-elevated dark:text-slate-300 dark:hover:bg-primary/15 dark:hover:text-primary"
                                                    }`}
                                                >
                                                    {difficulty === "Medium" ? "Med" : difficulty}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {datasetError && (
                            <div className="mx-4 mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300 sm:mx-6 lg:mx-10">
                                {datasetError}
                            </div>
                        )}

                        <div className="px-4 py-5 sm:px-6 lg:px-10">
                            {datasetLoading ? (
                                <div className="grid min-h-[420px] place-items-center">
                                    <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
                                </div>
                            ) : datasetQuestions.length === 0 ? (
                                <div className="grid min-h-[320px] place-items-center px-6 text-center">
                                    <div>
                                        <span className="material-symbols-outlined text-5xl text-slate-300 dark:text-slate-600">search_off</span>
                                        <h3 className="mt-3 font-nunito text-xl font-extrabold text-slate-950 dark:text-white">No dataset questions found</h3>
                                    </div>
                                </div>
                            ) : (
                                <div className="divide-y divide-slate-100 overflow-hidden rounded-xl bg-white shadow-sm dark:divide-lc-border dark:bg-lc-surface">
                                    {datasetQuestions.map((question, index) => {
                                        const selected = selectedDatasetIds.has(question.id);
                                        const importing = importingIds.has(question.id);
                                        const disabled = Boolean(question.alreadyAdded || importingIds.size > 0);
                                        return (
                                            <div
                                                key={question.id}
                                                className={`grid gap-4 px-6 py-5 transition lg:grid-cols-[28px_minmax(0,1fr)_auto] ${
                                                    index % 2 === 0 ? "bg-slate-50 dark:bg-lc-elevated" : "bg-white dark:bg-lc-surface"
                                                }`}
                                            >
                                                <button
                                                    type="button"
                                                    onClick={() => toggleDatasetSelection(question.id)}
                                                    disabled={disabled}
                                                    className={`mt-0.5 grid size-5 place-items-center rounded border transition disabled:cursor-not-allowed disabled:opacity-50 ${
                                                        selected
                                                            ? "border-primary bg-primary text-white"
                                                            : "border-slate-300 text-transparent hover:border-primary dark:border-slate-600"
                                                    }`}
                                                    aria-label={`Select ${question.title}`}
                                                >
                                                    <span className="material-symbols-outlined text-[15px]">check</span>
                                                </button>
                                                <Link
                                                    href={`/question-bank/dsa/${question.id}?source=dataset`}
                                                    className="min-w-0 pr-2 transition hover:text-primary"
                                                >
                                                    <div className="flex flex-wrap items-center gap-3">
                                                        <p className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">
                                                            <span className="mr-2 text-sm font-bold text-slate-500 dark:text-slate-400">
                                                                {question.frontendId || question.problemId || index + 1}.
                                                            </span>
                                                            {question.title}
                                                        </p>
                                                        <span className={`rounded-full px-3 py-1 text-xs font-extrabold ${difficultyPillClass[question.difficulty]}`}>
                                                            {difficultyLabel[question.difficulty]}
                                                        </span>
                                                    </div>
                                                    <p className="mt-4 max-w-4xl text-sm font-medium leading-6 text-slate-600 dark:text-slate-300">
                                                        {previewProblemDescription(question.description)}
                                                    </p>
                                                    <div className="mt-5 flex flex-wrap items-center gap-x-8 gap-y-3 text-sm font-semibold text-slate-500 dark:text-slate-400">
                                                        <span className="inline-flex min-w-0 items-center gap-2">
                                                            <span className="material-symbols-outlined text-[20px] text-slate-400">track_changes</span>
                                                            <span className="truncate">{(question.topics || [])[0] || "Problem Solving"}</span>
                                                        </span>
                                                        <span className="inline-flex items-center gap-2">
                                                            <span className="material-symbols-outlined text-[20px] text-slate-400">code</span>
                                                            Coding
                                                        </span>
                                                        <span className="inline-flex items-center gap-2">
                                                            <span className="material-symbols-outlined text-[20px] text-slate-400">science</span>
                                                            {question.testCaseCount || 0} test cases
                                                        </span>
                                                        <span className="inline-flex items-center gap-2">
                                                            <span className="material-symbols-outlined text-[20px] text-slate-400">schedule</span>
                                                            {question.estimatedTimeMinutes || 35} mins
                                                        </span>
                                                    </div>
                                                </Link>
                                                <button
                                                    type="button"
                                                    onClick={() => void importDatasetQuestions([question.id])}
                                                    disabled={disabled}
                                                    className={`inline-flex h-10 min-w-[104px] items-center justify-center gap-2 self-center rounded-full px-4 text-sm font-extrabold transition disabled:cursor-not-allowed ${
                                                        question.alreadyAdded
                                                            ? "bg-emerald-50 text-emerald-700 disabled:opacity-100 dark:bg-emerald-400/10 dark:text-emerald-300"
                                                            : "bg-primary/10 text-primary hover:bg-primary hover:text-white disabled:opacity-60"
                                                    }`}
                                                >
                                                    {importing ? <span className="size-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary" /> : <span className="material-symbols-outlined text-[18px]">{question.alreadyAdded ? "check" : "add"}</span>}
                                                    {question.alreadyAdded ? "Added" : "Add"}
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {!loading && questions.length > 0 && (
                <div className="fixed bottom-6 right-6 z-40 inline-flex h-10 items-center rounded-full bg-white/90 px-4 text-sm font-extrabold text-slate-600 shadow-sm ring-1 ring-slate-200 backdrop-blur dark:bg-lc-surface/90 dark:text-slate-300 dark:ring-lc-border">
                    Number of questions = {questions.length}
                </div>
            )}
        </main>
    );
}
