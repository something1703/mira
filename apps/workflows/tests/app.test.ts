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
    ).toBe(500);
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
