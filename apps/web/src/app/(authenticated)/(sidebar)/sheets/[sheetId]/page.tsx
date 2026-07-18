"use client";

import { useEffect, useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import Link from "next/link";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/page-header";

/* ═══════════════ Types ═══════════════ */

interface TutorQuestion {
    id: string;
    question: string;
    whatWeAreLookingFor: string;
    category: string;
    difficulty: string;
}

interface QuestionProgress {
    status: "unattempted" | "attempted" | "completed";
    attempts: number;
    lastAnswer: string | null;
    feedback: any;
}

interface Sheet {
    sheetId: string;
    reportId: string;
    sessionId: string;
    label: string;
    generatedAt: string;
    questions: TutorQuestion[];
    progress: Record<string, QuestionProgress>;
}

/* ═══════════════ Helpers ═══════════════ */

function toLabel(v: string) {
    return v.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

/** Extract MongoDB ObjectId from sheet question ID like "cs-64f1a2b..." */
function extractMongoId(sheetQId: string): string | null {
    const match = sheetQId.match(/^(?:cs|dsa|sql|sd)-(.+)$/);
    return match ? match[1] : null;
}

/** Determine the solve URL for a question based on its ID prefix and category */
function getSolveUrl(q: TutorQuestion, sheetId: string): string | null {
    const mongoId = extractMongoId(q.id);
    if (!mongoId) return null; // AI-generated (beh-*, fallback-*) — no solve page

    const cat = q.category.toLowerCase();
    let baseUrl = "";
    if (cat === "os" || cat === "cn" || cat === "dbms" || cat === "oops" || cat === "cs_fundamentals") {
        baseUrl = `/questions/cs-fundamentals/solve?id=${mongoId}`;
    } else if (q.id.startsWith("sql-") || cat === "sql") {
        baseUrl = `/questions/sql/solve?id=${mongoId}`;
    } else if (cat === "system_design") {
        baseUrl = `/questions/system-design/solve?id=${mongoId}`;
    } else if (q.id.startsWith("cs-")) {
        baseUrl = `/questions/cs-fundamentals/solve?id=${mongoId}`;
    } else if (q.id.startsWith("sd-")) {
        baseUrl = `/questions/system-design/solve?id=${mongoId}`;
    } else if (q.id.startsWith("dsa-") || cat === "coding" || cat === "dsa") {
        baseUrl = `/questions/dsa/solve?id=${mongoId}`;
    }
    
    if (baseUrl) {
        return `${baseUrl}&sheetId=${sheetId}`;
    }
    return null;
}

/** Map category to a display-friendly topic group name */
function topicGroupName(category: string): string {
    const c = category.toLowerCase();
    if (c === "os" || c === "operating_systems") return "Operating Systems";
    if (c === "cn" || c === "computer_networks" || c === "networking") return "Computer Networks";
    if (c === "dbms" || c === "database" || c === "databases") return "Database Management";
    if (c === "oops" || c === "oop" || c === "object_oriented") return "Object-Oriented Programming";
    if (c === "cs_fundamentals") return "CS Fundamentals";
    if (c === "sql") return "SQL";
    if (c === "coding" || c === "dsa") return "Data Structures & Algorithms";
    if (c === "system_design") return "System Design";
    if (c === "behavioural" || c === "behavioral") return "Behavioural";
    return toLabel(c);
}

const TOPIC_BADGE_COLORS: Record<string, string> = {
    os: "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400",
    cn: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400",
    dbms: "bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-400",
    oops: "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400",
    sql: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
    coding: "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-400",
    system_design: "bg-pink-100 text-pink-700 dark:bg-pink-500/15 dark:text-pink-400",
    cs_fundamentals: "bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-400",
};

function badgeColor(cat: string): string {
    return TOPIC_BADGE_COLORS[cat.toLowerCase()] || "bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-400";
}

/** Short, UI-friendly label for category badges (avoids long snake_case spilling) */
function badgeLabel(cat: string): string {
    const SHORT_LABELS: Record<string, string> = {
        os: "OS",
        cn: "Networks",
        dbms: "DBMS",
        oops: "OOP",
        sql: "SQL",
        coding: "Coding",
        dsa: "DSA",
        system_design: "Sys Design",
        cs_fundamentals: "CS",
        behavioural: "Behavioural",
        behavioral: "Behavioural",
    };
    const key = cat.toLowerCase();
    if (SHORT_LABELS[key]) return SHORT_LABELS[key];
    // For anything else (e.g. professionalism_and_conduct), take the first word and title-case it
    const first = key.split(/[_\s]+/)[0] || key;
    return first.charAt(0).toUpperCase() + first.slice(1);
}

function formatTitle(title: string): string {
    let cleaned = title
        .replace(/(?:·\s*)?['"]?mid['"]?(?:\s*·)?/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
    cleaned = cleaned.replace(/^·\s*/, "").replace(/\s*·$/, "").trim();
    return cleaned
        .split(/[_\s]+/)
        .map((w) => (w === "·" ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
        .join(" ");
}

const DIFF_COLORS: Record<string, string> = {
    easy: "text-emerald-600 dark:text-emerald-400",
    medium: "text-amber-600 dark:text-amber-400",
    hard: "text-red-600 dark:text-red-400",
};

/* ═══════════════ Main Component ═══════════════ */

export default function SheetDetailPage() {
    const { session, loading: authLoading } = useAuth();
    const token = session?.access_token;
    const params = useParams();
    const router = useRouter();
    const sheetId = params.sheetId as string;

    const [sheet, setSheet] = useState<Sheet | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [togglingId, setTogglingId] = useState<string | null>(null);
    const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
    const [isDeleting, setDeleting] = useState(false);
    const [deleteConfirm, setDeleteConfirm] = useState(false);
    const [isCustomSheet, setIsCustomSheet] = useState(false);

    /* ── Fetch sheet ── */
    useEffect(() => {
        if (authLoading) return;
        if (!token || !sheetId) { setLoading(false); return; }

        (async () => {
            try {
                // Try fetching as custom sheet first
                try {
                    const response = await api.get<any>(`/custom-sheets/${encodeURIComponent(sheetId)}`, token);
                    const customSheet = response.data || response; // Handle both wrapped and unwrapped responses
                    
                    // Transform custom sheet to match Sheet interface
                    const transformedSheet: Sheet = {
                        sheetId: customSheet.id,
                        reportId: "",
                        sessionId: "",
                        label: customSheet.name,
                        generatedAt: customSheet.createdAt,
                        questions: customSheet.questions || [],
                        progress: customSheet.progress || {},
                    };
                    
                    setSheet(transformedSheet);
                    setIsCustomSheet(true);
                    setLoading(false);
                    return;
                } catch (customErr) {
                    // If custom sheet fetch fails, try AI-generated sheet
                    const data = await api.get<Sheet>(`/users/me/sheets/${encodeURIComponent(sheetId)}`, token);
                    setSheet(data);
                    setIsCustomSheet(false);
                }
            } catch (err) {
                setError((err as Error).message);
            } finally {
                setLoading(false);
            }
        })();
    }, [token, sheetId, authLoading]);

    /* ── Computed ── */
    const { grouped, stats } = useMemo(() => {
        if (!sheet) return { grouped: {} as Record<string, TutorQuestion[]>, stats: { total: 0, completed: 0, easy: 0, easyDone: 0, medium: 0, mediumDone: 0, hard: 0, hardDone: 0 } };

        const groups: Record<string, TutorQuestion[]> = {};
        let easy = 0, easyDone = 0, medium = 0, mediumDone = 0, hard = 0, hardDone = 0;

        for (const q of sheet.questions) {
            const gName = topicGroupName(q.category);
            if (!groups[gName]) groups[gName] = [];
            groups[gName].push(q);

            const diff = (q.difficulty || "medium").toLowerCase();
            const done = sheet.progress[q.id]?.status === "completed";
            if (diff === "easy") { easy++; if (done) easyDone++; }
            else if (diff === "hard") { hard++; if (done) hardDone++; }
            else { medium++; if (done) mediumDone++; }
        }

        const completed = Object.values(sheet.progress).filter((p) => p.status === "completed").length;

        return {
            grouped: groups,
            stats: { total: sheet.questions.length, completed, easy, easyDone, medium, mediumDone, hard, hardDone },
        };
    }, [sheet]);

    const completionPercent = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;

    /* ── Toggle question completion ── */
    const toggleCompletion = async (questionId: string) => {
        if (!token || !sheet || togglingId) return;

        const currentStatus = sheet.progress[questionId]?.status;
        const newStatus = currentStatus === "completed" ? "unattempted" : "completed";

        setTogglingId(questionId);
        
        // Optimistic update
        setSheet((prev) => {
            if (!prev) return prev;
            return {
                ...prev,
                progress: {
                    ...prev.progress,
                    [questionId]: {
                        ...prev.progress[questionId],
                        status: newStatus,
                    },
                },
            };
        });

        try {
            const endpoint = isCustomSheet 
                ? `/custom-sheets/${encodeURIComponent(sheetId)}/progress`
                : `/users/me/sheets/${encodeURIComponent(sheetId)}/progress`;
            
            await api.patch(endpoint, {
                questionId,
                status: newStatus,
            }, token);
        } catch (err) {
            console.error("Failed to toggle:", err);
            // Revert on failure
            setSheet((prev) => {
                if (!prev) return prev;
                return {
                    ...prev,
                    progress: {
                        ...prev.progress,
                        [questionId]: {
                            ...prev.progress[questionId],
                            status: currentStatus,
                        },
                    },
                };
            });
        } finally {
            setTogglingId(null);
        }
    };

    /* ── Delete sheet ── */
    const handleDeleteSheet = async () => {
        if (!token) return;
        setDeleting(true);
        try {
            const endpoint = isCustomSheet 
                ? `/custom-sheets/${encodeURIComponent(sheetId)}`
                : `/users/me/sheets/${encodeURIComponent(sheetId)}`;
            
            await api.delete(endpoint, token);
            router.push("/sheets");
        } catch (err) {
            setError((err as Error).message);
            setDeleting(false);
            setDeleteConfirm(false);
        }
    };

    /* ── Toggle group collapse ── */
    const toggleGroup = (name: string) => {
        setCollapsedGroups((prev) => ({ ...prev, [name]: !prev[name] }));
    };

    /* ═══════════════ Render ═══════════════ */

    if (loading || !sheet) {
        return (
            <div className="flex-1 overflow-y-scroll overflow-x-hidden bg-slate-50/50 flex flex-col dark:bg-[#1a1a1a]">
                <PageHeader
                    showBack={true}
                    backUrl="/sheets"
                    titleNode={
                        <div className="flex flex-col leading-tight text-left">
                            <h1 className="text-[28px] font-bold text-slate-900 dark:text-white font-nunito tracking-[-0.02em]">Loading Sheet...</h1>
                        </div>
                    }
                />
                
                {/* ── Shimmer UI ── */}
                <div className="max-w-[1400px] w-full mx-auto px-6 mt-6 flex flex-col gap-6">
                    <div className="rounded-xl border border-slate-200/80 bg-white/60 p-6 backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.02] relative overflow-hidden h-[120px]">
                        <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-slate-200/50 to-transparent dark:via-white/5 animate-[shimmer_1.5s_infinite]" />
                        <div className="h-6 w-1/3 bg-slate-200 dark:bg-lc-hover rounded-md mb-3" />
                        <div className="h-4 w-1/4 bg-slate-200 dark:bg-lc-hover rounded-md" />
                    </div>

                    <div className="rounded-xl border border-slate-200/80 bg-white/60 p-6 backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.02] relative overflow-hidden h-[250px]">
                        <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-slate-200/50 to-transparent dark:via-white/5 animate-[shimmer_1.5s_infinite]" />
                        <div className="h-5 w-48 bg-slate-200 dark:bg-lc-hover rounded-md mb-6" />
                        
                        <div className="space-y-4">
                            {[1, 2, 3].map(i => (
                                <div key={i} className="flex gap-4">
                                    <div className="h-4 w-4 bg-slate-200 dark:bg-lc-hover rounded" />
                                    <div className="flex-1 h-4 bg-slate-200 dark:bg-lc-hover rounded-md" />
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex-1 flex items-center justify-center min-h-screen bg-slate-50/50 dark:bg-[#0a0a0a]">
                <div className="text-center max-w-sm">
                    <span className="material-symbols-outlined text-4xl text-red-400 mb-2">error</span>
                    <p className="text-sm text-red-600 dark:text-red-400">{error || "Sheet not found"}</p>
                    <Link href="/sheets" className="mt-4 inline-block text-sm font-semibold text-primary hover:text-primary-dark">
                        ← Back to Sheets
                    </Link>
                </div>
            </div>
        );
    }

    // Use formatTitle to match SheetCard's title exactly
    const displayTitle = formatTitle(sheet.label);

    const formattedTime = new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
    }).format(new Date(sheet.generatedAt));

    const formattedDate = new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric"
    }).format(new Date(sheet.generatedAt));

    return (
        <div className="flex-1 overflow-y-scroll overflow-x-hidden bg-slate-50/50 dark:bg-[#1a1a1a] flex flex-col">
            {/* ── Header ── */}
            <PageHeader
                showBack={true}
                backUrl="/sheets"
                titleNode={
                    <div className="flex flex-col leading-tight text-left ml-2">
                        <h1 className="text-[28px] md:text-[32px] font-bold text-slate-900 dark:text-white font-nunito tracking-[-0.02em]">
                            {displayTitle}
                        </h1>
                        <div className="mt-1 flex items-center gap-2 text-[13px] font-medium text-slate-500 dark:text-slate-400/80">
                            <span className="flex items-center gap-1"><span className="material-symbols-outlined text-[14px]">calendar_today</span> {formattedDate}</span>
                            <span className="text-slate-300 dark:text-slate-700">•</span>
                            <span className="flex items-center gap-1"><span className="material-symbols-outlined text-[14px]">schedule</span> {formattedTime}</span>
                        </div>
                    </div>
                }
            />

            {/* ── Progress Card ── */}
            <div className="max-w-5xl mx-auto w-full px-6 mt-6">
                <div className="rounded-xl border border-slate-200 bg-white dark:border-white/10 dark:bg-white/[0.04] p-5 shadow-sm">
                    <div className="flex items-center gap-6">
                        {/* Circular progress */}
                        <div className="relative flex-shrink-0">
                            <svg width="72" height="72" viewBox="0 0 72 72">
                                <circle cx="36" cy="36" r="30" fill="none" stroke="currentColor" className="text-slate-100 dark:text-slate-800" strokeWidth="6" />
                                <circle
                                    cx="36" cy="36" r="30" fill="none"
                                    stroke="currentColor"
                                    className="text-primary"
                                    strokeWidth="6"
                                    strokeLinecap="round"
                                    strokeDasharray={`${2 * Math.PI * 30}`}
                                    strokeDashoffset={`${2 * Math.PI * 30 * (1 - completionPercent / 100)}`}
                                    transform="rotate(-90 36 36)"
                                    style={{ transition: "stroke-dashoffset 0.6s ease" }}
                                />
                            </svg>
                            <div className="absolute inset-0 flex items-center justify-center">
                                <span className="text-sm font-bold text-slate-800 dark:text-white">{completionPercent}%</span>
                            </div>
                        </div>

                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-slate-800 dark:text-white mb-0.5">Overall Progress</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                                {stats.completed} / {stats.total} questions completed
                            </p>

                            {/* Difficulty breakdown */}
                            <div className="flex items-center gap-4 text-xs">
                                {stats.easy > 0 && (
                                    <span className="flex items-center gap-1.5">
                                        <span className="h-2 w-2 rounded-full bg-emerald-500" />
                                        <span className="text-slate-600 dark:text-slate-300">Easy</span>
                                        <span className="font-semibold text-slate-800 dark:text-white">{stats.easyDone}</span>
                                        <span className="text-slate-400">/{stats.easy}</span>
                                    </span>
                                )}
                                {stats.medium > 0 && (
                                    <span className="flex items-center gap-1.5">
                                        <span className="h-2 w-2 rounded-full bg-amber-500" />
                                        <span className="text-slate-600 dark:text-slate-300">Medium</span>
                                        <span className="font-semibold text-slate-800 dark:text-white">{stats.mediumDone}</span>
                                        <span className="text-slate-400">/{stats.medium}</span>
                                    </span>
                                )}
                                {stats.hard > 0 && (
                                    <span className="flex items-center gap-1.5">
                                        <span className="h-2 w-2 rounded-full bg-red-500" />
                                        <span className="text-slate-600 dark:text-slate-300">Hard</span>
                                        <span className="font-semibold text-slate-800 dark:text-white">{stats.hardDone}</span>
                                        <span className="text-slate-400">/{stats.hard}</span>
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Question Groups ── */}
            <div className="max-w-5xl mx-auto w-full px-6 mt-4 pb-10 space-y-3">
                {Object.entries(grouped).map(([groupName, questions]) => {
                    const isCollapsed = !!collapsedGroups[groupName];
                    const groupCompleted = questions.filter((q) => sheet.progress[q.id]?.status === "completed").length;
                    const groupPercent = questions.length > 0 ? Math.round((groupCompleted / questions.length) * 100) : 0;

                    return (
                        <div key={groupName} className="rounded-xl border border-slate-200 bg-white dark:border-white/10 dark:bg-white/[0.04] overflow-hidden shadow-sm">
                            {/* Group header */}
                            <button
                                onClick={() => toggleGroup(groupName)}
                                className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
                            >
                                <div className="flex items-center gap-3">
                                    <span className="material-symbols-outlined text-slate-400 text-[20px] transition-transform" style={{ transform: isCollapsed ? "rotate(-90deg)" : "rotate(0)" }}>
                                        expand_more
                                    </span>
                                    <span className="text-sm font-semibold text-slate-800 dark:text-white">{groupName}</span>
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className="w-24 h-1.5 rounded-full bg-slate-100 dark:bg-white/10 overflow-hidden">
                                        <div
                                            className={`h-full rounded-full transition-all duration-500 ${groupPercent === 100 ? "bg-emerald-500" : "bg-primary"}`}
                                            style={{ width: `${groupPercent}%` }}
                                        />
                                    </div>
                                    <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 min-w-[40px] text-right">
                                        {groupCompleted} / {questions.length}
                                    </span>
                                </div>
                            </button>

                            {/* Questions table */}
                            {!isCollapsed && (
                                <div className="border-t border-slate-100 dark:border-white/5">
                                    {/* Table header */}
                                    <div className="grid grid-cols-[48px_1fr_100px_80px] px-5 py-2 bg-slate-50/50 dark:bg-white/[0.02] text-[11px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                                        <span>Status</span>
                                        <span>Problem</span>
                                        <span>Topic</span>
                                        <span className="text-center">Difficulty</span>
                                    </div>

                                    {/* Question rows */}
                                    {questions.map((q, idx) => {
                                        const progress = sheet.progress[q.id];
                                        const isDone = progress?.status === "completed";
                                        const isToggling = togglingId === q.id;
                                        const solveUrl = getSolveUrl(q, sheetId);
                                        const diff = (q.difficulty || "medium").toLowerCase();

                                        return (
                                            <div
                                                key={q.id}
                                                className={`grid grid-cols-[48px_1fr_100px_80px] items-center px-5 py-3 border-t border-slate-50 dark:border-white/5 transition-colors ${isDone ? "bg-[#74c69d]/90 dark:bg-[#74c69d]/20 hover:bg-[#74c69d]/100 dark:hover:bg-[#74c69d]/30" : "hover:bg-slate-50/50 dark:hover:bg-white/5"}`}
                                            >
                                                {/* Checkbox */}
                                                <div>
                                                    <button
                                                        onClick={() => toggleCompletion(q.id)}
                                                        disabled={isToggling}
                                                        className={`flex h-5 w-5 items-center justify-center rounded border-2 transition-all ${isDone
                                                            ? "border-[#2d6a4f] bg-[#2d6a4f] text-white dark:border-[#74c69d] dark:bg-[#74c69d] dark:text-slate-900"
                                                            : "border-slate-300 dark:border-slate-600 hover:border-primary"
                                                        } ${isToggling ? "opacity-50" : ""}`}
                                                    >
                                                        {isDone && (
                                                            <span className="material-symbols-outlined text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }}>check</span>
                                                        )}
                                                    </button>
                                                </div>

                                                {/* Question text - clickable */}
                                                <div className="min-w-0 pr-4">
                                                    {solveUrl ? (
                                                        <Link
                                                            href={solveUrl}
                                                            className={`text-sm leading-snug truncate block transition-colors ${isDone ? "text-slate-900 dark:text-slate-200 font-medium hover:text-slate-700 dark:hover:text-slate-100" : "text-slate-800 dark:text-slate-200 hover:text-slate-600 dark:hover:text-slate-100"}`}
                                                        >
                                                            {q.question.length > 120 ? q.question.slice(0, 117) + "…" : q.question}
                                                        </Link>
                                                    ) : (
                                                        <p className={`text-sm leading-snug truncate ${isDone ? "text-slate-900 dark:text-slate-200 font-medium" : "text-slate-800 dark:text-slate-200"}`}>
                                                            {q.question.length > 120 ? q.question.slice(0, 117) + "…" : q.question}
                                                        </p>
                                                    )}
                                                </div>

                                                {/* Topic badge */}
                                                <div className="min-w-0">
                                                    <span className={`inline-block max-w-full truncate rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${badgeColor(q.category)}`} title={toLabel(q.category)}>
                                                        {badgeLabel(q.category)}
                                                    </span>
                                                </div>

                                                {/* Difficulty */}
                                                <div className="text-center">
                                                    <span className={`text-xs font-semibold capitalize ${DIFF_COLORS[diff] || "text-slate-500"}`}>
                                                        {diff}
                                                    </span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
