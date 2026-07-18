import { PrismaClient } from '@interviewforge/db';
import { paymentConfig } from './config.js';
import { SettlementService } from './edge-cases/settlement-service.js';
import { UpiPendingStateHandler } from './edge-cases/upi-pending-state-handler.js';
import { ReconciliationService } from './reconciliation-service.js';
import { ZombiePaymentDetector } from './zombie-payment-detector.js';
import { BusinessReconciliationService } from './business-reconciliation-service.js';
import { SubscriptionDowngradeService } from './subscription-downgrade-service.js';
import { SubscriptionCancellationService } from './subscription-cancellation-service.js';
import { dependencyFailureManager } from './dependency-failure-manager.js';
import { WebhookRecoveryService } from './webhook-recovery-service.js';
import Razorpay from 'razorpay';
import { requireRazorpayEnv } from '../../lib/env.js';

let started = false;
let lastBusinessDateKey = '';

type Logger = {
  info: (...args: any[]) => void;
  error: (...args: any[]) => void;
  warn: (...args: any[]) => void;
};

export function startPaymentBackgroundJobs(prisma: PrismaClient, logger?: Partial<Logger>) {
  if (started) {
    return;
  }
  started = true;

  const logInfo = (...args: any[]) => {
    if (logger?.info) {
      logger.info(...args);
    } else {
      console.log(...args);
    }
  };

  const logWarn = (...args: any[]) => {
    if (logger?.warn) {
      logger.warn(...args);
    } else {
      console.warn(...args);
    }
  };

  const logError = (...args: any[]) => {
    if (logger?.error) {
      logger.error(...args);
    } else {
      console.error(...args);
    }
  };

  const settlementService = new SettlementService(prisma);
  const upiPendingHandler = new UpiPendingStateHandler(prisma);
  const reconciliationService = new ReconciliationService(prisma);
  const zombieDetector = new ZombiePaymentDetector(prisma);
  const businessReconciliation = new BusinessReconciliationService(prisma);
  const webhookRecovery = new WebhookRecoveryService(prisma);
  const downgradeService = new SubscriptionDowngradeService(prisma, {
    info: logInfo,
    error: logError,
    warn: logWarn,
  } as any);
  
  const razorpay = new Razorpay({
    key_id: requireRazorpayEnv('RAZORPAY_KEY_ID'),
    key_secret: requireRazorpayEnv('RAZORPAY_KEY_SECRET'),
  });
  
  const cancellationService = new SubscriptionCancellationService(prisma, razorpay, {
    info: logInfo,
    error: logError,
    warn: logWarn,
  } as any);

  // Technical reconciliation
  setInterval(async () => {
    try {
      const guarded = await dependencyFailureManager.executeWithCircuitBreaker(
        'razorpay.reconciliation',
        () =>
          reconciliationService.runTechnicalReconciliation({
            staleMinutes: paymentConfig.reconciliation.intervalMinutes,
          }),
        {
          failureThreshold: 4,
          cooldownMs: 2 * 60_000,
        }
      );

      if (!guarded.ok) {
        throw guarded.error instanceof Error ? guarded.error : new Error('Reconciliation job failed');
      }

      logInfo({ result: guarded.data }, 'Payment technical reconciliation completed');
    } catch (error) {
      logError({ error }, 'Payment technical reconciliation failed');
    }
  }, paymentConfig.reconciliation.intervalMinutes * 60_000).unref();

  // Webhook recovery (runs every 30 seconds for instant updates)
  setInterval(async () => {
    try {
      const guarded = await dependencyFailureManager.executeWithCircuitBreaker(
        'razorpay.webhook-recovery',
        () => webhookRecovery.recoverMissedWebhooks(),
        {
          failureThreshold: 3,
          cooldownMs: 1 * 60_000,
        }
      );

      if (!guarded.ok) {
        throw guarded.error instanceof Error ? guarded.error : new Error('Webhook recovery job failed');
      }

      // Only log if there were recoveries to avoid spam
      if (guarded.data && guarded.data > 0) {
        logInfo({ recovered: guarded.data }, 'Webhook recovery completed');
      }
    } catch (error) {
      logError({ error }, 'Webhook recovery failed');
    }
  }, 30_000).unref(); // Every 30 seconds

  // Zombie payment detection
  setInterval(async () => {
    try {
      const guarded = await dependencyFailureManager.executeWithCircuitBreaker(
        'razorpay.zombie-detection',
        () =>
          zombieDetector.detectAndRecoverZombiePayments({
            thresholdHours: paymentConfig.reconciliation.zombieDetectionIntervalHours,
          }),
        {
          failureThreshold: 4,
          cooldownMs: 2 * 60_000,
        }
      );

      if (!guarded.ok) {
        throw guarded.error instanceof Error ? guarded.error : new Error('Zombie detection job failed');
      }

      logInfo({ result: guarded.data }, 'Zombie payment scan completed');
    } catch (error) {
      logError({ error }, 'Zombie payment scan failed');
    }
  }, paymentConfig.reconciliation.zombieDetectionIntervalHours * 60 * 60_000).unref();

  // UPI pending timeout sweeper
  setInterval(async () => {
    try {
      const guarded = await dependencyFailureManager.executeWithCircuitBreaker(
        'database.upi-pending-sweep',
        () => upiPendingHandler.failExpiredPendingPayments(),
        {
          failureThreshold: 6,
          cooldownMs: 30_000,
        }
      );

      if (!guarded.ok) {
        throw guarded.error instanceof Error ? guarded.error : new Error('UPI pending sweep failed');
      }

      const result = guarded.data;
      if (result && result.failed > 0) {
        logInfo({ result }, 'UPI pending timeout sweep completed');
      }
    } catch (error) {
      logError({ error }, 'UPI pending timeout sweep failed');
    }
  }, 5 * 60_000).unref();

  // Settlement sync
  setInterval(async () => {
    try {
      const guarded = await dependencyFailureManager.executeWithCircuitBreaker(
        'razorpay.settlement-sync',
        () => settlementService.syncRecentSettlements(48),
        {
          failureThreshold: 4,
          cooldownMs: 2 * 60_000,
        }
      );

      if (!guarded.ok) {
        throw guarded.error instanceof Error ? guarded.error : new Error('Settlement sync failed');
      }

      logInfo({ result: guarded.data }, 'Settlement sync completed');
    } catch (error) {
      logError({ error }, 'Settlement sync failed');
    }
  }, 2 * 60 * 60_000).unref();

  // Business reconciliation scheduler (hourly check, runs once/day)
  setInterval(async () => {
    try {
      if (paymentConfig.features.enableBusinessReconciliation === false) {
        return;
      }

      const now = new Date();
      const utcHour = now.getUTCHours();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const dateKey = yesterday.toISOString().slice(0, 10);

      if (utcHour !== 2) {
        return;
      }

      if (lastBusinessDateKey === dateKey) {
        return;
      }

      const guarded = await dependencyFailureManager.executeWithCircuitBreaker(
        'razorpay.business-reconciliation',
        () => businessReconciliation.runDailyReconciliation(yesterday),
        {
          failureThreshold: 3,
          cooldownMs: 4 * 60_000,
        }
      );

      if (!guarded.ok) {
        throw guarded.error instanceof Error ? guarded.error : new Error('Business reconciliation failed');
      }

      lastBusinessDateKey = dateKey;
      logInfo({ report: guarded.data }, 'Business reconciliation completed');
    } catch (error) {
      logError({ error }, 'Business reconciliation failed');
    }
  }, 60 * 60_000).unref();

  // Expired order cleanup
  setInterval(async () => {
    try {
      const now = new Date();
      const guarded = await dependencyFailureManager.executeWithCircuitBreaker(
        'database.expired-order-cleanup',
        () =>
          prisma.payment.updateMany({
            where: {
              status: { in: ['created', 'pending'] },
              orderExpiry: { lte: now },
            },
            data: {
              status: 'cancelled',
              statusUpdatedAt: now,
            },
          }),
        {
          failureThreshold: 8,
          cooldownMs: 30_000,
        }
      );

      if (!guarded.ok) {
        throw guarded.error instanceof Error ? guarded.error : new Error('Expired order cleanup failed');
      }

      if ((guarded.data?.count || 0) > 0) {
        logInfo({ updated: guarded.data?.count || 0 }, 'Expired order cleanup completed');
      }
    } catch (error) {
      logError({ error }, 'Expired order cleanup failed');
    }
  }, 30 * 60_000).unref();

  // Old webhook event cleanup
  setInterval(async () => {
    try {
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const guarded = await dependencyFailureManager.executeWithCircuitBreaker(
        'database.webhook-cleanup',
        () =>
          prisma.payment_webhook_events.deleteMany({
            where: {
              processedAt: { not: null },
              createdAt: { lt: cutoff },
            },
          }),
        {
          failureThreshold: 6,
          cooldownMs: 30_000,
        }
      );

      if (!guarded.ok) {
        throw guarded.error instanceof Error ? guarded.error : new Error('Webhook cleanup failed');
      }

      if ((guarded.data?.count || 0) > 0) {
        logInfo({ deleted: guarded.data?.count || 0 }, 'Webhook event cleanup completed');
      }
    } catch (error) {
      logError({ error }, 'Webhook event cleanup failed');
    }
  }, 12 * 60 * 60_000).unref();

  // Audit retention monitor (alerts only; does not delete immutable audit rows)
  setInterval(async () => {
    try {
      const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const oldCount = await prisma.payment_audit_logs.count({
        where: {
          createdAt: { lt: cutoff },
        },
      });

      if (oldCount > 0) {
        logWarn({ oldCount }, 'Payment audit logs older than 90 days require archival');
      }
    } catch (error) {
      logError({ error }, 'Audit retention monitor failed');
    }
  }, 24 * 60 * 60_000).unref();

  // Scheduled downgrade processor (runs every hour)
  setInterval(async () => {
    try {
      const guarded = await dependencyFailureManager.executeWithCircuitBreaker(
        'database.scheduled-downgrade-processor',
        () => downgradeService.applyScheduledDowngrades(),
        {
          failureThreshold: 6,
          cooldownMs: 30_000,
        }
      );

      if (!guarded.ok) {
        throw guarded.error instanceof Error ? guarded.error : new Error('Scheduled downgrade processing failed');
      }

      const appliedCount = guarded.data || 0;
      if (appliedCount > 0) {
        logInfo({ appliedCount }, 'Scheduled downgrades processed');
      }
    } catch (error) {
      logError({ error }, 'Scheduled downgrade processing failed');
    }
  }, 60 * 60_000).unref(); // Every hour

  // Expired subscription handler (runs every hour)
  setInterval(async () => {
    try {
      const guarded = await dependencyFailureManager.executeWithCircuitBreaker(
        'database.expired-subscription-handler',
        () => cancellationService.handleExpiredSubscriptions(),
        {
          failureThreshold: 6,
          cooldownMs: 30_000,
        }
      );

      if (!guarded.ok) {
        throw guarded.error instanceof Error ? guarded.error : new Error('Expired subscription handling failed');
      }

      logInfo('Expired subscriptions check completed');
    } catch (error) {
      logError({ error }, 'Expired subscription handling failed');
    }
  }, 60 * 60_000).unref(); // Every hour

  logInfo('Payment background jobs started');
}
 
  
