import { PaymentKind, PrismaClient } from '@interviewforge/db';

export type LedgerPostingLine = {
  debitAccountCode: string;
  creditAccountCode: string;
  amount: number;
  description?: string;
  metadata?: Record<string, unknown>;
};

export type PostLedgerTransactionInput = {
  paymentId?: string;
  referenceType: string;
  referenceId?: string;
  description: string;
  currency?: string;
  metadata?: Record<string, unknown>;
  lines: LedgerPostingLine[];
};

export class LedgerService {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async postTransaction(input: PostLedgerTransactionInput) {
    return this.postTransactionWithClient(input, this.prisma);
  }

  async hasReference(
    referenceType: string,
    referenceId: string,
    client: any = this.prisma
  ): Promise<boolean> {
    const row = await client.ledgerTransaction.findFirst({
      where: {
        referenceType,
        referenceId,
      },
      select: { id: true },
    });

    return Boolean(row?.id);
  }

  async postIfMissing(
    referenceType: string,
    referenceId: string,
    create: () => Promise<any>
  ): Promise<boolean> {
    const exists = await this.hasReference(referenceType, referenceId);
    if (exists) {
      return false;
    }

    await create();
    return true;
  }

  async postTransactionWithClient(input: PostLedgerTransactionInput, client: any) {
    if (!input.lines.length) {
      throw new Error('At least one ledger line is required');
    }

    const invalidLine = input.lines.find((line) =>
      !line.debitAccountCode || !line.creditAccountCode || !Number.isInteger(line.amount) || line.amount <= 0
    );

    if (invalidLine) {
      throw new Error('All ledger lines must have debit account, credit account, and positive integer amount');
    }

    const totalDebit = input.lines.reduce((sum, line) => sum + line.amount, 0);
    const totalCredit = input.lines.reduce((sum, line) => sum + line.amount, 0);

    if (totalDebit !== totalCredit) {
      throw new Error('Double-entry validation failed: debits must equal credits');
    }

    const allCodes = Array.from(
      new Set(input.lines.flatMap((line) => [line.debitAccountCode, line.creditAccountCode]))
    );

    const accounts = await client.financialAccount.findMany({
      where: {
        code: { in: allCodes },
        status: 'ACTIVE',
      },
      select: { id: true, code: true },
    });

    const accountByCode = new Map(accounts.map((account) => [account.code, account.id]));

    for (const code of allCodes) {
      if (!accountByCode.has(code)) {
        throw new Error(`Active ledger account not found for code ${code}`);
      }
    }

    return client.ledgerTransaction.create({
      data: {
        paymentId: input.paymentId,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        description: input.description,
        currency: input.currency || 'INR',
        totalDebit,
        totalCredit,
        metadata: (input.metadata || {}) as any,
        ledger_entries: {
          create: input.lines.map((line) => ({
            debitAccountId: accountByCode.get(line.debitAccountCode)!,
            creditAccountId: accountByCode.get(line.creditAccountCode)!,
            amount: line.amount,
            description: line.description,
            metadata: (line.metadata || {}) as any,
          })),
        },
      },
      include: {
        ledger_entries: true,
      },
    });
  }

  async recordPaymentCaptured(paymentId: string, amount: number, kind: PaymentKind, client: any = this.prisma) {
    const revenueCode = kind === 'SUBSCRIPTION' ? '4000' : '4100';

    return this.postTransactionWithClient({
      paymentId,
      referenceType: 'payment_captured',
      referenceId: paymentId,
      description: `Payment captured (${kind})`,
      lines: [
        {
          debitAccountCode: '1100',
          creditAccountCode: revenueCode,
          amount,
          description: 'Recognize receivable and revenue',
        },
      ],
    }, client);
  }

  async recordPaymentCapturedIfMissing(
    paymentId: string,
    amount: number,
    kind: PaymentKind,
    client: any = this.prisma
  ): Promise<boolean> {
    const exists = await this.hasReference('payment_captured', paymentId, client);
    if (exists) {
      return false;
    }

    await this.recordPaymentCaptured(paymentId, amount, kind, client);
    return true;
  }

  async recordPaymentSettled(paymentId: string, amount: number, settlementUtr?: string, client: any = this.prisma) {
    return this.postTransactionWithClient({
      paymentId,
      referenceType: 'payment_settled',
      referenceId: paymentId,
      description: 'Payment settled to bank',
      metadata: settlementUtr ? { settlementUtr } : undefined,
      lines: [
        {
          debitAccountCode: '1000',
          creditAccountCode: '1100',
          amount,
          description: 'Move receivable into cash',
        },
      ],
    }, client);
  }

  async recordPaymentSettledIfMissing(
    paymentId: string,
    amount: number,
    settlementUtr?: string,
    client: any = this.prisma
  ): Promise<boolean> {
    const exists = await this.hasReference('payment_settled', paymentId, client);
    if (exists) {
      return false;
    }

    await this.recordPaymentSettled(paymentId, amount, settlementUtr, client);
    return true;
  }

  async recordPaymentRefunded(paymentId: string, amount: number, reason?: string, client: any = this.prisma) {
    return this.postTransactionWithClient({
      paymentId,
      referenceType: 'payment_refunded',
      referenceId: paymentId,
      description: 'Payment refunded',
      metadata: reason ? { reason } : undefined,
      lines: [
        {
          debitAccountCode: '5100',
          creditAccountCode: '1000',
          amount,
          description: 'Record refund expense and reduce cash',
        },
      ],
    }, client);
  }

  async recordPaymentRefundedIfMissing(
    paymentId: string,
    amount: number,
    reason?: string,
    client: any = this.prisma
  ): Promise<boolean> {
    const exists = await this.hasReference('payment_refunded', paymentId, client);
    if (exists) {
      return false;
    }

    await this.recordPaymentRefunded(paymentId, amount, reason, client);
    return true;
  }

  async validateIntegrity(): Promise<{
    valid: boolean;
    issues: string[];
    transactionsChecked: number;
  }> {
    const issues: string[] = [];

    const transactions = await this.prisma.ledgerTransaction.findMany({
      include: { ledger_entries: true },
      orderBy: { postedAt: 'asc' },
    });

    for (const transaction of transactions) {
      const lineDebit = transaction.ledger_entries.reduce((sum, line) => sum + line.amount, 0);
      const lineCredit = transaction.ledger_entries.reduce((sum, line) => sum + line.amount, 0);

      if (lineDebit !== lineCredit) {
        issues.push(`Transaction ${transaction.id} failed line-level debit/credit parity`);
      }

      if (transaction.totalDebit !== transaction.totalCredit) {
        issues.push(`Transaction ${transaction.id} failed header-level debit/credit parity`);
      }

      if (transaction.totalDebit !== lineDebit || transaction.totalCredit !== lineCredit) {
        issues.push(`Transaction ${transaction.id} header totals mismatch with line totals`);
      }
    }

    return {
      valid: issues.length === 0,
      issues,
      transactionsChecked: transactions.length,
    };
  }
}
