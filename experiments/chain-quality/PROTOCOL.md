# Chain quality

Phase 8 asks how many generative steps can be chained before a face or a garment stops being
trustworthy. **Not run.** It needs two consenting people and real YouCam units, so it waits for a
go-ahead (AGENTS.md: quote and confirm). Results go in `RESULTS.md`; until then every number the
product shows for a chain (the thresholds, the default length) is labelled uncalibrated.

## What it decides

| Question | What it changes |
| --- | --- |
| After how many steps does identity drift (docs/ENGINES.md §7.3) pass the limit? | `CONFIG.look.defaultChainLength` (7 today, the whole chain), and whether Look Studio warns on a long chain |
| How far does the garment colour move as steps are added after the clothes? | `GARMENT_VERIFY_DE` (6.0, `calibrated: false`) |
| How much do face ratios move between two analyses of one unedited photo? | `IDENTITY_DRIFT_MAX` (0.08, `calibrated: false`): the limit must sit above this noise |

## Before starting

1. Two people who have agreed in writing to their photos going to YouCam. Add a row to
   `packages/fixtures/CONSENT.md` first.
2. A measured profile for each (capture, then Build Twin).
3. A full-length photo of each in a plain light top, and one outfit, one pair of shoes and one bag
   (product pictures, background removed).
4. A go-ahead for the units below.

## Method, per person

1. **Noise.** Analyse the unedited photo with Face Attributes three times. Record the largest
   relative change in any ratio (`max |r - r'| / r`). This is the floor the drift limit must clear.
2. **Chain.** Make the steps in the order the graph uses, each on the previous result: clothes,
   shoes, bag, makeup (lip and blush from `/look/suggest`), hair colour.
3. **After every step**, run Face Attributes on the result and the garment audit
   (`/audit/garment`, free) against the garment's colour; after makeup, also Skin Tone Analysis and
   the lip audit. Record drift, garment ΔE and lip ΔE by step number.
4. Look at every picture. Note anything the numbers do not catch.

## Units

Per person: steps 8 (2 + 2 + 2 + 1 + 1), five Face Attributes runs after each step 50, three noise
runs 30, one lip tone read 20 = **108**. Two people = **216**.

## How to read it

The default length is the longest chain in which, for both people, identity drift stays under the
noise-floor-plus-margin and the garment ΔE stays under its limit. If the whole chain passes, keep
seven. If it fails earlier, Look Studio defaults to that many steps and says why.
