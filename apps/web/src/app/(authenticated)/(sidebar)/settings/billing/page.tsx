"use client";

import { PageHeader } from "@/components/page-header";
import { ClockIcon } from "@/components/icons/clock-icon";
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useAuth } from "@/context/auth-context";
import { useBilling } from "@/hooks/use-billing";
import { api, ApiError } from "@/lib/api";
import party from "party-js";
import {
    PLANS,
    PLAN_ENTITLEMENTS,
    type PlanKey,
    type BillingCycle,
} from "@interviewforge/shared";

// Razorpay plan IDs per (plan, cycle). Populate from env or dashboard.
// Fallbacks kept for the two existing PLUS plans.
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

declare global {
    interface Window {
        Razorpay?: any;
    }
}

const RAZORPAY_CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";
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

    await razorpayLoaderPromise;
}

// ── Celebration Modal ──────────────────────────────────────────
function CouponCelebration({
    plan,
    expiresAt,
    onClose,
}: {
    plan: string;
    expiresAt: string;
    onClose: () => void;
}) {
    const modalRef = useRef<HTMLDivElement>(null);

    // Check if "indefinite" (expiresAt > 10 years from now)
    const isLifetime = useMemo(() => {
        const exp = new Date(expiresAt);
        const tenYears = new Date();
        tenYears.setFullYear(tenYears.getFullYear() + 10);
        return exp > tenYears;
    }, [expiresAt]);

    const displayPlan = PLAN_ENTITLEMENTS[plan as PlanKey]?.displayName ?? plan;

    // Plan-specific colors matching the pricing cards
    const planColors: Record<string, string> = {
        FREE: "text-green-600",
        PLUS: "text-blue-600",
        PRO: "text-orange-600",
        MAX: "text-purple-600",
    };

    const planColor = planColors[plan as string] || "text-blue-600";

    useEffect(() => {
        // Fire confetti from the modal
        if (modalRef.current) {
            party.confetti(modalRef.current, {
                count: party.variation.range(60, 150),
                size: party.variation.range(0.8, 1.4),
            });
        }
    }, []);

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-neutral-950/50 dark:bg-black/50 backdrop-blur-sm animate-in fade-in duration-300">
            <div
                ref={modalRef}
                className="relative mx-4 w-full max-w-md rounded-3xl bg-white dark:bg-lc-surface border border-neutral-200 dark:border-lc-border shadow-2xl p-8 text-center"
            >
                {/* Emoji burst */}
                <div className="text-6xl mb-4">🎉</div>

                <h2 className="text-2xl font-extrabold text-neutral-900 dark:text-white font-nunito tracking-tight">
                    Congratulations!
                </h2>

                <p className="mt-3 text-base text-neutral-600 dark:text-neutral-300">
                    {isLifetime ? (
                        <>
                            You've unlocked <span className={`font-bold ${planColor}`}>{displayPlan}</span> with{" "}
                            <span className="font-bold text-emerald-600">lifetime access</span>!
                        </>
                    ) : (
                        <>
                            You've unlocked <span className={`font-bold ${planColor}`}>{displayPlan}</span> until{" "}
                            <span className="font-semibold">{new Date(expiresAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}</span>!
                        </>
                    )}
                </p>

                <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
                    Enjoy premium features and extra interview minutes
                </p>

                <button
                    onClick={onClose}
                    className="mt-6 w-full rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white py-3 text-sm font-bold shadow-lg shadow-blue-500/20 transition-all"
                >
                    Let's go!
                </button>
            </div>
        </div>
    );
}

export default function BillingPage() {
    useEffect(() => {
        document.title = "Billing | Mockr";
        
        // Add gradient animation keyframes
        const style = document.createElement('style');
        style.textContent = `
            @keyframes gradient-shift {
                0%, 100% {
                    background-position: 0% 50%;
                }
                50% {
                    background-position: 100% 50%;
                }
            }
        `;
        document.head.appendChild(style);
        
        return () => {
            document.head.removeChild(style);
        };
    }, []);
    const { user, session } = useAuth();
    const { snapshot, refresh, loading: billingLoading } = useBilling();
    const [cycle, setCycle] = useState<BillingCycle>("MONTHLY");
    const [processing, setProcessing] = useState<string | null>(null);
    const [couponCode, setCouponCode] = useState("");
    const [couponMsg, setCouponMsg] = useState<{ ok: boolean; text: string } | null>(null);
    const [couponRedeeming, setCouponRedeeming] = useState(false);
    const [minuteProcessing, setMinuteProcessing] = useState<string | null>(null);
    const [showCouponModal, setShowCouponModal] = useState(false);

    // Celebration popup state
    const [celebration, setCelebration] = useState<{ plan: string; expiresAt: string } | null>(null);

    // Cancellation state
    const [showCancelModal, setShowCancelModal] = useState(false);
    const [cancelPreview, setCancelPreview] = useState<any>(null);
    const [cancelling, setCancelling] = useState(false);

    const currentPlan = snapshot?.plan ?? "FREE";

    const handleUpgrade = async (targetPlan: Exclude<PlanKey, "FREE">) => {
        if (!session?.access_token || !snapshot?.subscriptionId) return;
        
        console.log('🚀 Starting upgrade flow', {
            currentSubscriptionId: snapshot.subscriptionId,
            targetPlan,
            currentPlan,
            cycle,
        });
        
        setProcessing(targetPlan);
        
        try {
            // Step 1: Calculate prorated amount
            console.log('📊 Step 1: Calculating prorated amount...');
            const calcResponse = await api.post(
                "/billing/upgrade/calculate",
                {
                    subscriptionId: snapshot.subscriptionId,
                    targetPlan,
                    targetCycle: cycle, // Include the current billing cycle
                },
                session.access_token
            );
            
            console.log('✅ Upgrade calculation:', calcResponse);
            const { calculation } = calcResponse as any;
            
            // Step 2: Create upgrade order
            console.log('🎫 Step 2: Creating upgrade order...');
            const orderResponse = await api.post(
                "/billing/upgrade/order",
                {
                    subscriptionId: snapshot.subscriptionId,
                    targetPlan,
                    targetCycle: cycle, // Include the current billing cycle
                },
                session.access_token
            );
            
            console.log('✅ Order created:', orderResponse);
            const { orderId, amount } = orderResponse as any;
            
            console.log('💰 Razorpay amount (paise):', amount);
            console.log('💰 Razorpay amount (rupees):', amount / 100);
            console.log('💰 Expected prorated amount:', calculation.proratedAmount);
            console.log('💰 Remaining days:', calculation.remainingDays);
            
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
                    console.log('✅ Payment successful:', response);
                    try {
                        console.log('🔐 Step 4: Verifying payment...');
                        await api.post(
                            "/billing/upgrade/verify",
                            {
                                razorpay_order_id: response.razorpay_order_id,
                                razorpay_payment_id: response.razorpay_payment_id,
                                razorpay_signature: response.razorpay_signature,
                            },
                            session.access_token
                        );
                        
                        console.log('✅ Upgrade verified and applied');
                        await refresh();
                        alert(`Successfully upgraded to ${targetPlan}!`);
                        setProcessing(null);
                    } catch (error) {
                        console.error('❌ Verification error:', error);
                        alert('Payment verification failed. Please contact support.');
                        setProcessing(null);
                    }
                },
                prefill: {
                    email: user?.email,
                    name: user?.fullName,
                },
                theme: { color: "#f59e0b" },
                modal: {
                    ondismiss: function () {
                        console.log('⚠️ Payment modal dismissed by user');
                        setProcessing(null);
                    },
                },
            };
            
            const rzp = new window.Razorpay(options);
            rzp.open();
        } catch (error) {
            console.error('❌ Upgrade error:', error);
            alert(error instanceof ApiError ? error.message : 'Failed to process upgrade');
            setProcessing(null);
        }
    };
    
    const handleDowngrade = async (targetPlan: Exclude<PlanKey, "FREE">) => {
        if (!session?.access_token || !snapshot?.subscriptionId) return;
        
        console.log('⬇️ Starting downgrade flow', {
            currentSubscriptionId: snapshot.subscriptionId,
            targetPlan,
            currentPlan,
            cycle,
        });
        
        setProcessing(targetPlan);
        
        try {
            const response = await api.post(
                "/billing/downgrade/schedule",
                {
                    subscriptionId: snapshot.subscriptionId,
                    targetPlan,
                    targetCycle: cycle,
                },
                session.access_token
            );
            
            console.log('✅ Downgrade scheduled:', response);
            const data = response as any;
            
            // Show success message with details
            const periodEnd = snapshot.currentPeriodEnd 
                ? new Date(snapshot.currentPeriodEnd).toLocaleDateString('en-US', { 
                    month: 'long', 
                    day: 'numeric', 
                    year: 'numeric' 
                  })
                : 'the end of your billing period';
            
            alert(
                `✓ Downgrade Scheduled\n\n` +
                `Your plan will change from ${currentPlan} to ${targetPlan} on ${periodEnd}.\n\n` +
                `You'll continue to have full ${currentPlan} access until then.`
            );
            
            await refresh();
            setProcessing(null);
        } catch (error) {
            console.error('❌ Downgrade error:', error);
            const errorMessage = error instanceof ApiError ? error.message : 'Failed to schedule downgrade';
            
            // Check if it's already scheduled
            if (errorMessage.includes('already scheduled')) {
                alert('This downgrade is already scheduled. Refresh the page to see the current status.');
                await refresh();
            } else {
                alert(errorMessage);
            }
            setProcessing(null);
        }
    };

    const handleCancelDowngrade = async () => {
        if (!session?.access_token || !snapshot?.subscriptionId) return;
        
        console.log('🚫 Canceling downgrade', { 
            subscriptionId: snapshot.subscriptionId,
            scheduledPlan: snapshot.scheduledPlanChange,
        });
        
        setProcessing(snapshot.scheduledPlanChange as PlanKey);
        
        try {
            const response = await api.post(
                "/billing/downgrade/cancel",
                {
                    subscriptionId: snapshot.subscriptionId,
                },
                session.access_token
            );
            
            console.log('✅ Downgrade canceled:', response);
            alert('Downgrade canceled. You will remain on your current plan.');
            
            await refresh();
            setProcessing(null);
        } catch (error) {
            console.error('❌ Cancel downgrade error:', error);
            alert(error instanceof ApiError ? error.message : 'Failed to cancel downgrade');
            setProcessing(null);
        }
    };

    const fetchCancelPreview = async () => {
        if (!session?.access_token || !snapshot?.subscriptionId) return;
        
        try {
            const response = await api.get(
                `/billing/subscription/cancel-preview/${snapshot.subscriptionId}`,
                session.access_token
            );
            
            setCancelPreview(response);
            setShowCancelModal(true);
        } catch (error) {
            console.error('❌ Failed to fetch cancel preview:', error);
            alert(error instanceof ApiError ? error.message : 'Failed to load cancellation preview');
        }
    };

    const handleCancelSubscription = async () => {
        if (!session?.access_token || !snapshot?.subscriptionId) return;
        
        setCancelling(true);
        
        try {
            const response = await api.post(
                "/billing/subscription/cancel",
                {
                    subscriptionId: snapshot.subscriptionId,
                },
                session.access_token
            ) as { message?: string };
            
            console.log('✅ Subscription cancelled:', response);
            alert(response.message || 'Subscription cancelled successfully');
            
            setShowCancelModal(false);
            await refresh();
        } catch (error) {
            console.error('❌ Cancel subscription error:', error);
            alert(error instanceof ApiError ? error.message : 'Failed to cancel subscription');
        } finally {
            setCancelling(false);
        }
    };

    const handleSubscribe = async (plan: Exclude<PlanKey, "FREE">) => {
        if (!session?.access_token) return;
        
        // Check if this is a cancel downgrade request
        if (snapshot?.scheduledPlanChange === plan) {
            await handleCancelDowngrade();
            return;
        }
        
        // Check if this is an upgrade/downgrade or new subscription
        const hasActiveSubscription = snapshot?.subscriptionId && currentPlan !== "FREE";
        
        if (hasActiveSubscription) {
            console.log('[UPGRADE_START] User has active subscription, using upgrade flow', {
                currentPlan,
                targetPlan: plan,
                subscriptionId: snapshot?.subscriptionId,
            });
            
            // Determine if upgrade or downgrade
            const planOrder: Record<PlanKey, number> = { FREE: 0, PLUS: 1, PRO: 2, MAX: 3 };
            const isUpgrade = planOrder[plan] > planOrder[currentPlan];
            
            if (isUpgrade) {
                await handleUpgrade(plan);
            } else {
                await handleDowngrade(plan);
            }
            return;
        }
        
        // New subscription flow (for FREE users)
        console.log('[SUBSCRIPTION_START] Initiating subscription', { plan, cycle });

        setProcessing(plan);
        try {
            const razorpayPlanId = RAZORPAY_PLAN_IDS[plan][cycle];
            if (!razorpayPlanId) {
                console.error('[SUBSCRIPTION_START] Missing Razorpay plan ID', { plan, cycle });
                alert(`${plan} ${cycle} is not configured yet. Please contact support.`);
                setProcessing(null);
                return;
            }

            console.log('[SUBSCRIPTION_START] Creating subscription', { plan, cycle, razorpayPlanId });

            const resp = await api.post<{ subscriptionId: string; amount: number }>(
                "/billing/subscribe",
                { plan, cycle, razorpayPlanId },
                session.access_token
            );

            console.log('[SUBSCRIPTION_START] Subscription created', {
                subscriptionId: resp.subscriptionId,
                amount: resp.amount,
            });

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
                    console.log('[SUBSCRIPTION_VERIFY] Razorpay handler called', {
                        razorpay_payment_id: response.razorpay_payment_id,
                        razorpay_subscription_id: response.razorpay_subscription_id,
                        has_signature: !!response.razorpay_signature,
                        plan,
                        cycle,
                    });

                    try {
                        const verifyPayload = {
                            razorpay_payment_id: response.razorpay_payment_id,
                            razorpay_subscription_id: response.razorpay_subscription_id,
                            razorpay_signature: response.razorpay_signature,
                        };

                        console.log('[SUBSCRIPTION_VERIFY] Sending verification request', verifyPayload);

                        const verifyResponse = await api.post(
                            "/billing/subscribe/verify",
                            verifyPayload,
                            session.access_token
                        );

                        console.log('[SUBSCRIPTION_VERIFY] Verification successful', verifyResponse);

                        await refresh();
                        alert(`Welcome to ${plan}!`);
                    } catch (err) {
                        console.error('[SUBSCRIPTION_VERIFY] Verification failed', {
                            error: err,
                            message: err instanceof ApiError ? err.message : 'Unknown error',
                        });

                        alert(
                            err instanceof ApiError
                                ? err.message
                                : "Verification failed. Please contact support."
                        );
                    } finally {
                        setProcessing(null);
                    }
                },
                modal: {
                    ondismiss: () => setProcessing(null),
                },
            };

            if (!window.Razorpay) {
                alert("Razorpay is still loading. Please wait a moment and try again.");
                setProcessing(null);
                return;
            }
            const rzp = new window.Razorpay(options);
            rzp.open();
        } catch (err) {
            alert(err instanceof ApiError ? err.message : "Subscription failed");
            setProcessing(null);
        }
    };

    const handleBuyMinutes = async (packId: string) => {
        if (!session?.access_token) return;
        console.log('[MINUTE_START] Initiating minute purchase', { packId });

        setMinuteProcessing(packId);
        try {
            console.log('[MINUTE_START] Creating order', { packId });

            const order = await api.post<{
                orderId: string;
                amount: number;
                minutes: number;
            }>("/billing/credits/order", { packId }, session.access_token);

            console.log('[MINUTE_START] Order created', {
                orderId: order.orderId,
                amount: order.amount,
                minutes: order.minutes,
            });

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
                    console.log('[MINUTE_VERIFY] Razorpay handler called', {
                        razorpay_order_id: response.razorpay_order_id,
                        razorpay_payment_id: response.razorpay_payment_id,
                        has_signature: !!response.razorpay_signature,
                        packId,
                        minutes: order.minutes,
                    });

                    try {
                        const verifyPayload = {
                            razorpay_order_id: response.razorpay_order_id,
                            razorpay_payment_id: response.razorpay_payment_id,
                            razorpay_signature: response.razorpay_signature,
                        };

                        console.log('[MINUTE_VERIFY] Sending verification request', verifyPayload);

                        const verifyResponse = await api.post(
                            "/billing/credits/verify",
                            verifyPayload,
                            session.access_token
                        );

                        console.log('[MINUTE_VERIFY] Verification successful', verifyResponse);

                        await refresh();
                        alert(`Added ${order.minutes} interview minutes to your wallet!`);
                    } catch (err) {
                        console.error('[MINUTE_VERIFY] Verification failed', {
                            error: err,
                            message: err instanceof ApiError ? err.message : 'Unknown error',
                        });

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

    const handleRedeemCoupon = async () => {
        if (!session?.access_token) return;
        const code = couponCode.trim();
        if (!code) return;
        setCouponMsg(null);
        setCouponRedeeming(true);
        try {
            const res = await api.post<{ plan: PlanKey; expiresAt: string }>(
                "/billing/coupons/redeem",
                { code },
                session.access_token
            );
            setCouponCode("");
            await refresh();
            
            // Close the coupon modal smoothly
            setShowCouponModal(false);
            
            // Wait a brief moment for the modal to close, then show celebration
            setTimeout(() => {
                setCelebration({ plan: res.plan, expiresAt: res.expiresAt });
            }, 300); // 300ms matches the fade-out animation duration
        } catch (err) {
            setCouponMsg({
                ok: false,
                text: err instanceof ApiError ? err.message : "Could not redeem",
            });
        } finally {
            setCouponRedeeming(false);
        }
    };

    return (
        <>
            {/* Celebration popup overlay */}
            {celebration && (
                <CouponCelebration
                    plan={celebration.plan}
                    expiresAt={celebration.expiresAt}
                    onClose={() => setCelebration(null)}
                />
            )}

            <div className="min-h-screen bg-gradient-to-b from-neutral-50 to-white dark:from-lc-bg dark:to-lc-bg">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
                    {/* Page Header */}
                    <div className="mb-8 flex items-center justify-between">
                        <div>
                            <h1 className="text-4xl font-black text-neutral-900 dark:text-white tracking-tight">
                                Subscription
                            </h1>
                            <p className="mt-2 text-base text-neutral-600 dark:text-neutral-400">
                                Choose the perfect plan for your interview preparation journey and unlock premium features.
                            </p>
                        </div>
                        <button
                            onClick={() => setShowCouponModal(true)}
                            className="px-3 py-1.5 rounded-2xl border-2 border-teal-500 hover:bg-teal-50 dark:hover:bg-teal-900/20 text-teal-600 dark:text-teal-400 font-semibold transition-all duration-200 flex items-center gap-2"
                        >
                            Redeem Coupon
                        </button>
                    </div>

                    {/* 1. Buy Interview Minutes Section */}
                    <div className="mb-12">
                        <div className="flex items-center gap-3 mb-6">
                            <h2 className="text-2xl font-bold text-neutral-900 dark:text-white leading-none flex items-center">
                                Buy interview minutes
                            </h2>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-stretch">
                            {/* 30 Minutes Card */}
                            <button
                                onClick={() => handleBuyMinutes("mins_30")}
                                disabled={minuteProcessing === "mins_30"}
                                className="group relative flex flex-col bg-gradient-to-br from-blue-200 via-blue-100 to-cyan-100 dark:from-blue-950 dark:via-blue-900 dark:to-blue-800 rounded-2xl p-4 text-left transition-all duration-300 ease-out hover:-translate-y-1.5 shadow-[0_8px_20px_-6px_rgba(59,130,246,0.3)] hover:shadow-[0_20px_40px_-10px_rgba(59,130,246,0.4)] dark:shadow-[0_8px_20px_-6px_rgba(0,0,0,0.4)] dark:hover:shadow-[0_20px_40px_-10px_rgba(0,0,0,0.5)] disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                                <div className="flex items-center gap-2 mb-3">
                                    <ClockIcon size={26} className="text-slate-600 dark:text-slate-300 transition-transform duration-300 group-hover:scale-110 group-hover:rotate-12" />
                                    <div className="text-xl font-bold text-neutral-900 dark:text-white">30</div>
                                    <span className="text-xs text-neutral-600 dark:text-neutral-400">minutes</span>
                                </div>

                                <div className="flex-1 mb-3 transition-transform duration-300 group-hover:-translate-y-0.5">
                                    <div className="text-2xl font-bold text-neutral-900 dark:text-white">₹120</div>
                                    <div className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">₹4.00 / min</div>
                                </div>

                                <div className="w-full py-2 rounded-2xl bg-gradient-to-r from-blue-900 to-blue-700 hover:from-blue-800 hover:to-blue-600 dark:from-neutral-900 dark:to-neutral-800 dark:hover:from-neutral-800 dark:hover:to-neutral-700 text-white text-sm font-semibold text-center transition-all duration-300 group-hover:shadow-lg">
                                    {minuteProcessing === "mins_30" ? "Processing..." : "Buy Now"}
                                </div>
                            </button>

                            {/* 60 Minutes Card */}
                            <button
                                onClick={() => handleBuyMinutes("mins_60")}
                                disabled={minuteProcessing === "mins_60"}
                                className="group relative flex flex-col bg-gradient-to-br from-blue-200 via-blue-100 to-cyan-100 dark:from-blue-950 dark:via-blue-900 dark:to-blue-800 rounded-2xl p-4 text-left transition-all duration-300 ease-out hover:-translate-y-1.5 shadow-[0_8px_20px_-6px_rgba(59,130,246,0.3)] hover:shadow-[0_20px_40px_-10px_rgba(59,130,246,0.4)] dark:shadow-[0_8px_20px_-6px_rgba(0,0,0,0.4)] dark:hover:shadow-[0_20px_40px_-10px_rgba(0,0,0,0.5)] disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                                <div className="flex items-center gap-2 mb-3">
                                    <ClockIcon size={26} className="text-slate-600 dark:text-slate-300 transition-transform duration-300 group-hover:scale-110 group-hover:rotate-12" />
                                    <div className="text-xl font-bold text-neutral-900 dark:text-white">60</div>
                                    <span className="text-xs text-neutral-600 dark:text-neutral-400">minutes</span>
                                </div>

                                <div className="flex-1 mb-3 transition-transform duration-300 group-hover:-translate-y-0.5">
                                    <div className="text-2xl font-bold text-neutral-900 dark:text-white">₹240</div>
                                    <div className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">₹4.00 / min</div>
                                </div>

                                <div className="w-full py-2 rounded-2xl bg-gradient-to-r from-blue-900 to-blue-700 hover:from-blue-800 hover:to-blue-600 dark:from-neutral-900 dark:to-neutral-800 dark:hover:from-neutral-800 dark:hover:to-neutral-700 text-white text-sm font-semibold text-center transition-all duration-300 group-hover:shadow-lg">
                                    {minuteProcessing === "mins_60" ? "Processing..." : "Buy Now"}
                                </div>
                            </button>

                            {/* 120 Minutes Card — Most Popular */}
                            <button
                                onClick={() => handleBuyMinutes("mins_120")}
                                disabled={minuteProcessing === "mins_120"}
                                className="group relative flex flex-col bg-gradient-to-br from-blue-200 via-blue-100 to-cyan-100 dark:from-blue-950 dark:via-blue-900 dark:to-blue-800 rounded-2xl p-4 text-left transition-all duration-300 ease-out hover:-translate-y-1.5 shadow-[0_8px_20px_-6px_rgba(59,130,246,0.3)] hover:shadow-[0_20px_40px_-10px_rgba(59,130,246,0.4)] dark:shadow-[0_8px_20px_-6px_rgba(0,0,0,0.4)] dark:hover:shadow-[0_20px_40px_-10px_rgba(0,0,0,0.5)] disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                                {/* Most Popular badge */}
                                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-gradient-to-r from-blue-600 to-cyan-500 text-white text-[10px] font-bold uppercase tracking-wider shadow-md whitespace-nowrap z-10">
                                    Most Popular
                                </div>

                                <div className="flex items-center gap-2 mb-3">
                                    <ClockIcon size={26} className="text-slate-600 dark:text-slate-300 transition-transform duration-300 group-hover:scale-110 group-hover:rotate-12" />
                                    <div className="text-xl font-bold text-neutral-900 dark:text-white">120</div>
                                    <span className="text-xs text-neutral-600 dark:text-neutral-400">minutes</span>
                                </div>

                                <div className="flex-1 mb-3 transition-transform duration-300 group-hover:-translate-y-0.5">
                                    <div className="text-2xl font-bold text-neutral-900 dark:text-white">₹450</div>
                                    <div className="flex items-center gap-1.5 mt-0.5">
                                        <span className="text-xs text-neutral-500 dark:text-neutral-400">₹3.75 / min</span>
                                        <span className="px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-[10px] font-semibold">Save 6%</span>
                                    </div>
                                </div>

                                <div className="w-full py-2 rounded-2xl bg-gradient-to-r from-blue-900 to-blue-700 hover:from-blue-800 hover:to-blue-600 dark:from-neutral-900 dark:to-neutral-800 dark:hover:from-neutral-800 dark:hover:to-neutral-700 text-white text-sm font-semibold text-center transition-all duration-300 group-hover:shadow-lg">
                                    {minuteProcessing === "mins_120" ? "Processing..." : "Buy Now"}
                                </div>
                            </button>

                            {/* 200 Minutes Card */}
                            <button
                                onClick={() => handleBuyMinutes("mins_200")}
                                disabled={minuteProcessing === "mins_200"}
                                className="group relative flex flex-col bg-gradient-to-br from-blue-200 via-blue-100 to-cyan-100 dark:from-blue-950 dark:via-blue-900 dark:to-blue-800 rounded-2xl p-4 text-left transition-all duration-300 ease-out hover:-translate-y-1.5 shadow-[0_8px_20px_-6px_rgba(59,130,246,0.3)] hover:shadow-[0_20px_40px_-10px_rgba(59,130,246,0.4)] dark:shadow-[0_8px_20px_-6px_rgba(0,0,0,0.4)] dark:hover:shadow-[0_20px_40px_-10px_rgba(0,0,0,0.5)] disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                                <div className="flex items-center gap-2 mb-3">
                                    <ClockIcon size={26} className="text-slate-600 dark:text-slate-300 transition-transform duration-300 group-hover:scale-110 group-hover:rotate-12" />
                                    <div className="text-xl font-bold text-neutral-900 dark:text-white">200</div>
                                    <span className="text-xs text-neutral-600 dark:text-neutral-400">minutes</span>
                                </div>

                                <div className="flex-1 mb-3 transition-transform duration-300 group-hover:-translate-y-0.5">
                                    <div className="text-2xl font-bold text-neutral-900 dark:text-white">₹750</div>
                                    <div className="flex items-center gap-1.5 mt-0.5">
                                        <span className="text-xs text-neutral-500 dark:text-neutral-400">₹3.75 / min</span>
                                        <span className="px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-[10px] font-semibold">Save 6%</span>
                                    </div>
                                </div>
                                <div className="w-full py-2 rounded-2xl bg-gradient-to-r from-blue-900 to-blue-700 hover:from-blue-800 hover:to-blue-600 dark:from-neutral-900 dark:to-neutral-800 dark:hover:from-neutral-800 dark:hover:to-neutral-700 text-white text-sm font-semibold text-center transition-all duration-300 group-hover:shadow-lg">
                                    {minuteProcessing === "mins_200" ? "Processing..." : "Buy Now"}
                                </div>
                            </button>
                        </div>
                    </div>

                    {/* Choose Plan Heading */}
                    <div className="mb-8">
                        <h2 className="text-3xl font-bold text-neutral-900 dark:text-white">
                            Choose Plan
                        </h2>
                    </div>

                    {/* 2. Billing cycle toggle */}
                    <div className="flex justify-center mb-12">
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

                    {/* 3. Plan cards */}
                    <div id="plans-section" className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 mb-8 group/plans">
                        {PLANS.map((plan) => (
                            <div key={plan} className="transition-opacity duration-300 group-hover/plans:opacity-80 hover:!opacity-100 h-full flex">
                                <PlanCard
                                    plan={plan as PlanKey}
                                    cycle={cycle}
                                    current={currentPlan === plan && (snapshot?.cycle === cycle || currentPlan === "FREE")}
                                    currentPlan={currentPlan}
                                    currentCycle={snapshot?.cycle as BillingCycle | undefined}
                                    isCancelled={!!snapshot?.cancelledAt}
                                    currentPeriodEnd={snapshot?.currentPeriodEnd}
                                    scheduledPlanChange={snapshot?.scheduledPlanChange}
                                    processing={processing === plan}
                                    onSubscribe={() =>
                                        plan !== "FREE" && handleSubscribe(plan as Exclude<PlanKey, "FREE">)
                                    }
                                />
                            </div>
                        ))}
                    </div>
                </div>


                {/* Cancellation Confirmation Modal */}
                {showCancelModal && cancelPreview && (
                    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-neutral-950/50 dark:bg-black/50 backdrop-blur-sm animate-in fade-in duration-300">
                        <div className="relative mx-4 w-full max-w-md rounded-2xl bg-white dark:bg-lc-surface border border-neutral-200 dark:border-lc-border shadow-2xl p-6">
                            <h3 className="text-xl font-bold text-neutral-900 dark:text-white mb-4">
                                Cancel Subscription?
                            </h3>
                            
                            <p className="text-neutral-600 dark:text-neutral-300 mb-4">
                                {cancelPreview.message}
                            </p>
                            
                            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4 mb-6">
                                <p className="text-sm font-semibold text-amber-900 dark:text-amber-100 mb-2">
                                    What happens next:
                                </p>
                                <ul className="text-sm text-amber-800 dark:text-amber-200 space-y-1.5">
                                    <li className="flex items-start gap-2">
                                        <span className="text-amber-600 mt-0.5">•</span>
                                        <span>
                                            Your {cancelPreview.currentPlan} plan stays active until{' '}
                                            {cancelPreview.validUntil && new Date(cancelPreview.validUntil).toLocaleDateString('en-US', {
                                                month: 'long',
                                                day: 'numeric',
                                                year: 'numeric'
                                            })}
                                        </span>
                                    </li>
                                    <li className="flex items-start gap-2">
                                        <span className="text-amber-600 mt-0.5">•</span>
                                        <span>No further charges will be made</span>
                                    </li>
                                    <li className="flex items-start gap-2">
                                        <span className="text-amber-600 mt-0.5">•</span>
                                        <span>After expiry, you'll be downgraded to {cancelPreview.willDowngradeTo}</span>
                                    </li>
                                </ul>
                            </div>
                            
                            <div className="flex gap-3">
                                <button
                                    onClick={() => setShowCancelModal(false)}
                                    disabled={cancelling}
                                    className="flex-1 px-4 py-2.5 border border-neutral-300 dark:border-lc-border rounded-lg hover:bg-neutral-50 dark:hover:bg-lc-hover font-medium text-neutral-700 dark:text-neutral-200 transition-colors disabled:opacity-50"
                                >
                                    Keep Subscription
                                </button>
                                <button
                                    onClick={handleCancelSubscription}
                                    disabled={cancelling}
                                    className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {cancelling ? 'Cancelling...' : 'Yes, Cancel'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Redeem Coupon Modal */}
                {showCouponModal && (
                    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/60 dark:bg-black/70 backdrop-blur-md animate-in fade-in duration-300 p-4">
                        <div className="relative w-full max-w-md rounded-3xl bg-white dark:bg-[#1a1a1a] border border-slate-200/70 dark:border-white/[0.08] shadow-[0_30px_80px_-15px_rgba(0,0,0,0.35)] dark:shadow-[0_30px_80px_-15px_rgba(0,0,0,0.7)] overflow-hidden animate-in zoom-in-95 fade-in duration-200">
                            {/* Premium gradient hero */}
                            <div className="relative px-8 pt-9 pb-7 bg-gradient-to-br from-blue-50 via-white to-blue-50/40 dark:from-[#1f1f1f] dark:via-[#1a1a1a] dark:to-[#1d2230] border-b border-slate-200/70 dark:border-white/[0.06] overflow-hidden text-center">
                                {/* soft glow */}
                                <div className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-72 h-72 bg-gradient-to-br from-blue-400/30 via-blue-500/15 to-transparent dark:from-blue-500/20 dark:via-blue-600/10 blur-3xl rounded-full" />

                                <button
                                    onClick={() => {
                                        setShowCouponModal(false);
                                        setCouponCode("");
                                        setCouponMsg(null);
                                    }}
                                    className="absolute top-5 right-5 size-9 flex items-center justify-center rounded-full bg-white/70 dark:bg-white/[0.06] hover:bg-white dark:hover:bg-white/[0.12] border border-slate-200/70 dark:border-white/[0.08] backdrop-blur-sm transition-all cursor-pointer"
                                    aria-label="Close"
                                >
                                    <svg className="w-4 h-4 text-slate-500 dark:text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>

                                {/* Hero ticket icon */}
                                <div className="relative mx-auto mb-5 w-16 h-16">
                                    <div className="absolute inset-0 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 blur-xl opacity-40 animate-pulse" />
                                    <div className="relative w-full h-full rounded-2xl bg-gradient-to-br from-blue-500 via-blue-600 to-blue-700 flex items-center justify-center shadow-[0_10px_25px_-6px_rgba(37,99,235,0.55)] rotate-[-6deg]">
                                        <svg className="w-8 h-8 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                            <path d="M2 9a3 3 0 015 2.236A3 3 0 0112 13a3 3 0 015-1.764A3 3 0 0122 9v6a2 2 0 01-2 2H4a2 2 0 01-2-2V9z" />
                                            <path d="M12 6v3M12 13v4" strokeDasharray="2 2" />
                                        </svg>
                                    </div>
                                    <span className="absolute -top-1 -right-2 text-[16px] animate-pulse">✦</span>
                                </div>

                                <h3 className="relative text-[22px] font-bold text-slate-900 dark:text-white font-nunito tracking-tight">
                                    Redeem Coupon
                                </h3>
                                <p className="relative mt-2 text-[13px] text-slate-600 dark:text-slate-400 max-w-xs mx-auto leading-relaxed">
                                    Have an access code? Enter it below to unlock <strong className="text-slate-900 dark:text-white font-bold">premium features</strong> for free.
                                </p>
                            </div>

                            {/* Body */}
                            <div className="px-8 py-7 space-y-5">
                                <div className="relative">
                                    <input
                                        type="text"
                                        placeholder="ENTER CODE"
                                        value={couponCode}
                                        onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && couponCode.trim()) {
                                                handleRedeemCoupon();
                                            }
                                        }}
                                        className="w-full px-5 py-4 text-[16px] font-bold tracking-[0.25em] rounded-2xl border-2 border-slate-200 dark:border-white/[0.08] bg-slate-50 dark:bg-white/[0.03] text-slate-900 dark:text-white placeholder:text-slate-400 placeholder:font-semibold placeholder:tracking-[0.2em] focus:outline-none focus:border-primary focus:bg-white dark:focus:bg-white/[0.06] focus:ring-4 focus:ring-primary/15 transition-all text-center font-mono uppercase"
                                        disabled={couponRedeeming}
                                        autoFocus
                                    />
                                </div>

                                <button
                                    onClick={handleRedeemCoupon}
                                    disabled={!couponCode.trim() || couponRedeeming}
                                    className="group relative w-full overflow-hidden bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600 text-white font-bold py-3.5 rounded-2xl shadow-[0_10px_25px_-8px_rgba(37,99,235,0.5)] hover:shadow-[0_14px_30px_-8px_rgba(37,99,235,0.6)] transition-all hover:-translate-y-0.5 active:scale-[0.98] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-[0_10px_25px_-8px_rgba(37,99,235,0.5)]"
                                >
                                    <span className="relative z-10 flex items-center justify-center gap-2">
                                        {couponRedeeming ? (
                                            <>
                                                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                                </svg>
                                                Redeeming...
                                            </>
                                        ) : (
                                            <>
                                                Redeem Coupon
                                                <svg className="w-4 h-4 transition-transform group-hover:translate-x-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                                    <polyline points="9 18 15 12 9 6" />
                                                </svg>
                                            </>
                                        )}
                                    </span>
                                    <span className="pointer-events-none absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-1000 bg-gradient-to-r from-transparent via-white/25 to-transparent" />
                                </button>

                                {couponMsg && (
                                    <div className={`p-3.5 rounded-xl text-[13px] font-medium flex items-start gap-2.5 ${
                                        couponMsg.ok
                                            ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/20'
                                            : 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-500/20'
                                    }`}>
                                        <span className="material-symbols-outlined text-[18px] mt-px shrink-0">
                                            {couponMsg.ok ? 'check_circle' : 'error'}
                                        </span>
                                        <span>{couponMsg.text}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* Manage Membership Link */}
                <div className="mt-8 mb-12 flex justify-center">
                    <a
                        href="/settings/membership"
                        className="text-base text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors font-medium hover:underline"
                    >
                        Manage Membership
                    </a>
                </div>
            </div>
        </>
    );
}

function PlanCard({
    plan,
    cycle,
    current,
    processing,
    onSubscribe,
    currentPlan,
    currentCycle,
    isCancelled,
    currentPeriodEnd,
    scheduledPlanChange,
}: {
    plan: PlanKey;
    cycle: BillingCycle;
    current: boolean;
    processing: boolean;
    onSubscribe: () => void;
    currentPlan: PlanKey;
    currentCycle?: BillingCycle;
    isCancelled?: boolean;
    currentPeriodEnd?: string | null;
    scheduledPlanChange?: string | null;
}) {
    const ent = PLAN_ENTITLEMENTS[plan];
    const isFree = plan === "FREE";
    const price = cycle === "MONTHLY" ? ent.priceInrMonthly : ent.priceInrQuarterlyPerMonth;

    // Check if subscription is cancelled but still active (before period end)
    const isActiveCancelled = isCancelled && currentPeriodEnd && new Date(currentPeriodEnd) > new Date();

    // Check if user has this plan but on a different billing cycle
    const hasSamePlanDifferentCycle = currentPlan === plan && currentCycle && currentCycle !== cycle && plan !== "FREE";

    // Determine if this is an upgrade or downgrade
    const planOrder: Record<PlanKey, number> = {
        FREE: 0,
        PLUS: 1,
        PRO: 2,
        MAX: 3,
    };
    
    const isUpgrade = planOrder[plan] > planOrder[currentPlan];
    const isDowngrade = planOrder[plan] < planOrder[currentPlan];
    const isScheduledForDowngrade = scheduledPlanChange === plan;
    
    const buttonText = isScheduledForDowngrade
        ? "Cancel Downgrade"
        : isDowngrade 
        ? `Upgrade To ${ent.displayName}`
        : `Upgrade to ${ent.displayName}`;

    const cardStyles = useMemo(() => {
        switch (plan) {
            case "FREE":
                return {
                    badge: "bg-green-100 text-green-700",
                    badgeText: "FREE",
                    background: "bg-gradient-to-br from-white via-neutral-50 to-green-50/30 dark:from-neutral-800 dark:via-neutral-800 dark:to-green-900/20",
                    hoverGlow: "hover:shadow-[0_25px_60px_-12px_rgba(0,0,0,0.3),0_12px_30px_rgba(100,100,100,0.3)]",
                    borderGradient: null,
                    borderGradientStyle: null,
                    button: "bg-gradient-to-r from-blue-900 to-blue-600 hover:from-blue-800 hover:to-blue-500 text-white font-bold shadow-lg transition-all duration-300",
                };
            case "PLUS":
                return {
                    badge: "bg-gradient-to-r from-blue-500 to-cyan-500 text-white shadow-lg shadow-blue-500/50",
                    badgeText: "PLUS",
                    background: "bg-gradient-to-br from-blue-200 via-cyan-100 to-blue-100 dark:from-blue-900/40 dark:via-blue-800/30 dark:to-cyan-900/40",
                    hoverGlow: "hover:shadow-[0_30px_70px_-15px_rgba(59,130,246,0.6),0_15px_40px_rgba(59,130,246,0.4)]",
                    borderGradient: "group-hover:animate-[gradient-shift_3s_ease_infinite] group-hover:shadow-[0_0_35px_rgba(59,130,246,0.7)]",
                    borderGradientStyle: "linear-gradient(135deg, #60a5fa, #22d3ee, #3b82f6)",
                    button: "group/btn relative overflow-hidden bg-gradient-to-r from-blue-900 to-blue-600 hover:from-blue-800 hover:to-blue-500 text-white font-bold shadow-lg transition-all duration-300",
                    buttonHoverGradient: "before:absolute before:inset-0 before:bg-gradient-to-r before:from-blue-800 before:to-blue-500 before:opacity-0 hover:before:opacity-100 before:transition-opacity before:duration-500",
                };
            case "PRO":
                return {
                    badge: "bg-gradient-to-r from-amber-500 to-orange-500 text-white",
                    badgeText: "PRO",
                    background: "bg-gradient-to-br from-orange-200 via-amber-100 to-yellow-200 dark:from-orange-700/60 dark:via-orange-600/50 dark:to-amber-700/60",
                    hoverGlow: "hover:shadow-[0_30px_70px_-15px_rgba(251,146,60,0.6),0_15px_40px_rgba(251,146,60,0.4)]",
                    borderGradient: "group-hover:animate-[gradient-shift_3s_ease_infinite] group-hover:shadow-[0_0_35px_rgba(251,146,60,0.7)]",
                    borderGradientStyle: "linear-gradient(135deg, #fb923c, #fbbf24, #f97316)",
                    button: "group/btn relative overflow-hidden bg-gradient-to-r from-blue-900 to-blue-600 hover:from-blue-800 hover:to-blue-500 text-white font-bold shadow-lg transition-all duration-300",
                    buttonHoverGradient: "before:absolute before:inset-0 before:bg-gradient-to-r before:from-blue-800 before:to-blue-500 before:opacity-0 hover:before:opacity-100 before:transition-opacity before:duration-500",
                    bestValue: true,
                };
            case "MAX":
                return {
                    badge: "bg-gradient-to-r from-purple-600 to-pink-500 text-white",
                    badgeText: "MAX",
                    background: "bg-gradient-to-br from-purple-200 via-pink-100 to-purple-100 dark:from-purple-700/60 dark:via-purple-600/50 dark:to-pink-700/60",
                    hoverGlow: "hover:shadow-[0_30px_70px_-15px_rgba(168,85,247,0.6),0_15px_40px_rgba(168,85,247,0.4)]",
                    borderGradient: "group-hover:animate-[gradient-shift_3s_ease_infinite] group-hover:shadow-[0_0_35px_rgba(168,85,247,0.7)]",
                    borderGradientStyle: "linear-gradient(135deg, #a78bfa, #f0abfc, #a855f7)",
                    button: "group/btn relative overflow-hidden bg-gradient-to-r from-blue-900 to-blue-600 hover:from-blue-800 hover:to-blue-500 text-white font-bold shadow-lg transition-all duration-300",
                    buttonHoverGradient: "before:absolute before:inset-0 before:bg-gradient-to-r before:from-blue-800 before:to-blue-500 before:opacity-0 hover:before:opacity-100 before:transition-opacity before:duration-500",
                };
        }
    }, [plan]);

    return (
        <div className="group/card relative rounded-2xl transition-all duration-500 ease-out hover:-translate-y-1 hover:scale-[1.025] hover:z-10 h-full overflow-visible">
            {/* Best Value Badge - Outside the card */}
            {cardStyles.bestValue && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 text-white text-xs font-bold uppercase tracking-wider shadow-lg z-20 transition-transform duration-300 group-hover/card:scale-110">
                    Best Value
                </div>
            )}

            {/* Animated gradient overlay on hover */}
            <div 
                className="absolute inset-0 rounded-2xl opacity-0 group-hover/card:opacity-100 transition-opacity duration-700 pointer-events-none z-10"
                style={{
                    background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.5) 50%, transparent 100%)',
                    backgroundSize: '200% 100%',
                    animation: 'none',
                }}
            >
                <style jsx>{`
                    @keyframes gradient-sweep {
                        0% {
                            background-position: 200% 0;
                        }
                        100% {
                            background-position: -200% 0;
                        }
                    }
                    .group\/card:hover > div:nth-child(2) {
                        animation: gradient-sweep 2s ease-in-out infinite;
                    }
                `}</style>
            </div>

            {/* Spotlight gradient overlay */}
            <div className="absolute inset-0 rounded-2xl opacity-0 group-hover/card:opacity-100 transition-opacity duration-500 pointer-events-none"
                style={{
                    background: 'radial-gradient(circle at top right, rgba(59, 130, 246, 0.15), transparent 70%)',
                }}
            />
            
            <div
                className={`relative rounded-2xl p-5 flex flex-col h-full transition-all duration-500 ${cardStyles.background} ${cardStyles.hoverGlow}`}
                style={{
                    boxShadow: '0 20px 50px -12px rgba(0, 0, 0, 0.25), 0 10px 20px -8px rgba(0, 0, 0, 0.3)',
                }}
            >
                {/* Animated gradient on wrapper */}
                {cardStyles.borderGradientStyle && (
                    <style jsx>{`
                        @keyframes gradient-shift {
                            0%, 100% { background-position: 0% 50%; }
                            50% { background-position: 100% 50%; }
                        }
                        .group\/card:hover {
                            animation: gradient-shift 3s ease infinite;
                        }
                        @keyframes shine-sweep {
                            0% { transform: translateX(-100%); }
                            100% { transform: translateX(100%); }
                        }
                    `}</style>
                )}

            {/* Plan Name */}
            <h3 className="relative z-30 text-4xl font-black text-neutral-900 dark:text-white mb-3 transition-none">
                {ent.displayName}
            </h3>

            {/* Description */}
            <p className="relative z-30 text-sm text-neutral-700 dark:text-neutral-200 mb-3 min-h-[32px] font-medium transition-none">
                {plan === "FREE" && "Start practicing with basic access"}
                {plan === "PLUS" && "For regular practice and resume improvement"}
                {plan === "PRO" && "Best for placement preparation"}
                {plan === "MAX" && "For power users and heavy preparation"}
            </p>

            {/* Price */}
            <div className="relative z-30 mb-4">
                <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-bold text-neutral-900 dark:text-white transition-none">
                        {isFree ? "₹0" : `₹${price}`}
                    </span>
                    {!isFree && (
                        <span className="text-base text-neutral-600 dark:text-neutral-300 font-medium transition-none">/mo</span>
                    )}
                </div>
                {!isFree && cycle === "QUARTERLY" && (
                    <div className="text-sm text-neutral-600 dark:text-neutral-300 mt-0.5 font-medium transition-none">
                        Billed ₹{price * 3} quarterly
                    </div>
                )}
            </div>

            {/* Features */}
            <ul className="relative z-30 space-y-2 text-[15px] text-neutral-800 dark:text-neutral-200 mb-5 flex-1 font-medium transition-none">
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
                    className="w-full py-2.5 rounded-xl text-base font-bold bg-neutral-100 text-neutral-600 border-2 border-neutral-200 cursor-default"
                >
                    Current plan
                </button>
            ) : isFree ? (
                <button
                    disabled
                    className="w-full py-2.5 rounded-xl text-base font-bold bg-neutral-50 text-neutral-500 cursor-default mt-8"
                >
                    Default
                </button>
            ) : isActiveCancelled ? (
                <button
                    disabled
                    className="w-full py-2.5 rounded-xl text-sm font-semibold bg-neutral-100 text-neutral-400 cursor-not-allowed"
                    title={`Your subscription is cancelled. You can upgrade after ${currentPeriodEnd ? new Date(currentPeriodEnd).toLocaleDateString() : 'expiry'}.`}
                >
                    {buttonText}
                </button>
            ) : hasSamePlanDifferentCycle ? (
                <button
                    disabled
                    className="w-full py-2.5 rounded-xl text-sm font-semibold bg-neutral-100 text-neutral-400 cursor-not-allowed"
                    title={`You already have ${ent.displayName} on ${currentCycle?.toLowerCase()} billing.`}
                >
                    Upgrade to {ent.displayName}
                </button>
            ) : isDowngrade && !isScheduledForDowngrade ? (
                <button
                    disabled
                    className="w-full py-2.5 rounded-xl text-sm font-semibold bg-neutral-100 text-neutral-400 cursor-not-allowed"
                    title="Downgrades are not available. Contact support if you need to change to a lower plan."
                >
                    {buttonText}
                </button>
            ) : (
                <button
                    onClick={onSubscribe}
                    disabled={processing}
                    className={`relative z-20 overflow-hidden w-full py-3 rounded-xl text-sm transition-all duration-200 ${
                        isScheduledForDowngrade
                            ? "bg-red-600 hover:bg-red-700 text-white font-semibold"
                            : `${cardStyles.button} ${cardStyles.buttonHoverGradient || ''}`
                    } disabled:opacity-60 disabled:cursor-not-allowed`}
                >
                    {/* Shine sweep effect */}
                    <div className="absolute inset-0 -translate-x-full group-hover/card:translate-x-full transition-transform duration-700 bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none" />
                    <span className="relative z-10">{processing ? "Processing…" : buttonText}</span>
                </button>
            )}
            </div>
        </div>
    );
}

function Feature({ text, included = true }: { text: string; included?: boolean }) {
    return (
        <li className="flex items-start gap-2 group/feature">
            {included ? (
                <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 shrink-0 transition-transform duration-300 group-hover/card:translate-x-0.5"
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

function UsageCard({ 
    label, 
    used, 
    limit, 
    unit,
    formatNumber = false 
}: { 
    label: string; 
    used: number; 
    limit: number; 
    unit: string;
    formatNumber?: boolean;
}) {
    const percentage = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
    const isNearLimit = percentage >= 80;
    const isAtLimit = percentage >= 100;
    
    const formatValue = (value: number) => {
        if (!formatNumber) return value.toString();
        if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
        return value.toString();
    };

    return (
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4">
            <div className="text-xs font-medium text-neutral-600 mb-2">{label}</div>
            <div className="flex items-baseline gap-1 mb-2">
                <span className={`text-2xl font-bold tabular-nums ${
                    isAtLimit ? 'text-red-600' : isNearLimit ? 'text-amber-600' : 'text-neutral-900'
                }`}>
                    {formatValue(used)}
                </span>
                <span className="text-sm text-neutral-500">
                    / {formatValue(limit)} {unit}
                </span>
            </div>
            <div className="w-full bg-neutral-200 rounded-full h-2 overflow-hidden">
                <div 
                    className={`h-full transition-all duration-300 ${
                        isAtLimit ? 'bg-red-500' : isNearLimit ? 'bg-amber-500' : 'bg-green-500'
                    }`}
                    style={{ width: `${percentage}%` }}
                />
            </div>
            {isAtLimit && (
                <div className="mt-2 text-xs text-red-600 font-medium">
                    Limit reached
                </div>
            )}
        </div>
    );
}
