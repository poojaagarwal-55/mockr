import fs from 'node:fs';
import { performance } from 'node:perf_hooks';

const DEFAULT_ENV_FILES = ['.env', 'apps/contest-service/.env', 'apps/api/.env'];

function stripQuotes(value) {
  const trimmed = String(value ?? '').trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] === undefined) {
      process.env[key] = stripQuotes(rawValue);
    }
  }
}

for (const filePath of (process.env.JUDGE0_ENV_FILES || DEFAULT_ENV_FILES.join(',')).split(',')) {
  loadEnvFile(filePath.trim());
}

const JUDGE0_URL = stripQuotes(
  process.env.JUDGE0_CAPACITY_URL ||
  process.env.JUDGE0_API_URL ||
  process.env.JUDGE0_CE_URL ||
  ''
).replace(/\/+$/, '');
const JUDGE0_KEY = stripQuotes(process.env.JUDGE0_CAPACITY_KEY || process.env.JUDGE0_API_KEY || '');
const TOTAL = Number(process.env.JUDGE0_CAPACITY_TOTAL || '20000');
const CONCURRENCY = Number(process.env.JUDGE0_CAPACITY_CONCURRENCY || '200');
const POLL_CONCURRENCY = Number(process.env.JUDGE0_CAPACITY_POLL_CONCURRENCY || String(CONCURRENCY));
const POLL_INTERVAL_MS = Number(process.env.JUDGE0_CAPACITY_POLL_INTERVAL_MS || '1000');
const POLL_TIMEOUT_MS = Number(process.env.JUDGE0_CAPACITY_POLL_TIMEOUT_MS || '300000');
const PROGRESS_INTERVAL_MS = Number(process.env.JUDGE0_CAPACITY_PROGRESS_INTERVAL_MS || '10000');
const SAFE_SHARED_TOTAL = Number(process.env.JUDGE0_SHARED_SAFE_TOTAL || '5');
const ALLOW_SHARED_LOAD = process.env.JUDGE0_ALLOW_SHARED_LOAD === 'true';
const LANGUAGE_ID = Number(process.env.JUDGE0_CAPACITY_LANGUAGE_ID || '54');
const CPU_TIME_LIMIT = Number(process.env.JUDGE0_CAPACITY_CPU_TIME_LIMIT || '2');
const MEMORY_LIMIT = Number(process.env.JUDGE0_CAPACITY_MEMORY_LIMIT || '262144');
const ENABLE_PER_PROCESS_AND_THREAD_TIME_LIMIT = optionalBoolean(
  process.env.JUDGE0_CAPACITY_ENABLE_PER_PROCESS_AND_THREAD_TIME_LIMIT
);
const ENABLE_PER_PROCESS_AND_THREAD_MEMORY_LIMIT = optionalBoolean(
  process.env.JUDGE0_CAPACITY_ENABLE_PER_PROCESS_AND_THREAD_MEMORY_LIMIT
);
const FIELDS = 'token,status,stdout,stderr,compile_output,message,time,memory';

const CPP_ECHO_CODE = String.raw`#include <bits/stdc++.h>
using namespace std;
int main() {
  ios::sync_with_stdio(false);
  cin.tie(nullptr);
  string s;
  if (getline(cin, s)) cout << s << "\n";
  return 0;
}`;

const SOURCE_CODE = process.env.JUDGE0_CAPACITY_SOURCE_CODE || CPP_ECHO_CODE;

if (!JUDGE0_URL) {
  throw new Error('JUDGE0_CAPACITY_URL or JUDGE0_API_URL is required');
}

const judge0Host = new URL(JUDGE0_URL).hostname;
const isSharedJudge0 =
  judge0Host.includes('rapidapi.com') ||
  judge0Host === 'ce.judge0.com' ||
  judge0Host === 'api.judge0.com' ||
  judge0Host === 'judge0.com';

if (isSharedJudge0 && !ALLOW_SHARED_LOAD && TOTAL > SAFE_SHARED_TOTAL) {
  console.error(JSON.stringify({
    ok: false,
    refused: true,
    reason: 'Refusing to run a high-volume load test against a shared Judge0 endpoint. Point JUDGE0_CAPACITY_URL at a self-hosted/staging Judge0, or set JUDGE0_ALLOW_SHARED_LOAD=true intentionally.',
    targetHost: judge0Host,
    requestedTotal: TOTAL,
    safeSharedTotal: SAFE_SHARED_TOTAL,
  }, null, 2));
  process.exit(2);
}

function base64(value) {
  return Buffer.from(String(value ?? ''), 'utf8').toString('base64');
}

function optionalBoolean(value) {
  if (value === undefined) return undefined;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}

function buildHeaders() {
  const headers = {
    'content-type': 'application/json',
  };

  if (JUDGE0_KEY) {
    if (judge0Host.includes('rapidapi.com')) {
      headers['X-RapidAPI-Key'] = JUDGE0_KEY;
      headers['X-RapidAPI-Host'] = process.env.JUDGE0_HOST || process.env.JUDGE0_CE_HOST || judge0Host;
    } else {
      const authHeader = process.env.JUDGE0_AUTH_HEADER || 'X-Auth-Token';
      headers[authHeader] = JUDGE0_KEY;
    }
  }

  return headers;
}

const headers = buildHeaders();

async function fetchJson(url, options = {}) {
  const startedAt = performance.now();
  const response = await fetch(url, options);
  const durationMs = performance.now() - startedAt;
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { response, body, durationMs };
}

async function runPool(count, concurrency, fn) {
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, count) }, async () => {
    while (next < count) {
      const index = next++;
      await fn(index);
    }
  });
  await Promise.all(workers);
}

function createSubmissionPayload(index) {
  const input = `judge0-load-${index + 1}`;
  const payload = {
    source_code: base64(SOURCE_CODE),
    language_id: LANGUAGE_ID,
    stdin: base64(input),
    expected_output: base64(`${input}\n`),
    cpu_time_limit: CPU_TIME_LIMIT,
    memory_limit: MEMORY_LIMIT,
  };

  if (ENABLE_PER_PROCESS_AND_THREAD_TIME_LIMIT !== undefined) {
    payload.enable_per_process_and_thread_time_limit = ENABLE_PER_PROCESS_AND_THREAD_TIME_LIMIT;
  }

  if (ENABLE_PER_PROCESS_AND_THREAD_MEMORY_LIMIT !== undefined) {
    payload.enable_per_process_and_thread_memory_limit = ENABLE_PER_PROCESS_AND_THREAD_MEMORY_LIMIT;
  }

  return payload;
}

async function submitAll() {
  const submitDurations = [];
  const statusCounts = new Map();
  const tokens = [];
  const errors = [];
  const startedAt = Date.now();

  await runPool(TOTAL, CONCURRENCY, async (index) => {
    try {
      const { response, body, durationMs } = await fetchJson(
        `${JUDGE0_URL}/submissions?base64_encoded=true&wait=false`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(createSubmissionPayload(index)),
        }
      );

      submitDurations.push(durationMs);
      statusCounts.set(response.status, (statusCounts.get(response.status) ?? 0) + 1);
      if (response.ok && body?.token) {
        tokens[index] = body.token;
      } else {
        errors.push({
          phase: 'submit',
          index,
          status: response.status,
          body,
        });
      }
    } catch (error) {
      statusCounts.set('network_error', (statusCounts.get('network_error') ?? 0) + 1);
      errors.push({
        phase: 'submit',
        index,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return {
    tokens: tokens.filter(Boolean),
    errors,
    submit: {
      durationMs: Date.now() - startedAt,
      statusCounts: Object.fromEntries(statusCounts),
      latencyMs: {
        p50: Number(percentile(submitDurations, 50).toFixed(2)),
        p95: Number(percentile(submitDurations, 95).toFixed(2)),
        p99: Number(percentile(submitDurations, 99).toFixed(2)),
        max: Number(Math.max(0, ...submitDurations).toFixed(2)),
      },
    },
  };
}

function isTerminalStatus(statusId) {
  return Number(statusId) > 2;
}

async function pollAll(tokens) {
  const resultDurations = [];
  const timeToVerdictDurations = [];
  const statusCounts = new Map();
  const terminalStatusCounts = new Map();
  const errors = [];
  const completedAt = new Array(tokens.length).fill(null);
  let completedCount = 0;
  let lastProgressAt = Date.now();
  const startedAtMs = Date.now();
  const deadline = startedAtMs + POLL_TIMEOUT_MS;

  async function pollToken(token, index) {
    while (Date.now() < deadline) {
      try {
        const { response, body, durationMs } = await fetchJson(
          `${JUDGE0_URL}/submissions/${encodeURIComponent(token)}?base64_encoded=true&fields=${encodeURIComponent(FIELDS)}`,
          { headers }
        );

        resultDurations.push(durationMs);
        statusCounts.set(response.status, (statusCounts.get(response.status) ?? 0) + 1);
        if (!response.ok) {
          errors.push({
            phase: 'poll',
            index,
            token,
            status: response.status,
            body,
          });
          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
          continue;
        }

        const statusId = body?.status?.id;
        if (isTerminalStatus(statusId)) {
          terminalStatusCounts.set(statusId, (terminalStatusCounts.get(statusId) ?? 0) + 1);
          if (Number(statusId) !== 3) {
            errors.push({
              phase: 'terminal-status',
              index,
              token,
              statusId,
              description: body?.status?.description,
              message: body?.message,
            });
          }
          completedAt[index] = Date.now();
          timeToVerdictDurations.push(completedAt[index] - startedAtMs);
          completedCount++;
          const now = Date.now();
          if (now - lastProgressAt >= PROGRESS_INTERVAL_MS || completedCount === tokens.length) {
            lastProgressAt = now;
            const accepted = terminalStatusCounts.get(3) ?? 0;
            console.error(JSON.stringify({
              phase: 'poll-progress',
              completed: completedCount,
              accepted,
              failedTerminal: completedCount - accepted,
              total: tokens.length,
              elapsedMs: now - startedAtMs,
            }));
          }
          return;
        }
      } catch (error) {
        errors.push({
          phase: 'poll',
          index,
          token,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }

    errors.push({
      phase: 'poll-timeout',
      index,
      token,
      timeoutMs: POLL_TIMEOUT_MS,
    });
  }

  await runPool(tokens.length, POLL_CONCURRENCY, async (index) => {
    await pollToken(tokens[index], index);
  });

  const completed = completedAt.filter(Boolean).length;
  const accepted = terminalStatusCounts.get(3) ?? 0;
  return {
    errors,
    poll: {
      durationMs: Date.now() - startedAtMs,
      completed,
      accepted,
      failedTerminal: completed - accepted,
      timedOut: tokens.length - completed,
      httpStatusCounts: Object.fromEntries(statusCounts),
      terminalStatusCounts: Object.fromEntries(terminalStatusCounts),
      requestLatencyMs: {
        p50: Number(percentile(resultDurations, 50).toFixed(2)),
        p95: Number(percentile(resultDurations, 95).toFixed(2)),
        p99: Number(percentile(resultDurations, 99).toFixed(2)),
        max: Number(Math.max(0, ...resultDurations).toFixed(2)),
      },
      timeToVerdictMs: {
        p50: Number(percentile(timeToVerdictDurations, 50).toFixed(2)),
        p95: Number(percentile(timeToVerdictDurations, 95).toFixed(2)),
        p99: Number(percentile(timeToVerdictDurations, 99).toFixed(2)),
        max: Number(Math.max(0, ...timeToVerdictDurations).toFixed(2)),
      },
    },
  };
}

async function main() {
  const startedAt = Date.now();
  const metadata = {
    targetHost: judge0Host,
    targetUrl: JUDGE0_URL.replace(/\/\/([^:@/]+):([^@/]+)@/, '//<redacted>:<redacted>@'),
    sharedEndpoint: isSharedJudge0,
    total: TOTAL,
    concurrency: CONCURRENCY,
    pollConcurrency: POLL_CONCURRENCY,
    progressIntervalMs: PROGRESS_INTERVAL_MS,
    languageId: LANGUAGE_ID,
    cpuTimeLimit: CPU_TIME_LIMIT,
    memoryLimit: MEMORY_LIMIT,
    enablePerProcessAndThreadTimeLimit: ENABLE_PER_PROCESS_AND_THREAD_TIME_LIMIT,
    enablePerProcessAndThreadMemoryLimit: ENABLE_PER_PROCESS_AND_THREAD_MEMORY_LIMIT,
  };

  console.error(JSON.stringify({ phase: 'start', ...metadata }));

  const submitResult = await submitAll();
  console.error(JSON.stringify({
    phase: 'submitted',
    acceptedTokens: submitResult.tokens.length,
    submit: submitResult.submit,
    submitErrors: submitResult.errors.slice(0, 5),
  }));

  const pollResult = await pollAll(submitResult.tokens);
  const result = {
    ok:
      submitResult.tokens.length === TOTAL &&
      pollResult.poll.completed === submitResult.tokens.length &&
      pollResult.poll.accepted === submitResult.tokens.length &&
      submitResult.errors.length === 0 &&
      pollResult.errors.length === 0,
    metadata,
    totalDurationMs: Date.now() - startedAt,
    submit: submitResult.submit,
    poll: pollResult.poll,
    errors: [...submitResult.errors, ...pollResult.errors].slice(0, 25),
  };

  console.log(JSON.stringify(result, null, 2));

  if (!result.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
