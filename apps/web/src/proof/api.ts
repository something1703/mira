import { Claim, ProofRecord } from "@mira/schemas";
import { Quote } from "@mira/schemas";
import { z } from "zod";

/** What the proof routes answer, parsed at the boundary like every other response. */
export const ProofView = z.object({
  proof: ProofRecord,
  nextDue: z.iso.datetime().optional(),
  baselineComplete: z.boolean(),
  synthetic: z.boolean(),
});
export type ProofView = z.infer<typeof ProofView>;

export const ProofList = z.object({ proofs: z.array(ProofView) });

export const ClaimReply = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("found"),
    claim: z.object({
      concern: Claim.shape.concern,
      windowDays: z.number().int(),
      text: z.string(),
    }),
    product: z.string().optional(),
  }),
  z.object({
    status: z.literal("partial"),
    claim: z.object({
      concern: Claim.shape.concern.optional(),
      windowDays: z.number().int().optional(),
      text: z.string().optional(),
    }),
    product: z.string().optional(),
  }),
  z.object({ status: z.literal("none"), product: z.string().optional() }),
]);
export type ClaimReply = z.infer<typeof ClaimReply>;

export const RunQuoteReply = z.object({
  quote: Quote,
  runId: z.string().optional(),
  intensity: z.number().optional(),
  synthetic: z.boolean(),
});
export type RunQuoteReply = z.infer<typeof RunQuoteReply>;

export const ReviewReply = z.object({ published: z.object({ week: z.string() }) });
