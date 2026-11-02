import {
  Answer,
  CONFIG,
  lintText,
  type AskRequest,
  type AskResponse,
  type MetricStore,
  type NextAction,
  type RenderedSegment,
} from "@mira/schemas";
import { OUT_OF_SCOPE_TEXT, UNAVAILABLE_TEXT, renderFallback } from "./fallbacks";
import { classifyScope } from "./prompts/scope";
import { systemPrompt } from "./prompts";
import type { ModelMessage, ModelProvider } from "./providers/types";
import { inject } from "./render/inject";
import { checkAnswer, parseAnswer, type Problem } from "./render/validate";
import { SPECS, runTool, type ToolEnv, type TurnState } from "./tools";

/**
 * One turn of Ask MIRA (docs/AGENT_RUNTIME.md §1): context, then a tool loop of at most six steps,
 * then an answer that must pass the renderer. Plans end the turn at the quote: a run starts only
 * from the person's confirmation, never from anything in this loop's text.
 */
export interface LoopDeps extends ToolEnv {
  provider: ModelProvider;
}

const text = (t: string): RenderedSegment[] => [{ text: t, readings: [] }];

const empty = (state: AskResponse["state"], segments: RenderedSegment[]): AskResponse => ({
  state,
  segments,
  nextActions: [],
  plans: [],
  needs: [],
  renders: [],
  toolCalls: [],
});

const describe = (problems: readonly Problem[]): string => problems.map((p) => p.detail).join(" ");

export interface Produced {
  segments: RenderedSegment[];
  nextActions: NextAction[];
  renders: string[];
  /** The model's answer was refused twice and the templated one is shown. */
  fallback: boolean;
  /** The model could not be reached for the answer. */
  unavailable: boolean;
}

/**
 * Asks the model for the answer and runs it through the renderer. One retry with the problem
 * shown to the model (CONFIG.agent.outputRetries), then the templated fallback.
 */
export async function produceAnswer(
  provider: ModelProvider,
  system: string,
  history: ModelMessage[],
  store: MetricStore,
  fallbackActions: readonly NextAction[],
  allowedRenders: readonly string[] = [],
): Promise<Produced> {
  const messages = [...history];
  for (let attempt = 0; attempt <= CONFIG.agent.outputRetries.value; attempt++) {
    const reply = await provider.generate({ purpose: "answer", system, messages, schema: Answer });
    if (!reply.ok) {
      const f = renderFallback(fallbackActions, store);
      return {
        segments: f.segments,
        nextActions: f.answer.next_actions,
        renders: [],
        fallback: true,
        unavailable: true,
      };
    }
    const raw =
      reply.value.kind === "object"
        ? reply.value.value
        : reply.value.kind === "text"
          ? reply.value.text
          : "";
    const parsed = parseAnswer(raw);
    let problems: Problem[] = [];
    if (!parsed.ok) {
      problems = [parsed.problem];
    } else {
      problems = checkAnswer(parsed.answer, store);
      if (problems.length === 0) {
        const segments = inject(parsed.answer, store);
        const linted = lintText(segments.map((s) => s.text).join("\n"));
        if (linted.length === 0) {
          return {
            segments,
            nextActions: parsed.answer.next_actions,
            // The model can only point at plates that exist.
            renders: parsed.answer.renders.filter((r) => allowedRenders.includes(r)),
            fallback: false,
            unavailable: false,
          };
        }
        problems = linted.map((v) => ({
          code: "schema" as const,
          detail: `The word "${v.match}" is not allowed.`,
        }));
      }
    }
    messages.push(
      { role: "assistant", text: typeof raw === "string" ? raw : JSON.stringify(raw) },
      { role: "user", text: `Your answer was refused: ${describe(problems)} Answer again.` },
    );
  }
  const f = renderFallback(fallbackActions, store);
  return {
    segments: f.segments,
    nextActions: f.answer.next_actions,
    renders: [],
    fallback: true,
    unavailable: false,
  };
}

/** What the model is told about the screen and the person, as data. */
export function contextBlock(state: TurnState): string {
  const ids = Object.keys(state.store);
  return [
    `Screen: ${state.context.screen}.`,
    `A photo is held for this session: ${state.context.heldPhoto === undefined ? "no" : "yes"}.`,
    state.context.activeRunId === undefined ? "" : "The person is watching a run.",
    ids.length === 0
      ? "No measured profile is loaded."
      : `Metric ids you may cite: ${ids.join(", ")}.`,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function runAsk(req: AskRequest, deps: LoopDeps): Promise<AskResponse> {
  const last = [...req.messages].reverse().find((m) => m.role === "user");
  const scope = last ? classifyScope(last.text) : undefined;
  if (scope !== undefined) return empty("out_of_scope", text(OUT_OF_SCOPE_TEXT[scope]));

  const state: TurnState = {
    userId: req.userId,
    sessionId: req.sessionId,
    context: req.context,
    store: {},
    plans: [],
    needs: [],
  };
  // The profile is loaded up front, as ids, so the model starts with what it may cite.
  await runTool("get_twin_summary", {}, deps, state);

  const history: ModelMessage[] = req.messages
    .slice(-CONFIG.agent.contextMessages.value)
    .map((m) => ({ role: m.role, text: m.text }));
  const system = `${systemPrompt()}\n\n## Context\n${contextBlock(state)}`;
  const toolCalls: string[] = [];

  for (let depth = 0; depth < CONFIG.agent.maxToolDepth.value; depth++) {
    const step = await deps.provider.generate({
      purpose: "step",
      system,
      messages: history,
      tools: [...SPECS],
    });
    if (!step.ok) {
      return state.plans.length > 0 || state.needs.length > 0
        ? await finish(deps, state, system, history, toolCalls)
        : empty("unavailable", text(UNAVAILABLE_TEXT));
    }
    if (step.value.kind !== "tools" || step.value.calls.length === 0) break;
    history.push({ role: "assistant", text: step.value.text, calls: step.value.calls });
    for (const call of step.value.calls) {
      // Only tools that exist are recorded: a call to a name the model made up ran nothing.
      if (SPECS.some((t) => t.name === call.name)) toolCalls.push(call.name);
      const out = await runTool(call.name, call.input, deps, state);
      history.push({
        role: "tool",
        callId: call.id,
        name: call.name,
        result: out.ok ? out.result : { error: out.error },
      });
    }
  }
  return await finish(deps, state, system, history, toolCalls);
}

async function finish(
  deps: LoopDeps,
  state: TurnState,
  system: string,
  history: ModelMessage[],
  toolCalls: string[],
): Promise<AskResponse> {
  const actions: NextAction[] = state.needs.some((n) => n.need === "photo")
    ? ["build_twin"]
    : Object.keys(state.store).length === 0
      ? ["build_twin"]
      : ["match_shade"];
  const answer = await produceAnswer(
    deps.provider,
    system,
    [...history, { role: "user", text: "Give the answer now, as JSON." }],
    state.store,
    actions,
  );
  if (answer.unavailable && state.plans.length === 0 && state.needs.length === 0) {
    return { ...empty("unavailable", text(UNAVAILABLE_TEXT)), toolCalls };
  }
  return {
    state:
      state.plans.length > 0
        ? "plan"
        : state.needs.length > 0
          ? "needs"
          : answer.fallback
            ? "fallback"
            : "answer",
    segments: answer.segments,
    nextActions: answer.nextActions,
    plans: state.plans,
    needs: state.needs,
    renders: answer.renders,
    toolCalls,
  };
}
