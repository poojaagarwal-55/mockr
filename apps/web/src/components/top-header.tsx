"use client";

import Link from "next/link";
import Image from "next/image";
import { useTheme } from "next-themes";
import { useState, useEffect, useMemo, useRef } from "react";
import { useSidebar } from "@/context/sidebar-context";
import { useRouter } from "next/navigation";
import { ProfileDropdown } from "./profile-dropdown";
import { NotificationBell } from "./notification-bell";
import { StreakIndicator } from "./streak-indicator";
import { HydrationErrorBoundary } from "./hydration-error-boundary";
import { api, apiFetch } from "@/lib/api";
import { createSupabaseBrowserClient } from "@/lib/supabase";

type UniversalSearchResult = {
    id: string;
    type: string;
    group: string;
    title: string;
    subtitle?: string;
    url: string;
    score: number;
};

export function TopHeader() {
    const { isCollapsed, toggleCollapsed } = useSidebar();
    const { resolvedTheme } = useTheme();
    const router = useRouter();
    const [searchQuery, setSearchQuery] = useState("");
    const [isSearchFocused, setIsSearchFocused] = useState(false);
    const searchWrapperRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const [mounted, setMounted] = useState(false);
    const [streak, setStreak] = useState(0);
    const [searchResults, setSearchResults] = useState<UniversalSearchResult[]>([]);
    const [searchStatus, setSearchStatus] = useState<"idle" | "loading" | "error">("idle");
    const [searchError, setSearchError] = useState<string | null>(null);
    const [activeIndex, setActiveIndex] = useState(0);
    const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
    const mobileSearchInputRef = useRef<HTMLInputElement>(null);
    const searchAbortRef = useRef<AbortController | null>(null);
    const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        setMounted(true);
        const handleClickOutside = (e: MouseEvent) => {
            if (searchWrapperRef.current && !searchWrapperRef.current.contains(e.target as Node)) {
                setIsSearchFocused(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    useEffect(() => {
        const handleShortcut = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
                e.preventDefault();
                setIsSearchFocused(true);
                searchInputRef.current?.focus();
            }
        };
        document.addEventListener("keydown", handleShortcut);
        return () => document.removeEventListener("keydown", handleShortcut);
    }, []);

    // Fetch streak data
    useEffect(() => {
        const fetchStreak = async () => {
            try {
                const { data } = await createSupabaseBrowserClient().auth.getSession();
                const token = data.session?.access_token;
                if (!token) return;

                const response = await api.get<{ success: boolean; data: { currentStreak: number } }>("/streaks", token);
            if (response.success && response.data) {
                setStreak(response.data.currentStreak);
            }
        } catch (error) {
                // Optional header badge: keep the dashboard usable if streak data is unavailable.
                setStreak(0);
            }
        };

        fetchStreak();
    }, []);

    const isDark = mounted && resolvedTheme === "dark";
    const bigLogo = "/logo_big.png"; // Always use light mode logo

    // Global Search Options
    const SEARCH_ROUTES = [
        { title: "Dashboard Home", path: "/dashboard", keywords: ["dashboard", "home", "overview"] },
        { title: "AI Tutor", path: "/ai-tutor", keywords: ["tutor", "ai", "coach", "guidance", "chat"] },
        { title: "Question Bank", path: "/questions", keywords: ["question", "questions", "bank", "practice", "problem"] },
        { title: "DSA Questions", path: "/questions/dsa", keywords: ["dsa", "algorithms", "coding", "leetcode"] },
        { title: "SQL Questions", path: "/questions/sql", keywords: ["sql", "database", "query"] },
        { title: "System Design Questions", path: "/questions/system-design", keywords: ["system", "design", "architecture", "scalable"] },
        { title: "CS Fundamentals", path: "/questions/cs-fundamentals", keywords: ["cs", "fundamentals", "os", "dbms", "cn", "oops", "networks"] },
        { title: "Reports & Analytics", path: "/reports", keywords: ["report", "reports", "analytics", "scores", "feedback"] },
        { title: "Question Sheets", path: "/sheets", keywords: ["sheet", "sheets", "plan", "practice"] },
        { title: "Resumes & ATS", path: "/resumes", keywords: ["resume", "resumes", "cv", "ats", "analysis"] },
        { title: "Resume Analysis", path: "/resumes/analyze", keywords: ["resume", "analyze", "ats", "scan"] },
        { title: "New Interview Setup", path: "/interviews/ai", keywords: ["interview", "setup", "new", "practice", "mock"] },
        { title: "Quick Setup", path: "/setup", keywords: ["setup", "quick", "start"] },
        { title: "Blog", path: "/blog", keywords: ["blog", "article", "guide"] },
        { title: "General Settings", path: "/settings", keywords: ["settings", "account", "preferences"] },
        { title: "Billing & Subscription", path: "/settings/billing", keywords: ["billing", "subscription", "plan", "premium", "upgrade"] },
        { title: "Profile Settings", path: "/settings/profile", keywords: ["profile", "user", "avatar"] },
        { title: "Security & Passwords", path: "/settings/security", keywords: ["security", "password", "auth"] }
    ];

    const TYPE_LABELS: Record<string, string> = {
        dsa_question: "DSA",
        sql_question: "SQL",
        system_design_question: "System Design",
        cs_fundamentals_question: "CS",
        report: "Report",
        sheet: "Sheet",
        custom_sheet: "Sheet",
        resume: "Resume",
        page: "Page",
    };

    const staticResults = useMemo<UniversalSearchResult[]>(() => {
        const query = searchQuery.trim().toLowerCase();
        if (!query) return [];
        return SEARCH_ROUTES.filter(route =>
            route.title.toLowerCase().includes(query) ||
            route.keywords.some(k => k.includes(query))
        ).map(route => ({
            id: route.path,
            type: "page",
            group: "Pages",
            title: route.title,
            subtitle: "Navigation",
            url: route.path,
            score: 0.2,
        }));
    }, [searchQuery]);

    const combinedResults = useMemo(() => {
        const unique = new Map<string, UniversalSearchResult>();
        for (const result of searchResults) {
            unique.set(result.url, result);
        }
        for (const result of staticResults) {
            if (!unique.has(result.url)) unique.set(result.url, result);
        }
        return Array.from(unique.values());
    }, [searchResults, staticResults]);

    useEffect(() => {
        setActiveIndex(0);
    }, [combinedResults.length, searchQuery]);

    const runSearch = async (query: string) => {
        // Abort previous search to avoid race conditions
        if (searchAbortRef.current) {
            searchAbortRef.current.abort();
        }
        const controller = new AbortController();
        searchAbortRef.current = controller;

        setSearchStatus("loading");
        setSearchError(null);

        try {
            const { data } = await createSupabaseBrowserClient().auth.getSession();
            const token = data.session?.access_token;
            if (!token) {
                setSearchStatus("error");
                setSearchError("Sign in to search.");
                return;
            }

            const params = new URLSearchParams({
                q: query,
                limit: "12",
                mode: "hybrid",
            });

            const response = await apiFetch<{
                success: boolean;
                data: { results: UniversalSearchResult[] };
            }>(`/search/universal?${params.toString()}`, {
                token,
                signal: controller.signal,
            });

            if (response.success) {
                setSearchResults(response.data.results || []);
                setSearchStatus("idle");
            }
        } catch (error: any) {
            if (controller.signal.aborted || error?.name === "AbortError") return;
            setSearchStatus("error");
            setSearchError(error?.message || "Search failed. Try again.");
        }
    };

    useEffect(() => {
        const trimmed = searchQuery.trim();
        if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);

        if (!trimmed || trimmed.length < 2) {
            setSearchResults([]);
            setSearchStatus("idle");
            setSearchError(null);
            return;
        }

        setSearchResults([]);
        setSearchStatus("loading");
        setSearchError(null);

        searchDebounceRef.current = setTimeout(() => {
            runSearch(trimmed);
        }, 200);

        return () => {
            if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
        };
    }, [searchQuery]);

    const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setActiveIndex((prev) => Math.min(prev + 1, Math.max(combinedResults.length - 1, 0)));
            return;
        }
        if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIndex((prev) => Math.max(prev - 1, 0));
            return;
        }
        if (e.key === "Escape") {
            e.preventDefault();
            setIsSearchFocused(false);
            searchInputRef.current?.blur();
            return;
        }
        if (e.key === "Enter") {
            e.preventDefault();
            const target = combinedResults[activeIndex] || combinedResults[0];
            if (target) {
                navigateToSearch(target.url);
            }
        }
    };

    const navigateToSearch = (path: string) => {
        router.push(path);
        setSearchQuery("");
        setIsSearchFocused(false);
    };

    return (
        <header className="h-16 shrink-0 flex items-center justify-between px-4 bg-white dark:bg-lc-surface sticky top-0 z-[60] border-b border-slate-200 dark:border-lc-border print:hidden">
            {/* Left side: Logo & Toggle */}
            <div className="flex items-center gap-4 w-[200px] shrink-0">
                {/* Menu Toggle is ALWAYS shown */}
                <button
                    onClick={toggleCollapsed}
                    className="hidden md:block p-1.5 rounded-full text-slate-500 hover:text-slate-900 dark:text-[#8a8a8a] dark:hover:text-[#ccc] hover:bg-slate-100 dark:hover:bg-lc-hover transition-colors shrink-0 cursor-pointer mt-1.5"
                    title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                >
                    <span className="material-symbols-outlined text-[24px]">menu</span>
                </button>

                {/* Persistent Big Logo */}
                <Link href="/dashboard" className="flex items-center shrink-0 ml-2">
                    <Image
                        src={bigLogo}
                        alt="Mockr Logo"
                        width={220}
                        height={60}
                        className="h-10 w-auto object-contain"
                    />
                </Link>
            </div>

            {/* Center: Search */}
            <div className="flex-1 max-w-sm px-4 hidden md:block">
                <div className="relative w-full" ref={searchWrapperRef}>
                    <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xl">
                        search
                    </span>
                    <input
                        type="text"
                        ref={searchInputRef}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onFocus={() => setIsSearchFocused(true)}
                        placeholder="Search everything (Cmd+K)"
                        onKeyDown={handleSearchKeyDown}
                        className="w-full pl-10 pr-4 py-2 rounded-full border-none bg-slate-100 dark:bg-white/10 dark:text-white text-sm outline-none focus:ring-2 focus:ring-primary/50 transition-colors dark:placeholder:text-slate-400"
                    />

                    {/* Search Suggestions Dropdown */}
                    {isSearchFocused && searchQuery && (
                        <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-lc-surface rounded-xl shadow-lg border border-slate-100 dark:border-lc-border overflow-hidden z-[70] py-2">
                            {searchStatus === "loading" && (
                                <div className="px-4 py-3 text-sm text-slate-500 dark:text-[#8a8a8a]">
                                    Searching everything...
                                </div>
                            )}

                            {searchStatus === "error" && (
                                <div className="px-4 py-3 text-sm text-rose-600 dark:text-rose-400">
                                    {searchError || "Search failed."}
                                </div>
                            )}

                            {searchQuery.trim().length < 2 && searchStatus !== "loading" && (
                                <div className="px-4 py-3 text-sm text-slate-500 dark:text-[#8a8a8a]">
                                    Type at least 2 characters to search reports, questions, and sheets.
                                </div>
                            )}

                            {combinedResults.length > 0 && (
                                <div className="flex flex-col">
                                    {combinedResults.map((result, idx) => (
                                        <button
                                            key={`${result.type}-${result.id}`}
                                            onClick={() => navigateToSearch(result.url)}
                                            className={`w-full flex items-center gap-3 px-4 py-3 transition-colors text-left cursor-pointer ${
                                                idx === activeIndex
                                                    ? "bg-slate-50 dark:bg-lc-hover"
                                                    : "hover:bg-slate-50 dark:hover:bg-lc-hover"
                                            }`}
                                        >
                                            <span className="material-symbols-outlined text-slate-400">search</span>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-sm font-medium text-slate-700 dark:text-[#ccc] truncate">
                                                        {result.title}
                                                    </span>
                                                    <span className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500 border border-slate-200 dark:border-lc-border px-1.5 py-0.5 rounded-full">
                                                        {TYPE_LABELS[result.type] || result.group}
                                                    </span>
                                                </div>
                                                {result.subtitle && (
                                                    <span className="block text-xs text-slate-500 dark:text-[#8a8a8a] truncate">
                                                        {result.subtitle}
                                                    </span>
                                                )}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            )}

                            {combinedResults.length === 0 && searchQuery.trim().length >= 2 && searchStatus !== "loading" && searchStatus !== "error" && (
                                <div className="px-4 py-4 text-center text-sm text-slate-500 dark:text-[#8a8a8a]">
                                    No matches found for "{searchQuery}".
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Right side: Actions */}
            <div className="flex items-center shrink-0 gap-1 md:gap-0">
                {/* Mobile search icon */}
                <button
                    onClick={() => {
                        setMobileSearchOpen(true);
                        setTimeout(() => mobileSearchInputRef.current?.focus(), 50);
                    }}
                    className="md:hidden flex items-center justify-center p-2 rounded-full text-slate-500 dark:text-[#8a8a8a] hover:bg-slate-100 dark:hover:bg-lc-hover transition-colors"
                >
                    <span className="material-symbols-outlined text-[22px]">search</span>
                </button>

                <div className="hidden md:flex items-center gap-1">
                    <StreakIndicator streak={streak} />
                </div>
                <div className="flex items-center md:gap-4 md:mr-4">
                    <NotificationBell />
                </div>
                <div className="ml-1 md:ml-0">
                    <ProfileDropdown streak={streak} />
                </div>
            </div>

            {/* Mobile full-screen search overlay */}
            {mobileSearchOpen && (
                <div className="md:hidden fixed inset-0 z-[200] bg-white dark:bg-lc-surface flex flex-col">
                    {/* Search bar row */}
                    <div className="flex items-center gap-2 px-3 h-16 border-b border-slate-200 dark:border-lc-border shrink-0">
                        <button
                            onClick={() => {
                                setMobileSearchOpen(false);
                                setSearchQuery("");
                                setIsSearchFocused(false);
                            }}
                            className="p-2 text-slate-500 dark:text-[#8a8a8a]"
                        >
                            <span className="material-symbols-outlined text-[24px]">arrow_back</span>
                        </button>
                        <div className="flex-1 relative">
                            <input
                                ref={mobileSearchInputRef}
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onFocus={() => setIsSearchFocused(true)}
                                onKeyDown={(e) => {
                                    handleSearchKeyDown(e);
                                    if (e.key === "Escape") {
                                        setMobileSearchOpen(false);
                                        setSearchQuery("");
                                    }
                                }}
                                placeholder="Search everything..."
                                className="w-full px-4 py-2 rounded-full bg-slate-100 dark:bg-white/10 dark:text-white text-sm outline-none focus:ring-2 focus:ring-primary/50 dark:placeholder:text-slate-400"
                            />
                        </div>
                    </div>

                    {/* Results */}
                    <div className="flex-1 overflow-y-auto">
                        {searchStatus === "loading" && (
                            <div className="px-4 py-4 text-sm text-slate-500 dark:text-[#8a8a8a]">Searching everything...</div>
                        )}
                        {searchStatus === "error" && (
                            <div className="px-4 py-4 text-sm text-rose-600 dark:text-rose-400">{searchError || "Search failed."}</div>
                        )}
                        {!searchQuery && (
                            <div className="px-4 py-4 text-sm text-slate-400 dark:text-[#8a8a8a]">Type to search reports, questions, sheets and more.</div>
                        )}
                        {searchQuery.trim().length >= 1 && searchQuery.trim().length < 2 && searchStatus !== "loading" && (
                            <div className="px-4 py-4 text-sm text-slate-500 dark:text-[#8a8a8a]">Type at least 2 characters...</div>
                        )}
                        {combinedResults.map((result, idx) => (
                            <button
                                key={`${result.type}-${result.id}`}
                                onClick={() => {
                                    navigateToSearch(result.url);
                                    setMobileSearchOpen(false);
                                }}
                                className={`w-full flex items-center gap-3 px-4 py-3.5 border-b border-slate-100 dark:border-lc-border transition-colors text-left ${
                                    idx === activeIndex ? "bg-slate-50 dark:bg-lc-hover" : ""
                                }`}
                            >
                                <span className="material-symbols-outlined text-slate-400">search</span>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-medium text-slate-700 dark:text-[#ccc] truncate">{result.title}</span>
                                        <span className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500 border border-slate-200 dark:border-lc-border px-1.5 py-0.5 rounded-full shrink-0">
                                            {TYPE_LABELS[result.type] || result.group}
                                        </span>
                                    </div>
                                    {result.subtitle && (
                                        <span className="block text-xs text-slate-500 dark:text-[#8a8a8a] truncate">{result.subtitle}</span>
                                    )}
                                </div>
                                <span className="material-symbols-outlined text-slate-300 text-sm shrink-0">north_west</span>
                            </button>
                        ))}
                        {combinedResults.length === 0 && searchQuery.trim().length >= 2 && searchStatus !== "loading" && searchStatus !== "error" && (
                            <div className="px-4 py-6 text-center text-sm text-slate-500 dark:text-[#8a8a8a]">
                                No matches found for "{searchQuery}".
                            </div>
                        )}
                    </div>
                </div>
            )}
        </header>
    );
}
