terraform {
  required_version = ">= 1.9"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "8.9.0"
    }
  }

  # State lives in a GCS bucket created once by hand (see infra/README.md):
  #   terraform init -backend-config="bucket=<project>-tfstate"
  backend "gcs" {
    prefix = "mira"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
