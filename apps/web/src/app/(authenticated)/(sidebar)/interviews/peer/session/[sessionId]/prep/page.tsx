"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { useAuth } from "@/context/auth-context";
import { api } from "@/lib/api";
import { usePeerSocket } from "@/hooks/use-peer-socket";

const JOIN_WINDOW_MS = 60_000;

type PrepResponse = {
    sessionId: string;
    status: string;
    scheduledFor: string | null;
    prepQuestion: {
        assignmentId: string;
        title: string;
        difficulty: string;
        category: string;
        practiceUrl: string;
    };
};

export default function PeerSessionPrepPage() {
    const { session } = useAuth();
    const params = useParams();
    const router = useRouter();
    const { markReady, match, scheduledExtension, noMatchWarning, sessionEnded, clearScheduledExtension } = usePeerSocket();

    const sessionId = params?.sessionId as string;

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [prep, setPrep] = useState<PrepResponse | null>(null);
    const [markingReady, setMarkingReady] = useState(false);
    const [nowMs, setNowMs] = useState(Date.now());

    useEffect(() => {
        if (!session?.access_token || !sessionId) {
            return;
        }

        let cancelled = false;

        api.get<PrepResponse>(`/p2p/sessions/${sessionId}/prep`, session.access_token)
            .then((data) => {
                if (!cancelled) setPrep(data);
            })
            .catch((err) => {
                if (cancelled) return;
                const message = err instanceof Error ? err.message : "Failed to load prep question";
                setError(message);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [session?.access_token, sessionId]);

    useEffect(() => {
        if (!match?.peerSessionId) {
            return;
        }

        if (match.peerSessionId !== sessionId) {
            router.replace(`/interviews/peer/session/${match.peerSessionId}/prep`);
        }
    }, [match?.peerSessionId, router, sessionId]);

    useEffect(() => {
        if (!scheduledExtension || scheduledExtension.peerSessionId !== sessionId) {
            return;
        }

        return () => {
            clearScheduledExtension();
        };
    }, [clearScheduledExtension, scheduledExtension, sessionId]);

    useEffect(() => {
        const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, []);

    const handleReady = async () => {
        setMarkingReady(true);
        markReady(sessionId);
        router.push(`/interviews/peer/session/${sessionId}`);
    };

    const scheduledAtMs = prep?.scheduledFor ? new Date(prep.scheduledFor).getTime() : null;
    const msUntilJoin = scheduledAtMs ? scheduledAtMs - nowMs : 0;
    const canJoinLobby = Boolean(
        prep &&
        (
            !scheduledAtMs ||
            msUntilJoin <= JOIN_WINDOW_MS ||
            ["MATCHED", "CONNECTING", "ACTIVE"].includes(prep.status.toUpperCase())
        )
    );
    const joinCountdown = scheduledAtMs && msUntilJoin > JOIN_WINDOW_MS
        ? Math.ceil((msUntilJoin - JOIN_WINDOW_MS) / 60_000)
        : 0;

    return (
        <div className="flex-1 overflow-auto bg-[#FAFBFC] dark:bg-lc-bg">
            <PageHeader title="Peer Session Prep" showBack backUrl="/interviews/peer" />

            <main className="max-w-4xl mx-auto p-6 space-y-6">
                {loading && (
                    <div className="bg-white dark:bg-lc-surface border border-slate-100 dark:border-lc-border rounded-2xl p-6">
                        Loading prep question...
                    </div>
                )}

                {error && (
                    <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-2xl p-6 text-red-700 dark:text-red-400">
                        {error}
                    </div>
                )}

                {prep && (
                    <>
                        {scheduledExtension?.peerSessionId === sessionId && (
                            <section className="rounded-2xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 p-4 text-sm text-amber-800 dark:text-amber-300">
                                No compatible peer joined yet. Retry {scheduledExtension.extensionAttempt} of {scheduledExtension.maxAttempts} is scheduled for {new Date(scheduledExtension.scheduledFor).toLocaleTimeString()}.
                            </section>
                        )}

                        {noMatchWarning?.peerSessionId === sessionId && (
                            <section className="rounded-2xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 p-4 text-sm text-amber-800 dark:text-amber-300">
                                {noMatchWarning.minutesUntilSlot > 0
                                    ? `We haven't found a peer yet — ${noMatchWarning.minutesUntilSlot} min to your slot. We'll keep trying through Phase 3 fallback and for 5 min after your slot. If nothing matches, the slot is cancelled and you can re-book.`
                                    : "We haven't found a peer yet. We'll keep trying for 5 more minutes — if nothing matches, the slot is cancelled and you can re-book."}
                            </section>
                        )}

                        {sessionEnded?.peerSessionId === sessionId && (
                            <section className="rounded-2xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 p-4 text-sm text-red-700 dark:text-red-400 flex flex-col gap-3">
                                <div>This slot has ended: {sessionEnded.reason.replaceAll("_", " ")}.</div>
                                <button
                                    onClick={() => router.push("/interviews/peer")}
                                    className="w-fit px-4 py-2 rounded-lg bg-slate-900 text-white"
                                >
                                    Return to Peer Lobby
                                </button>
                            </section>
                        )}

                        <section className="bg-white dark:bg-lc-surface border border-slate-100 dark:border-lc-border rounded-2xl p-6 space-y-4">
                            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                                <div>
                                    <h1 className="font-nunito text-2xl font-bold text-slate-900 dark:text-white">Your prep question</h1>
                                    <p className="text-sm text-slate-500 mt-1">
                                        Practice this before your slot. Your peer is hidden until the live room starts.
                                    </p>
                                </div>
                                <div className="rounded-xl border border-slate-200 dark:border-lc-border px-4 py-3 min-w-[190px]">
                                    <div className="text-xs text-slate-500">Interview slot</div>
                                    <div className="font-bold text-slate-900 dark:text-white">
                                        {prep.scheduledFor ? new Date(prep.scheduledFor).toLocaleString(undefined, {
                                            weekday: "short",
                                            hour: "numeric",
                                            minute: "2-digit",
                                            month: "short",
                                            day: "numeric",
                                        }) : "Instant"}
                                    </div>
                                    <div className="text-xs text-slate-500">
                                        {canJoinLobby ? "Lobby window open" : `Lobby opens in ${joinCountdown}m`}
                                    </div>
                                </div>
                            </div>

                            <div className="rounded-xl bg-slate-50 dark:bg-lc-bg border border-slate-200 dark:border-lc-border p-4">
                                <div className="text-slate-900 dark:text-white font-semibold">{prep.prepQuestion.title}</div>
                                <div className="text-sm text-slate-500">
                                    Difficulty: {prep.prepQuestion.difficulty} · Topic: {prep.prepQuestion.category}
                                </div>
                            </div>

                            <div className="flex flex-wrap gap-3 pt-1">
                                <Link
                                    href={prep.prepQuestion.practiceUrl}
                                    className="inline-flex px-4 py-2 rounded-lg border border-primary text-primary font-medium"
                                >
                                    Open Practice Question
                                </Link>
                                <Link
                                    href="/interviews/peer"
                                    className="inline-flex px-4 py-2 rounded-lg border border-slate-300 dark:border-lc-border font-medium"
                                >
                                    Back to Schedule
                                </Link>
                            </div>
                        </section>

                        <section className="bg-white dark:bg-lc-surface border border-slate-100 dark:border-lc-border rounded-2xl p-6 space-y-3">
                            <h2 className="font-semibold text-slate-900 dark:text-white">Join lobby</h2>
                            <p className="text-sm text-slate-500">
                                Join in the final minute. If your peer does not arrive, we hold you in the lobby through the 5-minute post-slot grace; if no match completes by then, the slot is cancelled and you can re-book.
                            </p>
                            <button
                                onClick={handleReady}
                                disabled={markingReady || !canJoinLobby}
                                className="px-4 py-2 rounded-lg bg-slate-900 text-white disabled:opacity-60"
                            >
                                {markingReady ? "Opening lobby..." : canJoinLobby ? "Join lobby" : `Lobby opens in ${joinCountdown}m`}
                            </button>
                        </section>
                    </>
                )}
            </main>
        </div>
    );
}
