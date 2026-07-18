"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSidebar } from "@/context/sidebar-context";
import { useAdminCheck } from "@/hooks/use-admin-check";
import { useAuth } from "@/context/auth-context";
import { useBilling } from "@/hooks/use-billing";
import { useState } from "react";

const NAV_ITEMS = [
    { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
    { href: "/interviews", label: "Interviews", icon: "mic", activeAlso: ["/interviews/ai"] },
    { href: "/ai-tutor", label: "AI Tutor", icon: "school", activeAlso: [] },
    { href: "/questions", label: "Questions", icon: "library_books", activeAlso: [] },
    { href: "/settings", label: "Settings", icon: "settings", activeAlso: [] },
];

const MONITOR_NAV_ITEM = { href: "/monitor", label: "Monitor", icon: "monitoring", activeAlso: [] };
const DEVELOPMENT_ONLY_NAV_ITEMS = new Set(["/scheduled"]);
const showDevelopmentOnlyNavItems = process.env.NODE_ENV !== "production";

export default function Sidebar() {
    const pathname = usePathname();
    const { isCollapsed } = useSidebar();
    const { isAdmin } = useAdminCheck();
    const { user } = useAuth();
    const { snapshot } = useBilling();
    const [isHovered, setIsHovered] = useState(false);

    const expanded = !isCollapsed || isHovered;
    const isExpert = !!snapshot?.isExpert;
    const isContestCreator = user?.role === "contest_creator";
    const canManageContests = isAdmin || isContestCreator;
    const navItems = NAV_ITEMS
        .filter((item) => {
            if (showDevelopmentOnlyNavItems) return true;
            if (item.href === "/contests" && canManageContests) return true;
            return !DEVELOPMENT_ONLY_NAV_ITEMS.has(item.href);
        })
        .flatMap((item) => {
            if (item.href === "/dashboard" && user?.role === "placement_coordinator") {
                return [item, MONITOR_NAV_ITEM];
            }
            return [item];
        });

    return (
        <div
            className={`hidden md:block relative z-[90] h-full shrink-0 transition-[width] duration-300 ${isCollapsed ? "w-[72px]" : "w-[200px]"}`}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            <aside 
                className={`
                    absolute top-0 left-0 z-[90] h-full flex flex-col transition-all duration-300 overflow-hidden bg-white dark:bg-lc-surface
                    ${expanded ? "w-[200px] border-r border-slate-200 dark:border-lc-border shadow-[4px_0_24px_-8px_rgba(0,0,0,0.1)] dark:shadow-[4px_0_24px_-8px_rgba(0,0,0,0.5)]" : "w-[72px] border-r border-slate-200 dark:border-lc-border"}
                    ${!isCollapsed ? "!shadow-none" : ""}
                `}
            >
                {/* Nav */}
                <nav className="flex-1 px-3 py-4 space-y-1 overflow-x-hidden w-[200px]">
                    {navItems.map((item) => {
                        const isActive = pathname === item.href || pathname.startsWith(item.href + "/") || (item.activeAlso?.some(p => pathname === p || pathname.startsWith(p + "/")));
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                title={!expanded ? item.label : undefined}
                                className={`flex items-center gap-3 py-2.5 rounded-lg text-sm font-medium font-nunito transition-colors whitespace-nowrap px-3 ${isActive
                                        ? "bg-primary/10 text-primary"
                                        : "text-slate-600 dark:text-[#8a8a8a] hover:bg-slate-50 dark:hover:bg-lc-hover hover:text-slate-900 dark:hover:text-[#ccc]"
                                    }`}
                            >
                                <span
                                    className="material-symbols-outlined text-xl shrink-0"
                                    style={isActive ? { fontVariationSettings: "'FILL' 1" } : undefined}
                                >
                                    {item.icon}
                                </span>
                                <span
                                    className={`transition-all duration-300 ${!expanded ? "opacity-0 w-0 -translate-x-4 ml-0" : "opacity-100 w-auto translate-x-0"}`}
                                >
                                    {item.label}
                                </span>
                            </Link>
                        );
                    })}

                    {/* Expert Section */}
                    {isExpert && (
                        <Link
                            href="/expert"
                            title={!expanded ? "Expert Console" : undefined}
                            className={`flex items-center gap-3 py-2.5 rounded-lg text-sm font-medium font-nunito transition-colors whitespace-nowrap px-3 ${
                                pathname.startsWith("/expert")
                                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
                                    : "text-slate-600 dark:text-[#8a8a8a] hover:bg-slate-50 dark:hover:bg-lc-hover hover:text-slate-900 dark:hover:text-[#ccc]"
                            }`}
                        >
                            <span
                                className="material-symbols-outlined text-xl shrink-0"
                                style={pathname.startsWith("/expert") ? { fontVariationSettings: "'FILL' 1" } : undefined}
                            >
                                workspace_premium
                            </span>
                            <span
                                className={`transition-all duration-300 ${!expanded ? "opacity-0 w-0 -translate-x-4 ml-0" : "opacity-100 w-auto translate-x-0"}`}
                            >
                                Expert Console
                            </span>
                        </Link>
                    )}

                    {/* Admin Section */}
                    {canManageContests && (
                        <>
                            <Link
                                href="/admin/contests"
                                title={!expanded ? "Manage Contests" : undefined}
                                className={`flex items-center gap-3 py-2.5 rounded-lg text-sm font-medium font-nunito transition-colors whitespace-nowrap px-3 ${
                                    pathname.startsWith("/admin/contests")
                                        ? "bg-primary/10 text-primary"
                                        : "text-slate-600 dark:text-[#8a8a8a] hover:bg-slate-50 dark:hover:bg-lc-hover hover:text-slate-900 dark:hover:text-[#ccc]"
                                }`}
                            >
                                <span
                                    className="material-symbols-outlined text-xl shrink-0"
                                    style={pathname.startsWith("/admin/contests") ? { fontVariationSettings: "'FILL' 1" } : undefined}
                                >
                                    emoji_events
                                </span>
                                <span
                                    className={`transition-all duration-300 ${!expanded ? "opacity-0 w-0 -translate-x-4 ml-0" : "opacity-100 w-auto translate-x-0"}`}
                                >
                                    Manage Contests
                                </span>
                            </Link>
                            <Link
                                href="/admin/contest-questions/new"
                                title={!expanded ? "Create Question" : undefined}
                                className={`flex items-center gap-3 py-2.5 rounded-lg text-sm font-medium font-nunito transition-colors whitespace-nowrap px-3 ${
                                    pathname.startsWith("/admin/contest-questions/new")
                                        ? "bg-primary/10 text-primary"
                                        : "text-slate-600 dark:text-[#8a8a8a] hover:bg-slate-50 dark:hover:bg-lc-hover hover:text-slate-900 dark:hover:text-[#ccc]"
                                }`}
                            >
                                <span
                                    className="material-symbols-outlined text-xl shrink-0"
                                    style={pathname.startsWith("/admin/contest-questions/new") ? { fontVariationSettings: "'FILL' 1" } : undefined}
                                >
                                    add_notes
                                </span>
                                <span
                                    className={`transition-all duration-300 ${!expanded ? "opacity-0 w-0 -translate-x-4 ml-0" : "opacity-100 w-auto translate-x-0"}`}
                                >
                                    Create Question
                                </span>
                            </Link>
                            <Link
                                href="/admin/contest-questions"
                                title={!expanded ? "View Questions" : undefined}
                                className={`flex items-center gap-3 py-2.5 rounded-lg text-sm font-medium font-nunito transition-colors whitespace-nowrap px-3 ${
                                    pathname === "/admin/contest-questions"
                                        ? "bg-primary/10 text-primary"
                                        : "text-slate-600 dark:text-[#8a8a8a] hover:bg-slate-50 dark:hover:bg-lc-hover hover:text-slate-900 dark:hover:text-[#ccc]"
                                }`}
                            >
                                <span
                                    className="material-symbols-outlined text-xl shrink-0"
                                    style={pathname === "/admin/contest-questions" ? { fontVariationSettings: "'FILL' 1" } : undefined}
                                >
                                    library_books
                                </span>
                                <span
                                    className={`transition-all duration-300 ${!expanded ? "opacity-0 w-0 -translate-x-4 ml-0" : "opacity-100 w-auto translate-x-0"}`}
                                >
                                    View Questions
                                </span>
                            </Link>
                            {isAdmin && (
                                <>
                                    <Link
                                        href="/admin/experts"
                                        title={!expanded ? "Manage Experts" : undefined}
                                        className={`flex items-center gap-3 py-2.5 rounded-lg text-sm font-medium font-nunito transition-colors whitespace-nowrap px-3 ${
                                            pathname.startsWith("/admin/experts")
                                                ? "bg-primary/10 text-primary"
                                                : "text-slate-600 dark:text-[#8a8a8a] hover:bg-slate-50 dark:hover:bg-lc-hover hover:text-slate-900 dark:hover:text-[#ccc]"
                                        }`}
                                    >
                                        <span
                                            className="material-symbols-outlined text-xl shrink-0"
                                            style={pathname.startsWith("/admin/experts") ? { fontVariationSettings: "'FILL' 1" } : undefined}
                                        >
                                            admin_panel_settings
                                        </span>
                                        <span
                                            className={`transition-all duration-300 ${!expanded ? "opacity-0 w-0 -translate-x-4 ml-0" : "opacity-100 w-auto translate-x-0"}`}
                                        >
                                            Manage Experts
                                        </span>
                                    </Link>
                                    <Link
                                        href="/admin/contest-creators"
                                        title={!expanded ? "Contest Creators" : undefined}
                                        className={`flex items-center gap-3 py-2.5 rounded-lg text-sm font-medium font-nunito transition-colors whitespace-nowrap px-3 ${
                                            pathname.startsWith("/admin/contest-creators")
                                                ? "bg-primary/10 text-primary"
                                                : "text-slate-600 dark:text-[#8a8a8a] hover:bg-slate-50 dark:hover:bg-lc-hover hover:text-slate-900 dark:hover:text-[#ccc]"
                                        }`}
                                    >
                                        <span
                                            className="material-symbols-outlined text-xl shrink-0"
                                            style={pathname.startsWith("/admin/contest-creators") ? { fontVariationSettings: "'FILL' 1" } : undefined}
                                        >
                                            manage_accounts
                                        </span>
                                        <span
                                            className={`transition-all duration-300 ${!expanded ? "opacity-0 w-0 -translate-x-4 ml-0" : "opacity-100 w-auto translate-x-0"}`}
                                        >
                                            Contest Creators
                                        </span>
                                    </Link>
                                    <Link
                                        href="/admin/placement-coordinators"
                                        title={!expanded ? "Placement Coordinators" : undefined}
                                        className={`flex items-center gap-3 py-2.5 rounded-lg text-sm font-medium font-nunito transition-colors whitespace-nowrap px-3 ${
                                            pathname.startsWith("/admin/placement-coordinators")
                                                ? "bg-primary/10 text-primary"
                                                : "text-slate-600 dark:text-[#8a8a8a] hover:bg-slate-50 dark:hover:bg-lc-hover hover:text-slate-900 dark:hover:text-[#ccc]"
                                        }`}
                                    >
                                        <span
                                            className="material-symbols-outlined text-xl shrink-0"
                                            style={pathname.startsWith("/admin/placement-coordinators") ? { fontVariationSettings: "'FILL' 1" } : undefined}
                                        >
                                            supervisor_account
                                        </span>
                                        <span
                                            className={`transition-all duration-300 ${!expanded ? "opacity-0 w-0 -translate-x-4 ml-0" : "opacity-100 w-auto translate-x-0"}`}
                                        >
                                            Coordinators
                                        </span>
                                    </Link>
                                    <Link
                                        href="/admin/coupons"
                                        title={!expanded ? "Manage Coupons" : undefined}
                                        className={`flex items-center gap-3 py-2.5 rounded-lg text-sm font-medium font-nunito transition-colors whitespace-nowrap px-3 ${
                                            pathname.startsWith("/admin/coupons")
                                                ? "bg-primary/10 text-primary"
                                                : "text-slate-600 dark:text-[#8a8a8a] hover:bg-slate-50 dark:hover:bg-lc-hover hover:text-slate-900 dark:hover:text-[#ccc]"
                                        }`}
                                    >
                                        <span
                                            className="material-symbols-outlined text-xl shrink-0"
                                            style={pathname.startsWith("/admin/coupons") ? { fontVariationSettings: "'FILL' 1" } : undefined}
                                        >
                                            local_activity
                                        </span>
                                        <span
                                            className={`transition-all duration-300 ${!expanded ? "opacity-0 w-0 -translate-x-4 ml-0" : "opacity-100 w-auto translate-x-0"}`}
                                        >
                                            Manage Coupons
                                        </span>
                                    </Link>
                                </>
                            )}
                        </>
                    )}
                </nav>
            </aside>
        </div>
    );
}
