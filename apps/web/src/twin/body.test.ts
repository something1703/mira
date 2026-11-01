import { describe, expect, it } from "vitest";
import { readAtMost } from "./body";

const request = (chunks: Uint8Array[]) =>
  new Request("http://x.test", {
    method: "POST",
    body: new ReadableStream({
      start(c) {
        for (const chunk of chunks) c.enqueue(chunk);
        c.close();
      },
    }),
    // @ts-expect-error -- Node needs this for a streamed body
    duplex: "half",
  });

describe("readAtMost", () => {
  it("returns every byte of a body within the limit", async () => {
    const out = await readAtMost(request([new Uint8Array([1, 2]), new Uint8Array([3])]), 10);
    expect([...(out ?? [])]).toEqual([1, 2, 3]);
  });

  it("stops and says so when the body is longer than the limit, whatever its header said", async () => {
    expect(await readAtMost(request([new Uint8Array(6), new Uint8Array(6)]), 10)).toBeUndefined();
  });

  it("an empty body is empty", async () => {
    expect((await readAtMost(new Request("http://x.test", { method: "POST" }), 10))?.length).toBe(
      0,
    );
  });
});
