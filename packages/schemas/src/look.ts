import { z } from "zod";
import { Hex, Lab } from "./metrics";

/**
 * Complete Look (docs/UX_FLOWS.md §6, docs/ARCHITECTURE.md §4.3): clothes, accessories, makeup and
 * hair rendered in one chain, each step audited, the whole checked for identity drift.
 */

export const GarmentKind = z.enum(["outfit", "shoes", "bag"]);
export type GarmentKind = z.infer<typeof GarmentKind>;

/** `cloth-v4`'s own garment categories (docs/YOUCAM_API.md §3), plus `shoes`. */
export const GarmentCategory = z.enum([
  "upper_body",
  "lower_body",
  "full_body",
  "outer",
  "auto",
  "shoes",
]);
export type GarmentCategory = z.infer<typeof GarmentCategory>;

export const GarmentColour = z.object({
  lab: Lab,
  hex: Hex,
  /** One Lab, or the top two clusters of a multicolour garment (docs/ENGINES.md §6). */
  auditLabs: z.array(Lab).min(1).max(2),
  multicolour: z.boolean(),
  /** Share of garment pixels in the main colour. */
  share: z.number().min(0).max(1),
});
export type GarmentColour = z.infer<typeof GarmentColour>;

/** A garment MIRA can try on: its reference picture and the colour measured from it. */
export const GarmentItem = z.object({
  id: z.string().regex(/^gar_[a-z0-9]{6,64}$/),
  name: z.string().min(1).max(120),
  kind: GarmentKind,
  category: GarmentCategory,
  /** Blob key of the reference picture (a product photo, background removed). */
  image: z.string().min(1).max(200),
  colour: GarmentColour,
  source: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("link"), url: z.string().max(2_000) }),
    z.object({ kind: z.literal("upload") }),
    z.object({ kind: z.literal("sample") }),
  ]),
  /** True for invented sample garments in mock mode: the screen says so. */
  sample: z.boolean(),
});
export type GarmentItem = z.infer<typeof GarmentItem>;

/** Lip and blush shades MIRA can suggest from (a product catalogue). */
export const LookCatalogue = z.object({
  id: z.string(),
  brand: z.string(),
  sample: z.boolean(),
  lips: z.array(z.object({ id: z.string(), name: z.string(), hex: Hex })).max(2_000),
  blushes: z.array(z.object({ id: z.string(), name: z.string(), hex: Hex })).max(2_000),
});
export type LookCatalogue = z.infer<typeof LookCatalogue>;

/** The engine's reason codes for a suggestion, rendered as "why" text by the screen. */
export const LipReason = z.enum([
  "hue_near_garment",
  "hue_near_natural_lip",
  "no_hue_match_closest_to_natural_lip",
]);
export const BlushReason = z.enum(["hue_near_lip_lower_chroma", "none_in_window"]);

export const LookSuggestion = z.object({
  personalContrast: z.number(),
  lip: z
    .object({
      id: z.string(),
      name: z.string(),
      hex: Hex,
      reason: z.string(),
      contrastMatched: z.boolean(),
    })
    .optional(),
  blush: z.object({ id: z.string(), name: z.string(), hex: Hex, reason: z.string() }).optional(),
});
export type LookSuggestion = z.infer<typeof LookSuggestion>;

// ---------------------------------------------------------------------------------------------
// The result
// ---------------------------------------------------------------------------------------------

export const LookStepId = z.enum(["outfit", "shoes", "bag", "makeup", "hair", "venue", "video"]);
export type LookStepId = z.infer<typeof LookStepId>;

/**
 * What the check said about one step. `unchecked` means no check exists for that element (shoes,
 * bag, hair, venue): the label says so instead of implying a check that did not run.
 */
export const LookVerdict = z.enum([
  "verified",
  "drift",
  "not_checked",
  "unchecked",
  "withheld",
  "failed",
  "skipped",
]);
export type LookVerdict = z.infer<typeof LookVerdict>;

export const LookStep = z.object({
  id: LookStepId,
  /** The run node that made it, for the plate and the retry. */
  node: z.string(),
  verdict: LookVerdict,
  /** ΔE2000 from what was asked for, where a check measured one. */
  de: z.number().nonnegative().optional(),
  /** Which way a drifting colour read (`lighter`, `deeper`, `more_muted`, …), from the engine. */
  direction: z.string().optional(),
  /** Why a step has no verdict: the mapped failure or skip code. */
  reason: z.string().optional(),
});
export type LookStep = z.infer<typeof LookStep>;

export const LookResult = z.object({
  steps: z.array(LookStep),
  identity: z.object({
    verdict: z.enum(["verified", "withheld", "not_checked"]),
    /** Largest change in a face ratio, as a share. */
    drift: z.number().nonnegative().optional(),
    max: z.number().positive().optional(),
    reason: z.string().optional(),
  }),
  /** The node whose picture is the final plate; absent when everything was withheld or failed. */
  plate: z.string().optional(),
  /** Nodes whose pictures must not be shown (identity drift). */
  withheld: z.array(z.string()),
  video: z
    .object({
      node: z.string().optional(),
      status: z.enum(["done", "skipped", "failed", "not_requested"]),
      reason: z.string().optional(),
    })
    .optional(),
  thresholds: z.object({
    garmentDe: z.number(),
    lipDe: z.number(),
    identityMax: z.number(),
    calibrated: z.boolean(),
  }),
});
export type LookResult = z.infer<typeof LookResult>;

// ---------------------------------------------------------------------------------------------
// Event Mode: a plan for several functions, kept by the person in their own browser
// ---------------------------------------------------------------------------------------------

export const TimeOfDay = z.enum(["morning", "afternoon", "evening", "night"]);
export const VenueType = z.enum(["indoor", "outdoor", "garden", "hall", "beach", "temple"]);

export const EventFunction = z.object({
  id: z.string().regex(/^fn_[a-z0-9]{4,20}$/),
  name: z.string().min(1).max(60),
  timeOfDay: TimeOfDay,
  venue: VenueType,
  /** The saved look for this function, once built. */
  lookId: z.string().max(80).optional(),
});
export type EventFunction = z.infer<typeof EventFunction>;

export const EventPlan = z.object({
  name: z.string().min(1).max(80),
  functions: z.array(EventFunction).min(1).max(12),
});
export type EventPlan = z.infer<typeof EventPlan>;

/** The functions a wedding usually has (docs/phases/PHASE_08): editable, never required. */
export const WEDDING_FUNCTIONS: readonly Omit<EventFunction, "id" | "lookId">[] = [
  { name: "Haldi", timeOfDay: "morning", venue: "outdoor" },
  { name: "Mehendi", timeOfDay: "afternoon", venue: "garden" },
  { name: "Sangeet", timeOfDay: "evening", venue: "hall" },
  { name: "Wedding", timeOfDay: "morning", venue: "temple" },
  { name: "Reception", timeOfDay: "night", venue: "hall" },
];

/** Hair colours to choose from: choices, not measurements. "Keep mine" is the default. */
export const HAIR_COLOURS = [
  { name: "Soft black", hex: "#2B1D14" },
  { name: "Dark brown", hex: "#4A2F1E" },
  { name: "Chestnut", hex: "#6B3B22" },
  { name: "Burgundy", hex: "#6A1B2B" },
  { name: "Copper", hex: "#9A4B25" },
] as const;
