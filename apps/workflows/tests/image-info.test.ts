import { describe, expect, it } from "vitest";
import { readImageInfo } from "../src/twin/image-info";

const sof = (marker: number, w: number, h: number) => [
  0xff,
  marker,
  0x00,
  0x11,
  0x08,
  h >> 8,
  h & 255,
  w >> 8,
  w & 255,
  3,
  1,
  0x22,
  0,
  2,
  0x11,
  1,
  3,
  0x11,
  1,
];

describe("readImageInfo", () => {
  it("reads baseline and progressive JPEGs, skipping other segments", () => {
    const app = [0xff, 0xe1, 0x00, 0x06, 1, 2, 3, 4];
    expect(readImageInfo(Uint8Array.from([0xff, 0xd8, ...app, ...sof(0xc0, 1080, 1920)]))).toEqual({
      type: "image/jpeg",
      width: 1080,
      height: 1920,
    });
    expect(readImageInfo(Uint8Array.from([0xff, 0xd8, ...app, ...sof(0xc2, 640, 480)]))).toEqual({
      type: "image/jpeg",
      width: 640,
      height: 480,
    });
  });

  it("does not mistake the Huffman table marker for a frame", () => {
    const dht = [0xff, 0xc4, 0x00, 0x04, 0, 0];
    expect(
      readImageInfo(Uint8Array.from([0xff, 0xd8, ...dht, ...sof(0xc0, 500, 600)])),
    ).toMatchObject({ width: 500, height: 600 });
  });

  it("tolerates fill bytes before a marker", () => {
    expect(
      readImageInfo(
        Uint8Array.from([0xff, 0xd8, 0xff, 0xff, 0xff, ...sof(0xc0, 700, 900).slice(1)]),
      ),
    ).toMatchObject({ width: 700 });
  });

  it("reads a PNG's IHDR", () => {
    const b = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 4,
      56, 0, 0, 7, 128,
    ]);
    expect(readImageInfo(b)).toEqual({ type: "image/png", width: 1080, height: 1920 });
  });

  it("returns undefined for anything else, including truncated and zero-sized files", () => {
    for (const bad of [
      [],
      [1, 2, 3],
      [0xff, 0xd8],
      [0xff, 0xd8, 0xff, 0xc0, 0, 17, 8],
      [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
    ]) {
      expect(readImageInfo(Uint8Array.from(bad))).toBeUndefined();
    }
    expect(readImageInfo(Uint8Array.from([0xff, 0xd8, ...sof(0xc0, 0, 100)]))).toBeUndefined();
  });
});
