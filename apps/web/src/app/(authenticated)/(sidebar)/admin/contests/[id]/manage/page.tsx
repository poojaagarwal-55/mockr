"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Star } from "lucide-react";
import { DEFAULT_CONTEST_INSTRUCTIONS } from "@interviewforge/shared";
import { useAuth } from "@/context/auth-context";
import { useContestManagerCheck } from "@/hooks/use-contest-manager-check";

type Difficulty = "Easy" | "Medium" | "Hard";
type ContestStatus = "UPCOMING" | "ACTIVE" | "ENDED";
type QuestionKind = "dsa" | "mcq";
type RoundFlow = "dsa_only" | "mcq_only" | "mcq_then_dsa";

type ManagedContestQuestion = {
    id?: string;
    questionId: string;
    questionType?: QuestionKind;
    phase?: QuestionKind;
    problemId?: string;
    frontendId?: string;
    problemSlug?: string;
    title: string;
    difficulty: Difficulty;
    optionCount?: number;
    topics: string[];
    usedInContests?: string[];
    isUsedInContest?: boolean;
    currentlyChoosedForContest?: boolean;
    type?: string;
    points: number;
    negativePoints: number;
    negativeCap: number;
    pointsInput: string;
    negativePointsInput: string;
    negativeCapInput: string;
    order: number;
};

type BankQuestion = {
    id: string;
    questionType?: QuestionKind;
    problemId?: string;
    frontendId?: string;
    problemSlug?: string;
    title: string;
    difficulty: Difficulty;
    optionCount?: number;
    points?: number;
    topics: string[];
    usedInContests?: string[];
    isUsedInContest?: boolean;
    currentlyChoosedForContest?: boolean;
};

type ManagedContest = {
    id: string;
    title: string;
    description?: string | null;
    instructions?: string | null;
    showDifficultyTags?: boolean;
    showParticipants?: boolean;
    isArchived?: boolean;
    isUnderTesting?: boolean;
    roundFlow?: RoundFlow;
    showScoreOnHub?: boolean;
    mcqSequential?: boolean;
    startTime: string;
    endTime: string;
    status: ContestStatus;
    wrongPenalty?: number;
    questions: ManagedContestQuestion[];
    _count?: {
        questions: number;
        participants: number;
    };
};

type LeaderboardEntry = {
    rank: number;
    userId?: string;
    participant?: string;
    hacker: string;
    username?: string;
    displayName?: string;
    score: number;
    solvedCount?: number;
    timeSeconds: number;
};

type GeneratedLeaderboardState = {
    available: boolean;
    published: boolean;
    status: "PENDING" | "GENERATING" | "READY" | "FAILED";
    message: string;
    generatedAt?: string;
    totalParticipants?: number;
    leaderboard: LeaderboardEntry[];
};

type ContestFeedbackEntry = {
    id: string;
    studentName: string;
    email?: string | null;
    rating: number;
    comment?: string | null;
    createdAt: string;
};

type ContestFeedbackState = {
    total: number;
    averageRating: number;
    distribution: Record<1 | 2 | 3 | 4 | 5, number>;
    feedback: ContestFeedbackEntry[];
};

type ApiErrorPayload = {
    message?: string;
    details?: Record<string, unknown>;
};

type BankQuestionApiItem = Omit<Partial<BankQuestion>, "difficulty" | "topics"> & {
    difficulty?: unknown;
    topics?: unknown;
};

type LeaderboardApiPayload = ApiErrorPayload & Partial<GeneratedLeaderboardState> & {
    totalParticipants?: number;
};

type FeedbackApiPayload = ApiErrorPayload & Partial<ContestFeedbackState>;

type TestingUser = {
    id: string;
    fullName?: string | null;
    email: string;
    username?: string | null;
    isTester?: boolean;
    createdAt?: string;
};

const contestApiUrl = process.env.NEXT_PUBLIC_CONTEST_API_URL || "http://localhost:3002";

const EMPTY_FEEDBACK_STATE: ContestFeedbackState = {
    total: 0,
    averageRating: 0,
    distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    feedback: [],
};

const EMPTY_LEADERBOARD_STATE: GeneratedLeaderboardState = {
    available: false,
    published: false,
    status: "PENDING",
    message: "Leaderboard has not been generated yet.",
    leaderboard: [],
};

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

const STATUS_STYLES: Record<ContestStatus, string> = {
    UPCOMING: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/25 dark:bg-sky-500/10 dark:text-sky-300",
    ACTIVE: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-300",
    ENDED: "border-slate-200 bg-slate-100 text-slate-600 dark:border-[#444] dark:bg-[#1c1c1c] dark:text-[#aaa]",
};

function normalizeDifficulty(value: unknown): Difficulty {
    const normalized = String(value || "Medium").toLowerCase();
    if (normalized === "easy") return "Easy";
    if (normalized === "hard") return "Hard";
    return "Medium";
}

function normalizeQuestionType(value: unknown): QuestionKind {
    return String(value || "").toLowerCase() === "mcq" ? "mcq" : "dsa";
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

function buildQuestionPayload(questions: ManagedContestQuestion[]) {
    return questions.map((question, index) => {
        const points = parseIntegerInput(question.pointsInput);
        const questionType = normalizeQuestionType(question.questionType);
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
            questionId: question.questionId,
            questionType,
            phase: questionType,
            points,
            negativePoints,
            negativeCap,
        };
    });
}

function hasUsageHistory(question: Pick<BankQuestion | ManagedContestQuestion, "isUsedInContest" | "usedInContests">) {
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

function toLocalInputValue(value?: string) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return localDate.toISOString().slice(0, 16);
}

function localInputToIso(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toISOString();
}

function formatDateTime(value?: string) {
    if (!value) return "Not generated";
    return new Date(value).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
    });
}

function formatDuration(totalSeconds?: number) {
    const safeSeconds = Math.max(0, Number(totalSeconds) || 0);
    const hours = Math.floor(safeSeconds / 3600);
    const minutes = Math.floor((safeSeconds % 3600) / 60);
    const seconds = safeSeconds % 60;
    return hours > 0
        ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
        : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function getErrorMessage(payload: unknown, fallback: string) {
    if (!payload || typeof payload !== "object") return fallback;
    const apiPayload = payload as ApiErrorPayload;
    if (apiPayload.message) return apiPayload.message;
    if (apiPayload.details && typeof apiPayload.details === "object") {
        const message = Object.values(apiPayload.details).flat().filter(Boolean).join(" ");
        if (message) return message;
    }
    return fallback;
}

function getUnknownErrorMessage(error: unknown, fallback: string) {
    return error instanceof Error ? error.message : fallback;
}

function normalizeTopics(value: unknown) {
    return Array.isArray(value) ? value.filter((topic): topic is string => typeof topic === "string") : [];
}

function testingUserLabel(user: Pick<TestingUser, "fullName" | "username" | "email">) {
    return user.fullName || user.username || user.email;
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

export default function AdminContestManagePage() {
    const router = useRouter();
    const params = useParams();
    const { session } = useAuth();
    const { isContestManager, loading: managerLoading } = useContestManagerCheck();

    const contestId = params.id as string;
    const token = session?.access_token;

    const [contest, setContest] = useState<ManagedContest | null>(null);
    const [form, setForm] = useState({
        title: "",
        description: "",
        instructions: DEFAULT_CONTEST_INSTRUCTIONS,
        startTime: "",
        endTime: "",
        status: "UPCOMING" as ContestStatus,
    });
    const [currentQuestions, setCurrentQuestions] = useState<ManagedContestQuestion[]>([]);
    const [showDifficultyTags, setShowDifficultyTags] = useState(true);
    const [showParticipants, setShowParticipants] = useState(false);
    const [isUnderTesting, setIsUnderTesting] = useState(false);
    const [roundFlow, setRoundFlow] = useState<RoundFlow>("dsa_only");
    const [showScoreOnHub, setShowScoreOnHub] = useState(true);
    const [mcqSequential, setMcqSequential] = useState(false);

    const [questionBank, setQuestionBank] = useState<BankQuestion[]>([]);
    const [questionBankType, setQuestionBankType] = useState<QuestionKind>("dsa");
    const [bankSearch, setBankSearch] = useState("");
    const [bankDifficulty, setBankDifficulty] = useState<"all" | Difficulty>("all");

    const [loading, setLoading] = useState(true);
    const [bankLoading, setBankLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const [leaderboardState, setLeaderboardState] = useState<GeneratedLeaderboardState>(EMPTY_LEADERBOARD_STATE);
    const [leaderboardLoading, setLeaderboardLoading] = useState(false);
    const [generatingLeaderboard, setGeneratingLeaderboard] = useState(false);
    const [publishingLeaderboard, setPublishingLeaderboard] = useState(false);
    const [exportingPdf, setExportingPdf] = useState(false);
    const [leaderboardSuccess, setLeaderboardSuccess] = useState<string | null>(null);

    const [feedbackState, setFeedbackState] = useState<ContestFeedbackState>(EMPTY_FEEDBACK_STATE);
    const [feedbackLoading, setFeedbackLoading] = useState(false);
    const [feedbackError, setFeedbackError] = useState<string | null>(null);
    const [testingModalOpen, setTestingModalOpen] = useState(false);
    const [testingEmails, setTestingEmails] = useState<TestingUser[]>([]);
    const [testingSearch, setTestingSearch] = useState("");
    const [testingResults, setTestingResults] = useState<TestingUser[]>([]);
    const [testingLoading, setTestingLoading] = useState(false);
    const [testingSearchLoading, setTestingSearchLoading] = useState(false);
    const [testingActionUserId, setTestingActionUserId] = useState<string | null>(null);
    const [testingError, setTestingError] = useState<string | null>(null);

    const currentQuestionIds = useMemo(
        () => new Set(currentQuestions.map((question) => question.questionId)),
        [currentQuestions]
    );
    const totalPoints = currentQuestions.reduce(
        (sum, question) => sum + Math.max(0, parseIntegerInput(question.pointsInput) ?? question.points ?? 0),
        0
    );
    const totalNegativeCap = currentQuestions.reduce(
        (sum, question) => sum + normalizeNonNegativeInput(question.negativeCapInput),
        0
    );

    const loadContest = useCallback(async () => {
        if (!token || !contestId) return;
        setLoading(true);
        setError(null);

        try {
            const response = await fetch(`${contestApiUrl}/admin/contests/${contestId}/manage`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await response.json().catch(() => ({})) as ApiErrorPayload & { contest?: ManagedContest };
            if (!response.ok) throw new Error(getErrorMessage(data, "Failed to load contest"));

            if (!data.contest) throw new Error("Contest not found");
            const loadedContest = data.contest;
            const normalizedQuestions = (loadedContest.questions || []).map((question, index) => ({
                ...question,
                questionId: question.questionId || question.id || "",
                questionType: normalizeQuestionType(question.questionType),
                phase: normalizeQuestionType(question.phase || question.questionType),
                difficulty: normalizeDifficulty(question.difficulty),
                optionCount: Number(question.optionCount || 0) || undefined,
                topics: normalizeTopics(question.topics),
                points: Number(question.points || defaultPoints(normalizeDifficulty(question.difficulty))),
                negativePoints: Number(question.negativePoints || 0),
                negativeCap: Number(question.negativeCap || 0),
                pointsInput: String(Number(question.points || defaultPoints(normalizeDifficulty(question.difficulty)))),
                negativePointsInput: String(Number(question.negativePoints || 0)),
                negativeCapInput: String(Number(question.negativeCap || 0)),
                order: Number(question.order ?? index),
            }));

            setContest(loadedContest);
            setCurrentQuestions(normalizedQuestions);
            setShowDifficultyTags(loadedContest.showDifficultyTags !== false);
            setShowParticipants(loadedContest.showParticipants === true);
            setIsUnderTesting(loadedContest.isUnderTesting === true);
            setRoundFlow(
                loadedContest.roundFlow === "mcq_only"
                    ? "mcq_only"
                    : loadedContest.roundFlow === "mcq_then_dsa"
                        ? "mcq_then_dsa"
                        : "dsa_only"
            );
            setShowScoreOnHub(loadedContest.showScoreOnHub !== false);
            setMcqSequential(loadedContest.mcqSequential === true);
            setForm({
                title: loadedContest.title || "",
                description: loadedContest.description || "",
                instructions: loadedContest.instructions || DEFAULT_CONTEST_INSTRUCTIONS,
                startTime: toLocalInputValue(loadedContest.startTime),
                endTime: toLocalInputValue(loadedContest.endTime),
                status: loadedContest.status || "UPCOMING",
            });
        } catch (err: unknown) {
            setError(getUnknownErrorMessage(err, "Failed to load contest"));
            setContest(null);
        } finally {
            setLoading(false);
        }
    }, [token, contestId]);

    const loadQuestionBank = useCallback(async () => {
        if (!token) return;
        setBankLoading(true);

        try {
            const params = new URLSearchParams();
            params.set("limit", "100");
            params.set("used", "all");
            params.set("type", questionBankType);
            if (bankSearch.trim()) params.set("search", bankSearch.trim());
            if (bankDifficulty !== "all") params.set("difficulty", bankDifficulty);

            const response = await fetch(`${contestApiUrl}/admin/contest-questions?${params.toString()}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await response.json().catch(() => ({})) as ApiErrorPayload & { questions?: BankQuestionApiItem[] };
            if (!response.ok) throw new Error(getErrorMessage(data, "Failed to load contest question bank"));

            setQuestionBank((data.questions || []).map((question) => ({
                ...question,
                id: String(question.id || ""),
                questionType: normalizeQuestionType(question.questionType),
                title: String(question.title || "Untitled question"),
                difficulty: normalizeDifficulty(question.difficulty),
                optionCount: Number(question.optionCount || 0) || undefined,
                points: Number(question.points || 0) || undefined,
                topics: normalizeTopics(question.topics),
            })));
        } catch (err: unknown) {
            setError(getUnknownErrorMessage(err, "Failed to load contest question bank"));
            setQuestionBank([]);
        } finally {
            setBankLoading(false);
        }
    }, [token, bankSearch, bankDifficulty, questionBankType]);

    const loadGeneratedLeaderboard = useCallback(async () => {
        if (!token || !contestId) return;
        setLeaderboardLoading(true);

        try {
            const response = await fetch(`${contestApiUrl}/contests/${contestId}/leaderboard/generated?limit=10000`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await response.json().catch(() => ({})) as LeaderboardApiPayload;
            if (!response.ok) throw new Error(getErrorMessage(data, "Failed to load generated leaderboard"));

            setLeaderboardState({
                available: Boolean(data.available),
                published: Boolean(data.published),
                status: data.status || "PENDING",
                message: data.message || "Leaderboard has not been generated yet.",
                generatedAt: data.generatedAt,
                totalParticipants: data.totalParticipants,
                leaderboard: data.leaderboard || [],
            });
        } catch (err: unknown) {
            setLeaderboardState((current) => ({
                ...current,
                status: "FAILED",
                message: getUnknownErrorMessage(err, "Failed to load generated leaderboard"),
            }));
        } finally {
            setLeaderboardLoading(false);
        }
    }, [token, contestId]);

    const loadContestFeedback = useCallback(async () => {
        if (!token || !contestId) return;
        setFeedbackLoading(true);
        setFeedbackError(null);

        try {
            const response = await fetch(`${contestApiUrl}/admin/contests/${contestId}/feedback`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await response.json().catch(() => ({})) as FeedbackApiPayload;
            if (!response.ok) throw new Error(getErrorMessage(data, "Failed to load contest feedback"));

            setFeedbackState({
                total: Number(data.total || 0),
                averageRating: Number(data.averageRating || 0),
                distribution: {
                    1: Number(data.distribution?.[1] || 0),
                    2: Number(data.distribution?.[2] || 0),
                    3: Number(data.distribution?.[3] || 0),
                    4: Number(data.distribution?.[4] || 0),
                    5: Number(data.distribution?.[5] || 0),
                },
                feedback: data.feedback || [],
            });
        } catch (err: unknown) {
            setFeedbackState(EMPTY_FEEDBACK_STATE);
            setFeedbackError(getUnknownErrorMessage(err, "Failed to load contest feedback"));
        } finally {
            setFeedbackLoading(false);
        }
    }, [token, contestId]);

    const loadTestingEmails = useCallback(async () => {
        if (!token) return;
        setTestingLoading(true);
        setTestingError(null);

        try {
            const response = await fetch(`${contestApiUrl}/admin/contest-testing/testers`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await response.json().catch(() => ({})) as ApiErrorPayload & { testers?: TestingUser[] };
            if (!response.ok) throw new Error(getErrorMessage(data, "Failed to load testing emails"));
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
            if (!response.ok) throw new Error(getErrorMessage(data, "Failed to search users"));
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
            if (!response.ok) throw new Error(getErrorMessage(data, "Failed to add testing email"));
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
            if (!response.ok) throw new Error(getErrorMessage(data, "Failed to remove testing email"));
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
        loadContest();
    }, [isContestManager, token, loadContest]);

    useEffect(() => {
        if (!isContestManager || !token) return;
        const timer = window.setTimeout(loadQuestionBank, 180);
        return () => window.clearTimeout(timer);
    }, [isContestManager, token, loadQuestionBank]);

    useEffect(() => {
        if (!isContestManager || !token) return;
        loadGeneratedLeaderboard();
        loadContestFeedback();
    }, [isContestManager, token, loadGeneratedLeaderboard, loadContestFeedback]);

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

    const addQuestion = (question: BankQuestion) => {
        if (currentQuestionIds.has(question.id)) return;
        const questionType = normalizeQuestionType(question.questionType);
        const initialPoints = questionType === "mcq"
            ? Math.max(1, Number(question.points || 1))
            : defaultPoints(question.difficulty);

        const historyContestIds = question.usedInContests || [];
        const usedByThisContest = historyContestIds.includes(contestId);
        const activelyUsedByOtherContest = question.currentlyChoosedForContest && !usedByThisContest;
        if (activelyUsedByOtherContest) {
            setError("This question is currently selected by another contest.");
            return;
        }

        setError(null);
        setCurrentQuestions((current) => [
            ...current,
            {
                questionId: question.id,
                questionType,
                phase: questionType,
                problemId: question.problemId,
                frontendId: question.frontendId,
                problemSlug: question.problemSlug,
                title: question.title,
                difficulty: question.difficulty,
                optionCount: question.optionCount,
                topics: question.topics || [],
                usedInContests: question.usedInContests || [],
                isUsedInContest: Boolean(question.isUsedInContest),
                currentlyChoosedForContest: Boolean(question.currentlyChoosedForContest),
                points: initialPoints,
                negativePoints: 0,
                negativeCap: 0,
                pointsInput: String(initialPoints),
                negativePointsInput: "0",
                negativeCapInput: "0",
                order: current.length,
            },
        ]);
    };

    const removeQuestion = (questionId: string) => {
        setCurrentQuestions((current) =>
            current
                .filter((question) => question.questionId !== questionId)
                .map((question, index) => ({ ...question, order: index }))
        );
    };

    const updateQuestionConfig = (
        questionId: string,
        field: "pointsInput" | "negativePointsInput" | "negativeCapInput",
        value: string
    ) => {
        setCurrentQuestions((current) =>
            current.map((question) => {
                if (question.questionId !== questionId) return question;
                return { ...question, [field]: value };
            })
        );
    };

    const moveQuestion = (questionId: string, direction: -1 | 1) => {
        setCurrentQuestions((current) => {
            const index = current.findIndex((question) => question.questionId === questionId);
            const targetIndex = index + direction;
            if (index < 0 || targetIndex < 0 || targetIndex >= current.length) return current;

            const next = [...current];
            const [item] = next.splice(index, 1);
            next.splice(targetIndex, 0, item);
            return next.map((question, order) => ({ ...question, order }));
        });
    };

    const saveContest = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!token || !contestId) return;

        if (currentQuestions.length === 0) {
            setError("Keep at least one question in the contest.");
            return;
        }
        const hasMcqQuestion = currentQuestions.some((question) => normalizeQuestionType(question.questionType) === "mcq");
        const hasDsaQuestion = currentQuestions.some((question) => normalizeQuestionType(question.questionType) === "dsa");
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

        const startTime = localInputToIso(form.startTime);
        const endTime = localInputToIso(form.endTime);
        if (!startTime || !endTime) {
            setError("Enter a valid start and end time.");
            return;
        }

        setSaving(true);
        setError(null);
        setSuccess(null);
        setLeaderboardSuccess(null);

        try {
            const questionPayload = buildQuestionPayload(currentQuestions);
            const response = await fetch(`${contestApiUrl}/admin/contests/${contestId}/manage`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    title: form.title,
                    description: form.description,
                    instructions: form.instructions,
                    startTime,
                    endTime,
                    status: form.status,
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
            if (!response.ok) throw new Error(getErrorMessage(data, "Failed to update contest"));

            setSuccess("Contest setup saved.");
            await loadContest();
            await loadQuestionBank();
            await loadGeneratedLeaderboard();
        } catch (err: unknown) {
            setError(getUnknownErrorMessage(err, "Failed to update contest"));
        } finally {
            setSaving(false);
        }
    };

    const createLeaderboard = async () => {
        if (!token || !contestId) return;
        setGeneratingLeaderboard(true);
        setError(null);
        setLeaderboardSuccess(null);

        try {
            const response = await fetch(`${contestApiUrl}/admin/contests/${contestId}/leaderboard/generated`, {
                method: "POST",
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await response.json().catch(() => ({})) as LeaderboardApiPayload;
            if (!response.ok) throw new Error(getErrorMessage(data, "Failed to create leaderboard"));

            setLeaderboardState({
                available: Boolean(data.available),
                published: Boolean(data.published),
                status: data.status || "READY",
                message: data.message || "Leaderboard generated successfully.",
                generatedAt: data.generatedAt,
                totalParticipants: data.totalParticipants,
                leaderboard: data.leaderboard || [],
            });
            setLeaderboardSuccess(
                `Leaderboard ${leaderboardState.available ? "refreshed" : "created"} with ${data.totalParticipants || 0} participants. ` +
                `${data.published ? "It is visible to participants." : "It is private — publish it when you're ready."}`
            );
        } catch (err: unknown) {
            setError(getUnknownErrorMessage(err, "Failed to create leaderboard"));
        } finally {
            setGeneratingLeaderboard(false);
        }
    };

    const setLeaderboardPublished = async (published: boolean) => {
        if (!token || !contestId) return;
        setPublishingLeaderboard(true);
        setError(null);
        setLeaderboardSuccess(null);

        try {
            const response = await fetch(`${contestApiUrl}/admin/contests/${contestId}/leaderboard/publish`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ published }),
            });
            const data = await response.json().catch(() => ({})) as LeaderboardApiPayload;
            if (!response.ok) throw new Error(getErrorMessage(data, "Failed to update leaderboard visibility"));

            setLeaderboardState((current) => ({
                ...current,
                available: Boolean(data.available ?? current.available),
                published: Boolean(data.published),
                leaderboard: data.leaderboard || current.leaderboard,
                totalParticipants: data.totalParticipants ?? current.totalParticipants,
            }));
            setLeaderboardSuccess(published ? "Leaderboard is now public — participants can see it." : "Leaderboard is now private — hidden from participants.");
        } catch (err: unknown) {
            setError(getUnknownErrorMessage(err, "Failed to update leaderboard visibility"));
        } finally {
            setPublishingLeaderboard(false);
        }
    };

    const exportLeaderboardPdf = async () => {
        if (!leaderboardState.available || leaderboardState.leaderboard.length === 0) return;
        setExportingPdf(true);
        setError(null);

        try {
            const { jsPDF } = await import("jspdf");
            const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
            const pageWidth = doc.internal.pageSize.getWidth();
            const pageHeight = doc.internal.pageSize.getHeight();
            const marginX = 40;

            const title = (form.title || "Contest").trim();
            const generatedLabel = leaderboardState.generatedAt
                ? new Date(leaderboardState.generatedAt).toLocaleString()
                : new Date().toLocaleString();
            const participantCount = leaderboardState.totalParticipants ?? leaderboardState.leaderboard.length;

            const formatTime = (seconds: number) => {
                const total = Math.max(0, Math.floor(Number(seconds) || 0));
                const h = Math.floor(total / 3600);
                const m = Math.floor((total % 3600) / 60);
                const s = total % 60;
                const pad = (n: number) => String(n).padStart(2, "0");
                return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
            };
            const fit = (text: string, width: number) => {
                let value = (text ?? "").toString();
                if (doc.getTextWidth(value) <= width) return value;
                while (value.length > 1 && doc.getTextWidth(`${value}…`) > width) {
                    value = value.slice(0, -1);
                }
                return `${value}…`;
            };

            const columns: Array<{ label: string; width: number; align: "left" | "right"; value: (e: LeaderboardEntry) => string }> = [
                { label: "#", width: 32, align: "left", value: (e) => String(e.rank) },
                { label: "Participant", width: 210, align: "left", value: (e) => e.participant || e.displayName || e.hacker || e.username || e.userId || "—" },
                { label: "Username", width: 120, align: "left", value: (e) => e.username || "—" },
                { label: "Score", width: 60, align: "right", value: (e) => String(e.score ?? 0) },
                { label: "Solved", width: 55, align: "right", value: (e) => String(e.solvedCount ?? 0) },
                { label: "Time", width: 58, align: "right", value: (e) => formatTime(e.timeSeconds) },
            ];
            const xEdges: number[] = [];
            let cursor = marginX;
            for (const col of columns) {
                xEdges.push(cursor);
                cursor += col.width;
            }
            const cellX = (index: number, align: "left" | "right") =>
                align === "right" ? xEdges[index] + columns[index].width - 4 : xEdges[index] + 2;

            let y = 54;
            doc.setFont("helvetica", "bold");
            doc.setFontSize(16);
            doc.text(`${title} — Standings`, marginX, y);
            y += 16;
            doc.setFont("helvetica", "normal");
            doc.setFontSize(9);
            doc.setTextColor(120);
            doc.text(
                `${participantCount} participants  ·  Generated ${generatedLabel}  ·  ${leaderboardState.published ? "Public" : "Private"}`,
                marginX,
                y,
            );
            doc.setTextColor(0);
            y += 22;

            const drawHeader = () => {
                doc.setFont("helvetica", "bold");
                doc.setFontSize(10);
                columns.forEach((col, index) => {
                    doc.text(col.label, cellX(index, col.align), y, { align: col.align });
                });
                y += 6;
                doc.setDrawColor(200);
                doc.line(marginX, y, cursor, y);
                y += 14;
                doc.setFont("helvetica", "normal");
            };

            drawHeader();
            doc.setFontSize(9);
            for (const entry of leaderboardState.leaderboard) {
                if (y > pageHeight - 40) {
                    doc.addPage();
                    y = 54;
                    drawHeader();
                    doc.setFontSize(9);
                }
                columns.forEach((col, index) => {
                    doc.text(fit(col.value(entry), col.width - 4), cellX(index, col.align), y, { align: col.align });
                });
                y += 15;
            }

            const safeTitle = (title || "contest").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "contest";
            doc.save(`${safeTitle}-standings.pdf`);
            setLeaderboardSuccess(`Exported ${leaderboardState.leaderboard.length} standings to PDF.`);
        } catch (err: unknown) {
            setError(getUnknownErrorMessage(err, "Failed to export leaderboard PDF"));
        } finally {
            setExportingPdf(false);
        }
    };

    if (managerLoading || loading) {
        return (
            <div className="flex min-h-[60vh] flex-1 items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            </div>
        );
    }

    if (!isContestManager) return <NotAuthorized />;

    if (!contest) {
        return (
            <div className="flex min-h-[60vh] flex-1 flex-col items-center justify-center px-6 text-center">
                <h1 className="text-xl font-bold text-slate-950 dark:text-white">Contest not found</h1>
                <button
                    type="button"
                    onClick={() => router.push("/admin/contests")}
                    className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-100 dark:border-[#333] dark:bg-[#242424] dark:text-[#ddd]"
                >
                    Back to contests
                </button>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#f7f8fb] px-4 py-8 text-slate-950 dark:bg-lc-bg dark:text-white sm:px-6 lg:px-8">
            <div className="mx-auto max-w-7xl">
                <div className="mb-8 flex flex-col gap-5 border-b border-slate-200 pb-7 dark:border-lc-border lg:flex-row lg:items-end lg:justify-between">
                    <div>
                        <div className="mb-3 flex flex-wrap items-center gap-2">
                            <span className={`rounded-full border px-3 py-1 text-xs font-black uppercase tracking-[0.12em] ${STATUS_STYLES[form.status]}`}>
                                {form.status}
                            </span>
                            <span className="text-sm font-bold text-slate-500">
                                {currentQuestions.length} questions - {contest._count?.participants || 0} participants
                            </span>
                        </div>
                        <h1 className="font-nunito text-4xl font-extrabold tracking-normal text-slate-950 dark:text-white sm:text-5xl">Manage Contest</h1>
                        <p className="mt-3 max-w-2xl text-base font-semibold leading-7 text-slate-500 dark:text-slate-400">
                            Update timing, instructions, scoring, and the live question set from one control panel.
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                        {leaderboardState.available && (
                            <span
                                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-extrabold ${leaderboardState.published
                                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200"
                                    : "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-200"}`}
                            >
                                <span className={`h-2 w-2 rounded-full ${leaderboardState.published ? "bg-emerald-500" : "bg-amber-500"}`} />
                                {leaderboardState.published ? "Public" : "Private"}
                            </span>
                        )}
                        <button
                            type="button"
                            onClick={createLeaderboard}
                            disabled={generatingLeaderboard || !(form.status === "ACTIVE" || form.status === "ENDED")}
                            title={!(form.status === "ACTIVE" || form.status === "ENDED") ? "Leaderboard can be generated once the contest is active" : undefined}
                            className="rounded-full bg-slate-950 px-5 py-2.5 text-sm font-extrabold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
                        >
                            {generatingLeaderboard ? "Generating..." : leaderboardState.available ? "Refresh leaderboard" : "Generate leaderboard"}
                        </button>
                        {leaderboardState.available && (
                            <button
                                type="button"
                                onClick={() => setLeaderboardPublished(!leaderboardState.published)}
                                disabled={publishingLeaderboard || generatingLeaderboard}
                                className={`rounded-full px-5 py-2.5 text-sm font-extrabold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${leaderboardState.published
                                    ? "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-lc-border dark:bg-lc-surface dark:text-slate-200 dark:hover:bg-lc-hover"
                                    : "bg-emerald-600 text-white hover:bg-emerald-500"}`}
                            >
                                {publishingLeaderboard ? "Updating..." : leaderboardState.published ? "Make private" : "Publish to participants"}
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => router.push("/admin/contests")}
                            className="rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm font-extrabold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 dark:border-lc-border dark:bg-lc-surface dark:text-slate-200 dark:hover:bg-lc-hover"
                        >
                            Back to contests
                        </button>
                    </div>
                </div>

                {error && (
                    <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
                        {error}
                    </div>
                )}
                {success && (
                    <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
                        {success}
                    </div>
                )}
                {leaderboardSuccess && (
                    <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
                        {leaderboardSuccess}
                    </div>
                )}

                <form onSubmit={saveContest} className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_410px]">
                    <div className="rounded-[28px] bg-white/90 p-6 shadow-[0_18px_50px_rgba(15,23,42,0.07)] ring-1 ring-slate-200/80 dark:bg-lc-surface dark:ring-lc-border sm:p-8">
                        <section className="border-b border-slate-200 pb-8 dark:border-lc-border">
                            <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-slate-400">Details</p>
                            <h2 className="mt-1 font-nunito text-2xl font-extrabold text-slate-950 dark:text-white">Contest information</h2>

                            <div className="mt-5 grid gap-5 md:grid-cols-2">
                                <label className="md:col-span-2">
                                    <span className="mb-2 block text-sm font-extrabold text-slate-700 dark:text-slate-200">Title</span>
                                    <input
                                        value={form.title}
                                        onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                                        required
                                        minLength={3}
                                        maxLength={200}
                                        className="w-full rounded-2xl border border-slate-200 bg-[#f8fafc] px-4 py-3 text-sm font-semibold text-slate-950 outline-none transition focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-bg dark:text-white dark:focus:bg-[#202020]"
                                    />
                                </label>

                                <label className="md:col-span-2">
                                    <span className="mb-2 block text-sm font-extrabold text-slate-700 dark:text-slate-200">Description</span>
                                    <textarea
                                        value={form.description}
                                        onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                                        required
                                        minLength={10}
                                        maxLength={5000}
                                        rows={4}
                                        className="w-full resize-y rounded-2xl border border-slate-200 bg-[#f8fafc] px-4 py-3 text-sm font-semibold leading-6 text-slate-950 outline-none transition focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-bg dark:text-white dark:focus:bg-[#202020]"
                                    />
                                </label>

                                <label>
                                    <span className="mb-2 block text-sm font-extrabold text-slate-700 dark:text-slate-200">Start time</span>
                                    <input
                                        type="datetime-local"
                                        value={form.startTime}
                                        onChange={(event) => setForm((current) => ({ ...current, startTime: event.target.value }))}
                                        required
                                        className="w-full rounded-2xl border border-slate-200 bg-[#f8fafc] px-4 py-3 text-sm font-semibold text-slate-950 outline-none transition focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-bg dark:text-white dark:focus:bg-[#202020]"
                                    />
                                </label>

                                <label>
                                    <span className="mb-2 block text-sm font-extrabold text-slate-700 dark:text-slate-200">End time</span>
                                    <input
                                        type="datetime-local"
                                        value={form.endTime}
                                        onChange={(event) => setForm((current) => ({ ...current, endTime: event.target.value }))}
                                        required
                                        className="w-full rounded-2xl border border-slate-200 bg-[#f8fafc] px-4 py-3 text-sm font-semibold text-slate-950 outline-none transition focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-bg dark:text-white dark:focus:bg-[#202020]"
                                    />
                                </label>

                                <div>
                                    <span className="mb-2 block text-sm font-extrabold text-slate-700 dark:text-slate-200">Status</span>
                                    <SegmentedFilter
                                        value={form.status}
                                        onChange={(status) => setForm((current) => ({ ...current, status }))}
                                        ariaLabel="Contest status"
                                        options={[
                                            { label: "Upcoming", value: "UPCOMING" },
                                            { label: "Active", value: "ACTIVE" },
                                            { label: "Ended", value: "ENDED" },
                                        ]}
                                    />
                                </div>

                                <div className="rounded-2xl bg-slate-50 p-4 dark:bg-lc-bg">
                                    <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-slate-400">Current window</p>
                                    <p className="mt-2 text-sm font-bold text-slate-700 dark:text-[#ddd]">
                                        {formatDateTime(contest.startTime)} to {formatDateTime(contest.endTime)}
                                    </p>
                                </div>
                            </div>
                        </section>

                        <section className="border-b border-slate-200 py-8 dark:border-lc-border">
                            <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-slate-400">Participant instructions</p>
                            <h2 className="mt-1 font-nunito text-2xl font-extrabold text-slate-950 dark:text-white">Fullscreen entry copy</h2>
                            <textarea
                                value={form.instructions}
                                onChange={(event) => setForm((current) => ({ ...current, instructions: event.target.value }))}
                                required
                                minLength={20}
                                maxLength={6000}
                                rows={8}
                                className="mt-5 w-full resize-y rounded-2xl border border-slate-200 bg-[#f8fafc] px-4 py-3 text-sm font-semibold leading-6 text-slate-950 outline-none transition focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-bg dark:text-white dark:focus:bg-[#202020]"
                            />
                        </section>

                        <section className="pt-8">
                            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                                <div>
                                    <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-slate-400">Question bank</p>
                                    <h2 className="mt-1 font-nunito text-2xl font-extrabold text-slate-950 dark:text-white">Add contest questions</h2>
                                </div>
                                <button
                                    type="button"
                                    onClick={loadQuestionBank}
                                    disabled={bankLoading}
                                    className="w-fit rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-extrabold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60 dark:border-lc-border dark:bg-lc-bg dark:text-slate-200"
                                >
                                    {bankLoading ? "Refreshing..." : "Refresh bank"}
                                </button>
                            </div>

                            <div className="mt-5">
                                <SegmentedFilter
                                    value={questionBankType}
                                    onChange={setQuestionBankType}
                                    ariaLabel="Question bank type"
                                    options={[
                                        { label: "DSA coding", value: "dsa" },
                                        { label: "MCQ", value: "mcq" },
                                    ]}
                                />
                            </div>

                            <div className="mt-4 flex flex-col gap-3 2xl:flex-row 2xl:items-start">
                                <div className="relative min-w-0 flex-1 2xl:min-w-[280px]">
                                    <span className="material-symbols-outlined pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">search</span>
                                    <input
                                        value={bankSearch}
                                        onChange={(event) => setBankSearch(event.target.value)}
                                        className="w-full rounded-2xl border border-slate-200 bg-[#f8fafc] py-3 pl-12 pr-4 text-sm font-semibold text-slate-950 outline-none transition focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-bg dark:text-white dark:focus:bg-[#202020]"
                                        placeholder="Search by title, slug, or ID"
                                    />
                                </div>
                                <div className="flex flex-wrap gap-3">
                                    <SegmentedFilter
                                        value={bankDifficulty}
                                        onChange={setBankDifficulty}
                                        ariaLabel="Difficulty filter"
                                        options={[
                                            { label: "All", value: "all" },
                                            { label: "Easy", value: "Easy" },
                                            { label: "Medium", value: "Medium" },
                                            { label: "Hard", value: "Hard" },
                                        ]}
                                    />
                                </div>
                            </div>

                            <div className="mt-5 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-lc-bg dark:ring-lc-border">
                                <div className="grid grid-cols-[minmax(0,1fr)_120px_130px] bg-slate-50 px-4 py-3 text-xs font-extrabold uppercase tracking-[0.12em] text-slate-500 dark:bg-[#202020]">
                                    <span>Question</span>
                                    <span>Difficulty</span>
                                    <span className="text-right">Action</span>
                                </div>
                                <div className="max-h-[420px] divide-y divide-slate-100 overflow-y-auto dark:divide-[#303030]">
                                    {bankLoading ? (
                                        <div className="flex items-center justify-center py-14 text-sm font-bold text-slate-500">Loading questions...</div>
                                    ) : questionBank.length === 0 ? (
                                        <div className="flex items-center justify-center py-14 text-sm font-bold text-slate-500">No contest questions match these filters.</div>
                                    ) : (
                                        questionBank.map((question) => {
                                            const inContest = currentQuestionIds.has(question.id);
                                            const usedByThisContest = (question.usedInContests || []).includes(contestId);
                                            const usedByOtherContest = hasUsageHistory(question) && !usedByThisContest;
                                            const activelyUsedByOtherContest = Boolean(question.currentlyChoosedForContest && !usedByThisContest);
                                            const unavailable = activelyUsedByOtherContest && !inContest;

                                            return (
                                                <div key={question.id} className="grid grid-cols-[minmax(0,1fr)_120px_130px] items-center gap-3 px-4 py-4 hover:bg-slate-50 dark:hover:bg-[#2b2b2b]">
                                                    <div className="min-w-0">
                                                        <div className="flex flex-wrap items-center gap-2">
                                                            <p className="truncate text-sm font-black text-slate-950 dark:text-white">{question.title}</p>
                                                            <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-black uppercase text-slate-600 dark:border-[#3a3a3a] dark:bg-[#252525] dark:text-slate-300">
                                                                {normalizeQuestionType(question.questionType) === "mcq" ? "MCQ" : "DSA"}
                                                            </span>
                                                            {inContest && <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[11px] font-black uppercase text-primary">In contest</span>}
                                                            {!inContest && usedByOtherContest && <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-black uppercase text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300">Used</span>}
                                                            {!inContest && activelyUsedByOtherContest && <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-black uppercase text-red-700 dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-300">Active</span>}
                                                        </div>
                                                        <p className="mt-1 truncate text-xs font-semibold text-slate-500">
                                                            #{question.frontendId || question.problemId || question.id}
                                                            {question.topics.length ? ` - ${question.topics.slice(0, 3).join(", ")}` : ""}
                                                            {normalizeQuestionType(question.questionType) === "mcq" && question.optionCount ? ` - ${question.optionCount} options` : ""}
                                                        </p>
                                                    </div>
                                                    <span className={`w-fit rounded-full border px-2.5 py-1 text-xs font-black ${DIFFICULTY_STYLES[question.difficulty]}`}>
                                                        {question.difficulty}
                                                    </span>
                                                    <div className="flex justify-end">
                                                        <button
                                                            type="button"
                                                            onClick={() => addQuestion(question)}
                                                            disabled={inContest || unavailable}
                                                            className="rounded-full bg-slate-950 px-4 py-2 text-xs font-extrabold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 dark:bg-white dark:text-slate-950 dark:disabled:bg-[#333] dark:disabled:text-[#777]"
                                                        >
                                                            {inContest ? "Added" : unavailable ? "Active" : "Add"}
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

                    <aside className="xl:sticky xl:top-6 xl:self-start">
                        <section className="rounded-[28px] bg-white p-6 shadow-[0_22px_60px_rgba(15,23,42,0.10)] ring-1 ring-slate-200/80 dark:bg-lc-surface dark:ring-lc-border">
                            <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-slate-400">Live setup</p>
                            <h2 className="mt-1 font-nunito text-2xl font-extrabold text-slate-950 dark:text-white">Scoring and questions</h2>

                            <div className="mt-5 grid grid-cols-3 divide-x divide-slate-200 rounded-2xl bg-slate-50 px-2 py-4 dark:divide-lc-border dark:bg-lc-bg">
                                <div className="px-3">
                                    <p className="text-xs font-bold text-slate-500">Questions</p>
                                    <p className="mt-1 text-2xl font-extrabold text-slate-950 dark:text-white">{currentQuestions.length}</p>
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
                                    DSA and MCQ questions can define a wrong-answer penalty and max negative cap.
                                </p>
                            </div>

                            <div className="border-b border-slate-200 py-4 dark:border-lc-border">
                                <span className="mb-2 block text-sm font-extrabold text-slate-950 dark:text-white">Round flow</span>
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
                                <p className="mt-2 max-w-full text-xs font-bold leading-5 text-slate-500 dark:text-slate-400">
                                    MCQ only runs just the MCQ round. MCQ then DSA locks coding until MCQs are submitted.
                                </p>
                            </div>

                            <button
                                type="button"
                                role="switch"
                                aria-checked={showScoreOnHub}
                                onClick={() => setShowScoreOnHub((value) => !value)}
                                className="flex w-full items-center justify-between gap-4 border-b border-slate-200 py-4 text-left transition dark:border-lc-border"
                            >
                                <span>
                                    <span className="block text-sm font-extrabold text-slate-950 dark:text-white">Show score on hub</span>
                                    <span className="mt-1 block text-xs font-bold text-slate-500 dark:text-slate-400">
                                        {showScoreOnHub
                                            ? "Participants can see aggregate score between rounds."
                                            : "Score is hidden on the contest hub until submission or contest end."}
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
                                    <span className="block text-sm font-extrabold text-slate-950 dark:text-white">Sequential MCQs</span>
                                    <span className="mt-1 block text-xs font-bold text-slate-500 dark:text-slate-400">
                                        {mcqSequential
                                            ? "Participants must submit each MCQ before the next one opens."
                                            : "Participants can open any unsubmitted MCQ in the MCQ round."}
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
                                    <span className="block text-sm font-extrabold text-slate-950 dark:text-white">Show difficulty tags</span>
                                    <span className="mt-1 block text-xs font-bold text-slate-500 dark:text-slate-400">
                                        {showDifficultyTags
                                            ? "Participants see Easy, Medium, and Hard labels."
                                            : "Participants only see titles, points, and attempts."}
                                    </span>
                                </span>
                                <span className={`flex h-7 w-12 shrink-0 items-center rounded-full p-1 transition ${showDifficultyTags ? "bg-primary" : "bg-slate-300 dark:bg-[#444]"}`}>
                                    <span className={`h-5 w-5 rounded-full bg-white shadow-sm transition ${showDifficultyTags ? "translate-x-5" : "translate-x-0"}`} />
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
                                    <span className="block text-sm font-extrabold text-slate-950 dark:text-white">Show participant count</span>
                                    <span className="mt-1 block text-xs font-bold text-slate-500 dark:text-slate-400">
                                        {showParticipants
                                            ? "Participants see the registration count on contest cards."
                                            : "Participant counts stay hidden from contest cards."}
                                    </span>
                                </span>
                                <span className={`flex h-7 w-12 shrink-0 items-center rounded-full p-1 transition ${showParticipants ? "bg-primary" : "bg-slate-300 dark:bg-[#444]"}`}>
                                    <span className={`h-5 w-5 rounded-full bg-white shadow-sm transition ${showParticipants ? "translate-x-5" : "translate-x-0"}`} />
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
                                    <span className="block text-sm font-extrabold text-slate-950 dark:text-white">Under testing</span>
                                    <span className="mt-1 block text-xs font-bold text-slate-500 dark:text-slate-400">
                                        {isUnderTesting
                                            ? "Only users in your testing email list can see this contest."
                                            : "Contest follows normal visibility for all users."}
                                    </span>
                                </span>
                                <span className={`flex h-7 w-12 shrink-0 items-center rounded-full p-1 transition ${isUnderTesting ? "bg-primary" : "bg-slate-300 dark:bg-[#444]"}`}>
                                    <span className={`h-5 w-5 rounded-full bg-white shadow-sm transition ${isUnderTesting ? "translate-x-5" : "translate-x-0"}`} />
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

                            <p className="mt-4 text-xs font-semibold leading-5 text-slate-500">
                                Removing a question with existing submissions is blocked to protect participant history.
                            </p>

                            <div className="mt-5 max-h-[560px] divide-y divide-slate-200 overflow-y-auto pr-1 dark:divide-lc-border">
                                {currentQuestions.length === 0 ? (
                                    <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm font-bold text-slate-500 dark:border-lc-border">
                                        Add at least one question from the bank.
                                    </div>
                                ) : (
                                    currentQuestions.map((question, index) => (
                                        <div key={question.questionId} className="py-4 first:pt-0 last:pb-0">
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-slate-400">Q{index + 1}</p>
                                                        <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-black uppercase text-slate-600 dark:border-[#3a3a3a] dark:bg-[#252525] dark:text-slate-300">
                                                            {normalizeQuestionType(question.questionType) === "mcq" ? "MCQ" : "DSA"}
                                                        </span>
                                                        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-black ${DIFFICULTY_STYLES[question.difficulty]}`}>
                                                            {question.difficulty}
                                                        </span>
                                                    </div>
                                                    <h3 className="mt-2 truncate text-sm font-extrabold text-slate-950 dark:text-white">{question.title}</h3>
                                                    <p className="mt-1 truncate text-xs font-semibold text-slate-500">
                                                        #{question.frontendId || question.problemId || question.questionId}
                                                        {normalizeQuestionType(question.questionType) === "mcq" && question.optionCount ? ` - ${question.optionCount} options` : ""}
                                                    </p>
                                                </div>
                                                <div className="flex shrink-0 items-center gap-1">
                                                    <button
                                                        type="button"
                                                        onClick={() => moveQuestion(question.questionId, -1)}
                                                        disabled={index === 0}
                                                        className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-[#292929] dark:hover:text-white"
                                                        aria-label={`Move ${question.title} up`}
                                                    >
                                                        <span className="material-symbols-outlined text-lg">keyboard_arrow_up</span>
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => moveQuestion(question.questionId, 1)}
                                                        disabled={index === currentQuestions.length - 1}
                                                        className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-[#292929] dark:hover:text-white"
                                                        aria-label={`Move ${question.title} down`}
                                                    >
                                                        <span className="material-symbols-outlined text-lg">keyboard_arrow_down</span>
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => removeQuestion(question.questionId)}
                                                        className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white hover:text-rose-500 dark:hover:bg-[#292929]"
                                                        aria-label={`Remove ${question.title}`}
                                                    >
                                                        <span className="material-symbols-outlined text-lg">close</span>
                                                    </button>
                                                </div>
                                            </div>
                                            <label className="mt-4 block">
                                                <span className="mb-1 block text-xs font-bold text-slate-500">Points</span>
                                                <input
                                                    type="number"
                                                    min={1}
                                                    value={question.pointsInput}
                                                    onChange={(event) => updateQuestionConfig(question.questionId, "pointsInput", event.target.value)}
                                                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-950 outline-none focus:border-primary dark:border-lc-border dark:bg-lc-bg dark:text-white"
                                                />
                                            </label>
                                            <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                                <label>
                                                    <span className="mb-1 block text-xs font-bold text-slate-500">Wrong penalty</span>
                                                    <input
                                                        type="number"
                                                        min={0}
                                                        value={question.negativePointsInput}
                                                        onChange={(event) => updateQuestionConfig(question.questionId, "negativePointsInput", event.target.value)}
                                                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-950 outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-60 dark:border-lc-border dark:bg-lc-bg dark:text-white"
                                                    />
                                                </label>
                                                <label>
                                                    <span className="mb-1 block text-xs font-bold text-slate-500">Max negative cap</span>
                                                    <input
                                                        type="number"
                                                        min={0}
                                                        step={Math.max(1, normalizeNonNegativeInput(question.negativePointsInput))}
                                                        value={question.negativeCapInput}
                                                        onChange={(event) => updateQuestionConfig(question.questionId, "negativeCapInput", event.target.value)}
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
                                disabled={saving || currentQuestions.length === 0}
                                className="mt-5 w-full rounded-full bg-slate-950 px-5 py-3.5 text-sm font-extrabold text-white shadow-lg shadow-slate-950/15 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200 dark:disabled:bg-[#333] dark:disabled:text-slate-500"
                            >
                                {saving ? "Saving..." : "Save contest"}
                            </button>
                        </section>
                    </aside>
                </form>

                <section className="mt-8 rounded-[28px] bg-white/90 p-6 shadow-[0_18px_50px_rgba(15,23,42,0.07)] ring-1 ring-slate-200/80 dark:bg-lc-surface dark:ring-lc-border">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-slate-400">Leaderboard</p>
                            <h2 className="mt-1 font-nunito text-2xl font-extrabold text-slate-950 dark:text-white">Generated standings</h2>
                            <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">
                                {leaderboardState.available
                                    ? leaderboardState.published
                                        ? "Public — participants can see these standings."
                                        : "Private — only you can see this. Publish it to reveal it to participants."
                                    : "Generate a private snapshot at any point during the contest, then publish when ready."}
                            </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                            <button
                                type="button"
                                onClick={createLeaderboard}
                                disabled={generatingLeaderboard || !(form.status === "ACTIVE" || form.status === "ENDED")}
                                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-extrabold text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-lc-border dark:bg-lc-bg dark:text-slate-200"
                            >
                                {generatingLeaderboard ? "Generating..." : leaderboardState.available ? "Refresh" : "Generate"}
                            </button>
                            {leaderboardState.available && (
                                <button
                                    type="button"
                                    onClick={() => setLeaderboardPublished(!leaderboardState.published)}
                                    disabled={publishingLeaderboard || generatingLeaderboard}
                                    className={`rounded-full px-4 py-2 text-sm font-extrabold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${leaderboardState.published
                                        ? "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-lc-border dark:bg-lc-bg dark:text-slate-200"
                                        : "bg-emerald-600 text-white hover:bg-emerald-500"}`}
                                >
                                    {publishingLeaderboard ? "Updating..." : leaderboardState.published ? "Make private" : "Publish"}
                                </button>
                            )}
                            {leaderboardState.available && leaderboardState.leaderboard.length > 0 && (
                                <button
                                    type="button"
                                    onClick={exportLeaderboardPdf}
                                    disabled={exportingPdf}
                                    className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-extrabold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-lc-border dark:bg-lc-bg dark:text-slate-200"
                                >
                                    {exportingPdf ? "Exporting..." : "Export PDF"}
                                </button>
                            )}
                        </div>
                    </div>

                    {leaderboardLoading ? (
                        <div className="mt-6 flex items-center justify-center rounded-xl border border-slate-100 bg-slate-50 py-10 dark:border-[#333] dark:bg-[#1c1c1c]">
                            <div className="h-7 w-7 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                        </div>
                    ) : leaderboardState.available && leaderboardState.leaderboard.length > 0 ? (
                        <div className="mt-6 overflow-x-auto rounded-2xl ring-1 ring-slate-200 dark:ring-lc-border">
                            <table className="w-full text-sm">
                                <thead className="bg-slate-50 text-xs font-black uppercase tracking-[0.12em] text-slate-500 dark:bg-[#1c1c1c]">
                                    <tr>
                                        <th className="px-4 py-3 text-left">Rank</th>
                                        <th className="px-4 py-3 text-left">Student</th>
                                        <th className="px-4 py-3 text-right">Score</th>
                                        <th className="px-4 py-3 text-right">Solved</th>
                                        <th className="px-4 py-3 text-right">Time</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-[#333]">
                                    {leaderboardState.leaderboard.map((entry) => (
                                        <tr key={`${entry.rank}-${entry.userId || entry.participant || entry.hacker}`}>
                                            <td className="px-4 py-3 font-black text-primary">#{entry.rank}</td>
                                            <td className="px-4 py-3 font-bold text-slate-950 dark:text-white">{entry.participant || entry.displayName || entry.username || entry.hacker}</td>
                                            <td className="px-4 py-3 text-right font-black text-slate-950 dark:text-white">{entry.score}</td>
                                            <td className="px-4 py-3 text-right font-bold text-slate-600 dark:text-slate-300">{entry.solvedCount ?? 0}</td>
                                            <td className="px-4 py-3 text-right font-bold text-slate-600 dark:text-slate-300">{formatDuration(entry.timeSeconds)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="mt-6 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm font-bold text-slate-500 dark:border-[#444] dark:bg-[#1c1c1c]">
                            {leaderboardState.message}
                        </div>
                    )}
                </section>

                <section className="mt-8 rounded-[28px] bg-white/90 p-6 shadow-[0_18px_50px_rgba(15,23,42,0.07)] ring-1 ring-slate-200/80 dark:bg-lc-surface dark:ring-lc-border">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                            <div className="grid h-10 w-10 place-items-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300">
                                <Star className="h-5 w-5" fill="currentColor" />
                            </div>
                            <div>
                                <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-slate-400">Feedback</p>
                                <h2 className="mt-1 font-nunito text-2xl font-extrabold text-slate-950 dark:text-white">Contest reviews</h2>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={loadContestFeedback}
                            disabled={feedbackLoading}
                            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-extrabold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60 dark:border-lc-border dark:bg-lc-bg dark:text-slate-200"
                        >
                            {feedbackLoading ? "Refreshing..." : "Refresh"}
                        </button>
                    </div>

                    {feedbackError && (
                        <div className="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
                            {feedbackError}
                        </div>
                    )}

                    <div className="mt-5 grid gap-4 md:grid-cols-3">
                        <div className="rounded-xl bg-slate-50 p-4 dark:bg-[#1c1c1c]">
                            <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Average rating</p>
                            <p className="mt-2 text-3xl font-black text-slate-950 dark:text-white">{feedbackState.averageRating.toFixed(1)} <span className="text-sm text-slate-500">/ 5</span></p>
                        </div>
                        <div className="rounded-xl bg-slate-50 p-4 dark:bg-[#1c1c1c]">
                            <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Responses</p>
                            <p className="mt-2 text-3xl font-black text-slate-950 dark:text-white">{feedbackState.total}</p>
                        </div>
                        <div className="rounded-xl bg-slate-50 p-4 dark:bg-[#1c1c1c]">
                            <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Rating spread</p>
                            <div className="mt-3 space-y-2">
                                {[5, 4, 3, 2, 1].map((rating) => {
                                    const count = feedbackState.distribution[rating as 1 | 2 | 3 | 4 | 5] || 0;
                                    const width = feedbackState.total ? Math.round((count / feedbackState.total) * 100) : 0;
                                    return (
                                        <div key={rating} className="grid grid-cols-[34px_1fr_24px] items-center gap-2 text-xs font-bold text-slate-500">
                                            <span>{rating}/5</span>
                                            <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-[#333]">
                                                <div className="h-full rounded-full bg-amber-400" style={{ width: `${width}%` }} />
                                            </div>
                                            <span className="text-right">{count}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    {feedbackLoading ? (
                        <div className="mt-6 flex items-center justify-center rounded-xl border border-slate-100 bg-slate-50 py-10 dark:border-[#333] dark:bg-[#1c1c1c]">
                            <div className="h-7 w-7 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                        </div>
                    ) : feedbackState.feedback.length === 0 ? (
                        <div className="mt-6 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm font-bold text-slate-500 dark:border-[#444] dark:bg-[#1c1c1c]">
                            No student feedback has been submitted for this contest yet.
                        </div>
                    ) : (
                        <div className="mt-6 space-y-3">
                            {feedbackState.feedback.map((entry) => (
                                <div key={entry.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-[#333] dark:bg-[#1c1c1c]">
                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                        <div>
                                            <p className="font-black text-slate-950 dark:text-white">{entry.studentName}</p>
                                            {entry.email && <p className="mt-0.5 text-sm font-semibold text-slate-500">{entry.email}</p>}
                                        </div>
                                        <div className="flex items-center gap-1 rounded-full bg-amber-50 px-3 py-1.5 text-sm font-black text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                                            <Star className="h-4 w-4" fill="currentColor" />
                                            {entry.rating}/5
                                        </div>
                                    </div>
                                    <p className="mt-4 rounded-xl bg-white px-4 py-3 text-sm font-semibold leading-6 text-slate-700 dark:bg-[#242424] dark:text-[#d4d4d4]">
                                        {entry.comment || "No written feedback provided."}
                                    </p>
                                    <p className="mt-3 text-xs font-semibold text-slate-400">Submitted {formatDateTime(entry.createdAt)}</p>
                                </div>
                            ))}
                        </div>
                    )}
                </section>

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
                                            <div className="px-4 py-4 text-sm font-bold text-slate-500">Type at least 2 characters to search users.</div>
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
