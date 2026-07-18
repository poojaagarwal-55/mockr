"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { useAuth } from "@/context/auth-context";
import { ForceLight } from "@/components/force-light";

function ResetPasswordContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { updatePassword } = useAuth();
    const supabase = createSupabaseBrowserClient();

    const [status, setStatus] = useState<"verifying" | "ready" | "success" | "invalid">("verifying");
    const [password, setPassword] = useState("");
    const [confirm, setConfirm] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Supabase sends the token via URL hash for password recovery
    // The onAuthStateChange detects the PASSWORD_RECOVERY event
    useEffect(() => {
        let mounted = true;

        // Check for error params from the URL first
        const urlError = searchParams.get("error");
        const errorCode = searchParams.get("error_code");
        const errorDescription = searchParams.get("error_description");

        if (urlError) {
            console.error("[Reset Password] URL error detected:", { urlError, errorCode, errorDescription });
            if (mounted) setStatus("invalid");
            return;
        }

        // Listen for auth state changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
            console.log("[Reset Password] Auth event:", event, "Session:", !!session);
            
            if (event === "PASSWORD_RECOVERY") {
                if (mounted) {
                    console.log("[Reset Password] Password recovery event detected, ready to reset");
                    setStatus("ready");
                }
            }
        });

        // Also check if we already have a session (in case the event already fired)
        supabase.auth.getSession().then(({ data: { session }, error }) => {
            if (error) {
                console.error("[Reset Password] Session check error:", error);
                if (mounted) setStatus("invalid");
                return;
            }
            
            // If we have a session but status is still verifying, it might be a recovery session
            if (session && mounted && status === "verifying") {
                console.log("[Reset Password] Found existing session, checking if it's a recovery session");
                // Give it a moment for the PASSWORD_RECOVERY event to fire
                setTimeout(() => {
                    if (mounted && status === "verifying") {
                        console.log("[Reset Password] Timeout reached, assuming ready state");
                        setStatus("ready");
                    }
                }, 2000);
            }
        });

        return () => {
            mounted = false;
            subscription.unsubscribe();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const getPasswordStrength = (pwd: string): { score: number; label: string; color: string } => {
        let score = 0;
        if (pwd.length >= 8) score++;
        if (pwd.length >= 12) score++;
        if (/[A-Z]/.test(pwd)) score++;
        if (/[0-9]/.test(pwd)) score++;
        if (/[^A-Za-z0-9]/.test(pwd)) score++;

        if (score <= 1) return { score, label: "Weak", color: "bg-red-400" };
        if (score <= 3) return { score, label: "Fair", color: "bg-amber-400" };
        if (score <= 4) return { score, label: "Good", color: "bg-blue-400" };
        return { score, label: "Strong", color: "bg-emerald-500" };
    };

    const strength = getPasswordStrength(password);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        if (password.length < 8) {
            setError("Password must be at least 8 characters.");
            return;
        }
        if (password !== confirm) {
            setError("Passwords do not match.");
            return;
        }

        setSubmitting(true);
        try {
            await updatePassword(password);
            setStatus("success");
        } catch (err: any) {
            setError(err?.message || "Failed to update password. The link may have expired.");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <ForceLight>
            <div className="flex min-h-screen w-full items-center justify-center bg-white p-6">
                <div className="w-full max-w-md">
                    {/* Logo */}
                    <div className="flex justify-center mb-8">
                        <Image src="/logo_big.png" alt="Mockr" width={140} height={40} className="h-8 w-auto" />
                    </div>

                    {/* Verifying */}
                    {status === "verifying" && (
                        <div className="text-center">
                            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-50">
                                <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-primary" />
                            </div>
                            <h1 className="text-xl font-bold text-slate-900 mb-2">Verifying your link…</h1>
                            <p className="text-sm text-slate-500">Just a moment while we confirm your identity.</p>
                        </div>
                    )}

                    {/* Invalid / Expired */}
                    {status === "invalid" && (
                        <div className="text-center">
                            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-50">
                                <svg className="h-8 w-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </div>
                            <h1 className="text-xl font-bold text-slate-900 mb-2">Link expired or invalid</h1>
                            <p className="text-sm text-slate-500 mb-4">
                                This reset link has expired or already been used.
                            </p>
                            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-6 text-left">
                                <p className="text-xs text-slate-600 mb-2 font-semibold">Common reasons:</p>
                                <ul className="text-xs text-slate-500 space-y-1 list-disc list-inside">
                                    <li>Link has already been used (one-time use only)</li>
                                    <li>Link expired (valid for 1 hour)</li>
                                    <li>You clicked an old link from a previous request</li>
                                </ul>
                            </div>
                            <button
                                onClick={() => router.push("/login?tab=forgot")}
                                className="w-full rounded-full bg-[#FFE500] py-3 text-sm font-bold text-[#1a1a1a] hover:bg-[#f5dc00] transition"
                            >
                                Request New Link
                            </button>
                            <button
                                onClick={() => router.push("/login")}
                                className="w-full mt-3 rounded-full border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
                            >
                                Back to Sign In
                            </button>
                        </div>
                    )}

                    {/* Success */}
                    {status === "success" && (
                        <div className="text-center">
                            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50">
                                <svg className="h-8 w-8 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                            </div>
                            <h1 className="text-xl font-bold text-slate-900 mb-2">Password updated!</h1>
                            <p className="text-sm text-slate-500 mb-6">
                                Your password has been changed successfully. You can now sign in with your new password.
                            </p>
                            <button
                                onClick={() => router.push("/login")}
                                className="w-full rounded-full bg-[#FFE500] py-3 text-sm font-bold text-[#1a1a1a] hover:bg-[#f5dc00] transition shadow-lg shadow-[#FFE500]/20"
                            >
                                Sign In
                            </button>
                        </div>
                    )}

                    {/* Reset Form */}
                    {status === "ready" && (
                        <div>
                            <div className="mb-8 text-center">
                                <h1 className="text-3xl font-extrabold text-slate-900 mb-2 tracking-tight">Set new password</h1>
                                <p className="text-slate-500 text-sm">Choose a strong password for your account.</p>
                            </div>

                            {error && (
                                <div className="mb-5 flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                                    <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                                    </svg>
                                    {error}
                                </div>
                            )}

                            <form onSubmit={handleSubmit} className="space-y-5">
                                {/* New password */}
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 mb-2" htmlFor="new-password">
                                        New Password
                                    </label>
                                    <div className="relative">
                                        <input
                                            id="new-password"
                                            type={showPassword ? "text" : "password"}
                                            placeholder="Min. 8 characters"
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                            className="w-full rounded-lg border border-slate-200 bg-transparent py-3 pl-4 pr-11 text-sm focus:border-primary outline-none transition-colors placeholder:text-slate-400"
                                            required
                                            minLength={8}
                                            autoFocus
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowPassword((v) => !v)}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition"
                                            tabIndex={-1}
                                        >
                                            {showPassword ? (
                                                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                                            ) : (
                                                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                                            )}
                                        </button>
                                    </div>

                                    {/* Strength meter */}
                                    {password && (
                                        <div className="mt-2">
                                            <div className="flex gap-1 mb-1">
                                                {[1, 2, 3, 4, 5].map((i) => (
                                                    <div
                                                        key={i}
                                                        className={`h-1 flex-1 rounded-full transition-all duration-300 ${i <= strength.score ? strength.color : "bg-slate-100"}`}
                                                    />
                                                ))}
                                            </div>
                                            <p className="text-xs text-slate-400">
                                                Strength: <span className={`font-semibold ${strength.score <= 1 ? "text-red-500" : strength.score <= 3 ? "text-amber-500" : "text-emerald-500"}`}>{strength.label}</span>
                                            </p>
                                        </div>
                                    )}
                                </div>

                                {/* Confirm password */}
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 mb-2" htmlFor="confirm-password">
                                        Confirm Password
                                    </label>
                                    <input
                                        id="confirm-password"
                                        type={showPassword ? "text" : "password"}
                                        placeholder="Re-enter your password"
                                        value={confirm}
                                        onChange={(e) => setConfirm(e.target.value)}
                                        className={`w-full rounded-lg border bg-transparent py-3 px-4 text-sm outline-none transition-colors placeholder:text-slate-400 ${confirm && confirm !== password ? "border-red-300 focus:border-red-400" : "border-slate-200 focus:border-primary"}`}
                                        required
                                    />
                                    {confirm && confirm !== password && (
                                        <p className="mt-1 text-xs text-red-500">Passwords do not match.</p>
                                    )}
                                </div>

                                <button
                                    type="submit"
                                    disabled={submitting || !password || !confirm}
                                    className="w-full rounded-full bg-[#FFE500] py-4 text-sm font-bold text-[#1a1a1a] hover:bg-[#f5dc00] transition shadow-lg shadow-[#FFE500]/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-2"
                                >
                                    {submitting && <div className="w-4 h-4 border-2 border-[#1a1a1a]/30 border-t-[#1a1a1a] rounded-full animate-spin" />}
                                    {submitting ? "Updating password…" : "Update Password"}
                                </button>
                            </form>
                        </div>
                    )}
                </div>
            </div>
        </ForceLight>
    );
}

export default function ResetPasswordPage() {
    return (
        <Suspense fallback={<div className="min-h-screen bg-white" />}>
            <ResetPasswordContent />
        </Suspense>
    );
}
