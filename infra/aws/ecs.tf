resource "aws_ecs_cluster" "this" {
  name = "practers-${var.environment_name}"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_ecs_cluster_capacity_providers" "this" {
  cluster_name       = aws_ecs_cluster.this.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
    base              = 1
  }
}

# Private DNS for internal service-to-service calls (api -> latex-compiler).
resource "aws_service_discovery_private_dns_namespace" "internal" {
  name = "practers.internal"
  vpc  = module.vpc.vpc_id
}

# One log group per service.
resource "aws_cloudwatch_log_group" "svc" {
  for_each          = toset(local.service_names)
  name              = "/ecs/practers/${each.value}"
  retention_in_days = 30
}

locals {
  # Convenience: GCP-secret-name -> SSM parameter ARN.
  ssm = { for k, p in aws_ssm_parameter.secret : k => p.arn }

  latex_internal_url = "http://latex-compiler.${aws_service_discovery_private_dns_namespace.internal.name}:3002"

  # ── Per-service secret maps: CONTAINER_ENV_VAR => SSM ARN ──────────────────
  api_secrets = {
    DATABASE_URL                  = local.ssm["database-url"]
    DIRECT_URL                    = local.ssm["direct-url"]
    MONGODB_URI                   = local.ssm["mongodb-uri"]
    REDIS_URL                     = local.ssm["redis-url"]
    SUPABASE_SERVICE_ROLE_KEY     = local.ssm["supabase-service-role-key"]
    XAI_API_KEY                   = local.ssm["xai-api-key"]
    JUDGE0_API_URL                = local.ssm["judge0-api-url"]
    JUDGE0_API_KEY                = local.ssm["judge0-api-key"]
    JUDGE0_CHUNK_CONCURRENCY      = local.ssm["judge0-chunk-concurrency"]
    S3_ENDPOINT                   = local.ssm["s3-endpoint"]
    S3_BUCKET                     = local.ssm["s3-bucket"]
    S3_ACCESS_KEY                 = local.ssm["s3-access-key"]
    S3_SECRET_KEY                 = local.ssm["s3-secret-key"]
    JWT_SECRET                    = local.ssm["jwt-secret"]
    RAZORPAY_KEY_ID               = local.ssm["razorpay-key-id"]
    RAZORPAY_KEY_SECRET           = local.ssm["razorpay-key-secret"]
    RAZORPAY_WEBHOOK_SECRET       = local.ssm["razorpay-webhook-secret"]
    DEEPGRAM_API_KEY              = local.ssm["deepgram-api-key"]
    ENCRYPTION_KEY                = local.ssm["encryption-key"]
    GROQ_API_KEY                  = local.ssm["groq-api-key"]
    RESEND_API_KEY                = local.ssm["resend-api-key"]
    ADMIN_NOTIFICATION_EMAIL      = local.ssm["admin-notification-email"]
    RESEND_AUTH_API_KEY           = local.ssm["resend-auth-api-key"]
    RESEND_VERIFIED_DOMAIN        = local.ssm["resend-verified-domain"]
    MSG91_WIDGET_ID               = local.ssm["msg91-widget-id"]
    MSG91_WIDGET_TOKEN            = local.ssm["msg91-widget-token"]
    MSG91_AUTH_KEY                = local.ssm["msg91-auth-key"]
    MSG91_SENDER_ID               = local.ssm["msg91-sender-id"]
    UPSTASH_REDIS_REST_URL        = local.ssm["upstash-redis-rest-url"]
    UPSTASH_REDIS_REST_TOKEN      = local.ssm["upstash-redis-rest-token"]
    QUEUE_REDIS_URL               = local.ssm["queue-redis-url"]
    BULLMQ_REDIS_URL              = local.ssm["queue-redis-url"]
    R2_AVATAR_BUCKET              = local.ssm["r2-avatar-bucket"]
    R2_AVATAR_PUBLIC_URL          = local.ssm["r2-avatar-public-url"]
    R2_BLOG_IMAGES_BUCKET         = local.ssm["r2-blog-images-bucket"]
    R2_BLOG_IMAGES_PUBLIC_URL     = local.ssm["r2-blog-images-public-url"]
    R2_RECORDINGS_ENDPOINT        = local.ssm["r2-recordings-endpoint"]
    R2_RECORDINGS_ACCESS_KEY      = local.ssm["r2-recordings-access-key"]
    R2_RECORDINGS_SECRET_KEY      = local.ssm["r2-recordings-secret-key"]
    R2_RECORDINGS_BUCKET          = local.ssm["r2-recordings-bucket"]
    TUTOR_AGENT_V2                = local.ssm["tutor-agent-v2"]
    ADMIN_EMAILS                  = local.ssm["admin-emails"]
    NEXT_PUBLIC_SUPABASE_URL      = local.ssm["next-public-supabase-url"]
    NEXT_PUBLIC_SUPABASE_ANON_KEY = local.ssm["next-public-supabase-anon-key"]
    FRONTEND_URL                  = local.ssm["frontend-url"]
    COMPANY_FRONTEND_URL          = local.ssm["company-frontend-url"]
    BLOG_TEAM_AUTHOR_EMAILS       = local.ssm["BLOG_TEAM_AUTHOR_EMAILS"]
    BLOG_TEAM_DISPLAY_NAME        = local.ssm["BLOG_TEAM_DISPLAY_NAME"]
    BLOG_TEAM_AVATAR_URL          = local.ssm["BLOG_TEAM_AVATAR_URL"]
    CLOUDFLARE_TURN_KEY_ID        = local.ssm["cloudflare-turn-key-id"]
    CLOUDFLARE_TURN_API_TOKEN     = local.ssm["cloudflare-turn-api-token"]
  }

  contest_secrets = {
    DATABASE_URL              = local.ssm["database-url"]
    DIRECT_URL                = local.ssm["direct-url"]
    MONGODB_URI               = local.ssm["mongodb-uri"]
    REDIS_URL                 = local.ssm["upstash-redis-rest-url"]
    UPSTASH_REDIS_REST_URL    = local.ssm["upstash-redis-rest-url"]
    UPSTASH_REDIS_REST_TOKEN  = local.ssm["upstash-redis-rest-token"]
    QUEUE_REDIS_URL           = local.ssm["queue-redis-url"]
    SUPABASE_URL              = local.ssm["next-public-supabase-url"]
    SUPABASE_ANON_KEY         = local.ssm["next-public-supabase-anon-key"]
    SUPABASE_SERVICE_ROLE_KEY = local.ssm["supabase-service-role-key"]
    JUDGE0_API_URL            = local.ssm["judge0-api-url"]
    JUDGE0_API_KEY            = local.ssm["judge0-api-key"]
    JUDGE0_CHUNK_CONCURRENCY  = local.ssm["judge0-chunk-concurrency"]
    ADMIN_EMAILS              = local.ssm["admin-emails"]
    ALLOWED_ORIGINS           = local.ssm["contest-allowed-origins"]
  }

  p2p_secrets = {
    DATABASE_URL              = local.ssm["database-url"]
    DIRECT_URL                = local.ssm["direct-url"]
    NEXT_PUBLIC_SUPABASE_URL  = local.ssm["next-public-supabase-url"]
    SUPABASE_SERVICE_ROLE_KEY = local.ssm["supabase-service-role-key"]
    REDIS_URL                 = local.ssm["p2p-redis-url"]
    MONGODB_URI               = local.ssm["mongodb-uri"]
    FRONTEND_URL              = local.ssm["frontend-url"]
    NEXT_PUBLIC_APP_URL       = local.ssm["frontend-url"]
  }
}

# ── practers-api (public) ───────────────────────────────────────────────────
module "practers_api" {
  source = "./modules/ecs-service"

  name           = "practers-api"
  cluster_arn    = aws_ecs_cluster.this.arn
  cluster_name   = aws_ecs_cluster.this.name
  image          = "${aws_ecr_repository.svc["practers-api"].repository_url}:${var.image_tag}"
  container_port = 8080
  cpu            = 1024
  memory         = 2048
  desired_count  = 1
  min_count      = 1
  max_count      = 10

  environment = {
    NODE_ENV             = "production"
    API_PORT             = "8080"
    API_HOST             = "0.0.0.0"
    CORS_ALLOWED_ORIGINS = var.cors_allowed_origins
    LATEX_COMPILER_URL   = local.latex_internal_url
  }
  secrets = local.api_secrets

  execution_role_arn = aws_iam_role.task_execution.arn
  task_role_arn      = aws_iam_role.task.arn
  subnet_ids         = local.task_subnet_ids
  assign_public_ip   = local.assign_public_ip
  security_group_ids = [aws_security_group.tasks.id]
  log_group_name     = aws_cloudwatch_log_group.svc["practers-api"].name
  aws_region         = var.aws_region

  expose_via_alb         = true
  vpc_id                 = module.vpc.vpc_id
  alb_listener_arn       = aws_lb_listener.https.arn
  listener_rule_priority = 10
  host_headers           = [var.api_hostname]
}

# ── contest-service (public, sticky, WebSockets + BullMQ workers) ───────────
module "contest_service" {
  source = "./modules/ecs-service"

  name           = "contest-service"
  cluster_arn    = aws_ecs_cluster.this.arn
  cluster_name   = aws_ecs_cluster.this.name
  image          = "${aws_ecr_repository.svc["contest-service"].repository_url}:${var.image_tag}"
  container_port = 8080
  cpu            = 2048
  memory         = 4096
  desired_count  = 1
  min_count      = 1
  max_count      = 10

  environment = {
    NODE_ENV                     = "production"
    PORT                         = "8080"
    JUDGE0_ALLOW_SHARED_ENDPOINT = "true"
  }
  secrets = local.contest_secrets

  execution_role_arn = aws_iam_role.task_execution.arn
  task_role_arn      = aws_iam_role.task.arn
  subnet_ids         = local.task_subnet_ids
  assign_public_ip   = local.assign_public_ip
  security_group_ids = [aws_security_group.tasks.id]
  log_group_name     = aws_cloudwatch_log_group.svc["contest-service"].name
  aws_region         = var.aws_region

  expose_via_alb         = true
  vpc_id                 = module.vpc.vpc_id
  alb_listener_arn       = aws_lb_listener.https.arn
  listener_rule_priority = 20
  host_headers           = [var.contest_hostname]
  stickiness_enabled     = true # Cloud Run --session-affinity
}

# ── p2p-service (public, sticky, DELIBERATELY single-instance) ──────────────
module "p2p_service" {
  source = "./modules/ecs-service"

  name           = "p2p-service"
  cluster_arn    = aws_ecs_cluster.this.arn
  cluster_name   = aws_ecs_cluster.this.name
  image          = "${aws_ecr_repository.svc["p2p-service"].repository_url}:${var.image_tag}"
  container_port = 8080
  cpu            = 1024
  memory         = 2048
  desired_count  = 1
  min_count      = 1
  max_count      = 1

  # Socket.io Redis adapter is off + matchmaking polls every 5s → must be 1 task.
  # To scale out later: set P2P_REDIS_ADAPTER=1, raise max_count, re-enable autoscaling.
  enable_autoscaling = false

  environment = {
    NODE_ENV                     = "production"
    P2P_PORT                     = "8080"
    P2P_HOST                     = "0.0.0.0"
    P2P_ORCHESTRATOR_INTERVAL_MS = "5000"
  }
  secrets = local.p2p_secrets

  execution_role_arn = aws_iam_role.task_execution.arn
  task_role_arn      = aws_iam_role.task.arn
  subnet_ids         = local.task_subnet_ids
  assign_public_ip   = local.assign_public_ip
  security_group_ids = [aws_security_group.tasks.id]
  log_group_name     = aws_cloudwatch_log_group.svc["p2p-service"].name
  aws_region         = var.aws_region

  expose_via_alb         = true
  vpc_id                 = module.vpc.vpc_id
  alb_listener_arn       = aws_lb_listener.https.arn
  listener_rule_priority = 30
  host_headers           = [var.p2p_hostname]
  stickiness_enabled     = true
}

# ── latex-compiler (INTERNAL only, Cloud Map DNS, not on the ALB) ───────────
module "latex_compiler" {
  source = "./modules/ecs-service"

  name           = "latex-compiler"
  cluster_arn    = aws_ecs_cluster.this.arn
  cluster_name   = aws_ecs_cluster.this.name
  image          = "${aws_ecr_repository.svc["latex-compiler"].repository_url}:${var.image_tag}"
  container_port = 3002
  cpu            = 1024
  memory         = 2048
  desired_count  = 1
  min_count      = 1
  max_count      = 4

  environment = {
    MAX_COMPILE_TIME = "60"
  }

  execution_role_arn = aws_iam_role.task_execution.arn
  task_role_arn      = aws_iam_role.task.arn
  subnet_ids         = local.task_subnet_ids
  assign_public_ip   = local.assign_public_ip
  security_group_ids = [aws_security_group.tasks.id]
  log_group_name     = aws_cloudwatch_log_group.svc["latex-compiler"].name
  aws_region         = var.aws_region

  # No ALB — reached at latex-compiler.practers.internal:3002 by practers-api.
  health_check_path              = "/"
  enable_service_discovery       = true
  service_discovery_namespace_id = aws_service_discovery_private_dns_namespace.internal.id
}
