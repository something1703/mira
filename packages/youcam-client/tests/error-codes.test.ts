// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { mapTaskError } from "../src";

/**
 * Audit over the saved OpenAPI bundles (docs/YOUCAM_API.md §4): every error code documented for a
 * feature MIRA calls must map to a specific, actionable code. A code that falls through to the
 * generic "could not measure" is a gap in the table, not an acceptable default. Feature-specific
 * codes appear only in each bundle's prose, so this reads both the schema enums and the prose.
 */
const DIR = join(import.meta.dirname, "../openapi");

/** The bundle behind each feature MIRA calls (src/features.ts). */
const BUNDLES = [
  "ai_skin_analysis",
  "ai_skin_tone_analysis",
  "ai_fitzpatrick_skin_type",
  "ai_face_analyzer",
  "ai_hair_type_detection",
  "ai_hair_density_detection",
  "ai_hair_length_detection",
  "ai_hair_frizziness_detection",
  "ai_skin_simulation",
  "makeup_vto",
  "ai_clothes",
  "ai_hair_color",
  "ai_photo_background_change",
  "ai_video_generator",
  "ai_background_removal",
] as const;

/** Words that look like codes in the prose but are field names. */
const NOT_CODES = new Set(["error_code", "error_message"]);

/**
 * Documented codes that are deliberately generic, with why. Empty on purpose: the point of the
 * audit is that nothing used by MIRA is left to the fallback.
 */
const ALLOWED_GENERIC: Record<string, string> = {};

function codesIn(bundle: string): Set<string> {
  const doc = parse(readFileSync(join(DIR, `${bundle}.yaml`), "utf8")) as Record<string, unknown>;
  const found = new Set<string>();

  /** Follows a local `$ref` such as `#/components/schemas/EngineErrorCode`. */
  const deref = (node: unknown): unknown => {
    if (node !== null && typeof node === "object" && "$ref" in node) {
      const ref = node.$ref;
      if (typeof ref === "string" && ref.startsWith("#/")) {
        let cur: unknown = doc;
        for (const part of ref.slice(2).split("/"))
          cur = (cur as Record<string, unknown> | undefined)?.[part];
        return deref(cur);
      }
    }
    return node;
  };

  const seen = new Set<unknown>();
  const walk = (raw: unknown): void => {
    if (raw === null || typeof raw !== "object" || seen.has(raw)) return;
    seen.add(raw);
    if (Array.isArray(raw)) {
      raw.forEach(walk);
      return;
    }
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (k === "error") {
        const resolved = deref(v);
        const list = (resolved as { enum?: unknown } | null)?.enum;
        if (Array.isArray(list)) for (const c of list) if (typeof c === "string") found.add(c);
      }
      walk(v);
    }
  };
  walk(doc);

  const desc = (doc.info as { description?: string } | undefined)?.description ?? "";
  for (const m of desc.matchAll(/`?(error_[a-z0-9_]+)`?/g)) if (m[1]) found.add(m[1]);
  // "Error Codes" tables: the first column of each row that follows the heading.
  const table = /Error Codes\s*\n([\s\S]*?)(?:\n\s*\n\s*(?:\*|#)|$)/.exec(desc)?.[1] ?? "";
  for (const row of table.split("\n")) {
    const cell = /^\s*\|\s*`?([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`?\s*\|/.exec(row)?.[1];
    if (cell) found.add(cell);
  }
  return found;
}

describe("every documented error code for a feature MIRA calls is mapped", () => {
  it.each(BUNDLES)("%s", (bundle) => {
    const codes = [...codesIn(bundle)].filter((c) => !NOT_CODES.has(c));
    expect(codes.length, `no codes found in ${bundle}: the audit would be empty`).toBeGreaterThan(
      0,
    );
    const generic = codes.filter(
      (c) => mapTaskError(c).code === "could_not_measure" && !(c in ALLOWED_GENERIC),
    );
    expect(generic).toEqual([]);
  });

  it("the audit reads real codes (a sample from three bundles)", () => {
    // From a schema enum behind a $ref, from prose, and from an "Error Codes" table without the prefix.
    expect(codesIn("ai_skin_tone_analysis")).toContain("error_no_face");
    expect(codesIn("ai_clothes")).toContain("error_editing_failed");
    expect(codesIn("ai_photo_background_change")).toContain("exceed_max_filesize");
    expect(codesIn("ai_photo_background_change")).toContain(
      "size_mismatch_on_input_image_and_mask",
    );
  });

  it("the new mappings are specific, retakeable where the person can fix it", () => {
    expect(mapTaskError("error_face_pose")).toMatchObject({
      code: "face_obscured",
      guidance: "retake",
    });
    expect(mapTaskError("error_insufficient_landmarks")).toMatchObject({ code: "face_obscured" });
    expect(mapTaskError("error_no_shoulder")).toMatchObject({
      code: "shoulders_missing",
      guidance: "retake",
    });
    expect(mapTaskError("error_bald_image")).toMatchObject({ code: "hair_not_found" });
    expect(mapTaskError("error_hair_too_short")).toMatchObject({ code: "hair_not_found" });
    expect(mapTaskError("error_unsupport_ratio")).toMatchObject({
      code: "image_ratio",
      guidance: "retake",
    });
    expect(mapTaskError("error_invalid_src")).toMatchObject({ code: "image_unreadable" });
    expect(mapTaskError("error_invalid_params")).toMatchObject({
      code: "invalid_request",
      guidance: "contact_support",
    });
  });

  it("ordering does not let a broad rule swallow a specific one", () => {
    // `error_src_face_too_small` contains "face" and "small": it must stay a face-size problem.
    expect(mapTaskError("error_src_face_too_small").code).toBe("face_too_small");
    expect(mapTaskError("error_face_position_out_of_boundary").code).toBe("face_out_of_frame");
    expect(mapTaskError("error_face_not_forward_facing").code).toBe("face_angle");
  });
});
