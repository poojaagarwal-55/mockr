"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
    Chart as ChartJS,
    ArcElement,
    BarElement,
    CategoryScale,
    LinearScale,
    Tooltip,
    Legend,
} from "chart.js";
import { Bar, Doughnut, Pie } from "react-chartjs-2";
import { useAuth } from "@/context/auth-context";
import { api, ApiError } from "@/lib/api";
import {
    LEADERBOARD_PAGE_SIZE,
    NotAuthorized,
    PaginationControls,
    ProfileModal,
    SolvedText,
    StatusBadge,
    formatDate,
    paginate,
    type ContestLeaderboardResponse,
    type ProfileModalState,
    type ProfilePayload,
} from "../monitor-shared";

ChartJS.register(ArcElement, BarElement, CategoryScale, LinearScale, Tooltip, Legend);

type MonitorTab = "leaderboard" | "analytics";
type IntegrityFilter = "all" | "flagged" | "not_flagged";
type TopLimit = "all" | 10 | 20 | 50 | 100 | 250;

const TOP_LIMIT_OPTIONS = [10, 20, 50, 100, 250] as const;

function percent(value: number, total: number) {
    if (!total || total <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((value / total) * 100)));
}

function formatScore(value: number) {
    if (!Number.isFinite(value)) return "0";
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatDifficulty(difficulty: string) {
    return difficulty.charAt(0).toUpperCase() + difficulty.slice(1).toLowerCase();
}

function difficultyCanvasColors(difficulty: string) {
    if (difficulty === "EASY") return { background: "#dcfce7", text: "#047857" };
    if (difficulty === "HARD") return { background: "#ffe4e6", text: "#be123c" };
    return { background: "#fef3c7", text: "#b45309" };
}

function chartOptions() {
    return {
        maintainAspectRatio: false,
        plugins: {
            tooltip: { enabled: true },
            legend: { display: false },
        },
    };
}

function AverageScoreCard({ averageScore, totalScore }: { averageScore: number; totalScore: number }) {
    const displayTotal = Math.max(totalScore, 0);
    const chartTotal = displayTotal > 0 ? displayTotal : 1;
    const chartScore = Math.max(0, Math.min(averageScore, chartTotal));
    const scorePercent = percent(chartScore, displayTotal);
    const data = {
        labels: ["Average score", "Remaining"],
        datasets: [
            {
                data: displayTotal > 0 ? [chartScore, Math.max(chartTotal - chartScore, 0)] : [0, 1],
                backgroundColor: ["#ef4444", "rgba(148, 163, 184, 0.22)"],
                borderWidth: 0,
                cutout: "80%",
            },
        ],
    };

    return (
        <div className="relative h-full overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-lc-border dark:bg-lc-surface">
            <div className="pointer-events-none absolute left-1/2 top-1/2 size-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-500/20 blur-[90px]" />
            <div className="relative flex items-start justify-between gap-3">
                <div>
                    <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-slate-400">Score</p>
                    <h3 className="mt-2 font-nunito text-xl font-extrabold text-slate-950 dark:text-white">Average score</h3>
                    <p className="mt-1 text-sm font-bold text-slate-500 dark:text-slate-400">{scorePercent}% of total points</p>
                </div>
                <span className="inline-flex rounded-full bg-red-50 px-3 py-1 text-xs font-extrabold text-red-700 dark:bg-red-400/10 dark:text-red-300">
                    {scorePercent}%
                </span>
            </div>
            <div className="relative mt-4 flex h-56 items-center justify-center">
                <div className="relative size-56 shrink-0">
                    <Doughnut data={data} options={chartOptions()} />
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="font-nunito text-3xl font-black leading-none tracking-tight text-red-500">
                            {formatScore(averageScore)}
                        </span>
                        <span className="mt-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">/ {displayTotal}</span>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default function ContestMonitorLeaderboardPage() {
    const params = useParams();
    const contestId = typeof params.contestId === "string" ? params.contestId : "";
    const { user, session, loading: authLoading } = useAuth();
    const token = session?.access_token;

    const [leaderboard, setLeaderboard] = useState<ContestLeaderboardResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [activeTab, setActiveTab] = useState<MonitorTab>("leaderboard");
    const [searchQuery, setSearchQuery] = useState("");
    const [integrityFilter, setIntegrityFilter] = useState<IntegrityFilter>("all");
    const [minSolved, setMinSolved] = useState(0);
    const [topLimit, setTopLimit] = useState<TopLimit>("all");
    const [error, setError] = useState<string | null>(null);
    const [profileModal, setProfileModal] = useState<ProfileModalState | null>(null);

    const loadLeaderboard = useCallback(async () => {
        if (!token || user?.role !== "placement_coordinator" || !contestId) return;
        setLoading(true);
        setError(null);
        try {
            const data = await api.get<ContestLeaderboardResponse>(
                `/monitor/contests/${encodeURIComponent(contestId)}/leaderboard`,
                token
            );
            setLeaderboard(data);
            setPage(1);
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "Failed to load leaderboard");
        } finally {
            setLoading(false);
        }
    }, [contestId, token, user?.role]);

    useEffect(() => {
        void loadLeaderboard();
    }, [loadLeaderboard]);

    const openProfile = async (studentUserId: string) => {
        if (!token) return;
        setProfileModal({ userId: studentUserId, loading: true, payload: null, error: null });
        try {
            const payload = await api.get<ProfilePayload>(`/monitor/users/${studentUserId}/profile`, token);
            setProfileModal({ userId: studentUserId, loading: false, payload, error: null });
        } catch (err) {
            setProfileModal({
                userId: studentUserId,
                loading: false,
                payload: null,
                error: err instanceof ApiError ? err.message : "Failed to load profile",
            });
        }
    };

    const rows = leaderboard?.rows ?? [];
    const questions = leaderboard?.questions ?? [];
    const filteredRows = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();
        const filtered = rows.filter((row) => {
            const isFlagged = row.submittedDueToCheating || row.cheatingCount > 0;
            const solvedCount = row.questions.filter((question) => question.solved).length;
            const matchesSearch = !query || row.name.toLowerCase().includes(query) || row.email.toLowerCase().includes(query);
            const matchesIntegrity =
                integrityFilter === "all" ||
                (integrityFilter === "flagged" && isFlagged) ||
                (integrityFilter === "not_flagged" && !isFlagged);
            return matchesSearch && matchesIntegrity && solvedCount >= minSolved;
        });

        return topLimit === "all" ? filtered : filtered.slice(0, topLimit);
    }, [integrityFilter, minSolved, rows, searchQuery, topLimit]);
    const pagedRows = paginate(filteredRows, page, LEADERBOARD_PAGE_SIZE);
    const tableMinWidth = Math.max(920, 700 + questions.length * 96);
    const analytics = useMemo(() => {
        const totalStudents = rows.length;
        const totalPossibleScore = questions.reduce((sum, question) => sum + (Number(question.points) || 0), 0);
        const averageScore = totalStudents > 0
            ? rows.reduce((sum, row) => sum + (Number(row.totalScore) || 0), 0) / totalStudents
            : 0;
        const flaggedStudents = rows.filter((row) => row.submittedDueToCheating || row.cheatingCount > 0).length;
        const questionSolvedCounts = questions.map((question) => ({
            label: question.label,
            difficulty: question.difficulty,
            solvedCount: rows.filter((row) => row.questions.some((item) => item.questionId === question.questionId && item.solved)).length,
        }));

        return {
            totalStudents,
            totalPossibleScore,
            averageScore,
            flaggedStudents,
            questionSolvedCounts,
        };
    }, [questions, rows]);
    const solvedBarData = useMemo(() => ({
        labels: analytics.questionSolvedCounts.map((question) => question.label),
        datasets: [
            {
                label: "Students solved",
                data: analytics.questionSolvedCounts.map((question) => question.solvedCount),
                backgroundColor: "#3b82f6",
                borderRadius: 8,
                maxBarThickness: 58,
            },
        ],
    }), [analytics.questionSolvedCounts]);
    const solvedBarOptions = useMemo(() => ({
        maintainAspectRatio: false,
        layout: {
            padding: { bottom: 10 },
        },
        plugins: {
            legend: { display: false },
            tooltip: { enabled: true },
        },
        scales: {
            x: {
                grid: { display: false },
                ticks: { color: "#64748b", font: { weight: "bold" as const }, padding: 8 },
                title: {
                    display: true,
                    text: "Questions",
                    color: "#64748b",
                    font: { weight: "bold" as const },
                    padding: { top: 34 },
                },
            },
            y: {
                beginAtZero: true,
                max: Math.max(analytics.totalStudents, 1),
                ticks: { color: "#64748b", precision: 0, stepSize: 1 },
                grid: { color: "rgba(148, 163, 184, 0.18)" },
                title: { display: true, text: "Number of students", color: "#64748b", font: { weight: "bold" as const } },
            },
        },
    }), [analytics.totalStudents]);
    const difficultyAxisPlugin = useMemo(() => ({
        id: `difficulty-axis-tags-${contestId}`,
        afterDraw(chart: any) {
            const xScale = chart.scales?.x;
            const items = analytics.questionSolvedCounts;
            if (!xScale || items.length === 0) return;

            const ctx = chart.ctx;
            ctx.save();
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.font = "700 10px Nunito, sans-serif";

            items.forEach((question, index) => {
                const label = formatDifficulty(question.difficulty);
                const { background, text } = difficultyCanvasColors(question.difficulty);
                const x = xScale.getPixelForTick(index);
                const y = xScale.top + 38;
                const width = Math.max(54, ctx.measureText(label).width + 18);
                const height = 20;
                const radius = 10;
                const left = x - width / 2;
                const top = y - height / 2;
                const right = left + width;
                const bottom = top + height;

                ctx.beginPath();
                ctx.moveTo(left + radius, top);
                ctx.lineTo(right - radius, top);
                ctx.quadraticCurveTo(right, top, right, top + radius);
                ctx.lineTo(right, bottom - radius);
                ctx.quadraticCurveTo(right, bottom, right - radius, bottom);
                ctx.lineTo(left + radius, bottom);
                ctx.quadraticCurveTo(left, bottom, left, bottom - radius);
                ctx.lineTo(left, top + radius);
                ctx.quadraticCurveTo(left, top, left + radius, top);
                ctx.closePath();
                ctx.fillStyle = background;
                ctx.fill();

                ctx.fillStyle = text;
                ctx.fillText(label, x, y + 0.5);
            });

            ctx.restore();
        },
    }), [analytics.questionSolvedCounts, contestId]);
    const flaggedPieData = useMemo(() => {
        const otherStudents = Math.max(analytics.totalStudents - analytics.flaggedStudents, 0);
        const hasStudents = analytics.totalStudents > 0;
        return {
            labels: ["Flagged students", "Other students"],
            datasets: [
                {
                    data: hasStudents ? [analytics.flaggedStudents, otherStudents] : [0, 1],
                    backgroundColor: ["#ef4444", "#10b981"],
                    borderWidth: 0,
                },
            ],
        };
    }, [analytics.flaggedStudents, analytics.totalStudents]);

    useEffect(() => {
        setPage(1);
    }, [activeTab, integrityFilter, minSolved, searchQuery, topLimit]);

    if (authLoading) {
        return (
            <div className="grid min-h-[60vh] place-items-center">
                <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
            </div>
        );
    }

    if (user?.role !== "placement_coordinator") return <NotAuthorized />;

    return (
        <main className="min-h-screen bg-[#FAFBFC] px-4 py-6 text-slate-950 dark:bg-lc-bg dark:text-white sm:px-6 lg:px-8">
            <div className="mx-auto max-w-7xl">
                <section className="border-b border-slate-200 pb-6 dark:border-lc-border">
                    <Link
                        href="/monitor"
                        className="mb-4 inline-flex items-center gap-2 text-sm font-extrabold text-slate-500 transition hover:text-slate-950 dark:text-slate-400 dark:hover:text-white"
                    >
                        <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                        Back to Monitor
                    </Link>
                    <div className="mb-3 flex flex-wrap items-center gap-3 text-sm font-semibold text-slate-500 dark:text-slate-400">
                        {leaderboard?.contest && <StatusBadge status={leaderboard.contest.status} />}
                        {leaderboard?.contest?.startTime && <span>{formatDate(leaderboard.contest.startTime)}</span>}
                    </div>
                    <h1 className="font-nunito text-3xl font-extrabold tracking-normal sm:text-4xl">
                        {leaderboard?.contest.title || "Contest Leaderboard"}
                    </h1>
                    <p className="mt-2 text-sm font-semibold text-slate-500 dark:text-slate-400">
                        College-only ranking for this contest.
                    </p>
                </section>

                <nav className="flex gap-2 overflow-x-auto border-b border-slate-200 py-4 dark:border-lc-border">
                    <Link
                        href="/monitor"
                        className="inline-flex h-9 items-center rounded-full px-4 text-sm font-extrabold text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-lc-hover dark:hover:text-white"
                    >
                        Contests
                    </Link>
                    <button
                        type="button"
                        onClick={() => setActiveTab("leaderboard")}
                        className={`inline-flex h-9 items-center rounded-full px-4 text-sm font-extrabold transition ${
                            activeTab === "leaderboard"
                                ? "bg-slate-950 text-white dark:bg-white dark:text-slate-950"
                                : "text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-lc-hover dark:hover:text-white"
                        }`}
                    >
                        Leaderboard
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveTab("analytics")}
                        className={`inline-flex h-9 items-center rounded-full px-4 text-sm font-extrabold transition ${
                            activeTab === "analytics"
                                ? "bg-slate-950 text-white dark:bg-white dark:text-slate-950"
                                : "text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-lc-hover dark:hover:text-white"
                        }`}
                    >
                        View Analytics
                    </button>
                </nav>

                {error && (
                    <div className="mt-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-200">
                        {error}
                    </div>
                )}

                {loading ? (
                    <div className="grid min-h-[360px] place-items-center">
                        <div className="text-center">
                            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
                            <p className="mt-4 text-sm font-semibold text-slate-500 dark:text-slate-400">Loading leaderboard...</p>
                        </div>
                    </div>
                ) : leaderboard && !leaderboard.available ? (
                    <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-800 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200">
                        <div className="flex items-start gap-3">
                            <span className="material-symbols-outlined text-[28px]">schedule</span>
                            <div>
                                <h2 className="font-nunito text-xl font-extrabold">Leaderboard Not Available</h2>
                                <p className="mt-2 text-sm font-semibold leading-6">
                                    {leaderboard.message || "Leaderboard will be available soon after the contest."}
                                </p>
                            </div>
                        </div>
                    </div>
                ) : leaderboard && activeTab === "leaderboard" ? (
                    <section className="py-6">
                        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <h2 className="font-nunito text-2xl font-extrabold">Leaderboard</h2>
                                <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">
                                    Rows highlighted in red were auto-submitted by the integrity monitor.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => void loadLeaderboard()}
                                className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-slate-200 px-4 text-sm font-extrabold text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 dark:border-lc-border dark:text-slate-300 dark:hover:bg-lc-hover dark:hover:text-white"
                            >
                                <span className="material-symbols-outlined text-[18px]">refresh</span>
                                Refresh
                            </button>
                        </div>

                        <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-lc-border dark:bg-lc-surface lg:flex-row lg:items-center">
                            <div className="flex shrink-0 flex-wrap items-center gap-3">
                                <div className="group/menu relative">
                                    <button
                                        type="button"
                                        className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-extrabold text-slate-700 transition hover:bg-slate-50 dark:border-lc-border dark:text-slate-200 dark:hover:bg-lc-hover"
                                    >
                                        <span className="material-symbols-outlined text-[18px]">filter_alt</span>
                                        Filters
                                        <span className="material-symbols-outlined text-[18px]">expand_more</span>
                                    </button>
                                    <div className="invisible absolute left-0 top-full z-30 mt-2 w-64 rounded-2xl border border-slate-200 bg-white p-2 opacity-0 shadow-xl transition group-hover/menu:visible group-hover/menu:opacity-100 group-focus-within/menu:visible group-focus-within/menu:opacity-100 dark:border-lc-border dark:bg-lc-surface">
                                        <div className="group/integrity relative">
                                            <button
                                                type="button"
                                                className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-bold text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-lc-hover"
                                            >
                                                Flag status
                                                <span className="material-symbols-outlined text-[18px]">chevron_right</span>
                                            </button>
                                            <div className="invisible absolute left-full top-0 ml-2 w-48 rounded-2xl border border-slate-200 bg-white p-2 opacity-0 shadow-xl transition group-hover/integrity:visible group-hover/integrity:opacity-100 group-focus-within/integrity:visible group-focus-within/integrity:opacity-100 dark:border-lc-border dark:bg-lc-surface">
                                                {[
                                                    ["all", "All students"],
                                                    ["flagged", "Flagged"],
                                                    ["not_flagged", "Not flagged"],
                                                ].map(([value, label]) => (
                                                    <button
                                                        key={value}
                                                        type="button"
                                                        onClick={() => setIntegrityFilter(value as IntegrityFilter)}
                                                        className={`block w-full rounded-xl px-3 py-2 text-left text-sm font-bold transition ${
                                                            integrityFilter === value
                                                                ? "bg-primary text-white"
                                                                : "text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-lc-hover"
                                                        }`}
                                                    >
                                                        {label}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        <div className="group/solved relative">
                                            <button
                                                type="button"
                                                className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-bold text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-lc-hover"
                                            >
                                                Minimum questions solved
                                                <span className="material-symbols-outlined text-[18px]">chevron_right</span>
                                            </button>
                                            <div className="invisible absolute left-full top-0 ml-2 max-h-72 w-52 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 opacity-0 shadow-xl transition group-hover/solved:visible group-hover/solved:opacity-100 group-focus-within/solved:visible group-focus-within/solved:opacity-100 dark:border-lc-border dark:bg-lc-surface">
                                                {[0, ...questions.map((_, index) => index + 1)].map((count) => (
                                                    <button
                                                        key={count}
                                                        type="button"
                                                        onClick={() => setMinSolved(count)}
                                                        className={`block w-full rounded-xl px-3 py-2 text-left text-sm font-bold transition ${
                                                            minSolved === count
                                                                ? "bg-primary text-white"
                                                                : "text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-lc-hover"
                                                        }`}
                                                    >
                                                        {count === 0 ? "Any solved count" : `At least ${count}`}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        <button
                                            type="button"
                                            onClick={() => {
                                                setSearchQuery("");
                                                setIntegrityFilter("all");
                                                setMinSolved(0);
                                                setTopLimit("all");
                                            }}
                                            className="mt-2 flex w-full items-center justify-center rounded-xl border border-slate-200 px-3 py-2 text-sm font-extrabold text-slate-600 transition hover:bg-slate-50 dark:border-lc-border dark:text-slate-300 dark:hover:bg-lc-hover"
                                        >
                                            Clear filters
                                        </button>
                                    </div>
                                </div>

                                <label className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-extrabold text-slate-700 dark:border-lc-border dark:text-slate-200">
                                    Top
                                    <select
                                        value={String(topLimit)}
                                        onChange={(event) => {
                                            const value = event.target.value;
                                            setTopLimit(value === "all" ? "all" : (Number(value) as TopLimit));
                                        }}
                                        className="bg-transparent text-sm font-extrabold outline-none"
                                    >
                                        <option value="all">All</option>
                                        {TOP_LIMIT_OPTIONS.map((limit) => (
                                            <option key={limit} value={limit}>
                                                {limit}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                            </div>

                            <label className="relative min-w-0 flex-1">
                                <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[20px] text-slate-400">
                                    search
                                </span>
                                <input
                                    type="search"
                                    value={searchQuery}
                                    onChange={(event) => setSearchQuery(event.target.value)}
                                    placeholder="Search student by name or email"
                                    className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-primary focus:bg-white dark:border-lc-border dark:bg-lc-hover/40 dark:text-white dark:focus:bg-lc-bg"
                                />
                            </label>
                        </div>

                        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-lc-border dark:bg-lc-surface">
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm" style={{ minWidth: tableMinWidth }}>
                                    <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-lc-hover/40 dark:text-slate-400">
                                        <tr>
                                            <th className="w-16 px-4 py-3 text-left font-extrabold">S No</th>
                                            <th className="w-20 px-4 py-3 text-left font-extrabold">Rank</th>
                                            <th className="w-[260px] px-4 py-3 text-left font-extrabold">Student</th>
                                            <th className="w-28 px-4 py-3 text-left font-extrabold">Total Score</th>
                                            {questions.map((question) => (
                                                <th key={question.questionId} className="w-24 px-4 py-3 text-left font-extrabold">
                                                    {question.label}
                                                </th>
                                            ))}
                                            <th className="w-28 px-4 py-3 text-right font-extrabold">Profile</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-lc-border/70">
                                        {filteredRows.length === 0 ? (
                                            <tr>
                                                <td colSpan={5 + questions.length} className="px-5 py-12 text-center text-sm font-semibold text-slate-500 dark:text-slate-400">
                                                    {rows.length === 0
                                                        ? "No college students are registered in this contest."
                                                        : "No students match the selected filters."}
                                                </td>
                                            </tr>
                                        ) : (
                                            pagedRows.map((row, index) => {
                                                const submittedDueToCheating = row.submittedDueToCheating || row.cheatingCount > 0;
                                                return (
                                                    <tr
                                                        key={row.userId}
                                                        className={`transition ${
                                                            submittedDueToCheating
                                                                ? "bg-red-50/80 hover:bg-red-50 dark:bg-red-500/10 dark:hover:bg-red-500/15"
                                                                : "hover:bg-slate-50/80 dark:hover:bg-lc-hover/60"
                                                        }`}
                                                    >
                                                        <td className="px-4 py-4 font-extrabold text-slate-700 dark:text-slate-200">
                                                            {(page - 1) * LEADERBOARD_PAGE_SIZE + index + 1}
                                                        </td>
                                                        <td className="px-4 py-4 font-extrabold text-primary">#{row.contestRank ?? row.rank}</td>
                                                        <td className="px-4 py-4">
                                                            <p className="truncate font-extrabold text-slate-950 dark:text-white">{row.name}</p>
                                                            <p className="mt-1 truncate text-xs font-semibold text-slate-500 dark:text-slate-400">{row.email}</p>
                                                        </td>
                                                        <td className="px-4 py-4 text-base font-extrabold text-slate-950 dark:text-white">{row.totalScore}</td>
                                                        {row.questions.map((question) => (
                                                            <td key={question.questionId} className="px-4 py-4">
                                                                <SolvedText solved={question.solved} />
                                                            </td>
                                                        ))}
                                                        <td className="px-4 py-4 text-right">
                                                            <button
                                                                type="button"
                                                                onClick={() => void openProfile(row.userId)}
                                                                className="inline-flex h-9 items-center gap-2 rounded-full border border-slate-200 px-3 text-xs font-extrabold text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 dark:border-lc-border dark:text-slate-300 dark:hover:bg-lc-hover dark:hover:text-white"
                                                            >
                                                                <span className="material-symbols-outlined text-[16px]">badge</span>
                                                                View
                                                            </button>
                                                        </td>
                                                    </tr>
                                                );
                                            })
                                        )}
                                    </tbody>
                                </table>
                            </div>
                            <PaginationControls page={page} totalItems={filteredRows.length} pageSize={LEADERBOARD_PAGE_SIZE} onPageChange={setPage} />
                        </div>
                    </section>
                ) : leaderboard && activeTab === "analytics" ? (
                    <section className="py-6">
                        <div className="mb-5">
                            <h2 className="font-nunito text-2xl font-extrabold">Analytics</h2>
                            <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">
                                Question performance, integrity summary, and average score for this contest.
                            </p>
                        </div>

                        <div className="grid gap-5 lg:grid-cols-[1.08fr_0.92fr]">
                            <AverageScoreCard averageScore={analytics.averageScore} totalScore={analytics.totalPossibleScore} />

                            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-lc-border dark:bg-lc-surface">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-slate-400">Integrity</p>
                                        <h3 className="mt-2 font-nunito text-xl font-extrabold text-slate-950 dark:text-white">Flagged students</h3>
                                        <p className="mt-1 text-sm font-bold text-slate-500 dark:text-slate-400">
                                            {analytics.flaggedStudents} flagged student{analytics.flaggedStudents === 1 ? "" : "s"} out of {analytics.totalStudents} student{analytics.totalStudents === 1 ? "" : "s"}
                                        </p>
                                    </div>
                                    <span className="inline-flex rounded-full bg-red-50 px-3 py-1 text-xs font-extrabold text-red-700 dark:bg-red-400/10 dark:text-red-300">
                                        {percent(analytics.flaggedStudents, analytics.totalStudents)}%
                                    </span>
                                </div>
                                <div className="mt-4 h-56">
                                    <Pie data={flaggedPieData} options={chartOptions()} />
                                </div>
                                <div className="mt-4 flex flex-wrap gap-3 text-xs font-bold text-slate-500 dark:text-slate-400">
                                    <span className="inline-flex items-center gap-2">
                                        <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
                                        Flagged students
                                    </span>
                                    <span className="inline-flex items-center gap-2">
                                        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                                        Other students
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-lc-border dark:bg-lc-surface">
                            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                                <div>
                                    <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-slate-400">Question Analytics</p>
                                    <h3 className="mt-2 font-nunito text-xl font-extrabold text-slate-950 dark:text-white">Students solved per question</h3>
                                </div>
                                <p className="text-sm font-bold text-slate-500 dark:text-slate-400">
                                    {analytics.totalStudents} total student{analytics.totalStudents === 1 ? "" : "s"}
                                </p>
                            </div>
                            <div className="h-80">
                                <Bar data={solvedBarData} options={solvedBarOptions} plugins={[difficultyAxisPlugin]} />
                            </div>
                        </div>
                    </section>
                ) : null}

                {profileModal && <ProfileModal state={profileModal} onClose={() => setProfileModal(null)} />}
            </div>
        </main>
    );
}
