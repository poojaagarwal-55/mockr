import { useState } from "react";
import { DSAQuestionData } from "../DSAQuestionForm";

interface Props {
    formData: DSAQuestionData;
    setFormData: (data: DSAQuestionData) => void;
}

type TestCaseKind = "sample" | "hidden";
type TestCaseRecord = DSAQuestionData["sampleTestCases"][number];

function buildTestCase(kind: TestCaseKind, index: number): TestCaseRecord {
    return {
        id: `${kind}_${index + 1}`,
        description: kind === "sample" ? `Visible sample ${index + 1}` : `Hidden judge case ${index + 1}`,
        input: "",
        output: "",
    };
}

function parseBulkCases(value: string, kind: TestCaseKind): TestCaseRecord[] {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
        throw new Error("JSON must be an array of test cases.");
    }

    const cases = parsed.map((item, index) => {
        const input = item.input ?? item.Input ?? "";
        const output = item.output ?? item.expected_output ?? item.Output ?? item.expectedOutput ?? "";
        if (input === "" && output === "") {
            throw new Error(`Test case ${index + 1} is missing input/output fields.`);
        }

        return {
            id: `${kind}_${index + 1}`,
            description: item.description || (kind === "sample" ? `Visible sample ${index + 1}` : `Hidden judge case ${index + 1}`),
            input: typeof input === "string" ? input : JSON.stringify(input),
            output: typeof output === "string" ? output : JSON.stringify(output),
        };
    });

    if (!cases.length) throw new Error("No test cases found.");
    return cases;
}

export function TestCasesSection({ formData, setFormData }: Props) {
    const [bulkKind, setBulkKind] = useState<TestCaseKind | null>(null);
    const [bulkValue, setBulkValue] = useState("");
    const [bulkError, setBulkError] = useState<string | null>(null);
    const [guidelinesOpen, setGuidelinesOpen] = useState(false);

    const testCasesByKind = {
        sample: formData.sampleTestCases,
        hidden: formData.hiddenTestCases,
    };

    const setCases = (kind: TestCaseKind, cases: TestCaseRecord[]) => {
        if (kind === "sample") {
            setFormData({ ...formData, sampleTestCases: cases });
            return;
        }
        setFormData({ ...formData, hiddenTestCases: cases });
    };

    const addCase = (kind: TestCaseKind) => {
        const current = testCasesByKind[kind];
        setCases(kind, [...current, buildTestCase(kind, current.length)]);
    };

    const updateCase = (kind: TestCaseKind, index: number, field: keyof TestCaseRecord, value: string) => {
        const updated = [...testCasesByKind[kind]];
        updated[index] = { ...updated[index], [field]: value };
        setCases(kind, updated);
    };

    const removeCase = (kind: TestCaseKind, index: number) => {
        const current = testCasesByKind[kind];
        if (current.length <= 1) return;
        setCases(kind, current.filter((_, itemIndex) => itemIndex !== index));
    };

    const importBulk = () => {
        if (!bulkKind) return;

        setBulkError(null);
        try {
            const cases = parseBulkCases(bulkValue, bulkKind);
            setCases(bulkKind, cases);
            setBulkValue("");
            setBulkKind(null);
        } catch (err: any) {
            setBulkError(err.message || "Invalid JSON format.");
        }
    };

    const renderSection = (kind: TestCaseKind) => {
        const isSample = kind === "sample";
        const cases = testCasesByKind[kind];
        const accent = isSample ? "emerald" : "primary";

        return (
            <section className="rounded-xl bg-slate-50 p-5 ring-1 ring-slate-200 dark:bg-lc-elevated dark:ring-lc-border">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <div className="flex items-center gap-3">
                            <span className={`grid size-10 place-items-center rounded-lg ${isSample ? "bg-emerald-100 text-emerald-700" : "bg-primary/10 text-primary"}`}>
                                <span className="material-symbols-outlined text-[22px]">{isSample ? "visibility" : "lock"}</span>
                            </span>
                            <div>
                                <h3 className="font-nunito text-xl font-extrabold text-slate-950 dark:text-white">
                                    {isSample ? "Visible Sample Tests" : "Hidden Judge Tests"}
                                </h3>
                                <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">
                                    {isSample ? "Shown to candidates in preview and IDE." : "Used only for evaluation after submission."}
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                        <button
                            type="button"
                            onClick={() => {
                                setBulkKind(kind);
                                setBulkError(null);
                            }}
                            className="inline-flex h-10 items-center gap-2 rounded-full bg-white px-4 text-sm font-extrabold text-slate-600 ring-1 ring-slate-200 transition hover:text-primary dark:bg-lc-surface dark:text-slate-200 dark:ring-lc-border dark:hover:bg-lc-hover dark:hover:text-white"
                        >
                            <span className="material-symbols-outlined text-[18px]">data_object</span>
                            Bulk JSON
                        </button>
                        <button
                            type="button"
                            onClick={() => addCase(kind)}
                            className={`inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-extrabold text-white transition ${isSample ? "bg-emerald-600 hover:bg-emerald-700" : "bg-primary hover:bg-primary/90"}`}
                        >
                            <span className="material-symbols-outlined text-[18px]">add</span>
                            Add case
                        </button>
                    </div>
                </div>

                <div className="mt-5 grid gap-4">
                    {cases.map((testCase, index) => (
                        <div key={`${kind}-${index}`} className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 dark:bg-lc-surface dark:ring-lc-border">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="flex items-center gap-3">
                                    <span className={`rounded-full px-3 py-1 text-xs font-extrabold ${isSample ? "bg-emerald-50 text-emerald-700" : "bg-primary/10 text-primary"}`}>
                                        Case {index + 1}
                                    </span>
                                    <input
                                        value={testCase.description}
                                        onChange={(event) => updateCase(kind, index, "description", event.target.value)}
                                        className="h-9 min-w-[220px] rounded-full border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-input dark:text-white dark:placeholder:text-slate-500"
                                        placeholder="Short label"
                                    />
                                </div>

                                {cases.length > 1 && (
                                    <button
                                        type="button"
                                        onClick={() => removeCase(kind, index)}
                                        className="grid size-9 place-items-center rounded-full text-slate-400 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-300"
                                        aria-label={`Remove test case ${index + 1}`}
                                    >
                                        <span className="material-symbols-outlined text-[19px]">remove</span>
                                    </button>
                                )}
                            </div>

                            <div className="mt-4 grid gap-4 lg:grid-cols-2">
                                <label className="block">
                                    <span className="mb-2 block text-xs font-extrabold uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500">Input</span>
                                    <textarea
                                        value={testCase.input}
                                        onChange={(event) => updateCase(kind, index, "input", event.target.value)}
                                        rows={4}
                                        className="w-full resize-y rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 font-mono text-sm text-slate-900 outline-none transition focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-input dark:text-white dark:placeholder:text-slate-500 dark:focus:bg-lc-input"
                                        placeholder='e.g., nums = [2,7,11,15], target = 9'
                                    />
                                </label>
                                <label className="block">
                                    <span className="mb-2 block text-xs font-extrabold uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500">Expected Output</span>
                                    <textarea
                                        value={testCase.output}
                                        onChange={(event) => updateCase(kind, index, "output", event.target.value)}
                                        rows={4}
                                        className="w-full resize-y rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 font-mono text-sm text-slate-900 outline-none transition focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-input dark:text-white dark:placeholder:text-slate-500 dark:focus:bg-lc-input"
                                        placeholder="e.g., [0,1]"
                                    />
                                </label>
                            </div>
                        </div>
                    ))}
                </div>
            </section>
        );
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="font-nunito text-xl font-extrabold text-slate-950 dark:text-white">Test Cases</h2>
                    <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">
                        Define visible samples and hidden judge cases for this question.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => setGuidelinesOpen(true)}
                    className="inline-flex h-10 items-center justify-center rounded-full border border-primary/30 px-4 text-sm font-extrabold text-primary transition hover:bg-primary/10 dark:border-primary/40 dark:text-primary-light dark:hover:bg-primary/15"
                >
                    Guidelines
                </button>
            </div>

            {bulkKind && (
                <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200 dark:bg-lc-surface dark:ring-lc-border">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <h3 className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">
                                Bulk import {bulkKind === "sample" ? "visible sample" : "hidden judge"} tests
                            </h3>
                            <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">
                                Paste an array of objects with input and output fields. Import replaces the current cases in this section.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => {
                                setBulkKind(null);
                                setBulkValue("");
                                setBulkError(null);
                            }}
                            className="grid size-9 place-items-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-lc-hover dark:hover:text-white"
                            aria-label="Close bulk import"
                        >
                            <span className="material-symbols-outlined text-[19px]">close</span>
                        </button>
                    </div>

                    <pre className="mt-4 overflow-x-auto rounded-lg bg-slate-950 p-4 text-xs leading-5 text-slate-100">
{`[
  { "input": "[2,7,11,15], 9", "output": "[0,1]" },
  { "input": "[3,2,4], 6", "output": "[1,2]" }
]`}
                    </pre>

                    <textarea
                        value={bulkValue}
                        onChange={(event) => setBulkValue(event.target.value)}
                        rows={8}
                        className="mt-4 w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-sm text-slate-900 outline-none transition focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-input dark:text-white dark:placeholder:text-slate-500 dark:focus:bg-lc-input"
                        placeholder='Paste JSON array here'
                    />

                    {bulkError && (
                        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
                            {bulkError}
                        </p>
                    )}

                    <button
                        type="button"
                        onClick={importBulk}
                        disabled={!bulkValue.trim()}
                        className="mt-4 rounded-full bg-primary px-5 py-2.5 text-sm font-extrabold text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        Import cases
                    </button>
                </section>
            )}

            {renderSection("sample")}
            {renderSection("hidden")}

            {guidelinesOpen && (
                <div className="fixed inset-0 z-[180] grid place-items-center bg-slate-950/60 px-4 backdrop-blur-sm">
                    <div className="w-full max-w-2xl rounded-xl bg-white p-6 shadow-2xl dark:bg-lc-surface dark:ring-1 dark:ring-lc-border">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <h3 className="font-nunito text-2xl font-extrabold text-slate-950 dark:text-white">Test Case Guidelines</h3>
                                <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">
                                    Keep test input format aligned with your wrapper code.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setGuidelinesOpen(false)}
                                className="grid size-9 place-items-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-lc-hover dark:hover:text-white"
                                aria-label="Close guidelines"
                            >
                                <span className="material-symbols-outlined text-[19px]">close</span>
                            </button>
                        </div>

                        <div className="mt-6 space-y-4 text-sm font-medium leading-6 text-slate-600 dark:text-slate-300">
                            <p><strong className="text-slate-950 dark:text-white">Use new lines intentionally:</strong> If input needs multiple lines, write them with actual line breaks or escaped <code className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-lc-elevated dark:text-slate-100">{"\\n"}</code> consistently.</p>
                            <p><strong className="text-slate-950 dark:text-white">Match wrapper parsing:</strong> Design wrapper code to parse the exact structure used in test inputs. If the wrapper expects one value per line, your tests should follow that format.</p>
                            <p><strong className="text-slate-950 dark:text-white">Sample tests:</strong> 3 sample test cases are recommended so reviewers and candidates can understand normal behavior clearly.</p>
                            <p><strong className="text-slate-950 dark:text-white">Hidden tests:</strong> Include edge cases, boundary values, empty/minimum-sized inputs when allowed, duplicates, large inputs, and tricky invalid-looking-but-valid cases.</p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
