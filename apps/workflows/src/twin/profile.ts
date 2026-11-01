import { DeletionRecord, Run, RunNode, Twin, err, newId, ok, type Result } from "@mira/schemas";
import { getDoc, listDocs, type Ports } from "@mira/runtime";
import { savedPrefix } from "../runner/save";

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
  /** Captures waiting for a run. They are deleted when the run ends or with the profile. */
  pendingUploads: number;
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

export type DeleteError = { code: "run_in_progress"; runs: number };

/**
 * Delete my profile: the Twin, proofs, looks, saved images, pending uploads, the person's runs and
 * the cached analyser results those runs produced. Leaves a record of counts. Refuses while a run
 * is still going, because a running run would write the profile straight back.
 */
export async function deleteProfile(
  store: Store,
  userId: string,
): Promise<Result<DeletionRecord, DeleteError>> {
  const runs = await runsOf(store, userId);
  const running = runs.filter((r) => r.status === "running");
  if (running.length > 0) return err({ code: "run_in_progress", runs: running.length });

  const inv = await inventory(store, userId);
  let cachedResults = 0;
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
    await store.state.deleteTree(`runs/${run.id}`);
  }
  const savedImages = await store.blobs.deletePrefix(savedPrefix(userId));
  const uploads = await store.blobs.deletePrefix(uploadsPrefix(userId));
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
    },
  });
  await store.state.set(`${deletionsPath(userId)}/${record.id}`, record);
  return ok(record);
}
