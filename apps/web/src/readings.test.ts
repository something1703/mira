import { lintText, type Metric } from "@mira/schemas";
import { describe, expect, it } from "vitest";
import {
  DE_KEY,
  SKIN_SCORE_KEY,
  blendSentence,
  blendTitle,
  blendWord,
  meaningOf,
} from "./readings";

// meaningOf reads only the id, kind, value and unit.
const num = (id: string, value: number, unit = "raw score") =>
  ({ id, kind: "number", value, unit }) as unknown as Metric;

const T = { matchDe: 2, closeDe: 3.5 };

describe("blendWord", () => {
  it("follows the engine's lines, with under 1 as hard to see", () => {
    expect(blendWord(0.3, T)).toBe("unseen");
    expect(blendWord(1, T)).toBe("blends");
    expect(blendWord(2, T)).toBe("blends");
    expect(blendWord(2.06, T)).toBe("close");
    expect(blendWord(3.5, T)).toBe("close");
    expect(blendWord(3.51, T)).toBe("visible");
  });

  it("gives a title and a sentence for each", () => {
    expect(blendTitle(0.31, T)).toBe("Very hard to see");
    expect(blendSentence(3.07, T)).toMatch(/^Close:/);
  });
});

describe("meaningOf", () => {
  it("says what a skin reading looks at, HD or SD", () => {
    expect(meaningOf(num("skin.hd_pore.whole", 78))).toBe("How visible pores look.");
    expect(meaningOf(num("skin.oiliness", 57))).toBe("How much surface shine shows.");
  });

  it("puts face ratios into words with the measured value", () => {
    expect(meaningOf(num("face.face_aspect_ratio", 1.314, "ratio"))).toBe(
      "Your face measures 1.31 times as tall as it is wide.",
    );
  });

  it("has nothing to add for an unknown reading", () => {
    expect(meaningOf(num("skin.something_new", 50))).toBeUndefined();
  });
});

describe("the words pass the claim linter", () => {
  it("has no banned language", () => {
    const all = [
      SKIN_SCORE_KEY,
      DE_KEY,
      ...[0.5, 1.5, 3, 5].flatMap((d) => [blendSentence(d, T), blendTitle(d, T)]),
    ].join("\n");
    expect(lintText(all)).toEqual([]);
  });
});
