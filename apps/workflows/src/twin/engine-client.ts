import { z } from "zod";
import { err, ok, type Result } from "@mira/schemas";

/**
 * The workflows service's way of calling the measurement engines (docs/ENGINES.md). A port, so a
 * test or mock-mode run can use `LocalEngineClient` and live uses `HttpEngineClient`. Every call
 * returns a value, never throws: a failed engine call becomes a failed node with a code.
 */

export const ColourReading = z.object({
  hex: z.string(),
  lab: z.tuple([z.number(), z.number(), z.number()]),
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

export interface EngineFailure {
  code: "engine_unreachable" | "engine_rejected" | "engine_bad_reply";
  retryable: boolean;
}

/** Every reply carries the engine version and config so a result can be reproduced. */
export interface Enveloped<T> {
  value: T;
  engineVersion: string;
}

export interface EngineClient {
  /** sRGB hex → Lab, LCh, ITA° and the ITA band. Order is preserved. */
  colourLab(hex: readonly string[]): Promise<Result<Enveloped<ColourReading[]>, EngineFailure>>;
  /** One session of repeated captures per concern: sessions[i] holds that session's scores. */
  noiseFloor(
    sessions: readonly (readonly number[])[],
  ): Promise<Result<Enveloped<NoiseFloorReading>, EngineFailure>>;
}

const envelope = <T extends z.ZodType>(result: T) =>
  z.object({ engine_version: z.string(), result }).loose();

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
    });
  }
}
