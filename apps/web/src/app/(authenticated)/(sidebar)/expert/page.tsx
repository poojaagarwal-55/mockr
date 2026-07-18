"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import { useBilling } from "@/hooks/use-billing";
import { api, ApiError } from "@/lib/api";

type ExpertProfile = {
    bio: string | null;
    expertiseTags: string[];
    yearsExperience: number | null;
    acceptingBookings: boolean;
    ratingAvg: number | null;
    sessionsCompleted: number;
};

type InboxRequest = {
    id: string;
    interviewType: string;
    preferredLanguage: string;
    level: string;
    topicsFocus: string[];
    notes: string | null;
    createdAt: string;
    expiresAt: string;
    candidate: { id: string; fullName: string; avatarUrl: string | null };
    slots: { id: string; startAt: string; endAt: string; timezone: string | null }[];
};

type ExpertSession = {
    id: string;
    status: string;
    interviewType: string;
    preferredLanguage: string;
    scheduledFor: string;
    endsAt: string | null;
    roomId: string;
    candidate: { id: string; fullName: string; avatarUrl: string | null };
    feedbackSubmitted: boolean;
    questionCount: number;
};

const EXPERT_INTERVIEW_DURATION_MINUTES = 60;
const EXPERT_SLOT_LEAD_MINUTES = 1;

function formatDate(value: string) {
    return new Date(value).toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
    });
}

function toLocalInputValue(value: string | Date) {
    const date = typeof value === "string" ? new Date(value) : value;
    const pad = (part: number) => String(part).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function roundUpToMinute(date: Date) {
    const next = new Date(date);
    if (next.getSeconds() > 0 || next.getMilliseconds() > 0) next.setMinutes(next.getMinutes() + 1);
    next.setSeconds(0, 0);
    return next;
}

function exactStartBounds(slotStartAt: string, slotEndAt: string) {
    const candidateStart = new Date(slotStartAt);
    const latestStart = new Date(new Date(slotEndAt).getTime() - EXPERT_INTERVIEW_DURATION_MINUTES * 60_000);
    const leadTimeStart = roundUpToMinute(new Date(Date.now() + EXPERT_SLOT_LEAD_MINUTES * 60_000));
    const firstStart = candidateStart > leadTimeStart ? candidateStart : leadTimeStart;
    return {
        min: toLocalInputValue(firstStart),
        max: toLocalInputValue(latestStart),
        defaultValue: toLocalInputValue(firstStart),
        hasValidStart: firstStart.getTime() <= latestStart.getTime(),
    };
}

function canJoin(session: ExpertSession) {
    const now = Date.now();
    const start = new Date(session.scheduledFor).getTime();
    const end = session.endsAt ? new Date(session.endsAt).getTime() : start + 75 * 60_000;
    return session.questionCount > 0 && (["CONNECTING", "ACTIVE"].includes(session.status) || (now >= start - 10 * 60_000 && now <= end + 15 * 60_000));
}

function getErrorMessage(err: unknown, fallback: string) {
    if (err instanceof ApiError) {
        const body = err.body as { message?: string; error?: string; details?: Record<string, string[] | string> } | undefined;
        const detailText = body?.details ? Object.values(body.details).flat().filter(Boolean).join(" ") : "";
        return [body?.message, detailText, body?.error].filter(Boolean).join(" ") || err.message || fallback;
    }
    return err instanceof Error ? err.message : fallback;
}

function NotExpert() {
    const router = useRouter();
    useEffect(() => {
        const timer = setTimeout(() => router.replace("/dashboard"), 2200);
        return () => clearTimeout(timer);
    }, [router]);
    return (
        <main className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-600">
                <span className="material-symbols-outlined text-3xl">workspace_premium</span>
            </div>
            <h1 className="text-xl font-bold text-slate-950 dark:text-white">Expert workspace unavailable</h1>
            <p className="mt-2 text-sm text-slate-500">Ask an admin to assign expert access to your account.</p>
        </main>
    );
}

export default function ExpertWorkspacePage() {
    const router = useRouter();
    const { session } = useAuth();
    const { snapshot, loading: billingLoading } = useBilling();
    const token = session?.access_token;
    const [profile, setProfile] = useState<ExpertProfile | null>(null);
    const [inbox, setInbox] = useState<InboxRequest[]>([]);
    const [sessions, setSessions] = useState<ExpertSession[]>([]);
    const [activeTab, setActiveTab] = useState<"requests" | "upcoming" | "feedback" | "history">("requests");
    const [exactStartBySlot, setExactStartBySlot] = useState<Record<string, string>>({});
    const [confirmSlot, setConfirmSlot] = useState<{ slot: InboxRequest["slots"][number]; request: InboxRequest; exactStart: string } | null>(null);
    const [claimingSlot, setClaimingSlot] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    const upcoming = useMemo(() => sessions.filter((item) => !["COMPLETED", "CANCELLED", "ABANDONED"].includes(item.status)), [sessions]);
    const past = useMemo(() => sessions.filter((item) => ["COMPLETED", "CANCELLED", "ABANDONED"].includes(item.status)), [sessions]);
    const feedbackDue = useMemo(() => past.filter((item) => !item.feedbackSubmitted), [past]);

    const loadExpert = useCallback(async () => {
        if (!token || !snapshot?.isExpert) return;
        setLoading(true);
        setError(null);
        try {
            const [profileRes, inboxRes, sessionsRes] = await Promise.all([
                api.get<ExpertProfile>("/experts/profile", token),
                api.get<{ requests: InboxRequest[] }>("/experts/inbox", token),
                api.get<{ sessions: ExpertSession[] }>("/experts/me/expert-sessions", token),
            ]);
            setProfile(profileRes);
            setInbox(inboxRes.requests);
            setSessions(sessionsRes.sessions);
        } catch (err) {
            setError(getErrorMessage(err, "Failed to load expert workspace"));
        } finally {
            setLoading(false);
        }
    }, [token, snapshot?.isExpert]);

    useEffect(() => {
        loadExpert();
    }, [loadExpert]);

    async function claimSlot() {
        if (!token || !confirmSlot) return;
        setClaimingSlot(confirmSlot.slot.id);
        setError(null);
        setNotice(null);
        try {
            const result = await api.post<{ sessionId: string; scheduledFor: string }>(
                `/experts/slots/${confirmSlot.slot.id}/claim`,
                {
                    exactStartAt: new Date(confirmSlot.exactStart).toISOString(),
                    durationMinutes: EXPERT_INTERVIEW_DURATION_MINUTES,
                },
                token
            );
            setNotice(`Session scheduled for ${formatDate(result.scheduledFor)}.`);
            setConfirmSlot(null);
            await loadExpert();
            router.push(`/expert/sessions/${result.sessionId}/prepare`);
        } catch (err) {
            setError(getErrorMessage(err, "Failed to claim slot"));
        } finally {
            setClaimingSlot(null);
        }
    }

    if (!billingLoading && !snapshot?.isExpert) return <NotExpert />;

    return (
        <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
            <section className="rounded-lg border border-slate-200 bg-slate-950 p-5 text-white shadow-sm dark:border-lc-border">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-300">Expert console</p>
                        <h1 className="mt-1 text-2xl font-bold">Interview command center</h1>
                        <p className="mt-2 max-w-2xl text-sm text-slate-300">Claim requests, prepare questions, join interviews, and close the loop with feedback.</p>
                    </div>
                    <Link href="/expert/history" className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-white/20 px-3 text-sm font-bold text-white hover:bg-white/10">
                        <span className="material-symbols-outlined text-[18px]">history</span>
                        Full history
                    </Link>
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-4">
                    <Metric label="Open requests" value={inbox.length} />
                    <Metric label="Upcoming" value={upcoming.length} />
                    <Metric label="Feedback due" value={feedbackDue.length} />
                    <Metric label="Completed" value={profile?.sessionsCompleted ?? past.length} />
                </div>
            </section>

            {error && <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</p>}
            {notice && <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">{notice}</p>}

            <div className="rounded-lg border border-slate-200 bg-white p-2 shadow-sm dark:border-lc-border dark:bg-lc-surface">
                <div className="grid gap-2 sm:grid-cols-4">
                    {[
                        ["requests", `Requests (${inbox.length})`],
                        ["upcoming", `Upcoming (${upcoming.length})`],
                        ["feedback", `Feedback Due (${feedbackDue.length})`],
                        ["history", `History (${past.length})`],
                    ].map(([key, label]) => (
                        <button key={key} onClick={() => setActiveTab(key as typeof activeTab)} className={`h-11 rounded-lg text-sm font-bold ${activeTab === key ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-lc-hover"}`}>
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            {loading && <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-500">Loading workspace...</div>}

            {!loading && activeTab === "requests" && (
                <section className="grid gap-4">
                    {inbox.length === 0 && <Empty title="No open candidate requests" />}
                    {inbox.map((request) => (
                        <article key={request.id} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-lc-border dark:bg-lc-surface">
                            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                <div>
                                    <h2 className="font-bold text-slate-950 dark:text-white">{request.candidate.fullName}</h2>
                                    <p className="mt-1 text-sm text-slate-500">{request.interviewType.replace("_", " ")} · {request.level} · {request.preferredLanguage}</p>
                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                        {request.topicsFocus.map((topic) => <span key={topic} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600 dark:bg-lc-bg dark:text-slate-300">{topic}</span>)}
                                    </div>
                                    {request.notes && <p className="mt-3 max-w-3xl text-sm text-slate-600 dark:text-slate-300">{request.notes}</p>}
                                </div>
                                <span className="rounded-full border border-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600 dark:border-lc-border">Expires {formatDate(request.expiresAt)}</span>
                            </div>
                            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                                {request.slots.map((slot) => {
                                    const bounds = exactStartBounds(slot.startAt, slot.endAt);
                                    const selectedStart = exactStartBySlot[slot.id] || bounds.defaultValue;
                                    return (
                                        <div key={slot.id} className="rounded-lg border border-slate-200 p-3 text-sm dark:border-lc-border">
                                            <div className="font-bold text-slate-950 dark:text-white">{formatDate(slot.startAt)}</div>
                                            <div className="mt-1 text-xs text-slate-500">available until {new Date(slot.endAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</div>
                                            <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                                                Exact start
                                                <input type="datetime-local" value={selectedStart} min={bounds.min} max={bounds.max} step={60} disabled={!bounds.hasValidStart} onChange={(event) => setExactStartBySlot((current) => ({ ...current, [slot.id]: event.target.value }))} className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm normal-case tracking-normal outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 dark:border-lc-border dark:bg-lc-bg dark:text-white" />
                                            </label>
                                            <button onClick={() => setConfirmSlot({ slot, request, exactStart: selectedStart })} disabled={!!claimingSlot || !bounds.hasValidStart} className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60">
                                                <span className="material-symbols-outlined text-[18px]">event_available</span>
                                                Claim time
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        </article>
                    ))}
                </section>
            )}

            {!loading && activeTab === "upcoming" && <SessionGrid sessions={upcoming} empty="No upcoming sessions." />}
            {!loading && activeTab === "feedback" && <SessionGrid sessions={feedbackDue} empty="No feedback due." forceFeedback />}
            {!loading && activeTab === "history" && <SessionGrid sessions={past} empty="No completed interviews yet." />}

            {confirmSlot && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
                    <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl dark:bg-lc-surface">
                        <h2 className="text-lg font-bold text-slate-950 dark:text-white">Confirm interview time</h2>
                        <p className="mt-2 text-sm text-slate-500">Schedule {confirmSlot.request.candidate.fullName} for {formatDate(confirmSlot.exactStart)}.</p>
                        <div className="mt-5 flex justify-end gap-2">
                            <button onClick={() => setConfirmSlot(null)} className="h-10 rounded-lg border border-slate-200 px-3 text-sm font-semibold dark:border-lc-border">Cancel</button>
                            <button onClick={claimSlot} disabled={claimingSlot === confirmSlot.slot.id} className="h-10 rounded-lg bg-emerald-600 px-3 text-sm font-bold text-white disabled:opacity-60">
                                {claimingSlot === confirmSlot.slot.id ? "Scheduling..." : "Confirm and prepare"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </main>
    );
}

function Metric({ label, value }: { label: string; value: number }) {
    return (
        <div className="rounded-lg border border-white/15 px-4 py-3">
            <div className="text-2xl font-bold">{value}</div>
            <div className="text-xs text-slate-300">{label}</div>
        </div>
    );
}

function Empty({ title }: { title: string }) {
    return <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500 dark:border-lc-border dark:bg-lc-surface">{title}</div>;
}

function SessionGrid({ sessions, empty, forceFeedback = false }: { sessions: ExpertSession[]; empty: string; forceFeedback?: boolean }) {
    if (sessions.length === 0) return <Empty title={empty} />;
    return (
        <section className="grid gap-4 lg:grid-cols-2">
            {sessions.map((item) => {
                const actionHref = forceFeedback
                    ? `/expert/sessions/${item.id}`
                    : canJoin(item)
                        ? `/interviews/expert/session/${item.id}/room`
                        : item.questionCount === 0
                            ? `/expert/sessions/${item.id}/prepare`
                            : `/expert/sessions/${item.id}`;
                const actionLabel = forceFeedback
                    ? "Give feedback"
                    : canJoin(item)
                        ? "Join"
                        : item.questionCount === 0
                            ? "Prepare"
                            : "Details";
                return (
                    <article key={item.id} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-lc-border dark:bg-lc-surface">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <h2 className="font-bold text-slate-950 dark:text-white">{item.candidate.fullName}</h2>
                                <p className="mt-1 text-sm text-slate-500">{formatDate(item.scheduledFor)} · {item.preferredLanguage}</p>
                            </div>
                            <span className="rounded-full border border-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600 dark:border-lc-border">{item.status}</span>
                        </div>
                        <div className="mt-4 grid gap-2 sm:grid-cols-3">
                            <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600 dark:bg-lc-bg dark:text-slate-300">{item.questionCount} questions selected</div>
                            <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600 dark:bg-lc-bg dark:text-slate-300">Feedback {item.feedbackSubmitted ? "submitted" : "pending"}</div>
                            <Link href={actionHref} className="inline-flex items-center justify-center rounded-lg bg-slate-950 px-3 text-sm font-bold text-white">{actionLabel}</Link>
                        </div>
                    </article>
                );
            })}
        </section>
    );
}
