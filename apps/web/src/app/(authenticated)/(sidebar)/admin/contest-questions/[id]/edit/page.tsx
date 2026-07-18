"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { DSAQuestionForm, type DSAQuestionData } from "@/components/problem-setter/DSAQuestionForm";
import {
    CompanyQuestionIdePreview,
    type QuestionPayload,
} from "@/components/question-bank/company-question-ide-preview";
import { useContestManagerCheck } from "@/hooks/use-contest-manager-check";
import { createSupabaseBrowserClient } from "@/lib/supabase";

const contestApiUrl = process.env.NEXT_PUBLIC_CONTEST_API_URL || "http://localhost:3002";

function toIdePreviewQuestion(data: DSAQuestionData): QuestionPayload {
    const sampleTestCases = data.sampleTestCases.filter((tc) => tc.input.trim() || tc.output.trim());
    const hiddenTestCases = data.hiddenTestCases.filter((tc) => tc.input.trim() || tc.output.trim());
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

function toInitialData(q: any): DSAQuestionData {
    const snippet = (lang: string) => ({
        starter_code: q?.codeSnippets?.[lang]?.starter_code ?? q?.codeSnippets?.[lang]?.starterCode ?? "",
        wrapper_code: q?.codeSnippets?.[lang]?.wrapper_code ?? q?.codeSnippets?.[lang]?.wrapperCode ?? "",
    });
    const examples = Array.isArray(q?.examples) && q.examples.length
        ? q.examples.map((e: any, i: number) => ({ example_num: Number(e?.example_num ?? i + 1), example_text: String(e?.example_text ?? "") }))
        : [{ example_num: 1, example_text: "" }];
    const cases = (arr: any, kind: string) =>
        Array.isArray(arr) && arr.length
            ? arr.map((tc: any, i: number) => ({
                  id: String(tc?.id ?? `${kind}_${i + 1}`),
                  description: String(tc?.description ?? ""),
                  input: typeof tc?.input === "string" ? tc.input : JSON.stringify(tc?.input ?? ""),
                  output: typeof tc?.output === "string" ? tc.output : JSON.stringify(tc?.output ?? ""),
              }))
            : [{ id: `${kind}_1`, description: "", input: "", output: "" }];
    return {
        title: q?.title ?? "",
        problemId: q?.problemId ?? "",
        frontendId: q?.frontendId ?? "",
        difficulty: (["Easy", "Medium", "Hard"].includes(q?.difficulty) ? q.difficulty : "Easy"),
        problemSlug: q?.problemSlug ?? "",
        timeLimit: Number(q?.timeLimit ?? 2),
        memoryLimit: Number(q?.memoryLimit ?? 256),
        topics: Array.isArray(q?.topics) ? q.topics : [],
        companyTags: Array.isArray(q?.companyTags) ? q.companyTags : [],
        description: q?.description ?? "",
        examples,
        constraints: Array.isArray(q?.constraints) && q.constraints.length ? q.constraints : [""],
        sampleTestCases: cases(q?.sampleTestCases, "sample"),
        hiddenTestCases: cases(q?.hiddenTestCases, "hidden"),
        codeSnippets: {
            python3: snippet("python3"),
            cpp: snippet("cpp"),
            java: snippet("java"),
            javascript: snippet("javascript"),
        },
        followUp: Array.isArray(q?.followUp) ? q.followUp : [],
        hints: Array.isArray(q?.hints) ? q.hints : [],
        judgeType: q?.judgeType === "custom" ? "custom" : "default",
        checkerLanguage: (["python3", "cpp", "java", "javascript"].includes(q?.checkerLanguage) ? q.checkerLanguage : "cpp"),
        checkerCode: typeof q?.checkerCode === "string" ? q.checkerCode : "",
        solution: q?.solution || undefined,
    };
}

export default function ContestQuestionEditPage() {
    const router = useRouter();
    const params = useParams();
    const questionId = String(params.id || "");
    const { resolvedTheme } = useTheme();
    const { isContestManager, loading: authLoading } = useContestManagerCheck();
    const [initialData, setInitialData] = useState<DSAQuestionData | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [showPreview, setShowPreview] = useState(false);
    const [previewData, setPreviewData] = useState<DSAQuestionData | null>(null);
    const isDark = resolvedTheme === "dark";

    const getToken = useCallback(async () => {
        const supabase = createSupabaseBrowserClient();
        const { data } = await supabase.auth.getSession();
        return data.session?.access_token;
    }, []);

    useEffect(() => {
        if (!isContestManager || !questionId) return;
        let cancelled = false;
        (async () => {
            try {
                const token = await getToken();
                const res = await fetch(`${contestApiUrl}/admin/contest-questions/dsa/${encodeURIComponent(questionId)}`, {
                    headers: token ? { Authorization: `Bearer ${token}` } : {},
                    cache: "no-store",
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.message || "Failed to load question");
                if (!cancelled) setInitialData(toInitialData(data.question));
            } catch (err) {
                if (!cancelled) setLoadError(err instanceof Error ? err.message : "Failed to load question");
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [isContestManager, questionId, getToken]);

    const submitQuestion = async (payload: DSAQuestionData, accessToken?: string) => {
        const res = await fetch(`${contestApiUrl}/admin/contest-questions/dsa/${encodeURIComponent(questionId)}`, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
            },
            body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            const details = Array.isArray(data.details)
                ? data.details.map((d: { message?: string }) => d.message).filter(Boolean).join("\n")
                : "";
            throw new Error(data.message || details || "Failed to update question");
        }
    };

    if (authLoading) {
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
    if (!initialData) {
        return (
            <div className="flex min-h-[60vh] flex-1 items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            </div>
        );
    }

    const previewQuestion = previewData ? toIdePreviewQuestion(previewData) : null;
    if (showPreview && previewQuestion) {
        return (
            <CompanyQuestionIdePreview
                question={previewQuestion}
                type="dsa"
                backHref={`/admin/contest-questions/${questionId}/edit`}
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
                        <Link href="/admin/contest-questions" className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-slate-500 transition hover:text-primary dark:text-slate-400">
                            <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                            Back to contest questions
                        </Link>
                        <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Contest Question Bank</p>
                        <h1 className="mt-2 font-nunito text-3xl font-extrabold tracking-tight text-slate-950 dark:text-white sm:text-4xl">
                            Edit DSA Question
                        </h1>
                        <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-slate-500 dark:text-slate-400">
                            Update this coding question — examples, tests, code, checker and solutions — then save your changes.
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-3">
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
                </div>

                <div>
                    <DSAQuestionForm
                        initialData={initialData}
                        onPreview={(data) => {
                            setPreviewData(data);
                            setShowPreview(true);
                        }}
                        submitQuestion={submitQuestion}
                        successMessage="Contest question updated"
                        successDetail="Your changes have been saved to the contest question bank."
                        onSubmitSuccess={() => router.push("/admin/contest-questions")}
                    />
                </div>
            </div>
        </main>
    );
}
