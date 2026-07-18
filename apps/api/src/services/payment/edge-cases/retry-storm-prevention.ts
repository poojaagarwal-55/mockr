import { checkRateLimit } from '../../../lib/rate-limiter.js';

type OperationType = 'webhook_processing' | 'payment_creation' | 'reconciliation';

type OperationConfig = {
  limit: number;
  windowMs: number;
  lockTtlMs: number;
};

const OPERATION_CONFIG: Record<OperationType, OperationConfig> = {
  webhook_processing: {
    limit: 20,
    windowMs: 60_000,
    lockTtlMs: 2 * 60_000,
  },
  payment_creation: {
    limit: 8,
    windowMs: 5 * 60_000,
    lockTtlMs: 60_000,
  },
  reconciliation: {
    limit: 6,
    windowMs: 60 * 60_000,
    lockTtlMs: 5 * 60_000,
  },
};

type InFlightEntry = {
  expiresAt: number;
};

export class RetryStormPrevention {
  private readonly inFlight = new Map<string, InFlightEntry>();

  constructor() {
    setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.inFlight.entries()) {
        if (entry.expiresAt <= now) {
          this.inFlight.delete(key);
        }
      }
    }, 30_000).unref();
  }

  checkRateLimit(operation: OperationType, identifier: string) {
    const config = OPERATION_CONFIG[operation];
    return checkRateLimit(`payment:${operation}:${identifier}`, config.limit, config.windowMs);
  }

  acquireProcessingLock(operation: OperationType, identifier: string): {
    acquired: boolean;
    lockKey: string;
    retryAfterMs: number;
  } {
    const config = OPERATION_CONFIG[operation];
    const lockKey = `${operation}:${identifier}`;
    const now = Date.now();
    const current = this.inFlight.get(lockKey);

    if (current && current.expiresAt > now) {
      return {
        acquired: false,
        lockKey,
        retryAfterMs: current.expiresAt - now,
      };
    }

    this.inFlight.set(lockKey, {
      expiresAt: now + config.lockTtlMs,
    });

    return {
      acquired: true,
      lockKey,
      retryAfterMs: 0,
    };
  }

  releaseProcessingLock(lockKey: string): void {
    this.inFlight.delete(lockKey);
  }

  async withProcessingLock<T>(
    operation: OperationType,
    identifier: string,
    task: () => Promise<T>
  ): Promise<T | null> {
    const lock = this.acquireProcessingLock(operation, identifier);
    if (!lock.acquired) {
      return null;
    }

    try {
      return await task();
    } finally {
      this.releaseProcessingLock(lock.lockKey);
    }
  }

  checkAndGuard(
    operation: OperationType,
    identifier: string
  ): {
    allowed: boolean;
    reason?: 'rate_limited' | 'already_processing';
    retryAfterMs: number;
    lockKey?: string;
  } {
    const rateResult = this.checkRateLimit(operation, identifier);
    if (!rateResult.allowed) {
      return {
        allowed: false,
        reason: 'rate_limited',
        retryAfterMs: rateResult.retryAfterMs,
      };
    }

    const lockResult = this.acquireProcessingLock(operation, identifier);
    if (!lockResult.acquired) {
      return {
        allowed: false,
        reason: 'already_processing',
        retryAfterMs: lockResult.retryAfterMs,
      };
    }

    return {
      allowed: true,
      retryAfterMs: 0,
      lockKey: lockResult.lockKey,
    };
  }
}

export const retryStormPrevention = new RetryStormPrevention();
