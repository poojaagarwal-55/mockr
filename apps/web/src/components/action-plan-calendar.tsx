"use client";

import { useState, useMemo } from "react";
import { ChevronLeft, ChevronRight, Calendar } from "lucide-react";

type DayStatus = "upcoming" | "current" | "completed" | "none";

export type DayQuestion = {
    id: string;
    slug?: string | null;
    title: string;
    difficulty: string;
    category?: string;
    topics?: string[];
    estimatedMinutes?: number;
    why?: string;
    solveUrl?: string;
};

export type DayPlan = {
    dayNumber: number;
    date?: string;
    title?: string;
    focus?: string;
    focusAreas?: string[];
    estimatedHours?: number;
    goals?: string[];
    tips?: string[];
    milestone?: string | null;
    questions?: {
        dsa?: DayQuestion[];
        csFundamentals?: DayQuestion[];
        sql?: DayQuestion[];
        systemDesign?: DayQuestion[];
    };
};

type CalendarDay = {
    date: Date;
    dayNumber: number | null;
    status: DayStatus;
    isToday: boolean;
    isCurrentMonth: boolean;
    plan?: DayPlan;
};

type ActionPlanCalendarProps = {
    startDate: Date;
    endDate: Date;
    totalDays: number;
    currentDay: number;
    completedDays: number[];
    days?: DayPlan[];
    onDayClick: (dayNumber: number) => void;
    /** When true, shows "View Plan" label on each plan-day cell */
    showViewPlanLabel?: boolean;
    /** When true, all plan days show as 'upcoming' — used for draft previews */
    previewMode?: boolean;
};

function getCategoryStyle(category: string): { block: string; border: string } {
    const normalized = category.toLowerCase();
    if (normalized.includes("cs") || normalized.includes("fundamental")) {
        return {
            block: "bg-blue-50/90 text-blue-700 dark:bg-blue-500/15 dark:text-blue-200",
            border: "#3B82F6",
        };
    }
    if (normalized.includes("sql")) {
        return {
            block: "bg-purple-50/90 text-purple-700 dark:bg-purple-500/15 dark:text-purple-200",
            border: "#A855F7",
        };
    }
    if (normalized.includes("system") || normalized.includes("design")) {
        return {
            block: "bg-amber-50/90 text-amber-700 dark:bg-amber-500/15 dark:text-amber-200",
            border: "#F59E0B",
        };
    }
    // Default: DSA/Coding
    return {
        block: "bg-indigo-50/90 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-200",
        border: "#6366F1",
    };
}

function getCategoryLabel(category: string): string {
    const normalized = category.toLowerCase();
    if (normalized.includes("cs") || normalized.includes("fundamental")) return "CS Fundamentals";
    if (normalized.includes("sql")) return "SQL";
    if (normalized.includes("system") || normalized.includes("design")) return "System Design";
    return "DSA";
}

export function ActionPlanCalendar({
    startDate,
    endDate,
    totalDays,
    currentDay,
    completedDays,
    days = [],
    onDayClick,
    showViewPlanLabel = false,
    previewMode = false,
}: ActionPlanCalendarProps) {
    const [currentMonth, setCurrentMonth] = useState(new Date(startDate));

    // Generate calendar days
    const generateCalendar = (): CalendarDay[] => {
        const year = currentMonth.getFullYear();
        const month = currentMonth.getMonth();

        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const startDayOfWeek = firstDay.getDay();
        const daysInMonth = lastDay.getDate();

        const calendarDays: CalendarDay[] = [];
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Previous month days
        const prevMonthLastDay = new Date(year, month, 0).getDate();
        for (let i = startDayOfWeek - 1; i >= 0; i--) {
            const date = new Date(year, month - 1, prevMonthLastDay - i);
            calendarDays.push({
                date,
                dayNumber: null,
                status: "none",
                isToday: false,
                isCurrentMonth: false,
            });
        }

        // Current month days
        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(year, month, day);
            date.setHours(0, 0, 0, 0);

            // Calculate day number in plan
            let dayNumber: number | null = null;
            let status: DayStatus = "none";
            let plan: DayPlan | undefined;

            if (date >= startDate && date <= endDate) {
                const diffTime = date.getTime() - startDate.getTime();
                const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
                dayNumber = diffDays + 1;

                // Find the plan for this day
                plan = days.find(d => d.dayNumber === dayNumber);

                if (!previewMode && completedDays.includes(dayNumber)) {
                    status = "completed";
                } else if (!previewMode && dayNumber === currentDay) {
                    status = "current";
                } else {
                    status = "upcoming";
                }
            }

            calendarDays.push({
                date,
                dayNumber,
                status,
                isToday: date.getTime() === today.getTime(),
                isCurrentMonth: true,
                plan,
            });
        }

        // Next month days to fill the grid
        const remainingDays = 42 - calendarDays.length; // 6 rows * 7 days
        for (let day = 1; day <= remainingDays; day++) {
            const date = new Date(year, month + 1, day);
            calendarDays.push({
                date,
                dayNumber: null,
                status: "none",
                isToday: false,
                isCurrentMonth: false,
            });
        }

        return calendarDays;
    };

    const calendarDays = generateCalendar();
    const monthName = currentMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" });

    const goToPreviousMonth = () => {
        setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1));
    };

    const goToNextMonth = () => {
        setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1));
    };

    const handleDayClick = (day: CalendarDay) => {
        if (day.dayNumber && day.status !== "none") {
            onDayClick(day.dayNumber);
        }
    };

    // Calculate question counts by category for each day
    const getDayTags = (plan?: DayPlan) => {
        if (!plan?.questions) return [];

        const tags: Array<{ category: string; count: number }> = [];
        
        if (plan.questions.dsa && plan.questions.dsa.length > 0) {
            tags.push({ category: "dsa", count: plan.questions.dsa.length });
        }
        if (plan.questions.csFundamentals && plan.questions.csFundamentals.length > 0) {
            tags.push({ category: "cs_fundamentals", count: plan.questions.csFundamentals.length });
        }
        if (plan.questions.sql && plan.questions.sql.length > 0) {
            tags.push({ category: "sql", count: plan.questions.sql.length });
        }
        if (plan.questions.systemDesign && plan.questions.systemDesign.length > 0) {
            tags.push({ category: "system_design", count: plan.questions.systemDesign.length });
        }

        return tags;
    };

    return (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-lc-border dark:bg-lc-elevated">
            {/* Header */}
            <div className="border-b border-slate-200 p-5 dark:border-lc-border">
                <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-[22px] font-bold text-slate-800 dark:text-white font-nunito tracking-tight">
                        {monthName}
                    </h3>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={goToPreviousMonth}
                            className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 dark:border-white/15 dark:bg-[#1a1a1a] dark:text-[#d7d7d7]"
                        >
                            <ChevronLeft className="h-5 w-5" />
                        </button>
                        <button
                            onClick={goToNextMonth}
                            className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 dark:border-white/15 dark:bg-[#1a1a1a] dark:text-[#d7d7d7]"
                        >
                            <ChevronRight className="h-5 w-5" />
                        </button>
                    </div>
                </div>

                <p className="text-xs text-slate-500 dark:text-slate-400">
                    Day {currentDay} of {totalDays} • {completedDays.length} completed
                </p>
            </div>

            {/* Calendar Grid */}
            <div className="p-4">
                {/* Day headers */}
                <div className="mb-2 grid grid-cols-7">
                    {["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].map((day) => (
                        <div
                            key={day}
                            className="px-2 py-1 text-center text-[12px] font-bold uppercase tracking-[0.2em] text-slate-500 dark:text-[#b6b8cf]"
                        >
                            {day}
                        </div>
                    ))}
                </div>

                {/* Calendar days - Box grid style like dashboard */}
                <div className="grid grid-cols-7 border-l border-t border-slate-200 dark:border-white/10">
                    {calendarDays.map((day, index) => {
                        const tags = getDayTags(day.plan);
                        const isFuture = day.date > new Date();
                        const hasEvents = day.dayNumber && day.status !== "none";

                        return (
                            <div
                                key={index}
                                onClick={() => hasEvents && handleDayClick(day)}
                                className={`min-h-[120px] border-r border-b border-slate-200 dark:border-white/10 p-3 transition-all relative ${
                                    !day.isCurrentMonth
                                        ? "bg-slate-50/50 opacity-60 dark:bg-[#1a1a1a]"
                                        : day.status === "completed"
                                            ? "bg-emerald-50/50 dark:bg-emerald-500/5"
                                            : day.status === "current"
                                                ? "bg-primary/5 dark:bg-primary/10"
                                                : day.status === "upcoming"
                                                    ? "bg-white dark:bg-[#1f1f1f]"
                                                    : "bg-white dark:bg-[#1f1f1f]"
                                } ${
                                    hasEvents
                                        ? "cursor-pointer hover:border-primary/50 dark:hover:border-primary/50 hover:scale-[1.02] hover:shadow-[0_8px_30px_rgba(0,0,0,0.12)] hover:z-10"
                                        : ""
                                }`}
                            >
                                {/* Date number */}
                                <div className="flex items-center justify-between mb-2">
                                    <p
                                        className={`text-[13px] font-bold ${
                                            day.isToday
                                                ? "bg-primary text-white w-6 h-6 flex items-center justify-center rounded-full"
                                                : day.isCurrentMonth
                                                    ? "text-slate-600 dark:text-[#b6b8cf] px-1"
                                                    : "text-slate-400 dark:text-slate-600 px-1"
                                        }`}
                                    >
                                        {day.date.getDate()}
                                    </p>
                                </div>

                                {/* Question tags */}
                                <div className="space-y-1.5">
                                    {tags.slice(0, 2).map((tag) => {
                                        const style = getCategoryStyle(tag.category);
                                        return (
                                            <div
                                                key={tag.category}
                                                className={`w-full rounded-[10px] border-l-4 px-2.5 py-1.5 text-left text-[11px] font-semibold ${style.block}`}
                                                style={{ borderLeftColor: style.border }}
                                            >
                                                <p className="truncate font-bold tracking-tight">
                                                    {getCategoryLabel(tag.category)}: {tag.count}
                                                </p>
                                            </div>
                                        );
                                    })}
                                    {tags.length > 2 && (
                                        <div className="text-[10px] font-semibold text-slate-400 pl-1 mt-1">
                                            +{tags.length - 2} more
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
