import { describe, expect, it } from "vitest";
import { HttpEngineClient } from "../src/twin/engine-client";

const reply = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  );

function client(fetchImpl: typeof fetch) {
  return new HttpEngineClient({
    baseUrl: "http://engines.test",
    fetch: fetchImpl,
    headers: () => Promise.resolve({ authorization: "Bearer t" }),
  });
}

describe("HttpEngineClient", () => {
  it("posts hexes and parses the enveloped Lab readings", async () => {
    let seen: { url: string; body: unknown; auth: string | null } | undefined;
    const c = client(((url: URL, init: RequestInit) => {
      seen = {
        url: String(url),
        body: JSON.parse(init.body as string),
        auth: new Headers(init.headers).get("authorization"),
      };
      return reply({
        engine_version: "1.2.3",
        config: {},
        result: [
          {
            hex: "#C79A78",
            lab: [70, 12, 24],
            lch: { l: 70, c: 26, h: 63 },
            ita: 39,
            ita_band: "intermediate",
          },
        ],
      });
    }) as typeof fetch);
    const res = await c.colourLab(["#C79A78"]);
    expect(seen).toEqual({
      url: "http://engines.test/colour/lab",
      body: { hex: ["#C79A78"] },
      auth: "Bearer t",
    });
    expect(res.ok && res.value.engineVersion).toBe("1.2.3");
    expect(res.ok && res.value.value[0]?.ita_band).toBe("intermediate");
  });

  it("parses a noise floor with null spread", async () => {
    const c = client(() =>
      reply({
        engine_version: "v",
        result: {
          sessions: 1,
          captures_per_session: 3,
          s_w: 1.2,
          s_d: null,
          s_d_source: "unknown",
          se: null,
          mdc: null,
        },
      }),
    );
    const res = await c.noiseFloor([[40, 42, 41]]);
    expect(res.ok && res.value.value).toMatchObject({ s_w: 1.2, mdc: null });
  });

  it("maps failures to values: unreachable retries, a rejection does not, a bad reply does not", async () => {
    const down = client(() => Promise.reject(new Error("econnrefused")));
    expect(await down.colourLab(["#000000"])).toEqual({
      ok: false,
      error: { code: "engine_unreachable", retryable: true },
    });
    const busy = client(() => reply({}, 503));
    expect(await busy.colourLab(["#000000"])).toEqual({
      ok: false,
      error: { code: "engine_unreachable", retryable: true },
    });
    const rejected = client(() => reply({ detail: "no" }, 422));
    expect(await rejected.colourLab(["#000000"])).toEqual({
      ok: false,
      error: { code: "engine_rejected", retryable: false },
    });
    const garbled = client(() => reply({ engine_version: "v", result: "oops" }));
    expect(await garbled.noiseFloor([[1, 2]])).toEqual({
      ok: false,
      error: { code: "engine_bad_reply", retryable: false },
    });
  });
});
