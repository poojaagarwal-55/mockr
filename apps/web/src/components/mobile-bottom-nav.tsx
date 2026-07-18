"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/context/auth-context";
import { useBilling } from "@/hooks/use-billing";

const BOTTOM_NAV_ITEMS = [
    { href: "/dashboard", label: "Dashboard", icon: "home" },
    { href: "/interviews", label: "Interviews", icon: "mic" },
    { href: "/ai-tutor", label: "AI Tutor", icon: "school" },
    { href: "/questions", label: "Questions", icon: "library_books" },
];

const MORE_ITEMS = [
    { href: "/settings", label: "Profile & Settings", icon: "manage_accounts" },
];

const DEVELOPMENT_ONLY_MORE_ITEMS = new Set(["/scheduled"]);
const showDevelopmentOnlyMoreItems = process.env.NODE_ENV !== "production";

export function MobileBottomNav() {
    const pathname = usePathname();
    const { user } = useAuth();
    const { snapshot } = useBilling();
    const [showMore, setShowMore] = useState(false);
    const moreRef = useRef<HTMLDivElement>(null);
    const visibleMoreItems = MORE_ITEMS.filter((item) => (
        showDevelopmentOnlyMoreItems || !DEVELOPMENT_ONLY_MORE_ITEMS.has(item.href)
    ));
    const roleMoreItems = user?.role === "placement_coordinator"
        ? [{ href: "/monitor", label: "Monitor", icon: "monitoring" }, ...visibleMoreItems]
        : visibleMoreItems;
    const moreItems = [
        ...roleMoreItems,
        ...(snapshot?.isExpert ? [{ href: "/expert", label: "Expert Console", icon: "workspace_premium" }] : []),
        ...(snapshot?.isAdmin ? [{ href: "/admin/experts", label: "Manage Experts", icon: "admin_panel_settings" }] : []),
    ];

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
                setShowMore(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const isMoreActive = moreItems.some(
        (item) => pathname === item.href || pathname.startsWith(item.href + "/")
    );

    return (
        <>
            {/* AI Tutor floating button - dashboard only */}
            {pathname === "/dashboard" && (
                <Link
                    href="/ai-tutor"
                    className="fixed bottom-[72px] right-4 z-[79] md:hidden w-14 h-14 rounded-full shadow-lg hover:shadow-xl transition-shadow overflow-hidden border-2 border-white dark:border-lc-border print:hidden"
                >
                    <Image
                        src="/tutor_idle.svg"
                        alt="AI Tutor"
                        width={56}
                        height={56}
                        className="w-full h-full object-cover"
                    />
                </Link>
            )}

            {/* Bottom Nav Bar */}
            <nav className="fixed bottom-0 left-0 right-0 z-[80] bg-white dark:bg-lc-surface border-t border-slate-200 dark:border-lc-border flex items-stretch md:hidden print:hidden"
                style={{ height: "60px" }}
            >
                {BOTTOM_NAV_ITEMS.map((item) => {
                    const isActive =
                        pathname === item.href || pathname.startsWith(item.href + "/");
                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={`flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors ${
                                isActive
                                    ? "text-primary"
                                    : "text-slate-500 dark:text-[#8a8a8a]"
                            }`}
                        >
                            <span
                                className="material-symbols-outlined text-[22px]"
                                style={
                                    isActive
                                        ? { fontVariationSettings: "'FILL' 1" }
                                        : undefined
                                }
                            >
                                {item.icon}
                            </span>
                            <span className="text-[10px] font-medium">{item.label}</span>
                        </Link>
                    );
                })}

                {/* Three dots — More */}
                <div ref={moreRef} className="flex-1 relative">
                    <button
                        onClick={() => setShowMore((v) => !v)}
                        className={`w-full h-full flex flex-col items-center justify-center gap-0.5 transition-colors ${
                            isMoreActive || showMore
                                ? "text-primary"
                                : "text-slate-500 dark:text-[#8a8a8a]"
                        }`}
                    >
                        <span className="material-symbols-outlined text-[22px]">
                            more_horiz
                        </span>
                        <span className="text-[10px] font-medium">More</span>
                    </button>

                    {/* Drop-up menu */}
                    {showMore && (
                        <div className="absolute bottom-full right-0 mb-2 w-52 bg-white dark:bg-lc-surface rounded-2xl shadow-xl border border-slate-100 dark:border-lc-border overflow-hidden py-2">
                            {moreItems.map((item) => {
                                const isActive =
                                    pathname === item.href ||
                                    pathname.startsWith(item.href + "/");
                                return (
                                    <Link
                                        key={item.href}
                                        href={item.href}
                                        onClick={() => setShowMore(false)}
                                        className={`flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors ${
                                            isActive
                                                ? "text-primary bg-primary/5"
                                                : "text-slate-700 dark:text-[#ccc] hover:bg-slate-50 dark:hover:bg-lc-hover"
                                        }`}
                                    >
                                        <span
                                            className="material-symbols-outlined text-[20px]"
                                            style={
                                                isActive
                                                    ? { fontVariationSettings: "'FILL' 1" }
                                                    : undefined
                                            }
                                        >
                                            {item.icon}
                                        </span>
                                        {item.label}
                                    </Link>
                                );
                            })}
                        </div>
                    )}
                </div>
            </nav>
        </>
    );
}
