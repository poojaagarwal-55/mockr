"use client";

import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useCompanyAuth } from "@/context/company-auth-context";

type Difficulty = "Easy" | "Medium" | "Hard";

export type SQLQuestionData = {
    title: string;
    description: string;
    schema: string;
    examples: Array<{ input: string; output: string; explanation: string }>;
    testCases: Array<{ id: string; label: string; input: string; expected_output: string }>;
    hiddenTestCases: Array<{ id: string; label: string; expected_output: string; wrapper_code: string }>;
    wrapperCode: string;
    solution: string;
    judge0LanguageId: number;
    difficulty: Difficulty;
    tags: string[];
    status: "draft" | "published" | "archived";
};

type SQLQuestionFormProps = {
    initialData?: SQLQuestionData;
    onPreview: (data: SQLQuestionData) => void;
};

const FORM_DRAFT_KEY = "company-sql-question-draft";
const tabs = ["Question", "SQL Setup", "Test Cases", "Solution", "Quality Check"];
const suggestedTags = ["Joins", "Aggregation", "Window Functions", "Subqueries", "Sorting", "Filtering", "CTE", "Schema Design"];
const EXPECTED_OUTPUT_JSON_EXAMPLE = `[
  { "id": 4 },
  { "id": 7 }
]`;
const HIDDEN_WRAPPER_SQL_EXAMPLE = `CREATE TABLE Views (
  article_id INT,
  author_id INT,
  viewer_id INT,
  view_date DATE
);

INSERT INTO Views (article_id, author_id, viewer_id, view_date) VALUES
(1, 2, 2, '2024-01-01'),
(2, 3, 4, '2024-01-02');`;
const HIDDEN_OUTPUT_JSON_EXAMPLE = `[
  { "id": 2 }
]`;

function defaultQuestionData(): SQLQuestionData {
    return {
        title: "",
        description: "",
        schema: "",
        examples: [{ input: "", output: "", explanation: "" }],
        testCases: [{ id: "sample_1", label: "Visible sample", input: "", expected_output: "" }],
        hiddenTestCases: [{ id: "hidden_1", label: "Hidden judge case", expected_output: "", wrapper_code: "" }],
        wrapperCode: "",
        solution: "",
        judge0LanguageId: 82,
        difficulty: "Medium",
        tags: ["SQL"],
        status: "published",
    };
}

export function SQLQuestionForm({ initialData, onPreview }: SQLQuestionFormProps) {
    const { session } = useCompanyAuth();
    const [formData, setFormData] = useState<SQLQuestionData>(() => {
        if (initialData) return initialData;
        if (typeof window !== "undefined") {
            try {
                const saved = window.localStorage.getItem(FORM_DRAFT_KEY);
                if (saved) return JSON.parse(saved) as SQLQuestionData;
            } catch {
                // Ignore malformed local drafts.
            }
        }
        return defaultQuestionData();
    });
    const [activeTab, setActiveTab] = useState(0);
    const [autosaveStatus, setAutosaveStatus] = useState("Draft not saved yet");
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [guidelinesOpen, setGuidelinesOpen] = useState(false);
    const [setupGuidelinesOpen, setSetupGuidelinesOpen] = useState(false);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const timeout = window.setTimeout(() => {
            window.localStorage.setItem(FORM_DRAFT_KEY, JSON.stringify(formData));
            setAutosaveStatus(`Saved ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
        }, 500);

        return () => window.clearTimeout(timeout);
    }, [formData]);

    const completedSampleCases = formData.testCases.filter((testCase) => testCase.expected_output.trim());
    const completedHiddenCases = formData.hiddenTestCases.filter((testCase) => testCase.expected_output.trim() && testCase.wrapper_code.trim());
    const hasSample = completedSampleCases.length > 0 && completedSampleCases.every((testCase) => isValidJson(testCase.expected_output));
    const hasHidden = completedHiddenCases.length > 0 && completedHiddenCases.every((testCase) => isValidJson(testCase.expected_output));
    const canSubmit =
        Boolean(formData.title.trim()) &&
        Boolean(formData.description.trim()) &&
        Boolean(formData.wrapperCode.trim()) &&
        Boolean(formData.solution.trim()) &&
        formData.tags.length > 0 &&
        hasSample &&
        hasHidden;

    const sampleCount = completedSampleCases.filter((testCase) => isValidJson(testCase.expected_output)).length;
    const hiddenCount = completedHiddenCases.filter((testCase) => isValidJson(testCase.expected_output)).length;

    function formPayload() {
        return {
            ...formData,
            judge0LanguageId: 82,
            examples: formData.examples.filter((example) => example.input.trim() || example.output.trim() || example.explanation.trim()),
            testCases: formData.testCases
                .filter((testCase) => testCase.expected_output.trim())
                .map((testCase) => ({ ...testCase, input: "" })),
            hiddenTestCases: formData.hiddenTestCases.filter((testCase) => testCase.expected_output.trim() && testCase.wrapper_code.trim()),
        };
    }

    function previewFormData() {
        return {
            ...formData,
            testCases: formData.testCases.map((testCase) => ({ ...testCase, input: "" })),
        };
    }

    async function handleSubmit(event: React.FormEvent) {
        event.preventDefault();
        if (!canSubmit) {
            setError("Please complete the question, SQL setup, solution, at least one visible sample output JSON, and one hidden test with valid output JSON before adding.");
            return;
        }

        setLoading(true);
        setError(null);
        setSuccess(false);
        try {
            await api.post("/companies/question-bank/sql", formPayload(), session?.access_token);
            if (typeof window !== "undefined") window.localStorage.removeItem(FORM_DRAFT_KEY);
            setSuccess(true);
            setTimeout(() => {
                window.location.href = "/question-bank/sql";
            }, 1000);
        } catch (err: any) {
            setError(err.message || "Failed to add SQL question.");
        } finally {
            setLoading(false);
        }
    }

    function update<K extends keyof SQLQuestionData>(key: K, value: SQLQuestionData[K]) {
        setFormData((current) => ({ ...current, [key]: value }));
    }

    const reviewItems = useMemo(() => [
        { label: "Sample tests", value: sampleCount, note: "1 sample test case is recommended.", target: 2 },
        { label: "Hidden tests", value: hiddenCount, note: "Hidden tests should include edge cases and alternate schemas.", target: 2 },
        { label: "Tags", value: formData.tags.length, note: "At least 2 tags per question are recommended.", target: 0 },
        { label: "SQL setup", value: formData.wrapperCode.trim() ? 1 : 0, note: "Wrapper setup should create tables and seed rows.", target: 1 },
    ], [formData.tags.length, formData.wrapperCode, hiddenCount, sampleCount]);

    return (
        <form onSubmit={handleSubmit} className="space-y-6">
            {success && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                    <p className="font-semibold text-emerald-800">SQL question added successfully. Returning to the question bank...</p>
                </div>
            )}
            {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                    <p className="font-semibold text-red-800">{error}</p>
                </div>
            )}

            <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
                <div className="flex overflow-x-auto border-b border-slate-200 bg-white">
                    {tabs.map((tab, index) => (
                        <button key={tab} type="button" onClick={() => setActiveTab(index)} className={`group relative flex min-w-[210px] items-center gap-4 whitespace-nowrap px-7 py-5 text-sm font-extrabold uppercase tracking-[0.02em] transition-colors ${activeTab === index ? "text-primary" : "text-slate-500 hover:text-slate-900"}`}>
                            {index < tabs.length - 1 && <span className="pointer-events-none absolute right-0 top-0 h-full w-8 translate-x-1/2 skew-x-[-24deg] border-r border-slate-200 bg-white group-hover:bg-slate-50" />}
                            <span className={`relative z-10 grid size-9 place-items-center rounded-full border-2 text-sm font-extrabold ${activeTab === index ? "border-primary bg-primary text-white" : "border-slate-300 bg-white text-slate-400"}`}>{index + 1}</span>
                            <span className="relative z-10">{tab}</span>
                        </button>
                    ))}
                    <div className="ml-auto hidden items-center px-6 text-xs font-extrabold uppercase tracking-[0.14em] text-slate-400 lg:flex">{autosaveStatus}</div>
                </div>

                <div className="p-6 sm:p-8">
                    <div className="mb-5 text-xs font-extrabold uppercase tracking-[0.14em] text-slate-400 lg:hidden">{autosaveStatus}</div>
                    {activeTab === 0 && (
                        <div className="space-y-6">
                            <Panel title="Question Details">
                                <div className="grid gap-5 lg:grid-cols-[1fr_220px]">
                                    <Field label="Question title" value={formData.title} onChange={(value) => update("title", value)} placeholder="Customers with rising monthly spend" />
                                    <label className="block">
                                        <span className="text-sm font-extrabold text-slate-700">Difficulty</span>
                                        <select value={formData.difficulty} onChange={(event) => update("difficulty", event.target.value as Difficulty)} className="mt-2 h-12 w-full rounded-lg border border-slate-200 px-4 text-sm font-semibold outline-none focus:border-primary focus:ring-4 focus:ring-primary/10">
                                            <option>Easy</option>
                                            <option>Medium</option>
                                            <option>Hard</option>
                                        </select>
                                    </label>
                                </div>
                                <TextArea label="Question description" value={formData.description} onChange={(value) => update("description", value)} rows={7} placeholder="Describe the query the candidate should write and the expected result." />
                                <div>
                                    <div className="mb-3 flex items-center justify-between">
                                        <span className="text-sm font-extrabold text-slate-700">Tags</span>
                                        <span className="text-xs font-bold text-slate-400">At least 2 recommended</span>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {suggestedTags.map((tag) => {
                                            const active = formData.tags.includes(tag);
                                            return (
                                                <button key={tag} type="button" onClick={() => update("tags", active ? formData.tags.filter((item) => item !== tag) : [...formData.tags, tag])} className={`rounded-full px-3 py-1.5 text-sm font-extrabold transition ${active ? "bg-primary text-white" : "bg-slate-100 text-slate-600 hover:bg-primary/10 hover:text-primary"}`}>
                                                    {tag}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            </Panel>
                        </div>
                    )}
                    {activeTab === 1 && (
                        <Panel title="SQL Setup" action={<button type="button" onClick={() => setSetupGuidelinesOpen(true)} className="rounded-full bg-primary/10 px-4 py-2 text-sm font-extrabold text-primary transition hover:bg-primary hover:text-white">Guidelines</button>}>
                            <TextArea label="Database schema" value={formData.schema} onChange={(value) => update("schema", value)} rows={8} placeholder={"CREATE TABLE customers (...);\nCREATE TABLE orders (...);"} />
                            <TextArea label="Wrapper setup code" value={formData.wrapperCode} onChange={(value) => update("wrapperCode", value)} rows={10} placeholder={"CREATE TABLE ...;\nINSERT INTO ...;"} />
                        </Panel>
                    )}
                    {activeTab === 2 && (
                        <Panel title="Test Cases" action={<button type="button" onClick={() => setGuidelinesOpen(true)} className="rounded-full bg-primary/10 px-4 py-2 text-sm font-extrabold text-primary transition hover:bg-primary hover:text-white">Guidelines</button>}>
                            <div className="rounded-lg bg-primary/5 p-4 ring-1 ring-primary/10">
                                <p className="text-sm font-semibold leading-6 text-slate-600">
                                    Visible samples only need expected output JSON. The input data comes from the rows already inserted in SQL Setup. Hidden tests use their own wrapper setup and expected output JSON for that hidden data.
                                </p>
                            </div>
                            <SampleTestCasesBuilder
                                items={formData.testCases}
                                onAdd={() => update("testCases", [...formData.testCases, { id: `sample_${formData.testCases.length + 1}`, label: "Visible sample", input: "", expected_output: "" }])}
                                onChange={(items) => update("testCases", items)}
                            />
                            <EditableList
                                title="Hidden Judge Tests"
                                items={formData.hiddenTestCases}
                                onAdd={() => update("hiddenTestCases", [...formData.hiddenTestCases, { id: `hidden_${formData.hiddenTestCases.length + 1}`, label: "Hidden judge case", expected_output: "", wrapper_code: "" }])}
                                onChange={(items) => update("hiddenTestCases", items)}
                                fields={["label", "wrapper_code", "expected_output"]}
                                helperText="Each hidden test creates the same tables with different inserted rows. Write expected output as JSON so it can be parsed reliably."
                            />
                        </Panel>
                    )}
                    {activeTab === 3 && (
                        <Panel title="Solution">
                            <TextArea
                                label="Solution query"
                                value={formData.solution}
                                onChange={(value) => update("solution", value)}
                                rows={12}
                                placeholder={"SELECT author_id AS id\nFROM Views\nWHERE author_id = viewer_id\nGROUP BY author_id\nORDER BY id;"}
                            />
                            <p className="text-sm font-semibold text-slate-500">Press Enter normally for new lines. The preview keeps the same formatting.</p>
                        </Panel>
                    )}
                    {activeTab === 4 && (
                        <div className="space-y-6">
                            <Panel title="Quality Check">
                                <div className="grid gap-3 md:grid-cols-2">
                                    {reviewItems.map((item) => (
                                        <div key={item.label} className="rounded-lg bg-slate-50 p-4 ring-1 ring-slate-200">
                                            <div className="flex items-start justify-between gap-4">
                                                <div>
                                                    <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-slate-400">{item.label}</p>
                                                    <p className="mt-2 font-nunito text-3xl font-extrabold text-slate-950">{item.value}</p>
                                                    <p className="mt-1 text-sm font-semibold text-slate-500">{item.note}</p>
                                                </div>
                                                <button type="button" onClick={() => setActiveTab(item.target)} className="rounded-full bg-white px-3 py-1.5 text-xs font-extrabold text-primary ring-1 ring-primary/20 transition hover:bg-primary/10">Review</button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </Panel>
                            <button type="button" onClick={() => onPreview(previewFormData())} className="inline-flex h-12 items-center justify-center rounded-full bg-primary px-6 text-sm font-extrabold text-white shadow-lg shadow-primary/20 transition hover:bg-primary/90">Preview Question</button>
                        </div>
                    )}
                </div>
            </div>

            <div className="flex flex-col gap-4 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex gap-3">
                    {activeTab > 0 && <button type="button" onClick={() => setActiveTab(activeTab - 1)} className="rounded-full border border-slate-200 px-6 py-3 text-sm font-extrabold text-slate-700 transition hover:bg-slate-50">Previous</button>}
                    {activeTab < tabs.length - 1 && <button type="button" onClick={() => setActiveTab(activeTab + 1)} className="rounded-full bg-primary px-6 py-3 text-sm font-extrabold text-white transition hover:bg-primary/90">Next</button>}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <button type="button" onClick={() => onPreview(previewFormData())} className="rounded-full border border-primary/30 px-6 py-3 text-sm font-extrabold text-primary transition hover:bg-primary/10">Preview</button>
                    <button type="submit" disabled={loading || !canSubmit} className="rounded-full bg-emerald-600 px-8 py-3 text-sm font-extrabold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50" title={!canSubmit ? "Complete required SQL fields, tests, and setup before adding." : ""}>{loading ? "Adding..." : "Add"}</button>
                </div>
            </div>

            {guidelinesOpen && (
                <div className="fixed inset-0 z-[180] grid place-items-center bg-slate-950/60 px-4 backdrop-blur-sm">
                    <div className="w-full max-w-xl rounded-xl bg-white p-6 shadow-2xl">
                        <div className="flex items-start justify-between gap-4">
                            <h3 className="font-nunito text-2xl font-extrabold text-slate-950">SQL Test Guidelines</h3>
                            <button type="button" onClick={() => setGuidelinesOpen(false)} className="grid size-9 place-items-center rounded-full text-slate-500 transition hover:bg-slate-100" aria-label="Close guidelines">
                                <span className="material-symbols-outlined">close</span>
                            </button>
                        </div>
                        <div className="mt-5 space-y-3 text-sm font-semibold leading-6 text-slate-600">
                            <p>Visible sample tests only need expected output JSON. The input data is the SQL Setup wrapper data.</p>
                            <p>Hidden tests should include their own wrapper setup: create the same tables, then insert different rows for judging.</p>
                            <p>Hidden expected output must also be JSON and must match the result of the correct solution on that hidden wrapper data.</p>
                            <p>Use hidden tests to cover empty result sets, duplicate rows, ties, nulls, and boundary dates or amounts.</p>
                            <p>1 sample test is recommended. Add multiple hidden tests to prevent hardcoded sample answers.</p>
                        </div>
                    </div>
                </div>
            )}
            {setupGuidelinesOpen && (
                <div className="fixed inset-0 z-[180] grid place-items-center bg-slate-950/60 px-4 backdrop-blur-sm">
                    <div className="w-full max-w-xl rounded-xl bg-white p-6 shadow-2xl">
                        <div className="flex items-start justify-between gap-4">
                            <h3 className="font-nunito text-2xl font-extrabold text-slate-950">SQL Setup Guidelines</h3>
                            <button type="button" onClick={() => setSetupGuidelinesOpen(false)} className="grid size-9 place-items-center rounded-full text-slate-500 transition hover:bg-slate-100" aria-label="Close guidelines">
                                <span className="material-symbols-outlined">close</span>
                            </button>
                        </div>
                        <div className="mt-5 space-y-3 text-sm font-semibold leading-6 text-slate-600">
                            <p>Database schema is for preview and readability. It should tell the recruiter and candidate what tables and columns exist.</p>
                            <p>Wrapper setup code is used for execution. It should create the tables and insert the sample or default rows before the submitted query runs.</p>
                            <p>Keep table and column names exactly the same in the schema, wrapper setup, sample tables, hidden tests, and solution query.</p>
                        </div>
                    </div>
                </div>
            )}
        </form>
    );
}

function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
    return (
        <section className="space-y-5 rounded-xl bg-white p-5 ring-1 ring-slate-200">
            <div className="flex items-center justify-between gap-4">
                <h2 className="font-nunito text-xl font-extrabold text-slate-950">{title}</h2>
                {action}
            </div>
            {children}
        </section>
    );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
    return (
        <label className="block">
            <span className="text-sm font-extrabold text-slate-700">{label}</span>
            <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="mt-2 h-12 w-full rounded-lg border border-slate-200 px-4 text-sm font-semibold outline-none transition placeholder:text-slate-400 focus:border-primary focus:ring-4 focus:ring-primary/10" />
        </label>
    );
}

function TextArea({ label, value, onChange, rows, placeholder }: { label: string; value: string; onChange: (value: string) => void; rows: number; placeholder?: string }) {
    return (
        <label className="block">
            <span className="text-sm font-extrabold text-slate-700">{label}</span>
            <textarea value={value} onChange={(event) => onChange(event.target.value)} rows={rows} placeholder={placeholder} className="mt-2 w-full resize-y rounded-lg border border-slate-200 px-4 py-3 font-mono text-sm font-semibold leading-6 outline-none transition placeholder:text-slate-400 focus:border-primary focus:ring-4 focus:ring-primary/10" />
        </label>
    );
}

function isValidJson(value: string) {
    if (!value.trim()) return false;
    try {
        JSON.parse(value);
        return true;
    } catch {
        return false;
    }
}

function SampleTestCasesBuilder({
    items,
    onAdd,
    onChange,
}: {
    items: Array<{ id: string; label: string; input: string; expected_output: string }>;
    onAdd: () => void;
    onChange: (items: Array<{ id: string; label: string; input: string; expected_output: string }>) => void;
}) {
    function updateItem(index: number, patch: Partial<{ id: string; label: string; input: string; expected_output: string }>) {
        onChange(items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
                <div>
                    <h3 className="font-nunito text-lg font-extrabold text-slate-950">Visible Sample Tests</h3>
                    <p className="mt-1 text-sm font-semibold text-slate-500">Paste the expected output as JSON for the SQL Setup data. No separate sample input is needed.</p>
                </div>
                <button type="button" onClick={onAdd} className="rounded-full bg-primary/10 px-4 py-2 text-sm font-extrabold text-primary transition hover:bg-primary hover:text-white">Add sample</button>
            </div>

            <div className="space-y-4">
                {items.map((item, index) => (
                    <div key={item.id || index} className="space-y-5 rounded-lg bg-slate-50 p-4 ring-1 ring-slate-200">
                        <div className="flex items-center justify-between gap-4">
                            <Field label={`Sample ${index + 1} label`} value={item.label} onChange={(value) => updateItem(index, { label: value })} placeholder="Basic case" />
                            {items.length > 1 && (
                                <button type="button" onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))} className="mt-7 grid size-9 shrink-0 place-items-center rounded-full text-slate-400 transition hover:bg-red-50 hover:text-red-600" aria-label="Remove sample">
                                    <span className="material-symbols-outlined text-[20px]">remove</span>
                                </button>
                            )}
                        </div>
                        <TextArea
                            label="Expected output JSON"
                            value={item.expected_output}
                            onChange={(value) => updateItem(index, { expected_output: value })}
                            rows={7}
                            placeholder={EXPECTED_OUTPUT_JSON_EXAMPLE}
                        />
                        {item.expected_output.trim() && !isValidJson(item.expected_output) && (
                            <p className="text-sm font-bold text-red-600">Expected output must be valid JSON.</p>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

function EditableList<T extends Record<string, string>>({
    title,
    items,
    onAdd,
    onChange,
    fields,
    helperText,
}: {
    title: string;
    items: T[];
    onAdd: () => void;
    onChange: (items: T[]) => void;
    fields: Array<keyof T>;
    helperText?: string;
}) {
    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
                <div>
                    <h3 className="font-nunito text-lg font-extrabold text-slate-950">{title}</h3>
                    {helperText && <p className="mt-1 text-sm font-semibold leading-6 text-slate-500">{helperText}</p>}
                </div>
                <button type="button" onClick={onAdd} className="rounded-full bg-primary/10 px-4 py-2 text-sm font-extrabold text-primary transition hover:bg-primary hover:text-white">Add test</button>
            </div>
            <div className="space-y-3">
                {items.map((item, index) => (
                    <div key={item.id || index} className="rounded-lg bg-slate-50 p-4 ring-1 ring-slate-200">
                        <div className="mb-3 flex items-center justify-between">
                            <span className="text-sm font-extrabold text-slate-700">Case {index + 1}</span>
                            {items.length > 1 && (
                                <button type="button" onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))} className="grid size-8 place-items-center rounded-full text-slate-400 transition hover:bg-red-50 hover:text-red-600" aria-label="Remove test">
                                    <span className="material-symbols-outlined text-[20px]">remove</span>
                                </button>
                            )}
                        </div>
                        <div className="grid gap-3">
                            {fields.map((field) => {
                                const fieldName = String(field);
                                const fieldValue = String(item[field] || "");
                                return (
                                    <div key={fieldName} className="space-y-2">
                                        <TextArea
                                            label={fieldLabel(fieldName)}
                                            value={fieldValue}
                                            onChange={(value) => onChange(items.map((current, itemIndex) => itemIndex === index ? { ...current, [field]: value } : current))}
                                            rows={fieldName === "label" ? 2 : fieldName === "wrapper_code" ? 8 : 7}
                                            placeholder={fieldPlaceholder(fieldName)}
                                        />
                                        {fieldName === "expected_output" && fieldValue.trim() && !isValidJson(fieldValue) && (
                                            <p className="text-sm font-bold text-red-600">Expected output must be valid JSON.</p>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function fieldLabel(field: string) {
    if (field === "wrapper_code") return "Hidden wrapper setup code";
    if (field === "expected_output") return "Expected output JSON";
    return field.replace(/_/g, " ");
}

function fieldPlaceholder(field: string) {
    if (field === "wrapper_code") return HIDDEN_WRAPPER_SQL_EXAMPLE;
    if (field === "expected_output") return HIDDEN_OUTPUT_JSON_EXAMPLE;
    if (field === "label") return "Edge case with duplicate viewers";
    return "";
}
