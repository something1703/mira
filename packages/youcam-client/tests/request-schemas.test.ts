// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { FEATURES, featureOf, taskPath, type FeatureInputs, type FeatureSlug } from "../src";

/**
 * Every request body MIRA builds must satisfy the request schema in the saved OpenAPI bundle for
 * its path (D11). The builders are hand-written, so this is what catches a misspelt field or a
 * wrong enum before the first live call spends units.
 */
const DIR = join(import.meta.dirname, "../openapi");
type Json = Record<string, unknown>;

function load(bundle: string): Json {
  return parse(readFileSync(join(DIR, `${bundle}.yaml`), "utf8")) as Json;
}

/** Inlines every local `$ref`, so the schema can be checked on its own. */
function inline(doc: Json, node: unknown, trail: readonly string[] = []): unknown {
  if (Array.isArray(node)) return node.map((x) => inline(doc, x, trail));
  if (node === null || typeof node !== "object") return node;
  const obj = node as Json;
  if (typeof obj.$ref === "string" && obj.$ref.startsWith("#/")) {
    if (trail.includes(obj.$ref) || trail.length > 12) return {};
    let target: unknown = doc;
    for (const part of obj.$ref.slice(2).split("/")) target = (target as Json | undefined)?.[part];
    return inline(doc, target, [...trail, obj.$ref]);
  }
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, inline(doc, v, trail)]));
}

function requestSchema(bundle: string, path: string): unknown {
  const doc = load(bundle);
  const op = ((doc.paths as Json)[path] as Json | undefined)?.post as Json | undefined;
  const body = ((op?.requestBody as Json | undefined)?.content as Json | undefined)?.[
    "application/json"
  ] as Json | undefined;
  if (!body?.schema) throw new Error(`No request schema for ${path} in ${bundle}`);
  return inline(doc, body.schema);
}

// OpenAPI 3.0 flavoured JSON Schema: unknown keywords (example, xml) and formats are ignored.
const ajv = new Ajv({ strict: false, validateFormats: false, allErrors: true });

function check(bundle: string, slug: FeatureSlug, body: unknown): string[] {
  const schema = requestSchema(bundle, taskPath(FEATURES[slug]));
  const validate = ajv.compile(schema as object);
  return validate(body)
    ? []
    : (validate.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? ""}`);
}

/** Every property name the schema declares at the top level, through allOf, anyOf and oneOf. */
function declaredKeys(schema: unknown): Set<string> {
  const keys = new Set<string>();
  const walk = (n: unknown): void => {
    if (n === null || typeof n !== "object") return;
    const o = n as Json;
    if (o.properties && typeof o.properties === "object")
      for (const k of Object.keys(o.properties)) keys.add(k);
    for (const group of ["allOf", "anyOf", "oneOf"] as const) {
      const list = o[group];
      if (Array.isArray(list)) list.forEach(walk);
    }
  };
  walk(schema);
  return keys;
}

/** Keys sent that the bundle never declares: a misspelt optional field passes JSON Schema silently. */
function unknownKeys(bundle: string, slug: FeatureSlug, body: Json): string[] {
  const declared = declaredKeys(requestSchema(bundle, taskPath(FEATURES[slug])));
  return Object.keys(body).filter((k) => !declared.has(k));
}

const src = { fileId: "f1" } as const;
const ref = { fileId: "g1" } as const;
const three = [{ fileId: "a" }, { fileId: "b" }, { fileId: "c" }] as const;

const foundation = {
  category: "foundation",
  palettes: [{ color: "#C79A78", colorIntensity: 60, glowIntensity: 30, coverageIntensity: 40 }],
};
const concealer = {
  category: "concealer",
  palettes: [
    { color: "#C79A78", colorIntensity: 60, colorUnderEyeIntensity: 40, coverageLevel: 50 },
  ],
};
const lip = {
  category: "lip_color",
  shape: { name: "natural" },
  style: { type: "full" },
  palettes: [{ color: "#A23B4F", texture: "satin", colorIntensity: 70 }],
};
const blush = {
  category: "blush",
  pattern: { name: "apple" },
  palettes: [{ color: "#D9777F", texture: "matte", colorIntensity: 40 }],
};

interface Case {
  name: string;
  bundle: string;
  slug: FeatureSlug;
  params: unknown;
  inputs: FeatureInputs;
}

const CASES: Case[] = [
  {
    name: "skin analysis, HD",
    bundle: "ai_skin_analysis",
    slug: "skin-analysis",
    params: { concerns: ["hd_pore", "hd_texture", "hd_acne"] },
    inputs: { src },
  },
  {
    name: "skin analysis, SD",
    bundle: "ai_skin_analysis",
    slug: "skin-analysis",
    params: { concerns: ["pore"] },
    inputs: { src },
  },
  {
    name: "skin tone",
    bundle: "ai_skin_tone_analysis",
    slug: "skin-tone-analysis",
    params: {},
    inputs: { src },
  },
  {
    name: "skin tone, strict",
    bundle: "ai_skin_tone_analysis",
    slug: "skin-tone-analysis",
    params: { strictness: "strict" },
    inputs: { src },
  },
  {
    name: "fitzpatrick",
    bundle: "ai_fitzpatrick_skin_type",
    slug: "fitzpatrick-scale-analyzer",
    params: {},
    inputs: { src },
  },
  {
    name: "face attributes",
    bundle: "ai_face_analyzer",
    slug: "face-attr-analysis",
    params: { features: ["faceAspectRatio", "horizontalThird", "verticalFifth"] },
    inputs: { src },
  },
  {
    name: "hair type, ids",
    bundle: "ai_hair_type_detection",
    slug: "hair-type-detection",
    params: {},
    inputs: { srcs: three },
  },
  {
    name: "hair type, urls",
    bundle: "ai_hair_type_detection",
    slug: "hair-type-detection",
    params: {},
    inputs: { srcs: [{ url: "https://a" }, { url: "https://b" }, { url: "https://c" }] },
  },
  {
    name: "hair frizz",
    bundle: "ai_hair_frizziness_detection",
    slug: "hair-frizziness-detection",
    params: {},
    inputs: { srcs: three },
  },
  {
    name: "hair density",
    bundle: "ai_hair_density_detection",
    slug: "hair-density-detection",
    params: {},
    inputs: { src },
  },
  {
    name: "hair length",
    bundle: "ai_hair_length_detection",
    slug: "hair-length-detection",
    params: {},
    inputs: { src },
  },
  {
    name: "skin simulation",
    bundle: "ai_skin_simulation",
    slug: "skin-simulation",
    params: { pores: 0.5, eye_bags: 1, spots: 0 },
    inputs: { src },
  },
  {
    name: "makeup: foundation",
    bundle: "makeup_vto",
    slug: "makeup-vto",
    params: { effects: [foundation] },
    inputs: { src },
  },
  {
    name: "makeup: foundation + concealer",
    bundle: "makeup_vto",
    slug: "makeup-vto",
    params: { effects: [foundation, concealer] },
    inputs: { src },
  },
  {
    name: "makeup: lip",
    bundle: "makeup_vto",
    slug: "makeup-vto",
    params: { effects: [lip] },
    inputs: { src },
  },
  {
    name: "makeup: blush",
    bundle: "makeup_vto",
    slug: "makeup-vto",
    params: { effects: [blush] },
    inputs: { src },
  },
  {
    name: "makeup: full face, smoothing opted in",
    bundle: "makeup_vto",
    slug: "makeup-vto",
    params: { effects: [foundation, concealer, lip, blush], smoothing: { strength: 35 } },
    inputs: { src },
  },
  {
    name: "clothes, ids",
    bundle: "ai_clothes",
    slug: "cloth-v4",
    params: { category: "full_body" },
    inputs: { src, ref },
  },
  {
    name: "clothes, all options",
    bundle: "ai_clothes",
    slug: "cloth-v4",
    params: { category: "outer", changeShoes: false, filterMultiPerson: "strict" },
    inputs: { src, ref },
  },
  {
    name: "clothes, urls",
    bundle: "ai_clothes",
    slug: "cloth-v4",
    params: { category: "auto" },
    inputs: { src: { url: "https://s" }, ref: { url: "https://r" } },
  },
  {
    name: "hair colour, preset",
    bundle: "ai_hair_color",
    slug: "hair-color",
    params: { preset: "Rose Gold" },
    inputs: { src },
  },
  {
    name: "hair colour, ombre",
    bundle: "ai_hair_color",
    slug: "hair-color",
    params: {
      pattern: { name: "ombre" },
      palettes: [{ color: "#722626", color_intensity: 80 }, { color: "#B56637" }],
    },
    inputs: { src },
  },
  {
    name: "background, prompt",
    bundle: "ai_photo_background_change",
    slug: "bg-replace",
    params: { type: "prompt", prompt: "a courtyard at dusk" },
    inputs: { src },
  },
  {
    name: "background, template",
    bundle: "ai_photo_background_change",
    slug: "bg-replace",
    params: { type: "template", templateId: "t1" },
    inputs: { src },
  },
  {
    name: "video 5 s",
    bundle: "ai_video_generator",
    slug: "image-to-video/youcam",
    params: { resolution: "720", durationSec: 5 },
    inputs: { src },
  },
  {
    name: "video 10 s with prompt",
    bundle: "ai_video_generator",
    slug: "image-to-video/youcam",
    params: { resolution: "1080", durationSec: 10, prompt: "the person turns slowly" },
    inputs: { src },
  },
  {
    name: "background removal",
    bundle: "ai_background_removal",
    slug: "sod",
    params: {},
    inputs: { src },
  },
];

describe("builders satisfy the saved OpenAPI request schemas", () => {
  it.each(CASES)("$name", ({ bundle, slug, params, inputs }) => {
    const f = featureOf(slug);
    const body = f.buildBody(f.params.parse(params), inputs);
    expect(check(bundle, slug, body)).toEqual([]);
  });

  it.each(CASES)(
    "sends only fields the bundle declares: $name",
    ({ bundle, slug, params, inputs }) => {
      const f = featureOf(slug);
      const body = f.buildBody(f.params.parse(params), inputs) as Json;
      expect(unknownKeys(bundle, slug, body)).toEqual([]);
    },
  );

  it("catches a misspelt optional field that JSON Schema alone would accept", () => {
    const f = featureOf("skin-tone-analysis");
    const body = f.buildBody(f.params.parse({ strictness: "strict" }), { src }) as Json;
    const typo = { ...body, face_angle_strictness_levl: "strict" };
    expect(check("ai_skin_tone_analysis", "skin-tone-analysis", typo)).toEqual([]); // schema alone is blind to it
    expect(unknownKeys("ai_skin_tone_analysis", "skin-tone-analysis", typo)).toEqual([
      "face_angle_strictness_levl",
    ]);
  });

  it("every registered feature is covered by at least one case", () => {
    const covered = new Set(CASES.map((c) => c.slug));
    expect([...Object.keys(FEATURES)].filter((s) => !covered.has(s as FeatureSlug))).toEqual([]);
  });

  it("the check is not vacuous: it rejects a wrong body", () => {
    const f = featureOf("image-to-video/youcam");
    const good = f.buildBody(f.params.parse({ resolution: "720", durationSec: 5 }), { src });
    expect(
      check("ai_video_generator", "image-to-video/youcam", { ...good, dst_duration: 7 }).length,
    ).toBeGreaterThan(0);
    expect(
      check("ai_video_generator", "image-to-video/youcam", { ...good, resolution: "999" }).length,
    ).toBeGreaterThan(0);
    const { resolution: _gone, ...missing } = good as Json;
    expect(check("ai_video_generator", "image-to-video/youcam", missing).length).toBeGreaterThan(0);
    expect(check("ai_background_removal", "sod", {}).length).toBeGreaterThan(0);
    expect(
      check("makeup_vto", "makeup-vto", { src_file_id: "x", effects: [{ category: "foundation" }] })
        .length,
    ).toBeGreaterThan(0);
    expect(
      check("ai_clothes", "cloth-v4", {
        src_file_id: "x",
        ref_file_id: "y",
        garment_category: "dress",
      }).length,
    ).toBeGreaterThan(0);
  });
});
