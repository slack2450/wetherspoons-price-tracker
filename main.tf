terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 4.23"
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

resource "aws_dynamodb_table" "wetherspoons_drinks" {
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"
  name         = "wetherspoons-drinks"
  table_class  = "STANDARD"

  attribute {
    name = "id"
    type = "S"
  }
  attribute {
    name = "venueIdProductId"
    type = "S"
  }

  global_secondary_index {
    hash_key        = "venueIdProductId"
    name            = "venueIdProductId-index"
    projection_type = "ALL"
  }
}

module "wetherspoons_pub_fetcher" {
  source        = "./wetherspoons-pub-fetcher"
  sns_topic_arn = aws_sns_topic.wetherspoons_pubs.arn
}

module "wetherspoons_menu_fetcher" {
  source  = "./wetherspoons-menu-fetcher"
  sqs_arn = aws_sqs_queue.wetherspoons_queue.arn
}

module "wetherspoons_price_api" {
  source               = "./wetherspoons-price-api"
  aws_access_key       = var.aws_access_key
  aws_secret_key       = var.aws_secret_key
  cloudflare_api_key   = var.cloudflare_api_key
  cloudflare_api_email = var.cloudflare_api_email
}
