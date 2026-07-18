"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import {
  AlertTriangle,
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Code2,
  Grid2X2,
  Lightbulb,
  Lock,
  X,
} from "lucide-react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { RichQuestionContent } from "@/components/question-content/rich-question-content";
import { createSupabaseBrowserClient } from "@/lib/supabase";

const CONTEST_API = process.env.NEXT_PUBLIC_CONTEST_API_URL || "http://localhost:3002";
const WARNING_LIMIT = 10;
const WARNING_COOLDOWN_MS = 900;

type McqOption = {
  id: string;
  text: string;
  order: number;
};

type McqQuestion = {
  id: string;
  title: string;
  statement: string;
  questionText: string;
  difficulty?: string;
  points: number;
  negativePoints?: number;
  negativeCap?: number;
  order?: number;
  phaseOrder?: number;
  status?: "not_attempted" | "attempted" | "submitted";
  selectedOptionId?: string | null;
  options: McqOption[];
};

type ContestDetails = {
  title?: string;
  description?: string | null;
  instructions?: string | null;
  startTime?: string | null;
  endTime?: string | null;
};

type RoundsPayload = {
  settings?: {
    roundFlow?: "dsa_only" | "mcq_only" | "mcq_then_dsa";
    showScoreOnHub?: boolean;
    mcqSequential?: boolean;
  };
  participant?: {
    isSubmitted?: boolean;
    totalScore?: number | null;
  };
  rounds?: {
    mcq?: {
      status?: string;
      questionCount?: number;
      submittedCount?: number;
      unlocked?: boolean;
      nextAllowedOrder?: number | null;
      warningCount?: number;
    };
    dsa?: {
      status?: string;
      unlocked?: boolean;
      warningCount?: number;
    };
  };
};

type DrawerType = "sections" | "questions" | "guidelines" | null;

function formatClock(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatQuestionTime(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours} Hr : ${String(minutes).padStart(2, "0")} Min : ${String(seconds).padStart(2, "0")} Sec`;
  }
  return `${String(minutes).padStart(2, "0")} Min : ${String(seconds).padStart(2, "0")} Sec`;
}

function formatDateTime(value?: string | null) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Not available";
  return date.toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function integrityReasonLabel(reason: string) {
  switch (reason) {
    case "fullscreen_exit":
      return "Fullscreen was exited";
    case "tab_hidden":
      return "Tab switch was detected";
    case "window_blur":
      return "Window focus was lost";
    case "browser_back":
      return "Browser navigation is blocked during the MCQ round";
    case "copy":
      return "Copy is blocked during the MCQ round";
    case "paste":
      return "Paste is blocked during the MCQ round";
    case "contextmenu":
      return "Context menu is blocked during the MCQ round";
    default:
      return "Contest integrity warning recorded";
  }
}

function getQuestionPhaseOrder(question: Pick<McqQuestion, "phaseOrder" | "order">, fallbackIndex: number) {
  const value = Number(question.phaseOrder ?? question.order ?? fallbackIndex);
  return Number.isFinite(value) ? value : fallbackIndex;
}

function readStoredNumber(key: string) {
  if (!key || typeof window === "undefined") return 0;
  try {
    const value = Number(window.localStorage.getItem(key) || "0");
    return Number.isFinite(value) ? Math.max(0, value) : 0;
  } catch {
    return 0;
  }
}

function writeStoredNumber(key: string, value: number) {
  if (!key || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, String(Math.max(0, value)));
  } catch {
    // Local storage is a convenience cache; server audit remains authoritative.
  }
}

function WatermarkLayer({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      <div className="grid h-[130%] w-[120%] -translate-x-10 -translate-y-14 grid-cols-4 content-around gap-x-20 gap-y-8 opacity-[0.075]">
        {Array.from({ length: 56 }).map((_, index) => (
          <span
            key={index}
            className="select-none whitespace-pre-line text-center text-[13px] font-extrabold leading-5 text-slate-500"
            style={{ transform: "rotate(-18deg)" }}
          >
            {text}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function ContestMcqQuestionPage() {
  const router = useRouter();
  const params = useParams();
  const contestId = String(params.id || "");
  const questionId = String(params.questionId || "");
  const warningStorageKey = contestId ? `contest-mcq-warning-count:${contestId}` : "";
  const totalWarningStorageKey = contestId ? `contest-violations-${contestId}` : "";
  const questionOpenedStorageKey = contestId ? `contest-mcq-question-opened:${contestId}` : "";
  const integrityStartedStorageKey = contestId ? `contest-integrity-started-${contestId}` : "";
  const [question, setQuestion] = useState<McqQuestion | null>(null);
  const [questionList, setQuestionList] = useState<McqQuestion[]>([]);
  const [contestDetails, setContestDetails] = useState<ContestDetails | null>(null);
  const [rounds, setRounds] = useState<RoundsPayload | null>(null);
  const [activeDrawer, setActiveDrawer] = useState<DrawerType>(null);
  const [selectedOptionId, setSelectedOptionId] = useState("");
  const [answerSubmitted, setAnswerSubmitted] = useState(false);
  const [endTime, setEndTime] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [warningCount, setWarningCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFullscreenPrompt, setShowFullscreenPrompt] = useState(true);
  const [warningNotice, setWarningNotice] = useState<string | null>(null);
  const [finishingAttempt, setFinishingAttempt] = useState(false);
  const [showFinishSuccess, setShowFinishSuccess] = useState(false);
  const [watermark, setWatermark] = useState("");
  const lastWarningAtRef = useRef(0);
  const warningCountRef = useRef(0);
  const mcqWarningCountRef = useRef(0);
  const hasEnteredFullscreenRef = useRef(false);
  const integrityAutoSubmitRef = useRef(false);
  const roundFinishedRef = useRef(false);
  const initialSelectedRef = useRef("");
  const navStripRef = useRef<HTMLDivElement | null>(null);
  const [navScrollState, setNavScrollState] = useState({ atStart: true, atEnd: false });

  const getToken = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    const { data } = await supabase.auth.getSession();
    setWatermark(data.session?.user?.email || "");
    return data.session?.access_token || null;
  }, []);

  const recordEvent = useCallback(async (eventType: string, severity: "low" | "medium" | "high" = "medium", payload: Record<string, unknown> = {}) => {
    if (roundFinishedRef.current) return;
    const now = Date.now();
    if (now - lastWarningAtRef.current < WARNING_COOLDOWN_MS) return;
    lastWarningAtRef.current = now;
    const nextMcqCount = mcqWarningCountRef.current + 1;
    const nextTotalCount = Math.max(warningCountRef.current, readStoredNumber(totalWarningStorageKey)) + 1;
    mcqWarningCountRef.current = nextMcqCount;
    warningCountRef.current = nextTotalCount;
    setWarningCount(nextTotalCount);
    writeStoredNumber(warningStorageKey, nextMcqCount);
    writeStoredNumber(totalWarningStorageKey, nextTotalCount);
    setWarningNotice(`${integrityReasonLabel(eventType)}. Warning ${nextTotalCount}/${WARNING_LIMIT}.`);

    try {
      const token = await getToken();
      if (!token) return;
      await fetch(`${CONTEST_API}/contests/${contestId}/integrity-events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          roundType: "mcq",
          eventType,
          severity,
          warningCount: nextMcqCount,
          payload: {
            ...payload,
            totalWarningCount: nextTotalCount,
            warningLimit: WARNING_LIMIT,
          },
          clientEventId: `${questionId}-${eventType}-${now}`,
          clientTimestamp: new Date(now).toISOString(),
        }),
      });
    } catch {
      // Best-effort audit logging; local warning state still applies.
    }

    if (nextTotalCount >= WARNING_LIMIT) {
      if (integrityAutoSubmitRef.current) return;
      integrityAutoSubmitRef.current = true;
      try {
        const token = await getToken();
        if (token) {
          await fetch(`${CONTEST_API}/contests/${contestId}/rounds/mcq/submit`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ submissionType: "auto_cheating" }),
          });
          await fetch(`${CONTEST_API}/contests/${contestId}/submit`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ submissionType: "auto_cheating" }),
          });
        }
      } finally {
        router.replace(`/contests/${contestId}/submitted`);
      }
    }
  }, [contestId, getToken, questionId, router, totalWarningStorageKey, warningStorageKey]);

  const requestMcqFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      }
      hasEnteredFullscreenRef.current = true;
      setShowFullscreenPrompt(false);
      setError(null);
      return true;
    } catch {
      setShowFullscreenPrompt(true);
      setError("Fullscreen is required before continuing the MCQ round.");
      return false;
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) {
        router.push("/login");
        return;
      }

      const [contestResponse, questionResponse, questionsResponse, roundsResponse] = await Promise.all([
        fetch(`${CONTEST_API}/contests/${contestId}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        }),
        fetch(`${CONTEST_API}/contests/${contestId}/mcq/questions/${encodeURIComponent(questionId)}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        }),
        fetch(`${CONTEST_API}/contests/${contestId}/questions?phase=mcq`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        }),
        fetch(`${CONTEST_API}/contests/${contestId}/rounds`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        }),
      ]);
      const [contestData, questionData, questionsData, roundsData] = await Promise.all([
        contestResponse.json().catch(() => ({})),
        questionResponse.json().catch(() => ({})),
        questionsResponse.json().catch(() => ({})),
        roundsResponse.json().catch(() => ({})),
      ]);
      if (!questionResponse.ok) throw new Error(questionData.message || "Failed to load MCQ question");

      const nextRounds = roundsResponse.ok ? roundsData : null;
      const localMcqWarnings = readStoredNumber(warningStorageKey);
      const localTotalWarnings = readStoredNumber(totalWarningStorageKey);
      const serverMcqWarnings = Number(nextRounds?.rounds?.mcq?.warningCount ?? 0);
      const serverDsaWarnings = Number(nextRounds?.rounds?.dsa?.warningCount ?? 0);
      const nextMcqWarningCount = Math.max(localMcqWarnings, Number.isFinite(serverMcqWarnings) ? serverMcqWarnings : 0);
      const nextTotalWarningCount = Math.max(
        localTotalWarnings,
        nextMcqWarningCount + (Number.isFinite(serverDsaWarnings) ? serverDsaWarnings : 0)
      );
      const nextQuestion = questionData.question || null;

      setContestDetails(contestData.contest || null);
      setQuestion(nextQuestion);
      setQuestionList(Array.isArray(questionsData.questions) ? questionsData.questions : []);
      setRounds(nextRounds);
      // Restore any previously chosen option so revisiting a question keeps the
      // selection. In non-sequential contests it stays editable; in sequential
      // contests a submitted answer is shown highlighted but read-only.
      setSelectedOptionId(nextQuestion?.selectedOptionId || "");
      initialSelectedRef.current = nextQuestion?.selectedOptionId || "";
      setAnswerSubmitted(nextQuestion?.status === "submitted");
      setEndTime(contestData.contest?.endTime || null);
      setWarningCount(nextTotalWarningCount);
      warningCountRef.current = nextTotalWarningCount;
      mcqWarningCountRef.current = nextMcqWarningCount;
      writeStoredNumber(warningStorageKey, nextMcqWarningCount);
      writeStoredNumber(totalWarningStorageKey, nextTotalWarningCount);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load MCQ question");
    } finally {
      setLoading(false);
    }
  }, [contestId, getToken, questionId, router, totalWarningStorageKey, warningStorageKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const refreshLiveContestState = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;
      const [contestResponse, roundsResponse] = await Promise.all([
        fetch(`${CONTEST_API}/contests/${contestId}?_ts=${Date.now()}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        }),
        fetch(`${CONTEST_API}/contests/${contestId}/rounds?_ts=${Date.now()}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        }),
      ]);
      const [contestData, roundsData] = await Promise.all([
        contestResponse.json().catch(() => ({})),
        roundsResponse.json().catch(() => ({})),
      ]);

      if (contestResponse.ok && contestData.contest) {
        setContestDetails(contestData.contest);
        setEndTime(contestData.contest.endTime || null);
      }

      if (roundsResponse.ok) {
        setRounds(roundsData);
        const localMcqWarnings = readStoredNumber(warningStorageKey);
        const localTotalWarnings = readStoredNumber(totalWarningStorageKey);
        const serverMcqWarnings = Number(roundsData?.rounds?.mcq?.warningCount ?? 0);
        const serverDsaWarnings = Number(roundsData?.rounds?.dsa?.warningCount ?? 0);
        const nextMcqWarningCount = Math.max(localMcqWarnings, Number.isFinite(serverMcqWarnings) ? serverMcqWarnings : 0);
        const nextTotalWarningCount = Math.max(
          localTotalWarnings,
          nextMcqWarningCount + Math.max(0, Number.isFinite(serverDsaWarnings) ? serverDsaWarnings : 0)
        );
        mcqWarningCountRef.current = nextMcqWarningCount;
        warningCountRef.current = nextTotalWarningCount;
        setWarningCount(nextTotalWarningCount);
        writeStoredNumber(warningStorageKey, nextMcqWarningCount);
        writeStoredNumber(totalWarningStorageKey, nextTotalWarningCount);
      }
    } catch {
      // Silent refresh should never disrupt an active attempt.
    }
  }, [contestId, getToken, totalWarningStorageKey, warningStorageKey]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshLiveContestState();
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [refreshLiveContestState]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!questionOpenedStorageKey) return;
    try {
      window.localStorage.setItem(questionOpenedStorageKey, "true");
      window.localStorage.setItem(integrityStartedStorageKey, "true");
    } catch {
      // Storage can fail in restricted browsers; route guard still runs in memory.
    }
  }, [integrityStartedStorageKey, questionOpenedStorageKey]);

  useEffect(() => {
    if (!contestId || !questionId) return;
    const guardedState = { contestMcqQuestionGuard: true, contestId, questionId };
    window.history.pushState(guardedState, "", window.location.href);
    const onPopState = () => {
      window.history.pushState(guardedState, "", window.location.href);
      void recordEvent("browser_back", "high", { path: window.location.pathname });
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [contestId, questionId, recordEvent]);

  useEffect(() => {
    document.body.classList.add("contest-active-hide-nav");
    setShowFullscreenPrompt(!document.fullscreenElement);

    const onVisibility = () => {
      if (document.hidden) void recordEvent("tab_hidden", "high");
    };
    const onBlur = () => void recordEvent("window_blur", "medium");
    const onFullscreen = () => {
      if (roundFinishedRef.current) return;
      if (document.fullscreenElement) {
        hasEnteredFullscreenRef.current = true;
        setShowFullscreenPrompt(false);
        return;
      }
      setShowFullscreenPrompt(true);
      if (hasEnteredFullscreenRef.current) void recordEvent("fullscreen_exit", "high");
    };
    const onCopy = (event: ClipboardEvent) => {
      event.preventDefault();
      void recordEvent("copy", "medium");
    };
    const onPaste = (event: ClipboardEvent) => {
      event.preventDefault();
      void recordEvent("paste", "high");
    };
    const onContext = (event: MouseEvent) => {
      event.preventDefault();
      void recordEvent("contextmenu", "medium");
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    document.addEventListener("fullscreenchange", onFullscreen);
    document.addEventListener("copy", onCopy, true);
    document.addEventListener("paste", onPaste, true);
    document.addEventListener("contextmenu", onContext, true);

    return () => {
      document.body.classList.remove("contest-active-hide-nav");
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("fullscreenchange", onFullscreen);
      document.removeEventListener("copy", onCopy, true);
      document.removeEventListener("paste", onPaste, true);
      document.removeEventListener("contextmenu", onContext, true);
    };
  }, [recordEvent]);

  useEffect(() => {
    if (!warningNotice) return;
    const timer = window.setTimeout(() => setWarningNotice(null), 4500);
    return () => window.clearTimeout(timer);
  }, [warningNotice]);

  useEffect(() => {
    if (!endTime) return;
    const end = new Date(endTime).getTime();
    if (Number.isFinite(end) && nowTick >= end && !submitting) {
      setSubmitting(true);
      void (async () => {
        // Spread the contest-end auto-submit burst: instead of every client
        // firing the instant the timer hits zero (300 users → 600 requests in
        // ~1s), each waits a random 0-20s so submissions arrive smoothly. The
        // contest is already over, so the short wait has no gameplay impact.
        await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 20000)));
        const token = await getToken();
        if (!token) return;
        await fetch(`${CONTEST_API}/contests/${contestId}/rounds/mcq/submit`, {
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
    }
  }, [contestId, endTime, getToken, nowTick, router, submitting]);

  const markCurrentQuestionSubmitted = (roundComplete = false) => {
    const activeItem = question ?? navQuestions[activeNavIndex];
    const phaseOrder = activeItem ? getQuestionPhaseOrder(activeItem, activeNavIndex) : activeNavIndex;
    const wasAlreadySubmitted = answerSubmitted || question?.status === "submitted" || navQuestions[activeNavIndex]?.status === "submitted";

    setAnswerSubmitted(true);
    setQuestion((previous) => previous ? { ...previous, status: "submitted" } : previous);
    setQuestionList((previous) => previous.map((item) => (
      item.id === questionId ? { ...item, status: "submitted" } : item
    )));
    setRounds((previous) => {
      const previousRounds = previous?.rounds ?? {};
      const previousMcq = previousRounds.mcq ?? {};
      const previousSubmittedCount = Number(previousMcq.submittedCount ?? mcqSubmittedCount);
      const nextSubmittedCount = roundComplete
        ? questionCount
        : wasAlreadySubmitted
          ? previousSubmittedCount
          : Math.min(questionCount, previousSubmittedCount + 1);

      return {
        ...(previous ?? {}),
        rounds: {
          ...previousRounds,
          mcq: {
            ...previousMcq,
            status: roundComplete ? "submitted" : previousMcq.status,
            submittedCount: nextSubmittedCount,
            nextAllowedOrder: isSequential
              ? Math.max(Number(previousMcq.nextAllowedOrder ?? 0), roundComplete ? questionCount : phaseOrder + 1)
              : previousMcq.nextAllowedOrder,
          },
        },
      };
    });
  };

  const submitCurrentAnswer = async () => {
    if (!selectedOptionId) {
      throw new Error("Select an option before submitting.");
    }
    const token = await getToken();
    if (!token) throw new Error("Session expired. Please sign in again.");

    const response = await fetch(`${CONTEST_API}/contests/${contestId}/mcq/questions/${encodeURIComponent(questionId)}/submit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ selectedOptionId }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "Failed to submit answer");
    markCurrentQuestionSubmitted(Boolean(data.roundComplete));
    initialSelectedRef.current = selectedOptionId;
    return data;
  };

  const clearCurrentAnswer = async () => {
    const token = await getToken();
    if (!token) throw new Error("Session expired. Please sign in again.");
    const response = await fetch(`${CONTEST_API}/contests/${contestId}/mcq/questions/${encodeURIComponent(questionId)}/answer`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || "Failed to clear answer");
    }
    setAnswerSubmitted(false);
    setQuestion((previous) => previous ? { ...previous, status: "not_attempted", selectedOptionId: null } : previous);
    setQuestionList((previous) => previous.map((item) => (
      item.id === questionId ? { ...item, status: "not_attempted" } : item
    )));
    initialSelectedRef.current = "";
  };

  // Persist the current question's answer before navigating away. Sequential
  // contests submit once (and lock); non-sequential contests save changes or
  // clear the answer so the candidate can revise freely until they finish.
  const persistCurrentAnswer = async () => {
    if (isSequential) {
      if (!answerSubmitted && selectedOptionId) {
        await submitCurrentAnswer();
      }
      return;
    }
    const initial = initialSelectedRef.current;
    if (selectedOptionId) {
      if (selectedOptionId !== initial) {
        await submitCurrentAnswer();
      }
    } else if (initial) {
      await clearCurrentAnswer();
    }
  };

  const finishAttempt = async () => {
    setFinishingAttempt(true);
    setError(null);
    try {
      await persistCurrentAnswer();

      const token = await getToken();
      if (!token) throw new Error("Session expired. Please sign in again.");
      const response = await fetch(`${CONTEST_API}/contests/${contestId}/rounds/mcq/submit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ submissionType: "manual" }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Failed to finish MCQ attempt");

      if (rounds?.settings?.roundFlow === "mcq_only") {
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
        roundFinishedRef.current = true;
        router.replace(`/contests/${contestId}/submitted`);
        return;
      }

      roundFinishedRef.current = true;
      setAnswerSubmitted(true);
      setQuestionList((previous) => previous.map((item) => ({ ...item, status: "submitted" })));
      setRounds((previous) => ({
        ...(previous ?? {}),
        rounds: {
          ...(previous?.rounds ?? {}),
          mcq: {
            ...(previous?.rounds?.mcq ?? {}),
            status: "submitted",
            submittedCount: questionCount,
            nextAllowedOrder: questionCount,
          },
          dsa: {
            ...(previous?.rounds?.dsa ?? {}),
            unlocked: true,
          },
        },
      }));
      setShowFinishSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to finish MCQ attempt");
    } finally {
      setFinishingAttempt(false);
    }
  };

  const handleFinishSuccessOk = () => {
    roundFinishedRef.current = true;
    setShowFullscreenPrompt(false);
    // Stay in fullscreen through the handoff back to the hub. This popup only
    // shows for mcq_then_dsa (the mcq_only path already returned to /submitted),
    // so the contest is still active and the DSA round remains. Exiting fullscreen
    // here would make the hub re-prompt for fullscreen and re-show the contest
    // instructions popup.
    router.replace(`/contests/${contestId}`);
  };

  const remainingMs = endTime ? new Date(endTime).getTime() - nowTick : 0;
  const timeRemaining = endTime ? formatClock(remainingMs) : "--:--:--";
  const questionTimeRemaining = endTime ? formatQuestionTime(remainingMs) : "-- Min : -- Sec";
  const questionNumber = Math.max(1, Number(question?.phaseOrder ?? question?.order ?? 0) + 1);
  const navQuestions = questionList.length > 0 ? questionList : question ? [question] : [];
  const activeNavIndex = Math.max(0, navQuestions.findIndex((item) => item.id === questionId));
  const isSequential = rounds?.settings?.mcqSequential === true;
  const nextAllowedOrder = rounds?.rounds?.mcq?.nextAllowedOrder ?? null;
  const mcqQuestionCount = rounds?.rounds?.mcq?.questionCount ?? navQuestions.length;
  const mcqSubmittedCount = rounds?.rounds?.mcq?.submittedCount ?? navQuestions.filter((item) => item.status === "submitted").length;
  const questionCount = Math.max(1, mcqQuestionCount || navQuestions.length || 1);
  const attemptedIds = new Set(
    navQuestions
      .filter((item) => item.status === "submitted" || item.status === "attempted")
      .map((item) => item.id)
  );
  if (selectedOptionId) attemptedIds.add(questionId);
  const attemptedCount = Math.min(questionCount, Math.max(mcqSubmittedCount, attemptedIds.size));
  const notAttemptedCount = Math.max(0, questionCount - attemptedCount);
  const attemptedPercent = questionCount > 0 ? Math.round((attemptedCount / questionCount) * 100) : 0;
  const shouldShowDsaSection = rounds?.settings?.roundFlow === "mcq_then_dsa";

  const isNavQuestionLocked = (item: McqQuestion | undefined, index: number) => {
    if (!item) return true;
    if (item.id === questionId) return false;
    // Non-sequential contests allow free navigation, including back to already
    // answered questions (submitted answers stay read-only, never re-editable).
    if (!isSequential) return false;
    const phaseOrder = getQuestionPhaseOrder(item, index);
    if (item.status === "submitted") return true;
    if (nextAllowedOrder !== null && phaseOrder !== nextAllowedOrder) return true;
    return false;
  };

  const goToNavQuestion = async (targetIndex: number) => {
    const target = navQuestions[targetIndex];
    if (!target || target.id === questionId || isNavQuestionLocked(target, targetIndex)) return;
    setSubmitting(true);
    setError(null);
    try {
      await persistCurrentAnswer();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save answer");
      return;
    } finally {
      setSubmitting(false);
    }
    router.push(`/contests/${contestId}/mcq/${target.id}`);
  };

  const updateNavScrollState = useCallback(() => {
    const el = navStripRef.current;
    if (!el) return;
    const atStart = el.scrollLeft <= 1;
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
    setNavScrollState({ atStart, atEnd });
  }, []);

  // Width of a single chip plus the flex gap (gap-1.5 = 6px). Used so the
  // arrows nudge the strip one question at a time instead of jumping a whole page.
  const navChipStep = () => {
    const el = navStripRef.current;
    if (!el || el.children.length === 0) return 88;
    const chipWidth = (el.children[0] as HTMLElement).getBoundingClientRect().width;
    return chipWidth + 6;
  };

  const slideNavStrip = (direction: -1 | 1) => {
    const el = navStripRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * navChipStep(), behavior: "smooth" });
  };

  useEffect(() => {
    const el = navStripRef.current;
    if (!el) return;
    // Slide the active chip just far enough to be fully visible — one step at a
    // time — using rect deltas (offsetLeft is unreliable here because the strip
    // is not a positioned ancestor). Only scrolls the strip, never the page.
    const activeChip = el.children[activeNavIndex] as HTMLElement | undefined;
    if (activeChip) {
      const stripRect = el.getBoundingClientRect();
      const chipRect = activeChip.getBoundingClientRect();
      const overflowRight = chipRect.right - stripRect.right;
      const overflowLeft = chipRect.left - stripRect.left;
      if (overflowRight > 0) {
        el.scrollBy({ left: overflowRight, behavior: "smooth" });
      } else if (overflowLeft < 0) {
        el.scrollBy({ left: overflowLeft, behavior: "smooth" });
      }
    }
    // Refresh arrow enabled state after the layout settles.
    const raf = requestAnimationFrame(updateNavScrollState);
    return () => cancelAnimationFrame(raf);
  }, [activeNavIndex, navQuestions.length, updateNavScrollState]);
  const isLastQuestion = activeNavIndex < 0 || activeNavIndex >= navQuestions.length - 1;
  const primaryAction: "next" | "finish" = isLastQuestion ? "finish" : "next";
  const primaryActionLabel = submitting
    ? "Saving..."
    : finishingAttempt
      ? "Finishing..."
      : primaryAction === "next"
        ? "Next"
        : "Finish Your MCQ Attempt";
  // Sequential contests require an answer before advancing; non-sequential
  // contests allow skipping (and editing) freely.
  const primaryActionDisabled = submitting || finishingAttempt || (isSequential && !answerSubmitted && !selectedOptionId);
  // Submitted answers are only locked in sequential contests; non-sequential
  // contests let candidates clear or change them until they finish the round.
  const answerLocked = answerSubmitted && isSequential;
  const clearSelectionDisabled = !selectedOptionId || answerLocked || submitting || finishingAttempt;
  const handleBackToMcqRound = async () => {
    try {
      await persistCurrentAnswer();
    } catch {
      // Navigation should not be blocked if the best-effort save fails.
    }
    router.push(`/contests/${contestId}/mcq`);
  };
  const clearSelectedOption = () => {
    if (clearSelectionDisabled) return;
    setSelectedOptionId("");
  };
  const goToNextQuestion = () => {
    const target = navQuestions[activeNavIndex + 1];
    if (!target) return;
    router.push(`/contests/${contestId}/mcq/${target.id}`);
  };
  const handlePrimaryAction = async () => {
    if (primaryAction === "finish") {
      await finishAttempt();
      return;
    }
    // "Next" saves / updates / clears the current selection and moves on.
    // Unanswered questions can be skipped without selecting an option.
    setSubmitting(true);
    setError(null);
    try {
      await persistCurrentAnswer();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save answer");
      return;
    } finally {
      setSubmitting(false);
    }
    goToNextQuestion();
  };
  const instructions = (contestDetails?.instructions || "").trim();
  const guidelineText = instructions.length > 0
    ? instructions
    : "Stay in fullscreen until you submit or the timer ends.\nKeep this tab focused. Switching windows, changing tabs, or leaving the page records an integrity warning.\nSubmit every MCQ before moving to the next question in sequential contests.\nCopying question text and pasting from outside the assessment are blocked.";

  if (loading) {
    return (
      <main className="grid h-screen place-items-center bg-white text-slate-600 dark:bg-lc-bg dark:text-slate-300">
        <div className="text-center">
          <Clock className="mx-auto h-8 w-8 animate-pulse text-[#1473e6]" />
          <p className="mt-3 text-sm font-bold">Loading question...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="contest-mcq-ide h-screen overflow-hidden bg-[#f4f6f8] text-[#111827] dark:bg-lc-bg dark:text-white">
      <div className="flex h-[52px] items-center border-b border-[#dde3ea] bg-white px-7 dark:border-[#3e3e3e] dark:bg-[#282828]">
        <div className="flex w-[260px] items-center gap-4">
          <button
            type="button"
            onClick={() => void handleBackToMcqRound()}
            className="grid h-8 w-8 shrink-0 place-items-center text-[#3f526d] transition hover:text-[#111827]"
            title="Back to MCQ round"
            aria-label="Back to MCQ round"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
          <Image src="/logo_big.png" alt="Mockr" width={120} height={34} priority className="h-8 w-auto object-contain" />
        </div>

        <div className="flex min-w-0 flex-1 items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => setActiveDrawer("sections")}
            className="flex h-8 w-32 items-center justify-between rounded-lg border border-[#dfe5ec] bg-white px-3 text-left text-[13px] font-semibold text-[#26364f] shadow-sm transition hover:bg-[#f8fafc]"
          >
            Section
            <ChevronDown className="h-4 w-4 text-[#c4ccd7]" />
          </button>
          <button
            type="button"
            onClick={() => slideNavStrip(-1)}
            disabled={navScrollState.atStart}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-[#dfe5ec] bg-white text-[#3f526d] shadow-sm transition hover:bg-[#f8fafc] disabled:cursor-not-allowed disabled:text-[#cbd5e1]"
            aria-label="Scroll questions left"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div
            ref={navStripRef}
            onScroll={updateNavScrollState}
            className="flex max-w-[360px] items-center gap-1.5 overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {navQuestions.map((item, index) => {
              const active = item.id === questionId;
              const locked = isNavQuestionLocked(item, index);
              const answered = item.status === "submitted" || item.status === "attempted" || (active && selectedOptionId);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => void goToNavQuestion(index)}
                  disabled={locked}
                  className={`relative grid h-8 min-w-8 shrink-0 place-items-center rounded-md px-3 text-[13px] font-extrabold transition ${
                    active
                      ? "bg-[#2f3437] text-white shadow-sm"
                      : locked
                        ? "cursor-not-allowed bg-[#edf0f3] text-[#9aa6b4]"
                        : answered
                          ? "bg-[#0ac86b] text-white hover:bg-[#06b760]"
                          : "bg-[#edf0f3] text-[#26364f] hover:bg-[#dfe5ec]"
                  }`}
                >
                  {index + 1}
                  {locked && (
                    <Lock className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-white p-[1px] text-[#8b98a8] shadow-sm" />
                  )}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => slideNavStrip(1)}
            disabled={navScrollState.atEnd}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-[#dfe5ec] bg-white text-[#3f526d] shadow-sm transition hover:bg-[#f8fafc] disabled:cursor-not-allowed disabled:text-[#cbd5e1]"
            aria-label="Scroll questions right"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setActiveDrawer("questions")}
            className="flex h-8 items-center gap-2 rounded-md border border-[#dfe5ec] bg-white px-2.5 text-[13px] font-semibold text-[#26364f] shadow-sm transition hover:bg-[#f8fafc]"
          >
            {questionCount}
            <Grid2X2 className="h-4 w-4 text-[#4b6280]" />
          </button>
        </div>

        <div className="flex w-[430px] items-center justify-end gap-3">
          <span className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-[13px] font-bold shadow-sm ${
            warningCount > 0
              ? "border-amber-200 bg-amber-50 text-amber-700"
              : "border-[#dfe5ec] bg-white text-[#26364f]"
          }`}>
            <AlertTriangle className="h-4 w-4" />
            {warningCount}
          </span>
          <button
            type="button"
            onClick={() => setActiveDrawer("guidelines")}
            className="flex h-8 items-center gap-2 rounded-md border border-[#dfe5ec] bg-white px-4 text-[13px] font-semibold text-[#26364f] shadow-sm transition hover:bg-[#f8fafc]"
          >
            <Lightbulb className="h-4 w-4 fill-yellow-300 text-yellow-500" />
            Guidelines
          </button>
          <button
            type="button"
            onClick={() => void finishAttempt()}
            disabled={submitting || finishingAttempt}
            className={`flex h-8 items-center rounded-md px-4 text-[13px] font-extrabold shadow-sm transition ${
              submitting || finishingAttempt
                ? "cursor-not-allowed bg-[#f0b8a5] text-white/75"
                : "bg-[#e63d00] text-white hover:bg-[#cc3600]"
            }`}
          >
            {finishingAttempt ? "Finishing..." : "Finish Your MCQ Attempt"}
          </button>
        </div>
      </div>

      <div className="flex h-9 items-center justify-center border-b border-[#d4e9ff] bg-[#e6f4ff] text-[13px] font-bold text-[#0873df]">
        <Clock className="mr-2 h-4 w-4" />
        Question Time Left&nbsp; {questionTimeRemaining}
      </div>

      {error && (
        <div className="absolute right-6 top-[104px] z-40 flex max-w-md items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700 shadow-lg">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {warningNotice && (
        <div className="absolute left-1/2 top-[104px] z-40 flex max-w-md -translate-x-1/2 items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800 shadow-lg">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{warningNotice}</span>
        </div>
      )}

      <div className="relative h-[calc(100vh-157px)] overflow-hidden bg-white dark:bg-lc-bg">
        <WatermarkLayer text={watermark} />
        <Group orientation="horizontal" className="relative z-10 h-full">
          <Panel defaultSize={50} minSize={32} className="min-w-0">
            <div className="h-full overflow-y-auto px-12 py-12">
              <div className="mb-8">
                <div className="flex items-start justify-between gap-6">
                  <p className="text-[18px] font-extrabold leading-none text-black dark:text-white">Question {questionNumber}.</p>
                  <div className="shrink-0 whitespace-nowrap rounded-xl bg-white px-3.5 py-1.5 text-right shadow-[0_8px_24px_rgba(15,23,42,0.08)] ring-1 ring-[#dfe5ec]">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-[#7890ad]">Total Marks:</span>
                      <span className="text-[14px] font-extrabold leading-none text-black dark:text-white">{question?.points ?? 0}</span>
                    </div>
                    {(question?.negativePoints ?? 0) > 0 ? (
                      <p className="mt-0.5 text-[11px] font-bold text-red-500 dark:text-red-400">−{question?.negativePoints} per wrong</p>
                    ) : (
                      <p className="mt-0.5 text-[11px] font-bold text-slate-400 dark:text-slate-500">No negative marks</p>
                    )}
                  </div>
                </div>
                <div className="mt-6 text-[16px] leading-7 text-slate-800 dark:text-slate-100">
                  <RichQuestionContent content={question?.questionText || question?.statement || question?.title || ""} />
                </div>
              </div>
            </div>
          </Panel>

          <Separator className="relative z-20 flex w-1 cursor-col-resize items-center justify-center bg-[#dfe5ec] transition-colors hover:bg-[#2bb8a6] dark:bg-[#3e3e3e]">
            <div className="h-8 w-0.5 rounded-full bg-[#b9c3cf] dark:bg-[#6b7280]" />
          </Separator>

          <Panel defaultSize={50} minSize={32} className="min-w-0">
            <div className="h-full overflow-y-auto px-10 py-9">
              <h2 className="mb-4 text-[18px] font-extrabold leading-none text-black dark:text-white">Answer</h2>
              <div className="space-y-4">
                {(question?.options || []).map((option) => {
                  const selected = selectedOptionId === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      disabled={answerLocked || submitting || finishingAttempt}
                      onClick={() => {
                        if (answerLocked) return;
                        setSelectedOptionId((current) => (current === option.id ? "" : option.id));
                        if (error === "Select an option before submitting.") setError(null);
                      }}
                      className={`flex min-h-[62px] w-full items-start gap-4 rounded-md border bg-white px-4 py-3.5 text-left transition dark:bg-[#282828] ${
                        selected
                          ? "border-[#1573e6] bg-[#f8fbff] shadow-[0_0_0_2px_rgba(21,115,230,0.08)] dark:bg-[#242424]"
                          : answerLocked
                            ? "cursor-not-allowed border-[#e2e5ea] opacity-70 dark:border-[#3e3e3e]"
                            : "border-[#e2e5ea] hover:border-[#b8c4d2] hover:bg-[#fbfcfe] dark:border-[#3e3e3e] dark:hover:border-[#52667f] dark:hover:bg-[#303030]"
                      }`}
                    >
                      <span className={`mt-1 grid h-4 w-4 shrink-0 place-items-center rounded-full border-2 ${selected ? "border-[#1573e6]" : "border-[#343a40] dark:border-slate-300"}`}>
                        {selected && <span className="h-2 w-2 rounded-full bg-[#1573e6]" />}
                      </span>
                      <span className="min-w-0 flex-1 text-[14px] font-semibold leading-6 text-slate-800 dark:text-slate-100 [&_p]:!m-0">
                        <RichQuestionContent content={option.text} compact />
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </Panel>
        </Group>
      </div>

      <div className="flex h-16 items-center justify-end gap-3 border-t border-[#e3e7ed] bg-white px-7 dark:border-[#3e3e3e] dark:bg-[#282828]">
        <button
          type="button"
          onClick={clearSelectedOption}
          disabled={clearSelectionDisabled}
          className={`inline-flex h-10 items-center rounded-lg px-6 text-[14px] font-bold transition ${
            clearSelectionDisabled
              ? "cursor-not-allowed bg-[#eef0f3] text-slate-400 dark:bg-[#333333] dark:text-slate-500"
              : "bg-[#e5e7eb] text-[#344054] shadow-sm hover:bg-[#d9dde3] dark:bg-[#3a3a3a] dark:text-slate-100 dark:hover:bg-[#444444]"
          }`}
        >
          Clear
        </button>
        <button
          type="button"
          onClick={() => void handlePrimaryAction()}
          disabled={primaryActionDisabled}
          className={`inline-flex h-10 items-center gap-2 rounded-lg px-6 text-[14px] font-bold transition ${
            primaryActionDisabled
              ? "cursor-not-allowed bg-[#eef0f3] text-slate-400 dark:bg-[#333333] dark:text-slate-500"
              : primaryAction === "finish"
                ? "bg-[#e63d00] text-white shadow-sm hover:bg-[#cc3600]"
                : "bg-[#1573e6] text-white shadow-sm hover:bg-[#0f66d4]"
          }`}
        >
          {primaryActionLabel}
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {activeDrawer && (
        <div className="fixed inset-0 z-[9000] flex">
          <button
            type="button"
            aria-label="Close panel"
            onClick={() => setActiveDrawer(null)}
            className="absolute inset-0 bg-black/65"
          />
          <div className="relative ml-auto flex h-full w-full max-w-[620px] flex-col bg-white text-[#222] shadow-2xl dark:bg-[#242424] dark:text-white">
            <div className="flex h-[78px] shrink-0 items-center justify-between border-b border-[#e2e5e9] px-6">
              <div>
                <h2 className="text-[20px] font-semibold tracking-tight">
                  {activeDrawer === "sections" ? "Sections" : activeDrawer === "questions" ? "Question Summary" : "Guidelines"}
                </h2>
                {activeDrawer === "questions" && (
                  <p className="mt-1 text-xs font-semibold text-[#6b7280]">{attemptedCount} attempted, {notAttemptedCount} not attempted</p>
                )}
              </div>
              <div className="flex items-center gap-3">
                {activeDrawer === "questions" && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium text-[#333]">Time Left:</span>
                    <span className="rounded-md bg-[#cfe6ff] px-2.5 py-1 font-mono font-bold tracking-[0.12em] text-[#1f3a5f]">
                      {timeRemaining}
                    </span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setActiveDrawer(null)}
                  className="grid h-9 w-9 place-items-center rounded-full text-[#333] transition hover:bg-[#f2f4f7] dark:text-slate-200 dark:hover:bg-white/10"
                  aria-label="Close panel"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
              {activeDrawer === "sections" && (
                <div className="space-y-4">
                  <button
                    type="button"
                    onClick={() => setActiveDrawer(null)}
                    className="flex w-full items-center gap-4 rounded-xl border border-[#d9e4f5] bg-[#f5f9ff] p-4 text-left shadow-sm dark:border-[#315b90] dark:bg-[#172337]"
                  >
                    <span className="grid h-11 w-11 place-items-center rounded-full bg-[#1573e6] text-white">
                      <BookOpen className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-base font-extrabold text-[#111827] dark:text-white">MCQ Test</span>
                      <span className="mt-1 block text-sm font-semibold text-[#64748b] dark:text-slate-400">
                        {mcqSubmittedCount}/{questionCount} submitted
                      </span>
                    </span>
                    <span className="rounded-full bg-[#dff7eb] px-3 py-1 text-xs font-extrabold text-[#0f8a4b] dark:bg-emerald-400/10 dark:text-emerald-300">Active</span>
                  </button>

                  {shouldShowDsaSection && (
                    <div className="flex w-full items-center gap-4 rounded-xl border border-[#e5e7eb] bg-[#f7f7f8] p-4 text-left opacity-80 dark:border-[#3e3e3e] dark:bg-[#1a1a1a]">
                      <span className="grid h-11 w-11 place-items-center rounded-full bg-[#e5e7eb] text-[#6b7280] dark:bg-[#333333] dark:text-slate-300">
                        <Code2 className="h-5 w-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-base font-extrabold text-[#111827] dark:text-white">DSA Coding Test</span>
                        <span className="mt-1 block text-sm font-semibold text-[#64748b] dark:text-slate-400">Unlocks after the MCQ round is submitted</span>
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-xs font-extrabold text-[#64748b] dark:bg-[#333333] dark:text-slate-300">
                        <Lock className="h-3 w-3" />
                        Locked
                      </span>
                    </div>
                  )}
                </div>
              )}

              {activeDrawer === "questions" && (
                <div className="space-y-6">
                  <div className="rounded-lg border border-dashed border-[#f4bc32] bg-[#fff7df] px-4 py-3">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[#8a6100]" />
                      <div>
                        <p className="text-sm font-extrabold text-[#735000]">There is time left.</p>
                        <p className="mt-1 text-sm font-medium text-[#735000]">Review the summary before leaving this panel.</p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg bg-[#f4f4f4] p-3">
                    <div className="flex items-center gap-8 bg-white p-5">
                      <div
                        className="grid h-36 w-36 shrink-0 place-items-center rounded-full"
                        style={{ background: `conic-gradient(#08c468 ${attemptedPercent}%, #eeeeee 0)` }}
                      >
                        <div className="grid h-28 w-28 place-items-center rounded-full bg-white text-center">
                          <div>
                            <p className="text-2xl font-bold text-[#333]">{questionCount}</p>
                            <p className="text-sm leading-5 text-[#4b5563]">Total<br />Questions</p>
                          </div>
                        </div>
                      </div>
                      <div className="space-y-3 text-sm">
                        <p className="flex items-center gap-3 font-medium text-[#333]">
                          <span className="h-4 w-4 rounded-sm bg-[#08c468]" />
                          Section Attempted: {attemptedCount}
                        </p>
                        <p className="flex items-center gap-3 font-medium text-[#333]">
                          <span className="h-4 w-4 rounded-sm bg-[#eeeeee]" />
                          Section Not Attempted: {notAttemptedCount}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h3 className="mb-3 text-xl font-semibold text-[#333]">Section summary</h3>
                    <div className="rounded-lg border border-[#d8dde5] bg-white p-4">
                      <p className="mb-3 text-sm font-semibold text-[#333]">MCQ</p>
                      <div className="flex flex-wrap gap-2">
                        {navQuestions.map((item, index) => {
                          const active = item.id === questionId;
                          const locked = isNavQuestionLocked(item, index);
                          const answered = item.status === "submitted" || item.status === "attempted" || (active && selectedOptionId);
                          return (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => {
                                if (locked) return;
                                setActiveDrawer(null);
                                void goToNavQuestion(index);
                              }}
                              disabled={locked}
                              className={`relative grid h-9 min-w-9 place-items-center rounded px-3 text-sm font-extrabold transition ${
                                active
                                  ? "bg-[#2f3437] text-white"
                                  : locked
                                    ? "cursor-not-allowed bg-[#e8ebef] text-[#8b98a8]"
                                    : answered
                                      ? "bg-[#08c468] text-white hover:bg-[#06b760]"
                                      : "bg-[#f2f4f7] text-[#374151] hover:bg-[#e5e7eb]"
                              }`}
                            >
                              {index + 1}
                              {locked && (
                                <Lock className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-white p-[1px] text-[#8b98a8] shadow-sm" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeDrawer === "guidelines" && (
                <div className="space-y-4">
                  <div className="rounded-xl border border-[#cfd5de] bg-white">
                    <div className="flex items-center justify-between px-5 py-4">
                      <h3 className="text-base font-semibold text-[#333]">Key Instructions</h3>
                      <ChevronDown className="h-4 w-4 rotate-180 text-[#333]" />
                    </div>
                    <div className="px-5 pb-5 text-sm font-medium leading-6 text-[#4a4a4a]">
                      <div className="whitespace-pre-wrap">{guidelineText}</div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-[#cfd5de] bg-white">
                    <div className="flex items-center justify-between px-5 py-4">
                      <h3 className="text-base font-semibold text-[#333]">Timelines & Questions</h3>
                      <ChevronDown className="h-4 w-4 rotate-180 text-[#333]" />
                    </div>
                    <div className="px-5 pb-5 text-sm font-medium leading-6 text-[#4a4a4a]">
                      <ul className="list-disc space-y-2 pl-5">
                        <li>Assessment Window: {formatDateTime(contestDetails?.startTime)} to {formatDateTime(contestDetails?.endTime || endTime)}</li>
                        <li>Total Questions to be answered: {questionCount} MCQs in this section.</li>
                        <li>Once an MCQ is submitted, it is stored and cannot be changed.</li>
                        {isSequential && <li>Sequential MCQ is enabled, so future questions unlock only after the current MCQ is submitted.</li>}
                      </ul>
                    </div>
                  </div>

                  <div className="rounded-xl border border-[#cfd5de] bg-white">
                    <div className="flex items-center justify-between px-5 py-4">
                      <h3 className="text-base font-semibold text-[#333]">Marking</h3>
                      <ChevronDown className="h-4 w-4 rotate-180 text-[#333]" />
                    </div>
                    <div className="px-5 pb-5 text-sm font-medium leading-6 text-[#4a4a4a]">
                      <ul className="list-disc space-y-2 pl-5">
                        <li>Correct answer: +{question?.points ?? 0} marks for this MCQ.</li>
                        <li>Wrong answer: -{question?.negativePoints ?? 0} marks for this MCQ.</li>
                        <li>Correct answers and explanations are shown only after solution release.</li>
                      </ul>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex h-[88px] shrink-0 items-center border-t border-[#e5e7eb] px-6">
              <button
                type="button"
                onClick={() => setActiveDrawer(null)}
                className="rounded-md bg-[#e63d00] px-5 py-2.5 text-sm font-extrabold text-white transition hover:bg-[#cc3600]"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showFinishSuccess && (
        <div className="fixed inset-0 z-[10000] grid place-items-center bg-slate-950/45 p-4 dark:bg-black/65">
          <button
            type="button"
            aria-label="Close popup"
            className="absolute inset-0 cursor-default"
            onClick={() => void handleFinishSuccessOk()}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="mcq-finish-popup-title"
            aria-describedby="mcq-finish-popup-message"
            className="relative w-full max-w-sm rounded-lg border border-slate-200 bg-white p-5 text-slate-950 shadow-xl dark:border-lc-border dark:bg-lc-surface dark:text-white"
          >
            <h2 id="mcq-finish-popup-title" className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">
              Submission recorded
            </h2>
            <p id="mcq-finish-popup-message" className="mt-2 text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">
              Your MCQ submission has been successfully recorded.
            </p>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => void handleFinishSuccessOk()}
                className="inline-flex h-10 items-center justify-center rounded-md bg-[#1573e6] px-5 text-sm font-extrabold text-white shadow-sm transition hover:bg-[#0f66d4]"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {showFullscreenPrompt && !submitting && (
        <div className="fixed inset-0 z-[9998] grid place-items-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 text-slate-950 shadow-2xl dark:border-lc-border dark:bg-lc-surface dark:text-white">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#e6f4ff] text-[#0873df] dark:bg-[#0873df]/15">
                <span className="material-symbols-outlined text-[22px]">fullscreen</span>
              </span>
              <div>
                <h2 className="font-nunito text-xl font-extrabold text-slate-950 dark:text-white">Enter fullscreen</h2>
                <p className="mt-2 text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">
                  MCQ round proctoring is active. Stay in fullscreen and keep this tab focused until you submit the question.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={requestMcqFullscreen}
              className="mt-6 inline-flex h-10 w-full items-center justify-center rounded-lg bg-[#1573e6] px-5 text-sm font-extrabold text-white shadow-sm transition hover:bg-[#0f66d4]"
            >
              Enter Fullscreen
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
