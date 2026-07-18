import { PrismaClient } from '@interviewforge/db';
import { v4 as uuidv4 } from 'uuid';
import { StateManager } from '../state-manager.js';

export class PartialPaymentManager {
  private readonly prisma: PrismaClient;
  private readonly stateManager: StateManager;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.stateManager = new StateManager(prisma);
  }

  async createRemainingPayment(parentPaymentId: string, remainingAmount: number, tx?: any) {
    const client = tx || this.prisma;

    const parentPayment = await client.payment.findUnique({
      where: { id: parentPaymentId },
    });

    if (!parentPayment) {
      throw new Error('Parent payment not found');
    }

    if (remainingAmount <= 0) {
      throw new Error('Remaining amount must be greater than zero');
    }

    const totalAmountDue = parentPayment.totalAmountDue || parentPayment.amount;
    const nextSequence = (parentPayment.partialPaymentSequence || 0) + 1;

    return client.payment.create({
      data: {
        userId: parentPayment.userId,
        amount: remainingAmount,
        currency: parentPayment.currency,
        status: 'created',
        kind: parentPayment.kind,
        receiptId: `partial-${parentPayment.userId.slice(0, 8)}-${Date.now()}-${uuidv4().slice(0, 8)}`,
        orderExpiry: new Date(Date.now() + 15 * 60 * 1000),
        totalAmountDue,
        amountPaid: 0,
        remainingAmount,
        parentPaymentId: parentPayment.id,
        partialPaymentSequence: nextSequence,
        isPartialPayment: true,
        metadata: {
          ...(parentPayment.metadata as Record<string, unknown>),
          partialParentPaymentId: parentPayment.id,
          partialSequence: nextSequence,
        },
      },
    });
  }

  async handlePartialCapture(paymentId: string, capturedAmount: number) {
    if (capturedAmount <= 0) {
      throw new Error('Captured amount must be greater than zero');
    }

    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({ where: { id: paymentId } });
      if (!payment) {
        throw new Error('Payment not found');
      }

      if (capturedAmount >= payment.amount) {
        await this.stateManager.transitionState(
          payment.id,
          'captured',
          {
            reason: 'full_capture',
            source: 'api',
            metadata: { capturedAmount },
          },
          tx
        );

        await tx.payment.update({
          where: { id: payment.id },
          data: {
            amountPaid: payment.amount,
            remainingAmount: 0,
            paymentCompletedUtc: new Date(),
          },
        });

        return {
          paymentId: payment.id,
          capturedAmount,
          remainingAmount: 0,
          childPaymentId: null,
        };
      }

      const remainingAmount = payment.amount - capturedAmount;

      await this.stateManager.transitionState(
        payment.id,
        'captured',
        {
          reason: 'partial_capture',
          source: 'api',
          metadata: {
            capturedAmount,
            remainingAmount,
          },
        },
        tx
      );

      await tx.payment.update({
        where: { id: payment.id },
        data: {
          amount: capturedAmount,
          amountPaid: capturedAmount,
          remainingAmount: 0,
          paymentCompletedUtc: new Date(),
          isPartialPayment: true,
        },
      });

      const childPayment = await this.createRemainingPayment(payment.id, remainingAmount, tx);

      return {
        paymentId: payment.id,
        capturedAmount,
        remainingAmount,
        childPaymentId: childPayment.id,
      };
    });
  }

  async getPaymentChain(paymentId: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) {
      return null;
    }

    const rootPaymentId = payment.parentPaymentId || payment.id;

    const root = await (this.prisma.payment as any).findUnique({
      where: { id: rootPaymentId },
      include: {
        childPayments: {
          orderBy: [{ partialPaymentSequence: 'asc' }, { createdAt: 'asc' }],
        },
      },
    });

    return root;
  }
}
  
