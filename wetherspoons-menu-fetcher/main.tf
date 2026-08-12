variable "sqs_arn" {
  type = string
}

variable "influxdb_url" {
  type = string
}

variable "influxdb_write_api_token" {
  type = string
}

variable "influxdb_org" {
  type = string
}

variable "influxdb_bucket" {
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

variable "max_receive_count" {
  type        = number
  description = "Number of SQS receives before an individual venue is sent to the DLQ"
}

resource "aws_iam_role" "wetherspoons_menu_fetcher_role" {
  name = "wetherspoons-menu-fetcher-role"

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
}

resource "aws_iam_role_policy" "wetherspoons_menu_fetcher_sqs" {
  name = "SQS"
  role = aws_iam_role.wetherspoons_menu_fetcher_role.id
  policy = jsonencode(
    {
      Statement = [
        {
          Action = [
            "sqs:DeleteMessage",
            "sqs:GetQueueUrl",
            "sqs:ListDeadLetterSourceQueues",
            "sqs:ChangeMessageVisibility",
            "sqs:PurgeQueue",
            "sqs:ReceiveMessage",
            "sqs:DeleteQueue",
            "sqs:SendMessage",
            "sqs:GetQueueAttributes",
            "sqs:ListQueueTags",
            "sqs:CreateQueue",
            "sqs:SetQueueAttributes",
          ]
          Effect   = "Allow"
          Resource = var.sqs_arn
          Sid      = "VisualEditor0"
        },
        {
          Action   = "sqs:ListQueues"
          Effect   = "Allow"
          Resource = "*"
          Sid      = "VisualEditor1"
        },
      ]
      Version = "2012-10-17"
    }
  )
}

resource "aws_iam_role_policy" "wetherspoons_menu_fetcher_runs" {
  name = "run-ledger"
  role = aws_iam_role.wetherspoons_menu_fetcher_role.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = [
        "dynamodb:UpdateItem",
      ]
      Effect   = "Allow"
      Resource = var.run_table_arn
    }]
  })
}

resource "aws_lambda_function" "wetherspoons_menu_fetcher" {
  architectures = [
    "arm64",
  ]

  function_name                  = "wetherspoons-menu-fetcher"
  filename                       = "${path.module}/dist/index.zip"
  source_code_hash               = filebase64sha256("${path.module}/dist/index.zip")
  handler                        = "index.handler"
  memory_size                    = 512
  reserved_concurrent_executions = -1
  role                           = aws_iam_role.wetherspoons_menu_fetcher_role.arn
  runtime                        = "nodejs24.x"
  timeout                        = 120

  environment {
    variables = {
      INFLUXDB_URL             = var.influxdb_url
      INFLUXDB_WRITE_API_TOKEN = var.influxdb_write_api_token
      INFLUXDB_ORG             = var.influxdb_org
      INFLUXDB_BUCKET          = var.influxdb_bucket
      RUN_TABLE_NAME           = var.run_table_name
      MAX_RECEIVE_COUNT        = tostring(var.max_receive_count)
    }
  }

  ephemeral_storage {
    size = 512
  }
}

resource "aws_cloudwatch_log_group" "wetherspoons_menu_fetcher" {
  name              = "/aws/lambda/${aws_lambda_function.wetherspoons_menu_fetcher.function_name}"
  retention_in_days = 7
  lifecycle {
    prevent_destroy = false
  }
}

resource "aws_iam_policy" "wetherspoons_menu_fetcher" {
  name = "wetherspoons-menu-fetcher-logging-policy"
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
          Resource = "${aws_cloudwatch_log_group.wetherspoons_menu_fetcher.arn}:*"
        },
      ]
    }
  )

}

resource "aws_iam_role_policy_attachment" "wetherspoons_menu_fetcher" {
  role       = aws_iam_role.wetherspoons_menu_fetcher_role.id
  policy_arn = aws_iam_policy.wetherspoons_menu_fetcher.arn
}

resource "aws_lambda_event_source_mapping" "sqs_trigger" {
  event_source_arn                   = var.sqs_arn
  function_name                      = aws_lambda_function.wetherspoons_menu_fetcher.function_name
  batch_size                         = 5
  maximum_batching_window_in_seconds = 0
  function_response_types            = ["ReportBatchItemFailures"]

  scaling_config {
    maximum_concurrency = 5
  }
}

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
  threshold           = 0
  alarm_description   = "One or more individual pub menu records failed and will be retried"
  alarm_actions       = [var.alarm_sns_topic_arn]
  treat_missing_data  = "notBreaching"
  namespace           = "WetherspoonsPriceTracker"
  metric_name         = "MenuRecordFailures"
  period              = 300
  statistic           = "Sum"
}

# CloudWatch metric filter for errors
resource "aws_cloudwatch_log_metric_filter" "menu_fetcher_errors" {
  name           = "menu-fetcher-errors"
  log_group_name = aws_cloudwatch_log_group.wetherspoons_menu_fetcher.name
  pattern        = "[ERROR]"

  metric_transformation {
    name          = "MenuFetcherErrors"
    namespace     = "WetherspoonsPriceTracker"
    value         = "1"
    default_value = 0
  }
}

# CloudWatch alarm for error rate > 10%
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
