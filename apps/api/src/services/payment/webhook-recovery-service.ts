// Webhook Recovery Service - Handles missed webhooks and payment reconciliation
// This service polls Razorpay for payment status updates when webhooks are missed

import Razorpay from 'razorpay';
import { PrismaClient } from '@interviewforge/db';
import { paymentConfig } from './config.js';
import { grantPurchasedInterviewMinutes } from '../entitlements.js';

export class WebhookRecoveryService {
  private readonly razorpay: Razorpay;
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.razorpay = new Razorpay({
      key_id: paymentConfig.razorpay.keyId,
      key_secret: paymentConfig.razorpay.keySecret,
    });
  }

  /**
   * Recovers missed webhooks by checking payment status with Razorpay
   */
  async recoverMissedWebhooks(): Promise<number> {
    console.log('[WebhookRecovery] Starting webhook recovery process...');

    try {
      // Find payments that might have missed webhooks
      const stuckPayments = await this.findStuckPayments();
      
      console.log(`[WebhookRecovery] Found ${stuckPayments.length} potentially stuck payments`);

      let recoveredCount = 0;
      for (const payment of stuckPayments) {
        const recovered = await this.reconcilePayment(payment);
        if (recovered) recoveredCount++;
      }

      console.log(`[WebhookRecovery] Webhook recovery process completed. Recovered: ${recoveredCount}`);
      return recoveredCount;
    } catch (error) {
      console.error('[WebhookRecovery] Error during webhook recovery:', error);
      return 0;
    }
  }

  /**
   * Find payments that might have missed webhooks
   */
  private async findStuckPayments() {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    
    return await this.prisma.payment.findMany({
      where: {
        status: {
          in: ['created', 'authorized', 'pending']
        },
        razorpayPaymentId: {
          not: null
        },
        createdAt: {
          lt: fiveMinutesAgo // Only check payments older than 5 minutes
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 50 // Limit to prevent overwhelming the system
    });
  }

  /**
   * Reconcile a single payment with Razorpay
   */
  private async reconcilePayment(payment: any): Promise<boolean> {
    try {
      console.log(`[WebhookRecovery] Reconciling payment ${payment.id} (${payment.razorpayPaymentId})`);

      // Fetch current status from Razorpay
      const razorpayPayment = await this.razorpay.payments.fetch(payment.razorpayPaymentId);
      
      const currentStatus = this.mapRazorpayStatus(razorpayPayment.status);
      
      if (currentStatus === payment.status) {
        console.log(`[WebhookRecovery] Payment ${payment.id} status is up to date: ${currentStatus}`);
        return false;
      }

      console.log(`[WebhookRecovery] Payment ${payment.id} status mismatch: DB=${payment.status}, Razorpay=${currentStatus}`);

      // Update payment status
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: currentStatus,
          method: razorpayPayment.method,
          paymentCompletedUtc: currentStatus === 'captured' ? new Date() : null,
          amountPaid: currentStatus === 'captured' ? razorpayPayment.amount : payment.amountPaid,
          remainingAmount: currentStatus === 'captured' ? 0 : payment.remainingAmount,
        }
      });

      // Grant interview minutes if payment was captured
      if (currentStatus === 'captured' && payment.kind === 'CREDITS') {
        await this.grantMinutesIfNeeded(payment);
      }

      console.log(`[WebhookRecovery] Successfully reconciled payment ${payment.id}: ${payment.status} → ${currentStatus}`);
      return true;

    } catch (error) {
      console.error(`[WebhookRecovery] Failed to reconcile payment ${payment.id}:`, error);
      return false;
    }
  }

  /**
   * Grant minutes if they haven't been granted yet
   */
  private async grantMinutesIfNeeded(payment: any): Promise<void> {
    try {
      // Check if minutes were already granted
      const existingMinuteGrant = await this.prisma.creditLedger.findFirst({
        where: {
          refType: 'payment',
          refId: payment.id,
          reason: { in: ['minute_pack_purchase', 'credit_pack_purchase'] }
        }
      });

      if (existingMinuteGrant) {
        console.log(`[WebhookRecovery] Interview minutes already granted for payment ${payment.id}`);
        return;
      }

      const minutes = payment.metadata?.minutes ?? payment.metadata?.credits ?? 0;
      if (minutes > 0) {
        await grantPurchasedInterviewMinutes(payment.userId, minutes, {
          type: 'payment',
          id: payment.id,
        });

        console.log(`[WebhookRecovery] Granted ${minutes} interview minutes for payment ${payment.id}`);
      }
    } catch (error) {
      console.error(`[WebhookRecovery] Failed to grant interview minutes for payment ${payment.id}:`, error);
    }
  }

  /**
   * Map Razorpay status to internal status
   */
  private mapRazorpayStatus(razorpayStatus: string): string {
    const statusMap: Record<string, string> = {
      'created': 'created',
      'authorized': 'authorized',
      'captured': 'captured',
      'refunded': 'refunded',
      'failed': 'failed',
    };

    return statusMap[razorpayStatus] || 'failed';
  }

  /**
   * Recover a specific payment by ID
   */
  async recoverSpecificPayment(paymentId: string): Promise<boolean> {
    try {
      const payment = await this.prisma.payment.findUnique({
        where: { id: paymentId }
      });

      if (!payment || !payment.razorpayPaymentId) {
        console.log(`[WebhookRecovery] Payment ${paymentId} not found or missing Razorpay ID`);
        return false;
      }

      await this.reconcilePayment(payment);
      return true;
    } catch (error) {
      console.error(`[WebhookRecovery] Failed to recover payment ${paymentId}:`, error);
      return false;
    }
  }
}
