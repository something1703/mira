# Phase 6 — Shade matching

**Goal:** the first full Measure → Decide → Render → Verify loop: find the foundation shade that measurably disappears on the person's skin.

**Depends on:** Phase 5. **Read first:** `docs/UX_FLOWS.md` §5, `docs/ENGINES.md` §4, `docs/YOUCAM_API.md` (makeup-vto).

## Deliverables

| Path | What |
| --- | --- |
| `apps/workflows/src/graphs/match-shade.ts` | Match Shade graph |
| `apps/agent/src/extract/shade-range.ts` | Small-model extraction of shade names and hexes from a product page |
| `apps/web/app/shade/` | Shade screens |
| `packages/fixtures/catalogues/` | Two or three real shade ranges for mock mode. **Today: two invented sample ranges, labelled as samples.** A real range needs someone to read one from a page they may use, with its address and date (`catalogues/README.md`) |
| `experiments/shade-closed-loop/` | The F1 and F8 experiments with results |

## Tasks

### Experiments first
- [ ] **F1 (unretouched default):** render the same face with no `skin_smooth` effect and with `skin_smooth: 0`; measure texture and pore raw scores on both; record the difference and save the images (with consent) for the demo's opening shot.
- [ ] **F8 (closed loop):** for 10 shades on 2 consented faces, render with `makeup-vto`, re-measure with `skin-tone-analysis`, compare render Lab with the intended direction. Record the agreement rate and set `MATCH_DE` / `CLOSE_DE` calibration status.
  *Accept:* results table in `experiments/shade-closed-loop/RESULTS.md` and rows in `docs/FACTS.md`.

### Feature
- [x] Range input: paste a product link or pick a recorded catalogue; extraction returns shade name, hex and finish with a schema; unreadable pages give the UX_FLOWS "Range not readable" state. _(a deterministic swatch reader behind a `ShadeReader` port; the small-model reader comes with the agent in Phase 7, D37)_
- [x] Pre-rank all shades at zero units; show "Checked N shades for free".
- [x] QuoteSheet for the top N renders (default 3, max 5).
- [x] Parallel `makeup-vto` foundation renders with `skin_smooth: 0`, finish and coverage from the engine rules; re-measure; blend ΔE and direction check.
- [x] Results: best-match plate with verified label, runner-ups, "why this finish and coverage", no-match and drift states.
- [x] Concealer as an optional second pass using the dark-circle and eye-bag readings. _(dark-circle reading only: eye-bag readings are not in the profile)_

## Tests

- Workflow test on fixtures: happy path, one render fails, one render drifts, no shade within range.
- Playwright for every UX_FLOWS §5 state.

## Definition of done

- [ ] F1 and F8 recorded with honest results, whichever way they landed.
- [ ] Live run on a real person with a real brand range works end to end.
- [x] Every state implemented and tested. _(UX_FLOWS §5: choose, reading, not readable, pre-ranked, quote, rendering, results, no match, drift, partial)_

## Demo moment

"Checked every shade in the range for free, rendered only the closest, measured each preview": the best match appears with its verified label beside the runners-up.
