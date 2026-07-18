locals {
  ssm_prefix = "/practers/${var.environment_name}"

  # Every secret currently in GCP Secret Manager (the "value" side of the
  # --set-secrets maps in cloudbuild.yaml / cloudbuild.p2p.yaml), keyed by its
  # GCP secret name. Services below alias these into the env-var names they read.
  #
  # NOTE: `latex-compiler-url` is intentionally omitted — on AWS the API reaches
  # latex-compiler over Cloud Map internal DNS (set as a plain env var, not a secret).
  secret_names = [
    "database-url",
    "direct-url",
    "mongodb-uri",
    "redis-url",
    "p2p-redis-url",
    "queue-redis-url",
    "upstash-redis-rest-url",
    "upstash-redis-rest-token",
    "next-public-supabase-url",
    "next-public-supabase-anon-key",
    "supabase-service-role-key",
    "xai-api-key",
    "groq-api-key",
    "deepgram-api-key",
    "judge0-api-url",
    "judge0-api-key",
    "judge0-chunk-concurrency",
    "s3-endpoint",
    "s3-bucket",
    "s3-access-key",
    "s3-secret-key",
    "jwt-secret",
    "encryption-key",
    "razorpay-key-id",
    "razorpay-key-secret",
    "razorpay-webhook-secret",
    "resend-api-key",
    "resend-auth-api-key",
    "resend-verified-domain",
    "admin-notification-email",
    "admin-emails",
    "msg91-widget-id",
    "msg91-widget-token",
    "msg91-auth-key",
    "msg91-sender-id",
    "r2-avatar-bucket",
    "r2-avatar-public-url",
    "r2-blog-images-bucket",
    "r2-blog-images-public-url",
    "r2-recordings-endpoint",
    "r2-recordings-access-key",
    "r2-recordings-secret-key",
    "r2-recordings-bucket",
    "tutor-agent-v2",
    "frontend-url",
    "company-frontend-url",
    "contest-allowed-origins",
    "cloudflare-turn-key-id",
    "cloudflare-turn-api-token",
    "BLOG_TEAM_AUTHOR_EMAILS",
    "BLOG_TEAM_DISPLAY_NAME",
    "BLOG_TEAM_AVATAR_URL",
  ]
}

# One SSM SecureString per secret. Terraform owns the parameter's existence and
# metadata; the actual VALUE is seeded out-of-band (scripts/seed-ssm.sh) and
# never stored in code or state — hence ignore_changes on `value`.
resource "aws_ssm_parameter" "secret" {
  for_each = toset(local.secret_names)

  name  = "${local.ssm_prefix}/${each.value}"
  type  = "SecureString"
  value = "PLACEHOLDER_SET_OUT_OF_BAND"
  tier  = "Standard"

  lifecycle {
    ignore_changes = [value]
  }
}
