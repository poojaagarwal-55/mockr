"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/context/auth-context";
import { api } from "@/lib/api";
import type { PlanEntitlements, PlanKey } from "@interviewforge/shared";
import { io, Socket } from "socket.io-client";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:3001";
const WS_RECONNECT_DELAY = 3000; // 3 seconds
const WS_MAX_RECONNECT_ATTEMPTS = 3; // Reduced from 5 to 3
const FALLBACK_POLL_INTERVAL = 5000; // 5 seconds (reduced from 10)
const FALLBACK_POLL_MAX_DURATION = 60000; // 60 seconds (increased from 30)
const STRICT_MODE_DISCONNECT_GRACE_MS = 1200;
const DEBUG_BILLING = process.env.NEXT_PUBLIC_DEBUG_BILLING === "true";

function billingDebugLog(...args: unknown[]): void {
    if (DEBUG_BILLING) {
        console.log(...args);
    }
}

export type BillingSnapshot = {
    plan: PlanKey;
    entitlements: PlanEntitlements;
    wallet: {
        free: number;
        monthly: number;
        purchased: number;
        total: number;
        monthlyResetAt: string | null;
    };
    usage: {
        resumeAnalysisUsed: number;
        resumeImproveAiUsed: number;
        latexAiTokensUsed: number;
        tutorTokensUsed: number;
        resetAt?: string;
    };
    isAdmin?: boolean;
    isExpert?: boolean;
    subscriptionId?: string | null;
    cycle?: string | null;
    status?: string | null;
    cancelledAt?: string | null;
    scheduledPlanChange?: string | null;
    scheduledChangeDate?: string | null;
    currentPeriodEnd?: string | null;
};

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

type State = {
    snapshot: BillingSnapshot | null;
    loading: boolean;
    error: string | null;
    connectionState: ConnectionState;
};

type BillingListener = (state: State) => void;

const INITIAL_STATE: State = {
    snapshot: null,
    loading: true,
    error: null,
    connectionState: 'disconnected',
};

const billingStore: {
    state: State;
    listeners: Set<BillingListener>;
    subscriberCount: number;
    sessionToken: string | null;
    socket: Socket | null;
    isConnecting: boolean;
    reconnectAttempts: number;
    reconnectTimeout: ReturnType<typeof setTimeout> | null;
    fallbackPollInterval: ReturnType<typeof setInterval> | null;
    fallbackPollStartTime: number | null;
    disconnectGraceTimeout: ReturnType<typeof setTimeout> | null;
    refreshInFlight: Promise<void> | null;
} = {
    state: INITIAL_STATE,
    listeners: new Set(),
    subscriberCount: 0,
    sessionToken: null,
    socket: null,
    isConnecting: false,
    reconnectAttempts: 0,
    reconnectTimeout: null,
    fallbackPollInterval: null,
    fallbackPollStartTime: null,
    disconnectGraceTimeout: null,
    refreshInFlight: null,
};

function publishState(next: State): void {
    billingStore.state = next;
    for (const listener of billingStore.listeners) {
        listener(next);
    }
}

function setStoreState(updater: (prev: State) => State): void {
    publishState(updater(billingStore.state));
}

function clearSocket(disconnect: boolean): void {
    const existing = billingStore.socket;
    if (!existing) {
        billingStore.isConnecting = false;
        return;
    }

    if (disconnect) {
        existing.disconnect();
    }
    existing.removeAllListeners();
    billingStore.socket = null;
    billingStore.isConnecting = false;
}

function stopFallbackPolling(): void {
    if (billingStore.fallbackPollInterval) {
        clearInterval(billingStore.fallbackPollInterval);
        billingStore.fallbackPollInterval = null;
    }
    billingStore.fallbackPollStartTime = null;
}

async function refreshBillingSnapshot(options?: { silent?: boolean }): Promise<void> {
    const silent = options?.silent ?? false;
    const token = billingStore.sessionToken;

    if (!token) {
        const nextState: State = {
            ...billingStore.state,
            snapshot: null,
            loading: false,
            error: null,
            connectionState: 'disconnected',
        };
        publishState(nextState);
        return;
    }

    if (billingStore.refreshInFlight) {
        return billingStore.refreshInFlight;
    }

    if (!silent) {
        setStoreState((prev) => ({ ...prev, loading: true }));
    }

    const request = (async () => {
        try {
            billingDebugLog('[useBilling] Fetching billing snapshot...');
            const snap = await api.get<BillingSnapshot>("/billing/snapshot", token);

            // Ignore stale responses when token has changed during an inflight request.
            if (billingStore.sessionToken !== token) {
                return;
            }

            billingDebugLog('[useBilling] Received billing snapshot:', {
                plan: snap.plan,
                wallet: snap.wallet,
                total: snap.wallet.total,
            });
            setStoreState((prev) => ({
                ...prev,
                snapshot: snap,
                loading: false,
                error: null,
            }));
        } catch (err) {
            if (billingStore.sessionToken !== token) {
                return;
            }

            console.warn('[useBilling] Failed to fetch billing snapshot:', err);
            setStoreState((prev) => ({
                ...prev,
                loading: false,
                error: err instanceof Error ? err.message : 'Failed to load billing info',
            }));
        } finally {
            billingStore.refreshInFlight = null;
        }
    })();

    billingStore.refreshInFlight = request;
    return request;
}

function scheduleReconnect(): void {
    if (billingStore.reconnectTimeout) {
        return;
    }
    if (billingStore.reconnectAttempts >= WS_MAX_RECONNECT_ATTEMPTS) {
        return;
    }

    billingStore.reconnectAttempts += 1;
    const delay = WS_RECONNECT_DELAY * billingStore.reconnectAttempts;
    billingDebugLog(
        `[useBilling] Reconnecting in ${delay}ms... (attempt ${billingStore.reconnectAttempts}/${WS_MAX_RECONNECT_ATTEMPTS})`
    );

    billingStore.reconnectTimeout = setTimeout(() => {
        billingStore.reconnectTimeout = null;
        if (!billingStore.socket || !billingStore.socket.connected) {
            connectWebSocket(true);
        }
    }, delay);
}

function startFallbackPolling(): void {
    if (billingStore.fallbackPollInterval) {
        clearInterval(billingStore.fallbackPollInterval);
    }

    billingStore.fallbackPollStartTime = Date.now();
    billingStore.fallbackPollInterval = setInterval(() => {
        const elapsed = Date.now() - (billingStore.fallbackPollStartTime || 0);

        if (elapsed >= FALLBACK_POLL_MAX_DURATION) {
            stopFallbackPolling();
            return;
        }

        if (billingStore.socket?.connected !== true) {
            void refreshBillingSnapshot({ silent: true });
        }
    }, FALLBACK_POLL_INTERVAL);
}

function connectWebSocket(forceReconnect = false): void {
    if (!billingStore.sessionToken) {
        return;
    }

    if (billingStore.reconnectTimeout) {
        clearTimeout(billingStore.reconnectTimeout);
        billingStore.reconnectTimeout = null;
    }

    if (billingStore.socket) {
        if (!forceReconnect && (billingStore.socket.connected || billingStore.isConnecting)) {
            return;
        }
        clearSocket(true);
    }

    if (billingStore.isConnecting) {
        return;
    }

    setStoreState((prev) => ({ ...prev, connectionState: 'connecting' }));
    billingStore.isConnecting = true;
    billingDebugLog('[useBilling] Creating new WebSocket connection...');

    try {
        const token = billingStore.sessionToken;
        const socket = io(API_BASE, {
            path: '/ws/plans',
            auth: { token },
            transports: ['websocket', 'polling'],
            reconnection: false,
        });

        billingStore.socket = socket;

        socket.on('plan:connected', () => {
            billingStore.isConnecting = false;
            billingStore.reconnectAttempts = 0;
            stopFallbackPolling();
            setStoreState((prev) => ({ ...prev, connectionState: 'connected' }));
            billingDebugLog('[useBilling] WebSocket connected');
        });

        socket.on('plan:updated', (event: any) => {
            billingDebugLog('[useBilling] Received plan update event:', {
                plan: event?.planData?.plan,
                timestamp: event?.timestamp,
            });
            void refreshBillingSnapshot({ silent: true });
        });

        socket.on('error', (error: any) => {
            console.warn('[useBilling] WebSocket error; falling back to snapshot refresh when needed.', error);
            setStoreState((prev) => ({ ...prev, connectionState: 'error' }));
        });

        socket.on('connect_error', (error: Error) => {
            console.warn('[useBilling] WebSocket connection error; falling back to polling.', error);
            if (billingStore.socket === socket) {
                billingStore.socket = null;
            }
            billingStore.isConnecting = false;
            setStoreState((prev) => ({ ...prev, connectionState: 'error' }));

            if (billingStore.reconnectAttempts < WS_MAX_RECONNECT_ATTEMPTS) {
                scheduleReconnect();
            } else {
                startFallbackPolling();
            }
        });

        socket.on('disconnect', (reason: string) => {
            if (billingStore.socket === socket) {
                billingStore.socket = null;
            }
            billingStore.isConnecting = false;
            setStoreState((prev) => ({ ...prev, connectionState: 'disconnected' }));
            billingDebugLog('[useBilling] WebSocket disconnected:', reason);

            if (reason !== 'io client disconnect' && reason !== 'io server disconnect') {
                if (billingStore.reconnectAttempts < WS_MAX_RECONNECT_ATTEMPTS) {
                    scheduleReconnect();
                } else {
                    startFallbackPolling();
                }
            }
        });
    } catch (error) {
        billingStore.isConnecting = false;
        setStoreState((prev) => ({ ...prev, connectionState: 'error' }));
        console.error('[useBilling] Failed to create WebSocket connection:', error);
        startFallbackPolling();
    }
}

function ensureRealtimeSync(): void {
    if (!billingStore.sessionToken) {
        return;
    }

    void refreshBillingSnapshot({ silent: billingStore.state.snapshot !== null });
    connectWebSocket();
}

function scheduleGracefulDisconnect(): void {
    if (billingStore.disconnectGraceTimeout) {
        clearTimeout(billingStore.disconnectGraceTimeout);
    }

    billingStore.disconnectGraceTimeout = setTimeout(() => {
        billingStore.disconnectGraceTimeout = null;
        if (billingStore.subscriberCount > 0) {
            return;
        }

        if (billingStore.reconnectTimeout) {
            clearTimeout(billingStore.reconnectTimeout);
            billingStore.reconnectTimeout = null;
        }
        stopFallbackPolling();
        clearSocket(true);
        setStoreState((prev) => ({ ...prev, connectionState: 'disconnected' }));
    }, STRICT_MODE_DISCONNECT_GRACE_MS);
}

function subscribeBillingState(listener: BillingListener): () => void {
    billingStore.listeners.add(listener);
    billingStore.subscriberCount += 1;

    if (billingStore.disconnectGraceTimeout) {
        clearTimeout(billingStore.disconnectGraceTimeout);
        billingStore.disconnectGraceTimeout = null;
    }

    listener(billingStore.state);

    if (billingStore.sessionToken) {
        ensureRealtimeSync();
    }

    return () => {
        billingStore.listeners.delete(listener);
        billingStore.subscriberCount = Math.max(0, billingStore.subscriberCount - 1);
        if (billingStore.subscriberCount === 0) {
            scheduleGracefulDisconnect();
        }
    };
}

function updateSessionToken(token: string | null): void {
    if (billingStore.sessionToken === token) {
        return;
    }

    const previousToken = billingStore.sessionToken;
    billingStore.sessionToken = token;

    if (billingStore.disconnectGraceTimeout) {
        clearTimeout(billingStore.disconnectGraceTimeout);
        billingStore.disconnectGraceTimeout = null;
    }

    if (!token) {
        if (billingStore.reconnectTimeout) {
            clearTimeout(billingStore.reconnectTimeout);
            billingStore.reconnectTimeout = null;
        }
        billingStore.refreshInFlight = null;
        billingStore.reconnectAttempts = 0;
        stopFallbackPolling();
        clearSocket(true);
        publishState({
            snapshot: null,
            loading: false,
            error: null,
            connectionState: 'disconnected',
        });
        return;
    }

    if (previousToken && previousToken !== token) {
        if (billingStore.reconnectTimeout) {
            clearTimeout(billingStore.reconnectTimeout);
            billingStore.reconnectTimeout = null;
        }
        billingStore.reconnectAttempts = 0;
        stopFallbackPolling();
        clearSocket(true);
    }

    if (billingStore.subscriberCount > 0) {
        ensureRealtimeSync();
    }
}

export function useBilling() {
    const { session } = useAuth();
    const [state, setState] = useState<State>(billingStore.state);

    useEffect(() => subscribeBillingState(setState), []);

    useEffect(() => {
        updateSessionToken(session?.access_token ?? null);
    }, [session?.access_token]);

    const refresh = useCallback(async () => {
        await refreshBillingSnapshot();
    }, []);

    return { ...state, refresh };
}
