# MIRA on one VM

The first public deploy (D48): one Compute Engine VM runs everything under Docker Compose. GitHub Actions builds the images and starts them. The Cloud Run stack in `infra/` is for later, once the live adapters exist.

```
Internet ──443──▶ Caddy (HTTPS, automatic certificate)
                    └──▶ web (Next.js) ──▶ workflows (YouCam runs, ledger, unit caps) ──▶ engines (Python)
                                       └──▶ agent (Ask MIRA)
State: /var/lib/mira on the VM's disk, snapshotted daily.
```

- **Mode:** `MIRA_MODE=mock` with `MIRA_YOUCAM=live`. That is local state with real YouCam measuring, the mode every live test ran in (`docs/TESTS.md`). Ask MIRA uses its built-in answers in this mode, not a language model.
- **Open ports:** only 80 and 443. SSH goes through Identity-Aware Proxy (IAP), so port 22 is closed to the internet. The VM has its own network, so the default network's open SSH rule does not apply.
- **Secrets:** each one goes only to the service that uses it. The YouCam key goes to workflows and the session secret to web. They live in Secret Manager, and `deploy.sh` writes them to root-only files on the VM, never to git or the Actions log.
- **Unit caps:** set in `host/deploy.sh`. The defaults are 150 units a day for the whole site, and 120 per session and per run. One profile costs 40–56 units and a shade match about 63.
- **No sample runs:** the drawn sample run is off wherever real YouCam is on (D49).

## Cost

These are list prices, about $31 a month in total:

| Item                                                                  | Per month             |
| --------------------------------------------------------------------- | --------------------- |
| e2-medium VM, all month                                               | ~$24.50               |
| 20 GB balanced disk                                                   | ~$2.00                |
| Static external IP (Standard tier)                                    | ~$3.65                |
| Artifact Registry (the 10 newest of each image)                       | ~$0.15                |
| Daily snapshots, 7 kept                                               | ~$0.30                |
| Internet traffic (Standard tier, first 200 GB free)                   | ~$0                   |
| Secret Manager, IAP, Workload Identity, Logging, budget alert         | $0 (free tiers)       |
| GitHub Actions (public repository)                                    | $0                    |

- **Stopping:** a stopped VM costs about $2 a month for the disk, plus about $7 if the IP stays reserved. `terraform destroy` removes everything.
- **Not GCP:** YouCam units are billed separately and are the real limit.

## First-time setup

You need `gcloud` signed in as a project owner, and Terraform 1.9 or later.

**1. Create the infrastructure.** The state bucket is shared with `infra/`, under its own prefix.

```bash
gcloud config set project <project>
gcloud storage buckets create gs://<project>-tfstate --location=us-central1 --uniform-bucket-level-access   # skip if it exists
cd infra/vm
cp terraform.tfvars.example terraform.tfvars        # set project_id; billing_account_id for the budget alert
terraform init -backend-config="bucket=<project>-tfstate"
terraform plan
terraform apply
```

**2. Add the two secrets** by hand, so they never enter Terraform state:

```bash
grep '^YOUCAM_API_KEY=' ../../.env.local | cut -d= -f2- | tr -d '\n' \
  | gcloud secrets versions add mira-vm-youcam-api-key --data-file=-
openssl rand -base64 48 | tr -d '\n' | gcloud secrets versions add mira-vm-session-secret --data-file=-
```

**3. Give GitHub the addresses.** None of them is secret:

```bash
terraform output -json github_variables | jq -r 'to_entries[] | "\(.key) \(.value)"' \
  | while read -r k v; do gh variable set "$k" --body "$v"; done
```

**4. Deploy.** Run the **Deploy** workflow from the Actions tab, or push to `main`. After that, every push that passes CI deploys itself.

## How a deploy works (`.github/workflows/deploy.yml`)

1. **Trigger:** CI passes on `main`, or someone runs Deploy by hand. Only one deploy runs at a time.
2. **Sign-in:** GitHub signs in to Google Cloud through Workload Identity Federation, so no key is stored in GitHub. Only this repository's `main` branch can get a token.
3. **Build:** the four images build in parallel with layer caching, tagged with the commit, and are pushed to Artifact Registry.
4. **Start:** the workflow copies `host/compose.yaml`, `host/Caddyfile` and `host/deploy.sh` to the VM over IAP and runs `deploy.sh <commit>`. That script pulls the images and starts them, then waits for every health check. If a check fails, it restarts the previous release.
5. **Smoke test:** the workflow loads `/health` and the home page over HTTPS from outside. If that fails, it rolls back too.

## Running it

```bash
# A shell on the VM (through IAP)
gcloud compute ssh mira --zone us-central1-a --tunnel-through-iap

# On the VM
cd /opt/mira
sudo docker compose ps
sudo docker compose logs -f workflows
sudo ./deploy.sh rollback          # back to the release before this one
cat /var/lib/mira/release          # the commit that is live
```

- **Changing a cap:** edit `host/deploy.sh` and push.
- **Rotating the YouCam key:** add a new version of `mira-vm-youcam-api-key`, then run Deploy again. Each deploy reads the latest version.

## Check locally before a deploy

The same Compose file runs on a laptop, with local images and local folders:

```bash
docker build -f infra/docker/web.Dockerfile --build-arg MIRA_MODE=mock --build-arg MIRA_YOUCAM=live -t local/mira-web:test .
docker build -f infra/docker/node-service.Dockerfile --build-arg PACKAGE=@mira/workflows --build-arg PACKAGE_DIR=apps/workflows -t local/mira-workflows:test .
docker build -f infra/docker/node-service.Dockerfile --build-arg PACKAGE=@mira/agent --build-arg PACKAGE_DIR=apps/agent -t local/mira-agent:test .
docker build -f infra/docker/engines.Dockerfile -t local/mira-engines:test .
# Put common.env, web.env and workflows.env (as deploy.sh writes them) in $MIRA_ETC, then:
MIRA_REGISTRY=local MIRA_TAG=test MIRA_HOST=localhost MIRA_ETC=$PWD/.mira/etc MIRA_DATA=$PWD/.mira/vm \
  docker compose -f infra/vm/host/compose.yaml up --wait
```

Caddy serves `https://localhost` with its own local certificate, which the browser will warn about once.
