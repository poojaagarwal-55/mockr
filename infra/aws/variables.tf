variable "aws_region" {
  description = "AWS region. ap-south-1 (Mumbai) matches Supabase/Upstash for lowest latency."
  type        = string
  default     = "ap-south-1"
}

variable "environment_name" {
  type    = string
  default = "prod"
}

variable "vpc_cidr" {
  type    = string
  default = "10.20.0.0/16"
}

variable "az_count" {
  description = "Number of AZs to spread subnets across."
  type        = number
  default     = 2
}

variable "single_nat_gateway" {
  description = "One shared NAT gateway (cheaper) vs one per AZ (HA). true is fine for this scale."
  type        = bool
  default     = true
}

variable "use_nat_gateway" {
  description = "If false, tasks run in public subnets with public IPs and no NAT (saves ~$32/mo)."
  type        = bool
  default     = true
}

# ── Domain / TLS ────────────────────────────────────────────────────────────
variable "root_domain" {
  description = "Root domain that hosts the API records (e.g. practers.com)."
  type        = string
  default     = "practers.com"
}

variable "api_hostname" {
  type    = string
  default = "api.practers.com"
}

variable "contest_hostname" {
  type    = string
  default = "contest.practers.com"
}

variable "p2p_hostname" {
  type    = string
  default = "p2p.practers.com"
}

variable "acm_certificate_arn" {
  description = "ARN of an ACM cert in this region covering the three hostnames. If empty, a cert is created and must be DNS-validated before apply completes."
  type        = string
  default     = ""
}

variable "manage_route53" {
  description = "Whether Terraform manages Route53 records. Set false if DNS lives elsewhere (you'll add CNAMEs to the ALB manually)."
  type        = bool
  default     = false
}

variable "route53_zone_id" {
  type    = string
  default = ""
}

# ── Images ──────────────────────────────────────────────────────────────────
variable "image_tag" {
  description = "Image tag to deploy for all services (CI overrides per-deploy)."
  type        = string
  default     = "latest"
}

# ── CI/CD (GitHub OIDC) ─────────────────────────────────────────────────────
variable "github_repo" {
  description = "org/repo allowed to assume the deploy role via OIDC."
  type        = string
  default     = "mockr-labs/practers"
}

variable "create_github_oidc_provider" {
  description = "Create the GitHub OIDC provider. Set false if it already exists in the account."
  type        = bool
  default     = true
}

# ── Alerts ──────────────────────────────────────────────────────────────────
variable "alarm_email" {
  description = "Email for CloudWatch alarms (5xx / unhealthy / CPU). Empty disables alarms."
  type        = string
  default     = ""
}

# ── Frontend origins (were GCP secrets; now plain config) ───────────────────
variable "frontend_url" {
  type    = string
  default = "https://www.practers.com"
}

variable "company_frontend_url" {
  type    = string
  default = "https://company.practers.com"
}

variable "cors_allowed_origins" {
  type    = string
  default = "https://www.practers.com,https://company.practers.com"
}
