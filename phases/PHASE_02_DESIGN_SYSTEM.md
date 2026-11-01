# Phase 2 — Design system and brand

**Goal:** every component and state from the design system exists, is accessible, and can be viewed in isolation, so feature screens are assembled rather than invented.

**Depends on:** Phase 1. **Read first:** `docs/DESIGN_SYSTEM.md`, `docs/BRAND.md`, `docs/COPY.md`, `docs/UX_FLOWS.md` §0–2. Open `assets/design/mira-ui-reference.html` for the intended look and feel; components must match it in both themes.

## Deliverables

| Path | What |
| --- | --- |
| `packages/ui/tokens/` | `colors.css` (Studio + Darkroom), `type.css`, `space.css`, `motion.css`, TS exports |
| `packages/ui/src/` | Every component in Design System §6 |
| `packages/ui/stories/` | Storybook (or Ladle) stories: one story per component state |
| `apps/web/app/(shell)` | App shell: header with lockup, theme switch, banner slot, Ask MIRA panel shell |
| `apps/web/app/page.tsx`, `consent/` | Welcome and Consent screens with all states |
| `apps/web/public/` | Favicon, app icons generated from `assets/brand` |

## Tasks

### Tokens and type
- [ ] Implement every token in Design System §2–5 as CSS variables; light by default, dark under `[data-theme="dark"]` and `prefers-color-scheme`.
- [ ] Load Gloock and Atkinson Hyperlegible Next with `next/font`; verify tabular figures; record the result in `docs/DECISIONS.md`.
  *Accept:* a reading of "1111.00" and "0000.11" renders with equal widths.
- [ ] Contrast test over every text/background pair.
  *Accept:* test fails if any pair is below AA.

### Components (each with every state in Design System §6)
- [ ] `Button`, `Banner`, `Toast`, `EmptyState`, `ErrorPanel`, `Dialog` (Radix), `Tabs` (Radix), `Field`, `Toggle`.
- [ ] `Plate` + `LabelStrip`: image on `--mira-mat`, label strip variants (verified, drift, not checked, recorded run, visualisation), expired-image state.
- [ ] `Reading`: value + unit + noise band + confidence words; below-floor and unavailable states.
- [ ] `Swatch`: 2 px radius chip, name, ΔE reading; selected, best match, out of range.
- [ ] `FidelityLabel`: icon + word + detail for each variant.
- [ ] `StepRail`: queued, running, done, cached, failed, skipped; live region announcements.
- [ ] `QuoteSheet`: quoting, ready, over cap, confirmed; per-step units table.
- [ ] `Verdict`: detected, not yet, unavailable.
- [ ] **`Ring`** (signature): SVG built from the logo geometry; modes capture (4 quality ticks), run (n node ticks), reading (accent sweep 600 ms); `role="progressbar"` in run mode; reduced-motion variant.
  *Accept:* stories show every mode; axe passes; sweep disabled under reduced motion.

### Screens
- [ ] App shell with header lockup, theme switch, global banners (recorded run, offline, budget), Ask MIRA panel open/close (empty content).
- [ ] Welcome (first visit, returning, profile deleted).
- [ ] Consent (default, ticked, declined).

## Tests

- Storybook interaction tests for every component state.
- Playwright: Welcome and Consent states; keyboard-only path; axe scan; light and dark screenshots.

## Definition of done

- [ ] Every component in Design System §6 has every listed state as a story.
- [ ] No raw hex outside `packages/ui/tokens`.
- [ ] Welcome and Consent pass all their UX_FLOWS states.
- [ ] A design review against Design System §1 principles, written in `docs/DECISIONS.md`.

## Demo moment

Storybook walk-through of the Ring capturing, running and taking a reading, in both themes.
