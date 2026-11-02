import type { Metric } from "./metrics";

/**
 * Metrics to the strings a screen or the agent shows. Components never format a measurement: this
 * is the renderer, and the only place that rounds (docs/AGENT_RUNTIME.md §5).
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
