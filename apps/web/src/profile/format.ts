import type { Metric, NoiseFloorEntry } from "@mira/schemas";

/**
 * Metrics to the strings the components show. Components never format a measurement
 * (packages/ui Reading): this is the renderer, and the only place that rounds.
 */
export interface Formatted {
  value: string;
  unit?: string;
}

export function formatMetric(m: Metric): Formatted {
  switch (m.kind) {
    case "colour":
      return { value: m.hex };
    case "category":
      return { value: m.value };
    case "number": {
      if (m.unit === "ratio") return { value: m.value.toFixed(2), unit: "ratio" };
      if (m.unit === "°") return { value: String(Math.round(m.value)), unit: "°" };
      if (m.unit === "raw score") return { value: m.value.toFixed(1), unit: "out of 100" };
      return { value: String(Math.round(m.value * 100) / 100), unit: m.unit };
    }
  }
}

/**
 * Confidence words for a single baseline reading. From one session only the spread between
 * captures a few seconds apart is known (D16), so it is described as that, never as a noise floor
 * or a margin of error.
 */
export function confidenceWords(m: Metric, floor: NoiseFloorEntry | undefined): string {
  if (m.kind !== "number" || m.unit !== "raw score") return "Measured once";
  if (floor === undefined) return "Measured once. Day-to-day variation is not known yet.";
  return `Photos seconds apart moved this reading by about ${floor.sW.toFixed(1)} points out of 100. Day-to-day variation is not known yet.`;
}

/** `2026-11-01T09:00:05.000Z` → `1 Nov 2026`, in UTC so the server and browser agree. */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getUTCDate())} ${d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })} ${String(d.getUTCFullYear())}`;
}
