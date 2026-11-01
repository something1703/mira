import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  LedgerEntry,
  Metric,
  MetricId,
  newId,
  Plan,
  Run,
  RunNode,
  traceIdFrom,
  TraceId,
} from "../src";

const now = new Date("2026-11-01T10:00:00.000Z").toISOString();

const quote = {
  lines: [
    {
      nodeId: "skin-analysis",
      label: "quote.measure_skin",
      feature: "skin-analysis",
      units: 16,
      cached: false,
      optional: false,
    },
  ],
  total: 16,
  sessionUnitsLeft: 184,
  overCap: false,
  pricing: { source: "feature-cost" as const, pricedAt: now },
};

const roundTrip = <S extends z.ZodType>(schema: S, value: unknown) =>
  schema.parse(JSON.parse(JSON.stringify(schema.parse(value))));

describe("schemas", () => {
  it("generates IDs that validate against their own schema", () => {
    expect(TraceId.safeParse(newId("trc")).success).toBe(true);
    expect(TraceId.safeParse(newId("run")).success).toBe(false);
  });

  it("keeps a well-formed incoming trace ID and replaces a malformed one", () => {
    const id = newId("trc");
    expect(traceIdFrom(id)).toBe(id);
    expect(traceIdFrom("<script>")).not.toBe("<script>");
    expect(TraceId.safeParse(traceIdFrom(undefined)).success).toBe(true);
  });

  it("accepts dotted metric IDs and rejects anything a placeholder could abuse", () => {
    expect(MetricId.safeParse("skin.hd_pore.whole").success).toBe(true);
    expect(MetricId.safeParse("Skin.Pore").success).toBe(false);
    expect(MetricId.safeParse("skin..pore").success).toBe(false);
    expect(MetricId.safeParse("skin.pore}{x").success).toBe(false);
  });

  it("round-trips each metric kind", () => {
    const base = {
      id: "colour.skin",
      source: { feature: "skin-tone-analysis", version: "v2.0", taskRunId: "t1" },
      confidence: "n/a",
      measuredAt: now,
    };
    const colour = { ...base, kind: "colour", lab: [62.1, 12.4, 18.9], hex: "#C79A78" };
    expect(roundTrip(Metric, colour)).toEqual(colour);
    expect(Metric.safeParse({ ...colour, hex: "#c79a78" }).success).toBe(false);
    expect(
      Metric.safeParse({ ...base, kind: "number", value: Number.NaN, unit: "x" }).success,
    ).toBe(false);
  });

  it("round-trips a run, node, plan and ledger entry", () => {
    const runId = newId("run");
    const run = {
      id: runId,
      type: "build_twin",
      userId: newId("usr"),
      sessionId: newId("ses"),
      status: "running",
      planId: newId("plan"),
      quote,
      unitsSpent: 0,
      traceId: newId("trc"),
      recorded: true,
      startedAt: now,
      outputs: {},
    };
    expect(roundTrip(Run, run)).toEqual(run);

    const node = RunNode.parse({
      id: "skin-analysis",
      runId,
      kind: "youcam",
      label: "step.measure_skin",
      dependsOn: ["capture"],
      status: "waiting",
      taskId: "task-1",
    });
    expect(node.unitsReserved).toBe(0);
    expect(roundTrip(RunNode, node)).toEqual(node);

    const plan = {
      id: run.planId,
      userId: run.userId,
      sessionId: run.sessionId,
      workflow: "build_twin",
      inputs: {},
      quote,
      removedLines: [],
      createdAt: now,
      expiresAt: now,
    };
    expect(roundTrip(Plan, plan)).toEqual(plan);

    const entry = {
      id: newId("led"),
      kind: "reserve",
      feature: "skin-analysis",
      units: 16,
      runId,
      nodeId: "skin-analysis",
      sessionId: run.sessionId,
      at: now,
    };
    expect(roundTrip(LedgerEntry, entry)).toEqual(entry);
  });

  it("records that failed nodes never charge units", () => {
    const failed = RunNode.safeParse({
      id: "skin-analysis",
      runId: newId("run"),
      kind: "youcam",
      label: "x",
      dependsOn: [],
      status: "failed",
      error: { code: "face_too_small", retryable: true, unitsCharged: 3 },
    });
    expect(failed.success).toBe(false);
  });
});
