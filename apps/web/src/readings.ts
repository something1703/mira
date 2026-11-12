import type { Metric } from "@mira/schemas";

/**
 * What a number means, in one plain sentence beside it. Every screen that shows a measurement
 * explains it the same way, from here. The sentences describe what the photo shows, never the
 * person, and the claim linter reads this file (docs/COPY.md).
 */

/** The one line that explains every skin score. YouCam's `raw_score` (D6), not its `ui_score`. */
export const SKIN_SCORE_KEY =
  "Each score runs from 1 to 100, and higher means healthier-looking. It describes this one photo, not your skin over time.";

/** What each skin reading looks at. Keys are YouCam concern names without the `hd_` prefix. */
const SKIN_LOOKS_AT: Record<string, string> = {
  pore: "How visible pores look.",
  wrinkle: "How visible fine lines look.",
  texture: "How smooth the surface of the skin looks.",
  acne: "How visible spots and breakouts look.",
  oiliness: "How much surface shine shows.",
  redness: "How much visible redness shows.",
  dark_circle: "How dark the area under the eyes looks.",
  dark_circle_v2: "How dark the area under the eyes looks.",
  radiance: "How even and bright the skin looks.",
  eye_bag: "How puffy the area under the eyes looks.",
  age_spot: "How visible darker spots look.",
  firmness: "How firm the cheeks and jawline look.",
  moisture: "How hydrated the skin looks.",
  tear_trough: "How deep the shadow under the inner eye looks.",
  droopy_upper_eyelid: "How the upper eyelid sits over the eye.",
  droopy_lower_eyelid: "How the lower eyelid sits under the eye.",
};

const COLOUR_MEANS: Record<string, string> = {
  skin: "Your measured skin colour. MIRA matches foundation to this.",
  lip: "Your measured lip colour.",
  eyebrow: "Your measured brow colour.",
  eye: "Your measured eye colour.",
  hair: "Your measured hair colour.",
  skin_ita:
    "A standard angle for skin lightness, worked out from the colour. Higher numbers are lighter.",
  skin_ita_band: "The named range that the lightness angle falls in.",
  eye_name: "The nearest colour name YouCam gives the eyes.",
  hair_name: "The nearest of YouCam's seven hair colour names.",
};

const FACE_MEANS: Record<string, string> = {
  horizontal_third: "Compares the heights of the forehead, the middle and the lower face.",
  vertical_fifth: "Compares widths across the face, in fifths from ear to ear.",
  eye_aspect_ratio: "How tall the eyes are compared with their width.",
};

const HAIR_MEANS: Record<string, string> = {
  type: "The hair type YouCam reads from the photo.",
  density: "How thick the hair looks.",
  length: "How long the hair looks.",
  frizziness: "How much frizz shows.",
};

const two = (n: number) => n.toFixed(2);

/** One sentence on what a reading means, or undefined when there is nothing useful to add. */
export function meaningOf(m: Metric): string | undefined {
  const [group, name = ""] = m.id.split(".");
  if (group === "skin") return SKIN_LOOKS_AT[name.replace(/^hd_/, "")];
  if (group === "colour") return COLOUR_MEANS[name];
  if (group === "hair") return HAIR_MEANS[name];
  if (group === "face") {
    if (m.kind === "number" && name === "face_aspect_ratio")
      return `Your face measures ${two(m.value)} times as tall as it is wide.`;
    if (m.kind === "number" && name === "nose_width_to_mouth_width")
      return `Your nose is ${two(m.value)} times the width of your mouth.`;
    return FACE_MEANS[name];
  }
  return undefined;
}

/** ΔE2000 in one line, for anywhere a ΔE is shown. */
export const DE_KEY =
  "ΔE2000 is the standard measure of how different two colours look. Lower is closer: about 1 is the smallest difference most people can see side by side.";

export interface BlendThresholds {
  matchDe: number;
  closeDe: number;
}

export type BlendWord = "unseen" | "blends" | "close" | "visible";

/** How a measured blend would look on the face, by the same lines the engine labels with. */
export function blendWord(de: number, t: BlendThresholds): BlendWord {
  if (de < 1) return "unseen";
  if (de <= t.matchDe) return "blends";
  if (de <= t.closeDe) return "close";
  return "visible";
}

const BLEND_SENTENCE: Record<BlendWord, string> = {
  unseen: "Very hard to see: the colour change on your skin is below what most people notice.",
  blends: "Blends closely: a difference might show only up close.",
  close: "Close: a slight edge may show at the jaw in daylight.",
  visible: "Visible: the edge where the foundation stops would likely show.",
};

const BLEND_TITLE: Record<BlendWord, string> = {
  unseen: "Very hard to see",
  blends: "Blends closely",
  close: "Close",
  visible: "Visible difference",
};

export const blendSentence = (de: number, t: BlendThresholds): string =>
  BLEND_SENTENCE[blendWord(de, t)];
export const blendTitle = (de: number, t: BlendThresholds): string => BLEND_TITLE[blendWord(de, t)];
