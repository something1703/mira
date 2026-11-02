import type { Bucket } from "@google-cloud/storage";
import type { Blob, BlobStore } from "../ports/blobs";

/**
 * The live blob store: one Cloud Storage bucket (`GCS_BUCKET_TEMP`), whose lifecycle rule deletes
 * anything over a day old as the backstop (docs/DATA_MODEL.md §2). Keys are object names.
 *
 * Only the part of `Bucket` that is used is named here, so the tests can stand in for it.
 */
export type BucketLike = Pick<Bucket, "file" | "getFiles">;

const NOT_FOUND = 404;

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: unknown }).code === NOT_FOUND
  );
}

export class GcsBlobStore implements BlobStore {
  constructor(private readonly bucket: BucketLike) {}

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    // A single request, not a resumable upload: pictures are a few MB at most.
    await this.bucket.file(key).save(Buffer.from(bytes), { contentType, resumable: false });
  }

  async get(key: string): Promise<Blob | undefined> {
    const file = this.bucket.file(key);
    try {
      const [[data], [meta]] = await Promise.all([file.download(), file.getMetadata()]);
      return {
        bytes: Uint8Array.from(data),
        contentType: typeof meta.contentType === "string" ? meta.contentType : "",
      };
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await this.bucket.file(key).delete({ ignoreNotFound: true });
  }

  async deletePrefix(prefix: string): Promise<number> {
    const names = await this.list(prefix);
    // Not all at once: a run has a handful of pictures, but a profile delete can have more.
    for (let i = 0; i < names.length; i += 20) {
      await Promise.all(
        names.slice(i, i + 20).map(async (n) => {
          await this.delete(n);
        }),
      );
    }
    return names.length;
  }

  async list(prefix: string): Promise<string[]> {
    const [files] = await this.bucket.getFiles({ prefix });
    return files.map((f) => f.name).sort();
  }
}
