import { invalidateUserPlanCache } from '../src/services/cache.js';

// Your user ID
const userId = 'f3c79279-95bc-49e8-be03-0dee9510d9ce';

console.log(`\n🗑️  Invalidating cache for user: ${userId}\n`);

await invalidateUserPlanCache(userId);

console.log('✅ Cache invalidated!');
console.log('\n💡 Now refresh your billing page to see updated usage!\n');

process.exit(0);
