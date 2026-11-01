import { describe, expect, it } from "vitest";
import {
  FEATURES,
  priceByDescription,
  priceSkinAnalysis,
  priceSingle,
  priceVideo,
  slugOf,
  type Sku,
} from "../src";

const sku = (slug: string, amount: number, description?: string, unit?: "second"): Sku => ({
  slug,
  amount,
  ...(description === undefined ? {} : { description }),
  ...(unit === undefined ? {} : { unit }),
});

describe("slugOf", () => {
  it("takes the path after /task/ and ignores queries and slashes", () => {
    expect(slugOf("https://yce-api-01.makeupar.com/s2s/v2.0/task/skin-analysis")).toBe(
      "skin-analysis",
    );
    expect(slugOf("https://x/s2s/v2.1/task/skin-analysis/?a=1")).toBe("skin-analysis");
    expect(slugOf("https://x/s2s/v2.0/task/image-to-video/youcam")).toBe("image-to-video/youcam");
  });
});

describe("pricing never guesses", () => {
  it("single SKU: its amount; none: price_unknown; conflicting: price_ambiguous", () => {
    expect(priceSingle("sod", [sku("sod", 1)])).toEqual({ ok: true, value: 1 });
    expect(priceSingle("sod", [sku("sod", 1), sku("sod", 1)])).toEqual({ ok: true, value: 1 });
    expect(priceSingle("sod", [])).toMatchObject({ ok: false, error: { code: "price_unknown" } });
    expect(priceSingle("sod", [sku("sod", 1), sku("sod", 2)])).toMatchObject({
      ok: false,
      error: { code: "price_ambiguous" },
    });
  });

  const skin = [
    sku("skin-analysis", 9, "AI Skin Analysis for SD 1~4 concerns"),
    sku("skin-analysis", 12, "AI Skin Analysis for SD 5~7 concerns"),
    sku("skin-analysis", 12, "AI Skin Analysis for HD 1~4 concerns"),
    sku("skin-analysis", 16, "AI Skin Analysis for HD 5~8 concerns"),
  ];

  it("skin analysis picks by SD/HD and concern count from the description", () => {
    expect(priceSkinAnalysis(3, false, skin)).toEqual({ ok: true, value: 9 });
    expect(priceSkinAnalysis(6, false, skin)).toEqual({ ok: true, value: 12 });
    expect(priceSkinAnalysis(6, true, skin)).toEqual({ ok: true, value: 16 });
    expect(priceSkinAnalysis(2, true, skin)).toEqual({ ok: true, value: 12 });
  });

  it("skin analysis refuses a count no SKU covers, and descriptions it cannot read", () => {
    expect(priceSkinAnalysis(12, true, skin)).toMatchObject({
      ok: false,
      error: { code: "price_unknown" },
    });
    expect(
      priceSkinAnalysis(3, false, [sku("skin-analysis", 9, "Skin analysis, cheap")]),
    ).toMatchObject({
      ok: false,
    });
  });

  it("per-item features pick the range containing the count; a lone SKU is used as is", () => {
    const face = [
      sku("face-attr-analysis", 10, "1~5 features"),
      sku("face-attr-analysis", 20, "6~14 features"),
    ];
    expect(priceByDescription("face-attr-analysis", 5, face)).toEqual({ ok: true, value: 10 });
    expect(priceByDescription("face-attr-analysis", 6, face)).toEqual({ ok: true, value: 20 });
    expect(priceByDescription("face-attr-analysis", 20, face)).toMatchObject({ ok: false });
    expect(priceByDescription("skin-simulation", 3, [sku("skin-simulation", 4)])).toEqual({
      ok: true,
      value: 4,
    });
  });

  it("video: per-second amount times duration, by named resolution", () => {
    const video = [
      sku("image-to-video/youcam", 1, "Image to video 480p", "second"),
      sku("image-to-video/youcam", 2, "Image to video 720p", "second"),
    ];
    expect(priceVideo("image-to-video/youcam", "720", 10, video)).toEqual({ ok: true, value: 20 });
    expect(priceVideo("image-to-video/youcam", "1080", 5, video)).toMatchObject({ ok: false });
  });

  it("every registered feature prices through its own selector, and fails closed on an empty list", () => {
    const params: Record<string, unknown> = {
      "skin-analysis": { concerns: ["hd_pore"] },
      "face-attr-analysis": { features: ["faceShape"] },
      "skin-simulation": { pores: 0.5 },
      "makeup-vto": { effects: [] },
      "cloth-v4": { category: "auto" },
      "hair-color": { preset: "Rose Gold" },
      "bg-replace": { type: "prompt", prompt: "x" },
      "image-to-video/youcam": { resolution: "480", durationSec: 5 },
    };
    for (const f of Object.values(FEATURES)) {
      const result = (f.price as (p: unknown, s: readonly Sku[]) => ReturnType<typeof priceSingle>)(
        params[f.slug] ?? {},
        [],
      );
      expect(result.ok, f.slug).toBe(false);
    }
  });
});
