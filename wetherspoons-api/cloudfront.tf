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

resource "aws_cloudfront_cache_policy" "wetherspoons_proxy_cache" {
  comment     = "Cache public venue and menu responses without caller-controlled variants"
  default_ttl = 300
  max_ttl     = 3600
  min_ttl     = 0
  name        = "SpoonsProxyCaching"

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
      items = ["*"]
    }

    access_control_allow_methods {
      items = ["ALL"]
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

resource "aws_cloudfront_distribution" "wetherspoons_api" {
  aliases         = ["api.spoons.cheap"]
  enabled         = true
  is_ipv6_enabled = true
  price_class     = "PriceClass_100"

  default_cache_behavior {
    allowed_methods            = ["GET", "HEAD"]
    cache_policy_id            = aws_cloudfront_cache_policy.wetherspoons_proxy_cache.id
    cached_methods             = ["GET", "HEAD"]
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

  ordered_cache_behavior {
    path_pattern               = "/v2/price/*"
    allowed_methods            = ["GET", "HEAD"]
    cache_policy_id            = aws_cloudfront_cache_policy.wetherspoons_api_cache.id
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
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
      origin_ssl_protocols     = ["TLSv1.2"]
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
