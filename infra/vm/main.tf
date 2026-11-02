locals {
  name = "mira"

  apis = [
    "compute.googleapis.com",
    "artifactregistry.googleapis.com",
    "secretmanager.googleapis.com",
    "iap.googleapis.com",
    "oslogin.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "sts.googleapis.com",
    "billingbudgets.googleapis.com",
  ]

  # Values are added by hand (README), never through Terraform, so they never enter state.
  secrets = {
    youcam_api_key = "mira-vm-youcam-api-key"
    session_secret = "mira-vm-session-secret"
  }

  host     = var.hostname != "" ? var.hostname : "${replace(google_compute_address.web.address, ".", "-")}.sslip.io"
  registry = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images.repository_id}"
}

data "google_project" "this" {}

resource "google_project_service" "apis" {
  for_each           = toset(local.apis)
  service            = each.value
  disable_on_destroy = false
}

# ---- images ----

resource "google_artifact_registry_repository" "images" {
  repository_id = "mira-vm"
  format        = "DOCKER"
  location      = var.region
  description   = "MIRA images for the single-VM deploy, tagged by commit."

  # Keeps storage near the 0.5 GB free tier: the ten newest versions of each image, and nothing
  # older than two weeks beyond those.
  cleanup_policy_dry_run = false
  cleanup_policies {
    id     = "keep-newest"
    action = "KEEP"
    most_recent_versions {
      keep_count = 10
    }
  }
  cleanup_policies {
    id     = "delete-old"
    action = "DELETE"
    condition {
      older_than = "1209600s"
    }
  }

  depends_on = [google_project_service.apis]
}

# ---- secrets ----

resource "google_secret_manager_secret" "secrets" {
  for_each  = local.secrets
  secret_id = each.value
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

# ---- network: its own VPC, so the default network's open SSH rule does not apply ----

resource "google_compute_network" "mira" {
  name                    = local.name
  auto_create_subnetworks = false
  depends_on              = [google_project_service.apis]
}

resource "google_compute_subnetwork" "mira" {
  name          = local.name
  network       = google_compute_network.mira.id
  region        = var.region
  ip_cidr_range = "10.20.0.0/24"
}

resource "google_compute_firewall" "web" {
  name          = "${local.name}-allow-web"
  network       = google_compute_network.mira.id
  description   = "HTTP (redirects to HTTPS, and the certificate challenge) and HTTPS, including HTTP/3."
  source_ranges = ["0.0.0.0/0"]
  target_tags   = [local.name]
  allow {
    protocol = "tcp"
    ports    = ["80", "443"]
  }
  allow {
    protocol = "udp"
    ports    = ["443"]
  }
}

resource "google_compute_firewall" "iap_ssh" {
  name          = "${local.name}-allow-iap-ssh"
  network       = google_compute_network.mira.id
  description   = "SSH only through Identity-Aware Proxy: port 22 is closed to the internet."
  source_ranges = ["35.235.240.0/20"]
  target_tags   = [local.name]
  allow {
    protocol = "tcp"
    ports    = ["22"]
  }
}

# Standard tier: 200 GB a month of internet traffic free, and a cheaper IP than Premium.
resource "google_compute_address" "web" {
  name         = local.name
  region       = var.region
  network_tier = "STANDARD"
  depends_on   = [google_project_service.apis]
}

# ---- the VM ----

resource "google_service_account" "vm" {
  account_id   = "mira-vm"
  display_name = "MIRA VM: pulls images, reads its two secrets, writes logs"
}

resource "google_artifact_registry_repository_iam_member" "vm_pull" {
  repository = google_artifact_registry_repository.images.name
  location   = var.region
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:${google_service_account.vm.email}"
}

resource "google_secret_manager_secret_iam_member" "vm_reads" {
  for_each  = google_secret_manager_secret.secrets
  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.vm.email}"
}

resource "google_project_iam_member" "vm_logs" {
  for_each = toset(["roles/logging.logWriter", "roles/monitoring.metricWriter"])
  project  = var.project_id
  role     = each.value
  member   = "serviceAccount:${google_service_account.vm.email}"
}

resource "google_compute_instance" "mira" {
  name                      = local.name
  machine_type              = var.machine_type
  zone                      = var.zone
  tags                      = [local.name]
  allow_stopping_for_update = true

  boot_disk {
    initialize_params {
      image = "debian-cloud/debian-12"
      size  = var.disk_size_gb
      type  = "pd-balanced"
    }
  }

  network_interface {
    subnetwork = google_compute_subnetwork.mira.id
    access_config {
      nat_ip       = google_compute_address.web.address
      network_tier = "STANDARD"
    }
  }

  shielded_instance_config {
    enable_secure_boot          = true
    enable_vtpm                 = true
    enable_integrity_monitoring = true
  }

  service_account {
    email  = google_service_account.vm.email
    scopes = ["cloud-platform"]
  }

  metadata = {
    enable-oslogin         = "TRUE"
    block-project-ssh-keys = "TRUE"
    startup-script         = file("${path.module}/host/startup.sh")
    # Read by host/deploy.sh, so the VM knows where its images and secrets are.
    mira-host                  = local.host
    mira-registry              = local.registry
    mira-secret-youcam-api-key = local.secrets.youcam_api_key
    mira-secret-session-secret = local.secrets.session_secret
  }

  depends_on = [
    google_project_service.apis,
    google_artifact_registry_repository_iam_member.vm_pull,
    google_secret_manager_secret_iam_member.vm_reads,
  ]
}

# Daily snapshots of the disk (MIRA's profiles and ledger live on it), kept for a week.
resource "google_compute_resource_policy" "daily" {
  name   = "${local.name}-daily-snapshot"
  region = var.region
  snapshot_schedule_policy {
    schedule {
      daily_schedule {
        days_in_cycle = 1
        start_time    = "20:00"
      }
    }
    retention_policy {
      max_retention_days    = 7
      on_source_disk_delete = "KEEP_AUTO_SNAPSHOTS"
    }
    snapshot_properties {
      storage_locations = [var.region]
    }
  }
}

resource "google_compute_disk_resource_policy_attachment" "daily" {
  name = google_compute_resource_policy.daily.name
  disk = google_compute_instance.mira.name
  zone = var.zone
}

# ---- GitHub Actions: keyless deploys through Workload Identity Federation ----

resource "google_iam_workload_identity_pool" "github" {
  # Its own pool: a project can hold pools for other repositories.
  workload_identity_pool_id = "mira-github"
  display_name              = "MIRA GitHub Actions"
  depends_on                = [google_project_service.apis]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github"
  display_name                       = "GitHub OIDC"
  # Only this repository's main branch can get a token.
  attribute_condition = "assertion.repository == \"${var.github_repository}\" && assertion.ref == \"refs/heads/main\""
  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
  }
  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account" "deployer" {
  account_id   = "mira-deployer"
  display_name = "MIRA deploys from GitHub Actions: push images, SSH to the VM through IAP"
}

resource "google_service_account_iam_member" "github_impersonates_deployer" {
  service_account_id = google_service_account.deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repository}"
}

resource "google_artifact_registry_repository_iam_member" "deployer_push" {
  repository = google_artifact_registry_repository.images.name
  location   = var.region
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.deployer.email}"
}

# SSH with sudo to this one VM, through IAP.
resource "google_compute_instance_iam_member" "deployer_login" {
  instance_name = google_compute_instance.mira.name
  zone          = var.zone
  role          = "roles/compute.osAdminLogin"
  member        = "serviceAccount:${google_service_account.deployer.email}"
}

resource "google_iap_tunnel_instance_iam_member" "deployer_tunnel" {
  instance = google_compute_instance.mira.name
  zone     = var.zone
  role     = "roles/iap.tunnelResourceAccessor"
  member   = "serviceAccount:${google_service_account.deployer.email}"
}

# OS Login to a VM that runs as a service account needs permission to act as that account.
resource "google_service_account_iam_member" "deployer_acts_as_vm" {
  service_account_id = google_service_account.vm.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.deployer.email}"
}

# `gcloud compute ssh` reads the instance to find it.
resource "google_project_iam_member" "deployer_view" {
  project = var.project_id
  role    = "roles/compute.viewer"
  member  = "serviceAccount:${google_service_account.deployer.email}"
}

# ---- budget alert ----

resource "google_billing_budget" "monthly" {
  count           = var.billing_account_id == "" ? 0 : 1
  billing_account = var.billing_account_id
  display_name    = "MIRA VM monthly"

  budget_filter {
    projects = ["projects/${data.google_project.this.number}"]
  }
  amount {
    specified_amount {
      # In the billing account's own currency; naming another one is refused.
      units = tostring(var.monthly_budget)
    }
  }
  threshold_rules {
    threshold_percent = 0.5
  }
  threshold_rules {
    threshold_percent = 0.9
  }
  threshold_rules {
    threshold_percent = 1.0
  }
  threshold_rules {
    threshold_percent = 1.0
    spend_basis       = "FORECASTED_SPEND"
  }
  depends_on = [google_project_service.apis]
}
