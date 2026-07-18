"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowUpDown, Filter, Search, X } from "lucide-react";
import {
  getLoginPath,
  normalizeQuestionTypography,
  type PublicQuestionCategory,
  type PublicQuestionPreview,
} from "@/lib/public-question-previews";

const difficultyColors: Record<PublicQuestionPreview["difficulty"], string> = {
  Easy: "text-emerald-500 dark:text-emerald-400",
  Medium: "text-amber-500 dark:text-amber-400",
  Hard: "text-red-500 dark:text-red-400",
};

function countBy(items: PublicQuestionPreview[], getKey: (item: PublicQuestionPreview) => string[]) {
  const counts: Record<string, number> = {};
  items.forEach((item) => {
    getKey(item).forEach((key) => {
      if (!key) return;
      counts[key] = (counts[key] || 0) + 1;
    });
  });
  return counts;
}

export function PublicQuestionBrowser({
  questions,
  category,
  categoryLabel,
  emptySearchHint,
}: {
  questions: PublicQuestionPreview[];
  category: PublicQuestionCategory;
  categoryLabel: string;
  emptySearchHint: string;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [difficulty, setDifficulty] = useState<PublicQuestionPreview["difficulty"] | null>(null);
  const [csSubject, setCsSubject] = useState<"OS" | "CN" | "DBMS" | "OOPS" | null>(null);
  const [showFilter, setShowFilter] = useState(false);
  const [sortBy, setSortBy] = useState<"default" | "title" | "difficulty">("default");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  const difficultyCounts = useMemo(() => countBy(questions, (item) => [item.difficulty]), [questions]);
  const csSubjectCounts = useMemo(() => countBy(questions, (item) => item.tags), [questions]);
  const showCsSubjects = category === "cs-fundamentals";

  const filteredQuestions = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    const difficultyRank = { Easy: 1, Medium: 2, Hard: 3 };

    return questions
      .filter((question) => {
        if (difficulty && question.difficulty !== difficulty) return false;
        if (csSubject && !question.tags.includes(csSubject)) return false;
        if (!normalized) return true;
        return (
          question.title.toLowerCase().includes(normalized) ||
          question.slug.toLowerCase().includes(normalized) ||
          question.tags.some((tag) => tag.toLowerCase().includes(normalized)) ||
          question.summary.toLowerCase().includes(normalized)
        );
      })
      .sort((a, b) => {
        if (sortBy === "title") {
          const result = a.title.localeCompare(b.title);
          return sortOrder === "asc" ? result : -result;
        }
        if (sortBy === "difficulty") {
          const result = difficultyRank[a.difficulty] - difficultyRank[b.difficulty];
          return sortOrder === "asc" ? result : -result;
        }
        return Number(a.frontendId || 0) - Number(b.frontendId || 0);
      });
  }, [csSubject, difficulty, questions, search, sortBy, sortOrder]);

  const resetFilters = () => {
    setSearch("");
    setDifficulty(null);
    setCsSubject(null);
    setSortBy("default");
    setSortOrder("asc");
  };

  const setSort = (next: "default" | "title" | "difficulty") => {
    if (sortBy === next && next !== "default") {
      setSortOrder((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(next);
    setSortOrder("asc");
  };

  const hasActiveFilters = Boolean(search.trim() || difficulty || csSubject || sortBy !== "default");

  return (
    <div className="overflow-hidden rounded-[28px] bg-white shadow-[0_16px_54px_rgba(74,124,255,0.08)] dark:bg-[#242424] dark:shadow-[0_18px_54px_rgba(0,0,0,0.30)]">
      <div className="bg-white p-6 dark:bg-[#242424]">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full md:w-72">
            <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search questions"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-10 w-full rounded-full border border-slate-200 bg-white py-2 pl-10 pr-10 text-sm text-slate-900 outline-none transition focus:ring-2 focus:ring-blue-500 dark:border-[#3a3a3a] dark:bg-[#1f1f1f] dark:text-[#eff1f6] dark:placeholder:text-slate-500"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-white"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <button
            onClick={() => setShowFilter(true)}
            className={`flex h-10 w-10 items-center justify-center rounded-full transition ${
              difficulty
                ? "bg-blue-600 text-white"
                : "bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-[#333333] dark:text-blue-300 dark:hover:bg-[#3b3b3b]"
            }`}
            title="Filter questions"
          >
            <Filter className="h-5 w-5" />
          </button>

          <div className="relative">
            <button
              onClick={() => setSort(sortBy === "title" ? "difficulty" : "title")}
              className={`flex h-10 w-10 items-center justify-center rounded-full transition ${
                sortBy !== "default"
                  ? "bg-blue-600 text-white"
                  : "bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-[#333333] dark:text-blue-300 dark:hover:bg-[#3b3b3b]"
              }`}
              title="Sort questions"
            >
              <ArrowUpDown className="h-5 w-5" />
            </button>
          </div>

          <div className="ml-auto flex items-center gap-3">
            {hasActiveFilters && (
              <button
                onClick={resetFilters}
                className="h-10 rounded-full bg-blue-100 px-4 text-sm font-semibold text-blue-700 transition hover:bg-blue-200 dark:bg-[#333333] dark:text-blue-300 dark:hover:bg-[#3b3b3b]"
              >
                Reset
              </button>
            )}
          </div>
        </div>

        {showCsSubjects && (
          <div className="mt-5 flex flex-wrap gap-2">
            {(["OS", "CN", "DBMS", "OOPS"] as const).map((subject) => {
              const active = csSubject === subject;
              return (
                <button
                  key={subject}
                  onClick={() => setCsSubject(active ? null : subject)}
                  className={`rounded-full px-4 py-2 text-sm font-extrabold transition ${
                    active
                      ? "bg-[#4A7CFF] text-white shadow-[0_10px_24px_rgba(74,124,255,0.28)]"
                      : "bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-[#333333] dark:text-blue-300 dark:hover:bg-[#3b3b3b]"
                  }`}
                >
                  {subject}
                  <span className="ml-2 text-xs opacity-75">({csSubjectCounts[subject] || 0})</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-[#242424]">
        {filteredQuestions.length === 0 ? (
          <div className="flex min-h-[260px] flex-col items-center justify-center gap-3 text-center">
            <span className="material-symbols-outlined text-5xl text-slate-300 dark:text-slate-700">search_off</span>
            <h3 className="text-xl font-semibold text-slate-900 dark:text-white">No matching {categoryLabel.toLowerCase()} found</h3>
            <p className="max-w-xl text-sm text-slate-500 dark:text-slate-400">{emptySearchHint}</p>
          </div>
        ) : (
          filteredQuestions.map((question, index) => (
            <div
              key={`${question.category}-${question.slug}`}
              className={`group flex items-center gap-4 px-4 py-3 transition-colors ${
                index % 2 === 0
                  ? "bg-slate-50 hover:bg-slate-100 dark:bg-[#202020] dark:hover:bg-[#2c2c2c]"
                  : "bg-white hover:bg-slate-50 dark:bg-[#242424] dark:hover:bg-[#2c2c2c]"
              }`}
            >
              <Link
                href={`/interview-questions/${question.category}/${question.slug}`}
                className="flex min-w-0 flex-1 items-center gap-4"
              >
                <div className="flex h-6 w-6 shrink-0 items-center justify-center">
                  <span className="material-symbols-outlined text-[18px] text-slate-300 dark:text-slate-600">
                    radio_button_unchecked
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="shrink-0 text-sm font-medium text-slate-500 dark:text-slate-400">
                      {question.frontendId || index + 1}.
                    </span>
                    <h3 className="truncate font-medium text-slate-900 dark:text-white">{normalizeQuestionTypography(question.title)}</h3>
                  </div>
                </div>
                <div className="min-w-[70px] shrink-0 text-center text-sm font-medium">
                  <span className={difficultyColors[question.difficulty]}>
                    {question.difficulty === "Medium" ? "Med" : question.difficulty}
                  </span>
                </div>
              </Link>
              <button
                onClick={() => router.push(getLoginPath(question.authPath))}
                suppressHydrationWarning
                className="flex shrink-0 items-center justify-center rounded-lg p-1.5 text-slate-400 transition hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-[#333333] dark:hover:text-blue-300"
                title="Add to sheet after login"
                aria-label={`Add ${normalizeQuestionTypography(question.title)} to sheet after login`}
              >
                <span className="material-symbols-outlined text-[20px]">playlist_add</span>
              </button>
            </div>
          ))
        )}
      </div>

      {showFilter && (
        <>
          <button className="fixed inset-0 z-40 bg-black/60" onClick={() => setShowFilter(false)} aria-label="Close filters" />
          <div className="fixed left-1/2 top-1/2 z-50 flex max-h-[82vh] w-[calc(100%-32px)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-3xl bg-[#1a1a1a] shadow-2xl">
            <div className="flex items-center justify-between px-6 py-5">
              <h3 className="text-2xl font-bold text-white">Filter Questions</h3>
              <button onClick={() => setShowFilter(false)} className="text-slate-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 space-y-6 overflow-y-auto p-6">
              <div className="space-y-3">
                <h4 className="font-medium text-white">Difficulty</h4>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setDifficulty(null)}
                    className={`rounded-full px-4 py-2 text-sm font-medium ${difficulty === null ? "bg-blue-600 text-white" : "bg-[#343434] text-slate-300 hover:bg-[#404040]"}`}
                  >
                    All
                  </button>
                  {(["Easy", "Medium", "Hard"] as const).map((item) => (
                    <button
                      key={item}
                      onClick={() => setDifficulty(item)}
                      className={`rounded-full px-4 py-2 text-sm font-medium ${difficulty === item ? "bg-blue-600 text-white" : "bg-[#343434] text-slate-300 hover:bg-[#404040]"}`}
                    >
                      {item}
                      <span className="ml-2 text-xs opacity-70">({difficultyCounts[item] || 0})</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-3">
                <h4 className="font-medium text-white">Sort</h4>
                <div className="flex flex-wrap gap-2">
                  {[
                    ["default", "Default"],
                    ["title", "Title"],
                    ["difficulty", "Difficulty"],
                  ].map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => setSort(key as "default" | "title" | "difficulty")}
                      className={`rounded-full px-4 py-2 text-sm font-medium ${sortBy === key ? "bg-blue-600 text-white" : "bg-[#343434] text-slate-300 hover:bg-[#404040]"}`}
                    >
                      {label}{sortBy === key && key !== "default" ? ` ${sortOrder === "asc" ? "up" : "down"}` : ""}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between px-6 py-5">
              <button onClick={resetFilters} className="rounded-full px-4 py-2 text-sm font-semibold text-slate-400 transition hover:bg-[#343434] hover:text-white">
                Clear All
              </button>
              <button onClick={() => setShowFilter(false)} className="rounded-full bg-blue-600 px-6 py-2 text-sm font-semibold text-white transition hover:bg-blue-700">
                Apply Filters
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
