import { BrandCatalogue, ShadeRange } from "@mira/schemas";
import { z } from "zod";

/** What the brand routes answer, parsed at the boundary. */
const GapCell = z.object({
  hueLo: z.number(),
  hueHi: z.number(),
  lLo: z.number(),
  lHi: z.number(),
  share: z.number(),
  unservedShare: z.number(),
});

export const GapView = z.discriminatedUnion("state", [
  z.object({ state: z.literal("hidden"), message: z.string() }),
  z.object({
    state: z.literal("ok"),
    shoppers: z.number(),
    unservedShare: z.number(),
    nearDe: z.number(),
    calibrated: z.boolean(),
    cells: z.array(GapCell),
    hiddenCells: z.number(),
    shades: z.array(
      z.object({ id: z.string(), name: z.string(), hex: z.string(), l: z.number(), h: z.number() }),
    ),
  }),
]);
export type GapView = z.infer<typeof GapView>;

export const EfficacyCell = z.object({
  product: z.string(),
  concern: z.string(),
  group: z.string(),
  hidden: z.boolean(),
  completed: z.number().optional(),
  detectedShare: z.number().optional(),
});
export const AttachCell = z.object({
  pairing: z.string(),
  hidden: z.boolean(),
  looks: z.number().optional(),
  savedShare: z.number().optional(),
});

export const Summary = z.union([
  z.object({
    catalogue: z.null(),
    recorded: z.boolean(),
    k: z.number(),
  }),
  z.object({
    catalogue: BrandCatalogue,
    recorded: z.boolean(),
    recordedParts: z.object({ gap: z.boolean(), efficacy: z.boolean(), attach: z.boolean() }),
    k: z.number(),
    gap: GapView,
    efficacy: z.array(EfficacyCell),
    attach: z.array(AttachCell),
  }),
]);
export type Summary = z.infer<typeof Summary>;

export const ExtractReply = z.object({ range: ShadeRange });

/** A spreadsheet cell that starts like a formula would run as one in a spreadsheet program. */
export const csvCell = (value: string | number): string => {
  const s = String(value);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
};

export const toCsv = (rows: readonly (readonly (string | number)[])[]): string =>
  rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
