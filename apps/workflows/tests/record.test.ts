import { ReplayYouCam } from "@mira/youcam-client";
import { describe, expect, it } from "vitest";
import { RecordingApi, parseRecordArgs, recordGraph, toFixture } from "../src/tools/record";
import { buildQuote } from "../src/quote";
import { makeHarness } from "./harness";

const SIGNED =
  "https://yce-us.s3.amazonaws.com/ttl30/r/out.png?X-Amz-Signature=abc&X-Amz-Expires=7200";

describe("recording through the lifecycle", () => {
  it("captures a real-shaped run, scrubs the signed URL, and replays it to the same answer", async () => {
    const h = makeHarness();
    h.fake.respondWith("makeup-vto", { latencyMs: 3_000, results: { url: SIGNED } });
    const recorder = new RecordingApi(h.fake, () => h.clock.now());
    // Build the engine over the recorder: same ports, same fake, recording in between.
    const { createEngine } = await import("../src/engine");
    const engine = createEngine({
      ports: h.ports,
      api: recorder,
      engineVersion: "t",
      download: () =>
        Promise.resolve({
          ok: true as const,
          value: { bytes: new Uint8Array([1]), contentType: "image/png" },
        }),
    });

    const args = parseRecordArgs([
      "makeup-vto",
      "--input",
      "face.jpg",
      "--params",
      JSON.stringify({
        effects: [
          {
            category: "foundation",
            palettes: [
              { color: "#C79A78", colorIntensity: 60, glowIntensity: 30, coverageIntensity: 40 },
            ],
          },
        ],
      }),
      "--name",
      "foundation-1",
    ]);
    if (!args.ok) throw new Error(args.error);
    const photo = await h.photo("face");
    const graph = recordGraph(args.value, photo.slice("blob:".length));

    const quote = await buildQuote({
      graph,
      sessionId: h.sessionId,
      costs: engine.costs,
      ledger: engine.ledger,
      now: () => h.clock.now(),
    });
    expect(quote).toMatchObject({ ok: true, value: { total: 1 } });
    if (!quote.ok) throw new Error("quote");
    const started = await engine.runner.startRun({
      graph,
      userId: h.userId,
      sessionId: h.sessionId,
      planId: "plan_aaaaaa",
      quote: quote.value,
      recorded: false,
    });
    if (!started.ok) throw new Error("start");
    for (let i = 0; i < 60; i++) {
      await h.ports.queue.tick();
      await h.clock.advance(1_000);
    }

    const [cap] = [...recorder.captures.values()];
    if (!cap) throw new Error("nothing captured");
    const { fixture, urls } = toFixture(cap, {
      name: "foundation-1",
      unitsCharged: 1,
      recordedAt: "2026-11-01T12:00:00.000Z",
    });
    expect(JSON.stringify(fixture)).not.toContain("X-Amz");
    expect(Object.values(urls)).toEqual([SIGNED]);
    expect(fixture).toMatchObject({
      feature: "makeup-vto",
      latencyMs: expect.any(Number) as number,
      unitsCharged: 1,
    });
    // The input photo is not in the fixture, and neither is its file id.
    expect(JSON.stringify(fixture)).not.toContain("fake_file");

    // A replay client answers the same request with the recorded (scrubbed) result.
    const replay = new ReplayYouCam({
      clock: h.clock,
      fixtures: [fixture],
      skus: [{ slug: "makeup-vto", amount: 1 }],
    });
    const created = await replay.createTask(
      { slug: "makeup-vto" },
      { ...cap.body, src_file_id: "any-other-file" },
    );
    expect(created.ok).toBe(true);
  });

  it("a recorded failure keeps YouCam's code and charges nothing", async () => {
    const h = makeHarness();
    h.fake.respondWith("skin-tone-analysis", { failWith: "error_lighting_dark", latencyMs: 1_000 });
    const recorder = new RecordingApi(h.fake, () => h.clock.now());
    const created = await recorder.createTask({ slug: "skin-tone-analysis", version: "v2.0" }, {});
    if (!created.ok) throw new Error("setup");
    await h.clock.advance(2_000);
    await recorder.getTask({ slug: "skin-tone-analysis", version: "v2.0" }, created.value.taskId);
    const cap = recorder.captures.get(created.value.taskId);
    if (!cap) throw new Error("setup");
    const { fixture } = toFixture(cap, {
      name: "dark",
      unitsCharged: 20,
      recordedAt: "2026-11-01T12:00:00.000Z",
    });
    expect(fixture.outcome).toMatchObject({ status: "error", error: "error_lighting_dark" });
    expect(fixture.unitsCharged).toBe(0);
  });

  it("refuses to turn an unfinished task into a fixture", () => {
    expect(() =>
      toFixture(
        { feature: { slug: "sod", version: "v2.0" }, body: {}, createdAt: 0 },
        { name: "x", unitsCharged: 1, recordedAt: "2026-11-01T12:00:00.000Z" },
      ),
    ).toThrow("never finished");
  });
});

describe("parseRecordArgs", () => {
  it("needs a known feature, an input and valid JSON params", () => {
    expect(parseRecordArgs([])).toMatchObject({ ok: false });
    expect(parseRecordArgs(["nope", "--input", "a.jpg"])).toMatchObject({ ok: false });
    expect(parseRecordArgs(["sod"])).toMatchObject({
      ok: false,
      error: expect.stringContaining("--input") as string,
    });
    expect(parseRecordArgs(["sod", "--input", "a.jpg", "--params", "{bad"])).toMatchObject({
      ok: false,
      error: "--params must be JSON",
    });
    expect(
      parseRecordArgs([
        "cloth-v4",
        "--input",
        "a.jpg",
        "--ref",
        "g.jpg",
        "--params",
        '{"category":"auto"}',
      ]),
    ).toMatchObject({
      ok: true,
      value: {
        feature: "cloth-v4",
        name: "recording-1",
        ref: "g.jpg",
        params: { category: "auto" },
      },
    });
  });

  it("builds a clothes graph with both inputs and a one-input graph otherwise", () => {
    const a = parseRecordArgs(["cloth-v4", "--input", "a.jpg", "--ref", "g.jpg"]);
    if (!a.ok) throw new Error("args");
    expect(recordGraph(a.value, "runs/x/a.jpg", "runs/x/g.jpg").nodes[0]?.inputs).toEqual({
      src: "blob:runs/x/a.jpg",
      ref: "blob:runs/x/g.jpg",
    });
    const b = parseRecordArgs(["sod", "--input", "a.jpg"]);
    if (!b.ok) throw new Error("args");
    expect(recordGraph(b.value, "runs/x/a.jpg").nodes[0]?.inputs).toEqual({
      src: "blob:runs/x/a.jpg",
    });
  });
});
