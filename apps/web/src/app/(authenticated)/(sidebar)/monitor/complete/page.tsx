"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/auth-context";
import { api, ApiError } from "@/lib/api";
import {
    LEADERBOARD_PAGE_SIZE,
    NotAuthorized,
    PaginationControls,
    ProfileModal,
    paginate,
    type CompleteLeaderboardResponse,
    type ProfileModalState,
    type ProfilePayload,
} from "../monitor-shared";

type TopLimit = "all" | 10 | 20 | 50 | 100 | 250;

const TOP_LIMIT_OPTIONS = [10, 20, 50, 100, 250] as const;

export default function CompleteMonitorLeaderboardPage() {
    const { user, session, loading: authLoading } = useAuth();
    const token = session?.access_token;

    const [leaderboard, setLeaderboard] = useState<CompleteLeaderboardResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [searchQuery, setSearchQuery] = useState("");
    const [minParticipated, setMinParticipated] = useState(0);
    const [minSolved, setMinSolved] = useState(0);
    const [topLimit, setTopLimit] = useState<TopLimit>("all");
    const [error, setError] = useState<string | null>(null);
    const [profileModal, setProfileModal] = useState<ProfileModalState | null>(null);

    const loadLeaderboard = useCallback(async () => {
        if (!token || user?.role !== "placement_coordinator") return;
        setLoading(true);
        setError(null);
        try {
            const data = await api.get<CompleteLeaderboardResponse>("/monitor/complete-leaderboard", token);
            setLeaderboard(data);
            setPage(1);
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "Failed to load complete leaderboard");
        } finally {
            setLoading(false);
        }
    }, [token, user?.role]);

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
    const contests = leaderboard?.contests ?? [];
    const filteredRows = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();
        const filtered = rows.filter((row) => {
            const contestValues = Object.values(row.contests);
            const participatedCount = contestValues.filter((cell) => cell.participated).length;
            const solvedCount = contestValues.filter((cell) => cell.solved).length;
            const matchesSearch = !query || row.name.toLowerCase().includes(query) || row.email.toLowerCase().includes(query);
            return matchesSearch && participatedCount >= minParticipated && solvedCount >= minSolved;
        });

        return topLimit === "all" ? filtered : filtered.slice(0, topLimit);
    }, [minParticipated, minSolved, rows, searchQuery, topLimit]);
    const pagedRows = paginate(filteredRows, page, LEADERBOARD_PAGE_SIZE);
    const tableMinWidth = Math.max(1040, 700 + contests.length * 132);
    const collegeDomain = leaderboard?.coordinator.collegeEmailDomain || user?.placementCollegeEmailDomain || "";
    const studentCount = leaderboard?.coordinator.studentCount ?? 0;
    useEffect(() => {
        setPage(1);
    }, [minParticipated, minSolved, searchQuery, topLimit]);

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
                    <h1 className="font-nunito text-3xl font-extrabold tracking-normal sm:text-4xl">Complete Leaderboard</h1>
                    <p className="mt-2 text-sm font-semibold text-slate-500 dark:text-slate-400">
                        Completed contest scores for {studentCount} students from {collegeDomain}.
                    </p>
                </section>

                <nav className="flex gap-2 overflow-x-auto border-b border-slate-200 py-4 dark:border-lc-border">
                    <Link
                        href="/monitor"
                        className="inline-flex h-9 items-center rounded-full px-4 text-sm font-extrabold text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-lc-hover dark:hover:text-white"
                    >
                        Contests
                    </Link>
                    <Link
                        href="/monitor/complete"
                        className="inline-flex h-9 items-center rounded-full bg-primary px-4 text-sm font-extrabold text-white shadow-lg shadow-primary/20"
                    >
                        Complete Leaderboard
                    </Link>
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
                            <p className="mt-4 text-sm font-semibold text-slate-500 dark:text-slate-400">Loading complete leaderboard...</p>
                        </div>
                    </div>
                ) : leaderboard ? (
                    <section className="py-6">
                        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <h2 className="font-nunito text-2xl font-extrabold">All Completed Contests</h2>
                                <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">
                                    Active contests appear here only after their leaderboard is ready.
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

                        <div className="relative z-50 mb-4 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-lc-border dark:bg-lc-surface lg:flex-row lg:items-center">
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
                                    <div className="invisible absolute left-0 top-full z-[80] mt-2 w-72 rounded-2xl border border-slate-200 bg-white p-2 opacity-0 shadow-xl transition group-hover/menu:visible group-hover/menu:opacity-100 group-focus-within/menu:visible group-focus-within/menu:opacity-100 dark:border-lc-border dark:bg-lc-surface">
                                        <div className="group/participated relative">
                                            <button
                                                type="button"
                                                className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-bold text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-lc-hover"
                                            >
                                                Minimum contests participated
                                                <span className="material-symbols-outlined text-[18px]">chevron_right</span>
                                            </button>
                                            <div className="invisible absolute left-full top-0 z-[90] ml-2 max-h-72 w-52 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 opacity-0 shadow-xl transition group-hover/participated:visible group-hover/participated:opacity-100 group-focus-within/participated:visible group-focus-within/participated:opacity-100 dark:border-lc-border dark:bg-lc-surface">
                                                {[0, ...contests.map((_, index) => index + 1)].map((count) => (
                                                    <button
                                                        key={count}
                                                        type="button"
                                                        onClick={() => setMinParticipated(count)}
                                                        className={`block w-full rounded-xl px-3 py-2 text-left text-sm font-bold transition ${
                                                            minParticipated === count
                                                                ? "bg-primary text-white"
                                                                : "text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-lc-hover"
                                                        }`}
                                                    >
                                                        {count === 0 ? "Any participation" : `At least ${count}`}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        <div className="group/solved relative">
                                            <button
                                                type="button"
                                                className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-bold text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-lc-hover"
                                            >
                                                Minimum contests solved
                                                <span className="material-symbols-outlined text-[18px]">chevron_right</span>
                                            </button>
                                            <div className="invisible absolute left-full top-0 z-[90] ml-2 max-h-72 w-52 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 opacity-0 shadow-xl transition group-hover/solved:visible group-hover/solved:opacity-100 group-focus-within/solved:visible group-focus-within/solved:opacity-100 dark:border-lc-border dark:bg-lc-surface">
                                                {[0, ...contests.map((_, index) => index + 1)].map((count) => (
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
                                                setMinParticipated(0);
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
                                <table className="w-full border-separate border-spacing-0 text-sm" style={{ minWidth: tableMinWidth }}>
                                    <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-lc-hover/40 dark:text-slate-400">
                                        <tr>
                                            <th
                                                className="sticky z-30 bg-slate-50 px-4 py-3 text-left font-extrabold dark:bg-[#232323]"
                                                style={{ left: 0, width: 72, minWidth: 72 }}
                                            >
                                                S No
                                            </th>
                                            <th
                                                className="sticky z-30 bg-slate-50 px-4 py-3 text-left font-extrabold dark:bg-[#232323]"
                                                style={{ left: 72, width: 290, minWidth: 290 }}
                                            >
                                                Student
                                            </th>
                                            <th
                                                className="sticky z-30 bg-slate-50 px-4 py-3 text-left font-extrabold dark:bg-[#232323]"
                                                style={{ left: 362, width: 128, minWidth: 128 }}
                                            >
                                                Total Score
                                            </th>
                                            <th
                                                className="sticky z-30 bg-slate-50 px-4 py-3 text-left font-extrabold shadow-[10px_0_14px_-14px_rgba(15,23,42,0.75)] dark:bg-[#232323]"
                                                style={{ left: 490, width: 88, minWidth: 88 }}
                                            >
                                                Flags
                                            </th>
                                            {contests.map((contest) => (
                                                <th key={contest.id} className="px-4 py-3 text-left font-extrabold" title={contest.title}>
                                                    <span className="block max-w-[128px] truncate normal-case text-sm text-slate-950 dark:text-white">
                                                        {contest.title}
                                                    </span>
                                                </th>
                                            ))}
                                            <th className="w-28 px-4 py-3 text-right font-extrabold">Profile</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-lc-border/70">
                                        {filteredRows.length === 0 ? (
                                            <tr>
                                                <td colSpan={5 + contests.length} className="px-5 py-12 text-center text-sm font-semibold text-slate-500 dark:text-slate-400">
                                                    {rows.length === 0
                                                        ? "No completed contest leaderboard data is available for this college yet."
                                                        : "No students match the selected filters."}
                                                </td>
                                            </tr>
                                        ) : (
                                            pagedRows.map((row, index) => {
                                                return (
                                                    <tr
                                                        key={row.userId}
                                                        className="group transition hover:bg-slate-50/80 dark:hover:bg-lc-hover/60"
                                                    >
                                                        <td
                                                            className="sticky z-20 bg-white px-4 py-4 font-extrabold text-slate-700 group-hover:bg-slate-50 dark:bg-lc-surface dark:text-slate-200 dark:group-hover:bg-lc-hover"
                                                            style={{ left: 0, width: 72, minWidth: 72 }}
                                                        >
                                                            {(page - 1) * LEADERBOARD_PAGE_SIZE + index + 1}
                                                        </td>
                                                        <td
                                                            className="sticky z-20 bg-white px-4 py-4 group-hover:bg-slate-50 dark:bg-lc-surface dark:group-hover:bg-lc-hover"
                                                            style={{ left: 72, width: 290, minWidth: 290 }}
                                                        >
                                                            <p className="truncate font-extrabold text-slate-950 dark:text-white">{row.name}</p>
                                                            <p className="mt-1 truncate text-xs font-semibold text-slate-500 dark:text-slate-400">{row.email}</p>
                                                        </td>
                                                        <td
                                                            className="sticky z-20 bg-white px-4 py-4 text-base font-extrabold text-slate-950 group-hover:bg-slate-50 dark:bg-lc-surface dark:text-white dark:group-hover:bg-lc-hover"
                                                            style={{ left: 362, width: 128, minWidth: 128 }}
                                                        >
                                                            {row.totalScore}
                                                        </td>
                                                        <td
                                                            className="sticky z-20 bg-white px-4 py-4 font-extrabold text-slate-600 shadow-[10px_0_14px_-14px_rgba(15,23,42,0.75)] group-hover:bg-slate-50 dark:bg-lc-surface dark:text-slate-300 dark:group-hover:bg-lc-hover"
                                                            style={{ left: 490, width: 88, minWidth: 88 }}
                                                        >
                                                            {row.cheatingCount}
                                                        </td>
                                                        {contests.map((contest) => {
                                                            const cell = row.contests[contest.id] || {
                                                                score: 0,
                                                                solved: false,
                                                                participated: false,
                                                                submittedDueToCheating: false,
                                                            };
                                                            return (
                                                                <td key={contest.id} className="px-4 py-4 align-top">
                                                                    <span className="font-extrabold text-slate-950 dark:text-white">
                                                                        {cell.participated ? cell.score : "-"}
                                                                    </span>
                                                                </td>
                                                            );
                                                        })}
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
                ) : null}

                {profileModal && <ProfileModal state={profileModal} onClose={() => setProfileModal(null)} />}
            </div>
        </main>
    );
}
