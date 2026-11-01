import { DeletionRecord, Run, Twin } from "@mira/schemas";
import { z } from "zod";
import { currentSession } from "../budget";
import { internalFetch } from "../internal";
import { workflowsUrl } from "../runs/api";

/** Everything MIRA stores about the person, as mira-workflows reports it (apps/workflows twin/profile.ts). */
export const Inventory = z.object({
  twin: Twin.nullable(),
  proofs: z.number().int().nonnegative(),
  looks: z.number().int().nonnegative(),
  savedLooks: z.array(z.object({ lookId: z.string(), images: z.number().int().nonnegative() })),
  pendingUploads: z.number().int().nonnegative(),
  heldPhotos: z.array(z.object({ kind: z.string(), at: z.string(), expiresAt: z.string() })),
  runs: z.array(
    z.object({
      id: z.string(),
      type: Run.shape.type,
      status: Run.shape.status,
      startedAt: z.string(),
      unitsSpent: z.number().nonnegative(),
    }),
  ),
  deletions: z.array(DeletionRecord),
});
export type Inventory = z.infer<typeof Inventory>;

export async function loadInventory(): Promise<Inventory | undefined> {
  const session = await currentSession();
  if (!session) return undefined;
  try {
    const res = await internalFetch(workflowsUrl(), `/internal/twin/${session.userId}/inventory`, {
      timeoutMs: 5_000,
    });
    if (!res.ok) return undefined;
    const parsed = Inventory.safeParse(await res.json());
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
