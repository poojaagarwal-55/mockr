const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const payments = await prisma.payment.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: {
      id: true,
      userId: true,
      status: true,
      amount: true,
      kind: true,
      metadata: true,
      razorpayPaymentId: true,
      razorpayOrderId: true,
      createdAt: true,
    },
  });

  console.log('\n=== Recent Payments ===\n');
  payments.forEach((p, i) => {
    console.log(`Payment ${i + 1}:`);
    console.log(`  ID: ${p.id}`);
    console.log(`  User: ${p.userId}`);
    console.log(`  Status: ${p.status}`);
    console.log(`  Amount: ${p.amount}`);
    console.log(`  Kind: ${p.kind}`);
    console.log(`  Metadata: ${JSON.stringify(p.metadata)}`);
    console.log(`  Razorpay Payment ID: ${p.razorpayPaymentId || 'N/A'}`);
    console.log(`  Razorpay Order ID: ${p.razorpayOrderId}`);
    console.log(`  Created: ${p.createdAt}`);
    console.log('');
  });

  // Check credit ledger for recent grants
  const ledger = await prisma.creditLedger.findMany({
    where: {
      reason: 'credit_pack_purchase',
    },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: {
      id: true,
      userId: true,
      delta: true,
      refType: true,
      refId: true,
      createdAt: true,
    },
  });

  console.log('\n=== Recent Credit Grants ===\n');
  ledger.forEach((l, i) => {
    console.log(`Grant ${i + 1}:`);
    console.log(`  User: ${l.userId}`);
    console.log(`  Credits: +${l.delta}`);
    console.log(`  Payment ID: ${l.refId}`);
    console.log(`  Created: ${l.createdAt}`);
    console.log('');
  });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
