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
  }
  cloud {
    organization = "spoons-cheap"
    workspaces {
      name = "wetherspoons-price-tracker"
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

variable "collector_schedule_state" {
  type        = string
  description = "Set to DISABLED to quiesce collectors during coordinated deployments"
  default     = "ENABLED"

  validation {
    condition     = contains(["ENABLED", "DISABLED"], var.collector_schedule_state)
    error_message = "collector_schedule_state must be ENABLED or DISABLED."
  }
}

variable "enable_rankings" {
  type        = bool
  description = "Deploy the unfinished rankings feature only when it is ready for production"
  default     = false
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

resource "aws_sns_topic" "wetherspoons_pubs" {
  name = "wetherspoons-pubs"
}

resource "aws_sns_topic" "wetherspoons_alarms" {
  name = "wetherspoons-alarms"
}

variable "alarm_email" {
  type        = string
  description = "Email address to receive CloudWatch alarm notifications"
}

resource "aws_sns_topic_subscription" "wetherspoons_alarms_email" {
  topic_arn = aws_sns_topic.wetherspoons_alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

resource "aws_sqs_queue" "wetherspoons_dead_letter_queue" {
  name                      = "wetherspoons-dead-letter-queue"
  message_retention_seconds = 1209600
}

locals {
  menu_max_receive_count = 5
}

resource "aws_sqs_queue" "wetherspoons_queue" {
  name                       = "wetherspoons-queue"
  message_retention_seconds  = 345600
  visibility_timeout_seconds = 900
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.wetherspoons_dead_letter_queue.arn
    maxReceiveCount     = local.menu_max_receive_count
  })
}

data "aws_iam_policy_document" "wetherspoons_queue" {
  statement {
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.wetherspoons_queue.arn]

    principals {
      type        = "Service"
      identifiers = ["sns.amazonaws.com"]
    }

    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [aws_sns_topic.wetherspoons_pubs.arn]
    }
  }
}

resource "aws_sqs_queue_policy" "wetherspoons_queue" {
  queue_url = aws_sqs_queue.wetherspoons_queue.id
  policy    = data.aws_iam_policy_document.wetherspoons_queue.json
}

resource "aws_sns_topic_subscription" "wetherspoons_pubs_sqs_target" {
  topic_arn = aws_sns_topic.wetherspoons_pubs.arn
  protocol  = "sqs"
  endpoint  = aws_sqs_queue.wetherspoons_queue.arn
}

module "wetherspoons_pub_fetcher" {
  source                         = "./wetherspoons-pub-fetcher"
  sns_topic_arn                  = aws_sns_topic.wetherspoons_pubs.arn
  alarm_sns_topic_arn            = aws_sns_topic.wetherspoons_alarms.arn
  schedule_state                 = var.collector_schedule_state
  reserved_concurrent_executions = var.pub_fetcher_reserved_concurrency
}

module "wetherspoons_pub_ranker" {
  count  = var.enable_rankings ? 1 : 0
  source = "./wetherspoons-pub-ranker"
}

module "wetherspoons_menu_fetcher" {
  source                   = "./wetherspoons-menu-fetcher"
  sqs_arn                  = aws_sqs_queue.wetherspoons_queue.arn
  influxdb_url             = var.influxdb_url
  influxdb_write_api_token = var.influxdb_write_api_token
  influxdb_org             = var.influxdb_org
  influxdb_bucket          = var.influxdb_bucket
  alarm_sns_topic_arn      = aws_sns_topic.wetherspoons_alarms.arn
  max_receive_count        = local.menu_max_receive_count
}

resource "aws_cloudwatch_metric_alarm" "dead_letter_queue_not_empty" {
  alarm_name          = "wetherspoons-dead-letter-queue-not-empty"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = 0
  period              = 300
  statistic           = "Maximum"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  alarm_actions       = [aws_sns_topic.wetherspoons_alarms.arn]
  treat_missing_data  = "notBreaching"

  dimensions = {
    QueueName = aws_sqs_queue.wetherspoons_dead_letter_queue.name
  }
}

resource "aws_cloudwatch_metric_alarm" "source_queue_too_old" {
  alarm_name          = "wetherspoons-source-queue-too-old"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = 1800
  period              = 300
  statistic           = "Maximum"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateAgeOfOldestMessage"
  alarm_description   = "Collector messages have remained unprocessed for more than 30 minutes"
  alarm_actions       = [aws_sns_topic.wetherspoons_alarms.arn]
  treat_missing_data  = "notBreaching"

  dimensions = {
    QueueName = aws_sqs_queue.wetherspoons_queue.name
  }
}

module "wetherspoons_price_api" {
  source                  = "./wetherspoons-api"
  aws_access_key          = var.aws_access_key
  aws_secret_key          = var.aws_secret_key
  cloudflare_api_key      = var.cloudflare_api_key
  cloudflare_api_email    = var.cloudflare_api_email
  influxdb_url            = var.influxdb_url
  influxdb_read_api_token = var.influxdb_read_api_token
  influxdb_org            = var.influxdb_org
  influxdb_bucket         = var.influxdb_bucket
  enable_rankings         = var.enable_rankings
}
