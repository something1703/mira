// Written from the OpenAPI bundles downloaded 2026-11-01 (docs v1.17; see openapi/SOURCES.md).
import { z } from "zod";

/**
 * Result shapes per feature, from each bundle's "Inputs & Outputs" prose (docs/YOUCAM_API.md §2).
 * They accept extra fields (`.loose()`): YouCam adds fields without a version bump, and a new
 * field must never fail a measurement. Required fields are the ones MIRA reads.
 */

export const UrlResult = z.object({ url: z.url() }).loose();
export type UrlResult = z.infer<typeof UrlResult>;

export const SkinAnalysisItem = z
  .object({
    type: z.string(),
    region: z.string().optional(),
    /** 1–100 float. MIRA's statistics use this, never `ui_score` (D6). */
    raw_score: z.number().optional(),
    ui_score: z.number().optional(),
    score: z.number().optional(),
    mask_urls: z.array(z.string()).optional(),
  })
  .loose();
export const SkinAnalysisResult = z.object({ output: z.array(SkinAnalysisItem) }).loose();
export type SkinAnalysisResult = z.infer<typeof SkinAnalysisResult>;

export const FaceQuality = z
  .object({
    has_face: z.boolean().optional(),
    area: z.string().optional(),
    frontal: z.string().optional(),
    lighting: z.string().optional(),
    faceangle: z.string().optional(),
  })
  .loose();

/** Colours are hex only: no Lab, no undertone (docs/FACTS.md F10). */
export const SkinToneResult = z
  .object({
    face_quality: FaceQuality.optional(),
    color: z
      .object({
        skin_color: z.string().optional(),
        lip_color: z.string().optional(),
        eyebrow_color: z.string().optional(),
        eye_color: z.string().optional(),
        eye_color_name: z.string().optional(),
        /** One of 7 fixed values. */
        hair_color: z.string().optional(),
        hair_color_name: z.string().optional(),
      })
      .loose(),
  })
  .loose();
export type SkinToneResult = z.infer<typeof SkinToneResult>;

export const FitzpatrickResult = z
  .object({ fitzpatrick_scale: z.enum(["I", "II", "III", "IV", "V", "VI"]) })
  .loose();

export const FaceAttrResult = z
  .object({
    face_quality: FaceQuality.optional(),
    facialratio: z.record(z.string(), z.array(z.number())).optional(),
    agegender: z
      .object({ age: z.number().optional(), gender: z.string().optional() })
      .loose()
      .optional(),
  })
  .loose();
export type FaceAttrResult = z.infer<typeof FaceAttrResult>;

export const HairTypeResult = z
  .object({ hair_type: z.object({ mapping: z.string(), term: z.string().optional() }).loose() })
  .loose();
export const HairDensityResult = z
  .object({ hair_density: z.object({ mapping: z.string(), term: z.string().optional() }).loose() })
  .loose();
export const HairLengthResult = z
  .object({ hair_length: z.object({ term: z.string() }).loose() })
  .loose();
export const HairFrizzResult = z
  .object({
    hair_frizziness: z.object({ mapping: z.string(), term: z.string().optional() }).loose(),
  })
  .loose();
