import type { ReactNode } from "react";
import { Button } from "./Button";

export type QuoteState = "quoting" | "ready" | "over_cap" | "confirmed";

export interface QuoteLine {
  label: string;
  units: number;
}

export interface QuoteSheetProps {
  state: QuoteState;
  title: string;
  lines?: readonly QuoteLine[];
  /** Units left in this session. */
  unitsLeft?: number;
  confirmLabel?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
  /** Shown beside Confirm and Cancel, e.g. "Remove video" or "Use a recorded run". */
  extraActions?: ReactNode;
}

/** The plan, its unit cost, confirm or cancel. Units are shown to the person before any spend. */
export function QuoteSheet({
  state,
  title,
  lines = [],
  unitsLeft,
  confirmLabel = "Confirm",
  onConfirm,
  onCancel,
  extraActions,
}: QuoteSheetProps) {
  const total = lines.reduce((sum, l) => sum + l.units, 0);
  return (
    <section className="mira-panel mira-quote" aria-busy={state === "quoting" || undefined}>
      <h2 className="mira-title">{title}</h2>
      {state === "quoting" ? (
        <p className="mira-small" role="status">
          Working out the units
        </p>
      ) : (
        <>
          <p className="mira-small mira-quote__note">
            Units come from your session allowance. Nothing is charged for steps that fail.
          </p>
          <table className="mira-quote__table">
            <caption className="mira-sr-only">Units by step</caption>
            <tbody>
              {lines.map((l) => (
                <tr key={l.label}>
                  <th scope="row">{l.label}</th>
                  <td className="mira-figures">{l.units}</td>
                </tr>
              ))}
              <tr className="mira-quote__total">
                <th scope="row">Total</th>
                <td className="mira-figures">{total}</td>
              </tr>
            </tbody>
          </table>
          {state === "over_cap" && unitsLeft !== undefined ? (
            <p role="alert" className="mira-quote__cap">
              This plan would use {total} units and you have {unitsLeft} left in this session.
              Remove a step or start a new session.
            </p>
          ) : null}
          {state === "confirmed" ? (
            <p role="status" className="mira-quote__confirmed">
              Confirmed. MIRA is starting now.
            </p>
          ) : null}
          <div className="mira-row">
            <Button
              disabled={state === "over_cap" || state === "confirmed"}
              {...(onConfirm ? { onClick: onConfirm } : {})}
            >
              {confirmLabel}
            </Button>
            {extraActions}
            {state !== "confirmed" ? (
              <Button variant="secondary" {...(onCancel ? { onClick: onCancel } : {})}>
                Cancel
              </Button>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}
