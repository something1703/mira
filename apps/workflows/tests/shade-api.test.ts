import { FakeClock, createMockPorts } from "@mira/runtime";
import { Twin, newId, ShadeResult, type Metric } from "@mira/schemas";
import { loadCatalogues } from "@mira/fixtures";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { FakeEngine } from "./fake-engine";
import { PNG } from "./harness";

const RANGE = loadCatalogues()[0];
if (!RANGE) throw new Error("no sample catalogue");

const at = "2026-11-01T09:00:00.000Z";
const colour = (id: string, lab: [number, number, number], hex: string): Metric => ({
  id,
  kind: "colour",
  lab,
  hex,
  source: { feature: "skin-tone-analysis", version: "v2.0", taskRunId: "run_seed" },
  confidence: "n/a",
  measuredAt: at,
});

function make() {
  const clock = new FakeClock();
  const ports = createMockPorts({ clock });
  const engine = new FakeEngine();
  // Real-looking Lab per hex so the ranking has something to rank.
  engine.labFor = (hex) => [30 + (parseInt(hex.slice(1, 3), 16) / 255) * 60, 14, 24];
  const ctx = buildApp(
    {},
    {
      ports,
      engineClient: engine,
      download: () =>
        Promise.resolve({ ok: true as const, value: { bytes: PNG, contentType: "image/png" } }),
    },
  );
  const userId = newId("usr");
  const sessionId = newId("ses");
  const seedTwin = async (skin = true) => {
    const metrics = skin ? { "colour.skin": colour("colour.skin", [62, 14, 24], "#C79A78") } : {};
    await ports.state.set(
      `twins/${userId}`,
      Twin.parse({
        userId,
        createdAt: at,
        updatedAt: at,
        metrics,
        groups: {
          skin: { status: "measured", missing: [], at },
          colouring: { status: "measured", missing: [], at },
          face: { status: "measured", missing: [], at },
          hair: { status: "measured", missing: [], at },
        },
        captureMeta: {
          mode: "hd",
          source: "camera",
          repeatsCaptured: 0,
          qualityChecksPassed: true,
        },
        synthetic: false,
      }),
    );
  };
  const photo = async () => {
    const key = `uploads/${userId}/up_${newId("up").slice(3, 12)}.jpg`;
    await ports.blobs.put(
      key,
      new Uint8Array([255, 216, 255, 224, Math.floor(Math.random() * 250)]),
      "image/jpeg",
    );
    return key;
  };
  const post = async (url: string, payload: unknown) =>
    await ctx.app.inject({ method: "POST", url, payload: payload as object });
  const body = async (extra: Record<string, unknown> = {}) => ({
    userId,
    sessionId,
    range: RANGE,
    photo: await photo(),
    ...extra,
  });
  const settle = async () => {
    for (let i = 0; i < 1_500; i++) {
      await ports.queue.tick();
      if (ports.queue.snapshot().length === 0) return;
      await clock.advance(1_000);
    }
    throw new Error("did not settle");
  };
  return { ctx, ports, engine, userId, sessionId, seedTwin, body, post, settle, clock };
}

describe("shade ranges and the free pre-rank", () => {
  it("lists the sample ranges, each marked as a sample", async () => {
    const t = make();
    const res = await t.ctx.app.inject({ url: "/internal/shade/ranges" });
    const { ranges } = res.json<{ ranges: { id: string; sample: boolean }[] }>();
    expect(ranges.length).toBeGreaterThanOrEqual(2);
    expect(ranges.every((r) => r.sample)).toBe(true);
  });

  it("without a measured profile there is nothing to rank against, and it says so", async () => {
    const t = make();
    const res = await t.post("/internal/shade/prerank", { userId: t.userId, range: RANGE });
    expect([res.statusCode, res.json<{ error: string }>().error]).toEqual([409, "no_profile"]);
    await t.seedTwin(false);
    const again = await t.post("/internal/shade/prerank", { userId: t.userId, range: RANGE });
    expect(again.json<{ error: string }>().error).toBe("no_skin_colour");
  });

  it("ranks the whole range at no cost and suggests a finish and coverage", async () => {
    const t = make();
    await t.seedTwin();
    const res = await t.post("/internal/shade/prerank", { userId: t.userId, range: RANGE });
    expect(res.statusCode).toBe(200);
    const plan = res.json<{
      ranked: { id: string; de: number }[];
      checkedFree: number;
      finish: string;
      coverage: string;
    }>();
    expect(plan.checkedFree).toBe(RANGE.shades.length);
    expect(plan.ranked).toHaveLength(RANGE.shades.length);
    expect(plan.finish).toBe("satin");
    expect(plan.coverage).toBe("light");
    expect(await t.ctx.engine.ledger.sessionUnitsLeft(t.sessionId)).toBe(200);
    expect(t.ctx.engine.deps.api).toBeDefined();
  });

  it("reads the coverage rule's concerns from the profile's metric ids", async () => {
    const t = make();
    await t.seedTwin();
    const stored = Twin.parse(await t.ports.state.get(`twins/${t.userId}`));
    stored.metrics["skin.hd_redness.whole"] = {
      id: "skin.hd_redness.whole",
      kind: "number",
      value: 22,
      unit: "raw score",
      source: { feature: "skin-analysis", version: "v2.1", taskRunId: "run_seed" },
      confidence: "n/a",
      measuredAt: at,
    };
    await t.ports.state.set(`twins/${t.userId}`, stored);
    await t.post("/internal/shade/prerank", { userId: t.userId, range: RANGE });
    expect(t.engine.finishCalls.at(-1)).toEqual({ skinType: null, scores: { redness: 22 } });
  });
});

describe("shade quote and build", () => {
  it("quotes the closest three shades at 21 units each, dropping any but the closest on request", async () => {
    const t = make();
    await t.seedTwin();
    const res = await t.post("/internal/shade/quote", await t.body());
    expect(res.statusCode).toBe(200);
    const out = res.json<{
      quote: { total: number; lines: { nodeId: string; units: number }[] };
      chosen: string[];
    }>();
    expect(out.chosen).toHaveLength(3);
    expect(out.quote.total).toBe(63);
    expect(
      out.quote.lines.filter((l) => l.nodeId.startsWith("render-")).map((l) => l.units),
    ).toEqual([1, 1, 1]);

    const dropped = await t.post(
      "/internal/shade/quote",
      await t.body({ removedShadeIds: [out.chosen[1], out.chosen[2]] }),
    );
    expect(dropped.json<{ quote: { total: number } }>().quote.total).toBe(21);
    // The closest shade cannot be dropped.
    const closest = await t.post(
      "/internal/shade/quote",
      await t.body({ removedShadeIds: [out.chosen[0]] }),
    );
    expect(closest.json<{ quote: { total: number } }>().quote.total).toBe(63);
  });

  it("renders at most five, and the person can ask for fewer", async () => {
    const t = make();
    await t.seedTwin();
    const five = await t.post("/internal/shade/quote", await t.body({ topN: 5 }));
    expect(five.json<{ chosen: string[] }>().chosen).toHaveLength(5);
    const two = await t.post("/internal/shade/quote", await t.body({ topN: 2 }));
    expect(two.json<{ chosen: string[] }>().chosen).toHaveLength(2);
    const many = await t.post("/internal/shade/quote", { ...(await t.body()), topN: 99 });
    expect(many.statusCode).toBe(400);
  });

  it("refuses another person's photo, a missing one, and a build with no confirmed total", async () => {
    const t = make();
    await t.seedTwin();
    const foreign = await t.post(
      "/internal/shade/quote",
      await t.body({ photo: `uploads/${newId("usr")}/up_x.jpg` }),
    );
    expect([foreign.statusCode, foreign.json<{ error: string }>().error]).toEqual([
      400,
      "upload_foreign",
    ]);
    const gone = await t.post(
      "/internal/shade/quote",
      await t.body({ photo: `uploads/${t.userId}/up_gone.jpg` }),
    );
    expect([gone.statusCode, gone.json<{ error: string }>().error]).toEqual([
      422,
      "upload_missing",
    ]);
    const raw = await t.post("/internal/shade/build", await t.body());
    expect([raw.statusCode, raw.json<{ error: string }>().error]).toEqual([
      400,
      "confirmed_total_required",
    ]);
    const low = await t.post("/internal/shade/build", await t.body({ confirmedTotal: 20 }));
    expect([low.statusCode, low.json<{ error: string }>().error]).toEqual([409, "quote_changed"]);
  });

  it("builds: renders, measures, ranks, serves the previews, then deletes everything", async () => {
    const t = make();
    await t.seedTwin();
    const res = await t.post("/internal/shade/build", await t.body({ confirmedTotal: 63 }));
    expect(res.statusCode).toBe(201);
    const { runId } = res.json<{ runId: string }>();
    // Run until the run ends, but not through the review window.
    for (let i = 0; i < 400; i++) {
      await t.ports.queue.tick();
      const view = (await t.ctx.app.inject({ url: `/internal/runs/${runId}` })).json<{
        run: { status: string };
      }>();
      if (view.run.status !== "running") break;
      await t.clock.advance(1_000);
    }
    const view = (await t.ctx.app.inject({ url: `/internal/runs/${runId}` })).json<{
      run: { status: string; unitsSpent: number; type: string };
      nodes: { id: string; output?: unknown }[];
    }>();
    expect(view.run).toMatchObject({ status: "succeeded", unitsSpent: 63, type: "match_shade" });
    const result = ShadeResult.parse(view.nodes.find((n) => n.id === "assemble")?.output);
    expect(result.outcomes).toHaveLength(3);

    // A preview is served while the review window is open...
    const best = result.outcomes[0]?.renderNode ?? "render-1";
    const img = await t.ctx.app.inject({ url: `/internal/runs/${runId}/images/${best}` });
    expect(img.statusCode).toBe(200);
    expect(img.headers["content-type"]).toBe("image/png");
    // ...and the person's own photo is already gone.
    expect(await t.ports.blobs.list(`uploads/${t.userId}/`)).toEqual([]);

    await t.settle();
    expect(
      (await t.ctx.app.inject({ url: `/internal/runs/${runId}/images/${best}` })).statusCode,
    ).toBe(404);
  });

  it("a saved look keeps the previews after the window closes", async () => {
    const t = make();
    await t.seedTwin();
    const { runId } = (
      await t.post("/internal/shade/build", await t.body({ confirmedTotal: 63 }))
    ).json<{ runId: string }>();
    for (let i = 0; i < 400; i++) {
      await t.ports.queue.tick();
      const v = (await t.ctx.app.inject({ url: `/internal/runs/${runId}` })).json<{
        run: { status: string };
      }>();
      if (v.run.status !== "running") break;
      await t.clock.advance(1_000);
    }
    const saved = await t.post(`/internal/runs/${runId}/save`, { nodeIds: ["render-1"] });
    expect(saved.statusCode).toBe(201);
    await t.settle();
    expect(await t.ports.blobs.list(`saved/${t.userId}/`)).toHaveLength(1);
  });

  it("can render exactly the shades asked for, for 'retry missing'", async () => {
    const t = make();
    await t.seedTwin();
    const all = (await t.post("/internal/shade/quote", await t.body({ topN: 5 }))).json<{
      chosen: string[];
    }>().chosen;
    const want = [all[4], all[1]] as string[];
    const res = await t.post("/internal/shade/quote", await t.body({ shadeIds: want }));
    // In ranked order, whatever order they were asked for in.
    expect(res.json<{ chosen: string[] }>().chosen).toEqual([all[1], all[4]]);
    expect(res.json<{ quote: { total: number } }>().quote.total).toBe(42);
  });

  it("offers a concealer pass only when the engine suggests one, from the lower dark-circle reading", async () => {
    const t = make();
    await t.seedTwin();
    const stored = Twin.parse(await t.ports.state.get(`twins/${t.userId}`));
    for (const [region, value] of [
      ["left_eye", 64],
      ["right_eye", 31],
    ] as const) {
      stored.metrics[`skin.hd_dark_circle.${region}`] = {
        id: `skin.hd_dark_circle.${region}`,
        kind: "number",
        value,
        unit: "raw score",
        source: { feature: "skin-analysis", version: "v2.1", taskRunId: "run_seed" },
        confidence: "n/a",
        measuredAt: at,
      };
    }
    await t.ports.state.set(`twins/${t.userId}`, stored);
    await t.post("/internal/shade/prerank", { userId: t.userId, range: RANGE });
    // The lower of the two readings goes to the engine, which decides.
    expect(t.engine.finishCalls.at(-1)?.scores).toMatchObject({ dark_circle: 31 });

    const refused = await t.post("/internal/shade/quote", await t.body({ concealer: true }));
    expect([refused.statusCode, refused.json<{ error: string }>().error]).toEqual([
      409,
      "concealer_not_suggested",
    ]);

    t.engine.finishReading = { ...t.engine.finishReading, concealer_suggested: true };
    const ok = await t.post("/internal/shade/quote", await t.body({ concealer: true }));
    expect(ok.statusCode).toBe(200);
    // A request for shades that are not in the range renders nothing, and says so.
    const none = await t.post("/internal/shade/quote", await t.body({ shadeIds: ["not-a-shade"] }));
    expect([none.statusCode, none.json<{ error: string }>().error]).toEqual([
      422,
      "no_shades_chosen",
    ]);
  });
});
