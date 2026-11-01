import { deflateSync } from "node:zlib";

/**
 * A synthetic stand-in for a try-on preview in mock mode: the neutral mat, with a plain oval in the
 * colour the shade was rendered in. It is not a face and it is not a render, and the screens that
 * show it say "sample results" (D25). Written by hand (PNG is a few chunks) so mock mode needs no
 * image library.
 */
const CRC = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

const rgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

/** The neutral mat of the design system (docs/DESIGN_SYSTEM.md): a grey of lightness near 50. */
export const MAT_HEX = "#777777";

export function placeholderPng(options: {
  width?: number;
  height?: number;
  hex: string;
}): Uint8Array {
  const width = options.width ?? 480;
  const height = options.height ?? 600;
  const mat = rgb(MAT_HEX);
  const oval = rgb(/^#[0-9A-Fa-f]{6}$/.test(options.hex) ? options.hex : MAT_HEX);
  const raw = new Uint8Array((width * 3 + 1) * height);
  const cx = width / 2;
  const cy = height * 0.45;
  const rx = width * 0.3;
  const ry = height * 0.28;
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const inside = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
      const px = inside ? oval : mat;
      raw.set(px, row + 1 + x * 3);
    }
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit, RGB, no interlace
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
