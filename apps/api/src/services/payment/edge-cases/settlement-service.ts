import Razorpay from 'razorpay';
import { PrismaClient } from '@interviewforge/db';
import { PAYMENT_CONSTANTS } from '../config.js';
import { LedgerService } from '../ledger/ledger-service.js';

type SettlementLike = {
  id?: string;
  amount?: number;
  status?: string;
  utr?: string;
  created_at?: number;
  notes?: Record<string, unknown>;
  payment_id?: string;
  fees?: number;
};

export type SettlementSyncResult = {
  enabled: boolean;
  totalFetched: number;
  linkedPayments: number;
  updatedPayments: number;
  mismatchesFound: number;
  skipped: number;
};

export class SettlementService {
  private readonly prisma: PrismaClient;
  private readonly ledgerService: LedgerService;
  private razorpay: Razorpay | null = null;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.ledgerService = new LedgerService(prisma);
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

  async recordSettlementForPayment(args: {
    paymentId: string;
    settlementAmount: number;
    settlementDate?: Date;
    settlementUtr?: string;
    settlementBatchId?: string;
    settlementFees?: number;
  }): Promise<{ updated: boolean; mismatch: boolean }> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: args.paymentId },
      select: {
        id: true,
        amount: true,
        status: true,
        settlementStatus: true,
        settlementAmount: true,
      },
    });

    if (!payment) {
      return { updated: false, mismatch: false };
    }

    const mismatch = payment.amount !== args.settlementAmount;

    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        settlementStatus: PAYMENT_CONSTANTS.SETTLEMENT_STATUS.SETTLED,
        settlementAmount: args.settlementAmount,
        settlementDate: args.settlementDate || new Date(),
        settlementUtr: args.settlementUtr,
        settlementBatchId: args.settlementBatchId,
        settlementFees: args.settlementFees,
      },
    });

    const alreadyPosted = await this.ledgerService.hasReference(
      'payment_settled',
      payment.id
    );

    if (!alreadyPosted) {
      await this.ledgerService.recordPaymentSettled(
        payment.id,
        args.settlementAmount,
        args.settlementUtr
      );
    }

    return { updated: true, mismatch };
  }

  async syncRecentSettlements(hoursBack: number = 48): Promise<SettlementSyncResult> {
    const client = this.getRazorpayClient();
    if (!client) {
      return {
        enabled: false,
        totalFetched: 0,
        linkedPayments: 0,
        updatedPayments: 0,
        mismatchesFound: 0,
        skipped: 0,
      };
    }

    const from = Math.floor((Date.now() - hoursBack * 60 * 60 * 1000) / 1000);
    const to = Math.floor(Date.now() / 1000);

    const response = await client.settlements.all({
      from,
      to,
      count: 100,
    } as any);

    const items: SettlementLike[] = Array.isArray((response as any)?.items)
      ? ((response as any).items as SettlementLike[])
      : [];

    let linkedPayments = 0;
    let updatedPayments = 0;
    let mismatchesFound = 0;
    let skipped = 0;

    for (const item of items) {
      const linkedRazorpayPaymentId =
        (typeof item.payment_id === 'string' && item.payment_id) ||
        (typeof item.notes?.payment_id === 'string' ? (item.notes.payment_id as string) : null);

      if (!linkedRazorpayPaymentId) {
        skipped += 1;
        continue;
      }

      const payment = await this.prisma.payment.findFirst({
        where: { razorpayPaymentId: linkedRazorpayPaymentId },
        select: { id: true },
      });

      if (!payment) {
        skipped += 1;
        continue;
      }

      linkedPayments += 1;
      const result = await this.recordSettlementForPayment({
        paymentId: payment.id,
        settlementAmount: item.amount || 0,
        settlementDate: item.created_at ? new Date(item.created_at * 1000) : new Date(),
        settlementUtr: item.utr,
        settlementBatchId: item.id,
        settlementFees: item.fees,
      });

      if (result.updated) {
        updatedPayments += 1;
      }
      if (result.mismatch) {
        mismatchesFound += 1;
      }
    }

    return {
      enabled: true,
      totalFetched: items.length,
      linkedPayments,
      updatedPayments,
      mismatchesFound,
      skipped,
    };
  }

  async detectSettlementMismatches(daysBack: number = 7) {
    const from = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

    const payments = await this.prisma.payment.findMany({
      where: {
        createdAt: { gte: from },
        status: 'captured',
        settlementStatus: 'settled',
        settlementAmount: { not: null },
      },
      select: {
        id: true,
        amount: true,
        settlementAmount: true,
        settlementDate: true,
        settlementUtr: true,
      },
    });

    return payments
      .map((payment) => ({
        paymentId: payment.id,
        capturedAmount: payment.amount,
        settledAmount: payment.settlementAmount || 0,
        difference: payment.amount - (payment.settlementAmount || 0),
        settlementDate: payment.settlementDate,
        settlementUtr: payment.settlementUtr,
      }))
      .filter((row) => Math.abs(row.difference) > 0);
  }
}
