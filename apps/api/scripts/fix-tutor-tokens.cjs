const { PrismaClient } = require('@interviewforge/db');

const prisma = new PrismaClient();

async function fixTutorTokens() {
  try {
    console.log('\n🔧 Fixing Tutor Token Period Starts...\n');
    
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
      
      // Get all tutor_tokens usage for this user
      const tutorUsage = await prisma.featureUsage.findMany({
        where: { 
          userId: sub.userId,
          featureKey: 'tutor_tokens',
        },
      });
      
      if (tutorUsage.length === 0) {
        console.log(`  ✅ No tutor usage records`);
        continue;
      }
      
      console.log(`  Found ${tutorUsage.length} tutor usage records`);
      
      // Check if there's a mismatch
      const correctPeriod = new Date(sub.currentPeriodStart);
      correctPeriod.setMilliseconds(0);
      
      let hasCorrectRecord = false;
      let wrongRecords = [];
      
      for (const usage of tutorUsage) {
        const usagePeriod = new Date(usage.periodStart);
        usagePeriod.setMilliseconds(0);
        
        const timeDiff = Math.abs(usagePeriod.getTime() - correctPeriod.getTime());
        
        if (timeDiff < 1000) {
          hasCorrectRecord = true;
          console.log(`    ✅ Correct record found: ${usage.tokens} tokens`);
        } else {
          wrongRecords.push(usage);
          console.log(`    ⚠️  Wrong period: ${usage.periodStart} (${usage.tokens} tokens)`);
        }
      }
      
      // If we have both correct and wrong records, delete the wrong ones
      if (hasCorrectRecord && wrongRecords.length > 0) {
        console.log(`    🗑️  Deleting ${wrongRecords.length} wrong records...`);
        for (const wrong of wrongRecords) {
          await prisma.featureUsage.delete({
            where: { id: wrong.id },
          });
          console.log(`      ✅ Deleted record with period ${wrong.periodStart}`);
        }
      }
      // If we only have wrong records, update them
      else if (!hasCorrectRecord && wrongRecords.length > 0) {
        console.log(`    🔄 Updating wrong records to correct period...`);
        
        // Sum up all tokens from wrong records
        const totalTokens = wrongRecords.reduce((sum, r) => sum + r.tokens, 0);
        
        // Delete all wrong records
        for (const wrong of wrongRecords) {
          await prisma.featureUsage.delete({
            where: { id: wrong.id },
          });
        }
        
        // Create one correct record with total tokens
        await prisma.featureUsage.create({
          data: {
            userId: sub.userId,
            featureKey: 'tutor_tokens',
            periodStart: sub.currentPeriodStart,
            count: 0,
            tokens: totalTokens,
          },
        });
        
        console.log(`      ✅ Created correct record with ${totalTokens} tokens`);
      }
    }
    
    console.log('\n\n✅ All done!');
    console.log('\n💡 Now invalidate cache and refresh billing page!\n');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

fixTutorTokens();
