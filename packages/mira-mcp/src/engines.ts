import { Identity } from "@mira/runtime/identity";
import { z } from "zod";

/**
 * The engines MIRA's MCP tools stand on (docs/ENGINES.md). One small client: every call returns a
 * value, never throws, and every reply is parsed. The same engines the web app uses answer here,
 * so an outside agent gets the same measurement, with the same thresholds echoed.
 */
export type EngineReply<T> = { ok: true; value: T; engineVersion: string } | { ok: false };

export interface Engines {
  call<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<EngineReply<T>>;
}

export function httpEngines(
  base: string,
  options: { live: boolean; identity?: Identity; fetch?: typeof fetch } = { live: false },
): Engines {
  const identity = options.identity ?? new Identity();
  const doFetch = options.fetch ?? fetch;
  return {
    async call(path, body, schema) {
      try {
        const auth = options.live ? await identity.headers(base) : {};
        const res = await doFetch(new URL(path, base), {
          method: "POST",
          headers: { "content-type": "application/json", ...auth },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) return { ok: false };
        const json = (await res.json()) as { engine_version?: unknown; result?: unknown };
        const parsed = schema.safeParse(json.result);
        return parsed.success
          ? {
              ok: true,
              value: parsed.data,
              engineVersion:
                typeof json.engine_version === "string" ? json.engine_version : "unknown",
            }
          : { ok: false };
      } catch {
        return { ok: false };
      }
    },
  };
}

const Lab = z.tuple([z.number(), z.number(), z.number()]);
export type Lab = z.infer<typeof Lab>;

export const ColourRead = z.array(z.object({ hex: z.string(), lab: Lab }).loose());
export const Prerank = z.array(
  z.object({ id: z.string(), name: z.string(), de: z.number(), label: z.string() }).loose(),
);
export const NoiseFloor = z
  .object({
    sessions: z.number(),
    captures_per_session: z.number(),
    s_w: z.number(),
    s_d: z.number().nullable(),
    s_d_source: z.string(),
    se: z.number().nullable(),
    mdc: z.number().nullable(),
  })
  .loose();
export const Change = z.object({ delta: z.number(), words: z.string(), phrase: z.string() });
export const GarmentAudit = z
  .object({
    label: z.string(),
    de: z.number().nullable().optional(),
    direction: z.string().nullable().optional(),
    reason: z.string(),
  })
  .loose();
export const LipAudit = z.object({ label: z.string(), de: z.number() });
export const IdentityAudit = z.object({ drift: z.number(), passed: z.boolean() });
