// ============================================
// Entitlements — plan resolution, credit wallet,
// feature usage, and hourly cap enforcement.
//
// This is the ONLY module that writes to:
//   - credit_wallets / credit_ledger
//   - feature_usage
//   - hourly_submission_counters
// Routes must go through requireEntitlement() / consumeCredits()
// so all enforcement is in one place.
// ============================================

import { Prisma, PrismaClient } from "@prisma/client";
import {
    PLAN_ENTITLEMENTS,
    PlanKey,
    getEntitlements,
    interviewMinuteCost,
} from "@interviewforge/shared";
import { prisma } from "../lib/prisma.js";
import { invalidateUserPlanCache, getCachedPlanData } from "./cache.js";
import { broadcastPlanUpdate } from "./plan-websocket.js";

const LEGACY_CREDIT_TO_MINUTES = 30;
const LEGACY_CREDIT_MIGRATION_REASON = "legacy_credit_to_minute_migration";
const LEGACY_CREDIT_LEDGER_REASONS = [
    "credit_pack_purchase",
    "monthly_grant",
    "plan_upgrade_topup",
    "PHONE_VERIFICATION_REWARD",
    "admin_adjust",
    "admin_remove",
];

async function notifyPlanChange(userId: string): Promise<void> {
    try {
        const planData = await getCachedPlanData(userId);
        broadcastPlanUpdate(userId, {
            plan: planData.plan,
            entitlements: planData.entitlements,
            wallet: planData.wallet,
            usage: planData.usage,
        });
    } catch (err) {
        console.error(`[Entitlements] Failed to broadcast plan update for user ${userId.slice(0, 8)}:`, err);
    }
}

export type FeatureKey =
    | "resume_analysis"
    | "resume_improve_ai"
    | "latex_ai_tokens"
    | "tutor_tokens";

export class EntitlementError extends Error {
    code: string;
    plan: PlanKey;
    statusCode: number;
    detail?: Record<string, unknown>;

    constructor(
        code: string,
        message: string,
        plan: PlanKey,
        statusCode = 402,
        detail?: Record<string, unknown>
    ) {
        super(message);
        this.name = "EntitlementError";
        this.code = code;
        this.plan = plan;
        this.statusCode = statusCode;
        this.detail = detail;
    }
}

// ------------------------------------------------------------
// Plan resolution
// ------------------------------------------------------------

export async function getActivePlan(
    userId: string,
    client: Prisma.TransactionClient | PrismaClient = prisma
): Promise<PlanKey> {
    // Include authenticated, active, and cancelled subscriptions
    // - authenticated: first payment completed
    // - active: recurring subscription with multiple payments
    // - cancelled: subscription cancelled but still valid until currentPeriodEnd
    // DO NOT include 'created' status as payment hasn't been verified yet
    const sub = await client.subscription.findFirst({
        where: {
            userId,
            status: { in: ["active", "authenticated", "cancelled"] },
            OR: [
                { currentPeriodEnd: null },
                { currentPeriodEnd: { gt: new Date() } },
            ],
        },
        orderBy: { createdAt: "desc" },
    });
    return (sub?.plan as PlanKey) ?? "FREE";
}

// ------------------------------------------------------------
// Wallet
// ------------------------------------------------------------

export async function ensureWallet(
    userId: string,
    client: Prisma.TransactionClient | PrismaClient = prisma
) {
    const existing = await client.creditWallet.findUnique({ where: { userId } });
    if (existing) return ensureLegacyCreditWalletMigrated(userId, existing, client);

    const ent = getEntitlements("FREE");
    return client.creditWallet.create({
        data: {
            userId,
            freeCreditsRemaining: ent.lifetimeFreeInterviewMinutes,
            freeCreditsGranted: true,
            monthlyBalance: 0,
            purchasedBalance: 0,
        },
    });
}

async function ensureLegacyCreditWalletMigrated(
    userId: string,
    wallet: Awaited<ReturnType<typeof prisma.creditWallet.findUnique>>,
    client: Prisma.TransactionClient | PrismaClient = prisma
) {
    if (!wallet) return wallet;

    const alreadyMigrated = await client.creditLedger.findFirst({
        where: { userId, reason: LEGACY_CREDIT_MIGRATION_REASON },
        select: { id: true },
    });
    if (alreadyMigrated) return wallet;

    const legacyLedger = await client.creditLedger.findFirst({
        where: {
            userId,
            reason: { in: LEGACY_CREDIT_LEDGER_REASONS },
        },
        select: { id: true },
    });
    if (!legacyLedger) return wallet;

    const current = {
        free: wallet.freeCreditsRemaining,
        monthly: wallet.monthlyBalance,
        purchased: wallet.purchasedBalance,
    };
    const migrated = {
        free: current.free * LEGACY_CREDIT_TO_MINUTES,
        monthly: current.monthly * LEGACY_CREDIT_TO_MINUTES,
        purchased: current.purchased * LEGACY_CREDIT_TO_MINUTES,
    };
    const delta = {
        free: migrated.free - current.free,
        monthly: migrated.monthly - current.monthly,
        purchased: migrated.purchased - current.purchased,
    };

    const updated = await client.creditWallet.update({
        where: { userId },
        data: {
            freeCreditsRemaining: migrated.free,
            monthlyBalance: migrated.monthly,
            purchasedBalance: migrated.purchased,
        },
    });

    const balanceAfter = {
        free: updated.freeCreditsRemaining,
        monthly: updated.monthlyBalance,
        purchased: updated.purchasedBalance,
    };

    let wroteMarker = false;
    for (const [bucket, amount] of [
        ["FREE", delta.free],
        ["MONTHLY", delta.monthly],
        ["PURCHASED", delta.purchased],
    ] as const) {
        if (amount > 0) {
            wroteMarker = true;
            await client.creditLedger.create({
                data: {
                    userId,
                    walletId: wallet.id,
                    bucket,
                    delta: amount,
                    reason: LEGACY_CREDIT_MIGRATION_REASON,
                    refType: "wallet_migration",
                    refId: wallet.id,
                    balanceAfter,
                },
            });
        }
    }

    if (!wroteMarker) {
        await client.creditLedger.create({
            data: {
                userId,
                walletId: wallet.id,
                bucket: "MIGRATION",
                delta: 0,
                reason: LEGACY_CREDIT_MIGRATION_REASON,
                refType: "wallet_migration",
                refId: wallet.id,
                balanceAfter,
            },
        });
    }

    return updated;
}

export function shouldApplyMonthlyPlanTopUp(params: {
    entitledMonthlyInterviewMinutes: number;
    walletMonthlyBalance: number;
    hasGrantForCurrentPlanThisPeriod: boolean;
}): boolean {
    const {
        entitledMonthlyInterviewMinutes,
        walletMonthlyBalance,
        hasGrantForCurrentPlanThisPeriod,
    } = params;

    if (entitledMonthlyInterviewMinutes <= walletMonthlyBalance) {
        return false;
    }

    return !hasGrantForCurrentPlanThisPeriod;
}

// Grant monthly interview minutes for the user's current plan at the start of each billing period.
// Safe to call on every credit read — idempotent by (userId, plan period).
export async function ensureMonthlyGrant(
    userId: string,
    client: Prisma.TransactionClient | PrismaClient = prisma
) {
    const plan = await getActivePlan(userId, client);
    const ent = PLAN_ENTITLEMENTS[plan];
    if (ent.monthlyInterviewMinutes === 0) return;

    const wallet = await ensureWallet(userId, client);
    const now = new Date();
    const lastGrant = wallet.monthlyGrantedAt ?? new Date(0);

    // Grant once per rolling month (UTC, first day of current month).
    const currentPeriodStart = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
    );

    if (lastGrant >= currentPeriodStart) {
        // Already granted this month. Only top up for an actual plan change.
        // Do NOT refill spent monthly minutes during normal reads.
        if (ent.monthlyInterviewMinutes > wallet.monthlyBalance) {
            const alreadyGrantedForCurrentPlan = await client.creditLedger.findFirst({
                where: {
                    userId,
                    bucket: "MONTHLY",
                    delta: { gt: 0 },
                    refType: "plan",
                    refId: plan,
                    createdAt: { gte: currentPeriodStart },
                },
                select: { id: true },
            });

            if (!shouldApplyMonthlyPlanTopUp({
                entitledMonthlyInterviewMinutes: ent.monthlyInterviewMinutes,
                walletMonthlyBalance: wallet.monthlyBalance,
                hasGrantForCurrentPlanThisPeriod: Boolean(alreadyGrantedForCurrentPlan),
            })) {
                return;
            }

            const delta = ent.monthlyInterviewMinutes - wallet.monthlyBalance;
            await client.creditWallet.update({
                where: { userId },
                data: { monthlyBalance: ent.monthlyInterviewMinutes },
            });
            await client.creditLedger.create({
                data: {
                    userId,
                    walletId: wallet.id,
                    bucket: "MONTHLY",
                    delta,
                    reason: "plan_upgrade_minutes_topup",
                    refType: "plan",
                    refId: plan,
                    balanceAfter: {
                        free: wallet.freeCreditsRemaining,
                        monthly: ent.monthlyInterviewMinutes,
                        purchased: wallet.purchasedBalance,
                    },
                },
            });
        }
        return;
    }

    // New period: reset monthly balance to plan grant (monthly bucket does not roll over).
    await client.creditWallet.update({
        where: { userId },
        data: {
            monthlyBalance: ent.monthlyInterviewMinutes,
            monthlyGrantedAt: now,
            monthlyResetAt: new Date(
                Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
            ),
        },
    });

    await client.creditLedger.create({
        data: {
            userId,
            walletId: wallet.id,
            bucket: "MONTHLY",
            delta: ent.monthlyInterviewMinutes,
            reason: "monthly_interview_minutes_grant",
            refType: "plan",
            refId: plan,
            balanceAfter: {
                free: wallet.freeCreditsRemaining,
                monthly: ent.monthlyInterviewMinutes,
                purchased: wallet.purchasedBalance,
            },
        },
    });
}

export async function getWalletSnapshot(userId: string) {
    await ensureWallet(userId);
    await ensureMonthlyGrant(userId);
    const wallet = await prisma.creditWallet.findUnique({ where: { userId } });
    if (!wallet) throw new Error("wallet missing after ensure");
    return {
        free: wallet.freeCreditsRemaining,
        monthly: wallet.monthlyBalance,
        purchased: wallet.purchasedBalance,
        total: wallet.freeCreditsRemaining + wallet.monthlyBalance + wallet.purchasedBalance,
        monthlyResetAt: wallet.monthlyResetAt,
    };
}

// ------------------------------------------------------------
// Credit consumption — transactional, ledgered.
// Order: free → monthly → purchased (user's FREE grant first, then period, then top-up).
// ------------------------------------------------------------

export type ConsumeResult = {
    success: true;
    spent: { free: number; monthly: number; purchased: number };
    remainingTotal: number;
    ledgerIds: string[];
};

export async function reserveInterviewMinutesInTransaction(
    tx: Prisma.TransactionClient,
    userId: string,
    cost: number,
    reason: string,
    ref: { type: string; id: string }
): Promise<ConsumeResult> {
    if (cost <= 0) throw new Error("cost must be positive");

    await ensureWallet(userId, tx);
    await ensureMonthlyGrant(userId, tx);

    const wallet = await tx.creditWallet.findUnique({
        where: { userId },
    });
    if (!wallet) throw new Error("wallet not found");

    const total =
        wallet.freeCreditsRemaining +
        wallet.monthlyBalance +
        wallet.purchasedBalance;
    if (total < cost) {
        const plan = await getActivePlan(userId, tx);
        throw new EntitlementError(
            "INSUFFICIENT_CREDITS",
            `This interview needs ${cost} minutes. You have ${total} minutes.`,
            plan,
            402,
            { required: cost, available: total }
        );
    }

    let remaining = cost;
    let useFree = 0;
    let useMonthly = 0;
    let usePurchased = 0;

    useFree = Math.min(remaining, wallet.freeCreditsRemaining);
    remaining -= useFree;
    useMonthly = Math.min(remaining, wallet.monthlyBalance);
    remaining -= useMonthly;
    usePurchased = Math.min(remaining, wallet.purchasedBalance);
    remaining -= usePurchased;

    const updated = await tx.creditWallet.update({
        where: { userId },
        data: {
            freeCreditsRemaining: { decrement: useFree },
            monthlyBalance: { decrement: useMonthly },
            purchasedBalance: { decrement: usePurchased },
        },
    });

    const ledgerEntries: string[] = [];
    const after = {
        free: updated.freeCreditsRemaining,
        monthly: updated.monthlyBalance,
        purchased: updated.purchasedBalance,
    };

    for (const [bucket, amount] of [
        ["FREE", useFree],
        ["MONTHLY", useMonthly],
        ["PURCHASED", usePurchased],
    ] as const) {
        if (amount > 0) {
            const row = await tx.creditLedger.create({
                data: {
                    userId,
                    walletId: wallet.id,
                    bucket,
                    delta: -amount,
                    reason,
                    refType: ref.type,
                    refId: ref.id,
                    balanceAfter: after,
                },
            });
            ledgerEntries.push(row.id);
        }
    }

    return {
        success: true,
        spent: { free: useFree, monthly: useMonthly, purchased: usePurchased },
        remainingTotal:
            updated.freeCreditsRemaining +
            updated.monthlyBalance +
            updated.purchasedBalance,
        ledgerIds: ledgerEntries,
    };
}

export async function consumeCreditsInTransaction(
    tx: Prisma.TransactionClient,
    userId: string,
    cost: number,
    reason: string,
    ref: { type: string; id: string }
): Promise<ConsumeResult> {
    return reserveInterviewMinutesInTransaction(tx, userId, cost, reason, ref);
}

export async function reserveInterviewMinutes(
    userId: string,
    cost: number,
    reason: string,
    ref: { type: string; id: string }
): Promise<ConsumeResult> {
    const result = await prisma.$transaction((tx) =>
        reserveInterviewMinutesInTransaction(tx, userId, cost, reason, ref)
    );
    
    // Invalidate cache after credit consumption and broadcast fresh plan
    await invalidateUserPlanCache(userId);
    await notifyPlanChange(userId);

    return result;
}

export async function refundCredits(
    userId: string,
    spent: { free: number; monthly: number; purchased: number },
    reason: string,
    ref: { type: string; id: string },
    options: { broadcast?: boolean } = {}
) {
    const result = await prisma.$transaction(async (tx) => {
        const wallet = await tx.creditWallet.findUnique({ where: { userId } });
        if (!wallet) throw new Error("wallet missing on refund");

        const updated = await tx.creditWallet.update({
            where: { userId },
            data: {
                freeCreditsRemaining: { increment: spent.free },
                monthlyBalance: { increment: spent.monthly },
                purchasedBalance: { increment: spent.purchased },
            },
        });

        const after = {
            free: updated.freeCreditsRemaining,
            monthly: updated.monthlyBalance,
            purchased: updated.purchasedBalance,
        };

        for (const [bucket, amount] of [
            ["FREE", spent.free],
            ["MONTHLY", spent.monthly],
            ["PURCHASED", spent.purchased],
        ] as const) {
            if (amount > 0) {
                await tx.creditLedger.create({
                    data: {
                        userId,
                        walletId: wallet.id,
                        bucket,
                        delta: amount,
                        reason,
                        refType: ref.type,
                        refId: ref.id,
                        balanceAfter: after,
                    },
                });
            }
        }
    });
    
    if (options.broadcast !== false) {
        // Invalidate cache after minute refund and broadcast fresh plan
        await invalidateUserPlanCache(userId);
        await notifyPlanChange(userId);
    }

    return result;
}

// Add purchased interview minutes (minute pack).
export async function grantPurchasedInterviewMinutes(
    userId: string,
    minutes: number,
    ref: { type: string; id: string }
) {
    const result = await prisma.$transaction(async (tx) => {
        const wallet = await ensureWallet(userId, tx);
        const updated = await tx.creditWallet.update({
            where: { userId },
            data: { purchasedBalance: { increment: minutes } },
        });
        await tx.creditLedger.create({
            data: {
                userId,
                walletId: wallet.id,
                bucket: "PURCHASED",
                delta: minutes,
                reason: "minute_pack_purchase",
                refType: ref.type,
                refId: ref.id,
                balanceAfter: {
                    free: updated.freeCreditsRemaining,
                    monthly: updated.monthlyBalance,
                    purchased: updated.purchasedBalance,
                },
            },
        });
    });
    
    // Invalidate cache after granting minutes and broadcast fresh plan
    await invalidateUserPlanCache(userId);
    await notifyPlanChange(userId);

    return result;
}

// ------------------------------------------------------------
// Interview entitlement gate
// ------------------------------------------------------------

export async function requireInterviewCredit(
    userId: string,
    interviewType: string
): Promise<{ cost: number; plan: PlanKey }> {
    const plan = await getActivePlan(userId);
    const cost = interviewMinuteCost(interviewType);

    await ensureWallet(userId);
    await ensureMonthlyGrant(userId);
    const wallet = await prisma.creditWallet.findUnique({ where: { userId } });
    if (!wallet) throw new Error("wallet missing");

    const total =
        wallet.freeCreditsRemaining +
        wallet.monthlyBalance +
        wallet.purchasedBalance;
    if (total < cost) {
        throw new EntitlementError(
            "INSUFFICIENT_CREDITS",
            plan === "FREE"
                ? "You've used all your free interview minutes. Upgrade or buy minutes to continue."
                : "Not enough interview minutes. Buy more or upgrade your plan.",
            plan,
            402,
            { required: cost, available: total, interviewType }
        );
    }
    return { cost, plan };
}

export async function settleInterviewMinuteReservation(
    userId: string,
    sessionId: string,
    options: { broadcast?: boolean } = {}
) {
    const session = await prisma.interviewSession.findFirst({
        where: { id: sessionId, userId },
        select: { id: true, type: true, startedAt: true, completedAt: true },
    });

    if (!session?.startedAt || !session.completedAt) return null;

    const reservedRows = await prisma.creditLedger.findMany({
        where: {
            userId,
            refType: "interview",
            refId: session.id,
            delta: { lt: 0 },
        },
        select: { bucket: true, delta: true },
    });
    if (reservedRows.length === 0) return null;

    const reserved = reservedRows.reduce(
        (acc, row) => {
            const amount = Math.abs(row.delta);
            if (row.bucket === "FREE") acc.free += amount;
            if (row.bucket === "MONTHLY") acc.monthly += amount;
            if (row.bucket === "PURCHASED") acc.purchased += amount;
            return acc;
        },
        { free: 0, monthly: 0, purchased: 0 }
    );

    const reservedTotal = reserved.free + reserved.monthly + reserved.purchased;
    const plannedMinutes = interviewMinuteCost(session.type);
    const elapsedMinutes = await getBillableInterviewElapsedMinutes(session);
    const usedMinutes = Math.min(plannedMinutes, elapsedMinutes, reservedTotal);
    const refundTotal = Math.max(0, reservedTotal - usedMinutes);
    const existingRefundRows = await prisma.creditLedger.findMany({
        where: {
            userId,
            refType: "interview_settlement",
            refId: session.id,
            reason: "unused_interview_minutes_refund",
            delta: { gt: 0 },
        },
        select: { bucket: true, delta: true },
    });
    const existingRefund = existingRefundRows.reduce(
        (acc, row) => {
            if (row.bucket === "FREE") acc.free += row.delta;
            if (row.bucket === "MONTHLY") acc.monthly += row.delta;
            if (row.bucket === "PURCHASED") acc.purchased += row.delta;
            return acc;
        },
        { free: 0, monthly: 0, purchased: 0 }
    );
    const existingRefundTotal =
        existingRefund.free + existingRefund.monthly + existingRefund.purchased;
    if (existingRefundTotal >= refundTotal) {
        return { reservedTotal, usedMinutes, refunded: existingRefundTotal };
    }

    if (refundTotal <= 0) {
        const existingSettlement = await prisma.creditLedger.findFirst({
            where: {
                userId,
                refType: "interview_settlement",
                refId: session.id,
                reason: "unused_interview_minutes_refund",
            },
            select: { id: true },
        });
        if (existingSettlement) {
            return { reservedTotal, usedMinutes, refunded: existingRefundTotal };
        }

        const wallet = await prisma.creditWallet.findUnique({ where: { userId } });
        if (wallet) {
            await prisma.creditLedger.create({
                data: {
                    userId,
                    walletId: wallet.id,
                    bucket: "SETTLEMENT",
                    delta: 0,
                    reason: "unused_interview_minutes_refund",
                    refType: "interview_settlement",
                    refId: session.id,
                    balanceAfter: {
                        free: wallet.freeCreditsRemaining,
                        monthly: wallet.monthlyBalance,
                        purchased: wallet.purchasedBalance,
                    },
                },
            });
        }
        return { reservedTotal, usedMinutes, refunded: 0 };
    }

    let remainingRefund = refundTotal;
    const desiredRefund = { free: 0, monthly: 0, purchased: 0 };

    for (const bucket of ["purchased", "monthly", "free"] as const) {
        const amount = Math.min(remainingRefund, reserved[bucket]);
        desiredRefund[bucket] = amount;
        remainingRefund -= amount;
        if (remainingRefund <= 0) break;
    }

    const refund = {
        free: Math.max(0, desiredRefund.free - existingRefund.free),
        monthly: Math.max(0, desiredRefund.monthly - existingRefund.monthly),
        purchased: Math.max(0, desiredRefund.purchased - existingRefund.purchased),
    };

    await refundCredits(
        userId,
        refund,
        "unused_interview_minutes_refund",
        {
            type: "interview_settlement",
            id: session.id,
        },
        options
    );

    return { reservedTotal, usedMinutes, refunded: refundTotal };
}

async function getBillableInterviewElapsedMinutes(session: {
    id: string;
    startedAt: Date | null;
    completedAt: Date | null;
}) {
    if (!session.startedAt || !session.completedAt) return 1;

    const bounds = await prisma.sessionMessage.aggregate({
        where: {
            sessionId: session.id,
            createdAt: {
                gte: session.startedAt,
                lte: session.completedAt,
            },
        },
        _min: { createdAt: true },
        _max: { createdAt: true },
    });

    const start = bounds._min.createdAt ?? session.startedAt;
    const end = bounds._max.createdAt ?? session.completedAt;
    const messageElapsedMs = Math.max(0, end.getTime() - start.getTime());
    const roomElapsedMs = Math.max(
        0,
        session.completedAt.getTime() - session.startedAt.getTime()
    );
    const elapsedMs = bounds._min.createdAt && bounds._max.createdAt
        ? Math.max(messageElapsedMs, roomElapsedMs)
        : roomElapsedMs;

    return Math.max(1, Math.ceil(elapsedMs / 60_000));
}

// ------------------------------------------------------------
// Feature usage (counts + tokens) with monthly rolling windows.
// ------------------------------------------------------------

// Get the current period start for feature usage tracking
// For paid subscriptions: aligns with subscription billing cycle
// For FREE plan: 1st of current month
async function getCurrentPeriodStart(userId: string, date = new Date()): Promise<Date> {
    const subscription = await prisma.subscription.findFirst({
        where: {
            userId,
            status: { in: ["active", "authenticated", "cancelled"] },
        },
        select: {
            currentPeriodStart: true,
            status: true,
            plan: true,
        },
        orderBy: { createdAt: "desc" },
    });

    if (subscription?.currentPeriodStart) {
        // Normalize to remove milliseconds and ensure consistent comparison
        const normalized = new Date(subscription.currentPeriodStart);
        normalized.setMilliseconds(0);
        return normalized;
    }

    // Fallback to calendar month for FREE users
    return new Date(
        Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)
    );
}

// Legacy function for backward compatibility (calendar-based)
function currentPeriodStart(date = new Date()) {
    return new Date(
        Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)
    );
}

export async function getFeatureUsage(
    userId: string,
    featureKey: FeatureKey
): Promise<{ count: number; tokens: number }> {
    const periodStart = await getCurrentPeriodStart(userId);
    
    // Try exact match first
    let row = await prisma.featureUsage.findUnique({
        where: {
            userId_featureKey_periodStart: {
                userId,
                featureKey,
                periodStart,
            },
        },
    });
    
    // If no exact match, try finding by userId and featureKey with closest periodStart
    if (!row) {
        const allRows = await prisma.featureUsage.findMany({
            where: {
                userId,
                featureKey,
            },
            orderBy: {
                periodStart: 'desc',
            },
            take: 5, // Get top 5 to see what's in DB
        });
        
        if (allRows.length > 0) {
            const dbPeriod = new Date(allRows[0].periodStart);
            const expectedPeriod = new Date(periodStart);
            const timeDiff = Math.abs(dbPeriod.getTime() - expectedPeriod.getTime());
            
            // If within 1 second, consider it a match (handles millisecond differences)
            if (timeDiff < 1000) {
                row = allRows[0];
            }
        }
    }
    
    return { count: row?.count ?? 0, tokens: row?.tokens ?? 0 };
}

// Enforce count-based cap (resume analysis, improve-with-ai).
export async function requireFeatureCountAndConsume(
    userId: string,
    featureKey: FeatureKey,
    limit: number,
    plan: PlanKey
) {
    if (limit <= 0) {
        throw new EntitlementError(
            "FEATURE_LOCKED",
            "This feature is not included in your plan.",
            plan,
            403,
            { featureKey }
        );
    }

    const periodStart = await getCurrentPeriodStart(userId);
    const result = await prisma.$transaction(async (tx) => {
        const existing = await tx.featureUsage.findUnique({
            where: {
                userId_featureKey_periodStart: {
                    userId,
                    featureKey,
                    periodStart,
                },
            },
        });
        const current = existing?.count ?? 0;
        if (current >= limit) {
            // Get subscription to show correct reset date
            const subscription = await tx.subscription.findFirst({
                where: {
                    userId,
                    status: { in: ["active", "authenticated", "cancelled"] },
                },
                select: { currentPeriodEnd: true },
                orderBy: { createdAt: "desc" },
            });
            
            const resetDate = subscription?.currentPeriodEnd 
                ? new Date(subscription.currentPeriodEnd).toLocaleDateString()
                : "the 1st";
            
            throw new EntitlementError(
                "FEATURE_LIMIT_REACHED",
                `You've hit this month's limit (${limit}). Resets on ${resetDate}.`,
                plan,
                429,
                { featureKey, limit, used: current }
            );
        }

        await tx.featureUsage.upsert({
            where: {
                userId_featureKey_periodStart: {
                    userId,
                    featureKey,
                    periodStart,
                },
            },
            update: { count: { increment: 1 } },
            create: {
                userId,
                featureKey,
                periodStart,
                count: 1,
                tokens: 0,
            },
        });
    });
    
    // Invalidate cache after consuming feature so usage updates immediately
    await invalidateUserPlanCache(userId);
    
    return result;
}

// Token-based cap: check before the LLM call, then record usage after.
export async function requireTokenBudget(
    userId: string,
    featureKey: FeatureKey,
    limit: number,
    plan: PlanKey
): Promise<{ tokensUsed: number; tokensRemaining: number }> {
    if (limit <= 0) {
        throw new EntitlementError(
            "FEATURE_LOCKED",
            "This feature is not included in your plan.",
            plan,
            403,
            { featureKey }
        );
    }
    const row = await prisma.featureUsage.findUnique({
        where: {
            userId_featureKey_periodStart: {
                userId,
                featureKey,
                periodStart: currentPeriodStart(),
            },
        },
    });
    const used = row?.tokens ?? 0;
    if (used >= limit) {
        throw new EntitlementError(
            "TOKEN_LIMIT_REACHED",
            "You've used all your AI tokens for this month.",
            plan,
            429,
            { featureKey, limit, used }
        );
    }
    return { tokensUsed: used, tokensRemaining: limit - used };
}

export async function recordTokenUsage(
    userId: string,
    featureKey: FeatureKey,
    tokens: number
) {
    if (tokens <= 0) return;
    const periodStart = await getCurrentPeriodStart(userId);
    await prisma.featureUsage.upsert({
        where: {
            userId_featureKey_periodStart: {
                userId,
                featureKey,
                periodStart,
            },
        },
        update: { tokens: { increment: tokens } },
        create: {
            userId,
            featureKey,
            periodStart,
            count: 0,
            tokens,
        },
    });
    
    // Invalidate cache after recording token usage so usage updates immediately
    await invalidateUserPlanCache(userId);
}

// ------------------------------------------------------------
// DSA submission gate
// ------------------------------------------------------------

export type DsaSubmitDecision = {
    plan: PlanKey;
    hiddenCap: number | null; // null = unlimited hidden
    allowedHiddenCount: number | null; // explicit count for API to slice by
};

export async function requireDsaSubmit(userId: string): Promise<DsaSubmitDecision> {
    const plan = await getActivePlan(userId);
    const ent = PLAN_ENTITLEMENTS[plan];
    if (ent.dsaSubmitAccess === "none") {
        throw new EntitlementError(
            "DSA_SUBMIT_LOCKED",
            "Submitting to hidden test cases requires a paid plan.",
            plan,
            403,
            { feature: "dsa_submit" }
        );
    }
    return {
        plan,
        hiddenCap: ent.dsaSubmitHiddenTestCaseCap,
        allowedHiddenCount: ent.dsaSubmitHiddenTestCaseCap,
    };
}

function hourBucket(date = new Date()) {
    return new Date(
        Date.UTC(
            date.getUTCFullYear(),
            date.getUTCMonth(),
            date.getUTCDate(),
            date.getUTCHours()
        )
    );
}

function hourlySubmitLimitError(plan: PlanKey, limit: number, questionId: string) {
    return new EntitlementError(
        "HOURLY_SUBMIT_LIMIT",
        `You've hit the limit of ${limit} successful submissions for this question this hour.`,
        plan,
        429,
        { limit, questionId }
    );
}

// Call ONLY when a submission counted as "passed/accepted" so the cap protects successful runs.
export async function requireHourlySubmitCapAndIncrement(
    userId: string,
    questionId: string,
    plan: PlanKey
) {
    const limit = PLAN_ENTITLEMENTS[plan].dsaSubmitSuccessPerHourPerQuestion;
    if (limit <= 0) return; // FREE — blocked earlier; defensive
    const bucket = hourBucket();
    const counterKey = {
        userId_questionId_hourBucket: {
            userId,
            questionId,
            hourBucket: bucket,
        },
    };

    const incrementIfUnderLimit = () =>
        prisma.hourlySubmissionCounter.updateMany({
            where: {
                userId,
                questionId,
                hourBucket: bucket,
                successCount: { lt: limit },
            },
            data: { successCount: { increment: 1 } },
        });

    const updated = await incrementIfUnderLimit();
    if (updated.count > 0) return;

    const existing = await prisma.hourlySubmissionCounter.findUnique({
        where: counterKey,
        select: { successCount: true },
    });
    if (existing) {
        throw hourlySubmitLimitError(plan, limit, questionId);
    }

    try {
        await prisma.hourlySubmissionCounter.create({
            data: {
                userId,
                questionId,
                hourBucket: bucket,
                successCount: 1,
            },
        });
    } catch (err: any) {
        if (err?.code !== "P2002") {
            throw err;
        }

        const retry = await incrementIfUnderLimit();
        if (retry.count > 0) return;

        throw hourlySubmitLimitError(plan, limit, questionId);
    }
}

// ------------------------------------------------------------
// Aggregated snapshot for frontend header/dashboard.
// ------------------------------------------------------------

export async function getEntitlementSnapshot(userId: string) {
    const plan = await getActivePlan(userId);
    const ent = PLAN_ENTITLEMENTS[plan];
    const wallet = await getWalletSnapshot(userId);

    // Get subscription to determine the correct reset date
    const subscription = await prisma.subscription.findFirst({
        where: {
            userId,
            status: { in: ["active", "authenticated", "cancelled"] },
        },
        select: {
            currentPeriodStart: true,
            currentPeriodEnd: true,
            status: true,
            plan: true,
        },
        orderBy: { createdAt: "desc" },
    });

    const [resumeAnalysis, resumeImprove, latexTokens, tutorTokens] =
        await Promise.all([
            getFeatureUsage(userId, "resume_analysis"),
            getFeatureUsage(userId, "resume_improve_ai"),
            getFeatureUsage(userId, "latex_ai_tokens"),
            getFeatureUsage(userId, "tutor_tokens"),
        ]);

    // Calculate reset date based on subscription or calendar month
    let nextReset: Date;
    if (subscription?.currentPeriodEnd) {
        // For paid subscriptions, reset aligns with billing cycle
        nextReset = new Date(subscription.currentPeriodEnd);
    } else {
        // For FREE plan, reset on 1st of next month
        const now = new Date();
        nextReset = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    }

    return {
        plan,
        entitlements: ent,
        wallet,
        usage: {
            resumeAnalysisUsed: resumeAnalysis.count,
            resumeImproveAiUsed: resumeImprove.count,
            latexAiTokensUsed: latexTokens.tokens,
            tutorTokensUsed: tutorTokens.tokens,
            resetAt: nextReset.toISOString(),
        },
    };
}
