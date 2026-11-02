import { describe, expect, it } from "vitest";
import { mapHttpError, mapTaskError } from "../src";

describe("task errors (docs/YOUCAM_API.md §4)", () => {
  it.each([
    ["error_below_min_image_size", "image_too_small", "retake"],
    ["error_exceed_max_image_size", "image_too_large", "retake"],
    ["exceed_max_filesize", "image_too_large", "retake"],
    ["error_src_face_too_small", "face_too_small", "retake"],
    ["error_face_position_too_small", "face_too_small", "retake"],
    ["error_src_face_out_of_bound", "face_out_of_frame", "retake"],
    ["error_face_position_out_of_boundary", "face_out_of_frame", "retake"],
    ["error_face_position_invalid", "face_out_of_frame", "retake"],
    ["error_lighting_dark", "too_dark", "retake"],
    ["error_insufficient_lighting", "too_dark", "retake"],
    ["error_face_not_forward_facing", "face_angle", "retake"],
    ["error_face_angle_upward", "face_angle", "retake"],
    ["error_large_face_angle", "face_angle", "retake"],
    ["error_no_face", "no_face", "retake"],
    ["error_multiple_people", "multiple_people", "retake"],
    ["error_multi_person", "multiple_people", "retake"],
    ["error_nsfw_content_detected", "content_rejected", "retake"],
    ["exceed_nsfw_retry_limits", "content_rejected", "retake"],
    ["error_mismatch_image_size", "hair_photos_mismatch", "retake"],
    ["error_pose", "pose_unsupported", "retake"],
    ["error_invalid_ref", "garment_unreadable", "other_garment"],
    ["error_apply_region_mismatch", "garment_region", "other_garment"],
    ["OBJECT_DETECTION_FAIL", "object_not_found", "other_garment"],
    ["error_download_image", "image_unreadable", "retake"],
    ["error_decode_image", "image_unreadable", "retake"],
    ["invalid_parameter", "invalid_request", "contact_support"],
  ] as const)("%s → %s (%s)", (upstream, code, guidance) => {
    const e = mapTaskError(upstream);
    expect(e).toMatchObject({ kind: "task", code, guidance, upstream, unitsCharged: 0 });
  });

  it("transient engine failures are retryable; the 'too similar' failure is retryable too", () => {
    for (const code of [
      "error_inference",
      "unknown_internal_error",
      "error_upload",
      "error_editing_failed",
    ]) {
      expect(mapTaskError(code).retryable).toBe(true);
    }
    expect(mapTaskError("error_editing_failed").code).toBe("unchanged_result");
  });

  it("an unknown code becomes a generic failure and keeps the original", () => {
    expect(mapTaskError("error_brand_new_thing", "Boom")).toMatchObject({
      code: "could_not_measure",
      upstream: "error_brand_new_thing",
      message: "Boom",
      guidance: "retry",
    });
    expect(mapTaskError(null).upstream).toBe("unknown");
  });

  it("a face that is too small is not mistaken for a missing face", () => {
    expect(mapTaskError("error_src_face_too_small").code).toBe("face_too_small");
  });
});

describe("HTTP errors", () => {
  it("401 and the three key error codes are auth failures that never retry", () => {
    for (const body of [
      { error: "Invalid API key" },
      { error_code: "InvalidApiKey" },
      { error_code: "InactiveApiKey" },
      { error_code: "ExpiredApiKey" },
    ]) {
      expect(mapHttpError(401, body)).toMatchObject({ kind: "auth", retryable: false });
    }
    expect(mapHttpError(400, { error_code: "ExpiredApiKey" }).kind).toBe("auth");
  });

  it("429 is retryable rate limiting", () => {
    expect(mapHttpError(429, { error: "Too many requests" })).toMatchObject({
      kind: "rate_limited",
      retryable: true,
      status: 429,
    });
  });

  it("CreditInsufficiency never retries", () => {
    expect(
      mapHttpError(400, { error_code: "CreditInsufficiency", error: "no units" }),
    ).toMatchObject({
      kind: "insufficient_units",
      retryable: false,
    });
  });

  it("5xx and TaskTimeout are retryable; other 4xx keep YouCam's code", () => {
    expect(mapHttpError(500, { error_code: "TaskTimeout" })).toMatchObject({
      retryable: true,
      code: "youcam_unavailable",
    });
    expect(mapHttpError(400, { error_code: "InvalidParameters", error: "bad" })).toMatchObject({
      code: "InvalidParameters",
      retryable: false,
      unitsCharged: 0,
    });
    expect(mapHttpError(502, undefined).retryable).toBe(true);
  });
});
