variable "sqs_arn" {
  type = string
}

variable "influxdb_url" {
  type = string
}

variable "influxdb_write_api_token" {
  type = string
}

variable "influxdb_org" {
  type = string
}

variable "influxdb_bucket" {
  type = string
}

variable "alarm_sns_topic_arn" {
  type        = string
  description = "SNS topic ARN for CloudWatch alarms"
}

variable "max_receive_count" {
  type        = number
  description = "Number of SQS receives before an individual venue is sent to the DLQ"
}
