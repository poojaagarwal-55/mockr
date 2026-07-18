"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useCompanyAuth } from "@/context/company-auth-context";
import { BasicInfoSection } from "./sections/BasicInfoSection";
import { DescriptionSection } from "./sections/DescriptionSection";
import { TestCasesSection } from "./sections/TestCasesSection";
import { CodeSnippetsSection } from "./sections/CodeSnippetsSection";
import { SolutionSection } from "./sections/SolutionSection";

export type LanguageTestStatus = "untested" | "running" | "passed" | "failed";

export interface TestResultsState {
    bruteForce: {
        python3: LanguageTestStatus;
        cpp: LanguageTestStatus;
        java: LanguageTestStatus;
        javascript: LanguageTestStatus;
    };
    optimized: {
        python3: LanguageTestStatus;
        cpp: LanguageTestStatus;
        java: LanguageTestStatus;
        javascript: LanguageTestStatus;
    };
}

export interface DSAQuestionData {
    title: string;
    problemId: string;
    frontendId: string;
    difficulty: "Easy" | "Medium" | "Hard";
    problemSlug: string;
    topics: string[];
    companyTags: string[];
    description: string;
    examples: Array<{ example_num: number; example_text: string }>;
    constraints: string[];
    sampleTestCases: Array<{ id: string; description: string; input: string; output: string }>;
    hiddenTestCases: Array<{ id: string; description: string; input: string; output: string }>;
    codeSnippets: {
        python3: { starter_code: string; wrapper_code: string };
        cpp: { starter_code: string; wrapper_code: string };
        java: { starter_code: string; wrapper_code: string };
        javascript: { starter_code: string; wrapper_code: string };
    };
    followUp: string[];
    hints: string[];
    solution?: {
        bruteForce?: {
            title?: string;
            explanation: string;
            timeComplexity: string;
            spaceComplexity: string;
            code: { python3?: string; cpp?: string; java?: string; javascript?: string };
        };
        optimized?: {
            title?: string;
            explanation: string;
            timeComplexity: string;
            spaceComplexity: string;
            code: { python3?: string; cpp?: string; java?: string; javascript?: string };
        };
        approaches?: Array<{
            title: string;
            explanation: string;
            timeComplexity: string;
            spaceComplexity: string;
            code: { python3?: string; cpp?: string; java?: string; javascript?: string };
        }>;
    };
}

interface DSAQuestionFormProps {
    initialData?: DSAQuestionData;
    onPreview: (data: DSAQuestionData) => void;
}

const FORM_DRAFT_KEY = "company-dsa-question-draft";

const tabs = [
    { name: "Question", shortName: "Question" },
    { name: "Test Cases", shortName: "Tests" },
    { name: "Code Snippets", shortName: "Code" },
    { name: "Solution", shortName: "Solution" },
    { name: "Quality Check", shortName: "Review" },
];

function defaultQuestionData(): DSAQuestionData {
    return {
        title: "",
        problemId: "",
        frontendId: "",
        difficulty: "Easy",
        problemSlug: "",
        topics: [],
        companyTags: [],
        description: "",
        examples: [{ example_num: 1, example_text: "" }],
        constraints: [""],
        sampleTestCases: [{ id: "sample_1", description: "Visible sample", input: "", output: "" }],
        hiddenTestCases: [{ id: "hidden_1", description: "Hidden judge case", input: "", output: "" }],
        codeSnippets: {
            python3: { starter_code: "", wrapper_code: "" },
            cpp: { starter_code: "", wrapper_code: "" },
            java: { starter_code: "", wrapper_code: "" },
            javascript: { starter_code: "", wrapper_code: "" },
        },
        followUp: [],
        hints: [],
        solution: {
            approaches: [{
                title: "Recommended Solution",
                explanation: "",
                timeComplexity: "",
                spaceComplexity: "",
                code: {},
            }],
        },
    };
}

export function DSAQuestionForm({ initialData, onPreview }: DSAQuestionFormProps) {
    const { session } = useCompanyAuth();
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState(0);
    const [autosaveStatus, setAutosaveStatus] = useState("Draft not saved yet");
    const [formData, setFormData] = useState<DSAQuestionData>(() => {
        if (initialData) return initialData;
        if (typeof window !== "undefined") {
            try {
                const saved = window.localStorage.getItem(FORM_DRAFT_KEY);
                if (saved) return JSON.parse(saved) as DSAQuestionData;
            } catch {
                // Ignore malformed local drafts.
            }
        }
        return defaultQuestionData();
    });
    const [testStatus, setTestStatus] = useState<TestResultsState>({
        bruteForce: {
            python3: "untested",
            cpp: "untested",
            java: "untested",
            javascript: "untested",
        },
        optimized: {
            python3: "untested",
            cpp: "untested",
            java: "untested",
            javascript: "untested",
        },
    });

    useEffect(() => {
        if (formData.problemId) return;
        const nextId = `CUSTOM-${Date.now().toString(36).toUpperCase()}`;
        setFormData((prev) => ({
            ...prev,
            problemId: nextId,
            frontendId: nextId,
        }));
    }, [formData.problemId]);

    useEffect(() => {
        const slug = formData.title
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");

        if (slug && formData.problemSlug !== slug) {
            setFormData((prev) => ({ ...prev, problemSlug: slug }));
        }
    }, [formData.problemSlug, formData.title]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const timeout = window.setTimeout(() => {
            window.localStorage.setItem(FORM_DRAFT_KEY, JSON.stringify(formData));
            setAutosaveStatus(`Saved ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
        }, 500);

        return () => window.clearTimeout(timeout);
    }, [formData]);

    const validApproaches = (formData.solution?.approaches || []).filter((approach) =>
        approach.title.trim() ||
        approach.explanation.trim() ||
        approach.timeComplexity.trim() ||
        approach.spaceComplexity.trim() ||
        Object.values(approach.code || {}).some((code) => code?.trim())
    );

    const hasCompleteSampleTest = formData.sampleTestCases.some((testCase) =>
        testCase.input.trim() && testCase.output.trim()
    );
    const hasCompleteHiddenTest = formData.hiddenTestCases.some((testCase) =>
        testCase.input.trim() && testCase.output.trim()
    );
    const allCodeSnippetsFilled = Object.values(formData.codeSnippets).every((snippet) =>
        snippet.starter_code.trim() && snippet.wrapper_code.trim()
    );

    const canSubmit =
        Boolean(formData.title.trim()) &&
        Boolean(formData.problemId.trim()) &&
        Boolean(formData.problemSlug.trim()) &&
        formData.topics.length > 0 &&
        Boolean(formData.description.trim()) &&
        formData.examples.some((example) => example.example_text.trim()) &&
        formData.constraints.some((constraint) => constraint.trim()) &&
        hasCompleteSampleTest &&
        hasCompleteHiddenTest &&
        allCodeSnippetsFilled;

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();

        if (!canSubmit) {
            setError("Please complete required question fields, at least one sample test, one hidden test, and all code snippets before adding.");
            return;
        }

        setLoading(true);
        setError(null);
        setSuccess(false);

        try {
            const payload = {
                ...formData,
                companyTags: [],
                solution: validApproaches.length > 0
                    ? {
                        approaches: validApproaches,
                        optimized: validApproaches[0],
                        ...(validApproaches[1] ? { bruteForce: validApproaches[1] } : {}),
                    }
                    : undefined,
                constraints: formData.constraints.filter((constraint) => constraint.trim()),
                examples: formData.examples.filter((example) => example.example_text.trim()),
            };

            await api.post("/companies/question-bank/dsa", payload, session?.access_token);
            if (typeof window !== "undefined") {
                window.localStorage.removeItem(FORM_DRAFT_KEY);
            }
            setSuccess(true);

            setTimeout(() => {
                window.location.href = "/question-bank/dsa";
            }, 1200);
        } catch (err: any) {
            setError(err.message || "Failed to submit question");
        } finally {
            setLoading(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-6">
            {success && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-400/30 dark:bg-emerald-400/10">
                    <p className="font-semibold text-emerald-800 dark:text-emerald-200">
                        Question submitted successfully. Returning to the question bank...
                    </p>
                </div>
            )}

            {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-400/30 dark:bg-red-400/10">
                    <p className="font-semibold text-red-800 dark:text-red-200">{error}</p>
                </div>
            )}

            <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-lc-surface dark:ring-lc-border">
                <div className="flex overflow-x-auto border-b border-slate-200 bg-white dark:border-lc-border dark:bg-lc-surface">
                    {tabs.map((tab, index) => (
                        <button
                            key={tab.name}
                            type="button"
                            onClick={() => setActiveTab(index)}
                            className={`group relative flex min-w-[220px] items-center gap-4 whitespace-nowrap px-7 py-5 text-sm font-extrabold uppercase tracking-[0.02em] transition-colors ${
                                activeTab === index
                                    ? "text-primary"
                                    : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                            }`}
                        >
                            {index < tabs.length - 1 && (
                                <span className="pointer-events-none absolute right-0 top-0 h-full w-8 translate-x-1/2 skew-x-[-24deg] border-r border-slate-200 bg-white group-hover:bg-slate-50 dark:border-lc-border dark:bg-lc-surface dark:group-hover:bg-lc-hover" />
                            )}
                            <span className={`relative z-10 grid size-9 place-items-center rounded-full border-2 text-sm font-extrabold ${
                                activeTab === index
                                    ? "border-primary bg-primary text-white"
                                    : "border-slate-300 bg-white text-slate-400 dark:border-lc-border dark:bg-lc-elevated dark:text-slate-400"
                            }`}>
                                {index + 1}
                            </span>
                            <span className="relative z-10 hidden sm:inline">{tab.name}</span>
                            <span className="relative z-10 sm:hidden">{tab.shortName}</span>
                        </button>
                    ))}
                    <div className="ml-auto hidden items-center px-6 text-xs font-extrabold uppercase tracking-[0.14em] text-slate-400 lg:flex dark:text-slate-500">
                        {autosaveStatus}
                    </div>
                </div>

                <div className="p-6 sm:p-8">
                    <div className="mb-5 text-xs font-extrabold uppercase tracking-[0.14em] text-slate-400 lg:hidden dark:text-slate-500">
                        {autosaveStatus}
                    </div>
                    {activeTab === 0 && (
                        <div className="space-y-8">
                            <BasicInfoSection formData={formData} setFormData={setFormData} />
                            <DescriptionSection formData={formData} setFormData={setFormData} />
                        </div>
                    )}
                    {activeTab === 1 && <TestCasesSection formData={formData} setFormData={setFormData} />}
                    {activeTab === 2 && <CodeSnippetsSection formData={formData} setFormData={setFormData} setTestStatus={setTestStatus} />}
                    {activeTab === 3 && <SolutionSection formData={formData} setFormData={setFormData} testStatus={testStatus} setTestStatus={setTestStatus} />}
                    {activeTab === 4 && (
                        <div className="space-y-6">
                            <div className="rounded-xl bg-white p-5 ring-1 ring-slate-200 dark:bg-lc-elevated dark:ring-lc-border">
                                <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                                    <div>
                                        <h2 className="font-nunito text-xl font-extrabold text-slate-950 dark:text-white">Quality Check</h2>
                                        <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">
                                            Review coverage before adding this question.
                                        </p>
                                    </div>
                                </div>
                                <div className="grid gap-3 md:grid-cols-2">
                                {[
                                    {
                                        label: "Test cases",
                                        value: formData.sampleTestCases.length + formData.hiddenTestCases.length,
                                        note: "3-15 test cases are recommended.",
                                        action: "Add test cases",
                                        target: 1,
                                    },
                                    {
                                        label: "Sample tests",
                                        value: formData.sampleTestCases.length,
                                        note: "At least 2 sample test cases are recommended.",
                                        action: "Add sample test cases",
                                        target: 1,
                                    },
                                    {
                                        label: "Topics",
                                        value: formData.topics.length,
                                        note: "At least 2 topics per question are recommended.",
                                        action: "Add more topics",
                                        target: 0,
                                    },
                                    {
                                        label: "Solutions",
                                        value: validApproaches.length,
                                        note: "Solutions make internal review easier.",
                                        action: "Add solution",
                                        target: 3,
                                    },
                                ].map((item, index) => (
                                    <div key={item.label} className="rounded-lg bg-slate-50 p-4 ring-1 ring-slate-200 dark:bg-lc-surface dark:ring-lc-border">
                                        <div className="flex items-start justify-between gap-4">
                                            <div>
                                                <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">{item.label}</p>
                                                <p className="mt-2 font-nunito text-3xl font-extrabold text-slate-950 dark:text-white">{item.value}</p>
                                                <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">{item.note}</p>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => setActiveTab(item.target)}
                                                className="rounded-full bg-white px-3 py-1.5 text-xs font-extrabold text-primary ring-1 ring-primary/20 transition hover:bg-primary/10 dark:bg-lc-elevated dark:hover:bg-primary/15"
                                            >
                                                {item.action}
                                            </button>
                                        </div>
                                    </div>
                                ))}
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => onPreview(formData)}
                                className="inline-flex h-12 items-center justify-center rounded-full bg-primary px-6 text-sm font-extrabold text-white shadow-lg shadow-primary/20 transition hover:bg-primary/90"
                            >
                                Preview Question
                            </button>
                        </div>
                    )}
                </div>
            </div>

            <div className="flex flex-col gap-4 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 dark:bg-lc-surface dark:ring-lc-border lg:flex-row lg:items-center lg:justify-between">
                <div className="flex gap-3">
                    {activeTab > 0 && (
                        <button
                            type="button"
                            onClick={() => setActiveTab(activeTab - 1)}
                            className="rounded-full border border-slate-200 px-6 py-3 text-sm font-extrabold text-slate-700 transition hover:bg-slate-50 dark:border-lc-border dark:text-slate-200 dark:hover:bg-lc-hover"
                        >
                            Previous
                        </button>
                    )}
                    {activeTab < tabs.length - 1 && (
                        <button
                            type="button"
                            onClick={() => setActiveTab(activeTab + 1)}
                            className="rounded-full bg-primary px-6 py-3 text-sm font-extrabold text-white transition hover:bg-primary/90"
                        >
                            Next
                        </button>
                    )}
                </div>

                <div className="flex flex-wrap items-center gap-3">
                    {validApproaches.length === 0 && (
                        <span className="rounded-full bg-amber-50 px-3 py-1.5 text-xs font-extrabold text-amber-700 ring-1 ring-amber-200 dark:bg-amber-400/10 dark:text-amber-200 dark:ring-amber-400/20">
                            Add a solution for reviewer ease
                        </span>
                    )}
                    <button
                        type="button"
                        onClick={() => onPreview(formData)}
                        className="rounded-full border border-primary/30 px-6 py-3 text-sm font-extrabold text-primary transition hover:bg-primary/10 dark:hover:bg-primary/15"
                    >
                        Preview
                    </button>
                    <button
                        type="submit"
                        disabled={loading || !canSubmit}
                        className="rounded-full bg-emerald-600 px-8 py-3 text-sm font-extrabold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                        title={!canSubmit ? "Complete required fields, tests, and code snippets before adding." : ""}
                    >
                        {loading ? "Adding..." : "Add"}
                    </button>
                </div>
            </div>
        </form>
    );
}
