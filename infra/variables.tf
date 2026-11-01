variable "project_id" {
  description = "Google Cloud project ID."
  type        = string
}

variable "region" {
  description = "Region for Cloud Run, Cloud Tasks, buckets and Firestore."
  type        = string
  default     = "asia-south1"
}

variable "image_tag" {
  description = "Container tag deployed to every service. CI updates images outside Terraform."
  type        = string
  default     = "bootstrap"
}

variable "max_instances" {
  description = "Upper bound on Cloud Run instances per service; keeps demo spend predictable."
  type        = number
  default     = 3
}

variable "youcam_queue_rps" {
  description = <<-EOT
    Combined Cloud Tasks dispatch rate for YouCam calls. YouCam allows 250 requests per 300 s per
    key (about 0.83 rps, docs/FACTS.md F11). A submit node makes 2 API calls (register + create),
    a poll makes 1; the split below keeps the total under the limit with headroom.
  EOT
  type        = object({ submit = number, poll = number })
  default     = { submit = 0.2, poll = 0.35 }
}

variable "warm_services" {
  description = <<-EOT
    Services kept warm with one idle instance so nobody waits on a cold start. Leave empty while
    building (idle cost 0). For judging, ["web"] costs about $13/month; add "workflows" only if the
    first run after idle feels slow. Idle instances bill at the reduced idle rate, never full CPU.
  EOT
  type        = list(string)
  default     = []
}

variable "billing_account_id" {
  description = "Billing account ID (e.g. 019877-AF3D95-373629). When set, creates a budget alert; null skips it."
  type        = string
  default     = null
}

variable "monthly_budget_usd" {
  description = "Monthly budget for the alert. Alerts email billing admins at 50%, 90% and 100% of actual spend and at 100% of forecast; they do not stop spending."
  type        = number
  default     = 20
}
