import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { MAT_HEX, placeholderPng } from "../src";

/** Reads a pixel back out of the PNG, so the test checks the picture and not just the bytes. */
function pixel(png: Uint8Array, x: number, y: number): [number, number, number] {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const width = view.getUint32(16);
  let at = 8;
  const idat: Uint8Array[] = [];
  while (at < png.length) {
    const len = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    if (type === "IDAT") idat.push(png.subarray(at + 8, at + 8 + len));
    at += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const row = y * (width * 3 + 1);
  const i = row + 1 + x * 3;
  return [raw[i] ?? 0, raw[i + 1] ?? 0, raw[i + 2] ?? 0];
}

describe("placeholderPng", () => {
  const png = placeholderPng({ width: 100, height: 120, hex: "#C79A78" });

  it("is a PNG of the size asked for", () => {
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const view = new DataView(png.buffer, png.byteOffset);
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([100, 120]);
  });

  it("shows the shade's colour in the oval on a neutral mat", () => {
    expect(pixel(png, 50, 54)).toEqual([0xc7, 0x9a, 0x78]);
    expect(pixel(png, 2, 2)).toEqual([0x77, 0x77, 0x77]);
    expect(MAT_HEX).toBe("#777777");
  });

  it("a colour that is not a hex gives the mat, never a thrown error", () => {
    expect(pixel(placeholderPng({ width: 20, height: 20, hex: "red" }), 10, 9)).toEqual([
      0x77, 0x77, 0x77,
    ]);
  });

  it("is deterministic", () => {
    expect([...placeholderPng({ hex: "#112233" })]).toEqual([
      ...placeholderPng({ hex: "#112233" }),
    ]);
  });
});
