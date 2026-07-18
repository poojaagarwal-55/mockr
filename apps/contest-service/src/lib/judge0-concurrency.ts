import { env } from './env.js';

type Waiter = () => void;

export class AsyncConcurrencyLimiter {
  private active = 0;
  private readonly waiters: Waiter[] = [];
  private peakActive = 0;
  private completed = 0;

  constructor(private readonly maxConcurrent: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();

    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  getStats() {
    return {
      maxConcurrent: this.maxConcurrent,
      active: this.active,
      waiting: this.waiters.length,
      peakActive: this.peakActive,
      completed: this.completed,
    };
  }

  private async acquire(): Promise<void> {
    if (this.active < this.maxConcurrent) {
      this.active++;
      this.peakActive = Math.max(this.peakActive, this.active);
      return;
    }

    await new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });

    this.active++;
    this.peakActive = Math.max(this.peakActive, this.active);
  }

  private release(): void {
    this.active--;
    this.completed++;

    const next = this.waiters.shift();
    if (next) {
      next();
    }
  }
}

export const judge0ExecutionLimiter = new AsyncConcurrencyLimiter(env.JUDGE0_EXECUTION_CONCURRENCY);

export function runWithJudge0Concurrency<T>(fn: () => Promise<T>): Promise<T> {
  return judge0ExecutionLimiter.run(fn);
}

export function getJudge0ConcurrencyStats() {
  return judge0ExecutionLimiter.getStats();
}
