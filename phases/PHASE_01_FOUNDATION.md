# Phase 1 — Foundation

**Goal:** a monorepo that builds, tests, deploys empty services to Google Cloud, and runs in mock mode, so every later phase only adds features.

**Depends on:** nothing. **Read first:** `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY_PRIVACY.md`.

## Deliverables

| Path | What |
| --- | --- |
| `package.json`, `pnpm-workspace.yaml`, `turbo.json` | Workspace with all apps and packages from `AGENTS.md` §4 |
| `apps/*`, `services/engines`, `packages/*` | Skeletons with health endpoints and one passing test each |
| `packages/schemas` | Config, `MetricId`, `Run`, `Node`, `Plan`, `LedgerEntry` schemas; JSON Schema export script |
| `packages/schemas/src/claim-linter.ts` | Claim linter with the banned list from `docs/COPY.md` |
| `infra/` | Terraform for every GCP resource below |
| `.github/workflows/ci.yml` | `pnpm check` on every push |
| `pnpm dev:mock` (Turborepo) | Starts all services with `MIRA_MODE=mock` (file-backed state in `.mira/`, no emulator; D10) |

## Tasks

### Repo and tooling
- [x] Initialise pnpm + Turborepo; TypeScript strict base config; ESLint + Prettier; `uv` project for engines with ruff and mypy strict.
  *Accept:* `pnpm lint` and `pnpm typecheck` pass on the empty workspace.
- [x] Add `pnpm dev:mock`, `pnpm dev`, `pnpm test`, `pnpm test:e2e`, `pnpm check` scripts as in `AGENTS.md` §5.
  *Accept:* `pnpm dev:mock` starts every service and the web app shows a placeholder page with the lockup.
- [x] Config loader (`packages/schemas/src/env.ts`): validates env with Zod at start-up; in `mock` mode no secret is required.
  *Accept:* starting live mode without `YOUCAM_API_KEY` fails fast with a readable message.
- [x] Trace ID middleware for every service; propagated via `x-mira-trace` header and Pub/Sub attributes.
- [x] Claim linter: stems and scope rules from `docs/COPY.md` §3 (disclaimer allowlisted; prompts and refusal templates excluded); runs on UI copy files, the README and the Devpost description.
  *Accept:* a test file containing "clinically proven" fails `pnpm lint`.

### Google Cloud
- [ ] Create or choose the project; enable APIs: Cloud Run, Cloud Tasks, Firestore, Cloud Storage, Pub/Sub, BigQuery, Cloud Scheduler, Secret Manager, Vertex AI, Artifact Registry, Cloud Build.
- [ ] Terraform: _(written and `terraform validate` clean in `infra/`; not yet applied, pending the cost review)_ Artifact Registry repo; Cloud Run services (`mira-web`, `mira-agent`, `mira-workflows`, `mira-webhook`, `mira-engines`) with one service account each and least-privilege IAM; Firestore (native mode); bucket `GCS_BUCKET_TEMP` with a 1-day delete lifecycle rule; Cloud Tasks queues `youcam-submit`, `youcam-poll`, `engine-jobs`; Pub/Sub topic `run-events`; BigQuery dataset `mira_brand`; Secret Manager secrets (empty).
  *Accept:* `terraform apply` from clean succeeds; `terraform plan` afterwards shows no changes.
- [ ] Vertex AI: in Model Garden, enable the Claude and/or Gemini models for your region; record exact model IDs (with `@date` suffix) in `.env.example` comments and `docs/FACTS.md`.
  *Accept:* a one-line smoke script returns a completion from `MIRA_MODEL_MAIN` and `MIRA_MODEL_SMALL`.
- [ ] Cloud Build trigger or GitHub Action that builds and deploys each service on main.

### Hackathon prerequisites
- [ ] Register on Devpost, claim the redeem code, sign up for YouCam API, redeem the free units, create an API key, store it in Secret Manager.
- [x] Note the India-region link from the hackathon page and decide the API server; record in `docs/FACTS.md`. (YouCam documents one server; F16. The India link itself could not be inspected.)

## Tests

- One unit test per package; one Playwright test that loads the placeholder page in mock mode.
- Claim linter tests (banned stems caught, allowed phrases pass).
- Env loader tests for mock and live.

## Definition of done

- [x] `pnpm check` passes locally and in CI. _(Locally exit 0 including 84 Playwright tests; CI green on every push of this branch.)_
- [x] `pnpm dev:mock` works on a fresh clone with no credentials. _(Fresh clone, no YouCam or Google variables: all six services healthy in 9 s, a demo run succeeds, state survives a restart. F24.)_
- [ ] All six services deployed and returning 200 on `/health` in the cloud.
- [ ] Vertex smoke test passes; model IDs recorded.

## Demo moment

A fresh clone running in mock mode in under a minute, and the same skeleton live on Cloud Run.
