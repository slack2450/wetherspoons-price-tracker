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

resource "aws_iam_role" "scheduler" {
  name = "wetherspoons-pub-fetcher-scheduler-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "scheduler.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy" "scheduler" {
  name = "invoke-pub-fetcher"
  role = aws_iam_role.scheduler.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action   = "lambda:InvokeFunction"
      Effect   = "Allow"
      Resource = aws_lambda_function.wetherspoons_pub_fetcher.arn
    }]
  })
}
