import type { ShadeRange } from "@mira/schemas";
import { newId, type Quote } from "@mira/schemas";
import type { Ports } from "@mira/runtime";
import type { Engine } from "../engine";
import { buildMatchShadeGraph, stepsOfShade } from "../graphs/match-shade";
import { buildQuote, type QuoteError } from "../quote";
import { uploadsPrefix } from "../twin/profile";
import type { EngineClient } from "../twin/engine-client";
import { clampTopN, planShade, type PlanError, type ShadePlan } from "./plan";

export type ShadeBuildError =
  | { code: "upload_foreign"; key: string }
  | { code: "upload_missing"; key: string }
  | { code: "concealer_not_suggested" }
  | { code: "no_shades_chosen" }
  | { code: "plan_failed"; detail: PlanError }
  | { code: "quote_failed"; detail: QuoteError }
  | { code: "over_cap"; quote: Quote }
  | { code: "quote_changed"; quote: Quote }
  | { code: "graph_rejected" };

export interface ShadeBuildInput {
  userId: string;
  sessionId: string;
  range: ShadeRange;
  /** Blob key of the face photo to render on. */
  photo: string;
  topN?: number | undefined;
  /**
   * Render exactly these shades (in ranked order, at most the maximum) instead of the closest few.
   * "Retry missing" uses it to redo the shades that failed.
   */
  shadeIds?: readonly string[] | undefined;
  /** Shades the person dropped in the QuoteSheet. The closest shade cannot be dropped. */
  removedShadeIds?: readonly string[] | undefined;
  /** A concealer second pass. Only for a person the engine suggested it for. */
  concealer?: boolean | undefined;
  confirmedTotal?: number | undefined;
}

export type ShadePlanOutcome =
  | { ok: true; value: { quote: Quote; plan: ShadePlan; chosen: string[]; runId?: string } }
  | { ok: false; error: ShadeBuildError };

/**
 * Quotes a shade match and, if asked, starts it. The shades come from the engines' own ranking of
 * the whole range, never from the client, so the person pays to render the closest ones.
 */
export async function planShadeMatch(
  engine: Engine,
  ports: Ports,
  engines: EngineClient,
  input: ShadeBuildInput,
  start: boolean,
): Promise<ShadePlanOutcome> {
  if (!input.photo.startsWith(uploadsPrefix(input.userId))) {
    return { ok: false, error: { code: "upload_foreign", key: input.photo } };
  }
  if ((await ports.blobs.get(input.photo)) === undefined) {
    return { ok: false, error: { code: "upload_missing", key: input.photo } };
  }
  const plan = await planShade(ports, engines, input.userId, input.range);
  if (!plan.ok) return { ok: false, error: { code: "plan_failed", detail: plan.error } };

  if (input.concealer === true && !plan.value.concealerSuggested) {
    return { ok: false, error: { code: "concealer_not_suggested" } };
  }
  const wanted = input.shadeIds === undefined ? undefined : new Set(input.shadeIds);
  const shades = (
    wanted === undefined ? plan.value.ranked : plan.value.ranked.filter((s) => wanted.has(s.id))
  ).slice(0, clampTopN(input.topN ?? wanted?.size ?? undefined));
  // Shades asked for by id that are not in this range leave nothing to render.
  if (shades.length === 0) return { ok: false, error: { code: "no_shades_chosen" } };
  const dropped = new Set(input.removedShadeIds ?? []);
  const removed = shades.flatMap((s, i) => (i > 0 && dropped.has(s.id) ? stepsOfShade(i) : []));
  const graph = buildMatchShadeGraph({
    rangeId: input.range.id,
    photo: input.photo,
    skinLab: plan.value.skinLab,
    shades,
    finish: plan.value.finish,
    finishReason: plan.value.finishReason,
    coverage: plan.value.coverage,
    coverageReason: plan.value.coverageReason,
    tZoneNote: plan.value.tZoneNote,
    checkedFree: plan.value.checkedFree,
    closestLabel: plan.value.ranked[0]?.label ?? "close",
    concealerSuggested: plan.value.concealerSuggested,
    concealer: input.concealer === true,
  });
  const quote = await buildQuote({
    graph,
    sessionId: input.sessionId,
    costs: engine.costs,
    ledger: engine.ledger,
    removed,
    isCached: (node) => engine.runner.lifecycle.wouldHit(node),
    now: () => ports.clock.now(),
  });
  if (!quote.ok) return { ok: false, error: { code: "quote_failed", detail: quote.error } };
  const chosen = shades.map((s) => s.id);
  if (!start) return { ok: true, value: { quote: quote.value, plan: plan.value, chosen } };
  if (quote.value.overCap) return { ok: false, error: { code: "over_cap", quote: quote.value } };
  if (input.confirmedTotal !== undefined && quote.value.total > input.confirmedTotal) {
    return { ok: false, error: { code: "quote_changed", quote: quote.value } };
  }
  const started = await engine.runner.startRun({
    graph,
    userId: input.userId,
    sessionId: input.sessionId,
    planId: newId("plan"),
    quote: quote.value,
    removed,
    recorded: false,
  });
  if (!started.ok) return { ok: false, error: { code: "graph_rejected" } };
  return {
    ok: true,
    value: { quote: quote.value, plan: plan.value, chosen, runId: started.value.id },
  };
}
