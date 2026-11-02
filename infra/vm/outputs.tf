output "url" {
  description = "Where MIRA is served."
  value       = "https://${local.host}"
}

output "ip" {
  description = "The VM's static IP. Point a custom domain's A record here if you use one."
  value       = google_compute_address.web.address
}

# Set these as GitHub repository variables (README); none of them is a secret.
output "github_variables" {
  description = "Repository variables the deploy workflow reads."
  value = {
    GCP_PROJECT_ID   = var.project_id
    GCP_REGION       = var.region
    GCP_ZONE         = var.zone
    GCP_WIF_PROVIDER = google_iam_workload_identity_pool_provider.github.name
    GCP_DEPLOY_SA    = google_service_account.deployer.email
    MIRA_REGISTRY    = local.registry
    MIRA_VM          = google_compute_instance.mira.name
    MIRA_HOST        = local.host
  }
}
