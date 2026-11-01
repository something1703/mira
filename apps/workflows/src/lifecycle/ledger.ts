import {
  newId,
  type Budget,
  type LedgerEntry,
  type Result,
  err,
  ok,
  Budget as BudgetSchema,
} from "@mira/schemas";
import { LedgerEntry as LedgerEntrySchema } from "@mira/schemas";
import { listDocs, updateDoc, type Clock, type StateStore } from "@mira/runtime";

export interface Caps {
  node: number;
  run: number;
  session: number;
}

export type LedgerError =
  | {
      code: "over_cap";
      scope: "node" | "run" | "session";
      cap: number;
      wanted: number;
      used: number;
    }
  | { code: "insufficient_units"; balance: number; wanted: number };

export interface NodeRef {
  runId: string;
  nodeId: string;
  sessionId: string;
  feature: string;
}

const budgetPath = (sessionId: string) => `budgets/${sessionId}`;
const capPath = (sessionId: string) => `budget-caps/${sessionId}`;
const key = (n: Pick<NodeRef, "runId" | "nodeId">) => `${n.runId}:${n.nodeId}`;

/**
 * Unit ledger (docs/ARCHITECTURE.md §3, steps 2 and 6). A reserve is closed by exactly one commit
 * or release, so units committed always equal what YouCam charged. The check against the caps and
 * the write happen in one `update`, so two nodes cannot both squeeze under a cap.
 */
export class Ledger {
  constructor(
    private readonly state: StateStore,
    private readonly clock: Clock,
    private readonly caps: Caps,
  ) {}

  /**
   * Idempotent per node: reserving a node that already has an open reserve changes nothing, which
   * is what makes a retried "start" safe.
   */
  async reserve(
    node: NodeRef,
    units: number,
    liveBalance: number | undefined,
  ): Promise<Result<number, LedgerError>> {
    const wanted = Math.ceil(units);
    const sessionCap = await this.sessionCap(node.sessionId);
    // A holder, because TypeScript cannot see assignments made inside the update callback.
    const out: { failure?: LedgerError; alreadyOpen: boolean } = { alreadyOpen: false };
    await updateDoc(this.state, budgetPath(node.sessionId), BudgetSchema, (cur) => {
      const b = cur ?? BudgetSchema.parse({});
      if (key(node) in b.open) {
        out.alreadyOpen = true;
        return b;
      }
      const run = b.runs[node.runId] ?? { reserved: 0, committed: 0 };
      const sessionUsed = b.reserved + b.committed;
      const runUsed = run.reserved + run.committed;
      if (wanted > this.caps.node)
        out.failure = { code: "over_cap", scope: "node", cap: this.caps.node, wanted, used: 0 };
      else if (runUsed + wanted > this.caps.run)
        out.failure = { code: "over_cap", scope: "run", cap: this.caps.run, wanted, used: runUsed };
      else if (sessionUsed + wanted > sessionCap)
        out.failure = {
          code: "over_cap",
          scope: "session",
          cap: sessionCap,
          wanted,
          used: sessionUsed,
        };
      else if (liveBalance !== undefined && liveBalance - b.reserved < wanted) {
        out.failure = { code: "insufficient_units", balance: liveBalance - b.reserved, wanted };
      }
      if (out.failure) return b;
      return {
        ...b,
        reserved: b.reserved + wanted,
        runs: { ...b.runs, [node.runId]: { ...run, reserved: run.reserved + wanted } },
        open: { ...b.open, [key(node)]: wanted },
      };
    });
    if (out.failure) return err(out.failure);
    if (!out.alreadyOpen) await this.write("reserve", node, wanted);
    return ok(wanted);
  }

  /** Success: YouCam charged the reserved units. */
  async commit(node: NodeRef): Promise<number> {
    return await this.close("commit", node);
  }

  /** Failure: failed tasks cost nothing, so the reserve is returned. */
  async release(node: NodeRef): Promise<number> {
    return await this.close("release", node);
  }

  private async close(kind: "commit" | "release", node: NodeRef): Promise<number> {
    let units = 0;
    await updateDoc(this.state, budgetPath(node.sessionId), BudgetSchema, (cur) => {
      const b = cur ?? BudgetSchema.parse({});
      const open = b.open[key(node)];
      if (open === undefined) return b; // already closed: closing twice must not double count
      units = open;
      const run = b.runs[node.runId] ?? { reserved: 0, committed: 0 };
      const { [key(node)]: _closed, ...rest } = b.open;
      return {
        reserved: b.reserved - open,
        committed: b.committed + (kind === "commit" ? open : 0),
        runs: {
          ...b.runs,
          [node.runId]: {
            reserved: run.reserved - open,
            committed: run.committed + (kind === "commit" ? open : 0),
          },
        },
        open: rest,
      };
    });
    if (units > 0) await this.write(kind, node, units);
    return units;
  }

  async budget(sessionId: string): Promise<Budget> {
    const raw = await this.state.get(budgetPath(sessionId));
    return BudgetSchema.parse(raw ?? {});
  }

  /** Units a session can still spend under its cap, counting open reserves. */
  async sessionUnitsLeft(sessionId: string): Promise<number> {
    const b = await this.budget(sessionId);
    return Math.max(0, (await this.sessionCap(sessionId)) - b.reserved - b.committed);
  }

  /** The session's unit cap: the deploy default, unless a test set its own (mock mode only). */
  async sessionCap(sessionId: string): Promise<number> {
    const raw = await this.state.get(capPath(sessionId));
    const cap = (raw as { cap?: unknown } | undefined)?.cap;
    return typeof cap === "number" && Number.isFinite(cap) && cap >= 0 ? cap : this.caps.session;
  }

  /** Test and demo knob. The only caller is a route that exists in mock mode alone. */
  async setSessionCap(sessionId: string, cap: number): Promise<void> {
    await this.state.set(capPath(sessionId), { cap });
  }

  async entries(runId: string): Promise<LedgerEntry[]> {
    const docs = await listDocs(this.state, "ledger", LedgerEntrySchema);
    return docs.map((d) => d.value).filter((e) => e.runId === runId);
  }

  private async write(kind: LedgerEntry["kind"], node: NodeRef, units: number): Promise<void> {
    const id = newId("led");
    const entry: LedgerEntry = {
      id,
      kind,
      feature: node.feature,
      units,
      runId: node.runId,
      nodeId: node.nodeId,
      sessionId: node.sessionId,
      at: new Date(this.clock.now()).toISOString(),
    };
    await this.state.set(`ledger/${id}`, entry);
  }
}
