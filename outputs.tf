output "execute_api_endpoint" {
  description = "Direct API Gateway endpoint used by the deployment smoke test"
  value       = module.wetherspoons_price_api.execute_api_endpoint
}
