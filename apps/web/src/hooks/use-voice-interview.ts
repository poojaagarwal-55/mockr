"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import type { Socket } from "socket.io-client";

export type VoiceConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error' | 'fallback';

const VOICE_AUDIO_TRANSPORT = process.env.NEXT_PUBLIC_VOICE_AUDIO_TRANSPORT === "base64" ? "base64" : "binary";

interface UseVoiceInterviewOptions {
    sessionId: string;
    socket: Socket | null;
    isJoined: boolean;
    onFallbackModeTriggered: () => void;
    onError?: (error: string) => void;
}

export function useVoiceInterview(options: UseVoiceInterviewOptions) {
    const { sessionId, socket, isJoined, onFallbackModeTriggered, onError } = options;

    const [connectionState, setConnectionState] = useState<VoiceConnectionState>('idle');
    const [isMuted, setIsMuted] = useState(false);
    const [micAudioTrack, setMicAudioTrack] = useState<MediaStreamTrack | null>(null);

    // UI derivations
    const isVoiceActive = connectionState === 'connected' || connectionState === 'connecting' || connectionState === 'reconnecting';
    const isListening = connectionState === 'connected' && !isMuted;

    // Audio Capture State
    const audioContextRef = useRef<AudioContext | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const workletNodeRef = useRef<AudioWorkletNode | null>(null);
    const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);

    // Reconnection State
    const reconnectAttemptsRef = useRef(0);
    const MAX_RECONNECT_ATTEMPTS = 2;
    const isMutedRef = useRef(isMuted);
    const voiceReadyRef = useRef(false);

    // ── Fast base64 encoding (no O(n²) string concat) ──────────
    const toBase64 = useCallback((buffer: ArrayBuffer): string => {
        const bytes = new Uint8Array(buffer);
        const len = bytes.byteLength;
        // Build in 8KB chunks to avoid stack overflow with String.fromCharCode
        const chunks: string[] = [];
        const CHUNK = 8192;
        for (let i = 0; i < len; i += CHUNK) {
            chunks.push(String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, len))));
        }
        return btoa(chunks.join(''));
    }, []);

    const emitAudioChunk = useCallback((buffer: ArrayBuffer) => {
        if (!socket) return;

        if (VOICE_AUDIO_TRANSPORT === "binary") {
            try {
                socket.emit("voice:audio", {
                    audio: buffer,
                    mimeType: "audio/pcm;rate=16000",
                });
            } catch (err) {
                const base64Audio = toBase64(buffer);
                console.warn("[Voice] Binary audio emit failed; falling back to base64.", err);
                socket.emit("voice:audio", {
                    data: base64Audio,
                    mimeType: "audio/pcm;rate=16000",
                });
            }
        } else {
            const base64Audio = toBase64(buffer);
            socket.emit("voice:audio", {
                data: base64Audio,
                mimeType: "audio/pcm;rate=16000",
            });
        }
    }, [socket, toBase64]);

    // ── Teardown ───────────────────────────────────────────────
    const cleanupAudio = useCallback(() => {
        if (workletNodeRef.current) {
            workletNodeRef.current.disconnect();
            workletNodeRef.current.port.close();
            workletNodeRef.current = null;
        }
        if (scriptProcessorRef.current) {
            scriptProcessorRef.current.disconnect();
            scriptProcessorRef.current.onaudioprocess = null;
            scriptProcessorRef.current = null;
        }
        if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach(t => t.stop());
            mediaStreamRef.current = null;
        }
        if (audioContextRef.current) {
            audioContextRef.current.close().catch(() => { });
            audioContextRef.current = null;
        }
        setMicAudioTrack(null);
    }, []);

    const stopVoice = useCallback(() => {
        cleanupAudio();
        voiceReadyRef.current = false;
        if (socket && connectionState !== 'idle' && connectionState !== 'fallback') {
            socket.emit("voice:stop", { sessionId });
        }
        if (connectionState !== 'fallback') {
            setConnectionState('idle');
            // Synchronously update the ref so immediate disconnect events don't throw stale errors
            connectionStateRef.current = 'idle';
        }
        reconnectAttemptsRef.current = 0;
    }, [socket, sessionId, connectionState, cleanupAudio]);

    // ── Start Audio (AudioWorklet for low latency) ─────────────
    const startAudioCapture = useCallback(async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    sampleRate: 16000,
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    // Additional constraints for better quality
                    sampleSize: 16,
                } as MediaTrackConstraints
            });
            mediaStreamRef.current = stream;
            setMicAudioTrack(stream.getAudioTracks()[0] ?? null);

            const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({
                sampleRate: 16000,
                latencyHint: 'interactive',  // request lowest latency
            });
            audioContextRef.current = audioCtx;

            // Chrome suspends AudioContext until a user gesture — ensure it's running
            if (audioCtx.state === 'suspended') {
                console.log('[Voice] AudioContext suspended — resuming...');
                await audioCtx.resume();
            }

            const source = audioCtx.createMediaStreamSource(stream);

            // Try AudioWorklet (modern, low-latency) with ScriptProcessor fallback
            let useWorklet = typeof audioCtx.audioWorklet !== 'undefined';

            if (useWorklet) {
                try {
                    await audioCtx.audioWorklet.addModule('/audio-worklet-processor.js');
                    const workletNode = new AudioWorkletNode(audioCtx, 'pcm-capture-processor');
                    workletNodeRef.current = workletNode;

                    if (workletNode) {
                        workletNode.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
                            // Send audio even if voiceReady is false, as long as we are connecting.
                            // The backend will buffer these packets until the STT/LLM connection is ready.
                            const canSendAudio = voiceReadyRef.current ||
                                               connectionStateRef.current === 'connecting' ||
                                               connectionStateRef.current === 'reconnecting';

                            if (isMutedRef.current || !socket || !canSendAudio) return;

                            emitAudioChunk(e.data);
                        };
                    }

                    source.connect(workletNode);
                    // AudioWorklet doesn't need destination connection
                    console.log('[Voice] Using AudioWorklet for high-quality capture');
                } catch (workletErr) {
                    console.warn("[Voice] AudioWorklet failed, falling back to ScriptProcessor", workletErr);
                    useWorklet = false;
                }
            }

            if (!useWorklet) {
                // Fallback: ScriptProcessor with optimized buffer size
                // 2048 samples = ~128ms at 16kHz (good balance of latency vs processing)
                const processor = audioCtx.createScriptProcessor(2048, 1, 1);
                scriptProcessorRef.current = processor;

                processor.onaudioprocess = (e) => {
                    // Send audio even if voiceReady is false, as long as we are connecting.
                    // The backend will buffer these packets until the STT/LLM connection is ready.
                    const canSendAudio = voiceReadyRef.current ||
                                       connectionStateRef.current === 'connecting' ||
                                       connectionStateRef.current === 'reconnecting';

                    if (isMutedRef.current || !socket || !canSendAudio) return;

                    const inputData = e.inputBuffer.getChannelData(0);
                    const buffer = new ArrayBuffer(inputData.length * 2);
                    const view = new DataView(buffer);

                    // Convert Float32 to Int16 PCM with proper clamping
                    for (let i = 0; i < inputData.length; i++) {
                        const s = Math.max(-1, Math.min(1, inputData[i]));
                        view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
                    }

                    emitAudioChunk(buffer);
                };

                source.connect(processor);
                processor.connect(audioCtx.destination);
                console.log('[Voice] Using ScriptProcessor fallback for audio capture');
            }

            console.log('[Voice] Audio capture started successfully');
            return true;
        } catch (err) {
            console.error("Microphone access denied or failed", err);
            return false;
        }
    }, [socket, sessionId, emitAudioChunk]);

    // ── Initiate Connection ────────────────────────────────────
    const attemptConnect = useCallback(async (isReconnect: boolean = false) => {
        if (!socket || !isJoined) return;

        voiceReadyRef.current = false;
        const nextState = isReconnect ? 'reconnecting' : 'connecting';
        setConnectionState(nextState);
        connectionStateRef.current = nextState; // Manually sync for immediate availability in async functions

        // 1. Tell backend to open Gemini Live WebSocket (in parallel with mic init)
        socket.emit("voice:start", { sessionId });

        // 2. Get Microphone
        const hasMic = await startAudioCapture();
        if (!hasMic) {
            socket.emit("voice:stop", { sessionId }); // Cleanup if mic failed
            onError?.("Microphone access denied. Falling back to text mode.");
            setConnectionState('fallback');
            onFallbackModeTriggered();
            return;
        }

        // Timeout if backend doesn't respond with audio/ready
        // (Handled by socket listeners below)

    }, [socket, isJoined, sessionId, startAudioCapture, onError, onFallbackModeTriggered]);

    const startVoice = useCallback(() => {
        reconnectAttemptsRef.current = 0;
        attemptConnect(false);
    }, [attemptConnect]);

    const connectionStateRef = useRef(connectionState);
    useEffect(() => {
        connectionStateRef.current = connectionState;
    }, [connectionState]);

    // ── Socket Listeners for State Machine ─────────────────────
    useEffect(() => {
        if (!socket) return;

        const handleVoiceReady = () => {
            voiceReadyRef.current = true;
            setConnectionState('connected');
            reconnectAttemptsRef.current = 0;
        };

        const handleVoiceAiDone = () => {
            // Not immediately actionable for connection state,
            // but log to ensure we're still alive
        };

        const handleVoiceError = (err: any) => {
            const userMessage = err?.message || "Voice connection error";
            const debugReason = err?.debugReason ? ` (${err.debugReason})` : "";
            console.error("[Voice] Connection error:", `${userMessage}${debugReason}`, err);

            voiceReadyRef.current = false;
            const currentState = connectionStateRef.current;
            if (currentState === 'idle' || currentState === 'fallback') return;

            if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
                reconnectAttemptsRef.current++;
                console.warn(`[Voice] Reconnect attempt ${reconnectAttemptsRef.current}/${MAX_RECONNECT_ATTEMPTS}...`);
                cleanupAudio();
                attemptConnect(true);
            } else {
                console.error("[Voice] Max reconnects reached. Degrading to text mode.");
                cleanupAudio();
                setConnectionState('fallback');
                onFallbackModeTriggered();
                onError?.(userMessage);
            }
        };

        const handleSocketError = (payload: { message?: string }) => {
            const msg = payload?.message || "Unknown socket error";
            const currentState = connectionStateRef.current;
            if (currentState === 'idle' || currentState === 'fallback') return;
            if (/invalid payload/i.test(msg)) return;

            // Only treat likely voice-path errors as recoverable voice failures.
            if (/voice|audio|microphone|reconnection|deepgram|speech/i.test(msg)) {
                handleVoiceError({ message: msg });
            }
        };

        socket.on("voice:ready", handleVoiceReady);
        socket.on("voice:error", handleVoiceError);
        socket.on("ai:done", handleVoiceAiDone);
        socket.on("error", handleSocketError);

        // General socket disconnect implies the ENTIRE Socket.io connection dropped
        // Do not use handleVoiceError because the transport layer itself is gone.
        // Clean up locally and reset to idle. page.tsx will fire startVoice() again
        // when the socket eventually re-connects and successfully joins.
        socket.on("disconnect", () => {
            voiceReadyRef.current = false;
            const currentState = connectionStateRef.current;
            if (currentState !== 'idle' && currentState !== 'fallback') {
                cleanupAudio();
                setConnectionState('idle');
                connectionStateRef.current = 'idle';
            }
        });

        return () => {
            socket.off("voice:ready", handleVoiceReady);
            socket.off("voice:error", handleVoiceError);
            socket.off("ai:done", handleVoiceAiDone);
            socket.off("error", handleSocketError);
            // We can't cleanly remove the generic disconnect listener here without breaking useInterviewSocket,
            // so rely on the state check inside it.
        };
    }, [socket, connectionState, attemptConnect, cleanupAudio, onError, onFallbackModeTriggered]);

    // ── Controls ───────────────────────────────────────────────
    const toggleMute = useCallback(() => {
        if (connectionState === 'fallback') return;
        const newMuted = !isMutedRef.current;
        setIsMuted(newMuted);
        isMutedRef.current = newMuted;
        // Notify server of mute state so it can prompt the user if muted too long
        if (socket) {
            socket.emit("voice:mute", { muted: newMuted });
        }
    }, [connectionState, socket]);

    // Direct mute setter for push-to-talk integration
    const setMutedDirect = useCallback((muted: boolean) => {
        if (connectionState === 'fallback') return;
        if (isMutedRef.current === muted) return; // no-op if already in desired state
        setIsMuted(muted);
        isMutedRef.current = muted;
        if (socket) {
            socket.emit("voice:mute", { muted });
        }
    }, [connectionState, socket]);

    return {
        connectionState,
        isVoiceActive,
        isListening,
        isMuted,
        micAudioTrack,
        startVoice,
        stopVoice,
        toggleMute,
        setMuted: setMutedDirect,
    };
}
