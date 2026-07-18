"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ActionPlanCalendar, type DayQuestion, type DayPlan } from "@/components/action-plan-calendar";
import {
    X, ArrowLeft, CheckCircle2, Clock, Target,
    Lightbulb, TrendingUp, ExternalLink, Calendar,
    Zap, BookOpen
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────


type ArtifactContent = {
    summary?: string | null;
    priorityFocus?: string | null;
    targetCompany?: string | null;
    totalDays?: number;
    totalHours?: number;
    hoursPerDay?: number;
    deadline?: string;
    priorityTopics?: string[];
    days?: DayPlan[];
    planSummary?: {
        totalQuestions: number;
        questionsByDifficulty?: { easy: number; medium: number; hard: number };
        topicCoverage?: Array<{ topic: string; count: number }>;
    };
};

type ModalView = "calendar" | "day-detail";

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

// ─── Day Detail View ─────────────────────────────────────────────

function DayDetailView({ day, onBack }: { day: DayPlan; onBack: () => void }) {
    const [tab, setTab] = useState<"dsa" | "cs" | "sql" | "sd">("dsa");
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
        <>
            {/* Header */}
            <div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-6 py-5 dark:border-lc-border dark:bg-lc-elevated">
                <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3 flex-1">
                        <button onClick={onBack} className="flex h-10 w-10 items-center justify-center rounded-xl hover:bg-slate-100 dark:hover:bg-lc-hover shrink-0">
                            <ArrowLeft className="h-5 w-5 text-slate-600 dark:text-slate-400" />
                        </button>
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
                    <div className="mt-3 flex flex-wrap gap-2 pl-[92px]">
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
                        activeItems.map((question) => (
                            <div
                                key={question.id}
                                className="group rounded-xl border border-slate-200 bg-white p-4 transition-all hover:border-primary/40 hover:shadow-md dark:border-lc-border dark:bg-lc-bg dark:hover:border-primary/40"
                            >
                                <div className="flex items-start gap-3">
                                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary mt-0.5">
                                        <BookOpen className="h-4 w-4" />
                                    </div>
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
                        ))
                    )}
                </div>
            </div>
        </>
    );
}

// ─── Main Modal ──────────────────────────────────────────────────

export function ActionPlanPreviewModal({
    artifactId,
    token,
    onClose,
    onApprove,
    onRevise,
}: {
    artifactId: string;
    token: string;
    onClose: () => void;
    onApprove: (direct?: boolean, resourceId?: string | null) => void;
    onRevise: (note: string) => void;
}) {
    const queryClient = useQueryClient();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [content, setContent] = useState<ArtifactContent | null>(null);
    const [title, setTitle] = useState("");
    const [isDraft, setIsDraft] = useState(false);
    const [committed, setCommitted] = useState(false);
    const [isCommitting, setIsCommitting] = useState(false);
    const [view, setView] = useState<ModalView>("calendar");
    const [selectedDay, setSelectedDay] = useState<number | null>(null);
    const [reviseOpen, setReviseOpen] = useState(false);
    const [reviseText, setReviseText] = useState("");

    // Fetch artifact data
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        api.get<{ artifact: { id: string; title: string; content: any; meta: any } }>(
            `/users/me/tutor/artifacts/${artifactId}`, token
        ).then(res => {
            if (cancelled) return;
            const a = res.artifact;
            setContent(a.content);
            setTitle(a.title);
            setIsDraft(a.meta?.isDraft === true);
            setCommitted(a.meta?.isDraft === false && a.meta?.committedAt);
        }).catch(err => {
            if (!cancelled) setError(err?.message || "Failed to load");
        }).finally(() => {
            if (!cancelled) setLoading(false);
        });
        return () => { cancelled = true; };
    }, [artifactId, token]);

    // Escape key
    useEffect(() => {
        const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
        window.addEventListener("keydown", handler);
        const prev = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            window.removeEventListener("keydown", handler);
            document.body.style.overflow = prev;
        };
    }, [onClose]);

    const days = content?.days || [];
    const totalDays = content?.totalDays || days.length;
    const startDate = new Date();
    const endDate = content?.deadline ? new Date(content.deadline) : new Date(Date.now() + totalDays * 86400000);
    const selectedDayData = selectedDay ? days.find(d => d.dayNumber === selectedDay) : null;

    const handleDayClick = (dayNum: number) => {
        setSelectedDay(dayNum);
        setView("day-detail");
    };

    const handleBack = () => {
        setView("calendar");
        setSelectedDay(null);
    };

    const submitRevise = () => {
        const note = reviseText.trim();
        if (!note) return;
        onRevise(note);
        setReviseText("");
        setReviseOpen(false);
    };

    const handleDirectApprove = async () => {
        setIsCommitting(true);
        setError(null);
        try {
            const res = await api.post<{ success: boolean; artifact: { resourceId: string | null } }>(
                `/users/me/tutor/artifacts/${artifactId}/commit`, 
                {}, 
                token
            );
            const resourceId = res.artifact?.resourceId;
            setCommitted(true);
            setIsDraft(false);
            
            // Wait a moment for the database transaction to complete
            await new Promise(resolve => setTimeout(resolve, 300));
            
            // Invalidate and refetch the action plan cache so dashboard refreshes
            await queryClient.invalidateQueries({ queryKey: ["action-plan", "active"] });
            await queryClient.refetchQueries({ queryKey: ["action-plan", "active"] });
            
            onApprove(true, resourceId);
        } catch (err: any) {
            setError(err?.message || "Failed to commit plan");
        } finally {
            setIsCommitting(false);
        }
    };

    return (
        <div
            className="fixed inset-0 z-[600] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
            onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className="relative w-full max-w-4xl max-h-[90vh] overflow-hidden rounded-3xl bg-white shadow-[0_20px_70px_-20px_rgba(74,124,255,0.35)] dark:bg-lc-elevated dark:shadow-black/40">
                {/* Close */}
                <button
                    onClick={onClose}
                    className="absolute right-5 top-5 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition-colors hover:bg-slate-200 dark:bg-lc-hover dark:text-slate-300 dark:hover:bg-lc-elevated"
                >
                    <X className="h-4 w-4" />
                </button>

                {/* Loading */}
                {loading && (
                    <div className="flex h-64 items-center justify-center">
                        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary/30 border-t-primary" />
                    </div>
                )}

                {/* Error */}
                {error && !loading && (
                    <div className="p-8">
                        <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</div>
                    </div>
                )}

                {/* Calendar View */}
                {!loading && !error && content && view === "calendar" && (
                    <>
                        {/* Header */}
                        <div className="bg-gradient-to-br from-primary/8 to-transparent px-7 pb-5 pt-7">
                            <div className="flex items-start gap-3 pr-10">
                                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary text-white shadow-[0_6px_18px_-4px_rgba(74,124,255,0.55)]">
                                    <Calendar className="h-5 w-5" />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary">Action Plan</p>
                                    <h2 className="mt-0.5 text-xl font-extrabold tracking-tight text-slate-950 dark:text-white">{title}</h2>
                                    {content.summary && (
                                        <p className="mt-1.5 text-sm leading-6 text-slate-600 dark:text-slate-300">{content.summary}</p>
                                    )}
                                </div>
                            </div>

                            {/* Stats pills */}
                            <div className="mt-4 flex flex-wrap gap-2 pl-14">
                                {totalDays > 0 && (
                                    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/80 px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm dark:bg-lc-hover dark:text-slate-300">
                                        <Calendar className="h-3.5 w-3.5 text-primary" /> {totalDays} days
                                    </span>
                                )}
                                {content.planSummary?.totalQuestions && (
                                    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/80 px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm dark:bg-lc-hover dark:text-slate-300">
                                        <Target className="h-3.5 w-3.5 text-primary" /> {content.planSummary.totalQuestions} questions
                                    </span>
                                )}
                                {content.totalHours && (
                                    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/80 px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm dark:bg-lc-hover dark:text-slate-300">
                                        <Clock className="h-3.5 w-3.5 text-primary" /> {Math.round(content.totalHours)}h total
                                    </span>
                                )}
                                {content.targetCompany && (
                                    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/80 px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm dark:bg-lc-hover dark:text-slate-300">
                                        <Zap className="h-3.5 w-3.5 text-primary" /> {content.targetCompany}
                                    </span>
                                )}
                            </div>

                            {/* Priority Focus */}
                            {content.priorityFocus && (
                                <div className="mt-4 ml-14 rounded-xl bg-primary/8 px-4 py-2.5 dark:bg-primary/15">
                                    <p className="text-[10px] font-bold uppercase tracking-widest text-primary">Priority Focus</p>
                                    <p className="mt-0.5 text-sm font-semibold text-slate-900 dark:text-white">{content.priorityFocus}</p>
                                </div>
                            )}
                        </div>

                        {/* Calendar */}
                        <div className="max-h-[50vh] overflow-y-auto px-7 pb-4 pt-4">
                            <ActionPlanCalendar
                                startDate={startDate}
                                endDate={endDate}
                                totalDays={totalDays}
                                currentDay={1}
                                completedDays={[]}
                                days={days}
                                onDayClick={handleDayClick}
                                showViewPlanLabel
                                previewMode
                            />
                        </div>

                        {/* Footer actions */}
                        {isDraft && !committed && (
                            <div className="sticky bottom-0 border-t border-slate-200 bg-white px-7 py-4 dark:border-lc-border dark:bg-lc-elevated">
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={handleDirectApprove}
                                        disabled={isCommitting}
                                        className="inline-flex items-center gap-1.5 rounded-full bg-primary px-5 py-2 text-sm font-bold text-white shadow-[0_5px_14px_-4px_rgba(74,124,255,0.6)] transition-all hover:-translate-y-px hover:shadow-[0_8px_18px_-4px_rgba(74,124,255,0.7)] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
                                    >
                                        {isCommitting ? (
                                            <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                                        ) : (
                                            <CheckCircle2 className="h-4 w-4" />
                                        )}
                                        {isCommitting ? "Saving..." : "Accept & Save to Dashboard"}
                                    </button>
                                    <button
                                        onClick={() => setReviseOpen(v => !v)}
                                        className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-4 py-2 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-200 dark:bg-lc-hover dark:text-slate-300"
                                    >
                                        {reviseOpen ? "Hide" : "Suggest changes"}
                                    </button>
                                </div>

                                {reviseOpen && (
                                    <div className="mt-3 rounded-2xl bg-slate-50 p-2.5 dark:bg-lc-hover">
                                        <textarea
                                            value={reviseText}
                                            onChange={e => setReviseText(e.target.value)}
                                            onKeyDown={e => {
                                                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submitRevise(); }
                                            }}
                                            rows={2}
                                            placeholder="e.g. extend to 3 weeks, focus more on system design"
                                            className="w-full resize-none rounded-xl bg-white px-3 py-2 text-xs font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none dark:bg-lc-bg dark:text-white"
                                        />
                                        <div className="mt-1.5 flex items-center justify-end gap-1.5">
                                            <button onClick={() => { setReviseOpen(false); setReviseText(""); }} className="rounded-full px-3 py-1 text-[11px] font-bold text-slate-500 hover:bg-slate-100 dark:text-slate-400">Cancel</button>
                                            <button onClick={submitRevise} disabled={!reviseText.trim()} className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1 text-[11px] font-bold text-white hover:bg-primary-dark disabled:opacity-50">
                                                Send revisions
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {committed && (
                            <div className="border-t border-slate-200 bg-emerald-50 px-7 py-3 dark:border-lc-border dark:bg-emerald-500/5">
                                <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                                    <CheckCircle2 className="h-4 w-4" /> Saved to your dashboard calendar
                                </p>
                            </div>
                        )}
                    </>
                )}

                {/* Day Detail View */}
                {!loading && !error && view === "day-detail" && selectedDayData && (
                    <DayDetailView day={selectedDayData} onBack={handleBack} />
                )}
            </div>
        </div>
    );
}
