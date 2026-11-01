import { Twin, type DeletionRecord } from "@mira/schemas";
import { z } from "zod";
import { currentSession } from "../budget";
import { workflowsUrl } from "../runs/api";

export type ProfileLoad =
  { kind: "twin"; twin: Twin } | { kind: "none"; deleted: boolean } | { kind: "error" };

/** Reads the signed-in person's profile from mira-workflows. Another person's is unreachable. */
export async function loadProfile(): Promise<ProfileLoad> {
  const session = await currentSession();
  if (!session) return { kind: "none", deleted: false };
  try {
    const res = await fetch(`${workflowsUrl()}/internal/twin/${session.userId}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (res.status === 404) {
      const body = z
        .object({ deletions: z.array(z.unknown()).default([]) })
        .safeParse(await res.json());
      return { kind: "none", deleted: body.success && body.data.deletions.length > 0 };
    }
    if (!res.ok) return { kind: "error" };
    const parsed = z.object({ twin: Twin }).safeParse(await res.json());
    return parsed.success ? { kind: "twin", twin: parsed.data.twin } : { kind: "error" };
  } catch {
    return { kind: "error" };
  }
}

export type { DeletionRecord };
