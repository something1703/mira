import { loadCatalogues } from "@mira/fixtures";
import { newId, type AskContext, type Quote, type Twin } from "@mira/schemas";
import { MemoryPlanStore } from "../src/plans";
import { MockDiscovery } from "../src/mcp/youcam";
import { MockProvider, type MockScript } from "../src/providers/mock";
import type { ModelProvider } from "../src/providers/types";
import type { ToolEnv } from "../src/tools";
import type { Workflows, WorkflowsReply } from "../src/workflows";

/**
 * A stand-in for `mira-workflows` that records every call, so a test or an eval can say what the
 * agent did and, above all, what it did not do: no build call may exist for a plan the person
 * has not confirmed.
 */
export const USER = newId("usr");
export const SESSION = newId("ses");
const NOW = "2026-11-01T09:00:00.000Z";

export const quote = (total = 63): Quote => ({
  lines: [
    {
      nodeId: "render-1",
      label: "step.render_shade",
      feature: "makeup-vto",
      units: total,
      cached: false,
      optional: false,
    },
  ],
  total,
  sessionUnitsLeft: 300,
  overCap: false,
  pricing: { source: "feature-cost", pricedAt: NOW },
});

export function makeTwin(userId = USER): Twin {
  const meta = {
    source: { feature: "skin-tone-analysis", version: "1", taskRunId: "t1" },
    measuredAt: NOW,
  };
  const group = { status: "measured" as const, missing: [], at: NOW };
  return {
    userId,
    createdAt: NOW,
    updatedAt: NOW,
    metrics: {
      "colour.skin": {
        ...meta,
        id: "colour.skin",
        kind: "colour",
        lab: [62, 14, 22],
        hex: "#C79A78",
        confidence: "n/a",
      },
      "skin.hd_pore.whole": {
        ...meta,
        id: "skin.hd_pore.whole",
        kind: "number",
        value: 41.26,
        unit: "raw score",
        confidence: "n/a",
      },
      "colour.skin_ita_band": {
        ...meta,
        id: "colour.skin_ita_band",
        kind: "category",
        value: "intermediate",
        confidence: "n/a",
      },
    },
    groups: { skin: group, colouring: group, face: group, hair: group },
    faceRatios: {},
    noiseFloors: {},
    captureMeta: { mode: "hd", source: "camera", repeatsCaptured: 2, qualityChecksPassed: true },
    runIds: [],
    synthetic: false,
  };
}

export interface Call {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
}

export interface FakeOptions {
  twin?: Twin | "none" | "down";
  total?: number;
  /** Status the build route answers with. */
  buildStatus?: number;
  buildError?: string;
  /** Make the quote routes answer with this status and error. */
  quoteError?: { status: number; error: string };
  /** Price the quote over the session's cap. */
  overCap?: boolean;
}

export function fakeWorkflows(opts: FakeOptions = {}): Workflows & { calls: Call[] } {
  const calls: Call[] = [];
  const reply = (status: number, body: unknown): WorkflowsReply => ({ ok: true, status, body });
  const ranges = loadCatalogues();
  const twin = opts.twin ?? makeTwin();
  return {
    calls,
    get(path) {
      calls.push({ method: "GET", path });
      if (path.startsWith("/internal/twin/")) {
        if (twin === "down") return Promise.resolve({ ok: false });
        if (twin === "none") return Promise.resolve(reply(404, { error: "no_profile" }));
        return Promise.resolve(reply(200, { twin, synthetic: twin.synthetic }));
      }
      if (path === "/internal/shade/ranges") return Promise.resolve(reply(200, { ranges }));
      return Promise.resolve(reply(404, { error: "not_found" }));
    },
    postBytes(path, bytes) {
      calls.push({ method: "POST", path, body: { bytes: bytes.byteLength } });
      return Promise.resolve(
        reply(201, { key: `uploads/${USER}/up_garmentfetched.jpg`, width: 800, height: 1000 }),
      );
    },
    post(path, body) {
      calls.push({ method: "POST", path, body });
      const isBuild = path.endsWith("/build");
      if (!isBuild && opts.quoteError) {
        return Promise.resolve(reply(opts.quoteError.status, { error: opts.quoteError.error }));
      }
      if (isBuild && (opts.buildStatus ?? 201) !== 201) {
        return Promise.resolve(reply(opts.buildStatus ?? 409, { error: opts.buildError ?? "x" }));
      }
      return Promise.resolve(
        reply(isBuild ? 201 : 200, {
          quote: { ...quote(opts.total ?? 63), overCap: opts.overCap ?? false },
          ...(isBuild ? { runId: `run_${"a".repeat(12)}` } : {}),
        }),
      );
    },
  };
}

export function toolEnv(
  script: MockScript | undefined,
  opts: FakeOptions & { now?: () => Date; mock?: boolean; provider?: ModelProvider } = {},
) {
  const workflows = fakeWorkflows(opts);
  const mock = new MockProvider(script);
  const provider = opts.provider ?? mock;
  const plans = new MemoryPlanStore();
  const env: ToolEnv = {
    workflows,
    plans,
    discovery: new MockDiscovery(),
    provider,
    now: opts.now ?? (() => new Date(NOW)),
    page: { mock: opts.mock ?? true, provider },
  };
  // `provider` is the scripted mock, whose requests a test can read; a live run passes its own.
  return { env, workflows, provider: mock, plans };
}

export const request = (text: string, context: Partial<AskContext> = {}) => ({
  userId: USER,
  sessionId: SESSION,
  messages: [{ role: "user" as const, text }],
  context: { screen: "welcome" as const, ...context },
});
