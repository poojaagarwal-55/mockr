"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { DSAQuestionForm, type DSAQuestionData } from "@/components/problem-setter/DSAQuestionForm";
import {
    CompanyQuestionIdePreview,
    type QuestionPayload,
} from "@/components/question-bank/company-question-ide-preview";
import { useContestManagerCheck } from "@/hooks/use-contest-manager-check";

const contestApiUrl = process.env.NEXT_PUBLIC_CONTEST_API_URL || "http://localhost:3002";
const AUTOSAVE_KEY = "practers:contest-dsa-question-form:draft:v1";

function toIdePreviewQuestion(data: DSAQuestionData): QuestionPayload {
    const sampleTestCases = data.sampleTestCases.filter((testCase) => testCase.input.trim() || testCase.output.trim());
    const hiddenTestCases = data.hiddenTestCases.filter((testCase) => testCase.input.trim() || testCase.output.trim());

    return {
        id: data.problemId || "draft",
        title: data.title || "Untitled Problem",
        difficulty: data.difficulty,
        timeLimit: data.timeLimit,
        memoryLimit: data.memoryLimit,
        topics: data.topics,
        companyTags: data.companyTags,
        description: data.description,
        examples: data.examples.filter((example) => example.example_text.trim()),
        constraints: data.constraints.filter((constraint) => constraint.trim()),
        sampleTestCases,
        hiddenTestCases,
        sampleTestCaseCount: sampleTestCases.length,
        hiddenTestCaseCount: hiddenTestCases.length,
        codeSnippets: data.codeSnippets,
        followUpQuestions: data.followUp,
        hints: data.hints,
        solution: data.solution,
        judgeType: data.judgeType,
        checkerLanguage: data.checkerLanguage,
        checkerCode: data.checkerCode,
    };
}

function NotAuthorized() {
    const router = useRouter();
    useEffect(() => {
        const timer = setTimeout(() => router.replace("/dashboard"), 2500);
        return () => clearTimeout(timer);
    }, [router]);

    return (
        <div className="flex min-h-[60vh] flex-1 flex-col items-center justify-center px-6 text-center">
            <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-rose-50 text-rose-500 dark:bg-rose-500/10">
                <span className="material-symbols-outlined text-4xl">lock</span>
            </div>
            <h1 className="text-xl font-bold text-slate-950 dark:text-white">Page not found</h1>
            <p className="mt-2 text-sm font-semibold text-slate-500">Redirecting you back to the dashboard...</p>
        </div>
    );
}

export default function ContestQuestionCreatePage() {
    const router = useRouter();
    const { resolvedTheme } = useTheme();
    const { isContestManager, loading } = useContestManagerCheck();
    const [showPreview, setShowPreview] = useState(false);
    const [previewData, setPreviewData] = useState<DSAQuestionData | null>(null);
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        const frame = window.requestAnimationFrame(() => setMounted(true));
        return () => window.cancelAnimationFrame(frame);
    }, []);
    const isDark = mounted && resolvedTheme === "dark";
    const previewQuestion = useMemo(
        () => (previewData ? toIdePreviewQuestion(previewData) : null),
        [previewData]
    );

    const fetchNextId = async (accessToken?: string) => {
        const response = await fetch(`${contestApiUrl}/admin/contest-questions/dsa/next-id`, {
            headers: {
                ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
            },
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.message || "Failed to fetch next contest question ID");
        }
        return data as { success: boolean; nextId: string };
    };

    const submitQuestion = async (payload: DSAQuestionData, accessToken?: string) => {
        const response = await fetch(`${contestApiUrl}/admin/contest-questions/dsa`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
            },
            body: JSON.stringify(payload),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            const validationDetails = Array.isArray(data.details)
                ? data.details.map((detail: { message?: string }) => detail.message).filter(Boolean).join("\n")
                : "";
            throw new Error(data.message || validationDetails || "Failed to create contest question");
        }
    };

    if (loading) {
        return (
            <div className="flex min-h-[60vh] flex-1 items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            </div>
        );
    }

    if (!isContestManager) return <NotAuthorized />;

    if (showPreview && previewQuestion) {
        return (
            <CompanyQuestionIdePreview
                question={previewQuestion}
                type="dsa"
                backHref="/admin/contest-questions/new"
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
                            href="/admin/contest-questions"
                            className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-slate-500 transition hover:text-primary dark:text-slate-400"
                        >
                            <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                            Back to contest questions
                        </Link>
                        <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">
                            Contest Question Bank
                        </p>
                        <h1 className="mt-2 font-nunito text-3xl font-extrabold tracking-tight text-slate-950 dark:text-white sm:text-4xl">
                            Create DSA Question
                        </h1>
                        <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-slate-500 dark:text-slate-400">
                            Add a contest-ready coding question with examples, hidden tests, starter code, wrappers, and checked solutions.
                        </p>
                    </div>

                    <div className="flex flex-wrap gap-3">
                        <button
                            type="button"
                            onClick={() => router.push("/admin/contest-questions/mcq/new")}
                            className="inline-flex h-12 items-center justify-center rounded-full border border-primary/25 bg-primary/10 px-5 text-sm font-extrabold text-primary shadow-sm transition hover:bg-primary/15 dark:border-primary/35 dark:bg-primary/15"
                        >
                            Create MCQ
                        </button>
                        {previewData && (
                            <button
                                type="button"
                                onClick={() => setShowPreview((value) => !value)}
                                className="inline-flex h-12 items-center justify-center rounded-full bg-primary px-5 text-sm font-extrabold text-white shadow-lg shadow-primary/20 transition hover:bg-primary/90"
                            >
                                {showPreview ? "Edit form" : "Preview question"}
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => router.push("/admin/contest-questions")}
                            className="inline-flex h-12 items-center justify-center rounded-full border border-slate-200 bg-white px-5 text-sm font-extrabold text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-lc-border dark:bg-lc-surface dark:text-slate-100 dark:hover:bg-lc-hover"
                        >
                            View Questions
                        </button>
                    </div>
                </div>

                <div>
                    <DSAQuestionForm
                        initialData={previewData || undefined}
                        onPreview={(data) => {
                            setPreviewData(data);
                            setShowPreview(true);
                        }}
                        autosaveKey={AUTOSAVE_KEY}
                        fetchNextId={fetchNextId}
                        submitQuestion={submitQuestion}
                        successMessage="Contest question created"
                        successDetail="The question has been saved to the contest question bank."
                        onSubmitSuccess={() => router.push("/admin/contest-questions")}
                    />
                </div>
            </div>
        </main>
    );
}
