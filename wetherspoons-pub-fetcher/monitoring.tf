resource "aws_cloudwatch_metric_alarm" "pub_fetcher_error_rate" {
  alarm_name          = "pub-fetcher-error-rate-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = 0
  alarm_description   = "The pub-fetcher Lambda invocation failed unexpectedly"
  alarm_actions       = [var.alarm_sns_topic_arn]
  treat_missing_data  = "notBreaching"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  period              = 300
  statistic           = "Sum"
  dimensions = {
    FunctionName = aws_lambda_function.wetherspoons_pub_fetcher.function_name
  }
}

resource "aws_cloudwatch_metric_alarm" "scheduler_target_errors" {
  alarm_name          = "wetherspoons-scheduler-target-errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = 0
  alarm_description   = "EventBridge Scheduler failed to deliver a collector invocation"
  alarm_actions       = [var.alarm_sns_topic_arn]
  treat_missing_data  = "notBreaching"
  namespace           = "AWS/Scheduler"
  metric_name         = "TargetErrorCount"
  period              = 300
  statistic           = "Sum"

  dimensions = {
    ScheduleGroup = "default"
  }
}
