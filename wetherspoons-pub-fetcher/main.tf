variable "sns_topic_arn" {
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

  inline_policy {
    name = "sns-publish"
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
}

resource "aws_lambda_function" "wetherspoons_pub_fetcher" {
  architectures = [
    "arm64",
  ]

  function_name                  = "wetherspoons-pub-fetcher"
  filename                       = "${path.module}/dist/index.zip"
  source_code_hash               = filebase64sha256("${path.module}/dist/index.zip")
  handler                        = "index.handler"
  memory_size                    = 128
  reserved_concurrent_executions = -1
  role                           = aws_iam_role.wetherspoons_pub_fetcher_role.arn
  runtime                        = "nodejs16.x"
  timeout                        = 30

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

resource "aws_cloudwatch_event_rule" "every_monday" {
  name                = "every-monday"
  schedule_expression = "cron(0 12 ? * MON *)"
}

resource "aws_cloudwatch_event_target" "wetherspoons_pub_fetcher" {
  rule = aws_cloudwatch_event_rule.every_monday.name
  arn  = aws_lambda_function.wetherspoons_pub_fetcher.arn
}

resource "aws_lambda_permission" "wetherspoons_pub_fetcher" {
  statement_id  = "AllowExecutionFromCloudWatch"
  action        = "lambda:InvokeFunction"
  principal     = "events.amazonaws.com"
  function_name = aws_lambda_function.wetherspoons_pub_fetcher.function_name
  source_arn    = aws_cloudwatch_event_rule.every_monday.arn
}
