import type { ReactNode } from "react";
import { DriftIcon } from "./icons";

export interface ErrorPanelProps {
  /** What happened. Never "Oops" or "Sorry" (docs/COPY.md §2). */
  title: string;
  /** Why, if known. */
  why?: string;
  /** What to do next. */
  next?: string;
  traceId?: string;
  /** What to call the identifier: a run's trace ID, or the server's error reference. */
  referenceLabel?: string;
  /** Retry and an alternative, e.g. "Go home". */
  actions?: ReactNode;
}

export function ErrorPanel({
  title,
  why,
  next,
  traceId,
  referenceLabel = "Trace ID",
  actions,
}: ErrorPanelProps) {
  return (
    <div role="alert" className="mira-error">
      <DriftIcon />
      <div className="mira-error__body">
        <p className="mira-title">{title}</p>
        {why ? <p className="mira-error__text">{why}</p> : null}
        {next ? <p className="mira-error__text">{next}</p> : null}
        {traceId ? (
          <p className="mira-caption mira-error__trace">
            {referenceLabel}: {traceId}
          </p>
        ) : null}
        {actions ? <div className="mira-row">{actions}</div> : null}
      </div>
    </div>
  );
}
