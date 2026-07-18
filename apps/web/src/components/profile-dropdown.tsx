"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import { useTheme } from "next-themes";
import { useBilling } from "@/hooks/use-billing";
import { PlanBadge } from "./plan-badge";

export function ProfileDropdown({ streak = 0 }: { streak?: number }) {
    const { session, signOut, user } = useAuth();
    const router = useRouter();
    const { theme, setTheme } = useTheme();
    const { snapshot } = useBilling();
    const [profileOpen, setProfileOpen] = useState(false);
    const [showThemeOptions, setShowThemeOptions] = useState(false);
    const [imgError, setImgError] = useState(false);
    const profileRef = useRef<HTMLDivElement>(null);

    const handleThemeToggle = (newTheme: string, e: React.MouseEvent) => {
        if (!(document as any).startViewTransition) {
            setTheme(newTheme);
            return;
        }

        const x = e.clientX;
        const y = e.clientY;
        const endRadius = Math.hypot(
            Math.max(x, window.innerWidth - x),
            Math.max(y, window.innerHeight - y)
        );

        const transition = (document as any).startViewTransition(() => {
            setTheme(newTheme);
        });

        transition.ready.then(() => {
            document.documentElement.animate(
                {
                    clipPath: [
                        `circle(0px at ${x}px ${y}px)`,
                        `circle(${endRadius}px at ${x}px ${y}px)`,
                    ],
                },
                {
                    duration: 600,
                    easing: "ease-in-out",
                    pseudoElement: "::view-transition-new(root)",
                }
            );
        });
    };

    const userMetaData = session?.user?.user_metadata || {};
    // Prioritize our database user object since we intentionally sync the latest OAuth identity (e.g. LinkedIn over Google)
    const avatarUrl = user?.avatarUrl || userMetaData.avatar_url || userMetaData.picture;
    const displayName = user?.fullName || userMetaData.full_name || userMetaData.name || "User";
    const initial = displayName.charAt(0).toUpperCase() || session?.user?.email?.charAt(0)?.toUpperCase() || "U";

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
                setProfileOpen(false);
                setShowThemeOptions(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    // Handle initial mount to ensure we have a mounted state before rendering theme UI to avoid hydration mismatch
    const [mounted, setMounted] = useState(false);
    useEffect(() => {
        setMounted(true);
    }, []);

    // Get gradient border class based on plan
    const getGradientBorderClass = () => {
        if (!snapshot || snapshot.plan === "FREE") {
            return "ring-0"; // No border for FREE
        }
        
        switch (snapshot.plan) {
            case "PLUS":
                return "ring-2 ring-transparent bg-gradient-to-br from-yellow-400 via-amber-500 to-orange-500 p-[3px]";
            case "PRO":
                return "ring-2 ring-transparent bg-gradient-to-br from-blue-400 via-blue-500 to-indigo-600 p-[3px]";
            case "MAX":
                return "ring-2 ring-transparent bg-gradient-to-br from-purple-400 via-purple-500 to-pink-600 p-[3px]";
            default:
                return "ring-0";
        }
    };

    const hasGradientBorder = snapshot && snapshot.plan !== "FREE";

    return (
        <div className="relative" ref={profileRef}>
            <button
                onClick={() => {
                    setProfileOpen(!profileOpen);
                    if (profileOpen) setShowThemeOptions(false); // Reset to main menu when closing
                }}
                className={`rounded-full cursor-pointer hover:opacity-90 transition-all ${
                    hasGradientBorder ? getGradientBorderClass() : ""
                }`}
            >
                {hasGradientBorder ? (
                    <div className="rounded-full bg-white dark:bg-lc-surface p-[1px]">
                        <div className="size-9 rounded-full bg-rose-900 flex items-center justify-center text-white font-bold text-xs overflow-hidden">
                            {avatarUrl && !imgError ? (
                                <img src={avatarUrl} alt={displayName} referrerPolicy="no-referrer" className="w-full h-full object-cover" onError={() => setImgError(true)} />
                            ) : (
                                initial
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="size-9 rounded-full bg-rose-900 flex items-center justify-center text-white font-bold text-xs overflow-hidden hover:ring-2 hover:ring-rose-900/30">
                        {avatarUrl && !imgError ? (
                            <img src={avatarUrl} alt={displayName} referrerPolicy="no-referrer" className="w-full h-full object-cover" onError={() => setImgError(true)} />
                        ) : (
                            initial
                        )}
                    </div>
                )}
            </button>
            {profileOpen && (
                <div className="absolute right-0 top-12 w-56 bg-white dark:bg-lc-surface rounded-xl shadow-lg border border-slate-100 dark:border-lc-border py-2 z-50 overflow-hidden">
                    {/* Header */}
                    <div className="px-4 py-3 border-b border-slate-100 dark:border-lc-border">
                        <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-slate-900 dark:text-[#eff1f6] truncate">
                                {displayName}
                            </p>
                            <ProfilePlanBadge />
                        </div>
                        <p className="text-xs text-slate-500 dark:text-[#8a8a8a] truncate">
                            {session?.user?.email}
                        </p>
                        <div className="flex items-center gap-3 mt-2 md:hidden">
                            <span className="flex items-center gap-1 text-xs text-slate-600 dark:text-[#8a8a8a]">
                                <span className="text-base">🔥</span>
                                {streak} day streak
                            </span>
                            {snapshot?.wallet && (
                                <span className="flex items-center gap-1 text-xs text-slate-600 dark:text-[#8a8a8a]">
                                    <span className="material-symbols-outlined text-[14px]">timer</span>
                                    {snapshot.wallet.total} mins left
                                </span>
                            )}
                        </div>
                    </div>

                    {!showThemeOptions ? (
                        <>
                            {/* Main Menu */}
                            <div className="py-1">
                                <button
                                    onClick={() => router.push("/settings/profile")}
                                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 dark:text-[#ababab] hover:bg-slate-50 dark:hover:bg-lc-hover transition-colors cursor-pointer"
                                >
                                    <span className="material-symbols-outlined text-lg text-slate-400">person</span>
                                    Profile
                                </button>
                                <button
                                    onClick={() => router.push("/settings/billing")}
                                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 dark:text-[#ababab] hover:bg-slate-50 dark:hover:bg-lc-hover transition-colors cursor-pointer"
                                >
                                    <span className="material-symbols-outlined text-lg text-slate-400">credit_card</span>
                                    Subscription
                                </button>
                                <button
                                    onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        setShowThemeOptions(true);
                                    }}
                                    className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-slate-700 dark:text-[#ababab] hover:bg-slate-50 dark:hover:bg-lc-hover transition-colors cursor-pointer"
                                >
                                    <div className="flex items-center gap-3">
                                        <span className="material-symbols-outlined text-lg text-slate-400">palette</span>
                                        Theme
                                    </div>
                                    <span className="material-symbols-outlined text-sm text-slate-400">chevron_right</span>
                                </button>
                                <button
                                    onClick={() => router.push("/settings")}
                                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 dark:text-[#ababab] hover:bg-slate-50 dark:hover:bg-lc-hover transition-colors cursor-pointer"
                                >
                                    <span className="material-symbols-outlined text-lg text-slate-400">settings</span>
                                    Settings
                                </button>
                            </div>
                            <div className="border-t border-slate-100 dark:border-lc-border">
                                <button
                                    onClick={async () => {
                                        await signOut();
                                        router.replace("/login");
                                    }}
                                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors cursor-pointer"
                                >
                                    <span className="material-symbols-outlined text-lg">logout</span>
                                    Sign Out
                                </button>
                            </div>
                        </>
                    ) : (
                        <>
                            {/* Theme sub-menu */}
                            <div className="py-1">
                                <div className="px-4 py-2 mb-1 flex items-center gap-2 border-b border-slate-100 dark:border-lc-border">
                                    <button
                                        onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            setShowThemeOptions(false);
                                        }}
                                        className="text-slate-400 hover:text-slate-700 dark:hover:text-[#ccc] transition-colors p-1 -ml-1 cursor-pointer flex items-center justify-center rounded-md"
                                    >
                                        <span className="material-symbols-outlined text-sm">arrow_back</span>
                                    </button>
                                    <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Theme Options</span>
                                </div>

                                {mounted && (
                                    <>
                                        <button
                                            onClick={(e) => handleThemeToggle('light', e)}
                                            className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-slate-700 dark:text-[#ababab] hover:bg-slate-50 dark:hover:bg-lc-hover transition-colors cursor-pointer"
                                        >
                                            <div className="flex items-center gap-3">
                                                <span className="material-symbols-outlined text-lg text-slate-400">light_mode</span>
                                                Light
                                            </div>
                                            {theme === 'light' && <span className="material-symbols-outlined text-sm text-primary">check</span>}
                                        </button>
                                        <button
                                            onClick={(e) => handleThemeToggle('dark', e)}
                                            className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-slate-700 dark:text-[#ababab] hover:bg-slate-50 dark:hover:bg-lc-hover transition-colors cursor-pointer"
                                        >
                                            <div className="flex items-center gap-3">
                                                <span className="material-symbols-outlined text-lg text-slate-400">dark_mode</span>
                                                Dark
                                            </div>
                                            {theme === 'dark' && <span className="material-symbols-outlined text-sm text-primary">check</span>}
                                        </button>
                                        <button
                                            onClick={(e) => handleThemeToggle('system', e)}
                                            className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-slate-700 dark:text-[#ababab] hover:bg-slate-50 dark:hover:bg-lc-hover transition-colors cursor-pointer"
                                        >
                                            <div className="flex items-center gap-3">
                                                <span className="material-symbols-outlined text-lg text-slate-400">desktop_windows</span>
                                                System
                                            </div>
                                            {theme === 'system' && <span className="material-symbols-outlined text-sm text-primary">check</span>}
                                        </button>
                                    </>
                                )}
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

function ProfilePlanBadge() {
    const { snapshot, loading } = useBilling();
    if (loading || !snapshot || snapshot.plan === "FREE") return null;
    return <PlanBadge plan={snapshot.plan} />;
}
