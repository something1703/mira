import { describe, expect, it } from "vitest";
import { GcsBlobStore, type BucketLike } from "../src/gcp/storage";

/** A stand-in for the part of the Storage client the adapter uses. It is not the real service. */
function fakeBucket(): BucketLike & {
  objects: Map<string, { data: Buffer; contentType: string }>;
} {
  const objects = new Map<string, { data: Buffer; contentType: string }>();
  const missing = () => Object.assign(new Error("No such object"), { code: 404 });
  const bucket = {
    objects,
    file(name: string) {
      return {
        name,
        save: (data: Buffer, o: { contentType: string }) => {
          objects.set(name, { data, contentType: o.contentType });
          return Promise.resolve();
        },
        download: () => {
          const o = objects.get(name);
          return o ? Promise.resolve([o.data]) : Promise.reject(missing());
        },
        getMetadata: () => {
          const o = objects.get(name);
          return o ? Promise.resolve([{ contentType: o.contentType }]) : Promise.reject(missing());
        },
        delete: () => {
          objects.delete(name);
          return Promise.resolve();
        },
      };
    },
    getFiles: ({ prefix }: { prefix: string }) =>
      Promise.resolve([
        [...objects.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })),
      ]),
  };
  return bucket as unknown as BucketLike & { objects: typeof objects };
}

describe("GcsBlobStore (against a fake of the client)", () => {
  it("stores, copies, lists and deletes by prefix", async () => {
    const b = new GcsBlobStore(fakeBucket());
    const bytes = new Uint8Array([1, 2, 3]);
    await b.put("runs/run_1/a/input.jpg", bytes, "image/jpeg");
    await b.put("runs/run_1/a/output.png", new Uint8Array([9]), "image/png");
    await b.put("runs/run_2/a/input.jpg", new Uint8Array([7]), "image/jpeg");
    bytes[0] = 99;
    expect(await b.get("runs/run_1/a/input.jpg")).toEqual({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "image/jpeg",
    });
    expect(await b.list("runs/run_1/")).toHaveLength(2);
    expect(await b.deletePrefix("runs/run_1/")).toBe(2);
    expect(await b.list("runs/")).toEqual(["runs/run_2/a/input.jpg"]);
    await b.delete("runs/run_2/a/input.jpg");
    expect(await b.get("runs/run_2/a/input.jpg")).toBeUndefined();
  });

  it("treats a missing object as absent and any other failure as an error", async () => {
    const bucket = fakeBucket();
    const b = new GcsBlobStore(bucket);
    expect(await b.get("nope")).toBeUndefined();
    const broken = {
      file: () => ({
        download: () => Promise.reject(Object.assign(new Error("denied"), { code: 403 })),
        getMetadata: () => Promise.reject(Object.assign(new Error("denied"), { code: 403 })),
      }),
    } as unknown as BucketLike;
    await expect(new GcsBlobStore(broken).get("k")).rejects.toThrow("denied");
  });

  it("deletes a prefix larger than one chunk", async () => {
    const bucket = fakeBucket();
    const b = new GcsBlobStore(bucket);
    for (let i = 0; i < 45; i++) await b.put(`saved/u/${i}.png`, new Uint8Array([i]), "image/png");
    expect(await b.deletePrefix("saved/u/")).toBe(45);
    expect(bucket.objects.size).toBe(0);
  });
});
