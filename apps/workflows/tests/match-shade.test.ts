import { FakeClock, createMockPorts } from "@mira/runtime";
import { ShadeResult, type PrerankedShade } from "@mira/schemas";
import { FEATURES } from "@mira/youcam-client";
import { FakeYouCam } from "@mira/youcam-client/testing";
import { describe, expect, it } from "vitest";
import {
  buildMatchShadeGraph,
  createShadeExecutors,
  stepsOfShade,
  type MatchShadeInput,
} from "../src/graphs/match-shade";
import type { LabTuple } from "../src/twin/engine-client";
import { FakeEngine } from "./fake-engine";
import { makeHarness } from "./harness";

const SKIN: LabTuple = [62, 14, 24];
const shade = (i: number, de: number): PrerankedShade => ({
  id: `s${String(i)}`,
  name: `Shade ${String(i)}`,
  hex: `#C0A0${String(i)}0`,
  lab: [60 + i, 14, 24],
  de,
  dLightness: i,
  dHue: 0,
  label: de <= 2 ? "blends_closely" : "close",
});

const input = (n = 3, over: Partial<MatchShadeInput> = {}): MatchShadeInput => ({
  rangeId: "sample-range",
  photo: "uploads/usr_x/up_face.jpg",
  skinLab: SKIN,
  shades: Array.from({ length: n }, (_, i) => shade(i + 1, 1 + i)),
  finish: "satin",
  finishReason: "no_skin_type",
  coverage: "light",
  coverageReason: "default_light",
  tZoneNote: false,
  checkedFree: 40,
  closestLabel: "blends_closely",
  concealerSuggested: false,
  concealer: false,
  ...over,
});

function setup() {
  const engine = new FakeEngine();
  // Each render's re-measured skin colour is a hex whose last digit tells the test which shade it is.
  engine.labFor = (hex) => [60 + Number(hex.at(-3) ?? 0), 14, 24];
  const clock = new FakeClock();
  const ports = createMockPorts({ clock });
  const fake = new FakeYouCam({
    clock,
    prices: { "makeup-vto": 1, "skin-tone-analysis": 20 },
    startingUnits: 1000,
  });
  const h = makeHarness({ fake, ports, clock, executors: createShadeExecutors({ engine }) });
  return { h, engine, fake };
}

async function photo(h: ReturnType<typeof makeHarness>): Promise<string> {
  const key = `uploads/${h.userId}/up_face.jpg`;
  await h.ports.blobs.put(key, new Uint8Array([255, 216, 255, 224, 5]), "image/jpeg");
  return key;
}

describe("buildMatchShadeGraph", () => {
  it("renders, re-measures and checks each shade, then ranks once", () => {
    const g = buildMatchShadeGraph(input(3));
    expect(g.type).toBe("match_shade");
    expect(g.nodes.map((n) => n.id)).toEqual([
      "render-1",
      "measure-1",
      "check-1",
      "render-2",
      "measure-2",
      "check-2",
      "render-3",
      "measure-3",
      "check-3",
      "assemble",
    ]);
    const measure = g.nodes.find((n) => n.id === "measure-2");
    expect(measure).toMatchObject({
      feature: "skin-tone-analysis",
      inputs: { src: "node:render-2" },
    });
    expect(g.nodes.find((n) => n.id === "assemble")).toMatchObject({ tolerant: true });
  });

  it("always renders the closest shade; the rest can be dropped", () => {
    const g = buildMatchShadeGraph(input(3));
    expect(g.nodes.filter((n) => n.optional).map((n) => n.id)).toEqual(
      stepsOfShade(1).concat(stepsOfShade(2)),
    );
    expect(g.nodes.find((n) => n.id === "render-1")?.optional).toBe(false);
  });

  it("asks for an unretouched foundation in the shade's colour, with the engine's finish and coverage", () => {
    const g = buildMatchShadeGraph(input(1, { finish: "dewy", coverage: "medium" }));
    const render = g.nodes.find((n) => n.id === "render-1");
    const feature = FEATURES["makeup-vto"];
    const params = feature.params.parse(render?.params);
    const body = feature.buildBody(params, { src: { fileId: "file_1" } }) as {
      effects: {
        category: string;
        skinSmoothStrength?: number;
        palettes?: Record<string, unknown>[];
      }[];
    };
    // Smoothing is sent, at zero: without it YouCam smooths at 50 (F1).
    expect(body.effects[0]).toMatchObject({ category: "skin_smooth", skinSmoothStrength: 0 });
    expect(body.effects[1]?.palettes?.[0]).toMatchObject({
      color: "#C0A010",
      glowIntensity: 65,
      coverageIntensity: 60,
    });
  });
});

describe("the concealer pass", () => {
  it("adds a concealer in the shade's colour to the same unretouched request, and says so in the result", () => {
    const g = buildMatchShadeGraph(input(1, { concealer: true, concealerSuggested: true }));
    const feature = FEATURES["makeup-vto"];
    const params = feature.params.parse(g.nodes.find((n) => n.id === "render-1")?.params);
    const body = feature.buildBody(params, { src: { fileId: "file_1" } }) as {
      effects: {
        category: string;
        palettes?: Record<string, unknown>[];
        skinSmoothStrength?: number;
      }[];
    };
    expect(body.effects.map((e) => e.category)).toEqual(["skin_smooth", "foundation", "concealer"]);
    expect(body.effects[0]?.skinSmoothStrength).toBe(0);
    expect(body.effects[2]?.palettes?.[0]).toMatchObject({
      color: "#C0A010",
      colorIntensity: 60,
      colorUnderEyeIntensity: 50,
      coverageLevel: 50,
    });
    expect(g.nodes.find((n) => n.id === "assemble")?.params).toMatchObject({ concealer: true });
  });

  it("is off by default", () => {
    const g = buildMatchShadeGraph(input(1));
    const feature = FEATURES["makeup-vto"];
    const params = feature.params.parse(g.nodes.find((n) => n.id === "render-1")?.params);
    const body = feature.buildBody(params, { src: { fileId: "f" } }) as {
      effects: { category: string }[];
    };
    expect(body.effects.map((e) => e.category)).toEqual(["skin_smooth", "foundation"]);
  });
});

describe("Match Shade run", () => {
  const start = async (n = 3, over: Partial<MatchShadeInput> = {}, extra = {}) => {
    const t = setup();
    t.fake.respondWith("makeup-vto", { latencyMs: 3_000 });
    // The re-measure reads the render; each render's answer is the next scripted tone.
    const tones = Array.from({ length: n }, (_, i) => `#C0A0${String(i + 1)}0`);
    for (const hex of tones) {
      t.fake.script("skin-tone-analysis", { results: { color: { skin_color: hex } } });
    }
    const runId = await t.h.start(
      buildMatchShadeGraph({ ...input(n, over), photo: await photo(t.h) }),
      extra,
    );
    await t.h.settle();
    const nodes = await t.h.nodes(runId);
    const result = nodes.assemble?.output ? ShadeResult.parse(nodes.assemble.output) : undefined;
    return { ...t, runId, nodes, result };
  };

  it("happy path: three renders, the lowest blend is the best match, 63 units", async () => {
    const t = setup();
    t.fake.respondWith("makeup-vto", { latencyMs: 3_000 });
    const blends = [2.4, 0.9, 1.7];
    let call = 0;
    t.engine.closedLoopFor = () => {
      const blend = blends[call] ?? 3;
      call += 1;
      return {
        blend_de: blend,
        direction_ok: true,
        label: blend <= 2 ? "blends_closely" : "close",
      };
    };
    for (let i = 1; i <= 3; i++) {
      t.fake.script("skin-tone-analysis", {
        results: { color: { skin_color: `#C0A0${String(i)}0` } },
      });
    }
    const runId = await t.h.start(buildMatchShadeGraph({ ...input(3), photo: await photo(t.h) }));
    await t.h.settle();
    const run = await t.h.run(runId);
    expect(run).toMatchObject({ status: "succeeded", unitsSpent: 63 });
    const result = ShadeResult.parse((await t.h.nodes(runId)).assemble?.output);
    expect(result.outcomes.map((o) => o.verdict)).toEqual(["verified", "verified", "verified"]);
    expect(result.outcomes.map((o) => o.blendDe)).toEqual([0.9, 1.7, 2.4]);
    expect(result.bestShadeId).toBe(result.outcomes[0]?.shadeId);
    expect(result.noClosePick).toBe(false);
    expect(result.checkedFree).toBe(40);
    expect(result.thresholds).toEqual({ matchDe: 2, closeDe: 3.5, calibrated: false });
  });

  it("the check compares the re-measured render with the skin and the shade", async () => {
    const { engine } = await start(1);
    expect(engine.closedLoopCalls).toHaveLength(1);
    expect(engine.closedLoopCalls[0]).toMatchObject({ skin: SKIN, shade: [61, 14, 24] });
  });

  it("one render fails: its row says why, the others still rank, and the run is partial", async () => {
    const t = setup();
    t.fake.script("makeup-vto", { failWith: "error_no_face" });
    t.fake.respondWith("makeup-vto", { latencyMs: 3_000 });
    t.fake.respondWith("skin-tone-analysis", { results: { color: { skin_color: "#C0A010" } } });
    const runId = await t.h.start(buildMatchShadeGraph({ ...input(3), photo: await photo(t.h) }));
    await t.h.settle();
    expect((await t.h.run(runId)).status).toBe("partial");
    const result = ShadeResult.parse((await t.h.nodes(runId)).assemble?.output);
    const failed = result.outcomes.filter((o) => o.verdict === "failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ reason: "no_face", shadeId: "s1" });
    expect(result.outcomes.at(-1)?.verdict).toBe("failed");
    expect(result.outcomes.filter((o) => o.verdict === "verified")).toHaveLength(2);
    // A failed render costs nothing: 2 shades measured, 21 units each.
    expect((await t.h.run(runId)).unitsSpent).toBe(42);
  });

  it("a render that moved the wrong way is a drift: shown, never the best match", async () => {
    const t = setup();
    t.fake.respondWith("makeup-vto", { latencyMs: 3_000 });
    t.fake.respondWith("skin-tone-analysis", { results: { color: { skin_color: "#C0A010" } } });
    let n = 0;
    t.engine.closedLoopFor = () => {
      n += 1;
      // The first render has the smallest blend but the wrong direction.
      return n === 1
        ? { blend_de: 0.3, direction_ok: false, label: "blends_closely" }
        : { blend_de: 1.8, direction_ok: true, label: "blends_closely" };
    };
    const runId = await t.h.start(buildMatchShadeGraph({ ...input(2), photo: await photo(t.h) }));
    await t.h.settle();
    const result = ShadeResult.parse((await t.h.nodes(runId)).assemble?.output);
    expect(result.outcomes.map((o) => o.verdict)).toEqual(["verified", "drift"]);
    expect(result.bestShadeId).toBe(result.outcomes[0]?.shadeId);
    expect(result.bestShadeId).not.toBe("s1");
  });

  it("no shade blends closely: the closest is still shown, with no best match", async () => {
    const t = setup();
    t.fake.respondWith("makeup-vto", { latencyMs: 3_000 });
    t.fake.respondWith("skin-tone-analysis", { results: { color: { skin_color: "#C0A010" } } });
    t.engine.closedLoopFor = () => ({ blend_de: 7.4, direction_ok: true, label: "not_close" });
    const runId = await t.h.start(
      buildMatchShadeGraph({ ...input(2, { closestLabel: "lighter" }), photo: await photo(t.h) }),
    );
    await t.h.settle();
    const result = ShadeResult.parse((await t.h.nodes(runId)).assemble?.output);
    expect(result.noClosePick).toBe(true);
    expect(result.bestShadeId).toBeUndefined();
    expect(result.closestLabel).toBe("lighter");
    expect(result.outcomes[0]?.verdict).toBe("verified");
  });

  it("if every render fails the run fails and there is nothing to rank", async () => {
    const t = setup();
    t.fake.respondWith("makeup-vto", { failWith: "error_face_too_small" });
    const runId = await t.h.start(buildMatchShadeGraph({ ...input(2), photo: await photo(t.h) }));
    await t.h.settle();
    expect((await t.h.run(runId)).status).toBe("failed");
    expect((await t.h.nodes(runId)).assemble?.error?.code).toBe("nothing_measured");
    expect((await t.h.run(runId)).unitsSpent).toBe(0);
  });

  it("a shade dropped in the QuoteSheet is not rendered, measured or charged", async () => {
    const t = setup();
    t.fake.respondWith("makeup-vto", { latencyMs: 3_000 });
    t.fake.respondWith("skin-tone-analysis", { results: { color: { skin_color: "#C0A010" } } });
    const runId = await t.h.start(buildMatchShadeGraph({ ...input(3), photo: await photo(t.h) }), {
      removed: stepsOfShade(2),
    });
    await t.h.settle();
    const result = ShadeResult.parse((await t.h.nodes(runId)).assemble?.output);
    expect(result.outcomes.filter((o) => o.verdict === "verified")).toHaveLength(2);
    expect(result.outcomes.find((o) => o.reason === "not_rendered")).toBeDefined();
    expect((await t.h.run(runId)).unitsSpent).toBe(42);
  });

  it("the photo is deleted when the run's review window closes, previews until then", async () => {
    const t = setup();
    t.fake.respondWith("makeup-vto", { latencyMs: 3_000 });
    t.fake.respondWith("skin-tone-analysis", { results: { color: { skin_color: "#C0A010" } } });
    const key = await photo(t.h);
    const runId = await t.h.start(buildMatchShadeGraph({ ...input(1), photo: key }));
    for (let i = 0; i < 80; i++) {
      await t.h.ports.queue.tick();
      if ((await t.h.run(runId)).status !== "running") break;
      await t.h.clock.advance(1_000);
    }
    expect(await t.h.ports.blobs.get(key)).toBeUndefined();
    expect(await t.h.ports.blobs.list(`runs/${runId}/`)).not.toEqual([]);
    await t.h.settle();
    expect(await t.h.ports.blobs.list(`runs/${runId}/`)).toEqual([]);
  });
});
