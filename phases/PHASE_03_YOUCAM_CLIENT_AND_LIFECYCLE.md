# Phase 3 — YouCam client and node lifecycle

**Goal:** one typed YouCam client and one node lifecycle that every workflow uses: cached, budgeted, crash-safe, audited, observable.

**Depends on:** Phase 1. **Read first:** `docs/YOUCAM_API.md`, `docs/ARCHITECTURE.md` §3–4, `docs/DATA_MODEL.md`.

## Deliverables

| Path | What |
| --- | --- |
| `packages/youcam-client/src/schemas/` | Hand-written Zod request and response schemas per feature, checked against the saved OpenAPI bundles (D11) |
| `packages/youcam-client/src/features.ts` | Feature registry: slug, version, file endpoint, task endpoint, webhook support, request builder, result parser |
| `packages/youcam-client/src/mock/` | Fixture replay with recorded latencies |
| `packages/fixtures/` | Recorded responses for every feature MIRA uses + `CONSENT.md` |
| `apps/workflows/src/lifecycle/` | Cache, ledger, upload, submit, wait, settle, audit hook, emit |
| `apps/workflows/src/runner/` | Graph runner on Cloud Tasks |
| `apps/webhook/` | Signed callback receiver |
| `apps/web/app/dev/runs/` | Run viewer (`?dev=1`) |
| `scripts/fixtures-record.ts`, `scripts/smoke-live.ts` | Recorder and live smoke test |

## Tasks

### Client
- [ ] Write Zod schemas per feature from the saved bundles in `packages/youcam-client/openapi/` (D11); note the bundle date in each file.
- [ ] Confirm every _confirm_ entry in `docs/YOUCAM_API.md` §2 from the bundles; update the doc and `docs/FACTS.md`.
- [ ] Feature registry with request builders; `makeup-vto` builder injects `skin_smooth: 0` unless `allowSmoothing` is explicitly true.
  *Accept:* unit test fails if any makeup request lacks `skin_smooth`.
- [ ] File registration + presigned PUT with the exact returned headers; image pre-processing (resize to limits, face-crop helper for skin analysis).
- [ ] Task create, poll (exponential backoff, cap), result parse; error mapping table for every documented error code.
- [ ] Credit balance and feature-cost calls; cost cache refreshed daily.
- [ ] Task delete with resources.

### Lifecycle and runner
- [ ] Cache key = SHA-256(input hash, feature, version, canonical params, engine version).
- [ ] Ledger: reserve → commit / release; caps per node, run, session.
  *Accept:* over-cap node never submits; ledger sums equal committed units.
- [ ] Persist `taskId` before waiting; on restart with `taskId` present, resume polling.
  *Accept:* a test kills the worker after submit; the resumed run makes zero additional create calls.
- [ ] Webhook receiver verifies secret and task existence, then enqueues `advance(runId, nodeId)`; poll fallback for features without webhooks.
- [ ] Graph runner: typed graph definition, dependency resolution, parallel ready nodes up to queue rate, partial-failure semantics, cancellation of unstarted nodes.
- [ ] Pub/Sub `run-events` (node started, done, cached, failed, audited); web subscribes through a server-sent events endpoint.
- [ ] End-of-run cleanup: delete Cloud Storage objects and YouCam tasks unless the user saved the output.

### Ports, adapters and edges
- [ ] Ports and adapters in `packages/runtime` for state, queue, events and blobs (D10): file-backed / in-process for mock, Firestore / Cloud Tasks / Pub/Sub / Cloud Storage live.
- [ ] `mira-web` proxies the public webhook and MCP paths to the internal services; `mira-workflows` verifies Google OIDC tokens on Cloud Tasks calls itself.

### Tools
- [ ] `pnpm fixtures:record` (quote + confirm, scrubs signed URLs).
- [ ] `pnpm smoke:live` (one cheap task per feature, after quote + confirm).
- [ ] Run viewer: graph with node states, units per node, cache hits, audit outcomes, ledger table.

## Tests

Everything listed for client, lifecycle and workflows in `docs/TESTING.md`, using a fake clock and a fake Firestore.

## Definition of done

- [ ] Fixtures recorded for every feature used by Phases 5–9.
- [ ] Lifecycle tests cover cache hit, over budget, crash after submit, webhook vs poll, error release, cleanup.
- [ ] A demo graph of three fake nodes runs live and in mock, visible in the run viewer.

## Demo moment

The run viewer lighting up node by node, then the same run again finishing instantly from cache with zero units.
