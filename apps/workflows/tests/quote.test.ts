import { describe, expect, it } from "vitest";
import { buildQuote } from "../src/quote";
import { makeHarness, youcam } from "./harness";

const run = (
  h: ReturnType<typeof makeHarness>,
  graph: Parameters<typeof buildQuote>[0]["graph"],
  extra = {},
) =>
  buildQuote({
    graph,
    sessionId: h.sessionId,
    costs: h.engine.costs,
    ledger: h.engine.ledger,
    now: () => h.clock.now(),
    ...extra,
  });

describe("buildQuote", () => {
  const graph = {
    type: "demo" as const,
    nodes: [
      youcam("tone", "skin-tone-analysis"),
      youcam("cut", "sod"),
      youcam("video", "sod", { optional: true }),
      { id: "x", kind: "engine" as const, label: "step.x", feature: "noop" },
    ],
  };

  it("prices every YouCam node from feature-cost and ignores local nodes", async () => {
    const h = makeHarness();
    const res = await run(h, graph);
    expect(res).toMatchObject({
      ok: true,
      value: { total: 22, overCap: false, sessionUnitsLeft: 300 },
    });
    if (!res.ok) throw new Error("unreachable");
    expect(res.value.lines.map((l) => [l.nodeId, l.units, l.cached])).toEqual([
      ["tone", 20, false],
      ["cut", 1, false],
      ["video", 1, false],
    ]);
    expect(res.value.pricing.source).toBe("feature-cost");
  });

  it("a removed optional node costs nothing; a removed required node is still charged", async () => {
    const h = makeHarness();
    const res = await run(h, graph, { removed: ["video", "cut"] });
    if (!res.ok) throw new Error("unreachable");
    expect(res.value.lines.map((l) => l.nodeId)).toEqual(["tone", "cut"]);
  });

  it("cache hits are listed at zero units", async () => {
    const h = makeHarness();
    const res = await run(h, graph, {
      isCached: (n: { id: string }) => Promise.resolve(n.id === "tone"),
    });
    if (!res.ok) throw new Error("unreachable");
    expect(res.value.lines[0]).toMatchObject({ nodeId: "tone", units: 0, cached: true });
    expect(res.value.total).toBe(2);
  });

  it("is over the cap when the total exceeds the units left in the session", async () => {
    const h = makeHarness({ caps: { session: 10 } });
    const res = await run(h, graph);
    expect(res).toMatchObject({ ok: true, value: { overCap: true, sessionUnitsLeft: 10 } });
  });

  it("refuses to quote what it cannot price, naming the node", async () => {
    const h = makeHarness({ prices: { sod: 1 } });
    expect(await run(h, graph)).toMatchObject({
      ok: false,
      error: { code: "price_unknown", nodeId: "tone" },
    });
    expect(
      await run(h, {
        type: "demo",
        nodes: [youcam("m", "makeup-vto", { params: { effects: [] } })],
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "invalid_request", nodeId: "m" },
    });
    expect(await run(h, { type: "demo", nodes: [youcam("n", "nope")] })).toMatchObject({
      ok: false,
      error: { code: "unknown_feature" },
    });
  });

  it("says so when the price list cannot be read at all", async () => {
    const h = makeHarness();
    h.fake.failNetworkNext(1);
    expect(await run(h, graph)).toMatchObject({ ok: false, error: { code: "price_unavailable" } });
  });
});
