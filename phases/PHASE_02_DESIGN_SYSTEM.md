# Phase 2 — Design system and brand

**Goal:** every component and state from the design system exists, is accessible, and can be viewed in isolation, so feature screens are assembled rather than invented.

**Depends on:** Phase 1. **Read first:** `docs/DESIGN_SYSTEM.md`, `docs/BRAND.md`, `docs/COPY.md`, `docs/UX_FLOWS.md` §0–2. Open `assets/design/mira-ui-reference.html` for the intended look and feel; components must match it in both themes.

## Deliverables

| Path | What |
| --- | --- |
| `packages/ui/tokens/` | `colors.css` (Studio + Darkroom), `type.css`, `space.css`, `motion.css`, TS exports |
| `packages/ui/src/` | Every component in Design System §6 |
| `apps/web/app/(shell)/dev/components` | Component gallery: one example per component state (D19; replaces stories) |
| `apps/web/app/(shell)` | App shell: header with lockup, theme switch, banner slot, Ask MIRA panel shell |
| `apps/web/app/page.tsx`, `consent/` | Welcome and Consent screens with all states |
| `apps/web/public/` | Favicon, app icons generated from `assets/brand` |

## Tasks

### Tokens and type
- [x] Implement every token in Design System §2–5 as CSS variables; light by default, dark under `[data-theme="dark"]` and `prefers-color-scheme`.
- [x] Load Gloock and Atkinson Hyperlegible Next with `next/font`; verify tabular figures; record the result in `docs/DECISIONS.md`.
  *Accept:* a reading of "1111.00" and "0000.11" renders with equal widths.
- [x] Contrast test over every text/background pair.
  *Accept:* test fails if any pair is below AA.

### Components (each with every state in Design System §6)
- [x] `Button`, `Banner`, `Toast`, `EmptyState`, `ErrorPanel`, `Dialog` (Radix), `Tabs` (Radix), `Field`, `Toggle`.
- [x] `Plate` + `LabelStrip`: image on `--mira-mat`, label strip variants (verified, drift, not checked, recorded run, visualisation), expired-image state.
- [x] `Reading`: value + unit + noise band + confidence words; below-floor and unavailable states.
- [x] `Swatch`: 2 px radius chip, name, ΔE reading; selected, best match, out of range.
- [x] `FidelityLabel`: icon + word + detail for each variant.
- [x] `StepRail`: queued, running, done, cached, failed, skipped; live region announcements.
- [x] `QuoteSheet`: quoting, ready, over cap, confirmed; per-step units table.
- [x] `Verdict`: detected, not yet, unavailable.
- [x] **`Ring`** (signature): SVG built from the logo geometry; modes capture (4 quality ticks), run (n node ticks), reading (accent sweep 600 ms); `role="progressbar"` in run mode; reduced-motion variant.
  *Accept:* stories show every mode; axe passes; sweep disabled under reduced motion.

### Screens
- [x] App shell with header lockup, theme switch, global banners (recorded run, offline, budget), Ask MIRA panel open/close (empty content).
- [x] Welcome (first visit, returning, profile deleted).
- [x] Consent (default, ticked, declined).

## Tests

- Component tests for every state (Vitest + Testing Library) and a gallery at `/dev/components` instead of Storybook (D19).
- Playwright: Welcome and Consent states; keyboard-only path; axe scan; light and dark screenshots.

## Definition of done

- [x] Every component in Design System §6 has every listed state as a story.
- [x] No raw hex outside `packages/ui/tokens`.
- [x] Welcome and Consent pass all their UX_FLOWS states.
- [x] A design review against Design System §1 principles, written in `docs/DECISIONS.md`.

## Demo moment

Storybook walk-through of the Ring capturing, running and taking a reading, in both themes.
