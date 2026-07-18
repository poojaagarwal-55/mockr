const { createClient } = require('redis');

async function clearBillingCache() {
  const redis = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  });

  try {
    await redis.connect();
    console.log('✅ Connected to Redis');

    // Get all keys matching the user plan pattern
    const keys = await redis.keys('user:*:plan');
    
    console.log(`\n📋 Found ${keys.length} cached plan data entries`);
    
    if (keys.length > 0) {
      console.log('\n🗑️  Deleting cache keys:');
      for (const key of keys) {
        await redis.del(key);
        console.log(`  ✅ Deleted: ${key}`);
      }
      console.log(`\n✅ Cleared ${keys.length} cache entries`);
    } else {
      console.log('\n✅ No cache entries to clear');
    }

    console.log('\n💡 Now refresh your billing page to see updated usage!');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await redis.disconnect();
  }
}

clearBillingCache();
