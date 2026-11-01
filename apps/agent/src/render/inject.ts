import {
  formatMetric,
  type Answer,
  type Confidence,
  type Metric,
  type MetricStore,
  type RenderedSegment,
} from "@mira/schemas";
import { placeholders } from "./validate";

/** The confidence words for a reading, or none when there is nothing honest to say (COPY §5). */
export function wordsFor(m: Metric): string | undefined {
  if (m.kind !== "number") return undefined;
  const words: Record<Confidence, string | undefined> = {
    within: "within your day-to-day variation",
    small: "a small change",
    clear: "above your day-to-day variation",
    "n/a": m.unit === "raw score" ? "measured once" : undefined,
  };
  return words[m.confidence];
}

/** `value unit` for one metric, with its confidence words when it has any. */
export function inline(m: Metric): string {
  const f = formatMetric(m);
  const base = f.unit === undefined ? f.value : `${f.value} ${f.unit}`;
  const words = wordsFor(m);
  return words === undefined ? base : `${base} (${words})`;
}

/** Steps 3 of the renderer: fills every placeholder from the metric store. */
export function inject(answer: Answer, store: MetricStore): RenderedSegment[] {
  return answer.segments.map((segment) => {
    const readings: RenderedSegment["readings"] = [];
    const seen = new Set<string>();
    const text = segment.text.replace(/\{([^{}]*)\}/g, (whole, id: string) => {
      const m = store[id];
      if (!m) return whole;
      if (!seen.has(id)) {
        seen.add(id);
        const f = formatMetric(m);
        const words = wordsFor(m);
        readings.push({
          id,
          value: f.value,
          ...(f.unit === undefined ? {} : { unit: f.unit }),
          confidence: m.confidence,
          ...(words === undefined ? {} : { words }),
        });
      }
      return inline(m);
    });
    return { text, readings };
  });
}

/** Does any segment still carry a placeholder? Used as a last check before the UI. */
export const hasPlaceholder = (segments: readonly RenderedSegment[]): boolean =>
  segments.some((s) => placeholders(s.text).length > 0 || /[{}]/.test(s.text));
