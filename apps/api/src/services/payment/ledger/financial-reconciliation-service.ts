import { PrismaClient } from '@interviewforge/db';

export type FinancialReconciliationResult = {
  date: string;
  paymentCapturedTotal: number;
  ledgerRevenueTotal: number;
  difference: number;
  status: 'reconciled' | 'discrepancy';
};

export class FinancialReconciliationService {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async reconcileDate(date: Date): Promise<FinancialReconciliationResult> {
    const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0));
    const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));

    const [paymentsAgg, revenueLines] = await Promise.all([
      this.prisma.payment.aggregate({
        where: {
          status: 'captured',
          paymentCompletedUtc: {
            gte: start,
            lte: end,
          },
        },
        _sum: { amount: true },
      }),
      this.prisma.ledgerEntry.findMany({
        where: {
          createdAt: {
            gte: start,
            lte: end,
          },
          financial_accounts_ledger_entries_credit_account_idTofinancial_accounts: {
            type: 'REVENUE',
          },
        },
        select: { amount: true },
      }),
    ]);

    const paymentCapturedTotal = paymentsAgg._sum.amount || 0;
    const ledgerRevenueTotal = revenueLines.reduce((sum, row) => sum + row.amount, 0);
    const difference = paymentCapturedTotal - ledgerRevenueTotal;

    return {
      date: start.toISOString().slice(0, 10),
      paymentCapturedTotal,
      ledgerRevenueTotal,
      difference,
      status: difference === 0 ? 'reconciled' : 'discrepancy',
    };
  }
}
