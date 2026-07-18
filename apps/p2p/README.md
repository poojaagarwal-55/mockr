# @interviewforge/p2p

The peer-to-peer interview backend: a Fastify + socket.io service that handles
live matchmaking, the interview room (turns, timer, shared editor, WebRTC
signalling), and feedback/rating updates. It runs as its **own microservice** so
it can scale independently of the main API.

## Runtime

- HTTP/WebSocket server on `P2P_PORT` (default `3004`; `8080` in Cloud Run).
- Health check: `GET /health`.
- Socket.io path: `/p2p/socket.io`.
- Shared state (matchmaking queues, lobby presence, runtime session state, rate
  limits, locks) lives in **Redis** (`REDIS_URL`).

## Scaling

**Default (free/small Redis tier): a single instance.** A single Cloud Run
instance handles many concurrent WebSockets (`--concurrency 250`), and keeping
to one instance avoids the socket.io Redis adapter's per-emit `PUBLISH` traffic
— which matters because the adapter publishes on *every* room emit (including
frequent editor syncs) and would burn through a small Redis command quota. The
orchestrator poll interval is also raised (`P2P_ORCHESTRATOR_INTERVAL_MS=5000`)
to conserve commands.

**Scaling horizontally later** (on a Redis tier sized for the volume):

1. Set `P2P_REDIS_ADAPTER=1` — attaches the socket.io Redis adapter so
   `io.to(room).emit(...)` reaches sockets on any instance.
2. Raise `--max-instances` (and optionally lower `P2P_ORCHESTRATOR_INTERVAL_MS`
   back toward `2000` for snappier matching).

This is safe because matchmaking is already **single-runner**: the orchestrator
cycle acquires a Redis lock (`acquireOrchestratorLock`) and bails if another
instance holds it, and session activation uses its own per-session lock. Cloud
Run `--session-affinity` pins each WebSocket to its instance for the connection.

Local dev: set `P2P_ALLOW_INMEMORY_REDIS=true` to run without Redis (single
instance, no adapter).

## Environment

| Var | Source (Cloud Run secret) | Notes |
| --- | --- | --- |
| `DATABASE_URL` | `database-url` | required — Prisma/Postgres (matchmaking, sessions, feedback) |
| `DIRECT_URL` | `direct-url` | Prisma direct connection (datasource pairs with DATABASE_URL) |
| `NEXT_PUBLIC_SUPABASE_URL` | `next-public-supabase-url` | required (socket auth) |
| `SUPABASE_SERVICE_ROLE_KEY` | `supabase-service-role-key` | required (socket auth) |
| `REDIS_URL` | `p2p-redis-url` | required in prod; a dedicated Upstash `rediss://…upstash.io` endpoint for p2p (ioredis + pub/sub), isolated from the queue/contest Redis. NOTE: the shared `redis-url` secret is a `localhost` placeholder — do not use it. |
| `P2P_ORCHESTRATOR_INTERVAL_MS` | env (default `2000`) | matchmaking poll cadence; `5000` in prod to conserve free-tier Redis commands |
| `P2P_REDIS_ADAPTER` | env (default off) | set `1` only when running >1 instance (enables the socket.io Redis adapter) |
| `MONGODB_URI` | `mongodb-uri` | DSA question bank |
| `FRONTEND_URL` | `frontend-url` | the **only** allowed browser origin in prod (CORS) — set to the main site, e.g. `https://practers.com` |
| `NEXT_PUBLIC_APP_URL` | `frontend-url` | base for invite share links |
| `P2P_PORT` / `P2P_HOST` | env | `8080` / `0.0.0.0` in Cloud Run |

## Deploy (Google Cloud Run, project `practers`, region `asia-south1`)

Targeted (this service only):

```bash
gcloud builds submit --config cloudbuild.p2p.yaml .
```

It is also wired into the root `cloudbuild.yaml` alongside the other services.

## Frontend wiring (Vercel)

The web app stays on the main Vercel project (`practers.com`). Point it at this
service by setting, in the Vercel project env:

```
NEXT_PUBLIC_P2P_URL = http://localhost:3004
# Production: https://<p2p-service Cloud Run URL>
```

The browser then connects to `${NEXT_PUBLIC_P2P_URL}/p2p/socket.io`. Ensure the
`frontend-url` secret equals the site origin so socket.io CORS accepts it.
