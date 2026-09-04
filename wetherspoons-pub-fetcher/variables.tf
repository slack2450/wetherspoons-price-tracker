variable "sns_topic_arn" {
  type = string
}

variable "alarm_sns_topic_arn" {
  type        = string
  description = "SNS topic ARN for CloudWatch alarms"
}

variable "schedule_state" {
  type        = string
  description = "EventBridge Scheduler state; set to DISABLED while draining for a deployment"
  default     = "ENABLED"

  validation {
    condition     = contains(["ENABLED", "DISABLED"], var.schedule_state)
    error_message = "schedule_state must be ENABLED or DISABLED."
  }
}

variable "reserved_concurrent_executions" {
  type        = number
  description = "Set to zero while deployment drains any invocation already in progress"
  default     = -1

  validation {
    condition     = contains([-1, 0], var.reserved_concurrent_executions)
    error_message = "reserved_concurrent_executions must be -1 or 0."
  }
}
