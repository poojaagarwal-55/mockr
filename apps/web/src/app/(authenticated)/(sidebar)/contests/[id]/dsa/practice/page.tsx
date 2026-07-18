"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, CheckCircle2, Clock, Users } from "lucide-react";
import { contestServiceFetch } from "@/lib/contest-service-fetch";

type DsaQuestion = {
  id: string;
  title: string;
  difficulty?: string;
  points: number;
  status?: "not_attempted" | "attempted" | "solved";
  attempts?: number;
};

type ContestSummary = {
  title?: string;
  startTime?: string;
  endTime?: string;
  roundFlow?: "dsa_only" | "mcq_only" | "mcq_then_dsa";
};

type RoundsPayload = {
  rounds?: {
    mcq?: {
      warningCount?: number;
    };
    dsa?: {
      scoreAwarded?: number;
      warningCount?: number;
    };
  };
};

function formatDateTime(value?: string) {
  if (!value) return "--";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "--";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function difficultyLabel(value?: string) {
  const normalized = String(value || "").toUpperCase();
  if (normalized === "EASY") return "Easy";
  if (normalized === "HARD") return "Hard";
  return "Medium";
}

function difficultyClass(value?: string) {
  const normalized = String(value || "").toUpperCase();
  if (normalized === "EASY") return "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300";
  if (normalized === "HARD") return "bg-red-50 text-red-700 dark:bg-red-400/10 dark:text-red-300";
  return "bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300";
}

export default function ContestDsaPracticePage() {
  const router = useRouter();
  const params = useParams();
  const contestId = String(params.id || "");
  const [contestTitle, setContestTitle] = useState("DSA Review");
  const [contest, setContest] = useState<ContestSummary | null>(null);
  const [rounds, setRounds] = useState<RoundsPayload | null>(null);
  const [questions, setQuestions] = useState<DsaQuestion[]>([]);
  const [solverCounts, setSolverCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [contestResponse, questionsResponse, roundsResponse, solversResponse] = await Promise.all([
        contestServiceFetch(`/contests/${contestId}`),
        contestServiceFetch(`/contests/${contestId}/questions?phase=dsa`),
        contestServiceFetch(`/contests/${contestId}/rounds`),
        contestServiceFetch(`/contests/${contestId}/question-solvers`),
      ]);

      if (!contestResponse || !questionsResponse) {
        router.push("/login");
        return;
      }

      const contestData = await contestResponse.json().catch(() => ({}));
      const questionsData = await questionsResponse.json().catch(() => ({}));
      const roundsData = roundsResponse ? await roundsResponse.json().catch(() => ({})) : null;
      if (contestResponse.status === 401 || questionsResponse.status === 401) {
        router.push("/login");
        return;
      }
      if (contestResponse.ok) {
        setContestTitle(contestData.contest?.title || "DSA Review");
        setContest(contestData.contest || null);
      }
      if (roundsResponse?.ok) setRounds(roundsData);
      if (!questionsResponse.ok) {
        throw new Error(questionsData.message || "Failed to load coding questions");
      }
      setQuestions(Array.isArray(questionsData.questions) ? questionsData.questions : []);
      if (solversResponse?.ok) {
        const solversData = await solversResponse.json().catch(() => ({}));
        setSolverCounts(solversData?.counts && typeof solversData.counts === "object" ? solversData.counts : {});
      } else {
        setSolverCounts({});
      }
    } catch (err) {
      setQuestions([]);
      setError(err instanceof Error ? err.message : "Failed to load DSA review");
    } finally {
      setLoading(false);
    }
  }, [contestId, router]);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = useMemo(() => {
    const solved = questions.filter((question) => question.status === "solved").length;
    const attempted = questions.filter((question) => question.status === "solved" || question.status === "attempted").length;
    const possible = questions.reduce((sum, question) => sum + Math.max(0, Number(question.points || 0)), 0);
    const solvedScore = questions
      .filter((question) => question.status === "solved")
      .reduce((sum, question) => sum + Math.max(0, Number(question.points || 0)), 0);
    const score = Number(rounds?.rounds?.dsa?.scoreAwarded ?? solvedScore);
    const warnings = Number(rounds?.rounds?.dsa?.warningCount ?? 0) + Number(rounds?.rounds?.mcq?.warningCount ?? 0);
    return { solved, attempted, possible, score, warnings };
  }, [questions, rounds]);
  const backPath = contest?.roundFlow === "dsa_only" ? "/contests" : `/contests/${contestId}`;
  const showSingleRoundToggle = contest?.roundFlow === "dsa_only";

  const openQuestion = (questionId: string) => {
    const search = new URLSearchParams({
      id: questionId,
      contestId,
      from: `/contests/${contestId}/dsa/practice`,
    });
    router.push(`/questions/dsa/solve?${search.toString()}`);
  };

  return (
    <main className="flex h-screen overflow-hidden bg-[#f7f9fc] px-4 py-6 text-slate-950 dark:bg-lc-bg dark:text-white sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col">
        <section className="shrink-0 pt-2">
          <div className="flex flex-col gap-4 pb-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => router.push(backPath)}
              className="grid h-11 w-11 shrink-0 place-items-center text-slate-600 transition hover:text-slate-950 dark:text-slate-300 dark:hover:text-white"
              aria-label={contest?.roundFlow === "dsa_only" ? "Back to contests" : "Back to contest"}
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div>
              <h1 className="font-nunito text-3xl font-black text-slate-950 dark:text-white">{contestTitle}</h1>
              <p className="mt-1 text-sm font-bold text-slate-500 dark:text-slate-400">DSA Coding Review</p>
            </div>
          </div>

            {showSingleRoundToggle && (
              <div className="flex h-12 rounded-[18px] bg-white/80 p-1 shadow-sm ring-1 ring-slate-200 dark:bg-white/5 dark:ring-white/10">
                <button
                  type="button"
                  className="rounded-[14px] bg-primary px-6 text-sm font-extrabold text-white shadow-sm"
                  aria-current="page"
                >
                  View
                </button>
                <button
                  type="button"
                  onClick={() => router.push(`/contests/${contestId}/submitted`)}
                  className="rounded-[14px] px-6 text-sm font-extrabold text-slate-500 transition hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
                >
                  Result
                </button>
              </div>
            )}
          </div>

          <div className="grid gap-6 border-b border-slate-200 py-6 text-left dark:border-white/10 sm:grid-cols-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Start Time</p>
              <p className="mt-1 text-base font-black text-slate-950 dark:text-slate-100">{formatDateTime(contest?.startTime)}</p>
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Ended</p>
              <p className="mt-1 text-base font-black text-slate-950 dark:text-slate-100">{formatDateTime(contest?.endTime)}</p>
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Current Score</p>
              <p className="mt-1 text-base font-black text-slate-950 dark:text-white">{summary.score} / {summary.possible}</p>
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Warnings</p>
              <p className="mt-1 inline-flex items-center gap-2 text-base font-black text-slate-950 dark:text-white">
                <span className="h-2.5 w-2.5 rounded-full bg-red-600 shadow-[0_0_8px_rgba(220,38,38,0.45)]" />
                {summary.warnings}
              </p>
            </div>
          </div>
        </section>

        {loading ? (
          <div className="grid flex-1 place-items-center">
            <Clock className="h-8 w-8 animate-pulse text-primary" />
          </div>
        ) : error ? (
          <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm font-bold text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100">
            {error}
          </div>
        ) : (
          <section className="min-h-0 flex-1 overflow-y-auto pt-6">
            <div className="mb-5 flex flex-wrap items-center gap-8 text-sm font-extrabold text-slate-500 dark:text-slate-400">
              <span>Solved <span className="text-slate-950 dark:text-white">{summary.solved} / {questions.length}</span></span>
              <span>Attempted <span className="text-slate-950 dark:text-white">{summary.attempted} / {questions.length}</span></span>
            </div>
            <div className="space-y-2">
              {questions.map((question, index) => {
                const solved = question.status === "solved";
                const attempted = question.status === "attempted";
                return (
                  <button
                    key={question.id}
                    type="button"
                    onClick={() => openQuestion(question.id)}
                    className={`group grid w-full grid-cols-[2.25rem_minmax(0,1fr)_auto_auto_auto] items-center gap-4 px-2 py-5 text-left transition hover:bg-slate-100 dark:hover:bg-lc-hover sm:px-4 ${
                      solved ? "bg-emerald-50/70 dark:bg-emerald-400/10" : attempted ? "bg-blue-50/60 dark:bg-blue-400/10" : ""
                    }`}
                  >
                    <span className="font-mono text-xs font-black text-slate-300 dark:text-slate-600">{String(index + 1).padStart(2, "0")}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-extrabold">{question.title}</span>
                      <span className="mt-2 flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold ${difficultyClass(question.difficulty)}`}>
                          {difficultyLabel(question.difficulty)}
                        </span>
                        {question.attempts !== undefined && question.attempts > 0 && (
                          <span className="text-xs font-bold text-slate-500 dark:text-slate-400">{question.attempts} attempts</span>
                        )}
                      </span>
                    </span>
                    <span
                      className="flex items-center gap-1.5 text-xs font-bold text-slate-500 dark:text-slate-400"
                      title={`${solverCounts[question.id] ?? 0} participant(s) solved this`}
                    >
                      <Users className="h-4 w-4" />
                      {solverCounts[question.id] ?? 0}
                    </span>
                    <span className="text-right text-xs font-black">
                      {question.points}
                      <span className="block font-bold text-slate-500 dark:text-slate-400">Points</span>
                    </span>
                    <span className="grid h-9 w-9 place-items-center rounded-full border border-slate-300 bg-white text-slate-600 group-hover:border-primary group-hover:text-primary dark:border-white/20 dark:bg-white/5">
                      {solved ? <CheckCircle2 className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
