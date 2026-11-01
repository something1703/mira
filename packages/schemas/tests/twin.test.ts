import { describe, expect, it } from "vitest";
import {
  CONFIG,
  COLOUR_PARTS,
  METRIC,
  MetricId,
  NoiseFloorEntry,
  Twin,
  colourMetricId,
  faceMetricId,
  groupOf,
  skinMetricId,
} from "../src";

const at = "2026-11-01T10:00:00.000Z";
const group = { status: "measured" as const, at };
const base = {
  userId: "usr_aaaaaaaa",
  createdAt: at,
  updatedAt: at,
  metrics: {},
  groups: { skin: group, colouring: group, face: group, hair: group },
  captureMeta: {
    mode: "hd" as const,
    source: "camera" as const,
    repeatsCaptured: 2,
    qualityChecksPassed: true,
  },
  synthetic: false,
};

describe("Twin", () => {
  it("accepts a minimal profile and fills the defaults", () => {
    const t = Twin.parse(base);
    expect(t.faceRatios).toEqual({});
    expect(t.noiseFloors).toEqual({});
    expect(t.runIds).toEqual([]);
  });

  it("a group that was not measured says why and what to do, reading by reading", () => {
    const t = Twin.parse({
      ...base,
      groups: {
        ...base.groups,
        hair: {
          status: "partial",
          missing: [{ reading: "hair_type", reason: "hair_photos_mismatch", guidance: "retake" }],
          at,
        },
      },
    });
    expect(t.groups.hair).toMatchObject({
      status: "partial",
      missing: [{ reading: "hair_type", guidance: "retake" }],
    });
    expect(Twin.parse(base).groups.skin.missing).toEqual([]);
  });
  it("rejects an unknown group status, guidance, mode or source", () => {
    expect(
      Twin.safeParse({ ...base, groups: { ...base.groups, skin: { status: "great", at } } })
        .success,
    ).toBe(false);
    expect(
      Twin.safeParse({ ...base, captureMeta: { ...base.captureMeta, mode: "4k" } }).success,
    ).toBe(false);
    expect(
      Twin.safeParse({ ...base, captureMeta: { ...base.captureMeta, source: "video" } }).success,
    ).toBe(false);
    expect(
      Twin.safeParse({
        ...base,
        groups: {
          ...base.groups,
          face: {
            status: "not_measured",
            missing: [{ reading: "proportions", reason: "x", guidance: "panic" }],
            at,
          },
        },
      }).success,
    ).toBe(false);
  });

  it("requires every group and the synthetic flag, so a screen can never guess either", () => {
    const { synthetic: _s, ...noFlag } = base;
    expect(Twin.safeParse(noFlag).success).toBe(false);
    const { hair: _h, ...three } = base.groups;
    expect(Twin.safeParse({ ...base, groups: three }).success).toBe(false);
  });

  it("holds numbers only: a metric cannot carry an image or a URL as its value", () => {
    const metric = {
      id: "skin.hd_pore.whole",
      source: { feature: "skin-analysis", version: "v2.1", taskRunId: "t" },
      confidence: "n/a",
      measuredAt: at,
    };
    expect(
      Twin.safeParse({
        ...base,
        metrics: {
          "skin.hd_pore.whole": { ...metric, kind: "number", value: 71.2, unit: "raw score" },
        },
      }).success,
    ).toBe(true);
    // A field the schema does not define is dropped, never stored.
    const parsed = Twin.parse({ ...base, imageUrl: "https://x/face.png", photo: "AAAA" });
    expect(JSON.stringify(parsed)).not.toContain("face.png");
    expect(JSON.stringify(parsed)).not.toContain("AAAA");
  });

  it("a same-session noise estimate has s_w but no MDC (D16)", () => {
    expect(
      NoiseFloorEntry.safeParse({
        sessions: 1,
        capturesPerSession: 3,
        sW: 1.2,
        sD: null,
        sDSource: "unknown",
        se: null,
        mdc: null,
      }).success,
    ).toBe(true);
    expect(
      NoiseFloorEntry.safeParse({
        sessions: 1,
        capturesPerSession: 1,
        sW: 1.2,
        sD: null,
        sDSource: "unknown",
        se: null,
        mdc: null,
      }).success,
    ).toBe(false);
    expect(
      NoiseFloorEntry.safeParse({
        sessions: 1,
        capturesPerSession: 3,
        sW: -1,
        sD: null,
        sDSource: "unknown",
        se: null,
        mdc: null,
      }).success,
    ).toBe(false);
  });
});

describe("metric ids", () => {
  it("skin ids carry the concern and region, `whole` when there is none", () => {
    expect(skinMetricId("hd_pore", "forehead")).toBe("skin.hd_pore.forehead");
    expect(skinMetricId("hd_redness")).toBe("skin.hd_redness.whole");
    expect(skinMetricId("hd_skin_type", "t_zone")).toBe("skin.hd_skin_type.t_zone");
  });

  it("odd characters in YouCam's names cannot produce an invalid id", () => {
    for (const [type, region] of [
      ["Dark Circle (V2)", "Under-Eye"],
      ["wrinkle", "crow's feet"],
      ["  pore  ", undefined],
    ] as const) {
      expect(MetricId.safeParse(skinMetricId(type, region)).success).toBe(true);
    }
    expect(skinMetricId("Dark Circle (V2)", "Under-Eye")).toBe("skin.dark_circle_v2.under_eye");
  });

  it("every id the scheme can build is valid and belongs to exactly one group", () => {
    const ids = [
      skinMetricId("hd_pore", "cheek"),
      ...COLOUR_PARTS.map(colourMetricId),
      ...Object.values(METRIC),
      faceMetricId("horizontalThird", 0),
      faceMetricId("face_aspect_ratio", 0),
    ];
    for (const id of ids) {
      expect(MetricId.safeParse(id).success, id).toBe(true);
      expect(["skin", "colouring", "face", "hair"]).toContain(groupOf(id));
    }
    expect(groupOf(METRIC.fitzpatrick)).toBe("colouring");
    expect(groupOf(METRIC.ita)).toBe("colouring");
    expect(groupOf(METRIC.hairType)).toBe("hair");
    expect(() => groupOf("units.spent")).toThrow("no profile group");
  });

  it("face ratio vectors become one metric per element, numbered from 1", () => {
    expect(faceMetricId("horizontalThird", 0)).toBe("face.horizontal_third.1");
    expect(faceMetricId("faceAspectRatio", 0)).toBe("face.face_aspect_ratio.1");
    expect(faceMetricId("noseToLipToChin", 1)).toBe("face.nose_to_lip_to_chin.2");
    expect(faceMetricId("horizontal_third", 2)).toBe("face.horizontal_third.3");
  });
});

describe("twin configuration", () => {
  it("reads exactly eight HD concerns (the 16-unit tier) and five face features (the 10-unit tier)", () => {
    expect(CONFIG.twin.skinConcerns.value).toHaveLength(8);
    expect(CONFIG.twin.skinConcerns.value.every((c) => c.startsWith("hd_"))).toBe(true);
    expect(new Set(CONFIG.twin.skinConcerns.value).size).toBe(8);
    expect(CONFIG.twin.faceFeatures.value).toHaveLength(5);
  });

  it("keeps the concerns later phases depend on", () => {
    const c = CONFIG.twin.skinConcerns.value;
    for (const needed of [
      "hd_acne",
      "hd_redness",
      "hd_skin_type",
      "hd_dark_circle",
      "hd_pore",
      "hd_oiliness",
    ]) {
      expect(c, needed).toContain(needed);
    }
  });

  it("two repeat captures plus the first make the three of one session (docs/ENGINES.md §8)", () => {
    expect(1 + CONFIG.twin.repeatCaptures.value).toBe(3);
    expect(CONFIG.twin.minFaceWidthShare.value).toBe(0.6);
    expect(CONFIG.twin.heldPhotoMinutes.value).toBe(120);
  });
});

describe("noise floor entries follow D16", () => {
  const entry = {
    sessions: 1,
    capturesPerSession: 3,
    sW: 1.2,
    sD: null,
    sDSource: "unknown",
    se: null,
    mdc: null,
  };
  it("accepts a one-session spread with no MDC", () => {
    expect(NoiseFloorEntry.safeParse(entry).success).toBe(true);
  });
  it("refuses an MDC when the day-to-day spread is unknown", () => {
    expect(NoiseFloorEntry.safeParse({ ...entry, se: 1, mdc: 2.7 }).success).toBe(false);
  });
  it("refuses an MDC of zero", () => {
    expect(
      NoiseFloorEntry.safeParse({ ...entry, sD: 0, sDSource: "estimated", se: 0, mdc: 0 }).success,
    ).toBe(false);
  });
});
