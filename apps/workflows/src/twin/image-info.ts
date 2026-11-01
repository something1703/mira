/**
 * Reads the type and pixel size of a JPEG or PNG from its header, without decoding the picture.
 * YouCam accepts JPEG and PNG only (docs/YOUCAM_API.md §3), so anything else is refused here
 * rather than after an upload and a wasted round trip. The file is never decoded or kept in
 * memory beyond the request.
 */
export interface ImageInfo {
  type: "image/jpeg" | "image/png";
  width: number;
  height: number;
}

const be32 = (b: Uint8Array, i: number) =>
  (b[i] ?? 0) * 0x1000000 + (((b[i + 1] ?? 0) << 16) | ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0));
const be16 = (b: Uint8Array, i: number) => ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0);

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function readImageInfo(bytes: Uint8Array): ImageInfo | undefined {
  if (PNG_MAGIC.every((v, i) => bytes[i] === v)) {
    // 8-byte signature, then the IHDR chunk: length(4) "IHDR"(4) width(4) height(4).
    if (bytes.length < 24 || String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR")
      return undefined;
    const width = be32(bytes, 16);
    const height = be32(bytes, 20);
    return width > 0 && height > 0 ? { type: "image/png", width, height } : undefined;
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return readJpeg(bytes);
  return undefined;
}

function readJpeg(bytes: Uint8Array): ImageInfo | undefined {
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return undefined;
    let marker = bytes[i + 1] ?? 0;
    // Fill bytes: any number of 0xFF may precede a marker.
    while (marker === 0xff && i + 2 < bytes.length) {
      i += 1;
      marker = bytes[i + 1] ?? 0;
    }
    i += 2;
    // Standalone markers carry no length: SOI, EOI, RSTn, TEM.
    if (
      marker === 0xd8 ||
      marker === 0xd9 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      continue;
    }
    const length = be16(bytes, i);
    if (length < 2) return undefined;
    // Start-of-frame markers hold the size; C4 (DHT), C8 (JPG) and CC (DAC) share the range but do not.
    const isFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      if (i + 7 > bytes.length) return undefined;
      const height = be16(bytes, i + 3);
      const width = be16(bytes, i + 5);
      return width > 0 && height > 0 ? { type: "image/jpeg", width, height } : undefined;
    }
    i += length;
  }
  return undefined;
}
