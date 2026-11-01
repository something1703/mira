import type { CSSProperties, ReactNode } from "react";
import { cx } from "./cx";
import { STEP_WORDS, latestAnnouncement, type Step, type StepState } from "./StepRail";

/**
 * The Ring (docs/DESIGN_SYSTEM.md §7): a mirror (camera view or the neutral mat) inside a heavy
 * ring, with a calibration scale on the right half only and one accent reading tick. Geometry is
 * the logo mark's, in a 400 × 400 box.
 *
 * Modes:
 * - capture: four scale ticks are the Camera Kit quality checks (lighting, distance, angle,
 *   steadiness); each turns from rule to ink when its check passes.
 * - run: one tick per workflow node, done ticks ink, the running tick pulses once a second.
 * - reading: the accent tick sweeps to the reading's position over 600 ms.
 */

const C = 200;
const RING_R = 168;
const TICK_INNER = 146;
const TICK_OUTER = 157;
const READING_INNER = 112;
const READING_OUTER = 157;
const CASING_OUTER = 143; // where the reading tick leaves the mirror (r = 140)
const READING_BASE_DEG = 20; // the drawn angle; rotation is relative to it
const ARC_TOP = 60;
const ARC_BOTTOM = -60;

const point = (deg: number, r: number) => {
  const rad = (deg * Math.PI) / 180;
  return { x: +(C + r * Math.cos(rad)).toFixed(2), y: +(C - r * Math.sin(rad)).toFixed(2) };
};

function Tick({
  deg,
  className,
  inner = TICK_INNER,
  outer = TICK_OUTER,
}: {
  deg: number;
  className: string;
  inner?: number;
  outer?: number;
}) {
  const a = point(deg, inner);
  const b = point(deg, outer);
  return <line className={className} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
}

export type CaptureCheck = "lighting" | "distance" | "angle" | "steadiness";

/** Which scale position each Camera Kit check owns; +20° is reserved for the reading tick. */
const CHECK_DEG: Record<CaptureCheck, number> = {
  lighting: 60,
  distance: 40,
  angle: -40,
  steadiness: -60,
};
const DECOR_DEG = [0, -20] as const;

export interface CaptureRing {
  mode: "capture";
  checks: Record<CaptureCheck, boolean>;
  /** The one check still failing, in plain words: "Move a little closer". */
  instruction?: string;
  /** Why capture is blocked (permission, unsupported). Replaces the instruction. */
  blockedReason?: string;
}

export interface RunRing {
  mode: "run";
  steps: readonly Step[];
}

export interface ReadingRing {
  mode: "reading";
  /** Position along the scale, 0–1. */
  value: number;
}

export type RingProps = (CaptureRing | RunRing | ReadingRing) & {
  /** Accessible name, e.g. "Capture checks: 2 of 4 passed". */
  label: string;
  /** Camera view or leave empty for the mat. */
  children?: ReactNode;
  className?: string;
};

const STEP_TICK: Record<StepState, string> = {
  queued: "is-queued",
  running: "is-running",
  done: "is-done",
  cached: "is-cached",
  failed: "is-failed",
  skipped: "is-skipped",
};

export function Ring(props: RingProps) {
  const { label, children, className } = props;
  const settled =
    props.mode === "run"
      ? props.steps.filter((s) => ["done", "cached", "failed", "skipped"].includes(s.state)).length
      : 0;

  let readingDeg: number | null = null;
  let text: string | undefined;
  if (props.mode === "capture") {
    const allPass = Object.values(props.checks).every(Boolean);
    readingDeg = allPass ? READING_BASE_DEG : null;
    text = props.blockedReason ?? (allPass ? "Ready to capture" : props.instruction);
  } else if (props.mode === "reading") {
    readingDeg = ARC_TOP + (ARC_BOTTOM - ARC_TOP) * Math.min(1, Math.max(0, props.value));
  }
  const rotation = readingDeg === null ? 0 : READING_BASE_DEG - readingDeg;

  const a = point(READING_BASE_DEG, READING_INNER);
  const b = point(READING_BASE_DEG, READING_OUTER);
  const casingEnd = point(READING_BASE_DEG, CASING_OUTER);

  const aria =
    props.mode === "run"
      ? {
          role: "progressbar" as const,
          "aria-valuemin": 0,
          "aria-valuemax": props.steps.length,
          "aria-valuenow": settled,
          "aria-valuetext": `${String(settled)} of ${String(props.steps.length)} steps settled`,
          "aria-label": label,
        }
      : { role: "img" as const, "aria-label": label };

  return (
    <figure className={cx("mira-ring-wrap", className)}>
      <div className="mira-ring" {...aria}>
        <div className="mira-ring__mirror">{children}</div>
        <svg viewBox="0 0 400 400" aria-hidden="true" focusable="false">
          <circle className="mira-ring__ring" cx={C} cy={C} r={RING_R} />
          {props.mode === "capture" ? (
            <>
              {(Object.keys(CHECK_DEG) as CaptureCheck[]).map((k) => (
                <Tick
                  key={k}
                  deg={CHECK_DEG[k]}
                  className={cx("mira-ring__tick", props.checks[k] ? "is-done" : "is-queued")}
                />
              ))}
              {DECOR_DEG.map((d) => (
                <Tick key={d} deg={d} className="mira-ring__tick is-queued" />
              ))}
            </>
          ) : null}
          {props.mode === "run"
            ? props.steps.map((s, i) => {
                const n = props.steps.length;
                const deg = n === 1 ? 0 : ARC_TOP + ((ARC_BOTTOM - ARC_TOP) * i) / (n - 1);
                return (
                  <Tick
                    key={s.id}
                    deg={deg}
                    className={cx("mira-ring__tick", STEP_TICK[s.state])}
                  />
                );
              })
            : null}
          {props.mode === "reading"
            ? [60, 40, 0, -20, -40, -60].map((d) => (
                <Tick key={d} deg={d} className="mira-ring__tick is-done" />
              ))
            : null}
          {readingDeg !== null ? (
            <g
              className={cx("mira-ring__reading", props.mode === "reading" && "is-sweeping")}
              style={{ "--r": `${String(rotation)}deg` } as CSSProperties}
            >
              <line
                className="mira-ring__casing"
                x1={a.x}
                y1={a.y}
                x2={casingEnd.x}
                y2={casingEnd.y}
              />
              <line className="mira-ring__accent" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
            </g>
          ) : null}
        </svg>
      </div>
      {text ? (
        <figcaption
          className={cx(
            "mira-ring__caption",
            props.mode === "capture" && props.blockedReason && "is-blocked",
          )}
          aria-live="polite"
        >
          {text}
        </figcaption>
      ) : null}
      {props.mode === "run" ? (
        <p className="mira-sr-only" role="status" aria-live="polite">
          {latestAnnouncement(props.steps)}
        </p>
      ) : null}
    </figure>
  );
}

export { STEP_WORDS };
