import { type NodeKind, type RunType } from "@mira/schemas";

export interface NodeSpec {
  /** Stable key, e.g. `skin-analysis`; lower-case, digits, `-` and `_`. */
  id: string;
  kind: NodeKind;
  /** Copy key for the StepRail label. */
  label: string;
  dependsOn?: readonly string[];
  /** YouCam feature slug for `youcam` nodes; the executor name for `engine` and `system` nodes. */
  feature?: string;
  params?: Record<string, unknown>;
  /** Role → `blob:…`, `node:<id>` or `url:…` (see RunNode.inputs). */
  inputs?: Record<string, string>;
  /** The person can remove it in the QuoteSheet, and its failure does not stop the run. */
  optional?: boolean;
}

export interface GraphSpec {
  type: RunType;
  nodes: readonly NodeSpec[];
}

export type GraphError =
  | { code: "empty_graph" }
  | { code: "duplicate_node"; nodeId: string }
  | { code: "unknown_dependency"; nodeId: string; dependsOn: string }
  | { code: "cycle"; nodeId: string }
  | { code: "self_dependency"; nodeId: string };

/** Typed graph check: unique ids, known dependencies, no cycles. */
export function validateGraph(graph: GraphSpec): GraphError | undefined {
  if (graph.nodes.length === 0) return { code: "empty_graph" };
  const ids = new Set<string>();
  for (const n of graph.nodes) {
    if (ids.has(n.id)) return { code: "duplicate_node", nodeId: n.id };
    ids.add(n.id);
  }
  for (const n of graph.nodes) {
    for (const d of n.dependsOn ?? []) {
      if (d === n.id) return { code: "self_dependency", nodeId: n.id };
      if (!ids.has(d)) return { code: "unknown_dependency", nodeId: n.id, dependsOn: d };
    }
  }
  // Kahn's algorithm: anything left over sits on a cycle.
  const indegree = new Map(graph.nodes.map((n) => [n.id, (n.dependsOn ?? []).length]));
  const ready = [...indegree].filter(([, d]) => d === 0).map(([id]) => id);
  let seen = 0;
  while (ready.length > 0) {
    const id = ready.pop();
    if (id === undefined) break;
    seen += 1;
    for (const n of graph.nodes) {
      if ((n.dependsOn ?? []).includes(id)) {
        const left = (indegree.get(n.id) ?? 0) - 1;
        indegree.set(n.id, left);
        if (left === 0) ready.push(n.id);
      }
    }
  }
  if (seen !== graph.nodes.length) {
    const stuck = [...indegree].find(([, d]) => d > 0);
    return { code: "cycle", nodeId: stuck?.[0] ?? "unknown" };
  }
  return undefined;
}
