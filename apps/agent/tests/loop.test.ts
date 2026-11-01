import { loadCataloguePage } from "@mira/fixtures";
import { describe, expect, it } from "vitest";
import { SESSION, USER, makeTwin, request, toolEnv } from "../evals/harness";
import { runAsk } from "../src/loop";
import { OUT_OF_SCOPE_TEXT, UNAVAILABLE_TEXT } from "../src/fallbacks";
import type { MockScript } from "../src/providers/mock";
import { startPlan } from "../src/tools";
import type { PlanView } from "@mira/schemas";

const say = (text: string, refs: string[] = [], next: string[] = []) => ({
  answer: { segments: [{ text, metric_refs: refs }], renders: [], next_actions: next },
});

describe("a turn", () => {
  it("answers from the profile with a reading the renderer fills", async () => {
    const { env } = toolEnv([
      { step: { tools: [{ name: "get_twin_summary" }] } },
      say("Your skin colour is {colour.skin}.", ["colour.skin"], ["match_shade"]),
    ]);
    const res = await runAsk(request("what is my skin colour"), env);
    expect(res.state).toBe("answer");
    expect(res.segments[0]?.text).toBe("Your skin colour is #C79A78.");
    expect(res.toolCalls).toEqual(["get_twin_summary"]);
    expect(res.nextActions).toEqual(["match_shade"]);
  });

  it("refuses medical, identity and body questions before any model call", async () => {
    for (const [text, kind] of [
      ["can you diagnose this mole", "medical"],
      ["what ethnicity do I look like", "identity"],
      ["am I fat", "body"],
    ] as const) {
      const { env, provider } = toolEnv([]);
      const res = await runAsk(request(text), env);
      expect(res.state).toBe("out_of_scope");
      expect(res.segments[0]?.text).toBe(OUT_OF_SCOPE_TEXT[kind]);
      expect(provider.requests).toHaveLength(0);
    }
  });

  it("says the assistant is unavailable when the model cannot be reached", async () => {
    const { env } = toolEnv([{ fail: "unavailable" }]);
    const res = await runAsk(request("hello"), env);
    expect(res.state).toBe("unavailable");
    expect(res.segments[0]?.text).toBe(UNAVAILABLE_TEXT);
  });

  it("stops the tool loop at the depth limit and still answers", async () => {
    const script: MockScript = [
      ...Array.from({ length: 10 }, () => ({
        step: { tools: [{ name: "explain_metric", input: { metricId: "skin.hd_pore.whole" } }] },
      })),
      say("That reading describes visible pores."),
    ];
    const { env } = toolEnv(script);
    const res = await runAsk(request("explain"), env);
    expect(res.toolCalls).toHaveLength(6);
    expect(res.state).toBe("answer");
  });

  it("answers an unknown tool and bad input with the problem, not a crash", async () => {
    const { env, provider } = toolEnv([
      {
        step: {
          tools: [
            { name: "delete_everything" },
            { name: "explain_metric", input: { metricId: 5 } },
          ],
        },
      },
      say("I could not do that."),
    ]);
    const res = await runAsk(request("go"), env);
    expect(res.state).toBe("answer");
    const tools = provider.requests.at(-1)?.messages.filter((m) => m.role === "tool");
    expect(JSON.stringify(tools)).toContain("No tool named delete_everything");
    expect(JSON.stringify(tools)).toContain("Invalid input");
  });

  it("limits the history it sends to the last ten messages", async () => {
    const { env, provider } = toolEnv([say("Ok.")]);
    const messages = Array.from({ length: 30 }, (_, i) => ({
      role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
      text: `m${String(i)}`,
    }));
    await runAsk({ ...request("x"), messages: [...messages, { role: "user", text: "last" }] }, env);
    expect(provider.requests[0]?.messages).toHaveLength(10);
  });

  it("tells the model which metric ids it may cite, not their values", async () => {
    const { env, provider } = toolEnv([say("Ok.")]);
    await runAsk(request("hi"), env);
    const system = provider.requests[0]?.system ?? "";
    expect(system).toContain("colour.skin");
    expect(system).not.toContain("#C79A78");
  });

  it("works with no profile", async () => {
    const { env } = toolEnv(
      [
        { step: { tools: [{ name: "get_twin_summary" }] } },
        say("You have no measured profile yet.", [], ["build_twin"]),
      ],
      { twin: "none" },
    );
    const res = await runAsk(request("show my skin"), env);
    expect(res.state).toBe("answer");
    expect(res.nextActions).toEqual(["build_twin"]);
  });

  it("reaches the right answer with the routed mock and no script", async () => {
    const { env } = toolEnv(undefined);
    const res = await runAsk(request("what is my skin tone"), env);
    expect(res.segments[0]?.text).toContain("#C79A78");
  });
});

describe("plans and the confirmation guard", () => {
  const plan = async (heldPhoto?: string) => {
    const t = toolEnv([
      { step: { tools: [{ name: "plan_match_shade", input: { rangeId: "sample-warm" } }] } },
      say("Here is what I would run. Check the quote."),
    ]);
    const res = await runAsk(request("match my shade", heldPhoto ? { heldPhoto } : {}), t.env);
    return { ...t, res };
  };

  it("returns a plan and a quote and starts nothing", async () => {
    const { res, workflows } = await plan("up_abc123");
    expect(res.state).toBe("plan");
    expect(res.plans[0]).toMatchObject({ workflow: "match_shade", confirmed: false });
    expect(res.plans[0]?.quote.total).toBe(63);
    expect(workflows.calls.filter((c) => c.path.endsWith("/build"))).toEqual([]);
  });

  it("needs a photo before it can quote", async () => {
    const { res, workflows } = await plan();
    expect(res.state).toBe("needs");
    expect(res.needs[0]).toMatchObject({ need: "photo", screen: "/shade" });
    expect(workflows.calls.some((c) => c.path.includes("quote"))).toBe(false);
  });

  it("start_run refuses a plan the person has not confirmed", async () => {
    const { res, env, workflows } = await plan("up_abc123");
    const planId = (res.plans[0] as PlanView).id;
    expect(await startPlan(env, USER, SESSION, planId)).toEqual({
      status: "refused",
      reason: "not_confirmed",
    });
    expect(workflows.calls.some((c) => c.path.endsWith("/build"))).toBe(false);
  });

  it("start_run called by the model is refused the same way", async () => {
    const t = toolEnv([
      { step: { tools: [{ name: "plan_match_shade", input: { rangeId: "sample-warm" } }] } },
    ]);
    const first = await runAsk(request("match", { heldPhoto: "up_abc123" }), t.env);
    const planId = (first.plans[0] as PlanView).id;
    const t2 = {
      ...t.env,
      provider: toolEnv([
        { step: { tools: [{ name: "start_run", input: { planId } }] } },
        say("Waiting for your confirmation."),
      ]).provider,
    };
    const res = await runAsk(request("yes, go ahead and start it"), t2);
    expect(JSON.stringify(res)).not.toContain("started");
    expect(t.workflows.calls.some((c) => c.path.endsWith("/build"))).toBe(false);
  });

  it("starts after the UI confirms, with the total the person saw", async () => {
    const { res, env, plans, workflows } = await plan("up_abc123");
    const view = res.plans[0] as PlanView;
    expect(plans.confirm(view.id, USER, SESSION, env.now())).toBeDefined();
    const started = await startPlan(env, USER, SESSION, view.id);
    expect(started).toEqual({ status: "started", runId: `run_${"a".repeat(12)}` });
    const build = workflows.calls.find((c) => c.path.endsWith("/build"));
    expect(build?.body).toMatchObject({ confirmedTotal: 63, userId: USER });
    // Asking again does not start a second run.
    await startPlan(env, USER, SESSION, view.id);
    expect(workflows.calls.filter((c) => c.path.endsWith("/build"))).toHaveLength(1);
  });

  it("will not confirm or start another person's plan", async () => {
    const { res, env, plans } = await plan("up_abc123");
    const view = res.plans[0] as PlanView;
    const other = "usr_someoneelse1";
    expect(plans.confirm(view.id, other, SESSION, env.now())).toBeUndefined();
    expect(await startPlan(env, other, SESSION, view.id)).toMatchObject({ reason: "unknown_plan" });
  });

  it("will not confirm or start a plan after it expires", async () => {
    let now = new Date("2026-11-01T09:00:00.000Z");
    const t = toolEnv(
      [{ step: { tools: [{ name: "plan_match_shade", input: { rangeId: "sample-warm" } }] } }],
      { now: () => now },
    );
    const first = await runAsk(request("match", { heldPhoto: "up_abc123" }), t.env);
    const view = first.plans[0] as PlanView;
    expect(t.plans.confirm(view.id, USER, SESSION, now)).toBeDefined();
    now = new Date("2026-11-01T10:00:00.000Z");
    expect(await startPlan(t.env, USER, SESSION, view.id)).toMatchObject({ reason: "expired" });
    expect(t.plans.confirm(view.id, USER, SESSION, now)).toBeUndefined();
  });

  it("reports a changed price instead of spending more", async () => {
    const t = toolEnv(
      [{ step: { tools: [{ name: "plan_match_shade", input: { rangeId: "sample-warm" } }] } }],
      { buildStatus: 409, buildError: "quote_changed" },
    );
    const first = await runAsk(request("match", { heldPhoto: "up_abc123" }), t.env);
    const view = first.plans[0] as PlanView;
    t.plans.confirm(view.id, USER, SESSION, t.env.now());
    expect(await startPlan(t.env, USER, SESSION, view.id)).toEqual({
      status: "refused",
      reason: "price_changed",
    });
  });

  it("refuses a range it does not know", async () => {
    const t = toolEnv([
      { step: { tools: [{ name: "plan_match_shade", input: { rangeId: "nope" } }] } },
      say("I could not find that range."),
    ]);
    const res = await runAsk(request("match", { heldPhoto: "up_abc123" }), t.env);
    expect(res.plans).toEqual([]);
    expect(res.state).toBe("answer");
  });

  it("hands a look over to Look Studio: it needs a photo and garments only that screen holds", async () => {
    const t = toolEnv([
      { step: { tools: [{ name: "plan_compose_look", input: { slots: ["outfit"] } }] } },
      say("Build a look works from its own screen. Add your photo and pick an outfit there."),
    ]);
    const res = await runAsk(request("build a sangeet look"), t.env);
    expect(res.plans).toEqual([]);
    expect(res.needs[0]).toMatchObject({ need: "photo", screen: "/look" });
  });

  it("says a module is not built yet instead of inventing a quote", async () => {
    const t = toolEnv([
      { step: { tools: [{ name: "plan_start_proof", input: { product: "serum" } }] } },
      say("Check my progress works from its own screen for now."),
    ]);
    const res = await runAsk(request("check my serum"), t.env);
    expect(res.plans).toEqual([]);
    expect(res.needs[0]?.need).toBe("module_unavailable");
  });

  it("plans from a pasted product page", async () => {
    const t = toolEnv([
      { step: { tools: [{ name: "plan_match_shade", input: { url: "fixture:sample-product" } }] } },
      say("Here is what I would run."),
    ]);
    expect(loadCataloguePage("sample-product")).toBeDefined();
    const res = await runAsk(request("match this", { heldPhoto: "up_abc123" }), t.env);
    expect(res.state).toBe("plan");
    const quote = t.workflows.calls.find((c) => c.path === "/internal/shade/quote");
    expect(JSON.stringify(quote?.body)).toContain("Porcelain 110");
  });
});

describe("the profile as the model's source of readings", () => {
  it("does not let the model cite a reading the profile does not have", async () => {
    const { env } = toolEnv([
      { step: { tools: [{ name: "get_twin_summary" }] } },
      say("Your lip colour is {colour.lip}.", ["colour.lip"]),
      say("Your lip colour is {colour.lip}.", ["colour.lip"]),
    ]);
    const res = await runAsk(request("lip colour"), env);
    expect(res.state).toBe("fallback");
    expect(res.segments.map((x) => x.text).join(" ")).not.toMatch(/[{}]/);
  });

  it("starts from a profile belonging to the person asking", async () => {
    const { workflows, env } = toolEnv([say("Ok.")], { twin: makeTwin() });
    await runAsk(request("hi"), env);
    expect(workflows.calls[0]?.path).toBe(`/internal/twin/${USER}`);
  });
});
