import { createHash } from "node:crypto";

/**
 * Synthetic Skin Analysis answers for Proof in mock mode (D25, D40). One concern is asked for, and
 * the score is a fixed base for that concern, minus a simulated concern's intensity, plus a small
 * jitter that depends on the photo, so different photos differ a little and the same photo is
 * always the same. Invented numbers for a person who does not exist; the screens say so.
 */
const BASE = 62;
/** How far a full-strength simulation lowers the score in the synthetic answer. */
const SIMULATION_DROP = 14;
const JITTER = 1.6;

const SIM_KEYS = ["pores", "wrinkle", "texture", "acne", "oiliness", "redness"] as const;

const jitterOf = (seed: string): number => {
  const byte = createHash("sha256").update(seed).digest()[0] ?? 0;
  return (byte / 255 - 0.5) * 2 * JITTER;
};

/** The simulated intensity a result URL was made with, if it was a Skin Simulation. */
function intensityOf(src: Record<string, unknown> | undefined): number {
  if (!src) return 0;
  for (const key of SIM_KEYS) {
    const v = src[key];
    if (typeof v === "number") return v;
  }
  return 0;
}

/** `results` for a single-concern analysis; undefined for any other request. */
export function proofAnalysis(
  body: Record<string, unknown>,
  resultOf: (url: unknown) => Record<string, unknown> | undefined,
): unknown {
  const actions = body.dst_actions;
  if (!Array.isArray(actions) || actions.length !== 1) return undefined;
  const type = String(actions[0]);
  const id = body.src_file_id ?? body.src_file_url;
  const seed = typeof id === "string" ? id : "";
  const score = BASE - SIMULATION_DROP * intensityOf(resultOf(body.src_file_url)) + jitterOf(seed);
  return { output: [{ type, raw_score: Math.round(score * 10) / 10, ui_score: 50 }] };
}
