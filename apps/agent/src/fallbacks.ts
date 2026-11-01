import type { Answer, MetricStore, NextAction, RenderedSegment } from "@mira/schemas";
import { inject } from "./render/inject";
import type { OutOfScope } from "./prompts/scope";

/**
 * Fixed sentences for when the model cannot be used safely (docs/AGENT_RUNTIME.md §5, step 5).
 * Each is built only from fixed text and, where it names a reading, a metric placeholder the
 * renderer fills. This file names what MIRA refuses, so it is exempt from the banned-stem check
 * and reviewed by hand (docs/COPY.md §3).
 */

export const OUT_OF_SCOPE_TEXT: Record<OutOfScope, string> = {
  medical:
    "MIRA describes appearance only and cannot help with medical questions. A dermatologist can.",
  identity: "MIRA measures colour from a photo. It does not infer ethnicity or identity.",
  body: "MIRA does not comment on body shape or weight. It can match shades and build looks.",
};

export const UNAVAILABLE_TEXT =
  "The assistant is unavailable right now. Every tool still works from its own screen.";

const GENERIC =
  "I could not put that into words safely. Every tool still works from its own screen.";

/** One sentence per next action. `colour.skin` is cited only when the profile has it. */
const BY_ACTION: Record<NextAction, { text: string; ref?: string }> = {
  build_twin: {
    text: "Your measured profile is the base for everything else. Start measuring to build it.",
  },
  match_shade: {
    text: "Match my shade compares each shade with your measured skin colour {colour.skin}.",
    ref: "colour.skin",
  },
  compose_look: {
    text: "Build a look shows a preview of makeup and clothes on you, checked against the product.",
  },
  start_proof: {
    text: "Check my progress compares a product's claim with your day-to-day variation.",
  },
  proof_check_in: {
    text: "A check-in repeats your measurement and compares it with your first.",
  },
};

/** The templated answer: a sentence per next action, or the generic line when there is none. */
export function fallbackAnswer(actions: readonly NextAction[], store: MetricStore): Answer {
  const segments = actions.flatMap((a) => {
    const entry = BY_ACTION[a];
    if (entry.ref !== undefined && !(entry.ref in store)) {
      return [
        {
          text: "Match my shade compares each shade with your measured skin colour.",
          metric_refs: [],
        },
      ];
    }
    return [{ text: entry.text, metric_refs: entry.ref === undefined ? [] : [entry.ref] }];
  });
  return {
    segments: segments.length > 0 ? segments : [{ text: GENERIC, metric_refs: [] }],
    renders: [],
    next_actions: [...actions].slice(0, 3),
  };
}

export function renderFallback(
  actions: readonly NextAction[],
  store: MetricStore,
): { answer: Answer; segments: RenderedSegment[] } {
  const answer = fallbackAnswer(actions, store);
  return { answer, segments: inject(answer, store) };
}
