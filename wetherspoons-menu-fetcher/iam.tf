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
            "sqs:ChangeMessageVisibility",
            "sqs:ReceiveMessage",
            "sqs:GetQueueAttributes",
          ]
          Effect   = "Allow"
          Resource = var.sqs_arn
          Sid      = "VisualEditor0"
        },
      ]
      Version = "2012-10-17"
    }
  )
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
