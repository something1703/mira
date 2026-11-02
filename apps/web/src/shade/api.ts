import { PrerankedShade, Quote, ShadeRange, ShadeResult } from "@mira/schemas";
import { z } from "zod";

/** What the shade routes answer, parsed at the boundary like every other response. */
export const PlanView = z.object({
  ranked: z.array(PrerankedShade).min(1),
  checkedFree: z.number().int().nonnegative(),
  finish: z.enum(["matte", "satin", "dewy"]),
  finishReason: z.string(),
  coverage: z.enum(["light", "medium"]),
  coverageReason: z.string(),
  tZoneNote: z.boolean(),
  concealerSuggested: z.boolean().default(false),
});
export type PlanView = z.infer<typeof PlanView>;

export const ShadeQuoteView = z.object({
  quote: Quote,
  chosen: z.array(z.string()),
  finish: z.enum(["matte", "satin", "dewy"]),
  coverage: z.enum(["light", "medium"]),
  synthetic: z.boolean(),
});
export type ShadeQuoteView = z.infer<typeof ShadeQuoteView>;

export const RangesView = z.object({ ranges: z.array(ShadeRange) });
export const ExtractView = z.object({ range: ShadeRange });
export { ShadeResult };

/** Where the chosen range is kept between screens, so "Retry missing" can offer it again. */
export const RANGE_KEY = "mira-shade-range";
export const RETRY_KEY = "mira-shade-retry";
export const CONCEALER_KEY = "mira-shade-concealer";
