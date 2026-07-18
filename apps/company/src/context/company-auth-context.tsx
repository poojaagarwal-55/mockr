"use client";

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useState,
    type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { api, ApiError } from "@/lib/api";
import { createSupabaseBrowserClient } from "@/lib/supabase";

export interface CompanyProfile {
    id: string;
    email: string;
    name: string;
    domain: string;
    contactName?: string | null;
    websiteUrl?: string | null;
    logoUrl?: string | null;
    industry?: string | null;
    companySize?: string | null;
    headquarters?: string | null;
    defaultTimezone?: string;
    defaultWorkMode?: "Remote" | "Hybrid" | "On-site";
    defaultEmploymentType?: "Full-time" | "Internship" | "Contract" | "Part-time";
    defaultCurrency?: "INR" | "USD" | "EUR" | "GBP";
    defaultAssessmentDeadlineDays?: number;
    notifyNewApplications?: boolean;
    notifyAssessmentSubmissions?: boolean;
    notifyWeeklyDigest?: boolean;
    notifyTeamChanges?: boolean;
    emailVerified?: boolean;
    role: "owner" | "admin" | "member" | "viewer";
    accessType: "owner" | "team_member";
    membershipId?: string | null;
    teamId?: string | null;
    lastLoginAt?: string | null;
}

interface CompanyAuthState {
    company: CompanyProfile | null;
    session: Session | null;
    loading: boolean;
    error: string | null;
}

interface CompanySignupResult {
    existingAuthAccount?: boolean;
    needsLogin?: boolean;
    message?: string;
}

interface CompanyAuthContextType extends CompanyAuthState {
    signUp: (email: string, password: string, companyName: string, contactName?: string) => Promise<CompanySignupResult>;
    signIn: (email: string, password: string) => Promise<CompanyProfile>;
    signInWithGoogle: () => Promise<void>;
    signOut: () => Promise<void>;
    refreshCompany: () => Promise<CompanyProfile | null>;
    clearError: () => void;
    resetPassword: (email: string) => Promise<void>;
    updatePassword: (newPassword: string) => Promise<void>;
}

const CompanyAuthContext = createContext<CompanyAuthContextType | null>(null);

let syncInProgress: Promise<CompanyProfile | null> | null = null;
let syncInProgressToken: string | null = null;
let lastSyncTime = 0;
let lastSyncResult: CompanyProfile | null = null;
let lastSyncToken: string | null = null;
const SYNC_DEBOUNCE_MS = 2000;
const NO_COMPANY_ACCESS_MESSAGE =
    "This Google account does not have company workspace access. Use a company owner account, or ask an owner/admin to invite this email to a team.";

function companyBasePath() {
    if (typeof window === "undefined") return "";
    return window.location.pathname.startsWith("/companies") ? "/companies" : "";
}

async function syncCompany(accessToken: string, options: { force?: boolean } = {}): Promise<CompanyProfile | null> {
    const now = Date.now();

    if (!options.force && syncInProgress && syncInProgressToken === accessToken) return syncInProgress;
    if (!options.force && lastSyncToken === accessToken && now - lastSyncTime < SYNC_DEBOUNCE_MS && lastSyncResult) return lastSyncResult;

    syncInProgressToken = accessToken;
    syncInProgress = (async () => {
        try {
            const { company } = await api.get<{ company: CompanyProfile }>("/companies/me", accessToken);
            lastSyncTime = Date.now();
            lastSyncResult = company;
            lastSyncToken = accessToken;
            return company;
        } catch {
            return null;
        } finally {
            syncInProgress = null;
            syncInProgressToken = null;
        }
    })();

    return syncInProgress;
}

export function CompanyAuthProvider({ children }: { children: ReactNode }) {
    const [state, setState] = useState<CompanyAuthState>({
        company: null,
        session: null,
        loading: true,
        error: null,
    });

    const supabase = createSupabaseBrowserClient();

    useEffect(() => {
        let mounted = true;

        supabase.auth
            .getSession()
            .then(async ({ data: { session } }) => {
                if (!mounted) return;

                if (session) {
                    const company = await syncCompany(session.access_token);
                    if (mounted) {
                        setState({
                            company,
                            session: company ? session : null,
                            loading: false,
                            error: company ? null : NO_COMPANY_ACCESS_MESSAGE,
                        });
                    }
                    return;
                }

                setState({ company: null, session: null, loading: false, error: null });
            })
            .catch(() => {
                if (mounted) setState((prev) => ({ ...prev, loading: false }));
            });

        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange(async (event, session) => {
            if (event === "INITIAL_SESSION" || !mounted) return;

            if (session) {
                const company = await syncCompany(session.access_token);
                if (mounted) {
                    setState({
                        company,
                        session: company ? session : null,
                        loading: false,
                        error: company ? null : NO_COMPANY_ACCESS_MESSAGE,
                    });
                }
                return;
            }

            setState({ company: null, session: null, loading: false, error: null });
        });

        return () => {
            mounted = false;
            subscription.unsubscribe();
        };
    }, [supabase.auth]);

    const signUp = useCallback(async (email: string, password: string, companyName: string, contactName?: string) => {
        setState((prev) => ({ ...prev, loading: true, error: null }));

        try {
            const result = await api.post<CompanySignupResult>("/companies/signup", {
                email,
                password,
                companyName,
                contactName: contactName?.trim() || undefined,
            });
            setState((prev) => ({ ...prev, loading: false, error: null }));
            return result;
        } catch (err) {
            const message = err instanceof ApiError ? err.message : "Company sign up failed";
            setState((prev) => ({ ...prev, loading: false, error: message }));
            throw err;
        }
    }, []);

    const signIn = useCallback(
        async (email: string, password: string): Promise<CompanyProfile> => {
            setState((prev) => ({ ...prev, loading: true, error: null }));

            try {
                const { data, error } = await supabase.auth.signInWithPassword({ email, password });
                if (error) throw new ApiError(401, error.message);

                const company = await syncCompany(data.session.access_token);
                if (!company) throw new ApiError(403, "No company workspace access found for this account");

                setState({ company, session: data.session, loading: false, error: null });
                return company;
            } catch (err) {
                const message =
                    err instanceof ApiError && err.message.toLowerCase().includes("invalid login credentials")
                        ? "Invalid password for this email. Use your existing Practers password, or use Forgot Password if you signed up with Google or forgot it."
                        : err instanceof ApiError
                            ? err.message
                            : "Company sign in failed";
                setState((prev) => ({ ...prev, loading: false, error: message }));
                throw err;
            }
        },
        [supabase.auth]
    );

    const signInWithGoogle = useCallback(async () => {
        setState((prev) => ({ ...prev, loading: true, error: null }));

        const redirectTo = `${window.location.origin}${companyBasePath()}/auth/callback?next=/dashboard`;
        const { error } = await supabase.auth.signInWithOAuth({
            provider: "google",
            options: {
                redirectTo,
            },
        });

        if (error) {
            setState((prev) => ({ ...prev, loading: false, error: error.message }));
            throw error;
        }
    }, [supabase.auth]);

    const signOut = useCallback(async () => {
        await supabase.auth.signOut();
        lastSyncResult = null;
        lastSyncTime = 0;
        lastSyncToken = null;
        setState({ company: null, session: null, loading: false, error: null });
    }, [supabase.auth]);

    const refreshCompany = useCallback(async () => {
        const accessToken = state.session?.access_token;
        if (!accessToken) return null;

        const company = await syncCompany(accessToken, { force: true });
        setState((prev) => ({
            ...prev,
            company,
            session: company ? prev.session : null,
            loading: false,
            error: company ? null : NO_COMPANY_ACCESS_MESSAGE,
        }));
        return company;
    }, [state.session?.access_token]);

    const clearError = useCallback(() => {
        setState((prev) => ({ ...prev, error: null }));
    }, []);

    const resetPassword = useCallback(
        async (email: string) => {
            const { error } = await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: `${window.location.origin}/companies/reset-password`,
            });
            if (error) throw new Error(error.message);
        },
        [supabase.auth]
    );

    const updatePassword = useCallback(
        async (newPassword: string) => {
            const { error } = await supabase.auth.updateUser({ password: newPassword });
            if (error) throw new Error(error.message);
        },
        [supabase.auth]
    );

    return (
        <CompanyAuthContext.Provider
            value={{
                ...state,
                signUp,
                signIn,
                signInWithGoogle,
                signOut,
                refreshCompany,
                clearError,
                resetPassword,
                updatePassword,
            }}
        >
            {children}
        </CompanyAuthContext.Provider>
    );
}

export function useCompanyAuth() {
    const context = useContext(CompanyAuthContext);
    if (!context) {
        throw new Error("useCompanyAuth must be used within a CompanyAuthProvider");
    }
    return context;
}
