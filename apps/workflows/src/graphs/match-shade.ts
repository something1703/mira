import {
  CONFIG,
  ShadeResult,
  err,
  ok,
  type Coverage,
  type Finish,
  type PrerankedShade,
  type RunNode,
  type ShadeOutcome,
} from "@mira/schemas";
import { z } from "zod";
import type { GraphSpec, NodeSpec } from "../runner/graph";
import type { NodeExecutor } from "../runner/runner";
import type { EngineClient, LabTuple } from "../twin/engine-client";
import { toneHexes } from "../twin/extract";

/**
 * Match Shade (docs/UX_FLOWS.md §5, docs/ENGINES.md §4): render the closest shades unretouched,
 * re-measure each render, and rank by how closely the render's skin colour sits to the person's.
 * Per shade: `render-i` (makeup-vto foundation), `measure-i` (skin-tone-analysis of that render),
 * `check-i` (the engine's closed-loop check). One tolerant `assemble` step then ranks whatever
 * finished, so a failed render costs one row, not the result.
 */
export const SHADE_EXECUTORS = { check: "shade-check", assemble: "shade-assemble" } as const;

export interface MatchShadeInput {
  rangeId: string;
  /** Blob key of the face photo the renders are made from. */
  photo: string;
  skinLab: LabTuple;
  /** The shades to render, closest first. */
  shades: readonly PrerankedShade[];
  finish: Finish;
  finishReason: string;
  coverage: Coverage;
  coverageReason: string;
  tZoneNote: boolean;
  checkedFree: number;
  /** The pre-rank label of the closest shade of the whole range. */
  closestLabel: PrerankedShade["label"];
  /** The engine suggested a concealer pass for this person. */
  concealerSuggested: boolean;
  /** This run adds a concealer to the foundation: a second pass, on a new photo. */
  concealer: boolean;
}

export const renderId = (i: number) => `render-${String(i + 1)}`;
export const measureId = (i: number) => `measure-${String(i + 1)}`;
export const checkId = (i: number) => `check-${String(i + 1)}`;

/** The steps that go when a shade is left out of the quote: its render and what reads it. */
export const stepsOfShade = (i: number): string[] => [renderId(i), measureId(i), checkId(i)];

export function buildMatchShadeGraph(input: MatchShadeInput): GraphSpec {
  const nodes: NodeSpec[] = [];
  input.shades.forEach((shade, i) => {
    // The closest shade is always rendered; the others can be dropped in the QuoteSheet.
    const optional = i > 0;
    nodes.push(
      {
        id: renderId(i),
        kind: "youcam",
        label: "step.render_shade",
        feature: "makeup-vto",
        // `skin_smooth` is sent at 0 by the request builder: the shade is shown on unretouched skin.
        params: {
          effects: [
            {
              category: "foundation",
              palettes: [
                {
                  color: shade.hex,
                  colorIntensity: CONFIG.shade.colourIntensity.value,
                  glowIntensity: CONFIG.shade.glowByFinish.value[input.finish],
                  coverageIntensity: CONFIG.shade.coverageByLevel.value[input.coverage],
                },
              ],
            },
            ...(input.concealer
              ? [
                  {
                    category: "concealer",
                    palettes: [
                      {
                        color: shade.hex,
                        colorIntensity: CONFIG.shade.concealerColourIntensity.value,
                        colorUnderEyeIntensity: CONFIG.shade.concealerUnderEyeIntensity.value,
                        coverageLevel: CONFIG.shade.concealerCoverageLevel.value,
                      },
                    ],
                  },
                ]
              : []),
          ],
        },
        inputs: { src: `blob:${input.photo}` },
        optional,
      },
      {
        id: measureId(i),
        kind: "youcam",
        label: "step.measure_render",
        feature: "skin-tone-analysis",
        dependsOn: [renderId(i)],
        inputs: { src: `node:${renderId(i)}` },
        optional,
      },
      {
        id: checkId(i),
        kind: "engine",
        label: "step.check_render",
        feature: SHADE_EXECUTORS.check,
        dependsOn: [measureId(i)],
        params: { skin: input.skinLab, shade: shade.lab },
        optional,
      },
    );
  });
  nodes.push({
    id: "assemble",
    kind: "system",
    label: "step.rank_shades",
    feature: SHADE_EXECUTORS.assemble,
    dependsOn: nodes.map((n) => n.id),
    tolerant: true,
    params: {
      rangeId: input.rangeId,
      finish: input.finish,
      finishReason: input.finishReason,
      coverage: input.coverage,
      coverageReason: input.coverageReason,
      tZoneNote: input.tZoneNote,
      checkedFree: input.checkedFree,
      closestLabel: input.closestLabel,
      concealerSuggested: input.concealerSuggested,
      concealer: input.concealer,
      shades: input.shades.map((s) => ({
        id: s.id,
        name: s.name,
        hex: s.hex,
        de: s.de,
      })),
    },
  });
  return { type: "match_shade", nodes };
}

const done = (n: RunNode | undefined): n is RunNode =>
  n?.status === "done" || n?.status === "cached";

const CheckParams = z.object({
  skin: z.tuple([z.number(), z.number(), z.number()]),
  shade: z.tuple([z.number(), z.number(), z.number()]),
});

const AssembleParams = z.object({
  rangeId: z.string(),
  finish: z.enum(["matte", "satin", "dewy"]),
  finishReason: z.string(),
  coverage: z.enum(["light", "medium"]),
  coverageReason: z.string(),
  tZoneNote: z.boolean(),
  checkedFree: z.number().int().nonnegative(),
  closestLabel: ShadeResult.shape.closestLabel,
  concealerSuggested: z.boolean(),
  concealer: z.boolean(),
  shades: z.array(z.object({ id: z.string(), name: z.string(), hex: z.string(), de: z.number() })),
});

interface CheckOutput {
  blendDe: number;
  directionOk: boolean;
  label: "blends_closely" | "close" | "not_close";
  matchDe: number;
  closeDe: number;
  calibrated: boolean;
}

export function createShadeExecutors(deps: { engine: EngineClient }): Record<string, NodeExecutor> {
  /** Re-measures a render against the skin: its skin colour in Lab, then the closed-loop check. */
  const check: NodeExecutor = async (ctx) => {
    const params = CheckParams.safeParse(ctx.node.params);
    if (!params.success) return err({ code: "bad_params", retryable: false });
    const hexes = toneHexes(ctx.upstream[ctx.node.dependsOn[0] ?? ""]?.output);
    const hex = hexes?.skin;
    if (hex === undefined) return err({ code: "no_colour_read", retryable: false });
    const lab = await deps.engine.colourLab([hex]);
    const render = lab.ok ? lab.value.value[0]?.lab : undefined;
    if (!lab.ok || !render)
      return err(lab.ok ? { code: "engine_bad_reply", retryable: false } : lab.error);
    const loop = await deps.engine.closedLoop(params.data.skin, params.data.shade, render);
    if (!loop.ok) return err(loop.error);
    const cfg = loop.value.config;
    // The engine echoes the thresholds it used. Without them the result could not say what "close"
    // meant, so a reply that lacks them is refused.
    if (!cfg?.MATCH_DE || !cfg.CLOSE_DE) return err({ code: "engine_bad_reply", retryable: false });
    const out: CheckOutput = {
      blendDe: loop.value.value.blend_de,
      directionOk: loop.value.value.direction_ok,
      label: loop.value.value.label,
      matchDe: cfg.MATCH_DE.value,
      closeDe: cfg.CLOSE_DE.value,
      calibrated: cfg.MATCH_DE.calibrated && cfg.CLOSE_DE.calibrated,
    };
    return ok({ output: out });
  };

  const assemble: NodeExecutor = (ctx) => {
    const params = AssembleParams.safeParse(ctx.node.params);
    if (!params.success) return Promise.resolve(err({ code: "bad_params", retryable: false }));
    const p = params.data;
    let thresholds: ShadeResult["thresholds"] | undefined;
    const outcomes: ShadeOutcome[] = p.shades.map((shade, i) => {
      const render = ctx.upstream[renderId(i)];
      const measure = ctx.upstream[measureId(i)];
      const checkNode = ctx.upstream[checkId(i)];
      const base = { shadeId: shade.id, name: shade.name, hex: shade.hex, preDe: shade.de };
      if (done(checkNode) && done(render)) {
        const c = checkNode.output as CheckOutput;
        thresholds = { matchDe: c.matchDe, closeDe: c.closeDe, calibrated: c.calibrated };
        return {
          ...base,
          verdict: c.directionOk ? "verified" : "drift",
          blendDe: c.blendDe,
          renderNode: renderId(i),
        };
      }
      // Whichever step stopped the chain explains the row.
      const stopped = [render, measure, checkNode].find((n) => n?.status === "failed");
      const reason =
        stopped?.error?.code ??
        ([render, measure, checkNode].some(
          (n) => n?.status === "skipped" || n?.status === "cancelled",
        )
          ? "not_rendered"
          : "unreadable_result");
      return { ...base, verdict: "failed" as const, reason };
    });

    const rank = (o: ShadeOutcome) =>
      o.verdict === "verified" ? 0 : o.verdict === "drift" ? 1 : 2;
    outcomes.sort(
      (a, b) =>
        rank(a) - rank(b) || (a.blendDe ?? Infinity) - (b.blendDe ?? Infinity) || a.preDe - b.preDe,
    );
    // A run where no render could be measured has nothing to show: say so by failing this step.
    if (thresholds === undefined) {
      return Promise.resolve(err({ code: "nothing_measured", retryable: false }));
    }
    // "Close" is the engine's own label for the blend, not a number compared here.
    const top = outcomes.find((o) => o.verdict === "verified");
    const topIndex = top ? p.shades.findIndex((s) => s.id === top.shadeId) : -1;
    const topCheck = ctx.upstream[checkId(topIndex)]?.output as CheckOutput | undefined;
    const bestShadeId =
      top !== undefined && topCheck !== undefined && topCheck.label !== "not_close"
        ? top.shadeId
        : undefined;
    const result = ShadeResult.parse({
      rangeId: p.rangeId,
      finish: p.finish,
      finishReason: p.finishReason,
      coverage: p.coverage,
      coverageReason: p.coverageReason,
      tZoneNote: p.tZoneNote,
      outcomes,
      ...(bestShadeId === undefined ? {} : { bestShadeId }),
      noClosePick: bestShadeId === undefined,
      closestLabel: p.closestLabel,
      concealer: p.concealer,
      concealerSuggested: p.concealerSuggested,
      checkedFree: p.checkedFree,
      thresholds,
    });
    return Promise.resolve(ok({ output: result }));
  };

  return { [SHADE_EXECUTORS.check]: check, [SHADE_EXECUTORS.assemble]: assemble };
}
