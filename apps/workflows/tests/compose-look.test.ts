import { FakeClock, createMockPorts } from "@mira/runtime";
import { GarmentItem, LookResult, newId, type Twin } from "@mira/schemas";
import { FEATURES } from "@mira/youcam-client";
import { FakeYouCam } from "@mira/youcam-client/testing";
import { describe, expect, it } from "vitest";
import {
  buildComposeLookGraph,
  createLookExecutors,
  type LookInput,
} from "../src/graphs/compose-look";
import { FakeEngine } from "./fake-engine";
import { makeHarness } from "./harness";

const garment = (kind: "outfit" | "shoes" | "bag", n: number): GarmentItem =>
  GarmentItem.parse({
    id: `gar_test${String(n).padStart(6, "0")}`,
    name: `Test ${kind}`,
    kind,
    category: kind === "shoes" ? "shoes" : kind === "bag" ? "auto" : "full_body",
    image: `uploads/usr_x/up_${kind}.png`,
    colour: {
      lab: [40, 45, 20],
      hex: "#9E1F2D",
      auditLabs: [[40, 45, 20]],
      multicolour: false,
      share: 0.9,
    },
    source: { kind: "sample" },
    sample: true,
  });

const FULL: Omit<LookInput, "userId" | "photo"> = {
  outfit: garment("outfit", 1),
  shoes: garment("shoes", 2),
  bag: { item: garment("bag", 3), gender: "female" },
  makeup: { lipHex: "#B5566A", lipLab: [45, 35, 10], blushHex: "#E0907C" },
  hair: { hex: "#2B1D14" },
  venue: { type: "prompt", prompt: "a marigold-lit garden at dusk" },
  video: { resolution: "480", durationSec: 5 },
};

const PRICES = {
  "cloth-v4": 2,
  bag: 2,
  "makeup-vto": 1,
  "skin-tone-analysis": 20,
  "hair-color": 1,
  "face-attr-analysis": 10,
  "bg-replace": 4,
};
const SKUS = [
  ...Object.entries(PRICES).map(([slug, amount]) => ({
    slug,
    amount,
    unit: "result_image" as const,
  })),
  {
    slug: "image-to-video/youcam",
    amount: 1,
    unit: "second" as const,
    description: "AI Video Generator (Image to Video) V2.0 (480p)",
  },
];

function twinWithRatios(userId: string): Twin {
  const at = "2026-11-01T09:00:00.000Z";
  return {
    userId,
    createdAt: at,
    updatedAt: at,
    metrics: {},
    groups: {
      skin: { status: "measured", missing: [], at },
      colouring: { status: "measured", missing: [], at },
      face: { status: "measured", missing: [], at },
      hair: { status: "measured", missing: [], at },
    },
    faceRatios: { face_aspect_ratio: [1.31], horizontal_third: [0.33, 0.34, 0.33] },
    noiseFloors: {},
    captureMeta: { mode: "hd", source: "camera", repeatsCaptured: 0, qualityChecksPassed: true },
    runIds: [],
    synthetic: false,
  };
}

function setup() {
  const engine = new FakeEngine();
  engine.labFor = (hex) => (hex === "#B5566A" ? [45, 35, 10] : [44, 34, 11]);
  const clock = new FakeClock();
  const ports = createMockPorts({ clock });
  const fake = new FakeYouCam({ clock, prices: PRICES, skus: SKUS, startingUnits: 1000 });
  for (const f of ["cloth-v4", "bag", "makeup-vto", "hair-color", "bg-replace"] as const) {
    fake.respondWith(f, { latencyMs: 2_000 });
  }
  fake.respondWith("skin-tone-analysis", {
    latencyMs: 1_000,
    results: { color: { lip_color: "#B35468" } },
  });
  fake.respondWith("face-attr-analysis", {
    latencyMs: 1_000,
    results: { facialratio: { face_aspect_ratio: [1.31], horizontal_third: [0.33, 0.34, 0.33] } },
  });
  fake.respondWith("image-to-video/youcam", { latencyMs: 4_000 });
  const h = makeHarness({
    fake,
    ports,
    clock,
    executors: createLookExecutors({ engine, ports, synthetic: false }),
  });
  return { h, engine, fake, ports };
}

async function prepare(t: ReturnType<typeof setup>, over: Partial<LookInput> = {}) {
  const photo = `uploads/${t.h.userId}/up_body.jpg`;
  await t.ports.blobs.put(photo, new Uint8Array([255, 216, 255, 224, 9]), "image/jpeg");
  for (const kind of ["outfit", "shoes", "bag"]) {
    await t.ports.blobs.put(
      `uploads/usr_x/up_${kind}.png`,
      new Uint8Array([137, 80, 78, 71]),
      "image/png",
    );
  }
  await t.ports.state.set(`twins/${t.h.userId}`, twinWithRatios(t.h.userId));
  return { ...FULL, ...over, userId: t.h.userId, photo } satisfies LookInput;
}

async function runLook(t: ReturnType<typeof setup>, over: Partial<LookInput> = {}) {
  const graph = buildComposeLookGraph(await prepare(t, over));
  const runId = await t.h.start(graph);
  await t.h.settle();
  const nodes = await t.h.nodes(runId);
  const result = nodes.assemble?.output ? LookResult.parse(nodes.assemble.output) : undefined;
  return { runId, nodes, result, run: await t.h.run(runId) };
}

describe("the graph", () => {
  const input = (over: Partial<LookInput> = {}): LookInput => ({
    ...FULL,
    userId: "usr_x",
    photo: "uploads/usr_x/up_body.jpg",
    ...over,
  });

  it("chains the steps in the documented order, each on the one before", () => {
    const g = buildComposeLookGraph(input());
    expect(g.type).toBe("compose_look");
    const youcam = g.nodes.filter((n) => n.kind === "youcam").map((n) => n.id);
    expect(youcam).toEqual([
      "outfit",
      "shoes",
      "bag",
      "makeup",
      "measure-lip",
      "hair",
      "identity",
      "venue",
      "video",
    ]);
    const src = (id: string) => g.nodes.find((n) => n.id === id)?.inputs?.src;
    expect(src("outfit")).toBe("blob:uploads/usr_x/up_body.jpg");
    expect(src("shoes")).toBe("node:outfit");
    expect(src("bag")).toBe("node:shoes");
    expect(src("makeup")).toBe("node:bag");
    expect(src("hair")).toBe("node:makeup");
    expect(src("identity")).toBe("node:hair");
    expect(src("venue")).toBe("node:hair");
    expect(src("video")).toBe("node:venue");
  });

  it("leaves a step out without breaking the chain", () => {
    const g = buildComposeLookGraph(input({ shoes: undefined, hair: undefined }));
    const src = (id: string) => g.nodes.find((n) => n.id === id)?.inputs?.src;
    expect(g.nodes.some((n) => n.id === "shoes" || n.id === "hair")).toBe(false);
    expect(src("bag")).toBe("node:outfit");
    expect(src("identity")).toBe("node:makeup");
  });

  it("makes the video wait for the audits, and the venue for the face comparison", () => {
    const g = buildComposeLookGraph(input());
    const dep = (id: string) => g.nodes.find((n) => n.id === id)?.dependsOn;
    expect(dep("gate-video")).toEqual(["audit-outfit", "audit-lip", "gate-identity"]);
    expect(dep("video")).toEqual(["venue", "gate-video"]);
    expect(dep("venue")).toContain("gate-identity");
    expect(g.nodes.find((n) => n.id === "assemble")?.tolerant).toBe(true);
  });

  it("sends the makeup at zero smoothing, in the suggested lip and blush colours", () => {
    const g = buildComposeLookGraph(input());
    const feature = FEATURES["makeup-vto"];
    const params = feature.params.parse(g.nodes.find((n) => n.id === "makeup")?.params);
    const body = feature.buildBody(params, { src: { fileId: "f" } }) as {
      effects: { category: string; skinSmoothStrength?: number; palettes?: { color?: string }[] }[];
    };
    expect(body.effects[0]).toMatchObject({ category: "skin_smooth", skinSmoothStrength: 0 });
    expect(body.effects.map((e) => e.category)).toEqual(["skin_smooth", "lip_color", "blush"]);
    expect(body.effects[1]?.palettes?.[0]?.color).toBe("#B5566A");
  });

  it("every node's parameters are valid for its YouCam feature", () => {
    for (const n of buildComposeLookGraph(input()).nodes) {
      if (n.kind !== "youcam") continue;
      const feature = FEATURES[n.feature as keyof typeof FEATURES];
      expect(feature.params.safeParse(n.params ?? {}).success, n.id).toBe(true);
    }
  });
});

describe("a full look", () => {
  it("builds the whole chain, labels what was checked, and makes the video", async () => {
    const t = setup();
    const { run, result } = await runLook(t);
    expect(run.status).toBe("succeeded");
    expect(result).toBeDefined();
    const verdict = (id: string) => result?.steps.find((s) => s.id === id)?.verdict;
    expect(verdict("outfit")).toBe("verified");
    expect(verdict("makeup")).toBe("verified");
    // No check exists for these elements, and the label says so instead of implying one.
    for (const id of ["shoes", "bag", "hair", "venue"]) expect(verdict(id)).toBe("unchecked");
    expect(result?.identity.verdict).toBe("verified");
    expect(result?.plate).toBe("venue");
    expect(result?.video).toMatchObject({ status: "done", node: "video" });
    expect(result?.withheld).toEqual([]);
    expect(result?.thresholds).toMatchObject({ garmentDe: 6, lipDe: 3, identityMax: 0.08 });
  });

  it("compares the render's lip colour with the one asked for", async () => {
    const t = setup();
    await runLook(t);
    expect(t.engine.lookCalls).toEqual(
      expect.arrayContaining(["audit-garment", "audit-lip", "audit-identity"]),
    );
  });
});

describe("drift", () => {
  it("garment drift: labelled, kept, and the video is not made", async () => {
    const t = setup();
    t.engine.garmentAudit = { label: "drift", de: 9.1, direction: "lighter", reason: "ok" };
    const { result, nodes } = await runLook(t);
    const outfit = result?.steps.find((s) => s.id === "outfit");
    expect(outfit).toMatchObject({ verdict: "drift", de: 9.1, direction: "lighter" });
    expect(result?.plate).toBe("venue");
    expect(result?.video).toMatchObject({ status: "skipped", reason: "audit_not_passed" });
    expect(nodes.video?.status).toBe("skipped");
    // The video was never submitted: no units were spent on it.
    expect(
      t.fake.calls.filter((c) => c.op === "createTask" && c.detail?.includes("image-to-video")),
    ).toEqual([]);
  });

  it("lip drift: labelled with the measured difference, and no video", async () => {
    const t = setup();
    t.engine.lipAudit = { label: "drift", de: 5.2 };
    const { result } = await runLook(t);
    expect(result?.steps.find((s) => s.id === "makeup")).toMatchObject({
      verdict: "drift",
      de: 5.2,
    });
    expect(result?.video?.status).toBe("skipped");
  });

  it("a garment check that could not tell is 'not checked', never 'verified', and blocks the video", async () => {
    const t = setup();
    t.engine.garmentAudit = {
      label: "not_checked",
      de: null,
      direction: null,
      reason: "torso_unchanged",
    };
    const { result } = await runLook(t);
    expect(result?.steps.find((s) => s.id === "outfit")).toMatchObject({
      verdict: "not_checked",
      reason: "torso_unchanged",
    });
    expect(result?.video?.status).toBe("skipped");
  });

  it("an audit the engine could not run is 'not checked' and the chain carries on", async () => {
    const t = setup();
    t.engine.failLook = { code: "engine_unreachable", retryable: true };
    const { result, run } = await runLook(t);
    expect(result?.steps.find((s) => s.id === "outfit")?.verdict).toBe("not_checked");
    expect(result?.identity.verdict).toBe("not_checked");
    expect(result?.plate).toBe("venue");
    expect(run.status).toBe("partial");
    expect(result?.video?.status).toBe("skipped");
  });
});

describe("identity drift", () => {
  it("withholds every picture, shows no plate, and spends nothing on the venue or the video", async () => {
    const t = setup();
    t.engine.identity = { drift: 0.14, passed: false };
    const { result, nodes } = await runLook(t);
    expect(result?.identity).toMatchObject({ verdict: "withheld", drift: 0.14, max: 0.08 });
    expect(result?.plate).toBeUndefined();
    expect(result?.withheld).toEqual(["outfit", "shoes", "bag", "makeup", "hair", "venue"]);
    expect(result?.steps.every((s) => s.verdict === "withheld" || s.verdict === "skipped")).toBe(
      true,
    );
    expect(nodes.venue?.status).toBe("skipped");
    expect(nodes.video?.status).toBe("skipped");
  });
});

describe("partial results and cancellation", () => {
  it("a step that fails stops the steps after it and keeps the ones before", async () => {
    const t = setup();
    t.fake.script("hair-color", { failWith: "error_no_face" });
    const { result, run } = await runLook(t);
    expect(run.status).toBe("partial");
    expect(result?.steps.find((s) => s.id === "hair")).toMatchObject({ verdict: "failed" });
    // The face is compared on the last picture that exists, which no longer does: not checked.
    expect(result?.plate).toBe("makeup");
    expect(result?.identity.verdict).toBe("not_checked");
  });

  it("the outfit failing leaves nothing to show", async () => {
    const t = setup();
    t.fake.script("cloth-v4", { failWith: "error_no_face" });
    const { run, nodes } = await runLook(t);
    expect(run.status).not.toBe("succeeded");
    expect(nodes.assemble?.status).toBe("failed");
    expect(nodes.assemble?.error?.code).toBe("nothing_made");
  });

  it("cancelling mid-chain stops what has not started", async () => {
    const t = setup();
    const graph = buildComposeLookGraph(await prepare(t));
    const runId = await t.h.start(graph);
    await t.h.ports.queue.tick();
    await t.h.engine.runner.cancel(runId);
    await t.h.settle();
    const nodes = await t.h.nodes(runId);
    expect(nodes.video?.status).toBe("cancelled");
    expect(nodes.venue?.status).toBe("cancelled");
    expect((await t.h.run(runId)).status).toBe("cancelled");
  });
});

describe("ids", () => {
  it("garment ids are the shape the schema wants", () => {
    expect(newId("lk")).toMatch(/^lk_/);
    expect(FULL.outfit.id).toMatch(/^gar_/);
  });
});
