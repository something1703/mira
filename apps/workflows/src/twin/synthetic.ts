import type { FakeYouCam } from "@mira/youcam-client/testing";
import { concernsFor } from "./extract";

/**
 * Synthetic analyser answers for mock mode, shaped like the documented results (docs/YOUCAM_API.md
 * §2). They are invented numbers for a person who does not exist, never a measurement: a profile
 * built from them is stored with `synthetic: true` and the screen says so (D25).
 */
/** What the synthetic person's colours read as. Invented, and the same every time. */
export const SYNTHETIC_TONE = {
  color: {
    skin_color: "#C79A78",
    lip_color: "#A5504F",
    eyebrow_color: "#3A2A20",
    eye_color: "#4A3326",
    eye_color_name: "brown",
    hair_color: "#42280E",
    hair_color_name: "dark brown",
  },
} as const;

export function seedTwinFake(fake: FakeYouCam): void {
  const scores = [38, 44, 52, 29, 47, 33, 41, 58];
  fake
    .respondWith("skin-analysis", {
      latencyMs: 6_000,
      results: {
        output: concernsFor("hd").map((type, i) => ({
          type,
          raw_score: scores[i % scores.length],
          ui_score: 50,
        })),
      },
    })
    .respondWith("skin-tone-analysis", { latencyMs: 4_000, results: SYNTHETIC_TONE })
    .respondWith("fitzpatrick-scale-analyzer", {
      latencyMs: 2_500,
      results: { fitzpatrick_scale: "III" },
    })
    .respondWith("face-attr-analysis", {
      latencyMs: 5_500,
      results: {
        facialratio: {
          face_aspect_ratio: [1.31],
          horizontal_third: [0.33, 0.34, 0.33],
          vertical_fifth: [0.19, 0.21, 0.2, 0.21, 0.19],
          eye_aspect_ratio: [0.38, 0.37],
          nose_width_to_mouth_width: [0.71],
        },
      },
    })
    .respondWith("hair-density-detection", {
      latencyMs: 2_000,
      results: { hair_density: { mapping: "2", term: "medium" } },
    })
    .respondWith("hair-length-detection", {
      latencyMs: 2_000,
      results: { hair_length: { term: "shoulder" } },
    })
    .respondWith("hair-type-detection", {
      latencyMs: 3_000,
      results: { hair_type: { mapping: "3", term: "wavy" } },
    })
    .respondWith("hair-frizziness-detection", {
      latencyMs: 3_000,
      results: { hair_frizziness: { mapping: "1", term: "low" } },
    });
}
