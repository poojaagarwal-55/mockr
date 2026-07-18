import { PrismaClient } from '@interviewforge/db';

export type FraudAssessment = {
  score: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  flags: string[];
  shouldBlock: boolean;
};

export type FraudInput = {
  userId: string;
  amount: number;
  currency?: string;
  sessionId?: string;
  clientIp?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
};

export class FraudDetector {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async assessPaymentRequest(input: FraudInput): Promise<FraudAssessment> {
    const flags: string[] = [];
    let score = 0;

    if (input.amount <= 0) {
      flags.push('invalid_amount_non_positive');
      score += 1;
    }

    if (input.amount > 2_500_000) {
      flags.push('unusually_high_amount');
      score += 0.35;
    }

    if (!input.sessionId) {
      flags.push('missing_session_id');
      score += 0.1;
    }

    if (!input.userAgent) {
      flags.push('missing_user_agent');
      score += 0.08;
    }

    if (!input.clientIp) {
      flags.push('missing_client_ip');
      score += 0.08;
    }

    const [recentFailedAttempts, rapidPaymentCreations] = await Promise.all([
      this.prisma.userPaymentAttempt.count({
        where: {
          userId: input.userId,
          success: false,
          createdAt: {
            gte: new Date(Date.now() - 60 * 60 * 1000),
          },
        },
      }),
      this.prisma.payment.count({
        where: {
          userId: input.userId,
          createdAt: {
            gte: new Date(Date.now() - 10 * 60 * 1000),
          },
        },
      }),
    ]);

    if (recentFailedAttempts >= 3) {
      flags.push('multiple_recent_failed_attempts');
      score += Math.min(0.4, recentFailedAttempts * 0.07);
    }

    if (rapidPaymentCreations >= 5) {
      flags.push('rapid_payment_creation_pattern');
      score += 0.25;
    }

    const metadata = input.metadata || {};
    if (metadata['automationHint'] === true || metadata['headless'] === true) {
      flags.push('automation_signal_detected');
      score += 0.2;
    }

    score = Math.max(0, Math.min(1, score));

    const riskLevel: FraudAssessment['riskLevel'] =
      score >= 0.85 ? 'critical' : score >= 0.65 ? 'high' : score >= 0.35 ? 'medium' : 'low';

    return {
      score,
      riskLevel,
      flags,
      shouldBlock: score >= 0.9,
    };
  }

  async attachFraudMetadata(paymentId: string, assessment: FraudAssessment): Promise<void> {
    await this.prisma.payment.update({
      where: { id: paymentId },
      data: {
        metadata: {
          fraudAssessment: {
            score: assessment.score,
            riskLevel: assessment.riskLevel,
            flags: assessment.flags,
            shouldBlock: assessment.shouldBlock,
            assessedAt: new Date().toISOString(),
          },
        },
      },
    });
  }
}
