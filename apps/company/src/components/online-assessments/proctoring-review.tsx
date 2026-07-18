"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { humanizeProctoringEvent, type ProctoringEventRecord, type ProctoringSeverity } from "@interviewforge/shared";
import { useCompanyAuth } from "@/context/company-auth-context";
import { api, ApiError } from "@/lib/api";

type SessionDetail = {
    id: string;
    jobRoundId: string;
    status: "pending" | "active" | "submitted" | "terminated" | "abandoned" | string;
    startedAt?: string | null;
    submittedAt?: string | null;
    terminatedAt?: string | null;
    terminatedReason?: string | null;
    integrityScore?: number | null;
    candidate: {
        id: string;
        fullName: string;
        email: string;
        avatarUrl?: string | null;
    };
    assessment?: {
        title: string;
        jobTitle?: string;
        companyName?: string;
        durationMinutes?: number | null;
        questions?: Array<{
            id: string;
            text: string;
            type?: string | null;
            difficulty?: string | null;
            timeLimitMinutes?: number | null;
            aiInterviewEnabled?: boolean;
        }>;
    };
    submission?: {
        status?: string | null;
        score?: number | null;
        submittedAt?: string | null;
        evaluatedAt?: string | null;
        answerCount?: number;
        answers?: Array<{ questionId: string; answer: string; timeSpentSeconds?: number | null }>;
        report?: {
            id: string;
            overallScore: number;
            aiSummary?: string;
            detail?: unknown;
            evaluatedAt?: string | null;
        } | null;
    };
    eventCountsByType: Record<string, number>;
    eventCountsBySeverity: Record<string, number>;
    rulesSnapshot?: unknown;
};

type EventRow = {
    id: string;
    clientEventId: string;
    eventType: string;
    severity: ProctoringSeverity;
    payload: Record<string, unknown>;
    serverTimestamp?: string | null;
    triggeredTermination?: boolean;
};

type SnapshotRow = {
    id: string;
    url: string;
    takenAt?: string | null;
    trigger: "scheduled" | "event_triggered" | string;
    triggeringEventId?: string | null;
};

const severityOrder: ProctoringSeverity[] = ["critical", "high", "medium", "low", "info"];

function formatDate(value?: string | null) {
    if (!value) return "Not recorded";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Not recorded";
    return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
    }).format(date);
}

function durationText(start?: string | null, end?: string | null) {
    if (!start || !end) return "Not recorded";
    const diff = new Date(end).getTime() - new Date(start).getTime();
    if (!Number.isFinite(diff) || diff < 0) return "Not recorded";
    const minutes = Math.max(1, Math.round(diff / 60_000));
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function statusClass(status: string) {
    if (status === "submitted") return "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300";
    if (status === "active") return "bg-emerald-500 text-white";
    if (status === "terminated") return "bg-red-50 text-red-700 dark:bg-red-400/10 dark:text-red-300";
    if (status === "abandoned") return "bg-slate-100 text-slate-600 dark:bg-lc-hover dark:text-slate-300";
    return "bg-primary/10 text-primary";
}

function scoreColor(score?: number | null) {
    if (typeof score !== "number") return "#94a3b8";
    if (score >= 80) return "#10b981";
    if (score >= 60) return "#f59e0b";
    return "#ef4444";
}

function severityClass(severity: string) {
    if (severity === "critical") return "bg-red-600";
    if (severity === "high") return "bg-orange-500";
    if (severity === "medium") return "bg-amber-400";
    if (severity === "low") return "bg-blue-400";
    return "bg-slate-300";
}

function responseShape(value: unknown): { session?: SessionDetail; events?: EventRow[]; snapshots?: SnapshotRow[] } {
    return value && typeof value === "object" ? value as any : {};
}

export function OnlineAssessmentProctoringReview({ sessionId }: { sessionId: string }) {
    const { session } = useCompanyAuth();
    const token = session?.access_token;
    const router = useRouter();
    const [detail, setDetail] = useState<SessionDetail | null>(null);
    const [events, setEvents] = useState<EventRow[]>([]);
    const [snapshots, setSnapshots] = useState<SnapshotRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [severityFilter, setSeverityFilter] = useState<ProctoringSeverity | "all">("all");
    const [terminateOpen, setTerminateOpen] = useState(false);
    const [terminateReason, setTerminateReason] = useState("");
    const [terminating, setTerminating] = useState(false);

    const load = async () => {
        if (!token) return;
        setError("");
        try {
            const [detailPayload, eventsPayload, snapshotsPayload] = await Promise.all([
                api.get(`/companies/secure-oa/sessions/${sessionId}`, token),
                api.get(`/companies/secure-oa/sessions/${sessionId}/events`, token),
                api.get(`/companies/secure-oa/sessions/${sessionId}/snapshots`, token),
            ]);
            setDetail(responseShape(detailPayload).session || null);
            setEvents(responseShape(eventsPayload).events || []);
            setSnapshots(responseShape(snapshotsPayload).snapshots || []);
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "Could not load the proctoring report.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token, sessionId]);

    useEffect(() => {
        if (detail?.status !== "active") return;
        const timer = window.setInterval(() => void load(), 10_000);
        return () => window.clearInterval(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [detail?.status, token, sessionId]);

    const filteredEvents = useMemo(
        () => severityFilter === "all" ? events : events.filter((event) => event.severity === severityFilter),
        [events, severityFilter]
    );
    const totalEvents = events.length;
    const submittedOrEndedAt = detail?.submittedAt || detail?.terminatedAt || null;

    async function terminate() {
        if (!token || !detail || terminateReason.trim().length < 3 || terminating) return;
        setTerminating(true);
        try {
            await api.post(`/companies/secure-oa/sessions/${detail.id}/terminate`, { reason: terminateReason.trim() }, token);
            setTerminateOpen(false);
            setTerminateReason("");
            await load();
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "Could not end this assessment.");
        } finally {
            setTerminating(false);
        }
    }

    if (loading) {
        return (
            <main className="grid min-h-[70vh] place-items-center bg-[#FAFBFC] dark:bg-lc-bg">
                <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
            </main>
        );
    }

    if (!detail) {
        return (
            <main className="min-h-[70vh] bg-[#FAFBFC] p-8 dark:bg-lc-bg">
                <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm font-bold text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-200">
                    {error || "Proctoring report not found."}
                </div>
            </main>
        );
    }

    const assessmentTitle = detail.assessment?.title || "Online assessment";
    const score = detail.integrityScore;

    return (
        <main className="min-h-full bg-[#FAFBFC] px-4 py-8 dark:bg-lc-bg sm:px-6 lg:px-10">
            <div className="mx-auto max-w-7xl space-y-6">
                <header className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5 dark:border-lc-border dark:bg-lc-surface lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                        <button type="button" onClick={() => router.back()} className="mb-4 inline-flex items-center gap-2 text-sm font-extrabold text-primary">
                            <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                            Back to OA
                        </button>
                        <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Secure OA proctoring report</p>
                        <h1 className="mt-2 font-nunito text-3xl font-extrabold text-slate-950 dark:text-white">{detail.candidate.fullName}</h1>
                        <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">{detail.candidate.email} - {assessmentTitle}</p>
                        <div className="mt-4 flex flex-wrap gap-2">
                            <span className={`rounded-full px-3 py-1 text-xs font-extrabold capitalize ${statusClass(detail.status)}`}>{detail.status.replace(/_/g, " ")}</span>
                            {detail.status === "active" && <span className="rounded-full bg-emerald-500 px-3 py-1 text-xs font-extrabold text-white shadow-sm shadow-emerald-500/20">LIVE</span>}
                            {detail.terminatedReason && <span className="rounded-full bg-red-50 px-3 py-1 text-xs font-extrabold text-red-700 dark:bg-red-400/10 dark:text-red-300">{detail.terminatedReason.replace(/_/g, " ")}</span>}
                        </div>
                    </div>
                    <div className="grid gap-2 text-sm font-semibold text-slate-500 dark:text-slate-400 sm:grid-cols-3 lg:min-w-[520px]">
                        <Info label="Started" value={formatDate(detail.startedAt)} />
                        <Info label={detail.status === "terminated" ? "Ended" : "Submitted"} value={formatDate(submittedOrEndedAt)} />
                        <Info label="Duration" value={durationText(detail.startedAt, submittedOrEndedAt)} />
                    </div>
                    {detail.status === "active" && (
                        <button type="button" onClick={() => setTerminateOpen(true)} className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-full bg-red-600 px-4 text-sm font-extrabold text-white shadow-lg shadow-red-600/20">
                            <span className="material-symbols-outlined text-[18px]">block</span>
                            End assessment
                        </button>
                    )}
                </header>

                {error && (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-200">{error}</div>
                )}

                <section className="grid gap-5 lg:grid-cols-[320px_1fr]">
                    <div className="space-y-5">
                        <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-lc-border dark:bg-lc-surface">
                            <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Integrity score</p>
                            <div className="mt-5 grid place-items-center">
                                <IntegrityDial score={score} />
                            </div>
                            <p className="mt-4 text-center text-sm font-semibold leading-6 text-slate-500 dark:text-slate-400">
                                {typeof score === "number"
                                    ? `Based on ${totalEvents} proctoring events evaluated against the active ruleset.`
                                    : "Score is only calculated for submitted sessions."}
                            </p>
                        </section>

                        <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-lc-border dark:bg-lc-surface">
                            <h2 className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">Assessment signal</h2>
                            <div className="mt-4 grid gap-3">
                                <Info label="Answer count" value={`${detail.submission?.answerCount || 0}/${detail.assessment?.questions?.length || 0}`} />
                                <Info label="AI follow-ups" value={String((detail.assessment?.questions || []).filter((question) => question.aiInterviewEnabled).length)} />
                                <Info label="OA score" value={detail.submission?.report?.overallScore != null ? `${detail.submission.report.overallScore}/100` : detail.submission?.score != null ? `${detail.submission.score}/100` : "Pending"} />
                            </div>
                            <p className="mt-4 text-sm font-semibold leading-6 text-slate-500 dark:text-slate-400">
                                {detail.submission?.report?.aiSummary || "The answer-quality report will appear here once OA answer evaluation runs. Integrity signal is available now."}
                            </p>
                        </section>
                    </div>

                    <div className="space-y-5">
                        <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-lc-border dark:bg-lc-surface">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <h2 className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">Severity summary</h2>
                                <button type="button" onClick={() => setSeverityFilter("all")} className={`rounded-full px-3 py-1 text-xs font-extrabold ${severityFilter === "all" ? "bg-primary text-white" : "bg-slate-100 text-slate-600 dark:bg-lc-hover dark:text-slate-300"}`}>All</button>
                            </div>
                            <div className="mt-4 grid gap-3">
                                {severityOrder.map((severity) => {
                                    const count = detail.eventCountsBySeverity?.[severity] || 0;
                                    const width = totalEvents ? Math.max(4, (count / totalEvents) * 100) : 0;
                                    return (
                                        <button key={severity} type="button" onClick={() => setSeverityFilter(severity)} className="text-left">
                                            <div className="flex justify-between text-xs font-extrabold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
                                                <span>{severity}</span>
                                                <span>{count}</span>
                                            </div>
                                            <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-lc-hover">
                                                <div className={`h-full rounded-full ${severityClass(severity)}`} style={{ width: `${width}%` }} />
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </section>

                        <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-lc-border dark:bg-lc-surface">
                            <h2 className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">Event timeline</h2>
                            <div className="mt-4 max-h-[620px] overflow-y-auto pr-1">
                                {filteredEvents.length ? filteredEvents.map((event) => {
                                    const humanized = humanizeProctoringEvent({
                                        eventType: event.eventType as any,
                                        payload: event.payload,
                                    } as ProctoringEventRecord);
                                    return (
                                        <article key={event.id} className="mb-3 grid grid-cols-[5px_1fr] overflow-hidden rounded-lg border border-slate-200 dark:border-lc-border">
                                            <div className={severityClass(event.severity)} />
                                            <div className="p-4">
                                                <div className="flex flex-wrap items-start justify-between gap-2">
                                                    <div>
                                                        <p className="text-sm font-extrabold text-slate-950 dark:text-white">{humanized.title}</p>
                                                        {humanized.detail && <p className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">{humanized.detail}</p>}
                                                    </div>
                                                    <div className="flex flex-wrap justify-end gap-2">
                                                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-extrabold text-slate-600 dark:bg-lc-hover dark:text-slate-300">{event.severity}</span>
                                                        {event.triggeredTermination && <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-extrabold text-red-700 dark:bg-red-400/10 dark:text-red-300">TERMINATED</span>}
                                                    </div>
                                                </div>
                                                <p className="mt-2 text-xs font-semibold text-slate-400">{formatDate(event.serverTimestamp)}</p>
                                            </div>
                                        </article>
                                    );
                                }) : (
                                    <div className="rounded-lg border border-dashed border-slate-200 p-8 text-center text-sm font-semibold text-slate-500 dark:border-lc-border dark:text-slate-400">
                                        No proctoring events for this filter.
                                    </div>
                                )}
                            </div>
                        </section>
                    </div>
                </section>

                <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-lc-border dark:bg-lc-surface">
                    <h2 className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">Snapshots</h2>
                    {snapshots.length ? (
                        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                            {snapshots.map((snapshot) => (
                                <a key={snapshot.id} href={snapshot.url} target="_blank" rel="noreferrer" className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50 dark:border-lc-border dark:bg-lc-elevated">
                                    <img src={snapshot.url} alt="" className="aspect-[4/3] w-full object-cover" />
                                    <div className="p-3 text-xs font-semibold text-slate-500 dark:text-slate-400">
                                        <p className="font-extrabold capitalize text-slate-700 dark:text-slate-200">{snapshot.trigger.replace(/_/g, " ")}</p>
                                        <p className="mt-1">{formatDate(snapshot.takenAt)}</p>
                                    </div>
                                </a>
                            ))}
                        </div>
                    ) : (
                        <p className="mt-3 text-sm font-semibold text-slate-500 dark:text-slate-400">No snapshots were uploaded for this session.</p>
                    )}
                </section>
            </div>

            {terminateOpen && (
                <div className="fixed inset-0 z-[180] grid place-items-center bg-slate-950/60 p-4 backdrop-blur-sm">
                    <section className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-lc-border dark:bg-lc-surface">
                        <h2 className="font-nunito text-2xl font-extrabold text-slate-950 dark:text-white">End assessment</h2>
                        <p className="mt-2 text-sm font-semibold leading-6 text-slate-500 dark:text-slate-400">The candidate will immediately see a termination screen. Add a reason for the audit trail.</p>
                        <textarea value={terminateReason} onChange={(event) => setTerminateReason(event.target.value)} className="mt-4 min-h-28 w-full rounded-lg border border-slate-200 bg-white p-3 text-sm font-semibold outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-elevated" placeholder="Reason" />
                        <div className="mt-5 flex justify-end gap-3">
                            <button type="button" onClick={() => setTerminateOpen(false)} className="h-10 rounded-full border border-slate-200 px-4 text-sm font-extrabold text-slate-600 dark:border-lc-border dark:text-slate-300">Cancel</button>
                            <button type="button" onClick={terminate} disabled={terminateReason.trim().length < 3 || terminating} className="h-10 rounded-full bg-red-600 px-4 text-sm font-extrabold text-white disabled:cursor-not-allowed disabled:opacity-50">{terminating ? "Ending..." : "End assessment"}</button>
                        </div>
                    </section>
                </div>
            )}
        </main>
    );
}

function Info({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-lc-border dark:bg-lc-elevated">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">{label}</p>
            <p className="mt-1 text-sm font-extrabold text-slate-950 dark:text-white">{value}</p>
        </div>
    );
}

function IntegrityDial({ score }: { score?: number | null }) {
    const normalized = typeof score === "number" ? Math.max(0, Math.min(100, score)) : 0;
    const circumference = 2 * Math.PI * 58;
    const offset = circumference - (normalized / 100) * circumference;
    return (
        <svg viewBox="0 0 160 160" className="h-40 w-40">
            <circle cx="80" cy="80" r="58" fill="none" stroke="currentColor" strokeWidth="14" className="text-slate-100 dark:text-lc-hover" />
            <circle
                cx="80"
                cy="80"
                r="58"
                fill="none"
                stroke={scoreColor(score)}
                strokeWidth="14"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={offset}
                transform="rotate(-90 80 80)"
            />
            <text x="80" y="76" textAnchor="middle" className="fill-slate-950 text-3xl font-black dark:fill-white">{typeof score === "number" ? Math.round(score) : "-"}</text>
            <text x="80" y="100" textAnchor="middle" className="fill-slate-400 text-xs font-bold">integrity</text>
        </svg>
    );
}
