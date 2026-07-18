// Subscription Cancellation Service
// Handles user-initiated cancellations and automatic cancellations due to payment failures

import { PrismaClient, Plan } from '@interviewforge/db';
import { Logger } from 'pino';
import Razorpay from 'razorpay';

export interface CancellationResult {
  success: boolean;
  subscriptionId: string;
  cancelledAt: Date;
  validUntil: Date;
  reason: string;
  message: string;
}

export class SubscriptionCancellationService {
  constructor(
    private prisma: PrismaClient,
    private razorpay: Razorpay,
    private logger: Logger
  ) {}

  /**
   * Cancel a subscription (user-initiated)
   * - Cancels the subscription in Razorpay (stops auto-renewal)
   * - Marks subscription as 'cancelled' in database
   * - Plan remains active until currentPeriodEnd
   */
  async cancelSubscription(
    userId: string,
    subscriptionId: string,
    reason: 'user_request' | 'payment_failure' | 'admin_action' = 'user_request'
  ): Promise<CancellationResult> {
    this.logger.info({
      action: 'CANCEL_SUBSCRIPTION_START',
      userId: `user-${userId.slice(0, 8)}...`,
      subscriptionId,
      reason,
    }, 'Starting subscription cancellation');

    try {
      // 1. Fetch subscription from database
      const subscription = await this.prisma.subscription.findUnique({
        where: { id: subscriptionId },
        select: {
          id: true,
          userId: true,
          razorpaySubscriptionId: true,
          status: true,
          plan: true,
          cycle: true,
          currentPeriodEnd: true,
          cancelledAt: true,
        },
      });

      if (!subscription) {
        throw new Error('Subscription not found');
      }

      if (subscription.userId !== userId) {
        throw new Error('Unauthorized: Subscription does not belong to user');
      }

      if (subscription.status === 'cancelled') {
        this.logger.info({
          action: 'SUBSCRIPTION_ALREADY_CANCELLED',
          subscriptionId,
        }, 'Subscription already cancelled');

        return {
          success: true,
          subscriptionId: subscription.id,
          cancelledAt: subscription.cancelledAt!,
          validUntil: subscription.currentPeriodEnd!,
          reason,
          message: 'Subscription was already cancelled',
        };
      }

      // 2. Cancel in Razorpay (stops future charges)
      try {
        await this.razorpay.subscriptions.cancel(subscription.razorpaySubscriptionId, 1);

        this.logger.info({
          action: 'RAZORPAY_SUBSCRIPTION_CANCELLED',
          razorpaySubscriptionId: subscription.razorpaySubscriptionId,
        }, 'Subscription cancelled in Razorpay');
      } catch (razorpayError) {
        this.logger.error({
          action: 'RAZORPAY_CANCELLATION_ERROR',
          razorpaySubscriptionId: subscription.razorpaySubscriptionId,
          error: razorpayError,
        }, 'Failed to cancel subscription in Razorpay');

        // Continue with local cancellation even if Razorpay fails
        // This ensures user can still cancel even if Razorpay is down
      }

      // 3. Update subscription in database
      const now = new Date();
      const updatedSubscription = await this.prisma.subscription.update({
        where: { id: subscriptionId },
        data: {
          status: 'cancelled',
          cancelledAt: now,
          cancellationReason: reason,
          // Keep currentPeriodEnd - plan stays active until then
        },
      });

      this.logger.info({
        action: 'SUBSCRIPTION_CANCELLED_SUCCESS',
        subscriptionId,
        userId: `user-${userId.slice(0, 8)}...`,
        validUntil: updatedSubscription.currentPeriodEnd,
      }, 'Subscription cancelled successfully');

      return {
        success: true,
        subscriptionId: updatedSubscription.id,
        cancelledAt: now,
        validUntil: updatedSubscription.currentPeriodEnd!,
        reason,
        message: `Your ${subscription.plan} plan will remain active until ${updatedSubscription.currentPeriodEnd?.toLocaleDateString()}. No further charges will be made.`,
      };
    } catch (error) {
      this.logger.error({
        action: 'CANCEL_SUBSCRIPTION_ERROR',
        userId: `user-${userId.slice(0, 8)}...`,
        subscriptionId,
        error,
      }, 'Failed to cancel subscription');

      throw error;
    }
  }

  /**
   * Handle expired subscriptions
   * - Called by background job to check for expired subscriptions
   * - Downgrades user to FREE plan when subscription expires
   */
  async handleExpiredSubscriptions(): Promise<void> {
    this.logger.info({
      action: 'CHECK_EXPIRED_SUBSCRIPTIONS_START',
    }, 'Checking for expired subscriptions');

    try {
      const now = new Date();

      // Find all active or cancelled subscriptions that have expired
      const expiredSubscriptions = await this.prisma.subscription.findMany({
        where: {
          status: { in: ['active', 'cancelled'] },
          currentPeriodEnd: {
            lt: now,
          },
        },
        select: {
          id: true,
          userId: true,
          razorpaySubscriptionId: true,
          plan: true,
          currentPeriodEnd: true,
          status: true,
        },
      });

      this.logger.info({
        action: 'EXPIRED_SUBSCRIPTIONS_FOUND',
        count: expiredSubscriptions.length,
      }, `Found ${expiredSubscriptions.length} expired subscriptions`);

      for (const subscription of expiredSubscriptions) {
        try {
          await this.prisma.$transaction(async (tx) => {
            // 1. Mark subscription as expired and downgrade to FREE
            await tx.subscription.update({
              where: { id: subscription.id },
              data: {
                status: 'expired',
                expiredAt: now,
                plan: 'FREE' as Plan,
              },
            });

            // 3. Reset monthly credits to 0 (monthly credits are lost on downgrade)
            await tx.creditWallet.update({
              where: { userId: subscription.userId },
              data: {
                monthlyBalance: 0,
                monthlyGrantedAt: null,
                monthlyResetAt: null,
              },
            });

            this.logger.info({
              action: 'SUBSCRIPTION_EXPIRED',
              subscriptionId: subscription.id,
              userId: `user-${subscription.userId.slice(0, 8)}...`,
              previousPlan: subscription.plan,
            }, 'Subscription expired, user downgraded to FREE, and monthly credits reset');
          });
        } catch (error) {
          this.logger.error({
            action: 'HANDLE_EXPIRED_SUBSCRIPTION_ERROR',
            subscriptionId: subscription.id,
            error,
          }, 'Failed to handle expired subscription');
        }
      }
    } catch (error) {
      this.logger.error({
        action: 'CHECK_EXPIRED_SUBSCRIPTIONS_ERROR',
        error,
      }, 'Failed to check expired subscriptions');
    }
  }

  /**
   * Handle failed payment attempts
   * - Called when a subscription payment fails
   * - After max retries, cancels subscription and downgrades to FREE
   */
  async handleFailedPayment(
    subscriptionId: string,
    razorpaySubscriptionId: string,
    attemptNumber: number,
    maxAttempts: number = 3
  ): Promise<void> {
    this.logger.warn({
      action: 'HANDLE_FAILED_PAYMENT',
      subscriptionId,
      razorpaySubscriptionId,
      attemptNumber,
      maxAttempts,
    }, 'Handling failed subscription payment');

    try {
      const subscription = await this.prisma.subscription.findUnique({
        where: { id: subscriptionId },
        select: {
          id: true,
          userId: true,
          plan: true,
          status: true,
          failedPaymentAttempts: true,
        },
      });

      if (!subscription) {
        this.logger.error({
          action: 'SUBSCRIPTION_NOT_FOUND',
          subscriptionId,
        }, 'Subscription not found for failed payment');
        return;
      }

      // Increment failed payment attempts
      const newAttemptCount = (subscription.failedPaymentAttempts || 0) + 1;

      await this.prisma.subscription.update({
        where: { id: subscriptionId },
        data: {
          failedPaymentAttempts: newAttemptCount,
          lastFailedPaymentAt: new Date(),
        },
      });

      // If max attempts reached, cancel subscription
      if (newAttemptCount >= maxAttempts) {
        this.logger.warn({
          action: 'MAX_PAYMENT_FAILURES_REACHED',
          subscriptionId,
          userId: `user-${subscription.userId.slice(0, 8)}...`,
          attempts: newAttemptCount,
        }, 'Max payment failures reached, cancelling subscription');

        // Cancel subscription due to payment failure
        await this.cancelSubscription(
          subscription.userId,
          subscriptionId,
          'payment_failure'
        );

        // Immediately downgrade to FREE (don't wait for period end)
        await this.prisma.subscription.update({
          where: { id: subscriptionId },
          data: { plan: 'FREE' as Plan },
        });

        this.logger.info({
          action: 'USER_DOWNGRADED_PAYMENT_FAILURE',
          userId: `user-${subscription.userId.slice(0, 8)}...`,
          previousPlan: subscription.plan,
        }, 'User downgraded to FREE due to payment failures');
      }
    } catch (error) {
      this.logger.error({
        action: 'HANDLE_FAILED_PAYMENT_ERROR',
        subscriptionId,
        error,
      }, 'Failed to handle failed payment');
    }
  }

  /**
   * Get cancellation preview
   * - Shows user what will happen if they cancel
   */
  async getCancellationPreview(
    userId: string,
    subscriptionId: string
  ): Promise<{
    canCancel: boolean;
    currentPlan: string;
    validUntil: Date | null;
    willDowngradeTo: string;
    message: string;
  }> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      select: {
        id: true,
        userId: true,
        plan: true,
        status: true,
        currentPeriodEnd: true,
        cancelledAt: true,
      },
    });

    if (!subscription) {
      return {
        canCancel: false,
        currentPlan: 'UNKNOWN',
        validUntil: null,
        willDowngradeTo: 'FREE',
        message: 'Subscription not found',
      };
    }

    if (subscription.userId !== userId) {
      return {
        canCancel: false,
        currentPlan: subscription.plan,
        validUntil: subscription.currentPeriodEnd,
        willDowngradeTo: 'FREE',
        message: 'Unauthorized',
      };
    }

    if (subscription.status === 'cancelled') {
      return {
        canCancel: false,
        currentPlan: subscription.plan,
        validUntil: subscription.currentPeriodEnd,
        willDowngradeTo: 'FREE',
        message: 'Subscription is already cancelled',
      };
    }

    return {
      canCancel: true,
      currentPlan: subscription.plan,
      validUntil: subscription.currentPeriodEnd,
      willDowngradeTo: 'FREE',
      message: `Your ${subscription.plan} plan will remain active until ${subscription.currentPeriodEnd?.toLocaleDateString()}. After that, you'll be downgraded to the FREE plan.`,
    };
  }
}
