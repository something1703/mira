// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * WCAG 2.2 AA over every text/background token pair the components use
 * (docs/DESIGN_SYSTEM.md §2, §11). Parses tokens/colors.css so the tokens stay the single source.
 */
const css = readFileSync(join(import.meta.dirname, "../tokens/colors.css"), "utf8");

type Tokens = Record<string, string>;

function block(source: string): Tokens {
  const out: Tokens = {};
  for (const m of source.matchAll(/--(mira-[a-z0-9-]+):\s*([^;]+);/g)) {
    const [, name, value] = m;
    if (name !== undefined && value !== undefined) out[name] = value.trim();
  }
  return out;
}

const lightBlock = /:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
const darkBlock = /:root\[data-theme="dark"\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
const mediaBlock =
  /@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)\s*\{([^}]*)\}/.exec(
    css,
  )?.[1] ?? "";

const light = block(lightBlock);
const dark = { ...light, ...block(darkBlock) };

type Rgba = readonly [number, number, number, number];

function parse(value: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex?.[1] !== undefined) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgb = /^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*(?:\/\s*([\d.]+))?\s*\)$/.exec(value);
  if (rgb) {
    return [
      Number(rgb[1]),
      Number(rgb[2]),
      Number(rgb[3]),
      rgb[4] === undefined ? 1 : Number(rgb[4]),
    ];
  }
  throw new Error(`Unparseable colour: ${value}`);
}

function over(fg: Rgba, bg: Rgba): Rgba {
  const a = fg[3];
  return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1];
}

function luminance([r, g, b]: Rgba): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function ratio(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

/** Resolve a token to an opaque colour, compositing translucent tokens over `under`. */
function resolve(theme: Tokens, token: string, under?: string): Rgba {
  const value = theme[token];
  if (value === undefined) throw new Error(`Missing token ${token}`);
  const colour = parse(value);
  return colour[3] < 1 && under !== undefined ? over(colour, resolve(theme, under)) : colour;
}

interface Pair {
  readonly fg: string;
  readonly bg: string;
  /** For translucent backgrounds: the opaque surface they sit on. */
  readonly bgUnder?: string;
  readonly min: number;
  readonly use: string;
}

const AA_TEXT = 4.5;
const NON_TEXT = 3;

const PAIRS: readonly Pair[] = [
  ...["surface", "raised"].flatMap((bg) =>
    ["ink", "ink-2", "ink-3"].map((fg) => ({
      fg: `mira-${fg}`,
      bg: `mira-${bg}`,
      min: AA_TEXT,
      use: "body and secondary text",
    })),
  ),
  { fg: "mira-ink", bg: "mira-sunken", min: AA_TEXT, use: "text on wells" },
  { fg: "mira-ink-2", bg: "mira-sunken", min: AA_TEXT, use: "text on wells" },
  { fg: "mira-accent", bg: "mira-surface", min: AA_TEXT, use: "quiet buttons, links" },
  { fg: "mira-accent", bg: "mira-raised", min: AA_TEXT, use: "quiet buttons, links" },
  {
    fg: "mira-accent",
    bg: "mira-accent-wash",
    bgUnder: "mira-raised",
    min: AA_TEXT,
    use: "verified label",
  },
  {
    fg: "mira-accent",
    bg: "mira-accent-wash",
    bgUnder: "mira-surface",
    min: AA_TEXT,
    use: "verified label",
  },
  { fg: "mira-on-accent", bg: "mira-accent", min: AA_TEXT, use: "primary button" },
  { fg: "mira-drift", bg: "mira-surface", min: AA_TEXT, use: "drift label text" },
  { fg: "mira-drift", bg: "mira-raised", min: AA_TEXT, use: "drift label text" },
  { fg: "mira-critical", bg: "mira-surface", min: AA_TEXT, use: "destructive confirmation" },
  { fg: "mira-critical", bg: "mira-raised", min: AA_TEXT, use: "destructive confirmation" },
  // Non-text: focus ring, Ring ticks and scale marks.
  { fg: "mira-accent", bg: "mira-surface", min: NON_TEXT, use: "focus ring" },
  { fg: "mira-accent", bg: "mira-raised", min: NON_TEXT, use: "focus ring" },
  { fg: "mira-ink", bg: "mira-surface", min: NON_TEXT, use: "Ring ticks, icons" },
  { fg: "mira-on-mat", bg: "mira-mat", min: NON_TEXT, use: "marks on the mat (never text)" },
  // The reading tick is cased in --mira-raised where it crosses the mirror, because the accent
  // alone is only ~1.7:1 against the mat. Both the casing and the tick must clear 3:1.
  {
    fg: "mira-raised",
    bg: "mira-mat",
    min: NON_TEXT,
    use: "casing of the reading tick on the mat",
  },
];

describe.each([
  ["Studio (light)", light],
  ["Darkroom (dark)", dark],
] as const)("%s contrast", (_name, theme) => {
  it.each(PAIRS)("$fg on $bg ≥ $min ($use)", (pair) => {
    const bg = resolve(theme, pair.bg, pair.bgUnder);
    const fg = resolve(theme, pair.fg, pair.bg);
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(pair.min);
  });
});

describe("theme parity", () => {
  it("the prefers-color-scheme block repeats the dark theme exactly", () => {
    expect(block(mediaBlock)).toEqual(block(darkBlock));
  });

  it("the mat is identical in both themes (the viewing surround stays constant)", () => {
    expect(dark["mira-mat"]).toBe(light["mira-mat"]);
  });

  it("the mat sits near L* 50", () => {
    const [r] = resolve(light, "mira-mat");
    const lstar = (y: number) => (y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y);
    expect(lstar(luminance([r, r, r, 1]))).toBeGreaterThan(49);
    expect(lstar(luminance([r, r, r, 1]))).toBeLessThan(51);
  });
});
