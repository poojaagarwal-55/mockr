"use client";

import Link from "next/link";
import { useBilling } from "@/hooks/use-billing";
import { ClockIcon } from "@/components/icons/clock-icon";

export function CreditBadge() {
    const { snapshot, loading } = useBilling();

    if (loading) {
        return (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-slate-200 dark:border-white/10 bg-transparent animate-pulse">
                <ClockIcon size={15} className="text-slate-300 dark:text-slate-600" />
                <span className="text-xs font-semibold text-slate-300 dark:text-slate-600">—</span>
            </div>
        );
    }

    if (!snapshot) return null;

    const { wallet } = snapshot;

    return (
        <Link
            href="/settings/billing"
            className="group flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-primary/50 hover:border-primary bg-transparent hover:bg-primary/5 dark:hover:bg-primary/10 transition-all duration-200"
            title="Interview minutes remaining — click to manage"
        >
            <ClockIcon size={15} className="text-primary" />
            <span className="text-[13px] font-bold tabular-nums text-primary">
                {wallet.total}
            </span>
            <span className="text-[12px] font-medium text-slate-400 dark:text-slate-500 group-hover:text-primary/70 transition-colors">
                mins left
            </span>
        </Link>
    );
}
