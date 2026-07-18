"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import { api } from "@/lib/api";

type ExpertSessionDetail = {
    id: string;
    roomId: string;
    status: string;
    interviewType: string;
    preferredLanguage: string;
    scheduledFor: string;
    endsAt: string | null;
    myRole: "expert" | "candidate";
    candidate: { id: string; fullName: string; avatarUrl: string | null };
    expert: { id: string; fullName: string; avatarUrl: string | null };
    questions: {
        id: string;
        questionId: string | null;
        title: string;
        difficulty: string;
        topic: string;
        isCustom: boolean;
        customPrompt: string | null;
        orderIndex: number;
    }[];
    feedback: {
        problemSolving: number;
        communication: number;
        codeQuality: number;
        technicalDepth: number;
        overallRating: number;
        hireDecision: string;
        strengths: string | null;
        improvementAreas: string | null;
        privateNotes?: string | null;
        sharedWithCandidate?: boolean;
    } | null;
};

type BankQuestion = {
    id: string;
    problemId: string;
    title: string;
    difficulty: string;
    topics: string[];
};

const difficultyOptions = ["Easy", "Medium", "Hard"] as const;
const topicOptions = ["", "arrays", "strings", "hash-table", "dp", "graphs", "trees", "binary-search", "two-pointers"];

function formatDate(value: string) {
    return new Date(value).toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
    });
}

function canJoin(detail: ExpertSessionDetail) {
    if (["COMPLETED", "CANCELLED", "ABANDONED"].includes(detail.status)) return false;
    const now = Date.now();
    const start = new Date(detail.scheduledFor).getTime();
    const end = detail.endsAt ? new Date(detail.endsAt).getTime() : start + 75 * 60_000;
    return detail.questions.length > 0 && (["CONNECTING", "ACTIVE"].includes(detail.status) || (now >= start - 10 * 60_000 && now <= end + 15 * 60_000));
}

function ScoreInput({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
    return (
        <label className="block">
            <div className="mb-2 flex items-center justify-between text-sm font-semibold text-slate-700 dark:text-slate-200">
                <span>{label}</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-lc-bg dark:text-slate-300">{value}/5</span>
            </div>
            <input type="range" min={1} max={5} value={value} onChange={(event) => onChange(Number(event.target.value))} className="w-full accent-emerald-600" />
        </label>
    );
}

export default function ExpertSessionConsolePage() {
    const params = useParams<{ sessionId: string }>();
    const searchParams = useSearchParams();
    const { session } = useAuth();
    const token = session?.access_token;
    const sessionId = params.sessionId;
    const feedbackRef = useRef<HTMLFormElement | null>(null);

    const [detail, setDetail] = useState<ExpertSessionDetail | null>(null);
    const [questions, setQuestions] = useState<BankQuestion[]>([]);
    const [query, setQuery] = useState("");
    const [topic, setTopic] = useState("");
    const [difficulty, setDifficulty] = useState<"" | "Easy" | "Medium" | "Hard">("");
    const [recommended, setRecommended] = useState(true);
    const [customTitle, setCustomTitle] = useState("");
    const [customPrompt, setCustomPrompt] = useState("");
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    const [feedback, setFeedback] = useState({
        problemSolving: 3,
        communication: 3,
        codeQuality: 3,
        technicalDepth: 3,
        overallRating: 3,
        hireDecision: "lean_yes",
        strengths: "",
        improvementAreas: "",
        privateNotes: "",
        sharedWithCandidate: true,
    });

    const loadSession = useCallback(async () => {
        if (!token || !sessionId) return;
        setLoading(true);
        setError(null);
        try {
            const result = await api.get<ExpertSessionDetail>(`/experts/sessions/${sessionId}`, token);
            setDetail(result);
            if (result.feedback) {
                setFeedback({
                    problemSolving: result.feedback.problemSolving,
                    communication: result.feedback.communication,
                    codeQuality: result.feedback.codeQuality,
                    technicalDepth: result.feedback.technicalDepth,
                    overallRating: result.feedback.overallRating,
                    hireDecision: result.feedback.hireDecision,
                    strengths: result.feedback.strengths ?? "",
                    improvementAreas: result.feedback.improvementAreas ?? "",
                    privateNotes: result.feedback.privateNotes ?? "",
                    sharedWithCandidate: result.feedback.sharedWithCandidate ?? true,
                });
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load session");
        } finally {
            setLoading(false);
        }
    }, [token, sessionId]);

    const searchQuestions = useCallback(async () => {
        if (!token) return;
        const params = new URLSearchParams();
        if (query.trim()) params.set("q", query.trim());
        if (topic) params.set("topic", topic);
        if (difficulty) params.set("difficulty", difficulty);
        if (recommended) params.set("recommended", "true");
        const result = await api.get<{ questions: BankQuestion[] }>(`/experts/questions/search?${params.toString()}`, token);
        setQuestions(result.questions);
    }, [token, query, topic, difficulty, recommended]);

    useEffect(() => {
        loadSession();
    }, [loadSession]);

    useEffect(() => {
        searchQuestions().catch(() => undefined);
    }, [searchQuestions]);

    useEffect(() => {
        if (!detail || searchParams.get("feedback") !== "1") return;
        window.setTimeout(() => {
            feedbackRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 120);
    }, [detail, searchParams]);

    async function addBankQuestion(question: BankQuestion) {
        if (!token || !detail) return;
        setSaving(true);
        setError(null);
        try {
            await api.post(
                `/experts/sessions/${detail.id}/questions`,
                {
                    questionId: question.problemId,
                    questionTitle: question.title,
                    questionDifficulty: question.difficulty,
                    questionTopic: question.topics[0] || "general",
                    isCustom: false,
                },
                token
            );
            await loadSession();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to add question");
        } finally {
            setSaving(false);
        }
    }

    async function addCustomQuestion() {
        if (!token || !detail || !customTitle.trim() || !customPrompt.trim()) return;
        setSaving(true);
        setError(null);
        try {
            await api.post(
                `/experts/sessions/${detail.id}/questions`,
                {
                    questionTitle: customTitle.trim(),
                    questionDifficulty: difficulty || "Medium",
                    questionTopic: topic || "custom",
                    isCustom: true,
                    customPrompt: customPrompt.trim(),
                },
                token
            );
            setCustomTitle("");
            setCustomPrompt("");
            await loadSession();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to add custom question");
        } finally {
            setSaving(false);
        }
    }

    async function completeSession() {
        if (!token || !detail) return;
        setSaving(true);
        setError(null);
        try {
            await api.post(`/experts/sessions/${detail.id}/complete`, {}, token);
            setNotice("Session marked complete. You can now submit feedback.");
            await loadSession();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to complete session");
        } finally {
            setSaving(false);
        }
    }

    async function submitFeedback(event: React.FormEvent) {
        event.preventDefault();
        if (!token || !detail) return;
        setSaving(true);
        setError(null);
        setNotice(null);
        try {
            await api.post(`/experts/sessions/${detail.id}/feedback`, feedback, token);
            setNotice("Feedback saved.");
            await loadSession();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to save feedback");
        } finally {
            setSaving(false);
        }
    }

    if (loading && !detail) {
        return <main className="p-6 text-sm text-slate-500">Loading session...</main>;
    }

    if (!detail) {
        return <main className="p-6 text-sm text-rose-600">{error || "Session not found"}</main>;
    }

    return (
        <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-lc-border dark:bg-lc-surface">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-600">Session console</p>
                        <h1 className="mt-1 text-2xl font-bold text-slate-950 dark:text-white">{detail.candidate.fullName}</h1>
                        <p className="mt-2 text-sm text-slate-500">
                            {formatDate(detail.scheduledFor)} · {detail.interviewType} · {detail.preferredLanguage} · {detail.status}
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Link
                            href={`/expert/sessions/${detail.id}/prepare`}
                            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-lc-border dark:text-slate-200"
                        >
                            <span className="material-symbols-outlined text-[18px]">playlist_add_check</span>
                            Prepare
                        </Link>
                        <button
                            onClick={completeSession}
                            disabled={saving || ["COMPLETED", "CANCELLED", "ABANDONED"].includes(detail.status)}
                            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-lc-border dark:text-slate-200"
                        >
                            <span className="material-symbols-outlined text-[18px]">task_alt</span>
                            Mark complete
                        </button>
                        <Link
                            href={`/interviews/expert/session/${detail.id}/room`}
                            aria-disabled={!canJoin(detail)}
                            onClick={(event) => {
                                if (!canJoin(detail)) {
                                    event.preventDefault();
                                    setError(detail.questions.length === 0
                                        ? "Select at least one question before joining the expert interview."
                                        : "Join opens 10 minutes before the scheduled time."
                                    );
                                }
                            }}
                            className={`inline-flex h-10 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold ${
                                !canJoin(detail)
                                    ? "cursor-not-allowed bg-slate-200 text-slate-500"
                                    : "bg-emerald-600 text-white hover:bg-emerald-700"
                            }`}
                        >
                            <span className="material-symbols-outlined text-[18px]">video_call</span>
                            Start interview
                        </Link>
                    </div>
                </div>
                {error && <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p>}
                {notice && <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">{notice}</p>}
            </section>

            <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
                <div className="space-y-6">
                    <section className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-lc-border dark:bg-lc-surface">
                        <div className="border-b border-slate-200 px-5 py-4 dark:border-lc-border">
                            <h2 className="font-bold text-slate-950 dark:text-white">Selected questions</h2>
                        </div>
                        <div className="divide-y divide-slate-100 dark:divide-lc-border">
                            {detail.questions.length === 0 && <div className="p-5 text-sm text-slate-500">No questions selected yet.</div>}
                            {detail.questions.map((question) => (
                                <div key={question.id} className="p-5">
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <h3 className="font-bold text-slate-950 dark:text-white">{question.title}</h3>
                                            <p className="mt-1 text-sm text-slate-500">{question.difficulty} · {question.topic} · {question.isCustom ? "custom" : "platform"}</p>
                                        </div>
                                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600 dark:bg-lc-bg dark:text-slate-300">#{question.orderIndex + 1}</span>
                                    </div>
                                    {question.customPrompt && <p className="mt-3 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">{question.customPrompt}</p>}
                                </div>
                            ))}
                        </div>
                    </section>

                    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-lc-border dark:bg-lc-surface">
                        <h2 className="font-bold text-slate-950 dark:text-white">Question bank</h2>
                        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_160px_140px]">
                            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search title" className="h-10 rounded-lg border border-slate-200 px-3 text-sm dark:border-lc-border dark:bg-lc-bg" />
                            <select value={topic} onChange={(event) => setTopic(event.target.value)} className="h-10 rounded-lg border border-slate-200 px-3 text-sm dark:border-lc-border dark:bg-lc-bg">
                                {topicOptions.map((item) => <option key={item || "all"} value={item}>{item || "Any topic"}</option>)}
                            </select>
                            <select value={difficulty} onChange={(event) => setDifficulty(event.target.value as "" | "Easy" | "Medium" | "Hard")} className="h-10 rounded-lg border border-slate-200 px-3 text-sm dark:border-lc-border dark:bg-lc-bg">
                                <option value="">Any level</option>
                                {difficultyOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                            </select>
                        </div>
                        <label className="mt-3 flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                            <input type="checkbox" checked={recommended} onChange={(event) => setRecommended(event.target.checked)} className="h-4 w-4 rounded border-slate-300 text-emerald-600" />
                            Prefer recommended questions from my expertise
                        </label>
                        <div className="mt-4 grid gap-2">
                            {questions.map((question) => (
                                <button key={question.id} onClick={() => addBankQuestion(question)} disabled={saving} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-3 text-left hover:border-emerald-300 hover:bg-emerald-50 disabled:opacity-60 dark:border-lc-border">
                                    <div>
                                        <div className="text-sm font-bold text-slate-950 dark:text-white">{question.title}</div>
                                        <div className="mt-1 text-xs text-slate-500">{question.difficulty} · {(question.topics || []).slice(0, 3).join(", ") || "general"}</div>
                                    </div>
                                    <span className="material-symbols-outlined text-[20px] text-emerald-600">add_circle</span>
                                </button>
                            ))}
                        </div>
                    </section>
                </div>

                <aside className="space-y-6">
                    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-lc-border dark:bg-lc-surface">
                        <h2 className="font-bold text-slate-950 dark:text-white">Custom question</h2>
                        <input value={customTitle} onChange={(event) => setCustomTitle(event.target.value)} placeholder="Question title" className="mt-4 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm dark:border-lc-border dark:bg-lc-bg" />
                        <textarea value={customPrompt} onChange={(event) => setCustomPrompt(event.target.value)} rows={5} placeholder="Prompt, constraints, follow-ups, or rubric." className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-lc-border dark:bg-lc-bg" />
                        <button onClick={addCustomQuestion} disabled={saving || !customTitle.trim() || !customPrompt.trim()} className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-slate-950 px-3 text-sm font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60">
                            <span className="material-symbols-outlined text-[18px]">playlist_add</span>
                            Add custom
                        </button>
                    </section>

                    <form ref={feedbackRef} onSubmit={submitFeedback} className={`rounded-lg border bg-white p-5 shadow-sm transition dark:bg-lc-surface ${
                        searchParams.get("feedback") === "1"
                            ? "border-emerald-300 ring-4 ring-emerald-100 dark:border-emerald-500/50 dark:ring-emerald-500/10"
                            : "border-slate-200 dark:border-lc-border"
                    }`}>
                        <h2 className="font-bold text-slate-950 dark:text-white">Structured feedback</h2>
                        {searchParams.get("feedback") === "1" && (
                            <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                                Interview ended. Capture the feedback while the signal is fresh.
                            </p>
                        )}
                        <div className="mt-5 space-y-5">
                            <ScoreInput label="Problem solving" value={feedback.problemSolving} onChange={(value) => setFeedback((f) => ({ ...f, problemSolving: value }))} />
                            <ScoreInput label="Communication" value={feedback.communication} onChange={(value) => setFeedback((f) => ({ ...f, communication: value }))} />
                            <ScoreInput label="Code quality" value={feedback.codeQuality} onChange={(value) => setFeedback((f) => ({ ...f, codeQuality: value }))} />
                            <ScoreInput label="Technical depth" value={feedback.technicalDepth} onChange={(value) => setFeedback((f) => ({ ...f, technicalDepth: value }))} />
                            <ScoreInput label="Overall" value={feedback.overallRating} onChange={(value) => setFeedback((f) => ({ ...f, overallRating: value }))} />
                        </div>
                        <label className="mt-5 block text-sm font-medium text-slate-700 dark:text-slate-200">
                            Decision
                            <select value={feedback.hireDecision} onChange={(event) => setFeedback((f) => ({ ...f, hireDecision: event.target.value }))} className="mt-2 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm dark:border-lc-border dark:bg-lc-bg">
                                <option value="strong_yes">Strong yes</option>
                                <option value="lean_yes">Lean yes</option>
                                <option value="lean_no">Lean no</option>
                                <option value="strong_no">Strong no</option>
                            </select>
                        </label>
                        <textarea value={feedback.strengths} onChange={(event) => setFeedback((f) => ({ ...f, strengths: event.target.value }))} rows={3} placeholder="Strengths" className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-lc-border dark:bg-lc-bg" />
                        <textarea value={feedback.improvementAreas} onChange={(event) => setFeedback((f) => ({ ...f, improvementAreas: event.target.value }))} rows={3} placeholder="Improvement areas" className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-lc-border dark:bg-lc-bg" />
                        <textarea value={feedback.privateNotes} onChange={(event) => setFeedback((f) => ({ ...f, privateNotes: event.target.value }))} rows={3} placeholder="Private notes, never shown to candidate" className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-lc-border dark:bg-lc-bg" />
                        <label className="mt-3 flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                            <input type="checkbox" checked={feedback.sharedWithCandidate} onChange={(event) => setFeedback((f) => ({ ...f, sharedWithCandidate: event.target.checked }))} className="h-4 w-4 rounded border-slate-300 text-emerald-600" />
                            Share feedback with candidate
                        </label>
                        <button disabled={saving} className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60">
                            <span className="material-symbols-outlined text-[18px]">rate_review</span>
                            Save feedback
                        </button>
                    </form>
                </aside>
            </section>
        </main>
    );
}
