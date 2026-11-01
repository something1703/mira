import { FakeClock, MemoryStateStore } from "@mira/runtime";
import { describe, expect, it } from "vitest";
import { Ledger } from "../src/lifecycle/ledger";
import { cacheKey, canonicalJson, sha256 } from "../src/lifecycle/canonical";
import { validateGraph } from "../src/runner/graph";

const node = (n: number, run = "run_aaaaaa") => ({
  runId: run,
  nodeId: `n${String(n)}`,
  sessionId: "ses_aaaaaa",
  feature: "sod",
});

describe("Ledger", () => {
  const make = (caps = { node: 10, run: 100, session: 25 }) =>
    new Ledger(new MemoryStateStore(), new FakeClock(), caps);

  it("ten concurrent reserves against a 25-unit session cap admit exactly five", async () => {
    const ledger = make();
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => ledger.reserve(node(i), 5, undefined)),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(5);
    const refused = results.filter((r) => !r.ok);
    expect(refused).toHaveLength(5);
    expect(refused.map((r) => (r.ok ? "ok" : r.error.code))).toEqual(
      Array<string>(5).fill("over_cap"),
    );
    expect((await ledger.budget("ses_aaaaaa")).reserved).toBe(25);
  });

  it("reserving the same node twice reserves once", async () => {
    const ledger = make();
    await ledger.reserve(node(1), 5, undefined);
    await ledger.reserve(node(1), 5, undefined);
    expect((await ledger.budget("ses_aaaaaa")).reserved).toBe(5);
    expect(await ledger.entries("run_aaaaaa")).toHaveLength(1);
  });

  it("closing twice does not double count; closing an unknown node is a no-op", async () => {
    const ledger = make();
    await ledger.reserve(node(1), 5, undefined);
    expect(await ledger.commit(node(1))).toBe(5);
    expect(await ledger.commit(node(1))).toBe(0);
    expect(await ledger.release(node(1))).toBe(0);
    expect(await ledger.release(node(9))).toBe(0);
    expect(await ledger.budget("ses_aaaaaa")).toMatchObject({ reserved: 0, committed: 5 });
  });

  it("release returns the units to the session", async () => {
    const ledger = make();
    await ledger.reserve(node(1), 10, undefined);
    expect(await ledger.sessionUnitsLeft("ses_aaaaaa")).toBe(15);
    await ledger.release(node(1));
    expect(await ledger.sessionUnitsLeft("ses_aaaaaa")).toBe(25);
  });

  it("enforces each cap and names which one tripped", async () => {
    const ledger = make({ node: 10, run: 12, session: 100 });
    expect(await ledger.reserve(node(1), 11, undefined)).toMatchObject({
      ok: false,
      error: { scope: "node" },
    });
    await ledger.reserve(node(2), 10, undefined);
    expect(await ledger.reserve(node(3), 5, undefined)).toMatchObject({
      ok: false,
      error: { scope: "run" },
    });
    expect((await ledger.reserve(node(4, "run_bbbbbb"), 5, undefined)).ok).toBe(true);
  });

  it("checks the live balance net of what is already reserved", async () => {
    const ledger = make();
    await ledger.reserve(node(1), 8, 10);
    expect(await ledger.reserve(node(2), 5, 10)).toMatchObject({
      ok: false,
      error: { code: "insufficient_units", balance: 2 },
    });
  });

  it("rounds a fractional price up so a reserve never under-covers", async () => {
    const ledger = make();
    expect(await ledger.reserve(node(1), 2.2, undefined)).toEqual({ ok: true, value: 3 });
  });
});

describe("cache keys", () => {
  it("canonical JSON ignores key order and undefined", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: undefined }] })).toBe(
      canonicalJson({ a: [2, { d: 1 }], b: 1 }),
    );
    expect(canonicalJson(undefined)).toBe("null");
  });

  it("every part of the key changes it", () => {
    const base = {
      inputHash: sha256("x"),
      feature: "f",
      version: "v2.0",
      params: { a: 1 },
      engineVersion: "1",
    };
    const k = cacheKey(base);
    expect(cacheKey({ ...base, params: { a: 1 } })).toBe(k);
    for (const change of [
      { inputHash: sha256("y") },
      { feature: "g" },
      { version: "v2.1" },
      { params: { a: 2 } },
      { engineVersion: "2" },
    ]) {
      expect(cacheKey({ ...base, ...change })).not.toBe(k);
    }
  });
});

describe("validateGraph", () => {
  const n = (id: string, dependsOn: string[] = []) => ({
    id,
    kind: "system" as const,
    label: id,
    dependsOn,
  });
  it("accepts a DAG and reports each kind of error", () => {
    expect(
      validateGraph({ type: "demo", nodes: [n("a"), n("b", ["a"]), n("c", ["a", "b"])] }),
    ).toBeUndefined();
    expect(validateGraph({ type: "demo", nodes: [] })).toEqual({ code: "empty_graph" });
    expect(validateGraph({ type: "demo", nodes: [n("a"), n("a")] })).toMatchObject({
      code: "duplicate_node",
    });
    expect(validateGraph({ type: "demo", nodes: [n("a", ["zz"])] })).toMatchObject({
      code: "unknown_dependency",
    });
    expect(validateGraph({ type: "demo", nodes: [n("a", ["a"])] })).toMatchObject({
      code: "self_dependency",
    });
    expect(
      validateGraph({ type: "demo", nodes: [n("a", ["c"]), n("b", ["a"]), n("c", ["b"])] }),
    ).toMatchObject({ code: "cycle" });
  });
});
