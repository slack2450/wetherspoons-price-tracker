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
  runtime                        = "nodejs24.x"
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

resource "aws_iam_role_policy_attachment" "wetherspoons_pub_ranker" {
  role       = aws_iam_role.wetherspoons_pub_ranker_role.id
  policy_arn = aws_iam_policy.wetherspoons_pub_ranker.arn
}
