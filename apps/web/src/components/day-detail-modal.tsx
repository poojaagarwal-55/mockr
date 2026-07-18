"use client";

import { useState } from "react";
import { X, CheckCircle2, Clock, Target, Lightbulb, BookOpen, ExternalLink, Zap } from "lucide-react";
import type { DayQuestion, DayPlan } from "@/components/action-plan-calendar";
import { useDayDetails, useMarkQuestionComplete } from "@/hooks/use-action-plan";

// ─── Helpers ─────────────────────────────────────────────────────

function getDifficultyColor(d: string) {
    switch (d?.toLowerCase()) {
        case "easy": return "text-emerald-600 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-500/10";
        case "medium": return "text-amber-600 bg-amber-50 dark:text-amber-400 dark:bg-amber-500/10";
        case "hard": return "text-red-600 bg-red-50 dark:text-red-400 dark:bg-red-500/10";
        default: return "text-slate-600 bg-slate-50 dark:text-slate-400 dark:bg-slate-500/10";
    }
}

function getAllQuestions(day: DayPlan): DayQuestion[] {
    const q = day.questions;
    if (!q) return [];
    return [...(q.dsa || []), ...(q.csFundamentals || []), ...(q.sql || []), ...(q.systemDesign || [])];
}

function prettyTopic(t: string) {
    return t.replace(/_/g, " ").replace(/\b\w/g, m => m.toUpperCase());
}

// ─── Main Component ──────────────────────────────────────────────

export function DayDetailModal({
    day,
    isOpen,
    onClose,
}: {
    day: DayPlan | null;
    isOpen: boolean;
    onClose: () => void;
}) {
    const [tab, setTab] = useState<"dsa" | "cs" | "sql" | "sd">("dsa");
    const [localCompleted, setLocalCompleted] = useState<Set<string>>(new Set());
    const { data: dayDetails } = useDayDetails(isOpen && day ? day.dayNumber : null);
    const markComplete = useMarkQuestionComplete();

    const serverCompleted = dayDetails?.progress?.completedQuestions ?? [];

    const isQuestionDone = (id: string) => serverCompleted.includes(id) || localCompleted.has(id);

    const handleToggleQuestion = (questionId: string) => {
        if (!day) return;
        const wasCompleted = isQuestionDone(questionId);
        // Optimistic update
        setLocalCompleted((prev) => {
            const next = new Set(prev);
            wasCompleted ? next.delete(questionId) : next.add(questionId);
            return next;
        });
        markComplete.mutate({ dayNumber: day.dayNumber, questionId, completed: !wasCompleted });
    };

    if (!isOpen || !day) return null;

    const allQ = getAllQuestions(day);
    const focusAreas = day.focusAreas || (day.focus ? [day.focus] : []);
    const goals = day.goals || [];
    const tips = day.tips || [];
    const hours = day.estimatedHours || 0;

    const tabs = [
        { key: "dsa" as const, label: "DSA", items: day.questions?.dsa || [] },
        { key: "cs" as const, label: "CS Fundamentals", items: day.questions?.csFundamentals || [] },
        { key: "sql" as const, label: "SQL", items: day.questions?.sql || [] },
        { key: "sd" as const, label: "System Design", items: day.questions?.systemDesign || [] },
    ];
    const activeItems = tabs.find(t => t.key === tab)?.items || [];

    return (
        <div
            className="fixed inset-0 z-[600] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
            onClick={onClose}
        >
            <div
                className="relative w-full max-w-4xl max-h-[90vh] overflow-hidden rounded-3xl bg-white shadow-[0_20px_70px_-20px_rgba(74,124,255,0.35)] dark:bg-lc-elevated dark:shadow-black/40"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Close button */}
                <button
                    onClick={onClose}
                    className="absolute right-5 top-5 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition-colors hover:bg-slate-200 dark:bg-lc-hover dark:text-slate-300 dark:hover:bg-lc-elevated"
                >
                    <X className="h-4 w-4" />
                </button>

                {/* Header */}
                <div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-6 py-5 dark:border-lc-border dark:bg-lc-elevated">
                    <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3 flex-1 pr-12">
                            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-white font-bold text-lg shrink-0">
                                {day.dayNumber}
                            </div>
                            <div>
                                <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                                    {day.title || `Day ${day.dayNumber}`}
                                </h2>
                                {day.date && (
                                    <p className="text-sm text-slate-500 dark:text-slate-400">
                                        {new Date(day.date).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Focus areas */}
                    {focusAreas.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2 pl-[52px]">
                            {focusAreas.map((area, i) => (
                                <span key={i} className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">
                                    {prettyTopic(area)}
                                </span>
                            ))}
                        </div>
                    )}
                </div>

                {/* Content */}
                <div className="overflow-y-auto max-h-[calc(90vh-180px)] px-6 py-6">
                    {/* Stats */}
                    <div className="mb-6 grid grid-cols-3 gap-4">
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-lc-border dark:bg-lc-hover">
                            <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400 mb-1">
                                <Clock className="h-4 w-4" />
                                <span className="text-xs font-semibold">Est. Time</span>
                            </div>
                            <p className="text-2xl font-bold text-slate-900 dark:text-white">{hours.toFixed(1)}h</p>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-lc-border dark:bg-lc-hover">
                            <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400 mb-1">
                                <Target className="h-4 w-4" />
                                <span className="text-xs font-semibold">Questions</span>
                            </div>
                            <p className="text-2xl font-bold text-slate-900 dark:text-white">{allQ.length}</p>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-lc-border dark:bg-lc-hover">
                            <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400 mb-1">
                                <Zap className="h-4 w-4" />
                                <span className="text-xs font-semibold">Focus</span>
                            </div>
                            <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{focusAreas[0] ? prettyTopic(focusAreas[0]) : "General"}</p>
                        </div>
                    </div>

                    {/* Goals */}
                    {goals.length > 0 && (
                        <div className="mb-6 rounded-xl border border-slate-200 bg-slate-50 p-5 dark:border-lc-border dark:bg-lc-hover">
                            <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
                                <Target className="h-4 w-4 text-primary" /> Day Goals
                            </h3>
                            <ul className="space-y-2">
                                {goals.map((g, i) => (
                                    <li key={i} className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                                        <CheckCircle2 className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                                        <span>{g}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* Tips */}
                    {tips.length > 0 && (
                        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-500/20 dark:bg-amber-500/5">
                            <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-amber-900 dark:text-amber-300">
                                <Lightbulb className="h-4 w-4" /> Pro Tips
                            </h3>
                            <ul className="space-y-2">
                                {tips.map((tip, i) => (
                                    <li key={i} className="text-sm text-amber-800 dark:text-amber-200">• {tip}</li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* Milestone */}
                    {day.milestone && (
                        <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-500/20 dark:bg-emerald-500/5">
                            <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">🎉 {day.milestone}</p>
                        </div>
                    )}

                    {/* Question tabs */}
                    <div className="mb-4">
                        <div className="flex gap-2 border-b border-slate-200 dark:border-lc-border">
                            {tabs.map(t => (
                                <button
                                    key={t.key}
                                    onClick={() => setTab(t.key)}
                                    className={`relative px-4 py-2 text-sm font-semibold transition-colors ${
                                        tab === t.key ? "text-primary" : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
                                    }`}
                                >
                                    {t.label}
                                    {t.items.length > 0 && (
                                        <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs dark:bg-lc-hover">{t.items.length}</span>
                                    )}
                                    {tab === t.key && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Questions */}
                    <div className="space-y-3">
                        {activeItems.length === 0 ? (
                            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center dark:border-lc-border dark:bg-lc-hover">
                                <p className="text-sm text-slate-500 dark:text-slate-400">
                                    No {tabs.find(t => t.key === tab)?.label} questions for this day
                                </p>
                            </div>
                        ) : (
                            activeItems.map((question) => {
                                const isDone = isQuestionDone(question.id);
                                return (
                                    <div
                                        key={question.id}
                                        className={`group rounded-xl border p-4 transition-all ${
                                            isDone
                                                ? "border-emerald-200 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10"
                                                : "border-slate-200 bg-white hover:border-primary/40 hover:shadow-md dark:border-lc-border dark:bg-lc-bg dark:hover:border-primary/40"
                                        }`}
                                    >
                                        <div className="flex items-start gap-3">
                                            <button
                                                onClick={() => handleToggleQuestion(question.id)}
                                                className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors ${
                                                    isDone
                                                        ? "bg-emerald-500 text-white"
                                                        : "bg-primary/10 text-primary hover:bg-primary/20"
                                                }`}
                                                title={isDone ? "Mark incomplete" : "Mark complete"}
                                            >
                                                {isDone
                                                    ? <CheckCircle2 className="h-4 w-4" />
                                                    : <BookOpen className="h-4 w-4" />
                                                }
                                            </button>
                                            <div className="flex-1 min-w-0">
                                                <div className="mb-2 flex items-start justify-between gap-3">
                                                    <h4 className="font-semibold text-slate-900 dark:text-white">{question.title}</h4>
                                                    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold ${getDifficultyColor(question.difficulty)}`}>
                                                        {question.difficulty}
                                                    </span>
                                                </div>
                                                {question.topics && question.topics.length > 0 && (
                                                    <div className="mb-2 flex flex-wrap gap-1.5">
                                                        {question.topics.slice(0, 3).map((topic, i) => (
                                                            <span key={i} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-lc-hover dark:text-slate-400">{topic}</span>
                                                        ))}
                                                    </div>
                                                )}
                                                {question.why && <p className="mb-3 text-xs text-slate-600 dark:text-slate-400">💡 {question.why}</p>}
                                                <div className="flex items-center justify-between">
                                                    {question.estimatedMinutes && (
                                                        <span className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                                                            <Clock className="h-3.5 w-3.5" /> ~{question.estimatedMinutes} min
                                                        </span>
                                                    )}
                                                    {question.solveUrl && (
                                                        <a
                                                            href={question.solveUrl}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white transition-all hover:bg-primary-dark hover:shadow-md"
                                                        >
                                                            Solve <ExternalLink className="h-3.5 w-3.5" />
                                                        </a>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
