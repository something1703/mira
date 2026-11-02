/**
 * Design tokens for TypeScript (docs/DESIGN_SYSTEM.md §2–5, 8). The CSS files beside this one are
 * what components use; this module exists for places CSS cannot reach: the web manifest, generated
 * icons, canvas drawing and tests. `tests/tokens.test.ts` fails if a value here differs from the
 * CSS, so the two cannot drift.
 */
export const color = {
  light: {
    surface: "#f2f2f2",
    raised: "#ffffff",
    sunken: "#e6e6e6",
    ink: "#202020",
    "ink-2": "#555555",
    "ink-3": "#6b6b6b",
    rule: "#d4d4d4",
    mat: "#777777",
    accent: "#3341d1",
    "on-accent": "#ffffff",
    "on-mat": "#ffffff",
    drift: "#8a5a00",
    critical: "#a1271b",
  },
  dark: {
    surface: "#1e1e1e",
    raised: "#282828",
    sunken: "#161616",
    ink: "#ededed",
    "ink-2": "#b5b5b5",
    "ink-3": "#8f8f8f",
    rule: "#3a3a3a",
    accent: "#8c95ff",
    "on-accent": "#14163a",
    drift: "#e0a64a",
    critical: "#f2877b",
  },
} as const;

export type ColorToken = keyof typeof color.light;

/** `var(--mira-…)` for a colour token, for inline styles that must follow the theme. */
export const cssColor = (token: ColorToken): string => `var(--mira-${token})`;

/** 4-point spacing scale, px (DESIGN_SYSTEM §4). Index 1 is 4 px. */
export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32, 7: 48, 8: 64, 9: 96 } as const;

export const radius = { swatch: 2, control: 6, panel: 12 } as const;

/** Durations in ms; all become 0 under prefers-reduced-motion (DESIGN_SYSTEM §8). */
export const motion = { micro: 120, state: 200, reading: 600 } as const;

/** Type scale: [size px, line height px] (DESIGN_SYSTEM §3). */
export const type = {
  "display-xl": [61, 64],
  "display-l": [39, 44],
  "display-m": [31, 36],
  title: [25, 30],
  reading: [31, 32],
  "body-l": [20, 30],
  body: [16, 24],
  small: [14, 20],
  caption: [13, 18],
} as const;
