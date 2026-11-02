import { err, ok } from "@mira/schemas";
import type {
  ClosedLoopReading,
  ColourReading,
  EngineClient,
  EngineFailure,
  ChangeReading,
  FinishReading,
  PhantomReading,
  GarmentAuditReading,
  GarmentColourReading,
  IdentityReading,
  LipAuditReading,
  LookSuggestReading,
  LabTuple,
  NoiseFloorReading,
  PrerankReading,
} from "../src/twin/engine-client";

/**
 * A scripted engine for workflow tests. It does not do the colour or statistics maths (that is
 * tested in Python against published values); it returns fixed, plausible readings and records
 * what it was asked.
 */
export class FakeEngine implements EngineClient {
  readonly colourCalls: string[][] = [];
  readonly noiseCalls: number[][][] = [];
  failColour: EngineFailure | undefined;
  failNoise: EngineFailure | undefined;
  /** Proof: what the variation estimate says once there is enough to say it. */
  noiseFloorOverride: Partial<NoiseFloorReading> | undefined;
  failShade: EngineFailure | undefined;

  /** What the shade endpoints answer next; tests set these to script a case. */
  prerank:
    ((skin: LabTuple, catalogue: { id: string; lab: LabTuple }[]) => PrerankReading[]) | undefined;
  /** What the look endpoints answer next. */
  garmentAudit: GarmentAuditReading = { label: "verified", de: 2.4, direction: null, reason: "ok" };
  lipAudit: LipAuditReading = { label: "verified", de: 1.1 };
  identity: IdentityReading = { drift: 0.02, passed: true };
  garment: GarmentColourReading = {
    lab: [45, 40, 20],
    share: 0.8,
    multicolour: false,
    audit_labs: [[45, 40, 20]],
    pixels: 5000,
  };
  suggestion: LookSuggestReading | undefined;
  failLook: EngineFailure | undefined;
  readonly lookCalls: string[] = [];

  lookSuggest(i: Parameters<EngineClient["lookSuggest"]>[0]) {
    this.lookCalls.push("suggest");
    if (this.failLook) return Promise.resolve(err(this.failLook));
    const lip = i.lips[0];
    const blush = i.blushes[0];
    const value: LookSuggestReading = this.suggestion ?? {
      personal_contrast: 24,
      lip: lip ? { shade: lip, reason: "hue_near_garment", contrast_matched: true } : null,
      blush: {
        shade: blush ?? null,
        reason: blush ? "hue_near_lip_lower_chroma" : "none_in_window",
      },
    };
    return Promise.resolve(ok({ value, engineVersion: "engines-test" }));
  }

  frameFace(_imageB64: string) {
    return Promise.resolve(
      ok({ value: { face: null, crop: null, image_b64: null }, engineVersion: "engines-test" }),
    );
  }

  garmentColour(_imageB64: string) {
    this.lookCalls.push("garment");
    if (this.failLook) return Promise.resolve(err(this.failLook));
    return Promise.resolve(ok({ value: this.garment, engineVersion: "engines-test" }));
  }

  auditGarment(_i: Parameters<EngineClient["auditGarment"]>[0]) {
    this.lookCalls.push("audit-garment");
    if (this.failLook) return Promise.resolve(err(this.failLook));
    return Promise.resolve(
      ok({
        value: this.garmentAudit,
        engineVersion: "engines-test",
        config: { GARMENT_VERIFY_DE: { value: 6, calibrated: false } },
      }),
    );
  }

  auditLip(_r: LabTuple, _i: LabTuple) {
    this.lookCalls.push("audit-lip");
    if (this.failLook) return Promise.resolve(err(this.failLook));
    return Promise.resolve(
      ok({
        value: this.lipAudit,
        engineVersion: "engines-test",
        config: { LIP_VERIFY_DE: { value: 3, calibrated: false } },
      }),
    );
  }

  auditIdentity(_s: readonly number[], _f: readonly number[]) {
    this.lookCalls.push("audit-identity");
    if (this.failLook) return Promise.resolve(err(this.failLook));
    return Promise.resolve(
      ok({
        value: this.identity,
        engineVersion: "engines-test",
        config: { IDENTITY_DRIFT_MAX: { value: 0.08, calibrated: false } },
      }),
    );
  }

  /** Proof: what the change and phantom endpoints answer next. */
  changeFor:
    ((i: { baseline: number; now: number; mdc: number | null }) => ChangeReading) | undefined;
  phantom: PhantomReading = {
    usable: true,
    rho: -1,
    score_range: 12,
    reason: "ok",
    intensities: [0, 0.25, 0.5, 0.75, 1],
    fitted_delta: [0, -3, -6, -9, -12],
    inverted_intensity: 0.5,
  };
  readonly proofCalls: string[] = [];

  /** Brand: the gap map the engines answer with next. */
  gap:
    | {
        total: number;
        unserved: number;
        unserved_share: number;
        near_de: number;
        bins: Record<string, number>[];
      }
    | undefined;

  gapMap(points: readonly LabTuple[], _shades: readonly LabTuple[]) {
    this.proofCalls.push("gap");
    if (this.failLook) return Promise.resolve(err(this.failLook));
    const value = this.gap ?? {
      total: points.length,
      unserved: 0,
      unserved_share: 0,
      near_de: 3.5,
      bins: [],
    };
    return Promise.resolve(
      ok({
        value,
        engineVersion: "engines-test",
        config: { GAP_NEAR_DE: { value: 3.5, calibrated: false } },
      }),
    );
  }

  change(i: Parameters<EngineClient["change"]>[0]) {
    this.proofCalls.push("change");
    if (this.failLook) return Promise.resolve(err(this.failLook));
    const delta = i.now - i.baseline;
    const value: ChangeReading = this.changeFor?.(i) ?? {
      delta,
      words:
        i.mdc === null
          ? "n/a"
          : Math.abs(delta) < i.mdc
            ? "within"
            : delta > 0
              ? "clear"
              : "opposite",
      phrase: "x",
    };
    return Promise.resolve(ok({ value, engineVersion: "engines-test" }));
  }

  phantomFit(_i: Parameters<EngineClient["phantomFit"]>[0]) {
    this.proofCalls.push("phantom");
    if (this.failLook) return Promise.resolve(err(this.failLook));
    return Promise.resolve(ok({ value: this.phantom, engineVersion: "engines-test" }));
  }

  closedLoopFor: ((render: LabTuple) => ClosedLoopReading) | undefined;
  finishReading: FinishReading = {
    finishes: ["satin"],
    coverage: "light",
    finish_reason: "no_skin_type",
    coverage_reason: "default_light",
    t_zone_note: false,
    concealer_suggested: false,
  };
  readonly closedLoopCalls: { skin: LabTuple; shade: LabTuple; render: LabTuple }[] = [];
  readonly finishCalls: { skinType: string | null; scores: Record<string, number> }[] = [];

  shadePrerank(skin: LabTuple, catalogue: readonly { id: string; name: string; lab: LabTuple }[]) {
    if (this.failShade) return Promise.resolve(err(this.failShade));
    const value =
      this.prerank?.(skin, [...catalogue]) ??
      catalogue.map((c, i) => ({
        id: c.id,
        name: c.name,
        de: 1 + i,
        d_lightness: 0,
        d_hue: 0,
        label: i === 0 ? "blends_closely" : "close",
      }));
    return Promise.resolve(ok({ value, engineVersion: "engines-test" }));
  }

  closedLoop(skin: LabTuple, shade: LabTuple, render: LabTuple) {
    this.closedLoopCalls.push({ skin, shade, render });
    if (this.failShade) return Promise.resolve(err(this.failShade));
    const value = this.closedLoopFor?.(render) ?? {
      blend_de: 1.2,
      direction_ok: true,
      label: "blends_closely" as const,
    };
    return Promise.resolve(
      ok({
        value,
        engineVersion: "engines-test",
        config: {
          MATCH_DE: { value: 2, calibrated: false },
          CLOSE_DE: { value: 3.5, calibrated: false },
        },
      }),
    );
  }

  finish(skinType: string | null, scores: Readonly<Record<string, number>>) {
    this.finishCalls.push({ skinType, scores: { ...scores } });
    if (this.failShade) return Promise.resolve(err(this.failShade));
    return Promise.resolve(ok({ value: this.finishReading, engineVersion: "engines-test" }));
  }

  /** Lab for a hex; tests that need shades to differ set this. */
  labFor: ((hex: string) => LabTuple) | undefined;

  colourLab(hex: readonly string[]) {
    this.colourCalls.push([...hex]);
    if (this.failColour) return Promise.resolve(err(this.failColour));
    const value: ColourReading[] = hex.map((h) => ({
      hex: h,
      lab: this.labFor?.(h) ?? [60, 12, 24],
      lch: { l: 60, c: 26.8, h: 63.4 },
      // arctan((60 - 50) / 24) = 22.6 degrees: the "tan" band (docs/ENGINES.md §3).
      ita: 22.6,
      ita_band: "tan",
    }));
    return Promise.resolve(ok({ value, engineVersion: "engines-test" }));
  }

  noiseFloor(sessions: readonly (readonly number[])[]) {
    this.noiseCalls.push(sessions.map((s) => [...s]));
    if (this.failNoise) return Promise.resolve(err(this.failNoise));
    const k = sessions[0]?.length ?? 0;
    const value: NoiseFloorReading = {
      sessions: sessions.length,
      captures_per_session: k,
      s_w: 1.5,
      s_d: null,
      s_d_source: "unknown",
      se: null,
      mdc: null,
      ...this.noiseFloorOverride,
    };
    return Promise.resolve(ok({ value, engineVersion: "engines-test" }));
  }
}
