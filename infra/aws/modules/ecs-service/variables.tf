variable "name" {
  description = "Service name (e.g. practers-api)."
  type        = string
}

variable "cluster_arn" {
  type = string
}

variable "cluster_name" {
  type = string
}

variable "image" {
  description = "Full ECR image reference including tag (repo_url:tag)."
  type        = string
}

variable "container_port" {
  type = number
}

variable "cpu" {
  description = "Task-level CPU units (256 = 0.25 vCPU, 1024 = 1 vCPU, 2048 = 2 vCPU)."
  type        = number
}

variable "memory" {
  description = "Task-level memory in MiB (must be a valid Fargate cpu/memory pair)."
  type        = number
}

variable "desired_count" {
  type    = number
  default = 1
}

variable "min_count" {
  type    = number
  default = 1
}

variable "max_count" {
  type    = number
  default = 4
}

variable "environment" {
  description = "Plain (non-secret) environment variables."
  type        = map(string)
  default     = {}
}

variable "secrets" {
  description = "Map of ENV_VAR_NAME => SSM parameter ARN. Injected by ECS at task start."
  type        = map(string)
  default     = {}
}

variable "execution_role_arn" {
  type = string
}

variable "task_role_arn" {
  type = string
}

variable "subnet_ids" {
  description = "Subnets the tasks run in (private preferred; public if assign_public_ip)."
  type        = list(string)
}

variable "security_group_ids" {
  type = list(string)
}

variable "assign_public_ip" {
  description = "Give tasks a public IP (use when running in public subnets without a NAT gateway)."
  type        = bool
  default     = false
}

variable "log_group_name" {
  type = string
}

variable "aws_region" {
  type = string
}

variable "health_check_path" {
  type    = string
  default = "/health"
}

# ── ALB integration (public-facing services) ───────────────────────────────
variable "expose_via_alb" {
  type    = bool
  default = false
}

variable "vpc_id" {
  type    = string
  default = null
}

variable "alb_listener_arn" {
  description = "HTTPS listener ARN to attach the routing rule to."
  type        = string
  default     = null
}

variable "listener_rule_priority" {
  type    = number
  default = null
}

variable "host_headers" {
  description = "Host header(s) that route to this service on the shared ALB listener."
  type        = list(string)
  default     = []
}

variable "stickiness_enabled" {
  description = "Enable ALB cookie stickiness (required for session-affinity services)."
  type        = bool
  default     = false
}

variable "deregistration_delay" {
  type    = number
  default = 30
}

variable "health_check_grace_period" {
  type    = number
  default = 60
}

# ── Service discovery (internal-only services) ─────────────────────────────
variable "enable_service_discovery" {
  description = "Register this service in Cloud Map (static flag so count is known at plan time)."
  type        = bool
  default     = false
}

variable "service_discovery_namespace_id" {
  description = "Cloud Map private DNS namespace id. Used when enable_service_discovery is true."
  type        = string
  default     = null
}

# ── Autoscaling ────────────────────────────────────────────────────────────
variable "enable_autoscaling" {
  type    = bool
  default = true
}

variable "cpu_target_percent" {
  type    = number
  default = 65
}

variable "tags" {
  type    = map(string)
  default = {}
}
