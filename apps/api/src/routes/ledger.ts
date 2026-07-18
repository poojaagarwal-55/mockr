import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { checkRateLimit } from '../lib/rate-limiter.js';
import { ChartOfAccountsManager } from '../services/payment/ledger/chart-of-accounts-manager.js';
import { LedgerService } from '../services/payment/ledger/ledger-service.js';
import { FinancialReconciliationService } from '../services/payment/ledger/financial-reconciliation-service.js';

const accountsQuerySchema = z.object({
  type: z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']).optional(),
  includeInactive: z.union([z.boolean(), z.string()]).optional(),
});

const accountCodeParamsSchema = z.object({
  code: z.string().min(1),
});

const reconciliationParamsSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
});

export default async function ledgerRoutes(fastify: FastifyInstance) {
  const chartOfAccounts = new ChartOfAccountsManager(prisma);
  const ledgerService = new LedgerService(prisma);
  const reconciliationService = new FinancialReconciliationService(prisma);

  await chartOfAccounts.initializeDefaults();

  fastify.addHook('preHandler', fastify.authenticate);

  fastify.get('/ledger/accounts', async (request, reply) => {
    const rl = checkRateLimit(`ledger:accounts:${request.user!.id}`, 60, 3_600_000);
    if (!rl.allowed) {
      return reply.status(429).send({ error: 'Too Many Requests' });
    }

    const parsed = accountsQuerySchema.safeParse(request.query || {});
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const includeInactive =
      parsed.data.includeInactive === true || parsed.data.includeInactive === 'true';

    const accounts = await chartOfAccounts.listAccounts(parsed.data.type, includeInactive);

    return reply.send({
      success: true,
      data: accounts,
      timestamp: new Date().toISOString(),
    });
  });

  fastify.get('/ledger/accounts/:code/balance', async (request, reply) => {
    const rl = checkRateLimit(`ledger:account-balance:${request.user!.id}`, 120, 3_600_000);
    if (!rl.allowed) {
      return reply.status(429).send({ error: 'Too Many Requests' });
    }

    const parsed = accountCodeParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    try {
      const balance = await chartOfAccounts.getAccountBalance(parsed.data.code);
      return reply.send({
        success: true,
        data: balance,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return reply.status(404).send({
        success: false,
        error: {
          code: 'ACCOUNT_NOT_FOUND',
          message: error instanceof Error ? error.message : 'Account not found',
        },
        timestamp: new Date().toISOString(),
      });
    }
  });

  fastify.get('/ledger/balance-sheet', async (request, reply) => {
    const rl = checkRateLimit(`ledger:balance-sheet:${request.user!.id}`, 60, 3_600_000);
    if (!rl.allowed) {
      return reply.status(429).send({ error: 'Too Many Requests' });
    }

    const [assets, liabilities, equity] = await Promise.all([
      chartOfAccounts.listAccounts('ASSET'),
      chartOfAccounts.listAccounts('LIABILITY'),
      chartOfAccounts.listAccounts('EQUITY'),
    ]);

    const [assetBalances, liabilityBalances, equityBalances] = await Promise.all([
      Promise.all(assets.map((account) => chartOfAccounts.getAccountBalance(account.code))),
      Promise.all(liabilities.map((account) => chartOfAccounts.getAccountBalance(account.code))),
      Promise.all(equity.map((account) => chartOfAccounts.getAccountBalance(account.code))),
    ]);

    const totalAssets = assetBalances.reduce((sum, row) => sum + row.balance, 0);
    const totalLiabilities = liabilityBalances.reduce((sum, row) => sum + row.balance, 0);
    const totalEquity = equityBalances.reduce((sum, row) => sum + row.balance, 0);

    return reply.send({
      success: true,
      data: {
        assets: assetBalances,
        liabilities: liabilityBalances,
        equity: equityBalances,
        totals: {
          assets: totalAssets,
          liabilities: totalLiabilities,
          equity: totalEquity,
          liabilitiesPlusEquity: totalLiabilities + totalEquity,
        },
      },
      timestamp: new Date().toISOString(),
    });
  });

  fastify.get('/ledger/income-statement', async (_request, reply) => {
    const request = _request;
    const rl = checkRateLimit(`ledger:income-statement:${request.user!.id}`, 60, 3_600_000);
    if (!rl.allowed) {
      return reply.status(429).send({ error: 'Too Many Requests' });
    }

    const [revenueAccounts, expenseAccounts] = await Promise.all([
      chartOfAccounts.listAccounts('REVENUE'),
      chartOfAccounts.listAccounts('EXPENSE'),
    ]);

    const [revenues, expenses] = await Promise.all([
      Promise.all(revenueAccounts.map((account) => chartOfAccounts.getAccountBalance(account.code))),
      Promise.all(expenseAccounts.map((account) => chartOfAccounts.getAccountBalance(account.code))),
    ]);

    const totalRevenue = revenues.reduce((sum, row) => sum + row.balance, 0);
    const totalExpense = expenses.reduce((sum, row) => sum + row.balance, 0);

    return reply.send({
      success: true,
      data: {
        revenues,
        expenses,
        totals: {
          revenue: totalRevenue,
          expense: totalExpense,
          netIncome: totalRevenue - totalExpense,
        },
      },
      timestamp: new Date().toISOString(),
    });
  });

  fastify.get('/ledger/reconciliation/:date', async (request, reply) => {
    const rl = checkRateLimit(`ledger:reconciliation:${request.user!.id}`, 60, 3_600_000);
    if (!rl.allowed) {
      return reply.status(429).send({ error: 'Too Many Requests' });
    }

    const parsed = reconciliationParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Validation Error',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const date = new Date(`${parsed.data.date}T00:00:00.000Z`);
    const result = await reconciliationService.reconcileDate(date);

    return reply.send({
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    });
  });

  fastify.post('/ledger/validate', async (_request, reply) => {
    const request = _request;
    const rl = checkRateLimit(`ledger:validate:${request.user!.id}`, 30, 3_600_000);
    if (!rl.allowed) {
      return reply.status(429).send({ error: 'Too Many Requests' });
    }

    const integrity = await ledgerService.validateIntegrity();

    return reply.send({
      success: integrity.valid,
      data: integrity,
      timestamp: new Date().toISOString(),
    });
  });
}
