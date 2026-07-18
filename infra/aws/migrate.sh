#!/usr/bin/env bash
# One-command GCP→AWS migration driver. Idempotent — safe to re-run; each phase
# is skippable/repeatable. Run from infra/aws after `aws configure`.
#
#   ./migrate.sh all                 # everything end to end
#   ./migrate.sh bootstrap|apply|secrets|images|deploy|smoke   # single phase
#
# Env:
#   AWS_REGION       (default ap-south-1)
#   STATE_BUCKET     (default practers-tfstate)
#   SECRETS_FROM     "gcp" (pull from GCP Secret Manager) | "file:PATH" (KEY=VALUE)
#   AUTO_APPROVE=1   skip the terraform apply confirmation
#   TAG              image tag to build/deploy (default: latest)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${HERE}/../.." && pwd)"
cd "${HERE}"

AWS_REGION="${AWS_REGION:-ap-south-1}"
STATE_BUCKET="${STATE_BUCKET:-practers-tfstate}"
LOCK_TABLE="${LOCK_TABLE:-practers-tflock}"
CLUSTER="${CLUSTER:-practers-prod}"
TAG="${TAG:-latest}"
SERVICES=(practers-api contest-service p2p-service latex-compiler)

say() { printf "\n\033[1;36m== %s ==\033[0m\n" "$*"; }
die() { printf "\033[1;31mERROR: %s\033[0m\n" "$*" >&2; exit 1; }

preflight() {
  say "Preflight"
  for t in aws terraform docker jq; do command -v "$t" >/dev/null || die "missing tool: $t"; done
  aws sts get-caller-identity >/dev/null 2>&1 || die "no AWS credentials — run 'aws configure'"
  ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
  REGISTRY="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
  echo "account=${ACCOUNT_ID} region=${AWS_REGION}"
}

quota() {
  say "Fargate vCPU quota (best-effort request to 256)"
  local code
  code="$(aws service-quotas list-service-quotas --service-code fargate --region "${AWS_REGION}" \
        --query "Quotas[?contains(QuotaName,'vCPU')].QuotaCode | [0]" --output text 2>/dev/null || true)"
  [ -z "${code}" ] || [ "${code}" = "None" ] && code="L-3032A538"
  aws service-quotas request-service-quota-increase --service-code fargate \
    --quota-code "${code}" --desired-value 256 --region "${AWS_REGION}" >/dev/null 2>&1 \
    && echo "requested (approval usually auto, minutes)" \
    || echo "skip (already high or a pending request exists)"
}

bootstrap() {
  say "State backend"
  STATE_BUCKET="${STATE_BUCKET}" LOCK_TABLE="${LOCK_TABLE}" AWS_REGION="${AWS_REGION}" bash ./bootstrap.sh
  cat > backend.tf <<EOF
terraform {
  backend "s3" {
    bucket         = "${STATE_BUCKET}"
    key            = "aws-migration/terraform.tfstate"
    region         = "${AWS_REGION}"
    dynamodb_table = "${LOCK_TABLE}"
    encrypt        = true
  }
}
EOF
}

apply() {
  say "Terraform init + apply"
  [ -f terraform.tfvars ] || die "create terraform.tfvars first (cp terraform.tfvars.example terraform.tfvars)"
  terraform init -reconfigure -input=false
  if [ "${AUTO_APPROVE:-0}" = "1" ]; then
    terraform apply -auto-approve -input=false
  else
    terraform apply -input=false
  fi
}

seed_secrets() {
  say "Seed secrets into SSM"
  case "${SECRETS_FROM:-}" in
    gcp)        ./scripts/gcp-to-ssm-export.sh prod ;;
    file:*)     ./scripts/seed-ssm.sh "${SECRETS_FROM#file:}" prod ;;
    "")         echo "SECRETS_FROM not set — skipping (set SECRETS_FROM=gcp or file:secrets.env)"; return 0 ;;
    *)          die "SECRETS_FROM must be 'gcp' or 'file:PATH'" ;;
  esac
}

images() {
  say "Build & push images"
  aws ecr get-login-password --region "${AWS_REGION}" | docker login --username AWS --password-stdin "${REGISTRY}"
  build_one practers-api    "apps/api/Dockerfile"               "${ROOT}"
  build_one contest-service "apps/contest-service/Dockerfile"   "${ROOT}"
  build_one p2p-service     "apps/p2p/Dockerfile"               "${ROOT}"
  build_one latex-compiler  "services/latex-compiler/Dockerfile" "${ROOT}/services/latex-compiler"
}
build_one() {
  local svc="$1" dockerfile="$2" ctx="$3"
  echo "→ ${svc}"
  docker build --platform linux/amd64 -f "${ROOT}/${dockerfile}" \
    -t "${REGISTRY}/practers/${svc}:${TAG}" "${ctx}"
  docker push "${REGISTRY}/practers/${svc}:${TAG}"
}

deploy() {
  say "Roll services"
  for s in "${SERVICES[@]}"; do
    aws ecs update-service --cluster "${CLUSTER}" --service "${s}" \
      --force-new-deployment --region "${AWS_REGION}" >/dev/null
  done
  echo "waiting for services to stabilize..."
  aws ecs wait services-stable --cluster "${CLUSTER}" --services "${SERVICES[@]}" --region "${AWS_REGION}"
  echo "✓ all services stable"
}

smoke() {
  say "Smoke test via ALB"
  local alb api contest p2p
  alb="$(terraform output -raw alb_dns_name)"
  api="$(terraform output -raw api_hostname 2>/dev/null || echo api.practers.com)"
  for host in "${api}" contest.practers.com p2p.practers.com; do
    printf "  %s/health -> " "${host}"
    curl -s -o /dev/null -w "%{http_code}\n" --max-time 15 \
      --connect-to "${host}:443:${alb}:443" "https://${host}/health" || echo "FAIL"
  done
  echo "(non-200 is expected until secrets are seeded and images pushed)"
}

case "${1:-all}" in
  preflight) preflight ;;
  quota)     preflight; quota ;;
  bootstrap) preflight; bootstrap ;;
  apply)     preflight; bootstrap; apply ;;
  secrets)   preflight; seed_secrets ;;
  images)    preflight; images ;;
  deploy)    preflight; deploy ;;
  smoke)     preflight; smoke ;;
  all)
    preflight; quota; bootstrap; apply; seed_secrets; images; deploy; smoke
    say "Done. Next: DNS cutover + Vercel/OAuth (see README Phase 9-10)." ;;
  *) die "usage: $0 {all|preflight|quota|bootstrap|apply|secrets|images|deploy|smoke}" ;;
esac
