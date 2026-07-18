"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { useAuth } from "@/context/auth-context";
import { PageHeader } from "@/components/page-header";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { CustomSheetCreationModal } from "@/components/custom-sheet-creation-modal";

interface SheetMeta {
    sheetId: string;
    reportId: string;
    label: string;
    generatedAt: string;
    totalQuestions: number;
    completedQuestions: number;
    weakAreas: string[];
    isCustom?: boolean; // Flag to identify custom sheets
}

function toDisplayText(value: unknown): string {
    if (typeof value === "string") return value;
    if (typeof value === "number") return String(value);
    if (value && typeof value === "object") {
        const v = value as Record<string, unknown>;
        const candidate = v.title || v.category || v.area || v.name || v.desc || v.step;
        if (typeof candidate === "string") return candidate;
        return "General";
    }
    return "General";
}

/** Converts snake_case or lowercase DB column names to compact, readable labels. */
function formatTagLabel(raw: string): string {
    const SHORT_LABELS: Record<string, string> = {
        os: "OS",
        cn: "Networks",
        dbms: "DBMS",
        oops: "OOP",
        sql: "SQL",
        coding: "Coding",
        dsa: "DSA",
        system_design: "System Design",
        cs_fundamentals: "CS",
        behavioural: "Behavioural",
        behavioral: "Behavioural",
        professionalism_and_conduct: "Professionalism",
        communication_and_presentation: "Communication",
        conflict_resolution: "Conflict Res",
        leadership_and_initiative: "Leadership",
        adaptability_and_growth: "Adaptability",
        problem_solving_and_impact: "Problem Solving",
        technical_depth: "Technical",
    };

    const key = raw.toLowerCase().trim();
    if (SHORT_LABELS[key]) return SHORT_LABELS[key];

    return raw
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatTitle(title: string): string {
    // Remove "Mid" or "'Mid'" and optionally surrounding dots
    let cleaned = title
        .replace(/(?:·\s*)?['"]?mid['"]?(?:\s*·)?/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
    
    // Remove dangling dots if any
    cleaned = cleaned.replace(/^·\s*/, "").replace(/\s*·$/, "").trim();

    return cleaned
        .split(/[_\s]+/)
        .map((w) => (w === "·" ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
        .join(" ");
}

/** Formats ISO date to a compact label like "Apr 13" */
function formatDateTag(isoString: string): string {
    if (!isoString) return "";
    try {
        const d = new Date(isoString);
        return new Intl.DateTimeFormat("en-US", {
            month: "short",
            day: "numeric",
        }).format(d);
    } catch {
        return "";
    }
}

function SheetCard({
    sheet,
    deleting,
    renaming,
    deleteConfirm,
    setDeleteConfirm,
    handleRenameSheet,
    handleDeleteSheet,
}: {
    sheet: SheetMeta;
    deleting: string | null;
    renaming: string | null;
    deleteConfirm: string | null;
    setDeleteConfirm: (id: string | null) => void;
    handleRenameSheet: (id: string, currentLabel: string) => void;
    handleDeleteSheet: (id: string) => void;
}) {
    const router = useRouter();
    const completionPercent = sheet.totalQuestions > 0
        ? Math.round((sheet.completedQuestions / sheet.totalQuestions) * 100)
        : 0;

    const isDeleting = deleting === sheet.sheetId;
    const isRenaming = renaming === sheet.sheetId;
    const showConfirm = deleteConfirm === sheet.sheetId;

    const uniqueAreas = Array.from(
        new Set(sheet.weakAreas.map((a) => formatTagLabel(toDisplayText(a))))
    );

    return (
        <div className="group flex flex-col gap-2">
            <div className="group/card relative z-10 flex cursor-pointer flex-col overflow-hidden rounded-3xl border border-slate-200/80 bg-gradient-to-br from-white/65 via-blue-100/45 to-blue-200/35 p-6 backdrop-blur-xl transition-all duration-300 ease-out hover:-translate-y-[6px] hover:shadow-[0_16px_48px_-12px_rgba(0,0,0,0.12)] hover:shadow-primary/5 focus:outline-none focus:ring-2 focus:ring-blue-400/40 dark:border-white/10 dark:from-[#2a2a2a] dark:via-[#222222] dark:to-[#1a1a1a] dark:hover:shadow-[0_16px_48px_-12px_rgba(0,0,0,0.4)] dark:hover:shadow-primary/10 before:absolute before:inset-0 before:h-full before:w-[200%] before:-translate-x-[calc(var(--wave-dir,1)*100%)] before:bg-gradient-to-r before:from-transparent before:via-black/[0.03] before:to-transparent before:transition-transform before:duration-700 before:ease-in-out hover:before:translate-x-[calc(var(--wave-dir,1)*50%)] dark:before:via-white/[0.04]"
                 role="button"
                 tabIndex={0}
                 onClick={() => {
                     if (!showConfirm) router.push(`/sheets/${sheet.sheetId}`);
                 }}
                 onKeyDown={(e) => {
                     if (showConfirm) return;
                     if (e.key === "Enter" || e.key === " ") {
                         e.preventDefault();
                         router.push(`/sheets/${sheet.sheetId}`);
                     }
                 }}
                 onMouseEnter={(e) => {
                     const rect = e.currentTarget.getBoundingClientRect();
                     const x = e.clientX - rect.left;
                     e.currentTarget.style.setProperty('--wave-dir', x < rect.width / 2 ? '1' : '-1');
                 }}>
            <div className="mb-5 flex items-start justify-between gap-4 relative z-10">
                <div className="flex flex-col gap-1.5">
                    <h3 className="text-[18px] font-bold leading-tight tracking-tight text-slate-800 dark:text-white line-clamp-2">
                        {formatTitle(sheet.label)}
                    </h3>
                </div>
                <span className="material-symbols-outlined text-[22px] text-blue-600/80 transition-transform duration-200 group-hover/card:translate-x-0.5 dark:text-blue-300/80">
                    chevron_right
                </span>
            </div>

            <div className="mt-4 mb-5 flex flex-col gap-2 relative z-10">
                <div className="flex items-center justify-between text-[13px] font-semibold">
                    <span className="text-slate-600 dark:text-slate-300">Progress</span>
                    <span className="text-primary dark:text-[#a0a5e8]">{completionPercent}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full border border-slate-300/85 bg-slate-100 dark:border-white/20 dark:bg-white/5">
                    <div
                        className="h-full rounded-full bg-gradient-to-r from-primary to-blue-500 transition-all duration-700 ease-out dark:from-[#6C63FF] dark:to-[#8B84FF]"
                        style={{ width: `${completionPercent}%` }}
                    />
                </div>
            </div>

            <div 
                className="mt-2 mb-5 flex min-h-[28px] items-center gap-2 overflow-x-auto whitespace-nowrap [&::-webkit-scrollbar]:hidden relative z-10"
                style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
            >
                {sheet.generatedAt && (
                    <span className="inline-flex shrink-0 items-center justify-center gap-1 rounded-lg bg-blue-50/50 px-3 py-1 text-[11px] font-bold tracking-tight text-blue-600 ring-1 ring-inset ring-blue-500/10 dark:bg-[#6C63FF]/10 dark:text-[#B7B2FF] dark:ring-[#6C63FF]/20">
                        <span className="material-symbols-outlined text-[10px]">calendar_today</span>
                        {formatDateTag(sheet.generatedAt)}
                    </span>
                )}
                {uniqueAreas.map((label, idx) => (
                    <span
                        key={`${sheet.sheetId}-${idx}`}
                        className="inline-flex shrink-0 items-center justify-center rounded-lg bg-blue-50/50 px-3 py-1 text-[11px] font-bold tracking-tight text-blue-600 ring-1 ring-inset ring-blue-500/10 dark:bg-[#6C63FF]/10 dark:text-[#B7B2FF] dark:ring-[#6C63FF]/20"
                    >
                        {label}
                    </span>
                ))}
            </div>

            </div>

            <div className="relative z-10 px-1">
                {!showConfirm ? (
                    <div className="flex items-center justify-between gap-1.5 transition-all duration-200 opacity-100 lg:opacity-0 lg:translate-y-1 lg:group-hover:opacity-100 lg:group-hover:translate-y-0 lg:group-focus-within:opacity-100 lg:group-focus-within:translate-y-0">
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                handleRenameSheet(sheet.sheetId, sheet.label);
                            }}
                            disabled={isDeleting || isRenaming}
                            className="inline-flex items-center justify-center rounded-md p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800/70 dark:hover:text-blue-300"
                            title="Rename sheet"
                        >
                            <span className="material-symbols-outlined text-[14px]">edit</span>
                        </button>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setDeleteConfirm(sheet.sheetId);
                            }}
                            className="inline-flex items-center justify-center rounded-md p-1 text-slate-500 transition-colors hover:bg-red-50 hover:text-red-500 dark:text-slate-400 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                            title="Delete sheet"
                        >
                            <span className="material-symbols-outlined text-[14px]">delete</span>
                        </button>
                    </div>
                ) : (
                    <div className="ml-auto w-full max-w-[210px] flex flex-col gap-2 rounded-xl bg-red-50/50 p-3 ring-1 ring-inset ring-red-100 dark:bg-red-950/10 dark:ring-red-900/20">
                        <p className="text-center text-[12px] font-bold text-red-600 dark:text-red-400">
                            Delete this sheet permanently?
                        </p>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setDeleteConfirm(null)}
                                disabled={isDeleting}
                                className="flex-1 rounded-lg bg-white px-2.5 py-1.5 text-[12px] font-bold text-slate-600 shadow-sm ring-1 ring-inset ring-slate-200 transition-all hover:bg-slate-50 disabled:opacity-50 dark:bg-[#1a1a1a] dark:text-slate-300 dark:ring-white/10 dark:hover:bg-[#222]"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => handleDeleteSheet(sheet.sheetId)}
                                disabled={isDeleting}
                                className="flex-1 rounded-lg bg-red-500 px-2.5 py-1.5 text-[12px] font-bold text-white shadow-sm transition-all hover:bg-red-600 disabled:opacity-50 dark:bg-red-600 dark:hover:bg-red-500"
                            >
                                {isDeleting ? "..." : "Delete"}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function CustomSortDropdown({ value, onChange }: { value: string, onChange: (v: string) => void }) {
    const [open, setOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (open && containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        if (open) {
            document.addEventListener("mousedown", handleClickOutside);
        }
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [open]);

    const options = [
        { v: "newest", l: "Newest First", icon: "schedule" },
        { v: "oldest", l: "Oldest First", icon: "history" }
    ];

    const selectedOption = options.find(o => o.v === value) || options[0];

    return (
        <div className="relative z-50 group min-w-[150px]" ref={containerRef}>
            <button
                className="flex items-center justify-between h-[36px] w-full rounded-full border border-slate-200 bg-white px-3 text-[13px] font-bold text-slate-700 shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)] outline-none transition-all hover:bg-slate-50 focus:border-[#6C63FF] focus:ring-2 focus:ring-[#6C63FF]/20 dark:border-white/10 dark:bg-[#1a1a1a] dark:text-slate-200 dark:hover:bg-[#242424]"
                onClick={() => setOpen(!open)}
            >
                <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[16px] text-[#6C63FF]">{selectedOption.icon}</span>
                    <span>{selectedOption.l}</span>
                </div>
                <span className={`material-symbols-outlined text-[16px] text-slate-400 transition-transform duration-300 ml-1 ${open ? 'rotate-180 text-[#6C63FF]' : ''}`}>expand_more</span>
            </button>

            {open && (
                <div className="absolute right-0 top-[calc(100%+6px)] w-full sm:w-[190px] rounded-2xl border border-slate-200/80 bg-white p-1.5 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.15)] dark:border-white/10 dark:bg-[#1a1a1a] flex flex-col gap-0.5 animate-in zoom-in-95 duration-200 origin-top-right">
                    {options.map((opt) => (
                        <button
                            key={opt.v}
                            onClick={() => { onChange(opt.v); setOpen(false); }}
                            className={`flex items-center gap-3 w-full text-left px-3 py-2.5 rounded-xl text-[13px] font-bold transition-all duration-200 ${
                                value === opt.v ? "bg-[#6C63FF]/10 text-[#6C63FF] dark:bg-[#6C63FF]/20 dark:text-[#B7B2FF]" : "text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-white/5"
                            }`}
                        >
                            <span className={`material-symbols-outlined text-[18px] ${value === opt.v ? 'text-[#6C63FF]' : 'opacity-60'}`}>{opt.icon}</span>
                            {opt.l}
                            {value === opt.v && <span className="material-symbols-outlined ml-auto text-[16px] animate-in zoom-in">check</span>}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

export default function SheetsLibraryPage() {
    const { session, loading: authLoading } = useAuth();
    const token = session?.access_token;
    const router = useRouter();
    const [sheets, setSheets] = useState<SheetMeta[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [deleting, setDeleting] = useState<string | null>(null);
    const [renaming, setRenaming] = useState<string | null>(null);
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
    const [renameDialog, setRenameDialog] = useState<{ sheetId: string; value: string } | null>(null);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [showManualCreateForm, setShowManualCreateForm] = useState(false);
    const [showCustomSheetCreation, setShowCustomSheetCreation] = useState(false);
    const [newSheetName, setNewSheetName] = useState("");
    const [creating, setCreating] = useState(false);
    
    // Filtering and Sorting state
    const [activeFilter, setActiveFilter] = useState("all");
    const [sortOrder, setSortOrder] = useState("newest");

    const fetchSheets = async () => {
        if (!token) {
            setLoading(false);
            return;
        }

        try {
            // Fetch AI-generated sheets
            const aiSheets = await api.get<{ sheets: SheetMeta[] }>("/users/me/sheets", token);
            
            // Fetch custom sheets
            const customSheetsResponse = await api.get<{ success: boolean; data: any[] }>("/custom-sheets", token);
            
            // Transform custom sheets to match SheetMeta interface
            const customSheets: SheetMeta[] = customSheetsResponse.data.map((sheet: any) => ({
                sheetId: sheet.id,
                reportId: "", // Custom sheets don't have reportId
                label: sheet.name,
                generatedAt: sheet.createdAt,
                totalQuestions: sheet.questionCount || 0,
                completedQuestions: 0, // We don't track progress for custom sheets yet
                weakAreas: ["Custom"], // Tag as custom
                isCustom: true,
            }));
            
            // Combine both types of sheets
            setSheets([...aiSheets.sheets, ...customSheets]);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (authLoading) return;
        fetchSheets();
    }, [token, authLoading]);

    const handleDeleteSheet = async (sheetId: string) => {
        if (!token) return;

        setDeleting(sheetId);
        setError(null);

        try {
            // Find the sheet to determine if it's custom
            const sheet = sheets.find(s => s.sheetId === sheetId);
            
            if (sheet?.isCustom) {
                // Delete custom sheet
                await api.delete(`/custom-sheets/${encodeURIComponent(sheetId)}`, token);
            } else {
                // Delete AI-generated sheet
                await api.delete(`/users/me/sheets/${encodeURIComponent(sheetId)}`, token);
            }
            
            setSheets((prev) => prev.filter((s) => s.sheetId !== sheetId));
            setDeleteConfirm(null);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setDeleting(null);
        }
    };

    const handleRenameSheet = (sheetId: string, currentLabel: string) => {
        setRenameDialog({ sheetId, value: currentLabel });
    };

    const submitRenameSheet = async () => {
        if (!token || !renameDialog) return;

        const label = renameDialog.value.trim();
        if (!label) {
            setError("Sheet name cannot be empty.");
            return;
        }

        const existing = sheets.find((s) => s.sheetId === renameDialog.sheetId);
        if (existing && label === existing.label.trim()) {
            setRenameDialog(null);
            return;
        }

        setRenaming(renameDialog.sheetId);
        setError(null);

        try {
            if (existing?.isCustom) {
                // Rename custom sheet
                const data = await api.patch<{ success: boolean; data: { id: string; name: string } }>(
                    `/custom-sheets/${encodeURIComponent(renameDialog.sheetId)}`,
                    { name: label },
                    token
                );

                setSheets((prev) =>
                    prev.map((sheet) =>
                        sheet.sheetId === renameDialog.sheetId ? { ...sheet, label: data.data.name } : sheet
                    )
                );
            } else {
                // Rename AI-generated sheet
                const data = await api.patch<{ sheetId: string; label: string }>(
                    `/users/me/sheets/${encodeURIComponent(renameDialog.sheetId)}`,
                    { label },
                    token
                );

                setSheets((prev) =>
                    prev.map((sheet) =>
                        sheet.sheetId === renameDialog.sheetId ? { ...sheet, label: data.label } : sheet
                    )
                );
            }
            
            setRenameDialog(null);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setRenaming(null);
        }
    };

    const handleCreateSheet = async () => {
        if (!token || !newSheetName.trim()) return;

        setCreating(true);
        setError(null);

        try {
            const response = await api.post<{ success: boolean; data: { id: string; name: string; createdAt: string } }>(
                "/custom-sheets",
                { name: newSheetName.trim() },
                token
            );

            // Add the new sheet to the list
            const newSheet: SheetMeta = {
                sheetId: response.data.id,
                reportId: "",
                label: response.data.name,
                generatedAt: response.data.createdAt,
                totalQuestions: 0,
                completedQuestions: 0,
                weakAreas: ["Custom"],
                isCustom: true,
            };

            setSheets((prev) => [newSheet, ...prev]);
            setShowManualCreateForm(false);
            setNewSheetName("");
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setCreating(false);
        }
    };

    const handleCustomSheetSuccess = (sheetId: string) => {
        // Refresh the sheets list to get the updated sheet with questions
        fetchSheets();
        // Navigate to the new sheet
        router.push(`/sheets/${sheetId}`);
    };

    // Apply Filter and Sort
    const filteredAndSortedSheets = useMemo(() => {
        let result = [...sheets];
        
        // Filter
        if (activeFilter !== "all") {
            result = result.filter(sheet => 
                sheet.weakAreas.some(area => 
                    formatTagLabel(toDisplayText(area)).toLowerCase() === activeFilter.toLowerCase()
                )
            );
        }

        // Sort
        result.sort((a, b) => {
            const da = new Date(a.generatedAt).getTime();
            const db = new Date(b.generatedAt).getTime();
            return sortOrder === "newest" ? db - da : da - db;
        });

        return result;
    }, [sheets, activeFilter, sortOrder]);

    const uniqueCategories = useMemo(() => {
        const categories = new Set<string>();
        sheets.forEach(sheet => {
            sheet.weakAreas.forEach(area => {
                categories.add(formatTagLabel(toDisplayText(area)));
            });
        });
        return Array.from(categories).sort();
    }, [sheets]);

    if (loading) {
        return (
            <div className="flex-1 overflow-auto bg-slate-50/50 flex flex-col dark:bg-[#1a1a1a]">
                <PageHeader
                    showBack={true}
                    backUrl="/dashboard"
                    titleNode={
                        <div className="flex flex-col leading-tight text-left">
                            <h1 className="text-[28px] font-bold text-slate-900 dark:text-white font-nunito tracking-[-0.02em]">My Practice Sheets</h1>
                            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400 opacity-50">Loading practice sheets...</p>
                        </div>
                    }
                />
                <main className="flex-1 px-4 pb-12 sm:px-6 lg:px-8 mt-6">
                    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-left w-full animate-pulse opacity-50">
                            <div>
                                <div className="h-6 w-40 bg-slate-200 dark:bg-lc-hover rounded-md mb-2" />
                                <div className="h-4 w-72 bg-slate-200 dark:bg-lc-hover rounded-md" />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 mt-2">
                            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                                <div key={i} className="group relative flex flex-col rounded-3xl border border-slate-200/80 bg-white/60 p-6 backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.02] overflow-hidden min-h-[220px]">
                                    {/* Shimmer animation container */}
                                    <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-slate-200/50 to-transparent dark:via-white/5 animate-[shimmer_1.5s_infinite]" />
                                    
                                    <div className="mb-5 flex flex-col gap-2">
                                        <div className="h-5 w-3/4 rounded-md bg-slate-200 dark:bg-lc-hover" />
                                        <div className="h-5 w-1/2 rounded-md bg-slate-200 dark:bg-lc-hover" />
                                    </div>
                                    <div className="mb-6 flex flex-col gap-2 mt-2">
                                        <div className="flex justify-between">
                                            <div className="h-3 w-16 rounded-md bg-slate-200 dark:bg-lc-hover" />
                                            <div className="h-3 w-8 rounded-md bg-slate-200 dark:bg-lc-hover" />
                                        </div>
                                        <div className="h-2 w-full rounded-full bg-slate-200 dark:bg-lc-hover" />
                                    </div>
                                    <div className="mb-8 flex gap-2">
                                        <div className="h-6 w-16 rounded-lg bg-slate-200 dark:bg-lc-hover" />
                                        <div className="h-6 w-20 rounded-lg bg-slate-200 dark:bg-lc-hover" />
                                    </div>
                                    <div className="mt-auto flex gap-3">
                                        <div className="h-[46px] w-full rounded-xl bg-slate-200 dark:bg-lc-hover" />
                                        <div className="h-[46px] w-[46px] shrink-0 rounded-xl bg-slate-200 dark:bg-lc-hover" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </main>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex-1 overflow-auto bg-slate-50/50 flex flex-col dark:bg-[#1a1a1a]">
                <PageHeader
                    showBack={true}
                    backUrl="/dashboard"
                    titleNode={
                        <div className="flex flex-col leading-tight text-left">
                            <h1 className="text-[28px] font-bold text-slate-900 dark:text-white font-nunito tracking-[-0.02em]">My Practice Sheets</h1>
                            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Review your report-based practice sheets</p>
                        </div>
                    }
                />
                <main className="flex-1 px-4 pb-12 sm:px-6 lg:px-8 mt-6">
                    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6">
                        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 shadow-sm dark:border-red-900/50 dark:bg-red-950/20 md:p-8">
                            <p className="text-red-600 dark:text-red-400">Error: {error}</p>
                        </div>
                    </div>
                </main>
            </div>
        );
    }

    const isRenameSaving = !!renameDialog && renaming === renameDialog.sheetId;

    return (
        <div className="flex-1 overflow-auto bg-slate-50/50 flex flex-col dark:bg-[#1a1a1a]">
            <PageHeader
                showBack={true}
                backUrl="/dashboard"
                titleNode={
                    <div className="flex flex-col leading-tight text-left">
                        <h1 className="text-[28px] font-bold text-slate-900 dark:text-white font-nunito tracking-[-0.02em]">My Practice Sheets</h1>
                    </div>
                }
            />

            <main className="flex-1 px-4 pb-12 sm:px-6 lg:px-8 mt-8">
                <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-8">
                    <div className="flex flex-col gap-6">
                        {/* Type Filter Banner */}
                        <div className="inline-flex w-max items-center gap-1.5 overflow-x-auto no-scrollbar bg-slate-100/80 dark:bg-[#1a1a1a] rounded-full p-1 border border-slate-200/50 dark:border-white/10">
                                <button
                                    onClick={() => setActiveFilter("all")}
                                    className={`whitespace-nowrap px-4 py-1.5 rounded-full text-[13px] font-bold transition-all duration-300 ${
                                        activeFilter === "all"
                                            ? "bg-white text-[#6C63FF] shadow-[0_2px_8px_-2px_rgba(0,0,0,0.08)] ring-1 ring-slate-200/60 dark:bg-[#2a2a2a] dark:text-[#B7B2FF] dark:ring-white/10"
                                            : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-white/5"
                                    }`}
                                >
                                    All
                                </button>
                                {uniqueCategories.map((category, idx) => (
                                    <button
                                        key={idx}
                                        onClick={() => setActiveFilter(category)}
                                        className={`whitespace-nowrap px-4 py-1.5 rounded-full text-[13px] font-bold transition-all duration-300 ${
                                            activeFilter === category
                                                ? "bg-white text-[#6C63FF] shadow-[0_2px_8px_-2px_rgba(0,0,0,0.08)] ring-1 ring-slate-200/60 dark:bg-[#2a2a2a] dark:text-[#B7B2FF] dark:ring-white/10"
                                                : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-white/5"
                                        }`}
                                    >
                                        {category}
                                    </button>
                                ))}
                        </div>

                        {/* Sort Row */}
                        <div className="flex w-full justify-between items-center">
                            <button
                                onClick={() => setShowCreateModal(true)}
                                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-full font-medium transition-colors"
                            >
                                <span className="material-symbols-outlined text-[20px]">add</span>
                                Create New Sheet
                            </button>
                            <CustomSortDropdown value={sortOrder} onChange={setSortOrder} />
                        </div>

                        {filteredAndSortedSheets.length === 0 ? (
                            <div className="text-center py-32 rounded-3xl bg-white/40 dark:bg-[#111111]/40 border border-slate-200/80 dark:border-white/10 backdrop-blur-xl shadow-sm mt-4">
                                <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-slate-100 dark:bg-white/5">
                                    <span className="material-symbols-outlined text-[40px] text-slate-400 dark:text-slate-500" style={{ fontVariationSettings: "'FILL' 1" }}>
                                        quiz
                                    </span>
                                </div>
                                <h3 className="mb-2 text-lg font-bold text-slate-800 dark:text-white">No practice sheets found</h3>
                                <p className="mx-auto max-w-md text-sm text-slate-500 dark:text-slate-400">
                                    {activeFilter !== "all" ? `No sheets found matching the category "${activeFilter}". Try clearing your filters or changing categories.` : "Generate your first sheet from a completed interview report in the AI Tutor."}
                                </p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 mt-2">
                                {filteredAndSortedSheets.map((sheet) => (
                                    <SheetCard
                                        key={sheet.sheetId}
                                        sheet={sheet}
                                        deleting={deleting}
                                        renaming={renaming}
                                        deleteConfirm={deleteConfirm}
                                        setDeleteConfirm={setDeleteConfirm}
                                        handleRenameSheet={handleRenameSheet}
                                        handleDeleteSheet={handleDeleteSheet}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </main>
            
            {/* Create Sheet Modal */}
            {showCreateModal && (
                <div className="fixed inset-0 z-[120] flex items-center justify-center bg-neutral-950/50 dark:bg-black/50 backdrop-blur-sm px-4">
                    <div className="w-full max-w-md rounded-3xl border border-slate-200/80 bg-white p-6 shadow-[0_18px_50px_-12px_rgba(0,0,0,0.25)] dark:border-white/10 dark:bg-[#161616]">
                        <div className="text-center mb-5">
                            <h3 className="text-[24px] font-bold text-slate-900 dark:text-white">Create New Sheet</h3>
                        </div>
                        
                        <div className="space-y-3">
                            {/* Generate with AI Option */}
                            <button
                                onClick={() => {
                                    setShowCreateModal(false);
                                    router.push("/ai-tutor");
                                }}
                                className="w-full p-4 rounded-xl bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/20 dark:hover:bg-blue-900/30 transition-all text-left overflow-hidden"
                            >
                                <h4 className="font-bold text-[16px] text-slate-900 dark:text-white">Generate with AI</h4>
                                <p className="mt-0.5 text-[13px] text-slate-900 dark:text-white truncate">Let AI create a personalized sheet based on your preferences</p>
                            </button>
                            
                            {/* Create Manually Option */}
                            <button
                                onClick={() => {
                                    setShowCreateModal(false);
                                    setShowCustomSheetCreation(true);
                                }}
                                className="w-full p-4 rounded-xl bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/20 dark:hover:bg-blue-900/30 transition-all text-left overflow-hidden"
                            >
                                <h4 className="font-bold text-[16px] text-slate-900 dark:text-white">Create Custom Sheet</h4>
                                <p className="mt-0.5 text-[13px] text-slate-900 dark:text-white truncate">Select questions from DSA, CS Fundamentals, SQL, and System Design</p>
                            </button>
                        </div>
                        
                        <button
                            onClick={() => setShowCreateModal(false)}
                            className="w-full mt-4 px-4 py-2 text-[14px] font-medium text-slate-900 dark:text-white hover:opacity-70 transition-opacity"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}
            
            {renameDialog && (
                <div
                    className="fixed inset-0 z-[120] flex items-center justify-center bg-neutral-950/50 dark:bg-black/50 backdrop-blur-sm px-4"
                    onClick={() => {
                        if (!isRenameSaving) setRenameDialog(null);
                    }}
                >
                    <div
                        className="w-full max-w-md rounded-3xl border border-slate-200/80 bg-white p-5 shadow-[0_18px_50px_-12px_rgba(0,0,0,0.25)] dark:border-white/10 dark:bg-[#161616]"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h3 className="text-[18px] font-bold text-slate-900 dark:text-white">Rename Sheet</h3>
                        <p className="mt-1 text-[13px] text-slate-500 dark:text-slate-400">Enter a new name for this sheet.</p>

                        <input
                            autoFocus
                            type="text"
                            maxLength={100}
                            value={renameDialog.value}
                            onChange={(e) => setRenameDialog((prev) => (prev ? { ...prev, value: e.target.value } : prev))}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                    e.preventDefault();
                                    void submitRenameSheet();
                                }
                            }}
                            className="mt-4 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-[14px] text-slate-800 outline-none transition-all focus:border-blue-400 focus:ring-2 focus:ring-blue-400/30 dark:border-white/15 dark:bg-[#0f0f0f] dark:text-white"
                            placeholder="Sheet name"
                        />

                        <div className="mt-4 flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setRenameDialog(null)}
                                disabled={isRenameSaving}
                                className="rounded-lg border border-slate-200 px-3 py-2 text-[13px] font-bold text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    void submitRenameSheet();
                                }}
                                disabled={isRenameSaving}
                                className="rounded-lg bg-blue-600 px-3 py-2 text-[13px] font-bold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {isRenameSaving ? "Saving..." : "Save"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Manual Create Sheet Form */}
            {showManualCreateForm && (
                <div
                    className="fixed inset-0 z-[120] flex items-center justify-center bg-neutral-950/50 dark:bg-black/50 backdrop-blur-sm px-4"
                    onClick={() => {
                        if (!creating) {
                            setShowManualCreateForm(false);
                            setNewSheetName("");
                            setError(null);
                        }
                    }}
                >
                    <div
                        className="w-full max-w-md rounded-3xl border border-slate-200/80 bg-white p-5 shadow-[0_18px_50px_-12px_rgba(0,0,0,0.25)] dark:border-white/10 dark:bg-[#161616]"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h3 className="text-[18px] font-bold text-slate-900 dark:text-white">Create New Sheet</h3>
                        <p className="mt-1 text-[13px] text-slate-500 dark:text-slate-400">Enter a name for your custom practice sheet.</p>

                        <input
                            autoFocus
                            type="text"
                            maxLength={100}
                            value={newSheetName}
                            onChange={(e) => setNewSheetName(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && newSheetName.trim()) {
                                    e.preventDefault();
                                    void handleCreateSheet();
                                }
                            }}
                            className="mt-4 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-[14px] text-slate-800 outline-none transition-all focus:border-blue-400 focus:ring-2 focus:ring-blue-400/30 dark:border-white/15 dark:bg-[#0f0f0f] dark:text-white"
                            placeholder="e.g., Array Problems"
                        />

                        {error && (
                            <p className="mt-2 text-[13px] text-red-600 dark:text-red-400">{error}</p>
                        )}

                        <div className="mt-4 flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => {
                                    setShowManualCreateForm(false);
                                    setNewSheetName("");
                                    setError(null);
                                }}
                                disabled={creating}
                                className="rounded-lg border border-slate-200 px-3 py-2 text-[13px] font-bold text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    void handleCreateSheet();
                                }}
                                disabled={!newSheetName.trim() || creating}
                                className="rounded-lg bg-blue-600 px-3 py-2 text-[13px] font-bold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 flex items-center gap-2"
                            >
                                {creating && <div className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />}
                                {creating ? "Creating..." : "Create"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Custom Sheet Creation Modal */}
            <CustomSheetCreationModal
                isOpen={showCustomSheetCreation}
                onClose={() => setShowCustomSheetCreation(false)}
                onSuccess={handleCustomSheetSuccess}
            />
        </div>
    );
}
