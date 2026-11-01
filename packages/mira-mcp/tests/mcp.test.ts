import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import type { Engines } from "../src/engines";
import { authenticate, parseTokens, UnitLedger, type TokenRecord } from "../src/tokens";

const SECRET = "tok_partner_a_0123456789";
const TOKENS: TokenRecord[] = [{ token: SECRET, name: "partner-a", dailyUnits: 4 }];

/** A scripted stand-in for the engines, recording what it was asked. */
function fakeEngines(
  over: Record<string, unknown> = {},
): Engines & { calls: { path: string; body: unknown }[] } {
  const calls: { path: string; body: unknown }[] = [];
  const answers: Record<string, unknown> = {
    "/colour/lab": (body: { hex: string[] }) =>
      body.hex.map((hex, i) => ({ hex, lab: [60 + i, 10, 20] })),
    "/shade/prerank": (body: { catalogue: { id: string; name: string }[] }) =>
      body.catalogue.map((c, i) => ({
        id: c.id,
        name: c.name,
        de: 1 + i,
        label: i === 0 ? "blends_closely" : "lighter",
      })),
    "/stats/noise-floor": {
      sessions: 3,
      captures_per_session: 3,
      s_w: 1,
      s_d: 0.8,
      s_d_source: "estimated",
      se: 1.1,
      mdc: 3.1,
    },
    "/stats/change": { delta: 5, words: "clear", phrase: "a clear change" },
    "/audit/lip": { label: "verified", de: 1.2 },
    "/audit/identity": { drift: 0.12, passed: false },
    ...over,
  };
  const engines: Engines = {
    call(path, body, schema) {
      calls.push({ path, body });
      const a = answers[path];
      const value = typeof a === "function" ? (a as (b: unknown) => unknown)(body) : a;
      const parsed = schema.safeParse(value);
      return Promise.resolve(
        parsed.success
          ? { ok: true as const, value: parsed.data, engineVersion: "test" }
          : { ok: false as const },
      );
    },
  };
  return Object.assign(engines, { calls });
}

let closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(closers.map((c) => c()));
  closers = [];
});

async function connect(
  options: { engines?: Engines; token?: string; tokens?: TokenRecord[]; ledger?: UnitLedger } = {},
) {
  const ctx = buildApp(
    {},
    {
      engines: options.engines ?? fakeEngines(),
      tokens: options.tokens ?? TOKENS,
      ...(options.ledger ? { ledger: options.ledger } : {}),
    },
  );
  await ctx.app.listen({ port: 0, host: "127.0.0.1" });
  const port = (ctx.app.server.address() as { port: number }).port;
  const client = new Client({ name: "test", version: "0" });
  const token = options.token ?? SECRET;
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${String(port)}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  closers.push(async () => {
    await client.close();
    await ctx.app.close();
  });
  return { client, ctx, port };
}

const call = async (client: Client, name: string, args: Record<string, unknown>) =>
  (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    structuredContent?: Record<string, unknown>;
    content: { text: string }[];
  };

describe("tokens", () => {
  it("parses token:name:units and drops what is malformed or too short to be a secret", () => {
    expect(parseTokens(`${SECRET}:a:10, short:b:5, ${SECRET}x:c:-1, ${SECRET}y:d:abc`)).toEqual([
      { token: SECRET, name: "a", dailyUnits: 10 },
    ]);
    expect(parseTokens(undefined)).toEqual([]);
  });

  it("matches a bearer header exactly, and nothing else", () => {
    expect(authenticate(`Bearer ${SECRET}`, TOKENS)?.name).toBe("partner-a");
    for (const h of [
      undefined,
      "",
      SECRET,
      `Basic ${SECRET}`,
      `Bearer ${SECRET}x`,
      `Bearer ${SECRET.slice(1)}`,
      "Bearer ",
    ]) {
      expect(authenticate(h, TOKENS)).toBeUndefined();
    }
  });

  it("takes units per token per day, and a new day starts again", () => {
    let now = Date.parse("2026-11-01T10:00:00Z");
    const ledger = new UnitLedger(() => now);
    expect(ledger.spend(TOKENS[0] as TokenRecord, 3)).toEqual({ ok: true, left: 1 });
    expect(ledger.spend(TOKENS[0] as TokenRecord, 2)).toEqual({ ok: false, left: 1 });
    expect(ledger.used_today(SECRET)).toBe(3);
    now = Date.parse("2026-11-02T00:00:01Z");
    expect(ledger.spend(TOKENS[0] as TokenRecord, 4)).toEqual({ ok: true, left: 0 });
  });
});

describe("the server", () => {
  it("needs a bearer token", async () => {
    const ctx = buildApp({}, { engines: fakeEngines(), tokens: TOKENS });
    for (const headers of [{}, { authorization: "Bearer nope" }]) {
      const res = await ctx.app.inject({
        method: "POST",
        url: "/mcp",
        headers,
        payload: { jsonrpc: "2.0", id: 1, method: "tools/list" },
      });
      expect(res.statusCode).toBe(401);
      expect(res.headers["www-authenticate"]).toContain("Bearer");
    }
    expect((await ctx.app.inject({ method: "GET", url: "/mcp" })).statusCode).toBe(405);
    await ctx.app.close();
  });

  it("with no tokens configured nobody gets in", async () => {
    const ctx = buildApp({}, { engines: fakeEngines(), tokens: [] });
    const res = await ctx.app.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization: `Bearer ${SECRET}` },
      payload: {},
    });
    expect(res.statusCode).toBe(401);
    await ctx.app.close();
  });

  it("offers exactly the four tools, each marked read-only", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "audit_render",
      "explain_metric",
      "measure_change",
      "shade_match",
    ]);
    for (const t of tools) expect(t.annotations?.readOnlyHint).toBe(true);
  });
});

describe("shade_match", () => {
  const shades = [
    { id: "a", name: "Honey", hex: "#C99870" },
    { id: "b", name: "Sand", hex: "#D9AE8A" },
    { id: "c", name: "Ivory", hex: "#E8C4A5" },
  ];

  it("ranks the shades it is given by the engines' colour difference", async () => {
    const { client } = await connect();
    const r = await call(client, "shade_match", { skin_hex: "#C79A78", shades, top: 2 });
    expect(r.isError).toBeUndefined();
    const ranked = r.structuredContent?.ranked as { id: string; de2000: number; reads: string }[];
    expect(ranked.map((x) => x.id)).toEqual(["a", "b"]);
    expect(ranked[0]).toMatchObject({ de2000: 1, reads: "blends_closely" });
    expect(r.structuredContent?.checked).toBe(3);
  });

  it("refuses a colour that is not #RRGGBB and a list that is too long", async () => {
    const { client } = await connect();
    await expect(call(client, "shade_match", { skin_hex: "tan", shades })).resolves.toMatchObject({
      isError: true,
    });
    const many = Array.from({ length: 201 }, (_, i) => ({
      id: String(i),
      name: "x",
      hex: "#C99870",
    }));
    await expect(
      call(client, "shade_match", { skin_hex: "#C79A78", shades: many }),
    ).resolves.toMatchObject({ isError: true });
  });
});

describe("measure_change", () => {
  const baseline = [
    [58, 59, 58],
    [60, 59, 60],
    [58, 59, 59],
  ];

  it("says whether a change is bigger than the person's own variation, with the numbers behind it", async () => {
    const { client } = await connect();
    const r = await call(client, "measure_change", {
      baseline_sessions: baseline,
      now_captures: [66, 65, 67],
    });
    expect(r.structuredContent).toMatchObject({ words: "clear", minimal_detectable_change: 3.1 });
    expect(r.structuredContent?.note).toMatch(/does not mean the product does not work/);
  });

  it("needs three baseline sessions of the same size", async () => {
    const { client } = await connect();
    await expect(
      call(client, "measure_change", {
        baseline_sessions: baseline.slice(0, 2),
        now_captures: [60, 61],
      }),
    ).resolves.toMatchObject({ isError: true });
    await expect(
      call(client, "measure_change", {
        baseline_sessions: [
          [58, 59],
          [60, 59, 60],
          [58, 59, 59],
        ],
        now_captures: [60, 61],
      }),
    ).resolves.toMatchObject({ isError: true });
  });
});

describe("audit_render", () => {
  it("checks a lip colour against the intended one", async () => {
    const { client } = await connect();
    const r = await call(client, "audit_render", {
      check: "lip",
      rendered_hex: "#B35468",
      intended_hex: "#B5566A",
    });
    expect(r.structuredContent).toMatchObject({ check: "lip", label: "verified", de2000: 1.2 });
  });

  it("says a render whose face changed too much should be withheld", async () => {
    const { client } = await connect();
    const r = await call(client, "audit_render", {
      check: "identity",
      source_ratios: [1.3, 0.33],
      final_ratios: [1.5, 0.33],
    });
    expect(r.structuredContent).toMatchObject({ within_limit: false, withhold_render: true });
  });

  it("asks for what a check needs, and for matching lengths", async () => {
    const { client } = await connect();
    await expect(call(client, "audit_render", { check: "lip" })).resolves.toMatchObject({
      isError: true,
    });
    await expect(
      call(client, "audit_render", { check: "identity", source_ratios: [1, 2], final_ratios: [1] }),
    ).resolves.toMatchObject({ isError: true });
    await expect(
      call(client, "audit_render", { check: "garment", garment_hex: "#9E1F2D" }),
    ).resolves.toMatchObject({ isError: true });
  });

  it("refuses an image too large to decode safely", async () => {
    const { client } = await connect();
    const big = "A".repeat(5_600_001);
    await expect(
      call(client, "audit_render", {
        check: "garment",
        source_image_b64: big,
        render_image_b64: big,
        garment_hex: "#9E1F2D",
      }),
    ).resolves.toMatchObject({ isError: true });
  });
});

describe("explain_metric", () => {
  it("defines a metric, and says when it does not know one", async () => {
    const { client } = await connect();
    const ok = await call(client, "explain_metric", { metric_id: "skin.hd_pore.whole" });
    expect(ok.structuredContent?.definition).toBeTypeOf("string");
    await expect(
      call(client, "explain_metric", { metric_id: "made.up.thing" }),
    ).resolves.toMatchObject({ isError: true });
    await expect(
      call(client, "explain_metric", { metric_id: "Not A Metric" }),
    ).resolves.toMatchObject({ isError: true });
  });

  it("is free", async () => {
    const ledger = new UnitLedger();
    const { client } = await connect({ ledger });
    for (let i = 0; i < 10; i++) await call(client, "explain_metric", { metric_id: "colour.skin" });
    expect(ledger.used_today(SECRET)).toBe(0);
  });
});

describe("unit caps", () => {
  it("each token has a daily cap; a call over it takes nothing and says how many are left", async () => {
    const ledger = new UnitLedger();
    const engines = fakeEngines();
    const { client } = await connect({ engines, ledger });
    const args = { skin_hex: "#C79A78", shades: [{ id: "a", name: "Honey", hex: "#C99870" }] };
    for (let i = 0; i < 4; i++)
      expect((await call(client, "shade_match", args)).isError).toBeUndefined();
    const before = engines.calls.length;
    const over = await call(client, "shade_match", args);
    expect(over.isError).toBe(true);
    expect(over.content[0]?.text).toMatch(/0 of its daily units left/);
    // The engines were not asked, and nothing more was taken.
    expect(engines.calls).toHaveLength(before);
    expect(ledger.used_today(SECRET)).toBe(4);
  });

  it("a garment check costs more than a lip check", async () => {
    const ledger = new UnitLedger();
    const { client } = await connect({
      ledger,
      tokens: [{ token: SECRET, name: "p", dailyUnits: 2 }],
    });
    const r = await call(client, "audit_render", {
      check: "garment",
      source_image_b64: "A".repeat(200),
      render_image_b64: "A".repeat(200),
      garment_hex: "#9E1F2D",
    });
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toMatch(/needs 3/);
    expect(ledger.used_today(SECRET)).toBe(0);
  });

  it("when the engines cannot be reached, no units are lost to it", async () => {
    const ledger = new UnitLedger();
    const engines = { call: () => Promise.resolve({ ok: false as const }) } as unknown as Engines;
    const { client } = await connect({ engines, ledger });
    const r = await call(client, "shade_match", {
      skin_hex: "#C79A78",
      shades: [{ id: "a", name: "Honey", hex: "#C99870" }],
    });
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toMatch(/could not be reached/);
  });
});
