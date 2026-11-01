import {
  CONFIG,
  LookResult,
  Twin,
  err,
  ok,
  type GarmentItem,
  type LookStep,
  type LookStepId,
  type RunNode,
} from "@mira/schemas";
import { getDoc, type Ports } from "@mira/runtime";
import { placeholderHex, sceneFaceBox, scenePng } from "@mira/fixtures/placeholder";
import { z } from "zod";
import type { GraphSpec, NodeSpec } from "../runner/graph";
import type { NodeExecutor } from "../runner/runner";
import type { EngineClient, LabTuple } from "../twin/engine-client";
import { extractFace, toneHexes } from "../twin/extract";
import { twinPath } from "../twin/profile";
import { SYNTHETIC_TONE } from "../twin/synthetic";

/**
 * Complete Look (docs/ARCHITECTURE.md §4.3). Clothes go first because the generative clothes
 * engine can disturb the face; face edits land on the final pixels. Every step is chained on the
 * previous step's result (D12). The garment and the lip colour are audited, the face is compared
 * with the profile, and the video is made only when every audit that ran passed.
 *
 * ```text
 * outfit ─ shoes ─ bag ─ makeup ─ hair ─ identity ─ venue ─ gate ─ video
 *    └ audit-outfit      └ measure-lip ─ audit-lip       └ gate-identity
 * ```
 */
export const LOOK_EXECUTORS = {
  auditGarment: "look-audit-garment",
  auditLip: "look-audit-lip",
  auditIdentity: "look-audit-identity",
  gateIdentity: "look-gate-identity",
  gateVideo: "look-gate-video",
  assemble: "look-assemble",
} as const;

export interface LookInput {
  userId: string;
  /** Blob key of the full-length photo the look is made on. */
  photo: string;
  outfit: GarmentItem;
  shoes?: GarmentItem | undefined;
  bag?: { item: GarmentItem; gender: "female" | "male" } | undefined;
  /** Lip and blush the person is wearing in this look, from the suggestion. */
  makeup?: { lipHex: string; lipLab: LabTuple; blushHex?: string | undefined } | undefined;
  hair?: { hex: string } | undefined;
  venue?: { type: "prompt"; prompt: string } | { type: "template"; templateId: string } | undefined;
  video?: { resolution: "480" | "720" | "1080"; durationSec: 5 | 10; prompt?: string } | undefined;
}

/** The steps a quote can drop: everything except the outfit, which is the look. */
export const OPTIONAL_STEPS = ["shoes", "bag", "makeup", "hair", "venue", "video"] as const;

/** Nodes that go with a step when it is left out of the quote. */
export const STEP_NODES: Record<(typeof OPTIONAL_STEPS)[number], readonly string[]> = {
  shoes: ["shoes"],
  bag: ["bag"],
  makeup: ["makeup", "measure-lip", "audit-lip"],
  hair: ["hair"],
  venue: ["venue"],
  video: ["gate-video", "video"],
};

export function buildComposeLookGraph(input: LookInput): GraphSpec {
  const nodes: NodeSpec[] = [];
  let head = "outfit";
  const chain = (
    spec: Omit<NodeSpec, "dependsOn" | "inputs"> & { inputs?: Record<string, string> },
  ) => {
    nodes.push({
      ...spec,
      dependsOn: [head],
      inputs: { src: `node:${head}`, ...(spec.inputs ?? {}) },
    });
    head = spec.id;
  };

  nodes.push({
    id: "outfit",
    kind: "youcam",
    label: "step.try_outfit",
    feature: "cloth-v4",
    params: {
      category: input.outfit.category,
      changeShoes: input.shoes === undefined ? undefined : false,
    },
    inputs: { src: `blob:${input.photo}`, ref: `blob:${input.outfit.image}` },
  });
  nodes.push({
    id: "audit-outfit",
    kind: "engine",
    label: "step.check_garment",
    feature: LOOK_EXECUTORS.auditGarment,
    dependsOn: ["outfit"],
    params: { source: input.photo, garmentLabs: input.outfit.colour.auditLabs },
  });

  if (input.shoes) {
    chain({
      id: "shoes",
      kind: "youcam",
      label: "step.try_shoes",
      feature: "cloth-v4",
      params: { category: "shoes" },
      inputs: { ref: `blob:${input.shoes.image}` },
      optional: true,
    });
  }
  if (input.bag) {
    chain({
      id: "bag",
      kind: "youcam",
      label: "step.try_bag",
      feature: "bag",
      params: { gender: input.bag.gender },
      inputs: { ref: `blob:${input.bag.item.image}` },
      optional: true,
    });
  }
  if (input.makeup) {
    chain({
      id: "makeup",
      kind: "youcam",
      label: "step.try_makeup",
      feature: "makeup-vto",
      // `skin_smooth` is sent at 0 by the request builder: the face is shown as measured.
      params: {
        effects: [
          {
            category: "lip_color",
            shape: { name: "original" },
            style: { type: "full" },
            palettes: [
              {
                color: input.makeup.lipHex,
                texture: "satin",
                colorIntensity: CONFIG.look.lipColourIntensity.value,
              },
            ],
          },
          ...(input.makeup.blushHex
            ? [
                {
                  category: "blush",
                  pattern: { name: "1color1" },
                  palettes: [
                    {
                      color: input.makeup.blushHex,
                      texture: "satin",
                      colorIntensity: CONFIG.look.blushColourIntensity.value,
                    },
                  ],
                },
              ]
            : []),
        ],
      },
      optional: true,
    });
    nodes.push(
      {
        id: "measure-lip",
        kind: "youcam",
        label: "step.measure_lip",
        feature: "skin-tone-analysis",
        dependsOn: ["makeup"],
        inputs: { src: "node:makeup" },
        optional: true,
      },
      {
        id: "audit-lip",
        kind: "engine",
        label: "step.check_lip",
        feature: LOOK_EXECUTORS.auditLip,
        dependsOn: ["measure-lip"],
        params: { intended: input.makeup.lipHex },
        optional: true,
      },
    );
  }
  if (input.hair) {
    chain({
      id: "hair",
      kind: "youcam",
      label: "step.try_hair",
      feature: "hair-color",
      params: { pattern: { name: "full" }, palettes: [{ color: input.hair.hex }] },
      optional: true,
    });
  }

  // The face is compared on the last picture a face edit touched.
  const faceHead = head;
  nodes.push(
    {
      id: "identity",
      kind: "youcam",
      label: "step.check_face",
      feature: "face-attr-analysis",
      dependsOn: [faceHead],
      params: { features: [...CONFIG.twin.faceFeatures.value] },
      inputs: { src: `node:${faceHead}` },
    },
    {
      id: "audit-identity",
      kind: "engine",
      label: "step.compare_face",
      feature: LOOK_EXECUTORS.auditIdentity,
      dependsOn: ["identity"],
      params: { userId: input.userId },
    },
    {
      id: "gate-identity",
      kind: "system",
      label: "step.compare_face",
      feature: LOOK_EXECUTORS.gateIdentity,
      dependsOn: ["audit-identity"],
      // Runs even when the comparison could not be made: only a measured drift stops the chain.
      tolerant: true,
    },
  );

  if (input.venue) {
    nodes.push({
      id: "venue",
      kind: "youcam",
      label: "step.place_venue",
      feature: "bg-replace",
      dependsOn: [faceHead, "gate-identity"],
      params: input.venue,
      inputs: { src: `node:${faceHead}` },
      optional: true,
    });
    head = "venue";
  }

  if (input.video) {
    const audits = ["audit-outfit", ...(input.makeup ? ["audit-lip"] : []), "gate-identity"];
    nodes.push(
      {
        id: "gate-video",
        kind: "system",
        label: "step.check_before_video",
        feature: LOOK_EXECUTORS.gateVideo,
        dependsOn: audits,
        params: { audits },
        optional: true,
      },
      {
        id: "video",
        kind: "youcam",
        label: "step.make_video",
        feature: "image-to-video/youcam",
        dependsOn: [head, "gate-video"],
        params: input.video,
        inputs: { src: `node:${head}` },
        optional: true,
      },
    );
  }

  nodes.push({
    id: "assemble",
    kind: "system",
    label: "step.put_look_together",
    feature: LOOK_EXECUTORS.assemble,
    dependsOn: nodes.map((n) => n.id),
    tolerant: true,
    params: {
      steps: {
        outfit: "outfit",
        ...(input.shoes ? { shoes: "shoes" } : {}),
        ...(input.bag ? { bag: "bag" } : {}),
        ...(input.makeup ? { makeup: "makeup" } : {}),
        ...(input.hair ? { hair: "hair" } : {}),
        ...(input.venue ? { venue: "venue" } : {}),
      },
      faceHead,
      video: input.video !== undefined,
    },
  });
  return { type: "compose_look", nodes };
}

// ---------------------------------------------------------------------------------------------
// Executors
// ---------------------------------------------------------------------------------------------

const done = (n: RunNode | undefined): boolean => n?.status === "done" || n?.status === "cached";

const Labs = z
  .array(z.tuple([z.number(), z.number(), z.number()]))
  .min(1)
  .max(2);

interface AuditOutput {
  label: "verified" | "drift" | "not_checked";
  de?: number;
  direction?: string;
  reason?: string;
  threshold?: number;
  calibrated?: boolean;
}

interface IdentityOutput {
  drift: number;
  passed: boolean;
  max: number;
  calibrated: boolean;
}

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

export function createLookExecutors(deps: {
  engine: EngineClient;
  ports: Pick<Ports, "state" | "blobs">;
  /** Mock mode: the pictures are synthetic scenes, so the audits compare scenes (D25, D39). */
  synthetic: boolean;
}): Record<string, NodeExecutor> {
  const auditGarment: NodeExecutor = async (ctx) => {
    const params = z.object({ source: z.string(), garmentLabs: Labs }).safeParse(ctx.node.params);
    if (!params.success) return err({ code: "bad_params", retryable: false });
    const render = ctx.upstream[ctx.node.dependsOn[0] ?? ""];
    const renderBlob = render?.resultRef ? await deps.ports.blobs.get(render.resultRef) : undefined;
    if (!renderBlob) return err({ code: "render_missing", retryable: false });
    // A synthetic render is a scene, so its "before" is the same scene without the garment.
    const source = deps.synthetic
      ? scenePng({ skin: SYNTHETIC_TONE.color.skin_color })
      : (await deps.ports.blobs.get(params.data.source))?.bytes;
    if (!source) return err({ code: "source_missing", retryable: false });
    const r = await deps.engine.auditGarment({
      sourceB64: b64(source),
      renderB64: b64(renderBlob.bytes),
      garmentLabs: params.data.garmentLabs,
      ...(deps.synthetic ? { faceBox: sceneFaceBox() } : {}),
    });
    if (!r.ok) return err(r.error);
    const threshold = r.value.config?.GARMENT_VERIFY_DE;
    const out: AuditOutput = {
      label: r.value.value.label,
      ...(r.value.value.de == null ? {} : { de: r.value.value.de }),
      ...(r.value.value.direction == null ? {} : { direction: r.value.value.direction }),
      reason: r.value.value.reason,
      ...(threshold ? { threshold: threshold.value, calibrated: threshold.calibrated } : {}),
    };
    return ok({ output: out });
  };

  const auditLip: NodeExecutor = async (ctx) => {
    const params = z.object({ intended: z.string() }).safeParse(ctx.node.params);
    if (!params.success) return err({ code: "bad_params", retryable: false });
    const lip = toneHexes(ctx.upstream[ctx.node.dependsOn[0] ?? ""]?.output)?.lip;
    if (lip === undefined) return err({ code: "no_colour_read", retryable: false });
    const labs = await deps.engine.colourLab([lip, params.data.intended]);
    const [rendered, intended] = labs.ok ? labs.value.value : [];
    if (!labs.ok || !rendered || !intended) {
      return err(labs.ok ? { code: "engine_bad_reply", retryable: false } : labs.error);
    }
    const r = await deps.engine.auditLip(rendered.lab, intended.lab);
    if (!r.ok) return err(r.error);
    const threshold = r.value.config?.LIP_VERIFY_DE;
    const out: AuditOutput = {
      label: r.value.value.label,
      de: r.value.value.de,
      ...(threshold ? { threshold: threshold.value, calibrated: threshold.calibrated } : {}),
    };
    return ok({ output: out });
  };

  const auditIdentity: NodeExecutor = async (ctx) => {
    const params = z.object({ userId: z.string() }).safeParse(ctx.node.params);
    if (!params.success) return err({ code: "bad_params", retryable: false });
    const twin = await getDoc(deps.ports.state, twinPath(params.data.userId), Twin);
    if (!twin) return err({ code: "no_profile", retryable: false });
    const final = extractFace(ctx.upstream[ctx.node.dependsOn[0] ?? ""]?.output, {
      source: { feature: "face-attr-analysis", version: "v2.0", taskRunId: ctx.run.id },
      at: new Date().toISOString(),
    });
    if (!final.ok || final.value.ratios === undefined) {
      return err({ code: "no_face_read", retryable: false });
    }
    // The largest change over every ratio vector the profile and the final picture share. One
    // vector over the limit is enough to withhold the picture.
    let drift: number | undefined;
    let passed = true;
    let limit: { value: number; calibrated: boolean } | undefined;
    for (const [name, vector] of Object.entries(final.value.ratios)) {
      const before = twin.faceRatios[name];
      if (before?.length !== vector.length) continue;
      const r = await deps.engine.auditIdentity(before, vector);
      if (!r.ok) return err(r.error);
      limit = r.value.config?.IDENTITY_DRIFT_MAX;
      if (!limit) return err({ code: "engine_bad_reply", retryable: false });
      drift = Math.max(drift ?? 0, r.value.value.drift);
      passed = passed && r.value.value.passed;
    }
    if (drift === undefined || limit === undefined) {
      return err({ code: "no_face_to_compare", retryable: false });
    }
    const worst: IdentityOutput = {
      drift,
      passed,
      max: limit.value,
      calibrated: limit.calibrated,
    };
    return ok({ output: worst });
  };

  const gateIdentity: NodeExecutor = (ctx) => {
    const node = ctx.upstream["audit-identity"];
    const id = node?.output as IdentityOutput | undefined;
    // A measured drift withholds the picture and stops what would be spent on it. A comparison
    // that could not be made is "not checked", not a pass, and does not stop the venue.
    if (done(node) && id !== undefined) {
      return Promise.resolve(
        id.passed
          ? ok({ output: { passed: true, checked: true } })
          : err({ code: "identity_drift", retryable: false }),
      );
    }
    return Promise.resolve(ok({ output: { passed: true, checked: false } }));
  };

  const gateVideo: NodeExecutor = (ctx) => {
    const params = z.object({ audits: z.array(z.string()) }).safeParse(ctx.node.params);
    if (!params.success) return Promise.resolve(err({ code: "bad_params", retryable: false }));
    // Every audit that was asked for must have run and said "verified". "Not checked" is not
    // "verified": the preview may still show the original clothes (docs/ENGINES.md §7.1).
    const passed = params.data.audits.every((id) => {
      const node = ctx.upstream[id];
      if (!done(node)) return false;
      const out = node?.output as
        (Partial<AuditOutput> & { passed?: boolean; checked?: boolean }) | undefined;
      return out?.label === "verified" || (out?.passed === true && out.checked === true);
    });
    return Promise.resolve(
      passed
        ? ok({ output: { passed: true } })
        : err({ code: "audit_not_passed", retryable: false }),
    );
  };

  const assemble: NodeExecutor = (ctx) => {
    const params = z
      .object({
        steps: z.record(z.string(), z.string()),
        faceHead: z.string(),
        video: z.boolean(),
      })
      .safeParse(ctx.node.params);
    if (!params.success) return Promise.resolve(err({ code: "bad_params", retryable: false }));
    const get = (id: string) => ctx.upstream[id];
    const audits: Record<string, AuditOutput | undefined> = {
      outfit: done(get("audit-outfit")) ? (get("audit-outfit")?.output as AuditOutput) : undefined,
      makeup: done(get("audit-lip")) ? (get("audit-lip")?.output as AuditOutput) : undefined,
    };
    const identityNode = get("audit-identity");
    const id = done(identityNode)
      ? (identityNode?.output as IdentityOutput | undefined)
      : undefined;
    const withheld = id !== undefined && !id.passed;

    const steps: LookStep[] = [];
    for (const [step, nodeId] of Object.entries(params.data.steps)) {
      const node = get(nodeId);
      const stepId = step as LookStepId;
      if (!done(node)) {
        const failed = node?.status === "failed";
        steps.push({
          id: stepId,
          node: nodeId,
          verdict: failed ? "failed" : "skipped",
          reason: failed ? node.error?.code : "not_made",
        });
        continue;
      }
      if (withheld) {
        steps.push({ id: stepId, node: nodeId, verdict: "withheld", reason: "identity_drift" });
        continue;
      }
      const audit = audits[step];
      if (step === "outfit" || step === "makeup") {
        const auditNode = get(step === "outfit" ? "audit-outfit" : "audit-lip");
        steps.push(
          audit === undefined
            ? {
                id: stepId,
                node: nodeId,
                verdict: "not_checked",
                reason: auditNode?.error?.code ?? "not_checked",
              }
            : {
                id: stepId,
                node: nodeId,
                verdict:
                  audit.label === "verified"
                    ? "verified"
                    : audit.label === "drift"
                      ? "drift"
                      : "not_checked",
                ...(audit.de === undefined ? {} : { de: audit.de }),
                ...(audit.direction === undefined ? {} : { direction: audit.direction }),
                ...(audit.label === "not_checked" && audit.reason ? { reason: audit.reason } : {}),
              },
        );
      } else {
        steps.push({ id: stepId, node: nodeId, verdict: "unchecked" });
      }
    }

    // Which picture is the plate: the latest step that made one and was not withheld.
    const order = ["outfit", "shoes", "bag", "makeup", "hair", "venue"];
    const plateStep = [...order]
      .reverse()
      .map((s) => steps.find((x) => x.id === s))
      .find(
        (s) =>
          s !== undefined &&
          s.verdict !== "failed" &&
          s.verdict !== "skipped" &&
          s.verdict !== "withheld",
      );
    const imageNodes = Object.values(params.data.steps);

    let identity: LookResult["identity"];
    if (id !== undefined) {
      identity = {
        verdict: id.passed ? "verified" : "withheld",
        drift: id.drift,
        max: id.max,
      };
    } else {
      identity = { verdict: "not_checked", reason: identityNode?.error?.code ?? "not_checked" };
    }

    const videoNode = get("video");
    const gate = get("gate-video");
    const video: LookResult["video"] = !params.data.video
      ? { status: "not_requested" }
      : done(videoNode)
        ? { status: "done", node: "video" }
        : videoNode?.status === "failed"
          ? { status: "failed", node: "video", reason: videoNode.error?.code }
          : { status: "skipped", reason: gate?.error?.code ?? "audit_not_passed" };

    const threshold = identityNode?.output as IdentityOutput | undefined;
    const result = LookResult.parse({
      steps,
      identity,
      ...(plateStep && !withheld ? { plate: plateStep.node } : {}),
      withheld: withheld ? imageNodes : [],
      video,
      thresholds: {
        garmentDe: audits.outfit?.threshold ?? CONFIG.look.garmentVerifyDeFallback.value,
        lipDe: audits.makeup?.threshold ?? CONFIG.look.lipVerifyDeFallback.value,
        identityMax: threshold?.max ?? CONFIG.look.identityMaxFallback.value,
        calibrated:
          (audits.outfit?.calibrated ?? false) &&
          (audits.makeup?.calibrated ?? true) &&
          (threshold?.calibrated ?? false),
      },
    });
    // A look with nothing to show (the outfit failed and so did everything after it) fails here.
    if (!withheld && result.plate === undefined) {
      return Promise.resolve(err({ code: "nothing_made", retryable: false }));
    }
    return Promise.resolve(ok({ output: result }));
  };

  return {
    [LOOK_EXECUTORS.auditGarment]: auditGarment,
    [LOOK_EXECUTORS.auditLip]: auditLip,
    [LOOK_EXECUTORS.auditIdentity]: auditIdentity,
    [LOOK_EXECUTORS.gateIdentity]: gateIdentity,
    [LOOK_EXECUTORS.gateVideo]: gateVideo,
    [LOOK_EXECUTORS.assemble]: assemble,
  };
}

/** Reads the colour a synthetic garment picture stands for (mock mode). */
export const garmentHexOf = (bytes: Uint8Array): string | undefined => placeholderHex(bytes);
