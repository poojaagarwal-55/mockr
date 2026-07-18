"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Image from "next/image";
import { useRouter, useParams } from "next/navigation";
import { useTheme } from "next-themes";
import dynamic from "next/dynamic";
import Editor from "@monaco-editor/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { useInterviewSocket } from "@/hooks/use-interview-socket";
import { useVoiceInterview } from "@/hooks/use-voice-interview";
import { usePushToTalk } from "@/hooks/use-push-to-talk";
import { useRecording } from "@/hooks/use-recording";
import { STAGE_LABELS, LANGUAGE_MAP } from "@interviewforge/shared";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { ReportQuestionModal } from "@/components/report-question-modal";
import type { QuestionType } from "@/components/report-question-modal";
import { UpgradeModal, shouldShowUpgradeForError } from "@/components/upgrade-modal";
import { useBilling } from "@/hooks/use-billing";
import { useAuth } from "@/context/auth-context";
import { PushToTalkIndicator } from "@/components/push-to-talk-indicator";
import { PttOnboardingTooltip } from "@/components/ptt-onboarding-tooltip";
import ScratchpadPanel from "@/components/scratchpad-panel";

const PMNotepadPanel = dynamic(() => import("@/components/pm-notepad-panel"), {
    ssr: false,
    loading: () => (
        <div className="flex-1 flex items-center justify-center text-slate-400">
            <span className="material-symbols-outlined animate-spin text-2xl">sync</span>
        </div>
    ),
});

const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
};

const VOICE_TEXT_PAYLOAD_MAX_CHARS = 10_000;

function getCountdownTimerVisuals(remainingSeconds: number): { color: string | null; pulse: boolean } {
    const remaining = Math.max(0, remainingSeconds);

    if (remaining <= 60) {
        return {
            color: "rgb(220, 38, 38)",
            pulse: true,
        };
    }

    if (remaining <= 300) {
        return {
            color: "rgb(217, 119, 6)",
            pulse: false,
        };
    }

    return {
        color: null,
        pulse: false,
    };
}

// ── Helper: Extract error line number from compilation output ────
function extractErrorLineNumber(compileOutput: string | null | undefined): string {
    if (!compileOutput) return "";
    // Try to find line number patterns like:
    // - "error at line 10"
    // - "Line 5:"
    // - "10:5: error"
    // - etc.
    const patterns = [
        /(?:line |Line |:)(\d+)(?::|[:\s])/i,
        /^(\d+)(?::|:)/m,
        /at\s+(?:line\s+)?(\d+)/i,
    ];
    for (const pattern of patterns) {
        const match = compileOutput.match(pattern);
        if (match && match[1]) {
            return match[1];
        }
    }
    return "";
}

function clipMiddle(value: string, maxChars: number): string {
    if (value.length <= maxChars) return value;
    const marker = "\n...[truncated for voice payload limit]...\n";
    const head = Math.max(0, Math.floor((maxChars - marker.length) * 0.6));
    const tail = Math.max(0, maxChars - marker.length - head);
    return `${value.slice(0, head).trimEnd()}${marker}${value.slice(-tail).trimStart()}`;
}

function ensureVoiceTextPayloadLimit(message: string): string {
    return clipMiddle(message, VOICE_TEXT_PAYLOAD_MAX_CHARS);
}

function settleStartedInterviewSession(sessionId: string, token: string) {
    const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:3001";
    fetch(`${API_BASE}/interviews/${sessionId}/end`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        },
        body: "{}",
        keepalive: true,
    }).catch(() => undefined);
}

function stripEmbeddedExamplesAndConstraints(problemMd?: string): string {
    if (!problemMd) return "";

    // Remove duplicated sections when DB description already contains
    // Example(s)/Constraints but UI renders dedicated sections below.
    const sectionStartPattern = /^\s*(?:#{1,6}\s*)?(?:\*\*|__)?\s*(?:examples?|example\s*\d+|constraints?)\s*(?:\*\*|__)?\s*:?.*$/gim;
    const matches = Array.from(problemMd.matchAll(sectionStartPattern));

    if (matches.length === 0) {
        return problemMd.trim();
    }

    const firstMatchIndex = matches
        .map((m) => m.index)
        .filter((idx): idx is number => typeof idx === "number")
        .sort((a, b) => a - b)[0];

    if (firstMatchIndex === undefined) {
        return problemMd.trim();
    }

    return problemMd.slice(0, firstMatchIndex).trim();
}

// ── Helper: Create minimal message for LLM (without code details) ────
function buildMinimalCodeResultMessage(
    isRun: boolean,
    samplePassed: number,
    sampleTotal: number,
    totalPassed: number,
    totalTests: number,
    language: string,
    errorMsg?: string,
    errorType?: 'CE' | 'RE' | 'WA'
): string {
    const languageLabel = language || "unknown";
    if (errorType === 'CE') {
        const lineNum = extractErrorLineNumber(errorMsg);
        const errorShort = errorMsg?.split('\n')[0]?.slice(0, 80) || "Compilation error";
        if (lineNum) {
            return `[Code ${isRun ? 'Run' : 'Submit'} Result in ${languageLabel} - Compilation Error at line ${lineNum}. Fix and recompile.]`;
        }
        return `[Code ${isRun ? 'Run' : 'Submit'} Result in ${languageLabel} - Compilation Error: ${errorShort} Fix and recompile.]`;
    }

    if (errorType === 'RE') {
        const errorShort = errorMsg?.split('\n')[0]?.slice(0, 80) || "Runtime error";
        return `[Code ${isRun ? 'Run' : 'Submit'} Result in ${languageLabel} - Runtime Error: ${errorShort} Debug and recompile.]`;
    }

    if (isRun && samplePassed === sampleTotal) {
        return `[Code Run Result in ${languageLabel} - ${samplePassed}/${sampleTotal} visible test cases passed]`;
    }

    if (!isRun && totalPassed === totalTests) {
        return `[Code Submit Result in ${languageLabel} - All ${totalTests} test cases passed (${samplePassed}/${sampleTotal} visible, ${totalTests - samplePassed}/${totalTests - sampleTotal} hidden)]`;
    }

    if (isRun) {
        return `[Code Run Result in ${languageLabel} - ${samplePassed}/${sampleTotal} visible test cases passed. Debug failed cases and recompile.]`;
    }

    return `[Code Submit Result in ${languageLabel} - ${totalPassed}/${totalTests} total test cases passed (${samplePassed}/${sampleTotal} visible, ${totalTests - samplePassed}/${totalTests - sampleTotal} hidden). Debug failed cases and recompile.]`;
}


export default function LiveRoomPage() {
    useEffect(() => { document.title = "Interview Room | Mockr"; }, []);
    const { resolvedTheme, setTheme } = useTheme();
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);
    const isDark = mounted && resolvedTheme === "dark";

    const router = useRouter();
    const params = useParams();
    const sessionId = params?.sessionId as string;
    const { snapshot: billingSnapshot, refresh: refreshBilling } = useBilling();
    const { session: authSession } = useAuth();
    const [startStatus, setStartStatus] = useState<"ready" | "blocked">("ready");
    const [startError, setStartError] = useState<string | null>(null);
    const [upgradeOpen, setUpgradeOpen] = useState(false);
    const chargeStartedRef = useRef(false);
    const endingRef = useRef(false);
    const startSucceededRef = useRef(false);
    const startTokenRef = useRef<string | null>(null);
    const interviewEndedRef = useRef(false);
    const pageExitedRef = useRef(false);
    const exitSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // ── WebSocket Hook ────────────────────────────────────────
    const {
        socket,
        connected,
        isJoined,
        messages,
        currentStage,
        activePanel,
        panelData,
        error,
        interviewType,
        stageDurations,
        estimatedMinutes,
        sendMessage,
        sendVoiceText,
        sendSilentMessage,
        sendSilentVoiceText,
        clearError,
        sendCodeSnapshot,
        sendCanvasSnapshot,
        sendNotepadSnapshot,
        closeActivePanel,
        runCode,
        submitCode,
        requestDsaTimeout,
        endInterview,
        leaveSession,
        isAudioPlaying,
        aiAudioStream,
        ensureAiAudioStream,
        sessionEnded,
        stopAudio,
    } = useInterviewSocket(sessionId);

    // ── Reserve interview minutes on room load (idempotent, async) ────
    useEffect(() => {
        if (!sessionId || chargeStartedRef.current) return;
        chargeStartedRef.current = true;

        (async () => {
            try {
                const { data } = await createSupabaseBrowserClient().auth.getSession();
                const token = data.session?.access_token;
                if (!token) {
                    setStartError("Sign in again to start this interview.");
                    setStartStatus("blocked");
                    return;
                }
                startTokenRef.current = token;

                const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:3001";
                const res = await fetch(`${API_BASE}/interviews/${sessionId}/start`, {
                    method: "POST",
                    headers: { Authorization: `Bearer ${token}` },
                });

                if (!res.ok) {
                    const body = await res.json().catch(() => ({}));
                    setStartError(body.message || "Could not start interview.");
                    if (shouldShowUpgradeForError(body)) {
                        setUpgradeOpen(true);
                    }
                    setStartStatus("blocked");
                    return;
                }

                startSucceededRef.current = true;
                if (pageExitedRef.current) {
                    settleStartedInterviewSession(sessionId, token);
                    return;
                }

                await refreshBilling();
                setStartError(null);
                setStartStatus("ready");
            } catch (err) {
                console.error("[Room] Error starting interview:", err);
                setStartError("Could not start interview.");
                setStartStatus("blocked");
            }
        })();
    }, [sessionId, refreshBilling]);

    // ── Toast State ───────────────────────────────────────────
    const [toastMessage, setToastMessage] = useState<string | null>(null);

    const showToast = (msg: string) => {
        setToastMessage(msg);
        setTimeout(() => setToastMessage(null), 5000);
    };

    // ── Voice Hook ────────────────────────────────────────────
    const {
        connectionState,
        isVoiceActive,
        isListening,
        isMuted,
        micAudioTrack,
        startVoice,
        stopVoice,
        toggleMute,
        setMuted,
    } = useVoiceInterview({
        sessionId,
        socket,
        isJoined,
        onFallbackModeTriggered: () => {
            showToast("Audio disconnected. Switched to text mode.");
        },
        onError: (err) => {
            console.error("[Voice] STT Error:", err);
            showToast(err);
        },
    });

    // ── Push-to-Talk Hook ─────────────────────────────────────
    const {
        pushToTalkEnabled,
        isHoldingSpace,
        togglePushToTalk,
    } = usePushToTalk({
        isVoiceActive,
        isFallback: connectionState === 'fallback',
        socket,
        setMuted,
    });

    // ── PTT Onboarding Tooltip ────────────────────────────────
    const [showPttTooltip, setShowPttTooltip] = useState(false);
    
    useEffect(() => {
        if (pushToTalkEnabled) {
            const hasSeenOnboarding = localStorage.getItem('practers_ptt_onboarding_shown');
            if (!hasSeenOnboarding) {
                setShowPttTooltip(true);
                localStorage.setItem('practers_ptt_onboarding_shown', 'true');
            }
        }
    }, [pushToTalkEnabled]);

    // ── Recording Hook ────────────────────────────────────────
    const {
        recordingState,
        uploadProgress,
        durationSec: recordingDuration,
        startRecording,
        stopRecording,
    } = useRecording({
        sessionId,
        micAudioTrack,
        aiAudioStream,
        ensureAiAudioStream,
        isPremium: billingSnapshot?.entitlements?.interviewRecordingAccess ?? false,
        token: authSession?.access_token,
        onError: showToast,
    });

    // Auto-start voice when session connects
    const voiceStartedRef = useRef(false);
    useEffect(() => {
        if (!isJoined) {
            // Reset the ref when disconnected so that upon server-reconnection and re-join,
            // the voice session attempts to automatically restart.
            voiceStartedRef.current = false;
        } else if (isJoined && !voiceStartedRef.current) {
            voiceStartedRef.current = true;
            startVoice();
        }
    }, [isJoined, startVoice]);

    // Camera with real webcam
    const [isCameraOn, setIsCameraOn] = useState(false);
    const cameraStreamRef = useRef<MediaStream | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);

    const startCamera = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            cameraStreamRef.current = stream;
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
            }
            setIsCameraOn(true);
        } catch (err) {
            console.error("Camera access denied:", err);
        }
    };

    const stopCamera = () => {
        if (cameraStreamRef.current) {
            cameraStreamRef.current.getTracks().forEach(t => t.stop());
            cameraStreamRef.current = null;
        }
        if (videoRef.current) {
            videoRef.current.srcObject = null;
        }
        setIsCameraOn(false);
    };

    const toggleCamera = () => {
        if (isCameraOn) stopCamera();
        else startCamera();
    };

    // Ensure video element gets the stream when it's mounted
    useEffect(() => {
        if (isCameraOn && cameraStreamRef.current && videoRef.current && !videoRef.current.srcObject) {
            videoRef.current.srcObject = cameraStreamRef.current;
        }
    }, [isCameraOn]);

    // Cleanup camera on unmount
    useEffect(() => {
        return () => {
            if (cameraStreamRef.current) {
                cameraStreamRef.current.getTracks().forEach(t => t.stop());
            }
        };
    }, []);

    // ── Timers (Persistent via localStorage) ──────────────────
    const DSA_TIME_LIMIT = 30 * 60; // 30 min — DSA sub-stage within full interview
    const SQL_TIME_LIMIT = 15 * 60; // 15 min — SQL sub-stage

    // Per-type overall interview time limit
    const INTERVIEW_LIMITS: Record<string, number> = {
        full_interview:    90 * 60,
        coding:            40 * 60,
        cs_fundamentals:   25 * 60,
        system_design:     30 * 60,
        behavioural:       15 * 60,
        gen_ai_role:       55 * 60,
        data_science_role: 70 * 60,
        pm_role:           90 * 60,
    };
    const configuredInterviewLimit = stageDurations
        ? Object.values(stageDurations).reduce((total, duration) => total + (duration?.max || 0), 0) * 60
        : 0;
    // Prefer the module-derived estimate the user saw at setup (every interview
    // type), then any per-stage durations, then the static per-type fallback.
    const estimatedInterviewLimit = estimatedMinutes && estimatedMinutes > 0 ? estimatedMinutes * 60 : 0;
    const interviewLimit = estimatedInterviewLimit || configuredInterviewLimit || INTERVIEW_LIMITS[interviewType || ""] || 90 * 60;

    const [elapsed, setElapsed] = useState(0);
    const [dsaElapsed, setDsaElapsed] = useState(0);
    const [sqlElapsed, setSqlElapsed] = useState(0);
    const [dsaTimeOutTriggered, setDsaTimeOutTriggered] = useState(false);

    // Remaining time for the whole interview (counts down)
    const interviewRemaining = Math.max(0, interviewLimit - elapsed);
    const globalTimerVisuals = getCountdownTimerVisuals(interviewRemaining);

    useEffect(() => {
        if (!connected || !sessionId) return;
        
        // 1. Global Session Timer
        const globalKey = `practers_session_start_${sessionId}`;
        let globalStartStr = localStorage.getItem(globalKey);
        let globalStart: number;
        if (!globalStartStr) {
            globalStart = Date.now();
            localStorage.setItem(globalKey, globalStart.toString());
        } else {
            globalStart = parseInt(globalStartStr, 10);
        }

        // 2. DSA Specific Timer
        const dsaKey = `practers_dsa_start_${sessionId}`;
        let dsaStart: number | null = null;
        if (currentStage === "DSA") {
            const dsaStartStr = localStorage.getItem(dsaKey);
            if (!dsaStartStr) {
                // If this is the newly generated marker but the session is COMPLETED, 
                // we shouldn't really record a new start, but it's safe to just record now
                dsaStart = Date.now();
                localStorage.setItem(dsaKey, dsaStart.toString());
            } else {
                dsaStart = parseInt(dsaStartStr, 10);
            }
        }

        const timer = setInterval(() => {
            const now = Date.now();
            
            // Render Global
            setElapsed(Math.floor((now - globalStart) / 1000));
            
            // Render DSA
            if (currentStage === "DSA" && dsaStart && !dsaTimeOutTriggered) {
                const dsaSecs = Math.floor((now - dsaStart) / 1000);
                if (dsaSecs >= DSA_TIME_LIMIT) {
                    setDsaElapsed(DSA_TIME_LIMIT);
                    setDsaTimeOutTriggered(true);
                    requestDsaTimeout();
                } else {
                    setDsaElapsed(dsaSecs);
                }
            }
        }, 1000);
        
        return () => clearInterval(timer);
    }, [connected, currentStage, dsaTimeOutTriggered, requestDsaTimeout, sessionId]);

    // Handle end interview (user-initiated)
    const [interviewEnded, setInterviewEnded] = useState(false);
    const handleEndInterview = useCallback(async () => {
        if (endingRef.current) return;
        endingRef.current = true;
        interviewEndedRef.current = true;
        setInterviewEnded(true);
        stopVoice();
        // Kick off final upload — runs in background, doesn't block redirect
        stopRecording().catch(() => {});
        await endInterview();
        await refreshBilling().catch(() => undefined);
        leaveSession();
        router.push(`/complete/${sessionId}`);
    }, [endInterview, leaveSession, refreshBilling, router, sessionId, stopRecording, stopVoice]);

    useEffect(() => {
        if (exitSettleTimerRef.current) {
            clearTimeout(exitSettleTimerRef.current);
            exitSettleTimerRef.current = null;
            pageExitedRef.current = false;
        }

        const settleOnPageExit = () => {
            pageExitedRef.current = true;
            if (!sessionId || !startSucceededRef.current || interviewEndedRef.current) return;
            const token = startTokenRef.current;
            if (!token) return;

            settleStartedInterviewSession(sessionId, token);
        };

        window.addEventListener("pagehide", settleOnPageExit);
        return () => {
            window.removeEventListener("pagehide", settleOnPageExit);
            exitSettleTimerRef.current = setTimeout(settleOnPageExit, 150);
        };
    }, [sessionId]);

    // Handle session ended by AI (end_interview tool) — stop mic and redirect
    useEffect(() => {
        if (sessionEnded && !interviewEnded) {
            endingRef.current = true;
            interviewEndedRef.current = true;
            setInterviewEnded(true);
            stopVoice();
            leaveSession();
            refreshBilling().catch(() => undefined);
            router.push(`/complete/${sessionId}`);
        }
    }, [interviewEnded, leaveSession, refreshBilling, router, sessionEnded, sessionId, stopVoice]);

    // ── Auto-end when overall interview timer reaches 0 ────────
    useEffect(() => {
        if (elapsed > 0 && interviewRemaining === 0 && !interviewEnded) {
            handleEndInterview();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [interviewRemaining]);

    // Determine which phase to show.
    // Trust explicit panel-open events from the server instead of strict stage
    // matching here, since stage and panel events can arrive in separate ticks.
    // This prevents a stage race from hiding an already-open panel.
    const showSqlPanel = activePanel === "sql" && panelData != null;
    const showCoding =
        (activePanel === "ide" || activePanel === "scratchpad") && panelData != null;
    const showNotepad = activePanel === "notepad" && panelData != null;

    // Notepad content — autosaved in component state so it persists if panel is hidden
    const [notepadContent, setNotepadContent] = useState<string>("");

    useEffect(() => {
        if (!connected || !sessionId || !showSqlPanel || currentStage !== "FUNDAMENTALS") return;

        const sqlKey = `practers_sql_start_${sessionId}`;
        let sqlStartStr = localStorage.getItem(sqlKey);
        let sqlStart: number;
        if (!sqlStartStr) {
            sqlStart = Date.now();
            localStorage.setItem(sqlKey, sqlStart.toString());
        } else {
            sqlStart = parseInt(sqlStartStr, 10);
        }

        const timer = setInterval(() => {
            const now = Date.now();
            const sqlSecs = Math.floor((now - sqlStart) / 1000);
            setSqlElapsed(Math.min(sqlSecs, SQL_TIME_LIMIT));
        }, 1000);

        return () => clearInterval(timer);
    }, [connected, currentStage, sessionId, showSqlPanel, SQL_TIME_LIMIT]);

    if (startStatus !== "ready") {
        return (
            <div className="fixed inset-0 z-[300] flex flex-col items-center justify-center bg-white dark:bg-lc-bg px-4">
                <UpgradeModal
                    open={upgradeOpen}
                    onClose={() => setUpgradeOpen(false)}
                    feature="interview_minutes"
                    reason="minutes"
                    currentPlan={billingSnapshot?.plan}
                    currentSubscriptionId={billingSnapshot?.subscriptionId ?? undefined}
                    showMinutePacks
                    description={startError || "Add minutes or upgrade your plan to start this interview."}
                />
                <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-xl dark:border-lc-border dark:bg-lc-surface">
                    <div className="mx-auto mb-5 flex size-12 items-center justify-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300">
                        <span className="material-symbols-outlined text-[26px]">lock</span>
                    </div>
                    <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                        Interview locked
                    </h2>
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                        {startError || "Add minutes or upgrade your plan to start this interview."}
                    </p>
                    <div className="mt-5 flex items-center justify-center gap-3">
                        <button
                            onClick={() => setUpgradeOpen(true)}
                            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-dark"
                        >
                            Upgrade or buy minutes
                        </button>
                        <button
                            onClick={() => router.push("/interviews/ai")}
                            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 dark:border-lc-border dark:text-slate-200 dark:hover:bg-lc-hover"
                        >
                            Choose another interview
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // Show loading overlay until socket is connected and session is joined
    if (!isJoined) {
        const hasJoinError = Boolean(error);
        return (
            <div className="fixed inset-0 z-[300] flex flex-col items-center justify-center bg-white dark:bg-lc-bg">
                <div className="flex flex-col items-center gap-6">
                    {!hasJoinError && (
                        <div className="relative">
                            <div className="size-16 border-[3px] border-slate-200 dark:border-lc-border rounded-full" />
                            <div className="absolute inset-0 size-16 border-[3px] border-primary border-t-transparent rounded-full animate-spin" />
                        </div>
                    )}
                    <div className="text-center space-y-2">
                        <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                            {hasJoinError ? "Unable to start interview" : (interviewEnded ? "Wrapping up your interview" : "Setting up your interview")}
                        </h2>
                        {hasJoinError ? (
                            <>
                                <p className="text-sm text-red-500">{error}</p>
                                <div className="flex items-center justify-center gap-3 pt-2">
                                    <button
                                        onClick={() => window.location.reload()}
                                        className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold"
                                    >
                                        Retry
                                    </button>
                                    <button
                                        onClick={() => router.push("/interviews")}
                                        className="px-4 py-2 rounded-lg border border-slate-300 dark:border-lc-border text-sm font-semibold"
                                    >
                                        Back to Interviews
                                    </button>
                                </div>
                            </>
                        ) : (
                            <p className="text-sm text-slate-500 animate-pulse">
                                {interviewEnded ? "Preparing your evaluation report..." : "Launching interview room..."}
                            </p>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="h-screen overflow-hidden flex flex-col text-slate-900 dark:text-[#eff1f6] bg-[#FAFBFC] dark:bg-lc-bg">
            {/* PTT Onboarding Tooltip */}
            <PttOnboardingTooltip 
                show={showPttTooltip} 
                onDismiss={() => setShowPttTooltip(false)} 
            />
            
            {/* Top Navigation Bar */}
            <header className="h-16 border-b border-slate-200 dark:border-lc-border bg-white dark:bg-lc-surface flex items-center justify-between px-4 z-50 shrink-0">
                <div className="flex items-center shrink-0 pl-4">
                    {isDark ? (
                        <Image src="/logo_big_dark.png" alt="Mockr" width={180} height={51} className="h-10 w-auto object-contain" priority />
                    ) : (
                        <Image src="/logo_big.png" alt="Mockr" width={180} height={51} className="h-10 w-auto object-contain" priority />
                    )}
                </div>

                <div className="flex items-center gap-8">

                    {/* Global Night Mode Toggle */}
                    <button 
                        onClick={() => setTheme(isDark ? "light" : "dark")}
                        className="flex items-center justify-center p-1.5 rounded-full text-slate-500 hover:text-slate-800 dark:text-[#ababab] dark:hover:text-white transition-colors"
                        title="Toggle Global Theme"
                    >
                        <span className="material-symbols-outlined text-[23px]">
                            {isDark ? 'light_mode' : 'dark_mode'}
                        </span>
                    </button>

                    {/* Timer — countdown from the interview's total time limit */}
                    <div className={`flex items-center gap-2 ${globalTimerVisuals.pulse ? "animate-pulse" : ""}`}>
                        <span
                            className={`material-symbols-outlined text-[20px] leading-none ${globalTimerVisuals.color ? "" : "text-slate-500 dark:text-[#ababab]"}`}
                            style={globalTimerVisuals.color ? { color: globalTimerVisuals.color } : undefined}
                        >
                            timer
                        </span>
                        <span
                            className={`font-mono text-[15px] font-bold leading-none ${globalTimerVisuals.color ? "" : "text-slate-700 dark:text-[#eff1f6]"}`}
                            style={globalTimerVisuals.color ? { color: globalTimerVisuals.color } : undefined}
                        >
                            {formatTime(interviewRemaining)}
                        </span>
                    </div>

                    {/* Recording Indicator / Button */}
                    {billingSnapshot?.entitlements?.interviewRecordingAccess && (
                        <div className="flex items-center gap-2">
                            {recordingState === "idle" && (
                                <button
                                    id="btn-record-session"
                                    onClick={startRecording}
                                    className="flex items-center gap-2 px-3 py-1.5 rounded-full text-[13px] font-semibold text-slate-600 dark:text-[#ababab] hover:text-red-500 dark:hover:text-red-400 border border-slate-200 dark:border-[#333] hover:border-red-300 dark:hover:border-red-500/40 transition-all cursor-pointer"
                                    title="Record this session (screen + mic)"
                                >
                                    <span className="material-symbols-outlined text-[16px]">screen_record</span>
                                    Record
                                </button>
                            )}
                            {recordingState === "requesting" && (
                                <span className="flex items-center gap-2 text-[13px] font-semibold text-amber-500">
                                    <span className="material-symbols-outlined text-[16px] animate-spin">sync</span>
                                    Awaiting permission…
                                </span>
                            )}
                            {recordingState === "recording" && (
                                <span className="flex items-center gap-2 text-[13px] font-bold text-slate-700 dark:text-[#eff1f6]">
                                    <span className="w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse" />
                                    REC
                                </span>
                            )}
                            {recordingState === "uploading" && (
                                <span className="flex items-center gap-2 text-[13px] font-semibold text-blue-500">
                                    <span className="material-symbols-outlined text-[16px] animate-spin">sync</span>
                                    Saving {uploadProgress}%
                                </span>
                            )}
                            {recordingState === "done" && (
                                <span className="flex items-center gap-2 text-[13px] font-semibold text-emerald-500">
                                    <span className="material-symbols-outlined text-[16px]">check_circle</span>
                                    Saved
                                </span>
                            )}
                            {recordingState === "failed" && (
                                <span className="flex items-center gap-2 text-[13px] font-semibold text-red-400">
                                    <span className="material-symbols-outlined text-[16px]">error</span>
                                    Failed
                                </span>
                            )}
                        </div>
                    )}
                    {/* Static REC indicator for non-premium users */}
                    {!billingSnapshot?.entitlements?.interviewRecordingAccess && (
                        <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse" />
                            <span className="text-[14px] font-bold text-slate-700 dark:text-[#eff1f6]">REC</span>
                        </div>
                    )}

                    {/* Fix 8: Divider separates Record (low-stakes) from End Interview (destructive) */}
                    <div className="w-px h-6 bg-slate-200 dark:bg-lc-border shrink-0" />

                    {/* End Call Header Button */}
                    <button
                        onClick={() => handleEndInterview()}
                        className="flex items-center gap-2 bg-[#E11D48] hover:bg-[#BE123C] px-5 py-2 rounded-full transition-all duration-200 cursor-pointer shadow-[0_1px_2px_rgba(0,0,0,0.22)] hover:-translate-y-0.5 hover:shadow-[0_2px_4px_rgba(0,0,0,0.26)] active:translate-y-0"
                        title="End Interview"
                    >
                        <span className="material-symbols-outlined text-[18px] text-white">call_end</span>
                        <span className="text-sm font-bold text-white tracking-wide">End Interview</span>
                    </button>


                </div>
            </header>

            {/* Main Content */}
            <div className="flex-1 overflow-hidden">
                {showSqlPanel ? (
                    <SqlIdePhase
                        isDark={isDark}
                        sqlElapsed={sqlElapsed}
                        SQL_TIME_LIMIT={SQL_TIME_LIMIT}
                        panelData={panelData}
                        messages={messages}
                        connected={connected}
                        isVoiceActive={isVoiceActive}
                        isAISpeaking={isAudioPlaying}
                        connectionState={connectionState}
                        sendMessage={sendMessage}
                        sendVoiceText={sendVoiceText}
                        sendSilentMessage={sendSilentMessage}
                        sendSilentVoiceText={sendSilentVoiceText}
                        sendCodeSnapshot={sendCodeSnapshot}
                        stopAudio={stopAudio}
                        isMuted={isMuted}
                        isCameraOn={isCameraOn}
                        toggleMute={toggleMute}
                        toggleCamera={toggleCamera}
                        videoRef={videoRef}
                        pushToTalkEnabled={pushToTalkEnabled}
                        isHoldingSpace={isHoldingSpace}
                        togglePushToTalk={togglePushToTalk}
                    />
                ) : showCoding ? (
                    <CodingPhase
                        sessionId={sessionId}
                        isDark={isDark}
                        currentStage={currentStage}
                        interviewType={interviewType || ""}
                        interviewRemaining={interviewRemaining}
                        dsaElapsed={dsaElapsed}
                        DSA_TIME_LIMIT={DSA_TIME_LIMIT}
                        panelType={activePanel || ""}
                        panelData={panelData}
                        messages={messages}
                        connected={connected}
                        isVoiceActive={isVoiceActive}
                        isAISpeaking={isAudioPlaying}
                        connectionState={connectionState}
                        sendMessage={sendMessage}
                        sendVoiceText={sendVoiceText}
                        sendSilentMessage={sendSilentMessage}
                        sendSilentVoiceText={sendSilentVoiceText}
                        sendCodeSnapshot={sendCodeSnapshot}
                        sendCanvasSnapshot={sendCanvasSnapshot}
                        runCode={runCode}
                        submitCode={submitCode}
                        stopAudio={stopAudio}
                        isMuted={isMuted}
                        isCameraOn={isCameraOn}
                        toggleMute={toggleMute}
                        toggleCamera={toggleCamera}
                        videoRef={videoRef}
                        pushToTalkEnabled={pushToTalkEnabled}
                        isHoldingSpace={isHoldingSpace}
                        togglePushToTalk={togglePushToTalk}
                    />
                ) : showNotepad ? (
                    <NotepadPhase
                        isDark={isDark}
                        panelData={panelData}
                        notepadContent={notepadContent}
                        onNotepadChange={(html) => {
                            setNotepadContent(html);
                            sendNotepadSnapshot(html);
                        }}
                        onClose={closeActivePanel}
                        messages={messages}
                        connected={connected}
                        isVoiceActive={isVoiceActive}
                        isAISpeaking={isAudioPlaying}
                        connectionState={connectionState}
                        sendMessage={sendMessage}
                        sendVoiceText={sendVoiceText}
                        stopAudio={stopAudio}
                        isMuted={isMuted}
                        isCameraOn={isCameraOn}
                        toggleMute={toggleMute}
                        toggleCamera={toggleCamera}
                        videoRef={videoRef}
                        pushToTalkEnabled={pushToTalkEnabled}
                        isHoldingSpace={isHoldingSpace}
                        togglePushToTalk={togglePushToTalk}
                    />
                ) : (
                    <VideoCallPhase
                        isDark={isDark}
                        messages={messages}
                        connected={connected}
                        isVoiceActive={isVoiceActive}
                        isAISpeaking={isAudioPlaying}
                        isMuted={isMuted}
                        isListening={isListening}
                        isCameraOn={isCameraOn}
                        connectionState={connectionState}
                        toggleMute={toggleMute}
                        toggleCamera={toggleCamera}
                        sendMessage={sendMessage}
                        sendVoiceText={sendVoiceText}
                        stopAudio={stopAudio}
                        videoRef={videoRef}
                        pushToTalkEnabled={pushToTalkEnabled}
                        isHoldingSpace={isHoldingSpace}
                        togglePushToTalk={togglePushToTalk}
                    />
                )}
            </div>

            {/* Error banner */}
            {error && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-red-500 text-white px-5 py-3 rounded-xl shadow-lg text-sm font-medium z-50 flex items-center gap-3">
                    <span>{error}</span>
                    <button onClick={clearError} className="opacity-70 hover:opacity-100 transition-opacity cursor-pointer">
                        <span className="material-symbols-outlined text-[16px]">close</span>
                    </button>
                </div>
            )}

            {/* Connection State Toast */}
            {toastMessage && (
                <div className="absolute top-20 right-6 bg-slate-800 dark:bg-slate-700 text-white px-4 py-3 rounded-xl shadow-lg border border-slate-700 dark:border-slate-600 text-sm font-medium z-50 flex items-center gap-2 animate-in slide-in-from-right fade-in">
                    <span className="material-symbols-outlined text-amber-400 text-[18px]">info</span>
                    {toastMessage}
                </div>
            )}

            {/* Full Screen Loading Overlay */}
            {connected && messages.length === 0 && !isAudioPlaying && connectionState !== 'connected' && connectionState !== 'fallback' && (
                <div className="absolute inset-0 z-[100] bg-[#FAFBFC] dark:bg-lc-bg flex flex-col items-center justify-center">
                    <div className="flex flex-col items-center gap-6">
                        <div className="relative">
                            <div className="size-20 border-4 border-slate-200 dark:border-lc-border rounded-full"></div>
                            <div className="absolute inset-0 size-20 border-4 border-primary rounded-full border-t-transparent animate-spin"></div>
                            {/* <div className="absolute inset-0 flex items-center justify-center">
                                <span className="material-symbols-outlined text-primary text-2xl">support_agent</span>
                            </div> */}
                        </div>
                        <div className="flex flex-col items-center gap-2">
                            <h3 className="text-xl font-bold text-slate-800 dark:text-white">
                                {connectionState === 'connecting' || connectionState === 'reconnecting' ? "Interviewer is joining..." : "Connecting to Interviewer..."}
                            </h3>
                            <p className="text-slate-500 dark:text-slate-400 text-sm">
                                {connectionState === 'connecting' || connectionState === 'reconnecting' ? "Almost ready! You can start speaking now." : "Please wait while we prepare your session."}
                            </p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

/* ============================================================
   PHASE 1: Video Call (INTRO / FUNDAMENTALS / CLOSING)
   ============================================================ */
function VideoCallPhase({
    isDark,
    messages,
    connected,
    isVoiceActive,
    isAISpeaking,
    isMuted,
    isListening,
    isCameraOn,
    connectionState,
    toggleMute,
    toggleCamera,
    sendMessage,
    sendVoiceText,
    stopAudio,
    videoRef,
    pushToTalkEnabled,
    isHoldingSpace,
    togglePushToTalk,
}: {
    isDark: boolean;
    messages: { id: string; role: string; text: string; isStreaming?: boolean; hidden?: boolean }[];
    connected: boolean;
    isVoiceActive: boolean;
    isAISpeaking: boolean;
    isMuted: boolean;
    isListening: boolean;
    isCameraOn: boolean;
    connectionState: string;
    toggleMute: () => void;
    toggleCamera: () => void;
    sendMessage: (msg: string) => void;
    sendVoiceText: (msg: string) => void;
    stopAudio: () => void;
    videoRef: React.RefObject<HTMLVideoElement | null>;
    pushToTalkEnabled: boolean;
    isHoldingSpace: boolean;
    togglePushToTalk: () => void;
}) {
    const [input, setInput] = useState("");
    const chatEndRef = useRef<HTMLDivElement>(null);
    const [showPttHintTooltip, setShowPttHintTooltip] = useState(true);
    
    useEffect(() => {
        const timer = setTimeout(() => setShowPttHintTooltip(false), 20000);
        return () => clearTimeout(timer);
    }, []);

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    const isFallback = connectionState === 'fallback';

    const handleSend = () => {
        if (!input.trim()) return;
        const text = input.trim();
        setInput("");
        // In active voice mode, typed text should go through Gemini Live so
        // the response returns as voice output (not text-only chat stream).
        if (isVoiceActive && !isFallback) {
            // If AI is currently speaking, barge-in before sending typed response.
            stopAudio();
            sendVoiceText(text);
            return;
        }
        sendMessage(text);
    };

    return (
        <main className="flex h-full p-6 gap-6 bg-gradient-to-br from-slate-50 via-slate-100 to-slate-50 dark:from-[#0a0a0a] dark:via-[#0f0f0f] dark:to-[#0a0a0a]">
            {/* LEFT SIDE — Videos + Controls */}
            <div className="w-[32%] min-w-[320px] max-w-[420px] flex flex-col gap-5 shrink-0">
                {/* AI Interviewer Video */}
                <div className="h-[45%] relative rounded-3xl overflow-hidden shadow-2xl border border-slate-800/50">
                    {/* Full background image */}
                    <div className="absolute inset-0">
                        <Image
                            src="/interviewer.png"
                            alt="Interviewer"
                            fill
                            className="object-cover object-top scale-[1.1] origin-top"
                            priority
                        />
                        {/* Gradient overlays for better text visibility */}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />
                    </div>
                    
                    {/* Status Badge */}
                    <div className="absolute top-4 left-4 flex items-center gap-2 bg-black/50 backdrop-blur-xl px-3 py-1.5 rounded-full border border-emerald-500/30 z-10 shadow-lg shadow-emerald-500/20">
                        <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500 shadow-lg shadow-emerald-500/50"></span>
                        </span>
                        <span className="text-white/95 text-[10px] font-bold uppercase tracking-wider">Interviewer</span>
                    </div>
                </div>

                {/* Candidate Video */}
                <div className="h-[45%] relative bg-gradient-to-br from-[#1a1f2e] via-[#252b3d] to-[#1a1f2e] rounded-3xl overflow-hidden shadow-2xl border border-slate-800/50">
                    {isCameraOn ? (
                        <>
                            <video
                                ref={videoRef}
                                autoPlay
                                playsInline
                                muted
                                className="absolute inset-0 w-full h-full object-cover"
                                style={{ transform: 'scaleX(-1)' }}
                            />
                            {/* Overlay gradient for better UI visibility */}
                            <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent pointer-events-none" />
                        </>
                    ) : (
                        <>
                            {/* Animated background */}
                            <div className="absolute inset-0 overflow-hidden">
                                <div className="absolute top-1/3 left-1/3 w-48 h-48 bg-amber-600/15 rounded-full blur-[100px] animate-pulse" />
                                <div className="absolute bottom-1/3 right-1/3 w-56 h-56 bg-orange-600/10 rounded-full blur-[120px] animate-pulse" style={{ animationDelay: '1.5s' }} />
                                
                                {/* Grid pattern */}
                                <div className="absolute inset-0 opacity-[0.02]" style={{
                                    backgroundImage: 'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)',
                                    backgroundSize: '50px 50px'
                                }} />
                            </div>
                            
                            {/* Avatar */}
                            <div className="absolute inset-0 flex items-center justify-center">
                                <div className="relative">
                                    {/* Glow effect */}
                                    <div className="absolute -inset-4 bg-gradient-to-r from-slate-600/20 to-slate-700/20 rounded-full blur-2xl" />
                                    
                                    {/* Avatar circle with gradient border */}
                                    <div className="relative w-22 h-22 rounded-full p-[3px] bg-gradient-to-br from-slate-600/50 via-slate-700/50 to-slate-600/50">
                                        <div className="w-full h-full bg-gradient-to-br from-slate-800 via-slate-900 to-slate-800 rounded-full flex items-center justify-center overflow-hidden shadow-2xl">
                                            <span className="material-symbols-outlined text-[52px] text-slate-500">person</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </>
                    )}
                    
                    {/* Status Badge */}
                    <div className="absolute top-4 left-4 flex items-center gap-2 bg-black/50 backdrop-blur-xl px-3 py-1.5 rounded-full border border-emerald-500/30 z-10 shadow-lg shadow-emerald-500/20">
                        <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500 shadow-lg shadow-emerald-500/50"></span>
                        </span>
                        <span className="text-white/95 text-[10px] font-bold uppercase tracking-wider">You (Candidate)</span>
                    </div>
                </div>

                {/* Call Controls — below user video */}
                <div className="flex flex-col items-center gap-3 py-4">
                    <div className="flex items-center justify-center gap-5">
                        {/* Mute / Unmute (Hidden in PTT mode, disabled in fallback) */}
                        {!pushToTalkEnabled && (
                            <button
                                onClick={toggleMute}
                                disabled={isFallback}
                                className={`px-6 py-3 rounded-full transition-all flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed ${
                                    isMuted
                                        ? "bg-red-500 hover:bg-red-600 text-white"
                                        : "bg-slate-700/80 hover:bg-slate-600 text-white"
                                }`}
                                title={isFallback ? "Microphone disabled in text mode" : isMuted ? "Unmute" : "Mute"}
                            >
                                <span className="material-symbols-outlined text-[23px] leading-none">
                                    {isMuted ? "mic_off" : "mic"}
                                </span>
                            </button>
                        )}

                        {/* Camera Toggle */}
                        <button
                            onClick={toggleCamera}
                            className={`px-6 py-3 rounded-full transition-all flex items-center justify-center ${
                                !isCameraOn
                                    ? "bg-red-500 hover:bg-red-600 text-white"
                                    : "bg-slate-700/80 hover:bg-slate-600 text-white"
                            }`}
                            title={isCameraOn ? "Turn off camera" : "Turn on camera"}
                        >
                            <span className="material-symbols-outlined text-[23px] leading-none">
                                {isCameraOn ? "videocam" : "videocam_off"}
                            </span>
                        </button>

                        {/* Push-to-Talk Toggle */}
                        {!isFallback && (
                            <div className="relative">
                                <button
                                    onClick={togglePushToTalk}
                                    className={`px-6 py-3 rounded-full transition-all flex items-center justify-center gap-2 ${
                                        pushToTalkEnabled
                                            ? "bg-violet-500 hover:bg-violet-600 text-white shadow-lg shadow-violet-500/30"
                                            : "bg-slate-700/80 hover:bg-slate-600 text-white"
                                    }`}
                                    title={pushToTalkEnabled ? "Disable push-to-talk (return to always-on mic)" : "Enable push-to-talk (hold spacebar to talk)"}
                                >
                                    <span className="material-symbols-outlined text-[23px] leading-none">touch_app</span>
                                </button>
                                {showPttHintTooltip && (
                                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-4 w-[200px] bg-indigo-600 text-white text-[12px] font-medium p-3 rounded-2xl shadow-2xl z-[100] text-center animate-in fade-in zoom-in slide-in-from-bottom-2 duration-300">
                                        <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-4 h-4 bg-indigo-600 rotate-45" />
                                        <span className="relative z-10">Try Push-to-Talk! Hold <span className="font-bold underline decoration-indigo-300 underline-offset-2">SPACE</span> to speak, release for AI to respond.</span>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Push-to-Talk Spacebar Indicator */}
                    {pushToTalkEnabled && (
                        <div className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold transition-all duration-200 ${
                            isHoldingSpace
                                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shadow-lg shadow-emerald-500/10"
                                : "bg-slate-800/60 text-slate-400 border border-slate-700/50"
                        }`}>
                            <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded text-[11px] font-bold tracking-wider uppercase ${
                                isHoldingSpace
                                    ? "bg-emerald-500/30 text-emerald-300"
                                    : "bg-slate-700/80 text-slate-500"
                            }`}>
                                SPACE
                            </span>
                            <span>{isHoldingSpace ? "Listening..." : "Hold to talk"}</span>
                            {isHoldingSpace && (
                                <span className="flex gap-0.5">
                                    <span className="w-1 h-3 bg-emerald-400 rounded-full animate-pulse" />
                                    <span className="w-1 h-3 bg-emerald-400 rounded-full animate-pulse" style={{ animationDelay: '0.15s' }} />
                                    <span className="w-1 h-3 bg-emerald-400 rounded-full animate-pulse" style={{ animationDelay: '0.3s' }} />
                                </span>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* RIGHT SIDE — Unified Transcript / Chat */}
            <div className="flex-1 flex flex-col bg-white dark:bg-lc-surface rounded-2xl shadow-sm border border-slate-200 dark:border-lc-border overflow-hidden min-h-0">
                <div className="px-5 py-4 border-b border-slate-100 dark:border-lc-border flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-sm text-primary">forum</span>
                        <span className="text-sm font-bold text-slate-800 dark:text-white">Interview Transcript</span>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4 custom-scrollbar">
                    {/* Unified messages (text + voice transcripts) */}
                    {messages.filter(msg => !msg.hidden).map((msg) => (
                        <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                            <div
                                className={`max-w-[85%] px-4 py-3 rounded-2xl text-[15px] leading-relaxed ${msg.role === "ai"
                                    ? "bg-[#F8FAFC] dark:bg-lc-bg border border-slate-100 dark:border-lc-border text-slate-700 dark:text-[#ccc] rounded-tl-sm"
                                    : "bg-primary text-white rounded-tr-sm"
                                    }`}
                            >
                                {msg.role === "ai" && (
                                    <span className="text-[10px] font-bold text-blue-500 block mb-1">INTERVIEWER</span>
                                )}
                                {msg.text}
                            </div>
                        </div>
                    ))}
                    <div ref={chatEndRef} />
                </div>

                {/* Text input (Always show in fallback, or optionally when typing while listening) */}
                <div className="px-4 py-3 border-t border-slate-100 dark:border-lc-border">
                    <div className="relative border border-slate-200 dark:border-lc-border rounded-xl overflow-hidden focus-within:border-primary focus-within:ring-1 focus-within:ring-primary transition-all bg-white dark:bg-lc-bg">
                        <input
                            type="text"
                            placeholder={isFallback ? "Type a response..." : "Type to chat alongside voice..."}
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleSend()}
                            disabled={!connected}
                            className="w-full text-[13px] p-3 pr-10 outline-none text-slate-700 dark:text-[#eff1f6] bg-transparent font-medium dark:placeholder:text-[#6b6b6b] disabled:opacity-50"
                        />
                        <button
                            onClick={handleSend}
                            disabled={!connected}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-primary hover:bg-primary/10 p-1.5 rounded-md cursor-pointer transition-colors disabled:opacity-50"
                        >
                            <span className="material-symbols-outlined text-[18px]">send</span>
                        </button>
                    </div>
                </div>
            </div>
        </main>
    );
}

/* ============================================================
   PHASE 2: Coding / IDE / SQL / Scratchpad
   ============================================================ */
function CodingPhase({
    sessionId,
    isDark,
    currentStage,
    interviewType,
    interviewRemaining,
    dsaElapsed,
    DSA_TIME_LIMIT,
    panelType,
    panelData,
    messages,
    connected,
    isVoiceActive,
    isAISpeaking,
    connectionState,
    sendMessage,
    sendVoiceText,
    sendSilentMessage,
    sendSilentVoiceText,
    sendCodeSnapshot,
    sendCanvasSnapshot,
    runCode,
    submitCode,
    stopAudio,
    isMuted,
    isCameraOn,
    toggleMute,
    toggleCamera,
    videoRef,
    onCloseScratchpad,
    pushToTalkEnabled,
    isHoldingSpace,
    togglePushToTalk,
}: {
    sessionId: string;
    isDark: boolean;
    currentStage: string;
    interviewType: string;
    interviewRemaining: number;
    dsaElapsed: number;
    DSA_TIME_LIMIT: number;
    panelType: string;
    panelData: any;
    messages: { id: string; role: string; text: string; isStreaming?: boolean; hidden?: boolean }[];
    connected: boolean;
    isVoiceActive: boolean;
    isAISpeaking: boolean;
    connectionState: string;
    sendMessage: (msg: string) => void;
    sendVoiceText: (msg: string) => void;
    sendSilentMessage: (msg: string) => void;
    sendSilentVoiceText: (msg: string) => void;
    sendCodeSnapshot: (code: string, language: string) => void;
    sendCanvasSnapshot: (elements: any[]) => void;
    runCode: (code: string, language: string, questionId: string) => void;
    submitCode: (code: string, language: string, questionId: string) => void;
    stopAudio: () => void;
    isMuted: boolean;
    isCameraOn: boolean;
    toggleMute: () => void;
    toggleCamera: () => void;
    videoRef: React.RefObject<HTMLVideoElement | null>;
    onCloseScratchpad?: () => void;
    pushToTalkEnabled: boolean;
    isHoldingSpace: boolean;
    togglePushToTalk: () => void;
}) {
    const [fetchedQuestion, setFetchedQuestion] = useState<any>(null);
    const [isLoadingQuestion, setIsLoadingQuestion] = useState(false);
    const [isRunning, setIsRunning] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [localResults, setLocalResults] = useState<Record<string, any>>({});
    const [hiddenSummary, setHiddenSummary] = useState<{ total: number; passed: number } | null>(null);
    const [hiddenFirstFailed, setHiddenFirstFailed] = useState<{
        input: string;
        expectedOutput: string;
        actualOutput: string;
        status: string;
        time: string;
        memory: string;
        stderr?: string;
        compileOutput?: string;
    } | null>(null);
    const [executionError, setExecutionError] = useState<string | null>(null);

    // ── Collapsible left panel ─────────────────────────────────
    const [isLeftPanelOpen, setIsLeftPanelOpen] = useState(true);
    // ── Scratchpad brief toggle (question + interviewer guidance) ─────────────────
    const [isScratchpadBriefOpen, setIsScratchpadBriefOpen] = useState(true);

    // ── Resizable panel state ──────────────────────────────────
    const [leftWidth, setLeftWidth] = useState(280);
    const [testHeight, setTestHeight] = useState(280);
    const isResizingLeft = useRef(false);
    const isResizingTest = useRef(false);
    const containerRef = useRef<HTMLDivElement>(null);

    const MIN_LEFT_WIDTH = 260;
    const MAX_LEFT_WIDTH = 600;
    const MIN_TEST_HEIGHT = 140;
    const MAX_TEST_HEIGHT = 500;

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (isResizingLeft.current && containerRef.current) {
                const rect = containerRef.current.getBoundingClientRect();
                const newWidth = e.clientX - rect.left - 16; // account for padding
                setLeftWidth(Math.max(MIN_LEFT_WIDTH, Math.min(MAX_LEFT_WIDTH, newWidth)));
            }
            if (isResizingTest.current) {
                // Calculate from bottom of the center section
                const centerSection = document.getElementById('code-editor-section');
                if (centerSection) {
                    const rect = centerSection.getBoundingClientRect();
                    const newHeight = rect.bottom - e.clientY;
                    setTestHeight(Math.max(MIN_TEST_HEIGHT, Math.min(MAX_TEST_HEIGHT, newHeight)));
                }
            }
        };
        const handleMouseUp = () => {
            isResizingLeft.current = false;
            isResizingTest.current = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, []);

    // If fetchedQuestion exists (from manual fetch), prioritize it over the partial socket question
    const question = fetchedQuestion || panelData?.question;
    const executionQuestionType =
        question?.questionType ||
        panelData?.questionType ||
        (currentStage === "DS_CODING" ? "ds_coding" :
            currentStage === "GEN_AI_CODING" ? "genai_coding" :
                "dsa");
    const testCasesToDisplay = question?.visibleTestCases || panelData?.visibleTestCases || question?.sample_tests || question?.testCases || [];
    const latestAiMessage = [...messages].reverse().find((m) => m.role === "ai" && m.text?.trim());
    const scratchpadQuestionText =
        panelData?.question?.title ||
        (typeof panelData?.question === "string" && panelData.question.trim()) ||
        panelData?.topic ||
        "System design problem";
    const sanitizeSystemDesignBrief = (value: unknown) => {
        const raw = typeof value === "string" ? value.trim() : "";
        if (!raw) return "";
        const withoutHiddenSections = raw
            .split(/\*\*?\s*(?:Functional Requirements|Non-Functional Requirements|Scale|Constraints|Expected|Rubric)\s*:?\s*\*\*?/i)[0]
            .split(/#{1,4}\s*(?:Functional Requirements|Non-Functional Requirements|Scale|Constraints|Expected|Rubric)/i)[0]
            .trim();
        return withoutHiddenSections || `Design ${scratchpadQuestionText}.`;
    };
    const scratchpadProblemDescription =
        panelData?.candidateBrief ||
        sanitizeSystemDesignBrief(panelData?.question?.problemStatement) ||
        panelData?.description ||
        "Use the whiteboard to clarify requirements, sketch the architecture, and explain the trade-offs behind your design.";

    const cleanedProblemMd = stripEmbeddedExamplesAndConstraints(question?.problemMd);
    const constraintsList =
        typeof question?.constraints === "string"
            ? question.constraints.split("\n").map((c: string) => c.trim()).filter(Boolean)
            : Array.isArray(question?.constraints)
              ? question.constraints.map((c: string) => String(c).trim()).filter(Boolean)
              : [];

    const leftPanelTitle =
        panelType === "scratchpad"
            ? "System Design"
            : panelType === "sql"
              ? "SQL"
              : (question?.title || "Problem");
    
    const availableLanguages = Object.keys(question?.starterCode || question?.starter_code || panelData?.starterCode || {});
    const defaultLang = question?.language || panelData?.language || "cpp";
    const initialLang = availableLanguages.includes(defaultLang) ? defaultLang : (availableLanguages.length > 0 ? availableLanguages[0] : "cpp");

    const [language, setLanguage] = useState(initialLang);
    const [editorTheme, setEditorTheme] = useState<"vs-dark" | "light">(isDark ? "vs-dark" : "light");

    useEffect(() => {
        setEditorTheme(isDark ? "vs-dark" : "light");
    }, [isDark]);

    const [activeTestCase, setActiveTestCase] = useState<number>(0);
    const [code, setCode] = useState("");
    const [isLanguageMenuOpen, setIsLanguageMenuOpen] = useState(false);
    const [chatInput, setChatInput] = useState("");
    const chatEndRef = useRef<HTMLDivElement>(null);
    const latestCodeRef = useRef("");
    const latestLanguageRef = useRef(language);
    const languageMenuRef = useRef<HTMLDivElement | null>(null);
    const editorRef = useRef<any>(null);
    const addGenAICodingDebriefInstruction = (message: string) => (
        currentStage === "GEN_AI_CODING"
            ? `${message} [GenAI coding instruction: visible Run passing is not final. If this is a passing Run result, ask the candidate to Submit now so hidden cases are checked. Only after a passing Submit result should you ask the AI/tooling debrief. Verify ownership with code-specific follow-ups; do not accept self-report alone. If an ownership probe fails, ask one more code-specific or verification-focused probe before wrapping.]`
            : message
    );

    // ── Code Editor Persistence ────────────────────────────
    useEffect(() => {
        if (!sessionId) return;
        // Restore code from localStorage on mount
        const savedCode = localStorage.getItem(`practers_interview_${sessionId}_code`);
        const savedLanguage = localStorage.getItem(`practers_interview_${sessionId}_language`);
        if (savedCode) {
            setCode(savedCode);
            latestCodeRef.current = savedCode;
        }
        if (savedLanguage) {
            setLanguage(savedLanguage);
            latestLanguageRef.current = savedLanguage;
        }
    }, [sessionId]);

    // Save code to localStorage whenever it changes (debounced)
    useEffect(() => {
        if (!sessionId || !code) return;
        const timer = setTimeout(() => {
            localStorage.setItem(`practers_interview_${sessionId}_code`, code);
            localStorage.setItem(`practers_interview_${sessionId}_language`, language);
        }, 1000); // Debounce 1s to avoid excessive writes
        return () => clearTimeout(timer);
    }, [sessionId, code, language]);


    const isFallback = connectionState === 'fallback';
    const dsaRemaining = Math.max(0, DSA_TIME_LIMIT - dsaElapsed);
    const dsaTimerVisuals = getCountdownTimerVisuals(dsaRemaining);

    const handleSend = () => {
        if (!chatInput.trim()) return;
        const text = chatInput.trim();
        setChatInput("");
        // Piggyback the latest code snapshot on every query so the AI always
        // sees the current editor state when it responds — no 30s lag.
        const latestCode = latestCodeRef.current;
        if (latestCode.trim()) {
            sendCodeSnapshot(latestCode, latestLanguageRef.current);
        }
        if (isVoiceActive && !isFallback) {
            stopAudio();
            sendVoiceText(text);
            return;
        }
        sendMessage(text);
    };

    // Auto-fetch question if AI triggers IDE but doesn't pass a question (or passes one without test cases/starters)
    useEffect(() => {
        if (panelType === "ide" && !isLoadingQuestion && !fetchedQuestion) {
            // Only attempt to fetch by ID if AI provided a question with an ID but missing details
            if (panelData?.question && !panelData.question.testCases && !panelData.question.sample_tests && !panelData.question.visibleTestCases) {
                if (panelData.question.id) {
                    setIsLoadingQuestion(true);
                    createSupabaseBrowserClient().auth.getSession().then(({ data }) => {
                        const token = data.session?.access_token;
                        fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:3001"}/ide/question/${panelData.question.id}`, {
                            headers: token ? { 'Authorization': `Bearer ${token}` } : {}
                        })
                            .then(res => res.json())
                            .then(apiData => {
                                if (!apiData.error) {
                                    setFetchedQuestion({
                                        ...panelData.question,
                                        ...apiData,
                                        starterCode: apiData.starter_code || apiData.starterCode || panelData.question.starterCode,
                                        visibleTestCases: apiData.sample_tests || apiData.visibleTestCases || panelData.question.visibleTestCases,
                                        problemMd: apiData.statement || apiData.problemMd || panelData.question.problemMd
                                    });
                                }
                            })
                            .catch(console.error)
                            .finally(() => setIsLoadingQuestion(false));
                    });
                }
            }
        }
    }, [panelType, panelData, fetchedQuestion, isLoadingQuestion]);



    // FIX: Track question ID to only reset language when the QUESTION changes,
    // not on every render. Previously, `availableLanguages` (from Object.keys())
    // created a new array reference each render, causing this effect to fire
    // on every render and reset the user's language selection back to "cpp".
    // FIX: Track question ID from the server payload directly to detect true question transitions.
    // Ensure we reset stale state (e.g. overriding manual fetches) so the new question successfully renders.
    const lastQuestionIdRef = useRef<string | null>(null);
    const lastLoadedFingerprintRef = useRef<string | null>(null);

    useEffect(() => {
        // Track the server's incoming question ID, NOT the potentially stale local `question`
        const serverQuestionId = panelData?.question?.id;
        if (serverQuestionId && serverQuestionId !== lastQuestionIdRef.current) {
            lastQuestionIdRef.current = serverQuestionId;
            
            // Wipe out old state for the new question to force UI refresh
            setFetchedQuestion(null);
            setLocalResults({});
            setHiddenSummary(null);
            setHiddenFirstFailed(null);
            setExecutionError(null);
            
            // Clear saved code when new question loads (starter code will be loaded below)
            if (sessionId) {
                localStorage.removeItem(`practers_interview_${sessionId}_code`);
                localStorage.removeItem(`practers_interview_${sessionId}_language`);
            }
            
            // New question loaded — reset language to the question's default
            const starters = panelData?.question?.starterCode || panelData?.question?.starter_code || panelData?.starterCode;
            const langKeys = Object.keys(starters || {});
            const langCode = panelData?.question?.language || panelData?.language;
            if (langCode && langKeys.includes(langCode)) {
                setLanguage(langCode);
            } else if (langKeys.length > 0) {
                setLanguage(langKeys[0]);
            }
        }
    }, [panelData?.question?.id, panelData?.question?.starterCode, panelData?.question?.starter_code, panelData?.question?.language, panelData?.starterCode, panelData?.language, sessionId]);

    // Load starter code when language changes or when a new question arrives.
    // Uses a fingerprint ref to ensure we ONLY load the starter code when the
    // source of truth actually changes, preventing cursor jumps on re-renders.
    // Prioritizes saved code from localStorage over starter code.
    useEffect(() => {
        const starters = question?.starterCode || question?.starter_code || panelData?.starterCode;
        if (starters && starters[language] !== undefined) {
            const starterCode = starters[language];
            const qId = question?.id || panelData?.question?.id || 'none';
            const fingerprint = `${qId}-${language}`;

            if (fingerprint !== lastLoadedFingerprintRef.current) {
                lastLoadedFingerprintRef.current = fingerprint;
                
                // Check if we have saved code for this session
                const savedCode = sessionId ? localStorage.getItem(`practers_interview_${sessionId}_code`) : null;
                const savedLanguage = sessionId ? localStorage.getItem(`practers_interview_${sessionId}_language`) : null;
                
                // Use saved code if it exists and language matches, otherwise use starter code
                const newCode = (savedCode && savedLanguage === language) ? savedCode : starterCode;
                
                setCode(newCode);
                latestCodeRef.current = newCode;

                if (editorRef.current) {
                    const model = editorRef.current.getModel();
                    if (model && model.getValue() !== newCode) {
                        editorRef.current.setValue(newCode);
                    }
                }
            }
        }
    }, [language, question?.id, question?.starterCode, question?.starter_code, panelData?.starterCode, sessionId]);

    // Keep language ref in sync
    useEffect(() => {
        latestLanguageRef.current = language;
    }, [language]);

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    useEffect(() => {
        const handleOutsideClick = (event: MouseEvent) => {
            if (languageMenuRef.current && !languageMenuRef.current.contains(event.target as Node)) {
                setIsLanguageMenuOpen(false);
            }
        };

        document.addEventListener("mousedown", handleOutsideClick);
        return () => document.removeEventListener("mousedown", handleOutsideClick);
    }, []);

    // ── Helper: execute code against the backend ───────────────────
    const executeCode = async (mode: 'run' | 'submit') => {
        if (!question) return;
        if (testCasesToDisplay.length === 0 && mode === 'run') return;

        const isRun = mode === 'run';
        if (isRun) setIsRunning(true); else setIsSubmitting(true);
        setExecutionError(null);
        setHiddenSummary(null);
        setHiddenFirstFailed(null);

        // Show running state for all visible test cases
        const newResults: Record<string, any> = {};
        testCasesToDisplay.forEach((t: any, i: number) => {
            newResults[t.id || `case_${i}`] = { status: 'Running' };
        });
        setLocalResults(newResults);

        try {
            const { data: sessionData } = await createSupabaseBrowserClient().auth.getSession();
            const sessionToken = sessionData.session?.access_token;

            const endpoint = isRun ? '/ide/run' : '/ide/submit-interview';
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:3001"}${endpoint}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(sessionToken ? { 'Authorization': `Bearer ${sessionToken}` } : {})
                },
                body: JSON.stringify({
                    question_id: question.id,
                    questionType: executionQuestionType,
                    code,
                    language,
                    // FIX: Send Judge0 language_id so backend uses correct language
                    // instead of falling back to C++ (54)
                    language_id: LANGUAGE_MAP[language as keyof typeof LANGUAGE_MAP]?.judge0Id,
                })
            });

            const data = await res.json();

            // Handle errors (compilation errors, runtime errors, etc.)
            if (!data.success) {
                const errorMsg = data.compileOutput || data.error || 'Execution failed';
                setExecutionError(errorMsg);
                // Mark all tests as errored — store error in stderr so output box shows it
                const errorResults: Record<string, any> = {};
                testCasesToDisplay.forEach((t: any, i: number) => {
                    errorResults[t.id || `case_${i}`] = {
                        status: data.compileOutput ? 'Compilation Error' : 'Error',
                        passed: false,
                        stdout: null,
                        stderr: errorMsg,
                        compile_output: data.compileOutput || null,
                    };
                });
                setLocalResults(errorResults);
                // Notify AI of compilation/runtime error with MINIMAL information only (no code)
                if (question?.id) {
                    sendCodeSnapshot(latestCodeRef.current, latestLanguageRef.current);
                    const errorType = data.compileOutput ? 'CE' : 'RE';
                    const resultMsg = addGenAICodingDebriefInstruction(buildMinimalCodeResultMessage(
                        isRun,
                        0,
                        testCasesToDisplay.length,
                        0,
                        testCasesToDisplay.length,
                        latestLanguageRef.current,
                        errorMsg,
                        errorType
                    ));
                    if (isVoiceActive && !isFallback) {
                        sendSilentVoiceText(resultMsg);
                    } else {
                        sendSilentMessage(resultMsg);
                    }
                }
                return;
            }

            // Map sample test results from the structured response
            if (data.sample?.tests) {
                const normalizeMetric = (value: unknown, suffix: string): string | null => {
                    if (value === null || value === undefined) return null;
                    if (typeof value === "number") {
                        return Number.isFinite(value) ? value.toString() : null;
                    }
                    if (typeof value === "string") {
                        const cleaned = value.replace(suffix, "").trim();
                        if (!cleaned || cleaned.toLowerCase() === "n/a") return null;
                        return cleaned;
                    }
                    return null;
                };
                const mappedResults: Record<string, any> = {};
                data.sample.tests.forEach((test: any, idx: number) => {
                    const tc = testCasesToDisplay[idx];
                    const testId = tc?.id || `case_${idx}`;
                    mappedResults[testId] = {
                        status: test.status,
                        passed: test.passed,
                        stdout: test.actualOutput,
                        stderr: test.stderr || null,
                        compile_output: test.compileOutput || null,
                        time: normalizeMetric(test.time ?? test.executionTime, "s"),
                        memory: normalizeMetric(test.memory, "KB"),
                    };
                });
                setLocalResults(mappedResults);
            }

            // Handle hidden test summary (only on submit)
            if (data.hidden?.summary) {
                setHiddenSummary(data.hidden.summary);
            }
            setHiddenFirstFailed(data.hidden?.firstFailed || null);

            // Notify the AI interviewer — silently (not shown in transcript)
            if (question?.id) {
                sendCodeSnapshot(latestCodeRef.current, latestLanguageRef.current);

                const sampleTests: any[] = data.sample?.tests || [];
                const samplePassed = data.sample?.summary?.passed ?? sampleTests.filter((t: any) => t.passed).length;
                const sampleTotal = data.sample?.summary?.total ?? sampleTests.length;
                const hiddenPassed = data.hidden?.summary?.passed || 0;
                const hiddenTotal = data.hidden?.summary?.total || 0;
                const totalPassed = samplePassed + hiddenPassed;
                const totalTests = sampleTotal + hiddenTotal;

                // Send MINIMAL information to AI (just test results, no code, no analysis)
                const resultMsg = addGenAICodingDebriefInstruction(buildMinimalCodeResultMessage(
                    isRun,
                    samplePassed,
                    sampleTotal,
                    totalPassed,
                    totalTests,
                    latestLanguageRef.current
                ));

                if (isVoiceActive && !isFallback) {
                    sendSilentVoiceText(resultMsg);
                } else {
                    sendSilentMessage(resultMsg);
                }
            }
        } catch (err: any) {
            console.error('[IDE] Code execution error:', err);
            const errMsg = err.message || 'Failed to execute code';
            setExecutionError(errMsg);
            const errorResults: Record<string, any> = {};
            testCasesToDisplay.forEach((t: any, i: number) => {
                errorResults[t.id || `case_${i}`] = {
                    status: 'Error',
                    passed: false,
                    stdout: null,
                    stderr: errMsg,
                };
            });
            setLocalResults(errorResults);

            // Notify AI of the error with MINIMAL information only (no code, no details)
            if (question?.id) {
                sendCodeSnapshot(latestCodeRef.current, latestLanguageRef.current);
                const resultMsg = addGenAICodingDebriefInstruction(buildMinimalCodeResultMessage(
                    isRun,
                    0,
                    testCasesToDisplay.length,
                    0,
                    testCasesToDisplay.length,
                    latestLanguageRef.current,
                    errMsg,
                    'RE'
                ));
                if (isVoiceActive && !isFallback) {
                    sendSilentVoiceText(resultMsg);
                } else {
                    sendSilentMessage(resultMsg);
                }
            }
        } finally {
            if (isRun) setIsRunning(false); else setIsSubmitting(false);
        }
    };

    const handleRun = () => executeCode('run');
    const handleSubmit = () => executeCode('submit');

    return (
        <main ref={containerRef} className="flex flex-1 w-full overflow-hidden p-4 bg-slate-50 dark:bg-lc-bg h-full">
            {/* Left Panel: Problem Description */}
            <aside style={{ width: leftWidth, minWidth: MIN_LEFT_WIDTH, maxWidth: MAX_LEFT_WIDTH }} className="bg-white dark:bg-lc-surface rounded-xl shadow-sm border border-slate-200 dark:border-lc-border flex flex-col shrink-0 overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100 dark:border-lc-border flex items-center bg-white dark:bg-lc-surface">
                    <h1 className="text-[22px] font-nunito font-bold text-slate-800 dark:text-white tracking-tight flex-1">
                        {leftPanelTitle}
                    </h1>
                    {/* Flag-only report button, pushed to the far right with spacing */}
                    <div className="ml-6 shrink-0">
                        <ReportQuestionModal
                            questionId={question?.id || panelData?.question?.id || panelData?.id || "unknown"}
                            questionType={
                                panelType === "scratchpad" ? "system_design" :
                                panelType === "sql" ? "sql" : "dsa"
                            }
                            questionTitle={question?.title || scratchpadQuestionText}
                            sessionId={undefined}
                            iconOnly
                            triggerClassName="flex items-center justify-center w-7 h-7 rounded-lg text-slate-300 hover:text-red-500 dark:text-slate-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors cursor-pointer"
                        />
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-6 custom-scrollbar text-[14px] text-[#475569] dark:text-[#ababab] leading-relaxed">
                    {cleanedProblemMd ? (
                        <div className="prose prose-sm dark:prose-invert max-w-none prose-p:break-words prose-li:break-words prose-pre:whitespace-pre-wrap prose-pre:break-words prose-code:break-words prose-pre:bg-slate-50 dark:prose-pre:bg-lc-bg prose-pre:border prose-pre:border-slate-200 dark:prose-pre:border-lc-border prose-pre:text-slate-800 dark:prose-pre:text-[#d4d4d4]">
                            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>{cleanedProblemMd}</ReactMarkdown>
                            
                            {question?.examples?.length > 0 && (
                                <div className="mt-8">
                                    <h3 className="text-[13px] font-bold uppercase tracking-wider text-slate-900 dark:text-white mb-4">Examples</h3>
                                    <div className="space-y-4">
                                      {question.examples.map((ex: any, i: number) => (
                                            <div key={i} className="mb-4">
                                                <div className="font-bold text-sm text-slate-900 dark:text-white mb-2">Example {i + 1}:</div>
                                                <div className="bg-[#F8FAFC] dark:bg-lc-bg rounded-lg p-4 font-mono text-[13px] text-slate-800 dark:text-[#d4d4d4] space-y-2">
                                                    <div className="overflow-x-auto whitespace-pre-wrap break-words min-w-0">
                                                        <span className="font-bold opacity-60 break-normal">Input:</span>{" "}
                                                        {typeof ex.input === 'object' ? JSON.stringify(ex.input) : ex.input}
                                                    </div>
                                                    <div className="overflow-x-auto whitespace-pre-wrap break-words min-w-0">
                                                        <span className="font-bold opacity-60 break-normal">Output:</span>{" "}
                                                        {typeof ex.output === 'object' ? JSON.stringify(ex.output) : ex.output}
                                                    </div>
                                                    {ex.explanation && (
                                                        <div className="mt-2 pt-2">
                                                            <span className="font-bold opacity-60">Explanation:</span> {ex.explanation}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {constraintsList.length > 0 && (
                                <div className="mt-8">
                                    <h3 className="text-[13px] font-bold uppercase tracking-wider text-slate-900 dark:text-white mb-4">Constraints</h3>
                                    <div className="max-w-full min-w-0 overflow-hidden rounded-lg bg-[#F8FAFC] p-4 dark:bg-lc-bg">
                                        <ul className="max-w-full min-w-0 list-disc space-y-1.5 overflow-hidden pl-4 font-mono text-[13px] text-slate-800 marker:text-slate-400 dark:text-[#d4d4d4]">
                                            {constraintsList.map((c: string, i: number) => (
                                                <li key={i} className="max-w-full min-w-0 whitespace-pre-wrap break-all [overflow-wrap:anywhere]">{c.replace('- ', '')}</li>
                                            ))}
                                        </ul>
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : panelType === "sql" ? (
                        <div>
                            <h3 className="text-xs font-bold uppercase text-slate-500 dark:text-slate-400 mb-2">Schema</h3>
                            <pre className="bg-slate-50 dark:bg-lc-bg p-3 rounded-lg text-xs font-mono overflow-x-auto border border-slate-200 dark:border-lc-border">{panelData?.schema}</pre>
                            <h3 className="text-xs font-bold uppercase text-slate-500 dark:text-slate-400 mt-4 mb-2">Question</h3>
                            <p className="text-slate-700 dark:text-[#ababab]">{panelData?.question}</p>
                        </div>
                    ) : panelType === "scratchpad" ? (
                        // Always-visible brief — no toggle, no label header
                        <div className="space-y-5">
                            <div>
                                <p className="text-[15px] font-bold text-slate-800 dark:text-white mb-1.5">Question</p>
                                <p className="text-[13px] leading-relaxed text-slate-700 dark:text-[#d4d4d4]">{scratchpadQuestionText}</p>
                            </div>
                            <div>
                                <p className="text-[15px] font-bold text-slate-800 dark:text-white mb-1.5">Problem Description</p>
                                <p className="text-[13px] leading-relaxed text-slate-600 dark:text-[#c2c2c2]">
                                    {scratchpadProblemDescription}
                                </p>
                            </div>
                            <div>
                                <p className="text-[15px] font-bold text-slate-800 dark:text-white mb-1.5">What to Do</p>
                                <p className="text-[13px] leading-relaxed text-slate-600 dark:text-[#c2c2c2]">
                                    Use the whiteboard to diagram your architecture, note assumptions, and outline data flows. Your interviewer can see everything in real-time.
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full text-slate-400">
                            <span className="material-symbols-outlined text-4xl mb-2 animate-pulse">hourglass_empty</span>
                            <p>Problem details will appear here.</p>
                        </div>
                    )}
                </div>
            </aside>

            {/* Horizontal Resize Handle (Question <-> IDE) */}
            <div
                className="w-2 shrink-0 cursor-col-resize flex items-center justify-center group hover:bg-primary/10 rounded transition-colors"
                onMouseDown={(e) => {
                    e.preventDefault();
                    isResizingLeft.current = true;
                    document.body.style.cursor = 'col-resize';
                    document.body.style.userSelect = 'none';
                }}
            >
                <div className="w-0.5 h-8 bg-slate-300 dark:bg-slate-600 rounded-full group-hover:bg-primary transition-colors" />
            </div>

            {/* Center Panel: Code Editor OR Scratchpad */}
            <section id="code-editor-section" className="flex-1 flex flex-col bg-white dark:bg-lc-surface rounded-xl shadow-sm border border-slate-200 dark:border-lc-border overflow-hidden">
                {panelType === "scratchpad" ? (
                    <ScratchpadPanel
                        isDark={isDark}
                        topic={panelData?.topic}
                        initialContent={panelData?.initialContent}
                        remainingSeconds={interviewRemaining}
                        onSceneChange={sendCanvasSnapshot}
                    />
                ) : (
                    <>
                {/* Toolbar */}
                <div className="flex items-center justify-between border-b border-slate-200 dark:border-lc-border bg-white dark:bg-lc-surface px-4 h-12">
                    <div className="flex items-center gap-2">
                        <span className="text-lg font-mono font-bold text-blue-500">&lt; &gt;</span>
                        <span className="text-sm font-bold text-slate-700 dark:text-white">Code</span>
                    </div>
                    <div className="flex items-center gap-4">
                        {/* DSA countdown — only show in IDE toolbar for full interviews (coding-only shows it in the main header) */}
                        {currentStage === "DSA" && interviewType !== "coding" && (
                            <div className={`flex items-center gap-1.5 ${dsaTimerVisuals.pulse ? "animate-pulse" : ""}`}>
                                <span
                                    className={`material-symbols-outlined text-[16px] ${dsaTimerVisuals.color ? "" : "text-slate-500 dark:text-slate-400"}`}
                                    style={dsaTimerVisuals.color ? { color: dsaTimerVisuals.color } : undefined}
                                >
                                    timer
                                </span>
                                <span
                                    className={`font-mono text-xs font-bold ${dsaTimerVisuals.color ? "" : "text-slate-700 dark:text-white"}`}
                                    style={dsaTimerVisuals.color ? { color: dsaTimerVisuals.color } : undefined}
                                >
                                    {formatTime(dsaRemaining)}
                                </span>
                            </div>
                        )}
                        <button
                            onClick={() => setEditorTheme(editorTheme === "vs-dark" ? "light" : "vs-dark")}
                            className="flex items-center justify-center text-slate-500 hover:text-slate-800 dark:text-[#ababab] dark:hover:text-white transition-colors"
                            title="Toggle Editor Theme"
                        >
                            <span className="material-symbols-outlined text-[18px]">
                                {editorTheme === "vs-dark" ? 'light_mode' : 'dark_mode'}
                            </span>
                        </button>
                        <button
                            onClick={() => {
                                const starters = question?.starterCode || question?.starter_code || panelData?.starterCode;
                                if (starters?.[language] !== undefined) {
                                    const starterCode = starters[language];
                                    setCode(starterCode);
                                    latestCodeRef.current = starterCode;
                                    // Update Monaco editor directly
                                    if (editorRef.current) {
                                        editorRef.current.setValue(starterCode);
                                    }
                                }
                            }}
                            className="flex items-center justify-center text-slate-500 hover:text-slate-800 dark:text-[#ababab] dark:hover:text-white transition-colors"
                            title="Reset Code to Starter"
                        >
                            <span className="material-symbols-outlined text-[18px]">restart_alt</span>
                        </button>
                        <div ref={languageMenuRef} className="relative">
                            <button
                                type="button"
                                onClick={() => setIsLanguageMenuOpen((prev) => !prev)}
                                className="flex items-center gap-2 rounded-xl bg-slate-50/90 dark:bg-lc-bg/90 px-3 py-1.5 text-[12px] font-bold text-slate-700 dark:text-white shadow-sm transition-all hover:shadow-md"
                                title="Select language"
                            >
                                <span>{LANGUAGE_MAP[language as keyof typeof LANGUAGE_MAP]?.label || language.toUpperCase()}</span>
                                <span className="material-symbols-outlined text-[16px] leading-none text-slate-500 dark:text-slate-300">
                                    {isLanguageMenuOpen ? "expand_less" : "expand_more"}
                                </span>
                            </button>

                            {isLanguageMenuOpen && (
                                <div className="absolute right-0 top-[calc(100%+0.5rem)] z-30 min-w-[180px] overflow-hidden rounded-2xl bg-white/95 dark:bg-lc-surface/95 backdrop-blur-md shadow-lg">
                                    {(availableLanguages.length > 0 ? availableLanguages : [initialLang]).map((lang) => {
                                        const isActive = lang === language;
                                        return (
                                            <button
                                                key={lang}
                                                type="button"
                                                onClick={() => {
                                                    setLanguage(lang);
                                                    setIsLanguageMenuOpen(false);
                                                }}
                                                className={`w-full px-4 py-2.5 text-left text-[12px] font-semibold transition-colors ${
                                                    isActive
                                                        ? "bg-primary/10 text-primary"
                                                        : "text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-lc-hover"
                                                }`}
                                            >
                                                {LANGUAGE_MAP[lang as keyof typeof LANGUAGE_MAP]?.label || lang.toUpperCase()}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
                {/* Code Editor */}
                <div className="flex-1 overflow-hidden relative">
                    <Editor
                        height="100%"
                        language={LANGUAGE_MAP[language as keyof typeof LANGUAGE_MAP]?.monacoId || language}
                        theme={editorTheme}
                        defaultValue={code}
                        onChange={(val) => {
                            const newCode = val || "";
                            // Update state immediately for React
                            setCode(newCode);
                            latestCodeRef.current = newCode;
                        }}
                        onMount={(editor) => {
                            editorRef.current = editor;
                        }}
                        options={{
                            minimap: { enabled: false },
                            fontSize: 14,
                            lineHeight: 24,
                            padding: { top: 16 },
                            scrollBeyondLastLine: false,
                            fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
                            automaticLayout: true,
                        }}
                        loading={
                            <div className="flex items-center justify-center h-full text-slate-400">
                                <span className="material-symbols-outlined animate-spin text-2xl">sync</span>
                            </div>
                        }
                    />
                </div>
                {/* Vertical Resize Handle (IDE <-> Test Cases) */}
                <div
                    className="h-2 shrink-0 cursor-row-resize flex items-center justify-center group hover:bg-primary/10 transition-colors"
                    onMouseDown={(e) => {
                        e.preventDefault();
                        isResizingTest.current = true;
                        document.body.style.cursor = 'row-resize';
                        document.body.style.userSelect = 'none';
                    }}
                >
                    <div className="h-0.5 w-8 bg-slate-300 dark:bg-slate-600 rounded-full group-hover:bg-primary transition-colors" />
                </div>

                {/* Lower Panel: Test Cases & Results */}
                <div style={{ height: testHeight, minHeight: MIN_TEST_HEIGHT, maxHeight: MAX_TEST_HEIGHT }} className="border-t border-slate-200 dark:border-lc-border bg-white dark:bg-lc-surface flex flex-col shrink-0">
                    {/* Header */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-lc-border">
                        <div className="flex items-center gap-2">
                            <span className="material-symbols-outlined text-[18px] text-slate-500 dark:text-slate-400">terminal</span>
                            <span className="text-[13px] font-bold text-slate-700 dark:text-white uppercase tracking-wider">Test Results</span>
                        </div>
                        <div className="flex gap-3">
                            <button
                                onClick={handleRun}
                                disabled={isRunning || isSubmitting || testCasesToDisplay.length === 0}
                                className={`flex items-center gap-1.5 px-3 py-1.5 border border-slate-300 dark:border-lc-border rounded-lg text-sm font-bold shadow-sm transition-colors ${(isRunning || isSubmitting) ? "opacity-50 cursor-not-allowed bg-slate-100 text-slate-400" : "text-slate-700 dark:text-[#eff1f6] bg-white dark:bg-lc-surface hover:bg-slate-50 dark:hover:bg-lc-hover cursor-pointer"}`}
                            >
                                <span className="material-symbols-outlined text-[18px]">{isRunning ? 'sync' : 'play_arrow'}</span>
                                {isRunning ? "Running..." : "Run Tests"}
                            </button>
                            <button
                                onClick={handleSubmit}
                                disabled={isRunning || isSubmitting}
                                className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-bold transition-colors shadow-sm ${(isRunning || isSubmitting) ? "opacity-50 cursor-not-allowed bg-emerald-400 text-white" : "bg-[#10b981] hover:bg-[#059669] text-white cursor-pointer"}`}
                            >
                                <span className="material-symbols-outlined text-[18px]">{isSubmitting ? 'sync' : 'cloud_upload'}</span>
                                {isSubmitting ? "Submitting..." : "Submit"}
                            </button>
                        </div>
                    </div>

                    {/* Content */}
                    <div className="flex-1 flex flex-col p-4 bg-white dark:bg-lc-surface overflow-auto min-h-0">
                        {/* Compilation / Execution Error Banner removed so it only comes in the output box */}

                        {/* Hidden Test Summary Banner (shown after submit) */}
                        {hiddenSummary && (
                            <div className="mb-3 space-y-2">
                                <div className={`p-3 rounded-lg text-[13px] font-bold flex items-center justify-between ${
                                    hiddenSummary.passed === hiddenSummary.total
                                        ? 'bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/30 text-green-700 dark:text-green-400'
                                        : 'bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 text-amber-700 dark:text-amber-400'
                                }`}>
                                    <div className="flex items-center gap-2">
                                        <span className="material-symbols-outlined text-[18px]">
                                            {hiddenSummary.passed === hiddenSummary.total ? 'verified' : 'warning'}
                                        </span>
                                        <span>
                                            {hiddenSummary.passed === hiddenSummary.total
                                                ? "All test cases passed!"
                                                : "Some test cases failed"}
                                        </span>
                                    </div>
                                    <span className="text-[11px] opacity-70 font-normal">
                                        {hiddenSummary.passed === hiddenSummary.total
                                            ? "All checks completed successfully"
                                            : "Please review your solution and try again"}
                                    </span>
                                </div>

                                {hiddenFirstFailed && (
                                    <div className="rounded-lg border border-red-200 dark:border-red-500/30 bg-red-50/70 dark:bg-red-500/10 p-3">
                                        <div className="flex items-center justify-between gap-3 mb-2">
                                            <div className="text-[12px] font-bold uppercase tracking-wider text-red-700 dark:text-red-300">
                                                First Failed Hidden Test
                                            </div>
                                            <div className="text-[11px] text-red-700/80 dark:text-red-300/80 font-semibold">
                                                {hiddenFirstFailed.status}
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-1 gap-2 text-[12px]">
                                            <div>
                                                <div className="text-[10px] uppercase tracking-wider font-semibold text-red-700/80 dark:text-red-300/80 mb-1">Input</div>
                                                <pre className="bg-white/80 dark:bg-[#1e1e1e] border border-red-200/70 dark:border-red-500/20 rounded p-2 whitespace-pre-wrap break-all font-mono text-slate-800 dark:text-[#d4d4d4]">{hiddenFirstFailed.input}</pre>
                                            </div>
                                            <div>
                                                <div className="text-[10px] uppercase tracking-wider font-semibold text-red-700/80 dark:text-red-300/80 mb-1">Expected</div>
                                                <pre className="bg-white/80 dark:bg-[#1e1e1e] border border-red-200/70 dark:border-red-500/20 rounded p-2 whitespace-pre-wrap break-all font-mono text-slate-800 dark:text-[#d4d4d4]">{hiddenFirstFailed.expectedOutput}</pre>
                                            </div>
                                            <div>
                                                <div className="text-[10px] uppercase tracking-wider font-semibold text-red-700/80 dark:text-red-300/80 mb-1">Output</div>
                                                <pre className="bg-white/80 dark:bg-[#1e1e1e] border border-red-200/70 dark:border-red-500/20 rounded p-2 whitespace-pre-wrap break-all font-mono text-slate-800 dark:text-[#d4d4d4]">{hiddenFirstFailed.actualOutput || hiddenFirstFailed.stderr || hiddenFirstFailed.compileOutput || '(no output)'}</pre>
                                            </div>
                                        </div>
                                        <div className="mt-2 text-[11px] text-red-700/80 dark:text-red-300/80 font-medium">
                                            Time: {hiddenFirstFailed.time} | Memory: {hiddenFirstFailed.memory}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {testCasesToDisplay.length > 0 ? (
                            <div className="h-full flex flex-col gap-4 min-h-0">
                                {/* Case Tabs */}
                                <div className="flex gap-6 border-b border-slate-100 dark:border-lc-border px-2">
                                    {testCasesToDisplay.map((tc: any, idx: number) => {
                                        const tId = tc.id || `case_${idx}`;
                                        const res = localResults[tId];
                                        let dotColor = "bg-slate-300 dark:bg-slate-600";
                                        if (res) {
                                            if (res.status === 'Running') dotColor = "bg-blue-400 animate-pulse";
                                            else if (res.passed) dotColor = "bg-green-500";
                                            else dotColor = "bg-red-500";
                                        }

                                        return (
                                            <button
                                                key={idx}
                                                onClick={() => setActiveTestCase(idx)}
                                                className={`pb-3 text-[13px] font-bold border-b-2 transition-colors relative top-[1px] flex items-center gap-1.5 ${activeTestCase === idx
                                                        ? "text-orange-500 border-orange-500"
                                                        : "text-slate-500 border-transparent hover:text-slate-700 dark:hover:text-slate-300"
                                                    }`}
                                            >
                                                <span className={`size-2 rounded-full ${dotColor}`}></span>
                                                Case {idx + 1}
                                            </button>
                                        );
                                    })}
                                </div>
                                
                                {/* Values Grid */}
                                <div className="flex flex-col gap-6 flex-1 text-[13px] overflow-y-auto pr-2 custom-scrollbar pb-4">
                                    {/* Input Section */}
                                    <div className="flex flex-col gap-2">
                                        <div className="font-bold text-[11px] uppercase tracking-wider text-slate-500">Input</div>
                                        <div className="bg-slate-50 dark:bg-[#1e1e1e] rounded-lg p-3 font-mono text-slate-800 dark:text-[#d4d4d4] whitespace-pre-wrap break-all">
                                            {typeof (testCasesToDisplay[activeTestCase]?.input || testCasesToDisplay[activeTestCase]?.stdin) === 'object' 
                                                ? JSON.stringify(testCasesToDisplay[activeTestCase]?.input || testCasesToDisplay[activeTestCase]?.stdin, null, 2)
                                                : (testCasesToDisplay[activeTestCase]?.input || testCasesToDisplay[activeTestCase]?.stdin)
                                            }
                                        </div>
                                    </div>
                                    
                                    {/* Output Section (Only shown if executed) */}
                                    {(() => {
                                        const tc = testCasesToDisplay[activeTestCase];
                                        const res = localResults[tc?.id || `case_${activeTestCase}`];
                                        if (!res || res.status === 'Pending') return null;
                                        return (
                                            <div className="flex flex-col gap-2 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <div className="font-bold text-[11px] uppercase tracking-wider text-slate-500">Output</div>
                                                    <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold truncate ${res.status === 'Running' ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400' : res.passed ? 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400' : 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400'}`}>
                                                        {res.status}
                                                    </span>
                                                </div>
                                                {res.status !== 'Running' && (
                                                    <div className={`rounded-lg p-3 font-mono whitespace-pre-wrap text-[12px] break-all ${res.passed ? "bg-green-50/50 dark:bg-green-500/5 text-green-700 dark:text-green-400" : "bg-red-50/50 dark:bg-red-500/5 text-red-700 dark:text-red-400"}`}>
                                                        {res.stdout || res.stderr || res.compile_output || (res.passed ? "✓ Correct" : "No Output")}
                                                        {(res.time || res.memory) && (
                                                            <div className="mt-2 pt-2 border-t border-current/10 text-[11px] opacity-70 flex gap-3">
                                                                {res.time && <span>⏱ {res.time}s</span>}
                                                                {res.memory && <span>💾 {res.memory}KB</span>}
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                                {res.status === 'Running' && (
                                                    <div className="bg-slate-50 dark:bg-[#1e1e1e] rounded-lg p-3 font-mono text-slate-400 italic text-[12px]">
                                                        Running...
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })()}
                                    
                                    {/* Expected Section */}
                                    <div className="flex flex-col gap-2">
                                        <div className="font-bold text-[11px] uppercase tracking-wider text-slate-500">Expected</div>
                                        <div className="bg-slate-50 dark:bg-[#1e1e1e] rounded-lg p-3 font-mono text-slate-800 dark:text-[#d4d4d4] whitespace-pre-wrap break-all">
                                            {typeof (testCasesToDisplay[activeTestCase]?.expected || testCasesToDisplay[activeTestCase]?.expected_output) === 'object'
                                                ? JSON.stringify(testCasesToDisplay[activeTestCase]?.expected || testCasesToDisplay[activeTestCase]?.expected_output, null, 2)
                                                : (testCasesToDisplay[activeTestCase]?.expected || testCasesToDisplay[activeTestCase]?.expected_output)
                                            }
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="h-full flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 text-[13px]">
                                <span className="material-symbols-outlined text-3xl mb-2 opacity-50">data_object</span>
                                <p>No test cases available</p>
                            </div>
                        )}
                    </div>
                </div>
                </>
                )}
            </section>

            <div className="w-4 shrink-0" />

            {/* Right Panel: Camera + Chat */}
            <div className="w-[300px] flex flex-col gap-4 shrink-0">
                {/* Camera Window — fix 9: proper camera-off placeholder */}
                <div className="bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-lc-border overflow-hidden relative" style={{ height: '160px' }}>
                    {/* Video element (real camera feed) */}
                    <video
                        ref={videoRef}
                        autoPlay
                        muted
                        playsInline
                        className={`absolute inset-0 w-full h-full object-cover ${isCameraOn ? 'block' : 'hidden'}`}
                        style={{ transform: 'scaleX(-1)' }}
                    />
                    {/* Fix 9: Avatar placeholder when camera is off */}
                    {!isCameraOn && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-900">
                            <div className="w-12 h-12 rounded-full bg-slate-700 flex items-center justify-center">
                                <span className="material-symbols-outlined text-[24px] text-slate-400">person</span>
                            </div>
                            <span className="text-[11px] font-medium text-slate-500 tracking-wide">Camera off</span>
                        </div>
                    )}
                    {/* Camera/Mic Controls */}
                    <div className="absolute bottom-2.5 left-1/2 -translate-x-1/2 flex items-center gap-3">
                        {!pushToTalkEnabled && (
                            <button
                                onClick={toggleMute}
                                className={`px-3 py-1 rounded-full transition-all flex items-center justify-center ${isMuted
                                    ? "bg-red-500 hover:bg-red-600 text-white"
                                    : "bg-slate-700/80 hover:bg-slate-600 text-white"
                                }`}
                                title={isMuted ? "Unmute" : "Mute"}
                            >
                                <span className="material-symbols-outlined text-[14px] leading-none">
                                    {isMuted ? "mic_off" : "mic"}
                                </span>
                            </button>
                        )}
                        <button
                            onClick={toggleCamera}
                            className={`px-3 py-1 rounded-full transition-all flex items-center justify-center ${!isCameraOn
                                ? "bg-red-500 hover:bg-red-600 text-white"
                                : "bg-slate-700/80 hover:bg-slate-600 text-white"
                            }`}
                            title={isCameraOn ? "Turn off camera" : "Turn on camera"}
                        >
                            <span className="material-symbols-outlined text-[14px] leading-none">
                                {isCameraOn ? "videocam" : "videocam_off"}
                            </span>
                        </button>
                        <button
                            onClick={togglePushToTalk}
                            className={`px-3 py-1 rounded-full transition-all flex items-center justify-center ${
                                pushToTalkEnabled
                                    ? "bg-violet-500 hover:bg-violet-600 text-white shadow-md shadow-violet-500/30"
                                    : "bg-slate-700/80 hover:bg-slate-600 text-white"
                            }`}
                            title={pushToTalkEnabled ? "Disable push-to-talk" : "Enable push-to-talk (hold spacebar to talk)"}
                        >
                            <span className="material-symbols-outlined text-[14px] leading-none">touch_app</span>
                        </button>
                    </div>
                    {/* Live indicator */}
                    {isCameraOn && (
                        <div className="absolute top-2 left-2 flex items-center gap-1">
                            <span className="size-1.5 bg-green-500 rounded-full animate-pulse" />
                            <span className="text-[8px] font-bold text-white/70 uppercase tracking-wider">Live</span>
                        </div>
                    )}
                    {/* PTT indicator overlay */}
                    {pushToTalkEnabled && (
                        <div className={`absolute top-2 right-2 flex items-center gap-1.5 px-2 py-1 rounded-full text-[9px] font-bold tracking-wider uppercase transition-all duration-200 ${
                            isHoldingSpace
                                ? "bg-emerald-500/30 text-emerald-300 border border-emerald-500/30"
                                : "bg-slate-800/70 text-slate-500 border border-slate-700/50"
                        }`}>
                            <span className="text-[8px]">SPACE</span>
                            {isHoldingSpace ? (
                                <span className="flex gap-0.5">
                                    <span className="w-0.5 h-2 bg-emerald-400 rounded-full animate-pulse" />
                                    <span className="w-0.5 h-2 bg-emerald-400 rounded-full animate-pulse" style={{ animationDelay: '0.15s' }} />
                                    <span className="w-0.5 h-2 bg-emerald-400 rounded-full animate-pulse" style={{ animationDelay: '0.3s' }} />
                                </span>
                            ) : (
                                <span className="text-[8px]">HOLD</span>
                            )}
                        </div>
                    )}
                </div>

                {/* Transcript Container — fix 10: timestamped message bubbles */}
                <aside className="flex-1 flex flex-col bg-white dark:bg-lc-surface rounded-xl shadow-sm border border-slate-200 dark:border-lc-border overflow-hidden min-h-0">
                    {/* Header */}
                    <div className="px-3 py-2.5 border-b border-slate-100 dark:border-lc-border flex items-center justify-between shrink-0">
                        <span className="text-[11px] font-bold tracking-wider uppercase text-slate-500">Transcript</span>
                        {messages.filter(m => !m.hidden).length > 0 && (
                            <span className="text-[10px] font-bold bg-slate-100 dark:bg-lc-bg text-slate-500 dark:text-slate-400 px-1.5 py-0.5 rounded-full">
                                {messages.filter(m => !m.hidden).length}
                            </span>
                        )}
                    </div>
                    {/* Messages — scrollable, timestamped, role-differentiated */}
                    <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar">
                        {messages.filter(msg => !msg.hidden).map((msg, idx) => {
                            const isAI = msg.role === "ai";
                            // Derive a simple HH:MM timestamp from position in list (messages have no timestamp field, so use index as a proxy offset)
                            const approxTs = new Date(Date.now() - (messages.filter(m => !m.hidden).length - 1 - idx) * 45000);
                            const timeLabel = approxTs.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                            return (
                                <div key={msg.id} className={`flex flex-col gap-0.5 ${isAI ? 'items-start' : 'items-end'}`}>
                                    <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 px-1">
                                        {isAI ? 'Interviewer' : 'You'} · {timeLabel}
                                    </span>
                                    <div className={`max-w-[90%] text-[13px] leading-relaxed px-3 py-2 ${
                                        isAI
                                            ? 'bg-slate-50 dark:bg-lc-bg border border-slate-100 dark:border-lc-border rounded-2xl rounded-tl-sm text-slate-700 dark:text-[#ccc]'
                                            : 'bg-primary text-white rounded-2xl rounded-tr-sm'
                                    }`}>
                                        {msg.text}
                                    </div>
                                </div>
                            );
                        })}
                        <div ref={chatEndRef} />
                    </div>
                    <div className="p-3 border-t border-slate-100 dark:border-lc-border shrink-0">
                        <div className="relative border border-slate-200 dark:border-lc-border rounded-lg overflow-hidden focus-within:border-primary focus-within:ring-1 focus-within:ring-primary transition-all bg-white dark:bg-lc-bg">
                            <input
                                type="text"
                                placeholder="Type a response..."
                                value={chatInput}
                                onChange={(e) => setChatInput(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" && chatInput.trim()) {
                                        handleSend();
                                    }
                                }}
                                className="w-full text-[13px] p-3 pr-10 outline-none text-slate-700 dark:text-[#eff1f6] bg-transparent font-medium dark:placeholder:text-[#6b6b6b]"
                            />
                            <button
                                onClick={handleSend}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-primary hover:bg-primary/10 p-1.5 rounded-md cursor-pointer"
                            >
                                <span className="material-symbols-outlined text-[18px]">send</span>
                            </button>
                        </div>
                    </div>
                </aside>
            </div>
        </main>
    );
}

/* ============================================================
   PHASE 3: SQL IDE — Monaco SQL Editor + Judge0 SQLite
   ============================================================ */
function SqlIdePhase({
    isDark,
    sqlElapsed,
    SQL_TIME_LIMIT,
    panelData,
    messages,
    connected,
    isVoiceActive,
    isAISpeaking,
    connectionState,
    sendMessage,
    sendVoiceText,
    sendSilentMessage,
    sendSilentVoiceText,
    sendCodeSnapshot,
    stopAudio,
    isMuted,
    isCameraOn,
    toggleMute,
    toggleCamera,
    videoRef,
    pushToTalkEnabled,
    isHoldingSpace,
    togglePushToTalk,
}: {
    isDark: boolean;
    sqlElapsed: number;
    SQL_TIME_LIMIT: number;
    panelData: any;
    messages: { id: string; role: string; text: string; isStreaming?: boolean; hidden?: boolean }[];
    connected: boolean;
    isVoiceActive: boolean;
    isAISpeaking: boolean;
    connectionState: string;
    sendMessage: (msg: string) => void;
    sendVoiceText: (msg: string) => void;
    sendSilentMessage: (msg: string) => void;
    sendSilentVoiceText: (msg: string) => void;
    sendCodeSnapshot: (code: string, language: string) => void;
    stopAudio: () => void;
    isMuted: boolean;
    isCameraOn: boolean;
    toggleMute: () => void;
    toggleCamera: () => void;
    videoRef: React.RefObject<HTMLVideoElement | null>;
    pushToTalkEnabled: boolean;
    isHoldingSpace: boolean;
    togglePushToTalk: () => void;
}) {
    const [sqlCode, setSqlCode] = useState("");
    const latestSqlRef = useRef("");
    const sqlEditorRef = useRef<any>(null);
    const lastSqlFingerprintRef = useRef<string | null>(null);
    const [editorTheme, setEditorTheme] = useState<"vs-dark" | "light">(isDark ? "vs-dark" : "light");

    useEffect(() => {
        setEditorTheme(isDark ? "vs-dark" : "light");
    }, [isDark]);

    const [isRunning, setIsRunning] = useState(false);
    const [testResults, setTestResults] = useState<{
        id: string;
        label: string;
        passed: boolean;
        actualOutput: string;
        expectedOutput: string;
        error?: string;
        time?: string;
        memory?: number;
    }[] | null>(null);
    const [chatInput, setChatInput] = useState("");
    const [activeTestCase, setActiveTestCase] = useState(0);
    const chatEndRef = useRef<HTMLDivElement>(null);

    const isFallback = connectionState === 'fallback';
    const sqlRemaining = Math.max(0, SQL_TIME_LIMIT - sqlElapsed);
    const sqlTimerVisuals = getCountdownTimerVisuals(sqlRemaining);

    // ── Resizable panels ──────────────────────────────────────────
    const [leftWidth, setLeftWidth] = useState(400);
    const [testHeight, setTestHeight] = useState(280);
    const isResizingLeft = useRef(false);
    const isResizingTest = useRef(false);
    const containerRef = useRef<HTMLDivElement>(null);

    const MIN_LEFT = 280; const MAX_LEFT = 650;
    const MIN_TEST = 140; const MAX_TEST = 500;

    useEffect(() => {
        const move = (e: MouseEvent) => {
            if (isResizingLeft.current && containerRef.current) {
                const rect = containerRef.current.getBoundingClientRect();
                setLeftWidth(Math.max(MIN_LEFT, Math.min(MAX_LEFT, e.clientX - rect.left - 16)));
            }
            if (isResizingTest.current) {
                const sec = document.getElementById('sql-editor-section');
                if (sec) {
                    const rect = sec.getBoundingClientRect();
                    setTestHeight(Math.max(MIN_TEST, Math.min(MAX_TEST, rect.bottom - e.clientY)));
                }
            }
        };
        const up = () => {
            isResizingLeft.current = false;
            isResizingTest.current = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
        return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    }, []);

    useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

    // ── SQL question data from panelData ────────────────────────────
    // SQL panel content is rendered directly from the server-provided DB question.
    // The interviewer can discuss it, but does not generate this title/body/schema.
    const sqlQuestion = panelData?.sqlQuestion || null;

    // Load starter code for SQL if provided
    useEffect(() => {
        const starter = sqlQuestion?.starterCode || sqlQuestion?.starter_code;
        if (starter) {
            const fingerprint = `${sqlQuestion?.id || 'none'}`;
            if (fingerprint !== lastSqlFingerprintRef.current) {
                lastSqlFingerprintRef.current = fingerprint;
                setSqlCode(starter);
                latestSqlRef.current = starter;
                if (sqlEditorRef.current) {
                    const model = sqlEditorRef.current.getModel();
                    if (model && model.getValue() !== starter) {
                        sqlEditorRef.current.setValue(starter);
                    }
                }
            }
        }
    }, [sqlQuestion?.id, sqlQuestion?.starterCode, sqlQuestion?.starter_code]);

    // ── Send chat ──────────────────────────────────────────────────
    const handleSend = () => {
        if (!chatInput.trim()) return;
        const text = chatInput.trim();
        setChatInput("");
        // Piggyback the latest SQL snapshot on every query so the AI always
        // sees what the candidate has written in the editor when it responds.
        const latestSql = latestSqlRef.current;
        if (latestSql.trim()) {
            sendCodeSnapshot(latestSql, "sql");
        }
        if (isVoiceActive && !isFallback) { stopAudio(); sendVoiceText(text); return; }
        sendMessage(text);
    };

    // ── Run SQL ────────────────────────────────────────────────────
    const handleRunSql = async () => {
        // Capture once so the same value is sent to the server, snapshotted
        // to the AI, and used for the guard — avoids state/ref divergence.
        const codeToRun = latestSqlRef.current;
        if (!codeToRun.trim()) return;
        setIsRunning(true);
        setTestResults(null);

        try {
            const { data: sessionData } = await createSupabaseBrowserClient().auth.getSession();
            const token = sessionData.session?.access_token;

            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:3001"}/ide/sql/run`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
                },
                body: JSON.stringify({ code: codeToRun, questionId: sqlQuestion?.id }),
            });

            const data = await res.json();
            setActiveTestCase(0); // Reset tab

            if (data.results) {
                setTestResults(data.results);
            } else {
                setTestResults([{
                    id: 'fallback',
                    label: 'Test Case',
                    passed: data.passed ?? false,
                    actualOutput: data.actualOutput || data.error || 'No output',
                    expectedOutput: data.expectedOutput || '',
                    error: data.error,
                    time: data.time,
                    memory: data.memory,
                }]);
            }

            // Notify AI about the result — sent silently (not shown in transcript)
            if (data.passed !== undefined) {
                sendCodeSnapshot(codeToRun, "sql");
                const firstResult = data.results?.[0];
                const hasError = !!(firstResult?.error || data.error);
                const errorText = firstResult?.error || data.error || "";
                const actualOut = firstResult?.actualOutput || data.actualOutput || "";
                const expectedOut = firstResult?.expectedOutput || data.expectedOutput || "";

                let resultMsg: string;
                if (data.passed) {
                    resultMsg = [
                        `[SQL Run Result]`,
                        `Query:\n${codeToRun}`,
                        `\nOutput:\n${actualOut || "(no output)"}`,
                        `\nResult: PASSED ✓`,
                    ].join("\n");
                } else if (hasError) {
                    resultMsg = [
                        `[SQL Run Result — EXECUTION ERROR]`,
                        `The candidate's query was executed and produced an error. Do NOT ask them to run it again — it was already run.`,
                        `Query:\n${codeToRun}`,
                        `\nError:\n${errorText}`,
                        `\nResult: ERROR (query failed to execute)`,
                    ].join("\n");
                } else {
                    resultMsg = [
                        `[SQL Run Result]`,
                        `Query:\n${codeToRun}`,
                        `\nActual Output:\n${actualOut || "(no output)"}`,
                        `\nExpected Output:\n${expectedOut || "(none)"}`,
                        `\nResult: FAILED ✗ (wrong answer)`,
                    ].join("\n");
                }
                if (isVoiceActive && !isFallback) { sendSilentVoiceText(ensureVoiceTextPayloadLimit(resultMsg)); } else { sendSilentMessage(resultMsg); }
            }
        } catch (err: any) {
            const errMsg = err.message || 'Execution failed';
            setActiveTestCase(0);
            setTestResults([{
                id: 'err',
                label: 'Execution Error',
                passed: false,
                actualOutput: errMsg,
                expectedOutput: '',
                error: errMsg,
            }]);
            sendCodeSnapshot(codeToRun, "sql");
            const resultMsg = [
                `[SQL Run Result — EXECUTION ERROR]`,
                `The candidate's query was executed and produced an error. Do NOT ask them to run it again — it was already run.`,
                `Query:\n${codeToRun}`,
                `\nError:\n${errMsg}`,
                `\nResult: ERROR (query failed to execute)`,
            ].join("\n");
            if (isVoiceActive && !isFallback) { sendSilentVoiceText(ensureVoiceTextPayloadLimit(resultMsg)); } else { sendSilentMessage(resultMsg); }
        } finally {
            setIsRunning(false);
        }
    };

    return (
        <main ref={containerRef} className="flex flex-1 w-full overflow-hidden p-4 bg-slate-50 dark:bg-lc-bg h-full">
            {/* Left Panel: SQL Question */}
            <aside style={{ width: leftWidth, minWidth: MIN_LEFT, maxWidth: MAX_LEFT }} className="bg-white dark:bg-lc-surface rounded-xl shadow-sm border border-slate-200 dark:border-lc-border flex flex-col shrink-0 overflow-hidden">
                <div className="p-6 border-b border-slate-100 dark:border-lc-border flex items-center justify-between bg-white dark:bg-lc-surface">
                    <div className="flex items-center gap-3">
                        <span className="material-symbols-outlined text-[22px] text-blue-500">database</span>
                        <h1 className="text-[22px] font-nunito font-bold text-slate-800 dark:text-white tracking-tight">
                            {sqlQuestion?.title || "SQL Question"}
                        </h1>
                    </div>
                    <ReportQuestionModal
                        questionId={sqlQuestion?.id || "unknown"}
                        questionType="sql"
                        questionTitle={sqlQuestion?.title}
                    />
                </div>

                <div className="flex-1 overflow-y-auto p-6 custom-scrollbar text-[14px] text-[#475569] dark:text-[#ababab] leading-relaxed">
                    {/* Description */}
                    {sqlQuestion?.description && (
                        <div className="prose prose-sm dark:prose-invert max-w-none mb-6">
                            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>{sqlQuestion.description}</ReactMarkdown>
                        </div>
                    )}

                    {/* Schema */}
                    {sqlQuestion?.schema && (
                        <div className="mb-6">
                            <h3 className="text-[13px] font-bold uppercase tracking-wider text-slate-900 dark:text-white mb-3">Schema</h3>
                            <div className="prose prose-sm dark:prose-invert max-w-none prose-table:text-[12px]">
                                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>{sqlQuestion.schema}</ReactMarkdown>
                            </div>
                        </div>
                    )}

                    {/* Examples */}
                    {sqlQuestion?.examples?.length > 0 && (
                        <div className="mb-6">
                            <h3 className="text-[13px] font-bold uppercase tracking-wider text-slate-900 dark:text-white mb-4">Examples</h3>
                            {sqlQuestion.examples.map((ex: any, i: number) => (
                                <div key={i} className="mb-4">
                                    <div className="font-bold text-sm text-slate-900 dark:text-white mb-2">Example {i + 1}:</div>
                                    <div className="bg-[#F8FAFC] dark:bg-lc-bg border border-slate-200 dark:border-lc-border rounded-lg p-4 font-mono text-[12px] text-slate-800 dark:text-[#d4d4d4] space-y-4">
                                        
                                        {/* Input Tables */}
                                        <div>
                                            <span className="font-bold opacity-60 block mb-2">Input:</span>
                                            {Object.entries(ex.input || {}).map(([tableName, rows]: [string, any]) => (
                                                <div key={tableName} className="mb-3 last:mb-0">
                                                    <div className="font-mono text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">{tableName} table:</div>
                                                    <div className="overflow-x-auto custom-scrollbar rounded border border-slate-200 dark:border-lc-border">
                                                        <table className="w-full text-left text-[11px] font-mono whitespace-nowrap border-collapse bg-white dark:bg-[#1e1e1e]">
                                                            <thead>
                                                                <tr className="border-b border-slate-200 dark:border-lc-border bg-slate-50 dark:bg-[#252526]">
                                                                    {rows?.[0] && Object.keys(rows[0]).map(key => (
                                                                        <th key={key} className="py-1 px-2 font-bold text-slate-600 dark:text-slate-400">{key}</th>
                                                                    ))}
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {(rows || []).map((row: any, rowIndex: number) => (
                                                                    <tr key={rowIndex} className="border-b border-slate-100 dark:border-lc-border/50 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                                                        {Object.values(row).map((val: any, colIndex: number) => (
                                                                            <td key={colIndex} className="py-1 px-2 text-slate-800 dark:text-[#d4d4d4]">{String(val)}</td>
                                                                        ))}
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>

                                        {/* Output Table */}
                                        <div>
                                            <span className="font-bold opacity-60 block mb-2">Output:</span>
                                            {ex.output?.length > 0 ? (
                                                <div className="overflow-x-auto custom-scrollbar rounded border border-slate-200 dark:border-lc-border">
                                                    <table className="w-full text-left text-[11px] font-mono whitespace-nowrap border-collapse bg-white dark:bg-[#1e1e1e]">
                                                        <thead>
                                                            <tr className="border-b border-slate-200 dark:border-lc-border bg-slate-50 dark:bg-[#252526]">
                                                                {Object.keys(ex.output[0]).map(key => (
                                                                    <th key={key} className="py-1 px-2 font-bold text-slate-600 dark:text-slate-400">{key}</th>
                                                                ))}
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {ex.output.map((row: any, rowIndex: number) => (
                                                                <tr key={rowIndex} className="border-b border-slate-100 dark:border-lc-border/50 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                                                    {Object.values(row).map((val: any, colIndex: number) => (
                                                                        <td key={colIndex} className="py-1 px-2 text-slate-800 dark:text-[#d4d4d4]">{String(val)}</td>
                                                                    ))}
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            ) : (
                                                <div className="text-slate-500 italic text-[11px]">No output rows</div>
                                            )}
                                        </div>
                                        
                                        {/* Explanation */}
                                        {ex.explanation && (
                                            <div className="mt-4 pt-3 border-t border-slate-200 dark:border-lc-border/50">
                                                <span className="font-bold opacity-60 block mb-1">Explanation:</span>
                                                <div className="text-[12px] leading-relaxed whitespace-pre-wrap font-sans">{ex.explanation}</div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </aside>

            {/* Horizontal Resize Handle */}
            <div
                className="w-2 shrink-0 cursor-col-resize flex items-center justify-center group hover:bg-primary/10 rounded transition-colors"
                onMouseDown={(e) => { e.preventDefault(); isResizingLeft.current = true; document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'; }}
            >
                <div className="w-0.5 h-8 bg-slate-300 dark:bg-slate-600 rounded-full group-hover:bg-primary transition-colors" />
            </div>

            {/* Center Panel: SQL Editor + Results */}
            <section id="sql-editor-section" className="flex-1 flex flex-col bg-white dark:bg-lc-surface rounded-xl shadow-sm border border-slate-200 dark:border-lc-border overflow-hidden">
                {/* Toolbar */}
                <div className="flex items-center justify-between border-b border-slate-200 dark:border-lc-border bg-white dark:bg-lc-surface px-4 h-12">
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-slate-700 dark:text-white">SQL Query Editor</span>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className={`flex items-center gap-1.5 ${sqlTimerVisuals.pulse ? "animate-pulse" : ""}`}>
                            <span
                                className={`material-symbols-outlined text-[16px] ${sqlTimerVisuals.color ? "" : "text-slate-500 dark:text-slate-400"}`}
                                style={sqlTimerVisuals.color ? { color: sqlTimerVisuals.color } : undefined}
                            >
                                timer
                            </span>
                            <span
                                className={`font-mono text-xs font-bold ${sqlTimerVisuals.color ? "" : "text-slate-700 dark:text-white"}`}
                                style={sqlTimerVisuals.color ? { color: sqlTimerVisuals.color } : undefined}
                            >
                                {formatTime(sqlRemaining)}
                            </span>
                        </div>
                        <button
                            onClick={() => setEditorTheme(editorTheme === "vs-dark" ? "light" : "vs-dark")}
                            className="flex items-center justify-center text-slate-500 hover:text-slate-800 dark:text-[#ababab] dark:hover:text-white transition-colors"
                            title="Toggle Editor Theme"
                        >
                            <span className="material-symbols-outlined text-[18px]">
                                {editorTheme === "vs-dark" ? 'light_mode' : 'dark_mode'}
                            </span>
                        </button>
                        <button
                            onClick={() => {
                                setSqlCode("");
                                latestSqlRef.current = "";
                                setTestResults(null);
                                // Clear Monaco editor directly
                                if (sqlEditorRef.current) {
                                    sqlEditorRef.current.setValue("");
                                }
                            }}
                            className="flex items-center justify-center text-slate-500 hover:text-slate-800 dark:text-[#ababab] dark:hover:text-white transition-colors"
                            title="Clear Editor"
                        >
                            <span className="material-symbols-outlined text-[18px]">restart_alt</span>
                        </button>
                    </div>
                </div>

                {/* Monaco SQL Editor */}
                <div className="flex-1 overflow-hidden relative">
                    <Editor
                        height="100%"
                        language="sql"
                        theme={editorTheme}
                        defaultValue={sqlCode}
                        onChange={(val) => { 
                            const newCode = val || "";
                            setSqlCode(newCode); 
                            latestSqlRef.current = newCode;
                        }}
                        onMount={(editor) => {
                            sqlEditorRef.current = editor;
                        }}
                        options={{
                            minimap: { enabled: false },
                            fontSize: 14,
                            lineHeight: 24,
                            padding: { top: 16 },
                            scrollBeyondLastLine: false,
                            fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
                            wordWrap: "on",
                            suggest: { showKeywords: true },
                            automaticLayout: true,
                        }}
                        loading={
                            <div className="flex items-center justify-center h-full text-slate-400">
                                <span className="material-symbols-outlined animate-spin text-2xl">sync</span>
                            </div>
                        }
                    />
                </div>

                {/* Vertical Resize Handle */}
                <div
                    className="h-2 shrink-0 cursor-row-resize flex items-center justify-center group hover:bg-primary/10 transition-colors"
                    onMouseDown={(e) => { e.preventDefault(); isResizingTest.current = true; document.body.style.cursor = 'row-resize'; document.body.style.userSelect = 'none'; }}
                >
                    <div className="h-0.5 w-8 bg-slate-300 dark:bg-slate-600 rounded-full group-hover:bg-primary transition-colors" />
                </div>

                {/* Lower Panel: SQL Results */}
                <div style={{ height: testHeight, minHeight: MIN_TEST, maxHeight: MAX_TEST }} className="border-t border-slate-200 dark:border-lc-border bg-white dark:bg-lc-surface flex flex-col shrink-0">
                    {/* Header with Run button */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-lc-border">
                        <div className="flex items-center gap-2">
                            <span className="material-symbols-outlined text-[18px] text-slate-500 dark:text-slate-400">terminal</span>
                            <span className="text-[13px] font-bold text-slate-700 dark:text-white uppercase tracking-wider">Query Results</span>
                        </div>
                        <button
                            onClick={handleRunSql}
                            disabled={isRunning || !sqlCode.trim()}
                            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-bold transition-colors shadow-sm ${
                                isRunning || !sqlCode.trim()
                                    ? "opacity-50 cursor-not-allowed bg-emerald-400 text-white"
                                    : "bg-[#10b981] hover:bg-[#059669] text-white cursor-pointer"
                            }`}
                        >
                            <span className="material-symbols-outlined text-[18px]">{isRunning ? 'sync' : 'play_arrow'}</span>
                            {isRunning ? "Running..." : "Run Query"}
                        </button>
                    </div>

                    {/* Results Content */}
                    <div className="flex-1 flex flex-col p-4 bg-white dark:bg-lc-surface overflow-auto min-h-0">
                        {isRunning ? (
                            <div className="flex items-center justify-center h-full gap-3 text-blue-500">
                                <span className="material-symbols-outlined animate-spin text-2xl">sync</span>
                                <span className="text-sm font-bold">Executing SQL query...</span>
                            </div>
                        ) : testResults?.[0]?.id === 'err' ? (
                            <div className="mb-3 p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-lg text-red-700 dark:text-red-400 text-[13px] font-mono whitespace-pre-wrap flex-shrink-0">
                                <div className="flex items-center gap-1.5 mb-1">
                                    <span className="material-symbols-outlined text-[16px]">error</span>
                                    <span className="font-bold text-[11px] uppercase tracking-wider">Error</span>
                                </div>
                                {testResults[0].error}
                            </div>
                        ) : sqlQuestion?.examples?.length > 0 ? (
                            <div className="h-full flex flex-col gap-4 min-h-0">
                                {/* Case Tabs */}
                                <div className="flex gap-6 border-b border-slate-100 dark:border-lc-border px-2 flex-shrink-0">
                                    {(testResults || sqlQuestion.examples).map((tc: any, idx: number) => {
                                        let dotColor = "bg-slate-300 dark:bg-slate-600";
                                        if (testResults) {
                                            if (testResults[idx]?.passed) dotColor = "bg-green-500";
                                            else dotColor = "bg-red-500";
                                        }

                                        return (
                                            <button
                                                key={idx}
                                                onClick={() => setActiveTestCase(idx)}
                                                className={`pb-3 text-[13px] font-bold border-b-2 transition-colors relative top-[1px] flex items-center gap-1.5 ${activeTestCase === idx
                                                        ? "text-orange-500 border-orange-500"
                                                        : "text-slate-500 border-transparent hover:text-slate-700 dark:hover:text-slate-300"
                                                    }`}
                                            >
                                                <span className={`size-2 rounded-full ${dotColor}`}></span>
                                                {testResults ? 'Test Case' : 'Case'} {idx + 1}
                                            </button>
                                        );
                                    })}
                                </div>
                                
                                {/* Values Layout */}
                                <div className="flex gap-4 overflow-auto custom-scrollbar flex-1 pb-4">
                                    {/* Input Section */}
                                    <div className="flex-1 flex flex-col gap-2 min-w-0">
                                        <div className="font-bold text-[11px] uppercase tracking-wider text-slate-500">Input</div>
                                        <div className="flex-1 bg-slate-50 dark:bg-[#1e1e1e] border border-slate-200 dark:border-lc-border rounded-lg p-3 font-mono text-[11px] overflow-auto custom-scrollbar whitespace-pre-wrap text-slate-800 dark:text-[#d4d4d4]">
                                            {Object.entries(sqlQuestion.examples[activeTestCase]?.input || {}).map(([tableName, rows]: [string, any]) => (
                                                <div key={tableName} className="mb-4 last:mb-0">
                                                    <div className="font-mono text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">{tableName} table:</div>
                                                    <div className="overflow-x-auto custom-scrollbar border border-slate-200 dark:border-lc-border rounded">
                                                        <table className="w-full text-left text-[11px] font-mono whitespace-nowrap border-collapse bg-white dark:bg-[#252526]">
                                                            <thead>
                                                                <tr className="border-b border-slate-200 dark:border-lc-border bg-slate-50 dark:bg-[#1e1e1e]">
                                                                    {rows?.[0] && Object.keys(rows[0]).map(key => (
                                                                        <th key={key} className="py-1 px-2 font-bold text-slate-600 dark:text-slate-400">{key}</th>
                                                                    ))}
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {(rows || []).map((row: any, i: number) => (
                                                                    <tr key={i} className="border-b border-slate-100 dark:border-lc-border/50 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                                                        {Object.values(row).map((val: any, j: number) => (
                                                                            <td key={j} className="py-1 px-2 text-slate-800 dark:text-[#d4d4d4]">{String(val)}</td>
                                                                        ))}
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="flex-1 flex flex-col gap-2 min-w-0">
                                        <div className="font-bold text-[11px] uppercase tracking-wider text-slate-500">Expected</div>
                                        <div className="flex-1 bg-slate-50 dark:bg-[#1e1e1e] border border-slate-200 dark:border-lc-border rounded-lg p-3 font-mono text-[11px] overflow-auto custom-scrollbar whitespace-pre-wrap text-slate-800 dark:text-[#d4d4d4]">
                                            {testResults ? (
                                                typeof testResults[activeTestCase]?.expectedOutput === "object" 
                                                    ? JSON.stringify(testResults[activeTestCase]?.expectedOutput, null, 2)
                                                    : (testResults[activeTestCase]?.expectedOutput || "No output")
                                            ) : sqlQuestion.examples[activeTestCase]?.output?.length > 0 ? (
                                                <table className="w-full text-left font-mono whitespace-nowrap border-collapse bg-white dark:bg-[#252526] border border-slate-200 dark:border-lc-border rounded">
                                                    <thead>
                                                        <tr className="border-b border-slate-200 dark:border-lc-border bg-slate-50 dark:bg-[#1e1e1e]">
                                                            {Object.keys(sqlQuestion.examples[activeTestCase].output[0]).map(key => (
                                                                <th key={key} className="py-1 px-2 font-bold text-slate-600 dark:text-slate-400">{key}</th>
                                                            ))}
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {sqlQuestion.examples[activeTestCase].output.map((row: any, i: number) => (
                                                            <tr key={i} className="border-b border-slate-100 dark:border-lc-border/50 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                                                {Object.values(row).map((val: any, j: number) => (
                                                                    <td key={j} className="py-1 px-2 text-slate-800 dark:text-[#d4d4d4]">{String(val)}</td>
                                                                ))}
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            ) : "No output rows"}
                                        </div>
                                    </div>
                                    <div className="flex-1 flex flex-col gap-2 min-w-0">
                                        <div className="font-bold text-[11px] uppercase tracking-wider text-slate-500">Output</div>
                                        <div className={`flex-1 p-3 rounded-lg border font-mono text-[11px] overflow-auto custom-scrollbar whitespace-pre-wrap ${
                                            testResults 
                                                ? (testResults[activeTestCase]?.passed ? "bg-green-50/50 dark:bg-green-500/5 border-green-200 dark:border-green-500/30 text-green-700 dark:text-green-400" : "bg-red-50/50 dark:bg-red-500/5 border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-400")
                                                : "bg-slate-50 dark:bg-[#1e1e1e] border-slate-200 dark:border-lc-border text-slate-400 italic"
                                        }`}>
                                            {testResults 
                                                ? (typeof testResults[activeTestCase]?.actualOutput === "object" 
                                                    ? JSON.stringify(testResults[activeTestCase]?.actualOutput, null, 2) 
                                                    : testResults[activeTestCase]?.actualOutput) 
                                                : "Run code to see output"}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="h-full flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 text-[13px]">
                                <span className="material-symbols-outlined text-3xl mb-2 opacity-50">data_object</span>
                                <p>No test cases available</p>
                            </div>
                        )}
                    </div>
                </div>
            </section>

            <div className="w-4 shrink-0" />

            {/* Right Panel: Camera + Chat */}
            <div className="w-[300px] flex flex-col gap-4 shrink-0">
                {/* Camera Window */}
                <div className="bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-lc-border overflow-hidden relative" style={{ height: '160px' }}>
                    <video ref={videoRef} autoPlay muted playsInline className={`absolute inset-0 w-full h-full object-cover ${isCameraOn ? 'block' : 'hidden'}`} style={{ transform: 'scaleX(-1)' }} />
                    {!isCameraOn && (
                        <div className="absolute inset-0 flex items-center justify-center" style={{ paddingBottom: '28px' }}>
                            <span className="material-symbols-outlined text-[36px] text-slate-500">videocam_off</span>
                        </div>
                    )}
                    <div className="absolute bottom-2.5 left-1/2 -translate-x-1/2 flex items-center gap-3">
                        {!pushToTalkEnabled && (
                            <button onClick={toggleMute} className={`px-3 py-1 rounded-full transition-all flex items-center justify-center ${isMuted ? "bg-red-500 hover:bg-red-600 text-white" : "bg-slate-700/80 hover:bg-slate-600 text-white"}`} title={isMuted ? "Unmute" : "Mute"}>
                                <span className="material-symbols-outlined text-[14px] leading-none">{isMuted ? "mic_off" : "mic"}</span>
                            </button>
                        )}
                        <button onClick={toggleCamera} className={`px-3 py-1 rounded-full transition-all flex items-center justify-center ${!isCameraOn ? "bg-red-500 hover:bg-red-600 text-white" : "bg-slate-700/80 hover:bg-slate-600 text-white"}`} title={isCameraOn ? "Turn off camera" : "Turn on camera"}>
                            <span className="material-symbols-outlined text-[14px] leading-none">{isCameraOn ? "videocam" : "videocam_off"}</span>
                        </button>
                        <button onClick={togglePushToTalk} className={`px-3 py-1 rounded-full transition-all flex items-center justify-center ${pushToTalkEnabled ? "bg-violet-500 hover:bg-violet-600 text-white shadow-md shadow-violet-500/30" : "bg-slate-700/80 hover:bg-slate-600 text-white"}`} title={pushToTalkEnabled ? "Disable push-to-talk" : "Enable push-to-talk (hold spacebar to talk)"}>
                            <span className="material-symbols-outlined text-[14px] leading-none">touch_app</span>
                        </button>
                    </div>
                    {isCameraOn && (
                        <div className="absolute top-2 left-2 flex items-center gap-1">
                            <span className="size-1.5 bg-green-500 rounded-full animate-pulse" />
                            <span className="text-[8px] font-bold text-white/70 uppercase tracking-wider">Live</span>
                        </div>
                    )}
                    {pushToTalkEnabled && (
                        <div className={`absolute top-2 right-2 flex items-center gap-1.5 px-2 py-1 rounded-full text-[9px] font-bold tracking-wider uppercase transition-all duration-200 ${
                            isHoldingSpace
                                ? "bg-emerald-500/30 text-emerald-300 border border-emerald-500/30"
                                : "bg-slate-800/70 text-slate-500 border border-slate-700/50"
                        }`}>
                            <span className="text-[8px]">SPACE</span>
                            {isHoldingSpace ? (
                                <span className="flex gap-0.5">
                                    <span className="w-0.5 h-2 bg-emerald-400 rounded-full animate-pulse" />
                                    <span className="w-0.5 h-2 bg-emerald-400 rounded-full animate-pulse" style={{ animationDelay: '0.15s' }} />
                                    <span className="w-0.5 h-2 bg-emerald-400 rounded-full animate-pulse" style={{ animationDelay: '0.3s' }} />
                                </span>
                            ) : (
                                <span className="text-[8px]">HOLD</span>
                            )}
                        </div>
                    )}
                </div>

                {/* Transcript */}
                <aside className="flex-1 flex flex-col bg-white dark:bg-lc-surface rounded-xl shadow-sm border border-slate-200 dark:border-lc-border overflow-hidden min-h-0">
                    <div className="p-3 border-b border-slate-100 dark:border-lc-border flex items-center justify-between">
                        <span className="text-[11px] font-bold tracking-wider uppercase text-slate-500">Transcript / Chat</span>
                        <span className="material-symbols-outlined text-sm text-slate-400">forum</span>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                        {messages.filter(msg => !msg.hidden).map((msg) => (
                            <div key={msg.id} className={`${msg.role === "user" ? "text-right" : ""}`}>
                                {msg.role === "ai" && (
                                    <span className="text-[10px] font-bold text-blue-500 font-mono">Interviewer:</span>
                                )}
                                <div className={`text-[13px] leading-relaxed mt-1 ${msg.role === "ai"
                                    ? "bg-slate-50 dark:bg-lc-bg border border-slate-100 dark:border-lc-border p-3 rounded-2xl rounded-tl-none text-slate-700 dark:text-[#ccc]"
                                    : "bg-primary text-white p-3 rounded-2xl rounded-tr-none inline-block"
                                }`}>
                                    {msg.text}
                                </div>
                            </div>
                        ))}
                        <div ref={chatEndRef} />
                    </div>
                    <div className="p-3 border-t border-slate-100 dark:border-lc-border">
                        <div className="relative border border-slate-200 dark:border-lc-border rounded-lg overflow-hidden focus-within:border-primary focus-within:ring-1 focus-within:ring-primary transition-all bg-white dark:bg-lc-bg">
                            <input
                                type="text"
                                placeholder="Type a response..."
                                value={chatInput}
                                onChange={(e) => setChatInput(e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter" && chatInput.trim()) handleSend(); }}
                                className="w-full text-[13px] p-3 pr-10 outline-none text-slate-700 dark:text-[#eff1f6] bg-transparent font-medium dark:placeholder:text-[#6b6b6b]"
                            />
                            <button
                                onClick={handleSend}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-primary hover:bg-primary/10 p-1.5 rounded-md cursor-pointer"
                            >
                                <span className="material-symbols-outlined text-[18px]">send</span>
                            </button>
                        </div>
                    </div>
                </aside>
            </div>
        </main>
    );
}

/* ============================================================
   PHASE 4: PM Notepad — Tiptap rich text + case scenario
   ============================================================ */
function NotepadPhase({
    isDark,
    panelData,
    notepadContent,
    onNotepadChange,
    onClose,
    messages,
    connected,
    isVoiceActive,
    isAISpeaking,
    connectionState,
    sendMessage,
    sendVoiceText,
    stopAudio,
    isMuted,
    isCameraOn,
    toggleMute,
    toggleCamera,
    videoRef,
    pushToTalkEnabled,
    isHoldingSpace,
    togglePushToTalk,
}: {
    isDark: boolean;
    panelData: any;
    notepadContent: string;
    onNotepadChange: (html: string) => void;
    onClose: () => void;
    messages: { id: string; role: string; text: string; isStreaming?: boolean; hidden?: boolean }[];
    connected: boolean;
    isVoiceActive: boolean;
    isAISpeaking: boolean;
    connectionState: string;
    sendMessage: (msg: string) => void;
    sendVoiceText: (msg: string) => void;
    stopAudio: () => void;
    isMuted: boolean;
    isCameraOn: boolean;
    toggleMute: () => void;
    toggleCamera: () => void;
    videoRef: React.RefObject<HTMLVideoElement | null>;
    pushToTalkEnabled: boolean;
    isHoldingSpace: boolean;
    togglePushToTalk: () => void;
}) {
    const [chatInput, setChatInput] = useState("");
    const [leftWidth, setLeftWidth] = useState(340);
    const isResizingLeft = useRef(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const chatEndRef = useRef<HTMLDivElement>(null);

    const MIN_LEFT = 260;
    const MAX_LEFT = 560;

    const isFallback = connectionState === "fallback";

    useEffect(() => {
        const move = (e: MouseEvent) => {
            if (isResizingLeft.current && containerRef.current) {
                const rect = containerRef.current.getBoundingClientRect();
                const newWidth = Math.min(MAX_LEFT, Math.max(MIN_LEFT, e.clientX - rect.left - 8));
                setLeftWidth(newWidth);
            }
        };
        const up = () => {
            isResizingLeft.current = false;
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
        };
        document.addEventListener("mousemove", move);
        document.addEventListener("mouseup", up);
        return () => {
            document.removeEventListener("mousemove", move);
            document.removeEventListener("mouseup", up);
        };
    }, []);

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    const handleSend = () => {
        if (!chatInput.trim()) return;
        if (isVoiceActive && !isFallback) {
            sendVoiceText(chatInput.trim());
        } else {
            sendMessage(chatInput.trim());
        }
        setChatInput("");
    };

    const topic = panelData?.topic || "Product Case";
    const initialContent = panelData?.initialContent || notepadContent || "";
    const caseScenario =
        panelData?.scenario ||
        panelData?.question?.scenario ||
        panelData?.question?.problemStatement ||
        panelData?.description ||
        "";

    return (
        <main ref={containerRef} className="flex flex-1 w-full overflow-hidden p-4 bg-slate-50 dark:bg-lc-bg h-full">

            {/* Left Panel: Case Scenario */}
            <aside
                style={{ width: leftWidth, minWidth: MIN_LEFT, maxWidth: MAX_LEFT }}
                className="bg-white dark:bg-lc-surface rounded-xl shadow-sm border border-slate-200 dark:border-lc-border flex flex-col shrink-0 overflow-hidden"
            >
                <div className="p-5 border-b border-slate-100 dark:border-lc-border flex items-center gap-3 bg-white dark:bg-lc-surface">
                    <span className="material-symbols-outlined text-[22px] text-violet-500">inventory_2</span>
                    <h1 className="text-[18px] font-nunito font-bold text-slate-800 dark:text-white tracking-tight flex-1">
                        {topic}
                    </h1>
                </div>

                <div className="flex-1 overflow-y-auto p-6 custom-scrollbar text-[16px] text-[#475569] dark:text-[#ababab] leading-relaxed space-y-5">
                    <div>
                        <p className="text-[12px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-3">
                            Problem statement
                        </p>
                        <p className="text-[18px] font-semibold text-slate-800 dark:text-slate-100 whitespace-pre-wrap break-words leading-8">
                            {caseScenario || topic}
                        </p>
                    </div>

                </div>
            </aside>

            {/* Horizontal Resize Handle */}
            <div
                className="w-2 shrink-0 cursor-col-resize flex items-center justify-center group hover:bg-primary/10 rounded transition-colors"
                onMouseDown={(e) => {
                    e.preventDefault();
                    isResizingLeft.current = true;
                    document.body.style.cursor = "col-resize";
                    document.body.style.userSelect = "none";
                }}
            >
                <div className="w-0.5 h-8 bg-slate-300 dark:bg-slate-600 rounded-full group-hover:bg-primary transition-colors" />
            </div>

            {/* Center Panel: Tiptap Notepad */}
            <section className="flex-1 flex flex-col bg-white dark:bg-lc-surface rounded-xl shadow-sm border border-slate-200 dark:border-lc-border overflow-hidden">
                <PMNotepadPanel
                    isDark={isDark}
                    initialContent={initialContent || ""}
                    onContentChange={onNotepadChange}
                    onClose={onClose}
                />
            </section>

            <div className="w-4 shrink-0" />

            {/* Right Panel: Camera + Transcript */}
            <div className="w-[300px] flex flex-col gap-4 shrink-0">
                {/* Camera Window */}
                <div
                    className="bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-lc-border overflow-hidden relative"
                    style={{ height: "160px" }}
                >
                    <video
                        ref={videoRef}
                        autoPlay
                        muted
                        playsInline
                        className={`absolute inset-0 w-full h-full object-cover ${isCameraOn ? "block" : "hidden"}`}
                        style={{ transform: "scaleX(-1)" }}
                    />
                    {!isCameraOn && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-900">
                            <div className="w-12 h-12 rounded-full bg-slate-700 flex items-center justify-center">
                                <span className="material-symbols-outlined text-[24px] text-slate-400">person</span>
                            </div>
                            <span className="text-[11px] font-medium text-slate-500 tracking-wide">Camera off</span>
                        </div>
                    )}
                    <div className="absolute bottom-2.5 left-1/2 -translate-x-1/2 flex items-center gap-3">
                        {!pushToTalkEnabled && (
                            <button
                                onClick={toggleMute}
                                className={`px-3 py-1 rounded-full transition-all flex items-center justify-center ${isMuted ? "bg-red-500 hover:bg-red-600 text-white" : "bg-slate-700/80 hover:bg-slate-600 text-white"}`}
                                title={isMuted ? "Unmute" : "Mute"}
                            >
                                <span className="material-symbols-outlined text-[14px] leading-none">{isMuted ? "mic_off" : "mic"}</span>
                            </button>
                        )}
                        <button
                            onClick={toggleCamera}
                            className={`px-3 py-1 rounded-full transition-all flex items-center justify-center ${!isCameraOn ? "bg-red-500 hover:bg-red-600 text-white" : "bg-slate-700/80 hover:bg-slate-600 text-white"}`}
                            title={isCameraOn ? "Turn off camera" : "Turn on camera"}
                        >
                            <span className="material-symbols-outlined text-[14px] leading-none">{isCameraOn ? "videocam" : "videocam_off"}</span>
                        </button>
                        <button
                            onClick={togglePushToTalk}
                            className={`px-3 py-1 rounded-full transition-all flex items-center justify-center ${pushToTalkEnabled ? "bg-violet-500 hover:bg-violet-600 text-white shadow-md shadow-violet-500/30" : "bg-slate-700/80 hover:bg-slate-600 text-white"}`}
                            title={pushToTalkEnabled ? "Disable push-to-talk" : "Enable push-to-talk (hold spacebar to talk)"}
                        >
                            <span className="material-symbols-outlined text-[14px] leading-none">touch_app</span>
                        </button>
                    </div>
                    {isCameraOn && (
                        <div className="absolute top-2 left-2 flex items-center gap-1">
                            <span className="size-1.5 bg-green-500 rounded-full animate-pulse" />
                            <span className="text-[8px] font-bold text-white/70 uppercase tracking-wider">Live</span>
                        </div>
                    )}
                    {pushToTalkEnabled && (
                        <div className={`absolute top-2 right-2 flex items-center gap-1.5 px-2 py-1 rounded-full text-[9px] font-bold tracking-wider uppercase transition-all duration-200 ${
                            isHoldingSpace
                                ? "bg-emerald-500/30 text-emerald-300 border border-emerald-500/30"
                                : "bg-slate-800/70 text-slate-500 border border-slate-700/50"
                        }`}>
                            <span className="text-[8px]">SPACE</span>
                            {isHoldingSpace ? (
                                <span className="flex gap-0.5">
                                    <span className="w-0.5 h-2 bg-emerald-400 rounded-full animate-pulse" />
                                    <span className="w-0.5 h-2 bg-emerald-400 rounded-full animate-pulse" style={{ animationDelay: "0.15s" }} />
                                    <span className="w-0.5 h-2 bg-emerald-400 rounded-full animate-pulse" style={{ animationDelay: "0.3s" }} />
                                </span>
                            ) : (
                                <span className="text-[8px]">HOLD</span>
                            )}
                        </div>
                    )}
                </div>

                {/* Transcript + Chat */}
                <aside className="flex-1 flex flex-col bg-white dark:bg-lc-surface rounded-xl shadow-sm border border-slate-200 dark:border-lc-border overflow-hidden min-h-0">
                    <div className="p-3 border-b border-slate-100 dark:border-lc-border flex items-center justify-between">
                        <span className="text-[11px] font-bold tracking-wider uppercase text-slate-500">Transcript / Chat</span>
                        <span className="material-symbols-outlined text-sm text-slate-400">forum</span>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                        {messages.filter(msg => !msg.hidden).map((msg) => (
                            <div key={msg.id} className={`${msg.role === "user" ? "text-right" : ""}`}>
                                {msg.role === "ai" && (
                                    <span className="text-[10px] font-bold text-blue-500 font-mono">Interviewer:</span>
                                )}
                                <div className={`text-[13px] leading-relaxed mt-1 ${
                                    msg.role === "ai"
                                        ? "bg-slate-50 dark:bg-lc-bg border border-slate-100 dark:border-lc-border p-3 rounded-2xl rounded-tl-none text-slate-700 dark:text-[#ccc]"
                                        : "bg-primary text-white p-3 rounded-2xl rounded-tr-none inline-block"
                                }`}>
                                    {msg.text}
                                </div>
                            </div>
                        ))}
                        <div ref={chatEndRef} />
                    </div>
                    <div className="p-3 border-t border-slate-100 dark:border-lc-border">
                        <div className="relative border border-slate-200 dark:border-lc-border rounded-lg overflow-hidden focus-within:border-primary focus-within:ring-1 focus-within:ring-primary transition-all bg-white dark:bg-lc-bg">
                            <input
                                type="text"
                                placeholder="Type a response..."
                                value={chatInput}
                                onChange={(e) => setChatInput(e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter" && chatInput.trim()) handleSend(); }}
                                className="w-full text-[13px] p-3 pr-10 outline-none text-slate-700 dark:text-[#eff1f6] bg-transparent font-medium dark:placeholder:text-[#6b6b6b]"
                            />
                            <button
                                onClick={handleSend}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-primary hover:bg-primary/10 p-1.5 rounded-md cursor-pointer"
                            >
                                <span className="material-symbols-outlined text-[18px]">send</span>
                            </button>
                        </div>
                    </div>
                </aside>
            </div>
        </main>
    );
}
