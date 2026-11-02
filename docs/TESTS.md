# Live tests on real photos

The first runs of MIRA against the real YouCam API with photos of real people. The results page in the app is `/tests`, built from `apps/web/src/tests/results.json` (written by these runs, never edited by hand).

## Set-up

- **Date:** 2026-11-02.
- **Mode:** `pnpm dev:real`. That is MIRA_MODE=mock for local state, queue and model stub, with MIRA_YOUCAM=live so every YouCam call is real (D43). Daily unit cap 700.
- **Photos:** five head-and-shoulders photos from Wikimedia Commons under CC BY-SA 4.0 or CC0, chosen for front-facing faces and a range of skin tones (D42). Credits are on the results page.
- **Path:** the same upload, quote, confirm and build steps as the app: Playwright through the web UI for profiles, and the workflows HTTP API for shade matches.
- **Balance:** 1,039 units before and 455 after. MIRA's ledger recorded 584, so the ledger matched YouCam's charge exactly.

## What happened, in order

| # | Run | Outcome | Units | Change made |
| --- | --- | --- | --- | --- |
| 1 | Profile, person 1 | Skin analysis and Fitzpatrick succeeded. Facial Color Tones and Face Attributes refused: `error_face_angle_downward` | 26 | Uploaded photos use YouCam's `medium` face-angle strictness (about 15°) instead of the default `high` (about 10°). Camera captures keep the default (`CONFIG.twin.uploadAngleStrictness`) |
| 2 | Profile, person 1 again | All steps succeeded. Skin and Fitzpatrick came from MIRA's cache at 0 units | 30 | — |
| 3 | Profiles, persons 2–5 | Person 4 fully succeeded. Persons 2, 3 and 5: skin analysis refused with `error_src_face_too_small` (the face must be wider than 60% of the image); the other steps succeeded | 4 × 40 + 56 | Face framing (D44): `mira-engines` `/face/frame` finds the face with the bundled MediaPipe BlazeFace model and crops so it fills 70% of the width. Face uploads are cropped before storage |
| 4 | Profiles, persons 2, 3, 5 again | All steps succeeded. Persons 3 and 5 were cropped below 1080 px, so they were measured in SD (12 units for skin), and the quote said so | 56 + 52 + 52 | — |
| 5 | Shade match, person 1 | Three unretouched makeup-vto renders succeeded. The re-measure of each render refused: `error_face_angle_downward` | 3 | The shade re-measure uses the same angle tolerance |
| 6 | Shade matches, persons 1, 3, 4 | Every step succeeded (3 renders, 3 re-measures, 3 checks each) | 3 × 63 | — |

## Results in brief

- **Measuring steps:** 20 of 20 YouCam steps succeeded across five people after the changes. Shade matches: 18 of 18 YouCam steps.
- **Time:** a full profile took 36–50 s; a shade match of three previews took 40–60 s.
- **Shade blend on the real preview (ΔE2000, lower is closer):**
  - Person 1: best 0.31.
  - Person 3: best 0.32.
  - Person 4: best 2.06, labelled "close". The sample range lacks deeper shades.
- **Re-ranking:** for person 4 the catalogue-nearest shade (W 210, ΔE 0.76) blended worst on the real preview (ΔE 3.07). This is the case for re-measuring.
- **Limits:**
  - This is one photo per person on one day, so it is not a calibration (F8 and F9 are still to measure).
  - Hair colour is one of 7 fixed values in YouCam's response (F10).
  - The shade range has invented colours.

## Reproduce

```bash
pnpm dev:real          # needs YOUCAM_API_KEY in .env.local; spends real units after each quote
```

Then upload a photo at `/capture`, or open `/runs/recorded` for the drawn sample.
