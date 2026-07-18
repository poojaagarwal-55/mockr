const { PrismaClient } = require('@interviewforge/db');

const prisma = new PrismaClient();

async function fixPeriodStartMismatch() {
  try {
    console.log('\n🔧 Fixing Period Start Mismatches...\n');
    
    // Get all subscriptions
    const subscriptions = await prisma.subscription.findMany({
      where: {
        status: { in: ['active', 'authenticated', 'cancelled'] },
      },
      include: {
        user: {
          select: { email: true },
        },
      },
    });
    
    console.log(`Found ${subscriptions.length} active subscriptions\n`);
    
    for (const sub of subscriptions) {
      console.log(`\n📋 ${sub.user.email}:`);
      console.log(`  Subscription Period Start: ${sub.currentPeriodStart}`);
      
      // Get all feature usage for this user
      const usageRecords = await prisma.featureUsage.findMany({
        where: { userId: sub.userId },
      });
      
      if (usageRecords.length === 0) {
        console.log(`  ✅ No usage records (nothing to fix)`);
        continue;
      }
      
      console.log(`  Found ${usageRecords.length} usage records:`);
      
      for (const usage of usageRecords) {
        const usagePeriod = new Date(usage.periodStart);
        const subPeriod = new Date(sub.currentPeriodStart);
        
        // Normalize both to remove milliseconds
        usagePeriod.setMilliseconds(0);
        subPeriod.setMilliseconds(0);
        
        const timeDiff = Math.abs(usagePeriod.getTime() - subPeriod.getTime());
        
        console.log(`    ${usage.featureKey}:`);
        console.log(`      Current Period: ${usage.periodStart}`);
        console.log(`      Expected Period: ${sub.currentPeriodStart}`);
        console.log(`      Time Diff: ${timeDiff}ms`);
        
        if (timeDiff > 1000) {
          // More than 1 second difference - needs fixing
          console.log(`      ⚠️  MISMATCH! Updating...`);
          
          await prisma.featureUsage.update({
            where: { id: usage.id },
            data: { periodStart: sub.currentPeriodStart },
          });
          
          console.log(`      ✅ Fixed!`);
        } else {
          console.log(`      ✅ OK`);
        }
      }
    }
    
    console.log('\n\n✅ All done!');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

fixPeriodStartMismatch();
