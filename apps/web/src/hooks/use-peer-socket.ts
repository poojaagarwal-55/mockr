"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { useAuth } from "@/context/auth-context";
import { mapPeerSocketErrorMessage } from "./peer-socket-error";

type QueuePayload = {
    role: string;
    level: "beginner" | "intermediate" | "advanced";
    interviewType: "coding" | "system_design" | "behavioural";
    preferredLanguage: "python" | "javascript" | "typescript" | "java" | "cpp" | "go";
    timingPreset: "standard_45" | "intense_30" | "deep_60";
};

type InvitePayload = {
    interviewType: "coding" | "system_design" | "behavioural";
    preferredLanguage: "python" | "javascript" | "typescript" | "java" | "cpp" | "go";
    timingPreset: "standard_45" | "intense_30" | "deep_60";
    maxUses: number;
    expiresInSeconds: number;
};

type PeerExecutionSyncPayload = {
    peerSessionId: string;
    phase: "running" | "completed";
    mode: "run" | "submit";
    startedByUserId: string;
    language?: string;
    results?: Record<string, unknown>;
    hiddenSummary?: { passed: number; total: number } | null;
    executionError?: string | null;
    updatedAt: string;
};

export function usePeerSocket() {
    const { session } = useAuth();
    const socketRef = useRef<Socket | null>(null);

    const [connected, setConnected] = useState(false);
    const [lastError, setLastError] = useState<string | null>(null);
    const [queued, setQueued] = useState<{ queueId: string; position: number; fallbackAt: string } | null>(null);
    const [match, setMatch] = useState<{
        peerSessionId: string;
        roomId: string;
        peerUserId: string;
        role: "interviewer" | "candidate";
        timingPreset: "standard_45" | "intense_30" | "deep_60";
    } | null>(null);
    const [invite, setInvite] = useState<{
        token: string;
        expiresAt: string;
        maxUses: number;
        usedCount: number;
    } | null>(null);
    const [scheduled, setScheduled] = useState<{
        peerSessionId: string;
        scheduledFor: string;
    } | null>(null);
    const [scheduledExtension, setScheduledExtension] = useState<{
        peerSessionId: string;
        extensionAttempt: number;
        maxAttempts: number;
        scheduledFor: string;
    } | null>(null);
    const [noMatchWarning, setNoMatchWarning] = useState<{
        peerSessionId: string;
        scheduledFor: string | null;
        minutesUntilSlot: number;
    } | null>(null);
    const [sessionState, setSessionState] = useState<{
        peerSessionId: string;
        status: string;
        participants: Array<{
            userId: string;
            participantRole: "interviewer" | "candidate";
            isReady: boolean;
        }>;
        turn?: {
            turnNumber: 1 | 2;
            activeInterviewerUserId: string;
            activeCandidateUserId: string;
            endsAt: string;
            editableUserId: string;
        } | null;
    } | null>(null);
    const [chatMessages, setChatMessages] = useState<Array<{
        id: string;
        peerSessionId: string;
        userId: string;
        text: string;
        createdAt: string;
    }>>([]);
    const [timerSync, setTimerSync] = useState<{
        roundKey: string;
        elapsedSeconds: number;
        totalSeconds: number;
    } | null>(null);
    const [sessionCountdown, setSessionCountdown] = useState<{
        peerSessionId: string;
        startsInSeconds: number;
        startsAt: string;
    } | null>(null);
    const [turnState, setTurnState] = useState<{
        peerSessionId: string;
        turnNumber: 1 | 2;
        activeInterviewerUserId: string;
        activeCandidateUserId: string;
        startedAt: string;
        endsAt: string;
        canCurrentInterviewerAdvance: boolean;
        canCurrentInterviewerEndSession: boolean;
    } | null>(null);
    const [editorState, setEditorState] = useState<{
        peerSessionId: string;
        code: string;
        language: string;
        revision: number;
        editableUserId: string;
        updatedByUserId: string | null;
        updatedAt: string;
    } | null>(null);
    const [sessionEnded, setSessionEnded] = useState<{
        peerSessionId: string;
        reason: string;
        endedAt: string;
    } | null>(null);
    const [signalOffer, setSignalOffer] = useState<{ peerSessionId: string; sdp: string } | null>(null);
    const [signalAnswer, setSignalAnswer] = useState<{ peerSessionId: string; sdp: string } | null>(null);
    const [signalIce, setSignalIce] = useState<{ peerSessionId: string; candidate: string } | null>(null);
    const [reconnectingWindowSeconds, setReconnectingWindowSeconds] = useState<number | null>(null);
    const [executionSync, setExecutionSync] = useState<PeerExecutionSyncPayload | null>(null);

    const baseUrl = useMemo(() => process.env.NEXT_PUBLIC_P2P_URL || "http://localhost:3004", []);

    useEffect(() => {
        if (!session?.access_token) {
            return;
        }

        const socket = io(baseUrl, {
            path: "/p2p/socket.io",
            transports: ["websocket", "polling"],
            upgrade: true,
            auth: {
                token: session.access_token,
            },
        });

        socketRef.current = socket;

        socket.on("connect", () => {
            setConnected(true);
            setLastError(null);
        });

        socket.on("disconnect", () => {
            setConnected(false);
        });

        socket.on("connect_error", (error) => {
            setLastError(mapPeerSocketErrorMessage(error.message, baseUrl));
        });

        socket.on("peer:queued", (payload: { queueId: string; position: number; fallbackAt: string }) => {
            setQueued(payload);
        });

        socket.on("peer:matched", (payload: {
            peerSessionId: string;
            roomId: string;
            peerUserId: string;
            role: "interviewer" | "candidate";
            timingPreset: "standard_45" | "intense_30" | "deep_60";
        }) => {
            setQueued(null);
            setMatch(payload);
        });

        socket.on("peer:match-cancelled", () => {
            setMatch(null);
        });

        socket.on("peer:invite-created", (payload: { token: string; expiresAt: string; maxUses: number; usedCount: number }) => {
            setInvite(payload);
        });

        socket.on("peer:scheduled", (payload: { peerSessionId: string; scheduledFor: string }) => {
            setQueued(null);
            setScheduled(payload);
        });

        socket.on("peer:scheduled-extension", (payload: {
            peerSessionId: string;
            extensionAttempt: number;
            maxAttempts: number;
            scheduledFor: string;
        }) => {
            setScheduledExtension(payload);
        });

        socket.on("peer:no-match-warning", (payload: {
            peerSessionId: string;
            scheduledFor: string | null;
            minutesUntilSlot: number;
        }) => {
            setNoMatchWarning(payload);
        });

        socket.on("peer:session-state", (payload: {
            peerSessionId: string;
            status: string;
            participants: Array<{
                userId: string;
                participantRole: "interviewer" | "candidate";
                isReady: boolean;
            }>;
            turn?: {
                turnNumber: 1 | 2;
                activeInterviewerUserId: string;
                activeCandidateUserId: string;
                endsAt: string;
                editableUserId: string;
            } | null;
        }) => {
            setSessionState(payload);
        });

        socket.on("peer:chat-history", (payload: {
            peerSessionId: string;
            messages: Array<{ id: string; userId: string; text: string; createdAt: string }>;
        }) => {
            setChatMessages(
                payload.messages.map((message) => ({
                    ...message,
                    peerSessionId: payload.peerSessionId,
                }))
            );
        });

        socket.on("peer:chat-message", (payload: {
            id: string;
            peerSessionId: string;
            userId: string;
            text: string;
            createdAt: string;
        }) => {
            setChatMessages((current) => {
                if (current.some((item) => item.id === payload.id)) {
                    return current;
                }

                return [...current, payload];
            });
        });

        socket.on("peer:timer-sync", (payload: { roundKey: string; elapsedSeconds: number; totalSeconds: number }) => {
            setTimerSync(payload);
        });

        socket.on("peer:session-countdown", (payload: {
            peerSessionId: string;
            startsInSeconds: number;
            startsAt: string;
        }) => {
            setSessionCountdown(payload);
        });

        socket.on("peer:turn-state", (payload: {
            peerSessionId: string;
            turnNumber: 1 | 2;
            activeInterviewerUserId: string;
            activeCandidateUserId: string;
            startedAt: string;
            endsAt: string;
            canCurrentInterviewerAdvance: boolean;
            canCurrentInterviewerEndSession: boolean;
        }) => {
            setTurnState(payload);
        });

        socket.on("peer:editor-state", (payload: {
            peerSessionId: string;
            code: string;
            language: string;
            revision: number;
            editableUserId: string;
            updatedByUserId: string | null;
            updatedAt: string;
        }) => {
            setEditorState(payload);
        });

        socket.on("peer:session-ended", (payload: {
            peerSessionId: string;
            reason: string;
            endedAt: string;
        }) => {
            setSessionEnded(payload);
        });

        socket.on("peer:signal-offer", (payload: { peerSessionId: string; sdp: string }) => {
            setSignalOffer(payload);
        });

        socket.on("peer:signal-answer", (payload: { peerSessionId: string; sdp: string }) => {
            setSignalAnswer(payload);
        });

        socket.on("peer:signal-ice", (payload: { peerSessionId: string; candidate: string }) => {
            setSignalIce(payload);
        });

        socket.on("peer:reconnecting", (payload: { reconnectWindowSeconds: number }) => {
            setReconnectingWindowSeconds(payload.reconnectWindowSeconds);
        });

        socket.on("peer:reconnected", () => {
            setReconnectingWindowSeconds(null);
        });

        socket.on("peer:execution-sync", (payload: PeerExecutionSyncPayload) => {
            setExecutionSync(payload);
        });

        socket.on("peer:error", (payload: { code?: string; message?: string }) => {
            setLastError(payload.message || payload.code || "Peer socket error");
        });

        return () => {
            socket.removeAllListeners();
            socket.disconnect();
            socketRef.current = null;
            setConnected(false);
        };
    }, [baseUrl, session?.access_token]);

    const joinQueue = useCallback((payload: QueuePayload) => {
        socketRef.current?.emit("peer:join-queue", payload);
    }, []);

    const leaveQueue = useCallback(() => {
        socketRef.current?.emit("peer:leave-queue");
        setQueued(null);
    }, []);

    const createInvite = useCallback((payload: InvitePayload) => {
        socketRef.current?.emit("peer:create-invite", payload);
    }, []);

    const acceptInvite = useCallback((payload: {
        token: string;
        role: string;
        level: "beginner" | "intermediate" | "advanced";
    }) => {
        socketRef.current?.emit("peer:accept-invite", payload);
    }, []);

    const markReady = useCallback((peerSessionId: string) => {
        socketRef.current?.emit("peer:session-ready", { peerSessionId });
    }, []);

    const joinSession = useCallback((peerSessionId: string) => {
        socketRef.current?.emit("peer:join-session", { peerSessionId });
    }, []);

    const reconnectSession = useCallback((peerSessionId: string) => {
        socketRef.current?.emit("peer:reconnect", { peerSessionId });
    }, []);

    const sendChatMessage = useCallback((peerSessionId: string, text: string) => {
        socketRef.current?.emit("peer:chat-send", { peerSessionId, text });
    }, []);

    const syncTimer = useCallback((peerSessionId: string, roundKey: string, elapsedSeconds: number) => {
        socketRef.current?.emit("peer:timer-sync", { peerSessionId, roundKey, elapsedSeconds });
    }, []);

    const advanceTurn = useCallback((peerSessionId: string) => {
        socketRef.current?.emit("peer:turn-advance", { peerSessionId });
    }, []);

    const endSession = useCallback((peerSessionId: string) => {
        socketRef.current?.emit("peer:session-end", { peerSessionId });
    }, []);

    const syncEditorState = useCallback((payload: {
        peerSessionId: string;
        code: string;
        language: string;
        revision?: number;
    }) => {
        socketRef.current?.emit("peer:editor-sync", payload);
    }, []);

    const sendSignalOffer = useCallback((peerSessionId: string, sdp: string) => {
        socketRef.current?.emit("peer:signal-offer", { peerSessionId, sdp });
    }, []);

    const sendSignalAnswer = useCallback((peerSessionId: string, sdp: string) => {
        socketRef.current?.emit("peer:signal-answer", { peerSessionId, sdp });
    }, []);

    const sendSignalIce = useCallback((peerSessionId: string, candidate: string) => {
        socketRef.current?.emit("peer:signal-ice", { peerSessionId, candidate });
    }, []);

    const sendExecutionSync = useCallback((payload: {
        peerSessionId: string;
        phase: "running" | "completed";
        mode: "run" | "submit";
        language?: string;
        results?: Record<string, unknown>;
        hiddenSummary?: { passed: number; total: number } | null;
        executionError?: string | null;
    }) => {
        socketRef.current?.emit("peer:execution-sync", payload);
    }, []);

    return {
        connected,
        lastError,
        queued,
        match,
        invite,
        scheduled,
        scheduledExtension,
        noMatchWarning,
        sessionState,
        chatMessages,
        timerSync,
        sessionCountdown,
        turnState,
        editorState,
        sessionEnded,
        signalOffer,
        signalAnswer,
        signalIce,
        reconnectingWindowSeconds,
        executionSync,
        joinQueue,
        leaveQueue,
        createInvite,
        acceptInvite,
        markReady,
        joinSession,
        reconnectSession,
        sendChatMessage,
        syncTimer,
        advanceTurn,
        endSession,
        syncEditorState,
        sendSignalOffer,
        sendSignalAnswer,
        sendSignalIce,
        sendExecutionSync,
        clearMatch: () => setMatch(null),
        clearError: () => setLastError(null),
        clearChat: () => setChatMessages([]),
        clearSignalOffer: () => setSignalOffer(null),
        clearSignalAnswer: () => setSignalAnswer(null),
        clearSignalIce: () => setSignalIce(null),
        clearScheduled: () => setScheduled(null),
        clearScheduledExtension: () => setScheduledExtension(null),
        clearNoMatchWarning: () => setNoMatchWarning(null),
        clearSessionCountdown: () => setSessionCountdown(null),
        clearSessionEnded: () => setSessionEnded(null),
        clearExecutionSync: () => setExecutionSync(null),
    };
}
