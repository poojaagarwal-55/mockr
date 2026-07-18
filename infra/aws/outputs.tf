output "alb_dns_name" {
  description = "Point api./contest./p2p. DNS at this (CNAME) or use Route53 alias."
  value       = aws_lb.this.dns_name
}

output "alb_zone_id" {
  value = aws_lb.this.zone_id
}

output "acm_certificate_arn" {
  value = local.cert_arn
}

output "acm_validation_records" {
  description = "Add these CNAME records at your DNS registrar to validate the TLS certificate."
  value = local.create_cert ? {
    for o in aws_acm_certificate.this[0].domain_validation_options :
    o.domain_name => {
      name  = o.resource_record_name
      type  = o.resource_record_type
      value = o.resource_record_value
    }
  } : {}
}

output "cluster_name" {
  value = aws_ecs_cluster.this.name
}

output "internal_namespace" {
  value = aws_service_discovery_private_dns_namespace.internal.name
}

output "ssm_parameter_prefix" {
  description = "Seed real secret values under this SSM path (scripts/seed-ssm.sh)."
  value       = local.ssm_prefix
}

output "api_hostname" {
  value = var.api_hostname
}

output "contest_hostname" {
  value = var.contest_hostname
}

output "p2p_hostname" {
  value = var.p2p_hostname
}
