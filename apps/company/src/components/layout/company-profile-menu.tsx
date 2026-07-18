"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useCompanyAuth } from "@/context/company-auth-context";

export function CompanyProfileMenu() {
    const { company, session, signOut } = useCompanyAuth();
    const { theme, setTheme } = useTheme();
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const [themeOpen, setThemeOpen] = useState(false);
    const [mounted, setMounted] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setMounted(true);
    }, []);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setOpen(false);
                setThemeOpen(false);
            }
        };

        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const userMeta = session?.user?.user_metadata || {};
    const accountEmail = session?.user?.email || "";
    const accountName =
        (typeof userMeta.full_name === "string" && userMeta.full_name.trim()) ||
        (typeof userMeta.name === "string" && userMeta.name.trim()) ||
        accountEmail.split("@")[0] ||
        "Company user";
    const workspaceName = company?.name || "Company";
    const initial = accountName.charAt(0).toUpperCase() || "C";

    const handleThemeChange = (newTheme: string, event: React.MouseEvent) => {
        if (!(document as any).startViewTransition) {
            setTheme(newTheme);
            return;
        }

        const x = event.clientX;
        const y = event.clientY;
        const endRadius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
        const transition = (document as any).startViewTransition(() => setTheme(newTheme));

        transition.ready.then(() => {
            document.documentElement.animate(
                {
                    clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${endRadius}px at ${x}px ${y}px)`],
                },
                {
                    duration: 600,
                    easing: "ease-in-out",
                    pseudoElement: "::view-transition-new(root)",
                }
            );
        });
    };

    return (
        <div className="relative" ref={menuRef}>
            <button
                onClick={() => {
                    setOpen((value) => !value);
                    if (open) setThemeOpen(false);
                }}
                className="rounded-full transition hover:opacity-90"
                title="Company menu"
            >
                <div className="flex size-10 items-center justify-center rounded-full bg-gradient-to-br from-primary via-indigo-500 to-fuchsia-500 p-[3px]">
                    <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-white text-sm font-bold text-primary dark:bg-lc-surface dark:text-white">
                        {company?.logoUrl ? (
                            <img src={company.logoUrl} alt="" className="h-full w-full object-contain p-1" />
                        ) : (
                            initial
                        )}
                    </div>
                </div>
            </button>

            {open && (
                <div className="absolute right-0 top-12 z-50 w-64 overflow-hidden rounded-xl border border-slate-100 bg-white py-2 shadow-lg dark:border-lc-border dark:bg-lc-surface">
                    <div className="border-b border-slate-100 px-4 py-3 dark:border-lc-border">
                        <p className="truncate text-sm font-semibold text-slate-900 dark:text-[#eff1f6]">{accountName}</p>
                        <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-[#8a8a8a]">{accountEmail}</p>
                        <p className="mt-2 truncate rounded-md bg-slate-50 px-2 py-1 text-[11px] font-bold uppercase text-slate-500 dark:bg-lc-hover dark:text-slate-300">
                            Workspace: {workspaceName}
                        </p>
                    </div>

                    {!themeOpen ? (
                        <>
                            <div className="py-1">
                                <button
                                    onClick={() => router.push("/settings")}
                                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50 dark:text-[#ababab] dark:hover:bg-lc-hover"
                                >
                                    <span className="material-symbols-outlined text-lg text-slate-400">settings</span>
                                    Settings
                                </button>
                                <button
                                    onClick={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        setThemeOpen(true);
                                    }}
                                    className="flex w-full items-center justify-between px-4 py-2.5 text-sm text-slate-700 transition-colors hover:bg-slate-50 dark:text-[#ababab] dark:hover:bg-lc-hover"
                                >
                                    <span className="flex items-center gap-3">
                                        <span className="material-symbols-outlined text-lg text-slate-400">palette</span>
                                        Theme
                                    </span>
                                    <span className="material-symbols-outlined text-sm text-slate-400">chevron_right</span>
                                </button>
                            </div>
                            <div className="border-t border-slate-100 dark:border-lc-border">
                                <button
                                    onClick={async () => {
                                        await signOut();
                                        router.replace("/login");
                                    }}
                                    className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-red-600 transition-colors hover:bg-red-50 dark:hover:bg-red-900/20"
                                >
                                    <span className="material-symbols-outlined text-lg">logout</span>
                                    Sign Out
                                </button>
                            </div>
                        </>
                    ) : (
                        <div className="py-1">
                            <div className="mb-1 flex items-center gap-2 border-b border-slate-100 px-4 py-2 dark:border-lc-border">
                                <button
                                    onClick={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        setThemeOpen(false);
                                    }}
                                    className="-ml-1 flex items-center justify-center rounded-md p-1 text-slate-400 transition hover:text-slate-700 dark:hover:text-[#ccc]"
                                >
                                    <span className="material-symbols-outlined text-sm">arrow_back</span>
                                </button>
                                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Theme Options</span>
                            </div>

                            {mounted &&
                                ["light", "dark", "system"].map((option) => (
                                    <button
                                        key={option}
                                        onClick={(event) => handleThemeChange(option, event)}
                                        className="flex w-full items-center justify-between px-4 py-2.5 text-sm text-slate-700 transition-colors hover:bg-slate-50 dark:text-[#ababab] dark:hover:bg-lc-hover"
                                    >
                                        <span className="flex items-center gap-3">
                                            <span className="material-symbols-outlined text-lg text-slate-400">
                                                {option === "light" ? "light_mode" : option === "dark" ? "dark_mode" : "desktop_windows"}
                                            </span>
                                            {option.charAt(0).toUpperCase() + option.slice(1)}
                                        </span>
                                        {theme === option && <span className="material-symbols-outlined text-sm text-primary">check</span>}
                                    </button>
                                ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
