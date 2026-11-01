import { newId, type Quote } from "@mira/schemas";
import type { Ports } from "@mira/runtime";
import type { FakeYouCam } from "@mira/youcam-client/testing";
import type { Engine } from "./engine";
import { buildQuote } from "./quote";
import type { GraphSpec } from "./runner/graph";
import type { NodeExecutor } from "./runner/runner";

/**
 * The Phase 3 demo graph: three analysers read one photo in parallel, then a local node summarises
 * them (docs/phases PHASE_03, "a demo graph of three fake nodes"). In mock mode YouCam is a
 * synthetic double, so nothing here is a real measurement and the photo is a placeholder, never a
 * person. The point is the orchestration: nodes lighting up, a quote, units, then the same run
 * again finishing from cache with zero units.
 */
export const DEMO_PHOTO_KEY = "runs/demo/placeholder-photo.jpg";
export const DEMO_PHOTO = new TextEncoder().encode(
  "MIRA synthetic placeholder photo (not a person)",
);

export const DEMO_GRAPH: GraphSpec = {
  type: "demo",
  nodes: [
    {
      id: "tone",
      kind: "youcam",
      label: "step.measure_colour",
      feature: "skin-tone-analysis",
      inputs: { src: `blob:${DEMO_PHOTO_KEY}` },
    },
    {
      id: "fitzpatrick",
      kind: "youcam",
      label: "step.measure_band",
      feature: "fitzpatrick-scale-analyzer",
      inputs: { src: `blob:${DEMO_PHOTO_KEY}` },
    },
    {
      id: "face",
      kind: "youcam",
      label: "step.measure_face",
      feature: "face-attr-analysis",
      params: { features: ["faceAspectRatio", "horizontalThird"] },
      inputs: { src: `blob:${DEMO_PHOTO_KEY}` },
    },
    {
      id: "summary",
      kind: "engine",
      label: "step.summarise",
      feature: "demo-summary",
      dependsOn: ["tone", "fitzpatrick", "face"],
    },
  ],
};

export const DEMO_PRICES: Record<string, number> = {
  "skin-tone-analysis": 20,
  "fitzpatrick-scale-analyzer": 10,
  "face-attr-analysis": 10,
};

/** Synthetic answers shaped like the documented results (docs/YOUCAM_API.md §2). */
export function seedDemoFake(fake: FakeYouCam): void {
  fake
    .respondWith("skin-tone-analysis", {
      latencyMs: 4_000,
      results: { color: { skin_color: "#C79A78", lip_color: "#A5504F", hair_color: "#42280E" } },
    })
    .respondWith("fitzpatrick-scale-analyzer", {
      latencyMs: 2_500,
      results: { fitzpatrick_scale: "III" },
    })
    .respondWith("face-attr-analysis", {
      latencyMs: 5_500,
      results: { facialratio: { face_aspect_ratio: [1.31], horizontal_third: [0.33, 0.34, 0.33] } },
    });
}

export const demoExecutors: Record<string, NodeExecutor> = {
  "demo-summary": (ctx) =>
    Promise.resolve({
      ok: true as const,
      value: {
        output: {
          steps: Object.values(ctx.upstream).map((n) => ({
            id: n.id,
            status: n.status,
            units: n.unitsCommitted,
          })),
          units: Object.values(ctx.upstream).reduce((sum, n) => sum + n.unitsCommitted, 0),
        },
      },
    }),
};

export interface DemoSession {
  userId: string;
  sessionId: string;
}

export const newDemoSession = (): DemoSession => ({
  userId: newId("usr"),
  sessionId: newId("ses"),
});

/** Quotes and starts the demo graph. Every call is a fresh run of the same graph. */
export async function startDemoRun(engine: Engine, ports: Ports, session: DemoSession) {
  await ports.blobs.put(DEMO_PHOTO_KEY, DEMO_PHOTO, "image/jpeg");
  const quote = await buildQuote({
    graph: DEMO_GRAPH,
    sessionId: session.sessionId,
    costs: engine.costs,
    ledger: engine.ledger,
    isCached: (node) => engine.runner.lifecycle.wouldHit(node),
    now: () => ports.clock.now(),
  });
  if (!quote.ok) return quote;
  const q: Quote = quote.value;
  const started = await engine.runner.startRun({
    graph: DEMO_GRAPH,
    userId: session.userId,
    sessionId: session.sessionId,
    planId: newId("plan"),
    quote: q,
    // Synthetic, not a recording: the banner must not claim real captured outputs.
    recorded: false,
  });
  return started.ok ? { ok: true as const, value: { runId: started.value.id, quote: q } } : started;
}
