resource "aws_lambda_function" "wetherspoons_pub_fetcher" {
  architectures = [
    "arm64",
  ]

  function_name                  = "wetherspoons-pub-fetcher"
  filename                       = "${path.module}/dist/index.zip"
  source_code_hash               = filebase64sha256("${path.module}/dist/index.zip")
  handler                        = "index.handler"
  memory_size                    = 256
  reserved_concurrent_executions = var.reserved_concurrent_executions
  role                           = aws_iam_role.wetherspoons_pub_fetcher_role.arn
  runtime                        = "nodejs24.x"
  timeout                        = 120

  environment {
    variables = {
      PUBS_TOPIC_ARN = var.sns_topic_arn
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
