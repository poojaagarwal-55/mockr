"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
    ProfilePreview,
    normalizeJobProfile,
    type JobProfile,
    type ResumeItem,
    type UserProfile as JobProfileUser,
} from "@/components/job-profile/job-profile-builder";

export type ContestStatus = "UPCOMING" | "ACTIVE" | "ENDED" | "CANCELLED";

export type MonitorContest = {
    id: string;
    title: string;
    description: string | null;
    status: ContestStatus;
    startTime: string;
    endTime: string;
    questionCount: number;
    participantCount: number;
    collegeParticipantCount: number;
    leaderboardAvailable: boolean;
};

export type CoordinatorSummary = {
    email: string;
    collegeEmailDomain: string;
    studentCount: number;
};

export type MonitorContestsResponse = {
    coordinator: CoordinatorSummary;
    contests: MonitorContest[];
};

export type QuestionStatus = {
    label: string;
    questionId: string;
    points: number;
    difficulty: "EASY" | "MEDIUM" | "HARD";
    solved: boolean;
};

export type ContestLeaderboardRow = {
    rank: number;
    serialNumber: number;
    contestRank: number;
    userId: string;
    name: string;
    email: string;
    totalScore: number;
    solvedCount: number;
    lastSolvedAt: string | null;
    cheatingCount: number;
    submittedDueToCheating: boolean;
    submissionType?: string | null;
    hasProfile: boolean;
    questions: QuestionStatus[];
};

export type ContestLeaderboardResponse = {
    available: boolean;
    message?: string;
    contest: MonitorContest;
    questions: { label: string; questionId: string; points: number; difficulty: "EASY" | "MEDIUM" | "HARD" }[];
    rows: ContestLeaderboardRow[];
};

export type CompleteLeaderboardRow = {
    rank: number;
    userId: string;
    name: string;
    email: string;
    totalScore: number;
    cheatingCount: number;
    hasProfile: boolean;
    contests: Record<string, { score: number; solved: boolean; participated: boolean; submittedDueToCheating: boolean }>;
};

export type CompleteLeaderboardResponse = {
    coordinator: CoordinatorSummary;
    contests: MonitorContest[];
    rows: CompleteLeaderboardRow[];
};

export type ProfilePayload = {
    exists: boolean;
    user: JobProfileUser;
    profile: Partial<JobProfile> | null;
    resume: ResumeItem | null;
};

export type ProfileModalState = {
    userId: string;
    loading: boolean;
    payload: ProfilePayload | null;
    error: string | null;
};

export const CONTESTS_PAGE_SIZE = 10;
export const LEADERBOARD_PAGE_SIZE = 20;

export function paginate<T>(items: T[], page: number, pageSize: number): T[] {
    const start = (page - 1) * pageSize;
    return items.slice(start, start + pageSize);
}

export function formatDate(value: string) {
    return new Date(value).toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
    });
}

export function calculateDuration(startTime: string, endTime: string) {
    const start = new Date(startTime).getTime();
    const end = new Date(endTime).getTime();
    const minutes = Math.max(0, Math.round((end - start) / 60000));
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    if (hours === 0) return `${remainingMinutes}m`;
    if (remainingMinutes === 0) return `${hours}h`;
    return `${hours}h ${remainingMinutes}m`;
}

export function NotAuthorized() {
    const router = useRouter();
    useEffect(() => {
        const timeout = setTimeout(() => router.replace("/dashboard"), 2500);
        return () => clearTimeout(timeout);
    }, [router]);

    return (
        <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
            <div className="mb-5 grid h-16 w-16 place-items-center rounded-full bg-rose-50 text-rose-500 dark:bg-rose-400/10 dark:text-rose-300">
                <span className="material-symbols-outlined text-[34px]">lock</span>
            </div>
            <h1 className="text-xl font-bold text-slate-950 dark:text-white">Page not found</h1>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Redirecting you back to the dashboard...</p>
        </div>
    );
}

export function StatusBadge({ status }: { status: ContestStatus }) {
    const classes: Record<ContestStatus, string> = {
        ACTIVE: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-300",
        UPCOMING: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-400/30 dark:bg-blue-400/10 dark:text-blue-300",
        ENDED: "border-slate-200 bg-slate-50 text-slate-700 dark:border-lc-border dark:bg-lc-hover dark:text-slate-200",
        CANCELLED: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-300",
    };
    const label = status === "ACTIVE" ? "Live" : status.charAt(0) + status.slice(1).toLowerCase();
    return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${classes[status]}`}>{label}</span>;
}

export function SolvedBadge({ solved }: { solved: boolean }) {
    return (
        <span
            className={`inline-flex min-w-[86px] justify-center rounded-full border px-2.5 py-1 text-xs font-bold ${
                solved
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-300"
                    : "border-slate-200 bg-slate-50 text-slate-500 dark:border-lc-border dark:bg-lc-hover dark:text-slate-300"
            }`}
        >
            {solved ? "Solved" : "Not solved"}
        </span>
    );
}

export function SolvedText({ solved, participated = true }: { solved: boolean; participated?: boolean }) {
    if (!participated) {
        return <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500">Not joined</span>;
    }

    return (
        <span
            className={`inline-flex items-center gap-1 text-[11px] font-extrabold ${
                solved ? "text-emerald-600 dark:text-emerald-300" : "text-slate-500 dark:text-slate-400"
            }`}
        >
            <span className="material-symbols-outlined text-[14px]">{solved ? "check_circle" : "remove_circle"}</span>
            {solved ? "Solved" : "Not solved"}
        </span>
    );
}

export function PaginationControls({
    page,
    totalItems,
    pageSize,
    onPageChange,
}: {
    page: number;
    totalItems: number;
    pageSize: number;
    onPageChange: (page: number) => void;
}) {
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const start = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
    const end = Math.min(totalItems, page * pageSize);
    const visiblePages = Array.from({ length: totalPages }, (_, index) => index + 1).filter((pageNumber) => {
        return pageNumber === 1 || pageNumber === totalPages || Math.abs(pageNumber - page) <= 1;
    });

    return (
        <div className="flex flex-col gap-3 border-t border-slate-200 px-4 py-4 text-sm dark:border-lc-border sm:flex-row sm:items-center sm:justify-between">
            <p className="text-muted-foreground">Showing {start}-{end} of {totalItems}</p>
            <div className="flex flex-wrap items-center gap-2">
                <button
                    type="button"
                    onClick={() => onPageChange(Math.max(1, page - 1))}
                    disabled={page <= 1}
                    className="rounded-md border px-3 py-1.5 font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                >
                    Previous
                </button>
                {visiblePages.map((pageNumber, index) => {
                    const previous = visiblePages[index - 1];
                    return (
                        <span key={pageNumber} className="inline-flex items-center gap-2">
                            {previous && pageNumber - previous > 1 && <span className="text-muted-foreground">...</span>}
                            <button
                                type="button"
                                onClick={() => onPageChange(pageNumber)}
                                className={`h-8 min-w-8 rounded-md border px-2 text-sm font-semibold transition-colors ${
                                    page === pageNumber
                                        ? "border-primary bg-primary text-primary-foreground"
                                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                                }`}
                            >
                                {pageNumber}
                            </button>
                        </span>
                    );
                })}
                <button
                    type="button"
                    onClick={() => onPageChange(Math.min(totalPages, page + 1))}
                    disabled={page >= totalPages}
                    className="rounded-md border px-3 py-1.5 font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                >
                    Next
                </button>
            </div>
        </div>
    );
}

export function ProfileModal({ state, onClose }: { state: ProfileModalState; onClose: () => void }) {
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKey);
        document.body.style.overflow = "hidden";
        return () => {
            window.removeEventListener("keydown", onKey);
            document.body.style.overflow = "unset";
        };
    }, [onClose]);

    const profile = state.payload?.profile ? normalizeJobProfile(state.payload.profile) : null;
    const resumes = state.payload?.resume ? [state.payload.resume] : [];

    return (
        <div className="fixed inset-0 z-[150] bg-slate-950/60 p-4 backdrop-blur-sm">
            <div className="mx-auto flex h-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-2xl dark:border-lc-border dark:bg-lc-bg">
                <div className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4 dark:border-lc-border dark:bg-lc-surface">
                    <div>
                        <p className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Job Profile</p>
                        <h2 className="mt-1 text-lg font-extrabold text-slate-950 dark:text-white">
                            {state.payload?.user.fullName || "Student profile"}
                        </h2>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close profile"
                        title="Close profile"
                        className="grid h-10 w-10 place-items-center rounded-full text-slate-600 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-lc-hover"
                    >
                        <span className="material-symbols-outlined text-[24px]">close</span>
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 sm:p-6">
                    {state.loading ? (
                        <div className="grid min-h-[420px] place-items-center">
                            <div className="flex flex-col items-center gap-4">
                                <div className="h-11 w-11 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
                                <p className="text-sm font-semibold text-slate-500 dark:text-slate-300">Loading profile...</p>
                            </div>
                        </div>
                    ) : state.error ? (
                        <div className="mx-auto mt-20 max-w-md rounded-xl border border-rose-200 bg-rose-50 p-6 text-center text-rose-700 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-200">
                            <span className="material-symbols-outlined text-[34px]">error</span>
                            <h3 className="mt-3 text-lg font-extrabold">Could not load profile</h3>
                            <p className="mt-2 text-sm">{state.error}</p>
                        </div>
                    ) : !state.payload?.exists || !profile ? (
                        <div className="mx-auto mt-20 max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-lc-border dark:bg-lc-surface">
                            <span className="material-symbols-outlined text-[42px] text-slate-400">person_off</span>
                            <h3 className="mt-4 text-xl font-extrabold text-slate-950 dark:text-white">Profile not created</h3>
                            <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-300">
                                This student has not created a job profile yet.
                            </p>
                        </div>
                    ) : (
                        <ProfilePreview user={state.payload.user} profile={profile} resumes={resumes} readonly />
                    )}
                </div>
            </div>
        </div>
    );
}
