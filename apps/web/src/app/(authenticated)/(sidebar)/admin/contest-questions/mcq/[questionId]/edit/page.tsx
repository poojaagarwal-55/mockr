"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Plus, Save, Trash2 } from "lucide-react";
import { useAuth } from "@/context/auth-context";
import { MarkdownQuestionEditor } from "@/components/question-content/markdown-question-editor";
import { QuestionAuthoringHelpButton } from "@/components/question-content/question-authoring-help";
import { useContestManagerCheck } from "@/hooks/use-contest-manager-check";

type Difficulty = "Easy" | "Medium" | "Hard";
type McqOption = { id: string; text: string };

const contestApiUrl = process.env.NEXT_PUBLIC_CONTEST_API_URL || "http://localhost:3002";

function splitTags(value: string) {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
}

export default function EditContestMcqQuestionPage() {
    const router = useRouter();
    const params = useParams();
    const questionId = String(params.questionId || "");
    const { session } = useAuth();
    const { isContestManager, loading: managerLoading } = useContestManagerCheck();
    const token = session?.access_token;

    const [loaded, setLoaded] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [title, setTitle] = useState("");
    const [difficulty, setDifficulty] = useState<Difficulty>("Medium");
    const [questionText, setQuestionText] = useState("");
    const [topics, setTopics] = useState("");
    const [companyTags, setCompanyTags] = useState("");
    const [options, setOptions] = useState<McqOption[]>([]);
    const [correctOptionId, setCorrectOptionId] = useState("A");
    const [explanation, setExplanation] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!isContestManager || !token || !questionId) return;
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch(`${contestApiUrl}/admin/contest-questions/mcq/${encodeURIComponent(questionId)}/full`, {
                    headers: { Authorization: `Bearer ${token}` },
                    cache: "no-store",
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.message || "Failed to load MCQ");
                const q = data.question || {};
                if (cancelled) return;
                setTitle(q.title || "");
                setDifficulty(["Easy", "Medium", "Hard"].includes(q.difficulty) ? q.difficulty : "Medium");
                setQuestionText(q.questionText || q.statement || "");
                setTopics(Array.isArray(q.topics) ? q.topics.join(", ") : "");
                setCompanyTags(Array.isArray(q.companyTags) ? q.companyTags.join(", ") : "");
                const opts = Array.isArray(q.options) ? [...q.options].sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0)) : [];
                setOptions(opts.map((o: any) => ({ id: String(o.id), text: String(o.text ?? "") })));
                setCorrectOptionId(String(q.correctOptionId || opts[0]?.id || "A"));
                setExplanation(q.explanation || "");
                setLoaded(true);
            } catch (err) {
                if (!cancelled) setLoadError(err instanceof Error ? err.message : "Failed to load MCQ");
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [isContestManager, token, questionId]);

    const updateOption = (index: number, patch: Partial<McqOption>) => {
        setOptions((current) => current.map((option, i) => (i === index ? { ...option, ...patch } : option)));
    };
    const addOption = () => {
        setOptions((current) => {
            if (current.length >= 6) return current;
            return [...current, { id: String.fromCharCode(65 + current.length), text: "" }];
        });
    };
    const removeOption = (index: number) => {
        setOptions((current) => {
            if (current.length <= 2) return current;
            const next = current.filter((_, i) => i !== index);
            if (!next.some((option) => option.id === correctOptionId)) setCorrectOptionId(next[0]?.id || "A");
            return next;
        });
    };

    const submit = async () => {
        if (!token) return;
        setSaving(true);
        setError(null);
        try {
            const cleanOptions = options
                .map((option, index) => ({ id: option.id.trim(), text: option.text.trim(), order: index }))
                .filter((option) => option.id && option.text);
            const response = await fetch(`${contestApiUrl}/admin/contest-questions/mcq/${encodeURIComponent(questionId)}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                    title,
                    difficulty,
                    questionText,
                    topics: splitTags(topics),
                    companyTags: splitTags(companyTags),
                    options: cleanOptions,
                    correctOptionId,
                    explanation,
                }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                const details = Array.isArray(data.details)
                    ? data.details.map((item: { message?: string }) => item.message).filter(Boolean).join(" ")
                    : "";
                throw new Error(data.message || details || "Failed to update MCQ question");
            }
            router.push("/admin/contest-questions");
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to update MCQ question");
        } finally {
            setSaving(false);
        }
    };

    if (managerLoading) {
        return (
            <div className="flex min-h-[60vh] flex-1 items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            </div>
        );
    }
    if (!isContestManager) {
        return <div className="grid min-h-[60vh] place-items-center text-slate-500">Not authorized.</div>;
    }
    if (loadError) {
        return <div className="grid min-h-[60vh] place-items-center font-semibold text-rose-500">{loadError}</div>;
    }
    if (!loaded) {
        return (
            <div className="flex min-h-[60vh] flex-1 items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            </div>
        );
    }

    return (
        <main className="min-h-screen bg-[#f7f8fb] px-4 py-8 text-slate-950 dark:bg-lc-bg dark:text-white sm:px-6 lg:px-8">
            <div className="mx-auto max-w-7xl">
                <div className="mb-8 flex flex-col gap-4 border-b border-slate-200 pb-6 dark:border-lc-border lg:flex-row lg:items-end lg:justify-between">
                    <div>
                        <Link href="/admin/contest-questions" className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-slate-500 transition hover:text-primary dark:text-slate-400">
                            <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                            Back to contest questions
                        </Link>
                        <p className="text-xs font-black uppercase tracking-[0.18em] text-primary">Contest MCQ Bank</p>
                        <h1 className="mt-2 font-nunito text-4xl font-extrabold tracking-normal">Edit MCQ Question</h1>
                    </div>
                    <div className="flex flex-wrap gap-3">
                        <button
                            type="button"
                            onClick={submit}
                            disabled={saving}
                            className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-extrabold text-white shadow-lg shadow-primary/20 transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            <Save className="h-4 w-4" />
                            {saving ? "Saving..." : "Update MCQ"}
                        </button>
                    </div>
                </div>

                {error && (
                    <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
                        {error}
                    </div>
                )}

                <div>
                    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-lc-border dark:bg-lc-surface">
                        <div className="grid gap-5 md:grid-cols-2">
                            <label>
                                <span className="mb-2 block text-sm font-extrabold">Title</span>
                                <input value={title} onChange={(event) => setTitle(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold outline-none focus:border-primary dark:border-lc-border dark:bg-lc-bg" />
                            </label>
                            <label>
                                <span className="mb-2 block text-sm font-extrabold">Difficulty</span>
                                <select value={difficulty} onChange={(event) => setDifficulty(event.target.value as Difficulty)} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold outline-none focus:border-primary dark:border-lc-border dark:bg-lc-bg">
                                    <option>Easy</option>
                                    <option>Medium</option>
                                    <option>Hard</option>
                                </select>
                            </label>
                            <div className="md:col-span-2">
                                <MarkdownQuestionEditor
                                    value={questionText}
                                    onChange={setQuestionText}
                                    label={<span className="inline-flex items-center gap-2"><span>Question</span><QuestionAuthoringHelpButton topic="description" /></span>}
                                    required
                                    rows={9}
                                    placeholder="Write the MCQ statement in Markdown. Use LaTeX like $O(n \log n)$, block formulas with $$...$$, tables, images, and note blocks."
                                />
                            </div>
                            <label>
                                <span className="mb-2 block text-sm font-extrabold">Topics</span>
                                <input value={topics} onChange={(event) => setTopics(event.target.value)} placeholder="Arrays, AI, OS" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold outline-none focus:border-primary dark:border-lc-border dark:bg-lc-bg" />
                            </label>
                            <label>
                                <span className="mb-2 block text-sm font-extrabold">Company tags</span>
                                <input value={companyTags} onChange={(event) => setCompanyTags(event.target.value)} placeholder="Amazon, Generic OA" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold outline-none focus:border-primary dark:border-lc-border dark:bg-lc-bg" />
                            </label>
                        </div>

                        <div className="mt-7">
                            <div className="mb-3 flex items-center justify-between gap-3">
                                <h2 className="font-nunito text-xl font-extrabold">Options</h2>
                                <button type="button" onClick={addOption} disabled={options.length >= 6} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-extrabold disabled:opacity-50 dark:border-lc-border">
                                    <Plus className="h-4 w-4" />
                                    Add
                                </button>
                            </div>
                            <div className="space-y-3">
                                {options.map((option, index) => (
                                    <div key={`${option.id}-${index}`} className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-lc-border dark:bg-lc-bg">
                                        <div className="mb-3 grid gap-3 md:grid-cols-[4rem_minmax(0,1fr)_8rem_2.75rem]">
                                            <input value={option.id} onChange={(event) => updateOption(index, { id: event.target.value.toUpperCase().slice(0, 3) })} className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-center text-sm font-black outline-none focus:border-primary dark:border-lc-border dark:bg-lc-surface" />
                                            <div className="flex items-center rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-extrabold text-slate-500 dark:border-lc-border dark:bg-lc-surface dark:text-slate-300">
                                                Option {index + 1} content
                                            </div>
                                            <label className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-extrabold dark:border-lc-border dark:bg-lc-surface">
                                                <input type="radio" checked={correctOptionId === option.id} onChange={() => setCorrectOptionId(option.id)} />
                                                Correct
                                            </label>
                                            <button type="button" onClick={() => removeOption(index)} disabled={options.length <= 2} className="grid h-12 place-items-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:text-rose-500 disabled:opacity-40 dark:border-lc-border dark:bg-lc-surface">
                                                <Trash2 className="h-4 w-4" />
                                            </button>
                                        </div>
                                        <MarkdownQuestionEditor
                                            value={option.text}
                                            onChange={(text) => updateOption(index, { text })}
                                            rows={3}
                                            uploadEnabled={false}
                                            placeholder="Write option text. Markdown and LaTeX like $\\theta$ or $$x^2$$ are supported."
                                        />
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="mt-7">
                            <MarkdownQuestionEditor
                                value={explanation}
                                onChange={setExplanation}
                                label={<span className="inline-flex items-center gap-2"><span>Explanation</span><QuestionAuthoringHelpButton topic="description" /></span>}
                                required
                                rows={7}
                                placeholder="Explain why the correct option is correct. Markdown, LaTeX, images, and notes are supported."
                            />
                        </div>
                    </section>
                </div>
            </div>
        </main>
    );
}
