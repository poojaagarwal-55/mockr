/**
 * Diagnostic script to check user plan and wallet data
 * Usage: node scripts/diagnose-user-plan.cjs user@example.com
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function diagnoseUser(email) {
  console.log(`\n🔍 Diagnosing user: ${email}\n`);
  console.log('='.repeat(60));

  try {
    // 1. Find user
    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        fullName: true,
        createdAt: true,
      }
    });

    if (!user) {
      console.log('❌ User not found in database');
      return;
    }

    console.log('\n✅ User found:');
    console.log(`   ID: ${user.id}`);
    console.log(`   Name: ${user.fullName}`);
    console.log(`   Created: ${user.createdAt}`);

    // 2. Check subscriptions
    console.log('\n📋 Subscriptions:');
    const subscriptions = await prisma.subscription.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        plan: true,
        status: true,
        cycle: true,
        currentPeriodEnd: true,
        createdAt: true,
        updatedAt: true,
      }
    });

    if (subscriptions.length === 0) {
      console.log('   ⚠️  No subscriptions found');
    } else {
      subscriptions.forEach((sub, idx) => {
        console.log(`\n   Subscription ${idx + 1}:`);
        console.log(`   - ID: ${sub.id}`);
        console.log(`   - Plan: ${sub.plan}`);
        console.log(`   - Status: ${sub.status}`);
        console.log(`   - Cycle: ${sub.cycle}`);
        console.log(`   - Period End: ${sub.currentPeriodEnd}`);
        console.log(`   - Created: ${sub.createdAt}`);
        console.log(`   - Updated: ${sub.updatedAt}`);
      });
    }

    // 3. Check active subscription (what the system sees)
    console.log('\n🎯 Active Subscription (system logic):');
    const activeSub = await prisma.subscription.findFirst({
      where: {
        userId: user.id,
        status: { in: ['active', 'authenticated'] },
        OR: [
          { currentPeriodEnd: null },
          { currentPeriodEnd: { gt: new Date() } },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!activeSub) {
      console.log('   ❌ No active subscription found');
      console.log('   → User will be on FREE plan');
    } else {
      console.log(`   ✅ Active subscription found:`);
      console.log(`   - Plan: ${activeSub.plan}`);
      console.log(`   - Status: ${activeSub.status}`);
    }

    // 4. Check wallet
    console.log('\n💰 Credit Wallet:');
    const wallet = await prisma.creditWallet.findUnique({
      where: { userId: user.id },
      select: {
        freeCreditsRemaining: true,
        freeCreditsGranted: true,
        monthlyBalance: true,
        purchasedBalance: true,
        monthlyGrantedAt: true,
        monthlyResetAt: true,
        createdAt: true,
        updatedAt: true,
      }
    });

    if (!wallet) {
      console.log('   ⚠️  No wallet found (will be created on first access)');
    } else {
      const total = wallet.freeCreditsRemaining + wallet.monthlyBalance + wallet.purchasedBalance;
      console.log(`   - Free Credits: ${wallet.freeCreditsRemaining}`);
      console.log(`   - Monthly Balance: ${wallet.monthlyBalance}`);
      console.log(`   - Purchased Balance: ${wallet.purchasedBalance}`);
      console.log(`   - Total: ${total}`);
      console.log(`   - Monthly Granted At: ${wallet.monthlyGrantedAt}`);
      console.log(`   - Monthly Reset At: ${wallet.monthlyResetAt}`);
      console.log(`   - Created: ${wallet.createdAt}`);
      console.log(`   - Updated: ${wallet.updatedAt}`);
    }

    // 5. Check payments
    console.log('\n💳 Payments:');
    const payments = await prisma.payment.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        amount: true,
        status: true,
        type: true,
        createdAt: true,
      }
    });

    if (payments.length === 0) {
      console.log('   ⚠️  No payments found');
    } else {
      payments.forEach((payment, idx) => {
        console.log(`\n   Payment ${idx + 1}:`);
        console.log(`   - ID: ${payment.id}`);
        console.log(`   - Amount: ₹${payment.amount}`);
        console.log(`   - Status: ${payment.status}`);
        console.log(`   - Type: ${payment.type}`);
        console.log(`   - Created: ${payment.createdAt}`);
      });
    }

    // 6. Summary
    console.log('\n' + '='.repeat(60));
    console.log('\n📊 SUMMARY:');
    
    const expectedPlan = activeSub?.plan || 'FREE';
    const expectedTokens = wallet ? (wallet.freeCreditsRemaining + wallet.monthlyBalance + wallet.purchasedBalance) : 0;
    
    console.log(`   Expected Plan: ${expectedPlan}`);
    console.log(`   Expected Tokens: ${expectedTokens}`);
    
    if (!activeSub && subscriptions.length > 0) {
      console.log('\n⚠️  ISSUE DETECTED:');
      console.log('   - Subscriptions exist but none are active');
      console.log('   - Check subscription status values');
      console.log('   - Ensure status is "active" or "authenticated"');
      console.log('   - Ensure currentPeriodEnd is in the future or null');
    }

    if (!wallet) {
      console.log('\n⚠️  ISSUE DETECTED:');
      console.log('   - No wallet found');
      console.log('   - Wallet will be created on first API call');
    }

    console.log('\n' + '='.repeat(60) + '\n');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

// Get email from command line argument
const email = process.argv[2];

if (!email) {
  console.error('Usage: node scripts/diagnose-user-plan.cjs <email>');
  process.exit(1);
}

diagnoseUser(email);
