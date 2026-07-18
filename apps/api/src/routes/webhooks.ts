// ============================================
// Razorpay webhooks
// ============================================
// Handles:
//   - subscription.charged       → extend sub period
//   - subscription.halted        → mark past_due
//   - subscription.cancelled     → mark cancelled
//   - subscription.completed     → mark completed
//   - payment.captured (CREDITS) → grant interview minutes (fallback to client-verify)
//   - payment.failed             → mark payment failed
//
// All events are idempotency-checked by WebhookEvent.eventId. Minute grants
// use the atomic entitlements service so double-delivery is a no-op.
// ============================================

import { FastifyPluginAsync } from "fastify";
import Razorpay from "razorpay";
import crypto from "crypto";
import { prisma } from "../lib/prisma.js";
import { requireRazorpayEnv } from "../lib/env.js";
import { grantPurchasedInterviewMinutes } from "../services/entitlements.js";

const webhookRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.post("/webhooks/razorpay", async (request, reply) => {
        const secret = requireRazorpayEnv("RAZORPAY_WEBHOOK_SECRET");
        const signature = request.headers["x-razorpay-signature"] as string;

        if (!signature) {
            return reply.status(400).send({ error: "Missing signature" });
        }

        const bodyStr = JSON.stringify(request.body);

        // Verify signature — use SDK first, fall back to manual HMAC.
        let isValid = false;
        try {
            isValid = Razorpay.validateWebhookSignature(bodyStr, signature, secret);
        } catch {
            const expected = crypto
                .createHmac("sha256", secret)
                .update(bodyStr)
                .digest("hex");
            try {
                isValid = crypto.timingSafeEqual(
                    Buffer.from(expected, "hex"),
                    Buffer.from(signature, "hex")
                );
            } catch {
                isValid = false;
            }
        }
        if (!isValid) {
            fastify.log.warn("Invalid Razorpay webhook signature.");
            return reply.status(400).send({ error: "Invalid signature" });
        }

        const body = request.body as any;
        const event = body.event as string;
        // Razorpay sends `id` on some payloads; fallback to payload.payment.entity.id.
        const eventId: string =
            body.id ??
            body.payload?.payment?.entity?.id ??
            body.payload?.subscription?.entity?.id ??
            crypto.createHash("sha256").update(bodyStr).digest("hex");

        let internalPaymentId: string | null = null;
        try {
            const paymentEntity = body.payload?.payment?.entity;
            if (paymentEntity?.id || paymentEntity?.order_id) {
                const linkedPayment = await prisma.payment.findFirst({
                    where: {
                        OR: [
                            paymentEntity?.id
                                ? { razorpayPaymentId: paymentEntity.id }
                                : undefined,
                            paymentEntity?.order_id
                                ? { razorpayOrderId: paymentEntity.order_id }
                                : undefined,
                        ].filter(Boolean) as any,
                    },
                    select: { id: true },
                });
                internalPaymentId = linkedPayment?.id ?? null;
            }
        } catch (err) {
            fastify.log.warn(err, "Failed to map webhook payload to internal payment");
        }

        try {
            await prisma.payment_webhook_events.upsert({
                where: { eventId: eventId },
                update: {
                    payload: body,
                    signature,
                    eventType: event,
                    paymentId: internalPaymentId,
                },
                create: {
                    eventId: eventId,
                    eventType: event,
                    payload: body,
                    signature,
                    paymentId: internalPaymentId,
                    processed: false,
                },
            });
        } catch (err) {
            fastify.log.warn(err, "Failed to persist payment_webhook_events record");
        }

        // Idempotency: skip if we've seen this event already.
        try {
            await prisma.webhookEvent.create({
                data: {
                    provider: "razorpay",
                    eventId,
                    eventType: event,
                    payload: body,
                },
            });
        } catch (err: any) {
            if (err?.code === "P2002") {
                // duplicate — already processed
                return reply.send({ received: true, deduped: true });
            }
            fastify.log.error(err, "Failed to persist webhook event");
            // continue processing — persistence failure shouldn't block a legit event
        }

        try {
            switch (event) {
                case "subscription.charged": {
                    const sub = body.payload?.subscription?.entity;
                    if (sub?.id) {
                        const row = await prisma.subscription.findUnique({
                            where: { razorpaySubscriptionId: sub.id },
                        });
                        if (row) {
                            // Extend period: Razorpay supplies current_start/current_end as unix seconds.
                            const currentStart = sub.current_start
                                ? new Date(sub.current_start * 1000)
                                : row.currentPeriodStart;
                            const currentEnd = sub.current_end
                                ? new Date(sub.current_end * 1000)
                                : row.currentPeriodEnd;
                            await prisma.subscription.update({
                                where: { id: row.id },
                                data: {
                                    status: "active",
                                    currentPeriodStart: currentStart,
                                    currentPeriodEnd: currentEnd,
                                },
                            });
                        }
                    }
                    break;
                }
                case "subscription.halted":
                case "subscription.pending": {
                    const sub = body.payload?.subscription?.entity;
                    if (sub?.id) {
                        await prisma.subscription.updateMany({
                            where: { razorpaySubscriptionId: sub.id },
                            data: { status: "past_due" },
                        });
                    }
                    break;
                }
                case "subscription.cancelled": {
                    const sub = body.payload?.subscription?.entity;
                    if (sub?.id) {
                        await prisma.subscription.updateMany({
                            where: { razorpaySubscriptionId: sub.id },
                            data: { status: "cancelled" },
                        });
                    }
                    break;
                }
                case "subscription.completed": {
                    const sub = body.payload?.subscription?.entity;
                    if (sub?.id) {
                        await prisma.subscription.updateMany({
                            where: { razorpaySubscriptionId: sub.id },
                            data: { status: "expired" },
                        });
                    }
                    break;
                }
                case "payment.authorized": {
                    const pay = body.payload?.payment?.entity;
                    if (!pay?.id || !pay.order_id) break;

                    // Look up the pre-created payment row by order_id.
                    const existing = await prisma.payment.findFirst({
                        where: { razorpayOrderId: pay.order_id },
                    });

                    if (!existing) {
                        fastify.log.info(
                            { orderId: pay.order_id },
                            "Webhook: payment.authorized for unknown order — ignoring"
                        );
                        break;
                    }

                    // Update to authorized status
                    await prisma.payment.update({
                        where: { id: existing.id },
                        data: {
                            razorpayPaymentId: pay.id,
                            status: "authorized",
                            amount: Number(pay.amount ?? existing.amount),
                            method: pay.method ?? null,
                        },
                    });

                    fastify.log.info(
                        { paymentId: existing.id, razorpayPaymentId: pay.id },
                        "Payment authorized via webhook"
                    );

                    // Auto-capture authorized payments if enabled
                    if (process.env.ENABLE_AUTO_CAPTURE !== 'false') {
                        try {
                            fastify.log.info(
                                { paymentId: existing.id, razorpayPaymentId: pay.id },
                                "Auto-capturing authorized payment"
                            );

                            const razorpay = new Razorpay({
                                key_id: requireRazorpayEnv("RAZORPAY_KEY_ID"),
                                key_secret: requireRazorpayEnv("RAZORPAY_KEY_SECRET"),
                            });

                            // Capture the payment
                            const capturedPayment = await razorpay.payments.capture(
                                pay.id,
                                Number(pay.amount),
                                pay.currency || 'INR'
                            );

                            // Update payment status to captured
                            await prisma.payment.update({
                                where: { id: existing.id },
                                data: {
                                    status: "captured",
                                    paymentCompletedUtc: new Date(),
                                    amountPaid: Number(capturedPayment.amount),
                                    remainingAmount: 0,
                                },
                            });

                            // Grant minutes if this is a minute pack
                            if (existing.kind === "CREDITS") {
                                const md = existing.metadata as { minutes?: number; credits?: number } | null;
                                const minutes = md?.minutes ?? md?.credits ?? 0;
                                if (minutes > 0) {
                                    const already = await prisma.creditLedger.findFirst({
                                        where: {
                                            refType: "payment",
                                            refId: existing.id,
                                            reason: { in: ["minute_pack_purchase", "credit_pack_purchase"] },
                                        },
                                    });
                                    if (!already) {
                                        await grantPurchasedInterviewMinutes(existing.userId, minutes, {
                                            type: "payment",
                                            id: existing.id,
                                        });
                                        fastify.log.info(
                                            { userId: existing.userId, minutes, paymentId: existing.id },
                                            "Interview minutes granted via auto-capture"
                                        );
                                    }
                                }
                            }

                            fastify.log.info(
                                { paymentId: existing.id, razorpayPaymentId: pay.id },
                                "Payment auto-captured successfully"
                            );

                        } catch (captureError: any) {
                            // Check if payment was already captured
                            if (captureError?.error?.description?.includes('already been captured')) {
                                fastify.log.info(
                                    { paymentId: existing.id, razorpayPaymentId: pay.id },
                                    "Payment already captured by Razorpay auto-capture"
                                );
                                
                                // Update our database to reflect captured status
                                await prisma.payment.update({
                                    where: { id: existing.id },
                                    data: {
                                        status: "captured",
                                        paymentCompletedUtc: new Date(),
                                        amountPaid: Number(pay.amount),
                                        remainingAmount: 0,
                                    },
                                });

                                // Grant minutes since payment is captured
                                if (existing.kind === "CREDITS") {
                                    const md = existing.metadata as { minutes?: number; credits?: number } | null;
                                    const minutes = md?.minutes ?? md?.credits ?? 0;
                                    if (minutes > 0) {
                                        const already = await prisma.creditLedger.findFirst({
                                            where: {
                                                refType: "payment",
                                                refId: existing.id,
                                                reason: { in: ["minute_pack_purchase", "credit_pack_purchase"] },
                                            },
                                        });
                                        if (!already) {
                                            await grantPurchasedInterviewMinutes(existing.userId, minutes, {
                                                type: "payment",
                                                id: existing.id,
                                            });
                                            fastify.log.info(
                                                { userId: existing.userId, minutes, paymentId: existing.id },
                                                "Interview minutes granted after detecting Razorpay auto-capture"
                                            );
                                        }
                                    }
                                }
                            } else {
                                fastify.log.error(
                                    { 
                                        paymentId: existing.id, 
                                        razorpayPaymentId: pay.id, 
                                        error: captureError 
                                    },
                                    "Failed to auto-capture authorized payment"
                                );
                            }
                            // Don't throw - the payment is still authorized and can be captured later
                        }
                    }
                    break;
                }
                case "payment.captured": {
                    const pay = body.payload?.payment?.entity;
                    if (!pay?.id || !pay.order_id) break;

                    // Look up the pre-created payment row by order_id.
                    const existing = await prisma.payment.findFirst({
                        where: { razorpayOrderId: pay.order_id },
                    });

                    if (!existing) {
                        fastify.log.info(
                            { orderId: pay.order_id },
                            "Webhook: payment.captured for unknown order — ignoring"
                        );
                        break;
                    }

                    if (existing.status === "captured") break; // already handled

                    await prisma.payment.update({
                        where: { id: existing.id },
                        data: {
                            razorpayPaymentId: pay.id,
                            status: "captured",
                            amount: Number(pay.amount ?? existing.amount),
                            method: pay.method ?? null,
                        },
                    });

                    // If this is a minute pack, grant minutes now (fallback path —
                    // typically the client verify handler did this first).
                    if (existing.kind === "CREDITS") {
                        const md = existing.metadata as { minutes?: number; credits?: number } | null;
                        const minutes = md?.minutes ?? md?.credits ?? 0;
                        if (minutes > 0) {
                            // grantPurchasedInterviewMinutes is idempotent per ledger row; we guard
                            // by checking if a ledger entry already exists for this payment.
                            const already = await prisma.creditLedger.findFirst({
                                where: {
                                    refType: "payment",
                                    refId: existing.id,
                                    reason: { in: ["minute_pack_purchase", "credit_pack_purchase"] },
                                },
                            });
                            if (!already) {
                                await grantPurchasedInterviewMinutes(existing.userId, minutes, {
                                    type: "payment",
                                    id: existing.id,
                                });
                                fastify.log.info(
                                    { userId: existing.userId, minutes, paymentId: existing.id },
                                    "Interview minutes granted via webhook"
                                );
                            }
                        }
                    }
                    break;
                }
                case "payment.failed": {
                    const pay = body.payload?.payment?.entity;
                    if (pay?.order_id) {
                        await prisma.payment.updateMany({
                            where: { razorpayOrderId: pay.order_id },
                            data: { status: "failed" },
                        });
                    }
                    break;
                }
                default:
                    fastify.log.info({ event }, "Unhandled Razorpay webhook event");
            }

            try {
                await prisma.payment_webhook_events.updateMany({
                    where: { eventId: eventId },
                    data: {
                        processed: true,
                        processedAt: new Date(),
                        processingError: null,
                    },
                });
            } catch (err) {
                fastify.log.warn(err, "Failed to mark payment_webhook_events as processed");
            }
        } catch (err) {
            fastify.log.error(err, "Error processing Razorpay webhook");
            try {
                await prisma.payment_webhook_events.updateMany({
                    where: { eventId: eventId },
                    data: {
                        processed: false,
                        processingError:
                            err instanceof Error ? err.message.slice(0, 900) : "unknown error",
                    },
                });
            } catch (updateErr) {
                fastify.log.warn(updateErr, "Failed to persist webhook processing failure");
            }
            // Return 200 anyway — we persisted the event; Razorpay will retry otherwise
            // and we'll double-process. Better to log and move on.
        }

        return reply.send({ received: true });
    });
};

export default webhookRoutes;
