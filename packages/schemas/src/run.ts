import { z } from "zod";
import { NodeId, PlanId, RunId, SessionId, TraceId, UserId } from "./ids";
import { Quote } from "./plan";

export const RunType = z.enum([
  "build_twin",
  "match_shade",
  "compose_look",
  "proof_setup",
  "proof_check_in",
  "catalogue_ingest",
  "demo",
]);
export type RunType = z.infer<typeof RunType>;

export const RunStatus = z.enum([
  "queued",
  "running",
  /** Some fan-out branches failed; the result says how many succeeded (ARCHITECTURE §8). */
  "partial",
  "succeeded",
  "failed",
  "cancelled",
]);
export type RunStatus = z.infer<typeof RunStatus>;

/**
 * Node states. `waiting` means a YouCam task was submitted and its `taskId` persisted; a worker
 * that restarts in this state polls and never resubmits (AGENTS.md §2.3). The StepRail shows
 * `waiting` as running and `cancelled` as skipped.
 */
export const NodeStatus = z.enum([
  "queued",
  "running",
  "waiting",
  "done",
  "cached",
  "failed",
  "skipped",
  "cancelled",
]);
export type NodeStatus = z.infer<typeof NodeStatus>;

export const NodeKind = z.enum(["youcam", "engine", "system"]);
export type NodeKind = z.infer<typeof NodeKind>;

export const AuditOutcome = z.enum(["verified", "drift", "not_checked", "withheld"]);
export type AuditOutcome = z.infer<typeof AuditOutcome>;

export const Direction = z.enum([
  "lighter",
  "darker",
  "warmer",
  "cooler",
  "more_muted",
  "more_vivid",
]);
export type Direction = z.infer<typeof Direction>;

export const Audit = z.object({
  kind: z.enum(["garment", "lip", "foundation", "identity"]),
  outcome: AuditOutcome,
  /** ΔE2000 between what was intended and what the render shows, when measured. */
  deltaE: z.number().nonnegative().optional(),
  directions: z.array(Direction).default([]),
  /** Reason code rendered into copy by the UI, e.g. `garment_unchanged_torso`. */
  reason: z.string(),
  engineVersion: z.string(),
});
export type Audit = z.infer<typeof Audit>;

export const NodeError = z.object({
  /** Mapped code, e.g. `face_too_small`, `over_cap`, `youcam_timeout`. */
  code: z.string(),
  /** YouCam's own code or message, kept for the run viewer; never shown raw to a person. */
  upstream: z.string().optional(),
  retryable: z.boolean(),
  /** Failed tasks cost nothing (docs/YOUCAM_API.md §1); recorded so the UI can say so. */
  unitsCharged: z.literal(0),
});
export type NodeError = z.infer<typeof NodeError>;

export const RunNode = z.object({
  id: NodeId,
  runId: RunId,
  kind: NodeKind,
  /** Copy key for the StepRail label, e.g. `step.measure_skin`. */
  label: z.string(),
  dependsOn: z.array(NodeId),
  feature: z.string().optional(),
  version: z.string().optional(),
  params: z.record(z.string(), z.unknown()).default({}),
  /**
   * What the node reads, by role (`src`, `ref`, `src0`…). Each is a blob key in this run's
   * storage (`blob:runs/…`), a previous node's output (`node:<id>`), or a public URL (`url:…`).
   */
  inputs: z.record(z.string(), z.string()).default({}),
  cacheKey: z.string().optional(),
  /** YouCam file IDs by input role, stored before the task is created ("upload once"). */
  files: z.record(z.string(), z.string()).default({}),
  taskId: z.string().optional(),
  status: NodeStatus,
  unitsReserved: z.number().int().nonnegative().default(0),
  unitsCommitted: z.number().int().nonnegative().default(0),
  /** Blob key of the copied result image. Result URLs expire after 2 hours (F4). */
  resultRef: z.string().optional(),
  /** The YouCam result URL and when it stops working, for chaining without a re-upload (D12). */
  resultUrl: z.string().optional(),
  resultUrlExpiresAt: z.iso.datetime().optional(),
  /** Parsed non-image output (analyser JSON, engine results). Numbers only, never images. */
  output: z.unknown().optional(),
  audit: Audit.optional(),
  error: NodeError.optional(),
  attempts: z.number().int().nonnegative().default(0),
  /** Optional nodes (e.g. video) can be removed in the QuoteSheet without breaking the graph. */
  optional: z.boolean().default(false),
  startedAt: z.iso.datetime().optional(),
  endedAt: z.iso.datetime().optional(),
});
export type RunNode = z.infer<typeof RunNode>;

export const Run = z.object({
  id: RunId,
  type: RunType,
  userId: UserId,
  sessionId: SessionId,
  status: RunStatus,
  planId: PlanId,
  quote: Quote,
  unitsSpent: z.number().int().nonnegative(),
  traceId: TraceId,
  /** True when results are replayed fixtures (mock mode or budget fallback). */
  recorded: z.boolean(),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().optional(),
  /** Set once the run's images and YouCam tasks have been deleted (AGENTS.md §2.9). */
  cleanedAt: z.iso.datetime().optional(),
  outputs: z.record(z.string(), z.unknown()).default({}),
});
export type Run = z.infer<typeof Run>;

/** Progress events on `run-events` (Pub/Sub live, in-process in mock). */
export const RunEvent = z.object({
  runId: RunId,
  nodeId: NodeId.optional(),
  type: z.enum([
    "run_started",
    "node_started",
    "node_waiting",
    "node_done",
    "node_cached",
    "node_failed",
    "node_skipped",
    "node_audited",
    "run_finished",
  ]),
  at: z.iso.datetime(),
  traceId: TraceId,
});
export type RunEvent = z.infer<typeof RunEvent>;
