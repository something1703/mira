import type { LookEventRow, ShadeDemandRow } from "@mira/schemas";

/**
 * Recorded demo data for the brand console, clearly labelled as such in every screen that shows
 * it (docs/UX_FLOWS.md §10, "Recorded data"). The people are invented: skin colours are drawn from
 * a fixed generator so the same console shows the same chart every time. They are not shoppers.
 */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const normal = (r: () => number) => {
  const u = Math.max(r(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
};

const BANDS = ["II", "III", "IV", "V", "VI"] as const;
const WEEKS = ["2026-W40", "2026-W41", "2026-W42", "2026-W43"] as const;

/** 600 invented skin colours across light to deep, with more in the middle than at the ends. */
export function recordedDemand(): ShadeDemandRow[] {
  const r = rng(20261101);
  const rows: ShadeDemandRow[] = [];
  for (let i = 0; i < 600; i++) {
    const L = Math.min(85, Math.max(28, 58 + normal(r) * 14));
    const a = Math.min(30, Math.max(4, 14 - (L - 58) * 0.05 + normal(r) * 2.5));
    const b = Math.min(40, Math.max(8, 22 - (L - 58) * 0.08 + normal(r) * 3));
    const band = BANDS[Math.min(4, Math.max(0, Math.round((85 - L) / 12)))] ?? "III";
    rows.push({
      skin_L: Math.round(L * 10) / 10,
      skin_a: Math.round(a * 10) / 10,
      skin_b: Math.round(b * 10) / 10,
      h_ab: Math.round(((Math.atan2(b, a) * 180) / Math.PI + 360) % 360),
      fitzpatrick_band: band,
      region: r() < 0.5 ? "south_asia" : "other",
      week: WEEKS[Math.floor(r() * WEEKS.length)] ?? WEEKS[0],
    });
  }
  return rows;
}

export interface RecordedOutcome {
  product_id: string;
  concern: string;
  delta: number;
  mdc: number | null;
  words: "within" | "small" | "clear" | "opposite";
  fitzpatrick_band: string | null;
  skin_type: string | null;
  week: string;
}

/** 160 invented finished proofs for two sample products. */
export function recordedOutcomes(): RecordedOutcome[] {
  const r = rng(77);
  const out: RecordedOutcome[] = [];
  for (let i = 0; i < 160; i++) {
    const product = i % 2 === 0 ? "Sample pore serum" : "Sample redness toner";
    const lift = product === "Sample pore serum" ? 1.5 : 0.4;
    const delta = Math.round((lift + normal(r) * 3) * 10) / 10;
    const mdc = 3.2;
    const words =
      Math.abs(delta) < mdc
        ? "within"
        : delta < 0
          ? "opposite"
          : delta < 2 * mdc
            ? "small"
            : "clear";
    out.push({
      product_id: product,
      concern: product === "Sample pore serum" ? "pore" : "redness",
      delta,
      mdc,
      words,
      fitzpatrick_band: BANDS[Math.floor(r() * BANDS.length)] ?? "III",
      skin_type: ["Normal", "Oily", "Dry", "Combination"][Math.floor(r() * 4)] ?? "Normal",
      week: WEEKS[Math.floor(r() * WEEKS.length)] ?? WEEKS[0],
    });
  }
  return out;
}

/** 240 invented built looks, some pairing apparel with beauty. */
export function recordedLooks(): LookEventRow[] {
  const r = rng(4242);
  const rows: LookEventRow[] = [];
  for (let i = 0; i < 240; i++) {
    const categories = ["apparel"];
    if (r() < 0.8) categories.push("beauty");
    if (r() < 0.4) categories.push("footwear");
    if (r() < 0.2) categories.push("bag");
    rows.push({
      categories,
      brand_ids: categories.includes("beauty") ? ["sample-brand"] : [],
      saved: r() < 0.55,
      week: WEEKS[Math.floor(r() * WEEKS.length)] ?? WEEKS[0],
    });
  }
  return rows;
}
