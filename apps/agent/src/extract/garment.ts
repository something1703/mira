import { cleanName, visibleHtml } from "./shade-range";

/**
 * Reading a garment from a product page (docs/PHASE_08, garment ingest). Like a shade range, the
 * page is untrusted: only its declared picture and title are read, as data. The picture is then
 * fetched with the same guards as a page and handed to the workflows service, which removes its
 * background and measures its colour. Nothing on the page can add an instruction.
 */
export interface GarmentPage {
  name: string;
  /** Absolute https address of the product picture. */
  image: string;
}

const attr = (tag: string, name: string): string | undefined =>
  new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(tag)?.slice(2, 4).find(Boolean);

const meta = (html: string, property: string): string | undefined => {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const key = attr(m[0], "property") ?? attr(m[0], "name");
    if (key === property) return attr(m[0], "content");
  }
  return undefined;
};

export function readGarmentPage(html: string, pageUrl: string): GarmentPage | undefined {
  const seen = visibleHtml(html);
  const raw =
    meta(html, "og:image:secure_url") ??
    meta(html, "og:image") ??
    meta(html, "twitter:image") ??
    (/<img\b[^>]*>/i.exec(seen)?.[0]
      ? attr(/<img\b[^>]*>/i.exec(seen)?.[0] ?? "", "src")
      : undefined);
  if (raw === undefined) return undefined;
  let image: URL;
  try {
    image = new URL(raw, pageUrl);
  } catch {
    return undefined;
  }
  // Only https pictures are fetched (the fetcher refuses the rest too); say no early.
  if (image.protocol !== "https:") return undefined;
  const title =
    meta(html, "og:title") ??
    /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(seen)?.[1] ??
    /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(seen)?.[1];
  const name = title === undefined ? "" : cleanName(title.replace(/\s+[|–—-]\s+[^|–—]*$/, ""));
  return { name: name === "" ? "Garment" : name, image: image.toString() };
}
