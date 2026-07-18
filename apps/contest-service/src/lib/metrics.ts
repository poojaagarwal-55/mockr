import { monitorEventLoopDelay } from 'node:perf_hooks';
import { getQueueStats } from './queue.js';
import { judge0CircuitBreaker } from './circuit-breaker.js';
import { getActiveConnectionCount } from './websocket-gateway.js';
import { getJudge0ConcurrencyStats } from './judge0-concurrency.js';

type Judge0Operation = 'submit' | 'result';

interface Judge0FailureSnapshot {
  operation: Judge0Operation;
  statusCode: number | null;
  message: string;
  at: string;
}

interface Judge0Metrics {
  totalCalls: number;
  totalFailures: number;
  submitCalls: number;
  submitFailures: number;
  resultCalls: number;
  resultFailures: number;
  lastFailure: Judge0FailureSnapshot | null;
}

const eventLoopDelay = monitorEventLoopDelay({ resolution: 1 });
eventLoopDelay.enable();
let eventLoopWindowStartedAt = Date.now();

const judge0Metrics: Judge0Metrics = {
  totalCalls: 0,
  totalFailures: 0,
  submitCalls: 0,
  submitFailures: 0,
  resultCalls: 0,
  resultFailures: 0,
  lastFailure: null,
};

function nsToMs(value: number): number {
  if (!Number.isFinite(value) || value <= 0 || value > 1_000_000_000_000_000) return 0;
  return Number((value / 1_000_000).toFixed(2));
}

function eventLoopWindowSeconds(): number {
  return Number(((Date.now() - eventLoopWindowStartedAt) / 1000).toFixed(2));
}

export function resetEventLoopMetrics(): void {
  eventLoopDelay.reset();
  eventLoopWindowStartedAt = Date.now();
}

export function recordJudge0Call(operation: Judge0Operation): void {
  judge0Metrics.totalCalls++;
  if (operation === 'submit') {
    judge0Metrics.submitCalls++;
  } else {
    judge0Metrics.resultCalls++;
  }
}

export function recordJudge0Failure(
  operation: Judge0Operation,
  error: unknown,
  statusCode: number | null = null
): void {
  judge0Metrics.totalFailures++;
  if (operation === 'submit') {
    judge0Metrics.submitFailures++;
  } else {
    judge0Metrics.resultFailures++;
  }

  judge0Metrics.lastFailure = {
    operation,
    statusCode,
    message: error instanceof Error ? error.message : String(error),
    at: new Date().toISOString(),
  };
}

export async function getContestServiceMetrics() {
  const queue = await getQueueStats();
  const memory = process.memoryUsage();

  return {
    service: 'contest-service',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Number(process.uptime().toFixed(2)),
    queue,
    workers: {
      configuredConcurrency: queue.concurrency,
      activeJobs: queue.active,
      processorRegistered: queue.processorRegistered,
    },
    judge0: {
      ...judge0Metrics,
      concurrency: getJudge0ConcurrencyStats(),
      circuitBreaker: judge0CircuitBreaker.getStats(),
    },
    eventLoop: {
      windowSeconds: eventLoopWindowSeconds(),
      delayMs: {
        min: nsToMs(eventLoopDelay.min),
        max: nsToMs(eventLoopDelay.max),
        mean: nsToMs(eventLoopDelay.mean),
        stddev: nsToMs(eventLoopDelay.stddev),
        p50: nsToMs(eventLoopDelay.percentile(50)),
        p95: nsToMs(eventLoopDelay.percentile(95)),
        p99: nsToMs(eventLoopDelay.percentile(99)),
      },
    },
    process: {
      pid: process.pid,
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal,
      externalBytes: memory.external,
    },
    websocket: {
      activeConnections: getActiveConnectionCount(),
    },
  };
}
