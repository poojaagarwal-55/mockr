"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { useAuth } from "@/context/auth-context";
import { api } from "@/lib/api";
import { INTERVIEW_TYPE_MAP } from "@interviewforge/shared";

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

type SortOption = "newest" | "oldest" | "highestScore" | "lowestScore";
type TimeFilter = "all" | "last7days" | "lastMonth" | "customDate";

function resolveRoleLabel(interviewType?: string, storedRole?: string): string {
    if (interviewType === "data_science_role") return "Data Scientist";
    if (interviewType === "pm_role") return "Product Manager";
    if (interviewType === "gen_ai_role") return "GenAI Engineer";
    return storedRole || "SDE";
}

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


function CustomDatePicker({ date, onChange, validDates }: { date: string, onChange: (d: string) => void, validDates: Set<string> }) {
    const [open, setOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const [viewYear, setViewYear] = useState(() => date ? parseInt(date.split('-')[0]) : new Date().getFullYear());
    const [viewMonth, setViewMonth] = useState(() => date ? parseInt(date.split('-')[1]) - 1 : new Date().getMonth());
    
    // Auto-update internal view when external date changes
    useEffect(() => {
        if(date) {
            setViewYear(parseInt(date.split('-')[0]));
            setViewMonth(parseInt(date.split('-')[1]) - 1);
        }
    }, [date]);

    // Click outside handler
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (open && containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [open]);

    // Calendar generation
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const firstDay = new Date(viewYear, viewMonth, 1).getDay(); // 0 is Sunday
    const days = [];
    const today = new Date();
    today.setHours(0,0,0,0);

    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) days.push(i);

    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const yearRange = Array.from({length: 10}, (_, i) => new Date().getFullYear() - i);

    return (
        <div className="relative group flex-1 sm:flex-none animate-in fade-in zoom-in-95 duration-200" ref={containerRef}>
            <button
                className="flex items-center justify-between h-10 w-full sm:w-[160px] rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 shadow-sm outline-none transition-all hover:bg-slate-50 focus:border-[#6C63FF] focus:ring-2 focus:ring-[#6C63FF]/20 dark:border-white/10 dark:bg-[#1a1a1a] dark:text-slate-200 dark:hover:bg-[#242424]"
                onClick={() => setOpen(!open)}
            >
                <span className="truncate">{date ? new Date(parseInt(date.split('-')[0]), parseInt(date.split('-')[1])-1, parseInt(date.split('-')[2])).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Select Date"}</span>
                <span className="material-symbols-outlined text-[16px] text-slate-400 group-hover:text-[#6C63FF] dark:group-hover:text-[#B7B2FF]">calendar_month</span>
            </button>

            {open && (
                <div className="absolute right-0 sm:right-auto sm:left-0 top-[calc(100%+8px)] w-[300px] z-[100] rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.15)] dark:border-white/10 dark:bg-[#1a1a1a] flex flex-col gap-4 animate-in zoom-in-95 duration-200 origin-top-left">
                    <div className="flex items-center gap-2 w-full">
                        {/* Month Section */}
                        <div className="flex-[1.5] relative group/select">
                            <select
                                disabled={viewYear === today.getFullYear() && viewMonth > today.getMonth()}
                                className="w-full appearance-none rounded-xl border border-slate-200/60 bg-slate-50/50 px-3 py-2 text-[13px] font-bold text-slate-700 shadow-inner outline-none transition-all hover:bg-white focus:border-[#6C63FF] dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                value={viewMonth}
                                onChange={e => setViewMonth(Number(e.target.value))}
                            >
                                {months.map((m, i) => (
                                    <option key={m} value={i} disabled={viewYear === today.getFullYear() && i > today.getMonth()}>
                                        {m}
                                    </option>
                                ))}
                            </select>
                            <span className="material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 text-[16px] text-slate-400 pointer-events-none group-hover/select:text-[#6C63FF]">expand_more</span>
                        </div>
                        {/* Year Section */}
                        <div className="flex-1 relative group/select">
                            <select
                                className="w-full appearance-none rounded-xl border border-slate-200/60 bg-slate-50/50 px-3 py-2 text-[13px] font-bold text-slate-700 shadow-inner outline-none transition-all hover:bg-white focus:border-[#6C63FF] dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200 cursor-pointer"
                                value={viewYear}
                                onChange={e => setViewYear(Number(e.target.value))}
                            >
                                {yearRange.map(y => (
                                    <option key={y} value={y}>{y}</option>
                                ))}
                            </select>
                            <span className="material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 text-[16px] text-slate-400 pointer-events-none group-hover/select:text-[#6C63FF]">expand_more</span>
                        </div>
                    </div>

                    {/* Date Section */}
                    <div className="w-full relative z-[110]">
                        <div className="grid grid-cols-7 mb-2">
                            {['Su','Mo','Tu','We','Th','Fr','Sa'].map(day => (
                                <div key={day} className="text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest">{day}</div>
                            ))}
                        </div>
                        <div className="grid grid-cols-7 gap-1 relative">
                            {days.map((dayNum, i) => {
                                if (!dayNum) return <div key={`empty-${i}`} className="h-8 w-8" />;
                                
                                const dateStr = `${viewYear}-${String(viewMonth+1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
                                const dObj = new Date(viewYear, viewMonth, dayNum);
                                const isFuture = dObj.getTime() > today.getTime();
                                const isValid = validDates.has(dateStr);
                                const isSelected = date === dateStr;

                                // Base style for neutral
                                let cellStyle = "flex h-8 w-8 items-center justify-center rounded-lg text-[13px] font-bold cursor-pointer transition-all duration-300 relative group/cell z-20 ";
                                
                                if (isFuture) {
                                    cellStyle += "text-slate-300 dark:text-slate-700 cursor-not-allowed hidden md:flex opacity-50"; // Can be hidden or opacity reduced
                                } else if (isSelected) {
                                    cellStyle += "bg-[#6C63FF] text-white shadow-md shadow-[#6C63FF]/30 scale-[1.05]";
                                } else if (!isValid) {
                                    cellStyle += "text-slate-400 dark:text-slate-500 hover:bg-slate-50 dark:hover:bg-white/5 cursor-[not-allowed]";
                                } else {
                                    cellStyle += "text-slate-700 dark:text-slate-200 hover:bg-slate-100 hover:text-[#6C63FF] dark:hover:bg-white/10 dark:hover:text-[#B7B2FF]";
                                }

                                return (
                                    <div key={dayNum} className="relative flex items-center justify-center">
                                        <button 
                                            onClick={() => {
                                                if (!isFuture && isValid) {
                                                    onChange(dateStr);
                                                    setOpen(false);
                                                }
                                            }}
                                            className={cellStyle}
                                        >
                                            <span className={(isFuture || !isValid) && !isSelected ? "opacity-70" : ""}>{dayNum}</span>
                                            
                                            {/* Advanced Custom Hover Cursor + Info Panel - "red cross + tooltip" */}
                                            {(!isValid && !isFuture) && (
                                                <div className="fixed sm:absolute opacity-0 group-hover/cell:opacity-100 transition-opacity pointer-events-none group-hover/cell:scale-100 scale-95 duration-200 bottom-[calc(100%+8px)] left-1/2 -translate-x-1/2 bg-red-500/95 backdrop-blur-md text-white text-[11px] px-3 py-2 rounded-xl shadow-[0_5px_20px_-5px_rgba(239,68,68,0.5)] whitespace-nowrap z-[999] flex flex-col items-center">
                                                    <div className="flex items-center gap-1.5 font-nunito font-bold tracking-wide">
                                                        <div className="w-4 h-4 rounded-full bg-white text-red-500 flex items-center justify-center -ml-1">
                                                            <span className="material-symbols-outlined text-[10px] font-bold">close</span>
                                                        </div>
                                                        No interviews for this date
                                                    </div>
                                                    <div className="absolute top-full left-1/2 -translate-x-1/2 border-[6px] border-transparent border-t-red-500/95" />
                                                </div>
                                            )}
                                        </button>
                                        {isValid && !isSelected && (
                                            <div className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-[#63C6FF] group-hover/cell:bg-[#6C63FF] transition-colors" />
                                        )}
                                        {(!isValid && !isFuture && !isSelected) && (
                                            <div className="absolute inset-0 z-50" style={{ cursor: "url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"20\" height=\"20\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"%23ef4444\" stroke-width=\"3\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><line x1=\"18\" y1=\"6\" x2=\"6\" y2=\"18\"></line><line x1=\"6\" y1=\"6\" x2=\"18\" y2=\"18\"></line></svg>') 10 10, auto" }} />
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function CustomSortDropdown({ value, onChange }: { value: SortOption, onChange: (v: SortOption) => void }) {
    const [open, setOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (open && containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [open]);

    const options: {v: SortOption, l: string, icon: string}[] = [
        { v: "newest", l: "Newest First", icon: "schedule" },
        { v: "oldest", l: "Oldest First", icon: "history" },
        { v: "highestScore", l: "Highest Score", icon: "trending_up" },
        { v: "lowestScore", l: "Lowest Score", icon: "trending_down" },
    ];

    const selectedOption = options.find(o => o.v === value) || options[0];

    return (
        <div className="relative z-[90] group flex-1 sm:flex-none min-w-[190px]" ref={containerRef}>
            <button
                className="flex items-center justify-between h-10 w-full rounded-xl border border-slate-200 bg-white px-4 text-[13px] font-bold text-slate-700 shadow-sm outline-none transition-all hover:bg-slate-50 focus:border-[#6C63FF] focus:ring-2 focus:ring-[#6C63FF]/20 dark:border-white/10 dark:bg-[#1a1a1a] dark:text-slate-200 dark:hover:bg-[#242424]"
                onClick={() => setOpen(!open)}
            >
                <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[18px] text-[#6C63FF]">{selectedOption.icon}</span>
                    <span>{selectedOption.l}</span>
                </div>
                <span className={`material-symbols-outlined text-[16px] text-slate-400 transition-transform duration-300 ${open ? 'rotate-180 text-[#6C63FF]' : ''}`}>expand_more</span>
            </button>

            {open && (
                <div className="absolute right-0 top-[calc(100%+8px)] w-full sm:w-[220px] rounded-2xl border border-slate-200/80 bg-white p-2 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.15)] dark:border-white/10 dark:bg-[#1a1a1a] flex flex-col gap-1 animate-in zoom-in-95 duration-200 origin-top-right">
                    {options.map((opt) => (
                        <button
                            key={opt.v}
                            onClick={() => { onChange(opt.v); setOpen(false); }}
                            className={`flex items-center gap-3 w-full text-left px-3 py-3 rounded-xl text-[13px] font-bold transition-all duration-200 ${
                                value === opt.v ? "bg-[#6C63FF]/10 text-[#6C63FF] dark:bg-[#6C63FF]/20 dark:text-[#B7B2FF]" : "text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-white/5"
                            }`}
                        >
                            <span className={`material-symbols-outlined text-[18px] ${value === opt.v ? 'text-[#6C63FF]' : 'opacity-60'}`}>{opt.icon}</span>
                            {opt.l}
                            {value === opt.v && <span className="material-symbols-outlined ml-auto text-[18px] animate-in zoom-in">check</span>}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

type ReportTypeViewProps = {
    backUrl?: string;
    reportsEndpoint?: string;
    getReportHref?: (report: ReportListItem, type: string) => string;
    deleteReportEndpoint?: ((reportId: string) => string | null) | null;
};

export default function ReportTypeView({
    backUrl = "/reports",
    reportsEndpoint = "/users/me/reports",
    getReportHref = (report, type) => `/reports/${report.sessionId}?from=/reports/type/${type}`,
    deleteReportEndpoint = (reportId) => `/users/me/reports/${reportId}`,
}: ReportTypeViewProps = {}) {

    const router = useRouter();
    const params = useParams();
    const { session: authSession } = useAuth();

    const type = typeof params?.type === "string" ? params.type : "";

    const [reports, setReports] = useState<ReportListItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [sortOrder, setSortOrder] = useState<SortOption>("newest");
    const [timeFilter, setTimeFilter] = useState<TimeFilter>("all");
    const [customDate, setCustomDate] = useState<string>("");
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
    const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());

    const toggleDate = (dateStr: string) => {
        setExpandedDates(prev => {
            const next = new Set(prev);
            if (next.has(dateStr)) next.delete(dateStr);
            else next.add(dateStr);
            return next;
        });
    };

    useEffect(() => {
        const token = authSession?.access_token;
        if (!token) return;

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
    }, [authSession?.access_token, reportsEndpoint]);

    const validDates = useMemo(() => {
        const set = new Set<string>();
        reports.forEach(report => {
            if (report.session.type === type) {
                const d = new Date(report.generatedAt);
                set.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
            }
        });
        return set;
    }, [reports, type]);

    const interviewTypeLabel = useMemo(() => {

        const label = INTERVIEW_TYPE_MAP[type as keyof typeof INTERVIEW_TYPE_MAP]?.label || type;
        return label.toLowerCase().includes("interview") ? label : `${label} Interview`;
    }, [type]);

    const filteredReports = useMemo(() => {
        let result = reports.filter((report) => report.session.type === type);

        const now = new Date();
        now.setHours(0, 0, 0, 0);

        if (timeFilter === "last7days") {
            const sevenDaysAgo = new Date(now);
            sevenDaysAgo.setDate(now.getDate() - 7);
            result = result.filter(report => new Date(report.generatedAt).getTime() >= sevenDaysAgo.getTime());
        } else if (timeFilter === "lastMonth") {
            const oneMonthAgo = new Date(now);
            oneMonthAgo.setMonth(now.getMonth() - 1);
            result = result.filter(report => new Date(report.generatedAt).getTime() >= oneMonthAgo.getTime());
        } else if (timeFilter === "customDate" && customDate) {
            result = result.filter(report => {
                const reportDateStr = new Date(report.generatedAt).toLocaleDateString("en-CA"); // YYYY-MM-DD
                return reportDateStr === customDate;
            });
        }

        result.sort((a, b) => {
            if (sortOrder === "highestScore") return b.overallScore - a.overallScore;
            if (sortOrder === "lowestScore") return a.overallScore - b.overallScore;
            
            const da = new Date(a.generatedAt).getTime();
            const db = new Date(b.generatedAt).getTime();
            return sortOrder === "newest" ? db - da : da - db;
        });

        return result;
    }, [reports, sortOrder, timeFilter, customDate, type]);

    const groupedReports = useMemo(() => {
        const groups: { date: string; reports: ReportListItem[] }[] = [];
        let currentGroup: { date: string; reports: ReportListItem[] } | null = null;

        filteredReports.forEach((report) => {
            const reportDate = new Date(report.generatedAt);
            const dateStr = reportDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
            
            if (!currentGroup || currentGroup.date !== dateStr) {
                currentGroup = { date: dateStr, reports: [] };
                groups.push(currentGroup);
            }
            currentGroup.reports.push(report);
        });
        
        return groups;
    }, [filteredReports]);

    useEffect(() => {
        if (timeFilter === "customDate" && customDate) {
            const [y, m, d] = customDate.split("-");
            if (y && m && d) {
                const dateStr = new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                setExpandedDates(new Set([dateStr]));
            }
        }
    }, [timeFilter, customDate]);

    const totalAttempts = filteredReports.length;
    const avgScore = useMemo(() => {
        if (!filteredReports.length) return 0;
        return Math.round(filteredReports.reduce((sum, report) => sum + report.overallScore, 0) / filteredReports.length);
    }, [filteredReports]);

    const bestScore = useMemo(() => {
        if (!filteredReports.length) return 0;
        return Math.round(Math.max(...filteredReports.map((report) => report.overallScore)));
    }, [filteredReports]);

    const thisWeekCount = useMemo(() => {
        const now = new Date();
        const weekStart = new Date(now);
        weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7));
        weekStart.setHours(0, 0, 0, 0);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 7);
        return filteredReports.filter((report) => {
            const timestamp = new Date(report.generatedAt).getTime();
            return timestamp >= weekStart.getTime() && timestamp < weekEnd.getTime();
        }).length;
    }, [filteredReports]);

    const getEventStyle = (reportType: string) => EVENT_TYPE_STYLES[reportType] || EVENT_TYPE_STYLES.cs_fundamentals;

    const handleDelete = async (reportId: string) => {
        const token = authSession?.access_token;
        const endpoint = deleteReportEndpoint?.(reportId);
        if (!token || !endpoint) return;

        setDeletingId(reportId);
        try {
            await api.delete(endpoint, token);
            setReports((prev) => prev.filter((report) => report.id !== reportId));
        } catch (err: any) {
            console.error("Failed to delete report:", err?.message || err);
        } finally {
            setDeletingId(null);
            setConfirmDeleteId(null);
        }
    };

    return (
        <div className="flex-1 overflow-auto bg-white dark:bg-[#1a1a1a]">
            <PageHeader showBack backUrl={backUrl} title={
                <div className="flex items-center gap-3">
                    <h1 className="text-[28px] font-bold text-slate-900 dark:text-white font-nunito tracking-[-0.02em] capitalize">
                        {interviewTypeLabel}
                    </h1>
                </div>
            } />

            <main className="flex-1 px-4 pb-10 sm:px-6 lg:px-8">
                <div className="flex w-full flex-col gap-6">
                    <div className="flex flex-col gap-5 pt-2">
                        <div className="grid w-full gap-4 sm:grid-cols-3">
                            <div className="rounded-2xl border border-slate-200/60 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-white/[0.04] transition-all hover:shadow-md hover:border-slate-300 dark:hover:border-white/20">
                                <p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-slate-500 dark:text-slate-400">Attempts</p>
                                {loading ? (
                                    <div className="mt-2 h-8 w-16 animate-pulse rounded-md bg-slate-200 dark:bg-lc-hover" />
                                ) : (
                                    <p className="mt-2 font-nunito text-2xl font-bold tracking-[-0.03em] text-slate-800 dark:text-white">{totalAttempts}</p>
                                )}
                            </div>
                            <div className="rounded-2xl border border-slate-200/60 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-white/[0.04] transition-all hover:shadow-md hover:border-slate-300 dark:hover:border-white/20">
                                <p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-slate-500 dark:text-slate-400">Avg score</p>
                                {loading ? (
                                    <div className="mt-2 h-8 w-20 animate-pulse rounded-md bg-slate-200 dark:bg-lc-hover" />
                                ) : (
                                    <p className="mt-2 font-nunito text-2xl font-bold tracking-[-0.03em] text-slate-800 dark:text-white">{avgScore}%</p>
                                )}
                            </div>
                            <div className="rounded-2xl border border-slate-200/60 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-white/[0.04] transition-all hover:shadow-md hover:border-slate-300 dark:hover:border-white/20">
                                <p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-slate-500 dark:text-slate-400">This week</p>
                                {loading ? (
                                    <div className="mt-2 h-8 w-16 animate-pulse rounded-md bg-slate-200 dark:bg-lc-hover" />
                                ) : (
                                    <p className="mt-2 font-nunito text-2xl font-bold tracking-[-0.03em] text-slate-800 dark:text-white">{thisWeekCount}</p>
                                )}
                            </div>
                        </div>

                        <div className="mt-2 flex flex-col gap-4 rounded-2xl bg-white p-2 shadow-sm border border-slate-200/60 dark:border-white/10 dark:bg-[#1a1a1a] sm:flex-row sm:items-center sm:justify-between sm:p-2 sm:pl-4">
                            <div className="flex w-full items-center gap-1 rounded-xl bg-slate-100/80 p-1 dark:bg-white/5 sm:w-auto overflow-x-auto no-scrollbar scroll-smooth">
                                {[
                                    { id: "all", label: "Total Timeline" },
                                    { id: "last7days", label: "Last 7 Days" },
                                    { id: "lastMonth", label: "Last Month" },
                                    { id: "customDate", label: "Custom Date" },
                                ].map((f) => (
                                    <button
                                        key={f.id}
                                        onClick={() => setTimeFilter(f.id as TimeFilter)}
                                        className={`whitespace-nowrap rounded-[10px] px-3.5 py-2 text-xs font-bold transition-all duration-300 ${
                                            timeFilter === f.id
                                                ? "bg-white text-[#6C63FF] shadow-sm ring-1 ring-slate-200/50 dark:bg-[#2a2a2a] dark:text-[#B7B2FF] dark:ring-white/10"
                                                : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-white/5"
                                        }`}
                                    >
                                        {f.label}
                                    </button>
                                ))}
                            </div>

                            <div className="flex flex-wrap items-center gap-3 pr-2 pb-2 sm:pb-0 px-2 sm:px-0 z-[90]">
                                {timeFilter === "customDate" && (
                                    <CustomDatePicker 
                                        date={customDate} 
                                        onChange={setCustomDate} 
                                        validDates={validDates} 
                                    />
                                )}

                                <CustomSortDropdown value={sortOrder} onChange={setSortOrder} />
                            </div>
                        </div>

                        <div className="pt-4 pb-12 w-full">
                                {loading && (
                                    <div className="space-y-3">
                                        {Array.from({ length: 3 }).map((_, idx) => (
                                            <div key={idx} className="h-32 rounded-[18px] bg-slate-100 dark:bg-lc-hover animate-pulse" />
                                        ))}
                                    </div>
                                )}

                                {error && !loading && (
                                    <div className="rounded-[18px] border border-slate-200 bg-white px-6 py-12 text-center dark:border-lc-border dark:bg-lc-surface">
                                        <h3 className="font-nunito text-lg font-bold text-slate-900 dark:text-white">Could not load reports</h3>
                                        <p className="mt-1 text-sm text-slate-500 dark:text-[#ababab]">{error}</p>
                                    </div>
                                )}

                                {!loading && !error && groupedReports.length > 0 && (
                                    <div className="relative ml-2 md:ml-3 space-y-6 pb-6 pt-4">
                                        <div className="absolute left-[3px] top-0 bottom-0 w-[4px] bg-gradient-to-b from-[#6C63FF]/5 via-[#6C63FF]/30 to-[#6C63FF]/5 rounded-full dark:from-[#6C63FF]/10 dark:via-[#6C63FF]/20 dark:to-[#6C63FF]/10" />
                                        {groupedReports.map((group) => {
                                            const isExpanded = expandedDates.has(group.date);
                                            return (
                                                <div key={group.date} className="relative pl-6 md:pl-8 group/node">
                                                        <div 
                                                        className={`absolute -left-[3px] top-[14px] h-4 w-4 cursor-pointer rounded-full border-[3px] border-white shadow-[0_0_0_4px_rgba(108,99,255,0.1)] transition-all duration-300 hover:scale-125 dark:border-[#1a1a1a] z-10 
                                                        ${isExpanded ? 'bg-[#6C63FF] shadow-[0_0_15px_4px_rgba(108,99,255,0.4)]' : 'bg-slate-300 dark:bg-white/20 hover:bg-[#6C63FF]/80'}`}
                                                        onClick={() => toggleDate(group.date)}
                                                    />
                                                    
                                                    {/* Animated wave line connecting down */}
                                                    <div className={`absolute top-[14px] left-[4px] w-[2px] transition-all duration-700 ease-out z-0 origin-top
                                                        ${isExpanded ? 'scale-y-100 bg-gradient-to-b from-[#6C63FF] to-transparent h-full opacity-100' : 'scale-y-0 h-0 opacity-0'}`} 
                                                    />

                                                    <div 
                                                        className={`cursor-pointer select-none group flex items-center justify-between bg-white hover:bg-slate-50/80 hover:shadow-md dark:bg-white/[0.03] dark:hover:bg-white/[0.06] px-5 py-3.5 rounded-[18px] shadow-sm transition-all duration-300 border border-slate-200/60 dark:border-white/5 hover:border-[#6C63FF]/30 hover:translate-x-1 ${isExpanded ? 'ring-1 ring-[#6C63FF]/20 border-[#6C63FF]/30' : ''}`}
                                                        onClick={() => toggleDate(group.date)}
                                                    >
                                                        <div className="flex items-center gap-3">
                                                            <span className="font-nunito text-[15px] sm:text-lg font-bold text-slate-800 transition-colors group-hover/node:text-[#6C63FF] dark:text-white">{group.date}</span>
                                                            <span className="text-[10px] sm:text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                                                                {group.reports.length} report{group.reports.length !== 1 ? 's' : ''}
                                                            </span>
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <span className={`material-symbols-outlined text-slate-400 transition-all duration-300 ${isExpanded ? 'rotate-180 text-[#6C63FF]' : 'group-hover/node:text-slate-600'}`}>
                                                                keyboard_arrow_down
                                                            </span>
                                                        </div>
                                                    </div>

                                                    <div className={`grid transition-[grid-template-rows,opacity] duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] ${isExpanded ? 'grid-rows-[1fr] opacity-100 mt-2' : 'grid-rows-[0fr] opacity-0'}`}>
                                                        <div className="overflow-hidden">
                                                            <div className="relative border-l border-dashed border-slate-200 dark:border-slate-800/80 ml-[18px] mt-4 space-y-4 pt-2 pb-2">
                                                                {group.reports.map((report, idx) => {
                                                                    const eventStyle = getEventStyle(report.session.type);
                                                                    const label = INTERVIEW_TYPE_MAP[report.session.type as keyof typeof INTERVIEW_TYPE_MAP]?.label || report.session.type;
                                                                    const timeStr = new Date(report.generatedAt).toLocaleTimeString("en-US", { hour: 'numeric', minute: '2-digit' });
                                                                    // Staggered arrival delay for inner items
                                                                    const delay = isExpanded ? `${idx * 100}ms` : '0ms';

                                                                    return (
                                                                        <div
                                                                            key={report.id}
                                                                            onClick={() => router.push(getReportHref(report, type))}
                                                                            className={`relative group flex cursor-pointer items-center justify-between rounded-2xl border border-slate-200/50 bg-white p-4 sm:p-5 shadow-sm transition-all duration-500 hover:-translate-y-1 hover:border-slate-300 hover:shadow-md dark:border-white/10 dark:bg-white/[0.02] pl-5 ml-6 md:ml-8 transform opacity-0 ${isExpanded ? 'translate-x-0 opacity-100' : '-translate-x-4'}`}
                                                                            style={{ transitionDelay: delay }}
                                                                        >
                                                                            {/* Horizontal dashed line connecting report to main line */}
                                                                            <div className="absolute top-1/2 -left-[45px] sm:-left-[53px] w-[45px] sm:w-[53px] h-[1px] border-b border-dashed border-slate-200 dark:border-white/10 -z-10 transition-all duration-700 ease-out delay-300 origin-left" style={{ transform: isExpanded ? 'scaleX(1)' : 'scaleX(0)' }} />
                                                                            {/* Small dot next to the inner box */}
                                                                            <div className="absolute -left-[5px] top-1/2 -translate-y-1/2 h-2.5 w-2.5 rounded-full border border-white bg-slate-300 dark:border-[#1a1a1a] dark:bg-white/20 transition-colors group-hover:bg-[#6C63FF]" />
                                                                            
                                                                            <div className="flex items-center gap-4 md:gap-6">
                                                                                <div className={`relative size-14 md:size-16 shrink-0 rounded-full border-4 flex items-center justify-center ${report.overallScore >= 80
                                                                                    ? "border-green-50 bg-green-500/10 text-green-600 dark:border-green-900/30 dark:text-green-400"
                                                                                    : report.overallScore >= 60
                                                                                        ? "border-primary/10 bg-primary/10 text-primary dark:border-primary/20"
                                                                                        : "border-red-50 bg-red-500/10 text-red-600 dark:border-red-900/30 dark:text-red-400"
                                                                                    }`}>
                                                                                    <span className="font-nunito text-lg md:text-xl font-bold">{Math.round(report.overallScore)}</span>
                                                                                </div>

                                                                                <div className="space-y-1.5">
                                                                                    <div className="flex items-center gap-2.5">
                                                                                        <span className="material-symbols-outlined text-[18px] md:text-[20px] text-slate-700 dark:text-slate-300">
                                                                                            assignment
                                                                                        </span>
                                                                                        <h3 className="font-nunito text-base md:text-lg font-bold text-slate-900 transition-colors group-hover:text-slate-700 dark:text-white truncate max-w-[150px] sm:max-w-xs">
                                                                                            {label}
                                                                                        </h3>
                                                                                    </div>
                                                                                    <div className="flex items-center gap-3 pl-1">
                                                                                        <div className="flex items-center gap-1.5 text-[11px] md:text-xs text-slate-500 dark:text-[#ababab]">
                                                                                            <span className="material-symbols-outlined text-[13px] md:text-[14px]">schedule</span>
                                                                                            {timeStr}
                                                                                        </div>
                                                                                        <div className="flex items-center gap-1.5 text-[11px] md:text-xs text-slate-500 dark:text-[#ababab]">
                                                                                            <span className="material-symbols-outlined text-[13px] md:text-[14px]">person</span>
                                                                                            {resolveRoleLabel(report.session.type, report.session.role)}
                                                                                        </div>
                                                                                    </div>
                                                                                </div>
                                                                            </div>

                                                                            <div className="flex items-center gap-2">
                                                                                {deleteReportEndpoint && confirmDeleteId === report.id ? (
                                                                                    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                                                                                        <button
                                                                                            onClick={() => handleDelete(report.id)}
                                                                                            disabled={deletingId === report.id}
                                                                                            className="cursor-pointer rounded-lg bg-red-500 px-2 py-1.5 md:px-3 text-[10px] md:text-xs font-semibold text-white transition-colors hover:bg-red-600 disabled:opacity-50"
                                                                                        >
                                                                                            {deletingId === report.id ? "..." : "Confirm"}
                                                                                        </button>
                                                                                        <button
                                                                                            onClick={() => setConfirmDeleteId(null)}
                                                                                            className="cursor-pointer rounded-lg bg-slate-100 px-2 py-1.5 md:px-3 text-[10px] md:text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-200 dark:bg-lc-hover dark:text-[#ababab] dark:hover:bg-lc-border"
                                                                                        >
                                                                                            Cancel
                                                                                        </button>
                                                                                    </div>
                                                                                ) : deleteReportEndpoint ? (
                                                                                    <button
                                                                                        aria-label="Delete report"
                                                                                        onClick={(e) => {
                                                                                            e.stopPropagation();
                                                                                            setConfirmDeleteId(report.id);
                                                                                        }}
                                                                                        className="cursor-pointer rounded-lg p-2 text-slate-400 opacity-0 transition-all hover:bg-red-50 hover:text-red-500 group-hover:opacity-100 focus-visible:opacity-100 dark:text-[#6b6b6b] dark:hover:bg-red-500/10 dark:hover:text-red-400"
                                                                                    >
                                                                                        <span className="material-symbols-outlined text-lg md:text-xl">delete</span>
                                                                                    </button>
                                                                                ) : null}

                                                                                <div className="hidden sm:flex items-center text-slate-300 transition-colors group-hover:text-primary dark:text-[#6b6b6b]">
                                                                                    <span className="material-symbols-outlined text-xl md:text-2xl transition-transform group-hover:translate-x-1">chevron_right</span>
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}

                                {!loading && !error && filteredReports.length === 0 && (
                                    <div className="rounded-[18px] border border-dashed border-slate-200 bg-white px-6 py-12 text-center dark:border-lc-border dark:bg-lc-surface">
                                        <span className="material-symbols-outlined mb-3 text-4xl text-slate-300">search_off</span>
                                        <h3 className="font-nunito text-lg font-bold text-slate-900 dark:text-white">No reports found</h3>
                                        <p className="mt-1 text-sm text-slate-500 dark:text-[#ababab]">
                                            Complete this interview type to see reports here.
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
            </main>
        </div>
    );
}
