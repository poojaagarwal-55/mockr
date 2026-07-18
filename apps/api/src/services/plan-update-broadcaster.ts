// ============================================
// Plan Update Broadcasting Service
// ============================================
// Integrates with billing system to broadcast real-time plan updates
// via WebSocket when plans are purchased, activated, or modified.

import { broadcastPlanUpdate } from "./plan-websocket.js";
import { invalidateUserPlanCache, getCachedPlanData } from "./cache.js";
import { getEntitlementSnapshot } from "./entitlements.js";

// ============================================
// Plan Update Event Types
// ============================================

export type PlanUpdateReason = 
  | 'PURCHASE'
  | 'ACTIVATION' 
  | 'EXPIRATION'
  | 'ADMIN_MODIFICATION'
  | 'COUPON_REDEMPTION'
  | 'COUPON_REVOCATION';

export interface PlanUpdateContext {
  reason: PlanUpdateReason;
  source?: string;
  adminId?: string;
  metadata?: Record<string, any>;
}

// ============================================
// Plan Update Broadcasting Service
// ============================================

export class PlanUpdateBroadcaster {
  /**
   * Broadcast plan update to user with cache invalidation
   */
  async broadcastUserPlanUpdate(
    userId: string, 
    context: PlanUpdateContext
  ): Promise<void> {
    try {
      console.log(`[PlanBroadcaster] Broadcasting plan update for user ${userId.slice(0, 8)}, reason: ${context.reason}`);

      // 1. Fetch fresh plan data (cache should already be invalidated by caller)
      const freshPlanData = await getEntitlementSnapshot(userId);

      // 2. Broadcast via WebSocket with complete data
      broadcastPlanUpdate(userId, {
        plan: freshPlanData.plan,
        expiresAt: null, // Will be populated from subscription data if available
        entitlements: freshPlanData.entitlements,
        wallet: freshPlanData.wallet,
        usage: freshPlanData.usage,
        updateReason: context.reason,
        timestamp: new Date(),
        metadata: context.metadata
      });

      console.log(`[PlanBroadcaster] Successfully broadcasted plan update for user ${userId.slice(0, 8)}`);
    } catch (error) {
      console.error(`[PlanBroadcaster] Failed to broadcast plan update for user ${userId.slice(0, 8)}:`, error);
      // Don't throw - broadcasting failures shouldn't break the main flow
    }
  }

  /**
   * Broadcast plan updates to multiple users (batch operation)
   */
  async broadcastMultipleUserPlanUpdates(
    userIds: string[], 
    context: PlanUpdateContext
  ): Promise<void> {
    if (userIds.length === 0) return;

    console.log(`[PlanBroadcaster] Broadcasting plan updates to ${userIds.length} users, reason: ${context.reason}`);

    // Process in parallel but limit concurrency to avoid overwhelming the system
    const batchSize = 10;
    for (let i = 0; i < userIds.length; i += batchSize) {
      const batch = userIds.slice(i, i + batchSize);
      const promises = batch.map(userId => 
        this.broadcastUserPlanUpdate(userId, context)
      );
      
      try {
        await Promise.allSettled(promises);
      } catch (error) {
        console.error(`[PlanBroadcaster] Batch broadcast failed for batch starting at index ${i}:`, error);
      }
    }

    console.log(`[PlanBroadcaster] Completed batch broadcast for ${userIds.length} users`);
  }

  /**
   * Handle plan purchase completion
   */
  async handlePlanPurchase(
    userId: string, 
    planKey: string, 
    subscriptionId?: string
  ): Promise<void> {
    await this.broadcastUserPlanUpdate(userId, {
      reason: 'PURCHASE',
      source: 'razorpay',
      metadata: {
        planKey,
        subscriptionId
      }
    });
  }

  /**
   * Handle coupon redemption
   */
  async handleCouponRedemption(
    userId: string, 
    couponCode: string, 
    planKey: string
  ): Promise<void> {
    await this.broadcastUserPlanUpdate(userId, {
      reason: 'COUPON_REDEMPTION',
      source: 'coupon_system',
      metadata: {
        couponCode,
        planKey
      }
    });
  }

  /**
   * Handle admin plan modification
   */
  async handleAdminPlanModification(
    userId: string, 
    adminId: string, 
    action: string
  ): Promise<void> {
    await this.broadcastUserPlanUpdate(userId, {
      reason: 'ADMIN_MODIFICATION',
      source: 'admin_panel',
      adminId,
      metadata: {
        action
      }
    });
  }

  /**
   * Handle coupon access revocation
   */
  async handleCouponRevocation(
    userIds: string[], 
    adminId: string, 
    couponCode: string
  ): Promise<void> {
    await this.broadcastMultipleUserPlanUpdates(userIds, {
      reason: 'COUPON_REVOCATION',
      source: 'admin_panel',
      adminId,
      metadata: {
        couponCode
      }
    });
  }

  /**
   * Handle plan expiration
   */
  async handlePlanExpiration(userId: string): Promise<void> {
    await this.broadcastUserPlanUpdate(userId, {
      reason: 'EXPIRATION',
      source: 'system'
    });
  }
}

// ============================================
// Global Broadcaster Instance
// ============================================

export const planUpdateBroadcaster = new PlanUpdateBroadcaster();

// ============================================
// Convenience Functions
// ============================================

/**
 * Broadcast plan update after purchase
 */
export async function broadcastPlanPurchase(
  userId: string, 
  planKey: string, 
  subscriptionId?: string
): Promise<void> {
  await planUpdateBroadcaster.handlePlanPurchase(userId, planKey, subscriptionId);
}

/**
 * Broadcast plan update after coupon redemption
 */
export async function broadcastCouponRedemption(
  userId: string, 
  couponCode: string, 
  planKey: string
): Promise<void> {
  await planUpdateBroadcaster.handleCouponRedemption(userId, couponCode, planKey);
}

/**
 * Broadcast plan update after admin modification
 */
export async function broadcastAdminPlanModification(
  userId: string, 
  adminId: string, 
  action: string
): Promise<void> {
  await planUpdateBroadcaster.handleAdminPlanModification(userId, adminId, action);
}

/**
 * Broadcast plan updates after coupon revocation
 */
export async function broadcastCouponRevocation(
  userIds: string[], 
  adminId: string, 
  couponCode: string
): Promise<void> {
  await planUpdateBroadcaster.handleCouponRevocation(userIds, adminId, couponCode);
}

/**
 * Broadcast plan update after expiration
 */
export async function broadcastPlanExpiration(userId: string): Promise<void> {
  await planUpdateBroadcaster.handlePlanExpiration(userId);
}