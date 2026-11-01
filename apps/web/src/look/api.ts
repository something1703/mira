import { GarmentItem, LookResult, LookSuggestion, Quote } from "@mira/schemas";
import { z } from "zod";

/** What the look routes answer, parsed at the boundary like every other response. */
export const GarmentReply = z.object({ garment: GarmentItem });
export const CatalogueReply = z.object({
  garments: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      kind: z.enum(["outfit", "shoes", "bag"]),
      category: z.string(),
      hex: z.string(),
    }),
  ),
});
export const ExtractReply = z.object({ photo: z.string(), name: z.string() });
export const GarmentQuoteReply = z.object({
  quote: Quote,
  runId: z.string().optional(),
  synthetic: z.boolean(),
});
export const SuggestReply = z.object({ suggestion: LookSuggestion, synthetic: z.boolean() });
export const LookQuoteReply = z.object({
  quote: Quote,
  steps: z.array(z.string()),
  suggestion: LookSuggestion.optional(),
  runId: z.string().optional(),
  synthetic: z.boolean(),
});
export const VenuesReply = z.object({
  items: z.array(z.object({ id: z.string(), name: z.string() })),
});
export { LookResult };

/** The look being put together, kept for the tab so a reload or a retry does not lose it. */
export const DRAFT_KEY = "mira-look-draft";
export const DraftStore = z.object({
  outfit: GarmentItem.optional(),
  shoes: GarmentItem.optional(),
  bag: GarmentItem.optional(),
  bagGender: z.enum(["female", "male"]).default("female"),
  makeup: z.boolean().default(true),
  hairHex: z
    .string()
    .regex(/^#[0-9A-F]{6}$/)
    .optional(),
  venue: z
    .object({
      name: z.string(),
      choice: z.discriminatedUnion("type", [
        z.object({ type: z.literal("prompt"), prompt: z.string() }),
        z.object({ type: z.literal("template"), templateId: z.string() }),
      ]),
    })
    .optional(),
  video: z.boolean().default(false),
});
export type Draft = z.infer<typeof DraftStore>;

export const emptyDraft = (): Draft => DraftStore.parse({});
