"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneLight, vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { Doughnut } from "react-chartjs-2";
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from "chart.js";
import { useAuth } from "@/context/auth-context";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api";

ChartJS.register(ArcElement, Tooltip, Legend);

const LANGUAGE_LABELS: Record<string, string> = {
    python: "Python",
    javascript: "JavaScript",
    typescript: "TypeScript",
    java: "Java",
    cpp: "C++",
    go: "Go",
};

const PRISM_LANGUAGE: Record<string, string> = {
    python: "python",
    javascript: "javascript",
    typescript: "typescript",
    java: "java",
    cpp: "cpp",
    go: "go",
};

type PeerReport = {
    sessionId: string;
    interviewType: string;
    generatedAt: string;
    overallScore: number;
    language: string;
    solvedQuestion: boolean | null;
    ratings: {
        problemSolving: number;
        codeQuality: number;
        communication: number;
        interviewing: number;
    };
    whatWentWell: string | null;
    improvementAreas: string | null;
    aiSummary: {
        overview: string;
        strength: string;
        improvement: string;
    } | null;
    question: {
        questionId: string;
        title: string;
        difficulty: string;
        category: string;
        topics: string[];
        description: string | null;
        practiceUrl: string;
    } | null;
    myCode: { code: string; language: string } | null;
    sampleAnswer: { language: string; code: string; explanation: string | null } | null;
};

const STAR_QUESTIONS: Array<{ key: keyof PeerReport["ratings"]; label: string }> = [
    { key: "problemSolving", label: "How were your partner's problem solving skills?" },
    { key: "codeQuality", label: "How were your partner's coding skills?" },
    { key: "communication", label: "How were your partner's communication skills?" },
    { key: "interviewing", label: "How did your partner perform as your interviewer?" },
];

function scoreColorHex(score: number): string {
    if (score > 70) return "#10b981";
    if (score >= 40) return "#f59e0b";
    return "#ef4444";
}

function scoreLabel(score: number): string {
    if (score >= 80) return "Excellent";
    if (score >= 65) return "Strong";
    if (score >= 45) return "Solid";
    if (score >= 25) return "Developing";
    return "Needs work";
}

function difficultyTagClass(difficulty: string): string {
    const d = difficulty.toLowerCase();
    if (d === "easy") return "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400";
    if (d === "medium") return "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400";
    if (d === "hard") return "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400";
    return "bg-slate-100 text-slate-600 dark:bg-white/[0.06] dark:text-slate-300";
}

function StarRow({ value }: { value: number }) {
    return (
        <div className="flex items-center gap-0.5">
            {[1, 2, 3, 4, 5].map((star) => (
                <span
                    key={star}
                    className={`material-symbols-outlined text-[22px] ${
                        star <= value ? "text-amber-400" : "text-slate-300 dark:text-slate-600"
                    }`}
                    style={{ fontVariationSettings: star <= value ? "'FILL' 1" : "'FILL' 0" }}
                >
                    star
                </span>
            ))}
            <span className="ml-2 text-sm font-bold text-slate-500 dark:text-slate-400 tabular-nums">{value}/5</span>
        </div>
    );
}

function useIsDark() {
    const [isDark, setIsDark] = useState(false);
    useEffect(() => {
        const el = document.documentElement;
        const update = () => setIsDark(el.classList.contains("dark"));
        update();
        const observer = new MutationObserver(update);
        observer.observe(el, { attributes: true, attributeFilter: ["class"] });
        return () => observer.disconnect();
    }, []);
    return isDark;
}

function CodeBlock({ code, language, isDark }: { code: string; language: string; isDark: boolean }) {
    return (
        <SyntaxHighlighter
            language={PRISM_LANGUAGE[language] || "text"}
            style={isDark ? vscDarkPlus : oneLight}
            customStyle={{
                margin: 0,
                borderRadius: "0.75rem",
                fontSize: "13px",
                background: isDark ? "#1a1a1a" : "#f8fafc",
                padding: "1rem 1.25rem",
            }}
            wrapLongLines
        >
            {code}
        </SyntaxHighlighter>
    );
}

export default function PeerSessionReportPage() {
    useEffect(() => { document.title = "Peer Report | Mockr"; }, []);
    const { session } = useAuth();
    const params = useParams();
    const router = useRouter();
    const sessionId = params?.sessionId as string;
    const isDark = useIsDark();

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [report, setReport] = useState<PeerReport | null>(null);

    const [questionOpen, setQuestionOpen] = useState(true);
    const [codeTab, setCodeTab] = useState<"yours" | "sample">("yours");

    useEffect(() => {
        if (!session?.access_token || !sessionId) return;
        let cancelled = false;
        setLoading(true);
        setError(null);

        api.get<PeerReport>(`/p2p/sessions/${sessionId}/report`, session.access_token)
            .then((response) => {
                if (!cancelled) setReport(response);
            })
            .catch((err) => {
                if (!cancelled) setError(err instanceof Error ? err.message : "Unable to load report");
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [session?.access_token, sessionId]);

    const generatedDate = useMemo(() => {
        if (!report?.generatedAt) return "";
        return new Date(report.generatedAt).toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
        });
    }, [report?.generatedAt]);

    const chartData = useMemo(() => {
        const score = report?.overallScore ?? 0;
        return {
            labels: ["Score", "Remaining"],
            datasets: [
                {
                    data: [score, 100 - score],
                    backgroundColor: [scoreColorHex(score), isDark ? "#2a2a2a" : "#f1f5f9"],
                    borderWidth: 0,
                    cutout: "80%",
                },
            ],
        };
    }, [report?.overallScore, isDark]);

    const languageLabel = report ? LANGUAGE_LABELS[report.language] ?? report.language : "";

    if (loading) {
        return (
            <div className="flex-1 flex items-center justify-center py-32 dark:bg-lc-bg">
                <div className="size-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    if (error?.includes("No feedback available")) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center py-20 dark:bg-lc-bg gap-6 px-4">
                <div className="size-24 bg-slate-100 dark:bg-white/[0.06] rounded-full flex items-center justify-center">
                    <span className="material-symbols-outlined text-5xl text-slate-400" style={{ fontVariationSettings: "'FILL' 0" }}>hourglass_top</span>
                </div>
                <div className="text-center max-w-md">
                    <h2 className="text-3xl font-black font-nunito tracking-tight text-slate-950 dark:text-white mb-3">Still waiting...</h2>
                    <p className="text-slate-500 dark:text-slate-400 leading-relaxed">
                        Your partner is crafting the most thoughtful, insightful piece of feedback known to humankind.
                        <br /><br />
                        Or they&apos;re procrastinating. Honestly, it could be either.
                    </p>
                </div>
                <div className="flex flex-wrap gap-3 justify-center">
                    <button
                        onClick={() => router.push("/interviews/peer/reports")}
                        className="px-6 py-2.5 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-lg font-bold hover:opacity-90 transition-opacity"
                    >
                        Back to reports
                    </button>
                    <button
                        onClick={() => window.location.reload()}
                        className="px-6 py-2.5 border border-slate-300 dark:border-lc-border text-slate-700 dark:text-slate-200 rounded-lg font-bold hover:bg-slate-50 dark:hover:bg-white/[0.04] transition-colors"
                    >
                        Check again
                    </button>
                </div>
            </div>
        );
    }

    if (error || !report) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center py-20 dark:bg-lc-bg">
                <div className="size-16 bg-red-50 dark:bg-red-500/10 rounded-full flex items-center justify-center mb-4">
                    <span className="material-symbols-outlined text-red-500 text-3xl">error</span>
                </div>
                <h2 className="text-2xl font-bold font-nunito tracking-tight text-slate-950 dark:text-white">Report not available</h2>
                <p className="text-slate-500 mb-6">{error || "This report could not be loaded yet."}</p>
                <button
                    onClick={() => router.push("/interviews/peer/reports")}
                    className="px-6 py-2.5 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-lg font-bold hover:opacity-90 transition-opacity"
                >
                    Back to reports
                </button>
            </div>
        );
    }

    const dynamicColorHex = scoreColorHex(report.overallScore);

    return (
        <div className="flex-1 overflow-auto bg-[#FAFBFC] dark:bg-lc-bg">
            <PageHeader
                showBack
                backUrl="/interviews/peer/reports"
                titleNode={
                    <div className="flex flex-col gap-1.5">
                        <h1 className="text-[28px] font-bold text-slate-900 dark:text-white font-nunito tracking-[-0.02em]">Peer Interview Report</h1>
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-md bg-slate-100 dark:bg-white/[0.06] text-[11px] font-semibold text-slate-800 dark:text-slate-200">
                                Coding
                            </span>
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-md bg-slate-100 dark:bg-white/[0.06] text-[11px] font-semibold text-slate-800 dark:text-slate-200">
                                {generatedDate}
                            </span>
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-md bg-slate-100 dark:bg-white/[0.06] text-[11px] font-semibold text-slate-800 dark:text-slate-200">
                                {languageLabel}
                            </span>
                        </div>
                    </div>
                }
            />

            <main className="max-w-[1280px] mx-auto py-8 px-6 space-y-6">

                {/* ── Score + AI Summary ── */}
                <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
                    {/* Score */}
                    <div className="bg-white dark:bg-lc-surface rounded-2xl border border-slate-200 dark:border-lc-border p-8 shadow-sm flex flex-col relative overflow-hidden">
                        <div
                            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 size-48 rounded-full blur-[80px] opacity-20 pointer-events-none"
                            style={{ backgroundColor: dynamicColorHex }}
                        />
                        <div className="flex items-center gap-3 mb-5">
                            <h2 className="text-2xl font-bold font-nunito tracking-tight text-slate-950 dark:text-white">Overall Score</h2>
                        </div>
                        <div className="flex flex-col items-center flex-1 justify-center text-center">
                            <div className="relative size-40 mb-4 flex items-center justify-center">
                                <Doughnut data={chartData} options={{ maintainAspectRatio: true, plugins: { tooltip: { enabled: false }, legend: { display: false } } }} />
                                <div className="absolute inset-0 flex flex-col items-center justify-center">
                                    <span className="text-4xl font-black tracking-tighter" style={{ color: dynamicColorHex }}>
                                        {report.overallScore}
                                    </span>
                                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mt-1">/ 100</span>
                                </div>
                            </div>
                            <p className="text-sm font-semibold text-slate-700 dark:text-slate-300 mt-1">{scoreLabel(report.overallScore)}</p>

                            {report.solvedQuestion !== null && (
                                <div
                                    className={`mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold ${
                                        report.solvedQuestion
                                            ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400"
                                            : "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400"
                                    }`}
                                >
                                    <span className="material-symbols-outlined text-sm">
                                        {report.solvedQuestion ? "check_circle" : "pending"}
                                    </span>
                                    {report.solvedQuestion ? "Solved the question" : "Did not fully solve"}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* AI Summary */}
                    <div className="bg-white dark:bg-lc-surface rounded-2xl border border-slate-200 dark:border-lc-border p-8 shadow-sm">
                        <div className="flex items-center gap-3 mb-5">
                            <div className="size-10 rounded-xl bg-primary/10 flex items-center justify-center">
                                <span className="material-symbols-outlined text-primary text-xl">auto_awesome</span>
                            </div>
                            <h2 className="text-2xl font-bold font-nunito tracking-tight text-slate-950 dark:text-white">AI Summary</h2>
                        </div>
                        {report.aiSummary && (report.aiSummary.overview || report.aiSummary.strength || report.aiSummary.improvement) ? (
                            <div className="space-y-4">
                                {report.aiSummary.overview && (
                                    <div>
                                        <div className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-0.5">Overview</div>
                                        <p className="text-[14px] leading-relaxed text-slate-800 dark:text-slate-200">{report.aiSummary.overview}</p>
                                    </div>
                                )}
                                {report.aiSummary.strength && (
                                    <div>
                                        <div className="text-xs font-bold uppercase tracking-wide text-emerald-600 dark:text-emerald-400 mb-0.5">Strength</div>
                                        <p className="text-[14px] leading-relaxed text-slate-800 dark:text-slate-200">{report.aiSummary.strength}</p>
                                    </div>
                                )}
                                {report.aiSummary.improvement && (
                                    <div>
                                        <div className="text-xs font-bold uppercase tracking-wide text-blue-600 dark:text-blue-400 mb-0.5">Improvement</div>
                                        <p className="text-[14px] leading-relaxed text-slate-800 dark:text-slate-200">{report.aiSummary.improvement}</p>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <p className="text-slate-400 dark:text-slate-500 text-sm italic">
                                A performance summary will appear here once it has been generated from your partner&apos;s feedback.
                            </p>
                        )}
                    </div>
                </div>

                {/* ── Partner Ratings ── */}
                <div className="space-y-3">
                    <h2 className="text-2xl font-bold font-nunito tracking-tight text-slate-950 dark:text-white">Partner Feedback</h2>
                    <div className="bg-white dark:bg-lc-surface rounded-2xl border border-slate-200 dark:border-lc-border px-8 py-2 shadow-sm">
                        <div className="divide-y divide-slate-100 dark:divide-lc-border">
                            {STAR_QUESTIONS.map((q) => (
                                <div key={q.key} className="flex items-center justify-between gap-4 py-4">
                                    <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">{q.label}</span>
                                    <StarRow value={report.ratings[q.key]} />
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* ── Coding Question ── */}
                <div className="space-y-3">
                    <h2 className="text-2xl font-bold font-nunito tracking-tight text-slate-950 dark:text-white">Coding Question</h2>

                    {report.question ? (
                        <div className="bg-white dark:bg-lc-surface rounded-2xl border border-slate-200 dark:border-lc-border shadow-sm overflow-hidden">
                            {/* Card header row */}
                            <div className="flex items-center justify-between gap-3 px-5 py-4">
                                <button
                                    onClick={() => setQuestionOpen((v) => !v)}
                                    className="flex items-center gap-3 flex-1 min-w-0 text-left group"
                                >
                                    <span
                                        className={`material-symbols-outlined text-slate-400 transition-transform duration-200 ${questionOpen ? "rotate-180" : ""}`}
                                    >
                                        expand_more
                                    </span>
                                    <div className="min-w-0">
                                        <div className="font-semibold text-slate-900 dark:text-white truncate group-hover:text-primary transition-colors">
                                            {report.question.title}
                                        </div>
                                        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${difficultyTagClass(report.question.difficulty)}`}>
                                                {report.question.difficulty}
                                            </span>
                                            {report.question.topics.map((topic) => (
                                                <span key={topic} className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 dark:bg-white/[0.06] dark:text-slate-300">
                                                    {topic}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                </button>
                                <a
                                    href={report.question.practiceUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-emerald-500 hover:bg-emerald-600 text-white transition-colors"
                                >
                                    <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                                    Open in IDE
                                </a>
                            </div>

                            {/* Dropdown body */}
                            {questionOpen && (
                                <div className="border-t border-slate-100 dark:border-lc-border">
                                    {report.question.description && (
                                        <div className="px-5 py-5 border-b border-slate-100 dark:border-lc-border">
                                            <div className="prose prose-sm dark:prose-invert max-w-none prose-pre:bg-slate-50 dark:prose-pre:bg-lc-bg">
                                                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
                                                    {report.question.description}
                                                </ReactMarkdown>
                                            </div>
                                        </div>
                                    )}

                                    {/* Tabs */}
                                    <div className="px-5 pt-4">
                                        <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-lc-bg">
                                            <button
                                                onClick={() => setCodeTab("yours")}
                                                className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                                                    codeTab === "yours"
                                                        ? "bg-white dark:bg-lc-surface text-slate-900 dark:text-white shadow-sm"
                                                        : "text-slate-500 dark:text-slate-400 hover:text-slate-700"
                                                }`}
                                            >
                                                Your Code
                                            </button>
                                            <button
                                                onClick={() => setCodeTab("sample")}
                                                className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                                                    codeTab === "sample"
                                                        ? "bg-white dark:bg-lc-surface text-slate-900 dark:text-white shadow-sm"
                                                        : "text-slate-500 dark:text-slate-400 hover:text-slate-700"
                                                }`}
                                            >
                                                Sample Answer
                                            </button>
                                        </div>
                                    </div>

                                    <div className="px-5 py-4">
                                        {codeTab === "yours" ? (
                                            report.myCode?.code ? (
                                                <CodeBlock code={report.myCode.code} language={report.myCode.language} isDark={isDark} />
                                            ) : (
                                                <div className="rounded-xl border border-dashed border-slate-200 dark:border-lc-border px-5 py-10 text-center text-sm text-slate-400">
                                                    No code was captured for this session.
                                                </div>
                                            )
                                        ) : report.sampleAnswer?.code ? (
                                            <div className="space-y-3">
                                                <CodeBlock code={report.sampleAnswer.code} language={report.sampleAnswer.language} isDark={isDark} />
                                                {report.sampleAnswer.explanation && (
                                                    <div className="rounded-xl bg-slate-50 dark:bg-lc-bg border border-slate-100 dark:border-lc-border p-4 text-[13px] leading-relaxed text-slate-800 dark:text-slate-200">
                                                        {report.sampleAnswer.explanation}
                                                    </div>
                                                )}
                                            </div>
                                        ) : (
                                            <div className="rounded-xl border border-dashed border-slate-200 dark:border-lc-border px-5 py-10 text-center text-sm text-slate-400">
                                                No sample answer is available for this question.
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="bg-white dark:bg-lc-surface rounded-2xl border border-slate-200 dark:border-lc-border shadow-sm px-5 py-10 text-center text-sm text-slate-400">
                            No question was recorded for this session.
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}
