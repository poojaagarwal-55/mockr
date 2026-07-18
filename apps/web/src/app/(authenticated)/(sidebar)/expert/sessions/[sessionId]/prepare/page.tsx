"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import { api } from "@/lib/api";

type ExpertSessionDetail = {
    id: string;
    status: string;
    interviewType: string;
    preferredLanguage: string;
    scheduledFor: string;
    endsAt: string | null;
    candidate: { id: string; fullName: string; avatarUrl: string | null };
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

export default function ExpertSessionPreparePage() {
    const params = useParams<{ sessionId: string }>();
    const { session } = useAuth();
    const token = session?.access_token;
    const sessionId = params.sessionId;
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

    const loadSession = useCallback(async () => {
        if (!token || !sessionId) return;
        setLoading(true);
        setError(null);
        try {
            const result = await api.get<ExpertSessionDetail>(`/experts/sessions/${sessionId}`, token);
            setDetail(result);
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

    async function addBankQuestion(question: BankQuestion) {
        if (!token || !detail) return;
        setSaving(true);
        setError(null);
        try {
            await api.post(`/experts/sessions/${detail.id}/questions`, {
                questionId: question.problemId,
                questionTitle: question.title,
                questionDifficulty: question.difficulty,
                questionTopic: question.topics[0] || "general",
                isCustom: false,
            }, token);
            setNotice("Question added.");
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
            await api.post(`/experts/sessions/${detail.id}/questions`, {
                questionTitle: customTitle.trim(),
                questionDifficulty: difficulty || "Medium",
                questionTopic: topic || "custom",
                isCustom: true,
                customPrompt: customPrompt.trim(),
            }, token);
            setCustomTitle("");
            setCustomPrompt("");
            setNotice("Custom question added.");
            await loadSession();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to add custom question");
        } finally {
            setSaving(false);
        }
    }

    if (loading && !detail) return <main className="p-6 text-sm text-slate-500">Loading prep workspace...</main>;
    if (!detail) return <main className="p-6 text-sm text-rose-600">{error || "Session not found"}</main>;

    const ready = detail.questions.length > 0;

    return (
        <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-lc-border dark:bg-lc-surface">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-600">Expert prep</p>
                        <h1 className="mt-1 text-2xl font-bold text-slate-950 dark:text-white">{detail.candidate.fullName}</h1>
                        <p className="mt-2 text-sm text-slate-500">{formatDate(detail.scheduledFor)} · {detail.interviewType.replace("_", " ")} · {detail.preferredLanguage}</p>
                    </div>
                    <Link href={canJoin(detail) ? `/interviews/expert/session/${detail.id}/room` : `/expert/sessions/${detail.id}`} className={`inline-flex h-10 items-center justify-center gap-2 rounded-lg px-3 text-sm font-bold ${canJoin(detail) ? "bg-emerald-600 text-white hover:bg-emerald-700" : "border border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-lc-border dark:text-slate-200"}`}>
                        <span className="material-symbols-outlined text-[18px]">{canJoin(detail) ? "video_call" : "info"}</span>
                        {canJoin(detail) ? "Start interview" : "Session details"}
                    </Link>
                </div>
                {error && <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p>}
                {notice && <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">{notice}</p>}
            </section>

            <section className="grid gap-6 lg:grid-cols-[420px_minmax(0,1fr)]">
                <aside className="space-y-6">
                    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-lc-border dark:bg-lc-surface">
                        <h2 className="font-bold text-slate-950 dark:text-white">Readiness checklist</h2>
                        <div className="mt-4 space-y-2 text-sm">
                            <ChecklistItem done={ready} label="At least one question selected" />
                            <ChecklistItem done label="Session scheduled" />
                            <ChecklistItem done={canJoin(detail)} label="Join window open" />
                        </div>
                    </section>

                    <section className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-lc-border dark:bg-lc-surface">
                        <div className="border-b border-slate-200 px-5 py-4 dark:border-lc-border">
                            <h2 className="font-bold text-slate-950 dark:text-white">Selected queue</h2>
                        </div>
                        <div className="divide-y divide-slate-100 dark:divide-lc-border">
                            {detail.questions.length === 0 && <div className="p-5 text-sm text-slate-500">Pick at least one question before joining.</div>}
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
                </aside>

                <div className="space-y-6">
                    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-lc-border dark:bg-lc-surface">
                        <h2 className="font-bold text-slate-950 dark:text-white">Question bank</h2>
                        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_160px_140px]">
                            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search title" className="h-10 rounded-lg border border-slate-200 px-3 text-sm dark:border-lc-border dark:bg-lc-bg" />
                            <select value={topic} onChange={(event) => setTopic(event.target.value)} className="h-10 rounded-lg border border-slate-200 px-3 text-sm dark:border-lc-border dark:bg-lc-bg">{topicOptions.map((item) => <option key={item || "all"} value={item}>{item || "Any topic"}</option>)}</select>
                            <select value={difficulty} onChange={(event) => setDifficulty(event.target.value as "" | "Easy" | "Medium" | "Hard")} className="h-10 rounded-lg border border-slate-200 px-3 text-sm dark:border-lc-border dark:bg-lc-bg">
                                <option value="">Any level</option>
                                {difficultyOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                            </select>
                        </div>
                        <label className="mt-3 flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                            <input type="checkbox" checked={recommended} onChange={(event) => setRecommended(event.target.checked)} className="h-4 w-4 rounded border-slate-300 text-emerald-600" />
                            Prefer recommended questions
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

                    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-lc-border dark:bg-lc-surface">
                        <h2 className="font-bold text-slate-950 dark:text-white">Custom question</h2>
                        <input value={customTitle} onChange={(event) => setCustomTitle(event.target.value)} placeholder="Question title" className="mt-4 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm dark:border-lc-border dark:bg-lc-bg" />
                        <textarea value={customPrompt} onChange={(event) => setCustomPrompt(event.target.value)} rows={6} placeholder="Prompt, follow-ups, or rubric notes." className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-lc-border dark:bg-lc-bg" />
                        <button onClick={addCustomQuestion} disabled={saving || !customTitle.trim() || !customPrompt.trim()} className="mt-3 inline-flex h-10 items-center gap-2 rounded-lg bg-slate-950 px-3 text-sm font-bold text-white disabled:opacity-60">
                            <span className="material-symbols-outlined text-[18px]">add</span>
                            Add custom question
                        </button>
                    </section>
                </div>
            </section>
        </main>
    );
}

function ChecklistItem({ done, label }: { done: boolean; label: string }) {
    return (
        <div className="flex items-center gap-2">
            <span className={`material-symbols-outlined text-[18px] ${done ? "text-emerald-600" : "text-slate-400"}`}>{done ? "check_circle" : "radio_button_unchecked"}</span>
            <span className={done ? "text-slate-700 dark:text-slate-200" : "text-slate-500"}>{label}</span>
        </div>
    );
}
