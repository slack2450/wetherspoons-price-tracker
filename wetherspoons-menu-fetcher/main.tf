variable "sqs_arn" {
  type = string
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

  inline_policy {
    name = "SQS"
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
}

resource "aws_lambda_function" "wetherspoons_menu_fetcher" {
  architectures = [
    "arm64",
  ]

  function_name                  = "wetherspoons-menu-fetcher"
  filename                       = "${path.module}/dist/index.zip"
  handler                        = "index.handler"
  memory_size                    = 128
  reserved_concurrent_executions = -1
  role                           = aws_iam_role.wetherspoons_menu_fetcher_role.arn
  runtime                        = "nodejs16.x"
  timeout                        = 30

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
