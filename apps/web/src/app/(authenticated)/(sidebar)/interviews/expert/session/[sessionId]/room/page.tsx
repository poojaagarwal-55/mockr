"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { useAuth } from "@/context/auth-context";
import { api } from "@/lib/api";
import { useExpertSocket } from "@/hooks/use-expert-socket";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

type ExpertRoomDetail = {
    id: string;
    roomId: string;
    status: string;
    interviewType: string;
    preferredLanguage: string;
    scheduledFor: string;
    endsAt: string | null;
    myRole: "expert" | "candidate";
    candidate: { id: string; fullName: string; avatarUrl: string | null };
    expert: { id: string; fullName: string; avatarUrl: string | null };
    questions: {
        id: string;
        questionId: string | null;
        title: string;
        difficulty: string;
        topic: string;
        customPrompt: string | null;
        orderIndex: number;
    }[];
};

type ExecutionResult = {
    status?: string;
    passed?: boolean;
    stdout?: string | null;
    stderr?: string | null;
    compile_output?: string | null;
    expected?: string | null;
    time?: string | null;
    memory?: string | null;
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
    sample_tests?: Array<{
        id?: string;
        stdin?: unknown;
        expected_output?: unknown;
        input?: unknown;
        output?: unknown;
    }>;
};

const EDITOR_LANGUAGES = [
    { value: "python", label: "Python" },
    { value: "javascript", label: "JavaScript" },
    { value: "typescript", label: "TypeScript" },
    { value: "java", label: "Java" },
    { value: "cpp", label: "C++" },
    { value: "go", label: "Go" },
];

const STARTER_CODE: Record<string, string> = {
    python: "def solve():\n    pass\n",
    javascript: "function solve() {\n  // Write your solution here\n}\n",
    typescript: "function solve(): void {\n  // Write your solution here\n}\n",
    java: "class Solution {\n    public void solve() {\n        \n    }\n}\n",
    cpp: "#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    return 0;\n}\n",
    go: "package main\n\nfunc main() {\n    \n}\n",
};

function normalizeLanguage(value: string | null | undefined) {
    const normalized = (value || "python").toLowerCase().replace("_", "-");
    if (["python", "python3", "py"].includes(normalized)) return "python";
    if (["javascript", "js", "node", "nodejs"].includes(normalized)) return "javascript";
    if (["typescript", "ts"].includes(normalized)) return "typescript";
    if (["java"].includes(normalized)) return "java";
    if (["cpp", "c++", "cxx", "cpp17", "cpp20"].includes(normalized)) return "cpp";
    if (["go", "golang"].includes(normalized)) return "go";
    return "python";
}

function normalizeStarterCodeMap(source?: Record<string, string>): Record<string, string> {
    if (!source) return {};
    const normalized: Record<string, string> = {};
    Object.entries(source).forEach(([rawLanguage, starter]) => {
        const language = normalizeLanguage(rawLanguage);
        if (!normalized[language] || normalized[language].trim().length === 0) {
            normalized[language] = starter;
        }
    });
    return normalized;
}

function formatTime(value: string | null) {
    if (!value) return "";
    return new Date(value).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function formatDuration(seconds: number) {
    const safe = Math.max(0, Math.floor(seconds));
    const mins = Math.floor(safe / 60);
    const secs = safe % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

function formatValue(value: unknown): string {
    if (typeof value === "string") return value;
    if (value === null || value === undefined) return "";
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

export default function ExpertInterviewRoomPage() {
    const params = useParams<{ sessionId: string }>();
    const router = useRouter();
    const { session, user } = useAuth();
    const token = session?.access_token;
    const sessionId = params.sessionId;

    const {
        connected,
        lastError,
        sessionState,
        chatMessages,
        timerSync,
        editorState,
        sessionEnded,
        signalOffer,
        signalAnswer,
        signalIce,
        executionSync,
        lobbyState,
        lobbyRequests,
        joinSession,
        admitCandidate,
        sendChatMessage,
        syncTimer,
        endSession,
        syncEditorState,
        sendSignalOffer,
        sendSignalAnswer,
        sendSignalIce,
        sendExecutionSync,
        clearSignalOffer,
        clearSignalAnswer,
        clearSignalIce,
    } = useExpertSocket();

    const localVideoRef = useRef<HTMLVideoElement | null>(null);
    const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
    const localStreamRef = useRef<MediaStream | null>(null);
    const remoteStreamRef = useRef<MediaStream | null>(null);
    const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
    const pendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
    const offerSentRef = useRef(false);
    const syncDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const sharedCodeRef = useRef("");

    const [detail, setDetail] = useState<ExpertRoomDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [joining, setJoining] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [mediaError, setMediaError] = useState<string | null>(null);
    const [cameraOn, setCameraOn] = useState(true);
    const [micOn, setMicOn] = useState(true);
    const [mediaReady, setMediaReady] = useState(false);
    const [sharedCode, setSharedCode] = useState("");
    const [sharedLanguage, setSharedLanguage] = useState("python");
    const [sharedRevision, setSharedRevision] = useState(0);
    const [starterCodeByLanguage, setStarterCodeByLanguage] = useState<Record<string, string>>({});
    const [editorTheme, setEditorTheme] = useState<"light" | "vs-dark">("light");
    const [chatInput, setChatInput] = useState("");
    const [activeQuestionId, setActiveQuestionId] = useState<string | null>(null);
    const [activeTestCase, setActiveTestCase] = useState(0);
    const [questionDetails, setQuestionDetails] = useState<DsaQuestionDetails | null>(null);
    const [questionLoading, setQuestionLoading] = useState(false);
    const [questionError, setQuestionError] = useState<string | null>(null);
    const [elapsedSeconds, setElapsedSeconds] = useState(0);
    const [totalSeconds, setTotalSeconds] = useState(60 * 60);
    const [isRunning, setIsRunning] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [endingInterview, setEndingInterview] = useState(false);
    const [executionError, setExecutionError] = useState<string | null>(null);
    const [executionResults, setExecutionResults] = useState<Record<string, ExecutionResult>>({});
    const [hiddenSummary, setHiddenSummary] = useState<{ passed: number; total: number } | null>(null);

    const loadAndJoin = useCallback(async () => {
        if (!token || !sessionId) return;
        setLoading(true);
        setJoining(true);
        setError(null);
        try {
            await api.post(`/experts/sessions/${sessionId}/join`, {}, token);
            const result = await api.get<ExpertRoomDetail>(`/experts/sessions/${sessionId}`, token);
            const language = normalizeLanguage(result.preferredLanguage);
            setDetail(result);
            setSharedLanguage(language);
            setSharedCode((current) => current || STARTER_CODE[language] || "");
            sharedCodeRef.current = STARTER_CODE[language] || "";
            setActiveQuestionId(result.questions[0]?.id ?? null);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to join interview");
        } finally {
            setLoading(false);
            setJoining(false);
        }
    }, [token, sessionId]);

    useEffect(() => {
        loadAndJoin();
    }, [loadAndJoin]);

    useEffect(() => {
        if (!connected || !detail?.id) return;
        joinSession(detail.id);
    }, [connected, detail?.id, joinSession]);

    const addLocalTracks = useCallback((pc: RTCPeerConnection) => {
        const stream = localStreamRef.current;
        if (!stream) return;
        const existingTrackIds = new Set(pc.getSenders().map((sender) => sender.track?.id).filter(Boolean));
        stream.getTracks().forEach((track) => {
            if (!existingTrackIds.has(track.id)) {
                pc.addTrack(track, stream);
            }
        });
    }, []);

    const ensurePeerConnection = useCallback(() => {
        if (!sessionId) return null;
        if (peerConnectionRef.current) {
            addLocalTracks(peerConnectionRef.current);
            return peerConnectionRef.current;
        }

        const pc = new RTCPeerConnection({
            iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
        });

        pc.onicecandidate = (event) => {
            if (!event.candidate) return;
            sendSignalIce(sessionId, JSON.stringify(event.candidate.toJSON()));
        };

        pc.ontrack = (event) => {
            const [stream] = event.streams;
            if (!stream) return;
            remoteStreamRef.current = stream;
            if (remoteVideoRef.current) {
                remoteVideoRef.current.srcObject = stream;
            }
        };

        peerConnectionRef.current = pc;
        addLocalTracks(pc);
        return pc;
    }, [addLocalTracks, sendSignalIce, sessionId]);

    const flushQueuedIceCandidates = useCallback(async () => {
        const pc = peerConnectionRef.current;
        if (!pc?.remoteDescription) return;
        const queued = pendingIceCandidatesRef.current.splice(0);
        for (const candidate of queued) {
            await pc.addIceCandidate(candidate);
        }
    }, []);

    useEffect(() => {
        let cancelled = false;

        async function startMedia() {
            if (!navigator.mediaDevices?.getUserMedia) {
                setMediaError("Camera and microphone are not available in this browser.");
                return;
            }

            try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                if (cancelled) {
                    stream.getTracks().forEach((track) => track.stop());
                    return;
                }
                localStreamRef.current = stream;
                setMediaReady(true);
                if (localVideoRef.current) {
                    localVideoRef.current.srcObject = stream;
                }
                if (peerConnectionRef.current) {
                    addLocalTracks(peerConnectionRef.current);
                }
            } catch {
                setMediaError("Could not access camera or microphone.");
            }
        }

        startMedia();
        return () => {
            cancelled = true;
            if (syncDebounceRef.current) clearTimeout(syncDebounceRef.current);
            localStreamRef.current?.getTracks().forEach((track) => track.stop());
            remoteStreamRef.current?.getTracks().forEach((track) => track.stop());
            peerConnectionRef.current?.close();
            localStreamRef.current = null;
            remoteStreamRef.current = null;
            peerConnectionRef.current = null;
        };
    }, [addLocalTracks]);

    useEffect(() => {
        if (!detail) return;
        offerSentRef.current = false;
        pendingIceCandidatesRef.current = [];
    }, [detail?.id]);

    useEffect(() => {
        if (!detail || !sessionId || !mediaReady || offerSentRef.current || detail.myRole !== "expert") return;
        const bothParticipantsReady = sessionState?.expertSessionId === detail.id
            && sessionState.participants.filter((participant) => participant.isReady).length >= 2;
        if (!bothParticipantsReady) return;

        async function createOffer() {
            try {
                const pc = ensurePeerConnection();
                if (!pc) return;
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                sendSignalOffer(sessionId, offer.sdp || "");
                offerSentRef.current = true;
            } catch (err) {
                setMediaError(err instanceof Error ? err.message : "Failed to create video connection.");
            }
        }

        createOffer();
    }, [detail, ensurePeerConnection, mediaReady, sendSignalOffer, sessionId, sessionState]);

    useEffect(() => {
        if (!signalOffer || signalOffer.expertSessionId !== sessionId || !mediaReady) return;
        const offer = signalOffer;

        async function handleOffer() {
            try {
                const pc = ensurePeerConnection();
                if (!pc) return;
                if (pc.signalingState === "have-local-offer") {
                    await pc.setLocalDescription({ type: "rollback" } as RTCSessionDescriptionInit);
                }
                if (pc.signalingState !== "stable") return;
                await pc.setRemoteDescription({ type: "offer", sdp: offer.sdp });
                await flushQueuedIceCandidates();
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                sendSignalAnswer(offer.expertSessionId, answer.sdp || "");
                clearSignalOffer();
            } catch (err) {
                setMediaError(err instanceof Error ? err.message : "Failed to answer video call.");
            }
        }

        handleOffer();
    }, [clearSignalOffer, ensurePeerConnection, flushQueuedIceCandidates, mediaReady, sendSignalAnswer, sessionId, signalOffer]);

    useEffect(() => {
        if (!signalAnswer || signalAnswer.expertSessionId !== sessionId) return;
        const answer = signalAnswer;

        async function handleAnswer() {
            try {
                const pc = peerConnectionRef.current;
                if (!pc || pc.signalingState !== "have-local-offer") return;
                await pc.setRemoteDescription({ type: "answer", sdp: answer.sdp });
                await flushQueuedIceCandidates();
                clearSignalAnswer();
            } catch (err) {
                setMediaError(err instanceof Error ? err.message : "Failed to connect video call.");
            }
        }

        handleAnswer();
    }, [clearSignalAnswer, flushQueuedIceCandidates, sessionId, signalAnswer]);

    useEffect(() => {
        if (!signalIce || signalIce.expertSessionId !== sessionId) return;
        const ice = signalIce;

        async function handleIce() {
            try {
                const candidate = JSON.parse(ice.candidate) as RTCIceCandidateInit;
                const pc = ensurePeerConnection();
                if (!pc) return;
                if (!pc.remoteDescription) {
                    pendingIceCandidatesRef.current.push(candidate);
                    clearSignalIce();
                    return;
                }
                await pc.addIceCandidate(candidate);
                clearSignalIce();
            } catch (err) {
                setMediaError(err instanceof Error ? err.message : "Failed to add ICE candidate.");
            }
        }

        handleIce();
    }, [clearSignalIce, ensurePeerConnection, sessionId, signalIce]);

    useEffect(() => {
        if (!editorState || editorState.expertSessionId !== sessionId) return;
        setSharedRevision(editorState.revision);
        setSharedLanguage(normalizeLanguage(editorState.language));
        setSharedCode(editorState.code);
        sharedCodeRef.current = editorState.code;
    }, [editorState, sessionId]);

    useEffect(() => {
        if (!timerSync || timerSync.expertSessionId !== sessionId) return;
        setElapsedSeconds(timerSync.elapsedSeconds);
        setTotalSeconds(timerSync.totalSeconds);
    }, [sessionId, timerSync]);

    useEffect(() => {
        if (!executionSync || executionSync.expertSessionId !== sessionId) return;
        setIsRunning(executionSync.phase === "running" && executionSync.mode === "run");
        setIsSubmitting(executionSync.phase === "running" && executionSync.mode === "submit");
        setExecutionError(executionSync.executionError || null);
        setExecutionResults((executionSync.results as Record<string, ExecutionResult>) || {});
        setHiddenSummary(executionSync.hiddenSummary || null);
    }, [executionSync, sessionId]);

    useEffect(() => {
        const interval = window.setInterval(() => {
            setElapsedSeconds((current) => Math.min(totalSeconds, current + 1));
        }, 1000);
        return () => window.clearInterval(interval);
    }, [totalSeconds]);

    useEffect(() => {
        if (!detail || detail.myRole !== "expert" || !connected || sessionEnded) return;
        const interval = window.setInterval(() => {
            setElapsedSeconds((current) => {
                syncTimer(detail.id, current, totalSeconds);
                return current;
            });
        }, 5000);
        return () => window.clearInterval(interval);
    }, [connected, detail, sessionEnded, syncTimer, totalSeconds]);

    const canEditSharedEditor = Boolean(detail && user?.id === detail.candidate.id && sessionState?.editableUserId === user.id);
    const activeQuestion = useMemo(
        () => detail?.questions.find((question) => question.id === activeQuestionId) ?? detail?.questions[0] ?? null,
        [activeQuestionId, detail?.questions]
    );
    const testCasesToDisplay = useMemo(() => questionDetails?.sample_tests || [], [questionDetails?.sample_tests]);

    useEffect(() => {
        const questionId = activeQuestion?.questionId;
        if (!token || !questionId) {
            setQuestionDetails(null);
            setQuestionError(null);
            setQuestionLoading(false);
            setStarterCodeByLanguage({});
            setActiveTestCase(0);
            return;
        }

        let cancelled = false;
        setQuestionLoading(true);
        setQuestionError(null);
        setActiveTestCase(0);
        setExecutionResults({});
        setExecutionError(null);
        setHiddenSummary(null);

        api.get<DsaQuestionDetails>(`/ide/question/${questionId}`, token)
            .then((response) => {
                if (cancelled) return;
                setQuestionDetails(response);
                const starterCode = normalizeStarterCodeMap(response.starter_code);
                setStarterCodeByLanguage(starterCode);
                const availableLanguages = Object.keys(starterCode);
                const defaultLanguage = normalizeLanguage(response.language || sharedLanguage || "python");
                const nextLanguage = starterCode[sharedLanguage]
                    ? sharedLanguage
                    : starterCode[defaultLanguage]
                        ? defaultLanguage
                        : availableLanguages[0] || sharedLanguage;
                const nextStarter = starterCode[nextLanguage] || STARTER_CODE[nextLanguage] || "";
                setSharedLanguage(nextLanguage);
                setSharedCode(nextStarter);
                sharedCodeRef.current = nextStarter;
                setSharedRevision(0);
            })
            .catch((err) => {
                if (cancelled) return;
                setQuestionDetails(null);
                setStarterCodeByLanguage({});
                setQuestionError(err instanceof Error ? err.message : "Failed to load question details");
            })
            .finally(() => {
                if (!cancelled) setQuestionLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [activeQuestion?.questionId, token]);

    const otherPerson = detail?.myRole === "expert" ? detail?.candidate : detail?.expert;
    const backHref = detail?.myRole === "expert" ? `/expert/sessions/${detail?.id}` : `/interviews/expert/session/${detail?.id}`;
    const connectionLabel = connected ? "Live sync on" : "Connecting sync";
    const roleLabel = detail?.myRole === "expert" ? "Expert interviewer" : "Candidate";
    const pendingLobbyRequests = detail?.myRole === "expert"
        ? lobbyRequests.filter((request) => request.expertSessionId === detail.id)
        : [];
    const isWaitingInLobby = Boolean(
        detail?.myRole === "candidate" &&
        (!lobbyState || (lobbyState.expertSessionId === detail.id && lobbyState.waiting && !lobbyState.admitted))
    );

    function toggleCamera() {
        const next = !cameraOn;
        localStreamRef.current?.getVideoTracks().forEach((track) => {
            track.enabled = next;
        });
        setCameraOn(next);
    }

    function toggleMic() {
        const next = !micOn;
        localStreamRef.current?.getAudioTracks().forEach((track) => {
            track.enabled = next;
        });
        setMicOn(next);
    }

    function handleEditorChange(value?: string) {
        const nextCode = value ?? "";
        setSharedCode(nextCode);
        sharedCodeRef.current = nextCode;

        if (!canEditSharedEditor || !detail) return;
        if (syncDebounceRef.current) clearTimeout(syncDebounceRef.current);
        syncDebounceRef.current = setTimeout(() => {
            syncEditorState({
                expertSessionId: detail.id,
                code: sharedCodeRef.current,
                language: sharedLanguage,
                revision: sharedRevision + 1,
            });
        }, 250);
    }

    function handleLanguageChange(nextLanguage: string) {
        const normalized = normalizeLanguage(nextLanguage);
        const nextCode = starterCodeByLanguage[normalized] || STARTER_CODE[normalized] || sharedCode;
        setSharedLanguage(normalized);
        setSharedCode(nextCode);
        sharedCodeRef.current = nextCode;

        if (!canEditSharedEditor || !detail) return;
        syncEditorState({
            expertSessionId: detail.id,
            code: nextCode,
            language: normalized,
            revision: sharedRevision + 1,
        });
    }

    function handleSendChat() {
        const text = chatInput.trim();
        if (!text || !detail) return;
        sendChatMessage(detail.id, text);
        setChatInput("");
    }

    async function executeCode(mode: "run" | "submit") {
        if (!session?.access_token || !detail || !activeQuestion?.questionId || !canEditSharedEditor) return;

        const running = { run: { status: "Running", passed: false } };
        if (mode === "run") setIsRunning(true);
        else setIsSubmitting(true);
        setExecutionError(null);
        setExecutionResults(running);
        sendExecutionSync({
            expertSessionId: detail.id,
            phase: "running",
            mode,
            language: sharedLanguage,
            results: running,
            hiddenSummary: null,
            executionError: null,
        });

        try {
            const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/ide/${mode}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${session.access_token}`,
                },
                body: JSON.stringify({
                    questionId: activeQuestion.questionId,
                    code: sharedCode,
                    language: sharedLanguage,
                }),
            });
            const payload = await response.json();
            if (!response.ok) {
                throw new Error(payload?.error || "Failed to execute code");
            }

            const sampleTests = payload?.sample?.tests || [];
            const mapped: Record<string, ExecutionResult> = {};
            if (sampleTests.length > 0) {
                sampleTests.forEach((test: any, index: number) => {
                    mapped[`case_${index}`] = {
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
            } else {
                mapped.run = {
                    status: payload?.success ? "Accepted" : "Completed",
                    passed: Boolean(payload?.success),
                    stdout: formatValue(payload),
                };
            }

            const nextHiddenSummary = mode === "submit" ? (payload?.hidden?.summary || null) : null;
            setExecutionResults(mapped);
            setHiddenSummary(nextHiddenSummary);
            sendExecutionSync({
                expertSessionId: detail.id,
                phase: "completed",
                mode,
                language: sharedLanguage,
                results: mapped,
                hiddenSummary: nextHiddenSummary,
                executionError: null,
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to execute code";
            setExecutionError(message);
            sendExecutionSync({
                expertSessionId: detail.id,
                phase: "completed",
                mode,
                language: sharedLanguage,
                results: {},
                hiddenSummary: null,
                executionError: message,
            });
        } finally {
            setIsRunning(false);
            setIsSubmitting(false);
        }
    }

    async function handleEndInterview() {
        if (!token || !detail || endingInterview) return;
        setEndingInterview(true);
        setError(null);
        const afterEndHref = detail.myRole === "expert"
            ? `/expert/sessions/${detail.id}?feedback=1`
            : `/interviews/expert/session/${detail.id}`;
        try {
            await api.post(`/experts/sessions/${detail.id}/complete`, {}, token);
            endSession(detail.id);
            router.replace(afterEndHref);
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to end interview";
            if (message.toLowerCase().includes("already finished")) {
                endSession(detail.id);
                router.replace(afterEndHref);
                return;
            }
            setError(message);
            setEndingInterview(false);
        }
    }

    if (loading && !detail) {
        return <main className="p-6 text-sm text-slate-500">Joining expert interview...</main>;
    }

    if (!detail) {
        return (
            <main className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center px-6 text-center">
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-rose-50 text-rose-600">
                    <span className="material-symbols-outlined text-3xl">videocam_off</span>
                </div>
                <h1 className="text-xl font-bold text-slate-950 dark:text-white">Could not join interview</h1>
                <p className="mt-2 text-sm text-slate-500">{error || "The interview room is unavailable."}</p>
                <Link href={`/interviews/expert/session/${sessionId}`} className="mt-5 inline-flex h-10 items-center rounded-lg bg-slate-950 px-4 text-sm font-bold text-white">
                    Back to details
                </Link>
            </main>
        );
    }

    if (isWaitingInLobby) {
        return (
            <main className="flex min-h-full items-center justify-center bg-[#F8FAFC] px-4 py-10 dark:bg-lc-bg">
                <section className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-xl dark:border-lc-border dark:bg-lc-surface">
                    <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300">
                        <span className="material-symbols-outlined text-3xl">meeting_room</span>
                    </div>
                    <p className="mt-6 text-xs font-black uppercase tracking-[0.18em] text-emerald-600">Lobby</p>
                    <h1 className="mt-2 text-2xl font-black text-slate-950 dark:text-white">Waiting for the expert to let you in</h1>
                    <p className="mt-3 text-sm leading-6 text-slate-500 dark:text-slate-400">
                        You are in the waiting lobby for your expert interview with {detail.expert.fullName}. Keep this page open; you will enter the room automatically once the expert accepts your request.
                    </p>
                    <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left dark:border-lc-border dark:bg-lc-bg">
                        <div className="flex items-center gap-3">
                            <span className="size-2 animate-pulse rounded-full bg-emerald-500" />
                            <div>
                                <p className="text-sm font-bold text-slate-800 dark:text-white">Request sent to expert</p>
                                <p className="text-xs text-slate-500 dark:text-slate-400">{lobbyState?.message || "Waiting for approval."}</p>
                            </div>
                        </div>
                    </div>
                    {lastError && <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{lastError}</p>}
                    <Link href={`/interviews/expert/session/${detail.id}`} className="mt-6 inline-flex h-11 items-center justify-center rounded-lg border border-slate-200 px-4 text-sm font-bold text-slate-700 hover:bg-slate-50 dark:border-lc-border dark:text-slate-200">
                        Back to session details
                    </Link>
                </section>
            </main>
        );
    }

    return (
        <div className="flex-1 overflow-hidden bg-[#FAFBFC] dark:bg-lc-bg">
            <div className="flex h-full flex-col">
                <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 dark:border-lc-border dark:bg-lc-surface sm:px-6">
                    <div className="flex min-w-0 items-center gap-3">
                        <Link href={backHref} className="inline-flex size-9 items-center justify-center rounded-full border border-slate-200 text-slate-600 transition-colors hover:bg-slate-100 dark:border-lc-border dark:text-slate-200 dark:hover:bg-lc-border">
                            <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                        </Link>
                        <div className="min-w-0">
                            <h1 className="truncate text-sm font-bold text-slate-900 dark:text-white sm:text-base">
                                {detail.interviewType.replace("_", " ")} expert session
                            </h1>
                            <p className="truncate text-[11px] text-slate-500 sm:text-xs">
                                {roleLabel} · {connectionLabel} · Status: {sessionState?.status || detail.status}
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 sm:gap-4">
                        <div className="hidden items-center gap-1.5 text-slate-700 dark:text-slate-200 sm:flex">
                            <span className="material-symbols-outlined text-[18px]">schedule</span>
                            <span className="font-mono text-[14px] font-bold">{formatDuration(Math.max(0, totalSeconds - elapsedSeconds))}</span>
                        </div>
                        <div className="hidden items-center gap-1.5 text-slate-700 dark:text-slate-200 sm:flex">
                            <span className="size-2 animate-pulse rounded-full bg-red-500" />
                            <span className="text-[13px] font-bold">REC</span>
                        </div>
                        <button
                            onClick={handleEndInterview}
                            disabled={endingInterview}
                            className="inline-flex items-center gap-1 rounded-full bg-[#E11D48] px-3 py-2 text-[12px] font-bold text-white hover:bg-[#BE123C] disabled:cursor-not-allowed disabled:opacity-60 sm:gap-2 sm:px-5 sm:text-sm"
                            title="End Interview"
                        >
                            <span className="material-symbols-outlined text-[16px]">{endingInterview ? "sync" : "call_end"}</span>
                            <span>{endingInterview ? "Ending..." : "End Interview"}</span>
                        </button>
                    </div>
                </header>

                <main className="mx-auto flex w-full max-w-[1700px] flex-1 flex-col gap-4 overflow-auto px-4 pb-6 pt-4 sm:px-6">
                    {(mediaError || error || lastError || sessionEnded) && (
                        <div className="space-y-2">
                            {mediaError && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">{mediaError}</p>}
                            {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400">{error}</p>}
                            {lastError && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400">{lastError}</p>}
                            {sessionEnded && <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300">Interview ended at {formatTime(sessionEnded.endedAt)}.</p>}
                        </div>
                    )}

                    {detail.myRole === "expert" && pendingLobbyRequests.length > 0 && (
                        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm dark:border-emerald-500/20 dark:bg-emerald-500/10">
                            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                                <div className="flex items-start gap-3">
                                    <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-white text-emerald-700 shadow-sm dark:bg-lc-surface dark:text-emerald-300">
                                        <span className="material-symbols-outlined">person_add</span>
                                    </div>
                                    <div>
                                        <p className="text-sm font-black text-slate-950 dark:text-white">{detail.candidate.fullName} is waiting in the lobby</p>
                                        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Review the pending request and let the candidate into the interview room.</p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => admitCandidate(detail.id, detail.candidate.id)}
                                    className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-black text-white hover:bg-emerald-700"
                                >
                                    <span className="material-symbols-outlined text-[18px]">login</span>
                                    Admit candidate
                                </button>
                            </div>
                        </section>
                    )}

                    <section className="flex min-h-[760px] flex-1 flex-col gap-5 xl:flex-row">
                        <aside className="flex w-full shrink-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-lc-border dark:bg-lc-surface xl:w-[360px]">
                            <div className="border-b border-slate-100 px-4 py-3 dark:border-lc-border">
                                <h2 className="text-[12px] font-bold uppercase tracking-wider text-slate-500">Problem</h2>
                            </div>
                            {detail.questions.length > 1 && (
                                <div className="flex gap-2 overflow-x-auto border-b border-slate-100 p-3 dark:border-lc-border">
                                    {detail.questions.map((question) => (
                                        <button
                                            key={question.id}
                                            onClick={() => setActiveQuestionId(question.id)}
                                            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-bold ${
                                                activeQuestion?.id === question.id
                                                    ? "bg-slate-900 text-white dark:bg-white dark:text-slate-950"
                                                    : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-lc-bg dark:text-slate-300"
                                            }`}
                                        >
                                            Q{question.orderIndex + 1}
                                        </button>
                                    ))}
                                </div>
                            )}
                            <div className="custom-scrollbar flex-1 space-y-4 overflow-y-auto p-4 text-[14px] leading-relaxed text-[#475569] dark:text-[#ababab]">
                                {!activeQuestion && <div className="text-sm text-slate-500">Question assignment is still syncing.</div>}
                                {activeQuestion && (
                                    <div className="space-y-2">
                                        <div className="font-semibold leading-snug text-slate-900 dark:text-white">{questionDetails?.title || activeQuestion.title}</div>
                                        <div className="text-sm text-slate-500">{activeQuestion.difficulty} · {activeQuestion.topic}</div>
                                    </div>
                                )}
                                {questionLoading && <div className="text-sm text-slate-500">Loading problem statement...</div>}
                                {questionError && <div className="text-sm text-red-600 dark:text-red-400">{questionError}</div>}
                                {activeQuestion?.customPrompt && (
                                    <div className="prose prose-sm max-w-none dark:prose-invert">
                                        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
                                            {activeQuestion.customPrompt}
                                        </ReactMarkdown>
                                    </div>
                                )}
                                {questionDetails && (
                                    <>
                                        <div className="prose prose-sm max-w-none prose-pre:border prose-pre:border-slate-200 prose-pre:bg-slate-50 prose-pre:text-slate-800 dark:prose-invert dark:prose-pre:border-lc-border dark:prose-pre:bg-lc-bg dark:prose-pre:text-[#d4d4d4]">
                                            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
                                                {questionDetails.statement || questionDetails.problemMd || questionDetails.problem_md || questionDetails.description || ""}
                                            </ReactMarkdown>
                                        </div>
                                        {questionDetails.examples && questionDetails.examples.length > 0 && (
                                            <div className="mt-4">
                                                <h3 className="mb-4 text-[13px] font-bold uppercase tracking-wider text-slate-900 dark:text-white">Examples</h3>
                                                <div className="space-y-4">
                                                    {questionDetails.examples.map((example, index) => (
                                                        <div key={index} className="space-y-2 rounded-lg border border-slate-200 bg-[#F8FAFC] p-4 font-mono text-[13px] text-slate-800 dark:border-lc-border dark:bg-lc-bg dark:text-[#d4d4d4]">
                                                            <div className="text-sm font-bold text-slate-900 dark:text-white">Example {index + 1}:</div>
                                                            <div><span className="font-bold opacity-60">Input:</span> {formatValue(example.input)}</div>
                                                            <div><span className="font-bold opacity-60">Output:</span> {formatValue(example.output)}</div>
                                                            {example.explanation && (
                                                                <div className="mt-2 border-t border-slate-200 pt-2 dark:border-lc-border/50">
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
                                                <h3 className="mb-4 text-[13px] font-bold uppercase tracking-wider text-slate-900 dark:text-white">Constraints</h3>
                                                <div className="rounded-lg border border-slate-200 bg-[#F8FAFC] p-4 dark:border-lc-border dark:bg-lc-bg">
                                                    <ul className="list-disc space-y-1.5 pl-4 font-mono text-[13px] text-slate-800 marker:text-slate-400 dark:text-[#d4d4d4]">
                                                        {typeof questionDetails.constraints === "string"
                                                            ? questionDetails.constraints.split("\n").filter((line) => line.trim()).map((line, index) => <li key={index}>{line.replace("- ", "")}</li>)
                                                            : questionDetails.constraints.map((line, index) => <li key={index}>{line}</li>)}
                                                    </ul>
                                                </div>
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        </aside>

                        <section className="flex min-h-[520px] min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-lc-border dark:bg-lc-surface xl:min-h-0">
                            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-lc-border">
                                <div className="flex items-center gap-2">
                                    <span className="font-mono text-lg font-bold text-blue-500">&lt; &gt;</span>
                                    <h2 className="text-sm font-bold text-slate-800 dark:text-white">Shared Coding IDE</h2>
                                </div>
                                <div className="flex items-center gap-2 text-xs">
                                    <button onClick={() => setEditorTheme(editorTheme === "vs-dark" ? "light" : "vs-dark")} className="flex items-center justify-center text-slate-500 transition-colors hover:text-slate-800 dark:text-[#ababab] dark:hover:text-white" title="Toggle IDE Theme">
                                        <span className="material-symbols-outlined text-[18px]">{editorTheme === "vs-dark" ? "light_mode" : "dark_mode"}</span>
                                    </button>
                                    <button
                                        onClick={() => {
                                            setSharedCode("");
                                            setExecutionResults({});
                                            setExecutionError(null);
                                            setHiddenSummary(null);
                                        }}
                                        disabled={!canEditSharedEditor}
                                        className="flex items-center justify-center text-slate-500 transition-colors hover:text-slate-800 disabled:opacity-50 dark:text-[#ababab] dark:hover:text-white"
                                        title="Reset Code"
                                    >
                                        <span className="material-symbols-outlined text-[18px]">restart_alt</span>
                                    </button>
                                    <select value={sharedLanguage} onChange={(event) => handleLanguageChange(event.target.value)} disabled={!canEditSharedEditor} className="rounded border border-slate-200 bg-slate-100 px-2 py-1 text-[12px] font-bold text-slate-700 disabled:opacity-60 dark:border-lc-border dark:bg-lc-bg dark:text-white">
                                        {EDITOR_LANGUAGES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                                    </select>
                                    <span className="rounded-md bg-slate-100 px-2 py-1 text-slate-600 dark:bg-lc-border dark:text-slate-300">{canEditSharedEditor ? "Write access: You" : "Write access: Candidate"}</span>
                                    <span className="text-slate-500">Rev {editorState?.revision ?? sharedRevision}</span>
                                </div>
                            </div>

                            <div className="min-h-0 flex-1">
                                <MonacoEditor
                                    height="100%"
                                    language={sharedLanguage || "python"}
                                    value={sharedCode}
                                    onChange={handleEditorChange}
                                    theme={editorTheme}
                                    options={{
                                        minimap: { enabled: false },
                                        fontSize: 14,
                                        readOnly: !canEditSharedEditor,
                                        wordWrap: "on",
                                    }}
                                />
                            </div>

                            <div className="h-[260px] shrink-0 overflow-auto border-t border-slate-200 bg-white p-4 dark:border-lc-border dark:bg-lc-surface">
                                <div className="mb-3 flex items-center justify-between border-b border-slate-100 px-2 pb-3 dark:border-lc-border">
                                    <div className="flex items-center gap-2">
                                        <span className="material-symbols-outlined text-[18px] text-slate-500">terminal</span>
                                        <span className="text-[13px] font-bold uppercase tracking-wider text-slate-700 dark:text-white">Test Results</span>
                                    </div>
                                    <div className="flex gap-3">
                                        <button onClick={() => executeCode("run")} disabled={isRunning || isSubmitting || !activeQuestion?.questionId || !canEditSharedEditor} className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-bold text-slate-700 shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 dark:border-lc-border dark:bg-lc-surface dark:text-[#eff1f6]">
                                            <span className="material-symbols-outlined text-[18px]">{isRunning ? "sync" : "play_arrow"}</span>
                                            {isRunning ? "Running..." : "Run Tests"}
                                        </button>
                                        <button onClick={() => executeCode("submit")} disabled={isRunning || isSubmitting || !activeQuestion?.questionId || !canEditSharedEditor} className="flex items-center gap-1.5 rounded-lg bg-[#10b981] px-4 py-1.5 text-sm font-bold text-white shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50">
                                            <span className="material-symbols-outlined text-[18px]">{isSubmitting ? "sync" : "cloud_upload"}</span>
                                            {isSubmitting ? "Submitting..." : "Submit"}
                                        </button>
                                    </div>
                                </div>
                                {executionError && (
                                    <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 font-mono text-[13px] whitespace-pre-wrap text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
                                        <div className="mb-1 flex items-center gap-1.5">
                                            <span className="material-symbols-outlined text-[16px]">error</span>
                                            <span className="text-[11px] font-bold uppercase tracking-wider">Compile / Runtime Error</span>
                                        </div>
                                        {executionError}
                                    </div>
                                )}
                                {hiddenSummary && (
                                    <div className={`mb-3 flex items-center justify-between rounded-lg p-3 text-[13px] font-bold ${hiddenSummary.passed === hiddenSummary.total ? "border border-green-200 bg-green-50 text-green-700 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-400" : "border border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400"}`}>
                                        <span>Hidden Tests: {hiddenSummary.passed}/{hiddenSummary.total} passed</span>
                                    </div>
                                )}
                                {testCasesToDisplay.length > 0 ? (
                                    <div className="flex h-full flex-col gap-4">
                                        <div className="flex gap-6 border-b border-slate-100 px-2 dark:border-lc-border">
                                            {testCasesToDisplay.map((testCase, index) => {
                                                const testId = testCase.id || `case_${index}`;
                                                const result = executionResults[testId];
                                                let dotColor = "bg-slate-300 dark:bg-slate-600";
                                                if (result) {
                                                    if (result.status === "Running") dotColor = "animate-pulse bg-blue-400";
                                                    else if (result.passed) dotColor = "bg-green-500";
                                                    else dotColor = "bg-red-500";
                                                }
                                                return (
                                                    <button key={testId} onClick={() => setActiveTestCase(index)} className={`relative top-[1px] flex items-center gap-1.5 border-b-2 pb-3 text-[13px] font-bold transition-colors ${activeTestCase === index ? "border-orange-500 text-orange-500" : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"}`}>
                                                        <span className={`size-2 rounded-full ${dotColor}`} />
                                                        Case {index + 1}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                        <div className="custom-scrollbar flex flex-1 gap-4 overflow-auto pb-4">
                                            {["Input", "Expected", "Output"].map((label) => {
                                                const testCase = testCasesToDisplay[activeTestCase];
                                                const testId = testCase?.id || `case_${activeTestCase}`;
                                                const result = executionResults[testId];
                                                const value = label === "Input"
                                                    ? (testCase?.stdin ?? testCase?.input)
                                                    : label === "Expected"
                                                        ? (testCase?.expected_output ?? testCase?.output)
                                                        : (result?.stdout || result?.stderr || result?.compile_output || "Run code to see output");
                                                return (
                                                    <div key={label} className="flex min-w-0 flex-1 flex-col gap-2">
                                                        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
                                                        <div className="custom-scrollbar flex-1 overflow-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] text-slate-800 dark:border-lc-border dark:bg-[#1e1e1e] dark:text-[#d4d4d4]">
                                                            {formatValue(value)}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex h-full flex-col items-center justify-center text-[13px] text-slate-400 dark:text-slate-500">
                                        <span className="material-symbols-outlined mb-2 text-3xl opacity-50">data_object</span>
                                        <p>{activeQuestion?.questionId ? "No sample test cases available for this question." : "Run/submit is available for platform questions."}</p>
                                    </div>
                                )}
                            </div>

                            {!canEditSharedEditor && (
                                <div className="border-t border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-400">
                                    Editor is read-only for the expert. The candidate writes here while you guide them.
                                </div>
                            )}
                        </section>

                        <aside className="custom-scrollbar flex w-full shrink-0 flex-col gap-4 overflow-y-auto pr-1 xl:w-[340px]">
                            {detail.myRole === "expert" && (
                                <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-lc-border dark:bg-lc-surface">
                                    <div className="mb-3 flex items-center justify-between">
                                        <h2 className="text-[12px] font-bold uppercase tracking-wider text-slate-500">Pending requests</h2>
                                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600 dark:bg-lc-bg dark:text-slate-300">{pendingLobbyRequests.length}</span>
                                    </div>
                                    {pendingLobbyRequests.length === 0 ? (
                                        <p className="text-sm text-slate-500">No one is waiting in the lobby.</p>
                                    ) : (
                                        <div className="space-y-3">
                                            {pendingLobbyRequests.map((request) => (
                                                <div key={`${request.expertSessionId}-${request.userId}`} className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-500/20 dark:bg-emerald-500/10">
                                                    <p className="text-sm font-bold text-slate-900 dark:text-white">{detail.candidate.fullName}</p>
                                                    <p className="mt-1 text-xs text-slate-500">Waiting since {formatTime(request.requestedAt)}</p>
                                                    <button
                                                        onClick={() => admitCandidate(detail.id, request.userId)}
                                                        className="mt-3 inline-flex h-9 w-full items-center justify-center rounded-lg bg-emerald-600 text-sm font-bold text-white hover:bg-emerald-700"
                                                    >
                                                        Let in
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </section>
                            )}

                            <section className="space-y-2">
                                <h2 className="text-[12px] font-bold uppercase tracking-wider text-slate-500">{detail.myRole === "expert" ? "Candidate Video" : "Expert Video"}</h2>
                                <div className="relative h-44 overflow-hidden rounded-xl border border-slate-200 bg-slate-900 dark:border-lc-border">
                                    <video ref={remoteVideoRef} autoPlay playsInline className="absolute inset-0 h-full w-full object-cover" />
                                    <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent" />
                                    <div className="absolute left-2 top-2 z-10 text-[11px] font-bold uppercase tracking-wider text-white/80">{otherPerson?.fullName || "Participant"}</div>
                                </div>
                            </section>

                            <section className="space-y-2">
                                <h2 className="text-[12px] font-bold uppercase tracking-wider text-slate-500">Your Video</h2>
                                <div className="relative h-44 overflow-hidden rounded-xl border border-slate-200 bg-slate-900 dark:border-lc-border">
                                    <video ref={localVideoRef} autoPlay playsInline muted className={`absolute inset-0 h-full w-full object-cover ${cameraOn ? "block" : "hidden"}`} style={{ transform: "scaleX(-1)" }} />
                                    {!cameraOn && (
                                        <div className="absolute inset-0 flex items-center justify-center text-white/70">
                                            <span className="material-symbols-outlined text-[28px]">videocam_off</span>
                                        </div>
                                    )}
                                    <div className="absolute left-2 top-2 z-10 text-[11px] font-bold uppercase tracking-wider text-white/80">You</div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <button onClick={toggleMic} className={`flex items-center justify-center rounded-full px-3 py-1 transition-all ${!micOn ? "bg-red-500 text-white hover:bg-red-600" : "bg-slate-700/80 text-white hover:bg-slate-600"}`} title={micOn ? "Mute" : "Unmute"}>
                                        <span className="material-symbols-outlined text-[14px] leading-none">{micOn ? "mic" : "mic_off"}</span>
                                    </button>
                                    <button onClick={toggleCamera} className={`flex items-center justify-center rounded-full px-3 py-1 transition-all ${!cameraOn ? "bg-red-500 text-white hover:bg-red-600" : "bg-slate-700/80 text-white hover:bg-slate-600"}`} title={cameraOn ? "Turn off camera" : "Turn on camera"}>
                                        <span className="material-symbols-outlined text-[14px] leading-none">{cameraOn ? "videocam" : "videocam_off"}</span>
                                    </button>
                                </div>
                                <div className="text-sm text-slate-500">{mediaError || (mediaReady ? "Media connected. Establishing peer link..." : "Initializing camera and microphone...")}</div>
                            </section>

                            <section className="flex min-h-[560px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-lc-border dark:bg-lc-surface">
                                <div className="flex items-center justify-between border-b border-slate-100 p-3 dark:border-lc-border">
                                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Transcript / Chat</span>
                                    <span className="material-symbols-outlined text-sm text-slate-400">forum</span>
                                </div>
                                <div className="custom-scrollbar h-[460px] space-y-2 overflow-y-auto p-3">
                                    {chatMessages.length === 0 ? (
                                        <div className="text-sm text-slate-500">No messages yet.</div>
                                    ) : (
                                        chatMessages.map((message) => (
                                            <div key={message.id} className={`text-sm ${message.userId === user?.id ? "text-right" : "text-left"}`}>
                                                <span className="mr-2 font-semibold text-slate-700 dark:text-slate-200">{message.userId === user?.id ? "You" : otherPerson?.fullName || "Participant"}</span>
                                                <span className="text-slate-700 dark:text-slate-300">{message.text}</span>
                                            </div>
                                        ))
                                    )}
                                </div>
                                <div className="flex gap-2 border-t border-slate-100 p-3 dark:border-lc-border">
                                    <input
                                        value={chatInput}
                                        onChange={(event) => setChatInput(event.target.value)}
                                        onKeyDown={(event) => {
                                            if (event.key === "Enter") {
                                                event.preventDefault();
                                                handleSendChat();
                                            }
                                        }}
                                        placeholder="Send a message"
                                        className="flex-1 rounded-lg border px-3 py-2 dark:border-lc-border dark:bg-lc-bg"
                                    />
                                    <button onClick={handleSendChat} className="rounded-lg bg-slate-900 px-4 py-2 text-white dark:bg-white dark:text-slate-950">
                                        Send
                                    </button>
                                </div>
                            </section>
                        </aside>
                    </section>
                </main>
            </div>
        </div>
    );
}
