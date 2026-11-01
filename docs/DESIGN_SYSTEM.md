# Design system

MIRA's interface is a **colour-critical instrument with a fashion house's eye**. People judge their own skin and clothes on this screen, so the interface must never tint what they see. Everything else follows from that.

## 1. Principles

1. **Neutral surround.** Colour-critical work (photo grading, print proofing) is judged against a neutral grey surround so the eye is not biased. MIRA's surfaces have zero chroma. A warm cream or pink "beauty" palette would shift how people perceive their own skin tone, so it is ruled out.
2. **One accent, impossible to confuse.** The only chromatic UI colour is ultramarine. No human skin tone sits near it, and it is rare in everyday clothing, so it never competes with what is being measured.
3. **Evidence, not decoration.** Every image is shown as a *plate*: on a neutral mat, with a label strip saying what it is and how it was verified.
4. **Spend boldness in one place: the Ring.** The capture viewport and progress indicator is a mirror with a calibration scale (from the logo). Everything around it stays quiet.
5. **No silent states.** Every wait shows progress, every failure explains itself, every empty screen invites an action (`docs/UX_FLOWS.md`).
6. **Readable numbers.** Measurements use a typeface designed for low-vision legibility, with figures that cannot be misread (1/l/I, 0/O).

## 2. Colour

All colours are CSS variables in `packages/ui/tokens/colors.css`. Components never use raw hex.

### Studio (light)

| Token | Hex | Use |
| --- | --- | --- |
| `--mira-surface` | `#F2F2F2` | Page background |
| `--mira-raised` | `#FFFFFF` | Panels, sheets, inputs |
| `--mira-sunken` | `#E6E6E6` | Wells, track of progress bars |
| `--mira-ink` | `#202020` | Primary text, logo |
| `--mira-ink-2` | `#555555` | Secondary text |
| `--mira-ink-3` | `#6B6B6B` | Tertiary text (≥ 4.5:1 on surface) |
| `--mira-rule` | `#D4D4D4` | Hairlines, input borders |
| `--mira-mat` | `#777777` | Neutral mat behind every image (L* ≈ 50) |
| `--mira-accent` | `#3341D1` | Primary actions, the reading tick, verified labels, focus |
| `--mira-accent-wash` | `rgb(51 65 209 / 0.10)` | Selected rows, accent backgrounds |
| `--mira-drift` | `#8A5A00` | Drift and caution labels (text-safe amber) |
| `--mira-critical` | `#A1271B` | Destructive confirmations only |

### Darkroom (dark)

| Token | Hex |
| --- | --- |
| `--mira-surface` | `#1E1E1E` |
| `--mira-raised` | `#282828` |
| `--mira-sunken` | `#161616` |
| `--mira-ink` | `#EDEDED` |
| `--mira-ink-2` | `#B5B5B5` |
| `--mira-ink-3` | `#8F8F8F` |
| `--mira-rule` | `#3A3A3A` |
| `--mira-mat` | `#777777` (unchanged on purpose: the viewing surround stays constant across themes) |
| `--mira-accent` | `#8C95FF` |
| `--mira-accent-wash` | `rgb(140 149 255 / 0.14)` |
| `--mira-drift` | `#E0A64A` |
| `--mira-critical` | `#F2877B` |

Rules:
- Status is never colour alone: every status pairs colour with an icon and a word.
- No green "good" or red "bad" on skin results. MIRA reports measurements; it does not grade a person.
- Skin-concern overlays (from Skin Analysis masks) render in the accent at reduced opacity, never in red.
- Contrast: all text meets WCAG 2.2 AA (4.5:1, or 3:1 for text ≥ 24 px). Verify every pair with the contrast test in `packages/ui/tests/contrast.test.ts`.

## 3. Typography

| Role | Typeface | Why |
| --- | --- | --- |
| Display | **Gloock** (Google Fonts) | High-contrast serif with a fashion-house voice, used sparingly for titles and verdicts |
| Interface, body, numbers | **Atkinson Hyperlegible Next** (Google Fonts, variable) | Designed by the Braille Institute for low-vision legibility; unambiguous figures for measurements |

Load both through `next/font` with `display: swap`. Fallbacks: Gloock → `Georgia, serif`; Atkinson → `system-ui, sans-serif`.

Numbers: set `font-variant-numeric: tabular-nums lining-nums` on every reading. At setup, verify the font supports tabular figures; if it does not, use Atkinson Hyperlegible Mono inside metric tables only, and record the decision.

### Scale (ratio 1.25, base 16)

| Token | Size / line height | Face, weight | Use |
| --- | --- | --- | --- |
| `display-xl` | 61 / 64 | Gloock 400 | Landing statement, Proof verdict |
| `display-l` | 39 / 44 | Gloock 400 | Screen titles |
| `display-m` | 31 / 36 | Gloock 400 | Section titles |
| `title` | 25 / 30 | Atkinson 600 | Panel titles |
| `reading` | 31 / 32 | Atkinson 700, tabular | A measurement value |
| `body-l` | 20 / 30 | Atkinson 400 | Lead paragraphs |
| `body` | 16 / 24 | Atkinson 400 | Default text |
| `small` | 14 / 20 | Atkinson 400 | Secondary text, label strips |
| `caption` | 13 / 18 | Atkinson 400 | Units, footnotes (minimum size) |

Rules: sentence case everywhere; no all-caps labels; no eyebrow labels above headings; line length under 72 characters for body text; one weight change is enough emphasis.

## 4. Space, radius, elevation

- **Spacing** (4-pt base): 4, 8, 12, 16, 24, 32, 48, 64, 96.
- **Radius by hierarchy**, not one value everywhere:
  - 2 px: swatches (they behave like physical swatch cards)
  - 6 px: buttons, inputs, chips
  - 12 px: sheets and panels
  - full circle: the Ring, avatar crops
- **Elevation**: no drop shadows on surfaces. Separation comes from surface steps and 1 px rules. Only modal dialogs get one shadow token: `0 12px 32px rgb(0 0 0 / 0.18)`.

## 5. Layout

- Mobile first: capture happens on phones. Breakpoints: 0, 640, 1024, 1280.
- Desktop: 12-column grid, 1200 px max width, 24 px gutters, content left-aligned.
- **The plate layout.** The main unit of every result screen: an image plate on the mat (left or top), its reading and actions beside or below it.

```text
Mobile                         Desktop
┌───────────────────────┐      ┌──────────────────────────┬───────────────────┐
│  ┌─────────────────┐  │      │  ┌────────────────────┐  │ Title             │
│  │                 │  │      │  │                    │  │ Reading           │
│  │   plate (mat)   │  │      │  │    plate (mat)     │  │ Fidelity label    │
│  │                 │  │      │  │                    │  │ Why this result   │
│  └─────────────────┘  │      │  └────────────────────┘  │                   │
│  label strip          │      │  label strip             │ [Primary action]  │
│  Reading              │      │                          │ Secondary action  │
│  [Primary action]     │      └──────────────────────────┴───────────────────┘
└───────────────────────┘
```

## 6. Components

All in `packages/ui`, built on Radix primitives where an accessible primitive exists.

| Component | Purpose | Required states |
| --- | --- | --- |
| `Ring` | Capture viewport and run progress (signature element) | idle, checking (per-check ticks), ready, capturing, measuring, done, blocked (with reason) |
| `Plate` | Image on the neutral mat with a label strip | loading, ready, drift, withheld, expired |
| `LabelStrip` | What the image is, how it was verified, recorded or live | verified, drift, not checked, recorded run, visualisation |
| `Reading` | One measurement: value, unit, noise-floor band, confidence words | value, below noise floor, unavailable |
| `Swatch` | A colour chip with name and ΔE reading | default, selected, best match, out of range |
| `FidelityLabel` | Verified / drift / not checked, icon + word + detail | three variants |
| `StepRail` | Live list of a workflow's nodes | queued, running, done, cached, failed, skipped |
| `QuoteSheet` | The plan, its unit cost, confirm or cancel | quoting, ready, over cap, confirmed |
| `Verdict` | Proof outcome in one sentence + evidence | detected change, no detectable change yet, unavailable |
| `Banner` | Page-level notices | recorded run, budget low, offline |
| `EmptyState` | First-use and nothing-yet screens | with one primary action |
| `ErrorPanel` | What happened, why, what to do | with retry and an alternative |
| `Button` | Primary (accent fill), secondary (rule outline), quiet (text) | default, hover, focus, pressed, busy, disabled |
| `Toast` | Confirms a completed action using the action's own verb | success, info |

Buttons say exactly what happens ("Match my shade", not "Submit"); the matching toast uses the same verb ("Shade matched").

## 7. The Ring (signature)

Construction mirrors the logo mark: a heavy outer ring; inside it the mirror (the camera view or `--mira-mat`); between them a thin bezel carrying the calibration scale on the right half only; one accent "reading" tick that starts in the bezel and reaches into the mirror. The left half stays clean. Reference implementation: `assets/design/mira-ui-reference.html`.

- **During capture**: the circle frames the face. Four scale ticks represent the Camera Kit quality checks (lighting, distance, angle, steadiness). Each tick turns from `--mira-rule` to `--mira-ink` when its check passes. The words under the ring name the one check still failing ("Move a little closer").
- **During a run**: ticks map to workflow nodes. Done ticks turn ink; the running tick pulses once per second (no pulse under reduced motion).
- **On a reading**: the accent tick sweeps to the reading's position on the scale over 600 ms, ease-out. This is MIRA's only non-user-triggered animation.
- Accessible: `role="progressbar"` during runs with `aria-valuenow`, live region announcing each completed step.

## 8. Motion

| Token | Duration | Use |
| --- | --- | --- |
| `motion-micro` | 120 ms | Press, toggle |
| `motion-state` | 200 ms | Panel open, state change |
| `motion-reading` | 600 ms | Ring reading sweep only |

Easing: `cubic-bezier(0.2, 0, 0, 1)`. No entrance animations on scroll, no hover animations on plates. Under `prefers-reduced-motion`, all durations become 0.

## 9. Icons and imagery

- Icons: Lucide at 20 px, `strokeWidth={1.5}`, round caps and joins (matches the logo's line language).
- Imagery: only real captures, real try-on results, and real product images. No stock beauty photography, no retouching, no beauty filters.
- Demo panel people: team members with written consent, or clearly labelled AI-generated people. Every image states which.

## 10. Data visualisation

- **Shade Gap Map** (brand console): x = hue angle h°, y = lightness L*. Demand shown as density from anonymised twins; each brand shade is a point; regions with demand but no shade within the match threshold are hatched and labelled with the share of shoppers they contain.
- **Proof timeline**: the measured concern over time, a shaded band showing the noise floor around baseline, check-in points with whiskers for the three-capture spread, the claim's timeframe as a vertical rule.
- Charts use the accent for the subject series and ink tints for context; never more than two hues.

## 11. Accessibility checklist (every screen)

- Keyboard order matches visual order; focus ring 2 px accent with 2 px offset.
- Every image has alt text stating what it shows and how it was produced.
- Live regions announce run progress and results.
- Touch targets ≥ 44 × 44 px.
- Text resizes to 200% without loss.
- Camera capture always offers an upload alternative.
