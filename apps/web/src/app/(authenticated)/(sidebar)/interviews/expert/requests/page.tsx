"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/auth-context";
import { ApiError, api } from "@/lib/api";

type BookingRequest = {
    id: string;
    interviewType: string;
    preferredLanguage: string;
    level: string;
    topicsFocus: string[];
    notes: string | null;
    status: string;
    expiresAt: string;
    createdAt: string;
    slots: {
        id: string;
        startAt: string;
        endAt: string;
        timezone: string | null;
        resultingSessionId: string | null;
    }[];
};

type ExpertSession = {
    id: string;
    status: string;
    interviewType: string;
    preferredLanguage: string;
    scheduledFor: string;
    endsAt: string | null;
    roomId: string;
    expert: { id: string; fullName: string; avatarUrl: string | null };
    feedbackAvailable: boolean;
};

function formatDate(value: string) {
    return new Date(value).toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
    });
}

function describeApiError(err: unknown, fallback: string) {
    if (err instanceof ApiError && err.body && typeof err.body === "object") {
        const body = err.body as { message?: string; error?: string };
        return body.message || body.error || err.message;
    }
    return err instanceof Error ? err.message : fallback;
}

function canJoin(session: ExpertSession) {
    const now = Date.now();
    const start = new Date(session.scheduledFor).getTime();
    const end = session.endsAt ? new Date(session.endsAt).getTime() : start + 75 * 60_000;
    return ["CONNECTING", "ACTIVE"].includes(session.status) || (now >= start - 10 * 60_000 && now <= end + 15 * 60_000);
}

export default function ExpertRequestsPage() {
    const { session } = useAuth();
    const token = session?.access_token;
    const [activeTab, setActiveTab] = useState<"open" | "scheduled" | "past">("open");
    const [requests, setRequests] = useState<BookingRequest[]>([]);
    const [sessions, setSessions] = useState<ExpertSession[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [cancellingRequestId, setCancellingRequestId] = useState<string | null>(null);

    const loadData = useCallback(async () => {
        if (!token) return;
        setLoading(true);
        setError(null);
        try {
            const [requestRes, sessionRes] = await Promise.all([
                api.get<{ requests: BookingRequest[] }>("/experts/me/booking-requests", token),
                api.get<{ sessions: ExpertSession[] }>("/experts/me/sessions", token),
            ]);
            setRequests(requestRes.requests);
            setSessions(sessionRes.sessions);
        } catch (err) {
            setError(describeApiError(err, "Failed to load expert interview requests"));
        } finally {
            setLoading(false);
        }
    }, [token]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const openRequests = useMemo(() => requests.filter((item) => item.status === "open"), [requests]);
    const scheduledSessions = useMemo(() => sessions.filter((item) => !["COMPLETED", "CANCELLED", "ABANDONED"].includes(item.status)), [sessions]);
    const pastSessions = useMemo(() => sessions.filter((item) => ["COMPLETED", "CANCELLED", "ABANDONED"].includes(item.status)), [sessions]);

    async function cancelRequest(requestId: string) {
        if (!token) return;
        setCancellingRequestId(requestId);
        setError(null);
        setNotice(null);
        try {
            await api.post(`/experts/booking-requests/${requestId}/cancel`, {}, token);
            setNotice("Request cancelled.");
            await loadData();
        } catch (err) {
            setError(describeApiError(err, "Failed to cancel request"));
        } finally {
            setCancellingRequestId(null);
        }
    }

    return (
        <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-lc-border dark:bg-lc-surface">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-600">Expert interviews</p>
                        <h1 className="mt-1 text-2xl font-bold text-slate-950 dark:text-white">My expert requests</h1>
                        <p className="mt-2 text-sm text-slate-500">Track open availability, scheduled sessions, and completed interviews.</p>
                    </div>
                    <Link href="/interviews/expert" className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-slate-950 px-3 text-sm font-bold text-white">
                        <span className="material-symbols-outlined text-[18px]">add</span>
                        New request
                    </Link>
                </div>
                {notice && <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">{notice}</p>}
                {error && <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p>}
            </section>

            <div className="rounded-lg border border-slate-200 bg-white p-2 shadow-sm dark:border-lc-border dark:bg-lc-surface">
                <div className="grid grid-cols-3 gap-2">
                    {[
                        ["open", `Open (${openRequests.length})`],
                        ["scheduled", `Scheduled (${scheduledSessions.length})`],
                        ["past", `Past (${pastSessions.length})`],
                    ].map(([key, label]) => (
                        <button key={key} onClick={() => setActiveTab(key as "open" | "scheduled" | "past")} className={`h-11 rounded-lg text-sm font-bold ${activeTab === key ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-lc-hover"}`}>
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            {loading && <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-500">Loading...</div>}

            {!loading && activeTab === "open" && (
                <section className="grid gap-4 lg:grid-cols-2">
                    {openRequests.length === 0 && <Empty title="No open requests" actionHref="/interviews/expert" action="Book an expert interview" />}
                    {openRequests.map((item) => (
                        <article key={item.id} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-lc-border dark:bg-lc-surface">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <h2 className="font-bold text-slate-950 dark:text-white">{item.interviewType.replace("_", " ")} · {item.level}</h2>
                                    <p className="mt-1 text-sm text-slate-500">Expires {formatDate(item.expiresAt)}</p>
                                </div>
                                <button onClick={() => cancelRequest(item.id)} disabled={cancellingRequestId === item.id} className="inline-flex h-9 items-center gap-1 rounded-lg border border-rose-200 px-3 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60">
                                    <span className="material-symbols-outlined text-[16px]">close</span>
                                    Cancel
                                </button>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-1.5">
                                {item.topicsFocus.map((topic) => <span key={topic} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600 dark:bg-lc-bg dark:text-slate-300">{topic}</span>)}
                            </div>
                            {item.notes && <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{item.notes}</p>}
                            <div className="mt-4 space-y-2">
                                {item.slots.map((slot) => (
                                    <div key={slot.id} className="rounded-lg border border-slate-200 p-3 text-sm text-slate-600 dark:border-lc-border dark:text-slate-300">
                                        {formatDate(slot.startAt)} - {new Date(slot.endAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                                    </div>
                                ))}
                            </div>
                        </article>
                    ))}
                </section>
            )}

            {!loading && activeTab === "scheduled" && (
                <section className="grid gap-4 lg:grid-cols-2">
                    {scheduledSessions.length === 0 && <Empty title="No scheduled sessions yet" actionHref="/interviews/expert" action="Create a request" />}
                    {scheduledSessions.map((item) => (
                        <SessionCard key={item.id} session={item} />
                    ))}
                </section>
            )}

            {!loading && activeTab === "past" && (
                <section className="grid gap-4 lg:grid-cols-2">
                    {pastSessions.length === 0 && <Empty title="No past expert interviews" actionHref="/interviews/expert" action="Book your first session" />}
                    {pastSessions.map((item) => (
                        <SessionCard key={item.id} session={item} />
                    ))}
                </section>
            )}
        </main>
    );
}

function Empty({ title, actionHref, action }: { title: string; actionHref: string; action: string }) {
    return (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center dark:border-lc-border dark:bg-lc-surface">
            <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-slate-100 text-slate-500 dark:bg-lc-bg">
                <span className="material-symbols-outlined">event_busy</span>
            </div>
            <h2 className="mt-3 font-bold text-slate-950 dark:text-white">{title}</h2>
            <Link href={actionHref} className="mt-4 inline-flex h-10 items-center rounded-lg bg-slate-950 px-3 text-sm font-bold text-white">{action}</Link>
        </div>
    );
}

function SessionCard({ session }: { session: ExpertSession }) {
    return (
        <article className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-lc-border dark:bg-lc-surface">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h2 className="font-bold text-slate-950 dark:text-white">{formatDate(session.scheduledFor)}</h2>
                    <p className="mt-1 text-sm text-slate-500">With {session.expert.fullName} · {session.interviewType.replace("_", " ")} · {session.preferredLanguage}</p>
                </div>
                <span className="rounded-full border border-slate-200 px-2 py-0.5 text-xs font-bold text-slate-600 dark:border-lc-border">{session.status}</span>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
                <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600 dark:bg-lc-bg dark:text-slate-300">Join opens 10 minutes before start</div>
                <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600 dark:bg-lc-bg dark:text-slate-300">Feedback {session.feedbackAvailable ? "available" : "pending"}</div>
                <Link href={canJoin(session) ? `/interviews/expert/session/${session.id}/room` : `/interviews/expert/session/${session.id}`} className={`inline-flex items-center justify-center rounded-lg px-3 text-sm font-bold ${canJoin(session) ? "bg-emerald-600 text-white hover:bg-emerald-700" : "border border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-lc-border dark:text-slate-200"}`}>
                    {canJoin(session) ? "Join interview" : "Details"}
                </Link>
            </div>
        </article>
    );
}
