import { err, ok, type ToolName } from "@mira/schemas";
import type {
  ModelMessage,
  ModelProvider,
  ModelReply,
  ModelRequest,
  ProviderError,
  ToolCall,
} from "./types";

/**
 * The mock model (docs/AGENT_RUNTIME.md §2). Two modes:
 *
 * - **Scripted**: replays the turns a test or an eval case gives it, in order, per purpose. This is
 *   how the loop, the confirmation guard and the renderer are exercised against outputs a real
 *   model could produce, including bad ones. It tests MIRA's guardrails, not a model's judgement.
 * - **Routed** (no script): a small keyword router, so the panel works end to end with no model.
 *   Its words are templates; every reading in them is a placeholder the renderer fills.
 */
export type MockTurn =
  | { step: { text?: string; tools: { name: string; input?: unknown }[] } }
  | { answer: unknown }
  | { extract: unknown }
  | { fail: ProviderError["code"] };

export type MockScript = readonly MockTurn[];

/** The id of the newest plan a tool returned, so a script can refer to a plan it cannot know. */
function lastPlanId(messages: readonly ModelMessage[]): string | undefined {
  for (const m of [...messages].reverse()) {
    if (m.role !== "tool") continue;
    const plan = (m.result as { plan?: { id?: unknown } } | null)?.plan;
    if (typeof plan?.id === "string") return plan.id;
  }
  return undefined;
}

/** Replaces the string `$plan` in a scripted input with the newest plan's id. */
function fill(input: unknown, planId: string | undefined): unknown {
  if (input === "$plan") return planId ?? "plan_missing";
  if (Array.isArray(input)) return input.map((x) => fill(x, planId));
  if (typeof input === "object" && input !== null) {
    return Object.fromEntries(Object.entries(input).map(([k, v]) => [k, fill(v, planId)]));
  }
  return input;
}

type Reply = { ok: true; value: ModelReply } | { ok: false; error: ProviderError };

export class MockProvider implements ModelProvider {
  readonly name = "mock";
  private readonly queue: MockTurn[];
  /** Every request made, so tests can assert what the model was shown. */
  readonly requests: ModelRequest[] = [];
  private seq = 0;

  constructor(private readonly script?: MockScript) {
    this.queue = [...(script ?? [])];
  }

  generate(req: ModelRequest): Promise<Reply> {
    this.requests.push(req);
    return Promise.resolve(this.script === undefined ? this.routed(req) : this.scripted(req));
  }

  private id(): string {
    this.seq += 1;
    return `call_${String(this.seq)}`;
  }

  private scripted(req: ModelRequest): Reply {
    const want = req.purpose === "step" ? "step" : req.purpose === "answer" ? "answer" : "extract";
    const at = this.queue.findIndex((t) => want in t || "fail" in t);
    const turn = at === -1 ? undefined : this.queue.splice(at, 1)[0];
    if (turn === undefined) {
      // An exhausted script: a tool loop simply stops; an answer or extraction has nothing to say.
      return want === "step"
        ? ok({ kind: "tools", text: "", calls: [] })
        : err({ code: "unavailable", detail: "mock script exhausted" });
    }
    if ("fail" in turn) return err({ code: turn.fail, detail: "scripted failure" });
    if ("step" in turn) {
      const planId = lastPlanId(req.messages);
      const calls: ToolCall[] = turn.step.tools.map((t) => ({
        id: this.id(),
        name: t.name,
        input: fill(t.input ?? {}, planId),
      }));
      return ok({ kind: "tools", text: turn.step.text ?? "", calls });
    }
    const value = "answer" in turn ? turn.answer : turn.extract;
    return typeof value === "string"
      ? ok({ kind: "text", text: value })
      : ok({ kind: "object", value });
  }

  // ---- routed mode -------------------------------------------------------------------------

  private routed(req: ModelRequest): Reply {
    if (req.purpose === "extract") return err({ code: "unavailable", detail: "no extraction" });
    if (req.purpose === "step") return ok(this.route(req.messages));
    return ok({ kind: "object", value: this.compose(req.messages) });
  }

  private route(messages: readonly ModelMessage[]): ModelReply {
    const last = messages[messages.length - 1];
    const none: ModelReply = { kind: "tools", text: "", calls: [] };
    const call = (name: ToolName, input: unknown = {}): ModelReply => ({
      kind: "tools",
      text: "",
      calls: [{ id: this.id(), name, input }],
    });
    if (last?.role === "tool") {
      // A catalogue search leads on to the plan for its first range.
      if (last.name === "search_catalog") {
        const first = (last.result as { items?: { id: string }[] }).items?.[0];
        return first ? call("plan_match_shade", { rangeId: first.id }) : none;
      }
      return none;
    }
    const text = (last?.role === "user" ? last.text : "").toLowerCase();
    const url = /https?:\/\/\S+|fixture:[a-z0-9-]+/.exec(text)?.[0];
    if (url) return call("plan_match_shade", { url });
    if (/shade|foundation|undertone match/.test(text)) {
      return call("search_catalog", { query: "foundation", category: "foundation" });
    }
    if (/look|sangeet|wedding|lehenga|saree|outfit/.test(text)) {
      return call("plan_compose_look", { slots: ["outfit"] });
    }
    if (/proof|progress|serum|moisturi[sz]er|claim/.test(text)) {
      return call("plan_start_proof", { product: "the product you name" });
    }
    if (/measure|profile|twin|skin|colou?r|tone/.test(text)) return call("get_twin_summary");
    return none;
  }

  private compose(messages: readonly ModelMessage[]): unknown {
    const results = messages.flatMap((m) =>
      m.role === "tool" ? [{ name: m.name, r: m.result }] : [],
    );
    const twin = results.find((x) => x.name === "get_twin_summary")?.r as
      { status?: string; metrics?: { id: string }[] } | undefined;
    const plans = results
      .filter((x) => x.name.startsWith("plan_"))
      .map((x) => x.r as { status?: string });
    if (plans.some((p) => p.status === "planned")) {
      return {
        segments: [
          {
            text: "Here is what I would run. Check the quote, then confirm to start.",
            metric_refs: [],
          },
        ],
        renders: [],
        next_actions: [],
      };
    }
    if (plans.some((p) => p.status === "needs")) {
      return {
        segments: [
          {
            text: "I need a photo of you first. Add one on the screen I have opened for you.",
            metric_refs: [],
          },
        ],
        renders: [],
        next_actions: ["build_twin"],
      };
    }
    if (twin?.status === "no_profile") {
      return {
        segments: [
          {
            text: "You have no measured profile yet. Start measuring to see your readings.",
            metric_refs: [],
          },
        ],
        renders: [],
        next_actions: ["build_twin"],
      };
    }
    const ids = new Set((twin?.metrics ?? []).map((m) => m.id));
    if (twin?.status === "ok" && ids.has("colour.skin")) {
      return {
        segments: [
          { text: "Your measured skin colour is {colour.skin}.", metric_refs: ["colour.skin"] },
        ],
        renders: [],
        next_actions: ["match_shade"],
      };
    }
    if (twin?.status === "ok") {
      return {
        segments: [
          { text: "Your measured profile is saved. Open it to see each reading.", metric_refs: [] },
        ],
        renders: [],
        next_actions: [],
      };
    }
    return {
      segments: [
        {
          text: "I can match a shade, build a look or check your progress. Which would you like?",
          metric_refs: [],
        },
      ],
      renders: [],
      next_actions: ["match_shade", "compose_look", "start_proof"],
    };
  }
}
