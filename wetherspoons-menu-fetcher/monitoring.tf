resource "aws_cloudwatch_log_metric_filter" "menu_record_failures" {
  name           = "menu-record-failures"
  log_group_name = aws_cloudwatch_log_group.wetherspoons_menu_fetcher.name
  pattern        = "MENU_RECORD_FAILED"

  metric_transformation {
    name          = "MenuRecordFailures"
    namespace     = "WetherspoonsPriceTracker"
    value         = "1"
    default_value = 0
  }
}

resource "aws_cloudwatch_metric_alarm" "menu_record_failures" {
  alarm_name          = "menu-record-failures"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = 9
  alarm_description   = "At least 10 distinct pubs exhausted processing attempts in the last hour; isolated failures are assessed across UK calendar days"
  alarm_actions       = [var.alarm_sns_topic_arn]
  treat_missing_data  = "notBreaching"
  namespace           = "WetherspoonsPriceTracker"
  metric_name         = "FailedPubsLastHour"
  period              = 3600
  statistic           = "Maximum"
}

resource "aws_cloudwatch_metric_alarm" "menu_fetcher_error_rate" {
  alarm_name          = "menu-fetcher-error-rate-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = 0
  alarm_description   = "The menu-fetcher Lambda invocation failed unexpectedly"
  alarm_actions       = [var.alarm_sns_topic_arn]
  treat_missing_data  = "notBreaching"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  period              = 300
  statistic           = "Sum"
  dimensions = {
    FunctionName = aws_lambda_function.wetherspoons_menu_fetcher.function_name
  }
}

resource "aws_cloudwatch_metric_alarm" "menu_fetcher_throttles" {
  alarm_name          = "menu-fetcher-throttled"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = 0
  alarm_description   = "The menu-fetcher Lambda was throttled before it could process queued work"
  alarm_actions       = [var.alarm_sns_topic_arn]
  treat_missing_data  = "notBreaching"
  namespace           = "AWS/Lambda"
  metric_name         = "Throttles"
  period              = 300
  statistic           = "Sum"

  dimensions = {
    FunctionName = aws_lambda_function.wetherspoons_menu_fetcher.function_name
  }
}
