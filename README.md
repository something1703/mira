<p align="center"><img src="assets/brand/mira-lockup.svg" alt="MIRA" width="320"></p>

# MIRA — look, measured

MIRA is a beauty-and-style platform built on Perfect Corp's YouCam API. It measures a person once, then helps them choose foundation, compose a complete look and check whether a skincare product is working. The design rule is that every generated image is re-measured before anyone sees it.

> **Status:** the foundation, design system, YouCam client and unit ledger, measurement engines, and the capture and measured-profile flow (Phases 1 to 5) are built and tested in mock mode. Shade matching, the agent, Complete Look, Proof and the brand console (Phases 6 to 10) are not built yet, so the "re-measures every render" check, noise-floor progress tracking and the brand console below describe the design, not working features. See [`HANDOFF.md`](HANDOFF.md) for the exact state.

Built for the **YouCam API Skin AI & eCommerce VTO Hackathon** (Perfect Corp × Devpost), eCommerce VTO track.

## Why MIRA exists

- **Try-on previews airbrush you by default.** `makeup-vto` applies skin smoothing at strength 50 unless told otherwise, so the shopper buys a product that never looked like the preview. MIRA renders unretouched.
- **Nobody verifies a render.** A try-on can return the wrong garment colour, the wrong lip shade, or a subtly different face. MIRA re-measures every render and labels its fidelity.
- **Skin scores move with lighting, not just skin.** MIRA measures each person's day-to-day variation (a same-session estimate first, then across days) and only reports a change bigger than it.
- **Brands cannot see who their range fails.** The brand console shows which measured skin tones have no matching shade.

## What it does (the plan; the Measured Twin is the part that exists today)

| Module | What the shopper or brand gets | YouCam capabilities |
| --- | --- | --- |
| Measured Twin | One guided capture becomes a profile of numbers; images are deleted | Camera Kit, Skin Analysis HD, Facial Color Tones, Face Attributes, Fitzpatrick, hair detection |
| Shade | Foundation and concealer matched by closed-loop measurement | Makeup VTO, Facial Color Tones |
| Complete Look | Clothes, accessories, jewellery, makeup and hair as one look, in the venue, in motion | Clothes VTO, accessory and jewellery VTO, Makeup VTO, hair VTO, background change, image-to-video |
| Proof | Whether a skincare product is visibly working, above the person's own noise floor | Skin Analysis, Skin Simulation |
| Event Mode | Several complete looks planned for one multi-day event | All of the above |
| Brand console | Shade Gap Map, measured reviews, efficacy by skin type, cross-category attach | Aggregates from the above |

## Run it in 60 seconds (no credentials)

Needs Node 24+, pnpm 11 and [uv](https://docs.astral.sh/uv/) (it fetches Python 3.12 for the measurement engines by itself).

```bash
pnpm install
pnpm dev:mock        # a synthetic YouCam stand-in; no API key, no cloud account
open http://localhost:3000
```

Mock mode needs no credentials. Every screen that exists works, and its results are labelled "sample results" because they are made-up numbers. They become a "recorded run" only once real YouCam responses have been recorded (D25). Screens for later phases land on a page that says they are not available yet.

## Run it live

Live mode is **not available yet**: the Firestore, Cloud Tasks, Pub/Sub and Cloud Storage adapters are not built, so `pnpm dev` stops with a message saying so. The YouCam client itself has run one real task end to end (docs/FACTS.md F30).

```bash
cp .env.example .env.local     # add YOUCAM_API_KEY and Google Cloud project settings
pnpm dev
```

Full setup, including Google Cloud, is in [`phases/PHASE_01_FOUNDATION.md`](phases/PHASE_01_FOUNDATION.md).

## Repository map

| Path | Contents |
| --- | --- |
| `AGENTS.md` | Rules for every coding agent and human contributor. Read first. |
| `HANDOFF.md` | Current status, decisions, open items and next steps for whoever continues |
| `docs/ARCHITECTURE.md` | Planes, services, workflows, node lifecycle |
| `docs/DESIGN_SYSTEM.md` | Tokens, type, colour, components, motion |
| `docs/BRAND.md` | Logo, usage, voice |
| `docs/UX_FLOWS.md` | Every screen and every state |
| `docs/COPY.md` | Microcopy and the banned-language list |
| `docs/YOUCAM_API.md` | API contracts, gotchas, unit costs |
| `docs/ENGINES.md` | The measurement math, with formulas and thresholds |
| `docs/AGENT_RUNTIME.md` | MIRA's in-product agent: tools, schema, prompts |
| `docs/DATA_MODEL.md` | Firestore, Cloud Storage, BigQuery |
| `docs/SECURITY_PRIVACY.md` | Data minimisation, deletion, secrets |
| `docs/TESTING.md` | Test strategy and fixtures |
| `docs/FACTS.md` | Every public claim traced to code or a measurement |
| `docs/DECISIONS.md` | Architecture decision log |
| `docs/research/` | Source-cited research behind the API facts (YouCam docs and OpenAPI bundles) |
| `docs/DEMO_AND_SUBMISSION.md` | Demo script and Devpost checklist |
| `phases/` | Ten build phases, each with tasks and a definition of done |
| `apps/`, `services/`, `packages/` | The services and shared packages (layout in `AGENTS.md` §4; `packages/runtime` holds shared service plumbing) |
| `skills/` | A Skill in the YouCam Skills format (`measured-shade-match`) |
| `infra/` | Terraform, Dockerfiles and Cloud Build config |
| `assets/brand/` | Logo set (lockup, mark, wordmark, favicon; light, dark, mono) |
| `assets/design/` | Living UI reference page with screenshots in both themes |

## For other agents

MIRA's measurements are available to other agents through an MCP server (`packages/mira-mcp`). It
has four read-only tools: `shade_match`, `measure_change`, `audit_render` and `explain_metric`. A
caller needs a bearer token, and each token has a daily allowance of units. The tools return the
numbers and the thresholds that decided them, and keep no image.

`skills/measured-shade-match` is the same shade ranking as a Skill in the YouCam Skills format
(`SKILL.md`, a script and an `api-fallback.yaml`). It has been tested against a local server; the
Skills CLI's install command for it has not been tried.

## Honesty

MIRA is a cosmetic and appearance tool. It does not diagnose, treat or give medical advice. Every number it shows comes from a YouCam measurement or a documented formula; see [`docs/FACTS.md`](docs/FACTS.md).

## License

MIT for MIRA's code. YouCam API usage is subject to Perfect Corp's terms.
