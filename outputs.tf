output "topic_arns" {
  description = "SNS Topic ARNs."
  value       = ["${aws_sns_topic.callbacks.*.arn}"]
}
