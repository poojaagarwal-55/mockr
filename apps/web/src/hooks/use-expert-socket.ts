"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { useAuth } from "@/context/auth-context";
import { mapPeerSocketErrorMessage } from "./peer-socket-error";

type ExpertExecutionSyncPayload = {
    expertSessionId: string;
    phase: "running" | "completed";
    mode: "run" | "submit";
    startedByUserId: string;
    language?: string;
    results?: Record<string, unknown>;
    hiddenSummary?: { passed: number; total: number } | null;
    executionError?: string | null;
    updatedAt: string;
};

type ExpertLobbyRequest = {
    expertSessionId: string;
    userId: string;
    email?: string;
    requestedAt: string;
};

export function useExpertSocket() {
    const { session } = useAuth();
    const socketRef = useRef<Socket | null>(null);

    const [connected, setConnected] = useState(false);
    const [lastError, setLastError] = useState<string | null>(null);
    const [sessionState, setSessionState] = useState<{
        expertSessionId: string;
        status: string;
        editableUserId: string;
        participants: Array<{
            userId: string;
            participantRole: "expert" | "candidate";
            isReady: boolean;
        }>;
    } | null>(null);
    const [chatMessages, setChatMessages] = useState<Array<{
        id: string;
        expertSessionId: string;
        userId: string;
        text: string;
        createdAt: string;
    }>>([]);
    const [timerSync, setTimerSync] = useState<{
        expertSessionId: string;
        elapsedSeconds: number;
        totalSeconds: number;
    } | null>(null);
    const [editorState, setEditorState] = useState<{
        expertSessionId: string;
        code: string;
        language: string;
        revision: number;
        editableUserId: string;
        updatedByUserId: string | null;
        updatedAt: string;
    } | null>(null);
    const [sessionEnded, setSessionEnded] = useState<{
        expertSessionId: string;
        reason: string;
        endedAt: string;
    } | null>(null);
    const [signalOffer, setSignalOffer] = useState<{ expertSessionId: string; sdp: string } | null>(null);
    const [signalAnswer, setSignalAnswer] = useState<{ expertSessionId: string; sdp: string } | null>(null);
    const [signalIce, setSignalIce] = useState<{ expertSessionId: string; candidate: string } | null>(null);
    const [executionSync, setExecutionSync] = useState<ExpertExecutionSyncPayload | null>(null);
    const [lobbyState, setLobbyState] = useState<{
        expertSessionId: string;
        admitted: boolean;
        waiting: boolean;
        message?: string;
    } | null>(null);
    const [lobbyRequests, setLobbyRequests] = useState<ExpertLobbyRequest[]>([]);

    const baseUrl = useMemo(() => process.env.NEXT_PUBLIC_P2P_URL || "http://localhost:3004", []);

    useEffect(() => {
        if (!session?.access_token) return;

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

        socket.on("expert:session-state", setSessionState);

        socket.on("expert:chat-history", (payload: {
            expertSessionId: string;
            messages: Array<{ id: string; userId: string; text: string; createdAt: string }>;
        }) => {
            setChatMessages(payload.messages.map((message) => ({
                ...message,
                expertSessionId: payload.expertSessionId,
            })));
        });

        socket.on("expert:chat-message", (payload: {
            id: string;
            expertSessionId: string;
            userId: string;
            text: string;
            createdAt: string;
        }) => {
            setChatMessages((current) => {
                if (current.some((item) => item.id === payload.id)) return current;
                return [...current, payload];
            });
        });

        socket.on("expert:timer-sync", setTimerSync);
        socket.on("expert:editor-state", setEditorState);
        socket.on("expert:session-ended", setSessionEnded);
        socket.on("expert:signal-offer", setSignalOffer);
        socket.on("expert:signal-answer", setSignalAnswer);
        socket.on("expert:signal-ice", setSignalIce);
        socket.on("expert:execution-sync", setExecutionSync);
        socket.on("expert:lobby-state", setLobbyState);
        socket.on("expert:lobby-request", (payload: ExpertLobbyRequest) => {
            setLobbyRequests((current) => {
                const withoutDuplicate = current.filter((item) => item.userId !== payload.userId || item.expertSessionId !== payload.expertSessionId);
                return [payload, ...withoutDuplicate];
            });
        });
        socket.on("expert:lobby-requests", (payload: { expertSessionId: string; requests: ExpertLobbyRequest[] }) => {
            setLobbyRequests(payload.requests);
        });

        socket.on("expert:error", (payload: { code?: string; message?: string }) => {
            setLastError(payload.message || payload.code || "Expert room socket error");
        });

        return () => {
            socket.removeAllListeners();
            socket.disconnect();
            socketRef.current = null;
            setConnected(false);
        };
    }, [baseUrl, session?.access_token]);

    const joinSession = useCallback((expertSessionId: string) => {
        socketRef.current?.emit("expert:join-session", { expertSessionId });
    }, []);

    const admitCandidate = useCallback((expertSessionId: string, candidateUserId: string) => {
        socketRef.current?.emit("expert:admit-candidate", { expertSessionId, candidateUserId });
    }, []);

    const sendChatMessage = useCallback((expertSessionId: string, text: string) => {
        socketRef.current?.emit("expert:chat-send", { expertSessionId, text });
    }, []);

    const syncTimer = useCallback((expertSessionId: string, elapsedSeconds: number, totalSeconds?: number) => {
        socketRef.current?.emit("expert:timer-sync", { expertSessionId, elapsedSeconds, totalSeconds });
    }, []);

    const endSession = useCallback((expertSessionId: string) => {
        socketRef.current?.emit("expert:session-end", { expertSessionId });
    }, []);

    const syncEditorState = useCallback((payload: {
        expertSessionId: string;
        code: string;
        language: string;
        revision?: number;
    }) => {
        socketRef.current?.emit("expert:editor-sync", payload);
    }, []);

    const sendSignalOffer = useCallback((expertSessionId: string, sdp: string) => {
        socketRef.current?.emit("expert:signal-offer", { expertSessionId, sdp });
    }, []);

    const sendSignalAnswer = useCallback((expertSessionId: string, sdp: string) => {
        socketRef.current?.emit("expert:signal-answer", { expertSessionId, sdp });
    }, []);

    const sendSignalIce = useCallback((expertSessionId: string, candidate: string) => {
        socketRef.current?.emit("expert:signal-ice", { expertSessionId, candidate });
    }, []);

    const sendExecutionSync = useCallback((payload: {
        expertSessionId: string;
        phase: "running" | "completed";
        mode: "run" | "submit";
        language?: string;
        results?: Record<string, unknown>;
        hiddenSummary?: { passed: number; total: number } | null;
        executionError?: string | null;
    }) => {
        socketRef.current?.emit("expert:execution-sync", payload);
    }, []);

    return {
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
        clearError: () => setLastError(null),
        clearChat: () => setChatMessages([]),
        clearSignalOffer: () => setSignalOffer(null),
        clearSignalAnswer: () => setSignalAnswer(null),
        clearSignalIce: () => setSignalIce(null),
        clearSessionEnded: () => setSessionEnded(null),
        clearExecutionSync: () => setExecutionSync(null),
        clearLobbyRequests: () => setLobbyRequests([]),
    };
}
