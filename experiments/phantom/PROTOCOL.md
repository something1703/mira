# Phantom monotonicity

Proof can show a visualisation of a measured change only if Skin Simulation moves Skin Analysis
the way it should, over a range bigger than the person's own variation (docs/ENGINES.md §9). For
each concern, this experiment asks whether it does. **Not run.** It needs two consenting faces
and real units.

## What it decides

For each concern: whether Proof offers a visualisation at all. A concern whose phantom is not
monotone, or whose range is below the day-to-day variation, is marked numbers-only.

## Before starting

1. Two consenting people (docs/ENGINES.md §9 asks for at least two faces). Add a row to
   `packages/fixtures/CONSENT.md`.
2. An MDC for each: the pilot values from `experiments/noise-floor`, or their own baseline.
3. A go-ahead for the units below.

## Method

For each concern and each person: one photo, `skin-simulation` at intensity 0, 0.25, 0.5, 0.75
and 1 (the engines' `PHANTOM_INTENSITIES`), each result measured with Skin Analysis of that one
concern. Send the five scores to `/phantom/fit` with that person's MDC. Record Spearman's rho,
the score range, whether it is usable and the reason, and the sign (which way the raw score moves
as the simulated concern grows).

A concern is visualised only if it is usable for **both** faces. Record the disagreement if not.

## Units

Per concern per person: 5 simulations x 4 units + 5 analyses x 12 units = 80. Six concerns, two
people: **960 units.**

## Known limit

Skin Simulation can only make a concern more visible, so a change for the better is shown as the
earlier, more visible state of today's photo (D40). This experiment does not change that.
