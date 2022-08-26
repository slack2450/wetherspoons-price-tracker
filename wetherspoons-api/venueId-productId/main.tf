variable "aws_access_key" {
  type = string
}

variable "aws_secret_key" {
  type = string
}

variable "api_id" {
  type = string
}

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 4.23"
    }
  }
}

provider "aws" {
  region     = "eu-west-2"
  access_key = var.aws_access_key
  secret_key = var.aws_secret_key
}

data "aws_region" "current" {}

data "aws_caller_identity" "current" {}

resource "aws_iam_role" "api_role" {
  name = "wetherspoons-api-venuidId-role"

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

resource "aws_lambda_function" "wetherspoons_price_api" {

  function_name = "wetherspoons-api-venueId"

  architectures = [
    "arm64",
  ]

  filename                       = "${path.module}/dist/index.zip"
  source_code_hash               = filebase64sha256("${path.module}/dist/index.zip")
  handler                        = "index.handler"
  memory_size                    = 128
  reserved_concurrent_executions = -1
  role                           = aws_iam_role.api_role.arn
  runtime                        = "nodejs16.x"
  timeout                        = 30

  ephemeral_storage {
    size = 512
  }
}

resource "aws_cloudwatch_log_group" "wetherspoons_price_api" {
  name              = "/aws/lambda/${aws_lambda_function.wetherspoons_price_api.function_name}"
  retention_in_days = 7
  lifecycle {
    prevent_destroy = false
  }
}

resource "aws_iam_policy" "wetherspoons_price_api" {
  name = "wetherspoons-price-api-logging-policy"
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
          Resource = "${aws_cloudwatch_log_group.wetherspoons_price_api.arn}:*"
        },
      ]
    }
  )

}

resource "aws_iam_role_policy_attachment" "wetherspoons_price_api" {
  role       = aws_iam_role.api_role.id
  policy_arn = aws_iam_policy.wetherspoons_price_api.arn
}

resource "aws_apigatewayv2_integration" "integration" {
  integration_type       = "AWS_PROXY"
  payload_format_version = "2.0"
  api_id                 = var.api_id
  integration_uri        = aws_lambda_function.wetherspoons_price_api.arn
}

resource "aws_apigatewayv2_route" "wetherspoons_api_price_route" {
  api_id    = var.api_id
  route_key = "GET /v1/price/{venueId}"
  target    = "integrations/${aws_apigatewayv2_integration.integration.id}"
}

resource "aws_lambda_permission" "wetherspoons_api_price_route_permission" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.wetherspoons_price_api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "arn:aws:execute-api:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:${var.api_id}/*/*/v1/price/{venueId}"
}
