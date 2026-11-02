import { FakeClock, createMockPorts, listDocs, type Ports } from "@mira/runtime";
import { newId, Run, RunNode, type Quote, type RunEvent } from "@mira/schemas";
import { FakeYouCam } from "@mira/youcam-client/testing";
import { createEngine, type Engine, type EngineOptions } from "../src/engine";
import type { GraphSpec, NodeSpec } from "../src/runner/graph";
import type { Downloader } from "../src/lifecycle/types";
import type { StartRunInput } from "../src/runner/runner";

export const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
export const JPG = new Uint8Array([255, 216, 255, 224, 1, 2, 3]);

export const EMPTY_QUOTE: Quote = {
  lines: [],
  total: 0,
  sessionUnitsLeft: 300,
  overCap: false,
  pricing: { source: "feature-cost", pricedAt: "2026-11-01T09:00:00.000Z" },
};

export interface Harness {
  clock: FakeClock;
  ports: Ports;
  fake: FakeYouCam;
  engine: Engine;
  events: RunEvent[];
  downloads: string[];
  sessionId: string;
  userId: string;
  /** Puts a face photo in blob storage and returns the `blob:` input spec. */
  photo(name: string, bytes?: Uint8Array): Promise<string>;
  start(graph: GraphSpec, extra?: Partial<StartRunInput>): Promise<string>;
  /** Delivers queued work, advancing the clock between rounds, until nothing is left. */
  settle(maxRounds?: number, stepMs?: number): Promise<void>;
  run(runId: string): Promise<Run>;
  nodes(runId: string): Promise<Record<string, RunNode>>;
}

export interface HarnessOptions extends Partial<
  Pick<EngineOptions, "audit" | "executors" | "caps">
> {
  prices?: Record<string, number>;
  startingUnits?: number;
  fake?: FakeYouCam;
  /** Replaces the downloader that copies result images, e.g. to make each render different. */
  download?: Downloader;
  ports?: Ports;
  clock?: FakeClock;
}

export function makeHarness(options: HarnessOptions = {}): Harness {
  const clock = options.clock ?? new FakeClock();
  const ports = options.ports ?? createMockPorts({ clock });
  const fake =
    options.fake ??
    new FakeYouCam({
      clock,
      prices: options.prices ?? {
        "skin-tone-analysis": 20,
        "makeup-vto": 1,
        "skin-analysis": 16,
        "cloth-v4": 2,
        sod: 1,
      },
      ...(options.startingUnits === undefined ? {} : { startingUnits: options.startingUnits }),
    });
  const events: RunEvent[] = [];
  ports.events.subscribe("run-events", (e) => {
    events.push(e as RunEvent);
  });
  const downloads: string[] = [];
  const engine = createEngine({
    ports,
    api: fake,
    engineVersion: "test-1",
    download:
      options.download ??
      ((url) => {
        downloads.push(url);
        return Promise.resolve({
          ok: true as const,
          value: { bytes: PNG, contentType: "image/png" },
        });
      }),
    ...(options.audit ? { audit: options.audit } : {}),
    ...(options.executors ? { executors: options.executors } : {}),
    ...(options.caps ? { caps: options.caps } : {}),
  });
  const sessionId = newId("ses");
  const userId = newId("usr");

  const h: Harness = {
    clock,
    ports,
    fake,
    engine,
    events,
    downloads,
    sessionId,
    userId,
    async photo(name, bytes = JPG) {
      const key = `runs/seed/${name}.jpg`;
      await ports.blobs.put(key, bytes, "image/jpeg");
      return `blob:${key}`;
    },
    async start(graph, extra = {}) {
      const res = await engine.runner.startRun({
        graph,
        userId,
        sessionId,
        planId: newId("plan"),
        quote: EMPTY_QUOTE,
        recorded: false,
        ...extra,
      });
      if (!res.ok) throw new Error(`graph rejected: ${JSON.stringify(res.error)}`);
      return res.value.id;
    },
    async settle(maxRounds = 1_000, stepMs = 1_000) {
      for (let i = 0; i < maxRounds; i++) {
        await ports.queue.tick();
        if (ports.queue.snapshot().length === 0) return;
        await clock.advance(stepMs);
      }
      throw new Error(`queue did not settle: ${JSON.stringify(ports.queue.snapshot())}`);
    },
    async run(runId) {
      return Run.parse(await ports.state.get(`runs/${runId}`));
    },
    async nodes(runId) {
      const docs = await listDocs(ports.state, `runs/${runId}/nodes`, RunNode);
      return Object.fromEntries(docs.map((d) => [d.id, d.value]));
    },
  };
  return h;
}

export const youcam = (id: string, feature: string, spec: Partial<NodeSpec> = {}): NodeSpec => ({
  id,
  kind: "youcam",
  label: `step.${id}`,
  feature,
  ...spec,
});
