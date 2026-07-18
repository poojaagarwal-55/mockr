output "service_name" {
  value = aws_ecs_service.this.name
}

output "task_definition_arn" {
  value = aws_ecs_task_definition.this.arn
}

output "target_group_arn" {
  value = var.expose_via_alb ? aws_lb_target_group.this[0].arn : null
}

output "target_group_arn_suffix" {
  description = "For CloudWatch TargetGroup dimension."
  value       = var.expose_via_alb ? aws_lb_target_group.this[0].arn_suffix : null
}

output "service_discovery_name" {
  description = "Internal DNS name when service discovery is enabled."
  value       = var.enable_service_discovery ? aws_service_discovery_service.this[0].name : null
}
