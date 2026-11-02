import {
  Run,
  RunNode,
  ShadeResult,
  type AskResponse,
  type Metric,
  type MetricStore,
  type NextAction,
} from "@mira/schemas";
import { z } from "zod";
import { UNAVAILABLE_TEXT } from "./fallbacks";
import { produceAnswer } from "./loop";
import { systemPrompt } from "./prompts";
import type { ModelProvider } from "./providers/types";
import type { Workflows } from "./workflows";

/**
 * After a run finishes the model describes it (docs/AGENT_RUNTIME.md §1, last step). It is given
 * the run's readings as metric ids, never as numbers in text, and the answer goes through the same
 * renderer as any other, so a figure in the narration is always one the run produced.
 */
const RunView = z.object({ run: Run, nodes: z.array(RunNode) });

const meta = (runId: string, now: string) => ({
  source: { feature: "engine:shade-closed-loop", version: "1", taskRunId: runId },
  confidence: "n/a" as const,
  measuredAt: now,
});

/** The readings of a finished shade match, as metrics. */
export function shadeMetrics(
  result: ShadeResult,
  runId: string,
  now: string,
): { store: MetricStore; renders: string[] } {
  const store: MetricStore = {};
  const put = (m: Metric) => {
    store[m.id] = m;
  };
  const m = meta(runId, now);
  put({ ...m, id: "shade.finish", kind: "category", value: result.finish });
  put({ ...m, id: "shade.coverage", kind: "category", value: result.coverage });
  put({
    ...m,
    id: "shade.checked_free",
    kind: "number",
    value: result.checkedFree,
    unit: "shades",
  });
  const best = result.outcomes.find((o) => o.shadeId === result.bestShadeId);
  if (best?.blendDe !== undefined) {
    put({ ...m, id: "shade.best.name", kind: "category", value: best.name });
    put({ ...m, id: "shade.best.hex", kind: "category", value: best.hex });
    put({ ...m, id: "shade.best.blend_de", kind: "number", value: best.blendDe, unit: "ΔE2000" });
  }
  put({
    ...m,
    id: "shade.verified_count",
    kind: "number",
    value: result.outcomes.filter((o) => o.verdict === "verified").length,
    unit: "shades",
  });
  const renders = result.outcomes.flatMap((o) =>
    o.renderNode === undefined ? [] : [o.renderNode],
  );
  return { store, renders };
}

export async function narrateRun(
  deps: { workflows: Workflows; provider: ModelProvider; now: () => Date },
  userId: string,
  runId: string,
): Promise<AskResponse> {
  const none = (text: string, state: AskResponse["state"]): AskResponse => ({
    state,
    segments: [{ text, readings: [] }],
    nextActions: [],
    plans: [],
    needs: [],
    renders: [],
    toolCalls: [],
  });
  const r = await deps.workflows.get(`/internal/runs/${runId}`);
  if (!r.ok || r.status !== 200) return none(UNAVAILABLE_TEXT, "unavailable");
  const view = RunView.safeParse(r.body);
  // A run that is not this person's is reported as missing, not as someone else's.
  if (!view.success || view.data.run.userId !== userId)
    return none(UNAVAILABLE_TEXT, "unavailable");
  const { run, nodes } = view.data;
  if (run.status === "queued" || run.status === "running") {
    return none("The run has not finished yet. The steps show where it is.", "answer");
  }

  let store: MetricStore = {};
  let renders: string[] = [];
  let actions: NextAction[] = ["build_twin"];
  if (run.type === "match_shade") {
    const assembled = nodes.find((n) => n.id === "assemble");
    const result = ShadeResult.safeParse(assembled?.output);
    if (result.success) {
      ({ store, renders } = shadeMetrics(result.data, runId, deps.now().toISOString()));
      actions = ["compose_look"];
    }
  }
  const ids = Object.keys(store);
  const system = `${systemPrompt()}\n\n## Context\nA run has finished. Status: ${run.status}.\nMetric ids you may cite: ${ids.join(", ")}.`;
  const answer = await produceAnswer(
    deps.provider,
    system,
    [{ role: "user", text: "Describe how the run turned out, using the readings." }],
    store,
    actions,
    renders,
  );
  return {
    state: answer.unavailable ? "unavailable" : answer.fallback ? "fallback" : "answer",
    segments: answer.segments,
    nextActions: answer.nextActions,
    plans: [],
    needs: [],
    renders: answer.renders,
    toolCalls: [],
  };
}
