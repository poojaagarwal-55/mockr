jest.mock('./env.js', () => ({
  env: {
    JUDGE0_EXECUTION_CONCURRENCY: 10,
  },
}));

import { AsyncConcurrencyLimiter } from './judge0-concurrency.js';

describe('AsyncConcurrencyLimiter', () => {
  it('caps active work at the configured concurrency', async () => {
    const limiter = new AsyncConcurrencyLimiter(2);
    let active = 0;
    let peak = 0;

    await Promise.all(
      Array.from({ length: 5 }, () =>
        limiter.run(async () => {
          active++;
          peak = Math.max(peak, active);
          await new Promise((resolve) => setTimeout(resolve, 10));
          active--;
        })
      )
    );

    expect(peak).toBe(2);
    expect(limiter.getStats()).toMatchObject({
      maxConcurrent: 2,
      active: 0,
      waiting: 0,
      peakActive: 2,
      completed: 5,
    });
  });
});
