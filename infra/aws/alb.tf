locals {
  # Use a provided cert, else create/validate one for the three hostnames.
  create_cert = var.acm_certificate_arn == ""
  cert_arn    = local.create_cert ? aws_acm_certificate.this[0].arn : var.acm_certificate_arn

  # ARN the HTTPS listener attaches to — must be a *validated* cert. Depending on
  # the validation resource makes the listener (and everything after it) wait
  # until the cert is ISSUED, whether validation is via Route53 or external DNS.
  validated_cert_arn = local.create_cert ? (
    var.manage_route53
    ? aws_acm_certificate_validation.this[0].certificate_arn
    : aws_acm_certificate_validation.external[0].certificate_arn
  ) : var.acm_certificate_arn
}

# External-DNS validation: waits for the cert to reach ISSUED after you add the
# CNAME records (see `terraform output acm_validation_records`) at your registrar.
resource "aws_acm_certificate_validation" "external" {
  count           = (local.create_cert && !var.manage_route53) ? 1 : 0
  certificate_arn = aws_acm_certificate.this[0].arn

  timeouts {
    create = "3h"
  }
}

resource "aws_lb" "this" {
  name               = "practers-${var.environment_name}"
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = module.vpc.public_subnets

  # WebSocket connections (contest + p2p) must survive long idle gaps.
  idle_timeout = 3600
}

# ── TLS certificate (only when one isn't supplied) ──────────────────────────
resource "aws_acm_certificate" "this" {
  count                     = local.create_cert ? 1 : 0
  domain_name               = var.api_hostname
  subject_alternative_names = [var.contest_hostname, var.p2p_hostname]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

# DNS validation records — only when Terraform also manages the Route53 zone.
resource "aws_route53_record" "cert_validation" {
  for_each = (local.create_cert && var.manage_route53) ? {
    for dvo in aws_acm_certificate.this[0].domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  } : {}

  zone_id = var.route53_zone_id
  name    = each.value.name
  type    = each.value.type
  records = [each.value.record]
  ttl     = 60
}

resource "aws_acm_certificate_validation" "this" {
  count                   = (local.create_cert && var.manage_route53) ? 1 : 0
  certificate_arn         = aws_acm_certificate.this[0].arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

# ── Listeners ───────────────────────────────────────────────────────────────
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = local.validated_cert_arn

  # Unmatched hosts get a plain 404 rather than routing anywhere.
  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "Not found"
      status_code  = "404"
    }
  }
}

# ── DNS records to the ALB (only when Terraform manages Route53) ────────────
resource "aws_route53_record" "api" {
  count   = var.manage_route53 ? 1 : 0
  zone_id = var.route53_zone_id
  name    = var.api_hostname
  type    = "A"
  alias {
    name                   = aws_lb.this.dns_name
    zone_id                = aws_lb.this.zone_id
    evaluate_target_health = true
  }
}

resource "aws_route53_record" "contest" {
  count   = var.manage_route53 ? 1 : 0
  zone_id = var.route53_zone_id
  name    = var.contest_hostname
  type    = "A"
  alias {
    name                   = aws_lb.this.dns_name
    zone_id                = aws_lb.this.zone_id
    evaluate_target_health = true
  }
}

resource "aws_route53_record" "p2p" {
  count   = var.manage_route53 ? 1 : 0
  zone_id = var.route53_zone_id
  name    = var.p2p_hostname
  type    = "A"
  alias {
    name                   = aws_lb.this.dns_name
    zone_id                = aws_lb.this.zone_id
    evaluate_target_health = true
  }
}
