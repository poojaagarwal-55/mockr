import { useState } from "react";
import { DSAQuestionData, TestResultsState } from "../DSAQuestionForm";

interface Props {
    formData: DSAQuestionData;
    setFormData: (data: DSAQuestionData) => void;
    testStatus?: TestResultsState;
    setTestStatus?: React.Dispatch<React.SetStateAction<TestResultsState>>;
}

type SolutionApproach = NonNullable<NonNullable<DSAQuestionData["solution"]>["approaches"]>[number];
type LanguageId = "python3" | "cpp" | "java" | "javascript";

const languages: Array<{ id: LanguageId; name: string }> = [
    { id: "python3", name: "Python 3" },
    { id: "cpp", name: "C++" },
    { id: "java", name: "Java" },
    { id: "javascript", name: "JavaScript" },
];

function emptyApproach(index: number): SolutionApproach {
    return {
        title: index === 0 ? "Recommended Solution" : `Alternative Solution ${index + 1}`,
        explanation: "",
        timeComplexity: "",
        spaceComplexity: "",
        code: {},
    };
}

function normalizeApproaches(formData: DSAQuestionData): SolutionApproach[] {
    if (formData.solution?.approaches?.length) return formData.solution.approaches;
    return [emptyApproach(0)];
}

export function SolutionSection({ formData, setFormData }: Props) {
    const approaches = normalizeApproaches(formData);
    const [activeIndex, setActiveIndex] = useState(0);
    const [activeLanguage, setActiveLanguage] = useState<LanguageId>("python3");
    const activeApproach = approaches[Math.min(activeIndex, approaches.length - 1)] || emptyApproach(0);

    const setApproaches = (nextApproaches: SolutionApproach[]) => {
        setFormData({
            ...formData,
            solution: {
                ...formData.solution,
                approaches: nextApproaches,
            },
        });
    };

    const updateApproach = (index: number, patch: Partial<SolutionApproach>) => {
        const next = approaches.map((approach, itemIndex) => (
            itemIndex === index ? { ...approach, ...patch } : approach
        ));
        setApproaches(next);
    };

    const updateCode = (index: number, language: LanguageId, value: string) => {
        const approach = approaches[index];
        updateApproach(index, {
            code: {
                ...approach.code,
                [language]: value,
            },
        });
    };

    const addApproach = () => {
        const next = [...approaches, emptyApproach(approaches.length)];
        setApproaches(next);
        setActiveIndex(next.length - 1);
    };

    const removeApproach = (index: number) => {
        if (approaches.length <= 1) {
            setApproaches([emptyApproach(0)]);
            setActiveIndex(0);
            return;
        }

        const next = approaches.filter((_, itemIndex) => itemIndex !== index);
        setApproaches(next);
        setActiveIndex(Math.max(0, Math.min(index - 1, next.length - 1)));
    };

    return (
        <div className="space-y-6">
            <div className="rounded-xl bg-amber-50 p-5 ring-1 ring-amber-100 dark:bg-amber-500/10 dark:ring-amber-400/20">
                <h2 className="font-nunito text-xl font-extrabold text-slate-950 dark:text-white">Solution Guidance</h2>
                <p className="mt-2 text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">
                    Add named solutions to make review and internal calibration easier. Start with one clear approach and add more only when there are meaningfully different methods.
                </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap gap-2">
                    {approaches.map((approach, index) => {
                        const active = activeIndex === index;
                        return (
                            <button
                                key={index}
                                type="button"
                                onClick={() => setActiveIndex(index)}
                                className={`h-11 rounded-full px-4 text-sm font-extrabold transition ${
                                    active
                                        ? "bg-primary text-white shadow-sm"
                                        : "bg-white text-slate-600 ring-1 ring-slate-200 hover:text-primary dark:bg-lc-surface dark:text-slate-200 dark:ring-lc-border dark:hover:bg-lc-hover dark:hover:text-white"
                                }`}
                            >
                                {approach.title.trim() || `Solution ${index + 1}`}
                            </button>
                        );
                    })}
                </div>
                <button
                    type="button"
                    onClick={addApproach}
                    className="inline-flex h-11 items-center gap-2 rounded-full bg-slate-950 px-4 text-sm font-extrabold text-white transition hover:bg-slate-800 dark:bg-primary dark:hover:bg-primary/90"
                >
                    <span className="material-symbols-outlined text-[18px]">add</span>
                    Add solution
                </button>
            </div>

            <section className="rounded-xl bg-slate-50 p-6 ring-1 ring-slate-200 dark:bg-lc-elevated dark:ring-lc-border">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <label className="mb-2 block text-sm font-extrabold text-slate-700 dark:text-slate-200">
                            Solution name
                        </label>
                        <input
                            value={activeApproach.title}
                            onChange={(event) => updateApproach(activeIndex, { title: event.target.value })}
                            className="h-11 w-full min-w-[280px] rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-input dark:text-white dark:placeholder:text-slate-500"
                            placeholder="e.g., Sliding Window"
                        />
                    </div>
                    {approaches.length > 1 && (
                        <button
                            type="button"
                            onClick={() => removeApproach(activeIndex)}
                            className="inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-extrabold text-slate-500 transition hover:bg-red-50 hover:text-red-600 dark:text-slate-400 dark:hover:bg-red-500/10 dark:hover:text-red-300"
                        >
                            <span className="material-symbols-outlined text-[18px]">remove</span>
                            Remove
                        </button>
                    )}
                </div>

                <label className="mt-5 block">
                    <span className="mb-2 block text-sm font-extrabold text-slate-700 dark:text-slate-200">Explanation</span>
                    <textarea
                        value={activeApproach.explanation}
                        onChange={(event) => updateApproach(activeIndex, { explanation: event.target.value })}
                        rows={6}
                        className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-input dark:text-white dark:placeholder:text-slate-500"
                        placeholder="Explain the idea behind this solution."
                    />
                </label>

                <div className="mt-5 grid gap-4 md:grid-cols-2">
                    <label>
                        <span className="mb-2 block text-sm font-extrabold text-slate-700 dark:text-slate-200">Time Complexity</span>
                        <input
                            value={activeApproach.timeComplexity}
                            onChange={(event) => updateApproach(activeIndex, { timeComplexity: event.target.value })}
                            className="h-11 w-full rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-input dark:text-white dark:placeholder:text-slate-500"
                            placeholder="e.g., O(n)"
                        />
                    </label>
                    <label>
                        <span className="mb-2 block text-sm font-extrabold text-slate-700 dark:text-slate-200">Space Complexity</span>
                        <input
                            value={activeApproach.spaceComplexity}
                            onChange={(event) => updateApproach(activeIndex, { spaceComplexity: event.target.value })}
                            className="h-11 w-full rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-input dark:text-white dark:placeholder:text-slate-500"
                            placeholder="e.g., O(1)"
                        />
                    </label>
                </div>

                <div className="mt-6">
                    <div className="mb-3 flex flex-wrap gap-2">
                        {languages.map((language) => {
                            const active = activeLanguage === language.id;
                            const hasCode = Boolean(activeApproach.code?.[language.id]?.trim());
                            return (
                                <button
                                    key={language.id}
                                    type="button"
                                    onClick={() => setActiveLanguage(language.id)}
                                    className={`inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-extrabold transition ${
                                        active
                                            ? "bg-primary text-white"
                                            : "bg-white text-slate-600 ring-1 ring-slate-200 hover:text-primary dark:bg-lc-surface dark:text-slate-200 dark:ring-lc-border dark:hover:bg-lc-hover dark:hover:text-white"
                                    }`}
                                >
                                    {language.name}
                                    <span className={`size-2 rounded-full ${hasCode ? "bg-emerald-400" : active ? "bg-white/40" : "bg-slate-300"}`} />
                                </button>
                            );
                        })}
                    </div>

                    <textarea
                        value={activeApproach.code?.[activeLanguage] || ""}
                        onChange={(event) => updateCode(activeIndex, activeLanguage, event.target.value)}
                        rows={12}
                        className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 font-mono text-sm text-slate-900 outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-input dark:text-white dark:placeholder:text-slate-500"
                        placeholder={`${languages.find((language) => language.id === activeLanguage)?.name} solution code`}
                    />
                </div>
            </section>
        </div>
    );
}
