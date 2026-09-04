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
