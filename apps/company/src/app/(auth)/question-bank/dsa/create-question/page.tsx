"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useTheme } from "next-themes";
import {
    CompanyQuestionIdePreview,
    QuestionPayload,
} from "@/components/question-bank/company-question-ide-preview";
import { DSAQuestionForm, type DSAQuestionData } from "@/components/problem-setter/DSAQuestionForm";

function toIdePreviewQuestion(data: DSAQuestionData): QuestionPayload {
    return {
        id: data.problemId || "draft",
        title: data.title || "Untitled Problem",
        difficulty: data.difficulty,
        topics: data.topics,
        companyTags: data.companyTags,
        description: data.description,
        examples: data.examples.filter((example) => example.example_text.trim()),
        constraints: data.constraints.filter((constraint) => constraint.trim()),
        sampleTestCases: data.sampleTestCases.filter((testCase) => testCase.input.trim() || testCase.output.trim()),
        hiddenTestCases: data.hiddenTestCases.filter((testCase) => testCase.input.trim() || testCase.output.trim()),
        sampleTestCaseCount: data.sampleTestCases.filter((testCase) => testCase.input.trim() || testCase.output.trim()).length,
        hiddenTestCaseCount: data.hiddenTestCases.filter((testCase) => testCase.input.trim() || testCase.output.trim()).length,
        codeSnippets: data.codeSnippets,
        followUpQuestions: data.followUp,
        hints: data.hints,
        solution: data.solution,
    };
}

export default function CreateCompanyDSAQuestionPage() {
    const { resolvedTheme } = useTheme();
    const [showPreview, setShowPreview] = useState(false);
    const [previewData, setPreviewData] = useState<DSAQuestionData | null>(null);
    const [mounted, setMounted] = useState(false);

    useEffect(() => setMounted(true), []);
    const isDark = mounted && resolvedTheme === "dark";
    const previewQuestion = useMemo(
        () => (previewData ? toIdePreviewQuestion(previewData) : null),
        [previewData]
    );

    if (showPreview && previewQuestion) {
        return (
            <CompanyQuestionIdePreview
                question={previewQuestion}
                type="dsa"
                backHref="/question-bank/dsa/create-question"
                isDark={isDark}
                onBack={() => setShowPreview(false)}
            />
        );
    }

    return (
        <main className="min-h-full bg-[#FAFBFC] px-4 py-8 dark:bg-lc-bg sm:px-6 lg:px-10">
            <div className="mx-auto max-w-7xl">
                <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                        <Link
                            href="/question-bank/dsa"
                            className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-slate-500 transition hover:text-primary dark:text-slate-400"
                        >
                            <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                            Back to DSA questions
                        </Link>
                        <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Company Question Bank</p>
                        <h1 className="mt-2 font-nunito text-3xl font-extrabold tracking-tight text-slate-950 dark:text-white sm:text-4xl">
                            Create DSA Question
                        </h1>
                        <p className="mt-2 text-sm font-semibold text-slate-500 dark:text-slate-400">
                            Add a custom company-owned coding question.
                        </p>
                    </div>

                    {previewData && (
                        <button
                            type="button"
                            onClick={() => setShowPreview((value) => !value)}
                            className="inline-flex h-12 items-center justify-center rounded-full bg-primary px-5 text-sm font-extrabold text-white shadow-lg shadow-primary/20 transition hover:bg-primary/90"
                        >
                            {showPreview ? "Edit form" : "Preview question"}
                        </button>
                    )}
                </div>

                <div>
                    <DSAQuestionForm
                        initialData={previewData || undefined}
                        onPreview={(data) => {
                            setPreviewData(data);
                            setShowPreview(true);
                        }}
                    />
                </div>
            </div>
        </main>
    );
}
