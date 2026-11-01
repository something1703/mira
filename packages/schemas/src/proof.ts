import { z } from "zod";
import { CONFIG } from "./config";
import { ProofId, UserId } from "./ids";
import { NoiseFloorEntry, skinMetricId } from "./twin";

/**
 * Proof (docs/UX_FLOWS.md §8, docs/ENGINES.md §8): is a skincare product visibly working, by more
 * than the person's own day-to-day variation? Every number comes from `raw_score`, which runs from
 * 1 to 100 where **higher means healthier-looking** (docs/YOUCAM_API.md §3). A product that claims
 * to reduce a visible concern therefore claims the score goes up, for every concern below.
 */

/**
 * The concerns a claim can be mapped to: the ones Skin Analysis measures whose score polarity is
 * known. Radiance, firmness and moisture are left out until their polarity is confirmed.
 */
export const PROOF_CONCERNS = [
  "pore",
  "wrinkle",
  "texture",
  "acne",
  "oiliness",
  "redness",
] as const;
export const ProofConcern = z.enum(PROOF_CONCERNS);
export type ProofConcern = z.infer<typeof ProofConcern>;

/** The metric a concern is tracked on: the HD whole-face reading (`skin.hd_pore.whole`). */
export const proofMetricId = (concern: ProofConcern) => skinMetricId(`hd_${concern}`, "whole");

/** Skin Simulation's own name for each concern (note the plurals, docs/YOUCAM_API.md §3). */
export const SIMULATION_KEY: Record<
  ProofConcern,
  "pores" | "wrinkle" | "texture" | "acne" | "oiliness" | "redness"
> = {
  pore: "pores",
  wrinkle: "wrinkle",
  texture: "texture",
  acne: "acne",
  oiliness: "oiliness",
  redness: "redness",
};

/** What a concern is called to a person (docs/COPY.md: "what the scan measured"). */
export const CONCERN_WORDS: Record<ProofConcern, { noun: string; subject: string }> = {
  pore: { noun: "visible pores", subject: "Visible pores" },
  wrinkle: { noun: "visible lines", subject: "Visible lines" },
  texture: { noun: "skin texture", subject: "Skin texture" },
  acne: { noun: "visible blemishes", subject: "Visible blemishes" },
  oiliness: { noun: "visible oiliness", subject: "Visible oiliness" },
  redness: { noun: "visible redness", subject: "Visible redness" },
};

export const Claim = z.object({
  concern: ProofConcern,
  /** How long the product says it takes, in days. */
  windowDays: z
    .number()
    .int()
    .min(CONFIG.proof.minWindowDays.value)
    .max(CONFIG.proof.maxWindowDays.value),
  /** The claim in the person's or the page's own words, shown back to them (never judged). */
  text: z.string().max(240).optional(),
  source: z.enum(["page", "typed", "chosen"]),
});
export type Claim = z.infer<typeof Claim>;

export const ProofSession = z.object({
  /** When the captures were analysed. */
  at: z.iso.datetime(),
  /** One `raw_score` per capture. */
  scores: z.array(z.number().min(1).max(100)).min(2).max(5),
  mean: z.number(),
  /** The run that measured them, so a repeated delivery never counts a session twice. */
  runId: z.string().min(1),
  kind: z.enum(["baseline", "check_in"]),
});
export type ProofSession = z.infer<typeof ProofSession>;

/** What a Skin Simulation sweep says about whether it moves Skin Analysis (docs/ENGINES.md §9). */
export const PhantomFit = z.object({
  usable: z.boolean(),
  rho: z.number(),
  scoreRange: z.number().nonnegative(),
  reason: z.enum(["ok", "too_few_points", "not_monotone", "range_below_mdc"]),
  intensities: z.array(z.number()),
  fittedDelta: z.array(z.number()),
  /** The raw scores the sweep measured and the variation they were judged against, kept so a
   *  visualisation can ask the engines which intensity matches a change (docs/ENGINES.md §9). */
  scores: z.array(z.number()),
  mdc: z.number().positive(),
  fittedAt: z.iso.datetime(),
});
export type PhantomFit = z.infer<typeof PhantomFit>;

export const VerdictWords = z.enum(["n/a", "within", "small", "clear", "opposite"]);

export const Verdict = z.object({
  at: z.iso.datetime(),
  /** Days since the person started using the product. */
  day: z.number().int().nonnegative(),
  windowDays: z.number().int().positive(),
  baseline: z.number(),
  now: z.number(),
  delta: z.number(),
  /** The smallest change MIRA can tell from day-to-day variation, or null while it is not known. */
  mdc: z.number().positive().nullable(),
  words: VerdictWords,
  phrase: z.string(),
  state: z.enum(["collecting", "not_yet", "detected", "opposite", "window_ended_no_change"]),
});
export type Verdict = z.infer<typeof Verdict>;

export const ProofStatus = z.enum(["baseline", "ready", "tracking", "ended", "stopped"]);

export const ProofRecord = z.object({
  id: ProofId,
  userId: UserId,
  product: z.object({ name: z.string().min(1).max(120), url: z.string().max(2_000).optional() }),
  claim: Claim,
  status: ProofStatus,
  createdAt: z.iso.datetime(),
  /** The day the person said they started using the product. Baseline is before it. */
  startedAt: z.iso.datetime().optional(),
  sessions: z.array(ProofSession).max(80),
  /** The day-to-day variation learned from the baseline, with its limits (docs/ENGINES.md §8). */
  noiseFloor: NoiseFloorEntry.optional(),
  phantom: PhantomFit.optional(),
  verdicts: z.array(Verdict).max(80),
  /** Something else in the routine changed at a check-in: the verdict says so beside it. */
  confound: z.object({ flagged: z.boolean(), at: z.iso.datetime().optional() }),
  reviewPublishedAt: z.iso.datetime().optional(),
});
export type ProofRecord = z.infer<typeof ProofRecord>;

/** One finished proof, anonymised, for the brand console (docs/DATA_MODEL.md §3). */
export const EfficacyOutcome = z.object({
  product_id: z.string().min(1).max(120),
  concern: ProofConcern,
  delta: z.number(),
  mdc: z.number().positive().nullable(),
  words: VerdictWords,
  fitzpatrick_band: z.string().max(20).nullable(),
  skin_type: z.string().max(40).nullable(),
  /** ISO week of the review, `2026-W44`; no day, no person. */
  week: z.string().regex(/^\d{4}-W\d{2}$/),
});
export type EfficacyOutcome = z.infer<typeof EfficacyOutcome>;
