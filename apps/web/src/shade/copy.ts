import { CONFIG, type Coverage, type Finish, type PrerankedShade } from "@mira/schemas";

/** The words of the shade screens (docs/COPY.md, docs/UX_FLOWS.md §5). */

/** How the closest shade differs from the skin, as the sentence the no-match state needs. */
const READS: Record<PrerankedShade["label"], string> = {
  blends_closely: "blends closely with",
  close: "is close to",
  lighter: "reads lighter than",
  darker: "reads darker than",
  warmer: "reads warmer than",
  cooler: "reads cooler than",
  more_muted: "reads more muted than",
  more_vivid: "reads stronger than",
};
export const readsLike = (label: PrerankedShade["label"]): string => READS[label];

export const FINISH_WHY: Record<string, string> = {
  no_skin_type:
    "MIRA has no skin-type reading it can interpret yet, so it suggests satin, the middle finish.",
  oily: "Your skin reads as oily, so matte or satin sits best.",
  dry: "Your skin reads as dry, so a dewy finish sits best.",
  combination: "Your skin reads as combination, so satin suits both zones.",
};

export const COVERAGE_WHY: Record<string, string> = {
  default_light: "Light coverage, because no reading called for more.",
  raised_for_concern: "Medium coverage, because a visible-redness or acne reading was low.",
};

export const finishWhy = (reason: string): string => FINISH_WHY[reason] ?? "";
export const coverageWhy = (reason: string): string => COVERAGE_WHY[reason] ?? "";

export const FINISH_WORD: Record<Finish, string> = { matte: "matte", satin: "satin", dewy: "dewy" };
export const COVERAGE_WORD: Record<Coverage, string> = { light: "light", medium: "medium" };

/** Why a shade row has no preview, in plain words. Failed renders cost no units. */
export const SHADE_REASONS: Record<string, string> = {
  not_rendered: "Left out of this run.",
  unreadable_result: "The preview could not be measured.",
  no_colour_read: "The preview could not be measured.",
  engine_unreachable: "The colour check could not run. Try again in a moment.",
};

export const REVIEW_MINUTES = Math.round(CONFIG.youcam.reviewWindowMs.value / 60_000);

/** What each range-reading failure tells the person (docs/UX_FLOWS.md §5, "Range not readable"). */
export const RANGE_ERRORS: Record<string, string> = {
  range_not_readable:
    "MIRA could not find shade colours on this page. Try the brand's shade-finder page or another product.",
  url_invalid: "That does not look like a web address. Paste the link to a product page.",
  url_blocked: "MIRA can only read public product pages that start with https.",
  fetch_failed: "That page could not be opened just now. Check the link and try again.",
  not_html: "That link is not a web page. Paste the link to a product page.",
  too_large: "That page is too large to read. Try the product's own page.",
  too_many_redirects: "That link sends MIRA around in circles. Try the product's own page.",
  too_many_reads: "That is a lot of pages in an hour. Try again a little later.",
  agent_unreachable: "The page reader is not available just now. Try again in a moment.",
};
