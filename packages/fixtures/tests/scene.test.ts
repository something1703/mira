import { describe, expect, it } from "vitest";
import {
  loadLookCatalogue,
  loadSampleGarments,
  placeholderHex,
  placeholderPng,
  scenePng,
} from "../src";

describe("synthetic pictures", () => {
  it("reads back the colour a placeholder was made with", () => {
    expect(placeholderHex(placeholderPng({ hex: "#9E1F2D" }))).toBe("#9E1F2D");
  });

  it("returns nothing for bytes it did not write", () => {
    expect(placeholderHex(new Uint8Array([1, 2, 3]))).toBeUndefined();
  });

  it("draws a scene that differs only where the garment is", () => {
    const plain = scenePng({ skin: "#C79A78" });
    const dressed = scenePng({ skin: "#C79A78", garment: "#9E1F2D" });
    expect(plain.byteLength).toBeGreaterThan(100);
    expect(dressed).not.toEqual(plain);
    expect(scenePng({ skin: "#C79A78" })).toEqual(plain);
  });
});

describe("look samples", () => {
  it("are labelled samples and parse", () => {
    const c = loadLookCatalogue();
    expect(c.sample).toBe(true);
    expect(c.lips.length).toBeGreaterThan(3);
    const g = loadSampleGarments();
    expect(g.map((x) => x.kind).sort()).toEqual([
      "bag",
      "outfit",
      "outfit",
      "outfit",
      "outfit",
      "shoes",
    ]);
    expect(new Set(g.map((x) => x.id)).size).toBe(g.length);
    for (const x of g) expect(x.id).toMatch(/^gar_[a-z0-9]{6,64}$/);
  });
});

import { cutoutPng } from "../src";
describe("cut-outs", () => {
  it("encodes an RGBA picture", () => {
    const png = cutoutPng({ hex: "#9E1F2D" });
    expect(png.byteLength).toBeGreaterThan(100);
    expect(png[25]).toBe(6); // colour type RGBA
  });
});
