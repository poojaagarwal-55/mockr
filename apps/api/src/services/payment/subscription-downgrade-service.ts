// ============================================
// Subscription Downgrade Service
// ============================================
// Handles deferred plan downgrades (Netflix-style)
// - Schedules downgrade for end of current billing period
// - User continues with current plan until period end
// - No immediate charge or refund
// - Background job applies downgrade at period end
// - Cancels scheduled downgrade if user upgrades
// ============================================

import { PrismaClient, Plan } from '@interviewforge/db';
import { cyclePriceInr, PlanKey, BillingCycle } from '@interviewforge/shared';

export interface DowngradeRequest {
  userId: string;
  currentSubscriptionId: string;
  targetPlan: PlanKey;
}

export interface DowngradeSchedule {
  scheduledDate: Date;
  currentPlan: PlanKey;
  targetPlan: PlanKey;
  currentCycle: BillingCycle;
  daysUntilDowngrade: number;
}

export class SubscriptionDowngradeService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger: any
  ) {}

  /**
   * Schedule a downgrade to take effect at the end of current billing period
   */
  async scheduleDowngrade(request: DowngradeRequest): Promise<DowngradeSchedule> {
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
    const allowedStatuses = ['active', 'authenticated', 'created'];
    if (!allowedStatuses.includes(subscription.status)) {
      throw new Error(`Subscription is not active (current status: ${subscription.status})`);
    }

    if (!subscription.currentPeriodEnd) {
      throw new Error('Subscription has no active period');
    }

    // Validate downgrade (can't downgrade to same or higher plan)
    const currentPrice = cyclePriceInr(subscription.plan, subscription.cycle);
    const targetPrice = cyclePriceInr(request.targetPlan, subscription.cycle);

    if (targetPrice >= currentPrice) {
      throw new Error('Target plan must be lower than current plan. Use upgrade for higher plans.');
    }

    // Check if already scheduled
    if (subscription.scheduledPlanChange) {
      throw new Error(`Downgrade already scheduled to ${subscription.scheduledPlanChange} on ${subscription.scheduledChangeDate?.toISOString()}`);
    }

    // Calculate days until downgrade
    const now = new Date();
    const daysUntilDowngrade = Math.ceil(
      (subscription.currentPeriodEnd.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)
    );

    // Schedule downgrade for period end
    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        scheduledPlanChange: request.targetPlan,
        scheduledChangeDate: subscription.currentPeriodEnd,
      },
    });

    this.logger.info('Scheduled subscription downgrade', {
      userId: `user-${request.userId.slice(0, 8)}...`,
      subscriptionId: subscription.id,
      currentPlan: subscription.plan,
      targetPlan: request.targetPlan,
      scheduledDate: subscription.currentPeriodEnd,
      daysUntilDowngrade,
    });

    return {
      scheduledDate: subscription.currentPeriodEnd,
      currentPlan: subscription.plan,
      targetPlan: request.targetPlan,
      currentCycle: subscription.cycle,
      daysUntilDowngrade,
    };
  }

  /**
   * Cancel a scheduled downgrade (e.g., user changes mind or upgrades)
   */
  async cancelScheduledDowngrade(subscriptionId: string, userId: string): Promise<void> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
    });

    if (!subscription) {
      throw new Error('Subscription not found');
    }

    if (subscription.userId !== userId) {
      throw new Error('Subscription does not belong to user');
    }

    if (!subscription.scheduledPlanChange) {
      throw new Error('No scheduled downgrade to cancel');
    }

    await this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        scheduledPlanChange: null,
        scheduledChangeDate: null,
      },
    });

    this.logger.info('Cancelled scheduled downgrade', {
      userId: `user-${userId.slice(0, 8)}...`,
      subscriptionId,
      cancelledPlan: subscription.scheduledPlanChange,
    });
  }

  /**
   * Apply all scheduled downgrades that are due
   * Called by background job
   */
  async applyScheduledDowngrades(): Promise<number> {
    const now = new Date();

    // Find all subscriptions with scheduled downgrades that should be applied
    const subscriptions = await this.prisma.subscription.findMany({
      where: {
        scheduledPlanChange: { not: null },
        scheduledChangeDate: { lte: now },
        status: 'active',
      },
    });

    let appliedCount = 0;
    let failedCount = 0;

    for (const subscription of subscriptions) {
      try {
        await this.applyDowngrade(subscription.id);
        appliedCount++;
      } catch (error) {
        failedCount++;
        this.logger.error('Failed to apply scheduled downgrade', {
          subscriptionId: subscription.id,
          error: error instanceof Error ? error.message : 'unknown',
        });
      }
    }

    if (appliedCount > 0 || failedCount > 0) {
      this.logger.info('Processed scheduled downgrades', {
        total: subscriptions.length,
        applied: appliedCount,
        failed: failedCount,
      });
    }

    return appliedCount;
  }

  /**
   * Apply a single scheduled downgrade
   */
  private async applyDowngrade(subscriptionId: string): Promise<void> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
    });

    if (!subscription || !subscription.scheduledPlanChange) {
      throw new Error('No scheduled downgrade found');
    }

    await this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        previousPlan: subscription.plan,
        plan: subscription.scheduledPlanChange as Plan,
        scheduledPlanChange: null,
        scheduledChangeDate: null,
      },
    });

    this.logger.info('Applied scheduled downgrade', {
      subscriptionId,
      fromPlan: subscription.plan,
      toPlan: subscription.scheduledPlanChange,
      userId: `user-${subscription.userId.slice(0, 8)}...`,
    });
  }

  /**
   * Get scheduled downgrade info for a subscription
   */
  async getScheduledDowngrade(subscriptionId: string, userId: string): Promise<DowngradeSchedule | null> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
    });

    if (!subscription || subscription.userId !== userId) {
      throw new Error('Subscription not found or does not belong to user');
    }

    if (!subscription.scheduledPlanChange || !subscription.scheduledChangeDate) {
      return null;
    }

    const now = new Date();
    const daysUntilDowngrade = Math.ceil(
      (subscription.scheduledChangeDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)
    );

    return {
      scheduledDate: subscription.scheduledChangeDate,
      currentPlan: subscription.plan,
      targetPlan: subscription.scheduledPlanChange as Plan,
      currentCycle: subscription.cycle,
      daysUntilDowngrade,
    };
  }

  /**
   * Check if a subscription has a scheduled downgrade
   */
  async hasScheduledDowngrade(subscriptionId: string): Promise<boolean> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      select: { scheduledPlanChange: true },
    });

    return subscription?.scheduledPlanChange !== null;
  }
}
  
