# Enhanced Redis Caching Service

This document describes the enhanced Redis caching service implemented for the admin panel enhancements feature.

## Overview

The `ResilientCacheService` provides a robust caching layer with circuit breaker patterns, batch invalidation, and comprehensive statistics tracking. It's designed to improve performance while gracefully handling Redis failures.

## Key Features

### 1. Circuit Breaker Pattern
- Automatically opens circuit after 3 consecutive failures
- 5-second timeout for operations
- 30-second reset timeout
- Prevents cascading failures when Redis is unavailable

### 2. Cache Key Patterns
```typescript
CACHE_KEYS = {
  USER_PLAN: (userId: string) => `plan:v4:user:${userId}`,
  USER_ENTITLEMENTS: (userId: string) => `entitlements:user:${userId}`,
  COUPON_DATA: (couponId: string) => `coupon:${couponId}`,
  ADMIN_STATS: () => 'admin:stats:coupons',
}
```

### 3. TTL Configuration
```typescript
CACHE_TTL = {
  PLAN_DATA: 15 * 60,      // 15 minutes
  ENTITLEMENTS: 10 * 60,   // 10 minutes
  COUPON_DATA: 30 * 60,    // 30 minutes
  ADMIN_STATS: 5 * 60,     // 5 minutes
}
```

### 4. Batch Operations
- `invalidateMultipleUsers(userIds: string[])` - Efficiently invalidate cache for multiple users
- Processes invalidations in batches of 50 to avoid overwhelming Redis

### 5. Statistics Tracking
- Hit/miss rates
- Total requests
- Circuit breaker state
- Performance metrics

## Usage

### Basic Usage
```typescript
import { getCachedPlanData, invalidateUserPlanCache } from '../services/cache.js';

// Get cached plan data (with automatic fallback to database)
const planData = await getCachedPlanData(userId);

// Invalidate cache when plan changes
await invalidateUserPlanCache(userId);
```

### Batch Invalidation
```typescript
import { invalidateMultipleUserPlanCache } from '../services/cache.js';

// Invalidate cache for multiple users (e.g., after bulk admin operations)
await invalidateMultipleUserPlanCache(['user1', 'user2', 'user3']);
```

### Cache Statistics (Admin Only)
```typescript
import { getCacheStatistics } from '../services/cache.js';

// Get performance metrics
const stats = await getCacheStatistics();
console.log(`Cache hit rate: ${stats.hitRate}%`);
```

## Integration Points

### 1. Billing Routes
The billing snapshot endpoint now uses cached data:
```typescript
fastify.get("/billing/snapshot", async (request) => {
    const cachedData = await getCachedPlanData(request.user!.id);
    return {
        plan: cachedData.plan,
        entitlements: cachedData.entitlements,
        wallet: cachedData.wallet,
        usage: cachedData.usage,
        isAdmin: isAdminEmail(request.user!.email),
    };
});
```

### 2. Automatic Cache Invalidation
Cache is automatically invalidated when:
- Plan subscriptions are activated
- Interview minutes are purchased or granted
- Coupons are redeemed
- Interview minutes are consumed or refunded

### 3. Admin Monitoring
New admin endpoint for cache statistics:
```
GET /admin/cache/stats
```

## Error Handling

### Graceful Degradation
- When Redis is unavailable, the service falls back to direct database queries
- Circuit breaker prevents repeated failed attempts
- No user-facing errors when caching fails

### Fallback Strategy
1. Try Redis cache
2. If cache fails, query database directly
3. Return minimal safe data if database also fails

## Security Considerations

- User IDs are masked in logs (first 8 characters only)
- No sensitive data is logged
- Cache keys use consistent patterns to prevent collisions
- Admin endpoints require proper authentication and authorization

## Performance Benefits

- **Reduced Database Load**: 90%+ cache hit rate target
- **Faster Response Times**: <200ms for cached data
- **Improved Scalability**: Handles high traffic with minimal database impact
- **Resilient Architecture**: Continues operating even when Redis is down

## Monitoring

### Key Metrics
- Cache hit rate (target: >90%)
- Cache miss rate
- Circuit breaker state
- Total requests processed

### Alerting Thresholds
- Alert if cache hit rate <85% for 5 minutes
- Alert if circuit breaker is OPEN
- Monitor Redis connection health

## Configuration

The service uses existing Redis configuration from `apps/api/src/lib/redis.ts`:
- UPSTASH_REDIS_REST_URL
- UPSTASH_REDIS_REST_TOKEN

No additional configuration required.
