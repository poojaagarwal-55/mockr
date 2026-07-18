"use client";

export const dynamic = "force-dynamic";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCompanyAuth } from "@/context/company-auth-context";
import { createSupabaseBrowserClient } from "@/lib/supabase";

function ResetPasswordContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { updatePassword } = useCompanyAuth();
    const supabase = createSupabaseBrowserClient();

    const [status, setStatus] = useState<"verifying" | "ready" | "success" | "invalid">("verifying");
    const [password, setPassword] = useState("");
    const [confirm, setConfirm] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let mounted = true;

        if (searchParams.get("error")) {
            setStatus("invalid");
            return;
        }

        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange(async (event) => {
            if (event === "PASSWORD_RECOVERY" && mounted) setStatus("ready");
        });

        supabase.auth.getSession().then(({ data: { session }, error: sessionError }) => {
            if (sessionError && mounted) {
                setStatus("invalid");
                return;
            }

            if (session && mounted) {
                setTimeout(() => {
                    if (mounted) setStatus("ready");
                }, 600);
            }
        });

        return () => {
            mounted = false;
            subscription.unsubscribe();
        };
    }, [searchParams, supabase.auth]);

    const strength = getPasswordStrength(password);

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
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
        <div className="flex min-h-screen w-full items-center justify-center bg-white p-6 dark:bg-lc-bg">
            <div className="w-full max-w-md">
                <div className="mb-8 flex justify-center">
                    <img src="/logo_big.svg" alt="Practers." className="h-8 w-auto" />
                </div>

                {status === "verifying" && (
                    <StatusPanel
                        icon="progress_activity"
                        title="Verifying your link..."
                        body="Just a moment while we confirm your identity."
                        spinning
                    />
                )}

                {status === "invalid" && (
                    <StatusPanel
                        icon="close"
                        title="Link expired or invalid"
                        body="This reset link has expired or already been used."
                        actionLabel="Request New Link"
                        onAction={() => router.push("/login?tab=forgot")}
                        secondaryLabel="Back to Sign In"
                        onSecondary={() => router.push("/login")}
                    />
                )}

                {status === "success" && (
                    <StatusPanel
                        icon="check"
                        title="Password updated!"
                        body="Your password has been changed successfully. You can now sign in with your new password."
                        actionLabel="Sign In"
                        onAction={() => router.push("/login")}
                    />
                )}

                {status === "ready" && (
                    <div>
                        <div className="mb-8 text-center">
                            <h1 className="mb-2 text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Set new password</h1>
                            <p className="text-sm text-slate-500 dark:text-slate-400">Choose a strong password for your company account.</p>
                        </div>

                        {error && (
                            <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
                                {error}
                            </div>
                        )}

                        <form onSubmit={handleSubmit} className="space-y-5">
                            <div>
                                <label className="mb-2 block text-sm font-semibold text-slate-700 dark:text-slate-300" htmlFor="new-password">
                                    New Password
                                </label>
                                <div className="relative">
                                    <input
                                        id="new-password"
                                        type={showPassword ? "text" : "password"}
                                        value={password}
                                        onChange={(event) => setPassword(event.target.value)}
                                        className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 pr-10 text-slate-900 outline-none transition-colors focus:border-primary focus:ring-primary dark:border-lc-border dark:bg-lc-surface dark:text-white"
                                        placeholder="Enter new password"
                                        autoComplete="new-password"
                                        required
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword((prev) => !prev)}
                                        className="absolute inset-y-0 right-3 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                                    >
                                        <span className="material-symbols-outlined text-lg">{showPassword ? "visibility_off" : "visibility"}</span>
                                    </button>
                                </div>
                            </div>

                            <div>
                                <label className="mb-2 block text-sm font-semibold text-slate-700 dark:text-slate-300" htmlFor="confirm-password">
                                    Confirm Password
                                </label>
                                <input
                                    id="confirm-password"
                                    type={showPassword ? "text" : "password"}
                                    value={confirm}
                                    onChange={(event) => setConfirm(event.target.value)}
                                    className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition-colors focus:border-primary focus:ring-primary dark:border-lc-border dark:bg-lc-surface dark:text-white"
                                    placeholder="Re-enter new password"
                                    autoComplete="new-password"
                                    required
                                />
                            </div>

                            <div className="space-y-2">
                                <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                                    <span>Password strength</span>
                                    <span className="font-semibold text-slate-700 dark:text-slate-200">{strength.label}</span>
                                </div>
                                <div className="h-2 rounded-full bg-slate-100 dark:bg-lc-surface">
                                    <div className={`h-full rounded-full transition-all ${strength.color}`} style={{ width: `${(strength.score / 5) * 100}%` }} />
                                </div>
                            </div>

                            <button
                                type="submit"
                                disabled={submitting}
                                className="w-full rounded-full bg-[#FFE500] py-3 text-sm font-bold text-[#1a1a1a] shadow-lg shadow-[#FFE500]/20 transition hover:bg-[#f5dc00] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {submitting ? "Updating..." : "Update Password"}
                            </button>
                        </form>
                    </div>
                )}
            </div>
        </div>
    );
}

function getPasswordStrength(password: string): { score: number; label: string; color: string } {
    let score = 0;
    if (password.length >= 8) score++;
    if (password.length >= 12) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;

    if (score <= 1) return { score, label: "Weak", color: "bg-red-400" };
    if (score <= 3) return { score, label: "Fair", color: "bg-amber-400" };
    if (score <= 4) return { score, label: "Good", color: "bg-blue-400" };
    return { score, label: "Strong", color: "bg-emerald-500" };
}

function StatusPanel({
    icon,
    title,
    body,
    spinning,
    actionLabel,
    onAction,
    secondaryLabel,
    onSecondary,
}: {
    icon: string;
    title: string;
    body: string;
    spinning?: boolean;
    actionLabel?: string;
    onAction?: () => void;
    secondaryLabel?: string;
    onSecondary?: () => void;
}) {
    return (
        <div className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-50 dark:bg-lc-surface">
                <span className={`material-symbols-outlined text-3xl text-primary ${spinning ? "animate-spin" : ""}`}>{icon}</span>
            </div>
            <h1 className="mb-2 text-xl font-bold text-slate-900 dark:text-white">{title}</h1>
            <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">{body}</p>
            {actionLabel && (
                <button onClick={onAction} className="w-full rounded-full bg-[#FFE500] py-3 text-sm font-bold text-[#1a1a1a] transition hover:bg-[#f5dc00]">
                    {actionLabel}
                </button>
            )}
            {secondaryLabel && (
                <button
                    onClick={onSecondary}
                    className="mt-3 w-full rounded-full border border-slate-200 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-lc-border dark:text-slate-300 dark:hover:bg-lc-hover"
                >
                    {secondaryLabel}
                </button>
            )}
        </div>
    );
}

export default function ResetPasswordPage() {
    return (
        <Suspense fallback={<div className="min-h-screen bg-white dark:bg-lc-bg" />}>
            <ResetPasswordContent />
        </Suspense>
    );
}
