"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { api } from "@/lib/api";
import { ImproveResumeModal } from "@/components/resumes/improve-resume-modal";
import { UpgradeModal } from "@/components/upgrade-modal";
import { useBilling } from "@/hooks/use-billing";
import { Doughnut } from "react-chartjs-2";
import {
    Chart as ChartJS,
    ArcElement,
    Tooltip,
    Legend
} from 'chart.js';

ChartJS.register(ArcElement, Tooltip, Legend);

export default function AtsReportPage() {
    useEffect(() => { document.title = "ATS Report | Mockr"; }, []);
    const params = useParams();
    const router = useRouter();
    const resumeId = params.id as string;

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [resume, setResume] = useState<any>(null);
    const [improveOpen, setImproveOpen] = useState(false);
    const [upgradeOpen, setUpgradeOpen] = useState(false);
    const { snapshot } = useBilling();
    const isLocked = !snapshot || snapshot.plan === "FREE";

    useEffect(() => {
        async function fetchReport() {
            try {
                const { data } = await createSupabaseBrowserClient().auth.getSession();
                const token = data.session?.access_token;
                if (!token) throw new Error("Not authenticated");

                const res = await api.get<{ id: string, fileName: string, atsAnalysis: any }>(`/resumes/${resumeId}`, token);
                setResume(res);
            } catch (err: any) {
                setError(err.message || "Failed to load report");
            } finally {
                setLoading(false);
            }
        }
        fetchReport();
    }, [resumeId]);

    if (loading) {
        return (
            <div className="flex-1 flex items-center justify-center py-32">
                <div className="size-12 border-4 border-yellow-400 border-t-transparent rounded-full animate-spin shadow-[0_0_20px_rgba(250,204,21,0.2)]" />
            </div>
        );
    }

    if (error || !resume?.atsAnalysis) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center py-20">
                <div className="size-16 bg-red-50 dark:bg-red-500/10 rounded-full flex items-center justify-center mb-4">
                    <span className="material-symbols-outlined text-red-500 text-3xl">error</span>
                </div>
                <h2 className="text-[18px] font-bold text-slate-800 dark:text-white font-nunito tracking-tight text-left">Report Not Found</h2>
                <p className="text-slate-500 mb-6">{error || "This resume has not been analyzed yet."}</p>
                <button
                    onClick={() => router.push("/resumes")}
                    className="px-6 py-2.5 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-lg font-bold hover:opacity-90 transition-opacity"
                >
                    Back to Resumes
                </button>
            </div>
        );
    }

    const { atsAnalysis } = resume;
    const { overallScore, categories, summary, suggestions, matchedKeywords, missingKeywords } = atsAnalysis;

    const getDynamicScoreColorHex = (score: number) => {
        // Red: #ef4444
        // Amber: #f59e0b
        // Green: #10b981
        if (score > 70) return '#10b981';
        if (score >= 40) return '#f59e0b';
        return '#ef4444';
    };

    const dynamicColorHex = getDynamicScoreColorHex(overallScore);

    // Chart Data
    const chartData = {
        labels: ['Score', 'Remaining'],
        datasets: [
            {
                data: [overallScore, 100 - overallScore],
                backgroundColor: [
                    dynamicColorHex,
                    '#f1f5f9' // slate-100
                ],
                borderWidth: 0,
                cutout: '80%',
            },
        ],
    };



    const getScoreBgColor = (score: number) => {
        if (score > 70) return "bg-slate-50 dark:bg-black/[0.35] border-emerald-200 dark:border-emerald-500/30";
        if (score >= 40) return "bg-slate-50 dark:bg-black/[0.35] border-amber-200 dark:border-amber-500/30";
        return "bg-slate-50 dark:bg-black/[0.35] border-red-200 dark:border-red-500/30";
    };

    const formatCategoryName = (name: string) => {
        return name.charAt(0).toUpperCase() + name.slice(1);
    };

    return (
        <div className="flex-1 overflow-auto bg-slate-50/50 dark:bg-[#1a1a1a] print:overflow-visible print:bg-white print:text-black print:block">
            {/* Minimal Header */}
            <div className="sticky top-0 z-10 bg-white/80 dark:bg-lc-surface/80 backdrop-blur-xl px-4 md:px-8 py-3 md:py-4 flex items-center justify-between print:hidden">
                <div className="flex items-center gap-2 md:gap-4">
                    <button
                        onClick={() => router.push("/resumes")}
                        className="size-7 md:size-8 flex items-center justify-center rounded-lg hover:opacity-80 transition-opacity"
                    >
                        <span className="material-symbols-outlined text-slate-600 dark:text-slate-400 text-[18px] md:text-[20px]">arrow_back</span>
                    </button>
                    <h1 className="text-[18px] md:text-[28px] font-bold text-slate-900 dark:text-white font-nunito tracking-[-0.02em]">
                        Resume Reportcard
                    </h1>
                </div>
                <div className="flex items-center gap-1.5 md:gap-2">
                    <button
                        onClick={() => isLocked ? setUpgradeOpen(true) : setImproveOpen(true)}
                        className="flex items-center gap-1 md:gap-2 px-2.5 md:px-4 py-1.5 md:py-2 rounded-full text-[10px] md:text-sm font-bold bg-gradient-to-r from-[#1a3a8f] to-[#4A7CFF] hover:from-[#152d72] hover:to-[#3a6cef] text-white shadow-md shadow-blue-500/20 transition-all font-nunito"
                    >
                        <span className="material-symbols-outlined text-[15px] md:text-[18px]">auto_awesome</span>
                        <span>Improve with AI</span>
                    </button>
                    <button
                        onClick={() => window.print()}
                        className="flex items-center gap-1 md:gap-2 px-2.5 md:px-4 py-1.5 md:py-2 rounded-lg text-xs md:text-sm font-semibold bg-white dark:bg-lc-bg border border-slate-200 dark:border-lc-border hover:bg-slate-50 dark:hover:bg-lc-hover transition-colors text-slate-700 dark:text-slate-300"
                    >
                        <span className="material-symbols-outlined text-[15px] md:text-[18px]">print</span>
                        <span className="hidden sm:inline">Print PDF</span>
                    </button>
                </div>
            </div>

            <main className="max-w-[1000px] mx-auto py-8 px-6 space-y-8">

                {/* ── Overview Section ── */}
                <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
                    {/* Score Card */}
                    <div className="bg-white dark:bg-lc-surface rounded-2xl border border-slate-200 dark:border-lc-border p-8 shadow-sm flex flex-col items-center justify-center text-center relative overflow-hidden">
                        <div
                            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 size-48 rounded-full blur-[80px] opacity-20 pointer-events-none"
                            style={{ backgroundColor: dynamicColorHex }}
                        />

                        <div className="relative size-40 mb-4 flex items-center justify-center">
                            <Doughnut data={chartData} options={{ maintainAspectRatio: true, plugins: { tooltip: { enabled: false }, legend: { display: false } } }} />
                            <div className="absolute inset-0 flex flex-col items-center justify-center">
                                <span
                                    className="text-4xl font-black tracking-tighter"
                                    style={{ color: dynamicColorHex }}
                                >
                                    {overallScore}
                                </span>
                                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mt-1">/ 100</span>
                            </div>
                        </div>
                        <h3 className="text-base font-bold text-slate-900 dark:text-white">Match Score</h3>
                        <p className="text-xs text-slate-500 mt-1">
                            {overallScore > 70 ? 'Strong Match' : overallScore >= 40 ? 'Moderate Match' : 'Weak Match'}
                        </p>
                    </div>

                    {/* Executive Summary */}
                    <div className="bg-white dark:bg-lc-surface rounded-2xl border border-slate-200 dark:border-lc-border p-8 shadow-sm">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="size-10 rounded-xl bg-primary/10 flex items-center justify-center">
                                <span className="material-symbols-outlined text-primary text-xl">analytics</span>
                            </div>
                            <h2 className="text-[18px] font-bold text-slate-800 dark:text-white font-nunito tracking-tight text-left">Executive Summary</h2>
                        </div>
                        <p className="text-slate-600 dark:text-[#ccc] text-lg leading-relaxed">
                            {summary}
                        </p>
                    </div>
                </div>

                {/* ── Keywords Section (Side by Side) ── */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Matched Keywords */}
                    <div className="bg-white dark:bg-lc-surface rounded-2xl border border-slate-200 dark:border-lc-border p-8 shadow-sm">
                        <div className="flex items-center gap-3 mb-6 border-b border-slate-100 dark:border-lc-border pb-4">
                            <div className="size-8 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center">
                                <span className="material-symbols-outlined text-emerald-500 text-sm">check_circle</span>
                            </div>
                            <h2 className="text-[18px] font-bold text-slate-800 dark:text-white font-nunito tracking-tight text-left">Matched Keywords</h2>
                        </div>

                        {matchedKeywords?.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                                {matchedKeywords.map((kw: string, i: number) => (
                                    <span key={i} className="px-3 py-1.5 text-[11px] font-bold bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-500/20 rounded-md">
                                        {kw}
                                    </span>
                                ))}
                            </div>
                        ) : (
                            <p className="text-sm text-slate-500">No major keywords matched.</p>
                        )}
                    </div>

                    {/* Missing Keywords */}
                    <div className="bg-white dark:bg-lc-surface rounded-2xl border border-slate-200 dark:border-lc-border p-8 shadow-sm">
                        <div className="flex items-center gap-3 mb-6 border-b border-slate-100 dark:border-lc-border pb-4">
                            <div className="size-8 rounded-lg bg-red-50 dark:bg-red-500/10 flex items-center justify-center">
                                <span className="material-symbols-outlined text-red-500 text-sm">warning</span>
                            </div>
                            <h2 className="text-[18px] font-bold text-slate-800 dark:text-white font-nunito tracking-tight text-left">Missing Keywords</h2>
                        </div>

                        {missingKeywords?.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                                {missingKeywords.map((kw: string, i: number) => (
                                    <span key={i} className="px-3 py-1.5 text-[11px] font-bold bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400 border border-red-100 dark:border-red-500/20 rounded-md">
                                        {kw}
                                    </span>
                                ))}
                            </div>
                        ) : (
                            <p className="text-sm text-slate-500 px-1">Excellent! You matched all major keywords.</p>
                        )}
                    </div>
                </div>

                {/* ── Category Breakdown (Full Width) ── */}
                <div className="bg-white dark:bg-lc-surface rounded-2xl border border-slate-200 dark:border-lc-border p-8 shadow-sm space-y-6">
                    <div className="flex items-center gap-3 border-b border-slate-100 dark:border-lc-border pb-4">
                        <span className="material-symbols-outlined text-primary">category</span>
                        <h2 className="text-[18px] font-bold text-slate-800 dark:text-white font-nunito tracking-tight text-left">Category Breakdown</h2>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {Object.entries(categories).map(([key, data]: [string, any]) => (
                            <div key={key} className={`p-6 rounded-xl border flex flex-col h-full text-slate-800 dark:text-[#ccc] ${getScoreBgColor(data.score)}`}>
                                <div className="flex items-center justify-between mb-3 shrink-0">
                                    <h3 className="font-bold text-slate-900 dark:text-white tracking-wide">{formatCategoryName(key)}</h3>
                                    <span className={`text-sm font-black ${
                                        data.score > 70 ? 'text-emerald-600 dark:text-emerald-400' :
                                        data.score >= 40 ? 'text-amber-600 dark:text-amber-400' :
                                        'text-red-600 dark:text-red-400'
                                    }`}>{data.score}/100</span>
                                </div>
                                <p className="text-sm opacity-90 leading-relaxed flex-1">
                                    {data.feedback}
                                </p>
                            </div>
                        ))}
                    </div>
                </div>

                {/* ── Action Plan (Full Width) ── */}
                <div className="bg-white dark:bg-lc-surface rounded-2xl border border-slate-200 dark:border-lc-border p-8 shadow-sm space-y-6">
                    <div className="flex items-center gap-3 border-b border-slate-100 dark:border-lc-border pb-4">
                        <span className="material-symbols-outlined text-blue-500">checklist</span>
                        <h2 className="text-[18px] font-bold text-slate-800 dark:text-white font-nunito tracking-tight text-left">Action Plan</h2>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {suggestions?.map((item: string, i: number) => (
                            <div key={i} className="flex gap-4 p-5 rounded-xl bg-slate-50 dark:bg-lc-bg border border-slate-100 dark:border-lc-border h-full">
                                <div className="size-8 shrink-0 rounded-full bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold text-sm">
                                    {i + 1}
                                </div>
                                <p className="text-sm text-slate-700 dark:text-[#ccc] pt-1 leading-relaxed">
                                    {item}
                                </p>
                            </div>
                        ))}
                    </div>
                </div>

            </main>

            <ImproveResumeModal
                isOpen={improveOpen}
                onClose={() => setImproveOpen(false)}
                resumeId={resumeId}
            />
            <UpgradeModal
                open={upgradeOpen}
                onClose={() => setUpgradeOpen(false)}
                feature="resume_improve_ai"
                title="Improve resume with AI"
                description="Turn ATS feedback into a tailored rewrite. Available on Plus, Pro, and Max."
                currentPlan={snapshot?.plan ?? "FREE"}
                currentSubscriptionId={snapshot?.subscriptionId ?? undefined}
                reason="locked"
            />
        </div>
    );
}
