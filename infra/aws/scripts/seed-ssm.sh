#!/usr/bin/env bash
# Seed SSM parameters from a local KEY=VALUE file (fallback when you can't pull
# from GCP directly). Keys are the GCP secret names; values are the real secrets.
#
# secrets.env format (gitignored):
#   database-url=postgresql://...
#   xai-api-key=xai-...
#
# Usage: ./seed-ssm.sh path/to/secrets.env [env]
set -euo pipefail

FILE="${1:?path to secrets.env required}"
ENV="${2:-prod}"
SSM_PREFIX="/practers/${ENV}"
AWS_REGION="${AWS_REGION:-ap-south-1}"

while IFS='=' read -r name value; do
  [[ -z "${name}" || "${name}" == \#* ]] && continue
  aws ssm put-parameter \
    --region "${AWS_REGION}" \
    --name "${SSM_PREFIX}/${name}" \
    --type SecureString \
    --value "${value}" \
    --overwrite >/dev/null
  echo "set ${SSM_PREFIX}/${name}"
done < "${FILE}"
