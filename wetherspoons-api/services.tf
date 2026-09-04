module "proxy" {
  source               = "./proxy"
  aws_access_key       = var.aws_access_key
  aws_secret_key       = var.aws_secret_key
  api_id               = aws_apigatewayv2_api.wetherspoons_api.id
  origin_verify_secret = random_password.origin_verify.result
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
