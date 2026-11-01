import { z } from "zod";
import {
  FaceAttrResult,
  FitzpatrickResult,
  HairDensityResult,
  HairFrizzResult,
  HairLengthResult,
  HairTypeResult,
  SkinAnalysisResult,
  SkinToneResult,
  UrlResult,
} from "./schemas/results";
import { MakeupEffect, buildMakeupBody, MakeupParams } from "./schemas/makeup";
import {
  priceByDescription,
  priceSingle,
  priceVideo,
  priceSkinAnalysis,
  type Price,
  type Sku,
} from "./pricing";

/** A file already known to YouCam (`fileId`) or any public URL valid for the next 2 hours. */
export type FileRef = { readonly fileId: string } | { readonly url: string };

export interface FeatureInputs {
  readonly src?: FileRef;
  /** Hair type and frizz take three photos: front, right, left, all the same size. */
  readonly srcs?: readonly [FileRef, FileRef, FileRef];
  /** The garment or reference image for clothes. */
  readonly ref?: FileRef;
}

const srcFields = (ref: FileRef): Record<string, string> =>
  "fileId" in ref ? { src_file_id: ref.fileId } : { src_file_url: ref.url };
const refFields = (ref: FileRef): Record<string, string> =>
  "fileId" in ref ? { ref_file_id: ref.fileId } : { ref_file_url: ref.url };

function need<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`Missing input: ${what}`);
  return value;
}

export interface Feature<P = unknown> {
  /** Path segment after `/task/`, e.g. `skin-analysis`. Also the feature-cost mapping key. */
  readonly slug: string;
  /** API version in the path: `v2.0` for most, `v2.1` for skin analysis. */
  readonly version: "v2.0" | "v2.1";
  readonly params: z.ZodType<P>;
  readonly result: z.ZodType;
  /** What the node needs uploaded: one photo, three photos, or a photo and a reference. */
  readonly inputs: "single" | "triple" | "single+ref";
  buildBody(params: P, inputs: FeatureInputs): Record<string, unknown>;
  /** Units for one run, read only from feature-cost SKUs; a failure means "do not submit". */
  price(params: P, skus: readonly Sku[]): Price;
}

const feature = <P>(f: Feature<P>): Feature<P> => f;

const HD_CONCERNS = [
  "hd_wrinkle",
  "hd_pore",
  "hd_texture",
  "hd_acne",
  "hd_oiliness",
  "hd_radiance",
  "hd_eye_bag",
  "hd_age_spot",
  "hd_dark_circle",
  "hd_droopy_upper_eyelid",
  "hd_droopy_lower_eyelid",
  "hd_firmness",
  "hd_moisture",
  "hd_redness",
  "hd_tear_trough",
  "hd_skin_type",
] as const;
const SD_CONCERNS = [
  "wrinkle",
  "pore",
  "texture",
  "acne",
  "oiliness",
  "radiance",
  "eye_bag",
  "age_spot",
  "dark_circle_v2",
  "droopy_upper_eyelid",
  "droopy_lower_eyelid",
  "firmness",
  "moisture",
  "redness",
  "tear_trough",
  "skin_type",
] as const;
export const SkinConcern = z.enum([...HD_CONCERNS, ...SD_CONCERNS]);
export type SkinConcern = z.infer<typeof SkinConcern>;
const isHd = (c: SkinConcern) => c.startsWith("hd_");

export const SkinAnalysisParams = z.object({
  concerns: z
    .array(SkinConcern)
    .min(1)
    .max(16)
    .refine((c) => new Set(c).size === c.length, "List each concern once")
    // Mixing returns 400 "cannot mix HD and SD dst_actions" (docs/YOUCAM_API.md §3).
    .refine((c) => c.every(isHd) || c.every((x) => !isHd(x)), "Do not mix HD and SD concerns"),
});
export type SkinAnalysisParams = z.infer<typeof SkinAnalysisParams>;

const Strictness = z.enum(["strict", "high", "medium", "low", "flexible"]);
const FACE_FEATURES = [
  "eyeShape",
  "eyeSize",
  "eyeAngle",
  "eyeDistance",
  "eyelid",
  "eyebrowShape",
  "eyebrowThickness",
  "eyebrowDistance",
  "eyebrowShortness",
  "cheekbones",
  "faceShape",
  "lipShape",
  "noseWidth",
  "noseLength",
  "age",
  "gender",
  "eyeColor",
  "lipColor",
  "eyebrowColor",
  "hairColor",
  "horizontalThird",
  "verticalFifth",
  "faceAspectRatio",
  "eyeAspectRatio",
  "eyebrowPosition",
  "eyebrowArch",
  "eyeHeightToEyebrowDistance",
  "noseAspectRatio",
  "noseWidthToMouthWidth",
  "noseToLipToChin",
  "upperLipToLowerLip",
] as const;
export const FaceFeature = z.enum(FACE_FEATURES);

const unit = z.number().min(0).max(1);
export const SkinSimulationParams = z
  .object({
    wrinkle: unit,
    radiance: unit,
    oiliness: unit,
    acne: unit,
    eye_bags: unit,
    dark_circle: unit,
    spots: unit,
    pores: unit,
    texture: unit,
    redness: unit,
  })
  .partial()
  .refine((p) => Object.keys(p).length > 0, "Set at least one concern");

const Hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
export const HairColorParams = z.union([
  z.object({ preset: z.string().min(1) }),
  z.object({
    pattern: z.object({ name: z.enum(["ombre", "full"]) }),
    palettes: z
      .array(
        z.object({
          color: Hex,
          color_intensity: z.number().int().min(0).max(100).optional(),
          shine_intensity: z.number().int().min(0).max(100).optional(),
        }),
      )
      .min(1)
      .max(2),
  }),
]);

export const ClothesParams = z.object({
  category: z.enum(["full_body", "lower_body", "upper_body", "shoes", "auto", "outer"]),
  changeShoes: z.boolean().optional(),
  filterMultiPerson: z.enum(["off", "normal", "strict"]).optional(),
});

export const BackgroundParams = z.union([
  z.object({ type: z.literal("prompt"), prompt: z.string().min(1).max(1500) }),
  z.object({ type: z.literal("template"), templateId: z.string().min(1) }),
]);

export const VideoParams = z.object({
  resolution: z.enum(["480", "720", "1080"]),
  durationSec: z.union([z.literal(5), z.literal(10)]),
  /** Venue and motion text only; MIRA never sends anything about the person (D3). */
  prompt: z.string().min(1).max(1500).optional(),
});

const NoParams = z.object({}).strict();

/**
 * The features MIRA calls in phases 5–9. Accessories, jewellery and hair transfer are added with
 * the Look phase. Each entry was written from the saved bundle for its path (D11).
 */
export const FEATURES = {
  "skin-analysis": feature({
    slug: "skin-analysis",
    version: "v2.1",
    params: SkinAnalysisParams,
    result: SkinAnalysisResult,
    inputs: "single",
    buildBody: (p, i) => ({
      ...srcFields(need(i.src, "src")),
      dst_actions: p.concerns,
      format: "json",
    }),
    price: (p, skus) => priceSkinAnalysis(p.concerns.length, p.concerns.every(isHd), skus),
  }),
  "skin-tone-analysis": feature({
    slug: "skin-tone-analysis",
    version: "v2.0",
    params: z.object({ strictness: Strictness.optional() }),
    result: SkinToneResult,
    inputs: "single",
    buildBody: (p, i) => ({
      ...srcFields(need(i.src, "src")),
      ...(p.strictness ? { face_angle_strictness_level: p.strictness } : {}),
    }),
    price: (_p, skus) => priceSingle("skin-tone-analysis", skus),
  }),
  "fitzpatrick-scale-analyzer": feature({
    slug: "fitzpatrick-scale-analyzer",
    version: "v2.0",
    params: NoParams,
    result: FitzpatrickResult,
    inputs: "single",
    // `version: "1.0"` is required by the bundle (docs/YOUCAM_API.md §2).
    buildBody: (_p, i) => ({ ...srcFields(need(i.src, "src")), version: "1.0" }),
    price: (_p, skus) => priceSingle("fitzpatrick-scale-analyzer", skus),
  }),
  "face-attr-analysis": feature({
    slug: "face-attr-analysis",
    version: "v2.0",
    params: z.object({
      features: z.array(FaceFeature).min(1).max(28),
      strictness: Strictness.optional(),
    }),
    result: FaceAttrResult,
    inputs: "single",
    buildBody: (p, i) => ({
      ...srcFields(need(i.src, "src")),
      features: p.features,
      ...(p.strictness ? { face_angle_strictness_level: p.strictness } : {}),
    }),
    price: (p, skus) => priceByDescription("face-attr-analysis", p.features.length, skus),
  }),
  "hair-type-detection": feature({
    slug: "hair-type-detection",
    version: "v2.0",
    params: NoParams,
    result: HairTypeResult,
    inputs: "triple",
    buildBody: (_p, i) => tripleBody(i),
    price: (_p, skus) => priceSingle("hair-type-detection", skus),
  }),
  "hair-frizziness-detection": feature({
    slug: "hair-frizziness-detection",
    version: "v2.0",
    params: NoParams,
    result: HairFrizzResult,
    inputs: "triple",
    buildBody: (_p, i) => tripleBody(i),
    price: (_p, skus) => priceSingle("hair-frizziness-detection", skus),
  }),
  "hair-density-detection": feature({
    slug: "hair-density-detection",
    version: "v2.0",
    params: NoParams,
    result: HairDensityResult,
    inputs: "single",
    buildBody: (_p, i) => srcFields(need(i.src, "src")),
    price: (_p, skus) => priceSingle("hair-density-detection", skus),
  }),
  "hair-length-detection": feature({
    slug: "hair-length-detection",
    version: "v2.0",
    params: NoParams,
    result: HairLengthResult,
    inputs: "single",
    buildBody: (_p, i) => srcFields(need(i.src, "src")),
    price: (_p, skus) => priceSingle("hair-length-detection", skus),
  }),
  "skin-simulation": feature({
    slug: "skin-simulation",
    version: "v2.0",
    params: SkinSimulationParams,
    result: UrlResult,
    inputs: "single",
    buildBody: (p, i) => ({ ...srcFields(need(i.src, "src")), ...p }),
    price: (p, skus) => priceByDescription("skin-simulation", Object.keys(p).length, skus),
  }),
  "makeup-vto": feature({
    slug: "makeup-vto",
    version: "v2.0",
    params: MakeupParams,
    result: UrlResult,
    inputs: "single",
    buildBody: (p, i) => buildMakeupBody(p, srcFields(need(i.src, "src"))),
    price: (_p, skus) => priceSingle("makeup-vto", skus),
  }),
  "cloth-v4": feature({
    slug: "cloth-v4",
    version: "v2.0",
    params: ClothesParams,
    result: UrlResult,
    inputs: "single+ref",
    buildBody: (p, i) => ({
      ...srcFields(need(i.src, "src")),
      ...refFields(need(i.ref, "ref")),
      garment_category: p.category,
      ...(p.changeShoes === undefined ? {} : { change_shoes: p.changeShoes }),
      ...(p.filterMultiPerson ? { filter_multi_person: p.filterMultiPerson } : {}),
    }),
    // V4's cost is not in the bundle; it is read from feature-cost (docs/FACTS.md F6).
    price: (_p, skus) => priceSingle("cloth-v4", skus),
  }),
  "hair-color": feature({
    slug: "hair-color",
    version: "v2.0",
    params: HairColorParams,
    result: UrlResult,
    inputs: "single",
    buildBody: (p, i) => ({ ...srcFields(need(i.src, "src")), ...p }),
    price: (_p, skus) => priceSingle("hair-color", skus),
  }),
  "bg-replace": feature({
    slug: "bg-replace",
    version: "v2.0",
    params: BackgroundParams,
    result: UrlResult,
    inputs: "single",
    buildBody: (p, i) => ({
      ...srcFields(need(i.src, "src")),
      type: p.type,
      ...(p.type === "prompt" ? { prompt: p.prompt } : { template_id: p.templateId }),
    }),
    price: (_p, skus) => priceSingle("bg-replace", skus),
  }),
  "image-to-video/youcam": feature({
    slug: "image-to-video/youcam",
    version: "v2.0",
    params: VideoParams,
    result: UrlResult,
    inputs: "single",
    buildBody: (p, i) => ({
      ...srcFields(need(i.src, "src")),
      resolution: p.resolution,
      dst_duration: p.durationSec,
      ...(p.prompt ? { prompt: p.prompt } : {}),
    }),
    price: (p, skus) => priceVideo("image-to-video/youcam", p.resolution, p.durationSec, skus),
  }),
  sod: feature({
    slug: "sod",
    version: "v2.0",
    params: NoParams,
    result: UrlResult,
    inputs: "single",
    buildBody: (_p, i) => srcFields(need(i.src, "src")),
    price: (_p, skus) => priceSingle("sod", skus),
  }),
} as const;

function tripleBody(i: FeatureInputs): Record<string, unknown> {
  const srcs = need(i.srcs, "srcs");
  // Prefer ids; a mixed set is sent as URLs only if every photo has one.
  if (srcs.every((s) => "fileId" in s)) {
    return { src_file_ids: srcs.map((s) => ("fileId" in s ? s.fileId : "")) };
  }
  if (srcs.every((s) => "url" in s)) {
    return { src_file_urls: srcs.map((s) => ("url" in s ? s.url : "")) };
  }
  throw new Error("Give all three photos as file ids or all three as URLs");
}

export type FeatureSlug = keyof typeof FEATURES;
export type ParamsOf<S extends FeatureSlug> = z.infer<(typeof FEATURES)[S]["params"]>;
export const featureOf = (slug: FeatureSlug): Feature => FEATURES[slug];
export const taskPath = (f: Pick<Feature, "slug" | "version">): string =>
  `/s2s/${f.version}/task/${f.slug}`;

export { MakeupEffect, MakeupParams };
