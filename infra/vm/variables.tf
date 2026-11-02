variable "project_id" {
  description = "Google Cloud project ID."
  type        = string
}

variable "region" {
  description = "Region for the VM, its IP and the image registry. us-central1 is among the cheapest; a YouCam run takes 36-50 s on YouCam's side, so the VM's location hardly changes how fast it feels."
  type        = string
  default     = "us-central1"
}

variable "zone" {
  description = "Zone for the VM, inside var.region."
  type        = string
  default     = "us-central1-a"
}

variable "machine_type" {
  description = "e2-medium (2 shared vCPUs, 4 GB). The four services and MediaPipe need about 1.3-1.6 GB, so e2-small (2 GB) is too tight to be safe during a judged run."
  type        = string
  default     = "e2-medium"
}

variable "disk_size_gb" {
  description = "Boot disk (balanced PD). Holds Docker images and MIRA's state; photos are deleted after measuring."
  type        = number
  default     = 20
}

variable "hostname" {
  description = "Public hostname. Empty uses <ip>.sslip.io, a free name that resolves to the VM's IP, so Caddy can get an HTTPS certificate without a domain. The camera only works over HTTPS."
  type        = string
  default     = ""
}

variable "github_repository" {
  description = "owner/name of the GitHub repository allowed to deploy, through Workload Identity Federation."
  type        = string
  default     = "something1703/mira"
}

variable "billing_account_id" {
  description = "Billing account for the budget alert. Empty skips the budget. Keep it in terraform.tfvars, never in a committed file."
  type        = string
  default     = ""
}

variable "monthly_budget_usd" {
  description = "Budget alert amount. Emails at 50%, 90% and 100% of actual spend and 100% of forecast; it does not cap spend."
  type        = number
  default     = 40
}
