"use client";

import { PageHeader } from "@/components/page-header";
import Link from "next/link";
import { useState, useEffect } from "react";
import { useTheme } from "next-themes";
import { Footer } from "@/components/footer";
import { useAuth } from "@/context/auth-context";
import { PhoneVerificationBanner } from "@/components/auth/PhoneVerificationBanner";

type SettingsItem = {
    label: string;
    href?: string;
    action?: string;
    danger?: boolean;
    valueLabel?: string;
};

type SettingsGroup = {
    title: string;
    items: SettingsItem[];
};

const SETTINGS_GROUPS: SettingsGroup[] = [
    {
        title: "Account preferences",
        items: [
            {
                label: "Profile information",
                href: "/settings/profile",
            },
            {
                label: "Theme preferences",
                action: "theme",
            },
            {
                label: "Manage membership",
                href: "/settings/membership",
            },
            {
                label: "Subscription & billing",
                href: "/settings/billing",
            }
        ]
    },
    {
        title: "Security & access",
        items: [
            {
                label: "Password & security",
                action: "password",
            }
        ]
    },
    {
        title: "Delete account",
        items: [
            {
                label: "Delete your account",
                action: "delete",
                danger: true
            }
        ]
    }
];

const ThemeModal = ({ onClose }: { onClose: () => void }) => {
    const { theme, setTheme } = useTheme();
    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 animate-in fade-in duration-200" onClick={onClose}>
            <div className="bg-white dark:bg-[#161616] rounded-3xl max-w-md w-full p-8 shadow-[0_18px_50px_-12px_rgba(0,0,0,0.25)] border border-slate-200/80 dark:border-white/10" onClick={(e) => e.stopPropagation()}>
                <h3 className="text-[26px] font-bold text-slate-900 dark:text-white mb-2 font-nunito">Theme Preferences</h3>
                <p className="text-[15px] text-slate-600 dark:text-slate-400 mb-6">Choose your preferred theme</p>
                <div className="space-y-3">
                    {['light', 'dark', 'system'].map((t) => (
                        <button key={t} onClick={() => setTheme(t)} className={`w-full text-left px-4 py-3 rounded-xl border cursor-pointer ${theme === t ? 'border-primary bg-primary/5 text-primary font-bold' : 'border-slate-200 dark:border-lc-border text-slate-700 dark:text-[#ccc] hover:bg-slate-50 dark:hover:bg-lc-hover'} transition-colors capitalize`}>
                            {t}
                        </button>
                    ))}
                </div>
                <div className="mt-8 flex justify-end gap-3">
                    <button onClick={onClose} className="px-4 py-2.5 rounded-2xl font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors cursor-pointer dark:text-slate-300 dark:bg-white/5 dark:hover:bg-white/10">Cancel</button>
                    <button onClick={onClose} className="px-5 py-2.5 font-bold text-white bg-primary hover:bg-primary/90 rounded-2xl transition-colors cursor-pointer">Done</button>
                </div>
            </div>
        </div>
    );
};

const PasswordModal = ({ onClose }: { onClose: () => void }) => {
    const { user, resetPassword } = useAuth();
    const [oldPass, setOldPass] = useState('');
    const [newPass, setNewPass] = useState('');
    const [confirmPass, setConfirmPass] = useState('');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);
    const [loading, setLoading] = useState(false);

    const [showOld, setShowOld] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);

    const [resetLoading, setResetLoading] = useState(false);
    const [resetSuccess, setResetSuccess] = useState(false);

    const handleForgotClick = async () => {
        if (!user?.email) return;
        setResetLoading(true);
        setError('');
        try {
            await resetPassword(user.email);
            setResetSuccess(true);
        } catch (err: any) {
            setError(err.message || "Failed to send reset email.");
        } finally {
            setResetLoading(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        if (!oldPass || !newPass || !confirmPass) {
            setError("Please fill in all fields.");
            return;
        }
        if (newPass !== confirmPass) {
            setError("New passwords do not match.");
            return;
        }
        if (newPass.length < 8) {
            setError("New password must be at least 8 characters.");
            return;
        }

        setLoading(true);
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
                body: JSON.stringify({
                    currentPassword: oldPass,
                    newPassword: newPass,
                }),
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.message || "Failed to change password.");
            }

            setSuccess(true);
            setTimeout(() => onClose(), 1500);
        } catch (err: any) {
            setError(err.message || "Something went wrong.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 animate-in fade-in duration-200" onClick={() => !loading && onClose()}>
            <div className="bg-white dark:bg-[#161616] rounded-3xl max-w-md w-full p-8 shadow-[0_18px_50px_-12px_rgba(0,0,0,0.25)] border border-slate-200/80 dark:border-white/10" onClick={(e) => e.stopPropagation()}>
                <h3 className="text-[26px] font-bold text-slate-900 dark:text-white mb-2 font-nunito">Change Password</h3>
                <p className="text-[15px] text-slate-600 dark:text-slate-400 mb-6">Update your account password</p>
                <form onSubmit={handleSubmit} className="space-y-4">
                    {error && <div className="text-red-500 text-sm font-bold bg-red-50 dark:bg-red-500/10 p-3 rounded-xl border border-red-100 dark:border-red-900/30">{error}</div>}
                    {success && <div className="text-emerald-600 text-sm font-bold bg-emerald-50 dark:bg-emerald-500/10 p-3 rounded-xl border border-emerald-100 dark:border-emerald-900/30 flex items-center gap-2"><span className="material-symbols-outlined text-[16px]">check_circle</span>Password updated successfully!</div>}
                    <div>
                        <div className="flex items-center justify-between mb-1.5">
                            <label className="block text-[13px] font-bold font-nunito uppercase tracking-wider text-slate-700 dark:text-slate-300">Current Password</label>
                            {!resetSuccess && (
                                <button 
                                    type="button" 
                                    onClick={handleForgotClick}
                                    disabled={resetLoading}
                                    className="text-[12px] font-bold text-primary hover:underline disabled:opacity-50"
                                >
                                    {resetLoading ? "Sending..." : "Forgot password?"}
                                </button>
                            )}
                        </div>
                        <div className="relative">
                            <input type={showOld ? "text" : "password"} value={oldPass} onChange={e => setOldPass(e.target.value)} className="w-full pl-4 pr-10 py-2.5 bg-slate-50 dark:bg-lc-hover border border-slate-200 dark:border-lc-border rounded-xl outline-none focus:border-primary focus:ring-1 focus:ring-primary dark:text-white" />
                            <button type="button" onClick={() => setShowOld(!showOld)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-white transition-colors flex items-center justify-center mt-[1px]">
                                <span className="material-symbols-outlined text-[18px]">{showOld ? 'visibility_off' : 'visibility'}</span>
                            </button>
                        </div>
                        {resetSuccess && (
                            <p className="mt-2 text-[12px] text-emerald-600 dark:text-emerald-400 font-medium">
                                Reset link sent to your email!
                            </p>
                        )}
                    </div>
                    <div>
                        <label className="block text-[13px] font-bold font-nunito uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">New Password</label>
                        <input type="password" value={newPass} onChange={e => setNewPass(e.target.value)} className="w-full px-4 py-2.5 bg-slate-50 dark:bg-lc-hover border border-slate-200 dark:border-lc-border rounded-xl outline-none focus:border-primary focus:ring-1 focus:ring-primary dark:text-white" />
                    </div>
                    <div>
                        <label className="block text-[13px] font-bold font-nunito uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">Confirm New Password</label>
                        <div className="relative">
                            <input type={showConfirm ? "text" : "password"} value={confirmPass} onChange={e => setConfirmPass(e.target.value)} className="w-full pl-4 pr-10 py-2.5 bg-slate-50 dark:bg-lc-hover border border-slate-200 dark:border-lc-border rounded-xl outline-none focus:border-primary focus:ring-1 focus:ring-primary dark:text-white" />
                            <button type="button" onClick={() => setShowConfirm(!showConfirm)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-white transition-colors flex items-center justify-center mt-[1px]">
                                <span className="material-symbols-outlined text-[18px]">{showConfirm ? 'visibility_off' : 'visibility'}</span>
                            </button>
                        </div>
                    </div>
                    <div className="mt-8 flex justify-end gap-3">
                        <button type="button" onClick={onClose} disabled={loading} className="px-4 py-2.5 rounded-2xl font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors cursor-pointer disabled:opacity-50 dark:text-slate-300 dark:bg-white/5 dark:hover:bg-white/10">Cancel</button>
                        <button type="submit" disabled={loading || success} className="px-5 py-2.5 font-bold text-white bg-primary hover:bg-primary/90 rounded-2xl transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-2">
                            {loading && <div className="size-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                            {loading ? "Updating..." : "Update Password"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

const DeleteModal = ({ onClose }: { onClose: () => void }) => {
    const [confirmText, setConfirmText] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleDelete = async () => {
        if (confirmText !== "DELETE") {
            setError("Please type 'DELETE' to confirm.");
            return;
        }

        setLoading(true);
        setError('');
        try {
            const { createSupabaseBrowserClient } = await import("@/lib/supabase");
            const supabase = createSupabaseBrowserClient();
            const { data } = await supabase.auth.getSession();
            const token = data.session?.access_token;
            if (!token) throw new Error("Not authenticated");

            const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
            const res = await fetch(`${API_BASE}/auth/account`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${token}` },
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.message || "Failed to delete account.");
            }

            // Sign out locally and redirect to login
            await supabase.auth.signOut();
            window.location.href = "/login";
        } catch (err: any) {
            setError(err.message || "Something went wrong.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/60" onClick={onClose}>
            <div className="relative w-full max-w-md rounded-3xl border border-slate-200/80 bg-white p-8 shadow-[0_18px_50px_-12px_rgba(0,0,0,0.25)] dark:border-white/10 dark:bg-[#161616]" onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <h3 className="text-[26px] font-bold text-red-600 dark:text-red-400 font-nunito">Delete Account</h3>
                <p className="mt-2 text-[15px] text-slate-600 dark:text-slate-400">This action is permanent and cannot be undone.</p>

                {/* Body */}
                <div className="mt-6 space-y-6">
                    <div>
                        <p className="text-[16px] font-semibold text-slate-900 dark:text-white mb-3">This will permanently delete:</p>
                        <ul className="space-y-2.5 text-[15px] text-slate-800 dark:text-slate-200">
                            <li className="flex items-start gap-3">
                                <span className="text-slate-400 dark:text-slate-500 mt-0.5">•</span>
                                <span>Your profile and account data</span>
                            </li>
                            <li className="flex items-start gap-3">
                                <span className="text-slate-400 dark:text-slate-500 mt-0.5">•</span>
                                <span>All interview sessions and reports</span>
                            </li>
                            <li className="flex items-start gap-3">
                                <span className="text-slate-400 dark:text-slate-500 mt-0.5">•</span>
                                <span>Uploaded resumes and recordings</span>
                            </li>
                            <li className="flex items-start gap-3">
                                <span className="text-slate-400 dark:text-slate-500 mt-0.5">•</span>
                                <span>Practice sheets and progress</span>
                            </li>
                        </ul>
                    </div>

                    <div>
                        <label className="block text-[15px] font-semibold text-slate-900 dark:text-white mb-3">
                            Type <span className="font-mono bg-slate-100 dark:bg-[#0f0f0f] px-2 py-0.5 rounded text-red-600 dark:text-red-400">DELETE</span> to confirm
                        </label>
                        <input
                            type="text"
                            value={confirmText}
                            onChange={(e) => setConfirmText(e.target.value)}
                            placeholder="Type DELETE"
                            disabled={loading}
                            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-[15px] text-slate-900 outline-none transition-all focus:border-red-400 focus:ring-2 focus:ring-red-400/30 disabled:opacity-50 dark:border-white/15 dark:bg-[#0f0f0f] dark:text-white"
                        />
                    </div>

                    {error && (
                        <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/30 rounded-xl text-sm text-red-600 dark:text-red-400">
                            <span className="material-symbols-outlined text-[16px]">error</span>
                            {error}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center gap-3 mt-8">
                    <button
                        onClick={onClose}
                        disabled={loading}
                        className="flex-1 rounded-xl px-4 py-2.5 text-[14px] font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors disabled:opacity-60 dark:text-slate-300 dark:bg-white/5 dark:hover:bg-white/10"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleDelete}
                        disabled={confirmText !== "DELETE" || loading}
                        className="flex-1 rounded-2xl bg-red-600 px-4 py-2.5 text-[14px] font-bold text-white transition-colors hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        {loading ? (
                            <>
                                <div className="h-3 w-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                Deleting...
                            </>
                        ) : (
                            "Delete Forever"
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default function SettingsHub() {
    useEffect(() => { document.title = "Settings | Mockr"; }, []);
    const [activeModal, setActiveModal] = useState<string | null>(null);
    const { theme } = useTheme();
    const { user, session } = useAuth();

    // Detect OAuth users (Google / LinkedIn) — they have no password to change
    const authProvider = session?.user?.app_metadata?.provider as string | undefined;
    const isOAuthUser = authProvider === "google" || authProvider === "linkedin_oidc";

    return (
        <div className="flex-1 overflow-auto bg-[#FAFBFC] dark:bg-lc-bg flex flex-col relative">
            {/* Phone Verification Banner - shows at top if not verified */}
            {user && !user.mobileVerified && <PhoneVerificationBanner />}
            
            <PageHeader titleNode={<h1 className="text-[28px] font-bold text-slate-900 dark:text-white font-nunito tracking-[-0.02em]">Settings</h1>} showBack backUrl="/dashboard" />

            <main className="flex-1 flex flex-col items-center py-8 px-4">
                <div className="w-full max-w-[800px] space-y-6">
                    {SETTINGS_GROUPS.map((group) => {
                        // Hide password-related items for OAuth users (Google / LinkedIn)
                        const visibleItems = isOAuthUser
                            ? group.items.filter((item) => item.action !== "password")
                            : group.items;

                        // Skip the entire group if it has no visible items
                        if (visibleItems.length === 0) return null;

                        return (
                        <div key={group.title} className="bg-white dark:bg-lc-surface rounded-xl shadow-sm border border-slate-200 dark:border-lc-border overflow-hidden">
                            <div className="px-6 py-5">
                                <h2 className="text-[18px] font-bold text-slate-800 dark:text-white font-nunito tracking-tight text-left">
                                    {group.title}
                                </h2>
                            </div>
                            <div className="flex flex-col">
                                {visibleItems.map((item, index) => {
                                    const valueText = item.action === 'theme' ? theme : item.valueLabel;
                                    const content = (
                                        <>
                                            <span className={`text-[15px] font-medium font-nunito ${item.danger ? 'text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-[#ccc]'}`}>
                                                {item.label}
                                            </span>
                                            <div className="flex items-center gap-2">
                                                {valueText && (
                                                    <span className="text-sm text-slate-500 capitalize">{valueText}</span>
                                                )}
                                                <span className={`material-symbols-outlined text-slate-400 transition-transform ${item.danger ? 'group-hover:text-red-600 dark:group-hover:text-red-400' : 'group-hover:text-slate-700 dark:group-hover:text-white group-hover:translate-x-1'}`}>
                                                    arrow_forward
                                                </span>
                                            </div>
                                        </>
                                    );

                                    if (item.href) {
                                        return (
                                            <Link
                                                href={item.href}
                                                key={item.label}
                                                className={`flex items-center justify-between px-6 py-4 border-t border-slate-100 dark:border-lc-border hover:bg-slate-50 dark:hover:bg-lc-hover transition-colors group ${item.danger ? 'hover:bg-red-50 dark:hover:bg-red-900/10' : ''}`}
                                            >
                                                {content}
                                            </Link>
                                        );
                                    }

                                    return (
                                        <button
                                            key={item.label}
                                            onClick={() => setActiveModal(item.action!)}
                                            className={`flex items-center justify-between px-6 py-4 border-t border-slate-100 dark:border-lc-border hover:bg-slate-50 dark:hover:bg-lc-hover transition-colors group cursor-pointer w-full text-left ${item.danger ? 'hover:bg-red-50 dark:hover:bg-red-900/10' : ''}`}
                                        >
                                            {content}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                        ); })}
                </div>
            </main>

            <Footer />

            {/* Injected Action Modals */}
            {activeModal === 'theme' && <ThemeModal onClose={() => setActiveModal(null)} />}
            {activeModal === 'password' && !isOAuthUser && <PasswordModal onClose={() => setActiveModal(null)} />}
            {activeModal === 'delete' && <DeleteModal onClose={() => setActiveModal(null)} />}
        </div>
    );
}
