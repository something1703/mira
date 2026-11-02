# Security and privacy

MIRA handles face images, so it keeps as little as possible for as short as possible, and proves it.

## 1. Data minimisation

- Images exist only for the duration of a run (Cloud Storage lifecycle 1 day as a backstop).
- At the end of every run: delete Cloud Storage objects and call YouCam task delete with resources for every task created.
- The Twin stores numbers only. The person can view every stored value and delete everything (Settings).
- No image or face is ever sent to a language model.

## 2. Secrets

- YouCam key, model credentials and webhook secret live in Secret Manager; services read them at start-up.
- The browser never receives the YouCam key; `NEXT_PUBLIC_*` variables never hold secrets (lint rule).
- The webhook endpoint verifies the Standard Webhooks HMAC-SHA256 signature (D13), rejects stale timestamps, and checks the task ID exists in Firestore before acting.

## 3. Access

- Service-to-service calls use Cloud Run IAM with dedicated service accounts and least privilege.
- Firestore security rules restrict user documents to their owner.
- The MIRA MCP server requires a bearer token and enforces per-token unit caps.

## 4. Untrusted content

- Product pages, shade lists and catalogue files are data, never instructions. The extraction prompt says so, the output is schema-validated, and the agent eval set includes injection attempts.
- URLs fetched for product pages: http(s) only, size and time limits, no private IP ranges.

## 5. Consent

- Consent screen before the camera (see `docs/UX_FLOWS.md` §2).
- Fixtures containing a real face require written consent, listed in `packages/fixtures/CONSENT.md`.
- Demo panel people: team members with consent or labelled AI-generated people.

## 6. Logging

Structured logs with trace IDs. Never log images, image URLs (signed or not), keys, raw prompts with personal data, or full model outputs containing metrics tied to a user ID.

## 7. Not a medical device

MIRA describes appearance. It does not diagnose or treat. The claim linter enforces this in copy, prompts and model output.
