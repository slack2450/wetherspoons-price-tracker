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
