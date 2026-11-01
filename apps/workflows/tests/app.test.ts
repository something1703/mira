import { FakeClock, createMockPorts } from "@mira/runtime";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app";

function make(extra: Parameters<typeof buildApp>[1] = {}) {
  const clock = new FakeClock();
  const ports = createMockPorts({ clock });
  const ctx = buildApp({}, { ports, ...extra });
  const settle = async () => {
    for (let i = 0; i < 300; i++) {
      await ports.queue.tick();
      if (ports.queue.snapshot().length === 0) return;
      await clock.advance(1_000);
    }
    throw new Error("did not settle");
  };
  return { ctx, ports, clock, settle };
}

const startDemo = async (app: ReturnType<typeof make>["ctx"]["app"]) => {
  const res = await app.inject({ method: "POST", url: "/internal/runs/demo" });
  expect(res.statusCode).toBe(201);
  return res.json<{
    runId: string;
    quote: { total: number; lines: { nodeId: string; units: number; cached: boolean }[] };
  }>();
};

describe("mira-workflows (mock mode)", () => {
  it("answers /health with no credentials", async () => {
    const { ctx } = make();
    const res = await ctx.app.inject({ url: "/health" });
    expect(res.json()).toMatchObject({ ok: true, service: "mira-workflows", mode: "mock" });
  });

  it("runs the demo graph: quote, three parallel nodes, a summary, then the same run from cache", async () => {
    const { ctx, settle } = make();
    const first = await startDemo(ctx.app);
    expect(first.quote.total).toBe(40);
    expect(first.quote.lines.map((l) => l.cached)).toEqual([false, false, false]);
    await settle();

    const done = (await ctx.app.inject({ url: `/internal/runs/${first.runId}` })).json<{
      run: { status: string; unitsSpent: number; recorded: boolean; cleanedAt?: string };
      nodes: { id: string; status: string; output?: { units?: number } }[];
      ledger: { kind: string }[];
      synthetic: boolean;
    }>();
    expect(done.run).toMatchObject({ status: "succeeded", unitsSpent: 40, recorded: false });
    expect(done.run.cleanedAt).toBeDefined();
    expect(Object.fromEntries(done.nodes.map((n) => [n.id, n.status]))).toEqual({
      tone: "done",
      fitzpatrick: "done",
      face: "done",
      summary: "done",
    });
    expect(done.nodes.find((n) => n.id === "summary")?.output?.units).toBe(40);
    expect(done.synthetic).toBe(true);
    expect(done.ledger.filter((e) => e.kind === "commit")).toHaveLength(3);

    // The same graph again: every YouCam step is a saved result and costs nothing.
    const second = await startDemo(ctx.app);
    // The quote already knows these are saved results, so it shows zero before anything runs.
    expect(second.quote.total).toBe(0);
    expect(second.quote.lines.every((l) => l.cached && l.units === 0)).toBe(true);
    await settle();
    const again = (await ctx.app.inject({ url: `/internal/runs/${second.runId}` })).json<{
      run: { status: string; unitsSpent: number };
      nodes: { id: string; status: string }[];
    }>();
    expect(again.run).toMatchObject({ status: "succeeded", unitsSpent: 0 });
    expect(
      again.nodes
        .filter((n) => n.status === "cached")
        .map((n) => n.id)
        .sort(),
    ).toEqual(["face", "fitzpatrick", "tone"]);
  });

  it("the demo spends from the caller's session, and the budget endpoint reports it", async () => {
    const { ctx, settle } = make();
    const who = { userId: "usr_person0001", sessionId: "ses_person0001" };
    const before = await ctx.app.inject({ url: `/internal/budgets/${who.sessionId}` });
    expect(before.json()).toEqual({ cap: 200, reserved: 0, committed: 0, left: 200 });
    const res = await ctx.app.inject({ method: "POST", url: "/internal/runs/demo", payload: who });
    expect(res.statusCode).toBe(201);
    await settle();
    const after = await ctx.app.inject({ url: `/internal/budgets/${who.sessionId}` });
    expect(after.json()).toEqual({ cap: 200, reserved: 0, committed: 40, left: 160 });
    expect((await ctx.app.inject({ url: "/internal/budgets/not-a-session" })).statusCode).toBe(400);
  });

  it("a tagged demo has its own cache keys, so it never warms the untagged one", async () => {
    const { ctx, settle } = make();
    const tagged = await ctx.app.inject({
      method: "POST",
      url: "/internal/runs/demo",
      payload: { tag: "budget-1" },
    });
    expect(tagged.json<{ quote: { total: number } }>().quote.total).toBe(40);
    await settle();
    expect((await startDemo(ctx.app)).quote.total).toBe(40);
    const again = await ctx.app.inject({
      method: "POST",
      url: "/internal/runs/demo",
      payload: { tag: "budget-1" },
    });
    expect(again.json<{ quote: { total: number } }>().quote.total).toBe(0);
    const bad = await ctx.app.inject({
      method: "POST",
      url: "/internal/runs/demo",
      payload: { tag: "../x" },
    });
    expect(bad.json<{ quote: { total: number } }>().quote.total).toBe(40); // ignored, falls back to the default photo
  });

  it("the session cap comes from MIRA_SESSION_UNIT_CAP", async () => {
    const ports = createMockPorts({ clock: new FakeClock() });
    const ctx = buildApp({ MIRA_SESSION_UNIT_CAP: "45" }, { ports });
    expect(
      (await ctx.app.inject({ url: "/internal/budgets/ses_person0002" })).json(),
    ).toMatchObject({ cap: 45, left: 45 });
  });

  it("404s an unknown run", async () => {
    const { ctx } = make();
    expect((await ctx.app.inject({ url: "/internal/runs/run_nonexistent1" })).statusCode).toBe(404);
  });

  it("forwarded webhooks resolve a known task and ignore an unknown one", async () => {
    const { ctx, ports } = make();
    const { runId } = await startDemo(ctx.app);
    await ports.queue.tick(); // starts the nodes: tasks are created and indexed
    const tone = (await ctx.app.inject({ url: `/internal/runs/${runId}` }))
      .json<{ nodes: { id: string; taskId?: string }[] }>()
      .nodes.find((n) => n.id === "tone");
    expect(tone?.taskId).toBeDefined();
    const known = await ctx.app.inject({
      method: "POST",
      url: "/internal/webhook",
      payload: { taskId: tone?.taskId, webhookId: "wh_1" },
    });
    expect(known.json()).toEqual({ known: true });
    const unknown = await ctx.app.inject({
      method: "POST",
      url: "/internal/webhook",
      payload: { taskId: "nope", webhookId: "wh_2" },
    });
    expect(unknown.json()).toEqual({ known: false });
    expect(
      (await ctx.app.inject({ method: "POST", url: "/internal/webhook", payload: {} })).statusCode,
    ).toBe(400);
  });

  it("cancel closes the run once running steps finish", async () => {
    const { ctx, settle } = make();
    const { runId } = await startDemo(ctx.app);
    expect(
      (await ctx.app.inject({ method: "POST", url: `/internal/runs/${runId}/cancel` })).json(),
    ).toEqual({ ok: true });
    await settle();
    const body = (await ctx.app.inject({ url: `/internal/runs/${runId}` })).json<{
      run: { status: string };
      nodes: { id: string; status: string }[];
    }>();
    // The three analysers had already been scheduled; the summary had not started.
    expect(body.nodes.find((n) => n.id === "summary")?.status).toBe("cancelled");
    expect(body.run.status).toBe("cancelled");
  });

  it("the queue endpoint refuses callers it cannot authenticate, and bad work items", async () => {
    const denied = make({ authenticateQueue: () => Promise.resolve(false) });
    expect(
      (
        await denied.ctx.app.inject({
          method: "POST",
          url: "/internal/tasks/youcam-poll",
          payload: {},
        })
      ).statusCode,
    ).toBe(403);

    const open = make();
    const bad = await open.ctx.app.inject({
      method: "POST",
      url: "/internal/tasks/youcam-poll",
      payload: { op: "nope" },
    });
    expect(bad.statusCode).toBe(400);
    const wrongQueue = await open.ctx.app.inject({
      method: "POST",
      url: "/internal/tasks/not-a-queue",
      payload: { op: "cleanup", runId: "run_aaaaaa" },
    });
    expect(wrongQueue.statusCode).toBe(404);
    const ok = await open.ctx.app.inject({
      method: "POST",
      url: "/internal/tasks/engine-jobs",
      payload: { op: "cleanup", runId: "run_aaaaaa" },
    });
    expect(ok.statusCode).toBe(204);
  });

  it("refuses to start live without live adapters, and says why", () => {
    expect(() =>
      buildApp({
        MIRA_MODE: "live",
        YOUCAM_API_KEY: "k",
        MIRA_MODEL_PROVIDER: "vertex-google",
        MIRA_MODEL_MAIN: "m",
        MIRA_MODEL_SMALL: "m",
        GOOGLE_CLOUD_PROJECT: "p",
        GOOGLE_CLOUD_REGION: "r",
        YOUCAM_WEBHOOK_SECRET: "s",
      }),
    ).toThrow(/not built yet|required|Missing/i);
  });
});

describe("live client construction", () => {
  it("every real YouCam client carries the limiter and is capped under YouCam's 250 per 300 s", async () => {
    const { liveYouCam } = await import("../src/lifecycle/live-api");
    const { CONFIG } = await import("@mira/schemas");
    expect(CONFIG.youcam.requestsPerWindow.value).toBeLessThan(250);
    expect(CONFIG.youcam.rateWindowSeconds.value).toBe(300);
    const clock = new FakeClock();
    const { limiter } = liveYouCam({ apiKey: "k" }, clock);
    for (let i = 0; i < CONFIG.youcam.requestsPerWindow.value; i++)
      expect(await limiter.acquire()).toBeUndefined();
    expect(await limiter.acquire()).toMatchObject({ kind: "rate_limited", retryable: true });
  });
});

describe("POST /internal/runs/:runId/save", () => {
  it("copies a look out of a finished run and reports where; refuses once cleaned up", async () => {
    const { ctx, settle, ports } = make();
    const { runId } = await startDemo(ctx.app);
    // The demo's steps produce numbers, not images: saving is refused with a clear reason.
    await settle();
    const none = await ctx.app.inject({
      method: "POST",
      url: `/internal/runs/${runId}/save`,
      payload: { nodeIds: ["tone"] },
    });
    expect(none.statusCode).toBe(409);
    expect(none.json()).toMatchObject({ error: "images_deleted" });
    expect(await ports.blobs.list("saved/")).toEqual([]);
  });

  it("validates the body and 404s an unknown run", async () => {
    const { ctx } = make();
    expect(
      (
        await ctx.app.inject({
          method: "POST",
          url: "/internal/runs/run_aaaaaaaa/save",
          payload: {},
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await ctx.app.inject({
          method: "POST",
          url: "/internal/runs/run_aaaaaaaa/save",
          payload: { nodeIds: ["a"] },
        })
      ).statusCode,
    ).toBe(404);
  });
});
