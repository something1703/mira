import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FEATURES,
  MakeupParams,
  SkinAnalysisParams,
  featureOf,
  taskPath,
  type FeatureSlug,
} from "../src";

const src = { fileId: "f1" } as const;
const sample = {
  foundation: {
    category: "foundation" as const,
    palettes: [{ color: "#C79A78", colorIntensity: 60, glowIntensity: 30, coverageIntensity: 40 }],
  },
  concealer: {
    category: "concealer" as const,
    palettes: [
      { color: "#C79A78", colorIntensity: 60, colorUnderEyeIntensity: 40, coverageLevel: 50 },
    ],
  },
  lip: {
    category: "lip_color" as const,
    shape: { name: "natural" },
    style: { type: "full" as const },
    palettes: [{ color: "#A23B4F", texture: "satin" as const, colorIntensity: 70 }],
  },
  blush: {
    category: "blush" as const,
    pattern: { name: "apple" },
    palettes: [{ color: "#D9777F", texture: "matte" as const, colorIntensity: 40 }],
  },
};

const build = (slug: FeatureSlug, params: unknown, inputs: object) => {
  const f = featureOf(slug);
  return f.buildBody(f.params.parse(params), inputs);
};

describe("makeup-vto always sends skin_smooth", () => {
  const smoothEffect = (body: Record<string, unknown>) =>
    (body.effects as { category: string }[]).filter((e) => e.category === "skin_smooth");

  it("every combination of effects carries exactly one skin_smooth at 0 by default", () => {
    for (const effects of [
      [sample.foundation],
      [sample.foundation, sample.concealer],
      [sample.lip],
      [sample.blush, sample.lip, sample.foundation],
    ]) {
      const body = build("makeup-vto", { effects }, { src });
      const smooth = smoothEffect(body);
      expect(smooth).toEqual([
        { category: "skin_smooth", skinSmoothStrength: 0, skinSmoothColorIntensity: 0 },
      ]);
      // skin_smooth comes first so the other effects land on unsmoothed skin.
      expect((body.effects as { category: string }[])[0]?.category).toBe("skin_smooth");
    }
  });

  it("opt-in smoothing sends the chosen strength, still as a single effect", () => {
    const body = build(
      "makeup-vto",
      { effects: [sample.foundation], smoothing: { strength: 35 } },
      { src },
    );
    expect(smoothEffect(body)).toEqual([
      { category: "skin_smooth", skinSmoothStrength: 35, skinSmoothColorIntensity: 35 },
    ]);
  });

  it("callers cannot sneak in their own skin_smooth effect or a zero-strength opt-in", () => {
    expect(
      MakeupParams.safeParse({
        effects: [
          { category: "skin_smooth", skinSmoothStrength: 50, skinSmoothColorIntensity: 50 },
        ],
      }).success,
    ).toBe(false);
    expect(
      MakeupParams.safeParse({ effects: [sample.foundation], smoothing: { strength: 0 } }).success,
    ).toBe(false);
  });

  it("rejects bad colours and empty effects", () => {
    expect(MakeupParams.safeParse({ effects: [] }).success).toBe(false);
    const bad = {
      ...sample.foundation,
      palettes: [{ ...sample.foundation.palettes[0], color: "tan" }],
    };
    expect(MakeupParams.safeParse({ effects: [bad] }).success).toBe(false);
  });
});

describe("request builders", () => {
  it("every registered feature has a path under /s2s/<version>/task/", () => {
    for (const f of Object.values(FEATURES)) {
      expect(taskPath(f)).toBe(`/s2s/${f.version}/task/${f.slug}`);
    }
    expect(taskPath(FEATURES["skin-analysis"])).toBe("/s2s/v2.1/task/skin-analysis");
    expect(taskPath(FEATURES["cloth-v4"])).toBe("/s2s/v2.0/task/cloth-v4");
    expect(taskPath(FEATURES["image-to-video/youcam"])).toBe(
      "/s2s/v2.0/task/image-to-video/youcam",
    );
  });

  it("sends a file id or a URL, never both", () => {
    expect(build("sod", {}, { src: { fileId: "a" } })).toEqual({ src_file_id: "a" });
    expect(build("sod", {}, { src: { url: "https://x.test/a.png" } })).toEqual({
      src_file_url: "https://x.test/a.png",
    });
  });

  it("skin analysis: json format, concerns as dst_actions, no HD/SD mixing", () => {
    expect(build("skin-analysis", { concerns: ["hd_pore", "hd_texture"] }, { src })).toEqual({
      src_file_id: "f1",
      dst_actions: ["hd_pore", "hd_texture"],
      format: "json",
    });
    expect(SkinAnalysisParams.safeParse({ concerns: ["hd_pore", "texture"] }).success).toBe(false);
    expect(SkinAnalysisParams.safeParse({ concerns: ["pore", "pore"] }).success).toBe(false);
    expect(SkinAnalysisParams.safeParse({ concerns: [] }).success).toBe(false);
  });

  it("fitzpatrick always sends version 1.0", () => {
    expect(build("fitzpatrick-scale-analyzer", {}, { src })).toMatchObject({ version: "1.0" });
  });

  it("skin tone sends the strictness level only when asked", () => {
    expect(build("skin-tone-analysis", {}, { src })).toEqual({ src_file_id: "f1" });
    expect(build("skin-tone-analysis", { strictness: "strict" }, { src })).toMatchObject({
      face_angle_strictness_level: "strict",
    });
  });

  it("hair type and frizz take three photos in order", () => {
    const srcs = [{ fileId: "front" }, { fileId: "right" }, { fileId: "left" }] as const;
    expect(build("hair-type-detection", {}, { srcs })).toEqual({
      src_file_ids: ["front", "right", "left"],
    });
    const urls = [{ url: "https://a" }, { url: "https://b" }, { url: "https://c" }] as const;
    expect(build("hair-frizziness-detection", {}, { srcs: urls })).toEqual({
      src_file_urls: ["https://a", "https://b", "https://c"],
    });
    expect(() =>
      build(
        "hair-type-detection",
        {},
        { srcs: [{ fileId: "a" }, { url: "https://b" }, { fileId: "c" }] },
      ),
    ).toThrow("all three");
  });

  it("clothes: source and garment, category, optional flags", () => {
    expect(
      build(
        "cloth-v4",
        { category: "full_body", changeShoes: false, filterMultiPerson: "strict" },
        { src, ref: { fileId: "g1" } },
      ),
    ).toEqual({
      src_file_id: "f1",
      ref_file_id: "g1",
      garment_category: "full_body",
      change_shoes: false,
      filter_multi_person: "strict",
    });
    expect(() => build("cloth-v4", { category: "outer" }, { src })).toThrow("Missing input: ref");
  });

  it("face attributes: at most 28 features, from the documented list", () => {
    expect(
      build("face-attr-analysis", { features: ["faceAspectRatio", "horizontalThird"] }, { src }),
    ).toMatchObject({
      features: ["faceAspectRatio", "horizontalThird"],
    });
    expect(FEATURES["face-attr-analysis"].params.safeParse({ features: ["madeUp"] }).success).toBe(
      false,
    );
  });

  it("skin simulation takes only the documented plural names, 0 to 1", () => {
    expect(build("skin-simulation", { pores: 0.5, eye_bags: 1 }, { src })).toEqual({
      src_file_id: "f1",
      pores: 0.5,
      eye_bags: 1,
    });
    const p = FEATURES["skin-simulation"].params;
    expect(p.safeParse({ pores: 1.1 }).success).toBe(false);
    expect(p.safeParse({}).success).toBe(false);
  });

  it("background, video and hair colour map their params to the API's names", () => {
    expect(
      build("bg-replace", { type: "prompt", prompt: "a mehendi courtyard" }, { src }),
    ).toMatchObject({
      type: "prompt",
      prompt: "a mehendi courtyard",
    });
    expect(build("bg-replace", { type: "template", templateId: "t9" }, { src })).toMatchObject({
      template_id: "t9",
    });
    expect(
      build("image-to-video/youcam", { resolution: "720", durationSec: 5 }, { src }),
    ).toMatchObject({
      resolution: "720",
      dst_duration: 5,
    });
    expect(
      FEATURES["image-to-video/youcam"].params.safeParse({ resolution: "720", durationSec: 7 })
        .success,
    ).toBe(false);
    expect(build("hair-color", { preset: "Rose Gold" }, { src })).toMatchObject({
      preset: "Rose Gold",
    });
  });
});

describe("webhook flag matches the saved bundles", () => {
  const BUNDLE_OF: Record<string, string> = {
    "skin-analysis": "ai_skin_analysis",
    "skin-tone-analysis": "ai_skin_tone_analysis",
    "fitzpatrick-scale-analyzer": "ai_fitzpatrick_skin_type",
    "face-attr-analysis": "ai_face_analyzer",
    "hair-type-detection": "ai_hair_type_detection",
    "hair-frizziness-detection": "ai_hair_frizziness_detection",
    "hair-density-detection": "ai_hair_density_detection",
    "hair-length-detection": "ai_hair_length_detection",
    "skin-simulation": "ai_skin_simulation",
    "makeup-vto": "makeup_vto",
    "cloth-v4": "ai_clothes",
    "hair-color": "ai_hair_color",
    "bg-replace": "ai_photo_background_change",
    "image-to-video/youcam": "ai_video_generator",
    sod: "ai_background_removal",
    bag: "ai_bag",
  };

  it("every registered feature has a bundle in this table", () => {
    expect(Object.keys(BUNDLE_OF).sort()).toEqual(Object.keys(FEATURES).sort());
  });

  it.each(Object.entries(BUNDLE_OF))("%s", (slug, bundle) => {
    const text = readFileSync(join(import.meta.dirname, "../openapi", `${bundle}.yaml`), "utf8");
    const mentions = /webhook/i.test(text);
    expect(featureOf(slug as FeatureSlug).webhooks).toBe(mentions ? "documented" : "undocumented");
  });

  it("the features MIRA depends on for capture are the ones with no documented webhook", () => {
    // So the poll fallback is not optional polish: it is the only dependable path for these.
    for (const slug of ["skin-tone-analysis", "face-attr-analysis", "makeup-vto"] as const) {
      expect(featureOf(slug).webhooks).toBe("undocumented");
    }
  });
});
