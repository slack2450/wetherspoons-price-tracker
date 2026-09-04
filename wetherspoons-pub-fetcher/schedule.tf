resource "aws_scheduler_schedule" "operational_hours" {
  name                         = "wetherspoons-operational-hours"
  state                        = var.schedule_state
  schedule_expression          = "cron(0 8-23 * * ? *)"
  schedule_expression_timezone = "Europe/London"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.wetherspoons_pub_fetcher.arn
    role_arn = aws_iam_role.scheduler.arn
    # Do not use jsonencode here: it escapes angle brackets as \u003c/\u003e,
    # preventing EventBridge Scheduler from recognising its context tokens.
    input = <<-JSON
      {"id":"<aws.scheduler.scheduled-time>","time":"<aws.scheduler.scheduled-time>"}
    JSON

    retry_policy {
      maximum_event_age_in_seconds = 3600
      maximum_retry_attempts       = 2
    }
  }
}
