import { CONFIG, ShadeRange, type Finish } from "@mira/schemas";
import { createHash } from "node:crypto";
import { z } from "zod";

/**
 * Reading a shade range from a product page (docs/UX_FLOWS.md §5, "Reading the range"). The page is
 * untrusted text, so it is only ever read as data: swatches are found by their attributes, every
 * name and colour is checked against a schema, and nothing on the page can add an instruction or a
 * shade the page does not display. No image goes to a model (AGENTS.md §2.6): only the page's text
 * and attributes are read.
 *
 * The reader is deterministic for pages that mark their swatches with a colour (most do). A page it
 * cannot read is "not readable", which the screen explains; a model that reads rendered pages comes
 * with the agent in Phase 7, behind `ShadeReader`, and its answer goes through the same schema.
 */

/** What a reader returns, before it is trusted. */
export const Extraction = z.object({
  brand: z.string().optional(),
  product: z.string().optional(),
  finish: z.enum(["matte", "satin", "dewy"]).optional(),
  shades: z.array(z.object({ name: z.string(), hex: z.string() })),
});
export type Extraction = z.infer<typeof Extraction>;

export interface ShadeReader {
  read(html: string): Promise<unknown>;
}

const HEX = /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/;
const NAME_ATTRS = [
  "aria-label",
  "title",
  "data-name",
  "data-shade",
  "data-shade-name",
  "data-label",
  "alt",
];
const COLOUR_ATTRS = ["data-hex", "data-color", "data-colour", "data-swatch", "data-value"];

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e.startsWith("#x")) return String.fromCodePoint(parseInt(e.slice(2), 16));
    if (e.startsWith("#")) return String.fromCodePoint(parseInt(e.slice(1), 10));
    return ENTITIES[e.toLowerCase()] ?? m;
  });

/** Names are shown to a person as text. Control characters and markup are never part of one. */
export function cleanName(raw: string): string {
  return (
    decode(raw)
      .replace(/<[^>]*>/g, " ")
      // eslint-disable-next-line no-control-regex -- stripping them is the point
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80)
  );
}

export function normaliseHex(raw: string): string | undefined {
  const m = HEX.exec(raw.trim());
  if (!m) return undefined;
  let h = m[0].slice(1).toUpperCase();
  if (h.length === 3)
    h = h
      .split("")
      .map((c) => c + c)
      .join(""); // ASCII hex digits only
  return `#${h}`;
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
    out[(m[1] ?? "").toLowerCase()] = decode(m[3] ?? m[4] ?? "");
  }
  return out;
}

/** The page with scripts, styles, comments and hidden elements removed: what a person could see. */
function visibleHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(
      /<([a-z0-9]+)\b[^>]*\b(?:hidden|style\s*=\s*"[^"]*display\s*:\s*none[^"]*")[^>]*>[\s\S]*?<\/\1>/gi,
      " ",
    );
}

const meta = (html: string, property: string): string | undefined => {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    if ((a.property ?? a.name) === property && a.content) return cleanName(a.content);
  }
  return undefined;
};

const titleOf = (html: string): string | undefined => {
  const og = meta(html, "og:title");
  if (og) return og;
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1];
  if (h1) return cleanName(h1);
  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  return title ? cleanName(title) : undefined;
};

/** Finds elements that carry a colour and a name, in page order. */
export class SwatchReader implements ShadeReader {
  read(html: string): Promise<Extraction> {
    const seen = visibleHtml(html);
    const shades: { name: string; hex: string }[] = [];
    for (const m of seen.matchAll(/<([a-z0-9]+)\b([^>]*)>([^<]{0,120})?/gi)) {
      const a = attrs(m[2] ?? "");
      const colourSource =
        COLOUR_ATTRS.map((k) => a[k]).find((v) => v !== undefined && HEX.test(v)) ??
        /background(?:-color)?\s*:\s*([^;"]+)/i.exec(a.style ?? "")?.[1];
      const hex = colourSource === undefined ? undefined : normaliseHex(colourSource);
      if (hex === undefined) continue;
      const name = cleanName(
        NAME_ATTRS.map((k) => a[k]).find((v) => v !== undefined && v.trim() !== "") ?? m[3] ?? "",
      );
      if (name === "") continue;
      shades.push({ name, hex });
    }
    const ld = /<script[^>]*ld\+json[^>]*>([\s\S]*?)<\/script>/i.exec(html)?.[1];
    let brand = meta(html, "og:site_name");
    if (ld) {
      try {
        const data = JSON.parse(ld) as { brand?: { name?: string } | string };
        const b = typeof data.brand === "string" ? data.brand : data.brand?.name;
        if (b) brand = cleanName(b);
      } catch {
        // Not valid JSON-LD: the page's own meta tags are enough.
      }
    }
    const product = titleOf(html)?.replace(/\s+[|–—-]\s+[^|–—]*$/, "");
    const finish = (["matte", "satin", "dewy"] as const).find((f) =>
      new RegExp(`\\b${f}\\b`, "i").test(product ?? ""),
    );
    return Promise.resolve({
      ...(brand ? { brand } : {}),
      ...(product ? { product } : {}),
      ...(finish ? { finish } : {}),
      shades,
    });
  }
}

export type ReadFailure = "range_not_readable";

const MIN_SHADES = 3;

/** Makes a trusted range from a reader's answer, or says the page could not be read. */
export async function extractShadeRange(
  html: string,
  source: { url: string },
  reader: ShadeReader = new SwatchReader(),
): Promise<{ ok: true; range: ShadeRange } | { ok: false; reason: ReadFailure }> {
  let answer: unknown;
  try {
    answer = await reader.read(html);
  } catch {
    return { ok: false, reason: "range_not_readable" };
  }
  const parsed = Extraction.safeParse(answer);
  if (!parsed.success) return { ok: false, reason: "range_not_readable" };

  const used = new Set<string>();
  const ids = new Set<string>();
  const shades = [];
  for (const raw of parsed.data.shades) {
    const hex = normaliseHex(raw.hex);
    const name = cleanName(raw.name);
    if (hex === undefined || name === "") continue;
    // The same shade listed twice (a swatch and its label, a mobile and a desktop copy) counts once.
    const key = `${name.toLowerCase()}|${hex}`;
    if (used.has(key)) continue;
    used.add(key);
    const base =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 60) || "shade";
    let id = base;
    for (let n = 2; ids.has(id); n++) id = `${base}-${String(n)}`;
    ids.add(id);
    shades.push({ id, name, hex });
  }
  if (shades.length < MIN_SHADES || shades.length > CONFIG.shade.maxShadesPerRange.value) {
    return { ok: false, reason: "range_not_readable" };
  }
  const range = ShadeRange.safeParse({
    id: `page-${createHash("sha256").update(source.url).digest("hex").slice(0, 12)}`,
    brand: parsed.data.brand ?? new URL(source.url).hostname,
    product: parsed.data.product ?? "Foundation",
    ...(parsed.data.finish === undefined ? {} : { finish: parsed.data.finish satisfies Finish }),
    shades,
    source: { kind: "page", url: source.url },
    sample: false,
  });
  return range.success
    ? { ok: true, range: range.data }
    : { ok: false, reason: "range_not_readable" };
}
