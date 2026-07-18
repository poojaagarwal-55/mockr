import { PrismaClient } from '@interviewforge/db';

export type AccountBalance = {
  accountId: string;
  code: string;
  name: string;
  type: string;
  totalDebits: number;
  totalCredits: number;
  balance: number;
  normalSide: 'debit' | 'credit';
};

const DEFAULT_ACCOUNTS: Array<{
  code: string;
  name: string;
  type: string;
  description: string;
}> = [
  { code: '1000', name: 'Cash in Bank', type: 'ASSET', description: 'Settled funds received from Razorpay' },
  { code: '1100', name: 'Accounts Receivable - Razorpay', type: 'ASSET', description: 'Captured but unsettled payment balances' },
  { code: '2000', name: 'Payment Gateway Payable', type: 'LIABILITY', description: 'Temporary liability for gateway adjustments' },
  { code: '4000', name: 'Subscription Revenue', type: 'REVENUE', description: 'Revenue from subscription purchases' },
  { code: '4100', name: 'Interview Minutes Revenue', type: 'REVENUE', description: 'Revenue from interview minute pack purchases' },
  { code: '5000', name: 'Payment Gateway Fees', type: 'EXPENSE', description: 'Processing fees charged by payment gateway' },
  { code: '5100', name: 'Refunds and Reversals', type: 'EXPENSE', description: 'Refund and chargeback expenses' },
];

export class ChartOfAccountsManager {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async initializeDefaults(): Promise<void> {
    for (const account of DEFAULT_ACCOUNTS) {
      await this.prisma.financialAccount.upsert({
        where: { code: account.code },
        update: {
          name: account.name,
          type: account.type,
          status: 'ACTIVE',
        },
        create: {
          code: account.code,
          name: account.name,
          type: account.type,
          status: 'ACTIVE',
        },
      });
    }
  }

  async listAccounts(type?: string, includeInactive: boolean = false) {
    return this.prisma.financialAccount.findMany({
      where: {
        type: type || undefined,
        status: includeInactive ? undefined : 'ACTIVE',
      },
      orderBy: [{ type: 'asc' }, { code: 'asc' }],
    });
  }

  async getAccountByCode(code: string) {
    return this.prisma.financialAccount.findUnique({ where: { code } });
  }

  async getAccountBalance(code: string): Promise<AccountBalance> {
    const account = await this.prisma.financialAccount.findUnique({ where: { code } });
    if (!account) {
      throw new Error(`Account not found for code ${code}`);
    }

    const [debitAgg, creditAgg] = await Promise.all([
      this.prisma.ledgerEntry.aggregate({
        where: { debitAccountId: account.id },
        _sum: { amount: true },
      }),
      this.prisma.ledgerEntry.aggregate({
        where: { creditAccountId: account.id },
        _sum: { amount: true },
      }),
    ]);

    const totalDebits = debitAgg._sum.amount || 0;
    const totalCredits = creditAgg._sum.amount || 0;
    const normalSide: 'debit' | 'credit' =
      account.type === 'ASSET' || account.type === 'EXPENSE' ? 'debit' : 'credit';

    const balance = normalSide === 'debit' ? totalDebits - totalCredits : totalCredits - totalDebits;

    return {
      accountId: account.id,
      code: account.code,
      name: account.name,
      type: account.type,
      totalDebits,
      totalCredits,
      balance,
      normalSide,
    };
  }
}
