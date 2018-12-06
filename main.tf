locals {
  lambda_function_name = "${coalesce("${var.lambda_function_name}", "slack-${var.api_name}-moderator")}"

  callbacks = [
    "report_message_action",
    "report_message_submit",
  ]
}

data aws_iam_role role {
  name = "${var.role}"
}

resource aws_lambda_function lambda {
  description      = "${var.lambda_description}"
  filename         = "${path.module}/package.zip"
  function_name    = "${local.lambda_function_name}"
  handler          = "index.handler"
  memory_size      = "${var.lambda_memory_size}"
  role             = "${data.aws_iam_role.role.arn}"
  runtime          = "nodejs8.10"
  source_code_hash = "${base64sha256(file("${path.module}/package.zip"))}"
  tags             = "${var.lambda_tags}"
  timeout          = "${var.lambda_timeout}"

  environment {
    variables {
      AWS_SECRET        = "${var.secret}"
      DEFAULT_TOKEN     = "${var.default_token}"
      MODERATOR_CHANNEL = "${var.moderator_channel}"
    }
  }
}

resource aws_lambda_permission trigger {
  count         = "${length("${local.callbacks}")}"
  action        = "lambda:InvokeFunction"
  function_name = "${aws_lambda_function.lambda.function_name}"
  principal     = "sns.amazonaws.com"
  source_arn    = "${element("${aws_sns_topic.callbacks.*.arn}", count.index)}"
  statement_id  = "allow_${element("${local.callbacks}", count.index)}"
}

resource aws_sns_topic callbacks {
  count = "${length("${local.callbacks}")}"
  name  = "slack_${var.api_name}_callback_${element("${local.callbacks}", count.index)}"
}

resource aws_sns_topic_subscription subscription {
  count     = "${length("${local.callbacks}")}"
  endpoint  = "${aws_lambda_function.lambda.arn}"
  protocol  = "lambda"
  topic_arn = "${element("${aws_sns_topic.callbacks.*.arn}", count.index)}"
}
