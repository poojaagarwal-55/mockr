#!/usr/bin/env bash
# Pre-contest pre-warm for contest-service on ECS Fargate — the AWS equivalent of
# the old Cloud Run ritual. On Fargate there is NO cpu-throttling to disable
# (CPU is always fully allocated), so "pre-warm" just means: raise the autoscaling
# floor + desired task count so warm tasks are ready before the contest starts.
#
# Usage:
#   ./prewarm-contest.sh up   [N]   # pre-warm to N tasks (default 8)
#   ./prewarm-contest.sh down       # back to resting floor (1)
set -euo pipefail

MODE="${1:?up|down}"
CLUSTER="${CLUSTER:-practers-prod}"
SERVICE="${SERVICE:-contest-service}"
AWS_REGION="${AWS_REGION:-ap-south-1}"
RES_ID="service/${CLUSTER}/${SERVICE}"

case "${MODE}" in
  up)
    N="${2:-8}"
    # Raise the autoscaling floor so it can't scale back below N during the contest.
    aws application-autoscaling register-scalable-target \
      --region "${AWS_REGION}" \
      --service-namespace ecs \
      --resource-id "${RES_ID}" \
      --scalable-dimension ecs:service:DesiredCount \
      --min-capacity "${N}" --max-capacity 10
    aws ecs update-service --region "${AWS_REGION}" \
      --cluster "${CLUSTER}" --service "${SERVICE}" --desired-count "${N}" >/dev/null
    echo "Pre-warmed ${SERVICE} to ${N} tasks (min floor ${N})."
    ;;
  down)
    aws application-autoscaling register-scalable-target \
      --region "${AWS_REGION}" \
      --service-namespace ecs \
      --resource-id "${RES_ID}" \
      --scalable-dimension ecs:service:DesiredCount \
      --min-capacity 1 --max-capacity 10
    aws ecs update-service --region "${AWS_REGION}" \
      --cluster "${CLUSTER}" --service "${SERVICE}" --desired-count 1 >/dev/null
    echo "Reset ${SERVICE} to resting floor (1 task)."
    ;;
  *)
    echo "usage: $0 up [N] | down" >&2; exit 1;;
esac
