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
import { z } from "zod";
import { listDocs, updateDoc, type Clock, type StateStore } from "@mira/runtime";

export interface Caps {
  node: number;
  run: number;
  session: number;
  /** Units the whole deployment may spend per UTC day. Absent means no deployment cap. */
  deploymentDaily?: number | undefined;
}

/** Everyone's spending, for the cap a person cannot reset by starting a new session. */
const Deployment = z.object({
  reserved: z.number().int().nonnegative().default(0),
  open: z.record(z.string(), z.number()).default({}),
  days: z.record(z.string(), z.number()).default({}),
});
type Deployment = z.infer<typeof Deployment>;
const DEPLOYMENT_PATH = "budgets-deployment/all";

export type LedgerError =
  | {
      code: "over_cap";
      scope: "node" | "run" | "session" | "deployment";
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
    if (!out.alreadyOpen) {
      const over = await this.reserveDeployment(node, wanted);
      if (over) {
        // Put the session's units back: this reserve never took effect.
        await this.close("release", node, false);
        return err(over);
      }
      await this.write("reserve", node, wanted);
    }
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

  private today(): string {
    return new Date(this.clock.now()).toISOString().slice(0, 10);
  }

  /** The deployment-wide daily cap, checked and written together. Null means within it. */
  private async reserveDeployment(node: NodeRef, wanted: number): Promise<LedgerError | null> {
    const cap = this.caps.deploymentDaily;
    if (cap === undefined) return null;
    const day = this.today();
    const out: { failure: LedgerError | null } = { failure: null };
    await updateDoc(this.state, DEPLOYMENT_PATH, Deployment, (cur) => {
      const d = cur ?? Deployment.parse({});
      if (key(node) in d.open) return d;
      const used = d.reserved + (d.days[day] ?? 0);
      if (used + wanted > cap) {
        out.failure = { code: "over_cap", scope: "deployment", cap, wanted, used };
        return d;
      }
      return { ...d, reserved: d.reserved + wanted, open: { ...d.open, [key(node)]: wanted } };
    });
    return out.failure;
  }

  private async closeDeployment(kind: "commit" | "release", node: NodeRef): Promise<void> {
    if (this.caps.deploymentDaily === undefined) return;
    const day = this.today();
    await updateDoc(this.state, DEPLOYMENT_PATH, Deployment, (cur) => {
      const d = cur ?? Deployment.parse({});
      const open = d.open[key(node)];
      if (open === undefined) return d;
      const { [key(node)]: _closed, ...rest } = d.open;
      return {
        reserved: d.reserved - open,
        open: rest,
        days: kind === "commit" ? { ...d.days, [day]: (d.days[day] ?? 0) + open } : d.days,
      };
    });
  }

  async deploymentUsed(): Promise<{ reserved: number; today: number }> {
    const raw = Deployment.parse((await this.state.get(DEPLOYMENT_PATH)) ?? {});
    return { reserved: raw.reserved, today: raw.days[this.today()] ?? 0 };
  }

  private async close(
    kind: "commit" | "release",
    node: NodeRef,
    deployment = true,
  ): Promise<number> {
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
    if (deployment) await this.closeDeployment(kind, node);
    if (units > 0 && deployment) await this.write(kind, node, units);
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
