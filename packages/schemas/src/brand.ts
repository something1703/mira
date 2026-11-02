import { z } from "zod";
import { Hex } from "./metrics";

/**
 * What the brand side sees (docs/DATA_MODEL.md §3, docs/UX_FLOWS.md §10). Rows carry no user id, no
 * image and a week, never a day. Nothing leaves the views below the minimum cohort
 * (`MIRA_K_ANON_MIN`): a small group is hidden, not shown with a warning.
 */
export const ShadeDemandRow = z.object({
  skin_L: z.number().min(0).max(100),
  skin_a: z.number().min(-128).max(128),
  skin_b: z.number().min(-128).max(128),
  /** Hue angle of (a*, b*), degrees. */
  h_ab: z.number().min(0).max(360),
  fitzpatrick_band: z.string().max(20).nullable(),
  region: z.string().max(40).nullable(),
  week: z.string().regex(/^\d{4}-W\d{2}$/),
});
export type ShadeDemandRow = z.infer<typeof ShadeDemandRow>;

export const LookEventRow = z.object({
  /** `apparel`, `beauty`, `footwear`, `bag`, `hair`, `venue`, `video`: what the look contained. */
  categories: z.array(z.string().max(20)).max(10),
  brand_ids: z.array(z.string().max(80)).max(10),
  saved: z.boolean(),
  week: z.string().regex(/^\d{4}-W\d{2}$/),
});
export type LookEventRow = z.infer<typeof LookEventRow>;

export const BrandShade = z.object({
  id: z.string().min(1).max(60),
  name: z.string().min(1).max(80),
  hex: Hex,
});

export const BrandProduct = z.object({
  id: z.string().min(1).max(60),
  name: z.string().min(1).max(120),
  shades: z.array(BrandShade).min(1).max(200),
});

export const BrandCatalogue = z.object({
  brandId: z.string().min(1).max(60),
  name: z.string().min(1).max(80),
  products: z.array(BrandProduct).min(1).max(50),
  source: z.enum(["csv", "links", "sample"]),
  /** True for the invented range the console shows before a brand adds its own. */
  sample: z.boolean(),
  updatedAt: z.iso.datetime(),
});
export type BrandCatalogue = z.infer<typeof BrandCatalogue>;

/** A cell the cohort rule hides: how many are missing is shown, who they are never is. */
export const HIDDEN = "Fewer than the minimum shoppers; hidden to protect privacy." as const;

/** The person's choice to let anonymised readings feed brand summaries (off until they say yes). */
export const Prefs = z.object({ contribute: z.boolean() });
export type Prefs = z.infer<typeof Prefs>;
