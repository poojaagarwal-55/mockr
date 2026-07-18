"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { PageHeader } from "@/components/page-header";
import { QuestionListItem } from "@/components/question-list-item";
import { QuestionFilters } from "@/components/question-filters";
import { CompanyTagsSidebar } from "@/components/company-tags-sidebar";
import { AddToSheetModal } from "@/components/add-to-sheet-modal";
import { usePersistentFilters } from "@/hooks/use-persistent-filters";
import Image from "next/image";

const DSA_CATALOG_PAGE_LIMIT = 1000;

interface Question {
    id: string;
    problemId: string;
    frontendId: string;
    title: string;
    slug: string;
    difficulty: "Easy" | "Medium" | "Hard";
    topics: string[];
    acceptanceRate: number;
}

interface QuestionsResponse {
    success: boolean;
    data: {
        questions: Question[];
        pagination: {
            page: number;
            limit: number;
            total: number;
            totalPages: number;
        };
        filters: {
            topics: Record<string, number>;
            difficulties: Record<string, number>;
        };
    };
}

interface ProgressResponse {
    success: boolean;
    data: {
        progress: Record<string, {
            status: string;
            solvedAt: string | null;
            timeTaken: number | null;
            language: string | null;
            bestScore: number | null;
            attemptCount: number;
        }>;
        stats: {
            totalAttempted: number;
            totalSolved: number;
        };
    };
}

export default function QuestionsPage() {
    useEffect(() => { document.title = "DSA Questions | Mockr"; }, []);
    
    // Use persistent filters
    const {
        filters,
        setDifficulty,
        setTopics,
        setStatus,
        setSearch,
        setSort,
        resetFilters,
        hasActiveFilters,
    } = usePersistentFilters({ category: "dsa" });
    const [questions, setQuestions] = useState<Question[]>([]);
    const [progress, setProgress] = useState<Record<string, any>>(() => {
        if (typeof window !== "undefined") {
            try {
                const cached = localStorage.getItem("dsa_progress_cache");
                if (cached) return JSON.parse(cached);
            } catch (err) {
                console.error("Failed to parse cached progress", err);
            }
        }
        return {};
    });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    
    const [pagination, setPagination] = useState({
        page: 1,
        limit: 1000,
        total: 0,
        totalPages: 0,
    });

    const [topicCounts, setTopicCounts] = useState<Record<string, number>>({});
    const [difficultyCounts, setDifficultyCounts] = useState<Record<string, number>>({});
    const [solvedCount, setSolvedCount] = useState(0);
    
    // Selection state for bulk operations
    const [isSelectionMode, setIsSelectionMode] = useState(false);
    const [selectedQuestions, setSelectedQuestions] = useState<Set<string>>(new Set());
    const [showBulkAddToSheet, setShowBulkAddToSheet] = useState(false);

    // Selection helper functions
    const toggleSelectionMode = () => {
        setIsSelectionMode(!isSelectionMode);
        setSelectedQuestions(new Set()); // Clear selections when toggling mode
    };

    const toggleQuestionSelection = (questionId: string) => {
        const newSelected = new Set(selectedQuestions);
        if (newSelected.has(questionId)) {
            newSelected.delete(questionId);
        } else {
            newSelected.add(questionId);
        }
        setSelectedQuestions(newSelected);
    };

    const handleBulkAddToSheet = () => {
        if (selectedQuestions.size > 0) {
            setShowBulkAddToSheet(true);
        }
    };

    // Fetch questions when filters change
    useEffect(() => {
        let isMounted = true;
        const fetchQuestions = async () => {
            setLoading(true);
            setError(null);

            try {
                // Get auth token
                const { data } = await createSupabaseBrowserClient().auth.getSession();
                const token = data.session?.access_token;

                const params = new URLSearchParams();
                if (filters.difficulty) params.append("difficulty", filters.difficulty);
                if (filters.topics.length > 0) {
                    filters.topics.forEach(t => params.append("topics", t));
                }
                params.append("page", "1"); // Always start from page 1 when filters change
                params.append("limit", String(DSA_CATALOG_PAGE_LIMIT));

                const response = await api.get<QuestionsResponse>(`/ide/questions?${params.toString()}`, token);
                
                if (response.success && response.data && isMounted) {
                    setQuestions(response.data.questions);
                    setPagination(response.data.pagination);
                    setTopicCounts(response.data.filters.topics);
                    setDifficultyCounts(response.data.filters.difficulties);
                }
            } catch (err: any) {
                if (isMounted) {
                    console.error("Failed to fetch questions:", err);
                    setError(err.message || "Failed to load questions");
                }
            } finally {
                if (isMounted) setLoading(false);
            }
        };

        fetchQuestions();

        return () => { isMounted = false; };
    }, [filters.difficulty, filters.topics]);

    // Fetch user progress
    useEffect(() => {
        const fetchProgress = async () => {
            try {
                // Get auth token
                const { data } = await createSupabaseBrowserClient().auth.getSession();
                const token = data.session?.access_token;

                if (!token) {
                    console.warn("No auth token available for progress fetch");
                    return;
                }

                const response = await api.get<ProgressResponse>("/ide/progress", token);
                if (response.success && response.data) {
                    setProgress(response.data.progress);
                    if (typeof window !== "undefined") {
                        localStorage.setItem("dsa_progress_cache", JSON.stringify(response.data.progress));
                    }
                }
            } catch (err: any) {
                // Silently fail for progress - it's not critical
                console.warn("Failed to fetch progress (non-critical):", err.message);
            }
        };

        fetchProgress();
    }, []);

    // Recompute solvedCount from only DSA question IDs (progress map includes all question types)
    useEffect(() => {
        if (questions.length === 0) return;
        const dsaIds = new Set(questions.map(q => q.id));
        const count = Object.entries(progress).filter(
            ([id, p]) => dsaIds.has(id) && p?.status === "solved"
        ).length;
        setSolvedCount(count);
    }, [progress, questions]);

    const handleDifficultyChange = (difficulty: "Easy" | "Medium" | "Hard" | null) => {
        setDifficulty(difficulty);
    };

    const handleTopicsChange = (topics: string[]) => {
        setTopics(topics);
    };

    const handleSearchChange = (search: string) => {
        setSearch(search);
    };

    const handleSortChange = (sortBy: string, sortOrder: string) => {
        setSort(sortBy, sortOrder);
    };

    const handleStatusChange = (status: string) => {
        setStatus(status);
    };

    // Status filter (client-side using progress data)
    const statusFilteredQuestions = questions.filter((q) => {
        const qProgress = progress[q.id];
        if (filters.status === "Solved") return qProgress?.status === "solved";
        if (filters.status === "Attempted") return qProgress?.status === "attempted";
        if (filters.status === "Unsolved") return !qProgress || (qProgress.status !== "solved" && qProgress.status !== "attempted");
        return true; // "All"
    });

    const normalizedSearch = filters.search.trim().toLowerCase();
    const searchFilteredQuestions = normalizedSearch.length > 0
        ? statusFilteredQuestions.filter((q) => {
            const title = q.title.toLowerCase();
            if (title.startsWith(normalizedSearch)) return true;
            if (q.frontendId?.toLowerCase().startsWith(normalizedSearch)) return true;
            if (Array.isArray(q.topics)) {
                return q.topics.some((topic) => topic.toLowerCase().startsWith(normalizedSearch));
            }
            return false;
        })
        : statusFilteredQuestions;

    // Sort questions based on filters
    const sortedQuestions = [...searchFilteredQuestions].sort((a, b) => {
        if (filters.sortBy === "difficulty") {
            const difficultyOrder = { "Hard": 3, "Medium": 2, "Easy": 1 };
            const diff = difficultyOrder[a.difficulty] - difficultyOrder[b.difficulty];
            return filters.sortOrder === "desc" ? -diff : diff;
        } else if (filters.sortBy === "questionId") {
            const diff = parseInt(a.frontendId) - parseInt(b.frontendId);
            return filters.sortOrder === "desc" ? -diff : diff;
        }
        // Default: sort by frontendId ascending
        return parseInt(a.frontendId) - parseInt(b.frontendId);
    });

    return (
        <div className="flex-1 overflow-hidden bg-white dark:bg-[#282828] flex flex-col">
          <PageHeader titleNode={<h1 className="text-[28px] font-bold text-slate-900 dark:text-white font-nunito tracking-[-0.02em]">DSA Questions</h1>} showBack={true} backUrl="/questions" />
            
            <div className="flex-1 flex overflow-hidden">
                {/* Main Content */}
                <div className="flex-1 flex flex-col overflow-hidden">
                    {/* Scrollable Content Area */}
                    <div id="questions-scroll-container" className="flex-1 overflow-y-auto flex flex-col">

                        {/* Filters */}
                        <div className="bg-white dark:bg-[#282828] p-6">
                            <QuestionFilters
                                topicCounts={topicCounts}
                                difficultyCounts={difficultyCounts}
                                selectedDifficulty={filters.difficulty}
                                selectedTopics={filters.topics}
                                searchQuery={filters.search}
                                onDifficultyChange={handleDifficultyChange}
                                onTopicsChange={handleTopicsChange}
                                onSearchChange={handleSearchChange}
                                onSortChange={handleSortChange}
                                onStatusChange={handleStatusChange}
                                solvedCount={solvedCount}
                                totalCount={pagination.total}
                                isSelectionMode={isSelectionMode}
                                onToggleSelectionMode={toggleSelectionMode}
                            />
                            
                            {/* Reset Filters Button */}
                            {hasActiveFilters && (
                                <div className="mt-4 flex justify-end">
                                    <button
                                        onClick={resetFilters}
                                        className="flex items-center gap-2 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                                    >
                                        <span className="material-symbols-outlined text-[16px]">refresh</span>
                                        Reset Filters
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Questions List */}
                        <div className="flex-1 bg-white dark:bg-[#282828]">
                            {loading && pagination.page === 1 ? (
                                <div className="divide-y divide-slate-100 dark:divide-slate-700/50">
                                    {Array.from({ length: 12 }).map((_, i) => (
                                        <div key={i} className="flex items-center gap-4 px-6 py-4 animate-pulse">
                                            {/* Index number */}
                                            <div className="w-6 h-4 bg-slate-200 dark:bg-slate-700 rounded" />
                                            {/* Difficulty dot */}
                                            <div className="w-2 h-2 rounded-full bg-slate-200 dark:bg-slate-700 flex-shrink-0" />
                                            {/* Title */}
                                            <div className="flex-1 min-w-0">
                                                <div className={`h-4 bg-slate-200 dark:bg-slate-700 rounded ${ i % 3 === 0 ? 'w-3/4' : i % 3 === 1 ? 'w-1/2' : 'w-2/3' }`} />
                                            </div>
                                            {/* Tags */}
                                            <div className="hidden sm:flex items-center gap-2">
                                                <div className="h-5 w-14 bg-slate-200 dark:bg-slate-700 rounded-full" />
                                                <div className="h-5 w-20 bg-slate-200 dark:bg-slate-700 rounded-full" />
                                            </div>
                                            {/* Acceptance rate */}
                                            <div className="w-10 h-4 bg-slate-200 dark:bg-slate-700 rounded" />
                                        </div>
                                    ))}
                                </div>
                            ) : error ? (
                                <div className="flex items-center justify-center py-20">
                                    <div className="flex flex-col items-center gap-4 max-w-md text-center">
                                        <span className="material-symbols-outlined text-5xl text-red-500">
                                            error
                                        </span>
                                        <h3 className="text-xl font-semibold text-slate-900 dark:text-white">
                                            Failed to Load Questions
                                        </h3>
                                        <p className="text-slate-500 dark:text-slate-400">
                                            {error}
                                        </p>
                                        <button
                                            onClick={() => window.location.reload()}
                                            className="px-4 py-2 bg-teal-500 text-white rounded-lg hover:bg-teal-600 transition-colors"
                                        >
                                            Try Again
                                        </button>
                                    </div>
                                </div>
                            ) : sortedQuestions.length === 0 ? (
                                <div className="flex items-center justify-center py-20">
                                    <div className="flex flex-col items-center gap-4 max-w-md text-center">
                                        <span className="material-symbols-outlined text-5xl text-slate-300 dark:text-slate-700">
                                            search_off
                                        </span>
                                        <h3 className="text-xl font-semibold text-slate-900 dark:text-white">
                                            No Questions Found
                                        </h3>
                                        <p className="text-slate-500 dark:text-slate-400">
                                            Try adjusting your filters or search query
                                        </p>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <div>
                                        {sortedQuestions.map((question, i) => (
                                            <QuestionListItem
                                                key={`${question.id}-${i}`}
                                                id={question.id}
                                                frontendId={question.frontendId}
                                                title={question.title}
                                                difficulty={question.difficulty}
                                                acceptanceRate={question.acceptanceRate}
                                                topics={question.topics}
                                                isSolved={progress[question.id]?.status === "solved"}
                                                isSelectionMode={isSelectionMode}
                                                isSelected={selectedQuestions.has(question.id)}
                                                onToggleSelection={toggleQuestionSelection}
                                                index={i}
                                            />
                                        ))}
                                    </div>

                                    {/* Loading More Indicator / Infinite Scroll Trigger */}
                                    <div id="infinite-scroll-trigger" className="h-4 w-full"></div>
                                    {loading && pagination.page > 1 && (
                                        <div className="flex items-center justify-center py-6">
                                            <div className="flex space-x-2">
                                                <div className="w-2.5 h-2.5 bg-slate-400 dark:bg-slate-300 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                                                <div className="w-2.5 h-2.5 bg-slate-400 dark:bg-slate-300 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                                                <div className="w-2.5 h-2.5 bg-slate-400 dark:bg-slate-300 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                                            </div>
                                        </div>
                                    )}

                                    {/* End of List Indicator */}
                                    {!loading && pagination.page >= pagination.totalPages && questions.length > 0 && (
                                        <div className="flex items-center justify-center py-8">
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                </div>

                {/* Right Sidebar - Company Tags */}
                {/* <CompanyTagsSidebar /> */}
            </div>
            
            {/* Floating Add to Sheet Button */}
            {isSelectionMode && selectedQuestions.size > 0 && (
                <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 z-50">
                    <button
                        onClick={handleBulkAddToSheet}
                        className="flex items-center gap-3 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg hover:shadow-xl transition-all font-medium"
                    >
                        <span className="material-symbols-outlined text-[20px]">playlist_add</span>
                        Add {selectedQuestions.size} question{selectedQuestions.size !== 1 ? 's' : ''} to Sheet
                    </button>
                </div>
            )}
            
            {/* Bulk Add to Sheet Modal */}
            <AddToSheetModal
                isOpen={showBulkAddToSheet}
                onClose={() => setShowBulkAddToSheet(false)}
                questionId={Array.from(selectedQuestions).join(',')} // Pass comma-separated IDs
                questionType="dsa"
                onSuccess={() => {
                    console.log("Questions added to sheet successfully");
                    setSelectedQuestions(new Set()); // Clear selections
                    setIsSelectionMode(false); // Exit selection mode
                    setShowBulkAddToSheet(false);
                }}
            />
        </div>
    );
}
