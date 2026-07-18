import http from 'node:http';
import crypto from 'node:crypto';

const PORT = Number(process.env.MOCK_JUDGE0_PORT || '4010');
const LATENCY_MS = Number(process.env.MOCK_JUDGE0_LATENCY_MS || '25');
const tokens = new Map();

function decodeBase64(value) {
  if (!value) return '';
  return Buffer.from(value, 'base64').toString('utf-8');
}

function encodeBase64(value) {
  return Buffer.from(value ?? '').toString('base64');
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') {
      return sendJson(res, 200, { ok: true, tokens: tokens.size });
    }

    if (req.method === 'POST' && req.url?.startsWith('/submissions')) {
      const body = await readJson(req);
      const token = crypto.randomUUID();
      const stdin = decodeBase64(body.stdin);
      tokens.set(token, {
        stdout: encodeBase64(stdin),
        stderr: null,
        compile_output: null,
        message: null,
        time: (LATENCY_MS / 1000).toFixed(3),
        memory: 1024,
        status: { id: 3, description: 'Accepted' },
      });
      return sendJson(res, 201, { token });
    }

    const match = req.url?.match(/^\/submissions\/([^?]+)/);
    if (req.method === 'GET' && match) {
      const result = tokens.get(match[1]);
      if (!result) {
        return sendJson(res, 404, { error: 'token not found' });
      }
      await new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
      return sendJson(res, 200, result);
    }

    sendJson(res, 404, { error: 'not found' });
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock-judge0] listening on http://127.0.0.1:${PORT}`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
