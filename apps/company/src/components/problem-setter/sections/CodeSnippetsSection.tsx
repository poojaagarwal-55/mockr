import { useState } from "react";
import { DSAQuestionData, TestResultsState } from "../DSAQuestionForm";

interface Props {
    formData: DSAQuestionData;
    setFormData: (data: DSAQuestionData) => void;
    setTestStatus?: React.Dispatch<React.SetStateAction<TestResultsState>>;
}

const languages = [
    { id: "python3" as const, name: "Python 3" },
    { id: "cpp" as const, name: "C++" },
    { id: "java" as const, name: "Java" },
    { id: "javascript" as const, name: "JavaScript" },
];

export function CodeSnippetsSection({ formData, setFormData, setTestStatus }: Props) {
    const [guidelinesOpen, setGuidelinesOpen] = useState(false);
    const [activeLanguage, setActiveLanguage] = useState<(typeof languages)[number]["id"]>("python3");

    const updateCodeSnippet = (
        lang: "python3" | "cpp" | "java" | "javascript",
        field: "starter_code" | "wrapper_code",
        value: string
    ) => {
        setFormData({
            ...formData,
            codeSnippets: {
                ...formData.codeSnippets,
                [lang]: {
                    ...formData.codeSnippets[lang],
                    [field]: value,
                },
            },
        });

        setTestStatus?.((prev) => ({
            bruteForce: {
                ...prev.bruteForce,
                [lang]: "untested",
            },
            optimized: {
                ...prev.optimized,
                [lang]: "untested",
            },
        }));
    };

    return (
        <div className="space-y-8">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="font-nunito text-xl font-extrabold text-slate-950 dark:text-white">Code Snippets</h2>
                    <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">
                        Add starter and wrapper code for every supported language.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => setGuidelinesOpen(true)}
                    className="inline-flex h-10 items-center justify-center rounded-full border border-primary/30 px-4 text-sm font-extrabold text-primary transition hover:bg-primary/10 dark:border-primary/40 dark:text-primary-light dark:hover:bg-primary/15"
                >
                    Guidelines
                </button>
            </div>

            <div className="flex flex-wrap gap-2 rounded-xl bg-slate-50 p-2 ring-1 ring-slate-200 dark:bg-lc-elevated dark:ring-lc-border">
                {languages.map((lang) => {
                    const active = activeLanguage === lang.id;
                    const complete = Boolean(
                        formData.codeSnippets[lang.id].starter_code.trim() &&
                        formData.codeSnippets[lang.id].wrapper_code.trim()
                    );
                    return (
                        <button
                            key={lang.id}
                            type="button"
                            onClick={() => setActiveLanguage(lang.id)}
                            className={`inline-flex h-11 items-center gap-2 rounded-lg px-4 text-sm font-extrabold transition ${
                                active
                                    ? "bg-primary text-white shadow-sm"
                                    : "bg-white text-slate-600 ring-1 ring-slate-200 hover:text-primary dark:bg-lc-surface dark:text-slate-200 dark:ring-lc-border dark:hover:bg-lc-hover dark:hover:text-white"
                            }`}
                        >
                            {lang.name}
                            <span className={`size-2 rounded-full ${complete ? "bg-emerald-400" : active ? "bg-white/40" : "bg-slate-300"}`} />
                        </button>
                    );
                })}
            </div>

            {languages
                .filter((lang) => lang.id === activeLanguage)
                .map((lang) => (
                    <div key={lang.id} className="rounded-xl bg-slate-50 p-6 ring-1 ring-slate-200 dark:bg-lc-elevated dark:ring-lc-border">
                        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                            <h3 className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">
                                {lang.name}
                            </h3>
                            <span className="rounded-full bg-white px-3 py-1 text-xs font-extrabold text-slate-500 ring-1 ring-slate-200 dark:bg-lc-surface dark:text-slate-300 dark:ring-lc-border">
                                {activeLanguage.toUpperCase()}
                            </span>
                        </div>

                        <div className="space-y-4">
                            <label className="block">
                                <span className="mb-2 block text-sm font-extrabold text-slate-700 dark:text-slate-200">
                                    Starter Code <span className="text-red-500">*</span>
                                </span>
                                <textarea
                                    value={formData.codeSnippets[lang.id].starter_code}
                                    onChange={(event) => updateCodeSnippet(lang.id, "starter_code", event.target.value)}
                                    rows={10}
                                    required
                                    className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 font-mono text-sm text-slate-900 outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-input dark:text-white dark:placeholder:text-slate-500"
                                    placeholder={`Enter starter code for ${lang.name}`}
                                />
                            </label>

                            <label className="block">
                                <span className="mb-2 block text-sm font-extrabold text-slate-700 dark:text-slate-200">
                                    Wrapper Code <span className="text-red-500">*</span>
                                </span>
                                <textarea
                                    value={formData.codeSnippets[lang.id].wrapper_code}
                                    onChange={(event) => updateCodeSnippet(lang.id, "wrapper_code", event.target.value)}
                                    rows={10}
                                    required
                                    className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 font-mono text-sm text-slate-900 outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-input dark:text-white dark:placeholder:text-slate-500"
                                    placeholder={`Enter wrapper code for ${lang.name}`}
                                />
                            </label>
                        </div>
                    </div>
                ))}

            {guidelinesOpen && (
                <div className="fixed inset-0 z-[180] grid place-items-center bg-slate-950/60 px-4 backdrop-blur-sm">
                    <div className="w-full max-w-2xl rounded-xl bg-white p-6 shadow-2xl dark:bg-lc-surface dark:ring-1 dark:ring-lc-border">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <h3 className="font-nunito text-2xl font-extrabold text-slate-950 dark:text-white">Language Guidelines</h3>
                                <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">
                                    Use these rules so company questions run correctly in Judge0.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setGuidelinesOpen(false)}
                                className="grid size-9 place-items-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-lc-hover dark:hover:text-white"
                                aria-label="Close guidelines"
                            >
                                <span className="material-symbols-outlined text-[19px]">close</span>
                            </button>
                        </div>

                        <div className="mt-6 space-y-4 text-sm font-medium leading-6 text-slate-600 dark:text-slate-300">
                            <p><strong className="text-slate-950 dark:text-white">Starter Code:</strong> What the candidate sees and edits. Keep it to the function/class signature and starter body.</p>
                            <p><strong className="text-slate-950 dark:text-white">Wrapper Code:</strong> Hidden execution code that reads stdin, calls the candidate solution, and prints stdout.</p>
                            <p><strong className="text-slate-950 dark:text-white">Required tag:</strong> Wrapper code must include the exact literal string <code className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-lc-elevated dark:text-slate-100">&lt;USER_CODE&gt;</code>. The system replaces it with solution code during test runs.</p>
                            <p><strong className="text-slate-950 dark:text-white">Coverage:</strong> Fill both starter and wrapper code for Python 3, C++, Java, and JavaScript.</p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
