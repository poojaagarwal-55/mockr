/**
 * Invalidate User Cache
 * 
 * This script manually invalidates a user's plan cache
 * so the billing snapshot will fetch fresh data from the database.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { createClient } = require('redis');

async function invalidateCache() {
  const userEmail = process.argv[2];
  
  if (!userEmail) {
    console.log('\n❌ Please provide a user email:');
    console.log('   node apps/api/scripts/invalidate-user-cache.cjs user@example.com\n');
    process.exit(1);
  }

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('🗑️  Invalidating User Cache');
  console.log('═══════════════════════════════════════════════════════\n');

  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();

  try {
    // Find user
    const user = await prisma.user.findUnique({
      where: { email: userEmail },
      select: { id: true, email: true, fullName: true },
    });

    if (!user) {
      console.log(`❌ User not found: ${userEmail}\n`);
      process.exit(1);
    }

    console.log(`📋 User: ${user.fullName} (${user.email})`);
    console.log(`   ID: ${user.id}\n`);

    // Connect to Redis
    const redisUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.REDIS_URL || 'redis://localhost:6379';
    console.log(`🔌 Connecting to Redis...`);
    
    // For Upstash REST API
    if (redisUrl.startsWith('http')) {
      const restToken = process.env.UPSTASH_REDIS_REST_TOKEN;
      if (!restToken) {
        console.log('❌ UPSTASH_REDIS_REST_TOKEN not found\n');
        process.exit(1);
      }

      console.log(`   Using Upstash REST API: ${redisUrl}\n`);
      
      const fetch = require('node-fetch');
      
      // Delete plan data cache
      const planKey = `plan:${user.id}`;
      const profileKey = `api:users:${user.id}:profile`;
      
      console.log(`🗑️  Deleting cache keys:`);
      console.log(`   - ${planKey} (billing/credits)`);
      console.log(`   - ${profileKey} (user profile)`);
      
      const planResponse = await fetch(`${redisUrl}/del/${planKey}`, {
        headers: {
          'Authorization': `Bearer ${restToken}`,
        },
      });
      
      const profileResponse = await fetch(`${redisUrl}/del/${profileKey}`, {
        headers: {
          'Authorization': `Bearer ${restToken}`,
        },
      });
      
      const planResult = await planResponse.json();
      const profileResult = await profileResponse.json();
      
      console.log(`   Plan cache: ${planResult.result === 1 ? '✅ deleted' : '⚠️  not found'}`);
      console.log(`   Profile cache: ${profileResult.result === 1 ? '✅ deleted' : '⚠️  not found'}\n`);
    } else {
      // For local Redis
      console.log(`   Using local Redis: ${redisUrl}\n`);
      
      const client = createClient({ url: redisUrl });
      await client.connect();
      
      const planKey = `plan:${user.id}`;
      const profileKey = `api:users:${user.id}:profile`;
      
      console.log(`🗑️  Deleting cache keys:`);
      console.log(`   - ${planKey} (billing/credits)`);
      console.log(`   - ${profileKey} (user profile)`);
      
      const planDeleted = await client.del(planKey);
      const profileDeleted = await client.del(profileKey);
      
      console.log(`   Plan cache: ${planDeleted === 1 ? '✅ deleted' : '⚠️  not found'}`);
      console.log(`   Profile cache: ${profileDeleted === 1 ? '✅ deleted' : '⚠️  not found'}\n`);
      
      await client.disconnect();
    }

    console.log('═══════════════════════════════════════════════════════');
    console.log('✅ Cache Invalidated Successfully!');
    console.log('═══════════════════════════════════════════════════════\n');
    console.log('🎯 Next Steps:');
    console.log('   1. Refresh your browser (hard refresh: Ctrl+Shift+R)');
    console.log('   2. The banner should disappear');
    console.log('   3. Credits should show 3 at the top');
    console.log('   4. If still showing, check browser console for errors\n');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

invalidateCache();
