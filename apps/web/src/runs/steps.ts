import type { RunNode } from "@mira/schemas";
import { reasonCopy } from "../profile/copy";
import type { Step, StepState } from "@mira/ui";

/** Plain words for the current step (docs/COPY.md §2, Progress). Unknown keys show the key. */
const WORDS: Record<string, string> = {
  "step.measure_colour": "Measuring skin and lip colour",
  "step.measure_band": "Measuring the skin tone band",
  "step.measure_face": "Measuring face proportions",
  "step.summarise": "Putting the readings together",
  "step.measure_skin": "Measuring your skin",
  "step.measure_hair": "Measuring your hair",
  "step.derive_colour": "Working out your colour measurements",
  "step.estimate_noise": "Comparing your repeat captures",
  "step.write_profile": "Saving your measured profile",
  "step.render_shade": "Rendering the shade on your photo",
  "step.measure_render": "Measuring the preview",
  "step.check_render": "Checking the preview against your skin",
  "step.rank_shades": "Ranking the shades",
  "step.try_outfit": "Trying on the outfit",
  "step.try_shoes": "Trying on the shoes",
  "step.try_bag": "Adding the bag",
  "step.try_makeup": "Applying the makeup",
  "step.try_hair": "Trying the hair colour",
  "step.place_venue": "Placing you in the venue",
  "step.make_video": "Making a short video",
  "step.check_garment": "Checking the garment colour matches the product",
  "step.measure_lip": "Measuring the lip colour",
  "step.check_lip": "Checking the lip colour matches the product",
  "step.check_face": "Reading your face in the preview",
  "step.compare_face": "Comparing your face with your profile",
  "step.check_before_video": "Checking every preview before the video",
  "step.put_look_together": "Putting the look together",
  "step.remove_background": "Removing the background",
  "step.read_garment_colour": "Reading the garment colour",
};

export const stepLabel = (key: string): string => WORDS[key] ?? key;

/** The StepRail shows `waiting` as running and `cancelled` as skipped (packages/schemas/src/run.ts). */
const STATE: Record<RunNode["status"], StepState> = {
  queued: "queued",
  running: "running",
  waiting: "running",
  done: "done",
  cached: "cached",
  failed: "failed",
  skipped: "skipped",
  cancelled: "skipped",
};

/** Nodes in dependency order, so the rail reads the way the run proceeds. */
export function toSteps(nodes: readonly RunNode[]): Step[] {
  const order = new Map<string, number>();
  const visit = (n: RunNode): number => {
    const known = order.get(n.id);
    if (known !== undefined) return known;
    const depth =
      1 +
      Math.max(
        -1,
        ...n.dependsOn.map((id) => {
          const dep = nodes.find((x) => x.id === id);
          return dep ? visit(dep) : -1;
        }),
      );
    order.set(n.id, depth);
    return depth;
  };
  for (const n of nodes) visit(n);
  return [...nodes]
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0) || a.id.localeCompare(b.id))
    .map((n) => ({
      id: n.id,
      label: stepLabel(n.label),
      state: STATE[n.status],
      ...(n.error ? { detail: reasonCopy(n.error.code) } : {}),
    }));
}
