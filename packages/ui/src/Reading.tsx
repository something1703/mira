import type { ReactNode } from "react";
import { cx } from "./cx";

export type ReadingState = "value" | "below_floor" | "unavailable";

export interface NoiseBand {
  /** Fractions 0–1 along the scale. */
  floorStart: number;
  floorEnd: number;
  mark: number;
}

export interface ReadingProps {
  state?: ReadingState;
  /** Already formatted by the renderer; components never format measurements. */
  value?: string;
  unit?: string;
  /** What was measured, e.g. "Visible pores". */
  caption: string;
  /** Confidence words: "within your day-to-day variation", "above it". */
  confidence?: string;
  band?: NoiseBand;
  /** Why it is unavailable, plus a retry for that group. */
  reason?: string;
  action?: ReactNode;
}

const pct = (n: number) => `${String(Math.round(Math.min(1, Math.max(0, n)) * 100))}%`;

export function Reading({
  state = "value",
  value,
  unit,
  caption,
  confidence,
  band,
  reason,
  action,
}: ReadingProps) {
  if (state === "unavailable") {
    return (
      <div className="mira-reading-block">
        <p className="mira-small">{caption}</p>
        <p className="mira-body">Not measured</p>
        {reason ? <p className="mira-small mira-muted">{reason}</p> : null}
        {action}
      </div>
    );
  }
  return (
    <div className={cx("mira-reading-block", state === "below_floor" && "is-below-floor")}>
      <p className="mira-small">{caption}</p>
      <p>
        <span className="mira-reading mira-figures">{value}</span>
        {unit ? <span className="mira-unit">{unit}</span> : null}
      </p>
      {band ? (
        <div className="mira-band" aria-hidden="true">
          <span
            className="mira-band__floor"
            style={{ left: pct(band.floorStart), width: pct(band.floorEnd - band.floorStart) }}
          />
          <span className="mira-band__mark" style={{ left: pct(band.mark) }} />
        </div>
      ) : null}
      {confidence ? <p className="mira-small mira-muted">{confidence}</p> : null}
    </div>
  );
}
