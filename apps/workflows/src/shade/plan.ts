import {
  CONFIG,
  Twin,
  err,
  ok,
  type Coverage,
  type Finish,
  type PrerankedShade,
  type Result,
  type ShadeRange,
} from "@mira/schemas";
import { getDoc, type Ports } from "@mira/runtime";
import type { EngineClient, LabTuple } from "../twin/engine-client";
import { twinPath } from "../twin/profile";

/**
 * Everything decided before a unit is spent on a shade match (docs/ENGINES.md §4.1 and §4.3):
 * which of the range's shades are closest to the person's measured skin, and what finish and
 * coverage to render them in. It reads the Twin and calls the engines; it calls YouCam never.
 */
export type PlanError =
  { code: "no_profile" } | { code: "no_skin_colour" } | { code: "engine_failed"; detail: string };

export interface ShadePlan {
  skinLab: LabTuple;
  /** Every shade of the range, closest first, with its Lab. */
  ranked: PrerankedShade[];
  /** How many shades were checked at no cost (the whole range). */
  checkedFree: number;
  finish: Finish;
  finishReason: string;
  coverage: Coverage;
  coverageReason: string;
  tZoneNote: boolean;
  concealerSuggested: boolean;
}

/** The concern scores the coverage rule reads, from the profile's metric ids (docs/ENGINES.md §4.3). */
const COVERAGE_CONCERNS = ["acne", "age_spot", "redness"] as const;

export async function readSkin(
  ports: Pick<Ports, "state">,
  userId: string,
): Promise<
  Result<
    { skinLab: LabTuple; scores: Record<string, number> },
    Extract<PlanError, { code: "no_profile" | "no_skin_colour" }>
  >
> {
  const twin = await getDoc(ports.state, twinPath(userId), Twin);
  if (!twin) return err({ code: "no_profile" });
  const colour = twin.metrics["colour.skin"];
  if (colour?.kind !== "colour") return err({ code: "no_skin_colour" });
  const scores: Record<string, number> = {};
  for (const concern of COVERAGE_CONCERNS) {
    const m = twin.metrics[`skin.hd_${concern}.whole`] ?? twin.metrics[`skin.${concern}.whole`];
    if (m?.kind === "number") scores[concern] = m.value;
  }
  // Dark circles are read per eye; the lower reading is the one that decides.
  const circles = Object.values(twin.metrics).flatMap((m) =>
    /^skin\.(hd_)?dark_circle(_v2)?\./.test(m.id) && m.kind === "number" ? [m.value] : [],
  );
  if (circles.length > 0) scores.dark_circle = Math.min(...circles);
  return ok({ skinLab: colour.lab, scores });
}

export async function planShade(
  ports: Pick<Ports, "state">,
  engine: EngineClient,
  userId: string,
  range: ShadeRange,
): Promise<Result<ShadePlan, PlanError>> {
  const skin = await readSkin(ports, userId);
  if (!skin.ok) return skin;

  const labs = await engine.colourLab(range.shades.map((s) => s.hex));
  if (!labs.ok) return err({ code: "engine_failed", detail: labs.error.code });
  const labOf = new Map<string, LabTuple>();
  range.shades.forEach((s, i) => {
    const r = labs.value.value[i];
    if (r) labOf.set(s.id, r.lab);
  });

  const ranked = await engine.shadePrerank(
    skin.value.skinLab,
    range.shades.flatMap((s) => {
      const lab = labOf.get(s.id);
      return lab ? [{ id: s.id, name: s.name, lab }] : [];
    }),
  );
  if (!ranked.ok) return err({ code: "engine_failed", detail: ranked.error.code });

  const byId = new Map(range.shades.map((s) => [s.id, s]));
  const out: PrerankedShade[] = [];
  for (const r of ranked.value.value) {
    const shade = byId.get(r.id);
    const lab = labOf.get(r.id);
    if (!shade || !lab) continue;
    out.push({
      id: r.id,
      name: r.name,
      hex: shade.hex,
      lab,
      de: r.de,
      dLightness: r.d_lightness,
      dHue: r.d_hue,
      label: r.label,
    });
  }

  // MIRA reads no skin-type label yet: YouCam returns a score and documents no mapping (F34), so
  // the finish rule runs on "no skin type" and says so rather than guessing one.
  const style = await engine.finish(null, skin.value.scores);
  if (!style.ok) return err({ code: "engine_failed", detail: style.error.code });
  const f = style.value.value;
  return ok({
    skinLab: skin.value.skinLab,
    ranked: out,
    checkedFree: out.length,
    finish: f.finishes[0] ?? "satin",
    finishReason: f.finish_reason,
    coverage: f.coverage,
    coverageReason: f.coverage_reason,
    tZoneNote: f.t_zone_note,
    concealerSuggested: f.concealer_suggested,
  });
}

/** How many shades to render: the person's choice, held between 1 and the maximum. */
export const clampTopN = (n: number | undefined): number =>
  Math.min(CONFIG.shade.renderTopNMax.value, Math.max(1, n ?? CONFIG.shade.renderTopN.value));
