# Phase 10 — Brand console, platform surfaces and launch

**Goal:** the brand-side value, MIRA as a platform other agents can use, a hardened deploy, and a submission that proves every claim.

**Depends on:** Phases 6, 8, 9. **Read first:** `docs/UX_FLOWS.md` §10, 12; `docs/DATA_MODEL.md` §3; `docs/DEMO_AND_SUBMISSION.md`.

## Deliverables

| Path | What |
| --- | --- |
| `apps/workflows/src/graphs/catalogue-ingest.ts` | Full catalogue ingest (CLI or bulk upload) |
| `infra/bigquery/` | Tables and cohort-limited views |
| `apps/web/app/brand/` | Brand console |
| `packages/mira-mcp/` | MIRA MCP server |
| `skills/measured-shade-match/` | Published YouCam-format Skill |
| `docs/` updates | FACTS complete, DECISIONS complete |

## Tasks

### Brand console
- [ ] Catalogue ingest: CSV upload or product links; YouCam CLI for batch background removal; small model via Vertex batch for shade extraction where available.
- [ ] Pipelines writing anonymised rows to `shade_demand`, `efficacy_outcomes`, `look_events`; views enforcing `MIRA_K_ANON_MIN`.
- [ ] Shade Gap Map chart (Design System §10); efficacy table; attach table; every state in UX_FLOWS §10.
- [ ] Seed the console with recorded, clearly labelled data for the demo.

### Platform
- [ ] MIRA MCP server exposing `shade_match`, `measure_change`, `audit_render`, `explain_metric`, with token auth and per-token unit caps.
- [ ] Skill `measured-shade-match` in the YouCam Skills format: SKILL.md, scripts, fallback schema; installable with the Skills CLI; README section.

### Hardening
- [ ] Security review against `docs/SECURITY_PRIVACY.md`; fix findings.
- [ ] Performance: first paint under 2 s on a mid-range phone over 4G; Ring at 60 fps during capture.
- [ ] Full sweep: every state in `docs/UX_FLOWS.md` passes Playwright in light and dark themes; axe clean.
- [ ] Re-record fixtures from the final live runs so mock mode reflects the shipped product.
- [ ] `docs/FACTS.md`: every public claim has a row with status Measured, Built or Source read; withdraw anything else.

### Launch
- [ ] Deploy production with demo unit caps; verify the budget fallback to recorded runs.
- [ ] Record the video per `docs/DEMO_AND_SUBMISSION.md` §3 on a real phone and desktop; licence-free music; captions.
- [ ] Export screenshots (§4); write the Devpost description (§5) and run it through the claim linter.
- [ ] Make the repo public with a licence, or share it with contact_event@PerfectCorp.com.
- [ ] Submit; flag Rising Star and Women in Tech eligibility where applicable.

## Definition of done

- [ ] Every checkbox in `docs/DEMO_AND_SUBMISSION.md` §1 ticked.
- [ ] A fresh clone runs in mock mode in under a minute; the live URL works on a phone.
- [ ] No claim in the submission without a FACTS row.

## Demo moment

The full 2:50 video, ending on the run viewer and the lockup.
