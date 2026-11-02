import { HIDDEN, type BrandCatalogue, type LookEventRow, type ShadeDemandRow } from "@mira/schemas";
import { z } from "zod";
import type { EngineClient } from "../twin/engine-client";

/**
 * The views the brand console reads. Every cell passes the cohort rule first: a group smaller than
 * `k` is hidden, and the response says only that it was hidden, never how many people were in it.
 * The same rule is written in SQL for BigQuery in `infra/bigquery/views.sql`, and a test keeps the
 * two reading the same number.
 */
export const visible = (n: number, k: number): boolean => n >= k;

export interface GapCell {
  hueLo: number;
  hueHi: number;
  lLo: number;
  lHi: number;
  /** Share of all shoppers in this cell, 0 to 1. */
  share: number;
  /** Of the shoppers here, the share no shade serves. */
  unservedShare: number;
}

export type GapView =
  | { state: "hidden"; message: typeof HIDDEN }
  | {
      state: "ok";
      shoppers: number;
      unservedShare: number;
      nearDe: number;
      calibrated: boolean;
      cells: GapCell[];
      hiddenCells: number;
      shades: { id: string; name: string; hex: string; l: number; h: number }[];
    };

const GapBins = z.object({
  total: z.number(),
  unserved: z.number(),
  unserved_share: z.number(),
  near_de: z.number(),
  bins: z.array(
    z.object({
      hue_lo: z.number(),
      hue_hi: z.number(),
      l_lo: z.number(),
      l_hi: z.number(),
      count: z.number(),
      unserved: z.number(),
      nearest_de_median: z.number(),
    }),
  ),
});

/** The Shade Gap Map: where the shoppers' skin colours sit against the brand's shades. */
export async function gapView(
  engines: EngineClient,
  rows: readonly ShadeDemandRow[],
  catalogue: BrandCatalogue,
  k: number,
): Promise<{ ok: true; view: GapView } | { ok: false }> {
  if (!visible(rows.length, k)) return { ok: true, view: { state: "hidden", message: HIDDEN } };
  const shades = catalogue.products.flatMap((p) => p.shades);
  const labs = await engines.colourLab(shades.map((s) => s.hex));
  if (!labs.ok) return { ok: false };
  const gap = await engines.gapMap(
    rows.map((r) => [r.skin_L, r.skin_a, r.skin_b]),
    labs.value.value.map((l) => l.lab),
  );
  if (!gap.ok) return { ok: false };
  const parsed = GapBins.safeParse(gap.value.value);
  if (!parsed.success) return { ok: false };
  const g = parsed.data;
  const shown = g.bins.filter((b) => visible(b.count, k));
  return {
    ok: true,
    view: {
      state: "ok",
      shoppers: g.total,
      unservedShare: g.unserved_share,
      nearDe: g.near_de,
      calibrated: gap.value.config?.GAP_NEAR_DE?.calibrated ?? false,
      hiddenCells: g.bins.length - shown.length,
      cells: shown.map((b) => ({
        hueLo: b.hue_lo,
        hueHi: b.hue_hi,
        lLo: b.l_lo,
        lHi: b.l_hi,
        share: b.count / g.total,
        unservedShare: b.unserved / b.count,
      })),
      shades: shades.map((s, i) => {
        const lab = labs.value.value[i]?.lab ?? [0, 0, 0];
        return {
          id: s.id,
          name: s.name,
          hex: s.hex,
          l: lab[0],
          h: ((Math.atan2(lab[2], lab[1]) * 180) / Math.PI + 360) % 360,
        };
      }),
    },
  };
}

export interface OutcomeRow {
  product_id: string;
  concern: string;
  delta: number;
  words: string;
  fitzpatrick_band: string | null;
  skin_type: string | null;
}

export interface EfficacyCell {
  product: string;
  concern: string;
  /** `all`, or a measured skin-tone band or skin type. */
  group: string;
  hidden: boolean;
  completed?: number;
  /** Share whose change was above their own day-to-day variation, in the claimed direction. */
  detectedShare?: number;
}

/** Completed proofs per product, overall and by measured band, each cell above the cohort rule. */
export function efficacyView(rows: readonly OutcomeRow[], k: number): EfficacyCell[] {
  const cells: EfficacyCell[] = [];
  const products = [...new Set(rows.map((r) => `${r.product_id}\u0000${r.concern}`))].sort();
  for (const key of products) {
    const [product = "", concern = ""] = key.split("\u0000");
    const mine = rows.filter((r) => r.product_id === product && r.concern === concern);
    const groups: [string, OutcomeRow[]][] = [
      ["all", mine],
      ...[...new Set(mine.map((r) => r.fitzpatrick_band).filter((b): b is string => b !== null))]
        .sort()
        .map((b): [string, OutcomeRow[]] => [
          `band ${b}`,
          mine.filter((r) => r.fitzpatrick_band === b),
        ]),
    ];
    for (const [group, g] of groups) {
      if (!visible(g.length, k)) {
        cells.push({ product, concern, group, hidden: true });
        continue;
      }
      const detected = g.filter((r) => r.words === "small" || r.words === "clear").length;
      cells.push({
        product,
        concern,
        group,
        hidden: false,
        completed: g.length,
        detectedShare: detected / g.length,
      });
    }
  }
  return cells;
}

export interface AttachCell {
  pairing: string;
  hidden: boolean;
  looks?: number;
  savedShare?: number;
}

/** Looks that combine apparel with beauty (and what else), counted per pairing above the rule. */
export function attachView(rows: readonly LookEventRow[], k: number): AttachCell[] {
  const both = rows.filter(
    (r) => r.categories.includes("apparel") && r.categories.includes("beauty"),
  );
  const pairings = new Map<string, LookEventRow[]>();
  for (const r of both) {
    const key = [...new Set(r.categories)].sort().join(" + ");
    pairings.set(key, [...(pairings.get(key) ?? []), r]);
  }
  return [...pairings]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([pairing, g]) =>
      visible(g.length, k)
        ? {
            pairing,
            hidden: false,
            looks: g.length,
            savedShare: g.filter((r) => r.saved).length / g.length,
          }
        : { pairing, hidden: true },
    );
}
