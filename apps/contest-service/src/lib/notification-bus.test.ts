type RedisMockInstance = {
  publish: jest.Mock;
  subscribe: jest.Mock;
  on: jest.Mock;
  quit: jest.Mock;
  handlers: Map<string, (...args: any[]) => void>;
};

function loadNotificationBus(queueRedisUrl?: string) {
  jest.resetModules();

  const instances: RedisMockInstance[] = [];
  const redisCtor = jest.fn(() => {
    const instance: RedisMockInstance = {
      publish: jest.fn().mockResolvedValue(1),
      subscribe: jest.fn().mockResolvedValue(1),
      on: jest.fn((event: string, handler: (...args: any[]) => void) => {
        instance.handlers.set(event, handler);
        return instance;
      }),
      quit: jest.fn().mockResolvedValue('OK'),
      handlers: new Map(),
    };
    instances.push(instance);
    return instance;
  });

  jest.doMock('ioredis', () => ({
    __esModule: true,
    default: redisCtor,
  }));

  jest.doMock('./env.js', () => ({
    env: {
      QUEUE_REDIS_URL: queueRedisUrl,
    },
  }));

  const bus = require('./notification-bus.js') as typeof import('./notification-bus.js');
  return { bus, redisCtor, instances };
}

describe('notification bus', () => {
  afterEach(() => {
    jest.dontMock('ioredis');
    jest.dontMock('./env.js');
  });

  it('publishes submission notifications to Redis pub/sub when TCP Redis is configured', async () => {
    const { bus, redisCtor, instances } = loadNotificationBus('rediss://default:secret@example.upstash.io:6379');

    await bus.publishSubmissionNotification('user-1', { type: 'submission_completed', submissionId: 'sub-1' });

    expect(redisCtor).toHaveBeenCalledTimes(1);
    expect(instances[0].publish).toHaveBeenCalledTimes(1);
    const [channel, payload] = instances[0].publish.mock.calls[0];
    expect(channel).toBe('contest:submission-notify');
    expect(JSON.parse(payload)).toEqual({
      userId: 'user-1',
      notification: {
        type: 'submission_completed',
        submissionId: 'sub-1',
      },
    });
  });

  it('subscribes and delivers Redis pub/sub messages to the local socket handler', () => {
    const { bus, instances } = loadNotificationBus('redis://localhost:6379');
    const handler = jest.fn();

    const subscriber = bus.startSubmissionNotificationSubscriber(handler);

    expect(subscriber).toBe(instances[0]);
    expect(instances[0].subscribe).toHaveBeenCalledWith('contest:submission-notify');

    const onMessage = instances[0].handlers.get('message');
    expect(onMessage).toBeDefined();
    onMessage?.('contest:submission-notify', JSON.stringify({
      userId: 'user-1',
      notification: { submissionId: 'sub-1' },
    }));

    expect(handler).toHaveBeenCalledWith('user-1', { submissionId: 'sub-1' });
  });

  it('falls back to in-process delivery when TCP Redis is unavailable', async () => {
    const { bus, redisCtor } = loadNotificationBus(undefined);
    const handler = jest.fn();

    expect(bus.startSubmissionNotificationSubscriber(handler)).toBeNull();
    await bus.publishSubmissionNotification('user-1', { submissionId: 'sub-1' });

    expect(redisCtor).not.toHaveBeenCalled();
    expect(handler).toHaveBeenCalledWith('user-1', { submissionId: 'sub-1' });
  });
});
