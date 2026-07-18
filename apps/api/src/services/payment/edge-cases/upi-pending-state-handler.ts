import Razorpay from 'razorpay';
import { PrismaClient } from '@interviewforge/db';
import { PAYMENT_CONSTANTS } from '../config.js';
import { StateManager } from '../state-manager.js';

export class UpiPendingStateHandler {
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

  async markPending(paymentId: string, metadata?: Record<string, unknown>) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) {
      return false;
    }

    if (payment.status !== 'pending') {
      await this.stateManager.transitionState(payment.id, 'pending', {
        reason: 'upi_pending',
        source: 'api',
        metadata,
      });
    }

    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        orderExpiry: new Date(Date.now() + PAYMENT_CONSTANTS.ORDER_EXPIRY_MINUTES.UPI * 60 * 1000),
      },
    });

    return true;
  }

  async syncPendingStatusWithGateway(paymentId: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment || !payment.razorpayPaymentId) {
      return { synced: false, reason: 'missing_payment_or_gateway_id' };
    }

    const client = this.getRazorpayClient();
    if (!client) {
      return { synced: false, reason: 'gateway_not_configured' };
    }

    const gatewayPayment = await client.payments.fetch(payment.razorpayPaymentId);
    const gatewayStatus = String((gatewayPayment as any)?.status || '').toLowerCase();

    if (gatewayStatus === 'captured') {
      await this.stateManager.transitionState(payment.id, 'captured', {
        reason: 'upi_pending_resolved_captured',
        source: 'reconciliation',
        metadata: { razorpayPaymentId: payment.razorpayPaymentId },
      });
      return { synced: true, status: 'captured' };
    }

    if (gatewayStatus === 'failed') {
      await this.stateManager.transitionState(payment.id, 'failed', {
        reason: 'upi_pending_resolved_failed',
        source: 'reconciliation',
        metadata: { razorpayPaymentId: payment.razorpayPaymentId },
      });
      return { synced: true, status: 'failed' };
    }

    return { synced: true, status: 'pending' };
  }

  async failExpiredPendingPayments(timeoutMinutes: number = 10) {
    const now = new Date();
    const threshold = new Date(now.getTime() - timeoutMinutes * 60 * 1000);

    const pendingPayments = await this.prisma.payment.findMany({
      where: {
        status: 'pending',
        OR: [
          { statusUpdatedAt: { lte: threshold } },
          { orderExpiry: { lte: now } },
        ],
      },
      select: { id: true },
      take: 200,
      orderBy: { createdAt: 'asc' },
    });

    let failedCount = 0;
    for (const payment of pendingPayments) {
      await this.stateManager.transitionState(payment.id, 'failed', {
        reason: 'upi_pending_timeout',
        source: 'system',
      });
      failedCount += 1;
    }

    return {
      scanned: pendingPayments.length,
      failed: failedCount,
    };
  }
}
