# Performance

What was measured, how, and what it does not show. Date: 2026-11-02.

## Method

`apps/web/scripts/perf.ts` loads each page in headless Chromium against a **production build in mock mode**, five times each, with:

- a 390 × 844 mobile viewport, touch on, 3x pixel ratio;
- the CPU slowed 4x;
- Lighthouse's "Slow 4G" network: 1.6 Mbit/s down, 0.75 Mbit/s up, 150 ms round trip.

This is a stand-in for a mid-range phone on 4G. It is **not** a phone: a real device has a different CPU, GPU, memory pressure and radio. The server was on the same machine, so server time is close to zero.

## Results

| Page            | First contentful paint (median of 5) | Largest contentful paint | Transferred |
| --------------- | ------------------------------------ | ------------------------ | ----------- |
| `/`             | 668 ms                               | 668 ms                   | 316 KiB     |
| `/consent`      | 660 ms                               | 660 ms                   | 319 KiB     |
| `/dev/components` | 732 ms                             | 2,508 ms                 | 324 KiB     |

`/dev/components` is the development gallery, listed only to show a page with many images and components.

Frame cadence on the gallery (which shows the Ring), CPU slowed 4x: 241 frames in 4 s, mean gap 16.6 ms, no frame over 20 ms.

## What this supports, and what it does not

- Supports: in this setup the two pages a new person sees first paint in well under 2 s.
- Does **not** show first paint on a real phone, on a deployed service (Cloud Run cold start, real network path), or for the capture screen, which needs a camera.
- Does **not** show the Ring at 60 fps during capture. The Ring is drawn with CSS animation and the numbers above measure the page around it with no camera video running. Camera Kit's live video on a real phone is untested (F33). The Phase 10 item "Ring at 60 fps during capture" stays open.

## Reproduce

```bash
pnpm --filter @mira/web build
MIRA_MODE=mock NEXT_PUBLIC_MIRA_MODE=mock MIRA_SESSION_SECRET=any-32-or-more-characters-here pnpm --filter @mira/web start
pnpm --filter @mira/web exec tsx scripts/perf.ts http://localhost:3000
```
