import crypto from 'node:crypto';
import { WebSocket } from 'ws';

const BASE_URL = process.env.CONTEST_API_URL || 'http://127.0.0.1:3002';
const WS_URL = BASE_URL.replace(/^http/, 'ws');
const SECRET = process.env.LOAD_TEST_JWT_SECRET;
const CONTEST_ID = process.env.LOAD_TEST_CONTEST_ID || 'load-contest-1000';
const QUESTION_ID = process.env.LOAD_TEST_QUESTION_ID || 'load-q-1';
const USERS = Number(process.env.LOAD_TEST_USERS || '1000');
const CONCURRENCY = Number(process.env.LOAD_TEST_HTTP_CONCURRENCY || '100');
const OPEN_WEBSOCKETS = (process.env.LOAD_TEST_WEBSOCKETS || 'true') !== 'false';
const CODE = process.env.LOAD_TEST_CODE || 'int main(){return 0;}';

if (!SECRET) {
  throw new Error('LOAD_TEST_JWT_SECRET is required');
}

function base64Url(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function createToken(userId) {
  const payload = base64Url(JSON.stringify({
    sub: userId,
    email: `${userId}@load-test.local`,
    exp: Math.floor(Date.now() / 1000) + 60 * 60,
  }));
  const signature = base64Url(crypto.createHmac('sha256', SECRET).update(payload).digest());
  return `loadtest.${payload}.${signature}`;
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}

async function fetchJson(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, options);
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { response, body };
}

async function openSocket(token) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${WS_URL}/ws?token=${encodeURIComponent(token)}`);
    const timeout = setTimeout(() => {
      ws.terminate();
      resolve({ ok: false, ws: null });
    }, 5000);

    ws.once('message', () => {
      clearTimeout(timeout);
      resolve({ ok: true, ws });
    });
    ws.once('error', () => {
      clearTimeout(timeout);
      resolve({ ok: false, ws: null });
    });
    ws.once('close', () => {
      clearTimeout(timeout);
    });
  });
}

async function waitForCompletions(expected, deadlineMs) {
  const deadline = Date.now() + deadlineMs;
  let last = null;

  while (Date.now() < deadline) {
    const { response, body } = await fetchJson('/metrics');
    if (response.ok) {
      last = body;
      const completed = body.queue?.completed ?? 0;
      const failed = body.queue?.failed ?? 0;
      if (completed + failed >= expected) {
        return body;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return last;
}

async function main() {
  const health = await fetchJson('/health');
  if (!health.response.ok) {
    throw new Error(`Service health check failed: ${health.response.status} ${JSON.stringify(health.body)}`);
  }

  const users = Array.from({ length: USERS }, (_, index) => {
    const userId = `load-user-${String(index + 1).padStart(4, '0')}`;
    return { userId, token: createToken(userId) };
  });

  const sockets = [];
  if (OPEN_WEBSOCKETS) {
    const startedAt = Date.now();
    const socketResults = await Promise.all(users.map((user) => openSocket(user.token)));
    for (const result of socketResults) {
      if (result.ok && result.ws) sockets.push(result.ws);
    }
    console.log(JSON.stringify({
      phase: 'websocket-open',
      requested: USERS,
      connected: sockets.length,
      durationMs: Date.now() - startedAt,
    }));
  }

  const durations = [];
  const statuses = new Map();
  let next = 0;
  const submissions = [];

  async function worker() {
    while (next < users.length) {
      const index = next++;
      const user = users[index];
      const idempotencyKey = crypto.randomUUID();
      const startedAt = performance.now();

      try {
        const { response, body } = await fetchJson('/execute/submit', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${user.token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            contestId: CONTEST_ID,
            questionId: QUESTION_ID,
            language: 'cpp',
            code: CODE,
            idempotencyKey,
          }),
        });

        durations.push(performance.now() - startedAt);
        statuses.set(response.status, (statuses.get(response.status) ?? 0) + 1);
        if (response.ok && body?.submissionId) {
          submissions.push(body.submissionId);
        } else {
          console.error(JSON.stringify({ phase: 'submit-error', status: response.status, body }));
        }
      } catch (error) {
        durations.push(performance.now() - startedAt);
        statuses.set('network_error', (statuses.get('network_error') ?? 0) + 1);
        console.error(JSON.stringify({ phase: 'network-error', message: error.message }));
      }
    }
  }

  const submitStartedAt = Date.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  const submitDurationMs = Date.now() - submitStartedAt;
  const postSubmitMetrics = await fetchJson('/metrics');
  const finalMetrics = await waitForCompletions(submissions.length, Number(process.env.LOAD_TEST_COMPLETION_TIMEOUT_MS || '180000'));

  for (const socket of sockets) {
    socket.close();
  }

  const result = {
    users: USERS,
    httpConcurrency: CONCURRENCY,
    websocketsRequested: OPEN_WEBSOCKETS ? USERS : 0,
    websocketsConnected: sockets.length,
    submissionsAccepted: submissions.length,
    statusCounts: Object.fromEntries(statuses),
    submitDurationMs,
    submitRps: Number((USERS / (submitDurationMs / 1000)).toFixed(2)),
    submitLatencyMs: {
      p50: Number(percentile(durations, 50).toFixed(2)),
      p95: Number(percentile(durations, 95).toFixed(2)),
      p99: Number(percentile(durations, 99).toFixed(2)),
      max: Number(Math.max(...durations).toFixed(2)),
    },
    postSubmitMetrics: postSubmitMetrics.body,
    finalMetrics,
  };

  console.log(JSON.stringify(result, null, 2));

  if (submissions.length !== USERS) {
    process.exitCode = 1;
  }
}

await main();
