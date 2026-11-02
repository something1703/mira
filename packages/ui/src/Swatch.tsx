import type { CSSProperties } from "react";
import { cx } from "./cx";

export type SwatchState = "default" | "selected" | "best" | "out_of_range";

export interface SwatchProps {
  /** A measured or catalogue colour: data from a run or a range, not a UI token. */
  colour: string;
  name: string;
  /** Already formatted ΔE reading, e.g. "1.8". */
  de?: string;
  state?: SwatchState;
}

/** A 2 px-radius chip that behaves like a physical swatch card. Render inside `SwatchList`. */
export function Swatch({ colour, name, de, state = "default" }: SwatchProps) {
  return (
    <li className={cx("mira-swatch", `mira-swatch--${state}`)} aria-current={state === "selected"}>
      <span className="mira-swatch__chip" style={{ "--chip": colour } as CSSProperties} />
      <span className="mira-swatch__name">{name}</span>
      {de ? <span className="mira-swatch__de mira-figures">ΔE {de}</span> : null}
      {state === "best" ? <span className="mira-swatch__tag">Best match</span> : null}
      {state === "out_of_range" ? <span className="mira-swatch__tag">Out of range</span> : null}
    </li>
  );
}

export function SwatchList({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <ul className="mira-swatches" aria-label={label}>
      {children}
    </ul>
  );
}
