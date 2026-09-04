resource "random_password" "origin_verify" {
  length  = 48
  special = false
}

resource "aws_apigatewayv2_api" "wetherspoons_api" {
  name          = "wetherspoons-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_methods = ["GET"]
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
    throttling_burst_limit = 10
    throttling_rate_limit  = 5
  }
}
