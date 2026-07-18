# Contest Scaling & Quota Plan — AWS ECS Fargate (hand to Fahad)

> Platform note: contests now run on **AWS ECS Fargate behind an ALB in ap-south-1**
> (see `infra/aws/`). The GCP Cloud Run plan is historical. The 2 Jul crash happened
> on Cloud Run and was its shared 20-vCPU CPU quota — **that specific failure mode is
> structurally gone on AWS** (per-service Fargate tasks, no shared regional CPU pool)
> once the Fargate vCPU quota below is raised.

## Root cause recap (why we care about the quota)
On GCP all 4 services shared **one 20-vCPU regional pool**; contest scaling up starved
everything → whole platform died together at ~150 synchronized users. On AWS each service
gets its own Fargate tasks; the only shared ceiling is the account-level **Fargate
On-Demand vCPU count**, which is high and adjustable. DB is unchanged (Supabase
transaction pooler `:6543`, not a factor).

---

## Fix #1 — raise the Fargate vCPU quota
- **AWS Console → Service Quotas → AWS Fargate → "Fargate On-Demand vCPU resource count"** (region `ap-south-1`).
- Request **128** (covers up to ~1000 users below) or **256** for growth headroom. Usually auto-approved in minutes.
- This is an account/region ceiling across ALL Fargate tasks — the AWS analog of the GCP CPU quota, but far higher and not shared as tightly.

## Current config (verified from `infra/aws/ecs.tf`)
| Service | task CPU | task mem | desired | min | max | autoscaling |
|---|---|---|---|---|---|---|
| practers-api | 1024 (1 vCPU) | 2048 | 1 | 1 | 10 | CPU target 65% |
| contest-service | 2048 (2 vCPU) | 4096 | 1 | 1 | 10 | CPU target 65% |
| p2p-service | 1024 (1 vCPU) | 2048 | 1 | 1 | **1** | off (single task by design) |
| latex-compiler | 1024 (1 vCPU) | 2048 | 1 | 1 | 4 | CPU target 65% |

Baseline steady-state ≈ **5 vCPU**. Autoscaling = target-tracking on `ECSServiceAverageCPUUtilization`, scale-out cooldown 30s, scale-in 120s.

**⚠️ Fargate autoscaling reacts slowly to bursts** (CPU metric ~1-min + cooldown + task cold-start). So the plan below leans on **pre-warm** (warm tasks ready before the herd), not reactive scaling, for the entry spike.

---

## Per-tier plan

`task CPU`/`mem` stay the same; you change **`max_count`** (ceiling, in `ecs.tf`) and the **pre-warm task floor** (`prewarm-contest.sh up N`).

### 300 users
| Service | pre-warm tasks | max_count |
|---|---|---|
| contest-service | **8** | **12** |
| practers-api | **3** | 10 |
| p2p / latex | 1 / 1 | 1 / 4 |

Peak vCPU if all max = **37** → well under a 128 quota.

### 500 users
| Service | pre-warm tasks | max_count |
|---|---|---|
| contest-service | **12** | **20** |
| practers-api | **5** | 10 |
| p2p / latex | 1 / 1 | 1 / 4 |

Peak vCPU = **55**.

### 1000 users
| Service | pre-warm tasks | max_count |
|---|---|---|
| contest-service | **20** | **30** |
| practers-api | **8** | 15 |
| p2p / latex | 1 / 1 | 1 / 4 |

Peak vCPU = **80** → still under 128; request 256 if you expect >1000.

> These are planning starting points. **Confirm "users per task" with the load test** —
> Fargate has no concurrency cap, so real capacity per 2-vCPU contest task is empirical.

---

## Commands

### Raise the max ceilings (once, for 500/1000 tiers)
`max_count` currently = 10 for contest-service (`infra/aws/ecs.tf`). For bigger contests bump it and `terraform apply`:
```hcl
# infra/aws/ecs.tf — module "contest_service"
max_count = 20   # or 30 for the 1000-user tier
```
> **Also fix the pre-warm script cap:** `scripts/prewarm-contest.sh` hardcodes
> `--max-capacity 10`. For >10 tasks, raise that number too (or parameterize it) or the
> floor-raise silently caps at 10.

### Pre-warm BEFORE a contest (mandatory on Fargate)
```bash
cd infra/aws
./scripts/prewarm-contest.sh up 12     # e.g. 500-user tier: 12 warm contest tasks
# api too (no script yet — do it directly):
aws application-autoscaling register-scalable-target --region ap-south-1 \
  --service-namespace ecs --resource-id service/practers-prod/practers-api \
  --scalable-dimension ecs:service:DesiredCount --min-capacity 5 --max-capacity 10
aws ecs update-service --region ap-south-1 --cluster practers-prod --service practers-api --desired-count 5
```
Do it **10–15 min ahead** so tasks are fully in-service (image pull + boot + health checks pass).

### Revert AFTER the contest
```bash
./scripts/prewarm-contest.sh down      # contest back to floor 1
aws application-autoscaling register-scalable-target --region ap-south-1 \
  --service-namespace ecs --resource-id service/practers-prod/practers-api \
  --scalable-dimension ecs:service:DesiredCount --min-capacity 1 --max-capacity 10
aws ecs update-service --region ap-south-1 --cluster practers-prod --service practers-api --desired-count 1
```
> Automate up/down with **EventBridge Scheduler** rules tied to contest start/end if contests are frequent.

### Optional: snappier scale-out for contest-service
Lower its autoscaling target so it adds tasks earlier (`infra/aws/ecs.tf` passes `cpu_target_percent`; default 65):
```hcl
cpu_target_percent = 50
```

---

## What to watch (CloudWatch, not Cloud Run)
- **ECS** (`AWS/ECS`): `CPUUtilization`, `MemoryUtilization`, `RunningTaskCount` per service.
- **ALB** (`AWS/ApplicationELB`): `TargetResponseTime`, `HTTPCode_Target_5XX_Count`, `RejectedConnectionCount`, `TargetConnectionErrorCount`, `HealthyHostCount`.
- **Service Quotas**: Fargate On-Demand vCPU count usage vs limit.
- **Supabase → Reports → Database**: CPU + connections (should stay flat via the `:6543` pooler).

Existing alarms already cover ALB 5xx, unhealthy hosts, and per-service CPU >85% (`infra/aws/alarms.tf`) — set `alarm_email` in tfvars to receive them.

## Other limits to sanity-check before 1000 users
- **Fargate task launch rate** (burst of new tasks) — pre-warm avoids leaning on it.
- **Supabase pooler** Max Client Connections (Micro compute ~200) — verify under load test.
- **Judge0 / RapidAPI** rate limit (~10 req/s) — the submission pipeline, not contest reads.
