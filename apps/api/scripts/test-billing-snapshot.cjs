/**
 * Test billing snapshot API for a specific user
 * Usage: node scripts/test-billing-snapshot.cjs kush_test@gmail.com
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Import the entitlements service functions
async function getActivePlan(userId) {
  const sub = await prisma.subscription.findFirst({
    where: {
      userId,
      status: { in: ["active", "authenticated", "cancelled"] },
      OR: [
        { currentPeriodEnd: null },
        { currentPeriodEnd: { gt: new Date() } },
      ],
    },
    orderBy: { createdAt: "desc" },
  });
  return sub?.plan ?? "FREE";
}

async function testBillingSnapshot(email) {
  console.log(`\n🧪 Testing billing snapshot for: ${email}\n`);
  console.log('='.repeat(60));

  try {
    // 1. Find user
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, fullName: true }
    });

    if (!user) {
      console.log('❌ User not found');
      return;
    }

    console.log(`✅ User found: ${user.fullName} (${user.id})`);

    // 2. Test getActivePlan logic
    console.log('\n🔍 Testing getActivePlan logic...');
    const plan = await getActivePlan(user.id);
    console.log(`   Result: ${plan}`);

    // 3. Check subscription details
    console.log('\n📋 Subscription Query Details:');
    const now = new Date();
    console.log(`   Current time: ${now.toISOString()}`);
    
    const allSubs = await prisma.subscription.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });
    
    console.log(`\n   Total subscriptions: ${allSubs.length}`);
    
    allSubs.forEach((sub, idx) => {
      console.log(`\n   Subscription ${idx + 1}:`);
      console.log(`     ID: ${sub.id}`);
      console.log(`     Plan: ${sub.plan}`);
      console.log(`     Status: ${sub.status}`);
      console.log(`     Status in [active, authenticated, cancelled]: ${['active', 'authenticated', 'cancelled'].includes(sub.status)}`);
      console.log(`     Period End: ${sub.currentPeriodEnd}`);
      
      if (sub.currentPeriodEnd) {
        const periodEnd = new Date(sub.currentPeriodEnd);
        const isFuture = periodEnd > now;
        console.log(`     Period End > Now: ${isFuture}`);
        console.log(`     Time until end: ${Math.round((periodEnd - now) / (1000 * 60 * 60 * 24))} days`);
      } else {
        console.log(`     Period End is NULL (passes OR condition)`);
      }
      
      // Check if this sub matches the query
      const matchesStatus = ['active', 'authenticated', 'cancelled'].includes(sub.status);
      const matchesPeriod = !sub.currentPeriodEnd || new Date(sub.currentPeriodEnd) > now;
      const wouldBeSelected = matchesStatus && matchesPeriod;
      
      console.log(`     ✅ Would be selected: ${wouldBeSelected}`);
    });

    // 4. Get active subscription with full details
    console.log('\n🎯 Active Subscription (what API returns):');
    const activeSubscription = await prisma.subscription.findFirst({
      where: {
        userId: user.id,
        status: { in: ["active", "authenticated", "cancelled"] },
      },
      select: { 
        id: true,
        plan: true,
        cycle: true,
        status: true,
        cancelledAt: true,
        scheduledPlanChange: true,
        scheduledChangeDate: true,
        currentPeriodEnd: true,
      },
      orderBy: { createdAt: "desc" },
    });
    
    if (activeSubscription) {
      console.log('   ✅ Found:');
      console.log(`     Plan: ${activeSubscription.plan}`);
      console.log(`     Cycle: ${activeSubscription.cycle}`);
      console.log(`     Status: ${activeSubscription.status}`);
      console.log(`     Subscription ID: ${activeSubscription.id}`);
    } else {
      console.log('   ❌ No active subscription found');
    }

    // 5. Summary
    console.log('\n' + '='.repeat(60));
    console.log('\n📊 EXPECTED API RESPONSE:');
    console.log(`   plan: "${plan}"`);
    console.log(`   subscriptionId: "${activeSubscription?.id || null}"`);
    console.log(`   cycle: "${activeSubscription?.cycle || null}"`);
    console.log(`   status: "${activeSubscription?.status || null}"`);
    
    if (plan === 'FREE' && allSubs.length > 0) {
      console.log('\n⚠️  ISSUE DETECTED:');
      console.log('   User has subscriptions but plan shows as FREE');
      console.log('   Check the subscription status and period end values above');
    }

    console.log('\n' + '='.repeat(60) + '\n');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

const email = process.argv[2];

if (!email) {
  console.error('Usage: node scripts/test-billing-snapshot.cjs <email>');
  process.exit(1);
}

testBillingSnapshot(email);
