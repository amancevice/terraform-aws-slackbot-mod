variable "api_name" {
  description = "Slackbot REST API Gateway Name."
}

variable "lambda_description" {
  description = "Lambda function description."
  default     = "Open dialog to collect report."
}

variable "lambda_function_name" {
  description = "Lambda function name"
  default     = ""
}

variable "lambda_memory_size" {
  description = "Lambda function memory size."
  default     = 1024
}

variable "lambda_tags" {
  description = "A set of key/value label pairs to assign to the function."
  type        = "map"

  default {
    deployment-tool = "terraform"
  }
}

variable "lambda_timeout" {
  description = "Lambda function timeout."
  default     = 300
}

variable "moderator_channel" {
  description = "Slack moderator channel ID."
}

variable "role" {
  description = "Slackbot role."
}

variable "secret" {
  description = "Name of Slackbot secret in AWS SecretsManager."
}
