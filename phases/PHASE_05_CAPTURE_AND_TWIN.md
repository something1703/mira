# Phase 5 — Capture and the Measured Twin

**Goal:** a person can be measured once, guided by the Ring, and see their measured profile; images are deleted afterwards.

**Depends on:** Phases 2, 3, 4. **Read first:** `docs/UX_FLOWS.md` §3, 4, 11; `docs/YOUCAM_API.md` §3–4; `docs/ENGINES.md` §8.

## Deliverables

| Path | What |
| --- | --- |
| `apps/web/app/capture/` | Capture flow: face, noise-floor repeats, body, hand, hair |
| `apps/web/src/camera-kit/` | Camera Kit loader and event bridge to the Ring |
| `apps/workflows/src/graphs/build-twin.ts` | Build Twin graph |
| `apps/web/app/profile/` | Measured profile screen |
| `apps/web/app/settings/privacy/` | View and delete everything |

## Tasks

### Capture
- [ ] Load the Camera Kit script after defining `YMKAsyncInit`; mount `#YMK-module` inside the Ring; map `faceQualityChanged` to the four Ring ticks and one instruction line.
- [ ] Modes: `comprehensive` for the main face capture; `hdskincare` with `videoQuality` 1080p or higher for HD; fall back to SD with the "Low camera resolution" state when HD is impossible.
- [ ] Two repeat face captures a few seconds apart, for the same-session noise estimate.
- [ ] Full-body capture with guidance to wear a plain, light top (avoids the try-on failure ShadeSpan documented).
- [ ] Optional hand and hair captures; skip buttons.
- [ ] Upload alternative on every step, with the same quality checks run server-side.
- [ ] Every state in UX_FLOWS §3, including permission denied, unsupported browser, each failing check, YouCam quality errors with "No units were used."

### Build Twin workflow
- [ ] Graph: skin-analysis (HD concerns needed by later phases, chosen to stay in one unit tier), skin-tone-analysis, face attributes, fitzpatrick, hair detectors in parallel; noise-floor engine; write twin; cleanup.
- [ ] Face-crop helper so the face fills more than 60% of the width before skin analysis.
- [ ] Metrics written with IDs, units, sources and confidence.
- [ ] Partial results: failed groups marked "Not measured" with the mapped reason and a retry.

### Profile and privacy
- [ ] Profile screen: Skin, Colouring (swatches on the mat), Face, Hair; every state in UX_FLOWS §4.
- [ ] Privacy screen: every stored number, deletion history, Download my data, Delete my profile (confirm dialog), every state in UX_FLOWS §11.
- [ ] Delete removes Firestore twin, saved looks, proofs and saved images.

## Tests

- Playwright for every capture, profile and privacy state (camera mocked with a fake media stream in mock mode).
- Workflow test for Build Twin happy path and partial failure on fixtures.
- Test that no image object remains in Cloud Storage after a run (emulator).

## Definition of done

- [ ] A real phone completes capture → profile in live mode; record time and pass rate over 10 attempts in `docs/FACTS.md`.
- [ ] All UX_FLOWS §3, §4, §11 states implemented and tested.
- [ ] Images verifiably deleted after the run.

## Demo moment

On a phone: the Ring guiding a capture with the screen telling you exactly what to fix, then the measured profile appearing reading by reading.
