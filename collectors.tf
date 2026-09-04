module "wetherspoons_pub_fetcher" {
  source                         = "./wetherspoons-pub-fetcher"
  sns_topic_arn                  = aws_sns_topic.wetherspoons_pubs.arn
  alarm_sns_topic_arn            = aws_sns_topic.wetherspoons_alarms.arn
  schedule_state                 = var.collector_schedule_state
  reserved_concurrent_executions = var.pub_fetcher_reserved_concurrency
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
