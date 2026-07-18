"use client";

import { PageHeader } from "@/components/page-header";
import { ClockIcon } from "@/components/icons/clock-icon";
import { useState, useEffect } from "react";
import { useAuth } from "@/context/auth-context";
import { useBilling } from "@/hooks/use-billing";
import { api, ApiError } from "@/lib/api";
import { PLAN_ENTITLEMENTS, type PlanKey } from "@interviewforge/shared";

export default function MembershipPage() {
    useEffect(() => {
        document.title = "Manage Membership | Mockr";
    }, []);

    const { user, session } = useAuth();
    const { snapshot, refresh, loading: billingLoading } = useBilling();

    const [showCancelModal, setShowCancelModal] = useState(false);
    const [cancelPreview, setCancelPreview] = useState<any>(null);
    const [cancelling, setCancelling] = useState(false);
    const [processing, setProcessing] = useState(false);

    // Payment method state
    const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<'card' | 'upi' | 'netbanking'>('card');
    const [showPaymentMethodDropdown, setShowPaymentMethodDropdown] = useState(false);
    const [showPaymentHistoryDropdown, setShowPaymentHistoryDropdown] = useState(false);
    const [paymentHistory, setPaymentHistory] = useState<any[]>([]);
    const [loadingHistory, setLoadingHistory] = useState(false);

    const currentPlan = snapshot?.plan ?? "FREE";
    const planDetails = PLAN_ENTITLEMENTS[currentPlan as PlanKey];

    const formatDate = (dateString: string | null | undefined) => {
        if (!dateString) return "N/A";
        return new Date(dateString).toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
        });
    };

    const isFreePlan = currentPlan === "FREE";
    const hasActiveSubscription = snapshot?.subscriptionId && !isFreePlan;
    const hasScheduledChange = !!snapshot?.scheduledPlanChange;

    // Fetch payment history
    const fetchPaymentHistory = async () => {
        if (!session?.access_token || loadingHistory) return;
        
        setLoadingHistory(true);
        try {
            const response = await api.get<{ payments: any[] }>("/billing/payment-history", session.access_token);
            setPaymentHistory(response.payments || []);
        } catch (error) {
            console.error("Failed to fetch payment history:", error);
            setPaymentHistory([]);
        } finally {
            setLoadingHistory(false);
        }
    };

    // Fetch payment history when dropdown is opened
    useEffect(() => {
        if (showPaymentHistoryDropdown && paymentHistory.length === 0) {
            fetchPaymentHistory();
        }
    }, [showPaymentHistoryDropdown]);

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
            console.error("❌ Failed to fetch cancel preview:", error);
            alert(error instanceof ApiError ? error.message : "Failed to load cancellation preview");
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

            console.log("✅ Subscription cancelled:", response);
            alert(response.message || "Subscription cancelled successfully");

            setShowCancelModal(false);
            await refresh();
        } catch (error) {
            console.error("❌ Cancel subscription error:", error);
            alert(error instanceof ApiError ? error.message : "Failed to cancel subscription");
        } finally {
            setCancelling(false);
        }
    };

    const handleCancelDowngrade = async () => {
        if (!session?.access_token || !snapshot?.subscriptionId) return;

        setProcessing(true);

        try {
            const response = await api.post(
                "/billing/downgrade/cancel",
                {
                    subscriptionId: snapshot.subscriptionId,
                },
                session.access_token
            );

            alert("Downgrade canceled. You will remain on your current plan.");
            await refresh();
        } catch (error) {
            console.error("❌ Cancel downgrade error:", error);
            alert(error instanceof ApiError ? error.message : "Failed to cancel downgrade");
        } finally {
            setProcessing(false);
        }
    };

    return (
        <>
            <div className="flex-1 overflow-auto bg-[#FAFBFC] dark:bg-lc-bg flex flex-col">
                <PageHeader
                    titleNode={
                        <h1 className="text-[28px] font-bold text-slate-900 dark:text-white font-nunito tracking-[-0.02em]">
                            Manage Membership
                        </h1>
                    }
                    showBack
                    backUrl="/settings"
                />

                <main className="flex-1 flex flex-col items-center py-10 px-4">
                    <div className="w-full max-w-[1000px] space-y-6">
                        {/* Subscription Overview Header */}
                        <div>
                            <h2 className="text-[20px] font-bold text-slate-800 dark:text-white mb-6">
                                Subscription Overview
                            </h2>
                        </div>

                        {/* Current Plan and Current Interview Minutes - Side by Side */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Current Plan Card */}
                            <div className="bg-white dark:bg-[#282828] rounded-xl p-6 border-0 shadow-[0_2px_8px_rgba(0,0,0,0.12)] dark:shadow-[0_2px_8px_rgba(0,0,0,0.3)] flex flex-col">
                                <div className="flex items-start justify-between mb-4">
                                    <div className="flex-1">
                                        <p className="text-xs font-bold text-primary uppercase tracking-wider mb-2">
                                            CURRENT PLAN
                                        </p>
                                        <h3 className="text-3xl font-black text-slate-900 dark:text-white">
                                            {planDetails?.displayName || currentPlan}
                                        </h3>
                                        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                                            {currentPlan === "FREE" 
                                                ? "Free plan active forever" 
                                                : `${snapshot?.cycle?.toLowerCase() || ""} billing`}
                                        </p>
                                        {!isFreePlan && snapshot?.currentPeriodEnd && (
                                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 flex items-center gap-1">
                                                <span className="material-symbols-outlined text-sm">schedule</span>
                                                Renews on {formatDate(snapshot.currentPeriodEnd)}
                                            </p>
                                        )}
                                    </div>
                                </div>
                                <a
                                    href="/settings/billing"
                                    className="mt-auto w-full inline-block text-center px-4 py-2.5 rounded-xl bg-gradient-to-r from-blue-900 to-blue-600 hover:from-blue-800 hover:to-blue-500 text-white text-sm font-bold transition-colors"
                                >
                                    Upgrade Plan
                                </a>
                            </div>

                            {/* Current Interview Minutes Card */}
                            <div className="bg-white dark:bg-[#282828] rounded-xl p-6 border-0 shadow-[0_2px_8px_rgba(0,0,0,0.12)] dark:shadow-[0_2px_8px_rgba(0,0,0,0.3)]">
                                <div className="flex items-start gap-3 mb-4">
                                    <ClockIcon size={28} className="text-slate-500 dark:text-slate-400 mt-1" />
                                    <div>
                                        <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-1">
                                            Interview Minutes
                                        </h3>
                                        <p className="text-sm text-slate-600 dark:text-slate-400">
                                            Your available interview minutes
                                        </p>
                                    </div>
                                </div>
                                
                                <div className="bg-slate-50 dark:bg-[#232323] rounded-xl p-4 mb-4 border-0">
                                    <div className="flex items-center justify-center gap-3">
                                        <ClockIcon size={48} className="text-slate-500 dark:text-slate-400" />
                                        <span className="text-4xl font-black text-slate-900 dark:text-white">
                                            {billingLoading ? "..." : (snapshot?.wallet?.total ?? 0)}
                                        </span>
                                        <span className="text-lg font-semibold text-slate-600 dark:text-slate-400">
                                            minutes
                                        </span>
                                    </div>
                                </div>
                                
                                <a
                                    href="/settings/billing"
                                    className="w-full inline-block text-center px-4 py-2.5 rounded-xl bg-gradient-to-r from-blue-900 to-blue-600 hover:from-blue-800 hover:to-blue-500 text-white text-sm font-bold transition-colors"
                                >
                                    Buy More Minutes
                                </a>
                            </div>
                        </div>

                        {/* Detailed Usage Section */}
                        <div className="bg-white dark:bg-[#282828] rounded-xl p-8 border-0 shadow-[0_2px_8px_rgba(0,0,0,0.12)] dark:shadow-[0_2px_8px_rgba(0,0,0,0.3)]">
                            <div className="flex items-center justify-between mb-6">
                                <h2 className="text-[22px] font-extrabold text-slate-800 dark:text-white font-nunito tracking-tight">
                                    Detailed Usage
                                </h2>
                                {snapshot?.usage?.resetAt && (
                                    <p className="text-xs text-slate-500 dark:text-slate-400">
                                        Resets {formatDate(snapshot.usage.resetAt)}
                                    </p>
                                )}
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                                {/* Resume Analysis */}
                                <div className="bg-slate-50 dark:bg-[#232323] rounded-xl p-4 border-0">
                                    <p className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">
                                        Resume Analysis
                                    </p>
                                    <div className="flex items-baseline gap-1 mb-3">
                                        <span className="text-3xl font-black text-slate-900 dark:text-white">
                                            {snapshot?.usage?.resumeAnalysisUsed ?? 0}
                                        </span>
                                        <span className="text-sm text-slate-500 dark:text-slate-400">
                                            / {planDetails?.resumeAnalysisPerMonth ?? 0} analyses
                                        </span>
                                    </div>
                                    <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2 overflow-hidden">
                                        <div
                                            className="bg-emerald-500 h-full rounded-full transition-all duration-300"
                                            style={{
                                                width: `${Math.min(((snapshot?.usage?.resumeAnalysisUsed ?? 0) / (planDetails?.resumeAnalysisPerMonth ?? 1)) * 100, 100)}%`,
                                            }}
                                        />
                                    </div>
                                </div>

                                {/* Resume Improve AI */}
                                <div className="bg-slate-50 dark:bg-[#232323] rounded-xl p-4 border-0">
                                    <p className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">
                                        Resume Improve AI
                                    </p>
                                    <div className="flex items-baseline gap-1 mb-3">
                                        <span className="text-3xl font-black text-slate-900 dark:text-white">
                                            {snapshot?.usage?.resumeImproveAiUsed ?? 0}
                                        </span>
                                        <span className="text-sm text-slate-500 dark:text-slate-400">
                                            / {planDetails?.resumeImproveAiPerMonth ?? 0} uses
                                        </span>
                                    </div>
                                    <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2 overflow-hidden">
                                        <div
                                            className="bg-blue-500 h-full rounded-full transition-all duration-300"
                                            style={{
                                                width: `${Math.min(((snapshot?.usage?.resumeImproveAiUsed ?? 0) / (planDetails?.resumeImproveAiPerMonth ?? 1)) * 100, 100)}%`,
                                            }}
                                        />
                                    </div>
                                </div>

                                {/* LaTeX AI */}
                                <div className="bg-slate-50 dark:bg-[#232323] rounded-xl p-4 border-0">
                                    <p className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">
                                        LaTeX AI
                                    </p>
                                    <div className="flex items-baseline gap-1 mb-3">
                                        <span className="text-3xl font-black text-slate-900 dark:text-white">
                                            {snapshot?.usage?.latexAiTokensUsed ?? 0}
                                        </span>
                                        <span className="text-sm text-slate-500 dark:text-slate-400">
                                            / {((planDetails?.latexAiMonthlyTokens ?? 0) / 1000).toFixed(1)}k tokens
                                        </span>
                                    </div>
                                    <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2 overflow-hidden">
                                        <div
                                            className="bg-purple-500 h-full rounded-full transition-all duration-300"
                                            style={{
                                                width: `${Math.min(((snapshot?.usage?.latexAiTokensUsed ?? 0) / (planDetails?.latexAiMonthlyTokens ?? 1)) * 100, 100)}%`,
                                            }}
                                        />
                                    </div>
                                </div>

                                {/* AI Tutor */}
                                <div className="bg-slate-50 dark:bg-[#232323] rounded-xl p-4 border-0">
                                    <p className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">
                                        AI Tutor
                                    </p>
                                    <div className="flex items-baseline gap-1 mb-3">
                                        <span className="text-3xl font-black text-slate-900 dark:text-white">
                                            {snapshot?.usage?.tutorTokensUsed ?? 0}
                                        </span>
                                        <span className="text-sm text-slate-500 dark:text-slate-400">
                                            / {((planDetails?.aiTutorMonthlyTokens ?? 0) / 1000).toFixed(1)}k tokens
                                        </span>
                                    </div>
                                    <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2 overflow-hidden">
                                        <div
                                            className="bg-amber-500 h-full rounded-full transition-all duration-300"
                                            style={{
                                                width: `${Math.min(((snapshot?.usage?.tutorTokensUsed ?? 0) / (planDetails?.aiTutorMonthlyTokens ?? 1)) * 100, 100)}%`,
                                            }}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Payment Info Card with Dropdowns */}
                        <div className="bg-white dark:bg-[#282828] rounded-xl p-8 border-0 shadow-[0_2px_8px_rgba(0,0,0,0.12)] dark:shadow-[0_2px_8px_rgba(0,0,0,0.3)]">
                            <h2 className="text-[18px] font-bold text-slate-800 dark:text-white font-nunito tracking-tight mb-6">
                                Payment info
                            </h2>

                            <div className="space-y-1">
                                {/* Next Payment */}
                                {!isFreePlan && snapshot?.currentPeriodEnd && (
                                    <div className="p-4 border-b border-slate-100 dark:border-lc-border">
                                        <p className="text-[15px] font-bold text-slate-900 dark:text-white mb-2">
                                            Next payment
                                        </p>
                                        <p className="text-[15px] text-slate-600 dark:text-slate-400 mb-3">
                                            {formatDate(snapshot.currentPeriodEnd)}
                                        </p>
                                        <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                                            <span className="material-symbols-outlined text-lg">verified_user</span>
                                            <span>Payment method is selected securely during Razorpay checkout.</span>
                                        </div>
                                    </div>
                                )}

                                {/* Manage Payment Method - Dropdown */}
                                <div className="border-b border-slate-100 dark:border-lc-border">
                                    <button
                                        onClick={() => setShowPaymentMethodDropdown(!showPaymentMethodDropdown)}
                                        className="w-full flex items-center justify-between p-4 hover:bg-slate-50 dark:hover:bg-lc-hover transition-colors text-left"
                                    >
                                        <span className="text-[15px] font-semibold text-slate-900 dark:text-white">
                                            Manage payment method
                                        </span>
                                        <span className={`material-symbols-outlined text-slate-400 transition-transform ${showPaymentMethodDropdown ? 'rotate-90' : ''}`}>
                                            chevron_right
                                        </span>
                                    </button>

                                    {/* Payment Method Dropdown Content */}
                                    {showPaymentMethodDropdown && (
                                        <div className="px-4 pb-4 space-y-4">
                                            {/* Payment Method Tabs */}
                                            <div className="flex gap-2 border-b border-slate-200 dark:border-lc-border">
                                                <button
                                                    onClick={() => setSelectedPaymentMethod('card')}
                                                    className={`px-3 py-2 text-sm font-semibold transition-colors border-b-2 ${
                                                        selectedPaymentMethod === 'card'
                                                            ? 'border-primary text-primary'
                                                            : 'border-transparent text-slate-500'
                                                    }`}
                                                >
                                                    Cards
                                                </button>
                                                <button
                                                    onClick={() => setSelectedPaymentMethod('upi')}
                                                    className={`px-3 py-2 text-sm font-semibold transition-colors border-b-2 ${
                                                        selectedPaymentMethod === 'upi'
                                                            ? 'border-primary text-primary'
                                                            : 'border-transparent text-slate-500'
                                                    }`}
                                                >
                                                    UPI
                                                </button>
                                                <button
                                                    onClick={() => setSelectedPaymentMethod('netbanking')}
                                                    className={`px-3 py-2 text-sm font-semibold transition-colors border-b-2 ${
                                                        selectedPaymentMethod === 'netbanking'
                                                            ? 'border-primary text-primary'
                                                            : 'border-transparent text-slate-500'
                                                    }`}
                                                >
                                                    Net Banking
                                                </button>
                                            </div>

                                            {/* Cards Tab */}
                                            {selectedPaymentMethod === 'card' && (
                                                <div className="rounded-2xl bg-slate-50 p-5 dark:bg-lc-hover">
                                                    <div className="flex items-start gap-3">
                                                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-primary shadow-sm dark:bg-[#202020]">
                                                            <span className="material-symbols-outlined text-[22px]">credit_card</span>
                                                        </div>
                                                        <div className="flex-1">
                                                            <p className="text-sm font-bold text-slate-900 dark:text-white">
                                                                Cards are added at checkout
                                                            </p>
                                                            <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-400">
                                                                Mockr does not collect or store card details directly. Use Razorpay checkout when you buy minutes or manage your plan, then choose card payment there.
                                                            </p>
                                                            <a
                                                                href="/settings/billing"
                                                                className="mt-4 inline-flex items-center rounded-xl bg-primary px-4 py-2 text-sm font-bold text-white transition hover:bg-primary/90"
                                                            >
                                                                Go to billing
                                                            </a>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}

                                            {/* UPI Tab */}
                                            {selectedPaymentMethod === 'upi' && (
                                                <div className="text-center py-6 bg-slate-50 dark:bg-lc-hover rounded-lg">
                                                    <p className="text-slate-600 dark:text-slate-400 text-sm">
                                                        UPI payments are processed at checkout
                                                    </p>
                                                </div>
                                            )}

                                            {/* Net Banking Tab */}
                                            {selectedPaymentMethod === 'netbanking' && (
                                                <div className="text-center py-6 bg-slate-50 dark:bg-lc-hover rounded-lg">
                                                    <p className="text-slate-600 dark:text-slate-400 text-sm">
                                                        Select your bank during payment
                                                    </p>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {/* View Payment History - Always show */}
                                <div>
                                    <button
                                        onClick={() => {
                                            setShowPaymentHistoryDropdown(!showPaymentHistoryDropdown);
                                            if (!showPaymentHistoryDropdown) fetchPaymentHistory();
                                        }}
                                        className="w-full flex items-center justify-between p-4 hover:bg-slate-50 dark:hover:bg-lc-hover transition-colors text-left"
                                    >
                                        <span className="text-[15px] font-semibold text-slate-900 dark:text-white">
                                            View payment history
                                        </span>
                                        <span className={`material-symbols-outlined text-slate-400 transition-transform ${showPaymentHistoryDropdown ? 'rotate-90' : ''}`}>
                                            chevron_right
                                        </span>
                                    </button>

                                    {/* Payment History Dropdown */}
                                    {showPaymentHistoryDropdown && (
                                        <div className="px-4 pb-4">
                                            {loadingHistory ? (
                                                <div className="text-center py-6">
                                                    <div className="inline-block h-6 w-6 animate-spin rounded-full border-3 border-solid border-primary border-r-transparent"></div>
                                                </div>
                                            ) : paymentHistory.length > 0 ? (
                                                <div className="overflow-x-auto">
                                                    <table className="w-full text-sm">
                                                        <thead>
                                                            <tr className="border-b border-slate-200 dark:border-lc-border">
                                                                <th className="text-left py-2 px-2 text-xs font-semibold text-slate-600 dark:text-slate-400">Date</th>
                                                                <th className="text-left py-2 px-2 text-xs font-semibold text-slate-600 dark:text-slate-400">Type</th>
                                                                <th className="text-left py-2 px-2 text-xs font-semibold text-slate-600 dark:text-slate-400">Method</th>
                                                                <th className="text-right py-2 px-2 text-xs font-semibold text-slate-600 dark:text-slate-400">Amount</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {paymentHistory.map((payment, index) => (
                                                                <tr key={payment.id || index} className="border-b border-slate-100 dark:border-lc-border hover:bg-slate-50 dark:hover:bg-lc-hover">
                                                                    <td className="py-3 px-2 text-slate-700 dark:text-slate-300">
                                                                        {new Date(payment.date).toLocaleDateString("en-IN", {
                                                                            year: "numeric",
                                                                            month: "short",
                                                                            day: "numeric",
                                                                        })}
                                                                    </td>
                                                                    <td className="py-3 px-2">
                                                                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${
                                                                            payment.kind === 'SUBSCRIPTION' 
                                                                                ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
                                                                                : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                                                                        }`}>
                                                                            {payment.kind === 'SUBSCRIPTION' ? 'Subscription' : 'Minutes'}
                                                                        </span>
                                                                    </td>
                                                                    <td className="py-3 px-2 text-slate-700 dark:text-slate-300 capitalize">
                                                                        {payment.method || 'N/A'}
                                                                    </td>
                                                                    <td className="py-3 px-2 text-right font-semibold text-slate-900 dark:text-white">
                                                                        ₹{payment.amount.toFixed(2)}
                                                                    </td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            ) : (
                                                <div className="text-center py-6 bg-slate-50 dark:bg-lc-hover rounded-lg">
                                                    <p className="text-slate-600 dark:text-slate-400 text-sm">No payment history yet</p>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Cancel Membership Button */}
                        {hasActiveSubscription && (
                            <button
                                onClick={fetchCancelPreview}
                                className="w-full bg-white dark:bg-[#282828] rounded-xl p-4 border-0 shadow-[0_2px_8px_rgba(0,0,0,0.12)] dark:shadow-[0_2px_8px_rgba(0,0,0,0.3)] hover:bg-slate-50 dark:hover:bg-[#232323] transition-colors"
                            >
                                <p className="text-[14px] font-medium text-red-500 dark:text-red-400 text-center">
                                    Cancel Membership
                                </p>
                            </button>
                        )}
                    </div>
                </main>
            </div>

            {/* Cancel Modal */}
            {showCancelModal && cancelPreview && (
                <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-slate-900/40" onClick={() => setShowCancelModal(false)}>
                    <div className="relative w-full max-w-md rounded-3xl border border-slate-200/80 bg-white p-8 dark:border-white/10 dark:bg-[#161616]" onClick={(e) => e.stopPropagation()}>
                        <h3 className="text-[26px] font-bold text-red-600 dark:text-red-400 font-nunito">Cancel Subscription</h3>
                        <p className="mt-2 text-[15px] text-slate-600 dark:text-slate-400">Are you sure?</p>
                        <div className="mt-6 space-y-4">
                            <div className="p-4 bg-slate-50 dark:bg-lc-hover rounded-xl">
                                <p className="text-sm text-slate-700 dark:text-slate-300">
                                    Active until <span className="font-bold">{formatDate(cancelPreview.accessUntil)}</span>
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-3 mt-8">
                            <button onClick={() => setShowCancelModal(false)} disabled={cancelling} className="flex-1 rounded-xl px-4 py-2.5 text-[14px] font-bold text-slate-700 bg-slate-100">
                                Keep
                            </button>
                            <button onClick={handleCancelSubscription} disabled={cancelling} className="flex-1 rounded-2xl bg-red-600 px-4 py-2.5 text-[14px] font-bold text-white">
                                {cancelling ? "Canceling..." : "Confirm"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

        </>
    );
}
