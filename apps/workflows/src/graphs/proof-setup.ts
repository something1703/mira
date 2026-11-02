import { CONFIG, PhantomFit, SIMULATION_KEY, err, ok, type ProofConcern } from "@mira/schemas";
import type { Ports } from "@mira/runtime";
import { z } from "zod";
import type { GraphSpec, NodeSpec } from "../runner/graph";
import { changeProof } from "../proof/store";
import type { NodeExecutor } from "../runner/runner";
import type { EngineClient } from "../twin/engine-client";
import { wholeFaceScore } from "./proof-check-in";

/**
 * The calibration phantom (docs/ENGINES.md §9): one photo, simulated at five intensities of a
 * concern, each re-measured. If Skin Analysis follows the simulation closely enough and over a
 * range bigger than the person's own variation, MIRA can show a visualisation of a measured
 * change. If not, it says so and reports numbers only. Cached per person and concern.
 */
export const PHANTOM_EXECUTOR = "proof-phantom-fit";

export const simId = (i: number) => `sim-${String(i + 1)}`;
export const readId = (i: number) => `read-${String(i + 1)}`;

export function buildPhantomGraph(input: {
  userId: string;
  proofId: string;
  concern: ProofConcern;
  photo: string;
}): GraphSpec {
  const intensities = CONFIG.proof.phantomIntensities.value;
  const nodes: NodeSpec[] = [];
  intensities.forEach((intensity, i) => {
    nodes.push(
      {
        id: simId(i),
        kind: "youcam",
        label: "step.simulate_concern",
        feature: "skin-simulation",
        params: { [SIMULATION_KEY[input.concern]]: intensity },
        inputs: { src: `blob:${input.photo}` },
      },
      {
        id: readId(i),
        kind: "youcam",
        label: "step.measure_simulation",
        feature: "skin-analysis",
        dependsOn: [simId(i)],
        params: { concerns: [`hd_${input.concern}`] },
        inputs: { src: `node:${simId(i)}` },
      },
    );
  });
  nodes.push({
    id: "fit",
    kind: "system",
    label: "step.fit_curve",
    feature: PHANTOM_EXECUTOR,
    dependsOn: nodes.filter((n) => n.id.startsWith("read-")).map((n) => n.id),
    params: { userId: input.userId, proofId: input.proofId, concern: input.concern },
  });
  return { type: "proof_setup", nodes };
}

const Params = z.object({
  userId: z.string(),
  proofId: z.string(),
  concern: z.enum(["pore", "wrinkle", "texture", "acne", "oiliness", "redness"]),
});

export function createPhantomExecutors(deps: {
  engine: EngineClient;
  ports: Pick<Ports, "state" | "clock">;
}): Record<string, NodeExecutor> {
  const fit: NodeExecutor = async (ctx) => {
    const params = Params.safeParse(ctx.node.params);
    if (!params.success) return err({ code: "bad_params", retryable: false });
    const p = params.data;
    const intensities = CONFIG.proof.phantomIntensities.value;
    const scores: number[] = [];
    for (let i = 0; i < intensities.length; i++) {
      const up = ctx.upstream[readId(i)];
      const done = up?.status === "done" || up?.status === "cached";
      const score = done ? wholeFaceScore(up.output, p.concern) : undefined;
      if (score === undefined) return err({ code: "sweep_incomplete", retryable: false });
      scores.push(score);
    }
    const proof = await changeProof(deps.ports, p.userId, p.proofId, (x) => x);
    const mdc = proof?.noiseFloor?.mdc;
    if (!proof) return err({ code: "proof_not_found", retryable: false });
    // Without a known variation there is nothing to judge the sweep's range against.
    if (mdc === null || mdc === undefined)
      return err({ code: "variation_unknown", retryable: false });
    const r = await deps.engine.phantomFit({ intensities, scores, mdc });
    if (!r.ok) return err(r.error);
    const v = r.value.value;
    const phantom = PhantomFit.parse({
      usable: v.usable,
      rho: v.rho,
      scoreRange: v.score_range,
      reason: v.reason,
      intensities: v.intensities,
      fittedDelta: v.fitted_delta,
      scores,
      mdc,
      fittedAt: new Date(deps.ports.clock.now()).toISOString(),
    });
    await changeProof(deps.ports, p.userId, p.proofId, (x) => ({ ...x, phantom }));
    return ok({ output: { usable: phantom.usable, reason: phantom.reason } });
  };
  return { [PHANTOM_EXECUTOR]: fit };
}
