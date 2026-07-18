"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import { createSupabaseBrowserClient } from "@/lib/supabase";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export interface ChatMessage {
    id: string;
    role: "ai" | "user";
    text: string;
    isStreaming?: boolean;
    hidden?: boolean;
}

export interface InterviewEvent {
    type: string;
    payload: any;
}

export function useInterviewSocket(sessionId: string | null) {
    const socketRef = useRef<Socket | null>(null);
    const latestCanvasSnapshotRef = useRef<any[] | null>(null);
    const pendingCanvasSnapshotRef = useRef<any[] | null>(null);
    const canvasFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastCanvasEmitAtRef = useRef(0);
    const CANVAS_EMIT_INTERVAL_MS = 100;
    const [connected, setConnected] = useState(false);
    const [isJoined, setIsJoined] = useState(false);
    // True while a previously-joined socket is reconnecting (brief network blip).
    // Lets the UI show a small "reconnecting" banner instead of the full loading screen.
    const [isReconnecting, setIsReconnecting] = useState(false);
    const wasJoinedRef = useRef(false);
    const [socketInstance, setSocketInstance] = useState<Socket | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>(() => {
        if (typeof window === "undefined" || !sessionId) return [];
        const saved = localStorage.getItem(`practers_interview_${sessionId}_messages`);
        if (!saved) return [];
        try { return JSON.parse(saved); } catch { return []; }
    });
    const [currentStage, setCurrentStage] = useState<string>(() => {
        if (typeof window === "undefined" || !sessionId) return "INTRO";
        return localStorage.getItem(`practers_interview_${sessionId}_stage`) || "INTRO";
    });
    const [activePanel, setActivePanel] = useState<string | null>(() => {
        if (typeof window === "undefined" || !sessionId) return null;
        return localStorage.getItem(`practers_interview_${sessionId}_activePanel`) || null;
    });
    const [panelData, setPanelData] = useState<any>(() => {
        if (typeof window === "undefined" || !sessionId) return null;
        const saved = localStorage.getItem(`practers_interview_${sessionId}_panelData`);
        if (!saved) return null;
        try { return JSON.parse(saved); } catch { return null; }
    });
    const [error, setError] = useState<string | null>(null);
    const [interviewType, setInterviewType] = useState<string | null>(() => {
        if (typeof window === "undefined" || !sessionId) return null;
        return localStorage.getItem(`practers_interview_${sessionId}_interviewType`) || null;
    });
    const [stageDurations, setStageDurations] = useState<Record<string, { min: number; max: number }> | null>(null);
    const [estimatedMinutes, setEstimatedMinutes] = useState<number | null>(null);
    const [isAudioPlaying, setIsAudioPlaying] = useState(false);
    const [sessionEnded, setSessionEnded] = useState(false);
    const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [hasRestoredState, setHasRestoredState] = useState(true); // Initialized directly now
    const currentQuestionIdRef = useRef<string | null>(null);
    const activePanelRef = useRef<string | null>(null);

    // Sync refs with state
    useEffect(() => {
        activePanelRef.current = activePanel;
        if (panelData) {
            currentQuestionIdRef.current = panelData?.question?.id || panelData?.id || null;
        } else {
            currentQuestionIdRef.current = null;
        }
    }, [activePanel, panelData]);

    // ── State Persistence Helpers ────────────────────────────
    const getStateKey = useCallback((key: string) => {
        return sessionId ? `practers_interview_${sessionId}_${key}` : null;
    }, [sessionId]);

    const clearState = useCallback(() => {
        if (!sessionId) return;
        try {
            localStorage.removeItem(getStateKey("messages")!);
            localStorage.removeItem(getStateKey("stage")!);
            localStorage.removeItem(getStateKey("interviewType")!);
            localStorage.removeItem(getStateKey("activePanel")!);
            localStorage.removeItem(getStateKey("panelData")!);
        } catch (err) {
            console.warn("[Interview] Failed to clear state from localStorage:", err);
        }
    }, [sessionId, getStateKey]);

    const saveState = useCallback(() => {
        if (!sessionId) return;
        try {
            localStorage.setItem(getStateKey("messages")!, JSON.stringify(messages));
            localStorage.setItem(getStateKey("stage")!, currentStage);
            localStorage.setItem(getStateKey("interviewType")!, interviewType || "");
            if (activePanel) {
                localStorage.setItem(getStateKey("activePanel")!, activePanel);
            } else {
                localStorage.removeItem(getStateKey("activePanel")!);
            }
            if (panelData) {
                localStorage.setItem(getStateKey("panelData")!, JSON.stringify(panelData));
            } else {
                localStorage.removeItem(getStateKey("panelData")!);
            }
        } catch (err) {
            console.warn("[Interview] Failed to save state to localStorage:", err);
        }
    }, [sessionId, messages, currentStage, interviewType, activePanel, panelData, getStateKey]);

    // Save state whenever it changes (debounced via useEffect)
    useEffect(() => {
        if (!sessionId) return;
        const timer = setTimeout(saveState, 500); // Debounce 500ms
        return () => clearTimeout(timer);
    }, [messages, currentStage, interviewType, activePanel, panelData, saveState]);

    const flushCanvasSnapshot = useCallback(() => {
        if (!socketRef.current) return;
        const pending = pendingCanvasSnapshotRef.current;
        if (!pending) return;

        pendingCanvasSnapshotRef.current = null;
        lastCanvasEmitAtRef.current = Date.now();
        socketRef.current.emit("canvas:snapshot", { elements: pending });
    }, []);

    const buildChatMessagePayload = useCallback((content: string) => {
        const payload: { content: string; canvasSnapshot?: any } = { content };
        const snapshot = latestCanvasSnapshotRef.current;
        if (Array.isArray(snapshot) || (snapshot && typeof snapshot === "object")) {
            payload.canvasSnapshot = snapshot;
        }
        return payload;
    }, []);

    const buildVoiceTextPayload = useCallback((content: string) => {
        const payload: { text: string; canvasSnapshot?: any } = { text: content };
        const snapshot = latestCanvasSnapshotRef.current;
        if (Array.isArray(snapshot) || (snapshot && typeof snapshot === "object")) {
            payload.canvasSnapshot = snapshot;
        }
        return payload;
    }, []);

    // Auto-dismiss errors after 6 seconds
    useEffect(() => {
        if (error) {
            if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
            errorTimerRef.current = setTimeout(() => setError(null), 6000);
        }
        return () => {
            if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
        };
    }, [error]);



    // Audio playback refs — gapless scheduled playback
    const audioContextRef = useRef<AudioContext | null>(null);
    const audioQueueRef = useRef<{ data: string; mimeType: string }[]>([]);
    const isPlayingRef = useRef(false);
    const audioStoppedRef = useRef(false);
    // Track the next scheduled play time for gapless audio
    const nextPlayTimeRef = useRef(0);
    // Track active sources so we can stop them on cleanup
    const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
    const aiCaptureContextRef = useRef<AudioContext | null>(null);
    const aiCaptureDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
    const aiCaptureNextPlayTimeRef = useRef(0);
    const aiCaptureSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
    const [aiAudioStream, setAiAudioStream] = useState<MediaStream | null>(null);

    // Helper: get or create AudioContext
    const getAudioContext = useCallback(() => {
        if (!audioContextRef.current || audioContextRef.current.state === "closed") {
            audioContextRef.current = new AudioContext({ sampleRate: 24000 });
        }
        if (audioContextRef.current.state === "suspended") {
            audioContextRef.current.resume();
        }
        return audioContextRef.current;
    }, []);

    const ensureAiAudioStream = useCallback(() => {
        if (!aiCaptureContextRef.current || aiCaptureContextRef.current.state === "closed") {
            aiCaptureContextRef.current = new AudioContext({ sampleRate: 24000 });
            aiCaptureDestinationRef.current = aiCaptureContextRef.current.createMediaStreamDestination();
            aiCaptureNextPlayTimeRef.current = 0;
            setAiAudioStream(aiCaptureDestinationRef.current.stream);
        }
        if (aiCaptureContextRef.current.state === "suspended") {
            aiCaptureContextRef.current.resume();
        }
        return aiCaptureDestinationRef.current?.stream ?? null;
    }, []);

    const stopAiCaptureAudio = useCallback(() => {
        aiCaptureNextPlayTimeRef.current = 0;
        for (const src of aiCaptureSourcesRef.current) {
            try { src.stop(); } catch { /* already stopped */ }
        }
        aiCaptureSourcesRef.current.clear();
    }, []);

    const scheduleAiCaptureChunk = useCallback((playbackBuffer: AudioBuffer) => {
        const captureCtx = aiCaptureContextRef.current;
        const destination = aiCaptureDestinationRef.current;
        if (!captureCtx || captureCtx.state === "closed" || !destination) return;

        if (captureCtx.state === "suspended") {
            captureCtx.resume();
        }

        const captureBuffer = captureCtx.createBuffer(
            playbackBuffer.numberOfChannels,
            playbackBuffer.length,
            playbackBuffer.sampleRate
        );
        for (let channel = 0; channel < playbackBuffer.numberOfChannels; channel++) {
            captureBuffer.copyToChannel(playbackBuffer.getChannelData(channel), channel);
        }

        const now = captureCtx.currentTime;
        const startAt = Math.max(aiCaptureNextPlayTimeRef.current, now);
        const source = captureCtx.createBufferSource();
        source.buffer = captureBuffer;
        source.connect(destination);
        aiCaptureSourcesRef.current.add(source);
        source.onended = () => {
            aiCaptureSourcesRef.current.delete(source);
        };
        source.start(startAt);
        aiCaptureNextPlayTimeRef.current = startAt + captureBuffer.duration;
    }, []);

    // Helper: decode a base64 PCM chunk into an AudioBuffer
    const decodeChunk = useCallback((ctx: AudioContext, data: string, mimeType: string): AudioBuffer => {
        const binaryStr = atob(data);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
        }

        const rateMatch = mimeType.match(/rate=(\d+)/);
        const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;

        const dataView = new DataView(bytes.buffer);
        const float32Array = new Float32Array(bytes.byteLength / 2);
        for (let i = 0; i < float32Array.length; i++) {
            const int16 = dataView.getInt16(i * 2, true);
            float32Array[i] = int16 / 32768.0;
        }

        const audioBuffer = ctx.createBuffer(1, float32Array.length, sampleRate);
        audioBuffer.getChannelData(0).set(float32Array);
        return audioBuffer;
    }, []);

    // Helper: schedule and play chunks gaplessly
    const playNextChunk = useCallback(async () => {
        if (audioStoppedRef.current) return;

        while (audioQueueRef.current.length > 0) {
            if (audioStoppedRef.current) return;
            const nextChunk = audioQueueRef.current.shift();
            if (!nextChunk) break;

            try {
                const ctx = getAudioContext();
                const audioBuffer = decodeChunk(ctx, nextChunk.data, nextChunk.mimeType);
                scheduleAiCaptureChunk(audioBuffer);

                // Schedule gaplessly: start right after the previous chunk ends
                const now = ctx.currentTime;
                const startAt = Math.max(nextPlayTimeRef.current, now);

                const source = ctx.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(ctx.destination);
                activeSourcesRef.current.add(source);

                source.onended = () => {
                    activeSourcesRef.current.delete(source);
                    // If queue is empty and no more sources, mark as done
                    if (activeSourcesRef.current.size === 0 && audioQueueRef.current.length === 0) {
                        isPlayingRef.current = false;
                        setIsAudioPlaying(false);
                    }
                };

                source.start(startAt);
                nextPlayTimeRef.current = startAt + audioBuffer.duration;

                isPlayingRef.current = true;
                setIsAudioPlaying(true);
            } catch (err) {
                console.error("[TTS/Voice] Audio playback error:", err);
            }
        }
    }, [getAudioContext, decodeChunk, scheduleAiCaptureChunk]);

    // Stop audio playback
    const stopAudio = useCallback(() => {
        audioStoppedRef.current = true;
        audioQueueRef.current = [];
        isPlayingRef.current = false;
        nextPlayTimeRef.current = 0;
        setIsAudioPlaying(false);
        // Stop all active source nodes immediately
        for (const src of activeSourcesRef.current) {
            try { src.stop(); } catch { /* already stopped */ }
        }
        activeSourcesRef.current.clear();
        stopAiCaptureAudio();
        if (audioContextRef.current && audioContextRef.current.state !== "closed") {
            audioContextRef.current.close();
            audioContextRef.current = null;
        }
    }, [stopAiCaptureAudio]);

    // Connect to the WebSocket server
    useEffect(() => {
        if (!sessionId) return;

        // Abort signal pattern to handle React Strict Mode double-mount
        let aborted = false;

        const connect = async () => {
            const { data } = await createSupabaseBrowserClient().auth.getSession();
            const token = data.session?.access_token;

            // Bail if unmounted during async token fetch
            if (aborted) return;

            if (!token) {
                setError("Not authenticated");
                return;
            }

            const socket = io(API_BASE, {
                auth: { token },
                transports: ["websocket"],  // skip polling — direct WS for lowest latency
                upgrade: false,
            });

            socketRef.current = socket;
            setSocketInstance(socket);

            socket.on("connect", () => {
                setConnected(true);
                setError(null);
                // Always emit session:join — the server is idempotent and will
                // return existing state without re-initializing if already active.
                socket.emit("session:join", { sessionId, isVoiceMode: true });
            });

            socket.on("disconnect", () => {
                setConnected(false);
                // If we were already in a session, keep isJoined=true so the
                // interview UI stays visible (not the loading screen) and show
                // a reconnecting banner instead.
                if (wasJoinedRef.current) {
                    setIsReconnecting(true);
                } else {
                    setIsJoined(false);
                }
            });
            socket.on("connect_error", (err) => setError(err.message));

            // Session joined confirmation
            socket.on("session:joined", (data) => {
                wasJoinedRef.current = true;
                setIsJoined(true);
                setIsReconnecting(false);
                // Sync server state (stage, interviewType) — server is source of truth
                setCurrentStage(data.stage);
                if (data.interviewType) setInterviewType(data.interviewType);
                // If this is a rejoin (isRejoin=true), keep restored messages/panel
                // If fresh join, server will send greeting via ai:token
                if (data.stageDurations) setStageDurations(data.stageDurations);
                if (typeof data.estimatedMinutes === "number") setEstimatedMinutes(data.estimatedMinutes);
            });

            socket.on("session:join_failed", ({ message }) => {
                setIsJoined(false);
                setIsReconnecting(false);
                setError(message || "Failed to initialize interview session");
            });

            // AI token streaming (text mode)
            let streamingMsg: { id: string; text: string } | null = null;

            socket.on("ai:token", ({ token: tok, messageId }) => {
                if (!streamingMsg || streamingMsg.id !== messageId) {
                    streamingMsg = { id: messageId, text: "" };
                    setMessages((prev) => {
                        if (prev.some((m) => m.id === messageId)) return prev;
                        return [
                            ...prev,
                            { id: messageId, role: "ai", text: "", isStreaming: true },
                        ];
                    });
                }
                streamingMsg.text += tok;
                const currentText = streamingMsg.text;
                setMessages((prev) =>
                    prev.map((m) =>
                        m.id === messageId ? { ...m, text: currentText } : m
                    )
                );
            });

            socket.on("ai:done", ({ messageId, fullContent }) => {
                streamingMsg = null;
                setMessages((prev) =>
                    prev.map((m) =>
                        m.id === messageId
                            ? { ...m, text: fullContent, isStreaming: false }
                            : m
                    )
                );
            });

            // ── Gemini Live Audio Playback (Voice Mode) ────────────────
            let voiceAudioChunkCount = 0;
            socket.on("voice:audio", ({ data }) => {
                audioStoppedRef.current = false;
                voiceAudioChunkCount++;
                if (voiceAudioChunkCount === 1 || voiceAudioChunkCount % 50 === 0) {
                    console.log(`[Frontend][Voice] Received server audio chunk #${voiceAudioChunkCount}`);
                }
                // Gemini Live emits PCM 24kHz natively down the wire
                audioQueueRef.current.push({ data, mimeType: "audio/pcm;rate=24000" });
                // Always call playNextChunk — it schedules any new chunks gaplessly
                playNextChunk();
            });

            // ── Barge-in: stop AI audio when user starts speaking ────
            const stopAiAudioForBargeIn = () => {
                audioStoppedRef.current = true;
                audioQueueRef.current = [];
                nextPlayTimeRef.current = 0;
                for (const src of activeSourcesRef.current) {
                    try { src.stop(); } catch { /* already stopped */ }
                }
                activeSourcesRef.current.clear();
                stopAiCaptureAudio();
                isPlayingRef.current = false;
                setIsAudioPlaying(false);
                if (voiceAiMsgId) {
                    const interruptedAiId = voiceAiMsgId;
                    setMessages((prev) =>
                        prev.map((m) =>
                            m.id === interruptedAiId ? { ...m, isStreaming: false } : m
                        )
                    );
                    voiceAiMsgId = null;
                    voiceAiText = "";
                }
            };

            // Server tells us Gemini detected barge-in
            socket.on("voice:interrupted", stopAiAudioForBargeIn);

            // ── Voice Transcripts → Merged into messages ────────
            let voiceAiMsgId: string | null = null;
            let voiceAiText = "";
            let voiceUserMsgId: string | null = null;
            let voiceUserText = "";

            socket.on("voice:ai-transcript", ({ text }) => {
                if (!text) return;

                // AI starting to speak means the user's turn is done — finalize user bubble
                if (voiceUserMsgId) {
                    const finalUserId = voiceUserMsgId;
                    setMessages((prev) =>
                        prev.map((m) =>
                            m.id === finalUserId ? { ...m, isStreaming: false } : m
                        )
                    );
                    voiceUserMsgId = null;
                    voiceUserText = "";
                }

                if (!voiceAiMsgId) {
                    voiceAiMsgId = `voice_ai_${Date.now()}`;
                    const newId = voiceAiMsgId;
                    setMessages((prev) => [
                        ...prev,
                        { id: newId, role: "ai", text: "", isStreaming: true },
                    ]);
                }
                // Incremental: just append the fragment (API includes proper spacing)
                voiceAiText += text;
                const currentText = voiceAiText;
                const currentId = voiceAiMsgId;
                setMessages((prev) =>
                    prev.map((m) =>
                        m.id === currentId ? { ...m, text: currentText } : m
                    )
                );
            });

            socket.on("voice:user-transcript", ({ text }) => {
                console.log(`[Frontend][Voice] Received voice:user-transcript event, text="${text?.substring(0, 100)}"`);
                if (!text) return;

                // Barge-in: user is speaking, stop AI audio immediately
                if (isPlayingRef.current || audioQueueRef.current.length > 0) {
                    console.log(`[Frontend][Voice] Barge-in detected - stopping AI audio`);
                    stopAiAudioForBargeIn();
                }

                // User starting to speak means the AI's turn is done — finalize AI bubble
                if (voiceAiMsgId) {
                    console.log(`[Frontend][Voice] Finalizing AI message ${voiceAiMsgId}`);
                    const finalAiId = voiceAiMsgId;
                    setMessages((prev) =>
                        prev.map((m) =>
                            m.id === finalAiId ? { ...m, isStreaming: false } : m
                        )
                    );
                    voiceAiMsgId = null;
                    voiceAiText = "";
                }

                if (!voiceUserMsgId) {
                    voiceUserMsgId = `voice_user_${Date.now()}`;
                    const newId = voiceUserMsgId;
                    console.log(`[Frontend][Voice] Creating new user message ${newId}`);
                    setMessages((prev) => [
                        ...prev,
                        { id: newId, role: "user", text: "", isStreaming: true },
                    ]);
                }
                // Incremental: just append the fragment (API includes proper spacing)
                voiceUserText += text;
                const currentText = voiceUserText.trim(); // trim for display only
                const currentId = voiceUserMsgId;
                console.log(`[Frontend][Voice] Updating user message ${currentId} with text: "${currentText.substring(0, 100)}"`);
                setMessages((prev) =>
                    prev.map((m) =>
                        m.id === currentId ? { ...m, text: currentText } : m
                    )
                );
            });

            socket.on("voice:turn-complete", () => {
                // Only finalize AI message here — user message is finalized
                // when the AI starts speaking (natural turn boundary)
                if (voiceAiMsgId) {
                    const finalId = voiceAiMsgId;
                    setMessages((prev) =>
                        prev.map((m) =>
                            m.id === finalId ? { ...m, isStreaming: false } : m
                        )
                    );
                    voiceAiMsgId = null;
                    voiceAiText = "";
                }
            });

            // Stage changes
            socket.on("stage:change", ({ stage }) => {
                setCurrentStage(stage);
            });

            socket.on("question:assign", (data) => {
                const incomingId = data?.question?.id;
                if (incomingId && incomingId === currentQuestionIdRef.current) {
                    console.log(`[Socket] Same question already active (${incomingId}), skipping question:assign to preserve state.`);
                    return;
                }
                currentQuestionIdRef.current = incomingId || null;
                setActivePanel("ide");
                setPanelData(data);
                // Update stage atomically with panel to avoid flicker
                // (stage:change may arrive before question:assign due to network ordering)
                if (data.stage) {
                    setCurrentStage(data.stage);
                }
            });

            socket.on("panel:open", (data) => {
                const incomingId = data?.question?.id || data?.id;
                // Use activePanelRef to avoid stale closures
                if (activePanelRef.current === data.type && incomingId && incomingId === currentQuestionIdRef.current) {
                    console.log(`[Socket] Same panel (${data.type}) and question (${incomingId}) already active, skipping panel:open.`);
                    return;
                }
                currentQuestionIdRef.current = incomingId || null;
                setActivePanel(data.type);
                setPanelData(data);
                if (data.stage) {
                    setCurrentStage(data.stage);
                }
            });

            socket.on("panel:close", () => {
                currentQuestionIdRef.current = null;
                setActivePanel(null);
                setPanelData(null);
            });

            // Hints
            socket.on("hint:show", (data) => {
                setMessages((prev) => [
                    ...prev,
                    {
                        id: `hint_${Date.now()}`,
                        role: "ai",
                        text: `💡 Hint ${data.hintNumber}/${data.totalHints}: ${data.hint}`,
                    },
                ]);
            });

            // Code execution results
            socket.on("code:result", (data) => {
                setPanelData((prev: any) => ({ ...prev, lastResult: data }));
            });

            // Session ending — AI called end_interview
            socket.on("session:ending", ({ message }) => {
                setSessionEnded(true);
                setMessages((prev) => [
                    ...prev,
                    { id: `sys_${Date.now()}`, role: "ai", text: `🎉 ${message}` },
                ]);
                // Clear persisted state since interview is complete
                clearState();
            });

            // Errors
            socket.on("error", ({ message }) => {
                setError(message);
            });
        };

        connect();

        return () => {
            aborted = true;
            wasJoinedRef.current = false;
            if (canvasFlushTimerRef.current) {
                clearTimeout(canvasFlushTimerRef.current);
                canvasFlushTimerRef.current = null;
            }
            pendingCanvasSnapshotRef.current = null;
            if (socketRef.current) {
                socketRef.current.emit("session:leave");
                socketRef.current.disconnect();
                socketRef.current = null;
            }
            setSocketInstance(null);
            setConnected(false);
            setIsJoined(false);
            setIsReconnecting(false);
            if (audioContextRef.current && audioContextRef.current.state !== "closed") {
                audioContextRef.current.close();
                audioContextRef.current = null;
            }
            stopAiCaptureAudio();
            if (aiCaptureContextRef.current && aiCaptureContextRef.current.state !== "closed") {
                aiCaptureContextRef.current.close();
                aiCaptureContextRef.current = null;
            }
            aiCaptureDestinationRef.current = null;
            setAiAudioStream(null);
        };
    // playNextChunk is stable (useCallback with stable deps) but keeping it
    // in the dep array would recreate the socket on any re-render that
    // re-memoizes it. sessionId is the only real dependency here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionId]);

    // Send a chat message (text mode)
    const sendMessage = useCallback(
        (content: string) => {
            if (!socketRef.current || !content.trim()) return;
            
            // Don't send if session not joined yet (prevents message loss on reload)
            if (!isJoined) {
                console.warn('[Interview] Cannot send message - session not joined yet. Waiting for connection...');
                setError('Connecting... Please wait a moment and try again.');
                return;
            }

            const msgId = `user_${Date.now()}`;
            setMessages((prev) => [
                ...prev,
                { id: msgId, role: "user", text: content },
            ]);

            socketRef.current.emit("chat:message", buildChatMessagePayload(content));
        },
        [buildChatMessagePayload, isJoined]
    );

    // Send typed message through voice channel (when voice is active)
    const sendVoiceText = useCallback(
        (content: string) => {
            if (!socketRef.current || !content.trim()) return;
            
            // Don't send if session not joined yet (prevents message loss on reload)
            if (!isJoined) {
                console.warn('[Interview] Cannot send voice text - session not joined yet. Waiting for connection...');
                setError('Connecting... Please wait a moment and try again.');
                return;
            }

            const msgId = `user_${Date.now()}`;
            setMessages((prev) => [
                ...prev,
                { id: msgId, role: "user", text: content },
            ]);

            socketRef.current.emit("voice:text", buildVoiceTextPayload(content));
        },
        [buildVoiceTextPayload, isJoined]
    );

    // Send a message to the AI without showing it in the transcript
    const sendSilentMessage = useCallback(
        (content: string) => {
            if (!socketRef.current || !content.trim()) return;
            if (!isJoined) {
                console.warn('[Interview] Cannot send silent message - session not joined yet.');
                return;
            }
            socketRef.current.emit("chat:message", buildChatMessagePayload(content));
        },
        [buildChatMessagePayload, isJoined]
    );

    // Send a message through the voice channel without showing it in the transcript
    const sendSilentVoiceText = useCallback(
        (content: string) => {
            if (!socketRef.current || !content.trim()) return;
            if (!isJoined) {
                console.warn('[Interview] Cannot send silent voice text - session not joined yet.');
                return;
            }
            socketRef.current.emit("voice:text", buildVoiceTextPayload(content));
        },
        [buildVoiceTextPayload, isJoined]
    );

    // Send code snapshot (called every 30s during DSA)
    const sendCodeSnapshot = useCallback(
        (code: string, language: string) => {
            socketRef.current?.emit("code:snapshot", { code, language, cursorLine: null });
        },
        []
    );

    // Send canvas snapshot (Excalidraw elements) explicitly
    const sendCanvasSnapshot = useCallback(
        (elements: any[]) => {
            latestCanvasSnapshotRef.current = elements;
            pendingCanvasSnapshotRef.current = elements;

            if (Array.isArray(elements) && elements.length > 0) {
                if (canvasFlushTimerRef.current) {
                    clearTimeout(canvasFlushTimerRef.current);
                    canvasFlushTimerRef.current = null;
                }
                flushCanvasSnapshot();
                return;
            }

            const elapsed = Date.now() - lastCanvasEmitAtRef.current;
            if (elapsed >= CANVAS_EMIT_INTERVAL_MS && !canvasFlushTimerRef.current) {
                flushCanvasSnapshot();
                return;
            }

            if (!canvasFlushTimerRef.current) {
                const waitMs = Math.max(40, CANVAS_EMIT_INTERVAL_MS - elapsed);
                canvasFlushTimerRef.current = setTimeout(() => {
                    canvasFlushTimerRef.current = null;
                    flushCanvasSnapshot();
                }, waitMs);
            }
        },
        [flushCanvasSnapshot]
    );

    const sendNotepadSnapshot = useCallback(
        (html: string) => {
            socketRef.current?.emit("notepad:snapshot", { html });
        },
        []
    );

    const closeActivePanel = useCallback(() => {
        currentQuestionIdRef.current = null;
        setActivePanel(null);
        setPanelData(null);
    }, []);

    // Request code execution (Only visible/sample cases)
    const runCode = useCallback(
        (code: string, language: string, questionId: string) => {
            socketRef.current?.emit("code:run", { code, language, questionId });
        },
        []
    );

    // Request code submission (All cases + AI notification)
    const submitCode = useCallback(
        (code: string, language: string, questionId: string) => {
            socketRef.current?.emit("code:submit", { code, language, questionId });
        },
        []
    );

    const requestDsaTimeout = useCallback(() => {
        socketRef.current?.emit("dsa:timeout");
    }, []);

    // Request session completion and wait for server ack to avoid disconnect race.
    const endInterview = useCallback(async (): Promise<boolean> => {
        if (!socketRef.current) return false;

        return await new Promise<boolean>((resolve) => {
            let settled = false;
            const timeout = setTimeout(() => {
                if (settled) return;
                settled = true;
                resolve(false);
            }, 2000);

            socketRef.current?.emit("session:end", (resp?: { ok?: boolean; error?: string }) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                if (!resp?.ok && resp?.error) {
                    setError(resp.error);
                }
                resolve(Boolean(resp?.ok));
            });
        });
    }, []);

    // Cleanly leave the session (voice + socket)
    const leaveSession = useCallback(() => {
        stopAudio();
        clearState(); // Clear persisted state when explicitly leaving
        if (canvasFlushTimerRef.current) {
            clearTimeout(canvasFlushTimerRef.current);
            canvasFlushTimerRef.current = null;
        }
        pendingCanvasSnapshotRef.current = null;
        if (socketRef.current) {
            socketRef.current.emit("session:leave");
            socketRef.current.disconnect();
        }
    }, [stopAudio, clearState]);

    return {
        socket: socketInstance,
        connected,
        isJoined,
        isReconnecting,
        messages,
        currentStage,
        activePanel,
        panelData,
        error,
        interviewType,
        stageDurations,
        estimatedMinutes,
        isAudioPlaying,
        aiAudioStream,
        ensureAiAudioStream,
        sessionEnded,
        sendMessage,
        sendVoiceText,
        sendSilentMessage,
        sendSilentVoiceText,
        clearError: () => setError(null),
        sendCodeSnapshot,
        sendCanvasSnapshot,
        sendNotepadSnapshot,
        closeActivePanel,
        runCode,
        submitCode,
        requestDsaTimeout,
        endInterview,
        leaveSession,
        stopAudio,
    };
}
