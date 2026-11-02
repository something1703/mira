import type { LookStep, LookStepId } from "@mira/schemas";
import type { FidelityVariant } from "@mira/ui";

/** Words for the look screens (docs/COPY.md). Every figure comes from a result; none is typed here. */

export const SLOT_NAMES: Record<LookStepId, string> = {
  outfit: "Outfit",
  shoes: "Shoes",
  bag: "Bag",
  makeup: "Makeup",
  hair: "Hair",
  venue: "Venue",
  video: "Motion",
};

/** The quote's line names, by the step key the graph gives them. */
export const QUOTE_WORDS: Record<string, string> = {
  "step.try_outfit": "Trying on the outfit",
  "step.try_shoes": "Trying on the shoes",
  "step.try_bag": "Adding the bag",
  "step.try_makeup": "Applying the makeup",
  "step.measure_lip": "Checking the lip colour matches the product",
  "step.try_hair": "Trying the hair colour",
  "step.check_face": "Comparing your face with your profile",
  "step.place_venue": "Placing you in the venue",
  "step.make_video": "Making a short video",
  "step.remove_background": "Removing the background",
};

export const OUTFIT_CATEGORIES = [
  { value: "full_body", label: "Full outfit (saree, lehenga, gown)" },
  { value: "upper_body", label: "Top (kurta, shirt)" },
  { value: "lower_body", label: "Bottom (trousers, skirt)" },
  { value: "outer", label: "Jacket or coat" },
] as const;

/** Venues described in words, for when YouCam's own presets are not available. */
export const VENUE_PROMPTS: Record<string, { name: string; prompt: string }[]> = {
  hall: [
    {
      name: "Marigold-lit hall",
      prompt: "a wedding hall lit with marigold garlands and warm lights",
    },
    { name: "Mirrored ballroom", prompt: "a mirrored ballroom with soft chandeliers" },
  ],
  garden: [{ name: "Garden at dusk", prompt: "a flowering garden at dusk with string lights" }],
  outdoor: [
    {
      name: "Courtyard in morning light",
      prompt: "a sunlit courtyard in the morning with flower petals",
    },
  ],
  indoor: [{ name: "Warm living room", prompt: "a warm living room with soft lamps" }],
  beach: [{ name: "Beach at sunset", prompt: "a quiet beach at sunset" }],
  temple: [{ name: "Temple courtyard", prompt: "a stone temple courtyard with oil lamps" }],
  other: [{ name: "Warm studio", prompt: "a plain warm studio backdrop" }],
};

/** Why a lip or blush was suggested, from the engine's reason code (docs/ENGINES.md §5). */
export const LIP_WHY: Record<string, string> = {
  hue_near_garment: "Its hue sits near the colour of your outfit.",
  hue_near_natural_lip: "Its hue sits near your measured lip colour.",
  no_hue_match_closest_to_natural_lip:
    "Nothing in the range matched your outfit, so this is the closest to your measured lip colour.",
};
export const BLUSH_WHY: Record<string, string> = {
  hue_near_lip_lower_chroma: "Its hue sits near the lip colour and it is softer.",
  none_in_window: "No blush in the range sat near the lip colour.",
};

/** What a failure code from the look routes means to a person. */
export const LOOK_REASONS: Record<string, string> = {
  no_profile: "A look needs your measured profile. Measure yourself first.",
  no_colouring: "Your profile has no lip or hair colour yet. Retake the colouring group.",
  no_lip_catalogue: "There is no lip range to suggest from yet. Turn makeup off to continue.",
  upload_missing: "Your photo has been deleted. Add it again.",
  upload_foreign: "That photo is not yours to use.",
  garment_missing: "A garment's picture has been deleted. Add that garment again.",
  garment_wrong_kind: "That garment is not the right kind for this slot.",
  quote_changed: "The price changed since this quote. Check the new total.",
  over_cap: "This look would use more units than you have left in this session.",
  price_unavailable: "Prices could not be read right now. Nothing was charged.",
  engine_failed: "A measurement service was unreachable. Nothing was charged.",
  kind_category_mismatch: "That garment does not fit the slot you chose.",
  garment_not_readable: "No garment picture could be read from that page.",
  url_blocked: "That address cannot be read.",
  url_invalid: "That does not look like a web address.",
  fetch_failed: "The page could not be fetched.",
  too_large: "That page or picture is too large.",
  not_html: "That address did not return a web page.",
};

/** The label under the plate for one step. */
export function verdictLabel(step: LookStep): {
  variant: FidelityVariant;
  word?: string;
  detail?: string;
} {
  const name = SLOT_NAMES[step.id];
  const de = step.de === undefined ? undefined : step.de.toFixed(1);
  switch (step.verdict) {
    case "verified":
      return {
        variant: "verified",
        word: `${name} verified`,
        ...(de ? { detail: `Within ΔE ${de} of the product.` } : {}),
      };
    case "drift":
      return {
        variant: "drift",
        word: "Colour drifted",
        detail: `${step.id === "outfit" ? "The garment" : "The lip colour"} reads ${
          step.direction ? (DIRECTION[step.direction] ?? "different") : "different"
        } than the product${de ? `, by ΔE ${de}` : ""}. Check before buying.`,
      };
    case "not_checked":
      return {
        variant: "not_checked",
        word: `${name} not checked`,
        ...(step.reason
          ? { detail: NOT_CHECKED[step.reason] ?? "The check could not be made." }
          : {}),
      };
    case "unchecked":
      return { variant: "not_checked", word: `${name}: no check exists for this yet` };
    case "withheld":
      return { variant: "not_checked", word: `${name} withheld` };
    case "failed":
      return { variant: "not_checked", word: `${name} not made` };
    case "skipped":
      return { variant: "not_checked", word: `${name} skipped` };
  }
}

const DIRECTION: Record<string, string> = {
  lighter: "lighter",
  darker: "darker",
  warmer: "warmer",
  cooler: "cooler",
  more_muted: "more muted",
  more_vivid: "more vivid",
};

const NOT_CHECKED: Record<string, string> = {
  torso_unchanged: "The preview may still show your own clothes.",
  torso_outside_image: "The garment area was outside the photo.",
  no_face: "No face was found to measure from.",
  engine_unreachable: "The check could not be run. Nothing was charged for it.",
};

/** Why a step has no picture, from the mapped code. */
export const STEP_REASONS: Record<string, string> = {
  no_face: "No face was found in the photo.",
  not_made: "An earlier step did not finish.",
  identity_drift: "The preview changed your face.",
  audit_not_passed: "A check did not pass, so no video was made.",
  nothing_made: "Nothing could be made from this photo.",
};
