# Phase 9 — Proof

**Goal:** tell a person whether a skincare product is visibly working, only when the change is bigger than their own day-to-day variation, and show it honestly.

**Depends on:** Phases 5, 7. **Read first:** `docs/UX_FLOWS.md` §8, `docs/ENGINES.md` §8–9, `docs/COPY.md` §2–3.

## Deliverables

| Path | What |
| --- | --- |
| `apps/workflows/src/graphs/proof-setup.ts`, `proof-check-in.ts` | Proof graphs |
| `apps/agent/src/extract/claim.ts` | Claim extraction (concern, direction, magnitude, window) |
| `apps/web/app/proof/` | Proof screens and timeline chart |
| `experiments/noise-floor/`, `experiments/phantom/` | Pilot data and phantom results |

## Tasks

### Experiments first
- [ ] _(protocol written, not run: `experiments/noise-floor/`, 432 units)_ **Noise floor pilot:** consenting team members capture 3 times per session on at least 3 different days. Compute s_w and s_d per concern; set `PRIOR_SD_DAY` from the pooled result; record per Fitzpatrick band where you have data, and say where you do not.
- [ ] _(protocol written, not run: `experiments/phantom/`, 960 units)_ **Phantom monotonicity:** for each concern MIRA tracks, run the 5-intensity phantom on at least 2 faces; record ρ and range; mark concerns where visualisation is disabled.

### Workflow
- [x] Claim extraction with schema; "no claim found" path lets the person choose concern and window; claims mapped only to concerns Skin Analysis measures. _(the words must be on the page; a window must be one the page's own sentence gives, F56)_
- [x] Baseline: 3 sessions on different days, 3 captures each; noise floor computed and stored.
- [x] Phantom per concern, cached per person.
- [x] Check-in graph: 3 captures → 3 analyses → session mean → change words → verdict → optional visualisation render. _(the visualisation is a separate quoted run on a fresh photo, D40 (3))_
- [x] Reminders: Cloud Scheduler creates in-app reminders; offer a calendar file (.ics) the person downloads themselves. MIRA sends no messages on the person's behalf. _(derived due dates and the .ics; no scheduler is needed until deploy, D40 (4))_
- [x] Confound guard: ask at each check-in whether anything else in the routine changed; if yes, show the confound warning.
- [x] Measured review: at window end, the person may publish an anonymised outcome to `efficacy_outcomes`.

### UI
- [x] Every state in UX_FLOWS §8.
- [x] Timeline chart: series, noise band, check-in whiskers, claim window rule (Design System §10). _(with a table for screen readers)_
- [x] Visualisations always labelled as visualisations, never as predictions.

## Tests

- Engine-level tests already cover the maths; add workflow tests on fixtures for setup, check-in, below-floor, above-floor, opposite direction, phantom unusable.
- Playwright for every Proof state.
- Claim linter over every Proof string.

## Definition of done

- [ ] Pilot and phantom results recorded with sample sizes and limits stated. _(protocols only, F58)_
- [ ] One full proof cycle demonstrated with real data (an acute effect, such as oil-blotting for oiliness, is acceptable for the demo if it registers; if it does not, show the honest "within your day-to-day variation" verdict instead). _(a full mock cycle runs, F57; a real one needs the deploy, a person and days)_
- [x] Every state implemented and tested.

## Demo moment

The verdict sentence in Gloock, with the timeline showing exactly where the noise band ends and the change begins.
