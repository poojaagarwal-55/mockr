describe('rate limiter', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('allows requests up to limit and blocks next one', async () => {
    const { checkRateLimit } = require('./rate-limiter.js');

    const key = 'chat:user1';
    const windowMs = 60_000;

    expect(checkRateLimit(key, 2, windowMs)).toEqual({
      allowed: true,
      remaining: 1,
      retryAfterMs: 0,
    });

    expect(checkRateLimit(key, 2, windowMs)).toEqual({
      allowed: true,
      remaining: 0,
      retryAfterMs: 0,
    });

    const blocked = checkRateLimit(key, 2, windowMs);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterMs).toBe(windowMs);
  });

  test('resets once window has passed', async () => {
    const { checkRateLimit } = require('./rate-limiter.js');

    const key = 'chat:user2';
    const windowMs = 10_000;

    checkRateLimit(key, 1, windowMs);
    expect(checkRateLimit(key, 1, windowMs).allowed).toBe(false);

    jest.advanceTimersByTime(windowMs + 1);

    expect(checkRateLimit(key, 1, windowMs)).toEqual({
      allowed: true,
      remaining: 0,
      retryAfterMs: 0,
    });
  });
});
