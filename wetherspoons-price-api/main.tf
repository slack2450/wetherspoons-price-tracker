terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 4.23"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "3.19.0"
    }
  }
}

variable "aws_access_key" {
  type = string
}

variable "aws_secret_key" {
  type = string
}

variable "cloudflare_api_key" {
  type = string
}

variable "cloudflare_api_email" {
  type = string
}

provider "aws" {
  region     = "eu-west-2"
  access_key = var.aws_access_key
  secret_key = var.aws_secret_key
}

provider "aws" {
  alias      = "us-east-1"
  region     = "us-east-1"
  access_key = var.aws_access_key
  secret_key = var.aws_secret_key
}

provider "cloudflare" {
  api_key = var.cloudflare_api_key
  email   = var.cloudflare_api_email
}

data "aws_region" "current" {}

data "aws_caller_identity" "current" {}

resource "aws_iam_role" "wetherspoons_price_api_role" {
  name = "wetherspoons-price-api-role"

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

  function_name = "wetherspoons-price-api"

  architectures = [
    "arm64",
  ]

  filename                       = "${path.module}/dist/index.zip"
  source_code_hash               = filebase64sha256("${path.module}/dist/index.zip")
  handler                        = "index.handler"
  memory_size                    = 128
  reserved_concurrent_executions = -1
  role                           = aws_iam_role.wetherspoons_price_api_role.arn
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
  role       = aws_iam_role.wetherspoons_price_api_role.id
  policy_arn = aws_iam_policy.wetherspoons_price_api.arn
}

resource "aws_apigatewayv2_api" "wetherspoons_api" {
  name          = "wetherspoons-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_methods = [
      "GET",
    ]
    allow_origins = [
      "http://localhost",
      "http://localhost:3000",
      "https://spoons.cheap",
    ]
  }
}

resource "aws_apigatewayv2_integration" "wetherspoons_api_price_integration" {
  api_id                 = aws_apigatewayv2_api.wetherspoons_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.wetherspoons_price_api.arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "wetherspoons_api_price_route" {
  api_id    = aws_apigatewayv2_api.wetherspoons_api.id
  route_key = "GET /v1/price/{venueId}/{productId}"
  target    = "integrations/${aws_apigatewayv2_integration.wetherspoons_api_price_integration.id}"
}

resource "aws_lambda_permission" "wetherspoons_api_price_route_permission" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.wetherspoons_price_api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "arn:aws:execute-api:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:${aws_apigatewayv2_api.wetherspoons_api.id}/*/*/v1/price/{venueId}/{productId}"

}

resource "aws_apigatewayv2_stage" "wetherspoons_api_stage" {
  api_id      = aws_apigatewayv2_api.wetherspoons_api.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_cloudfront_cache_policy" "wetherspoons_api_cache" {
  comment     = "Default policy when CF compression is enabled"
  default_ttl = 86400
  max_ttl     = 31536000
  min_ttl     = 1
  name        = "CachingOptimized"

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true

    cookies_config {
      cookie_behavior = "none"
    }

    headers_config {
      header_behavior = "none"
    }

    query_strings_config {
      query_string_behavior = "none"
    }
  }
}

resource "aws_cloudfront_response_headers_policy" "wetherspoons_api_cors" {
  name = "CORS"

  cors_config {
    access_control_allow_credentials = false
    access_control_max_age_sec       = 600
    origin_override                  = true

    access_control_allow_headers {
      items = [
        "*",
      ]
    }

    access_control_allow_methods {
      items = [
        "ALL",
      ]
    }

    access_control_allow_origins {
      items = [
        "http://localhost:3000",
        "http://spoons.cheap",
        "https://spoons.cheap",
      ]
    }
  }
}

resource "aws_acm_certificate" "wetherspoons_api_certificate" {
  provider          = aws.us-east-1
  domain_name       = "api.spoons.cheap"
  validation_method = "DNS"
}

resource "aws_cloudfront_distribution" "wetherspoons_api" {
  aliases = [
    "api.spoons.cheap",
  ]
  enabled         = true
  is_ipv6_enabled = true
  price_class     = "PriceClass_100"

  default_cache_behavior {
    allowed_methods = [
      "GET",
      "HEAD",
    ]
    cache_policy_id = aws_cloudfront_cache_policy.wetherspoons_api_cache.id
    cached_methods = [
      "GET",
      "HEAD",
    ]
    compress                   = true
    default_ttl                = 0
    max_ttl                    = 0
    min_ttl                    = 0
    response_headers_policy_id = aws_cloudfront_response_headers_policy.wetherspoons_api_cors.id
    smooth_streaming           = false
    target_origin_id           = aws_apigatewayv2_api.wetherspoons_api.id
    trusted_key_groups         = []
    trusted_signers            = []
    viewer_protocol_policy     = "allow-all"
  }

  origin {
    connection_attempts = 3
    connection_timeout  = 10
    domain_name         = "${aws_apigatewayv2_api.wetherspoons_api.id}.execute-api.${data.aws_region.current.name}.amazonaws.com"
    origin_id           = aws_apigatewayv2_api.wetherspoons_api.id

    custom_origin_config {
      http_port                = 80
      https_port               = 443
      origin_keepalive_timeout = 5
      origin_protocol_policy   = "https-only"
      origin_read_timeout      = 30
      origin_ssl_protocols = [
        "TLSv1.2",
      ]
    }
  }

  restrictions {
    geo_restriction {
      locations        = []
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn            = aws_acm_certificate.wetherspoons_api_certificate.arn
    cloudfront_default_certificate = false
    minimum_protocol_version       = "TLSv1.2_2021"
    ssl_support_method             = "sni-only"
  }
}

resource "cloudflare_zone" "spoons_cheap" {
  zone = "spoons.cheap"
}

resource "cloudflare_record" "api_spoons_cheap" {
  zone_id = cloudflare_zone.spoons_cheap.id
  name    = "api"
  value   = aws_cloudfront_distribution.wetherspoons_api.domain_name
  type    = "CNAME"
}

resource "cloudflare_record" "spoons_cheap" {
  zone_id = cloudflare_zone.spoons_cheap.id
  name    = "@"
  value   = "spoons-cheap.pages.dev"
  type    = "CNAME"
}

resource "cloudflare_record" "www_spoons_cheap" {
  zone_id = cloudflare_zone.spoons_cheap.id
  name    = "www"
  value   = "spoons.cheap"
  type    = "CNAME"
}
