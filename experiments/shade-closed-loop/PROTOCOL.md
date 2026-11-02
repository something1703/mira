# Shade experiments: F1 and F8

Two experiments Phase 6 asks for. **Neither has been run.** Both need a real, consenting person and
spend real YouCam units, so they wait for a go-ahead (AGENTS.md: quote and confirm). This file is
the protocol, so the run is the same whoever does it. Results go in `RESULTS.md`; until then
`RESULTS.md` says "not run" and no number from here appears in the product.

## What each one decides

| Experiment | Question | What it changes |
| --- | --- | --- |
| F1 | Does leaving out `skin_smooth` still smooth (docs/FACTS.md F1)? | Whether the README's "unretouched by default" claim stands as written |
| F8 | Does a render's re-measured colour move the way the shade says it should, and how often? | `MATCH_DE` and `CLOSE_DE` (2.0 and 3.5, `calibrated: false`), and whether the closed-loop check is worth 21 units a shade |

## Before starting

1. A person who has agreed, in writing, to their photo going to YouCam and to the renders being
   kept for the demo. Add a row to `packages/fixtures/CONSENT.md` first.
2. A measured profile for them (capture, then Build Twin), so `colour.skin` exists.
3. Two faces for F8 (the spec asks for two), one for F1.
4. A go-ahead for the units below. The balance read on 2026-11-01 was 1,039.

## F1: the unretouched default

Render the same face twice with `makeup-vto`:

- **A:** a request with **no** `skin_smooth` effect at all (the API's own default).
- **B:** MIRA's request, with `skin_smooth` at strength 0 (what the code always sends).

Measure both and the original with Skin Analysis (HD, concerns `hd_texture` and `hd_pore`), and record
`raw_score` for each. If A's scores are higher than the original's and B's are not, the default
smooths and MIRA's request removes it. If neither moves, the claim is not supported either way.

Units: 2 renders (1 each) and 3 analyses at the 1 to 4 concern tier (12 each) = **38**.

Save the three images (with consent) for the demo's opening shot.

## F8: the closed loop

For each of the two faces, take 10 shades from one range spread across the person's skin tone (the
closest, then steps lighter, darker, warmer and cooler), render each with the engine's finish and
coverage, and re-measure each render with `skin-tone-analysis`.

Record for every render: the shade's Lab, the person's skin Lab, the re-measured Lab, the blend ΔE00,
and whether `direction_ok` held. Then:

- **Agreement rate:** the share of renders where the direction check held.
- **Rank agreement:** does ranking by blend ΔE put the shade the person would pick first? Ask the
  person, blind to the numbers, to pick their best match from the 10 previews.
- **Thresholds:** the blend ΔE of the shades the person called a match, and of the ones they did
  not. Set `MATCH_DE` and `CLOSE_DE` at the values that separate them, and flip `calibrated` to
  `True` only if the sample supports it (20 renders is a start, not a standard).

Units: 20 renders (1 each) and 20 re-measures (20 each) = **420**.

## Running it

The graph is the experiment: `buildMatchShadeGraph` with `shadeIds` set to the 10 chosen shades. The
live adapters it needs are not built yet (HANDOFF: the live adapters are the deploy blocker), so
until they are the run goes through `pnpm smoke:live` style tooling on in-memory ports, as
`pnpm fixtures:record` does.

## Recording the result

`RESULTS.md` gets a table per experiment, the raw numbers, the date, the consent row, and a sentence
saying plainly whether the hypothesis held. Then add rows to `docs/FACTS.md` and change the
`calibrated` flags in `services/engines/mira_engines/config.py` and `packages/schemas/src/config.ts`
together.
