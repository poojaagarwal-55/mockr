# CloudWatch alarms → SNS → email. Enabled only when alarm_email is set.

locals {
  alarms_enabled = var.alarm_email != ""

  # Public services that sit behind the ALB (have a target group).
  alb_services = {
    "practers-api"    = module.practers_api.target_group_arn_suffix
    "contest-service" = module.contest_service.target_group_arn_suffix
    "p2p-service"     = module.p2p_service.target_group_arn_suffix
  }

  cpu_services = ["practers-api", "contest-service", "p2p-service", "latex-compiler"]
}

resource "aws_sns_topic" "alerts" {
  count = local.alarms_enabled ? 1 : 0
  name  = "practers-alerts-${var.environment_name}"
}

resource "aws_sns_topic_subscription" "email" {
  count     = local.alarms_enabled ? 1 : 0
  topic_arn = aws_sns_topic.alerts[0].arn
  protocol  = "email"
  endpoint  = var.alarm_email # confirm via the email AWS sends after apply
}

# ── ALB 5xx (load-balancer generated) ───────────────────────────────────────
resource "aws_cloudwatch_metric_alarm" "alb_5xx" {
  count               = local.alarms_enabled ? 1 : 0
  alarm_name          = "practers-alb-5xx-${var.environment_name}"
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_ELB_5XX_Count"
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 3
  threshold           = 10
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  dimensions          = { LoadBalancer = aws_lb.this.arn_suffix }
  alarm_actions       = [aws_sns_topic.alerts[0].arn]
  ok_actions          = [aws_sns_topic.alerts[0].arn]
}

# ── Per-service unhealthy targets ───────────────────────────────────────────
resource "aws_cloudwatch_metric_alarm" "unhealthy_hosts" {
  for_each            = local.alarms_enabled ? local.alb_services : {}
  alarm_name          = "practers-${each.key}-unhealthy-${var.environment_name}"
  namespace           = "AWS/ApplicationELB"
  metric_name         = "UnHealthyHostCount"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 3
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  dimensions = {
    LoadBalancer = aws_lb.this.arn_suffix
    TargetGroup  = each.value
  }
  alarm_actions = [aws_sns_topic.alerts[0].arn]
  ok_actions    = [aws_sns_topic.alerts[0].arn]
}

# ── Per-service high CPU ────────────────────────────────────────────────────
resource "aws_cloudwatch_metric_alarm" "cpu_high" {
  for_each            = local.alarms_enabled ? toset(local.cpu_services) : []
  alarm_name          = "practers-${each.value}-cpu-high-${var.environment_name}"
  namespace           = "AWS/ECS"
  metric_name         = "CPUUtilization"
  statistic           = "Average"
  period              = 60
  evaluation_periods  = 5
  threshold           = 85
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  dimensions = {
    ClusterName = aws_ecs_cluster.this.name
    ServiceName = each.value
  }
  alarm_actions = [aws_sns_topic.alerts[0].arn]
}
