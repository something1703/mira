import { z } from "zod";
import { NodeId, RunId } from "./ids";

/**
 * Documents the node lifecycle keeps beside runs and nodes (docs/DATA_MODEL.md §1, §4).
 */

/** `cache/{cacheKey}`: a reusable result. Images are never cached across runs (rule 9, D23). */
export const CacheEntry = z.object({
  feature: z.string(),
  output: z.unknown().optional(),
  /** Set only for image results; valid while the blob still exists. */
  resultRef: z.string().optional(),
  engineVersion: z.string(),
  createdAt: z.iso.datetime(),
});
export type CacheEntry = z.infer<typeof CacheEntry>;

/** `budgets/{sessionId}`: units reserved and committed, by run, updated atomically. */
export const Budget = z.object({
  reserved: z.number().nonnegative().default(0),
  committed: z.number().nonnegative().default(0),
  runs: z
    .record(
      z.string(),
      z.object({
        reserved: z.number().nonnegative().default(0),
        committed: z.number().nonnegative().default(0),
      }),
    )
    .default({}),
  /** Reserved units per node, so each reserve is closed by exactly one commit or release. */
  open: z.record(z.string(), z.number().nonnegative()).default({}),
});
export type Budget = z.infer<typeof Budget>;

/** `tasks/{taskId}`: lets a webhook find the node a task belongs to. */
export const TaskIndex = z.object({ runId: RunId, nodeId: NodeId });
export type TaskIndex = z.infer<typeof TaskIndex>;

/** What a queue delivery asks the worker to do. */
export const WorkItem = z.discriminatedUnion("op", [
  z.object({ op: z.literal("start"), runId: RunId, nodeId: NodeId }),
  z.object({ op: z.literal("poll"), runId: RunId, nodeId: NodeId, n: z.number().int().nonnegative() }),
  z.object({ op: z.literal("cleanup"), runId: RunId, attempt: z.number().int().nonnegative().default(0) }),
]);
export type WorkItem = z.infer<typeof WorkItem>;
