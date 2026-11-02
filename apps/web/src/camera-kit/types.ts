import { z } from "zod";

/**
 * The parts of YouCam's JS Camera Kit that MIRA uses (docs/YOUCAM_API.md §5). The SDK is loaded
 * from YouCam's server at run time, so what it sends is untrusted: every event payload is parsed
 * here before anything reads it.
 */

export { CAMERA_KIT_SDK_URL as SDK_URL } from "@mira/youcam-client/camera-kit";
/** The element the SDK renders into. Its id is fixed by the SDK. */
export const MOUNT_ID = "YMK-module";

export const FaceQuality = z
  .object({
    hasFace: z.boolean().optional(),
    /** The docs' sample code calls this `area`; the event key is `position`. */
    position: z.enum(["good", "notgood", "toosmall", "outofboundary"]).optional(),
    frontal: z.enum(["good", "notgood"]).optional(),
    lighting: z.enum(["good", "ok", "notgood"]).optional(),
  })
  .loose();
export type FaceQuality = z.infer<typeof FaceQuality>;

export const CapturedImage = z
  .object({
    phase: z.string().optional(),
    /** A Blob, a data URL or bare base64, depending on `imageFormat` (see `imageToBlob`). */
    image: z.union([z.instanceof(Blob), z.string().min(1)]),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .loose();
export type CapturedImage = z.infer<typeof CapturedImage>;

export const Captured = z
  .object({ mode: z.string().optional(), images: z.array(CapturedImage).min(1) })
  .loose();
export type Captured = z.infer<typeof Captured>;

export type CameraFailure = "permission_denied" | "resolution_unsupported" | "access_failed";

/** `cameraFailed` carries one of the SDK's error strings; anything unknown is a generic failure. */
export function cameraFailure(payload: unknown): CameraFailure {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload ?? "");
  if (/permission_denied|NotAllowed/i.test(text)) return "permission_denied";
  if (/resolution_unsupported|OverconstrainedError/i.test(text)) return "resolution_unsupported";
  return "access_failed";
}

export type FaceDetectionMode = "comprehensive" | "hdskincare" | "hairtype";

export interface InitArgs {
  faceDetectionMode: FaceDetectionMode;
  imageFormat: "blob" | "base64";
  qualityLevel: "relaxed" | "moderate" | "strict";
  /** `hdskincare` only; the SDK ignores it elsewhere. */
  videoQuality?: "720p" | "1080p" | "1920p";
  /** Size of the view the SDK draws, 300–1920 px each (docs/YOUCAM_API.md §5). */
  width?: number;
  height?: number;
  language?: string;
  /** Milliseconds the face must hold still before the SDK takes the photo. */
  countingDuration?: number;
}

export interface YmkApi {
  init(args: InitArgs): void;
  openCameraKit(): void;
  close(): void;
  pause?(): void;
  resume?(): void;
  addEventListener(name: string, listener: (payload: unknown) => void): void;
  removeEventListener(name: string, listener: (payload: unknown) => void): void;
}

declare global {
  interface Window {
    YMK?: YmkApi;
    YMKAsyncInit?: () => void;
  }
}

/** A Blob from whichever form the SDK handed over. */
export function imageToBlob(image: Blob | string): Blob | undefined {
  if (image instanceof Blob) return image;
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(image);
  const type = m?.[1] ?? "image/jpeg";
  const b64 = m ? (m[2] ? m[3] : undefined) : image;
  if (b64 === undefined) return undefined;
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type });
  } catch {
    return undefined;
  }
}
