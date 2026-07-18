import { DSAQuestionData } from "./DSAQuestionForm";
import { RichQuestionContent } from "@/components/question-content/rich-question-content";

interface Props {
    data: DSAQuestionData;
    onBack: () => void;
}

export function DSAQuestionPreview({ data, onBack }: Props) {
    const getDifficultyColor = (difficulty: string) => {
        switch (difficulty) {
            case "Easy": return "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200";
            case "Medium": return "bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-200";
            case "Hard": return "bg-red-50 text-red-700 dark:bg-red-400/10 dark:text-red-200";
            default: return "bg-slate-100 text-slate-600 dark:bg-lc-elevated dark:text-slate-300";
        }
    };

    return (
        <div className="space-y-6">
            <button
                type="button"
                onClick={onBack}
                className="inline-flex items-center gap-2 text-sm font-bold text-slate-500 transition hover:text-primary dark:text-slate-400"
            >
                <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                Back to form
            </button>

            <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-lc-surface dark:ring-lc-border">
                <div className="border-b border-slate-200 px-6 py-6 dark:border-lc-border sm:px-8">
                    <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-primary">Question preview</p>
                    <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                            <h1 className="font-nunito text-3xl font-extrabold tracking-tight text-slate-950 dark:text-white">
                                {data.title || "Untitled Problem"}
                            </h1>
                            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                                <span className={`rounded-full px-3 py-1 font-extrabold ${getDifficultyColor(data.difficulty)}`}>
                                    {data.difficulty}
                                </span>
                                <span className="font-semibold text-slate-500 dark:text-slate-400">Problem #{data.problemId || "draft"}</span>
                                <span className="font-semibold text-slate-500 dark:text-slate-400">Frontend #{data.frontendId || "draft"}</span>
                                <span className="font-semibold text-slate-500 dark:text-slate-400">CPU {Math.round(data.timeLimit * 1000)} ms</span>
                                <span className="font-semibold text-slate-500 dark:text-slate-400">Memory {data.memoryLimit} MB</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="space-y-8 p-6 sm:p-8">
                    <div className="flex flex-wrap gap-4">
                        <div>
                            <h3 className="mb-2 text-xs font-extrabold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">Topics</h3>
                            <div className="flex flex-wrap gap-2">
                                {data.topics.map((topic, index) => (
                                    <span key={`${topic}-${index}`} className="rounded-full bg-primary/10 px-3 py-1 text-sm font-extrabold text-primary">
                                        {topic}
                                    </span>
                                ))}
                            </div>
                        </div>
                        {data.companyTags.length > 0 && (
                            <div>
                                <h3 className="mb-2 text-xs font-extrabold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">Companies</h3>
                                <div className="flex flex-wrap gap-2">
                                    {data.companyTags.map((company, index) => (
                                        <span key={`${company}-${index}`} className="rounded-full bg-slate-100 px-3 py-1 text-sm font-extrabold text-slate-700 dark:bg-lc-elevated dark:text-slate-200">
                                            {company}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    <section>
                        <h2 className="mb-4 font-nunito text-xl font-extrabold text-slate-950 dark:text-white">Problem Description</h2>
                        <RichQuestionContent content={data.description} />
                    </section>

                    {data.examples.length > 0 && data.examples[0].example_text && (
                        <section>
                            <h2 className="mb-4 font-nunito text-xl font-extrabold text-slate-950 dark:text-white">Examples</h2>
                            <div className="space-y-4">
                                {data.examples.map((example, index) => (
                                    <div key={index} className="rounded-lg bg-slate-50 p-4 ring-1 ring-slate-200 dark:bg-lc-elevated dark:ring-lc-border">
                                        <RichQuestionContent content={example.example_text} compact />
                                    </div>
                                ))}
                            </div>
                        </section>
                    )}

                    {data.constraints.filter((constraint) => constraint.trim()).length > 0 && (
                        <section>
                            <h2 className="mb-4 font-nunito text-xl font-extrabold text-slate-950 dark:text-white">Constraints</h2>
                            <div className="space-y-2 text-slate-700 dark:text-slate-300">
                                {data.constraints.filter((constraint) => constraint.trim()).map((constraint, index) => (
                                    <div key={index} className="rounded-lg bg-slate-50 p-3 text-sm ring-1 ring-slate-200 dark:bg-lc-elevated dark:ring-lc-border">
                                        <RichQuestionContent content={constraint} compact />
                                    </div>
                                ))}
                            </div>
                        </section>
                    )}

                    {data.hints.filter((hint) => hint.trim()).length > 0 && (
                        <section>
                            <h2 className="mb-4 font-nunito text-xl font-extrabold text-slate-950 dark:text-white">Hints</h2>
                            <div className="space-y-2">
                                {data.hints.filter((hint) => hint.trim()).map((hint, index) => (
                                    <div key={index} className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-400/20 dark:bg-amber-400/10">
                                        <span className="material-symbols-outlined text-[18px] text-amber-600 dark:text-amber-200">lightbulb</span>
                                        <div className="min-w-0 flex-1">
                                            <RichQuestionContent content={hint} compact />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </section>
                    )}

                    {data.followUp.filter((question) => question.trim()).length > 0 && (
                        <section>
                            <h2 className="mb-4 font-nunito text-xl font-extrabold text-slate-950 dark:text-white">Follow-up Questions</h2>
                            <div className="space-y-2">
                                {data.followUp.filter((question) => question.trim()).map((question, index) => (
                                    <div key={index} className="rounded-lg border border-primary/20 bg-primary/5 p-3 dark:bg-primary/10">
                                        <RichQuestionContent content={question} compact />
                                    </div>
                                ))}
                            </div>
                        </section>
                    )}

                    <div className="grid gap-6 md:grid-cols-2">
                        <div>
                            <h3 className="mb-3 font-nunito text-lg font-extrabold text-slate-950 dark:text-white">Sample Test Cases</h3>
                            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-400/20 dark:bg-emerald-400/10">
                                <p className="text-sm font-extrabold text-emerald-700 dark:text-emerald-200">
                                    {data.sampleTestCases.length} visible test case(s)
                                </p>
                            </div>
                        </div>
                        <div>
                            <h3 className="mb-3 font-nunito text-lg font-extrabold text-slate-950 dark:text-white">Hidden Test Cases</h3>
                            <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 dark:bg-primary/10">
                                <p className="text-sm font-extrabold text-primary">
                                    {data.hiddenTestCases.length} hidden test case(s)
                                </p>
                            </div>
                        </div>
                    </div>

                    <section>
                        <h2 className="mb-4 font-nunito text-xl font-extrabold text-slate-950 dark:text-white">Starter Code Available</h2>
                        <div className="flex flex-wrap gap-3">
                            {Object.entries(data.codeSnippets).map(([lang, snippet]) => (
                                snippet.starter_code && (
                                    <span key={lang} className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-extrabold text-slate-700 dark:bg-lc-elevated dark:text-slate-200">
                                        {lang === "python3" ? "Python 3" : lang === "cpp" ? "C++" : lang === "javascript" ? "JavaScript" : "Java"}
                                    </span>
                                )
                            ))}
                        </div>
                    </section>

                    {(data.solution?.bruteForce?.explanation || data.solution?.optimized?.explanation) && (
                        <section>
                            <h2 className="mb-4 font-nunito text-xl font-extrabold text-slate-950 dark:text-white">Solutions Available</h2>
                            <div className="flex flex-wrap gap-3">
                                {data.solution?.optimized?.explanation && (
                                    <span className="rounded-lg bg-emerald-50 px-4 py-2 text-sm font-extrabold text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200">
                                        Optimized
                                    </span>
                                )}
                                {data.solution?.bruteForce?.explanation && (
                                    <span className="rounded-lg bg-amber-50 px-4 py-2 text-sm font-extrabold text-amber-700 dark:bg-amber-400/10 dark:text-amber-200">
                                        Brute Force
                                    </span>
                                )}
                            </div>
                        </section>
                    )}
                </div>
            </div>
        </div>
    );
}
