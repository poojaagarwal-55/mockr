"use client";

import { useBilling } from "@/hooks/use-billing";
import type { PlanKey } from "@interviewforge/shared";
import { useSafariSafeAttributes } from "@/lib/safari-utils";

const PLAN_STYLES: Record<string, string> = {
    PLUS: "bg-gradient-to-r from-yellow-400 to-orange-500 text-white dark:from-yellow-400 dark:to-orange-500",
    PRO: "bg-gradient-to-r from-blue-400 to-indigo-600 text-white dark:from-blue-400 dark:to-indigo-600",
    MAX: "bg-gradient-to-r from-purple-400 to-pink-600 text-white dark:from-purple-400 dark:to-pink-600",
};

/** Small inline plan pill — only renders for paid plans */
export function PlanBadge({ plan, className = "" }: { plan?: PlanKey; className?: string }) {
    const ref = useSafariSafeAttributes<HTMLSpanElement>();
    const style = plan ? PLAN_STYLES[plan] : undefined;
    if (!style) return null;

    return (
        <span
            ref={ref}
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider leading-none ${style} ${className}`}
        >
            {plan}
        </span>
    );
}

/** Auto-reads plan from billing context */
export function PlanBadgeAuto({ className = "" }: { className?: string }) {
    const { snapshot, loading } = useBilling();
    if (loading || !snapshot || snapshot.plan === "FREE") return null;
    return <PlanBadge plan={snapshot.plan} className={className} />;
}
