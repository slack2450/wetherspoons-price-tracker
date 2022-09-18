resource "aws_iam_role" "wetherspoons_pub_ranker_role" {
  name = "wetherspoons-pub-ranker-role"

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

  inline_policy {
    name = "DynamoDB"
    policy = jsonencode(
      {
        Statement = [
          {
            Action   = "dynamodb:*"
            Effect   = "Allow"
            Resource = "*"
            Sid      = "VisualEditor0"
          },
        ]
        Version = "2012-10-17"
      }
    )
  }
}

resource "aws_lambda_function" "wetherspoons_pub_ranker" {
  architectures = [
    "arm64",
  ]

  function_name                  = "wetherspoons-pub-ranker"
  filename                       = "${path.module}/dist/index.zip"
  source_code_hash               = filebase64sha256("${path.module}/dist/index.zip")
  handler                        = "index.handler"
  memory_size                    = 128
  reserved_concurrent_executions = -1
  role                           = aws_iam_role.wetherspoons_pub_ranker_role.arn
  runtime                        = "nodejs16.x"
  timeout                        = 60

  ephemeral_storage {
    size = 512
  }
}

resource "aws_cloudwatch_log_group" "wetherspoons_pub_ranker" {
  name              = "/aws/lambda/${aws_lambda_function.wetherspoons_pub_ranker.function_name}"
  retention_in_days = 7
  lifecycle {
    prevent_destroy = false
  }
}

resource "aws_iam_policy" "wetherspoons_pub_ranker" {
  name = "wetherspoons-pub-ranker-logging-policy"
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
          Resource = "${aws_cloudwatch_log_group.wetherspoons_pub_ranker.arn}:*"
        },
      ]
    }
  )
}

resource "aws_sns_topic" "wetherspoons_pub_ranker" {
  name = "wetherspoons-pub-ranker"
}

resource "aws_sns_topic_subscription" "sns_subscription" {
  endpoint = aws_lambda_function.wetherspoons_pub_ranker.arn
  protocol = "lambda"
  topic_arn = aws_sns_topic.wetherspoons_pub_ranker.arn
}

resource "aws_lambda_permission" "with_sns" {
  statement_id  = "AllowExecutionFromSNS"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.wetherspoons_pub_ranker.function_name
  principal     = "sns.amazonaws.com"
  source_arn    = aws_sns_topic.wetherspoons_pub_ranker.arn
}


resource "aws_iam_role_policy_attachment" "wetherspoons_pub_ranker" {
  role       = aws_iam_role.wetherspoons_pub_ranker_role.id
  policy_arn = aws_iam_policy.wetherspoons_pub_ranker.arn
}

resource "aws_cloudwatch_metric_alarm" "approx_messages_visible_alarm" {
    actions_enabled           = true
    alarm_actions             = []
    alarm_name                = "ApproximateNumberOfMessagesVisible"
    comparison_operator       = "LessThanThreshold"
    datapoints_to_alarm       = 1
    dimensions                = {
        "QueueName" = "wetherspoons-queue"
    }
    evaluation_periods        = 1
    insufficient_data_actions = []
    metric_name               = "ApproximateNumberOfMessagesVisible"
    namespace                 = "AWS/SQS"
    ok_actions                = []
    period                    = 900
    statistic                 = "Sum"
    tags                      = {}
    threshold                 = 1
    treat_missing_data        = "missing"
}

resource "aws_cloudwatch_metric_alarm" "approx_messages_not_visible_alarm" {
    actions_enabled           = true
    alarm_actions             = []
    alarm_name                = "ApproximateNumberOfMessagesNotVisible"
    comparison_operator       = "LessThanThreshold"
    datapoints_to_alarm       = 1
    dimensions                = {
        "QueueName" = "wetherspoons-queue"
    }
    evaluation_periods        = 1
    insufficient_data_actions = []
    metric_name               = "ApproximateNumberOfMessagesNotVisible"
    namespace                 = "AWS/SQS"
    ok_actions                = []
    period                    = 900
    statistic                 = "Sum"
    tags                      = {}
    threshold                 = 1
    treat_missing_data        = "missing"
}

resource "aws_cloudwatch_composite_alarm" "queue_empty" {
    actions_enabled           = true
    alarm_actions             = [aws_sns_topic.wetherspoons_pub_ranker.arn]
    alarm_name                = "Queue Empty"
    alarm_rule                = "ALARM(\"ApproximateNumberOfMessagesVisible\") AND ALARM(\"ApproximateNumberOfMessagesNotVisible\")"
    insufficient_data_actions = []
    ok_actions                = []
    tags                      = {}
}