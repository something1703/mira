import { z } from "zod";
import { MetricId, MetricStore } from "./metrics";
import { UserId } from "./ids";

/**
 * The measured profile (docs/DATA_MODEL.md §1, `twins/{userId}`). Numbers only: no image, no URL
 * and no face data other than ratios ever lives here (docs/SECURITY_PRIVACY.md §1).
 */

/** The groups the profile screen shows (docs/UX_FLOWS.md §4). */
export const TwinGroupName = z.enum(["skin", "colouring", "face", "hair"]);
export type TwinGroupName = z.infer<typeof TwinGroupName>;

export const TwinGuidance = z.enum(["retake", "retry", "other_garment", "contact_support", "none"]);

/** A reading a group should have but does not, with why and what to do (docs/UX_FLOWS.md §4). */
export const MissingReading = z.object({
  /** Which reading: `skin`, `colour`, `skin_tone_band`, `proportions`, `hair_type`, ... */
  reading: z.string().min(1),
  /** The mapped failure code (`face_too_small`, `over_cap`, `not_captured`, ...). */
  reason: z.string().min(1),
  guidance: TwinGuidance.optional(),
});
export type MissingReading = z.infer<typeof MissingReading>;

/**
 * Whether a group was measured. `partial` means some readings exist and some do not, so the
 * screen shows what there is and "Not measured" beside the rest, each with its reason and a retry.
 */
export const TwinGroup = z.object({
  status: z.enum(["measured", "partial", "not_measured"]),
  missing: z.array(MissingReading).default([]),
  at: z.iso.datetime(),
});
export type TwinGroup = z.infer<typeof TwinGroup>;

/**
 * One concern's day-to-day variation (docs/ENGINES.md §8). From a single session only `sW`, the
 * variation between captures taken seconds apart, is known; `sD` needs three sessions on
 * different days (D16). Until then `mdc` is null and the UI does not call it a noise floor.
 */
export const NoiseFloorEntry = z.object({
  sessions: z.number().int().positive(),
  capturesPerSession: z.number().int().min(2),
  sW: z.number().nonnegative(),
  sD: z.number().nonnegative().nullable(),
  sDSource: z.enum(["estimated", "prior", "unknown"]),
  se: z.number().nonnegative().nullable(),
  mdc: z.number().nonnegative().nullable(),
});
export type NoiseFloorEntry = z.infer<typeof NoiseFloorEntry>;

export const CaptureMeta = z.object({
  /** HD when the HD skin analysis was possible, else standard detail (docs/UX_FLOWS.md §3). */
  mode: z.enum(["hd", "sd"]),
  source: z.enum(["camera", "upload"]),
  /** Face captures beyond the first that fed the same-session estimate (0, or 2). */
  repeatsCaptured: z.number().int().min(0),
  /** Did every Camera Kit quality check hold at capture? Null for an upload, which has none. */
  qualityChecksPassed: z.boolean().nullable(),
});
export type CaptureMeta = z.infer<typeof CaptureMeta>;

export const Twin = z.object({
  userId: UserId,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  metrics: MetricStore,
  groups: z.object({
    skin: TwinGroup,
    colouring: TwinGroup,
    face: TwinGroup,
    hair: TwinGroup,
  }),
  /** Face Attributes ratio vectors by name, kept for identity drift (docs/ENGINES.md §7.3). */
  faceRatios: z.record(z.string(), z.array(z.number())).default({}),
  /** By metric id, e.g. `skin.hd_pore.whole`. Empty without repeat captures. */
  noiseFloors: z.record(z.string(), NoiseFloorEntry).default({}),
  captureMeta: CaptureMeta,
  /** The runs that built this profile. Ids only: the runs and their images are long gone. */
  runIds: z.array(z.string()).default([]),
  /**
   * True when the numbers came from a test double, not from YouCam. The screen must say so and
   * never present them as the person's measurements (docs/DECISIONS.md D25).
   */
  synthetic: z.boolean(),
});
export type Twin = z.infer<typeof Twin>;

// ---------------------------------------------------------------------------------------------
// Metric IDs for the profile. One place decides every name, so a reading is always found under
// the same id by the screen, the agent and the engines (docs/AGENT_RUNTIME.md §4).
// ---------------------------------------------------------------------------------------------

/** `horizontalThird` and `Dark Circle (V2)` become `horizontal_third` and `dark_circle_v2`. */
const slug = (s: string): string =>
  s
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

/** `skin.hd_pore.forehead`; a concern with no sub-region is `.whole`. */
export function skinMetricId(type: string, region?: string): MetricId {
  return MetricId.parse(`skin.${slug(type)}.${slug(region ?? "whole")}`);
}

export const COLOUR_PARTS = ["skin", "lip", "eyebrow", "eye", "hair"] as const;
export type ColourPart = (typeof COLOUR_PARTS)[number];
export const colourMetricId = (part: ColourPart): MetricId => MetricId.parse(`colour.${part}`);

export const METRIC = {
  /** ITA°, a colour descriptor of the measured skin (docs/ENGINES.md §3). */
  ita: MetricId.parse("colour.skin_ita"),
  itaBand: MetricId.parse("colour.skin_ita_band"),
  eyeName: MetricId.parse("colour.eye_name"),
  hairName: MetricId.parse("colour.hair_name"),
  fitzpatrick: MetricId.parse("colour.fitzpatrick_band"),
  hairType: MetricId.parse("hair.type"),
  hairDensity: MetricId.parse("hair.density"),
  hairLength: MetricId.parse("hair.length"),
  hairFrizz: MetricId.parse("hair.frizziness"),
} as const;

/** `face.horizontal_third.1`, `face.face_aspect_ratio.1`: one metric per element of a ratio vector. */
export function faceMetricId(name: string, index: number): MetricId {
  return MetricId.parse(`face.${slug(name)}.${String(index + 1)}`);
}

/** Which profile group a metric belongs to, from its id. */
export function groupOf(id: string): TwinGroupName {
  if (id.startsWith("skin.")) return "skin";
  if (id.startsWith("colour.")) return "colouring";
  if (id.startsWith("face.")) return "face";
  if (id.startsWith("hair.")) return "hair";
  throw new Error(`Metric ${id} belongs to no profile group`);
}

// ---------------------------------------------------------------------------------------------
// Privacy: what is stored about a person, and what was deleted (docs/UX_FLOWS.md §11).
// ---------------------------------------------------------------------------------------------

/**
 * What a deletion removed, kept afterwards as counts only (never the values), so the privacy screen
 * can say "deleted on 1 Nov: 31 readings, 2 saved looks" and prove it happened.
 */
export const DeletionRecord = z.object({
  id: z.string().min(1),
  at: z.iso.datetime(),
  removed: z.object({
    readings: z.number().int().nonnegative(),
    proofs: z.number().int().nonnegative(),
    savedLooks: z.number().int().nonnegative(),
    savedImages: z.number().int().nonnegative(),
    uploads: z.number().int().nonnegative(),
    runs: z.number().int().nonnegative(),
    cachedResults: z.number().int().nonnegative(),
  }),
});
export type DeletionRecord = z.infer<typeof DeletionRecord>;
