"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { api } from "@/lib/api";

export type QuestionType = "dsa" | "sql" | "cs_fundamentals" | "system_design";

interface ReportQuestionModalProps {
    questionId: string;
    questionType: QuestionType;
    questionTitle?: string;
    sessionId?: string;
    triggerClassName?: string;
    iconOnly?: boolean;
}

const REASONS = [
    { value: "wrong_answer",     label: "Wrong / Incorrect Answer" },
    { value: "typo",             label: "Typo or Grammar Issue" },
    { value: "broken_test_case", label: "Broken Test Case" },
    { value: "misleading",       label: "Misleading Problem Statement" },
    { value: "other",            label: "Other" },
] as const;

type Reason = typeof REASONS[number]["value"];

export function ReportQuestionModal({
    questionId,
    questionType,
    questionTitle,
    sessionId,
    triggerClassName,
    iconOnly,
}: ReportQuestionModalProps) {
    const [open, setOpen]             = useState(false);
    const [reason, setReason]         = useState<Reason | "">("");
    const [description, setDesc]      = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted]   = useState(false);
    const [error, setError]           = useState<string | null>(null);

    const reset = () => {
        setReason("");
        setDesc("");
        setSubmitting(false);
        setSubmitted(false);
        setError(null);
    };

    const close = () => { setOpen(false); setTimeout(reset, 300); };

    const handleSubmit = async () => {
        if (!reason) return;
        setSubmitting(true);
        setError(null);
        try {
            const { data } = await createSupabaseBrowserClient().auth.getSession();
            const token = data.session?.access_token;
            await api.post("/question-reports", {
                questionId,
                questionType,
                questionTitle,
                reason,
                description: description.trim() || undefined,
                sessionId,
            }, token);
            setSubmitted(true);
        } catch (err: any) {
            setError(err?.message || "Failed to submit report. Please try again.");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <>
            {/* Trigger button */}
            <button
                onClick={() => setOpen(true)}
                title="Report an issue with this question"
                className={triggerClassName ?? "flex items-center gap-1 text-[11px] text-slate-400 hover:text-red-500 dark:text-slate-500 dark:hover:text-red-400 transition-colors cursor-pointer select-none font-nunito"}
            >
                <span className="material-symbols-outlined text-[14px]">flag</span>
                {!iconOnly && <span className="hidden sm:inline">Report</span>}
            </button>

            {/* Modal backdrop */}
            {open && (
                <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
                    <div
                        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                        onClick={close}
                    />

                    <div className="relative w-full max-w-md bg-white dark:bg-lc-surface rounded-2xl shadow-2xl border border-slate-200 dark:border-lc-border overflow-hidden animate-in zoom-in-95 fade-in duration-200 font-nunito">
                        {/* Header */}
                        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-lc-border">
                            <div className="flex items-center gap-2.5">
                                <div className="size-8 rounded-lg bg-red-50 dark:bg-red-500/10 flex items-center justify-center">
                                    <span className="material-symbols-outlined text-red-500 text-[18px]">flag</span>
                                </div>
                                <div>
                                    <h3 className="font-bold text-slate-900 dark:text-white text-base">Report an Issue</h3>
                                    {questionTitle && (
                                        <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[220px]">{questionTitle}</p>
                                    )}
                                </div>
                            </div>
                            <button
                                onClick={close}
                                className="size-7 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-lc-hover transition-colors cursor-pointer"
                            >
                                <span className="material-symbols-outlined text-slate-400 text-[18px]">close</span>
                            </button>
                        </div>

                        {/* Body */}
                        <div className="px-5 py-4">
                            {submitted ? (
                                /* ── Success state ── */
                                <div className="flex flex-col items-center gap-3 py-6 text-center">
                                    <div className="size-14 rounded-full bg-green-50 dark:bg-green-500/10 flex items-center justify-center">
                                        <span className="material-symbols-outlined text-green-500 text-3xl">check_circle</span>
                                    </div>
                                    <div>
                                        <p className="font-bold text-slate-900 dark:text-white">Report Submitted!</p>
                                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Thanks for helping us improve. We'll look into it.</p>
                                    </div>
                                    <button
                                        onClick={close}
                                        className="mt-2 px-6 py-2 rounded-xl bg-slate-100 dark:bg-lc-hover font-semibold text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                                    >
                                        Close
                                    </button>
                                </div>
                            ) : (
                                <>
                                    {/* Reason selection */}
                                    <p className="text-base font-bold text-slate-900 dark:text-white mb-3">What's the issue?</p>
                                    <div className="flex flex-col gap-2 mb-4">
                                        {REASONS.map(r => (
                                            <button
                                                key={r.value}
                                                onClick={() => setReason(r.value)}
                                                className={`flex items-center justify-between px-4 py-3 rounded-xl border text-left transition-all cursor-pointer ${
                                                    reason === r.value
                                                        ? "border-red-400 bg-red-50 dark:bg-red-500/10 dark:border-red-500/40"
                                                        : "border-slate-200 dark:border-lc-border hover:border-slate-300 dark:hover:border-slate-600"
                                                }`}
                                            >
                                                <span className={`text-sm font-medium ${reason === r.value ? "text-red-700 dark:text-red-400" : "text-slate-700 dark:text-slate-300"}`}>
                                                    {r.label}
                                                </span>
                                                {reason === r.value && (
                                                    <span className="material-symbols-outlined text-red-500 text-[16px]">check_circle</span>
                                                )}
                                            </button>
                                        ))}
                                    </div>

                                    {/* Optional description */}
                                    <div className="mb-4">
                                        <p className="text-base font-bold text-slate-900 dark:text-white mb-2">Additional details <span className="font-normal text-slate-500 dark:text-slate-400 text-xs">(optional)</span></p>
                                        <textarea
                                            value={description}
                                            onChange={e => setDesc(e.target.value)}
                                            placeholder="Describe the issue in more detail..."
                                            rows={3}
                                            className="w-full text-sm font-nunito rounded-xl border border-slate-200 dark:border-lc-border bg-white dark:bg-lc-bg text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 px-4 py-3 outline-none focus:border-red-400 dark:focus:border-red-500/50 resize-none transition-colors"
                                        />
                                    </div>

                                    {error && (
                                        <p className="text-xs text-red-500 mb-3">{error}</p>
                                    )}

                                    {/* Actions */}
                                    <div className="flex gap-3">
                                        <button
                                            onClick={close}
                                            className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-lc-border text-sm font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-lc-hover transition-colors cursor-pointer"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            onClick={handleSubmit}
                                            disabled={!reason || submitting}
                                            className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold transition-colors cursor-pointer flex items-center justify-center gap-2"
                                        >
                                            {submitting ? (
                                                <>
                                                    <div className="size-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                                    Submitting...
                                                </>
                                            ) : (
                                                "Submit Report"
                                            )}
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
