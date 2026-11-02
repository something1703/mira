import { Firestore } from "@google-cloud/firestore";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { FirestoreStateStore } from "../src/gcp/firestore";

/**
 * Runs only against the Firestore emulator (`pnpm --filter @mira/runtime test:emulator` starts one
 * and sets FIRESTORE_EMULATOR_HOST). Without it these tests are skipped, not passed.
 */
const emulator = process.env.FIRESTORE_EMULATOR_HOST;
const db = emulator ? new Firestore({ projectId: "mira-test" }) : undefined;
afterAll(async () => {
  await db?.terminate();
});

describe.skipIf(!emulator)("FirestoreStateStore (emulator)", () => {
  const make = () => new FirestoreStateStore(db as Firestore, `t_${randomUUID()}`);

  it("round-trips JSON, including arrays of arrays, without sharing references", async () => {
    const s = make();
    const v = { a: 1, history: [[1, 2], [3]], nested: { b: [1, 2] } };
    await s.set("runs/run_1", v);
    v.nested.b.push(3);
    expect(await s.get("runs/run_1")).toEqual({
      a: 1,
      history: [[1, 2], [3]],
      nested: { b: [1, 2] },
    });
    expect(await s.get("runs/none")).toBeUndefined();
  });

  it("stores paths that are not collection/document pairs", async () => {
    const s = make();
    await s.set("brand/catalogue/user_1", { n: 1 });
    await s.set("prefs", { top: true });
    expect(await s.get("brand/catalogue/user_1")).toEqual({ n: 1 });
    expect((await s.list("brand/catalogue")).map((d) => d.id)).toEqual(["user_1"]);
    expect(await s.get("prefs")).toEqual({ top: true });
  });

  it("update is serialised: 25 concurrent increments lose none", { timeout: 60_000 }, async () => {
    const s = make();
    await Promise.all(
      Array.from({ length: 25 }, () =>
        s.update("counters/c", (cur) => ({ n: ((cur as { n?: number } | undefined)?.n ?? 0) + 1 })),
      ),
    );
    expect(await s.get("counters/c")).toEqual({ n: 25 });
  });

  it("a throwing update changes nothing", async () => {
    const s = make();
    await s.set("x/1", { v: 1 });
    await expect(
      s.update("x/1", () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await s.get("x/1")).toEqual({ v: 1 });
    expect(await s.update("x/1", (c) => ({ v: (c as { v: number }).v + 1 }))).toEqual({ v: 2 });
  });

  it("lists only direct children, deletes one and a whole tree", async () => {
    const s = make();
    await s.set("runs/run_1", { id: 1 });
    await s.set("runs/run_1/nodes/a", { id: "a" });
    await s.set("runs/run_1/nodes/b", { id: "b" });
    await s.set("runs/run_10", { id: 10 }); // shares the prefix "runs/run_1" but is not beneath it
    await s.set("runs/run_2", { id: 2 });
    expect((await s.list("runs")).map((d) => d.id)).toEqual(["run_1", "run_10", "run_2"]);
    expect((await s.list("runs/run_1/nodes")).map((d) => d.id)).toEqual(["a", "b"]);
    await s.delete("runs/run_1/nodes/a");
    expect((await s.list("runs/run_1/nodes")).map((d) => d.id)).toEqual(["b"]);
    await s.deleteTree("runs/run_1");
    expect(await s.get("runs/run_1")).toBeUndefined();
    expect(await s.get("runs/run_1/nodes/b")).toBeUndefined();
    expect(await s.get("runs/run_10")).toEqual({ id: 10 });
    expect(await s.get("runs/run_2")).toEqual({ id: 2 });
  });

  it("deletes a tree larger than one batch", async () => {
    const s = make();
    await Promise.all(Array.from({ length: 450 }, (_, i) => s.set(`big/t/items/i${i}`, { i })));
    await s.set("big/t", { root: true });
    await s.deleteTree("big/t");
    expect(await s.list("big/t/items")).toEqual([]);
    expect(await s.get("big/t")).toBeUndefined();
  }, 60_000);

  it("rejects malformed and reserved paths", async () => {
    const s = make();
    for (const bad of ["", "/a", "a/", "a//b"]) await expect(s.get(bad)).rejects.toThrow("Invalid");
    await expect(s.set("__reserved__", {})).rejects.toThrow("Invalid");
    await expect(s.set("..", {})).rejects.toThrow("Invalid");
    await expect(s.set("a/b", undefined)).rejects.toThrow("JSON");
  });
});
