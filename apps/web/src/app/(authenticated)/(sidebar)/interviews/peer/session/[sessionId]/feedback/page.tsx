"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import { api } from "@/lib/api";

const ENDED_SESSION_STATUSES = new Set(["COMPLETED", "ABANDONED", "CANCELLED"]);

const STAR_LABELS = {
    problemSolving: ["Weak. Struggled to make progress", "Below average. Needed a lot of help", "Okay. Got there with some hints", "Strong. Reached an optimal solution", "Very strong. Optimal with no hints"],
    codeQuality: ["Weak. Hard to follow", "Below average. Quite messy", "Okay. Could be made more readable or reusable", "Strong. Clean and readable", "Very strong. Production quality"],
    communication: ["Weak. Hard to follow their thinking", "Below average. Often unclear", "Okay. Mostly clear", "Strong. Clear and structured", "Very strong. Every single bit was crystal clear"],
    interviewing: ["Weak interviewer", "Below average interviewer", "Okay interviewer", "Strong interviewer", "Excellent interviewer"],
    match: ["Poor match", "Weak match", "Okay match", "Good. Decent match", "Great. Perfect match"],
    challenge: ["Far too easy", "A little easy", "Just right", "Difficult. Really had to think about it", "Brutal. Extremely hard"],
} as const;

type SessionSnapshot = {
    sessionId: string;
    status: string;
    startedAt: string | null;
    interviewType: string;
    timing: { label: string; totalMinutes: number };
};

function StarRating({
    value,
    onChange,
    labels,
}: {
    value: number;
    onChange: (next: number) => void;
    labels?: readonly string[];
}) {
    const [hover, setHover] = useState(0);
    const active = hover || value;

    return (
        <div className="flex items-center gap-3">
            <div className="flex items-center" onMouseLeave={() => setHover(0)}>
                {[1, 2, 3, 4, 5].map((star) => (
                    <button
                        key={star}
                        type="button"
                        onMouseEnter={() => setHover(star)}
                        onClick={() => onChange(star)}
                        className="p-0.5"
                        aria-label={`${star} star${star > 1 ? "s" : ""}`}
                    >
                        <span className={`material-symbols-outlined text-[28px] ${star <= active ? "text-amber-400" : "text-slate-300 dark:text-slate-600"}`} style={{ fontVariationSettings: star <= active ? "'FILL' 1" : "'FILL' 0" }}>
                            star
                        </span>
                    </button>
                ))}
            </div>
            {active > 0 && labels && (
                <span className="rounded-md bg-slate-800 text-white px-3 py-1.5 text-sm font-bold">{labels[active - 1]}</span>
            )}
        </div>
    );
}

function YesNo({ value, onChange }: { value: boolean | null; onChange: (next: boolean) => void }) {
    return (
        <div className="flex items-center gap-3">
            {[true, false].map((option) => (
                <button
                    key={String(option)}
                    type="button"
                    onClick={() => onChange(option)}
                    className={`min-w-[110px] px-5 py-3 rounded-xl border-2 font-bold transition-colors ${
                        value === option
                            ? "border-primary text-primary"
                            : "border-slate-200 dark:border-lc-border text-slate-700 dark:text-slate-200 hover:border-slate-300"
                    }`}
                >
                    {option ? "Yes" : "No"}
                </button>
            ))}
        </div>
    );
}

export default function PeerSessionFeedbackPage() {
    const { session } = useAuth();
    const params = useParams();
    const router = useRouter();
    const sessionId = params?.sessionId as string;

    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [formError, setFormError] = useState<string | null>(null);
    const [data, setData] = useState<SessionSnapshot | null>(null);

    // Did this session happen?
    const [didHappen, setDidHappen] = useState<boolean | null>(null);

    // Partner feedback (shared).
    const [solvedQuestion, setSolvedQuestion] = useState<boolean | null>(null);
    const [problemSolving, setProblemSolving] = useState(0);
    const [codeQuality, setCodeQuality] = useState(0);
    const [communication, setCommunication] = useState(0);
    const [interviewing, setInterviewing] = useState(0);
    const [whatWentWell, setWhatWentWell] = useState("");
    const [improvementAreas, setImprovementAreas] = useState("");

    // Feedback for Mockr (not shared).
    const [matchQuality, setMatchQuality] = useState(0);
    const [challenge, setChallenge] = useState(0);
    const [anythingElse, setAnythingElse] = useState("");
    const [nps, setNps] = useState<number | null>(null);
    const [avIssues, setAvIssues] = useState<boolean | null>(null);
    const [editorIssues, setEditorIssues] = useState<boolean | null>(null);
    const [additionalFeedback, setAdditionalFeedback] = useState("");

    useEffect(() => {
        if (!session?.access_token || !sessionId) return;

        let cancelled = false;
        setLoading(true);
        setError(null);

        api.get<SessionSnapshot>(`/p2p/sessions/${sessionId}`, session.access_token)
            .then((response) => {
                if (!cancelled) setData(response);
            })
            .catch((err) => {
                if (!cancelled) setError(err instanceof Error ? err.message : "Unable to load session details");
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [session?.access_token, sessionId]);

    const sessionHasEnded = useMemo(() => {
        const status = data?.status?.toUpperCase() || "";
        return status === "COMPLETED" || (ENDED_SESSION_STATUSES.has(status) && Boolean(data?.startedAt));
    }, [data?.startedAt, data?.status]);

    const canSubmit =
        didHappen === false ||
        (didHappen === true &&
            solvedQuestion !== null &&
            problemSolving > 0 &&
            codeQuality > 0 &&
            communication > 0 &&
            interviewing > 0 &&
            whatWentWell.trim().length > 0 &&
            improvementAreas.trim().length > 0);

    useEffect(() => {
        if (canSubmit) setFormError(null);
    }, [canSubmit]);

    const handleSubmitFeedback = async () => {
        if (!session?.access_token || !sessionId) return;

        // Surface why the form can't be submitted instead of silently no-op'ing.
        if (!canSubmit) {
            if (didHappen === null) {
                setFormError("Please let us know whether this session happened.");
            } else {
                setFormError("Please complete every required field (marked *) before submitting.");
            }
            return;
        }
        setFormError(null);

        if (didHappen === false) {
            setSubmitting(true);
            setError(null);
            try {
                await api.post(`/p2p/sessions/${sessionId}/feedback`, { sessionHappened: false }, session.access_token);
            } catch {
                // Best-effort; redirect regardless so the session leaves pending list
            } finally {
                setSubmitting(false);
            }
            router.push("/interviews/peer");
            return;
        }

        setSubmitting(true);
        setError(null);

        try {
            const overallRating = Math.min(5, Math.max(1, Math.round((problemSolving + codeQuality + communication + interviewing) / 4)));
            await api.post(
                `/p2p/sessions/${sessionId}/feedback`,
                {
                    problemSolving,
                    communication,
                    codeQuality,
                    interviewing,
                    overallRating,
                    solvedQuestion: solvedQuestion ?? undefined,
                    wouldMatchAgain: matchQuality >= 3,
                    whatWentWell,
                    improvementAreas,
                },
                session.access_token
            );
            setSubmitted(true);
        } catch (err) {
            setFormError(err instanceof Error ? err.message : "Failed to submit feedback");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="flex-1 overflow-auto bg-[#F7F8F7] dark:bg-lc-bg">
            <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10 space-y-6">
                <div className="text-center space-y-2">
                    <h1 className="text-3xl sm:text-4xl font-black text-slate-950 dark:text-white">How did your interview today go?</h1>
                    <p className="text-slate-500 dark:text-slate-300">Help your partner improve by providing genuine feedback. Your partner will do the same for you.</p>
                </div>

                {loading && (
                    <div className="flex items-center justify-center py-20">
                        <div className="size-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                    </div>
                )}

                {error && (
                    <section className="rounded-2xl border border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-500/10 px-6 py-4 text-sm text-red-700 dark:text-red-300">
                        {error}
                    </section>
                )}

                {!loading && data && !sessionHasEnded && (
                    <section className="rounded-2xl border border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/10 px-6 py-5 space-y-3">
                        <p className="text-sm text-amber-800 dark:text-amber-300">Feedback unlocks once the interview ends for both participants. Current status: {data.status}</p>
                        <div className="flex flex-wrap gap-2">
                            <button onClick={() => router.push(`/interviews/peer/session/${sessionId}`)} className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold">Back to live session</button>
                            <Link href="/interviews/peer" className="px-4 py-2 rounded-lg border border-slate-300 dark:border-lc-border text-sm font-semibold text-slate-700 dark:text-slate-100">Back to peer lobby</Link>
                        </div>
                    </section>
                )}

                {!loading && data && sessionHasEnded && submitted && (
                    <section className="rounded-2xl border border-slate-200 dark:border-lc-border bg-white dark:bg-lc-surface px-6 py-6 space-y-4 text-center">
                        <div className="mx-auto size-14 rounded-full bg-emerald-100 dark:bg-emerald-500/15 flex items-center justify-center">
                            <span className="material-symbols-outlined text-emerald-600 dark:text-emerald-400 text-3xl">check</span>
                        </div>
                        <p className="text-slate-700 dark:text-slate-200 font-semibold">Thanks! Your feedback was submitted and your peer rating has been updated.</p>
                        <Link href={`/interviews/peer/session/${sessionId}/report`} className="inline-flex px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold">Go to report</Link>
                    </section>
                )}

                {!loading && data && sessionHasEnded && !submitted && (
                    <section className="rounded-2xl border border-slate-200 dark:border-lc-border bg-white dark:bg-lc-surface px-6 sm:px-8 py-7 space-y-7">
                        <div className="space-y-3">
                            <label className="block font-semibold text-slate-800 dark:text-slate-100">Did this session happen? <span className="text-red-500">*</span></label>
                            <YesNo value={didHappen} onChange={setDidHappen} />
                        </div>

                        {didHappen === true && (
                            <>
                                <div className="text-center space-y-1 pt-2">
                                    <h2 className="text-2xl font-black text-slate-950 dark:text-white">Partner feedback</h2>
                                    <p className="text-sm text-slate-500">These questions will be shared with your partner so they can improve</p>
                                </div>

                                <div className="space-y-2">
                                    <label className="block font-semibold text-slate-800 dark:text-slate-100">Was your partner able to solve the question? <span className="text-red-500">*</span></label>
                                    <YesNo value={solvedQuestion} onChange={setSolvedQuestion} />
                                </div>
                                <div className="space-y-2">
                                    <label className="block font-semibold text-slate-800 dark:text-slate-100">How were your partner&apos;s problem solving skills? <span className="text-red-500">*</span></label>
                                    <StarRating value={problemSolving} onChange={setProblemSolving} labels={STAR_LABELS.problemSolving} />
                                </div>
                                <div className="space-y-2">
                                    <label className="block font-semibold text-slate-800 dark:text-slate-100">How were your partner&apos;s coding skills? <span className="text-red-500">*</span></label>
                                    <StarRating value={codeQuality} onChange={setCodeQuality} labels={STAR_LABELS.codeQuality} />
                                </div>
                                <div className="space-y-2">
                                    <label className="block font-semibold text-slate-800 dark:text-slate-100">How were your partner&apos;s communication skills? <span className="text-red-500">*</span></label>
                                    <StarRating value={communication} onChange={setCommunication} labels={STAR_LABELS.communication} />
                                </div>

                                <div className="space-y-2">
                                    <label className="block font-semibold text-slate-800 dark:text-slate-100">What did your partner do well during the session? <span className="text-red-500">*</span></label>
                                    <textarea value={whatWentWell} onChange={(e) => setWhatWentWell(e.target.value)} placeholder="What are your partner's strengths? What impressed you?" className="w-full rounded-xl border border-slate-300 dark:border-lc-border px-4 py-3 min-h-[120px] bg-white dark:bg-lc-bg" />
                                </div>
                                <div className="space-y-2">
                                    <label className="block font-semibold text-slate-800 dark:text-slate-100">What could your partner improve? <span className="text-red-500">*</span></label>
                                    <textarea value={improvementAreas} onChange={(e) => setImprovementAreas(e.target.value)} placeholder="What should your partner improve? How would you advise them to get better?" className="w-full rounded-xl border border-slate-300 dark:border-lc-border px-4 py-3 min-h-[120px] bg-white dark:bg-lc-bg" />
                                </div>
                                <div className="space-y-2">
                                    <label className="block font-semibold text-slate-800 dark:text-slate-100">How did your partner perform as your interviewer? <span className="text-red-500">*</span></label>
                                    <StarRating value={interviewing} onChange={setInterviewing} labels={STAR_LABELS.interviewing} />
                                </div>

                                <div className="text-center space-y-1 pt-4 border-t border-slate-200 dark:border-lc-border">
                                    <h2 className="text-2xl font-black text-slate-950 dark:text-white pt-4">Feedback for Mockr</h2>
                                    <p className="text-sm text-slate-500">This section is not shared with your partner</p>
                                </div>

                                <div className="space-y-2">
                                    <label className="block font-semibold text-slate-800 dark:text-slate-100">How good a match was your partner for the purpose of this session?</label>
                                    <StarRating value={matchQuality} onChange={setMatchQuality} labels={STAR_LABELS.match} />
                                </div>
                                <div className="space-y-2">
                                    <label className="block font-semibold text-slate-800 dark:text-slate-100">How challenging were the question(s) you were asked?</label>
                                    <StarRating value={challenge} onChange={setChallenge} labels={STAR_LABELS.challenge} />
                                    <textarea value={anythingElse} onChange={(e) => setAnythingElse(e.target.value)} placeholder="Anything else we should know (e.g. have you seen it before, did you like it)?" className="mt-2 w-full rounded-xl border border-slate-300 dark:border-lc-border px-4 py-3 min-h-[90px] bg-white dark:bg-lc-bg" />
                                </div>

                                <div className="space-y-2">
                                    <label className="block font-semibold text-slate-800 dark:text-slate-100">Based on today&apos;s session, how likely are you to recommend Mockr&apos; peer mock interviews to a friend?</label>
                                    <div className="flex flex-wrap gap-2">
                                        {Array.from({ length: 11 }, (_, n) => (
                                            <button
                                                key={n}
                                                type="button"
                                                onClick={() => setNps(n)}
                                                className={`size-11 rounded-lg border font-bold transition-colors ${
                                                    nps === n ? "border-primary text-primary" : "border-slate-200 dark:border-lc-border text-slate-700 dark:text-slate-200 hover:border-slate-300"
                                                }`}
                                            >
                                                {n}
                                            </button>
                                        ))}
                                    </div>
                                    <div className="flex justify-between text-xs text-slate-500 pt-1">
                                        <span>Not at all likely</span>
                                        <span>Extremely likely</span>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <label className="block font-semibold text-slate-800 dark:text-slate-100">Did you experience any audio or video issues during today&apos;s session?</label>
                                    <YesNo value={avIssues} onChange={setAvIssues} />
                                </div>
                                <div className="space-y-2">
                                    <label className="block font-semibold text-slate-800 dark:text-slate-100">Did you experience any issues with the code editor during today&apos;s session?</label>
                                    <YesNo value={editorIssues} onChange={setEditorIssues} />
                                </div>
                                <div className="space-y-2">
                                    <label className="block font-semibold text-slate-800 dark:text-slate-100">Any additional feedback for Mockr?</label>
                                    <textarea value={additionalFeedback} onChange={(e) => setAdditionalFeedback(e.target.value)} placeholder="What issues did you encounter? How can we improve?" className="w-full rounded-xl border border-slate-300 dark:border-lc-border px-4 py-3 min-h-[90px] bg-white dark:bg-lc-bg" />
                                </div>
                            </>
                        )}

                        <div className="space-y-3">
                            {formError && (
                                <p className="text-sm font-semibold text-red-600 dark:text-red-400 text-center">{formError}</p>
                            )}
                            <button
                                onClick={handleSubmitFeedback}
                                disabled={submitting}
                                aria-disabled={!canSubmit}
                                className={`w-full px-5 py-4 rounded-xl text-white font-bold text-lg transition-colors ${
                                    submitting
                                        ? "bg-blue-600 opacity-60 cursor-wait"
                                        : canSubmit
                                            ? "bg-blue-600 hover:bg-blue-700"
                                            : "bg-blue-600/60 hover:bg-blue-600/70 cursor-pointer"
                                }`}
                            >
                                {submitting ? "Submitting…" : "Submit"}
                            </button>
                        </div>
                    </section>
                )}
            </main>
        </div>
    );
}
