const { PrismaClient } = require('@interviewforge/db');

const prisma = new PrismaClient();

async function checkMyUsage() {
  try {
    // Find users with MAX plan
    const maxUsers = await prisma.subscription.findMany({
      where: {
        plan: 'MAX',
        status: { in: ['active', 'authenticated', 'cancelled'] },
      },
      include: {
        user: {
          select: { id: true, email: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
    
    console.log('\n👑 Users with MAX Plan:');
    if (maxUsers.length === 0) {
      console.log('  ❌ No MAX plan users found');
      return;
    }
    
    maxUsers.forEach(s => {
      console.log(`  ${s.user.email}: ${s.user.id}`);
      console.log(`    Status: ${s.status}`);
      console.log(`    Period: ${s.currentPeriodStart} → ${s.currentPeriodEnd}`);
    });
    
    const userId = maxUsers[0].user.id;
    const subscription = maxUsers[0];
    
    console.log(`\n🔍 Detailed Check for: ${maxUsers[0].user.email}`);
    
    // Check all feature usage records
    const allUsage = await prisma.featureUsage.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    
    console.log('\n📊 All Feature Usage Records:');
    if (allUsage.length === 0) {
      console.log('  ❌ No feature usage records found!');
      console.log('  🐛 This means resume analysis is NOT being tracked!');
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
    const expectedPeriodStart = subscription.currentPeriodStart;
    
    console.log('\n🎯 Expected Period Start (from subscription):', expectedPeriodStart);
    
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
      console.log('  🐛 This is why usage shows 0/50!');
      console.log('\n💡 Solution: The resume analysis endpoint needs to call requireFeatureCountAndConsume()');
    } else {
      matchingUsage.forEach(u => {
        console.log(`  ${u.featureKey}: ${u.count} count, ${u.tokens} tokens`);
      });
    }
    
    // Check resumes
    const resumes = await prisma.resume.findMany({
      where: { userId },
      select: {
        id: true,
        fileName: true,
        analysis: true,
        atsAnalysis: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
    
    console.log('\n📄 Recent Resumes:');
    if (resumes.length === 0) {
      console.log('  No resumes found');
    } else {
      resumes.forEach(r => {
        console.log(`  ${r.fileName}:`);
        console.log(`    Has analysis: ${!!r.analysis}`);
        console.log(`    Has ATS analysis: ${!!r.atsAnalysis}`);
        console.log(`    Created: ${r.createdAt}`);
      });
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkMyUsage();
