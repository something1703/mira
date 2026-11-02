terraform {
  required_version = ">= 1.9"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "8.9.0"
    }
  }

  # Same state bucket as the Cloud Run stack, under its own prefix (see infra/vm/README.md):
  #   terraform init -backend-config="bucket=<project>-tfstate"
  backend "gcs" {
    prefix = "mira-vm"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
  zone    = var.zone

  # Budgets are billing-account resources; they need a quota project to call the Budget API.
  user_project_override = true
  billing_project       = var.project_id
}
