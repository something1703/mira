import {
  newId,
  Run,
  RunNode,
  WorkItem,
  traceIdFrom,
  type Quote,
  type Result,
  type RunEvent,
  err,
  ok,
  TRACE_ATTRIBUTE,
} from "@mira/schemas";
import { getDoc, listDocs, updateDoc, type Delivery } from "@mira/runtime";
import { isTerminal, NodeLifecycle } from "../lifecycle/node-lifecycle";
import { RUN_EVENTS_TOPIC, type LifecycleDeps } from "../lifecycle/types";
import { cleanupRun } from "./cleanup";
import { validateGraph, type GraphError, type GraphSpec } from "./graph";

/** What a local (`engine` or `system`) node produces. Errors are values, not exceptions. */
export type ExecutorResult = Result<{ output?: unknown }, { code: string; retryable: boolean }>;

export interface ExecutorContext {
  readonly run: Run;
  readonly node: RunNode;
  /** Settled upstream nodes by id, with their outputs. */
  readonly upstream: Readonly<Record<string, RunNode>>;
}

export type NodeExecutor = (ctx: ExecutorContext) => Promise<ExecutorResult>;

export interface StartRunInput {
  graph: GraphSpec;
  userId: string;
  sessionId: string;
  planId: string;
  quote: Quote;
  /** True when results are replayed fixtures (mock mode or budget fallback). */
  recorded: boolean;
  traceId?: string;
  /** Optional nodes the person removed in the QuoteSheet; they start as skipped. */
  removed?: readonly string[];
}

const iso = (ms: number) => new Date(ms).toISOString();
const runPath = (runId: string) => `runs/${runId}`;
const nodePath = (runId: string, nodeId: string) => `runs/${runId}/nodes/${nodeId}`;

const FAILED_LIKE = new Set<RunNode["status"]>(["failed", "skipped", "cancelled"]);

/**
 * The graph runner (docs/ARCHITECTURE.md §4): resolves dependencies, starts every ready node, and
 * decides what a failure means. A node whose dependency failed is skipped; an unrelated branch
 * keeps going, so a run can finish "partial" and say how many steps succeeded (§8).
 */
export class Runner {
  readonly lifecycle: NodeLifecycle;

  constructor(
    private readonly d: LifecycleDeps,
    private readonly executors: Readonly<Record<string, NodeExecutor>> = {},
  ) {
    this.lifecycle = new NodeLifecycle(d);
  }

  async startRun(input: StartRunInput): Promise<Result<Run, GraphError>> {
    const bad = validateGraph(input.graph);
    if (bad) return err(bad);
    const runId = newId("run");
    const now = iso(this.d.clock.now());
    const removed = new Set(input.removed ?? []);
    const run: Run = Run.parse({
      id: runId,
      type: input.graph.type,
      userId: input.userId,
      sessionId: input.sessionId,
      status: "running",
      planId: input.planId,
      quote: input.quote,
      unitsSpent: 0,
      traceId: traceIdFrom(input.traceId),
      recorded: input.recorded,
      startedAt: now,
    });
    await this.d.state.set(runPath(runId), run);
    for (const spec of input.graph.nodes) {
      const skip = removed.has(spec.id) && spec.optional === true;
      await this.d.state.set(
        nodePath(runId, spec.id),
        RunNode.parse({
          id: spec.id,
          runId,
          kind: spec.kind,
          label: spec.label,
          dependsOn: spec.dependsOn ?? [],
          ...(spec.feature === undefined ? {} : { feature: spec.feature }),
          params: spec.params ?? {},
          inputs: spec.inputs ?? {},
          optional: spec.optional ?? false,
          status: skip ? "skipped" : "queued",
        }),
      );
    }
    await this.emit(run, undefined, "run_started");
    await this.advance(runId);
    return ok(run);
  }

  /** Starts every node whose dependencies are done, skips what can no longer run, and finalises. */
  async advance(runId: string): Promise<void> {
    const run = await getDoc(this.d.state, runPath(runId), Run);
    if (!run || run.status !== "running") return;

    // Skipping a node can orphan the nodes after it, so repeat until a pass changes nothing.
    // A graph of n nodes can cascade at most n times.
    for (let pass = 0; ; pass++) {
      const nodes = await this.nodes(runId);
      if (pass > nodes.length) break;
      const byId = new Map(nodes.map((n) => [n.id, n]));
      let skipped = false;
      for (const node of nodes) {
        if (node.status !== "queued") continue;
        const deps = node.dependsOn.map((id) => byId.get(id));
        if (deps.some((x) => x !== undefined && FAILED_LIKE.has(x.status))) {
          await this.setStatus(run, node, "skipped");
          skipped = true;
        } else if (deps.every((x) => x?.status === "done" || x?.status === "cached")) {
          await this.schedule(run, node);
        }
      }
      if (!skipped) break;
    }

    const after = await this.nodes(runId);
    if (after.every((n) => isTerminal(n.status))) await this.finish(run, after);
  }

  private async nodes(runId: string): Promise<RunNode[]> {
    return (await listDocs(this.d.state, `runs/${runId}/nodes`, RunNode)).map((n) => n.value);
  }

  /** Marks nodes that have not started as cancelled; running nodes finish, then the run closes. */
  async cancel(runId: string): Promise<void> {
    const run = await getDoc(this.d.state, runPath(runId), Run);
    if (!run) return;
    const nodes = await listDocs(this.d.state, `runs/${runId}/nodes`, RunNode);
    for (const { value: node } of nodes) {
      if (node.status === "queued") await this.setStatus(run, node, "cancelled");
    }
    await this.advance(runId);
  }

  /**
   * After a restart the in-process queue is empty, but state survived (D10). Re-deliver every node
   * that was in flight: a node with a stored task id only polls, never resubmits (AGENTS.md §2.3),
   * and a reserve is idempotent per node. Finished runs that were never cleaned get their cleanup.
   */
  async recover(): Promise<{ runs: number; nodes: number; cleanups: number }> {
    const runs = await listDocs(this.d.state, "runs", Run);
    const out = { runs: 0, nodes: 0, cleanups: 0 };
    const stamp = String(this.d.clock.now());
    for (const { value: run } of runs) {
      if (run.status === "running") {
        out.runs += 1;
        for (const node of await this.nodes(run.id)) {
          if (node.status !== "running" && node.status !== "waiting") continue;
          out.nodes += 1;
          await this.d.queue.enqueue(node.kind === "youcam" ? "youcam-submit" : "engine-jobs", {
            payload: { op: "start", runId: run.id, nodeId: node.id },
            dedupeKey: `recover:${run.id}:${node.id}:${stamp}`,
          });
        }
        await this.advance(run.id);
      } else if (run.cleanedAt === undefined) {
        out.cleanups += 1;
        await this.d.queue.enqueue("engine-jobs", {
          payload: { op: "cleanup", runId: run.id, attempt: 0 },
          dedupeKey: `recover-cleanup:${run.id}:${stamp}`,
        });
      }
    }
    return out;
  }

  /** The queue's single entry point: parses the work item and runs it. */
  async handle(delivery: Delivery): Promise<void> {
    const parsed = WorkItem.safeParse(delivery.payload);
    if (!parsed.success) {
      this.d.log("dropping malformed work item", { queue: delivery.queue });
      return;
    }
    const item = parsed.data;
    switch (item.op) {
      case "start":
        await this.start(item.runId, item.nodeId);
        return;
      case "poll":
        await this.lifecycle.poll(item.runId, item.nodeId, item.n);
        return;
      case "cleanup":
        await cleanupRun(this.d, item.runId, item.attempt);
        return;
    }
  }

  /** A delivery that exhausted its retries: fail the node rather than leave it hanging. */
  async dead(delivery: Delivery): Promise<void> {
    const parsed = WorkItem.safeParse(delivery.payload);
    if (!parsed.success || parsed.data.op === "cleanup") return;
    const { runId, nodeId } = parsed.data;
    const [run, node] = await Promise.all([
      getDoc(this.d.state, runPath(runId), Run),
      getDoc(this.d.state, nodePath(runId, nodeId), RunNode),
    ]);
    if (run && node && !isTerminal(node.status)) {
      await this.lifecycle.fail(run, node, { code: "worker_failed", retryable: true }, true);
    }
  }

  // ------------------------------------------------------------------ internals

  private async start(runId: string, nodeId: string): Promise<void> {
    const node = await getDoc(this.d.state, nodePath(runId, nodeId), RunNode);
    if (!node) return;
    if (node.kind === "youcam") {
      await this.lifecycle.start(runId, nodeId);
      return;
    }
    await this.runLocal(runId, node);
  }

  private async schedule(run: Run, node: RunNode): Promise<void> {
    const queue = node.kind === "youcam" ? "youcam-submit" : "engine-jobs";
    const res = await this.d.queue.enqueue(queue, {
      payload: { op: "start", runId: run.id, nodeId: node.id },
      dedupeKey: `start:${run.id}:${node.id}:0`,
    });
    // Marking running here stops a second `advance` from considering it ready again.
    if (res.accepted) await this.setStatus(run, node, "running", false);
  }

  private async runLocal(runId: string, node: RunNode): Promise<void> {
    const run = await getDoc(this.d.state, runPath(runId), Run);
    if (!run || isTerminal(node.status)) return;
    const executor = node.feature === undefined ? undefined : this.executors[node.feature];
    const started = await updateDoc(this.d.state, nodePath(runId, node.id), RunNode, (cur) => ({
      ...(cur ?? node),
      status: "running" as const,
      attempts: (cur ?? node).attempts + 1,
      startedAt: iso(this.d.clock.now()),
    }));
    await this.emit(run, node.id, "node_started");
    const upstream: Record<string, RunNode> = {};
    for (const id of node.dependsOn) {
      const up = await getDoc(this.d.state, nodePath(runId, id), RunNode);
      if (up) upstream[id] = up;
    }
    let result: ExecutorResult;
    try {
      result = executor
        ? await executor({ run, node: started, upstream })
        : err({ code: "unknown_executor", retryable: false });
    } catch (error) {
      this.d.log("executor threw", { runId, nodeId: node.id, error: String(error) });
      result = err({ code: "executor_error", retryable: false });
    }
    if (result.ok) {
      await updateDoc(this.d.state, nodePath(runId, node.id), RunNode, (cur) => ({
        ...(cur ?? started),
        status: "done" as const,
        ...(result.value.output === undefined ? {} : { output: result.value.output }),
        endedAt: iso(this.d.clock.now()),
      }));
      await this.emit(run, node.id, "node_done");
    } else {
      await updateDoc(this.d.state, nodePath(runId, node.id), RunNode, (cur) => ({
        ...(cur ?? started),
        status: "failed" as const,
        error: {
          code: result.error.code,
          retryable: result.error.retryable,
          unitsCharged: 0 as const,
        },
        endedAt: iso(this.d.clock.now()),
      }));
      await this.emit(run, node.id, "node_failed");
    }
    await this.advance(runId);
  }

  private async setStatus(
    run: Run,
    node: RunNode,
    status: RunNode["status"],
    announce = true,
  ): Promise<void> {
    await updateDoc(this.d.state, nodePath(run.id, node.id), RunNode, (cur) => ({
      ...(cur ?? node),
      status,
      ...(isTerminal(status) ? { endedAt: iso(this.d.clock.now()) } : {}),
    }));
    if (announce && status === "skipped") await this.emit(run, node.id, "node_skipped");
  }

  private async finish(run: Run, nodes: readonly RunNode[]): Promise<void> {
    const ok = nodes.filter((n) => n.status === "done" || n.status === "cached").length;
    const cancelled = nodes.some((n) => n.status === "cancelled");
    const requiredOk = nodes
      .filter((n) => !n.optional)
      .every((n) => n.status === "done" || n.status === "cached");
    const clean = nodes.every((n) => n.status !== "failed" || n.optional);
    const status: Run["status"] = cancelled
      ? "cancelled"
      : ok === 0
        ? "failed"
        : requiredOk && clean
          ? "succeeded"
          : "partial";
    const spent = nodes.reduce((sum, n) => sum + n.unitsCommitted, 0);
    // Claim the run: two nodes settling together must not both finish it.
    const claim = { won: false };
    const finished = await updateDoc(this.d.state, runPath(run.id), Run, (cur) => {
      const current = cur ?? run;
      if (current.status !== "running") return current;
      claim.won = true;
      return {
        ...current,
        status,
        unitsSpent: spent,
        endedAt: iso(this.d.clock.now()),
        outputs: { ...current.outputs, steps: { succeeded: ok, total: nodes.length } },
      };
    });
    if (!claim.won) return;
    await this.emit(finished, undefined, "run_finished");
    await this.d.queue.enqueue("engine-jobs", {
      payload: { op: "cleanup", runId: run.id, attempt: 0 },
      dedupeKey: `cleanup:${run.id}:0`,
    });
  }

  private async emit(run: Run, nodeId: string | undefined, type: RunEvent["type"]): Promise<void> {
    await this.d.events.publish(
      RUN_EVENTS_TOPIC,
      {
        runId: run.id,
        ...(nodeId === undefined ? {} : { nodeId }),
        type,
        at: iso(this.d.clock.now()),
        traceId: run.traceId,
      } satisfies RunEvent,
      { [TRACE_ATTRIBUTE]: run.traceId },
    );
  }
}
