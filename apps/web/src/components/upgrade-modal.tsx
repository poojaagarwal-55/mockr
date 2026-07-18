"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { ClockIcon } from "@/components/icons/clock-icon";
import {
    INTERVIEW_MINUTE_PACKS,
    PLAN_ENTITLEMENTS,
    PLANS,
    type PlanKey,
    type BillingCycle,
} from "@interviewforge/shared";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { api, ApiError } from "@/lib/api";

declare global {
    interface Window {
        Razorpay?: any;
    }
}

const RAZORPAY_CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

// Razorpay plan IDs per (plan, cycle)
const RAZORPAY_PLAN_IDS: Record<Exclude<PlanKey, "FREE">, Record<BillingCycle, string>> = {
    PLUS: {
        MONTHLY: process.env.NEXT_PUBLIC_RZP_PLAN_PLUS_MONTHLY || "plan_SiWJjLyj75g4BD",
        QUARTERLY: process.env.NEXT_PUBLIC_RZP_PLAN_PLUS_QUARTERLY || "plan_SiWN2A8Fl8pQAE",
    },
    PRO: {
        MONTHLY: process.env.NEXT_PUBLIC_RZP_PLAN_PRO_MONTHLY || "plan_SiWK2gDGnBLAF8",
        QUARTERLY: process.env.NEXT_PUBLIC_RZP_PLAN_PRO_QUARTERLY || "plan_SiWNQmoWu4bnFx",
    },
    MAX: {
        MONTHLY: process.env.NEXT_PUBLIC_RZP_PLAN_MAX_MONTHLY || "plan_SiWKKKOyaMk0XU",
        QUARTERLY: process.env.NEXT_PUBLIC_RZP_PLAN_MAX_QUARTERLY || "plan_SiWNm7VtL8nzbN",
    },
};

// Razorpay script loader
let razorpayLoaderPromise: Promise<void> | null = null;

async function ensureRazorpayLoaded(): Promise<void> {
    if (typeof window === "undefined") {
        return;
    }
    if (window.Razorpay) {
        return;
    }

    if (!razorpayLoaderPromise) {
        razorpayLoaderPromise = new Promise((resolve, reject) => {
            const existing = document.querySelector<HTMLScriptElement>(
                `script[src="${RAZORPAY_CHECKOUT_SRC}"]`
            );

            if (existing) {
                existing.addEventListener("load", () => resolve(), { once: true });
                existing.addEventListener(
                    "error",
                    () => {
                        razorpayLoaderPromise = null;
                        reject(new Error("Failed to load Razorpay checkout script"));
                    },
                    { once: true }
                );
                return;
            }

            const script = document.createElement("script");
            script.src = RAZORPAY_CHECKOUT_SRC;
            script.async = true;
            script.onload = () => resolve();
            script.onerror = () => {
                razorpayLoaderPromise = null;
                reject(new Error("Failed to load Razorpay checkout script"));
            };
            document.head.appendChild(script);
        });
    }

    return razorpayLoaderPromise;
}

export type UpgradeFeature =
    | "ai_tutor"
    | "latex_ai"
    | "dsa_submit"
    | "resume_improve_ai"
    | "interview_minutes";

type UpgradeModalProps = {
    open: boolean;
    onClose: () => void;
    feature: UpgradeFeature;
    title?: string;
    description?: string;
    reason?: "locked" | "minutes" | "tokens" | "limit";
    currentPlan?: PlanKey;
    showMinutePacks?: boolean;
    currentSubscriptionId?: string;
};

const DEFAULT_COPY: Record<UpgradeFeature, { title: string; description: string }> = {
    ai_tutor: {
        title: "AI Tutor is a Premium feature",
        description:
            "Get coaching, practice plans, and targeted follow-ups from your interview reports.",
    },
    latex_ai: {
        title: "Unlock LaTeX AI",
        description:
            "Rewrite, fix, and polish your resume directly inside the LaTeX editor.",
    },
    dsa_submit: {
        title: "Submit hidden test cases",
        description:
            "Run official submissions against hidden cases and track accepted solutions.",
    },
    resume_improve_ai: {
        title: "Improve your resume with AI",
        description:
            "Turn resume feedback into focused rewrites and stronger bullet points.",
    },
    interview_minutes: {
        title: "Add interview minutes",
        description:
            "Start more mock interviews by upgrading your monthly plan or buying minutes.",
    },
};

export const UPGRADE_ERROR_CODES = new Set([
    "FEATURE_LOCKED",
    "FEATURE_LIMIT_REACHED",
    "TOKEN_LIMIT_REACHED",
    "INSUFFICIENT_CREDITS",
    "DSA_SUBMIT_LOCKED",
    "HOURLY_SUBMIT_LIMIT",
]);

export function shouldShowUpgradeForError(value: unknown): boolean {
    if (!value) return false;
    if (typeof value === "object") {
        const maybe = value as { error?: unknown; code?: unknown; message?: unknown };
        const code = typeof maybe.error === "string" ? maybe.error : maybe.code;
        if (typeof code === "string" && UPGRADE_ERROR_CODES.has(code)) return true;
        if (typeof maybe.message === "string") return shouldShowUpgradeForError(maybe.message);
        return false;
    }
    if (typeof value !== "string") return false;

    for (const code of UPGRADE_ERROR_CODES) {
        if (value.includes(code)) return true;
    }

    return /upgrade|not included|token limit|used all|not enough (credits|minutes)|insufficient (credits|minutes)|hidden test cases|limit of \d+/i.test(value);
}

export function copyFromUpgradeError(value: unknown): string | undefined {
    if (!value) return undefined;
    if (typeof value === "object") {
        const maybe = value as { message?: unknown; error?: unknown };
        if (typeof maybe.message === "string") return maybe.message;
        if (typeof maybe.error === "string" && !UPGRADE_ERROR_CODES.has(maybe.error)) {
            return maybe.error;
        }
    }
    if (typeof value === "string") {
        const cleaned = value.replace(/^Stream failed \(\d+\):\s*/, "").trim();
        try {
            const parsed = JSON.parse(cleaned || value);
            return copyFromUpgradeError(parsed);
        } catch {
            return cleaned || undefined;
        }
    }
    return undefined;
}

export function UpgradeModal({
    open,
    onClose,
    feature,
    title,
    description,
    reason = "locked",
    currentPlan = "FREE",
    showMinutePacks = false,
    currentSubscriptionId,
}: UpgradeModalProps) {
    const [cycle, setCycle] = useState<BillingCycle>("MONTHLY");
    const [minuteProcessing, setMinuteProcessing] = useState<string | null>(null);
    const [planProcessing, setPlanProcessing] = useState<PlanKey | null>(null);
    const [user, setUser] = useState<{ email?: string; fullName?: string } | null>(null);
    const [session, setSession] = useState<{ access_token: string } | null>(null);

    // Load user session when modal opens
    useEffect(() => {
        if (open) {
            createSupabaseBrowserClient()
                .auth.getSession()
                .then(({ data }) => {
                    if (data.session) {
                        setSession({ access_token: data.session.access_token });
                        setUser({
                            email: data.session.user.email,
                            fullName: data.session.user.user_metadata?.full_name,
                        });
                    }
                });
        }
    }, [open]);

    const handleBuyMinutes = async (packId: string) => {
        if (!session?.access_token) {
            alert("Please sign in to purchase interview minutes");
            return;
        }

        setMinuteProcessing(packId);
        try {
            const order = await api.post<{
                orderId: string;
                amount: number;
                minutes: number;
            }>("/billing/credits/order", { packId }, session.access_token);

            await ensureRazorpayLoaded();

            const options = {
                key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
                order_id: order.orderId,
                amount: order.amount,
                currency: "INR",
                name: "Mockr",
                description: `${order.minutes} interview minutes`,
                prefill: { email: user?.email, name: user?.fullName },
                theme: { color: "#f59e0b" },
                handler: async (response: any) => {
                    try {
                        const verifyPayload = {
                            razorpay_order_id: response.razorpay_order_id,
                            razorpay_payment_id: response.razorpay_payment_id,
                            razorpay_signature: response.razorpay_signature,
                        };

                        await api.post(
                            "/billing/credits/verify",
                            verifyPayload,
                            session.access_token
                        );

                        alert(`Added ${order.minutes} interview minutes to your wallet!`);
                        onClose(); // Close modal after successful purchase
                    } catch (err) {
                        alert(
                            err instanceof ApiError
                                ? err.message
                                : "Verification failed. Please contact support."
                        );
                    } finally {
                        setMinuteProcessing(null);
                    }
                },
                modal: {
                    ondismiss: () => setMinuteProcessing(null),
                },
            };

            if (!window.Razorpay) {
                alert("Razorpay is still loading. Please wait a moment and try again.");
                setMinuteProcessing(null);
                return;
            }
            new window.Razorpay(options).open();
        } catch (err) {
            alert(err instanceof ApiError ? err.message : "Could not start purchase");
            setMinuteProcessing(null);
        }
    };

    const handleSubscribe = async (plan: Exclude<PlanKey, "FREE">) => {
        if (!session?.access_token) {
            alert("Please sign in to subscribe");
            return;
        }

        const hasActiveSubscription = currentSubscriptionId && currentPlan !== "FREE";

        if (hasActiveSubscription) {
            // Determine if upgrade or downgrade
            const planOrder: Record<PlanKey, number> = { FREE: 0, PLUS: 1, PRO: 2, MAX: 3 };
            const isUpgrade = planOrder[plan] > planOrder[currentPlan];

            if (isUpgrade) {
                await handleUpgrade(plan);
            } else {
                alert("Downgrades are scheduled for the end of your billing period. Please visit the billing page to manage your subscription.");
            }
            return;
        }

        // New subscription flow (for FREE users)
        setPlanProcessing(plan);
        try {
            const razorpayPlanId = RAZORPAY_PLAN_IDS[plan][cycle];
            if (!razorpayPlanId) {
                alert(`${plan} ${cycle} is not configured yet. Please contact support.`);
                setPlanProcessing(null);
                return;
            }

            const resp = await api.post<{ subscriptionId: string; amount: number }>(
                "/billing/subscribe",
                { plan, cycle, razorpayPlanId },
                session.access_token
            );

            await ensureRazorpayLoaded();

            const options = {
                key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
                subscription_id: resp.subscriptionId,
                name: "Mockr",
                description: `${plan} plan (${cycle.toLowerCase()})`,
                prefill: {
                    email: user?.email,
                    name: user?.fullName,
                },
                theme: { color: "#f59e0b" },
                handler: async (response: any) => {
                    try {
                        const verifyPayload = {
                            razorpay_payment_id: response.razorpay_payment_id,
                            razorpay_subscription_id: response.razorpay_subscription_id,
                            razorpay_signature: response.razorpay_signature,
                        };

                        await api.post(
                            "/billing/subscribe/verify",
                            verifyPayload,
                            session.access_token
                        );

                        alert(`Welcome to ${plan}!`);
                        onClose(); // Close modal after successful subscription
                    } catch (err) {
                        alert(
                            err instanceof ApiError
                                ? err.message
                                : "Verification failed. Please contact support."
                        );
                    } finally {
                        setPlanProcessing(null);
                    }
                },
                modal: {
                    ondismiss: () => setPlanProcessing(null),
                },
            };

            if (!window.Razorpay) {
                alert("Razorpay is still loading. Please wait a moment and try again.");
                setPlanProcessing(null);
                return;
            }
            const rzp = new window.Razorpay(options);
            rzp.open();
        } catch (err) {
            alert(err instanceof ApiError ? err.message : "Subscription failed");
            setPlanProcessing(null);
        }
    };

    const handleUpgrade = async (targetPlan: Exclude<PlanKey, "FREE">) => {
        if (!session?.access_token || !currentSubscriptionId) return;

        setPlanProcessing(targetPlan);

        try {
            // Step 1: Calculate prorated amount
            const calcResponse = await api.post(
                "/billing/upgrade/calculate",
                {
                    subscriptionId: currentSubscriptionId,
                    targetPlan,
                    targetCycle: cycle,
                },
                session.access_token
            );

            const { calculation } = calcResponse as any;

            // Step 2: Create upgrade order
            const orderResponse = await api.post(
                "/billing/upgrade/order",
                {
                    subscriptionId: currentSubscriptionId,
                    targetPlan,
                    targetCycle: cycle,
                },
                session.access_token
            );

            const { orderId, amount } = orderResponse as any;

            // Step 3: Show Razorpay checkout
            await ensureRazorpayLoaded();

            const options = {
                key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
                amount: amount,
                currency: "INR",
                name: "Mockr",
                description: `Upgrade to ${targetPlan} (Prorated for ${calculation.remainingDays} days)`,
                order_id: orderId,
                method: {
                    netbanking: true,
                    card: true,
                    wallet: true,
                    upi: true,
                    paylater: true,
                },
                handler: async function (response: any) {
                    try {
                        await api.post(
                            "/billing/upgrade/verify",
                            {
                                razorpay_order_id: response.razorpay_order_id,
                                razorpay_payment_id: response.razorpay_payment_id,
                                razorpay_signature: response.razorpay_signature,
                            },
                            session.access_token
                        );

                        alert(`Successfully upgraded to ${targetPlan}!`);
                        onClose(); // Close modal after successful upgrade
                    } catch (error) {
                        alert("Payment verification failed. Please contact support.");
                    } finally {
                        setPlanProcessing(null);
                    }
                },
                prefill: {
                    email: user?.email,
                    name: user?.fullName,
                },
                theme: { color: "#f59e0b" },
                modal: {
                    ondismiss: function () {
                        setPlanProcessing(null);
                    },
                },
            };

            const rzp = new window.Razorpay(options);
            rzp.open();
        } catch (error) {
            alert(error instanceof ApiError ? error.message : "Failed to process upgrade");
            setPlanProcessing(null);
        }
    };
    
    if (!open) return null;

    const copy = DEFAULT_COPY[feature];
    const heading = title ?? reasonTitle(reason, copy.title);
    const body = description ?? reasonDescription(reason, copy.description);

    return (
        <div className="fixed inset-0 z-[500] flex items-center justify-center bg-neutral-950/50 dark:bg-black/50 backdrop-blur-sm animate-in fade-in duration-300 p-4">
            <div className="relative max-h-[92vh] w-full max-w-7xl overflow-y-auto rounded-3xl border border-neutral-200 bg-white shadow-2xl dark:border-lc-border dark:bg-lc-surface">
                <button
                    type="button"
                    onClick={onClose}
                    className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-xl text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-lc-hover dark:hover:text-white"
                    aria-label="Close upgrade plans"
                >
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>

                <div className="px-8 pb-6 pt-8">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-8">
                        <div className="max-w-2xl">
                            <h2 className="text-3xl font-bold text-neutral-900 dark:text-white tracking-tight mb-3">
                                {heading}
                            </h2>
                            <p className="text-base text-neutral-600 dark:text-neutral-300">
                                {body}
                            </p>
                        </div>
                        <div className="rounded-xl bg-neutral-50 dark:bg-neutral-800/80 px-6 py-3 border border-neutral-100 dark:border-neutral-700/50">
                            <p className="text-xs font-bold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                                Current plan
                            </p>
                            <p className="mt-1 text-xl font-bold text-neutral-900 dark:text-white">
                                {PLAN_ENTITLEMENTS[currentPlan].displayName}
                            </p>
                        </div>
                    </div>

                    {process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID?.startsWith('rzp_test_') && (
                        <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 dark:border-blue-400/20 dark:bg-blue-400/10">
                            <div className="flex items-start gap-2">
                                <span className="text-blue-600 dark:text-blue-400">ℹ️</span>
                                <div className="flex-1">
                                    <p className="text-sm font-bold text-blue-800 dark:text-blue-200">🧪 Test Mode Active</p>
                                    <p className="mt-1 text-xs text-blue-700 dark:text-blue-300">
                                        Use Razorpay test card: <code className="rounded bg-blue-100 px-1 py-0.5 font-mono dark:bg-blue-900/30">4100 2800 0000 1007</code> (Visa) with any CVV and future expiry.
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Interview Minute Packs Section */}
                    {showMinutePacks && (
                        <div className="mb-8">
                            <div className="flex items-center gap-3 mb-6">
                                <ClockIcon size={24} className="text-slate-500 dark:text-slate-400" />
                                <h3 className="text-xl font-bold text-neutral-900 dark:text-white">
                                    Buy interview minutes
                                </h3>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                                {INTERVIEW_MINUTE_PACKS.map((pack) => (
                                    <button
                                        key={pack.id}
                                        onClick={() => handleBuyMinutes(pack.id)}
                                        disabled={minuteProcessing === pack.id}
                                        className="group relative bg-gradient-to-br from-blue-200 via-blue-100 to-cyan-100 dark:from-blue-950 dark:via-blue-900 dark:to-blue-800 rounded-2xl p-4 text-left transition-all duration-300 ease-out hover:-translate-y-1.5 shadow-[0_8px_20px_-6px_rgba(59,130,246,0.3)] hover:shadow-[0_20px_40px_-10px_rgba(59,130,246,0.4)] disabled:opacity-60 disabled:cursor-not-allowed"
                                    >
                                        <div className="flex items-center gap-2 mb-3">
                                            <ClockIcon size={28} className="text-slate-600 dark:text-slate-300 transition-transform duration-300 group-hover:scale-110 group-hover:rotate-12" />
                                            <div className="text-xl font-bold text-neutral-900 dark:text-white">
                                                {pack.minutes}
                                            </div>
                                            <span className="text-xs text-neutral-600 dark:text-neutral-400">
                                                minutes
                                            </span>
                                        </div>
                                        <div className="mb-3">
                                            <span className="text-2xl font-bold text-neutral-900 dark:text-white">
                                                ₹{pack.priceInr}
                                            </span>
                                        </div>
                                        <div className="w-full py-2 rounded-2xl bg-gradient-to-r from-blue-900 to-blue-700 hover:from-blue-800 hover:to-blue-600 text-white text-sm font-semibold text-center transition-all duration-300 group-hover:shadow-lg">
                                            {minuteProcessing === pack.id ? (
                                                <span className="flex items-center justify-center gap-2">
                                                    <span className="inline-block h-3 w-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                                    Processing...
                                                </span>
                                            ) : (
                                                "Buy Now"
                                            )}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Billing Cycle Toggle */}
                    <div className="flex justify-center mb-8">
                        <div className="inline-flex items-center gap-1 rounded-full border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-1 shadow-sm">
                            <button
                                onClick={() => setCycle("MONTHLY")}
                                className={`px-4 py-1.5 text-sm font-medium rounded-full transition-colors ${
                                    cycle === "MONTHLY"
                                        ? "text-white"
                                        : "text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200"
                                }`}
                                style={cycle === "MONTHLY" ? { backgroundColor: "lab(33 72.83 -111.39)" } : {}}
                            >
                                Monthly
                            </button>
                            <button
                                onClick={() => setCycle("QUARTERLY")}
                                className={`px-4 py-1.5 text-sm font-medium rounded-full transition-colors ${
                                    cycle === "QUARTERLY"
                                        ? "text-white"
                                        : "text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200"
                                }`}
                                style={cycle === "QUARTERLY" ? { backgroundColor: "lab(33 72.83 -111.39)" } : {}}
                            >
                                Quarterly
                                <span className="ml-1.5 text-[10px] font-bold text-amber-600 dark:text-amber-400">
                                    SAVE 20%
                                </span>
                            </button>
                        </div>
                    </div>

                    {/* Plan Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 mb-6">
                        {PLANS.map((plan) => (
                            <ModalPlanCard
                                key={plan}
                                plan={plan as PlanKey}
                                cycle={cycle}
                                current={currentPlan === plan}
                                currentPlan={currentPlan}
                                processing={planProcessing === plan}
                                onSubscribe={() => plan !== "FREE" && handleSubscribe(plan as Exclude<PlanKey, "FREE">)}
                            />
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}


function reasonTitle(reason: NonNullable<UpgradeModalProps["reason"]>, fallback: string) {
    switch (reason) {
        case "minutes":
            return "You are out of interview minutes";
        case "tokens":
            return "Monthly AI tokens used";
        case "limit":
            return "Plan limit reached";
        case "locked":
        default:
            return fallback;
    }
}

function reasonDescription(reason: NonNullable<UpgradeModalProps["reason"]>, fallback: string) {
    switch (reason) {
        case "minutes":
            return "Add minutes or upgrade to a monthly plan to keep practicing without losing momentum.";
        case "tokens":
            return "Your current plan has reached its monthly AI token budget. Upgrade for a larger monthly allowance.";
        case "limit":
            return "This action is limited on your current plan. Upgrade to unlock a higher allowance.";
        case "locked":
        default:
            return fallback;
    }
}

function ModalPlanCard({
    plan,
    cycle,
    current,
    currentPlan,
    processing,
    onSubscribe,
}: {
    plan: PlanKey;
    cycle: BillingCycle;
    current: boolean;
    currentPlan: PlanKey;
    processing: boolean;
    onSubscribe: () => void;
}) {
    const ent = PLAN_ENTITLEMENTS[plan];
    const isFree = plan === "FREE";
    const price = cycle === "MONTHLY" ? ent.priceInrMonthly : ent.priceInrQuarterlyPerMonth;

    const cardStyles = useMemo(() => {
        switch (plan) {
            case "FREE":
                return {
                    background: "bg-gradient-to-br from-white via-neutral-50 to-green-50/30 dark:from-neutral-800 dark:via-neutral-800 dark:to-green-900/20",
                    button: "bg-neutral-200 text-neutral-600 hover:bg-neutral-300 dark:bg-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-600",
                };
            case "PLUS":
                return {
                    background: "bg-gradient-to-br from-blue-200 via-cyan-100 to-blue-100 dark:from-blue-900/40 dark:via-blue-800/30 dark:to-cyan-900/40",
                    button: "bg-gradient-to-r from-blue-400 to-cyan-400 text-white font-bold shadow-lg shadow-blue-400/40 hover:shadow-xl hover:shadow-blue-400/60 transition-all duration-300 hover:scale-[1.02]",
                };
            case "PRO":
                return {
                    background: "bg-gradient-to-br from-amber-200 via-yellow-100 to-amber-100 dark:from-amber-900/40 dark:via-amber-800/30 dark:to-yellow-900/40",
                    button: "bg-gradient-to-r from-amber-500 to-orange-500 text-white font-bold shadow-lg shadow-amber-500/40 hover:shadow-xl hover:shadow-amber-500/60 transition-all duration-300 hover:scale-[1.02]",
                    bestValue: true,
                };
            case "MAX":
                return {
                    background: "bg-gradient-to-br from-purple-200 via-pink-100 to-purple-100 dark:from-purple-900/40 dark:via-purple-800/30 dark:to-pink-900/40",
                    button: "bg-gradient-to-r from-purple-500 to-pink-500 text-white font-bold shadow-lg shadow-purple-500/40 hover:shadow-xl hover:shadow-purple-500/60 transition-all duration-300 hover:scale-[1.02]",
                };
        }
    }, [plan]);

    return (
        <div className="group/card relative rounded-2xl transition-all duration-500 ease-out hover:-translate-y-1 hover:scale-[1.025] hover:z-10 h-full">
            {/* Best Value Badge */}
            {cardStyles.bestValue && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 text-white text-xs font-bold uppercase tracking-wider shadow-lg z-20">
                    Best Value
                </div>
            )}

            <div
                className={`relative rounded-2xl p-5 flex flex-col h-full transition-all duration-500 ${cardStyles.background}`}
                style={{
                    boxShadow: '0 20px 50px -12px rgba(0, 0, 0, 0.25), 0 10px 20px -8px rgba(0, 0, 0, 0.3)',
                }}
            >
                {/* Plan Name */}
                <h3 className="text-4xl font-black text-neutral-900 dark:text-white mb-3">
                    {ent.displayName}
                </h3>

                {/* Description */}
                <p className="text-sm text-neutral-700 dark:text-neutral-200 mb-3 min-h-[32px] font-medium">
                    {plan === "FREE" && "Start practicing with basic access"}
                    {plan === "PLUS" && "For regular practice and resume improvement"}
                    {plan === "PRO" && "Best for placement preparation"}
                    {plan === "MAX" && "For power users and heavy preparation"}
                </p>

                {/* Price */}
                <div className="mb-4">
                    <div className="flex items-baseline gap-1">
                        <span className="text-4xl font-bold text-neutral-900 dark:text-white">
                            {isFree ? "₹0" : `₹${price}`}
                        </span>
                        {!isFree && (
                            <span className="text-base text-neutral-600 dark:text-neutral-300 font-medium">/mo</span>
                        )}
                    </div>
                    {!isFree && cycle === "QUARTERLY" && (
                        <div className="text-sm text-neutral-600 dark:text-neutral-300 mt-0.5 font-medium">
                            Billed ₹{price * 3} quarterly
                        </div>
                    )}
                </div>

                {/* Features */}
                <ul className="space-y-2 text-[15px] text-neutral-800 dark:text-neutral-200 mb-5 flex-1 font-medium">
                    <Feature
                        text={
                            isFree
                                ? `60 interview minutes (one-time)`
                                : `${ent.monthlyInterviewMinutes} interview minutes / month`
                        }
                    />
                    <Feature
                        text={
                            ent.resumeAnalysisPerMonth === 0
                                ? "Resume analysis / month"
                                : `${ent.resumeAnalysisPerMonth} resume analyses / month`
                        }
                        included={ent.resumeAnalysisPerMonth > 0}
                    />
                    <Feature
                        included={ent.resumeImproveAiPerMonth > 0}
                        text={
                            ent.resumeImproveAiPerMonth > 0
                                ? `${ent.resumeImproveAiPerMonth} resume improve-with-AI / month`
                                : "Resume improve-with-AI / month"
                        }
                    />
                    <Feature text="Resume builder" included={ent.resumeBuilderAccess} />
                    <Feature
                        included={ent.latexAiAccess}
                        text={
                            ent.latexAiAccess
                                ? `AI in LaTeX editor (${Math.round(ent.latexAiMonthlyTokens / 1000)}k tokens)`
                                : "AI in LaTeX editor"
                        }
                    />
                    <Feature
                        included={ent.aiTutorAccess}
                        text={
                            ent.aiTutorAccess
                                ? `AI tutor (${Math.round(ent.aiTutorMonthlyTokens / 1000)}k tokens)`
                                : "AI tutor"
                        }
                    />
                    <Feature
                        included={ent.dsaSubmitAccess !== "none"}
                        text={
                            ent.dsaSubmitAccess === "none"
                                ? "DSA submit — limited hidden tests"
                                : ent.dsaSubmitAccess === "limited"
                                ? `DSA submit — limited hidden tests`
                                : "DSA submit — all hidden tests"
                        }
                    />
                </ul>

                {/* Action Button */}
                {current ? (
                    <button
                        disabled
                        className="w-full py-2.5 rounded-xl text-base font-bold bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 border-2 border-neutral-200 dark:border-neutral-700/50 cursor-default"
                    >
                        Current plan
                    </button>
                ) : isFree ? (
                    <button
                        disabled
                        className="w-full py-2.5 rounded-xl text-base font-bold bg-neutral-50 dark:bg-neutral-800/40 text-neutral-500 dark:text-neutral-500 cursor-default"
                    >
                        Default
                    </button>
                ) : (
                    <button
                        onClick={onSubscribe}
                        disabled={processing}
                        className={`relative z-20 overflow-hidden w-full py-3 rounded-xl text-sm transition-all duration-200 ${cardStyles.button} text-center disabled:opacity-60 disabled:cursor-not-allowed`}
                    >
                        {processing ? (
                            <span className="relative z-10 flex items-center justify-center gap-2">
                                <span className="inline-block h-3 w-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                Processing...
                            </span>
                        ) : (
                            <span className="relative z-10">Upgrade to {ent.displayName}</span>
                        )}
                    </button>
                )}
            </div>
        </div>
    );
}

function Feature({ text, included = true }: { text: string; included?: boolean }) {
    return (
        <li className="flex items-start gap-2">
            {included ? (
                <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 shrink-0"
                    stroke="currentColor"
                    strokeWidth="2.5"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
            ) : (
                <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    className="h-4 w-4 text-neutral-300 dark:text-neutral-600 mt-0.5 shrink-0"
                    stroke="currentColor"
                    strokeWidth="2.5"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
            )}
            <span className={included ? "" : "text-neutral-400 dark:text-neutral-600 line-through"}>
                {text}
            </span>
        </li>
    );
}
