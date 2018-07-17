provider "archive" {
  version = "~> 1.0"
}

locals {
  lambda_function_name = "${coalesce("${var.lambda_function_name}", "slack-${var.api_name}-moderator")}"

  callbacks = [
    "report_message_action",
    "report_message_submit",
    "moderator_action",
    "moderator_submit"
  ]
}

data "archive_file" "package" {
  output_path = "${path.module}/dist/package.zip"
  source_dir  = "${path.module}/src"
  type        = "zip"
}

resource "aws_lambda_function" "lambda" {
  description      = "${var.lambda_description}"
  filename         = "${data.archive_file.package.output_path}"
  function_name    = "${local.lambda_function_name}"
  handler          = "index.handler"
  memory_size      = "${var.lambda_memory_size}"
  role             = "${var.role_arn}"
  runtime          = "nodejs8.10"
  source_code_hash = "${data.archive_file.package.output_base64sha256}"
  tags             = "${var.lambda_tags}"
  timeout          = "${var.lambda_timeout}"

  environment {
    variables {
      MODERATION_CHANNEL = "${var.moderation_channel}"
      SECRET             = "${var.secret}"
    }
  }
}

resource "aws_lambda_permission" "trigger" {
  count         = "${length("${local.callbacks}")}"
  action        = "lambda:InvokeFunction"
  function_name = "${aws_lambda_function.lambda.function_name}"
  principal     = "sns.amazonaws.com"
  source_arn    = "${element("${aws_sns_topic.callbacks.*.arn}", count.index)}"
  statement_id  = "allow_${element("${local.callbacks}", count.index)}"
}

resource "aws_sns_topic" "callbacks" {
  count = "${length("${local.callbacks}")}"
  name  = "slack_callback_${element("${local.callbacks}", count.index)}"
}

resource "aws_sns_topic_subscription" "subscription" {
  count     = "${length("${local.callbacks}")}"
  endpoint  = "${aws_lambda_function.lambda.arn}"
  protocol  = "lambda"
  topic_arn = "${element("${aws_sns_topic.callbacks.*.arn}", count.index)}"
}
