# Judge0 Contest Infrastructure

This project can buffer contest submissions, but Judge0 capacity still has to be provisioned separately. For a 1000-user contest with 20 hidden tests each, plan for about 20,000 Judge0 submissions in the contest burst.

## Production Target

Use a dedicated/self-hosted Judge0 endpoint for contests. Do not use RapidAPI or public Judge0 endpoints for a 1000-user storm.

Recommended baseline:

- Run Judge0 on real Linux infrastructure, not WSL.
- Use a Judge0 image/host setup that supports the sandbox cgroup mode on that machine.
- Keep `wait=false`; submit asynchronously and poll results.
- Set Judge0 `MAX_QUEUE_SIZE` above the expected burst, for example `25000+`.
- Size Judge0 workers from the SLO, not from guesswork. More workers need more CPU and memory.
- Use dedicated Postgres and Redis for Judge0.
- Disable sandbox network access.
- Keep CPU, wall-time, memory, and max file limits enforced.

Official references:

- Judge0 submissions API: https://docs.judge0.com/products/judge0/http_api/submissions/
- Judge0 CE API notes: https://ce.judge0.com/
- Judge0 repository: https://github.com/judge0/judge0

## Contest Service Settings

For a dedicated Judge0:

```env
JUDGE0_PROVIDER="self-hosted"
JUDGE0_API_URL="https://judge0.your-domain.example"
JUDGE0_API_KEY="your-judge0-auth-token"
JUDGE0_AUTH_HEADER="X-Auth-Token"
JUDGE0_ALLOW_SHARED_ENDPOINT="false"
JUDGE0_EXECUTION_CONCURRENCY="200"
JUDGE0_CPU_TIME_LIMIT_SECONDS="5"
JUDGE0_WALL_TIME_LIMIT_SECONDS="10"
JUDGE0_MEMORY_LIMIT_KB="262144"
JUDGE0_POLL_MAX_ATTEMPTS="120"
JUDGE0_POLL_INITIAL_DELAY_MS="1000"
JUDGE0_POLL_MAX_DELAY_MS="5000"
```

For RapidAPI smoke testing only:

```env
JUDGE0_PROVIDER="rapidapi"
JUDGE0_API_URL="https://judge0-ce.p.rapidapi.com"
JUDGE0_API_KEY="your-rapidapi-key"
JUDGE0_HOST="judge0-ce.p.rapidapi.com"
JUDGE0_EXECUTION_CONCURRENCY="3"
```

Production blocks shared Judge0 endpoints by default. Override with `JUDGE0_ALLOW_SHARED_ENDPOINT=true` only for an intentional non-contest fallback.

## Load Test Gate

Use the harness:

```bash
JUDGE0_CAPACITY_URL="https://judge0.your-domain.example" \
JUDGE0_CAPACITY_KEY="your-judge0-auth-token" \
JUDGE0_CAPACITY_TOTAL=20000 \
JUDGE0_CAPACITY_CONCURRENCY=200 \
JUDGE0_CAPACITY_POLL_CONCURRENCY=200 \
node scripts/load-test/judge0-capacity-storm.mjs
```

Pass criteria:

- Submit status: `201` for all requested submissions.
- Poll status: no timeouts.
- Terminal status: `3 Accepted` for every known-good test submission.
- No `13 Internal Error`, no unexpected `6 Compilation Error`, no `503 queue is full`.
- P95 time-to-verdict is inside the contest SLO.

The local WSL test failed this gate under 1000 submissions, so it is not a valid production capacity target.
