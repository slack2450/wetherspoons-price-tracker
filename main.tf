terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.62"
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
  type = string
}

variable "aws_secret_key" {
  type = string
}

variable "cloudflare_api_key" {
  type = string
}

variable "cloudflare_api_email" {
  type = string
}

variable "influxdb_url" {
  type = string
}

variable "influxdb_write_api_token" {
  type = string
}

variable "influxdb_read_api_token" {
  type = string
}

variable "influxdb_org" {
  type = string
}

variable "influxdb_bucket" {
  type = string
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

resource "aws_sqs_queue" "wetherspoons_queue" {
  name                       = "wetherspoons-queue"
  message_retention_seconds  = 43200
  visibility_timeout_seconds = 60
}

resource "aws_sns_topic_subscription" "wetherspoons_pubs_sqs_target" {
  topic_arn = aws_sns_topic.wetherspoons_pubs.arn
  protocol  = "sqs"
  endpoint  = aws_sqs_queue.wetherspoons_queue.arn
}

module "wetherspoons_pub_fetcher" {
  source              = "./wetherspoons-pub-fetcher"
  sns_topic_arn       = aws_sns_topic.wetherspoons_pubs.arn
  alarm_sns_topic_arn = aws_sns_topic.wetherspoons_alarms.arn
}

module "wetherspoons_pub_ranker" {
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
}
