data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  azs = slice(data.aws_availability_zones.available.names, 0, var.az_count)

  # Deterministic /20 subnets carved from the VPC CIDR.
  public_subnets  = [for i in range(var.az_count) : cidrsubnet(var.vpc_cidr, 4, i)]
  private_subnets = [for i in range(var.az_count) : cidrsubnet(var.vpc_cidr, 4, i + 8)]

  # Where Fargate tasks run. With a NAT gateway they sit in private subnets;
  # without one they sit in public subnets and get a public IP for egress.
  task_subnet_ids  = var.use_nat_gateway ? module.vpc.private_subnets : module.vpc.public_subnets
  assign_public_ip = var.use_nat_gateway ? false : true
}

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.8"

  name = "practers-${var.environment_name}"
  cidr = var.vpc_cidr

  azs             = local.azs
  public_subnets  = local.public_subnets
  private_subnets = local.private_subnets

  enable_nat_gateway   = var.use_nat_gateway
  single_nat_gateway   = var.single_nat_gateway
  enable_dns_hostnames = true
  enable_dns_support   = true
}

# ── Security groups ─────────────────────────────────────────────────────────
resource "aws_security_group" "alb" {
  name        = "practers-alb-${var.environment_name}"
  description = "Public ALB ingress"
  vpc_id      = module.vpc.vpc_id

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTP (redirected to HTTPS)"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "tasks" {
  name        = "practers-tasks-${var.environment_name}"
  description = "Fargate tasks"
  vpc_id      = module.vpc.vpc_id

  # Public services receive traffic from the ALB.
  ingress {
    description     = "From ALB"
    from_port       = 0
    to_port         = 65535
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  # Internal service-to-service calls (e.g. api -> latex-compiler:3002 via Cloud Map).
  ingress {
    description = "Intra-cluster"
    from_port   = 0
    to_port     = 65535
    protocol    = "tcp"
    self        = true
  }

  # Egress to Supabase, Upstash, MongoDB Atlas, RapidAPI, Resend, xAI, ECR, etc.
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
