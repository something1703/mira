import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface Blob {
  bytes: Uint8Array;
  contentType: string;
}

/** Image storage (SECURITY_PRIVACY §1). Keys look like `runs/{runId}/{nodeId}/input.jpg`. */
export interface BlobStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Blob | undefined>;
  delete(key: string): Promise<void>;
  /** Deletes every blob under a prefix; returns how many. Used at the end of every run. */
  deletePrefix(prefix: string): Promise<number>;
  list(prefix: string): Promise<string[]>;
}

export class MemoryBlobStore implements BlobStore {
  protected readonly blobs = new Map<string, Blob>();

  put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    this.write(key, { bytes: Uint8Array.from(bytes), contentType });
    return Promise.resolve();
  }

  get(key: string): Promise<Blob | undefined> {
    const blob = this.blobs.get(key);
    return Promise.resolve(
      blob && { bytes: Uint8Array.from(blob.bytes), contentType: blob.contentType },
    );
  }

  delete(key: string): Promise<void> {
    this.erase(key);
    return Promise.resolve();
  }

  deletePrefix(prefix: string): Promise<number> {
    const keys = [...this.blobs.keys()].filter((k) => k.startsWith(prefix));
    for (const k of keys) this.erase(k);
    return Promise.resolve(keys.length);
  }

  list(prefix: string): Promise<string[]> {
    return Promise.resolve([...this.blobs.keys()].filter((k) => k.startsWith(prefix)).sort());
  }

  protected write(key: string, blob: Blob): void {
    this.blobs.set(key, blob);
  }

  protected erase(key: string): void {
    this.blobs.delete(key);
  }
}

/** Local-disk blobs for `pnpm dev:mock`, so a run's images survive a restart and can be inspected. */
export class FileBlobStore extends MemoryBlobStore {
  constructor(private readonly dir: string) {
    super();
    mkdirSync(dir, { recursive: true });
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".meta")) continue;
      const stem = name.slice(0, -".meta".length);
      this.blobs.set(decodeURIComponent(stem), {
        bytes: readFileSync(join(dir, `${stem}.bin`)),
        contentType: readFileSync(join(dir, name), "utf8"),
      });
    }
  }

  protected override write(key: string, blob: Blob): void {
    super.write(key, blob);
    const stem = join(this.dir, encodeURIComponent(key));
    writeFileSync(`${stem}.bin`, blob.bytes);
    writeFileSync(`${stem}.meta`, blob.contentType);
  }

  protected override erase(key: string): void {
    super.erase(key);
    const stem = join(this.dir, encodeURIComponent(key));
    rmSync(`${stem}.bin`, { force: true });
    rmSync(`${stem}.meta`, { force: true });
  }
}
