import {
  CONFIG,
  METRIC,
  COLOUR_PARTS,
  colourMetricId,
  faceMetricId,
  skinMetricId,
  type ColourPart,
  type Metric,
  type MetricSource,
} from "@mira/schemas";
import {
  FaceAttrResult,
  FitzpatrickResult,
  HairDensityResult,
  HairFrizzResult,
  HairLengthResult,
  HairTypeResult,
  SkinAnalysisResult,
  SkinToneResult,
} from "@mira/youcam-client";
import type { ColourReading } from "./engine-client";

/**
 * Turns the raw answers of the analysers into profile metrics (docs/DATA_MODEL.md §1). Pure
 * functions: no I/O, no clock, so the same answer always yields the same metrics and each rule
 * is testable on its own. A shape that does not parse returns `unreadable` instead of throwing,
 * so one odd reply costs one reading, not the profile.
 *
 * Not stored on purpose (docs/FACTS.md): YouCam's `skin_age`, its overall `all` score and its
 * `ui_score` (D6: statistics use `raw_score` only), and the `agegender` estimate (a guess about
 * a person that no screen needs).
 */

export interface Extraction {
  metrics: Metric[];
  /** Ratio vectors from Face Attributes, by the name YouCam gave them. */
  ratios?: Record<string, number[]>;
}
export type Extracted = { ok: true; value: Extraction } | { ok: false; reason: "unreadable" };

const unreadable = { ok: false, reason: "unreadable" } as const;
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

interface Stamp {
  source: MetricSource;
  at: string;
}

const base = ({ source, at }: Stamp) => ({ source, measuredAt: at, confidence: "n/a" as const });

/** `#c79a78`, `C79A78` and ` #C79A78 ` all become `#C79A78`; anything else is undefined. */
export function normaliseHex(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const m = /^#?([0-9A-Fa-f]{6})$/.exec(value.trim());
  return m?.[1] ? `#${m[1].toUpperCase()}` : undefined;
}

/**
 * The concerns to request. HD is the configured set; the standard-detail fallback asks for the
 * same concerns under their SD names (`hd_pore` → `pore`, `hd_dark_circle` → `dark_circle_v2`).
 * HD and SD scores stay under different metric ids: they are different measurements.
 */
export function concernsFor(mode: "hd" | "sd"): string[] {
  const hd = [...CONFIG.twin.skinConcerns.value];
  if (mode === "hd") return hd;
  return hd.map((c) => {
    const sd = c.replace(/^hd_/, "");
    return sd === "dark_circle" ? "dark_circle_v2" : sd;
  });
}

/** Skin-analysis concerns, each by its `raw_score` (1-100) and region. */
export function extractSkin(output: unknown, stamp: Stamp, mode: "hd" | "sd" = "hd"): Extracted {
  const parsed = SkinAnalysisResult.safeParse(output);
  if (!parsed.success) return unreadable;
  const wanted = new Set<string>(concernsFor(mode));
  const metrics: Metric[] = [];
  for (const item of parsed.data.output) {
    if (!wanted.has(item.type) || !finite(item.raw_score)) continue;
    metrics.push({
      ...base(stamp),
      id: skinMetricId(item.type, item.region),
      kind: "number",
      value: item.raw_score,
      unit: "raw score",
    });
  }
  return { ok: true, value: { metrics } };
}

/** The colours YouCam read, as `{part: hex}`; a part with no valid hex is left out. */
export function toneHexes(output: unknown): Partial<Record<ColourPart, string>> | undefined {
  const parsed = SkinToneResult.safeParse(output);
  if (!parsed.success) return undefined;
  const c = parsed.data.color;
  const raw: Record<ColourPart, unknown> = {
    skin: c.skin_color,
    lip: c.lip_color,
    eyebrow: c.eyebrow_color,
    eye: c.eye_color,
    hair: c.hair_color,
  };
  const out: Partial<Record<ColourPart, string>> = {};
  for (const part of COLOUR_PARTS) {
    const hex = normaliseHex(raw[part]);
    if (hex !== undefined) out[part] = hex;
  }
  return out;
}

/**
 * Colouring: a swatch per measured part with its Lab from the colour engine, plus ITA° and its
 * band for skin and the names YouCam gave eye and hair. ITA is a colour descriptor, never an
 * identity (docs/ENGINES.md §3).
 */
export function extractColour(
  toneOutput: unknown,
  readings: Partial<Record<ColourPart, ColourReading>>,
  stamp: Stamp,
  engineStamp: Stamp,
): Extracted {
  const parsed = SkinToneResult.safeParse(toneOutput);
  if (!parsed.success) return unreadable;
  const metrics: Metric[] = [];
  for (const part of COLOUR_PARTS) {
    const reading = readings[part];
    const hex = normaliseHex(reading?.hex);
    if (reading === undefined || hex === undefined) continue;
    metrics.push({
      ...base(stamp),
      id: colourMetricId(part),
      kind: "colour",
      lab: reading.lab,
      hex,
    });
  }
  const skin = readings.skin;
  if (skin !== undefined) {
    metrics.push(
      { ...base(engineStamp), id: METRIC.ita, kind: "number", value: skin.ita, unit: "°" },
      { ...base(engineStamp), id: METRIC.itaBand, kind: "category", value: skin.ita_band },
    );
  }
  const { eye_color_name: eye, hair_color_name: hair } = parsed.data.color;
  if (typeof eye === "string" && eye.length > 0) {
    metrics.push({ ...base(stamp), id: METRIC.eyeName, kind: "category", value: eye });
  }
  if (typeof hair === "string" && hair.length > 0) {
    metrics.push({ ...base(stamp), id: METRIC.hairName, kind: "category", value: hair });
  }
  return { ok: true, value: { metrics } };
}

export function extractFitzpatrick(output: unknown, stamp: Stamp): Extracted {
  const parsed = FitzpatrickResult.safeParse(output);
  if (!parsed.success) return unreadable;
  return {
    ok: true,
    value: {
      metrics: [
        {
          ...base(stamp),
          id: METRIC.fitzpatrick,
          kind: "category",
          value: parsed.data.fitzpatrick_scale,
        },
      ],
    },
  };
}

/** Face proportions: one metric per element of each ratio vector, and the vectors themselves. */
export function extractFace(output: unknown, stamp: Stamp): Extracted {
  const parsed = FaceAttrResult.safeParse(output);
  if (!parsed.success) return unreadable;
  const metrics: Metric[] = [];
  const ratios: Record<string, number[]> = {};
  for (const [name, vector] of Object.entries(parsed.data.facialratio ?? {})) {
    if (vector.length === 0 || !vector.every(finite)) continue;
    ratios[name] = vector;
    vector.forEach((value, i) => {
      metrics.push({
        ...base(stamp),
        id: faceMetricId(name, i),
        kind: "number",
        value,
        unit: "ratio",
      });
    });
  }
  return { ok: true, value: { metrics, ratios } };
}

type HairKind = "type" | "density" | "length" | "frizz";
const HAIR_ID = {
  type: METRIC.hairType,
  density: METRIC.hairDensity,
  length: METRIC.hairLength,
  frizz: METRIC.hairFrizz,
} as const;

/** A hair reading is a word (`term`), or YouCam's code (`mapping`) when it gave no word. */
export function extractHair(kind: HairKind, output: unknown, stamp: Stamp): Extracted {
  let value: string | undefined;
  if (kind === "type") {
    const p = HairTypeResult.safeParse(output);
    if (p.success) value = p.data.hair_type.term ?? p.data.hair_type.mapping;
  } else if (kind === "density") {
    const p = HairDensityResult.safeParse(output);
    if (p.success) value = p.data.hair_density.term ?? p.data.hair_density.mapping;
  } else if (kind === "length") {
    const p = HairLengthResult.safeParse(output);
    if (p.success) value = p.data.hair_length.term;
  } else {
    const p = HairFrizzResult.safeParse(output);
    if (p.success) value = p.data.hair_frizziness.term ?? p.data.hair_frizziness.mapping;
  }
  if (value === undefined || value.length === 0) return unreadable;
  return {
    ok: true,
    value: { metrics: [{ ...base(stamp), id: HAIR_ID[kind], kind: "category", value }] },
  };
}

/**
 * Per-concern score lists for the noise-floor engine: `[first, repeat1, repeat2]` from the same
 * session. Only concerns present in every capture count, so each list has equal length.
 */
export function repeatScores(captures: readonly (readonly Metric[])[]): Record<string, number[]> {
  const first = captures[0];
  if (first === undefined) return {};
  const out: Record<string, number[]> = {};
  for (const m of first) {
    if (m.kind !== "number" || !m.id.startsWith("skin.")) continue;
    const scores = captures.map((c) => {
      const same = c.find((x) => x.id === m.id);
      return same?.kind === "number" ? same.value : undefined;
    });
    if (scores.every(finite)) out[m.id] = scores;
  }
  return out;
}
