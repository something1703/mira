import { DISCLAIMER, explain, MetricId, type Metric } from "@mira/schemas";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  Change,
  ColourRead,
  GarmentAudit,
  IdentityAudit,
  LipAudit,
  NoiseFloor,
  Prerank,
  type Engines,
} from "./engines";
import type { TokenRecord, UnitLedger } from "./tokens";

/**
 * The four tools MIRA offers other agents (docs/AGENT_RUNTIME.md §8). They are measurements, not
 * actions: each reads what it is given, asks the engines, and answers with the numbers and the
 * thresholds that decided them. None starts a YouCam run, stores anything, or takes a face: an
 * image arrives only to be compared and is dropped with the call.
 */
export const COSTS = {
  shade_match: 1,
  measure_change: 1,
  audit_lip: 1,
  audit_identity: 1,
  audit_garment: 3,
  explain_metric: 0,
} as const;

const Hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "A colour as #RRGGBB");
/** A picture sent to be compared: base64, JPEG or PNG, small enough to decode safely. */
const Image = z.string().min(100).max(5_600_000);

const text = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
  structuredContent: value as Record<string, unknown>,
});
const fail = (message: string) => ({
  isError: true as const,
  content: [{ type: "text" as const, text: message }],
});

export interface ToolContext {
  engines: Engines;
  ledger: UnitLedger;
  token: TokenRecord;
}

export function buildServer(ctx: ToolContext): McpServer {
  const server = new McpServer(
    { name: "mira", version: "0.1.0" },
    {
      instructions: `MIRA measures colour and change. Tools return numbers and the thresholds that decided them. No image is kept. ${DISCLAIMER}`,
    },
  );

  /** Takes the tool's units from the token's day, or answers that the day's units are used. */
  const charge = (units: number) => {
    const r = ctx.ledger.spend(ctx.token, units);
    return r.ok
      ? undefined
      : fail(
          `This token has ${String(r.left)} of its daily units left, and this call needs ${String(units)}. Try again tomorrow.`,
        );
  };
  const unavailable = () =>
    fail("The measurement service could not be reached. No units were taken for this call.");

  server.registerTool(
    "shade_match",
    {
      title: "Match a skin colour to shades",
      description:
        "Ranks shades by how close each is to a skin colour (ΔE2000 in CIELAB) and says in words which way a shade differs. Free of YouCam units; takes 1 MIRA unit. The ranking is of the shades you pass, nothing else.",
      inputSchema: {
        skin_hex: Hex,
        shades: z
          .array(
            z.object({ id: z.string().min(1).max(60), name: z.string().min(1).max(80), hex: Hex }),
          )
          .min(1)
          .max(200),
        top: z.number().int().min(1).max(20).default(5),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ skin_hex, shades, top }) => {
      const over = charge(COSTS.shade_match);
      if (over) return over;
      const labs = await ctx.engines.call(
        "/colour/lab",
        { hex: [skin_hex, ...shades.map((s) => s.hex)] },
        ColourRead,
      );
      if (!labs.ok || labs.value.length !== shades.length + 1) return unavailable();
      const [skin, ...rest] = labs.value;
      if (!skin) return unavailable();
      const ranked = await ctx.engines.call(
        "/shade/prerank",
        {
          skin: skin.lab,
          catalogue: shades.map((s, i) => ({
            id: s.id,
            name: s.name,
            lab: rest[i]?.lab ?? [0, 0, 0],
          })),
        },
        Prerank,
      );
      if (!ranked.ok) return unavailable();
      return text({
        ranked: ranked.value.slice(0, top).map((r) => ({
          id: r.id,
          name: r.name,
          de2000: Math.round(r.de * 100) / 100,
          reads: r.label,
        })),
        checked: shades.length,
        engine_version: ranked.engineVersion,
        note: "ΔE2000 is a colour difference; below about 2 is hard to tell apart. This ranks colours, it does not render anything.",
      });
    },
  );

  server.registerTool(
    "measure_change",
    {
      title: "Is a change bigger than day-to-day variation?",
      description:
        "Given raw Skin Analysis scores (1 to 100, higher is healthier-looking) from at least three baseline sessions of several captures each, and the captures of a later session, says whether the change is within the person's own variation. Takes 1 MIRA unit.",
      inputSchema: {
        baseline_sessions: z
          .array(z.array(z.number().min(1).max(100)).min(2).max(5))
          .min(3)
          .max(60),
        now_captures: z.array(z.number().min(1).max(100)).min(2).max(5),
        claim_direction: z.enum(["up", "down"]).default("up"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ baseline_sessions, now_captures, claim_direction }) => {
      const k = baseline_sessions[0]?.length ?? 0;
      if (baseline_sessions.some((s) => s.length !== k)) {
        return fail("Every baseline session needs the same number of captures.");
      }
      const over = charge(COSTS.measure_change);
      if (over) return over;
      const floor = await ctx.engines.call(
        "/stats/noise-floor",
        { sessions: baseline_sessions },
        NoiseFloor,
      );
      if (!floor.ok) return unavailable();
      const mean = (xs: readonly number[]) => xs.reduce((n, x) => n + x, 0) / xs.length;
      const baseline = mean(baseline_sessions.slice(0, 3).map(mean));
      const change = await ctx.engines.call(
        "/stats/change",
        { baseline, now: mean(now_captures), mdc: floor.value.mdc, claim_direction },
        Change,
      );
      if (!change.ok) return unavailable();
      return text({
        words: change.value.words,
        phrase: change.value.phrase,
        delta: Math.round(change.value.delta * 100) / 100,
        baseline: Math.round(baseline * 100) / 100,
        minimal_detectable_change: floor.value.mdc,
        day_to_day_variation: {
          within_session: floor.value.s_w,
          between_days: floor.value.s_d,
          source: floor.value.s_d_source,
        },
        engine_version: change.engineVersion,
        note: "'within' means the change cannot be told apart from this person's own variation. It does not mean the product does not work.",
      });
    },
  );

  server.registerTool(
    "audit_render",
    {
      title: "Check a render against what was asked for",
      description:
        "Checks one thing about a render: 'lip' compares the rendered lip colour with the intended one; 'identity' compares face ratio vectors before and after; 'garment' compares the colour of the garment on a person with the product's colour. Images are compared and dropped. Takes 1 MIRA unit (3 for a garment).",
      inputSchema: {
        check: z.enum(["lip", "identity", "garment"]),
        rendered_hex: Hex.optional(),
        intended_hex: Hex.optional(),
        source_ratios: z.array(z.number().positive()).min(1).max(64).optional(),
        final_ratios: z.array(z.number().positive()).min(1).max(64).optional(),
        source_image_b64: Image.optional(),
        render_image_b64: Image.optional(),
        garment_hex: Hex.optional(),
        face_box: z
          .object({
            x: z.number().int().min(0),
            y: z.number().int().min(0),
            width: z.number().int().min(1),
            height: z.number().int().min(1),
          })
          .optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (a) => {
      if (a.check === "lip") {
        if (!a.rendered_hex || !a.intended_hex)
          return fail("A lip check needs rendered_hex and intended_hex.");
        const over = charge(COSTS.audit_lip);
        if (over) return over;
        const labs = await ctx.engines.call(
          "/colour/lab",
          { hex: [a.rendered_hex, a.intended_hex] },
          ColourRead,
        );
        const [r, i] = labs.ok ? labs.value : [];
        if (!labs.ok || !r || !i) return unavailable();
        const out = await ctx.engines.call(
          "/audit/lip",
          { rendered: r.lab, intended: i.lab },
          LipAudit,
        );
        return out.ok
          ? text({
              check: "lip",
              label: out.value.label,
              de2000: out.value.de,
              engine_version: out.engineVersion,
            })
          : unavailable();
      }
      if (a.check === "identity") {
        if (
          !a.source_ratios ||
          !a.final_ratios ||
          a.source_ratios.length !== a.final_ratios.length
        ) {
          return fail("An identity check needs source_ratios and final_ratios of the same length.");
        }
        const over = charge(COSTS.audit_identity);
        if (over) return over;
        const out = await ctx.engines.call(
          "/audit/identity",
          { source: a.source_ratios, final: a.final_ratios },
          IdentityAudit,
        );
        return out.ok
          ? text({
              check: "identity",
              drift: out.value.drift,
              within_limit: out.value.passed,
              withhold_render: !out.value.passed,
              engine_version: out.engineVersion,
            })
          : unavailable();
      }
      if (!a.source_image_b64 || !a.render_image_b64 || !a.garment_hex) {
        return fail("A garment check needs source_image_b64, render_image_b64 and garment_hex.");
      }
      const over = charge(COSTS.audit_garment);
      if (over) return over;
      const lab = await ctx.engines.call("/colour/lab", { hex: [a.garment_hex] }, ColourRead);
      const g = lab.ok ? lab.value[0] : undefined;
      if (!lab.ok || !g) return unavailable();
      const out = await ctx.engines.call(
        "/audit/garment",
        {
          source_b64: a.source_image_b64,
          render_b64: a.render_image_b64,
          garment_labs: [g.lab],
          ...(a.face_box ? { face_box: a.face_box } : {}),
        },
        GarmentAudit,
      );
      return out.ok
        ? text({
            check: "garment",
            label: out.value.label,
            de2000: out.value.de ?? null,
            direction: out.value.direction ?? null,
            reason: out.value.reason,
            engine_version: out.engineVersion,
          })
        : unavailable();
    },
  );

  server.registerTool(
    "explain_metric",
    {
      title: "What a MIRA metric means",
      description:
        "Defines a metric id such as skin.hd_pore.whole or colour.skin and says how it is measured. Free.",
      inputSchema: { metric_id: MetricId },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ metric_id }) => {
      const e = explain(metric_id, undefined as Metric | undefined);
      return e ? text({ metric_id, ...e }) : fail("MIRA does not know that metric id.");
    },
  );

  return server;
}
