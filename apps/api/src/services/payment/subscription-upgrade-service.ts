// ============================================
// Subscription Upgrade Service
// ============================================
// Handles immediate plan upgrades with prorated billing
// - Calculates prorated difference for remaining cycle days
// - Creates Razorpay order for prorated amount
// - Applies upgrade immediately upon payment verification
// - Grants ONLY the difference in entitlements (prorated)
// - Integrates with existing payment state machine
// ============================================

import { PrismaClient, Plan } from '@interviewforge/db';
import Razorpay from 'razorpay';
import crypto from 'crypto';
import { cyclePriceInr, PlanKey, BillingCycle } from '@interviewforge/shared';
import { ProratedEntitlementsService } from './prorated-entitlements-service.js';

export interface UpgradeRequest {
  userId: string;
  currentSubscriptionId: string;
  targetPlan: PlanKey;
  targetCycle?: BillingCycle; // Optional: change cycle during upgrade
}

export interface UpgradeCalculation {
  currentPlan: PlanKey;
  currentCycle: BillingCycle;
  targetPlan: PlanKey;
  targetCycle: BillingCycle;
  currentPeriodEnd: Date;
  remainingDays: number;
  currentPlanDailyRate: number;
  targetPlanDailyRate: number;
  dailyRateDifference: number;
  proratedAmount: number; // in paise
  nextCycleAmount: number; // in paise
  currentPlanPrice: number; // in rupees
  targetPlanPrice: number; // in rupees
}

export class SubscriptionUpgradeService {
  private proratedEntitlementsService: ProratedEntitlementsService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly razorpay: Razorpay,
    private readonly logger: any
  ) {
    this.proratedEntitlementsService = new ProratedEntitlementsService(prisma, logger);
  }

  /**
   * Calculate prorated upgrade amount based on remaining days in cycle
   */
  async calculateUpgradeAmount(request: UpgradeRequest): Promise<UpgradeCalculation> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: request.currentSubscriptionId },
    });

    if (!subscription) {
      throw new Error('Subscription not found');
    }

    if (subscription.userId !== request.userId) {
      throw new Error('Subscription does not belong to user');
    }

    // Allow active, authenticated, or created subscriptions
    // - active: recurring subscription with multiple payments
    // - authenticated: first payment completed
    // - created: subscription created, awaiting first payment (can still upgrade)
    const allowedStatuses = ['active', 'authenticated', 'created'];
    if (!allowedStatuses.includes(subscription.status)) {
      throw new Error(`Subscription is not active (current status: ${subscription.status})`);
    }

    if (!subscription.currentPeriodEnd) {
      throw new Error('Subscription has no active period');
    }

    // Calculate remaining days in current cycle
    const now = new Date();
    const periodEnd = subscription.currentPeriodEnd;
    const remainingMs = periodEnd.getTime() - now.getTime();
    const remainingDays = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));

    if (remainingDays <= 0) {
      throw new Error('Current period has ended. Please wait for renewal.');
    }

    // Determine target cycle (default to current cycle if not specified)
    const targetCycle = request.targetCycle || subscription.cycle;

    // Get pricing for both plans
    const currentPrice = cyclePriceInr(subscription.plan, subscription.cycle);
    const targetPrice = cyclePriceInr(request.targetPlan, targetCycle);

    // Validate this is actually an upgrade
    if (targetPrice <= currentPrice && targetCycle === subscription.cycle) {
      throw new Error('Target plan must be higher than current plan. Use downgrade for lower plans.');
    }

    // Calculate daily rates based on cycle length
    const daysInCurrentCycle = subscription.cycle === 'MONTHLY' ? 30 : 90;
    const daysInTargetCycle = targetCycle === 'MONTHLY' ? 30 : 90;
    
    const currentDailyRate = currentPrice / daysInCurrentCycle;
    const targetDailyRate = targetPrice / daysInTargetCycle;

    // Calculate prorated difference for remaining days
    const dailyDifference = targetDailyRate - currentDailyRate;
    const proratedAmount = Math.max(0, Math.round(dailyDifference * remainingDays * 100)); // Convert to paise

    // Next cycle will be full price of target plan
    const nextCycleAmount = targetPrice * 100;

    this.logger.info('Calculated upgrade amount', {
      userId: `user-${request.userId.slice(0, 8)}...`,
      subscriptionId: request.currentSubscriptionId,
      currentPlan: subscription.plan,
      targetPlan: request.targetPlan,
      remainingDays,
      proratedAmount,
      nextCycleAmount,
    });

    return {
      currentPlan: subscription.plan,
      currentCycle: subscription.cycle,
      targetPlan: request.targetPlan,
      targetCycle,
      currentPeriodEnd: periodEnd,
      remainingDays,
      currentPlanDailyRate: currentDailyRate,
      targetPlanDailyRate: targetDailyRate,
      dailyRateDifference: dailyDifference,
      proratedAmount,
      nextCycleAmount,
      currentPlanPrice: currentPrice,
      targetPlanPrice: targetPrice,
    };
  }

  /**
   * Create Razorpay order for prorated upgrade amount
   */
  async createUpgradeOrder(
    request: UpgradeRequest,
    calculation: UpgradeCalculation
  ): Promise<{ orderId: string; amount: number; calculation: UpgradeCalculation }> {
    if (calculation.proratedAmount <= 0) {
      throw new Error('Prorated amount must be positive for upgrades');
    }

    // Create Razorpay order for prorated amount
    const order = await this.razorpay.orders.create({
      amount: calculation.proratedAmount,
      currency: 'INR',
      receipt: `upgrade-${request.userId.slice(0, 8)}-${Date.now()}`,
      notes: {
        userId: request.userId,
        subscriptionId: request.currentSubscriptionId,
        upgradeType: 'prorated',
        fromPlan: calculation.currentPlan,
        toPlan: calculation.targetPlan,
        fromCycle: calculation.currentCycle,
        toCycle: calculation.targetCycle,
        remainingDays: calculation.remainingDays.toString(),
        proratedAmount: calculation.proratedAmount.toString(),
        nextCycleAmount: calculation.nextCycleAmount.toString(),
      },
    });

    // Create payment record
    await this.prisma.payment.create({
      data: {
        userId: request.userId,
        razorpayOrderId: order.id,
        amount: calculation.proratedAmount,
        currency: 'INR',
        status: 'created',
        kind: 'SUBSCRIPTION',
        isUpgradePayment: true,
        upgradeFromPlan: calculation.currentPlan,
        upgradeToPlan: calculation.targetPlan,
        proratedDays: calculation.remainingDays,
        receiptId: order.receipt,
        orderExpiry: new Date(Date.now() + 15 * 60 * 1000), // 15 minutes
        updatedAt: new Date(),
        metadata: {
          subscriptionId: request.currentSubscriptionId,
          upgradeType: 'prorated',
          upgradeCalculation: {
            currentPlan: calculation.currentPlan,
            currentCycle: calculation.currentCycle,
            targetPlan: calculation.targetPlan,
            targetCycle: calculation.targetCycle,
            currentPeriodEnd: calculation.currentPeriodEnd.toISOString(),
            remainingDays: calculation.remainingDays,
            currentPlanDailyRate: calculation.currentPlanDailyRate,
            targetPlanDailyRate: calculation.targetPlanDailyRate,
            dailyRateDifference: calculation.dailyRateDifference,
            proratedAmount: calculation.proratedAmount,
            nextCycleAmount: calculation.nextCycleAmount,
            currentPlanPrice: calculation.currentPlanPrice,
            targetPlanPrice: calculation.targetPlanPrice,
          },
        },
      },
    });

    this.logger.info('Created upgrade order', {
      userId: `user-${request.userId.slice(0, 8)}...`,
      orderId: order.id,
      amount: calculation.proratedAmount,
      fromPlan: calculation.currentPlan,
      toPlan: calculation.targetPlan,
    });

    return {
      orderId: order.id,
      amount: calculation.proratedAmount,
      calculation,
    };
  }

  /**
   * Verify payment signature and apply upgrade immediately
   */
  async verifyAndApplyUpgrade(
    razorpay_order_id: string,
    razorpay_payment_id: string,
    razorpay_signature: string,
    userId: string,
    webhookSecret: string
  ): Promise<{ success: boolean; newPlan: PlanKey; newCycle: BillingCycle }> {
    // Verify signature
    const payload = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(payload)
      .digest('hex');

    // Timing-safe comparison
    const isValid = crypto.timingSafeEqual(
      Buffer.from(expectedSignature, 'hex'),
      Buffer.from(razorpay_signature, 'hex')
    );

    if (!isValid) {
      throw new Error('Invalid signature');
    }

    // Find payment record
    const payment = await this.prisma.payment.findFirst({
      where: {
        razorpayOrderId: razorpay_order_id,
        userId,
        isUpgradePayment: true,
      },
    });

    if (!payment) {
      throw new Error('Upgrade payment not found');
    }

    // Idempotency check
    if (payment.status === 'captured') {
      const subscription = await this.prisma.subscription.findUnique({
        where: { id: (payment.metadata as any).subscriptionId },
      });

      this.logger.info('Upgrade already processed (idempotent)', {
        userId: `user-${userId.slice(0, 8)}...`,
        paymentId: payment.id,
        subscriptionId: subscription?.id,
      });

      return {
        success: true,
        newPlan: subscription!.plan,
        newCycle: subscription!.cycle,
      };
    }

    // Apply upgrade atomically with extended timeout for prorated entitlements
    return await this.prisma.$transaction(async (tx) => {
      // Update payment status
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          razorpayPaymentId: razorpay_payment_id,
          razorpaySignature: razorpay_signature,
          status: 'captured',
        },
      });

      // Update subscription to new plan
      const metadata = payment.metadata as any;
      const upgradeCalc = metadata.upgradeCalculation;
      
      const subscription = await tx.subscription.update({
        where: { id: metadata.subscriptionId },
        data: {
          previousPlan: payment.upgradeFromPlan,
          plan: payment.upgradeToPlan! as Plan,
          cycle: upgradeCalc.targetCycle as BillingCycle,
          upgradePaymentId: payment.id,
          // Cancel any scheduled downgrade
          scheduledPlanChange: null,
          scheduledChangeDate: null,
        },
      });

      // Grant ONLY the difference in entitlements (prorated)
      await this.proratedEntitlementsService.applyUpgradeWithProratedEntitlements(
        userId,
        subscription.id,
        payment.upgradeFromPlan! as PlanKey,
        payment.upgradeToPlan! as PlanKey,
        tx
      );

      // Record state transition
      await tx.payment_state_transitions.create({
        data: {
          paymentId: payment.id,
          fromStatus: 'created',
          toStatus: 'captured',
          reason: 'upgrade_payment_verified',
          source: 'billing/upgrade/verify',
          metadata: {
            subscriptionId: subscription.id,
            fromPlan: payment.upgradeFromPlan,
            toPlan: payment.upgradeToPlan,
            fromCycle: upgradeCalc.currentCycle,
            toCycle: upgradeCalc.targetCycle,
            proratedAmount: payment.amount,
            remainingDays: payment.proratedDays,
            proratedEntitlements: true,
          },
        },
      });

      this.logger.info('Applied subscription upgrade with prorated entitlements', {
        userId: `user-${userId.slice(0, 8)}...`,
        subscriptionId: subscription.id,
        fromPlan: payment.upgradeFromPlan,
        toPlan: payment.upgradeToPlan,
        fromCycle: upgradeCalc.currentCycle,
        toCycle: upgradeCalc.targetCycle,
        proratedAmount: payment.amount,
      });

      return {
        success: true,
        newPlan: subscription.plan,
        newCycle: subscription.cycle,
      };
    }, {
      timeout: 15000, // 15 seconds timeout for prorated entitlements processing
    });
  }

  /**
   * Handle bank reversal for upgrade payment - rollback to previous plan
   */
  async handleUpgradeReversal(paymentId: string): Promise<void> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        upgradeSubscriptions: true,
      },
    });

    if (!payment || !payment.isUpgradePayment) {
      throw new Error('Not an upgrade payment');
    }

    if (payment.upgradeSubscriptions.length === 0) {
      this.logger.warn('No subscription found for upgrade reversal', { paymentId });
      return;
    }

    const subscription = payment.upgradeSubscriptions[0];

    await this.prisma.$transaction(async (tx) => {
      // Rollback to previous plan
      await tx.subscription.update({
        where: { id: subscription.id },
        data: {
          plan: payment.upgradeFromPlan! as Plan,
          previousPlan: null,
          upgradePaymentId: null,
        },
      });

      // Update payment status
      await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: 'bank_reversed',
        },
      });

      // Record state transition
      await tx.payment_state_transitions.create({
        data: {
          paymentId: payment.id,
          fromStatus: 'captured',
          toStatus: 'bank_reversed',
          reason: 'bank_reversal_detected',
          source: 'upgrade_reversal_handler',
          metadata: {
            subscriptionId: subscription.id,
            rolledBackToPlan: payment.upgradeFromPlan,
          },
        },
      });
    });

    this.logger.info('Rolled back subscription upgrade due to bank reversal', {
      paymentId,
      subscriptionId: subscription.id,
      rolledBackToPlan: payment.upgradeFromPlan,
    });
  }
}
 
