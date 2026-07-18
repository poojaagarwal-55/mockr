"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { AddToSheetModal } from "@/components/add-to-sheet-modal";
import { api } from "@/lib/api";

interface SystemDesignQuestion {
    id: string;
    slug: string;
    title: string;
    difficulty: "Easy" | "Medium" | "Hard";
    preview: string;
    number: number;
}

const DIFFICULTY_COLORS: Record<string, string> = {
    Easy: "text-emerald-500 dark:text-emerald-400",
    Medium: "text-amber-500 dark:text-amber-400",
    Hard: "text-red-500 dark:text-red-400",
};

function SystemDesignQuestionRow({
    question,
    idx,
    onNavigate,
    isSolved = false,
    isSelectionMode = false,
    isSelected = false,
    onToggleSelection,
}: {
    question: SystemDesignQuestion;
    idx: number;
    onNavigate: () => void;
    isSolved?: boolean;
    isSelectionMode?: boolean;
    isSelected?: boolean;
    onToggleSelection?: (id: string) => void;
}) {
    const [showAddToSheet, setShowAddToSheet] = useState(false);

    const handleClick = () => {
        if (isSelectionMode && onToggleSelection) {
            onToggleSelection(question.id);
        } else {
            onNavigate();
        }
    };

    return (
        <>
            <div
                onClick={handleClick}
                className={`group flex items-center gap-4 px-4 py-3 cursor-pointer transition-colors ${
                    idx % 2 === 0
                        ? "bg-slate-50 dark:bg-[#232323]"
                        : "bg-white dark:bg-[#282828]"
                }`}
            >
                {/* Checkbox (selection mode) or solved tick */}
                <div className="flex-shrink-0 w-6 h-6 flex items-center justify-center">
                    {isSelectionMode ? (
                        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                            isSelected
                                ? "bg-blue-600 border-blue-600"
                                : "border-slate-300 dark:border-slate-600 hover:border-blue-500"
                        }`}>
                            {isSelected && (
                                <span className="material-symbols-outlined text-white text-[14px]">check</span>
                            )}
                        </div>
                    ) : isSolved ? (
                        <span className="material-symbols-outlined text-emerald-500 text-[18px]">check</span>
                    ) : (
                        <span className="material-symbols-outlined text-slate-300 dark:text-slate-600 text-[18px]">
                            radio_button_unchecked
                        </span>
                    )}
                </div>

                {/* Number + Title */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                        <span className="text-slate-500 dark:text-slate-400 font-medium text-sm flex-shrink-0">
                            {idx + 1}.
                        </span>
                        <h3 className="text-slate-900 dark:text-white font-medium truncate">
                            {question.title}
                        </h3>
                    </div>
                </div>

                {/* Difficulty Badge */}
                <div className="flex-shrink-0 min-w-[70px] text-right text-sm font-medium">
                    <span className={DIFFICULTY_COLORS[question.difficulty] ?? "text-slate-600 dark:text-slate-400"}>
                        {question.difficulty}
                    </span>
                </div>

                {/* Add to Sheet */}
                <button
                    onClick={(e) => { e.stopPropagation(); setShowAddToSheet(true); }}
                    className="flex-shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 dark:hover:text-blue-400 transition-all flex items-center justify-center"
                    title="Add to sheet"
                >
                    <span className="material-symbols-outlined text-[20px]">playlist_add</span>
                </button>
            </div>

            <AddToSheetModal
                isOpen={showAddToSheet}
                onClose={() => setShowAddToSheet(false)}
                questionId={question.id}
                questionType="sd"
                onSuccess={() => { setShowAddToSheet(false); }}
            />
        </>
    );
}

export default function SystemDesignPage() {
    useEffect(() => { document.title = "System Design | Mockr"; }, []);
    const router = useRouter();

    const [questions, setQuestions] = useState<SystemDesignQuestion[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [difficultyCounts, setDifficultyCounts] = useState<Record<string, number>>({});
    const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 0 });
    const [progress, setProgress] = useState<Record<string, any>>({});

    // Applied filters (send to API)
    const [appliedDifficulty, setAppliedDifficulty] = useState<string | null>(null);
    const [currentPage, setCurrentPage] = useState(1);

    // Search input (debounced)
    const [searchInput, setSearchInput] = useState("");

    // Sort
    const [sortBy, setSortBy] = useState("default");
    const [sortOrder, setSortOrder] = useState("asc");
    const [showSortMenu, setShowSortMenu] = useState(false);

    // Filter modal
    const [showFilterModal, setShowFilterModal] = useState(false);
    const [localDifficulty, setLocalDifficulty] = useState<string | null>(null);

    // Selection mode
    const [isSelectionMode, setIsSelectionMode] = useState(false);
    const [selectedQuestions, setSelectedQuestions] = useState<Set<string>>(new Set());
    const [showBulkAddToSheet, setShowBulkAddToSheet] = useState(false);

    // Fetch questions
    useEffect(() => {
        let isMounted = true;
        const fetchQuestions = async () => {
            setLoading(true);
            try {
                const { data } = await createSupabaseBrowserClient().auth.getSession();
                const token = data.session?.access_token;

                const params = new URLSearchParams();
                if (appliedDifficulty) params.append("difficulty", appliedDifficulty);
                params.append("page", currentPage.toString());
                params.append("limit", "50");

                const res = await fetch(
                    `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/system-design/questions?${params.toString()}`,
                    { headers: token ? { Authorization: `Bearer ${token}` } : {} }
                );
                const json = await res.json();
                if (json.success && isMounted) {
                    if (currentPage === 1) {
                        setQuestions(json.data.questions);
                    } else {
                        setQuestions(prev => [...prev, ...json.data.questions]);
                    }
                    setPagination(json.data.pagination);
                    setDifficultyCounts(json.data.filters.difficulties);
                } else if (isMounted) {
                    setError(json.error || "Failed to load questions");
                }
            } catch (err: any) {
                if (isMounted) setError(err.message || "Failed to load questions");
            } finally {
                if (isMounted) setLoading(false);
            }
        };
        fetchQuestions();
        return () => { isMounted = false; };
    }, [appliedDifficulty, currentPage]);

    // Infinite scroll
    useEffect(() => {
        const container = document.getElementById("sd-scroll-container");
        if (!container) return;
        const handleScroll = () => {
            const { scrollTop, scrollHeight, clientHeight } = container;
            if ((scrollTop + clientHeight) / scrollHeight > 0.85 && !loading && currentPage < pagination.totalPages) {
                setCurrentPage(p => p + 1);
            }
        };
        container.addEventListener("scroll", handleScroll);
        return () => container.removeEventListener("scroll", handleScroll);
    }, [loading, currentPage, pagination.totalPages]);

    const toggleSelectionMode = () => {
        setIsSelectionMode(p => !p);
        setSelectedQuestions(new Set());
    };

    // Fetch progress
    useEffect(() => {
        const fetchProgress = async () => {
            try {
                const { data } = await createSupabaseBrowserClient().auth.getSession();
                const token = data.session?.access_token;
                if (!token) return;
                const response = await api.get<{ success: boolean; data: { progress: Record<string, any> } }>("/ide/progress", token);
                if (response.success && response.data) {
                    setProgress(response.data.progress);
                }
            } catch { /* non-critical */ }
        };
        fetchProgress();
    }, []);

    const toggleQuestionSelection = (id: string) => {
        setSelectedQuestions(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    };

    const normalizedSearch = searchInput.trim().toLowerCase();
    const searchFiltered = normalizedSearch.length > 0
        ? questions.filter((q) => {
            const title = q.title.toLowerCase();
            if (title.startsWith(normalizedSearch)) return true;
            if (q.slug?.toLowerCase().startsWith(normalizedSearch)) return true;
            return false;
        })
        : questions;

    // Sort
    const sortedQuestions = [...searchFiltered].sort((a, b) => {
        if (sortBy === "title") {
            return sortOrder === "asc" ? a.title.localeCompare(b.title) : b.title.localeCompare(a.title);
        }
        return 0; // default: API order
    });

    const hasActiveFilters = appliedDifficulty !== null;

    return (
        <div className="flex-1 overflow-hidden bg-white dark:bg-[#282828] flex flex-col">
            <PageHeader titleNode={<h1 className="text-[28px] font-bold text-slate-900 dark:text-white font-nunito tracking-[-0.02em]">System Design</h1>} showBack={true} backUrl="/questions" />

            <div className="flex-1 flex overflow-hidden">
                <div className="flex-1 flex flex-col overflow-hidden">
                    <div id="sd-scroll-container" className="flex-1 overflow-y-auto flex flex-col">

                        {/* Filters Bar */}
                        <div className="bg-white dark:bg-[#282828] p-6">
                            <div className="flex items-center gap-3">
                                {/* Search */}
                                <div className="relative w-64">
                                    <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xl">search</span>
                                    <input
                                        type="text"
                                        placeholder="Search questions"
                                        value={searchInput}
                                        onChange={e => setSearchInput(e.target.value)}
                                        className="w-full h-10 pl-10 pr-10 py-2 rounded-full bg-white dark:bg-[#282828] border border-slate-200 dark:border-slate-700 dark:text-[#eff1f6] text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-colors dark:placeholder:text-[#6b6b6b]"
                                    />
                                    {searchInput && (
                                        <button
                                            onClick={() => setSearchInput("")}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                                        >
                                            <span className="material-symbols-outlined text-[18px]">close</span>
                                        </button>
                                    )}
                                </div>

                                {/* Filter Button — popup modal like DSA */}
                                <div className="relative">
                                    <button
                                        onClick={() => { setLocalDifficulty(appliedDifficulty); setShowFilterModal(true); }}
                                        className={`w-10 h-10 flex-shrink-0 rounded-full flex items-center justify-center transition-colors ${
                                            hasActiveFilters
                                                ? "bg-blue-600 text-white dark:bg-blue-500"
                                                : "bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-blue-900/50"
                                        }`}
                                        title="Filter questions"
                                    >
                                        <span className="material-symbols-outlined text-[20px]">filter_alt</span>
                                    </button>

                                    {showFilterModal && (
                                        <>
                                            <div
                                                className="fixed inset-0 bg-slate-900/40 z-30"
                                                onClick={() => setShowFilterModal(false)}
                                            />
                                            <div
                                                className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-white dark:bg-slate-800 rounded-3xl shadow-2xl z-[50] overflow-hidden flex flex-col"
                                                onClick={e => e.stopPropagation()}
                                            >
                                                <div className="flex items-center justify-between px-6 py-5">
                                                    <h3 className="text-[24px] font-bold text-slate-900 dark:text-white">Filter Questions</h3>
                                                </div>
                                                <div className="px-6 pb-2 space-y-5">
                                                    {/* Difficulty filter */}
                                                    <div className="space-y-3">
                                                        <div className="flex items-center gap-2">
                                                            <span className="material-symbols-outlined text-slate-500 dark:text-slate-400 text-xl">speed</span>
                                                            <h4 className="font-medium text-slate-900 dark:text-white">Difficulty</h4>
                                                        </div>
                                                        <div className="flex flex-wrap gap-2">
                                                            <button
                                                                onClick={() => setLocalDifficulty(null)}
                                                                className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                                                                    localDifficulty === null
                                                                        ? "bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900"
                                                                        : "bg-slate-100 dark:bg-[#343434] text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-[#404040]"
                                                                }`}
                                                            >
                                                                All
                                                            </button>
                                                            {["Easy", "Medium", "Hard"].map((difficulty) => (
                                                                <button
                                                                    key={difficulty}
                                                                    onClick={() => setLocalDifficulty(difficulty)}
                                                                    className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                                                                        localDifficulty === difficulty
                                                                            ? "bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900"
                                                                            : "bg-slate-100 dark:bg-[#343434] text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-[#404040]"
                                                                    }`}
                                                                >
                                                                    {difficulty}
                                                                    <span className="ml-1.5 inline-flex min-w-5 h-5 items-center justify-center rounded-full px-1 text-[11px] bg-slate-200 dark:bg-[#4a4a4a] text-slate-600 dark:text-slate-300">
                                                                        {difficultyCounts[difficulty] || 0}
                                                                    </span>
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="flex items-center justify-between px-6 py-5">
                                                    <button
                                                        onClick={() => setLocalDifficulty(null)}
                                                        className="px-4 py-2 text-sm rounded-full font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:bg-slate-100 dark:hover:bg-slate-700 dark:hover:text-white transition"
                                                    >
                                                        Clear All
                                                    </button>
                                                    <div className="flex items-center gap-3">
                                                        <button
                                                            onClick={() => setShowFilterModal(false)}
                                                            className="px-4 py-2 text-sm rounded-full font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:bg-slate-100 dark:hover:bg-slate-700 dark:hover:text-white transition"
                                                        >
                                                            Cancel
                                                        </button>
                                                        <button
                                                            onClick={() => {
                                                                setAppliedDifficulty(localDifficulty);
                                                                setCurrentPage(1);
                                                                setShowFilterModal(false);
                                                            }}
                                                            className="px-6 py-2 rounded-full text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 transition shadow-sm"
                                                        >
                                                            Apply Filters
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        </>
                                    )}
                                </div>

                                {/* Sort Button */}
                                <div className="relative">
                                    <button
                                        onClick={() => setShowSortMenu(p => !p)}
                                        className={`w-10 h-10 flex-shrink-0 rounded-full flex items-center justify-center transition-colors ${
                                            sortBy !== "default"
                                                ? "bg-blue-600 text-white dark:bg-blue-500"
                                                : "bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-blue-900/50"
                                        }`}
                                        title="Sort questions"
                                    >
                                        <span className="material-symbols-outlined text-[20px]">sort</span>
                                        {sortBy !== "default" && (
                                            <span className="absolute top-0 right-0 w-3.5 h-3.5 bg-blue-500 rounded-full flex items-center justify-center text-[10px] text-white font-bold border-2 border-white dark:border-[#282828] translate-x-1 -translate-y-1">
                                                {sortOrder === "desc" ? "↓" : "↑"}
                                            </span>
                                        )}
                                    </button>
                                    {showSortMenu && (
                                        <>
                                            <div className="fixed inset-0 z-40" onClick={() => setShowSortMenu(false)} />
                                            <div className="absolute top-full right-0 mt-2 bg-white dark:bg-[#282828] rounded-xl shadow-lg border border-slate-200 dark:border-slate-700 overflow-hidden z-50 min-w-[180px]">
                                                {[
                                                    { key: "default", label: "Default" },
                                                    { key: "title", label: "Title (A–Z)" },
                                                ].map(opt => (
                                                    <button
                                                        key={opt.key}
                                                        onClick={() => {
                                                            if (sortBy === opt.key && opt.key !== "default") {
                                                                setSortOrder(o => o === "asc" ? "desc" : "asc");
                                                            } else {
                                                                setSortBy(opt.key);
                                                                setSortOrder("asc");
                                                            }
                                                        }}
                                                        className={`w-full flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors text-left ${
                                                            sortBy === opt.key ? "bg-blue-50 dark:bg-blue-900/20" : ""
                                                        }`}
                                                    >
                                                        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{opt.label}</span>
                                                        {sortBy === opt.key && <span className="material-symbols-outlined text-blue-600 dark:text-blue-400 text-[18px]">check</span>}
                                                    </button>
                                                ))}
                                            </div>
                                        </>
                                    )}
                                </div>

                                {/* Question count */}
                                <div className="flex-1 flex justify-end">
                                    <span className="text-sm font-medium text-slate-500 dark:text-slate-400 mr-4">
                                        {pagination.total || questions.length} questions
                                    </span>
                                </div>

                                {/* Select Button */}
                                <button
                                    onClick={toggleSelectionMode}
                                    className={`min-w-[80px] h-10 px-4 rounded-full font-medium text-sm transition-colors ${
                                        isSelectionMode
                                            ? "bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50"
                                            : "bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-blue-900/50"
                                    }`}
                                >
                                    {isSelectionMode ? "Cancel" : "Select"}
                                </button>
                            </div>
                        </div>

                        {/* Questions List */}
                        <div className="flex-1 bg-white dark:bg-[#282828]">
                            {loading && currentPage === 1 ? (
                                <div className="divide-y divide-slate-100 dark:divide-slate-700/50">
                                    {Array.from({ length: 12 }).map((_, i) => (
                                        <div key={i} className="flex items-center gap-4 px-4 py-3 animate-pulse">
                                            <div className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-700 flex-shrink-0" />
                                            <div className="flex-1 min-w-0">
                                                <div className={`h-4 bg-slate-200 dark:bg-slate-700 rounded ${i % 3 === 0 ? "w-3/4" : i % 3 === 1 ? "w-1/2" : "w-2/3"}`} />
                                            </div>
                                            <div className="h-5 w-16 bg-slate-200 dark:bg-slate-700 rounded-full" />
                                            <div className="w-6 h-6 bg-slate-200 dark:bg-slate-700 rounded" />
                                        </div>
                                    ))}
                                </div>
                            ) : error ? (
                                <div className="flex items-center justify-center py-20">
                                    <div className="flex flex-col items-center gap-4 max-w-md text-center">
                                        <span className="material-symbols-outlined text-5xl text-red-500">error</span>
                                        <h3 className="text-xl font-semibold text-slate-900 dark:text-white">Failed to Load Questions</h3>
                                        <p className="text-slate-500 dark:text-slate-400">{error}</p>
                                        <button onClick={() => window.location.reload()} className="px-4 py-2 bg-blue-600 text-white rounded-full hover:bg-blue-700 transition-colors text-sm font-medium">
                                            Try Again
                                        </button>
                                    </div>
                                </div>
                            ) : sortedQuestions.length === 0 ? (
                                <div className="flex items-center justify-center py-20">
                                    <div className="flex flex-col items-center gap-4 text-center">
                                        <span className="material-symbols-outlined text-5xl text-slate-300 dark:text-slate-700">search_off</span>
                                        <h3 className="text-xl font-semibold text-slate-900 dark:text-white">No Questions Found</h3>
                                        <p className="text-slate-500 dark:text-slate-400">Try adjusting your filters or search query</p>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <div>
                                        {sortedQuestions.map((question, idx) => (
                                            <SystemDesignQuestionRow
                                                key={`${question.id}-${idx}`}
                                                question={question}
                                                idx={idx}
                                                onNavigate={() => router.push(`/questions/system-design/solve?id=${question.id}`)}
                                                isSolved={progress[`sd-${question.id}`]?.status === "solved"}
                                                isSelectionMode={isSelectionMode}
                                                isSelected={selectedQuestions.has(question.id)}
                                                onToggleSelection={toggleQuestionSelection}
                                            />
                                        ))}
                                    </div>

                                    <div id="sd-infinite-trigger" className="h-4 w-full" />
                                    {loading && currentPage > 1 && (
                                        <div className="flex items-center justify-center py-6">
                                            <div className="flex space-x-2">
                                                <div className="w-2.5 h-2.5 bg-slate-400 dark:bg-slate-300 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                                                <div className="w-2.5 h-2.5 bg-slate-400 dark:bg-slate-300 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                                                <div className="w-2.5 h-2.5 bg-slate-400 dark:bg-slate-300 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Floating bulk add button */}
            {isSelectionMode && selectedQuestions.size > 0 && (
                <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 z-50">
                    <button
                        onClick={() => setShowBulkAddToSheet(true)}
                        className="flex items-center gap-3 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg hover:shadow-xl transition-all font-medium"
                    >
                        <span className="material-symbols-outlined text-[20px]">playlist_add</span>
                        Add {selectedQuestions.size} question{selectedQuestions.size !== 1 ? "s" : ""} to Sheet
                    </button>
                </div>
            )}

            <AddToSheetModal
                isOpen={showBulkAddToSheet}
                onClose={() => setShowBulkAddToSheet(false)}
                questionId={Array.from(selectedQuestions).join(",")}
                questionType="sd"
                onSuccess={() => {
                    setSelectedQuestions(new Set());
                    setIsSelectionMode(false);
                    setShowBulkAddToSheet(false);
                }}
            />
        </div>
    );
}
