"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import { useContestManagerCheck } from "@/hooks/use-contest-manager-check";

type Difficulty = "Easy" | "Medium" | "Hard";
type UsedFilter = "all" | "unused" | "used";
type QuestionBankType = "dsa" | "mcq";

type ContestQuestion = {
    id: string;
    problemId?: string;
    frontendId?: string;
    title: string;
    difficulty: Difficulty;
    problemSlug?: string;
    topics: string[];
    companyTags?: string[];
    isUsedInContest?: boolean;
    currentlyChoosedForContest?: boolean;
    usedInContests?: string[];
    createdAt?: string;
    questionType?: QuestionBankType;
    optionCount?: number;
    points?: number;
};

type ContestQuestionApiItem = Omit<Partial<ContestQuestion>, "difficulty" | "topics" | "companyTags" | "questionType"> & {
    difficulty?: unknown;
    topics?: unknown;
    companyTags?: unknown;
    questionType?: unknown;
};

type ContestQuestionsApiPayload = {
    message?: string;
    questions?: ContestQuestionApiItem[];
    total?: number | string;
};

const contestApiUrl = process.env.NEXT_PUBLIC_CONTEST_API_URL || "http://localhost:3002";

const DIFFICULTY_STYLES: Record<Difficulty, string> = {
    Easy: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-300",
    Medium: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300",
    Hard: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300",
};

function normalizeDifficulty(value: unknown): Difficulty {
    const normalized = String(value || "Medium").toLowerCase();
    if (normalized === "easy") return "Easy";
    if (normalized === "hard") return "Hard";
    return "Medium";
}

function formatDate(value?: string) {
    if (!value) return "Not available";
    return new Date(value).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
    });
}

function hasUsageHistory(question: Pick<ContestQuestion, "isUsedInContest" | "usedInContests">) {
    return Boolean(question.isUsedInContest || (question.usedInContests || []).length > 0);
}

function SegmentedFilter<T extends string,>({
    value,
    options,
    onChange,
    ariaLabel,
}: {
    value: T;
    options: Array<{ label: string; value: T }>;
    onChange: (value: T) => void;
    ariaLabel: string;
}) {
    return (
        <div className="flex w-fit max-w-full rounded-2xl bg-slate-100 p-1 dark:bg-[#1c1c1c]" role="group" aria-label={ariaLabel}>
            {options.map((option) => {
                const active = option.value === value;
                return (
                    <button
                        key={option.value}
                        type="button"
                        onClick={() => onChange(option.value)}
                        className={`whitespace-nowrap rounded-xl px-3.5 py-2.5 text-sm font-extrabold transition ${
                            active
                                ? "bg-white text-slate-950 shadow-sm dark:bg-[#2f2f2f] dark:text-white"
                                : "text-slate-500 hover:text-slate-950 dark:text-slate-400 dark:hover:text-white"
                        }`}
                    >
                        {option.label}
                    </button>
                );
            })}
        </div>
    );
}

function NotAuthorized() {
    const router = useRouter();
    useEffect(() => {
        const timer = setTimeout(() => router.replace("/dashboard"), 2500);
        return () => clearTimeout(timer);
    }, [router]);

    return (
        <div className="flex min-h-[60vh] flex-1 flex-col items-center justify-center px-6 text-center">
            <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-rose-50 text-rose-500 dark:bg-rose-500/10">
                <span className="material-symbols-outlined text-4xl">lock</span>
            </div>
            <h1 className="text-xl font-bold text-slate-950 dark:text-white">Page not found</h1>
            <p className="mt-2 text-sm font-semibold text-slate-500">Redirecting you back to the dashboard...</p>
        </div>
    );
}

export default function ContestQuestionsPage() {
    const router = useRouter();
    const { session } = useAuth();
    const { isContestManager, loading: managerLoading } = useContestManagerCheck();
    const token = session?.access_token;

    const [questions, setQuestions] = useState<ContestQuestion[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [questionBankType, setQuestionBankType] = useState<QuestionBankType>("dsa");
    const [difficultyFilter, setDifficultyFilter] = useState<"all" | Difficulty>("all");
    const [usedFilter, setUsedFilter] = useState<UsedFilter>("all");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [total, setTotal] = useState(0);

    const stats = useMemo(() => {
        const used = questions.filter((question) => hasUsageHistory(question)).length;
        return {
            total,
            used,
            unused: Math.max(total - used, 0),
        };
    }, [questions, total]);

    const loadQuestions = useCallback(async () => {
        if (!token) return;
        setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams();
            params.set("limit", "100");
            params.set("used", usedFilter);
            params.set("type", questionBankType);
            if (searchQuery.trim()) params.set("search", searchQuery.trim());
            if (difficultyFilter !== "all") params.set("difficulty", difficultyFilter);

            const response = await fetch(`${contestApiUrl}/admin/contest-questions?${params.toString()}`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });

            const data = await response.json().catch(() => ({})) as ContestQuestionsApiPayload;
            if (!response.ok) {
                throw new Error(data.message || "Failed to load contest questions");
            }

            setQuestions((data.questions || []).map((question) => ({
                ...question,
                id: String(question.id || ""),
                title: String(question.title || "Untitled question"),
                difficulty: normalizeDifficulty(question.difficulty),
                topics: Array.isArray(question.topics) ? question.topics : [],
                companyTags: Array.isArray(question.companyTags) ? question.companyTags : [],
                questionType: question.questionType === "mcq" ? "mcq" : "dsa",
            })));
            setTotal(Number(data.total || 0));
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Failed to load contest questions");
            setQuestions([]);
            setTotal(0);
        } finally {
            setLoading(false);
        }
    }, [token, searchQuery, difficultyFilter, usedFilter, questionBankType]);

    const viewQuestion = (questionId: string) => {
        const params = new URLSearchParams({
            id: questionId,
            source: "contest-bank",
            from: "/admin/contest-questions",
        });
        router.push(`/questions/dsa/solve?${params.toString()}`);
    };

    useEffect(() => {
        if (!isContestManager || !token) return;
        const timer = window.setTimeout(loadQuestions, 180);
        return () => window.clearTimeout(timer);
    }, [isContestManager, token, loadQuestions]);

    if (managerLoading) {
        return (
            <div className="flex min-h-[60vh] flex-1 items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            </div>
        );
    }

    if (!isContestManager) return <NotAuthorized />;

    return (
        <div className="min-h-screen bg-slate-50 px-4 py-8 dark:bg-[#181818] sm:px-6 lg:px-8">
            <div className="mx-auto max-w-7xl">
                <div className="mb-8 flex flex-col gap-4 border-b border-slate-200 pb-6 dark:border-[#333] lg:flex-row lg:items-end lg:justify-between">
                    <div>
                        <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">Contest bank</p>
                        <h1 className="mt-2 text-4xl font-black tracking-tight text-slate-950 dark:text-white">
                            Contest Questions
                        </h1>
                        <p className="mt-2 max-w-2xl text-base font-semibold text-slate-600 dark:text-[#a8a8a8]">
                            Review contest-ready DSA and MCQ questions and track which ones are already in use.
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-3">
                        <button
                            type="button"
                            onClick={() => router.push("/admin/contest-questions/new")}
                            className="w-fit rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-[#333] dark:bg-[#242424] dark:text-white"
                        >
                            Create DSA
                        </button>
                        <button
                            type="button"
                            onClick={() => router.push("/admin/contest-questions/mcq/new")}
                            className="w-fit rounded-xl bg-primary px-5 py-3 text-sm font-black text-white shadow-lg shadow-primary/20 transition hover:bg-primary/90"
                        >
                            Create MCQ
                        </button>
                    </div>
                </div>

                {error && (
                    <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
                        {error}
                    </div>
                )}

                <div className="mb-6 grid gap-4 md:grid-cols-3">
                    {[
                        ["Total questions", stats.total],
                        ["Used in contests", stats.used],
                        ["Available now", stats.unused],
                    ].map(([label, value]) => (
                        <div key={String(label)} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-[#333] dark:bg-[#242424]">
                            <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">{label}</p>
                            <p className="mt-2 text-3xl font-black text-slate-950 dark:text-white">{value}</p>
                        </div>
                    ))}
                </div>

                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-[#333] dark:bg-[#242424]">
                    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto_auto_auto_120px]">
                        <div className="relative">
                            <span className="material-symbols-outlined pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">search</span>
                            <input
                                value={searchQuery}
                                onChange={(event) => setSearchQuery(event.target.value)}
                                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-12 pr-4 text-sm font-semibold text-slate-950 outline-none transition focus:border-primary focus:bg-white dark:border-[#3a3a3a] dark:bg-[#1c1c1c] dark:text-white"
                                placeholder="Search by title, slug, or ID"
                            />
                        </div>
                        <SegmentedFilter
                            value={questionBankType}
                            onChange={setQuestionBankType}
                            ariaLabel="Question type filter"
                            options={[
                                { label: "DSA", value: "dsa" },
                                { label: "MCQ", value: "mcq" },
                            ]}
                        />
                        <SegmentedFilter
                            value={difficultyFilter}
                            onChange={setDifficultyFilter}
                            ariaLabel="Difficulty filter"
                            options={[
                                { label: "All", value: "all" },
                                { label: "Easy", value: "Easy" },
                                { label: "Medium", value: "Medium" },
                                { label: "Hard", value: "Hard" },
                            ]}
                        />
                        <SegmentedFilter
                            value={usedFilter}
                            onChange={setUsedFilter}
                            ariaLabel="Usage filter"
                            options={[
                                { label: "All", value: "all" },
                                { label: "Unused", value: "unused" },
                                { label: "Used", value: "used" },
                            ]}
                        />
                        <button
                            type="button"
                            onClick={loadQuestions}
                            className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 transition hover:bg-slate-100 dark:border-[#3a3a3a] dark:bg-[#1c1c1c] dark:text-white dark:hover:bg-[#2d2d2d]"
                        >
                            Refresh
                        </button>
                    </div>

                    <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 dark:border-[#333]">
                        <div className="grid grid-cols-[90px_1fr_130px_150px_180px_230px] bg-slate-100 px-4 py-3 text-xs font-black uppercase tracking-[0.12em] text-slate-500 dark:bg-[#1d1d1d]">
                            <span>ID</span>
                            <span>Question</span>
                            <span>Difficulty</span>
                            <span>Status</span>
                            <span>Created</span>
                            <span className="text-right">Action</span>
                        </div>

                        <div className="divide-y divide-slate-100 dark:divide-[#303030]">
                            {loading ? (
                                <div className="py-16 text-center text-sm font-bold text-slate-500">Loading questions...</div>
                            ) : questions.length === 0 ? (
                                <div className="py-16 text-center text-sm font-bold text-slate-500">No questions found.</div>
                            ) : (
                                questions.map((question) => {
                                    const used = hasUsageHistory(question);
                                    return (
                                        <div
                                            key={question.id}
                                            className="grid grid-cols-[90px_1fr_130px_150px_180px_230px] items-center gap-3 px-4 py-4 text-sm hover:bg-slate-50 dark:hover:bg-[#2b2b2b]"
                                        >
                                            <span className="font-black text-slate-500">
                                                #{question.frontendId || question.problemId || question.id.slice(-6)}
                                            </span>
                                            <div className="min-w-0">
                                                <p className="truncate font-black text-slate-950 dark:text-white">{question.title}</p>
                                                <p className="mt-1 truncate text-xs font-semibold text-slate-500">
                                                    {question.problemSlug || "No slug"}
                                                    {question.topics.length ? ` - ${question.topics.slice(0, 3).join(", ")}` : ""}
                                                </p>
                                            </div>
                                            <span className={`w-fit rounded-full border px-2.5 py-1 text-xs font-black ${DIFFICULTY_STYLES[question.difficulty]}`}>
                                                {question.difficulty}
                                            </span>
                                            <span className={`w-fit rounded-full border px-2.5 py-1 text-xs font-black ${
                                                used
                                                    ? "border-slate-200 bg-slate-100 text-slate-600 dark:border-[#444] dark:bg-[#1c1c1c] dark:text-[#aaa]"
                                                    : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-300"
                                            }`}>
                                                {used ? "Used" : "Available"}
                                            </span>
                                            <span className="font-semibold text-slate-500">{formatDate(question.createdAt)}</span>
                                            <div className="flex justify-end gap-2">
                                                {question.questionType === "mcq" ? (
                                                    <button
                                                        type="button"
                                                        onClick={() => router.push(`/admin/contest-questions/mcq/${encodeURIComponent(question.id)}/preview`)}
                                                        className="inline-flex items-center justify-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-2 text-xs font-black text-slate-700 transition hover:border-primary hover:text-primary dark:border-[#444] dark:bg-[#1c1c1c] dark:text-[#ddd]"
                                                    >
                                                        <span className="material-symbols-outlined text-[16px]">visibility</span>
                                                        Preview
                                                    </button>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        onClick={() => viewQuestion(question.id)}
                                                        className="inline-flex items-center justify-center gap-1.5 rounded-full bg-slate-950 px-3.5 py-2 text-xs font-black text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
                                                    >
                                                        <span className="material-symbols-outlined text-[16px]">terminal</span>
                                                        View
                                                    </button>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        router.push(
                                                            question.questionType === "mcq"
                                                                ? `/admin/contest-questions/mcq/${encodeURIComponent(question.id)}/edit`
                                                                : `/admin/contest-questions/${encodeURIComponent(question.id)}/edit`,
                                                        )
                                                    }
                                                    className="inline-flex items-center justify-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-2 text-xs font-black text-slate-700 transition hover:border-primary hover:text-primary dark:border-[#444] dark:bg-[#1c1c1c] dark:text-[#ddd]"
                                                >
                                                    <span className="material-symbols-outlined text-[16px]">edit</span>
                                                    Edit
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </section>
            </div>
        </div>
    );
}
