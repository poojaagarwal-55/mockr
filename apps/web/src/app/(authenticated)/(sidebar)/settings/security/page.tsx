"use client";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { useAuth } from "@/context/auth-context";

export default function SecurityPage() {
    useEffect(() => { document.title = "Security | Mockr"; }, []);
    
    const { user, session, resetPassword } = useAuth();

    // Detect OAuth users (Google / LinkedIn) — they manage passwords via their provider
    const authProvider = session?.user?.app_metadata?.provider as string | undefined;
    const isOAuthUser = authProvider === "google" || authProvider === "linkedin_oidc";
    const providerLabel = authProvider === "google" ? "Google" : authProvider === "linkedin_oidc" ? "LinkedIn" : "your provider";

    const [resetLoading, setResetLoading] = useState(false);
    const [resetSuccess, setResetSuccess] = useState(false);
    const [resetError, setResetError] = useState<string | null>(null);

    const [oldPass, setOldPass] = useState("");
    const [newPass, setNewPass] = useState("");
    const [confirmPass, setConfirmPass] = useState("");
    const [updateLoading, setUpdateLoading] = useState(false);
    const [updateSuccess, setUpdateSuccess] = useState(false);
    const [updateError, setUpdateError] = useState<string | null>(null);

    const handleEmailReset = async () => {
        if (!user?.email) return;
        setResetLoading(true);
        setResetError(null);
        try {
            await resetPassword(user.email);
            setResetSuccess(true);
        } catch (err: any) {
            setResetError(err?.message || "Failed to send reset email.");
        } finally {
            setResetLoading(false);
        }
    };

    const handleUpdatePassword = async (e: React.FormEvent) => {
        e.preventDefault();
        setUpdateError(null);
        setUpdateSuccess(false);

        if (!oldPass || !newPass || !confirmPass) {
            setUpdateError("Please fill in all fields.");
            return;
        }
        if (newPass !== confirmPass) {
            setUpdateError("Passwords do not match.");
            return;
        }
        if (newPass.length < 8) {
            setUpdateError("New password must be at least 8 characters.");
            return;
        }

        setUpdateLoading(true);
        try {
            const { createSupabaseBrowserClient } = await import("@/lib/supabase");
            const { data } = await createSupabaseBrowserClient().auth.getSession();
            const token = data.session?.access_token;
            if (!token) throw new Error("Not authenticated");

            const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
            const res = await fetch(`${API_BASE}/auth/change-password`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ currentPassword: oldPass, newPassword: newPass }),
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.message || "Failed to update password.");
            }

            setUpdateSuccess(true);
            setOldPass("");
            setNewPass("");
            setConfirmPass("");
        } catch (err: any) {
            setUpdateError(err.message || "Something went wrong.");
        } finally {
            setUpdateLoading(false);
        }
    };

    return (
        <div className="flex-1 overflow-auto bg-[#FAFBFC] dark:bg-lc-bg flex flex-col">
            <PageHeader titleNode={<h1 className="text-[28px] font-bold text-slate-900 dark:text-white font-nunito tracking-[-0.02em]">Password & Security</h1>} showBack backUrl="/settings" />

            <main className="flex-1 flex flex-col items-center py-10 px-4">
                <div className="w-full max-w-[800px] space-y-8">

                    {isOAuthUser ? (
                        /* ── OAuth notice ─────────────────────────────────── */
                        <div className="bg-white dark:bg-[#161616] rounded-3xl p-8 border border-slate-100 dark:border-lc-border shadow-sm">
                            <div className="flex items-center gap-3 mb-4">
                                <div className="size-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                                    <span className="material-symbols-outlined">lock</span>
                                </div>
                                <div>
                                    <h2 className="text-[20px] font-bold text-slate-800 dark:text-white font-nunito tracking-tight">Password managed by {providerLabel}</h2>
                                    <p className="text-slate-500 text-sm">Your account uses {providerLabel} sign-in</p>
                                </div>
                            </div>
                            <p className="text-slate-600 dark:text-slate-400 text-[15px] leading-relaxed">
                                You signed in with <strong className="text-slate-800 dark:text-slate-200">{providerLabel}</strong>, so there&apos;s no password associated with this account. To change your password, visit your {providerLabel} account settings.
                            </p>
                        </div>
                    ) : (
                        <>
                    {/* Section 1: Update Password */}
                    <div className="bg-white dark:bg-[#161616] rounded-3xl p-8 border border-slate-100 dark:border-lc-border shadow-sm">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="size-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                                <span className="material-symbols-outlined">lock</span>
                            </div>
                            <div>
                                <h2 className="text-[20px] font-bold text-slate-800 dark:text-white font-nunito tracking-tight">Update Password</h2>
                                <p className="text-slate-500 text-sm">Change your password manually</p>
                            </div>
                        </div>

                        <form onSubmit={handleUpdatePassword} className="space-y-6 max-w-md">
                            {updateError && (
                                <div className="p-4 rounded-2xl bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20 text-red-600 dark:text-red-400 text-sm font-medium flex items-center gap-2 animate-in fade-in slide-in-from-top-1">
                                    <span className="material-symbols-outlined text-[18px]">error</span>
                                    {updateError}
                                </div>
                            )}
                            {updateSuccess && (
                                <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-sm font-medium flex items-center gap-2 animate-in fade-in slide-in-from-top-1">
                                    <span className="material-symbols-outlined text-[18px]">check_circle</span>
                                    Password updated successfully!
                                </div>
                            )}

                            <div className="space-y-4">
                                <div>
                                    <label className="block text-[13px] font-bold text-slate-700 dark:text-slate-300 mb-2 uppercase tracking-wider">Current Password</label>
                                    <input
                                        type="password"
                                        value={oldPass}
                                        onChange={e => setOldPass(e.target.value)}
                                        className="w-full px-4 py-2.5 bg-slate-50 dark:bg-lc-hover border border-slate-200 dark:border-lc-border rounded-xl outline-none focus:border-primary focus:ring-1 focus:ring-primary dark:text-white transition-all"
                                        placeholder="••••••••"
                                    />
                                </div>
                                <div>
                                    <label className="block text-[13px] font-bold text-slate-700 dark:text-slate-300 mb-2 uppercase tracking-wider">New Password</label>
                                    <input
                                        type="password"
                                        value={newPass}
                                        onChange={e => setNewPass(e.target.value)}
                                        className="w-full px-4 py-2.5 bg-slate-50 dark:bg-lc-hover border border-slate-200 dark:border-lc-border rounded-xl outline-none focus:border-primary focus:ring-1 focus:ring-primary dark:text-white transition-all"
                                        placeholder="••••••••"
                                    />
                                </div>
                                <div>
                                    <label className="block text-[13px] font-bold text-slate-700 dark:text-slate-300 mb-2 uppercase tracking-wider">Confirm New Password</label>
                                    <input
                                        type="password"
                                        value={confirmPass}
                                        onChange={e => setConfirmPass(e.target.value)}
                                        className="w-full px-4 py-2.5 bg-slate-50 dark:bg-lc-hover border border-slate-200 dark:border-lc-border rounded-xl outline-none focus:border-primary focus:ring-1 focus:ring-primary dark:text-white transition-all"
                                        placeholder="••••••••"
                                    />
                                </div>
                            </div>

                            <button 
                                type="submit"
                                disabled={updateLoading}
                                className="w-full sm:w-auto px-8 py-3 bg-primary text-white rounded-2xl font-bold text-[15px] hover:bg-primary/90 transition-all shadow-lg shadow-primary/20 flex items-center justify-center gap-2 disabled:opacity-50"
                            >
                                {updateLoading && <div className="size-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                                {updateLoading ? "Updating..." : "Update Password"}
                            </button>
                        </form>
                    </div>

                    {/* Section 2: Reset via Email */}
                    <div className="bg-white dark:bg-[#161616] rounded-3xl p-8 border border-slate-100 dark:border-lc-border shadow-sm">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="size-10 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center">
                                <span className="material-symbols-outlined">mail</span>
                            </div>
                            <div>
                                <h2 className="text-[20px] font-bold text-slate-800 dark:text-white font-nunito tracking-tight">Forgot Password?</h2>
                                <p className="text-slate-500 text-sm">Send a reset link to your email</p>
                            </div>
                        </div>

                        <div className="max-w-md">
                            <p className="text-slate-600 dark:text-slate-400 text-[15px] mb-6 leading-relaxed">
                                If you don&apos;t remember your current password, we can send a secure reset link to <strong className="text-slate-800 dark:text-slate-200">{user?.email}</strong>.
                            </p>

                            {resetError && (
                                <div className="mb-6 p-4 rounded-2xl bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20 text-red-600 dark:text-red-400 text-sm font-medium flex items-center gap-2 animate-in fade-in slide-in-from-top-1">
                                    <span className="material-symbols-outlined text-[18px]">error</span>
                                    {resetError}
                                </div>
                            )}

                            {resetSuccess ? (
                                <div className="p-6 rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/20 text-emerald-800 dark:text-emerald-300">
                                    <div className="flex items-center gap-2 mb-2 font-bold">
                                        <span className="material-symbols-outlined text-[20px] text-emerald-500">check_circle</span>
                                        Reset Email Sent
                                    </div>
                                    <p className="text-sm opacity-90">Please check your inbox (and spam folder) for a link to reset your password. The link will expire in 1 hour.</p>
                                </div>
                            ) : (
                                <button
                                    onClick={handleEmailReset}
                                    disabled={resetLoading}
                                    className="w-full sm:w-auto px-8 py-3 bg-slate-100 dark:bg-white/5 text-slate-700 dark:text-slate-200 rounded-2xl font-bold text-[15px] hover:bg-slate-200 dark:hover:bg-white/10 transition-all flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
                                >
                                    {resetLoading && <div className="size-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />}
                                    {resetLoading ? "Sending Link..." : "Send Reset Link"}
                                </button>
                            )}
                        </div>
                    </div>
                        </>
                    )}
                </div>
            </main>
        </div>
    );
}
