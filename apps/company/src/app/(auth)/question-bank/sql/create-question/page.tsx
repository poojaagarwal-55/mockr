"use client";

import type React from "react";
import Link from "next/link";
import { useState } from "react";
import { SQLQuestionForm, type SQLQuestionData } from "@/components/sql-question-setter/SQLQuestionForm";
import { normalizePreviewText, SQLExamplesPreview, SQLSchemaPreview, SQLSolutionPreview } from "@/components/sql-question-setter/SQLPreviewBlocks";

export default function CreateCompanySQLQuestionPage() {
    const [showPreview, setShowPreview] = useState(false);
    const [previewData, setPreviewData] = useState<SQLQuestionData | null>(null);

    return (
        <main className="min-h-full bg-[#FAFBFC] px-4 py-8 dark:bg-lc-bg sm:px-6 lg:px-10">
            <div className="mx-auto max-w-7xl">
                <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                        <Link href="/question-bank/sql" className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-slate-500 transition hover:text-primary dark:text-slate-400">
                            <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                            Back to SQL questions
                        </Link>
                        <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Company Question Bank</p>
                        <h1 className="mt-2 font-nunito text-3xl font-extrabold tracking-tight text-slate-950 dark:text-white sm:text-4xl">
                            Create SQL Question
                        </h1>
                        <p className="mt-2 text-sm font-semibold text-slate-500 dark:text-slate-400">
                            Add a custom company-owned database query question.
                        </p>
                    </div>

                    {previewData && (
                        <button type="button" onClick={() => setShowPreview((value) => !value)} className="inline-flex h-12 items-center justify-center rounded-full bg-primary px-5 text-sm font-extrabold text-white shadow-lg shadow-primary/20 transition hover:bg-primary/90">
                            {showPreview ? "Edit form" : "Preview question"}
                        </button>
                    )}
                </div>

                <div className={showPreview && previewData ? "hidden" : "block"}>
                    <SQLQuestionForm
                        initialData={previewData || undefined}
                        onPreview={(data) => {
                            setPreviewData(data);
                            setShowPreview(true);
                        }}
                    />
                </div>

                {showPreview && previewData && <SQLQuestionPreview data={previewData} onBack={() => setShowPreview(false)} />}
            </div>
        </main>
    );
}

function SQLQuestionPreview({ data, onBack }: { data: SQLQuestionData; onBack: () => void }) {
    const sampleCount = data.testCases.filter((testCase) => testCase.expected_output.trim()).length;
    const hiddenCount = data.hiddenTestCases.filter((testCase) => testCase.expected_output.trim() && testCase.wrapper_code.trim()).length;

    return (
        <section className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
            <div className="bg-primary px-6 py-6 text-white sm:px-8">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                        <h2 className="font-nunito text-3xl font-extrabold tracking-tight sm:text-4xl">{normalizePreviewText(data.title) || "Untitled SQL Problem"}</h2>
                        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm font-bold">
                            <span className="rounded-full bg-white/15 px-3 py-1 text-white">{data.difficulty}</span>
                        </div>
                    </div>
                    <button type="button" onClick={onBack} className="inline-flex h-11 items-center justify-center rounded-full bg-white px-5 text-sm font-extrabold text-primary transition hover:bg-white/90">Edit form</button>
                </div>
            </div>

            <div className="space-y-8 p-6 sm:p-8">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <Metric label="Average Time" value="35 mins" />
                    <Metric label="Test Cases" value={sampleCount + hiddenCount} />
                    <Metric label="Sample" value={sampleCount} />
                    <Metric label="Hidden" value={hiddenCount} />
                </div>

                <PreviewSection title="Tags">
                    <div className="flex flex-wrap gap-2">
                        {(data.tags.length ? data.tags : ["SQL"]).map((tag) => (
                            <span key={tag} className="rounded-full bg-primary/10 px-3 py-1 text-sm font-extrabold text-primary">{tag}</span>
                        ))}
                    </div>
                </PreviewSection>

                <PreviewSection title="Question Description">
                    <p className="whitespace-pre-wrap text-sm font-medium leading-7 text-slate-600">{normalizePreviewText(data.description)}</p>
                </PreviewSection>

                <PreviewSection title="Database Schema">
                    <SQLSchemaPreview schema={data.schema} />
                </PreviewSection>

                <SQLExamplesPreview testCases={data.testCases} setupCode={data.wrapperCode} />

                <PreviewSection title="Solution Query">
                    <SQLSolutionPreview solution={data.solution} />
                </PreviewSection>
            </div>
        </section>
    );
}

function Metric({ label, value }: { label: string; value: string | number }) {
    return (
        <div className="rounded-lg bg-slate-50 p-4">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">{label}</p>
            <p className="mt-2 text-2xl font-extrabold text-slate-950">{value}</p>
        </div>
    );
}

function PreviewSection({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section>
            <h3 className="mb-6 border-b border-slate-200 pb-4 font-nunito text-2xl font-extrabold text-slate-950">{title}</h3>
            {children}
        </section>
    );
}
