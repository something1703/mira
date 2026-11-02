import { newId, Run, RunNode, err, ok, type Result } from "@mira/schemas";
import { getDoc, listDocs, updateDoc } from "@mira/runtime";
import type { LifecycleDeps } from "../lifecycle/types";

/**
 * Saving a look (docs/DATA_MODEL.md §2): the images are copied to `saved/{userId}/{lookId}/`,
 * outside the run's prefix, so end-of-run cleanup (which deletes `runs/{runId}/`) and the 1-day
 * bucket rule do not touch them. Only an explicit save keeps an image (AGENTS.md §2.9).
 */
export type SaveError =
  | { code: "run_not_found" }
  | { code: "images_deleted" } // the run has already been cleaned up: there is nothing left to save
  | { code: "nothing_to_save" };

export const savedPrefix = (userId: string, lookId?: string): string =>
  lookId === undefined ? `saved/${userId}/` : `saved/${userId}/${lookId}/`;

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export async function saveOutputs(
  d: LifecycleDeps,
  runId: string,
  nodeIds: readonly string[],
): Promise<Result<{ lookId: string; keys: string[] }, SaveError>> {
  const run = await getDoc(d.state, `runs/${runId}`, Run);
  if (!run) return err({ code: "run_not_found" });
  if (run.cleanedAt !== undefined) return err({ code: "images_deleted" });

  const wanted = new Set(nodeIds);
  const nodes = (await listDocs(d.state, `runs/${runId}/nodes`, RunNode))
    .map((n) => n.value)
    .filter((n) => wanted.has(n.id) && n.resultRef !== undefined);
  const lookId = newId("lk");
  const keys: string[] = [];
  for (const node of nodes) {
    const blob = await d.blobs.get(node.resultRef ?? "");
    // A preview that is already gone cannot be saved, and saying nothing would pass a partial
    // look off as the whole one.
    if (!blob) return err({ code: "images_deleted" });
    const key = `${savedPrefix(run.userId, lookId)}${node.id}.${EXT[blob.contentType] ?? "bin"}`;
    await d.blobs.put(key, blob.bytes, blob.contentType);
    keys.push(key);
  }
  if (keys.length === 0) return err({ code: "nothing_to_save" });

  await updateDoc(d.state, `runs/${runId}`, Run, (cur) => {
    const current = cur ?? run;
    const saved = (current.outputs.saved as { lookId: string; keys: string[] }[] | undefined) ?? [];
    return { ...current, outputs: { ...current.outputs, saved: [...saved, { lookId, keys }] } };
  });
  return ok({ lookId, keys });
}

/** Deletes one saved look, or every saved image of a person (Delete my profile). Returns how many. */
export async function deleteSaved(
  d: Pick<LifecycleDeps, "blobs">,
  userId: string,
  lookId?: string,
): Promise<number> {
  return await d.blobs.deletePrefix(savedPrefix(userId, lookId));
}
