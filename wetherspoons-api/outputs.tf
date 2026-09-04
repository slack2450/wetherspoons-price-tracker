output "execute_api_endpoint" {
  description = "Direct API Gateway endpoint used to verify CloudFront origin enforcement"
  value       = aws_apigatewayv2_api.wetherspoons_api.api_endpoint
}
