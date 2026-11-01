import type { Metric, MetricId } from "@mira/schemas";

/** What a metric id means, in plain words (docs/COPY.md). Matched from the most specific prefix. */
const ENTRIES: readonly { prefix: string; definition: string; how: string }[] = [
  {
    prefix: "skin.",
    definition:
      "How visible one thing the scan measured is in one region of your face, on a scale where a higher reading means it is more visible.",
    how: "YouCam's HD skin analysis of your face photo. The same reading is compared only with another measured the same way.",
  },
  {
    prefix: "colour.skin_ita_band",
    definition: "A named band for your measured skin lightness, from the ITA° value.",
    how: "Derived from your skin colour reading. It describes colour only and is not an identity.",
  },
  {
    prefix: "colour.skin_ita",
    definition: "ITA°: an angle that summarises how light or deep the measured skin colour is.",
    how: "Calculated from the measured skin colour in CIELAB.",
  },
  {
    prefix: "colour.fitzpatrick_band",
    definition: "A band on the Fitzpatrick scale as the photo measured it, with its limits.",
    how: "YouCam's Fitzpatrick estimate. A band from a photo is a measurement, not who you are.",
  },
  {
    prefix: "colour.",
    definition: "The colour of this part of you as the photo measured it.",
    how: "YouCam's tone analysis of your photo, shown as a hex colour on a neutral mat.",
  },
  {
    prefix: "hair.",
    definition: "A description of your hair as the photo measured it.",
    how: "YouCam's hair detectors on your hair photos.",
  },
  {
    prefix: "face.",
    definition: "A proportion of your face as a ratio, one number per element of the vector.",
    how: "YouCam's face attributes, kept as ratios. No face image is kept.",
  },
  {
    prefix: "shade.",
    definition:
      "How close a previewed shade sat to your skin colour when the preview was measured again.",
    how: "The preview was measured by YouCam's tone analysis and compared with your skin colour in CIELAB.",
  },
];

export function explain(
  id: MetricId,
  metric: Metric | undefined,
): { definition: string; howMeasured: string } | undefined {
  const entry = ENTRIES.find((e) => id.startsWith(e.prefix));
  if (!entry) return undefined;
  const feature = metric?.source.feature;
  return {
    definition: entry.definition,
    howMeasured: feature ? `${entry.how} Source: ${feature}.` : entry.how,
  };
}
