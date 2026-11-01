# Decision log

Short records of choices someone could reasonably question. Newest first.

| # | Date | Decision | Why | Alternatives considered |
| --- | --- | --- | --- | --- |
| D16 | 2026-11-01 | Build Twin computes a **same-session** variation estimate (s_w from the repeat captures); day-to-day variation (s_d) exists only after 3 sessions on different days | ENGINES §8 needs n ≥ 3 sessions for s_d; calling a one-session number a "noise floor" would overstate it | Label the first session's spread as the noise floor |
| D15 | 2026-11-01 | Agent text references products, shades and days by placeholder (`{shade.name}`, `{day}`) as well as metrics | Shade names contain digits ("320 Warm Sand"); the no-digits rule would otherwise reject honest answers or tempt the model to paraphrase names | Allow digits inside quoted product names (weakens the guarantee) |
| D14 | 2026-11-01 | Anonymous sessions: a signed, HttpOnly cookie carries `userId` and `sessionId`; the session unit cap is per `sessionId` | The spec has no login. People can use MIRA without an account, and caps need a stable key | Firebase Auth anonymous users (extra client SDK, same guarantees) |
| D13 | 2026-11-01 | Webhooks are verified per the Standard Webhooks scheme (`whsec_` HMAC-SHA256, timestamp tolerance, `webhook-id` idempotency), and every submitted task also gets a fallback poll | YouCam configures webhooks in the console and does not document which features send them (docs/YOUCAM_API.md §1.1) | Rely on webhooks alone |
| D12 | 2026-11-01 | Chained steps pass the previous `results.url` as `src_file_url` (valid 2 h), re-uploading the stored copy if it has expired; `dst_id` is not used until a live response shows it | No schema defines `dst_id` and no request accepts it | Guess a `dst_id` request field |
| D11 | 2026-11-01 | YouCam request and response schemas are hand-written Zod per feature, checked against the saved bundles, instead of generated types | The bundles mis-nest `results` and `data` (docs/YOUCAM_API.md §7.6), so generated types would be wrong | openapi-typescript plus patches |
| D10 | 2026-11-01 | Ports and adapters for state, queues, events and blobs (`packages/runtime`): file-backed store, in-process queue and bus, and local blobs in mock mode; Firestore, Cloud Tasks, Pub/Sub and Cloud Storage live. `mira-workflows` is the only writer of run state; web and agent read it through its API; Firestore rules deny all direct client access | `pnpm dev:mock` must run with zero credentials in about 60 s; the Firestore emulator needs Java and Cloud Tasks has no emulator. One owner of state keeps the ledger consistent | Firestore emulator in mock mode; clients reading Firestore directly |
| D9 | 2026-11-01 | ESLint pinned to 9.39.5 | `eslint-config-next` 16.4.3's plugins (react, import, jsx-a11y) support ESLint ≤ 9 | ESLint 10 without the Next rules |
| D8 | 2026-11-01 | TypeScript pinned to 6.0.3, not 7.0 | `typescript-eslint` 8.72 supports TypeScript < 6.1; TypeScript 7 is the new native compiler | TypeScript 7 without typed linting |
| D7 | 2026-11-01 | Submit under the eCommerce VTO track | Its brief asks for beauty and fashion as one experience, which Complete Look + Shade deliver; Proof adds Skin AI depth | Skin AI track |
| D6 | 2026-11-01 | Statistics use `raw_score`, never `ui_score` | `ui_score` is adjusted upwards by design and would hide real change | Using `ui_score` for friendlier numbers |
| D5 | 2026-11-01 | Neutral grey UI with one ultramarine accent | Colour-critical judgement needs a neutral surround; ultramarine cannot be confused with skin | Warm beauty palette |
| D4 | 2026-11-01 | Cloud Tasks + Firestore state machine instead of Cloud Workflows | YouCam is webhook-driven; per-node documents are easy to debug and show in the run viewer | Cloud Workflows parallel branches |
| D3 | 2026-11-01 | YouCam MCP only for discovery; multi-step work through MIRA workflows | Keeps caching, budgets and audits in one place | Let the model chain MCP calls |
| D2 | 2026-11-01 | Model never types numbers; renderer injects metrics | Removes hallucinated numbers by construction | Post-hoc fact-checking |
| D1 | 2026-11-01 | Google Cloud + Vertex AI, provider-agnostic adapter | Team has Google Cloud credits; adapter keeps Claude/Gemini swappable | Direct Anthropic API only |
