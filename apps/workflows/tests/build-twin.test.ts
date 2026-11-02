import { FakeClock, createMockPorts } from "@mira/runtime";
import { Twin } from "@mira/schemas";
import type { Sku } from "@mira/youcam-client";
import { FakeYouCam } from "@mira/youcam-client/testing";
import { describe, expect, it } from "vitest";
import {
  buildTwinGraph,
  createTwinExecutors,
  twinPath,
  type TwinCapture,
} from "../src/graphs/build-twin";
import { concernsFor } from "../src/twin/extract";
import { FakeEngine } from "./fake-engine";
import { makeHarness } from "./harness";

const SKUS: Sku[] = [
  { slug: "skin-analysis", amount: 16, description: "AI Skin Analysis for HD 5~8 concerns" },
  { slug: "skin-tone-analysis", amount: 20 },
  { slug: "fitzpatrick-scale-analyzer", amount: 10 },
  { slug: "face-attr-analysis", amount: 10 },
  { slug: "hair-type-detection", amount: 2 },
  { slug: "hair-frizziness-detection", amount: 2 },
  { slug: "hair-density-detection", amount: 1 },
  { slug: "hair-length-detection", amount: 2 },
];

const skinItems = (offset = 0) => ({
  output: [
    ...["hd_pore", "hd_wrinkle", "hd_texture", "hd_acne", "hd_oiliness", "hd_redness"].map(
      (type, i) => ({
        type,
        raw_score: 40 + i * 5 + offset,
        ui_score: 50,
      }),
    ),
    { type: "hd_dark_circle", region: "left_eye", raw_score: 33 + offset },
    { type: "hd_skin_type", raw_score: 61 },
    // Never stored: the overall score and the age estimate (docs/FACTS.md).
    { type: "all", raw_score: 70 },
    { type: "skin_age", raw_score: 31 },
  ],
});

function setup(options: { engine?: FakeEngine } = {}) {
  const engine = options.engine ?? new FakeEngine();
  const clock = new FakeClock();
  const ports = createMockPorts({ clock });
  const executors = createTwinExecutors({ ports, engine, synthetic: true });
  const fake = new FakeYouCam({ clock, skus: SKUS, startingUnits: 1000 });
  const h = makeHarness({ fake, executors, ports, clock });
  return { h, engine };
}

let uploads = 0;

/** Puts a capture where the web app puts uploads, and returns its blob key. */
async function upload(h: ReturnType<typeof makeHarness>, name: string): Promise<string> {
  const key = `uploads/${h.userId}/${name}.jpg`;
  // Distinct bytes per upload, so each one is its own cache key.
  uploads += 1;
  await h.ports.blobs.put(key, new Uint8Array([255, 216, 255, 224, uploads]), "image/jpeg");
  return key;
}

async function capture(
  h: ReturnType<typeof makeHarness>,
  extra: Partial<TwinCapture> = {},
): Promise<TwinCapture> {
  const key = (n: string) => upload(h, n);
  return {
    face: await key("face"),
    mode: "hd",
    source: "camera",
    qualityChecksPassed: true,
    ...extra,
  };
}

function scriptHappy(h: ReturnType<typeof makeHarness>) {
  h.fake
    .respondWith("skin-analysis", { latencyMs: 4_000, results: skinItems() })
    .respondWith("skin-tone-analysis", {
      latencyMs: 3_000,
      results: {
        color: {
          skin_color: "#c79a78",
          lip_color: "#A5504F",
          eye_color: "#3B2A1E",
          eye_color_name: "brown",
          hair_color: "#42280E",
          hair_color_name: "dark brown",
        },
      },
    })
    .respondWith("fitzpatrick-scale-analyzer", { results: { fitzpatrick_scale: "III" } })
    .respondWith("face-attr-analysis", {
      results: { facialratio: { face_aspect_ratio: [1.31], horizontal_third: [0.33, 0.34, 0.33] } },
    })
    .respondWith("hair-density-detection", {
      results: { hair_density: { mapping: "2", term: "medium" } },
    })
    .respondWith("hair-length-detection", { results: { hair_length: { term: "shoulder" } } })
    .respondWith("hair-type-detection", { results: { hair_type: { mapping: "3", term: "wavy" } } })
    .respondWith("hair-frizziness-detection", {
      results: { hair_frizziness: { mapping: "1", term: "low" } },
    });
}

describe("buildTwinGraph", () => {
  const base: TwinCapture = {
    face: "uploads/f.jpg",
    mode: "hd",
    source: "camera",
    qualityChecksPassed: true,
  };

  it("has one tone, band, face and skin step, a colour step and a write step", () => {
    const g = buildTwinGraph(base);
    expect(g.type).toBe("build_twin");
    expect(g.nodes.map((n) => n.id)).toEqual([
      "skin",
      "tone",
      "fitzpatrick",
      "colour",
      "face",
      "write",
    ]);
  });

  it("keeps the skin step to the configured concerns, in one price tier", () => {
    const skin = buildTwinGraph(base).nodes.find((n) => n.id === "skin");
    expect((skin?.params?.concerns as string[]).length).toBeLessThanOrEqual(8);
    expect(skin?.params?.concerns).toEqual(concernsFor("hd"));
  });

  it("asks for SD names when HD is impossible", () => {
    const concerns = concernsFor("sd");
    expect(concerns).toContain("pore");
    expect(concerns).toContain("dark_circle_v2");
    expect(concerns.some((c) => c.startsWith("hd_"))).toBe(false);
  });

  it("makes repeats optional steps and adds the estimate that reads them", () => {
    const g = buildTwinGraph({
      ...base,
      repeats: ["uploads/r1.jpg", "uploads/r2.jpg", "uploads/r3.jpg"],
    });
    expect(g.nodes.filter((n) => n.id.startsWith("skin-r")).map((n) => [n.id, n.optional])).toEqual(
      [
        ["skin-r1", true],
        ["skin-r2", true],
      ],
    );
    const noise = g.nodes.find((n) => n.id === "noise");
    expect(noise?.dependsOn).toEqual(["skin", "skin-r1", "skin-r2"]);
    expect(noise?.tolerant).toBe(true);
  });

  it("adds type and frizziness only with all three hair angles", () => {
    const front = buildTwinGraph({ ...base, hair: { front: "uploads/h.jpg" } });
    expect(front.nodes.filter((n) => n.id.startsWith("hair")).map((n) => n.id)).toEqual([
      "hair-density",
      "hair-length",
    ]);
    const all = buildTwinGraph({
      ...base,
      hair: { front: "uploads/h.jpg", right: "uploads/hr.jpg", left: "uploads/hl.jpg" },
    });
    expect(all.nodes.filter((n) => n.id.startsWith("hair")).map((n) => n.id)).toEqual([
      "hair-density",
      "hair-length",
      "hair-type",
      "hair-frizz",
    ]);
  });

  it("the write step waits for every other step and tolerates their failure", () => {
    const g = buildTwinGraph({ ...base, repeats: ["uploads/r1.jpg"] });
    const write = g.nodes.find((n) => n.id === "write");
    expect(write?.tolerant).toBe(true);
    expect(write?.dependsOn).toEqual(g.nodes.filter((n) => n.id !== "write").map((n) => n.id));
  });

  it("a retry of one group builds only that group", () => {
    const g = buildTwinGraph({ ...base, only: ["face"] });
    expect(g.nodes.map((n) => n.id)).toEqual(["face", "write"]);
  });
});

describe("Build Twin run", () => {
  it("happy path: every group measured, numbers only, flagged synthetic", async () => {
    const { h, engine } = setup();
    scriptHappy(h);
    const cap = await capture(h, {
      repeats: [await upload(h, "r1"), await upload(h, "r2")],
      hair: {
        front: await upload(h, "hf"),
        right: await upload(h, "hr"),
        left: await upload(h, "hl"),
      },
    });
    const runId = await h.start(buildTwinGraph(cap));
    await h.settle();

    const run = await h.run(runId);
    expect(run.status).toBe("succeeded");
    const twin = Twin.parse(await h.ports.state.get(twinPath(h.userId)));
    expect(twin.synthetic).toBe(true);
    expect(Object.values(twin.groups).map((g) => g.status)).toEqual([
      "measured",
      "measured",
      "measured",
      "measured",
    ]);

    // Skin: raw scores under distinct ids; the overall score and age never stored.
    expect(twin.metrics["skin.hd_pore.whole"]).toMatchObject({
      kind: "number",
      value: 40,
      unit: "raw score",
    });
    expect(twin.metrics["skin.hd_dark_circle.left_eye"]).toMatchObject({ value: 33 });
    expect(Object.keys(twin.metrics).filter((id) => /skin\.(all|skin_age)\./.test(id))).toEqual([]);
    // Colouring: swatches with Lab from the engine, ITA and the band, names, Fitzpatrick.
    expect(twin.metrics["colour.skin"]).toMatchObject({
      kind: "colour",
      hex: "#C79A78",
      lab: [60, 12, 24],
    });
    expect(twin.metrics["colour.skin_ita"]).toMatchObject({
      kind: "number",
      value: 22.6,
      unit: "°",
    });
    expect(twin.metrics["colour.skin_ita_band"]).toMatchObject({
      kind: "category",
      value: "tan",
    });
    expect(twin.metrics["colour.eye_name"]).toMatchObject({ value: "brown" });
    expect(twin.metrics["colour.fitzpatrick_band"]).toMatchObject({ value: "III" });
    // Face: one metric per element, vectors kept.
    expect(twin.metrics["face.horizontal_third.2"]).toMatchObject({ value: 0.34, unit: "ratio" });
    expect(twin.faceRatios.horizontal_third).toEqual([0.33, 0.34, 0.33]);
    // Hair.
    expect(twin.metrics["hair.type"]).toMatchObject({ value: "wavy" });
    expect(twin.metrics["hair.length"]).toMatchObject({ value: "shoulder" });
    // Source stamps name the feature and version.
    expect(twin.metrics["skin.hd_pore.whole"]?.source).toMatchObject({
      feature: "skin-analysis",
      version: "v2.1",
    });
    expect(twin.metrics["colour.skin_ita"]?.source.feature).toBe("engine:colour/lab");
    // The same-session estimate: one list per concern, three captures each.
    expect(engine.noiseCalls.length).toBeGreaterThan(0);
    expect(engine.noiseCalls.every((c) => c.length === 1 && c[0]?.length === 3)).toBe(true);
    expect(twin.noiseFloors["skin.hd_pore.whole"]).toMatchObject({
      capturesPerSession: 3,
      sW: 1.5,
      mdc: null,
      sDSource: "unknown",
    });
    expect(twin.captureMeta).toEqual({
      mode: "hd",
      source: "camera",
      repeatsCaptured: 2,
      qualityChecksPassed: true,
    });
    // Units: skin x3 (48) + tone 20 + band 10 + face 10 + hair 2+2+1+2 = 95.
    expect(run.unitsSpent).toBe(95);
  });

  it("partial failure: the failed group says why, the rest is kept, and the run is partial", async () => {
    const { h } = setup();
    scriptHappy(h);
    h.fake.respondWith("face-attr-analysis", { failWith: "error_face_too_small" });
    const runId = await h.start(buildTwinGraph(await capture(h)));
    await h.settle();

    expect((await h.run(runId)).status).toBe("partial");
    const twin = Twin.parse(await h.ports.state.get(twinPath(h.userId)));
    expect(twin.groups.face.status).toBe("not_measured");
    expect(twin.groups.face.missing[0]).toMatchObject({
      reading: "proportions",
      reason: "face_too_small",
      guidance: "retake",
    });
    expect(twin.groups.skin.status).toBe("measured");
    expect(twin.groups.colouring.status).toBe("measured");
    // Hair was never captured: not measured, and the reason is that, not a failure.
    expect(twin.groups.hair).toMatchObject({
      status: "not_measured",
      missing: [{ reading: "hair", reason: "not_captured" }],
    });
    expect(Object.keys(twin.metrics).some((id) => id.startsWith("face."))).toBe(false);
  });

  it("a failed Fitzpatrick read leaves colouring partial, not empty", async () => {
    const { h } = setup();
    scriptHappy(h);
    h.fake.respondWith("fitzpatrick-scale-analyzer", { failWith: "error_no_face" });
    await h.start(buildTwinGraph(await capture(h)));
    await h.settle();
    const twin = Twin.parse(await h.ports.state.get(twinPath(h.userId)));
    expect(twin.groups.colouring.status).toBe("partial");
    expect(twin.groups.colouring.missing.map((m) => m.reading)).toEqual(["skin_tone_band"]);
    expect(twin.metrics["colour.skin"]).toBeDefined();
    expect(twin.metrics["colour.fitzpatrick_band"]).toBeUndefined();
  });

  it("a failed colour engine call is a missing colour reading, with the engine's reason", async () => {
    const engine = new FakeEngine();
    engine.failColour = { code: "engine_unreachable", retryable: true };
    const { h } = setup({ engine });
    scriptHappy(h);
    await h.start(buildTwinGraph(await capture(h)));
    await h.settle();
    const twin = Twin.parse(await h.ports.state.get(twinPath(h.userId)));
    expect(twin.groups.colouring.status).toBe("partial");
    expect(twin.groups.colouring.missing).toContainEqual(
      expect.objectContaining({ reading: "colour" }),
    );
    expect(twin.metrics["colour.fitzpatrick_band"]).toBeDefined();
  });

  it("if every analyser fails the run fails and no profile is written", async () => {
    const { h } = setup();
    for (const f of [
      "skin-analysis",
      "skin-tone-analysis",
      "fitzpatrick-scale-analyzer",
      "face-attr-analysis",
    ]) {
      h.fake.respondWith(f, { failWith: "error_no_face" });
    }
    const runId = await h.start(buildTwinGraph(await capture(h)));
    await h.settle();
    expect((await h.run(runId)).status).toBe("failed");
    expect((await h.nodes(runId)).write?.error?.code).toBe("nothing_measured");
    expect(await h.ports.state.get(twinPath(h.userId))).toBeUndefined();
  });

  it("a rebuild that reads nothing does not wipe an existing profile", async () => {
    const { h } = setup();
    scriptHappy(h);
    await h.start(buildTwinGraph(await capture(h)));
    await h.settle();
    const first = Twin.parse(await h.ports.state.get(twinPath(h.userId)));

    for (const f of [
      "skin-analysis",
      "skin-tone-analysis",
      "fitzpatrick-scale-analyzer",
      "face-attr-analysis",
    ]) {
      h.fake.respondWith(f, { failWith: "error_no_face" });
    }
    await h.clock.advance(60_000);
    await h.start(buildTwinGraph(await capture(h)));
    await h.settle();
    expect(Twin.parse(await h.ports.state.get(twinPath(h.userId)))).toEqual(first);
  });

  it("a dropped repeat means fewer captures, and one capture is no estimate", async () => {
    const { h, engine } = setup();
    scriptHappy(h);
    const cap = await capture(h, { repeats: [await upload(h, "r1")] });
    const runId = await h.start(buildTwinGraph(cap), { removed: ["skin-r1"] });
    await h.settle();
    expect((await h.run(runId)).status).toBe("succeeded");
    const twin = Twin.parse(await h.ports.state.get(twinPath(h.userId)));
    expect(twin.noiseFloors).toEqual({});
    expect(engine.noiseCalls).toEqual([]);
  });

  it("a retry of the face group keeps the rest of the existing profile", async () => {
    const { h } = setup();
    scriptHappy(h);
    h.fake.script("face-attr-analysis", { failWith: "error_face_too_small" });
    await h.start(buildTwinGraph(await capture(h)));
    await h.settle();
    const first = Twin.parse(await h.ports.state.get(twinPath(h.userId)));
    expect(first.groups.face.status).toBe("not_measured");

    await h.clock.advance(60_000);
    const retryRun = await h.start(buildTwinGraph(await capture(h, { only: ["face"] })));
    await h.settle();
    const second = Twin.parse(await h.ports.state.get(twinPath(h.userId)));
    expect(second.groups.face.status).toBe("measured");
    expect(second.metrics["skin.hd_pore.whole"]).toEqual(first.metrics["skin.hd_pore.whole"]);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.runIds).toHaveLength(2);
    expect(second.runIds[1]).toBe(retryRun);
  });

  it("deletes every uploaded image at the end of the run", async () => {
    const { h } = setup();
    scriptHappy(h);
    const cap = await capture(h, {
      repeats: [await upload(h, "r1")],
      hair: { front: await upload(h, "hf") },
    });
    expect(await h.ports.blobs.list("uploads/")).toHaveLength(3);
    const runId = await h.start(buildTwinGraph(cap));
    await h.settle();
    expect((await h.run(runId)).cleanedAt).toBeDefined();
    expect(await h.ports.blobs.list("uploads/")).toEqual([]);
    expect(await h.ports.blobs.list("runs/")).toEqual([]);
    // Nothing a person looks like is in the stored profile either.
    const stored = JSON.stringify(await h.ports.state.get(twinPath(h.userId)));
    expect(stored).not.toMatch(/uploads\/|blob:|https?:/);
  });

  it("a skin colour that comes back unusable is a missing reading, not a measured group", async () => {
    const { h } = setup();
    scriptHappy(h);
    h.fake.respondWith("skin-tone-analysis", {
      results: { color: { skin_color: "not-a-hex", lip_color: "#A5504F" } },
    });
    await h.start(buildTwinGraph(await capture(h)));
    await h.settle();
    const twin = Twin.parse(await h.ports.state.get(twinPath(h.userId)));
    expect(twin.groups.colouring.status).toBe("partial");
    expect(twin.groups.colouring.missing).toContainEqual({
      reading: "skin_colour",
      reason: "not_returned",
    });
    expect(twin.metrics["colour.skin"]).toBeUndefined();
    expect(twin.metrics["colour.lip"]).toBeDefined();
  });

  it("a rebuild whose skin failed keeps the old readings with their spread and capture details", async () => {
    const { h } = setup();
    scriptHappy(h);
    const first = await capture(h, {
      repeats: [await upload(h, "r1"), await upload(h, "r2")],
    });
    await h.start(buildTwinGraph(first));
    await h.settle();
    const before = Twin.parse(await h.ports.state.get(twinPath(h.userId)));
    expect(Object.keys(before.noiseFloors).length).toBeGreaterThan(0);
    expect(before.captureMeta).toMatchObject({ mode: "hd", source: "camera", repeatsCaptured: 2 });

    // A second capture, standard detail from an upload, where every skin analysis fails.
    h.fake.respondWith("skin-analysis", { failWith: "error_no_face" });
    await h.clock.advance(60_000);
    const second = await capture(h, {
      mode: "sd",
      source: "upload",
      qualityChecksPassed: null,
      repeats: [await upload(h, "r3")],
    });
    await h.start(buildTwinGraph(second));
    await h.settle();
    const after = Twin.parse(await h.ports.state.get(twinPath(h.userId)));
    expect(after.metrics["skin.hd_pore.whole"]).toEqual(before.metrics["skin.hd_pore.whole"]);
    expect(after.noiseFloors).toEqual(before.noiseFloors);
    expect(after.captureMeta).toEqual(before.captureMeta);
  });

  it("counts the repeats that succeeded, not the ones planned", async () => {
    const { h } = setup();
    scriptHappy(h);
    const cap = await capture(h, { repeats: [await upload(h, "r1"), await upload(h, "r2")] });
    // The main photo and the first repeat succeed; the second repeat fails.
    h.fake.script("skin-analysis", { latencyMs: 1_000, results: skinItems() });
    h.fake.script("skin-analysis", { latencyMs: 1_000, results: skinItems(2) });
    h.fake.script("skin-analysis", { failWith: "error_no_face" });
    await h.start(buildTwinGraph(cap));
    await h.settle();
    const twin = Twin.parse(await h.ports.state.get(twinPath(h.userId)));
    expect(twin.captureMeta.repeatsCaptured).toBe(1);
    expect(Object.values(twin.noiseFloors)[0]?.capturesPerSession).toBe(2);
  });
});
