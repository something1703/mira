# Brand

## Name

**MIRA** — "look" in Spanish, and close to Meera, a familiar name across India. Written as MIRA in running text; the wordmark is lowercase.

Line: **Look, measured.**

Positioning: MIRA is the honest mirror. It never flatters and never grades a person; it measures, matches and shows its evidence.

## Logo

Files in `assets/brand/`:

| File | Use |
| --- | --- |
| `mira-lockup.svg` / `-dark.svg` | Default: app header, README, video title card |
| `mira-mark.svg` / `-dark.svg` | App icon, avatar, loading states, small spaces |
| `mira-mark-mono.svg` | One-colour uses; inherits `currentColor` |
| `mira-wordmark.svg` / `-dark.svg` | Where the mark already appears nearby |
| `favicon.svg` | Browser tab; simplified for 16–32 px; adapts to dark mode |
| `brand-sheet.png` | Quick visual reference |

### Construction

- **The mark** is a mirror: a circle (stroke 6 on a 96 grid, radius 28) carrying a calibration scale on its right half, seven ticks from 30° to 150° in 20° steps. One tick, at 70°, is longer and in the accent: **the reading**.
- **The wordmark** is monoline lowercase "mira": stroke 9, round caps and joins, single-storey "a". The dot of the "i" is the accent, the same reading as in the mark.
- The mark sits to the left of the wordmark, vertically centred on the x-height, with a gap equal to the mark's ring diameter × 0.4.

### Rules

- Clear space on every side: the height of the wordmark's x-height.
- Minimum size: lockup 96 px wide; mark 24 px (below 24 px use `favicon.svg`).
- Colours: ink + accent only, from the design tokens. On images, use the mono mark in white on the mat, never directly on skin.
- Do not: recolour the reading in any skin-like hue, add gradients or shadows, rotate the mark, place it on a photo of a face, or add ticks to the left half (the left half is the clean mirror).

## Voice

| MIRA is | MIRA is not |
| --- | --- |
| Precise: names the measurement and its confidence | Vague: "looks great!" |
| Plain: short sentences, everyday words | Clinical or salesy |
| Respectful: describes, never judges a body | Flattering or corrective ("fix", "flaws") |
| Honest: says when it cannot tell | Falsely certain |

Detailed patterns and the banned list: `docs/COPY.md`.

## App icon

The mark on `--mira-surface` (light) or `--mira-surface` dark, centred at 62% of the icon's width. For iOS and Android masks, keep the ring fully inside the safe zone.

## Social and video

- Title card: lockup centred on `--mira-surface`, line "Look, measured." in Gloock underneath.
- Video music: licence-free only (the Devpost rules forbid copyrighted music without permission).
