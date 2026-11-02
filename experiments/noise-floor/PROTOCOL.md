# Noise-floor pilot

Proof tells a person whether a change is bigger than their own day-to-day variation. Until three
sessions exist the engines have no between-day spread, and `PRIOR_SD_DAY` is empty on purpose
(services/engines/mira_engines/config.py): MIRA reports "not enough sessions yet" rather than
invent a prior. This pilot is what fills it. **Not run.** It needs consenting people over several
days and real YouCam units.

## What it decides

| Question | What it changes |
| --- | --- |
| How large is the within-session spread `s_w` and the between-day spread `s_d` for each concern Proof tracks (pore, wrinkle, texture, acne, oiliness, redness)? | `PRIOR_SD_DAY[concern]`, so a person gets a minimal detectable change after one session instead of three |
| Do they differ by Fitzpatrick band? | Whether confidence words are lowered for a band, and the sentence that says why (docs/ENGINES.md §8) |

## Before starting

1. At least three team members who have agreed in writing. Add a row to
   `packages/fixtures/CONSENT.md` first.
2. A measured profile for each, so the Fitzpatrick band is recorded.
3. A go-ahead for the units below.

## Method

Each person takes **three captures per session on at least three different days** (not the same
day), in the same lighting, with no new product in their routine. Every capture is one Skin
Analysis of all six concerns (HD, 1 to 8 concern tier: 16 units).

For each concern: pool the sessions with `/stats/noise-floor` (no prior), record `s_w`, `s_d`, `se`
and `mdc` per person, then pool across people. Set `PRIOR_SD_DAY` from the pooled `s_d`, and record
the sample size and the spread across people beside it. Where fewer than three people sit in a
Fitzpatrick band, say so and set no band-specific value.

## Units

Per person: 3 days x 3 captures x 16 units = **144**. Three people = **432**.

## What must not be claimed

A prior from three people is a starting point, not a norm. The product says "learned from your own
sessions" and never states a population figure.
