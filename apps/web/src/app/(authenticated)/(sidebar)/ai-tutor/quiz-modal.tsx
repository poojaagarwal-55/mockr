"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";

type AgentArtifact = {
    artifactId: string;
    artifactType: string;
    title: string;
    summary: string | null;
    createdAt: number;
    isDraft: boolean;
    committed: boolean;
};

export function QuizModal({
    quizId,
    token,
    agentArtifacts,
    quizAnswers,
    setQuizAnswers,
    showQuizResults,
    setShowQuizResults,
    currentQuestionIndex,
    setCurrentQuestionIndex,
    onComplete,
    onSave,
    onClose,
}: {
    quizId: string;
    token: string | null;
    agentArtifacts: AgentArtifact[];
    quizAnswers: Record<string, string | number>;
    setQuizAnswers: (answers: Record<string, string | number>) => void;
    showQuizResults: boolean;
    setShowQuizResults: (show: boolean) => void;
    currentQuestionIndex: number;
    setCurrentQuestionIndex: (index: number) => void;
    onComplete?: (score: { correct: number; total: number; percentage: number }) => void;
    onSave?: () => void;
    onClose: () => void;
}) {
    const [quizData, setQuizData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchQuizData = async () => {
            if (!token) {
                setError("No authentication token available");
                setLoading(false);
                return;
            }
            try {
                setLoading(true);
                setError(null);
                const response = await api.get(`/users/me/tutor/artifacts/${quizId}`, token) as any;
                console.log("Quiz data response:", response);
                // API returns { artifact: { id, type, title, content, ... } }
                const artifactData = response.artifact || response;
                console.log("Artifact data:", artifactData);
                console.log("Content:", artifactData?.content);
                console.log("Items:", artifactData?.content?.items);
                setQuizData(artifactData);
            } catch (err: any) {
                console.error("Failed to fetch quiz:", err);
                setError(err?.message || "Failed to load quiz");
            } finally {
                setLoading(false);
            }
        };

        if (quizId) {
            fetchQuizData();
        }
    }, [quizId, token]);

    if (loading || !quizData?.content?.items) {
        return (
            <div className="fixed inset-0 z-[400] flex items-center justify-center bg-slate-900/60 px-4">
                <div className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-8 shadow-2xl dark:border-lc-border dark:bg-lc-surface">
                    {error ? (
                        <div className="text-center">
                            <span className="material-symbols-outlined text-red-500 text-[48px] mb-4">error</span>
                            <p className="text-sm font-medium text-red-600 dark:text-red-400">{error}</p>
                            <button
                                onClick={onClose}
                                className="mt-4 rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200 dark:bg-lc-hover dark:text-slate-200"
                            >
                                Close
                            </button>
                        </div>
                    ) : loading ? (
                        <div className="flex items-center justify-center gap-3">
                            <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
                            <p className="text-sm font-medium text-slate-600 dark:text-slate-300">Loading quiz...</p>
                        </div>
                    ) : (
                        <div className="text-center">
                            <span className="material-symbols-outlined text-amber-500 text-[48px] mb-4">warning</span>
                            <p className="text-sm font-medium text-slate-600 dark:text-slate-300">Quiz has no questions</p>
                            <button
                                onClick={onClose}
                                className="mt-4 rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200 dark:bg-lc-hover dark:text-slate-200"
                            >
                                Close
                            </button>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    const items = quizData.content.items || [];
    const currentItem = items[currentQuestionIndex];
    const totalQuestions = items.length;

    const handleAnswer = (answer: string | number) => {
        setQuizAnswers({ ...quizAnswers, [currentItem.id]: answer });
    };

    const handleNext = () => {
        if (currentQuestionIndex < totalQuestions - 1) {
            setCurrentQuestionIndex(currentQuestionIndex + 1);
        }
    };

    const handlePrevious = () => {
        if (currentQuestionIndex > 0) {
            setCurrentQuestionIndex(currentQuestionIndex - 1);
        }
    };

    const handleSubmit = () => {
        onComplete?.(calculateScore());
        setShowQuizResults(true);
    };

    const calculateScore = () => {
        let correct = 0;
        items.forEach((item: any) => {
            const userAnswer = quizAnswers[item.id];
            // Only MCQ format now
            if (userAnswer === item.correctIndex) {
                correct++;
            }
        });
        return { correct, total: items.length, percentage: Math.round((correct / items.length) * 100) };
    };

    if (showQuizResults) {
        const score = calculateScore();
        return (
            <div className="fixed inset-0 z-[400] flex items-center justify-center bg-slate-900/60 px-4" onClick={onClose}>
                <div className="flex h-[82vh] max-h-[82vh] w-full max-w-2xl flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-lc-border dark:bg-lc-surface sm:p-6" onClick={(e) => e.stopPropagation()}>
                    {/* Score Display */}
                    <div className="shrink-0 text-center">
                        <div className="mx-auto mb-3 flex h-[18%] min-h-20 w-[18%] min-w-20 max-w-28 max-h-28 items-center justify-center rounded-full bg-gradient-to-br from-primary to-blue-600 shadow-lg">
                            <div className="text-center">
                                <p className="text-3xl font-black text-white">{score.percentage}%</p>
                                <p className="text-xs font-semibold uppercase tracking-wider text-white/80">Score</p>
                            </div>
                        </div>
                        <h3 className="text-xl font-black text-slate-900 dark:text-white font-nunito">
                            {score.percentage >= 80 ? "Excellent Work!" : score.percentage >= 60 ? "Good Job!" : "Keep Practicing!"}
                        </h3>
                        <p className="mt-1 text-sm font-semibold text-slate-600 dark:text-slate-300">
                            You got {score.correct} out of {score.total} questions correct
                        </p>
                    </div>

                    {/* Question Review */}
                    <div className="mt-5 min-h-0 flex-1 space-y-3 overflow-y-auto rounded-xl bg-slate-50 p-3 dark:bg-lc-hover">
                        {items.map((item: any, idx: number) => {
                            const userAnswer = quizAnswers[item.id];
                            const isCorrect = userAnswer === item.correctIndex;
                            
                            return (
                                <div key={item.id} className="rounded-lg bg-white p-4 dark:bg-lc-surface">
                                    <div className="flex items-start gap-3">
                                        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${isCorrect ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400" : "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400"}`}>
                                            {isCorrect ? "✓" : "✗"}
                                        </span>
                                        <div className="flex-1">
                                            <p className="text-sm font-semibold text-slate-900 dark:text-white">
                                                Q{idx + 1}: {item.prompt}
                                            </p>
                                            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                                                Your answer: {item.choices[userAnswer as number] || "Not answered"}
                                                {!isCorrect && ` • Correct: ${item.choices[item.correctIndex]}`}
                                            </p>
                                            {item.explanation && (
                                                <p className="mt-2 text-xs italic text-slate-500 dark:text-slate-400">
                                                    {item.explanation}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Actions */}
                    <div className="mt-4 flex shrink-0 gap-3">
                        <button
                            onClick={() => {
                                setShowQuizResults(false);
                                setCurrentQuestionIndex(0);
                                setQuizAnswers({});
                            }}
                            className="flex-1 rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-lc-border dark:text-slate-200 dark:hover:bg-lc-hover"
                        >
                            Retake Quiz
                        </button>
                        {onSave && (
                            <button
                                onClick={onSave}
                                className="flex-1 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-700"
                            >
                                Save quiz
                            </button>
                        )}
                        <button
                            onClick={onClose}
                            className="flex-1 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white hover:bg-primary-dark"
                        >
                            Close
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // Quiz taking interface
    const userAnswer = quizAnswers[currentItem.id];
    const allAnswered = items.every((item: any) => quizAnswers[item.id] !== undefined);

    return (
        <div className="fixed inset-0 z-[400] flex items-center justify-center bg-slate-900/60 px-4" onClick={onClose}>
            <div className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-lc-border dark:bg-lc-surface" onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="border-b border-slate-200 px-6 py-4 dark:border-lc-border">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-lg font-bold text-slate-900 dark:text-white font-nunito">
                                {quizData.title || "Quiz"}
                            </h3>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                Question {currentQuestionIndex + 1} of {totalQuestions}
                            </p>
                        </div>
                        <button
                            onClick={onClose}
                            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-lc-hover dark:hover:text-slate-300"
                        >
                            <span className="material-symbols-outlined text-[20px]">close</span>
                        </button>
                    </div>
                    {/* Progress bar */}
                    <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-lc-hover">
                        <div
                            className="h-full bg-primary transition-all duration-300"
                            style={{ width: `${((currentQuestionIndex + 1) / totalQuestions) * 100}%` }}
                        />
                    </div>
                </div>

                {/* Question Content */}
                <div className="max-h-[500px] overflow-y-auto p-6">
                    <div className="mb-6">
                        <div className="mb-2 flex items-center gap-2">
                            <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider text-primary">
                                Multiple Choice
                            </span>
                            {currentItem.difficulty && (
                                <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider ${
                                    currentItem.difficulty === "easy" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400" :
                                    currentItem.difficulty === "hard" ? "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400" :
                                    "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400"
                                }`}>
                                    {currentItem.difficulty}
                                </span>
                            )}
                        </div>
                        <p className="text-base font-semibold leading-relaxed text-slate-900 dark:text-white">
                            {currentItem.prompt}
                        </p>
                    </div>

                    {/* Answer Options - MCQ only */}
                    <div className="space-y-2">
                        {currentItem.choices.map((choice: string, idx: number) => (
                            <button
                                key={idx}
                                onClick={() => handleAnswer(idx)}
                                className={`w-full rounded-xl border-2 px-4 py-3 text-left text-sm font-medium transition-all ${
                                    userAnswer === idx
                                        ? "border-primary bg-primary/5 text-primary dark:bg-primary/10"
                                        : "border-slate-200 text-slate-700 hover:border-primary/40 hover:bg-slate-50 dark:border-lc-border dark:text-slate-200 dark:hover:bg-lc-hover"
                                }`}
                            >
                                <div className="flex items-center gap-3">
                                    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold ${
                                        userAnswer === idx
                                            ? "border-primary bg-primary text-white"
                                            : "border-slate-300 text-slate-400 dark:border-slate-600"
                                    }`}>
                                        {String.fromCharCode(65 + idx)}
                                    </span>
                                    <span>{choice}</span>
                                </div>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Footer Navigation */}
                <div className="border-t border-slate-200 px-6 py-4 dark:border-lc-border">
                    <div className="flex items-center justify-between">
                        <button
                            onClick={handlePrevious}
                            disabled={currentQuestionIndex === 0}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-lc-border dark:text-slate-200 dark:hover:bg-lc-hover"
                        >
                            <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                            Previous
                        </button>

                        <div className="flex gap-1">
                            {items.map((_: any, idx: number) => (
                                <button
                                    key={idx}
                                    onClick={() => setCurrentQuestionIndex(idx)}
                                    className={`h-2 w-2 rounded-full transition-all ${
                                        idx === currentQuestionIndex
                                            ? "w-6 bg-primary"
                                            : quizAnswers[items[idx].id] !== undefined
                                                ? "bg-primary/40"
                                                : "bg-slate-300 dark:bg-slate-600"
                                    }`}
                                />
                            ))}
                        </div>

                        {currentQuestionIndex < totalQuestions - 1 ? (
                            <button
                                onClick={handleNext}
                                className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark"
                            >
                                Next
                                <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                            </button>
                        ) : (
                            <button
                                onClick={handleSubmit}
                                disabled={!allAnswered}
                                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                <span className="material-symbols-outlined text-[18px]">check_circle</span>
                                Submit Quiz
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
