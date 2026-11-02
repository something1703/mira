import type { Firestore } from "@google-cloud/firestore";
import { badPath, type StateStore } from "../ports/state";

/**
 * The live state store (D10, D42): Firestore behind the same interface as the memory and file
 * stores.
 *
 * Every document lives in one collection, whatever its path. A MIRA path is not always an
 * alternating collection/document pair (`brand/catalogue/{userId}` has three parts), and the
 * value can be any JSON, including arrays of arrays, which Firestore does not store natively. So a
 * document holds `path`, `parent` (for `list`) and `json` (the value as text). Only the services
 * read and write it, as service accounts; people reach their own data through the services'
 * APIs, so no field-level rule is needed and the security rule denies every client.
 */
export const DEFAULT_COLLECTION = "mira_state";
const BATCH = 400;

interface Row {
  path: string;
  parent: string;
  json: string;
}

/** Firestore document ids cannot be `.`, `..`, `__x__`, or over 1,500 bytes. */
function idFor(path: string): string {
  const id = encodeURIComponent(path);
  if (id === "." || id === ".." || /^__.*__$/.test(id) || Buffer.byteLength(id) > 1_500) {
    throw new Error(`Invalid state path: ${JSON.stringify(path.slice(0, 80))}`);
  }
  return id;
}

const parentOf = (path: string) => path.slice(0, Math.max(path.lastIndexOf("/"), 0));

function parse(json: string): unknown {
  return JSON.parse(json) as unknown;
}

export class FirestoreStateStore implements StateStore {
  constructor(
    private readonly db: Firestore,
    private readonly collection: string = DEFAULT_COLLECTION,
  ) {}

  private doc(path: string) {
    return this.db.collection(this.collection).doc(idFor(path));
  }

  private row(path: string, value: unknown): Row {
    // JSON.stringify drops `undefined` fields and turns a bare `undefined` into nothing: store
    // that as a missing document, the same as the other stores.
    const json = JSON.stringify(value) as string | undefined;
    if (json === undefined) throw new Error("A state value must be JSON");
    return { path, parent: parentOf(path), json };
  }

  async get(path: string): Promise<unknown> {
    const bad = badPath(path);
    if (bad) return await bad;
    const snap = await this.doc(path).get();
    return snap.exists ? parse((snap.data() as Row).json) : undefined;
  }

  async set(path: string, value: unknown): Promise<void> {
    const bad = badPath(path);
    if (bad) return await bad;
    await this.doc(path).set(this.row(path, value));
  }

  async update(path: string, fn: (current: unknown) => unknown): Promise<unknown> {
    const bad = badPath(path);
    if (bad) return await bad;
    const ref = this.doc(path);
    // Firestore retries the function when another writer got in first, so `fn` may run more than
    // once and must not have effects of its own (it is already documented as read-modify-write).
    return await this.db.runTransaction(
      async (tx) => {
        const snap = await tx.get(ref);
        const next = fn(snap.exists ? parse((snap.data() as Row).json) : undefined);
        tx.set(ref, this.row(path, next));
        return parse(JSON.stringify(next));
      },
      // The default is 5 tries; a counter that many runs touch at once needs more before it gives up.
      { maxAttempts: 30 },
    );
  }

  async list(collection: string): Promise<{ id: string; value: unknown }[]> {
    const bad = badPath(collection);
    if (bad) return await bad;
    const snap = await this.db.collection(this.collection).where("parent", "==", collection).get();
    return snap.docs
      .map((d) => {
        const row = d.data() as Row;
        return { id: row.path.slice(collection.length + 1), value: parse(row.json) };
      })
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  async delete(path: string): Promise<void> {
    const bad = badPath(path);
    if (bad) return await bad;
    await this.doc(path).delete();
  }

  async deleteTree(path: string): Promise<void> {
    const bad = badPath(path);
    if (bad) return await bad;
    // Everything beneath `path/` sorts between `path/` and `path0` ("0" follows "/").
    const beneath = await this.db
      .collection(this.collection)
      .where("path", ">=", `${path}/`)
      .where("path", "<", `${path}0`)
      .get();
    const refs = [this.doc(path), ...beneath.docs.map((d) => d.ref)];
    for (let i = 0; i < refs.length; i += BATCH) {
      const batch = this.db.batch();
      for (const ref of refs.slice(i, i + BATCH)) batch.delete(ref);
      await batch.commit();
    }
  }
}
