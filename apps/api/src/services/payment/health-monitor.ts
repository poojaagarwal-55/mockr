import { PrismaClient } from '@prisma/client';
import { createClient } from 'redis';
import Razorpay from 'razorpay';
import { paymentConfig } from './config.js';

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: Date;
  checks: {
    database: HealthCheck;
    redis: HealthCheck;
    razorpay: HealthCheck;
  };
  uptime: number;
  version: string;
}

export interface HealthCheck {
  status: 'up' | 'down' | 'degraded';
  responseTime: number;
  error?: string;
  details?: Record<string, any>;
}

export interface PaymentMetrics {
  timestamp: Date;
  period: '1h' | '24h' | '7d' | '30d';
  payments: {
    total: number;
    successful: number;
    failed: number;
    pending: number;
    successRate: number;
  };
  webhooks: {
    total: number;
    processed: number;
    failed: number;
    averageProcessingTime: number;
  };
  reconciliation: {
    lastRun: Date | null;
    discrepanciesFound: number;
    autoResolved: number;
    manualReviewRequired: number;
  };
  abuse: {
    cooldownsActive: number;
    suspiciousPatterns: number;
    blockedAttempts: number;
  };
  financial: {
    totalRevenue: number;
    pendingSettlements: number;
    ledgerBalance: number;
    accountsReceivable: number;
  };
}

export class HealthMonitor {
  private readonly prisma: PrismaClient;
  private readonly startTime: Date;
  private readonly version: string;

  constructor(prisma: PrismaClient, version: string = '1.0.0') {
    this.prisma = prisma;
    this.startTime = new Date();
    this.version = version;
  }

  async getHealthStatus(): Promise<HealthStatus> {
    const [database, redis, razorpay] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkRazorpay(),
    ]);

    const allHealthy = [database, redis, razorpay].every(
      (check) => check.status === 'up'
    );
    const anyDown = [database, redis, razorpay].some(
      (check) => check.status === 'down'
    );

    return {
      status: anyDown ? 'unhealthy' : allHealthy ? 'healthy' : 'degraded',
      timestamp: new Date(),
      checks: {
        database,
        redis,
        razorpay,
      },
      uptime: Date.now() - this.startTime.getTime(),
      version: this.version,
    };
  }

  private async checkDatabase(): Promise<HealthCheck> {
    const startTime = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      const responseTime = Date.now() - startTime;

      // Check connection pool status
      const activeConnections = await this.prisma.$queryRaw<
        Array<{ count: bigint }>
      >`SELECT COUNT(*) as count FROM pg_stat_activity WHERE datname = current_database()`;

      return {
        status: responseTime < 1000 ? 'up' : 'degraded',
        responseTime,
        details: {
          activeConnections: Number(activeConnections[0]?.count || 0),
        },
      };
    } catch (error) {
      return {
        status: 'down',
        responseTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Database check failed',
      };
    }
  }

  private async checkRedis(): Promise<HealthCheck> {
    const startTime = Date.now();
    let client: ReturnType<typeof createClient> | null = null;

    try {
      const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
      client = createClient({ url: redisUrl });
      await client.connect();

      const pingResult = await client.ping();
      const responseTime = Date.now() - startTime;

      await client.disconnect();

      return {
        status: pingResult === 'PONG' && responseTime < 500 ? 'up' : 'degraded',
        responseTime,
        details: {
          ping: pingResult,
        },
      };
    } catch (error) {
      if (client) {
        try {
          await client.disconnect();
        } catch {
          // Ignore disconnect errors
        }
      }

      return {
        status: 'down',
        responseTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Redis check failed',
      };
    }
  }

  private async checkRazorpay(): Promise<HealthCheck> {
    const startTime = Date.now();
    try {
      const razorpay = new Razorpay({
        key_id: paymentConfig.razorpay.keyId,
        key_secret: paymentConfig.razorpay.keySecret,
      });

      // Try to fetch a non-existent order to verify API connectivity
      // This will fail but confirms API is reachable
      try {
        await razorpay.orders.fetch('order_test_connectivity');
      } catch (apiError: any) {
        // If we get a 400 error, it means API is reachable
        if (apiError?.statusCode === 400 || apiError?.statusCode === 404) {
          const responseTime = Date.now() - startTime;
          return {
            status: responseTime < 2000 ? 'up' : 'degraded',
            responseTime,
            details: {
              apiReachable: true,
            },
          };
        }
        throw apiError;
      }

      const responseTime = Date.now() - startTime;
      return {
        status: 'up',
        responseTime,
      };
    } catch (error) {
      return {
        status: 'down',
        responseTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Razorpay check failed',
      };
    }
  }

  async getPaymentMetrics(period: '1h' | '24h' | '7d' | '30d'): Promise<PaymentMetrics> {
    const now = new Date();
    const periodStart = this.getPeriodStart(now, period);

    const [
      paymentStats,
      webhookStats,
      reconciliationStats,
      abuseStats,
      financialStats,
    ] = await Promise.all([
      this.getPaymentStats(periodStart),
      this.getWebhookStats(periodStart),
      this.getReconciliationStats(),
      this.getAbuseStats(),
      this.getFinancialStats(),
    ]);

    return {
      timestamp: now,
      period,
      payments: paymentStats,
      webhooks: webhookStats,
      reconciliation: reconciliationStats,
      abuse: abuseStats,
      financial: financialStats,
    };
  }

  private getPeriodStart(now: Date, period: '1h' | '24h' | '7d' | '30d'): Date {
    const periodMs = {
      '1h': 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000,
    };

    return new Date(now.getTime() - periodMs[period]);
  }

  private async getPaymentStats(periodStart: Date) {
    const payments = await this.prisma.payment.groupBy({
      by: ['status'],
      where: {
        createdAt: { gte: periodStart },
      },
      _count: true,
    });

    const total = payments.reduce((sum, p) => sum + p._count, 0);
    const successful = payments.find((p) => p.status === 'captured')?._count || 0;
    const failed = payments.find((p) => p.status === 'failed')?._count || 0;
    const pending =
      payments.find((p) => p.status === 'pending')?._count ||
      payments.find((p) => p.status === 'authorized')?._count ||
      0;

    return {
      total,
      successful,
      failed,
      pending,
      successRate: total > 0 ? (successful / total) * 100 : 0,
    };
  }

  private async getWebhookStats(periodStart: Date) {
    const webhooks = await this.prisma.payment_webhook_events.aggregate({
      where: {
        createdAt: { gte: periodStart },
      },
      _count: true,
    });

    const processed = await this.prisma.payment_webhook_events.count({
      where: {
        createdAt: { gte: periodStart },
        processedAt: { not: null },
      },
    });

    const failed = await this.prisma.payment_webhook_events.count({
      where: {
        createdAt: { gte: periodStart },
        processingError: { not: null },
      },
    });

    // Calculate average processing time
    const processedWebhooks = await this.prisma.payment_webhook_events.findMany({
      where: {
        createdAt: { gte: periodStart },
        processedAt: { not: null },
      },
      select: {
        createdAt: true,
        processedAt: true,
      },
    });

    const totalProcessingTime = processedWebhooks.reduce((sum, w) => {
      if (w.processedAt) {
        return sum + (w.processedAt.getTime() - w.createdAt.getTime());
      }
      return sum;
    }, 0);

    const averageProcessingTime =
      processedWebhooks.length > 0
        ? totalProcessingTime / processedWebhooks.length
        : 0;

    return {
      total: webhooks._count,
      processed,
      failed,
      averageProcessingTime,
    };
  }

  private async getReconciliationStats() {
    const lastJob = await this.prisma.paymentReconciliationJob.findFirst({
      where: {
        status: 'completed',
      },
      orderBy: {
        completedAt: 'desc',
      },
    });

    return {
      lastRun: lastJob?.completedAt || null,
      discrepanciesFound: lastJob?.discrepanciesFound || 0,
      autoResolved: lastJob?.autoResolved || 0,
      manualReviewRequired: lastJob?.manualReviewRequired || 0,
    };
  }

  private async getAbuseStats() {
    const cooldownsActive = await this.prisma.userPaymentCooldown.count({
      where: {
        cooldownUntil: { gt: new Date() },
      },
    });

    const suspiciousPatterns = await this.prisma.userPaymentAttempt.count({
      where: {
        suspiciousPattern: true,
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    });

    const blockedAttempts = await this.prisma.userPaymentAttempt.count({
      where: {
        success: false,
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    });

    return {
      cooldownsActive,
      suspiciousPatterns,
      blockedAttempts,
    };
  }

  private async getFinancialStats() {
    // Get total revenue from captured payments
    const revenueResult = await this.prisma.payment.aggregate({
      where: {
        status: 'captured',
      },
      _sum: {
        amount: true,
      },
    });

    // Get pending settlements
    const pendingSettlementsResult = await this.prisma.payment.aggregate({
      where: {
        status: 'captured',
        settlementStatus: { not: 'settled' },
      },
      _sum: {
        amount: true,
      },
    });

    // Get ledger balance (sum of all credits - debits)
    const ledgerBalance = await this.calculateLedgerBalance();

    // Get accounts receivable (pending settlements)
    const accountsReceivable = pendingSettlementsResult._sum.amount || 0;

    return {
      totalRevenue: revenueResult._sum.amount || 0,
      pendingSettlements: pendingSettlementsResult._sum.amount || 0,
      ledgerBalance,
      accountsReceivable,
    };
  }

  private async calculateLedgerBalance(): Promise<number> {
    // Get cash account balance
    const cashAccount = await this.prisma.financialAccount.findFirst({
      where: {
        code: 'CASH',
        type: 'ASSET',
      },
    });

    if (!cashAccount) {
      return 0;
    }

    // Calculate balance from ledger entries
    const debits = await this.prisma.ledgerEntry.aggregate({
      where: {
        debitAccountId: cashAccount.id,
      },
      _sum: {
        amount: true,
      },
    });

    const credits = await this.prisma.ledgerEntry.aggregate({
      where: {
        creditAccountId: cashAccount.id,
      },
      _sum: {
        amount: true,
      },
    });

    return (debits._sum.amount || 0) - (credits._sum.amount || 0);
  }
}
 
