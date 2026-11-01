import { newId } from "@mira/schemas";
import { describe, expect, it } from "vitest";
import { SESSION, USER, fakeWorkflows, quote } from "../evals/harness";
import { buildApp } from "../src/app";
import { MemoryPlanStore } from "../src/plans";
import { MockProvider } from "../src/providers/mock";
import { narrateRun, shadeMetrics } from "../src/narrate";
import type { ShadeResult } from "@mira/schemas";

const ask = (text: string, heldPhoto?: string) => ({
  userId: USER,
  sessionId: SESSION,
  messages: [{ role: "user", text }],
  context: { screen: "shade", ...(heldPhoto ? { heldPhoto } : {}) },
});

describe("the agent's HTTP routes", () => {
  it("plans through /ask, then starts only after /confirm", async () => {
    const workflows = fakeWorkflows();
    const plans = new MemoryPlanStore();
    const { app } = buildApp(undefined, { workflows, plans, provider: new MockProvider() });
    const res = await app.inject({
      method: "POST",
      url: "/internal/agent/ask",
      payload: ask("match my shade", "up_abc123"),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ state: string; plans: { id: string; confirmed: boolean }[] }>();
    expect(body.state).toBe("plan");
    const planId = body.plans[0]?.id ?? "";
    expect(workflows.calls.some((c) => c.path.endsWith("/build"))).toBe(false);

    const wrong = await app.inject({
      method: "POST",
      url: `/internal/agent/plans/${planId}/confirm`,
      payload: { userId: newId("usr"), sessionId: SESSION },
    });
    expect(wrong.statusCode).toBe(404);
    expect(workflows.calls.some((c) => c.path.endsWith("/build"))).toBe(false);

    const ok = await app.inject({
      method: "POST",
      url: `/internal/agent/plans/${planId}/confirm`,
      payload: { userId: USER, sessionId: SESSION },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ status: "started" });
    expect(workflows.calls.filter((c) => c.path.endsWith("/build"))).toHaveLength(1);
    await app.close();
  });

  it("rejects a malformed request", async () => {
    const { app } = buildApp(undefined, { workflows: fakeWorkflows() });
    const res = await app.inject({ method: "POST", url: "/internal/agent/ask", payload: { x: 1 } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe("narrating a finished run", () => {
  const result: ShadeResult = {
    rangeId: "r",
    finish: "satin",
    finishReason: "x",
    coverage: "medium",
    coverageReason: "x",
    tZoneNote: false,
    outcomes: [
      {
        shadeId: "honey",
        name: "Honey 140",
        hex: "#C99870",
        preDe: 3,
        verdict: "verified",
        blendDe: 1.4,
        renderNode: "render-1",
      },
    ],
    bestShadeId: "honey",
    noClosePick: false,
    closestLabel: "close",
    concealer: false,
    concealerSuggested: false,
    checkedFree: 12,
    thresholds: { matchDe: 2, closeDe: 4, calibrated: false },
  };

  it("turns a shade result into metrics the answer can cite", () => {
    const { store, renders } = shadeMetrics(result, "run_abc123456", "2026-11-01T09:00:00.000Z");
    expect(store["shade.best.blend_de"]).toMatchObject({ value: 1.4, unit: "ΔE2000" });
    expect(store["shade.best.name"]).toMatchObject({ value: "Honey 140" });
    expect(renders).toEqual(["render-1"]);
  });

  const runView = (userId: string, status = "succeeded") => ({
    run: {
      id: "run_abc123456",
      type: "match_shade",
      userId,
      sessionId: SESSION,
      status,
      planId: newId("plan"),
      quote: quote(),
      unitsSpent: 63,
      traceId: newId("trc"),
      recorded: false,
      startedAt: "2026-11-01T09:00:00.000Z",
      outputs: {},
    },
    nodes: [
      {
        runId: "run_abc123456",
        id: "assemble",
        kind: "system",
        label: "step.rank_shades",
        feature: "shade-assemble",
        status: "done",
        dependsOn: [],
        attempts: 1,
        output: result,
      },
    ],
  });

  const workflowsFor = (view: unknown) => ({
    get: () => Promise.resolve({ ok: true as const, status: 200, body: view }),
    post: () => Promise.resolve({ ok: false as const }),
  });

  it("describes the run with the run's own numbers", async () => {
    const provider = new MockProvider([
      {
        answer: {
          segments: [
            {
              text: "{shade.best.name} blended within {shade.best.blend_de} of your skin.",
              metric_refs: ["shade.best.name", "shade.best.blend_de"],
            },
          ],
          renders: ["render-1", "render-9"],
          next_actions: ["compose_look"],
        },
      },
    ]);
    const res = await narrateRun(
      { workflows: workflowsFor(runView(USER)), provider, now: () => new Date() },
      USER,
      "run_abc123456",
    );
    expect(res.state).toBe("answer");
    expect(res.segments[0]?.text).toBe("Honey 140 blended within 1.4 ΔE2000 of your skin.");
    expect(res.renders).toEqual(["render-1"]);
  });

  it("will not narrate another person's run", async () => {
    const res = await narrateRun(
      {
        workflows: workflowsFor(runView(newId("usr"))),
        provider: new MockProvider([]),
        now: () => new Date(),
      },
      USER,
      "run_abc123456",
    );
    expect(res.state).toBe("unavailable");
  });

  it("says a run is still going rather than narrating half of it", async () => {
    const res = await narrateRun(
      {
        workflows: workflowsFor(runView(USER, "running")),
        provider: new MockProvider([]),
        now: () => new Date(),
      },
      USER,
      "run_abc123456",
    );
    expect(res.segments[0]?.text).toContain("not finished");
  });
});
