# Contest Load Test — how to run

Reproduce the synchronized-entry burst on demand and watch where it walls — so you
can confirm the CPU-quota fix actually works and find the *next* ceiling.

## Platform
Contests run on **AWS ECS Fargate behind an ALB** (`infra/aws/`). Target the ALB
hostname `https://contest.practers.com` (or the raw ALB DNS with a `Host:` header).

## Golden rule
**Do two things FIRST** (see `scaling-and-quota-plan.md`):
1. Raise the **Fargate On-Demand vCPU** quota (Service Quotas → AWS Fargate → 128–256).
2. **Pre-warm** contest-service (`./scripts/prewarm-contest.sh up N`) — Fargate autoscaling
   is too slow to catch a synchronized burst, so the tasks must already be warm.

Skip either and you'll just reproduce the crash and learn nothing new.

## What it simulates
`contest-loadtest.js` (k6): N virtual users all hit **Enter within ~5s**, then poll
`my-rank` + `leaderboard` every ~15s for 2 minutes — the real thundering-herd pattern.

## Setup

1. **Install k6** — https://k6.io/docs/get-started/installation/ (`choco install k6` on Windows).
2. **Install the Supabase SDK** (for the token prep): `npm i @supabase/supabase-js`
3. **Create a dedicated TEST contest** in the admin panel (real questions, open window).
   Don't test against a live public contest.
4. **Make test users + tokens:**
   ```bash
   SUPABASE_URL=https://<ref>.supabase.co \
   SUPABASE_ANON_KEY=<anon> SUPABASE_SERVICE_ROLE_KEY=<service-role> \
   COUNT=150 CONTEST_API=https://contest.practers.com CONTEST_ID=<id> \
   node prepare-users.mjs --create --register
   ```
   → writes `tokens.json`.

## Run — ramp up in steps, don't jump to 1000

Pre-warm to match the tier first (`./scripts/prewarm-contest.sh up 8`), then:
```bash
k6 run -e CONTEST_API=https://contest.practers.com -e CONTEST_ID=<id> -e USERS=150 contest-loadtest.js
# then 300, then 500 — re-pre-warm + watch the dashboards between runs
k6 run -e CONTEST_API=https://contest.practers.com -e CONTEST_ID=<id> -e USERS=300 contest-loadtest.js
k6 run -e CONTEST_API=https://contest.practers.com -e CONTEST_ID=<id> -e USERS=500 contest-loadtest.js
```

## Watch these LIVE while it runs (CloudWatch)
- **ECS (`AWS/ECS`) → contest-service:** `RunningTaskCount` (does it climb / plateau below max?),
  `CPUUtilization`, `MemoryUtilization`. New tasks take ~30–60s to go in-service — if latency
  spikes before `RunningTaskCount` rises, you weren't pre-warmed enough.
- **ALB (`AWS/ApplicationELB`):** `TargetResponseTime`, `HTTPCode_Target_5XX_Count`,
  `RejectedConnectionCount`, `TargetConnectionErrorCount`, `HealthyHostCount`.
- **Service Quotas → AWS Fargate:** On-Demand vCPU usage vs limit — must stay < 100%.
- **Supabase → Reports → Database:** CPU % and connections — should stay flat
  (the `:6543` transaction pooler keeps connections low). If CPU spikes here, the DB
  compute (Micro) is the next bottleneck → bump compute size.
- **k6 summary:** `errors`, `entry_latency` p95, `poll_latency` p95, `http_req_failed`.

## Pass / fail
| Metric | Pass |
|---|---|
| k6 `errors` rate | < 1% |
| `http_req_failed` (5xx/503) | ~0 — sustained ALB `HTTPCode_Target_5XX` = tasks saturated (pre-warm more / raise max) |
| `entry_latency` p95 | < 1.5s |
| `poll_latency` p95 | < 0.8s |
| ECS `RunningTaskCount` | scales smoothly, stays under max_count |
| Fargate vCPU quota usage | < 100% |

## Gotchas
- **Auth first:** contest endpoints need a Supabase `Bearer` token AND (usually) a
  profile + contest registration. `prepare-users.mjs --register` handles registration;
  if endpoints 403, your test users may also need a profile row.
- **Submissions hit Judge0**, which is rate-limited (~10 req/s). This test deliberately
  stays on reads/polls (that's what the entry herd is). To test the submit pipeline,
  run a *separate*, low-rate submission scenario and expect Judge0 — not Cloud Run — to
  be the limit.
- **Cost:** the test scales real Fargate tasks and writes real rows. Prefer a
  **staging** clone; if you must use prod, do it off-hours with the team watching.
- **Cleanup (prod):** delete the test auth users afterwards (Supabase → Authentication →
  filter `loadtest+`), and archive/delete the test contest + its submissions.

## After the test
- If it holds 500 clean → you're safe for typical contests; keep the pre-warm plan.
- If ALB 5xx / saturation still appears → pre-warm more tasks, raise `max_count`, and/or
  lower `cpu_target_percent` for snappier scale-out; confirm the Fargate vCPU quota has room; re-run.
- Record the numbers + the "users per Fargate task" you observed in `contest-hardening-log.md`.
