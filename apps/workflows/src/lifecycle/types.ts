import type { Audit, Result, Run, RunNode } from "@mira/schemas";
import type { BlobStore, Clock, EventBus, StateStore, TaskQueue } from "@mira/runtime";
import type { YouCamApi } from "@mira/youcam-client";
import type { BalanceCache, FeatureCostCache } from "./costs";
import type { Ledger } from "./ledger";

/** Fetches a result URL. Injected so tests never touch the network. */
export type Downloader = (
  url: string,
) => Promise<Result<{ bytes: Uint8Array; contentType: string }, { message: string }>>;

/**
 * Step 7 of the lifecycle: runs on every node that produced an image before a downstream node or
 * the person sees it. Returning `undefined` means "nothing to audit for this node".
 */
export type AuditHook = (ctx: {
  run: Run;
  node: RunNode;
  output: unknown;
  resultRef: string | undefined;
}) => Promise<Audit | undefined>;

export interface LifecycleDeps {
  readonly state: StateStore;
  readonly blobs: BlobStore;
  readonly events: EventBus;
  readonly queue: TaskQueue;
  readonly clock: Clock;
  readonly api: YouCamApi;
  readonly ledger: Ledger;
  readonly costs: FeatureCostCache;
  readonly balance: BalanceCache;
  readonly download: Downloader;
  readonly engineVersion: string;
  readonly audit?: AuditHook;
  /** Called after any node reaches a settled state, so the runner can start what is now ready. */
  readonly onSettled: (runId: string) => Promise<void>;
  readonly log: (message: string, fields?: Record<string, unknown>) => void;
}

export const RUN_EVENTS_TOPIC = "run-events";
