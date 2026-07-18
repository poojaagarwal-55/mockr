"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const CONTEST_API = process.env.NEXT_PUBLIC_CONTEST_API_URL || "http://localhost:3002";
const WARNING_LIMIT = 10;
const WARNING_COOLDOWN_MS = 1200;

type RoundType = "mcq" | "dsa";
type Severity = "low" | "medium" | "high";

type UseContestRoundIntegrityOptions = {
  contestId: string;
  roundType: RoundType;
  submitted?: boolean;
  getToken: () => Promise<string | null>;
};

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
    // Server-side audit logging remains authoritative.
  }
}

function integrityReasonLabel(roundType: RoundType, eventType: string) {
  const roundLabel = roundType === "mcq" ? "MCQ" : "coding";
  switch (eventType) {
    case "fullscreen_exit":
      return "Fullscreen was exited";
    case "tab_hidden":
      return "Tab switch was detected";
    case "window_blur":
      return "Window focus was lost";
    case "browser_back":
      return `Browser navigation is blocked during the ${roundLabel} round`;
    case "copy":
      return `Copy is blocked during the ${roundLabel} round`;
    case "paste":
      return `Paste is blocked during the ${roundLabel} round`;
    case "contextmenu":
      return `Context menu is blocked during the ${roundLabel} round`;
    default:
      return "Contest integrity warning recorded";
  }
}

export function useContestRoundIntegrity({
  contestId,
  roundType,
  submitted = false,
  getToken,
}: UseContestRoundIntegrityOptions) {
  const router = useRouter();
  const warningStorageKey = contestId ? `contest-${roundType}-warning-count:${contestId}` : "";
  const totalWarningStorageKey = contestId ? `contest-violations-${contestId}` : "";
  const integrityStartedStorageKey = contestId ? `contest-integrity-started-${contestId}` : "";
  const [integrityStarted, setIntegrityStarted] = useState(false);
  const [warningCount, setWarningCount] = useState(0);
  const [showFullscreenPrompt, setShowFullscreenPrompt] = useState(false);
  const [warningNotice, setWarningNotice] = useState<string | null>(null);
  const warningCountRef = useRef(0);
  const roundWarningCountRef = useRef(0);
  const integrityStartedRef = useRef(false);
  const hasEnteredFullscreenRef = useRef(false);
  const lastWarningAtRef = useRef(0);
  const autoSubmitRef = useRef(false);

  const markIntegrityStarted = useCallback(() => {
    if (!contestId || typeof window === "undefined") return;
    integrityStartedRef.current = true;
    setIntegrityStarted(true);
    try {
      window.localStorage.setItem(integrityStartedStorageKey, "true");
    } catch {
      // Local state still protects the current tab.
    }
  }, [contestId, integrityStartedStorageKey]);

  const syncWarningCount = useCallback((serverRoundWarnings = 0, serverTotalWarnings = 0) => {
    const normalizedRoundWarnings = Number.isFinite(serverRoundWarnings) ? Math.max(0, serverRoundWarnings) : 0;
    const normalizedTotalWarnings = Number.isFinite(serverTotalWarnings) ? Math.max(0, serverTotalWarnings) : 0;
    const nextRoundWarnings = Math.max(readStoredNumber(warningStorageKey), normalizedRoundWarnings);
    const nextTotalWarnings = Math.max(readStoredNumber(totalWarningStorageKey), normalizedTotalWarnings, nextRoundWarnings);

    roundWarningCountRef.current = nextRoundWarnings;
    warningCountRef.current = nextTotalWarnings;
    setWarningCount(nextTotalWarnings);
    writeStoredNumber(warningStorageKey, nextRoundWarnings);
    writeStoredNumber(totalWarningStorageKey, nextTotalWarnings);

    if (nextTotalWarnings > 0) {
      markIntegrityStarted();
    }
  }, [markIntegrityStarted, totalWarningStorageKey, warningStorageKey]);

  const autoSubmitContest = useCallback(async () => {
    if (!contestId || autoSubmitRef.current) return;
    autoSubmitRef.current = true;
    try {
      const token = await getToken();
      if (token) {
        await fetch(`${CONTEST_API}/contests/${contestId}/rounds/${roundType}/submit`, {
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
  }, [contestId, getToken, roundType, router]);

  const recordIntegrityEvent = useCallback(async (
    eventType: string,
    severity: Severity = "medium",
    payload: Record<string, unknown> = {}
  ) => {
    if (!contestId || submitted || !integrityStartedRef.current) return;
    const now = Date.now();
    if (now - lastWarningAtRef.current < WARNING_COOLDOWN_MS) return;
    lastWarningAtRef.current = now;

    const nextRoundWarnings = Math.max(roundWarningCountRef.current, readStoredNumber(warningStorageKey)) + 1;
    const nextTotalWarnings = Math.max(warningCountRef.current, readStoredNumber(totalWarningStorageKey)) + 1;
    roundWarningCountRef.current = nextRoundWarnings;
    warningCountRef.current = nextTotalWarnings;
    setWarningCount(nextTotalWarnings);
    writeStoredNumber(warningStorageKey, nextRoundWarnings);
    writeStoredNumber(totalWarningStorageKey, nextTotalWarnings);
    setWarningNotice(`${integrityReasonLabel(roundType, eventType)}. Warning ${nextTotalWarnings}/${WARNING_LIMIT}.`);

    try {
      const token = await getToken();
      if (token) {
        await fetch(`${CONTEST_API}/contests/${contestId}/integrity-events`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            roundType,
            eventType,
            severity,
            warningCount: nextRoundWarnings,
            payload: {
              ...payload,
              totalWarningCount: nextTotalWarnings,
              warningLimit: WARNING_LIMIT,
              source: `${roundType}_round_page`,
            },
            clientEventId: `${roundType}-round-${eventType}-${now}`,
            clientTimestamp: new Date(now).toISOString(),
          }),
        });
      }
    } catch {
      // Keep the local count moving even if the audit request temporarily fails.
    }

    if (nextTotalWarnings >= WARNING_LIMIT) {
      void autoSubmitContest();
    }
  }, [autoSubmitContest, contestId, getToken, roundType, submitted, totalWarningStorageKey, warningStorageKey]);

  const requestFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      }
      hasEnteredFullscreenRef.current = true;
      setShowFullscreenPrompt(false);
      return true;
    } catch {
      setShowFullscreenPrompt(true);
      return false;
    }
  }, []);

  useEffect(() => {
    if (!contestId || typeof window === "undefined") return;
    const wasStarted = window.localStorage.getItem(integrityStartedStorageKey) === "true";
    const localRoundWarnings = readStoredNumber(warningStorageKey);
    const localTotalWarnings = readStoredNumber(totalWarningStorageKey);
    roundWarningCountRef.current = localRoundWarnings;
    warningCountRef.current = localTotalWarnings;
    setWarningCount(localTotalWarnings);
    if (wasStarted || localTotalWarnings > 0) {
      integrityStartedRef.current = true;
      setIntegrityStarted(true);
    }
  }, [contestId, integrityStartedStorageKey, totalWarningStorageKey, warningStorageKey]);

  useEffect(() => {
    integrityStartedRef.current = integrityStarted;
  }, [integrityStarted]);

  useEffect(() => {
    if (!integrityStarted || submitted) {
      document.body.classList.remove("contest-active-hide-nav");
      return;
    }
    document.body.classList.add("contest-active-hide-nav");
    return () => {
      document.body.classList.remove("contest-active-hide-nav");
    };
  }, [integrityStarted, submitted]);

  useEffect(() => {
    if (!integrityStarted || submitted) return;
    const guardedState = { contestRoundGuard: true, contestId, roundType };
    window.history.pushState(guardedState, "", window.location.href);
    const onPopState = () => {
      window.history.pushState(guardedState, "", window.location.href);
      void recordIntegrityEvent("browser_back", "high", { path: window.location.pathname });
    };
    setShowFullscreenPrompt(!document.fullscreenElement);

    const onVisibility = () => {
      if (document.hidden) void recordIntegrityEvent("tab_hidden", "high");
    };
    const onBlur = () => void recordIntegrityEvent("window_blur", "medium");
    const onFullscreen = () => {
      if (document.fullscreenElement) {
        hasEnteredFullscreenRef.current = true;
        setShowFullscreenPrompt(false);
        return;
      }
      setShowFullscreenPrompt(true);
      if (hasEnteredFullscreenRef.current) void recordIntegrityEvent("fullscreen_exit", "high");
    };
    const onCopy = (event: ClipboardEvent) => {
      event.preventDefault();
      void recordIntegrityEvent("copy", "medium");
    };
    const onPaste = (event: ClipboardEvent) => {
      event.preventDefault();
      void recordIntegrityEvent("paste", "high");
    };
    const onContext = (event: MouseEvent) => {
      event.preventDefault();
      void recordIntegrityEvent("contextmenu", "medium");
    };
    const onBeforeUnload = () => {
      void recordIntegrityEvent("browser_back", "high", { path: window.location.pathname });
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    document.addEventListener("fullscreenchange", onFullscreen);
    document.addEventListener("copy", onCopy, true);
    document.addEventListener("paste", onPaste, true);
    document.addEventListener("contextmenu", onContext, true);
    window.addEventListener("popstate", onPopState);
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("fullscreenchange", onFullscreen);
      document.removeEventListener("copy", onCopy, true);
      document.removeEventListener("paste", onPaste, true);
      document.removeEventListener("contextmenu", onContext, true);
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [contestId, integrityStarted, recordIntegrityEvent, roundType, submitted]);

  useEffect(() => {
    if (!warningNotice) return;
    const timer = window.setTimeout(() => setWarningNotice(null), 4500);
    return () => window.clearTimeout(timer);
  }, [warningNotice]);

  return {
    integrityStarted,
    warningCount,
    warningNotice,
    showFullscreenPrompt,
    markIntegrityStarted,
    recordIntegrityEvent,
    requestFullscreen,
    syncWarningCount,
  };
}
