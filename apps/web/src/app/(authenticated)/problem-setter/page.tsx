"use client";

import { useState } from "react";
import { DSAQuestionForm } from "@/components/problem-setter/DSAQuestionForm";
import { DSAQuestionPreview } from "@/components/problem-setter/DSAQuestionPreview";

export default function ProblemSetterPage() {
    const [showPreview, setShowPreview] = useState(false);
    const [previewData, setPreviewData] = useState<any>(null);

    return (
        <div className="relative min-h-screen overflow-hidden bg-[#050713] text-white">
            <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_50%_-18%,rgba(56,189,248,0.28),transparent_34%),radial-gradient(circle_at_14%_18%,rgba(139,92,246,0.18),transparent_30%),radial-gradient(circle_at_88%_32%,rgba(20,184,166,0.13),transparent_28%),linear-gradient(180deg,#050713_0%,#08111f_42%,#050713_100%)]" />
            <div className="pointer-events-none fixed inset-x-0 top-0 h-[420px] bg-[linear-gradient(90deg,transparent,rgba(34,211,238,0.13),transparent)] blur-3xl" />
            <div className="pointer-events-none fixed -left-28 top-24 h-72 w-72 rounded-full bg-violet-500/10 blur-3xl" />
            <div className="pointer-events-none fixed -right-24 top-40 h-80 w-80 rounded-full bg-cyan-400/10 blur-3xl" />
            <div className="pointer-events-none fixed inset-0 opacity-[0.055] [background-image:linear-gradient(rgba(255,255,255,0.7)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.7)_1px,transparent_1px)] [background-size:64px_64px]" />
            <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(0,0,0,0.34)_88%)]" />
            <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
                <div className="relative mb-8 flex items-center justify-between gap-6">
                    <div>
                        <p className="mb-3 text-xs font-black uppercase tracking-[0.24em] text-cyan-300">
                            Problem Setter
                        </p>
                        <h1 className="mb-2 text-[2.35rem] font-black tracking-tight text-white">
                            DSA Question Submission
                        </h1>
                        <p className="max-w-2xl text-[15px] font-semibold leading-7 text-slate-300">
                            Build production-ready coding questions with validated examples, hidden tests,
                            starter code, wrappers, and solution checks.
                        </p>
                    </div>
                    {previewData && (
                        <button
                            onClick={() => setShowPreview(!showPreview)}
                            className="rounded-full bg-[linear-gradient(135deg,#22d3ee,#8b5cf6)] px-6 py-3 text-sm font-black text-white shadow-[0_18px_46px_rgba(34,211,238,0.18)] transition hover:-translate-y-0.5"
                        >
                            {showPreview ? "Edit Form" : "Preview Question"}
                        </button>
                    )}
                </div>

                <div className={showPreview && previewData ? "hidden" : "block"}>
                    <DSAQuestionForm
                        initialData={previewData || undefined}
                        onPreview={(data) => {
                            setPreviewData(data);
                            setShowPreview(true);
                        }}
                    />
                </div>

                {showPreview && previewData && (
                    <DSAQuestionPreview data={previewData} onBack={() => setShowPreview(false)} />
                )}
            </div>
        </div>
    );
}
