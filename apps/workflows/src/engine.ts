import { CONFIG } from "@mira/schemas";
import type { Ports } from "@mira/runtime";
import type { YouCamApi } from "@mira/youcam-client";
import { BalanceCache, FeatureCostCache } from "./lifecycle/costs";
import { Ledger, type Caps } from "./lifecycle/ledger";
import type { AuditHook, Downloader, LifecycleDeps } from "./lifecycle/types";
import { Runner, type NodeExecutor } from "./runner/runner";

export interface EngineOptions {
  ports: Ports;
  api: YouCamApi;
  download: Downloader;
  engineVersion: string;
  executors?: Record<string, NodeExecutor>;
  audit?: AuditHook;
  caps?: Partial<Caps>;
  log?: (message: string, fields?: Record<string, unknown>) => void;
}

export interface Engine {
  readonly runner: Runner;
  readonly ledger: Ledger;
  readonly costs: FeatureCostCache;
  readonly deps: LifecycleDeps;
}

/**
 * Wires the lifecycle, ledger, caches and runner onto a set of ports and one YouCam API. The same
 * wiring serves mock mode, tests and live; only the ports and the API differ.
 */
export function createEngine(options: EngineOptions): Engine {
  const { ports, api } = options;
  const caps: Caps = {
    node: options.caps?.node ?? CONFIG.budget.nodeCap.value,
    run: options.caps?.run ?? CONFIG.budget.runCap.value,
    session: options.caps?.session ?? CONFIG.budget.sessionCap.value,
  };
  const ledger = new Ledger(ports.state, ports.clock, caps);
  const costs = new FeatureCostCache(api, ports.clock);
  const balance = new BalanceCache(api, ports.clock);
  // `onSettled` needs the runner, which needs `deps`: tie the knot after both exist.
  const holder: { runner?: Runner } = {};
  const deps: LifecycleDeps = {
    state: ports.state,
    blobs: ports.blobs,
    events: ports.events,
    queue: ports.queue,
    clock: ports.clock,
    api,
    ledger,
    costs,
    balance,
    download: options.download,
    engineVersion: options.engineVersion,
    ...(options.audit ? { audit: options.audit } : {}),
    onSettled: async (runId) => {
      await holder.runner?.advance(runId);
    },
    log: options.log ?? (() => undefined),
  };
  const runner = new Runner(deps, options.executors);
  holder.runner = runner;
  ports.queue.setHandler((delivery) => runner.handle(delivery));
  ports.queue.setDeadHandler((delivery) => runner.dead(delivery));
  return { runner, ledger, costs, deps };
}
