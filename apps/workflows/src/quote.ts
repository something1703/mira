import { CONFIG, err, ok, type Quote, type QuoteLine, type Result } from "@mira/schemas";
import { featureOf, type FeatureSlug } from "@mira/youcam-client";
import type { FeatureCostCache } from "./lifecycle/costs";
import type { Ledger } from "./lifecycle/ledger";
import type { GraphSpec, NodeSpec } from "./runner/graph";

export type QuoteError =
  | { code: "price_unavailable"; message: string }
  | {
      code: "price_unknown" | "price_ambiguous" | "invalid_request" | "unknown_feature";
      nodeId: string;
      message: string;
    };

export interface QuoteOptions {
  graph: GraphSpec;
  sessionId: string;
  costs: FeatureCostCache;
  ledger: Ledger;
  /** Optional nodes the person removed; they cost nothing and are not listed. */
  removed?: readonly string[];
  /** True when a node's result is already stored (a cache hit costs zero units). */
  isCached?: (node: NodeSpec) => Promise<boolean>;
  now: () => number;
}

/**
 * The QuoteSheet's numbers (docs/UX_FLOWS.md §0, AGENTS.md §2.4): every price comes from the
 * feature-cost endpoint through the cost cache. Nothing is guessed: a node that cannot be priced
 * makes the whole quote an error, so a plan is never shown with a number that is not real.
 */
export async function buildQuote(o: QuoteOptions): Promise<Result<Quote, QuoteError>> {
  const skus = await o.costs.get();
  if (!skus.ok) return err({ code: "price_unavailable", message: skus.error.message });
  const removed = new Set(o.removed ?? []);
  const lines: QuoteLine[] = [];
  for (const node of o.graph.nodes) {
    if (node.kind !== "youcam" || (removed.has(node.id) && node.optional === true)) continue;
    const feature = node.feature === undefined ? undefined : featureOf(node.feature as FeatureSlug);
    if (!feature)
      return err({
        code: "unknown_feature",
        nodeId: node.id,
        message: `Unknown feature ${node.feature ?? ""}`,
      });
    const params = feature.params.safeParse(node.params ?? {});
    if (!params.success)
      return err({ code: "invalid_request", nodeId: node.id, message: params.error.message });
    const cached = (await o.isCached?.(node)) ?? false;
    const price = feature.price(params.data, skus.value);
    if (!price.ok)
      return err({ code: price.error.code, nodeId: node.id, message: price.error.message });
    lines.push({
      nodeId: node.id,
      label: node.label,
      feature: feature.slug,
      units: cached ? 0 : Math.ceil(price.value),
      cached,
      optional: node.optional ?? false,
    });
  }
  const total = lines.reduce((sum, l) => sum + l.units, 0);
  const sessionUnitsLeft = await o.ledger.sessionUnitsLeft(o.sessionId);
  const overCap =
    total > sessionUnitsLeft ||
    total > CONFIG.budget.runCap.value ||
    lines.some((l) => l.units > CONFIG.budget.nodeCap.value);
  return ok({
    lines,
    total,
    sessionUnitsLeft,
    overCap,
    pricing: {
      source: "feature-cost",
      pricedAt: new Date(o.costs.pricedAt || o.now()).toISOString(),
    },
  });
}
