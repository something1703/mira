import { CONCERN_WORDS, type ProofConcern, type ProofRecord, type Verdict } from "@mira/schemas";

/**
 * Words for Proof (docs/COPY.md §2: verdicts are one sentence, then evidence). The sentences are
 * fixed text with the numbers filled from the verdict, never typed here. No sentence says a
 * product works, heals or is proven; the engines' words say what was measured against the
 * person's own variation.
 */

export const concernNoun = (c: ProofConcern): string => CONCERN_WORDS[c].noun;
export const concernSubject = (c: ProofConcern): string => CONCERN_WORDS[c].subject;

export function claimSentence(claim: ProofRecord["claim"]): string {
  return `This product claims: ${CONCERN_WORDS[claim.concern].noun}, over ${String(claim.windowDays)} days.`;
}

export function verdictSentence(proof: ProofRecord, v: Verdict): string {
  const subject = concernSubject(proof.claim.concern);
  switch (v.state) {
    case "detected":
      return v.words === "small"
        ? `${subject} show a small change above your day-to-day variation.`
        : `${subject} changed more than your day-to-day variation.`;
    case "not_yet":
      return `No change we can tell apart from your day-to-day variation yet. You are on day ${String(v.day)} of a ${String(v.windowDays)}-day claim.`;
    case "window_ended_no_change":
      return "No change MIRA can tell apart from your day-to-day variation over the claimed period.";
    case "opposite":
      return `${subject} changed, but not in the direction the product claims.`;
    case "collecting":
      return "MIRA does not know your day-to-day variation well enough yet to say whether this changed.";
  }
}

export const CONFOUND_WARNING =
  "Two new products at once means MIRA cannot tell which one changed things.";

export const PHANTOM_UNUSABLE =
  "MIRA cannot visualise changes for this concern reliably, so it will report numbers only.";

export const VISUALISATION_LABEL =
  "Visualisation, not a prediction. Skin Simulation can only make a concern more visible, so this shows today's photo as it would look at the earlier, more visible level.";

export const PREVIEW_LABEL =
  "Visualisation, not a prediction. This shows today's photo with the concern as visible as it would be at the smallest change MIRA can tell apart from your day-to-day variation.";

/** What a failure code from the proof routes means to a person. */
export const PROOF_REASONS: Record<string, string> = {
  too_soon: "A session is a different day from the last one. Come back later today or tomorrow.",
  wrong_state: "That step does not apply to this product right now.",
  wrong_photo_count: "A session needs all three photos.",
  photos_duplicate: "Two of the photos are the same picture. Take three separate photos.",
  upload_missing: "A photo has been deleted. Take it again.",
  upload_foreign: "That photo is not yours to use.",
  variation_unknown: "MIRA does not know your day-to-day variation yet. Finish the baseline first.",
  already_calibrated: "This product is already calibrated.",
  phantom_unusable: "MIRA cannot visualise changes for this concern reliably.",
  no_change_to_show: "There is no measured change to show yet.",
  outside_range:
    "This change is outside what MIRA's calibration covers, so it will show numbers only.",
  quote_changed: "The price changed since this quote. Check the new total.",
  over_cap: "This would use more units than you have left in this session.",
  price_unavailable: "Prices could not be read right now. Nothing was charged.",
  engine_failed: "A measurement service was unreachable. Nothing was charged.",
  not_finished: "The claim window has not ended yet.",
  already_published: "This review was already published.",
  proof_not_found: "That product could not be found.",
  url_blocked: "That address cannot be read.",
  url_invalid: "That does not look like a web address.",
  fetch_failed: "The page could not be fetched.",
};

/** A reminder the person downloads and adds to their own calendar; MIRA sends nothing itself. */
export function calendarFile(product: string, due: Date): string {
  const stamp = (d: Date) =>
    d
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//MIRA//Proof//EN",
    "BEGIN:VEVENT",
    `UID:${stamp(due)}-${product.replace(/[^a-z0-9]/gi, "").toLowerCase()}@mira`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(due)}`,
    "DURATION:PT15M",
    `SUMMARY:MIRA check-in: ${product.replace(/[,;\n]/g, " ")}`,
    "DESCRIPTION:Take three photos on this day for your MIRA progress check.",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n");
}
