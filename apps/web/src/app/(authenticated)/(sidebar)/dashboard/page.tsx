"use client";

import { useAuth } from "@/context/auth-context";
import { useEffect, useState, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Footer } from "@/components/footer";
import { INTERVIEW_TYPE_MAP } from "@interviewforge/shared";
import { api } from "@/lib/api";
import { PhoneVerificationBanner } from "@/components/auth/PhoneVerificationBanner";
import { useActiveActionPlan } from "@/hooks/use-action-plan";

interface RubricScore {
    category: string;
    score: number;
    feedback: string;
}

interface RecentReport {
    id: string;
    overallScore: number;
    generatedAt: string;
    rubricScores: RubricScore[];
    session: {
        id: string;
        role: string;
        level: string;
        type: string;
    };
}

interface DashboardStats {
    totalSessions: number;
    completedSessions: number;
    avgScore: number;
    bestScore: number;
    recentReports: RecentReport[];
}

interface ResumeAnalysis {
    overallStrength?: string;
    summary?: { name?: string; currentRole?: string };
    strengths?: string[];
    weaknesses?: string[];
}

interface Resume {
    id: string;
    fileName: string;
    analysis: ResumeAnalysis | null;
    atsAnalysis: { overallScore?: number } | null;
    uploadedAt: string;
}

interface AcceptedActionPlanItem {
    id: string;
    reportId: string;
    sessionId: string;
    timespan: "1_week" | "2_weeks" | "monthly";
    label: string;
    startDate: string;
    endDate: string;
    acceptedAt: string;
    actionPlan: {
        priorityFocus?: string;
        plannedDays?: Array<{
            day: number;
            focus: string;
            questionCount: number;
            questionTags: Array<{ category: string; count: number }>;
            questions: Array<{
                id: string;
                title: string;
                category: string;
                solveUrl: string | null;
                problemSlug?: string;
            }>;
        }>;
    };
}

function startOfDay(date: Date): Date {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}

function getDateKey(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

function normalizePlannerCategory(category: string): "cs_fundamentals" | "coding_questions" | "behavioral_questions" | "system_design_questions" {
    const c = String(category || "").toLowerCase();
    if (c === "cs_fundamentals" || c === "cs fundamentals" || c === "os" || c === "cn" || c === "dbms" || c === "oops") return "cs_fundamentals";
    if (c === "behavioral" || c === "behavioural" || c === "project" || c === "communication") return "behavioral_questions";
    if (c === "system_design" || c === "system design") return "system_design_questions";
    return "coding_questions";
}

function plannerCategoryLabel(category: string): string {
    const normalized = normalizePlannerCategory(category);
    if (normalized === "cs_fundamentals") return "CS Fundamentals";
    if (normalized === "coding_questions") return "Coding Questions";
    if (normalized === "behavioral_questions") return "Behavioral Questions";
    return "System Design Questions";
}

function plannerCategoryStyle(category: string): { chip: string; block: string; border: string } {
    const normalized = normalizePlannerCategory(category);
    if (normalized === "cs_fundamentals") {
        return {
            chip: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300",
            block: "bg-blue-50/90 text-blue-700 dark:bg-blue-500/15 dark:text-blue-200",
            border: "#3B82F6",
        };
    }
    if (normalized === "coding_questions") {
        return {
            chip: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300",
            block: "bg-indigo-50/90 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-200",
            border: "#6366F1",
        };
    }
    if (normalized === "behavioral_questions") {
        return {
            chip: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
            block: "bg-emerald-50/90 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200",
            border: "#10B981",
        };
    }
    return {
        chip: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
        block: "bg-amber-50/90 text-amber-700 dark:bg-amber-500/15 dark:text-amber-200",
        border: "#F59E0B",
    };
}

function shortQuestionTitle(text: string): string {
    const plain = String(text || "")
        .replace(/\[[^\]]+\]\([^\)]+\)/g, "")
        .replace(/\*\*/g, "")
        .replace(/`/g, "")
        .replace(/\s+/g, " ")
        .trim();
    const firstSentence = plain.split(/[.?!]/)[0] || plain;
    return firstSentence.length > 90 ? `${firstSentence.slice(0, 87)}...` : firstSentence;
}

function formatTagList(tags: string[]): string {
    if (tags.length === 0) return "your scheduled topics";
    if (tags.length === 1) return tags[0];
    if (tags.length === 2) return `${tags[0]} and ${tags[1]}`;
    return `${tags.slice(0, -1).join(", ")} and ${tags[tags.length - 1]}`;
}

function slugFromQuestionText(text: string): string {
    const plain = String(text || "").replace(/\s+/g, " ").trim();
    const head = plain.split(":")[0] || plain;
    const slug = head
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return slug || "coding-question";
}

function strengthToScore(strength?: string): number {
    if (!strength) return 0;
    const s = strength.toLowerCase();
    if (s === "strong") return 85;
    if (s === "moderate") return 60;
    return 35; // weak
}

const interviewTypeLabels = Object.fromEntries(
    Object.entries(INTERVIEW_TYPE_MAP).map(([k, v]) => [
        k,
        v.label.toLowerCase().includes("interview") ? v.label : `${v.label} Interview`,
    ])
) as Record<string, string>;

// Matches resume report page thresholds: >70 green, >=40 amber, <40 red
function scoreColor(score: number) {
    if (score > 70) return { bg: "bg-emerald-500", bgFaded: "bg-emerald-50 dark:bg-emerald-500/10", text: "text-emerald-600 dark:text-emerald-400", border: "border-emerald-200 dark:border-emerald-500/20" };
    if (score >= 40) return { bg: "bg-amber-400", bgFaded: "bg-amber-50 dark:bg-amber-500/10", text: "text-amber-600 dark:text-amber-400", border: "border-amber-200 dark:border-amber-500/20" };
    return { bg: "bg-red-500", bgFaded: "bg-red-50 dark:bg-red-500/10", text: "text-red-600 dark:text-red-400", border: "border-red-200 dark:border-red-500/20" };
}


/* ─── Streak Calendar ─── */
function StreakCalendar({ activityDates }: { activityDates: Set<string> }) {
    const [currentDate, setCurrentDate] = useState(new Date());

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const today = new Date();

    const monthName = currentDate.toLocaleDateString("en-US", { month: "long" });
    const dayOfMonth = today.getMonth() === month && today.getFullYear() === year ? today.getDate() : -1;

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const streakDays = useMemo(() => {
        const set = new Set<number>();
        for (let d = 1; d <= daysInMonth; d++) {
            const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
            if (activityDates.has(dateStr)) set.add(d);
        }
        return set;
    }, [month, year, daysInMonth, activityDates]);

    const weeks: (number | null)[][] = [];
    let week: (number | null)[] = Array(firstDay).fill(null);
    for (let d = 1; d <= daysInMonth; d++) {
        week.push(d);
        if (week.length === 7) {
            weeks.push(week);
            week = [];
        }
    }
    if (week.length > 0) {
        while (week.length < 7) week.push(null);
        weeks.push(week);
    }
    // Always render 6 rows so card height stays constant
    while (weeks.length < 6) {
        weeks.push(Array(7).fill(null));
    }

    const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
    const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));

    const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    return (
        <div className="glass-card p-5 pb-3 h-full flex flex-col">
            <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-bold text-slate-900 dark:text-white font-nunito">
                    {monthName} {today.getMonth() === month && today.getFullYear() === year ? today.getDate() : ""}
                </h2>
                <div className="flex items-center gap-1">
                    <button onClick={prevMonth} className="p-1.5 hover:bg-slate-100 dark:hover:bg-lc-hover transition-colors">
                        <span className="material-symbols-outlined text-[18px] text-slate-500 dark:text-[#ababab]">chevron_left</span>
                    </button>
                    <button onClick={nextMonth} className="p-1.5 hover:bg-slate-100 dark:hover:bg-lc-hover transition-colors">
                        <span className="material-symbols-outlined text-[18px] text-slate-500 dark:text-[#ababab]">chevron_right</span>
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-7 mb-2">
                {dayLabels.map((d) => (
                    <div key={d} className="text-center text-xs font-bold text-slate-700 dark:text-slate-300 py-1 font-nunito">
                        {d}
                    </div>
                ))}
            </div>

            <div className="flex-1 flex flex-col gap-2 justify-between mt-2 mb-0">
                {weeks.map((w, wi) => (
                    <div key={wi} className="grid grid-cols-7">
                        {w.map((day, di) => {
                            const isToday = day === dayOfMonth;
                            const hasStreak = day !== null && streakDays.has(day) && !isToday;
                            return (
                                <div key={di} className="flex items-center justify-center py-0.5">
                                    {day !== null ? (
                                        <div
                                            className={`
                                                w-7 h-7 flex items-center justify-center rounded-full text-sm transition-colors font-nunito
                                                ${isToday
                                                    ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-bold ring-1 ring-emerald-500/30"
                                                    : hasStreak
                                                        ? "bg-emerald-500 text-white font-semibold"
                                                        : "text-slate-800 dark:text-slate-200 font-medium"
                                                }
                                            `}
                                        >
                                            {day}
                                        </div>
                                    ) : (
                                        <div className="w-7 h-7" />
                                    )}
                                </div>
                            );
                        })}
                    </div>
                ))}
            </div>

        </div>
    );
}

function ActionPlanCalendar() {
    const { data, isLoading } = useActiveActionPlan();
    const [calendarMonthStart, setCalendarMonthStart] = useState<Date>(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
    const [hoveredDate, setHoveredDate] = useState<Date | null>(null);
    const [isMonthPickerOpen, setIsMonthPickerOpen] = useState(false);
    const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);

    const monthPickerRef = useRef<HTMLDivElement>(null);

    const plans = useMemo<AcceptedActionPlanItem[]>(() => {
        console.log('[Dashboard] useActiveActionPlan data:', data);
        
        if (!data?.plan) {
            console.log('[Dashboard] No plan data found');
            return [];
        }

        const content = data.plan.content as any;
        console.log('[Dashboard] Plan content:', content);
        console.log('[Dashboard] Has plannedDays?', !!content?.plannedDays, 'Length:', content?.plannedDays?.length);
        console.log('[Dashboard] Has days?', !!content?.days, 'Length:', content?.days?.length);
        
        // The API returns actionPlan that was already normalized when saved
        // It should have plannedDays array. If not, try to convert from days array.
        let actionPlanContent: AcceptedActionPlanItem["actionPlan"] = content || {};
        
        // Only convert if plannedDays is missing or empty, but days array exists
        if ((!content?.plannedDays || content.plannedDays.length === 0) && content?.days && Array.isArray(content.days) && content.days.length > 0) {
            console.log('[Dashboard] Converting days array to plannedDays format', content.days);
            actionPlanContent = {
                ...content,
                priorityFocus: content.priorityFocus || content.summary,
                plannedDays: content.days.map((day: any) => ({
                    day: day.dayNumber,
                    focus: day.title || day.focusAreas?.join(", ") || "Practice",
                    questionCount: day.questions ? 
                        (day.questions.dsa?.length || 0) + 
                        (day.questions.csFundamentals?.length || 0) + 
                        (day.questions.sql?.length || 0) + 
                        (day.questions.systemDesign?.length || 0) : 0,
                    questionTags: [
                        ...(day.questions?.dsa?.length ? [{ category: "coding_questions", count: day.questions.dsa.length }] : []),
                        ...(day.questions?.csFundamentals?.length ? [{ category: "cs_fundamentals", count: day.questions.csFundamentals.length }] : []),
                        ...(day.questions?.sql?.length ? [{ category: "coding_questions", count: day.questions.sql.length }] : []),
                        ...(day.questions?.systemDesign?.length ? [{ category: "system_design_questions", count: day.questions.systemDesign.length }] : []),
                    ],
                    questions: [
                        ...(day.questions?.dsa || []).map((q: any) => ({
                            id: q.id,
                            title: q.title,
                            category: "coding_questions",
                            solveUrl: q.solveUrl,
                            problemSlug: q.slug,
                        })),
                        ...(day.questions?.csFundamentals || []).map((q: any) => ({
                            id: q.id,
                            title: q.title,
                            category: "cs_fundamentals",
                            solveUrl: q.solveUrl,
                        })),
                        ...(day.questions?.sql || []).map((q: any) => ({
                            id: q.id,
                            title: q.title,
                            category: "coding_questions",
                            solveUrl: q.solveUrl,
                        })),
                        ...(day.questions?.systemDesign || []).map((q: any) => ({
                            id: q.id,
                            title: q.title,
                            category: "system_design_questions",
                            solveUrl: q.solveUrl,
                        })),
                    ],
                })),
            };
        }
        
        console.log('[Dashboard] Final actionPlanContent:', actionPlanContent);
        console.log('[Dashboard] plannedDays count:', actionPlanContent?.plannedDays?.length || 0);

        return [
            {
                id: data.plan.id,
                reportId: data.plan.reportId,
                sessionId: data.plan.sessionId,
                timespan:
                    data.plan.totalDays && data.plan.totalDays <= 7
                        ? "1_week"
                        : data.plan.totalDays && data.plan.totalDays <= 14
                            ? "2_weeks"
                            : "monthly",
                label: data.plan.title,
                startDate: data.plan.startDate,
                endDate: data.plan.endDate,
                acceptedAt: data.plan.startDate,
                actionPlan: actionPlanContent,
            },
        ];
    }, [data]);

    const loading = isLoading;

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (monthPickerRef.current && !monthPickerRef.current.contains(event.target as Node)) {
                setIsMonthPickerOpen(false);
            }
        };
        if (isMonthPickerOpen) {
            document.addEventListener("mousedown", handleClickOutside);
        }
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [isMonthPickerOpen]);

    const plannedByDayKey = useMemo(() => {
        const grouped: Record<string, Array<{ plan: AcceptedActionPlanItem; plannedDay: NonNullable<AcceptedActionPlanItem["actionPlan"]["plannedDays"]>[number] }>> = {};
        for (const plan of plans) {
            const plannedDays = Array.isArray(plan.actionPlan?.plannedDays) ? plan.actionPlan.plannedDays : [];
            if (plannedDays.length === 0) {
                const key = getDateKey(new Date(plan.acceptedAt));
                if (!grouped[key]) grouped[key] = [];
                grouped[key].push({
                    plan,
                    plannedDay: {
                        day: 1,
                        focus: plan.actionPlan?.priorityFocus || "Practice",
                        questionCount: 0,
                        questionTags: [],
                        questions: [],
                    },
                });
                continue;
            }

            const planStart = startOfDay(new Date(plan.startDate));
            for (const day of plannedDays) {
                const targetDate = new Date(planStart);
                targetDate.setDate(planStart.getDate() + Math.max(0, day.day - 1));
                const key = getDateKey(targetDate);
                if (!grouped[key]) grouped[key] = [];
                grouped[key].push({ plan, plannedDay: day });
            }
        }
        return grouped;
    }, [plans]);

    const selectedDayEntries = selectedDateKey ? plannedByDayKey[selectedDateKey] || [] : [];

    // Fetch solved question IDs from the practice system
    const [solvedQuestionIds, setSolvedQuestionIds] = useState<Set<string>>(new Set());
    useEffect(() => {
        const fetchProgress = async () => {
            try {
                const { data: sessionData } = await (await import("@/lib/supabase")).createSupabaseBrowserClient().auth.getSession();
                const token = sessionData.session?.access_token;
                if (!token) return;
                const res = await api.get<{ success: boolean; data: { progress: Record<string, { status: string }> } }>("/ide/progress", token);
                if (res.success && res.data?.progress) {
                    const solved = new Set<string>();
                    for (const [id, p] of Object.entries(res.data.progress)) {
                        if (p.status === "solved") solved.add(id);
                    }
                    setSolvedQuestionIds(solved);
                }
            } catch {}
        };
        fetchProgress();
    }, []);
    const selectedDayTagLabels = Array.from(
        new Set(
            selectedDayEntries.flatMap((entry) =>
                (entry.plannedDay.questionTags || []).map((tag) => plannerCategoryLabel(tag.category))
            )
        )
    );

    const shiftMonth = (delta: number) => {
        setCalendarMonthStart((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
    };

    const weekDays = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

    const monthlyCells = useMemo(() => {
        const start = new Date(calendarMonthStart.getFullYear(), calendarMonthStart.getMonth(), 1);
        const dayOfWeek = start.getDay();
        const gridStart = new Date(start);
        gridStart.setDate(start.getDate() - dayOfWeek);

        return Array.from({ length: 42 }).map((_, idx) => {
            const date = new Date(gridStart);
            date.setDate(gridStart.getDate() + idx);
            return {
                date,
                isCurrentMonth: date.getMonth() === calendarMonthStart.getMonth(),
            };
        });
    }, [calendarMonthStart]);

    return (
        <div className="glass-card p-5">
            <div className="flex items-center gap-3 px-2">
                <h2 className="text-[18px] font-bold text-slate-800 dark:text-white font-nunito tracking-tight text-left">Action Plan Calendar</h2>
            </div>
            <div className="p-2 md:p-4 min-h-[500px]">
                <div className="flex flex-col gap-6">
                    <div className="flex items-center justify-between">
                        <div className="relative" ref={monthPickerRef}>
                            <h3
                                className="text-[22px] font-bold text-slate-800 dark:text-white font-nunito tracking-tight cursor-pointer hover:text-primary transition-colors flex items-center gap-1 select-none"
                                onClick={() => setIsMonthPickerOpen(!isMonthPickerOpen)}
                            >
                                {hoveredDate
                                    ? hoveredDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                                    : calendarMonthStart.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
                                <span className="material-symbols-outlined text-[20px] opacity-70">arrow_drop_down</span>
                            </h3>

                            {isMonthPickerOpen && (
                                <div className="absolute top-10 left-0 z-50 bg-white dark:bg-[#1a1a1a] border border-slate-200/80 dark:border-white/10 rounded-2xl shadow-[0_8px_30px_rgba(0,0,0,0.12)] p-2 w-[280px] flex gap-2 animate-in fade-in zoom-in-95 duration-200">
                                    <div className="flex-1 max-h-[220px] overflow-y-auto overflow-x-hidden [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] flex flex-col p-1 gap-0.5">
                                        {Array.from({ length: 12 }).map((_, i) => {
                                            const monthDate = new Date(calendarMonthStart.getFullYear(), i, 1);
                                            const isSelected = calendarMonthStart.getMonth() === i;
                                            return (
                                                <button
                                                    key={`month-${i}`}
                                                    onClick={() => setCalendarMonthStart(new Date(calendarMonthStart.getFullYear(), i, 1))}
                                                    className={`px-3 py-2 text-left text-[13px] font-bold rounded-xl transition-colors ${
                                                        isSelected
                                                            ? "bg-primary text-white"
                                                            : "text-slate-600 hover:bg-slate-100 dark:text-[#c0c3de] dark:hover:bg-white/5"
                                                    }`}
                                                >
                                                    {monthDate.toLocaleDateString("en-US", { month: "short" })}
                                                </button>
                                            );
                                        })}
                                    </div>
                                    <div className="w-px bg-slate-100 dark:bg-white/5 my-1" />
                                    <div className="flex-1 max-h-[220px] overflow-y-auto overflow-x-hidden [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] flex flex-col p-1 gap-0.5">
                                        {Array.from({ length: 10 }).map((_, i) => {
                                            const currentYear = new Date().getFullYear();
                                            const year = currentYear - 9 + i;
                                            const isSelected = calendarMonthStart.getFullYear() === year;
                                            return (
                                                <button
                                                    key={`year-${year}`}
                                                    onClick={() => {
                                                        setCalendarMonthStart(new Date(year, calendarMonthStart.getMonth(), 1));
                                                        setIsMonthPickerOpen(false);
                                                    }}
                                                    className={`px-3 py-2 text-left text-[13px] font-bold rounded-xl transition-colors ${
                                                        isSelected
                                                            ? "bg-primary text-white"
                                                            : "text-slate-600 hover:bg-slate-100 dark:text-[#c0c3de] dark:hover:bg-white/5"
                                                    }`}
                                                >
                                                    {year}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="flex items-center gap-2">
                            <button onClick={() => shiftMonth(-1)} className="flex items-center justify-center w-9 h-9 rounded-xl border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 dark:border-white/15 dark:bg-[#1a1a1a] dark:text-[#d7d7d7]">
                                <span className="material-symbols-outlined text-[20px]">chevron_left</span>
                            </button>
                            <button onClick={() => shiftMonth(1)} className="flex items-center justify-center w-9 h-9 rounded-xl border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 dark:border-white/15 dark:bg-[#1a1a1a] dark:text-[#d7d7d7]">
                                <span className="material-symbols-outlined text-[20px]">chevron_right</span>
                            </button>
                        </div>
                    </div>

                    <div className="overflow-x-auto overflow-y-hidden [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] pb-1">
                        <div className="min-w-[900px]">
                            <div className="mb-2 grid" style={{ gridTemplateColumns: "repeat(7, minmax(130px, 1fr))" }}>
                                {weekDays.map((day) => (
                                    <div key={day} className="px-2 py-1 text-center text-[12px] font-bold uppercase tracking-[0.2em] text-slate-500 dark:text-[#b6b8cf]">
                                        {day}
                                    </div>
                                ))}
                            </div>

                            <div className="grid border-l border-t border-slate-200 dark:border-white/10" style={{ gridTemplateColumns: "repeat(7, minmax(130px, 1fr))" }}>
                                {monthlyCells.map((cell) => {
                                    const dateKey = getDateKey(cell.date);
                                    const events = plannedByDayKey[dateKey] || [];
                                    const isFuture = startOfDay(cell.date) > startOfDay(new Date());
                                    const tagCounts = new Map<string, number>();
                                    for (const entry of events) {
                                        for (const tag of entry.plannedDay.questionTags || []) {
                                            const normalizedCategory = normalizePlannerCategory(tag.category);
                                            const next = (tagCounts.get(normalizedCategory) || 0) + Number(tag.count || 0);
                                            tagCounts.set(normalizedCategory, next);
                                        }
                                    }
                                    const tags = Array.from(tagCounts.entries()).map(([category, count]) => ({ category, count }));
                                    const dayQuestionIds = events.flatMap(e => (e.plannedDay.questions || []).map(q => q.id));
                                    const isDayCompleted = dayQuestionIds.length > 0 && dayQuestionIds.every(id => solvedQuestionIds.has(id));
                                    return (
                                        <div
                                            key={dateKey}
                                            onMouseEnter={() => !isFuture && setHoveredDate(cell.date)}
                                            onMouseLeave={() => !isFuture && setHoveredDate(null)}
                                            onClick={() => {
                                                if (!isFuture && events.length > 0) setSelectedDateKey(dateKey);
                                            }}
                                            className={`min-h-[120px] border-r border-b border-slate-200 dark:border-white/10 p-3 transition-all relative z-0 ${
                                                isFuture
                                                    ? "bg-slate-50/20 opacity-30 cursor-not-allowed dark:bg-[#111111]"
                                                    : `hover:border-primary/50 dark:hover:border-primary/50 hover:scale-[1.02] hover:shadow-[0_8px_30px_rgba(0,0,0,0.12)] hover:z-10 ${events.length > 0 ? "cursor-pointer" : ""}`
                                            } ${
                                                isDayCompleted
                                                    ? "bg-emerald-100 dark:bg-emerald-500/15"
                                                    : cell.isCurrentMonth
                                                        ? "bg-white dark:bg-[#1f1f1f]"
                                                        : "bg-slate-50/50 lg:opacity-60 dark:bg-[#1a1a1a]"
                                            }`}
                                        >
                                            <div className="flex items-center justify-between mb-2">
                                                <p className={`text-[13px] font-bold ${getDateKey(new Date()) === dateKey ? "bg-primary text-white w-6 h-6 flex items-center justify-center rounded-full" : "text-slate-600 dark:text-[#b6b8cf] px-1"}`}>
                                                    {cell.date.getDate()}
                                                </p>
                                            </div>
                                            <div className="space-y-1.5">
                                                        {loading ? null : (
                                                    <>
                                                        {tags.slice(0, 2).map((tag) => (
                                                            <div
                                                                key={`${dateKey}-${tag.category}`}
                                                                className={`w-full rounded-[10px] border-l-4 px-2.5 py-1.5 text-left text-[11px] font-semibold ${plannerCategoryStyle(tag.category).block}`}
                                                                style={{ borderLeftColor: plannerCategoryStyle(tag.category).border }}
                                                            >
                                                                <p className="truncate font-bold tracking-tight">{plannerCategoryLabel(tag.category)}: {tag.count}</p>
                                                            </div>
                                                        ))}
                                                        {tags.length > 2 && (
                                                            <div className="text-[10px] font-semibold text-slate-400 pl-1 mt-1">+{tags.length - 2} more tags</div>
                                                        )}
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {selectedDateKey && (
                <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/45 p-4" onClick={() => setSelectedDateKey(null)}>
                    <div className="max-h-[84vh] w-full max-w-[56rem] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-white/10 dark:bg-[#1a1a1a]" onClick={(e) => e.stopPropagation()}>
                        <div className="mb-4 flex items-center justify-between">
                            <div>
                                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Daily Plan</p>
                                <h3 className="text-lg font-bold text-slate-900 dark:text-white">{new Date(selectedDateKey).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}</h3>
                            </div>
                            <button onClick={() => setSelectedDateKey(null)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-white/10 dark:hover:text-slate-200">
                                <span className="material-symbols-outlined text-[18px]">close</span>
                            </button>
                        </div>

                        <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-50/80 px-5 py-4 text-base leading-relaxed text-slate-700 shadow-sm dark:border-white/10 dark:bg-white/5 dark:text-slate-200">
                            <p className="pl-1">
                                For today's action plan you have <span className="font-semibold">{formatTagList(selectedDayTagLabels)}</span> to practice.
                            </p>
                            <p className="mt-1.5 pl-1">Given below is the question sheet for today.</p>
                        </div>

                        <div className="rounded-2xl border border-slate-200 dark:border-white/10 overflow-hidden">
                            <div className="flex items-center justify-between px-6 py-4 bg-slate-50/80 dark:bg-white/5">
                                <p className="text-lg font-bold text-slate-900 dark:text-white">Daily Question Set</p>
                                <p className="text-base font-bold text-slate-500 dark:text-slate-300">
                                    {(() => {
                                        const allIds = selectedDayEntries.flatMap(e => (e.plannedDay.questions || []).map(q => q.id));
                                        const done = allIds.filter(id => solvedQuestionIds.has(id)).length;
                                        return `${done} / ${allIds.length}`;
                                    })()}
                                </p>
                            </div>

                            <div className="px-6 py-3 border-t border-slate-200 dark:border-white/10 grid grid-cols-[1fr_120px_120px] gap-4 text-[12px] font-bold uppercase tracking-[0.15em] text-slate-400 dark:text-slate-500">
                                <p>Status Problem</p>
                                <p>Difficulty</p>
                                <p>Solve</p>
                            </div>

                            <div>
                                {selectedDayEntries.flatMap((entry, idx) =>
                                    (entry.plannedDay.questions || []).map((q) => ({
                                        key: `${entry.plan.id}-${idx}-${q.id}`,
                                        id: q.id,
                                        title: normalizePlannerCategory(q.category) === "coding_questions"
                                            ? String(q.problemSlug || slugFromQuestionText(q.title))
                                            : shortQuestionTitle(q.title),
                                        category: normalizePlannerCategory(q.category),
                                        solveUrl: q.solveUrl,
                                    }))
                                ).map((q, index) => {
                                    const isDone = solvedQuestionIds.has(q.id);
                                    return (
                                    <div key={q.key} className={`grid grid-cols-[1fr_120px_120px] gap-4 px-6 py-5 items-center border-t border-slate-200 dark:border-white/10 ${isDone ? "bg-emerald-100 dark:bg-emerald-500/15" : index % 2 === 0 ? "bg-white dark:bg-[#1a1a1a]" : "bg-slate-50/50 dark:bg-[#161616]"}`}>
                                        <div>
                                            <p className={`text-xl leading-none mb-1 ${isDone ? "text-emerald-500" : "text-slate-300 dark:text-slate-600"}`}>{isDone ? "●" : "○"}</p>
                                            <p className="text-xl font-semibold text-slate-900 dark:text-white leading-tight">{q.title}</p>
                                            <span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${plannerCategoryStyle(q.category).chip}`}>
                                                {plannerCategoryLabel(q.category)}
                                            </span>
                                        </div>
                                        <p className="text-lg font-bold text-amber-500">Medium</p>
                                        {q.solveUrl ? (
                                            <a href={q.solveUrl} className="inline-flex items-center justify-center rounded-2xl bg-blue-100 px-5 py-2.5 text-lg font-bold text-blue-600 hover:bg-blue-200 dark:bg-blue-500/20 dark:text-blue-300 dark:hover:bg-blue-500/30">
                                                Solve
                                            </a>
                                        ) : (
                                            <span className="inline-flex items-center justify-center rounded-2xl bg-slate-100 px-5 py-2.5 text-lg font-bold text-slate-400 dark:bg-white/10">Solve</span>
                                        )}
                                    </div>
                                    );
                                })}

                                {selectedDayEntries.every((entry) => !entry.plannedDay.questions || entry.plannedDay.questions.length === 0) && (
                                    <div className="px-6 py-8 border-t border-slate-200 dark:border-white/10">
                                        <p className="text-sm text-slate-500 dark:text-slate-400">No linked questions for this day.</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

/* ─── Performance Chart (SVG area chart) ─── */
function PerformanceChart({ data }: { data: { label: string; score: number }[] }) {
    const chartWidth = 600;
    const chartHeight = 200;
    const paddingX = 36;
    const paddingTop = 16;
    const paddingBottom = 14;

    const points = data.length > 0 ? data : [{ label: "—", score: 0 }];
    const maxScore = 100;
    const innerW = chartWidth - paddingX * 2;
    const innerH = chartHeight - paddingTop - paddingBottom;

    const coords = points.map((p, i) => ({
        x: paddingX + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW),
        y: paddingTop + innerH - (p.score / maxScore) * innerH,
        ...p,
    }));

    const linePath = coords.length === 1
        ? `M ${coords[0].x} ${coords[0].y} L ${coords[0].x} ${coords[0].y}`
        : coords.map((c, i) => {
            if (i === 0) return `M ${c.x} ${c.y}`;
            const prev = coords[i - 1];
            const cpx = (prev.x + c.x) / 2;
            return `C ${cpx} ${prev.y}, ${cpx} ${c.y}, ${c.x} ${c.y}`;
        }).join(" ");

    const areaPath = `${linePath} L ${coords[coords.length - 1].x} ${chartHeight - paddingBottom} L ${coords[0].x} ${chartHeight - paddingBottom} Z`;

    const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

    return (
        <svg viewBox={`0 0 ${chartWidth} ${chartHeight + 20}`} className="w-full h-auto block" preserveAspectRatio="xMidYMid meet">
            <defs>
                <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.2" />
                    <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0.01" />
                </linearGradient>
            </defs>

            {[0, 25, 50, 75, 100].map((v) => {
                const y = paddingTop + innerH - (v / maxScore) * innerH;
                return (
                    <g key={v}>
                        <line x1={paddingX} y1={y} x2={chartWidth - paddingX} y2={y} stroke="currentColor" className="text-slate-100 dark:text-lc-border" strokeWidth="1" />
                        <text x={paddingX - 6} y={y + 3} textAnchor="end" className="fill-slate-400 dark:fill-[#8a8a8a]" fontSize="9" fontFamily="Outfit, sans-serif">{v}</text>
                    </g>
                );
            })}

            {coords.length > 1 && <path d={areaPath} fill="url(#chartGrad)" />}
            <path d={linePath} fill="none" stroke="var(--color-primary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

            {coords.map((c, i) => (
                <g key={i} onMouseEnter={() => setHoveredIdx(i)} onMouseLeave={() => setHoveredIdx(null)} className="cursor-pointer">
                    <circle cx={c.x} cy={c.y} r="4" fill="var(--color-primary)" stroke="white" strokeWidth="2" />
                    {hoveredIdx === i && (
                        <>
                            <line x1={c.x} y1={c.y + 6} x2={c.x} y2={chartHeight - paddingBottom} stroke="var(--color-primary)" strokeWidth="1" strokeDasharray="4 3" opacity="0.35" />
                            <rect x={c.x - 26} y={c.y - 32} width="52" height="24" rx="5" fill="white" stroke="var(--color-primary)" strokeWidth="1" className="dark:fill-lc-surface" />
                            <text x={c.x} y={c.y - 18} textAnchor="middle" fontSize="11" fontWeight="700" className="fill-slate-900 dark:fill-white" fontFamily="Outfit, sans-serif">{c.score.toFixed(2)}</text>
                            <text x={c.x} y={c.y - 9} textAnchor="middle" fontSize="8" className="fill-slate-400 dark:fill-[#ababab]" fontFamily="Outfit, sans-serif">/100</text>
                        </>
                    )}
                </g>
            ))}

            {coords.map((c, i) => (
                <text key={i} x={c.x} y={chartHeight - paddingBottom + 14} textAnchor="middle" fontSize="10" className="fill-slate-400 dark:fill-[#8a8a8a]" fontFamily="Outfit, sans-serif">
                    {c.label}
                </text>
            ))}
        </svg>
    );
}

type ChartRange = "week" | "month" | "year";

const DASHBOARD_CHART_RANGE_STORAGE_KEY = "dashboard.interviewPerformance.chartRange";

function isChartRange(value: string | null): value is ChartRange {
    return value === "week" || value === "month" || value === "year";
}

export default function DashboardPage() {
    useEffect(() => { document.title = "Dashboard | Mockr"; }, []);
    const { session: authSession, loading: authLoading, user } = useAuth();
    const router = useRouter();

    const [stats, setStats] = useState<DashboardStats | null>(null);
    const [resumes, setResumes] = useState<Resume[]>([]);
    const [activityDates, setActivityDates] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(true);
    const [resumesLoading, setResumesLoading] = useState(true);
    const [chartRange, setChartRange] = useState<ChartRange>(() => {
        if (typeof window === "undefined") return "month";
        const savedRange = window.localStorage.getItem(DASHBOARD_CHART_RANGE_STORAGE_KEY);
        return isChartRange(savedRange) ? savedRange : "month";
    });

    const handleChartRangeChange = (range: ChartRange) => {
        setChartRange(range);
        if (typeof window !== "undefined") {
            window.localStorage.setItem(DASHBOARD_CHART_RANGE_STORAGE_KEY, range);
        }
    };

    useEffect(() => {
        if (typeof window === "undefined") return;
        window.localStorage.setItem(DASHBOARD_CHART_RANGE_STORAGE_KEY, chartRange);
    }, [chartRange]);

    const userMetaData = authSession?.user?.user_metadata || {};
    const displayName = userMetaData.full_name || userMetaData.name || user?.fullName || "User";

    const fetchedRef = useRef(false);

    useEffect(() => {
        if (authLoading || !authSession) return;
        if (fetchedRef.current) return;
        fetchedRef.current = true;

        const token = authSession.access_token;
        if (!token) {
            setLoading(false);
            setResumesLoading(false);
            return;
        }

        const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

        fetch(`${API_BASE}/users/me/stats`, {
            headers: { Authorization: `Bearer ${token}` },
        })
            .then((res) => {
                if (!res.ok) throw new Error("Failed to fetch dashboard stats");
                return res.json();
            })
            .then((data) => setStats(data))
            .catch(() => {})
            .finally(() => setLoading(false));

        api.get<{ resumes: Resume[] }>("/resumes", token)
            .then((res) => setResumes(res.resumes || []))
            .catch(() => {})
            .finally(() => setResumesLoading(false));

        // Fetch activity dates for streak calendar
        fetch(`${API_BASE}/users/me/activity-dates?year=${new Date().getFullYear()}`, {
            headers: { Authorization: `Bearer ${token}` },
        })
            .then((res) => res.ok ? res.json() : { dates: [] })
            .then((data) => setActivityDates(new Set(data.dates || [])))
            .catch(() => {});

    }, [authLoading, authSession]);

    // Derived data
    let recentActivities: any[] = [];
    let chartData: { label: string; score: number }[] = [];
    let completedCount = 0;

    if (stats) {
        completedCount = stats.completedSessions;

        recentActivities = stats.recentReports.slice(0, 5).map((r) => ({
            id: r.id,
            sessionId: r.session.id,
            date: new Date(r.generatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
            time: new Date(r.generatedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
            score: Number(r.overallScore),
            label: interviewTypeLabels[r.session.type] || r.session.type,
        }));

        const now = new Date();
        now.setHours(23, 59, 59, 999);
        let cutoff: Date;
        
        let groupedData = new Map<string, { total: number; count: number }>();
        
        if (chartRange === "week") {
            cutoff = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
            cutoff.setHours(0, 0, 0, 0);
            
            // Initialize last 7 days
            for (let i = 0; i < 7; i++) {
                const d = new Date(cutoff.getTime() + i * 24 * 60 * 60 * 1000);
                const label = d.toLocaleDateString("en-US", { weekday: "short" });
                groupedData.set(label, { total: 0, count: 0 });
            }
            
            stats.recentReports.forEach((r) => {
                const d = new Date(r.generatedAt);
                if (d >= cutoff) {
                    const label = d.toLocaleDateString("en-US", { weekday: "short" });
                    if (groupedData.has(label)) {
                        const current = groupedData.get(label)!;
                        current.total += Number(r.overallScore);
                        current.count += 1;
                    }
                }
            });
            
        } else if (chartRange === "month") {
            cutoff = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
            cutoff.setHours(0, 0, 0, 0);
            
            // Initialize 5 weeks roughly
            for (let i = 0; i < 5; i++) {
                const d = new Date(now.getTime() - (4 - i) * 7 * 24 * 60 * 60 * 1000);
                const label = `W${i+1}`;
                groupedData.set(label, { total: 0, count: 0 });
            }
            
            stats.recentReports.forEach((r) => {
                const d = new Date(r.generatedAt);
                if (d >= cutoff) {
                    // figure out which week it belongs to based on diff
                    const diffDays = Math.floor((now.getTime() - d.getTime()) / (24 * 60 * 60 * 1000));
                    const wIdx = 4 - Math.min(4, Math.floor(diffDays / 7));
                    const label = `W${wIdx + 1}`;
                    if (groupedData.has(label)) {
                        const current = groupedData.get(label)!;
                        current.total += Number(r.overallScore);
                        current.count += 1;
                    }
                }
            });
            
        } else {
            cutoff = new Date(now.getFullYear(), now.getMonth() - 11, 1);
            
            // Initialize last 12 months
            for (let i = 0; i < 12; i++) {
                const d = new Date(cutoff.getFullYear(), cutoff.getMonth() + i, 1);
                const label = d.toLocaleDateString("en-US", { month: "short" });
                groupedData.set(label, { total: 0, count: 0 });
            }
            
            stats.recentReports.forEach((r) => {
                const d = new Date(r.generatedAt);
                if (d >= cutoff) {
                    const label = d.toLocaleDateString("en-US", { month: "short" });
                    if (groupedData.has(label)) {
                        const current = groupedData.get(label)!;
                        current.total += Number(r.overallScore);
                        current.count += 1;
                    }
                }
            });
        }

        // Fill empty periods with previous value to make the line continuous, or just 0
        let lastScore = 0;
        chartData = Array.from(groupedData.entries()).map(([label, { total, count }]) => {
            const score = count > 0 ? total / count : lastScore;
            if (count > 0) lastScore = score;
            return { label, score };
        });
    }

    // Derive score for each resume: prefer atsAnalysis.overallScore, else map overallStrength
    function getResumeScore(r: Resume): number | null {
        if (r.atsAnalysis?.overallScore != null) return r.atsAnalysis.overallScore;
        if (r.analysis?.overallStrength) return strengthToScore(r.analysis.overallStrength);
        return null;
    }
    const bestResumeScore = resumes
        .map((r) => getResumeScore(r))
        .filter((s): s is number => s !== null)
        .reduce((max, s) => Math.max(max, s), 0);

    if (authLoading) {
        return (
            <div className="flex-1 overflow-auto flex items-center justify-center">
                <div className="size-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    const getGreeting = () => {
        const hour = new Date().getHours();
        if (hour < 4) return "Good evening";
        if (hour < 12) return "Good morning";
        if (hour < 17) return "Good afternoon";
        return "Good evening";
    };

    return (
        <div className="flex-1 overflow-auto bg-slate-50/50 dark:bg-[#1a1a1a]">
            {/* Phone Verification Banner */}
            <PhoneVerificationBanner />
            
            <main className="p-8 max-w-7xl mx-auto space-y-6">
                {/* Greeting */}
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                    <div>
                        <h1 className="text-4xl font-extrabold text-slate-900 dark:text-white font-nunito">
                            {getGreeting()}, {displayName}
                        </h1>
                        <p className="text-slate-700 dark:text-[#d0d0d0] mt-1 text-sm font-semibold font-nunito">
                            {loading ? (
                                <span className="inline-block h-4 w-48 bg-slate-200 dark:bg-lc-hover rounded animate-pulse align-middle" />
                            ) : completedCount > 0 ? "Ready for your next interview?" : "Ready for your first interview?"}
                        </p>
                    </div>
                    <button
                        onClick={() => router.push("/interviews")}
                        className="bg-primary hover:bg-primary-dark text-white font-bold font-nunito py-3 px-6 rounded-xl shadow-lg shadow-primary/20 transition-all active:scale-[0.98] flex items-center justify-center gap-2 shrink-0"
                    >
                        <span className="material-symbols-outlined text-[20px]">play_arrow</span>
                        {loading ? (
                            <span className="inline-block h-4 w-32 bg-white/30 rounded animate-pulse" />
                        ) : completedCount > 0 ? "Start Next Interview" : "Start First Interview"}
                    </button>
                </div>

                {/* Row 1: Performance Chart + Calendar */}
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-stretch">
                    {/* Interview Performance */}
                    <div className="lg:col-span-3 glass-card p-5 flex flex-col">
                        <div className="flex items-center justify-between mb-2">
                            <h2 className="text-lg font-bold text-slate-900 dark:text-white font-nunito">
                                Interview Performance
                            </h2>
                            <div className="flex items-center border border-slate-200 dark:border-lc-border rounded-xl overflow-hidden">
                                {(["week", "month", "year"] as ChartRange[]).map((range) => (
                                    <button
                                        key={range}
                                        onClick={() => handleChartRangeChange(range)}
                                        className={`text-xs font-medium font-nunito px-3 py-1.5 transition-all capitalize border-0 !rounded-none ${
                                            chartRange === range
                                                ? "bg-slate-100 dark:bg-lc-hover text-slate-900 dark:text-white"
                                                : "text-slate-400 dark:text-[#8a8a8a] hover:text-slate-600 hover:bg-slate-50 dark:hover:bg-lc-hover/50"
                                        }`}
                                    >
                                        {range === "week" ? "Weekly" : range === "month" ? "Monthly" : "Yearly"}
                                    </button>
                                ))}
                            </div>
                        </div>
                        {loading ? (
                            <div className="flex-1 flex items-center justify-center">
                                <div className="h-32 w-full bg-slate-100 dark:bg-lc-hover rounded-xl animate-pulse" />
                            </div>
                        ) : chartData.length > 0 ? (
                            <div className="flex-1 flex items-end">
                                <PerformanceChart data={chartData} />
                            </div>
                        ) : (
                            <div className="flex-1 flex flex-col items-center justify-center text-center py-4">
                                <span className="material-symbols-outlined text-3xl text-slate-300 dark:text-slate-600 mb-2">show_chart</span>
                                <p className="text-sm font-semibold text-slate-700 dark:text-white mb-1 font-nunito">No performance data yet</p>
                                <p className="text-xs text-slate-400 dark:text-[#8a8a8a] mb-3">Complete your first interview to start tracking scores.</p>
                                <button
                                    onClick={() => router.push("/interviews")}
                                    className="text-xs font-semibold font-nunito text-primary border border-primary/30 px-4 py-1.5 rounded-xl hover:bg-primary/5 transition-colors"
                                >
                                    Start Interview
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Streak Calendar */}
                    <div className="lg:col-span-2">
                        <StreakCalendar activityDates={activityDates} />
                    </div>
                </div>

                {/* Row 2: Resume Analysis + Previous Interviews */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Resume Analysis */}
                    <div className="glass-card p-5 flex flex-col">
                        <h2 className="text-lg font-bold text-slate-900 dark:text-white font-nunito mb-5">
                            Resume Analysis
                        </h2>

                        {resumesLoading ? (
                            <div className="space-y-4 flex-1">
                                <div className="h-6 w-24 bg-slate-200 dark:bg-lc-hover rounded animate-pulse mx-auto" />
                                <div className="h-14 w-28 bg-slate-200 dark:bg-lc-hover rounded animate-pulse mx-auto" />
                                <div className="space-y-3">
                                    {[1, 2].map((i) => (
                                        <div key={i} className="h-16 bg-slate-100 dark:bg-lc-hover rounded-xl animate-pulse" />
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <>
                                {/* Best Score */}
                                <div className="text-center mb-5">
                                    <p className="text-sm text-slate-400 dark:text-[#8a8a8a] mb-1">Best Score</p>
                                    <p className={`text-5xl font-black font-nunito tracking-tight ${bestResumeScore > 0 ? scoreColor(bestResumeScore).text : "text-slate-300 dark:text-[#555]"}`}>
                                        {bestResumeScore > 0 ? `${bestResumeScore}%` : "—"}
                                    </p>
                                </div>

                                {/* All resumes */}
                                {resumes.length > 0 ? (
                                    <div className="space-y-2.5 flex-1 overflow-y-auto overflow-x-hidden max-h-[240px] custom-scrollbar pr-1 py-1 px-1 -mx-1">
                                        {resumes.map((resume) => {
                                            const score = getResumeScore(resume);
                                            const isAnalysed = resume.analysis != null || resume.atsAnalysis != null;
                                            const sc = score !== null ? scoreColor(score) : null;
                                            const strengthLabel = resume.analysis?.overallStrength
                                                ? resume.analysis.overallStrength.charAt(0).toUpperCase() + resume.analysis.overallStrength.slice(1)
                                                : null;
                                            return (
                                                <div
                                                    key={resume.id}
                                                    onClick={() => router.push("/resumes")}
                                                    className="p-3.5 rounded-xl transition-all cursor-pointer group shadow-sm hover:shadow-md hover:scale-[1.02] bg-slate-100 dark:bg-black/[0.35]"
                                                >
                                                    <div className="flex items-center gap-3">
                                                        <div className={`w-9 h-9 rounded-2xl flex items-center justify-center shrink-0 ${
                                                            sc ? sc.bgFaded : "bg-slate-100 dark:bg-lc-hover"
                                                        }`}>
                                                            <span className={`material-symbols-outlined text-[18px] ${
                                                                sc ? sc.text : "text-slate-400 dark:text-[#8a8a8a]"
                                                            }`}>description</span>
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{resume.fileName}</p>
                                                            <p className="text-xs text-slate-400 dark:text-[#8a8a8a]">
                                                                {new Date(resume.uploadedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                                                                {strengthLabel && ` · ${strengthLabel}`}
                                                            </p>
                                                        </div>
                                                        {score !== null ? (
                                                            <span className={`text-sm font-black ${sc!.text}`}>{score}%</span>
                                                        ) : isAnalysed ? (
                                                            <span className="text-xs font-medium text-slate-500 dark:text-[#ababab]">Analysed</span>
                                                        ) : (
                                                            <span className="text-xs font-medium text-slate-400 dark:text-[#8a8a8a]">Pending</span>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div className="flex-1 flex flex-col items-center justify-center text-center py-6">
                                        <span className="material-symbols-outlined text-3xl text-slate-300 dark:text-slate-600 mb-2">upload_file</span>
                                        <p className="text-sm text-slate-500 dark:text-[#ababab] mb-3">No resumes uploaded yet.</p>
                                        <button
                                            onClick={() => router.push("/resumes")}
                                            className="text-xs font-semibold font-nunito text-primary border border-primary/30 px-4 py-1.5 rounded-xl hover:bg-primary/5 transition-colors"
                                        >
                                            Upload Resume
                                        </button>
                                    </div>
                                )}
                            </>
                        )}
                    </div>

                    {/* Previous Interviews */}
                    <div className="glass-card p-5 flex flex-col">
                        <div className="flex items-center justify-between mb-1">
                            <h2 className="text-lg font-bold text-slate-900 dark:text-white font-nunito">
                                Previous Interviews
                            </h2>
                            <button
                                onClick={() => router.push("/reports")}
                                className="text-xs font-semibold font-nunito text-primary border border-primary/30 px-3 py-1 rounded-xl hover:bg-primary/5 transition-colors"
                            >
                                View All
                            </button>
                        </div>
                        <p className="text-xs text-slate-400 dark:text-[#8a8a8a] mb-4">
                            {new Date().toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "short", year: "numeric" })}
                        </p>

                        {loading ? (
                            <div className="space-y-3 flex-1">
                                {[1, 2, 3].map((i) => (
                                    <div key={i} className="p-4 rounded-xl border border-slate-100 dark:border-lc-border">
                                        <div className="h-4 w-32 bg-slate-200 dark:bg-lc-hover rounded animate-pulse mb-2" />
                                        <div className="h-3 w-24 bg-slate-200 dark:bg-lc-hover rounded animate-pulse mb-3" />
                                        <div className="h-3 w-20 bg-slate-200 dark:bg-lc-hover rounded animate-pulse" />
                                    </div>
                                ))}
                            </div>
                        ) : recentActivities.length > 0 ? (
                            <div className="space-y-3 flex-1 overflow-y-auto overflow-x-hidden max-h-[400px] custom-scrollbar pr-1 py-1 px-1 -mx-1">
                                {recentActivities.map((session, i) => (
                                    <div
                                        key={i}
                                        onClick={() => router.push(`/reports/${session.sessionId}`)}
                                        className="px-4 py-2.5 rounded-xl shadow-sm hover:shadow-md hover:scale-[1.02] transition-all cursor-pointer group bg-slate-100 dark:bg-black/[0.35]"
                                    >
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <h3 className="text-sm font-bold text-slate-900 dark:text-white font-nunito">{session.label}</h3>
                                                <p className="text-xs text-slate-400 dark:text-[#8a8a8a] mt-0.5 flex items-center gap-1">
                                                    <span className="material-symbols-outlined text-[14px]">calendar_today</span>
                                                    {session.date} · {session.time}
                                                </p>
                                            </div>
                                            {(() => {
                                                const sc = scoreColor(session.score);
                                                return (
                                                    <span className={`text-xs font-bold px-2 py-0.5 rounded ${sc.bgFaded} ${sc.text}`}>
                                                        {session.score}/100
                                                    </span>
                                                );
                                            })()}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="flex-1 flex flex-col items-center justify-center text-center py-8">
                                <span className="material-symbols-outlined text-3xl text-slate-300 dark:text-slate-600 mb-2">mic</span>
                                <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-1 font-nunito">Ready to begin?</h3>
                                <p className="text-xs text-slate-500 dark:text-[#ababab] mb-3">Your interview history will appear here.</p>
                                <button
                                    onClick={() => router.push("/interviews")}
                                    className="text-xs font-semibold font-nunito text-white bg-primary px-4 py-1.5 rounded-xl hover:bg-primary/90 transition-colors"
                                >
                                    Start First Interview
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Row 3: Action Plan Calendar */}
                <ActionPlanCalendar />
            </main>
            <Footer />
        </div>
    );
}
