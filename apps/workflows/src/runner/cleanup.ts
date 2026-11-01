import { Run, RunNode } from "@mira/schemas";
import { getDoc, listDocs, updateDoc } from "@mira/runtime";
import type { LifecycleDeps } from "../lifecycle/types";

const MAX_ATTEMPTS = 10;
const RETRY_DELAY_MS = 30_000;

/**
 * End-of-run cleanup (AGENTS.md §2.9, SECURITY_PRIVACY §1): every uploaded and generated image is
 * deleted, then every YouCam task is deleted with its resources. Images go first, so a YouCam
 * failure can never leave a person's photo behind in our storage. A look the person saved was
 * copied to `saved/{userId}/{lookId}/` first (see save.ts), outside this prefix, so it survives.
 */
export async function cleanupRun(
  d: LifecycleDeps,
  runId: string,
  attempt: number,
): Promise<{ done: boolean; blobsDeleted: number; tasksDeleted: number; tasksPending: number }> {
  const run = await getDoc(d.state, `runs/${runId}`, Run);
  if (!run) return { done: true, blobsDeleted: 0, tasksDeleted: 0, tasksPending: 0 };

  const nodes = (await listDocs(d.state, `runs/${runId}/nodes`, RunNode)).map((n) => n.value);
  let blobsDeleted = 0;
  for (const key of await d.blobs.list(`runs/${runId}/`)) {
    await d.blobs.delete(key);
    blobsDeleted += 1;
  }

  let tasksDeleted = 0;
  let tasksPending = 0;
  for (const node of nodes) {
    if (node.taskId === undefined) continue;
    const res = await d.api.deleteTask(node.taskId);
    if (res.ok || res.error.upstream === "InvalidTaskId") {
      tasksDeleted += 1; // deleted now, or YouCam has already removed it
    } else {
      tasksPending += 1; // still running (OperationInvalid) or a transient failure
      d.log("task delete pending", { runId, nodeId: node.id, code: res.error.code });
    }
  }

  if (tasksPending > 0 && attempt + 1 < MAX_ATTEMPTS) {
    await d.queue.enqueue("engine-jobs", {
      payload: { op: "cleanup", runId, attempt: attempt + 1 },
      delayMs: RETRY_DELAY_MS,
      dedupeKey: `cleanup:${runId}:${String(attempt + 1)}`,
    });
    return { done: false, blobsDeleted, tasksDeleted, tasksPending };
  }
  if (tasksPending > 0)
    d.log("gave up deleting tasks; YouCam retention will remove them", { runId, tasksPending });
  await updateDoc(d.state, `runs/${runId}`, Run, (cur) => ({
    ...(cur ?? run),
    cleanedAt: new Date(d.clock.now()).toISOString(),
  }));
  return { done: true, blobsDeleted, tasksDeleted, tasksPending };
}
