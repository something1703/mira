import { FakeClock } from "@mira/runtime";
import { err, type Result } from "@mira/schemas";
import { networkError, type YouCamError } from "@mira/youcam-client";
import { FakeYouCam } from "@mira/youcam-client/testing";
import { describe, expect, it } from "vitest";
import { makeHarness, youcam } from "./harness";

const TONE = { color: { skin_color: "#C79A78" } };

async function oneNode(h: ReturnType<typeof makeHarness>, extra = {}) {
  const src = await h.photo("face");
  return await h.start({
    type: "demo",
    nodes: [youcam("a", "skin-tone-analysis", { inputs: { src }, ...extra })],
  });
}

/** A fake whose create call can be made to fail after the task was in fact accepted. */
class FlakyCreate extends FakeYouCam {
  failCreateWith: YouCamError | undefined;
  override async createTask(
    feature: Parameters<FakeYouCam["createTask"]>[0],
    body: Parameters<FakeYouCam["createTask"]>[1],
  ): Promise<Result<{ taskId: string }, YouCamError>> {
    if (this.failCreateWith) {
      const e = this.failCreateWith;
      // YouCam accepted the task; only the reply was lost.
      await super.createTask(feature, body);
      return err(e);
    }
    return await super.createTask(feature, body);
  }
}

describe("a task is submitted at most once (AGENTS.md §2.3)", () => {
  it("two deliveries of the same start create one task and one charge", async () => {
    const h = makeHarness();
    h.fake.script("skin-tone-analysis", { results: TONE });
    const runId = await oneNode(h);
    await Promise.all([
      h.engine.runner.lifecycle.start(runId, "a"),
      h.engine.runner.lifecycle.start(runId, "a"),
    ]);
    await h.settle();
    expect(h.fake.callsTo("createTask")).toBe(1);
    expect((await h.nodes(runId)).a?.status).toBe("done");
    expect(h.fake.units).toBe(980);
    expect((await h.engine.ledger.budget(h.sessionId)).committed).toBe(20);
  });

  it("a worker that died after claiming the submit does not submit again; it reports unknown and returns the reserve", async () => {
    const h = makeHarness();
    const runId = await oneNode(h);
    // Simulate the crash: claimed long ago, reserved, no task id stored.
    await h.ports.state.update(`runs/${runId}/nodes/a`, (cur) => ({
      ...(cur as object),
      submitting: new Date(h.clock.now() - 10 * 60_000).toISOString(),
      status: "running",
    }));
    await h.engine.ledger.reserve(
      { runId, nodeId: "a", sessionId: h.sessionId, feature: "skin-tone-analysis" },
      20,
      undefined,
    );
    await h.engine.runner.lifecycle.start(runId, "a");
    await h.settle();
    expect(h.fake.callsTo("createTask")).toBe(0);
    expect((await h.nodes(runId)).a).toMatchObject({
      status: "failed",
      error: { code: "submit_unknown" },
    });
    expect(await h.engine.ledger.budget(h.sessionId)).toMatchObject({ reserved: 0, committed: 0 });
  });

  it("a recent claim is waited for, not overridden", async () => {
    const h = makeHarness();
    const runId = await oneNode(h);
    await h.ports.state.update(`runs/${runId}/nodes/a`, (cur) => ({
      ...(cur as object),
      submitting: new Date(h.clock.now()).toISOString(),
      status: "running",
    }));
    await h.engine.runner.lifecycle.start(runId, "a");
    expect(h.fake.callsTo("createTask")).toBe(0);
    expect((await h.nodes(runId)).a?.status).toBe("running");
  });

  it("a lost reply after an accepted task is never retried", async () => {
    const clock = new FakeClock();
    const fake = new FlakyCreate({ clock, prices: { "skin-tone-analysis": 20 } });
    fake.failCreateWith = networkError(new Error("socket hang up"));
    const h = makeHarness({ fake, clock });
    const runId = await oneNode(h);
    await h.settle();
    expect(fake.callsTo("createTask")).toBe(1);
    expect((await h.nodes(runId)).a).toMatchObject({
      status: "failed",
      error: { code: "submit_unknown" },
    });
  });

  it("a refusal that cannot have started a task is still retried", async () => {
    const h = makeHarness();
    h.fake.script("skin-tone-analysis", { results: TONE });
    h.fake.rateLimitNext(1);
    const runId = await oneNode(h);
    await h.settle(400, 5_000);
    expect((await h.nodes(runId)).a?.status).toBe("done");
    expect(h.fake.callsTo("createTask")).toBeGreaterThanOrEqual(1);
  });
});

describe("the ledger and the node agree", () => {
  it("two settles at once do not zero the node's units", async () => {
    const h = makeHarness();
    h.fake.script("skin-tone-analysis", { latencyMs: 1_000, results: TONE });
    const runId = await oneNode(h);
    await h.engine.runner.lifecycle.start(runId, "a");
    await h.clock.advance(5_000);
    await Promise.all([
      h.engine.runner.lifecycle.poll(runId, "a", 0),
      h.engine.runner.lifecycle.poll(runId, "a", 0),
    ]);
    await h.settle();
    const node = (await h.nodes(runId)).a;
    expect(node?.unitsCommitted).toBe(20);
    expect((await h.run(runId)).unitsSpent).toBe(20);
    expect((await h.engine.ledger.budget(h.sessionId)).committed).toBe(20);
    expect(h.events.filter((e) => e.type === "node_done")).toHaveLength(1);
  });

  it("a cache hit returns a reserve an earlier attempt took", async () => {
    const h = makeHarness();
    h.fake.script("skin-tone-analysis", { results: TONE });
    const first = await oneNode(h);
    await h.settle();
    expect((await h.nodes(first)).a?.status).toBe("done");

    const second = await oneNode(h);
    await h.engine.ledger.reserve(
      { runId: second, nodeId: "a", sessionId: h.sessionId, feature: "skin-tone-analysis" },
      20,
      undefined,
    );
    await h.settle();
    expect((await h.nodes(second)).a?.status).toBe("cached");
    const b = await h.engine.ledger.budget(h.sessionId);
    expect(b.reserved).toBe(0);
    expect(Object.keys(b.open)).toEqual([]);
  });

  it("units stay counted when YouCam succeeded but the result could not be fetched", async () => {
    const h = makeHarness({
      download: () => Promise.resolve({ ok: false as const, error: { message: "offline" } }),
    });
    const runId = await h.start({
      type: "demo",
      nodes: [youcam("a", "sod", { inputs: { src: await h.photo("g") } })],
    });
    await h.settle(2_000, 5_000);
    const node = (await h.nodes(runId)).a;
    expect(node).toMatchObject({ status: "failed", error: { code: "download_failed" } });
    expect((await h.engine.ledger.budget(h.sessionId)).committed).toBeGreaterThan(0);
  });
});

describe("a fresh render is measured again (D23)", () => {
  it("the next step's cache key follows the bytes the previous step produced", async () => {
    let render = 0;
    const h = makeHarness({
      download: () => {
        render += 1;
        return Promise.resolve({
          ok: true as const,
          value: { bytes: new Uint8Array([137, 80, 78, 71, render]), contentType: "image/png" },
        });
      },
    });
    h.fake.respondWith("skin-tone-analysis", { results: { color: { skin_color: "#111111" } } });
    const graph = async () => ({
      type: "demo" as const,
      nodes: [
        youcam("a", "sod", { inputs: { src: await h.photo("g") } }),
        youcam("b", "skin-tone-analysis", { inputs: { src: "node:a" }, dependsOn: ["a"] }),
      ],
    });
    const one = await h.start(await graph());
    await h.settle();
    expect((await h.nodes(one)).b?.output).toMatchObject({ color: { skin_color: "#111111" } });

    // Same photo, new run: the image render differs, so the measure of it must run again.
    h.fake.respondWith("skin-tone-analysis", { results: { color: { skin_color: "#999999" } } });
    const two = await h.start(await graph());
    await h.settle();
    const b = (await h.nodes(two)).b;
    expect(b?.status).toBe("done");
    expect(b?.output).toMatchObject({ color: { skin_color: "#999999" } });
  });
});

describe("the review window (D35)", () => {
  it("a look can be saved after the run ends, and everything is deleted once the window closes", async () => {
    const h = makeHarness();
    const upload = "uploads/usr_x/up_face.jpg";
    await h.ports.blobs.put(upload, new Uint8Array([255, 216, 255, 224, 1]), "image/jpeg");
    const runId = await h.start({
      type: "demo",
      nodes: [youcam("a", "sod", { inputs: { src: `blob:${upload}` } })],
    });
    // Run until the run is finished but before the window closes.
    for (let i = 0; i < 60; i++) {
      await h.ports.queue.tick();
      if ((await h.run(runId)).status !== "running") break;
      await h.clock.advance(1_000);
    }
    expect((await h.run(runId)).status).toBe("succeeded");
    // The person's photo is gone at once; the preview and the task are still there.
    expect(await h.ports.blobs.get(upload)).toBeUndefined();
    expect((await h.run(runId)).cleanedAt).toBeUndefined();
    const saved = await h.engine.runner.save(runId, ["a"]);
    expect(saved.ok).toBe(true);

    await h.settle();
    expect((await h.run(runId)).cleanedAt).toBeDefined();
    expect(await h.ports.blobs.list(`runs/${runId}/`)).toEqual([]);
    if (saved.ok) expect(await h.ports.blobs.list(saved.value.keys[0] ?? "x")).toHaveLength(1);
    // After cleanup there is nothing left to save, and it says so.
    const late = await h.engine.runner.save(runId, ["a"]);
    expect(late).toMatchObject({ ok: false, error: { code: "images_deleted" } });
  });

  it("a run that makes no preview image is cleaned at once", async () => {
    const h = makeHarness();
    h.fake.script("skin-tone-analysis", { results: TONE });
    const runId = await oneNode(h);
    for (let i = 0; i < 60; i++) {
      await h.ports.queue.tick();
      if ((await h.run(runId)).cleanedAt !== undefined) break;
      await h.clock.advance(1_000);
    }
    expect((await h.run(runId)).cleanedAt).toBeDefined();
  });
});

describe("only what MIRA reads is kept of an analyser's answer", () => {
  it("drops the age and gender guess from the run and from the cache", async () => {
    const h = makeHarness({ prices: { "face-attr-analysis": 10 } });
    h.fake.script("face-attr-analysis", {
      results: {
        facialratio: { horizontal_third: [0.33, 0.34, 0.33] },
        agegender: { age: 31, gender: "female" },
        face_quality: { has_face: true, lighting: "good" },
      },
    });
    const src = await h.photo("face");
    const runId = await h.start({
      type: "demo",
      nodes: [
        youcam("a", "face-attr-analysis", {
          inputs: { src },
          params: { features: ["horizontalThird"] },
        }),
      ],
    });
    await h.settle();
    const node = (await h.nodes(runId)).a;
    expect(node?.output).toEqual({ facialratio: { horizontal_third: [0.33, 0.34, 0.33] } });
    const cached = await h.ports.state.list("cache");
    expect(JSON.stringify(cached)).not.toMatch(/agegender|female|face_quality/);
  });
});
