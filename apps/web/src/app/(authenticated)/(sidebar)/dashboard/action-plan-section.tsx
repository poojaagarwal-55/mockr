"use client";

import { useState } from "react";
import { ActionPlanCalendar } from "@/components/action-plan-calendar";
import { DayDetailModal } from "@/components/day-detail-modal";
import { useActiveActionPlan } from "@/hooks/use-action-plan";
import { Calendar, TrendingUp, Target, Clock } from "lucide-react";

export function ActionPlanSection() {
    const { data, isLoading } = useActiveActionPlan();
    const [selectedDay, setSelectedDay] = useState<number | null>(null);

    if (isLoading) {
        return (
            <div className="glass-card p-6">
                <div className="flex items-center gap-3 mb-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                        <Calendar className="h-5 w-5 text-primary" />
                    </div>
                    <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                        Action Plan
                    </h2>
                </div>
                <div className="flex items-center justify-center py-12">
                    <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary/30 border-t-primary"></div>
                </div>
            </div>
        );
    }

    if (!data?.plan) {
        return (
            <div className="glass-card p-6">
                <div className="flex items-center gap-3 mb-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                        <Calendar className="h-5 w-5 text-primary" />
                    </div>
                    <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                        Action Plan
                    </h2>
                </div>
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center dark:border-lc-border dark:bg-lc-hover">
                    <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 dark:bg-lc-bg">
                        <Target className="h-6 w-6 text-slate-400" />
                    </div>
                    <p className="mb-2 font-semibold text-slate-900 dark:text-white">
                        No Active Action Plan
                    </p>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                        Ask the AI Tutor to create a personalized action plan for your interview prep
                    </p>
                </div>
            </div>
        );
    }

    const { plan, progress } = data;
    const startDate = new Date(plan.startDate);
    const endDate = new Date(plan.endDate);

    return (
        <>
            <div className="space-y-6">
                {/* Stats Overview */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="glass-card p-4">
                        <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400 mb-1">
                            <Target className="h-4 w-4" />
                            <span className="text-xs font-semibold">Total Days</span>
                        </div>
                        <p className="text-2xl font-bold text-slate-900 dark:text-white">
                            {progress?.totalDays || 0}
                        </p>
                    </div>

                    <div className="glass-card p-4">
                        <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400 mb-1">
                            <TrendingUp className="h-4 w-4" />
                            <span className="text-xs font-semibold">Completed</span>
                        </div>
                        <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                            {progress?.completedDays || 0}
                        </p>
                    </div>

                    <div className="glass-card p-4">
                        <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400 mb-1">
                            <Clock className="h-4 w-4" />
                            <span className="text-xs font-semibold">Questions</span>
                        </div>
                        <p className="text-2xl font-bold text-slate-900 dark:text-white">
                            {progress?.totalQuestions || 0}
                        </p>
                    </div>

                    <div className="glass-card p-4">
                        <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400 mb-1">
                            <TrendingUp className="h-4 w-4" />
                            <span className="text-xs font-semibold">Progress</span>
                        </div>
                        <p className="text-2xl font-bold text-primary">
                            {progress?.percentComplete || 0}%
                        </p>
                    </div>
                </div>

                {/* Calendar */}
                <ActionPlanCalendar
                    startDate={startDate}
                    endDate={endDate}
                    totalDays={plan.totalDays || progress?.totalDays || 0}
                    currentDay={plan.currentDay}
                    completedDays={plan.content?.days?.filter(d => d.completed).map(d => d.dayNumber) || []}
                    onDayClick={setSelectedDay}
                />

                {/* Plan Summary */}
                {plan.content?.summary && (
                    <div className="glass-card p-5">
                        <h3 className="mb-2 text-sm font-bold text-slate-900 dark:text-white">
                            Plan Overview
                        </h3>
                        <p className="text-sm text-slate-700 dark:text-slate-300">
                            {plan.content.summary}
                        </p>
                        {plan.content.priorityFocus && (
                            <div className="mt-3 rounded-lg bg-primary/5 p-3">
                                <p className="text-xs font-semibold text-primary">
                                    🎯 Priority Focus: {plan.content.priorityFocus}
                                </p>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Day Detail Modal */}
            {selectedDay && (
                <DayDetailModal
                    day={plan.content?.days?.find(d => d.dayNumber === selectedDay) ?? null}
                    isOpen={!!selectedDay}
                    onClose={() => setSelectedDay(null)}
                />
            )}
        </>
    );
}
