import Razorpay from 'razorpay';
import { PrismaClient } from '@interviewforge/db';
import { StateManager } from './state-manager.js';

export type ZombieDetectionResult = {
  jobId: string;
  scanned: number;
  detected: number;
  recovered: number;
  manualReview: number;
};

export class ZombiePaymentDetector {
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

  private mapGatewayStatus(status: string | null): 'captured' | 'failed' | 'authorized' | null {
    const normalized = String(status || '').toLowerCase();
    if (normalized === 'captured' || normalized === 'paid') return 'captured';
    if (normalized === 'failed') return 'failed';
    if (normalized === 'authorized') return 'authorized';
    return null;
  }

  async detectAndRecoverZombiePayments(options?: {
    thresholdHours?: number;
    maxPayments?: number;
  }): Promise<ZombieDetectionResult> {
    const thresholdHours = options?.thresholdHours || 24;
    const maxPayments = options?.maxPayments || 200;
    const threshold = new Date(Date.now() - thresholdHours * 60 * 60 * 1000);

    const job = await this.prisma.paymentReconciliationJob.create({
      data: {
        jobType: 'zombie_detection',
        status: 'running',
        startedAt: new Date(),
        dateRange: {
          thresholdHours,
          triggeredAt: new Date().toISOString(),
        },
      },
    });

    const candidates = await this.prisma.payment.findMany({
      where: {
        status: { in: ['created', 'pending', 'authorized'] },
        createdAt: { lte: threshold },
      },
      select: {
        id: true,
        userId: true,
        status: true,
        createdAt: true,
        razorpayOrderId: true,
        razorpayPaymentId: true,
      },
      take: maxPayments,
      orderBy: { createdAt: 'asc' },
    });

    const client = this.getRazorpayClient();

    let detected = 0;
    let recovered = 0;
    let manualReview = 0;

    for (const payment of candidates) {
      const ageHours = (Date.now() - payment.createdAt.getTime()) / (60 * 60 * 1000);
      let gatewayStatus: string | null = null;
      let recoveryPossible = false;
      let recoverySuccessful = false;

      try {
        if (client && payment.razorpayPaymentId) {
          const gatewayPayment = await client.payments.fetch(payment.razorpayPaymentId);
          gatewayStatus = String((gatewayPayment as any)?.status || null);
        }
      } catch {
        gatewayStatus = null;
      }

      const mappedStatus = this.mapGatewayStatus(gatewayStatus);
      recoveryPossible = mappedStatus === 'captured' || mappedStatus === 'failed';

      if (recoveryPossible && mappedStatus) {
        try {
          await this.stateManager.transitionState(payment.id, mappedStatus, {
            reason: 'zombie_payment_recovery',
            source: 'zombie_detector',
            metadata: {
              gatewayStatus,
              ageHours,
            },
          });
          recoverySuccessful = true;
        } catch {
          recoverySuccessful = false;
        }
      }

      await this.prisma.zombiePaymentRecord.upsert({
        where: { paymentId: payment.id },
        create: {
          paymentId: payment.id,
          ageHours,
          localStatus: payment.status,
          razorpayStatus: gatewayStatus,
          recoveryPossible,
          recoveryAttempted: recoveryPossible,
          recoverySuccessful,
          manualReviewRequired: !recoverySuccessful,
        },
        update: {
          ageHours,
          localStatus: payment.status,
          razorpayStatus: gatewayStatus,
          recoveryPossible,
          recoveryAttempted: recoveryPossible,
          recoverySuccessful,
          manualReviewRequired: !recoverySuccessful,
        },
      });

      detected += 1;
      if (recoverySuccessful) {
        recovered += 1;
      } else {
        manualReview += 1;
      }
    }

    await this.prisma.paymentReconciliationJob.update({
      where: { id: job.id },
      data: {
        status: 'completed',
        completedAt: new Date(),
        paymentsChecked: candidates.length,
        discrepanciesFound: detected,
        autoResolved: recovered,
        manualReviewRequired: manualReview,
        results: {
          detected,
          recovered,
          manualReview,
        },
      },
    });

    return {
      jobId: job.id,
      scanned: candidates.length,
      detected,
      recovered,
      manualReview,
    };
  }
}
 
