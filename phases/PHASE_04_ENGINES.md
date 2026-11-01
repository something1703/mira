# Phase 4 — Measurement engines

**Goal:** every formula in `docs/ENGINES.md` implemented, tested against published references, and served by `mira-engines`.

**Depends on:** Phase 1. Can run in parallel with Phases 2–3. **Read first:** `docs/ENGINES.md`, `AGENTS.md` §7.

## Deliverables

| Path | What |
| --- | --- |
| `services/engines/mira_engines/colour.py` | sRGB ↔ Lab, LCh, ITA, vectorised ΔE2000 |
| `.../shade.py` | Pre-rank, closed-loop check, finish and coverage rules |
| `.../look.py` | Lip and blush suggestions with reasons |
| `.../garment.py` | Garment colour from RGBA image |
| `.../audit.py` | Garment audit, lip audit, identity drift |
| `.../stats.py` | Noise floor, MDC, change words |
| `.../phantom.py` | Spearman, usability, isotonic fit, inversion |
| `.../config.py` | Every threshold with source and `calibrated` flag |
| `.../api.py` | FastAPI endpoints from ENGINES §10 |
| `services/engines/tests/data/sharma_2005.csv` | The 34 reference pairs |

## Tasks

- [x] Colour conversions with `colour-science`; tests against published values.
- [x] CIEDE2000 scalar and vectorised; all 34 Sharma pairs to 4 decimals; Hypothesis properties (identity, symmetry, non-negativity).
- [x] ITA with band names; tests at each band edge.
- [x] Shade pre-rank with tie-breaks and labels; closed-loop blend and direction check.
- [x] Finish and coverage rules from measured skin type and concern raw scores.
- [x] Look suggestions with the rule that fired, as structured reason codes (copy is rendered in the UI from codes).
- [x] Garment colour: alpha filter, Lab k-means (k = 3, fixed seed), multicolour flag.
- [x] Garment audit: MediaPipe face box, torso region, changed mask, changed-share guard, ΔE verdict with direction.
  *Accept:* synthetic tests: (a) render with recoloured torso → verified; (b) unchanged torso → "not checked"; (c) wrong colour → drift with correct direction.
  *Note:* the audit takes a face box. `faces.py` detects one with MediaPipe when `MIRA_FACE_MODEL_PATH` points at a BlazeFace `.tflite` model (not bundled; untested until one is supplied), otherwise the caller passes it.
- [x] Identity drift on ratio vectors.
- [x] Noise floor (s_w, s_d with prior until n ≥ 3, SE, MDC) and change words.
  *Accept:* on simulated data with known variances, MDC within 10% of the analytic value over 1,000 seeds.
- [x] Phantom: Spearman, usability rule, isotonic fit, inversion; tests on monotone, flat and noisy curves.
- [x] FastAPI endpoints; each response includes `engine_version` and config used.
- [ ] Python models generated from `packages/schemas` JSON Schema; contract test against TS types.

## Definition of done

- [x] `pytest` green, `mypy --strict` clean, ruff clean.
- [x] Every threshold in `config.py` has a source comment and `calibrated` flag.
- [ ] Deployed to Cloud Run; workflows can call it with service-account auth.

## Demo moment

A notebook-style page in the run viewer: paste two hex colours, see ΔE2000, ITA, and the shade label, with the Sharma test suite badge.
