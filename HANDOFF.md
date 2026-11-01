# Handoff: where MIRA stands

Last updated 2026-11-01, after building Phase 5 (capture and the measured profile) on top of the audited Phases 1 to 4. Read `AGENTS.md` first (the rules), then this file, then the phase you are working on in `phases/`.

## In one paragraph

Phases 1 to 4 are built and verified as far as they can be without a YouCam key or a deploy. Nothing is deployed to Google Cloud. One real YouCam task has been run (1 unit, F30); nothing else has been spent. The repo runs end to end in mock mode with no credentials: the design system, the Welcome and Consent screens, the YouCam client and node lifecycle (cache, ledger, crash-safe polling, cleanup), the signed webhook door, the measurement engines and a run viewer that shows a demo graph finishing, then finishing again from cache at zero units. Every YouCam result in mock mode is synthetic and says so; one real response (a background-removal task and the price list) has been recorded. Phase 5 adds the capture flow, the measured profile and the privacy screen, all working end to end in mock mode (sample results, a fake Camera Kit in tests). Shade, look and proof screens are Phases 6 to 10.

## Standing preferences from the user

- **The deadline is not a constraint.** Build the full spec properly; do not cut scope for the hackathon date. ("Write the best code as humanly possible.")
- **Do not hop between phases.** The user asked for each phase to be checked against its own definition of done before moving on. Tick a box only when its acceptance criterion is met.
- **Cost approval before any deploy.** Before `terraform apply`, a Cloud Run deploy, or enabling a billable service, give an itemised running-cost estimate and wait for a go-ahead. Local and mock work needs no approval. YouCam units follow the same spirit (`AGENTS.md` already requires quote and confirm).
- **Cost-optimised but not lower quality.** Flash-tier models are fine (D17). Do not merge the services into one instance (D18).
- Secrets go in `.env.local` or Secret Manager, never in chat or in git.

## Phase status

| Phase | State | What is open |
| --- | --- | --- |
| 1 Foundation | Local work done and verified: `pnpm check` exits 0; a fresh clone with no credentials runs `pnpm dev:mock` (six services healthy in 9 s, demo run succeeds, state survives a restart, F24) | Needs you: GCP project and APIs, `terraform apply` (cost approval), Vertex smoke test and model IDs, Cloud Build trigger, YouCam key into Secret Manager |
| 2 Design system | Done. 18 components, tokens in CSS and TypeScript (a test keeps them equal), contrast test, gallery, Welcome, Consent, sessions, budget banner, error screen, icons and manifest | Nothing blocking. The budget banner's "See what uses units" link waits for a units page |
| 3 YouCam client and lifecycle | Done for everything testable without a key. Request builders are validated against the saved OpenAPI bundles, every documented error code is mapped, a client-side limiter keeps under YouCam's rate limit, saved looks are copied out before cleanup | Needs a consented photo or a deploy: recorded fixtures (1 of 15 recorded, live price list and one real task done), the `_confirm_` items, live adapters (Firestore, Cloud Tasks, Pub/Sub, Cloud Storage), OIDC verification of Cloud Tasks calls. Not built: image resizing and the face-crop helper, accessory and jewellery builders (Phase 8) |
| 5 Capture and the Twin | Built and tested in mock mode: capture flow (Camera Kit bridge, plain camera, upload path, repeats, body, hand, hair), upload checks, Build Twin graph and metrics, quote then build, profile screen with every state, privacy screen (inventory, download, delete), held-photo sweep | Needs a real phone and a consented person: the 10-attempt pass rate (DoD), Camera Kit specifics (F33), skin-type mapping (F34), a recorded live Build Twin. Not built: face-crop helper (F35), glasses or fringe detection |
| 4 Engines | Done: colour, ΔE2000 (all 34 Sharma pairs), shade, look, garment, audit, identity, noise floor, phantom, every endpoint, generated Python models with a contract test | Needs a deploy: Cloud Run with service-account auth. `faces.py` needs a BlazeFace `.tflite` model via `MIRA_FACE_MODEL_PATH` (not bundled; untested until supplied) |

Test counts (all pass, `pnpm check` exit 0): 897 unit and contract tests (schemas 78, runtime 33, youcam-client 172, workflows 178, webhook 14, fixtures 43, ui 184, web 41, agent 1, mcp 1, engines 147) and 222 Playwright tests in light, dark and mobile with axe (single-pass full runs are skipped on the other projects on purpose).

## What exists

| Area | State |
| --- | --- |
| `packages/schemas` | IDs, Metric, Run, RunNode (inputs, files, result URL, output, audit, error with guidance), Plan, Quote, LedgerEntry, Budget, CacheEntry, WorkItem, config with source and `calibrated` per value, env loader, claim linter (`pnpm lint:claims`), JSON Schema export and contract-sample export |
| `packages/runtime` | `createService()` plus the ports: state, queue, events, blobs, clock, with in-memory and file-backed adapters (D10) |
| `packages/youcam-client` | Typed client, feature registry (15 features), error mapping, pricing selectors, rate limiter, `FakeYouCam`, `ReplayYouCam`, fixture format and URL scrubbing; 67 saved OpenAPI bundles in `openapi/` |
| `packages/fixtures` | Loader, `fixture://` downloader, consent register. Empty of recordings |
| `packages/ui` | Tokens (CSS and TypeScript), 18 components, styles |
| `apps/workflows` | Lifecycle, ledger, cache, quote, graph runner, cleanup, save, restart recovery, recorder and smoke CLIs, the HTTP surface, the demo graph |
| `apps/webhook` | Standard Webhooks verification, forwards to workflows |
| `apps/web` | Shell, Welcome, Consent, sessions, budget banner, error boundary, run viewer, component gallery, webhook and MCP proxies, manifest and icons |
| `apps/agent`, `packages/mira-mcp` | Health-only skeletons (Phase 7 and 10) |
| `services/engines` | All of Phase 4; `models/generated/` is generated, do not edit |
| `infra/` | Terraform (valid, never applied), Dockerfiles, `cloudbuild.yaml` |
| CI | `pnpm check`, Terraform fmt and validate, JSON Schema, contract-sample and generated-model freshness |

## Verify it yourself

```bash
pnpm install
(cd services/engines && uv sync)          # uv fetches Python 3.12
pnpm check                                # lint + typecheck + test + Playwright; about 2 minutes
pnpm dev:mock                             # six services plus the web app, no credentials
```

Needs Node 24+, pnpm 11, uv. Playwright browsers: `pnpm --filter @mira/web exec playwright install chromium`. This container has Node 22, so everything runs with an engine warning.

Useful pages in mock mode: `/` and `/consent`, `/dev/components` (every component state), `/dev/runs` (start the demo graph, then run it again to see it finish from cache).

## Decisions (full text in `docs/DECISIONS.md`, D1 to D34)

D10 ports and adapters (built, mock side). D11 hand-written Zod per YouCam feature. D12 chain on the previous result URL. D13 verify webhooks and always poll as fallback. D14 anonymous signed sessions (built). D15 agent text uses placeholders for product and shade names (Phase 7). D16 Build Twin gives a same-session estimate, not a noise floor. D19 a gallery instead of Storybook, plain CSS instead of Tailwind. D20 two contrast fixes. D21 Atkinson keeps tabular figures. D22 and D27 design reviews. D23 images are never cached across runs. D24 the webhook forwards, workflows stays the only writer. D25 mock mode never calls synthetic results a recording. D26 prices only from feature-cost, fail closed. D28 generated Python models and how engines must read JSON (strict). D29 the client-side rate limiter. D30 saved looks are copied to `saved/`. D31 Build Twin: eight HD concerns, one face photo, optional separately quoted repeats. D32 body and hand photos are held at most two hours, visibly. D33 a failed retry never wipes a profile; delete waits for running runs. D34 confidence words say only what is known.

## Phase 5 map

- **Workflows:** `src/graphs/build-twin.ts` (graph, `assembleTwin`, executors), `src/twin/{extract,engine-client,uploads,image-info,profile,build,synthetic}.ts`. `tolerant` nodes (runner) let the write step run after failures. HTTP: `/internal/uploads`, `/internal/twin/{quote,build}`, `/internal/twin/:userId` (+ `/inventory`, `/export`, DELETE). Mock-only test knobs: `/internal/dev/session-cap`, `/internal/dev/twin`.
- **Web:** `app/(shell)/{capture,profile,settings/privacy}`, BFF routes under `app/api/{uploads,twin,runs}` (the person's id always comes from the signed cookie), `src/camera-kit/` (loader, bridge, payload parsing), `src/capture/` (flow rules, upload client, copy), `src/profile/` (copy, formatting, loaders).
- **Camera Kit URL** lives in `packages/youcam-client/src/camera-kit.ts` (lint keeps YouCam hosts there).
- **E2E:** Playwright now also starts the engines service (needs `uv sync`). `e2e/fake-camera-kit.ts` stands in for the SDK. Set `E2E_SHOTS_DIR` to also write review screenshots as files.
- **Mock quotes use the real price list** from `packages/fixtures/recorded/feature-cost.json`; a minimal profile quotes 56 units (16 + 20 + 10 + 10), repeats add 16 each.

## Vision review (2026-11-01) and what is still open

Four independent reviews read the whole repo against the vision. What was fixed is in D35 and F36 to F40. **Still open**, in order of weight:

- **No idempotency key at YouCam:** a person who restarts a run after `submit_unknown` can be charged twice. Ask the organisers (already on the list).
- **Deploy path, written but not applied or validated:** one workflows instance, private webhook and MCP, service-to-service ID tokens, secrets and addresses in Terraform (D36, F41, F42). `terraform validate` has not been run locally; CI runs it. Every secret needs a value before the services will start.
- **The live adapters are the real blocker for a deploy:** Firestore state, Cloud Tasks queue, Pub/Sub events and Cloud Storage blobs are not built, so `mira-workflows` refuses to start in live mode. They need the Firestore emulator (Java) or a real project to test.
- **Live auth into workflows' queue endpoint** (verifying Cloud Tasks' OIDC token) is not built; it fails closed.
- **Retention jobs are not built** (runs and the ledger after 30 days, orphaned profiles).
- **Accessibility and flow polish not done:** a recorded-run "Use a recorded run" action when over the cap, "See what uses units" on the budget banner, a toast when a background run ends, and a unit-test pass for Welcome reading the profile store rather than a cookie.
- **Web hardening:** a script-src CSP waits for a capture with the real Camera Kit SDK (F33).
- **Engines:** the phantom rule uses |rho| while ENGINES.md says rho; ITA is shown rounded next to a band computed unrounded.

## Things to know before building on this

- **The lifecycle has now run live once.** On 2026-11-01 one background-removal task went through the whole lifecycle against the real YouCam API: about 2 s, 1 unit, quote equal to charge, task deleted at cleanup (F30), and the engines were run on its real result (F31). Everything else (failure paths, crash and resume, webhooks, a 429, the other 14 features) is still proven only against the test double.
- **Duplicate-charge risk.** If `createTask` succeeds at YouCam but the reply is lost to a network error, a retry creates a second task and charges twice. YouCam documents no idempotency key. The retry limit is 4. Worth asking the organisers.
- **Eight of the fifteen features MIRA calls never mention webhooks in their bundles** (F28), so polling is the dependable path for skin tone, face attributes, the hair detectors, skin simulation, makeup and hair colour.
- **Price selection by description** for skin analysis and video is a guess until the first live feature-cost read (F20). It fails closed, so a wrong guess blocks a quote instead of misquoting.
- **Engines must read TypeScript payloads strictly:** `Model.model_validate_json(raw, strict=True)`. The default coerces `"0"` into a number, which Zod never does. The generated models are not yet used by the engine API, which has its own request models.
- **The recorded-run banner is off** until `MIRA_FIXTURES=recorded` and real recordings exist; until then it says "sample results" (D25).
- The Welcome screen still reads the `mira_profile` cookie (set when the profile page loads and when the profile is deleted); the profile and privacy screens read the real store.
- Welcome and Consent link to screens later phases build (`/shade`, `/look`, `/proof`, `/runs/recorded`); they land on an honest "not available yet" screen. `/capture`, `/profile` and `/settings/privacy` are real; Delete my profile also removes saved looks and their images.
- The Playwright screenshots are attached to results for review, not diffed (fonts load from Google at dev time).
- Five exact-duplicate files sit in the user's local project root (`README 2.md` and others). They were never committed and do not exist in a clone.

## Open items that need the user

- The YouCam key is in `.env.local` of the cloud session that built this (gitignored, in no commit). That file does not travel: on another machine put `YOUCAM_API_KEY=` in your own `.env.local`. The key was pasted into chat, so rotate it in the YouCam console when convenient. The RSA "secret key" you shared is stored as `YOUCAM_SECRET_KEY` but nothing reads it: the API authenticates with the Bearer key alone. The webhook URL still has to be added in the YouCam console after deploy.
- A clear photo of a person who has consented to it going to YouCam, plus a row in `packages/fixtures/CONSENT.md`, to record the 14 face and hair features (about 57 units for a smoke pass). Balance after the probe: 1,039 units.
- Go-ahead to deploy, and the budget-alert amount (default in Terraform: $20 a month).
- Ask the organisers: the "India link", whether YouCam has an idempotency key, and which features send webhooks.
- Re-check that `gemini-3-flash-preview` is still available before the final demo; it is a preview ID.

## Next steps, in order

1. With a consented photo, run `pnpm smoke:live --input <photo>` (about 57 units, it quotes and asks first), then `pnpm fixtures:record` for the Phase 5 and 6 features. That records the face features and settles the remaining `_confirm_` items. Note the CLI declines without a terminal; run it in one.
2. Phase 5 is built for mock mode. To close it: run capture on a real phone in live mode ten times and record the pass rate (F-row), confirm F33 and F34 from a recorded run, then decide whether to build the face-crop helper (needs a face-detector model).
3. Decide the Phase 6 preview-measurement question first: re-measure shade previews with YouCam (about 21 units per shade, hex only) or sample the pixels locally (Phase 4's colour code makes that cheap to try).
4. Then Phases 6 to 10 as written.

## Working rules that are easy to miss

- One YouCam client; every call through the node lifecycle; never resubmit a running task; `skin_smooth` always sent at 0 (`AGENTS.md` §2).
- The model never types a number; the claim linter runs in CI and at runtime. Prompts and refusal templates are exempt (`docs/COPY.md` §3).
- **Run the whole `pnpm check` before every push**, not only the package you touched. Two regressions this session were found only that way.
- **Check that a text edit landed.** Prettier reflows code, so a scripted find-and-replace can silently match nothing. Assert it, or grep afterwards.
- Tick a task's checkbox in its phase file only when its acceptance criteria are met and `pnpm check` passes.
- Update `docs/FACTS.md` for any claim, `docs/DECISIONS.md` for any choice someone could question.
- Branches `phase-NN/short-name`, Conventional Commits.
