"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { UpgradeModal } from "@/components/upgrade-modal";
import { apiFetch, getApiBaseUrl } from "@/lib/api";
import { fetchWithLimits, isFeatureLimitError } from "@/lib/api-with-limits";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { useBilling } from "@/hooks/use-billing";
import { useFeatureLimit } from "@/hooks/use-feature-limit";
import type { InterviewCostKey, InterviewStage } from "@interviewforge/shared";

type WarmupModule = {
    stage: InterviewStage;
    label: string;
    minutes: number;
    icon: string;
};

type WarmupConfig = {
    type: InterviewCostKey;
    typeLabel: string;
    resumeId?: string | null;
    resumeModuleEnabled: boolean;
    hasResumeAnalysis?: boolean;
    level: "Junior" | "Mid" | "Senior";
    language: string;
    moduleConfig?: unknown;
    modules: WarmupModule[];
    estimatedMinutes: number;
    selectedCost: number;
};

type CheckStatus = "idle" | "checking" | "ready" | "error";

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
const VOICE_CHECK_TIMEOUT_MS = 15000;
const BLOG_HEADING_FONT = "'Sohne', 'Inter', 'Helvetica Neue', Arial, sans-serif";
const blogHeadingStyle = { fontFamily: BLOG_HEADING_FONT };

function normalizeSpeech(text: string) {
    return text.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
}

function isHelloWorldMatch(text: string) {
    const normalized = normalizeSpeech(text);
    if (normalized.includes("hello world")) return true;

    const tokens = normalized.split(" ").filter(Boolean);
    const helloWords = new Set(["hello", "hallo", "hullo", "helo", "yellow"]);
    const worldWords = new Set(["world", "word", "work", "worlds"]);

    return tokens.some((token, index) => helloWords.has(token) && tokens.slice(index + 1, index + 4).some((next) => worldWords.has(next)));
}

function WarmupContent() {
    const router = useRouter();
    const params = useSearchParams();
    const configKey = params.get("configKey");
    const { handleFeatureError, UpgradeModal: FeatureLimitModal } = useFeatureLimit();
    const { snapshot } = useBilling();
    // Camera pre-join checks are paused pending product review.
    // const videoRef = useRef<HTMLVideoElement | null>(null);
    const audioStreamRef = useRef<MediaStream | null>(null);
    // const videoStreamRef = useRef<MediaStream | null>(null);
    const speechRecognitionRef = useRef<any>(null);
    const autoChecksStartedRef = useRef(false);
    const continueAfterSpeakerRef = useRef(false);
    const pageActiveRef = useRef(true);
    const micCheckRunRef = useRef(0);
    const micRetryTimersRef = useRef<number[]>([]);
    const startAbortControllerRef = useRef<AbortController | null>(null);
    const startCancelledRef = useRef(false);
    const allowReviewBackRef = useRef(false);

    const [config, setConfig] = useState<WarmupConfig | null>(null);
    // const [cameraStatus, setCameraStatus] = useState<CheckStatus>("idle");
    const [micStatus, setMicStatus] = useState<CheckStatus>("idle");
    const [networkStatus, setNetworkStatus] = useState<CheckStatus>("idle");
    const [speakerStatus, setSpeakerStatus] = useState<CheckStatus>("idle");
    const [browserStatus, setBrowserStatus] = useState<CheckStatus>("idle");
    // const [cameraError, setCameraError] = useState<string | null>(null);
    const [micError, setMicError] = useState<string | null>(null);
    const [speakerError, setSpeakerError] = useState<string | null>(null);
    const [speakerTonePlayed, setSpeakerTonePlayed] = useState(false);
    const [voiceTranscript, setVoiceTranscript] = useState("");
    const [networkLabel, setNetworkLabel] = useState("Waiting for check");
    const [browserLabel, setBrowserLabel] = useState("Waiting for check");
    const [error, setError] = useState<string | null>(null);
    const [starting, setStarting] = useState(false);
    const [loadingStatus, setLoadingStatus] = useState<string | null>(null);
    const [upgradeOpen, setUpgradeOpen] = useState(false);
    const [checksHaveRun, setChecksHaveRun] = useState(false);
    const [checksRunning, setChecksRunning] = useState(false);

    useEffect(() => {
        document.title = "Pre-join Check | Mockr";
    }, []);

    useEffect(() => {
        if (!configKey) return;
        try {
            const stored = window.sessionStorage.getItem(configKey);
            setConfig(stored ? JSON.parse(stored) : null);
        } catch {
            setConfig(null);
        }
    }, [configKey]);

    const stopAudioResources = useCallback(() => {
        micRetryTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
        micRetryTimersRef.current = [];
        try {
            speechRecognitionRef.current?.abort?.();
        } catch {
            // Ignore abort errors after recognition has already stopped.
        }
        speechRecognitionRef.current = null;
        audioStreamRef.current?.getTracks().forEach((track) => track.stop());
        audioStreamRef.current = null;
    }, []);

    const cancelStartFlow = useCallback(() => {
        startCancelledRef.current = true;
        startAbortControllerRef.current?.abort();
        startAbortControllerRef.current = null;
        setStarting(false);
        setLoadingStatus(null);
    }, []);

    const goBackToInterviewSetup = useCallback(() => {
        cancelStartFlow();
        router.replace("/interviews/ai");
    }, [cancelStartFlow, router]);

    const goBackToReview = useCallback(() => {
        cancelStartFlow();
        allowReviewBackRef.current = true;
        router.back();
    }, [cancelStartFlow, router]);

    useEffect(() => {
        pageActiveRef.current = true;
        const cancelWarmupAudio = () => {
            pageActiveRef.current = false;
            micCheckRunRef.current += 1;
            stopAudioResources();
        };

        window.addEventListener("pagehide", cancelWarmupAudio);
        return () => {
            window.removeEventListener("pagehide", cancelWarmupAudio);
            cancelWarmupAudio();
            cancelStartFlow();
            // videoStreamRef.current?.getTracks().forEach((track) => track.stop());
        };
    }, [cancelStartFlow, stopAudioResources]);

    useEffect(() => {
        const handleBrowserBack = () => {
            if (allowReviewBackRef.current) {
                allowReviewBackRef.current = false;
                return;
            }
            goBackToInterviewSetup();
        };

        window.addEventListener("popstate", handleBrowserBack);
        return () => window.removeEventListener("popstate", handleBrowserBack);
    }, [goBackToInterviewSetup]);

    const readyCount = useMemo(() => {
        return [micStatus, networkStatus, speakerStatus, browserStatus].filter((status) => status === "ready").length;
    }, [browserStatus, micStatus, networkStatus, speakerStatus]);

    const walletTotal = snapshot?.wallet.total ?? 0;
    const hasInsufficientCredits = Boolean(config && snapshot && walletTotal < config.estimatedMinutes);
    const interviewTypeLabel = config?.typeLabel
        ? `${config.typeLabel}${/interview$/i.test(config.typeLabel) ? "" : " Interview"}`
        : "AI Interview";
    const checksComplete = readyCount === 4;

    const startMicrophone = useCallback(async () => {
        const checkId = micCheckRunRef.current + 1;
        micCheckRunRef.current = checkId;
        pageActiveRef.current = true;
        stopAudioResources();
        setMicStatus("checking");
        setMicError(null);
        setVoiceTranscript("");

        try {
            const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
            if (!SpeechRecognition) {
                throw new Error('Speech recognition is not supported in this browser. Try Chrome or Edge.');
            }

            const stream = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: true, noiseSuppression: true },
            });
            const isCurrentCheck = () => pageActiveRef.current && micCheckRunRef.current === checkId;
            if (!isCurrentCheck()) {
                stream.getTracks().forEach((track) => track.stop());
                return false;
            }
            audioStreamRef.current?.getTracks().forEach((track) => track.stop());
            audioStreamRef.current = stream;

            if (stream.getAudioTracks().length === 0) {
                throw new Error("No microphone input detected.");
            }

            return await new Promise<boolean>((resolve) => {
                let settled = false;
                let restarting = false;
                let recognition: any = null;
                const deadline = Date.now() + VOICE_CHECK_TIMEOUT_MS;

                const finish = (ready: boolean, message?: string) => {
                    if (settled) return;
                    settled = true;
                    window.clearTimeout(timeoutId);
                    micRetryTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
                    micRetryTimersRef.current = [];
                    if (recognition) {
                        recognition.onresult = null;
                        recognition.onerror = null;
                        recognition.onend = null;
                    }
                    try {
                        recognition?.stop?.();
                    } catch {
                        // Ignore stop errors after recognition has already ended.
                    }
                    speechRecognitionRef.current = null;
                    audioStreamRef.current?.getTracks().forEach((track) => track.stop());
                    audioStreamRef.current = null;
                    if (isCurrentCheck()) {
                        setMicStatus(ready ? "ready" : "error");
                        setMicError(message || null);
                    }
                    resolve(ready && isCurrentCheck());
                };

                const retryListen = (delay: number) => {
                    if (!isCurrentCheck() || settled || restarting || Date.now() >= deadline) return;
                    restarting = true;
                    const timerId = window.setTimeout(() => {
                        restarting = false;
                        listen();
                    }, delay);
                    micRetryTimersRef.current.push(timerId);
                };

                const timeoutId = window.setTimeout(() => {
                    finish(false, 'Say "Hello world" once.');
                }, VOICE_CHECK_TIMEOUT_MS);

                const listen = () => {
                    if (!isCurrentCheck() || settled) return;
                    recognition = new SpeechRecognition();
                    speechRecognitionRef.current = recognition;
                    recognition.continuous = false;
                    recognition.interimResults = true;
                    recognition.lang = "en-US";

                    recognition.onresult = (event: any) => {
                        const transcript = Array.from(event.results)
                            .map((result: any) => result[0]?.transcript || "")
                            .join(" ")
                            .trim();
                        if (isCurrentCheck()) setVoiceTranscript(transcript);
                        if (isHelloWorldMatch(transcript)) {
                            finish(true);
                        }
                    };

                    recognition.onerror = (event: any) => {
                        const retryable = ["no-speech", "aborted", "audio-capture", "network"].includes(event?.error);
                        if (retryable && isCurrentCheck() && Date.now() < deadline && !settled) {
                            retryListen(350);
                            return;
                        }
                        finish(false, event?.error ? `Speech check failed: ${event.error}` : "Speech check failed.");
                    };

                    recognition.onend = () => {
                        if (settled) return;
                        if (isCurrentCheck() && Date.now() < deadline) {
                            retryListen(250);
                            return;
                        }
                        finish(false, 'Say "Hello world" once.');
                    };

                    try {
                        recognition.start();
                    } catch {
                        retryListen(350);
                    }
                };

                listen();
            });
        } catch (err: any) {
            if (pageActiveRef.current && micCheckRunRef.current === checkId) {
                setMicStatus("error");
                setMicError(err?.message || "Microphone permission was blocked.");
            }
            audioStreamRef.current?.getTracks().forEach((track) => track.stop());
            audioStreamRef.current = null;
            return false;
        }
    }, [stopAudioResources]);

    // const startCamera = useCallback(async () => {
    //     setCameraStatus("checking");
    //     setCameraError(null);
    //
    //     try {
    //         const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    //         videoStreamRef.current?.getTracks().forEach((track) => track.stop());
    //         videoStreamRef.current = stream;
    //
    //         if (videoRef.current) {
    //             videoRef.current.srcObject = stream;
    //             await videoRef.current.play().catch(() => undefined);
    //         }
    //
    //         setCameraStatus(stream.getVideoTracks().length > 0 ? "ready" : "error");
    //     } catch (err: any) {
    //         setCameraStatus("error");
    //         setCameraError(err?.message || "Camera permission or hardware check failed.");
    //     }
    // }, []);

    const checkNetwork = useCallback(async () => {
        setNetworkStatus("checking");
        setNetworkLabel("Checking connection...");
        const startedAt = performance.now();
        try {
            const response = await fetch(`${getApiBaseUrl()}/health`, { cache: "no-store" });
            const latency = Math.round(performance.now() - startedAt);
            if (!response.ok) throw new Error("Health check failed");
            setNetworkStatus("ready");
            setNetworkLabel(latency < 300 ? `Stable - ${latency} ms latency` : `Connected - ${latency} ms latency`);
            return true;
        } catch {
            const online = navigator.onLine;
            setNetworkStatus(online ? "ready" : "error");
            setNetworkLabel(online ? "Browser reports online" : "No network connection detected");
            return online;
        }
    }, []);

    const checkBrowserAccess = useCallback(() => {
        setBrowserStatus("checking");
        try {
            const AudioCtor = window.AudioContext || (window as any).webkitAudioContext;
            const hasMediaDevices = Boolean(navigator.mediaDevices?.getUserMedia);
            const hasAudio = Boolean(AudioCtor);
            const secureContext = window.isSecureContext || window.location.hostname === "localhost";
            const online = navigator.onLine;

            if (!secureContext) throw new Error("Secure browser context required.");
            if (!hasMediaDevices) throw new Error("Media permissions are blocked or unsupported.");
            if (!hasAudio) throw new Error("Audio playback is unsupported in this browser.");
            if (!online) throw new Error("Browser is offline.");

            setBrowserStatus("ready");
            setBrowserLabel("Permissions and media APIs available");
            return true;
        } catch (err: any) {
            setBrowserStatus("error");
            setBrowserLabel(err?.message || "Browser access check failed.");
            return false;
        }
    }, []);

    const playSpeakerTest = useCallback(() => {
        setSpeakerStatus("checking");
        setSpeakerTonePlayed(false);
        setSpeakerError(null);
        return new Promise<boolean>((resolve) => {
            try {
                const AudioCtor = window.AudioContext || (window as any).webkitAudioContext;
                if (!AudioCtor) throw new Error("Audio playback is not supported in this browser.");
                const audioContext = new AudioCtor();
                const oscillator = audioContext.createOscillator();
                const gain = audioContext.createGain();
                oscillator.type = "sine";
                oscillator.frequency.value = 660;
                gain.gain.setValueAtTime(0.001, audioContext.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.18, audioContext.currentTime + 0.04);
                gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.75);
                oscillator.connect(gain);
                gain.connect(audioContext.destination);
                oscillator.start();
                oscillator.stop(audioContext.currentTime + 0.8);
                window.setTimeout(() => {
                    audioContext.close().catch(() => undefined);
                    setSpeakerStatus("idle");
                    setSpeakerTonePlayed(true);
                    resolve(true);
                }, 900);
            } catch (err: any) {
                setSpeakerStatus("error");
                setSpeakerTonePlayed(false);
                setSpeakerError(err?.message || "Unable to play the audio check.");
                resolve(false);
            }
        });
    }, []);

    const runRemainingChecks = useCallback(async () => {
        setChecksRunning(true);
        try {
            await wait(700);
            await checkNetwork();
            await wait(700);
            checkBrowserAccess();
        } finally {
            setChecksHaveRun(true);
            setChecksRunning(false);
        }
    }, [checkBrowserAccess, checkNetwork]);

    const confirmSpeakerTone = useCallback(() => {
        if (speakerStatus === "ready") return;
        setSpeakerStatus("ready");
        if (continueAfterSpeakerRef.current) {
            continueAfterSpeakerRef.current = false;
            void runRemainingChecks();
        }
    }, [runRemainingChecks, speakerStatus]);

    const runAllChecks = useCallback(async () => {
        if (checksRunning) return;
        continueAfterSpeakerRef.current = false;
        setSpeakerStatus("idle");
        setSpeakerTonePlayed(false);
        setSpeakerError(null);
        setNetworkStatus("idle");
        setNetworkLabel("Waiting for check");
        setBrowserStatus("idle");
        setBrowserLabel("Waiting for check");
        setChecksRunning(true);
        speechRecognitionRef.current?.abort?.();
        try {
            await wait(700);
            const voiceReady = await startMicrophone();
            if (!voiceReady) return;
            await wait(700);
            const speakerToneReady = await playSpeakerTest();
            if (!speakerToneReady) return;
            continueAfterSpeakerRef.current = true;
        } finally {
            setChecksHaveRun(true);
            setChecksRunning(false);
        }
    }, [checksRunning, playSpeakerTest, startMicrophone]);

    useEffect(() => {
        if (!config || autoChecksStartedRef.current) return;
        autoChecksStartedRef.current = true;
        const timeoutId = window.setTimeout(() => {
            void runAllChecks();
        }, 1200);

        return () => window.clearTimeout(timeoutId);
    }, [config, runAllChecks]);

    const startInterview = async () => {
        if (!config) {
            router.replace("/interviews/ai");
            return;
        }

        if (hasInsufficientCredits) {
            setUpgradeOpen(true);
            return;
        }

        startAbortControllerRef.current?.abort();
        const startAbortController = new AbortController();
        startAbortControllerRef.current = startAbortController;
        startCancelledRef.current = false;
        setStarting(true);
        setError(null);

        try {
            const { data } = await createSupabaseBrowserClient().auth.getSession();
            const token = data.session?.access_token;
            if (!token) throw new Error("Not authenticated");
            if (startCancelledRef.current || startAbortController.signal.aborted) return;

            if (config.resumeModuleEnabled && config.resumeId && !config.hasResumeAnalysis) {
                setLoadingStatus("Checking resume context...");
                const analyzeRes = await fetchWithLimits(`${getApiBaseUrl()}/resumes/${config.resumeId}/analyze`, {
                    method: "POST",
                    headers: { Authorization: `Bearer ${token}` },
                    signal: startAbortController.signal,
                });
                if (startCancelledRef.current || startAbortController.signal.aborted) return;
                if (!analyzeRes.ok) {
                    const err = await analyzeRes.json().catch(() => ({}));
                    if (String(err.message || "").toLowerCase().includes("already been analyzed")) {
                        setConfig((current) => current ? { ...current, hasResumeAnalysis: true } : current);
                    } else {
                        throw new Error(err.message || "Failed to analyze resume");
                    }
                }
            }

            setLoadingStatus("Preparing your interview...");
            const session = await apiFetch<{ id: string }>(
                "/interviews",
                {
                    method: "POST",
                    token,
                    signal: startAbortController.signal,
                    body: JSON.stringify({
                        mode: "mock",
                        resumeId: config.resumeModuleEnabled ? config.resumeId || undefined : undefined,
                        type: config.type,
                        difficulty: config.level,
                        level: config.level,
                        language: config.language || "Python",
                        moduleConfig: config.moduleConfig,
                        estimatedMinutes: config.estimatedMinutes,
                    }),
                },
            );
            if (startCancelledRef.current || startAbortController.signal.aborted) return;

            if (configKey) window.sessionStorage.removeItem(configKey);
            setLoadingStatus("Launching interview room...");
            router.replace(`/room/${session.id}`);
        } catch (err: any) {
            if (startCancelledRef.current || startAbortController.signal.aborted || err?.name === "AbortError") {
                return;
            }
            if (isFeatureLimitError(err)) {
                handleFeatureError(err, "interview_minutes");
            }
            setError(err.message || "Failed to create session");
            setStarting(false);
            setLoadingStatus(null);
        } finally {
            if (startAbortControllerRef.current === startAbortController) {
                startAbortControllerRef.current = null;
            }
        }
    };

    if (!config) {
        return (
            <div className="fixed inset-0 z-[240] flex items-center justify-center bg-slate-50 p-6 dark:bg-lc-bg">
                <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl shadow-slate-300/70 dark:bg-lc-surface dark:shadow-black/35">
                    <h1 className="text-xl font-extrabold text-slate-950 dark:text-white" style={blogHeadingStyle}>Customize an interview first</h1>
                    <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">The pre-join check opens after selecting modules and session settings.</p>
                    <button onClick={() => router.replace("/interviews/ai")} className="mt-5 rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700">
                        Back to setup
                    </button>
                    <FeatureLimitModal />
                </div>
            </div>
        );
    }

    return (
        <div className="flex-1">
            {starting && (
                <div className="fixed inset-0 z-[10000] flex flex-col items-center justify-center bg-white dark:bg-lc-bg">
                    <div className="flex flex-col items-center gap-6">
                        <div className="relative">
                            <div className="size-16 rounded-full border-[3px] border-slate-200 dark:border-lc-border" />
                            <div className="absolute inset-0 size-16 animate-spin rounded-full border-[3px] border-primary border-t-transparent" />
                        </div>
                        <div className="space-y-2 text-center">
                            <h2 className="text-[18px] font-bold tracking-tight text-slate-800 dark:text-white" style={blogHeadingStyle}>Setting up your interview</h2>
                            <p className="animate-pulse text-sm text-slate-500">{loadingStatus || "Getting ready..."}</p>
                        </div>
                    </div>
                </div>
            )}

            <UpgradeModal
                open={upgradeOpen}
                onClose={() => setUpgradeOpen(false)}
                feature="interview_minutes"
                reason="minutes"
                currentPlan={snapshot?.plan}
                currentSubscriptionId={snapshot?.subscriptionId ?? undefined}
                showMinutePacks
                description={`${config.typeLabel} needs ${config.estimatedMinutes} minute${config.estimatedMinutes === 1 ? "" : "s"}. You have ${walletTotal}.`}
            />

            <main className="fixed inset-0 z-[9999] overflow-hidden bg-[#f7f9fc] px-5 py-4 dark:bg-lc-bg">
                <div className="mx-auto flex h-full max-w-[1120px] flex-col">
                    <div className="mt-2 grid shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4">
                        <button
                            type="button"
                            onClick={goBackToReview}
                            className="flex size-9 shrink-0 items-center justify-center rounded-full text-slate-700 transition-colors hover:bg-slate-200/70 hover:text-blue-600 dark:text-slate-200 dark:hover:bg-lc-border dark:hover:text-blue-300"
                            aria-label="Back"
                        >
                            <span className="material-symbols-outlined text-[22px]">arrow_back</span>
                        </button>
                        <h1 className="text-center text-2xl font-bold tracking-normal text-slate-950 dark:text-white" style={blogHeadingStyle}>Interview instructions</h1>
                        <span className="rounded-full bg-slate-200/80 px-4 py-2 text-sm font-bold text-slate-700 dark:bg-lc-surface dark:text-slate-300">
                            {config.estimatedMinutes} min
                        </span>
                    </div>

                    <div className="grid min-h-0 flex-1 gap-8 pt-10 lg:grid-cols-[minmax(0,1fr)_1px_390px] lg:gap-10">
                        <section className="min-h-0 pr-0 lg:pr-2">
                            <div className="max-w-[680px]">
                                <div>
                                    <p className="mb-5 text-xs font-extrabold uppercase tracking-[0.18em] text-slate-900 dark:text-white" style={blogHeadingStyle}>Before you begin</p>
                                    <div className="space-y-5">
                                        <InstructionLine text="Choose a quiet room with minimal background noise." />
                                        <InstructionLine text="Wear earphones or headphones so your audio stays clear." />
                                        <InstructionLine text="Keep your device charged and your connection steady." />
                                        <InstructionLine text="Stay calm, think aloud, and take a moment before answering." />
                                    </div>
                                </div>

                                <div className="mt-10">
                                    <p className="mb-5 text-xs font-extrabold uppercase tracking-[0.18em] text-slate-900 dark:text-white" style={blogHeadingStyle}>Interview features</p>
                                    <div className="space-y-5">
                                        <FeatureCard icon="touch_app" title="Push-to-talk" description="Speak naturally to the interviewer. If you face audio difficulty, use push-to-talk by holding Spacebar while speaking and releasing when finished." />
                                        <FeatureCard icon="subtitles" title="Live transcript" description="Your conversation appears as text after you speak." />
                                        <FeatureCard icon="workspaces" title="Workspace tools" description="The relevant editor, prompt, and notes area will open automatically during structured rounds." />
                                    </div>
                                </div>
                            </div>

                            {error && (
                                <div className="mt-8 max-w-xl rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
                                    {error}
                                </div>
                            )}
                        </section>

                        <div className="hidden h-full min-h-[520px] w-px bg-gradient-to-b from-transparent via-blue-300/60 to-transparent dark:via-blue-400/35 lg:block" />

                        <section className="flex min-h-0 flex-col">
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <h2 className="text-lg font-extrabold tracking-tight text-slate-950 dark:text-white" style={blogHeadingStyle}>Ready to join</h2>
                                    <p className="mt-1 text-sm font-semibold text-slate-700 dark:text-slate-200">{interviewTypeLabel}</p>
                                </div>
                                <span className="rounded-md bg-slate-200/70 px-3 py-1.5 text-sm font-extrabold text-slate-700 dark:bg-lc-surface dark:text-slate-300">
                                    {readyCount} / 4 checks
                                </span>
                            </div>

                        {/* Camera preview is temporarily disabled pending product review.
                        <div className="mt-5 overflow-hidden rounded-2xl bg-slate-950">
                            <div className="relative aspect-video">
                                <video ref={videoRef} muted playsInline className="h-full w-full object-cover" />
                                {cameraStatus !== "ready" && (
                                    <div className="absolute inset-0 flex items-center justify-center bg-slate-950 text-slate-300">
                                        <span className="material-symbols-outlined text-[40px]">videocam</span>
                                    </div>
                                )}
                            </div>
                        </div>
                        */}

                        <div className="mt-7 divide-y divide-slate-200/80 dark:divide-lc-border">
                            <ReadinessItem
                                icon="mic"
                                title="Voice"
                                status={micStatus}
                                detail={micError || (voiceTranscript ? `Heard: "${voiceTranscript}"` : 'Say "Hello world" once')}
                            />
                            <ReadinessItem
                                icon="volume_up"
                                title="Speaker"
                                status={speakerStatus}
                                detail={speakerError || (speakerStatus === "ready" ? "Tone confirmed" : speakerTonePlayed ? "Heard the tone? Click to confirm." : "Waiting for tone")}
                                onConfirm={speakerTonePlayed && !speakerError && speakerStatus !== "ready" ? confirmSpeakerTone : undefined}
                            />
                            <ReadinessItem icon="wifi" title="Connection" status={networkStatus} detail={networkLabel} />
                            <ReadinessItem icon="shield_lock" title="Browser access" status={browserStatus} detail={browserLabel} />
                            {/* <ReadinessItem icon="videocam" title="Camera" status={cameraStatus} detail={cameraError || (cameraStatus === "ready" ? "Camera available" : "Waiting for permission")} /> */}
                        </div>

                        <div className="mt-auto pt-8">
                            <div className="space-y-3">
                                {checksHaveRun && (
                                    <button
                                        type="button"
                                        onClick={runAllChecks}
                                        disabled={checksRunning}
                                        className="flex w-full items-center justify-center rounded-lg border border-blue-500 bg-transparent px-4 py-3 text-sm font-extrabold text-blue-600 transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-blue-400 dark:text-blue-300 dark:hover:bg-blue-500/10"
                                    >
                                        {checksRunning ? "Checking..." : "Run checks again"}
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={startInterview}
                                    disabled={starting || (!checksComplete && !hasInsufficientCredits)}
                                    className="flex w-full items-center justify-center rounded-lg bg-blue-600 px-4 py-3 text-sm font-extrabold text-white shadow-lg shadow-blue-600/20 transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none dark:disabled:bg-lc-surface dark:disabled:text-slate-500"
                                >
                                    {hasInsufficientCredits ? "Upgrade" : "Join interview"}
                                </button>
                            </div>
                        </div>
                    </section>
                    </div>
                </div>
            </main>
            <FeatureLimitModal />
        </div>
    );
}

function InstructionLine({ text }: { text: string }) {
    return (
        <div className="flex items-start gap-3">
            <span className="mt-2 size-1.5 shrink-0 rounded-full bg-slate-500 dark:bg-slate-400" />
            <p className="text-sm font-semibold leading-6 text-slate-700 dark:text-slate-300">{text}</p>
        </div>
    );
}

function FeatureCard({ icon, title, description }: { icon: string; title: string; description: string }) {
    return (
        <div className="flex items-start gap-4">
            <span className="material-symbols-outlined mt-0.5 text-[20px] text-slate-700 dark:text-slate-300">{icon}</span>
            <div className="min-w-0 max-w-[78%]">
                <p className="text-sm font-extrabold text-slate-950 dark:text-white" style={blogHeadingStyle}>{title}</p>
                <p className="mt-1 text-sm font-semibold leading-6 text-slate-700 dark:text-slate-300">{description}</p>
            </div>
        </div>
    );
}

function ReadinessItem({
    icon,
    title,
    status,
    detail,
    children,
    onConfirm,
}: {
    icon: string;
    title: string;
    status: CheckStatus;
    detail: string;
    children?: React.ReactNode;
    onConfirm?: () => void;
}) {
    const ready = status === "ready";
    const checking = status === "checking";
    const error = status === "error";
    const confirmable = Boolean(onConfirm);

    return (
        <div className="flex items-center gap-4 py-4">
            <span className={`flex size-7 shrink-0 items-center justify-center ${ready ? "text-slate-950 dark:text-white" : error ? "text-red-500" : "text-slate-600 dark:text-slate-300"}`}>
                <span className={`material-symbols-outlined ${checking ? "animate-spin" : ""} text-[20px]`}>
                    {checking ? "progress_activity" : icon}
                </span>
            </span>
            <div className="min-w-0 flex-1">
                <p className="text-sm font-extrabold text-slate-950 dark:text-white" style={blogHeadingStyle}>{title}</p>
                <p className="mt-0.5 truncate text-sm font-semibold text-slate-700 dark:text-slate-300">{detail}</p>
                {children}
            </div>
            {confirmable ? (
                <button
                    type="button"
                    onClick={onConfirm}
                    className="group relative flex shrink-0 justify-center"
                    aria-label={`Confirm ${title}`}
                >
                    <span className="absolute bottom-full right-0 mb-2 whitespace-nowrap rounded-full bg-slate-950 px-3 py-1.5 text-xs font-extrabold text-white shadow-lg shadow-slate-950/15 transition-colors group-hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:group-hover:bg-slate-200">
                        Click to confirm
                        <span className="absolute -bottom-1 right-3 size-2 rotate-45 bg-slate-950 transition-colors group-hover:bg-slate-800 dark:bg-white dark:group-hover:bg-slate-200" />
                    </span>
                    <span className="flex size-9 items-center justify-center rounded-full bg-slate-100 text-slate-500 ring-1 ring-slate-300 transition-colors group-hover:bg-slate-200 group-hover:text-slate-700 dark:bg-lc-surface dark:text-slate-400 dark:ring-lc-border dark:group-hover:bg-lc-hover dark:group-hover:text-slate-200">
                        <span className="material-symbols-outlined text-[24px]">check_circle</span>
                    </span>
                </button>
            ) : (
                <span className={`material-symbols-outlined text-[22px] font-bold ${ready ? "text-emerald-600 dark:text-emerald-400" : error ? "text-red-500" : "text-slate-400 dark:text-slate-500"}`}>
                    {ready ? "check_circle" : error ? "error" : "radio_button_unchecked"}
                </span>
            )}
        </div>
    );
}

export default function WarmupPage() {
    return (
        <Suspense fallback={<div className="p-8 text-sm text-slate-500">Loading pre-join check...</div>}>
            <WarmupContent />
        </Suspense>
    );
}
