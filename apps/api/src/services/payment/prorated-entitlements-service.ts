// ============================================
// Prorated Entitlements Service
// ============================================
// Handles granting the DIFFERENCE in entitlements when upgrading
// - Calculates delta between old and new plan
// - Grants only the additional interview minutes/tokens/limits
// - Prevents company loss and user loss
// - Integrates with existing entitlements system
// ============================================

import { PrismaClient, Prisma } from '@interviewforge/db';
import { PLAN_ENTITLEMENTS, PlanKey } from '@interviewforge/shared';
import { invalidateUserPlanCache } from '../cache.js';
import { broadcastPlanUpdate } from '../plan-websocket.js';
import { getCachedPlanData } from '../cache.js';

export interface EntitlementsDelta {
  // Interview minutes
  monthlyInterviewMinutes: number; // difference in monthly interview minutes
  
  // Resume
  resumeAnalysisPerMonth: number;
  resumeImproveAiPerMonth: number;
  
  // LaTeX AI tokens
  latexAiMonthlyTokens: number;
  
  // AI Tutor tokens
  aiTutorMonthlyTokens: number;
  
  // DSA submit (qualitative change)
  dsaSubmitAccessChanged: boolean;
  dsaSubmitHiddenTestCapChanged: boolean;
}

export class ProratedEntitlementsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger: any
  ) {}

  /**
   * Calculate the difference in entitlements between two plans
   */
  calculateEntitlementsDelta(fromPlan: PlanKey, toPlan: PlanKey): EntitlementsDelta {
    const fromEnt = PLAN_ENTITLEMENTS[fromPlan];
    const toEnt = PLAN_ENTITLEMENTS[toPlan];

    return {
      monthlyInterviewMinutes: Math.max(0, toEnt.monthlyInterviewMinutes - fromEnt.monthlyInterviewMinutes),
      resumeAnalysisPerMonth: Math.max(0, toEnt.resumeAnalysisPerMonth - fromEnt.resumeAnalysisPerMonth),
      resumeImproveAiPerMonth: Math.max(0, toEnt.resumeImproveAiPerMonth - fromEnt.resumeImproveAiPerMonth),
      latexAiMonthlyTokens: Math.max(0, toEnt.latexAiMonthlyTokens - fromEnt.latexAiMonthlyTokens),
      aiTutorMonthlyTokens: Math.max(0, toEnt.aiTutorMonthlyTokens - fromEnt.aiTutorMonthlyTokens),
      dsaSubmitAccessChanged: fromEnt.dsaSubmitAccess !== toEnt.dsaSubmitAccess,
      dsaSubmitHiddenTestCapChanged: fromEnt.dsaSubmitHiddenTestCaseCap !== toEnt.dsaSubmitHiddenTestCaseCap,
    };
  }

  /**
   * Grant prorated entitlements when upgrading
   * Only grants the DIFFERENCE between old and new plan
   */
  async grantUpgradeEntitlements(
    userId: string,
    fromPlan: PlanKey,
    toPlan: PlanKey,
    subscriptionId: string,
    client: Prisma.TransactionClient | PrismaClient = this.prisma
  ): Promise<void> {
    const delta = this.calculateEntitlementsDelta(fromPlan, toPlan);

    this.logger.info('Granting prorated entitlements for upgrade', {
      userId: `user-${userId.slice(0, 8)}...`,
      fromPlan,
      toPlan,
      delta,
    });

    // 1. Grant additional monthly interview minutes to wallet
    if (delta.monthlyInterviewMinutes > 0) {
      const wallet = await client.creditWallet.findUnique({
        where: { userId },
      });

      if (!wallet) {
        throw new Error('Wallet not found');
      }

      // Add the difference to monthly balance
      const updatedWallet = await client.creditWallet.update({
        where: { userId },
        data: {
          monthlyBalance: { increment: delta.monthlyInterviewMinutes },
        },
      });

      // Record in ledger
      await client.creditLedger.create({
        data: {
          userId,
          walletId: wallet.id,
          bucket: 'MONTHLY',
          delta: delta.monthlyInterviewMinutes,
          reason: 'plan_upgrade_prorated',
          refType: 'subscription',
          refId: subscriptionId,
          balanceAfter: {
            free: updatedWallet.freeCreditsRemaining,
            monthly: updatedWallet.monthlyBalance,
            purchased: updatedWallet.purchasedBalance,
          },
        },
      });

      this.logger.info('Granted prorated monthly interview minutes', {
        userId: `user-${userId.slice(0, 8)}...`,
        minutes: delta.monthlyInterviewMinutes,
        newMonthlyBalance: updatedWallet.monthlyBalance,
      });
    }

    // 2. Grant additional resume analysis quota
    if (delta.resumeAnalysisPerMonth > 0) {
      const now = new Date();
      const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

      // Find existing usage for this month
      const existingUsage = await client.featureUsage.findFirst({
        where: {
          userId,
          featureKey: 'resume_analysis',
          periodStart,
        },
      });

      if (existingUsage) {
        // Increase the limit by the delta
        await (client.featureUsage as any).update({
          where: { id: existingUsage.id },
          data: {
            limit: { increment: delta.resumeAnalysisPerMonth },
          },
        });
      }
      // If no usage record exists yet, it will be created with the new plan's limit on first use
    }

    // 3. Grant additional resume improve AI quota
    if (delta.resumeImproveAiPerMonth > 0) {
      const now = new Date();
      const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

      const existingUsage = await client.featureUsage.findFirst({
        where: {
          userId,
          featureKey: 'resume_improve_ai',
          periodStart,
        },
      });

      if (existingUsage) {
        await (client.featureUsage as any).update({
          where: { id: existingUsage.id },
          data: {
            limit: { increment: delta.resumeImproveAiPerMonth },
          },
        });
      }
    }

    // 4. Grant additional LaTeX AI tokens
    if (delta.latexAiMonthlyTokens > 0) {
      const now = new Date();
      const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

      const existingUsage = await client.featureUsage.findFirst({
        where: {
          userId,
          featureKey: 'latex_ai_tokens',
          periodStart,
        },
      });

      if (existingUsage) {
        await (client.featureUsage as any).update({
          where: { id: existingUsage.id },
          data: {
            limit: { increment: delta.latexAiMonthlyTokens },
          },
        });
      }
    }

    // 5. Grant additional AI Tutor tokens
    if (delta.aiTutorMonthlyTokens > 0) {
      const now = new Date();
      const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

      const existingUsage = await client.featureUsage.findFirst({
        where: {
          userId,
          featureKey: 'tutor_tokens',
          periodStart,
        },
      });

      if (existingUsage) {
        await client.featureUsage.update({
          where: { id: existingUsage.id },
          data: {
            tokens: { increment: delta.aiTutorMonthlyTokens },
          },
        });
      }
    }

    // 6. DSA submit access changes are handled by plan check, no quota to grant

    this.logger.info('Successfully granted all prorated entitlements', {
      userId: `user-${userId.slice(0, 8)}...`,
      fromPlan,
      toPlan,
    });
  }

  /**
   * Notify user of plan change via WebSocket
   */
  async notifyPlanChange(userId: string): Promise<void> {
    try {
      const planData = await getCachedPlanData(userId);
      broadcastPlanUpdate(userId, {
        plan: planData.plan,
        entitlements: planData.entitlements,
        wallet: planData.wallet,
        usage: planData.usage,
      });
    } catch (err) {
      this.logger.error('Failed to broadcast plan update', {
        userId: `user-${userId.slice(0, 8)}...`,
        error: err,
      });
    }
  }

  /**
   * Complete upgrade flow: update subscription + grant prorated entitlements
   */
  async applyUpgradeWithProratedEntitlements(
    userId: string,
    subscriptionId: string,
    fromPlan: PlanKey,
    toPlan: PlanKey,
    client: Prisma.TransactionClient
  ): Promise<void> {
    // Grant prorated entitlements
    await this.grantUpgradeEntitlements(userId, fromPlan, toPlan, subscriptionId, client);

    // Invalidate cache
    await invalidateUserPlanCache(userId);

    // Notify via WebSocket
    await this.notifyPlanChange(userId);

    this.logger.info('Completed upgrade with prorated entitlements', {
      userId: `user-${userId.slice(0, 8)}...`,
      subscriptionId,
      fromPlan,
      toPlan,
    });
  }
}
