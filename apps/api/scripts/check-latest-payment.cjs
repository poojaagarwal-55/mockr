const { PrismaClient } = require('@interviewforge/db');

async function main() {
  const prisma = new PrismaClient();

  try {
    // Get latest payment
    const latestPayment = await prisma.payment.findFirst({
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: { id: true, email: true }
        }
      }
    });

    console.log('\n=== LATEST PAYMENT ===');
    console.log(JSON.stringify(latestPayment, null, 2));

    if (latestPayment) {
      const userId = latestPayment.userId;

      // Check all related tables
      const [
        subscriptions,
        stateTransitions,
        auditLogs,
        ledgerTransactions,
        ledgerEntries,
        userAttempts,
        userCooldowns
      ] = await Promise.all([
        prisma.subscription.count({ where: { userId } }),
        prisma.paymentStateTransition.count({ where: { paymentId: latestPayment.id } }),
        prisma.paymentAuditLog.count({ where: { paymentId: latestPayment.id } }),
        prisma.ledgerTransaction.count({ where: { paymentId: latestPayment.id } }),
        prisma.ledgerEntry.count(),
        prisma.userPaymentAttempt.count({ where: { userId } }),
        prisma.userPaymentCooldown.count({ where: { userId } })
      ]);

      console.log('\n=== TABLE COUNTS FOR USER ===');
      console.log({
        userId,
        subscriptions,
        stateTransitions,
        auditLogs,
        ledgerTransactions,
        ledgerEntries,
        userAttempts,
        userCooldowns
      });

      // Get latest state transition
      const latestTransition = await prisma.paymentStateTransition.findFirst({
        where: { paymentId: latestPayment.id },
        orderBy: { createdAt: 'desc' }
      });

      console.log('\n=== LATEST STATE TRANSITION ===');
      console.log(JSON.stringify(latestTransition, null, 2));

      // Get latest audit log
      const latestAudit = await prisma.paymentAuditLog.findFirst({
        where: { paymentId: latestPayment.id },
        orderBy: { sequence: 'desc' }
      });

      console.log('\n=== LATEST AUDIT LOG ===');
      console.log(JSON.stringify(latestAudit, null, 2));

      // Get latest ledger transaction
      const latestLedger = await prisma.ledgerTransaction.findFirst({
        where: { paymentId: latestPayment.id },
        orderBy: { createdAt: 'desc' },
        include: {
          entries: true
        }
      });

      console.log('\n=== LATEST LEDGER TRANSACTION ===');
      console.log(JSON.stringify(latestLedger, null, 2));

      // Get user attempts
      const attempts = await prisma.userPaymentAttempt.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 5
      });

      console.log('\n=== USER PAYMENT ATTEMPTS ===');
      console.log(JSON.stringify(attempts, null, 2));
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
