"use client";

import Link from "next/link";
import { useSidebar } from "@/context/sidebar-context";
import { CompanyProfileMenu } from "@/components/layout/company-profile-menu";

export function CompanyTopHeader() {
    const { isCollapsed, toggleCollapsed } = useSidebar();

    return (
        <header className="sticky top-0 z-[60] flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 dark:border-lc-border dark:bg-lc-surface">
            <div className="flex w-[220px] shrink-0 items-center gap-4">
                <button
                    onClick={toggleCollapsed}
                    className="mt-1.5 hidden shrink-0 rounded-full p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-[#8a8a8a] dark:hover:bg-lc-hover dark:hover:text-[#ccc] md:block"
                    title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                >
                    <span className="material-symbols-outlined text-[24px]">menu</span>
                </button>

                <Link href="/dashboard" className="ml-2 flex shrink-0 items-center">
                    <img src="/logo_big.svg" alt="Practers Logo" className="h-10 w-auto object-contain" />
                </Link>
            </div>

            <div className="hidden flex-1 justify-center px-4 md:flex">
                <div className="relative w-full max-w-sm">
                    <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-xl text-slate-400">search</span>
                    <input
                        type="text"
                        placeholder="Search workspace (Cmd+K)"
                        disabled
                        className="w-full rounded-full border-none bg-slate-100 py-2 pl-10 pr-4 text-sm text-slate-500 outline-none transition-colors dark:bg-white/10 dark:text-slate-400"
                    />
                </div>
            </div>

            <div className="flex shrink-0 items-center gap-3">
                <button
                    className="hidden size-10 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-[#8a8a8a] dark:hover:bg-lc-hover dark:hover:text-[#ccc] md:flex"
                    title="Notifications"
                >
                    <span className="material-symbols-outlined">notifications</span>
                </button>
                <CompanyProfileMenu />
            </div>
        </header>
    );
}
