import { DSAQuestionData } from "../DSAQuestionForm";

interface Props {
    formData: DSAQuestionData;
    setFormData: (data: DSAQuestionData) => void;
}

const suggestedTopics = [
    "Array",
    "String",
    "Hash Table",
    "Dynamic Programming",
    "Two Pointers",
    "Graph",
    "Tree",
    "Math",
];

export function BasicInfoSection({ formData, setFormData }: Props) {
    const addTopic = (topic: string) => {
        const cleanTopic = topic.trim();
        if (cleanTopic && !formData.topics.includes(cleanTopic)) {
            setFormData({ ...formData, topics: [...formData.topics, cleanTopic] });
        }
    };

    const removeTopic = (index: number) => {
        setFormData({ ...formData, topics: formData.topics.filter((_, i) => i !== index) });
    };

    return (
        <div className="space-y-8">
            <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
                <div>
                    <label className="mb-2 block text-sm font-extrabold text-slate-800 dark:text-slate-100">
                        Question title <span className="text-red-500">*</span>
                    </label>
                    <input
                        type="text"
                        value={formData.title}
                        onChange={(event) => setFormData({ ...formData, title: event.target.value })}
                        required
                        className="h-12 w-full rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-input dark:text-white dark:placeholder:text-slate-500"
                        placeholder="e.g., Longest Substring Without Repeating Characters"
                    />
                    <p className="mt-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
                        Internal IDs are generated automatically and hidden from candidates.
                    </p>
                </div>

                <div>
                    <label className="mb-2 block text-sm font-extrabold text-slate-800 dark:text-slate-100">
                        Difficulty <span className="text-red-500">*</span>
                    </label>
                    <select
                        value={formData.difficulty}
                        onChange={(event) => setFormData({ ...formData, difficulty: event.target.value as DSAQuestionData["difficulty"] })}
                        required
                        className="h-12 w-full rounded-lg border border-slate-200 bg-white px-4 text-sm font-extrabold text-slate-900 outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-input dark:text-white"
                    >
                        <option value="Easy">Easy</option>
                        <option value="Medium">Medium</option>
                        <option value="Hard">Hard</option>
                    </select>
                </div>
            </section>

            <section>
                <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                    <div>
                        <label className="block text-sm font-extrabold text-slate-800 dark:text-slate-100">
                            Topics <span className="text-red-500">*</span>
                        </label>
                        <p className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
                            Add topics for filtering and contest analytics.
                        </p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-extrabold ${formData.topics.length >= 2 ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200" : "bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-200"}`}>
                        {formData.topics.length}/2 recommended
                    </span>
                </div>

                <input
                    type="text"
                    onKeyDown={(event) => {
                        if (event.key === "Enter") {
                            event.preventDefault();
                            addTopic(event.currentTarget.value);
                            event.currentTarget.value = "";
                        }
                    }}
                    className="h-12 w-full rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-input dark:text-white dark:placeholder:text-slate-500"
                    placeholder="Type a topic and press Enter"
                />

                <div className="mt-3 flex flex-wrap gap-2">
                    {suggestedTopics
                        .filter((topic) => !formData.topics.includes(topic))
                        .slice(0, 6)
                        .map((topic) => (
                            <button
                                key={topic}
                                type="button"
                                onClick={() => addTopic(topic)}
                                className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-extrabold text-slate-600 transition hover:bg-primary/10 hover:text-primary dark:bg-lc-elevated dark:text-slate-300 dark:hover:bg-primary/15 dark:hover:text-primary"
                            >
                                + {topic}
                            </button>
                        ))}
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                    {formData.topics.map((topic, index) => (
                        <span
                            key={`${topic}-${index}`}
                            className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1.5 text-sm font-extrabold text-primary"
                        >
                            {topic}
                            <button
                                type="button"
                                onClick={() => removeTopic(index)}
                                className="text-primary/70 transition hover:text-red-600"
                                aria-label={`Remove ${topic}`}
                            >
                                <span className="material-symbols-outlined text-[16px]">close</span>
                            </button>
                        </span>
                    ))}
                </div>
            </section>
        </div>
    );
}
