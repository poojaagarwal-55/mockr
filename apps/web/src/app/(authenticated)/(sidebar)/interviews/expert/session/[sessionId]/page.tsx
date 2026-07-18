"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import { api } from "@/lib/api";

type CandidateSessionDetail = {
    id: string;
    roomId: string;
    status: string;
    interviewType: string;
    preferredLanguage: string;
    scheduledFor: string;
    endsAt: string | null;
    candidate: { id: string; fullName: string; avatarUrl: string | null };
    expert: { id: string; fullName: string; avatarUrl: string | null };
    questions: { id: string; title: string; difficulty: string; topic: string; orderIndex: number }[];
    feedback: {
        problemSolving: number;
        communication: number;
        codeQuality: number;
        technicalDepth: number;
        overallRating: number;
        hireDecision: string;
        strengths: string | null;
        improvementAreas: string | null;
    } | null;
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

function canJoin(session: CandidateSessionDetail) {
    if (["COMPLETED", "CANCELLED", "ABANDONED"].includes(session.status)) return false;
    const now = Date.now();
    const start = new Date(session.scheduledFor).getTime();
    const end = session.endsAt ? new Date(session.endsAt).getTime() : start + 75 * 60_000;
    return ["CONNECTING", "ACTIVE"].includes(session.status) || (now >= start - 10 * 60_000 && now <= end + 15 * 60_000);
}

export default function CandidateExpertSessionPage() {
    const params = useParams<{ sessionId: string }>();
    const { session } = useAuth();
    const token = session?.access_token;
    const [detail, setDetail] = useState<CandidateSessionDetail | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const loadSession = useCallback(async () => {
        if (!token || !params.sessionId) return;
        setLoading(true);
        setError(null);
        try {
            const result = await api.get<CandidateSessionDetail>(`/experts/sessions/${params.sessionId}`, token);
            setDetail(result);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load session");
        } finally {
            setLoading(false);
        }
    }, [token, params.sessionId]);

    useEffect(() => {
        loadSession();
    }, [loadSession]);

    if (loading && !detail) return <main className="p-6 text-sm text-slate-500">Loading session...</main>;
    if (!detail) return <main className="p-6 text-sm text-rose-600">{error || "Session not found"}</main>;

    return (
        <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-lc-border dark:bg-lc-surface">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-600">Expert interview</p>
                        <h1 className="mt-1 text-2xl font-bold text-slate-950 dark:text-white">{formatDate(detail.scheduledFor)}</h1>
                        <p className="mt-2 text-sm text-slate-500">
                            Expert: {detail.expert.fullName} · {detail.interviewType} · {detail.preferredLanguage} · {detail.status}
                        </p>
                    </div>
                    {canJoin(detail) ? (
                        <Link
                            href={`/interviews/expert/session/${detail.id}/room`}
                            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-bold text-white hover:bg-emerald-700"
                        >
                            <span className="material-symbols-outlined text-[18px]">videocam</span>
                            Join interview
                        </Link>
                    ) : (
                        <button
                            disabled
                            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-slate-200 px-4 text-sm font-bold text-slate-500"
                        >
                            <span className="material-symbols-outlined text-[18px]">videocam</span>
                            Join interview
                        </button>
                    )}
                </div>
                {!canJoin(detail) && (
                    <p className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:border-lc-border dark:bg-lc-bg dark:text-slate-300">
                        The join option opens 10 minutes before your scheduled start time.
                    </p>
                )}
                {canJoin(detail) && !["COMPLETED", "CANCELLED", "ABANDONED"].includes(detail.status) && (
                    <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300">
                        You can join now. You will wait in the lobby until the expert lets you into the room.
                    </p>
                )}
            </section>

            <section className="grid gap-6 lg:grid-cols-2">
                <div className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-lc-border dark:bg-lc-surface">
                    <div className="border-b border-slate-200 px-5 py-4 dark:border-lc-border">
                        <h2 className="font-bold text-slate-950 dark:text-white">Selected questions</h2>
                    </div>
                    <div className="divide-y divide-slate-100 dark:divide-lc-border">
                        {detail.questions.length === 0 && <div className="p-5 text-sm text-slate-500">The expert has not selected questions yet.</div>}
                        {detail.questions.map((question) => (
                            <div key={question.id} className="p-5">
                                <h3 className="font-bold text-slate-950 dark:text-white">{question.title}</h3>
                                <p className="mt-1 text-sm text-slate-500">{question.difficulty} · {question.topic}</p>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-lc-border dark:bg-lc-surface">
                    <div className="border-b border-slate-200 px-5 py-4 dark:border-lc-border">
                        <h2 className="font-bold text-slate-950 dark:text-white">Feedback</h2>
                    </div>
                    {!detail.feedback ? (
                        <div className="p-5 text-sm text-slate-500">Feedback will appear here after the expert shares it.</div>
                    ) : (
                        <div className="space-y-4 p-5">
                            <div className="grid grid-cols-2 gap-3">
                                {[
                                    ["Problem solving", detail.feedback.problemSolving],
                                    ["Communication", detail.feedback.communication],
                                    ["Code quality", detail.feedback.codeQuality],
                                    ["Technical depth", detail.feedback.technicalDepth],
                                ].map(([label, value]) => (
                                    <div key={String(label)} className="rounded-lg border border-slate-200 p-3 dark:border-lc-border">
                                        <div className="text-xs text-slate-500">{label}</div>
                                        <div className="mt-1 text-lg font-bold text-slate-950 dark:text-white">{value}/5</div>
                                    </div>
                                ))}
                            </div>
                            {detail.feedback.strengths && <p className="text-sm text-slate-700 dark:text-slate-200"><strong>Strengths:</strong> {detail.feedback.strengths}</p>}
                            {detail.feedback.improvementAreas && <p className="text-sm text-slate-700 dark:text-slate-200"><strong>Improve:</strong> {detail.feedback.improvementAreas}</p>}
                        </div>
                    )}
                </div>
            </section>
        </main>
    );
}
