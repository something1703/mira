import type { CaptureCheck } from "@mira/ui";
import type { FaceQuality } from "./types";

/**
 * Camera Kit's `faceQualityChanged` to the Ring's four ticks and one instruction line
 * (docs/YOUCAM_API.md §5, "Ring mapping"): lighting → lighting, position → distance, frontal →
 * angle, and steadiness is MIRA's own check that the other three have held for a moment.
 */

/** Seconds the face must stay right before the steadiness tick lights. */
export const STEADY_MS = 1_000;
/** Milliseconds the SDK waits, after its own checks pass, before it takes the photo. */
export const COUNTING_MS = 3_000;

export type Checks = Record<CaptureCheck, boolean>;

export const NO_CHECKS: Checks = {
  lighting: false,
  distance: false,
  angle: false,
  steadiness: false,
};

/** The three checks the SDK reports. `ok` lighting is acceptable: it is not `notgood`. */
export function qualityChecks(q: FaceQuality): Omit<Checks, "steadiness"> {
  const face = q.hasFace !== false;
  return {
    lighting: face && (q.lighting === "good" || q.lighting === "ok"),
    distance: face && q.position === "good",
    angle: face && q.frontal === "good",
  };
}

/**
 * One sentence naming the check that is failing (docs/UX_FLOWS.md §3), or undefined when none is.
 * The order matches Camera Kit's own on-screen prompt (lighting, then angle, then distance), so the
 * person never sees YouCam and MIRA ask for different things at once.
 */
export function instructionFor(q: FaceQuality): string | undefined {
  if (q.hasFace === false) return "Bring your face into the frame.";
  if (q.lighting === "notgood") return "Face a window or a lamp so your face is evenly lit.";
  if (q.frontal === "notgood") return "Look straight at the camera.";
  if (q.position === "toosmall") return "Move a little closer.";
  if (q.position === "notgood") return "Move back a little.";
  if (q.position === "outofboundary") return "Centre your face in the frame.";
  return undefined;
}

/**
 * Tracks how long the three checks have held together. Time comes in as an argument, so the rule
 * is testable without a clock: the tick lights after `STEADY_MS`, and `held` also drives the
 * countdown once everything is right.
 */
export class SteadyTracker {
  private since: number | undefined;

  update(allPass: boolean, now: number): { steady: boolean; heldMs: number } {
    if (!allPass) {
      this.since = undefined;
      return { steady: false, heldMs: 0 };
    }
    this.since ??= now;
    const heldMs = now - this.since;
    return { steady: heldMs >= STEADY_MS, heldMs };
  }

  reset(): void {
    this.since = undefined;
  }
}

export interface RingView {
  checks: Checks;
  instruction?: string;
  capturing: boolean;
  /** Whole seconds until the photo, once everything holds; undefined before that. */
  countdown?: number;
}

export function ringView(q: FaceQuality, steady: { steady: boolean; heldMs: number }): RingView {
  const base = qualityChecks(q);
  const allPass = base.lighting && base.distance && base.angle;
  const checks: Checks = { ...base, steadiness: allPass && steady.steady };
  const instruction = instructionFor(q);
  const capturing = allPass && steady.steady;
  return {
    checks,
    ...(instruction === undefined ? {} : { instruction }),
    capturing,
    ...(capturing
      ? { countdown: Math.max(1, Math.ceil((COUNTING_MS - steady.heldMs) / 1000)) }
      : {}),
  };
}
