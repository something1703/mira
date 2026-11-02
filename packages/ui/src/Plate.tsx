import type { ReactNode } from "react";
import { cx } from "./cx";
import { DriftIcon, NotCheckedIcon } from "./icons";

export type PlateState = "loading" | "ready" | "drift" | "withheld" | "expired";

export interface PlateProps {
  state: PlateState;
  /** What the image shows and how it was produced (required for the ready, drift states). */
  alt: string;
  src?: string;
  /** Width / height. Default 4 / 5. */
  aspect?: string;
  /** Usually a `LabelStrip`. */
  strip?: ReactNode;
}

const NOTICE: Partial<Record<PlateState, { title: string; body: string }>> = {
  withheld: {
    title: "This preview changed your face, so MIRA did not show it.",
    body: "Try again or skip this step.",
  },
  expired: {
    title: "This image has expired and was deleted.",
    body: "MIRA keeps images only while a run is open. Run it again to see a new one.",
  },
};

/**
 * An image on the neutral mat (AGENTS.md §8). Skin and clothing never sit on a coloured
 * background, and notices are cards on the mat because white text on the mat is under AA.
 */
export function Plate({ state, alt, src, aspect = "4 / 5", strip }: PlateProps) {
  const notice = NOTICE[state];
  const showImage = (state === "ready" || state === "drift") && src !== undefined;
  return (
    <figure className="mira-plate-wrap">
      <div
        className={cx("mira-plate", `mira-plate--${state}`)}
        style={{ aspectRatio: aspect }}
        role={showImage ? undefined : "group"}
        aria-label={showImage ? undefined : alt}
        aria-busy={state === "loading" || undefined}
      >
        {showImage ? (
          // The image source is a run output from our own storage, already sized.
          <img src={src} alt={alt} className="mira-plate__img" />
        ) : null}
        {state === "loading" ? <span className="mira-plate__skeleton" aria-hidden="true" /> : null}
        {state === "ready" && src === undefined ? <MarkPlaceholder /> : null}
        {notice ? (
          <div className="mira-plate__notice" role="status">
            {state === "withheld" ? <DriftIcon /> : <NotCheckedIcon />}
            <p className="mira-plate__notice-title">{notice.title}</p>
            <p>{notice.body}</p>
          </div>
        ) : null}
        {state === "loading" ? <span className="mira-sr-only">Loading preview</span> : null}
      </div>
      {strip}
    </figure>
  );
}

function MarkPlaceholder() {
  return (
    <svg className="mira-plate__mark" viewBox="0 0 96 96" aria-hidden="true">
      <circle cx="48" cy="48" r="28" fill="none" stroke="var(--mira-on-mat)" strokeWidth="6" />
      <line
        x1="58.34"
        y1="44.24"
        x2="69.61"
        y2="40.13"
        stroke="var(--mira-on-mat)"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
