# Contest Hardening — Implementation Log

> ## ⚠️ DECISION UPDATE (9 Jul 2026) — "Contest Mode" feature-shutdown was REVERTED
>
> After review with the lead engineer, several premises behind the aggressive "Contest Mode" were corrected:
> - **The prod DB already uses a connection pooler on a paid tier** — so connection exhaustion is NOT the problem (my audit *inferred* direct-5432 from the committed `.env` and flagged it as unverified; it's verified fine).
> - **The contest runs as its own separate Cloud Run service** — AI interviews / billing / resume / payments run on the *api* service, a different machine. Disabling them does **not** free capacity for the contest. The only meaningfully shared resources are the **DB** and **Supabase auth**.
> - **The last outage was a GCP quota being reached** (GCP was rejecting requests at the edge) — an ops/config issue, not an architectural one. It does not prove the app can't handle 150 users.
> - **Globally disabling optional features during every contest hurts non-participants** and is bad for a multi-tenant platform that will run frequent contests.
>
> **Action taken:** all the feature-*disabling* changes were **reverted** and the Contest-Mode flag infrastructure **deleted**. Only the changes that **reduce shared-DB/auth load** or **improve reliability** (with no feature shutdown) were **kept**. All four services type-check clean after the revert.
>
> **KEPT (efficiency + reliability, no feature shutdown):**
> - My Rank / leaderboard: **built once on admin action, read from snapshot** (removes the per-person full DB scan) — Fix 10
> - Contest-page **poll jitter** (de-syncs the 15s cohort spike) — Fix 15
> - **Reuse verified login for 60s on the submit WebSocket** (cuts shared Supabase-auth calls) — Fix 14
> - **Shallow `/health` + `/ready`** (stops Cloud Run killing busy instances) — Fix 07
> - **Mongo no-crash** (no boot crash-loop) — Fix 11
> - **Single graceful shutdown drain** on all services (no dropped in-flight submissions) — Fix 12/13
> - **Integrity-event payload cap** (no jsonb bloat) — Fix 18
> - **react-query:** `refetchOnReconnect:false` + no dashboard focus-refetch (fewer synchronized refetches) — Fix 05
>
> **REVERTED (feature shutdown tied to Contest Mode):** the flag + readers (01/02), billing WS/poll off (03), payment-cron pause (04), p2p orchestrator pause (06), AI-interview 503 (08), peer-landing poll gate (09), nav hiding (16), AI-tutor/resume 503 (17).
>
> **Better direction for the real shared-DB concern (recommended, not yet done):** make the noisy features *permanently efficient* instead of pausing them during contests — e.g. a **leader-lock so the 12 payment crons run once, not ×N instances**, and **skip the p2p matchmaker's DB passes when nothing is pending**. These reduce shared-DB load at all times and scale to 5k–10k users, without disabling anything.
>
> **Real next steps (ops/config):** confirm & raise the specific **GCP quota** that was hit; rotate the **committed secrets in `apps/web/.env`**; keep the KEPT fixes above.

---

**Original goal (kept for record):** make the platform survive synchronized contest traffic by putting the *contest* first. During a contest, only the 10 mission-critical systems must stay fast; everything optional is disabled, delayed, cached, or degraded. *(Superseded by the decision update above — feature-shutdown reverted; efficiency/reliability fixes kept.)*

**Doctrine (applied to every issue, in order):** disable → delay → cache → poll-less → eventually-consistent → degrade → background-queue → optimize code → add infra. Always prefer *reducing* work over *optimizing* work.

**Two operating modes:**
- **Normal Mode** — everything works (AI, payments, interviews, resume, analytics, billing).
- **Contest Mode** — auto-activates ~15 min before a contest and deactivates when it ends; only contest-critical systems stay active; everything else shuts down / pauses / caches / degrades.

---

## The 10 mission-critical systems (never degrade)
Login · Registration · Contest Entry · Timer · Question Loading · Code Submission · Judge Pipeline · Contest WebSocket · Saving Progress · Final Scoring.

## Contest Mode design (summary)

| Section | Decision |
|---|---|
| **Disable** | AI Interview · Peer/Expert Interview · Resume/Tutor AI · Billing WebSocket · Payments page/auto-capture · Recommendations · heavy Analytics · Email/SMS (queue) · non-essential crons |
| **Degrade** | My Rank → hidden until end · Leaderboard → cached/hidden-live · Billing → cached · history/stats/feed → cached or off |
| **Polling** | contest polls 15s→30s + jitter · billing 5s poll → off · dashboard focus-refetch → off · `refetchOnReconnect` → off · verdict 2s poll → keep |
| **Background jobs** | pause 12 payment crons + streak jobs · keep state-manager + submission worker + scoring · email/SMS → queue |
| **Heavy APIs** | `/my-rank` full scan → hidden · leaderboard → cached · AI/interview endpoints → 503 during contest |
| **Infra (only necessary)** | Postgres pooler · local JWT verify · shallow health · worker split · SIGTERM drain |

## Phased rollout
1. **Phase 1 — Contest Mode:** flag + disable/degrade optional systems (config-only). ← in progress
2. **Phase 2 — Platform killers:** pooler, JWT verify, health, worker split, SIGTERM.
3. **Phase 3 — Request reduction:** polling, my-rank/leaderboard, retry storms.
4. **Phase 4 — Performance:** indexes, caching, query optimization.
5. **Phase 5 — Observability:** metrics, tracing, alerts, logging.

---

# Fix log

Each entry: what's affected · approaches considered · approach used · effect · system improvement · verification · risk/rollback.

---

## Fix 01 — Contest Mode flag foundation (backend source of truth)
**Phase 1 · Status: DONE**

**Issue.** The platform had no way to know "a contest is happening now," so it couldn't shed load automatically. There were no feature flags or kill-switches anywhere.

**Affects.** Whole platform — this is the switch every later fix keys off.

**Category.** Mission-critical enabler.

**Approaches considered.**
1. Per-service env var (`CONTEST_MODE=true`) — simplest but needs a redeploy to toggle; easy to forget to turn off.
2. Manual admin toggle in Redis — no redeploy, but a human must remember.
3. **Auto-derive from the contest schedule** (chosen) — the contest-state-manager already knows which contests are ACTIVE; compute the flag from that, with a manual override for emergencies.

**Approach used.** New `apps/contest-service/src/lib/contest-mode.ts`:
- `isContestModeActive()` — O(1) in-memory check, safe on the hot path.
- `refreshContestMode()` — recomputes the flag from `contest.count` (ACTIVE now, or UPCOMING within a 15-min pre-window) every state-manager tick (~60s) and on boot; mirrors to Redis key `contest:mode:active`.
- Override env: `CONTEST_MODE=on|off|auto` (default `auto`), `CONTEST_MODE_PREWINDOW_MINUTES` (default 15).
- Public `GET /contest-mode` endpoint for the web app + other services.

**Effect / improvement.** Contest Mode now turns on automatically before a contest and off after, with no redeploy and no chance of forgetting. Fail-safe: a DB error keeps the last value and never *forces* contest mode on, so a blip can't disable optional features platform-wide.

**Verification.** `tsc --noEmit` clean. Purely additive; nothing consumes the flag yet, so zero behavior change. Manual test: `GET /contest-mode`, or `CONTEST_MODE=on` to force.

**Risk / rollback.** None (read-only). Rollback: set `CONTEST_MODE=off`, or revert the file + the two small edits (state-manager import/call, index endpoint).

---

## Fix 02 — Contest Mode reader for the web app (frontend source of truth)
**Phase 1 · Status: DONE**

**Issue.** The frontend needs to know Contest Mode to hide/disable optional UI (AI, peer, resume, billing) and to stop optional polling/WebSockets. It couldn't, because the flag lived only in the contest-service process.

**Affects.** Frontend gating for every optional feature (enables Fixes 03+).

**Category.** Mission-critical enabler (frontend side).

**Approaches considered.**
1. `NEXT_PUBLIC_CONTEST_MODE` env — needs a redeploy to toggle; not compatible with auto-activation.
2. **Read the public `GET /contest-mode` endpoint** (chosen) — reflects the auto flag live, one shared fetch every 60s regardless of how many components use it.

**Approach used.** New `apps/web/src/hooks/use-contest-mode.ts`: a `useContestMode()` hook backed by a module-level cache + single in-flight fetch (deduped across all consumers) that refreshes every 60s. **Fail-safe default: `false`** — if the endpoint is unreachable, optional features stay ON (we never hide features just because we couldn't reach the flag).

**Effect / improvement.** Any component can now call `useContestMode()` to gate itself, at a cost of one cheap fetch per minute for the whole app.

**Verification.** `tsc --noEmit` clean. Additive; nothing consumes it yet → zero behavior change.

**Risk / rollback.** None (read-only, additive). Rollback: delete the hook.

---

## Fix 03 — Disable Billing WebSocket + fallback poll during Contest Mode
**Phase 1 · Status: DONE**

**Issue.** Every logged-in tab holds one `/ws/plans` billing WebSocket. On an API recycle they all drop and reconnect in lockstep (zero jitter), each re-authenticating against Supabase; when the WS can't connect they fall back to a fixed 5s poll of `/billing/snapshot`. #1 platform-wide reconnect-storm SPOF.

**Affects.** Whole platform (shared API) — a non-contest feature dragging the API down during a contest.

**Category.** Can Disable During Contest.

**Approach used.** `apps/web/src/hooks/use-billing.ts` — gate `connectWebSocket()`, `scheduleReconnect()`, `startFallbackPolling()` on `isContestModeCached()`. `use-contest-mode.ts` keeps the cache warm app-wide.

**Effect.** Zero billing WebSockets/polls to the API during a contest. Billing shows last cached plan; reconnects after the contest. Normal mode unchanged.

**Verification.** `tsc` clean (web). Only changes behavior in Contest Mode.

**Risk / rollback.** Low. Billing degrades to cached (by design). Rollback: remove the three guard blocks.

---

## Fix 04 — Pause the 12 payment background crons during Contest Mode
**Phase 1 · Status: DONE**

**Issue.** The API starts 12 `setInterval` payment jobs (webhook recovery every 30s, reconciliation, cleanup, zombie detection…) on **every** instance, no leader lock — ~10× parallel against shared Postgres/Razorpay, competing with the contest.

**Affects.** Contest indirectly (steals shared Postgres connections/CPU).

**Category.** Background Only → Pause.

**Approach used.** New `apps/api/src/lib/contest-mode.ts` (API reader, one COUNT/60s). In `payment-background-jobs.ts`, a single one-line change **shadows `setInterval`** inside the scheduler with a contest-aware version → every job skips its tick during a contest, **zero edits to the 12 job bodies**. Resumes after.

**Effect.** All payment background DB/Razorpay work stops during a contest; reconciles automatically afterward (jobs are idempotent).

**Verification.** `tsc` clean (api). Shadow preserves `.unref()` + each job's try/catch.

**Risk / rollback.** Low — jobs only skip ticks. Rollback: remove import + the shadow block.

---

## Fix 05 — Kill whole-app refetch storms (react-query)
**Phase 1/3 · Status: DONE**

**Issue.** (a) `refetchOnReconnect` defaulted to `true` → one network blip refetched every query on every tab in lockstep. (b) Dashboard action-plan used `refetchOnWindowFocus:true` + `staleTime:0` → fired `/users/me/action-plan/active` on every alt-tab, cohort-synchronized.

**Affects.** Whole platform (shared API) during contests.

**Category.** Degrade / poll-less.

**Approach used.** `query-provider.tsx`: `refetchOnReconnect:false` globally. `use-action-plan.ts`: `refetchOnWindowFocus:false`, `staleTime:30s`, `gcTime:5m`. Safe in normal mode too.

**Effect.** No synchronized whole-app refetch on reconnect or refocus — removes two of the three amplifiers that pinned the API during the outage.

**Verification.** `tsc` clean (web).

**Risk / rollback.** Low. Rollback: restore the option values.

---

## Fix 06 — Pause the p2p matchmaking orchestrator during Contest Mode
**Phase 1 · Status: DONE**

**Issue.** The p2p orchestrator runs 5 Postgres `findMany` + Redis ops **every ~5s forever, even at zero users** (~86k idle queries/day). Drains shared DB for a disposable feature.

**Affects.** Contest indirectly (shared Postgres); large always-on idle cost.

**Category.** Can Disable During Contest.

**Approach used.** New `apps/p2p/src/lib/contest-mode.ts` (p2p reader). Early-return guard at the top of `runScheduledOrchestratorCycle()` — the whole cycle is skipped during a contest.

**Effect.** Zero p2p matchmaking DB load during contests. (Follow-up Phase-4: also skip DB passes when nothing pending, to cut the *always-on* idle cost.)

**Verification.** `tsc` clean (p2p).

**Risk / rollback.** Low — matchmaking pauses; with peer entry disabled in the pre-window, no active peer sessions during a contest. Rollback: remove the guard.

---

## Fix 07 — Shallow `/health` on contest-service (stop the death spiral)
**Phase 2 · Status: DONE**

**Issue.** contest-service `/health` did `SELECT 1` + Redis `ping()`. Under a contest load spike those queue behind the exhausted pool / Upstash quota and return 503 → Cloud Run / LB kills a busy-but-alive instance exactly when capacity is scarcest → death spiral.

**Affects.** Whole contest service (all contest endpoints) during the spike.

**Category.** Mission-critical (infra).

**Approach used.** `apps/contest-service/src/index.ts`: `/health` now returns 200 **dependency-free** (liveness — "is the process up"). Moved the deep DB+Redis check to a new `/ready` endpoint for dashboards/manual checks (readiness), which can 503 without risking instance kills.

**Effect.** A busy instance is never killed for being busy. Real process death still fails `/health` (the socket won't answer). Dependency health is observable at `/ready`.

**Verification.** `tsc` clean (contest-service).

**Risk / rollback.** Low. If any uptime monitor was pointed at `/health` expecting a deep check, point it at `/ready`. Rollback: restore the deep check in `/health`.

---

## Fix 08 — Disable AI-interview creation during Contest Mode
**Phase 1 · Status: DONE**

**Issue.** AI interviews are the heaviest optional feature (persistent Deepgram stream + xAI/LLM per turn) and run on the shared API.

**Affects.** API service load during a contest (auth/billing share it).

**Category.** Can Disable During Contest.

**Approach used.** `apps/api/src/routes/interviews.ts`: `POST /interviews` (session creation) returns **503 "paused during live contests"** when `isContestModeActive()`. Backend guard, so it holds even if the UI still shows the button. In-progress sessions are untouched.

**Effect.** No new AI interviews (and their Deepgram/LLM load) start during a contest.

**Verification.** `tsc` clean (api).

**Risk / rollback.** Low — one guard at the top of the create route; returns a clean 503. Rollback: remove the guard.

---

## Fix 09 — Peer interviews: stop the landing-page load + 15s poll during Contest Mode
**Phase 1 · Status: DONE**

**Issue.** The peer interview landing page loads peer data on mount and re-polls the API every 15s per open tab (~480 calls/hr/tab of real DB joins). Peer matchmaking is already paused server-side (Fix 06), so this is pure waste during a contest.

**Affects.** Shared API/Postgres during a contest.

**Category.** Can Disable During Contest.

**Approach used.** `apps/web/.../interviews/peer/page.tsx`: `useContestMode()` gate in the data-load effect — during a contest it neither loads peer data nor starts the 15s poll (added `contestMode` to the effect deps so it re-arms when the contest ends).

**Effect.** Zero peer-landing API polling during a contest; matchmaking already paused (Fix 06) so the feature is fully idle. Resumes automatically after.

**Verification.** `tsc` clean (web).

**Risk / rollback.** Low — only skips loading/polling under Contest Mode. (Follow-up: an explicit "paused during contests" screen for nicer UX.) Rollback: remove the `contestMode` guard + dep.

---

## Session progress
**Done (all type-checked): Fixes 01–09** — Contest Mode foundation (backend + web readers), billing WS/poll off, payment crons paused, whole-app refetch storms killed, p2p orchestrator paused, shallow `/health`, AI-interview creation disabled, peer landing poll off.

## Fix 10 — My Rank reads the generated snapshot, never full-scans
**Phase 3/4 · Status: DONE**

**Issue.** `GET /contests/:id/my-rank` on an ENDED contest recomputed the ENTIRE leaderboard in application code **per request** — `findMany` over all participants + all accepted submissions, then in-JS ranking. At the post-contest rush every participant hits it at once → platform-wide DB meltdown. It also ignored the admin-generated snapshot that already contains everyone's rank.

**Product model (from you).** The leaderboard + My Rank are built **only when the contest admin clicks "create leaderboard."** There should be no live ranking / polling load during the contest.

**Affects.** Leaderboard / My Rank; shared Postgres at the post-contest rush.

**Category.** Can Gracefully Degrade → read-only from the published snapshot.

**Approach used.** `apps/contest-service/src/routes/leaderboard.ts` — the ENDED branch of `/my-rank` now reads the admin-generated snapshot from Redis (`generatedContestLeaderboard`). If published, it returns the user's rank + score breakdown straight from the cached entry (**zero extra DB queries**). If not published yet, it returns the participant's own score with `rankAvailable:false` and **no full scan**. The heavy computation happens exactly once, when the admin generates the leaderboard.

**Effect / improvement.** The single worst post-contest DB offender is gone. My Rank is now O(1)-ish (Redis read + in-memory find) once published, and cheap ("score only") before. Matches your "rank is built on admin action" model precisely.

**Verification.** `tsc` clean (contest-service). The generated-leaderboard build/admin path is unchanged; the live `/leaderboard/generated` GET already used the same snapshot.

**Risk / rollback.** Low. Behavior change is intentional: users see rank only after the admin publishes (previously it was always live-computed). Response is a superset (`rankAvailable` added; `rank` may be null pre-publish — the frontend already tolerates a null rank during the contest). Rollback: restore the previous ENDED block.

**Follow-up.** Ensure the frontend shows only the *generated* leaderboard during/after a contest (not the live `/leaderboard` full-scan endpoint); optionally gate that live endpoint behind Contest Mode too.

---

## Session progress (this run)
**Done, all type-checked: Fixes 01–10.** Contest Mode foundation (backend + web readers) · billing WS/poll off · payment crons paused · whole-app refetch storms killed · p2p orchestrator paused · shallow `/health` (+ `/ready`) · AI-interview creation disabled · peer landing poll off · My Rank reads generated snapshot (no full scan).

## Fix 11 — Mongo failure no longer crash-loops contest-service
**Phase 2 · Status: DONE**

**Issue.** `connectMongoDB()` did `process.exit(1)` on any connect failure. Under Atlas saturation an instance would exit at boot, restart into the same saturated cluster, and loop — turning a partial outage into a total one. Mongo only serves question *content*; entry/submit/timer/scoring are all Postgres-backed.

**Affects.** Whole contest service (boot crash loop).

**Category.** Mission-critical (infra resilience).

**Approach used.** `apps/contest-service/src/lib/mongodb.ts`: `connectMongoDB()` now logs and returns `false` instead of exiting; added `isMongoConnected()` + runtime connection-state listeners. The service starts even if Mongo is down; content routes degrade to 503 until it recovers (mirrors the API's existing behavior).

**Effect.** No boot crash loop; contest entry/submit survive a Mongo outage. Only question content degrades.

**Verification.** `tsc` clean (contest-service). `registerQuestionModels` was already idempotent (was double-called before).

**Risk / rollback.** Low. Rollback: restore `process.exit(1)`.

---

## Fix 12 — Single shutdown orchestrator (remove racing SIGTERM/SIGINT handlers)
**Phase 2 · Status: DONE**

**Issue.** `prisma.ts` and `mongodb.ts` each registered their own SIGTERM/SIGINT handlers that `process.exit(0)` immediately — racing the main drain in `index.ts` (stop worker → close queue → `fastify.close()` → disconnect). Whichever exited first truncated the drain, dropping in-flight contest submissions and leaking connections.

**Affects.** In-flight contest submissions on every deploy/scale-down.

**Category.** Mission-critical (protects saving progress / submissions).

**Approach used.** Removed the `process.exit` handlers from `contest-service/lib/prisma.ts` and `lib/mongodb.ts`. The single orchestrator in `index.ts` now also `await disconnectMongo()` after `fastify.close()` + `prisma.$disconnect()`.

**Effect.** Shutdown drains fully and once — in-flight submissions complete before exit.

**Verification.** `tsc` clean (contest-service).

**Risk / rollback.** Low. Rollback: restore the per-module handlers.

---

## Fix 13 — Graceful SIGTERM drain for API + p2p
**Phase 2 · Status: DONE**

**Issue.** `apps/api` and `apps/p2p` had **no** SIGTERM handler. Cloud Run SIGTERMs on every deploy/scale-down, then SIGKILLs after 10s — so in-flight requests (payment webhooks, interview writes, p2p sockets) were dropped and DB connections leaked.

**Affects.** In-flight work on the shared API + p2p during deploys/scale events (which also happen mid-contest as Cloud Run scales).

**Category.** Important (reliability).

**Approach used.** Added a `shutdown()` handler to `apps/api/src/index.ts` (`fastify.close()` → `prisma.$disconnect()`) and `apps/p2p/src/index.ts` (`stopBackgroundWorkers()` → `io.close()` → `fastify.close()` → `prisma.$disconnect()`), both idempotent, on SIGTERM + SIGINT.

**Effect.** In-flight requests drain before exit; connections close cleanly; no leaked backend connections tightening the pool for survivors.

**Verification.** `tsc` clean (api + p2p).

**Risk / rollback.** Low — standard graceful shutdown. Rollback: remove the handlers.

---

## Session progress (updated)
**Done, all type-checked: Fixes 01–13.** + Mongo no-crash · single shutdown orchestrator · API/p2p graceful drain.

## Next up
## Fix 14 — Cache the contest WebSocket auth
**Phase 2 · Status: DONE**

**Issue.** The submission WebSocket (`websocket-gateway.ts` → `verifySupabaseToken`) called `supabase.auth.getUser()` on **every** connect, bypassing the 60s token cache the HTTP middleware uses. Since the client opens a WS per submission, every submit was a fresh network call to Supabase auth — a load spike + quota risk during a submit storm.

**Affects.** Supabase auth (shared) during submit storms; contest submit path.

**Category.** Mission-critical (auth on the submit path).

**Approach used.** `apps/contest-service/src/lib/supabase.ts`: `verifySupabaseToken` now checks `getCachedAuthUser(token)` first and `setCachedAuthUser` on success — same cache as the HTTP path.

**Effect.** Submit-time WS auth is served from the 60s cache; Supabase auth calls collapse from "per submission" to ~one per user per minute.

**Verification.** `tsc` clean (contest-service).

**Risk / rollback.** Low. Rollback: remove the cache lookup/set.

---

## Fix — Judge0 per-test fallback: VERIFIED ADEQUATE, INTENTIONALLY SKIPPED
**Status: SKIPPED (with rationale)**

The audit flagged the per-test `Promise.all` fallback (`submission-worker.ts:889`) as a Judge0 self-DDoS amplifier. On inspection: (1) it only runs on **non-infrastructure** errors — a Judge0 *storm* produces infra errors that **re-throw** (line 881) and never fan out; (2) each `runSingleTestCase` already routes through `runWithJudge0Concurrency` (line 951), so the fan-out is **already throttled** to the concurrency cap. Capping the number of tests would leave some tests unjudged → wrong verdicts. **Not changed — protecting judge correctness outweighs a bounded, rarely-triggered amplifier.**

---

## Fix 15 — Jitter the contest-page polls
**Phase 3 · Status: DONE**

**Issue.** The contest detail + MCQ + DSA round pages all poll every fixed 15s. 150+ entrants who load at the same moment then re-poll on the exact same second — a synchronized spike on the contest API.

**Affects.** Contest API load (mission-critical pages, so we jitter rather than disable).

**Category.** Poll-less / de-synchronize.

**Approach used.** Per-mount random period `15–22s` (`15000 + random*7000`) on all three polls, so the cohort spreads across a 7s window instead of aligning.

**Effect.** The synchronized 15s poll wave becomes a smooth spread — same freshness, no cohort spike.

**Verification.** `tsc` clean (web).

**Risk / rollback.** Low — only the poll period changes. Rollback: restore the fixed `15_000`.

---

## Fix 16 — Hide optional features from the nav during Contest Mode
**Phase 1 · Status: DONE**

**Issue.** Users could navigate into heavy optional features (AI Interview, Resume, Job Profile, AI Tutor) mid-contest.

**Approach used.** `apps/web/src/components/sidebar.tsx`: `useContestMode()` + a `CONTEST_HIDDEN_NAV_ITEMS` set filter — those entries disappear from the nav while a contest is live, reappear after. Dashboard/Contests/Questions/Sheets/Settings stay.

**Effect.** Users are steered to the contest; optional heavy pages aren't reachable from the nav (also gated server-side).

**Verification.** `tsc` clean (web). **Risk:** cosmetic; rollback: remove the filter line.

---

## Fix 17 — Backend 503-guards on heavy AI endpoints during Contest Mode
**Phase 1 · Status: DONE**

**Issue.** Defense-in-depth: even if a URL is hit directly, the heaviest optional LLM endpoints should refuse load during a contest.

**Approach used.** Added `blockDuringContest(reply)` helper to `apps/api/src/lib/contest-mode.ts`; applied at the top of the two AI-tutor stream routes (`/users/me/tutor/chat/v2/stream`, `/users/me/tutor/chat/stream`) and the resume-AI routes (`/resumes/:id/analyze`, `/resumes/:id/analyze-ats`). AI-interview create was already gated (Fix 08).

**Effect.** No heavy Gemini/LLM work on the shared API during a contest, regardless of how the endpoint is reached.

**Verification.** `tsc` clean (api). **Risk:** low (clean 503). Rollback: remove the guard lines.

---

## Fix 18 — Cap the integrity-event payload
**Phase 1/security · Status: DONE**

**Issue.** `POST /contests/:id/integrity-events` wrote an unbounded `jsonb` payload to Postgres on every proctor event (contest-service has no global bodyLimit → 1MB default). Large payload × many events × many users = DB bloat during a contest.

**Approach used.** Per-route `bodyLimit: 16KB` on the integrity endpoint (events are small metadata) — targeted so it doesn't affect code-submission size limits on other routes.

**Effect.** Integrity writes are bounded; no jsonb-bloat vector.

**Verification.** `tsc` clean (contest-service). **Risk:** low. Rollback: remove `bodyLimit`.

---

## ✅ CONTEST-PROTECTION CODE WORK COMPLETE — Fixes 01–18 (all type-checked, all 4 services)
Every safe, contest-protective code change is in. Contest Mode auto-activates ~15 min before a contest and disables/degrades all optional load; the platform-killers reachable in code (health death-spiral, Mongo crash-loop, shutdown drain, WS auth, poll jitter, unbounded my-rank scan) are fixed.

## DEFERRED — with rationale (per the doctrine: don't over-optimize optional/critical paths)
- **Judge0 per-test fallback** — verified already throttled + gated; changing risks judge correctness. Skipped.
- **Triple/N+1 `/my-rank` collapse on contest pages** — `/my-rank` is now cheap (Fix 10 reads the snapshot; polls jittered). Collapsing the calls means refactoring the mission-critical contest-detail mount effects (registration + score + submission state) — higher regression risk than the small remaining gain. Deferred unless load-testing shows it matters.
- **`ensureRoundAttempt` write-on-read** — on the mission-critical question-load path; risky to change. Deferred.
- **AI-interview idle-load (worklet VAD, STT reconnect backoff, zombie-session reaper)** — these are for a feature that is **disabled during contests** (Fix 08), so they don't affect contest reliability. They're normal-mode hygiene in the heavy voice pipeline; the doctrine says not to prioritize optional features. Deferred to a dedicated normal-mode pass.

## MANUAL / CONFIG (for final discussion — not code)
- **Postgres pooler URL** — switch prod `DATABASE_URL` to `…@<ref>.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=3`. **Single biggest win.**
- **Local JWT verification** — needs `SUPABASE_JWT_SECRET` exposed; then verify tokens offline instead of calling Supabase (eliminates the auth-quota ceiling). Cache already mitigates.
- **Worker split** — run the BullMQ worker as its own Cloud Run service (pattern exists in `apps/api`).
- **`contest_submissions` partial index** — `(contest_id,user_id,question_id) WHERE status='ACCEPTED' OR points_awarded>0` (migration) for the generated-leaderboard build.
- **Cloud Run** — raise `min-instances` (warm pools/caches), review concurrency; **rotate the committed secrets in `apps/web/.env`**.
- **Metrics/alerts** — prom-client + uptime + error-rate alerts (flying blind today).
