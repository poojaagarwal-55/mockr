"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useParams, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import rehypeRaw from "rehype-raw";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneLight, vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { useAuth } from "@/context/auth-context";
import { api } from "@/lib/api";
import { usePeerSocket } from "@/hooks/use-peer-socket";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

const SOLUTION_PRISM_LANGUAGE: Record<string, string> = {
    python: "python",
    python3: "python",
    javascript: "javascript",
    js: "javascript",
    java: "java",
    cpp: "cpp",
    "c++": "cpp",
};

function normalizeComplexityValue(value?: string): string {
    const normalized = (value || "").trim();
    if (!normalized) return "";
    const lowered = normalized.toLowerCase();
    if (["unknown", "n/a", "na", "none"].includes(lowered)) return "";
    return normalized;
}

function cleanExplainationText(value?: string): string {
    const raw = (value || "").trim();
    if (!raw) return "";
    return raw
        .split("\n")
        .filter((line) => {
            const trimmed = line.trim().toLowerCase();
            return !trimmed.startsWith("time complexity:") && !trimmed.startsWith("space complexity:");
        })
        .join("\n")
        .trim();
}

function getSolutionCodeLanguages(code?: Record<string, string>): string[] {
    if (!code) return [];
    const allowed = new Set(["python", "python3", "cpp", "c++", "java", "javascript"]);
    return Object.keys(code).filter((lang) => allowed.has(lang.toLowerCase()) && (code[lang] || "").trim());
}

function difficultyTagClass(difficulty: string): string {
    const d = difficulty.toLowerCase();
    if (d === "easy") return "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400";
    if (d === "medium") return "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400";
    if (d === "hard") return "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400";
    return "bg-slate-100 text-slate-600 dark:bg-white/[0.06] dark:text-slate-300";
}

type SessionResponse = {
    sessionId: string;
    roomId: string;
    status: string;
    interviewType: string;
    timingPreset: "standard_45" | "intense_30" | "deep_60";
    timing: {
        label: string;
        totalMinutes: number;
        rounds: Array<{ key: string; label: string; minutes: number }>;
    };
    startedAt: string | null;
    scheduledFor: string | null;
    me: {
        userId: string;
        participantRole: "interviewer" | "candidate";
        levelAtMatch: string;
        preferredLanguage: string;
        isReady: boolean;
    };
    peer: {
        userId: string;
        participantRole: "interviewer" | "candidate";
        levelAtMatch: string;
        preferredLanguage: string;
        isReady: boolean;
    } | null;
    myQuestion: {
        questionId: string;
        title: string;
        difficulty: string;
        category: string;
        practiceUrl: string;
    } | null;
    peerQuestion: {
        questionId: string;
        title: string;
        difficulty: string;
        category: string;
        practiceUrl: string;
    } | null;
};

type DsaExample = {
    input: unknown;
    output: unknown;
    explanation?: string;
};

type DsaQuestionDetails = {
    id: string;
    title: string;
    statement?: string;
    description?: string;
    problemMd?: string;
    problem_md?: string;
    examples?: DsaExample[];
    constraints?: string[] | string;
    language?: string;
    starter_code?: Record<string, string>;
    hints?: string[];
    solution?: string;
    solutionMd?: string;
    solution_md?: string;
    sample_tests?: Array<{
        id?: string;
        stdin?: unknown;
        expected_output?: unknown;
        input?: unknown;
        output?: unknown;
    }>;
};

type ExecutionResult = {
    status: string;
    passed: boolean;
    stdout?: unknown;
    stderr?: string | null;
    compile_output?: string | null;
    time?: string | null;
    memory?: string | null;
    expected?: unknown;
};

const EDITOR_LANGUAGES: Array<{ value: string; label: string }> = [
    { value: "python", label: "Python" },
    { value: "javascript", label: "JavaScript" },
    { value: "java", label: "Java" },
    { value: "cpp", label: "C++" },
];

const ENDED_SESSION_STATUSES = new Set(["COMPLETED", "ABANDONED", "CANCELLED"]);
const FEEDBACK_ELIGIBLE_END_REASONS = new Set([
    "session_time_elapsed",
    "ended_early_by_interviewer",
    "ended_by_participant",
]);
// Lobby timed out without finding a partner — show the "book another slot" prompt
// rather than the feedback form (the interview never started).
const NO_MATCH_END_REASONS = new Set([
    "no_match_found",
    "scheduled_match_timeout",
]);
const LOBBY_SAME_LEVEL_SECONDS = 2 * 60;
const LOBBY_CROSS_LEVEL_SECONDS = 3 * 60;

function normalizeStarterLanguageKey(language: string): string {
    const value = language.trim().toLowerCase();

    if (["python", "python3", "py"].includes(value)) return "python";
    if (["javascript", "js", "node", "nodejs"].includes(value)) return "javascript";
    if (["typescript", "ts"].includes(value)) return "javascript"; // TS → JS fallback
    if (["java"].includes(value)) return "java";
    if (["cpp", "c++", "cpp17", "cpp20", "cxx"].includes(value)) return "cpp";
    if (["go", "golang"].includes(value)) return "cpp"; // Go → C++ fallback

    return value;
}

function normalizeStarterCodeMap(source?: Record<string, string>): Record<string, string> {
    if (!source) {
        return {};
    }

    const normalized: Record<string, string> = {};

    Object.entries(source).forEach(([rawLanguage, starter]) => {
        const language = normalizeStarterLanguageKey(rawLanguage);
        if (!normalized[language] || normalized[language].trim().length === 0) {
            normalized[language] = starter;
        }
    });

    return normalized;
}

// WebRTC ICE servers. STUN alone only establishes a direct media path when both
// peers are on permissive networks; a real cross-network interview needs a TURN
// relay or audio/video never connect. Configure TURN in production via the
// NEXT_PUBLIC_ICE_SERVERS env var (a JSON array of RTCIceServer), e.g.
//   [{"urls":"stun:stun.l.google.com:19302"},
//    {"urls":"turn:turn.example.com:3478","username":"USER","credential":"CRED"}]
function getIceServers(): RTCIceServer[] {
    const raw = process.env.NEXT_PUBLIC_ICE_SERVERS;
    if (raw) {
        try {
            const parsed = JSON.parse(raw) as RTCIceServer[];
            if (Array.isArray(parsed) && parsed.length > 0) {
                return parsed;
            }
        } catch {
            // Malformed config — fall back to STUN-only below.
        }
    }
    return [{ urls: "stun:stun.l.google.com:19302" }];
}

export default function PeerSessionRoomPage() {
    const { session } = useAuth();
    const params = useParams();
    const router = useRouter();
    const { resolvedTheme, setTheme } = useTheme();
    const {
        connected,
        match,
        sessionState,
        chatMessages,
        sessionCountdown,
        turnState,
        editorState,
        sessionEnded,
        noMatchWarning,
        reconnectingWindowSeconds,
        signalOffer,
        signalAnswer,
        signalIce,
        joinSession,
        reconnectSession,
        markReady,
        sendChatMessage,
        syncTimer,
        advanceTurn,
        endSession,
        syncEditorState,
        sendSignalOffer,
        sendSignalAnswer,
        sendSignalIce,
        executionSync,
        clearSignalOffer,
        clearSignalAnswer,
        clearSignalIce,
        sendExecutionSync,
    } = usePeerSocket();

    const sessionId = params?.sessionId as string;

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [data, setData] = useState<SessionResponse | null>(null);
    const [elapsedSeconds, setElapsedSeconds] = useState(0);
    const [chatInput, setChatInput] = useState("");
    const [mediaError, setMediaError] = useState<string | null>(null);
    const [mediaReady, setMediaReady] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [isCameraOn, setIsCameraOn] = useState(true);
    const [sharedCode, setSharedCode] = useState("");
    const [sharedLanguage, setSharedLanguage] = useState("python");
    const [sharedRevision, setSharedRevision] = useState(0);
    const [editorTheme, setEditorTheme] = useState<"vs-dark" | "light">("vs-dark");
    const [questionDetails, setQuestionDetails] = useState<DsaQuestionDetails | null>(null);
    const [questionLoading, setQuestionLoading] = useState(false);
    const [questionError, setQuestionError] = useState<string | null>(null);
    const [starterCodeByLanguage, setStarterCodeByLanguage] = useState<Record<string, string>>({});
    const [testPanelHeight, setTestPanelHeight] = useState(280);
    const [activeTestCase, setActiveTestCase] = useState(0);
    const [localResults, setLocalResults] = useState<Record<string, ExecutionResult>>({});
    const [hiddenSummary, setHiddenSummary] = useState<{ passed: number; total: number } | null>(null);
    const [isRunning, setIsRunning] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [executionError, setExecutionError] = useState<string | null>(null);
    const [showTurnModal, setShowTurnModal] = useState(false);
    const [countdownSeconds, setCountdownSeconds] = useState<number | null>(null);
    const elapsedSecondsRef = useRef(0);
    const [leftTab, setLeftTab] = useState<"problem" | "hints" | "solution">("problem");
    const [expandedSolution, setExpandedSolution] = useState<"bruteForce" | "optimized" | null>("optimized");
    const [solutionCodeLang, setSolutionCodeLang] = useState<{ bruteForce?: string; optimized?: string }>({});
    const [leftPanelWidth, setLeftPanelWidth] = useState(520);
    const [rightPanelWidth, setRightPanelWidth] = useState(320);
    const [isDesktopWorkspace, setIsDesktopWorkspace] = useState(false);
    const chatEndRef = useRef<HTMLDivElement | null>(null);

    // Floating video widget state
    const [videoPos, setVideoPos] = useState<{ x: number; y: number } | null>(null);
    const [videoExpanded, setVideoExpanded] = useState(false);
    const [videosSwapped, setVideosSwapped] = useState(false);
    const videoDraggingRef = useRef(false);
    const videoDragMovedRef = useRef(false);
    const videoDragOffsetRef = useRef({ x: 0, y: 0 });

    const localVideoRef = useRef<HTMLVideoElement | null>(null);
    const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
    const expandedLocalVideoRef = useRef<HTMLVideoElement | null>(null);
    const expandedRemoteVideoRef = useRef<HTMLVideoElement | null>(null);
    const remoteStreamRef = useRef<MediaStream | null>(null);
    const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
    const pcInitRef = useRef<Promise<RTCPeerConnection | null> | null>(null);
    const iceServersRef = useRef<RTCIceServer[] | null>(null);
    const localStreamRef = useRef<MediaStream | null>(null);
    const offerSentRef = useRef(false);
    const pendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
    const lastHandledOfferSdpRef = useRef<string | null>(null);
    const lastHandledAnswerSdpRef = useRef<string | null>(null);
    const activeQuestionIdRef = useRef<string | null>(null);
    const turnModalShownSessionRef = useRef<string | null>(null);
    // Server-anchored session start (ms). The session timer is derived from this
    // so it never resets on rejoin or when the server re-emits turn/timer state.
    const sessionStartMsRef = useRef<number | null>(null);
    // WebRTC self-healing: which side initiates offers, recovery rate-limiting,
    // a pending grace timer for transient "disconnected", and a ref-held recovery
    // callback the peer-connection event handlers can call without re-creating the
    // connection on every render.
    const isOffererRef = useRef(false);
    const lastRecoveryAtRef = useRef(0);
    const recoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const maybeRecoverRef = useRef<(() => void) | null>(null);
    const autoEndTriggeredRef = useRef(false);
    const sharedCodeRef = useRef("");
    const sharedLanguageRef = useRef("python");
    const monacoEditorRef = useRef<any>(null);
    const syncDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const workspaceRef = useRef<HTMLElement | null>(null);
    const isResizingLeftRef = useRef(false);
    const isResizingRightRef = useRef(false);
    const isResizingTestRef = useRef(false);

    const MIN_LEFT_PANEL_WIDTH = 260;
    const MAX_LEFT_PANEL_WIDTH = 560;
    const MIN_RIGHT_PANEL_WIDTH = 280;
    const MAX_RIGHT_PANEL_WIDTH = 460;
    const MIN_TEST_PANEL_HEIGHT = 180;
    const MAX_TEST_PANEL_HEIGHT = 460;

    const toggleMute = () => {
        setIsMuted((current) => !current);
    };

    const toggleCamera = () => {
        setIsCameraOn((current) => !current);
    };

    useEffect(() => {
        if (!session?.access_token || !sessionId) return;

        let cancelled = false;
        setLoading(true);
        setError(null);

        api.get<SessionResponse>(`/p2p/sessions/${sessionId}`, session.access_token)
            .then((response) => {
                if (cancelled) return;
                setData(response);

                if (response.startedAt) {
                    const started = new Date(response.startedAt).getTime();
                    sessionStartMsRef.current = started;
                    const diff = Math.floor((Date.now() - started) / 1000);
                    setElapsedSeconds(Math.max(0, diff));
                }
            })
            .catch((err) => {
                if (cancelled) return;
                const message = err instanceof Error ? err.message : "Failed to load peer session";
                setError(message);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [session?.access_token, sessionId]);

    useEffect(() => {
        if (!data) return;

        // Derive elapsed time from the server-anchored start so the timer stays
        // correct across rejoins/refreshes and is identical for both peers. Only
        // fall back to a local increment if the start anchor isn't known yet.
        const tick = () => {
            const startMs = sessionStartMsRef.current;
            if (startMs != null) {
                setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));
            } else {
                setElapsedSeconds((current) => current + 1);
            }
        };

        tick();
        const timer = setInterval(tick, 1000);

        return () => clearInterval(timer);
    }, [data?.sessionId]);

    const currentSessionStatus = (sessionState?.status || data?.status || "").toUpperCase();
    const sessionHasEnded = ENDED_SESSION_STATUSES.has(currentSessionStatus);

    useEffect(() => {
        if (!sessionId) {
            return;
        }

        const endedBySocketEvent =
            sessionEnded?.peerSessionId === sessionId &&
            FEEDBACK_ELIGIBLE_END_REASONS.has(sessionEnded.reason);
        const endedStatusCanShowFeedback =
            currentSessionStatus === "COMPLETED" ||
            (sessionHasEnded && Boolean(data?.startedAt));

        if (!endedBySocketEvent && !endedStatusCanShowFeedback) {
            return;
        }

        router.replace(`/interviews/peer/session/${sessionId}/feedback`);
    }, [currentSessionStatus, data?.startedAt, router, sessionEnded?.peerSessionId, sessionEnded?.reason, sessionHasEnded, sessionId]);

    useEffect(() => {
        offerSentRef.current = false;
        pendingIceCandidatesRef.current = [];
        lastHandledOfferSdpRef.current = null;
        lastHandledAnswerSdpRef.current = null;
        turnModalShownSessionRef.current = null;
        pcInitRef.current = null;
        sessionStartMsRef.current = null;
        lastRecoveryAtRef.current = 0;
        autoEndTriggeredRef.current = false;
        if (recoveryTimerRef.current) {
            clearTimeout(recoveryTimerRef.current);
            recoveryTimerRef.current = null;
        }
        setShowTurnModal(false);
    }, [sessionId]);

    useEffect(() => {
        sharedCodeRef.current = sharedCode;
    }, [sharedCode]);

    useEffect(() => {
        sharedLanguageRef.current = sharedLanguage;
    }, [sharedLanguage]);

    useEffect(() => {
        if (typeof window === "undefined") {
            return;
        }

        const updateDesktopState = () => {
            setIsDesktopWorkspace(window.innerWidth >= 1280);
        };

        updateDesktopState();
        window.addEventListener("resize", updateDesktopState);

        return () => {
            window.removeEventListener("resize", updateDesktopState);
        };
    }, []);

    useEffect(() => {
        setEditorTheme(resolvedTheme === "dark" ? "vs-dark" : "light");
    }, [resolvedTheme]);

    useEffect(() => {
        const handleMouseMove = (event: MouseEvent) => {
            if (!isDesktopWorkspace || !workspaceRef.current) {
                return;
            }

            const workspaceRect = workspaceRef.current.getBoundingClientRect();

            if (isResizingLeftRef.current) {
                const nextWidth = event.clientX - workspaceRect.left;
                setLeftPanelWidth(Math.max(MIN_LEFT_PANEL_WIDTH, Math.min(MAX_LEFT_PANEL_WIDTH, nextWidth)));
            }

            if (isResizingRightRef.current) {
                const nextWidth = workspaceRect.right - event.clientX;
                setRightPanelWidth(Math.max(MIN_RIGHT_PANEL_WIDTH, Math.min(MAX_RIGHT_PANEL_WIDTH, nextWidth)));
            }

            if (isResizingTestRef.current) {
                const editorSection = document.getElementById("peer-editor-section");
                if (!editorSection) {
                    return;
                }

                const editorRect = editorSection.getBoundingClientRect();
                const nextHeight = editorRect.bottom - event.clientY;
                setTestPanelHeight(Math.max(MIN_TEST_PANEL_HEIGHT, Math.min(MAX_TEST_PANEL_HEIGHT, nextHeight)));
            }
        };

        const handleMouseUp = () => {
            isResizingLeftRef.current = false;
            isResizingRightRef.current = false;
            isResizingTestRef.current = false;
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
        };

        window.addEventListener("mousemove", handleMouseMove);
        window.addEventListener("mouseup", handleMouseUp);

        return () => {
            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("mouseup", handleMouseUp);
        };
    }, [isDesktopWorkspace]);

    const ensurePeerConnection = useCallback(async (): Promise<RTCPeerConnection | null> => {
        if (!sessionId) {
            return null;
        }

        if (peerConnectionRef.current) {
            return peerConnectionRef.current;
        }

        // Serialize creation: resolving ICE servers is async, so without this lock
        // concurrent callers (media init, offer creation, incoming signals) could
        // each pass the null-check during the await and create duplicate peer
        // connections — which breaks signaling and media.
        if (pcInitRef.current) {
            return pcInitRef.current;
        }

        pcInitRef.current = (async () => {
            // Resolve ICE servers from the backend (Cloudflare TURN, minted per
            // session). Cache for this room; fall back to STUN/env on failure.
            if (!iceServersRef.current) {
                try {
                    const resp = await api.get<{ iceServers: RTCIceServer[] }>("/p2p/ice-servers", session?.access_token);
                    iceServersRef.current =
                        Array.isArray(resp?.iceServers) && resp.iceServers.length > 0
                            ? resp.iceServers
                            : getIceServers();
                } catch {
                    iceServersRef.current = getIceServers();
                }
            }

            const pc = new RTCPeerConnection({
                iceServers: iceServersRef.current,
            });

            pc.onicecandidate = (event) => {
                if (!event.candidate) {
                    return;
                }

                sendSignalIce(sessionId, JSON.stringify(event.candidate.toJSON()));
            };

            pc.ontrack = (event) => {
                const remoteStream = event.streams[0];
                if (!remoteStream) {
                    return;
                }

                remoteStreamRef.current = remoteStream;

                if (!remoteVideoRef.current) {
                    return;
                }

                remoteVideoRef.current.srcObject = remoteStream;
                void remoteVideoRef.current.play().catch(() => {
                    // Browser autoplay policies can block remote media until interaction.
                });
            };

            // Lightweight diagnostics: surface ICE/connection progress in the console
            // so a failed media connection (e.g. TURN not reached) is easy to spot.
            pc.oniceconnectionstatechange = () => {
                console.info("[p2p][webrtc] iceConnectionState:", pc.iceConnectionState);
                maybeRecoverRef.current?.();
            };
            pc.onconnectionstatechange = () => {
                console.info("[p2p][webrtc] connectionState:", pc.connectionState);
                if (pc.connectionState === "connected") {
                    setMediaError(null);
                }
                maybeRecoverRef.current?.();
            };

            peerConnectionRef.current = pc;

            if (localStreamRef.current) {
                localStreamRef.current.getTracks().forEach((track) => {
                    pc.addTrack(track, localStreamRef.current as MediaStream);
                });
            }

            return pc;
        })();

        return pcInitRef.current;
    }, [sendSignalIce, sessionId, session?.access_token]);

    const flushQueuedIceCandidates = useCallback(async (pc: RTCPeerConnection) => {
        if (!pc.remoteDescription || pendingIceCandidatesRef.current.length === 0) {
            return;
        }

        const queue = [...pendingIceCandidatesRef.current];
        pendingIceCandidatesRef.current = [];

        for (const candidate of queue) {
            await pc.addIceCandidate(candidate);
        }
    }, []);

    // Recover a broken media connection in-place (no leave/rejoin needed). The
    // deterministic offerer re-negotiates with an ICE restart; the answerer nudges
    // ICE and resets its offer de-dupe so it will accept the offerer's fresh offer.
    const restartConnection = useCallback(async () => {
        const pc = peerConnectionRef.current;
        if (!pc || !sessionId) return;

        const now = Date.now();
        if (now - lastRecoveryAtRef.current < 4000) return; // rate-limit retries
        lastRecoveryAtRef.current = now;

        try {
            if (isOffererRef.current) {
                // Allow the returning answer (new SDP) to be applied again.
                lastHandledAnswerSdpRef.current = null;
                const offer = await pc.createOffer({ iceRestart: true });
                await pc.setLocalDescription(offer);
                sendSignalOffer(sessionId, offer.sdp || "");
            } else {
                // Answerer can't initiate; ready it to accept the offerer's restart.
                lastHandledOfferSdpRef.current = null;
                pc.restartIce?.();
            }
        } catch {
            // Best-effort; the watchdog/state-change handlers will retry.
        }
    }, [sendSignalOffer, sessionId]);

    const maybeRecover = useCallback(() => {
        const pc = peerConnectionRef.current;
        if (!pc) return;

        const failed = pc.connectionState === "failed" || pc.iceConnectionState === "failed";
        const disconnected = pc.connectionState === "disconnected" || pc.iceConnectionState === "disconnected";
        const healthy =
            pc.connectionState === "connected" ||
            pc.iceConnectionState === "connected" ||
            pc.iceConnectionState === "completed";

        if (healthy) {
            if (recoveryTimerRef.current) {
                clearTimeout(recoveryTimerRef.current);
                recoveryTimerRef.current = null;
            }
            return;
        }

        if (failed) {
            if (recoveryTimerRef.current) {
                clearTimeout(recoveryTimerRef.current);
                recoveryTimerRef.current = null;
            }
            void restartConnection();
            return;
        }

        if (disconnected && !recoveryTimerRef.current) {
            // Many "disconnected" blips self-heal; give it a short grace first.
            recoveryTimerRef.current = setTimeout(() => {
                recoveryTimerRef.current = null;
                const current = peerConnectionRef.current;
                if (!current) return;
                const stillBad =
                    current.iceConnectionState !== "connected" &&
                    current.iceConnectionState !== "completed" &&
                    current.connectionState !== "connected";
                if (stillBad) void restartConnection();
            }, 3000);
        }
    }, [restartConnection]);

    useEffect(() => {
        maybeRecoverRef.current = maybeRecover;
    }, [maybeRecover]);

    // Watchdog: state-change events can be missed (esp. asymmetric failures), so
    // periodically re-check connection health while media is live.
    useEffect(() => {
        if (!mediaReady) return;
        const interval = window.setInterval(() => maybeRecoverRef.current?.(), 5000);
        return () => window.clearInterval(interval);
    }, [mediaReady]);

    useEffect(() => {
        if (!data?.sessionId || typeof navigator === "undefined") {
            return;
        }

        let cancelled = false;

        const initMedia = async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: true,
                    audio: true,
                });

                if (cancelled) {
                    stream.getTracks().forEach((track) => track.stop());
                    return;
                }

                localStreamRef.current = stream;
                setMediaReady(true);
                setMediaError(null);

                if (localVideoRef.current) {
                    localVideoRef.current.srcObject = stream;
                }

                const pc = await ensurePeerConnection();
                if (pc) {
                    stream.getTracks().forEach((track) => {
                        const alreadyAdded = pc.getSenders().some((sender) => sender.track === track);
                        if (!alreadyAdded) {
                            pc.addTrack(track, stream);
                        }
                    });
                }
            } catch (err) {
                const message = err instanceof Error ? err.message : "Unable to access camera/microphone";
                setMediaError(message);
            }
        };

        initMedia();

        return () => {
            cancelled = true;
        };
    }, [data?.sessionId, ensurePeerConnection]);

    useEffect(() => {
        if (!localStreamRef.current) {
            return;
        }

        localStreamRef.current.getAudioTracks().forEach((track) => {
            track.enabled = !isMuted;
        });
    }, [isMuted, mediaReady]);

    useEffect(() => {
        if (!localStreamRef.current) {
            return;
        }

        localStreamRef.current.getVideoTracks().forEach((track) => {
            track.enabled = isCameraOn;
        });
    }, [isCameraOn, mediaReady]);

    useEffect(() => {
        return () => {
            peerConnectionRef.current?.close();
            peerConnectionRef.current = null;
            pcInitRef.current = null;
            localStreamRef.current?.getTracks().forEach((track) => track.stop());
            localStreamRef.current = null;
            pendingIceCandidatesRef.current = [];
        };
    }, []);

    useEffect(() => {
        if (!sessionId) return;
        joinSession(sessionId);
    }, [joinSession, sessionId]);

    // Entering the room for a not-yet-started scheduled session means the user is
    // in the waiting room. Mark ready over the live (connected) session socket so
    // the lobby matcher can pair them — more reliable than emitting on the peer
    // page right before navigating away.
    useEffect(() => {
        if (!connected || !sessionId || !data) return;
        const status = (sessionState?.status || data.status || "").toUpperCase();
        if (data.startedAt || !["PENDING", "MATCHED"].includes(status)) return;
        markReady(sessionId);
    }, [connected, data, markReady, sessionId, sessionState?.status]);

    useEffect(() => {
        if (!match?.peerSessionId || match.peerSessionId === sessionId) {
            return;
        }

        router.replace(`/interviews/peer/session/${match.peerSessionId}`);
    }, [match?.peerSessionId, router, sessionId]);

    useEffect(() => {
        if (!connected || !sessionId) return;
        reconnectSession(sessionId);
    }, [connected, reconnectSession, sessionId]);

    // NOTE: we intentionally do NOT drive the session timer from `peer:timer-sync`.
    // The server emits that event with per-turn (and often zero) elapsed values and
    // re-emits it on every reconnect/turn-state change, which previously reset the
    // visible session timer. The timer is now derived solely from the server start
    // anchor above, so it is consistent and reset-proof.

    // When the session goes ACTIVE but we don't yet have the server start anchor
    // (e.g. we entered from the waiting room), fetch it once so the timer is exact.
    useEffect(() => {
        if (currentSessionStatus !== "ACTIVE") return;
        if (sessionStartMsRef.current != null) return;
        if (!session?.access_token || !sessionId) return;

        let cancelled = false;
        api.get<SessionResponse>(`/p2p/sessions/${sessionId}`, session.access_token)
            .then((response) => {
                if (cancelled) return;
                setData(response);
                sessionStartMsRef.current = response.startedAt
                    ? new Date(response.startedAt).getTime()
                    : Date.now();
            })
            .catch(() => undefined);

        return () => {
            cancelled = true;
        };
    }, [currentSessionStatus, session?.access_token, sessionId]);

    useEffect(() => {
        if (!editorState || editorState.peerSessionId !== sessionId) {
            return;
        }

        // The server broadcasts editor-state to the whole room, including the
        // sender. Ignoring our own echo prevents the language dropdown / cursor
        // from being reset by a round-trip of an update we just made.
        if (editorState.updatedByUserId && data && editorState.updatedByUserId === data.me.userId) {
            setSharedRevision((current) => Math.max(current, editorState.revision));
            return;
        }

        if (editorState.revision === 0 && !editorState.code?.trim() && sharedCodeRef.current.trim().length > 0) {
            return;
        }

        if (editorState.revision < sharedRevision) {
            return;
        }

        if (editorState.code || !sharedCodeRef.current.trim()) {
            const newCode = editorState.code;
            sharedCodeRef.current = newCode;
            const editor = monacoEditorRef.current;
            if (editor) {
                const model = editor.getModel();
                if (model && model.getValue() !== newCode) {
                    const pos = editor.getPosition();
                    const scrollTop = editor.getScrollTop();
                    model.setValue(newCode);
                    if (pos) editor.setPosition(pos);
                    editor.setScrollTop(scrollTop);
                }
            } else {
                setSharedCode(newCode);
            }
        }

        if (editorState.language && editorState.updatedByUserId) {
            setSharedLanguage(editorState.language);
        }
        setSharedRevision((current) => Math.max(current, editorState.revision));
    }, [editorState, sessionId, sharedRevision, data?.me.userId]);

    useEffect(() => {
        return () => {
            if (syncDebounceRef.current) {
                clearTimeout(syncDebounceRef.current);
                syncDebounceRef.current = null;
            }
        };
    }, []);

    // Keep the deterministic offerer role in sync for the recovery path.
    useEffect(() => {
        if (!data) return;
        isOffererRef.current = data.peer
            ? data.me.userId.localeCompare(data.peer.userId) < 0
            : data.me.participantRole === "interviewer";
    }, [data]);

    useEffect(() => {
        if (!data || !sessionId || !mediaReady || offerSentRef.current) {
            return;
        }

        const shouldInitiateOffer = data.peer
            ? data.me.userId.localeCompare(data.peer.userId) < 0
            : data.me.participantRole === "interviewer";

        if (!shouldInitiateOffer) {
            return;
        }

        const beginOffer = async () => {
            const pc = await ensurePeerConnection();
            if (!pc || pc.signalingState !== "stable" || pc.currentLocalDescription) {
                return;
            }

            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            sendSignalOffer(sessionId, offer.sdp || "");
            offerSentRef.current = true;
        };

        beginOffer().catch((err) => {
            const message = err instanceof Error ? err.message : "Failed to create WebRTC offer";
            setMediaError(message);
        });
    }, [data, ensurePeerConnection, mediaReady, sendSignalOffer, sessionId]);

    useEffect(() => {
        if (!signalOffer || signalOffer.peerSessionId !== sessionId) {
            return;
        }

        const handleOffer = async () => {
            const pc = await ensurePeerConnection();
            if (!pc) {
                return;
            }

            if (lastHandledOfferSdpRef.current === signalOffer.sdp) {
                return;
            }
            lastHandledOfferSdpRef.current = signalOffer.sdp;

            if (pc.currentRemoteDescription?.type === "offer" && pc.currentRemoteDescription.sdp === signalOffer.sdp) {
                return;
            }

            if (pc.signalingState === "have-local-offer") {
                try {
                    // Glare resolution: rollback local offer before handling remote offer.
                    await pc.setLocalDescription({ type: "rollback" });
                } catch {
                    return;
                }
            }

            if (pc.signalingState !== "stable") {
                return;
            }

            await pc.setRemoteDescription({ type: "offer", sdp: signalOffer.sdp });

            if (pc.remoteDescription?.type !== "offer") {
                return;
            }

            await flushQueuedIceCandidates(pc);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            sendSignalAnswer(signalOffer.peerSessionId, answer.sdp || "");
        };

        handleOffer()
            .catch((err) => {
                const message = err instanceof Error ? err.message : "Failed to process WebRTC offer";
                setMediaError(message);
            })
            .finally(() => {
                clearSignalOffer();
            });
    }, [clearSignalOffer, ensurePeerConnection, flushQueuedIceCandidates, sendSignalAnswer, sessionId, signalOffer]);

    useEffect(() => {
        if (!signalAnswer || signalAnswer.peerSessionId !== sessionId) {
            return;
        }

        const handleAnswer = async () => {
            const pc = await ensurePeerConnection();
            if (!pc) {
                return;
            }

            if (lastHandledAnswerSdpRef.current === signalAnswer.sdp) {
                return;
            }
            lastHandledAnswerSdpRef.current = signalAnswer.sdp;

            // Only apply when we're expecting an answer. We deliberately do NOT
            // bail on an existing remoteDescription here: an ICE-restart answer
            // arrives after a prior negotiation already set one. The SDP de-dupe
            // above prevents applying the same answer twice.
            if (pc.signalingState !== "have-local-offer") {
                return;
            }

            await pc.setRemoteDescription({ type: "answer", sdp: signalAnswer.sdp });
            await flushQueuedIceCandidates(pc);
        };

        handleAnswer()
            .catch((err) => {
                const message = err instanceof Error ? err.message : "Failed to process WebRTC answer";
                setMediaError(message);
            })
            .finally(() => {
                clearSignalAnswer();
            });
    }, [clearSignalAnswer, ensurePeerConnection, flushQueuedIceCandidates, sessionId, signalAnswer]);

    useEffect(() => {
        if (!signalIce || signalIce.peerSessionId !== sessionId) {
            return;
        }

        const handleIce = async () => {
            const pc = await ensurePeerConnection();
            if (!pc) {
                return;
            }

            const candidate = JSON.parse(signalIce.candidate) as RTCIceCandidateInit;

            if (!pc.remoteDescription) {
                pendingIceCandidatesRef.current.push(candidate);
                return;
            }

            await pc.addIceCandidate(candidate);
        };

        handleIce()
            .catch((err) => {
                const message = err instanceof Error ? err.message : "Failed to process ICE candidate";
                setMediaError(message);
            })
            .finally(() => {
                clearSignalIce();
            });
    }, [clearSignalIce, ensurePeerConnection, sessionId, signalIce]);

    const totalSeconds = useMemo(() => {
        if (!data) return 0;
        return data.timing.totalMinutes * 60;
    }, [data]);

    const roundInfo = useMemo(() => {
        if (!data) return null;

        let acc = 0;
        for (const round of data.timing.rounds) {
            const roundEnd = acc + round.minutes * 60;
            if (elapsedSeconds < roundEnd) {
                return {
                    key: round.key,
                    label: round.label,
                    remaining: roundEnd - elapsedSeconds,
                };
            }
            acc = roundEnd;
        }

        return {
            key: "done",
            label: "Session Complete",
            remaining: 0,
        };
    }, [data, elapsedSeconds]);

    const sessionRemaining = Math.max(0, totalSeconds - elapsedSeconds);
    // Timer urgency colour: amber in the last 10 min, red in the last 5 min.
    const timerColorClass =
        sessionRemaining <= 300
            ? "text-red-600 dark:text-red-400"
            : sessionRemaining <= 600
                ? "text-amber-600 dark:text-amber-400"
                : "text-slate-700 dark:text-slate-200";
    const canCurrentInterviewerControlTurn = Boolean(
        data && turnState?.activeInterviewerUserId === data.me.userId
    );
    const canSwitchTurn = Boolean(canCurrentInterviewerControlTurn && turnState?.canCurrentInterviewerAdvance);
    const canEndInterview = Boolean(data && turnState);

    const activeCandidateUserId = turnState?.activeCandidateUserId || sessionState?.turn?.activeCandidateUserId || null;
    const canEditSharedEditor = Boolean(
        data &&
            activeCandidateUserId === data.me.userId &&
            !(sessionEnded && sessionEnded.peerSessionId === sessionId)
    );
    // Both candidate and interviewer can run/submit code — interviewer observes results
    const canRunCode = Boolean(data && !(sessionEnded && sessionEnded.peerSessionId === sessionId));

    const languageOptions = useMemo(() => {
        const allowed = new Set(EDITOR_LANGUAGES.map((o) => o.value));
        const preferred = [sharedLanguage, data?.me.preferredLanguage, data?.peer?.preferredLanguage]
            .filter(Boolean)
            .map((v) => normalizeStarterLanguageKey(v!))
            .filter((v) => allowed.has(v));
        const merged = [
            ...preferred,
            ...EDITOR_LANGUAGES.map((option) => option.value),
        ];

        const seen = new Set<string>();
        const uniqueValues = merged.filter((value) => {
            if (seen.has(value)) return false;
            seen.add(value);
            return true;
        });

        return uniqueValues.map((value) => {
            return EDITOR_LANGUAGES.find((option) => option.value === value) || { value, label: value.toUpperCase() };
        });
    }, [data?.me.preferredLanguage, data?.peer?.preferredLanguage, sharedLanguage]);

    const activeQuestion = useMemo(() => {
        if (!data) {
            return null;
        }

        // The candidate solves the question the INTERVIEWER prepared (the prep
        // question is "the question you'll ask"). So when I'm the candidate I
        // solve my peer's prepped question; when my peer is the candidate they
        // solve the question I prepared — which I see while interviewing.
        if (!activeCandidateUserId) {
            return data.myQuestion;
        }

        if (activeCandidateUserId === data.me.userId) {
            return data.peerQuestion;
        }

        return data.myQuestion;
    }, [activeCandidateUserId, data]);

    const activeQuestionOwner = useMemo(() => {
        if (!data || !activeCandidateUserId) {
            return "You";
        }

        return activeCandidateUserId === data.me.userId ? "You" : "Peer";
    }, [activeCandidateUserId, data]);

    const sessionStatus = (sessionState?.status || data?.status || "").toUpperCase();

    // Self-heal a missing active question: in lobby-merged sessions a participant's
    // assignment is created server-side on first load, so the side that loaded
    // before it existed can show "still syncing". Refetch while live until the
    // active question resolves.
    useEffect(() => {
        if (!session?.access_token || !sessionId || !data) return;
        const sessionLive = Boolean(turnState) || sessionStatus === "ACTIVE";
        if (!sessionLive || activeQuestion) return;

        const timer = window.setTimeout(() => {
            api.get<SessionResponse>(`/p2p/sessions/${sessionId}`, session.access_token!)
                .then(setData)
                .catch(() => undefined);
        }, 1500);
        return () => window.clearTimeout(timer);
    }, [activeQuestion, turnState, sessionStatus, data, session?.access_token, sessionId]);

    useEffect(() => {
        if (!sessionCountdown || sessionCountdown.peerSessionId !== sessionId) {
            setCountdownSeconds(null);
            return;
        }

        const startsAtMs = new Date(sessionCountdown.startsAt).getTime();
        const tick = () => {
            const remaining = Math.max(0, Math.ceil((startsAtMs - Date.now()) / 1000));
            setCountdownSeconds(remaining);
        };

        tick();
        const timer = window.setInterval(tick, 1000);

        return () => {
            window.clearInterval(timer);
        };
    }, [sessionCountdown, sessionId]);

    const waitingSeconds = countdownSeconds;
    const hasLiveTurnState = Boolean(turnState && turnState.peerSessionId === sessionId);
    const showNoMatch = Boolean(
        sessionEnded &&
        sessionEnded.peerSessionId === sessionId &&
        NO_MATCH_END_REASONS.has(sessionEnded.reason) &&
        !data?.startedAt
    );
    // The 5-second pre-start countdown (driven by a server-synced `startsAt`) must
    // fully elapse before anyone enters the workspace. While it is running we hold
    // BOTH peers on the countdown screen, so they cross into the live room together
    // — never one early while the other is still matching, and never a solo entry.
    const hasCountdownRunning = waitingSeconds !== null && waitingSeconds > 0;
    const sessionIsLive = !hasCountdownRunning && (sessionStatus === "ACTIVE" || hasLiveTurnState);
    const isSessionWaitingToStart = Boolean(
        data &&
        !sessionHasEnded &&
        !showNoMatch &&
        !sessionIsLive
    );

    // Cosmetic lobby timer: counts up while genuinely searching for a partner
    // (not during the 5s match countdown). Phase 1 (≤2 min) is same-level only,
    // then it expands to other levels with ~3 min more before the server gives up.
    const isFindingPeer = isSessionWaitingToStart && waitingSeconds === null;
    const [lobbyElapsedSec, setLobbyElapsedSec] = useState(0);

    useEffect(() => {
        if (!isFindingPeer) {
            setLobbyElapsedSec(0);
            return;
        }
        setLobbyElapsedSec(0);
        const timer = window.setInterval(() => setLobbyElapsedSec((current) => current + 1), 1000);
        return () => window.clearInterval(timer);
    }, [isFindingPeer, sessionId]);

    const lobbyPhase = lobbyElapsedSec < LOBBY_SAME_LEVEL_SECONDS ? "same" : "cross";
    const lobbyRemainingSec = lobbyPhase === "same"
        ? Math.max(0, LOBBY_SAME_LEVEL_SECONDS - lobbyElapsedSec)
        : Math.max(0, LOBBY_SAME_LEVEL_SECONDS + LOBBY_CROSS_LEVEL_SECONDS - lobbyElapsedSec);

    useEffect(() => {
        if (!showNoMatch) return;
        const redirect = window.setTimeout(() => router.replace("/interviews/peer"), 8000);
        return () => window.clearTimeout(redirect);
    }, [router, showNoMatch]);

    useEffect(() => {
        if (localVideoRef.current && localStreamRef.current) {
            localVideoRef.current.srcObject = localStreamRef.current;
        }

        if (remoteVideoRef.current && remoteStreamRef.current) {
            remoteVideoRef.current.srcObject = remoteStreamRef.current;
            void remoteVideoRef.current.play().catch(() => {
                // Browser autoplay policies can block remote media until interaction.
            });
        }
    }, [isSessionWaitingToStart, mediaReady, sessionStatus, turnState?.turnNumber]);

    // Attach streams to the expanded-modal video elements only when the modal
    // opens (or media changes) — using stable refs + an effect instead of inline
    // ref callbacks, which previously reassigned srcObject and called play() on
    // every render (the 1s timer re-renders constantly), causing visible flicker.
    useEffect(() => {
        if (!videoExpanded) return;

        if (expandedRemoteVideoRef.current && remoteStreamRef.current) {
            expandedRemoteVideoRef.current.srcObject = remoteStreamRef.current;
            void expandedRemoteVideoRef.current.play().catch(() => {});
        }

        if (expandedLocalVideoRef.current && localStreamRef.current) {
            expandedLocalVideoRef.current.srcObject = localStreamRef.current;
            void expandedLocalVideoRef.current.play().catch(() => {});
        }
    }, [videoExpanded, mediaReady]);

    const testCasesToDisplay = useMemo(() => {
        return questionDetails?.sample_tests || [];
    }, [questionDetails?.sample_tests]);

    useEffect(() => {
        if (!chatMessages.length) {
            return;
        }

        chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }, [chatMessages.length]);

    // Drag handlers for floating video widget
    useEffect(() => {
        const onMove = (e: MouseEvent) => {
            if (!videoDraggingRef.current) return;
            videoDragMovedRef.current = true;
            setVideoPos({ x: e.clientX - videoDragOffsetRef.current.x, y: e.clientY - videoDragOffsetRef.current.y });
        };
        const onUp = () => { videoDraggingRef.current = false; };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
        return () => {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
        };
    }, []);

    useEffect(() => {
        const questionId = activeQuestion?.questionId;
        if (!session?.access_token || !questionId) {
            setQuestionDetails(null);
            setQuestionError(null);
            activeQuestionIdRef.current = null;
            return;
        }

        let cancelled = false;
        setQuestionLoading(true);
        setQuestionError(null);
        setActiveTestCase(0);
        setLocalResults({});
        setExecutionError(null);
        setHiddenSummary(null);

        api.get<DsaQuestionDetails>(`/ide/question/${questionId}`, session.access_token)
            .then((response) => {
                if (cancelled) {
                    return;
                }
                setQuestionDetails(response);

                const starterCode = normalizeStarterCodeMap(response.starter_code);
                setStarterCodeByLanguage(starterCode);
                const availableLanguages = Object.keys(starterCode);
                const defaultLanguage = normalizeStarterLanguageKey(data?.me.preferredLanguage || response.language || "cpp");
                const currentLanguage = normalizeStarterLanguageKey(sharedLanguageRef.current);
                const nextLanguage = starterCode[currentLanguage]
                    ? currentLanguage
                    : starterCode[defaultLanguage]
                        ? defaultLanguage
                        : availableLanguages[0] || currentLanguage;
                const nextStarter = starterCode[nextLanguage] || "";
                const isQuestionChanged = activeQuestionIdRef.current !== questionId;

                if (isQuestionChanged) {
                    activeQuestionIdRef.current = questionId;
                    setSharedLanguage(nextLanguage);
                    sharedCodeRef.current = nextStarter;
                    if (monacoEditorRef.current) {
                        monacoEditorRef.current.setValue(nextStarter);
                    } else {
                        setSharedCode(nextStarter);
                    }
                    setSharedRevision(0);
                } else if (!sharedCodeRef.current.trim() && nextStarter) {
                    setSharedLanguage(nextLanguage);
                    sharedCodeRef.current = nextStarter;
                    if (monacoEditorRef.current) {
                        monacoEditorRef.current.setValue(nextStarter);
                    } else {
                        setSharedCode(nextStarter);
                    }
                }
            })
            .catch((err) => {
                if (cancelled) {
                    return;
                }

                const message = err instanceof Error ? err.message : "Failed to load question details";
                setQuestionError(message);
                setQuestionDetails(null);
                setStarterCodeByLanguage({});
            })
            .finally(() => {
                if (!cancelled) {
                    setQuestionLoading(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [activeQuestion?.questionId, session?.access_token]);

    useEffect(() => {
        if (!data || !turnState || isSessionWaitingToStart) {
            return;
        }

        if (turnModalShownSessionRef.current === sessionId) {
            return;
        }

        turnModalShownSessionRef.current = sessionId;
        setShowTurnModal(true);
    }, [data, isSessionWaitingToStart, sessionId, turnState]);

    useEffect(() => {
        if (!executionSync || executionSync.peerSessionId !== sessionId) {
            return;
        }

        if (executionSync.phase === "running") {
            setExecutionError(null);
            setIsRunning(executionSync.mode === "run");
            setIsSubmitting(executionSync.mode === "submit");
            return;
        }

        setIsRunning(false);
        setIsSubmitting(false);
        if (executionSync.executionError) {
            setExecutionError(executionSync.executionError);
        } else {
            setExecutionError(null);
        }

        if (executionSync.results) {
            setLocalResults(executionSync.results as Record<string, ExecutionResult>);
        }

        if (executionSync.hiddenSummary !== undefined) {
            setHiddenSummary(executionSync.hiddenSummary || null);
        }
    }, [executionSync, sessionId]);

    useEffect(() => {
        elapsedSecondsRef.current = elapsedSeconds;
    }, [elapsedSeconds]);

    useEffect(() => {
        if (!data || !roundInfo || roundInfo.key === "done") return;
        if (turnState?.activeInterviewerUserId && turnState.activeInterviewerUserId !== data.me.userId) return;

        const interval = setInterval(() => {
            syncTimer(data.sessionId, roundInfo.key, elapsedSecondsRef.current);
        }, 5000);

        return () => clearInterval(interval);
    }, [data, roundInfo?.key, syncTimer, turnState?.activeInterviewerUserId]);

    // When the allotted session time runs out, end the interview automatically so
    // both participants are taken to the feedback form. The server also ends it on
    // its own orchestrator tick; emitting here guarantees a prompt, reliable end
    // (and is idempotent — completeSession only acts on a non-terminal session).
    useEffect(() => {
        if (currentSessionStatus !== "ACTIVE") return;
        if (sessionStartMsRef.current == null) return;
        if (sessionRemaining > 0) return;
        if (autoEndTriggeredRef.current) return;
        autoEndTriggeredRef.current = true;
        if (data) endSession(data.sessionId);
    }, [currentSessionStatus, sessionRemaining, data, endSession]);

    const formatDuration = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    };

    const handleEditorChange = (nextCode: string | undefined) => {
        const normalized = nextCode || "";
        sharedCodeRef.current = normalized;

        if (!canEditSharedEditor || !data) {
            return;
        }

        if (syncDebounceRef.current) {
            clearTimeout(syncDebounceRef.current);
        }

        syncDebounceRef.current = setTimeout(() => {
            syncEditorState({
                peerSessionId: data.sessionId,
                code: normalized,
                // Read the ref so a keystroke that lands right after a language
                // switch still reports the current language, not a stale closure.
                language: sharedLanguageRef.current,
                revision: sharedRevision + 1,
            });
        }, 300);
    };

    const handleLanguageChange = (nextLanguage: string) => {
        const normalizedLanguage = normalizeStarterLanguageKey(nextLanguage);
        const starter = starterCodeByLanguage[normalizedLanguage];
        const nextCode = starter ?? sharedCodeRef.current;
        setSharedLanguage(normalizedLanguage);
        sharedLanguageRef.current = normalizedLanguage;
        sharedCodeRef.current = nextCode;
        if (monacoEditorRef.current) {
            monacoEditorRef.current.setValue(nextCode);
        } else {
            setSharedCode(nextCode);
        }

        if (!canEditSharedEditor || !data) {
            return;
        }

        syncEditorState({
            peerSessionId: data.sessionId,
            code: nextCode,
            language: normalizedLanguage,
            revision: sharedRevision + 1,
        });
    };

    const handleSendChat = () => {
        const text = chatInput.trim();
        if (!text || !sessionId) return;
        sendChatMessage(sessionId, text);
        setChatInput("");
    };

    const formatValue = (value: unknown): string => {
        if (typeof value === "string") {
            return value;
        }

        if (value === null || value === undefined) {
            return "";
        }

        try {
            return JSON.stringify(value, null, 2);
        } catch {
            return String(value);
        }
    };

    const executeCode = async (mode: "run" | "submit") => {
        const questionId = activeQuestion?.questionId;
        if (!session?.access_token || !questionId || !canRunCode) {
            return;
        }

        if (mode === "run") {
            setIsRunning(true);
        } else {
            setIsSubmitting(true);
        }

        setExecutionError(null);
        if (mode === "submit") {
            setHiddenSummary(null);
        }

        const runningResults: Record<string, ExecutionResult> = {};
        testCasesToDisplay.forEach((testCase, index) => {
            const testId = testCase.id || `case_${index}`;
            runningResults[testId] = {
                status: "Running",
                passed: false,
            };
        });
        setLocalResults(runningResults);
        sendExecutionSync({
            peerSessionId: sessionId,
            phase: "running",
            mode,
            language: sharedLanguage,
            results: runningResults,
            executionError: null,
            hiddenSummary: null,
        });

        try {
            const endpoint = mode === "run" ? "/ide/run" : "/ide/submit";
            const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}${endpoint}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${session.access_token}`,
                },
                body: JSON.stringify({
                    questionId,
                    code: sharedCodeRef.current,
                    language: sharedLanguage,
                }),
            });

            const payload = await response.json();

            if (!response.ok) {
                throw new Error(payload?.error || "Failed to execute code");
            }

            if (!payload.success && payload.compileOutput) {
                setExecutionError(payload.compileOutput);
                sendExecutionSync({
                    peerSessionId: sessionId,
                    phase: "completed",
                    mode,
                    language: sharedLanguage,
                    results: {},
                    executionError: payload.compileOutput,
                    hiddenSummary: null,
                });
                return;
            }

            const sampleTests = payload?.sample?.tests || [];
            const mappedResults: Record<string, ExecutionResult> = {};

            if (sampleTests.length > 0) {
                sampleTests.forEach((test: any, index: number) => {
                    const testId = testCasesToDisplay[index]?.id || `case_${index}`;
                    mappedResults[testId] = {
                        status: test.status || (test.passed ? "Accepted" : "Wrong Answer"),
                        passed: Boolean(test.passed),
                        stdout: test.actualOutput,
                        stderr: test.stderr || null,
                        compile_output: test.compileOutput || null,
                        expected: test.expectedOutput,
                        time: test.time || null,
                        memory: test.memory || null,
                    };
                });
                setLocalResults(mappedResults);
            }

            if (mode === "submit" && payload?.hidden?.summary) {
                setHiddenSummary(payload.hidden.summary);
            }

            sendExecutionSync({
                peerSessionId: sessionId,
                phase: "completed",
                mode,
                language: sharedLanguage,
                results: mappedResults,
                executionError: null,
                hiddenSummary: mode === "submit" ? (payload?.hidden?.summary || null) : null,
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to execute code";
            setExecutionError(message);
            sendExecutionSync({
                peerSessionId: sessionId,
                phase: "completed",
                mode,
                language: sharedLanguage,
                results: {},
                executionError: message,
                hiddenSummary: null,
            });
        } finally {
            if (mode === "run") {
                setIsRunning(false);
            } else {
                setIsSubmitting(false);
            }
        }
    };

    return (
        <div className="fixed inset-0 z-[100] overflow-hidden bg-[#FAFBFC] dark:bg-lc-bg">
            <div className="h-full flex flex-col">
                <header className="h-14 border-b border-slate-200 dark:border-lc-border bg-white dark:bg-lc-surface flex items-center justify-between px-4 sm:px-5 gap-3 shrink-0">
                    <div className="flex items-center gap-5">
                        {/* Timer */}
                        <div className={`flex items-center gap-1.5 transition-colors ${timerColorClass}`}>
                            <span className="material-symbols-outlined text-[17px]">schedule</span>
                            <span className="font-mono text-[13px] font-bold tabular-nums">{formatDuration(sessionRemaining)}</span>
                        </div>

                        {/* Switch roles */}
                        <button
                            onClick={() => { if (data) advanceTurn(data.sessionId); }}
                            disabled={!data || !canSwitchTurn}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full border border-slate-300 dark:border-lc-border text-[12px] font-semibold text-slate-700 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-lc-border disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            title="Switch roles"
                        >
                            <span className="material-symbols-outlined text-[15px]">swap_horiz</span>
                            <span>Switch</span>
                        </button>

                        {/* Dark mode */}
                        <button
                            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
                            className="inline-flex items-center justify-center size-8 rounded-full border border-slate-200 dark:border-lc-border text-slate-600 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-lc-border transition-colors"
                            title="Toggle theme"
                        >
                            <span className="material-symbols-outlined text-[17px]">
                                {resolvedTheme === "dark" ? "light_mode" : "dark_mode"}
                            </span>
                        </button>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => { if (data) endSession(data.sessionId); }}
                            disabled={!data || !canEndInterview}
                            className="inline-flex items-center gap-1.5 px-3 sm:px-5 py-2 rounded-full bg-[#E11D48] hover:bg-[#BE123C] text-white text-[12px] sm:text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            title="End Interview"
                        >
                            <span className="material-symbols-outlined text-[15px]">call_end</span>
                            <span>End Interview</span>
                        </button>
                    </div>
                </header>

                <main className="flex-1 overflow-hidden w-full flex flex-col">
                    {loading && (
                        <div className="flex-1 flex items-center justify-center py-20">
                            <div className="size-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                        </div>
                    )}

                    {error && (
                        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#FAFBFC] dark:bg-lc-bg px-6">
                            <div className="max-w-md text-center space-y-5">
                                <div className="mx-auto size-16 rounded-full bg-slate-100 dark:bg-white/[0.06] flex items-center justify-center">
                                    <span className="material-symbols-outlined text-slate-500 text-4xl">event_busy</span>
                                </div>
                                <h2 className="text-2xl font-bold font-nunito text-slate-900 dark:text-white">This interview is no longer available</h2>
                                <p className="text-sm text-slate-600 dark:text-slate-300">
                                    It looks like this session has ended or doesn&apos;t exist anymore. If it wrapped up, you&apos;ll find it under your reports.
                                </p>
                                <button
                                    onClick={() => router.replace("/interviews/peer")}
                                    className="px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold transition-colors"
                                >
                                    Back to peer interviews
                                </button>
                            </div>
                        </div>
                    )}

                    {showNoMatch && (
                        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#FAFBFC] dark:bg-lc-bg px-6">
                            <div className="max-w-md text-center space-y-5">
                                <div className="mx-auto size-16 rounded-full bg-amber-100 dark:bg-amber-500/15 flex items-center justify-center">
                                    <span className="material-symbols-outlined text-amber-600 dark:text-amber-400 text-4xl">search_off</span>
                                </div>
                                <h2 className="text-2xl font-bold font-nunito text-slate-900 dark:text-white">Sorry, we couldn&apos;t find a match</h2>
                                <p className="text-sm text-slate-600 dark:text-slate-300">
                                    No partner was available for this slot. Please book another slot to try again.
                                </p>
                                <button
                                    onClick={() => router.replace("/interviews/peer")}
                                    className="px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold transition-colors"
                                >
                                    Book another slot
                                </button>
                            </div>
                        </div>
                    )}

                    {data && (
                        <>
                            {reconnectingWindowSeconds !== null && (
                                <div className="shrink-0 flex items-start gap-3 bg-amber-50 dark:bg-amber-500/10 border-b border-amber-200 dark:border-amber-500/20 px-4 py-3 text-amber-800 dark:text-amber-300 text-sm">
                                    <span className="material-symbols-outlined text-[18px] animate-pulse mt-0.5">sync</span>
                                    <div>
                                        <p className="font-semibold">Waiting for your peer to reconnect…</p>
                                        <p className="text-[13px] text-amber-700/90 dark:text-amber-300/80">
                                            They may have lost connection or refreshed. We recommend giving them at least a minute — their progress is saved and they can pick up right where they left off. You can end the interview whenever you&apos;d like using the End Interview button.
                                        </p>
                                    </div>
                                </div>
                            )}

                            {isSessionWaitingToStart ? (
                                <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#FAFBFC] dark:bg-lc-bg px-6">
                                    {waitingSeconds !== null && waitingSeconds > 0 ? (
                                        <div className="max-w-md text-center space-y-6">
                                            <h2 className="text-2xl font-bold font-nunito text-slate-900 dark:text-white">You got matched!</h2>
                                            <div className="mx-auto size-20 rounded-full bg-green-100 dark:bg-green-500/15 flex items-center justify-center">
                                                <span className="material-symbols-outlined text-green-600 dark:text-green-400 text-5xl">person</span>
                                            </div>
                                            <div className="space-y-1">
                                                <p className="text-sm text-slate-500">Starting interview in</p>
                                                <p className="text-6xl font-black font-mono tabular-nums text-slate-900 dark:text-white">{waitingSeconds}</p>
                                            </div>
                                        </div>
                                    ) : (waitingSeconds !== null || sessionStatus === "CONNECTING") ? (
                                        <div className="max-w-md text-center space-y-6">
                                            <h2 className="text-2xl font-bold font-nunito text-slate-900 dark:text-white">You got matched!</h2>
                                            <div className="mx-auto w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                                            <p className="text-sm text-slate-600 dark:text-slate-300">Starting interview…</p>
                                        </div>
                                    ) : (
                                        <div className="max-w-md text-center space-y-5">
                                            <div className="mx-auto w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                                            <h2 className="text-2xl font-bold font-nunito text-slate-900 dark:text-white">Waiting for your partner…</h2>
                                            <div className="inline-flex items-center gap-2 rounded-full bg-white dark:bg-lc-surface border border-slate-200 dark:border-lc-border px-4 py-2">
                                                <span className="material-symbols-outlined text-[18px] text-primary">timer</span>
                                                <span className="font-mono font-bold tabular-nums text-slate-900 dark:text-white">
                                                    {Math.floor(lobbyRemainingSec / 60)}:{(lobbyRemainingSec % 60).toString().padStart(2, "0")}
                                                </span>
                                                <span className="text-xs text-slate-500 dark:text-slate-400">typically takes under 2 min</span>
                                            </div>
                                            {(sessionStatus === "MATCHED" || sessionStatus === "CONNECTING") && (
                                                <p className="text-sm text-slate-600 dark:text-slate-300">Your peer is matched. Getting the room ready…</p>
                                            )}
                                            {sessionStatus !== "MATCHED" && sessionStatus !== "CONNECTING" && lobbyPhase !== "same" && (
                                                <p className="text-sm text-slate-600 dark:text-slate-300">No one at your level right now, so we&apos;ve opened up to other levels. Hang tight for a few more minutes.</p>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ) : (
                            <section ref={workspaceRef} className="flex-1 flex flex-col xl:flex-row gap-0 relative overflow-hidden">
                                <aside
                                    className="w-full xl:w-auto shrink-0 bg-white dark:bg-lc-surface border-r border-slate-200 dark:border-lc-border overflow-hidden flex flex-col"
                                    style={isDesktopWorkspace ? { width: leftPanelWidth } : undefined}
                                >
                                    {/* Tab header */}
                                    <div className="px-4 border-b border-slate-100 dark:border-lc-border flex items-center gap-1">
                                        {(["problem", ...(activeCandidateUserId && data && activeCandidateUserId !== data.me.userId ? ["hints", "solution"] : [])] as const).map((tab) => (
                                            <button
                                                key={tab}
                                                onClick={() => setLeftTab(tab as typeof leftTab)}
                                                className={`py-3 px-1 mr-3 text-[13px] font-semibold border-b-2 transition-colors capitalize ${
                                                    leftTab === tab
                                                        ? "border-primary text-primary"
                                                        : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                                                }`}
                                            >
                                                {tab.charAt(0).toUpperCase() + tab.slice(1)}
                                            </button>
                                        ))}
                                    </div>

                                    <div className="p-4 space-y-4 overflow-y-auto custom-scrollbar text-[15px] text-[#374151] dark:text-[#d1d5db] leading-relaxed flex-1">
                                        {leftTab === "problem" && (
                                            <>
                                                {!activeQuestion && (
                                                    <div className="text-sm text-slate-500">Question assignment is still syncing.</div>
                                                )}
                                                {activeQuestion && (
                                                    <div className="space-y-2">
                                                        <div className="text-[18px] font-bold text-slate-900 dark:text-white leading-snug">{questionDetails?.title || activeQuestion.title}</div>
                                                        {activeCandidateUserId && data && activeCandidateUserId !== data.me.userId && (
                                                            <div className="flex flex-wrap items-center gap-1.5">
                                                                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${difficultyTagClass(activeQuestion.difficulty)}`}>
                                                                    {activeQuestion.difficulty}
                                                                </span>
                                                                <span className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 dark:bg-white/[0.06] dark:text-slate-300">
                                                                    {activeQuestion.category}
                                                                </span>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                                {questionLoading && <div className="text-sm text-slate-500">Loading problem statement...</div>}
                                                {questionError && <div className="text-sm text-red-600 dark:text-red-400">{questionError}</div>}
                                                {questionDetails && (
                                                    <>
                                                        <div className="prose prose-base dark:prose-invert max-w-none prose-p:text-slate-700 dark:prose-p:text-slate-300 prose-pre:bg-slate-50 dark:prose-pre:bg-lc-bg prose-pre:border prose-pre:border-slate-200 dark:prose-pre:border-lc-border prose-pre:text-slate-800 dark:prose-pre:text-[#d4d4d4]">
                                                            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, rehypeSanitize]}>
                                                                {questionDetails.statement || questionDetails.problemMd || questionDetails.problem_md || questionDetails.description || ""}
                                                            </ReactMarkdown>
                                                        </div>
                                                        {questionDetails.examples && questionDetails.examples.length > 0 && (
                                                            <div className="mt-4">
                                                                <h3 className="text-[13px] font-bold uppercase tracking-wider text-slate-900 dark:text-white mb-4">Examples</h3>
                                                                <div className="space-y-4">
                                                                    {questionDetails.examples.map((example, index) => (
                                                                        <div key={index} className="bg-[#F8FAFC] dark:bg-lc-bg rounded-lg p-4 font-mono text-[13px] text-slate-800 dark:text-[#d4d4d4] space-y-2">
                                                                            <div className="font-bold text-sm text-slate-900 dark:text-white">Example {index + 1}:</div>
                                                                            <div><span className="font-bold opacity-60">Input:</span> {formatValue(example.input)}</div>
                                                                            <div><span className="font-bold opacity-60">Output:</span> {formatValue(example.output)}</div>
                                                                            {example.explanation && (
                                                                                <div className="mt-2 pt-2 border-t border-slate-200 dark:border-lc-border/50">
                                                                                    <span className="font-bold opacity-60">Explanation:</span> {example.explanation}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}
                                                        {questionDetails.constraints && (
                                                            <div className="mt-4">
                                                                <h3 className="text-[13px] font-bold uppercase tracking-wider text-slate-900 dark:text-white mb-4">Constraints</h3>
                                                                <div className="bg-[#F8FAFC] dark:bg-lc-bg rounded-lg p-4">
                                                                    <ul className="list-disc pl-4 space-y-1.5 font-mono text-[13px] text-slate-800 dark:text-[#d4d4d4] marker:text-slate-400">
                                                                        {typeof questionDetails.constraints === "string"
                                                                            ? questionDetails.constraints.split("\n").filter((line) => line.trim()).map((line, index) => (
                                                                                <li key={index}>{line.replace("- ", "")}</li>
                                                                            ))
                                                                            : questionDetails.constraints.map((line, index) => <li key={index}>{line}</li>)}
                                                                    </ul>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </>
                                                )}
                                            </>
                                        )}

                                        {leftTab === "hints" && (
                                            <div className="space-y-3">
                                                {questionDetails?.hints && questionDetails.hints.length > 0 ? (
                                                    questionDetails.hints.map((hint, index) => (
                                                        <div key={index} className="bg-[#F8FAFC] dark:bg-lc-bg rounded-lg p-4">
                                                            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">Hint {index + 1}</div>
                                                            <p className="text-[13px] text-slate-700 dark:text-slate-200">{hint}</p>
                                                        </div>
                                                    ))
                                                ) : (
                                                    <div className="text-sm text-slate-500 italic">No hints available for this question.</div>
                                                )}
                                            </div>
                                        )}

                                        {leftTab === "solution" && (() => {
                                            const sol = questionDetails?.solution as any;
                                            const hasSolution = sol && typeof sol === "object" && (sol.bruteForce || sol.optimized);
                                            if (!hasSolution) {
                                                return <div className="text-sm text-slate-500 italic">No solution available for this question.</div>;
                                            }
                                            const renderApproach = (key: "bruteForce" | "optimized", approach: any, title: string) => {
                                                const isOpen = expandedSolution === key;
                                                const explainText = cleanExplainationText(approach.explaination || approach.description || approach.explanation);
                                                const timeC = normalizeComplexityValue(approach.timeComplexity);
                                                const spaceC = normalizeComplexityValue(approach.spaceComplexity);
                                                const codeLangs = getSolutionCodeLanguages(approach.code);
                                                // Default to the language chosen for the interview; the user can
                                                // still switch by clicking another language tab.
                                                const interviewLang = normalizeStarterLanguageKey(sharedLanguage);
                                                const matchedLang = codeLangs.find(
                                                    (lang) => normalizeStarterLanguageKey(lang) === interviewLang
                                                );
                                                const selectedLang = solutionCodeLang[key] || matchedLang || codeLangs[0] || "";
                                                const codeStr: string = (approach.code?.[selectedLang] || "").trim();
                                                return (
                                                    <div key={key} className="rounded-2xl overflow-hidden bg-slate-50 dark:bg-lc-bg">
                                                        <button
                                                            onClick={() => setExpandedSolution(isOpen ? null : key)}
                                                            className="w-full bg-slate-100 dark:bg-[#222222] px-4 py-3 flex items-center justify-between hover:bg-slate-200 dark:hover:bg-[#2a2a2a] transition-colors"
                                                        >
                                                            <span className="text-[15px] font-semibold text-slate-900 dark:text-white">{title}</span>
                                                            <span className={`material-symbols-outlined text-[18px] text-slate-500 transition-transform ${isOpen ? "rotate-180" : ""}`}>expand_more</span>
                                                        </button>
                                                        {isOpen && (
                                                            <div className="p-4 space-y-4 bg-white dark:bg-[#1e1e1e]">
                                                                {explainText && (
                                                                    <div>
                                                                        <h4 className="text-[12px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">Explanation</h4>
                                                                        <p className="text-[14px] text-slate-700 dark:text-slate-300 leading-relaxed">{explainText}</p>
                                                                    </div>
                                                                )}
                                                                {(timeC || spaceC) && (
                                                                    <div className="grid grid-cols-2 gap-3">
                                                                        {timeC && (
                                                                            <div className="rounded-xl p-3 bg-slate-50 dark:bg-[#2a2a2a]">
                                                                                <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">Time Complexity</h4>
                                                                                <p className="text-[13px] text-slate-700 dark:text-slate-300 font-mono">{timeC}</p>
                                                                            </div>
                                                                        )}
                                                                        {spaceC && (
                                                                            <div className="rounded-xl p-3 bg-slate-50 dark:bg-[#2a2a2a]">
                                                                                <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">Space Complexity</h4>
                                                                                <p className="text-[13px] text-slate-700 dark:text-slate-300 font-mono">{spaceC}</p>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                )}
                                                                {codeLangs.length > 0 && codeStr && (
                                                                    <div>
                                                                        <h4 className="text-[12px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">Code</h4>
                                                                        {codeLangs.length > 1 && (
                                                                            <div className="flex gap-1 mb-2 border-b border-slate-200 dark:border-lc-border overflow-x-auto">
                                                                                {codeLangs.map((lang) => (
                                                                                    <button
                                                                                        key={lang}
                                                                                        onClick={() => setSolutionCodeLang((prev) => ({ ...prev, [key]: lang }))}
                                                                                        className={`px-3 py-1.5 text-[12px] font-medium whitespace-nowrap transition-colors ${
                                                                                            selectedLang === lang
                                                                                                ? "text-primary border-b-2 border-primary"
                                                                                                : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                                                                                        }`}
                                                                                    >
                                                                                        {lang.charAt(0).toUpperCase() + lang.slice(1)}
                                                                                    </button>
                                                                                ))}
                                                                            </div>
                                                                        )}
                                                                        <div className="rounded-xl overflow-hidden">
                                                                            <SyntaxHighlighter
                                                                                language={SOLUTION_PRISM_LANGUAGE[selectedLang.toLowerCase()] || "text"}
                                                                                style={resolvedTheme === "dark" ? vscDarkPlus : oneLight}
                                                                                customStyle={{
                                                                                    margin: 0,
                                                                                    borderRadius: "0.75rem",
                                                                                    fontSize: "13px",
                                                                                    background: resolvedTheme === "dark" ? "#1a1a1a" : "#f8fafc",
                                                                                    padding: "1rem",
                                                                                }}
                                                                                wrapLongLines
                                                                            >
                                                                                {codeStr}
                                                                            </SyntaxHighlighter>
                                                                        </div>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            };
                                            return (
                                                <div className="space-y-3">
                                                    {sol.bruteForce && renderApproach("bruteForce", sol.bruteForce, "Brute Force")}
                                                    {sol.optimized && renderApproach("optimized", sol.optimized, "Optimal Approach")}
                                                </div>
                                            );
                                        })()}
                                    </div>
                                </aside>

                                <div
                                    className="hidden xl:flex w-1.5 shrink-0 cursor-col-resize items-center justify-center group hover:bg-primary/10 transition-colors"
                                    onMouseDown={(event) => {
                                        event.preventDefault();
                                        isResizingLeftRef.current = true;
                                        document.body.style.cursor = "col-resize";
                                        document.body.style.userSelect = "none";
                                    }}
                                >
                                    <div className="w-0.5 h-8 bg-slate-300 dark:bg-slate-600 rounded-full group-hover:bg-primary transition-colors" />
                                </div>

                                <section id="peer-editor-section" className="flex-1 min-w-0 bg-white dark:bg-lc-surface overflow-hidden flex flex-col border-l border-slate-200 dark:border-lc-border">
                                    <div className="px-3 py-2 border-b border-slate-100 dark:border-lc-border flex items-center gap-2">
                                        <select
                                            value={sharedLanguage}
                                            onChange={(event) => handleLanguageChange(event.target.value)}
                                            disabled={!canEditSharedEditor}
                                            className="bg-slate-100 dark:bg-lc-bg border border-slate-200 dark:border-lc-border rounded-xl px-2 py-1 text-[12px] font-bold text-slate-700 dark:text-white disabled:opacity-60"
                                        >
                                            {languageOptions.map((option) => (
                                                <option key={option.value} value={option.value}>
                                                    {option.label}
                                                </option>
                                            ))}
                                        </select>
                                        <button
                                            onClick={() => {
                                                const starter = starterCodeByLanguage[sharedLanguage] ?? "";
                                                sharedCodeRef.current = starter;
                                                if (monacoEditorRef.current) {
                                                    monacoEditorRef.current.setValue(starter);
                                                } else {
                                                    setSharedCode(starter);
                                                }
                                                setLocalResults({});
                                                setExecutionError(null);
                                                setHiddenSummary(null);
                                            }}
                                            className="flex items-center gap-1 text-slate-500 hover:text-slate-800 dark:text-[#ababab] dark:hover:text-white transition-colors text-[12px]"
                                            title="Reset to starter code"
                                        >
                                            <span className="material-symbols-outlined text-[16px]">restart_alt</span>
                                            <span>Reset</span>
                                        </button>
                                    </div>

                                    <div className="flex-1 min-h-0">
                                        <MonacoEditor
                                            height="100%"
                                            language={sharedLanguage || "python"}
                                            defaultValue={sharedCode}
                                            onChange={handleEditorChange}
                                            onMount={(editor) => { monacoEditorRef.current = editor; }}
                                            theme={editorTheme}
                                            options={{
                                                minimap: { enabled: false },
                                                fontSize: 14,
                                                readOnly: !canEditSharedEditor,
                                                wordWrap: "on",
                                                automaticLayout: true,
                                            }}
                                        />
                                    </div>

                                    <div
                                        className="h-2 shrink-0 cursor-row-resize flex items-center justify-center group hover:bg-primary/10 transition-colors"
                                        onMouseDown={(event) => {
                                            event.preventDefault();
                                            isResizingTestRef.current = true;
                                            document.body.style.cursor = "row-resize";
                                            document.body.style.userSelect = "none";
                                        }}
                                    >
                                        <div className="h-0.5 w-8 bg-slate-300 dark:bg-slate-600 rounded-full group-hover:bg-primary transition-colors" />
                                    </div>

                                    <div style={{ height: testPanelHeight, minHeight: MIN_TEST_PANEL_HEIGHT, maxHeight: MAX_TEST_PANEL_HEIGHT }} className="border-t border-slate-200 dark:border-lc-border bg-white dark:bg-lc-surface flex flex-col shrink-0">
                                        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-lc-border">
                                            <div className="flex items-center gap-2">
                                                <span className="material-symbols-outlined text-[18px] text-slate-500 dark:text-slate-400">terminal</span>
                                                <span className="text-[13px] font-bold text-slate-700 dark:text-white uppercase tracking-wider">Test Results</span>
                                            </div>
                                            <div className="flex gap-3">
                                                <button
                                                    onClick={() => executeCode("run")}
                                                    disabled={isRunning || isSubmitting || !activeQuestion?.questionId}
                                                    className={`flex items-center gap-1.5 px-3 py-1.5 border border-slate-300 dark:border-lc-border rounded-lg text-sm font-bold shadow-sm transition-colors ${(isRunning || isSubmitting) ? "opacity-50 cursor-not-allowed bg-slate-100 text-slate-400" : "text-slate-700 dark:text-[#eff1f6] bg-white dark:bg-lc-surface hover:bg-slate-50 dark:hover:bg-lc-hover"}`}
                                                >
                                                    <span className="material-symbols-outlined text-[18px]">{isRunning ? "sync" : "play_arrow"}</span>
                                                    {isRunning ? "Running..." : "Run Tests"}
                                                </button>
                                                <button
                                                    onClick={() => executeCode("submit")}
                                                    disabled={isRunning || isSubmitting || !activeQuestion?.questionId}
                                                    className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-bold transition-colors shadow-sm ${(isRunning || isSubmitting) ? "opacity-50 cursor-not-allowed bg-emerald-400 text-white" : "bg-[#10b981] hover:bg-[#059669] text-white"}`}
                                                >
                                                    <span className="material-symbols-outlined text-[18px]">{isSubmitting ? "sync" : "cloud_upload"}</span>
                                                    {isSubmitting ? "Submitting..." : "Submit"}
                                                </button>
                                            </div>
                                        </div>

                                        <div className="flex-1 flex flex-col p-4 bg-white dark:bg-lc-surface overflow-auto">
                                            {executionError && (
                                                <div className="mb-3 p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-lg text-red-700 dark:text-red-400 text-[13px] font-mono whitespace-pre-wrap flex-shrink-0">
                                                    <div className="flex items-center gap-1.5 mb-1">
                                                        <span className="material-symbols-outlined text-[16px]">error</span>
                                                        <span className="font-bold text-[11px] uppercase tracking-wider">Compile / Runtime Error</span>
                                                    </div>
                                                    {executionError}
                                                </div>
                                            )}

                                            {hiddenSummary && (
                                                <div className={`mb-3 p-3 rounded-lg text-[13px] font-bold flex items-center justify-between ${
                                                    hiddenSummary.passed === hiddenSummary.total
                                                        ? "bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/30 text-green-700 dark:text-green-400"
                                                        : "bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 text-amber-700 dark:text-amber-400"
                                                }`}>
                                                    <span>Hidden Tests: {hiddenSummary.passed}/{hiddenSummary.total} passed</span>
                                                </div>
                                            )}

                                            {testCasesToDisplay.length > 0 ? (
                                                <div className="h-full flex flex-col gap-4">
                                                    <div className="flex gap-6 border-b border-slate-100 dark:border-lc-border px-2">
                                                        {testCasesToDisplay.map((testCase, index) => {
                                                            const testId = testCase.id || `case_${index}`;
                                                            const result = localResults[testId];
                                                            let dotColor = "bg-slate-300 dark:bg-slate-600";
                                                            if (result) {
                                                                if (result.status === "Running") dotColor = "bg-blue-400 animate-pulse";
                                                                else if (result.passed) dotColor = "bg-green-500";
                                                                else dotColor = "bg-red-500";
                                                            }

                                                            return (
                                                                <button
                                                                    key={testId}
                                                                    onClick={() => setActiveTestCase(index)}
                                                                    className={`pb-3 text-[14px] font-bold border-b-2 transition-colors relative top-[1px] flex items-center gap-1.5 ${activeTestCase === index
                                                                        ? "text-orange-500 border-orange-500"
                                                                        : "text-slate-500 border-transparent hover:text-slate-700 dark:hover:text-slate-300"
                                                                        }`}
                                                                >
                                                                    <span className={`size-2 rounded-full ${dotColor}`} />
                                                                    Case {index + 1}
                                                                </button>
                                                            );
                                                        })}
                                                    </div>

                                                    <div className="flex gap-4 overflow-auto custom-scrollbar flex-1 pb-4">
                                                        <div className="flex-1 flex flex-col gap-2 min-w-0">
                                                            <div className="font-bold text-[13px] uppercase tracking-wider text-slate-500">Input</div>
                                                            <div className="flex-1 bg-slate-50 dark:bg-[#1e1e1e] rounded-lg p-3 font-mono text-[13px] overflow-auto custom-scrollbar whitespace-pre-wrap text-slate-800 dark:text-[#d4d4d4]">
                                                                {formatValue(testCasesToDisplay[activeTestCase]?.stdin ?? testCasesToDisplay[activeTestCase]?.input)}
                                                            </div>
                                                        </div>

                                                        <div className="flex-1 flex flex-col gap-2 min-w-0">
                                                            <div className="font-bold text-[13px] uppercase tracking-wider text-slate-500">Expected</div>
                                                            <div className="flex-1 bg-slate-50 dark:bg-[#1e1e1e] rounded-lg p-3 font-mono text-[13px] overflow-auto custom-scrollbar whitespace-pre-wrap text-slate-800 dark:text-[#d4d4d4]">
                                                                {formatValue(testCasesToDisplay[activeTestCase]?.expected_output ?? testCasesToDisplay[activeTestCase]?.output)}
                                                            </div>
                                                        </div>

                                                        <div className="flex-1 flex flex-col gap-2 min-w-0">
                                                            <div className="font-bold text-[13px] uppercase tracking-wider text-slate-500">Output</div>
                                                            <div className={`flex-1 p-3 rounded-lg font-mono text-[13px] overflow-auto custom-scrollbar whitespace-pre-wrap ${
                                                                localResults[(testCasesToDisplay[activeTestCase]?.id || `case_${activeTestCase}`)]
                                                                    ? localResults[(testCasesToDisplay[activeTestCase]?.id || `case_${activeTestCase}`)].passed
                                                                        ? "bg-green-50/50 dark:bg-green-500/5 text-green-700 dark:text-green-400"
                                                                        : "bg-red-50/50 dark:bg-red-500/5 text-red-700 dark:text-red-400"
                                                                    : "bg-slate-50 dark:bg-[#1e1e1e] text-slate-400 italic"
                                                            }`}>
                                                                {formatValue(localResults[(testCasesToDisplay[activeTestCase]?.id || `case_${activeTestCase}`)]?.stdout || "Run code to see output")}
                                                                {localResults[(testCasesToDisplay[activeTestCase]?.id || `case_${activeTestCase}`)]?.stderr
                                                                    ? `\n\nError:\n${localResults[(testCasesToDisplay[activeTestCase]?.id || `case_${activeTestCase}`)]?.stderr}`
                                                                    : ""}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="h-full flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 text-[13px]">
                                                    <span className="material-symbols-outlined text-3xl mb-2 opacity-50">data_object</span>
                                                    <p>No sample test cases available for this question.</p>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {!canEditSharedEditor && (
                                        <div className="px-4 py-2 border-t border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/10 text-sm text-amber-700 dark:text-amber-400">
                                            Editor is read-only while your peer is the active candidate.
                                        </div>
                                    )}
                                </section>

                                {/* Floating draggable PiP video widget */}
                                <div
                                    className="fixed z-50 w-64 rounded-2xl overflow-hidden shadow-2xl border border-white/10 bg-slate-900 select-none"
                                    style={videoPos
                                        ? { left: videoPos.x, top: videoPos.y, cursor: "grab" }
                                        : { top: 72, right: 24, cursor: "grab" }
                                    }
                                    onMouseDown={(e) => {
                                        e.preventDefault();
                                        videoDraggingRef.current = true;
                                        videoDragMovedRef.current = false;
                                        const rect = e.currentTarget.getBoundingClientRect();
                                        videoDragOffsetRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
                                    }}
                                >
                                    {/* Both videos absolutely positioned; CSS transitions animate between main/pip */}
                                    <div className="relative w-full" style={{ aspectRatio: "16/9" }}>
                                        {/* Remote video */}
                                        <video
                                            ref={remoteVideoRef}
                                            autoPlay
                                            playsInline
                                            className="absolute object-cover transition-all duration-300 ease-in-out"
                                            style={videosSwapped
                                                ? { bottom: 8, right: 8, width: 76, height: 43, borderRadius: 8, border: "2px solid rgba(255,255,255,0.3)", zIndex: 10, cursor: "pointer" }
                                                : { inset: 0, width: "100%", height: "100%", cursor: "pointer" }
                                            }
                                            onClick={(e) => {
                                                if (videoDragMovedRef.current) return;
                                                e.stopPropagation();
                                                if (videosSwapped) setVideosSwapped(false);
                                                else setVideoExpanded(true);
                                            }}
                                        />

                                        {/* Local video */}
                                        <video
                                            ref={localVideoRef}
                                            autoPlay
                                            playsInline
                                            muted
                                            className={`absolute object-cover transition-all duration-300 ease-in-out ${!isCameraOn && !videosSwapped ? "hidden" : ""}`}
                                            style={{
                                                transform: "scaleX(-1)",
                                                ...(videosSwapped
                                                    ? { inset: 0, width: "100%", height: "100%", cursor: "pointer" }
                                                    : { bottom: 8, right: 8, width: 76, height: 43, borderRadius: 8, border: "2px solid rgba(255,255,255,0.3)", zIndex: 10, cursor: "pointer" })
                                            }}
                                            onClick={(e) => {
                                                if (videoDragMovedRef.current) return;
                                                e.stopPropagation();
                                                if (!videosSwapped) setVideosSwapped(true);
                                                else setVideoExpanded(true);
                                            }}
                                        />

                                        <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent pointer-events-none" style={{ zIndex: 5 }} />

                                        {/* Mic / camera toggles */}
                                        <div className="absolute bottom-2 left-2 flex items-center gap-1.5 z-20" onClick={(e) => e.stopPropagation()}>
                                            <button
                                                onClick={toggleMute}
                                                className={`size-7 rounded-full flex items-center justify-center transition-all shadow ${isMuted ? "bg-red-500 hover:bg-red-600" : "bg-black/50 hover:bg-black/70"} text-white`}
                                                title={isMuted ? "Unmute" : "Mute"}
                                            >
                                                <span className="material-symbols-outlined text-[13px] leading-none">{isMuted ? "mic_off" : "mic"}</span>
                                            </button>
                                            <button
                                                onClick={toggleCamera}
                                                className={`size-7 rounded-full flex items-center justify-center transition-all shadow ${!isCameraOn ? "bg-red-500 hover:bg-red-600" : "bg-black/50 hover:bg-black/70"} text-white`}
                                                title={isCameraOn ? "Turn off camera" : "Turn on camera"}
                                            >
                                                <span className="material-symbols-outlined text-[13px] leading-none">{isCameraOn ? "videocam" : "videocam_off"}</span>
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {/* Expanded video modal */}
                                {videoExpanded && (
                                    <div
                                        className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center"
                                        onClick={() => setVideoExpanded(false)}
                                    >
                                        <div
                                            className="relative rounded-2xl overflow-hidden bg-slate-900 shadow-2xl border border-white/10"
                                            style={{ width: "min(800px, 90vw)", aspectRatio: "16/9" }}
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            {/* Remote video in modal */}
                                            <video
                                                autoPlay playsInline
                                                className="absolute object-cover transition-all duration-300 ease-in-out"
                                                style={videosSwapped
                                                    ? { bottom: 16, right: 16, width: 160, height: 90, borderRadius: 12, border: "2px solid rgba(255,255,255,0.2)", zIndex: 10, cursor: "pointer" }
                                                    : { inset: 0, width: "100%", height: "100%", cursor: "pointer" }
                                                }
                                                ref={expandedRemoteVideoRef}
                                                onClick={() => { if (videosSwapped) setVideosSwapped(false); }}
                                            />

                                            {/* Local video in modal */}
                                            <video
                                                autoPlay playsInline muted
                                                className="absolute object-cover transition-all duration-300 ease-in-out"
                                                style={{
                                                    transform: "scaleX(-1)",
                                                    ...(videosSwapped
                                                        ? { inset: 0, width: "100%", height: "100%", cursor: "default" }
                                                        : { bottom: 16, right: 16, width: 160, height: 90, borderRadius: 12, border: "2px solid rgba(255,255,255,0.2)", zIndex: 10, cursor: "pointer" })
                                                }}
                                                ref={expandedLocalVideoRef}
                                                onClick={() => { if (!videosSwapped) setVideosSwapped(true); }}
                                            />

                                            <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent pointer-events-none" style={{ zIndex: 5 }} />

                                            {/* Controls */}
                                            <div className="absolute bottom-4 left-4 flex items-center gap-2 z-20">
                                                <button onClick={toggleMute} className={`size-9 rounded-full flex items-center justify-center transition-all shadow ${isMuted ? "bg-red-500 hover:bg-red-600" : "bg-black/50 hover:bg-black/70"} text-white`}>
                                                    <span className="material-symbols-outlined text-[18px] leading-none">{isMuted ? "mic_off" : "mic"}</span>
                                                </button>
                                                <button onClick={toggleCamera} className={`size-9 rounded-full flex items-center justify-center transition-all shadow ${!isCameraOn ? "bg-red-500 hover:bg-red-600" : "bg-black/50 hover:bg-black/70"} text-white`}>
                                                    <span className="material-symbols-outlined text-[18px] leading-none">{isCameraOn ? "videocam" : "videocam_off"}</span>
                                                </button>
                                            </div>

                                            {/* Close */}
                                            <button
                                                className="absolute top-3 right-3 size-8 rounded-full bg-black/50 hover:bg-black/70 flex items-center justify-center text-white transition-all z-20"
                                                onClick={() => setVideoExpanded(false)}
                                            >
                                                <span className="material-symbols-outlined text-[18px]">close</span>
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </section>
                            )}

                            {showTurnModal && turnState && (
                                <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px] flex items-center justify-center p-4">
                                    <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-lc-surface border border-slate-200 dark:border-lc-border p-8 space-y-4 shadow-xl text-center">
                                        <div>
                                            <h3 className="text-2xl font-bold text-slate-900 dark:text-white font-nunito tracking-tight">
                                                {turnState.activeCandidateUserId === data.me.userId
                                                    ? "You're the Candidate"
                                                    : "You're the Interviewer"}
                                            </h3>
                                            <p className="text-sm text-slate-700 dark:text-slate-200 mt-1">
                                                {turnState.activeCandidateUserId === data.me.userId
                                                    ? "It's your turn to solve the problem in the IDE. Think out loud and show your approach."
                                                    : "Sit back and observe. Guide your peer if they get stuck, and take notes for your feedback."}
                                            </p>
                                        </div>
                                        <p className="text-sm font-black text-slate-900 dark:text-white">All the best!</p>
                                        <button
                                            onClick={() => setShowTurnModal(false)}
                                            className="w-full px-4 py-2.5 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold transition-opacity hover:opacity-90"
                                        >
                                            Let&apos;s go
                                        </button>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </main>
            </div>
        </div>
    );
}
