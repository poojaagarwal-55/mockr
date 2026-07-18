import Razorpay from 'razorpay';
import { PrismaClient } from '@interviewforge/db';
import { PAYMENT_CONSTANTS } from './config.js';
import { StateManager } from './state-manager.js';

type GatewayStatus = 'created' | 'pending' | 'authorized' | 'captured' | 'failed' | 'refunded' | null;

export type TechnicalReconciliationResult = {
  jobId: string;
  scanned: number;
  updated: number;
  unchanged: number;
  failed: number;
  details: Array<{
    paymentId: string;
    fromStatus: string;
    toStatus: string;
    source: 'payment' | 'order';
  }>;
};

export class ReconciliationService {
  private readonly prisma: PrismaClient;
  private readonly stateManager: StateManager;
  private razorpay: Razorpay | null = null;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.stateManager = new StateManager(prisma);
  }

  private getRazorpayClient(): Razorpay | null {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) {
      return null;
    }

    if (!this.razorpay) {
      this.razorpay = new Razorpay({
        key_id: keyId,
        key_secret: keySecret,
      });
    }

    return this.razorpay;
  }

  private async withRetry<T>(fn: () => Promise<T>, maxRetries: number = 3): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt < maxRetries; attempt += 1) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (attempt === maxRetries - 1) {
          break;
        }
        const waitMs = Math.pow(2, attempt) * 500;
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }

    throw lastError;
  }

  private mapGatewayStatusToInternal(status: string): GatewayStatus {
    const normalized = String(status || '').toLowerCase();

    if (normalized === 'created') return 'created';
    if (normalized === 'attempted' || normalized === 'pending') return 'pending';
    if (normalized === 'authorized') return 'authorized';
    if (normalized === 'captured' || normalized === 'paid') return 'captured';
    if (normalized === 'failed') return 'failed';
    if (normalized === 'refunded') return 'refunded';

    return null;
  }

  private async fetchGatewayStatus(payment: {
    razorpayPaymentId: string | null;
    razorpayOrderId: string | null;
  }): Promise<{ status: GatewayStatus; source: 'payment' | 'order' | null }> {
    const client = this.getRazorpayClient();
    if (!client) {
      return { status: null, source: null };
    }

    if (payment.razorpayPaymentId) {
      const gatewayPayment = await this.withRetry(() => client.payments.fetch(payment.razorpayPaymentId!));
      const status = this.mapGatewayStatusToInternal((gatewayPayment as any).status);
      return { status, source: 'payment' };
    }

    if (payment.razorpayOrderId) {
      const gatewayOrder = await this.withRetry(() => client.orders.fetch(payment.razorpayOrderId!));
      const status = this.mapGatewayStatusToInternal((gatewayOrder as any).status);
      return { status, source: 'order' };
    }

    return { status: null, source: null };
  }

  async runTechnicalReconciliation(options?: {
    staleMinutes?: number;
    maxPayments?: number;
  }): Promise<TechnicalReconciliationResult> {
    const staleMinutes = options?.staleMinutes || 30;
    const maxPayments = options?.maxPayments || 150;

    const job = await this.prisma.paymentReconciliationJob.create({
      data: {
        jobType: 'technical',
        status: 'running',
        startedAt: new Date(),
        dateRange: {
          staleMinutes,
          triggeredAt: new Date().toISOString(),
        },
      },
    });

    const threshold = new Date(Date.now() - staleMinutes * 60 * 1000);

    const candidates = await this.prisma.payment.findMany({
      where: {
        status: { in: ['created', 'pending', 'authorized'] },
        updatedAt: { lte: threshold },
      },
      select: {
        id: true,
        status: true,
        razorpayPaymentId: true,
        razorpayOrderId: true,
      },
      take: maxPayments,
      orderBy: { updatedAt: 'asc' },
    });

    let updated = 0;
    let unchanged = 0;
    let failed = 0;
    const details: TechnicalReconciliationResult['details'] = [];

    for (const payment of candidates) {
      try {
        const gateway = await this.fetchGatewayStatus(payment);
        if (!gateway.status || gateway.status === payment.status) {
          unchanged += 1;
          continue;
        }

        await this.stateManager.transitionState(payment.id, gateway.status, {
          reason: 'technical_reconciliation',
          source: 'reconciliation',
          metadata: {
            gatewaySource: gateway.source,
          },
        });

        updated += 1;
        details.push({
          paymentId: payment.id,
          fromStatus: payment.status,
          toStatus: gateway.status,
          source: gateway.source || 'order',
        });
      } catch {
        failed += 1;
      }
    }

    await this.prisma.paymentReconciliationJob.update({
      where: { id: job.id },
      data: {
        status: failed > 0 ? 'completed' : 'completed',
        completedAt: new Date(),
        paymentsChecked: candidates.length,
        discrepanciesFound: updated,
        autoResolved: updated,
        manualReviewRequired: failed,
        results: {
          scanned: candidates.length,
          updated,
          unchanged,
          failed,
        },
        discrepancies: details,
      },
    });

    return {
      jobId: job.id,
      scanned: candidates.length,
      updated,
      unchanged,
      failed,
      details,
    };
  }
}
