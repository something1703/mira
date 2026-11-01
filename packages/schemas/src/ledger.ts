import { z } from "zod";
import { LedgerEntryId, NodeId, RunId, SessionId } from "./ids";

/**
 * Unit ledger (docs/ARCHITECTURE.md §3, step 2 and 6). Every reserve is closed by exactly one
 * commit or release, so committed units always equal what YouCam actually charged.
 */
export const LedgerEntryKind = z.enum(["reserve", "commit", "release"]);
export type LedgerEntryKind = z.infer<typeof LedgerEntryKind>;

export const LedgerEntry = z.object({
  id: LedgerEntryId,
  kind: LedgerEntryKind,
  feature: z.string(),
  units: z.number().int().nonnegative(),
  runId: RunId,
  nodeId: NodeId,
  sessionId: SessionId,
  at: z.iso.datetime(),
});
export type LedgerEntry = z.infer<typeof LedgerEntry>;
