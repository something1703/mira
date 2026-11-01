import { placeholderPng } from "@mira/fixtures";
import type { FakeYouCam } from "@mira/youcam-client/testing";
import type { Downloader } from "../lifecycle/types";
import { SYNTHETIC_TONE } from "../twin/synthetic";

/**
 * Synthetic try-on for mock mode. A "render" is a neutral picture with an oval in the shade's
 * colour; its re-measure reads that oval's colour blended halfway toward the synthetic person's
 * skin, so a shade near the skin blends closely and one far from it does not, and the ranking looks
 * the way a real one would. Everything here is invented and the screens say so (D25).
 */
const mix = (a: string, b: string, t: number): string => {
  const c = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  const ch = (i: number) => Math.round(c(a, i) * (1 - t) + c(b, i) * t);
  return `#${[0, 1, 2].map((i) => ch(i).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
};

/** The colour a foundation request was asked for, or undefined if the body is not one. */
export function foundationHex(body: Record<string, unknown> | undefined): string | undefined {
  const effects = body?.effects;
  if (!Array.isArray(effects)) return undefined;
  for (const e of effects as { category?: string; palettes?: { color?: string }[] }[]) {
    if (e.category === "foundation") return e.palettes?.[0]?.color;
  }
  return undefined;
}

export function seedShadeFake(fake: FakeYouCam): void {
  fake.respondWith("makeup-vto", { latencyMs: 8_000 }).respondWith("skin-tone-analysis", {
    latencyMs: 4_000,
    resultsFor: (body, resultOf) => {
      const rendered = foundationHex(resultOf(body.src_file_url));
      return rendered === undefined
        ? SYNTHETIC_TONE
        : {
            color: {
              ...SYNTHETIC_TONE.color,
              skin_color: mix(SYNTHETIC_TONE.color.skin_color, rendered, 0.5),
            },
          };
    },
  });
}

/** Serves `fake.invalid` result URLs as the placeholder picture for the shade that was rendered. */
export function syntheticDownloader(fake: FakeYouCam, otherwise: Downloader): Downloader {
  return async (url) => {
    if (!url.startsWith("https://fake.invalid/")) return await otherwise(url);
    const hex = foundationHex(fake.resultBodyOf(url));
    return {
      ok: true as const,
      value: { bytes: placeholderPng({ hex: hex ?? "#777777" }), contentType: "image/png" },
    };
  };
}
