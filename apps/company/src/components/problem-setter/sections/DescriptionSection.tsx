import { DSAQuestionData } from "../DSAQuestionForm";

interface Props {
    formData: DSAQuestionData;
    setFormData: (data: DSAQuestionData) => void;
}

export function DescriptionSection({ formData, setFormData }: Props) {
    const addExample = () => {
        setFormData({
            ...formData,
            examples: [...formData.examples, { example_num: formData.examples.length + 1, example_text: "" }]
        });
    };

    const updateExample = (index: number, text: string) => {
        const updated = [...formData.examples];
        updated[index].example_text = text;
        setFormData({ ...formData, examples: updated });
    };

    const removeExample = (index: number) => {
        setFormData({ ...formData, examples: formData.examples.filter((_, i) => i !== index) });
    };

    const addConstraint = () => {
        setFormData({ ...formData, constraints: [...formData.constraints, ""] });
    };

    const updateConstraint = (index: number, value: string) => {
        const updated = [...formData.constraints];
        updated[index] = value;
        setFormData({ ...formData, constraints: updated });
    };

    const removeConstraint = (index: number) => {
        setFormData({ ...formData, constraints: formData.constraints.filter((_, i) => i !== index) });
    };

    const addHint = (hint: string) => {
        if (hint.trim()) {
            setFormData({ ...formData, hints: [...formData.hints, hint.trim()] });
        }
    };

    const removeHint = (index: number) => {
        setFormData({ ...formData, hints: formData.hints.filter((_, i) => i !== index) });
    };

    const addFollowUp = (followUp: string) => {
        if (followUp.trim()) {
            setFormData({ ...formData, followUp: [...formData.followUp, followUp.trim()] });
        }
    };

    const removeFollowUp = (index: number) => {
        setFormData({ ...formData, followUp: formData.followUp.filter((_, i) => i !== index) });
    };

    return (
        <div className="space-y-6">
            {/* Description */}
            <div>
                <label className="mb-2 block text-sm font-extrabold text-gray-700 dark:text-slate-100">
                    Problem Description <span className="text-red-500">*</span>
                </label>
                <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    required
                    rows={10}
                    className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 font-mono text-sm text-gray-900 outline-none focus:ring-2 focus:ring-blue-500 dark:border-lc-border dark:bg-lc-input dark:text-white dark:placeholder:text-slate-500"
                    placeholder="Enter the full problem description. Keep examples in the Examples section below."
                />
            </div>

            {/* Examples */}
            <div>
                <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-extrabold text-gray-700 dark:text-slate-100">
                        Examples <span className="text-red-500">*</span>
                    </label>
                    <button
                        type="button"
                        onClick={addExample}
                        className="rounded-lg bg-primary px-3 py-1 text-sm font-extrabold text-white transition-colors hover:bg-primary/90"
                    >
                        + Add Example
                    </button>
                </div>
                <div className="space-y-3">
                    {formData.examples.map((example, index) => (
                        <div key={index} className="rounded-lg border border-gray-300 p-4 dark:border-lc-border dark:bg-lc-elevated">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-sm font-extrabold text-gray-700 dark:text-slate-200">Example {example.example_num}</span>
                                {formData.examples.length > 1 && (
                                    <button
                                        type="button"
                                        onClick={() => removeExample(index)}
                                        className="text-sm font-bold text-red-600 hover:text-red-800 dark:text-red-300 dark:hover:text-red-200"
                                    >
                                        Remove
                                    </button>
                                )}
                            </div>
                            <textarea
                                value={example.example_text}
                                onChange={(e) => updateExample(index, e.target.value)}
                                rows={4}
                                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-blue-500 dark:border-lc-border dark:bg-lc-input dark:text-white dark:placeholder:text-slate-500"
                                placeholder="Example text with input, output, and explanation"
                            />
                        </div>
                    ))}
                </div>
            </div>

            {/* Constraints */}
            <div>
                <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-extrabold text-gray-700 dark:text-slate-100">
                        Constraints <span className="text-red-500">*</span>
                    </label>
                    <button
                        type="button"
                        onClick={addConstraint}
                        className="rounded-lg bg-primary px-3 py-1 text-sm font-extrabold text-white transition-colors hover:bg-primary/90"
                    >
                        + Add Constraint
                    </button>
                </div>
                <div className="space-y-2">
                    {formData.constraints.map((constraint, index) => (
                        <div key={index} className="flex gap-2">
                            <input
                                type="text"
                                value={constraint}
                                onChange={(e) => updateConstraint(index, e.target.value)}
                                className="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-900 outline-none focus:ring-2 focus:ring-blue-500 dark:border-lc-border dark:bg-lc-input dark:text-white dark:placeholder:text-slate-500"
                                placeholder="e.g., 1 <= s.length <= 15"
                            />
                            {formData.constraints.length > 1 && (
                                <button
                                    type="button"
                                    onClick={() => removeConstraint(index)}
                                    className="px-3 py-2 font-bold text-red-600 hover:text-red-800 dark:text-red-300 dark:hover:text-red-200"
                                >
                                    ×
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            {/* Hints */}
            <div>
                <label className="mb-2 block text-sm font-extrabold text-gray-700 dark:text-slate-100">
                    Hints (Optional, recommended)
                </label>
                <input
                    type="text"
                    onKeyPress={(e) => {
                        if (e.key === "Enter") {
                            e.preventDefault();
                            addHint(e.currentTarget.value);
                            e.currentTarget.value = "";
                        }
                    }}
                    className="mb-2 w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-900 outline-none focus:ring-2 focus:ring-blue-500 dark:border-lc-border dark:bg-lc-input dark:text-white dark:placeholder:text-slate-500"
                    placeholder="Type a helpful hint and press Enter"
                />
                <div className="space-y-2">
                    {formData.hints.map((hint, index) => (
                        <div key={index} className="flex items-start gap-2 rounded-lg border border-yellow-200 bg-yellow-50 p-3 dark:border-amber-400/20 dark:bg-amber-400/10">
                            <span className="flex-1 text-sm text-gray-700 dark:text-amber-100">{hint}</span>
                            <button
                                type="button"
                                onClick={() => removeHint(index)}
                                className="font-bold text-red-600 hover:text-red-800 dark:text-red-300 dark:hover:text-red-200"
                            >
                                ×
                            </button>
                        </div>
                    ))}
                </div>
            </div>

            {/* Follow Up */}
            <div>
                <label className="mb-2 block text-sm font-extrabold text-gray-700 dark:text-slate-100">
                    Follow-up Questions (Optional, recommended)
                </label>
                <input
                    type="text"
                    onKeyPress={(e) => {
                        if (e.key === "Enter") {
                            e.preventDefault();
                            addFollowUp(e.currentTarget.value);
                            e.currentTarget.value = "";
                        }
                    }}
                    className="mb-2 w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-900 outline-none focus:ring-2 focus:ring-blue-500 dark:border-lc-border dark:bg-lc-input dark:text-white dark:placeholder:text-slate-500"
                    placeholder="Type a follow-up question and press Enter"
                />
                <div className="space-y-2">
                    {formData.followUp.map((question, index) => (
                        <div key={index} className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-primary/20 dark:bg-primary/10">
                            <span className="flex-1 text-sm text-gray-700 dark:text-blue-100">{question}</span>
                            <button
                                type="button"
                                onClick={() => removeFollowUp(index)}
                                className="font-bold text-red-600 hover:text-red-800 dark:text-red-300 dark:hover:text-red-200"
                            >
                                ×
                            </button>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
