// User Abuse Protection - Edge Case 10 Implementation
// Tracks failed attempts and enforces progressive cooldowns.

import { PrismaClient } from '@interviewforge/db';
import { paymentConfig } from '../config.js';
import { AbuseCheckResult } from '../types.js';

export class UserAbuseProtection {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async checkUserAbuse(userId: string): Promise<AbuseCheckResult> {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [cooldown, hourlyFailures, dailyFailures] = await Promise.all([
      this.prisma.userPaymentCooldown.findUnique({ where: { userId: userId } }),
      this.prisma.userPaymentAttempt.count({
        where: {
          userId: userId,
          success: false,
          createdAt: { gte: oneHourAgo },
        },
      }),
      this.prisma.userPaymentAttempt.count({
        where: {
          userId: userId,
          success: false,
          createdAt: { gte: oneDayAgo },
        },
      }),
    ]);

    if (cooldown && cooldown.cooldownUntil > now) {
      return {
        allowed: false,
        reason: cooldown.reason,
        cooldownUntil: cooldown.cooldownUntil,
        attempts: {
          hourly: hourlyFailures,
          daily: dailyFailures,
        },
      };
    }

    const exceedsHourly =
      hourlyFailures >= paymentConfig.abuseProtection.maxFailedAttemptsPerHour;
    const exceedsDaily =
      dailyFailures >= paymentConfig.abuseProtection.maxFailedAttemptsPerDay;

    if (exceedsHourly || exceedsDaily) {
      const reason = exceedsDaily
        ? 'daily_failed_attempt_limit_exceeded'
        : 'hourly_failed_attempt_limit_exceeded';
      const cooldownUntil = await this.applyCooldown(userId, reason);

      return {
        allowed: false,
        reason,
        cooldownUntil,
        attempts: {
          hourly: hourlyFailures,
          daily: dailyFailures,
        },
      };
    }

    return {
      allowed: true,
      attempts: {
        hourly: hourlyFailures,
        daily: dailyFailures,
      },
    };
  }

  async recordFailedAttempt(
    userId: string,
    details: {
      type: string;
      paymentId?: string;
      reason?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<void> {
    await this.prisma.userPaymentAttempt.create({
      data: {
        userId: userId,
        attemptType: details.type,
        success: false,
        failureReason: details.reason || 'unknown_failure',
        metadata: {
          paymentId: details.paymentId,
          ...details.metadata,
        },
        suspiciousPattern: details.reason === 'invalid_signature',
      },
    });

    await this.checkUserAbuse(userId);
  }

  async recordSuccessfulAttempt(
    userId: string,
    attemptType: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    await this.prisma.userPaymentAttempt.create({
      data: {
        userId: userId,
        attemptType: attemptType,
        success: true,
        metadata: (metadata || {}) as any,
      },
    });
  }

  private async applyCooldown(userId: string, reason: string): Promise<Date> {
    const existing = await this.prisma.userPaymentCooldown.findUnique({
      where: { userId: userId },
    });

    const maxLevel = paymentConfig.abuseProtection.cooldownPeriods.length - 1;
    const nextLevel = existing ? Math.min(existing.cooldownLevel + 1, maxLevel) : 0;
    const cooldownSeconds = paymentConfig.abuseProtection.cooldownPeriods[nextLevel] || 300;
    const cooldownUntil = new Date(Date.now() + cooldownSeconds * 1000);

    await this.prisma.userPaymentCooldown.upsert({
      where: { userId: userId },
      update: {
        cooldownUntil: cooldownUntil,
        reason,
        cooldownLevel: nextLevel,
        attemptCount: (existing?.attemptCount || 0) + 1,
      },
      create: {
        userId: userId,
        cooldownUntil: cooldownUntil,
        reason,
        cooldownLevel: nextLevel,
        attemptCount: 1,
      },
    });

    return cooldownUntil;
  }
}
