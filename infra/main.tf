locals {
  services = {
    web       = { public = true, memory = "1Gi", cpu = "1", port = 8080 }
    agent     = { public = false, memory = "1Gi", cpu = "1", port = 8080 }
    workflows = { public = false, memory = "1Gi", cpu = "1", port = 8080 }
    webhook   = { public = true, memory = "512Mi", cpu = "1", port = 8080 }
    engines   = { public = false, memory = "2Gi", cpu = "2", port = 8080 }
    mcp       = { public = true, memory = "512Mi", cpu = "1", port = 8080 }
  }

  apis = [
    "run.googleapis.com",
    "cloudtasks.googleapis.com",
    "firestore.googleapis.com",
    "storage.googleapis.com",
    "pubsub.googleapis.com",
    "bigquery.googleapis.com",
    "cloudscheduler.googleapis.com",
    "secretmanager.googleapis.com",
    "aiplatform.googleapis.com",
    "artifactregistry.googleapis.com",
    "cloudbuild.googleapis.com",
    "iam.googleapis.com",
    "logging.googleapis.com",
    "cloudtrace.googleapis.com",
  ]

  secrets = [
    "youcam-api-key",
    "youcam-webhook-secret",
    "mira-session-secret",
    "mira-mcp-tokens",
    "anthropic-api-key",
  ]

  image = "${var.region}-docker.pkg.dev/${var.project_id}/mira"
}

resource "google_project_service" "apis" {
  for_each           = toset(local.apis)
  service            = each.value
  disable_on_destroy = false
}

# --- Artifact Registry ---

resource "google_artifact_registry_repository" "mira" {
  location      = var.region
  repository_id = "mira"
  format        = "DOCKER"
  description   = "MIRA service images"

  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"
    most_recent_versions {
      keep_count = 10
    }
  }
  cleanup_policies {
    id     = "delete-old"
    action = "DELETE"
    condition {
      older_than = "2592000s"
    }
  }

  depends_on = [google_project_service.apis]
}

# --- Firestore (native mode) ---

resource "google_firestore_database" "default" {
  name                    = "(default)"
  location_id             = var.region
  type                    = "FIRESTORE_NATIVE"
  delete_protection_state = "DELETE_PROTECTION_ENABLED"
  depends_on              = [google_project_service.apis]
}

# --- Cloud Storage ---

# Images exist only for a run; this lifecycle rule is the backstop (docs/DATA_MODEL.md §2).
resource "google_storage_bucket" "temp" {
  name                        = "${var.project_id}-mira-temp"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = true

  lifecycle_rule {
    condition {
      age = 1
    }
    action {
      type = "Delete"
    }
  }
}

# Looks a person chose to save; deleted with their profile, so no age rule.
resource "google_storage_bucket" "saved" {
  name                        = "${var.project_id}-mira-saved"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
}

# --- Cloud Tasks ---

resource "google_cloud_tasks_queue" "youcam_submit" {
  name     = "youcam-submit"
  location = var.region

  rate_limits {
    max_dispatches_per_second = var.youcam_queue_rps.submit
    max_concurrent_dispatches = 4
  }
  retry_config {
    max_attempts       = 5
    min_backoff        = "5s"
    max_backoff        = "120s"
    max_doublings      = 4
    max_retry_duration = "1800s"
  }
  depends_on = [google_project_service.apis]
}

resource "google_cloud_tasks_queue" "youcam_poll" {
  name     = "youcam-poll"
  location = var.region

  rate_limits {
    max_dispatches_per_second = var.youcam_queue_rps.poll
    max_concurrent_dispatches = 8
  }
  retry_config {
    max_attempts       = 20
    min_backoff        = "2s"
    max_backoff        = "30s"
    max_doublings      = 4
    max_retry_duration = "3600s"
  }
  depends_on = [google_project_service.apis]
}

resource "google_cloud_tasks_queue" "engine_jobs" {
  name     = "engine-jobs"
  location = var.region

  rate_limits {
    max_dispatches_per_second = 5
    max_concurrent_dispatches = 10
  }
  retry_config {
    max_attempts = 3
    min_backoff  = "1s"
    max_backoff  = "10s"
  }
  depends_on = [google_project_service.apis]
}

# --- Pub/Sub ---

resource "google_pubsub_topic" "run_events" {
  name                       = "run-events"
  message_retention_duration = "86400s"
  depends_on                 = [google_project_service.apis]
}

# --- BigQuery (tables and cohort-limited views arrive in phase 10) ---

resource "google_bigquery_dataset" "brand" {
  dataset_id  = "mira_brand"
  location    = var.region
  description = "Anonymised brand aggregates only: no user IDs, no images, week-level dates."
  depends_on  = [google_project_service.apis]
}

# --- Secret Manager (values are added by hand, never by Terraform) ---

resource "google_secret_manager_secret" "secrets" {
  for_each  = toset(local.secrets)
  secret_id = each.value
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}
