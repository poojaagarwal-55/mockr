import { DSAQuestionData } from "../DSAQuestionForm";
import { MarkdownQuestionEditor } from "@/components/question-content/markdown-question-editor";
import { QuestionAuthoringHelpButton } from "@/components/question-content/question-authoring-help";

interface Props {
    formData: DSAQuestionData;
    setFormData: (data: DSAQuestionData) => void;
}

export function DescriptionSection({ formData, setFormData }: Props) {
    const addExample = () => {
        setFormData({
            ...formData,
            examples: [...formData.examples, { example_num: formData.examples.length + 1, example_text: "" }],
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
        setFormData({ ...formData, hints: [...formData.hints, hint] });
    };

    const updateHint = (index: number, value: string) => {
        const updated = [...formData.hints];
        updated[index] = value;
        setFormData({ ...formData, hints: updated });
    };

    const removeHint = (index: number) => {
        setFormData({ ...formData, hints: formData.hints.filter((_, i) => i !== index) });
    };

    const addFollowUp = (followUp: string) => {
        setFormData({ ...formData, followUp: [...formData.followUp, followUp] });
    };

    const updateFollowUp = (index: number, value: string) => {
        const updated = [...formData.followUp];
        updated[index] = value;
        setFormData({ ...formData, followUp: updated });
    };

    const removeFollowUp = (index: number) => {
        setFormData({ ...formData, followUp: formData.followUp.filter((_, i) => i !== index) });
    };

    return (
        <div className="space-y-6">
            <div>
                <MarkdownQuestionEditor
                    value={formData.description}
                    onChange={(description) => setFormData({ ...formData, description })}
                    label={
                        <span className="inline-flex items-center gap-2">
                            <span>Problem Description</span>
                            <QuestionAuthoringHelpButton topic="description" />
                        </span>
                    }
                    required
                    rows={10}
                    placeholder="Write the complete problem statement. Markdown, tables, images, and LaTeX like $O(n log n)$ are supported."
                />
            </div>

            <div>
                <div className="mb-2 flex items-center justify-between">
                    <div className="inline-flex items-center gap-2 text-sm font-extrabold text-gray-700 dark:text-slate-100">
                        <span>Examples <span className="text-red-500">*</span></span>
                        <QuestionAuthoringHelpButton topic="examples" />
                    </div>
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
                            <div className="mb-2 flex items-center justify-between">
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
                            <MarkdownQuestionEditor
                                value={example.example_text}
                                onChange={(text) => updateExample(index, text)}
                                rows={7}
                                placeholder={"Use this format:\nInput: Solve $x^2 - 5x + 6 = 0$.\n\nOutput: $x = 2$ or $x = 3$.\n\nExplanation:\nFactor the equation:\n$$\nx^2 - 5x + 6 = (x-2)(x-3)\n$$"}
                            />
                        </div>
                    ))}
                </div>
            </div>

            <div>
                <div className="mb-2 flex items-center justify-between">
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
                        <div key={index} className="rounded-lg border border-gray-300 bg-white p-3 dark:border-lc-border dark:bg-lc-elevated">
                            <div className="mb-2 flex items-center justify-between gap-3">
                                <span className="text-sm font-extrabold text-gray-700 dark:text-slate-200">Constraint {index + 1}</span>
                                {formData.constraints.length > 1 && (
                                    <button
                                        type="button"
                                        onClick={() => removeConstraint(index)}
                                        className="rounded-lg px-2 py-1 font-bold text-red-600 hover:bg-red-50 hover:text-red-800 dark:text-red-300 dark:hover:bg-red-500/10 dark:hover:text-red-200"
                                        aria-label={`Remove constraint ${index + 1}`}
                                    >
                                        Remove
                                    </button>
                                )}
                            </div>
                            <MarkdownQuestionEditor
                                value={constraint}
                                onChange={(value) => updateConstraint(index, value)}
                                rows={3}
                                placeholder="Write one constraint. Markdown, LaTeX like $1 \\le n \\le 10^5$, and images are supported."
                            />
                        </div>
                    ))}
                </div>
            </div>

            <div>
                <div className="mb-2 flex items-center justify-between">
                    <label className="block text-sm font-extrabold text-gray-700 dark:text-slate-100">
                        Hints (Optional, recommended)
                    </label>
                    <button
                        type="button"
                        onClick={() => addHint("")}
                        className="rounded-lg bg-primary px-3 py-1 text-sm font-extrabold text-white transition-colors hover:bg-primary/90"
                    >
                        + Add Hint
                    </button>
                </div>
                <div className="space-y-3">
                    {formData.hints.length === 0 && (
                        <button
                            type="button"
                            onClick={() => addHint("")}
                            className="flex w-full items-center justify-center rounded-lg border border-dashed border-gray-300 bg-white px-4 py-5 text-sm font-extrabold text-slate-500 transition hover:border-primary hover:text-primary dark:border-lc-border dark:bg-lc-input dark:text-slate-400"
                        >
                            Add a rich hint with Markdown, LaTeX, images, or notes
                        </button>
                    )}
                    {formData.hints.map((hint, index) => (
                        <div key={index} className="rounded-lg border border-amber-200 bg-amber-50/70 p-4 dark:border-amber-400/20 dark:bg-amber-400/10">
                            <div className="mb-2 flex items-center justify-between">
                                <span className="text-sm font-extrabold text-amber-800 dark:text-amber-100">Hint {index + 1}</span>
                                <button
                                    type="button"
                                    onClick={() => removeHint(index)}
                                    className="rounded-lg px-2 py-1 text-sm font-bold text-red-600 hover:bg-red-50 hover:text-red-800 dark:text-red-300 dark:hover:bg-red-500/10 dark:hover:text-red-200"
                                    aria-label={`Remove hint ${index + 1}`}
                                >
                                    Remove
                                </button>
                            </div>
                            <MarkdownQuestionEditor
                                value={hint}
                                onChange={(value) => updateHint(index, value)}
                                rows={5}
                                placeholder={"Write a helpful hint. Markdown, LaTeX like $O(n \\log n)$, images, and note blocks are supported."}
                            />
                        </div>
                    ))}
                </div>
            </div>

            <div>
                <div className="mb-2 flex items-center justify-between">
                    <label className="block text-sm font-extrabold text-gray-700 dark:text-slate-100">
                        Follow-up Questions (Optional, recommended)
                    </label>
                    <button
                        type="button"
                        onClick={() => addFollowUp("")}
                        className="rounded-lg bg-primary px-3 py-1 text-sm font-extrabold text-white transition-colors hover:bg-primary/90"
                    >
                        + Add Follow-up
                    </button>
                </div>
                <div className="space-y-3">
                    {formData.followUp.length === 0 && (
                        <button
                            type="button"
                            onClick={() => addFollowUp("")}
                            className="flex w-full items-center justify-center rounded-lg border border-dashed border-gray-300 bg-white px-4 py-5 text-sm font-extrabold text-slate-500 transition hover:border-primary hover:text-primary dark:border-lc-border dark:bg-lc-input dark:text-slate-400"
                        >
                            Add a follow-up with Markdown, LaTeX, images, or extra context
                        </button>
                    )}
                    {formData.followUp.map((question, index) => (
                        <div key={index} className="rounded-lg border border-primary/20 bg-primary/5 p-4 dark:bg-primary/10">
                            <div className="mb-2 flex items-center justify-between">
                                <span className="text-sm font-extrabold text-primary">Follow-up {index + 1}</span>
                                <button
                                    type="button"
                                    onClick={() => removeFollowUp(index)}
                                    className="rounded-lg px-2 py-1 text-sm font-bold text-red-600 hover:bg-red-50 hover:text-red-800 dark:text-red-300 dark:hover:bg-red-500/10 dark:hover:text-red-200"
                                    aria-label={`Remove follow-up ${index + 1}`}
                                >
                                    Remove
                                </button>
                            </div>
                            <MarkdownQuestionEditor
                                value={question}
                                onChange={(value) => updateFollowUp(index, value)}
                                rows={5}
                                placeholder={"Write a follow-up question or extension. Markdown, LaTeX, and images are supported."}
                            />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
