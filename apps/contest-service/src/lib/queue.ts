import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { env } from './env.js';

/**
 * Submission Queue
 *
 * Production contest load must use BullMQ over a TCP Redis endpoint.
 * The existing Upstash REST client is intentionally not reused here because
 * BullMQ needs Redis blocking commands over a persistent TCP connection.
 */

export interface SubmissionJob {
  submissionId: string;
  userId: string;
  contestId: string;
  questionId: string;
  code: string;
  language: string;
  attemptNumber: number;
}

type JobProcessor = (job: SubmissionJob) => Promise<void>;
type QueueBackend = 'in-process' | 'bullmq';

interface QueueJob {
  id: string;
  data: SubmissionJob;
  attempts: number;
  createdAt: Date;
}

export interface QueueStats {
  backend: QueueBackend;
  queueName: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  total: number;
  concurrency: number;
  processorRegistered: boolean;
  stopped: boolean;
}

interface SubmissionQueueAdapter {
  process(concurrency: number, fn: JobProcessor): void;
  add(data: SubmissionJob, opts?: { jobId?: string }): Promise<QueueJob>;
  getStats(): Promise<QueueStats>;
  getWaitingCount(): Promise<number>;
  getActiveCount(): Promise<number>;
  getCompletedCount(): Promise<number>;
  getFailedCount(): Promise<number>;
  getDelayedCount(): Promise<number>;
  close(): Promise<void>;
}

interface QueueBackendSelection {
  requestedBackend: 'auto' | QueueBackend;
  queueRedisUrl?: string;
  nodeEnv: 'development' | 'production' | 'test';
}

const QUEUE_NAME = 'contest-submissions';

export function isRedisTcpUrl(value: string | undefined | null): boolean {
  if (!value) return false;

  try {
    const parsed = new URL(value);
    return parsed.protocol === 'redis:' || parsed.protocol === 'rediss:';
  } catch {
    return false;
  }
}

export function resolveQueueBackend(selection: QueueBackendSelection): QueueBackend {
  const { requestedBackend, queueRedisUrl, nodeEnv } = selection;
  const hasTcpRedis = isRedisTcpUrl(queueRedisUrl);

  if (queueRedisUrl && !hasTcpRedis) {
    throw new Error('QUEUE_REDIS_URL must use redis:// or rediss://. Do not use the Upstash REST HTTP URL for BullMQ.');
  }

  if (requestedBackend === 'bullmq') {
    if (!hasTcpRedis) {
      throw new Error('QUEUE_BACKEND=bullmq requires QUEUE_REDIS_URL to point at a TCP Redis endpoint.');
    }
    return 'bullmq';
  }

  if (requestedBackend === 'in-process') {
    if (nodeEnv === 'production') {
      throw new Error('QUEUE_BACKEND=in-process is not allowed in production contest-service.');
    }
    return 'in-process';
  }

  if (hasTcpRedis) {
    return 'bullmq';
  }

  if (nodeEnv === 'production') {
    throw new Error('Production contest-service requires QUEUE_REDIS_URL for a durable BullMQ submission queue.');
  }

  return 'in-process';
}

/**
 * Simple async FIFO queue with concurrency control and retry support.
 * Kept only for local development and tests where a TCP Redis is unavailable.
 */
class InProcessQueue implements SubmissionQueueAdapter {
  private waiting: QueueJob[] = [];
  private active = 0;
  private completed = 0;
  private failed = 0;
  private maxConcurrency: number;
  private readonly maxAttempts: number;
  private readonly retryBaseDelayMs: number;
  private processor: JobProcessor | null = null;
  private stopped = false;

  constructor(maxConcurrency: number, maxAttempts: number, retryBaseDelayMs: number) {
    this.maxConcurrency = maxConcurrency;
    this.maxAttempts = maxAttempts;
    this.retryBaseDelayMs = retryBaseDelayMs;
  }

  process(concurrency: number, fn: JobProcessor): void {
    this.maxConcurrency = concurrency;
    this.processor = fn;
    console.log(`[Queue] In-process processor registered, concurrency=${concurrency}`);
    this.drain();
  }

  async add(data: SubmissionJob, opts?: { jobId?: string }): Promise<QueueJob> {
    const job: QueueJob = {
      id: opts?.jobId ?? data.submissionId,
      data,
      attempts: 0,
      createdAt: new Date(),
    };
    this.waiting.push(job);
    console.log(`[Queue] Job ${job.id} enqueued in memory (waiting=${this.waiting.length})`);
    setImmediate(() => this.drain());
    return job;
  }

  async getStats(): Promise<QueueStats> {
    return {
      backend: 'in-process',
      queueName: QUEUE_NAME,
      waiting: this.waiting.length,
      active: this.active,
      completed: this.completed,
      failed: this.failed,
      delayed: 0,
      total: this.waiting.length + this.active + this.completed + this.failed,
      concurrency: this.maxConcurrency,
      processorRegistered: this.processor !== null,
      stopped: this.stopped,
    };
  }

  async getWaitingCount(): Promise<number> { return this.waiting.length; }
  async getActiveCount(): Promise<number> { return this.active; }
  async getCompletedCount(): Promise<number> { return this.completed; }
  async getFailedCount(): Promise<number> { return this.failed; }
  async getDelayedCount(): Promise<number> { return 0; }

  async close(): Promise<void> {
    if (this.stopped) return;

    this.stopped = true;
    console.log('[Queue] Shutting down in-process queue');

    const deadline = Date.now() + 10_000;
    while (this.active > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    console.log('[Queue] In-process queue shutdown complete');
  }

  private drain(): void {
    if (this.stopped || !this.processor) return;

    while (this.active < this.maxConcurrency && this.waiting.length > 0) {
      const job = this.waiting.shift()!;
      this.runJob(job);
    }
  }

  private async runJob(job: QueueJob): Promise<void> {
    if (!this.processor) return;

    this.active++;
    job.attempts++;
    console.log(`[Queue] Job ${job.id} starting (attempt ${job.attempts})`);

    let retrying = false;
    try {
      await this.processor(job.data);
      this.completed++;
      console.log(`[Queue] Job ${job.id} completed`);
    } catch (err: any) {
      console.error(`[Queue] Job ${job.id} failed (attempt ${job.attempts}):`, err?.message ?? err);

      if (job.attempts < this.maxAttempts) {
        const delay = this.retryBaseDelayMs * Math.pow(2, job.attempts - 1);
        console.log(`[Queue] Retrying job ${job.id} in ${delay}ms`);
        retrying = true;
        this.active--;
        setTimeout(() => {
          this.waiting.unshift(job);
          this.drain();
        }, delay);
      } else {
        this.failed++;
        console.error(`[Queue] Job ${job.id} exhausted retries`);
      }
    } finally {
      if (!retrying) {
        this.active--;
        this.drain();
      }
    }
  }
}

class BullMqSubmissionQueue implements SubmissionQueueAdapter {
  private readonly queue: Queue<SubmissionJob>;
  private readonly queueConnection: IORedis;
  private workerConnection: IORedis | null = null;
  private worker: Worker<SubmissionJob> | null = null;
  private concurrency: number;
  private stopped = false;

  constructor(
    private readonly queueRedisUrl: string,
    concurrency: number,
    private readonly maxAttempts: number,
    private readonly retryBaseDelayMs: number
  ) {
    this.concurrency = concurrency;
    this.queueConnection = this.createConnection();
    this.queue = new Queue<SubmissionJob>(QUEUE_NAME, {
      connection: this.queueConnection,
      defaultJobOptions: this.defaultJobOptions(),
    });
    console.log(`[Queue] BullMQ submission queue initialised (${QUEUE_NAME})`);
  }

  process(concurrency: number, fn: JobProcessor): void {
    this.concurrency = concurrency;

    if (this.worker) {
      console.warn('[Queue] BullMQ processor already registered; ignoring duplicate registration');
      return;
    }

    this.workerConnection = this.createConnection();
    this.worker = new Worker<SubmissionJob>(
      QUEUE_NAME,
      async (job) => {
        await fn(job.data);
      },
      {
        connection: this.workerConnection,
        concurrency,
        drainDelay: env.BULLMQ_DRAIN_DELAY_SECONDS,
        stalledInterval: env.BULLMQ_STALLED_INTERVAL_MS,
        // A batched submission (single probe + batch poll, each with Judge0
        // polling) can run well past BullMQ's 30s default lock. If the lock
        // expired the job would be treated as stalled and re-run — wasting
        // Judge0 calls and (without the idempotency guard) double-scoring.
        // Give long-but-healthy jobs ample headroom, and tolerate a couple of
        // genuine stalls before giving up.
        lockDuration: env.BULLMQ_LOCK_DURATION_MS,
        maxStalledCount: env.BULLMQ_MAX_STALLED_COUNT,
      }
    );

    this.worker.on('completed', (job) => {
      console.log(`[Queue] BullMQ job ${job.id} completed`);
    });
    this.worker.on('failed', (job, err) => {
      console.error(`[Queue] BullMQ job ${job?.id ?? 'unknown'} failed:`, err.message);
    });
    this.worker.on('error', (err) => {
      console.error('[Queue] BullMQ worker error:', err.message);
    });

    console.log(`[Queue] BullMQ processor registered, concurrency=${concurrency}`);
  }

  async add(data: SubmissionJob, opts?: { jobId?: string }): Promise<QueueJob> {
    const job = await this.queue.add('submission', data, {
      ...this.defaultJobOptions(),
      jobId: opts?.jobId ?? data.submissionId,
    });

    console.log(`[Queue] BullMQ job ${job.id} enqueued`);
    return {
      id: String(job.id),
      data: job.data,
      attempts: job.attemptsMade,
      createdAt: new Date(job.timestamp),
    };
  }

  async getStats(): Promise<QueueStats> {
    const counts = await this.queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
    const waiting = counts.waiting ?? 0;
    const active = counts.active ?? 0;
    const completed = counts.completed ?? 0;
    const failed = counts.failed ?? 0;
    const delayed = counts.delayed ?? 0;

    return {
      backend: 'bullmq',
      queueName: QUEUE_NAME,
      waiting,
      active,
      completed,
      failed,
      delayed,
      total: waiting + active + completed + failed + delayed,
      concurrency: this.concurrency,
      processorRegistered: this.worker !== null,
      stopped: this.stopped,
    };
  }

  async getWaitingCount(): Promise<number> { return (await this.getStats()).waiting; }
  async getActiveCount(): Promise<number> { return (await this.getStats()).active; }
  async getCompletedCount(): Promise<number> { return (await this.getStats()).completed; }
  async getFailedCount(): Promise<number> { return (await this.getStats()).failed; }
  async getDelayedCount(): Promise<number> { return (await this.getStats()).delayed; }

  async close(): Promise<void> {
    if (this.stopped) return;

    this.stopped = true;
    console.log('[Queue] Shutting down BullMQ queue');

    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }

    await this.queue.close();
    this.queueConnection.disconnect();
    this.workerConnection?.disconnect();
    this.workerConnection = null;
    console.log('[Queue] BullMQ queue shutdown complete');
  }

  private createConnection(): IORedis {
    return new IORedis(this.queueRedisUrl, {
      maxRetriesPerRequest: null,
    });
  }

  private defaultJobOptions() {
    return {
      attempts: this.maxAttempts,
      backoff: {
        type: 'exponential',
        delay: this.retryBaseDelayMs,
      },
      removeOnComplete: {
        age: 60 * 60,
        count: 10_000,
      },
      removeOnFail: {
        age: 24 * 60 * 60,
        count: 20_000,
      },
    };
  }
}

function createSubmissionQueue(): SubmissionQueueAdapter {
  const backend = resolveQueueBackend({
    requestedBackend: env.QUEUE_BACKEND,
    queueRedisUrl: env.QUEUE_REDIS_URL,
    nodeEnv: env.NODE_ENV,
  });

  if (backend === 'bullmq') {
    return new BullMqSubmissionQueue(
      env.QUEUE_REDIS_URL!,
      env.QUEUE_CONCURRENCY,
      env.QUEUE_MAX_ATTEMPTS,
      env.QUEUE_RETRY_BASE_DELAY_MS
    );
  }

  console.warn('[Queue] Using in-process queue. This is for development/tests only and is not horizontally safe.');
  return new InProcessQueue(
    env.QUEUE_CONCURRENCY,
    env.QUEUE_MAX_ATTEMPTS,
    env.QUEUE_RETRY_BASE_DELAY_MS
  );
}

export const submissionQueue: SubmissionQueueAdapter = createSubmissionQueue();

export async function enqueueSubmission(data: SubmissionJob): Promise<QueueJob> {
  return submissionQueue.add(data, { jobId: data.submissionId });
}

export async function getQueueStats(): Promise<QueueStats> {
  return submissionQueue.getStats();
}

export async function closeQueue(): Promise<void> {
  await submissionQueue.close();
}
