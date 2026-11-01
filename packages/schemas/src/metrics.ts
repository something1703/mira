import { z } from "zod";

/**
 * A metric ID names one measurement, e.g. `skin.hd_pore.whole`, `colour.skin`, `shade.blend_de`.
 * Agent text cites metrics as `{metric.id}` placeholders; the renderer injects the value
 * (docs/AGENT_RUNTIME.md §4–5), so the model never types a number.
 */
export const METRIC_ID_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*$/;
export const MetricId = z
  .string()
  .regex(METRIC_ID_PATTERN, "Expected a dotted lower-case metric ID");
export type MetricId = z.infer<typeof MetricId>;

/** Confidence words shown beside every measurement (docs/DATA_MODEL.md §1). */
export const Confidence = z.enum(["within", "small", "clear", "n/a"]);
export type Confidence = z.infer<typeof Confidence>;

export const MetricSource = z.object({
  /** YouCam feature slug or `engine:<endpoint>` for derived values. */
  feature: z.string().min(1),
  version: z.string().min(1),
  taskRunId: z.string().min(1),
});
export type MetricSource = z.infer<typeof MetricSource>;

export const Lab = z.tuple([z.number(), z.number(), z.number()]);
export type Lab = z.infer<typeof Lab>;

export const Hex = z.string().regex(/^#[0-9A-F]{6}$/, "Expected an upper-case #RRGGBB colour");
export type Hex = z.infer<typeof Hex>;

const MetricBase = z.object({
  id: MetricId,
  source: MetricSource,
  confidence: Confidence,
  measuredAt: z.iso.datetime(),
});

/**
 * Values are a discriminated union so a colour is never smuggled through a number field and a
 * category (e.g. a Fitzpatrick band) is never rendered with a unit.
 */
export const Metric = z.discriminatedUnion("kind", [
  MetricBase.extend({
    kind: z.literal("number"),
    /** Zod 4 numbers reject NaN and ±Infinity by default. */
    value: z.number(),
    /** Display unit, e.g. "raw score", "ΔE2000", "°". */
    unit: z.string(),
  }),
  MetricBase.extend({
    kind: z.literal("colour"),
    lab: Lab,
    hex: Hex,
  }),
  MetricBase.extend({
    kind: z.literal("category"),
    value: z.string().min(1),
  }),
]);
export type Metric = z.infer<typeof Metric>;

export const MetricStore = z.record(MetricId, Metric);
export type MetricStore = z.infer<typeof MetricStore>;
