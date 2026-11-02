import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * State port (D10). `mira-workflows` is the only writer of run state; everything else reads it
 * through its API. Paths look like Firestore's: `runs/run_x/nodes/fetch`. Values are JSON.
 */
export interface StateStore {
  /** Raw JSON, or undefined. Validate with `getDoc` and a Zod schema at the boundary (AGENTS §7). */
  get(path: string): Promise<unknown>;
  set(path: string, value: unknown): Promise<void>;
  /**
   * Read-modify-write that no other `update` on the same store can interleave with. Live this is a
   * Firestore transaction. Returning the current value unchanged is allowed.
   */
  update(path: string, fn: (current: unknown) => unknown): Promise<unknown>;
  /** Documents directly under a collection path, e.g. `runs/run_x/nodes`. */
  list(collection: string): Promise<{ id: string; value: unknown }[]>;
  delete(path: string): Promise<void>;
  /** Deletes a document and everything beneath it (a run and its nodes). */
  deleteTree(path: string): Promise<void>;
}

/** A rejected promise for a malformed path, or undefined when the path is fine. */
export function badPath(path: string): Promise<never> | undefined {
  if (path === "" || path.startsWith("/") || path.endsWith("/") || path.includes("//")) {
    return Promise.reject(new Error(`Invalid state path: ${JSON.stringify(path)}`));
  }
  return undefined;
}

/** In-memory store. Values are stored as JSON text, so callers never share references. */
export class MemoryStateStore implements StateStore {
  protected readonly docs = new Map<string, string>();
  private lock: Promise<unknown> = Promise.resolve();

  get(path: string): Promise<unknown> {
    const bad = badPath(path);
    if (bad) return bad;
    const raw = this.docs.get(path);
    return Promise.resolve(raw === undefined ? undefined : (JSON.parse(raw) as unknown));
  }

  set(path: string, value: unknown): Promise<void> {
    const bad = badPath(path);
    if (bad) return bad;
    this.put(path, JSON.stringify(value));
    return Promise.resolve();
  }

  update(path: string, fn: (current: unknown) => unknown): Promise<unknown> {
    const bad = badPath(path);
    if (bad) return bad;
    const run = async (): Promise<unknown> => {
      const raw = this.docs.get(path);
      const next = fn(raw === undefined ? undefined : (JSON.parse(raw) as unknown));
      this.put(path, JSON.stringify(next));
      return await Promise.resolve(JSON.parse(JSON.stringify(next)) as unknown);
    };
    const result = this.lock.then(run, run);
    this.lock = result.catch(() => undefined);
    return result;
  }

  list(collection: string): Promise<{ id: string; value: unknown }[]> {
    const bad = badPath(collection);
    if (bad) return bad;
    const prefix = `${collection}/`;
    const out: { id: string; value: unknown }[] = [];
    for (const [path, raw] of this.docs) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      if (!rest.includes("/")) out.push({ id: rest, value: JSON.parse(raw) as unknown });
    }
    return Promise.resolve(out.sort((a, b) => a.id.localeCompare(b.id)));
  }

  delete(path: string): Promise<void> {
    const bad = badPath(path);
    if (bad) return bad;
    this.remove(path);
    return Promise.resolve();
  }

  deleteTree(path: string): Promise<void> {
    const bad = badPath(path);
    if (bad) return bad;
    for (const key of [...this.docs.keys()]) {
      if (key === path || key.startsWith(`${path}/`)) this.remove(key);
    }
    return Promise.resolve();
  }

  protected put(path: string, json: string): void {
    this.docs.set(path, json);
  }

  protected remove(path: string): void {
    this.docs.delete(path);
  }
}

/**
 * File-backed store for `pnpm dev:mock`: one JSON file per document, written atomically, loaded
 * on start so state survives a restart. Single process only, like the service that owns it.
 */
export class FileStateStore extends MemoryStateStore {
  constructor(private readonly dir: string) {
    super();
    mkdirSync(dir, { recursive: true });
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".json")) continue;
      this.docs.set(
        decodeURIComponent(name.slice(0, -".json".length)),
        readFileSync(join(dir, name), "utf8"),
      );
    }
  }

  private file(path: string): string {
    return join(this.dir, `${encodeURIComponent(path)}.json`);
  }

  protected override put(path: string, json: string): void {
    super.put(path, json);
    const target = this.file(path);
    const tmp = `${target}.tmp`;
    writeFileSync(tmp, json);
    renameSync(tmp, target);
  }

  protected override remove(path: string): void {
    super.remove(path);
    rmSync(this.file(path), { force: true });
  }
}
