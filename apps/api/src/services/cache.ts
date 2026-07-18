// ============================================
// Enhanced Redis Caching Service
// ============================================
// Implements resilient caching with circuit breaker patterns,
// batch invalidation, and comprehensive cache statistics tracking.
// Follows the design specifications for admin panel enhancements.

import { cacheGet, cacheDel, getRedis } from "../lib/redis.js";
import { getEntitlementSnapshot } from "./entitlements.js";

// ============================================
// Cache Key Patterns and TTL Constants
// ============================================

export const CACHE_KEYS = {
  USER_PLAN: (userId: string) => `plan:v4:user:${userId}`,
  USER_ENTITLEMENTS: (userId: string) => `entitlements:user:${userId}`,
  COUPON_DATA: (couponId: string) => `coupon:${couponId}`,
  ADMIN_STATS: () => 'admin:stats:coupons',
} as const;

export const CACHE_TTL = {
  PLAN_DATA: 15 * 60, // 15 minutes
  ENTITLEMENTS: 10 * 60, // 10 minutes
  COUPON_DATA: 30 * 60, // 30 minutes
  ADMIN_STATS: 5 * 60, // 5 minutes
} as const;

// ============================================
// Circuit Breaker Implementation
// ============================================

export class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  
  constructor(
    private threshold: number = 5,
    private timeout: number = 60000,
    private resetTimeout: number = 30000
  ) {}
  
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.resetTimeout) {
        this.state = 'HALF_OPEN';
      } else {
        throw new Error('Circuit breaker is OPEN');
      }
    }
    
    try {
      const result = await Promise.race([
        operation(),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Operation timeout')), this.timeout)
        )
      ]);
      
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
  
  private onSuccess() {
    this.failures = 0;
    this.state = 'CLOSED';
  }
  
  private onFailure() {
    this.failures++;
    this.lastFailureTime = Date.now();
    
    if (this.failures >= this.threshold) {
      this.state = 'OPEN';
    }
  }
  
  getState() {
    return {
      state: this.state,
      failures: this.failures,
      lastFailureTime: this.lastFailureTime
    };
  }
}

// ============================================
// Cache Statistics Interface
// ============================================

export interface CacheStats {
  hitRate: number;
  missRate: number;
  totalRequests: number;
  totalHits: number;
  totalMisses: number;
  circuitBreakerState: string;
  lastResetTime: Date;
}

// ============================================
// Plan Data Types
// ============================================

export interface CachedPlanData {
  plan: string;
  entitlements: any;
  subscription?: {
    id: string;
    status: string;
    currentPeriodEnd: Date;
    source: 'PURCHASE' | 'COUPON';
  };
  wallet: {
    free: number;
    monthly: number;
    purchased: number;
    total: number;
  };
  usage: {
    resumeAnalysisUsed: number;
    resumeImproveAiUsed: number;
    latexAiTokensUsed: number;
    tutorTokensUsed: number;
  };
  cachedAt: Date;
  expiresAt: Date;
}

// ============================================
// Cache Service Interface
// ============================================

export interface CacheService {
  getPlanData(userId: string): Promise<CachedPlanData | null>;
  setPlanData(userId: string, data: CachedPlanData): Promise<void>;
  invalidatePlanData(userId: string): Promise<void>;
  invalidateMultipleUsers(userIds: string[]): Promise<void>;
  warmCache(userId: string): Promise<void>;
  getCacheStats(): Promise<CacheStats>;
}

// ============================================
// Resilient Cache Service Implementation
// ============================================

export class ResilientCacheService implements CacheService {
  private circuitBreaker = new CircuitBreaker(3, 5000, 30000);
  private stats = {
    totalRequests: 0,
    totalHits: 0,
    totalMisses: 0,
    lastResetTime: new Date()
  };

  async getPlanData(userId: string): Promise<CachedPlanData | null> {
    this.stats.totalRequests++;
    
    try {
      return await this.circuitBreaker.execute(async () => {
        const cached = await cacheGet(
          CACHE_KEYS.USER_PLAN(userId),
          CACHE_TTL.PLAN_DATA,
          () => this.fetchPlanDataFromDB(userId)
        );
        
        if (cached) {
          this.stats.totalHits++;
          return cached;
        } else {
          this.stats.totalMisses++;
          return null;
        }
      });
    } catch (error) {
      console.warn(`Cache service degraded for user ${userId.slice(0, 8)}, falling back to database:`, error);
      this.stats.totalMisses++;
      
      // Fallback to direct database query
      return await this.fetchPlanDataFromDB(userId);
    }
  }

  async setPlanData(userId: string, data: CachedPlanData): Promise<void> {
    try {
      await this.circuitBreaker.execute(async () => {
        const redis = getRedis();
        if (!redis) return;
        
        const key = CACHE_KEYS.USER_PLAN(userId);
        const stringified = JSON.stringify(data);
        await redis.set(key, stringified, { ex: CACHE_TTL.PLAN_DATA });
      });
    } catch (error) {
      console.error(`Failed to cache plan data for user ${userId.slice(0, 8)}:`, error);
      // Don't throw - caching failures shouldn't break the application
    }
  }

  async invalidatePlanData(userId: string): Promise<void> {
    try {
      await this.circuitBreaker.execute(async () => {
        await cacheDel([
          CACHE_KEYS.USER_PLAN(userId),
          CACHE_KEYS.USER_ENTITLEMENTS(userId)
        ]);
      });
    } catch (error) {
      console.error(`Failed to invalidate cache for user ${userId.slice(0, 8)}:`, error);
      // Don't throw - cache invalidation failures shouldn't break the application
    }
  }

  async invalidateMultipleUsers(userIds: string[]): Promise<void> {
    if (userIds.length === 0) return;
    
    try {
      await this.circuitBreaker.execute(async () => {
        const keys = userIds.flatMap(userId => [
          CACHE_KEYS.USER_PLAN(userId),
          CACHE_KEYS.USER_ENTITLEMENTS(userId)
        ]);
        
        // Process in batches to avoid overwhelming Redis
        const batchSize = 50;
        for (let i = 0; i < keys.length; i += batchSize) {
          const batch = keys.slice(i, i + batchSize);
          await cacheDel(batch);
        }
      });
    } catch (error) {
      console.error(`Failed to invalidate cache for ${userIds.length} users:`, error);
      // Don't throw - cache invalidation failures shouldn't break the application
    }
  }

  async warmCache(userId: string): Promise<void> {
    try {
      const planData = await this.fetchPlanDataFromDB(userId);
      await this.setPlanData(userId, planData);
    } catch (error) {
      console.error(`Failed to warm cache for user ${userId.slice(0, 8)}:`, error);
      // Don't throw - cache warming failures shouldn't break the application
    }
  }

  async getCacheStats(): Promise<CacheStats> {
    const hitRate = this.stats.totalRequests > 0 
      ? this.stats.totalHits / this.stats.totalRequests 
      : 0;
    const missRate = this.stats.totalRequests > 0 
      ? this.stats.totalMisses / this.stats.totalRequests 
      : 0;

    return {
      hitRate: Math.round(hitRate * 100) / 100,
      missRate: Math.round(missRate * 100) / 100,
      totalRequests: this.stats.totalRequests,
      totalHits: this.stats.totalHits,
      totalMisses: this.stats.totalMisses,
      circuitBreakerState: this.circuitBreaker.getState().state,
      lastResetTime: this.stats.lastResetTime
    };
  }

  // Reset statistics (useful for monitoring)
  resetStats(): void {
    this.stats = {
      totalRequests: 0,
      totalHits: 0,
      totalMisses: 0,
      lastResetTime: new Date()
    };
  }

  private async fetchPlanDataFromDB(userId: string): Promise<CachedPlanData> {
    try {
      const snapshot = await getEntitlementSnapshot(userId);
      const now = new Date();
      
      return {
        plan: snapshot.plan,
        entitlements: snapshot.entitlements,
        subscription: undefined, // Will be populated if needed
        wallet: snapshot.wallet,
        usage: snapshot.usage,
        cachedAt: now,
        expiresAt: new Date(now.getTime() + CACHE_TTL.PLAN_DATA * 1000)
      };
    } catch (error) {
      console.error(`Database query failed for user ${userId.slice(0, 8)}:`, error);
      
      // Return minimal safe data in case of database failure
      return {
        plan: 'FREE',
        entitlements: {
          monthlyInterviewMinutes: 0,
          lifetimeFreeInterviewMinutes: 60,
          resumeAnalysisPerMonth: 1,
          resumeImproveAiPerMonth: 0,
          resumeBuilderAccess: true,
          latexAiAccess: false,
          latexAiMonthlyTokens: 0,
          aiTutorAccess: false,
          aiTutorMonthlyTokens: 0,
          dsaSubmitAccess: "none",
          dsaSubmitHiddenTestCaseCap: 0,
          dsaSubmitSuccessPerHourPerQuestion: 0,
          displayName: "Free",
          priceInrMonthly: 0,
          priceInrQuarterlyPerMonth: 0,
        },
        wallet: { free: 0, monthly: 0, purchased: 0, total: 0 },
        usage: { 
          resumeAnalysisUsed: 0, 
          resumeImproveAiUsed: 0, 
          latexAiTokensUsed: 0, 
          tutorTokensUsed: 0 
        },
        cachedAt: new Date(),
        expiresAt: new Date(Date.now() + CACHE_TTL.PLAN_DATA * 1000)
      };
    }
  }
}

// ============================================
// Global Cache Service Instance
// ============================================

export const cacheService = new ResilientCacheService();

// ============================================
// Convenience Functions
// ============================================

/**
 * Get cached plan data with automatic fallback to database
 */
export async function getCachedPlanData(userId: string): Promise<CachedPlanData> {
  const cached = await cacheService.getPlanData(userId);
  if (cached) {
    return cached;
  }
  
  // Cache miss - fetch from database and cache it
  const snapshot = await getEntitlementSnapshot(userId);
  const now = new Date();
  
  const fresh: CachedPlanData = {
    plan: snapshot.plan,
    entitlements: snapshot.entitlements,
    subscription: undefined, // Will be populated if needed
    wallet: snapshot.wallet,
    usage: snapshot.usage,
    cachedAt: now,
    expiresAt: new Date(now.getTime() + CACHE_TTL.PLAN_DATA * 1000)
  };
  
  await cacheService.setPlanData(userId, fresh);
  return fresh;
}

/**
 * Invalidate plan cache for a single user
 */
export async function invalidateUserPlanCache(userId: string): Promise<void> {
  await cacheService.invalidatePlanData(userId);
}

/**
 * Invalidate plan cache for multiple users (batch operation)
 */
export async function invalidateMultipleUserPlanCache(userIds: string[]): Promise<void> {
  await cacheService.invalidateMultipleUsers(userIds);
}

/**
 * Warm cache for a user (preload plan data)
 */
export async function warmUserPlanCache(userId: string): Promise<void> {
  await cacheService.warmCache(userId);
}

/**
 * Get cache performance statistics
 */
export async function getCacheStatistics(): Promise<CacheStats> {
  return await cacheService.getCacheStats();
}

/**
 * Delete cache keys directly (re-export from redis.js for convenience)
 */
export { cacheDel } from "../lib/redis.js";
