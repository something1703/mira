import { describe, expect, it } from "vitest";
import { distance, hexToLab } from "./colour-ref";
import { loadCatalogues } from "../src";

describe("shade catalogues", () => {
  const ranges = loadCatalogues();

  it("every file is a valid range, unique by id, and the invented ones say so", () => {
    expect(ranges.length).toBeGreaterThanOrEqual(2);
    expect(new Set(ranges.map((r) => r.id)).size).toBe(ranges.length);
    for (const r of ranges) {
      expect(r.source).toEqual({ kind: "catalogue", catalogueId: r.id });
      expect(new Set(r.shades.map((s) => s.id)).size).toBe(r.shades.length);
      // Nothing here has a real brand's name unless it was read from that brand's page.
      if (r.sample) expect(r.brand).toBe("Sample brand");
    }
  });

  it("shades run from light to deep, so a match exists for most skin", () => {
    for (const r of ranges) {
      const lightness = r.shades.map((s) => hexToLab(s.hex)[0]);
      expect(lightness).toEqual([...lightness].sort((a, b) => b - a));
      expect(lightness[0]).toBeGreaterThan(80);
      expect(lightness.at(-1)).toBeLessThan(35);
      // Neighbours differ visibly but not wildly.
      for (let i = 1; i < r.shades.length; i++) {
        const a = hexToLab(r.shades[i - 1]?.hex ?? "#000000");
        const b = hexToLab(r.shades[i]?.hex ?? "#000000");
        const de = distance(a, b);
        expect(de).toBeGreaterThan(1);
        expect(de).toBeLessThan(8);
      }
    }
  });
});
