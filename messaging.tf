resource "aws_sns_topic" "wetherspoons_pubs" {
  name = "wetherspoons-pubs"
}

resource "aws_sns_topic" "wetherspoons_alarms" {
  name = "wetherspoons-alarms"
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
