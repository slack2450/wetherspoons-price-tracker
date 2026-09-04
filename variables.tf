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

variable "influxdb_write_api_token" {
  type      = string
  sensitive = true
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

variable "alarm_email" {
  type        = string
  description = "Email address to receive CloudWatch alarm notifications"
}

variable "collector_schedule_state" {
  type        = string
  description = "Set to DISABLED to quiesce collectors during coordinated deployments"
  default     = "ENABLED"

  validation {
    condition     = contains(["ENABLED", "DISABLED"], var.collector_schedule_state)
    error_message = "collector_schedule_state must be ENABLED or DISABLED."
  }
}

variable "pub_fetcher_reserved_concurrency" {
  type        = number
  description = "Use zero to pause new pub-fetcher invocations during a coordinated deployment"
  default     = -1

  validation {
    condition     = contains([-1, 0], var.pub_fetcher_reserved_concurrency)
    error_message = "pub_fetcher_reserved_concurrency must be -1 or 0."
  }
}
