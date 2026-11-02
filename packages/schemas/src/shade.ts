import { z } from "zod";
import { Hex, Lab } from "./metrics";

/**
 * Shade matching data (docs/UX_FLOWS.md §5, docs/ENGINES.md §4). A range is what a brand sells; a
 * result is what MIRA measured when it tried the closest shades. Neither holds an image.
 */

export const Finish = z.enum(["matte", "satin", "dewy"]);
export type Finish = z.infer<typeof Finish>;
export const Coverage = z.enum(["light", "medium"]);
export type Coverage = z.infer<typeof Coverage>;

export const RangeShade = z.object({
  /** Stable within the range: a slug of the name, or the brand's own code. */
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(200),
  hex: Hex,
});
export type RangeShade = z.infer<typeof RangeShade>;

/** Where a range came from, so a person can see what MIRA read and from where. */
export const RangeSource = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("catalogue"), catalogueId: z.string().min(1) }),
  z.object({ kind: z.literal("page"), url: z.url() }),
]);
export type RangeSource = z.infer<typeof RangeSource>;

export const ShadeRange = z.object({
  id: z.string().min(1).max(128),
  brand: z.string().min(1).max(200),
  product: z.string().min(1).max(200),
  /** The finish the product is sold as, when the page says. Not used to pick the render's finish. */
  finish: Finish.optional(),
  shades: z.array(RangeShade).min(1).max(200),
  source: RangeSource,
  /** True for the invented sample ranges used before real ones are recorded (D25). */
  sample: z.boolean().default(false),
});
export type ShadeRange = z.infer<typeof ShadeRange>;

/** How a shade compared with the person's measured skin before anything was rendered. */
export const PrerankedShade = z.object({
  id: z.string(),
  name: z.string(),
  hex: Hex,
  lab: Lab,
  de: z.number().nonnegative(),
  dLightness: z.number(),
  dHue: z.number(),
  label: z.enum([
    "blends_closely",
    "close",
    "lighter",
    "darker",
    "warmer",
    "cooler",
    "more_muted",
    "more_vivid",
  ]),
});
export type PrerankedShade = z.infer<typeof PrerankedShade>;

/** Why a rendered shade is or is not trusted as the best match. */
export const ShadeVerdict = z.enum([
  /** Rendered, re-measured, and the direction of change agrees with the shade. */
  "verified",
  /** Re-measured, but the render moved the wrong way: it is shown, never ranked first. */
  "drift",
  /** The render or its re-measure failed; nothing was measured. */
  "failed",
]);
export type ShadeVerdict = z.infer<typeof ShadeVerdict>;

export const ShadeOutcome = z.object({
  shadeId: z.string(),
  name: z.string(),
  hex: Hex,
  verdict: ShadeVerdict,
  /** ΔE00 between the re-measured render and the skin. Absent when nothing was measured. */
  blendDe: z.number().nonnegative().optional(),
  /** The node that holds the preview image while the run's review window is open. */
  renderNode: z.string().optional(),
  /** Mapped failure code when the render or its measure failed. */
  reason: z.string().optional(),
  preDe: z.number().nonnegative(),
});
export type ShadeOutcome = z.infer<typeof ShadeOutcome>;

export const ShadeResult = z.object({
  rangeId: z.string(),
  finish: Finish,
  finishReason: z.string(),
  coverage: Coverage,
  coverageReason: z.string(),
  tZoneNote: z.boolean(),
  /** Ranked: verified by blend ΔE ascending, then drift, then failed. */
  outcomes: z.array(ShadeOutcome),
  /** The shade shown as "best match", or undefined when no render was both verified and close. */
  bestShadeId: z.string().optional(),
  /** True when even the best verified blend is above the "close" line (docs/UX_FLOWS.md §5). */
  noClosePick: z.boolean(),
  /** The pass added a concealer to the foundation (docs/PHASE_06, "Concealer as a second pass"). */
  concealer: z.boolean().default(false),
  /** The engine says a concealer pass is worth offering for this person's readings. */
  concealerSuggested: z.boolean().default(false),
  /** The pre-rank label of the closest shade, for the "reads lighter and cooler" sentence. */
  closestLabel: PrerankedShade.shape.label,
  checkedFree: z.number().int().nonnegative(),
  /** Engine thresholds the labels used, so the text can say what "close" meant. */
  thresholds: z.object({ matchDe: z.number(), closeDe: z.number(), calibrated: z.boolean() }),
});
export type ShadeResult = z.infer<typeof ShadeResult>;
