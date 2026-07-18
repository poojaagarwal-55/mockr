"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useCompanyAuth } from "@/context/company-auth-context";

type Difficulty = "Easy" | "Medium" | "Hard";

type ReferenceDiagram = {
    url: string;
    source: "url" | "upload";
    key?: string;
    filename?: string;
    contentType?: string;
    size?: number;
    uploadedAt?: string;
};

type SystemDesignFormData = {
    title: string;
    slug: string;
    difficulty: Difficulty;
    problemStatement: string;
    rubricLite: string;
    rubricFull: string;
    hints: string[];
    followUpQuestions: string[];
    sampleDiagramUrl: string;
    referenceDiagram: ReferenceDiagram | null;
    tags: string[];
    status: "draft" | "published" | "archived";
};

const FORM_DRAFT_KEY = "company-system-design-question-draft";
const suggestedTags = ["System Design", "Scalability", "Distributed Systems", "Caching", "Databases", "Queues", "API Design", "Reliability"];
const PROMPT_EXAMPLE = `Design a scalable notification system.

Functional requirements:
- Send notifications through push, SMS, and email.
- Support instant, scheduled, and batched notifications.
- Users can set notification preferences per channel.
- Track notification history and read/unread status.

Non-functional requirements:
- Handle 100M notifications per day.
- Deliver real-time notifications within 5 seconds.
- Ensure high availability.
- Gracefully handle slow third-party providers.`;
const RUBRIC_LITE_EXAMPLE = `{
  "requiredComponents": ["API gateway", "Application servers", "Database", "Cache"],
  "keyTradeoffs": ["Consistency vs availability", "Read latency vs freshness"],
  "antiPatterns": ["Single database bottleneck", "No failure handling"],
  "followUpTriggers": [
    { "condition": "Mentions cache", "question": "How would you handle cache invalidation?" }
  ]
}`;
const RUBRIC_FULL_EXAMPLE = `{
  "sampleAnswer": "A strong answer should cover requirements, APIs, data model, scaling plan, caching, failure handling, and observability.",
  "scoringDimensions": [
    { "name": "Requirements", "weight": 20, "criteria": "Clarifies functional and non-functional requirements." },
    { "name": "Architecture", "weight": 40, "criteria": "Proposes scalable components with clear data flow." },
    { "name": "Tradeoffs", "weight": 25, "criteria": "Explains alternatives and failure modes." },
    { "name": "Communication", "weight": 15, "criteria": "Structures the discussion clearly." }
  ]
}`;

function defaultFormData(): SystemDesignFormData {
    return {
        title: "",
        slug: "",
        difficulty: "Medium",
        problemStatement: "",
        rubricLite: "",
        rubricFull: "",
        hints: [""],
        followUpQuestions: [""],
        sampleDiagramUrl: "",
        referenceDiagram: null,
        tags: ["System Design"],
        status: "published",
    };
}

function slugify(value: string) {
    return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function parseJson(value: string) {
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

function jsonIsObject(value: string) {
    const parsed = parseJson(value);
    return Boolean(parsed && typeof parsed === "object" && !Array.isArray(parsed));
}

function optionalUrlIsValid(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return true;
    try {
        const url = new URL(trimmed);
        return ["http:", "https:"].includes(url.protocol);
    } catch {
        return false;
    }
}

export default function CreateSystemDesignQuestionPage() {
    const { session } = useCompanyAuth();
    const [formData, setFormData] = useState<SystemDesignFormData>(() => {
        if (typeof window !== "undefined") {
            try {
                const saved = window.localStorage.getItem(FORM_DRAFT_KEY);
                if (saved) {
                    const parsed = JSON.parse(saved) as SystemDesignFormData;
                    return {
                        ...parsed,
                        referenceDiagram: parsed.referenceDiagram || (parsed.sampleDiagramUrl ? { url: parsed.sampleDiagramUrl, source: "url" } : null),
                        rubricLite: parsed.rubricLite === RUBRIC_LITE_EXAMPLE ? "" : parsed.rubricLite,
                        rubricFull: parsed.rubricFull === RUBRIC_FULL_EXAMPLE ? "" : parsed.rubricFull,
                    };
                }
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
    const [promptGuidelinesOpen, setPromptGuidelinesOpen] = useState(false);
    const [rubricGuidelinesOpen, setRubricGuidelinesOpen] = useState(false);
    const [diagramMode, setDiagramMode] = useState<"url" | "upload">(() => formData.referenceDiagram?.source === "upload" ? "upload" : "url");
    const [uploadingDiagram, setUploadingDiagram] = useState(false);
    const [diagramError, setDiagramError] = useState<string | null>(null);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const timeout = window.setTimeout(() => {
            window.localStorage.setItem(FORM_DRAFT_KEY, JSON.stringify(formData));
            setAutosaveStatus(`Saved ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
        }, 500);
        return () => window.clearTimeout(timeout);
    }, [formData]);

    const canSubmit =
        Boolean(formData.title.trim()) &&
        Boolean((formData.slug || slugify(formData.title)).trim()) &&
        Boolean(formData.problemStatement.trim()) &&
        jsonIsObject(formData.rubricLite) &&
        jsonIsObject(formData.rubricFull) &&
        optionalUrlIsValid(formData.sampleDiagramUrl) &&
        formData.tags.length > 0;

    const rubricLiteParsed = useMemo(() => parseJson(formData.rubricLite), [formData.rubricLite]);
    const rubricFullParsed = useMemo(() => parseJson(formData.rubricFull), [formData.rubricFull]);
    const selectedDiagramUrl = formData.referenceDiagram?.url || formData.sampleDiagramUrl.trim();

    function update<K extends keyof SystemDesignFormData>(key: K, value: SystemDesignFormData[K]) {
        setFormData((current) => ({ ...current, [key]: value }));
    }

    function toggleTag(tag: string) {
        update("tags", formData.tags.includes(tag)
            ? formData.tags.filter((item) => item !== tag)
            : [...formData.tags, tag]
        );
    }

    function updateDiagramUrl(value: string) {
        update("sampleDiagramUrl", value);
        update("referenceDiagram", value.trim() ? { url: value.trim(), source: "url" } : null);
    }

    async function uploadReferenceDiagram(file: File | null) {
        if (!file) return;
        if (!session?.access_token) {
            setDiagramError("Please sign in before uploading a diagram.");
            return;
        }

        const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
        if (!allowedTypes.includes(file.type)) {
            setDiagramError("Only JPEG, PNG, or WebP images are allowed.");
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            setDiagramError("Reference diagram must be under 5MB.");
            return;
        }

        setUploadingDiagram(true);
        setDiagramError(null);
        try {
            const body = new FormData();
            body.append("file", file);
            const response = await api.upload<{ diagram: ReferenceDiagram; fileUrl: string }>(
                "/companies/question-bank/system-design/diagram-upload",
                body,
                session.access_token
            );
            const diagram = response.diagram || { url: response.fileUrl, source: "upload" as const, filename: file.name, contentType: file.type, size: file.size };
            update("referenceDiagram", diagram);
            update("sampleDiagramUrl", diagram.url);
            setDiagramMode("upload");
        } catch (err) {
            setDiagramError(err instanceof ApiError ? err.message : "Failed to upload reference diagram.");
        } finally {
            setUploadingDiagram(false);
        }
    }

    async function handleSubmit(event: React.FormEvent) {
        event.preventDefault();
        if (!canSubmit) {
            setError("Please complete the prompt, valid rubric JSON, a valid diagram URL if provided, and at least one tag before adding.");
            return;
        }

        const referenceDiagram = formData.referenceDiagram?.url
            ? formData.referenceDiagram
            : formData.sampleDiagramUrl.trim()
                ? { url: formData.sampleDiagramUrl.trim(), source: "url" as const }
                : null;

        setLoading(true);
        setError(null);
        setSuccess(false);
        try {
            await api.post("/companies/question-bank/system-design", {
                title: formData.title.trim(),
                slug: (formData.slug.trim() || slugify(formData.title)),
                difficulty: formData.difficulty,
                problemStatement: formData.problemStatement.trim(),
                rubricLite: rubricLiteParsed,
                rubricFull: rubricFullParsed,
                hints: formData.hints.map((hint) => hint.trim()).filter(Boolean),
                followUpQuestions: formData.followUpQuestions.map((question) => question.trim()).filter(Boolean),
                sampleDiagramUrl: referenceDiagram?.url || null,
                referenceDiagram,
                architectureDiagram: null,
                tags: formData.tags,
                status: formData.status,
            }, session?.access_token);
            if (typeof window !== "undefined") window.localStorage.removeItem(FORM_DRAFT_KEY);
            setSuccess(true);
            setTimeout(() => {
                window.location.href = "/question-bank/system-design";
            }, 1000);
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "Failed to add system design question.");
        } finally {
            setLoading(false);
        }
    }

    return (
        <main className="min-h-full bg-[#FAFBFC] px-4 py-8 dark:bg-lc-bg sm:px-6 lg:px-10">
            <div className="mx-auto max-w-6xl">
                <div className="mb-8">
                    <Link href="/question-bank/system-design" className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-slate-500 transition hover:text-primary dark:text-slate-400">
                        <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                        Back to system design
                    </Link>
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Company Question Bank</p>
                    <h1 className="mt-2 font-nunito text-3xl font-extrabold tracking-tight text-slate-950 dark:text-white sm:text-4xl">
                        Create System Design Question
                    </h1>
                </div>

                <form onSubmit={handleSubmit} className="space-y-6">
                    {success && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4"><p className="font-semibold text-emerald-800">System design question added successfully. Returning to the question bank...</p></div>}
                    {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4"><p className="font-semibold text-red-800">{error}</p></div>}

                    <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-lc-surface dark:ring-lc-border">
                        <div className="flex overflow-x-auto border-b border-slate-200 bg-white dark:border-lc-border dark:bg-lc-surface">
                            {["Prompt", "Rubric", "Guidance", "Preview"].map((step, index) => (
                                <button key={step} type="button" onClick={() => setActiveStep(index)} className={`group relative flex min-w-[210px] items-center gap-4 whitespace-nowrap px-7 py-5 text-sm font-extrabold uppercase tracking-[0.02em] transition-colors ${activeStep === index ? "text-primary" : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"}`}>
                                    {index < 3 && <span className="pointer-events-none absolute right-0 top-0 h-full w-8 translate-x-1/2 skew-x-[-24deg] border-r border-slate-200 bg-white group-hover:bg-slate-50 dark:border-lc-border dark:bg-lc-surface" />}
                                    <span className={`relative z-10 grid size-9 place-items-center rounded-full border-2 text-sm font-extrabold ${activeStep === index ? "border-primary bg-primary text-white" : "border-slate-300 bg-white text-slate-400 dark:border-lc-border dark:bg-lc-elevated"}`}>{index + 1}</span>
                                    <span className="relative z-10">{step}</span>
                                </button>
                            ))}
                            <div className="ml-auto hidden items-center px-6 text-xs font-extrabold uppercase tracking-[0.14em] text-slate-400 lg:flex">{autosaveStatus}</div>
                        </div>

                        <div className="p-6 sm:p-8">
                            <div className="mb-5 text-xs font-extrabold uppercase tracking-[0.14em] text-slate-400 lg:hidden">{autosaveStatus}</div>
                            {activeStep === 0 && (
                                <Panel title="Prompt" action={<button type="button" onClick={() => setPromptGuidelinesOpen(true)} className="rounded-full bg-primary/10 px-4 py-2 text-sm font-extrabold text-primary transition hover:bg-primary hover:text-white">Guidelines</button>}>
                                    <div className="grid gap-5 lg:grid-cols-[1fr_220px]">
                                        <Field label="Title" value={formData.title} onChange={(value) => {
                                            update("title", value);
                                            if (!formData.slug.trim()) update("slug", slugify(value));
                                        }} placeholder="Design a notification system" />
                                        <label className="block">
                                            <span className="text-sm font-extrabold text-slate-700 dark:text-slate-200">Difficulty</span>
                                            <select value={formData.difficulty} onChange={(event) => update("difficulty", event.target.value as Difficulty)} className="mt-2 h-12 w-full rounded-lg border border-slate-200 px-4 text-sm font-semibold outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-elevated dark:text-white">
                                                <option>Easy</option>
                                                <option>Medium</option>
                                                <option>Hard</option>
                                            </select>
                                        </label>
                                    </div>
                                    <Field label="Slug" value={formData.slug} onChange={(value) => update("slug", slugify(value))} placeholder="design-a-notification-system" />
                                    <TextArea label="Problem statement" value={formData.problemStatement} onChange={(value) => update("problemStatement", value)} rows={12} placeholder={PROMPT_EXAMPLE} />
                                    <div>
                                        <div className="mb-3 flex items-center justify-between">
                                            <span className="text-sm font-extrabold text-slate-700 dark:text-slate-200">Tags</span>
                                            <span className="text-xs font-bold text-slate-400">At least 1 required</span>
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            {suggestedTags.map((tag) => {
                                                const active = formData.tags.includes(tag);
                                                return <button key={tag} type="button" onClick={() => toggleTag(tag)} className={`rounded-full px-3 py-1.5 text-sm font-extrabold transition ${active ? "bg-primary text-white" : "bg-slate-100 text-slate-600 hover:bg-primary/10 hover:text-primary dark:bg-lc-elevated dark:text-slate-300 dark:hover:bg-lc-hover dark:hover:text-white"}`}>{tag}</button>;
                                            })}
                                        </div>
                                    </div>
                                </Panel>
                            )}

                            {activeStep === 1 && (
                                <Panel title="Rubric" action={<button type="button" onClick={() => setRubricGuidelinesOpen(true)} className="rounded-full bg-primary/10 px-4 py-2 text-sm font-extrabold text-primary transition hover:bg-primary hover:text-white">Guidelines</button>}>
                                    <TextArea label="Lite rubric JSON" value={formData.rubricLite} onChange={(value) => update("rubricLite", value)} rows={13} placeholder={RUBRIC_LITE_EXAMPLE} />
                                    {formData.rubricLite.trim() && !jsonIsObject(formData.rubricLite) && <p className="text-sm font-bold text-red-600">Lite rubric must be valid JSON object.</p>}
                                    <TextArea label="Full rubric JSON" value={formData.rubricFull} onChange={(value) => update("rubricFull", value)} rows={13} placeholder={RUBRIC_FULL_EXAMPLE} />
                                    {formData.rubricFull.trim() && !jsonIsObject(formData.rubricFull) && <p className="text-sm font-bold text-red-600">Full rubric must be valid JSON object.</p>}
                                </Panel>
                            )}

                            {activeStep === 2 && (
                                <Panel title="Guidance">
                                    <EditableList title="Hints" items={formData.hints} onAdd={() => update("hints", [...formData.hints, ""])} onChange={(items) => update("hints", items)} placeholder="Start by clarifying scale, latency, availability, and consistency requirements." />
                                    <EditableList title="Follow-up questions" items={formData.followUpQuestions} onAdd={() => update("followUpQuestions", [...formData.followUpQuestions, ""])} onChange={(items) => update("followUpQuestions", items)} placeholder="How would the design change if notifications must be exactly-once?" />
                                    <ReferenceDiagramPicker
                                        mode={diagramMode}
                                        onModeChange={setDiagramMode}
                                        url={formData.sampleDiagramUrl}
                                        diagram={formData.referenceDiagram}
                                        onUrlChange={updateDiagramUrl}
                                        onUpload={uploadReferenceDiagram}
                                        uploading={uploadingDiagram}
                                        error={diagramError}
                                    />
                                </Panel>
                            )}

                            {activeStep === 3 && (
                                <Panel title="Preview">
                                    <div className="space-y-6">
                                        <div className="flex flex-wrap gap-2">
                                            <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-extrabold text-primary">{formData.difficulty}</span>
                                            {formData.tags.map((tag) => <span key={tag} className="rounded-full bg-slate-100 px-3 py-1 text-sm font-extrabold text-slate-600 dark:bg-lc-elevated dark:text-slate-300">{tag}</span>)}
                                        </div>
                                        <section>
                                            <h2 className="font-nunito text-2xl font-extrabold text-slate-950 dark:text-white">{formData.title || "Question preview"}</h2>
                                            <p className="mt-3 whitespace-pre-wrap text-sm font-semibold leading-7 text-slate-600 dark:text-slate-300">{formData.problemStatement || "Problem statement preview will appear here."}</p>
                                        </section>
                                        {!!formData.hints.filter(Boolean).length && <PreviewList title="Hints" items={formData.hints} />}
                                        {!!formData.followUpQuestions.filter(Boolean).length && <PreviewList title="Follow-up Questions" items={formData.followUpQuestions} />}
                                        {selectedDiagramUrl && (
                                            <section>
                                                <h3 className="mb-3 font-nunito text-xl font-extrabold text-slate-950 dark:text-white">Reference Diagram</h3>
                                                <img src={selectedDiagramUrl} alt="Reference diagram preview" className="max-h-[420px] w-full rounded-lg object-contain ring-1 ring-slate-200 dark:ring-lc-border" />
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
                            {activeStep < 3 && <button type="button" onClick={() => setActiveStep(activeStep + 1)} className="rounded-full bg-primary px-6 py-3 text-sm font-extrabold text-white transition hover:bg-primary/90">Next</button>}
                        </div>
                        <button type="submit" disabled={loading || !canSubmit} className="rounded-full bg-emerald-600 px-8 py-3 text-sm font-extrabold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50">{loading ? "Adding..." : "Add"}</button>
                    </div>
                </form>
            </div>

            {promptGuidelinesOpen && (
                <GuidelinesModal title="Prompt Guidelines" onClose={() => setPromptGuidelinesOpen(false)}>
                    <p>State the system to design clearly.</p>
                    <p>Include functional requirements, such as core user actions, API behavior, workflows, and product features.</p>
                    <p>Include non-functional requirements, such as scale, latency, availability, consistency, reliability, cost, and security expectations.</p>
                    <p>Add concrete numbers when useful: users, requests per second, data volume, retention, regions, or latency target.</p>
                    <pre className="mt-4 whitespace-pre-wrap rounded-lg bg-slate-50 p-4 text-xs font-bold leading-5 text-slate-600 dark:bg-lc-elevated dark:text-slate-300">{PROMPT_EXAMPLE}</pre>
                </GuidelinesModal>
            )}

            {rubricGuidelinesOpen && (
                <GuidelinesModal title="Rubric Guidelines" onClose={() => setRubricGuidelinesOpen(false)}>
                    <p>Rubrics must be valid JSON objects. The form stores them as structured data for evaluation.</p>
                    <p>Lite rubric is for quick interview guidance: required components, tradeoffs, anti-patterns, and follow-up triggers.</p>
                    <p>Full rubric is for deeper evaluation: sample answer and scoring dimensions with criteria and weights.</p>
                    <pre className="mt-4 whitespace-pre-wrap rounded-lg bg-slate-50 p-4 text-xs font-bold leading-5 text-slate-600 dark:bg-lc-elevated dark:text-slate-300">{RUBRIC_LITE_EXAMPLE}</pre>
                    <pre className="mt-4 whitespace-pre-wrap rounded-lg bg-slate-50 p-4 text-xs font-bold leading-5 text-slate-600 dark:bg-lc-elevated dark:text-slate-300">{RUBRIC_FULL_EXAMPLE}</pre>
                </GuidelinesModal>
            )}
        </main>
    );
}

function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
    return (
        <section className="space-y-5 rounded-xl bg-white p-5 ring-1 ring-slate-200 dark:bg-lc-surface dark:ring-lc-border">
            <div className="flex items-center justify-between gap-4">
                <h2 className="font-nunito text-xl font-extrabold text-slate-950 dark:text-white">{title}</h2>
                {action}
            </div>
            {children}
        </section>
    );
}

function ReferenceDiagramPicker({
    mode,
    onModeChange,
    url,
    diagram,
    onUrlChange,
    onUpload,
    uploading,
    error,
}: {
    mode: "url" | "upload";
    onModeChange: (mode: "url" | "upload") => void;
    url: string;
    diagram: ReferenceDiagram | null;
    onUrlChange: (value: string) => void;
    onUpload: (file: File | null) => void;
    uploading: boolean;
    error: string | null;
}) {
    const hasInvalidUrl = Boolean(url.trim()) && !optionalUrlIsValid(url);

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm font-extrabold text-slate-700 dark:text-slate-200">Reference diagram</span>
                <div className="inline-flex rounded-full bg-slate-100 p-1 dark:bg-lc-elevated">
                    <button type="button" onClick={() => onModeChange("url")} className={`h-9 rounded-full px-4 text-sm font-extrabold transition ${mode === "url" ? "bg-primary text-white" : "text-slate-600 hover:text-primary dark:text-slate-300"}`}>URL</button>
                    <button type="button" onClick={() => onModeChange("upload")} className={`h-9 rounded-full px-4 text-sm font-extrabold transition ${mode === "upload" ? "bg-primary text-white" : "text-slate-600 hover:text-primary dark:text-slate-300"}`}>Upload</button>
                </div>
            </div>

            {mode === "url" ? (
                <label className="block">
                    <input value={url} onChange={(event) => onUrlChange(event.target.value)} placeholder="https://example.com/architecture-diagram.png" className="h-12 w-full rounded-lg border border-slate-200 px-4 text-sm font-semibold outline-none transition placeholder:text-slate-400 focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-elevated dark:text-white" />
                    {hasInvalidUrl && <span className="mt-2 block text-sm font-bold text-red-600">Enter a valid http or https URL.</span>}
                </label>
            ) : (
                <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center transition hover:border-primary hover:bg-primary/5 dark:border-lc-border dark:bg-lc-elevated">
                    <span className="material-symbols-outlined text-3xl text-primary">upload_file</span>
                    <span className="mt-2 text-sm font-extrabold text-slate-800 dark:text-white">{uploading ? "Uploading..." : "Choose image from device"}</span>
                    <span className="mt-1 text-xs font-bold text-slate-500 dark:text-slate-400">JPEG, PNG, or WebP under 5MB</span>
                    <input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={(event) => void onUpload(event.target.files?.[0] || null)} className="sr-only" />
                </label>
            )}

            {diagram?.source === "upload" && diagram.filename && <p className="text-sm font-bold text-slate-500 dark:text-slate-400">Uploaded: {diagram.filename}</p>}
            {error && <p className="text-sm font-bold text-red-600">{error}</p>}
        </div>
    );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
    return <label className="block"><span className="text-sm font-extrabold text-slate-700 dark:text-slate-200">{label}</span><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="mt-2 h-12 w-full rounded-lg border border-slate-200 px-4 text-sm font-semibold outline-none transition placeholder:text-slate-400 focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-elevated dark:text-white" /></label>;
}

function TextArea({ label, value, onChange, rows, placeholder }: { label: string; value: string; onChange: (value: string) => void; rows: number; placeholder?: string }) {
    return <label className="block"><span className="text-sm font-extrabold text-slate-700 dark:text-slate-200">{label}</span><textarea value={value} onChange={(event) => onChange(event.target.value)} rows={rows} placeholder={placeholder} className="mt-2 w-full resize-y rounded-lg border border-slate-200 px-4 py-3 font-mono text-sm font-semibold leading-6 outline-none transition placeholder:text-slate-400 focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-elevated dark:text-white" /></label>;
}

function EditableList({ title, items, onAdd, onChange, placeholder }: { title: string; items: string[]; onAdd: () => void; onChange: (items: string[]) => void; placeholder: string }) {
    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between gap-4">
                <h3 className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">{title}</h3>
                <button type="button" onClick={onAdd} className="rounded-full bg-primary/10 px-4 py-2 text-sm font-extrabold text-primary transition hover:bg-primary hover:text-white">Add</button>
            </div>
            {items.map((item, index) => (
                <div key={index} className="flex gap-2">
                    <input value={item} onChange={(event) => onChange(items.map((current, itemIndex) => itemIndex === index ? event.target.value : current))} placeholder={placeholder} className="h-12 min-w-0 flex-1 rounded-lg border border-slate-200 px-4 text-sm font-semibold outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-elevated dark:text-white" />
                    {items.length > 1 && <button type="button" onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))} className="grid size-12 place-items-center rounded-full text-slate-400 transition hover:bg-red-50 hover:text-red-600" aria-label="Remove"><span className="material-symbols-outlined text-[20px]">remove</span></button>}
                </div>
            ))}
        </div>
    );
}

function PreviewList({ title, items }: { title: string; items: string[] }) {
    const visibleItems = items.map((item) => item.trim()).filter(Boolean);
    return <section><h3 className="mb-3 font-nunito text-xl font-extrabold text-slate-950 dark:text-white">{title}</h3><ul className="space-y-2 text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">{visibleItems.map((item, index) => <li key={index}>{item}</li>)}</ul></section>;
}

function GuidelinesModal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
    return (
        <div className="fixed inset-0 z-[180] grid place-items-center bg-slate-950/60 px-4 backdrop-blur-sm">
            <div className="max-h-[86vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-6 shadow-2xl dark:bg-lc-surface">
                <div className="flex items-start justify-between gap-4">
                    <h3 className="font-nunito text-2xl font-extrabold text-slate-950 dark:text-white">{title}</h3>
                    <button type="button" onClick={onClose} className="grid size-9 place-items-center rounded-full text-slate-500 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-lc-hover" aria-label="Close guidelines">
                        <span className="material-symbols-outlined">close</span>
                    </button>
                </div>
                <div className="mt-5 space-y-3 text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">
                    {children}
                </div>
            </div>
        </div>
    );
}
