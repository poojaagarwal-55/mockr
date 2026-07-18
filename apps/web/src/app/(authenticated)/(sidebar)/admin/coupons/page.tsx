"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAdminCheck } from "@/hooks/use-admin-check";
import { useAuth } from "@/context/auth-context";
import { api } from "@/lib/api";

type CouponRow = {
    id: string;
    code: string;
    type: string;
    plan: "FREE" | "PLUS" | "PRO" | "MAX" | null;
    durationDays: number | null;
    maxRedemptions: number | null;
    redemptions: number;
    allowedEmail: string | null;
    expiresAt: string | null;
    active: boolean;
    status: "ACTIVE" | "DISABLED" | "EXPIRED" | "EXHAUSTED";
    notes: string | null;
    createdBy: string | null;
    createdAt: string;
    redemptions_log: {
        id: string;
        userId: string;
        userEmail: string;
        userName: string;
        redeemedAt: string;
        isRevoked?: boolean;
        revokedAt?: string | null;
        revokedBy?: string | null;
        revocationReason?: string | null;
    }[];
};

type Stats = {
    totalCoupons: number;
    activeCoupons: number;
    totalRedemptions: number;
    byPlan: { plan: string | null; count: number }[];
};

type CreateBody = {
    plan: "PLUS" | "PRO" | "MAX";
    durationPreset: "7" | "14" | "30" | "90" | "180" | "365" | "indefinite" | "custom";
    customDurationDays?: number;
    maxRedemptions?: number | null;
    singleUse: boolean;
    allowedEmail?: string;
    code?: string;
    notes?: string;
};

const DURATION_PRESETS = [
    { value: "7", label: "7 days" },
    { value: "14", label: "14 days" },
    { value: "30", label: "30 days" },
    { value: "90", label: "90 days" },
    { value: "180", label: "180 days" },
    { value: "365", label: "1 year" },
    { value: "indefinite", label: "Indefinite" },
    { value: "custom", label: "Custom" },
] as const;

const PLAN_COLORS: Record<string, string> = {
    PLUS: "bg-blue-100 text-blue-800 border-blue-200",
    PRO: "bg-purple-100 text-purple-800 border-purple-200",
    MAX: "bg-amber-100 text-amber-900 border-amber-300",
};

const STATUS_COLORS: Record<string, string> = {
    ACTIVE: "bg-emerald-100 text-emerald-800 border-emerald-200",
    DISABLED: "bg-neutral-100 text-neutral-600 border-neutral-200",
    EXPIRED: "bg-rose-100 text-rose-700 border-rose-200",
    EXHAUSTED: "bg-slate-100 text-slate-600 border-slate-200",
};

function NotAuthorized() {
    const router = useRouter();
    useEffect(() => {
        const t = setTimeout(() => router.replace("/dashboard"), 2500);
        return () => clearTimeout(t);
    }, [router]);
    return (
        <div className="flex flex-col items-center justify-center flex-1 min-h-[60vh] text-center px-6">
            <div className="w-16 h-16 rounded-full bg-rose-50 flex items-center justify-center mb-5">
                <svg viewBox="0 0 24 24" className="h-8 w-8 text-rose-500" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
            </div>
            <h1 className="text-xl font-bold text-neutral-900">Page not found</h1>
            <p className="mt-2 text-sm text-neutral-500">Redirecting you back to the dashboard...</p>
        </div>
    );
}

export default function AdminCouponsPage() {
    const router = useRouter();
    const { session } = useAuth();
    const { isAdmin, loading: adminLoading } = useAdminCheck();

    const [coupons, setCoupons] = useState<CouponRow[]>([]);
    const [stats, setStats] = useState<Stats | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
    const [expandedCouponId, setExpandedCouponId] = useState<string | null>(null);

    const [creating, setCreating] = useState(false);
    const [createError, setCreateError] = useState<string | null>(null);
    const [lastCreatedCode, setLastCreatedCode] = useState<string | null>(null);

    const [form, setForm] = useState<CreateBody>({
        plan: "PLUS",
        durationPreset: "30",
        singleUse: true,
        notes: "",
    });

    // ── Minute grant state ──────────────────────────────────────
    const [creditEmail, setCreditEmail] = useState("");
    const [creditAmount, setCreditAmount] = useState<number | "">(10);
    const [creditNotes, setCreditNotes] = useState("");
    const [creditGranting, setCreditGranting] = useState(false);
    const [creditError, setCreditError] = useState<string | null>(null);
    const [creditSuccess, setCreditSuccess] = useState<string | null>(null);
    const [lookupUser, setLookupUser] = useState<{
        id: string;
        email: string;
        fullName: string;
        wallet: { free: number; monthly: number; purchased: number; total: number } | null;
    } | null>(null);
    const [lookupLoading, setLookupLoading] = useState(false);

    // ── Revoke access state ─────────────────────────────────────
    const [revokingRedemptionId, setRevokingRedemptionId] = useState<string | null>(null);
    const [revokeError, setRevokeError] = useState<string | null>(null);

    const token = session?.access_token;

    const loadCoupons = useCallback(async () => {
        if (!token) return;
        setLoading(true);
        try {
            const params = new URLSearchParams();
            params.set("status", statusFilter);
            if (searchQuery) params.set("search", searchQuery);
            const res = await api.get<{ coupons: CouponRow[]; total: number }>(
                `/admin/coupons?${params.toString()}`,
                token
            );
            setCoupons(res.coupons);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to load coupons");
        } finally {
            setLoading(false);
        }
    }, [token, searchQuery, statusFilter]);

    const loadStats = useCallback(async () => {
        if (!token) return;
        try {
            const res = await api.get<Stats>("/admin/coupons/stats", token);
            setStats(res);
        } catch {
            // ignore
        }
    }, [token]);

    useEffect(() => {
        if (!isAdmin || !token) return;
        loadCoupons();
        loadStats();
    }, [isAdmin, token, loadCoupons, loadStats]);

    const submitCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!token) return;
        setCreating(true);
        setCreateError(null);
        setLastCreatedCode(null);
        try {
            const body: CreateBody = {
                plan: form.plan,
                durationPreset: form.durationPreset,
                singleUse: form.singleUse,
            };
            if (form.durationPreset === "custom") {
                body.customDurationDays = form.customDurationDays;
            }
            if (!form.singleUse && form.maxRedemptions != null) {
                body.maxRedemptions = form.maxRedemptions;
            }
            if (form.allowedEmail) body.allowedEmail = form.allowedEmail.trim();
            if (form.code) body.code = form.code.trim().toUpperCase();
            if (form.notes) body.notes = form.notes.trim();

            const created = await api.post<{ code: string }>(
                "/admin/coupons",
                body,
                token
            );
            setLastCreatedCode(created.code);
            await loadCoupons();
            await loadStats();
            setForm({
                plan: "PLUS",
                durationPreset: "30",
                singleUse: true,
                notes: "",
            });
        } catch (e: any) {
            setCreateError(e?.message || "Failed to create coupon");
        } finally {
            setCreating(false);
        }
    };

    const toggleActive = async (id: string, active: boolean) => {
        if (!token) return;
        try {
            await api.patch(`/admin/coupons/${id}`, { active }, token);
            await loadCoupons();
            await loadStats();
        } catch (e: any) {
            setError(e?.message || "Failed to update coupon");
        }
    };

    const deleteCoupon = async (id: string) => {
        if (!token) return;
        if (!confirm("Delete this coupon? Only unredeemed coupons can be deleted.")) return;
        try {
            await api.delete(`/admin/coupons/${id}`, token);
            await loadCoupons();
            await loadStats();
        } catch (e: any) {
            setError(e?.message || "Failed to delete coupon");
        }
    };

    const copyCode = (code: string) => {
        navigator.clipboard.writeText(code).catch(() => {});
    };

    const byPlanMap = useMemo(() => {
        const m: Record<string, number> = {};
        for (const g of stats?.byPlan ?? []) {
            if (g.plan) m[g.plan] = g.count;
        }
        return m;
    }, [stats]);

    // ── Minute grant handlers ───────────────────────────────────
    const doLookup = async () => {
        if (!token || !creditEmail.trim()) return;
        setLookupLoading(true);
        setLookupUser(null);
        setCreditError(null);
        try {
            const res = await api.get<typeof lookupUser>(
                `/admin/users/lookup?email=${encodeURIComponent(creditEmail.trim())}`,
                token
            );
            setLookupUser(res);
        } catch (e: any) {
            setCreditError(e?.message || "User not found");
        } finally {
            setLookupLoading(false);
        }
    };

    const submitCreditGrant = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!token || !creditEmail.trim() || !creditAmount) return;
        setCreditGranting(true);
        setCreditError(null);
        setCreditSuccess(null);
        try {
            const res = await api.post<{
                success: boolean;
                user: { email: string; fullName: string };
                minutesGranted: number;
                newPurchasedBalance: number;
            }>("/admin/credits/grant", {
                email: creditEmail.trim(),
                amount: Number(creditAmount),
                notes: creditNotes.trim() || undefined,
            }, token);
            setCreditSuccess(
                `Granted ${res.minutesGranted} interview minutes to ${res.user.fullName || res.user.email}. New purchased balance: ${res.newPurchasedBalance}`
            );
            // Refresh lookup
            doLookup();
        } catch (e: any) {
            setCreditError(e?.message || "Failed to grant minutes");
        } finally {
            setCreditGranting(false);
        }
    };

    // ── Revoke access handler ───────────────────────────────────
    const revokeAccess = async (couponId: string, userId: string, redemptionId: string) => {
        if (!token) return;
        if (!confirm("Revoke access for this user? This will remove their coupon-granted plan access.")) return;
        
        setRevokingRedemptionId(redemptionId);
        setRevokeError(null);
        
        try {
            await api.post(
                `/admin/coupons/${couponId}/revoke-access`,
                { userId, reason: "Admin revoked via UI" },
                token
            );
            
            // Refresh coupon list to show updated revocation status
            await loadCoupons();
            await loadStats();
        } catch (e: any) {
            setRevokeError(e?.message || "Failed to revoke access");
        } finally {
            setRevokingRedemptionId(null);
        }
    };

    if (adminLoading) {
        return (
            <div className="flex items-center justify-center flex-1 min-h-[60vh]">
                <div className="size-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    if (!isAdmin) return <NotAuthorized />;

    return (
        <div className="flex-1 overflow-auto bg-neutral-50">
            <div className="mx-auto max-w-7xl px-6 py-8">
                {/* Header */}
                <div className="flex items-start justify-between gap-4 mb-8">
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 border border-amber-300 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-900">
                                <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10V7a4.5 4.5 0 10-9 0v3M5.25 10h13.5a1 1 0 011 1v9a1 1 0 01-1 1H5.25a1 1 0 01-1-1v-9a1 1 0 011-1z" />
                                </svg>
                                Admin
                            </span>
                        </div>
                        <h1 className="text-[28px] font-bold text-neutral-900 tracking-tight font-nunito">
                            Manage Coupons
                        </h1>
                        <p className="text-sm text-neutral-500 mt-1">
                            Generate, inspect, and revoke access codes. Signed in as{" "}
                            <span className="font-semibold text-neutral-700">{isAdmin ? session?.user?.email : ""}</span>
                        </p>
                    </div>
                    <button
                        onClick={() => router.push("/dashboard")}
                        className="rounded-lg border border-neutral-200 bg-white px-3.5 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50"
                    >
                        Back to Dashboard
                    </button>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
                    <StatCard label="Total Coupons" value={stats?.totalCoupons ?? "…"} />
                    <StatCard label="Active" value={stats?.activeCoupons ?? "…"} accent="emerald" />
                    <StatCard label="Total Redemptions" value={stats?.totalRedemptions ?? "…"} accent="blue" />
                    <StatCard
                        label="Distribution"
                        value={
                            <div className="flex gap-1.5 flex-wrap mt-1">
                                {["PLUS", "PRO", "MAX"].map((p) => (
                                    <span
                                        key={p}
                                        className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${
                                            PLAN_COLORS[p]
                                        }`}
                                    >
                                        {p} {byPlanMap[p] ?? 0}
                                    </span>
                                ))}
                            </div>
                        }
                    />
                </div>

                {/* ── Minute Grant Section ──────────────────────── */}
                <div className="bg-white border border-neutral-200 rounded-2xl overflow-hidden mb-8 shadow-sm">
                    <div className="px-6 py-4 border-b border-neutral-100 flex items-center gap-2">
                        <svg viewBox="0 0 24 24" className="h-5 w-5 text-emerald-600" fill="none" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <h2 className="text-base font-bold text-neutral-900">Grant interview minutes to a user</h2>
                    </div>
                    <form onSubmit={submitCreditGrant} className="p-6">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            {/* Email + lookup */}
                            <div className="md:col-span-2">
                                <label className="block text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-2">
                                    User email
                                </label>
                                <div className="flex gap-2">
                                    <input
                                        type="email"
                                        placeholder="user@example.com"
                                        value={creditEmail}
                                        onChange={(e) => {
                                            setCreditEmail(e.target.value);
                                            setLookupUser(null);
                                            setCreditSuccess(null);
                                        }}
                                        className="flex-1 rounded-lg border border-neutral-200 px-3 py-2 text-sm"
                                        required
                                    />
                                    <button
                                        type="button"
                                        onClick={doLookup}
                                        disabled={lookupLoading || !creditEmail.trim()}
                                        className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
                                    >
                                        {lookupLoading ? "…" : "Lookup"}
                                    </button>
                                </div>
                            </div>

                            {/* Amount */}
                            <div>
                                <label className="block text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-2">
                                    Minutes to grant
                                </label>
                                <div className="flex gap-1.5 flex-wrap">
                                    {[5, 10, 25, 50, 100].map((n) => (
                                        <button
                                            key={n}
                                            type="button"
                                            onClick={() => setCreditAmount(n)}
                                            className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                                                creditAmount === n
                                                    ? "bg-emerald-500 text-white border-emerald-500"
                                                    : "bg-white border-neutral-200 text-neutral-600 hover:border-emerald-300"
                                            }`}
                                        >
                                            {n}
                                        </button>
                                    ))}
                                    <input
                                        type="number"
                                        min={1}
                                        max={10000}
                                        placeholder="Custom"
                                        value={creditAmount}
                                        onChange={(e) =>
                                            setCreditAmount(e.target.value ? parseInt(e.target.value) : "")
                                        }
                                        className="w-20 rounded-lg border border-neutral-200 px-2 py-1.5 text-xs text-center"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Lookup result */}
                        {lookupUser && (
                            <div className="mt-4 flex items-center gap-4 rounded-xl border border-neutral-100 bg-neutral-50 p-4">
                                <div className="h-10 w-10 rounded-full bg-emerald-100 flex items-center justify-center text-sm font-bold text-emerald-700 shrink-0">
                                    {(lookupUser.fullName || lookupUser.email).charAt(0).toUpperCase()}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="text-sm font-semibold text-neutral-900 truncate">
                                        {lookupUser.fullName || "—"}
                                    </div>
                                    <div className="text-xs text-neutral-500 truncate">
                                        {lookupUser.email}
                                    </div>
                                </div>
                                {lookupUser.wallet ? (
                                    <div className="flex gap-3 text-xs">
                                        <div className="text-center">
                                            <div className="font-bold text-neutral-900">{lookupUser.wallet.total}</div>
                                            <div className="text-neutral-500">Total</div>
                                        </div>
                                        <div className="text-center">
                                            <div className="font-semibold text-blue-600">{lookupUser.wallet.free}</div>
                                            <div className="text-neutral-500">Free</div>
                                        </div>
                                        <div className="text-center">
                                            <div className="font-semibold text-purple-600">{lookupUser.wallet.monthly}</div>
                                            <div className="text-neutral-500">Monthly</div>
                                        </div>
                                        <div className="text-center">
                                            <div className="font-semibold text-emerald-600">{lookupUser.wallet.purchased}</div>
                                            <div className="text-neutral-500">Purchased</div>
                                        </div>
                                    </div>
                                ) : (
                                    <span className="text-xs text-neutral-400">No wallet yet</span>
                                )}
                            </div>
                        )}

                        {/* Notes + submit */}
                        <div className="mt-4 flex items-end gap-3">
                            <div className="flex-1">
                                <label className="block text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-2">
                                    Internal note (optional)
                                </label>
                                <input
                                    type="text"
                                    placeholder="e.g. Beta tester reward"
                                    value={creditNotes}
                                    onChange={(e) => setCreditNotes(e.target.value)}
                                    className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm"
                                    maxLength={500}
                                />
                            </div>
                            <button
                                type="submit"
                                disabled={creditGranting || !creditEmail.trim() || !creditAmount}
                                className="rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white px-6 py-2.5 text-sm font-bold shadow-sm disabled:opacity-50"
                            >
                                {creditGranting ? "Granting…" : "Grant minutes"}
                            </button>
                        </div>

                        {creditError && (
                            <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-700">
                                {creditError}
                            </div>
                        )}
                        {creditSuccess && (
                            <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
                                ✓ {creditSuccess}
                            </div>
                        )}
                    </form>
                </div>

                {/* Generate Form */}
                <div className="bg-white border border-neutral-200 rounded-2xl overflow-hidden mb-8 shadow-sm">
                    <div className="px-6 py-4 border-b border-neutral-100 flex items-center gap-2">
                        <svg viewBox="0 0 24 24" className="h-5 w-5 text-amber-600" fill="none" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                        </svg>
                        <h2 className="text-base font-bold text-neutral-900">Generate a new coupon</h2>
                    </div>
                    <form onSubmit={submitCreate} className="p-6 grid grid-cols-1 md:grid-cols-2 gap-5">
                        {/* Plan */}
                        <div>
                            <label className="block text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-2">
                                Access level
                            </label>
                            <div className="flex gap-2">
                                {(["PLUS", "PRO", "MAX"] as const).map((p) => (
                                    <button
                                        key={p}
                                        type="button"
                                        onClick={() => setForm((f) => ({ ...f, plan: p }))}
                                        className={`flex-1 rounded-xl border-2 px-3 py-2.5 text-sm font-bold transition-all ${
                                            form.plan === p
                                                ? `${PLAN_COLORS[p]} border-current`
                                                : "bg-white border-neutral-200 text-neutral-500 hover:border-neutral-300"
                                        }`}
                                    >
                                        {p}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Duration */}
                        <div>
                            <label className="block text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-2">
                                Validity
                            </label>
                            <div className="flex flex-wrap gap-1.5">
                                {DURATION_PRESETS.map((p) => (
                                    <button
                                        key={p.value}
                                        type="button"
                                        onClick={() =>
                                            setForm((f) => ({ ...f, durationPreset: p.value }))
                                        }
                                        className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                                            form.durationPreset === p.value
                                                ? "bg-primary text-white border-primary"
                                                : "bg-white border-neutral-200 text-neutral-600 hover:border-primary/40"
                                        }`}
                                    >
                                        {p.label}
                                    </button>
                                ))}
                            </div>
                            {form.durationPreset === "custom" && (
                                <input
                                    type="number"
                                    placeholder="Number of days (1–3650)"
                                    value={form.customDurationDays ?? ""}
                                    onChange={(e) =>
                                        setForm((f) => ({
                                            ...f,
                                            customDurationDays: parseInt(e.target.value) || undefined,
                                        }))
                                    }
                                    className="mt-2 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm"
                                />
                            )}
                        </div>

                        {/* Single use / multi-use */}
                        <div>
                            <label className="block text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-2">
                                Redemptions
                            </label>
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => setForm((f) => ({ ...f, singleUse: true }))}
                                    className={`flex-1 rounded-xl border-2 px-3 py-2.5 text-sm font-bold transition-all ${
                                        form.singleUse
                                            ? "bg-primary/5 border-primary text-primary"
                                            : "bg-white border-neutral-200 text-neutral-500 hover:border-neutral-300"
                                    }`}
                                >
                                    Single use
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setForm((f) => ({ ...f, singleUse: false }))}
                                    className={`flex-1 rounded-xl border-2 px-3 py-2.5 text-sm font-bold transition-all ${
                                        !form.singleUse
                                            ? "bg-primary/5 border-primary text-primary"
                                            : "bg-white border-neutral-200 text-neutral-500 hover:border-neutral-300"
                                    }`}
                                >
                                    Multi-use
                                </button>
                            </div>
                            {!form.singleUse && (
                                <input
                                    type="number"
                                    placeholder="Max redemptions (blank = unlimited)"
                                    value={form.maxRedemptions ?? ""}
                                    onChange={(e) =>
                                        setForm((f) => ({
                                            ...f,
                                            maxRedemptions: e.target.value ? parseInt(e.target.value) : null,
                                        }))
                                    }
                                    className="mt-2 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm"
                                />
                            )}
                        </div>

                        {/* Email restriction */}
                        <div>
                            <label className="block text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-2">
                                Restrict to email (optional)
                            </label>
                            <input
                                type="email"
                                placeholder="leave blank for anyone"
                                value={form.allowedEmail ?? ""}
                                onChange={(e) =>
                                    setForm((f) => ({ ...f, allowedEmail: e.target.value }))
                                }
                                className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm"
                            />
                        </div>

                        {/* Custom code */}
                        <div>
                            <label className="block text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-2">
                                Custom code (optional)
                            </label>
                            <input
                                type="text"
                                placeholder="auto-generated if blank"
                                value={form.code ?? ""}
                                onChange={(e) =>
                                    setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))
                                }
                                className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm font-mono uppercase"
                                maxLength={32}
                            />
                        </div>

                        {/* Notes */}
                        <div>
                            <label className="block text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-2">
                                Internal notes (optional)
                            </label>
                            <input
                                type="text"
                                placeholder="e.g. Early access beta tester"
                                value={form.notes ?? ""}
                                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                                className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm"
                                maxLength={500}
                            />
                        </div>

                        <div className="md:col-span-2 flex items-center gap-3 border-t border-neutral-100 pt-5">
                            <button
                                type="submit"
                                disabled={creating}
                                className="rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white px-6 py-2.5 text-sm font-bold shadow-sm disabled:opacity-50"
                            >
                                {creating ? "Generating..." : "Generate coupon"}
                            </button>
                            {createError && (
                                <span className="text-sm text-rose-600 font-medium">{createError}</span>
                            )}
                            {lastCreatedCode && (
                                <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm text-emerald-800">
                                    <span className="font-bold">Code:</span>
                                    <code className="font-mono font-bold">{lastCreatedCode}</code>
                                    <button
                                        type="button"
                                        onClick={() => copyCode(lastCreatedCode)}
                                        className="text-xs text-emerald-700 underline"
                                    >
                                        copy
                                    </button>
                                </div>
                            )}
                        </div>
                    </form>
                </div>

                {/* List controls */}
                <div className="flex items-center gap-3 mb-4">
                    <input
                        type="text"
                        placeholder="Search by code..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="flex-1 rounded-lg border border-neutral-200 bg-white px-3.5 py-2 text-sm"
                    />
                    <div className="flex rounded-lg border border-neutral-200 bg-white overflow-hidden">
                        {(["all", "active", "inactive"] as const).map((f) => (
                            <button
                                key={f}
                                onClick={() => setStatusFilter(f)}
                                className={`px-3 py-2 text-xs font-semibold uppercase tracking-wide ${
                                    statusFilter === f
                                        ? "bg-primary text-white"
                                        : "text-neutral-600 hover:bg-neutral-50"
                                }`}
                            >
                                {f}
                            </button>
                        ))}
                    </div>
                    <button
                        onClick={() => {
                            loadCoupons();
                            loadStats();
                        }}
                        className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50"
                    >
                        Refresh
                    </button>
                </div>

                {error && (
                    <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                        {error}
                    </div>
                )}

                {/* Coupons table */}
                <div className="bg-white border border-neutral-200 rounded-2xl overflow-hidden shadow-sm">
                    {loading ? (
                        <div className="flex items-center justify-center py-16">
                            <div className="size-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                        </div>
                    ) : coupons.length === 0 ? (
                        <div className="py-16 text-center text-sm text-neutral-500">
                            No coupons yet. Generate one above.
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-neutral-50 border-b border-neutral-200">
                                    <tr>
                                        <th className="text-left px-4 py-3 font-semibold text-neutral-600 text-xs uppercase tracking-wide">Code</th>
                                        <th className="text-left px-4 py-3 font-semibold text-neutral-600 text-xs uppercase tracking-wide">Plan</th>
                                        <th className="text-left px-4 py-3 font-semibold text-neutral-600 text-xs uppercase tracking-wide">Validity</th>
                                        <th className="text-left px-4 py-3 font-semibold text-neutral-600 text-xs uppercase tracking-wide">Redemptions</th>
                                        <th className="text-left px-4 py-3 font-semibold text-neutral-600 text-xs uppercase tracking-wide">Scope</th>
                                        <th className="text-left px-4 py-3 font-semibold text-neutral-600 text-xs uppercase tracking-wide">Status</th>
                                        <th className="text-left px-4 py-3 font-semibold text-neutral-600 text-xs uppercase tracking-wide">Created</th>
                                        <th className="text-right px-4 py-3 font-semibold text-neutral-600 text-xs uppercase tracking-wide">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {coupons.map((c) => (
                                        <Fragment key={c.id}>
                                            <tr className="border-b border-neutral-100 hover:bg-neutral-50/50">
                                                <td className="px-4 py-3">
                                                    <div className="flex items-center gap-2">
                                                        <code className="font-mono font-bold text-neutral-900">
                                                            {c.code}
                                                        </code>
                                                        <button
                                                            onClick={() => copyCode(c.code)}
                                                            title="Copy"
                                                            className="text-neutral-400 hover:text-neutral-700"
                                                        >
                                                            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                                                                <rect x="9" y="9" width="13" height="13" rx="2" />
                                                                <path d="M5 15V5a2 2 0 012-2h10" />
                                                            </svg>
                                                        </button>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3">
                                                    {c.plan && (
                                                        <span
                                                            className={`inline-flex rounded border px-2 py-0.5 text-[11px] font-bold ${
                                                                PLAN_COLORS[c.plan] || ""
                                                            }`}
                                                        >
                                                            {c.plan}
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3 text-neutral-600">
                                                    {c.durationDays && c.durationDays >= 365 * 50
                                                        ? "Indefinite"
                                                        : c.durationDays
                                                        ? `${c.durationDays} days`
                                                        : "—"}
                                                </td>
                                                <td className="px-4 py-3 text-neutral-600">
                                                    <span className="font-semibold text-neutral-900">
                                                        {c.redemptions}
                                                    </span>
                                                    {c.maxRedemptions != null
                                                        ? ` / ${c.maxRedemptions}`
                                                        : " / ∞"}
                                                </td>
                                                <td className="px-4 py-3">
                                                    {c.allowedEmail ? (
                                                        <span className="text-xs text-neutral-700 font-medium truncate max-w-[160px] block">
                                                            {c.allowedEmail}
                                                        </span>
                                                    ) : (
                                                        <span className="text-xs text-neutral-400">Public</span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3">
                                                    <span
                                                        className={`inline-flex rounded border px-2 py-0.5 text-[11px] font-bold ${
                                                            STATUS_COLORS[c.status] || ""
                                                        }`}
                                                    >
                                                        {c.status}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 text-neutral-500 text-xs">
                                                    {new Date(c.createdAt).toLocaleDateString()}
                                                </td>
                                                <td className="px-4 py-3 text-right whitespace-nowrap">
                                                    <button
                                                        onClick={() =>
                                                            setExpandedCouponId(
                                                                expandedCouponId === c.id ? null : c.id
                                                            )
                                                        }
                                                        className="text-xs font-semibold text-primary hover:underline mr-3"
                                                    >
                                                        {expandedCouponId === c.id ? "Hide" : "Details"}
                                                    </button>
                                                    {c.active ? (
                                                        <button
                                                            onClick={() => toggleActive(c.id, false)}
                                                            className="text-xs font-semibold text-neutral-600 hover:text-rose-600"
                                                        >
                                                            Disable
                                                        </button>
                                                    ) : (
                                                        <button
                                                            onClick={() => toggleActive(c.id, true)}
                                                            className="text-xs font-semibold text-emerald-600 hover:underline mr-3"
                                                            disabled={c.status === "EXHAUSTED"}
                                                        >
                                                            Enable
                                                        </button>
                                                    )}
                                                    {c.redemptions === 0 && (
                                                        <button
                                                            onClick={() => deleteCoupon(c.id)}
                                                            className="text-xs font-semibold text-rose-500 hover:underline ml-3"
                                                        >
                                                            Delete
                                                        </button>
                                                    )}
                                                </td>
                                            </tr>
                                            {expandedCouponId === c.id && (
                                                <tr className="bg-neutral-50/60 border-b border-neutral-100">
                                                    <td colSpan={8} className="px-4 py-4">
                                                        <CouponDetails 
                                                            coupon={c} 
                                                            onRevokeAccess={revokeAccess}
                                                            revokingRedemptionId={revokingRedemptionId}
                                                            revokeError={revokeError}
                                                        />
                                                    </td>
                                                </tr>
                                            )}
                                        </Fragment>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function StatCard({
    label,
    value,
    accent,
}: {
    label: string;
    value: React.ReactNode;
    accent?: "emerald" | "blue";
}) {
    const accentClass =
        accent === "emerald"
            ? "text-emerald-600"
            : accent === "blue"
            ? "text-blue-600"
            : "text-neutral-900";
    return (
        <div className="bg-white border border-neutral-200 rounded-xl p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                {label}
            </div>
            <div className={`mt-1 text-2xl font-bold ${accentClass}`}>{value}</div>
        </div>
    );
}

function CouponDetails({ 
    coupon, 
    onRevokeAccess,
    revokingRedemptionId,
    revokeError
}: { 
    coupon: CouponRow;
    onRevokeAccess: (couponId: string, userId: string, redemptionId: string) => void;
    revokingRedemptionId: string | null;
    revokeError: string | null;
}) {
    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-1">
                    Created
                </div>
                <div className="text-sm text-neutral-800">
                    {new Date(coupon.createdAt).toLocaleString()}
                </div>
                {coupon.createdBy && (
                    <div className="text-xs text-neutral-500 mt-0.5">by {coupon.createdBy}</div>
                )}
            </div>
            <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-1">
                    Notes
                </div>
                <div className="text-sm text-neutral-800">{coupon.notes || "—"}</div>
            </div>
            <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-1">
                    Expires
                </div>
                <div className="text-sm text-neutral-800">
                    {coupon.expiresAt
                        ? new Date(coupon.expiresAt).toLocaleString()
                        : "Never"}
                </div>
            </div>
            <div className="md:col-span-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-2">
                    Redemption history ({coupon.redemptions_log.length})
                </div>
                {revokeError && (
                    <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-700">
                        {revokeError}
                    </div>
                )}
                {coupon.redemptions_log.length === 0 ? (
                    <div className="text-sm text-neutral-500">Not redeemed yet.</div>
                ) : (
                    <div className="space-y-1.5">
                        {coupon.redemptions_log.map((r) => (
                            <div
                                key={r.id}
                                className="flex items-center justify-between gap-4 rounded-lg bg-white border border-neutral-100 px-3 py-2"
                            >
                                <div className="flex items-center gap-3 min-w-0 flex-1">
                                    <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-[11px] font-bold text-primary shrink-0">
                                        {(r.userName || r.userEmail || "?").charAt(0).toUpperCase()}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="text-sm font-medium text-neutral-900 truncate">
                                            {r.userName || "—"}
                                        </div>
                                        <div className="text-xs text-neutral-500 truncate">
                                            {r.userEmail}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3 shrink-0">
                                    <div className="text-xs text-neutral-500">
                                        {new Date(r.redeemedAt).toLocaleString()}
                                    </div>
                                    {r.isRevoked ? (
                                        <div className="flex flex-col items-end gap-0.5">
                                            <span className="inline-flex rounded border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700">
                                                REVOKED
                                            </span>
                                            {r.revokedAt && (
                                                <span className="text-[10px] text-neutral-400">
                                                    {new Date(r.revokedAt).toLocaleDateString()}
                                                </span>
                                            )}
                                            {r.revokedBy && (
                                                <span className="text-[10px] text-neutral-400">
                                                    by {r.revokedBy}
                                                </span>
                                            )}
                                        </div>
                                    ) : (
                                        <button
                                            onClick={() => onRevokeAccess(coupon.id, r.userId, r.id)}
                                            disabled={revokingRedemptionId === r.id}
                                            className="rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                        >
                                            {revokingRedemptionId === r.id ? "Revoking..." : "Revoke Access"}
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
