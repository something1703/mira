# One service account per service, least privilege (docs/SECURITY_PRIVACY.md §3).
resource "google_service_account" "svc" {
  for_each     = local.services
  account_id   = "mira-${each.key}"
  display_name = "mira-${each.key}"
}

resource "google_cloud_run_v2_service" "svc" {
  for_each            = local.services
  name                = "mira-${each.key}"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = false

  template {
    service_account = google_service_account.svc[each.key].email
    timeout         = "300s"

    scaling {
      min_instance_count = contains(var.warm_services, each.key) ? 1 : 0
      max_instance_count = var.max_instances
    }

    containers {
      image = "${local.image}/mira-${each.key}:${var.image_tag}"

      ports {
        container_port = each.value.port
      }
      resources {
        limits = {
          cpu    = each.value.cpu
          memory = each.value.memory
        }
        cpu_idle          = true
        startup_cpu_boost = true
      }
      startup_probe {
        http_get {
          path = "/health"
        }
        period_seconds    = 3
        failure_threshold = 20
      }

      env {
        name  = "MIRA_MODE"
        value = "live"
      }
      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }
      env {
        name  = "GOOGLE_CLOUD_REGION"
        value = var.region
      }
      env {
        name  = "GCS_BUCKET_TEMP"
        value = google_storage_bucket.temp.name
      }
      env {
        name  = "GCS_BUCKET_SAVED"
        value = google_storage_bucket.saved.name
      }
    }
  }

  lifecycle {
    # CI deploys new images and per-service env; Terraform owns the shape of the service.
    ignore_changes = [
      template[0].containers[0].image,
      template[0].containers[0].env,
      client,
      client_version,
    ]
  }

  depends_on = [google_project_service.apis, google_artifact_registry_repository.mira]
}

# Public entry points: the web app, the YouCam callback receiver (verifies signatures itself) and
# the MCP server (bearer-token auth).
resource "google_cloud_run_v2_service_iam_member" "public" {
  for_each = { for k, v in local.services : k => v if v.public }
  name     = google_cloud_run_v2_service.svc[each.key].name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# Who may call whom.
locals {
  invocations = {
    "web-agent"           = { caller = "web", target = "agent" }
    "web-workflows"       = { caller = "web", target = "workflows" }
    "agent-workflows"     = { caller = "agent", target = "workflows" }
    "agent-engines"       = { caller = "agent", target = "engines" }
    "workflows-workflows" = { caller = "workflows", target = "workflows" } # Cloud Tasks OIDC
    "workflows-engines"   = { caller = "workflows", target = "engines" }
    "webhook-workflows"   = { caller = "webhook", target = "workflows" }
    "mcp-workflows"       = { caller = "mcp", target = "workflows" }
    "mcp-engines"         = { caller = "mcp", target = "engines" }
  }

  secret_access = {
    "web-session"      = { sa = "web", secret = "mira-session-secret" }
    "agent-youcam"     = { sa = "agent", secret = "youcam-api-key" }
    "agent-anthropic"  = { sa = "agent", secret = "anthropic-api-key" }
    "workflows-youcam" = { sa = "workflows", secret = "youcam-api-key" }
    "webhook-secret"   = { sa = "webhook", secret = "youcam-webhook-secret" }
    "mcp-tokens"       = { sa = "mcp", secret = "mira-mcp-tokens" }
  }

  project_roles = {
    "workflows-firestore" = { sa = "workflows", role = "roles/datastore.user" }
    "workflows-tasks"     = { sa = "workflows", role = "roles/cloudtasks.enqueuer" }
    "workflows-pubsub"    = { sa = "workflows", role = "roles/pubsub.publisher" }
    "workflows-trace"     = { sa = "workflows", role = "roles/cloudtrace.agent" }
    "agent-vertex"        = { sa = "agent", role = "roles/aiplatform.user" }
    "agent-trace"         = { sa = "agent", role = "roles/cloudtrace.agent" }
    "web-trace"           = { sa = "web", role = "roles/cloudtrace.agent" }
  }
}

resource "google_cloud_run_v2_service_iam_member" "invoke" {
  for_each = local.invocations
  name     = google_cloud_run_v2_service.svc[each.value.target].name
  location = var.region
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.svc[each.value.caller].email}"
}

resource "google_secret_manager_secret_iam_member" "access" {
  for_each  = local.secret_access
  secret_id = google_secret_manager_secret.secrets[each.value.secret].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.svc[each.value.sa].email}"
}

resource "google_project_iam_member" "roles" {
  for_each = local.project_roles
  project  = var.project_id
  role     = each.value.role
  member   = "serviceAccount:${google_service_account.svc[each.value.sa].email}"
}

# Workflows creates Cloud Tasks that call itself with its own identity.
resource "google_service_account_iam_member" "workflows_act_as_self" {
  service_account_id = google_service_account.svc["workflows"].name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.svc["workflows"].email}"
}

resource "google_storage_bucket_iam_member" "workflows_temp" {
  bucket = google_storage_bucket.temp.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.svc["workflows"].email}"
}

resource "google_storage_bucket_iam_member" "workflows_saved" {
  bucket = google_storage_bucket.saved.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.svc["workflows"].email}"
}

# Engines read images by reference for the render audit and garment colour.
resource "google_storage_bucket_iam_member" "engines_temp_read" {
  bucket = google_storage_bucket.temp.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.svc["engines"].email}"
}

resource "google_bigquery_dataset_iam_member" "workflows_brand" {
  dataset_id = google_bigquery_dataset.brand.dataset_id
  role       = "roles/bigquery.dataEditor"
  member     = "serviceAccount:${google_service_account.svc["workflows"].email}"
}
