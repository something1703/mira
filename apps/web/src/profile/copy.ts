import type { MissingReading, TwinGroupName } from "@mira/schemas";

/**
 * The words of the profile screen (docs/COPY.md): what the scan measured, never a judgement of the
 * person. Every name here is a cosmetic, visible-appearance label. The claim linter reads this file.
 */

export const GROUP_TITLES: Record<TwinGroupName, string> = {
  skin: "Skin",
  colouring: "Colouring",
  face: "Face",
  hair: "Hair",
};

const SKIN_CONCERN: Record<string, string> = {
  pore: "Visible pores",
  wrinkle: "Visible lines",
  texture: "Skin texture",
  acne: "Visible acne",
  oiliness: "Surface shine",
  redness: "Visible redness",
  dark_circle: "Under-eye darkness",
  dark_circle_v2: "Under-eye darkness",
  skin_type: "Skin type score",
  radiance: "Radiance",
  eye_bag: "Under-eye puffiness",
  age_spot: "Visible spots",
  firmness: "Firmness",
  moisture: "Moisture",
  tear_trough: "Tear trough shadow",
  droopy_upper_eyelid: "Upper eyelid",
  droopy_lower_eyelid: "Lower eyelid",
};

const FACE_RATIO: Record<string, string> = {
  face_aspect_ratio: "Face height to width",
  horizontal_third: "Face thirds",
  vertical_fifth: "Face fifths",
  eye_aspect_ratio: "Eye height to width",
  nose_width_to_mouth_width: "Nose width to mouth width",
};

const COLOUR: Record<string, string> = {
  skin: "Skin colour",
  lip: "Lip colour",
  eyebrow: "Eyebrow colour",
  eye: "Eye colour",
  hair: "Hair colour",
  skin_ita: "Skin lightness angle (ITA)",
  skin_ita_band: "Skin lightness band",
  eye_name: "Eye colour name",
  hair_name: "Hair colour name",
  fitzpatrick_band: "Fitzpatrick band",
};

const HAIR: Record<string, string> = {
  type: "Hair type",
  density: "Hair density",
  length: "Hair length",
  frizziness: "Frizziness",
};

const ORDINAL = ["first", "second", "third", "fourth", "fifth"];
const words = (s: string) => s.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());

/** What a metric id measures, in words. Unknown ids fall back to a readable form of the id. */
export function captionOf(id: string): string {
  const parts = id.split(".");
  const [group, name, rest] = parts;
  if (group === "skin" && name) {
    const concern = SKIN_CONCERN[name.replace(/^hd_/, "")] ?? words(name.replace(/^hd_/, ""));
    return rest && rest !== "whole" ? `${concern}, ${rest.replaceAll("_", " ")}` : concern;
  }
  if (group === "face" && name) {
    const base = FACE_RATIO[name] ?? words(name);
    const index = Number(rest) - 1;
    return Number.isInteger(index) && index >= 0 && name !== "face_aspect_ratio"
      ? `${base}, ${ORDINAL[index] ?? String(index + 1)}`
      : base;
  }
  if (group === "colour" && name) return COLOUR[name] ?? words(name);
  if (group === "hair" && name) return HAIR[name] ?? words(name);
  return words(id.replaceAll(".", " "));
}

/** The Fitzpatrick bands are measurements of how skin reacts to sun, with the limits stated. */
export const FITZPATRICK_NOTE =
  "A measured band from the photo, not a statement about who you are. It describes sun response only.";

/** What the profile shows for a group that was not measured, by the code in `MissingReading`. */
const REASONS: Record<string, string> = {
  not_captured: "This was not captured in this session.",
  skipped: "This step was skipped.",
  cancelled: "This step was stopped before it started.",
  upstream_failed: "A step this one depends on could not be measured.",
  face_too_small: "Your face needs to fill more of the photo. Move a little closer.",
  face_out_of_frame: "Part of your face was outside the photo. Centre it and try again.",
  too_dark: "The photo is too dark to measure. Face a window or a lamp and try again.",
  face_angle: "Look straight at the camera and try again.",
  no_face: "No face was found in the photo. Face the camera and try again.",
  multiple_people: "More than one person was in the photo. Take it again on your own.",
  face_obscured:
    "Something covered part of your face. Take off glasses and move hair off your forehead.",
  image_too_small: "The photo is too small to measure. Use a sharper one.",
  image_too_large: "The photo is too large to measure. Use a smaller one.",
  image_unreadable: "The photo could not be read. Take it again.",
  image_ratio: "The photo's shape is not supported. Take it again.",
  hair_photos_mismatch: "The three hair photos need to be the same size. Take them again together.",
  hair_not_found: "No hair was found in the photo. Take it again so your hair is in frame.",
  content_rejected: "The photo could not be used. Take another.",
  could_not_measure: "This could not be measured this time. Try again.",
  youcam_internal: "The measuring service had a problem. Try again in a moment.",
  unreadable_result: "The result could not be read. Try again.",
  not_returned: "The scan did not return this reading.",
  nothing_measured: "Nothing could be measured from these photos.",
  no_colour_read: "No colour could be read from the photo.",
  engine_unreachable: "The colour step could not run. Try again in a moment.",
  engine_rejected: "The colour step could not use this reading.",
  engine_bad_reply: "The colour step answered in a way MIRA could not read.",
  over_cap: "This would use more units than this session has left.",
  insufficient_units: "There are not enough units to run this step.",
  price_unknown: "MIRA could not confirm what this step costs, so it did not run.",
  worker_failed: "This step did not finish. Try again.",
};

/** Failed measuring steps are not charged (docs/YOUCAM_API.md). Only quality errors say so. */
const NO_CHARGE = new Set([
  "face_too_small",
  "face_out_of_frame",
  "too_dark",
  "face_angle",
  "no_face",
  "multiple_people",
  "face_obscured",
  "image_too_small",
  "image_too_large",
  "image_unreadable",
  "image_ratio",
  "hair_photos_mismatch",
  "hair_not_found",
  "content_rejected",
  "could_not_measure",
  "youcam_internal",
]);

export function reasonCopy(code: string): string {
  const text = REASONS[code] ?? REASONS.could_not_measure ?? "";
  return NO_CHARGE.has(code) ? `${text} No units were used.` : text;
}

/** Which readings a retry can take again by capturing, and what the button says. */
export function retryLabel(group: TwinGroupName, missing: readonly MissingReading[]): string {
  const retake = missing.some((m) => m.guidance === "retake" || m.reason === "not_captured");
  const noun = GROUP_TITLES[group].toLowerCase();
  return retake ? `Retake for ${noun}` : `Try ${noun} again`;
}

export const NOISE_MISSING = "Needs 2 more captures to know your day-to-day variation.";

/** Names a reading in a missing list: `hair_type` → "Hair type". */
export const missingName = (reading: string): string =>
  reading === "skin" ||
  reading === "colour" ||
  reading === "proportions" ||
  reading === "skin_tone_band"
    ? (
        {
          skin: "Skin readings",
          colour: "Colours",
          proportions: "Face proportions",
          skin_tone_band: "Fitzpatrick band",
        } as const
      )[reading]
    : (SKIN_CONCERN[reading.replace(/^hd_/, "")] ?? words(reading));
