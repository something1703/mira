import { err, ok, type Result } from "@mira/schemas";

/**
 * Prices come only from the feature-cost endpoint (AGENTS.md §2.4). A feature can have several
 * SKUs (skin analysis by concern count and SD/HD; video by resolution), and the endpoint labels
 * them with a free-text `description`. Selection by description is the one place a wrong guess
 * would misquote, so every selector fails safe: if it cannot pick exactly one SKU, the quote is an
 * error and nothing is submitted. Descriptions are confirmed on the first live probe (F20).
 */
export interface Sku {
  readonly description?: string;
  readonly amount: number;
  readonly unit?: "result_image" | "second";
  /** Path segment after `/task/` in `run_task_url`. */
  readonly slug: string;
}

export interface PriceError {
  readonly code: "price_unknown" | "price_ambiguous";
  readonly message: string;
}
export type Price = Result<number, PriceError>;

const unknown = (slug: string, why: string): Price =>
  err({ code: "price_unknown", message: `No price for ${slug}: ${why}` });

/** `https://host/s2s/v2.0/task/skin-analysis?x=1` → `skin-analysis`. */
export function slugOf(runTaskUrl: string): string {
  const path = runTaskUrl.split("?")[0] ?? runTaskUrl;
  const i = path.indexOf("/task/");
  return (i === -1 ? path : path.slice(i + "/task/".length)).replace(/\/+$/, "");
}

const forSlug = (skus: readonly Sku[], slug: string) => skus.filter((s) => s.slug === slug);

export function priceSingle(slug: string, skus: readonly Sku[]): Price {
  const found = forSlug(skus, slug);
  if (found.length === 0) return unknown(slug, "feature-cost lists no SKU for it");
  const [first] = found;
  if (first === undefined) return unknown(slug, "no SKU");
  if (found.some((s) => s.amount !== first.amount)) {
    return err({
      code: "price_ambiguous",
      message: `Several different prices for ${slug}; a selector is needed`,
    });
  }
  return ok(first.amount);
}

/** "AI Skin Analysis for SD 5~7 concerns" → mode SD, 5 to 7. */
const CONCERN_SKU = /\b(SD|HD)\b[^0-9]*(\d+)\s*[~–-]\s*(\d+)/i;

export function priceSkinAnalysis(count: number, hd: boolean, skus: readonly Sku[]): Price {
  const mode = hd ? "HD" : "SD";
  const hits = forSlug(skus, "skin-analysis").filter((s) => {
    const m = CONCERN_SKU.exec(s.description ?? "");
    if (!m || m[1]?.toUpperCase() !== mode) return false;
    return count >= Number(m[2]) && count <= Number(m[3]);
  });
  const [first] = hits;
  if (first === undefined)
    return unknown("skin-analysis", `no ${mode} SKU covers ${String(count)} concerns`);
  if (hits.some((s) => s.amount !== first.amount)) {
    return err({ code: "price_ambiguous", message: "Several prices match this concern count" });
  }
  return ok(first.amount);
}

/** SKUs that list a count range ("1~5 features") priced by how many items were requested. */
const RANGE_SKU = /(\d+)\s*[~–-]\s*(\d+)/;

export function priceByDescription(slug: string, count: number, skus: readonly Sku[]): Price {
  const found = forSlug(skus, slug);
  if (found.length === 1 && found[0] !== undefined) return ok(found[0].amount);
  const hits = found.filter((s) => {
    const m = RANGE_SKU.exec(s.description ?? "");
    return m !== null && count >= Number(m[1]) && count <= Number(m[2]);
  });
  const [first] = hits;
  if (first === undefined) return unknown(slug, `no SKU covers ${String(count)} items`);
  if (hits.some((s) => s.amount !== first.amount)) {
    return err({ code: "price_ambiguous", message: `Several prices match ${String(count)} items` });
  }
  return ok(first.amount);
}

/** Per-second pricing: amount × seconds, from the SKU whose description names the resolution. */
export function priceVideo(
  slug: string,
  resolution: "480" | "720" | "1080",
  seconds: number,
  skus: readonly Sku[],
): Price {
  const hits = forSlug(skus, slug).filter((s) => (s.description ?? "").includes(resolution));
  const [first] = hits;
  if (first === undefined) return unknown(slug, `no SKU names ${resolution}p`);
  if (hits.some((s) => s.amount !== first.amount)) {
    return err({ code: "price_ambiguous", message: `Several prices for ${resolution}p` });
  }
  return ok(first.unit === "second" ? first.amount * seconds : first.amount);
}
