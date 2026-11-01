/**
 * Every YouCam failure becomes one `YouCamError`. Failed tasks cost nothing (docs/YOUCAM_API.md
 * §1), so `unitsCharged` is always 0. Feature-specific codes appear only in each bundle's prose,
 * not in its schema enum, so the mapper accepts any string and keeps the original in `upstream`
 * (docs/YOUCAM_API.md §4).
 */
export type ErrorKind =
  | "task" // the engine ran and failed (HTTP 200, task_status "error")
  | "http" // a synchronous 4xx/5xx
  | "auth"
  | "rate_limited"
  | "insufficient_units"
  | "network"
  | "invalid_response"; // the body did not match the documented shape

/** What the UI should offer. Copy comes from docs/COPY.md by `code`. */
export type Guidance = "retake" | "retry" | "other_garment" | "contact_support" | "none";

export interface YouCamError {
  readonly kind: ErrorKind;
  /** MIRA's code, stable across YouCam wording, e.g. `face_too_small`. */
  readonly code: string;
  readonly message: string;
  readonly status?: number;
  /** YouCam's own code, kept for the run viewer and never shown raw to a person. */
  readonly upstream?: string;
  readonly retryable: boolean;
  readonly guidance: Guidance;
  readonly unitsCharged: 0;
}

interface Rule {
  readonly match: RegExp;
  readonly code: string;
  readonly retryable: boolean;
  readonly guidance: Guidance;
}

const r = (match: RegExp, code: string, guidance: Guidance, retryable = false): Rule => ({
  match,
  code,
  retryable,
  guidance,
});

/** Order matters: the first match wins. */
const TASK_RULES: readonly Rule[] = [
  r(/below_min_image_size/i, "image_too_small", "retake"),
  r(/exceed_max_image_size|exceed_max_filesize/i, "image_too_large", "retake"),
  r(/face_too_small|face_position_too_small/i, "face_too_small", "retake"),
  r(
    /face_out_of_bound|face_position_out_of_boundary|face_position_invalid/i,
    "face_out_of_frame",
    "retake",
  ),
  r(/lighting_dark|insufficient_lighting/i, "too_dark", "retake"),
  r(/not_forward_facing|face_angle|large_face_angle/i, "face_angle", "retake"),
  r(/no_face|face_parsing/i, "no_face", "retake"),
  r(/multiple_people|multi_person/i, "multiple_people", "retake"),
  r(/nsfw/i, "content_rejected", "retake"),
  r(/mismatch_image_size/i, "hair_photos_mismatch", "retake"),
  r(/editing_failed/i, "unchanged_result", "retry", true),
  r(/invalid_ref/i, "garment_unreadable", "other_garment"),
  r(/apply_region_mismatch/i, "garment_region", "other_garment"),
  r(/error_pose/i, "pose_unsupported", "retake"),
  r(/object_detection_fail/i, "object_not_found", "other_garment"),
  r(/download_image|decode_image|download_mask|decode_mask/i, "image_unreadable", "retake"),
  r(/invalid_parameter/i, "invalid_request", "contact_support"),
  r(/inference|unknown_internal_error|upload/i, "youcam_internal", "retry", true),
];

const GENERIC: Rule = r(/./, "could_not_measure", "retry");

export function mapTaskError(upstream: string | null | undefined, message?: string): YouCamError {
  const code = upstream ?? "unknown";
  const rule = TASK_RULES.find((x) => x.match.test(code)) ?? GENERIC;
  return {
    kind: "task",
    code: rule.code,
    message: message ?? code,
    upstream: code,
    retryable: rule.retryable,
    guidance: rule.guidance,
    unitsCharged: 0,
  };
}

interface HttpErrorBody {
  error?: unknown;
  error_code?: unknown;
  message?: unknown;
}

export function mapHttpError(status: number, body: unknown): YouCamError {
  const b: HttpErrorBody = typeof body === "object" && body !== null ? body : {};
  const upstream = [b.error_code, b.error].find((v): v is string => typeof v === "string");
  const message =
    typeof b.message === "string" ? b.message : (upstream ?? `HTTP ${String(status)}`);
  const base = {
    message,
    status,
    ...(upstream === undefined ? {} : { upstream }),
    unitsCharged: 0 as const,
  };
  if (
    status === 401 ||
    status === 403 ||
    /InvalidApiKey|InactiveApiKey|ExpiredApiKey/.test(upstream ?? "")
  ) {
    return {
      ...base,
      kind: "auth",
      code: "youcam_auth",
      retryable: false,
      guidance: "contact_support",
    };
  }
  if (status === 429) {
    return {
      ...base,
      kind: "rate_limited",
      code: "rate_limited",
      retryable: true,
      guidance: "retry",
    };
  }
  if (/CreditInsufficiency/.test(upstream ?? "")) {
    return {
      ...base,
      kind: "insufficient_units",
      code: "insufficient_units",
      retryable: false,
      guidance: "none",
    };
  }
  if (status >= 500) {
    return {
      ...base,
      kind: "http",
      code: "youcam_unavailable",
      retryable: true,
      guidance: "retry",
    };
  }
  return {
    ...base,
    kind: "http",
    code: upstream ?? "bad_request",
    retryable: false,
    guidance: "contact_support",
  };
}

/**
 * A failed PUT to the presigned upload URL. A 403 there means the URL expired or was rejected, not
 * that the API key is wrong; the remedy is to register the file again and upload once more.
 */
export const uploadError = (status: number): YouCamError => ({
  kind: "http",
  code: "upload_failed",
  message: `Upload to the presigned URL failed with HTTP ${String(status)}`,
  status,
  retryable: true,
  guidance: "retry",
  unitsCharged: 0,
});

export const networkError = (cause: unknown): YouCamError => ({
  kind: "network",
  code: "network",
  message: cause instanceof Error ? cause.message : "Network request failed",
  retryable: true,
  guidance: "retry",
  unitsCharged: 0,
});

export const invalidResponse = (what: string, detail: string): YouCamError => ({
  kind: "invalid_response",
  code: "invalid_response",
  message: `${what}: ${detail}`,
  retryable: false,
  guidance: "contact_support",
  unitsCharged: 0,
});
