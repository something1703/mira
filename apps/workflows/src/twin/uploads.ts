import { CONFIG } from "@mira/schemas";
import { readImageInfo, type ImageInfo } from "./image-info";

/**
 * The checks every upload gets on the server (phases/PHASE_05, "same quality checks run
 * server-side"). They cover what a header can tell: the file is a JPEG or PNG, it is not too big,
 * and it is sharp enough in pixels for the detail level asked for. Whether a face is in it, big
 * enough, lit and facing the camera is YouCam's check, and its quality errors cost no units
 * (docs/YOUCAM_API.md §3); MIRA maps those to the same guidance the camera path shows.
 */
export const UPLOAD_LIMITS = {
  maxBytes: 10 * 1024 * 1024,
  /** Short side in pixels: standard detail needs 480, HD 1080 (docs/YOUCAM_API.md §3). */
  minShortSideSd: 480,
  minShortSideHd: 1080,
  /** Uploads held for one person at once, so a loop cannot fill storage. */
  maxHeld: 12,
} as const;

export type UploadError =
  | { code: "empty" }
  | { code: "too_large"; maxBytes: number }
  | { code: "unsupported_type" }
  | { code: "below_min_size"; shortSide: number; minShortSide: number };

export interface CheckedUpload {
  info: ImageInfo;
  bytes: number;
  /** True when the short side is enough for HD skin analysis. */
  hdCapable: boolean;
}

export function checkUpload(
  bytes: Uint8Array,
): { ok: true; value: CheckedUpload } | { ok: false; error: UploadError } {
  if (bytes.length === 0) return { ok: false, error: { code: "empty" } };
  if (bytes.length > UPLOAD_LIMITS.maxBytes) {
    return { ok: false, error: { code: "too_large", maxBytes: UPLOAD_LIMITS.maxBytes } };
  }
  const info = readImageInfo(bytes);
  if (info === undefined) return { ok: false, error: { code: "unsupported_type" } };
  const shortSide = Math.min(info.width, info.height);
  if (shortSide < UPLOAD_LIMITS.minShortSideSd) {
    return {
      ok: false,
      error: { code: "below_min_size", shortSide, minShortSide: UPLOAD_LIMITS.minShortSideSd },
    };
  }
  return {
    ok: true,
    value: { info, bytes: bytes.length, hdCapable: shortSide >= UPLOAD_LIMITS.minShortSideHd },
  };
}

/** Face width as a share of the image, below which YouCam refuses a skin analysis. */
export const MIN_FACE_WIDTH_SHARE = CONFIG.twin.minFaceWidthShare.value;
