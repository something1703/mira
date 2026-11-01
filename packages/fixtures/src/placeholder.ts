import { deflateSync, inflateSync } from "node:zlib";

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

type Rgb = [number, number, number];

/** Encodes a picture from a function that gives each pixel's colour. */
function encode(width: number, height: number, pixel: (x: number, y: number) => Rgb): Uint8Array {
  const raw = new Uint8Array((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < width; x++) raw.set(pixel(x, y), row + 1 + x * 3);
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

const hexOrMat = (hex: string): Rgb => rgb(/^#[0-9A-Fa-f]{6}$/.test(hex) ? hex : MAT_HEX);

export function placeholderPng(options: {
  width?: number;
  height?: number;
  hex: string;
}): Uint8Array {
  const width = options.width ?? 480;
  const height = options.height ?? 600;
  const mat = rgb(MAT_HEX);
  const oval = hexOrMat(options.hex);
  const cx = width / 2;
  const cy = height * 0.45;
  const rx = width * 0.3;
  const ry = height * 0.28;
  return encode(width, height, (x, y) =>
    ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1 ? oval : mat,
  );
}

/**
 * The oval colour of a `placeholderPng`, read back from the picture. Mock mode uses it to learn
 * what colour a garment picture stands for. It reads only pictures this file wrote.
 */
export function placeholderHex(png: Uint8Array): string | undefined {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  if (png.byteLength < 33 || view.getUint32(12) !== 0x49484452) return undefined;
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  let at = 8;
  const idat: Uint8Array[] = [];
  while (at + 8 <= png.byteLength) {
    const len = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    if (type === "IDAT") idat.push(png.subarray(at + 8, at + 8 + len));
    at += 12 + len;
  }
  try {
    const raw = inflateSync(Buffer.concat(idat));
    const x = Math.floor(width / 2);
    const y = Math.floor(height * 0.45);
    const i = y * (width * 3 + 1) + 1 + x * 3;
    const px = [raw[i], raw[i + 1], raw[i + 2]];
    if (px.some((v) => v === undefined)) return undefined;
    return `#${px.map((v) => (v ?? 0).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
  } catch {
    return undefined;
  }
}

export interface Scene {
  width?: number;
  height?: number;
  skin: string;
  /** The torso: a plain neutral top unless a garment colour is given. */
  garment?: string;
  /** A small mark on the face for the lip colour; the natural lip colour when absent. */
  lip?: string;
  hair?: string;
  /** A backdrop colour; the neutral mat when absent. */
  backdrop?: string;
}

const PLAIN_TOP = "#D8D8D8";

/** Where the face is in a `scenePng`, as a pixel box (for the audits that need one). */
export function sceneFaceBox(width = 480, height = 640) {
  return {
    x: Math.round(width * 0.35),
    y: Math.round(height * 0.08),
    width: Math.round(width * 0.3),
    height: Math.round(height * 0.24),
  };
}

/**
 * A synthetic full-length picture for mock mode: a backdrop, a face in the person's skin colour
 * with a lip mark, hair above it, and a torso. It is not a person and not a render; the screens
 * that show it say "sample results" (D25).
 */
export function scenePng(scene: Scene): Uint8Array {
  const width = scene.width ?? 480;
  const height = scene.height ?? 640;
  const back = hexOrMat(scene.backdrop ?? MAT_HEX);
  const skin = hexOrMat(scene.skin);
  const top = hexOrMat(scene.garment ?? PLAIN_TOP);
  const lip = hexOrMat(scene.lip ?? scene.skin);
  const hair = hexOrMat(scene.hair ?? "#2B1D14");
  const f = sceneFaceBox(width, height);
  const fx = f.x + f.width / 2;
  const fy = f.y + f.height / 2;
  const rx = f.width / 2;
  const ry = f.height / 2;
  // The torso is the region the garment audit looks at (docs/ENGINES.md §7.1 step 2).
  const t0 = f.y + f.height + 0.4 * f.height;
  const t1 = f.y + f.height + 2.0 * f.height;
  const tx0 = fx - 1.2 * f.width;
  const tx1 = fx + 1.2 * f.width;
  return encode(width, height, (x, y) => {
    const inFace = ((x - fx) / rx) ** 2 + ((y - fy) / ry) ** 2 <= 1;
    if (inFace) {
      const lipMark = Math.abs(x - fx) < rx * 0.35 && Math.abs(y - (fy + ry * 0.55)) < ry * 0.08;
      if (lipMark) return lip;
      return y < f.y + f.height * 0.18 ? hair : skin;
    }
    if (x >= tx0 && x <= tx1 && y >= t0 && y <= t1) return top;
    return back;
  });
}

/** A cut-out picture (RGBA): an oval in `hex` on a fully transparent background. Mock mode only. */
export function cutoutPng(options: { width?: number; height?: number; hex: string }): Uint8Array {
  const width = options.width ?? 240;
  const height = options.height ?? 300;
  const colour = hexOrMat(options.hex);
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    for (let x = 0; x < width; x++) {
      const inside =
        ((x - width / 2) / (width * 0.4)) ** 2 + ((y - height / 2) / (height * 0.4)) ** 2 <= 1;
      raw.set([...colour, inside ? 255 : 0], row + 1 + x * 4);
    }
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit, RGBA
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
