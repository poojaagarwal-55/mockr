"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useState } from "react";
import {
    CompanyQuestionIdePreview,
    QuestionPayload,
    QuestionType,
} from "@/components/question-bank/company-question-ide-preview";
import { useCompanyAuth } from "@/context/company-auth-context";
import { api, ApiError } from "@/lib/api";

type StandaloneQuestionIdePageProps = {
    routeType: "dsa" | "sql" | "system-design" | "cs-fundamentals";
    type: QuestionType;
    backHref: string;
};

type QuestionResponse = {
    question: QuestionPayload;
};

export function CompanyStandaloneQuestionIdePage({
    routeType,
    type,
    backHref,
}: StandaloneQuestionIdePageProps) {
    const params = useParams<{ questionId: string }>();
    const searchParams = useSearchParams();
    const { resolvedTheme } = useTheme();
    const { session } = useCompanyAuth();

    const questionId = params.questionId;
    const preferDataset = searchParams.get("source") === "dataset";

    const [question, setQuestion] = useState<QuestionPayload | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [mounted, setMounted] = useState(false);

    useEffect(() => setMounted(true), []);
    const isDark = mounted && resolvedTheme === "dark";

    const loadQuestion = useCallback(async () => {
        if (!session?.access_token) {
            setLoading(false);
            return;
        }

        setLoading(true);
        setError(null);
        try {
            const datasetPath = `/companies/question-bank/${routeType}/dataset/${questionId}`;
            const companyPath = `/companies/question-bank/${routeType}/${questionId}`;
            const payload = preferDataset
                ? await api.get<QuestionResponse>(datasetPath, session.access_token)
                : await api.get<QuestionResponse>(companyPath, session.access_token).catch(async (err) => {
                    if (err instanceof ApiError && err.status === 404) {
                        return api.get<QuestionResponse>(datasetPath, session.access_token);
                    }
                    throw err;
                });

            setQuestion(payload.question);
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "Failed to load question preview.");
        } finally {
            setLoading(false);
        }
    }, [preferDataset, questionId, routeType, session?.access_token]);

    useEffect(() => {
        void loadQuestion();
    }, [loadQuestion]);

    if (loading) {
        return (
            <main className="grid h-[calc(100vh-74px)] place-items-center bg-[#FAFBFC] dark:bg-lc-bg">
                <div className="text-center">
                    <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
                    <p className="mt-4 text-sm font-bold text-slate-500 dark:text-slate-400">Loading question preview</p>
                </div>
            </main>
        );
    }

    if (error || !question) {
        return (
            <main className="grid h-[calc(100vh-74px)] place-items-center bg-[#FAFBFC] px-6 text-center dark:bg-lc-bg">
                <div>
                    <p className="text-sm font-semibold text-red-600 dark:text-red-400">{error || "Question not found."}</p>
                    <Link href={backHref} className="mt-4 inline-flex text-sm font-extrabold text-primary">
                        Back to all questions
                    </Link>
                </div>
            </main>
        );
    }

    const resolvedBackHref = preferDataset ? `${backHref}?add=1` : backHref;

    return (
        <CompanyQuestionIdePreview
            question={question}
            type={type}
            backHref={resolvedBackHref}
            isDark={isDark}
        />
    );
}
