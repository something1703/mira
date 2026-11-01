import { cutoutPng, placeholderHex, scenePng, type Scene } from "@mira/fixtures";
import type { FakeYouCam } from "@mira/youcam-client/testing";
import { createHash } from "node:crypto";
import type { Downloader } from "../lifecycle/types";
import { SYNTHETIC_TONE } from "../twin/synthetic";

/**
 * Synthetic try-on for mock mode (D25, D39). A "render" is a drawn scene: the person's skin colour,
 * a lip mark, a torso. Each step changes the part it is about, reading the request that made it
 * (the garment colour from the reference picture, the lip colour from the makeup effects), so the
 * audits have something real to compare and the chain looks the way a real one would. Nothing here
 * is a person or a render, and the screens say "sample results".
 */
/** How much of the lip colour asked for shows in a synthetic render. */
export const LIP_SHARE = 0.9;
const BACKDROP = "#476A8C";

export const mix = (a: string, b: string, t: number): string => {
  const c = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  const ch = (i: number) => Math.round(c(a, i) * (1 - t) + c(b, i) * t);
  return `#${[0, 1, 2].map((i) => ch(i).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
};

interface Body {
  effects?: { category?: string; palettes?: { color?: string }[] }[];
  palettes?: { color?: string }[];
  pattern?: unknown;
  garment_category?: string;
  gender?: string;
  type?: string;
  src_file_url?: string;
  ref_file_id?: string;
}

/** The lip colour a makeup request asked for. */
export function lipHex(body: Record<string, unknown> | undefined): string | undefined {
  const effects = (body as Body | undefined)?.effects;
  if (!Array.isArray(effects)) return undefined;
  return effects.find((e) => e.category === "lip_color")?.palettes?.[0]?.color;
}

/** Invented colours a "removed background" picture can take, picked by the picture's bytes. */
const SAMPLE_COLOURS = [
  "#9E1F2D",
  "#1F7A57",
  "#E3A12B",
  "#2B3F8F",
  "#6A1B2B",
  "#EFE6D2",
  "#4B2A6B",
];

export function seedLookFake(fake: FakeYouCam): void {
  const latency = 2_500;
  for (const feature of ["cloth-v4", "bag", "hair-color", "bg-replace", "sod"] as const) {
    fake.respondWith(feature, { latencyMs: latency });
  }
  fake.respondWith("image-to-video/youcam", { latencyMs: 6_000 });
}

/** Scene of a result URL, built by following the chain of `src_file_url`s back to the photo. */
function sceneOf(fake: FakeYouCam, url: unknown, depth = 0): Scene {
  const base: Scene = { skin: SYNTHETIC_TONE.color.skin_color };
  const body = fake.resultBodyOf(url) as Body | undefined;
  if (!body || depth > 12) return base;
  const prev = sceneOf(fake, body.src_file_url, depth + 1);
  if (body.garment_category !== undefined && body.garment_category !== "shoes") {
    const ref = body.ref_file_id === undefined ? undefined : fake.files.get(body.ref_file_id)?.data;
    const hex = ref === undefined ? undefined : placeholderHex(ref);
    return { ...prev, ...(hex ? { garment: hex } : {}) };
  }
  const lip = lipHex(body as Record<string, unknown>);
  if (lip) return { ...prev, lip: mix(SYNTHETIC_TONE.color.lip_color, lip, LIP_SHARE) };
  if (body.pattern !== undefined && body.palettes?.[0]?.color) {
    return { ...prev, hair: body.palettes[0].color };
  }
  if (body.type === "prompt" || body.type === "template") return { ...prev, backdrop: BACKDROP };
  return prev;
}

/**
 * Serves `fake.invalid` result URLs as the drawn scene that step would have produced. A request it
 * does not recognise (a foundation render, say) goes to `otherwise`.
 */
export function lookDownloader(fake: FakeYouCam, otherwise: Downloader): Downloader {
  return async (url) => {
    if (!url.startsWith("https://fake.invalid/")) return await otherwise(url);
    const body = fake.resultBodyOf(url) as Body | undefined;
    if (body === undefined) return await otherwise(url);
    const isLook =
      body.garment_category !== undefined ||
      body.gender !== undefined ||
      body.pattern !== undefined ||
      body.type !== undefined ||
      (body as { dst_duration?: unknown }).dst_duration !== undefined ||
      lipHex(body as Record<string, unknown>) !== undefined;
    if (isLook) {
      return {
        ok: true as const,
        value: { bytes: scenePng(sceneOf(fake, url)), contentType: "image/png" },
      };
    }
    // Background removal: a cut-out in a colour picked from the picture's own bytes.
    const id = (body as { src_file_id?: string }).src_file_id;
    if (Object.keys(body).every((k) => k.startsWith("src_file")) && id !== undefined) {
      const data = fake.files.get(id)?.data;
      if (data !== undefined) {
        const pick = createHash("sha256").update(data).digest()[0] ?? 0;
        const hex = SAMPLE_COLOURS[pick % SAMPLE_COLOURS.length] ?? "#9E1F2D";
        return {
          ok: true as const,
          value: { bytes: cutoutPng({ hex }), contentType: "image/png" },
        };
      }
    }
    return await otherwise(url);
  };
}
