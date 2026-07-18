import Razorpay from 'razorpay';
import { PrismaClient } from '@interviewforge/db';

export type BusinessReconciliationReport = {
  jobId: string;
  date: string;
  local: {
    capturedAmount: number;
    refundedAmount: number;
    paymentCount: number;
  };
  razorpay: {
    capturedAmount: number;
    refundedAmount: number;
    paymentCount: number;
  } | null;
  settlement: {
    settledAmount: number;
    settledCount: number;
  };
  discrepancies: {
    capturedAmountDiff: number;
    refundedAmountDiff: number;
    paymentCountDiff: number;
  };
};

export class BusinessReconciliationService {
  private readonly prisma: PrismaClient;
  private razorpay: Razorpay | null = null;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
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

  private getDateRange(date: Date): { start: Date; end: Date } {
    const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
    const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
    return { start, end };
  }

  async runDailyReconciliation(date: Date = new Date(Date.now() - 24 * 60 * 60 * 1000)): Promise<BusinessReconciliationReport> {
    const { start, end } = this.getDateRange(date);

    const job = await this.prisma.paymentReconciliationJob.create({
      data: {
        jobType: 'business',
        status: 'running',
        startedAt: new Date(),
        dateRange: {
          from: start.toISOString(),
          to: end.toISOString(),
        },
      },
    });

    const [capturedAgg, refundedAgg, paymentCount, settledAgg, settledCount] = await Promise.all([
      this.prisma.payment.aggregate({
        where: {
          paymentCompletedUtc: { gte: start, lte: end },
          status: 'captured',
        },
        _sum: { amount: true },
      }),
      this.prisma.payment.aggregate({
        where: {
          updatedAt: { gte: start, lte: end },
          status: 'refunded',
        },
        _sum: { amount: true },
      }),
      this.prisma.payment.count({
        where: {
          createdAt: { gte: start, lte: end },
        },
      }),
      this.prisma.payment.aggregate({
        where: {
          settlementDate: { gte: start, lte: end },
          settlementStatus: 'settled',
        },
        _sum: { settlementAmount: true },
      }),
      this.prisma.payment.count({
        where: {
          settlementDate: { gte: start, lte: end },
          settlementStatus: 'settled',
        },
      }),
    ]);

    const local = {
      capturedAmount: capturedAgg._sum.amount || 0,
      refundedAmount: refundedAgg._sum.amount || 0,
      paymentCount,
    };

    const settlement = {
      settledAmount: settledAgg._sum.settlementAmount || 0,
      settledCount,
    };

    let razorpay: BusinessReconciliationReport['razorpay'] = null;
    const client = this.getRazorpayClient();

    if (client) {
      const from = Math.floor(start.getTime() / 1000);
      const to = Math.floor(end.getTime() / 1000);

      const [paymentsResp, refundsResp] = await Promise.all([
        client.payments.all({ from, to, count: 100 } as any),
        client.refunds.all({ from, to, count: 100 } as any),
      ]);

      const payments = Array.isArray((paymentsResp as any)?.items) ? (paymentsResp as any).items : [];
      const refunds = Array.isArray((refundsResp as any)?.items) ? (refundsResp as any).items : [];

      razorpay = {
        capturedAmount: payments
          .filter((payment: any) => String(payment.status).toLowerCase() === 'captured')
          .reduce((sum: number, payment: any) => sum + (payment.amount || 0), 0),
        refundedAmount: refunds.reduce((sum: number, refund: any) => sum + (refund.amount || 0), 0),
        paymentCount: payments.length,
      };
    }

    const discrepancies = {
      capturedAmountDiff: local.capturedAmount - (razorpay?.capturedAmount || 0),
      refundedAmountDiff: local.refundedAmount - (razorpay?.refundedAmount || 0),
      paymentCountDiff: local.paymentCount - (razorpay?.paymentCount || 0),
    };

    const report: BusinessReconciliationReport = {
      jobId: job.id,
      date: start.toISOString().slice(0, 10),
      local,
      razorpay,
      settlement,
      discrepancies,
    };

    await this.prisma.paymentReconciliationJob.update({
      where: { id: job.id },
      data: {
        status: 'completed',
        completedAt: new Date(),
        paymentsChecked: local.paymentCount,
        discrepanciesFound:
          Number(discrepancies.capturedAmountDiff !== 0) +
          Number(discrepancies.refundedAmountDiff !== 0) +
          Number(discrepancies.paymentCountDiff !== 0),
        results: report,
        discrepancies,
      },
    });

    return report;
  }
}
