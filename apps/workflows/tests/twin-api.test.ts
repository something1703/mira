import { FakeClock, createMockPorts } from "@mira/runtime";
import { newId } from "@mira/schemas";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { FakeEngine } from "./fake-engine";

/** A JPEG header with the given size: enough for the server's header checks, not a real picture. */
function jpeg(width: number, height: number, salt = 0): Buffer {
  const be16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
  return Buffer.from([
    0xff,
    0xd8, // SOI
    0xff,
    0xe0,
    0x00,
    0x10,
    0x4a,
    0x46,
    0x49,
    0x46,
    0x00,
    0x01,
    0x01,
    0x00,
    0x00,
    0x01,
    0x00,
    0x01,
    0x00,
    0x00, // APP0
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    ...be16(height),
    ...be16(width),
    0x03,
    0x01,
    0x22,
    0x00,
    0x02,
    0x11,
    0x01,
    0x03,
    0x11,
    0x01, // SOF0
    0xff,
    0xd9, // EOI
    salt,
  ]);
}

function png(width: number, height: number): Buffer {
  const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  return Buffer.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    0,
    0,
    0,
    13,
    0x49,
    0x48,
    0x44,
    0x52,
    ...u32(width),
    ...u32(height),
    8,
    2,
    0,
    0,
    0,
  ]);
}

function make() {
  const clock = new FakeClock();
  const ports = createMockPorts({ clock });
  const engine = new FakeEngine();
  const ctx = buildApp({}, { ports, engineClient: engine });
  const userId = newId("usr");
  const sessionId = newId("ses");
  let salt = 0;
  const settle = async () => {
    for (let i = 0; i < 400; i++) {
      await ports.queue.tick();
      if (ports.queue.snapshot().length === 0) return;
      await clock.advance(1_000);
    }
    throw new Error("did not settle");
  };
  const upload = async (
    body: Buffer = jpeg(1200, 1600, ++salt),
    user = userId,
    type = "image/jpeg",
  ) =>
    await ctx.app.inject({
      method: "POST",
      url: `/internal/uploads?userId=${user}`,
      headers: { "content-type": type },
      payload: body,
    });
  const key = async (): Promise<string> => (await upload()).json<{ key: string }>().key;
  const body = async (
    extra: Record<string, unknown> = {},
    capture: Record<string, unknown> = {},
  ) => ({
    userId,
    sessionId,
    capture: {
      face: await key(),
      mode: "hd",
      source: "upload",
      qualityChecksPassed: null,
      ...capture,
    },
    ...extra,
  });
  const post = async (url: string, payload: unknown) =>
    await ctx.app.inject({ method: "POST", url, payload: payload as object });
  return { ctx, ports, clock, engine, userId, sessionId, upload, key, body, post, settle };
}

describe("uploads", () => {
  it("stores a good JPEG under the person's prefix and reports its size and HD fitness", async () => {
    const t = make();
    const res = await t.upload(jpeg(1200, 1600));
    expect(res.statusCode).toBe(201);
    const out = res.json<{ key: string; width: number; height: number; hdCapable: boolean }>();
    expect(out).toMatchObject({ width: 1200, height: 1600, hdCapable: true });
    expect(out.key.startsWith(`uploads/${t.userId}/`)).toBe(true);
    expect(await t.ports.blobs.list(`uploads/${t.userId}/`)).toEqual([out.key]);
  });

  it("accepts a PNG and flags a 720p image as standard detail only", async () => {
    const t = make();
    expect((await t.upload(png(720, 960), t.userId, "image/png")).json()).toMatchObject({
      hdCapable: false,
      width: 720,
    });
  });

  it("refuses small, empty, mislabelled and non-image bodies, and stores nothing", async () => {
    const t = make();
    const small = await t.upload(jpeg(400, 600));
    expect(small.statusCode).toBe(422);
    expect(small.json()).toMatchObject({ error: "below_min_size", minShortSide: 480 });
    expect((await t.upload(Buffer.from("not an image"))).statusCode).toBe(415);
    expect((await t.upload(Buffer.from("x"), t.userId, "text/plain")).statusCode).toBe(415);
    expect((await t.upload(Buffer.alloc(0))).statusCode).toBe(422);
    expect((await t.upload(jpeg(1200, 1600), "nope")).statusCode).toBe(400);
    expect(await t.ports.blobs.list("uploads/")).toEqual([]);
  });

  it("limits how many captures one person can hold", async () => {
    const t = make();
    for (let i = 0; i < 12; i++) expect((await t.upload()).statusCode).toBe(201);
    expect((await t.upload()).statusCode).toBe(429);
  });
});

describe("Twin quote and build", () => {
  it("quotes with the real price list: skin 16 + tone 20 + band 10 + face 10, repeats optional", async () => {
    const t = make();
    const res = await t.post(
      "/internal/twin/quote",
      await t.body({}, { repeats: [await t.key(), await t.key()] }),
    );
    expect(res.statusCode).toBe(200);
    const quote = res.json<{
      quote: {
        total: number;
        lines: { nodeId: string; units: number; optional: boolean }[];
        overCap: boolean;
      };
    }>().quote;
    expect(Object.fromEntries(quote.lines.map((l) => [l.nodeId, l.units]))).toEqual({
      skin: 16,
      tone: 20,
      fitzpatrick: 10,
      face: 10,
      "skin-r1": 16,
      "skin-r2": 16,
    });
    expect(quote.lines.filter((l) => l.optional).map((l) => l.nodeId)).toEqual([
      "skin-r1",
      "skin-r2",
    ]);
    expect(quote.total).toBe(88);
    // A quote spends nothing and starts nothing.
    expect(await t.ctx.engine.ledger.sessionUnitsLeft(t.sessionId)).toBe(200);
  });

  it("drops removed optional steps from the quote", async () => {
    const t = make();
    const res = await t.post(
      "/internal/twin/quote",
      await t.body({ removed: ["skin-r2"] }, { repeats: [await t.key(), await t.key()] }),
    );
    expect(res.json<{ quote: { total: number } }>().quote.total).toBe(72);
  });

  it("refuses another person's upload and a missing one", async () => {
    const t = make();
    const other = newId("usr");
    const foreign = (await t.upload(jpeg(1200, 1600, 99), other)).json<{ key: string }>().key;
    const a = await t.post("/internal/twin/build", await t.body({}, { face: foreign }));
    expect([a.statusCode, a.json<{ error: string }>().error]).toEqual([400, "upload_foreign"]);
    const b = await t.post(
      "/internal/twin/build",
      await t.body({}, { face: `uploads/${t.userId}/up_gone.jpg` }),
    );
    expect([b.statusCode, b.json<{ error: string }>().error]).toEqual([422, "upload_missing"]);
  });

  it("does not start when the price has moved above what the person confirmed", async () => {
    const t = make();
    const res = await t.post("/internal/twin/build", await t.body({ confirmedTotal: 40 }));
    expect([res.statusCode, res.json<{ error: string }>().error]).toEqual([409, "quote_changed"]);
    expect(await t.ports.state.list("runs")).toEqual([]);
  });

  it("builds a synthetic profile end to end and deletes the captures", async () => {
    const t = make();
    const start = await t.post(
      "/internal/twin/build",
      await t.body({ confirmedTotal: 88 }, { repeats: [await t.key(), await t.key()] }),
    );
    expect(start.statusCode).toBe(201);
    const { runId, synthetic } = start.json<{ runId: string; synthetic: boolean }>();
    expect(synthetic).toBe(true);
    await t.settle();

    const run = (await t.ctx.app.inject({ url: `/internal/runs/${runId}` })).json<{
      run: { status: string; cleanedAt?: string; unitsSpent: number };
    }>().run;
    expect(run).toMatchObject({ status: "succeeded", unitsSpent: 88 });
    expect(run.cleanedAt).toBeDefined();
    expect(await t.ports.blobs.list("uploads/")).toEqual([]);

    const got = (await t.ctx.app.inject({ url: `/internal/twin/${t.userId}` })).json<{
      synthetic: boolean;
      twin: {
        groups: Record<string, { status: string }>;
        metrics: Record<string, unknown>;
        noiseFloors: Record<string, unknown>;
      };
    }>();
    expect(got.synthetic).toBe(true);
    expect(got.twin.groups.skin?.status).toBe("measured");
    expect(got.twin.groups.hair?.status).toBe("not_measured");
    expect(Object.keys(got.twin.metrics)).toContain("skin.hd_pore.whole");
    expect(Object.keys(got.twin.noiseFloors).length).toBeGreaterThan(0);
  });

  it("refuses a build the budget cannot cover instead of failing midway", async () => {
    const t = make();
    for (let i = 0; i < 2; i++) {
      const res = await t.post(
        "/internal/twin/build",
        await t.body({}, { repeats: [await t.key(), await t.key()] }),
      );
      expect(res.statusCode).toBe(201);
      await t.settle();
    }
    // 176 of 200 units are spent; the next 88 cannot fit.
    const third = await t.post(
      "/internal/twin/build",
      await t.body({}, { repeats: [await t.key(), await t.key()] }),
    );
    expect([third.statusCode, third.json<{ error: string }>().error]).toEqual([409, "over_cap"]);
  });
});

describe("Twin privacy", () => {
  async function built() {
    const t = make();
    const start = await t.post("/internal/twin/build", await t.body());
    await t.settle();
    return { t, runId: start.json<{ runId: string }>().runId };
  }

  it("the inventory lists every stored thing, and the export carries it", async () => {
    const { t, runId } = await built();
    await t.ports.blobs.put(`saved/${t.userId}/lk_a/plate.png`, new Uint8Array([1]), "image/png");
    await t.ports.state.set(`twins/${t.userId}/proofs/prf_1`, { x: 1 });
    const inv = (await t.ctx.app.inject({ url: `/internal/twin/${t.userId}/inventory` })).json<{
      twin: { metrics: object } | null;
      savedLooks: unknown[];
      proofs: number;
      runs: { id: string }[];
    }>();
    expect(Object.keys(inv.twin?.metrics ?? {}).length).toBeGreaterThan(0);
    expect(inv.savedLooks).toEqual([{ lookId: "lk_a", images: 1 }]);
    expect(inv.proofs).toBe(1);
    expect(inv.runs.map((r) => r.id)).toEqual([runId]);
    const exp = (await t.ctx.app.inject({ url: `/internal/twin/${t.userId}/export` })).json<{
      format: string;
      profile: { userId: string };
      runs: unknown[];
    }>();
    expect(exp).toMatchObject({ format: "mira-profile-export", profile: { userId: t.userId } });
    expect(exp.runs).toHaveLength(1);
  });

  it("delete removes the twin, proofs, saved looks, runs and cached results, and keeps counts only", async () => {
    const { t } = await built();
    await t.ports.blobs.put(`saved/${t.userId}/lk_a/plate.png`, new Uint8Array([1]), "image/png");
    await t.ports.blobs.put(`saved/${t.userId}/lk_b/plate.png`, new Uint8Array([2]), "image/png");
    await t.ports.state.set(`twins/${t.userId}/proofs/prf_1`, { x: 1 });
    const cacheBefore = (await t.ports.state.list("cache")).length;
    expect(cacheBefore).toBeGreaterThan(0);

    const del = await t.ctx.app.inject({ method: "DELETE", url: `/internal/twin/${t.userId}` });
    expect(del.statusCode).toBe(200);
    expect(del.json<{ removed: Record<string, number> }>().removed).toMatchObject({
      savedLooks: 2,
      savedImages: 2,
      proofs: 1,
      runs: 1,
      cachedResults: cacheBefore,
    });
    expect(del.json<{ removed: { readings: number } }>().removed.readings).toBeGreaterThan(0);

    expect((await t.ctx.app.inject({ url: `/internal/twin/${t.userId}` })).statusCode).toBe(404);
    expect(await t.ports.blobs.list(`saved/${t.userId}/`)).toEqual([]);
    expect(await t.ports.state.list("runs")).toEqual([]);
    expect(await t.ports.state.list("cache")).toEqual([]);
    const inv = (await t.ctx.app.inject({ url: `/internal/twin/${t.userId}/inventory` })).json<{
      twin: unknown;
      deletions: { removed: object }[];
    }>();
    expect(inv.twin).toBeNull();
    expect(inv.deletions).toHaveLength(1);
    // The record holds counts, never values.
    expect(JSON.stringify(inv.deletions)).not.toMatch(/skin\.|#[0-9A-F]{6}/);
  });

  it("does not delete another person's data", async () => {
    const { t } = await built();
    const other = newId("usr");
    await t.ports.state.set(`twins/${other}`, { keep: true });
    await t.ctx.app.inject({ method: "DELETE", url: `/internal/twin/${t.userId}` });
    expect(await t.ports.state.get(`twins/${other}`)).toEqual({ keep: true });
  });

  it("refuses to delete while a run is still going, because it would write the profile back", async () => {
    const t = make();
    await t.post("/internal/twin/build", await t.body());
    const del = await t.ctx.app.inject({ method: "DELETE", url: `/internal/twin/${t.userId}` });
    expect([del.statusCode, del.json<{ error: string }>().error]).toEqual([409, "run_in_progress"]);
    await t.settle();
    expect(
      (await t.ctx.app.inject({ method: "DELETE", url: `/internal/twin/${t.userId}` })).statusCode,
    ).toBe(200);
  });

  it("GET with no profile is 404 and says what was deleted", async () => {
    const t = make();
    const res = await t.ctx.app.inject({ url: `/internal/twin/${t.userId}` });
    expect([res.statusCode, res.json<{ error: string }>().error]).toEqual([404, "no_profile"]);
  });
});

describe("per-session cap (mock mode)", () => {
  it("lets one session have its own cap, shown by the budget endpoint and enforced at the quote", async () => {
    const t = make();
    const set = await t.post("/internal/dev/session-cap", { sessionId: t.sessionId, cap: 60 });
    expect(set.statusCode).toBe(200);
    expect(
      (await t.ctx.app.inject({ url: `/internal/budgets/${t.sessionId}` })).json(),
    ).toMatchObject({ cap: 60, left: 60 });
    const first = await t.post("/internal/twin/build", await t.body());
    expect(first.statusCode).toBe(201);
    await t.settle();
    const second = await t.post("/internal/twin/build", await t.body());
    expect([second.statusCode, second.json<{ error: string }>().error]).toEqual([409, "over_cap"]);
    // Another session keeps the default.
    expect(
      (await t.ctx.app.inject({ url: `/internal/budgets/${newId("ses")}` })).json(),
    ).toMatchObject({ cap: 200 });
  });

  it("rejects a bad body", async () => {
    const t = make();
    expect((await t.post("/internal/dev/session-cap", { sessionId: "x", cap: 1 })).statusCode).toBe(
      400,
    );
  });
});
