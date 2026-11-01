import { z } from "zod";
import { err, ok, type Result } from "@mira/schemas";

/**
 * The workflows service's way of calling the measurement engines (docs/ENGINES.md). A port, so a
 * test or mock-mode run can use `LocalEngineClient` and live uses `HttpEngineClient`. Every call
 * returns a value, never throws: a failed engine call becomes a failed node with a code.
 */

const Lab = z.tuple([z.number(), z.number(), z.number()]);
export type LabTuple = z.infer<typeof Lab>;

export const ColourReading = z.object({
  hex: z.string(),
  lab: Lab,
  lch: z.object({ l: z.number(), c: z.number(), h: z.number() }),
  ita: z.number(),
  ita_band: z.string(),
});
export type ColourReading = z.infer<typeof ColourReading>;

export const NoiseFloorReading = z.object({
  sessions: z.number().int(),
  captures_per_session: z.number().int(),
  s_w: z.number(),
  s_d: z.number().nullable(),
  s_d_source: z.enum(["estimated", "prior", "unknown"]),
  se: z.number().nullable(),
  mdc: z.number().nullable(),
});
export type NoiseFloorReading = z.infer<typeof NoiseFloorReading>;

export const PrerankReading = z.object({
  id: z.string(),
  name: z.string(),
  de: z.number(),
  d_lightness: z.number(),
  d_hue: z.number(),
  label: z.enum([
    "blends_closely",
    "close",
    "lighter",
    "darker",
    "warmer",
    "cooler",
    "more_muted",
    "more_vivid",
  ]),
});
export type PrerankReading = z.infer<typeof PrerankReading>;

export const ClosedLoopReading = z.object({
  blend_de: z.number(),
  direction_ok: z.boolean(),
  label: z.enum(["blends_closely", "close", "not_close"]),
});
export type ClosedLoopReading = z.infer<typeof ClosedLoopReading>;

export const FinishReading = z.object({
  finishes: z.array(z.enum(["matte", "satin", "dewy"])).min(1),
  coverage: z.enum(["light", "medium"]),
  finish_reason: z.string(),
  coverage_reason: z.string(),
  t_zone_note: z.boolean(),
  concealer_suggested: z.boolean(),
});
export type FinishReading = z.infer<typeof FinishReading>;

export const LookSuggestReading = z.object({
  personal_contrast: z.number(),
  lip: z
    .object({
      shade: z.object({ id: z.string(), name: z.string(), lab: Lab }),
      reason: z.string(),
      contrast_matched: z.boolean(),
    })
    .nullable(),
  blush: z
    .object({
      shade: z.object({ id: z.string(), name: z.string(), lab: Lab }).nullable(),
      reason: z.string(),
    })
    .nullable(),
});
export type LookSuggestReading = z.infer<typeof LookSuggestReading>;

export const GarmentColourReading = z.object({
  lab: Lab,
  share: z.number(),
  multicolour: z.boolean(),
  audit_labs: z.array(Lab).min(1).max(2),
  pixels: z.number().int(),
});
export type GarmentColourReading = z.infer<typeof GarmentColourReading>;

export const GarmentAuditReading = z.object({
  label: z.enum(["verified", "drift", "not_checked"]),
  de: z.number().nullable().optional(),
  direction: z.string().nullable().optional(),
  changed_share: z.number().optional(),
  reason: z.string(),
});
export type GarmentAuditReading = z.infer<typeof GarmentAuditReading>;

export const LipAuditReading = z.object({ label: z.enum(["verified", "drift"]), de: z.number() });
export type LipAuditReading = z.infer<typeof LipAuditReading>;

export const IdentityReading = z.object({ drift: z.number(), passed: z.boolean() });
export type IdentityReading = z.infer<typeof IdentityReading>;

export interface FaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EngineFailure {
  code: "engine_unreachable" | "engine_rejected" | "engine_bad_reply";
  retryable: boolean;
}

/** Every reply carries the engine version and config so a result can be reproduced. */
export interface Enveloped<T> {
  value: T;
  engineVersion: string;
  /** The thresholds the engine used, by name, as it echoed them. */
  config?: Record<string, { value: number; calibrated: boolean }> | undefined;
}

export interface EngineClient {
  /** sRGB hex → Lab, LCh, ITA° and the ITA band. Order is preserved. */
  colourLab(hex: readonly string[]): Promise<Result<Enveloped<ColourReading[]>, EngineFailure>>;
  /** Ranks catalogue shades by ΔE00 to the skin, at no unit cost (docs/ENGINES.md §4.1). */
  shadePrerank(
    skin: LabTuple,
    catalogue: readonly { id: string; name: string; lab: LabTuple }[],
  ): Promise<Result<Enveloped<PrerankReading[]>, EngineFailure>>;
  /** Blend ΔE00 of a re-measured render against the skin, and whether it moved the right way. */
  closedLoop(
    skin: LabTuple,
    shade: LabTuple,
    render: LabTuple,
  ): Promise<Result<Enveloped<ClosedLoopReading>, EngineFailure>>;
  finish(
    skinTypeWhole: string | null,
    concernRawScores: Readonly<Record<string, number>>,
  ): Promise<Result<Enveloped<FinishReading>, EngineFailure>>;
  /** Picks a lip and a blush from catalogue shades for a garment and a person's colouring. */
  lookSuggest(input: {
    garment: LabTuple;
    skin: LabTuple;
    naturalLip: LabTuple;
    hair: LabTuple;
    lips: readonly { id: string; name: string; lab: LabTuple }[];
    blushes: readonly { id: string; name: string; lab: LabTuple }[];
  }): Promise<Result<Enveloped<LookSuggestReading>, EngineFailure>>;
  /** The colour of a garment from its background-removed picture (base64 PNG with alpha). */
  garmentColour(imageB64: string): Promise<Result<Enveloped<GarmentColourReading>, EngineFailure>>;
  /** Did the render put the garment on, in the colour asked for? */
  auditGarment(input: {
    sourceB64: string;
    renderB64: string;
    garmentLabs: readonly LabTuple[];
    faceBox?: FaceBox | undefined;
  }): Promise<Result<Enveloped<GarmentAuditReading>, EngineFailure>>;
  auditLip(
    rendered: LabTuple,
    intended: LabTuple,
  ): Promise<Result<Enveloped<LipAuditReading>, EngineFailure>>;
  /** Did the final render keep the face? Compares face ratio vectors. */
  auditIdentity(
    source: readonly number[],
    final: readonly number[],
  ): Promise<Result<Enveloped<IdentityReading>, EngineFailure>>;
  /** One session of repeated captures per concern: sessions[i] holds that session's scores. */
  noiseFloor(
    sessions: readonly (readonly number[])[],
  ): Promise<Result<Enveloped<NoiseFloorReading>, EngineFailure>>;
}

const Threshold = z.object({ value: z.number(), calibrated: z.boolean() }).loose();

const envelope = <T extends z.ZodType>(result: T) =>
  z
    .object({
      engine_version: z.string(),
      // The echo also carries lists the client does not read; keep only the numeric thresholds.
      config: z
        .record(z.string(), z.unknown())
        .transform((all) =>
          Object.fromEntries(
            Object.entries(all).flatMap(([k, v]) => {
              const one = Threshold.safeParse(v);
              return one.success ? [[k, one.data]] : [];
            }),
          ),
        )
        .optional(),
      result,
    })
    .loose();

export interface HttpEngineOptions {
  baseUrl: string;
  /** Adds the service-account identity token on Cloud Run; absent locally. */
  headers?: () => Promise<Record<string, string>>;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export class HttpEngineClient implements EngineClient {
  constructor(private readonly o: HttpEngineOptions) {}

  colourLab(hex: readonly string[]) {
    return this.post("/colour/lab", { hex }, z.array(ColourReading));
  }

  noiseFloor(sessions: readonly (readonly number[])[]) {
    return this.post("/stats/noise-floor", { sessions }, NoiseFloorReading);
  }

  shadePrerank(skin: LabTuple, catalogue: readonly { id: string; name: string; lab: LabTuple }[]) {
    return this.post("/shade/prerank", { skin, catalogue }, z.array(PrerankReading));
  }

  closedLoop(skin: LabTuple, shade: LabTuple, render: LabTuple) {
    return this.post("/shade/closed-loop", { skin, shade, render }, ClosedLoopReading);
  }

  finish(skinTypeWhole: string | null, concernRawScores: Readonly<Record<string, number>>) {
    return this.post(
      "/shade/finish",
      { skin_type_whole: skinTypeWhole, concern_raw_scores: concernRawScores },
      FinishReading,
    );
  }

  lookSuggest(i: Parameters<EngineClient["lookSuggest"]>[0]) {
    return this.post(
      "/look/suggest",
      {
        garment: i.garment,
        skin: i.skin,
        natural_lip: i.naturalLip,
        hair: i.hair,
        lips: i.lips,
        blushes: i.blushes,
      },
      LookSuggestReading,
    );
  }

  garmentColour(imageB64: string) {
    return this.post("/garment/colour", { image_b64: imageB64 }, GarmentColourReading);
  }

  auditGarment(i: Parameters<EngineClient["auditGarment"]>[0]) {
    return this.post(
      "/audit/garment",
      {
        source_b64: i.sourceB64,
        render_b64: i.renderB64,
        garment_labs: i.garmentLabs,
        ...(i.faceBox ? { face_box: i.faceBox } : {}),
      },
      GarmentAuditReading,
    );
  }

  auditLip(rendered: LabTuple, intended: LabTuple) {
    return this.post("/audit/lip", { rendered, intended }, LipAuditReading);
  }

  auditIdentity(source: readonly number[], final: readonly number[]) {
    return this.post("/audit/identity", { source, final }, IdentityReading);
  }

  private async post<T extends z.ZodType>(
    path: string,
    body: unknown,
    schema: T,
  ): Promise<Result<Enveloped<z.infer<T>>, EngineFailure>> {
    let res: Response;
    try {
      res = await (this.o.fetch ?? fetch)(new URL(path, this.o.baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json", ...(await this.o.headers?.()) },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.o.timeoutMs ?? 15_000),
      });
    } catch {
      return err({ code: "engine_unreachable", retryable: true });
    }
    if (res.status >= 500) return err({ code: "engine_unreachable", retryable: true });
    if (!res.ok) return err({ code: "engine_rejected", retryable: false });
    const parsed = envelope(schema).safeParse(await res.json().catch(() => undefined));
    if (!parsed.success) return err({ code: "engine_bad_reply", retryable: false });
    return ok({
      value: parsed.data.result as z.infer<T>,
      engineVersion: parsed.data.engine_version,
      config: parsed.data.config,
    });
  }
}
