import {
  CONFIG,
  DeletionRecord,
  Run,
  RunNode,
  Twin,
  err,
  newId,
  ok,
  type Result,
} from "@mira/schemas";
import { getDoc, listDocs, type Ports } from "@mira/runtime";
import { savedPrefix } from "../runner/save";
import { UploadRecord, uploadIndexPath, type UploadKind } from "./uploads";

/**
 * Everything MIRA stores about a person, in one place: read it, download it, delete it
 * (docs/UX_FLOWS.md §11, docs/SECURITY_PRIVACY.md §1). The privacy screen is built from
 * `inventory`, so it cannot show less than what is stored; `deleteProfile` removes what
 * `inventory` lists, and a test keeps the two in step.
 */
type Store = Pick<Ports, "state" | "blobs" | "clock">;

export const twinPath = (userId: string) => `twins/${userId}`;
const deletionsPath = (userId: string) => `privacy/${userId}/deletions`;
export const uploadsPrefix = (userId: string) => `uploads/${userId}/`;

export interface SavedLook {
  lookId: string;
  images: number;
}

export interface RunSummary {
  id: string;
  type: Run["type"];
  status: Run["status"];
  startedAt: string;
  unitsSpent: number;
}

export interface Inventory {
  twin: Twin | null;
  proofs: number;
  looks: number;
  savedLooks: SavedLook[];
  /** Captures waiting for a run. They are deleted when the run ends, after a time, or with the profile. */
  pendingUploads: number;
  heldPhotos: { kind: UploadKind; at: string; expiresAt: string }[];
  runs: RunSummary[];
  deletions: DeletionRecord[];
}

async function runsOf(store: Store, userId: string): Promise<Run[]> {
  return (await listDocs(store.state, "runs", Run))
    .map((d) => d.value)
    .filter((r) => r.userId === userId);
}

export async function inventory(store: Store, userId: string): Promise<Inventory> {
  const [twin, proofs, looks, saved, uploads, runs, deletions] = await Promise.all([
    getDoc(store.state, twinPath(userId), Twin),
    store.state.list(`${twinPath(userId)}/proofs`),
    store.state.list(`${twinPath(userId)}/looks`),
    store.blobs.list(savedPrefix(userId)),
    store.blobs.list(uploadsPrefix(userId)),
    runsOf(store, userId),
    listDocs(store.state, deletionsPath(userId), DeletionRecord),
  ]);
  const held: Inventory["heldPhotos"] = [];
  for (const key of uploads) {
    const path = uploadIndexPath(key);
    const rec = UploadRecord.safeParse(
      path === undefined ? undefined : await store.state.get(path),
    );
    if (!rec.success) continue;
    held.push({
      kind: rec.data.kind,
      at: rec.data.at,
      expiresAt: new Date(
        Date.parse(rec.data.at) + CONFIG.twin.heldPhotoMinutes.value * 60_000,
      ).toISOString(),
    });
  }
  const byLook = new Map<string, number>();
  for (const key of saved) {
    const lookId = key.slice(savedPrefix(userId).length).split("/")[0] ?? "";
    byLook.set(lookId, (byLook.get(lookId) ?? 0) + 1);
  }
  return {
    twin: twin ?? null,
    proofs: proofs.length,
    looks: looks.length,
    savedLooks: [...byLook].map(([lookId, images]) => ({ lookId, images })),
    pendingUploads: uploads.length,
    heldPhotos: held.sort((a, b) => a.at.localeCompare(b.at)),
    runs: runs
      .map((r) => ({
        id: r.id,
        type: r.type,
        status: r.status,
        startedAt: r.startedAt,
        unitsSpent: r.unitsSpent,
      }))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    deletions: deletions.map((d) => d.value).sort((a, b) => b.at.localeCompare(a.at)),
  };
}

/** The download: every stored value as JSON. Images are listed, not inlined (they are deleted). */
export async function exportProfile(store: Store, userId: string) {
  const inv = await inventory(store, userId);
  return {
    format: "mira-profile-export",
    version: 1,
    exportedAt: new Date(store.clock.now()).toISOString(),
    userId,
    profile: inv.twin,
    savedLooks: inv.savedLooks,
    proofs: inv.proofs,
    runs: inv.runs,
    deletions: inv.deletions,
  };
}

export type DeleteError =
  | { code: "run_in_progress"; runs: number }
  /** A finished run's YouCam tasks could not be deleted yet (one is still running). Try again. */
  | { code: "cleanup_pending"; runs: number };

export interface DeleteHooks {
  /**
   * Finishes a run's own cleanup (its images and YouCam tasks) before the run record that points to
   * them is removed. Returns false if something could not be deleted yet.
   */
  cleanupRun?: (runId: string) => Promise<boolean>;
}

/**
 * Delete my profile: the Twin, proofs, looks, saved images, pending uploads, the person's runs and
 * the cached analyser results those runs produced. Leaves a record of counts. Refuses while a run
 * is still going, because a running run would write the profile straight back.
 */
export async function deleteProfile(
  store: Store,
  userId: string,
  hooks: DeleteHooks = {},
): Promise<Result<DeletionRecord, DeleteError>> {
  const runs = await runsOf(store, userId);
  const running = runs.filter((r) => r.status === "running");
  if (running.length > 0) return err({ code: "run_in_progress", runs: running.length });

  // A run that has not been cleaned still holds photos and YouCam tasks. Deleting its record first
  // would orphan them, so they are cleaned now, or the delete waits.
  const dirty = runs.filter((r) => r.cleanedAt === undefined);
  if (hooks.cleanupRun) {
    let pending = 0;
    for (const r of dirty) if (!(await hooks.cleanupRun(r.id))) pending += 1;
    if (pending > 0) return err({ code: "cleanup_pending", runs: pending });
  }

  const inv = await inventory(store, userId);
  let cachedResults = 0;
  let unitRecords = 0;
  for (const run of runs) {
    for (const { value: node } of await listDocs(store.state, `runs/${run.id}/nodes`, RunNode)) {
      if (
        node.cacheKey !== undefined &&
        (await store.state.get(`cache/${node.cacheKey}`)) !== undefined
      ) {
        await store.state.delete(`cache/${node.cacheKey}`);
        cachedResults += 1;
      }
    }
    // Unit accounting records and the task index point at the run; they go with it. The session's
    // running total in `budgets/` stays (it is a count with no link to a person) so that deleting a
    // profile cannot be used to reset a spending cap.
    for (const { id, value } of await store.state.list("ledger")) {
      if ((value as { runId?: string }).runId === run.id) {
        await store.state.delete(`ledger/${id}`);
        unitRecords += 1;
      }
    }
    for (const { value: node } of await listDocs(store.state, `runs/${run.id}/nodes`, RunNode)) {
      if (node.taskId !== undefined) await store.state.delete(`tasks/${node.taskId}`);
    }
    await store.state.deleteTree(`runs/${run.id}`);
  }
  const savedImages = await store.blobs.deletePrefix(savedPrefix(userId));
  const uploads = await store.blobs.deletePrefix(uploadsPrefix(userId));
  await store.state.deleteTree(`uploads-index/${userId}`);
  // Garments the person added for looks: a name and a colour each, and their pictures are uploads.
  await store.state.deleteTree(`garments/${userId}`);
  await store.state.deleteTree(twinPath(userId));

  const record = DeletionRecord.parse({
    id: newId("del"),
    at: new Date(store.clock.now()).toISOString(),
    removed: {
      readings: Object.keys(inv.twin?.metrics ?? {}).length,
      proofs: inv.proofs,
      savedLooks: inv.savedLooks.length,
      savedImages,
      uploads,
      runs: runs.length,
      cachedResults,
      unitRecords,
    },
  });
  await store.state.set(`${deletionsPath(userId)}/${record.id}`, record);
  return ok(record);
}
