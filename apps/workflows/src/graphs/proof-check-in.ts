import {
  CONFIG,
  SIMULATION_KEY,
  Verdict,
  err,
  ok,
  proofMetricId,
  type ProofConcern,
  type ProofRecord,
  type ProofSession,
} from "@mira/schemas";
import { SkinAnalysisResult } from "@mira/youcam-client";
import type { Ports } from "@mira/runtime";
import { z } from "zod";
import type { GraphSpec, NodeSpec } from "../runner/graph";
import { baselineComplete, judge, learnNoiseFloor } from "../proof/logic";
import { changeProof } from "../proof/store";
import type { NodeExecutor } from "../runner/runner";
import type { EngineClient } from "../twin/engine-client";

/**
 * A session of captures for one concern (docs/ARCHITECTURE.md §4.4): three photos, three analyses
 * of just that concern, their mean, and, for a check-in, the verdict. The baseline is the same
 * graph, three times on different days, so the person's own day-to-day variation is learned from
 * the same measurement that will later be judged.
 */
export const PROOF_EXECUTORS = { record: "proof-record" } as const;

export interface SessionInput {
  userId: string;
  proofId: string;
  concern: ProofConcern;
  kind: "baseline" | "check_in";
  /** Blob keys of the photos, one capture each. */
  photos: readonly string[];
  /** The person said something else in their routine changed at this check-in. */
  confound: boolean;
}

export const analyseId = (i: number) => `analyse-${String(i + 1)}`;

export function buildSessionGraph(input: SessionInput): GraphSpec {
  const nodes: NodeSpec[] = input.photos.map((photo, i) => ({
    id: analyseId(i),
    kind: "youcam" as const,
    label: "step.measure_skin_capture",
    feature: "skin-analysis",
    // One concern, so the analysis stays in the smallest price tier.
    params: { concerns: [`hd_${input.concern}`] },
    inputs: { src: `blob:${photo}` },
  }));
  nodes.push({
    id: "record",
    kind: "system",
    label: input.kind === "baseline" ? "step.learn_variation" : "step.compare_with_baseline",
    feature: PROOF_EXECUTORS.record,
    dependsOn: nodes.map((n) => n.id),
    params: {
      userId: input.userId,
      proofId: input.proofId,
      concern: input.concern,
      kind: input.kind,
      captures: input.photos.length,
      confound: input.confound,
    },
  });
  return { type: input.kind === "baseline" ? "proof_setup" : "proof_check_in", nodes };
}

/**
 * A Skin Simulation picture, for a visualisation (docs/UX_FLOWS.md §8). It is always labelled as a
 * visualisation, never as a prediction: Skin Simulation can only make a concern more visible, so a
 * change for the better is shown as the earlier, more visible state of today's photo.
 */
export function buildVisualGraph(input: {
  photo: string;
  concern: ProofConcern;
  intensity: number;
}): GraphSpec {
  return {
    type: "proof_check_in",
    nodes: [
      {
        id: "visual",
        kind: "youcam",
        label: "step.visualise_change",
        feature: "skin-simulation",
        params: { [SIMULATION_KEY[input.concern]]: input.intensity },
        inputs: { src: `blob:${input.photo}` },
      },
    ],
  };
}

const Params = z.object({
  userId: z.string(),
  proofId: z.string(),
  concern: z.enum(["pore", "wrinkle", "texture", "acne", "oiliness", "redness"]),
  kind: z.enum(["baseline", "check_in"]),
  captures: z.number().int().min(2).max(5),
  confound: z.boolean(),
});

/** The whole-face `raw_score` of a concern from one analysis, if the analysis has it. */
export function wholeFaceScore(output: unknown, concern: ProofConcern): number | undefined {
  const parsed = SkinAnalysisResult.safeParse(output);
  if (!parsed.success) return undefined;
  const id = proofMetricId(concern);
  const item = parsed.data.output.find(
    (x) =>
      x.type === `hd_${concern}` &&
      (x.region === undefined || x.region === "whole") &&
      Number.isFinite(x.raw_score),
  );
  return item && id ? item.raw_score : undefined;
}

export function createProofExecutors(deps: {
  engine: EngineClient;
  ports: Pick<Ports, "state" | "clock">;
}): Record<string, NodeExecutor> {
  const record: NodeExecutor = async (ctx) => {
    const params = Params.safeParse(ctx.node.params);
    if (!params.success) return err({ code: "bad_params", retryable: false });
    const p = params.data;
    const scores: number[] = [];
    for (let i = 0; i < p.captures; i++) {
      const up = ctx.upstream[analyseId(i)];
      const done = up?.status === "done" || up?.status === "cached";
      const score = done ? wholeFaceScore(up.output, p.concern) : undefined;
      if (score !== undefined) scores.push(score);
    }
    // A session needs every capture: a mean of fewer would hide that a photo was lost.
    if (scores.length !== p.captures) return err({ code: "session_incomplete", retryable: false });

    const now = new Date(deps.ports.clock.now()).toISOString();
    const mean = scores.reduce((n, s) => n + s, 0) / scores.length;
    const session: ProofSession = {
      at: now,
      scores,
      mean,
      runId: ctx.run.id,
      kind: p.kind,
    };

    // Everything that can fail on the engines is asked before anything is written.
    const current = await changeProof(deps.ports, p.userId, p.proofId, (x) => x);
    if (!current) return err({ code: "proof_not_found", retryable: false });
    if (current.sessions.some((s) => s.runId === ctx.run.id)) {
      // This run already recorded its session (a redelivered task): nothing more to do.
      return ok({ output: { recorded: true, duplicate: true } });
    }
    const draft: ProofRecord = { ...current, sessions: [...current.sessions, session] };
    const floor = await learnNoiseFloor(deps.engine, draft);
    if (!floor.ok) return err(floor.error);

    let verdict: Verdict | undefined;
    if (p.kind === "check_in") {
      const judged = await judge(deps.engine, draft, session, floor.value);
      if (!judged.ok) return err(judged.error);
      verdict = Verdict.parse(judged.value);
    }

    const saved = await changeProof(deps.ports, p.userId, p.proofId, (x) => {
      if (x.sessions.some((s) => s.runId === ctx.run.id)) return x;
      const sessions = [...x.sessions, session];
      const withSessions = { ...x, sessions };
      const status =
        x.status === "baseline" && baselineComplete(withSessions)
          ? ("ready" as const)
          : verdict?.state === "window_ended_no_change"
            ? ("ended" as const)
            : x.status;
      return {
        ...withSessions,
        status,
        noiseFloor: floor.value,
        ...(verdict ? { verdicts: [...x.verdicts, verdict] } : {}),
        confound: p.confound ? { flagged: true, at: now } : x.confound,
      };
    });
    return ok({
      output: {
        recorded: true,
        sessions: saved?.sessions.length ?? 0,
        ...(verdict ? { verdict } : {}),
        baselineComplete: saved ? baselineComplete(saved) : false,
      },
    });
  };
  return { [PROOF_EXECUTORS.record]: record };
}

export const minGapMs = () => CONFIG.proof.minSessionGapHours.value * 3_600_000;
