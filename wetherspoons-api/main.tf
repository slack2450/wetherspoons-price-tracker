terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.21.0"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "3.19.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.7"
    }
  }
}

variable "aws_access_key" {
  type      = string
  sensitive = true
}

variable "aws_secret_key" {
  type      = string
  sensitive = true
}

variable "cloudflare_api_key" {
  type      = string
  sensitive = true
}

variable "cloudflare_api_email" {
  type = string
}

variable "influxdb_url" {
  type = string
}

variable "influxdb_read_api_token" {
  type      = string
  sensitive = true
}

variable "influxdb_org" {
  type = string
}

variable "influxdb_bucket" {
  type = string
}

variable "wetherspoons_api_token" {
  type      = string
  sensitive = true
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

resource "random_password" "origin_verify" {
  length  = 48
  special = false
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
      "https://www.spoons.cheap",
    ]
  }
}

resource "aws_apigatewayv2_stage" "wetherspoons_api_stage" {
  api_id      = aws_apigatewayv2_api.wetherspoons_api.id
  name        = "$default"
  auto_deploy = true
  default_route_settings {
    throttling_burst_limit = 100
    throttling_rate_limit  = 50
  }
}

resource "aws_cloudfront_cache_policy" "wetherspoons_api_cache" {
  comment     = "Default policy when CF compression is enabled"
  default_ttl = 300
  max_ttl     = 3600
  min_ttl     = 0
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
      query_string_behavior = "whitelist"
      query_strings {
        items = ["range"]
      }
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
        "https://www.spoons.cheap",
      ]
    }
  }
}

resource "aws_acm_certificate" "wetherspoons_api_certificate" {
  provider          = aws.us-east-1
  domain_name       = "api.spoons.cheap"
  validation_method = "DNS"
}

resource "cloudflare_record" "api_certificate_validation" {
  for_each = {
    for option in aws_acm_certificate.wetherspoons_api_certificate.domain_validation_options :
    option.domain_name => {
      name  = option.resource_record_name
      type  = option.resource_record_type
      value = option.resource_record_value
    }
  }

  zone_id = cloudflare_zone.spoons_cheap.id
  name    = each.value.name
  type    = each.value.type
  value   = each.value.value
  ttl     = 60
}

resource "aws_acm_certificate_validation" "wetherspoons_api_certificate" {
  provider                = aws.us-east-1
  certificate_arn         = aws_acm_certificate.wetherspoons_api_certificate.arn
  validation_record_fqdns = [for record in cloudflare_record.api_certificate_validation : record.hostname]
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
    viewer_protocol_policy     = "redirect-to-https"
  }

  origin {
    connection_attempts = 3
    connection_timeout  = 10
    domain_name         = "${aws_apigatewayv2_api.wetherspoons_api.id}.execute-api.${data.aws_region.current.region}.amazonaws.com"
    origin_id           = aws_apigatewayv2_api.wetherspoons_api.id

    custom_header {
      name  = "X-Origin-Verify"
      value = random_password.origin_verify.result
    }

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
    acm_certificate_arn            = aws_acm_certificate_validation.wetherspoons_api_certificate.certificate_arn
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

module "proxy" {
  source                 = "./proxy"
  aws_access_key         = var.aws_access_key
  aws_secret_key         = var.aws_secret_key
  api_id                 = aws_apigatewayv2_api.wetherspoons_api.id
  wetherspoons_api_token = var.wetherspoons_api_token
  origin_verify_secret   = random_password.origin_verify.result
}

module "price" {
  source                  = "./price"
  aws_access_key          = var.aws_access_key
  aws_secret_key          = var.aws_secret_key
  api_id                  = aws_apigatewayv2_api.wetherspoons_api.id
  influxdb_url            = var.influxdb_url
  influxdb_read_api_token = var.influxdb_read_api_token
  influxdb_org            = var.influxdb_org
  influxdb_bucket         = var.influxdb_bucket
  origin_verify_secret    = random_password.origin_verify.result
}

module "rankings" {
  source         = "./rankings"
  aws_access_key = var.aws_access_key
  aws_secret_key = var.aws_secret_key
  api_id         = aws_apigatewayv2_api.wetherspoons_api.id
}
