provider "archive" {
  version = "~> 1.0"
}

locals {
  dialog_function_name = "${coalesce("${var.dialog_function_name}", "slack-${var.api_name}-report-message-dialog")}"
  report_function_name = "${coalesce("${var.report_function_name}", "slack-${var.api_name}-report-message-post")}"
  remove_function_name = "${coalesce("${var.remove_function_name}", "slack-${var.api_name}-remove-message")}"
  role_path            = "${coalesce("${var.role_path}", "/${var.api_name}/")}"
}

data "archive_file" "package" {
  output_path = "${path.module}/dist/package.zip"
  source_dir  = "${path.module}/src"
  type        = "zip"
}

data "aws_sns_topic" "dialog" {
  name = "slack_callback_${var.dialog_topic}"
}

data "aws_sns_topic" "report" {
  name = "slack_callback_${var.report_topic}"
}

data "aws_sns_topic" "remove" {
  name = "slack_callback_${var.remove_topic}"
}

resource "aws_lambda_function" "dialog" {
  description      = "${var.dialog_description}"
  filename         = "${data.archive_file.package.output_path}"
  function_name    = "${local.dialog_function_name}"
  handler          = "index.dialog"
  memory_size      = "${var.dialog_memory_size}"
  role             = "${var.role_arn}"
  runtime          = "nodejs8.10"
  source_code_hash = "${data.archive_file.package.output_base64sha256}"
  tags             = "${var.dialog_tags}"
  timeout          = "${var.dialog_timeout}"

  environment {
    variables {
      REPORT_CALLBACK_ID = "${var.report_topic}"
      MODERATION_CHANNEL = "${var.moderation_channel}"
      SECRET             = "${var.secret}"
    }
  }
}

resource "aws_lambda_function" "report" {
  description      = "${var.report_description}"
  filename         = "${data.archive_file.package.output_path}"
  function_name    = "${local.report_function_name}"
  handler          = "index.report"
  memory_size      = "${var.report_memory_size}"
  role             = "${var.role_arn}"
  runtime          = "nodejs8.10"
  source_code_hash = "${data.archive_file.package.output_base64sha256}"
  tags             = "${var.report_tags}"
  timeout          = "${var.report_timeout}"

  environment {
    variables {
      REMOVE_CALLBACK_ID = "${var.remove_topic}"
      MODERATION_CHANNEL = "${var.moderation_channel}"
      SECRET             = "${var.secret}"
    }
  }
}

resource "aws_lambda_function" "remove" {
  description      = "${var.remove_description}"
  filename         = "${data.archive_file.package.output_path}"
  function_name    = "${local.remove_function_name}"
  handler          = "index.remove"
  memory_size      = "${var.remove_memory_size}"
  role             = "${var.role_arn}"
  runtime          = "nodejs8.10"
  source_code_hash = "${data.archive_file.package.output_base64sha256}"
  tags             = "${var.remove_tags}"
  timeout          = "${var.remove_timeout}"

  environment {
    variables {
      MODERATION_CHANNEL = "${var.moderation_channel}"
      SECRET             = "${var.secret}"
    }
  }
}

resource "aws_lambda_permission" "dialog_trigger" {
  action        = "lambda:InvokeFunction"
  function_name = "${aws_lambda_function.dialog.function_name}"
  principal     = "sns.amazonaws.com"
  source_arn    = "${data.aws_sns_topic.dialog.arn}"
  statement_id  = "AllowExecutionFromSNS"
}

resource "aws_lambda_permission" "report_trigger" {
  action        = "lambda:InvokeFunction"
  function_name = "${aws_lambda_function.report.function_name}"
  principal     = "sns.amazonaws.com"
  source_arn    = "${data.aws_sns_topic.report.arn}"
  statement_id  = "AllowExecutionFromSNS"
}

resource "aws_lambda_permission" "remove_trigger" {
  action        = "lambda:InvokeFunction"
  function_name = "${aws_lambda_function.remove.function_name}"
  principal     = "sns.amazonaws.com"
  source_arn    = "${data.aws_sns_topic.remove.arn}"
  statement_id  = "AllowExecutionFromSNS"
}

resource "aws_sns_topic_subscription" "dialog_subscription" {
  endpoint  = "${aws_lambda_function.dialog.arn}"
  protocol  = "lambda"
  topic_arn = "${data.aws_sns_topic.dialog.arn}"
}

resource "aws_sns_topic_subscription" "report_subscription" {
  endpoint  = "${aws_lambda_function.report.arn}"
  protocol  = "lambda"
  topic_arn = "${data.aws_sns_topic.report.arn}"
}

resource "aws_sns_topic_subscription" "remove_subscription" {
  endpoint  = "${aws_lambda_function.remove.arn}"
  protocol  = "lambda"
  topic_arn = "${data.aws_sns_topic.remove.arn}"
}
