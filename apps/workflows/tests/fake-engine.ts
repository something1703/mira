import { err, ok } from "@mira/schemas";
import type {
  ColourReading,
  EngineClient,
  EngineFailure,
  NoiseFloorReading,
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

  colourLab(hex: readonly string[]) {
    this.colourCalls.push([...hex]);
    if (this.failColour) return Promise.resolve(err(this.failColour));
    const value: ColourReading[] = hex.map((h) => ({
      hex: h,
      lab: [60, 12, 24],
      lch: { l: 60, c: 26.8, h: 63.4 },
      ita: 41.2,
      ita_band: "light",
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
