"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, Clock, ShieldCheck, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { useContestRoundIntegrity } from "@/hooks/use-contest-round-integrity";
import { DEFAULT_CONTEST_INSTRUCTIONS } from "@interviewforge/shared";

const CONTEST_API = process.env.NEXT_PUBLIC_CONTEST_API_URL || "http://localhost:3002";
const ROUND_CACHE_TTL_MS = 5 * 60 * 1000;

type DsaQuestion = {
  id: string;
  title: string;
  difficulty?: string;
  points: number;
  negativePoints?: number;
  status?: "not_attempted" | "attempted" | "solved";
  attempts?: number;
  phaseOrder?: number;
};

type RoundsPayload = {
  settings?: {
    roundFlow?: "dsa_only" | "mcq_only" | "mcq_then_dsa";
  };
  participant?: {
    isSubmitted?: boolean;
  };
  rounds: {
    mcq?: {
      warningCount?: number;
    };
    dsa: {
      status: string;
      scoreAwarded?: number;
      warningCount?: number;
      unlocked: boolean;
    };
  };
};

type DsaRoundCache = {
  questions: DsaQuestion[];
  rounds: RoundsPayload | null;
  roundFlow: "dsa_only" | "mcq_only" | "mcq_then_dsa" | null;
  contestInstructions: string | null;
  endTime: string | null;
  savedAt: number;
};

function dsaRoundCacheKey(contestId: string) {
  return `contest-dsa-round-cache:${contestId}`;
}

function readDsaRoundCache(contestId: string): DsaRoundCache | null {
  if (typeof window === "undefined" || !contestId) return null;
  try {
    const raw = window.sessionStorage.getItem(dsaRoundCacheKey(contestId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DsaRoundCache;
    if (!parsed || !Array.isArray(parsed.questions)) return null;
    if (Date.now() - Number(parsed.savedAt || 0) > ROUND_CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeDsaRoundCache(contestId: string, cache: Omit<DsaRoundCache, "savedAt">) {
  if (typeof window === "undefined" || !contestId || cache.questions.length === 0) return;
  try {
    window.sessionStorage.setItem(
      dsaRoundCacheKey(contestId),
      JSON.stringify({ ...cache, savedAt: Date.now() })
    );
  } catch {
    // Session storage is only a warm UI cache; the API remains authoritative.
  }
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

function instructionLines(value?: string | null) {
  return String(value || DEFAULT_CONTEST_INSTRUCTIONS)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export default function ContestDsaRoundPage() {
  const router = useRouter();
  const params = useParams();
  const contestId = String(params.id || "");
  const [questions, setQuestions] = useState<DsaQuestion[]>([]);
  const [solverCounts, setSolverCounts] = useState<Record<string, number>>({});
  const [rounds, setRounds] = useState<RoundsPayload | null>(null);
  const [roundFlow, setRoundFlow] = useState<"dsa_only" | "mcq_only" | "mcq_then_dsa" | null>(null);
  const [contestInstructions, setContestInstructions] = useState<string | null>(null);
  const [endTime, setEndTime] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [autoSubmitted, setAutoSubmitted] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [checkingLeave, setCheckingLeave] = useState(false);
  const [leaveBlockedMessage, setLeaveBlockedMessage] = useState<string | null>(null);
  const submittedHereRef = useRef(false);

  const getToken = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  }, []);

  const dsaRoundStatus = rounds?.rounds?.dsa?.status;
  const dsaRoundSubmitted = dsaRoundStatus === "submitted" || dsaRoundStatus === "auto_submitted";
  const serverDsaWarningCount = Number(rounds?.rounds?.dsa?.warningCount ?? 0);
  const serverTotalWarningCount = serverDsaWarningCount + Number(rounds?.rounds?.mcq?.warningCount ?? 0);
  const {
    warningCount: localWarningCount,
    warningNotice,
    showFullscreenPrompt,
    markIntegrityStarted,
    requestFullscreen,
    syncWarningCount,
  } = useContestRoundIntegrity({
    contestId,
    roundType: "dsa",
    submitted: dsaRoundSubmitted || autoSubmitted,
    getToken,
  });

  const hydrateFromCache = useCallback(() => {
    const cached = readDsaRoundCache(contestId);
    if (!cached) return false;
    setQuestions(cached.questions);
    setRounds(cached.rounds);
    setRoundFlow(cached.roundFlow ?? cached.rounds?.settings?.roundFlow ?? null);
    setContestInstructions(cached.contestInstructions);
    setEndTime(cached.endTime);
    setLoading(false);
    return true;
  }, [contestId]);

  const load = useCallback(async (options?: { silent?: boolean; startRound?: boolean }) => {
    const silent = options?.silent === true;
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const token = await getToken();
      if (!token) {
        router.push("/login");
        return;
      }

      if (options?.startRound !== false) {
        const startResponse = await fetch(`${CONTEST_API}/contests/${contestId}/rounds/dsa/start`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!startResponse.ok) {
          const body = await startResponse.json().catch(() => ({}));
          throw new Error(body.message || "DSA round is locked");
        }
      }

      const url = new URL(`${CONTEST_API}/contests/${contestId}/questions`);
      url.searchParams.set("phase", "dsa");
      const [contestResponse, response, roundsResponse, solversResponse] = await Promise.all([
        fetch(`${CONTEST_API}/contests/${contestId}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        }),
        fetch(url.toString(), {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        }),
        fetch(`${CONTEST_API}/contests/${contestId}/rounds`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        }),
        fetch(`${CONTEST_API}/contests/${contestId}/question-solvers`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        }),
      ]);
      const contestData = await contestResponse.json().catch(() => ({}));
      const data = await response.json().catch(() => ({}));
      const roundsData = await roundsResponse.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Failed to load coding questions");
      const nextQuestions = Array.isArray(data.questions) ? data.questions : [];
      if (nextQuestions.length === 0) throw new Error("Coding questions are still loading. Please wait a moment.");
      const nextEndTime = contestData.contest?.endTime || null;
      const nextInstructions = contestData.contest?.instructions || null;
      const nextRounds = roundsResponse.ok ? roundsData : null;
      const nextRoundFlow = (
        roundsResponse.ok
          ? roundsData?.settings?.roundFlow
          : contestData.contest?.roundFlow
      ) || contestData.contest?.roundFlow || null;
      setEndTime(nextEndTime);
      setContestInstructions(nextInstructions);
      setRoundFlow(nextRoundFlow);
      setQuestions(nextQuestions);
      if (roundsResponse.ok) setRounds(roundsData);
      if (solversResponse.ok) {
        const solversData = await solversResponse.json().catch(() => ({}));
        setSolverCounts(solversData?.counts && typeof solversData.counts === "object" ? solversData.counts : {});
      }
      setError(null);
      writeDsaRoundCache(contestId, {
        questions: nextQuestions,
        rounds: nextRounds,
        roundFlow: nextRoundFlow,
        contestInstructions: nextInstructions,
        endTime: nextEndTime,
      });
    } catch (err) {
      if (!silent) {
        setError(err instanceof Error ? err.message : "Failed to load coding round");
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [contestId, getToken, router]);

  useEffect(() => {
    const hadCache = hydrateFromCache();
    void load({ silent: hadCache });
  }, [hydrateFromCache, load]);

  useEffect(() => {
    // Jitter per-mount so the cohort doesn't re-poll on the same second.
    const period = 15_000 + Math.floor(Math.random() * 7000);
    const timer = window.setInterval(() => {
      void load({ silent: true, startRound: false });
    }, period);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Hide the app sidebar/nav while inside the live coding round.
  useEffect(() => {
    document.body.classList.add("contest-active-hide-nav");
    return () => document.body.classList.remove("contest-active-hide-nav");
  }, []);

  useEffect(() => {
    syncWarningCount(serverDsaWarningCount, serverTotalWarningCount);
  }, [serverDsaWarningCount, serverTotalWarningCount, syncWarningCount]);

  const isDsaOnlyContest = roundFlow === "dsa_only" || rounds?.settings?.roundFlow === "dsa_only";
  const contestSubmitted = rounds?.participant?.isSubmitted === true;

  // Back-navigation guard: once the whole contest is submitted, no round page may be re-entered.
  useEffect(() => {
    if (!contestId) return;
    let flagged = false;
    try {
      flagged = window.localStorage.getItem(`contest-submitted-${contestId}`) === "true";
    } catch {
      flagged = false;
    }
    if (flagged || contestSubmitted) {
      try {
        window.localStorage.setItem(`contest-submitted-${contestId}`, "true");
      } catch {
        // Local storage only mirrors the server-side submission state.
      }
      router.replace(`/contests/${contestId}/submitted`);
    }
  }, [contestId, contestSubmitted, router]);

  // Mixed contests: once the coding round itself is submitted, block re-entry to the round list.
  useEffect(() => {
    if (!contestId || isDsaOnlyContest) return;
    if (dsaRoundSubmitted && !submittedHereRef.current) {
      router.replace(`/contests/${contestId}`);
    }
  }, [contestId, isDsaOnlyContest, dsaRoundSubmitted, router]);

  const submitRound = async () => {
    setSubmitting(true);
    setError(null);
    submittedHereRef.current = true;
    try {
      const token = await getToken();
      if (!token) return;
      const response = await fetch(`${CONTEST_API}/contests/${contestId}/rounds/dsa/submit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ submissionType: "manual" }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Failed to submit coding round");
      if (isDsaOnlyContest) {
        const contestSubmitResponse = await fetch(`${CONTEST_API}/contests/${contestId}/submit`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ submissionType: "manual" }),
        });
        const contestSubmitData = await contestSubmitResponse.json().catch(() => ({}));
        if (!contestSubmitResponse.ok) {
          throw new Error(contestSubmitData.message || "Failed to submit contest");
        }
        try {
          window.localStorage.setItem(`contest-submitted-${contestId}`, "true");
        } catch {
          // Local storage only mirrors the server-side submission state.
        }
        router.replace(`/contests/${contestId}/submitted`);
        return;
      }
      router.push(`/contests/${contestId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit coding round");
    } finally {
      setSubmitting(false);
    }
  };

  const handleBackToContest = useCallback(async () => {
    setCheckingLeave(true);
    setLeaveBlockedMessage(null);
    try {
      const token = await getToken();
      if (!token) {
        router.push("/login");
        return;
      }
      const response = await fetch(`${CONTEST_API}/contests/${contestId}/rounds/dsa/leave-status`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data?.canLeave === false) {
        setLeaveBlockedMessage(data.message || "Submit the current coding question before leaving this round.");
        return;
      }
      router.push(isDsaOnlyContest ? "/contests" : `/contests/${contestId}`);
    } catch {
      setLeaveBlockedMessage("We could not verify your round state. Please stay on this page and try again.");
    } finally {
      setCheckingLeave(false);
    }
  }, [contestId, getToken, isDsaOnlyContest, router]);

  useEffect(() => {
    if (!endTime || submitting || autoSubmitted) return;
    const end = new Date(endTime).getTime();
    if (!Number.isFinite(end) || nowTick < end) return;

    setAutoSubmitted(true);
    void (async () => {
      const token = await getToken();
      if (!token) return;
      await fetch(`${CONTEST_API}/contests/${contestId}/rounds/dsa/submit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ submissionType: "auto_time" }),
      });
      await fetch(`${CONTEST_API}/contests/${contestId}/submit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ submissionType: "auto_time" }),
      });
      router.replace(`/contests/${contestId}/submitted`);
    })();
  }, [autoSubmitted, contestId, endTime, getToken, nowTick, router, submitting]);

  const timeRemaining = endTime ? Math.max(0, new Date(endTime).getTime() - nowTick) : null;
  const timeLabel = timeRemaining === null
    ? "--:--:--"
    : new Date(timeRemaining).toISOString().slice(11, 19);
  const dsaRoundScore = Number(rounds?.rounds?.dsa?.scoreAwarded ?? 0);
  const dsaPossibleScore = questions.reduce((sum, question) => sum + Math.max(0, Number(question.points || 0)), 0);
  const dsaSolvedCount = questions.filter((question) => question.status === "solved").length;
  const warningCount = Math.max(localWarningCount, serverTotalWarningCount);
  const contestInstructionLines = instructionLines(contestInstructions);

  return (
    <main className="min-h-screen bg-[#f7f9fc] px-4 py-6 text-slate-950 dark:bg-lc-bg dark:text-white sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-6xl flex-col">
        <div className="flex flex-col gap-4 pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void handleBackToContest()}
              disabled={checkingLeave}
              className="grid h-11 w-11 shrink-0 place-items-center text-slate-600 transition hover:text-slate-950 disabled:cursor-wait disabled:opacity-60 dark:text-slate-300 dark:hover:text-white"
              aria-label="Back to contest"
              title="Back to contest"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <h1 className="font-nunito text-3xl font-black">DSA Coding Test</h1>
          </div>
          <div className="flex flex-wrap items-center gap-3 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowInstructions(true)}
              className="h-11 rounded-xl bg-white/80 px-8 font-extrabold shadow-sm dark:bg-white/5"
            >
              See Instructions
            </Button>
            <Button
              onClick={submitRound}
              disabled={submitting}
              className="h-11 rounded-xl !bg-[#e63d00] px-7 font-extrabold !text-white shadow-lg shadow-[#e63d00]/20 hover:!bg-[#cc3600] disabled:!bg-[#f0b8a5] disabled:!text-white/75"
            >
              {submitting ? "Submitting..." : "Finish Your Coding Attempt"}
            </Button>
          </div>
        </div>

        <div className="grid gap-6 border-b border-slate-200 py-6 text-left dark:border-white/10 sm:grid-cols-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Time Remaining</p>
            <p className="mt-1 font-mono text-base font-black text-red-500">{timeLabel}</p>
          </div>
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">DSA Round Score</p>
            <p className="mt-1 text-base font-black text-slate-950 dark:text-white">
              {dsaPossibleScore > 0 ? `${dsaRoundScore} / ${dsaPossibleScore}` : dsaRoundScore}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Solved</p>
            <p className="mt-1 text-base font-black text-slate-950 dark:text-white">{dsaSolvedCount} / {questions.length}</p>
          </div>
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Warnings</p>
            <p className="mt-1 inline-flex items-center gap-2 text-base font-black text-slate-950 dark:text-white">
              <span className="h-2.5 w-2.5 rounded-full bg-red-600 shadow-[0_0_8px_rgba(220,38,38,0.45)]" />
              {warningCount}
            </p>
          </div>
        </div>

        {error && (
          <div className="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
            {error}
          </div>
        )}

        {loading ? (
          <div className="grid flex-1 place-items-center">
            <Clock className="h-8 w-8 animate-pulse text-primary" />
          </div>
        ) : (
          <section className="min-h-0 flex-1 overflow-y-auto pt-6">
            <div className="space-y-2">
              {questions.map((question, index) => {
                const solved = question.status === "solved";
                const attempted = question.status === "attempted";
                return (
                  <button
                    key={question.id}
                    type="button"
                    onClick={() => {
                      markIntegrityStarted();
                      router.push(`/contests/${contestId}/solve/${question.id}`);
                    }}
                    className={`group grid w-full grid-cols-[2.25rem_minmax(0,1fr)_auto_auto_auto] items-center gap-4 px-2 py-5 text-left transition hover:bg-slate-100 dark:hover:bg-lc-hover sm:px-4 ${solved ? "bg-emerald-50/70 dark:bg-emerald-400/10" : attempted ? "bg-blue-50/60 dark:bg-blue-400/10" : ""}`}
                  >
                    <span className="font-mono text-xs font-black text-slate-300 dark:text-slate-600">{String(index + 1).padStart(2, "0")}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-extrabold">{question.title}</span>
                      <span className="mt-2 flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold ${difficultyClass(question.difficulty)}`}>
                          {difficultyLabel(question.difficulty)}
                        </span>
                        {question.negativePoints !== undefined && question.negativePoints > 0 && (
                          <span className="text-xs font-bold text-red-500 dark:text-red-400">
                            Penalty: -{question.negativePoints} per wrong
                          </span>
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
                      {solved || attempted ? <CheckCircle2 className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        )}
      </div>
      {showInstructions && (
        <div className="fixed inset-0 z-[140] grid place-items-center bg-black/60 p-4">
          <section className="w-full max-w-2xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-lc-border dark:bg-[#262626]">
            <div className="border-b border-slate-200 px-6 py-5 dark:border-lc-border">
              <div className="flex items-start gap-4">
                <ShieldCheck className="mt-1 h-6 w-6 shrink-0 text-slate-950 dark:text-white" />
                <div className="min-w-0">
                  <h2 className="font-nunito text-2xl font-extrabold text-slate-950 dark:text-white">Contest instructions</h2>
                </div>
              </div>
            </div>

            <div className="max-h-[56vh] overflow-y-auto px-6 py-5">
              <div className="grid gap-4">
                {contestInstructionLines.map((line, index) => (
                  <div key={`${index}-${line}`} className="grid grid-cols-[auto_minmax(0,1fr)] gap-3">
                    <span className="pt-0.5 text-sm font-extrabold text-slate-950 dark:text-white">{index + 1}</span>
                    <p className="text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">{line}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end border-t border-slate-200 px-6 py-4 dark:border-lc-border">
              <Button onClick={() => setShowInstructions(false)} className="rounded-full px-6 font-extrabold">
                Done
              </Button>
            </div>
          </section>
        </div>
      )}
      {warningNotice && (
        <div className="fixed right-5 top-5 z-[170] max-w-sm rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-extrabold text-rose-700 shadow-xl dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100">
          {warningNotice}
        </div>
      )}
      {showFullscreenPrompt && !dsaRoundSubmitted && !autoSubmitted && (
        <div className="fixed inset-0 z-[165] grid place-items-center bg-slate-950/45 p-4 dark:bg-black/65">
          <section className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 text-slate-950 shadow-2xl dark:border-lc-border dark:bg-lc-surface dark:text-white">
            <div className="flex items-start gap-4">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-blue-50 text-primary dark:bg-primary/10">
                <ShieldCheck className="h-6 w-6" />
              </span>
              <div className="min-w-0">
                <h2 className="font-nunito text-xl font-extrabold">Return to fullscreen</h2>
                <p className="mt-2 text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">
                  Coding round proctoring is active. Stay in fullscreen and keep this tab focused until you submit the round.
                </p>
              </div>
            </div>
            <div className="mt-6 flex justify-end">
              <Button type="button" onClick={() => void requestFullscreen()} className="rounded-full px-6 font-extrabold">
                Enter fullscreen
              </Button>
            </div>
          </section>
        </div>
      )}
      {leaveBlockedMessage && (
        <div className="fixed inset-0 z-[160] grid place-items-center bg-slate-950/45 p-4 dark:bg-black/65">
          <section className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 text-slate-950 shadow-2xl dark:border-lc-border dark:bg-lc-surface dark:text-white">
            <div className="flex items-start gap-4">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-amber-50 text-amber-600 dark:bg-amber-400/10 dark:text-amber-300">
                <AlertTriangle className="h-6 w-6" />
              </span>
              <div className="min-w-0">
                <h2 className="font-nunito text-xl font-extrabold">Finish the current attempt</h2>
                <p className="mt-2 text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">
                  {leaveBlockedMessage}
                </p>
              </div>
            </div>
            <div className="mt-6 flex justify-end">
              <Button type="button" onClick={() => setLeaveBlockedMessage(null)} className="rounded-full px-6 font-extrabold">
                Continue round
              </Button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
