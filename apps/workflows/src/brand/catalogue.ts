import { BrandCatalogue, type ShadeRange } from "@mira/schemas";

/**
 * A brand's range from a spreadsheet or from product pages. A CSV has one row per shade
 * (`product, shade, hex`); a page is read by the same reader as the Shade screen. Everything is
 * checked and nothing in a file is ever read as an instruction: a cell is a name or a colour.
 */
export const LIMITS = {
  bytes: 512 * 1024,
  rows: 5_000,
  products: 50,
  shadesPerProduct: 200,
} as const;

export interface Problem {
  line: number;
  reason:
    | "not_a_colour"
    | "missing_product"
    | "missing_shade"
    | "too_many_shades"
    | "too_many_products"
    | "wrong_columns";
}

/** A tolerant CSV reader: quoted cells, doubled quotes, CRLF. No type guessing. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i] ?? "";
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell);
      cell = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

const HEX = /^#?([0-9a-f]{6})$/i;
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50) || "item";
// Control characters in a cell are removed: a name is text a person reads.
const clean = (s: string) =>
  s
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);

export function catalogueFromCsv(
  text: string,
  brand: { id: string; name: string },
  now: string,
): { ok: true; catalogue: BrandCatalogue } | { ok: false; problems: Problem[] } {
  const rows = parseCsv(text);
  if (rows.length > LIMITS.rows + 1)
    return { ok: false, problems: [{ line: 0, reason: "too_many_shades" }] };
  const head = rows[0]?.map((h) => h.trim().toLowerCase());
  const col = (names: string[]) => head?.findIndex((h) => names.includes(h)) ?? -1;
  const pi = col(["product", "product name", "range"]);
  const si = col(["shade", "shade name", "name"]);
  const hi = col(["hex", "colour", "color", "hex code"]);
  if (pi < 0 || si < 0 || hi < 0)
    return { ok: false, problems: [{ line: 1, reason: "wrong_columns" }] };

  const problems: Problem[] = [];
  const products = new Map<
    string,
    { name: string; shades: { id: string; name: string; hex: string }[] }
  >();
  rows.slice(1).forEach((r, n) => {
    const line = n + 2;
    const product = clean(r[pi] ?? "");
    const name = clean(r[si] ?? "");
    const hex = HEX.exec((r[hi] ?? "").trim())?.[1];
    if (product === "") return void problems.push({ line, reason: "missing_product" });
    if (name === "") return void problems.push({ line, reason: "missing_shade" });
    if (hex === undefined) return void problems.push({ line, reason: "not_a_colour" });
    const p = products.get(product) ?? { name: product, shades: [] };
    if (p.shades.length >= LIMITS.shadesPerProduct)
      return void problems.push({ line, reason: "too_many_shades" });
    const base = slug(name);
    let id = base;
    for (let k = 2; p.shades.some((s) => s.id === id); k++) id = `${base}-${String(k)}`;
    p.shades.push({ id, name, hex: `#${hex.toUpperCase()}` });
    products.set(product, p);
  });
  if (products.size > LIMITS.products) problems.push({ line: 0, reason: "too_many_products" });
  if (problems.length > 0 || products.size === 0) {
    return {
      ok: false,
      problems: problems.length > 0 ? problems : [{ line: 1, reason: "wrong_columns" }],
    };
  }
  return {
    ok: true,
    catalogue: BrandCatalogue.parse({
      brandId: brand.id,
      name: brand.name,
      products: [...products.values()].map((p) => ({
        id: slug(p.name),
        name: p.name,
        shades: p.shades,
      })),
      source: "csv",
      sample: false,
      updatedAt: now,
    }),
  };
}

export function catalogueFromRanges(
  ranges: readonly ShadeRange[],
  brand: { id: string; name: string },
  now: string,
  source: "links" | "sample",
): BrandCatalogue {
  return BrandCatalogue.parse({
    brandId: brand.id,
    name: brand.name,
    products: ranges.map((r) => ({
      id: r.id,
      name: r.product,
      shades: r.shades.map((s) => ({ id: s.id, name: s.name, hex: s.hex })),
    })),
    source,
    sample: ranges.every((r) => r.sample),
    updatedAt: now,
  });
}
