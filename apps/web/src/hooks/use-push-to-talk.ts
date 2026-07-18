"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { Socket } from "socket.io-client";

interface UsePushToTalkOptions {
    /** Whether voice is currently active (connected to STT) */
    isVoiceActive: boolean;
    /** Whether voice is in fallback (text-only) mode */
    isFallback: boolean;
    /** Socket.io socket instance for emitting PTT events to the server */
    socket: Socket | null;
    /** Function to set mute state (for controlling mic in PTT mode) */
    setMuted?: (muted: boolean) => void;
}

/**
 * Push-to-talk hook.
 *
 * When PTT mode is enabled the mic stays on at all times — audio continues
 * flowing to Deepgram STT for transcription.  The difference is that while the
 * user **holds** the spacebar the backend will NOT trigger an AI response.  It
 * simply buffers the user's transcript segments.  When the user **releases**
 * the spacebar the backend combines all buffered segments and processes them as
 * a single user answer, at which point the AI generates a response.
 *
 * This gives the candidate explicit control over when the AI should speak.
 */
export function usePushToTalk(options: UsePushToTalkOptions) {
    const { isVoiceActive, isFallback, socket, setMuted } = options;

    // Initialize PTT preference - always start disabled when entering an interview
    const [pushToTalkEnabled, setPushToTalkEnabled] = useState(false);
    const [isHoldingSpace, setIsHoldingSpace] = useState(false);

    // Track spacebar held to prevent key-repeat from re-firing
    const spaceHeldRef = useRef(false);

    // Toggle PTT mode on/off and notify the server
    const togglePushToTalk = useCallback(() => {
        setPushToTalkEnabled((prev) => {
            const next = !prev;
            console.log(`[PTT][Frontend] ========================================`);
            console.log(`[PTT][Frontend] Toggle PTT mode: ${prev} → ${next}`);
            
            // Notify the server so it knows whether to buffer or process immediately
            console.log(`[PTT][Frontend] Emitting voice:ptt-mode event to server with enabled=${next}`);
            socket?.emit("voice:ptt-mode", { enabled: next });
            
            if (!next) {
                // Turning off — reset spacebar state
                setIsHoldingSpace(false);
                spaceHeldRef.current = false;
                console.log(`[PTT][Frontend] PTT disabled - reset spacebar state`);
                // Unmute the mic so it stays on
                setMuted?.(false);
            } else {
                // Turning on PTT — mute the mic initially (spacebar will unmute it)
                console.log(`[PTT][Frontend] PTT enabled - muting mic (spacebar will control it)`);
                setMuted?.(true);
            }
            console.log(`[PTT][Frontend] ========================================`);
            return next;
        });
    }, [socket, setMuted]);

    // Spacebar keydown/keyup handlers
    useEffect(() => {
        if (!pushToTalkEnabled || !isVoiceActive || isFallback) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            // Only handle spacebar
            if (e.code !== "Space") return;

            // Don't intercept spacebar in text fields or Monaco editor
            const target = e.target as HTMLElement;
            const tag = target.tagName;
            if (
                tag === "INPUT" ||
                tag === "TEXTAREA" ||
                target.isContentEditable ||
                target.getAttribute("role") === "textbox" ||
                target.closest(".monaco-editor") !== null
            ) {
                console.log(`[PTT][Frontend] Spacebar ignored - user is typing in ${tag}`);
                return;
            }

            // Prevent key-repeat from re-firing
            if (spaceHeldRef.current) {
                e.preventDefault();
                console.log(`[PTT][Frontend] Spacebar keydown ignored - already holding`);
                return;
            }

            e.preventDefault();
            spaceHeldRef.current = true;
            setIsHoldingSpace(true);

            console.log(`[PTT][Frontend] ========================================`);
            console.log(`[PTT][Frontend] SPACEBAR PRESSED - Starting to speak`);
            console.log(`[PTT][Frontend] Timestamp: ${new Date().toISOString()}`);
            
            // Unmute mic when spacebar is pressed
            console.log(`[PTT][Frontend] Unmuting microphone...`);
            setMuted?.(false);

            console.log(`[PTT][Frontend] Emitting voice:ptt-hold event to server`);
            // Tell the backend: user is holding spacebar → buffer transcripts, don't trigger AI
            socket?.emit("voice:ptt-hold");
            console.log(`[PTT][Frontend] User can now speak - transcripts will be buffered`);
            console.log(`[PTT][Frontend] ========================================`);
        };

        const handleKeyUp = (e: KeyboardEvent) => {
            if (e.code !== "Space") return;
            if (!spaceHeldRef.current) return;

            e.preventDefault();
            spaceHeldRef.current = false;
            setIsHoldingSpace(false);

            console.log(`[PTT][Frontend] ========================================`);
            console.log(`[PTT][Frontend] SPACEBAR RELEASED - Finished speaking`);
            console.log(`[PTT][Frontend] Timestamp: ${new Date().toISOString()}`);
            
            // Mute mic when spacebar is released (AI's turn to speak)
            console.log(`[PTT][Frontend] Muting microphone...`);
            setMuted?.(true);

            console.log(`[PTT][Frontend] Emitting voice:ptt-release event to server`);
            console.log(`[PTT][Frontend] Server will flush buffer and trigger AI response IMMEDIATELY`);
            // Tell the backend: user released spacebar → flush buffered transcripts to AI
            socket?.emit("voice:ptt-release");
            console.log(`[PTT][Frontend] Waiting for AI response...`);
            console.log(`[PTT][Frontend] ========================================`);
        };

        // Handle window blur (user switches tabs while holding space)
        const handleBlur = () => {
            if (spaceHeldRef.current) {
                console.log(`[PTT][Frontend] ========================================`);
                console.log(`[PTT][Frontend] WARNING: Window blur detected while holding spacebar`);
                console.log(`[PTT][Frontend] Auto-releasing to prevent stuck state`);
                spaceHeldRef.current = false;
                setIsHoldingSpace(false);
                setMuted?.(true);
                socket?.emit("voice:ptt-release");
                console.log(`[PTT][Frontend] ========================================`);
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("keyup", handleKeyUp);
        window.addEventListener("blur", handleBlur);

        return () => {
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("keyup", handleKeyUp);
            window.removeEventListener("blur", handleBlur);
        };
    }, [pushToTalkEnabled, isVoiceActive, isFallback, socket, setMuted]);

    // If voice disconnects while PTT is enabled, reset spacebar state
    useEffect(() => {
        if (!isVoiceActive && isHoldingSpace) {
            spaceHeldRef.current = false;
            setIsHoldingSpace(false);
        }
    }, [isVoiceActive, isHoldingSpace]);

    // (Removed useEffect that was forcing setMuted(true) on PTT enable to avoid race condition with togglePushToTalk)

    // Sync PTT mode with server when voice becomes active
    useEffect(() => {
        if (isVoiceActive && !isFallback && pushToTalkEnabled && socket) {
            console.log(`[PTT][Frontend] Voice is active - syncing PTT mode with server`);
            console.log(`[PTT][Frontend] Emitting voice:ptt-mode event with enabled=true`);
            socket.emit("voice:ptt-mode", { enabled: true });
        }
    }, [isVoiceActive, isFallback, pushToTalkEnabled, socket]);

    return {
        pushToTalkEnabled,
        isHoldingSpace,
        togglePushToTalk,
    };
}
