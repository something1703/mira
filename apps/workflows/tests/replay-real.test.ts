import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FakeClock, createMockPorts } from "@mira/runtime";
import { RECORDED_DIR, fixtureDownloader, loadFixtures } from "@mira/fixtures";
import { ReplayYouCam } from "@mira/youcam-client";
import { describe, expect, it } from "vitest";
import { createEngine } from "../src/engine";
import { buildQuote } from "../src/quote";
import { youcam } from "./harness";

/**
 * Mock mode replaying the first real recording (2026-11-01): a background-removal task that cost
 * 1 unit on YouCam. No network is used. The replayed run must look like the live one did: the
 * same price, the same answer, the result image copied out of the run and deleted afterwards.
 */
const loaded = loadFixtures();
const REAL = join(RECORDED_DIR, "sod", "files", "3b8e90a7d3a541b8.png");

function setup() {
  const clock = new FakeClock();
  const ports = createMockPorts({ clock });
  const api = new ReplayYouCam({ clock, fixtures: loaded.fixtures, skus: loaded.skus });
  const engine = createEngine({
    ports,
    api,
    engineVersion: "replay",
    download: fixtureDownloader(),
  });
  return { clock, ports, api, engine };
}

const input = new TextEncoder().encode(
  "any bytes: the recording is matched on the request, not the photo",
);

describe("replaying the real recording", () => {
  it("there is a real recording to replay", () => {
    expect(loaded.fixtures.map((f) => `${f.feature}/${f.name}`)).toContain(
      "sod/synthetic-garment-probe-1",
    );
    expect(loaded.fixtures[0]?.unitsCharged).toBe(1);
  });

  it("a background-removal run is quoted at the recorded price and returns YouCam's own image", async () => {
    const { clock, ports, engine } = setup();
    await ports.blobs.put("runs/in/photo.png", input, "image/png");
    const graph = {
      type: "demo" as const,
      nodes: [youcam("cut", "sod", { inputs: { src: "blob:runs/in/photo.png" } })],
    };
    const quote = await buildQuote({
      graph,
      sessionId: "ses_replay0001",
      costs: engine.costs,
      ledger: engine.ledger,
      now: () => clock.now(),
    });
    expect(quote).toMatchObject({ ok: true, value: { total: 1, overCap: false } });
    if (!quote.ok) throw new Error("quote");

    const seen: { bytes?: Uint8Array | undefined } = {};
    ports.events.subscribe("run-events", async (e) => {
      const ev = e as { type: string; runId: string; nodeId?: string };
      if (ev.type !== "node_done") return;
      const node = (await ports.state.get(`runs/${ev.runId}/nodes/${ev.nodeId ?? ""}`)) as {
        resultRef?: string;
      };
      seen.bytes = node.resultRef ? (await ports.blobs.get(node.resultRef))?.bytes : undefined;
    });
    const started = await engine.runner.startRun({
      graph,
      userId: "usr_replay0001",
      sessionId: "ses_replay0001",
      planId: "plan_replay001",
      quote: quote.value,
      recorded: true,
    });
    if (!started.ok) throw new Error("start");
    // The run keeps its preview for a review window before cleanup, so wait past it.
    for (let i = 0; i < 800; i++) {
      await ports.queue.tick();
      if (ports.queue.snapshot().length === 0) break;
      await clock.advance(1_000);
    }

    const run = (await ports.state.get(`runs/${started.value.id}`)) as {
      status: string;
      unitsSpent: number;
      recorded: boolean;
      cleanedAt?: string;
    };
    expect(run).toMatchObject({ status: "succeeded", unitsSpent: 1, recorded: true });
    expect(run.cleanedAt).toBeDefined();
    // Byte for byte what YouCam returned, read from the run's storage at the moment it finished.
    expect(Buffer.from(seen.bytes ?? new Uint8Array()).equals(readFileSync(REAL))).toBe(true);
    expect(
      Buffer.from(seen.bytes ?? new Uint8Array())
        .subarray(0, 8)
        .toString("hex"),
    ).toBe("89504e470d0a1a0a");
    // And deleted when the run ended, like any other image.
    expect(await ports.blobs.list(`runs/${started.value.id}/`)).toEqual([]);
  });

  it("a request nobody recorded fails as 'no recording' and costs nothing, rather than inventing a result", async () => {
    const { clock, ports, engine } = setup();
    await ports.blobs.put("runs/in/photo.png", input, "image/png");
    const graph = {
      type: "demo" as const,
      nodes: [youcam("tone", "skin-tone-analysis", { inputs: { src: "blob:runs/in/photo.png" } })],
    };
    const started = await engine.runner.startRun({
      graph,
      userId: "usr_replay0001",
      sessionId: "ses_replay0001",
      planId: "plan_replay001",
      quote: {
        lines: [],
        total: 0,
        sessionUnitsLeft: 200,
        overCap: false,
        pricing: { source: "recorded", pricedAt: "2026-11-01T10:00:00.000Z" },
      },
      recorded: true,
    });
    if (!started.ok) throw new Error("start");
    for (let i = 0; i < 20; i++) {
      await ports.queue.tick();
      await clock.advance(1_000);
    }
    const node = (await ports.state.get(`runs/${started.value.id}/nodes/tone`)) as {
      status: string;
      error?: { code: string; unitsCharged: number };
    };
    expect(node.status).toBe("failed");
    expect(node.error).toMatchObject({ code: "no_recording", unitsCharged: 0 });
  });
});
