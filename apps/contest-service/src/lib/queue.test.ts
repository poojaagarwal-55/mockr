jest.mock('./env.js', () => ({
  env: {
    NODE_ENV: 'test',
    QUEUE_BACKEND: 'auto',
    QUEUE_REDIS_URL: undefined,
    QUEUE_CONCURRENCY: 10,
    QUEUE_MAX_ATTEMPTS: 2,
    QUEUE_RETRY_BASE_DELAY_MS: 2000,
    BULLMQ_DRAIN_DELAY_SECONDS: 300,
    BULLMQ_STALLED_INTERVAL_MS: 300_000,
    BULLMQ_LOCK_DURATION_MS: 180_000,
    BULLMQ_MAX_STALLED_COUNT: 2,
  },
}));

import { closeQueue, isRedisTcpUrl, resolveQueueBackend } from './queue.js';

describe('queue backend selection', () => {
  afterAll(async () => {
    await closeQueue();
  });

  it('uses BullMQ when a TCP Redis URL is configured', () => {
    expect(resolveQueueBackend({
      requestedBackend: 'auto',
      queueRedisUrl: 'rediss://default:secret@example.upstash.io:6379',
      nodeEnv: 'production',
    })).toBe('bullmq');
  });

  it('rejects HTTP Redis URLs so the Upstash REST client is not reused for BullMQ', () => {
    expect(isRedisTcpUrl('https://example.upstash.io')).toBe(false);
    expect(() => resolveQueueBackend({
      requestedBackend: 'bullmq',
      queueRedisUrl: 'https://example.upstash.io',
      nodeEnv: 'production',
    })).toThrow(/redis:\/\/ or rediss:\/\//);
  });

  it('requires a durable queue in production', () => {
    expect(() => resolveQueueBackend({
      requestedBackend: 'auto',
      queueRedisUrl: undefined,
      nodeEnv: 'production',
    })).toThrow(/Production contest-service requires QUEUE_REDIS_URL/);

    expect(() => resolveQueueBackend({
      requestedBackend: 'in-process',
      queueRedisUrl: undefined,
      nodeEnv: 'production',
    })).toThrow(/not allowed in production/);
  });

  it('allows the in-process queue only outside production', () => {
    expect(resolveQueueBackend({
      requestedBackend: 'auto',
      queueRedisUrl: undefined,
      nodeEnv: 'test',
    })).toBe('in-process');
  });
});
