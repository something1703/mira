import {
  err,
  newId,
  ok,
  type GarmentCategory,
  type GarmentItem,
  type GarmentKind,
  type Quote,
  type Result,
} from "@mira/schemas";
import type { Ports } from "@mira/runtime";
import type { Engine } from "../engine";
import { buildQuote, type QuoteError } from "../quote";
import { uploadsPrefix } from "../twin/profile";
import { buildGarmentIngestGraph } from "./garments";

export type IngestError =
  | { code: "upload_foreign"; key: string }
  | { code: "upload_missing"; key: string }
  | { code: "kind_category_mismatch" }
  | { code: "quote_failed"; detail: QuoteError }
  | { code: "over_cap"; quote: Quote }
  | { code: "quote_changed"; quote: Quote }
  | { code: "graph_rejected" };

export interface IngestRequest {
  userId: string;
  sessionId: string;
  /** Blob key of the garment picture (uploaded, or fetched from a product link by the agent). */
  photo: string;
  name: string;
  kind: GarmentKind;
  category: GarmentCategory;
  source: GarmentItem["source"];
  /** Mock mode: the colour read is invented. */
  sample: boolean;
  confirmedTotal?: number | undefined;
}

/** Quotes reading a garment's colour from its picture and, if asked, starts it. */
export async function planIngest(
  engine: Engine,
  ports: Ports,
  req: IngestRequest,
  start: boolean,
): Promise<Result<{ quote: Quote; runId?: string }, IngestError>> {
  if (!req.photo.startsWith(uploadsPrefix(req.userId))) {
    return err({ code: "upload_foreign", key: req.photo });
  }
  if ((await ports.blobs.get(req.photo)) === undefined) {
    return err({ code: "upload_missing", key: req.photo });
  }
  // Shoes are tried with the shoes category; a bag and an outfit never are.
  if (
    (req.kind === "shoes") !== (req.category === "shoes") ||
    (req.kind === "bag" && req.category !== "auto")
  ) {
    return err({ code: "kind_category_mismatch" });
  }
  const graph = buildGarmentIngestGraph(req);
  const quote = await buildQuote({
    graph,
    sessionId: req.sessionId,
    costs: engine.costs,
    ledger: engine.ledger,
    isCached: (node) => engine.runner.lifecycle.wouldHit(node),
    now: () => ports.clock.now(),
  });
  if (!quote.ok) return err({ code: "quote_failed", detail: quote.error });
  if (!start) return ok({ quote: quote.value });
  if (quote.value.overCap) return err({ code: "over_cap", quote: quote.value });
  if (req.confirmedTotal !== undefined && quote.value.total > req.confirmedTotal) {
    return err({ code: "quote_changed", quote: quote.value });
  }
  const started = await engine.runner.startRun({
    graph,
    userId: req.userId,
    sessionId: req.sessionId,
    planId: newId("plan"),
    quote: quote.value,
    removed: [],
    recorded: false,
  });
  if (!started.ok) return err({ code: "graph_rejected" });
  return ok({ quote: quote.value, runId: started.value.id });
}
