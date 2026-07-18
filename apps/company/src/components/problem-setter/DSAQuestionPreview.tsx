import { DSAQuestionData } from "./DSAQuestionForm";

interface Props {
    data: DSAQuestionData;
    onBack: () => void;
}

const difficultyClass: Record<DSAQuestionData["difficulty"], string> = {
    Easy: "bg-emerald-50 text-emerald-700",
    Medium: "bg-amber-50 text-amber-700",
    Hard: "bg-red-50 text-red-700",
};

export function DSAQuestionPreview({ data, onBack }: Props) {
    const languages = Object.entries(data.codeSnippets)
        .filter(([, snippet]) => snippet.starter_code.trim())
        .map(([language]) => language);

    return (
        <div className="space-y-6">
            <button
                type="button"
                onClick={onBack}
                className="inline-flex items-center gap-2 text-sm font-extrabold text-slate-500 transition hover:text-primary"
            >
                <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                Back to form
            </button>

            <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
                <div className="bg-primary px-8 py-6 text-white">
                    <h1 className="font-nunito text-3xl font-extrabold tracking-tight">
                        {data.title || "Untitled Problem"}
                    </h1>
                    <div className="mt-4 flex flex-wrap gap-3">
                        <span className={`rounded-full px-3 py-1 text-sm font-extrabold ${difficultyClass[data.difficulty]}`}>
                            {data.difficulty}
                        </span>
                    </div>
                </div>

                <div className="space-y-8 p-8">
                    <section>
                        <h2 className="font-nunito text-xl font-extrabold text-slate-950">Topics</h2>
                        <div className="mt-3 flex flex-wrap gap-2">
                            {(data.topics.length ? data.topics : ["No topics added"]).map((topic) => (
                                <span key={topic} className="rounded-full bg-primary/10 px-3 py-1 text-sm font-extrabold text-primary">
                                    {topic}
                                </span>
                            ))}
                        </div>
                    </section>

                    <section>
                        <h2 className="font-nunito text-xl font-extrabold text-slate-950">Problem Description</h2>
                        <p className="mt-4 whitespace-pre-wrap text-sm font-medium leading-7 text-slate-600">
                            {data.description || "No description added yet."}
                        </p>
                    </section>

                    {data.examples.some((example) => example.example_text.trim()) && (
                        <section>
                            <h2 className="font-nunito text-xl font-extrabold text-slate-950">Examples</h2>
                            <div className="mt-4 space-y-4">
                                {data.examples.filter((example) => example.example_text.trim()).map((example, index) => (
                                    <pre key={index} className="overflow-x-auto rounded-lg bg-slate-50 p-4 text-sm font-semibold leading-6 text-slate-700">
                                        {example.example_text}
                                    </pre>
                                ))}
                            </div>
                        </section>
                    )}

                    {data.constraints.some((constraint) => constraint.trim()) && (
                        <section>
                            <h2 className="font-nunito text-xl font-extrabold text-slate-950">Constraints</h2>
                            <ul className="mt-4 list-disc space-y-2 pl-5 text-sm font-medium leading-6 text-slate-600">
                                {data.constraints.filter((constraint) => constraint.trim()).map((constraint, index) => (
                                    <li key={index} className="font-mono">{constraint}</li>
                                ))}
                            </ul>
                        </section>
                    )}

                    {!!data.hints.length && (
                        <section>
                            <h2 className="font-nunito text-xl font-extrabold text-slate-950">Hints</h2>
                            <div className="mt-4 space-y-2">
                                {data.hints.map((hint, index) => (
                                    <p key={index} className="rounded-lg bg-amber-50 p-3 text-sm font-medium text-slate-700 ring-1 ring-amber-100">
                                        {hint}
                                    </p>
                                ))}
                            </div>
                        </section>
                    )}

                    <section className="grid gap-4 sm:grid-cols-3">
                        <div className="rounded-lg bg-slate-50 p-4">
                            <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-slate-400">Visible Tests</p>
                            <p className="mt-2 text-2xl font-extrabold text-slate-950">{data.sampleTestCases.length}</p>
                        </div>
                        <div className="rounded-lg bg-slate-50 p-4">
                            <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-slate-400">Hidden Tests</p>
                            <p className="mt-2 text-2xl font-extrabold text-slate-950">{data.hiddenTestCases.length}</p>
                        </div>
                        <div className="rounded-lg bg-slate-50 p-4">
                            <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-slate-400">Languages</p>
                            <p className="mt-2 text-2xl font-extrabold text-slate-950">{languages.length}</p>
                        </div>
                    </section>

                    <section>
                        <h2 className="font-nunito text-xl font-extrabold text-slate-950">Starter Code Available</h2>
                        <div className="mt-4 flex flex-wrap gap-3">
                            {(languages.length ? languages : ["No starter code"]).map((language) => (
                                <span key={language} className="rounded-lg bg-primary/10 px-4 py-2 text-sm font-extrabold text-primary">
                                    {language === "python3" ? "Python 3" : language === "cpp" ? "C++" : language === "javascript" ? "JavaScript" : language}
                                </span>
                            ))}
                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
}
