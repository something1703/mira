import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  FakeClock,
  FileBlobStore,
  FileStateStore,
  InProcessEventBus,
  InProcessQueue,
  MemoryBlobStore,
  MemoryStateStore,
  createMockPorts,
  getDoc,
  listDocs,
  updateDoc,
  type Delivery,
} from "../src";

const Counter = z.object({ n: z.number() });
const V = z.object({ v: z.number() });
const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "mira-ports-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe.each([
  ["memory", () => new MemoryStateStore()],
  ["file", () => new FileStateStore(tmp())],
])("StateStore (%s)", (_name, make) => {
  it("round-trips JSON without sharing references", async () => {
    const s = make();
    const v = { a: 1, nested: { b: [1, 2] } };
    await s.set("runs/run_1", v);
    v.nested.b.push(3);
    const got = await s.get("runs/run_1");
    expect(got).toEqual({ a: 1, nested: { b: [1, 2] } });
    expect(await s.get("runs/none")).toBeUndefined();
  });

  it("update is serialised: 50 concurrent increments lose none", async () => {
    const s = make();
    await Promise.all(
      Array.from({ length: 50 }, () =>
        updateDoc(s, "counters/c", Counter, (cur) => ({ n: (cur?.n ?? 0) + 1 })),
      ),
    );
    expect(await s.get("counters/c")).toEqual({ n: 50 });
  });

  it("a throwing update changes nothing and does not poison the lock", async () => {
    const s = make();
    await s.set("x/1", { v: 1 });
    await expect(
      s.update("x/1", () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await updateDoc(s, "x/1", V, (c) => ({ v: (c?.v ?? 0) + 1 }))).toEqual({ v: 2 });
  });

  it("lists only direct children, deletes one and a whole tree", async () => {
    const s = make();
    await s.set("runs/run_1", { id: 1 });
    await s.set("runs/run_1/nodes/a", { id: "a" });
    await s.set("runs/run_1/nodes/b", { id: "b" });
    await s.set("runs/run_2", { id: 2 });
    expect((await s.list("runs")).map((d) => d.id)).toEqual(["run_1", "run_2"]);
    expect((await s.list("runs/run_1/nodes")).map((d) => d.id)).toEqual(["a", "b"]);
    await s.delete("runs/run_1/nodes/a");
    expect((await s.list("runs/run_1/nodes")).map((d) => d.id)).toEqual(["b"]);
    await s.deleteTree("runs/run_1");
    expect(await s.get("runs/run_1/nodes/b")).toBeUndefined();
    expect(await s.get("runs/run_2")).toEqual({ id: 2 });
  });

  it("rejects malformed paths", async () => {
    const s = make();
    for (const bad of ["", "/a", "a/", "a//b"]) await expect(s.get(bad)).rejects.toThrow("Invalid");
  });
});

describe("typed helpers", () => {
  it("validate at the boundary", async () => {
    const s = new MemoryStateStore();
    await s.set("a/ok", { n: 1 });
    await s.set("a/bad", { n: "one" });
    expect(await getDoc(s, "a/ok", Counter)).toEqual({ n: 1 });
    expect(await getDoc(s, "a/none", Counter)).toBeUndefined();
    await expect(getDoc(s, "a/bad", Counter)).rejects.toThrow();
    await expect(listDocs(s, "a", Counter)).rejects.toThrow();
    await expect(updateDoc(s, "a/bad", Counter, (c) => c ?? { n: 0 })).rejects.toThrow();
  });
});

it("FileStateStore survives a restart", async () => {
  const dir = tmp();
  await new FileStateStore(dir).set("runs/run_1/nodes/a", { taskId: "t1" });
  expect(await new FileStateStore(dir).get("runs/run_1/nodes/a")).toEqual({ taskId: "t1" });
});

describe("InProcessQueue", () => {
  const setup = (opts: { maxAttempts?: number } = {}) => {
    const clock = new FakeClock();
    const dead: Delivery[] = [];
    const q = new InProcessQueue({ clock, onDead: (d) => dead.push(d), ...opts });
    const got: Delivery[] = [];
    return { clock, q, got, dead };
  };

  it("delivers due tasks in order and holds delayed ones until their time", async () => {
    const { clock, q, got } = setup();
    q.setHandler((d) => {
      got.push(d);
      return Promise.resolve();
    });
    await q.enqueue("youcam-poll", { payload: { n: 2 }, delayMs: 5_000 });
    await q.enqueue("youcam-poll", { payload: { n: 1 } });
    expect(await q.tick()).toBe(1);
    expect(got.map((d) => d.payload)).toEqual([{ n: 1 }]);
    await clock.advance(4_999);
    expect(await q.tick()).toBe(0);
    await clock.advance(1);
    expect(await q.tick()).toBe(1);
    expect(got.map((d) => d.payload)).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it("drops a duplicate dedupe key", async () => {
    const { q } = setup();
    expect(await q.enqueue("youcam-poll", { payload: 1, dedupeKey: "poll:run_1:a:3" })).toEqual({
      accepted: true,
    });
    expect(await q.enqueue("youcam-poll", { payload: 1, dedupeKey: "poll:run_1:a:3" })).toEqual({
      accepted: false,
    });
    expect(await q.enqueue("engine-jobs", { payload: 1, dedupeKey: "poll:run_1:a:3" })).toEqual({
      accepted: true,
    });
  });

  it("retries a failing handler with backoff, then reports it dead", async () => {
    const { clock, q, dead } = setup({ maxAttempts: 3 });
    const attempts: number[] = [];
    q.setHandler((d) => {
      attempts.push(d.attempt);
      return Promise.reject(new Error("transient"));
    });
    await q.enqueue("youcam-submit", { payload: "x" });
    await q.tick();
    expect(attempts).toEqual([1]);
    await clock.advance(1_000);
    await q.tick();
    await clock.advance(2_000);
    await q.tick();
    expect(attempts).toEqual([1, 2, 3]);
    expect(dead).toHaveLength(1);
    expect(q.snapshot()).toHaveLength(0);
  });

  it("copies the payload so later mutation cannot change a queued task", async () => {
    const { q, got } = setup();
    q.setHandler((d) => {
      got.push(d);
      return Promise.resolve();
    });
    const payload = { id: 1 };
    await q.enqueue("engine-jobs", { payload });
    payload.id = 2;
    await q.tick();
    expect(got[0]?.payload).toEqual({ id: 1 });
  });

  it("start and stop tick on a timer", async () => {
    vi.useFakeTimers();
    try {
      const { q, got } = setup();
      q.setHandler((d) => {
        got.push(d);
        return Promise.resolve();
      });
      await q.enqueue("engine-jobs", { payload: 1 });
      q.start(100);
      await vi.advanceTimersByTimeAsync(150);
      q.stop();
      expect(got).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses to tick without a handler", async () => {
    await expect(setup().q.tick()).rejects.toThrow("no handler");
  });
});

describe("InProcessEventBus", () => {
  it("fans out, unsubscribes, and survives a failing subscriber", async () => {
    const bus = new InProcessEventBus();
    const got: unknown[] = [];
    bus.subscribe("run-events", () => {
      throw new Error("bad subscriber");
    });
    const off = bus.subscribe("run-events", (e) => {
      got.push(e);
    });
    await bus.publish("run-events", { type: "node_done" });
    off();
    await bus.publish("run-events", { type: "run_finished" });
    expect(got).toEqual([{ type: "node_done" }]);
  });
});

describe.each([
  ["memory", () => new MemoryBlobStore()],
  ["file", () => new FileBlobStore(tmp())],
])("BlobStore (%s)", (_name, make) => {
  it("stores, copies, lists and deletes by prefix", async () => {
    const b = make();
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
});

it("FileBlobStore survives a restart", async () => {
  const dir = tmp();
  await new FileBlobStore(dir).put("runs/r/a.png", new Uint8Array([5, 6]), "image/png");
  expect(await new FileBlobStore(dir).get("runs/r/a.png")).toEqual({
    bytes: new Uint8Array([5, 6]),
    contentType: "image/png",
  });
});

it("createMockPorts wires every port, in memory or on disk", async () => {
  for (const ports of [createMockPorts(), createMockPorts({ dir: tmp() })]) {
    await ports.state.set("a/1", { ok: true });
    expect(await ports.state.get("a/1")).toEqual({ ok: true });
    await ports.blobs.put("k", new Uint8Array([1]), "image/png");
    expect(await ports.blobs.list("")).toEqual(["k"]);
  }
});
