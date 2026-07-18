"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useSidebar } from "@/context/sidebar-context";

const NAV_ITEMS = [
    { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
    { href: "/candidates", label: "Candidates", icon: "groups" },
    { href: "/jobs", label: "Jobs", icon: "work" },
    { href: "/assessments", label: "Assessments", icon: "assignment_turned_in" },
    { href: "/oa", label: "OA", icon: "quiz" },
    { href: "/direct-interviews", label: "Direct Interviews", icon: "record_voice_over" },
    { href: "/question-bank", label: "Question Bank", icon: "library_books" },
    { href: "/reports", label: "Reports", icon: "bar_chart" },
    { href: "/team", label: "Team", icon: "badge" },
    { href: "/settings", label: "Settings", icon: "settings" },
];

export function CompanySidebar() {
    const pathname = usePathname();
    const { isCollapsed } = useSidebar();
    const [isHovered, setIsHovered] = useState(false);
    const expanded = !isCollapsed || isHovered;

    return (
        <div
            className={`relative z-[90] hidden h-full shrink-0 transition-[width] duration-300 md:block ${isCollapsed ? "w-[72px]" : "w-[220px]"}`}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            <aside
                className={`absolute left-0 top-0 z-[90] flex h-full flex-col overflow-hidden bg-white transition-all duration-300 dark:bg-lc-surface ${
                    expanded
                        ? "w-[220px] border-r border-slate-200 shadow-[4px_0_24px_-8px_rgba(0,0,0,0.1)] dark:border-lc-border dark:shadow-[4px_0_24px_-8px_rgba(0,0,0,0.5)]"
                        : "w-[72px] border-r border-slate-200 dark:border-lc-border"
                } ${!isCollapsed ? "!shadow-none" : ""}`}
            >
                <nav className="flex-1 space-y-1 overflow-x-hidden px-3 py-4 w-[220px]">
                    {NAV_ITEMS.map((item) => {
                        const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);

                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                title={!expanded ? item.label : undefined}
                                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 font-nunito text-sm font-medium whitespace-nowrap transition-colors ${
                                    isActive
                                        ? "bg-primary/10 text-primary"
                                        : "text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-[#8a8a8a] dark:hover:bg-lc-hover dark:hover:text-[#ccc]"
                                }`}
                            >
                                <span
                                    className="material-symbols-outlined shrink-0 text-xl"
                                    style={isActive ? { fontVariationSettings: "'FILL' 1" } : undefined}
                                >
                                    {item.icon}
                                </span>
                                <span className={`transition-all duration-300 ${!expanded ? "ml-0 w-0 -translate-x-4 opacity-0" : "w-auto translate-x-0 opacity-100"}`}>
                                    {item.label}
                                </span>
                            </Link>
                        );
                    })}
                </nav>
            </aside>
        </div>
    );
}
