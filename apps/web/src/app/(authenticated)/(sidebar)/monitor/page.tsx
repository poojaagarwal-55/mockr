"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import { api, ApiError } from "@/lib/api";
import {
    CONTESTS_PAGE_SIZE,
    NotAuthorized,
    PaginationControls,
    StatusBadge,
    calculateDuration,
    formatDate,
    paginate,
    type CoordinatorSummary,
    type MonitorContest,
    type MonitorContestsResponse,
} from "./monitor-shared";

export default function MonitorPage() {
    const router = useRouter();
    const { user, session, loading: authLoading } = useAuth();
    const token = session?.access_token;

    const [coordinator, setCoordinator] = useState<CoordinatorSummary | null>(null);
    const [contests, setContests] = useState<MonitorContest[]>([]);
    const [loadingContests, setLoadingContests] = useState(true);
    const [contestPage, setContestPage] = useState(1);
    const [error, setError] = useState<string | null>(null);

    const loadContests = useCallback(async () => {
        if (!token || user?.role !== "placement_coordinator") return;
        setLoadingContests(true);
        setError(null);
        try {
            const data = await api.get<MonitorContestsResponse>("/monitor/contests", token);
            setCoordinator(data.coordinator);
            setContests(data.contests);
            setContestPage(1);
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "Failed to load contests");
        } finally {
            setLoadingContests(false);
        }
    }, [token, user?.role]);

    useEffect(() => {
        void loadContests();
    }, [loadContests]);

    if (authLoading) {
        return (
            <div className="grid min-h-[60vh] place-items-center">
                <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
            </div>
        );
    }

    if (user?.role !== "placement_coordinator") return <NotAuthorized />;

    const pagedContests = paginate(contests, contestPage, CONTESTS_PAGE_SIZE);
    const collegeDomain = coordinator?.collegeEmailDomain || user.placementCollegeEmailDomain;
    const studentCount = coordinator?.studentCount ?? 0;

    return (
        <main className="min-h-screen bg-[#FAFBFC] px-4 py-6 text-slate-950 dark:bg-lc-bg dark:text-white sm:px-6 lg:px-8">
            <div className="mx-auto max-w-7xl">
                <section className="border-b border-slate-200 pb-6 dark:border-lc-border">
                    <h1 className="font-nunito text-3xl font-extrabold tracking-normal sm:text-4xl">Monitor</h1>
                    <p className="mt-2 text-sm font-semibold text-slate-500 dark:text-slate-400">
                        Track contest leaderboards for {studentCount} students from {collegeDomain}.
                    </p>
                </section>

                <nav className="flex gap-2 overflow-x-auto border-b border-slate-200 py-4 dark:border-lc-border">
                    <Link
                        href="/monitor"
                        className="inline-flex h-9 items-center rounded-full bg-primary px-4 text-sm font-extrabold text-white shadow-lg shadow-primary/20"
                    >
                        Contests
                    </Link>
                    <Link
                        href="/monitor/complete"
                        className="inline-flex h-9 items-center rounded-full px-4 text-sm font-extrabold text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-lc-hover dark:hover:text-white"
                    >
                        Complete Leaderboard
                    </Link>
                </nav>

                {error && (
                    <div className="mt-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-200">
                        {error}
                    </div>
                )}

                <section className="py-6">
                    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <h2 className="font-nunito text-2xl font-extrabold">Contest Monitor</h2>
                            <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">
                                Open a contest to view the college-only leaderboard.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => void loadContests()}
                            className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-slate-200 px-4 text-sm font-extrabold text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 dark:border-lc-border dark:text-slate-300 dark:hover:bg-lc-hover dark:hover:text-white"
                        >
                            <span className="material-symbols-outlined text-[18px]">refresh</span>
                            Refresh
                        </button>
                    </div>

                    {loadingContests ? (
                        <div className="grid min-h-[360px] place-items-center">
                            <div className="text-center">
                                <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
                                <p className="mt-4 text-sm font-semibold text-slate-500 dark:text-slate-400">Loading contests...</p>
                            </div>
                        </div>
                    ) : contests.length === 0 ? (
                        <div className="grid min-h-[300px] place-items-center text-center">
                            <div>
                                <span className="material-symbols-outlined text-[42px] text-slate-300 dark:text-slate-600">trophy</span>
                                <p className="mt-4 text-sm font-semibold text-slate-500 dark:text-slate-400">No contests found.</p>
                            </div>
                        </div>
                    ) : (
                        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-lc-border dark:bg-lc-surface">
                            <div className="divide-y divide-slate-100 dark:divide-lc-border/70">
                                {pagedContests.map((contest) => (
                                    <article
                                        key={contest.id}
                                        className="grid gap-4 px-4 py-5 transition hover:bg-slate-50/80 dark:hover:bg-lc-hover/60 sm:px-6 xl:grid-cols-[minmax(260px,1fr)_190px_150px_120px_120px_110px] xl:items-center"
                                    >
                                        <button
                                            type="button"
                                            onClick={() => router.push(`/monitor/${contest.id}`)}
                                            className="min-w-0 text-left"
                                        >
                                            <h3 className="truncate font-nunito text-xl font-extrabold text-primary">{contest.title}</h3>
                                            {contest.description && (
                                                <p className="mt-1 line-clamp-2 text-sm font-semibold text-slate-500 dark:text-slate-400">
                                                    {contest.description}
                                                </p>
                                            )}
                                        </button>

                                        <div className="min-w-0 text-sm">
                                            <p className="text-xs font-extrabold uppercase text-slate-400">Participants</p>
                                            <p className="mt-1 truncate font-semibold text-slate-700 dark:text-slate-200">
                                                {contest.collegeParticipantCount} of {contest.participantCount}
                                            </p>
                                        </div>
                                        <div className="min-w-0 text-sm">
                                            <p className="text-xs font-extrabold uppercase text-slate-400">Start</p>
                                            <p className="mt-1 truncate font-semibold text-slate-700 dark:text-slate-200">{formatDate(contest.startTime)}</p>
                                        </div>
                                        <div className="min-w-0 text-sm">
                                            <p className="text-xs font-extrabold uppercase text-slate-400">Length</p>
                                            <p className="mt-1 font-semibold text-slate-700 dark:text-slate-200">
                                                {calculateDuration(contest.startTime, contest.endTime)}
                                            </p>
                                        </div>
                                        <div className="min-w-0 text-sm">
                                            <p className="text-xs font-extrabold uppercase text-slate-400">Questions</p>
                                            <p className="mt-1 font-semibold text-slate-700 dark:text-slate-200">{contest.questionCount}</p>
                                        </div>
                                        <div className="flex min-w-0 items-center justify-between gap-3 xl:justify-end">
                                            <StatusBadge status={contest.status} />
                                            <button
                                                type="button"
                                                onClick={() => router.push(`/monitor/${contest.id}`)}
                                                className="inline-flex h-9 items-center rounded-full border border-slate-200 px-3 text-xs font-extrabold text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 dark:border-lc-border dark:text-slate-300 dark:hover:bg-lc-hover dark:hover:text-white"
                                            >
                                                View
                                            </button>
                                        </div>
                                    </article>
                                ))}
                            </div>
                            <PaginationControls
                                page={contestPage}
                                totalItems={contests.length}
                                pageSize={CONTESTS_PAGE_SIZE}
                                onPageChange={setContestPage}
                            />
                        </div>
                    )}
                </section>
            </div>
        </main>
    );
}
