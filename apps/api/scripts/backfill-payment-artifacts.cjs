const path = require("path");
const crypto = require("crypto");
const dotenv = require("dotenv");
const Razorpay = require("razorpay");
const { PrismaClient } = require("@prisma/client");

dotenv.config({ path: path.resolve(__dirname, "../.env.local") });
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const prisma = new PrismaClient();

function maskIpForAudit(ip) {
  if (!ip) return null;
  if (ip.includes(".")) {
    const parts = ip.split(".");
    if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.x`;
  }
  return `${String(ip).slice(0, 12)}...`;
}

function hashUserAgentForAudit(userAgent) {
  if (!userAgent) return null;
  return crypto.createHash("sha256").update(String(userAgent)).digest("hex");
}

async function upsertCoreAccounts(tx, kind) {
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

  const revenueCode = kind === "SUBSCRIPTION" ? "4000" : "4100";
  const revenueName = kind === "SUBSCRIPTION" ? "Subscription Revenue" : "Credits Revenue";

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
        kind === "SUBSCRIPTION"
          ? "Revenue from subscription purchases"
          : "Revenue from credit pack purchases",
    },
  });

  return { receivable, revenue };
}

async function main() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  const razorpay = keyId && keySecret ? new Razorpay({ key_id: keyId, key_secret: keySecret }) : null;

  const payments = await prisma.payment.findMany({
    where: { status: "captured" },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      userId: true,
      kind: true,
      status: true,
      previousStatus: true,
      amount: true,
      currency: true,
      method: true,
      razorpayPaymentId: true,
      clientIp: true,
      userAgent: true,
      sessionId: true,
    },
  });

  if (!payments.length) {
    console.log("No captured payments found. Nothing to backfill.");
    return;
  }

  const latestAudit = await prisma.paymentAuditLog.findFirst({
    orderBy: { sequence: "desc" },
    select: { sequence: true, hash: true },
  });

  let nextSequence = (latestAudit?.sequence || 0) + 1;
  let previousHash = latestAudit?.hash || null;

  let updatedAmounts = 0;
  let stateCreated = 0;
  let auditCreated = 0;
  let ledgerCreated = 0;

  for (const payment of payments) {
    let resolvedAmount = payment.amount || 0;
    let resolvedMethod = payment.method || null;

    if (resolvedAmount <= 0 && razorpay && payment.razorpayPaymentId) {
      try {
        const gatewayPayment = await razorpay.payments.fetch(payment.razorpayPaymentId);
        if (typeof gatewayPayment.amount === "number" && gatewayPayment.amount > 0) {
          resolvedAmount = gatewayPayment.amount;
        }
        if (typeof gatewayPayment.method === "string") {
          resolvedMethod = gatewayPayment.method;
        }
      } catch (err) {
        console.warn(`Could not fetch amount for ${payment.razorpayPaymentId}:`, err.message || err);
      }
    }

    await prisma.$transaction(async (tx) => {
      if ((payment.amount || 0) <= 0 && resolvedAmount > 0) {
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            amount: resolvedAmount,
            method: resolvedMethod,
          },
        });
        updatedAmounts += 1;
      }

      const stateExists = await tx.paymentStateTransition.findFirst({
        where: {
          paymentId: payment.id,
          toStatus: "captured",
        },
        select: { id: true },
      });

      if (!stateExists) {
        await tx.paymentStateTransition.create({
          data: {
            paymentId: payment.id,
            fromStatus: payment.previousStatus || "created",
            toStatus: "captured",
            reason: "historical payment backfill",
            source: "backfill/script",
            metadata: {
              backfilled: true,
            },
          },
        });
        stateCreated += 1;
      }

      const hasAudit = await tx.paymentAuditLog.findFirst({
        where: { paymentId: payment.id },
        select: { id: true },
      });

      if (!hasAudit) {
        const timestamp = new Date().toISOString();
        const eventType = "PAYMENT_STATUS_BACKFILLED";
        const eventData = {
          fromStatus: payment.previousStatus || "created",
          toStatus: payment.status,
          source: "backfill/script",
          reason: "historical payment backfill",
          amount: resolvedAmount,
          currency: payment.currency || "INR",
          kind: payment.kind,
        };
        const sanitizedData = {
          ...eventData,
          user: `user-${payment.userId.slice(0, 8)}...`,
        };

        const hashInput = [
          nextSequence,
          timestamp,
          eventType,
          payment.id,
          payment.userId,
          JSON.stringify(eventData),
          previousHash || "",
        ].join("|");

        const hash = crypto.createHash("sha256").update(hashInput).digest("hex");

        await tx.paymentAuditLog.create({
          data: {
            paymentId: payment.id,
            eventType,
            eventData,
            sequence: nextSequence,
            previousHash,
            hash,
            sanitizedData,
            userId: payment.userId,
            sessionId: payment.sessionId,
            clientIp: maskIpForAudit(payment.clientIp),
            userAgent: hashUserAgentForAudit(payment.userAgent),
          },
        });

        previousHash = hash;
        nextSequence += 1;
        auditCreated += 1;
      }

      const hasLedger = await tx.ledgerTransaction.findFirst({
        where: {
          referenceType: "payment_captured",
          referenceId: payment.id,
        },
        select: { id: true },
      });

      if (!hasLedger && resolvedAmount > 0) {
        const { receivable, revenue } = await upsertCoreAccounts(tx, payment.kind);

        const ledgerTx = await tx.ledgerTransaction.create({
          data: {
            paymentId: payment.id,
            referenceType: "payment_captured",
            referenceId: payment.id,
            description: `Payment captured (${payment.kind})`,
            currency: payment.currency || "INR",
            totalDebit: resolvedAmount,
            totalCredit: resolvedAmount,
            metadata: {
              source: "backfill/script",
              backfilled: true,
            },
          },
        });

        await tx.ledgerEntry.create({
          data: {
            transactionId: ledgerTx.id,
            debitAccountId: receivable.id,
            creditAccountId: revenue.id,
            amount: resolvedAmount,
            description: "Recognize receivable and revenue",
            metadata: {
              backfilled: true,
              paymentId: payment.id,
            },
          },
        });

        ledgerCreated += 1;
      }
    });
  }

  console.log(
    JSON.stringify(
      {
        capturedPayments: payments.length,
        updatedAmounts,
        stateCreated,
        auditCreated,
        ledgerCreated,
      },
      null,
      2
    )
  );
}

main()
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
