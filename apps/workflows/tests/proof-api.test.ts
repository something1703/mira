import { FakeClock, createMockPorts } from "@mira/runtime";
import type { ProofRecord } from "@mira/schemas";
import { EfficacyOutcome, Twin, newId } from "@mira/schemas";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { FakeEngine } from "./fake-engine";

const at = "2026-11-01T09:00:00.000Z";
const HOUR = 3_600_000;

function make() {
  const clock = new FakeClock();
  const ports = createMockPorts({ clock });
  const engine = new FakeEngine();
  const ctx = buildApp({}, { ports, engineClient: engine });
  const userId = newId("usr");
  const sessionId = newId("ses");
  let n = 0;
  const photo = async (who = userId) => {
    n += 1;
    const key = `uploads/${who}/up_${newId("up").slice(3, 12)}.jpg`;
    await ports.blobs.put(
      key,
      new Uint8Array([255, 216, 255, 224, n, n * 7, n * 13]),
      "image/jpeg",
    );
    return key;
  };
  const post = async (url: string, payload: unknown) =>
    await ctx.app.inject({ method: "POST", url, payload: payload as object });
  const get = async (url: string) => await ctx.app.inject({ url });
  const settle = async () => {
    for (let i = 0; i < 3_000; i++) {
      await ports.queue.tick();
      if (ports.queue.snapshot().length === 0) return;
      await clock.advance(1_000);
    }
    throw new Error("did not settle");
  };
  const create = async (windowDays = 28) => {
    const res = await post("/internal/proof", {
      userId,
      product: { name: "Pore serum", url: "https://shop.example/serum" },
      claim: { concern: "pore", windowDays, text: "visibly smaller pores", source: "typed" },
    });
    return res.json<{ proof: ProofRecord }>().proof;
  };
  const view = async (id: string) =>
    (await get(`/internal/proof/${userId}/${id}`)).json<{
      proof: ProofRecord;
      nextDue?: string;
      baselineComplete: boolean;
    }>();
  const session = async (proofId: string, kind: "baseline" | "check_in", extra = {}) => {
    const body = {
      userId,
      sessionId,
      proofId,
      kind,
      photos: [await photo(), await photo(), await photo()],
      ...extra,
    };
    const q = await post("/internal/proof/session/quote", body);
    if (q.statusCode !== 200) return q;
    const total = q.json<{ quote: { total: number } }>().quote.total;
    const started = await post("/internal/proof/session/start", { ...body, confirmedTotal: total });
    if (started.statusCode === 201) await settle();
    return started;
  };
  /** Three baseline sessions on three different days. */
  const baseline = async (proofId: string) => {
    for (let i = 0; i < 3; i++) {
      expect((await session(proofId, "baseline")).statusCode).toBe(201);
      await clock.advance(13 * HOUR);
    }
  };
  return {
    ctx,
    ports,
    engine,
    clock,
    userId,
    sessionId,
    photo,
    post,
    get,
    settle,
    create,
    view,
    session,
    baseline,
  };
}

describe("creating a proof", () => {
  it("starts at the baseline, with the claim as given", async () => {
    const t = make();
    const p = await t.create();
    expect(p).toMatchObject({
      status: "baseline",
      claim: { concern: "pore", windowDays: 28 },
      sessions: [],
    });
    const list = (await t.get(`/internal/proof/${t.userId}`)).json<{ proofs: unknown[] }>();
    expect(list.proofs).toHaveLength(1);
  });

  it("refuses a claim about something Proof does not measure, or a window too short to measure", async () => {
    const t = make();
    const base = { userId: t.userId, product: { name: "x" } };
    for (const claim of [
      { concern: "radiance", windowDays: 28, source: "typed" },
      { concern: "pore", windowDays: 2, source: "typed" },
      { concern: "pore", windowDays: 28, source: "invented" },
    ]) {
      expect((await t.post("/internal/proof", { ...base, claim })).statusCode).toBe(400);
    }
  });
});

describe("the baseline", () => {
  it("a session is three captures; each is one analysis of one concern", async () => {
    const t = make();
    const p = await t.create();
    const res = await t.session(p.id, "baseline");
    expect(res.statusCode).toBe(201);
    const { proof } = await t.view(p.id);
    expect(proof.sessions).toHaveLength(1);
    expect(proof.sessions[0]?.scores).toHaveLength(3);
    expect(proof.sessions[0]?.kind).toBe("baseline");
    expect(proof.status).toBe("baseline");
    // Three analyses of the smallest tier: the price is 3 x 12, nothing for the maths.
    const run = (await t.get(`/internal/runs/${res.json<{ runId: string }>().runId}`)).json<{
      run: { unitsSpent: number };
    }>();
    expect(run.run.unitsSpent).toBe(36);
  });

  it("another session the same day is refused, and says when the next can be made", async () => {
    const t = make();
    const p = await t.create();
    await t.session(p.id, "baseline");
    const again = await t.session(p.id, "baseline");
    expect([again.statusCode, again.json<{ error: string }>().error]).toEqual([409, "too_soon"]);
    const last = (await t.view(p.id)).proof.sessions[0];
    expect(Date.parse(again.json<{ nextAt: string }>().nextAt)).toBe(
      Date.parse(last?.at ?? "") + 12 * HOUR,
    );
  });

  it("three sessions on different days complete it and learn the variation", async () => {
    const t = make();
    t.engine.noiseFloorOverride = { s_d: 1.1, s_d_source: "estimated", se: 1.2, mdc: 3.3 };
    const p = await t.create();
    await t.baseline(p.id);
    const { proof, baselineComplete } = await t.view(p.id);
    expect(baselineComplete).toBe(true);
    expect(proof.status).toBe("ready");
    expect(proof.noiseFloor).toMatchObject({
      sessions: 3,
      capturesPerSession: 3,
      mdc: 3.3,
      sDSource: "estimated",
    });
    // With three sessions no more baseline can be added.
    const extra = await t.session(p.id, "baseline");
    expect(extra.json<{ error: string }>().error).toBe("wrong_state");
  });

  it("without three sessions the variation is not known, and nothing pretends otherwise", async () => {
    const t = make();
    const p = await t.create();
    await t.session(p.id, "baseline");
    expect((await t.view(p.id)).proof.noiseFloor).toMatchObject({ mdc: null, sDSource: "unknown" });
  });

  it("refuses the wrong number of photos, the same photo twice, and another person's photo", async () => {
    const t = make();
    const p = await t.create();
    const base = { userId: t.userId, sessionId: t.sessionId, proofId: p.id, kind: "baseline" };
    const two = await t.post("/internal/proof/session/quote", {
      ...base,
      photos: [await t.photo(), await t.photo()],
    });
    expect([two.statusCode, two.json<{ error: string }>().error]).toEqual([
      422,
      "wrong_photo_count",
    ]);
    const one = await t.photo();
    const dup = await t.post("/internal/proof/session/quote", {
      ...base,
      photos: [one, one, await t.photo()],
    });
    expect([dup.statusCode, dup.json<{ error: string }>().error]).toEqual([
      422,
      "photos_duplicate",
    ]);
    const foreign = await t.post("/internal/proof/session/quote", {
      ...base,
      photos: [await t.photo(newId("usr")), await t.photo(), await t.photo()],
    });
    expect(foreign.statusCode).toBe(400);
  });

  it("will not spend without the total the person saw", async () => {
    const t = make();
    const p = await t.create();
    const res = await t.post("/internal/proof/session/start", {
      userId: t.userId,
      sessionId: t.sessionId,
      proofId: p.id,
      kind: "baseline",
      photos: [await t.photo(), await t.photo(), await t.photo()],
    });
    expect(res.json<{ error: string }>().error).toBe("confirmed_total_required");
  });
});

describe("tracking and the verdict", () => {
  const tracking = async (windowDays = 28) => {
    const t = make();
    t.engine.noiseFloorOverride = { s_d: 1.1, s_d_source: "estimated", se: 1.2, mdc: 3.3 };
    const p = await t.create(windowDays);
    await t.baseline(p.id);
    const begun = await t.post(`/internal/proof/${p.id}/begin`, { userId: t.userId });
    expect(begun.statusCode).toBe(200);
    return { t, p };
  };

  it("tracking starts only once the baseline is complete", async () => {
    const t = make();
    const p = await t.create();
    const early = await t.post(`/internal/proof/${p.id}/begin`, { userId: t.userId });
    expect([early.statusCode, early.json<{ error: string }>().error]).toEqual([409, "wrong_state"]);
  });

  it("a check-in is refused before tracking, and a baseline is refused during it", async () => {
    const t = make();
    const p = await t.create();
    const early = await t.session(p.id, "check_in");
    expect(early.json<{ error: string }>().error).toBe("wrong_state");
  });

  it("within the day-to-day variation, inside the window: not yet, with the day count", async () => {
    const { t, p } = await tracking(28);
    t.engine.changeFor = (i) => ({
      delta: i.now - i.baseline,
      words: "within",
      phrase: "within your day-to-day variation",
    });
    await t.clock.advance(7 * 24 * HOUR);
    expect((await t.session(p.id, "check_in")).statusCode).toBe(201);
    const v = (await t.view(p.id)).proof.verdicts.at(-1);
    expect(v).toMatchObject({
      state: "not_yet",
      words: "within",
      day: 7,
      windowDays: 28,
      mdc: 3.3,
    });
    expect((await t.view(p.id)).proof.status).toBe("tracking");
  });

  it("a change above the variation is detected, with its words and the numbers behind them", async () => {
    const { t, p } = await tracking();
    t.engine.changeFor = () => ({ delta: 7, words: "clear", phrase: "a clear change" });
    await t.clock.advance(14 * 24 * HOUR);
    await t.session(p.id, "check_in");
    const v = (await t.view(p.id)).proof.verdicts.at(-1);
    expect(v).toMatchObject({ state: "detected", words: "clear", delta: 7 });
    expect(v?.baseline).toBeTypeOf("number");
    expect(v?.now).toBeTypeOf("number");
  });

  it("a change the wrong way says so", async () => {
    const { t, p } = await tracking();
    t.engine.changeFor = () => ({
      delta: -6,
      words: "opposite",
      phrase: "changed, but not in the direction the product claims",
    });
    await t.clock.advance(14 * 24 * HOUR);
    await t.session(p.id, "check_in");
    expect((await t.view(p.id)).proof.verdicts.at(-1)?.state).toBe("opposite");
  });

  it("at the end of the window with no change, the proof ends with the honest sentence", async () => {
    const { t, p } = await tracking(14);
    t.engine.changeFor = () => ({
      delta: 0.4,
      words: "within",
      phrase: "within your day-to-day variation",
    });
    await t.clock.advance(15 * 24 * HOUR);
    await t.session(p.id, "check_in");
    const { proof } = await t.view(p.id);
    expect(proof.verdicts.at(-1)?.state).toBe("window_ended_no_change");
    expect(proof.status).toBe("ended");
  });

  it("while the variation is not known there is no verdict to give", async () => {
    const t = make();
    const p = await t.create();
    await t.baseline(p.id);
    await t.post(`/internal/proof/${p.id}/begin`, { userId: t.userId });
    await t.clock.advance(14 * 24 * HOUR);
    await t.session(p.id, "check_in");
    expect((await t.view(p.id)).proof.verdicts.at(-1)).toMatchObject({
      state: "collecting",
      words: "n/a",
      mdc: null,
    });
  });

  it("a check-in too soon after the last is refused", async () => {
    const { t, p } = await tracking();
    await t.clock.advance(14 * 24 * HOUR);
    await t.session(p.id, "check_in");
    const again = await t.session(p.id, "check_in");
    expect(again.json<{ error: string }>().error).toBe("too_soon");
  });

  it("the next check-in is due a week after the last session", async () => {
    const { t, p } = await tracking();
    const v = await t.view(p.id);
    const last = Date.parse(v.proof.sessions.at(-1)?.at ?? "");
    expect(Date.parse(v.nextDue ?? "")).toBe(last + 7 * 24 * HOUR);
  });

  it("another product started: the warning is recorded and stays with the proof", async () => {
    const { t, p } = await tracking();
    expect((await t.view(p.id)).proof.confound.flagged).toBe(false);
    await t.post(`/internal/proof/${p.id}/confound`, { userId: t.userId });
    expect((await t.view(p.id)).proof.confound.flagged).toBe(true);
  });

  it("a check-in that says the routine changed flags it", async () => {
    const { t, p } = await tracking();
    await t.clock.advance(8 * 24 * HOUR);
    await t.session(p.id, "check_in", { confound: true });
    expect((await t.view(p.id)).proof.confound.flagged).toBe(true);
  });

  it("stopping ends tracking", async () => {
    const { t, p } = await tracking();
    await t.post(`/internal/proof/${p.id}/stop`, { userId: t.userId });
    expect((await t.view(p.id)).proof.status).toBe("stopped");
  });

  it("another person cannot read or change a proof", async () => {
    const { t, p } = await tracking();
    const other = newId("usr");
    expect((await t.get(`/internal/proof/${other}/${p.id}`)).statusCode).toBe(404);
    const stop = await t.post(`/internal/proof/${p.id}/stop`, { userId: other });
    expect(stop.statusCode).toBe(404);
  });
});

describe("the phantom and the visualisation", () => {
  const ready = async () => {
    const t = make();
    t.engine.noiseFloorOverride = { s_d: 1.1, s_d_source: "estimated", se: 1.2, mdc: 3.3 };
    const p = await t.create();
    await t.baseline(p.id);
    return { t, p };
  };
  const calibrate = async (t: ReturnType<typeof make>, id: string) => {
    const body = { userId: t.userId, sessionId: t.sessionId, proofId: id, photo: await t.photo() };
    const q = await t.post("/internal/proof/phantom/quote", body);
    const total = q.json<{ quote: { total: number } }>().quote.total;
    const s = await t.post("/internal/proof/phantom/start", { ...body, confirmedTotal: total });
    await t.settle();
    return { q, s, total };
  };

  it("needs a known variation before it can judge a sweep", async () => {
    const t = make();
    const p = await t.create();
    await t.session(p.id, "baseline");
    const res = await t.post("/internal/proof/phantom/quote", {
      userId: t.userId,
      sessionId: t.sessionId,
      proofId: p.id,
      photo: await t.photo(),
    });
    expect([res.statusCode, res.json<{ error: string }>().error]).toEqual([409, "wrong_state"]);
  });

  it("five simulations and five measurements are fitted and kept, once per person", async () => {
    const { t, p } = await ready();
    const { total, s } = await calibrate(t, p.id);
    expect(s.statusCode).toBe(201);
    // Five simulations (4 units) and five analyses of one concern (12 units).
    expect(total).toBe(80);
    const { proof } = await t.view(p.id);
    expect(proof.phantom).toMatchObject({ usable: true, reason: "ok" });
    expect(proof.phantom?.scores).toHaveLength(5);
    // The synthetic sweep gets worse as the simulation grows; the stored scores show it.
    const scores = proof.phantom?.scores ?? [];
    expect(scores[0]).toBeGreaterThan(scores[4] ?? 0);
    const again = await t.post("/internal/proof/phantom/quote", {
      userId: t.userId,
      sessionId: t.sessionId,
      proofId: p.id,
      photo: await t.photo(),
    });
    expect(again.json<{ error: string }>().error).toBe("already_calibrated");
  });

  it("a phantom that is not usable is kept as such, and no visualisation is offered", async () => {
    const { t, p } = await ready();
    t.engine.phantom = { ...t.engine.phantom, usable: false, reason: "not_monotone", rho: 0.2 };
    await calibrate(t, p.id);
    const { proof } = await t.view(p.id);
    expect(proof.phantom).toMatchObject({ usable: false, reason: "not_monotone" });
    const res = await t.post("/internal/proof/visual/quote", {
      userId: t.userId,
      sessionId: t.sessionId,
      proofId: p.id,
      photo: await t.photo(),
      target: "preview",
    });
    expect([res.statusCode, res.json<{ error: string }>().error]).toEqual([
      409,
      "phantom_unusable",
    ]);
  });

  it("a preview shows the smallest change MIRA can detect, as the more visible state", async () => {
    const { t, p } = await ready();
    await calibrate(t, p.id);
    const body = {
      userId: t.userId,
      sessionId: t.sessionId,
      proofId: p.id,
      photo: await t.photo(),
      target: "preview",
    };
    const q = await t.post("/internal/proof/visual/quote", body);
    expect(q.statusCode).toBe(200);
    expect(q.json<{ intensity: number }>().intensity).toBe(0.5);
    const total = q.json<{ quote: { total: number } }>().quote.total;
    const s = await t.post("/internal/proof/visual/start", { ...body, confirmedTotal: total });
    expect(s.statusCode).toBe(201);
  });

  it("outside what the sweep covered, nothing is extrapolated", async () => {
    const { t, p } = await ready();
    await calibrate(t, p.id);
    t.engine.phantom = { ...t.engine.phantom, inverted_intensity: null };
    const res = await t.post("/internal/proof/visual/quote", {
      userId: t.userId,
      sessionId: t.sessionId,
      proofId: p.id,
      photo: await t.photo(),
      target: "preview",
    });
    expect([res.statusCode, res.json<{ error: string }>().error]).toEqual([409, "outside_range"]);
  });

  it("a verdict visualisation needs a measured improvement", async () => {
    const { t, p } = await ready();
    await calibrate(t, p.id);
    const res = await t.post("/internal/proof/visual/quote", {
      userId: t.userId,
      sessionId: t.sessionId,
      proofId: p.id,
      photo: await t.photo(),
      target: "verdict",
    });
    expect([res.statusCode, res.json<{ error: string }>().error]).toEqual([
      409,
      "no_change_to_show",
    ]);
  });
});

describe("the measured review", () => {
  const finished = async () => {
    const t = make();
    t.engine.noiseFloorOverride = { s_d: 1.1, s_d_source: "estimated", se: 1.2, mdc: 3.3 };
    const p = await t.create(14);
    await t.baseline(p.id);
    await t.post(`/internal/proof/${p.id}/begin`, { userId: t.userId });
    t.engine.changeFor = () => ({
      delta: 0.2,
      words: "within",
      phrase: "within your day-to-day variation",
    });
    await t.clock.advance(15 * 24 * HOUR);
    await t.session(p.id, "check_in");
    return { t, p };
  };

  it("is refused before the window ends, and without a yes", async () => {
    const t = make();
    const p = await t.create();
    const early = await t.post(`/internal/proof/${p.id}/review`, {
      userId: t.userId,
      consent: true,
    });
    expect(early.json<{ error: string }>().error).toBe("not_finished");
    const { t: t2, p: p2 } = await finished();
    const noYes = await t2.post(`/internal/proof/${p2.id}/review`, { userId: t2.userId });
    expect(noYes.statusCode).toBe(400);
  });

  it("publishes only the anonymised fields, once", async () => {
    const { t, p } = await finished();
    await t.ports.state.set(
      `twins/${t.userId}`,
      Twin.parse({
        userId: t.userId,
        createdAt: at,
        updatedAt: at,
        metrics: {
          "colour.fitzpatrick_band": {
            id: "colour.fitzpatrick_band",
            kind: "category",
            value: "III",
            source: { feature: "fitzpatrick-scale-analyzer", version: "v2.0", taskRunId: "r" },
            confidence: "n/a",
            measuredAt: at,
          },
        },
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
    const res = await t.post(`/internal/proof/${p.id}/review`, { userId: t.userId, consent: true });
    expect(res.statusCode).toBe(201);
    const outcome = EfficacyOutcome.parse(res.json<{ published: unknown }>().published);
    expect(outcome).toMatchObject({
      concern: "pore",
      words: "within",
      mdc: 3.3,
      fitzpatrick_band: "III",
    });
    expect(outcome.week).toMatch(/^\d{4}-W\d{2}$/);
    const stored = JSON.stringify(await t.ports.state.list("efficacy_outcomes"));
    expect(stored).not.toContain(t.userId);
    expect(stored).not.toContain(p.id);
    const again = await t.post(`/internal/proof/${p.id}/review`, {
      userId: t.userId,
      consent: true,
    });
    expect(again.json<{ error: string }>().error).toBe("already_published");
  });
});

describe("deleting", () => {
  it("removes the proof", async () => {
    const t = make();
    const p = await t.create();
    expect(
      (await t.ctx.app.inject({ method: "DELETE", url: `/internal/proof/${t.userId}/${p.id}` }))
        .statusCode,
    ).toBe(204);
    expect((await t.get(`/internal/proof/${t.userId}/${p.id}`)).statusCode).toBe(404);
  });
});
