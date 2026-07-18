"use client";

import { useMemo, useState } from "react";
import { RichQuestionContent } from "./rich-question-content";

type HelpTopic = "description" | "examples";

type HelpStep = {
    eyebrow: string;
    title: string;
    body: string;
    write: string;
    preview?: string;
    visual?: "gallery";
};

const sharedSteps: HelpStep[] = [
    {
        eyebrow: "Line breaks",
        title: "Use Enter for real lines",
        body: "Press Enter when you want a new line. Pasted JSON-style newline markers are also converted in preview.",
        write: "First line\nSecond line\n\nThird paragraph",
        preview: "First line\nSecond line\n\nThird paragraph",
    },
    {
        eyebrow: "Math",
        title: "Use simple LaTeX delimiters",
        body: "Inline math goes inside single dollar signs. Larger formulas go inside double dollar signs.",
        write: "Capacity must satisfy $C >= max(weights)$.\n\n$$\nanswer = min(C)\n$$",
        preview: "Capacity must satisfy $C >= max(weights)$.\n\n$$\nanswer = min(C)\n$$",
    },
    {
        eyebrow: "Callouts",
        title: "Add notes and edge cases",
        body: "Use structured blocks for important observations. These render as clean highlighted sections in the problem page.",
        write: ":::note Key observation\nBinary search works because feasibility is monotonic.\n:::\n\n:::warning Edge case\nThe answer can never be less than the maximum package weight.\n:::",
        preview: ":::note Key observation\nBinary search works because feasibility is monotonic.\n:::\n\n:::warning Edge case\nThe answer can never be less than the maximum package weight.\n:::",
    },
    {
        eyebrow: "Images",
        title: "Arrange images before inserting",
        body: "Use Insert image for a single image. Use Image layout when you want rows and columns; drag images between rows before inserting.",
        write: ":::gallery\n![Image one](uploaded-image-url)\n![Image two](uploaded-image-url)\n---\n![Wide diagram](uploaded-image-url)\n:::",
        visual: "gallery",
    },
];

const descriptionSteps: HelpStep[] = [
    {
        eyebrow: "Problem statement",
        title: "Write the story first",
        body: "Keep the statement readable: introduce the task, define variables, then explain the required output.",
        write: "A delivery team has to ship $n$ packages in order.\n\nEach package has weight `weights[i]`.\n\nReturn the minimum ship capacity needed to finish within `days` days.",
        preview: "A delivery team has to ship $n$ packages in order.\n\nEach package has weight `weights[i]`.\n\nReturn the minimum ship capacity needed to finish within `days` days.",
    },
    ...sharedSteps,
];

const exampleSteps: HelpStep[] = [
    {
        eyebrow: "Example format",
        title: "Keep Input, Output, Explanation labels",
        body: "The contest UI understands these labels and displays the example in a clean card.",
        write: "Input: weights = [1, 2, 3, 4], days = 2\n\nOutput: 6\n\nExplanation:\nShip `[1,2,3]` on day 1 and `[4]` on day 2.",
        preview: "Input: weights = [1, 2, 3, 4], days = 2\n\nOutput: 6\n\nExplanation:\nShip `[1,2,3]` on day 1 and `[4]` on day 2.",
    },
    {
        eyebrow: "Math in examples",
        title: "Examples can include equations",
        body: "Use the same math syntax inside examples. This is useful for explanations and proofs.",
        write: "Input: Solve $x^2 - 5x + 6 = 0$.\n\nOutput: $x = 2$ or $x = 3$.\n\nExplanation:\n$$\nx^2 - 5x + 6 = (x-2)(x-3)\n$$",
        preview: "Input: Solve $x^2 - 5x + 6 = 0$.\n\nOutput: $x = 2$ or $x = 3$.\n\nExplanation:\n$$\nx^2 - 5x + 6 = (x-2)(x-3)\n$$",
    },
    ...sharedSteps,
];

function GalleryPreview() {
    return (
        <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
                <div className="flex h-28 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-sm font-extrabold text-slate-500 dark:border-lc-border dark:bg-[#2a2a2a] dark:text-slate-300">
                    Image one
                </div>
                <div className="flex h-28 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-sm font-extrabold text-slate-500 dark:border-lc-border dark:bg-[#2a2a2a] dark:text-slate-300">
                    Image two
                </div>
            </div>
            <div className="flex h-24 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-sm font-extrabold text-slate-500 dark:border-lc-border dark:bg-[#2a2a2a] dark:text-slate-300">
                Wide diagram
            </div>
        </div>
    );
}

export function QuestionAuthoringHelpButton({ topic }: { topic: HelpTopic }) {
    const [isOpen, setIsOpen] = useState(false);
    const [stepIndex, setStepIndex] = useState(0);
    const steps = useMemo(() => (topic === "examples" ? exampleSteps : descriptionSteps), [topic]);
    const step = steps[stepIndex];
    const isFirst = stepIndex === 0;
    const isLast = stepIndex === steps.length - 1;

    const close = () => {
        setIsOpen(false);
        setStepIndex(0);
    };

    return (
        <>
            <button
                type="button"
                onClick={() => setIsOpen(true)}
                className="inline-flex size-7 items-center justify-center rounded-full border border-slate-300 text-slate-500 transition hover:border-primary hover:text-primary dark:border-lc-border dark:text-slate-400 dark:hover:text-blue-300"
                aria-label={`Open ${topic} writing guide`}
            >
                <span className="material-symbols-outlined block text-[18px] leading-none" aria-hidden="true">
                    info
                </span>
            </button>

            {isOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
                    <div className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-lc-border dark:bg-[#202020]">
                        <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5 dark:border-lc-border">
                            <div className="flex gap-4">
                                <div className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary dark:bg-primary/15 dark:text-blue-200">
                                    <span className="material-symbols-outlined block text-[22px] leading-none" aria-hidden="true">
                                        school
                                    </span>
                                </div>
                                <div>
                                    <div className="text-xs font-extrabold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                                        Writing guide
                                    </div>
                                    <h2 className="font-nunito text-2xl font-extrabold text-slate-950 dark:text-white">
                                        {topic === "examples" ? "How to write examples" : "How to write a problem description"}
                                    </h2>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={close}
                                className="inline-flex size-9 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-[#2b2b2b] dark:hover:text-white"
                                aria-label="Close writing guide"
                            >
                                <span className="material-symbols-outlined block text-[20px] leading-none">close</span>
                            </button>
                        </div>

                        <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[0.9fr_1.1fr]">
                            <aside className="border-b border-slate-200 p-5 dark:border-lc-border lg:border-b-0 lg:border-r">
                                <div className="space-y-2">
                                    {steps.map((item, index) => (
                                        <button
                                            type="button"
                                            key={`${item.eyebrow}-${index}`}
                                            onClick={() => setStepIndex(index)}
                                            className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition ${
                                                index === stepIndex
                                                    ? "bg-primary text-white"
                                                    : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-[#2b2b2b]"
                                            }`}
                                        >
                                            <span className={`inline-flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-extrabold ${
                                                index === stepIndex ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500 dark:bg-[#303030] dark:text-slate-300"
                                            }`}>
                                                {index + 1}
                                            </span>
                                            <span>
                                                <span className="block text-[11px] font-extrabold uppercase tracking-[0.14em] opacity-70">
                                                    {item.eyebrow}
                                                </span>
                                                <span className="block text-sm font-extrabold">
                                                    {item.title}
                                                </span>
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            </aside>

                            <main className="min-w-0 p-5">
                                <div className="mb-4">
                                    <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-primary">
                                        {step.eyebrow}
                                    </div>
                                    <h3 className="font-nunito text-2xl font-extrabold text-slate-950 dark:text-white">
                                        {step.title}
                                    </h3>
                                    <p className="mt-2 text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">
                                        {step.body}
                                    </p>
                                </div>

                                <div className="grid gap-4 xl:grid-cols-2">
                                    <div className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-lc-border dark:bg-[#181818]">
                                        <div className="mb-3 flex items-center gap-2 text-xs font-extrabold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
                                            <span className="material-symbols-outlined block text-[18px] leading-none">edit_note</span>
                                            Write this
                                        </div>
                                        <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-white p-3 font-mono text-[13px] leading-6 text-slate-800 dark:bg-[#242424] dark:text-slate-100">
                                            {step.write}
                                        </pre>
                                    </div>

                                    <div className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-lc-border dark:bg-[#181818]">
                                        <div className="mb-3 flex items-center gap-2 text-xs font-extrabold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
                                            <span className="material-symbols-outlined block text-[18px] leading-none">visibility</span>
                                            It displays like this
                                        </div>
                                        <div className="rounded-lg bg-white p-3 dark:bg-[#242424]">
                                            {step.visual === "gallery" ? (
                                                <GalleryPreview />
                                            ) : (
                                                <RichQuestionContent content={step.preview || step.write} compact />
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </main>
                        </div>

                        <div className="flex items-center justify-between border-t border-slate-200 p-4 dark:border-lc-border">
                            <span className="text-sm font-extrabold text-slate-500 dark:text-slate-400">
                                {stepIndex + 1} of {steps.length}
                            </span>
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => setStepIndex((current) => Math.max(0, current - 1))}
                                    disabled={isFirst}
                                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-extrabold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-lc-border dark:text-slate-200 dark:hover:bg-[#2b2b2b]"
                                >
                                    Previous
                                </button>
                                <button
                                    type="button"
                                    onClick={() => (isLast ? close() : setStepIndex((current) => Math.min(steps.length - 1, current + 1)))}
                                    className="rounded-lg bg-primary px-5 py-2 text-sm font-extrabold text-white transition hover:bg-primary/90"
                                >
                                    {isLast ? "Done" : "Next"}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
