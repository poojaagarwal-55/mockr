"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/context/auth-context";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { ProctoredOnlineAssessmentFlow } from "./proctored-online-assessment";

type TechnicalAssignment = {
    id: string;
    title: string;
    timeLimit?: string | null;
    estimatedHours?: string | null;
    deadlinePolicy?: string | null;
    overview?: string | null;
    scenario?: string | null;
    tasks?: string[];
    starterContext?: string | null;
    constraints?: string[];
    allowedStack?: string[];
    deliverables?: string[];
    submissionInstructions?: string | null;
    thinkingQuestions?: string[];
    candidateMessage?: string | null;
    closesAt?: string | null;
    submitted?: boolean;
    submission?: {
        id: string;
        repoUrl: string;
        status: string;
        submittedAt: string;
    } | null;
};

type OnlineAssessment = {
    id: string;
    roundId: string;
    jobId: string;
    title: string;
    startAt?: string | null;
    endAt?: string | null;
    durationMinutes?: number | null;
    questionCount?: number | null;
    instructions?: string | null;
    candidateMessage?: string | null;
    requireSecureBrowser?: boolean;
    questions?: Array<{
        id: string;
        questionId?: string;
        text: string;
        type?: string | null;
        difficulty?: string | null;
        timeLimitMinutes?: number | null;
        aiInterviewEnabled?: boolean;
        orderIndex?: number;
    }>;
};

type AiInterviewRound = {
    id: string;
    roundId: string;
    jobId: string;
    title: string;
    startAt?: string | null;
    endAt?: string | null;
    durationMinutes?: number | null;
    questionCount?: number | null;
    rubricCount?: number | null;
    candidateInstructions?: string | null;
    candidateMessage?: string | null;
    requireCamera?: boolean;
    requireMicrophone?: boolean;
};

type ScheduledRound = {
    id: string;
    roundId: string;
    applicationId: string;
    status: string;
    roundType: string;
    roundLabel: string;
    roundIcon: string;
    movedAt?: string | null;
    configured: boolean;
    state: "ready" | "pending_setup" | "submitted" | "closed";
    job: {
        id: string;
        title: string;
        companyName: string;
        companyLogoUrl?: string | null;
        location?: string | null;
        workMode?: string | null;
        employmentType?: string | null;
    };
    technicalAssignment?: TechnicalAssignment | null;
    onlineAssessment?: OnlineAssessment | null;
    aiInterview?: AiInterviewRound | null;
};

type ScheduledResponse = {
    scheduled: ScheduledRound[];
};

type GitHubRepo = {
    id: string;
    nodeId?: string | null;
    name: string;
    fullName: string;
    htmlUrl?: string | null;
    description?: string | null;
    fork: boolean;
    private: boolean;
    language?: string | null;
    defaultBranch?: string | null;
    updatedAt?: string | null;
    pushedAt?: string | null;
    stars?: number;
};

function isGitHubReconnectError(error: unknown) {
    if (!(error instanceof ApiError)) return false;
    const body = error.body as { error?: string; message?: string } | undefined;
    return error.status === 409 && (
        body?.error === "GitHub Required" ||
        /github/i.test(body?.message || error.message)
    );
}

function formatDate(value?: string | null) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("en", {
        month: "short",
        day: "numeric",
        year: "numeric",
    }).format(date);
}

function timeLeft(value?: string | null) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const diff = date.getTime() - Date.now();
    if (diff <= 0) return "Closed";
    const totalMinutes = Math.max(1, Math.ceil(diff / 60_000));
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    return `${days}d ${hours}h ${minutes}m left`;
}

function isWithinWindow(startAt?: string | null, endAt?: string | null) {
    const now = Date.now();
    const start = startAt ? new Date(startAt).getTime() : 0;
    const end = endAt ? new Date(endAt).getTime() : Number.MAX_SAFE_INTEGER;
    if (Number.isNaN(start) || Number.isNaN(end)) return false;
    return now >= start && now <= end;
}

function startsIn(value?: string | null) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const diff = date.getTime() - Date.now();
    if (diff <= 0) return "";
    const totalMinutes = Math.max(1, Math.ceil(diff / 60_000));
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    return `Opens in ${days}d ${hours}h ${minutes}m`;
}

function compactDuration(value?: string | null) {
    if (!value) return "";
    const clean = value.trim().toLowerCase();
    const days = Number.parseInt(clean.match(/(\d+)\s*(?:d|day|days)\b/)?.[1] || "", 10);
    const hours = Number.parseInt(clean.match(/(\d+)\s*(?:h|hr|hrs|hour|hours)\b/)?.[1] || "", 10);
    const minutes = Number.parseInt(clean.match(/(\d+)\s*(?:m|min|mins|minute|minutes)\b/)?.[1] || "", 10);
    const numbers = clean.match(/\d+(?:\.\d+)?/g)?.map((item) => Number.parseFloat(item)).filter(Number.isFinite) || [];

    if (Number.isFinite(days) || Number.isFinite(hours) || Number.isFinite(minutes)) {
        return `${Number.isFinite(days) ? days : 0}d ${Number.isFinite(hours) ? hours : 0}h ${Number.isFinite(minutes) ? minutes : 0}m`;
    }

    const amount = Math.max(...numbers, 0);
    if (!amount) return value;
    const totalMinutes = /\b(day|days)\b/.test(clean)
        ? amount * 1440
        : /\b(min|mins|minute|minutes)\b/.test(clean)
            ? amount
            : amount * 60;
    const rounded = Math.max(0, Math.round(totalMinutes));
    const parsedDays = Math.floor(rounded / 1440);
    const parsedHours = Math.floor((rounded % 1440) / 60);
    const parsedMinutes = rounded % 60;
    return `${parsedDays}d ${parsedHours}h ${parsedMinutes}m`;
}

function stateText(round: ScheduledRound) {
    if (round.state === "submitted") return "Submitted";
    if (round.state === "closed") return "Closed";
    if (round.state === "pending_setup") return "Details pending";
    if (round.roundType === "ai_interview") {
        if (round.aiInterview?.startAt && !isWithinWindow(round.aiInterview.startAt, round.aiInterview.endAt)) {
            return startsIn(round.aiInterview.startAt) || "Scheduled";
        }
        return "Live";
    }
    if (round.roundType === "mock_oa" && round.onlineAssessment?.startAt && !isWithinWindow(round.onlineAssessment.startAt, round.onlineAssessment.endAt)) {
        return startsIn(round.onlineAssessment.startAt) || "Scheduled";
    }
    return "Ready";
}

function stateClass(round: ScheduledRound) {
    if (round.state === "submitted") return "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300";
    if (round.state === "closed") return "bg-slate-100 text-slate-600 dark:bg-lc-hover dark:text-slate-300";
    if (round.state === "pending_setup") return "bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-200";
    if (round.roundType === "ai_interview" && isWithinWindow(round.aiInterview?.startAt, round.aiInterview?.endAt)) {
        return "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300";
    }
    return "bg-primary/10 text-primary";
}

function DetailList({ title, items }: { title: string; items?: string[] }) {
    const clean = (items || []).filter(Boolean);
    if (!clean.length) return null;
    return (
        <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-lc-border dark:bg-lc-surface">
            <h3 className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">{title}</h3>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                {clean.map((item, index) => (
                    <li key={`${title}-${index}`} className="flex gap-2">
                        <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
                        <span>{item}</span>
                    </li>
                ))}
            </ul>
        </section>
    );
}

function TechnicalAssignmentModal({
    round,
    mode,
    onClose,
    onSubmitted,
    onConnectGithub,
}: {
    round: ScheduledRound;
    mode: "details" | "submit";
    onClose: () => void;
    onSubmitted: (submission: NonNullable<TechnicalAssignment["submission"]>) => void;
    onConnectGithub: () => void;
}) {
    const { session } = useAuth();
    const token = session?.access_token;
    const assignment = round.technicalAssignment!;
    const [repos, setRepos] = useState<GitHubRepo[]>([]);
    const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(null);
    const [repoLoading, setRepoLoading] = useState(false);
    const [needsGithub, setNeedsGithub] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");

    const assignmentId = assignment.id;
    const alreadySubmitted = Boolean(assignment.submitted || assignment.submission);
    const closed = round.state === "closed";

    async function loadRepos() {
        if (mode !== "submit" || !token || alreadySubmitted || closed) return;
        setRepoLoading(true);
        setError("");
        setNeedsGithub(false);
        try {
            const payload = await api.get<{ repos: GitHubRepo[] }>("/jobs/github/repos", token);
            setRepos(payload.repos || []);
        } catch (err) {
            if (isGitHubReconnectError(err)) {
                setNeedsGithub(true);
                setError(err instanceof ApiError ? err.message : "Refresh GitHub access to submit this assignment.");
                return;
            }
            setError(err instanceof ApiError ? err.message : "Could not load GitHub repositories.");
        } finally {
            setRepoLoading(false);
        }
    }

    useEffect(() => {
        loadRepos();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mode, token, assignmentId, alreadySubmitted, closed]);

    async function submit() {
        if (!token || submitting || alreadySubmitted || closed || !selectedRepo?.htmlUrl) return;
        setSubmitting(true);
        setError("");
        try {
            const payload = await api.post<{ submission: NonNullable<TechnicalAssignment["submission"]> }>(
                `/jobs/technical-assignments/${assignmentId}/submissions`,
                { repoUrl: selectedRepo.htmlUrl },
                token
            );
            onSubmitted(payload.submission);
        } catch (err) {
            if (isGitHubReconnectError(err)) {
                setNeedsGithub(true);
                setError(err instanceof ApiError ? err.message : "Refresh GitHub access to submit this assignment.");
                return;
            }
            setError(err instanceof ApiError ? err.message : "Could not submit assignment.");
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className="fixed inset-0 z-[150] bg-slate-950/60 px-4 py-6 backdrop-blur-sm">
            <div className="mx-auto flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-[#FAFBFC] shadow-2xl dark:border-lc-border dark:bg-lc-bg">
                <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-6 py-5 dark:border-lc-border dark:bg-lc-surface">
                    <div className="min-w-0">
                        <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Technical assignment</p>
                        <h2 className="font-nunito text-2xl font-extrabold text-slate-950 dark:text-white">{assignment.title}</h2>
                        <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">
                            {round.job.companyName} - {timeLeft(assignment.closesAt)}{formatDate(assignment.closesAt) ? ` - closes ${formatDate(assignment.closesAt)}` : ""}
                        </p>
                    </div>
                    <button type="button" onClick={onClose} className="grid size-10 place-items-center rounded-full text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-lc-hover" aria-label="Close assignment">
                        <span className="material-symbols-outlined">close</span>
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6">
                    <div className="space-y-5">
                        {mode === "details" && (
                            <>
                                {assignment.candidateMessage && (
                                    <section className="rounded-lg border border-primary/20 bg-primary/5 p-5 text-sm font-semibold leading-6 text-slate-700 dark:bg-primary/10 dark:text-slate-200">
                                        {assignment.candidateMessage}
                                    </section>
                                )}

                                <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-lc-border dark:bg-lc-surface">
                                    <h3 className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">Brief</h3>
                                    <div className="mt-3 space-y-4 text-sm leading-6 text-slate-600 dark:text-slate-300">
                                        {assignment.overview && <p>{assignment.overview}</p>}
                                        {assignment.scenario && <p className="whitespace-pre-line">{assignment.scenario}</p>}
                                    </div>
                                    <div className="mt-4 flex flex-wrap gap-2">
                                        {assignment.timeLimit && <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600 dark:bg-lc-hover dark:text-slate-300">{compactDuration(assignment.timeLimit)}</span>}
                                        {assignment.estimatedHours && <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600 dark:bg-lc-hover dark:text-slate-300">{compactDuration(assignment.estimatedHours)}</span>}
                                        {(assignment.allowedStack || []).slice(0, 6).map((skill) => (
                                            <span key={skill} className="rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">{skill}</span>
                                        ))}
                                    </div>
                                </section>

                                <DetailList title="Tasks" items={assignment.tasks} />
                                <DetailList title="Deliverables" items={assignment.deliverables} />
                                <DetailList title="Constraints" items={assignment.constraints} />
                                <DetailList title="Thinking questions" items={assignment.thinkingQuestions} />
                            </>
                        )}

                        {mode === "submit" && (
                            <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-lc-border dark:bg-lc-surface">
                            <h3 className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">Submit assignment</h3>
                            {alreadySubmitted ? (
                                <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-300">
                                    Submitted {formatDate(assignment.submission?.submittedAt)}. Recruiters can now review your assignment.
                                </div>
                            ) : closed ? (
                                <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-500 dark:border-lc-border dark:bg-lc-elevated dark:text-slate-300">
                                    This assignment is closed.
                                </div>
                            ) : needsGithub ? (
                                <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-400/30 dark:bg-amber-400/10">
                                    <p className="text-sm font-semibold text-amber-800 dark:text-amber-100">
                                        {error || "Connect GitHub so we can verify your assignment repository."}
                                    </p>
                                    <button
                                        type="button"
                                        onClick={onConnectGithub}
                                        className="mt-4 inline-flex h-11 items-center justify-center rounded-full bg-primary px-5 text-sm font-extrabold text-white shadow-lg shadow-primary/20"
                                    >
                                        Connect GitHub
                                    </button>
                                </div>
                            ) : repoLoading ? (
                                <div className="mt-4 grid min-h-[180px] place-items-center rounded-lg border border-slate-200 dark:border-lc-border">
                                    <div className="h-9 w-9 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
                                </div>
                            ) : (
                                <div className="mt-4 space-y-4">
                                    <div>
                                        <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">Select the GitHub repository you built for this assignment.</p>
                                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Only one repository is submitted for this round.</p>
                                    </div>
                                    <div className="grid max-h-[360px] gap-3 overflow-y-auto pr-1">
                                        {repos.length ? repos.map((repo) => {
                                            const selected = selectedRepo?.fullName === repo.fullName;
                                            return (
                                                <button
                                                    type="button"
                                                    key={repo.fullName}
                                                    onClick={() => setSelectedRepo(repo)}
                                                    className={`rounded-xl border p-4 text-left transition ${
                                                        selected
                                                            ? "border-primary bg-primary/5"
                                                            : "border-slate-200 hover:border-primary/40 dark:border-lc-border dark:hover:border-primary/50"
                                                    }`}
                                                >
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div className="min-w-0">
                                                            <p className="break-all font-bold text-slate-950 dark:text-white">{repo.fullName}</p>
                                                            {repo.description && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{repo.description}</p>}
                                                        </div>
                                                        <span className={`material-symbols-outlined ${selected ? "text-primary" : "text-slate-300"}`}>{selected ? "check_circle" : "radio_button_unchecked"}</span>
                                                    </div>
                                                    <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold text-slate-500 dark:text-slate-400">
                                                        {repo.language && <span>{repo.language}</span>}
                                                        {repo.fork && <span className="text-amber-600 dark:text-amber-300">Fork</span>}
                                                        {repo.private && <span>Private</span>}
                                                    </div>
                                                </button>
                                            );
                                        }) : (
                                            <div className="rounded-lg border border-dashed border-slate-200 p-5 text-sm font-semibold text-slate-500 dark:border-lc-border dark:text-slate-400">
                                                No repositories found for this GitHub account.
                                            </div>
                                        )}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={submit}
                                        disabled={submitting || !selectedRepo}
                                        className="inline-flex h-11 items-center justify-center rounded-full bg-primary px-5 text-sm font-extrabold text-white shadow-lg shadow-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        {submitting ? "Submitting..." : "Submit assignment"}
                                    </button>
                                </div>
                            )}
                            {assignment.submissionInstructions && <p className="mt-3 text-xs leading-5 text-slate-500 dark:text-slate-400">{assignment.submissionInstructions}</p>}
                            {error && <p className="mt-3 text-sm font-semibold text-red-600 dark:text-red-300">{error}</p>}
                            </section>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

function OnlineAssessmentModal({
    round,
    onClose,
    onStart,
    starting,
}: {
    round: ScheduledRound;
    onClose: () => void;
    onStart: (round: ScheduledRound) => void;
    starting: boolean;
}) {
    const assessment = round.onlineAssessment!;
    const canStart = round.state !== "submitted" && round.state !== "closed" && isWithinWindow(assessment.startAt, assessment.endAt);

    return (
        <div className="fixed inset-0 z-[150] bg-slate-950/60 px-4 py-6 backdrop-blur-sm">
            <div className="mx-auto flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-[#FAFBFC] shadow-2xl dark:border-lc-border dark:bg-lc-bg">
                <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-6 py-5 dark:border-lc-border dark:bg-lc-surface">
                    <div className="min-w-0">
                        <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Online assessment</p>
                        <h2 className="font-nunito text-2xl font-extrabold text-slate-950 dark:text-white">{assessment.title}</h2>
                        <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">{round.job.companyName} - {formatDate(assessment.startAt)} to {formatDate(assessment.endAt)}</p>
                    </div>
                    <button type="button" onClick={onClose} className="grid size-10 place-items-center rounded-full text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-lc-hover" aria-label="Close OA">
                        <span className="material-symbols-outlined">close</span>
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6">
                    <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
                        <section className="space-y-5">
                            {assessment.candidateMessage && (
                                <div className="rounded-lg border border-primary/20 bg-primary/5 p-5 text-sm font-semibold leading-6 text-slate-700 dark:bg-primary/10 dark:text-slate-200">
                                    {assessment.candidateMessage}
                                </div>
                            )}
                            <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-lc-border dark:bg-lc-surface">
                                <h3 className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">Schedule</h3>
                                <div className="mt-4 grid gap-3 md:grid-cols-2">
                                    <Info label="Starts" value={formatDate(assessment.startAt)} />
                                    <Info label="Ends" value={formatDate(assessment.endAt)} />
                                    <Info label="Duration" value={compactDuration(`${assessment.durationMinutes || 0} minutes`)} />
                                    <Info label="Questions" value={String(assessment.questionCount || 0)} />
                                </div>
                            </section>
                            <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-lc-border dark:bg-lc-surface">
                                <div className="flex items-start gap-3">
                                    <span className="material-symbols-outlined mt-0.5 text-primary">lock</span>
                                    <div>
                                        <h3 className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">Questions locked until start</h3>
                                        <p className="mt-2 text-sm font-semibold leading-6 text-slate-500 dark:text-slate-400">
                                            The exact questions are revealed only inside the secure OA session after you start the assessment.
                                        </p>
                                    </div>
                                </div>
                            </section>
                        </section>

                        <aside className="space-y-4">
                            <Info label="Status" value={stateText(round)} />
                            <Info label="Secure browser" value={assessment.requireSecureBrowser ? "Required" : "Optional"} />
                            <button
                                type="button"
                                onClick={() => onStart(round)}
                                disabled={!canStart || starting}
                                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-extrabold text-white shadow-lg shadow-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                <span className="material-symbols-outlined text-[18px]">rocket_launch</span>
                                {starting ? "Opening..." : round.state === "submitted" ? "Submitted" : "Start OA"}
                            </button>
                            {assessment.instructions && <p className="rounded-lg border border-slate-200 bg-white p-4 text-xs font-semibold leading-5 text-slate-500 dark:border-lc-border dark:bg-lc-surface dark:text-slate-400">{assessment.instructions}</p>}
                        </aside>
                    </div>
                </div>
            </div>
        </div>
    );
}

function Info({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-lc-border dark:bg-lc-surface">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">{label}</p>
            <p className="mt-1 text-sm font-extrabold text-slate-950 dark:text-white">{value}</p>
        </div>
    );
}

function ScheduledCard({
    round,
    onView,
    onSubmit,
    onStartOa,
    onStartAi,
    startingOa,
}: {
    round: ScheduledRound;
    onView: (round: ScheduledRound) => void;
    onSubmit: (round: ScheduledRound) => void;
    onStartOa: (round: ScheduledRound) => void;
    onStartAi: (round: ScheduledRound) => void;
    startingOa: boolean;
}) {
    const assignment = round.technicalAssignment;
    const assessment = round.onlineAssessment;
    const aiInterview = round.aiInterview;
    const showDeadline = round.roundType === "technical_assignment" && assignment?.closesAt;
    const showOaWindow = round.roundType === "mock_oa" && assessment?.startAt && assessment?.endAt;
    const showAiWindow = round.roundType === "ai_interview" && aiInterview?.startAt && aiInterview?.endAt;
    const canStartOa = Boolean(assessment && round.state !== "submitted" && round.state !== "closed" && isWithinWindow(assessment.startAt, assessment.endAt));
    const canStartAi = Boolean(aiInterview && round.state !== "submitted" && round.state !== "closed" && isWithinWindow(aiInterview.startAt, aiInterview.endAt));

    return (
        <article
            onClick={() => {
                if (round.roundType === "technical_assignment" && assignment) onView(round);
                if (round.roundType === "mock_oa" && assessment) onView(round);
            }}
            className="cursor-pointer rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-primary/40 dark:border-lc-border dark:bg-lc-surface"
        >
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary">
                            <span className="material-symbols-outlined">{round.roundIcon}</span>
                        </span>
                        <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-extrabold uppercase tracking-[0.12em] text-primary">{round.roundLabel}</span>
                        <span className={`rounded-full px-3 py-1 text-xs font-extrabold ${stateClass(round)}`}>{stateText(round)}</span>
                    </div>
                    <h2 className="mt-4 font-nunito text-2xl font-extrabold text-slate-950 dark:text-white">{round.job.title}</h2>
                    <p className="mt-1 text-sm font-bold text-slate-500 dark:text-slate-400">{round.job.companyName}{round.job.location ? ` - ${round.job.location}` : ""}</p>
                    <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
                        {round.roundType === "technical_assignment" && assignment
                            ? assignment.candidateMessage || assignment.overview || "Complete and submit the assigned project before the deadline."
                            : round.roundType === "mock_oa" && assessment
                                ? assessment.candidateMessage || "Complete this online assessment inside the published window."
                            : round.roundType === "ai_interview" && aiInterview
                                ? aiInterview.candidateMessage || aiInterview.candidateInstructions || "Complete this AI screening interview inside the published window."
                            : round.configured
                                ? "This round is scheduled for you. Details and actions will appear here as the company configures the workflow."
                                : "You have been moved to this round. The company has not published the round details yet."}
                    </p>
                    {round.roundType === "ai_interview" && aiInterview && (
                        <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold text-slate-500 dark:text-slate-300">
                            <span className="rounded-full bg-slate-100 px-3 py-1 dark:bg-lc-elevated">{aiInterview.durationMinutes || 0} min</span>
                            <span className="rounded-full bg-slate-100 px-3 py-1 dark:bg-lc-elevated">Camera + microphone + fullscreen</span>
                        </div>
                    )}
                </div>

                <div className="flex shrink-0 flex-col gap-3 lg:min-w-[220px]">
                    {showDeadline && (
                        <div className="rounded-lg bg-slate-50 p-4 dark:bg-lc-elevated">
                            <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">Deadline</p>
                            <p className="mt-1 font-bold text-slate-950 dark:text-white">{timeLeft(assignment?.closesAt)}</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">{formatDate(assignment?.closesAt)}</p>
                        </div>
                    )}
                    {showOaWindow && (
                        <div className="rounded-lg bg-slate-50 p-4 dark:bg-lc-elevated">
                            <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">Window</p>
                            <p className="mt-1 font-bold text-slate-950 dark:text-white">{isWithinWindow(assessment?.startAt, assessment?.endAt) ? timeLeft(assessment?.endAt) : startsIn(assessment?.startAt)}</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">{formatDate(assessment?.startAt)} - {formatDate(assessment?.endAt)}</p>
                        </div>
                    )}
                    {showAiWindow && (
                        <div className="rounded-lg bg-slate-50 p-4 dark:bg-lc-elevated">
                            <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">Interview window</p>
                            <p className="mt-1 font-bold text-slate-950 dark:text-white">{isWithinWindow(aiInterview?.startAt, aiInterview?.endAt) ? timeLeft(aiInterview?.endAt) : startsIn(aiInterview?.startAt)}</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">{formatDate(aiInterview?.startAt)} - {formatDate(aiInterview?.endAt)}</p>
                        </div>
                    )}
                    {round.roundType === "technical_assignment" && assignment ? (
                        <button
                            type="button"
                            onClick={(event) => {
                                event.stopPropagation();
                                onSubmit(round);
                            }}
                            className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-extrabold text-white shadow-lg shadow-primary/20"
                        >
                            <span className="material-symbols-outlined text-[18px]">{round.state === "submitted" ? "visibility" : "open_in_new"}</span>
                            {round.state === "submitted" ? "View submission" : "Submit assignment"}
                        </button>
                    ) : round.roundType === "mock_oa" && assessment ? (
                        <button
                            type="button"
                            onClick={(event) => {
                                event.stopPropagation();
                                onStartOa(round);
                            }}
                            disabled={!canStartOa || startingOa}
                            className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-extrabold text-white shadow-lg shadow-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <span className="material-symbols-outlined text-[18px]">rocket_launch</span>
                            {startingOa ? "Opening..." : round.state === "submitted" ? "Submitted" : "Start OA"}
                        </button>
                    ) : round.roundType === "ai_interview" && aiInterview ? (
                        <button
                            type="button"
                            onClick={(event) => {
                                event.stopPropagation();
                                onStartAi(round);
                            }}
                            disabled={!canStartAi}
                            className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-extrabold text-white shadow-lg shadow-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {round.state === "submitted" ? "Submitted" : canStartAi ? "Start interview" : "Not open yet"}
                        </button>
                    ) : (
                        <div className="rounded-lg border border-dashed border-slate-200 px-4 py-3 text-sm font-semibold text-slate-500 dark:border-lc-border dark:text-slate-400">
                            Details will appear here once scheduled.
                        </div>
                    )}
                </div>
            </div>
        </article>
    );
}

export function ScheduledRounds() {
    const router = useRouter();
    const { session, loading } = useAuth();
    const token = session?.access_token;
    const [rounds, setRounds] = useState<ScheduledRound[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState("");
    const [oauthNotice, setOauthNotice] = useState("");
    const [selectedRound, setSelectedRound] = useState<{ round: ScheduledRound; mode: "details" | "submit" } | null>(null);
    const [proctoredRound, setProctoredRound] = useState<ScheduledRound | null>(null);
    const [startingOaId] = useState<string | null>(null);
    const savedProviderTokenRef = useRef<string | null>(null);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
        const errorCode = params.get("error_code") || hashParams.get("error_code");
        const errorDescription = params.get("error_description") || hashParams.get("error_description");
        const hasOAuthParams = Boolean(
            params.get("error") ||
            params.get("error_code") ||
            params.get("error_description") ||
            hashParams.get("error") ||
            hashParams.get("error_code") ||
            hashParams.get("error_description")
        );

        if (errorCode === "identity_already_exists") {
            setOauthNotice("GitHub is already linked to this account. Refresh GitHub access so we can store a fresh repo token for assignment submission.");
        } else if (errorDescription) {
            setOauthNotice(errorDescription.replace(/\+/g, " "));
        }

        if (hasOAuthParams) {
            window.history.replaceState(null, "", window.location.pathname);
        }
    }, []);

    useEffect(() => {
        if (!token || !session) return;
        const providerToken = (session as any).provider_token as string | undefined;
        if (!providerToken || savedProviderTokenRef.current === providerToken) return;

        const identities = (session.user?.identities || []) as any[];
        const github = identities.find((identity) => identity.provider === "github");
        if (!github) return;

        savedProviderTokenRef.current = providerToken;
        const identityData = github.identity_data || {};
        const scopes = typeof (session as any).provider_token_scope === "string"
            ? (session as any).provider_token_scope.split(/[,\s]+/).filter(Boolean)
            : ["repo", "read:user", "user:email"];

        api.post("/github/integration", {
            accessToken: providerToken,
            refreshToken: (session as any).provider_refresh_token || null,
            scopes,
            githubUserId: String(identityData.provider_id || identityData.sub || github.id || ""),
            githubUsername: identityData.user_name || identityData.preferred_username || identityData.name || null,
        }, token)
            .then(() => setOauthNotice(""))
            .catch((err) => {
                if (err instanceof ApiError && err.status === 429) {
                    setOauthNotice("");
                    return;
                }
                savedProviderTokenRef.current = null;
                setOauthNotice(err instanceof ApiError ? err.message : "GitHub connected, but token storage failed. Please reconnect GitHub.");
            });
    }, [session, token]);

    useEffect(() => {
        if (loading) return;
        if (!token) {
            setIsLoading(false);
            return;
        }

        let mounted = true;
        setIsLoading(true);
        setError("");
        api.get<ScheduledResponse>("/jobs/scheduled", token)
            .then((payload) => {
                if (mounted) setRounds(payload.scheduled || []);
            })
            .catch((err) => {
                if (mounted) setError(err instanceof ApiError ? err.message : "Failed to load scheduled rounds.");
            })
            .finally(() => {
                if (mounted) setIsLoading(false);
            });

        return () => {
            mounted = false;
        };
    }, [loading, token]);

    const sortedRounds = useMemo(() => {
        return [...rounds].sort((first, second) => {
            const firstDeadline = first.technicalAssignment?.closesAt ? new Date(first.technicalAssignment.closesAt).getTime() : Number.MAX_SAFE_INTEGER;
            const secondDeadline = second.technicalAssignment?.closesAt ? new Date(second.technicalAssignment.closesAt).getTime() : Number.MAX_SAFE_INTEGER;
            return firstDeadline - secondDeadline;
        });
    }, [rounds]);

    function updateSubmission(submission: NonNullable<TechnicalAssignment["submission"]>) {
        if (!selectedRound?.round.technicalAssignment) return;
        const nextRound = {
            ...selectedRound.round,
            state: "submitted" as const,
            technicalAssignment: {
                ...selectedRound.round.technicalAssignment,
                submitted: true,
                submission,
            },
        };
        setSelectedRound({ round: nextRound, mode: "submit" });
        setRounds((current) => current.map((round) => round.id === nextRound.id ? nextRound : round));
    }

    function connectGithub() {
        const supabase = createSupabaseBrowserClient();
        const hasGithubIdentity = Boolean(session?.user?.identities?.some((identity) => identity.provider === "github"));
        const options = {
            redirectTo: `${window.location.origin}/scheduled`,
            scopes: "repo read:user user:email",
            queryParams: {
                prompt: "consent",
            },
        } as any;
        const request = hasGithubIdentity
            ? supabase.auth.signInWithOAuth({
                provider: "github",
                options,
            })
            : supabase.auth.linkIdentity({
                provider: "github",
                options,
            });

        request.then(({ data, error }) => {
            if (error) {
                setOauthNotice(error.message);
                return;
            }
            const redirectUrl = (data as { url?: string } | null)?.url;
            if (redirectUrl) window.location.assign(redirectUrl);
        });
    }

    function startOnlineAssessment(round: ScheduledRound) {
        if (!token || !round.onlineAssessment || startingOaId) return;
        setError("");
        setSelectedRound(null);
        setProctoredRound(round);
    }

    function startAiInterview(round: ScheduledRound) {
        if (!round.aiInterview || round.state === "closed" || round.state === "submitted") return;
        if (!isWithinWindow(round.aiInterview.startAt, round.aiInterview.endAt)) return;
        router.push(`/screening-room/${encodeURIComponent(round.id)}`);
    }

    function markOnlineAssessmentSubmitted(roundId: string) {
        setRounds((current) => current.map((round) => round.id === roundId ? {
            ...round,
            status: "submitted",
            state: "submitted" as const,
        } : round));
    }

    return (
        <main className="min-h-full bg-[#FAFBFC] px-4 py-8 dark:bg-lc-bg sm:px-6 lg:px-10">
            <div className="mx-auto flex max-w-7xl flex-col gap-6">
                <section className="flex flex-col gap-3">
                    <div className="flex items-center gap-3">
                        <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                            <span className="material-symbols-outlined">event_available</span>
                        </span>
                        <div>
                            <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">Candidate workspace</p>
                            <h1 className="font-nunito text-3xl font-extrabold tracking-tight text-slate-950 dark:text-white sm:text-4xl">Scheduled</h1>
                        </div>
                    </div>
                    <p className="max-w-3xl text-sm leading-6 text-slate-500 dark:text-slate-400">
                        Rounds appear here only after a company moves your application forward.
                    </p>
                </section>

                {error && (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300">
                        {error}
                    </div>
                )}

                {oauthNotice && (
                    <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-100 sm:flex-row sm:items-center sm:justify-between">
                        <span>{oauthNotice}</span>
                        <button
                            type="button"
                            onClick={connectGithub}
                            className="rounded-full bg-primary px-4 py-2 text-sm font-bold text-white"
                        >
                            Refresh GitHub access
                        </button>
                    </div>
                )}

                {isLoading ? (
                    <section className="grid min-h-[320px] place-items-center rounded-xl border border-slate-200 bg-white shadow-sm dark:border-lc-border dark:bg-lc-surface">
                        <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
                    </section>
                ) : sortedRounds.length === 0 ? (
                    <section className="rounded-xl border border-dashed border-slate-200 bg-white p-10 text-center shadow-sm dark:border-lc-border dark:bg-lc-surface">
                        <span className="material-symbols-outlined text-5xl text-slate-400">event_busy</span>
                        <h2 className="mt-4 font-nunito text-2xl font-extrabold text-slate-950 dark:text-white">No scheduled rounds yet</h2>
                        <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-500 dark:text-slate-400">
                            When a company selects you for an assignment, OA, AI interview, or final interview, it will show up here.
                        </p>
                    </section>
                ) : (
                    <section className="grid gap-4">
                        {sortedRounds.map((round) => (
                            <ScheduledCard
                                key={round.id}
                                round={round}
                                onView={(value) => setSelectedRound({ round: value, mode: "details" })}
                                onSubmit={(value) => setSelectedRound({ round: value, mode: "submit" })}
                                onStartOa={startOnlineAssessment}
                                onStartAi={startAiInterview}
                                startingOa={startingOaId === round.id}
                            />
                        ))}
                    </section>
                )}
            </div>

            {selectedRound?.round.technicalAssignment && (
                <TechnicalAssignmentModal
                    round={selectedRound.round}
                    mode={selectedRound.mode}
                    onClose={() => setSelectedRound(null)}
                    onSubmitted={updateSubmission}
                    onConnectGithub={connectGithub}
                />
            )}
            {selectedRound?.round.onlineAssessment && (
                <OnlineAssessmentModal
                    round={selectedRound.round}
                    onClose={() => setSelectedRound(null)}
                    onStart={startOnlineAssessment}
                    starting={startingOaId === selectedRound.round.id}
                />
            )}
            {proctoredRound?.onlineAssessment && token && (
                <ProctoredOnlineAssessmentFlow
                    round={proctoredRound}
                    token={token}
                    onExit={() => setProctoredRound(null)}
                    onSubmitted={() => markOnlineAssessmentSubmitted(proctoredRound.id)}
                />
            )}
        </main>
    );
}
