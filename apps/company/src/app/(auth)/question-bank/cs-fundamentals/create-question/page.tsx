"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useCompanyAuth } from "@/context/company-auth-context";

type Topic = "CN" | "DBMS" | "OOPS" | "OS";
type Difficulty = "Easy" | "Medium" | "Hard";

type CSFormData = {
    topic: Topic;
    question: string;
    answer: string;
    detailedAnswer: string;
    difficulty: Difficulty;
    tags: string[];
    status: "draft" | "published" | "archived";
};

const FORM_DRAFT_KEY = "company-cs-fundamentals-question-draft";
const topicLabels: Record<Topic, string> = {
    CN: "Computer Networks",
    DBMS: "DBMS",
    OOPS: "OOP",
    OS: "Operating Systems",
};
const topics: Topic[] = ["DBMS", "OS", "CN", "OOPS"];
const suggestedTags = ["DBMS", "OS", "CN", "OOPS", "Core Concepts", "Interview Theory", "Advanced"];

function defaultFormData(): CSFormData {
    return {
        topic: "DBMS",
        question: "",
        answer: "",
        detailedAnswer: "",
        difficulty: "Medium",
        tags: ["DBMS"],
        status: "published",
    };
}

function normalizeText(value: string) {
    return value.replace(/\r\n/g, "\n").trim();
}

export default function CreateCSFundamentalsQuestionPage() {
    const { session } = useCompanyAuth();
    const [formData, setFormData] = useState<CSFormData>(() => {
        if (typeof window !== "undefined") {
            try {
                const saved = window.localStorage.getItem(FORM_DRAFT_KEY);
                if (saved) return JSON.parse(saved) as CSFormData;
            } catch {
                // Ignore malformed local drafts.
            }
        }
        return defaultFormData();
    });
    const [activeStep, setActiveStep] = useState(0);
    const [autosaveStatus, setAutosaveStatus] = useState("Draft not saved yet");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const timeout = window.setTimeout(() => {
            window.localStorage.setItem(FORM_DRAFT_KEY, JSON.stringify(formData));
            setAutosaveStatus(`Saved ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
        }, 500);
        return () => window.clearTimeout(timeout);
    }, [formData]);

    const answerParagraphs = useMemo(() => normalizeText(formData.answer).split(/\n{2,}/).filter(Boolean), [formData.answer]);
    const canSubmit =
        Boolean(formData.question.trim()) &&
        Boolean(formData.answer.trim()) &&
        formData.tags.length > 0;

    function update<K extends keyof CSFormData>(key: K, value: CSFormData[K]) {
        setFormData((current) => ({ ...current, [key]: value }));
    }

    function toggleTag(tag: string) {
        update("tags", formData.tags.includes(tag)
            ? formData.tags.filter((item) => item !== tag)
            : [...formData.tags, tag]
        );
    }

    async function handleSubmit(event: React.FormEvent) {
        event.preventDefault();
        if (!canSubmit) {
            setError("Please add the question, answer, and at least one tag before adding.");
            return;
        }

        setLoading(true);
        setError(null);
        setSuccess(false);
        try {
            await api.post("/companies/question-bank/cs-fundamentals", {
                ...formData,
                question: normalizeText(formData.question),
                answer: normalizeText(formData.answer),
                detailedAnswer: normalizeText(formData.detailedAnswer),
            }, session?.access_token);
            if (typeof window !== "undefined") window.localStorage.removeItem(FORM_DRAFT_KEY);
            setSuccess(true);
            setTimeout(() => {
                window.location.href = "/question-bank/cs-fundamentals";
            }, 1000);
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "Failed to add CS fundamentals question.");
        } finally {
            setLoading(false);
        }
    }

    return (
        <main className="min-h-full bg-[#FAFBFC] px-4 py-8 dark:bg-lc-bg sm:px-6 lg:px-10">
            <div className="mx-auto max-w-6xl">
                <div className="mb-8">
                    <Link href="/question-bank/cs-fundamentals" className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-slate-500 transition hover:text-primary dark:text-slate-400">
                        <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                        Back to CS fundamentals
                    </Link>
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Company Question Bank</p>
                    <h1 className="mt-2 font-nunito text-3xl font-extrabold tracking-tight text-slate-950 dark:text-white sm:text-4xl">
                        Create CS Fundamentals Question
                    </h1>
                </div>

                <form onSubmit={handleSubmit} className="space-y-6">
                    {success && (
                        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                            <p className="font-semibold text-emerald-800">CS fundamentals question added successfully. Returning to the question bank...</p>
                        </div>
                    )}
                    {error && (
                        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                            <p className="font-semibold text-red-800">{error}</p>
                        </div>
                    )}

                    <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-lc-surface dark:ring-lc-border">
                        <div className="flex overflow-x-auto border-b border-slate-200 bg-white dark:border-lc-border dark:bg-lc-surface">
                            {["Question", "Answer", "Preview"].map((step, index) => (
                                <button key={step} type="button" onClick={() => setActiveStep(index)} className={`group relative flex min-w-[210px] items-center gap-4 whitespace-nowrap px-7 py-5 text-sm font-extrabold uppercase tracking-[0.02em] transition-colors ${activeStep === index ? "text-primary" : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"}`}>
                                    {index < 2 && <span className="pointer-events-none absolute right-0 top-0 h-full w-8 translate-x-1/2 skew-x-[-24deg] border-r border-slate-200 bg-white group-hover:bg-slate-50 dark:border-lc-border dark:bg-lc-surface" />}
                                    <span className={`relative z-10 grid size-9 place-items-center rounded-full border-2 text-sm font-extrabold ${activeStep === index ? "border-primary bg-primary text-white" : "border-slate-300 bg-white text-slate-400 dark:border-lc-border dark:bg-lc-elevated"}`}>{index + 1}</span>
                                    <span className="relative z-10">{step}</span>
                                </button>
                            ))}
                            <div className="ml-auto hidden items-center px-6 text-xs font-extrabold uppercase tracking-[0.14em] text-slate-400 lg:flex">{autosaveStatus}</div>
                        </div>

                        <div className="p-6 sm:p-8">
                            <div className="mb-5 text-xs font-extrabold uppercase tracking-[0.14em] text-slate-400 lg:hidden">{autosaveStatus}</div>
                            {activeStep === 0 && (
                                <Panel title="Question Details">
                                    <div className="grid gap-5 lg:grid-cols-[1fr_220px_220px]">
                                        <label className="block">
                                            <span className="text-sm font-extrabold text-slate-700 dark:text-slate-200">Topic</span>
                                            <select value={formData.topic} onChange={(event) => {
                                                const topic = event.target.value as Topic;
                                                update("topic", topic);
                                                if (!formData.tags.includes(topic)) update("tags", [...formData.tags, topic]);
                                            }} className="mt-2 h-12 w-full rounded-lg border border-slate-200 px-4 text-sm font-semibold outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-elevated dark:text-white">
                                                {topics.map((topic) => <option key={topic} value={topic}>{topicLabels[topic]}</option>)}
                                            </select>
                                        </label>
                                        <label className="block">
                                            <span className="text-sm font-extrabold text-slate-700 dark:text-slate-200">Difficulty</span>
                                            <select value={formData.difficulty} onChange={(event) => update("difficulty", event.target.value as Difficulty)} className="mt-2 h-12 w-full rounded-lg border border-slate-200 px-4 text-sm font-semibold outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-elevated dark:text-white">
                                                <option>Easy</option>
                                                <option>Medium</option>
                                                <option>Hard</option>
                                            </select>
                                        </label>
                                    </div>
                                    <TextArea label="Question" value={formData.question} onChange={(value) => update("question", value)} rows={6} placeholder="Explain normalization in DBMS and why it is useful." />
                                    <div>
                                        <div className="mb-3 flex items-center justify-between">
                                            <span className="text-sm font-extrabold text-slate-700 dark:text-slate-200">Tags</span>
                                            <span className="text-xs font-bold text-slate-400">At least 1 required</span>
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            {suggestedTags.map((tag) => {
                                                const active = formData.tags.includes(tag);
                                                return (
                                                    <button key={tag} type="button" onClick={() => toggleTag(tag)} className={`rounded-full px-3 py-1.5 text-sm font-extrabold transition ${active ? "bg-primary text-white" : "bg-slate-100 text-slate-600 hover:bg-primary/10 hover:text-primary dark:bg-lc-elevated dark:text-slate-300 dark:hover:bg-lc-hover dark:hover:text-white"}`}>
                                                        {tag}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </Panel>
                            )}

                            {activeStep === 1 && (
                                <Panel title="Answer">
                                    <TextArea label="Answer" value={formData.answer} onChange={(value) => update("answer", value)} rows={12} placeholder={"Normalization is the process of organizing data in a relational database to reduce redundancy and improve data integrity.\n\nIt divides large tables into smaller related tables and defines relationships between them."} />
                                    <TextArea label="Detailed answer" value={formData.detailedAnswer} onChange={(value) => update("detailedAnswer", value)} rows={8} placeholder="Add deeper explanation, tradeoffs, examples, or interviewer notes." />
                                </Panel>
                            )}

                            {activeStep === 2 && (
                                <Panel title="Preview">
                                    <div className="space-y-6">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-extrabold text-primary">{topicLabels[formData.topic]}</span>
                                            <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-extrabold text-slate-600 dark:bg-lc-elevated dark:text-slate-300">{formData.difficulty}</span>
                                            {formData.tags.map((tag) => <span key={tag} className="rounded-full bg-slate-100 px-3 py-1 text-sm font-extrabold text-slate-600 dark:bg-lc-elevated dark:text-slate-300">{tag}</span>)}
                                        </div>
                                        <section>
                                            <h2 className="font-nunito text-2xl font-extrabold text-slate-950 dark:text-white">{formData.question || "Question preview"}</h2>
                                        </section>
                                        <section>
                                            <h3 className="mb-3 font-nunito text-xl font-extrabold text-slate-950 dark:text-white">Answer</h3>
                                            <div className="space-y-3 text-sm font-semibold leading-7 text-slate-600 dark:text-slate-300">
                                                {(answerParagraphs.length ? answerParagraphs : ["Answer preview will appear here."]).map((paragraph, index) => <p key={index}>{paragraph}</p>)}
                                            </div>
                                        </section>
                                        {formData.detailedAnswer.trim() && (
                                            <section>
                                                <h3 className="mb-3 font-nunito text-xl font-extrabold text-slate-950 dark:text-white">Detailed Answer</h3>
                                                <p className="whitespace-pre-wrap text-sm font-semibold leading-7 text-slate-600 dark:text-slate-300">{normalizeText(formData.detailedAnswer)}</p>
                                            </section>
                                        )}
                                    </div>
                                </Panel>
                            )}
                        </div>
                    </div>

                    <div className="flex flex-col gap-4 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 dark:bg-lc-surface dark:ring-lc-border lg:flex-row lg:items-center lg:justify-between">
                        <div className="flex gap-3">
                            {activeStep > 0 && <button type="button" onClick={() => setActiveStep(activeStep - 1)} className="rounded-full border border-slate-200 px-6 py-3 text-sm font-extrabold text-slate-700 transition hover:bg-slate-50 dark:border-lc-border dark:text-slate-200 dark:hover:bg-lc-hover">Previous</button>}
                            {activeStep < 2 && <button type="button" onClick={() => setActiveStep(activeStep + 1)} className="rounded-full bg-primary px-6 py-3 text-sm font-extrabold text-white transition hover:bg-primary/90">Next</button>}
                        </div>
                        <button type="submit" disabled={loading || !canSubmit} className="rounded-full bg-emerald-600 px-8 py-3 text-sm font-extrabold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50">{loading ? "Adding..." : "Add"}</button>
                    </div>
                </form>
            </div>
        </main>
    );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section className="space-y-5 rounded-xl bg-white p-5 ring-1 ring-slate-200 dark:bg-lc-surface dark:ring-lc-border">
            <h2 className="font-nunito text-xl font-extrabold text-slate-950 dark:text-white">{title}</h2>
            {children}
        </section>
    );
}

function TextArea({ label, value, onChange, rows, placeholder }: { label: string; value: string; onChange: (value: string) => void; rows: number; placeholder?: string }) {
    return (
        <label className="block">
            <span className="text-sm font-extrabold text-slate-700 dark:text-slate-200">{label}</span>
            <textarea value={value} onChange={(event) => onChange(event.target.value)} rows={rows} placeholder={placeholder} className="mt-2 w-full resize-y rounded-lg border border-slate-200 px-4 py-3 text-sm font-semibold leading-7 outline-none transition placeholder:text-slate-400 focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-elevated dark:text-white" />
        </label>
    );
}
