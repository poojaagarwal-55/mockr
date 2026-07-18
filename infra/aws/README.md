# Practers backend: GCP Cloud Run → AWS ECS Fargate

Terraform + CI to move the four containerised backend services off Cloud Run onto
**ECS Fargate behind an ALB**, in `ap-south-1` (Mumbai). Everything else stays put:
Supabase (Postgres), Upstash (Redis), MongoDB Atlas, Cloudflare R2, Judge0/RapidAPI,
Resend, xAI, Vercel frontends, and **Google OAuth** (auth is unchanged).

## Fastest path (one command)

Once you've `aws configure`'d and filled `terraform.tfvars` + secrets:

```bash
cd infra/aws
cp terraform.tfvars.example terraform.tfvars      # edit domains + alarm_email
cp secrets.env.example secrets.env                # fill values (or use SECRETS_FROM=gcp)

SECRETS_FROM=file:secrets.env ./migrate.sh all
```

`migrate.sh all` runs, idempotently: preflight → Fargate quota request → state
backend (S3+DynamoDB) → `terraform apply` (VPC, ALB, ECR, SSM, IAM, **OIDC deploy
role**, **CloudWatch alarms**, ECS + 4 services) → seed secrets → build & push all
images → roll the services → smoke test. Re-runnable; each phase is also callable
alone (`./migrate.sh apply`, `./migrate.sh images`, …).

**After it finishes, only these are left (they're outside AWS):** DNS cutover,
Vercel env vars, Google OAuth redirect URIs — see Phases 9–10. Terraform even
prints the deploy-role ARN (`github_deploy_role_arn`) to paste into the GitHub
secret `AWS_DEPLOY_ROLE_ARN`.

## What moves

| Service | Port | Public? | Notes |
|---|---|---|---|
| `practers-api` | 8080 | via ALB `api.` | main API + BullMQ producers |
| `contest-service` | 8080 | via ALB `contest.` | WebSockets, **sticky**, BullMQ workers |
| `p2p-service` | 8080 | via ALB `p2p.` | WebSockets, **sticky**, **single task by design** |
| `latex-compiler` | 3002 | internal only | reached at `latex-compiler.practers.internal:3002` (Cloud Map) |

GCP mapping: Cloud Run→Fargate, GCR→ECR, Secret Manager→**SSM Parameter Store**
(free standard params), Cloud Build→**GitHub Actions**, Cloud Logging→CloudWatch.

## Files

```
infra/aws/
  versions.tf providers.tf variables.tf   # provider, backend, inputs
  network.tf                              # VPC (module) + security groups
  ecr.tf ssm.tf iam.tf                    # registry, secrets, roles
  alb.tf                                  # ALB, ACM, listeners, Route53 (optional)
  ecs.tf                                  # cluster, Cloud Map, log groups, 4 services
  modules/ecs-service/                    # reusable task-def+service+TG+autoscaling
  scripts/                                # gcp-to-ssm-export, seed-ssm, prewarm-contest
.github/workflows/deploy-aws.yml          # build → ECR → ECS rolling deploy
```

---

## One-time bootstrap

1. **AWS account + CLI**: `aws configure` with an admin profile for the initial apply.
2. **Quota** (do this first, it's the thing that bit us on GCP): Service Quotas console →
   *AWS Fargate* → **"Fargate On-Demand vCPU resource count"** → request **128–256**.
   Usually auto-approved in minutes. Baseline steady-state here is ~8 vCPU
   (api 2×1 + contest 2 + p2p 1 + latex 1 ≈ 8), bursting higher on contest day.
3. **Remote state** (recommended): create an S3 bucket `practers-tfstate` + DynamoDB
   table `practers-tflock`, then uncomment the `backend "s3"` block in `versions.tf`
   and `terraform init -migrate-state`.
4. **GitHub OIDC role**: create an IAM role trusting `token.actions.githubusercontent.com`
   for this repo, with ECR push + `ecs:*` + `iam:PassRole` (the two task roles) +
   `application-autoscaling:*`. Put its ARN in the repo secret `AWS_DEPLOY_ROLE_ARN`.

## Apply

```bash
cd infra/aws
cp terraform.tfvars.example terraform.tfvars   # edit domains / region
terraform init
terraform apply
```

This creates the VPC, ALB, ECR repos, SSM parameters (empty placeholders), IAM,
the cluster, and the four services. Services will be **unhealthy until** images are
pushed and secrets are seeded (next two steps).

## Seed secrets

Real values never live in Terraform. Two options:

- **From GCP directly** (needs billing re-enabled on the `practers` project):
  ```bash
  ./scripts/gcp-to-ssm-export.sh prod
  ```
- **From a local file** (`secrets.env`, gitignored, `gcp-secret-name=value` lines):
  ```bash
  ./scripts/seed-ssm.sh secrets.env prod
  ```

## Build & push images

First push can be manual; thereafter GitHub Actions does it on every `main` push:

```bash
REGISTRY=$(aws ecr describe-repositories --query 'repositories[0].repositoryUri' --output text | cut -d/ -f1)
aws ecr get-login-password | docker login --username AWS --password-stdin "$REGISTRY"
for s in practers-api contest-service p2p-service; do
  docker build --platform linux/amd64 -f apps/${s/practers-api/api}/Dockerfile -t "$REGISTRY/practers/$s:latest" .
  docker push "$REGISTRY/practers/$s:latest"
done
docker build --platform linux/amd64 -f services/latex-compiler/Dockerfile -t "$REGISTRY/practers/latex-compiler:latest" services/latex-compiler
docker push "$REGISTRY/practers/latex-compiler:latest"
```

Then force a deployment: `aws ecs update-service --cluster practers-prod --service <svc> --force-new-deployment`.

## DNS cutover (zero-downtime, reversible)

1. Confirm each service is healthy on the ALB (target groups green). Test with a
   `Host:` header against the ALB DNS name before touching real DNS.
2. Lower TTL on `api./contest./p2p.practers.com` to 60s a day ahead.
3. Repoint each hostname to the ALB (Route53 alias, or CNAME at your DNS provider —
   `terraform output alb_dns_name`). Do it **one service at a time**.
4. Rollback = point DNS back at the Cloud Run URL. Keep Cloud Run running until stable.

## Rewire the rest (don't skip)

- **Vercel** (`apps/web`, `apps/company`): update `NEXT_PUBLIC_*` API/WS URLs to
  `https://api|contest|p2p.practers.com`, redeploy.
- **CORS**: `cors_allowed_origins` / `contest-allowed-origins` must include the live
  frontend origins.
- **Google OAuth** (staying on Google): in the OAuth client, add the new domains to
  *Authorized JavaScript origins* + *redirect URIs*. OAuth needs no billing, so the
  client can remain in the `practers` GCP project.

## Contest pre-warm (replaces the Cloud Run ritual)

No `--no-cpu-throttling` on Fargate (CPU is always allocated). Pre-warm = raise the
task floor:

```bash
./scripts/prewarm-contest.sh up 8    # before the contest
./scripts/prewarm-contest.sh down    # after
```

## Decommission GCP (after a stable window)

Delete Cloud Run services, GCR images, and Cloud Build triggers. **Keep the GCP
project alive only for the Google OAuth client.**

---

## Notes / decisions baked in

- **p2p-service is pinned to 1 task** (`max_count = 1`, autoscaling off) because the
  socket.io Redis adapter is disabled and matchmaking polls every 5s. To scale out:
  set `P2P_REDIS_ADAPTER=1`, raise `max_count`, flip `enable_autoscaling = true`.
- **latex-compiler** runs 1 warm task (no scale-to-zero on Fargate). If its idle cost
  matters, it's a clean candidate to become a container-image Lambda later.
- **Secrets are SSM SecureString** (free) rather than Secrets Manager (~$0.40/secret/mo
  × ~53 ≈ $21/mo). ECS injects them identically.
- **ALB idle timeout = 3600s** and cookie stickiness on the WS services; without these,
  long-lived sockets and session affinity break.
- Rough steady-state cost: ALB ~$18 + NAT ~$32 + ~8 vCPU of Fargate ≈ **$150–220/mo**,
  more during contests. Drop NAT (`use_nat_gateway=false`) and/or make latex a Lambda to trim.
