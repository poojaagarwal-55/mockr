"use client";

import {
    createContext,
    useContext,
    useEffect,
    useState,
    useCallback,
    type ReactNode,
} from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { api, ApiError } from "@/lib/api";
import type { Session } from "@supabase/supabase-js";

// ── Types ────────────────────────────────────────────────────

interface UserProfile {
    id: string;
    email: string;
    username?: string | null;
    mobile?: string | null;
    mobileVerified?: boolean;
    mobileVerifiedAt?: string | null;
    country?: string | null;
    fullName: string;
    role?: string;
    placementCollegeEmailDomain?: string | null;
    avatarUrl?: string | null;
    isNewUser: boolean;
    onboardingCompleted?: boolean;
    // Extended profile fields
    gender?: string | null;
    birthday?: string | null; // "YYYY-MM-DD"
    location?: string | null;
    website?: string | null;
    githubUrl?: string | null;
    linkedinUrl?: string | null;
    twitterUrl?: string | null;
    readmeUrl?: string | null;
    skills?: string[];
    workExperience?: WorkEntry[] | null;
    education?: EducationEntry[] | null;
}

interface WorkEntry {
    id: string;
    company: string;
    title: string;
    startDate: string; // "YYYY-MM"
    endDate?: string | null;
    description?: string | null;
}

interface EducationEntry {
    id: string;
    institution: string;
    degree: string;
    field?: string | null;
    startDate: string;
    endDate?: string | null;
}

interface AuthState {
    user: UserProfile | null;
    session: Session | null;
    loading: boolean;
    error: string | null;
}

interface AuthContextType extends AuthState {
    signUp: (email: string, password: string, fullName: string) => Promise<void>;
    signIn: (email: string, password: string) => Promise<UserProfile>;
    signInWithGoogle: (nextPath?: string | null) => Promise<void>;
    signInWithLinkedIn: (nextPath?: string | null) => Promise<void>;
    signOut: () => Promise<void>;
    clearError: () => void;
    refreshUser: () => Promise<void>;
    resetPassword: (email: string) => Promise<void>;
    updatePassword: (newPassword: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

// ── Helpers ──────────────────────────────────────────────────

// Simple in-memory cache to prevent duplicate /auth/sync calls
let syncInProgress: Promise<UserProfile | null> | null = null;
let lastSyncTime = 0;
let lastSyncResult: UserProfile | null = null;
const SYNC_DEBOUNCE_MS = 2000; // 2 seconds

function isCompanySession(session: Session | null): boolean {
    if (!session) return false;
    const userMeta = session.user?.user_metadata as Record<string, any> | undefined;
    const appMeta = session.user?.app_metadata as Record<string, any> | undefined;
    const accountType =
        userMeta?.account_type ||
        userMeta?.accountType ||
        appMeta?.account_type ||
        appMeta?.accountType;
    return accountType === "company";
}

/**
 * Syncs the logged-in Supabase user with our backend DB.
 * Creates or updates the user record and returns the full UserProfile.
 * Deduplicates concurrent calls to prevent multiple emails.
 */
async function syncWithBackend(accessToken: string): Promise<UserProfile | null> {
    const now = Date.now();
    
    // If a sync is already in progress, return that promise
    if (syncInProgress) {
        console.log('[AuthContext] Sync already in progress, reusing existing request');
        return syncInProgress;
    }
    
    // If we synced recently (within 2 seconds), return cached result
    if (now - lastSyncTime < SYNC_DEBOUNCE_MS && lastSyncResult) {
        console.log('[AuthContext] Returning cached sync result (debounced)');
        return lastSyncResult;
    }
    
    // Start a new sync
    syncInProgress = (async () => {
        try {
            const { user } = await api.post<{ user: UserProfile }>(
                "/auth/sync",
                {},
                accessToken
            );
            lastSyncTime = Date.now();
            lastSyncResult = user;
            return user;
        } catch {
            return null;
        } finally {
            syncInProgress = null;
        }
    })();
    
    return syncInProgress;
}

// ── Provider ─────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
    const [state, setState] = useState<AuthState>({
        user: null,
        session: null,
        loading: true,
        error: null,
    });

    const supabase = createSupabaseBrowserClient();

    // ── Bootstrap auth state on mount ────────────────────────
    useEffect(() => {
        let mounted = true;

        // Step 1: Read current session from Supabase's secure cookie store.
        // This is synchronous from the cookie — no network call when no session exists.
        supabase.auth.getSession().then(async ({ data: { session } }) => {
            if (!mounted) return;

            if (session) {
                if (isCompanySession(session)) {
                    if (mounted) setState({ user: null, session: null, loading: false, error: null });
                    return;
                }
                const user = await syncWithBackend(session.access_token);
                if (mounted) setState({ user, session, loading: false, error: null });
            } else {
                if (mounted) setState({ user: null, session: null, loading: false, error: null });
            }
        }).catch(() => {
            if (mounted) setState(prev => ({ ...prev, loading: false }));
        });

        // Step 2: Listen for future auth events (sign in, sign out, token refresh).
        // We skip INITIAL_SESSION because getSession() above handles the initial load.
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            async (event, session) => {
                // INITIAL_SESSION is already handled by getSession() above
                if (event === "INITIAL_SESSION") return;
                if (!mounted) return;

                if (session) {
                    if (isCompanySession(session)) {
                        if (mounted) setState({ user: null, session: null, loading: false, error: null });
                        return;
                    }
                    const user = await syncWithBackend(session.access_token);
                    if (mounted) setState({ user, session, loading: false, error: null });
                } else {
                    // TOKEN_REFRESHED failure or multi-tab token rotation causes a
                    // SIGNED_OUT event with no session. Surface a clear error so the
                    // user knows their session expired rather than seeing a silent redirect.
                    const sessionExpired = event === "SIGNED_OUT";
                    if (mounted) setState({
                        user: null,
                        session: null,
                        loading: false,
                        error: sessionExpired ? "Your session expired. Please sign in again." : null,
                    });
                }
            }
        );

        return () => {
            mounted = false;
            subscription.unsubscribe();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Sign Up ─────────────────────────────────────────────
    // Backend creates user WITHOUT auto-confirming email.
    // User must verify email via OTP before they can sign in.
    const signUp = useCallback(
        async (email: string, password: string, fullName: string) => {
            setState(prev => ({ ...prev, loading: true, error: null }));

            try {
                // Backend creates Supabase auth user + DB record (email NOT confirmed)
                // No session is created - user must verify email first
                await api.post("/auth/signup", { email, password, fullName });

                // Don't sign in automatically - user must verify email first
                setState(prev => ({ ...prev, loading: false, error: null }));

            } catch (err) {
                const message = err instanceof ApiError ? err.message : "Sign up failed";
                setState(prev => ({ ...prev, loading: false, error: message }));
                throw err;
            }
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        []
    );

    // ── Sign In ─────────────────────────────────────────────
    // Uses Supabase client directly — session is stored in a secure httpOnly cookie.
    // Token refresh is handled automatically by the Supabase client.
    const signIn = useCallback(
        async (email: string, password: string): Promise<UserProfile> => {
            setState(prev => ({ ...prev, loading: true, error: null }));

            try {
                const { data, error } = await supabase.auth.signInWithPassword({ email, password });
                if (error) throw new ApiError(401, error.message);

                // Sync user to our DB and get the full UserProfile
                const user = await syncWithBackend(data.session.access_token);
                if (!user) throw new ApiError(500, "Failed to load user profile");

                setState({ user, session: data.session, loading: false, error: null });
                return user;
            } catch (err) {
                const message = err instanceof ApiError ? err.message : "Sign in failed";
                setState(prev => ({ ...prev, loading: false, error: message }));
                throw err;
            }
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        []
    );

    // ── Google OAuth ────────────────────────────────────────
    const signInWithGoogle = useCallback(async (nextPath?: string | null) => {
        const callbackNext = nextPath || "/dashboard";
        const { error } = await supabase.auth.signInWithOAuth({
            provider: "google",
            options: {
                redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(callbackNext)}`,
            },
        });
        if (error) setState(prev => ({ ...prev, error: error.message }));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── LinkedIn OAuth ──────────────────────────────────────
    const signInWithLinkedIn = useCallback(async (nextPath?: string | null) => {
        const callbackNext = nextPath || "/dashboard";
        const { error } = await supabase.auth.signInWithOAuth({
            provider: "linkedin_oidc",
            options: {
                redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(callbackNext)}`,
            },
        });
        if (error) setState(prev => ({ ...prev, error: error.message }));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Sign Out ────────────────────────────────────────────
    const signOut = useCallback(async () => {
        await supabase.auth.signOut();
        setState({ user: null, session: null, loading: false, error: null });
        // Clear tutor caches so fresh login shows the welcome screen
        try {
            Object.keys(localStorage)
                .filter((k) => k.startsWith("tutor_") || k.startsWith("tutor_chat_cache:"))
                .forEach((k) => localStorage.removeItem(k));
            // Also clear the session flag so the next login always starts a new chat
            sessionStorage.removeItem("tutor_tab_session_active");
        } catch {}

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Clear Error ─────────────────────────────────────────
    const clearError = useCallback(() => {
        setState(prev => ({ ...prev, error: null }));
    }, []);

    // ── Reset Password ──────────────────────────────────────
    const resetPassword = useCallback(async (email: string) => {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: `${window.location.origin}/auth/reset-password`,
        });
        if (error) throw new Error(error.message);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Update Password ─────────────────────────────────────
    const updatePassword = useCallback(async (newPassword: string) => {
        const { error } = await supabase.auth.updateUser({ password: newPassword });
        if (error) throw new Error(error.message);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Refresh User ────────────────────────────────────────
    const refreshUser = useCallback(async () => {
        if (!state.session) return;
        try {
            console.log('[AuthContext] refreshUser called - fetching /users/me');
            const user = await api.get<UserProfile>("/users/me", state.session.access_token);
            console.log('[AuthContext] User data fetched:', {
                id: user.id,
                email: user.email,
                mobile: user.mobile,
                mobileVerified: user.mobileVerified,
                mobileVerifiedAt: user.mobileVerifiedAt
            });
            setState(prev => ({ ...prev, user }));
            console.log('[AuthContext] User state updated successfully');
        } catch (err) {
            console.error("[AuthContext] Failed to refresh user", err);
        }
    }, [state.session]);

    return (
        <AuthContext.Provider
            value={{
                ...state,
                signUp,
                signIn,
                signInWithGoogle,
                signInWithLinkedIn,
                signOut,
                clearError,
                refreshUser,
                resetPassword,
                updatePassword,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
}

// ── Hook ─────────────────────────────────────────────────────

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error("useAuth must be used within an AuthProvider");
    }
    return context;
}
