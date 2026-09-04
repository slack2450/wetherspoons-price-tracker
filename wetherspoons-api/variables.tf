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
