import { newId, type Quote } from "@mira/schemas";
import type { Ports } from "@mira/runtime";
import type { Engine } from "../engine";
import { buildQuote, type QuoteError } from "../quote";
import { buildTwinGraph, type TwinCapture } from "../graphs/build-twin";
import { uploadsPrefix } from "./profile";

export type BuildError =
  | { code: "upload_foreign"; key: string }
  | { code: "upload_missing"; key: string }
  | { code: "quote_failed"; detail: QuoteError }
  | { code: "over_cap"; quote: Quote }
  | { code: "quote_changed"; quote: Quote }
  | { code: "graph_rejected" };

export interface BuildInput {
  userId: string;
  sessionId: string;
  capture: TwinCapture;
  /** Optional steps the person removed in the QuoteSheet (a repeat capture, hair). */
  removed?: readonly string[] | undefined;
  /** The total the person agreed to; the run does not start if the price has moved above it. */
  confirmedTotal?: number | undefined;
}

function captureKeys(c: TwinCapture): string[] {
  return [
    c.face,
    ...(c.repeats ?? []),
    ...(c.hair ? [c.hair.front, c.hair.right, c.hair.left] : []),
  ].filter((k): k is string => k !== undefined);
}

/**
 * Quotes a Build Twin graph and, if asked, starts it. Every key must be an upload of this person
 * that still exists: a key under another person's prefix is refused, never read.
 */
export async function planTwinBuild(
  engine: Engine,
  ports: Ports,
  input: BuildInput,
  start: boolean,
): Promise<
  { ok: true; value: { quote: Quote; runId?: string } } | { ok: false; error: BuildError }
> {
  for (const key of captureKeys(input.capture)) {
    if (!key.startsWith(uploadsPrefix(input.userId))) {
      return { ok: false, error: { code: "upload_foreign", key } };
    }
    if ((await ports.blobs.get(key)) === undefined) {
      return { ok: false, error: { code: "upload_missing", key } };
    }
  }
  const graph = buildTwinGraph(input.capture);
  const quote = await buildQuote({
    graph,
    sessionId: input.sessionId,
    costs: engine.costs,
    ledger: engine.ledger,
    ...(input.removed ? { removed: input.removed } : {}),
    isCached: (node) => engine.runner.lifecycle.wouldHit(node),
    now: () => ports.clock.now(),
  });
  if (!quote.ok) return { ok: false, error: { code: "quote_failed", detail: quote.error } };
  if (!start) return { ok: true, value: { quote: quote.value } };
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
    removed: input.removed ?? [],
    // Synthetic in mock mode, live otherwise; a recording replay sets this elsewhere.
    recorded: false,
  });
  if (!started.ok) return { ok: false, error: { code: "graph_rejected" } };
  return { ok: true, value: { quote: quote.value, runId: started.value.id } };
}
