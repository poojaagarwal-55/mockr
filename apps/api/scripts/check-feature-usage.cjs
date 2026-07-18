const { PrismaClient } = require('@interviewforge/db');

const prisma = new PrismaClient();

async function checkFeatureUsage() {
  try {
    // Get your user ID (replace with actual user ID)
    const users = await prisma.user.findMany({
      select: { id: true, email: true },
      take: 5,
    });
    
    console.log('\n📋 Recent Users:');
    users.forEach(u => console.log(`  ${u.email}: ${u.id}`));
    
    if (users.length === 0) {
      console.log('❌ No users found');
      return;
    }
    
    const userId = users[0].id;
    console.log(`\n🔍 Checking feature usage for: ${users[0].email}`);
    
    // Check subscription
    const subscription = await prisma.subscription.findFirst({
      where: {
        userId,
        status: { in: ['active', 'authenticated', 'cancelled'] },
      },
      orderBy: { createdAt: 'desc' },
    });
    
    console.log('\n📅 Subscription Info:');
    if (subscription) {
      console.log(`  Status: ${subscription.status}`);
      console.log(`  Plan: ${subscription.plan}`);
      console.log(`  Current Period Start: ${subscription.currentPeriodStart}`);
      console.log(`  Current Period End: ${subscription.currentPeriodEnd}`);
    } else {
      console.log('  No active subscription (FREE user)');
    }
    
    // Check all feature usage records
    const allUsage = await prisma.featureUsage.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    
    console.log('\n📊 All Feature Usage Records:');
    if (allUsage.length === 0) {
      console.log('  ❌ No feature usage records found!');
    } else {
      allUsage.forEach(u => {
        console.log(`  ${u.featureKey}:`);
        console.log(`    Period Start: ${u.periodStart}`);
        console.log(`    Count: ${u.count}`);
        console.log(`    Tokens: ${u.tokens}`);
        console.log(`    Created: ${u.createdAt}`);
      });
    }
    
    // Check what getCurrentPeriodStart would return
    const expectedPeriodStart = subscription?.currentPeriodStart 
      ? subscription.currentPeriodStart
      : new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
    
    console.log('\n🎯 Expected Period Start:', expectedPeriodStart);
    
    // Check if there's a matching record
    const matchingUsage = await prisma.featureUsage.findMany({
      where: {
        userId,
        periodStart: expectedPeriodStart,
      },
    });
    
    console.log('\n✅ Matching Usage Records for Current Period:');
    if (matchingUsage.length === 0) {
      console.log('  ❌ No matching records found!');
      console.log('  This is why usage shows 0!');
    } else {
      matchingUsage.forEach(u => {
        console.log(`  ${u.featureKey}: ${u.count} count, ${u.tokens} tokens`);
      });
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkFeatureUsage();
