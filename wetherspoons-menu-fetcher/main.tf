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
  batch_size                         = 10
  maximum_batching_window_in_seconds = 5
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
  evaluation_periods  = 2
  threshold           = 10
  alarm_description   = "This metric monitors menu-fetcher error rate"
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
        FunctionName = aws_lambda_function.wetherspoons_menu_fetcher.function_name
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
        FunctionName = aws_lambda_function.wetherspoons_menu_fetcher.function_name
      }
    }
  }
}
