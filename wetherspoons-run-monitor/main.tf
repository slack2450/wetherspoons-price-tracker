variable "alarm_sns_topic_arn" {
  type = string
}

variable "dlq_arn" {
  type = string
}

variable "dlq_url" {
  type = string
}

variable "run_table_arn" {
  type = string
}

variable "run_table_name" {
  type = string
}

resource "aws_iam_role" "monitor" {
  name = "wetherspoons-run-monitor-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy" "monitor" {
  name = "pipeline-monitor"
  role = aws_iam_role.monitor.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action   = ["dynamodb:Scan"]
        Effect   = "Allow"
        Resource = var.run_table_arn
      },
      {
        Action   = ["sqs:GetQueueAttributes"]
        Effect   = "Allow"
        Resource = var.dlq_arn
      },
      {
        Action   = ["sns:Publish"]
        Effect   = "Allow"
        Resource = var.alarm_sns_topic_arn
      },
    ]
  })
}

resource "aws_lambda_function" "monitor" {
  function_name    = "wetherspoons-run-monitor"
  filename         = "${path.module}/dist/index.zip"
  source_code_hash = filebase64sha256("${path.module}/dist/index.zip")
  handler          = "index.handler"
  memory_size      = 256
  role             = aws_iam_role.monitor.arn
  runtime          = "nodejs24.x"
  timeout          = 30
  architectures    = ["arm64"]

  environment {
    variables = {
      ALARM_TOPIC_ARN = var.alarm_sns_topic_arn
      DLQ_URL         = var.dlq_url
      RUN_TABLE_NAME  = var.run_table_name
    }
  }
}

resource "aws_cloudwatch_log_group" "monitor" {
  name              = "/aws/lambda/${aws_lambda_function.monitor.function_name}"
  retention_in_days = 7
}

resource "aws_iam_role_policy" "logging" {
  name = "logging"
  role = aws_iam_role.monitor.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
      Effect   = "Allow"
      Resource = "${aws_cloudwatch_log_group.monitor.arn}:*"
    }]
  })
}

resource "aws_cloudwatch_event_rule" "hourly" {
  name                = "wetherspoons-run-monitor-hourly"
  schedule_expression = "cron(45 * ? * * *)"
}

resource "aws_cloudwatch_event_target" "monitor" {
  rule = aws_cloudwatch_event_rule.hourly.name
  arn  = aws_lambda_function.monitor.arn
}

resource "aws_lambda_permission" "events" {
  statement_id  = "AllowExecutionFromCloudWatch"
  action        = "lambda:InvokeFunction"
  principal     = "events.amazonaws.com"
  function_name = aws_lambda_function.monitor.function_name
  source_arn    = aws_cloudwatch_event_rule.hourly.arn
}

resource "aws_cloudwatch_log_metric_filter" "incomplete" {
  name           = "pipeline-incomplete"
  log_group_name = aws_cloudwatch_log_group.monitor.name
  pattern        = "PIPELINE_INCOMPLETE"

  metric_transformation {
    name          = "IncompletePipelineChecks"
    namespace     = "WetherspoonsPriceTracker"
    value         = "1"
    default_value = 0
  }
}

resource "aws_cloudwatch_metric_alarm" "incomplete" {
  alarm_name          = "wetherspoons-pipeline-incomplete"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = 0
  period              = 300
  statistic           = "Sum"
  namespace           = "WetherspoonsPriceTracker"
  metric_name         = "IncompletePipelineChecks"
  alarm_actions       = [var.alarm_sns_topic_arn]
  treat_missing_data  = "notBreaching"
}
