"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/auth-context";
import { api } from "@/lib/api";

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

function formatDate(value: string) {
    return new Date(value).toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
    });
}

export default function ExpertHistoryPage() {
    const { session } = useAuth();
    const token = session?.access_token;
    const [sessions, setSessions] = useState<ExpertSession[]>([]);
    const [status, setStatus] = useState("");
    const [type, setType] = useState("");
    const [feedback, setFeedback] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const loadSessions = useCallback(async () => {
        if (!token) return;
        setLoading(true);
        setError(null);
        try {
            const result = await api.get<{ sessions: ExpertSession[] }>("/experts/me/expert-sessions", token);
            setSessions(result.sessions);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load history");
        } finally {
            setLoading(false);
        }
    }, [token]);

    useEffect(() => {
        loadSessions();
    }, [loadSessions]);

    const filtered = useMemo(() => {
        return sessions.filter((item) => {
            if (status && item.status !== status) return false;
            if (type && item.interviewType !== type) return false;
            if (feedback === "submitted" && !item.feedbackSubmitted) return false;
            if (feedback === "pending" && item.feedbackSubmitted) return false;
            return true;
        });
    }, [feedback, sessions, status, type]);

    return (
        <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-lc-border dark:bg-lc-surface">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-600">Expert history</p>
                        <h1 className="mt-1 text-2xl font-bold text-slate-950 dark:text-white">Past interviews</h1>
                        <p className="mt-2 text-sm text-slate-500">Review sessions, feedback state, and candidate details.</p>
                    </div>
                    <Link href="/expert" className="inline-flex h-10 items-center rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-lc-border dark:text-slate-200">Back to console</Link>
                </div>
                {error && <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p>}
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-lc-border dark:bg-lc-surface">
                <div className="grid gap-3 md:grid-cols-3">
                    <select value={status} onChange={(event) => setStatus(event.target.value)} className="h-10 rounded-lg border border-slate-200 px-3 text-sm dark:border-lc-border dark:bg-lc-bg">
                        <option value="">Any status</option>
                        {["SCHEDULED", "ACTIVE", "COMPLETED", "CANCELLED", "ABANDONED"].map((item) => <option key={item} value={item}>{item}</option>)}
                    </select>
                    <select value={type} onChange={(event) => setType(event.target.value)} className="h-10 rounded-lg border border-slate-200 px-3 text-sm dark:border-lc-border dark:bg-lc-bg">
                        <option value="">Any type</option>
                        {["coding", "system_design", "behavioural"].map((item) => <option key={item} value={item}>{item.replace("_", " ")}</option>)}
                    </select>
                    <select value={feedback} onChange={(event) => setFeedback(event.target.value)} className="h-10 rounded-lg border border-slate-200 px-3 text-sm dark:border-lc-border dark:bg-lc-bg">
                        <option value="">Any feedback</option>
                        <option value="submitted">Feedback submitted</option>
                        <option value="pending">Feedback pending</option>
                    </select>
                </div>
            </section>

            <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-lc-border dark:bg-lc-surface">
                <div className="grid grid-cols-[1fr_150px_130px_140px_110px] gap-3 border-b border-slate-200 px-5 py-3 text-xs font-bold uppercase tracking-wide text-slate-500 dark:border-lc-border">
                    <span>Candidate</span>
                    <span>Date</span>
                    <span>Questions</span>
                    <span>Status</span>
                    <span>Feedback</span>
                </div>
                {loading && <div className="p-5 text-sm text-slate-500">Loading history...</div>}
                {!loading && filtered.length === 0 && <div className="p-5 text-sm text-slate-500">No interviews match these filters.</div>}
                {!loading && filtered.map((item) => (
                    <Link key={item.id} href={`/expert/sessions/${item.id}`} className="grid grid-cols-[1fr_150px_130px_140px_110px] gap-3 border-b border-slate-100 px-5 py-4 text-sm transition hover:bg-slate-50 last:border-b-0 dark:border-lc-border dark:hover:bg-lc-hover">
                        <span className="font-bold text-slate-950 dark:text-white">{item.candidate.fullName}</span>
                        <span className="text-slate-500">{formatDate(item.scheduledFor)}</span>
                        <span className="text-slate-500">{item.questionCount}</span>
                        <span><span className="rounded-full border border-slate-200 px-2 py-0.5 text-xs font-bold text-slate-600 dark:border-lc-border">{item.status}</span></span>
                        <span className={item.feedbackSubmitted ? "font-semibold text-emerald-600" : "font-semibold text-amber-600"}>{item.feedbackSubmitted ? "Shared" : "Due"}</span>
                    </Link>
                ))}
            </section>
        </main>
    );
}
