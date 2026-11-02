import { FEATURES, featureOf, type FeatureSlug } from "@mira/youcam-client";
import { describe, expect, it } from "vitest";
import { loadFixtures } from "../src";

/**
 * The price list read from YouCam's feature-cost endpoint on 2026-11-01 (the first live call), and
 * every price selector in the registry run against it. Until this snapshot existed, the selectors
 * had only seen descriptions I had imagined (docs/FACTS.md F20). Prices come only from this
 * endpoint (AGENTS.md §2.4); the numbers below are what that endpoint said, not a price table the
 * code uses.
 */
const { skus } = loadFixtures();

const price = (slug: FeatureSlug, params: unknown) => {
  const f = featureOf(slug);
  return f.price(f.params.parse(params), skus);
};

describe("the recorded feature-cost snapshot", () => {
  it("exists and covers every feature MIRA calls", () => {
    expect(skus.length).toBeGreaterThan(90);
    for (const slug of Object.keys(FEATURES)) {
      expect(
        skus.some((s) => s.slug === slug),
        `no SKU for ${slug}`,
      ).toBe(true);
    }
  });
});

describe("selectors against the real descriptions", () => {
  const hd = (n: number) =>
    [
      "hd_wrinkle",
      "hd_pore",
      "hd_texture",
      "hd_acne",
      "hd_oiliness",
      "hd_radiance",
      "hd_eye_bag",
      "hd_age_spot",
      "hd_dark_circle",
      "hd_droopy_upper_eyelid",
      "hd_droopy_lower_eyelid",
      "hd_firmness",
      "hd_moisture",
      "hd_redness",
      "hd_tear_trough",
      "hd_skin_type",
    ].slice(0, n);
  const sd = (n: number) =>
    [
      "wrinkle",
      "pore",
      "texture",
      "acne",
      "oiliness",
      "radiance",
      "eye_bag",
      "age_spot",
      "dark_circle_v2",
      "droopy_upper_eyelid",
      "droopy_lower_eyelid",
      "firmness",
      "moisture",
      "redness",
      "tear_trough",
      "skin_type",
    ].slice(0, n);

  it.each([
    ["HD 1 concern", hd(1), 12],
    ["HD 4 concerns", hd(4), 12],
    ["HD 5 concerns", hd(5), 16],
    ["HD 8 concerns", hd(8), 16],
    ["HD 9 concerns", hd(9), 20],
    ["HD 13 concerns", hd(13), 22],
    ["HD 16 concerns", hd(16), 22],
    ["SD 1 concern", sd(1), 9],
    ["SD 5 concerns", sd(5), 12],
    ["SD 9 concerns", sd(9), 14],
    ["SD 16 concerns", sd(16), 16],
  ] as const)(
    "skin analysis, %s = %i units (V2.0 and V2.1 rows agree, so neither is ambiguous)",
    (_name, concerns, units) => {
      expect(price("skin-analysis", { concerns })).toEqual({ ok: true, value: units });
    },
  );

  it.each([
    ["skin-tone-analysis", {}, 20],
    ["fitzpatrick-scale-analyzer", {}, 10],
    ["hair-type-detection", {}, 2],
    ["hair-density-detection", {}, 1],
    ["hair-length-detection", {}, 2],
    ["hair-frizziness-detection", {}, 2],
    [
      "makeup-vto",
      {
        effects: [
          {
            category: "foundation",
            palettes: [
              { color: "#C79A78", colorIntensity: 60, glowIntensity: 30, coverageIntensity: 40 },
            ],
          },
        ],
      },
      1,
    ],
    ["cloth-v4", { category: "full_body" }, 2],
    ["hair-color", { preset: "Rose Gold" }, 1],
    ["bg-replace", { type: "prompt", prompt: "a courtyard" }, 4],
    ["sod", {}, 1],
  ] as const)("%s = %i units", (slug, params, units) => {
    expect(price(slug, params)).toEqual({ ok: true, value: units });
  });

  it.each([
    [["faceAspectRatio"], 10],
    [["faceAspectRatio", "horizontalThird", "verticalFifth", "faceShape", "eyeShape"], 10],
    [
      ["faceAspectRatio", "horizontalThird", "verticalFifth", "faceShape", "eyeShape", "eyeSize"],
      20,
    ],
    [
      Array.from(
        { length: 14 },
        (_, i) =>
          [
            "eyeShape",
            "eyeSize",
            "eyeAngle",
            "eyeDistance",
            "eyelid",
            "eyebrowShape",
            "eyebrowThickness",
            "eyebrowDistance",
            "eyebrowShortness",
            "cheekbones",
            "faceShape",
            "lipShape",
            "noseWidth",
            "noseLength",
          ][i],
      ),
      20,
    ],
    [
      [
        "eyeShape",
        "eyeSize",
        "eyeAngle",
        "eyeDistance",
        "eyelid",
        "eyebrowShape",
        "eyebrowThickness",
        "eyebrowDistance",
        "eyebrowShortness",
        "cheekbones",
        "faceShape",
        "lipShape",
        "noseWidth",
        "noseLength",
        "age",
      ],
      30,
    ],
  ] as const)("face attributes, %j features", (features, units) => {
    expect(price("face-attr-analysis", { features })).toEqual({ ok: true, value: units });
  });

  it.each([
    [{ pores: 0.5 }, 4],
    [{ pores: 0.5, wrinkle: 0.5, spots: 0.5, redness: 0.5 }, 4],
    [{ pores: 0.5, wrinkle: 0.5, spots: 0.5, redness: 0.5, acne: 0.5 }, 6],
  ] as const)("skin simulation %j", (params, units) => {
    expect(price("skin-simulation", params)).toEqual({ ok: true, value: units });
  });

  it.each([
    ["480", 5, 5],
    ["720", 5, 10],
    ["720", 10, 20],
    ["1080", 5, 15],
    ["1080", 10, 30],
  ] as const)(
    "a %sp video of %i s costs %i units (per-second price × seconds)",
    (resolution, durationSec, units) => {
      expect(price("image-to-video/youcam", { resolution, durationSec })).toEqual({
        ok: true,
        value: units,
      });
    },
  );

  it("the costliest single step MIRA can plan fits under the per-node cap", () => {
    const worst = price("image-to-video/youcam", { resolution: "1080", durationSec: 10 });
    expect(worst).toEqual({ ok: true, value: 30 });
  });
});
