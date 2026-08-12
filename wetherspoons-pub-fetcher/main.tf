variable "sns_topic_arn" {
  type = string
}

variable "alarm_sns_topic_arn" {
  type        = string
  description = "SNS topic ARN for CloudWatch alarms"
}

variable "run_table_arn" {
  type = string
}

variable "run_table_name" {
  type = string
}

resource "aws_iam_role" "wetherspoons_pub_fetcher_role" {
  assume_role_policy = jsonencode(
    {
      Statement = [
        {
          Action = "sts:AssumeRole"
          Effect = "Allow"
          Principal = {
            Service = "lambda.amazonaws.com"
          }
        },
      ]
      Version = "2012-10-17"
    }
  )
  name = "wetherspoons-pub-fetcher-role"
}

resource "aws_iam_role_policy" "wetherspoons_pub_fetcher_sns" {
  name = "sns-publish"
  role = aws_iam_role.wetherspoons_pub_fetcher_role.id
  policy = jsonencode(
    {
      Statement = [
        {
          Action   = "sns:Publish"
          Effect   = "Allow"
          Resource = var.sns_topic_arn
          Sid      = "VisualEditor0"
        },
      ]
      Version = "2012-10-17"
    }
  )
}

resource "aws_iam_role_policy" "wetherspoons_pub_fetcher_runs" {
  name = "run-ledger"
  role = aws_iam_role.wetherspoons_pub_fetcher_role.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = [
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
      ]
      Effect   = "Allow"
      Resource = var.run_table_arn
    }]
  })
}

resource "aws_lambda_function" "wetherspoons_pub_fetcher" {
  architectures = [
    "arm64",
  ]

  function_name                  = "wetherspoons-pub-fetcher"
  filename                       = "${path.module}/dist/index.zip"
  source_code_hash               = filebase64sha256("${path.module}/dist/index.zip")
  handler                        = "index.handler"
  memory_size                    = 256
  reserved_concurrent_executions = -1
  role                           = aws_iam_role.wetherspoons_pub_fetcher_role.arn
  runtime                        = "nodejs24.x"
  timeout                        = 120

  environment {
    variables = {
      PUBS_TOPIC_ARN = var.sns_topic_arn
      RUN_TABLE_NAME = var.run_table_name
    }
  }

  ephemeral_storage {
    size = 512
  }
}

resource "aws_cloudwatch_log_group" "wetherspoons_pub_fetcher" {
  name              = "/aws/lambda/${aws_lambda_function.wetherspoons_pub_fetcher.function_name}"
  retention_in_days = 7
  lifecycle {
    prevent_destroy = false
  }
}

resource "aws_iam_policy" "wetherspoons_pub_fetcher" {
  name = "wetherspoons-pub-fetcher-logging-policy"
  policy = jsonencode(
    {
      Version = "2012-10-17"
      Statement = [
        {
          Action = [
            "logs:CreateLogStream",
            "logs:PutLogEvents",
          ]
          Effect   = "Allow"
          Resource = "${aws_cloudwatch_log_group.wetherspoons_pub_fetcher.arn}:*"
        },
      ]
    }
  )

}

resource "aws_iam_role_policy_attachment" "wetherspoons_pub_fetcher" {
  role       = aws_iam_role.wetherspoons_pub_fetcher_role.id
  policy_arn = aws_iam_policy.wetherspoons_pub_fetcher.arn
}

resource "aws_cloudwatch_event_rule" "every_hour" {
  name                = "every-hour"
  schedule_expression = "cron(0 * ? * * *)"
}

resource "aws_cloudwatch_event_target" "wetherspoons_pub_fetcher" {
  rule = aws_cloudwatch_event_rule.every_hour.name
  arn  = aws_lambda_function.wetherspoons_pub_fetcher.arn
}

resource "aws_lambda_permission" "wetherspoons_pub_fetcher" {
  statement_id  = "AllowExecutionFromCloudWatch"
  action        = "lambda:InvokeFunction"
  principal     = "events.amazonaws.com"
  function_name = aws_lambda_function.wetherspoons_pub_fetcher.function_name
  source_arn    = aws_cloudwatch_event_rule.every_hour.arn
}

# CloudWatch metric filter for errors
resource "aws_cloudwatch_log_metric_filter" "pub_fetcher_errors" {
  name           = "pub-fetcher-errors"
  log_group_name = aws_cloudwatch_log_group.wetherspoons_pub_fetcher.name
  pattern        = "[ERROR]"

  metric_transformation {
    name          = "PubFetcherErrors"
    namespace     = "WetherspoonsPriceTracker"
    value         = "1"
    default_value = 0
  }
}

# CloudWatch alarm for error rate > 10%
resource "aws_cloudwatch_metric_alarm" "pub_fetcher_error_rate" {
  alarm_name          = "pub-fetcher-error-rate-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  threshold           = 10
  alarm_description   = "This metric monitors pub-fetcher error rate"
  alarm_actions       = [var.alarm_sns_topic_arn]
  treat_missing_data  = "notBreaching"

  metric_query {
    id          = "error_rate"
    expression  = "(errors / invocations) * 100"
    label       = "Error Rate"
    return_data = true
  }

  metric_query {
    id = "errors"
    metric {
      metric_name = "Errors"
      namespace   = "AWS/Lambda"
      period      = 300
      stat        = "Sum"
      dimensions = {
        FunctionName = aws_lambda_function.wetherspoons_pub_fetcher.function_name
      }
    }
  }

  metric_query {
    id = "invocations"
    metric {
      metric_name = "Invocations"
      namespace   = "AWS/Lambda"
      period      = 300
      stat        = "Sum"
      dimensions = {
        FunctionName = aws_lambda_function.wetherspoons_pub_fetcher.function_name
      }
    }
  }
}
