import {
  CONFIG,
  Twin,
  TwinGroupName,
  groupOf,
  type ColourPart,
  type Metric,
  type MetricSource,
  type MissingReading,
  type RunNode,
  type TwinGroup,
} from "@mira/schemas";
import { z } from "zod";
import { getDoc, type Ports } from "@mira/runtime";
import { featureOf, type FeatureSlug } from "@mira/youcam-client";
import { err, ok } from "@mira/schemas";
import type { GraphSpec, NodeSpec } from "../runner/graph";
import type { ExecutorContext, NodeExecutor } from "../runner/runner";
import type { ColourReading, EngineClient, NoiseFloorReading } from "../twin/engine-client";
import {
  concernsFor,
  extractColour,
  extractFace,
  extractFitzpatrick,
  extractHair,
  extractSkin,
  repeatScores,
  toneHexes,
  type Extracted,
} from "../twin/extract";

/**
 * Build Twin (docs/ARCHITECTURE.md §4, phases/PHASE_05): the analysers read the captures in
 * parallel, two local steps derive colour and the same-session noise estimate, and a last step
 * writes the profile from whatever succeeded. A failed analyser leaves its group "Not measured"
 * with the reason; it never blocks the others (docs/UX_FLOWS.md §4).
 *
 * Images are inputs only. The write step stores numbers, ids and words, and cleanup deletes every
 * uploaded image when the run ends (AGENTS.md §2.9).
 */

export const TWIN_EXECUTORS = {
  colour: "twin-colour",
  noise: "twin-noise-floor",
  write: "twin-write",
} as const;

export interface HairCapture {
  front: string;
  /** Type and frizziness need all three angles (docs/YOUCAM_API.md §2). */
  right?: string | undefined;
  left?: string | undefined;
}

/** Blob keys of the captures, as `uploads/...` paths the lifecycle can read. */
export interface TwinCapture {
  face: string;
  /** Up to two more face captures seconds apart, for the same-session estimate. */
  repeats?: readonly string[] | undefined;
  hair?: HairCapture | undefined;
  mode: "hd" | "sd";
  source: "camera" | "upload";
  /** Null for an upload, which has no live quality checks. */
  qualityChecksPassed: boolean | null;
  /** A retry of some groups only; the rest is kept from the existing profile. */
  only?: readonly TwinGroupName[] | undefined;
}

const blob = (key: string) => `blob:${key}`;

export function buildTwinGraph(capture: TwinCapture): GraphSpec {
  const wants = (g: TwinGroupName) => capture.only === undefined || capture.only.includes(g);
  const repeats = wants("skin")
    ? (capture.repeats ?? []).slice(0, CONFIG.twin.repeatCaptures.value)
    : [];
  const nodes: NodeSpec[] = [];

  if (wants("skin")) {
    const skin = (id: string, key: string, optional: boolean): NodeSpec => ({
      id,
      kind: "youcam",
      label: "step.measure_skin",
      feature: "skin-analysis",
      params: { concerns: concernsFor(capture.mode) },
      inputs: { src: blob(key) },
      optional,
    });
    nodes.push(skin("skin", capture.face, false));
    // Repeats are separate, separately quoted steps: the person can drop them in the QuoteSheet.
    repeats.forEach((key, i) => nodes.push(skin(`skin-r${String(i + 1)}`, key, true)));
  }
  if (wants("colouring")) {
    nodes.push(
      {
        id: "tone",
        kind: "youcam",
        label: "step.measure_colour",
        feature: "skin-tone-analysis",
        inputs: { src: blob(capture.face) },
      },
      {
        id: "fitzpatrick",
        kind: "youcam",
        label: "step.measure_band",
        feature: "fitzpatrick-scale-analyzer",
        inputs: { src: blob(capture.face) },
      },
      {
        id: "colour",
        kind: "engine",
        label: "step.derive_colour",
        feature: TWIN_EXECUTORS.colour,
        dependsOn: ["tone"],
      },
    );
  }
  if (wants("face")) {
    nodes.push({
      id: "face",
      kind: "youcam",
      label: "step.measure_face",
      feature: "face-attr-analysis",
      params: { features: [...CONFIG.twin.faceFeatures.value] },
      inputs: { src: blob(capture.face) },
    });
  }
  const hair = wants("hair") ? capture.hair : undefined;
  if (hair) {
    const hairNode = (id: string, feature: FeatureSlug, inputs: Record<string, string>) =>
      nodes.push({
        id,
        kind: "youcam",
        label: "step.measure_hair",
        feature,
        inputs,
        optional: true,
      });
    hairNode("hair-density", "hair-density-detection", { src: blob(hair.front) });
    hairNode("hair-length", "hair-length-detection", { src: blob(hair.front) });
    if (hair.right !== undefined && hair.left !== undefined) {
      const triple = { src0: blob(hair.front), src1: blob(hair.right), src2: blob(hair.left) };
      hairNode("hair-type", "hair-type-detection", triple);
      hairNode("hair-frizz", "hair-frizziness-detection", triple);
    }
  }
  if (repeats.length >= 1) {
    nodes.push({
      id: "noise",
      kind: "engine",
      label: "step.estimate_noise",
      feature: TWIN_EXECUTORS.noise,
      dependsOn: ["skin", ...repeats.map((_, i) => `skin-r${String(i + 1)}`)],
      // The estimate needs the repeats, but a failed repeat just means fewer captures.
      tolerant: true,
      optional: true,
    });
  }
  nodes.push({
    id: "write",
    kind: "system",
    label: "step.write_profile",
    feature: TWIN_EXECUTORS.write,
    dependsOn: nodes.map((n) => n.id),
    tolerant: true,
    params: {
      mode: capture.mode,
      source: capture.source,
      qualityChecksPassed: capture.qualityChecksPassed,
      repeatsCaptured: repeats.length,
      covers: capture.only ?? ["skin", "colouring", "face", "hair"],
      hairCaptured: hair
        ? { basic: true, angles: hair.right !== undefined && hair.left !== undefined }
        : null,
    },
  });
  return { type: "build_twin", nodes };
}

// ---------------------------------------------------------------------------------------------
// Assembly: pure. Runs once every analyser has finished, whether or not it succeeded.
// ---------------------------------------------------------------------------------------------

const GROUPS: readonly TwinGroupName[] = ["skin", "colouring", "face", "hair"];
const done = (n: RunNode | undefined): n is RunNode =>
  n?.status === "done" || n?.status === "cached";

/** Why a step produced nothing, in the words the profile maps to copy. */
function reasonOf(node: RunNode | undefined): Pick<MissingReading, "reason" | "guidance"> {
  if (node === undefined) return { reason: "not_captured" };
  if (node.error) {
    return {
      reason: node.error.code,
      ...(node.error.guidance ? { guidance: node.error.guidance } : {}),
    };
  }
  if (node.status === "skipped" || node.status === "cancelled") return { reason: node.status };
  return { reason: "unreadable_result" };
}

export interface AssembleInput {
  userId: string;
  runId: string;
  now: string;
  nodes: Readonly<Record<string, RunNode>>;
  params: WriteParams;
  previous?: Twin | undefined;
  synthetic: boolean;
}

export const WriteParams = z.object({
  mode: z.enum(["hd", "sd"]),
  source: z.enum(["camera", "upload"]),
  qualityChecksPassed: z.boolean().nullable(),
  repeatsCaptured: z.number().int().min(0),
  covers: z.array(TwinGroupName),
  /** What hair was captured: nothing, the front only, or all three angles. */
  hairCaptured: z.object({ basic: z.boolean(), angles: z.boolean() }).nullable(),
});
export type WriteParams = z.infer<typeof WriteParams>;

const stampOf = (
  run: string,
  node: RunNode | undefined,
  fallbackVersion: string,
): MetricSource => ({
  feature: node?.feature ?? "unknown",
  version: node?.version ?? fallbackVersion,
  taskRunId: node?.taskId ?? run,
});
const versionOf = (feature: string | undefined): string => {
  try {
    return feature === undefined ? "unknown" : featureOf(feature as FeatureSlug).version;
  } catch {
    return "unknown";
  }
};

interface GroupBuild {
  metrics: Metric[];
  missing: MissingReading[];
  ratios?: Record<string, number[]>;
}

function take(
  build: GroupBuild,
  reading: string,
  node: RunNode | undefined,
  extract: (output: unknown) => Extracted,
): void {
  if (!done(node)) {
    build.missing.push({ reading, ...reasonOf(node) });
    return;
  }
  const out = extract(node.output);
  if (!out.ok || out.value.metrics.length === 0) {
    build.missing.push({ reading, reason: "unreadable_result" });
    return;
  }
  build.metrics.push(...out.value.metrics);
  if (out.value.ratios) build.ratios = { ...build.ratios, ...out.value.ratios };
}

export function assembleTwin(input: AssembleInput): Twin {
  const { nodes, params, runId, now } = input;
  const stamp = (node: RunNode | undefined) => ({
    source: stampOf(runId, node, versionOf(node?.feature)),
    at: now,
  });
  const builds: Record<TwinGroupName, GroupBuild> = {
    skin: { metrics: [], missing: [] },
    colouring: { metrics: [], missing: [] },
    face: { metrics: [], missing: [] },
    hair: { metrics: [], missing: [] },
  };

  // Skin: the main capture; a concern the answer lacks is named, not silently dropped.
  take(builds.skin, "skin", nodes.skin, (o) => extractSkin(o, stamp(nodes.skin), params.mode));
  if (done(nodes.skin)) {
    const got = new Set(builds.skin.metrics.map((m) => m.id));
    for (const concern of concernsFor(params.mode)) {
      if (![...got].some((id) => id.startsWith(`skin.${concern}.`))) {
        builds.skin.missing.push({ reading: concern, reason: "not_returned" });
      }
    }
    if (builds.skin.metrics.length === 0)
      builds.skin.missing = [{ reading: "skin", reason: "unreadable_result" }];
  }

  // Colouring: swatches (tone + the colour engine) and the Fitzpatrick band.
  const colourNode = nodes.colour;
  const colourOut = (colourNode?.output ?? {}) as {
    readings?: Partial<Record<ColourPart, ColourReading>>;
    engineVersion?: string;
  };
  take(builds.colouring, "colour", nodes.tone, (o) =>
    done(colourNode)
      ? extractColour(o, colourOut.readings ?? {}, stamp(nodes.tone), {
          source: {
            feature: "engine:colour/lab",
            version: colourOut.engineVersion ?? "unknown",
            taskRunId: runId,
          },
          at: now,
        })
      : { ok: false, reason: "unreadable" },
  );
  if (done(nodes.tone) && !done(colourNode)) {
    builds.colouring.missing = builds.colouring.missing.filter((m) => m.reading !== "colour");
    builds.colouring.missing.push({ reading: "colour", ...reasonOf(colourNode) });
  }
  // Skin colour is what shade matching reads. If the answer came back without a usable one, the
  // group is partial and says which reading is missing, never "measured".
  if (
    done(nodes.tone) &&
    done(colourNode) &&
    !builds.colouring.metrics.some((m) => m.id === "colour.skin") &&
    !builds.colouring.missing.some((m) => m.reading === "colour")
  ) {
    builds.colouring.missing.push({ reading: "skin_colour", reason: "not_returned" });
  }
  take(builds.colouring, "skin_tone_band", nodes.fitzpatrick, (o) =>
    extractFitzpatrick(o, stamp(nodes.fitzpatrick)),
  );

  take(builds.face, "proportions", nodes.face, (o) => extractFace(o, stamp(nodes.face)));

  // Hair: only what was captured is expected; the rest says it was not captured.
  const hairKinds = [
    ["hair_type", "hair-type", "type"],
    ["hair_frizziness", "hair-frizz", "frizz"],
    ["hair_density", "hair-density", "density"],
    ["hair_length", "hair-length", "length"],
  ] as const;
  for (const [reading, id, kind] of hairKinds) {
    const node = nodes[id];
    if (node === undefined) {
      // Type and frizziness need three angles; say so when only the front was taken.
      if (params.hairCaptured !== null)
        builds.hair.missing.push({ reading, reason: "not_captured" });
      continue;
    }
    take(builds.hair, reading, node, (o) => extractHair(kind, o, stamp(node)));
  }
  if (params.hairCaptured === null) {
    builds.hair.missing = [{ reading: "hair", reason: "not_captured" }];
  }

  // Merge onto the existing profile: a retry of one group keeps the others.
  const prev = input.previous;
  const metrics: Twin["metrics"] = {};
  if (prev) {
    for (const [id, m] of Object.entries(prev.metrics)) {
      if (!params.covers.includes(groupOf(id))) metrics[id] = m;
    }
  }
  const groups = {} as Record<TwinGroupName, TwinGroup>;
  // Groups whose earlier readings were kept because this run read nothing for them. Whatever was
  // derived from the same photos (the repeat spread, the capture details, the face ratios) belongs
  // with those readings and is kept too.
  const kept = new Set<TwinGroupName>();
  for (const g of GROUPS) {
    if (!params.covers.includes(g)) {
      groups[g] = prev?.groups[g] ?? {
        status: "not_measured",
        missing: [{ reading: g, reason: "not_captured" }],
        at: now,
      };
      continue;
    }
    const b = builds[g];
    const before = prev?.groups[g];
    if (b.metrics.length === 0 && before !== undefined && before.status !== "not_measured") {
      // A retry that read nothing must not wipe what was measured before; the run itself shows
      // the failure, and the existing readings keep their own date.
      groups[g] = before;
      kept.add(g);
      for (const [id, m] of Object.entries(prev?.metrics ?? {})) {
        if (groupOf(id) === g) metrics[id] = m;
      }
      continue;
    }
    for (const m of b.metrics) metrics[m.id] = m;
    const status =
      b.metrics.length === 0 ? "not_measured" : b.missing.length > 0 ? "partial" : "measured";
    groups[g] = { status, missing: b.missing, at: now };
  }

  const noise = (nodes.noise?.output ?? {}) as { floors?: Record<string, NoiseFloorReading> };
  const skinNew = params.covers.includes("skin") && !kept.has("skin");
  const noiseFloors: Twin["noiseFloors"] = { ...(skinNew ? {} : prev?.noiseFloors) };
  // Floors from this run belong to this run's skin readings; if those were not kept, neither are they.
  for (const [id, f] of Object.entries(skinNew ? (noise.floors ?? {}) : {})) {
    noiseFloors[id] = {
      sessions: f.sessions,
      capturesPerSession: f.captures_per_session,
      sW: f.s_w,
      sD: f.s_d,
      sDSource: f.s_d_source,
      se: f.se,
      mdc: f.mdc,
    };
  }

  const faceNew = params.covers.includes("face") && !kept.has("face");
  const skinCovered = skinNew;
  // Repeats that actually succeeded, not the number planned.
  const repeatsDone = ["skin-r1", "skin-r2"].filter((id) => done(nodes[id])).length;
  return Twin.parse({
    userId: input.userId,
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
    metrics,
    groups,
    faceRatios: faceNew ? (builds.face.ratios ?? {}) : (prev?.faceRatios ?? {}),
    noiseFloors,
    captureMeta:
      skinCovered || prev === undefined
        ? {
            mode: params.mode,
            source: params.source,
            repeatsCaptured: repeatsDone,
            qualityChecksPassed: params.qualityChecksPassed,
          }
        : prev.captureMeta,
    runIds: [...(prev?.runIds ?? []), runId],
    synthetic: input.synthetic,
  });
}

// ---------------------------------------------------------------------------------------------
// Executors
// ---------------------------------------------------------------------------------------------

export interface TwinExecutorDeps {
  ports: Pick<Ports, "state" | "clock">;
  engine: EngineClient;
  /** True when the analysers were a test double: the profile is then marked synthetic (D25). */
  synthetic: boolean;
}

export const twinPath = (userId: string) => `twins/${userId}`;

export function createTwinExecutors(deps: TwinExecutorDeps): Record<string, NodeExecutor> {
  const colour: NodeExecutor = async (ctx) => {
    const hexes = toneHexes(ctx.upstream.tone?.output);
    if (hexes === undefined || Object.keys(hexes).length === 0) {
      return err({ code: "no_colour_read", retryable: false });
    }
    const parts = Object.keys(hexes) as ColourPart[];
    const res = await deps.engine.colourLab(parts.map((p) => hexes[p] as string));
    if (!res.ok) return err(res.error);
    const readings: Partial<Record<ColourPart, ColourReading>> = {};
    parts.forEach((p, i) => {
      const r = res.value.value[i];
      if (r) readings[p] = r;
    });
    return ok({ output: { readings, engineVersion: res.value.engineVersion } });
  };

  const noise: NodeExecutor = async (ctx) => {
    const captures: Metric[][] = [];
    // The repeats only mean something beside the photo they repeat.
    if (!done(ctx.upstream.skin)) return ok({ output: { floors: {}, captures: 0 } });
    for (const id of ["skin", "skin-r1", "skin-r2"]) {
      const node = ctx.upstream[id];
      if (!done(node)) continue;
      const out = extractSkin(
        node.output,
        {
          source: { feature: "skin-analysis", version: "v2.1", taskRunId: ctx.run.id },
          at: new Date(deps.ports.clock.now()).toISOString(),
        },
        modeOf(node),
      );
      if (out.ok) captures.push(out.value.metrics);
    }
    // One capture is no estimate: say so with an empty result rather than inventing a spread.
    if (captures.length < 2) return ok({ output: { floors: {}, captures: captures.length } });
    const scores = repeatScores(captures);
    const floors: Record<string, NoiseFloorReading> = {};
    let engineVersion = "unknown";
    for (const [id, list] of Object.entries(scores)) {
      const res = await deps.engine.noiseFloor([list]);
      if (!res.ok) return err(res.error);
      floors[id] = res.value.value;
      engineVersion = res.value.engineVersion;
    }
    return ok({ output: { floors, captures: captures.length, engineVersion } });
  };

  const write: NodeExecutor = async (ctx: ExecutorContext) => {
    const parsed = WriteParams.safeParse(ctx.node.params);
    if (!parsed.success) return err({ code: "bad_params", retryable: false });
    const params = parsed.data;
    const previous = await getDoc(deps.ports.state, twinPath(ctx.run.userId), Twin);
    const twin = assembleTwin({
      userId: ctx.run.userId,
      runId: ctx.run.id,
      now: new Date(deps.ports.clock.now()).toISOString(),
      nodes: ctx.upstream,
      params,
      previous,
      synthetic: deps.synthetic,
    });
    // Nothing new was read: fail this step so the run reports it, and write nothing.
    const measuredNow = params.covers.some(
      (g) => twin.groups[g].at === twin.updatedAt && twin.groups[g].status !== "not_measured",
    );
    if (!measuredNow) return err({ code: "nothing_measured", retryable: false });
    await deps.ports.state.set(twinPath(ctx.run.userId), twin);
    return ok({ output: { groups: twin.groups, metrics: Object.keys(twin.metrics).length } });
  };

  return {
    [TWIN_EXECUTORS.colour]: colour,
    [TWIN_EXECUTORS.noise]: noise,
    [TWIN_EXECUTORS.write]: write,
  };
}

/** The detail mode a skin node was asked for, from its concerns. */
function modeOf(node: RunNode): "hd" | "sd" {
  const concerns = (node.params as { concerns?: unknown }).concerns;
  return Array.isArray(concerns) &&
    concerns.every((c) => typeof c === "string" && c.startsWith("hd_"))
    ? "hd"
    : "sd";
}
