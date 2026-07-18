"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_CONTEST_INSTRUCTIONS } from "@interviewforge/shared";
import { useAuth } from "@/context/auth-context";
import { useContestManagerCheck } from "@/hooks/use-contest-manager-check";

type Difficulty = "Easy" | "Medium" | "Hard";
type UsedFilter = "all" | "unused" | "used";
type QuestionKind = "dsa" | "mcq";
type RoundFlow = "dsa_only" | "mcq_only" | "mcq_then_dsa";

type ContestQuestion = {
    id: string;
    problemId?: string;
    frontendId?: string;
    title: string;
    difficulty: Difficulty;
    problemSlug?: string;
    topics: string[];
    usedInContests?: string[];
    isUsedInContest?: boolean;
    currentlyChoosedForContest?: boolean;
    questionType?: QuestionKind;
    optionCount?: number;
    points?: number;
};

type ApiErrorPayload = {
    message?: string;
    details?: Record<string, unknown>;
};

type ContestQuestionApiItem = Omit<Partial<ContestQuestion>, "difficulty" | "topics"> & {
    difficulty?: unknown;
    topics?: unknown;
};

type SelectedQuestion = ContestQuestion & {
    points: number;
    negativePoints: number;
    negativeCap: number;
    pointsInput: string;
    negativePointsInput: string;
    negativeCapInput: string;
};

type TestingUser = {
    id: string;
    fullName?: string | null;
    email: string;
    username?: string | null;
    isTester?: boolean;
    createdAt?: string;
};

const contestApiUrl = process.env.NEXT_PUBLIC_CONTEST_API_URL || "http://localhost:3002";

const DIFFICULTY_POINTS: Record<Difficulty, number> = {
    Easy: 150,
    Medium: 300,
    Hard: 500,
};

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

function defaultPoints(difficulty: Difficulty) {
    return DIFFICULTY_POINTS[difficulty] || 300;
}

function parseIntegerInput(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return null;
    return Math.floor(parsed);
}

function normalizeNonNegativeInput(value: string) {
    const parsed = parseIntegerInput(value);
    return parsed === null ? 0 : Math.max(0, parsed);
}

function buildQuestionPayload(questions: SelectedQuestion[]) {
    return questions.map((question, index) => {
        const points = parseIntegerInput(question.pointsInput);
        const questionType = question.questionType === "mcq" ? "mcq" : "dsa";
        const negativePoints = normalizeNonNegativeInput(question.negativePointsInput);
        const negativeCap = normalizeNonNegativeInput(question.negativeCapInput);

        if (points === null || points < 1) {
            throw new Error(`Enter valid positive points for Q${index + 1}.`);
        }

        if (negativePoints === 0 && negativeCap !== 0) {
            throw new Error(`Set max negative cap to 0 for Q${index + 1} when wrong-answer penalty is disabled.`);
        }

        if (negativePoints > 0) {
            if (negativeCap < negativePoints) {
                throw new Error(`Set max negative cap for Q${index + 1} to at least one wrong-answer penalty.`);
            }

            if (negativeCap % negativePoints !== 0) {
                throw new Error(`Set max negative cap for Q${index + 1} as a multiple of the wrong-answer penalty.`);
            }
        }

        return {
            questionId: question.id,
            questionType,
            phase: questionType,
            points,
            negativePoints,
            negativeCap,
        };
    });
}

function hasUsageHistory(question: Pick<ContestQuestion, "isUsedInContest" | "usedInContests">) {
    return Boolean(question.isUsedInContest || (question.usedInContests || []).length > 0);
}

function getUnknownErrorMessage(error: unknown, fallback: string) {
    return error instanceof Error ? error.message : fallback;
}

function getValidationDetails(details: ApiErrorPayload["details"]) {
    if (!details) return "";
    return Object.values(details).flat().filter(Boolean).join(" ");
}

function normalizeTopics(value: unknown) {
    return Array.isArray(value) ? value.filter((topic): topic is string => typeof topic === "string") : [];
}

function testingUserLabel(user: Pick<TestingUser, "fullName" | "username" | "email">) {
    return user.fullName || user.username || user.email;
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
        <div className="flex w-full max-w-full flex-wrap gap-1 rounded-2xl bg-slate-100 p-1 sm:w-fit dark:bg-lc-bg" role="group" aria-label={ariaLabel}>
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

export default function CreateContestPage() {
    const router = useRouter();
    const { session } = useAuth();
    const { isContestManager, loading: managerLoading } = useContestManagerCheck();
    const token = session?.access_token;

    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [instructions, setInstructions] = useState(DEFAULT_CONTEST_INSTRUCTIONS);
    const [startTime, setStartTime] = useState("");
    const [endTime, setEndTime] = useState("");
    const [showDifficultyTags, setShowDifficultyTags] = useState(true);
    const [showParticipants, setShowParticipants] = useState(false);
    const [isUnderTesting, setIsUnderTesting] = useState(false);
    const [roundFlow, setRoundFlow] = useState<RoundFlow>("dsa_only");
    const [showScoreOnHub, setShowScoreOnHub] = useState(true);
    const [mcqSequential, setMcqSequential] = useState(false);

    const [questions, setQuestions] = useState<ContestQuestion[]>([]);
    const [selectedQuestions, setSelectedQuestions] = useState<SelectedQuestion[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [questionBankType, setQuestionBankType] = useState<QuestionKind>("dsa");
    const [difficultyFilter, setDifficultyFilter] = useState<"all" | Difficulty>("all");
    const [usedFilter, setUsedFilter] = useState<UsedFilter>("all");

    const [loadingQuestions, setLoadingQuestions] = useState(false);
    const [loadingTemplate, setLoadingTemplate] = useState(false);
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [testingModalOpen, setTestingModalOpen] = useState(false);
    const [testingEmails, setTestingEmails] = useState<TestingUser[]>([]);
    const [testingSearch, setTestingSearch] = useState("");
    const [testingResults, setTestingResults] = useState<TestingUser[]>([]);
    const [testingLoading, setTestingLoading] = useState(false);
    const [testingSearchLoading, setTestingSearchLoading] = useState(false);
    const [testingActionUserId, setTestingActionUserId] = useState<string | null>(null);
    const [testingError, setTestingError] = useState<string | null>(null);

    const selectedIds = useMemo(
        () => new Set(selectedQuestions.map((question) => question.id)),
        [selectedQuestions]
    );

    const totalPoints = selectedQuestions.reduce(
        (sum, question) => sum + Math.max(0, parseIntegerInput(question.pointsInput) ?? question.points ?? 0),
        0
    );
    const totalNegativeCap = selectedQuestions.reduce(
        (sum, question) => sum + normalizeNonNegativeInput(question.negativeCapInput),
        0
    );

    const loadInstructionTemplate = useCallback(async () => {
        if (!token) return;
        setLoadingTemplate(true);
        try {
            const response = await fetch(`${contestApiUrl}/admin/contest-instructions/template`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });
            if (!response.ok) throw new Error("Failed to load contest instructions");
            const data = await response.json();
            setInstructions(data.instructions || DEFAULT_CONTEST_INSTRUCTIONS);
        } catch {
            setInstructions(DEFAULT_CONTEST_INSTRUCTIONS);
        } finally {
            setLoadingTemplate(false);
        }
    }, [token]);

    const loadQuestions = useCallback(async () => {
        if (!token) return;
        setLoadingQuestions(true);
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

            const data = await response.json().catch(() => ({})) as ApiErrorPayload & { questions?: ContestQuestionApiItem[] };
            if (!response.ok) {
                throw new Error(data.message || "Failed to load contest questions");
            }

            setQuestions((data.questions || []).map((question) => ({
                ...question,
                id: String(question.id || ""),
                title: String(question.title || "Untitled question"),
                difficulty: normalizeDifficulty(question.difficulty),
                topics: normalizeTopics(question.topics),
                questionType: question.questionType === "mcq" ? "mcq" : "dsa",
                optionCount: Number(question.optionCount || 0),
                points: Number(question.points || 0),
            })));
        } catch (err: unknown) {
            setError(getUnknownErrorMessage(err, "Failed to load contest questions"));
            setQuestions([]);
        } finally {
            setLoadingQuestions(false);
        }
    }, [token, usedFilter, searchQuery, difficultyFilter, questionBankType]);

    const loadTestingEmails = useCallback(async () => {
        if (!token) return;
        setTestingLoading(true);
        setTestingError(null);

        try {
            const response = await fetch(`${contestApiUrl}/admin/contest-testing/testers`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await response.json().catch(() => ({})) as ApiErrorPayload & { testers?: TestingUser[] };
            if (!response.ok) throw new Error(data.message || "Failed to load testing emails");
            setTestingEmails(data.testers || []);
        } catch (err: unknown) {
            setTestingError(getUnknownErrorMessage(err, "Failed to load testing emails"));
        } finally {
            setTestingLoading(false);
        }
    }, [token]);

    const searchTestingUsers = useCallback(async (query: string) => {
        if (!token || !query.trim()) {
            setTestingResults([]);
            return;
        }

        setTestingSearchLoading(true);
        setTestingError(null);

        try {
            const params = new URLSearchParams({ query: query.trim(), limit: "10" });
            const response = await fetch(`${contestApiUrl}/admin/contest-testing/users?${params.toString()}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await response.json().catch(() => ({})) as ApiErrorPayload & { users?: TestingUser[] };
            if (!response.ok) throw new Error(data.message || "Failed to search users");
            setTestingResults(data.users || []);
        } catch (err: unknown) {
            setTestingError(getUnknownErrorMessage(err, "Failed to search users"));
        } finally {
            setTestingSearchLoading(false);
        }
    }, [token]);

    const addTestingEmail = async (userId: string) => {
        if (!token) return;
        setTestingActionUserId(userId);
        setTestingError(null);

        try {
            const response = await fetch(`${contestApiUrl}/admin/contest-testing/testers`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ userId }),
            });
            const data = await response.json().catch(() => ({})) as ApiErrorPayload;
            if (!response.ok) throw new Error(data.message || "Failed to add testing email");
            setTestingResults((current) => current.map((user) => user.id === userId ? { ...user, isTester: true } : user));
            await loadTestingEmails();
        } catch (err: unknown) {
            setTestingError(getUnknownErrorMessage(err, "Failed to add testing email"));
        } finally {
            setTestingActionUserId(null);
        }
    };

    const removeTestingEmail = async (userId: string) => {
        if (!token) return;
        setTestingActionUserId(userId);
        setTestingError(null);

        try {
            const response = await fetch(`${contestApiUrl}/admin/contest-testing/testers/${encodeURIComponent(userId)}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await response.json().catch(() => ({})) as ApiErrorPayload;
            if (!response.ok) throw new Error(data.message || "Failed to remove testing email");
            setTestingEmails((current) => current.filter((user) => user.id !== userId));
            setTestingResults((current) => current.map((user) => user.id === userId ? { ...user, isTester: false } : user));
        } catch (err: unknown) {
            setTestingError(getUnknownErrorMessage(err, "Failed to remove testing email"));
        } finally {
            setTestingActionUserId(null);
        }
    };

    useEffect(() => {
        if (!isContestManager || !token) return;
        loadInstructionTemplate();
    }, [isContestManager, token, loadInstructionTemplate]);

    useEffect(() => {
        if (!isContestManager || !token) return;
        const timer = window.setTimeout(() => {
            loadQuestions();
        }, 180);
        return () => window.clearTimeout(timer);
    }, [isContestManager, token, loadQuestions]);

    useEffect(() => {
        if (!testingModalOpen) return;
        loadTestingEmails();
    }, [testingModalOpen, loadTestingEmails]);

    useEffect(() => {
        if (!testingModalOpen) return;
        if (testingSearch.trim().length < 2) {
            setTestingResults([]);
            return;
        }

        const timer = window.setTimeout(() => searchTestingUsers(testingSearch), 250);
        return () => window.clearTimeout(timer);
    }, [testingModalOpen, testingSearch, searchTestingUsers]);

    const addQuestion = (question: ContestQuestion) => {
        if (selectedIds.has(question.id)) return;
        const questionType = question.questionType === "mcq" ? "mcq" : "dsa";
        const questionPoints = questionType === "mcq"
            ? Math.max(1, Math.floor(Number(question.points || 1)))
            : defaultPoints(question.difficulty);

        setError(null);
        setSelectedQuestions((current) => [
            ...current,
            {
                ...question,
                questionType,
                points: questionPoints,
                negativePoints: 0,
                negativeCap: 0,
                pointsInput: String(questionPoints),
                negativePointsInput: "0",
                negativeCapInput: "0",
            },
        ]);
    };

    const removeQuestion = (questionId: string) => {
        setSelectedQuestions((current) => current.filter((question) => question.id !== questionId));
    };

    const updateQuestionConfig = (
        questionId: string,
        field: "pointsInput" | "negativePointsInput" | "negativeCapInput",
        value: string
    ) => {
        setSelectedQuestions((current) =>
            current.map((question) => {
                if (question.id !== questionId) return question;
                return {
                    ...question,
                    [field]: value,
                };
            })
        );
    };

    const createContest = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!token) return;

        if (selectedQuestions.length === 0) {
            setError("Select at least one question for the contest.");
            return;
        }
        const hasMcqQuestion = selectedQuestions.some((question) => question.questionType === "mcq");
        const hasDsaQuestion = selectedQuestions.some((question) => question.questionType !== "mcq");
        if (roundFlow === "dsa_only" && hasMcqQuestion) {
            setError("DSA only contests cannot include MCQ questions. Choose MCQ only or MCQ then DSA.");
            return;
        }
        if (roundFlow === "mcq_only" && (!hasMcqQuestion || hasDsaQuestion)) {
            setError("MCQ only contests need at least one MCQ question and no DSA questions.");
            return;
        }
        if (roundFlow === "mcq_then_dsa" && (!hasMcqQuestion || !hasDsaQuestion)) {
            setError("MCQ then DSA flow needs at least one MCQ question and one DSA question.");
            return;
        }

        setCreating(true);
        setError(null);

        try {
            const questionPayload = buildQuestionPayload(selectedQuestions);
            const response = await fetch(`${contestApiUrl}/contests`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    title,
                    description,
                    instructions,
                    startTime: new Date(startTime).toISOString(),
                    endTime: new Date(endTime).toISOString(),
                    showDifficultyTags,
                    showParticipants,
                    isUnderTesting,
                    roundFlow,
                    showScoreOnHub,
                    mcqSequential,
                    questions: questionPayload,
                }),
            });

            const data = await response.json().catch(() => ({})) as ApiErrorPayload;
            if (!response.ok) {
                const validationDetails = getValidationDetails(data.details);
                throw new Error(data.message || validationDetails || "Failed to create contest");
            }

            router.push("/admin/contests");
        } catch (err: unknown) {
            setError(getUnknownErrorMessage(err, "Failed to create contest"));
        } finally {
            setCreating(false);
        }
    };

    if (managerLoading) {
        return (
            <div className="flex min-h-[60vh] flex-1 items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            </div>
        );
    }

    if (!isContestManager) return <NotAuthorized />;

    return (
        <div className="min-h-screen bg-[#f7f8fb] px-4 py-8 text-slate-950 dark:bg-lc-bg dark:text-white sm:px-6 lg:px-8">
            <div className="mx-auto max-w-7xl">
                <div className="mb-8 flex flex-col gap-5 border-b border-slate-200 pb-7 dark:border-lc-border lg:flex-row lg:items-end lg:justify-between">
                    <div>
                        <p className="text-xs font-extrabold uppercase tracking-[0.22em] text-slate-400">Contest setup</p>
                        <h1 className="mt-2 font-nunito text-4xl font-extrabold tracking-normal text-slate-950 dark:text-white sm:text-5xl">
                            Create Contest
                        </h1>
                        <p className="mt-3 max-w-2xl text-base font-semibold leading-7 text-slate-500 dark:text-slate-400">
                            Build a timed contest from the contest question bank and tune scoring from one clean control panel.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => router.push("/admin/contests")}
                        className="w-fit rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm font-extrabold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 dark:border-lc-border dark:bg-lc-surface dark:text-slate-200 dark:hover:bg-lc-hover"
                    >
                        Back to contests
                    </button>
                </div>

                {error && (
                    <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
                        {error}
                    </div>
                )}

                <form onSubmit={createContest} className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_400px]">
                    <div className="rounded-[28px] bg-white/90 p-6 shadow-[0_18px_50px_rgba(15,23,42,0.07)] ring-1 ring-slate-200/80 dark:bg-lc-surface dark:ring-lc-border sm:p-8">
                        <section className="border-b border-slate-200 pb-8 dark:border-lc-border">
                            <div className="mb-6 flex items-center justify-between gap-3">
                                <div>
                                    <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-slate-400">Details</p>
                                    <h2 className="mt-1 font-nunito text-2xl font-extrabold text-slate-950 dark:text-white">Contest information</h2>
                                </div>
                            </div>

                            <div className="grid gap-5 md:grid-cols-2">
                                <label className="md:col-span-2">
                                    <span className="mb-2 block text-sm font-extrabold text-slate-700 dark:text-slate-200">Title</span>
                                    <input
                                        value={title}
                                        onChange={(event) => setTitle(event.target.value)}
                                        required
                                        minLength={3}
                                        maxLength={200}
                                        className="w-full rounded-2xl border border-slate-200 bg-[#f8fafc] px-4 py-3 text-sm font-semibold text-slate-950 outline-none transition focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-bg dark:text-white dark:focus:bg-[#202020]"
                                        placeholder="Divisional Coding Sprint"
                                    />
                                </label>

                                <label className="md:col-span-2">
                                    <span className="mb-2 block text-sm font-extrabold text-slate-700 dark:text-slate-200">Description</span>
                                    <textarea
                                        value={description}
                                        onChange={(event) => setDescription(event.target.value)}
                                        required
                                        minLength={10}
                                        maxLength={5000}
                                        rows={4}
                                        className="w-full resize-none rounded-2xl border border-slate-200 bg-[#f8fafc] px-4 py-3 text-sm font-semibold leading-6 text-slate-950 outline-none transition focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-bg dark:text-white dark:focus:bg-[#202020]"
                                        placeholder="Short contest description visible to participants."
                                    />
                                </label>

                                <label>
                                    <span className="mb-2 block text-sm font-extrabold text-slate-700 dark:text-slate-200">Start time</span>
                                    <input
                                        type="datetime-local"
                                        value={startTime}
                                        onChange={(event) => setStartTime(event.target.value)}
                                        required
                                        className="w-full rounded-2xl border border-slate-200 bg-[#f8fafc] px-4 py-3 text-sm font-semibold text-slate-950 outline-none transition focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-bg dark:text-white dark:focus:bg-[#202020]"
                                    />
                                </label>

                                <label>
                                    <span className="mb-2 block text-sm font-extrabold text-slate-700 dark:text-slate-200">End time</span>
                                    <input
                                        type="datetime-local"
                                        value={endTime}
                                        onChange={(event) => setEndTime(event.target.value)}
                                        required
                                        className="w-full rounded-2xl border border-slate-200 bg-[#f8fafc] px-4 py-3 text-sm font-semibold text-slate-950 outline-none transition focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-bg dark:text-white dark:focus:bg-[#202020]"
                                    />
                                </label>
                            </div>
                        </section>

                        <section className="border-b border-slate-200 py-8 dark:border-lc-border">
                            <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                <div>
                                    <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-slate-400">Question bank</p>
                                    <h2 className="mt-1 font-nunito text-2xl font-extrabold text-slate-950 dark:text-white">Choose questions</h2>
                                </div>
                                <div className="rounded-full bg-slate-100 px-3 py-1 text-sm font-extrabold text-slate-500 dark:bg-lc-hover dark:text-slate-300">
                                    {selectedQuestions.length} selected
                                </div>
                            </div>

                            <div className="space-y-3">
                                <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-start">
                                    <div className="relative min-w-0 flex-1 2xl:min-w-[280px]">
                                        <span className="material-symbols-outlined pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">search</span>
                                        <input
                                            value={searchQuery}
                                            onChange={(event) => setSearchQuery(event.target.value)}
                                            className="w-full rounded-2xl border border-slate-200 bg-[#f8fafc] py-3 pl-12 pr-4 text-sm font-semibold text-slate-950 outline-none transition focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-bg dark:text-white dark:focus:bg-[#202020]"
                                            placeholder="Search by title, slug, or ID"
                                        />
                                    </div>
                                    <div className="flex flex-wrap gap-3">
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
                                    </div>
                                </div>
                                <p className="text-xs font-bold leading-5 text-slate-500 dark:text-slate-400">
                                    MCQ only runs just the MCQ round. MCQ then DSA locks coding until MCQs are submitted.
                                </p>
                            </div>

                            <div className="mt-5 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-lc-bg dark:ring-lc-border">
                                <div className="grid grid-cols-[1fr_120px_120px] bg-slate-50 px-4 py-3 text-xs font-extrabold uppercase tracking-[0.12em] text-slate-500 dark:bg-[#202020]">
                                    <span>Question</span>
                                    <span>Difficulty</span>
                                    <span className="text-right">Action</span>
                                </div>

                                <div className="max-h-[520px] divide-y divide-slate-100 overflow-y-auto dark:divide-[#303030]">
                                    {loadingQuestions ? (
                                        <div className="flex items-center justify-center py-16 text-sm font-bold text-slate-500">
                                            Loading questions...
                                        </div>
                                    ) : questions.length === 0 ? (
                                        <div className="flex items-center justify-center py-16 text-sm font-bold text-slate-500">
                                            No contest questions match these filters.
                                        </div>
                                    ) : (
                                        questions.map((question) => {
                                            const used = hasUsageHistory(question);
                                            const selected = selectedIds.has(question.id);

                                            return (
                                                <div
                                                    key={question.id}
                                                    className="grid grid-cols-[1fr_120px_120px] items-center gap-3 px-4 py-4 hover:bg-slate-50 dark:hover:bg-[#2b2b2b]"
                                                >
                                                    <div className="min-w-0">
                                                        <div className="flex flex-wrap items-center gap-2">
                                                            <p className="truncate text-sm font-black text-slate-950 dark:text-white">
                                                                {question.title}
                                                            </p>
                                                            {used && (
                                                                <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-black uppercase text-slate-500 dark:border-[#444] dark:bg-[#1c1c1c]">
                                                                    Used
                                                                </span>
                                                            )}
                                                            {question.questionType === "mcq" && (
                                                                <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-black uppercase text-sky-700 dark:border-sky-500/25 dark:bg-sky-500/10 dark:text-sky-300">
                                                                    MCQ
                                                                </span>
                                                            )}
                                                        </div>
                                                    <p className="mt-1 truncate text-xs font-semibold text-slate-500">
                                                        #{question.frontendId || question.problemId || question.id}
                                                        {question.questionType === "mcq" && question.optionCount ? ` - ${question.optionCount} options` : ""}
                                                        {question.topics.length ? ` - ${question.topics.slice(0, 3).join(", ")}` : ""}
                                                    </p>
                                                    </div>
                                                    <span className={`w-fit rounded-full border px-2.5 py-1 text-xs font-black ${DIFFICULTY_STYLES[question.difficulty]}`}>
                                                        {question.difficulty}
                                                    </span>
                                                    <div className="flex justify-end">
                                                        <button
                                                            type="button"
                                                            onClick={() => addQuestion(question)}
                                                            disabled={selected}
                                                            className="rounded-full bg-slate-950 px-4 py-2 text-xs font-extrabold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 dark:bg-white dark:text-slate-950 dark:disabled:bg-[#333] dark:disabled:text-[#777]"
                                                        >
                                                            {selected ? "Added" : "Add"}
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            </div>
                        </section>

                        <section className="pt-8">
                            <div className="mb-4 flex items-center justify-between">
                                <div>
                                    <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-slate-400">Participant instructions</p>
                                    <h2 className="mt-1 font-nunito text-2xl font-extrabold text-slate-950 dark:text-white">Fullscreen entry copy</h2>
                                </div>
                                {loadingTemplate && (
                                    <span className="text-xs font-bold text-slate-500">Loading template...</span>
                                )}
                            </div>
                            <textarea
                                value={instructions}
                                onChange={(event) => setInstructions(event.target.value)}
                                required
                                minLength={20}
                                maxLength={6000}
                                rows={8}
                                className="w-full resize-y rounded-2xl border border-slate-200 bg-[#f8fafc] px-4 py-3 text-sm font-semibold leading-6 text-slate-950 outline-none transition focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-bg dark:text-white dark:focus:bg-[#202020]"
                            />
                        </section>
                    </div>

                    <aside className="xl:sticky xl:top-6 xl:self-start">
                        <section className="rounded-[28px] bg-white p-6 shadow-[0_22px_60px_rgba(15,23,42,0.10)] ring-1 ring-slate-200/80 dark:bg-lc-surface dark:ring-lc-border">
                            <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-slate-400">Selection</p>
                            <h2 className="mt-1 font-nunito text-2xl font-extrabold text-slate-950 dark:text-white">Scoring</h2>

                            <div className="mt-5 grid grid-cols-3 divide-x divide-slate-200 rounded-2xl bg-slate-50 px-2 py-4 dark:divide-lc-border dark:bg-lc-bg">
                                <div className="px-3">
                                    <p className="text-xs font-bold text-slate-500">Questions</p>
                                    <p className="mt-1 text-2xl font-extrabold text-slate-950 dark:text-white">{selectedQuestions.length}</p>
                                </div>
                                <div className="px-3">
                                    <p className="text-xs font-bold text-slate-500">Points</p>
                                    <p className="mt-1 text-2xl font-extrabold text-slate-950 dark:text-white">{totalPoints}</p>
                                </div>
                                <div className="px-3">
                                    <p className="text-xs font-bold text-slate-500">Max loss</p>
                                    <p className="mt-1 text-2xl font-extrabold text-slate-950 dark:text-white">-{totalNegativeCap}</p>
                                </div>
                            </div>

                            <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-lc-border dark:bg-lc-bg">
                                <p className="text-sm font-extrabold text-slate-950 dark:text-white">Penalty is per question</p>
                                <p className="mt-1 text-xs font-bold leading-5 text-slate-500 dark:text-slate-400">
                                    Set wrong-answer penalty and max negative cap separately for DSA and MCQ questions. Caps must be multiples of the selected penalty.
                                </p>
                            </div>

                            <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-lc-border dark:bg-lc-bg">
                                <p className="mb-3 text-sm font-extrabold text-slate-950 dark:text-white">Round flow</p>
                                <SegmentedFilter
                                    value={roundFlow}
                                    onChange={setRoundFlow}
                                    ariaLabel="Round flow"
                                    options={[
                                        { label: "DSA only", value: "dsa_only" },
                                        { label: "MCQ only", value: "mcq_only" },
                                        { label: "MCQ then DSA", value: "mcq_then_dsa" },
                                    ]}
                                />
                            </div>

                            <button
                                type="button"
                                role="switch"
                                aria-checked={showScoreOnHub}
                                onClick={() => setShowScoreOnHub((value) => !value)}
                                className="flex w-full items-center justify-between gap-4 border-b border-slate-200 py-4 text-left transition dark:border-lc-border"
                            >
                                <span>
                                    <span className="block text-sm font-extrabold text-slate-950 dark:text-white">
                                        Show score on hub
                                    </span>
                                    <span className="mt-1 block text-xs font-bold text-slate-500 dark:text-slate-400">
                                        {showScoreOnHub ? "Participants can see aggregate score on the contest hub." : "Score stays hidden on the contest hub."}
                                    </span>
                                </span>
                                <span className={`flex h-7 w-12 shrink-0 items-center rounded-full p-1 transition ${showScoreOnHub ? "bg-primary" : "bg-slate-300 dark:bg-[#444]"}`}>
                                    <span className={`h-5 w-5 rounded-full bg-white shadow-sm transition ${showScoreOnHub ? "translate-x-5" : "translate-x-0"}`} />
                                </span>
                            </button>

                            <button
                                type="button"
                                role="switch"
                                aria-checked={mcqSequential}
                                onClick={() => setMcqSequential((value) => !value)}
                                className="flex w-full items-center justify-between gap-4 border-b border-slate-200 py-4 text-left transition dark:border-lc-border"
                            >
                                <span>
                                    <span className="block text-sm font-extrabold text-slate-950 dark:text-white">
                                        Sequential MCQ
                                    </span>
                                    <span className="mt-1 block text-xs font-bold text-slate-500 dark:text-slate-400">
                                        {mcqSequential ? "MCQs unlock one by one and submitted MCQs lock." : "Participants can move between unsubmitted MCQs."}
                                    </span>
                                </span>
                                <span className={`flex h-7 w-12 shrink-0 items-center rounded-full p-1 transition ${mcqSequential ? "bg-primary" : "bg-slate-300 dark:bg-[#444]"}`}>
                                    <span className={`h-5 w-5 rounded-full bg-white shadow-sm transition ${mcqSequential ? "translate-x-5" : "translate-x-0"}`} />
                                </span>
                            </button>

                            <button
                                type="button"
                                role="switch"
                                aria-checked={showDifficultyTags}
                                onClick={() => setShowDifficultyTags((value) => !value)}
                                className="flex w-full items-center justify-between gap-4 border-b border-slate-200 py-4 text-left transition dark:border-lc-border"
                            >
                                <span>
                                    <span className="block text-sm font-extrabold text-slate-950 dark:text-white">
                                        Show difficulty tags
                                    </span>
                                    <span className="mt-1 block text-xs font-bold text-slate-500 dark:text-slate-400">
                                        {showDifficultyTags
                                            ? "Participants will see Easy, Medium, and Hard labels."
                                            : "Participants will only see title, points, and attempts."}
                                    </span>
                                </span>
                                <span
                                    className={`flex h-7 w-12 shrink-0 items-center rounded-full p-1 transition ${
                                        showDifficultyTags ? "bg-primary" : "bg-slate-300 dark:bg-[#444]"
                                    }`}
                                >
                                    <span
                                        className={`h-5 w-5 rounded-full bg-white shadow-sm transition ${
                                            showDifficultyTags ? "translate-x-5" : "translate-x-0"
                                        }`}
                                    />
                                </span>
                            </button>

                            <button
                                type="button"
                                role="switch"
                                aria-checked={showParticipants}
                                onClick={() => setShowParticipants((value) => !value)}
                                className="flex w-full items-center justify-between gap-4 border-b border-slate-200 py-4 text-left transition dark:border-lc-border"
                            >
                                <span>
                                    <span className="block text-sm font-extrabold text-slate-950 dark:text-white">
                                        Show participant count
                                    </span>
                                    <span className="mt-1 block text-xs font-bold text-slate-500 dark:text-slate-400">
                                        {showParticipants
                                            ? "Participants will see the registration count on contest cards."
                                            : "Participant counts stay hidden from contest cards."}
                                    </span>
                                </span>
                                <span
                                    className={`flex h-7 w-12 shrink-0 items-center rounded-full p-1 transition ${
                                        showParticipants ? "bg-primary" : "bg-slate-300 dark:bg-[#444]"
                                    }`}
                                >
                                    <span
                                        className={`h-5 w-5 rounded-full bg-white shadow-sm transition ${
                                            showParticipants ? "translate-x-5" : "translate-x-0"
                                        }`}
                                    />
                                </span>
                            </button>

                            <button
                                type="button"
                                role="switch"
                                aria-checked={isUnderTesting}
                                onClick={() => setIsUnderTesting((value) => !value)}
                                className="flex w-full items-center justify-between gap-4 border-b border-slate-200 py-4 text-left transition dark:border-lc-border"
                            >
                                <span>
                                    <span className="block text-sm font-extrabold text-slate-950 dark:text-white">
                                        Under testing
                                    </span>
                                    <span className="mt-1 block text-xs font-bold text-slate-500 dark:text-slate-400">
                                        {isUnderTesting
                                            ? "Only users in your testing email list can see this contest."
                                            : "Contest follows normal visibility for all users."}
                                    </span>
                                </span>
                                <span
                                    className={`flex h-7 w-12 shrink-0 items-center rounded-full p-1 transition ${
                                        isUnderTesting ? "bg-primary" : "bg-slate-300 dark:bg-[#444]"
                                    }`}
                                >
                                    <span
                                        className={`h-5 w-5 rounded-full bg-white shadow-sm transition ${
                                            isUnderTesting ? "translate-x-5" : "translate-x-0"
                                        }`}
                                    />
                                </span>
                            </button>

                            <button
                                type="button"
                                onClick={() => setTestingModalOpen(true)}
                                className="mt-4 flex w-full items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-3 text-sm font-extrabold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 dark:border-lc-border dark:bg-lc-bg dark:text-slate-200 dark:hover:bg-lc-hover"
                            >
                                <span className="material-symbols-outlined text-lg">group_add</span>
                                See testing emails
                            </button>

                            <div className="mt-5 max-h-[520px] divide-y divide-slate-200 overflow-y-auto pr-1 dark:divide-lc-border">
                                {selectedQuestions.length === 0 ? (
                                    <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm font-bold text-slate-500 dark:border-lc-border">
                                        Add questions from the bank to configure scoring.
                                    </div>
                                ) : (
                                    selectedQuestions.map((question, index) => (
                                        <div
                                            key={question.id}
                                            className="py-4 first:pt-0 last:pb-0"
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                    <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-slate-400">
                                                        Q{index + 1}
                                                    </p>
                                                    <h3 className="mt-1 truncate text-sm font-extrabold text-slate-950 dark:text-white">
                                                        {question.title}
                                                    </h3>
                                                    {question.questionType === "mcq" && (
                                                        <span className="mt-2 inline-flex rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-black uppercase text-sky-700 dark:border-sky-500/25 dark:bg-sky-500/10 dark:text-sky-300">
                                                            MCQ
                                                        </span>
                                                    )}
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => removeQuestion(question.id)}
                                                    className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white hover:text-rose-500 dark:hover:bg-[#292929]"
                                                    aria-label={`Remove ${question.title}`}
                                                >
                                                    <span className="material-symbols-outlined text-lg">close</span>
                                                </button>
                                            </div>
                                            <div className="mt-4">
                                                <label>
                                                    <span className="mb-1 block text-xs font-bold text-slate-500">Points</span>
                                                    <input
                                                        type="number"
                                                        min={1}
                                                        value={question.pointsInput}
                                                        onChange={(event) => updateQuestionConfig(question.id, "pointsInput", event.target.value)}
                                                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-950 outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-60 dark:border-lc-border dark:bg-lc-bg dark:text-white"
                                                    />
                                                </label>
                                            </div>
                                            <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                                <label>
                                                    <span className="mb-1 block text-xs font-bold text-slate-500">Wrong penalty</span>
                                                    <input
                                                        type="number"
                                                        min={0}
                                                        value={question.negativePointsInput}
                                                        onChange={(event) => updateQuestionConfig(question.id, "negativePointsInput", event.target.value)}
                                                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-950 outline-none focus:border-primary dark:border-lc-border dark:bg-lc-bg dark:text-white"
                                                    />
                                                </label>
                                                <label>
                                                    <span className="mb-1 block text-xs font-bold text-slate-500">Max negative cap</span>
                                                    <input
                                                        type="number"
                                                        min={0}
                                                        step={Math.max(1, normalizeNonNegativeInput(question.negativePointsInput))}
                                                        value={question.negativeCapInput}
                                                        onChange={(event) => updateQuestionConfig(question.id, "negativeCapInput", event.target.value)}
                                                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-950 outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-60 dark:border-lc-border dark:bg-lc-bg dark:text-white"
                                                    />
                                                </label>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>

                            <button
                                type="submit"
                                disabled={creating || selectedQuestions.length === 0}
                                className="mt-5 w-full rounded-full bg-slate-950 px-5 py-3.5 text-sm font-extrabold text-white shadow-lg shadow-slate-950/15 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200 dark:disabled:bg-[#333] dark:disabled:text-slate-500"
                            >
                                {creating ? "Creating..." : "Create contest"}
                            </button>
                        </section>
                    </aside>
                </form>

                {testingModalOpen && (
                    <div className="fixed inset-0 z-[120] grid place-items-center bg-slate-950/50 p-4 dark:bg-black/70">
                        <button
                            type="button"
                            aria-label="Close testing emails"
                            className="absolute inset-0 cursor-default"
                            onClick={() => setTestingModalOpen(false)}
                        />
                        <section className="relative max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-slate-200 dark:bg-lc-surface dark:ring-lc-border">
                            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5 dark:border-lc-border">
                                <div>
                                    <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-slate-400">Testing access</p>
                                    <h2 className="mt-1 font-nunito text-2xl font-extrabold text-slate-950 dark:text-white">Testing emails</h2>
                                    <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">
                                        This list applies to all contests created from your account.
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setTestingModalOpen(false)}
                                    className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-lc-hover dark:hover:text-white"
                                    aria-label="Close"
                                >
                                    <span className="material-symbols-outlined">close</span>
                                </button>
                            </div>

                            <div className="max-h-[calc(90vh-96px)] overflow-y-auto px-6 py-5">
                                {testingError && (
                                    <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
                                        {testingError}
                                    </div>
                                )}

                                <div>
                                    <label className="block">
                                        <span className="mb-2 block text-sm font-extrabold text-slate-700 dark:text-slate-200">Add testing email</span>
                                        <input
                                            value={testingSearch}
                                            onChange={(event) => setTestingSearch(event.target.value)}
                                            className="w-full rounded-2xl border border-slate-200 bg-[#f8fafc] px-4 py-3 text-sm font-semibold text-slate-950 outline-none transition focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-bg dark:text-white dark:focus:bg-[#202020]"
                                            placeholder="Search by name or email"
                                        />
                                    </label>

                                    <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 dark:border-lc-border">
                                        {testingSearch.trim().length < 2 ? (
                                            <div className="px-4 py-4 text-sm font-bold text-slate-500">
                                                Type at least 2 characters to search users.
                                            </div>
                                        ) : testingSearchLoading ? (
                                            <div className="px-4 py-4 text-sm font-bold text-slate-500">Searching...</div>
                                        ) : testingResults.length === 0 ? (
                                            <div className="px-4 py-4 text-sm font-bold text-slate-500">No users found.</div>
                                        ) : (
                                            testingResults.map((user) => (
                                                <div key={user.id} className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0 dark:border-lc-border">
                                                    <div className="min-w-0">
                                                        <p className="truncate text-sm font-extrabold text-slate-950 dark:text-white">{testingUserLabel(user)}</p>
                                                        <p className="truncate text-xs font-semibold text-slate-500">{user.email}</p>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => addTestingEmail(user.id)}
                                                        disabled={user.isTester || testingActionUserId === user.id}
                                                        className="rounded-full bg-slate-950 px-4 py-2 text-xs font-extrabold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 dark:bg-white dark:text-slate-950 dark:disabled:bg-[#333] dark:disabled:text-[#777]"
                                                    >
                                                        {testingActionUserId === user.id ? "Saving..." : user.isTester ? "Added" : "Add"}
                                                    </button>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>

                                <div className="mt-6">
                                    <h3 className="text-sm font-extrabold text-slate-950 dark:text-white">Current testing emails</h3>
                                    <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 dark:border-lc-border">
                                        {testingLoading ? (
                                            <div className="px-4 py-5 text-sm font-bold text-slate-500">Loading testing emails...</div>
                                        ) : testingEmails.length === 0 ? (
                                            <div className="px-4 py-5 text-sm font-bold text-slate-500">No testing emails added yet.</div>
                                        ) : (
                                            testingEmails.map((user) => (
                                                <div key={user.id} className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0 dark:border-lc-border">
                                                    <div className="min-w-0">
                                                        <p className="truncate text-sm font-extrabold text-slate-950 dark:text-white">{testingUserLabel(user)}</p>
                                                        <p className="truncate text-xs font-semibold text-slate-500">{user.email}</p>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => removeTestingEmail(user.id)}
                                                        disabled={testingActionUserId === user.id}
                                                        className="rounded-full border border-rose-200 px-4 py-2 text-xs font-extrabold text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-500/30 dark:text-rose-200 dark:hover:bg-rose-500/10"
                                                    >
                                                        {testingActionUserId === user.id ? "Removing..." : "Remove"}
                                                    </button>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            </div>
                        </section>
                    </div>
                )}
            </div>
        </div>
    );
}
