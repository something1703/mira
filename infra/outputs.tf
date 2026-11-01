output "service_urls" {
  description = "Cloud Run URL per service."
  value       = { for k, s in google_cloud_run_v2_service.svc : k => s.uri }
}

output "image_repository" {
  value = local.image
}

output "buckets" {
  value = { temp = google_storage_bucket.temp.name, saved = google_storage_bucket.saved.name }
}

output "service_accounts" {
  value = { for k, sa in google_service_account.svc : k => sa.email }
}
