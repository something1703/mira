/**
 * Contract samples for the Python engines (phases/PHASE_04, "contract test against TS types").
 * Each schema gets values that must be accepted and values that must be rejected. This script
 * only writes them if Zod agrees with every verdict, so the samples are TypeScript's own answer;
 * services/engines/tests/test_contract.py then requires the generated Python models and the JSON
 * Schema to give the same one. Run: pnpm --filter @mira/schemas export:contract-samples [--check]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { z } from "zod";
import { Audit, Lab, LedgerEntry, Metric, Plan, Quote, Run, RunEvent, RunNode, Twin } from "../src";

type Json = Record<string, unknown>;
interface Case {
  schema: z.ZodType;
  valid: unknown[];
  invalid: { why: string; value: unknown }[];
}

const at = "2026-11-01T10:00:00.000Z";
const quote: Json = {
  lines: [
    {
      nodeId: "tone",
      label: "quote.measure",
      feature: "skin-tone-analysis",
      units: 20,
      cached: false,
      optional: false,
    },
  ],
  total: 20,
  sessionUnitsLeft: 180,
  overCap: false,
  pricing: { source: "feature-cost", pricedAt: at },
};
const audit: Json = {
  kind: "garment",
  outcome: "drift",
  deltaE: 7.4,
  directions: ["lighter"],
  reason: "garment_drift",
  engineVersion: "0.1.0",
};
const node: Json = {
  id: "tone",
  runId: "run_aaaaaaaa",
  kind: "youcam",
  label: "step.measure_colour",
  dependsOn: [],
  feature: "skin-tone-analysis",
  status: "done",
  unitsReserved: 20,
  unitsCommitted: 20,
};
const run: Json = {
  id: "run_aaaaaaaa",
  type: "demo",
  userId: "usr_aaaaaaaa",
  sessionId: "ses_aaaaaaaa",
  status: "succeeded",
  planId: "plan_aaaaaaaa",
  quote,
  unitsSpent: 20,
  traceId: "trc_aaaaaaaa",
  recorded: false,
  startedAt: at,
};
const metricBase = {
  id: "skin.hd_pore.whole",
  source: { feature: "skin-analysis", version: "v2.1", taskRunId: "task_1" },
  confidence: "within",
  measuredAt: at,
};

const group = { status: "measured", at };
const twin: Json = {
  userId: "usr_aaaaaaaa",
  createdAt: at,
  updatedAt: at,
  metrics: {
    "skin.hd_pore.whole": { ...metricBase, kind: "number", value: 71.2, unit: "raw score" },
  },
  groups: { skin: group, colouring: group, face: group, hair: group },
  captureMeta: { mode: "hd", source: "camera", repeatsCaptured: 2, qualityChecksPassed: true },
  synthetic: false,
};

const CASES: Record<string, Case> = {
  Twin: {
    schema: Twin,
    valid: [
      twin,
      {
        ...twin,
        groups: {
          ...(twin.groups as Json),
          hair: {
            status: "partial",
            missing: [{ reading: "hair_type", reason: "hair_photos_mismatch", guidance: "retake" }],
            at,
          },
        },
        faceRatios: { horizontal_third: [0.33, 0.34, 0.33] },
        noiseFloors: {
          hd_pore: {
            sessions: 1,
            capturesPerSession: 3,
            sW: 1.4,
            sD: null,
            sDSource: "unknown",
            se: null,
            mdc: null,
          },
        },
        captureMeta: {
          mode: "sd",
          source: "upload",
          repeatsCaptured: 0,
          qualityChecksPassed: null,
        },
        synthetic: true,
      },
    ],
    invalid: [
      {
        why: "a group missing",
        value: { ...twin, groups: { skin: group, colouring: group, face: group } },
      },
      {
        why: "unknown capture mode",
        value: {
          ...twin,
          captureMeta: {
            mode: "4k",
            source: "camera",
            repeatsCaptured: 0,
            qualityChecksPassed: true,
          },
        },
      },
      { why: "the synthetic flag left out", value: { ...twin, synthetic: undefined } },
      {
        why: "a noise floor with one capture",
        value: {
          ...twin,
          noiseFloors: {
            hd_pore: {
              sessions: 1,
              capturesPerSession: 1,
              sW: 1,
              sD: null,
              sDSource: "unknown",
              se: null,
              mdc: null,
            },
          },
        },
      },
      { why: "a user id that is a session id", value: { ...twin, userId: "ses_aaaaaaaa" } },
    ],
  },
  Lab: {
    schema: Lab,
    valid: [
      [50, 0, 0],
      [65.2, 14.1, 20.9],
      [0, -128, 127],
    ],
    invalid: [
      { why: "two components", value: [50, 0] },
      { why: "four components", value: [50, 0, 0, 0] },
      { why: "a string among the numbers", value: [50, "0", 0] },
      { why: "not an array", value: { l: 50, a: 0, b: 0 } },
    ],
  },
  Audit: {
    schema: Audit,
    valid: [audit, { ...audit, outcome: "verified", deltaE: undefined, directions: [] }],
    invalid: [
      { why: "unknown outcome", value: { ...audit, outcome: "great" } },
      { why: "negative ΔE", value: { ...audit, deltaE: -1 } },
      { why: "missing reason", value: { ...audit, reason: undefined } },
    ],
  },
  LedgerEntry: {
    schema: LedgerEntry,
    valid: [
      {
        id: "led_aaaaaaaa",
        kind: "reserve",
        feature: "sod",
        units: 1,
        runId: "run_aaaaaaaa",
        nodeId: "a",
        sessionId: "ses_aaaaaaaa",
        at,
      },
    ],
    invalid: [
      {
        why: "fractional units",
        value: {
          id: "led_aaaaaaaa",
          kind: "reserve",
          feature: "sod",
          units: 1.5,
          runId: "run_aaaaaaaa",
          nodeId: "a",
          sessionId: "ses_aaaaaaaa",
          at,
        },
      },
      {
        why: "wrong id prefix",
        value: {
          id: "run_aaaaaaaa",
          kind: "commit",
          feature: "sod",
          units: 1,
          runId: "run_aaaaaaaa",
          nodeId: "a",
          sessionId: "ses_aaaaaaaa",
          at,
        },
      },
      {
        why: "unknown kind",
        value: {
          id: "led_aaaaaaaa",
          kind: "refund",
          feature: "sod",
          units: 1,
          runId: "run_aaaaaaaa",
          nodeId: "a",
          sessionId: "ses_aaaaaaaa",
          at,
        },
      },
    ],
  },
  Metric: {
    schema: Metric,
    valid: [
      { ...metricBase, kind: "number", value: 71.2, unit: "raw score" },
      {
        ...metricBase,
        id: "colour.skin",
        kind: "colour",
        lab: [65, 14, 20],
        hex: "#C79A78",
        confidence: "n/a",
      },
      {
        ...metricBase,
        id: "fitzpatrick.band",
        kind: "category",
        value: "III",
        confidence: "clear",
      },
    ],
    invalid: [
      {
        why: "a colour in a number field",
        value: { ...metricBase, kind: "number", value: "#C79A78", unit: "x" },
      },
      {
        why: "lower-case hex",
        value: { ...metricBase, kind: "colour", lab: [65, 14, 20], hex: "#c79a78" },
      },
      {
        why: "two-component Lab",
        value: { ...metricBase, kind: "colour", lab: [65, 14], hex: "#C79A78" },
      },
      {
        why: "upper-case metric id",
        value: { ...metricBase, id: "Skin.Pore", kind: "category", value: "x" },
      },
      { why: "unknown kind", value: { ...metricBase, kind: "image", value: "x" } },
    ],
  },
  Plan: {
    schema: Plan,
    valid: [
      {
        id: "plan_aaaaaaaa",
        userId: "usr_aaaaaaaa",
        sessionId: "ses_aaaaaaaa",
        workflow: "match_shade",
        inputs: {},
        quote,
        createdAt: at,
        expiresAt: at,
      },
    ],
    invalid: [
      {
        why: "unknown workflow",
        value: {
          id: "plan_aaaaaaaa",
          userId: "usr_aaaaaaaa",
          sessionId: "ses_aaaaaaaa",
          workflow: "demo",
          inputs: {},
          quote,
          createdAt: at,
          expiresAt: at,
        },
      },
      {
        why: "missing quote",
        value: {
          id: "plan_aaaaaaaa",
          userId: "usr_aaaaaaaa",
          sessionId: "ses_aaaaaaaa",
          workflow: "match_shade",
          inputs: {},
          createdAt: at,
          expiresAt: at,
        },
      },
    ],
  },
  Quote: {
    schema: Quote,
    valid: [quote],
    invalid: [
      { why: "negative total", value: { ...quote, total: -1 } },
      {
        why: "pricing from a guess",
        value: { ...quote, pricing: { source: "estimate", pricedAt: at } },
      },
      {
        why: "fractional units on a line",
        value: { ...quote, lines: [{ ...(quote.lines as Json[])[0], units: 2.5 }] },
      },
    ],
  },
  Run: {
    schema: Run,
    valid: [
      run,
      { ...run, status: "partial", cleanedAt: at, outputs: { steps: { succeeded: 2, total: 3 } } },
    ],
    invalid: [
      { why: "unknown status", value: { ...run, status: "done" } },
      { why: "session id used as run id", value: { ...run, id: "ses_aaaaaaaa" } },
      { why: "missing recorded flag", value: { ...run, recorded: undefined } },
    ],
  },
  RunEvent: {
    schema: RunEvent,
    valid: [
      { runId: "run_aaaaaaaa", nodeId: "tone", type: "node_done", at, traceId: "trc_aaaaaaaa" },
      { runId: "run_aaaaaaaa", type: "run_finished", at, traceId: "trc_aaaaaaaa" },
    ],
    invalid: [
      {
        why: "unknown event type",
        value: { runId: "run_aaaaaaaa", type: "node_exploded", at, traceId: "trc_aaaaaaaa" },
      },
      {
        why: "bad trace id",
        value: { runId: "run_aaaaaaaa", type: "run_started", at, traceId: "trace-1" },
      },
    ],
  },
  RunNode: {
    schema: RunNode,
    valid: [
      node,
      {
        ...node,
        status: "failed",
        error: {
          code: "face_too_small",
          upstream: "error_src_face_too_small",
          retryable: false,
          guidance: "retake",
          unitsCharged: 0,
        },
      },
      {
        ...node,
        inputs: { src: "blob:runs/run_aaaaaaaa/a/input.jpg" },
        files: { src: "file_1" },
        taskId: "t1",
        resultUrl: "https://x",
        resultUrlExpiresAt: at,
      },
    ],
    invalid: [
      {
        why: "a charged failure: failed tasks cost nothing",
        value: {
          ...node,
          status: "failed",
          error: { code: "x", retryable: false, unitsCharged: 3 },
        },
      },
      {
        why: "unknown guidance",
        value: {
          ...node,
          error: { code: "x", retryable: false, guidance: "panic", unitsCharged: 0 },
        },
      },
      { why: "node id with a capital", value: { ...node, id: "Tone" } },
      { why: "negative units", value: { ...node, unitsCommitted: -1 } },
    ],
  },
};

const out: Record<string, { valid: unknown[]; invalid: { why: string; value: unknown }[] }> = {};
const problems: string[] = [];
for (const [name, c] of Object.entries(CASES)) {
  for (const [i, v] of c.valid.entries()) {
    if (!c.schema.safeParse(v).success)
      problems.push(`${name}: valid sample ${String(i)} was rejected by Zod`);
  }
  for (const bad of c.invalid) {
    if (c.schema.safeParse(bad.value).success)
      problems.push(`${name}: invalid sample "${bad.why}" was accepted by Zod`);
  }
  // JSON round trip drops `undefined`, which is what a real payload looks like.
  out[name] = JSON.parse(
    JSON.stringify({ valid: c.valid, invalid: c.invalid }),
  ) as (typeof out)[string];
}
if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const path = join(root, "services/engines/tests/data/contract-samples.json");
const json = `${JSON.stringify(out, null, 2)}\n`;
if (process.argv.includes("--check")) {
  if (!existsSync(path) || readFileSync(path, "utf8") !== json) {
    console.error("Contract samples are out of date. Run export:contract-samples.");
    process.exit(1);
  }
  console.log("Contract samples up to date.");
} else {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, json);
  console.log(
    `Wrote ${String(Object.values(out).reduce((n, c) => n + c.valid.length + c.invalid.length, 0))} samples to ${path}`,
  );
}
