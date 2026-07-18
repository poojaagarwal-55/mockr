#!/usr/bin/env bash
# Copy every secret value from GCP Secret Manager into AWS SSM Parameter Store
# under /practers/<env>/<name>, matching the parameters Terraform created.
#
# Requires: gcloud (authed, billing ENABLED on the practers project) + aws CLI.
# Usage: ./gcp-to-ssm-export.sh [env]   (env defaults to "prod")
set -euo pipefail

ENV="${1:-prod}"
GCP_PROJECT="${GCP_PROJECT:-practers}"
SSM_PREFIX="/practers/${ENV}"
AWS_REGION="${AWS_REGION:-ap-south-1}"

# GCP secret names that back the ECS task defs (see infra/aws/ssm.tf).
SECRETS=(
  database-url direct-url mongodb-uri redis-url p2p-redis-url queue-redis-url
  upstash-redis-rest-url upstash-redis-rest-token
  next-public-supabase-url next-public-supabase-anon-key supabase-service-role-key
  xai-api-key google-generative-ai-api-key groq-api-key deepgram-api-key
  judge0-api-url judge0-api-key judge0-chunk-concurrency
  s3-endpoint s3-bucket s3-access-key s3-secret-key
  jwt-secret encryption-key
  razorpay-key-id razorpay-key-secret razorpay-webhook-secret
  resend-api-key resend-auth-api-key resend-verified-domain
  admin-notification-email admin-emails
  msg91-widget-id msg91-widget-token msg91-auth-key msg91-sender-id
  r2-avatar-bucket r2-avatar-public-url r2-blog-images-bucket r2-blog-images-public-url
  r2-recordings-endpoint r2-recordings-access-key r2-recordings-secret-key r2-recordings-bucket
  tutor-agent-v2 frontend-url company-frontend-url contest-allowed-origins
  cloudflare-turn-key-id cloudflare-turn-api-token
  BLOG_TEAM_AUTHOR_EMAILS BLOG_TEAM_DISPLAY_NAME BLOG_TEAM_AVATAR_URL
)

for name in "${SECRETS[@]}"; do
  echo -n "→ ${name} ... "
  if ! value="$(gcloud secrets versions access latest --secret="${name}" --project="${GCP_PROJECT}" 2>/dev/null)"; then
    echo "SKIP (not found in GCP)"
    continue
  fi
  aws ssm put-parameter \
    --region "${AWS_REGION}" \
    --name "${SSM_PREFIX}/${name}" \
    --type SecureString \
    --value "${value}" \
    --overwrite >/dev/null
  echo "done"
done

echo "All secrets copied to ${SSM_PREFIX}/* in ${AWS_REGION}."
