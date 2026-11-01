import { CONFIG, newId, type PlanView, type Quote } from "@mira/schemas";

/**
 * Plans the agent has made in this session, with the confirmation the UI recorded for each
 * (docs/AGENT_RUNTIME.md §3). A plan is confirmed only by `confirm`, which the web app calls when
 * the person presses Confirm in the QuoteSheet: nothing the model writes, and nothing typed in the
 * chat, reaches it. Plans live for the session (the live store is Firestore, with the other
 * session state).
 */
export interface StoredPlan {
  view: PlanView;
  userId: string;
  sessionId: string;
  /** The workflows route that starts it, and the body that was quoted (without the total). */
  buildPath: string;
  body: Record<string, unknown>;
}

export interface PlanStore {
  put(plan: StoredPlan): void;
  /** A plan, only for the person and session that made it. */
  get(planId: string, userId: string, sessionId: string): StoredPlan | undefined;
  confirm(planId: string, userId: string, sessionId: string, now: Date): StoredPlan | undefined;
  attachRun(planId: string, runId: string): void;
}

export class MemoryPlanStore implements PlanStore {
  private readonly plans = new Map<string, StoredPlan>();

  put(plan: StoredPlan): void {
    this.plans.set(plan.view.id, plan);
  }

  get(planId: string, userId: string, sessionId: string): StoredPlan | undefined {
    const p = this.plans.get(planId);
    return p?.userId === userId && p.sessionId === sessionId ? p : undefined;
  }

  confirm(planId: string, userId: string, sessionId: string, now: Date): StoredPlan | undefined {
    const p = this.get(planId, userId, sessionId);
    if (!p || Date.parse(p.view.expiresAt) <= now.getTime()) return undefined;
    p.view = { ...p.view, confirmed: true };
    return p;
  }

  attachRun(planId: string, runId: string): void {
    const p = this.plans.get(planId);
    if (p) p.view = { ...p.view, runId };
  }
}

export function planView(
  workflow: PlanView["workflow"],
  summary: string,
  quote: Quote,
  now: Date,
): PlanView {
  return {
    id: newId("plan"),
    workflow,
    summary,
    quote,
    expiresAt: new Date(now.getTime() + CONFIG.agent.planTtlMs.value).toISOString(),
    confirmed: false,
  };
}
