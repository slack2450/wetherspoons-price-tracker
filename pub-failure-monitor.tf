resource "aws_iam_role" "pub_failure_monitor" {
  name = "wetherspoons-pub-failure-monitor"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_cloudwatch_log_group" "pub_failure_monitor" {
  name              = "/aws/lambda/wetherspoons-pub-failure-monitor"
  retention_in_days = 14
}

data "aws_caller_identity" "monitor" {}
data "aws_region" "monitor" {}

locals {
  menu_log_group_arn = "arn:aws:logs:${data.aws_region.monitor.region}:${data.aws_caller_identity.monitor.account_id}:log-group:/aws/lambda/wetherspoons-menu-fetcher"
}

resource "aws_iam_role_policy" "pub_failure_monitor" {
  role = aws_iam_role.pub_failure_monitor.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["logs:StartQuery"]
        Resource = [local.menu_log_group_arn, "${local.menu_log_group_arn}:*"]
      },
      {
        Effect   = "Allow"
        Action   = ["logs:GetQueryResults", "logs:StopQuery"]
        Resource = "*"
      },
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.pub_failure_monitor.arn}:*"
      },
      {
        Effect   = "Allow"
        Action   = ["cloudwatch:PutMetricData"]
        Resource = "*"
        Condition = {
          StringEquals = { "cloudwatch:namespace" = "WetherspoonsPriceTracker" }
        }
      }
    ]
  })
}

resource "aws_lambda_function" "pub_failure_monitor" {
  function_name    = "wetherspoons-pub-failure-monitor"
  role             = aws_iam_role.pub_failure_monitor.arn
  runtime          = "python3.13"
  architectures    = ["arm64"]
  handler          = "monitor.handler"
  filename         = "${path.module}/pub-failure-monitor/dist/index.zip"
  source_code_hash = filebase64sha256("${path.module}/pub-failure-monitor/dist/index.zip")
  timeout          = 120
  memory_size      = 128
  environment {
    variables = {
      COLLECTOR_LOG_GROUP = "/aws/lambda/wetherspoons-menu-fetcher"
    }
  }
  depends_on = [aws_iam_role_policy.pub_failure_monitor]
}

resource "aws_cloudwatch_event_rule" "pub_failure_monitor" {
  name                = "wetherspoons-pub-failure-monitor"
  description         = "Compare exhausted pub collections across UK calendar days"
  schedule_expression = "cron(10 * * * ? *)"
}

resource "aws_lambda_permission" "pub_failure_monitor" {
  statement_id  = "AllowScheduledFailureMonitor"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.pub_failure_monitor.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.pub_failure_monitor.arn
}

resource "aws_cloudwatch_event_target" "pub_failure_monitor" {
  rule      = aws_cloudwatch_event_rule.pub_failure_monitor.name
  target_id = "pub-failure-monitor"
  arn       = aws_lambda_function.pub_failure_monitor.arn
  retry_policy {
    maximum_event_age_in_seconds = 3600
    maximum_retry_attempts       = 2
  }
  depends_on = [aws_lambda_permission.pub_failure_monitor]
}

resource "aws_cloudwatch_metric_alarm" "recurring_pub_failures" {
  alarm_name          = "wetherspoons-recurring-pub-failures"
  alarm_description   = "The same pub exhausted collection attempts on both today and yesterday (Europe/London); see PUB_FAILURE_SUMMARY in the monitor logs for pub IDs"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  evaluation_periods  = 1
  period              = 3600
  statistic           = "Maximum"
  namespace           = "WetherspoonsPriceTracker"
  metric_name         = "RecurringFailedPubs"
  treat_missing_data  = "missing"
  alarm_actions       = [aws_sns_topic.wetherspoons_alarms.arn]
}

resource "aws_cloudwatch_metric_alarm" "unidentified_record_failures" {
  alarm_name          = "wetherspoons-unidentified-record-failures"
  alarm_description   = "Failed records lack a pub identity, so the single-pub notification exemption cannot safely be applied"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  evaluation_periods  = 1
  period              = 3600
  statistic           = "Maximum"
  namespace           = "WetherspoonsPriceTracker"
  metric_name         = "UnidentifiedRecordFailures"
  treat_missing_data  = "missing"
  alarm_actions       = [aws_sns_topic.wetherspoons_alarms.arn]
}

resource "aws_cloudwatch_metric_alarm" "pub_failure_monitor_errors" {
  for_each            = toset(["Errors", "Throttles"])
  alarm_name          = "wetherspoons-pub-failure-monitor-${lower(each.value)}"
  alarm_description   = "The pub failure monitor cannot complete; its failure must not silently disable collection alerts"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  evaluation_periods  = 1
  period              = 300
  statistic           = "Sum"
  namespace           = "AWS/Lambda"
  metric_name         = each.value
  treat_missing_data  = "notBreaching"
  dimensions = {
    FunctionName = aws_lambda_function.pub_failure_monitor.function_name
  }
  alarm_actions = [aws_sns_topic.wetherspoons_alarms.arn]
}

resource "aws_cloudwatch_metric_alarm" "pub_failure_monitor_delivery" {
  alarm_name          = "wetherspoons-pub-failure-monitor-delivery"
  alarm_description   = "The hourly pub failure monitor could not be invoked"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  evaluation_periods  = 1
  period              = 300
  statistic           = "Sum"
  namespace           = "AWS/Events"
  metric_name         = "FailedInvocations"
  treat_missing_data  = "notBreaching"
  dimensions = {
    RuleName = aws_cloudwatch_event_rule.pub_failure_monitor.name
  }
  alarm_actions = [aws_sns_topic.wetherspoons_alarms.arn]
}
