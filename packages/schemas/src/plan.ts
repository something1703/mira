import { z } from "zod";
import { NodeId, PlanId, RunId, SessionId, UserId } from "./ids";

export const QuoteLine = z.object({
  nodeId: NodeId,
  /** Copy key for the line, e.g. `quote.motion_video`. */
  label: z.string(),
  feature: z.string(),
  units: z.number().int().nonnegative(),
  /** A cache hit costs zero units; shown as "Saved result". */
  cached: z.boolean(),
  /** The person may remove this line (e.g. the video) without breaking the plan. */
  optional: z.boolean(),
});
export type QuoteLine = z.infer<typeof QuoteLine>;

export const Quote = z.object({
  lines: z.array(QuoteLine),
  total: z.number().int().nonnegative(),
  sessionUnitsLeft: z.number().int().nonnegative(),
  overCap: z.boolean(),
  /**
   * Where the prices came from. Unit costs are never hard-coded (AGENTS.md §2.4): live quotes read
   * the feature-cost endpoint; recorded runs use the costs captured with the fixture.
   */
  pricing: z.object({
    source: z.enum(["feature-cost", "recorded"]),
    pricedAt: z.iso.datetime(),
  }),
});
export type Quote = z.infer<typeof Quote>;

export const Plan = z.object({
  id: PlanId,
  userId: UserId,
  sessionId: SessionId,
  workflow: z.enum(["build_twin", "match_shade", "compose_look", "proof_setup", "proof_check_in"]),
  inputs: z.record(z.string(), z.unknown()),
  quote: Quote,
  /** Lines the person removed in the QuoteSheet (only optional lines can be removed). */
  removedLines: z.array(NodeId).default([]),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  /** Set only by the UI's confirm action; `start_run` refuses without it (AGENT_RUNTIME §3). */
  confirmedAt: z.iso.datetime().optional(),
  runId: RunId.optional(),
});
export type Plan = z.infer<typeof Plan>;
