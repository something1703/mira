// Written from the OpenAPI bundles downloaded 2026-11-01 (docs v1.17; see openapi/SOURCES.md).
import { z } from "zod";

/**
 * `makeup-vto` request, from the bundle. With no `skin_smooth` effect the API smooths at strength
 * 50 (docs/FACTS.md F1), so MIRA always sends one, at 0, unless the person opted in (AGENTS §2.5).
 */
const Hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Expected #RRGGBB");
const pct = z.number().int().min(0).max(100);

export const FoundationEffect = z.object({
  category: z.literal("foundation"),
  palettes: z
    .array(
      z.object({ color: Hex, colorIntensity: pct, glowIntensity: pct, coverageIntensity: pct }),
    )
    .min(1),
});

export const ConcealerEffect = z.object({
  category: z.literal("concealer"),
  palettes: z
    .array(
      z.object({
        color: Hex,
        colorIntensity: pct,
        colorUnderEyeIntensity: pct,
        coverageLevel: pct,
      }),
    )
    .min(1),
});

export const LipColorEffect = z.object({
  category: z.literal("lip_color"),
  shape: z.object({ name: z.string().min(1) }),
  style: z.object({
    type: z.enum(["full", "ombre", "twoTone"]),
    innerColorRatio: pct.optional(),
    blendStrength: pct.optional(),
  }),
  palettes: z
    .array(
      z.object({
        color: Hex,
        texture: z.enum(["matte", "gloss", "holographic", "metallic", "satin", "sheer", "shimmer"]),
        colorIntensity: pct,
        gloss: pct.optional(),
      }),
    )
    .min(1),
});

export const BlushEffect = z.object({
  category: z.literal("blush"),
  pattern: z.object({ name: z.string().min(1) }),
  palettes: z
    .array(
      z.object({
        color: Hex,
        texture: z.enum(["matte", "satin", "shimmer"]),
        colorIntensity: pct,
        glowStrength: pct.optional(),
      }),
    )
    .min(1),
});

/**
 * Callers describe the makeup; they cannot send `skin_smooth` themselves. Smoothing is the
 * separate, explicit `smoothing` param below.
 */
export const MakeupEffect = z.discriminatedUnion("category", [
  FoundationEffect,
  ConcealerEffect,
  LipColorEffect,
  BlushEffect,
]);
export type MakeupEffect = z.infer<typeof MakeupEffect>;

export const MakeupParams = z.object({
  effects: z.array(MakeupEffect).min(1),
  /** Opt-in smoothing. Omitted means off. Renders that use it must be labelled as smoothed. */
  smoothing: z.object({ strength: z.number().int().min(1).max(100) }).optional(),
});
export type MakeupParams = z.infer<typeof MakeupParams>;

export function buildMakeupBody(
  params: MakeupParams,
  src: Record<string, string>,
): Record<string, unknown> {
  const strength = params.smoothing?.strength ?? 0;
  return {
    ...src,
    version: "1.0",
    effects: [
      { category: "skin_smooth", skinSmoothStrength: strength, skinSmoothColorIntensity: strength },
      ...params.effects,
    ],
  };
}
