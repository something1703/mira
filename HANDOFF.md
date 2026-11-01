# Handoff: where MIRA stands

Written 2026-11-01 for whoever (or whichever Claude session) picks this up next. Read `AGENTS.md` first (the rules), then this file, then the phase you are working on in `phases/`.

## In one paragraph

Phase 1 (foundation) is built, tested and green in CI. Nothing is deployed to Google Cloud and no YouCam units have been spent. The repo has a working monorepo, six service skeletons that answer `/health`, the shared schemas, a claim linter, Terraform that validates but has not been applied, CI, and a corrected, source-cited YouCam API reference. No product feature exists yet: the web app is a placeholder with the lockup and the line "Look, measured." Everything runs in mock mode with no credentials.

## Standing preferences from the user

- **The deadline is not a constraint.** Build the full spec properly; do not cut scope for the hackathon date. ("Write the best code as humanly possible.")
- **Cost approval before any deploy.** Before `terraform apply`, a Cloud Run deploy, or enabling a billable service, give an itemised running-cost estimate and wait for a go-ahead. Local and mock work needs no approval. YouCam units follow the same spirit (`AGENTS.md` already requires quote and confirm).
- **Cost-optimised but not lower quality.** Flash-tier models are fine (decision D17). Do not merge the services into one instance; that raises the bill (D18).
- Secrets go in `.env.local` or Secret Manager, never in chat or in git.

## What exists

| Area | State |
| --- | --- |
| Spec and design | `docs/`, `phases/`, `assets/`, `AGENTS.md`. `docs/YOUCAM_API.md`, `docs/FACTS.md`, `docs/DECISIONS.md` and `docs/ARCHITECTURE.md` were corrected from the research below |
| `packages/schemas` | Result type, IDs, Metric (number, colour, category), Run, RunNode, Plan, Quote, LedgerEntry, config with source and `calibrated` per value, env loader (fails fast in live mode, nothing needed in mock), trace helpers, claim linter and its CLI (`pnpm lint:claims`), JSON Schema export to `services/engines/mira_engines/schemas/` |
| `packages/runtime` | `createService()`: validated env, scrubbed JSON logs, `x-mira-trace` propagation, `/health`, error handler that hides internals |
| Services | `apps/agent`, `apps/workflows`, `apps/webhook`, `packages/mira-mcp`: skeletons on ports 4010, 4020, 4030, 4050. `services/engines`: FastAPI on 4040 with every threshold in `config.py` (source plus calibrated flag) |
| `apps/web` | Next.js 16 placeholder, `/health`, security headers, Gloock and Atkinson fonts through `next/font`, Playwright with axe in light, dark and mobile |
| `packages/ui` | Only `tokens/colors.css` (all colour tokens, both themes). Components are Phase 2 |
| `packages/youcam-client` | Only `openapi/`: 67 official bundles, saved unmodified, with `SOURCES.md` (docs v1.17, downloaded 2026-11-01). No client code yet |
| `infra/` | Terraform (Cloud Run x6, Firestore, two buckets, three Cloud Tasks queues, Pub/Sub, BigQuery dataset, Secret Manager, IAM, optional budget alert), Dockerfiles, `cloudbuild.yaml`. `terraform validate` passes; never applied |
| CI | `.github/workflows/ci.yml` runs `pnpm check` plus Terraform fmt/validate and a JSON Schema freshness check. Green on the latest commit |

## Verify it yourself

```bash
pnpm install
(cd services/engines && uv sync)          # uv fetches Python 3.12
pnpm check                                # lint + typecheck + test + Playwright; about 90 seconds
pnpm dev:mock                             # six services plus the web app, no credentials
```

Needs Node 24+, pnpm 11, uv. Playwright browsers: `pnpm --filter @mira/web exec playwright install chromium`.

Test counts at handoff: schemas 62, runtime 5, one health test per service, engines 7, web e2e 9 (three projects).

## Phase 1 definition of done: what is and is not ticked

Done: repo and tooling, scripts, config loader, trace middleware, claim linter, Terraform written and validated, CI, mock mode.

Not done, all of them blocked on the user's go-ahead or credentials (see `phases/PHASE_01_FOUNDATION.md`):

- `terraform apply` and "all six services return 200 in the cloud" (needs the cost approval)
- Vertex smoke test and recording the exact model IDs in `docs/FACTS.md`
- Cloud Build trigger for deploys on `main`
- Devpost registration, YouCam sign-up, API key into Secret Manager (the user says the account side is done)

## Decisions made (full text in `docs/DECISIONS.md`)

D8 TypeScript pinned to 6.0.3 (typescript-eslint does not support 7 yet). D9 ESLint pinned to 9.39.5 (Next's plugins). D10 ports and adapters for state, queue, events and blobs, with file-backed and in-process versions in mock mode; **decided but not built**. D11 hand-written Zod per YouCam feature, because the bundles mis-nest `results`. D12 chain steps by passing the previous `results.url` (valid 2 hours) until `dst_id` is confirmed live. D13 verify webhooks per Standard Webhooks and always schedule a fallback poll. D14 anonymous signed-cookie sessions; **not built**. D15 agent text uses placeholders for product and shade names as well as metrics; **not built**. D16 Build Twin produces a same-session variation estimate, not a "noise floor". D17 Gemini 3 Flash for the agent, gated by the 95% eval. D18 keep six scale-to-zero services.

## YouCam research: the corrections that matter

Full report with a source per line: `docs/research/youcam-api-2026-11-01.md`. The ones that change code:

1. **Only one API server** is documented (`yce-api-01.makeupar.com`). The hackathon page's "India link" could not be inspected; ask the organisers.
2. **Result URLs last 2 hours.** Copy results out immediately. The retention pages disagree on task lifetime (24 hours vs 30 days); treat tasks as dead after 24 hours.
3. **Delete** is `POST /s2s/v2.0/task/delete {task_id}` and fails while the task is running.
4. **`dst_id` is not in any schema.** Chain through `results.url` or confirm with a live response.
5. **Webhooks are configured once in the YouCam console** (no per-request field), signed with Standard Webhooks HMAC-SHA256. Payload has no result, so GET the task.
6. **Credit calls:** balance `GET /s2s/v1.0/client/credit` (use `amount_dec`), cost `GET /s2s/v2.0/credit/feature-cost` (free, paged).
7. **Facial Color Tones costs 20 units and returns hex only** (no Lab, hair colour is one of 7 fixed values). Re-measuring every shade preview with it costs about 21 units per shade. **Open question for Phase 6:** measure previews locally (sample pixels, convert to Lab) instead, or accept the cost. Decide before building the Shade graph.
8. **Fitzpatrick needs `version: "1.0"`.** Hair type and frizz need three photos (front, right, left, same size).
9. **Clothes:** all paths are `/s2s/v2.0/task/cloth*`; v4 adds `outer`; v4's unit cost is unlisted (read feature-cost).
10. **Camera Kit:** `faceQualityChanged` keys are `{hasFace, position, frontal, lighting}`; `videoQuality` is ignored in `comprehensive` mode, so HD skin capture is a separate `hdskincare` capture.
11. **Rate limit:** 250 requests per 300 seconds per key and per IP. Every poll counts; the Cloud Tasks queues are throttled below it.

## Open items that need the user

- YouCam API key into `.env.local` (not in chat), and the webhook URL added in the YouCam console after deploy.
- Go-ahead to deploy, and the budget-alert amount (default in Terraform: $20 a month).
- Consented faces for fixtures (Phases 3, 6, 8, 9 need real recordings).
- Re-check that `gemini-3-flash-preview` is still available before the final demo; it is a preview ID.
- Five exact-duplicate files sit in the user's local project root (`README 2.md` and others). They were never committed and do not exist in a clone.

## Next steps, in order

1. **Phase 2 (design system) and Phase 4 (engines) in parallel.** Neither needs credentials. Phase 2: build components from `packages/ui/tokens/colors.css` and `assets/design/mira-ui-reference.html`, starting with the Ring. Phase 4: start with `colour.py` and CIEDE2000 against the 34 Sharma reference pairs.
2. **Phase 3 (YouCam client and lifecycle).** Build the ports and adapters from D10 first. Write Zod per feature from the saved bundles. Two requirements that are not yet in the phase file: the web app must proxy the public webhook and MCP paths to the internal services, and `mira-workflows` must verify Google OIDC tokens on Cloud Tasks calls itself, because `mira-web` is the public front door.
3. Then Phases 5 to 10 as written. Decide the Phase 6 preview-measurement question (item 7 above) first.

## Working rules that are easy to miss

- One YouCam client; every call through the node lifecycle; never resubmit a running task; `skin_smooth` always sent at 0 (`AGENTS.md` §2).
- The model never types a number; the claim linter runs in CI and at runtime. Prompts and refusal templates are exempt (`docs/COPY.md` §3).
- Tick a task's checkbox in its phase file only when its acceptance criteria are met and `pnpm check` passes.
- Update `docs/FACTS.md` for any claim, `docs/DECISIONS.md` for any choice someone could question.
- Branches `phase-NN/short-name`, Conventional Commits.
