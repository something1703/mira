import type { Metric } from "@mira/schemas";
import { describe, expect, it } from "vitest";
import {
  concernsFor,
  extractColour,
  extractFace,
  extractFitzpatrick,
  extractHair,
  extractSkin,
  normaliseHex,
  repeatScores,
  toneHexes,
} from "../src/twin/extract";

const stamp = {
  source: { feature: "skin-analysis", version: "v2.1", taskRunId: "run_x" },
  at: "2026-11-01T09:00:00.000Z",
};

describe("normaliseHex", () => {
  it("accepts either case with or without #, rejects anything else", () => {
    expect(normaliseHex(" #c79a78 ")).toBe("#C79A78");
    expect(normaliseHex("C79A78")).toBe("#C79A78");
    for (const bad of ["#C79A7", "red", "", 12, undefined, null, "#GGGGGG"]) {
      expect(normaliseHex(bad)).toBeUndefined();
    }
  });
});

describe("extractSkin", () => {
  it("keeps raw_score of the configured concerns and nothing else", () => {
    const out = extractSkin(
      {
        output: [
          { type: "hd_pore", raw_score: 41.5, ui_score: 60 },
          { type: "hd_redness", region: "Left Cheek", raw_score: 30 },
          { type: "hd_age_spot", raw_score: 12 },
          { type: "all", raw_score: 70 },
          { type: "skin_age", raw_score: 33 },
          { type: "hd_acne", ui_score: 50 },
        ],
      },
      stamp,
    );
    expect(
      out.ok && out.value.metrics.map((m) => [m.id, m.kind === "number" ? m.value : null]),
    ).toEqual([
      ["skin.hd_pore.whole", 41.5],
      ["skin.hd_redness.left_cheek", 30],
    ]);
  });

  it("reads the SD names in standard-detail mode and not the HD ones", () => {
    const out = extractSkin(
      {
        output: [
          { type: "pore", raw_score: 40 },
          { type: "hd_pore", raw_score: 41 },
        ],
      },
      stamp,
      "sd",
    );
    expect(out.ok && out.value.metrics.map((m) => m.id)).toEqual(["skin.pore.whole"]);
  });

  it("is unreadable, not a throw, on a shape it does not know", () => {
    for (const bad of [undefined, null, 3, {}, { output: "x" }]) {
      expect(extractSkin(bad, stamp)).toEqual({ ok: false, reason: "unreadable" });
    }
  });

  it("maps HD concerns to SD names", () => {
    expect(concernsFor("sd")).toEqual(
      concernsFor("hd").map((c) => (c === "hd_dark_circle" ? "dark_circle_v2" : c.slice(3))),
    );
  });
});

describe("colour", () => {
  const tone = {
    color: {
      skin_color: "#c79a78",
      eye_color: "bad",
      eye_color_name: "brown",
      hair_color_name: "",
    },
  };

  it("finds the hexes that are valid", () => {
    expect(toneHexes(tone)).toEqual({ skin: "#C79A78" });
    expect(toneHexes("nope")).toBeUndefined();
  });

  it("builds swatches, ITA and its band from the engine's reading", () => {
    const reading = {
      hex: "#C79A78",
      lab: [70, 12, 24] as [number, number, number],
      lch: { l: 70, c: 26, h: 63 },
      ita: 39,
      ita_band: "intermediate",
    };
    const out = extractColour(tone, { skin: reading }, stamp, {
      ...stamp,
      source: { ...stamp.source, feature: "engine:colour/lab" },
    });
    expect(out.ok && out.value.metrics.map((m) => m.id)).toEqual([
      "colour.skin",
      "colour.skin_ita",
      "colour.skin_ita_band",
      "colour.eye_name",
    ]);
  });
});

describe("other analysers", () => {
  it("Fitzpatrick is a category", () => {
    const out = extractFitzpatrick({ fitzpatrick_scale: "IV" }, stamp);
    expect(out.ok && out.value.metrics[0]).toMatchObject({
      id: "colour.fitzpatrick_band",
      kind: "category",
      value: "IV",
    });
    expect(extractFitzpatrick({ fitzpatrick_scale: "VII" }, stamp).ok).toBe(false);
  });

  it("face ratios become one metric per element and ignore age and gender", () => {
    const out = extractFace(
      {
        facialratio: { horizontal_third: [0.3, 0.4, 0.3], empty: [] },
        agegender: { age: 30, gender: "f" },
      },
      stamp,
    );
    expect(out.ok && out.value.metrics.map((m) => m.id)).toEqual([
      "face.horizontal_third.1",
      "face.horizontal_third.2",
      "face.horizontal_third.3",
    ]);
    expect(out.ok && out.value.ratios).toEqual({ horizontal_third: [0.3, 0.4, 0.3] });
  });

  it("hair prefers the word to YouCam's code", () => {
    const word = extractHair("type", { hair_type: { mapping: "3", term: "wavy" } }, stamp);
    expect(word.ok && word.value.metrics[0]).toMatchObject({ id: "hair.type", value: "wavy" });
    const code = extractHair("density", { hair_density: { mapping: "2" } }, stamp);
    expect(code.ok && code.value.metrics[0]).toMatchObject({ id: "hair.density", value: "2" });
    expect(extractHair("length", { hair_length: {} }, stamp).ok).toBe(false);
  });
});

describe("repeatScores", () => {
  const num = (id: string, value: number): Metric => ({
    ...stamp,
    id,
    measuredAt: stamp.at,
    confidence: "n/a",
    kind: "number",
    value,
    unit: "raw score",
  });

  it("lists one score per capture, only for concerns present in every capture", () => {
    const a = [num("skin.hd_pore.whole", 40), num("skin.hd_acne.whole", 20)];
    const b = [num("skin.hd_pore.whole", 42)];
    const c = [num("skin.hd_pore.whole", 41), num("skin.hd_acne.whole", 21)];
    expect(repeatScores([a, b, c])).toEqual({ "skin.hd_pore.whole": [40, 42, 41] });
    expect(repeatScores([])).toEqual({});
  });
});
