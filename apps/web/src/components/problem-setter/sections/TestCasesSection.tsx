import { useState } from "react";
import { DSAQuestionData } from "../DSAQuestionForm";

// Skeleton for the setter's check() function. Our backend harness reads stdin,
// splits input/output/expected, calls this, and prints the 1/0 verdict.
function checkerTemplateFor(lang: DSAQuestionData["checkerLanguage"]): string {
    if (lang === "python3") return `def check(input, output, expected):\n    # input, output, expected are strings.\n    # Parse 'input' (the test case) and 'output' (the user's answer),\n    # then return True if the answer is valid, else False.\n    return True`;
    if (lang === "java") return `class Checker {\n    static boolean check(String input, String output, String expected) {\n        // Parse 'input' and 'output'; return true if valid, else false.\n        return true;\n    }\n}`;
    if (lang === "javascript") return `function check(input, output, expected) {\n    // Parse 'input' and 'output'; return true if valid, else false.\n    return true;\n}`;
    return `bool check(string input, string output, string expected) {\n    stringstream in(input), out(output);\n    // Read the test case from 'in' and the user's answer from 'out';\n    // return true if the answer is valid, else false.\n    return true;\n}`;
}

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
    const [checkerHelpOpen, setCheckerHelpOpen] = useState(false);
    const [checkerExampleOpen, setCheckerExampleOpen] = useState(false);

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

        return (
            <section className="rounded-xl bg-slate-50 p-5 ring-1 ring-slate-200 dark:bg-lc-elevated dark:ring-lc-border">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex items-center gap-3">
                        <span className={`grid size-10 place-items-center rounded-lg ${isSample ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200" : "bg-primary/10 text-primary"}`}>
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
                                <div className="flex flex-wrap items-center gap-3">
                                    <span className={`rounded-full px-3 py-1 text-xs font-extrabold ${isSample ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200" : "bg-primary/10 text-primary"}`}>
                                        Case {index + 1}
                                    </span>
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
                    className="inline-flex h-10 items-center justify-center rounded-full border border-primary/30 px-4 text-sm font-extrabold text-primary transition hover:bg-primary/10 dark:border-primary/40 dark:hover:bg-primary/15"
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
                        placeholder="Paste JSON array here"
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

            {/* ── Special Judge / Custom Checker ─────────────────────────── */}
            <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-lc-border dark:bg-lc-surface">
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <div className="flex items-center gap-2">
                            <h3 className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">Judge type</h3>
                            <button
                                type="button"
                                onClick={() => setCheckerHelpOpen(true)}
                                title="How to write a custom checker"
                                className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-extrabold text-primary transition hover:bg-primary/20"
                            >
                                <span className="material-symbols-outlined text-[15px]">info</span>
                                How to write
                            </button>
                            <button
                                type="button"
                                onClick={() => setCheckerExampleOpen(true)}
                                title="See a full example question"
                                className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-extrabold text-slate-600 transition hover:bg-slate-200 dark:bg-lc-elevated dark:text-slate-300 dark:hover:bg-lc-hover"
                            >
                                <span className="material-symbols-outlined text-[15px]">menu_book</span>
                                Full example
                            </button>
                        </div>
                        <p className="mt-1 max-w-xl text-sm font-semibold text-slate-500 dark:text-slate-400">
                            Use a custom checker for problems with multiple valid outputs (e.g. &quot;return any valid pair&quot;, &quot;any topological order&quot;). Default judges by exact output match.
                        </p>
                    </div>
                    <div className="flex rounded-xl bg-slate-100 p-1 dark:bg-lc-elevated">
                        {(["default", "custom"] as const).map((jt) => (
                            <button
                                key={jt}
                                type="button"
                                onClick={() => setFormData({ ...formData, judgeType: jt })}
                                className={`rounded-lg px-4 py-2 text-sm font-extrabold transition ${
                                    formData.judgeType === jt
                                        ? "bg-primary text-white shadow-sm"
                                        : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                                }`}
                            >
                                {jt === "default" ? "Exact match" : "Custom checker"}
                            </button>
                        ))}
                    </div>
                </div>

                {formData.judgeType === "custom" && (
                    <div className="mt-5 space-y-4">
                        <div className="flex flex-wrap items-center gap-3">
                            <label className="text-sm font-extrabold text-slate-700 dark:text-slate-200">Checker language</label>
                            <select
                                value={formData.checkerLanguage}
                                onChange={(e) => setFormData({ ...formData, checkerLanguage: e.target.value as DSAQuestionData["checkerLanguage"] })}
                                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 dark:border-lc-border dark:bg-lc-elevated dark:text-white"
                            >
                                <option value="cpp">C++</option>
                                <option value="python3">Python 3</option>
                                <option value="java">Java</option>
                                <option value="javascript">JavaScript</option>
                            </select>
                            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300">
                                <span className="material-symbols-outlined text-[14px]">check_circle</span>
                                One checker validates all 4 solution languages
                            </span>
                        </div>
                        <p className="text-xs font-semibold leading-5 text-slate-500 dark:text-slate-400">
                            You only write the checker <strong>once</strong>, in any language. It reads your program&apos;s <strong>text output</strong> (not the solution code), so the same checker judges Python, C++, Java and JavaScript submissions alike.
                        </p>

                        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 p-3 dark:bg-lc-elevated">
                            <button
                                type="button"
                                onClick={() => setFormData({ ...formData, checkerCode: checkerTemplateFor(formData.checkerLanguage) })}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-extrabold text-white transition hover:bg-primary/90"
                            >
                                <span className="material-symbols-outlined text-[15px]">code</span>
                                Insert template
                            </button>
                            <span className="text-xs font-semibold leading-5 text-slate-500 dark:text-slate-400">
                                Write only a <code className="rounded bg-slate-200 px-1 dark:bg-lc-bg">check(input, output, expected)</code> function that returns <strong>true</strong> (accept) or <strong>false</strong> (reject). We read stdin and print the verdict for you — no boilerplate.
                            </span>
                        </div>

                        <textarea
                            value={formData.checkerCode}
                            onChange={(e) => setFormData({ ...formData, checkerCode: e.target.value })}
                            spellCheck={false}
                            rows={14}
                            placeholder="Write a check(input, output, expected) function that returns true (accept) or false (reject). Click Insert template to start."
                            className="w-full rounded-xl border border-slate-200 bg-white p-4 font-mono text-sm text-slate-900 outline-none transition focus:ring-2 focus:ring-primary/40 dark:border-lc-border dark:bg-lc-bg dark:text-slate-100"
                        />
                    </div>
                )}
            </section>

            {checkerHelpOpen && (
                <div className="fixed inset-0 z-[190] grid place-items-center bg-slate-950/60 px-4 py-6 backdrop-blur-sm">
                    <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-lc-surface dark:ring-1 dark:ring-lc-border">
                        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4 dark:border-lc-border">
                            <div>
                                <h3 className="font-nunito text-xl font-extrabold text-slate-950 dark:text-white">How to write a custom checker</h3>
                                <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">A checker validates output, not code — one checker judges all 4 languages.</p>
                            </div>
                            <button type="button" onClick={() => setCheckerHelpOpen(false)} className="grid size-9 place-items-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-lc-hover dark:hover:text-white" aria-label="Close">
                                <span className="material-symbols-outlined text-[19px]">close</span>
                            </button>
                        </div>
                        <div className="space-y-4 overflow-y-auto px-6 py-5 text-sm font-medium leading-6 text-slate-600 dark:text-slate-300">
                            <p><strong className="text-slate-950 dark:text-white">When to use it:</strong> only when a problem has more than one correct output (e.g. &quot;print any valid path / pair / ordering&quot;). Otherwise keep the default exact-match judge.</p>
                            <p><strong className="text-slate-950 dark:text-white">Why one language is enough:</strong> the checker never sees the solution code. It only receives the <strong>text your program printed</strong>, so a single C++/Python/Java/JS checker validates submissions written in <em>any</em> of the 4 languages.</p>
                            <p className="rounded-lg bg-emerald-50 p-3 text-[13px] font-bold text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-200">You write <strong>only a <code>check(...)</code> function</strong>. We wrap it with a harness that reads stdin, splits the sections, calls your function, and prints the 1/0 verdict. No parsing boilerplate.</p>
                            <div>
                                <p className="mb-1 font-extrabold text-slate-950 dark:text-white">The function you write (per language)</p>
                                <pre className="whitespace-pre-wrap rounded-lg bg-slate-100 p-3 font-mono text-[12px] text-slate-800 dark:bg-lc-elevated dark:text-slate-100">{`C++   : bool check(string input, string output, string expected)\nPython: def check(input, output, expected) -> bool\nJava  : class Checker { static boolean check(String input, String output, String expected) }\nJS    : function check(input, output, expected)   // return true / false`}</pre>
                            </div>
                            <p>You get three strings: <code>input</code> = the test case, <code>output</code> = what the user&apos;s program printed, <code>expected</code> = your reference output. <strong>Return true to accept, false to reject.</strong></p>
                            <p className="rounded-lg bg-amber-50 p-3 text-[13px] font-bold text-amber-700 dark:bg-amber-400/10 dark:text-amber-300">Tip: compute the correct answer yourself from <code>input</code> and validate the user&apos;s <code>output</code> against the rules — don&apos;t just compare to <code>expected</code>, since many answers can be valid.</p>
                            <div>
                                <p className="mb-1 font-extrabold text-slate-950 dark:text-white">C++ example — accept any index of the max element</p>
                                <pre className="whitespace-pre-wrap rounded-lg bg-slate-100 p-3 font-mono text-[12px] text-slate-800 dark:bg-lc-elevated dark:text-slate-100">{`bool check(string input, string output, string expected) {\n    stringstream in(input), out(output);\n    int n; in >> n;\n    vector<int> a(n);\n    for (int i = 0; i < n; i++) in >> a[i];\n    int idx; if (!(out >> idx)) return false;   // user's answer\n    if (idx < 1 || idx > n) return false;\n    int mx = *max_element(a.begin(), a.end());\n    return a[idx - 1] == mx;                     // any max position is valid\n}`}</pre>
                            </div>
                            <p className="text-[13px]">Click <strong>Insert template</strong> under the editor to drop this skeleton in for your selected language.</p>
                        </div>
                    </div>
                </div>
            )}

            {checkerExampleOpen && (
                <div className="fixed inset-0 z-[190] grid place-items-center bg-slate-950/60 px-4 py-6 backdrop-blur-sm">
                    <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-lc-surface dark:ring-1 dark:ring-lc-border">
                        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4 dark:border-lc-border">
                            <div>
                                <h3 className="font-nunito text-xl font-extrabold text-slate-950 dark:text-white">Full worked example</h3>
                                <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">Starter + wrapper + checker for a multiple-answer problem.</p>
                            </div>
                            <button type="button" onClick={() => setCheckerExampleOpen(false)} className="grid size-9 place-items-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-lc-hover dark:hover:text-white" aria-label="Close">
                                <span className="material-symbols-outlined text-[19px]">close</span>
                            </button>
                        </div>
                        <div className="space-y-4 overflow-y-auto px-6 py-5 text-sm font-medium leading-6 text-slate-600 dark:text-slate-300">
                            <p><strong className="text-slate-950 dark:text-white">Problem:</strong> You are given <code>n</code> and an array <code>a</code> of <code>n</code> integers. Return the <strong>1-based index of ANY maximum element</strong>. If the max appears multiple times, any of those indices is correct — so this needs a custom checker.</p>
                            <div>
                                <p className="mb-1 font-extrabold text-slate-950 dark:text-white">1. Starter code (what the solver fills in)</p>
                                <pre className="whitespace-pre-wrap rounded-lg bg-slate-100 p-3 font-mono text-[12px] text-slate-800 dark:bg-lc-elevated dark:text-slate-100">{`class Solution {\npublic:\n    int solve(int n, vector<int>& a) {\n        // return the 1-based index of any maximum element\n        return 1;\n    }\n};`}</pre>
                            </div>
                            <div>
                                <p className="mb-1 font-extrabold text-slate-950 dark:text-white">2. Wrapper (reads stdin, calls solve, prints the return value)</p>
                                <pre className="whitespace-pre-wrap rounded-lg bg-slate-100 p-3 font-mono text-[12px] text-slate-800 dark:bg-lc-elevated dark:text-slate-100">{`#include <bits/stdc++.h>\nusing namespace std;\nint main(){\n    int n; if(!(cin >> n)) return 0;\n    vector<int> a(n);\n    for(int i = 0; i < n; i++) cin >> a[i];\n    cout << Solution().solve(n, a);\n}`}</pre>
                            </div>
                            <div>
                                <p className="mb-1 font-extrabold text-slate-950 dark:text-white">3. Custom checker — you write only this function</p>
                                <pre className="whitespace-pre-wrap rounded-lg bg-slate-100 p-3 font-mono text-[12px] text-slate-800 dark:bg-lc-elevated dark:text-slate-100">{`bool check(string input, string output, string expected) {\n    stringstream in(input), out(output);\n    int n; in >> n;\n    vector<int> a(n);\n    for (int i = 0; i < n; i++) in >> a[i];\n    int idx; if (!(out >> idx)) return false;   // user's answer\n    if (idx < 1 || idx > n) return false;        // in range?\n    int mx = *max_element(a.begin(), a.end());\n    return a[idx - 1] == mx;                     // is it a max?\n}`}</pre>
                                <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">No <code>main()</code>, no stdin reading, no <code>===OUTPUT===</code> parsing — the harness does all of that and calls your <code>check</code>.</p>
                            </div>
                            <div>
                                <p className="mb-1 font-extrabold text-slate-950 dark:text-white">4. How it flows</p>
                                <pre className="whitespace-pre-wrap rounded-lg bg-slate-100 p-3 font-mono text-[12px] text-slate-800 dark:bg-lc-elevated dark:text-slate-100">{`Test input:   5\n              3 9 1 9 2\nUser prints:  2          (or 4 — both are max positions)\nHarness calls check(input, output, expected):\n              a[2-1] = 9 == max(9)  ->  return true   ->  Accepted\nIf user prints 3:\n              a[3-1] = 1 != 9       ->  return false  ->  Wrong Answer`}</pre>
                            </div>
                            <p className="rounded-lg bg-amber-50 p-3 text-xs font-bold text-amber-700 dark:bg-amber-400/10 dark:text-amber-300">Sample/hidden test <strong>Expected</strong> can be any one valid answer — the checker recomputes the rule, so every correct answer is accepted regardless of what Expected holds.</p>
                        </div>
                    </div>
                </div>
            )}

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
                            <p><strong className="text-slate-950 dark:text-white">Match wrapper parsing:</strong> Design wrapper code to parse the exact structure used in test inputs.</p>
                            <p><strong className="text-slate-950 dark:text-white">Sample tests:</strong> Use enough sample cases for reviewers and candidates to understand normal behavior clearly.</p>
                            <p><strong className="text-slate-950 dark:text-white">Hidden tests:</strong> Include boundaries, duplicates, large inputs, and tricky valid cases.</p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
