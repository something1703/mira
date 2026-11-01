import { InProcessQueue, FakeClock, createMockPorts, updateDoc } from "@mira/runtime";
import { Run, RunNode, type Audit } from "@mira/schemas";
import { describe, expect, it } from "vitest";
import { cleanupRun } from "../src/runner/cleanup";
import { deleteSaved } from "../src/runner/save";
import { PNG, makeHarness, youcam } from "./harness";

const SKIN_TONE = { color: { skin_color: "#C79A78", lip_color: "#A5504F" } };
const foundation = {
  effects: [
    {
      category: "foundation",
      palettes: [
        { color: "#C79A78", colorIntensity: 60, glowIntensity: 30, coverageIntensity: 40 },
      ],
    },
  ],
};

async function single(h: ReturnType<typeof makeHarness>, feature: string, params: object = {}) {
  const src = await h.photo("face");
  return await h.start({
    type: "demo",
    nodes: [youcam("a", feature, { inputs: { src }, params: params as Record<string, unknown> })],
  });
}

describe("happy path", () => {
  it("runs the eight steps for an analyser and settles the ledger", async () => {
    const h = makeHarness();
    h.fake.script("skin-tone-analysis", { results: SKIN_TONE });
    const runId = await single(h, "skin-tone-analysis");
    await h.settle();

    const run = await h.run(runId);
    const node = (await h.nodes(runId)).a;
    expect(run.status).toBe("succeeded");
    expect(run.unitsSpent).toBe(20);
    expect(node?.status).toBe("done");
    expect(node?.output).toEqual(SKIN_TONE);
    expect(node?.unitsReserved).toBe(20);
    expect(node?.unitsCommitted).toBe(20);
    expect(h.fake.units).toBe(980);
    expect((await h.engine.ledger.entries(runId)).map((e) => [e.kind, e.units])).toEqual(
      expect.arrayContaining([
        ["reserve", 20],
        ["commit", 20],
      ]),
    );
    expect(h.events.filter((e) => e.runId === runId).map((e) => e.type)).toEqual([
      "run_started",
      "node_started",
      "node_waiting",
      "node_done",
      "run_finished",
    ]);
    // The task id was written before waiting and indexed for webhooks.
    expect(await h.ports.state.get(`tasks/${node?.taskId ?? ""}`)).toEqual({ runId, nodeId: "a" });
  });

  it("uploads once: register, PUT, then create with the file id", async () => {
    const h = makeHarness();
    h.fake.script("skin-tone-analysis", { results: SKIN_TONE });
    await single(h, "skin-tone-analysis");
    await h.settle();
    expect(h.fake.callsTo("registerFile")).toBe(1);
    expect(h.fake.callsTo("putBytes")).toBe(1);
    expect(h.fake.callsTo("createTask")).toBe(1);
    const order = h.fake.calls.map((c) => c.op);
    expect(order.indexOf("registerFile")).toBeLessThan(order.indexOf("putBytes"));
    expect(order.indexOf("putBytes")).toBeLessThan(order.indexOf("createTask"));
  });

  it("copies an image result out before its URL expires, and deletes it at run end", async () => {
    const h = makeHarness();
    // Look at storage at the instant the node reports done: cleanup is delivered right after.
    const seen: { ref: string | undefined; stored: boolean }[] = [];
    h.ports.events.subscribe("run-events", async (e) => {
      const ev = e as { type: string; runId: string; nodeId?: string };
      if (ev.type !== "node_done") return;
      const node = (await h.nodes(ev.runId))[ev.nodeId ?? ""];
      seen.push({
        ref: node?.resultRef,
        stored: node?.resultRef ? (await h.ports.blobs.get(node.resultRef)) !== undefined : false,
      });
    });
    const runId = await single(h, "makeup-vto", foundation);
    await h.settle();

    expect(seen).toEqual([{ ref: `runs/${runId}/a/output.png`, stored: true }]);
    expect(h.downloads).toHaveLength(1);
    const node = (await h.nodes(runId)).a;
    expect(node?.resultUrlExpiresAt).toBeDefined();
    expect(await h.ports.blobs.list(`runs/${runId}/`)).toEqual([]);
    expect(h.fake.deleted.has(node?.taskId ?? "")).toBe(true);
    expect((await h.run(runId)).cleanedAt).toBeDefined();
  });
});

describe("cache", () => {
  it("a second run with the same photo and params is a cache hit: zero units, zero tasks", async () => {
    const h = makeHarness();
    h.fake.script("skin-tone-analysis", { results: SKIN_TONE });
    await single(h, "skin-tone-analysis");
    await h.settle();
    const unitsAfterFirst = h.fake.units;

    const second = await single(h, "skin-tone-analysis");
    await h.settle();
    const node = (await h.nodes(second)).a;
    expect(node?.status).toBe("cached");
    expect(node?.unitsCommitted).toBe(0);
    expect(node?.output).toEqual(SKIN_TONE);
    expect(h.fake.callsTo("createTask")).toBe(1);
    expect(h.fake.units).toBe(unitsAfterFirst);
    expect(h.events.some((e) => e.runId === second && e.type === "node_cached")).toBe(true);
    expect((await h.run(second)).status).toBe("succeeded");
  });

  it("a different photo, different params or a new engine version is a miss", async () => {
    const h = makeHarness();
    h.fake.script("skin-tone-analysis", { results: SKIN_TONE });
    h.fake.script("skin-tone-analysis", { results: SKIN_TONE });
    await single(h, "skin-tone-analysis");
    await h.settle();
    const other = await h.photo("other", new Uint8Array([9, 9, 9]));
    const runId = await h.start({
      type: "demo",
      nodes: [youcam("a", "skin-tone-analysis", { inputs: { src: other } })],
    });
    await h.settle();
    expect((await h.nodes(runId)).a?.status).toBe("done");
    expect(h.fake.callsTo("createTask")).toBe(2);
  });

  it("image results are never reused across runs: their images were deleted", async () => {
    const h = makeHarness();
    await single(h, "makeup-vto", foundation);
    await h.settle();
    const second = await single(h, "makeup-vto", foundation);
    await h.settle();
    expect((await h.nodes(second)).a?.status).toBe("done");
    expect(h.fake.callsTo("createTask")).toBe(2);
  });

  it("a cache entry older than 7 days is ignored", async () => {
    const h = makeHarness();
    h.fake.script("skin-tone-analysis", { results: SKIN_TONE });
    h.fake.script("skin-tone-analysis", { results: SKIN_TONE });
    await single(h, "skin-tone-analysis");
    await h.settle();
    await h.clock.advance(8 * 86_400_000);
    await single(h, "skin-tone-analysis");
    await h.settle();
    expect(h.fake.callsTo("createTask")).toBe(2);
  });
});

describe("budget", () => {
  it("over the session cap: nothing is submitted, dependents are skipped, no units move", async () => {
    const h = makeHarness({ caps: { session: 10 } });
    const src = await h.photo("face");
    const runId = await h.start({
      type: "demo",
      nodes: [
        youcam("a", "skin-tone-analysis", { inputs: { src } }),
        youcam("b", "sod", { inputs: { src: "node:a" }, dependsOn: ["a"] }),
      ],
    });
    await h.settle();
    const nodes = await h.nodes(runId);
    expect(nodes.a).toMatchObject({
      status: "failed",
      error: { code: "over_cap", unitsCharged: 0 },
    });
    expect(nodes.b?.status).toBe("skipped");
    expect(h.fake.callsTo("createTask")).toBe(0);
    expect(h.fake.callsTo("registerFile")).toBe(0);
    expect(h.fake.units).toBe(1_000);
    expect(await h.engine.ledger.budget(h.sessionId)).toMatchObject({ reserved: 0, committed: 0 });
    expect((await h.run(runId)).status).toBe("failed");
  });

  it("a node above the per-node cap is refused", async () => {
    const h = makeHarness({ caps: { node: 5 } });
    const runId = await single(h, "skin-tone-analysis");
    await h.settle();
    expect((await h.nodes(runId)).a?.error?.code).toBe("over_cap");
  });

  it("refuses when YouCam's live balance cannot cover the price", async () => {
    const h = makeHarness({ startingUnits: 5 });
    const runId = await single(h, "skin-tone-analysis");
    await h.settle();
    expect((await h.nodes(runId)).a?.error?.code).toBe("insufficient_units");
    expect(h.fake.callsTo("createTask")).toBe(0);
  });

  it("an unpriced feature is never submitted", async () => {
    const h = makeHarness({ prices: {} });
    const runId = await single(h, "skin-tone-analysis");
    await h.settle();
    expect((await h.nodes(runId)).a?.error?.code).toBe("price_unknown");
    expect(h.fake.callsTo("createTask")).toBe(0);
  });

  it("committed units equal what YouCam charged, and every reserve is closed once", async () => {
    const h = makeHarness();
    h.fake.script("skin-tone-analysis", { results: SKIN_TONE });
    h.fake.script("sod", { failWith: "error_inference", latencyMs: 1_000 });
    const src = await h.photo("face");
    const runId = await h.start({
      type: "demo",
      nodes: [
        youcam("a", "skin-tone-analysis", { inputs: { src } }),
        youcam("b", "sod", { inputs: { src } }),
        youcam("c", "sod", { inputs: { src } }),
      ],
    });
    await h.settle();
    const entries = await h.engine.ledger.entries(runId);
    const sum = (k: string) => entries.filter((e) => e.kind === k).reduce((n, e) => n + e.units, 0);
    expect(sum("reserve")).toBe(sum("commit") + sum("release"));
    expect(sum("commit")).toBe(1_000 - h.fake.units);
    const budget = await h.engine.ledger.budget(h.sessionId);
    expect(budget.reserved).toBe(0);
    expect(budget.committed).toBe(sum("commit"));
    expect(Object.keys(budget.open)).toEqual([]);
  });
});

describe("crash and resume", () => {
  it("a worker that restarts after submit polls the stored task and never resubmits", async () => {
    const h = makeHarness();
    h.fake.script("skin-tone-analysis", { results: SKIN_TONE });
    const runId = await single(h, "skin-tone-analysis");
    await h.ports.queue.tick(); // start delivered: task created, poll scheduled
    const waiting = (await h.nodes(runId)).a;
    expect(waiting?.status).toBe("waiting");
    expect(waiting?.taskId).toBeDefined();
    expect(h.fake.callsTo("createTask")).toBe(1);

    // The worker dies. A fresh engine on the same state gets the "start" delivery again.
    const queue = new InProcessQueue({ clock: h.clock });
    const reborn = makeHarness({ ports: { ...h.ports, queue }, fake: h.fake, clock: h.clock });
    await queue.enqueue("youcam-submit", { payload: { op: "start", runId, nodeId: "a" } });
    await reborn.settle();

    expect(h.fake.callsTo("createTask")).toBe(1);
    expect(h.fake.callsTo("registerFile")).toBe(1);
    expect((await h.run(runId)).status).toBe("succeeded");
    expect((await h.nodes(runId)).a?.unitsCommitted).toBe(20);
  });

  it("a duplicate start after completion does nothing", async () => {
    const h = makeHarness();
    h.fake.script("skin-tone-analysis", { results: SKIN_TONE });
    const runId = await single(h, "skin-tone-analysis");
    await h.settle();
    await h.ports.queue.enqueue("youcam-submit", { payload: { op: "start", runId, nodeId: "a" } });
    await h.ports.queue.enqueue("youcam-poll", {
      payload: { op: "poll", runId, nodeId: "a", n: 9 },
    });
    await h.settle();
    expect(h.fake.callsTo("createTask")).toBe(1);
    expect((await h.engine.ledger.entries(runId)).filter((e) => e.kind === "commit")).toHaveLength(
      1,
    );
  });
});

describe("webhook and poll", () => {
  it("a webhook polls straight away; the scheduled poll then finds nothing to do", async () => {
    const h = makeHarness();
    h.fake.script("skin-tone-analysis", { results: SKIN_TONE, latencyMs: 1_000 });
    const runId = await single(h, "skin-tone-analysis");
    await h.ports.queue.tick();
    const taskId = (await h.nodes(runId)).a?.taskId ?? "";

    await h.clock.advance(1_000); // the task finishes; the scheduled poll is not due until 2 000
    expect(await h.engine.runner.lifecycle.pollNow(taskId, "wh_1")).toBe(true);
    await h.ports.queue.tick();
    expect((await h.nodes(runId)).a?.status).toBe("done");
    expect(h.fake.callsTo("getTask")).toBe(1);

    await h.settle();
    expect(h.fake.callsTo("getTask")).toBe(1);
  });

  it("a redelivered webhook is de-duplicated; an unknown task id is refused", async () => {
    const h = makeHarness();
    const runId = await single(h, "skin-tone-analysis");
    await h.ports.queue.tick();
    const taskId = (await h.nodes(runId)).a?.taskId ?? "";
    await h.engine.runner.lifecycle.pollNow(taskId, "wh_same");
    const before = h.ports.queue.snapshot().length;
    await h.engine.runner.lifecycle.pollNow(taskId, "wh_same");
    expect(h.ports.queue.snapshot()).toHaveLength(before);
    expect(await h.engine.runner.lifecycle.pollNow("no_such_task", "wh_2")).toBe(false);
  });
});

describe("errors", () => {
  it("an engine failure releases the units, maps the code and charges nothing", async () => {
    const h = makeHarness();
    h.fake.script("skin-tone-analysis", { failWith: "error_src_face_too_small", latencyMs: 1_000 });
    const runId = await single(h, "skin-tone-analysis");
    await h.settle();
    const node = (await h.nodes(runId)).a;
    expect(node).toMatchObject({
      status: "failed",
      unitsCommitted: 0,
      error: {
        code: "face_too_small",
        upstream: "error_src_face_too_small",
        guidance: "retake",
        unitsCharged: 0,
      },
    });
    expect(h.fake.units).toBe(1_000);
    expect((await h.engine.ledger.entries(runId)).map((e) => e.kind).sort()).toEqual([
      "release",
      "reserve",
    ]);
    expect(await h.engine.ledger.budget(h.sessionId)).toMatchObject({ reserved: 0, committed: 0 });
    expect((await h.run(runId)).status).toBe("failed");
  });

  it("retries a rate limit and a network blip, then succeeds", async () => {
    const h = makeHarness();
    h.fake.script("skin-tone-analysis", { results: SKIN_TONE });
    h.fake.rateLimitNext(1);
    h.fake.failNetworkNext(1);
    const runId = await single(h, "skin-tone-analysis");
    await h.settle();
    const node = (await h.nodes(runId)).a;
    expect(node?.status).toBe("done");
    expect(node?.attempts).toBeGreaterThan(1);
    expect(h.fake.callsTo("createTask")).toBe(1);
  });

  it("gives up after the retry limit and says so", async () => {
    const h = makeHarness();
    h.fake.failNetworkNext(1_000);
    const runId = await single(h, "skin-tone-analysis");
    await h.settle();
    expect((await h.nodes(runId)).a).toMatchObject({
      status: "failed",
      error: { code: "network", retryable: true },
    });
    expect(h.fake.callsTo("createTask")).toBe(0);
  });

  it("a task that never finishes times out, keeps its units counted (it may still be charged) and is deleted later", async () => {
    const h = makeHarness();
    h.fake.script("skin-tone-analysis", { latencyMs: 20 * 60_000, results: SKIN_TONE });
    const runId = await single(h, "skin-tone-analysis");
    await h.settle(2_000, 5_000);
    const node = (await h.nodes(runId)).a;
    expect(node?.error?.code).toBe("youcam_timeout");
    expect(await h.engine.ledger.budget(h.sessionId)).toMatchObject({ reserved: 0, committed: 20 });
    expect((await h.run(runId)).status).toBe("failed");
  });

  it("an unreadable success still commits (YouCam charged) and fails the node", async () => {
    const h = makeHarness();
    h.fake.script("skin-tone-analysis", { results: { unexpected: true }, latencyMs: 1_000 });
    const runId = await single(h, "skin-tone-analysis");
    await h.settle();
    const node = (await h.nodes(runId)).a;
    expect(node?.error?.code).toBe("invalid_response");
    expect((await h.engine.ledger.budget(h.sessionId)).committed).toBe(20);
  });

  it("a malformed or unknown request fails fast without spending", async () => {
    const h = makeHarness();
    const src = await h.photo("face");
    const bad = await h.start({
      type: "demo",
      nodes: [
        youcam("a", "makeup-vto", { inputs: { src }, params: { effects: [] } }),
        youcam("b", "no-such-feature", { inputs: { src } }),
        youcam("c", "sod", { inputs: { src: "blob:runs/missing/none.jpg" } }),
      ],
    });
    await h.settle();
    const nodes = await h.nodes(bad);
    expect(nodes.a?.error?.code).toBe("invalid_request");
    expect(nodes.b?.error?.code).toBe("unknown_feature");
    expect(nodes.c?.error?.code).toBe("input_missing");
    expect(h.fake.callsTo("createTask")).toBe(0);
  });
});

describe("graphs", () => {
  it("one branch failing leaves the rest running: a partial run that counts what succeeded", async () => {
    const h = makeHarness();
    h.fake.script("sod", { latencyMs: 1_000 });
    h.fake.script("sod", { failWith: "error_no_face", latencyMs: 1_000 });
    const src = await h.photo("face");
    const runId = await h.start({
      type: "demo",
      nodes: [
        youcam("a", "sod", { inputs: { src } }),
        youcam("b", "sod", { inputs: { src: "blob:runs/seed/face.jpg" } }),
        youcam("c", "sod", { inputs: { src } }),
        youcam("d", "sod", { inputs: { src: "node:b" }, dependsOn: ["b"] }),
        youcam("e", "sod", { inputs: { src: "node:a" }, dependsOn: ["a"] }),
      ],
    });
    await h.settle();
    const nodes = await h.nodes(runId);
    const statuses = Object.fromEntries(Object.entries(nodes).map(([id, n]) => [id, n.status]));
    const failedId = Object.entries(statuses).find(([, s]) => s === "failed")?.[0];
    expect(failedId).toBeDefined();
    expect(Object.values(statuses).filter((s) => s === "failed")).toHaveLength(1);
    const run = await h.run(runId);
    expect(run.status).toBe("partial");
    expect((run.outputs.steps as { succeeded: number }).succeeded).toBeGreaterThanOrEqual(2);
    if (failedId === "b") expect(statuses.d).toBe("skipped");
  });

  it("chains on the previous result URL while it is valid, with no re-upload", async () => {
    const h = makeHarness();
    const src = await h.photo("face");
    const runId = await h.start({
      type: "demo",
      nodes: [
        youcam("a", "sod", { inputs: { src } }),
        youcam("b", "sod", { inputs: { src: "node:a" }, dependsOn: ["a"] }),
      ],
    });
    await h.settle();
    const nodes = await h.nodes(runId);
    expect(nodes.b?.status).toBe("done");
    expect(h.fake.callsTo("registerFile")).toBe(1);
    expect(nodes.b?.files).toEqual({});
  });

  it("re-uploads the stored copy when the previous URL has expired", async () => {
    const h = makeHarness({
      executors: {
        "wait-3h": async () => {
          await h.clock.advance(3 * 3_600_000);
          return { ok: true as const, value: {} };
        },
      },
    });
    const src = await h.photo("face");
    const runId = await h.start({
      type: "demo",
      nodes: [
        youcam("a", "sod", { inputs: { src } }),
        { id: "wait", kind: "system", label: "step.wait", feature: "wait-3h", dependsOn: ["a"] },
        youcam("b", "sod", { inputs: { src: "node:a" }, dependsOn: ["a", "wait"] }),
      ],
    });
    await h.settle(1_000, 1_000);
    const nodes = await h.nodes(runId);
    expect(nodes.b?.status).toBe("done");
    expect(h.fake.callsTo("registerFile")).toBe(2);
    expect(nodes.b?.files.src).toBeDefined();
  });

  it("rejects an invalid graph before writing anything", async () => {
    const h = makeHarness();
    const res = await h.engine.runner.startRun({
      graph: {
        type: "demo",
        nodes: [youcam("a", "sod", { dependsOn: ["b"] }), youcam("b", "sod", { dependsOn: ["a"] })],
      },
      userId: h.userId,
      sessionId: h.sessionId,
      planId: "plan_aaaaaa",
      quote: {
        lines: [],
        total: 0,
        sessionUnitsLeft: 0,
        overCap: false,
        pricing: { source: "feature-cost", pricedAt: "2026-11-01T09:00:00.000Z" },
      },
      recorded: false,
    });
    expect(res).toMatchObject({ ok: false, error: { code: "cycle" } });
    expect(await h.ports.state.list("runs")).toEqual([]);
  });

  it("a removed optional node starts skipped and never runs", async () => {
    const h = makeHarness();
    const src = await h.photo("face");
    const runId = await h.start(
      {
        type: "demo",
        nodes: [
          youcam("a", "sod", { inputs: { src } }),
          youcam("video", "sod", { inputs: { src: "node:a" }, dependsOn: ["a"], optional: true }),
        ],
      },
      { removed: ["video"] },
    );
    await h.settle();
    const nodes = await h.nodes(runId);
    expect(nodes.video?.status).toBe("skipped");
    expect((await h.run(runId)).status).toBe("succeeded");
    expect(h.fake.callsTo("createTask")).toBe(1);
  });

  it("an optional node failing still lets the run succeed", async () => {
    const h = makeHarness();
    h.fake.script("sod", { latencyMs: 1_000 });
    h.fake.script("sod", { failWith: "error_inference", latencyMs: 1_000 });
    const src = await h.photo("face");
    const runId = await h.start({
      type: "demo",
      nodes: [
        youcam("a", "sod", { inputs: { src } }),
        youcam("video", "sod", { inputs: { src: "node:a" }, dependsOn: ["a"], optional: true }),
      ],
    });
    await h.settle();
    expect((await h.nodes(runId)).video?.status).toBe("failed");
    expect((await h.run(runId)).status).toBe("succeeded");
  });

  it("local nodes run, see upstream output, and a failing one is reported", async () => {
    const seen: unknown[] = [];
    const h = makeHarness({
      executors: {
        double: (ctx) => {
          seen.push(ctx.upstream.a?.output);
          return Promise.resolve({ ok: true as const, value: { output: { doubled: true } } });
        },
        boom: () =>
          Promise.resolve({ ok: false as const, error: { code: "engine_down", retryable: true } }),
      },
    });
    h.fake.script("skin-tone-analysis", { results: SKIN_TONE, latencyMs: 1_000 });
    const src = await h.photo("face");
    const runId = await h.start({
      type: "demo",
      nodes: [
        youcam("a", "skin-tone-analysis", { inputs: { src } }),
        { id: "x", kind: "engine", label: "step.x", feature: "double", dependsOn: ["a"] },
        { id: "y", kind: "engine", label: "step.y", feature: "boom", dependsOn: ["a"] },
        { id: "z", kind: "system", label: "step.z", feature: "missing", dependsOn: ["a"] },
      ],
    });
    await h.settle();
    const nodes = await h.nodes(runId);
    expect(seen).toEqual([SKIN_TONE]);
    expect(nodes.x).toMatchObject({ status: "done", output: { doubled: true } });
    expect(nodes.y?.error).toMatchObject({ code: "engine_down", unitsCharged: 0 });
    expect(nodes.z?.error?.code).toBe("unknown_executor");
    expect((await h.run(runId)).status).toBe("partial");
  });

  it("cancel stops what has not started and lets a running task finish", async () => {
    const h = makeHarness();
    const src = await h.photo("face");
    const runId = await h.start({
      type: "demo",
      nodes: [
        youcam("a", "sod", { inputs: { src } }),
        youcam("b", "sod", { inputs: { src: "node:a" }, dependsOn: ["a"] }),
        youcam("c", "sod", { inputs: { src: "node:b" }, dependsOn: ["b"] }),
      ],
    });
    await h.ports.queue.tick();
    await h.engine.runner.cancel(runId);
    await h.settle();
    const nodes = await h.nodes(runId);
    expect(nodes.a?.status).toBe("done");
    expect(nodes.b?.status).toBe("cancelled");
    expect(nodes.c?.status).toBe("cancelled");
    expect((await h.run(runId)).status).toBe("cancelled");
    expect(h.fake.callsTo("createTask")).toBe(1);
  });
});

describe("audit (step 7)", () => {
  it("runs on a node's image before anything downstream starts, and is stored", async () => {
    const tasksWhenAudited: number[] = [];
    const verdict: Audit = {
      kind: "garment",
      outcome: "verified",
      deltaE: 2.1,
      directions: [],
      reason: "ok",
      engineVersion: "t",
    };
    const h = makeHarness({
      audit: ({ node, resultRef }) => {
        if (node.id === "a") tasksWhenAudited.push(h.fake.callsTo("createTask"));
        return Promise.resolve(resultRef === undefined ? undefined : verdict);
      },
    });
    const src = await h.photo("face");
    const runId = await h.start({
      type: "demo",
      nodes: [
        youcam("a", "sod", { inputs: { src } }),
        youcam("b", "sod", { inputs: { src: "node:a" }, dependsOn: ["a"] }),
      ],
    });
    await h.settle();
    const nodes = await h.nodes(runId);
    expect(tasksWhenAudited).toEqual([1]); // only A had been submitted; B waited for the audit
    expect(nodes.a?.audit).toEqual(verdict);
    const types = h.events.filter((e) => e.nodeId === "a").map((e) => e.type);
    expect(types.indexOf("node_audited")).toBeLessThan(types.indexOf("node_done"));
  });

  it("an audit that throws becomes 'not checked' and never blocks the run", async () => {
    const h = makeHarness({ audit: () => Promise.reject(new Error("engine down")) });
    const runId = await single(h, "sod");
    await h.settle();
    const node = (await h.nodes(runId)).a;
    expect(node?.status).toBe("done");
    expect(node?.audit).toMatchObject({ outcome: "not_checked", reason: "audit_error" });
  });
});

describe("cleanup", () => {
  it("retries deleting a task that was still running, then marks the run cleaned", async () => {
    const h = makeHarness();
    const runId = await single(h, "sod");
    h.fake.script("sod", { latencyMs: 60_000 });
    const created = await h.fake.createTask({ slug: "sod", version: "v2.0" }, {});
    if (!created.ok) throw new Error("setup");
    await updateDoc(h.ports.state, `runs/${runId}/nodes/a`, RunNode, (n) => {
      if (!n) throw new Error("setup");
      return { ...n, taskId: created.value.taskId };
    });

    const first = await cleanupRun(h.engine.deps, runId, 0);
    expect(first).toMatchObject({ done: false, tasksPending: 1, tasksDeleted: 0 });
    expect((await h.run(runId)).cleanedAt).toBeUndefined();

    await h.clock.advance(61_000);
    await h.ports.queue.tick(); // the retry delivery is at +30 s and now due
    // Drain the queue handler for the cleanup op.
    expect(h.fake.deleted.has(created.value.taskId)).toBe(true);
    expect((await h.run(runId)).cleanedAt).toBeDefined();
  });

  it("treats a task YouCam already removed as deleted", async () => {
    const h = makeHarness();
    const runId = await single(h, "sod");
    await updateDoc(h.ports.state, `runs/${runId}/nodes/a`, RunNode, (n) => {
      if (!n) throw new Error("setup");
      return { ...n, taskId: "gone_task" };
    });
    const out = await cleanupRun(h.engine.deps, runId, 0);
    expect(out).toMatchObject({ done: true, tasksDeleted: 1, tasksPending: 0 });
  });

  it("a saved look survives cleanup in saved/, everything else in the run is deleted", async () => {
    const h = makeHarness();
    const src = await h.photo("face");
    const runId = await h.start({
      type: "demo",
      nodes: [youcam("a", "sod", { inputs: { src } }), youcam("b", "sod", { inputs: { src } })],
    });
    // Save at the moment both results exist, before cleanup runs.
    let saved: Awaited<ReturnType<typeof h.engine.runner.save>> | undefined;
    h.ports.events.subscribe("run-events", async (e) => {
      if ((e as { type: string }).type === "run_finished")
        saved = await h.engine.runner.save(runId, ["a"]);
    });
    await h.settle();

    expect(saved).toMatchObject({
      ok: true,
      value: {
        keys: [
          expect.stringMatching(new RegExp(`^saved/${h.userId}/lk_[a-z0-9]+/a\\.png$`)) as string,
        ],
      },
    });
    if (!saved?.ok) throw new Error("save failed");
    expect(await h.ports.blobs.list(`runs/${runId}/`)).toEqual([]); // the run's own copies are gone
    expect(await h.ports.blobs.list(`saved/${h.userId}/`)).toEqual(saved.value.keys);
    expect(((await h.run(runId)).outputs.saved as { lookId: string }[])[0]?.lookId).toBe(
      saved.value.lookId,
    );

    // Delete my profile: one look, then everything the person saved.
    expect(await deleteSaved(h.engine.deps, h.userId, saved.value.lookId)).toBe(1);
    expect(await h.ports.blobs.list("saved/")).toEqual([]);
  });

  it("refuses to save from a run that has already been cleaned up, or an unknown run", async () => {
    const h = makeHarness();
    const runId = await single(h, "sod");
    await h.settle();
    expect(await h.engine.runner.save(runId, ["a"])).toEqual({
      ok: false,
      error: { code: "images_deleted" },
    });
    expect(await h.engine.runner.save("run_nonexistent1", ["a"])).toEqual({
      ok: false,
      error: { code: "run_not_found" },
    });
  });

  it("refuses to save a step that produced no image", async () => {
    const h = makeHarness();
    h.fake.script("skin-tone-analysis", { results: SKIN_TONE, latencyMs: 1_000 });
    const runId = await single(h, "skin-tone-analysis");
    let result: Awaited<ReturnType<typeof h.engine.runner.save>> | undefined;
    h.ports.events.subscribe("run-events", async (e) => {
      if ((e as { type: string }).type === "run_finished")
        result = await h.engine.runner.save(runId, ["a"]);
    });
    await h.settle();
    expect(result).toEqual({ ok: false, error: { code: "nothing_to_save" } });
    expect(await h.ports.blobs.list("saved/")).toEqual([]);
  });
});

it("a FakeClock and mock ports are enough to run with no credentials", () => {
  const clock = new FakeClock();
  expect(createMockPorts({ clock }).clock).toBe(clock);
});

describe("restart recovery", () => {
  it("a restarted process finishes a run that was waiting on YouCam, without resubmitting", async () => {
    const h = makeHarness();
    h.fake.script("skin-tone-analysis", { results: SKIN_TONE, latencyMs: 4_000 });
    const runId = await single(h, "skin-tone-analysis");
    await h.ports.queue.tick();
    expect((await h.nodes(runId)).a?.status).toBe("waiting");

    // The process stops: its queue is gone, its state is not.
    const queue = new InProcessQueue({ clock: h.clock });
    const reborn = makeHarness({ ports: { ...h.ports, queue }, fake: h.fake, clock: h.clock });
    expect(await reborn.engine.runner.recover()).toEqual({ runs: 1, nodes: 1, cleanups: 0 });
    await reborn.settle();

    expect((await h.run(runId)).status).toBe("succeeded");
    expect(h.fake.callsTo("createTask")).toBe(1);
    expect((await h.run(runId)).cleanedAt).toBeDefined();
  });

  it("re-queues cleanup for a finished run that was never cleaned", async () => {
    const h = makeHarness();
    h.fake.script("skin-tone-analysis", { results: SKIN_TONE, latencyMs: 1_000 });
    const runId = await single(h, "skin-tone-analysis");
    await h.settle();
    // Simulate a stop between "finished" and "cleaned": the run is done but its cleanup never ran.
    await updateDoc(h.ports.state, `runs/${runId}`, Run, (r) => {
      if (!r) throw new Error("setup");
      const { cleanedAt: _gone, ...rest } = r;
      return rest;
    });
    await h.ports.blobs.put(`runs/${runId}/a/output.png`, PNG, "image/png");

    const queue = new InProcessQueue({ clock: h.clock });
    const reborn = makeHarness({ ports: { ...h.ports, queue }, fake: h.fake, clock: h.clock });
    expect(await reborn.engine.runner.recover()).toEqual({ runs: 0, nodes: 0, cleanups: 1 });
    await reborn.settle();
    expect((await h.run(runId)).cleanedAt).toBeDefined();
    expect(await h.ports.blobs.list(`runs/${runId}/`)).toEqual([]);
  });

  it("events carry the run's trace id as a message attribute", async () => {
    const h = makeHarness();
    const attrs: Record<string, string>[] = [];
    h.ports.events.subscribe("run-events", (_e, a) => {
      attrs.push({ ...a });
    });
    h.fake.script("skin-tone-analysis", { results: SKIN_TONE, latencyMs: 1_000 });
    const runId = await single(h, "skin-tone-analysis");
    await h.settle();
    const trace = (await h.run(runId)).traceId;
    expect(attrs.length).toBeGreaterThan(3);
    expect(attrs.every((a) => a.miraTrace === trace)).toBe(true);
  });
});
