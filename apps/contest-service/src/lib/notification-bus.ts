import IORedis from 'ioredis';
import { env } from './env.js';

/**
 * Cross-instance submission notification bus.
 *
 * WebSocket connections live in a per-instance map, but the BullMQ worker that
 * finishes a job may run on a *different* Cloud Run instance. To push the
 * verdict over the user's socket regardless of which instance holds it, the
 * worker PUBLISHes the notification and every instance SUBSCRIBEs and delivers
 * to its own local socket (the instance that doesn't hold it simply no-ops).
 *
 * Uses the TCP queue Redis (QUEUE_REDIS_URL, rediss://) — Upstash supports
 * pub/sub over TCP. When no TCP URL is configured (local/in-process dev), it
 * degrades to direct same-process delivery. Result polling remains the
 * reliable fallback in all cases, so a pub/sub hiccup never loses a verdict.
 */

const CHANNEL = 'contest:submission-notify';

type NotificationHandler = (userId: string, notification: unknown) => void;

function isTcpRedisUrl(url?: string): boolean {
  return !!url && (url.startsWith('redis://') || url.startsWith('rediss://'));
}

const queueUrl = env.QUEUE_REDIS_URL;
const usePubSub = isTcpRedisUrl(queueUrl);

let publisher: IORedis | null = null;
let subscriber: IORedis | null = null;
let localHandler: NotificationHandler | null = null;

function getPublisher(): IORedis | null {
  if (!usePubSub || !queueUrl) return null;
  if (!publisher) {
    publisher = new IORedis(queueUrl, { maxRetriesPerRequest: null });
    publisher.on('error', (err) => console.error('[NotifyBus] publisher error:', err.message));
  }
  return publisher;
}

/**
 * Publish a submission notification for `userId`. In multi-instance mode this
 * fans out to all instances via Redis; in single-instance/dev mode it delivers
 * directly in-process.
 */
export async function publishSubmissionNotification(userId: string, notification: unknown): Promise<void> {
  if (usePubSub) {
    const pub = getPublisher();
    if (pub) {
      try {
        await pub.publish(CHANNEL, JSON.stringify({ userId, notification }));
        return;
      } catch (err) {
        console.error('[NotifyBus] publish failed, falling back to local delivery:', (err as Error).message);
      }
    }
  }
  // Single-instance / pub-sub unavailable: deliver locally if we can.
  localHandler?.(userId, notification);
}

/**
 * Start the subscriber. `handler(userId, notification)` is invoked on every
 * instance for each published message; it should deliver to the local socket
 * if present (and no-op otherwise). Returns the IORedis subscriber (or null in
 * in-process mode) so the caller can close it on shutdown.
 */
export function startSubmissionNotificationSubscriber(handler: NotificationHandler): IORedis | null {
  localHandler = handler;

  if (!usePubSub || !queueUrl) {
    console.log('[NotifyBus] No TCP queue Redis URL — using in-process notifications only');
    return null;
  }

  subscriber = new IORedis(queueUrl, { maxRetriesPerRequest: null });
  subscriber.on('error', (err) => console.error('[NotifyBus] subscriber error:', err.message));
  subscriber.on('message', (channel, message) => {
    if (channel !== CHANNEL) return;
    try {
      const parsed = JSON.parse(message) as { userId: string; notification: unknown };
      handler(parsed.userId, parsed.notification);
    } catch (err) {
      console.error('[NotifyBus] failed to handle message:', (err as Error).message);
    }
  });
  subscriber
    .subscribe(CHANNEL)
    .then(() => console.log(`[NotifyBus] Subscribed to ${CHANNEL} for cross-instance WS delivery`))
    .catch((err) => console.error('[NotifyBus] subscribe failed:', err.message));

  return subscriber;
}

export async function closeNotificationBus(): Promise<void> {
  try { await subscriber?.quit(); } catch { /* best-effort */ }
  try { await publisher?.quit(); } catch { /* best-effort */ }
  subscriber = null;
  publisher = null;
}
