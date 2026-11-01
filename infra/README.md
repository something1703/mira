# Infrastructure

Terraform for every Google Cloud resource MIRA uses (phases/PHASE_01_FOUNDATION.md). Nothing here runs in mock mode.

## What it creates

| Resource | Notes |
| --- | --- |
| Six Cloud Run services | `mira-web`, `-agent`, `-workflows`, `-webhook`, `-engines`, `-mcp`; scale to zero; `max_instances` caps spend |
| One service account per service | Least-privilege grants in `services.tf`: who may invoke whom, which secrets each reads |
| Firestore (native) | Run state, twins, ledger, cache |
| Buckets | `<project>-mira-temp` (1-day delete rule) and `<project>-mira-saved` (saved looks only) |
| Cloud Tasks queues | `youcam-submit`, `youcam-poll` (rate-capped under YouCam's 250 requests / 5 min), `engine-jobs` |
| Pub/Sub topic | `run-events` |
| BigQuery dataset | `mira_brand` (tables in phase 10) |
| Secret Manager | Empty secrets: `youcam-api-key`, `youcam-webhook-secret`, `mira-session-secret`, `mira-mcp-tokens`, `anthropic-api-key` |
| Artifact Registry | `mira` Docker repository with a cleanup policy |

## First-time setup

```bash
gcloud config set project <project>
gcloud storage buckets create gs://<project>-tfstate --location=<region> --uniform-bucket-level-access
cd infra
cp terraform.tfvars.example terraform.tfvars   # set project_id and region
terraform init -backend-config="bucket=<project>-tfstate"
terraform plan
```

Before `terraform apply`, read the running-cost estimate. Services read their secrets from Secret Manager at start-up (`version = "latest"`), so **every secret needs a value before the services will start**. Add the values by hand (never through Terraform, so they never enter state):

```bash
printf '%s' "$YOUCAM_API_KEY" | gcloud secrets versions add youcam-api-key --data-file=-
```

Images: `gcloud builds submit --config infra/cloudbuild.yaml`. The first `apply` expects a `bootstrap` tag to exist; push one with the same build and `--substitutions=SHORT_SHA=bootstrap`.

## Cost

Everything scales to zero, so an idle deploy costs about $1 a month (stored images). Cloud Run bills only while a request is running, and the largest charge is the language model, about 0.6¢ per assistant turn with Gemini 3 Flash. See decisions D17 and D18 for why the services stay separate and why the model is Flash.

- `billing_account_id` creates a budget alert (emails at 50%, 90% and 100% of actual spend and 100% of forecast; it does not cap spend).
- `warm_services = ["web"]` keeps one idle instance for the judging window, about $13 a month.
- Cloud Build uses the default machine, whose first 2,500 minutes a month are free.
