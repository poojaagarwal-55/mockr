"use client";

import { ReactNode, useState } from "react";
import { useBilling } from "@/hooks/use-billing";
import type { PlanKey } from "@interviewforge/shared";
import { UpgradeModal, type UpgradeFeature } from "@/components/upgrade-modal";

type LockedFeatureProps = {
    feature: Exclude<UpgradeFeature, "interview_minutes">;
    requiredPlan?: PlanKey;
    children: ReactNode;
    title?: string;
    description?: string;
    compact?: boolean;
};

const FEATURE_COPY: Record<
    LockedFeatureProps["feature"],
    { title: string; description: string; plan: PlanKey }
> = {
    ai_tutor: {
        title: "AI Tutor is a Plus feature",
        description:
            "Get personalized guidance, practice plans, and deep-dive feedback after every interview.",
        plan: "PLUS",
    },
    latex_ai: {
        title: "AI editing in LaTeX resume",
        description:
            "Use Plus or higher to unlock rewrite, fix, and chat with AI inside the LaTeX editor.",
        plan: "PLUS",
    },
    dsa_submit: {
        title: "Submit on hidden test cases",
        description:
            "Free users can run sample tests. Upgrade to run against hidden cases and submit officially.",
        plan: "PLUS",
    },
    resume_improve_ai: {
        title: "Improve resume with AI",
        description:
            "Turn ATS feedback into a tailored rewrite. Available on Plus, Pro, and Max.",
        plan: "PLUS",
    },
};

function accessibleByPlan(
    feature: LockedFeatureProps["feature"],
    plan: PlanKey
): boolean {
    switch (feature) {
        case "ai_tutor":
        case "latex_ai":
        case "resume_improve_ai":
            return plan !== "FREE";
        case "dsa_submit":
            return plan !== "FREE";
    }
}

export function LockedFeature({
    feature,
    children,
    title,
    description,
    compact = false,
}: LockedFeatureProps) {
    const { snapshot, loading } = useBilling();
    const [upgradeOpen, setUpgradeOpen] = useState(false);

    if (loading) return <>{children}</>;
    if (!snapshot) return <>{children}</>;

    if (accessibleByPlan(feature, snapshot.plan)) {
        return <>{children}</>;
    }

    const copy = FEATURE_COPY[feature];
    const heading = title ?? copy.title;
    const desc = description ?? copy.description;
    const isButtonLike = compact || feature === "dsa_submit";

    return (
        <div className="relative h-full">
            <div className="pointer-events-none select-none opacity-50 blur-[1.5px] grayscale-[0.3] h-full">
                {children}
            </div>
            <button
                type="button"
                onClick={() => setUpgradeOpen(true)}
                className={`absolute inset-0 flex items-center justify-center cursor-pointer group ${
                    isButtonLike ? "rounded-lg bg-gradient-to-br from-amber-500/5 to-orange-500/5" : "bg-gradient-to-br from-amber-500/5 via-transparent to-orange-500/5 p-4"
                }`}
                aria-label={heading}
            >
                {!isButtonLike && (
                    <span
                        className={`relative overflow-hidden rounded-2xl border border-amber-300/60 bg-white/95 text-left shadow-2xl shadow-amber-500/10 backdrop-blur-md transition-transform duration-300 group-hover:-translate-y-0.5 dark:border-amber-400/30 dark:bg-lc-surface/95 dark:shadow-amber-400/5 ${
                            compact ? "max-w-xs p-4" : "max-w-sm p-5"
                        }`}
                    >
                        <span className="pointer-events-none absolute inset-0 bg-gradient-to-br from-amber-500/5 via-transparent to-orange-500/5" />
                        <span className="relative flex items-start gap-3">
                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-lg shadow-amber-500/30">
                                <span className="material-symbols-outlined text-[20px]">workspace_premium</span>
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className="block text-sm font-bold text-neutral-900 dark:text-white font-nunito">
                                    {heading}
                                </span>
                                <span className="mt-1 block text-xs leading-relaxed text-neutral-600 dark:text-slate-300">
                                    {desc}
                                </span>
                                <span className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 px-3 py-1.5 text-xs font-bold text-white shadow-md shadow-amber-500/30 transition-all group-hover:shadow-lg group-hover:shadow-amber-500/40">
                                    Upgrade plan
                                    <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                                </span>
                            </span>
                        </span>
                    </span>
                )}
                {isButtonLike && (
                    <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300/60 bg-gradient-to-r from-amber-500 to-orange-500 px-3 py-1.5 text-[11px] font-bold text-white shadow-lg shadow-amber-500/30 transition-all group-hover:-translate-y-0.5 group-hover:shadow-xl group-hover:shadow-amber-500/40">
                        <span className="material-symbols-outlined text-[13px]">workspace_premium</span>
                        Upgrade
                    </span>
                )}
            </button>
            <UpgradeModal
                open={upgradeOpen}
                onClose={() => setUpgradeOpen(false)}
                feature={feature}
                title={heading}
                description={desc}
                currentPlan={snapshot.plan}
                currentSubscriptionId={snapshot.subscriptionId ?? undefined}
                reason="locked"
            />
        </div>
    );
}
