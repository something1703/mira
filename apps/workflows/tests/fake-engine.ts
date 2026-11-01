import { err, ok } from "@mira/schemas";
import type {
  ClosedLoopReading,
  ColourReading,
  EngineClient,
  EngineFailure,
  FinishReading,
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
  failShade: EngineFailure | undefined;

  /** What the shade endpoints answer next; tests set these to script a case. */
  prerank:
    ((skin: LabTuple, catalogue: { id: string; lab: LabTuple }[]) => PrerankReading[]) | undefined;
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
    };
    return Promise.resolve(ok({ value, engineVersion: "engines-test" }));
  }
}
