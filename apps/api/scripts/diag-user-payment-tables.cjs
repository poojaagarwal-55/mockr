const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const userId = process.argv[2] || "660d8bf7-d7fb-4fed-85f6-20038d73a978";

async function one(sql, params = []) {
  const rows = await prisma.$queryRawUnsafe(sql, ...params);
  return rows;
}

async function main() {
  const [userRows] = await Promise.all([
    one('select id, email, created_at, updated_at from public.users where id = $1 limit 1', [userId]),
  ]);

  const subscriptions = await one(
    `select id, status, plan::text as plan, cycle::text as cycle, created_at, updated_at, razorpay_subscription_id
     from public.subscriptions
     where user_id = $1
     order by created_at desc`,
    [userId]
  );

  const payments = await one(
    `select id, kind::text as kind, status, amount, currency, "createdAt", "updatedAt", "razorpayPaymentId", "razorpayOrderId"
     from public.payments
     where "userId" = $1
     order by "createdAt" desc`,
    [userId]
  );

  const tableChecks = {
    subscriptions: {
      userCount: Number((await one('select count(*)::int as c from public.subscriptions where user_id = $1', [userId]))[0]?.c || 0),
      totalCount: Number((await one('select count(*)::int as c from public.subscriptions'))[0]?.c || 0),
    },
    payments: {
      userCount: Number((await one('select count(*)::int as c from public.payments where "userId" = $1', [userId]))[0]?.c || 0),
      totalCount: Number((await one('select count(*)::int as c from public.payments'))[0]?.c || 0),
    },
    payment_webhook_events: {
      userCount: Number((await one(
        `select count(*)::int as c
         from public.payment_webhook_events pwe
         join public.payments p on p.id = pwe."paymentId"
         where p."userId" = $1`,
        [userId]
      ))[0]?.c || 0),
      totalCount: Number((await one('select count(*)::int as c from public.payment_webhook_events'))[0]?.c || 0),
    },
    payment_state_transitions: {
      userCount: Number((await one(
        `select count(*)::int as c
         from public.payment_state_transitions pst
         join public.payments p on p.id = pst."paymentId"
         where p."userId" = $1`,
        [userId]
      ))[0]?.c || 0),
      totalCount: Number((await one('select count(*)::int as c from public.payment_state_transitions'))[0]?.c || 0),
    },
    payment_secret_rotations: {
      userCount: null,
      totalCount: Number((await one('select count(*)::int as c from public.payment_secret_rotations'))[0]?.c || 0),
    },
    payment_reconciliation_jobs: {
      userCount: null,
      totalCount: Number((await one('select count(*)::int as c from public.payment_reconciliation_jobs'))[0]?.c || 0),
    },
    ledger_transactions: {
      userCount: Number((await one(
        `select count(*)::int as c
         from public.ledger_transactions lt
         join public.payments p on p.id = lt.payment_id
         where p."userId" = $1`,
        [userId]
      ))[0]?.c || 0),
      totalCount: Number((await one('select count(*)::int as c from public.ledger_transactions'))[0]?.c || 0),
    },
    ledger_entries: {
      userCount: Number((await one(
        `select count(*)::int as c
         from public.ledger_entries le
         join public.ledger_transactions lt on lt.id = le.transaction_id
         join public.payments p on p.id = lt.payment_id
         where p."userId" = $1`,
        [userId]
      ))[0]?.c || 0),
      totalCount: Number((await one('select count(*)::int as c from public.ledger_entries'))[0]?.c || 0),
    },
    financial_accounts: {
      userCount: null,
      totalCount: Number((await one('select count(*)::int as c from public.financial_accounts'))[0]?.c || 0),
    },
    webhook_events: {
      userCount: Number((await one(
        `select count(*)::int as c
         from public.webhook_events
         where payload::text ilike '%' || $1 || '%'`,
        [userId]
      ))[0]?.c || 0),
      totalCount: Number((await one('select count(*)::int as c from public.webhook_events'))[0]?.c || 0),
    },
    zombie_payment_records: {
      userCount: Number((await one(
        `select count(*)::int as c
         from public.zombie_payment_records z
         join public.payments p on p.id = z.payment_id
         where p."userId" = $1`,
        [userId]
      ))[0]?.c || 0),
      totalCount: Number((await one('select count(*)::int as c from public.zombie_payment_records'))[0]?.c || 0),
    },
    user_payment_attempts: {
      userCount: Number((await one('select count(*)::int as c from public.user_payment_attempts where user_id = $1', [userId]))[0]?.c || 0),
      totalCount: Number((await one('select count(*)::int as c from public.user_payment_attempts'))[0]?.c || 0),
    },
    user_payment_cooldowns: {
      userCount: Number((await one('select count(*)::int as c from public.user_payment_cooldowns where user_id = $1', [userId]))[0]?.c || 0),
      totalCount: Number((await one('select count(*)::int as c from public.user_payment_cooldowns'))[0]?.c || 0),
    },
  };

  const latestStateTransitions = await one(
    `select pst.id, pst."paymentId", pst."fromStatus", pst."toStatus", pst.source, pst.reason, pst."createdAt"
     from public.payment_state_transitions pst
     join public.payments p on p.id = pst."paymentId"
     where p."userId" = $1
     order by pst."createdAt" desc
     limit 5`,
    [userId]
  );

  const latestWebhookEvents = await one(
    `select pwe.id, pwe."eventId", pwe."eventType", pwe.processed, pwe."createdAt", pwe."paymentId"
     from public.payment_webhook_events pwe
     left join public.payments p on p.id = pwe."paymentId"
     where p."userId" = $1
     order by pwe."createdAt" desc
     limit 5`,
    [userId]
  );

  console.log(
    JSON.stringify(
      {
        userId,
        userExists: userRows.length > 0,
        user: userRows[0] || null,
        subscriptions,
        payments,
        tableChecks,
        latestStateTransitions,
        latestWebhookEvents,
      },
      null,
      2
    )
  );
}

main()
  .catch((err) => {
    console.error("diag failed", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
