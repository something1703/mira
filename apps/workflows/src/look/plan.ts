import {
  CONFIG,
  Twin,
  err,
  newId,
  ok,
  type GarmentItem,
  type LookSuggestion,
  type Quote,
  type Result,
} from "@mira/schemas";
import { getDoc, type Ports } from "@mira/runtime";
import { loadLookCatalogue } from "@mira/fixtures";
import type { Engine } from "../engine";
import type { OPTIONAL_STEPS } from "../graphs/compose-look";
import { buildComposeLookGraph, type LookInput } from "../graphs/compose-look";
import { buildQuote, type QuoteError } from "../quote";
import type { EngineClient, LabTuple } from "../twin/engine-client";
import { twinPath, uploadsPrefix } from "../twin/profile";
import { loadGarment } from "./garments";

/**
 * Everything decided before a unit is spent on a look: which garments, which lip and blush the
 * engines suggest for this person and this garment, and the quote. The suggestion is a documented
 * heuristic, labelled "suggestion" (docs/ENGINES.md §5); the client never names the shade, so the
 * "why" on screen is always the rule that fired.
 */
export type LookError =
  | { code: "upload_foreign"; key: string }
  | { code: "upload_missing"; key: string }
  | { code: "garment_missing"; id: string }
  | { code: "garment_wrong_kind"; id: string }
  | { code: "no_profile" }
  | { code: "no_colouring" }
  | { code: "no_lip_catalogue" }
  | { code: "engine_failed"; detail: string }
  | { code: "quote_failed"; detail: QuoteError }
  | { code: "over_cap"; quote: Quote }
  | { code: "quote_changed"; quote: Quote }
  | { code: "graph_rejected" };

export interface LookRequest {
  userId: string;
  sessionId: string;
  /** Blob key of the full-length photo. */
  photo: string;
  outfitId: string;
  shoesId?: string | undefined;
  bagId?: string | undefined;
  bagGender?: "female" | "male" | undefined;
  makeup?: boolean | undefined;
  hairHex?: string | undefined;
  venue?: LookInput["venue"];
  video?: boolean | undefined;
  /** Steps the person took out of the quote (only optional steps). */
  removedSteps?: readonly string[] | undefined;
  confirmedTotal?: number | undefined;
}

export interface LookPlanned {
  quote: Quote;
  suggestion?: LookSuggestion | undefined;
  /** The steps in this plan, in order. */
  steps: string[];
  runId?: string | undefined;
}

type Colouring = { skin: LabTuple; lip: LabTuple; hair: LabTuple };

async function readColouring(
  ports: Pick<Ports, "state">,
  userId: string,
): Promise<Result<{ twin: Twin; colouring: Colouring }, LookError>> {
  const twin = await getDoc(ports.state, twinPath(userId), Twin);
  if (!twin) return err({ code: "no_profile" });
  const pick = (id: string) => {
    const m = twin.metrics[id];
    return m?.kind === "colour" ? m.lab : undefined;
  };
  const skin = pick("colour.skin");
  const lip = pick("colour.lip");
  const hair = pick("colour.hair");
  if (!skin || !lip || !hair) return err({ code: "no_colouring" });
  return ok({ twin, colouring: { skin, lip, hair } });
}

/** The lip and blush the engines pick for this person and this garment (docs/ENGINES.md §5). */
export async function suggestLook(
  ports: Pick<Ports, "state">,
  engines: EngineClient,
  userId: string,
  outfit: GarmentItem,
): Promise<Result<LookSuggestion & { lipLab?: LabTuple }, LookError>> {
  const read = await readColouring(ports, userId);
  if (!read.ok) return read;
  const catalogue = loadLookCatalogue();
  if (catalogue.lips.length === 0) return err({ code: "no_lip_catalogue" });
  const labs = await engines.colourLab([
    ...catalogue.lips.map((s) => s.hex),
    ...catalogue.blushes.map((s) => s.hex),
  ]);
  if (!labs.ok) return err({ code: "engine_failed", detail: labs.error.code });
  const lipLabs = labs.value.value.slice(0, catalogue.lips.length);
  const blushLabs = labs.value.value.slice(catalogue.lips.length);
  const lips = catalogue.lips.map((s, i) => ({
    id: s.id,
    name: s.name,
    lab: lipLabs[i]?.lab ?? ([0, 0, 0] as LabTuple),
  }));
  const blushes = catalogue.blushes.map((s, i) => ({
    id: s.id,
    name: s.name,
    lab: blushLabs[i]?.lab ?? ([0, 0, 0] as LabTuple),
  }));
  const r = await engines.lookSuggest({
    garment: outfit.colour.lab,
    skin: read.value.colouring.skin,
    naturalLip: read.value.colouring.lip,
    hair: read.value.colouring.hair,
    lips,
    blushes,
  });
  if (!r.ok) return err({ code: "engine_failed", detail: r.error.code });
  const hexOf = (id: string, from: typeof catalogue.lips) =>
    from.find((s) => s.id === id)?.hex ?? "#777777";
  const lip = r.value.value.lip;
  const blush = r.value.value.blush?.shade;
  return ok({
    personalContrast: r.value.value.personal_contrast,
    ...(lip
      ? {
          lip: {
            id: lip.shade.id,
            name: lip.shade.name,
            hex: hexOf(lip.shade.id, catalogue.lips),
            reason: lip.reason,
            contrastMatched: lip.contrast_matched,
          },
          lipLab: lip.shade.lab,
        }
      : {}),
    ...(blush
      ? {
          blush: {
            id: blush.id,
            name: blush.name,
            hex: hexOf(blush.id, catalogue.blushes),
            reason: r.value.value.blush?.reason ?? "hue_near_lip_lower_chroma",
          },
        }
      : {}),
  });
}

export async function planLook(
  engine: Engine,
  ports: Ports,
  engines: EngineClient,
  req: LookRequest,
  start: boolean,
): Promise<Result<LookPlanned, LookError>> {
  if (!req.photo.startsWith(uploadsPrefix(req.userId))) {
    return err({ code: "upload_foreign", key: req.photo });
  }
  if ((await ports.blobs.get(req.photo)) === undefined) {
    return err({ code: "upload_missing", key: req.photo });
  }
  const need = async (id: string | undefined, kind: GarmentItem["kind"]) => {
    if (id === undefined) return ok(undefined);
    const g = await loadGarment(ports, req.userId, id);
    if (!g) return err({ code: "garment_missing", id } as const);
    if (g.kind !== kind) return err({ code: "garment_wrong_kind", id } as const);
    if ((await ports.blobs.get(g.image)) === undefined) {
      return err({ code: "garment_missing", id } as const);
    }
    return ok(g);
  };
  const outfit = await need(req.outfitId, "outfit");
  if (!outfit.ok) return outfit;
  const shoes = await need(req.shoesId, "shoes");
  if (!shoes.ok) return shoes;
  const bag = await need(req.bagId, "bag");
  if (!bag.ok) return bag;
  if (!outfit.value) return err({ code: "garment_missing", id: req.outfitId });

  const removed = new Set(req.removedSteps ?? []);
  const keep = (step: (typeof OPTIONAL_STEPS)[number]) => !removed.has(step);

  const read = await readColouring(ports, req.userId);
  if (!read.ok) return read;

  let suggestion: LookSuggestion | undefined;
  let makeup: LookInput["makeup"];
  if (req.makeup === true && keep("makeup")) {
    const s = await suggestLook(ports, engines, req.userId, outfit.value);
    if (!s.ok) return s;
    suggestion = {
      personalContrast: s.value.personalContrast,
      lip: s.value.lip,
      blush: s.value.blush,
    };
    if (s.value.lip && s.value.lipLab) {
      makeup = { lipHex: s.value.lip.hex, lipLab: s.value.lipLab, blushHex: s.value.blush?.hex };
    }
  }

  const input: LookInput = {
    userId: req.userId,
    photo: req.photo,
    outfit: outfit.value,
    ...(shoes.value && keep("shoes") ? { shoes: shoes.value } : {}),
    ...(bag.value && keep("bag")
      ? { bag: { item: bag.value, gender: req.bagGender ?? "female" } }
      : {}),
    ...(makeup ? { makeup } : {}),
    ...(req.hairHex && keep("hair") ? { hair: { hex: req.hairHex } } : {}),
    ...(req.venue && keep("venue") ? { venue: req.venue } : {}),
    ...(req.video === true && keep("video")
      ? {
          video: {
            resolution: CONFIG.look.videoResolution.value,
            durationSec: CONFIG.look.videoDurationSec.value,
          },
        }
      : {}),
  };
  const graph = buildComposeLookGraph(input);
  const quote = await buildQuote({
    graph,
    sessionId: req.sessionId,
    costs: engine.costs,
    ledger: engine.ledger,
    isCached: (node) => engine.runner.lifecycle.wouldHit(node),
    now: () => ports.clock.now(),
  });
  if (!quote.ok) return err({ code: "quote_failed", detail: quote.error });
  const steps = graph.nodes
    .filter((n) => n.kind === "youcam" && !["measure-lip", "identity"].includes(n.id))
    .map((n) => n.id);
  if (!start) return ok({ quote: quote.value, suggestion, steps });
  if (quote.value.overCap) return err({ code: "over_cap", quote: quote.value });
  if (req.confirmedTotal !== undefined && quote.value.total > req.confirmedTotal) {
    return err({ code: "quote_changed", quote: quote.value });
  }
  const started = await engine.runner.startRun({
    graph,
    userId: req.userId,
    sessionId: req.sessionId,
    planId: newId("plan"),
    quote: quote.value,
    removed: [],
    recorded: false,
  });
  if (!started.ok) return err({ code: "graph_rejected" });
  return ok({ quote: quote.value, suggestion, steps, runId: started.value.id });
}
