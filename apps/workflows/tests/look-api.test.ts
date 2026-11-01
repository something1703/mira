import { FakeClock, createMockPorts } from "@mira/runtime";
import { GarmentItem, LookResult, Twin, newId, type Metric } from "@mira/schemas";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { FakeEngine } from "./fake-engine";

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
  engine.labFor = (hex) => [30 + (parseInt(hex.slice(1, 3), 16) / 255) * 60, 18, 14];
  const ctx = buildApp({}, { ports, engineClient: engine });
  const userId = newId("usr");
  const sessionId = newId("ses");
  const seedTwin = async (full = true) => {
    await ports.state.set(
      `twins/${userId}`,
      Twin.parse({
        userId,
        createdAt: at,
        updatedAt: at,
        metrics: full
          ? {
              "colour.skin": colour("colour.skin", [62, 14, 24], "#C79A78"),
              "colour.lip": colour("colour.lip", [45, 25, 14], "#A5504F"),
              "colour.hair": colour("colour.hair", [20, 5, 8], "#42280E"),
            }
          : {},
        groups: {
          skin: { status: "measured", missing: [], at },
          colouring: { status: "measured", missing: [], at },
          face: { status: "measured", missing: [], at },
          hair: { status: "measured", missing: [], at },
        },
        // The same ratios the mock Face Attributes answers with, so the face matches itself.
        faceRatios: {
          face_aspect_ratio: [1.31],
          horizontal_third: [0.33, 0.34, 0.33],
          vertical_fifth: [0.19, 0.21, 0.2, 0.21, 0.19],
          eye_aspect_ratio: [0.38, 0.37],
          nose_width_to_mouth_width: [0.71],
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
  const photo = async (who = userId) => {
    const key = `uploads/${who}/up_${newId("up").slice(3, 12)}.jpg`;
    await ports.blobs.put(key, new Uint8Array([255, 216, 255, 224, 7]), "image/jpeg");
    return key;
  };
  const post = async (url: string, payload: unknown) =>
    await ctx.app.inject({ method: "POST", url, payload: payload as object });
  const sample = async (sampleId: string) => {
    const res = await post("/internal/look/garments/sample", { userId, sampleId });
    return res.json<{ garment: GarmentItem }>().garment;
  };
  const settle = async () => {
    for (let i = 0; i < 3_000; i++) {
      await ports.queue.tick();
      if (ports.queue.snapshot().length === 0) return;
      await clock.advance(1_000);
    }
    throw new Error("did not settle");
  };
  /** Runs until the run has ended but stops before the review window closes and cleans up. */
  const untilEnded = async (runId: string) => {
    for (let i = 0; i < 3_000; i++) {
      await ports.queue.tick();
      const run = (await ports.state.get(`runs/${runId}`)) as { status: string } | undefined;
      if (run && ["succeeded", "partial", "failed", "cancelled"].includes(run.status)) return;
      await clock.advance(1_000);
    }
    throw new Error("did not end");
  };
  const look = async (extra: Record<string, unknown> = {}) => ({
    userId,
    sessionId,
    photo: await photo(),
    outfitId: (await sample("gar_sample02")).id,
    ...extra,
  });
  return {
    ctx,
    ports,
    engine,
    userId,
    sessionId,
    seedTwin,
    photo,
    post,
    sample,
    settle,
    untilEnded,
    look,
  };
}

describe("garments", () => {
  it("lists invented sample garments in mock mode", async () => {
    const t = make();
    const res = await t.ctx.app.inject({ url: "/internal/look/catalogue" });
    const { garments } = res.json<{ garments: { id: string; kind: string }[] }>();
    expect(garments.map((g) => g.kind).sort()).toEqual([
      "bag",
      "outfit",
      "outfit",
      "outfit",
      "outfit",
      "shoes",
    ]);
  });

  it("makes a sample garment on request: its colour comes from the engines, and it says it is a sample", async () => {
    const t = make();
    const g = await t.sample("gar_sample02");
    expect(g).toMatchObject({ kind: "outfit", category: "full_body", sample: true });
    expect(g.source).toEqual({ kind: "sample" });
    expect(g.image.startsWith(`uploads/${t.userId}/`)).toBe(true);
    expect(await t.ports.blobs.get(g.image)).toBeDefined();
    expect(t.engine.lookCalls).toContain("garment");
    expect(
      (await t.post("/internal/look/garments/sample", { userId: t.userId, sampleId: "nope" }))
        .statusCode,
    ).toBe(404);
  });

  it("reads a garment's colour from a picture: quoted first, then run", async () => {
    const t = make();
    const photo = await t.photo();
    const body = {
      userId: t.userId,
      sessionId: t.sessionId,
      photo,
      name: "Sapphire sari",
      kind: "outfit",
      category: "full_body",
      source: { kind: "upload" },
    };
    const q = await t.post("/internal/look/garments/quote", body);
    expect(q.statusCode).toBe(200);
    const total = q.json<{ quote: { total: number } }>().quote.total;
    expect(total).toBeGreaterThan(0);
    expect(
      (await t.post("/internal/look/garments/ingest", body)).json<{ error: string }>().error,
    ).toBe("confirmed_total_required");
    const started = await t.post("/internal/look/garments/ingest", {
      ...body,
      confirmedTotal: total,
    });
    expect(started.statusCode).toBe(201);
    const { runId } = started.json<{ runId: string }>();
    await t.settle();
    const view = (await t.ctx.app.inject({ url: `/internal/runs/${runId}` })).json<{
      nodes: { id: string; output?: unknown }[];
    }>();
    const garment = GarmentItem.parse(view.nodes.find((n) => n.id === "garment")?.output);
    expect(garment).toMatchObject({
      name: "Sapphire sari",
      kind: "outfit",
      source: { kind: "upload" },
    });
    expect(await t.ports.blobs.get(garment.image)).toBeDefined();
  });

  it("refuses a photo that is not the person's, and a shoes garment in a clothes category", async () => {
    const t = make();
    const base = {
      userId: t.userId,
      sessionId: t.sessionId,
      name: "x",
      source: { kind: "upload" },
    };
    const foreign = await t.post("/internal/look/garments/quote", {
      ...base,
      photo: await t.photo(newId("usr")),
      kind: "outfit",
      category: "full_body",
    });
    expect(foreign.statusCode).toBe(400);
    const mismatch = await t.post("/internal/look/garments/quote", {
      ...base,
      photo: await t.photo(),
      kind: "shoes",
      category: "full_body",
    });
    expect([mismatch.statusCode, mismatch.json<{ error: string }>().error]).toEqual([
      422,
      "kind_category_mismatch",
    ]);
  });
});

describe("the suggestion", () => {
  it("needs a measured profile with colouring", async () => {
    const t = make();
    const g = await t.sample("gar_sample02");
    const none = await t.post("/internal/look/suggest", { userId: t.userId, outfitId: g.id });
    expect(none.json<{ error: string }>().error).toBe("no_profile");
    await t.seedTwin(false);
    const thin = await t.post("/internal/look/suggest", { userId: t.userId, outfitId: g.id });
    expect(thin.json<{ error: string }>().error).toBe("no_colouring");
  });

  it("names a lip and blush with the rule that fired, not a figure of its own", async () => {
    const t = make();
    await t.seedTwin();
    const g = await t.sample("gar_sample02");
    const res = await t.post("/internal/look/suggest", { userId: t.userId, outfitId: g.id });
    const { suggestion } = res.json<{
      suggestion: {
        lip: { name: string; hex: string; reason: string };
        blush?: { reason: string };
      };
    }>();
    expect(suggestion.lip.name).toMatch(/^Sample /);
    expect(suggestion.lip.hex).toMatch(/^#[0-9A-F]{6}$/);
    expect(suggestion.lip.reason).toBe("hue_near_garment");
  });
});

describe("quote and build", () => {
  it("quotes the steps with real prices, and a removed step costs nothing", async () => {
    const t = make();
    await t.seedTwin();
    const body = await t.look({ makeup: true, hairHex: "#2B1D14", video: true });
    const full = (await t.post("/internal/look/quote", body)).json<{
      quote: { total: number; lines: { nodeId: string }[] };
      steps: string[];
    }>();
    expect(full.steps).toEqual(expect.arrayContaining(["outfit", "makeup", "hair", "video"]));
    const lean = (
      await t.post("/internal/look/quote", { ...body, removedSteps: ["video", "hair"] })
    ).json<{
      quote: { total: number; lines: { nodeId: string }[] };
    }>();
    expect(lean.quote.total).toBeLessThan(full.quote.total);
    expect(lean.quote.lines.some((l) => l.nodeId === "video" || l.nodeId === "hair")).toBe(false);
  });

  it("refuses another person's photo or garment, and a garment whose picture is gone", async () => {
    const t = make();
    await t.seedTwin();
    const foreign = await t.post("/internal/look/quote", {
      ...(await t.look()),
      photo: await t.photo(newId("usr")),
    });
    expect(foreign.statusCode).toBe(400);
    const missing = await t.post("/internal/look/quote", {
      ...(await t.look()),
      outfitId: "gar_doesnotexist1",
    });
    expect([missing.statusCode, missing.json<{ error: string }>().error]).toEqual([
      422,
      "garment_missing",
    ]);
    const g = await t.sample("gar_sample02");
    await t.ports.blobs.delete(g.image);
    const gone = await t.post("/internal/look/quote", { ...(await t.look()), outfitId: g.id });
    expect(gone.json<{ error: string }>().error).toBe("garment_missing");
  });

  it("will not spend without the total the person saw, nor above it", async () => {
    const t = make();
    await t.seedTwin();
    const body = await t.look();
    expect((await t.post("/internal/look/build", body)).json<{ error: string }>().error).toBe(
      "confirmed_total_required",
    );
    const below = await t.post("/internal/look/build", { ...body, confirmedTotal: 0 });
    expect([below.statusCode, below.json<{ error: string }>().error]).toEqual([
      409,
      "quote_changed",
    ]);
  });

  it("builds a whole look in mock mode with every label, and serves its plate", async () => {
    const t = make();
    await t.seedTwin();
    const body = await t.look({
      makeup: true,
      hairHex: "#2B1D14",
      venue: { type: "prompt", prompt: "a garden" },
    });
    const total = (await t.post("/internal/look/quote", body)).json<{ quote: { total: number } }>()
      .quote.total;
    const started = await t.post("/internal/look/build", { ...body, confirmedTotal: total });
    expect(started.statusCode).toBe(201);
    const { runId } = started.json<{ runId: string }>();
    await t.untilEnded(runId);
    const view = (await t.ctx.app.inject({ url: `/internal/runs/${runId}` })).json<{
      run: { status: string; unitsSpent: number };
      nodes: { id: string; output?: unknown }[];
    }>();
    expect(view.run.status).toBe("succeeded");
    expect(view.run.unitsSpent).toBe(total);
    const result = LookResult.parse(view.nodes.find((n) => n.id === "assemble")?.output);
    expect(result.steps.find((s) => s.id === "outfit")?.verdict).toBe("verified");
    expect(result.plate).toBe("venue");
    const img = await t.ctx.app.inject({
      url: `/internal/runs/${runId}/images/${result.plate ?? ""}`,
    });
    expect([img.statusCode, img.headers["content-type"]]).toEqual([200, "image/png"]);
  });

  it("a withheld picture is not served and cannot be saved", async () => {
    const t = make();
    await t.seedTwin();
    t.engine.identity = { drift: 0.2, passed: false };
    const body = await t.look();
    const total = (await t.post("/internal/look/quote", body)).json<{ quote: { total: number } }>()
      .quote.total;
    const { runId } = (
      await t.post("/internal/look/build", { ...body, confirmedTotal: total })
    ).json<{ runId: string }>();
    await t.untilEnded(runId);
    const img = await t.ctx.app.inject({ url: `/internal/runs/${runId}/images/outfit` });
    expect([img.statusCode, img.json<{ error: string }>().error]).toEqual([404, "image_withheld"]);
    const save = await t.post(`/internal/runs/${runId}/save`, { nodeIds: ["outfit"] });
    expect([save.statusCode, save.json<{ error: string }>().error]).toEqual([
      409,
      "image_withheld",
    ]);
  });
});
