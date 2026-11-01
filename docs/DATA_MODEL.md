# Data model

Firestore holds live state; Cloud Storage holds images for under a day; BigQuery holds only anonymised aggregates. Schemas are defined once in `packages/schemas` (Zod) and exported as JSON Schema for Python.

## 1. Firestore

| Path | Fields (main) | Written by |
| --- | --- | --- |
| `twins/{userId}` | `createdAt`, `metrics: Record<MetricId, Metric>`, `fitzpatrickBand`, `noiseFloors: Record<Concern, NoiseFloor>`, `captureMeta` (mode SD/HD, quality checks passed) | Build Twin |
| `twins/{userId}/proofs/{proofId}` | `product`, `claim {concern, direction, magnitude?, windowDays}`, `phantom {usable, rho, curve}`, `sessions[] {at, scores[], mean}`, `verdicts[]`, `status` | Proof |
| `twins/{userId}/looks/{lookId}` | `slots`, `renderIds`, `fidelity`, `saved` | Compose Look (saved only) |
| `runs/{runId}` | `type`, `userId`, `status`, `planId`, `quote`, `unitsSpent`, `traceId`, `startedAt`, `endedAt`, `outputs` | Workflows |
| `runs/{runId}/nodes/{nodeId}` | `feature`, `version`, `params`, `cacheKey`, `taskId?`, `status`, `unitsReserved`, `unitsCommitted`, `resultRef?`, `audit?`, `error?`, `attempts` | Lifecycle |
| `plans/{planId}` | `userId`, `workflow`, `inputs`, `quote`, `confirmedAt?` | Agent / UI |
| `ledger/{entryId}` | `kind: reserve \| commit \| release`, `feature`, `units`, `runId`, `nodeId`, `at` | Lifecycle |
| `cache/{cacheKey}` | `feature`, `resultRef`, `metrics`, `createdAt`, `engineVersion` | Lifecycle |
| `catalog/{brandId}/items/{sku}` | `category`, `name`, `garmentLab?`, `shadeHex?`, `shadeLab?`, `finish?`, `imageRef`, `sourceUrl` | Catalogue Ingest |
| `renders/{renderId}` | `runId`, `nodeId`, `url`, `expiresAt`, `labels[]`, `kind: preview \| visualisation`, `recorded: bool` | Lifecycle |

`Metric = { id, value, unit, source: {feature, version, taskRunId}, confidence: "within" | "small" | "clear" | "n/a", measuredAt }`

Security rules: users read and delete only their own `twins/*`, `plans/*`, `runs/*` where `userId` matches; all writes come from services with service accounts.

## 2. Cloud Storage

- Bucket `GCS_BUCKET_TEMP` with a lifecycle rule: delete objects older than 1 day.
- Paths: `runs/{runId}/{nodeId}/{input|output}.{ext}`.
- Saved looks are copied to `saved/{userId}/{lookId}/` and deleted with the profile.

## 3. BigQuery (dataset `mira_brand`)

| Table | Row | Columns |
| --- | --- | --- |
| `shade_demand` | One anonymised twin | `skin_L`, `skin_a`, `skin_b`, `h_ab`, `fitzpatrick_band`, `region`, `week` |
| `efficacy_outcomes` | One finished proof | `product_id`, `concern`, `delta`, `mdc`, `words`, `fitzpatrick_band`, `skin_type`, `week` |
| `look_events` | One built look | `categories[]`, `brand_ids[]`, `saved`, `week` |

No user IDs, no images, week-level dates only. Views apply the minimum cohort (`MIRA_K_ANON_MIN`) before anything reaches the console.

## 4. Retention

| Data | Kept for |
| --- | --- |
| Images | Until the run ends (max 1 day), or until the user deletes a saved look |
| Twin metrics | Until the user deletes their profile |
| Runs, nodes, ledger | 30 days, then deleted (Scheduler job) |
| Cache | 7 days |
| BigQuery aggregates | Kept; contain no personal data |
