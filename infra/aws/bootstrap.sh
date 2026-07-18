#!/usr/bin/env bash
# Idempotent bootstrap of the Terraform remote-state backend (S3 + DynamoDB).
# Safe to re-run. Run this once, before the first `terraform init`.
set -euo pipefail

AWS_REGION="${AWS_REGION:-ap-south-1}"
STATE_BUCKET="${STATE_BUCKET:-practers-tfstate}"
LOCK_TABLE="${LOCK_TABLE:-practers-tflock}"

echo "Region:        ${AWS_REGION}"
echo "State bucket:  ${STATE_BUCKET}"
echo "Lock table:    ${LOCK_TABLE}"
echo

# ── S3 bucket ───────────────────────────────────────────────────────────────
if aws s3api head-bucket --bucket "${STATE_BUCKET}" 2>/dev/null; then
  echo "✓ bucket exists"
else
  echo "→ creating bucket"
  aws s3api create-bucket --bucket "${STATE_BUCKET}" --region "${AWS_REGION}" \
    --create-bucket-configuration LocationConstraint="${AWS_REGION}"
fi
aws s3api put-bucket-versioning --bucket "${STATE_BUCKET}" \
  --versioning-configuration Status=Enabled
aws s3api put-bucket-encryption --bucket "${STATE_BUCKET}" \
  --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
aws s3api put-public-access-block --bucket "${STATE_BUCKET}" \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
echo "✓ bucket versioned + encrypted + private"

# ── DynamoDB lock table ─────────────────────────────────────────────────────
if aws dynamodb describe-table --table-name "${LOCK_TABLE}" --region "${AWS_REGION}" >/dev/null 2>&1; then
  echo "✓ lock table exists"
else
  echo "→ creating lock table"
  aws dynamodb create-table --table-name "${LOCK_TABLE}" --region "${AWS_REGION}" \
    --attribute-definitions AttributeName=LockID,AttributeType=S \
    --key-schema AttributeName=LockID,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST
  aws dynamodb wait table-exists --table-name "${LOCK_TABLE}" --region "${AWS_REGION}"
  echo "✓ lock table ready"
fi

echo
echo "Backend ready. Now uncomment the backend \"s3\" block in versions.tf, then:"
echo "  terraform init"
