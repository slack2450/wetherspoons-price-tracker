resource "aws_cloudwatch_metric_alarm" "dead_letter_queue_not_empty" {
  alarm_name          = "wetherspoons-dead-letter-queue-not-empty"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = 0
  period              = 300
  statistic           = "Maximum"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  # Failed records remain available for inspection. Email is driven by distinct
  # affected pubs and recurrence, not the age/quantity of historical DLQ records.
  alarm_description  = "Historical failed records awaiting inspection; notifications are handled by the pub failure monitor"
  alarm_actions      = []
  treat_missing_data = "notBreaching"

  dimensions = {
    QueueName = aws_sqs_queue.wetherspoons_dead_letter_queue.name
  }
}

resource "aws_cloudwatch_metric_alarm" "source_queue_too_old" {
  alarm_name          = "wetherspoons-source-queue-too-old"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  datapoints_to_alarm = 2
  threshold           = 0
  alarm_description   = "Messages are over 30 minutes old with at least 10 outstanding records in 2 of 3 five-minute periods; isolated pub retries do not email"
  alarm_actions       = [aws_sns_topic.wetherspoons_alarms.arn]
  treat_missing_data  = "notBreaching"

  metric_query {
    id          = "backlog"
    expression  = "IF(age > 1800 AND (visible + inflight) >= 10, 1, 0)"
    label       = "Sustained collector backlog"
    return_data = true
  }

  dynamic "metric_query" {
    for_each = {
      age      = "ApproximateAgeOfOldestMessage"
      visible  = "ApproximateNumberOfMessagesVisible"
      inflight = "ApproximateNumberOfMessagesNotVisible"
    }
    content {
      id          = metric_query.key
      return_data = false
      metric {
        namespace   = "AWS/SQS"
        metric_name = metric_query.value
        period      = 300
        stat        = "Maximum"
        dimensions = {
          QueueName = aws_sqs_queue.wetherspoons_queue.name
        }
      }
    }
  }
}
