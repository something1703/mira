# Drape garments

Event Mode is built for sarees and lehengas, and `cloth-v4` was not made for draped garments.
Phase 8 asks what works. **Not run.** It needs consenting people, product pictures and real units.

## What it decides

If a draped garment fails, Event Mode offers the garments that do work (kurta, lehenga-choli,
gown) and says so on the garment picker. If it works, the picker says which category to use.

## Before starting

1. Two consenting people (the same two as `chain-quality` is the cheapest).
2. Four product pictures: a saree, a lehenga, a kurta set, a gown.
3. A go-ahead for the units below.

## Method

For each garment and each person, request `cloth-v4` with each plausible `garment_category`:
`full_body`, `auto`, and `upper_body` plus `lower_body` for the two-piece ones. For each result:

1. Run the garment audit against the garment's colour (free).
2. Look at the picture: is the garment worn, whole, and its drape plausible? Is the original
   clothing still showing (the failure ShadeSpan documented, docs/YOUCAM_API.md §7)?
3. For the best category of each garment, run Face Attributes and compare with the profile.

Record, per garment: the category that worked best, the share of runs that failed with
`invalid_garment_category` or `error_editing_failed`, and the audit label.

## Units

Twelve requests per person at 2 units = 24, times two people = 48. Face Attributes on the best
result per garment per person: 4 x 2 x 10 = 80. **128 units.**
