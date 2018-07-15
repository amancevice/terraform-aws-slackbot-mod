variable "api_name" {
  description = "Slackbot REST API Gateway Name."
}

variable "dialog_description" {
  description = "Lambda function description."
  default     = "Open dialog to collect report."
}

variable "dialog_function_name" {
  description = "Lambda function name"
  default     = ""
}

variable "dialog_memory_size" {
  description = "Lambda function memory size."
  default     = 512
}

variable "dialog_tags" {
  description = "A set of key/value label pairs to assign to the function."
  type        = "map"

  default {
    deployment-tool = "terraform"
  }
}

variable "dialog_timeout" {
  description = "Lambda function timeout."
  default     = 300
}

variable "dialog_topic" {
  description = "SNS Topic name for opening report dialog."
}

variable "moderation_channel" {
  description = "Slack moderator channel ID"
}

variable "report_description" {
  description = "Lambda function description."
  default     = "Post report to moderation channel in Slack."
}

variable "report_function_name" {
  description = "Lambda function name"
  default     = ""
}

variable "report_memory_size" {
  description = "Lambda function memory size."
  default     = 512
}

variable "report_tags" {
  description = "A set of key/value label pairs to assign to the function."
  type        = "map"

  default {
    deployment-tool = "terraform"
  }
}

variable "report_timeout" {
  description = "Lambda function timeout."
  default     = 300
}

variable "report_topic" {
  description = "SNS Topic name for posting report to mod channel."
}

variable "remove_description" {
  description = "Lambda function description."
  default     = "Remove Slack message/thread."
}

variable "remove_function_name" {
  description = "Lambda function name"
  default     = ""
}

variable "remove_memory_size" {
  description = "Lambda function memory size."
  default     = 512
}

variable "remove_tags" {
  description = "A set of key/value label pairs to assign to the function."
  type        = "map"

  default {
    deployment-tool = "terraform"
  }
}

variable "remove_timeout" {
  description = "Lambda function timeout."
  default     = 3
}

variable "remove_topic" {
  description = "SNS Topic name for removing threads."
}

variable "role_arn" {
  description = "Slackbot role ARN."
}

variable "role_path" {
  description = "Path for slash command role."
  default     = ""
}

variable "secret" {
  description = "Name of Slackbot secret in AWS SecretsManager."
}
