import { PrismaClient } from '@interviewforge/db';
import { AuditLogger } from '../audit-logger.js';
import { LedgerService } from '../ledger/ledger-service.js';
import { StateManager } from '../state-manager.js';

export class BankReversalHandler {
  private readonly prisma: PrismaClient;
  private readonly stateManager: StateManager;
  private readonly ledgerService: LedgerService;
  private readonly auditLogger: AuditLogger;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.stateManager = new StateManager(prisma);
    this.ledgerService = new LedgerService(prisma);
    this.auditLogger = new AuditLogger(prisma);
  }

  async handleCapturedPaymentFailure(args: {
    paymentId: string;
    amount: number;
    reason: string;
    metadata?: Record<string, unknown>;
  }): Promise<boolean> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: args.paymentId },
      select: {
        id: true,
        status: true,
        amount: true,
        paymentCompletedUtc: true,
        updatedAt: true,
        userId: true,
      },
    });

    if (!payment || payment.status !== 'captured') {
      return false;
    }

    await this.stateManager.transitionState(payment.id, 'bank_reversed', {
      reason: 'bank_reversal_detected',
      source: 'webhook',
      metadata: args.metadata || {},
    });

    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        bankReversalDetected: true,
        bankReversalDate: new Date(),
        bankReversalReason: args.reason,
      },
    });

    const alreadyPosted = await this.ledgerService.hasReference('payment_refunded', payment.id);
    if (!alreadyPosted) {
      await this.ledgerService.recordPaymentRefunded(
        payment.id,
        args.amount || payment.amount,
        args.reason
      );
    }

    await this.auditLogger.logPaymentEvent({
      type: 'BANK_REVERSAL_DETECTED',
      paymentId: payment.id,
      userId: payment.userId,
      data: {
        reason: args.reason,
        amount: args.amount,
        ...args.metadata,
      },
    });

    return true;
  }

  async handleRefundCreated(args: {
    paymentId: string;
    amount: number;
    reason: string;
    metadata?: Record<string, unknown>;
  }): Promise<boolean> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: args.paymentId },
      select: {
        id: true,
        status: true,
        amount: true,
        userId: true,
      },
    });

    if (!payment) {
      return false;
    }

    if (payment.status !== 'refunded') {
      await this.stateManager.transitionState(payment.id, 'refunded', {
        reason: 'refund_created',
        source: 'webhook',
        metadata: args.metadata || {},
      });
    }

    const alreadyPosted = await this.ledgerService.hasReference('payment_refunded', payment.id);
    if (!alreadyPosted) {
      await this.ledgerService.recordPaymentRefunded(
        payment.id,
        args.amount || payment.amount,
        args.reason
      );
    }

    await this.auditLogger.logPaymentEvent({
      type: 'PAYMENT_REFUND_RECORDED',
      paymentId: payment.id,
      userId: payment.userId,
      data: {
        reason: args.reason,
        amount: args.amount,
        ...args.metadata,
      },
    });

    return true;
  }
}
