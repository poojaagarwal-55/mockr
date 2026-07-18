"use client";

import { useEffect, useMemo, useRef, useState } from "react";

interface QuestionFiltersProps {
    topicCounts?: Record<string, number>;
    difficultyCounts?: Record<string, number>;
    selectedDifficulty?: "Easy" | "Medium" | "Hard" | null;
    selectedTopics?: string[];
    searchQuery?: string;
    onDifficultyChange?: (difficulty: "Easy" | "Medium" | "Hard" | null) => void;
    onTopicsChange?: (topics: string[]) => void;
    onSearchChange?: (query: string) => void;
    onSortChange?: (sortBy: string, sortOrder: string) => void;
    onStatusChange?: (status: string) => void;
    solvedCount?: number;
    totalCount?: number;
    isSelectionMode?: boolean;
    onToggleSelectionMode?: () => void;
}

const QUICK_SEARCH_HINTS = ["Array", "Dynamic Programming", "Binary Search", "Graph", "Sliding Window"];

export function QuestionFilters({
    topicCounts = {},
    difficultyCounts = {},
    selectedDifficulty,
    selectedTopics = [],
    searchQuery = "",
    onDifficultyChange,
    onTopicsChange,
    onSearchChange,
    onSortChange,
    onStatusChange,
    solvedCount = 0,
    totalCount = 0,
    isSelectionMode = false,
    onToggleSelectionMode,
}: QuestionFiltersProps) {
    const [searchInput, setSearchInput] = useState(searchQuery);
    const [isSearchFocused, setIsSearchFocused] = useState(false);
    const [showFilterModal, setShowFilterModal] = useState(false);
    const [localStatus, setLocalStatus] = useState("All");
    const [localDifficulty, setLocalDifficulty] = useState<"Easy" | "Medium" | "Hard" | null>(null);
    const [localTopics, setLocalTopics] = useState<string[]>([]);
    
    const [showSortMenu, setShowSortMenu] = useState(false);
    const [showAllTopics, setShowAllTopics] = useState(false);
    const [sortBy, setSortBy] = useState<string>("default");
    const [sortOrder, setSortOrder] = useState<string>("desc");
    const hideSuggestionsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Get top topics sorted by count
    const topTopics = Object.entries(topicCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 20);

    const searchSuggestions = useMemo(() => {
        const query = searchInput.trim().toLowerCase();
        if (!query) return [] as Array<{ topic: string; count: number }>;

        return topTopics
            .filter(([topic]) => topic.toLowerCase().startsWith(query))
            .slice(0, 6)
            .map(([topic, count]) => ({ topic, count }));
    }, [searchInput, topTopics]);

    useEffect(() => {
        if (showFilterModal) {
            setLocalDifficulty(selectedDifficulty || null);
            setLocalTopics(selectedTopics || []);
        }
    }, [showFilterModal, selectedDifficulty, selectedTopics]);

    useEffect(() => {
        setSearchInput(searchQuery);
    }, [searchQuery]);

    const handleSearchInputChange = (value: string) => {
        setSearchInput(value);
        if (!onSearchChange) return;

        const nextQuery = value.trim();
        if (nextQuery !== searchQuery) {
            onSearchChange(nextQuery);
        }
    };

    useEffect(() => {
        return () => {
            if (hideSuggestionsTimeoutRef.current) {
                clearTimeout(hideSuggestionsTimeoutRef.current);
            }
        };
    }, []);

    const handleSearchFocus = () => {
        if (hideSuggestionsTimeoutRef.current) {
            clearTimeout(hideSuggestionsTimeoutRef.current);
            hideSuggestionsTimeoutRef.current = null;
        }
        setIsSearchFocused(true);
    };

    const handleSearchBlur = () => {
        hideSuggestionsTimeoutRef.current = setTimeout(() => {
            setIsSearchFocused(false);
        }, 120);
    };

    const applySearchValue = (value: string) => {
        setSearchInput(value);
        if (onSearchChange) {
            const nextQuery = value.trim();
            if (nextQuery !== searchQuery) {
                onSearchChange(nextQuery);
            }
        }
        setIsSearchFocused(false);
    };

    const toggleTopic = (topic: string) => {
        if (!onTopicsChange) return;
        
        if (selectedTopics.includes(topic)) {
            onTopicsChange(selectedTopics.filter((t) => t !== topic));
        } else {
            onTopicsChange([...selectedTopics, topic]);
        }
    };

    const toggleLocalTopic = (topic: string) => {
        if (localTopics.includes(topic)) {
            setLocalTopics(localTopics.filter((t) => t !== topic));
        } else {
            setLocalTopics([...localTopics, topic]);
        }
    };

    const handleSortChange = (newSortBy: string) => {
        let newSortOrder = "desc";
        
        // If clicking the same sort option, toggle the order
        if (sortBy === newSortBy) {
            newSortOrder = sortOrder === "desc" ? "asc" : "desc";
        }
        
        setSortBy(newSortBy);
        setSortOrder(newSortOrder);
        // Don't close the menu - let user close it by clicking outside
        
        if (onSortChange) {
            onSortChange(newSortBy, newSortOrder);
        }
    };

    const totalQuestions = Object.values(difficultyCounts).reduce((a, b) => a + b, 0);
    const activeFilterCount = selectedTopics.length + (selectedDifficulty ? 1 : 0) + (searchInput.trim() ? 1 : 0);
    const hasSearchText = searchInput.trim().length > 0;

    return (
        <div className="space-y-6">
            {/* Search & Action Buttons */}
            <div className="space-y-2">
            {/* Row 1: search + filter + sort (always visible) + solved count + select (desktop only) */}
            <div className="flex items-center gap-3">
                <div className="relative flex-1 md:flex-none md:w-64">
                    <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xl">
                        search
                    </span>
                    <input
                        type="text"
                        placeholder="Search questions"
                        value={searchInput}
                        onChange={(e) => handleSearchInputChange(e.target.value)}
                        onFocus={handleSearchFocus}
                        onBlur={handleSearchBlur}
                        className="w-full h-10 pl-10 pr-10 py-2 rounded-full bg-white dark:bg-[#282828] border border-slate-200 dark:border-slate-700 dark:text-[#eff1f6] text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-colors dark:placeholder:text-[#6b6b6b]"
                    />

                    {hasSearchText && (
                        <button
                            type="button"
                            onClick={() => applySearchValue("")}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                            aria-label="Clear question search"
                        >
                            <span className="material-symbols-outlined text-[18px]">close</span>
                        </button>
                    )}

                    {isSearchFocused && hasSearchText && searchSuggestions.length > 0 && (
                        <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-lc-surface rounded-xl shadow-lg border border-slate-100 dark:border-lc-border overflow-hidden z-60 py-1">
                            {searchSuggestions.map((suggestion) => (
                                <button
                                    key={suggestion.topic}
                                    type="button"
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => applySearchValue(suggestion.topic)}
                                    className="w-full flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-lc-hover transition-colors text-left"
                                >
                                    <span className="text-sm font-medium text-slate-700 dark:text-[#ccc]">{suggestion.topic}</span>
                                    <span className="text-xs text-slate-500 dark:text-slate-400">{suggestion.count} questions</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Filter Button */}
                <div className="relative">
                    <button
                        onClick={() => setShowFilterModal(!showFilterModal)}
                        className={`w-10 h-10 flex-shrink-0 rounded-full flex items-center justify-center transition-colors relative ${
                            showFilterModal || selectedDifficulty || selectedTopics.length > 0
                                ? "bg-blue-600 text-white dark:bg-blue-500"
                                : "bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-blue-900/50"
                        }`}
                        title="Filter questions"
                    >
                        <span className="material-symbols-outlined text-[20px]">filter_alt</span>
                    </button>

                    {/* Filter Modal */}
                    {showFilterModal && (
                        <>
                            {/* Backdrop */}
                            <div 
                                className="fixed inset-0 bg-black/70 z-40 dark:bg-black/70"
                                onClick={() => setShowFilterModal(false)}
                            />
                            
                            {/* Filter Panel */}
                            <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-2xl bg-[#1a1a1a] dark:bg-[#1a1a1a] rounded-3xl shadow-2xl border-none z-[50] max-h-[80vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
                                {/* Header */}
                                <div className="flex items-center justify-between px-6 py-5">
                                    <h3 className="text-[24px] font-bold text-white dark:text-white">Filter Questions</h3>
                                </div>

                                {/* Content */}
                                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                                    {/* Status Filter */}
                                    <div className="space-y-3">
                                        <div className="flex items-center gap-2">
                                            <span className="material-symbols-outlined text-slate-500 dark:text-slate-400 text-xl">check_circle</span>
                                            <h4 className="font-medium text-slate-900 dark:text-white">Status</h4>
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            {["All", "Solved", "Unsolved", "Attempted"].map((status) => (
                                                <button 
                                                    key={status}
                                                    onClick={() => setLocalStatus(status)}
                                                    className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                                                        localStatus === status
                                                            ? "bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900"
                                                            : "bg-slate-100 dark:bg-[#343434] text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-[#404040]"
                                                    }`}
                                                >
                                                    {status}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Difficulty Filter */}
                                    <div className="space-y-3">
                                        <div className="flex items-center gap-2">
                                            <span className="material-symbols-outlined text-slate-500 dark:text-slate-400 text-xl">speed</span>
                                            <h4 className="font-medium text-slate-900 dark:text-white">Difficulty</h4>
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            <button
                                                onClick={() => setLocalDifficulty(null)}
                                                className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                                                    !localDifficulty
                                                        ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                                                        : "bg-slate-100 dark:bg-[#343434] text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-[#404040]"
                                                }`}
                                            >
                                                All
                                            </button>
                                            <button
                                                onClick={() => setLocalDifficulty("Easy")}
                                                className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                                                    localDifficulty === "Easy"
                                                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                                                        : "bg-slate-100 dark:bg-[#343434] text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-[#404040]"
                                                }`}
                                            >
                                                Easy
                                            </button>
                                            <button
                                                onClick={() => setLocalDifficulty("Medium")}
                                                className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                                                    localDifficulty === "Medium"
                                                        ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                                                        : "bg-slate-100 dark:bg-[#343434] text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-[#404040]"
                                                }`}
                                            >
                                                Medium
                                            </button>
                                            <button
                                                onClick={() => setLocalDifficulty("Hard")}
                                                className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                                                    localDifficulty === "Hard"
                                                        ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                                                        : "bg-slate-100 dark:bg-[#343434] text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-[#404040]"
                                                }`}
                                            >
                                                Hard
                                            </button>
                                        </div>
                                    </div>

                                    {/* Topics Filter */}
                                    <div className="space-y-3">
                                        <div className="flex items-center gap-2">
                                            <span className="material-symbols-outlined text-slate-500 dark:text-slate-400 text-xl">label</span>
                                            <h4 className="font-medium text-slate-900 dark:text-white">Topics</h4>
                                        </div>
                                        <div className="flex flex-wrap gap-2 max-h-64 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                                            {topTopics.map(([topic, count]) => {
                                                const isSelected = localTopics.includes(topic);
                                                return (
                                                    <button
                                                        key={topic}
                                                        onClick={() => toggleLocalTopic(topic)}
                                                        className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                                                            isSelected
                                                                ? "bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900"
                                                                : "bg-slate-100 dark:bg-[#343434] text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-[#404040]"
                                                        }`}
                                                    >
                                                        {topic}
                                                        <span className="ml-2 text-xs opacity-70">({count})</span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>

                                {/* Footer */}
                                <div className="flex items-center justify-between px-6 py-5">
                                    <button
                                        onClick={() => {
                                            setLocalDifficulty(null);
                                            setLocalTopics([]);
                                            setLocalStatus("All");
                                        }}
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
                                                if (onDifficultyChange) onDifficultyChange(localDifficulty);
                                                if (onTopicsChange) onTopicsChange(localTopics);
                                                if (onStatusChange) onStatusChange(localStatus);
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
                        onClick={() => setShowSortMenu(!showSortMenu)}
                        className={`w-10 h-10 flex-shrink-0 rounded-full flex items-center justify-center transition-colors relative ${
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
                            <div 
                                className="fixed inset-0 z-40"
                                onClick={() => setShowSortMenu(false)}
                            />
                            <div className="absolute top-full right-0 mt-2 bg-white dark:bg-[#282828] rounded-xl shadow-lg border border-slate-200 dark:border-slate-700 overflow-hidden z-50 min-w-[200px]">
                                <button 
                                    onClick={() => handleSortChange("default")}
                                    className={`w-full flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors text-left ${
                                        sortBy === "default" ? "bg-blue-50 dark:bg-blue-900/20" : ""
                                    }`}
                                >
                                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Default</span>
                                    {sortBy === "default" && <span className="material-symbols-outlined text-blue-600 dark:text-blue-400 text-[18px]">check</span>}
                                </button>
                                <button 
                                    onClick={() => handleSortChange("difficulty")}
                                    className={`w-full flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors text-left ${
                                        sortBy === "difficulty" ? "bg-blue-50 dark:bg-blue-900/20" : ""
                                    }`}
                                >
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Difficulty</span>
                                        {sortBy === "difficulty" && (
                                            <span className="text-slate-500 dark:text-slate-400">{sortOrder === "desc" ? "↓" : "↑"}</span>
                                        )}
                                    </div>
                                    {sortBy === "difficulty" && <span className="material-symbols-outlined text-blue-600 dark:text-blue-400 text-[18px]">check</span>}
                                </button>
                                <button 
                                    onClick={() => handleSortChange("questionId")}
                                    className={`w-full flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors text-left ${
                                        sortBy === "questionId" ? "bg-blue-50 dark:bg-blue-900/20" : ""
                                    }`}
                                >
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Question ID</span>
                                        {sortBy === "questionId" && (
                                            <span className="text-slate-500 dark:text-slate-400">{sortOrder === "desc" ? "↓" : "↑"}</span>
                                        )}
                                    </div>
                                    {sortBy === "questionId" && <span className="material-symbols-outlined text-blue-600 dark:text-blue-400 text-[18px]">check</span>}
                                </button>
                            </div>
                        </>
                    )}
                </div>

                <div className="hidden md:flex flex-1 justify-end">
                    {/* Solved Count with Progress Circle */}
                    <div className="flex items-center gap-2 mr-4">
                        <div className="relative w-6 h-6">
                            <svg className="w-6 h-6 transform -rotate-90" viewBox="0 0 36 36">
                                {/* Background circle */}
                                <circle
                                    cx="18"
                                    cy="18"
                                    r="16"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="3"
                                    className="text-slate-200 dark:text-slate-700"
                                />
                                {/* Progress circle */}
                                <circle
                                    cx="18"
                                    cy="18"
                                    r="16"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="3"
                                    strokeDasharray={`${((solvedCount / (totalCount || 1)) * 100.48).toFixed(2)} 100.48`}
                                    className="text-emerald-500"
                                    strokeLinecap="round"
                                />
                            </svg>
                        </div>
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                            {solvedCount}/{totalCount} Solved
                        </span>
                    </div>
                </div>

                <button
                    onClick={onToggleSelectionMode}
                    className={`hidden md:inline-flex items-center justify-center min-w-[80px] h-10 px-4 rounded-full font-medium text-sm transition-colors ${
                        isSelectionMode
                            ? "bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50"
                            : "bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-blue-900/50"
                    }`}
                >
                    {isSelectionMode ? "Cancel" : "Select"}
                </button>
            </div>

            {/* Row 2 (mobile only): solved count + select button */}
            <div className="flex md:hidden items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <div className="relative w-6 h-6">
                        <svg className="w-6 h-6 transform -rotate-90" viewBox="0 0 36 36">
                            <circle
                                cx="18"
                                cy="18"
                                r="16"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="3"
                                className="text-slate-200 dark:text-slate-700"
                            />
                            <circle
                                cx="18"
                                cy="18"
                                r="16"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="3"
                                strokeDasharray={`${((solvedCount / (totalCount || 1)) * 100.48).toFixed(2)} 100.48`}
                                className="text-emerald-500"
                                strokeLinecap="round"
                            />
                        </svg>
                    </div>
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                        {solvedCount}/{totalCount} Solved
                    </span>
                </div>
                <button
                    onClick={onToggleSelectionMode}
                    className={`flex items-center justify-center min-w-[80px] h-10 px-4 rounded-full font-medium text-sm transition-colors ${
                        isSelectionMode
                            ? "bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50"
                            : "bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-blue-900/50"
                    }`}
                >
                    {isSelectionMode ? "Cancel" : "Select"}
                </button>
            </div>
            </div>

            {/* Topic Chips - Collapsible */}
            {topTopics.length > 0 && (
                <div className="space-y-3">
                    <div className={`flex flex-wrap gap-2 ${!showAllTopics ? 'max-h-[40px] overflow-hidden' : ''}`}>
                        {topTopics.map(([topic, count]) => {
                            const isSelected = selectedTopics.includes(topic);
                            return (
                                <button
                                    key={topic}
                                    onClick={() => toggleTopic(topic)}
                                    className={`
                                        px-3.5 py-1.5 rounded-full text-sm font-medium transition-colors
                                        ${
                                            isSelected
                                                ? "bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900"
                                                : "bg-slate-100 dark:bg-[#343434] text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-[#404040]"
                                        }
                                    `}
                                >
                                    {topic}
                                    <span className={`ml-1.5 inline-flex min-w-5 h-5 items-center justify-center rounded-full px-1 text-[11px] ${
                                        isSelected
                                            ? "bg-white/30 text-white dark:bg-slate-900/20 dark:text-slate-900"
                                            : "bg-slate-200 text-slate-600 dark:bg-[#4a4a4a] dark:text-slate-300"
                                    }`}>
                                        {count}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                    
                    {topTopics.length > 8 && (
                        <button
                            onClick={() => setShowAllTopics(!showAllTopics)}
                            className="flex items-center gap-1 text-sm font-medium text-slate-900 dark:text-slate-300 hover:text-slate-700 dark:hover:text-slate-100 transition-colors"
                        >
                            <span>{showAllTopics ? 'Show Less' : 'Show More'}</span>
                            <span className="material-symbols-outlined text-[18px]">
                                {showAllTopics ? 'expand_less' : 'expand_more'}
                            </span>
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
