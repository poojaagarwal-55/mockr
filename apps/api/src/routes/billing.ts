// ============================================
// Billing Routes
// ============================================
// /billing/snapshot              → current plan, wallet, usage (used by header + pricing)
// /billing/subscribe             → create Razorpay subscription for a plan+cycle
// /billing/credits/order         → create Razorpay order for a minute pack
// /billing/credits/verify        → verify minute-pack payment, grant minutes
// /billing/coupons/redeem        → redeem a coupon code (plan grant)
//
// All writes go through the entitlements service to ensure wallet and ledger
// stay consistent. Razorpay signature verification uses HMAC-SHA256 per docs.
// ============================================

import { FastifyInstance } from "fastify";
import { z } from "zod";
import crypto from "crypto";
import Razorpay from "razorpay";
import { prisma } from "../lib/prisma.js";
import { requireRazorpayEnv } from "../lib/env.js";
import { checkRateLimit } from "../lib/rate-limiter.js";
import { isConnectivityIssue } from "../lib/user-facing-errors.js";
import {
    INTERVIEW_MINUTE_PACKS,
    PLANS,
    BILLING_CYCLES,
    getInterviewMinutePack,
    cyclePriceInr,
    getEntitlements,
    PlanKey,
    BillingCycle,
} from "@interviewforge/shared";
import {
    getEntitlementSnapshot,
    grantPurchasedInterviewMinutes,
} from "../services/entitlements.js";
import {
    getCachedPlanData,
    invalidateUserPlanCache,
} from "../services/cache.js";
import { broadcastPlanPurchase, broadcastCouponRedemption } from "../services/plan-update-broadcaster.js";
import { isAdminEmail } from "../lib/admin.js";
import { UserAbuseProtection } from "../services/payment/edge-cases/user-abuse-protection.js";
import { SubscriptionUpgradeService } from "../services/payment/subscription-upgrade-service.js";
import { SubscriptionDowngradeService } from "../services/payment/subscription-downgrade-service.js";
import { SubscriptionCancellationService } from "../services/payment/subscription-cancellation-service.js";

function getRazorpay() {
    return new Razorpay({
        key_id: requireRazorpayEnv("RAZORPAY_KEY_ID"),
        key_secret: requireRazorpayEnv("RAZORPAY_KEY_SECRET"),
    });
}

function verifyRazorpaySignature(
    payload: string,
    signature: string,
    secret: string
): boolean {
    const expected = crypto
        .createHmac("sha256", secret)
        .update(payload)
        .digest("hex");
    // timing-safe compare
    try {
        return crypto.timingSafeEqual(
            Buffer.from(expected, "hex"),
            Buffer.from(signature, "hex")
        );
    } catch {
        return false;
    }
}

function isRazorpayConfigError(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    return /RAZORPAY_KEY_ID|RAZORPAY_KEY_SECRET|RAZORPAY_WEBHOOK_SECRET|Payment features are unavailable/i.test(
        err.message
    );
}

function isRazorpayUpstreamError(err: unknown): boolean {
    if (isConnectivityIssue(err)) {
        return true;
    }

    if (typeof err !== "object" || err === null) {
        return false;
    }

    const withStatus = err as { statusCode?: unknown; status?: unknown };
    const statusCode = Number(withStatus.statusCode ?? withStatus.status);
    if (Number.isFinite(statusCode) && statusCode >= 500) {
        return true;
    }

    const withCode = err as { error?: { code?: unknown }; code?: unknown };
    const code = String(withCode.error?.code ?? withCode.code ?? "");
    return /SERVER|GATEWAY|NETWORK|TIMEOUT/i.test(code);
}

function maskIpForAudit(ip: string | null | undefined): string | null {
    if (!ip) return null;

    // IPv4 masking: keep first 3 octets and mask the host segment.
    if (ip.includes(".")) {
        const parts = ip.split(".");
        if (parts.length === 4) {
            return `${parts[0]}.${parts[1]}.${parts[2]}.x`;
        }
    }

    // IPv6/other: keep only a short prefix.
    return `${ip.slice(0, 12)}...`;
}

function hashUserAgentForAudit(userAgent: string | null | undefined): string | null {
    if (!userAgent) return null;
    return crypto.createHash("sha256").update(userAgent).digest("hex");
}

export default async function billingRoutes(fastify: FastifyInstance) {
    fastify.addHook("preHandler", fastify.authenticate);

    const abuseProtection = new UserAbuseProtection(prisma);
    const razorpay = getRazorpay();
    const upgradeService = new SubscriptionUpgradeService(prisma, razorpay, fastify.log as any);
    const downgradeService = new SubscriptionDowngradeService(prisma, fastify.log as any);
    const cancellationService = new SubscriptionCancellationService(prisma, razorpay, fastify.log as any);

    async function recordCapturedPaymentArtifacts(input: {
        paymentId: string;
        userId: string;
        kind: "SUBSCRIPTION" | "CREDITS";
        fromStatus: string;
        toStatus: string;
        reason: string;
        source: string;
        amount: number;
        currency: string;
        requestId: string;
        sessionId: string | null;
        clientIp: string | null;
        userAgent: string | null;
    }) {
        fastify.log.info({
            action: 'recordCapturedPaymentArtifacts_START',
            paymentId: input.paymentId,
            userId: `user-${input.userId.slice(0, 8)}...`,
            kind: input.kind,
            fromStatus: input.fromStatus,
            toStatus: input.toStatus,
            amount: input.amount,
            currency: input.currency,
            source: input.source,
        }, 'Starting payment artifacts recording');

        try {
            await prisma.$transaction(async (tx) => {
                const existingTransition = await tx.payment_state_transitions.findFirst({
                    where: {
                        paymentId: input.paymentId,
                        fromStatus: input.fromStatus,
                        toStatus: input.toStatus,
                        source: input.source,
                    },
                    select: { id: true },
                });

                if (!existingTransition) {
                    const transitionData = {
                        paymentId: input.paymentId,
                        fromStatus: input.fromStatus,
                        toStatus: input.toStatus,
                        reason: input.reason,
                        source: input.source,
                        metadata: {
                            requestId: input.requestId,
                            amount: input.amount,
                            currency: input.currency,
                            kind: input.kind,
                        },
                    };

                    fastify.log.info({
                        action: 'CREATE_PAYMENT_STATE_TRANSITION',
                        data: transitionData,
                    }, 'Creating payment state transition');

                    await tx.payment_state_transitions.create({
                        data: transitionData,
                    });

                    fastify.log.info({
                        action: 'PAYMENT_STATE_TRANSITION_CREATED',
                        paymentId: input.paymentId,
                    }, 'Payment state transition created successfully');
                } else {
                    fastify.log.info({
                        action: 'PAYMENT_STATE_TRANSITION_EXISTS',
                        transitionId: existingTransition.id,
                        paymentId: input.paymentId,
                    }, 'Payment state transition already exists, skipping');
                }

                const previousAudit = await tx.payment_audit_logs.findFirst({
                    orderBy: { sequence: "desc" },
                    select: { sequence: true, hash: true },
                });

                const sequence = (previousAudit?.sequence ?? 0) + 1;
                const previousHash = previousAudit?.hash ?? null;
                const nowIso = new Date().toISOString();
                const eventType = "PAYMENT_STATUS_CHANGED";
                const eventData = {
                    fromStatus: input.fromStatus,
                    toStatus: input.toStatus,
                    reason: input.reason,
                    source: input.source,
                    amount: input.amount,
                    currency: input.currency,
                    kind: input.kind,
                    requestId: input.requestId,
                };
                const sanitizedData = {
                    ...eventData,
                    user: `user-${input.userId.slice(0, 8)}...`,
                };

                const hashInput = [
                    sequence,
                    nowIso,
                    eventType,
                    input.paymentId,
                    input.userId,
                    JSON.stringify(eventData),
                    previousHash ?? "",
                ].join("|");

                const hash = crypto
                    .createHash("sha256")
                    .update(hashInput)
                    .digest("hex");

                const auditLogData = {
                    paymentId: input.paymentId,
                    eventType,
                    eventData,
                    sequence,
                    previousHash,
                    hash,
                    sanitizedData,
                    userId: input.userId,
                    sessionId: input.sessionId,
                    clientIp: maskIpForAudit(input.clientIp),
                    userAgent: hashUserAgentForAudit(input.userAgent),
                };

                fastify.log.info({
                    action: 'CREATE_PAYMENT_AUDIT_LOG',
                    sequence,
                    eventType,
                    paymentId: input.paymentId,
                    userId: `user-${input.userId.slice(0, 8)}...`,
                }, 'Creating payment audit log entry');

                await tx.payment_audit_logs.create({
                    data: auditLogData,
                });

                fastify.log.info({
                    action: 'PAYMENT_AUDIT_LOG_CREATED',
                    sequence,
                    paymentId: input.paymentId,
                }, 'Payment audit log created successfully');

                // Ledger requires a real positive amount. Subscription verify may occasionally
                // have amount 0 if provider lookup fails; skip posting in that case.
                if (input.amount <= 0) {
                    fastify.log.warn({
                        action: 'SKIP_LEDGER_ZERO_AMOUNT',
                        paymentId: input.paymentId,
                        amount: input.amount,
                    }, 'Skipping ledger entry for zero/negative amount');
                    return;
                }

                const existingLedger = await tx.ledgerTransaction.findFirst({
                    where: {
                        referenceType: "payment_captured",
                        referenceId: input.paymentId,
                    },
                    select: { id: true },
                });

                if (existingLedger) {
                    fastify.log.info({
                        action: 'LEDGER_TRANSACTION_EXISTS',
                        ledgerId: existingLedger.id,
                        paymentId: input.paymentId,
                    }, 'Ledger transaction already exists, skipping');
                    return;
                }

                fastify.log.info({
                    action: 'CREATE_LEDGER_ACCOUNTS',
                    paymentId: input.paymentId,
                    kind: input.kind,
                }, 'Creating/updating financial accounts');

                const receivable = await tx.financialAccount.upsert({
                    where: { code: "1100" },
                    update: {
                        name: "Accounts Receivable - Razorpay",
                        type: "ASSET",
                        status: "ACTIVE",
                    },
                    create: {
                        code: "1100",
                        name: "Accounts Receivable - Razorpay",
                        type: "ASSET",
                        status: "ACTIVE",
                        description: "Captured but unsettled payment balances",
                    },
                });

                const revenueCode = input.kind === "SUBSCRIPTION" ? "4000" : "4100";
                const revenueName =
                    input.kind === "SUBSCRIPTION"
                        ? "Subscription Revenue"
                        : "Interview Minutes Revenue";

                const revenue = await tx.financialAccount.upsert({
                    where: { code: revenueCode },
                    update: {
                        name: revenueName,
                        type: "REVENUE",
                        status: "ACTIVE",
                    },
                    create: {
                        code: revenueCode,
                        name: revenueName,
                        type: "REVENUE",
                        status: "ACTIVE",
                        description:
                            input.kind === "SUBSCRIPTION"
                                ? "Revenue from subscription purchases"
                                : "Revenue from interview minute pack purchases",
                    },
                });

                const ledgerTx = await tx.ledgerTransaction.create({
                    data: {
                        paymentId: input.paymentId,
                        referenceType: "payment_captured",
                        referenceId: input.paymentId,
                        description: `Payment captured (${input.kind})`,
                        currency: input.currency,
                        totalDebit: input.amount,
                        totalCredit: input.amount,
                        metadata: {
                            source: input.source,
                            reason: input.reason,
                            requestId: input.requestId,
                        },
                    },
                });

                fastify.log.info({
                    action: 'LEDGER_TRANSACTION_CREATED',
                    ledgerId: ledgerTx.id,
                    paymentId: input.paymentId,
                    amount: input.amount,
                    currency: input.currency,
                }, 'Ledger transaction created');

                await tx.ledgerEntry.create({
                    data: {
                        transactionId: ledgerTx.id,
                        debitAccountId: receivable.id,
                        creditAccountId: revenue.id,
                        amount: input.amount,
                        description: "Recognize receivable and revenue",
                        metadata: {
                            kind: input.kind,
                            paymentId: input.paymentId,
                        },
                    },
                });

                fastify.log.info({
                    action: 'LEDGER_ENTRY_CREATED',
                    ledgerId: ledgerTx.id,
                    debitAccount: receivable.code,
                    creditAccount: revenue.code,
                    amount: input.amount,
                }, 'Ledger entry created successfully');
            });

            fastify.log.info({
                action: 'recordCapturedPaymentArtifacts_SUCCESS',
                paymentId: input.paymentId,
                userId: `user-${input.userId.slice(0, 8)}...`,
            }, 'Payment artifacts recorded successfully');
        } catch (err) {
            fastify.log.warn(
                {
                    action: 'recordCapturedPaymentArtifacts_ERROR',
                    paymentId: input.paymentId,
                    userId: `user-${input.userId.slice(0, 8)}...`,
                    err,
                },
                "Failed to record payment artifacts"
            );
        }
    }

    // ── Snapshot ───────────────────────────────────────────────
    fastify.get("/billing/snapshot", async (request) => {
        // Use cached plan data for improved performance
        const cachedData = await getCachedPlanData(request.user!.id);

        // Get active subscription ID and scheduled changes for upgrade/downgrade flows
        // and the isExpert flag for role-gated UI in a single round-trip.
        const [activeSubscription, userFlags] = await Promise.all([
            prisma.subscription.findFirst({
                where: {
                    userId: request.user!.id,
                    status: { in: ["active", "authenticated", "cancelled"] },
                },
                select: {
                    id: true,
                    cycle: true,
                    status: true,
                    cancelledAt: true,
                    scheduledPlanChange: true,
                    scheduledChangeDate: true,
                    currentPeriodEnd: true,
                },
                orderBy: { createdAt: "desc" },
            }),
            prisma.user.findUnique({
                where: { id: request.user!.id },
                select: { isExpert: true },
            }),
        ]);

        return {
            plan: cachedData.plan,
            entitlements: cachedData.entitlements,
            wallet: cachedData.wallet,
            usage: cachedData.usage,
            isAdmin: isAdminEmail(request.user!.email),
            isExpert: Boolean(userFlags?.isExpert),
            subscriptionId: activeSubscription?.id ?? null,
            cycle: activeSubscription?.cycle ?? null,
            status: activeSubscription?.status ?? null,
            cancelledAt: activeSubscription?.cancelledAt ?? null,
            scheduledPlanChange: activeSubscription?.scheduledPlanChange ?? null,
            scheduledChangeDate: activeSubscription?.scheduledChangeDate ?? null,
            currentPeriodEnd: activeSubscription?.currentPeriodEnd ?? null,
        };
    });

    // ── Payment History ────────────────────────────────────────
    fastify.get("/billing/payment-history", async (request, reply) => {
        const rl = checkRateLimit(`billing:payment-history:${request.user!.id}`, 30, 3_600_000);
        if (!rl.allowed) {
            return reply.status(429).send({ error: "Too Many Requests" });
        }

        try {
            const payments = await prisma.payment.findMany({
                where: {
                    userId: request.user!.id,
                    status: "captured", // Only show successful payments
                },
                select: {
                    id: true,
                    razorpayPaymentId: true,
                    amount: true,
                    currency: true,
                    status: true,
                    method: true,
                    kind: true,
                    createdAt: true,
                    metadata: true,
                },
                orderBy: {
                    createdAt: "desc",
                },
                take: 50, // Limit to last 50 payments
            });

            return reply.send({
                success: true,
                payments: payments.map((p) => ({
                    id: p.id,
                    razorpayPaymentId: p.razorpayPaymentId,
                    amount: p.amount / 100, // Convert paise to rupees
                    currency: p.currency,
                    status: p.status,
                    method: p.method,
                    kind: p.kind,
                    date: p.createdAt.toISOString(),
                    metadata: p.metadata,
                })),
            });
        } catch (err) {
            fastify.log.error(err, "Failed to fetch payment history");
            return reply.status(500).send({
                success: false,
                error: "Failed to fetch payment history",
            });
        }
    });

    // ── Public pricing info (no user state) ────────────────────
    fastify.get("/billing/plans", async () => {
        return {
            plans: PLANS.map((p) => {
                const ent = getEntitlements(p as PlanKey);
                return {
                    plan: p,
                    ...ent,
                    pricing: {
                        monthly: ent.priceInrMonthly,
                        quarterlyPerMonth: ent.priceInrQuarterlyPerMonth,
                        quarterlyTotal: ent.priceInrQuarterlyPerMonth * 3,
                    },
                };
            }),
            minutePacks: INTERVIEW_MINUTE_PACKS,
        };
    });

    // ── Subscribe to a plan via Razorpay ────────────────────────
    const subscribeSchema = z.object({
        plan: z.enum(PLANS).refine((p) => p !== "FREE", {
            message: "Cannot subscribe to FREE plan",
        }),
        cycle: z.enum(BILLING_CYCLES),
        razorpayPlanId: z.string().min(1), // Razorpay plan ID pre-configured per (plan, cycle)
    });

    fastify.post("/billing/subscribe", async (request, reply) => {
        const user = request.user!;
        const rl = checkRateLimit(`billing:subscribe:${user.id}`, 5, 3_600_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Please wait ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        const parsed = subscribeSchema.safeParse(request.body);
        if (!parsed.success) {
            // Record failed validation attempt
            await abuseProtection.recordFailedAttempt(user.id, {
                type: 'subscription_creation',
                reason: 'validation_error',
                metadata: { errors: parsed.error.flatten().fieldErrors },
            });

            return reply.status(400).send({
                error: "Validation Error",
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const { plan, cycle, razorpayPlanId } = parsed.data;

        try {
            const razorpay = getRazorpay();
            // total_count: 180 months for monthly (15 years), 60 quarters for quarterly (15 years).
            // Razorpay charges at each interval; we map cycle → interval via the plan config on Razorpay side.
            const totalCount = cycle === "MONTHLY" ? 180 : 60;
            const sub = await razorpay.subscriptions.create({
                plan_id: razorpayPlanId,
                customer_notify: 1,
                total_count: totalCount,
                notes: {
                    userId: user.id,
                    plan,
                    cycle,
                },
            });

            await prisma.subscription.create({
                data: {
                    userId: user.id,
                    razorpaySubscriptionId: sub.id,
                    plan: plan as PlanKey,
                    cycle: cycle as BillingCycle,
                    planId: razorpayPlanId,
                    source: "PURCHASE",
                    status: "created",
                },
            });

            // Record successful subscription creation attempt
            await abuseProtection.recordSuccessfulAttempt(user.id, 'subscription_creation', {
                subscriptionId: sub.id,
                plan,
                cycle,
            });

            return reply.send({
                subscriptionId: sub.id,
                plan,
                cycle,
                amount: cyclePriceInr(plan as PlanKey, cycle as BillingCycle) * 100,
            });
        } catch (err) {
            fastify.log.error(err, "Failed to create subscription");

            // Record failed subscription creation attempt
            await abuseProtection.recordFailedAttempt(user.id, {
                type: 'subscription_creation',
                reason: 'razorpay_error',
                metadata: { error: err instanceof Error ? err.message : 'unknown' },
            });

            if (isRazorpayConfigError(err)) {
                return reply.status(503).send({
                    error: "Payments are currently unavailable",
                });
            }
            if (isRazorpayUpstreamError(err)) {
                return reply.status(502).send({
                    error: "Payment provider is currently unavailable",
                });
            }
            return reply.status(500).send({
                error: "Subscription creation failed",
            });
        }
    });

    // ── Verify subscription payment (client-side confirm) ───────
    const verifySubSchema = z.object({
        razorpay_payment_id: z.string().min(1),
        razorpay_subscription_id: z.string().min(1),
        razorpay_signature: z.string().min(1),
    });

    fastify.post("/billing/subscribe/verify", async (request, reply) => {
        const rl = checkRateLimit(`billing:verify-sub:${request.user!.id}`, 10, 3_600_000);
        if (!rl.allowed) return reply.status(429).send({ error: "Too Many Requests" });

        fastify.log.info({
            action: 'SUBSCRIPTION_VERIFY_START',
            userId: `user-${request.user!.id.slice(0, 8)}...`,
            body: request.body,
        }, 'Starting subscription verification');

        const parsed = verifySubSchema.safeParse(request.body);
        if (!parsed.success) {
            // Record failed validation attempt
            await abuseProtection.recordFailedAttempt(request.user!.id, {
                type: 'subscription_verification',
                reason: 'validation_error',
                metadata: { errors: parsed.error.flatten().fieldErrors },
            });

            return reply.status(400).send({
                error: "Validation Error",
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const { razorpay_payment_id, razorpay_subscription_id, razorpay_signature } =
            parsed.data;

        try {
            const secret = requireRazorpayEnv("RAZORPAY_KEY_SECRET");
            const payload = `${razorpay_payment_id}|${razorpay_subscription_id}`;
            if (!verifyRazorpaySignature(payload, razorpay_signature, secret)) {
                // Record signature verification failure
                await abuseProtection.recordFailedAttempt(request.user!.id, {
                    type: 'subscription_verification',
                    reason: 'invalid_signature',
                    metadata: { subscriptionId: razorpay_subscription_id },
                });

                return reply.status(400).send({ error: "Invalid signature" });
            }

            const sub = await prisma.subscription.findUnique({
                where: { razorpaySubscriptionId: razorpay_subscription_id },
            });
            if (!sub || sub.userId !== request.user!.id) {
                // Record not found attempt
                await abuseProtection.recordFailedAttempt(request.user!.id, {
                    type: 'subscription_verification',
                    reason: 'subscription_not_found',
                    metadata: { subscriptionId: razorpay_subscription_id },
                });

                return reply.status(404).send({ error: "Subscription not found" });
            }

            // Idempotency: repeat verify calls for the same captured payment should be safe.
            const existingPayment = await prisma.payment.findUnique({
                where: { razorpayPaymentId: razorpay_payment_id },
            });
            if (existingPayment) {
                if (
                    existingPayment.userId !== request.user!.id ||
                    existingPayment.kind !== "SUBSCRIPTION"
                ) {
                    return reply.status(409).send({ error: "Payment ownership mismatch" });
                }

                await recordCapturedPaymentArtifacts({
                    paymentId: existingPayment.id,
                    userId: request.user!.id,
                    kind: "SUBSCRIPTION",
                    fromStatus: existingPayment.previousStatus ?? "created",
                    toStatus: existingPayment.status,
                    reason: "subscription verification replay",
                    source: "billing/subscribe/verify",
                    amount: existingPayment.amount,
                    currency: existingPayment.currency,
                    requestId: request.id,
                    sessionId:
                        typeof request.headers["x-session-id"] === "string"
                            ? request.headers["x-session-id"]
                            : null,
                    clientIp: request.ip ?? null,
                    userAgent:
                        typeof request.headers["user-agent"] === "string"
                            ? request.headers["user-agent"]
                            : null,
                });

                // Record successful replay attempt
                await abuseProtection.recordSuccessfulAttempt(request.user!.id, 'subscription_verification', {
                    paymentId: existingPayment.id,
                    replay: true,
                });

                return reply.send({
                    success: true,
                    plan: sub.plan,
                    alreadyProcessed: true,
                });
            }

            // Activate for one billing period. Webhooks will continue updating this.
            const now = new Date();
            const periodEnd =
                sub.cycle === "MONTHLY"
                    ? new Date(now.getTime() + 31 * 24 * 60 * 60 * 1000)
                    : new Date(now.getTime() + 93 * 24 * 60 * 60 * 1000);

            let capturedAmount =
                cyclePriceInr(sub.plan as PlanKey, sub.cycle as BillingCycle) * 100;
            let capturedMethod: string | null = null;
            try {
                const razorpay = getRazorpay();
                const payment = await razorpay.payments.fetch(razorpay_payment_id);
                if (typeof (payment as { amount?: unknown }).amount === "number") {
                    capturedAmount = (payment as { amount?: number }).amount ?? capturedAmount;
                }
                capturedMethod =
                    typeof (payment as { method?: unknown }).method === "string"
                        ? ((payment as { method?: string }).method ?? null)
                        : null;
            } catch (err) {
                fastify.log.warn(
                    { err, paymentId: razorpay_payment_id },
                    "Failed to fetch Razorpay payment details for subscription verify"
                );
            }

            await prisma.subscription.update({
                where: { id: sub.id },
                data: {
                    status: "active",
                    currentPeriodStart: now,
                    currentPeriodEnd: periodEnd,
                },
            });

            const createdPayment = await prisma.payment.create({
                data: {
                    userId: request.user!.id,
                    razorpayPaymentId: razorpay_payment_id,
                    amount: capturedAmount,
                    currency: "INR",
                    status: "captured",
                    method: capturedMethod,
                    kind: "SUBSCRIPTION",
                    metadata: { subscriptionId: sub.id },
                    updatedAt: now,
                },
            });

            fastify.log.info({
                action: 'PAYMENT_CREATED',
                paymentId: createdPayment.id,
                userId: `user-${request.user!.id.slice(0, 8)}...`,
                razorpayPaymentId: razorpay_payment_id,
                amount: capturedAmount,
                status: 'captured',
                kind: 'SUBSCRIPTION',
            }, 'Payment record created in database');

            await recordCapturedPaymentArtifacts({
                paymentId: createdPayment.id,
                userId: request.user!.id,
                kind: "SUBSCRIPTION",
                fromStatus: "created",
                toStatus: "captured",
                reason: "subscription verification completed",
                source: "billing/subscribe/verify",
                amount: createdPayment.amount,
                currency: createdPayment.currency,
                requestId: request.id,
                sessionId:
                    typeof request.headers["x-session-id"] === "string"
                        ? request.headers["x-session-id"]
                        : null,
                clientIp: request.ip ?? null,
                userAgent:
                    typeof request.headers["user-agent"] === "string"
                        ? request.headers["user-agent"]
                        : null,
            });

            // Record successful verification attempt
            await abuseProtection.recordSuccessfulAttempt(request.user!.id, 'subscription_verification', {
                paymentId: createdPayment.id,
                subscriptionId: sub.id,
                plan: sub.plan,
            });

            // Invalidate cache when plan is activated
            await invalidateUserPlanCache(request.user!.id);

            // Broadcast plan update to user via WebSocket
            await broadcastPlanPurchase(
                request.user!.id,
                sub.plan,
                sub.razorpaySubscriptionId || undefined
            );

            return reply.send({ success: true, plan: sub.plan });
        } catch (err) {
            fastify.log.error(err, "Failed to verify subscription payment");

            // Record failed verification attempt
            await abuseProtection.recordFailedAttempt(request.user!.id, {
                type: 'subscription_verification',
                reason: 'system_error',
                metadata: { error: err instanceof Error ? err.message : 'unknown' },
            });

            if (isRazorpayConfigError(err)) {
                return reply.status(503).send({
                    error: "Payments are currently unavailable",
                });
            }
            if (isRazorpayUpstreamError(err)) {
                return reply.status(502).send({
                    error: "Payment provider is currently unavailable",
                });
            }
            return reply.status(500).send({
                error: "Subscription verification failed",
            });
        }
    });

    // ── Minute pack: create Razorpay order ──────────────────────
    const creditOrderSchema = z.object({
        packId: z.string().min(1),
    });

    fastify.post("/billing/credits/order", async (request, reply) => {
        const rl = checkRateLimit(
            `billing:credits-order:${request.user!.id}`,
            10,
            3_600_000
        );
        if (!rl.allowed) return reply.status(429).send({ error: "Too Many Requests" });

        const parsed = creditOrderSchema.safeParse(request.body);
        if (!parsed.success) {
            // Record failed validation attempt
            await abuseProtection.recordFailedAttempt(request.user!.id, {
                type: 'credit_order_creation',
                reason: 'validation_error',
                metadata: { errors: parsed.error.flatten().fieldErrors },
            });

            return reply.status(400).send({
                error: "Validation Error",
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const pack = getInterviewMinutePack(parsed.data.packId);
        if (!pack) {
            // Record invalid pack attempt
            await abuseProtection.recordFailedAttempt(request.user!.id, {
                type: 'credit_order_creation',
                reason: 'invalid_pack_id',
                metadata: { packId: parsed.data.packId },
            });

            return reply.status(404).send({ error: "Unknown minute pack" });
        }

        try {
            const razorpay = getRazorpay();
            const order = await razorpay.orders.create({
                amount: pack.priceInr * 100, // paise
                currency: "INR",
                receipt: `credits-${request.user!.id.slice(0, 8)}-${Date.now()}`,
                notes: {
                    userId: request.user!.id,
                    packId: pack.id,
                    minutes: pack.minutes.toString(),
                },
            });

            // Pre-create a payment row in "created" state so we can match the webhook later.
            await prisma.payment.create({
                data: {
                    userId: request.user!.id,
                    razorpayOrderId: order.id,
                    amount: typeof order.amount === "number" ? order.amount : parseInt(String(order.amount)),
                    currency: "INR",
                    status: "created",
                    kind: "CREDITS",
                    metadata: { packId: pack.id, minutes: pack.minutes },
                    updatedAt: new Date(),
                },
            });

            // Record successful order creation attempt
            await abuseProtection.recordSuccessfulAttempt(request.user!.id, 'credit_order_creation', {
                orderId: order.id,
                packId: pack.id,
                minutes: pack.minutes,
            });

            return reply.send({
                orderId: order.id,
                amount: order.amount,
                currency: order.currency,
                packId: pack.id,
                minutes: pack.minutes,
            });
        } catch (err) {
            fastify.log.error(err, "Failed to create minute pack order");

            // Record failed order creation attempt
            await abuseProtection.recordFailedAttempt(request.user!.id, {
                type: 'credit_order_creation',
                reason: 'razorpay_error',
                metadata: { error: err instanceof Error ? err.message : 'unknown' },
            });

            if (isRazorpayConfigError(err)) {
                return reply.status(503).send({
                    error: "Payments are currently unavailable",
                });
            }
            if (isRazorpayUpstreamError(err)) {
                return reply.status(502).send({
                    error: "Payment provider is currently unavailable",
                });
            }
            return reply.status(500).send({ error: "Order creation failed" });
        }
    });

    // ── Minute pack: verify payment and grant ───────────────────
    const verifyMinutePackSchema = z.object({
        razorpay_order_id: z.string().min(1),
        razorpay_payment_id: z.string().min(1),
        razorpay_signature: z.string().min(1),
    });

    fastify.post("/billing/credits/verify", async (request, reply) => {
        const rl = checkRateLimit(
            `billing:credits-verify:${request.user!.id}`,
            10,
            3_600_000
        );
        if (!rl.allowed) return reply.status(429).send({ error: "Too Many Requests" });

        fastify.log.info({
            action: 'MINUTE_VERIFY_START',
            userId: `user-${request.user!.id.slice(0, 8)}...`,
            body: request.body,
        }, 'Starting minute pack verification');

        const parsed = verifyMinutePackSchema.safeParse(request.body);
        if (!parsed.success) {
            // Record failed validation attempt
            await abuseProtection.recordFailedAttempt(request.user!.id, {
                type: 'credit_verification',
                reason: 'validation_error',
                metadata: { errors: parsed.error.flatten().fieldErrors },
            });

            return reply.status(400).send({
                error: "Validation Error",
                details: parsed.error.flatten().fieldErrors,
            });
        }
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = parsed.data;

        const secret = requireRazorpayEnv("RAZORPAY_KEY_SECRET");
        const payload = `${razorpay_order_id}|${razorpay_payment_id}`;
        if (!verifyRazorpaySignature(payload, razorpay_signature, secret)) {
            // Record signature verification failure
            await abuseProtection.recordFailedAttempt(request.user!.id, {
                type: 'credit_verification',
                reason: 'invalid_signature',
                metadata: { orderId: razorpay_order_id },
            });

            return reply.status(400).send({ error: "Invalid signature" });
        }

        // Idempotency: find the pre-created payment row, and bail if already captured.
        const payment = await prisma.payment.findFirst({
            where: {
                razorpayOrderId: razorpay_order_id,
                userId: request.user!.id,
                kind: "CREDITS",
            },
        });
        if (!payment) {
            // Record not found attempt
            await abuseProtection.recordFailedAttempt(request.user!.id, {
                type: 'credit_verification',
                reason: 'order_not_found',
                metadata: { orderId: razorpay_order_id },
            });

            return reply.status(404).send({ error: "Order not found" });
        }
        if (payment.status === "captured") {
            await recordCapturedPaymentArtifacts({
                paymentId: payment.id,
                userId: request.user!.id,
                kind: "CREDITS",
                fromStatus: payment.previousStatus ?? "created",
                toStatus: payment.status,
                reason: "credit verification replay",
                source: "billing/credits/verify",
                amount: payment.amount,
                currency: payment.currency,
                requestId: request.id,
                sessionId:
                    typeof request.headers["x-session-id"] === "string"
                        ? request.headers["x-session-id"]
                        : null,
                clientIp: request.ip ?? null,
                userAgent:
                    typeof request.headers["user-agent"] === "string"
                        ? request.headers["user-agent"]
                        : null,
            });

            // Record successful replay attempt
            await abuseProtection.recordSuccessfulAttempt(request.user!.id, 'credit_verification', {
                paymentId: payment.id,
                replay: true,
            });

            return reply.send({ success: true, alreadyProcessed: true });
        }

        const metadata = payment.metadata as { packId?: string; minutes?: number; credits?: number } | null;
        const minutes = metadata?.minutes ?? metadata?.credits ?? 0;
        if (!minutes) {
            return reply.status(400).send({ error: "Order has no minutes metadata" });
        }

        const updatedPayment = await prisma.payment.update({
            where: { id: payment.id },
            data: {
                razorpayPaymentId: razorpay_payment_id,
                razorpaySignature: razorpay_signature,
                status: "captured",
            },
        });

        fastify.log.info({
            action: 'PAYMENT_UPDATED',
            paymentId: updatedPayment.id,
            userId: `user-${request.user!.id.slice(0, 8)}...`,
            razorpayPaymentId: razorpay_payment_id,
            previousStatus: payment.status,
            newStatus: 'captured',
            kind: 'CREDITS',
        }, 'Payment record updated in database');

        await recordCapturedPaymentArtifacts({
            paymentId: updatedPayment.id,
            userId: request.user!.id,
            kind: "CREDITS",
            fromStatus: payment.status,
            toStatus: "captured",
            reason: "minute pack verification completed",
            source: "billing/credits/verify",
            amount: updatedPayment.amount,
            currency: updatedPayment.currency,
            requestId: request.id,
            sessionId:
                typeof request.headers["x-session-id"] === "string"
                    ? request.headers["x-session-id"]
                    : null,
            clientIp: request.ip ?? null,
            userAgent:
                typeof request.headers["user-agent"] === "string"
                    ? request.headers["user-agent"]
                    : null,
        });

        await grantPurchasedInterviewMinutes(request.user!.id, minutes, {
            type: "payment",
            id: payment.id,
        });

        // Record successful verification attempt
        await abuseProtection.recordSuccessfulAttempt(request.user!.id, 'credit_verification', {
            paymentId: updatedPayment.id,
            minutes,
        });

        // Invalidate cache when minutes are granted
        await invalidateUserPlanCache(request.user!.id);

        return reply.send({ success: true, minutes });
    });

    // ── Coupons ────────────────────────────────────────────────
    const redeemCouponSchema = z.object({
        code: z.string().trim().min(2).max(64),
    });

    fastify.post("/billing/coupons/redeem", async (request, reply) => {
        // Rate limit coupon attempts aggressively — brute-force defense.
        const rl = checkRateLimit(`billing:coupon:${request.user!.id}`, 10, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: "Too many coupon attempts. Please wait.",
            });
        }

        const parsed = redeemCouponSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({
                error: "Validation Error",
                details: parsed.error.flatten().fieldErrors,
            });
        }

        // Coupon codes are stored uppercased.
        const code = parsed.data.code.toUpperCase().trim();
        const coupon = await prisma.coupon.findUnique({ where: { code } });

        if (!coupon || !coupon.active) {
            return reply.status(404).send({ error: "Invalid coupon code" });
        }
        if (coupon.expiresAt && coupon.expiresAt < new Date()) {
            return reply.status(410).send({ error: "Coupon expired" });
        }
        if (
            coupon.maxRedemptions !== null &&
            coupon.maxRedemptions !== undefined &&
            coupon.redemptions >= coupon.maxRedemptions
        ) {
            return reply.status(410).send({ error: "Coupon fully redeemed" });
        }

        // Email restriction: if set, the authenticated user's email must match.
        if (coupon.allowedEmail) {
            const userEmail = request.user!.email?.toLowerCase();
            if (userEmail !== coupon.allowedEmail.toLowerCase()) {
                return reply.status(403).send({
                    error: "This coupon is restricted to a specific account",
                });
            }
        }

        // Only PLAN_GRANT is supported right now. DISCOUNT codes will be layered later.
        if (coupon.type !== "PLAN_GRANT" || !coupon.plan || !coupon.durationDays) {
            return reply.status(400).send({
                error: "Coupon type not yet supported",
            });
        }

        // Per-user limit — idempotent with the unique index (couponId, userId).
        const priorRedemptions = await prisma.couponRedemption.count({
            where: { couponId: coupon.id, userId: request.user!.id },
        });
        if (priorRedemptions >= coupon.perUserLimit) {
            return reply.status(409).send({ error: "Coupon already used" });
        }

        // Atomic redemption: increment coupon only if under cap, insert redemption row,
        // and create an active subscription. Uses optimistic WHERE-redemptions-lt pattern.
        try {
            const result = await prisma.$transaction(async (tx) => {
                // Guarded update
                if (
                    coupon.maxRedemptions !== null &&
                    coupon.maxRedemptions !== undefined
                ) {
                    const upd = await tx.coupon.updateMany({
                        where: {
                            id: coupon.id,
                            redemptions: { lt: coupon.maxRedemptions },
                        },
                        data: { redemptions: { increment: 1 } },
                    });
                    if (upd.count === 0) {
                        throw new Error("CAPACITY");
                    }
                    // If this redemption exhausted the coupon, mark it inactive so
                    // it appears as EXHAUSTED in admin views immediately.
                    if (coupon.redemptions + 1 >= coupon.maxRedemptions) {
                        await tx.coupon.update({
                            where: { id: coupon.id },
                            data: { active: false },
                        });
                    }
                } else {
                    await tx.coupon.update({
                        where: { id: coupon.id },
                        data: { redemptions: { increment: 1 } },
                    });
                }

                await tx.couponRedemption.create({
                    data: { couponId: coupon.id, userId: request.user!.id },
                });

                const now = new Date();
                const periodEnd = new Date(
                    now.getTime() + coupon.durationDays! * 24 * 60 * 60 * 1000
                );

                // Expire any existing coupon-sourced subscription first so we don't stack.
                await tx.subscription.updateMany({
                    where: {
                        userId: request.user!.id,
                        source: "COUPON",
                        status: "active",
                    },
                    data: { status: "expired", cancelAtPeriodEnd: false },
                });

                const newSub = await tx.subscription.create({
                    data: {
                        userId: request.user!.id,
                        plan: coupon.plan!,
                        cycle: "MONTHLY",
                        source: "COUPON",
                        status: "active",
                        couponId: coupon.id,
                        currentPeriodStart: now,
                        currentPeriodEnd: periodEnd,
                    },
                });

                return { plan: newSub.plan, expiresAt: periodEnd };
            });

            // Invalidate cache when coupon is redeemed and plan changes
            await invalidateUserPlanCache(request.user!.id);

            // Broadcast coupon redemption update via WebSocket
            await broadcastCouponRedemption(request.user!.id, coupon.code, result.plan);

            return reply.send({ success: true, ...result });
        } catch (err: any) {
            if (err?.code === "P2002") {
                // Unique (couponId, userId) — duplicate redemption.
                return reply.status(409).send({ error: "Coupon already used" });
            }
            if (err?.message === "CAPACITY") {
                return reply.status(410).send({ error: "Coupon fully redeemed" });
            }
            fastify.log.error(err, "Coupon redemption failed");
            return reply.status(500).send({ error: "Redemption failed" });
        }
    });

    // ── Subscription Upgrade (Immediate with Prorated Charge) ──
    const upgradeCalculateSchema = z.object({
        subscriptionId: z.string().uuid(),
        targetPlan: z.enum(PLANS).refine((p) => p !== "FREE", {
            message: "Cannot upgrade to FREE plan",
        }),
        targetCycle: z.enum(BILLING_CYCLES).optional(),
    });

    fastify.post("/billing/upgrade/calculate", async (request, reply) => {
        const user = request.user!;
        const rl = checkRateLimit(`billing:upgrade-calc:${user.id}`, 10, 3_600_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Please wait ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        console.log('[UPGRADE_CALCULATE] Request body:', request.body);
        const parsed = upgradeCalculateSchema.safeParse(request.body);
        if (!parsed.success) {
            console.error('[UPGRADE_CALCULATE] Validation failed:', parsed.error.flatten());
            return reply.status(400).send({
                error: "Validation Error",
                details: parsed.error.flatten().fieldErrors,
                message: parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', '),
            });
        }

        const { subscriptionId, targetPlan, targetCycle } = parsed.data;
        console.log('[UPGRADE_CALCULATE] Validated data:', { subscriptionId, targetPlan, targetCycle, userId: user.id });

        try {
            const calculation = await upgradeService.calculateUpgradeAmount({
                userId: user.id,
                currentSubscriptionId: subscriptionId,
                targetPlan: targetPlan as PlanKey,
                targetCycle: targetCycle as BillingCycle | undefined,
            });

            console.log('[UPGRADE_CALCULATE] Calculation successful:', calculation);
            return reply.send({
                success: true,
                calculation: {
                    currentPlan: calculation.currentPlan,
                    currentCycle: calculation.currentCycle,
                    targetPlan: calculation.targetPlan,
                    targetCycle: calculation.targetCycle,
                    remainingDays: calculation.remainingDays,
                    proratedAmount: calculation.proratedAmount,
                    proratedAmountInr: calculation.proratedAmount / 100,
                    nextCycleAmount: calculation.nextCycleAmount,
                    nextCycleAmountInr: calculation.nextCycleAmount / 100,
                    currentPeriodEnd: calculation.currentPeriodEnd,
                },
            });
        } catch (err) {
            console.error('[UPGRADE_CALCULATE] Error:', err);
            fastify.log.error(err, "Failed to calculate upgrade amount");
            return reply.status(400).send({
                error: err instanceof Error ? err.message : "Upgrade calculation failed",
            });
        }
    });

    const upgradeOrderSchema = z.object({
        subscriptionId: z.string().uuid(),
        targetPlan: z.enum(PLANS).refine((p) => p !== "FREE", {
            message: "Cannot upgrade to FREE plan",
        }),
        targetCycle: z.enum(BILLING_CYCLES).optional(),
    });

    fastify.post("/billing/upgrade/order", async (request, reply) => {
        const user = request.user!;
        const rl = checkRateLimit(`billing:upgrade-order:${user.id}`, 5, 3_600_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Please wait ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        const parsed = upgradeOrderSchema.safeParse(request.body);
        if (!parsed.success) {
            await abuseProtection.recordFailedAttempt(user.id, {
                type: 'subscription_upgrade',
                reason: 'validation_error',
                metadata: { errors: parsed.error.flatten().fieldErrors },
            });

            return reply.status(400).send({
                error: "Validation Error",
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const { subscriptionId, targetPlan, targetCycle } = parsed.data;

        try {
            // Calculate upgrade amount
            const calculation = await upgradeService.calculateUpgradeAmount({
                userId: user.id,
                currentSubscriptionId: subscriptionId,
                targetPlan: targetPlan as PlanKey,
                targetCycle: targetCycle as BillingCycle | undefined,
            });

            // Create Razorpay order
            const order = await upgradeService.createUpgradeOrder(
                {
                    userId: user.id,
                    currentSubscriptionId: subscriptionId,
                    targetPlan: targetPlan as PlanKey,
                    targetCycle: targetCycle as BillingCycle | undefined,
                },
                calculation
            );

            await abuseProtection.recordSuccessfulAttempt(user.id, 'subscription_upgrade', {
                orderId: order.orderId,
                subscriptionId,
                targetPlan,
            });

            return reply.send({
                success: true,
                orderId: order.orderId,
                amount: order.amount,
                amountInr: order.amount / 100,
                calculation: {
                    currentPlan: calculation.currentPlan,
                    targetPlan: calculation.targetPlan,
                    remainingDays: calculation.remainingDays,
                    proratedAmount: calculation.proratedAmount,
                },
            });
        } catch (err) {
            fastify.log.error(err, "Failed to create upgrade order");

            await abuseProtection.recordFailedAttempt(user.id, {
                type: 'subscription_upgrade',
                reason: 'order_creation_failed',
                metadata: { error: err instanceof Error ? err.message : 'unknown' },
            });

            if (isRazorpayConfigError(err)) {
                return reply.status(503).send({
                    error: "Payments are currently unavailable",
                });
            }
            if (isRazorpayUpstreamError(err)) {
                return reply.status(502).send({
                    error: "Payment provider is currently unavailable",
                });
            }
            return reply.status(400).send({
                error: err instanceof Error ? err.message : "Upgrade order creation failed",
            });
        }
    });

    const upgradeVerifySchema = z.object({
        razorpay_order_id: z.string().min(1),
        razorpay_payment_id: z.string().min(1),
        razorpay_signature: z.string().min(1),
    });

    fastify.post("/billing/upgrade/verify", async (request, reply) => {
        const user = request.user!;
        const rl = checkRateLimit(`billing:upgrade-verify:${user.id}`, 10, 3_600_000);
        if (!rl.allowed) {
            return reply.status(429).send({ error: "Too Many Requests" });
        }

        const parsed = upgradeVerifySchema.safeParse(request.body);
        if (!parsed.success) {
            await abuseProtection.recordFailedAttempt(user.id, {
                type: 'subscription_upgrade_verify',
                reason: 'validation_error',
                metadata: { errors: parsed.error.flatten().fieldErrors },
            });

            return reply.status(400).send({
                error: "Validation Error",
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = parsed.data;

        try {
            const secret = requireRazorpayEnv("RAZORPAY_KEY_SECRET");
            const result = await upgradeService.verifyAndApplyUpgrade(
                razorpay_order_id,
                razorpay_payment_id,
                razorpay_signature,
                user.id,
                secret
            );

            await abuseProtection.recordSuccessfulAttempt(user.id, 'subscription_upgrade_verify', {
                orderId: razorpay_order_id,
                paymentId: razorpay_payment_id,
                newPlan: result.newPlan,
            });

            // Invalidate cache when plan is upgraded
            await invalidateUserPlanCache(user.id);

            // Broadcast plan upgrade to user via WebSocket
            await broadcastPlanPurchase(user.id, result.newPlan);

            return reply.send({
                success: true,
                newPlan: result.newPlan,
                newCycle: result.newCycle,
            });
        } catch (err) {
            fastify.log.error(err, "Failed to verify upgrade payment");

            await abuseProtection.recordFailedAttempt(user.id, {
                type: 'subscription_upgrade_verify',
                reason: 'verification_failed',
                metadata: { error: err instanceof Error ? err.message : 'unknown' },
            });

            if (isRazorpayConfigError(err)) {
                return reply.status(503).send({
                    error: "Payments are currently unavailable",
                });
            }
            if (isRazorpayUpstreamError(err)) {
                return reply.status(502).send({
                    error: "Payment provider is currently unavailable",
                });
            }
            return reply.status(400).send({
                error: err instanceof Error ? err.message : "Upgrade verification failed",
            });
        }
    });

    // ── Subscription Downgrade (Deferred to Period End) ────────
    const downgradeScheduleSchema = z.object({
        subscriptionId: z.string().uuid(),
        targetPlan: z.enum(PLANS).refine((p) => p !== "FREE", {
            message: "Cannot downgrade to FREE plan",
        }),
    });

    fastify.post("/billing/downgrade/schedule", async (request, reply) => {
        const user = request.user!;
        const rl = checkRateLimit(`billing:downgrade:${user.id}`, 5, 3_600_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Please wait ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        const parsed = downgradeScheduleSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({
                error: "Validation Error",
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const { subscriptionId, targetPlan } = parsed.data;

        try {
            const schedule = await downgradeService.scheduleDowngrade({
                userId: user.id,
                currentSubscriptionId: subscriptionId,
                targetPlan: targetPlan as PlanKey,
            });

            // Invalidate cache when downgrade is scheduled
            await invalidateUserPlanCache(user.id);

            return reply.send({
                success: true,
                scheduledDate: schedule.scheduledDate,
                currentPlan: schedule.currentPlan,
                targetPlan: schedule.targetPlan,
                daysUntilDowngrade: schedule.daysUntilDowngrade,
                message: `Your plan will be downgraded to ${targetPlan} on ${schedule.scheduledDate.toISOString().split('T')[0]}. You will continue to have access to ${schedule.currentPlan} features until then.`,
            });
        } catch (err) {
            fastify.log.error(err, "Failed to schedule downgrade");
            return reply.status(400).send({
                error: err instanceof Error ? err.message : "Downgrade scheduling failed",
            });
        }
    });

    const downgradeCancelSchema = z.object({
        subscriptionId: z.string().uuid(),
    });

    fastify.post("/billing/downgrade/cancel", async (request, reply) => {
        const user = request.user!;
        const rl = checkRateLimit(`billing:downgrade-cancel:${user.id}`, 10, 3_600_000);
        if (!rl.allowed) {
            return reply.status(429).send({ error: "Too Many Requests" });
        }

        const parsed = downgradeCancelSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({
                error: "Validation Error",
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const { subscriptionId } = parsed.data;

        try {
            await downgradeService.cancelScheduledDowngrade(subscriptionId, user.id);

            // Invalidate cache when downgrade is cancelled
            await invalidateUserPlanCache(user.id);

            return reply.send({
                success: true,
                message: "Scheduled downgrade has been cancelled. You will continue with your current plan.",
            });
        } catch (err) {
            fastify.log.error(err, "Failed to cancel scheduled downgrade");
            return reply.status(400).send({
                error: err instanceof Error ? err.message : "Downgrade cancellation failed",
            });
        }
    });

    fastify.get("/billing/downgrade/status/:subscriptionId", async (request, reply) => {
        const user = request.user!;
        const { subscriptionId } = request.params as { subscriptionId: string };

        try {
            const schedule = await downgradeService.getScheduledDowngrade(subscriptionId, user.id);

            if (!schedule) {
                return reply.send({
                    hasScheduledDowngrade: false,
                });
            }

            return reply.send({
                hasScheduledDowngrade: true,
                scheduledDate: schedule.scheduledDate,
                currentPlan: schedule.currentPlan,
                targetPlan: schedule.targetPlan,
                daysUntilDowngrade: schedule.daysUntilDowngrade,
            });
        } catch (err) {
            fastify.log.error(err, "Failed to get downgrade status");
            return reply.status(400).send({
                error: err instanceof Error ? err.message : "Failed to get downgrade status",
            });
        }
    });

    // ── Cancel Subscription ────────────────────────────────────
    fastify.post("/billing/subscription/cancel", async (request, reply) => {
        const user = request.user!;
        const rl = checkRateLimit(`billing:cancel:${user.id}`, 5, 3_600_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Please wait ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        const schema = z.object({
            subscriptionId: z.string().uuid(),
        });

        const parsed = schema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({
                error: "Validation Error",
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const { subscriptionId } = parsed.data;

        try {
            const result = await cancellationService.cancelSubscription(
                user.id,
                subscriptionId,
                'user_request'
            );

            // Invalidate cache when subscription is cancelled
            await invalidateUserPlanCache(user.id);

            return reply.send({
                success: result.success,
                message: result.message,
                validUntil: result.validUntil,
                cancelledAt: result.cancelledAt,
            });
        } catch (err) {
            fastify.log.error(err, "Failed to cancel subscription");
            return reply.status(400).send({
                error: err instanceof Error ? err.message : "Subscription cancellation failed",
            });
        }
    });

    // ── Get Cancellation Preview ───────────────────────────────
    fastify.get("/billing/subscription/cancel-preview/:subscriptionId", async (request, reply) => {
        const user = request.user!;
        const { subscriptionId } = request.params as { subscriptionId: string };

        try {
            const preview = await cancellationService.getCancellationPreview(
                user.id,
                subscriptionId
            );

            return reply.send(preview);
        } catch (err) {
            fastify.log.error(err, "Failed to get cancellation preview");
            return reply.status(400).send({
                error: err instanceof Error ? err.message : "Failed to get cancellation preview",
            });
        }
    });
}

  
