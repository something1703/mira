# Architecture

MIRA is a measured beauty-and-style platform on Google Cloud. Every YouCam API sits in one stage of a single loop: **Measure → Decide → Render → Verify**. The governing rule: **the language model decides _what_ to do; deterministic workflows decide _how_.**

## 1. The four planes

| Plane | Lives in | Responsibility | Never does |
| --- | --- | --- | --- |
| Conversation | `apps/agent` on Cloud Run + Vertex AI | Understands requests, reads product pages, picks a workflow, quotes units, narrates results | Call YouCam directly, see images, type numbers |
| Workflow | `apps/workflows`, `apps/webhook` on Cloud Run + Cloud Tasks | Runs fixed graphs of nodes; owns the YouCam client, unit ledger and result cache | Make judgement calls a model should make |
| Measurement | `services/engines` (Python) on Cloud Run | All math: colour, statistics, render audit, identity drift | Call a model; store state |
| Trust | Code inside every plane | Ledger, cache, number injector, claim linter, render audit, deletion | Exist as a separate service |

Request path: `mira-web` → `mira-agent` → (plan, quote, user confirms) → `mira-workflows` → YouCam REST → `mira-webhook` → `mira-workflows` → `mira-engines` → Firestore → Pub/Sub → `mira-web` and `mira-agent`.

## 2. Services

| Service | Runtime | Public? | Job |
| --- | --- | --- | --- |
| `mira-web` | Next.js on Cloud Run | Yes | UI, JS Camera Kit capture, live progress, brand console |
| `mira-agent` | Node on Cloud Run | No (called by web) | Agent loop, tools, structured output, number injection, linter |
| `mira-workflows` | Node on Cloud Run, driven by Cloud Tasks | No | Graph runner, node lifecycle, ledger, cache |
| `mira-webhook` | Node on Cloud Run | Yes (signed callbacks only) | Receives YouCam task callbacks, advances graphs |
| `mira-engines` | Python FastAPI on Cloud Run | No | Measurement math |
| `mira-mcp` | Node on Cloud Run | Yes (token auth) | Exposes MIRA's engines as MCP tools for other agents (phase 10) |

Managed services: Firestore (state), Cloud Storage (images, 1-day lifecycle), Cloud Tasks (node execution, rate limit, retries, delayed polls), Pub/Sub (progress events), BigQuery (anonymised brand aggregates), Cloud Scheduler (Proof reminders, cleanup), Secret Manager (keys), Cloud Logging and Trace (one trace ID per run).

## 3. The node lifecycle

Every YouCam call in every workflow runs through these steps, implemented once in `apps/workflows/src/lifecycle/`.

1. **Cache check.** Key = SHA-256 of (input file hash, feature, version, canonical params JSON, engine version). Hit → return the cached result, zero units, jump to step 7.
2. **Quote and reserve.** Price from the cached feature-cost endpoint; live balance check; write a `reserve` ledger entry. Over any cap → stop cleanly; nothing is submitted.
3. **Upload once.** Register the file (`POST /s2s/v2.0/file`), PUT bytes to the presigned URL with the exact returned headers, store `file_id`. Chained steps pass the previous result's URL as `src_file_url` while it is valid (2 h), otherwise re-upload the stored copy (D12).
4. **Submit and persist.** Create the task and write `task_id` to the node document **before** waiting.
5. **Wait.** A delayed Cloud Task polls with backoff; a verified webhook (Standard Webhooks HMAC, D13) only makes the next poll immediate. Result URLs are valid for 2 hours, so results are copied to Cloud Storage on settle. Polls share the queue's rate budget, which stays under YouCam's 250 requests per 5 minutes (F11).
6. **Settle.** Success → `commit` the reserved units, copy the result to Cloud Storage, write the cache. Error → `release` units (failed tasks cost nothing), map the error code to user guidance.
7. **Audit.** If the node produced an image, the Render Auditor runs before any downstream node or the user sees it.
8. **Emit.** Pub/Sub progress event; the runner enqueues the next ready node.

Crash rule: a worker that restarts finds `task_id` present and resumes at step 5. It never resubmits.

## 4. Workflows

Each workflow is a typed graph in `apps/workflows/src/graphs/`. Nodes declare inputs, outputs and their feature; the runner resolves dependencies and runs ready nodes in parallel up to the queue's rate limit.

### 4.1 Build Twin (once per user)

```text
capture ─┬─ skin-analysis (HD) ──┐
         ├─ skin-tone-analysis ──┤
         ├─ face-attr-analysis ──┼─ same-session variation (engine, D16) ─ write-twin ─ delete-images
         ├─ fitzpatrick ─────────┤
         └─ hair: type + frizz (3 angles), density, length ┘
```

### 4.2 Match Shade

```text
twin ─ prerank-catalogue (engine, 0 units) ─ choose finish + coverage (engine)
     ─┬─ makeup-vto shade 1 ─ tone re-measure ─┐
      ├─ makeup-vto shade 2 ─ tone re-measure ─┼─ rank by ΔE00 vs bare skin ─ fidelity labels
      └─ … top 3–5 only ──────────────────────┘
```

### 4.3 Compose Look (order matters)

```text
cloth-v4 ─ audit garment colour ─ accessories (chained) ─ makeup-vto ─ hair ─ audit lip/foundation
        ─ identity-drift check ─ bg-replace ─ image-to-video (only if every audit passed)
```

Clothes go first because the generative clothes engine can disturb the face; face edits land on the final pixels.

### 4.4 Proof (weeks)

```text
setup: read product page ─ extract claim ─ phantom: skin-simulation × 5 intensities ─ skin-analysis × 5 ─ fit curve
check-in: 3 captures ─ skin-analysis × 3 ─ mean ─ compare to MDC ─ verdict ─ visualise on day-0 photo
```

### 4.5 Catalogue Ingest (brand side)

```text
product images ─ background removal ─ garment colour (engine) ─┐
product pages ─ small model extracts shade names + hexes ──────┴─ Firestore catalogue + BigQuery
```

## 5. Agent orchestration

Detailed in `docs/AGENT_RUNTIME.md`. In short: plan → quote → user confirms → workflow runs → agent narrates using metric IDs that the renderer fills in. Discovery-only calls (template lists, background presets) go to the YouCam MCP servers through an MCP client inside `mira-agent`.

## 6. Data

Detailed in `docs/DATA_MODEL.md`. Firestore holds live state, Cloud Storage holds images for under a day, BigQuery holds only anonymised aggregates with a minimum cohort size.

## 7. Environments

| Env | YouCam | Models | Data |
| --- | --- | --- | --- |
| `mock` | Fixtures replayed by `packages/youcam-client/mock` | Stubbed responses from `packages/fixtures/agent` | Firestore emulator |
| `dev` | Live, low caps | Vertex | Firestore emulator or a dev database |
| `prod` | Live, demo caps | Vertex | Production Firestore |

## 8. Failure model

| Failure | Behaviour |
| --- | --- |
| Worker crash mid-task | Resume by polling stored `task_id` |
| YouCam quality error (face too small, too dark, out of bound) | Release units, show capture guidance, offer recapture |
| Webhook missing | Fallback poll was already scheduled |
| YouCam rate limit (429) | Back off and re-enqueue; never resubmit a created task |
| Result URL expired (> 2 h) | Re-query the stored `task_id` for a fresh URL |
| One branch of a fan-out fails | Run continues; result states how many succeeded |
| Garment or lip drift in audit | Show with a drift label |
| Identity drift | Withhold the render; offer to retry |
| Model output invalid twice | Templated sentence built from metrics |
| Unit cap reached | Stop cleanly; offer the labelled recorded run |
