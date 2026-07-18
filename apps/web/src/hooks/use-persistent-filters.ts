"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export interface QuestionFilters {
  difficulty: "Easy" | "Medium" | "Hard" | null;
  topics: string[];
  status: string;
  search: string;
  sortBy: string;
  sortOrder: string;
}

const DEFAULT_FILTERS: QuestionFilters = {
  difficulty: null,
  topics: [],
  status: "All",
  search: "",
  sortBy: "default",
  sortOrder: "desc",
};

interface UsePersistentFiltersOptions {
  category: string; // e.g., 'dsa', 'sql', 'system-design'
  storageKey?: string;
  syncWithUrl?: boolean;
}

export function usePersistentFilters({
  category,
  storageKey,
  syncWithUrl = true,
}: UsePersistentFiltersOptions) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const finalStorageKey = storageKey || `practers_filters_${category}`;

  // Initialize filters from localStorage and URL params
  const [filters, setFilters] = useState<QuestionFilters>(() => {
    if (typeof window === "undefined") return DEFAULT_FILTERS;

    // Start with defaults
    let initialFilters = { ...DEFAULT_FILTERS };

    // Load from localStorage
    try {
      const stored = localStorage.getItem(finalStorageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        initialFilters = { ...initialFilters, ...parsed };
      }
    } catch (error) {
      console.warn("Failed to parse stored filters:", error);
    }

    // Override with URL params if present
    if (syncWithUrl) {
      const urlDifficulty = searchParams.get("difficulty");
      const urlTopics = searchParams.get("topics");
      const urlStatus = searchParams.get("status");
      const urlSearch = searchParams.get("search");
      const urlSortBy = searchParams.get("sortBy");
      const urlSortOrder = searchParams.get("sortOrder");

      if (urlDifficulty && ["Easy", "Medium", "Hard"].includes(urlDifficulty)) {
        initialFilters.difficulty = urlDifficulty as "Easy" | "Medium" | "Hard";
      }
      if (urlTopics) {
        initialFilters.topics = urlTopics.split(",").filter(Boolean);
      }
      if (urlStatus) {
        initialFilters.status = urlStatus;
      }
      if (urlSearch) {
        initialFilters.search = urlSearch;
      }
      if (urlSortBy) {
        initialFilters.sortBy = urlSortBy;
      }
      if (urlSortOrder) {
        initialFilters.sortOrder = urlSortOrder;
      }
    }

    return initialFilters;
  });

  // Update localStorage when filters change
  useEffect(() => {
    if (typeof window === "undefined") return;
    
    try {
      localStorage.setItem(finalStorageKey, JSON.stringify(filters));
    } catch (error) {
      console.warn("Failed to save filters to localStorage:", error);
    }
  }, [filters, finalStorageKey]);

  // Update URL when filters change (debounced)
  useEffect(() => {
    if (!syncWithUrl || typeof window === "undefined") return;

    const timeoutId = setTimeout(() => {
      const params = new URLSearchParams();
      
      if (filters.difficulty) params.set("difficulty", filters.difficulty);
      if (filters.topics.length > 0) params.set("topics", filters.topics.join(","));
      if (filters.status !== "All") params.set("status", filters.status);
      if (filters.search) params.set("search", filters.search);
      if (filters.sortBy !== "default") params.set("sortBy", filters.sortBy);
      if (filters.sortOrder !== "desc") params.set("sortOrder", filters.sortOrder);

      const newUrl = params.toString() ? `?${params.toString()}` : window.location.pathname;
      
      // Only update if URL actually changed
      if (newUrl !== window.location.search && newUrl !== window.location.pathname + window.location.search) {
        router.replace(newUrl, { scroll: false });
      }
    }, 300); // 300ms debounce

    return () => clearTimeout(timeoutId);
  }, [filters, router, syncWithUrl]);

  // Update individual filter properties
  const updateFilters = useCallback((updates: Partial<QuestionFilters>) => {
    setFilters(prev => ({ ...prev, ...updates }));
  }, []);

  // Reset filters to defaults
  const resetFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
    if (syncWithUrl) {
      router.replace(window.location.pathname, { scroll: false });
    }
  }, [router, syncWithUrl]);

  // Check if filters are active (different from defaults)
  const hasActiveFilters = useCallback(() => {
    return (
      filters.difficulty !== DEFAULT_FILTERS.difficulty ||
      filters.topics.length !== DEFAULT_FILTERS.topics.length ||
      filters.status !== DEFAULT_FILTERS.status ||
      filters.search !== DEFAULT_FILTERS.search ||
      filters.sortBy !== DEFAULT_FILTERS.sortBy ||
      filters.sortOrder !== DEFAULT_FILTERS.sortOrder
    );
  }, [filters]);

  return {
    filters,
    updateFilters,
    resetFilters,
    hasActiveFilters: hasActiveFilters(),
    
    // Convenience methods for individual filter updates
    setDifficulty: useCallback((difficulty: "Easy" | "Medium" | "Hard" | null) => {
      updateFilters({ difficulty });
    }, [updateFilters]),
    
    setTopics: useCallback((topics: string[]) => {
      updateFilters({ topics });
    }, [updateFilters]),
    
    setStatus: useCallback((status: string) => {
      updateFilters({ status });
    }, [updateFilters]),
    
    setSearch: useCallback((search: string) => {
      updateFilters({ search });
    }, [updateFilters]),
    
    setSort: useCallback((sortBy: string, sortOrder: string) => {
      updateFilters({ sortBy, sortOrder });
    }, [updateFilters]),
  };
}