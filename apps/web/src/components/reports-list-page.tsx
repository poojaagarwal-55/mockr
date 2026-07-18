"use client";

import Image from "next/image";
import { useEffect, useMemo, useState, useRef } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api";
import { INTERVIEW_TYPE_MAP } from "@interviewforge/shared";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { Bar, Pie, Line } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend
);

type ReportListItem = {
    id: string;
    sessionId: string;
    overallScore: number;
    generatedAt: string;
    session: {
        id: string;
        role: string;
        level: string;
        type: string;
    };
};

type ViewMode = "calendar" | "timeline";

type ReportTypeCard = {
    type: string;
    title: string;
    subtitle: string;
    illustration: string;
    imageClass?: string;
    bgClass: string;
    accentClass: string;
};

type ReportsListPageProps = {
    documentTitle?: string;
    headerTitleNode?: ReactNode;
    backUrl?: string;
    reportsEndpoint?: string;
    reportTypeCards?: ReportTypeCard[];
    getReportHref?: (report: ReportListItem) => string;
    getTypeHref?: (type: string) => string | null;
    topBannerNode?: ReactNode;
};

const REPORT_TYPE_CARDS: ReportTypeCard[] = [
    {
        type: "full_interview",
        title: "Full Interview",
        subtitle: "A complete mock interview flow covering intro, coding, fundamentals, and system design.",
        illustration: "/Full_interview_CardPanel.png",
        bgClass: "bg-gradient-to-r from-blue-50 via-blue-100 to-blue-200 dark:from-blue-950/40 dark:via-blue-900/40 dark:to-blue-950/60",
        accentClass: "from-blue-500 to-blue-600",
    },
    {
        type: "cs_fundamentals",
        title: "CS Fundamentals",
        subtitle: "Refresh the core concepts that frequently show up in technical interviews.",
        illustration: "/CS_fundamentals_CardPanel.png",
        bgClass: "bg-gradient-to-r from-sky-50 via-sky-100 to-sky-200 dark:from-sky-950/40 dark:via-sky-900/40 dark:to-sky-950/60",
        accentClass: "from-sky-500 to-sky-600",
    },
    {
        type: "system_design",
        title: "System Design Interview",
        subtitle: "Practice architecture, trade-offs, scalability, and product thinking in one place.",
        illustration: "/System_Design_CardPanel.png",
        bgClass: "bg-gradient-to-r from-blue-100 via-blue-200 to-blue-300 dark:from-blue-900/50 dark:via-blue-800/50 dark:to-blue-950/70",
        accentClass: "from-blue-600 to-blue-700",
    },
    {
        type: "coding",
        title: "Coding",
        subtitle: "Sharpen data structures, algorithms, and problem-solving under interview conditions.",
        illustration: "/coding_interview_CardPanel.png",
        bgClass: "bg-gradient-to-r from-sky-100 via-sky-200 to-sky-300 dark:from-sky-900/50 dark:via-sky-800/50 dark:to-sky-950/70",
        accentClass: "from-sky-600 to-sky-700",
    },
    {
        type: "behavioural",
        title: "Behavioural",
        subtitle: "Build stronger STAR stories for leadership, teamwork, and conflict resolution.",
        illustration: "/Behavioural_image_CardPanel.png.png",
        imageClass: "object-cover scale-[1.08]",
        bgClass: "bg-gradient-to-r from-indigo-50 via-indigo-100 to-indigo-200 dark:from-indigo-950/40 dark:via-indigo-900/40 dark:to-indigo-950/60",
        accentClass: "from-indigo-500 to-indigo-600",
    },
    {
        type: "problem_solving_case",
        title: "Problem Solving Case",
        subtitle: "Review structured analytical cases, assumptions, hint usage, and reasoning under pressure.",
        illustration: "/Full_interview_CardPanel.png",
        bgClass: "bg-gradient-to-r from-rose-50 via-pink-100 to-rose-200 dark:from-rose-950/40 dark:via-pink-900/40 dark:to-rose-950/60",
        accentClass: "from-rose-500 to-pink-600",
    },
    {
        type: "resume_round",
        title: "Resume Screening",
        subtitle: "Track claim verification, project ownership, leadership evidence, AI usage, and communication.",
        illustration: "/resumeproff.png",
        imageClass: "object-contain scale-[0.95]",
        bgClass: "bg-gradient-to-r from-cyan-50 via-teal-100 to-cyan-200 dark:from-cyan-950/40 dark:via-teal-900/40 dark:to-cyan-950/60",
        accentClass: "from-cyan-500 to-teal-600",
    },
    {
        type: "gen_ai_role",
        title: "Gen AI Role",
        subtitle: "Deep-dive GenAI engineering interview: resume probe, GenAI fundamentals, coding, and an AI responsibility scenario.",
        illustration: "/Full_interview_CardPanel.png",
        bgClass: "bg-gradient-to-r from-violet-50 via-purple-100 to-violet-200 dark:from-violet-950/40 dark:via-purple-900/40 dark:to-violet-950/60",
        accentClass: "from-violet-500 to-purple-600",
    },
    {
        type: "data_science_role",
        title: "Data Science Role",
        subtitle: "5-phase DS interview: resume deep-dive, stats & ML concepts, SQL, Python coding, and business metrics case.",
        illustration: "/Full_interview_CardPanel.png",
        bgClass: "bg-gradient-to-r from-emerald-50 via-teal-100 to-emerald-200 dark:from-emerald-950/40 dark:via-teal-900/40 dark:to-emerald-950/60",
        accentClass: "from-emerald-500 to-teal-600",
    },
    {
        type: "pm_role",
        title: "Product Manager Role",
        subtitle: "5-phase PM interview: resume deep-dive, product case, PM concepts, product strategy, and STAR behavioral.",
        illustration: "/Full_interview_CardPanel.png",
        bgClass: "bg-gradient-to-r from-amber-50 via-orange-100 to-amber-200 dark:from-amber-950/40 dark:via-orange-900/40 dark:to-amber-950/60",
        accentClass: "from-amber-500 to-orange-600",
    },
];

const EVENT_TYPE_STYLES: Record<string, { base: string; bgClass: string; textClass: string }> = {
    full_interview: {
        base: "#6C63FF",
        bgClass: "bg-[#6C63FF]/15",
        textClass: "text-[#3E35D8] dark:text-[#B7B2FF]",
    },
    coding: {
        base: "#A8E63D",
        bgClass: "bg-[#A8E63D]/25",
        textClass: "text-[#4A6D10] dark:text-[#D7F5A5]",
    },
    system_design: {
        base: "#63C6FF",
        bgClass: "bg-[#63C6FF]/20",
        textClass: "text-[#0C5B87] dark:text-[#A7E0FF]",
    },
    behavioural: {
        base: "#FF6CAE",
        bgClass: "bg-[#FF6CAE]/18",
        textClass: "text-[#A62F66] dark:text-[#FFC0DD]",
    },
    cs_fundamentals: {
        base: "#F59E0B",
        bgClass: "bg-[#F59E0B]/20",
        textClass: "text-[#8A5800] dark:text-[#FFD894]",
    },
    gen_ai_role: {
        base: "#8B5CF6",
        bgClass: "bg-[#8B5CF6]/18",
        textClass: "text-[#5B21B6] dark:text-[#C4B5FD]",
    },
    data_science_role: {
        base: "#10B981",
        bgClass: "bg-[#10B981]/18",
        textClass: "text-[#065F46] dark:text-[#6EE7B7]",
    },
    pm_role: {
        base: "#F97316",
        bgClass: "bg-[#F97316]/18",
        textClass: "text-[#9A3412] dark:text-[#FDBA74]",
    },
    problem_solving_case: {
        base: "#E11D48",
        bgClass: "bg-[#E11D48]/18",
        textClass: "text-[#9F1239] dark:text-[#FDA4AF]",
    },
    resume_round: {
        base: "#0891B2",
        bgClass: "bg-[#0891B2]/18",
        textClass: "text-[#155E75] dark:text-[#67E8F9]",
    },
};

const ShimmerSkeleton = ({ className = "" }: { className?: string }) => (
    <div className={`animate-pulse bg-slate-200 dark:bg-lc-hover rounded-md ${className}`} />
);

export default function ReportsListPage({
    documentTitle = "Reports | Mockr",
    headerTitleNode,
    backUrl = "/dashboard",
    reportsEndpoint = "/users/me/reports",
    reportTypeCards = REPORT_TYPE_CARDS,
    getReportHref = (report) => `/reports/${report.sessionId}`,
    getTypeHref = (type) => `/reports/type/${encodeURIComponent(type)}`,
    topBannerNode,
}: ReportsListPageProps = {}) {
    useEffect(() => { document.title = documentTitle; }, [documentTitle]);
    const router = useRouter();
    const { session: authSession, loading: authLoading } = useAuth();

    const [reports, setReports] = useState<ReportListItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // New generic layout states
    const [viewMode, setViewMode] = useState<ViewMode>("calendar");
    const [selectedTypeFilter, setSelectedTypeFilter] = useState<string | "all">("all");
    const [calendarMonthStart, setCalendarMonthStart] = useState<Date>(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
    const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());
    const [timelineAnchorDate, setTimelineAnchorDate] = useState<Date>(() => new Date()); // controls the start of the 10-date strip
    const [hoveredDate, setHoveredDate] = useState<Date | null>(null);
    const [isMonthPickerOpen, setIsMonthPickerOpen] = useState(false);
    const [isFilterPickerOpen, setIsFilterPickerOpen] = useState(false);
    const [selectedGraphType, setSelectedGraphType] = useState<string>("all_categories");

    const [isGraphRangeOpen, setIsGraphRangeOpen] = useState(false);
    const [isGraphTypeOpen, setIsGraphTypeOpen] = useState(false);
    const [isPieMonthOpen, setIsPieMonthOpen] = useState(false);

    const monthPickerRef = useRef<HTMLDivElement>(null);
    const filterPickerRef = useRef<HTMLDivElement>(null);
    const graphRangeRef = useRef<HTMLDivElement>(null);
    const graphTypeRef = useRef<HTMLDivElement>(null);
    const pieMonthRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (monthPickerRef.current && !monthPickerRef.current.contains(event.target as Node)) {
                setIsMonthPickerOpen(false);
            }
            if (filterPickerRef.current && !filterPickerRef.current.contains(event.target as Node)) {
                setIsFilterPickerOpen(false);
            }
            if (graphRangeRef.current && !graphRangeRef.current.contains(event.target as Node)) {
                setIsGraphRangeOpen(false);
            }
            if (graphTypeRef.current && !graphTypeRef.current.contains(event.target as Node)) {
                setIsGraphTypeOpen(false);
            }
            if (pieMonthRef.current && !pieMonthRef.current.contains(event.target as Node)) {
                setIsPieMonthOpen(false);
            }
        };

        if (isMonthPickerOpen || isFilterPickerOpen || isGraphRangeOpen || isGraphTypeOpen || isPieMonthOpen) {
            document.addEventListener("mousedown", handleClickOutside);
        } else {
            document.removeEventListener("mousedown", handleClickOutside);
        }
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [isMonthPickerOpen, isFilterPickerOpen, isGraphRangeOpen, isGraphTypeOpen, isPieMonthOpen]);

    const dateScrollInterval = useRef<NodeJS.Timeout | null>(null);
    const monthScrollInterval = useRef<NodeJS.Timeout | null>(null);

    const smoothCenterDate = (targetDate: Date) => {
        setSelectedDate(targetDate);
        if (dateScrollInterval.current) clearInterval(dateScrollInterval.current);
        if (monthScrollInterval.current) clearInterval(monthScrollInterval.current);

        const targetAnchor = addDays(targetDate, -4); // center it in a 10-day strip
        const diffMs = targetAnchor.getTime() - timelineAnchorDate.getTime();
        const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
        
        if (diffDays === 0) return;
        
        if (Math.abs(diffDays) > 60) {
            setTimelineAnchorDate(targetAnchor);
            return;
        }

        const stepDir = diffDays > 0 ? 1 : -1;
        const intervalSpeed = Math.max(10, 40 - Math.abs(diffDays)); // smooth acceleration
        
        dateScrollInterval.current = setInterval(() => {
            setTimelineAnchorDate(prev => {
                const next = addDays(prev, stepDir);
                const currentDiff = targetAnchor.getTime() - next.getTime();
                const currentDiffDays = Math.round(currentDiff / (1000 * 60 * 60 * 24));
                
                if ((stepDir === 1 && currentDiffDays <= 0) || (stepDir === -1 && currentDiffDays >= 0)) {
                    if (dateScrollInterval.current) clearInterval(dateScrollInterval.current);
                    return targetAnchor;
                }
                return next;
            });
        }, intervalSpeed);
    };

    const startDateScroll = (step: number) => {
        if (dateScrollInterval.current) clearInterval(dateScrollInterval.current);
        dateScrollInterval.current = setInterval(() => {
            setTimelineAnchorDate((prev) => {
                const next = addDays(prev, step);
                if (step > 0 && addDays(next, 9) > new Date()) return prev;
                return next;
            });
        }, 150); // fast continuous scrolling for dates
    };

    const stopDateScroll = () => {
        if (dateScrollInterval.current) {
            clearInterval(dateScrollInterval.current);
            dateScrollInterval.current = null;
        }
    };

    const startMonthScroll = (step: number) => {
        if (monthScrollInterval.current) clearInterval(monthScrollInterval.current);
        monthScrollInterval.current = setInterval(() => {
            setTimelineAnchorDate((prev) => {
                const next = new Date(prev);
                next.setMonth(next.getMonth() + step);
                if (step > 0 && next > new Date()) return prev;
                return next;
            });
        }, 200); // fast continuous scrolling for months
    };

    const stopMonthScroll = () => {
        if (monthScrollInterval.current) {
            clearInterval(monthScrollInterval.current);
            monthScrollInterval.current = null;
        }
    };

    useEffect(() => {
        return () => {
            if (dateScrollInterval.current) clearInterval(dateScrollInterval.current);
            if (monthScrollInterval.current) clearInterval(monthScrollInterval.current);
        };
    }, []);

    useEffect(() => {
        if (authLoading) return;

        const token = authSession?.access_token;
        if (!token) {
            setLoading(false);
            setError("You must be signed in to view reports.");
            return;
        }

        let isMounted = true;
        setLoading(true);
        setError(null);

        const reportsUrl = `${reportsEndpoint}${reportsEndpoint.includes("?") ? "&" : "?"}limit=100`;
        api.get<{ reports: ReportListItem[] }>(reportsUrl, token)
            .then((data) => {
                if (!isMounted) return;
                setReports(data.reports || []);
            })
            .catch((err: any) => {
                if (!isMounted) return;
                setError(err?.message || "Failed to load reports");
            })
            .finally(() => {
                if (!isMounted) return;
                setLoading(false);
            });

        return () => {
            isMounted = false;
        };
    }, [authSession?.access_token, authLoading, reportsEndpoint]);

    const interviewTypeLabels = useMemo(
        () => Object.fromEntries(
            Object.entries(INTERVIEW_TYPE_MAP).map(([k, v]) => [
                k,
                v.label.toLowerCase().includes("interview") ? v.label : `${v.label} Interview`,
            ])
        ) as Record<string, string>,
        []
    );

    const reportCountsByType = useMemo(() => {
        return reports.reduce<Record<string, number>>((acc, report) => {
            acc[report.session.type] = (acc[report.session.type] || 0) + 1;
            return acc;
        }, {});
    }, [reports]);

    const totalAttempts = reports.length;

    const getDateKey = (date: Date) => {
        const y = date.getFullYear();
        const m = `${date.getMonth() + 1}`.padStart(2, "0");
        const d = `${date.getDate()}`.padStart(2, "0");
        return `${y}-${m}-${d}`;
    };

    const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const addDays = (date: Date, days: number) => {
        const next = new Date(date);
        next.setDate(next.getDate() + days);
        return next;
    };
    const startOfWeekMonday = (date: Date) => {
        const base = startOfDay(date);
        const day = (base.getDay() + 6) % 7;
        return addDays(base, -day);
    };

    const avgScore = useMemo(() => {
        if (!reports.length) return 0;
        const total = reports.reduce((sum, report) => sum + report.overallScore, 0);
        return Math.round(total / reports.length);
    }, [reports]);

    const bestScore = useMemo(() => {
        if (!reports.length) return 0;
        return Math.round(Math.max(...reports.map((report) => report.overallScore)));
    }, [reports]);

    const scoreTrendIcon = (score: number) => {
        if (score >= 75) return "north_east";
        if (score <= 55) return "south_east";
        return "trending_flat";
    };

    const thisWeekCount = useMemo(() => {
        const now = new Date();
        const weekStart = startOfWeekMonday(now);
        const weekEnd = addDays(weekStart, 6);
        return reports.filter((report) => {
            const timestamp = new Date(report.generatedAt).getTime();
            return timestamp >= weekStart.getTime() && timestamp < addDays(weekEnd, 1).getTime();
        }).length;
    }, [reports]);

    // Apply filtering based on selected type
    const filteredReports = useMemo(() => {
        if (selectedTypeFilter === "all") return reports;
        return reports.filter((report) => report.session.type === selectedTypeFilter);
    }, [reports, selectedTypeFilter]);

    const reportsByDayKey = useMemo(() => {
        return filteredReports.reduce<Record<string, ReportListItem[]>>((acc, report) => {
            const key = getDateKey(new Date(report.generatedAt));
            if (!acc[key]) acc[key] = [];
            acc[key].push(report);
            return acc;
        }, {});
    }, [filteredReports]);

    const weekDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

    const monthlyCells = useMemo(() => {
        const start = new Date(calendarMonthStart.getFullYear(), calendarMonthStart.getMonth(), 1);
        const end = new Date(calendarMonthStart.getFullYear(), calendarMonthStart.getMonth() + 1, 0);
        const leading = (start.getDay() + 6) % 7;
        const daysInMonth = end.getDate();
        const totalCells = Math.ceil((leading + daysInMonth) / 7) * 7;
        const firstCellDate = addDays(start, -leading);

        return Array.from({ length: totalCells }).map((_, idx) => {
            const date = addDays(firstCellDate, idx);
            return {
                date,
                isCurrentMonth: date.getMonth() === calendarMonthStart.getMonth(),
            };
        });
    }, [calendarMonthStart]);

    const timelineDates = useMemo(() => {
        return Array.from({ length: 10 }).map((_, i) => addDays(timelineAnchorDate, i));
    }, [timelineAnchorDate]);

    const timelineMonths = useMemo(() => {
        const centerDate = addDays(timelineAnchorDate, 4); // Use visual center of dates
        return Array.from({ length: 12 }).map((_, i) => {
            const d = new Date(centerDate);
            d.setDate(1);
            d.setMonth(d.getMonth() - 5 + i);
            return d;
        });
    }, [timelineAnchorDate]);

    const shiftMonth = (step: number) => {
        setCalendarMonthStart(prev => new Date(prev.getFullYear(), prev.getMonth() + step, 1));
    };

    const shiftTimeline = (step: number) => {
        setTimelineAnchorDate(prev => {
            const next = addDays(prev, step);
            if (step > 0 && addDays(next, 9) > new Date()) return prev;
            return next;
        });
    };

    const shiftTimelineMonths = (step: number) => {
        setTimelineAnchorDate(prev => {
            const next = new Date(prev);
            next.setMonth(next.getMonth() + step);
            if (step > 0 && next > new Date()) return prev;
            return next;
        });
    };

    const getEventStyle = (type: string) => EVENT_TYPE_STYLES[type] || EVENT_TYPE_STYLES.cs_fundamentals;

    const handleTypeCardClick = (type: string) => {
        const href = getTypeHref(type);
        if (href) {
            router.push(href);
        } else {
            setSelectedTypeFilter(type);
            setViewMode("timeline");
        }
    };

    const handleCalendarDayClick = (date: Date) => {
        smoothCenterDate(date);
        setViewMode("timeline");
        setTimeout(() => {
            const el = document.getElementById("calendar-scroll-target");
            if (el) {
                el.scrollIntoView({ behavior: "smooth", block: "start" });
            }
        }, 50); // slight delay to allow timeline to render
    };

    const getStatsForType = (type: string) => {
        const typeReports = reports.filter(r => r.session.type === type);
        const count = typeReports.length;
        const avgScore = count ? Math.round(typeReports.reduce((s, r) => s + r.overallScore, 0) / count) : 0;
        
        const now = new Date();
        const weekStart = startOfWeekMonday(now);
        const weekEnd = addDays(weekStart, 6);
        const thisWeek = typeReports.filter((report) => {
            const timestamp = new Date(report.generatedAt).getTime();
            return timestamp >= weekStart.getTime() && timestamp < addDays(weekEnd, 1).getTime();
        }).length;

        return { count, avgScore, thisWeek };
    };

    const selectedDateKey = getDateKey(selectedDate);
    const eventsForSelectedDate = reportsByDayKey[selectedDateKey] || [];

    const [selectedGraphRange, setSelectedGraphRange] = useState<string>("all");
    const [selectedPieMonth, setSelectedPieMonth] = useState<string>("all");

    const chartData = useMemo(() => {
        const sorted = [...reports].sort((a, b) => new Date(a.generatedAt).getTime() - new Date(b.generatedAt).getTime());

        if (selectedGraphType === "all_categories") {
            // Group each type independently so every line starts at x=1
            const byType: Record<string, ReportListItem[]> = {};
            reportTypeCards.forEach(card => { byType[card.type] = []; });
            sorted.forEach(r => { if (byType[r.session.type]) byType[r.session.type].push(r); });

            // Apply range per-type so "Last 10" means last 10 of each type
            if (selectedGraphRange === "10") reportTypeCards.forEach(c => { byType[c.type] = byType[c.type].slice(-10); });
            else if (selectedGraphRange === "30") reportTypeCards.forEach(c => { byType[c.type] = byType[c.type].slice(-30); });

            const hasData = Object.values(byType).some(a => a.length > 0);
            const totalCount = Object.values(byType).reduce((s, a) => s + a.length, 0);
            const hasEnoughData = totalCount >= 3;

            if (!hasData) {
                return { labels: [" ", "  "], datasets: [{ label: 'No Data', data: [null, null], borderColor: 'rgba(148, 163, 184, 0.2)', backgroundColor: 'transparent', tension: 0.4 }], hasData: false, hasEnoughData: false };
            }

            // Shared x-axis spans the longest type; shorter types simply stop earlier
            const maxCount = Math.max(...Object.values(byType).map(a => a.length));
            const labels = Array.from({ length: maxCount }, (_, i) => String(i + 1));
            const datasets: any[] = [];

            reportTypeCards.forEach(card => {
                const interviews = byType[card.type];
                if (interviews.length < 2) return;
                datasets.push({
                    label: INTERVIEW_TYPE_MAP[card.type as keyof typeof INTERVIEW_TYPE_MAP]?.label || card.title,
                    data: Array.from({ length: maxCount }, (_, i) => i < interviews.length ? interviews[i].overallScore : null),
                    rawDates: Array.from({ length: maxCount }, (_, i) => i < interviews.length ? interviews[i].generatedAt : null),
                    borderColor: EVENT_TYPE_STYLES[card.type]?.base || EVENT_TYPE_STYLES.cs_fundamentals.base,
                    backgroundColor: EVENT_TYPE_STYLES[card.type]?.base || EVENT_TYPE_STYLES.cs_fundamentals.base,
                    tension: 0.4,
                    spanGaps: false,
                });
            });

            return { labels, datasets, hasData: true, hasEnoughData };
        } else {
            let typeFiltered = sorted.filter(r => r.session.type === selectedGraphType);
            if (selectedGraphRange === "10") typeFiltered = typeFiltered.slice(-10);
            else if (selectedGraphRange === "30") typeFiltered = typeFiltered.slice(-30);

            const hasData = typeFiltered.length > 0;
            const hasEnoughData = typeFiltered.length >= 3;

            if (!hasData) {
                return { labels: [" ", "  "], datasets: [{ label: 'No Data', data: [null, null], borderColor: 'rgba(148, 163, 184, 0.2)', backgroundColor: 'transparent', tension: 0.4 }], hasData: false, hasEnoughData: false };
            }

            const labels = typeFiltered.map((_, i) => String(i + 1));
            const rawDates = typeFiltered.map(r => r.generatedAt);

            return {
                labels,
                datasets: [{
                    label: INTERVIEW_TYPE_MAP[selectedGraphType as keyof typeof INTERVIEW_TYPE_MAP]?.label || selectedGraphType,
                    data: typeFiltered.map(r => r.overallScore),
                    borderColor: EVENT_TYPE_STYLES[selectedGraphType]?.base || 'rgba(99, 102, 241, 0.8)',
                    backgroundColor: EVENT_TYPE_STYLES[selectedGraphType]?.base || 'rgba(99, 102, 241, 0.8)',
                    tension: 0.4,
                    spanGaps: true,
                    rawDates,
                }],
                hasData: true,
                hasEnoughData,
            };
        }
    }, [reports, selectedGraphType, selectedGraphRange, reportTypeCards]);

    const chartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        elements: {
            line: { borderWidth: 3, tension: 0.4 },
            point: { radius: 4, hoverRadius: 6 }
        },
        plugins: {
            legend: {
                display: true,
                position: 'bottom' as const,
                labels: {
                    color: '#94a3b8',
                    usePointStyle: true,
                    pointStyle: 'circle',
                    boxWidth: 8,
                    padding: 10,
                    font: { size: 10, family: 'Nunito', weight: 'bold' as const }
                }
            },
            tooltip: {
                backgroundColor: 'rgba(15, 23, 42, 0.9)',
                titleColor: '#fff',
                bodyColor: '#e2e8f0',
                padding: 12,
                cornerRadius: 8,
                displayColors: true,
                filter: function(item: any) {
                    return item.parsed.y !== null && item.parsed.y !== undefined;
                },
                callbacks: {
                    title: function(context: any) {
                        const rawDate = context[0]?.dataset?.rawDates?.[context[0]?.dataIndex];
                        if (!rawDate) return '';
                        return new Date(rawDate).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
                    },
                    label: function(context: any) {
                        if (context.parsed.y === null || context.parsed.y === undefined) return null as any;
                        return `${context.dataset.label}: ${Math.round(context.parsed.y)}%`;
                    }
                }
            }
        },
        scales: {
            y: {
                beginAtZero: true,
                border: { display: false },
                grid: { display: false, drawBorder: false },
                ticks: { color: "#94a3b8", crossAlign: 'center' as const, stepSize: 1, precision: 0 }
            },
            x: {
                border: { display: false },
                grid: { display: false, drawBorder: false },
                ticks: { display: false }
            }
        }
    };

    const pieChartData = useMemo(() => {
        let filtered = reports;
        
        if (selectedPieMonth !== "all") {
            const [yearStr, monthStr] = selectedPieMonth.split('-');
            const year = parseInt(yearStr, 10);
            const month = parseInt(monthStr, 10);
            filtered = filtered.filter(r => {
                const d = new Date(r.generatedAt);
                return d.getFullYear() === year && d.getMonth() === month;
            });
        }

        const counts: Record<string, number> = {};
        const scoreSums: Record<string, number> = {};
        
        filtered.forEach(r => {
            counts[r.session.type] = (counts[r.session.type] || 0) + 1;
            scoreSums[r.session.type] = (scoreSums[r.session.type] || 0) + r.overallScore;
        });

        const types = Object.keys(counts);
        const hasData = types.length > 0;
        
        if (!hasData) {
            return {
                labels: ['No Data'],
                hasData: false,
                datasets: [{
                    data: [1],
                    backgroundColor: ['rgba(148, 163, 184, 0.1)'],
                    borderWidth: 0,
                    hoverBackgroundColor: ['rgba(148, 163, 184, 0.1)'],
                }]
            };
        }

        return {
            labels: types.map(t => INTERVIEW_TYPE_MAP[t as keyof typeof INTERVIEW_TYPE_MAP]?.label || t),
            hasData: true,
            datasets: [
                {
                    data: types.map(t => counts[t]),
                    avgScores: types.map(t => counts[t] > 0 ? Math.round((scoreSums[t] || 0) / counts[t]) : 0),
                    backgroundColor: types.map(t => EVENT_TYPE_STYLES[t]?.base || EVENT_TYPE_STYLES.cs_fundamentals.base),
                    hoverBackgroundColor: types.map(t => EVENT_TYPE_STYLES[t]?.base || EVENT_TYPE_STYLES.cs_fundamentals.base),
                    borderWidth: 2,
                    borderColor: '#ffffff',
                    hoverOffset: 24,
                    weight: 2,
                }
            ]
        };
    }, [reports, selectedPieMonth]);

    const pieChartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                display: true,
                position: 'bottom' as const,
                labels: {
                    color: '#94a3b8',
                    usePointStyle: true,
                    pointStyle: 'circle',
                    boxWidth: 8,
                    padding: 10,
                    font: { size: 10, family: 'Nunito', weight: 'bold' as const }
                }
            },
            tooltip: {
                backgroundColor: 'rgba(15, 23, 42, 0.95)',
                titleColor: '#fff',
                bodyColor: '#e2e8f0',
                titleFont: { size: 14, family: 'Nunito', weight: 'bold' as const },
                bodyFont: { size: 14, family: 'Nunito', weight: 'bold' as const },
                padding: 16,
                cornerRadius: 12,
                displayColors: false,
                callbacks: {
                    title: function(context: any) {
                        return context[0].label;
                    },
                    label: function(context: any) {
                        const avg = context.dataset.avgScores?.[context.dataIndex] ?? 0;
                        return `Avg Score: ${avg}%`;
                    },
                    afterLabel: function(context: any) {
                        const count = context.raw;
                        return `Total Attempts: ${count}`;
                    }
                }
            }
        },
        cutout: 0, // Solid circle
        layout: {
            padding: {
                top: 8,
                bottom: 20,
                left: 0,
                right: 0
            }
        }
    };

    return (
        <div className="flex-1 overflow-auto bg-slate-50/50 dark:bg-[#1a1a1a] min-h-full relative overflow-x-hidden">
            <div className="relative z-10">
                <PageHeader
                    showBack
                    backUrl={backUrl}
                    titleNode={
                        headerTitleNode || <h1 className="text-[28px] font-bold text-slate-900 dark:text-white font-nunito tracking-[-0.02em]">Reports</h1>
                    }
                />

                <main className="flex-1 px-4 pb-12 sm:px-6 lg:px-8 mt-6">
                    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-10">

                    {topBannerNode}

                    {/* Top Section: Performance History & Monthly Stats */}
                    <div className="hidden md:grid grid-cols-1 xl:grid-cols-5 gap-10 w-full px-4 xl:px-0">
                        
                        {/* Left Panel: Performance History Line Chart */}
                        <div className="xl:col-span-3 flex flex-col min-w-0 h-[340px] bg-white/40 dark:bg-[#111111]/40 backdrop-blur-md p-6 rounded-2xl shadow-sm border-0">
                            <div className="flex items-center justify-between gap-4 mb-6 shrink-0">
                                <h2 className="text-[20px] font-bold text-slate-800 dark:text-white font-nunito tracking-tight text-left">Performance History</h2>
                                    
                                <div className="flex items-center gap-2">
                                    {/* Date Range Selector */}
                                    <div className="relative" ref={graphRangeRef}>
                                        <button
                                            type="button"
                                            onClick={() => setIsGraphRangeOpen(!isGraphRangeOpen)}
                                            className="appearance-none bg-transparent hover:bg-slate-100 dark:hover:bg-white/5 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-1.5 pr-8 text-[12px] font-bold focus:outline-none focus:ring-1 focus:ring-primary/50 transition-colors cursor-pointer flex items-center justify-between min-w-[120px]"
                                        >
                                            {selectedGraphRange === "all" ? "All Time" : `Last ${selectedGraphRange}`}
                                            <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                                                <span className="material-symbols-outlined text-[16px]">expand_more</span>
                                            </div>
                                        </button>
                                        
                                        {isGraphRangeOpen && (
                                            <div className="absolute top-10 right-0 z-50 bg-white dark:bg-[#1a1a1a] border border-slate-200/80 dark:border-white/10 rounded-2xl shadow-[0_8px_30px_rgba(0,0,0,0.12)] p-2 w-[160px] flex flex-col gap-1 animate-in fade-in zoom-in-95 duration-200">
                                                {[
                                                    { val: "all", label: "All Time" },
                                                    { val: "10", label: "Last 10" },
                                                    { val: "30", label: "Last 30" }
                                                ].map(opt => (
                                                    <button
                                                        key={`range-${opt.val}`}
                                                        onClick={() => {
                                                            setSelectedGraphRange(opt.val);
                                                            setIsGraphRangeOpen(false);
                                                        }}
                                                        className={`px-3 py-2 text-left text-[13px] font-bold rounded-xl transition-colors ${
                                                            selectedGraphRange === opt.val
                                                            ? "bg-slate-800 text-white dark:bg-white dark:text-slate-900" 
                                                            : "text-slate-600 hover:bg-slate-100 dark:text-[#c0c3de] dark:hover:bg-white/5"
                                                        }`}
                                                    >
                                                        {opt.label}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    {/* Type Selector Dropdown */}
                                    <div className="relative" ref={graphTypeRef}>
                                        <button
                                            type="button"
                                            onClick={() => setIsGraphTypeOpen(!isGraphTypeOpen)}
                                            className="appearance-none bg-transparent hover:bg-slate-100 dark:hover:bg-white/5 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-1.5 pr-8 text-[12px] font-bold focus:outline-none focus:ring-1 focus:ring-primary/50 transition-colors cursor-pointer flex items-center justify-between min-w-[140px]"
                                        >
                                            <span className="truncate">
                                                {selectedGraphType === "all_categories" ? "All Categories" : (INTERVIEW_TYPE_MAP[selectedGraphType as keyof typeof INTERVIEW_TYPE_MAP]?.label || selectedGraphType)}
                                            </span>
                                            <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                                                <span className="material-symbols-outlined text-[16px]">expand_more</span>
                                            </div>
                                        </button>
                                        
                                        {isGraphTypeOpen && (
                                            <div className="absolute top-10 right-0 z-50 bg-white dark:bg-[#1a1a1a] border border-slate-200/80 dark:border-white/10 rounded-2xl shadow-[0_8px_30px_rgba(0,0,0,0.12)] p-2 w-[220px] flex flex-col gap-1 animate-in fade-in zoom-in-95 duration-200 overflow-y-auto max-h-[300px] overflow-x-hidden [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                                                <button
                                                    onClick={() => {
                                                        setSelectedGraphType("all_categories");
                                                        setIsGraphTypeOpen(false);
                                                    }}
                                                    className={`px-3 py-2 text-left text-[13px] font-bold rounded-xl transition-colors shrink-0 ${
                                                        selectedGraphType === "all_categories"
                                                        ? "bg-slate-800 text-white dark:bg-white dark:text-slate-900" 
                                                        : "text-slate-600 hover:bg-slate-100 dark:text-[#c0c3de] dark:hover:bg-white/5"
                                                    }`}
                                                >
                                                    All Categories
                                                </button>
                                                <div className="h-px bg-slate-100 dark:bg-white/5 my-1 shrink-0" />
                                                {reportTypeCards.map(card => {
                                                    const cardTypeLabel = INTERVIEW_TYPE_MAP[card.type as keyof typeof INTERVIEW_TYPE_MAP]?.label || card.title;
                                                    return (
                                                        <button
                                                            key={`graphtype-${card.type}`}
                                                            onClick={() => {
                                                                setSelectedGraphType(card.type);
                                                                setIsGraphTypeOpen(false);
                                                            }}
                                                            className={`px-3 py-2 text-left text-[13px] font-bold rounded-xl transition-colors shrink-0 ${
                                                                selectedGraphType === card.type
                                                                ? "bg-slate-800 text-white dark:bg-white dark:text-slate-900" 
                                                                : "text-slate-600 hover:bg-slate-100 dark:text-[#c0c3de] dark:hover:bg-white/5"
                                                            }`}
                                                        >
                                                            {cardTypeLabel}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="flex-1 flex flex-col justify-center relative min-h-0 w-full">
                                <div className="absolute inset-0">
                                    {loading ? (
                                        <ShimmerSkeleton className="w-full h-full rounded-xl" />
                                    ) : chartData.hasData && chartData.hasEnoughData ? (
                                        <Line data={chartData} options={chartOptions} />
                                    ) : null}
                                </div>
                                {!loading && !chartData.hasData && (
                                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-10 w-full text-slate-400">
                                        <span className="material-symbols-outlined text-[32px] mb-2 opacity-40">analytics</span>
                                        <p className="text-[13px] font-medium text-slate-500">No data available for this range/type.</p>
                                    </div>
                                )}
                                {!loading && chartData.hasData && !chartData.hasEnoughData && (
                                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-10 w-full">
                                        <span className="material-symbols-outlined text-[40px] mb-3 text-slate-300 dark:text-slate-600">bar_chart</span>
                                        <p className="text-[14px] font-semibold text-slate-500 dark:text-slate-400 text-center px-6 leading-relaxed">
                                            Give at least 3 interviews to<br />measure your performance
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Right Panel: Monthly Stats Circular Chart */}
                        <div className="xl:col-span-2 flex flex-col min-w-0 h-[340px] bg-white/40 dark:bg-[#111111]/40 backdrop-blur-md p-6 rounded-2xl shadow-sm border-0">
                            <div className="flex items-center justify-between gap-4 mb-6 shrink-0">
                                <h2 className="text-[20px] font-bold text-slate-800 dark:text-white font-nunito tracking-tight text-left">Monthly Stats</h2>
                                    
                                <div className="relative" ref={pieMonthRef}>
                                    <button
                                        type="button"
                                        onClick={() => setIsPieMonthOpen(!isPieMonthOpen)}
                                        className="appearance-none bg-transparent hover:bg-slate-100 dark:hover:bg-white/5 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-1.5 pr-8 text-[12px] font-bold focus:outline-none focus:ring-1 focus:ring-primary/50 transition-colors cursor-pointer flex items-center justify-between min-w-[120px]"
                                    >
                                        <span className="truncate">
                                            {selectedPieMonth === "all" ? "All Time" : (() => {
                                                const [y, m] = selectedPieMonth.split("-");
                                                const d = new Date(parseInt(y), parseInt(m), 1);
                                                return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
                                            })()}
                                        </span>
                                        <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                                            <span className="material-symbols-outlined text-[16px]">expand_more</span>
                                        </div>
                                    </button>
                                    
                                    {isPieMonthOpen && (
                                        <div className="absolute top-10 right-0 z-50 bg-white dark:bg-[#1a1a1a] border border-slate-200/80 dark:border-white/10 rounded-2xl shadow-[0_8px_30px_rgba(0,0,0,0.12)] p-2 w-[160px] flex flex-col gap-1 animate-in fade-in zoom-in-95 duration-200 overflow-y-auto max-h-[300px] overflow-x-hidden [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                                            <button
                                                onClick={() => {
                                                    setSelectedPieMonth("all");
                                                    setIsPieMonthOpen(false);
                                                }}
                                                className={`px-3 py-2 text-left text-[13px] font-bold rounded-xl transition-colors shrink-0 ${
                                                    selectedPieMonth === "all"
                                                    ? "bg-slate-800 text-white dark:bg-white dark:text-slate-900" 
                                                    : "text-slate-600 hover:bg-slate-100 dark:text-[#c0c3de] dark:hover:bg-white/5"
                                                }`}
                                            >
                                                All Time
                                            </button>
                                            <div className="h-px bg-slate-100 dark:bg-white/5 my-1 shrink-0" />
                                            {[...Array(6)].map((_, i) => {
                                                const d = new Date();
                                                d.setMonth(d.getMonth() - i);
                                                const val = `${d.getFullYear()}-${d.getMonth()}`;
                                                const label = d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
                                                return (
                                                    <button
                                                        key={`piemonth-${val}`}
                                                        onClick={() => {
                                                            setSelectedPieMonth(val);
                                                            setIsPieMonthOpen(false);
                                                        }}
                                                        className={`px-3 py-2 text-left text-[13px] font-bold rounded-xl transition-colors shrink-0 ${
                                                            selectedPieMonth === val
                                                            ? "bg-slate-800 text-white dark:bg-white dark:text-slate-900" 
                                                            : "text-slate-600 hover:bg-slate-100 dark:text-[#c0c3de] dark:hover:bg-white/5"
                                                        }`}
                                                    >
                                                        {label}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="flex-1 flex flex-col justify-center relative min-h-0 w-full">
                                <div className="absolute inset-0 pt-2">
                                    {loading ? (
                                        <ShimmerSkeleton className="w-full h-full rounded-xl" />
                                    ) : (
                                        <Pie data={pieChartData} options={pieChartOptions} />
                                    )}
                                </div>
                                {!loading && !pieChartData.hasData && (
                                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-10 w-full text-slate-400">
                                        <span className="material-symbols-outlined text-[32px] mb-2 opacity-40">pie_chart</span>
                                        <p className="text-[13px] font-medium text-slate-500">No interviews this month.</p>
                                    </div>
                                )}
                            </div>
                        </div>

                    </div>

                    {/* Interview Types Cards Section */}
                    <section className="flex flex-col gap-6">
                        <div className="px-4 xl:px-0">
                            <h2 className="text-[20px] font-bold text-slate-800 dark:text-white font-nunito tracking-tight text-left">
                                Interview Types
                            </h2>
                            <p className="text-[13px] text-slate-500 dark:text-[#9ea2c4] mt-0.5 tracking-[0.01em]">Quick access to your performance by category</p>
                        </div>
                        
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-5 px-4 xl:px-0">
                            {reportTypeCards.map((card, index) => {
                                const cardTypeLabel = INTERVIEW_TYPE_MAP[card.type as keyof typeof INTERVIEW_TYPE_MAP]?.label || card.title;
                                const stats = getStatsForType(card.type);

                                return (
                                    <div
                                        key={card.type}
                                        onClick={() => handleTypeCardClick(card.type)}
                                        className="group cursor-pointer relative rounded-[16px] bg-gradient-to-br from-white/65 via-blue-100/45 to-blue-200/35 dark:from-[#2a2a2a] dark:via-[#222222] dark:to-[#1a1a1a] backdrop-blur-md border border-slate-200/80 dark:border-white/10 shadow-sm transition-all duration-300 hover:shadow-[0_15px_40px_rgba(0,0,0,0.12)] hover:-translate-y-2 hover:scale-[1.05] hover:bg-blue-100/50 dark:hover:from-[#303030] dark:hover:to-[#1e1e1e] flex flex-col p-5"
                                    >
                                        {/* Header */}
                                        <div className="flex items-center justify-between gap-3 mb-4 mt-1 transition-all duration-300">
                                            <h3 className="text-[16px] group-hover:scale-105 origin-left inline-block font-bold text-slate-800 dark:text-white leading-tight font-nunito line-clamp-2 transition-transform duration-300">
                                                {cardTypeLabel}
                                            </h3>
                                            <div className="flex items-center justify-center shrink-0 text-slate-400 group-hover:text-blue-700 dark:group-hover:text-blue-400 transition-all duration-300 group-hover:translate-x-1">
                                                <span className="material-symbols-outlined text-[24px]">chevron_right</span>
                                            </div>
                                        </div>
                                        
                                        {/* Stats */}
                                        <div className="flex flex-col gap-3 w-full mt-auto transition-all duration-300">
                                            <div className="flex justify-between items-center w-full">
                                                <span className="text-[12px] group-hover:scale-105 origin-left inline-block font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide transition-transform duration-300">Avg Score</span>
                                                {loading ? <ShimmerSkeleton className="w-10 h-4" /> : <span className="text-[16px] group-hover:scale-110 origin-right inline-block font-black text-slate-800 dark:text-white leading-none transition-transform duration-300">{stats.avgScore}%</span>}
                                            </div>
                                            <div className="w-full h-px bg-slate-100 dark:bg-white/5 transition-all duration-300 group-hover:bg-blue-300/50 dark:group-hover:bg-blue-500/30" />
                                            <div className="flex justify-between items-center w-full">
                                                <span className="text-[12px] group-hover:scale-105 origin-left inline-block text-slate-500 dark:text-slate-400 transition-transform duration-300">Total Attempts</span>
                                                {loading ? <ShimmerSkeleton className="w-6 h-4" /> : <span className="text-[13px] group-hover:scale-110 origin-right inline-block font-bold text-slate-700 dark:text-slate-200 transition-transform duration-300">{stats.count}</span>}
                                            </div>
                                            <div className="flex justify-between items-center w-full">
                                                <span className="text-[12px] group-hover:scale-105 origin-left inline-block text-slate-500 dark:text-slate-400 transition-transform duration-300">This Week</span>
                                                {loading ? <ShimmerSkeleton className="w-6 h-4" /> : <span className="text-[13px] group-hover:scale-110 origin-right inline-block font-bold text-slate-700 dark:text-slate-200 transition-transform duration-300">{stats.thisWeek}</span>}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </section>

                    {/* Bottom Section: Calendar / Timeline */}
                    <section id="calendar-scroll-target" className="flex flex-col gap-6 pt-4">
                        <div className="flex items-center gap-3 px-2">
                            <h2 className="text-[20px] font-bold text-slate-800 dark:text-white font-nunito tracking-tight text-left">Interview Calendar</h2>
                        </div>
                        
                        {/* Views */}
                        <div className="p-2 md:p-4 min-h-[500px]">
                            
                            {viewMode === "calendar" && (
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
                                                            const isFuture = calendarMonthStart.getFullYear() === new Date().getFullYear() && i > new Date().getMonth();
                                                            return (
                                                                <button
                                                                    key={`month-${i}`}
                                                                    onClick={() => {
                                                                        if (!isFuture) setCalendarMonthStart(new Date(calendarMonthStart.getFullYear(), i, 1));
                                                                    }}
                                                                    disabled={isFuture}
                                                                    className={`px-3 py-2 text-left text-[13px] font-bold rounded-xl transition-colors ${
                                                                        isFuture ? "opacity-30 cursor-not-allowed" :
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
                                                                        let newMonth = calendarMonthStart.getMonth();
                                                                        if (year === currentYear && newMonth > new Date().getMonth()) {
                                                                            newMonth = new Date().getMonth();
                                                                        }
                                                                        setCalendarMonthStart(new Date(year, newMonth, 1));
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
                                            <div className="relative" ref={filterPickerRef}>
                                                <button
                                                    type="button"
                                                    onClick={() => setIsFilterPickerOpen(!isFilterPickerOpen)}
                                                    className="mr-2 flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 text-[12px] font-bold tracking-[0.05em] text-slate-600 transition-colors hover:bg-slate-50 dark:border-white/15 dark:bg-[#1a1a1a] dark:text-[#d7d7d7]"
                                                >
                                                    <span className="material-symbols-outlined text-[16px]">filter_list</span>
                                                    {selectedTypeFilter === "all" ? "All Types" : (INTERVIEW_TYPE_MAP[selectedTypeFilter as keyof typeof INTERVIEW_TYPE_MAP]?.label || "Filtered")}
                                                </button>

                                                {isFilterPickerOpen && (
                                                    <div className="absolute top-10 right-2 z-50 bg-white dark:bg-[#1a1a1a] border border-slate-200/80 dark:border-white/10 rounded-2xl shadow-[0_8px_30px_rgba(0,0,0,0.12)] p-2 w-[220px] flex flex-col gap-1 animate-in fade-in zoom-in-95 duration-200 overflow-y-auto max-h-[300px] overflow-x-hidden [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                                                        <button
                                                            onClick={() => {
                                                                setSelectedTypeFilter("all");
                                                                setIsFilterPickerOpen(false);
                                                            }}
                                                            className={`px-3 py-2 text-left text-[13px] font-bold rounded-xl transition-colors ${
                                                                selectedTypeFilter === "all" 
                                                                ? "bg-slate-800 text-white dark:bg-white dark:text-slate-900" 
                                                                : "text-slate-600 hover:bg-slate-100 dark:text-[#c0c3de] dark:hover:bg-white/5"
                                                            }`}
                                                        >
                                                            All Types
                                                        </button>
                                                        <div className="h-px bg-slate-100 dark:bg-white/5 my-1" />
                                                        {reportTypeCards.map(card => {
                                                            const isSelected = selectedTypeFilter === card.type;
                                                            const eventStyle = getEventStyle(card.type);
                                                            const label = INTERVIEW_TYPE_MAP[card.type as keyof typeof INTERVIEW_TYPE_MAP]?.label || card.title;
                                                            return (
                                                                <button
                                                                    key={card.type}
                                                                    onClick={() => {
                                                                        setSelectedTypeFilter(card.type);
                                                                        setIsFilterPickerOpen(false);
                                                                    }}
                                                                    className={`flex items-center gap-2.5 px-3 py-2 text-left text-[13px] font-bold rounded-xl transition-colors ${
                                                                        isSelected 
                                                                        ? "bg-slate-100 dark:bg-white/10" 
                                                                        : "text-slate-600 hover:bg-slate-100 dark:text-[#c0c3de] dark:hover:bg-white/5"
                                                                    }`}
                                                                    style={{ color: isSelected ? eventStyle.base : undefined }}
                                                                >
                                                                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: eventStyle.base }} />
                                                                    <span className="truncate">{label}</span>
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                            </div>
                                            <button onClick={() => shiftMonth(-1)} className="flex items-center justify-center w-9 h-9 rounded-xl border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 dark:border-white/15 dark:bg-[#1a1a1a] dark:text-[#d7d7d7]">
                                                <span className="material-symbols-outlined text-[20px]">chevron_left</span>
                                            </button>
                                            <button 
                                                onClick={() => {
                                                    const currentYear = new Date().getFullYear();
                                                    const currentMonth = new Date().getMonth();
                                                    if (calendarMonthStart.getFullYear() < currentYear || (calendarMonthStart.getFullYear() === currentYear && calendarMonthStart.getMonth() < currentMonth)) {
                                                        shiftMonth(1);
                                                    }
                                                }}
                                                disabled={calendarMonthStart.getFullYear() >= new Date().getFullYear() && calendarMonthStart.getMonth() >= new Date().getMonth()}
                                                className="flex items-center justify-center w-9 h-9 rounded-xl border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed dark:border-white/15 dark:bg-[#1a1a1a] dark:text-[#d7d7d7]"
                                            >
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
                                                    const events = reportsByDayKey[dateKey] || [];
                                                    const isFuture = startOfDay(cell.date) > startOfDay(new Date());
                                                    return (
                                                        <div
                                                            key={dateKey}
                                                            onClick={() => !isFuture && handleCalendarDayClick(cell.date)}
                                                            onMouseEnter={() => !isFuture && setHoveredDate(cell.date)}
                                                            onMouseLeave={() => !isFuture && setHoveredDate(null)}
                                                            className={`min-h-[120px] border-r border-b border-slate-200 dark:border-white/10 p-3 transition-all relative z-0 ${
                                                                isFuture
                                                                ? "bg-slate-50/20 opacity-30 cursor-not-allowed dark:bg-[#111111]"
                                                                : "cursor-pointer hover:border-primary/50 dark:hover:border-primary/50 hover:scale-[1.02] hover:shadow-[0_8px_30px_rgba(0,0,0,0.12)] hover:z-10"
                                                            } ${
                                                                cell.isCurrentMonth
                                                                ? "bg-white dark:bg-[#1f1f1f]"
                                                                : "bg-slate-50/50 lg:opacity-60 dark:bg-[#1a1a1a]"
                                                            }`}
                                                        >
                                                            <div className="flex items-center justify-between mb-2">
                                                                <p className={`text-[13px] font-bold ${
                                                                    getDateKey(new Date()) === dateKey 
                                                                    ? "bg-primary text-white w-6 h-6 flex items-center justify-center rounded-full" 
                                                                    : "text-slate-600 dark:text-[#b6b8cf] px-1"
                                                                }`}>
                                                                    {cell.date.getDate()}
                                                                </p>
                                                            </div>
                                                            <div className="space-y-1.5">
                                                                {loading ? (
                                                                   (cell.date.getDate() % 4 === 0) ? (
                                                                        <ShimmerSkeleton className="w-[90%] h-6 rounded-[10px]" />
                                                                   ) : (cell.date.getDate() % 9 === 0) ? (
                                                                        <>
                                                                            <ShimmerSkeleton className="w-full h-6 rounded-[10px]" />
                                                                            <ShimmerSkeleton className="w-3/4 h-6 rounded-[10px] mt-1" />
                                                                        </>
                                                                   ) : null
                                                                ) : (
                                                                    <>
                                                                        {events.slice(0, 3).map((report) => {
                                                                            const eventStyle = getEventStyle(report.session.type);
                                                                            const label = interviewTypeLabels[report.session.type] || report.session.type;
                                                                            return (
                                                                                <div
                                                                                    key={report.id}
                                                                                    className={`w-full rounded-[10px] border-l-4 px-2.5 py-1.5 text-left text-[11px] ${eventStyle.bgClass} ${eventStyle.textClass}`}
                                                                                    style={{ borderLeftColor: eventStyle.base }}
                                                                                >
                                                                                    <p className="truncate font-bold tracking-tight">{label}</p>
                                                                                </div>
                                                                            );
                                                                        })}
                                                                        {events.length > 3 && (
                                                                            <div className="text-[10px] font-semibold text-slate-400 pl-1 mt-1">
                                                                                +{events.length - 3} more
                                                                            </div>
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
                            )}

                            {viewMode === "timeline" && (
                                <div className="flex flex-col gap-8 w-full animate-in fade-in slide-in-from-bottom-2 duration-300">
                                    <div className="flex justify-end">
                                        {/* Heading intentionally omitted as per request */}
                                        <button 
                                            onClick={() => setViewMode("calendar")}
                                            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-bold text-primary bg-primary/10 hover:bg-primary/20 transition-colors"
                                        >
                                            Back to Calendar
                                        </button>
                                    </div>

                                    {/* Month Scroller Strip */}
                                    <div className="relative group -mb-2">
                                        <div 
                                            className="absolute top-0 bottom-0 left-0 w-16 z-20 cursor-w-resize"
                                            onMouseEnter={() => startMonthScroll(-1)}
                                            onMouseLeave={stopMonthScroll}
                                        />
                                        <div className="flex items-stretch justify-start gap-1 overflow-x-auto overflow-y-hidden [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] py-1 px-1 [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]">
                                            {timelineMonths.map((monthDate, idx) => {
                                                const isSelected = monthDate.getMonth() === selectedDate.getMonth() && monthDate.getFullYear() === selectedDate.getFullYear();
                                                const dist = Math.abs(idx - 5);
                                                const scaleClass = isSelected ? 'scale-[1.15]' : dist < 2 ? 'scale-105' : dist < 3 ? 'scale-100' : dist < 4 ? 'scale-[0.95]' : 'scale-90';
                                                const isFuture = monthDate.getFullYear() > new Date().getFullYear() || (monthDate.getFullYear() === new Date().getFullYear() && monthDate.getMonth() > new Date().getMonth());
                                                return (
                                                    <button
                                                        key={`tm-${monthDate.getFullYear()}-${monthDate.getMonth()}`}
                                                        onClick={() => {
                                                            if (!isFuture) {
                                                                const newAnchor = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
                                                                smoothCenterDate(newAnchor);
                                                            }
                                                        }}
                                                        disabled={isFuture}
                                                        className={`relative flex-1 min-w-[80px] shrink-0 py-2 px-1 transition-all duration-500 ease-out font-bold text-[12px] uppercase tracking-wider ${scaleClass} ${
                                                            isFuture ? 'text-slate-300 dark:text-slate-600 opacity-20 cursor-not-allowed' :
                                                            isSelected 
                                                            ? 'text-slate-900 dark:text-white z-10 opacity-100' 
                                                            : 'text-slate-400 dark:text-slate-500 opacity-40 hover:opacity-100 hover:text-slate-700 dark:hover:text-slate-300 hover:scale-110'
                                                        }`}
                                                    >
                                                        {monthDate.toLocaleDateString("en-US", { month: "short", year: "numeric" })}
                                                    </button>
                                                )
                                            })}
                                        </div>
                                        <div 
                                            className="absolute top-0 bottom-0 right-0 w-16 z-20 cursor-e-resize"
                                            onMouseEnter={() => startMonthScroll(1)}
                                            onMouseLeave={stopMonthScroll}
                                        />
                                    </div>

                                    {/* 10-Date Scroller Strip */}
                                    <div className="relative group">
                                        <div 
                                            className="absolute top-0 bottom-0 left-0 w-16 z-20 cursor-w-resize"
                                            onMouseEnter={() => startDateScroll(-1)}
                                            onMouseLeave={stopDateScroll}
                                        />
                                        <div className="flex items-stretch justify-start gap-1 overflow-x-auto overflow-y-hidden [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] py-2 px-1 [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]">
                                            {timelineDates.map((date, idx) => {
                                                const isSelected = selectedDateKey === getDateKey(date);
                                                const isToday = getDateKey(date) === getDateKey(new Date());
                                                const dateEventsCount = (reportsByDayKey[getDateKey(date)] || []).length;
                                                
                                                // Find the index of the selected date or fallback to center (4) if null/distant
                                                let selectedIdx = timelineDates.findIndex(d => getDateKey(d) === selectedDateKey);
                                                if (selectedIdx === -1) selectedIdx = 4; // default center indexing if selected not in view
                                                
                                                // Calculate distance from the "focused" item
                                                const dist = Math.abs(idx - selectedIdx);
                                                const scaleClass = isSelected ? 'scale-125' : dist < 2 ? 'scale-110' : dist < 4 ? 'scale-100' : dist < 6 ? 'scale-95' : 'scale-90';
                                                
                                                const isFuture = startOfDay(date) > startOfDay(new Date());
                                                
                                                return (
                                                    <button
                                                        key={getDateKey(date)}
                                                        onClick={() => { if (!isFuture) smoothCenterDate(date); }}
                                                        disabled={isFuture}
                                                        className={`relative flex-1 min-w-[70px] shrink-0 flex flex-col items-center justify-center py-3 px-1 transition-all duration-500 ease-out group/date origin-center ${scaleClass} ${
                                                            isFuture ? 'opacity-20 cursor-not-allowed grayscale' :
                                                            isSelected 
                                                            ? 'z-10 opacity-100' 
                                                            : 'opacity-40 hover:opacity-100 hover:scale-110 hover:z-10'
                                                        }`}
                                                    >
                                                        <span className={`text-[10px] uppercase font-extrabold tracking-[0.15em] transition-colors duration-500 ${isSelected ? 'text-primary' : 'text-slate-500 dark:text-slate-400 group-hover/date:text-slate-700 dark:group-hover/date:text-slate-300'}`}>
                                                            {date.toLocaleDateString("en-US", { weekday: "short" })}
                                                        </span>
                                                        <span className={`text-[24px] font-bold font-outfit mt-0.5 mb-0.5 leading-none transition-colors duration-500 ${isSelected ? 'text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400 group-hover/date:text-slate-800 dark:group-hover/date:text-slate-200'}`}>
                                                            {date.getDate()}
                                                        </span>
                                                        <span className={`text-[9px] font-bold uppercase tracking-[0.1em] transition-colors duration-500 ${isSelected ? 'text-primary/70' : 'text-slate-400 dark:text-slate-500'}`}>
                                                            {date.toLocaleDateString("en-US", { month: "short" })}
                                                        </span>
                                                        
                                                        {loading ? (
                                                            (date.getDate() % 3 === 0) ? (
                                                                <div className={`absolute bottom-0.5 w-[5px] h-[5px] rounded-full transition-colors duration-500 animate-pulse bg-slate-300 dark:bg-slate-600`} />
                                                            ) : null
                                                        ) : dateEventsCount > 0 && (
                                                            <div className={`absolute bottom-0.5 w-[5px] h-[5px] rounded-full transition-colors duration-500 ${isSelected ? 'bg-primary' : 'bg-slate-300 dark:bg-slate-600'}`} />
                                                        )}
                                                    </button>
                                                )
                                            })}
                                        </div>
                                        <div 
                                            className="absolute top-0 bottom-0 right-0 w-16 z-20 cursor-e-resize"
                                            onMouseEnter={() => startDateScroll(1)}
                                            onMouseLeave={stopDateScroll}
                                        />
                                    </div>

                                    {/* Selected Date Details */}
                                    <div className="mt-10 mb-16 pl-2">
                                        <h4 className="text-[22px] font-bold mb-10 font-nunito text-slate-800 dark:text-white">
                                            {selectedDate.toLocaleDateString("en-US", { weekday: "long" })}, {selectedDate.getDate()} {selectedDate.toLocaleDateString("en-US", { month: "long" })}, {selectedDate.getFullYear()}
                                        </h4>
                                        
                                        {loading ? (
                                            <div className="relative w-full">
                                                <div className="absolute top-6 bottom-6 w-0.5 bg-slate-200 dark:bg-slate-700/50 z-0" style={{ left: '119px' }} />
                                                <div className="flex flex-col gap-8 w-full relative z-10">
                                                    {[1, 2, 3].map(i => (
                                                        <div key={i} className="relative flex items-center group w-full">
                                                            <div className="w-[100px] text-right pr-6 shrink-0">
                                                                <ShimmerSkeleton className="w-12 h-4 ml-auto" />
                                                            </div>
                                                            <div className="w-10 flex justify-center z-10 shrink-0">
                                                                <ShimmerSkeleton className="w-3.5 h-3.5 rounded-full" />
                                                            </div>
                                                            <div className="flex-1 pl-8 w-full">
                                                                <ShimmerSkeleton className="w-full h-28 rounded-2xl" />
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        ) : eventsForSelectedDate.length > 0 ? (
                                            <div className="relative w-full">
                                                {/* Continuous Timeline Line */}
                                                <div className="absolute top-6 bottom-6 w-0.5 bg-slate-200 dark:bg-slate-700/50 z-0" style={{ left: '119px' }} />

                                                <div className="flex flex-col gap-8 w-full relative z-10">
                                                    {eventsForSelectedDate.map(report => {
                                                        const eventStyle = getEventStyle(report.session.type);
                                                        const cardInfo = reportTypeCards.find(c => c.type === report.session.type);
                                                        const label = interviewTypeLabels[report.session.type] || report.session.type;
                                                        const timeString = new Date(report.generatedAt).toLocaleTimeString("en-US", { hour: 'numeric', minute: '2-digit', hour12: true });
                                                        
                                                        return (
                                                            <div key={report.id} className="relative flex items-center group w-full">
                                                                {/* Time on Left */}
                                                                <div className="w-[100px] text-right pr-6 shrink-0">
                                                                    <span className="text-[15px] font-bold text-slate-500 dark:text-slate-400 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                                                                        {timeString}
                                                                    </span>
                                                                </div>

                                                                {/* Timeline Dot in Center Axis */}
                                                                <div className="w-10 flex justify-center z-10 shrink-0">
                                                                    <div className="w-3.5 h-3.5 rounded-full bg-slate-300 dark:bg-slate-600 ring-[6px] ring-[#F8F9FA] dark:ring-lc-background group-hover:scale-125 group-hover:bg-blue-500 transition-all duration-300 shadow-sm" />
                                                                </div>

                                                                {/* Card on Right */}
                                                                <div className="flex-1 pl-8 w-full">
                                                                    <div 
                                                                        onClick={() => router.push(getReportHref(report))}
                                                                        className="mr-auto w-full rounded-2xl border border-slate-200/80 dark:border-white/5 bg-white dark:bg-lc-surface shadow-sm hover:shadow-xl hover:-translate-y-1 hover:border-blue-300 dark:hover:border-blue-500/40 transition-all duration-300 cursor-pointer overflow-hidden group-hover:ring-4 group-hover:ring-blue-500/10 dark:group-hover:ring-blue-500/20"
                                                                    >
                                                                        <div className="flex flex-col sm:flex-row p-6 gap-6 sm:items-center relative">
                                                                            {/* Background gradient hint */}
                                                                            <div className="absolute inset-0 opacity-0 group-hover:opacity-[0.03] dark:group-hover:opacity-[0.05] transition-opacity duration-300 pointer-events-none" style={{ background: `linear-gradient(135deg, ${eventStyle.base} 0%, transparent 100%)` }} />
                                                                            
                                                                            <div className="flex-1 min-w-0">
                                                                                <h5 className="font-extrabold text-[19px] text-slate-800 dark:text-white leading-tight truncate">{label}</h5>
                                                                            </div>
                                                                            
                                                                            <div className="flex items-center justify-between sm:justify-end gap-8 pt-4 sm:pt-0 mt-4 sm:mt-0 border-t sm:border-t-0 border-slate-100 dark:border-white/5">
                                                                                <div className="flex flex-col items-start sm:items-end">
                                                                                    <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Total Score</span>
                                                                                    <div className="flex items-baseline gap-1 bg-slate-50 dark:bg-slate-800/60 px-3 py-1 rounded-lg">
                                                                                        <span className={`text-[20px] font-black ${eventStyle.textClass.replace('bg-', 'text-').replace('text-white', 'text-slate-800 dark:text-white')} leading-none`}>
                                                                                            {report.overallScore}
                                                                                        </span>
                                                                                        <span className="text-[14px] font-bold text-slate-400 leading-none">%</span>
                                                                                    </div>
                                                                                </div>
                                                                                
                                                                                <div className="flex items-center justify-center w-11 h-11 rounded-full bg-slate-50 dark:bg-slate-800 text-slate-400 group-hover:bg-blue-600 group-hover:text-white dark:group-hover:bg-blue-500 transition-all duration-300 shadow-sm shrink-0">
                                                                                    <span className="material-symbols-outlined text-[20px] group-hover:translate-x-0.5 transition-transform duration-300">arrow_forward</span>
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        )
                                                    })}
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="flex flex-col items-center justify-center py-16 text-slate-500 dark:text-[#8f93b8]">
                                                <div className="w-20 h-20 rounded-full bg-slate-100 dark:bg-[#1a1a1a] flex items-center justify-center mb-5">
                                                    <span className="material-symbols-outlined text-[36px] opacity-60">event_busy</span>
                                                </div>
                                                <h5 className="text-[18px] font-bold text-slate-700 dark:text-white mb-2 font-nunito">No interview taken</h5>
                                                <p className="text-[14px]">You didn't complete any mock interviews on this date.</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                        </div>
                    </section>

                </div>

            </main>
            </div>
        </div>
    );
}
