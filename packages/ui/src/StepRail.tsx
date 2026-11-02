import type { ComponentType } from "react";
import { cx } from "./cx";
import { CheckIcon, DriftIcon, QueuedIcon, SkippedIcon } from "./icons";

export type StepState = "queued" | "running" | "done" | "cached" | "failed" | "skipped";

export interface Step {
  id: string;
  /** Plain words for the current step, e.g. "Trying on the lehenga". */
  label: string;
  state: StepState;
  /** Why it failed or was skipped. */
  detail?: string;
}

export const STEP_WORDS: Record<StepState, string> = {
  queued: "Queued",
  running: "Running",
  done: "Done",
  cached: "Saved result",
  failed: "Failed",
  skipped: "Skipped",
};

const ICONS: Partial<Record<StepState, ComponentType>> = {
  done: CheckIcon,
  cached: CheckIcon,
  failed: DriftIcon,
  skipped: SkippedIcon,
  queued: QueuedIcon,
};

const SETTLED: ReadonlySet<StepState> = new Set(["done", "cached", "failed", "skipped"]);

export interface StepRailProps {
  steps: readonly Step[];
  /** Names the list for screen readers, e.g. "Building your sangeet look". */
  label: string;
}

/** The latest settled step, announced politely so a screen reader hears progress, not the list. */
export function latestAnnouncement(steps: readonly Step[]): string {
  const idx = steps.map((s) => SETTLED.has(s.state)).lastIndexOf(true);
  const step = steps[idx];
  return step ? `${step.label}: ${STEP_WORDS[step.state]}` : "";
}

export function StepRail({ steps, label }: StepRailProps) {
  return (
    <div className="mira-steprail">
      <ol className="mira-steps" aria-label={label}>
        {steps.map((step) => {
          const Icon = ICONS[step.state];
          return (
            <li key={step.id} className={cx("mira-step", `mira-step--${step.state}`)}>
              <span className="mira-step__marker" aria-hidden="true">
                {Icon ? <Icon /> : <span className="mira-step__dot" />}
              </span>
              <span>
                {step.label}
                {step.detail ? <span className="mira-step__detail">{step.detail}</span> : null}
              </span>
              <span className="mira-step__state">{STEP_WORDS[step.state]}</span>
            </li>
          );
        })}
      </ol>
      <p className="mira-sr-only" role="status" aria-live="polite">
        {latestAnnouncement(steps)}
      </p>
    </div>
  );
}
